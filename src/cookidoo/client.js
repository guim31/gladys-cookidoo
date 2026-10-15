// -----------------------------------------------------------------------------
// The Cookidoo API client: tokens, endpoint discovery and the calls the
// integration needs (shopping list, week plan, subscription, profile).
//
// Endpoints. Cookidoo publishes, per service, a HAL document
// `https://<country host>/<service>/.well-known/home` listing the live path
// of each endpoint ("rel"). The paths are read there once per process, not
// hard-coded: when Cookidoo moves an endpoint, the integration follows; when
// it removes one, the call fails clearly (no stale fallback), as cookidoo-api
// does. The rels below are the ones cookidoo-api resolves the same way.
//
// Tokens. The access token lives 12 h; it is refreshed 5 minutes before it
// expires, and once more on a 401. A refused refresh falls back to a full
// sign-in, unless the owner of the client paused the sign-in (after the
// account refused the password: retrying could lock it).
// -----------------------------------------------------------------------------

import { CookidooAuth } from './auth.js';
import { CookidooError, apiError, authError, blockedError, networkError } from './errors.js';
import {
  parseCustomRecipe,
  parseEditedItems,
  parseProfile,
  parseShoppingList,
  parseSubscription,
  parseWeek,
} from './parse.js';

/** rel → the service whose `.well-known/home` lists it. */
export const ENDPOINT_RELS = {
  'community-profile:user-private-profile': 'community/profile',
  'ownership:subscriptions': 'ownership',
  'pantry:home': 'shopping',
  'pantry:edit-ingredients-ownership': 'shopping',
  'pantry:remove-recipe': 'shopping',
  'pantry:add-additional-items-v2': 'shopping',
  'pantry:edit-additional-items-ownership': 'shopping',
  'pantry:remove-additional-items': 'shopping',
  'planning:api-my-week-from-date': 'planning',
  'customer-recipes:recipe-details': 'created-recipes',
};

const CUSTOM_RECIPE_ACCEPT = 'application/vnd.vorwerk.customer-recipe.full+json';
/** Refresh the access token this long before it expires. */
const TOKEN_MARGIN_MS = 5 * 60 * 1000;

/**
 * Expand a discovered href (RFC 6570 subset): `{lang}`, `{/lang}`, `{dayKey}`,
 * `{id}`… from `vars`; query templates (`{?a,b}`) are dropped. A variable the
 * caller did not give is an API change.
 * @param {string} href
 * @param {Record<string, string>} vars
 * @returns {string} the path, without the host
 */
export function expandHref(href, vars) {
  const path = href.replace(/^https?:\/\/[^/]+/, '').replace(/\{[?&][^}]*\}/g, '');
  return path.replace(/\{(\/?)([A-Za-z0-9_]+)\}/g, (_, slash, name) => {
    const value = vars[name];
    if (value === undefined) {
      throw apiError(`endpoint variable "${name}" unknown`);
    }
    return `${slash}${encodeURIComponent(value)}`;
  });
}

export class CookidooClient {
  /**
   * @param {object} options
   * @param {{ email: string, password: string, country: string, language: string, host: string }} options.account
   * @param {typeof fetch} [options.fetch]
   * @param {string} options.userAgent
   * @param {{ load: () => Promise<object | null>, save: (tokens: object) => Promise<void> }} options.tokenStore
   * @param {() => number} [options.now]
   */
  constructor({
    account,
    fetch: fetchImpl = fetch,
    userAgent,
    tokenStore,
    now = () => Date.now(),
  }) {
    this.account = account;
    this.fetch = fetchImpl;
    this.userAgent = userAgent;
    this.tokenStore = tokenStore;
    this.now = now;
    this.auth = new CookidooAuth({ fetch: fetchImpl, userAgent, now });
    this.tokens = undefined; // undefined: not loaded yet; null: none stored
    this.links = null;
    this.tokenPromise = null;
    /** Set by the owner after a refused password: no automatic sign-in. */
    this.loginPaused = false;
    /** Custom recipes already read, by id (their name rarely changes). */
    this.customRecipes = new Map();
  }

  get base() {
    return `https://${this.account.host}`;
  }

  // --- Tokens ----------------------------------------------------------------

  /** Sign in now with the e-mail and the password, whatever the stored tokens. */
  async login() {
    const tokens = await this.auth.login(this.account);
    await this.setTokens(tokens);
    return tokens;
  }

  async setTokens(tokens) {
    this.tokens = tokens;
    await this.tokenStore.save(tokens);
  }

  /** A valid access token: the stored one, refreshed, or a new sign-in. */
  async accessToken({ force = false } = {}) {
    // One refresh at a time: Cookidoo rotates the refresh token, a second
    // concurrent refresh would spend a retired one.
    if (!this.tokenPromise) {
      this.tokenPromise = this.validTokens(force).finally(() => {
        this.tokenPromise = null;
      });
    }
    return (await this.tokenPromise).access_token;
  }

  async validTokens(force) {
    if (this.tokens === undefined) {
      this.tokens = (await this.tokenStore.load()) ?? null;
    }
    const tokens = this.tokens;
    if (tokens && !force && this.now() < tokens.expires_at - TOKEN_MARGIN_MS) {
      return tokens;
    }
    if (tokens?.refresh_token) {
      try {
        const refreshed = await this.auth.refresh(tokens.refresh_token);
        await this.setTokens(refreshed);
        return refreshed;
      } catch (err) {
        if (!(err instanceof CookidooError) || err.kind !== 'auth') {
          throw err;
        }
        // The refresh token expired or was revoked: sign in again below.
      }
    }
    if (this.loginPaused) {
      throw authError('sign-in paused after a refused one');
    }
    return this.login();
  }

  // --- Requests --------------------------------------------------------------

  /** The live paths, read from the `.well-known/home` documents. */
  async endpoints() {
    if (this.links) {
      return this.links;
    }
    const services = [...new Set(Object.values(ENDPOINT_RELS))];
    const docs = await Promise.all(
      services.map(async (service) => [service, await this.wellKnown(service)]),
    );
    const byService = Object.fromEntries(docs);
    const links = {};
    for (const [rel, service] of Object.entries(ENDPOINT_RELS)) {
      const entry = byService[service]?._links?.[rel];
      const href = Array.isArray(entry) ? entry[0]?.href : entry?.href;
      if (typeof href !== 'string') {
        throw apiError(`Cookidoo no longer lists the endpoint "${rel}"`);
      }
      links[rel] = href;
    }
    this.links = links;
    return links;
  }

  async wellKnown(service) {
    const response = await this.send(`${this.base}/${service}/.well-known/home`, {
      headers: { accept: 'application/hal+json, application/json' },
    });
    if (response.status === 403) {
      throw blockedError('Cookidoo refused the request (HTTP 403)', { status: 403 });
    }
    if (!response.ok) {
      throw networkError(`${service} discovery answered HTTP ${response.status}`, {
        status: response.status,
      });
    }
    const doc = await response.json().catch(() => null);
    if (!doc || typeof doc !== 'object') {
      throw apiError(`${service} discovery: unexpected answer`);
    }
    return doc;
  }

  async send(url, init = {}) {
    try {
      return await this.fetch(url, {
        ...init,
        headers: { 'user-agent': this.userAgent, ...init.headers },
        redirect: 'manual',
        signal: AbortSignal.timeout(20000),
      });
    } catch (err) {
      throw networkError(`${this.account.host} unreachable (${err.cause?.code ?? err.message})`, {
        cause: err,
      });
    }
  }

  /**
   * An authenticated API call.
   * @param {string} rel
   * @param {{ method?: string, vars?: Record<string, string>, body?: unknown, accept?: string }} [options]
   * @returns {Promise<unknown>} the JSON answer, null when there is none
   */
  async call(rel, { method = 'GET', vars = {}, body, accept = 'application/json' } = {}) {
    const links = await this.endpoints();
    const path = expandHref(links[rel], { lang: this.account.language, ...vars });
    const url = `${this.base}${path}`;
    for (let attempt = 0; ; attempt += 1) {
      const token = await this.accessToken({ force: attempt > 0 });
      const response = await this.send(url, {
        method,
        headers: {
          accept,
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (response.status === 401 && attempt === 0) {
        await response.body?.cancel();
        continue; // the token was revoked early: refresh once, then retry
      }
      if (response.status === 401) {
        throw authError(`${rel}: token refused (HTTP 401)`, { status: 401 });
      }
      if (response.status === 403) {
        throw blockedError(`${rel}: refused (HTTP 403)`, { status: 403 });
      }
      if (response.status === 404) {
        throw apiError(`${rel}: not found (HTTP 404)`, { status: 404 });
      }
      if (!response.ok) {
        throw networkError(`${rel}: HTTP ${response.status}`, { status: response.status });
      }
      if (response.status === 204) {
        return null;
      }
      const raw = await response.text();
      if (raw.trim() === '') {
        return null;
      }
      try {
        return JSON.parse(raw);
      } catch {
        throw apiError(`${rel}: answer is not JSON`);
      }
    }
  }

  // --- The calls of the integration ------------------------------------------

  async getProfile() {
    return parseProfile(await this.call('community-profile:user-private-profile'));
  }

  async getShoppingList() {
    return parseShoppingList(await this.call('pantry:home'));
  }

  /**
   * The plan of the week containing `day`, custom recipes resolved by name.
   * @param {string} day YYYY-MM-DD
   */
  async getWeek(day) {
    const days = parseWeek(
      await this.call('planning:api-my-week-from-date', { vars: { dayKey: day } }),
    );
    for (const entry of days) {
      for (const id of entry.customRecipeIds) {
        const recipe = await this.getCustomRecipe(id);
        if (recipe) {
          entry.recipes.push(recipe);
        }
      }
    }
    return days;
  }

  /** A recipe of the user, cached; null when it cannot be read (deleted…). */
  async getCustomRecipe(id) {
    if (this.customRecipes.has(id)) {
      return this.customRecipes.get(id);
    }
    let recipe = null;
    try {
      recipe = parseCustomRecipe(
        await this.call('customer-recipes:recipe-details', {
          vars: { id },
          accept: CUSTOM_RECIPE_ACCEPT,
        }),
      );
    } catch (err) {
      if (!(err instanceof CookidooError) || err.kind !== 'api') {
        throw err; // a network or account failure concerns every call
      }
    }
    this.customRecipes.set(id, recipe);
    return recipe;
  }

  async getSubscription() {
    return parseSubscription(await this.call('ownership:subscriptions'));
  }

  /** Add free items to the list. */
  async addItems(names) {
    return parseEditedItems(
      await this.call('pantry:add-additional-items-v2', {
        method: 'POST',
        body: { itemsValue: names },
      }),
    );
  }

  /**
   * Check or uncheck items ("owned" in Cookidoo's words).
   * @param {Array<{ id: string, kind: 'ingredient' | 'additional' }>} items
   * @param {boolean} checked
   */
  async setChecked(items, checked) {
    const at = Math.floor(this.now() / 1000);
    const entries = (kind) =>
      items
        .filter((item) => item.kind === kind)
        .map((item) => ({ id: item.id, isOwned: checked, ownedTimestamp: at }));
    const additional = entries('additional');
    const ingredients = entries('ingredient');
    if (additional.length > 0) {
      await this.call('pantry:edit-additional-items-ownership', {
        method: 'POST',
        body: { additionalItems: additional },
      });
    }
    if (ingredients.length > 0) {
      await this.call('pantry:edit-ingredients-ownership', {
        method: 'POST',
        body: { ingredients },
      });
    }
  }

  /** Remove free items from the list. */
  async removeItems(ids) {
    await this.call('pantry:remove-additional-items', {
      method: 'POST',
      body: { additionalItemIDs: ids },
    });
  }

  /** Remove recipes (and their ingredients) from the list. */
  async removeRecipes(ids) {
    await this.call('pantry:remove-recipe', { method: 'POST', body: { recipeIDs: ids } });
  }
}

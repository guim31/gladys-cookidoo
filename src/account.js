// -----------------------------------------------------------------------------
// The Cookidoo account as the integration sees it: a client, the last data
// read (the snapshot), and the user operations on the shopping list.
//
// What it reads, and how often (the refresh is driven by src/app.js):
//   - the shopping list and the plan of the week: one request each, every
//     refresh period (5 minutes by default), and right after an operation;
//   - the subscription: once every 6 hours, it barely moves;
//   - the profile id (the identity of the device): once, then kept in /data.
//
// Failure policy, by kind (src/cookidoo/errors.js):
//   - auth: the automatic sign-in pauses until the configuration changes or
//     the user runs "Test the connection" — a refused password retried every
//     5 minutes could get the account locked;
//   - blocked: nothing is sent to Cookidoo for 30 minutes;
//   - network, api: the next refresh tries again.
// -----------------------------------------------------------------------------

import { CookidooClient } from './cookidoo/client.js';
import { CookidooError, authError } from './cookidoo/errors.js';
import { accountKey, tokenStore } from './store.js';
import { resolveMarket } from './config.js';
import { findItem, normalizeName } from './match.js';

export const SUBSCRIPTION_PERIOD_MS = 6 * 60 * 60 * 1000;
export const BLOCKED_PAUSE_MS = 30 * 60 * 1000;

/**
 * Today in the local time zone (the supervisor sets TZ to the one of Gladys).
 * @param {number} now ms
 * @returns {string} YYYY-MM-DD
 */
export function localDay(now) {
  const date = new Date(now);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export class Account {
  /**
   * @param {object} options
   * @param {ReturnType<import('./config.js').normalizeConfig>} options.config
   * @param {import('./store.js').Store} options.store
   * @param {typeof fetch} [options.fetch]
   * @param {string} options.userAgent
   * @param {() => number} [options.now]
   */
  constructor({ config, store, fetch: fetchImpl, userAgent, now = () => Date.now() }) {
    this.config = config;
    this.store = store;
    this.now = now;
    this.key = accountKey(config);
    this.market = resolveMarket(config);
    this.client = new CookidooClient({
      account: {
        email: config.email,
        password: config.password,
        country: this.market.country,
        language: this.market.language,
        host: this.market.host,
      },
      fetch: fetchImpl,
      userAgent,
      tokenStore: tokenStore(store, this.key),
      now,
    });
    /** The profile id: the platform id of the device. */
    this.profileId = null;
    /** The last data read; null until the first successful refresh. */
    this.snapshot = null;
    this.subscriptionAt = 0;
    this.blockedUntil = 0;
    this.blockedError = null;
    this.inFlight = null;
  }

  /** Reload what /data remembers of this account (profile id). */
  async load() {
    const entry = await this.store.get(this.key);
    this.profileId = typeof entry?.profile_id === 'string' ? entry.profile_id : null;
    return this;
  }

  /** Run a call to Cookidoo under the failure policy. */
  async guarded(run) {
    if (this.now() < this.blockedUntil) {
      throw this.blockedError;
    }
    try {
      return await run();
    } catch (err) {
      if (err instanceof CookidooError && err.kind === 'auth') {
        this.client.loginPaused = true;
      }
      if (err instanceof CookidooError && err.kind === 'blocked') {
        this.blockedUntil = this.now() + BLOCKED_PAUSE_MS;
        this.blockedError = err;
      }
      throw err;
    }
  }

  /** The profile id, read once from Cookidoo then kept in /data. */
  async ensureProfile() {
    if (!this.profileId) {
      const profile = await this.client.getProfile();
      this.profileId = profile.id;
      await this.store.update(this.key, { profile_id: profile.id });
    }
    return this.profileId;
  }

  /**
   * Read Cookidoo: shopping list and week plan, the subscription when due.
   * Concurrent callers share the refresh in progress.
   * @param {{ subscription?: boolean }} [options] force the subscription
   */
  refresh(options = {}) {
    if (!this.inFlight) {
      this.inFlight = this.guarded(() => this.read(options)).finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  async read({ subscription = false } = {}) {
    await this.ensureProfile();
    const now = this.now();
    const [shopping, week] = await Promise.all([
      this.client.getShoppingList(),
      this.client.getWeek(localDay(now)),
    ]);
    let sub = this.snapshot?.subscription;
    if (subscription || sub === undefined || now - this.subscriptionAt >= SUBSCRIPTION_PERIOD_MS) {
      sub = await this.client.getSubscription();
      this.subscriptionAt = now;
    }
    this.snapshot = { shopping, week, subscription: sub, readAt: now };
    return this.snapshot;
  }

  /** Read the shopping list again after an operation. */
  async rereadShopping() {
    const shopping = await this.client.getShoppingList();
    if (this.snapshot) {
      this.snapshot = { ...this.snapshot, shopping };
    }
    return shopping;
  }

  /**
   * The shopping list as it is now: an operation reads it again first (one
   * request), the list may have changed in the app since the last refresh.
   */
  async shoppingItems() {
    if (!this.snapshot) {
      await this.refresh();
      return this.snapshot.shopping.items;
    }
    return (await this.rereadShopping()).items;
  }

  // --- Operations (scenes, widget, Configuration screen) ---------------------

  /**
   * Add a free item, unless an unchecked item of that name is already there;
   * a checked one of that name is put back on the list instead of doubled.
   * @param {string} name
   * @returns {Promise<{ added: boolean, item?: object }>}
   */
  async addItem(name) {
    const clean = String(name ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    return this.guarded(async () => {
      const items = await this.shoppingItems();
      const wanted = normalizeName(clean);
      const same = items.filter((item) => normalizeName(item.name) === wanted);
      const pending = same.find((item) => !item.checked);
      if (pending) {
        return { added: false, item: pending };
      }
      const bought = same.find((item) => item.checked && item.kind === 'additional');
      if (bought) {
        await this.client.setChecked([bought], false);
      } else {
        await this.client.addItems([clean]);
      }
      await this.rereadShopping();
      return { added: true, item: bought ?? { name: clean } };
    });
  }

  /**
   * Check or uncheck an item, found by name (scenes) or by id (widget).
   * @param {{ name?: string, id?: string, kind?: string }} target
   * @param {boolean} checked
   * @returns {Promise<{ found: boolean, item?: object }>}
   */
  async setChecked(target, checked) {
    return this.guarded(async () => {
      const items = await this.shoppingItems();
      const item = target.id
        ? items.find((candidate) => candidate.id === target.id && candidate.kind === target.kind)
        : findItem(items, target.name, { checked: !checked });
      if (!item) {
        return { found: false };
      }
      if (item.checked !== checked) {
        await this.client.setChecked([item], checked);
        await this.rereadShopping();
      }
      return { found: true, item };
    });
  }

  /**
   * Remove what was bought: the checked free items, and the recipes whose
   * ingredients are all checked (Cookidoo only removes an ingredient with its
   * recipe). A recipe partly bought stays, its checked ingredients too.
   * @returns {Promise<{ removed: number }>}
   */
  async clearChecked() {
    return this.guarded(async () => {
      await this.refresh();
      const { items, recipes } = this.snapshot.shopping;
      const freeIds = items
        .filter((item) => item.kind === 'additional' && item.checked)
        .map((item) => item.id);
      const checkedIngredients = new Set(
        items.filter((item) => item.kind === 'ingredient' && item.checked).map((item) => item.id),
      );
      const doneRecipes = recipes.filter(
        (recipe) =>
          recipe.ingredientIds.length > 0 &&
          recipe.ingredientIds.every((id) => checkedIngredients.has(id)),
      );
      if (freeIds.length > 0) {
        await this.client.removeItems(freeIds);
      }
      if (doneRecipes.length > 0) {
        await this.client.removeRecipes(doneRecipes.map((recipe) => recipe.id));
      }
      const removed =
        freeIds.length +
        doneRecipes.reduce((count, recipe) => count + recipe.ingredientIds.length, 0);
      if (removed > 0) {
        await this.rereadShopping();
      }
      return { removed };
    });
  }

  /**
   * The Configuration screen check: sign in again with the password (the
   * user just asked, so a paused sign-in is retried once), then read all.
   */
  async test() {
    if (!this.config.email || !this.config.password) {
      throw authError('not configured');
    }
    this.client.loginPaused = false;
    this.blockedUntil = 0;
    await this.guarded(() => this.client.login());
    return this.refresh({ subscription: true });
  }
}

// -----------------------------------------------------------------------------
// A fake Cookidoo, behind a `fetch` the integration receives instead of the
// network: the identity provider (OpenID configuration, login form, login
// service, token endpoint) and the API of one country host, answering the
// recorded responses of test/fixtures/cookidoo/ (cookidoo-api, MIT).
//
// The shopping list is mutable (items added, checked, removed) so the scene
// actions and the widget buttons can be checked end to end. Every request is
// recorded in `requests`; `options` turn on the failures to test (a 403 of
// the anti-robot protection, Cookidoo down, a revoked token...).
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const fixture = (name) =>
  readFileSync(new URL(`../fixtures/cookidoo/${name}`, import.meta.url), 'utf8');
export const json = (name) => JSON.parse(fixture(name));

export const CIAM = 'https://ciam.prod.cookidoo.vorwerk-digital.com';
export const EMAIL = 'cook@example.com';
export const PASSWORD = 'correct horse battery staple';
export const PROFILE_ID = json('profile.json').id;

/** A 1 × 1 PNG: the recipe pictures of the CDN. */
export const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const respond = (status, body, headers = {}) =>
  new Response(body === null || typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: {
      ...(body !== null && typeof body === 'object' ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
  });
const redirect = (location, headers = {}) => respond(302, null, { location, ...headers });

/**
 * @param {object} [options]
 * @param {string} [options.password] the password the account accepts
 * @param {string} [options.week] fixture of the week plan
 * @param {string} [options.subscriptions] fixture of the subscriptions
 * @param {boolean} [options.blocked] the login form answers 403 (anti-robot)
 * @param {boolean} [options.down] every request fails at the network level
 * @param {number} [options.tokenLifetime] seconds (expires_in)
 */
export function createFakeCookidoo(options = {}) {
  const state = {
    password: options.password ?? PASSWORD,
    weekFixture: options.week ?? 'calendar-week.json',
    subscriptionsFixture: options.subscriptions ?? 'subscriptions-regular-active.json',
    blocked: options.blocked ?? false,
    down: options.down ?? false,
    tokenLifetime: options.tokenLifetime ?? 43200,
    shopping: json('shopping-list.json'),
    requests: [],
    logins: 0,
    refreshes: 0,
    validTokens: new Set(),
    refreshTokens: new Set(),
    pending: new Map(), // authorization code → PKCE challenge
    flows: new Map(), // requestId → { state, challenge }
    nextId: 1,
  };

  const issueTokens = (prefix) => {
    const n = state.nextId++;
    const access = `${prefix}-access-${n}`;
    const refresh = `${prefix}-refresh-${n}`;
    state.validTokens.add(access);
    state.refreshTokens.add(refresh);
    return {
      access_token: access,
      refresh_token: refresh,
      token_type: 'Bearer',
      expires_in: state.tokenLifetime,
    };
  };

  async function readForm(init) {
    return new URLSearchParams(typeof init.body === 'string' ? init.body : '');
  }

  async function identity(url, init) {
    const method = init.method ?? 'GET';
    if (url.pathname === '/.well-known/openid-configuration') {
      return respond(200, json('oidc-discovery.json'));
    }
    if (url.pathname === '/authz-srv/authz' && method === 'GET') {
      if (state.blocked) {
        return respond(403, '<html>Just a moment...</html>', { 'content-type': 'text/html' });
      }
      const params = url.searchParams;
      if (
        params.get('client_id') !== 'mobile-android' ||
        params.get('code_challenge_method') !== 'S256' ||
        !params.get('code_challenge') ||
        !params.get('market')
      ) {
        return respond(400, 'bad authorize request');
      }
      const requestId = `00000000-0000-4000-8000-${String(state.nextId++).padStart(12, '0')}`;
      state.flows.set(requestId, {
        state: params.get('state'),
        challenge: params.get('code_challenge'),
      });
      return redirect(`/login-srv/form?requestId=${requestId}`, {
        'set-cookie': `cidaas_sid=${requestId}; Path=/; Secure; HttpOnly`,
      });
    }
    if (url.pathname === '/login-srv/form') {
      const requestId = url.searchParams.get('requestId');
      if (!(init.headers?.get?.('cookie') ?? '').includes(`cidaas_sid=${requestId}`)) {
        return respond(400, 'no session cookie');
      }
      const page = fixture('login-page.html').replace('test-request-id-1234', requestId);
      return respond(200, page, { 'content-type': 'text/html' });
    }
    if (url.pathname === '/login-srv/login' && method === 'POST') {
      const form = await readForm(init);
      const flow = state.flows.get(form.get('requestId'));
      if (!flow) {
        return respond(400, 'unknown request');
      }
      if (form.get('username') !== EMAIL || form.get('password') !== state.password) {
        return redirect(`/login-srv/form?requestId=${form.get('requestId')}&error=invalid`);
      }
      const code = `code-${state.nextId++}`;
      state.pending.set(code, flow.challenge);
      // One more hop on the identity provider, as the real flow does.
      return redirect(`/authz-srv/continue?code=${code}&state=${encodeURIComponent(flow.state)}`);
    }
    if (url.pathname === '/authz-srv/continue') {
      return redirect(
        `com.vorwerk.cookidoo://code-grant?code=${url.searchParams.get('code')}&state=${encodeURIComponent(url.searchParams.get('state'))}`,
      );
    }
    if (url.pathname === '/token-srv/token' && method === 'POST') {
      const form = await readForm(init);
      if (form.get('client_id') !== 'mobile-android') {
        return respond(401, { error: 'invalid_client' });
      }
      if (form.get('grant_type') === 'authorization_code') {
        const challenge = state.pending.get(form.get('code'));
        const computed = createHash('sha256')
          .update(form.get('code_verifier') ?? '')
          .digest('base64url');
        if (!challenge || challenge !== computed) {
          return respond(400, { error: 'invalid_grant' });
        }
        state.pending.delete(form.get('code'));
        state.logins += 1;
        return respond(200, issueTokens('login'));
      }
      if (form.get('grant_type') === 'refresh_token') {
        const refresh = form.get('refresh_token');
        if (!state.refreshTokens.has(refresh)) {
          return respond(400, { error: 'invalid_grant' });
        }
        state.refreshTokens.delete(refresh); // rotated
        state.refreshes += 1;
        return respond(200, issueTokens('refreshed'));
      }
      return respond(400, { error: 'unsupported_grant_type' });
    }
    return respond(404, 'not found');
  }

  function shoppingDoc() {
    return state.shopping;
  }

  function findAdditional(id) {
    return state.shopping.additionalItems.find((item) => item.id === id);
  }

  function findIngredient(id) {
    for (const recipe of [...state.shopping.recipes, ...state.shopping.customerRecipes]) {
      const found = recipe.recipeIngredientGroups.find((item) => item.id === id);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  async function api(url, init) {
    const method = init.method ?? 'GET';
    const wellKnown = url.pathname.match(/^\/(.+)\/\.well-known\/home$/);
    if (wellKnown && method === 'GET') {
      const doc = json('well-known.json')[wellKnown[1]];
      return doc ? respond(200, doc) : respond(404, 'not found');
    }
    const auth = init.headers?.authorization ?? '';
    if (!state.validTokens.has(auth.replace(/^Bearer /, ''))) {
      return respond(401, { error: 'invalid_token' });
    }
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    const path = url.pathname;
    if (method === 'GET' && /^\/community\/profile\/[^/]+$/.test(path)) {
      return respond(200, json('profile.json'));
    }
    if (method === 'GET' && path === '/ownership/subscriptions') {
      return respond(200, json(state.subscriptionsFixture));
    }
    if (method === 'GET' && /^\/shopping\/[^/]+$/.test(path)) {
      return respond(200, shoppingDoc());
    }
    if (method === 'GET' && /^\/planning\/[^/]+\/api\/my-week\/\d{4}-\d{2}-\d{2}$/.test(path)) {
      return respond(200, json(state.weekFixture));
    }
    if (method === 'GET' && /^\/created-recipes\/[^/]+\/[^/]+$/.test(path)) {
      const recipe = json('custom-recipe.json');
      return path.endsWith(`/${recipe.recipeId}`)
        ? respond(200, recipe)
        : respond(404, { error: 'not found' });
    }
    if (method === 'POST' && path.endsWith('/additional-items/add')) {
      const added = body.itemsValue.map((name) => ({
        id: `01ADDED${String(state.nextId++).padStart(19, '0')}`,
        name,
        isOwned: false,
      }));
      state.shopping.additionalItems.push(...added);
      return respond(200, { data: added });
    }
    if (method === 'POST' && path.endsWith('/additional-items/ownership/edit')) {
      const edited = body.additionalItems.map((entry) => {
        const item = findAdditional(entry.id);
        item.isOwned = entry.isOwned;
        return item;
      });
      return respond(200, { data: edited });
    }
    if (method === 'POST' && path.endsWith('/owned-ingredients/ownership/edit')) {
      const edited = body.ingredients.map((entry) => {
        const item = findIngredient(entry.id);
        item.isOwned = entry.isOwned;
        return item;
      });
      return respond(200, { data: edited });
    }
    if (method === 'POST' && path.endsWith('/additional-items/remove')) {
      state.shopping.additionalItems = state.shopping.additionalItems.filter(
        (item) => !body.additionalItemIDs.includes(item.id),
      );
      return respond(200, { message: 'removed' });
    }
    if (method === 'POST' && path.endsWith('/recipes/remove')) {
      state.shopping.recipes = state.shopping.recipes.filter(
        (recipe) => !body.recipeIDs.includes(recipe.id),
      );
      state.shopping.customerRecipes = state.shopping.customerRecipes.filter(
        (recipe) => !body.recipeIDs.includes(recipe.id),
      );
      return respond(200, { message: 'removed' });
    }
    return respond(404, { error: `no route ${method} ${path}` });
  }

  async function fakeFetch(target, init = {}) {
    const url = new URL(target);
    const headers = init.headers instanceof Headers ? init.headers : new Headers(init.headers);
    state.requests.push({
      method: init.method ?? 'GET',
      host: url.hostname,
      path: url.pathname,
      body: init.body,
      headers: Object.fromEntries(headers),
    });
    if (state.down) {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    }
    const plain = { ...init, headers: Object.fromEntries(headers) };
    plain.headers.get = (name) => headers.get(name);
    if (url.origin === CIAM) {
      return identity(url, plain);
    }
    if (url.hostname === 'assets.tmecosys.com') {
      return new Response(PIXEL_PNG, { status: 200, headers: { 'content-type': 'image/png' } });
    }
    return api(url, plain);
  }

  return Object.assign(state, {
    fetch: fakeFetch,
    /** Requests to the API host (not the identity provider), by path. */
    apiCalls(pathPattern) {
      return state.requests.filter(
        (request) => request.host !== new URL(CIAM).hostname && pathPattern.test(request.path),
      );
    },
    /** Forget every access token, as a revocation would. */
    revokeAccessTokens() {
      state.validTokens.clear();
    },
  });
}

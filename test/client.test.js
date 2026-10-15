// -----------------------------------------------------------------------------
// The Cookidoo client against the fake Cookidoo: the OAuth2 + PKCE sign-in,
// the token lifecycle, the endpoint discovery and the failure kinds.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CookidooClient, ENDPOINT_RELS, expandHref } from '../src/cookidoo/client.js';
import { CookieJar } from '../src/cookidoo/http.js';
import { extractRequestId, pkcePair, tokensFromPayload } from '../src/cookidoo/auth.js';
import { EMAIL, PASSWORD, createFakeCookidoo, json } from './helpers/fakeCookidoo.js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const UA = 'gladys-cookidoo/test';

function memoryTokens(initial = null) {
  const store = { tokens: initial, saves: 0 };
  return Object.assign(store, {
    async load() {
      return store.tokens;
    },
    async save(tokens) {
      store.tokens = tokens;
      store.saves += 1;
    },
  });
}

function makeClient({ cookidoo = createFakeCookidoo(), password = PASSWORD, tokens, clock } = {}) {
  const now = clock ?? { value: Date.UTC(2025, 2, 4, 12) };
  const store = memoryTokens(tokens);
  const client = new CookidooClient({
    account: { email: EMAIL, password, country: 'fr', language: 'fr-FR', host: 'cookidoo.fr' },
    fetch: cookidoo.fetch,
    userAgent: UA,
    tokenStore: store,
    now: () => now.value,
  });
  return { client, cookidoo, store, now };
}

test('signs in with authorization code + PKCE, then reads the shopping list', async () => {
  const { client, cookidoo, store } = makeClient();
  const list = await client.getShoppingList();
  assert.equal(cookidoo.logins, 1);
  assert.equal(store.saves, 1);
  assert.match(store.tokens.access_token, /^login-access-/);
  assert.ok(store.tokens.refresh_token);
  assert.ok(list.items.length > 0);

  // The credentials went to the CIAM login service only, as a form.
  const posts = cookidoo.requests.filter((r) => r.body && String(r.body).includes('password'));
  assert.equal(posts.length, 1);
  assert.equal(posts[0].path, '/login-srv/login');
  // Every request says who it is: the integration, not a browser.
  for (const request of cookidoo.requests) {
    assert.equal(request.headers['user-agent'], UA);
  }
});

test('the PKCE pair is S256 and the login form gives its requestId', () => {
  const { verifier, challenge } = pkcePair();
  assert.ok(verifier.length >= 43);
  assert.equal(createHash('sha256').update(verifier).digest('base64url'), challenge);
  const html = readFileSync(
    new URL('./fixtures/cookidoo/login-page.html', import.meta.url),
    'utf8',
  );
  assert.equal(extractRequestId(html), 'test-request-id-1234');
  assert.equal(extractRequestId('<html>nothing</html>'), null);
});

test('a refused password is an auth error, without retry', async () => {
  const { client, cookidoo } = makeClient({ password: 'wrong' });
  await assert.rejects(client.getShoppingList(), (err) => err.kind === 'auth');
  assert.equal(cookidoo.requests.filter((r) => r.path === '/login-srv/login').length, 1);
  assert.equal(cookidoo.logins, 0);
});

test('an anti-robot refusal is a "blocked" error, never worked around', async () => {
  const { client, cookidoo } = makeClient({ cookidoo: createFakeCookidoo({ blocked: true }) });
  await assert.rejects(client.getShoppingList(), (err) => err.kind === 'blocked');
  // No credentials were sent once the login page was refused.
  assert.equal(cookidoo.requests.filter((r) => r.path === '/login-srv/login').length, 0);
});

test('Cookidoo down is a network error', async () => {
  const { client } = makeClient({ cookidoo: createFakeCookidoo({ down: true }) });
  await assert.rejects(client.getShoppingList(), (err) => err.kind === 'network');
});

test('stored tokens are reused, refreshed before they expire, re-signed-in when revoked', async () => {
  const cookidoo = createFakeCookidoo();
  const clock = { value: Date.UTC(2025, 2, 4, 12) };
  const first = makeClient({ cookidoo, clock });
  await first.client.getShoppingList();
  assert.equal(cookidoo.logins, 1);

  // A restart: the tokens of /data are used, no new sign-in.
  const second = makeClient({ cookidoo, clock, tokens: first.store.tokens });
  await second.client.getShoppingList();
  assert.equal(cookidoo.logins, 1);
  assert.equal(cookidoo.refreshes, 0);

  // 12 hours later: refreshed (the refresh token rotates), no sign-in.
  clock.value += 12 * 3600 * 1000;
  await second.client.getShoppingList();
  assert.equal(cookidoo.refreshes, 1);
  assert.equal(cookidoo.logins, 1);
  assert.match(second.store.tokens.access_token, /^refreshed-access-/);

  // The access token revoked early: one refresh on the 401, then the call.
  cookidoo.revokeAccessTokens();
  await second.client.getShoppingList();
  assert.equal(cookidoo.refreshes, 2);

  // The refresh token refused too: a full sign-in.
  cookidoo.revokeAccessTokens();
  cookidoo.refreshTokens.clear();
  await second.client.getShoppingList();
  assert.equal(cookidoo.logins, 2);
});

test('a paused sign-in is not attempted', async () => {
  const { client, cookidoo } = makeClient();
  client.loginPaused = true;
  await assert.rejects(client.getShoppingList(), (err) => err.kind === 'auth');
  assert.equal(cookidoo.requests.filter((r) => r.path.startsWith('/login-srv')).length, 0);
});

test('concurrent calls share one refresh (Cookidoo rotates the refresh token)', async () => {
  const cookidoo = createFakeCookidoo();
  const clock = { value: Date.UTC(2025, 2, 4, 12) };
  const { client } = makeClient({ cookidoo, clock });
  await client.getShoppingList();
  clock.value += 12 * 3600 * 1000;
  await Promise.all([client.getShoppingList(), client.getSubscription(), client.getProfile()]);
  assert.equal(cookidoo.refreshes, 1);
});

test('the endpoints come from the .well-known documents, each read once', async () => {
  const { client, cookidoo } = makeClient();
  await client.getShoppingList();
  await client.getWeek('2025-03-04');
  const services = new Set(Object.values(ENDPOINT_RELS));
  const discoveries = cookidoo.requests.filter((r) => r.path.endsWith('/.well-known/home'));
  assert.equal(discoveries.length, services.size);
  assert.ok(cookidoo.apiCalls(/^\/shopping\/fr-FR$/).length === 1);
  assert.ok(cookidoo.apiCalls(/^\/planning\/fr-FR\/api\/my-week\/2025-03-04$/).length === 1);
});

test('an endpoint Cookidoo no longer lists is an API error, not a guess', async () => {
  const cookidoo = createFakeCookidoo();
  const fetchWithout = async (url, init) => {
    const response = await cookidoo.fetch(url, init);
    if (String(url).endsWith('/shopping/.well-known/home')) {
      return new Response(JSON.stringify({ _links: {} }), { status: 200 });
    }
    return response;
  };
  const { client } = makeClient({ cookidoo: { ...cookidoo, fetch: fetchWithout } });
  await assert.rejects(client.getShoppingList(), (err) => err.kind === 'api');
});

test('the discovered hrefs are expanded with our variables', () => {
  assert.equal(
    expandHref('https://cookidoo.de/shopping/{lang}{?excludeComponent}', { lang: 'de-DE' }),
    '/shopping/de-DE',
  );
  assert.equal(
    expandHref('https://cookidoo.de/recipes/recipe{/lang}/{id}', { lang: 'fr-FR', id: 'r1' }),
    '/recipes/recipe/fr-FR/r1',
  );
  assert.equal(
    expandHref('https://cookidoo.de/planning/{lang}/api/my-week/{dayKey}', {
      lang: 'fr-FR',
      dayKey: '2025-03-04',
    }),
    '/planning/fr-FR/api/my-week/2025-03-04',
  );
  assert.throws(
    () => expandHref('/x/{unknown}', {}),
    (err) => err.kind === 'api',
  );
});

test('custom recipes of the plan are read by id, a deleted one is skipped', async () => {
  const { client, cookidoo } = makeClient({
    cookidoo: createFakeCookidoo({ week: 'calendar-week-custom.json' }),
  });
  const days = await client.getWeek('2025-03-04');
  const names = Object.fromEntries(days.map((d) => [d.day, d.recipes.map((r) => r.name)]));
  assert.deepEqual(names['2025-03-04'], ['Waffles', 'Vongole alla marinara']);
  // The custom recipe planned twice is read once; the deleted one is skipped.
  assert.deepEqual(names['2025-03-05'], ['Vongole alla marinara']);
  assert.deepEqual(names['2025-03-06'], ['Inline custom recipe']);
  assert.equal(cookidoo.apiCalls(/^\/created-recipes\/fr-FR\//).length, 2);
});

test('the token answer becomes the stored tokens', () => {
  const token = json('token.json');
  const stored = tokensFromPayload(token, undefined, 1000);
  assert.deepEqual(stored, {
    access_token: 'test-access-token',
    refresh_token: 'test-refresh-token',
    expires_at: 1000 + 43200 * 1000,
  });
  // A refresh answer without a new refresh token keeps the previous one.
  assert.equal(tokensFromPayload({ access_token: 'a' }, 'old', 0).refresh_token, 'old');
  assert.throws(
    () => tokensFromPayload({}, undefined, 0),
    (err) => err.kind === 'api',
  );
});

test('the cookie jar keeps cookies per domain and forgets the expired ones', () => {
  const jar = new CookieJar();
  const url = new URL('https://ciam.prod.cookidoo.vorwerk-digital.com/login');
  jar.store(
    url,
    new Headers([
      ['set-cookie', 'a=1; Path=/'],
      ['set-cookie', 'b=2; Domain=.vorwerk-digital.com'],
      ['set-cookie', 'c=3; Domain=evil.example'],
    ]),
  );
  assert.equal(jar.header(url), 'a=1; b=2; c=3');
  assert.equal(jar.header(new URL('https://other.vorwerk-digital.com/')), 'b=2');
  assert.equal(jar.header(new URL('https://evil.example/')), undefined);
  jar.store(url, new Headers([['set-cookie', 'a=gone; Max-Age=0']]));
  assert.equal(jar.header(url), 'b=2; c=3');
});

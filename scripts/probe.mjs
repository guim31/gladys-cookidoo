#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Probe of the real Cookidoo service, with the integration's own client.
//
//   node scripts/probe.mjs [country]        # default: fr
//
// Without credentials, it signs in with a made-up account until Cookidoo
// refuses it, and reads the public endpoint discovery: it checks that the
// identity provider, the login form, the redirect chain and the API still
// look like what the integration expects. Read-only, nothing is changed.
//
// With COOKIDOO_EMAIL and COOKIDOO_PASSWORD in the environment, it signs in
// with that account and reads the shopping list, the week plan and the
// subscription — still read-only — and prints counts only.
//
// Nothing sensitive is printed: hosts and paths without query strings, HTTP
// statuses, counts. Never a token, a cookie, a requestId, an e-mail or a
// password.
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import { CookidooAuth } from '../src/cookidoo/auth.js';
import { CookidooClient, ENDPOINT_RELS } from '../src/cookidoo/client.js';
import { MARKETS, normalizeConfig, resolveMarket } from '../src/config.js';
import { localDay } from '../src/account.js';
import { USER_AGENT } from '../src/app.js';

const country = (process.argv[2] ?? 'fr').toLowerCase();
if (!MARKETS[country]) {
  console.error(`Unknown country "${country}". Known: ${Object.keys(MARKETS).join(', ')}`);
  process.exit(2);
}
const market = resolveMarket(normalizeConfig({ country }));
const real = Boolean(process.env.COOKIDOO_EMAIL && process.env.COOKIDOO_PASSWORD);

/** fetch, printing each request as host + path + status. */
async function tracedFetch(url, init = {}) {
  const target = new URL(url);
  const label = `${init.method ?? 'GET'} ${target.hostname}${target.pathname}`;
  try {
    const response = await fetch(url, init);
    const location = response.headers.get('location');
    const next = location ? ` -> ${safeLocation(location, target)}` : '';
    console.log(`  ${response.status} ${label}${next}`);
    return response;
  } catch (err) {
    console.log(`  ERR ${label} (${err.cause?.code ?? err.message})`);
    throw err;
  }
}

/** A redirect target without its query string (it carries codes and state). */
function safeLocation(location, base) {
  try {
    const url = new URL(location, base);
    return `${url.protocol}//${url.hostname}${url.pathname}${url.search ? ' (query hidden)' : ''}`;
  } catch {
    return '(unparsable location)';
  }
}

function report(step, err) {
  console.log(`=> ${step}: ${err ? `${err.kind ?? 'error'} — ${err.message}` : 'OK'}`);
}

console.log(`Cookidoo probe — ${market.host}, ${market.language}, User-Agent "${USER_AGENT}"`);
console.log(real ? 'Mode: real account (read-only)\n' : 'Mode: made-up account\n');

// 1. The identity provider.
const auth = new CookidooAuth({ fetch: tracedFetch, userAgent: USER_AGENT });
console.log('1. OpenID configuration');
try {
  const oidc = await auth.discovery();
  console.log(
    `  authorize: ${new URL(oidc.authorize).hostname}, token: ${new URL(oidc.token).hostname}`,
  );
  report('OpenID configuration');
} catch (err) {
  report('OpenID configuration', err);
}

// 2. The endpoint discovery of the country host (public).
console.log('\n2. Endpoint discovery (.well-known/home)');
const client = new CookidooClient({
  account: {
    email: process.env.COOKIDOO_EMAIL ?? `probe-${randomBytes(4).toString('hex')}@example.invalid`,
    password: process.env.COOKIDOO_PASSWORD ?? randomBytes(12).toString('base64url'),
    country: market.country,
    language: market.language,
    host: market.host,
  },
  fetch: tracedFetch,
  userAgent: USER_AGENT,
  tokenStore: { load: async () => null, save: async () => {} },
});
try {
  const links = await client.endpoints();
  console.log(
    `  ${Object.keys(links).length}/${Object.keys(ENDPOINT_RELS).length} endpoints found`,
  );
  report('Endpoint discovery');
} catch (err) {
  report('Endpoint discovery', err);
}

// 3. The sign-in.
console.log(
  `\n3. Sign-in with ${real ? 'the given account' : 'a made-up account (a refusal is expected)'}`,
);
let signedIn = false;
try {
  await client.login();
  signedIn = true;
  report('Sign-in');
} catch (err) {
  report('Sign-in', err);
  if (!real && err.kind === 'auth') {
    console.log(
      '   (expected: the login form, the credential post and the refusal work as the integration expects)',
    );
  }
}

// 4. Read-only calls with a real account.
if (signedIn) {
  console.log('\n4. Read-only calls');
  try {
    const list = await client.getShoppingList();
    const toBuy = list.items.filter((item) => !item.checked).length;
    console.log(
      `  shopping list: ${list.recipes.length} recipe(s), ${list.items.length} item(s), ${toBuy} to buy`,
    );
    const week = await client.getWeek(localDay(Date.now()));
    console.log(
      `  week plan: ${week.length} day(s), ${week.reduce((n, d) => n + d.recipes.length, 0)} recipe(s)`,
    );
    const subscription = await client.getSubscription();
    console.log(
      `  subscription: ${subscription ? `${subscription.type}, ${subscription.status}` : 'none active'}`,
    );
    report('Read-only calls');
  } catch (err) {
    report('Read-only calls', err);
  }
}

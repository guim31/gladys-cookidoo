// -----------------------------------------------------------------------------
// What the integration keeps in /data, and the configuration it derives the
// Cookidoo site and language from.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STORE_FILE, Store, accountKey } from '../src/store.js';
import { normalizeConfig, resolveMarket } from '../src/config.js';
import { localDay } from '../src/account.js';
import './helpers/world.js'; // TZ=Europe/Paris

const dir = () => mkdtempSync(join(tmpdir(), 'gladys-cookidoo-store-'));

test('an entry belongs to one account: another one starts from scratch', async () => {
  const store = new Store(dir());
  const mine = accountKey({ email: 'Cook@Example.com', country: 'fr' });
  assert.equal(mine, accountKey({ email: 'cook@example.com', country: 'fr' }));
  await store.update(mine, { profile_id: 'p1' });
  await store.update(mine, { tokens: { access_token: 'a' } });
  assert.deepEqual(await store.get(mine), { profile_id: 'p1', tokens: { access_token: 'a' } });
  const other = accountKey({ email: 'cook@example.com', country: 'de' });
  assert.equal(await store.get(other), null);
  await store.update(other, { profile_id: 'p2' });
  assert.equal(await store.get(mine), null, 'replaced, never mixed');
});

test('a damaged file reads as empty', async () => {
  const path = dir();
  writeFileSync(join(path, STORE_FILE), '{not json');
  const store = new Store(path);
  assert.equal(await store.get('x'), null);
  await store.update('x', { a: 1 });
  assert.deepEqual(JSON.parse(readFileSync(join(path, STORE_FILE), 'utf8')).data, { a: 1 });
});

test('concurrent writes are serialized', async () => {
  const store = new Store(dir());
  await Promise.all([store.update('k', { a: 1 }), store.update('k', { b: 2 })]);
  assert.deepEqual(await store.get('k'), { a: 1, b: 2 });
});

test('the Cookidoo site and language come from the country', () => {
  const market = (raw) => resolveMarket(normalizeConfig(raw));
  assert.deepEqual(market({}), { country: 'fr', host: 'cookidoo.fr', language: 'fr-FR' });
  assert.deepEqual(market({ country: 'ch', language: 'de' }), {
    country: 'ch',
    host: 'cookidoo.ch',
    language: 'de-CH',
  });
  assert.equal(market({ country: 'ch', language: 'es' }).language, 'en', 'first of the country');
  assert.equal(market({ country: 'ch', cookidoo_language: 'it-CH' }).language, 'it-CH');
  // A language the country does not offer falls back to the automatic choice.
  assert.equal(market({ country: 'fr', cookidoo_language: 'de-DE' }).language, 'fr-FR');
  assert.equal(market({ country: 'se' }).host, 'cookidoo.international');
  assert.equal(market({ country: 'ie' }).host, 'cookidoo.co.uk');
  assert.equal(market({ country: 'zz' }).country, 'fr', 'unknown country: the default');
});

test('the configuration is normalized', () => {
  assert.deepEqual(normalizeConfig({ email: ' cook@example.com ', refresh_minutes: '7' }), {
    email: 'cook@example.com',
    password: '',
    country: 'fr',
    cookidoo_language: 'auto',
    language: 'fr',
    refresh_minutes: '5',
  });
  assert.equal(normalizeConfig({ language: 'it' }).language, 'fr');
});

test('"today" is the local day of Gladys, not the UTC one', () => {
  // 23:30 UTC on 4 March is already 5 March in Paris.
  assert.equal(localDay(Date.UTC(2025, 2, 4, 23, 30)), '2025-03-05');
  assert.equal(localDay(Date.UTC(2025, 2, 4, 12)), '2025-03-04');
});

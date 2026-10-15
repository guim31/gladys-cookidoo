// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync,
// by registering the integration on the SDK's fake Gladys and comparing.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG, MARKETS, REFRESH_MINUTES } from '../src/config.js';
import { SCENE_ACTION } from '../src/scenes.js';
import { WIDGET } from '../src/widgets.js';
import { createWorld } from './helpers/world.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

const keysOf = (list) => (list ?? []).map((entry) => entry.key);
const field = (key) => manifest.config_schema.find((f) => f.key === key);

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

test('identity: name, image, cover, transports and categories', () => {
  assert.equal(manifest.name, 'Cookidoo');
  assert.equal(manifest.type, 'device');
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.deepEqual(manifest.categories, ['services', 'appliances']);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/guim31/gladys-cookidoo/main/cover.png',
  );
  assert.match(manifest.docker_image, /^ghcr\.io\/guim31\/gladys-cookidoo:/);
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  // The Release workflow writes all three: a mismatch means one was edited by hand.
  assert.equal(manifest.version, pkg.version, 'manifest version must match package.json');
  assert.ok(
    manifest.docker_image.endsWith(`:${manifest.version}`),
    `docker_image must be tagged :${manifest.version}, got "${manifest.docker_image}"`,
  );
});

test('widget buttons opening a form require Gladys >= 5.2.0', () => {
  // Widgets and scene actions need 5.1.0; the forms behind the shopping list
  // buttons (#3168) shipped in 5.2.0. Categories need 4.86.0.
  assert.ok(isAtLeast(minGladysVersion(), [5, 2, 0]), manifest.gladys_version);
});

test('every handler the code registers is declared, and vice versa', async () => {
  const world = await createWorld({ connect: false });
  const { gladys } = world;
  // A declared key without handler answers "not implemented".
  for (const key of keysOf(manifest.scene_actions)) {
    const ack = await gladys.fake.sceneAction(key, { name: 'x' });
    assert.notEqual(ack.error, 'not implemented', `scene action ${key} has no handler`);
  }
  for (const key of keysOf(manifest.widgets)) {
    const ack = await gladys.fake.widgetGet(key);
    assert.notEqual(ack.error, 'not implemented', `widget ${key} has no handler`);
  }
  for (const key of keysOf(manifest.actions)) {
    const ack = await gladys.fake.action(key, {});
    assert.notEqual(ack.error, 'not implemented', `action ${key} has no handler`);
  }
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.values(SCENE_ACTION).sort());
  assert.deepEqual(keysOf(manifest.widgets).sort(), Object.values(WIDGET).sort());
  assert.equal(manifest.scene_triggers, undefined, 'no scene trigger: the states say it all');
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const entry of manifest.config_schema) {
    if (entry.type === 'section') {
      assert.equal(entry.default, undefined);
      assert.ok(!(entry.key in DEFAULT_CONFIG), `section ${entry.key} stores no value`);
      continue;
    }
    assert.ok(entry.key in DEFAULT_CONFIG, `${entry.key} missing from DEFAULT_CONFIG`);
    if (entry.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[entry.key], entry.default, `default of ${entry.key}`);
    }
  }
});

test('the password is a secret, and no number field is used', () => {
  assert.equal(field('password').type, 'secret');
  // Gladys renders number fields without `step`: none here, choices are selects.
  assert.equal(manifest.config_schema.filter((f) => f.type === 'number').length, 0);
});

test('the country and language choices are the ones of the Cookidoo table', () => {
  assert.deepEqual(
    field('country')
      .options.map((option) => option.value)
      .sort(),
    Object.keys(MARKETS).sort(),
  );
  const languages = [...new Set(Object.values(MARKETS).flatMap((m) => m.languages))].sort();
  assert.deepEqual(
    field('cookidoo_language')
      .options.map((option) => option.value)
      .filter((value) => value !== 'auto')
      .sort(),
    languages,
  );
  assert.deepEqual(
    field('refresh_minutes').options.map((option) => option.value),
    REFRESH_MINUTES,
  );
});

test('the scene action outputs and fields are the ones the handlers use', () => {
  const byKey = Object.fromEntries(manifest.scene_actions.map((a) => [a.key, a]));
  assert.deepEqual(keysOf(byKey.add_item.outputs), ['added', 'remaining_items']);
  assert.deepEqual(keysOf(byKey.check_item.outputs), ['found', 'remaining_items']);
  assert.deepEqual(keysOf(byKey.uncheck_item.outputs), ['found', 'remaining_items']);
  assert.deepEqual(keysOf(byKey.clear_checked_items.outputs), ['removed_items']);
  for (const key of ['add_item', 'check_item', 'uncheck_item']) {
    assert.deepEqual(keysOf(byKey[key].fields), ['name']);
    assert.equal(byKey[key].fields[0].type, 'string', 'string: accepts scene variables');
  }
});

test('section links are https and placeholders are multi-language', () => {
  for (const entry of manifest.config_schema) {
    for (const link of entry.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
    if (entry.placeholder !== undefined) {
      assert.equal(typeof entry.placeholder, 'object');
    }
  }
});

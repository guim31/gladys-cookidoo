// -----------------------------------------------------------------------------
// The integration's lifecycle on the SDK's fake Gladys and the fake Cookidoo:
// the device, its states, the refresh timer (without the core's onPoll), the
// connection status, the quiet logs, and the failure policy.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG, PLANNED_DAY, addDevice, createWorld } from './helpers/world.js';
import { EMAIL, PASSWORD, PROFILE_ID } from './helpers/fakeCookidoo.js';
import { GladysApiError } from '@gladysassistant/integration-sdk';
import { HEARTBEAT_MS } from '../src/app.js';
import { STORE_FILE } from '../src/store.js';
import { TEXT } from '../src/i18n.js';

const MINUTE = 60 * 1000;
const feature = (world, key) => world.gladys.externalIds('account', PROFILE_ID).feature(key);
const last = (world, key) => world.gladys.fake.lastState(feature(world, key));

test('the account is published as one device keyed on the Cookidoo profile', async () => {
  const world = await createWorld();
  const [device] = world.gladys.fake.discoveredDevices;
  assert.equal(device.external_id, `ext:test-integration:account:${PROFILE_ID}`);
  assert.equal(device.name, 'Cookidoo');
  assert.equal(device.should_poll, false);
  assert.deepEqual(world.gladys.fake.connectionStatus, { connected: true });
  // Nothing is published for a device Gladys does not have yet.
  assert.equal(world.gladys.fake.states.length, 0);
  world.app.stop();
});

test('a device just added gets all its states at once, and the widgets are nudged', async () => {
  const world = await createWorld();
  await addDevice(world);
  assert.equal(last(world, 'remaining_items'), 24);
  assert.equal(last(world, 'checked_items'), 2);
  assert.match(last(world, 'shopping_list'), /^Zucker, Eiweisse, Salz/);
  assert.equal(last(world, 'today_recipes'), 'Waffles');
  assert.equal(last(world, 'today_recipes_count'), 1);
  assert.equal(last(world, 'today_total_time'), 25);
  assert.equal(last(world, 'subscription'), 'Premium');
  assert.equal(last(world, 'subscription_end'), '16 décembre 2025');
  assert.equal(last(world, 'subscription_days_left'), 288);
  assert.deepEqual(world.gladys.fake.widgetRefreshes.slice(-2).sort(), [
    'recipe_of_the_day',
    'shopping_list',
  ]);
  world.app.stop();
});

test('the timer refreshes the states without the core polling (Gladys#3198)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clock = { value: PLANNED_DAY };
  const world = await createWorld({ timers: true, clock });
  await addDevice(world);
  assert.equal(last(world, 'remaining_items'), 24);

  // Someone adds an item in the Cookidoo app; five minutes pass.
  world.cookidoo.shopping.additionalItems.push({ id: 'x1', name: 'Beurre', isOwned: false });
  clock.value += 5 * MINUTE;
  t.mock.timers.tick(5 * MINUTE);
  await settle(world);
  // No fake.poll() anywhere in this test: the core's onPoll never ran.
  assert.equal(last(world, 'remaining_items'), 25);

  // The next day, the recipe of the day changes with no change in Cookidoo.
  clock.value = PLANNED_DAY + 24 * 60 * MINUTE;
  t.mock.timers.tick(5 * MINUTE);
  await settle(world);
  assert.equal(last(world, 'today_recipes'), 'Moroccan Mint Tea');
  world.app.stop();
});

test('only the changes are published, and a heartbeat every 6 hours', async (t) => {
  // The SDK dates the published values with Date.now(): mock it.
  t.mock.timers.enable({ apis: ['Date'], now: PLANNED_DAY });
  const clock = {
    get value() {
      return Date.now();
    },
    set value(ms) {
      t.mock.timers.tick(ms - Date.now());
    },
  };
  const world = await createWorld({ clock });
  await addDevice(world);
  const count = world.gladys.fake.states.length;
  clock.value += 5 * MINUTE;
  await world.app.cycle();
  assert.equal(world.gladys.fake.states.length, count, 'nothing changed, nothing sent');
  clock.value += HEARTBEAT_MS;
  await world.app.cycle();
  assert.ok(world.gladys.fake.states.length >= count + 8, 'stable values sent again');
  world.app.stop();
});

test('Cookidoo is not read while nobody looks (no device added, no widget)', async () => {
  const clock = { value: PLANNED_DAY };
  const world = await createWorld({ clock });
  const before = world.cookidoo.requests.length;
  clock.value += 5 * MINUTE;
  await world.app.cycle();
  assert.equal(world.cookidoo.requests.length, before);
  // A widget shown: the timer reads Cookidoo again for an hour.
  await world.gladys.fake.widgetGet('shopping_list');
  clock.value += 10 * MINUTE;
  const afterWidget = world.cookidoo.requests.length;
  await world.app.cycle();
  assert.ok(world.cookidoo.requests.length > afterWidget);
  world.app.stop();
});

test('the subscription is read every 6 hours, not at every refresh', async () => {
  const clock = { value: PLANNED_DAY };
  const world = await createWorld({ clock });
  await addDevice(world);
  const reads = () => world.cookidoo.apiCalls(/^\/ownership\/subscriptions$/).length;
  assert.equal(reads(), 1);
  for (let i = 0; i < 5; i += 1) {
    clock.value += 5 * MINUTE;
    await world.app.cycle();
  }
  assert.equal(reads(), 1);
  clock.value += 6 * 60 * MINUTE;
  await world.app.cycle();
  assert.equal(reads(), 2);
  world.app.stop();
});

test('a normal refresh writes nothing at info level', async () => {
  const clock = { value: PLANNED_DAY };
  const world = await createWorld({ clock });
  await addDevice(world);
  const start = world.lines.length;
  for (let i = 0; i < 3; i += 1) {
    clock.value += 5 * MINUTE;
    await world.app.cycle();
  }
  await world.gladys.fake.widgetGet('shopping_list');
  await world.gladys.fake.widgetGet('recipe_of_the_day');
  const loud = world.lines.slice(start).filter((line) => line.level !== 'debug');
  assert.deepEqual(loud, []);
  world.app.stop();
});

test('no secret reaches the logs, the status or /data', async () => {
  const world = await createWorld();
  await addDevice(world);
  await world.gladys.fake.sceneAction('add_item', { name: 'Lait' });
  await world.gladys.fake.action('test_connection', {});
  // A failure too: Cookidoo down.
  world.cookidoo.down = true;
  world.app.account.snapshot.readAt = 0;
  await world.app.cycle();
  const tokens = [...world.cookidoo.validTokens, ...world.cookidoo.refreshTokens];
  const logs = world.lines.map((line) => line.text).join('\n');
  for (const secret of [PASSWORD, EMAIL, ...tokens]) {
    assert.ok(!logs.includes(secret), `a secret is in the logs: ${secret.slice(0, 6)}…`);
    assert.ok(!JSON.stringify(world.gladys.fake.connectionStatuses).includes(secret));
  }
  const file = join(world.dataDir, STORE_FILE);
  const stored = readFileSync(file, 'utf8');
  assert.ok(!stored.includes(PASSWORD), 'the password is never stored in /data');
  assert.ok(!stored.includes(EMAIL), 'the e-mail is only stored hashed');
  assert.equal(statSync(file).mode & 0o777, 0o600);
  world.app.stop();
});

test('a lost connection is said once, its return once', async () => {
  const clock = { value: PLANNED_DAY };
  const world = await createWorld({ clock });
  await addDevice(world);
  world.cookidoo.down = true;
  const start = world.lines.length;
  for (let i = 0; i < 3; i += 1) {
    clock.value += 5 * MINUTE;
    await world.app.cycle();
  }
  world.cookidoo.down = false;
  clock.value += 5 * MINUTE;
  await world.app.cycle();
  const loud = world.lines.slice(start).filter((line) => line.level !== 'debug');
  assert.deepEqual(
    loud.map((line) => line.level),
    ['warn', 'info', 'info'],
    JSON.stringify(loud),
  );
  assert.match(loud[0].text, /network/);
  assert.deepEqual(
    world.gladys.fake.connectionStatuses.map((s) => s.connected),
    [true, false, true],
  );
  assert.deepEqual(world.gladys.fake.connectionStatuses[1].message, TEXT.network);
  world.app.stop();
});

test('Gladys refusing the states is not a Cookidoo failure', async (t) => {
  const clock = { value: PLANNED_DAY };
  const world = await createWorld({ clock });
  await addDevice(world);
  t.mock.method(world.gladys, 'publishChangedStates', async () => {
    throw new GladysApiError(429, 'TOO_MANY_REQUESTS', 'RATE_LIMIT_EXCEEDED');
  });
  const start = world.lines.length;
  for (let i = 0; i < 2; i += 1) {
    clock.value += 5 * MINUTE;
    world.cookidoo.shopping.additionalItems.push({ id: `n${i}`, name: `New ${i}`, isOwned: false });
    await world.app.cycle();
  }
  assert.deepEqual(world.gladys.fake.connectionStatus, { connected: true });
  const loud = world.lines.slice(start).filter((line) => line.level !== 'debug');
  assert.equal(loud.length, 1, JSON.stringify(loud));
  assert.match(loud[0].text, /Publishing to Gladys failed/);
  world.app.stop();
});

test('a refused password pauses the sign-in until the user acts', async () => {
  const clock = { value: PLANNED_DAY };
  const world = await createWorld({ clock, config: { ...CONFIG, password: 'wrong' } });
  assert.deepEqual(world.gladys.fake.connectionStatus, { connected: false, message: TEXT.auth });
  const attempts = () =>
    world.cookidoo.requests.filter((r) => r.path === '/login-srv/login').length;
  assert.equal(attempts(), 1);
  // The refresh timer does not try the refused password again.
  world.app.account.snapshot = null;
  for (let i = 0; i < 3; i += 1) {
    clock.value += 5 * MINUTE;
    await world.app.cycle({ always: true });
  }
  assert.equal(attempts(), 1);
  // "Test the connection" tries once more (and fails again).
  const ack = await world.gladys.fake.action('test_connection', {});
  assert.deepEqual(ack.data.message, TEXT.auth);
  assert.equal(attempts(), 2);
  // The right password: a new account, signed in.
  await world.gladys.fake.configUpdated({ ...CONFIG });
  assert.deepEqual(world.gladys.fake.connectionStatus, { connected: true });
  assert.equal(attempts(), 3);
  world.app.stop();
});

test('an anti-robot refusal waits 30 minutes before any new request', async () => {
  const clock = { value: PLANNED_DAY };
  const world = await createWorld({ clock, cookidoo: { blocked: true } });
  assert.deepEqual(world.gladys.fake.connectionStatus, { connected: false, message: TEXT.blocked });
  const count = world.cookidoo.requests.length;
  clock.value += 10 * MINUTE;
  await world.app.cycle({ always: true });
  assert.equal(world.cookidoo.requests.length, count, 'paused');
  world.cookidoo.blocked = false;
  clock.value += 25 * MINUTE;
  await world.app.cycle({ always: true });
  assert.deepEqual(world.gladys.fake.connectionStatus, { connected: true });
  world.app.stop();
});

test('without e-mail and password, the status says what to fill in', async () => {
  const world = await createWorld({ config: {} });
  assert.deepEqual(world.gladys.fake.connectionStatus, {
    connected: false,
    message: TEXT.notConfigured,
  });
  assert.equal(world.cookidoo.requests.length, 0);
  assert.deepEqual(world.gladys.fake.discoveredDevices, []);
  const ack = await world.gladys.fake.action('test_connection', {});
  assert.deepEqual(ack.data.message, TEXT.notConfigured);
  world.app.stop();
});

test('a restart reuses the tokens and the profile kept in /data', async () => {
  const first = await createWorld();
  first.app.stop();
  const second = await createWorld({ dataDir: first.dataDir });
  // A new fake Cookidoo does not know the old tokens: one sign-in, but the
  // device was published from /data before Cookidoo answered.
  assert.equal(second.gladys.fake.discoveredDevices.length, 1);
  assert.equal(second.cookidoo.apiCalls(/^\/community\/profile\/fr-FR$/).length, 0);
  second.app.stop();
});

test('the test action reports the account in the four languages', async () => {
  const world = await createWorld();
  const ack = await world.gladys.fake.action('test_connection', {});
  assert.equal(ack.success, true);
  assert.match(
    ack.data.message.fr,
    /^Connecté à Cookidoo\. Liste de courses : 24 à acheter, 2 coché\(s\)\. Aujourd'hui : Waffles\. Abonnement : Premium\.$/,
  );
  assert.match(ack.data.message.de, /Abo: Premium/);
  world.app.stop();
});

test('the core poll is only a fallback', async () => {
  const clock = { value: PLANNED_DAY };
  const world = await createWorld({ clock });
  const device = await addDevice(world);
  const before = world.cookidoo.requests.length;
  await world.gladys.fake.poll(device);
  assert.equal(world.cookidoo.requests.length, before, 'just read: skipped');
  clock.value += 10 * MINUTE;
  await world.gladys.fake.poll(device);
  assert.ok(world.cookidoo.requests.length > before, 'stale: read');
  world.app.stop();
});

test('a new language sends the text states in that language', async () => {
  const world = await createWorld({ cookidoo: { subscriptions: 'subscriptions-ended.json' } });
  await addDevice(world);
  assert.equal(last(world, 'subscription'), 'Gratuit');
  await world.gladys.fake.configUpdated({ ...CONFIG, language: 'de' });
  assert.equal(last(world, 'subscription'), 'Kostenlos');
  assert.equal(last(world, 'subscription_end'), 'Keins');
  world.app.stop();
});

/** Let the timer's refresh run to its end: the timer is armed again. */
async function settle(world) {
  for (let i = 0; i < 5000 && !world.app.timerArmed; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.ok(world.app.timerArmed, 'the refresh did not finish');
}

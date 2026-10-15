// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake Cookidoo behind the
// fetch the integration uses, a temporary /data, and the integration wired
// on top through registerHandlers — the same code index.js runs.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { createLogger } from '@gladysassistant/integration-sdk';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { EMAIL, PASSWORD, createFakeCookidoo } from './fakeCookidoo.js';

// "Today" is the local day of Gladys (the supervisor sets TZ): pin a zone
// ahead of UTC, so a day computed in UTC by mistake shows up.
process.env.TZ = 'Europe/Paris';

/** Noon (UTC) on the first planned day of the recorded week plan. */
export const PLANNED_DAY = Date.UTC(2025, 2, 4, 12);

export const CONFIG = { email: EMAIL, password: PASSWORD, country: 'fr', language: 'fr' };

/**
 * A logger that records every line, by level (LOG_LEVEL does not apply).
 */
export function recordingLogger() {
  const lines = [];
  const logger = createLogger({ name: 'cookidoo', level: 'silent' });
  for (const level of ['debug', 'info', 'warn', 'error']) {
    logger[level] = (...args) => lines.push({ level, text: args.map(String).join(' ') });
  }
  logger.child = () => logger;
  return { logger, lines };
}

/**
 * @param {object} [options]
 * @param {object} [options.config] raw integration config
 * @param {object} [options.cookidoo] options of createFakeCookidoo
 * @param {Array} [options.devices] devices already created in Gladys
 * @param {boolean} [options.connect]
 * @param {boolean} [options.timers] run the refresh timer
 * @param {{ value: number }} [options.clock] mutable now (ms)
 * @param {string} [options.dataDir]
 */
export async function createWorld({
  config = CONFIG,
  cookidoo = {},
  devices = [],
  connect = true,
  timers = false,
  clock = { value: PLANNED_DAY },
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-cookidoo-')),
} = {}) {
  const fake = createFakeCookidoo(cookidoo);
  const gladys = createFakeGladys({ config, devices });
  const { logger, lines } = recordingLogger();
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    fetch: fake.fetch,
    timers,
    now: () => clock.value,
    logger,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, cookidoo: fake, app, clock, dataDir, lines };
}

/** Add the discovered device in Gladys, as the user does. */
export async function addDevice(world) {
  const [device] = world.gladys.fake.discoveredDevices;
  await world.gladys.fake.deviceCreated({ ...device, id: 'device-uuid', selector: 'cookidoo' });
  return device;
}

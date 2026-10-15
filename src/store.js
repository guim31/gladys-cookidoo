// -----------------------------------------------------------------------------
// What the integration keeps in /data, the only writable volume.
//
// One file, `cookidoo.json` (mode 600): the OAuth tokens of the account and
// the id of its Cookidoo profile, so that a restart neither signs in again
// nor waits for Cookidoo to publish the device. The entry is bound to the
// account (a hash of the e-mail and the country): another account starts
// from scratch. The password never goes there: it lives in the Gladys
// configuration.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const STORE_FILE = 'cookidoo.json';

/**
 * The key binding the stored entry to one account.
 * @param {{ email: string, country: string }} config
 */
export function accountKey(config) {
  return createHash('sha256')
    .update(`${config.email.toLowerCase()}|${config.country}`)
    .digest('hex')
    .slice(0, 32);
}

export class Store {
  /** @param {string} dir usually /data */
  constructor(dir) {
    this.dir = dir;
    this.path = join(dir, STORE_FILE);
    this.writing = Promise.resolve();
  }

  /** The whole file, {} when absent or unreadable. */
  async read() {
    try {
      const doc = JSON.parse(await readFile(this.path, 'utf8'));
      return doc && typeof doc === 'object' ? doc : {};
    } catch {
      return {};
    }
  }

  /**
   * The entry of an account, or null.
   * @param {string} key accountKey()
   */
  async get(key) {
    const doc = await this.read();
    return doc.account === key ? (doc.data ?? {}) : null;
  }

  /**
   * Merge values into the entry of an account (replacing another account's).
   * Writes are serialized and atomic (temporary file, then rename).
   * @param {string} key
   * @param {object} values
   */
  async update(key, values) {
    const run = this.writing.then(async () => {
      const doc = await this.read();
      const data = doc.account === key ? { ...doc.data, ...values } : { ...values };
      await mkdir(this.dir, { recursive: true });
      const tmp = `${this.path}.tmp`;
      await writeFile(tmp, JSON.stringify({ account: key, data }), { mode: 0o600 });
      await rename(tmp, this.path);
    });
    this.writing = run.catch(() => {});
    return run;
  }
}

/**
 * The token store a CookidooClient uses, on top of the account entry.
 * @param {Store} store
 * @param {string} key
 */
export function tokenStore(store, key) {
  return {
    async load() {
      const entry = await store.get(key);
      return entry?.tokens ?? null;
    },
    async save(tokens) {
      await store.update(key, { tokens });
    },
  };
}

// -----------------------------------------------------------------------------
// The recipe pictures of the widget.
//
// The browser never loads a third-party URL and the core never fetches one:
// the content declares image keys, and the core asks the integration for the
// bytes (onWidgetGetImage). The registry remembers which picture each key of
// the last contents stands for; only Cookidoo's image CDN is fetched, at the
// small size its URL template offers (221 × 240), and checked against the
// core's bounds (PNG, JPEG or WebP, 300 KB) before it is handed over.
// -----------------------------------------------------------------------------

import { validateWidgetImage } from '@gladysassistant/integration-sdk';

const MAX_BYTES = 300 * 1024;
const MAX_KEYS = 200;
const ALLOWED_HOSTS = ['assets.tmecosys.com'];

export function createImageRegistry() {
  const urls = new Map();
  return {
    /** Remember the picture of a key (the most recent keys are kept). */
    register(key, url) {
      urls.delete(key);
      urls.set(key, url);
      if (urls.size > MAX_KEYS) {
        urls.delete(urls.keys().next().value);
      }
    },
    url(key) {
      return urls.get(key);
    },
  };
}

/**
 * The raw base64 of the picture of a key.
 * @param {ReturnType<typeof createImageRegistry>} registry
 * @param {string} key
 * @param {typeof fetch} fetchImpl
 * @param {string} userAgent
 */
export async function fetchWidgetImage(registry, key, fetchImpl, userAgent) {
  const raw = registry.url(key);
  if (!raw) {
    throw new Error(`unknown image key ${key}`);
  }
  const url = new URL(raw);
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.includes(url.hostname)) {
    throw new Error(`image host not allowed: ${url.hostname}`);
  }
  const response = await fetchImpl(url, {
    headers: { 'user-agent': userAgent, accept: 'image/webp,image/jpeg,image/png' },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    throw new Error(`image answered HTTP ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_BYTES) {
    throw new Error(`image too large (${Math.round(bytes.length / 1024)} KB)`);
  }
  const base64 = bytes.toString('base64');
  const problems = validateWidgetImage(base64);
  if (problems.length > 0) {
    throw new Error(`image refused: ${problems.join('; ')}`);
  }
  return base64;
}

// -----------------------------------------------------------------------------
// A small HTTP session for the Cookidoo login: fetch with a cookie jar and
// redirects followed by hand.
//
// The login hops between the identity provider (CIAM) pages, which keep their
// state in cookies; Node's fetch keeps none. Redirects are followed manually
// so that every hop stores its cookies, and so the last one — a redirect to
// the app scheme `com.vorwerk.cookidoo://`, which no client can open — can be
// read instead of followed.
//
// The jar is deliberately minimal: name/value per domain, Max-Age/Expires
// honored, path and flags ignored. It only lives for one login.
// -----------------------------------------------------------------------------

import { networkError } from './errors.js';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export class CookieJar {
  constructor() {
    /** @type {Map<string, { domain: string, hostOnly: boolean, value: string }>} */
    this.cookies = new Map();
  }

  /**
   * Store the cookies of a response.
   * @param {URL} url the URL that answered
   * @param {Headers} headers
   */
  store(url, headers) {
    const lines =
      typeof headers.getSetCookie === 'function'
        ? headers.getSetCookie()
        : [headers.get('set-cookie')].filter(Boolean);
    for (const line of lines) {
      const [pair, ...attributes] = line.split(';');
      const eq = pair.indexOf('=');
      if (eq <= 0) {
        continue;
      }
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      let domain = url.hostname;
      let hostOnly = true;
      let expired = false;
      for (const attribute of attributes) {
        const [rawKey, ...rest] = attribute.split('=');
        const key = rawKey.trim().toLowerCase();
        const attrValue = rest.join('=').trim();
        if (key === 'domain' && attrValue) {
          const candidate = attrValue.replace(/^\./, '').toLowerCase();
          // A server may only set a cookie for its own domain or a parent.
          if (url.hostname === candidate || url.hostname.endsWith(`.${candidate}`)) {
            domain = candidate;
            hostOnly = false;
          }
        } else if (key === 'max-age' && Number(attrValue) <= 0) {
          expired = true;
        } else if (key === 'expires' && Date.parse(attrValue) < Date.now()) {
          expired = true;
        }
      }
      const id = `${domain}|${name}`;
      if (expired) {
        this.cookies.delete(id);
      } else {
        this.cookies.set(id, { domain, hostOnly, value, name });
      }
    }
  }

  /**
   * The Cookie header for a URL, or undefined.
   * @param {URL} url
   */
  header(url) {
    const host = url.hostname;
    const pairs = [];
    for (const cookie of this.cookies.values()) {
      const matches = cookie.hostOnly
        ? host === cookie.domain
        : host === cookie.domain || host.endsWith(`.${cookie.domain}`);
      if (matches) {
        pairs.push(`${cookie.name}=${cookie.value}`);
      }
    }
    return pairs.length > 0 ? pairs.join('; ') : undefined;
  }
}

/**
 * One request through the jar, redirects NOT followed.
 * @param {typeof fetch} fetchImpl
 * @param {CookieJar} jar
 * @param {string | URL} target
 * @param {RequestInit & { timeoutMs?: number }} [init]
 * @returns {Promise<Response>}
 */
export async function jarFetch(fetchImpl, jar, target, init = {}) {
  const url = new URL(target);
  const headers = new Headers(init.headers);
  const cookie = jar.header(url);
  if (cookie) {
    headers.set('cookie', cookie);
  }
  let response;
  try {
    response = await fetchImpl(url, {
      ...init,
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(init.timeoutMs ?? 20000),
    });
  } catch (err) {
    // The URL is not repeated: the login ones carry the request state.
    throw networkError(`${url.hostname} unreachable (${err.cause?.code ?? err.message})`, {
      cause: err,
    });
  }
  jar.store(url, response.headers);
  return response;
}

/**
 * Follow the redirects of a request by hand, storing the cookies of every hop,
 * until a final answer — or a redirect to a location `stop` accepts, returned
 * unfollowed (the app scheme carrying the authorization code).
 * @param {typeof fetch} fetchImpl
 * @param {CookieJar} jar
 * @param {string} url
 * @param {RequestInit & { timeoutMs?: number }} init
 * @param {{ stop?: (location: string) => boolean, allow?: (url: URL) => boolean, maxHops?: number }} [options]
 * @returns {Promise<{ response: Response, url: URL, location?: string }>}
 */
export async function followRedirects(fetchImpl, jar, url, init, options = {}) {
  const { stop = () => false, allow = () => true, maxHops = 10 } = options;
  let current = new URL(url);
  let request = init;
  for (let hop = 0; hop <= maxHops; hop += 1) {
    const response = await jarFetch(fetchImpl, jar, current, request);
    const location = response.headers.get('location');
    if (!REDIRECT_STATUSES.has(response.status) || !location) {
      return { response, url: current };
    }
    if (stop(location)) {
      await response.body?.cancel();
      return { response, url: current, location };
    }
    await response.body?.cancel();
    const next = new URL(location, current);
    if (next.protocol !== 'https:' || !allow(next)) {
      // The hops carry the cookies of a login in progress: never to a
      // foreign host, never in clear text.
      throw networkError(`login redirected to an unexpected host (${next.hostname})`);
    }
    current = next;
    // A 303 (and, by browser custom, a 301/302 after a POST) becomes a GET.
    const keepMethod = response.status === 307 || response.status === 308;
    request = keepMethod ? request : { headers: request.headers, timeoutMs: request.timeoutMs };
  }
  throw networkError('login: too many redirects');
}

// -----------------------------------------------------------------------------
// Cookidoo sign-in: OAuth2 authorization code + PKCE against the Vorwerk
// identity provider (CIAM), as the Cookidoo mobile app does.
//
// Reimplemented in JavaScript from the protocol documented by the Python
// library cookidoo-api (miaucl/cookidoo-api, MIT), which the Home Assistant
// integration uses:
//
//   1. read the OpenID configuration of CIAM (authorize and token endpoints);
//   2. open the authorize endpoint: CIAM answers its login form, whose hidden
//      `requestId` ties the next step to this login;
//   3. post the e-mail and the password to the CIAM login service, follow the
//      redirects up to the app scheme, which carries the authorization code;
//   4. exchange the code for an access token (12 h) and a refresh token.
//
// The client is the app's PUBLIC client (`mobile-android`): PKCE replaces the
// client secret, nothing secret is embedded here (RFC 6749 §2.2: a client id
// is not a secret).
//
// No protection is worked around: the requests say who they are (the
// integration's own User-Agent, not a browser's), and a refusal of the robot
// (HTTP 403, a challenge page) or a step the integration cannot take stops
// the login with a clear error instead of being retried in a loop.
// -----------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';
import { CookieJar, followRedirects, jarFetch } from './http.js';
import { apiError, authError, blockedError, networkError } from './errors.js';

export const CIAM_BASE_URL = 'https://ciam.prod.cookidoo.vorwerk-digital.com';
export const OIDC_DISCOVERY_URL = `${CIAM_BASE_URL}/.well-known/openid-configuration`;
export const CIAM_LOGIN_URL = `${CIAM_BASE_URL}/login-srv/login`;
export const OAUTH_CLIENT_ID = 'mobile-android';
export const OAUTH_REDIRECT_URI = 'com.vorwerk.cookidoo://code-grant';
export const OAUTH_SCOPE = 'openid profile email offline offline_access';
/** Lifetime of an access token when the token endpoint does not say (12 h). */
const DEFAULT_EXPIRES_IN_S = 43200;

/** The hosts a login may visit: Vorwerk's own. */
const isVorwerkHost = (url) =>
  /(^|\.)vorwerk-digital\.com$/.test(url.hostname) || /(^|\.)vorwerk\.com$/.test(url.hostname);

/**
 * A PKCE S256 pair.
 * @returns {{ verifier: string, challenge: string }}
 */
export function pkcePair() {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/**
 * The `requestId` of the CIAM login form.
 * @param {string} html
 * @returns {string | null}
 */
export function extractRequestId(html) {
  const match =
    html.match(/<input[^>]*name=["']requestId["'][^>]*value=["']([^"']+)["']/i) ??
    html.match(/<input[^>]*value=["']([0-9a-f-]{36})["'][^>]*name=["']requestId["']/i);
  return match ? match[1] : null;
}

/** A page that asks for a human: a bot challenge. */
const looksLikeChallenge = (html) =>
  /captcha|cf-chl|challenge-platform|just a moment/i.test(html ?? '');

/**
 * Turn a token endpoint answer into the stored tokens.
 * @param {object} payload
 * @param {string | undefined} previousRefreshToken a refresh answer may omit a new one
 * @param {number} now ms
 */
export function tokensFromPayload(payload, previousRefreshToken, now) {
  const accessToken = payload?.access_token;
  if (typeof accessToken !== 'string' || accessToken === '') {
    throw apiError('unexpected token response');
  }
  const refreshToken =
    typeof payload.refresh_token === 'string' ? payload.refresh_token : previousRefreshToken;
  const expiresIn = Number(payload.expires_in);
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: now + (Number.isFinite(expiresIn) ? expiresIn : DEFAULT_EXPIRES_IN_S) * 1000,
  };
}

export class CookidooAuth {
  /**
   * @param {object} options
   * @param {typeof fetch} options.fetch
   * @param {string} options.userAgent
   * @param {() => number} [options.now]
   */
  constructor({ fetch: fetchImpl, userAgent, now = () => Date.now() }) {
    this.fetch = fetchImpl;
    this.userAgent = userAgent;
    this.now = now;
    this.oidc = null;
  }

  get headers() {
    return { 'user-agent': this.userAgent, accept: 'application/json' };
  }

  /** The authorize and token endpoints, read once. */
  async discovery() {
    if (this.oidc) {
      return this.oidc;
    }
    const response = await jarFetch(this.fetch, new CookieJar(), OIDC_DISCOVERY_URL, {
      headers: this.headers,
    });
    if (response.status === 403) {
      throw blockedError('Cookidoo refused the request (HTTP 403)', { status: 403 });
    }
    if (!response.ok) {
      throw networkError(`identity provider answered HTTP ${response.status}`, {
        status: response.status,
      });
    }
    const doc = await response.json().catch(() => null);
    if (
      typeof doc?.authorization_endpoint !== 'string' ||
      typeof doc?.token_endpoint !== 'string'
    ) {
      throw apiError('unexpected OpenID configuration');
    }
    this.oidc = { authorize: doc.authorization_endpoint, token: doc.token_endpoint };
    return this.oidc;
  }

  /**
   * Sign in with the e-mail and the password.
   * @param {{ email: string, password: string, country: string, language: string }} account
   * @returns {Promise<{ access_token: string, refresh_token?: string, expires_at: number }>}
   */
  async login({ email, password, country, language }) {
    const oidc = await this.discovery();
    const jar = new CookieJar();
    const { verifier, challenge } = pkcePair();
    const state = randomBytes(12).toString('base64url');
    const authorize = new URL(oidc.authorize);
    authorize.search = new URLSearchParams({
      response_type: 'code',
      client_id: OAUTH_CLIENT_ID,
      redirect_uri: OAUTH_REDIRECT_URI,
      market: country,
      scope: OAUTH_SCOPE,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      ui_locales: language,
    }).toString();

    // Step 2: the login form.
    const form = await followRedirects(
      this.fetch,
      jar,
      authorize,
      { headers: { ...this.headers, accept: 'text/html' } },
      { allow: isVorwerkHost },
    );
    const html = await form.response.text();
    if (form.response.status === 403 || looksLikeChallenge(html)) {
      throw blockedError('Cookidoo refused the sign-in of the integration (anti-robot check)', {
        status: form.response.status,
      });
    }
    if (!form.response.ok) {
      throw networkError(`login page answered HTTP ${form.response.status}`, {
        status: form.response.status,
      });
    }
    const requestId = extractRequestId(html);
    if (!requestId) {
      throw apiError('login page without requestId');
    }

    // Step 3: the credentials, then the redirects up to the app scheme.
    const submitted = await followRedirects(
      this.fetch,
      jar,
      CIAM_LOGIN_URL,
      {
        method: 'POST',
        headers: {
          ...this.headers,
          accept: 'text/html',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ requestId, username: email, password }).toString(),
      },
      {
        stop: (location) => location.startsWith(OAUTH_REDIRECT_URI),
        allow: isVorwerkHost,
      },
    );
    if (!submitted.location) {
      const page = await submitted.response.text().catch(() => '');
      if (submitted.response.status === 403 || looksLikeChallenge(page)) {
        throw blockedError('Cookidoo refused the sign-in of the integration (anti-robot check)', {
          status: submitted.response.status,
        });
      }
      // The login form again (wrong credentials), or a page asking for a
      // step only a person can take (new terms, an e-mail check).
      throw authError('sign-in refused: no authorization code returned');
    }
    const callback = new URL(submitted.location);
    if (callback.searchParams.get('state') !== state) {
      throw authError('sign-in refused: state mismatch');
    }
    const code = callback.searchParams.get('code');
    if (!code) {
      throw authError(`sign-in refused (${callback.searchParams.get('error') ?? 'no code'})`);
    }

    // Step 4: the tokens.
    return this.tokenRequest(
      oidc.token,
      {
        grant_type: 'authorization_code',
        code,
        redirect_uri: OAUTH_REDIRECT_URI,
        code_verifier: verifier,
        client_id: OAUTH_CLIENT_ID,
      },
      undefined,
    );
  }

  /**
   * A new access token from the refresh token.
   * @param {string} refreshToken
   */
  async refresh(refreshToken) {
    const oidc = await this.discovery();
    return this.tokenRequest(
      oidc.token,
      { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: OAUTH_CLIENT_ID },
      refreshToken,
    );
  }

  async tokenRequest(endpoint, form, previousRefreshToken) {
    const response = await jarFetch(this.fetch, new CookieJar(), endpoint, {
      method: 'POST',
      headers: { ...this.headers, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    });
    if (response.status === 403) {
      throw blockedError('Cookidoo refused the token request (HTTP 403)', { status: 403 });
    }
    if (response.status === 400 || response.status === 401) {
      // invalid_grant: the code or the refresh token is no longer valid.
      throw authError(`token refused (HTTP ${response.status})`, { status: response.status });
    }
    if (!response.ok) {
      throw networkError(`token endpoint answered HTTP ${response.status}`, {
        status: response.status,
      });
    }
    const payload = await response.json().catch(() => null);
    return tokensFromPayload(payload, previousRefreshToken, this.now());
  }
}

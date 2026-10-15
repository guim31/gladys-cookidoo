// -----------------------------------------------------------------------------
// The failures of the Cookidoo client, by what the user can do about them.
//
//   - auth     : the account refused the e-mail or the password, or asks for
//                a step the integration cannot take (new terms, a check by
//                e-mail): only the user can fix it, retrying is useless and
//                could lock the account;
//   - blocked  : the service refused the robot (HTTP 403, a challenge page):
//                the integration never works around a protection, it waits;
//   - network  : Cookidoo did not answer, or answered 5xx / 429: retry later;
//   - api      : Cookidoo answered something the integration does not
//                understand (an API change): needs an update of the code.
//
// The messages never carry a token, a password or a URL with a query string.
// -----------------------------------------------------------------------------

export class CookidooError extends Error {
  /**
   * @param {'auth' | 'blocked' | 'network' | 'api'} kind
   * @param {string} message
   * @param {{ status?: number, cause?: unknown }} [details]
   */
  constructor(kind, message, { status, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'CookidooError';
    this.kind = kind;
    this.status = status;
  }
}

export const authError = (message, details) => new CookidooError('auth', message, details);
export const blockedError = (message, details) => new CookidooError('blocked', message, details);
export const networkError = (message, details) => new CookidooError('network', message, details);
export const apiError = (message, details) => new CookidooError('api', message, details);

/**
 * The kind of any error: a CookidooError keeps its own, anything else (a bug,
 * a fetch that threw something unexpected) counts as a network failure.
 * @param {unknown} err
 * @returns {'auth' | 'blocked' | 'network' | 'api'}
 */
export function errorKind(err) {
  return err instanceof CookidooError ? err.kind : 'network';
}

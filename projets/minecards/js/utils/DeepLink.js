/**
 * DeepLink - Captures the `?Redeem=` personal-code link (step 10).
 *
 * Reference: `.docs/steps/10.md` point 4 and `.docs/gamemaster/useritemcode.md` section 1.
 *
 * A `index.html?Redeem={code}` URL must open the claim popup of the redeem view once the account is
 * ready. The parameter is therefore captured AS EARLY AS POSSIBLE (before the onboarding), stored in
 * `sessionStorage`, and removed from the address bar with `history.replaceState` so a reload never
 * replays it.
 *
 * `sessionStorage` is a deliberate, documented exception to "every state lives in IndexedDB"
 * (`main.md`): the value is transient, is deleted as soon as it is consumed, and must survive the
 * page reload that a `.save` import triggers (a personal code opened on a fresh device is imported
 * along with the save that restores its UUID). The code itself is never displayed and never logged.
 *
 * The Referer header is not a concern either: `index.html` declares `<meta name="referrer"
 * content="no-referrer">`.
 */

/** Query parameters accepted for a redeem deep link (first match wins). */
export const REDEEM_PARAMS = Object.freeze(['Redeem', 'redeem']);

/** `sessionStorage` key holding the captured code. */
export const PENDING_REDEEM_KEY = 'pendingRedeem';

/**
 * Reads the redeem parameter of a URL.
 *
 * @param {string} href - Full URL (or a bare `?Redeem=...` search string).
 * @returns {string|null} The trimmed code, or null when the URL carries none.
 */
export function readRedeemParam(href) {
  let params;
  try {
    params = new URL(href, 'http://localhost/').searchParams;
  } catch (error) {
    console.warn('[DeepLink] The location could not be parsed.', error);
    return null;
  }

  for (const name of REDEEM_PARAMS) {
    const value = params.get(name);
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }
  return null;
}

/**
 * Removes the redeem parameter from a URL string, keeping every other part untouched.
 *
 * @param {string} href - Full URL.
 * @returns {string} The cleaned URL.
 */
export function stripRedeemParam(href) {
  try {
    const url = new URL(href);
    REDEEM_PARAMS.forEach((name) => url.searchParams.delete(name));
    return url.href;
  } catch (error) {
    console.warn('[DeepLink] The location could not be cleaned.', error);
    return href;
  }
}

/**
 * Captures the deep link at boot: stores the code and cleans the address bar.
 *
 * Must be called before anything else renders, so a first-visit user keeps their pending code
 * through the onboarding.
 *
 * @param {object} [options] - Injection points (used by the tests).
 * @param {Location} [options.location=window.location] - Current location.
 * @param {History} [options.history=window.history] - Browser history.
 * @param {Storage} [options.storage=window.sessionStorage] - Transient storage.
 * @returns {string|null} The captured code, or null when the URL carried none.
 */
export function capturePendingRedeem({ location = globalThis.location, history = globalThis.history, storage = globalThis.sessionStorage } = {}) {
  if (!location || typeof location.href !== 'string') return null;

  const code = readRedeemParam(location.href);
  if (!code) return null;

  try {
    storage.setItem(PENDING_REDEEM_KEY, code);
  } catch (error) {
    console.warn('[DeepLink] The pending code could not be stored; the deep link is lost.', error);
    return null;
  }

  try {
    history.replaceState(history.state ?? null, '', stripRedeemParam(location.href));
  } catch (error) {
    // A refused `replaceState` (rare, sandboxed frame) is not fatal: the code is stored, a reload
    // would just replay it.
    console.warn('[DeepLink] The address bar could not be cleaned.', error);
  }

  console.info('[DeepLink] A redeem link was captured; it will be handled once the account is ready.');
  return code;
}

/**
 * Indicates whether a captured code is waiting.
 *
 * @param {Storage} [storage=window.sessionStorage] - Transient storage.
 * @returns {boolean} True when a code is pending.
 */
export function hasPendingRedeem(storage = globalThis.sessionStorage) {
  try {
    return typeof storage?.getItem(PENDING_REDEEM_KEY) === 'string';
  } catch (error) {
    console.warn('[DeepLink] The pending code could not be read.', error);
    return false;
  }
}

/**
 * Reads and clears the pending code (single consumption).
 *
 * @param {Storage} [storage=window.sessionStorage] - Transient storage.
 * @returns {string|null} The code, or null when none was waiting.
 */
export function consumePendingRedeem(storage = globalThis.sessionStorage) {
  try {
    const code = storage?.getItem(PENDING_REDEEM_KEY);
    if (typeof code !== 'string' || code.trim() === '') return null;
    storage.removeItem(PENDING_REDEEM_KEY);
    return code.trim();
  } catch (error) {
    console.warn('[DeepLink] The pending code could not be consumed.', error);
    return null;
  }
}

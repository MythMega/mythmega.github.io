/**
 * BinderCode - The share code of a binder.
 *
 * Reference: `.docs/main.md` section 3.H (binders), `js/business/BinderManager.js`.
 *
 * A binder is shared as a URL: `collection.html?code=<code>`. The code is the JSON payload of the
 * binder (author, name and the master fields of every card it shows) DEFLATED and encoded in
 * URL-safe Base64, exactly like a `.save` file is (`js/utils/Compression.js`): the payload of a
 * full page is a few kilobytes of very repetitive JSON, and deflate brings it back to about a
 * kilobyte, which is what keeps the link pasteable.
 *
 * Deliberately dependency-free and application-free, for two reasons:
 *   - it is shared by the game (`BinderManager.encodeShare`) and by the read-only page
 *     (`js/binder-share.js`), which must not pull the account, the collection or the database in;
 *   - a format is easier to keep compatible when nothing but the conversion lives in it.
 *
 * The page it opens is READ-ONLY by construction: nothing in the payload is ever written back, and
 * the page does not know the local account at all.
 */

import { deflate, inflate } from './Compression.js';
import { encodeBytesBase64Url, decodeBase64UrlBytes } from './BoosterCode.js';

/** Version stamped in a share code, so a future format can be recognised instead of misread. */
export const BINDER_CODE_VERSION = 1;

/** Name of the read-only page a share code opens. */
export const BINDER_SHARE_PAGE = 'collection.html';

/**
 * Encodes a binder payload into a share code.
 *
 * @param {object} payload - Payload built by `BinderManager.buildSharePayload()`.
 * @returns {Promise<string>} The URL-safe code.
 * @throws {Error} When the payload cannot be serialized or the runtime cannot deflate it.
 */
export async function encodeBinderPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TypeError('BinderCode.encodeBinderPayload expects a plain object.');
  }

  let json;
  try {
    json = JSON.stringify(payload);
  } catch (error) {
    throw new Error('The binder payload cannot be serialized to JSON.', { cause: error });
  }

  const bytes = new TextEncoder().encode(json);
  return encodeBytesBase64Url(await deflate(bytes));
}

/**
 * Decodes a share code back into its payload.
 *
 * @param {string} code - Share code (accepted with the surrounding whitespace).
 * @returns {Promise<object>} The payload.
 * @throws {TypeError} When the code is not a non-empty string.
 * @throws {Error} When the code is damaged or written in an unsupported version.
 */
export async function decodeBinderCode(code) {
  if (typeof code !== 'string' || code.trim() === '') {
    throw new TypeError('BinderCode.decodeBinderCode expects a non-empty code.');
  }

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(await inflate(decodeBase64UrlBytes(code))));
  } catch (error) {
    throw new Error('This binder code is unreadable or damaged.', { cause: error });
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('This binder code does not describe a binder.');
  }
  if (payload.v !== BINDER_CODE_VERSION) {
    throw new Error(
      `Unsupported binder code version (received: ${JSON.stringify(payload.v)}, expected ${BINDER_CODE_VERSION}).`
    );
  }
  return payload;
}

/**
 * Builds the absolute URL of a binder.
 *
 * The link always points at `collection.html`, next to the page it is built from, whatever the view
 * or the sub-directory the game is served from.
 *
 * @param {string} code - Share code.
 * @returns {string} The absolute URL, ready to copy.
 * @throws {TypeError} When the runtime exposes no `window.location`.
 */
export function buildBinderShareUrl(code) {
  if (typeof window === 'undefined' || !window.location) {
    throw new TypeError('BinderCode.buildBinderShareUrl requires a browser.');
  }
  const base = new URL('./', window.location.href);
  const url = new URL(BINDER_SHARE_PAGE, base);
  url.searchParams.set('code', code);
  return url.href;
}

/**
 * Reads the code of a URL.
 *
 * @param {string} [search=window.location.search] - Query string to read.
 * @returns {string} The code, or an empty string when the URL carries none.
 */
export function readBinderCodeFromUrl(search = typeof window === 'undefined' ? '' : window.location.search) {
  const params = new URLSearchParams(search);
  return params.get('code')?.trim() ?? '';
}

/**
 * BoosterCode - Encodes a just-opened booster into a very short, shareable code.
 *
 * Reference: step 11 (booster opening share code + `overlay.html`).
 *
 * FORMAT
 *   `minecards:<base64url>` where the Base64 payload is a compact BINARY record:
 *
 *     byte 0        version (BOOSTER_CODE_VERSION)
 *     byte 1        length L of the extension id
 *     bytes 2..2+L  extension id, ASCII (e.g. "A1")
 *     then, for each card, 2 bytes (big-endian) = the POSITION of the card in the booster's
 *     `Cards` array (`data/boosters/<setId>.json`). The number of cards is `(len - 2 - L) / 2`.
 *
 *   Nothing else is embedded: names, illustrations, rarity and the booster texture are all
 *   resolved by the overlay from the booster JSON, which keeps the code tiny.
 *
 * WHY POSITIONS AND NOT THE FULL DATA
 *   A 5-card pack is 2 + 2 + 5*2 = 14 bytes -> 19 Base64 characters, so the whole code
 *   (`minecards:` included) stays far below 150 characters. Embedding the card data (names in
 *   several languages, illustration paths, ...) produced a ~1.5 KB code.
 *
 * BASE64 VARIANT
 *   URL-safe alphabet (RFC 4648 §5: `+` -> `-`, `/` -> `_`, padding removed), so
 *   `?code=minecards:…` is copy-pasteable as-is. The decoder accepts both alphabets.
 *
 * The encoder throws only when a card cannot be located in the booster list (a programming
 * error); the overlay treats any invalid code as "display nothing".
 */

import { bytesToBase64, base64ToBytes } from './Compression.js';

/** Fixed prefix identifying a MineCards booster code. */
export const BOOSTER_CODE_PREFIX = 'minecards:';

/** Version of the binary payload, so a future change stays detectable. */
export const BOOSTER_CODE_VERSION = 2;

/** Maximum card position storable on two bytes. */
export const MAX_CARD_INDEX = 0xffff;

/**
 * Encodes bytes into URL-safe Base64 (no padding).
 *
 * @param {Uint8Array} bytes - Bytes to encode.
 * @returns {string} The URL-safe Base64 representation.
 */
export function encodeBytesBase64Url(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decodes a URL-safe Base64 string into bytes (also accepts the standard alphabet and whitespace).
 *
 * @param {string} value - Base64 text.
 * @returns {Uint8Array} The decoded bytes.
 * @throws {TypeError} When the argument is not a string.
 * @throws {Error} When the text is not valid Base64.
 */
export function decodeBase64UrlBytes(value) {
  if (typeof value !== 'string') {
    throw new TypeError(`BoosterCode.decodeBase64UrlBytes expects a string (received: ${typeof value}).`);
  }
  const normalized = value.trim().replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  return base64ToBytes(normalized);
}

/**
 * Builds the shareable code of an opened booster.
 *
 * @param {{setId: string, cards: Array}} result - Result returned by `BoosterManager.openBooster()`.
 * @param {{cards: Array}} set - Loaded extension, used to map each drawn card to its position in
 *   the booster `Cards` array.
 * @returns {string} The code, prefixed with `minecards:`.
 * @throws {TypeError} When the result carries no usable card list.
 * @throws {Error} When a drawn card is not part of the loaded booster.
 */
export function buildBoosterCode(result, set) {
  if (!result || !Array.isArray(result.cards)) {
    throw new TypeError('BoosterCode.buildBoosterCode expects an `openBooster()` result.');
  }
  const list = Array.isArray(set?.cards) ? set.cards : null;
  if (!list) {
    throw new Error('BoosterCode.buildBoosterCode requires the loaded booster set to resolve card positions.');
  }

  const setId = String(result.setId ?? '');
  if (setId === '' || setId.length > 255) {
    throw new Error(`BoosterCode cannot encode the extension id "${setId}".`);
  }

  const bytes = new Uint8Array(2 + setId.length + result.cards.length * 2);
  bytes[0] = BOOSTER_CODE_VERSION;
  bytes[1] = setId.length;
  for (let index = 0; index < setId.length; index += 1) {
    bytes[2 + index] = setId.charCodeAt(index) & 0xff;
  }

  let offset = 2 + setId.length;
  result.cards.forEach((card) => {
    const position = list.findIndex((candidate) => candidate.uniqueKey === card.uniqueKey);
    if (position < 0 || position > MAX_CARD_INDEX) {
      throw new Error(`Card "${card?.uniqueKey}" is not part of booster "${setId}".`);
    }
    bytes[offset] = (position >> 8) & 0xff;
    bytes[offset + 1] = position & 0xff;
    offset += 2;
  });

  return `${BOOSTER_CODE_PREFIX}${encodeBytesBase64Url(bytes)}`;
}

/**
 * Decodes a booster code into its compact description.
 *
 * Accepts a value with or without the `minecards:` prefix, for robustness when the player pasted
 * only the Base64 part.
 *
 * @param {string} code - The code to decode.
 * @returns {{version: number, setId: string, positions: number[]}} The decoded record.
 * @throws {TypeError} When the argument is not a string.
 * @throws {Error} When the code is not a valid, supported MineCards code.
 */
export function parseBoosterCode(code) {
  if (typeof code !== 'string') {
    throw new TypeError(`BoosterCode.parseBoosterCode expects a string (received: ${typeof code}).`);
  }
  const trimmed = code.trim();
  const raw = trimmed.startsWith(BOOSTER_CODE_PREFIX)
    ? trimmed.slice(BOOSTER_CODE_PREFIX.length)
    : trimmed;
  if (raw === '') {
    throw new Error('The booster code is empty.');
  }

  const bytes = decodeBase64UrlBytes(raw);
  if (bytes.length < 3) {
    throw new Error('The booster code is too short.');
  }
  const version = bytes[0];
  if (version !== BOOSTER_CODE_VERSION) {
    throw new Error(`Unsupported booster code version ${version}.`);
  }

  const idLength = bytes[1];
  if (bytes.length < 2 + idLength) {
    throw new Error('The booster code is truncated.');
  }
  const setId = String.fromCharCode(...bytes.subarray(2, 2 + idLength));

  const rest = bytes.subarray(2 + idLength);
  if (rest.length === 0 || rest.length % 2 !== 0) {
    throw new Error('The booster code card list is malformed.');
  }
  const positions = [];
  for (let index = 0; index < rest.length; index += 2) {
    positions.push((rest[index] << 8) | rest[index + 1]);
  }

  return { version, setId, positions };
}

export default buildBoosterCode;

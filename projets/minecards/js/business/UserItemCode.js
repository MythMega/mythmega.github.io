/**
 * UserItemCode - Verification of the personal `useritem` codes (step 10).
 *
 * Reference: `.docs/steps/10.md` and `.docs/gamemaster/useritemcode.md` (the algorithm, the binary
 * format and the test vectors are authoritative; this implementation follows them exactly).
 *
 * A `useritem` code is tied to ONE UUID, grants ONE item in a given quantity, and is consumed only
 * once. It is verified OFFLINE, in the browser, with the shared key `settings/config.json`
 * (`useritemCode.key`).
 *
 * FORMAT (20 bytes / 160 bits, Crockford Base32, displayed as 8 groups of 4)
 *   byte 0        version            = 0x01
 *   bytes 1-5     nonce              = 5 random bytes
 *   bytes 6-8     itemHash           = SHA-256(UTF-8(canonicalItem))[0..3]
 *   bytes 9-10    quantity           = uint16 big-endian
 *   bytes 11-12   uuidTag            = SHA-256(uuidBytes)[0..2]
 *   bytes 13-19   mac                = HMAC-SHA256(K, "UIC1" ‖ uuidBytes ‖ bytes[0..12])[0..7]
 *
 *   canonicalItem = `booster:<setId>` or `card:<Index>|<Layout>` (`Layout` lower-cased, exactly as
 *   written in the booster JSON).
 *
 * SECURITY MODEL (see the document; do not overclaim)
 *   `K` is served to the browser, so anyone able to read the sources can forge codes for any UUID.
 *   The system stops guessing a code, using another account's code, and tampering with the item or
 *   the quantity; it does NOT stop an attacker who extracts `K`, nor a local data wipe that resets
 *   the "once" rule. Acceptable for a game without stakes.
 *
 * LIMIT: `uuidTag` is only 16 bits. A code meant for another account passes the tag check once in
 * 65 536, then fails the MAC step with `invalid` instead of `wrong_user` — a wording difference
 * only.
 *
 * `crypto.subtle` (HMAC/SHA-256) requires a secure context (HTTPS or localhost).
 */

import { configLoader } from '../utils/ConfigLoader.js';

/** Crockford Base32 alphabet: no `I`, `L`, `O` nor `U`. */
export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Binary version tag of the format. */
export const USER_ITEM_VERSION = 0x01;

/** Payload size in bytes. */
export const USER_ITEM_BYTES = 20;

/** Normalized code length (characters). */
export const USER_ITEM_LENGTH = 32;

/** HMAC domain separator (4 ASCII bytes). */
export const USER_ITEM_CONTEXT = 'UIC1';

/** Statuses returned by `verify()` (the step spec's `status` set). */
export const USER_ITEM_STATUSES = Object.freeze({
  OK: 'ok',
  INVALID_FORMAT: 'invalid_format',
  WRONG_USER: 'wrong_user',
  INVALID: 'invalid',
  UNKNOWN_ITEM: 'unknown_item',
});

/** Test key from the document: 32 bytes `00 01 02 … 1f`. NEVER use it in production. */
export const TEST_KEY_HEX = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';

/** Test UUID from the document. */
export const TEST_UUID = '123e4567-e89b-12d3-a456-426614174000';

/** Second test UUID used by the `wrong_user` vector. */
export const TEST_OTHER_UUID = '00000000-0000-4000-8000-000000000000';

/**
 * Test vectors of `.docs/gamemaster/useritemcode.md` section 9.
 * `target` is the catalogue descriptor the item hash must resolve to.
 */
export const TEST_VECTORS = Object.freeze([
  Object.freeze({
    canonical: 'booster:A1',
    uuid: TEST_UUID,
    quantity: 3,
    nonceHex: '0102030405',
    itemHash: '058b97',
    bytesHex: '010102030405058b9700032065bc1f8d8b7e7c60',
    code: '040G-40R4-0M2R-Q5R0-0CG6-BF0Z-HP5Q-WZ30',
    target: Object.freeze({ type: 'booster', setId: 'A1' }),
  }),
  Object.freeze({
    canonical: 'card:SERIE-A1 / P004|fullart',
    uuid: TEST_UUID,
    quantity: 1,
    nonceHex: 'a1b2c3d4e5',
    itemHash: 'b75d84',
    bytesHex: '01a1b2c3d4e5b75d8400012065e1c817d43eb5f8',
    code: '06GV-5GYM-WPVN-V100-04G6-BRE8-2ZA3-XDFR',
    target: Object.freeze({ type: 'card', card: Object.freeze({ uniqueKey: 'SERIE-A1 _ P004_fullart' }) }),
  }),
]);

/** Vector of section 9 proving two accounts never share a valid code. */
export const TEST_OTHER_UUID_VECTOR = Object.freeze({
  canonical: 'booster:A1',
  uuid: TEST_OTHER_UUID,
  quantity: 3,
  itemHash: '058b97',
  bytesHex: '010102030405058b9700039318a069dae05e8d8b',
  code: '040G-40R4-0M2R-Q5R0-0E9H-H839-VBG5-X3CB',
});

/** Builds the canonical item string of an extension reward. */
export function canonicalBooster(setId) {
  return `booster:${String(setId).trim()}`;
}

/** Builds the canonical item string of a card reward (`Layout` lower-cased). */
export function canonicalCard(index, layout) {
  return `card:${String(index).trim()}|${String(layout).trim().toLowerCase()}`;
}

/**
 * Error raised when the verification cannot run at all (missing key, unusable UUID, no table).
 */
export class UserItemCodeError extends Error {
  /**
   * @param {string} message - Technical description.
   * @param {object} [options] - Standard `Error` options (`cause`).
   */
  constructor(message, options = undefined) {
    super(message, options);
    this.name = 'UserItemCodeError';
  }
}

export class UserItemCode {
  constructor() {
    /** @type {Uint8Array|null} Cached shared key. */
    this.cachedKey = null;
    /** @type {WeakMap<object, Map<string, object[]>>} Item-hash index per catalogue array. */
    this.hashCache = new WeakMap();
  }

  /**
   * Normalizes a player input: upper-cases, removes `-` and whitespace, maps the Crockford
   * look-alikes `O→0`, `I→1` and `L→1`.
   *
   * @param {unknown} raw - Raw value.
   * @returns {string} The normalized code (empty string when unusable).
   */
  static normalize(raw) {
    if (typeof raw !== 'string') return '';
    return raw
      .toUpperCase()
      .replace(/[\s-]+/g, '')
      .replace(/O/g, '0')
      .replace(/[IL]/g, '1');
  }

  /**
   * Checks whether a value, once normalized, has the length of a `useritem` code.
   *
   * The length (32 characters) is the ONLY signal available: the payload carries no marker, so it
   * is what decides that a typed value must be checked as a personal code. A wrong character is
   * then reported by `verify()` as `invalid_format`, exactly as the algorithm document requires
   * ("length != 32 or a character outside the alphabet, including `U`, gives `invalid_format`").
   *
   * @param {unknown} raw - Raw value.
   * @returns {boolean} True when the value has the personal-code length.
   */
  static hasCodeLength(raw) {
    return UserItemCode.normalize(raw).length === USER_ITEM_LENGTH;
  }

  /**
   * Encodes bytes into Crockford Base32 (no padding). Used by the tests to build crafted codes.
   *
   * @param {Uint8Array} bytes - Bytes to encode.
   * @returns {string} The Base32 text.
   * @throws {TypeError} When the argument is not a byte array.
   */
  static encode(bytes) {
    if (!(bytes instanceof Uint8Array)) {
      throw new TypeError('UserItemCode.encode expects a Uint8Array.');
    }

    let bits = 0;
    let value = 0;
    let out = '';
    for (const byte of bytes) {
      value = (value << 8) | byte;
      bits += 8;
      while (bits >= 5) {
        bits -= 5;
        out += CROCKFORD_ALPHABET[(value >>> bits) & 31];
      }
      value &= (1 << bits) - 1;
    }
    return out;
  }

  /**
   * Decodes a normalized Crockford Base32 text into bytes.
   *
   * @param {string} normalized - Normalized text (32 characters).
   * @returns {Uint8Array|null} The 20 bytes, or null when a character is out of the alphabet.
   */
  static decode(normalized) {
    let bits = 0;
    let value = 0;
    const out = [];

    for (const character of normalized) {
      const index = CROCKFORD_ALPHABET.indexOf(character);
      if (index === -1) return null;

      value = (value << 5) | index;
      bits += 5;
      if (bits >= 8) {
        bits -= 8;
        out.push((value >>> bits) & 0xff);
      }
      value &= (1 << bits) - 1;
    }

    return out.length === USER_ITEM_BYTES ? Uint8Array.from(out) : null;
  }

  /**
   * Converts a byte array to a lowercase hex string.
   *
   * @param {Uint8Array} bytes - Bytes to format.
   * @returns {string} The hex string.
   */
  static toHex(bytes) {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Parses a hex string into bytes.
   *
   * @param {string} hex - Hex text (even length).
   * @returns {Uint8Array} The bytes.
   * @throws {TypeError} When the text is not valid hex.
   */
  static fromHex(hex) {
    const text = String(hex).trim();
    if (!/^[0-9a-fA-F]*$/.test(text) || text.length % 2 !== 0) {
      throw new TypeError(`UserItemCode.fromHex expects an even-length hex string (received: ${JSON.stringify(hex)}).`);
    }
    const bytes = new Uint8Array(text.length / 2);
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Number.parseInt(text.slice(index * 2, index * 2 + 2), 16);
    }
    return bytes;
  }

  /**
   * Converts a UUID into its 16 raw bytes.
   *
   * @param {unknown} uuid - UUID string (case-insensitive, dashes required or not).
   * @returns {Uint8Array|null} The 16 bytes, or null when the value is not a UUID.
   */
  static uuidToBytes(uuid) {
    if (typeof uuid !== 'string') return null;
    const hex = uuid.replace(/-/g, '').trim();
    if (!/^[0-9a-fA-F]{32}$/.test(hex)) return null;
    return UserItemCode.fromHex(hex);
  }

  /**
   * Reads the base64 shared key.
   *
   * @param {unknown} base64 - Base64 text.
   * @returns {Uint8Array} The decoded bytes.
   * @throws {UserItemCodeError} When the value is not valid base64.
   */
  static base64ToBytes(base64) {
    try {
      const binary = atob(String(base64));
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return bytes;
    } catch (error) {
      throw new UserItemCodeError('The "useritemCode.key" is not valid base64.', { cause: error });
    }
  }

  /**
   * SHA-256 digest of a payload.
   *
   * @param {Uint8Array} bytes - Payload.
   * @returns {Promise<Uint8Array>} The 32-byte digest.
   * @throws {UserItemCodeError} When `crypto.subtle` is unavailable (insecure context).
   */
  static async sha256(bytes) {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) {
      throw new UserItemCodeError('crypto.subtle is unavailable: a secure context (HTTPS or localhost) is required.');
    }
    return new Uint8Array(await subtle.digest('SHA-256', bytes));
  }

  /**
   * HMAC-SHA256 of the MAC payload.
   *
   * @param {Uint8Array} keyBytes - 32-byte shared key.
   * @param {Uint8Array} uuidBytes - 16 UUID bytes.
   * @param {Uint8Array} head - First 13 bytes of the code.
   * @returns {Promise<Uint8Array>} The 32-byte digest (callers keep the first 7 bytes).
   * @throws {UserItemCodeError} When `crypto.subtle` is unavailable.
   */
  static async computeMac(keyBytes, uuidBytes, head) {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) {
      throw new UserItemCodeError('crypto.subtle is unavailable: a secure context (HTTPS or localhost) is required.');
    }

    const key = await subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const context = new TextEncoder().encode(USER_ITEM_CONTEXT);
    const payload = new Uint8Array(context.length + uuidBytes.length + head.length);
    payload.set(context, 0);
    payload.set(uuidBytes, context.length);
    payload.set(head, context.length + uuidBytes.length);
    return new Uint8Array(await subtle.sign('HMAC', key, payload));
  }

  /**
   * Compares two byte arrays in constant time (no early exit).
   *
   * @param {Uint8Array} left - First array.
   * @param {Uint8Array} right - Second array.
   * @returns {boolean} True when both have the same length and content.
   */
  static constantTimeEqual(left, right) {
    if (left.length !== right.length) return false;
    let difference = 0;
    for (let index = 0; index < left.length; index += 1) {
      difference |= left[index] ^ right[index];
    }
    return difference === 0;
  }

  /**
   * Item hash (3 bytes) of a canonical item, as used in byte 6-8.
   *
   * @param {string} canonical - Canonical item string.
   * @returns {Promise<string>} The lowercase hex of `SHA-256(canonical)[0..3]`.
   */
  static async itemHash(canonical) {
    const digest = await UserItemCode.sha256(new TextEncoder().encode(canonical));
    return UserItemCode.toHex(digest.subarray(0, 3));
  }

  /**
   * Loads (and caches) the shared key from `settings/config.json`.
   *
   * @param {object} [options] - Load options.
   * @param {boolean} [options.force=false] - Re-read the configuration.
   * @returns {Promise<Uint8Array>} The 32-byte key.
   * @throws {UserItemCodeError} When the key is missing or not 32 bytes long.
   */
  async loadKey({ force = false } = {}) {
    if (this.cachedKey && !force) return this.cachedKey;

    const { key } = await configLoader.getUserItemCode();
    if (!key) {
      throw new UserItemCodeError('settings/config.json declares no "useritemCode.key": personal codes cannot be verified.');
    }
    const bytes = UserItemCode.base64ToBytes(key);
    if (bytes.length !== 32) {
      throw new UserItemCodeError(
        `The "useritemCode.key" must decode to exactly 32 bytes (received: ${bytes.length}).`
      );
    }
    this.cachedKey = bytes;
    return bytes;
  }

  /**
   * Drops the cached key and item index (used by the tests and a configuration reload).
   *
   * @returns {void}
   */
  reset() {
    this.cachedKey = null;
    this.hashCache = new WeakMap();
  }

  /**
   * Builds (and caches) the `itemHash -> targets[]` index of a catalogue.
   *
   * Built on demand: a catalogue is only hashed the first time a personal code is verified.
   *
   * @param {Array<{canonical: string, target: object}>} catalog - Catalogue descriptors.
   * @returns {Promise<Map<string, object[]>>} The index, keyed by the 3-byte hex hash.
   * @throws {TypeError} When the catalogue is not an array of `{ canonical, target }`.
   */
  async buildIndex(catalog) {
    if (!Array.isArray(catalog)) {
      throw new TypeError('UserItemCode.buildIndex expects an array of { canonical, target }.');
    }

    const cached = this.hashCache.get(catalog);
    if (cached) return cached;

    const index = new Map();
    for (const entry of catalog) {
      if (!entry || typeof entry.canonical !== 'string' || entry.canonical.trim() === '') {
        throw new TypeError('Every catalogue entry must expose a non-empty "canonical" string.');
      }
      if (!entry.target || typeof entry.target !== 'object') {
        throw new TypeError(`The catalogue entry "${entry.canonical}" has no "target".`);
      }

      const hash = await UserItemCode.itemHash(entry.canonical);
      const list = index.get(hash) ?? [];
      list.push(entry.target);
      index.set(hash, list);
    }

    this.hashCache.set(catalog, index);
    return index;
  }

  /**
   * Verifies a personal code against an account UUID and a catalogue.
   *
   * No storage access: the "already used" rule is the caller's responsibility
   * (`RedeemManager` checks `redeemed_codes` with the returned `storeKey`).
   *
   * @param {string} raw - Raw code typed by the player or read from the URL.
   * @param {string} uuid - UUID of the current account.
   * @param {Array<{canonical: string, target: object}>} catalog - Catalogue of the known items.
   * @param {object} [options] - Verification options.
   * @param {Uint8Array} [options.key] - Shared key override (tests); the configured key is used by
   *   default.
   * @returns {Promise<{status: string, rewards?: object[], storeKey?: string}>} The result:
   *   `{ status: 'ok', rewards, storeKey }`, or a status-only `invalid_format`, `wrong_user`,
   *   `invalid`, `unknown_item`.
   * @throws {UserItemCodeError} When the key is unusable or `crypto.subtle` is unavailable.
   */
  async verify(raw, uuid, catalog, { key = null } = {}) {
    const normalized = UserItemCode.normalize(raw);
    if (normalized.length !== USER_ITEM_LENGTH) {
      return { status: USER_ITEM_STATUSES.INVALID_FORMAT };
    }

    const bytes = UserItemCode.decode(normalized);
    if (!bytes) {
      return { status: USER_ITEM_STATUSES.INVALID_FORMAT };
    }
    if (bytes[0] !== USER_ITEM_VERSION) {
      return { status: USER_ITEM_STATUSES.INVALID_FORMAT };
    }

    const uuidBytes = UserItemCode.uuidToBytes(uuid);
    if (!uuidBytes) {
      throw new UserItemCodeError(`The account UUID "${uuid}" is invalid: a personal code cannot be verified.`);
    }

    // 3. The 16-bit UUID tag is checked first so a foreign code is reported as `wrong_user` (the
    //    1/65536 miss falls through to the MAC check, reported as `invalid`).
    const expectedTag = (await UserItemCode.sha256(uuidBytes)).subarray(0, 2);
    if (!UserItemCode.constantTimeEqual(bytes.subarray(11, 13), expectedTag)) {
      return { status: USER_ITEM_STATUSES.WRONG_USER };
    }

    // 4. MAC over "UIC1" ‖ uuidBytes ‖ bytes[0..12], compared in constant time.
    const keyBytes = key ?? (await this.loadKey());
    const mac = await UserItemCode.computeMac(keyBytes, uuidBytes, bytes.subarray(0, 13));
    if (!UserItemCode.constantTimeEqual(bytes.subarray(13, 20), mac.subarray(0, 7))) {
      return { status: USER_ITEM_STATUSES.INVALID };
    }

    const quantity = (bytes[9] << 8) | bytes[10];
    if (quantity < 1) {
      // A well-formed code always carries a positive quantity: zero grants nothing and only a
      // crafted payload reaches this point.
      return { status: USER_ITEM_STATUSES.INVALID };
    }

    // 5. Item resolution: exactly one catalogue entry must carry the hash, otherwise the code is
    //    refused WITHOUT being consumed so a later catalogue update can still honour it.
    const hash = UserItemCode.toHex(bytes.subarray(6, 9));
    const index = await this.buildIndex(catalog);
    const matches = index.get(hash) ?? [];
    if (matches.length !== 1) {
      return { status: USER_ITEM_STATUSES.UNKNOWN_ITEM };
    }

    const target = matches[0];
    const reward = target.type === 'booster'
      ? { type: 'booster', key: target.setId, quantity, card: null }
      : { type: 'card', key: target.card.uniqueKey, quantity, card: target.card };

    return { status: USER_ITEM_STATUSES.OK, rewards: [reward], storeKey: normalized };
  }

  /**
   * Replays the document test vectors. Meant for the console (dev) and the unit harness.
   *
   * @param {object} [options] - Test options.
   * @param {string} [options.keyHex=TEST_KEY_HEX] - Hex test key (NEVER the production key).
   * @returns {Promise<{passed: boolean, checks: number, failures: string[]}>} The report.
   */
  async selfTest({ keyHex = TEST_KEY_HEX } = {}) {
    const key = UserItemCode.fromHex(keyHex);
    const failures = [];
    let checks = 0;

    const check = (label, condition) => {
      checks += 1;
      if (!condition) failures.push(label);
    };

    const catalog = TEST_VECTORS.map((vector) => ({ canonical: vector.canonical, target: vector.target }));

    for (const vector of TEST_VECTORS) {
      check(
        `decode ${vector.canonical}`,
        UserItemCode.toHex(UserItemCode.decode(UserItemCode.normalize(vector.code))) === vector.bytesHex
      );
      check(`itemHash ${vector.canonical}`, (await UserItemCode.itemHash(vector.canonical)) === vector.itemHash);

      const result = await this.verify(vector.code, vector.uuid, catalog, { key });
      check(`verify ${vector.canonical}`, result.status === USER_ITEM_STATUSES.OK);
      check(`quantity ${vector.canonical}`, result.rewards?.[0]?.quantity === vector.quantity);
      check(`reward ${vector.canonical}`, result.rewards?.[0]?.type === vector.target.type);
      check(`storeKey ${vector.canonical}`, result.storeKey === UserItemCode.normalize(vector.code));

      // The second vector belongs to the same account, so a `wrong_user` test needs the other UUID.
      const otherUuid = vector.uuid === TEST_UUID ? TEST_OTHER_UUID : TEST_UUID;
      const foreign = await this.verify(vector.code, otherUuid, catalog, { key });
      check(`wrong_user ${vector.canonical}`, foreign.status === USER_ITEM_STATUSES.WRONG_USER);
    }

    // Two accounts never share a valid code (document section 9).
    check(
      'foreign vector bytes',
      UserItemCode.toHex(UserItemCode.decode(UserItemCode.normalize(TEST_OTHER_UUID_VECTOR.code))) ===
        TEST_OTHER_UUID_VECTOR.bytesHex
    );
    check(
      'foreign vector wrong_user',
      (await this.verify(TEST_OTHER_UUID_VECTOR.code, TEST_UUID, catalog, { key })).status ===
        USER_ITEM_STATUSES.WRONG_USER
    );
    check(
      'foreign vector ok for its own account',
      (await this.verify(TEST_OTHER_UUID_VECTOR.code, TEST_OTHER_UUID, catalog, { key })).status ===
        USER_ITEM_STATUSES.OK
    );

    // Lenient input: lowercase, no dashes, Crockford look-alikes.
    const primary = TEST_VECTORS[0];
    const lenient = primary.code.toLowerCase().replace(/-/g, '').replace(/0/g, 'O');
    check('lenient input accepted', (await this.verify(lenient, primary.uuid, catalog, { key })).status === USER_ITEM_STATUSES.OK);

    // One altered character invalidates the MAC.
    const tampered = `${primary.code.slice(0, -1)}${primary.code.endsWith('0') ? '1' : '0'}`;
    check('tampered code invalid', (await this.verify(tampered, primary.uuid, catalog, { key })).status === USER_ITEM_STATUSES.INVALID);

    // Structural refusals.
    check('short code invalid_format', (await this.verify(primary.code.slice(0, 31), primary.uuid, catalog, { key })).status === USER_ITEM_STATUSES.INVALID_FORMAT);
    check('forbidden char invalid_format', (await this.verify(`${primary.code.slice(0, 31)}U`, primary.uuid, catalog, { key })).status === USER_ITEM_STATUSES.INVALID_FORMAT);

    const wrongVersion = Uint8Array.from(UserItemCode.fromHex(primary.bytesHex));
    wrongVersion[0] = 0x02;
    const wrongVersionCode = UserItemCode.encode(wrongVersion);
    check('unknown version invalid_format', (await this.verify(wrongVersionCode, primary.uuid, catalog, { key })).status === USER_ITEM_STATUSES.INVALID_FORMAT);

    // Unknown item: hash resolves to nothing.
    check('unknown item', (await this.verify(primary.code, primary.uuid, [], { key })).status === USER_ITEM_STATUSES.UNKNOWN_ITEM);

    // Item-hash collision: two catalogue entries sharing the same hash must refuse the code.
    const collision = [
      { canonical: primary.canonical, target: primary.target },
      { canonical: primary.canonical, target: primary.target },
    ];
    check('ambiguous item hash refused', (await this.verify(primary.code, primary.uuid, collision, { key })).status === USER_ITEM_STATUSES.UNKNOWN_ITEM);

    return { passed: failures.length === 0, checks, failures };
  }
}

/** Shared instance used by `RedeemManager`. */
export const userItemCode = new UserItemCode();

export default userItemCode;

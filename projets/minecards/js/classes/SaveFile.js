/**
 * SaveFile - Export and import of the `.save` backup container.
 *
 * Reference: `.docs/steps/6.md` point 2 and `.docs/main.md` section 3.G.
 *
 * FORMAT (version 1)
 *   `backup_cards_YYYY-MM-DD.save`, a Base64 encoded `deflate` stream (see
 *   `js/utils/Compression.js`) of:
 *   {
 *     version: 1,
 *     exportedAt: "2026-10-07T12:00:00.000Z",
 *     stores: {
 *       collection:      [ { key, cardId, style, set, quantity, firstObtainedAt, lastObtainedAt }, … ],
 *       user_state:      { account, settings, quota, timeAnchor, stats, giftSync },
 *       redeemed_codes:  [ { code, redeemedAt }, … ],
 *       gifts_received:  [ { line, uuid, type, key, quantity, receivedAt }, … ]
 *     }
 *   }
 *
 *   `user_state` is exported as an object (key -> value) even though the IndexedDB store uses
 *   out-of-line keys: `getAllKeys()` is read alongside `getAll()`, so every state key is
 *   preserved. The UUID, the settings, the quota, the statistics, the gift sync cursor and the
 *   gift history are therefore all part of a save.
 *
 * VALIDATION POLICY
 *   The identity is validated strictly: `version` must be the supported one, every store must be
 *   present with the expected container type, and `user_state.account.uuid` must be a v4 UUID
 *   (the restored UUID becomes the account again, so a save cannot be accepted without it).
 *   The state itself is validated for its container type, with the scalar fields that drive the
 *   counters (quota, stats, gift sync) checked when present; the owning managers normalize a
 *   repaired copy at boot (`DateSyncManager.normalizeQuota`, `BoosterManager.normalizeStats`,
 *   `AccountManager.getSettings`). This keeps an old save importable after a schema tweak while
 *   still refusing a corrupted or truncated file.
 *
 * IMPORT
 *   The database is overwritten in a single readwrite transaction, so an invalid save leaves the
 *   current data untouched. `EVENTS.SAVE_IMPORTED` is emitted right before the swap: the
 *   application releases its in-memory state (time anchor, views) at that point. The page is then
 *   reloaded, because the UUID and every cached value changed.
 */

import { storageRepository, StorageRepository, STORES } from '../models/StorageRepository.js';
import { USER_STATE_KEYS, isUuid } from '../business/AccountManager.js';
import { compressJson, decompressJson, SAVE_MIME_TYPE } from '../utils/Compression.js';
import eventBus, { EVENTS } from '../utils/EventBus.js';

/** Container format version. Bump it when the payload shape changes incompatibly. */
export const SAVE_VERSION = 1;

/** File extension of a save. */
export const SAVE_EXTENSION = '.save';

/** Prefix of the generated file name: `backup_cards_[DATE].save`. */
export const SAVE_FILENAME_PREFIX = 'backup_cards';

/** Maximum size of an imported file, in bytes (32 MiB). A larger file is refused before reading it. */
export const MAX_SAVE_BYTES = 32 * 1024 * 1024;

/** Object stores carried by a save, in transaction order. */
export const SAVE_STORES = Object.freeze([
  STORES.COLLECTION,
  STORES.USER_STATE,
  STORES.REDEEMED_CODES,
  STORES.GIFTS_RECEIVED,
]);

/** `user_state` keys that must exist in a valid save. `timeAnchor` stays optional. */
export const REQUIRED_USER_STATE_KEYS = Object.freeze([
  USER_STATE_KEYS.ACCOUNT,
  USER_STATE_KEYS.SETTINGS,
  USER_STATE_KEYS.QUOTA,
  USER_STATE_KEYS.STATS,
  USER_STATE_KEYS.GIFT_SYNC,
]);

/**
 * Error codes thrown by `SaveFile`, mapped to translation keys by `getSaveErrorMessageKey()`.
 * The code values are the suffixes of the `save.error.*` i18n keys.
 */
export const SAVE_ERROR_CODES = Object.freeze({
  INVALID_FORMAT: 'invalidFormat',
  UNSUPPORTED_VERSION: 'unsupportedVersion',
  INVALID_STRUCTURE: 'invalidStructure',
  INVALID_ACCOUNT: 'invalidAccount',
  FILE_TOO_LARGE: 'fileTooLarge',
  UNKNOWN: 'unknown',
});

/**
 * Error raised by the save subsystem.
 *
 * `code` is stable (one of `SAVE_ERROR_CODES`) so the UI can translate the failure without
 * parsing a message.
 */
export class SaveFileError extends Error {
  /**
   * @param {string} code - One of `SAVE_ERROR_CODES`.
   * @param {string} message - Technical description (logged, not shown to the player).
   * @param {object} [options] - Standard `Error` options (`cause`).
   */
  constructor(code, message, options = undefined) {
    super(message, options);
    this.name = 'SaveFileError';
    this.code = code;
  }
}

/**
 * Resolves the i18n key describing a save failure.
 *
 * Shared by the onboarding screen and the settings view, so both report the same wording.
 *
 * @param {unknown} error - Error thrown by `SaveFile`.
 * @returns {string} A `save.error.*` translation key.
 */
export function getSaveErrorMessageKey(error) {
  const code = error instanceof SaveFileError ? error.code : SAVE_ERROR_CODES.UNKNOWN;
  return `save.error.${code}`;
}

/**
 * Checks whether a value is a plain object (not null, not an array).
 *
 * @param {unknown} value - Candidate value.
 * @returns {boolean} True for `{}` shaped objects.
 */
export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class SaveFile {
  /**
   * Builds the save payload from the live database.
   *
   * @returns {Promise<object>} `{ version, exportedAt, stores }` (not validated by the caller:
   *   the data comes from our own stores).
   * @throws {Error} When a store cannot be read or when the transaction fails.
   */
  async createSavePayload() {
    const stores = await this.collectStores();
    return {
      version: SAVE_VERSION,
      // Informational metadata only: like `account.createdAt`, this timestamp comes from the
      // system clock and is never used by the quota or the anti-cheat logic.
      exportedAt: new Date().toISOString(),
      stores,
    };
  }

  /**
   * Builds the `.save` file content (compressed and Base64 encoded).
   *
   * @param {object} [options] - Build options.
   * @param {string|null} [options.day=null] - `YYYY-MM-DD` day used in the file name, ideally the
   *   trusted UTC day (`DateSyncManager.getCurrentUtcDay()`); the system UTC day is used when
   *   absent. The day is cosmetic metadata: nothing is read back from the file name.
   * @returns {Promise<{filename: string, content: string, byteLength: number, payload: object}>}
   *   The file name, the Base64 content, the content size in bytes (Base64 is ASCII, so the
   *   character count is the byte count) and the source payload.
   * @throws {Error} When the database cannot be read or compression fails.
   */
  async createSaveFile({ day = null } = {}) {
    const payload = await this.createSavePayload();
    const content = await compressJson(payload);
    return {
      filename: SaveFile.buildFilename(day),
      content,
      byteLength: content.length,
      payload,
    };
  }

  /**
   * Exports the current database as a downloaded `.save` file.
   *
   * @param {object} [options] - Export options.
   * @param {string|null} [options.day=null] - Day used in the file name (see `createSaveFile`).
   * @returns {Promise<{filename: string, byteLength: number}>} The exported file description.
   * @throws {Error} When the database cannot be read, compression fails, or the download cannot
   *   be triggered.
   */
  async export({ day = null } = {}) {
    const file = await this.createSaveFile({ day });
    this.triggerDownload(file.filename, file.content);
    console.info(`[SaveFile] Exported "${file.filename}" (${file.byteLength} characters).`);
    return { filename: file.filename, byteLength: file.byteLength };
  }

  /**
   * Imports a `.save` file: decompresses it, validates it, then replaces the whole database.
   *
   * A single readwrite transaction clears the four stores and writes the imported records, so a
   * failure at any point leaves the previous data untouched (`StorageRepository.transaction`
   * aborts on error). When the replacement is committed, the page is reloaded: the UUID, the
   * quota, the settings and every view depend on the new data and must be rebuilt from scratch.
   *
   * @param {File|Blob} file - Selected `.save` file.
   * @param {object} [options] - Import options.
   * @param {boolean} [options.reload=true] - Reload the page once the database was replaced.
   *   Only a caller that manages the whole in-memory state itself should disable it.
   * @returns {Promise<{uuid: string, counts: Record<string, number>}>} The restored UUID and the
   *   number of records written per store (resolved only when `reload` is false).
   * @throws {TypeError} When the argument is not a readable file.
   * @throws {SaveFileError} When the file is too large, not a `.save` container, of an
   *   unsupported version, structurally invalid, or without a valid account UUID.
   * @throws {Error} When the database cannot be written.
   */
  async importFromFile(file, { reload = true } = {}) {
    const text = await this.readFileText(file);

    let payload;
    try {
      payload = await decompressJson(text);
    } catch (error) {
      throw new SaveFileError(
        SAVE_ERROR_CODES.INVALID_FORMAT,
        'The selected file is not a readable .save container.',
        { cause: error }
      );
    }

    const stores = this.validateSavePayload(payload);
    const uuid = stores[STORES.USER_STATE][USER_STATE_KEYS.ACCOUNT].uuid;

    // The database is about to change identity: the time anchor and the views built from the
    // previous account must be released first (see `app.js`).
    eventBus.emit(EVENTS.SAVE_IMPORTED, { uuid });

    const counts = await this.writeStores(stores);
    console.info(`[SaveFile] Imported the save of account "${uuid}".`, counts);

    if (reload) {
      window.location.reload();
    }
    return { uuid, counts };
  }

  /**
   * Reads every store of the database into the save payload shape.
   *
   * `user_state` is read with its keys (`getAllKeys()`), because the store uses out-of-line keys
   * and `getAll()` alone would lose them. Both requests run in the same transaction, so the
   * keys and the values are guaranteed to describe the same snapshot.
   *
   * @returns {Promise<object>} The `stores` object of a save payload.
   * @throws {Error} When a read fails.
   */
  async collectStores() {
    return storageRepository.transaction(SAVE_STORES, 'readonly', async (context) => {
      const collection = await context.getAll(STORES.COLLECTION);
      const redeemedCodes = await context.getAll(STORES.REDEEMED_CODES);
      const giftsReceived = await context.getAll(STORES.GIFTS_RECEIVED);

      const userStateKeys = await StorageRepository.wrapRequest(
        context.store(STORES.USER_STATE).getAllKeys(),
        'user_state.getAllKeys'
      );
      const userStateValues = await context.getAll(STORES.USER_STATE);
      const userState = {};
      userStateKeys.forEach((key, index) => {
        userState[String(key)] = userStateValues[index];
      });

      return {
        [STORES.COLLECTION]: collection,
        [STORES.USER_STATE]: userState,
        [STORES.REDEEMED_CODES]: redeemedCodes,
        [STORES.GIFTS_RECEIVED]: giftsReceived,
      };
    });
  }

  /**
   * Validates a decoded save payload.
   *
   * @param {unknown} payload - Value produced by `decompressJson()`.
   * @returns {object} The validated `stores` object (same reference as the payload one).
   * @throws {SaveFileError} When the version is unsupported, a store is missing or malformed, or
   *   the account UUID is absent/invalid.
   */
  validateSavePayload(payload) {
    if (!isPlainObject(payload)) {
      throw new SaveFileError(SAVE_ERROR_CODES.INVALID_STRUCTURE, 'The save payload is not an object.');
    }

    if (payload.version !== SAVE_VERSION) {
      throw new SaveFileError(
        SAVE_ERROR_CODES.UNSUPPORTED_VERSION,
        `The save version "${payload.version}" is not supported (expected ${SAVE_VERSION}).`
      );
    }

    const stores = payload.stores;
    if (!isPlainObject(stores)) {
      throw new SaveFileError(SAVE_ERROR_CODES.INVALID_STRUCTURE, 'The save payload has no "stores" object.');
    }

    SAVE_STORES.forEach((storeName) => {
      if (stores[storeName] === undefined || stores[storeName] === null) {
        throw new SaveFileError(
          SAVE_ERROR_CODES.INVALID_STRUCTURE,
          `The save payload is missing the "${storeName}" store.`
        );
      }
    });

    this.validateUserState(stores[STORES.USER_STATE]);
    this.validateCollection(stores[STORES.COLLECTION]);
    this.validateRedeemedCodes(stores[STORES.REDEEMED_CODES]);
    this.validateGiftsReceived(stores[STORES.GIFTS_RECEIVED]);

    return stores;
  }

  /**
   * Validates the `user_state` store and, above all, the account UUID it carries.
   *
   * @param {unknown} userState - Candidate `user_state` object.
   * @returns {void}
   * @throws {SaveFileError} When the container type, a required key or the account is invalid.
   */
  validateUserState(userState) {
    if (!isPlainObject(userState)) {
      throw new SaveFileError(
        SAVE_ERROR_CODES.INVALID_STRUCTURE,
        'The "user_state" store of the save must be an object keyed by state name.'
      );
    }

    REQUIRED_USER_STATE_KEYS.forEach((key) => {
      const value = userState[key];
      if (value === undefined || value === null) {
        throw new SaveFileError(SAVE_ERROR_CODES.INVALID_STRUCTURE, `The save has no "${key}" state.`);
      }
      if (!isPlainObject(value)) {
        throw new SaveFileError(SAVE_ERROR_CODES.INVALID_STRUCTURE, `The "${key}" state must be an object.`);
      }
    });

    const account = userState[USER_STATE_KEYS.ACCOUNT];
    if (!isUuid(account.uuid)) {
      throw new SaveFileError(
        SAVE_ERROR_CODES.INVALID_ACCOUNT,
        `The account UUID of the save is missing or invalid (received: ${JSON.stringify(account.uuid)}).`
      );
    }

    // Scalar sanity checks on the states that drive counters. Optional fields accept null/absent
    // (`quota.lastResetDay`, `giftSync.lastCheckAt`) and the owning manager repairs anything the
    // game can rebuild (unknown sets, negative quantities, ...).
    this.assertOptionalType(account, 'createdAt', 'string', USER_STATE_KEYS.ACCOUNT);
    this.assertOptionalType(userState[USER_STATE_KEYS.QUOTA], 'dailyRemaining', 'nonNegativeInteger');
    this.assertOptionalType(userState[USER_STATE_KEYS.STATS], 'boostersOpened', 'nonNegativeInteger');
    this.assertOptionalType(userState[USER_STATE_KEYS.GIFT_SYNC], 'lastCheckedLine', 'nonNegativeInteger');
  }

  /**
   * Validates the `collection` store.
   *
   * @param {unknown} collection - Candidate array of owned cards.
   * @returns {void}
   * @throws {SaveFileError} When the container is not an array or a record is unusable (the
   *   store key path is `key`, so a record without it would abort the write).
   */
  validateCollection(collection) {
    if (!Array.isArray(collection)) {
      throw new SaveFileError(SAVE_ERROR_CODES.INVALID_STRUCTURE, 'The "collection" store of the save must be an array.');
    }

    collection.forEach((entry, index) => {
      this.assertRecord(entry, index, STORES.COLLECTION, {
        key: 'nonEmptyString',
        quantity: 'positiveInteger',
      });
      ['cardId', 'style', 'set', 'firstObtainedAt', 'lastObtainedAt'].forEach((field) => {
        this.assertOptionalType(entry, field, 'string', `${STORES.COLLECTION}[${index}]`);
      });
    });
  }

  /**
   * Validates the `redeemed_codes` store.
   *
   * @param {unknown} redeemedCodes - Candidate array of redeemed codes.
   * @returns {void}
   * @throws {SaveFileError} When the container is not an array or a record is unusable.
   */
  validateRedeemedCodes(redeemedCodes) {
    if (!Array.isArray(redeemedCodes)) {
      throw new SaveFileError(
        SAVE_ERROR_CODES.INVALID_STRUCTURE,
        'The "redeemed_codes" store of the save must be an array.'
      );
    }

    redeemedCodes.forEach((entry, index) => {
      this.assertRecord(entry, index, STORES.REDEEMED_CODES, { code: 'nonEmptyString' });
      this.assertOptionalType(entry, 'redeemedAt', 'string', `${STORES.REDEEMED_CODES}[${index}]`);
    });
  }

  /**
   * Validates the `gifts_received` store.
   *
   * @param {unknown} giftsReceived - Candidate array of received gifts.
   * @returns {void}
   * @throws {SaveFileError} When the container is not an array or a record is unusable. `line`
   *   is the store key path, so it must be a strictly positive integer.
   */
  validateGiftsReceived(giftsReceived) {
    if (!Array.isArray(giftsReceived)) {
      throw new SaveFileError(
        SAVE_ERROR_CODES.INVALID_STRUCTURE,
        'The "gifts_received" store of the save must be an array.'
      );
    }

    giftsReceived.forEach((entry, index) => {
      this.assertRecord(entry, index, STORES.GIFTS_RECEIVED, {
        line: 'positiveInteger',
        uuid: 'uuid',
        type: 'nonEmptyString',
        key: 'string',
        quantity: 'positiveInteger',
      });
      this.assertOptionalType(entry, 'receivedAt', 'string', `${STORES.GIFTS_RECEIVED}[${index}]`);
    });
  }

  /**
   * Writes a validated `stores` object over the database.
   *
   * @param {object} stores - Validated stores (see `validateSavePayload`).
   * @returns {Promise<Record<string, number>>} The number of records written per store.
   * @throws {Error} When the transaction fails (nothing is written: it is aborted).
   */
  async writeStores(stores) {
    const counts = {};

    await storageRepository.transaction(SAVE_STORES, 'readwrite', async (context) => {
      counts[STORES.COLLECTION] = 0;
      counts[STORES.USER_STATE] = 0;
      counts[STORES.REDEEMED_CODES] = 0;
      counts[STORES.GIFTS_RECEIVED] = 0;

      for (const storeName of SAVE_STORES) {
        await context.clear(storeName);
      }

      for (const record of stores[STORES.COLLECTION]) {
        await context.put(STORES.COLLECTION, record);
        counts[STORES.COLLECTION] += 1;
      }

      for (const [key, value] of Object.entries(stores[STORES.USER_STATE])) {
        if (typeof key !== 'string' || key.trim() === '') {
          throw new SaveFileError(
            SAVE_ERROR_CODES.INVALID_STRUCTURE,
            `The "user_state" store of the save contains an invalid key (${JSON.stringify(key)}).`
          );
        }
        // `user_state` is the only store with out-of-line keys: put(store, value, key).
        await context.put(STORES.USER_STATE, value, key);
        counts[STORES.USER_STATE] += 1;
      }

      for (const record of stores[STORES.REDEEMED_CODES]) {
        await context.put(STORES.REDEEMED_CODES, record);
        counts[STORES.REDEEMED_CODES] += 1;
      }

      for (const record of stores[STORES.GIFTS_RECEIVED]) {
        await context.put(STORES.GIFTS_RECEIVED, record);
        counts[STORES.GIFTS_RECEIVED] += 1;
      }
    });

    return counts;
  }

  /**
   * Builds the file name of an export.
   *
   * @param {string|null} [day=null] - `YYYY-MM-DD` day, or null to use the system UTC day.
   * @returns {string} `backup_cards_[DATE].save`.
   */
  static buildFilename(day = null) {
    const safeDay = typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day.trim())
      ? day.trim()
      : SaveFile.getSystemUtcDay();
    return `${SAVE_FILENAME_PREFIX}_${safeDay}${SAVE_EXTENSION}`;
  }

  /**
   * Current UTC day taken from the system clock.
   *
   * Used for the file name only: the trusted UTC day is provided by `DateSyncManager` (which
   * never relies on `Date.now()`) and passed as the `day` option when available.
   *
   * @returns {string} `YYYY-MM-DD`.
   */
  static getSystemUtcDay() {
    const now = new Date();
    return [now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate()]
      .map((part, index) => (index === 0 ? String(part) : String(part).padStart(2, '0')))
      .join('-');
  }

  /**
   * Reads the text content of a selected file, refusing an oversized one.
   *
   * @param {File|Blob} file - Selected file.
   * @returns {Promise<string>} The trimmed file content.
   * @throws {TypeError} When the argument is not a readable file.
   * @throws {SaveFileError} When the file is empty, too large, or cannot be read.
   */
  async readFileText(file) {
    if (!file || typeof file.text !== 'function') {
      throw new TypeError('SaveFile.importFromFile expects a File or a Blob.');
    }
    if (Number.isFinite(file.size) && file.size > MAX_SAVE_BYTES) {
      throw new SaveFileError(
        SAVE_ERROR_CODES.FILE_TOO_LARGE,
        `The selected file is too large (${file.size} bytes, maximum ${MAX_SAVE_BYTES}).`
      );
    }

    let text;
    try {
      text = await file.text();
    } catch (error) {
      throw new SaveFileError(SAVE_ERROR_CODES.INVALID_FORMAT, 'The selected file could not be read.', {
        cause: error,
      });
    }

    if (typeof text !== 'string' || text.trim() === '') {
      throw new SaveFileError(SAVE_ERROR_CODES.INVALID_FORMAT, 'The selected file is empty.');
    }
    return text.trim();
  }

  /**
   * Triggers the browser download of a text payload.
   *
   * The object URL is revoked on the next task so the download has time to start, and never
   * kept alive (a large save would otherwise stay in memory for the whole session).
   *
   * @param {string} filename - Name suggested to the browser.
   * @param {string} content - File content (Base64 text).
   * @returns {void}
   * @throws {Error} When the DOM APIs needed for the download are unavailable.
   */
  triggerDownload(filename, content) {
    if (
      typeof document === 'undefined' ||
      typeof URL === 'undefined' ||
      typeof URL.createObjectURL !== 'function'
    ) {
      throw new Error('The browser does not support file downloads.');
    }

    const blob = new Blob([content], { type: SAVE_MIME_TYPE });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /**
   * Validates one record of an array-shaped store.
   *
   * @param {unknown} entry - Candidate record.
   * @param {number} index - Position in the array (used in error messages).
   * @param {string} storeName - Store the record belongs to.
   * @param {Record<string, 'nonEmptyString'|'string'|'positiveInteger'|'uuid'>} fields - Required
   *   fields with the expected kind.
   * @returns {void}
   * @throws {SaveFileError} When a field is missing or has the wrong type.
   */
  assertRecord(entry, index, storeName, fields) {
    if (!isPlainObject(entry)) {
      throw new SaveFileError(
        SAVE_ERROR_CODES.INVALID_STRUCTURE,
        `The record ${storeName}[${index}] of the save is not an object.`
      );
    }

    Object.entries(fields).forEach(([field, kind]) => {
      const value = entry[field];
      const valid =
        kind === 'positiveInteger'
          ? Number.isInteger(value) && value > 0
          : kind === 'nonEmptyString'
            ? typeof value === 'string' && value.trim() !== ''
            : kind === 'uuid'
              ? isUuid(value)
              : typeof value === 'string';
      if (!valid) {
        throw new SaveFileError(
          SAVE_ERROR_CODES.INVALID_STRUCTURE,
          `The field "${field}" of ${storeName}[${index}] in the save is missing or invalid (expected ${kind}).`
        );
      }
    });
  }

  /**
   * Validates an optional scalar field: absent and null are accepted.
   *
   * @param {object} record - Record to inspect.
   * @param {string} field - Field name.
   * @param {'string'|'nonNegativeInteger'} kind - Expected kind.
   * @param {string} [label] - Label used in error messages.
   * @returns {void}
   * @throws {SaveFileError} When the field is present with an invalid value.
   */
  assertOptionalType(record, field, kind, label = '') {
    const value = record?.[field];
    if (value === undefined || value === null) return;

    const valid =
      kind === 'nonNegativeInteger'
        ? Number.isInteger(value) && value >= 0
        : typeof value === 'string';
    if (!valid) {
      throw new SaveFileError(
        SAVE_ERROR_CODES.INVALID_STRUCTURE,
        `The field "${field}" of ${label || 'the save'} is invalid (expected ${kind}).`
      );
    }
  }
}

/** Shared instance used by the settings view and by the onboarding screen. */
export const saveFile = new SaveFile();

export default saveFile;

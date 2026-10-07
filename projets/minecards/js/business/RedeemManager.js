/**
 * RedeemManager - Promo codes: validation, expiration and reward granting.
 *
 * Reference: `.docs/steps/7.md` points 1 and 2, and `.docs/main.md` sections 3.B and 3.G.
 *
 * CATALOGUE (`settings/redeem.json`, an array)
 *   {
 *     "code": "LAUNCH2026",
 *     "type": "booster_grant",
 *     "reward": { "amount": 2, "set": "A1" },
 *     "expiration": "2026-12-31"
 *   },
 *   {
 *     "code": "MYTHICGIFT",
 *     "type": "card_grant",
 *     "reward": { "cardId": "SERIE-A1 _ Z001", "style": "fullart", "set": "A1" }
 *   }
 *
 *   - `type` is `booster_grant` (bonus boosters) or `card_grant` (one card added to the
 *     collection);
 *   - `reward.set` is REQUIRED for both types: `main.md` section 3.B stores the bonus boosters per
 *     extension (`bonusBoosters: { A1: 2 }`), so a code must name the extension it feeds;
 *   - `expiration` is an optional `YYYY-MM-DD` day, inclusive, compared with the TRUSTED UTC day
 *     of `DateSyncManager` (`Date.now()` is never used here);
 *   - `cardId` + `style` describe the card through its unique key `${cardId}_${style}`
 *     (`main.md` section 2), which is resolved against the loaded extension JSONs.
 *
 * DECISIONS
 *   - the code is normalized (trimmed, upper-cased) before anything else, so the comparison and the
 *     `redeemed_codes` key are case-insensitive;
 *   - the catalogue container is validated at load time (shape, known type, unique codes), while a
 *     malformed REWARD only refuses its own code: a typo cannot disable every other code;
 *   - the "already redeemed" check, the `redeemed_codes` write and the reward are performed in ONE
 *     readwrite transaction, so a code can never be credited twice nor be lost without its reward
 *     (a failure aborts the transaction: nothing is written, the code stays usable);
 *   - the reward is resolved BEFORE opening the transaction (the card is looked up in the loaded
 *     extension JSONs), so a data error never reaches the storage layer.
 *
 * LIMITS (worth knowing, see `.docs/steps/8.md` for the same rationale)
 *   `settings/redeem.json` is a public file: anybody can read the codes. The "only once" rule is
 *   purely local (a player who clears their data can redeem again). Acceptable for a game with no
 *   stakes; do not use it for anything of value.
 */

import { storageRepository, STORES } from '../models/StorageRepository.js';
import { USER_STATE_KEYS } from './AccountManager.js';
import dateSyncManager from './DateSyncManager.js';
import boosterManager, { buildCollectionTimestamp } from './BoosterManager.js';

/** Path of the code catalogue, relative to the application root. */
export const REDEEM_PATH = 'settings/redeem.json';

/** Supported reward types. */
export const REDEEM_TYPES = Object.freeze({
  BOOSTER_GRANT: 'booster_grant',
  CARD_GRANT: 'card_grant',
});

/** Number of copies added to the collection by a `card_grant` (step 7 point 2). */
export const CARD_GRANT_QUANTITY = 1;

/**
 * Error codes thrown by `RedeemManager`. The values are the suffixes of the `redeem.error.*`
 * translation keys resolved by `getRedeemErrorMessageKey()`.
 */
export const REDEEM_ERROR_CODES = Object.freeze({
  EMPTY_CODE: 'emptyCode',
  UNKNOWN_CODE: 'unknownCode',
  ALREADY_REDEEMED: 'alreadyRedeemed',
  EXPIRED: 'expired',
  TIME_UNAVAILABLE: 'timeUnavailable',
  INVALID_REWARD: 'invalidReward',
  CARD_NOT_FOUND: 'cardNotFound',
  CONFIG_INVALID: 'configInvalid',
  UNKNOWN: 'unknown',
});

/** `YYYY-MM-DD` pattern of an `expiration` value. */
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Error raised by the redeem subsystem.
 *
 * `code` is stable (one of `REDEEM_ERROR_CODES`) so the UI can translate the failure without
 * parsing a message.
 */
export class RedeemError extends Error {
  /**
   * @param {string} code - One of `REDEEM_ERROR_CODES`.
   * @param {string} message - Technical description (logged, not shown to the player).
   * @param {object} [options] - Standard `Error` options (`cause`).
   */
  constructor(code, message, options = undefined) {
    super(message, options);
    this.name = 'RedeemError';
    this.code = code;
  }
}

/**
 * Resolves the i18n key describing a redeem failure.
 *
 * @param {unknown} error - Error thrown by `RedeemManager`.
 * @returns {string} A `redeem.error.*` translation key.
 */
export function getRedeemErrorMessageKey(error) {
  const code = error instanceof RedeemError ? error.code : REDEEM_ERROR_CODES.UNKNOWN;
  return `redeem.error.${code}`;
}

/**
 * Checks whether a value is a plain object (not null, not an array).
 *
 * @param {unknown} value - Candidate value.
 * @returns {boolean} True for `{}` shaped objects.
 */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Checks whether a value is a non-empty string.
 *
 * @param {unknown} value - Candidate value.
 * @returns {boolean} True for a string holding at least one non-whitespace character.
 */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

export class RedeemManager {
  /**
   * @param {object} [options] - Manager options.
   * @param {string} [options.path=REDEEM_PATH] - Catalogue path (overridable for tooling).
   */
  constructor({ path = REDEEM_PATH } = {}) {
    this.path = path;
    /** @type {object[]|null} Validated catalogue, kept in memory. */
    this.codes = null;
    /** @type {Promise<object[]>|null} In-flight load used to de-duplicate concurrent calls. */
    this.loadPromise = null;
  }

  /**
   * Loads and validates `settings/redeem.json` (cached).
   *
   * @param {object} [options] - Load options.
   * @param {boolean} [options.force=false] - Re-fetch the file even when a cached copy exists.
   * @returns {Promise<object[]>} The validated catalogue entries.
   * @throws {RedeemError} With the code `configInvalid` when the file is unreachable, not valid
   *   JSON, or structurally wrong (unknown type, duplicate code, malformed expiration).
   */
  async loadCodes({ force = false } = {}) {
    if (this.codes && !force) return this.codes;
    if (this.loadPromise && !force) return this.loadPromise;

    this.loadPromise = this.fetchCodes(force).catch((error) => {
      this.loadPromise = null;
      throw error;
    });

    this.codes = await this.loadPromise;
    this.loadPromise = null;
    return this.codes;
  }

  /**
   * Performs the fetch, parse and validation steps of `loadCodes()`.
   *
   * @param {boolean} force - When true, the browser HTTP cache is bypassed.
   * @returns {Promise<object[]>} The validated catalogue entries.
   * @throws {RedeemError} See `loadCodes()`.
   */
  async fetchCodes(force) {
    let response;
    try {
      response = await fetch(this.path, { cache: force ? 'no-store' : 'default' });
    } catch (error) {
      throw new RedeemError(
        REDEEM_ERROR_CODES.CONFIG_INVALID,
        `Unable to fetch "${this.path}" (network error).`,
        { cause: error }
      );
    }
    if (!response.ok) {
      throw new RedeemError(
        REDEEM_ERROR_CODES.CONFIG_INVALID,
        `Unable to fetch "${this.path}" (HTTP ${response.status}).`
      );
    }

    let raw;
    try {
      raw = await response.json();
    } catch (error) {
      throw new RedeemError(REDEEM_ERROR_CODES.CONFIG_INVALID, `"${this.path}" is not valid JSON.`, {
        cause: error,
      });
    }

    return this.validateCatalogue(raw);
  }

  /**
   * Validates the catalogue container: shape, known type and unique codes.
   *
   * The reward contents are intentionally left to `resolveTarget()`: a typo in one reward must not
   * disable every other code.
   *
   * @param {unknown} raw - Parsed JSON payload.
   * @returns {object[]} A frozen list of `{ code, type, reward, expiration }` descriptors.
   * @throws {RedeemError} With the code `configInvalid` when an entry is unusable.
   */
  validateCatalogue(raw) {
    if (!Array.isArray(raw)) {
      throw new RedeemError(REDEEM_ERROR_CODES.CONFIG_INVALID, `"${this.path}" must contain a JSON array of codes.`);
    }

    const seen = new Set();
    const codes = raw.map((entry, index) => {
      if (!isPlainObject(entry)) {
        throw new RedeemError(REDEEM_ERROR_CODES.CONFIG_INVALID, `Code #${index} of "${this.path}" is not an object.`);
      }

      const code = this.normalizeCode(entry.code);
      if (!code) {
        throw new RedeemError(REDEEM_ERROR_CODES.CONFIG_INVALID, `Code #${index} of "${this.path}" has no valid "code".`);
      }
      if (seen.has(code)) {
        throw new RedeemError(REDEEM_ERROR_CODES.CONFIG_INVALID, `The code "${code}" is declared twice in "${this.path}".`);
      }
      seen.add(code);

      if (!Object.values(REDEEM_TYPES).includes(entry.type)) {
        throw new RedeemError(
          REDEEM_ERROR_CODES.CONFIG_INVALID,
          `Code "${code}" has an unknown type "${entry.type}" (expected one of [${Object.values(REDEEM_TYPES).join(', ')}]).`
        );
      }
      if (!isPlainObject(entry.reward)) {
        throw new RedeemError(REDEEM_ERROR_CODES.CONFIG_INVALID, `Code "${code}" has no valid "reward" object.`);
      }
      if (entry.expiration !== undefined && !DAY_PATTERN.test(String(entry.expiration).trim())) {
        throw new RedeemError(
          REDEEM_ERROR_CODES.CONFIG_INVALID,
          `Code "${code}" has an invalid "expiration" (expected YYYY-MM-DD, received ${JSON.stringify(entry.expiration)}).`
        );
      }

      return Object.freeze({
        code,
        type: entry.type,
        reward: entry.reward,
        expiration: entry.expiration === undefined ? null : String(entry.expiration).trim(),
      });
    });

    console.info(`[RedeemManager] Loaded ${codes.length} promo code(s).`);
    return codes;
  }

  /**
   * Normalizes a player input or a catalogue code.
   *
   * @param {unknown} code - Raw value.
   * @returns {string} The trimmed, upper-cased code (empty string when unusable).
   */
  normalizeCode(code) {
    if (typeof code !== 'string') return '';
    return code.trim().toUpperCase();
  }

  /**
   * Finds a catalogue entry by code.
   *
   * @param {string} code - Normalized code.
   * @returns {Promise<object>} The descriptor.
   * @throws {RedeemError} With the code `unknownCode` when the code is not declared.
   * @throws {RedeemError} With the code `configInvalid` when the catalogue cannot be loaded.
   */
  async findDescriptor(code) {
    const codes = await this.loadCodes();
    const descriptor = codes.find((entry) => entry.code === code);
    if (!descriptor) {
      throw new RedeemError(REDEEM_ERROR_CODES.UNKNOWN_CODE, `The code "${code}" is not declared in "${this.path}".`);
    }
    return descriptor;
  }

  /**
   * Checks the expiration of a descriptor against the trusted UTC day.
   *
   * The comparison is lexicographic, which is exact for `YYYY-MM-DD` days. The expiration day
   * itself is still valid (the code expires at the END of that day, UTC).
   *
   * @param {object} descriptor - Catalogue entry.
   * @returns {void}
   * @throws {RedeemError} With the code `expired` when the day is past.
   * @throws {RedeemError} With the code `timeUnavailable` when the code expires and the trusted
   *   clock is not anchored: the expiration cannot be verified, so the code is refused rather
   *   than credited blindly (same rule as the quota, which never resets on a frozen clock).
   */
  assertNotExpired(descriptor) {
    if (!descriptor.expiration) return;

    const today = dateSyncManager.getCurrentUtcDay();
    if (!today) {
      throw new RedeemError(
        REDEEM_ERROR_CODES.TIME_UNAVAILABLE,
        `The code "${descriptor.code}" expires on ${descriptor.expiration} and the trusted UTC day is unavailable.`
      );
    }
    if (today > descriptor.expiration) {
      throw new RedeemError(
        REDEEM_ERROR_CODES.EXPIRED,
        `The code "${descriptor.code}" expired on ${descriptor.expiration} (today: ${today}).`
      );
    }
  }

  /**
   * Resolves the target of a descriptor: the extension and amount, or the card to grant.
   *
   * @param {object} descriptor - Catalogue entry.
   * @returns {Promise<{type: string, set: string, amount: number|null, card: import('../classes/Card.js').default|null}>}
   *   The resolved target.
   * @throws {RedeemError} With the code `invalidReward` when the reward is malformed, or
   *   `cardNotFound` when the referenced card does not exist in the extension.
   * @throws {RangeError} When the extension is not declared in `settings/config.json`.
   */
  async resolveTarget(descriptor) {
    const { reward, code } = descriptor;
    const set = typeof reward.set === 'string' ? reward.set.trim() : '';
    if (!isNonEmptyString(set)) {
      throw new RedeemError(
        REDEEM_ERROR_CODES.INVALID_REWARD,
        `The reward of "${code}" has no "set": bonus boosters and cards are always tied to an extension.`
      );
    }
    // Throws a RangeError naming the culprit when the extension is unknown.
    const setId = dateSyncManager.assertKnownSet(set);

    if (descriptor.type === REDEEM_TYPES.BOOSTER_GRANT) {
      const amount = reward.amount;
      if (!Number.isInteger(amount) || amount <= 0) {
        throw new RedeemError(
          REDEEM_ERROR_CODES.INVALID_REWARD,
          `The reward of "${code}" must have a strictly positive integer "amount" (received: ${JSON.stringify(amount)}).`
        );
      }
      return { type: descriptor.type, set: setId, amount, card: null };
    }

    if (!isNonEmptyString(reward.cardId) || !isNonEmptyString(reward.style)) {
      throw new RedeemError(
        REDEEM_ERROR_CODES.INVALID_REWARD,
        `The reward of "${code}" must declare "cardId" and "style" (received: ${JSON.stringify(reward)}).`
      );
    }

    const uniqueKey = `${reward.cardId.trim()}_${reward.style.trim()}`;
    const loadedSet = await boosterManager.getBoosterSet(setId);
    const card = loadedSet?.cards?.find((candidate) => candidate.uniqueKey === uniqueKey) ?? null;
    if (!card) {
      throw new RedeemError(
        REDEEM_ERROR_CODES.CARD_NOT_FOUND,
        `The card "${uniqueKey}" of code "${code}" does not exist in the extension "${setId}".`
      );
    }

    return { type: descriptor.type, set: setId, amount: null, card };
  }

  /**
   * Redeems a code: validates it, grants the reward and consumes the code, atomically.
   *
   * @param {string} input - Raw code typed by the player.
   * @returns {Promise<object>} The redemption result:
   *   `{ code, type, set, amount, card, quantity, redeemedAt, quota }`. `quota` is the refreshed
   *   booster snapshot for a `booster_grant` (null for a `card_grant`).
   * @throws {RedeemError} With the code `emptyCode`, `unknownCode`, `alreadyRedeemed`, `expired`,
   *   `timeUnavailable`, `invalidReward`, `cardNotFound` or `configInvalid` (the message is
   *   translated by the view through `getRedeemErrorMessageKey`).
   * @throws {Error} When the storage transaction fails; nothing is written in that case.
   */
  async redeem(input) {
    const code = this.normalizeCode(input);
    if (!code) {
      throw new RedeemError(REDEEM_ERROR_CODES.EMPTY_CODE, 'No code was provided.');
    }

    const descriptor = await this.findDescriptor(code);
    this.assertNotExpired(descriptor);
    const target = await this.resolveTarget(descriptor);

    if (target.type === REDEEM_TYPES.BOOSTER_GRANT) {
      // The daily reset must be applied before granting: the write below replaces the quota
      // record, so the 3 free boosters of the day have to be part of it.
      await dateSyncManager.ensureDailyReset();
    }

    const redeemedAt = buildCollectionTimestamp();
    const result = await storageRepository.transaction(
      [STORES.USER_STATE, STORES.COLLECTION, STORES.REDEEMED_CODES],
      'readwrite',
      async (context) => {
        const already = await context.get(STORES.REDEEMED_CODES, code);
        if (already) {
          throw new RedeemError(
            REDEEM_ERROR_CODES.ALREADY_REDEEMED,
            `The code "${code}" was already redeemed on ${already.redeemedAt ?? 'an unknown date'}.`
          );
        }

        await context.put(STORES.REDEEMED_CODES, { code, redeemedAt });

        if (target.type === REDEEM_TYPES.BOOSTER_GRANT) {
          const quota = dateSyncManager.normalizeQuota(await context.get(STORES.USER_STATE, USER_STATE_KEYS.QUOTA));
          const bonusBoosters = {
            ...quota.bonusBoosters,
            [target.set]: (quota.bonusBoosters[target.set] ?? 0) + target.amount,
          };
          await context.put(STORES.USER_STATE, { ...quota, bonusBoosters }, USER_STATE_KEYS.QUOTA);
          return { granted: target.amount, quantity: null };
        }

        const key = target.card.uniqueKey;
        const existing = await context.get(STORES.COLLECTION, key);
        const quantity = (existing?.quantity ?? 0) + CARD_GRANT_QUANTITY;
        const entry = existing
          ? { ...existing, quantity, lastObtainedAt: redeemedAt }
          : {
              key,
              cardId: target.card.id,
              style: target.card.style,
              set: target.card.set,
              quantity,
              firstObtainedAt: redeemedAt,
              lastObtainedAt: redeemedAt,
            };
        await context.put(STORES.COLLECTION, entry);
        return { granted: CARD_GRANT_QUANTITY, quantity };
      }
    );

    let quota = null;
    if (target.type === REDEEM_TYPES.BOOSTER_GRANT) {
      // `DateSyncManager` keeps a copy of the quota in memory: read it back from the database
      // before publishing, otherwise the header would show the pre-grant value.
      await dateSyncManager.getRemainingBoosters(target.set);
      dateSyncManager.emitQuotaUpdated(target.set);
      quota = dateSyncManager.getQuotaSnapshot(target.set);
    }

    console.info(`[RedeemManager] Code "${code}" redeemed (${target.type}, set ${target.set}).`);
    return {
      code,
      type: target.type,
      set: target.set,
      amount: target.amount,
      card: target.card,
      quantity: result.quantity ?? result.granted,
      redeemedAt,
      quota,
    };
  }
}

/** Shared instance used by the redeem view. */
export const redeemManager = new RedeemManager();

export default redeemManager;

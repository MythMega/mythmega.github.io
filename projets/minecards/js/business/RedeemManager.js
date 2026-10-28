/**
 * RedeemManager - Special codes (`settings/codes.json`): inspection, availability and granting.
 *
 * Reference: `.docs/steps/9.md` points 2, 3, 4 and 6, and `.docs/main.md` sections 3.B and 3.G.
 *
 * CATALOGUE (`settings/codes.json`, an array; the `_comment` field is ignored)
 *   {
 *     "Code": "WELC0M3ST3V3",
 *     "Rewards": [
 *       { "RewardType": "Booster", "Quantity": 1, "ItemId": "A1" },
 *       { "RewardType": "Card", "Quantity": 1, "ItemId": "SERIE-A1 / P004", "PreferedLayout": "fullart" },
 *       { "RewardType": "Sparks", "Quantity": 50 }
 *     ],
 *     "Availabilities": null,
 *     "Repeatable": false
 *   }
 *
 *   - `Code`      : compared case-insensitively with the input, after `trim()` (dots and any other
 *                   character are significant);
 *   - `CodeHash`  : OPTIONAL hardening, a SHA-256 hex digest of the normalized (upper-cased) code,
 *                   accepted instead of `Code` so the plain code is not shipped in the file;
 *   - `RewardType`: `Booster` (ItemId = extension id), `Card` (ItemId = `Index` of a booster
 *                   entry, e.g. `"SERIE-A1 / P004"`) or `Sparks` (Quantity = Sparks to credit,
 *                   ItemId is ignored);
 *   - `PreferedLayout`: optional `classic`/`fullart`; when set, the FIRST matching card with that
 *                   layout is preferred, otherwise the first card with that `Index`;
 *   - `Quantity`  : integer > 0;
 *   - `Availabilities`: `null` = always available, else `{ StartDate, EndDate }` (`YYYY-MM-DD` days,
 *                   each nullable). `StartDate` is INCLUSIVE, `EndDate` is EXCLUSIVE ("before the
 *                   15th" = valid through the 14th). The day comes from `DateSyncManager`, never
 *                   from `Date.now()`;
 *   - `Repeatable`: false = the code is recorded in `redeemed_codes` and refused once used;
 *                   true  = never recorded, claimable without limit;
 *
 *   - `AutoClaim`: absent/null = nothing automatic, the code is only claimable by typing it. Else
 *                   `{ Auto, RequiredLevel, RequiredOpenBoosterStats, CustomMessage }`: the rewards
 *                   are granted automatically ONCE, when the app is opened inside the availability
 *                   window AND the account reaches both requirements. `RequiredLevel` is the player
 *                   level, `RequiredOpenBoosterStats` the number of boosters ever opened; both are
 *                   nullable. `CustomMessage.FR`/`.EN` replaces the default popup sentence. An
 *                   `AutoClaim` block on a `Repeatable` code is refused (logged, ignored): an
 *                   automatic gift is granted exactly once.
 *
 * DESIGN
 *   - `inspect(rawCode)` performs NO write: it is what the view calls to build the confirmation
 *     modal;
 *   - `claim(rawCode)` applies every reward, the `redeemed_codes` record and the history entries in
 *     ONE readwrite transaction. The already-used check is repeated inside that transaction, so two
 *     concurrent claims cannot both succeed (anti double-click / anti race);
 *   - when any reward of a code is invalid (unknown extension/card, bad quantity, empty rewards),
 *     the WHOLE code is refused: nothing is written and a warning is logged WITHOUT the code;
 *   - `settings/codes.json` is loaded lazily on the first `inspect`; the automatic check of
 *     `AutoClaimManager` also reads it at boot, which is the only reason it can be fetched before a
 *     player types anything. It is never listed in the UI nor logged (no code, no reward).
 *
 * LIMITS (documented, accepted)
 *   `settings/codes.json` is served to the browser: anybody can read every code with the devtools.
 *   "Do not reveal the codes" is a UI rule, not a protection. The `CodeHash` option raises the bar
 *   without changing the design; the "once" rule stays purely local.
 *
 * PERSONAL CODES (step 10)
 *   `resolveCode()` is the single place that turns a raw string into `{ status, kind, rewards,
 *   repeatable, storeKey }`. It tries `settings/codes.json` (the `special` kind) first, then, when
 *   the normalized input has the shape of a `useritem` code (32 Crockford characters), delegates
 *   to `UserItemCode.verify()` (`js/business/UserItemCode.js`). `inspect`/`claim` never assume
 *   which kind they are handling.
 *
 *   A personal code is ALWAYS single-use: its `redeemed_codes` key is the normalized form without
 *   dashes (32 characters), checked in `inspect()` and re-checked inside the `claim()`
 *   transaction. The code itself is never written to the history nor logged.
 */

import { canonicalBooster, canonicalCard, canonicalSparks, userItemCode, UserItemCode } from './UserItemCode.js';

import Card from '../classes/Card.js';
import { storageRepository, STORES } from '../models/StorageRepository.js';
import accountManager, { USER_STATE_KEYS } from './AccountManager.js';
import dateSyncManager from './DateSyncManager.js';
import boosterManager, { buildCollectionTimestamp } from './BoosterManager.js';
import promoManager from './PromoManager.js';
import sparksManager from './SparksManager.js';
import { GIFT_CATEGORIES } from './GiftManager.js';
import eventBus, { EVENTS } from '../utils/EventBus.js';

/** Path of the code catalogue, relative to the application root. */
export const CODES_PATH = 'settings/codes.json';

/** Reward types declared in `settings/codes.json`. */
export const REDEEM_REWARD_TYPES = Object.freeze({ BOOSTER: 'Booster', CARD: 'Card', SPARKS: 'Sparks' });

/** Kinds of code handled by `resolveCode()` (step 10 adds `useritem`). */
export const REDEEM_KINDS = Object.freeze({ SPECIAL: 'special', USER_ITEM: 'useritem' });

/**
 * Statuses returned by `inspect()`.
 * `time_unavailable` is an extension of the step 9 list: with a bounded availability and a frozen
 * trusted clock the code cannot be verified, so it is refused instead of credited blindly (same
 * rule as the quota, which never resets against an untrusted clock).
 */
export const REDEEM_STATUSES = Object.freeze({
  OK: 'ok',
  UNKNOWN: 'unknown',
  EXPIRED: 'expired',
  NOT_YET_AVAILABLE: 'not_yet_available',
  ALREADY_USED: 'already_used',
  TIME_UNAVAILABLE: 'time_unavailable',
  INVALID_CONFIG: 'invalid_config',
  // Personal codes (step 10).
  INVALID_FORMAT: 'invalid_format',
  WRONG_USER: 'wrong_user',
  INVALID: 'invalid',
  UNKNOWN_ITEM: 'unknown_item',
});

/**
 * Error codes thrown by `RedeemManager.claim()`. The values are the suffixes of the
 * `redeem.error.*` translation keys resolved by `getRedeemErrorMessageKey()`.
 */
export const REDEEM_ERROR_CODES = Object.freeze({
  EMPTY_CODE: 'empty_code',
  UNKNOWN: 'unknown',
  ALREADY_USED: 'already_used',
  EXPIRED: 'expired',
  NOT_YET_AVAILABLE: 'not_yet_available',
  TIME_UNAVAILABLE: 'time_unavailable',
  INVALID_CONFIG: 'invalid_config',
  INVALID_FORMAT: 'invalid_format',
  WRONG_USER: 'wrong_user',
  INVALID: 'invalid',
  UNKNOWN_ITEM: 'unknown_item',
  UNKNOWN_ERROR: 'unknown',
});

/** Prefix of a history key: `code:<redeemId>:<rewardIndex>`. */
export const CODE_HISTORY_PREFIX = 'code:';

/** `YYYY-MM-DD` pattern of an availability bound. */
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
 * @param {unknown} error - Error thrown by `RedeemManager.claim()`.
 * @returns {string} A `redeem.error.*` translation key.
 */
export function getRedeemErrorMessageKey(error) {
  const code = error instanceof RedeemError ? error.code : REDEEM_ERROR_CODES.UNKNOWN_ERROR;
  return `redeem.error.${code}`;
}

/**
 * Maps an `inspect()` status to the translation key suffix used by the view.
 *
 * @param {string} status - One of `REDEEM_STATUSES` except `ok`.
 * @returns {string} A `redeem.error.*` translation key.
 */
export function getRedeemStatusKey(status) {
  const known = Object.values(REDEEM_STATUSES).includes(status) ? status : REDEEM_STATUSES.UNKNOWN;
  return `redeem.error.${known}`;
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

/**
 * Checks whether a value is a strictly positive integer.
 *
 * @param {unknown} value - Candidate value.
 * @returns {boolean} True for 1, 2, 3, ...
 */
function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

/**
 * Normalizes an availability bound, validating its `YYYY-MM-DD` shape.
 *
 * @param {unknown} value - Raw bound (null/absent accepted).
 * @returns {string|null} The trimmed day, or null.
 * @throws {RedeemError} With the code `invalid_config` when the shape is wrong.
 */
function normalizeDay(value) {
  if (value === undefined || value === null) return null;
  const day = typeof value === 'string' ? value.trim() : '';
  if (!DAY_PATTERN.test(day)) {
    throw new RedeemError(
      REDEEM_ERROR_CODES.INVALID_CONFIG,
      `An availability bound of "${CODES_PATH}" is invalid (expected YYYY-MM-DD, received ${JSON.stringify(value)}).`
    );
  }
  return day;
}

export class RedeemManager {
  /**
   * @param {object} [options] - Manager options.
   * @param {string} [options.path=CODES_PATH] - Catalogue path (overridable for tooling).
   */
  constructor({ path = CODES_PATH } = {}) {
    this.path = path;
    /** @type {object[]|null} Validated catalogue, kept in memory. */
    this.codes = null;
    /** @type {Promise<object[]>|null} In-flight load used to de-duplicate concurrent calls. */
    this.loadPromise = null;
    /** @type {Card[]|null} Every card of every loaded extension, in declaration order. */
    this.allCardsCache = null;
    /** @type {Promise<Card[]>|null} In-flight card list build. */
    this.allCardsPromise = null;
    /** @type {Array<{canonical: string, target: object}>|null} Personal-code catalogue (step 10). */
    this.userItemCatalog = null;
    /** @type {Promise<Array<{canonical: string, target: object}>>|null} In-flight catalogue build. */
    this.userItemCatalogPromise = null;
  }

  /**
   * Logs with the manager prefix. Never receives a code: codes are not logged.
   *
   * @param {...unknown} args - Values forwarded to `console.info`.
   * @returns {void}
   */
  log(...args) {
    console.info('[RedeemManager]', ...args);
  }

  /**
   * Loads and validates `settings/codes.json` (cached).
   *
   * @param {object} [options] - Load options.
   * @param {boolean} [options.force=false] - Re-fetch the file even when a cached copy exists.
   * @returns {Promise<object[]>} The validated catalogue descriptors.
   * @throws {RedeemError} With the code `invalid_config` when the file is unreachable, not valid
   *   JSON, or structurally wrong (no code, duplicate code, malformed rewards/availabilities).
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
   * @returns {Promise<object[]>} The validated catalogue descriptors.
   * @throws {RedeemError} See `loadCodes()`.
   */
  async fetchCodes(force) {
    let response;
    try {
      response = await fetch(this.path, { cache: force ? 'no-store' : 'default' });
    } catch (error) {
      throw new RedeemError(
        REDEEM_ERROR_CODES.INVALID_CONFIG,
        `Unable to fetch "${this.path}" (network error).`,
        { cause: error }
      );
    }
    if (!response.ok) {
      throw new RedeemError(
        REDEEM_ERROR_CODES.INVALID_CONFIG,
        `Unable to fetch "${this.path}" (HTTP ${response.status}).`
      );
    }

    let raw;
    try {
      raw = await response.json();
    } catch (error) {
      throw new RedeemError(REDEEM_ERROR_CODES.INVALID_CONFIG, `"${this.path}" is not valid JSON.`, {
        cause: error,
      });
    }

    return this.validateCatalogue(raw);
  }

  /**
   * Validates the catalogue container: shape, presence of a code and unique codes.
   *
   * The reward contents are intentionally left to `resolveRewards()`: a malformed REWARD only
   * refuses its own code (`invalid_config`), so a single typo cannot disable every other code.
   *
   * @param {unknown} raw - Parsed JSON payload.
   * @returns {object[]} A frozen list of descriptors.
   * @throws {RedeemError} With the code `invalid_config` when an entry is unusable.
   */
  validateCatalogue(raw) {
    if (!Array.isArray(raw)) {
      throw new RedeemError(
        REDEEM_ERROR_CODES.INVALID_CONFIG,
        `"${this.path}" must contain a JSON array of codes.`
      );
    }

    const seen = new Set();
    const codes = [];

    raw.forEach((entry, index) => {
      if (!isPlainObject(entry)) {
        throw new RedeemError(
          REDEEM_ERROR_CODES.INVALID_CONFIG,
          `Code #${index} of "${this.path}" is not an object.`
        );
      }

      const code = this.normalizeCode(entry.Code);
      const codeHash = isNonEmptyString(entry.CodeHash) ? entry.CodeHash.trim().toLowerCase() : null;
      if (!code && !codeHash) {
        throw new RedeemError(
          REDEEM_ERROR_CODES.INVALID_CONFIG,
          `Code #${index} of "${this.path}" has neither a valid "Code" nor a "CodeHash".`
        );
      }

      const storeKey = code || codeHash;
      if (seen.has(storeKey)) {
        console.warn(`[RedeemManager] A code of "${this.path}" is declared twice: only the first entry is kept.`);
        return;
      }
      seen.add(storeKey);

      const availabilities = entry.Availabilities;
      codes.push(
        Object.freeze({
          code,
          codeHash,
          storeKey,
          rawRewards: Array.isArray(entry.Rewards) ? entry.Rewards : null,
          startDate: normalizeDay(availabilities?.StartDate ?? null),
          endDate: normalizeDay(availabilities?.EndDate ?? null),
          repeatable: entry.Repeatable === true,
          autoClaim: this.normalizeAutoClaim(entry.AutoClaim, index, entry.Repeatable === true),
        })
      );
    });

    this.log(`Loaded ${codes.length} special code(s).`);
    return codes;
  }

  /**
   * Normalizes the optional `AutoClaim` block of a code.
   *
   * A malformed block is IGNORED (the code stays manually claimable) rather than disabling the whole
   * catalogue, exactly like a malformed reward only refuses its own code. The one combination that
   * is never tolerated is an automatic code marked `Repeatable`: the block is dropped with an error,
   * because an automatic gift must be granted exactly once.
   *
   * @param {unknown} value - Raw `AutoClaim` value.
   * @param {number} index - Position of the entry (used in the log messages).
   * @param {boolean} repeatable - Whether the code is declared repeatable.
   * @returns {{requiredLevel: number|null, requiredOpenBoosterStats: number|null,
   *   customMessage: {fr: string|null, en: string|null}|null}|null} The normalized block, or null
   *   when auto-claiming is disabled for that code.
   */
  normalizeAutoClaim(value, index, repeatable) {
    if (value === undefined || value === null) return null;
    if (!isPlainObject(value) || value.Auto === false) {
      console.warn(`[RedeemManager] Code #${index} of "${this.path}" has an unusable "AutoClaim": it is ignored.`);
      return null;
    }
    if (repeatable) {
      console.error(
        `[RedeemManager] Code #${index} of "${this.path}" is both "Repeatable" and "AutoClaim": ` +
          'auto-claim is ignored, an automatic gift is granted only once.'
      );
      return null;
    }

    const requiredLevel = value.RequiredLevel ?? null;
    if (requiredLevel !== null && (!Number.isInteger(requiredLevel) || requiredLevel < 1)) {
      console.warn(`[RedeemManager] Code #${index} of "${this.path}" has an invalid "RequiredLevel": auto-claim is ignored.`);
      return null;
    }

    const requiredOpenBoosterStats = value.RequiredOpenBoosterStats ?? null;
    if (
      requiredOpenBoosterStats !== null &&
      (!Number.isInteger(requiredOpenBoosterStats) || requiredOpenBoosterStats < 0)
    ) {
      console.warn(
        `[RedeemManager] Code #${index} of "${this.path}" has an invalid "RequiredOpenBoosterStats": ` +
          'auto-claim is ignored.'
      );
      return null;
    }

    // A custom message is decorative: a malformed one falls back to the default sentence instead of
    // disabling the gift.
    const rawMessage = isPlainObject(value.CustomMessage) ? value.CustomMessage : {};
    const readMessage = (candidate) => (isNonEmptyString(candidate) ? candidate.trim() : null);
    const customMessage = { fr: readMessage(rawMessage.FR), en: readMessage(rawMessage.EN) };

    return Object.freeze({
      requiredLevel,
      requiredOpenBoosterStats,
      customMessage: customMessage.fr || customMessage.en ? Object.freeze(customMessage) : null,
    });
  }

  /**
   * Normalizes a player input or a catalogue code: trimmed and upper-cased.
   *
   * @param {unknown} code - Raw value.
   * @returns {string} The normalized code (empty string when unusable).
   */
  normalizeCode(code) {
    if (typeof code !== 'string') return '';
    return code.trim().toUpperCase();
  }

  /**
   * Computes the SHA-256 hex digest of a normalized code (for `CodeHash` entries).
   *
   * @param {string} normalizedCode - Upper-cased, trimmed code.
   * @returns {Promise<string|null>} The lowercase hex digest, or null when Web Crypto is unavailable.
   */
  async hashCode(normalizedCode) {
    if (typeof crypto === 'undefined' || !crypto.subtle || typeof TextEncoder !== 'function') {
      return null;
    }
    try {
      const bytes = new TextEncoder().encode(normalizedCode);
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    } catch (error) {
      console.warn('[RedeemManager] Unable to hash a code; "CodeHash" entries will be skipped.', error);
      return null;
    }
  }

  /**
   * Finds the catalogue descriptor matching a normalized code (plain `Code` or `CodeHash`).
   *
   * @param {string} normalized - Normalized code.
   * @param {object[]} codes - Loaded catalogue.
   * @returns {Promise<object|null>} The descriptor, or null when the code is not declared.
   */
  async findDescriptor(normalized, codes) {
    const direct = codes.find((entry) => entry.code && entry.code === normalized);
    if (direct) return direct;

    const hashEntries = codes.filter((entry) => entry.codeHash);
    if (hashEntries.length === 0) return null;

    const hash = await this.hashCode(normalized);
    if (!hash) return null;
    return hashEntries.find((entry) => entry.codeHash === hash) ?? null;
  }

  /**
   * Checks the availability window of a descriptor against the trusted UTC day.
   *
   * `StartDate` is inclusive, `EndDate` is exclusive. A bounded window cannot be verified against a
   * frozen clock, so the code is refused (`time_unavailable`) rather than credited blindly.
   *
   * @param {object} descriptor - Catalogue descriptor.
   * @returns {{status: string}} `ok`, `expired`, `not_yet_available` or `time_unavailable`.
   */
  checkAvailability(descriptor) {
    if (!descriptor.startDate && !descriptor.endDate) return { status: REDEEM_STATUSES.OK };

    const today = dateSyncManager.getCurrentUtcDay();
    if (!today) return { status: REDEEM_STATUSES.TIME_UNAVAILABLE };

    if (descriptor.startDate && today < descriptor.startDate) {
      return { status: REDEEM_STATUSES.NOT_YET_AVAILABLE };
    }
    if (descriptor.endDate && today >= descriptor.endDate) {
      return { status: REDEEM_STATUSES.EXPIRED };
    }
    return { status: REDEEM_STATUSES.OK };
  }

  /**
   * Returns every card of every declared extension, in declaration order.
   *
   * The promo cards (`data/promo_cards/*`) are appended: they are granted by a code exactly like a
   * drawn card, and being absent from every rarity table is what keeps them out of the boosters.
   *
   * @returns {Promise<Card[]>} The ordered card list.
   * @throws {Error} When the extension JSONs cannot be loaded.
   */
  async allCards() {
    if (this.allCardsCache) return this.allCardsCache;
    if (this.allCardsPromise) return this.allCardsPromise;

    this.allCardsPromise = (async () => {
      const sets = await boosterManager.listBoosterSets();
      const cards = [];
      for (const descriptor of sets) {
        const loadedSet = await boosterManager.getBoosterSet(descriptor.setId);
        for (const card of loadedSet?.cards ?? []) cards.push(card);
      }
      for (const group of await this.listPromoGroups()) {
        for (const card of group.cards ?? []) cards.push(card);
      }
      this.allCardsCache = cards;
      return cards;
    })().catch((error) => {
      this.allCardsPromise = null;
      throw error;
    });

    const cards = await this.allCardsPromise;
    this.allCardsPromise = null;
    return cards;
  }

  /**
   * Loads the promo catalogue without ever failing the code resolution.
   *
   * A missing or broken promo file only means "no promo card is grantable": the codes of the drawn
   * catalogue must keep working.
   *
   * @returns {Promise<Array<object>>} The promo groups (empty when the catalogue is unusable).
   */
  async listPromoGroups() {
    try {
      return await promoManager.listPromoSets();
    } catch (error) {
      console.warn('[RedeemManager] The promo cards could not be loaded.', error);
      return [];
    }
  }

  /**
   * Resolves one `Card` reward: an `Index` plus an optional preferred layout.
   *
   * Resolution order (step 9 point 2): first the first card matching the `Index` AND the preferred
   * layout; otherwise the first card matching the `Index` in JSON order; no match = invalid.
   *
   * @param {string} index - `Index` value of a booster entry (e.g. `"SERIE-A1 / P004"`).
   * @param {unknown} preferedLayout - Optional `classic`/`fullart` (case-insensitive).
   * @returns {Promise<Card|null>} The resolved card, or null when none matches.
   */
  async resolveCard(index, preferedLayout) {
    let cardId;
    try {
      cardId = Card.normalizeIndexToId(index);
    } catch (error) {
      console.warn('[RedeemManager] A "Card" reward has an invalid "ItemId".', error.message);
      return null;
    }

    const allWithId = (await this.allCards()).filter((card) => card.id === cardId);
    if (allWithId.length === 0) return null;

    if (isNonEmptyString(preferedLayout)) {
      const wanted = String(preferedLayout).trim().toLowerCase() === 'normal'
        ? Card.STYLES.CLASSIC
        : String(preferedLayout).trim().toLowerCase();
      const preferred = allWithId.find((card) => card.style === wanted);
      if (preferred) return preferred;
    }
    return allWithId[0];
  }

  /**
   * Resolves every reward of a descriptor.
   *
   * @param {object} descriptor - Catalogue descriptor.
   * @returns {Promise<Array<{type: string, key: string, quantity: number, card: Card|null}>|null>}
   *   The resolved rewards, or null when a reward is invalid (the whole code is then refused).
   */
  async resolveRewards(descriptor) {
    if (!descriptor.rawRewards || descriptor.rawRewards.length === 0) {
      console.warn('[RedeemManager] A code declares no reward; it is refused.');
      return null;
    }

    const rewards = [];
    for (const raw of descriptor.rawRewards) {
      if (!isPlainObject(raw)) {
        console.warn('[RedeemManager] A code reward is not an object; the code is refused.');
        return null;
      }

      const quantity = raw.Quantity;
      if (!isPositiveInteger(quantity)) {
        console.warn('[RedeemManager] A code reward has an invalid "Quantity"; the code is refused.');
        return null;
      }

      if (raw.RewardType === REDEEM_REWARD_TYPES.BOOSTER) {
        let setId;
        try {
          setId = dateSyncManager.assertKnownSet(raw.ItemId);
        } catch (error) {
          console.warn('[RedeemManager] A code grants an unknown extension; the code is refused.', error.message);
          return null;
        }
        rewards.push({ type: 'booster', key: setId, quantity, card: null });
        continue;
      }

      if (raw.RewardType === REDEEM_REWARD_TYPES.CARD) {
        const card = await this.resolveCard(raw.ItemId, raw.PreferedLayout);
        if (!card) {
          console.warn('[RedeemManager] A code references an unknown card; the code is refused.');
          return null;
        }
        rewards.push({ type: 'card', key: card.uniqueKey, quantity, card });
        continue;
      }

      if (raw.RewardType === REDEEM_REWARD_TYPES.SPARKS) {
        // `ItemId` is meaningless for the currency: `Quantity` is the whole reward.
        rewards.push({ type: 'sparks', key: 'sparks', quantity, card: null });
        continue;
      }

      console.warn('[RedeemManager] A code declares an unknown "RewardType"; the code is refused.');
      return null;
    }

    return rewards;
  }

  /**
   * Resolves a raw code into its kind, rewards and consumption key.
   *
   * The single extension point of the subsystem: step 10 will add the `useritem` kind here.
   *
   * @param {string} rawCode - Raw code typed by the player (normalized inside).
   * @returns {Promise<{status: string, kind: string|null, rewards?: object[], repeatable?: boolean, storeKey?: string}>}
   *   On success `{ status: 'ok', kind, rewards, repeatable, storeKey }`; otherwise a status-only
   *   result (`unknown`, `expired`, `not_yet_available`, `time_unavailable` or `invalid_config`).
   */
  async resolveCode(rawCode) {
    const normalized = this.normalizeCode(rawCode);
    if (!normalized) return { status: REDEEM_STATUSES.UNKNOWN, kind: null };

    // 1. Special codes from `settings/codes.json`. A broken catalogue does not disable the
    //    personal codes: the failure is remembered and only reported if no other kind matches.
    let descriptor = null;
    let catalogUnavailable = false;
    try {
      const codes = await this.loadCodes();
      descriptor = await this.findDescriptor(normalized, codes);
    } catch (error) {
      catalogUnavailable = true;
      console.warn('[RedeemManager] The special code catalogue is unavailable.', error.message);
    }

    // 2. Personal `useritem` codes: the 32-character length is the only signal (the payload carries
    //    no marker), so a special code is always looked up first. A wrong character is then reported
    //    by `UserItemCode.verify()` as `invalid_format`.
    if (!descriptor && UserItemCode.hasCodeLength(normalized)) {
      return this.resolveUserItemCode(rawCode);
    }

    if (!descriptor) {
      return { status: catalogUnavailable ? REDEEM_STATUSES.INVALID_CONFIG : REDEEM_STATUSES.UNKNOWN, kind: null };
    }

    const availability = this.checkAvailability(descriptor);
    if (availability.status !== REDEEM_STATUSES.OK) {
      return { status: availability.status, kind: REDEEM_KINDS.SPECIAL };
    }

    let rewards;
    try {
      rewards = await this.resolveRewards(descriptor);
    } catch (error) {
      console.warn('[RedeemManager] A code could not be resolved; it is refused.', error.message);
      return { status: REDEEM_STATUSES.INVALID_CONFIG, kind: REDEEM_KINDS.SPECIAL };
    }
    if (!rewards) return { status: REDEEM_STATUSES.INVALID_CONFIG, kind: REDEEM_KINDS.SPECIAL };

    return {
      status: REDEEM_STATUSES.OK,
      kind: REDEEM_KINDS.SPECIAL,
      rewards,
      repeatable: descriptor.repeatable,
      storeKey: descriptor.storeKey,
    };
  }

  /**
   * Builds (and caches) the personal-code catalogue: every extension (`booster:<setId>`) and every
   * card (`card:<Index>|<Layout>`) of every declared set, promo cards included - those are only
   * ever obtainable through a code or an event.
   *
   * The catalogue is built on demand, the first time a `useritem`-shaped code is seen, and never at
   * boot: an application that only uses sheet distributions and special codes never pays for it.
   *
   * @returns {Promise<Array<{canonical: string, target: object}>>} The catalogue descriptors.
   * @throws {Error} When the extension JSONs cannot be loaded.
   */
  async buildUserItemCatalog() {
    if (this.userItemCatalog) return this.userItemCatalog;
    if (this.userItemCatalogPromise) return this.userItemCatalogPromise;

    this.userItemCatalogPromise = (async () => {
      const descriptors = [];
      // Sparks rewards share one canonical item: the amount lives in the code `quantity`, not in
      // the item hash, so a single descriptor covers every amount (see `UserItemCode.canonicalSparks`).
      descriptors.push({ canonical: canonicalSparks(), target: { type: 'sparks' } });
      const sets = await boosterManager.listBoosterSets();

      // The raw entries keep the exact `Index` and `Layout` of the generator, while `cards` is the
      // same list already built as `Card` instances (same order, see `GachaEngine.parseCards`).
      // Shared by the extensions and by the promo groups: both are addressed the same way.
      const registerCards = (rawCards, cards) => {
        rawCards.forEach((entry, index) => {
          const card = cards[index];
          if (!card || !entry || typeof entry.Index !== 'string' || typeof entry.Layout !== 'string') return;
          descriptors.push({ canonical: canonicalCard(entry.Index, entry.Layout), target: { type: 'card', card } });
        });
      };

      for (const descriptor of sets) {
        const loadedSet = await boosterManager.getBoosterSet(descriptor.setId);
        descriptors.push({
          canonical: canonicalBooster(descriptor.setId),
          target: { type: 'booster', setId: descriptor.setId },
        });

        registerCards(loadedSet?.raw?.Cards ?? loadedSet?.raw?.cards ?? [], loadedSet?.cards ?? []);
      }

      // A promo card is granted by a code exactly like a drawn one, so it must be addressable here
      // too - without ever entering a booster pool.
      for (const group of await this.listPromoGroups()) {
        registerCards(group.raw ?? [], group.cards ?? []);
      }

      this.userItemCatalog = descriptors;
      return descriptors;
    })().catch((error) => {
      this.userItemCatalogPromise = null;
      throw error;
    });

    const catalog = await this.userItemCatalogPromise;
    this.userItemCatalogPromise = null;
    return catalog;
  }

  /**
   * Resolves a personal `useritem` code (step 10).
   *
   * @param {string} rawCode - Raw code (dashes/case/look-alikes tolerated).
   * @returns {Promise<{status: string, kind: string, rewards?: object[], repeatable?: boolean, storeKey?: string}>}
   *   The resolution result; `kind` is always `useritem`.
   */
  async resolveUserItemCode(rawCode) {
    let uuid = null;
    try {
      uuid = await accountManager.getUuid();
    } catch (error) {
      console.warn('[RedeemManager] The account UUID could not be read.', error.message);
    }
    if (!uuid) {
      // No account means no UUID to bind the code to: nothing can be verified.
      return { status: REDEEM_STATUSES.WRONG_USER, kind: REDEEM_KINDS.USER_ITEM };
    }

    let catalog;
    try {
      catalog = await this.buildUserItemCatalog();
    } catch (error) {
      console.warn('[RedeemManager] The item catalogue is unavailable.', error.message);
      return { status: REDEEM_STATUSES.INVALID_CONFIG, kind: REDEEM_KINDS.USER_ITEM };
    }

    let result;
    try {
      result = await userItemCode.verify(rawCode, uuid, catalog);
    } catch (error) {
      // Missing/invalid key or an insecure context.
      console.warn('[RedeemManager] The personal code could not be verified.', error.message);
      return { status: REDEEM_STATUSES.INVALID_CONFIG, kind: REDEEM_KINDS.USER_ITEM };
    }

    if (result.status !== REDEEM_STATUSES.OK) {
      return { status: result.status, kind: REDEEM_KINDS.USER_ITEM };
    }

    return {
      status: REDEEM_STATUSES.OK,
      kind: REDEEM_KINDS.USER_ITEM,
      rewards: result.rewards,
      repeatable: false,
      storeKey: result.storeKey,
    };
  }

  /**
   * Lists the codes that declare an `AutoClaim` block (an empty list when none does).
   *
   * The catalogue is loaded lazily here too: an account that never boots the automatic check never
   * pays for the file. A broken catalogue is logged and reads as "no automatic code", so a typo in
   * `settings/codes.json` can never break the application start.
   *
   * @returns {Promise<object[]>} The descriptors carrying a normalized `autoClaim`.
   */
  async listAutoClaims() {
    let codes;
    try {
      codes = await this.loadCodes();
    } catch (error) {
      console.warn('[RedeemManager] The special code catalogue is unavailable for auto-claim.', error.message);
      return [];
    }
    return codes.filter((descriptor) => descriptor.autoClaim);
  }

  /**
   * Grants an `AutoClaim` descriptor without a typed code.
   *
   * The availability and the rewards are resolved exactly like `claim()`, and the consumption is
   * re-checked inside the same write transaction: two concurrent checks (a boot and a booster
   * opening) cannot both grant the same code, and a `CodeHash`-only entry works here too since the
   * descriptor is already known.
   *
   * @param {object} descriptor - Catalogue descriptor carrying an `autoClaim` block.
   * @returns {Promise<{kind: string, rewards: object[], redeemedAt: string, repeatable: boolean}>}
   *   The claim result.
   * @throws {RedeemError} When the code is unavailable, already used or its rewards are invalid.
   * @throws {Error} When the storage transaction fails; nothing is written in that case.
   */
  async claimAuto(descriptor) {
    if (!descriptor?.autoClaim) {
      throw new RedeemError(REDEEM_ERROR_CODES.INVALID_CONFIG, 'No auto-claim descriptor was provided.');
    }

    const availability = this.checkAvailability(descriptor);
    if (availability.status !== REDEEM_STATUSES.OK) {
      throw this.buildStatusError(availability.status);
    }

    const rewards = await this.resolveRewards(descriptor);
    if (!rewards) {
      throw new RedeemError(REDEEM_ERROR_CODES.INVALID_CONFIG, 'The automatic code declares invalid rewards.');
    }

    return this.grantResolved({
      kind: REDEEM_KINDS.SPECIAL,
      rewards,
      repeatable: false,
      storeKey: descriptor.storeKey,
    });
  }

  /**
   * Inspects a code WITHOUT writing anything (read-only).
   *
   * @param {string} rawCode - Raw code typed by the player.
   * @returns {Promise<{status: string, kind: string|null, rewards?: object[]}>} The inspection
   *   result. `status` is one of `REDEEM_STATUSES`; `rewards` (present when `ok`) is the already
   *   resolved list used to build the confirmation modal.
   */
  async inspect(rawCode) {
    const resolved = await this.resolveCode(rawCode);
    if (resolved.status !== REDEEM_STATUSES.OK) {
      return { status: resolved.status, kind: resolved.kind };
    }

    if (!resolved.repeatable && resolved.storeKey) {
      const already = await storageRepository.getItem(STORES.REDEEMED_CODES, resolved.storeKey);
      if (already) return { status: REDEEM_STATUSES.ALREADY_USED, kind: resolved.kind };
    }

    return { status: REDEEM_STATUSES.OK, kind: resolved.kind, rewards: resolved.rewards };
  }

  /**
   * Builds the error thrown when a resolved status is not `ok`.
   *
   * @param {string} status - One of `REDEEM_STATUSES` except `ok`.
   * @returns {RedeemError} The matching error (message without the code).
   */
  buildStatusError(status) {
    const mapping = {
      [REDEEM_STATUSES.UNKNOWN]: REDEEM_ERROR_CODES.UNKNOWN,
      [REDEEM_STATUSES.EXPIRED]: REDEEM_ERROR_CODES.EXPIRED,
      [REDEEM_STATUSES.NOT_YET_AVAILABLE]: REDEEM_ERROR_CODES.NOT_YET_AVAILABLE,
      [REDEEM_STATUSES.ALREADY_USED]: REDEEM_ERROR_CODES.ALREADY_USED,
      [REDEEM_STATUSES.TIME_UNAVAILABLE]: REDEEM_ERROR_CODES.TIME_UNAVAILABLE,
      [REDEEM_STATUSES.INVALID_CONFIG]: REDEEM_ERROR_CODES.INVALID_CONFIG,
      [REDEEM_STATUSES.INVALID_FORMAT]: REDEEM_ERROR_CODES.INVALID_FORMAT,
      [REDEEM_STATUSES.WRONG_USER]: REDEEM_ERROR_CODES.WRONG_USER,
      [REDEEM_STATUSES.INVALID]: REDEEM_ERROR_CODES.INVALID,
      [REDEEM_STATUSES.UNKNOWN_ITEM]: REDEEM_ERROR_CODES.UNKNOWN_ITEM,
    };
    const code = mapping[status] ?? REDEEM_ERROR_CODES.UNKNOWN;
    return new RedeemError(code, `The code was refused (${status}).`);
  }

  /**
   * Generates a random identifier used to group the history entries of one claim.
   *
   * @returns {string} A UUID when available, a random fallback otherwise.
   */
  static buildRedeemId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `redeem-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  }

  /**
   * Claims a code: validates it again, grants EVERY reward and records the consumption atomically.
   *
   * @param {string} rawCode - Raw code typed by the player.
   * @returns {Promise<{kind: string, rewards: object[], redeemedAt: string, repeatable: boolean}>}
   *   The claim result (no code in the returned value, none logged).
   * @throws {RedeemError} With a `REDEEM_ERROR_CODES` value when the code is refused.
   * @throws {Error} When the storage transaction fails; nothing is written in that case.
   */
  async claim(rawCode) {
    const normalized = this.normalizeCode(rawCode);
    if (!normalized) {
      throw new RedeemError(REDEEM_ERROR_CODES.EMPTY_CODE, 'No code was provided.');
    }

    // Resolved OUTSIDE the transaction: loading the catalogue and the cards may await a fetch,
    // which would auto-commit an open IndexedDB transaction. The mutable state (redeemed_codes) is
    // re-checked INSIDE the transaction below, which is what makes the claim race-safe.
    const resolved = await this.resolveCode(normalized);
    if (resolved.status !== REDEEM_STATUSES.OK) {
      throw this.buildStatusError(resolved.status);
    }

    return this.grantResolved(resolved);
  }

  /**
   * Grants already-resolved rewards and records the consumption atomically.
   *
   * Shared by the typed code (`claim()`) and the automatic claim (`claimAuto()`): the resolution
   * happens outside the transaction, the `redeemed_codes` state is re-checked inside it.
   *
   * @param {object} resolved - `{ kind, rewards, repeatable, storeKey }`.
   * @returns {Promise<{kind: string, rewards: object[], redeemedAt: string, repeatable: boolean}>}
   *   The claim result.
   * @throws {RedeemError} When the code was already used.
   * @throws {Error} When the storage transaction fails; nothing is written in that case.
   */
  async grantResolved(resolved) {
    const { rewards, repeatable, storeKey } = resolved;
    const hasBooster = rewards.some((reward) => reward.type === 'booster');
    if (hasBooster) {
      // The daily allowance must be part of the quota record rewritten in the transaction.
      await dateSyncManager.ensureDailyReset();
    }

    const uuid = await accountManager.getUuid();
    const redeemId = RedeemManager.buildRedeemId();
    const receivedAt = buildCollectionTimestamp();
    // Cards credited by the code, collected during the transaction: they are published AFTER the
    // commit (`CARDS_OBTAINED`), like every other reward of the claim.
    const grantedCards = [];
    const grantedNewKeys = [];

    await storageRepository.transaction(
      [STORES.USER_STATE, STORES.COLLECTION, STORES.REDEEMED_CODES, STORES.GIFTS_RECEIVED],
      'readwrite',
      async (context) => {
        if (!repeatable && storeKey) {
          const already = await context.get(STORES.REDEEMED_CODES, storeKey);
          if (already) {
            throw new RedeemError(
              REDEEM_ERROR_CODES.ALREADY_USED,
              `The code was already used on ${already.redeemedAt ?? 'an unknown date'}.`
            );
          }
          await context.put(STORES.REDEEMED_CODES, { code: storeKey, redeemedAt: receivedAt });
        }

        for (let index = 0; index < rewards.length; index += 1) {
          const reward = rewards[index];
          if (reward.type === 'booster') {
            await dateSyncManager.addBonusBoosters(reward.key, reward.quantity, context);
          } else if (reward.type === 'sparks') {
            await sparksManager.addSparks(reward.quantity, context);
          } else {
            const granted = await boosterManager.addCardToCollection(
              reward.card,
              reward.quantity,
              context
            );
            grantedCards.push(reward.card);
            grantedNewKeys.push(...granted.newKeys);
          }

          await context.put(STORES.GIFTS_RECEIVED, {
            line: `${CODE_HISTORY_PREFIX}${redeemId}:${index}`,
            category: GIFT_CATEGORIES.CODES,
            uuid,
            type: reward.type,
            key: reward.key,
            quantity: reward.quantity,
            receivedAt,
          });
        }
      }
    );

    if (hasBooster) {
      // `DateSyncManager` mirrors the quota in memory: read the committed value back before
      // publishing it, otherwise the header would show the pre-grant count.
      const sets = [...new Set(rewards.filter((reward) => reward.type === 'booster').map((reward) => reward.key))];
      for (const setId of sets) {
        await dateSyncManager.getRemainingBoosters(setId);
      }
      dateSyncManager.emitQuotaUpdated(sets[0] ?? null);
    }
    if (rewards.some((reward) => reward.type === 'sparks')) {
      // In-transaction grants do not publish: read the committed balance back and emit it.
      await sparksManager.publishBalance();
    }

    if (grantedCards.length > 0) {
      eventBus.emit(EVENTS.CARDS_OBTAINED, {
        cards: grantedCards,
        newKeys: grantedNewKeys,
        source: 'redeem',
      });
    }

    eventBus.emit(EVENTS.GIFTS_UPDATED, { count: rewards.length, source: GIFT_CATEGORIES.CODES });
    this.log(`A code was claimed (${rewards.length} reward(s)).`);

    return { kind: resolved.kind, rewards, redeemedAt: receivedAt, repeatable };
  }
}

/** Shared instance used by the redeem view. */
export const redeemManager = new RedeemManager();

export default redeemManager;

/**
 * SocialManager - Published trainer cards and the players this account follows.
 *
 * Reference: `minecard.backend` (`src/index.ts`, `src/cardService.ts`) and
 * `doc/global_request_tuto.md`.
 *
 * The worker stores one public card per account UUID. Writing a card requires the matching
 * `auth_code`; reading cards is public. This manager owns both sides:
 *   - the local `social` state (`authCode` and the followed UUIDs), stored in clear in IndexedDB
 *     because the profile cannot be updated without it;
 *   - the calls to `GET /cards`, `POST /cards` and `GET /cards?uuids=...`;
 *   - the mapping between the local profile card model and the columns of the worker.
 *
 * The presentation of the card travels in explicit columns: layout, avatar size/align/shape,
 * rarity and title colour. Every unknown or malformed value falls back to the default
 * presentation instead of breaking a remote card.
 */

import storageRepository, { STORES } from '../models/StorageRepository.js';
import accountManager, { USER_STATE_KEYS, isUuid } from './AccountManager.js';
import profileManager from './ProfileManager.js';
import binderManager from './BinderManager.js';
import trophyManager from './TrophyManager.js';
import collectionManager from './CollectionManager.js';
import profileCardManager, {
  PROFILE_CARD_DEFAULT_LAYOUT,
  PROFILE_CARD_ICON_ALIGNS,
  PROFILE_CARD_ICON_SHAPES,
  PROFILE_CARD_ICON_SIZES,
  PROFILE_CARD_LAYOUTS,
  ProfileCardManager,
} from './ProfileCardManager.js';
import { colorManager, findColor } from './ColorManager.js';
import dateSyncManager from './DateSyncManager.js';
import boosterManager from './BoosterManager.js';
import eventBus, { EVENTS } from '../utils/EventBus.js';
import { ERROR_SEVERITY } from '../utils/ErrorLog.js';
import { reportError } from '../utils/ErrorReporter.js';

/** Public base URL of the Cloudflare worker that hosts the trainer cards. */
export const SOCIAL_API_BASE_URL = 'https://minecard-backend.jordanmorindev.workers.dev';

/** The worker accepts at most 100 UUIDs per read request. */
export const SOCIAL_MAX_FOLLOWING = 100;

/** Favourite slots of the worker (`favorite.card1` … `card7`, `trophy1` … `trophy7`). */
export const SOCIAL_MAX_FAVORITES = 7;

/** Length of the secret write code generated for a first publication. */
export const SOCIAL_AUTH_CODE_LENGTH = 16;

/** Alphabet of the secret code: 32 unambiguous uppercase characters, a power of two. */
const AUTH_CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Error codes thrown by this manager, mapped to `social.error.*` translation keys. */
export const SOCIAL_ERROR_CODES = Object.freeze({
  NO_ACCOUNT: 'noAccount',
  INVALID_UUID: 'invalidUuid',
  SELF: 'self',
  ALREADY_FOLLOWED: 'alreadyFollowed',
  NOT_PUBLISHED: 'notPublished',
  FOLLOW_LIMIT: 'limit',
  AUTH_MISSING: 'authMissing',
  AUTH_REJECTED: 'authRejected',
  INVALID_AUTH_CODE: 'invalidAuthCode',
  NETWORK: 'network',
  HTTP: 'http',
});

/** Error raised by the social manager, carrying a stable code for the views. */
export class SocialError extends Error {
  /**
   * @param {string} code - One of `SOCIAL_ERROR_CODES`.
   * @param {string} [message] - Developer-facing detail (never shown as-is to the player).
   * @param {object} [details] - Optional HTTP status or server message.
   */
  constructor(code, message = '', details = {}) {
    super(message || code);
    this.name = 'SocialError';
    this.code = code;
    this.status = Number.isInteger(details.status) ? details.status : null;
    this.serverMessage = typeof details.serverMessage === 'string' ? details.serverMessage : '';
  }
}

/**
 * Resolves the translation key describing a social failure.
 *
 * @param {unknown} error - Error thrown by this manager.
 * @returns {string} A `social.error.*` key.
 */
export function getSocialErrorMessageKey(error) {
  const code = error instanceof SocialError ? error.code : 'network';
  return `social.error.${code}`;
}

/**
 * Normalizes a UUID typed by the player.
 *
 * @param {unknown} value - Raw value.
 * @returns {string} The lowercase UUID, or an empty string when it is not a v4 UUID.
 */
function normalizeUuid(value) {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return isUuid(text) ? text : '';
}

/**
 * Normalizes a write code without silently repairing it.
 *
 * @param {unknown} value - Raw value.
 * @returns {string} The uppercase code, or an empty string when it is not 16 alphanumeric characters.
 */
function normalizeAuthCode(value) {
  const text = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return new RegExp(`^[A-Z0-9]{${SOCIAL_AUTH_CODE_LENGTH}}$`).test(text) ? text : '';
}

/**
 * Normalizes a card layout against the local catalogue.
 *
 * @param {unknown} value - Layout returned by the profile card or by the worker.
 * @returns {string} A known layout, or the default one.
 */
function normalizeCardLayout(value) {
  return PROFILE_CARD_LAYOUTS.includes(value) ? value : PROFILE_CARD_DEFAULT_LAYOUT;
}

/**
 * Normalizes an avatar option against one of the local catalogues.
 *
 * @param {object} catalogue - `PROFILE_CARD_ICON_SIZES`, `_ALIGNS` or `_SHAPES`.
 * @param {unknown} value - Option name.
 * @param {string} fallback - Option used when the value is unknown.
 * @returns {string} A known option name.
 */
function normalizeIconOption(catalogue, value, fallback) {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(catalogue, value)
    ? value
    : fallback;
}

/**
 * Clamps a card rarity to the six rarities of the profile card.
 *
 * @param {unknown} value - Raw rarity.
 * @returns {number} An integer between 1 and 6.
 */
function normalizeCardRarity(value) {
  return Math.min(6, Math.max(1, Math.trunc(Number(value) || 1)));
}

/**
 * Normalizes a colour identifier (or `auto`).
 *
 * @param {unknown} value - Raw colour id.
 * @returns {string} A safe colour id.
 */
function normalizeColorId(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return /^[a-z0-9_-]+$/i.test(text) ? text : 'auto';
}

/**
 * Creates a 16-character code from the Web Crypto API.
 *
 * The alphabet has 32 symbols, so one random byte maps to exactly one symbol with no modulo bias.
 *
 * @returns {string} The generated code.
 * @throws {SocialError} When the Web Crypto API is unavailable.
 */
function generateAuthCode() {
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    throw new SocialError(
      SOCIAL_ERROR_CODES.INVALID_AUTH_CODE,
      'The Web Crypto API is unavailable, so no secret code can be generated.'
    );
  }
  const bytes = crypto.getRandomValues(new Uint8Array(SOCIAL_AUTH_CODE_LENGTH));
  return Array.from(bytes, (byte) => AUTH_CODE_ALPHABET[byte % AUTH_CODE_ALPHABET.length]).join('');
}

/**
 * Accepts only a local asset path returned by the worker.
 *
 * A published card is untrusted input: refusing remote URLs and traversal keeps a followed player
 * from turning the list into a request for an arbitrary third-party image.
 *
 * @param {unknown} value - Raw path.
 * @returns {string} A safe `assets/...` path, or an empty string.
 */
export function safeSocialAssetPath(value) {
  if (typeof value !== 'string') return '';
  const path = value.trim().replace(/^\.\//, '');
  if (path === '' || path.startsWith('/') || path.startsWith('//') || path.includes('..')) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return '';
  return path.startsWith('assets/') ? path : '';
}

/**
 * Converts a date-like value to the `YYYY-MM-DD` string the worker expects.
 *
 * @param {unknown} value - ISO timestamp, UTC day, or anything else.
 * @param {string} fallback - Value used when the input has no usable date.
 * @returns {string} A non-empty UTC day.
 */
function toUtcDay(value, fallback) {
  if (typeof value === 'string') {
    const match = value.match(/^\d{4}-\d{2}-\d{2}/);
    if (match) return match[0];
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  return fallback;
}

/**
 * Reads the trusted UTC day, with the system date only as a last resort.
 *
 * @returns {string} A `YYYY-MM-DD` day.
 */
function currentUtcDay() {
  try {
    if (dateSyncManager.isTimeTrusted()) {
      const day = dateSyncManager.getCurrentUtcDay();
      if (typeof day === 'string' && day !== '') return day;
    }
  } catch (error) {
    console.warn('[SocialManager] The trusted day could not be read.', error);
  }
  return new Date().toISOString().slice(0, 10);
}

/**
 * Normalizes one list of favourite ids read from the stored cache.
 *
 * @param {unknown} value - Raw list.
 * @returns {string[]} The usable ids, at most seven.
 */
function normalizeFavoriteIds(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((id) => typeof id === 'string')
        .map((id) => id.trim())
        .filter((id) => id !== '')
    )
  ).slice(0, SOCIAL_MAX_FAVORITES);
}

/**
 * Normalizes the favourites of one player.
 *
 * @param {unknown} value - `{ cards, trophies, binder }` read from the worker or from the cache.
 * @returns {{cards: string[], trophies: string[], binder: string}} A writable entry.
 */
function normalizeFavoriteEntry(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    cards: normalizeFavoriteIds(source.cards),
    trophies: normalizeFavoriteIds(source.trophies),
    // The share code of the binder pinned on the card: opaque here, the friend dialog decodes it.
    binder: typeof source.binder === 'string' ? source.binder.trim() : '',
  };
}

/**
 * Normalizes the stored social state.
 *
 * @param {unknown} raw - Value of `user_state["social"]`.
 * @returns {{authCode: string, following: string[], cardFetchedAt: Record<string, number>,
 *   cardCache: Record<string, object>, favoriteCache: Record<string, {cards: string[],
 *   trophies: string[]}>}} A writable state.
 */
function normalizeSocialState(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const following = Array.isArray(source.following)
    ? Array.from(
        new Set(
          source.following
            .map((uuid) => normalizeUuid(uuid))
            .filter((uuid) => uuid !== '')
        )
      ).slice(0, SOCIAL_MAX_FOLLOWING)
    : [];
  // Only timestamps of players still followed are kept, and only finite positive ones: the map is
  // a display cache, never a source of truth for the Follow List itself.
  const storedFetchedAt =
    source.cardFetchedAt && typeof source.cardFetchedAt === 'object' && !Array.isArray(source.cardFetchedAt)
      ? source.cardFetchedAt
      : {};
  const cardFetchedAt = {};
  const storedCards =
    source.cardCache && typeof source.cardCache === 'object' && !Array.isArray(source.cardCache)
      ? source.cardCache
      : {};
  const cardCache = {};
  // The favourites follow the same rule as the cards: only the followed players keep an entry, so
  // an unfollowed player never leaves a pin behind in the saved state.
  const storedFavorites =
    source.favoriteCache &&
    typeof source.favoriteCache === 'object' &&
    !Array.isArray(source.favoriteCache)
      ? source.favoriteCache
      : {};
  const favoriteCache = {};
  following.forEach((uuid) => {
    const timestamp = Number(storedFetchedAt[uuid]);
    if (Number.isFinite(timestamp) && timestamp > 0) cardFetchedAt[uuid] = timestamp;
    const card = storedCards[uuid];
    if (card && typeof card === 'object' && !Array.isArray(card) && card.uuid === uuid) {
      cardCache[uuid] = card;
    }
    const favorites = storedFavorites[uuid];
    if (favorites && typeof favorites === 'object' && !Array.isArray(favorites)) {
      favoriteCache[uuid] = normalizeFavoriteEntry(favorites);
    }
  });
  return {
    authCode: normalizeAuthCode(source.authCode),
    following,
    cardFetchedAt,
    cardCache,
    favoriteCache,
  };
}

/**
 * Builds the default social state.
 *
 * @returns {{authCode: string, following: string[], cardFetchedAt: Record<string, number>,
 *   cardCache: Record<string, object>, favoriteCache: Record<string, {cards: string[],
 *   trophies: string[]}>}} An empty state.
 */
export function buildDefaultSocialState() {
  return { authCode: '', following: [], cardFetchedAt: {}, cardCache: {}, favoriteCache: {} };
}

export class SocialManager {
  /**
   * Creates the state when the account does not have it yet.
   *
   * @returns {Promise<void>} Resolves once `user_state["social"]` exists.
   */
  async ensureState() {
    const stored = await storageRepository.getUserState(USER_STATE_KEYS.SOCIAL);
    if (stored === null || stored === undefined) {
      await storageRepository.setUserState(USER_STATE_KEYS.SOCIAL, buildDefaultSocialState());
    }
  }

  /**
   * Reads the normalized social state.
   *
   * @returns {Promise<{authCode: string, following: string[],
   *   cardFetchedAt: Record<string, number>, cardCache: Record<string, object>}>} The state.
   */
  async getState() {
    return normalizeSocialState(await storageRepository.getUserState(USER_STATE_KEYS.SOCIAL));
  }

  /**
   * Reads the secret code used to publish the card.
   *
   * @returns {Promise<string>} The 16-character code, or an empty string before the first publication.
   */
  async getAuthCode() {
    return (await this.getState()).authCode;
  }

  /**
   * Reads the secret code, creating and storing one when the account has none yet.
   *
   * The online saves need the same pair as the trainer card, and a player who never published a
   * card has no code: the worker creates the account row with the code of the first upload. This
   * method is that creation, kept here so both features share one generator.
   *
   * @returns {Promise<string>} The 16-character code, or an empty string when no account exists.
   */
  async ensureAuthCode() {
    const state = await this.getState();
    if (state.authCode) return state.authCode;
    if (!(await accountManager.getUuid())) return '';
    return this.setAuthCode(generateAuthCode());
  }

  /**
   * Replaces the secret code. Reserved for the basic developer mode, warned in the settings.
   *
   * @param {unknown} value - New code.
   * @returns {Promise<string>} The stored code.
   * @throws {SocialError} When the code is not 16 alphanumeric characters.
   */
  async setAuthCode(value) {
    const code = normalizeAuthCode(value);
    if (code === '') {
      throw new SocialError(
        SOCIAL_ERROR_CODES.INVALID_AUTH_CODE,
        'The secret code must contain exactly 16 letters or digits.'
      );
    }
    const state = await this.getState();
    await storageRepository.setUserState(USER_STATE_KEYS.SOCIAL, { ...state, authCode: code });
    return code;
  }

  /**
   * Lists the followed UUIDs.
   *
   * @returns {Promise<string[]>} The UUIDs, in follow order.
   */
  async getFollowing() {
    return (await this.getState()).following;
  }

  /**
   * Follows one player after checking that their card is published.
   *
   * @param {unknown} value - UUID typed by the player.
   * @returns {Promise<object>} The public card of the followed player.
   * @throws {SocialError} When the UUID is invalid, is the local account, was already followed, the
   *   follow list is full, the card is not published, or the request fails.
   */
  async addFollow(value) {
    const uuid = normalizeUuid(value);
    if (uuid === '') {
      throw new SocialError(SOCIAL_ERROR_CODES.INVALID_UUID, 'The UUID is not a valid v4 UUID.');
    }
    const ownUuid = await accountManager.getUuid();
    if (ownUuid && uuid === ownUuid) {
      throw new SocialError(SOCIAL_ERROR_CODES.SELF, 'The account cannot follow itself.');
    }

    const state = await this.getState();
    if (state.following.includes(uuid)) {
      throw new SocialError(SOCIAL_ERROR_CODES.ALREADY_FOLLOWED, 'This UUID is already followed.');
    }
    if (state.following.length >= SOCIAL_MAX_FOLLOWING) {
      throw new SocialError(SOCIAL_ERROR_CODES.FOLLOW_LIMIT, 'The follow list is full.');
    }

    const card = await this.getCardByUuid(uuid);
    if (!card) {
      throw new SocialError(
        SOCIAL_ERROR_CODES.NOT_PUBLISHED,
        'This player has not published their trainer card.'
      );
    }

    // The read above can take a while. Re-read the Follow List before writing so an unfollow that
    // happened meanwhile is not undone by this older snapshot.
    const latest = await this.getState();
    if (latest.following.includes(uuid)) {
      throw new SocialError(SOCIAL_ERROR_CODES.ALREADY_FOLLOWED, 'This UUID is already followed.');
    }
    if (latest.following.length >= SOCIAL_MAX_FOLLOWING) {
      throw new SocialError(SOCIAL_ERROR_CODES.FOLLOW_LIMIT, 'The follow list is full.');
    }

    const following = [...latest.following, uuid];
    await storageRepository.setUserState(USER_STATE_KEYS.SOCIAL, {
      ...latest,
      following,
      cardFetchedAt: { ...latest.cardFetchedAt, [uuid]: Date.now() },
      cardCache: { ...latest.cardCache, [uuid]: card },
    });
    // The friend trophy counts a RECORD, so only adding raises it: an unfollow leaves it alone.
    await this.recordFriendsPeak(following.length);
    // Published only once the follow is stored: a UUID that was rejected never counts.
    eventBus.emit(EVENTS.FOLLOW_ADDED, { uuid });
    return card;
  }

  /**
   * Raises the record of distinct friends followed at once (`stats.friendsPeak`).
   *
   * The friend-count trophies must never go down: unfollowing three of six friends leaves the
   * counter at six, and reaching seven takes four new follows. Only a HIGHER count is written, so
   * this method is idempotent and safe to call on every follow.
   *
   * The follow itself is already committed when this runs: a failure here is bookkeeping, not a
   * lost follow, and `TrophyManager` re-derives `max(stored peak, current list)` on every read.
   *
   * @param {unknown} count - Current number of followed players.
   * @returns {Promise<number>} The stored record.
   */
  async recordFriendsPeak(count) {
    const value = Math.max(0, Math.trunc(Number(count) || 0));
    if (value === 0) return 0;
    try {
      return await storageRepository.transaction(
        STORES.USER_STATE,
        'readwrite',
        async (context) => {
          const stored = await context.get(STORES.USER_STATE, USER_STATE_KEYS.STATS);
          const stats =
            stored && typeof stored === 'object' && !Array.isArray(stored) ? { ...stored } : {};
          const current =
            Number.isInteger(stats.friendsPeak) && stats.friendsPeak >= 0 ? stats.friendsPeak : 0;
          if (value <= current) return current;
          await context.put(
            STORES.USER_STATE,
            { ...stats, friendsPeak: value },
            USER_STATE_KEYS.STATS
          );
          return value;
        }
      );
    } catch (error) {
      console.warn('[SocialManager] The record of friends could not be updated.', error);
      return value;
    }
  }

  /**
   * Stops following one player. The card itself is public and stays untouched on the worker.
   *
   * @param {unknown} value - UUID to remove.
   * @returns {Promise<boolean>} True when the player was followed and has been removed.
   * @throws {SocialError} When the UUID is invalid.
   */
  async removeFollow(value) {
    const uuid = normalizeUuid(value);
    if (uuid === '') {
      throw new SocialError(SOCIAL_ERROR_CODES.INVALID_UUID, 'The UUID is not a valid v4 UUID.');
    }

    const state = await this.getState();
    if (!state.following.includes(uuid)) return false;

    await storageRepository.setUserState(USER_STATE_KEYS.SOCIAL, {
      ...state,
      following: state.following.filter((followed) => followed !== uuid),
      cardFetchedAt: Object.fromEntries(
        Object.entries(state.cardFetchedAt).filter(([followed]) => followed !== uuid)
      ),
      cardCache: Object.fromEntries(
        Object.entries(state.cardCache).filter(([followed]) => followed !== uuid)
      ),
      favoriteCache: Object.fromEntries(
        Object.entries(state.favoriteCache).filter(([followed]) => followed !== uuid)
      ),
    });
    return true;
  }

  /**
   * Reads one public card.
   *
   * @param {string} uuid - Player UUID.
   * @returns {Promise<object|null>} The card, or null when it is not published.
   */
  async getCardByUuid(uuid) {
    const cards = await this.getCardsByUuids([uuid]);
    return cards[0] ?? null;
  }

  /**
   * Reads the public cards of a list of UUIDs (at most 100), with their favourites.
   *
   * The worker answers `{ cards, favorites }` in ONE request: the pinned cards and trophies of a
   * followed player arrive with the card itself, so the Follow List never needs a second call.
   *
   * @param {string[]} uuids - Player UUIDs.
   * @returns {Promise<{cards: object[], favorites: Record<string, {cards: string[],
   *   trophies: string[]}>}>} The cards the worker knows about, and the favourites it has.
   */
  async getCardsAndFavorites(uuids) {
    const cleaned = Array.from(
      new Set((Array.isArray(uuids) ? uuids : []).map(normalizeUuid).filter(Boolean))
    ).slice(0, SOCIAL_MAX_FOLLOWING);
    if (cleaned.length === 0) return { cards: [], favorites: {} };

    const query = encodeURIComponent(cleaned.join(','));
    const payload = await this.request(`/cards?uuids=${query}`);
    const cards = Array.isArray(payload?.cards) ? payload.cards.filter(Boolean) : [];
    const raw =
      payload?.favorites && typeof payload.favorites === 'object' && !Array.isArray(payload.favorites)
        ? payload.favorites
        : {};
    const favorites = {};
    cleaned.forEach((uuid) => {
      const entry = raw[uuid];
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        favorites[uuid] = normalizeFavoriteEntry(entry);
      }
    });
    return { cards, favorites };
  }

  /**
   * Reads the public cards of a list of UUIDs (at most 100).
   *
   * @param {string[]} uuids - Player UUIDs.
   * @returns {Promise<object[]>} The cards the worker knows about.
   */
  async getCardsByUuids(uuids) {
    return (await this.getCardsAndFavorites(uuids)).cards;
  }

  /**
   * Reads the followed cards that are older than the configured delay.
   *
   * A card younger than `settings.socialRefreshMinutes` is reused from the persisted cache, so
   * switching views (or reloading the page) no longer performs a network read every time. `force`
   * is the explicit Refresh button and ignores the delay. The worker call stays a single batched
   * request for every stale UUID, and the cache is only updated once that request succeeded.
   *
   * @param {{force?: boolean}} [options] - Refresh options.
   * @returns {Promise<{following: string[], cards: object[], favorites: Record<string, {cards:
   *   string[], trophies: string[]}>}>} The followed UUIDs, the cards that are still published and
   *   their favourites, in follow order.
   */
  async refreshFollowing({ force = false } = {}) {
    const state = await this.getState();
    const { following, cardFetchedAt, cardCache, favoriteCache } = state;
    if (following.length === 0) return { following, cards: [], favorites: {} };

    let delayMinutes = 2;
    try {
      const settings = await accountManager.getSettings();
      delayMinutes = settings.socialRefreshMinutes ?? delayMinutes;
    } catch (error) {
      console.warn('[SocialManager] The refresh delay could not be read, using 2 minutes.', error);
    }
    const maxAge = Math.max(0, delayMinutes) * 60_000;
    const now = Date.now();

    const cachedCards = new Map(
      following
        .map((uuid) => [uuid, cardCache[uuid]])
        .filter(([, card]) => card && typeof card === 'object')
    );
    // A player whose favourites were never read (a new follow, a save written by the version that
    // predates them) is stale too: the pins cannot be guessed from the card.
    const cachedFavorites = new Map(Object.entries(favoriteCache));
    const stale = following.filter((uuid) => {
      if (force) return true;
      // The timestamp alone is not enough: the card itself lives only in the view's snapshot. After
      // a reload, the first visit must fetch it even when the stored timestamp is still fresh.
      if (!cachedCards.has(uuid)) return true;
      if (!cachedFavorites.has(uuid)) return true;
      const fetchedAt = cardFetchedAt[uuid];
      if (!Number.isFinite(fetchedAt)) return true;
      const age = now - fetchedAt;
      // A timestamp in the future means the local clock moved backwards: reading again is safer
      // than freezing the card until that timestamp is reached.
      return age < 0 || age >= maxAge;
    });

    let currentFollowing = following;
    if (stale.length > 0) {
      const { cards: freshCards, favorites: freshFavorites } = await this.getCardsAndFavorites(stale);
      // The network read can take a while: the Follow List may have changed meanwhile (an unfollow
      // from the detail dialog, for example). Re-read before storing the timestamps so a stale
      // snapshot can never resurrect a player who was just removed.
      const latest = await this.getState();
      currentFollowing = latest.following;
      const fetchedAt = { ...latest.cardFetchedAt };
      const latestCards = { ...latest.cardCache };
      const latestFavorites = { ...latest.favoriteCache };
      // A follow added while the request was in flight already has its card in the latest cache.
      Object.entries(latest.cardCache).forEach(([uuid, card]) => {
        if (!cachedCards.has(uuid)) cachedCards.set(uuid, card);
      });
      stale.forEach((uuid) => {
        // A missing card has still been checked: caching the attempt keeps an unpublished player
        // from being requested again on every view switch.
        if (currentFollowing.includes(uuid)) fetchedAt[uuid] = now;
        cachedCards.delete(uuid);
        delete latestCards[uuid];
        cachedFavorites.delete(uuid);
        delete latestFavorites[uuid];
      });
      freshCards.forEach((card) => {
        cachedCards.set(card.uuid, card);
        latestCards[card.uuid] = card;
      });
      // An empty entry is stored on purpose for a player without favourites: it records that the
      // read happened, so the next refresh reuses it instead of asking again on every visit.
      stale.forEach((uuid) => {
        if (!currentFollowing.includes(uuid)) return;
        const favorites = freshFavorites[uuid] ?? { cards: [], trophies: [] };
        cachedFavorites.set(uuid, favorites);
        latestFavorites[uuid] = favorites;
      });
      await storageRepository.setUserState(USER_STATE_KEYS.SOCIAL, {
        ...latest,
        cardFetchedAt: fetchedAt,
        cardCache: latestCards,
        favoriteCache: latestFavorites,
      });
    }

    const favorites = {};
    currentFollowing.forEach((uuid) => {
      const entry = cachedFavorites.get(uuid);
      if (entry) favorites[uuid] = entry;
    });
    return {
      following: currentFollowing,
      cards: currentFollowing.map((uuid) => cachedCards.get(uuid)).filter(Boolean),
      favorites,
    };
  }

  /**
   * Publishes or updates the local trainer card.
   *
   * The worker is read first. A first publication generates the secret code; a card that already
   * exists without a local code cannot be overwritten (the worker would answer 403).
   *
   * @returns {Promise<{action: string, card: object}>} The worker response without `auth_code`.
   * @throws {SocialError} When the account, the code or the network is unavailable.
   */
  async publishOwnCard() {
    const uuid = await accountManager.getUuid();
    if (!uuid) {
      throw new SocialError(SOCIAL_ERROR_CODES.NO_ACCOUNT, 'No local account exists.');
    }

    const remote = await this.getCardByUuid(uuid);
    let state = await this.getState();
    if (!state.authCode) {
      if (remote) {
        throw new SocialError(
          SOCIAL_ERROR_CODES.AUTH_MISSING,
          'The card exists online but its secret code is missing from this browser.'
        );
      }
      state = {
        ...state,
        authCode: await this.setAuthCode(generateAuthCode()),
      };
    }

    const payload = await this.buildPayload(uuid, state.authCode);
    try {
      const response = await this.request('/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const action = typeof response?.action === 'string' ? response.action : 'updated';
      eventBus.emit(EVENTS.PROFILE_CARD_PUBLISHED, { action });
      return { action, card: response?.card ?? null };
    } catch (error) {
      if (error instanceof SocialError && error.status === 403) {
        throw new SocialError(
          SOCIAL_ERROR_CODES.AUTH_REJECTED,
          'The worker rejected the secret code of this account.',
          { status: 403 }
        );
      }
      throw error;
    }
  }

  /**
   * Builds the exact body of `POST /cards` from the local profile card.
   *
   * @param {string} uuid - Account UUID.
   * @param {string} authCode - Secret write code.
   * @returns {Promise<object>} The worker payload.
   */
  async buildPayload(uuid, authCode) {
    const [profile, trophyState, collection, preferences] = await Promise.all([
      profileManager.getProfile(),
      trophyManager.evaluate({ notify: false }),
      collectionManager.getCollectionView(),
      profileCardManager.getPreferences(),
    ]);
    const model = await profileCardManager.build({
      profile,
      trophyState,
      collection,
      preferences,
      uuid,
    });
    const account = await accountManager.getAccount();
    const fallbackDay = toUtcDay(account?.createdAt, currentUtcDay());

    return {
      uuid,
      auth_code: authCode,
      username: model.name !== '' ? model.name : 'Steve',
      background_card_id: model.backgroundKey || 'default',
      profile_picture_id: model.underlay || 'none',
      title_id: model.titleId || 'none',
      card_color_id: normalizeColorId(model.borderColor),
      username_color_id: normalizeColorId(model.nameColor),
      location_id: model.background || '',
      card_layout: normalizeCardLayout(model.layout),
      profile_icon_size: normalizeIconOption(PROFILE_CARD_ICON_SIZES, model.iconSize, 'normal'),
      profile_icon_align: normalizeIconOption(PROFILE_CARD_ICON_ALIGNS, model.iconAlign, 'center'),
      profile_icon_shape: normalizeIconOption(PROFILE_CARD_ICON_SHAPES, model.iconShape, 'normal'),
      card_rarity: normalizeCardRarity(model.rarity),
      title_color_id: normalizeColorId(model.titleColor),
      open_booster: Math.max(0, Math.trunc(Number(model.boostersOpened) || 0)),
      different_cards: Math.max(0, Math.trunc(Number(model.distinctCards) || 0)),
      date_first_card: toUtcDay(model.firstObtainedAt, fallbackDay),
      level: Math.max(0, Math.trunc(Number(model.level) || 1)),
      block_mined: Math.max(0, Math.trunc(Number(model.blocksMined) || 0)),
      picks: Math.max(0, Math.trunc(Number(model.picksMade) || 0)),
      points: Math.max(0, Math.trunc(Number(model.accountValue) || 0)),
      // The favourites travel WITH the card: the worker stores them in the `favorite` row of the
      // account, and every followed player receives them in the same batch read as the card. The
      // lists are ALWAYS sent, even empty, so unpinning the last favourite clears it online too.
      favorite_cards: normalizeFavoriteIds(profile?.favorites),
      favorite_trophies: normalizeFavoriteIds(profile?.featured),
      // The binder pinned in the profile goes with them, as the share code the game already knows
      // how to build: the worker only relays it.
      binder_code: await this.buildBinderCode(profile?.binder),
    };
  }

  /**
   * Encodes the binder the profile pins on its trainer card.
   *
   * The payload embeds the author identity of the profile, exactly like the link the collection
   * copies; a friend dialog ignores it and shows the card of the friend instead.
   *
   * @param {unknown} binderId - Id stored in `profile.binder`.
   * @returns {Promise<string>} The share code, or an empty string when no binder is pinned (or the
   *   page cannot be built any more: a card of the binder sold since).
   */
  async buildBinderCode(binderId) {
    if (typeof binderId !== 'string' || binderId === '') return '';
    try {
      const binder = await binderManager.getBinder(binderId);
      if (!binder) return '';
      const profile = await profileManager.getProfile();
      return await binderManager.encodeShare(binder, {
        name: profile.name,
        icon: profile.icon,
        photo: profile.photo,
      });
    } catch (error) {
      console.warn('[SocialManager] The binder pinned on the card could not be encoded.', error);
      return '';
    }
  }

  /**
   * Rebuilds a local card model from a public card.
   *
   * Only values validated against the local catalogues are painted: a color id is looked up, an
   * asset path must stay under `assets/`, and a title id is resolved by `ProfileCard`.
   *
   * @param {object} card - Public card returned by the worker.
   * @returns {Promise<object>} A model accepted by `ProfileCard.render()`.
   */
  async buildRemoteCardModel(card) {
    const [colors, settings] = await Promise.all([
      colorManager.listColors(),
      profileCardManager.getSettings(),
    ]);
    const layout = normalizeCardLayout(card?.card_layout);
    const iconSizeId = normalizeIconOption(PROFILE_CARD_ICON_SIZES, card?.profile_icon_size, 'normal');
    const iconAlignId = normalizeIconOption(PROFILE_CARD_ICON_ALIGNS, card?.profile_icon_align, 'center');
    const iconShape = normalizeIconOption(PROFILE_CARD_ICON_SHAPES, card?.profile_icon_shape, 'normal');
    const rarity = normalizeCardRarity(card?.card_rarity);
    const titleColorId = normalizeColorId(card?.title_color_id);
    const borderColor = findColor(colors, card?.card_color_id);
    const nameColor = findColor(colors, card?.username_color_id);
    const titleColor = findColor(colors, titleColorId);
    const iconSize = PROFILE_CARD_ICON_SIZES[iconSizeId];
    const iconAlign = PROFILE_CARD_ICON_ALIGNS[iconAlignId];
    // The backdrop is resolved from `background_card_id` through the LOCAL catalogue, exactly like
    // the owner's own card: every player ships the same card data, so a followed card can borrow
    // the artwork of its favourite card. `location_id` only remains as a fallback for cards
    // published before that column existed (its path is often a remote URL, which
    // `safeSocialAssetPath` refuses on purpose).
    let background = '';
    if (typeof card?.background_card_id === 'string' && card.background_card_id !== '') {
      try {
        const backdropCard = await boosterManager.getCardByKey(card.background_card_id);
        background = ProfileCardManager.cardBackdrop(backdropCard);
      } catch (error) {
        console.warn('[SocialManager] The background card could not be resolved.', error);
      }
    }
    if (background === '') background = safeSocialAssetPath(card?.location_id);
    if (background === '') background = settings.defaultArtPath;
    const underlay = safeSocialAssetPath(card?.profile_picture_id);

    return {
      name: typeof card?.username === 'string' ? card.username : '',
      titleId: card?.title_id === 'none' ? '' : String(card?.title_id ?? ''),
      seriesNumber: ProfileCardManager.buildSeriesNumber(String(card?.uuid ?? ''), settings.seriesDigits),
      rarity,
      chosenRarity: rarity,
      layout,
      titleColor: titleColorId,
      titleColorValue: titleColor?.css ?? null,
      titleColorGradient: titleColor?.gradient === true,
      nameColor: card?.username_color_id || 'auto',
      nameColorValue: nameColor?.css ?? null,
      nameColorGradient: nameColor?.gradient === true,
      borderColor: card?.card_color_id || 'auto',
      borderColorValue: borderColor?.css ?? null,
      borderColorLine: borderColor?.colors?.[0] ?? null,
      iconSize: iconSizeId,
      iconScale: iconSize?.scale ?? 1,
      iconAlign: iconAlignId,
      iconPositionX: iconAlign?.positionX ?? '50%',
      iconPositionY: iconAlign?.positionY ?? null,
      iconShape,
      trophyCount: 0,
      thresholds: settings.rarityThresholds,
      showRarityBeforeUnlock: settings.showRarityBeforeUnlock,
      rarities: [],
      backgroundKey: card?.background_card_id || '',
      background,
      underlay,
      featuredTrophies: [],
      boostersOpened: Math.max(0, Math.trunc(Number(card?.open_booster) || 0)),
      distinctCards: Math.max(0, Math.trunc(Number(card?.different_cards) || 0)),
      firstObtainedAt: typeof card?.date_first_card === 'string' ? card.date_first_card : null,
      level: Math.max(0, Math.trunc(Number(card?.level) || 1)),
      accountValue: Math.max(0, Math.trunc(Number(card?.points) || 0)),
      accountValueBreakdown: {},
      sparks: 0,
      blocksMined: Math.max(0, Math.trunc(Number(card?.block_mined) || 0)),
      picksMade: Math.max(0, Math.trunc(Number(card?.picks) || 0)),
    };
  }

  /**
   * Adds a failed worker request to the error report of the settings.
   *
   * The view already shows the failure where the player acted, and `console.error` keeps the line
   * only until the next reload: the settings list is what makes a 403 or a 409 on a trade
   * diagnosable later, with the route and the status beside the message.
   *
   * Recorded as a MINOR incident (no dialog). The detail NEVER contains the query string, which
   * carries `uuid` and `auth_code`.
   *
   * @param {SocialError} error - Failure about to be thrown.
   * @param {string} detail - Request line, e.g. `GET /cards/feed → 403 · …`.
   * @returns {void}
   */
  reportRequestFailure(error, detail) {
    reportError(error, {
      source: 'social',
      severity: ERROR_SEVERITY.MINOR,
      details: detail,
    });
  }

  /**
   * Performs one worker request and normalizes its failures.
   *
   * @param {string} path - Path beginning with `/`, query string included when there is one.
   * @param {RequestInit} [options] - Fetch options.
   * @returns {Promise<object>} The parsed JSON payload.
   * @throws {SocialError} On a network failure or a non-2xx response.
   */
  async request(path, options = {}) {
    const method = String(options.method ?? 'GET').toUpperCase();
    const requestLine = `${method} ${path.split('?')[0]}`;
    let response;
    try {
      response = await fetch(`${SOCIAL_API_BASE_URL}${path}`, {
        cache: 'no-store',
        ...options,
      });
    } catch (error) {
      const failure = new SocialError(
        SOCIAL_ERROR_CODES.NETWORK,
        'The social server is unreachable.',
        { status: null }
      );
      this.reportRequestFailure(failure, `${requestLine} → aucune réponse`);
      throw failure;
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      console.warn('[SocialManager] The server response is not valid JSON.', error);
    }

    if (!response.ok) {
      const serverMessage = typeof payload?.error === 'string' ? payload.error : '';
      const failure = new SocialError(
        SOCIAL_ERROR_CODES.HTTP,
        serverMessage || `HTTP ${response.status}`,
        { status: response.status, serverMessage }
      );
      this.reportRequestFailure(
        failure,
        `${requestLine} → ${response.status}${serverMessage ? ` · ${serverMessage}` : ''}`
      );
      throw failure;
    }
    return payload ?? {};
  }
}

/** Shared manager instance. */
export const socialManager = new SocialManager();

export default socialManager;

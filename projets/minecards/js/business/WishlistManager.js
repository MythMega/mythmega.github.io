/**
 * Wishlist - the cards a player hopes to receive, from the collection.
 *
 * A wishlist holds at most ten DISTINCT collection keys (`<cardId>_<style>`), in the order they
 * were added. It lives in `user_state["wishlist"]`, so a `.save` carries it with no change to the
 * save format, and it reaches the worker with the publication of the trainer card
 * (`SocialManager.buildPayload()` sends `wishlist_cards`, always, even empty).
 *
 * WHO REMOVES A CARD, AND WHEN
 *   - a Booster opening, a purchase and a Mine Pick never ask: when the card obtained is
 *     wishlisted, it leaves the wishlist silently, unless the player switched
 *     `wishlistAutoRemoveGain` off (it is ON by default, see `AccountManager`);
 *   - a trade is the opposite: `handleTradeReceived()` only removes the card when
 *     `wishlistAutoRemoveTrade` is on (OFF by default), and otherwise tells the view to ask the
 *     player with the post-trade dialog ("Non", "Oui cette fois", "Oui toujours").
 *
 * The worker never writes this list on its own: the game publishes it with the next card
 * publication, and `SocialManager` reads the wishlists of the followed players in its batch.
 *
 * Reference: the `wishlist` table of the backend (`sql/schema/09-wishlist.sql`).
 */

import { storageRepository } from '../models/StorageRepository.js';
import accountManager, { USER_STATE_KEYS } from './AccountManager.js';
import eventBus, { EVENTS } from '../utils/EventBus.js';

/** Largest wishlist accepted, shared with the worker (`wishlistService.WISHLIST_SLOTS`). */
export const WISHLIST_MAX = 10;

/** Longest key accepted, shared with the worker. */
const WISHLIST_KEY_MAX_LENGTH = 64;

/**
 * Shape of a collection key: `<cardId>_<style>` as the catalogues write it (`SERIE-A1 / W001_classic`,
 * spaces and slash included), and no control character. The worker applies the same rule: only the
 * length and the control characters are bounded, the key itself stays opaque.
 */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/** Error codes raised by this manager. */
export const WISHLIST_ERRORS = Object.freeze({
  FULL: 'FULL',
  INVALID_KEY: 'INVALID_KEY',
});

/** Thrown when a wish cannot be stored. */
export class WishlistError extends Error {
  /**
   * @param {string} code - One of `WISHLIST_ERRORS`.
   * @param {string} [message] - Developer message (never shown to the player).
   */
  constructor(code, message = '') {
    super(message || code);
    this.name = 'WishlistError';
    this.code = code;
  }
}

/**
 * Normalizes one collection key.
 *
 * @param {unknown} value - Raw key.
 * @returns {string} The trimmed key, or an empty string when it cannot be a collection key.
 */
function normalizeKey(value) {
  if (typeof value !== 'string') return '';
  const key = value.trim();
  if (key === '' || key.length > WISHLIST_KEY_MAX_LENGTH) return '';
  if (CONTROL_CHARACTERS.test(key)) return '';
  return key;
}

/**
 * Normalizes the stored wishlist state.
 *
 * @param {unknown} raw - Value of `user_state["wishlist"]`.
 * @returns {{cards: string[]}} A writable state.
 */
export function normalizeWishlistState(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const cards = [];
  for (const entry of Array.isArray(source.cards) ? source.cards : []) {
    const key = normalizeKey(entry);
    if (key !== '' && !cards.includes(key)) cards.push(key);
    if (cards.length === WISHLIST_MAX) break;
  }
  return { cards };
}

/**
 * Builds the default wishlist state.
 *
 * @returns {{cards: string[]}} An empty wishlist.
 */
export function buildDefaultWishlistState() {
  return { cards: [] };
}

/** Manager of the wishlist of the account. */
export class WishlistManager {
  /**
   * Creates the state when the account does not have it yet.
   *
   * @returns {Promise<void>} Resolves once `user_state["wishlist"]` exists.
   */
  async ensureState() {
    const stored = await storageRepository.getUserState(USER_STATE_KEYS.WISHLIST);
    if (stored === null || stored === undefined) {
      await storageRepository.setUserState(USER_STATE_KEYS.WISHLIST, buildDefaultWishlistState());
    }
  }

  /**
   * Reads the normalized wishlist state.
   *
   * @returns {Promise<{cards: string[]}>} The state.
   */
  async getState() {
    return normalizeWishlistState(
      await storageRepository.getUserState(USER_STATE_KEYS.WISHLIST)
    );
  }

  /**
   * Reads the wishlisted keys, in display order.
   *
   * @returns {Promise<string[]>} The keys.
   */
  async getCards() {
    return (await this.getState()).cards;
  }

  /**
   * Tells whether a card is wishlisted.
   *
   * @param {unknown} key - Collection key.
   * @returns {Promise<boolean>} True when the card is in the wishlist.
   */
  async has(key) {
    const normalized = normalizeKey(key);
    if (normalized === '') return false;
    return (await this.getState()).cards.includes(normalized);
  }

  /**
   * Adds one card to the wishlist.
   *
   * @param {unknown} key - Collection key.
   * @returns {Promise<boolean>} True when the list changed, false when it already held the card.
   * @throws {WishlistError} When the key is unusable or the wishlist is full.
   */
  async add(key) {
    const normalized = normalizeKey(key);
    if (normalized === '') {
      throw new WishlistError(WISHLIST_ERRORS.INVALID_KEY, `"${String(key)}" is not a card key.`);
    }
    const state = await this.getState();
    if (state.cards.includes(normalized)) return false;
    if (state.cards.length >= WISHLIST_MAX) {
      throw new WishlistError(WISHLIST_ERRORS.FULL, 'The wishlist is full.');
    }
    await this.write([...state.cards, normalized]);
    return true;
  }

  /**
   * Removes one card from the wishlist.
   *
   * @param {unknown} key - Collection key.
   * @returns {Promise<boolean>} True when the card was in the list.
   */
  async remove(key) {
    const normalized = normalizeKey(key);
    if (normalized === '') return false;
    const state = await this.getState();
    if (!state.cards.includes(normalized)) return false;
    await this.write(state.cards.filter((entry) => entry !== normalized));
    return true;
  }

  /**
   * Adds the card, or removes it when it is already wishlisted.
   *
   * @param {unknown} key - Collection key.
   * @returns {Promise<boolean>} True when the card was ADDED, false when it was removed.
   * @throws {WishlistError} When the key is unusable or the wishlist is full.
   */
  async toggle(key) {
    if (await this.has(key)) {
      await this.remove(key);
      return false;
    }
    await this.add(key);
    return true;
  }

  /**
   * Empties the wishlist.
   *
   * @returns {Promise<boolean>} True when something was removed.
   */
  async clear() {
    const state = await this.getState();
    if (state.cards.length === 0) return false;
    await this.write([]);
    return true;
  }

  /**
   * Removes a set of keys from the wishlist in one write.
   *
   * @param {unknown[]} keys - Collection keys.
   * @returns {Promise<string[]>} The keys that were actually removed.
   */
  async removeMany(keys) {
    const targets = new Set(
      (Array.isArray(keys) ? keys : []).map((key) => normalizeKey(key)).filter((key) => key !== '')
    );
    if (targets.size === 0) return [];
    const state = await this.getState();
    const removed = state.cards.filter((key) => targets.has(key));
    if (removed.length === 0) return [];
    await this.write(state.cards.filter((key) => !targets.has(key)));
    return removed;
  }

  /**
   * Removes the cards just obtained from a Booster, a purchase or a Mine Pick.
   *
   * Those flows never ask: the card leaves the wishlist only when `wishlistAutoRemoveGain` is on
   * (the default). Called by `BoosterManager`, `SparksManager` and `MinePickManager` once their
   * own write committed, so a failed opening never touches the wishlist.
   *
   * @param {unknown[]} keys - Keys of the cards obtained.
   * @returns {Promise<string[]>} The keys removed (empty when the option is off).
   */
  async consumeGained(keys) {
    let enabled = true;
    try {
      const settings = await accountManager.getSettings();
      enabled = settings.wishlistAutoRemoveGain !== false;
    } catch (error) {
      // An unreadable setting falls back to the default (on): the player asked for the wishlist to
      // be cleaned up after an opening, and a corrupted read must not leave the card behind.
      console.warn('[WishlistManager] The wishlist options could not be read.', error);
      enabled = true;
    }
    if (!enabled) return [];
    return this.removeMany(keys);
  }

  /**
   * Handles a card received in a trade.
   *
   * @param {unknown} key - Key of the card received.
   * @returns {Promise<'absent'|'removed'|'ask'>} `absent` when the card was not wishlisted,
   *   `removed` when the option removed it silently, `ask` when the view must show the dialog.
   */
  async handleTradeReceived(key) {
    if (!(await this.has(key))) return 'absent';
    let enabled = false;
    try {
      const settings = await accountManager.getSettings();
      enabled = settings.wishlistAutoRemoveTrade === true;
    } catch (error) {
      console.warn('[WishlistManager] The wishlist options could not be read.', error);
      enabled = false;
    }
    if (!enabled) return 'ask';
    await this.remove(key);
    return 'removed';
  }

  /**
   * Writes one list and publishes it.
   *
   * @param {string[]} cards - New list.
   * @returns {Promise<void>} Resolves once the state is stored.
   */
  async write(cards) {
    await storageRepository.setUserState(USER_STATE_KEYS.WISHLIST, { cards });
    eventBus.emit(EVENTS.WISHLIST_CHANGED, { cards: [...cards] });
  }
}

/** Shared manager instance. */
export const wishlistManager = new WishlistManager();

export default wishlistManager;

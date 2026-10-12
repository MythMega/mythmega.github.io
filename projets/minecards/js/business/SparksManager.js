/**
 * SparksManager - The Sparks currency: balance, sales, purchases and grants.
 *
 * The balance lives in a single `user_state["sparks"]` entry holding a non-negative integer;
 * every write goes through this module so the currency can never be credited or spent twice.
 *
 * ECONOMY (`settings/config.json`, `sparks`)
 *   - `sellPrice[rarity]`: Sparks credited when one copy is sold;
 *   - `buyPrice[rarity]` : Sparks charged when one copy is bought;
 *   - `boosterReward`    : Sparks credited on every booster opening (see `BoosterManager`).
 *   The prices are read through `ConfigLoader.getSparksSettings()`, so a malformed section falls
 *   back to the shipped defaults instead of breaking the balance.
 *
 * SELL RULE (see the product spec): a duplicate can be sold, but never the LAST copy. Selling
 * `copies` is only allowed while `quantity - copies >= 1`; the check runs INSIDE the write
 * transaction, so two rapid sales cannot both remove the last copy.
 *
 * BUY RULE: buying one copy of any catalog card is always possible while the balance covers
 * `buyPrice[rarity]`. The balance check is inside the transaction, next to the write.
 *
 * After every change the balance is published through `EVENTS.SPARKS_UPDATED` so the header and
 * the collection view refresh without a direct dependency on this module.
 */

import { storageRepository, STORES } from '../models/StorageRepository.js';
import { USER_STATE_KEYS } from './AccountManager.js';
import dateSyncManager from './DateSyncManager.js';
import { configLoader } from '../utils/ConfigLoader.js';
import Card from '../classes/Card.js';
import eventBus, { EVENTS } from '../utils/EventBus.js';

/** Error code thrown when the balance does not cover a purchase. */
export const INSUFFICIENT_SPARKS = 'INSUFFICIENT_SPARKS';

/** Error code thrown when a sale would remove the last copy of a card. */
export const LAST_COPY_PROTECTED = 'LAST_COPY_PROTECTED';

/**
 * Error raised by the currency subsystem.
 *
 * `code` is stable (`INSUFFICIENT_SPARKS`, `LAST_COPY_PROTECTED`) so the UI can translate the
 * failure without parsing a message.
 */
export class SparksError extends Error {
  /**
   * @param {string} code - Stable error code.
   * @param {string} message - Technical description (logged, not shown to the player).
   */
  constructor(code, message) {
    super(message);
    this.name = 'SparksError';
    this.code = code;
  }
}

export class SparksManager {
  /**
   * Logs with the manager prefix.
   *
   * @param {...unknown} args - Values forwarded to `console.info`.
   * @returns {void}
   */
  log(...args) {
    console.info('[SparksManager]', ...args);
  }

  /**
   * Builds the timestamp stored in `collection` for a purchased card.
   *
   * Mirrors `BoosterManager.buildCollectionTimestamp()` (the trusted clock is the single source
   * of time): the module cannot import it without creating a dependency cycle, so the exact same
   * convention is reproduced here.
   *
   * @returns {string} An ISO 8601 timestamp (`YYYY-MM-DDTHH:MM:SS.000Z`).
   */
  buildTimestamp() {
    const trustedDay = dateSyncManager.getCurrentUtcDay();
    if (!trustedDay) {
      // Never anchored (offline first launch): the local clock is the only available value.
      return new Date().toISOString();
    }
    return `${trustedDay}T${dateSyncManager.getUtcDate().toISOString().slice(11, 19)}.000Z`;
  }

  /**
   * Normalizes a raw stored balance.
   *
   * Anything absent, negative or non-integer is read as 0: an imported save from a version
   * without the currency starts empty rather than with a corrupted balance.
   *
   * @param {unknown} raw - Value read from `user_state["sparks"]`.
   * @returns {number} A non-negative integer.
   */
  normalizeBalance(raw) {
    const value = typeof raw === 'number' ? raw : Number(raw);
    return Number.isInteger(value) && value >= 0 ? value : 0;
  }

  /**
   * Reads the current balance.
   *
   * @returns {Promise<number>} The Sparks balance (0 when never credited).
   * @throws {Error} When the read fails.
   */
  async getBalance() {
    return this.normalizeBalance(await storageRepository.getUserState(USER_STATE_KEYS.SPARKS));
  }

  /**
   * The configured economy (prices and booster reward).
   *
   * @returns {Promise<{sellPrice: Record<string, number>, buyPrice: Record<string, number>, boosterReward: number}>}
   *   The validated economy.
   * @throws {Error} When `settings/config.json` cannot be read.
   */
  async getPrices() {
    return configLoader.getSparksSettings();
  }

  /**
   * Sell price of a card, by rarity.
   *
   * @param {number} rarity - Card rarity (1-5).
   * @returns {Promise<number>} Sparks credited per copy (0 when the rarity is unknown).
   * @throws {Error} When the configuration cannot be read.
   */
  async getSellPrice(rarity) {
    const { sellPrice } = await configLoader.getSparksSettings();
    return sellPrice[String(rarity)] ?? 0;
  }

  /**
   * Buy price of a card, by rarity.
   *
   * @param {number} rarity - Card rarity (1-5).
   * @returns {Promise<number>} Sparks charged per copy (0 when the rarity is unknown).
   * @throws {Error} When the configuration cannot be read.
   */
  async getBuyPrice(rarity) {
    const { buyPrice } = await configLoader.getSparksSettings();
    return buyPrice[String(rarity)] ?? 0;
  }

  /**
   * Credits Sparks and publishes the new balance.
   *
   * @param {number} amount - Sparks to add (strictly positive integer).
   * @param {object} [context=null] - Optional `StorageRepository.transaction` context to join
   *   instead of opening a new one (used by the booster/redeem/gift flows, which write several
   *   rewards atomically). In that mode the in-memory event is NOT emitted: the caller owns the
   *   transaction and publishes the balance after the commit.
   * @returns {Promise<number>} The resulting balance.
   * @throws {TypeError} When `amount` is not a positive integer.
   * @throws {Error} When the write fails.
   */
  async addSparks(amount, context = null) {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new TypeError(`SparksManager.addSparks expects a positive integer (received: ${JSON.stringify(amount)}).`);
    }

    const apply = (activeContext) => this.applyDelta(activeContext, amount);

    const balance = context
      ? await apply(context)
      : await storageRepository.transaction(STORES.USER_STATE, 'readwrite', apply);

    if (!context) {
      eventBus.emit(EVENTS.SPARKS_UPDATED, { balance });
    }
    return balance;
  }

  /**
   * Applies a signed delta to the balance inside a transaction.
   *
   * @param {object} context - Transaction context.
   * @param {number} delta - Signed amount (may be negative).
   * @returns {Promise<number>} The resulting balance.
   * @throws {SparksError} With `INSUFFICIENT_SPARKS` when the delta would make the balance negative.
   */
  async applyDelta(context, delta) {
    const balance = this.normalizeBalance(await context.get(STORES.USER_STATE, USER_STATE_KEYS.SPARKS));
    const next = balance + delta;
    if (next < 0) {
      throw new SparksError(
        INSUFFICIENT_SPARKS,
        `The balance (${balance}) does not cover the amount (${Math.abs(delta)}).`
      );
    }
    await context.put(STORES.USER_STATE, next, USER_STATE_KEYS.SPARKS);
    return next;
  }

  /**
   * Sells copies of an owned card.
   *
   * The last copy is protected: `quantity - copies` must stay >= 1.
   *
   * @param {object} payload - Sale payload.
   * @param {string} payload.key - Collection key (`${id}_${style}`).
   * @param {number} payload.rarity - Card rarity (1-5), used to resolve the price.
   * @param {number} [payload.copies=1] - Number of copies to sell (strictly positive integer).
   * @returns {Promise<{balance: number, quantity: number, gained: number}>} The new balance, the
   *   remaining quantity of the card and the Sparks credited.
   * @throws {TypeError} When the payload is invalid.
   * @throws {SparksError} With `LAST_COPY_PROTECTED` when the sale would remove the last copy, or
   *   when the card is not owned.
   * @throws {Error} When the write fails.
   */
  async sellCard({ key, rarity, copies = 1 } = {}) {
    if (typeof key !== 'string' || key.trim() === '') {
      throw new TypeError('SparksManager.sellCard requires a card key.');
    }
    if (!Number.isInteger(copies) || copies <= 0) {
      throw new TypeError(`SparksManager.sellCard expects a positive copy count (received: ${JSON.stringify(copies)}).`);
    }
    const price = await this.getSellPrice(rarity);
    if (price <= 0) {
      throw new SparksError(LAST_COPY_PROTECTED, `No sell price is configured for rarity ${rarity}.`);
    }
    const gained = price * copies;

    const result = await storageRepository.transaction(
      [STORES.COLLECTION, STORES.USER_STATE],
      'readwrite',
      async (context) => {
        const entry = await context.get(STORES.COLLECTION, key);
        const quantity = Number.isFinite(entry?.quantity) ? entry.quantity : 0;
        if (quantity - copies < 1) {
          throw new SparksError(
            LAST_COPY_PROTECTED,
            `Selling ${copies} of "${key}" would remove the last copy (owned: ${quantity}).`
          );
        }

        const remaining = quantity - copies;
        await context.put(STORES.COLLECTION, { ...entry, quantity: remaining, lastObtainedAt: entry.lastObtainedAt });
        const balance = await this.applyDelta(context, gained);
        return { balance, quantity: remaining, gained };
      }
    );

    this.log(`Sold ${copies} copy(ies) of "${key}" for ${gained} Sparks (balance: ${result.balance}).`);
    eventBus.emit(EVENTS.SPARKS_UPDATED, { balance: result.balance });
    return result;
  }

  /**
   * Buys one copy of a catalog card.
   *
   * Works for a card the player does not own yet (the collection row is created) and for a
   * duplicate (the quantity is incremented).
   *
   * @param {Card} card - Catalog card to buy (its rarity resolves the price).
   * @returns {Promise<{balance: number, quantity: number, spent: number}>} The new balance, the
   *   resulting quantity of the card and the Sparks charged.
   * @throws {TypeError} When `card` is not a `Card` instance.
   * @throws {SparksError} With `INSUFFICIENT_SPARKS` when the balance does not cover the price.
   * @throws {Error} When the write fails.
   */
  async buyCard(card) {
    if (!(card instanceof Card)) {
      throw new TypeError('SparksManager.buyCard expects a Card instance.');
    }
    const price = await this.getBuyPrice(card.rarity);

    const result = await storageRepository.transaction(
      [STORES.COLLECTION, STORES.USER_STATE],
      'readwrite',
      async (context) => {
        const balance = await this.applyDelta(context, -price);
        const existing = await context.get(STORES.COLLECTION, card.uniqueKey);
        const quantity = (Number.isFinite(existing?.quantity) ? existing.quantity : 0) + 1;
        const timestamp = this.buildTimestamp();
        await context.put(
          STORES.COLLECTION,
          existing
            ? { ...existing, quantity, lastObtainedAt: timestamp }
            : {
                key: card.uniqueKey,
                cardId: card.id,
                style: card.style,
                set: card.set,
                quantity,
                firstObtainedAt: timestamp,
                lastObtainedAt: timestamp,
              }
        );
        return { balance, quantity, spent: price };
      }
    );

    this.log(`Bought "${card.uniqueKey}" for ${result.spent} Sparks (balance: ${result.balance}).`);
    eventBus.emit(EVENTS.SPARKS_UPDATED, { balance: result.balance });
    return result;
  }

  /**
   * Publishes the current balance on the event bus (used after a multi-reward transaction).
   *
   * @returns {Promise<number>} The published balance.
   */
  async publishBalance() {
    const balance = await this.getBalance();
    eventBus.emit(EVENTS.SPARKS_UPDATED, { balance });
    return balance;
  }
}

/** Shared instance used by the header, the collection view and the reward flows. */
export const sparksManager = new SparksManager();

export default sparksManager;

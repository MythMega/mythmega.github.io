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
 * SOLD COUNTER: every sale adds its copies to `user_state["stats"].soldByRarity`, in the SAME
 * transaction as the cards and the balance, so a rolled back sale never leaves a counter behind.
 * It answers a different question than `drawsByRarity` (what was obtained), which is why the two
 * are kept apart.
 *
 * LEDGER: every movement of the balance also feeds `stats.sparksEarned` / `stats.sparksSpent` and
 * their per-origin maps. This is done in `applyDelta`, the single funnel every debit and credit
 * goes through: a flow that forgets to declare its origin would still be counted, which is the
 * whole point of putting it there rather than at the call sites. The two writers that cannot go
 * through `applyDelta` (a booster reward and a gift folded into a larger transaction) call
 * `recordFlow()` explicitly.
 *
 * BUY RULE: buying one copy of any catalog card is always possible while the balance covers
 * `buyPrice[rarity]`. The balance check is inside the transaction, next to the write.
 *
 * PROMO RULE (absolute): a promo card (`data/promo_cards/*`, a set id ending in `-Promo`) is
 * neither sellable nor buyable, whatever the caller does. It only ever enters the collection
 * through a redeem code or a distribution, so allowing a sale would turn a reward that cannot be
 * drawn into free Sparks, and allowing a purchase would turn Sparks into a reward that is supposed
 * to be earned. The check is the LAST one before the write, so no reloaded page, stale view or
 * hand-crafted call can bypass it.
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
// Leaf module: it holds nothing but the `-Promo` suffix, so asking "is this a promo card?" never
// drags `PromoManager` (and the whole catalogue loader) into the currency module.
import { isPromoSetId } from './PromoSet.js';

/**
 * Origins of a balance movement, written in `stats.sparksEarnedBySource` / `sparksSpentBySource`.
 *
 * They are stable identifiers: the labels live in `settings/i18n/*.json` under
 * `stats.sparks.source.<id>`, so a new origin only needs one entry here and one key per dictionary.
 */
export const SPARKS_SOURCES = Object.freeze({
  BOOSTER: 'booster',
  SALE: 'sale',
  DAILY: 'daily',
  MINING: 'mining',
  REDEEM: 'redeem',
  GIFT: 'gift',
  CARD: 'card',
  FEATURE: 'feature',
  MINE_PICK: 'minepick',
  TRADER: 'trader',
  ILLAGER: 'illager',
  QUEST: 'quest',
  OTHER: 'other',
});

/** Origins that can credit the balance, in display order. */
export const SPARKS_EARNED_SOURCES = Object.freeze([
  SPARKS_SOURCES.BOOSTER,
  SPARKS_SOURCES.SALE,
  SPARKS_SOURCES.DAILY,
  SPARKS_SOURCES.MINING,
  SPARKS_SOURCES.REDEEM,
  SPARKS_SOURCES.GIFT,
  SPARKS_SOURCES.ILLAGER,
  SPARKS_SOURCES.QUEST,
  SPARKS_SOURCES.OTHER,
]);

/** Origins that can debit the balance, in display order. */
export const SPARKS_SPENT_SOURCES = Object.freeze([
  SPARKS_SOURCES.CARD,
  SPARKS_SOURCES.BOOSTER,
  SPARKS_SOURCES.FEATURE,
  SPARKS_SOURCES.MINE_PICK,
  SPARKS_SOURCES.TRADER,
  SPARKS_SOURCES.OTHER,
]);

/** Error code thrown when the balance does not cover a purchase. */
export const INSUFFICIENT_SPARKS = 'INSUFFICIENT_SPARKS';

/** Error code thrown when a sale would remove the last copy of a card. */
export const LAST_COPY_PROTECTED = 'LAST_COPY_PROTECTED';

/** Error code thrown when a promo card is bought or sold, which is never allowed. */
export const PROMO_PROTECTED = 'PROMO_PROTECTED';

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
   * @param {string} [source=SPARKS_SOURCES.OTHER] - Origin of the credit, recorded in the ledger.
   * @returns {Promise<number>} The resulting balance.
   * @throws {TypeError} When `amount` is not a positive integer.
   * @throws {Error} When the write fails.
   */
  async addSparks(amount, context = null, source = SPARKS_SOURCES.OTHER) {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new TypeError(`SparksManager.addSparks expects a positive integer (received: ${JSON.stringify(amount)}).`);
    }

    const apply = (activeContext) => this.applyDelta(activeContext, amount, source);

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
   * @param {string} [source=SPARKS_SOURCES.OTHER] - Origin of the movement, recorded in the ledger.
   * @returns {Promise<number>} The resulting balance.
   * @throws {SparksError} With `INSUFFICIENT_SPARKS` when the delta would make the balance negative.
   */
  async applyDelta(context, delta, source = SPARKS_SOURCES.OTHER) {
    const balance = this.normalizeBalance(await context.get(STORES.USER_STATE, USER_STATE_KEYS.SPARKS));
    const next = balance + delta;
    if (next < 0) {
      throw new SparksError(
        INSUFFICIENT_SPARKS,
        `The balance (${balance}) does not cover the amount (${Math.abs(delta)}).`
      );
    }
    await context.put(STORES.USER_STATE, next, USER_STATE_KEYS.SPARKS);
    await this.recordFlow(context, delta >= 0 ? { earned: delta, source } : { spent: -delta, source });
    return next;
  }

  /**
   * Records a balance movement in `user_state["stats"]`.
   *
   * Called by `applyDelta` for every debit and credit; the flows that write the balance themselves
   * (a booster reward, a gift) call it once next to their own write, inside the same transaction,
   * so the ledger and the balance always agree.
   *
   * @param {object} context - Transaction context.
   * @param {object} flow - Movement to record.
   * @param {number} [flow.earned=0] - Sparks credited.
   * @param {number} [flow.spent=0] - Sparks debited.
   * @param {string} [flow.source=SPARKS_SOURCES.OTHER] - Origin of the movement.
   * @returns {Promise<void>} Resolves once the ledger is written.
   */
  async recordFlow(context, { earned = 0, spent = 0, source = SPARKS_SOURCES.OTHER } = {}) {
    const credited = Number.isInteger(earned) && earned > 0 ? earned : 0;
    const debited = Number.isInteger(spent) && spent > 0 ? spent : 0;
    if (credited === 0 && debited === 0) return;

    const stored = await context.get(STORES.USER_STATE, USER_STATE_KEYS.STATS);
    const stats = stored && typeof stored === 'object' ? { ...stored } : {};
    stats.sparksEarned =
      (Number.isInteger(stats.sparksEarned) && stats.sparksEarned >= 0 ? stats.sparksEarned : 0) + credited;
    stats.sparksSpent =
      (Number.isInteger(stats.sparksSpent) && stats.sparksSpent >= 0 ? stats.sparksSpent : 0) + debited;
    stats.sparksEarnedBySource = SparksManager.incrementSource(
      stats.sparksEarnedBySource,
      SPARKS_EARNED_SOURCES,
      source,
      credited
    );
    stats.sparksSpentBySource = SparksManager.incrementSource(
      stats.sparksSpentBySource,
      SPARKS_SPENT_SOURCES,
      source,
      debited
    );
    await context.put(STORES.USER_STATE, stats, USER_STATE_KEYS.STATS);
  }

  /**
   * Adds an amount to one origin of a per-origin counter, keeping the known origins at zero.
   *
   * The map is always rebuilt with every known origin, so two rows of the statistics page never
   * disagree on what an untouched origin looks like.
   *
   * @param {unknown} raw - Stored map.
   * @param {readonly string[]} sources - Known origins.
   * @param {string} source - Origin to increment.
   * @param {number} amount - Amount to add (0 leaves the map as is).
   * @returns {Record<string, number>} The rebuilt map.
   */
  static incrementSource(raw, sources, source, amount) {
    const counts = {};
    sources.forEach((id) => {
      counts[id] = 0;
    });
    if (raw && typeof raw === 'object') {
      Object.entries(raw).forEach(([id, value]) => {
        if (Number.isInteger(value) && value >= 0) counts[id] = value;
      });
    }
    if (amount > 0) {
      counts[source] = (Number.isInteger(counts[source]) ? counts[source] : 0) + amount;
    }
    return counts;
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
   *   when the card is not owned; with `PROMO_PROTECTED` when the card belongs to a promo group.
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
        // The stored row is the authority on the group of the card: nothing the caller says can
        // make a promo card look like a drawn one.
        if (isPromoSetId(entry?.set)) {
          throw new SparksError(
            PROMO_PROTECTED,
            `"${key}" belongs to the promo group "${entry.set}": it can never be sold.`
          );
        }
        const quantity = Number.isFinite(entry?.quantity) ? entry.quantity : 0;
        if (quantity - copies < 1) {
          throw new SparksError(
            LAST_COPY_PROTECTED,
            `Selling ${copies} of "${key}" would remove the last copy (owned: ${quantity}).`
          );
        }

        const remaining = quantity - copies;
        await context.put(STORES.COLLECTION, { ...entry, quantity: remaining, lastObtainedAt: entry.lastObtainedAt });
        const balance = await this.applyDelta(context, gained, SPARKS_SOURCES.SALE);
        await this.recordSale(context, rarity, copies);
        return { balance, quantity: remaining, gained };
      }
    );

    this.log(`Sold ${copies} copy(ies) of "${key}" for ${gained} Sparks (balance: ${result.balance}).`);
    // The sale is announced for itself: the quests count the copies sold, which the balance alone
    // cannot tell from a purchase or a gift.
    eventBus.emit(EVENTS.CARD_SOLD, { key, rarity, copies });
    eventBus.emit(EVENTS.SPARKS_UPDATED, { balance: result.balance });
    return result;
  }

  /**
   * Adds sold copies to `user_state["stats"].soldByRarity` and `stats.cardsSold`.
   *
   * Joined to the sale transaction: the counters and the cards move together or not at all. The
   * rest of the record is copied untouched, since the opening counters belong to `BoosterManager`
   * and a sale has no business rewriting them.
   *
   * @param {object} context - Transaction context.
   * @param {number} rarity - Card rarity (1-5). An unknown rarity is not counted at all.
   * @param {number} copies - Number of copies sold (strictly positive).
   * @returns {Promise<void>} Resolves once the counter is written.
   */
  async recordSale(context, rarity, copies) {
    if (!Number.isInteger(rarity) || rarity < 1 || rarity > 5) return;

    const stored = await context.get(STORES.USER_STATE, USER_STATE_KEYS.STATS);
    const stats = stored && typeof stored === 'object' ? { ...stored } : {};
    // Always the full 1..5 grid, like `buildDefaultStats()`: a save written before this counter
    // existed starts at zero everywhere instead of carrying a half-filled map.
    const sold = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    if (stats.soldByRarity && typeof stats.soldByRarity === 'object') {
      Object.entries(stats.soldByRarity).forEach(([key, count]) => {
        if (Number.isInteger(count) && count >= 0) sold[key] = count;
      });
    }
    const previous = Number.isInteger(sold[rarity]) ? sold[rarity] : 0;
    sold[rarity] = previous + copies;
    stats.soldByRarity = sold;
    // The global trophy reads a single total; the per-rarity map stays the source of the bars.
    const soldTotal = Number.isInteger(stats.cardsSold) && stats.cardsSold >= 0
      ? stats.cardsSold
      : Object.values(sold).reduce((sum, count) => sum + count, 0) - copies;
    stats.cardsSold = soldTotal + copies;
    await context.put(STORES.USER_STATE, stats, USER_STATE_KEYS.STATS);
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
   * @throws {SparksError} With `INSUFFICIENT_SPARKS` when the balance does not cover the price, or
   *   with `PROMO_PROTECTED` when the card belongs to a promo group.
   * @throws {Error} When the write fails.
   */
  async buyCard(card) {
    if (!(card instanceof Card)) {
      throw new TypeError('SparksManager.buyCard expects a Card instance.');
    }
    // Checked before the price is even read: a promo card is not part of the economy at all.
    if (isPromoSetId(card.set)) {
      throw new SparksError(
        PROMO_PROTECTED,
        `"${card.uniqueKey}" belongs to the promo group "${card.set}": it can never be bought.`
      );
    }
    const price = await this.getBuyPrice(card.rarity);

    const result = await storageRepository.transaction(
      [STORES.COLLECTION, STORES.USER_STATE],
      'readwrite',
      async (context) => {
        const balance = await this.applyDelta(context, -price, SPARKS_SOURCES.CARD);
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
        return { balance, quantity, spent: price, isNew: !existing };
      }
    );

    this.log(`Bought "${card.uniqueKey}" for ${result.spent} Sparks (balance: ${result.balance}).`);
    eventBus.emit(EVENTS.SPARKS_UPDATED, { balance: result.balance });
    // A purchase is a second way into the collection (the first being an opening): publishing it
    // lets the trophies, the experience and the notifications follow a bought card. A duplicate
    // grants nothing, so `newKeys` is empty in that case.
    eventBus.emit(EVENTS.CARDS_OBTAINED, {
      cards: [card],
      newKeys: result.isNew ? [card.uniqueKey] : [],
      source: 'purchase',
    });
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

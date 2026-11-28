/**
 * EnderPearlManager - The Ender Pearls of the inventory.
 *
 * Reference: `js/business/TradeManager.js` (the Ender Eyes they convert into) and the inventory
 * dialog of `js/app.js`.
 *
 * WHAT IT IS
 * An Ender Pearl is an ITEM, not a currency: it is stored in `user_state["items"]` (a record keyed
 * by item id, `{ pearl: 2 }` today), it is only visible in the inventory, and the player decides
 * when to spend it. Using one adds one Ender Eye to the trade stock (`user_state["trades"]`), which
 * is the only thing Ender Eyes are spent on today.
 *
 * THE CAP
 * The trade stock is capped at `TRADE_MAX_ENDER_EYES` (5): a pearl is refused when the stock is
 * already full, instead of being consumed for nothing. The daily refill of `TradeManager` keeps its
 * own rule (one Eye per UTC day, never above the cap); the pearl is an EXTRA way to fill that stock,
 * it never raises the ceiling.
 *
 * DISTRIBUTION
 * A pearl travels through every channel the game already has for its items: a promo code
 * (`settings/codes.json`, `RewardType: "Pearl"`), a personal code (`canonicalPearl()`), a
 * distribution row of the gift sheet (`type: pearl`) and a day of the daily connection rewards
 * (`Type: "Ender Pearl"`). All of them funnel into `grantPearls()`, which accepts an open
 * transaction context so a code or a gift stays all-or-nothing.
 *
 * A pearl never expires and is never converted automatically: the only way it leaves the inventory
 * is `usePearl()`.
 */

import { storageRepository, STORES } from '../models/StorageRepository.js';
import { USER_STATE_KEYS } from './AccountManager.js';
import { TRADE_MAX_ENDER_EYES } from './TradeManager.js';
import eventBus, { EVENTS } from '../utils/EventBus.js';

/** Id of the item in the inventory, in the save and in the distributions. */
export const PEARL_ITEM_ID = 'pearl';

/** Texture of the item, drawn in the inventory. */
export const PEARL_TEXTURE = 'assets/img/items/Ender_Pearl.webp';

/** Maximum number of Ender Eyes an account can hold; the same ceiling as the trades. */
export const PEARL_MAX_ENDER_EYES = TRADE_MAX_ENDER_EYES;

/** Stable error codes, so the caller never parses a message. */
export const PEARL_ERROR_CODES = Object.freeze({
  NONE: 'none',
  ENDER_EYES_FULL: 'enderEyesFull',
});

/** Raised when a pearl cannot be used. */
export class PearlError extends Error {
  /**
   * @param {string} code - One of `PEARL_ERROR_CODES`.
   * @param {string} message - Technical description (logged, not shown to the player).
   */
  constructor(code, message) {
    super(message);
    this.name = 'PearlError';
    this.code = code;
  }
}

/**
 * Normalizes the stored inventory.
 *
 * A missing record is an empty inventory; an unreadable quantity is zero, never a negative stock.
 * The record is SHARED by every inventory item (`pearl`, `golden_pickaxe`): an item this module does
 * not know is kept as it is, otherwise writing the pearls would silently erase the other stocks.
 *
 * @param {unknown} raw - Value of `user_state["items"]`.
 * @returns {Record<string, number>} A writable inventory, always holding `pearl`.
 */
export function normalizeInventory(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const inventory = {};
  Object.entries(source).forEach(([id, value]) => {
    const count = Number(value);
    if (Number.isInteger(count) && count > 0) inventory[id] = count;
  });
  inventory[PEARL_ITEM_ID] = inventory[PEARL_ITEM_ID] ?? 0;
  return inventory;
}

/**
 * Clamps the stored Ender Eyes balance exactly like `TradeManager`.
 *
 * A missing balance is the INITIAL stock (5), not zero: the two modules must agree, otherwise a
 * pearl would be refused on a fresh save by this one and counted as spendable by the trades.
 *
 * @param {unknown} value - Balance read from the save.
 * @returns {number} A balance between 0 and `PEARL_MAX_ENDER_EYES`.
 */
function normalizeEyes(value) {
  if (value === null || value === undefined || value === '') return PEARL_MAX_ENDER_EYES;
  const eyes = Number(value);
  if (!Number.isInteger(eyes) || eyes < 0) return PEARL_MAX_ENDER_EYES;
  return Math.min(PEARL_MAX_ENDER_EYES, eyes);
}

export class EnderPearlManager {
  /**
   * Logs with the manager prefix.
   *
   * @param {...unknown} args - Values forwarded to `console.info`.
   * @returns {void}
   */
  log(...args) {
    console.info('[EnderPearlManager]', ...args);
  }

  /**
   * Reads the stored inventory.
   *
   * @returns {Promise<{pearl: number}>} The inventory.
   */
  async getInventory() {
    return normalizeInventory(await storageRepository.getUserState(USER_STATE_KEYS.ITEMS));
  }

  /**
   * Number of Ender Pearls the player owns.
   *
   * @returns {Promise<number>} The count (0 when the save cannot be read).
   */
  async getCount() {
    try {
      return (await this.getInventory())[PEARL_ITEM_ID];
    } catch (error) {
      console.warn('[EnderPearlManager] The inventory could not be read.', error);
      return 0;
    }
  }

  /**
   * Adds pearls to the inventory.
   *
   * When `context` is provided the write joins the caller's transaction (a code, a gift, a daily
   * reward): nothing is announced here, as the caller knows when its own commit happened. Without a
   * context the manager opens its own transaction and publishes `PEARLS_UPDATED`.
   *
   * @param {number} quantity - Number of pearls to add (positive integer).
   * @param {object|null} [context=null] - Open write context of `storageRepository.transaction`.
   * @returns {Promise<number>} The new count.
   * @throws {TypeError} When the quantity is not a positive integer.
   * @throws {Error} When the write fails.
   */
  async grantPearls(quantity, context = null) {
    const amount = Math.trunc(Number(quantity));
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new TypeError(`EnderPearlManager.grantPearls expects a positive integer (received: ${quantity}).`);
    }

    const apply = async (target) => {
      const inventory = normalizeInventory(await target.get(STORES.USER_STATE, USER_STATE_KEYS.ITEMS));
      const next = { ...inventory, [PEARL_ITEM_ID]: inventory[PEARL_ITEM_ID] + amount };
      await target.put(STORES.USER_STATE, next, USER_STATE_KEYS.ITEMS);
      return next[PEARL_ITEM_ID];
    };

    if (context) return apply(context);

    const count = await storageRepository.transaction([STORES.USER_STATE], 'readwrite', apply);
    eventBus.emit(EVENTS.PEARLS_UPDATED, { count });
    this.log(`${amount} Ender Pearl(s) granted (stock: ${count}).`);
    return count;
  }

  /**
   * Spends one pearl and credits one Ender Eye.
   *
   * Both writes share ONE transaction: a refused use (no pearl, or a full stock) leaves the save
   * untouched, and a committed use can never take a pearl without giving its Eye. The header and
   * the inventory are published once the commit is done.
   *
   * @returns {Promise<{count: number, enderEyes: number}>} The remaining pearls and the new stock.
   * @throws {PearlError} With `none` when the inventory is empty, `enderEyesFull` at the cap.
   * @throws {Error} When the write fails.
   */
  async usePearl() {
    const result = await storageRepository.transaction(
      [STORES.USER_STATE],
      'readwrite',
      async (context) => {
        const inventory = normalizeInventory(
          await context.get(STORES.USER_STATE, USER_STATE_KEYS.ITEMS)
        );
        if (inventory[PEARL_ITEM_ID] < 1) {
          throw new PearlError(PEARL_ERROR_CODES.NONE, 'No Ender Pearl to use.');
        }

        const storedTrades = await context.get(STORES.USER_STATE, USER_STATE_KEYS.TRADES);
        const trades =
          storedTrades && typeof storedTrades === 'object' && !Array.isArray(storedTrades)
            ? { ...storedTrades }
            : {};
        const eyes = normalizeEyes(trades.enderEyes);
        if (eyes >= PEARL_MAX_ENDER_EYES) {
          throw new PearlError(
            PEARL_ERROR_CODES.ENDER_EYES_FULL,
            `The Ender Eyes stock is already full (${PEARL_MAX_ENDER_EYES}).`
          );
        }

        const count = inventory[PEARL_ITEM_ID] - 1;
        const enderEyes = Math.min(PEARL_MAX_ENDER_EYES, eyes + 1);
        await context.put(
          STORES.USER_STATE,
          { ...inventory, [PEARL_ITEM_ID]: count },
          USER_STATE_KEYS.ITEMS
        );
        await context.put(STORES.USER_STATE, { ...trades, enderEyes }, USER_STATE_KEYS.TRADES);
        return { count, enderEyes };
      }
    );

    eventBus.emit(EVENTS.PEARLS_UPDATED, { count: result.count });
    eventBus.emit(EVENTS.TRADES_UPDATED, { balance: result.enderEyes });
    this.log(`1 Ender Pearl used: ${result.count} left, ${result.enderEyes} Ender Eye(s).`);
    return result;
  }
}

/** Shared instance used by the inventory, the codes, the gifts and the daily rewards. */
export const enderPearlManager = new EnderPearlManager();

export default enderPearlManager;

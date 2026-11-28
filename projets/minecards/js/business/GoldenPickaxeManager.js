/**
 * GoldenPickaxeManager - The Golden Pickaxes of the inventory.
 *
 * Reference: `js/business/EnderPearlManager.js` (the inventory items and their distribution),
 * `js/business/MinePickManager.js` (the daily picks and the board of the day) and the inventory
 * dialog of `js/app.js`.
 *
 * WHAT IT IS
 * A Golden Pickaxe is an ITEM, stored in `user_state["items"]` next to the Ender Pearls, and the
 * player decides when to spend it. Using one gives ONE extra Mine Pick for the current UTC day:
 * the daily allowance stays three, this is a fourth (fifth, …) pick on top of it.
 *
 * THE TWO GUARDS
 * A golden pickaxe is only worth spending once the day's free picks are partly gone, and only while
 * there is still a booster to open:
 *   - at least one of the `minePick.picksPerDay` picks must already be spent, otherwise the extra
 *     pick would buy nothing;
 *   - the board of the day must still hold a booster nobody picked from, otherwise the extra pick
 *     would have nothing to open.
 * Both refusals have their own error code (and their own sentence), so the player reads which one
 * stopped them instead of a generic failure.
 *
 * A USE IS ONE TRANSACTION
 * The item is taken and the extra pick is stored in the SAME `user_state` transaction: a failure can
 * never spend a pickaxe without its pick, and the two writes can not race a pick started meanwhile.
 * The stock is announced (`GOLDEN_PICKAXES_UPDATED`) and the Mine Pick state republished
 * (`MINE_PICK_UPDATED`) once the commit landed.
 *
 * DISTRIBUTION
 * Like the Ender Pearl, a pickaxe travels through a promo code, a personal code, a gift row and a
 * day of the daily connection rewards, all of them funnelling into `grant()`.
 */

import { storageRepository, STORES } from '../models/StorageRepository.js';
import { USER_STATE_KEYS } from './AccountManager.js';
import { normalizeInventory } from './EnderPearlManager.js';
import minePickManager from './MinePickManager.js';
import { configLoader } from '../utils/ConfigLoader.js';
import dateSyncManager from './DateSyncManager.js';
import eventBus, { EVENTS } from '../utils/EventBus.js';

/** Id of the item in the inventory, in the save and in the distributions. */
export const GOLDEN_PICKAXE_ITEM_ID = 'golden_pickaxe';

/** Texture of the item, drawn in the inventory. */
export const GOLDEN_PICKAXE_TEXTURE = 'assets/img/items/Golden_Pickaxe.png';

/** Stable error codes, so the caller never parses a message. */
export const GOLDEN_PICKAXE_ERROR_CODES = Object.freeze({
  NONE: 'none',
  PICKS_UNTOUCHED: 'picksUntouched',
  NO_BOOSTER_LEFT: 'noBoosterLeft',
  NO_BOARD: 'noBoard',
});

/** Raised when a golden pickaxe cannot be used. */
export class GoldenPickaxeError extends Error {
  /**
   * @param {string} code - One of `GOLDEN_PICKAXE_ERROR_CODES`.
   * @param {string} message - Technical description (logged, not shown to the player).
   */
  constructor(code, message) {
    super(message);
    this.name = 'GoldenPickaxeError';
    this.code = code;
  }
}

export class GoldenPickaxeManager {
  /**
   * Logs with the manager prefix.
   *
   * @param {...unknown} args - Values forwarded to `console.info`.
   * @returns {void}
   */
  log(...args) {
    console.info('[GoldenPickaxeManager]', ...args);
  }

  /**
   * Number of Golden Pickaxes the player owns.
   *
   * @returns {Promise<number>} The count (0 when the save cannot be read).
   */
  async getCount() {
    try {
      const inventory = normalizeInventory(
        await storageRepository.getUserState(USER_STATE_KEYS.ITEMS)
      );
      return inventory[GOLDEN_PICKAXE_ITEM_ID];
    } catch (error) {
      console.warn('[GoldenPickaxeManager] The inventory could not be read.', error);
      return 0;
    }
  }

  /**
   * Adds pickaxes to the inventory.
   *
   * When `context` is provided the write joins the caller's transaction (a code, a gift, a daily
   * reward): nothing is announced here, as the caller knows when its own commit happened. Without a
   * context the manager opens its own transaction and publishes `GOLDEN_PICKAXES_UPDATED`.
   *
   * @param {number} quantity - Number of pickaxes to add (positive integer).
   * @param {object|null} [context=null] - Open write context of `storageRepository.transaction`.
   * @returns {Promise<number>} The new count.
   * @throws {TypeError} When the quantity is not a positive integer.
   * @throws {Error} When the write fails.
   */
  async grant(quantity, context = null) {
    const amount = Math.trunc(Number(quantity));
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new TypeError(`GoldenPickaxeManager.grant expects a positive integer (received: ${quantity}).`);
    }

    const apply = async (target) => {
      const inventory = normalizeInventory(await target.get(STORES.USER_STATE, USER_STATE_KEYS.ITEMS));
      const next = {
        ...inventory,
        [GOLDEN_PICKAXE_ITEM_ID]: (inventory[GOLDEN_PICKAXE_ITEM_ID] ?? 0) + amount,
      };
      await target.put(STORES.USER_STATE, next, USER_STATE_KEYS.ITEMS);
      return next[GOLDEN_PICKAXE_ITEM_ID];
    };

    if (context) return apply(context);

    const count = await storageRepository.transaction([STORES.USER_STATE], 'readwrite', apply);
    eventBus.emit(EVENTS.GOLDEN_PICKAXES_UPDATED, { count });
    this.log(`${amount} Golden Pickaxe(s) granted (stock: ${count}).`);
    return count;
  }

  /**
   * Tells whether a pickaxe can be used right now, and why not.
   *
   * Read by the inventory to grey out its button and to say which rule is missing, so the player
   * never has to click to learn it.
   *
   * @returns {Promise<{count: number, canUse: boolean, reason: string|null}>} The stock and the
   *   verdict (`GOLDEN_PICKAXE_ERROR_CODES` member, or null when it can be used).
   */
  async getAvailability() {
    const count = await this.getCount();
    if (count < 1) return { count, canUse: false, reason: GOLDEN_PICKAXE_ERROR_CODES.NONE };

    let state;
    let board;
    try {
      [state, board] = await Promise.all([minePickManager.getState(), minePickManager.getBoard()]);
    } catch (error) {
      console.warn('[GoldenPickaxeManager] The Mine Pick state could not be read.', error);
      return { count, canUse: false, reason: GOLDEN_PICKAXE_ERROR_CODES.NO_BOARD };
    }

    if (state.remaining >= state.picksPerDay) {
      return { count, canUse: false, reason: GOLDEN_PICKAXE_ERROR_CODES.PICKS_UNTOUCHED };
    }
    if (Object.keys(state.picksByBooster).length >= board.length) {
      return { count, canUse: false, reason: GOLDEN_PICKAXE_ERROR_CODES.NO_BOOSTER_LEFT };
    }
    return { count, canUse: true, reason: null };
  }

  /**
   * Spends one pickaxe and grants one extra Mine Pick for the current UTC day.
   *
   * @returns {Promise<{count: number, remaining: number}>} The remaining pickaxes and the picks left.
   * @throws {GoldenPickaxeError} With `none`, `picksUntouched`, `noBoosterLeft` or `noBoard`.
   * @throws {Error} When the write fails.
   */
  async use() {
    const { picksPerDay } = await configLoader.getMinePickSettings();
    let board;
    try {
      board = await minePickManager.getBoard();
    } catch (error) {
      throw new GoldenPickaxeError(
        GOLDEN_PICKAXE_ERROR_CODES.NO_BOARD,
        `The Mine Pick board could not be read: ${error?.message ?? error}`
      );
    }
    const trustedDay = dateSyncManager.isTimeTrusted() ? minePickManager.getDay() : null;

    const result = await storageRepository.transaction(
      [STORES.USER_STATE],
      'readwrite',
      async (context) => {
        const inventory = normalizeInventory(
          await context.get(STORES.USER_STATE, USER_STATE_KEYS.ITEMS)
        );
        const owned = inventory[GOLDEN_PICKAXE_ITEM_ID] ?? 0;
        if (owned < 1) {
          throw new GoldenPickaxeError(GOLDEN_PICKAXE_ERROR_CODES.NONE, 'No Golden Pickaxe to use.');
        }

        // The daily allowance is resolved inside the transaction, exactly like a pick does: the
        // guards below must read the state of the SAME moment the extra pick is written to.
        const stored = minePickManager.normalizeState(
          await context.get(STORES.USER_STATE, USER_STATE_KEYS.MINE_PICK),
          picksPerDay
        );
        const state = minePickManager.resolveDailyRollover(stored, trustedDay, picksPerDay);

        if (state.remaining >= picksPerDay) {
          throw new GoldenPickaxeError(
            GOLDEN_PICKAXE_ERROR_CODES.PICKS_UNTOUCHED,
            'Every free pick of the day is still available.'
          );
        }
        if (Object.keys(state.picksByBooster).length >= board.length) {
          throw new GoldenPickaxeError(
            GOLDEN_PICKAXE_ERROR_CODES.NO_BOOSTER_LEFT,
            'Every booster of the board was already picked from.'
          );
        }

        const count = owned - 1;
        const nextState = {
          ...state,
          lastResetDay: trustedDay ?? state.lastResetDay,
          bonusPicks: state.bonusPicks + 1,
        };
        await context.put(
          STORES.USER_STATE,
          { ...inventory, [GOLDEN_PICKAXE_ITEM_ID]: count },
          USER_STATE_KEYS.ITEMS
        );
        await context.put(STORES.USER_STATE, nextState, USER_STATE_KEYS.MINE_PICK);
        return { count, bonusPicks: nextState.bonusPicks };
      }
    );

    eventBus.emit(EVENTS.GOLDEN_PICKAXES_UPDATED, { count: result.count });
    await minePickManager.emitStateUpdated();
    this.log(`1 Golden Pickaxe used: ${result.count} left, ${result.bonusPicks} extra pick(s).`);
    return { count: result.count, remaining: result.bonusPicks };
  }
}

/** Shared instance used by the inventory and by the distributions. */
export const goldenPickaxeManager = new GoldenPickaxeManager();

export default goldenPickaxeManager;

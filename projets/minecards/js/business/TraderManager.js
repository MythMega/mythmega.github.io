/**
 * TraderManager - the Wandering Trader: a weekly shop paid in what the mine harvests.
 *
 * Reference: `settings/config.json` (`shop`), `data/shop/pinned_offers.json`, `js/business/MiningManager.js`
 * (the resources spent here) and `js/business/BoosterManager.js` (the cards granted here).
 *
 * WHAT THE PLAYER SEES
 *   The trading screen of the mine (the "Marchand itinérant" button). It holds three kinds of
 *   offers:
 *   - the WEEKLY offers: five cards drawn for everybody, two of rarity 1, one of rarity 2, one of
 *     rarity 3 and one of rarity 4 (`shop.offers`). Each one is priced in exactly three kinds of
 *     mined resource, and the whole price is worth the rarity of the card (`shop.rarityValues` /
 *     `shop.itemsValues`).
 *   - the PINNED offers: hand-written in `data/shop/pinned_offers.json`, never random. Each one
 *     carries its own card, its own price, the window it is sold in and its stock (`MaxUse`).
 *   - the DAILY TRADES: `shop.tradesPerDay` (3) resource-for-resource swaps, drawn from the UTC
 *     day alone (see below). Each one is worth the same on both sides and can be taken in either
 *     direction, once per day.
 *
 * THE DAILY TRADES
 *   Two mined resources are drawn, and the amounts follow their VALUES: the dearest side is one
 *   unit, the cheapest one as many units as it takes to match it (`1 Ultima` against `2 Void Dust`).
 *   One side is therefore always 1, which is what forbids a trade to be scaled up (`2 Ultima`
 *   against `4 Void Dust` is the same trade written twice). A pair whose values are not a multiple
 *   of one another has no such exchange at all (`Glowstone Dust` at 20 and `Void Dust` at 50), so
 *   the pair is dropped and another one is drawn; the same pair is never drawn twice in a day.
 *   The draw is seeded with the salt of the configuration and the UTC day ONLY, exactly like the
 *   weekly shop: every player sees the same three trades, and they roll over at midnight UTC.
 *
 * THE SAME SHOP FOR EVERYONE
 *   The weekly seed is built from the date of the MONDAY of the current week and nothing else: no
 *   account UUID, no `Math.random()`. Two players opening the screen at the same moment therefore
 *   see the same five cards at the same price, and a reload never changes them. The shop rerolls by
 *   itself on Monday (00:00 UTC), which is what `week` in the state follows.
 *
 * WHAT IS PERSISTED (`user_state["trader"]`)
 *   `week`      : the Monday the stored purchases belong to;
 *   `purchases` : `{ [offerKey]: count }` — how many times each offer was bought THIS week. A state
 *                 whose `week` is not the current one is read as empty, which is the reroll.
 *
 * A purchase is committed in ONE transaction (the mined resources, the collection row and the
 * purchase count, all three in the same read-modify-write): a failure can never charge the price
 * without granting the card. The obtained card is announced through `CARDS_OBTAINED`
 * (`source: 'trader'`), exactly like a picked or a drawn one.
 */

import { storageRepository, STORES } from '../models/StorageRepository.js';
import { configLoader } from '../utils/ConfigLoader.js';
import eventBus, { EVENTS } from '../utils/EventBus.js';
import dateSyncManager from './DateSyncManager.js';
import { USER_STATE_KEYS } from './AccountManager.js';
import boosterManager, { BoosterManager } from './BoosterManager.js';
import promoManager from './PromoManager.js';
import miningManager, { resourceSlug } from './MiningManager.js';
import { createSeededRandom, hashSeed } from './MinePickManager.js';

/** Source carried by the `CARDS_OBTAINED` event of a bought card. */
export const TRADER_SOURCE = 'trader';

/** Prefix of the key of a weekly offer (`weekly-<week>-<rarity>-<rank>`). */
export const WEEKLY_OFFER_PREFIX = 'weekly';

/** Prefix of the key of a pinned offer (`pinned-<OfferID>`). */
export const PINNED_OFFER_PREFIX = 'pinned';

/** Prefix of the key of a daily trade (`swap-<day>-<rank>`). */
export const TRADE_PREFIX = 'swap';

/** How many pairs a daily trade draw tries before falling back to a deterministic pick. */
const TRADE_ATTEMPTS = 40;

/** How many daily trades a shop shows when `shop.tradesPerDay` is absent from the configuration. */
export const DEFAULT_TRADES_PER_DAY = 3;

/** How many times the SAME trade may be taken in a day (a trade is an exchange, not a faucet). */
export const TRADE_MAX_USES = 1;

/** How many distinct resource kinds a price is built from. */
export const PRICE_ITEM_COUNT = 3;

/** Highest quantity a single price line may ask for before another price is preferred. */
const PRICE_MAX_QUANTITY = 30;

/** How many card draws are tried before giving up on a rarity (a pool smaller than the demand). */
const DRAW_ATTEMPTS = 8;

/** Error codes raised by this manager. */
export const TRADER_ERRORS = Object.freeze({
  NO_OFFER: 'NO_OFFER',
  SOLD_OUT: 'SOLD_OUT',
  INSUFFICIENT_RESOURCES: 'INSUFFICIENT_RESOURCES',
  NO_CARD: 'NO_CARD',
  NO_PRICE: 'NO_PRICE',
  NO_TRADE: 'NO_TRADE',
});

/** i18n keys of the error codes, so a view never invents its own message. */
const ERROR_MESSAGE_KEYS = Object.freeze({
  [TRADER_ERRORS.NO_OFFER]: 'mineblock.trader.error.offer',
  [TRADER_ERRORS.SOLD_OUT]: 'mineblock.trader.error.soldOut',
  [TRADER_ERRORS.INSUFFICIENT_RESOURCES]: 'mineblock.trader.error.resources',
  [TRADER_ERRORS.NO_CARD]: 'mineblock.trader.error.card',
  [TRADER_ERRORS.NO_PRICE]: 'mineblock.trader.error.price',
  [TRADER_ERRORS.NO_TRADE]: 'mineblock.trader.error.trade',
});

/**
 * Returns the i18n key describing a trader error code.
 *
 * @param {unknown} code - Error code (`TRADER_ERRORS`).
 * @returns {string} The translation key, falling back to the generic one.
 */
export function getTraderErrorMessageKey(code) {
  return ERROR_MESSAGE_KEYS[code] ?? 'mineblock.trader.error.generic';
}

/**
 * Turns one option of the price of a card into the price of a card.
 *
 * A price is a list of `PRICE_ITEM_COUNT` (3) LINES, each one a mined resource and a quantity, and
 * the lines are worth exactly the rarity of the card:
 *
 *   `quantity[0] * value[0] + quantity[1] * value[1] + quantity[2] * value[2] === target`
 *
 * HOW THE QUANTITIES ARE CHOSEN. The three resources are drawn first (distinct, from the ones the
 * configuration gives a value to), then EVERY combination of quantities that pays the target
 * exactly is enumerated (the third line absorbs the remainder, so it must divide it). The
 * combinations asking for the smallest piles are kept, and the seeded generator picks one of them:
 * the price is therefore always exact, never absurd (asking for 400 times the same dust), and still
 * different from one card to the next. A draw that has no solution at all (a resource worth more
 * than the whole target, for instance) is replaced by another draw, which is why the enumeration is
 * wrapped in a few attempts.
 */
export class TraderPrice {
  /**
   * Builds the price of a card.
   *
   * @param {object} options - Price options.
   * @param {number} options.target - Total value of the price (the rarity value of the card).
   * @param {Array<{slug: string, type: string, texture: string, value: number}>} options.pool -
   *   Mined resources carrying a value, from the configuration.
   * @param {() => number} options.random - Seeded generator returning a float in [0, 1).
   * @returns {Array<{slug: string, type: string, texture: string, value: number, quantity: number, total: number}>}
   *   The lines of the price, dearest first.
   * @throws {TraderError} With `NO_PRICE` when no combination pays the target exactly.
   */
  static build({ target, pool, random }) {
    const usable = pool.filter((item) => Number.isFinite(item.value) && item.value > 0);
    if (usable.length < PRICE_ITEM_COUNT) {
      throw new TraderError(
        TRADER_ERRORS.NO_PRICE,
        `A price needs ${PRICE_ITEM_COUNT} distinct resources: ${usable.length} carry a value.`
      );
    }
    dateSyncManager.assertPositiveInteger(target);

    for (let attempt = 0; attempt < DRAW_ATTEMPTS * 3; attempt += 1) {
      // Dearest first: `enumerate()` reads its quantities in that order, and so does the display.
      const picks = TraderPrice.pickItems(usable, random).sort((left, right) => right.value - left.value);
      const candidates = TraderPrice.enumerate(picks, target);
      if (candidates.length === 0) continue;

      // The cheapest pile wins: a price is read at a glance, so no line may ask for a mountain of
      // one dust to pay for a card. Among the three best combinations, the seed still chooses.
      const shortlist = candidates.slice(0, 3);
      const chosen = shortlist[Math.min(shortlist.length - 1, Math.floor(random() * shortlist.length))];

      return picks.map((item, index) => ({
        slug: item.slug,
        type: item.type,
        nameKey: item.nameKey,
        texture: item.texture,
        value: item.value,
        quantity: chosen.quantities[index],
        total: chosen.quantities[index] * item.value,
      }));
    }

    throw new TraderError(
      TRADER_ERRORS.NO_PRICE,
      `No combination of resources pays exactly ${target} with the configured values.`
    );
  }

  /**
   * Draws `PRICE_ITEM_COUNT` distinct resources.
   *
   * @param {Array<object>} pool - Resources carrying a value.
   * @param {() => number} random - Seeded generator.
   * @returns {Array<object>} The drawn resources, in draw order.
   */
  static pickItems(pool, random) {
    const remaining = pool.slice();
    const picks = [];
    while (picks.length < PRICE_ITEM_COUNT && remaining.length > 0) {
      const index = Math.min(remaining.length - 1, Math.floor(random() * remaining.length));
      picks.push(remaining[index]);
      remaining.splice(index, 1);
    }
    return picks;
  }

  /**
   * Enumerates every combination of quantities paying the target exactly.
   *
   * The dearest resource of the trio is counted down first, then the second one, and the CHEAPEST
   * one absorbs what is left (it must divide it): each line is therefore worth at least one unit,
   * and every solution reaches the target to the unit.
   *
   * @param {Array<{value: number}>} picks - The three drawn resources, dearest first.
   * @param {number} target - Total value to pay.
   * @returns {Array<{quantities: number[], max: number}>} The combinations, best (cheapest pile) first.
   */
  static enumerate(picks, target) {
    const [first, second, third] = picks;
    const candidates = [];
    const maxFirst = Math.floor((target - second.value - third.value) / first.value);
    for (let countFirst = maxFirst; countFirst >= 1; countFirst -= 1) {
      const afterFirst = target - countFirst * first.value;
      const maxSecond = Math.floor((afterFirst - third.value) / second.value);
      for (let countSecond = maxSecond; countSecond >= 1; countSecond -= 1) {
        const rest = afterFirst - countSecond * second.value;
        if (rest < third.value || rest % third.value !== 0) continue;
        const quantities = [countFirst, countSecond, rest / third.value];
        candidates.push({ quantities, max: Math.max(...quantities) });
        if (candidates.length >= 40) break;
      }
      if (candidates.length >= 40) break;
    }
    // A price that asks for a mountain of one dust is only kept when nothing else pays the target.
    const reasonable = candidates.filter((candidate) => candidate.max <= PRICE_MAX_QUANTITY);
    const usableCandidates = reasonable.length > 0 ? reasonable : candidates;
    return usableCandidates.slice().sort((left, right) => left.max - right.max);
  }
}

/**
 * Draws the resource-for-resource trades of a day.
 *
 * A trade is an EQUATION, and the whole class exists to keep it true: the dearest resource counts
 * one unit, the cheapest one as many units as its value asks for, and a pair whose values are not a
 * multiple of one another is simply not a trade (`Glowstone Dust` at 20 against `Void Dust` at 50
 * has no solution in whole units, so it is never offered). One side is therefore always 1, which is
 * what stops a trade from being written twice as large.
 */
export class TraderTrade {
  /**
   * Builds the trades of one day.
   *
   * @param {object} options - Draw options.
   * @param {number} options.count - How many trades to draw.
   * @param {Array<{slug: string, type: string, nameKey: string, texture: string, value: number}>} options.pool
   *   The priced resources of the mine.
   * @param {() => number} options.random - Seeded generator returning a float in [0, 1).
   * @returns {Array<{left: object, right: object}>} The trades, each side carrying its `quantity`.
   *   `left` is always the dearest side (quantity 1), `right` the cheapest one.
   */
  static build({ count, pool, random }) {
    const usable = pool.filter((item) => Number.isFinite(item.value) && item.value > 0);
    const trades = [];
    const used = new Set();
    const wanted = Math.max(0, Math.trunc(Number(count) || 0));

    for (let attempt = 0; attempt < TRADE_ATTEMPTS * Math.max(1, wanted); attempt += 1) {
      if (trades.length >= wanted) break;
      const pair = TraderTrade.pickPair(usable, random);
      if (!pair) break;
      const key = TraderTrade.pairKey(pair[0], pair[1]);
      // A pair the day already offers is redrawn, exactly like a pair whose values do not divide.
      if (used.has(key)) continue;
      const trade = TraderTrade.equation(pair[0], pair[1]);
      if (!trade) continue;
      used.add(key);
      trades.push(trade);
    }

    // A draw that never fell on a usable pair (a configuration with a single divisible pair, for
    // instance) still owes the player their trades: the remaining ones are taken in a fixed order,
    // which keeps the result deterministic.
    if (trades.length < wanted) {
      TraderTrade.listEquations(usable).forEach((trade) => {
        if (trades.length >= wanted) return;
        const key = TraderTrade.pairKey(trade.left, trade.right);
        if (used.has(key)) return;
        used.add(key);
        trades.push(trade);
      });
    }

    return trades;
  }

  /**
   * Draws two distinct resources.
   *
   * @param {Array<object>} pool - Priced resources.
   * @param {() => number} random - Seeded generator.
   * @returns {Array<object>|null} The two resources (draw order), or null when the pool is too small.
   */
  static pickPair(pool, random) {
    if (pool.length < 2) return null;
    const remaining = pool.slice();
    const picks = [];
    while (picks.length < 2 && remaining.length > 0) {
      const index = Math.min(remaining.length - 1, Math.floor(random() * remaining.length));
      picks.push(remaining[index]);
      remaining.splice(index, 1);
    }
    return picks.length === 2 ? picks : null;
  }

  /**
   * Turns two resources into a trade, or refuses the pair.
   *
   * @param {object} first - One resource.
   * @param {object} second - The other one.
   * @returns {{left: object, right: object}|null} The trade, or null when the two values do not
   *   divide: `20` against `50` has no whole-unit exchange, so it is never offered. Two resources of
   *   the SAME value are a legitimate pair (`1` against `1`).
   */
  static equation(first, second) {
    const [dearest, cheapest] = [first, second].sort((left, right) => right.value - left.value);
    if (dearest.value % cheapest.value !== 0) return null;
    const ratio = dearest.value / cheapest.value;
    return {
      left: { ...dearest, quantity: 1 },
      right: { ...cheapest, quantity: ratio },
    };
  }

  /**
   * Lists every trade the pool can offer, in a fixed order.
   *
   * @param {Array<object>} pool - Priced resources.
   * @returns {Array<{left: object, right: object}>} The trades.
   */
  static listEquations(pool) {
    const trades = [];
    for (let first = 0; first < pool.length; first += 1) {
      for (let second = first + 1; second < pool.length; second += 1) {
        const trade = TraderTrade.equation(pool[first], pool[second]);
        if (trade) trades.push(trade);
      }
    }
    return trades;
  }

  /**
   * Names a pair of resources, whichever way round it was drawn.
   *
   * @param {{slug: string}} first - One resource.
   * @param {{slug: string}} second - The other one.
   * @returns {string} A stable key (`glowstone_dust|void_dust`).
   */
  static pairKey(first, second) {
    return [first.slug, second.slug].sort().join('|');
  }
}

/** Raised by every refused trader operation, with a stable `code`. */
export class TraderError extends Error {
  /**
   * @param {string} code - One of `TRADER_ERRORS`.
   * @param {string} message - Technical message (the UI shows a translated one).
   */
  constructor(code, message) {
    super(message);
    this.name = 'TraderError';
    this.code = code;
  }
}

export class TraderManager {
  constructor() {
    /** @type {object|null} Shop settings read from `settings/config.json`. */
    this.settings = null;
    /** @type {Array<{slug: string, type: string, texture: string, value: number}>} Priced resources. */
    this.items = [];
    /** @type {Promise<void>|null} In-flight settings load, to de-duplicate concurrent calls. */
    this.settingsPromise = null;
    /** @type {Array<object>|null} Pinned offers read from `data/shop/pinned_offers.json`. */
    this.pinnedEntries = null;
    /** @type {{week: string|null, offers: Array<object>}|null} Cached weekly shop. */
    this.offersCache = null;
    /** @type {Promise<Array<object>>|null} In-flight shop build. */
    this.offersPromise = null;
    /** @type {{day: string, trades: Array<object>}|null} Cached trades of the day. */
    this.tradesCache = null;
    /** @type {Promise<Array<object>>|null} In-flight trade draw. */
    this.tradesPromise = null;
  }

  /**
   * Logs with the manager prefix.
   *
   * @param {...unknown} args - Values forwarded to `console.info`.
   * @returns {void}
   */
  log(...args) {
    console.info('[TraderManager]', ...args);
  }

  /**
   * Loads the shop settings and the prices of the mined resources.
   *
   * @param {object} [options] - Load options.
   * @param {boolean} [options.force=false] - Reload even when already initialized.
   * @returns {Promise<void>} Resolves once the manager is usable.
   * @throws {Error} When `config.json` or the mine rules cannot be read.
   */
  async init({ force = false } = {}) {
    if (this.settings && !force) return;
    if (this.settingsPromise && !force) return this.settingsPromise;

    this.settingsPromise = (async () => {
      const settings = await configLoader.getShopSettings();
      // The prices are read from the MINE: a resource the configuration never harvests cannot be
      // asked for, and a name that matches no reward is simply left out of the pool.
      const resources = await miningManager.listResources();
      const items = resources
        .map((resource) => ({
          slug: resource.slug,
          type: resource.type,
          // The translation key follows the resource, so a price line reads like the chip of the
          // mine (`mineblock.resource.<slug>`) instead of showing the raw type of the file.
          nameKey: resource.nameKey,
          texture: resource.texture,
          value: settings.itemsValues[resource.type] ?? settings.itemsValues[resource.slug] ?? null,
        }))
        .filter((item) => Number.isFinite(item.value) && item.value > 0);

      this.settings = settings;
      this.items = items;
      if (force) {
        this.offersCache = null;
        this.offersPromise = null;
      }
      this.log(
        `Ready (${this.items.length} priced resource(s), seed "${settings.seedSalt}").`
      );
    })();

    try {
      await this.settingsPromise;
    } finally {
      this.settingsPromise = null;
    }
  }

  /**
   * Returns the Monday of the current week, which is what the shop is seeded on.
   *
   * The day comes from the TRUSTED clock (`DateSyncManager`), never from `Date.now()`: it is the
   * same string for every player, so the five cards and their prices are too. A clock that was
   * never anchored gives no day at all, and the fallback is the week already stored in the save:
   * the shop of a player coming back offline is the one they left.
   *
   * @returns {Promise<string|null>} `YYYY-MM-DD` (the Monday), or null when no day is known at all.
   * @throws {Error} When the stored state cannot be read.
   */
  async getWeekStart() {
    const day = dateSyncManager.getCurrentUtcDay();
    if (day) return TraderManager.mondayOf(day);
    const state = this.normalizeState(await storageRepository.getUserState(USER_STATE_KEYS.TRADER));
    return state.week;
  }

  /**
   * Returns the Monday of the week a UTC day belongs to.
   *
   * @param {string} day - UTC day (`YYYY-MM-DD`).
   * @returns {string} The Monday of that week (`YYYY-MM-DD`).
   * @throws {TypeError} When the day is not a `YYYY-MM-DD` string.
   */
  static mondayOf(day) {
    if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day.trim())) {
      throw new TypeError(`TraderManager.mondayOf expects a "YYYY-MM-DD" day (received: ${JSON.stringify(day)}).`);
    }
    const date = new Date(`${day.trim()}T00:00:00.000Z`);
    // `getUTCDay()` is 0 for Sunday: shifting by six days makes Monday the first day of the week.
    const offset = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - offset);
    return date.toISOString().slice(0, 10);
  }

  /**
   * Normalizes a raw stored state.
   *
   * Anything malformed is read as its default, so a save written before the trader existed (or a
   * hand-edited one) starts with an untouched shop instead of throwing.
   *
   * @param {unknown} raw - Value read from `user_state["trader"]`.
   * @returns {{week: string|null, purchases: Record<string, number>, tradeDay: string|null,
   *   tradeUses: Record<string, number>}} The normalized state.
   */
  normalizeState(raw) {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    return {
      week: /^\d{4}-\d{2}-\d{2}$/.test(source.week) ? source.week : null,
      purchases: TraderManager.normalizeCounters(source.purchases),
      // The daily trades are counted apart from the weekly purchases: they roll over at midnight
      // UTC, while the shop rolls over on Monday (`tradeDay` is the day the counts belong to).
      tradeDay: /^\d{4}-\d{2}-\d{2}$/.test(source.tradeDay) ? source.tradeDay : null,
      tradeUses: TraderManager.normalizeCounters(source.tradeUses),
    };
  }

  /**
   * Reads a `{ key: count }` map, dropping what is not a positive integer.
   *
   * @param {unknown} raw - Raw map.
   * @returns {Record<string, number>} The usable counts.
   */
  static normalizeCounters(raw) {
    const counters = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return counters;
    Object.entries(raw).forEach(([key, value]) => {
      const count = Math.trunc(Number(value));
      if (Number.isFinite(count) && count > 0) counters[key] = count;
    });
    return counters;
  }

  /**
   * Returns the UTC day the daily trades belong to.
   *
   * The day comes from the TRUSTED clock, never from `Date.now()`, so every player trades on the
   * same three pairs and they roll over together at midnight UTC. A clock that was never anchored
   * gives no day at all, and the fallback is the day already stored in the save: the trades of a
   * player coming back offline are the ones they left.
   *
   * @returns {Promise<string|null>} `YYYY-MM-DD`, or null when no day is known at all.
   * @throws {Error} When the stored state cannot be read.
   */
  async getTradeDay() {
    const day = dateSyncManager.getCurrentUtcDay();
    if (day) return day;
    const state = this.normalizeState(await storageRepository.getUserState(USER_STATE_KEYS.TRADER));
    return state.tradeDay;
  }

  /**
   * Returns the trades of the day, without what the player can pay for them.
   *
   * The draw is seeded with the salt of the configuration and the UTC day ONLY: no account, no
   * device, no `Math.random()`. Every player therefore sees the same three trades, they never
   * change before midnight UTC, and a reload shows the very same equation.
   *
   * @param {object} [options] - Read options.
   * @param {boolean} [options.force=false] - Redraw even when the day is cached.
   * @returns {Promise<Array<{key: string, source: 'swap', day: string, left: object, right: object}>>}
   *   The trades of the day, in draw order.
   * @throws {Error} When the configuration cannot be read.
   */
  async getTrades({ force = false } = {}) {
    await this.init();
    const day = await this.getTradeDay();
    const stamp = day ?? 'unknown-day';

    if (force) {
      this.tradesCache = null;
      this.tradesPromise = null;
    }
    if (this.tradesCache && this.tradesCache.day === stamp) return this.tradesCache.trades;
    if (this.tradesPromise) return this.tradesPromise;

    this.tradesPromise = (async () => {
      const wanted = Number.isInteger(this.settings.tradesPerDay) && this.settings.tradesPerDay > 0
        ? this.settings.tradesPerDay
        : DEFAULT_TRADES_PER_DAY;
      const random = createSeededRandom(hashSeed(`${this.settings.seedSalt}|trades|${stamp}`));
      const trades = TraderTrade.build({ count: wanted, pool: this.items, random }).map(
        (trade, index) => ({
          key: `${TRADE_PREFIX}-${stamp}-${index + 1}`,
          source: 'swap',
          day: stamp,
          left: trade.left,
          right: trade.right,
        })
      );
      this.tradesCache = { day: stamp, trades };
      this.log(`Trades of ${stamp}: ${trades.length} drawn.`);
      return trades;
    })();

    try {
      return await this.tradesPromise;
    } finally {
      this.tradesPromise = null;
    }
  }

  /**
   * Builds the description of a trade, as the view reads it.
   *
   * A trade is an exchange, so it is presented as its TWO directions: each one says what it gives,
   * what it receives and whether the player can afford it. The view never computes an amount
   * itself - the quantities come from here, and `swap()` reads them again from the draw.
   *
   * @param {object} trade - Trade from `getTrades()`.
   * @param {Record<string, number>} resources - Resources of the mine, by slug.
   * @param {number} uses - Times the trade was already taken today.
   * @param {number} maxUses - How many times a trade may be taken in a day.
   * @returns {object} The trade, with its `moves` and its state.
   */
  describeTrade(trade, resources, uses, maxUses) {
    /**
     * Describes one direction of the trade.
     *
     * @param {object} from - Side the player gives.
     * @param {object} to - Side the player receives.
     * @returns {object} The direction.
     */
    const describeMove = (from, to) => {
      const available = resources[from.slug] ?? 0;
      return {
        fromSlug: from.slug,
        toSlug: to.slug,
        give: from.quantity,
        receive: to.quantity,
        available,
        missing: Math.max(0, from.quantity - available),
        affordable: available >= from.quantity,
      };
    };

    const remaining = Math.max(0, maxUses - uses);
    return {
      ...trade,
      maxUses,
      bought: uses,
      remaining,
      exhausted: remaining === 0,
      moves: [describeMove(trade.left, trade.right), describeMove(trade.right, trade.left)],
    };
  }

  /**
   * Returns the shop of the week: the pinned offers first, then the five drawn ones.
   *
   * @param {object} [options] - Read options.
   * @param {boolean} [options.force=false] - Rebuild the shop even when it is cached.
   * @returns {Promise<Array<object>>} The offers, each one carrying its card, its price, its stock
   *   and how many times it was already bought this week.
   * @throws {TraderError} With `NO_PRICE` when the prices cannot be built.
   * @throws {Error} When a file cannot be read.
   */
  async getOffers({ force = false } = {}) {
    await this.init();
    const week = await this.getWeekStart();

    if (force) {
      this.offersCache = null;
      this.offersPromise = null;
    }
    if (this.offersCache && this.offersCache.week === week) return this.offersCache.offers;
    if (this.offersPromise) return this.offersPromise;

    this.offersPromise = this.buildOffers(week)
      .then((offers) => {
        this.offersCache = { week, offers };
        this.offersPromise = null;
        return offers;
      })
      .catch((error) => {
        this.offersPromise = null;
        throw error;
      });
    return this.offersPromise;
  }

  /**
   * Builds the offers of a week: the pinned ones, then the five drawn ones.
   *
   * @param {string|null} week - Monday of the week (`YYYY-MM-DD`), null when no day is known.
   * @returns {Promise<Array<object>>} The offers.
   * @throws {TraderError} With `NO_PRICE` when the prices cannot be built.
   * @throws {Error} When a file cannot be read.
   */
  async buildOffers(week) {
    const { seedSalt } = this.settings;
    const state = this.normalizeState(await storageRepository.getUserState(USER_STATE_KEYS.TRADER));
    // A stored week that is not the current one is a reroll: its purchases no longer count.
    const purchases = state.week === week ? state.purchases : {};

    const pinned = await this.buildPinnedOffers(purchases);
    const weekly = await this.buildWeeklyOffers(week, purchases, seedSalt);
    this.log(
      `Shop of the week of ${week ?? 'unknown day'}: ${weekly.length} drawn offer(s), ${pinned.length} pinned.`
    );
    return [...pinned, ...weekly];
  }

  /**
   * Reads the pinned offers that are on sale today.
   *
   * A pinned offer is written by hand in `data/shop/pinned_offers.json` (see the file for the
   * shape): its card, its price, the days it is sold in (`Period`) and its stock (`MaxUse`). An
   * offer outside its window, pointing at an unknown card or carrying a price with no usable line
   * is left out with a warning rather than breaking the shop.
   *
   * @param {Record<string, number>} purchases - Purchases of the current week, by offer key.
   * @returns {Promise<Array<object>>} The pinned offers.
   * @throws {Error} When the file cannot be read (a missing file leaves the shop without them).
   */
  async buildPinnedOffers(purchases) {
    // The file is read once per session: the shop is rebuilt on every purchase, and a hand-written
    // offer list does not change under the player's feet.
    if (!this.pinnedEntries) {
      try {
        this.pinnedEntries = await BoosterManager.fetchJson(this.settings.pinnedPath);
      } catch (error) {
        console.warn(`[TraderManager] "${this.settings.pinnedPath}" could not be read.`, error);
        return [];
      }
    }
    const entries = this.pinnedEntries;
    if (!Array.isArray(entries)) {
      console.warn(`[TraderManager] "${this.settings.pinnedPath}" is not a list of offers.`);
      return [];
    }

    const day = dateSyncManager.getCurrentUtcDay();
    const offers = [];
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      const id = entry.OfferID ?? entry.offerId;
      if (id === undefined || id === null) {
        console.warn('[TraderManager] A pinned offer has no "OfferID".', entry);
        continue;
      }
      const period = entry.Period ?? {};
      if (day && !TraderManager.isOnSale(period, day)) {
        continue;
      }
      const card = await this.resolveCard(entry.Card);
      if (!card) {
        console.warn(`[TraderManager] Pinned offer ${id} points at an unknown card.`, entry.Card);
        continue;
      }
      const price = this.resolvePinnedPrice(entry.Price);
      if (price.length === 0) {
        console.warn(`[TraderManager] Pinned offer ${id} has no usable price line.`, entry.Price);
        continue;
      }

      const key = `${PINNED_OFFER_PREFIX}-${id}`;
      const maxUses = TraderManager.normalizeStock(entry.MaxUse);
      offers.push(
        this.describeOffer({
          key,
          source: 'pinned',
          card,
          price,
          maxUses,
          bought: purchases[key] ?? 0,
          period: {
            min: typeof period.Min === 'string' ? period.Min : null,
            max: typeof period.Max === 'string' ? period.Max : null,
          },
        })
      );
    }
    return offers;
  }

  /**
   * Draws the five offers of the week.
   *
   * The draw is seeded with the salt of the configuration and the Monday of the week ONLY: no
   * account, no device, no `Math.random()`. Every player of the game therefore sees the same five
   * cards at the same price for the whole week. The cards of a rarity are pooled from EVERY loaded
   * extension, and a card already offered this week is never drawn twice.
   *
   * @param {string|null} week - Monday of the week, or null when no day is known.
   * @param {Record<string, number>} purchases - Purchases of the current week, by offer key.
   * @param {string} seedSalt - Salt of the configuration.
   * @returns {Promise<Array<object>>} The drawn offers, rarity by rarity.
   * @throws {TraderError} With `NO_CARD` when an extension publishes no card of a demanded rarity.
   * @throws {TraderError} With `NO_PRICE` when the prices cannot be built.
   */
  async buildWeeklyOffers(week, purchases, seedSalt) {
    await boosterManager.init();
    const random = createSeededRandom(hashSeed(`${seedSalt}|${week ?? 'unknown-week'}`));
    const { rarityValues, allItemsUniques } = this.settings;

    const pools = TraderManager.poolCardsByRarity(boosterManager);
    const used = new Set();
    const offers = [];
    let rank = 0;

    for (const [rarity, count] of this.settings.offers) {
      const pool = pools.get(rarity) ?? [];
      if (pool.length === 0) {
        throw new TraderError(
          TRADER_ERRORS.NO_CARD,
          `No card of rarity ${rarity} is available in the loaded extensions.`
        );
      }
      const target = rarityValues[String(rarity)];
      if (!Number.isFinite(target) || target <= 0) {
        throw new TraderError(TRADER_ERRORS.NO_PRICE, `No rarity value is configured for rarity ${rarity}.`);
      }

      for (let index = 0; index < count; index += 1) {
        const card = TraderManager.drawCard(pool, used, random);
        if (!card) {
          console.warn(`[TraderManager] Every card of rarity ${rarity} is already on sale this week.`);
          continue;
        }
        used.add(card.uniqueKey);
        rank += 1;

        const key = `${WEEKLY_OFFER_PREFIX}-${week ?? 'unknown-week'}-${rarity}-${rank}`;
        // A generator of its own per offer: the price of the third offer never depends on the two
        // drawn before it, and two offers of the same rarity do not end up with the same price.
        const priceRandom = createSeededRandom(hashSeed(`${seedSalt}|price|${key}`));
        offers.push(
          this.describeOffer({
            key,
            source: 'weekly',
            card,
            rarity,
            price: TraderPrice.build({ target, pool: this.items, random: priceRandom }),
            // `allItemsUniques` is the switch of the shop: an offer bought once is gone until the
            // next reroll. Without it, the shop sells the same card again and again.
            maxUses: allItemsUniques ? 1 : null,
            bought: purchases[key] ?? 0,
          })
        );
      }
    }
    return offers;
  }

  /**
   * Groups every card of every loaded extension by rarity.
   *
   * The whole catalogue is pooled in the order declared by `settings/config.json`, so two players
   * with the same files draw the same thing. The promo cards are left out: they are never drawn
   * (`PromoManager`), and a pinned offer is the only way to sell one.
   *
   * @param {object} manager - A `BoosterManager` (the shared instance by default).
   * @returns {Map<number, Array<object>>} The cards, by rarity.
   */
  static poolCardsByRarity(manager) {
    const pools = new Map();
    manager.getLoadedSetIds().forEach((setId) => {
      const set = manager.getLoadedSet(setId);
      if (!set?.cardsByRarity) return;
      set.cardsByRarity.forEach((cards, rarity) => {
        const pool = pools.get(rarity) ?? [];
        pools.set(rarity, [...pool, ...cards]);
      });
    });
    return pools;
  }

  /**
   * Draws one card from a pool, skipping the ones already on sale.
   *
   * @param {Array<object>} pool - Cards of one rarity.
   * @param {Set<string>} used - Keys already offered this week.
   * @param {() => number} random - Seeded generator.
   * @returns {object|null} The card, or null when the pool holds nothing new.
   */
  static drawCard(pool, used, random) {
    for (let attempt = 0; attempt < DRAW_ATTEMPTS; attempt += 1) {
      const index = Math.min(pool.length - 1, Math.floor(random() * pool.length));
      const card = pool[index];
      if (card && !used.has(card.uniqueKey)) return card;
    }
    return pool.find((card) => !used.has(card.uniqueKey)) ?? null;
  }

  /**
   * Turns the `Price` of a pinned offer into price lines.
   *
   * A pinned price is a map of resource NAME to quantity (`{ "Stone Dust": 20 }`) and it does not
   * have to be worth the rarity of the card: it is written by hand, so it is taken as is. A name
   * that matches no mined resource is dropped with a warning.
   *
   * @param {unknown} raw - Raw `Price` of the offer.
   * @returns {Array<{slug: string, type: string, texture: string, value: number, quantity: number, total: number}>}
   *   The lines, dearest first.
   */
  resolvePinnedPrice(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const bySlug = new Map(this.items.map((item) => [item.slug, item]));

    return Object.entries(raw)
      .map(([name, quantity]) => {
        const slug = resourceSlug(name);
        const item = bySlug.get(slug);
        const amount = Math.trunc(Number(quantity));
        if (!item || !Number.isFinite(amount) || amount <= 0) {
          console.warn(`[TraderManager] The resource "${name}" of a pinned price is unknown.`);
          return null;
        }
        return { ...item, quantity: amount, total: amount * item.value };
      })
      .filter((line) => line !== null)
      .sort((left, right) => right.value - left.value);
  }

  /**
   * Resolves the card of a pinned offer.
   *
   * Two schemas are accepted, exactly like a redeem code:
   *   `{ Index: "SERIE-A1 / W001" }`               a card of a booster extension;
   *   `{ Index: "PROMO-A1 / M01", isPromotional: true }` a promo card.
   * The `Index` is the identifier written in the data files, and a printing whose style is not
   * named is resolved to the classic one.
   *
   * @param {unknown} raw - Raw `Card` of the offer.
   * @returns {Promise<object|null>} The card, or null when it cannot be found.
   * @throws {Error} When a catalogue cannot be read.
   */
  async resolveCard(raw) {
    const index = raw?.Index ?? raw?.index;
    if (typeof index !== 'string' || index.trim() === '') return null;
    const wanted = index.trim();

    if (raw?.isPromotional || raw?.IsPromotional) {
      const rows = await promoManager.getAllCards();
      const row = rows.find((candidate) => TraderManager.sameIndex(candidate.entry?.Index, wanted));
      return row?.card ?? null;
    }

    await boosterManager.init();
    for (const setId of boosterManager.getLoadedSetIds()) {
      const set = boosterManager.getLoadedSet(setId);
      const rawCards = set?.raw?.Cards;
      if (!Array.isArray(rawCards)) continue;
      const matches = rawCards
        .map((entry, position) => ({ entry, card: set.cards[position] }))
        .filter(({ entry }) => TraderManager.sameIndex(entry?.Index, wanted));
      if (matches.length === 0) continue;
      // Several printings can share an `Index` (a classic and a full art): the classic one is the
      // one an offer names when it does not say otherwise.
      const classic = matches.find(({ card }) => card && !card.isFullArt);
      return (classic ?? matches[0]).card ?? null;
    }
    return null;
  }

  /**
   * Compares two card identifiers, ignoring the spacing around the separator.
   *
   * @param {unknown} left - Candidate index.
   * @param {string} right - Wanted index.
   * @returns {boolean} True when both name the same card.
   */
  static sameIndex(left, right) {
    if (typeof left !== 'string') return false;
    return TraderManager.normalizeIndex(left) === TraderManager.normalizeIndex(right);
  }

  /**
   * Normalizes a card identifier (`"SERIE-A1 / W001"` -> `"SERIE-A1 / W001"`).
   *
   * @param {string} value - Raw index.
   * @returns {string} The identifier, with single spaces around the slash.
   */
  static normalizeIndex(value) {
    return String(value)
      .split('/')
      .map((part) => part.trim())
      .join(' / ')
      .toUpperCase();
  }

  /**
   * Normalizes the stock of a pinned offer.
   *
   * @param {unknown} raw - Raw `MaxUse`.
   * @returns {number|null} The stock, or null for an unlimited offer.
   */
  static normalizeStock(raw) {
    if (raw === null || raw === undefined || raw === '') return null;
    const stock = Math.trunc(Number(raw));
    return Number.isFinite(stock) && stock >= 0 ? stock : null;
  }

  /**
   * Indicates whether a pinned offer is on sale on a given day.
   *
   * @param {{Min?: string, Max?: string}} period - Raw window.
   * @param {string} day - Current UTC day (`YYYY-MM-DD`).
   * @returns {boolean} True when the day is inside the window (both bounds included).
   */
  static isOnSale(period, day) {
    const min = typeof period?.Min === 'string' ? period.Min : null;
    const max = typeof period?.Max === 'string' ? period.Max : null;
    if (min && day < min) return false;
    if (max && day > max) return false;
    return true;
  }

  /**
   * Builds the description of an offer, as the view reads it.
   *
   * @param {object} options - Offer data.
   * @param {string} options.key - Stable key of the offer.
   * @param {'weekly'|'pinned'} options.source - Where the offer comes from.
   * @param {object} options.card - Card on sale.
   * @param {Array<object>} options.price - Price lines.
   * @param {number|null} options.maxUses - Stock (null: unlimited).
   * @param {number} options.bought - Times already bought this week.
   * @param {object} [options.period=null] - Sale window of a pinned offer.
   * @returns {object} The offer.
   */
  describeOffer({ key, source, card, price, maxUses, bought, period = null }) {
    return {
      key,
      source,
      card,
      rarity: card.rarity,
      price,
      total: price.reduce((sum, line) => sum + line.total, 0),
      maxUses,
      bought,
      remaining: maxUses === null ? null : Math.max(0, maxUses - bought),
      exhausted: maxUses !== null && bought >= maxUses,
      period,
    };
  }

  /**
   * Reads the whole shop, with what the player can pay for it.
   *
   * @param {object} [options] - Read options.
   * @param {boolean} [options.force=false] - Rebuild the shop even when it is cached.
   * @returns {Promise<{week: string|null, tradeDay: string|null, allItemsUniques: boolean,
   *   trades: Array<object>, offers: Array<object>, resources: Record<string, number>}>} The shop.
   *   Every offer carries an `affordable` flag and the quantity missing from every line it cannot
   *   pay for, and every trade carries its two directions with the same information.
   * @throws {Error} See `getOffers()`.
   */
  async getState({ force = false } = {}) {
    await this.init();
    const week = await this.getWeekStart();
    const tradeDay = await this.getTradeDay();
    const [offers, trades] = await Promise.all([
      this.getOffers({ force }),
      this.getTrades({ force }),
    ]);
    const stored = await miningManager.getState();
    const state = this.normalizeState(await storageRepository.getUserState(USER_STATE_KEYS.TRADER));
    // A stamp that is not the current day is a rollover: yesterday's trades are available again.
    const tradeUses = state.tradeDay === tradeDay ? state.tradeUses : {};

    return {
      week,
      tradeDay,
      allItemsUniques: this.settings.allItemsUniques,
      resources: stored.resources,
      trades: trades.map((trade) =>
        this.describeTrade(trade, stored.resources, tradeUses[trade.key] ?? 0, TRADE_MAX_USES)
      ),
      offers: offers.map((offer) => {
        const lines = offer.price.map((line) => {
          const available = stored.resources[line.slug] ?? 0;
          return { ...line, available, missing: Math.max(0, line.quantity - available) };
        });
        return {
          ...offer,
          price: lines,
          affordable: !offer.exhausted && lines.every((line) => line.missing === 0),
        };
      }),
    };
  }

  /**
   * Buys an offer: the resources are spent, the card lands in the collection.
   *
   * The whole read-modify-write runs in ONE transaction (the mined resources, the collection row
   * and the purchase count), so two rapid touches can never pay once and receive twice, and a
   * failure never charges a price without granting the card.
   *
   * @param {string} offerKey - Key of the offer (`weekly-…` or `pinned-…`).
   * @returns {Promise<{card: object, isNew: boolean, quantity: number, resources: Record<string, number>,
   *   offer: object, week: string|null}>} The committed purchase.
   * @throws {TraderError} With `NO_OFFER`, `SOLD_OUT` or `INSUFFICIENT_RESOURCES`.
   * @throws {Error} When the transaction fails.
   */
  async buy(offerKey) {
    const offers = await this.getOffers();
    const offer = offers.find((candidate) => candidate.key === offerKey);
    if (!offer) {
      throw new TraderError(TRADER_ERRORS.NO_OFFER, `No offer "${offerKey}" in the shop of the week.`);
    }
    const week = await this.getWeekStart();
    const cost = Object.fromEntries(offer.price.map((line) => [line.slug, line.quantity]));

    const result = await storageRepository.transaction(
      [STORES.USER_STATE, STORES.COLLECTION],
      'readwrite',
      async (context) => {
        const state = this.normalizeState(await context.get(STORES.USER_STATE, USER_STATE_KEYS.TRADER));
        // The reroll is evaluated INSIDE the transaction: a purchase made a second after the shop
        // was rerolled can never spend the stock of the previous week.
        const purchases = state.week === week ? state.purchases : {};
        const bought = purchases[offer.key] ?? 0;
        if (offer.maxUses !== null && bought >= offer.maxUses) {
          throw new TraderError(TRADER_ERRORS.SOLD_OUT, `Offer "${offer.key}" is exhausted for this week.`);
        }

        const stored = miningManager.normalizeState(
          await context.get(STORES.USER_STATE, USER_STATE_KEYS.MINING)
        );
        Object.entries(cost).forEach(([slug, quantity]) => {
          const available = stored.resources[slug] ?? 0;
          if (available < quantity) {
            throw new TraderError(
              TRADER_ERRORS.INSUFFICIENT_RESOURCES,
              `"${slug}" is at ${available}, the price asks for ${quantity}.`
            );
          }
        });

        const resources = await miningManager.spendResources(cost, context);
        const granted = await boosterManager.addCardToCollection([offer.card], 1, context);
        await context.put(
          STORES.USER_STATE,
          { week, purchases: { ...purchases, [offer.key]: bought + 1 } },
          USER_STATE_KEYS.TRADER
        );

        return {
          resources,
          isNew: granted.newKeys.includes(offer.card.uniqueKey),
          quantity: granted.quantity[offer.card.uniqueKey] ?? 1,
        };
      }
    );

    this.log(
      `Bought "${offer.card.uniqueKey}" (${offer.key}) for ${offer.price
        .map((line) => `${line.quantity} ${line.type}`)
        .join(', ')}, ${result.isNew ? 'new' : 'duplicate'}.`
    );

    // The shop itself changed (a stock went down), and so did the resources of the mine: the two
    // screens repaint from these two events, and `CARDS_OBTAINED` lets the trophies, the experience
    // and the notifications follow the card exactly like a drawn one.
    const state = await this.getState({ force: true });
    const mining = await miningManager.getState();
    eventBus.emit(EVENTS.TRADER_UPDATED, { week: state.week, offers: state.offers });
    eventBus.emit(EVENTS.MINING_UPDATED, {
      day: mining.day,
      minedToday: mining.minedToday,
      remaining: mining.remaining,
      blocksPerDay: mining.blocksPerDay,
      totalMined: mining.totalMined,
    });
    eventBus.emit(EVENTS.CARDS_OBTAINED, {
      cards: [offer.card],
      newKeys: result.isNew ? [offer.card.uniqueKey] : [],
      source: TRADER_SOURCE,
    });

    return {
      card: offer.card,
      isNew: result.isNew,
      quantity: result.quantity,
      resources: result.resources,
      offer: state.offers.find((candidate) => candidate.key === offer.key) ?? offer,
      week,
    };
  }

  /**
   * Takes one of the trades of the day: the player gives one resource and receives the other.
   *
   * The whole read-modify-write runs in ONE transaction (the mined resources and the use count), so
   * two rapid touches can never take the same trade twice, and a failure never moves one side of the
   * exchange without the other. The QUANTITIES are read from the draw again here, never from the
   * caller: a client can name a trade and a direction, not an amount.
   *
   * @param {string} tradeKey - Key of the trade (`swap-<day>-<rank>`).
   * @param {string} fromSlug - Resource the player gives (one of the two sides of the trade).
   * @returns {Promise<{key: string, give: {slug: string, quantity: number},
   *   receive: {slug: string, quantity: number}, resources: Record<string, number>, day: string,
   *   trade: object|null, creates: boolean}>} The committed exchange, `trade` being the state of
   *   that trade after the exchange. `creates` tells whether the resource received was held at all
   *   before.
   * @throws {TraderError} With `NO_TRADE` (unknown trade or direction), `SOLD_OUT` (already taken
   *   today) or `INSUFFICIENT_RESOURCES`.
   * @throws {Error} When the transaction fails.
   */
  async swap(tradeKey, fromSlug) {
    if (typeof fromSlug !== 'string' || fromSlug.trim() === '') {
      throw new TraderError(TRADER_ERRORS.NO_TRADE, `Trade "${tradeKey}" was asked with no direction.`);
    }
    const trades = await this.getTrades();
    const trade = trades.find((candidate) => candidate.key === tradeKey);
    if (!trade) {
      throw new TraderError(TRADER_ERRORS.NO_TRADE, `No trade "${tradeKey}" on the board of the day.`);
    }
    const given = [trade.left, trade.right].find((side) => side.slug === fromSlug.trim());
    const received = given === trade.left ? trade.right : given === trade.right ? trade.left : null;
    if (!given || !received) {
      throw new TraderError(
        TRADER_ERRORS.NO_TRADE,
        `Trade "${tradeKey}" does not exchange "${fromSlug}".`
      );
    }

    const day = trade.day;
    const cost = { [given.slug]: given.quantity };
    const gains = { [received.slug]: received.quantity };

    const result = await storageRepository.transaction(
      [STORES.USER_STATE],
      'readwrite',
      async (context) => {
        const state = this.normalizeState(await context.get(STORES.USER_STATE, USER_STATE_KEYS.TRADER));
        // The rollover is evaluated INSIDE the transaction: a trade taken a second after midnight
        // can never spend the use count of the previous day.
        const uses = state.tradeDay === day ? state.tradeUses : {};
        const taken = uses[trade.key] ?? 0;
        if (taken >= TRADE_MAX_USES) {
          throw new TraderError(TRADER_ERRORS.SOLD_OUT, `Trade "${trade.key}" was already taken today.`);
        }
        const before = miningManager.normalizeState(
          await context.get(STORES.USER_STATE, USER_STATE_KEYS.MINING)
        ).resources;
        const resources = await miningManager.swapResources({ give: cost, receive: gains }, context);
        await context.put(
          STORES.USER_STATE,
          {
            week: state.week,
            purchases: state.purchases,
            tradeDay: day,
            tradeUses: { ...uses, [trade.key]: taken + 1 },
          },
          USER_STATE_KEYS.TRADER
        );
        return { resources, creates: (before[received.slug] ?? 0) === 0 };
      }
    );

    this.log(
      `Trade "${trade.key}": ${given.quantity} ${given.type} against ` +
        `${received.quantity} ${received.type} (day ${day}).`
    );

    // Both screens repaint from these two events: the resources of the mine changed, and the trade
    // is one use shorter. No card is involved, so nothing is announced to the collection.
    const state = await this.getState({ force: true });
    const mining = await miningManager.getState();
    eventBus.emit(EVENTS.TRADER_UPDATED, { week: state.week, offers: state.offers });
    eventBus.emit(EVENTS.MINING_UPDATED, {
      day: mining.day,
      minedToday: mining.minedToday,
      remaining: mining.remaining,
      blocksPerDay: mining.blocksPerDay,
      totalMined: mining.totalMined,
    });

    return {
      key: trade.key,
      give: { slug: given.slug, type: given.type, nameKey: given.nameKey, quantity: given.quantity },
      receive: {
        slug: received.slug,
        type: received.type,
        nameKey: received.nameKey,
        quantity: received.quantity,
      },
      resources: result.resources,
      day,
      trade: state.trades.find((candidate) => candidate.key === trade.key) ?? null,
      creates: result.creates,
    };
  }

  /**
   * Publishes the current shop on `TRADER_UPDATED`.
   *
   * Used after an imported save or a clock tick, so the screen reacts without waiting for a
   * purchase.
   *
   * @returns {Promise<void>} Resolves once the event was emitted.
   * @throws {Error} See `getState()`.
   */
  async emitStateUpdated() {
    const state = await this.getState();
    eventBus.emit(EVENTS.TRADER_UPDATED, { week: state.week, offers: state.offers });
  }

  /**
   * Drops the cached shop (used when the configuration or the account changed).
   *
   * @returns {void}
   */
  resetOffers() {
    this.offersCache = null;
    this.offersPromise = null;
    this.pinnedEntries = null;
    this.tradesCache = null;
    this.tradesPromise = null;
  }
}

/** Shared instance used by the mine view and the mine statistics. */
export const traderManager = new TraderManager();

export default traderManager;

/**
 * IllagerShopManager - the Illager Shop: a dated shop paid in a custom currency.
 *
 * Reference: `data/illager_shop/illager_currencies.json` (the currencies), `data/illager_shop/
 * illager_shop.json` (the sets of offers), `js/business/RedeemManager.js` and
 * `js/business/DailyRewardManager.js` (the two ways a currency is handed out) and
 * `js/business/SparksManager.js` (where the balance of an expired currency lands).
 *
 * WHAT THE PLAYER SEES
 *   The Illager Shop is the second merchant of the mine. Its offers come from ONE set, and a set is
 *   open only between the two days of its `Availabilities` window (both included), read on the
 *   trusted UTC clock. Between two sets the shop is empty: the button stays visible but greyed, and
 *   the dialog shows the patrol picture with the countdown of the next set, without revealing it.
 *
 * THE CURRENCY
 *   An offer is paid in ONE custom currency, the `CurrencyUsed` of its set, and a currency is
 *   written by hand in `illager_currencies.json`: an id, a name, a texture, the day it expires and
 *   the rate it is converted at. The balances live in `user_state["illagerShop"].balances`, keyed by
 *   the id of the currency, and a currency is credited by its ID alone - a redeem code or a daily
 *   reward names nothing else, so a currency can be handed out months before its shop opens.
 *
 * EXPIRY (a currency that reaches its day)
 *   `ExpirationDate` is the LAST day a currency is worth something: the shop still takes it that
 *   day, and the morning after every balance of it is multiplied by `ConversionRate` and credited as
 *   Sparks, then zeroed. The conversion is idempotent by construction (a zeroed balance is worth
 *   zero Sparks, and nothing is written for zero), so it can run on every read without a flag.
 *
 * WHAT IS PERSISTED (`user_state["illagerShop"]`)
 *   `balances`   : `{ [currencyId]: amount }` - what the player owns of each custom currency;
 *   `purchases`  : `{ [setId]: { [offerKey]: count } }` - how many times a non-repeatable offer was
 *                  bought. A set that is no longer open simply stops being read, which is the
 *                  reroll: the next set starts with an untouched shop.
 *
 * A PURCHASE IS ONE TRANSACTION: the balance, the purchase count and the reward (Sparks, Ultima, a
 * booster or a card) are written together, so a failure can never charge the price without granting
 * the reward. A refused purchase raises an `IllagerError` carrying a stable `code`, and the view
 * translates it the way it translates a trader error.
 */

import { storageRepository, STORES } from '../models/StorageRepository.js';
import dateSyncManager from './DateSyncManager.js';
import boosterManager, { BoosterManager } from './BoosterManager.js';
import promoManager from './PromoManager.js';
import miningManager, { RESOURCE_TEXTURE_DIRECTORY, SPARKS_TEXTURE } from './MiningManager.js';
import sparksManager, { SPARKS_SOURCES } from './SparksManager.js';
import eventBus, { EVENTS } from '../utils/EventBus.js';

/** Currencies of the Illager Shop, as shipped. */
export const ILLAGER_CURRENCIES_PATH = 'data/illager_shop/illager_currencies.json';

/** Sets of offers of the Illager Shop, as shipped. */
export const ILLAGER_SHOP_PATH = 'data/illager_shop/illager_shop.json';

/** Kinds of reward a trade of the Illager Shop can grant. */
export const ILLAGER_REWARD_TYPES = Object.freeze({
  SPARKS: 'Sparks',
  ULTIMA: 'Ultima',
  CARD: 'Card',
  BOOSTER: 'Booster',
});

/** Slug of the Ultima resource, the one the `Ultima` reward pays in. */
export const ULTIMA_SLUG = 'ultima';

/**
 * Key of the `user_state` entry holding the balances and the purchase counts.
 *
 * Declared here rather than imported from `AccountManager` on purpose: the key is the whole
 * contract of the shop with the save, and a module that only needs to read one entry should not
 * drag the account module (and its initial settings) into the graph.
 */
export const ILLAGER_STATE_KEY = 'illagerShop';

/** Name of the event published when a balance or a purchase changes (`EVENTS.ILLAGER_SHOP_UPDATED`). */
export const ILLAGER_SHOP_EVENT = 'ILLAGER_SHOP_UPDATED';

/** Days of the week a set of offers is open (`YYYY-MM-DD`, both included). */
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Layout a card path may name, written after its index (`PROMO-A1 _ E01_fullart`). */
const LAYOUT_SUFFIX = /_(classic|fullart)$/i;

/** Error codes raised by this manager. */
export const ILLAGER_ERRORS = Object.freeze({
  NO_DAY: 'NO_DAY',
  NO_SET: 'NO_SET',
  NO_OFFER: 'NO_OFFER',
  SOLD_OUT: 'SOLD_OUT',
  INSUFFICIENT_CURRENCY: 'INSUFFICIENT_CURRENCY',
  NO_CARD: 'NO_CARD',
  NO_CURRENCY: 'NO_CURRENCY',
  INVALID_REWARD: 'INVALID_REWARD',
});

/** i18n keys of the error codes, so a view never invents its own message. */
const ERROR_MESSAGE_KEYS = Object.freeze({
  [ILLAGER_ERRORS.NO_DAY]: 'mineblock.illager.error.day',
  [ILLAGER_ERRORS.NO_SET]: 'mineblock.illager.error.set',
  [ILLAGER_ERRORS.NO_OFFER]: 'mineblock.illager.error.offer',
  [ILLAGER_ERRORS.SOLD_OUT]: 'mineblock.illager.error.soldOut',
  [ILLAGER_ERRORS.INSUFFICIENT_CURRENCY]: 'mineblock.illager.error.currency',
  [ILLAGER_ERRORS.NO_CARD]: 'mineblock.illager.error.card',
  [ILLAGER_ERRORS.NO_CURRENCY]: 'mineblock.illager.error.unknownCurrency',
  [ILLAGER_ERRORS.INVALID_REWARD]: 'mineblock.illager.error.reward',
});

/**
 * Returns the i18n key describing an Illager Shop error code.
 *
 * @param {unknown} code - Error code (`ILLAGER_ERRORS`).
 * @returns {string} The translation key, falling back to the generic one.
 */
export function getIllagerErrorMessageKey(code) {
  return ERROR_MESSAGE_KEYS[code] ?? 'mineblock.illager.error.generic';
}

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Raised by every refused Illager Shop operation, with a stable `code`. */
export class IllagerError extends Error {
  /**
   * @param {string} code - One of `ILLAGER_ERRORS`.
   * @param {string} message - Technical message (the UI shows a translated one).
   */
  constructor(code, message) {
    super(message);
    this.name = 'IllagerError';
    this.code = code;
  }
}

export class IllagerShopManager {
  constructor() {
    /** @type {Array<object>|null} Currencies read from `illager_currencies.json`. */
    this.currencies = null;
    /** @type {Array<object>|null} Sets read from `illager_shop.json`. */
    this.sets = null;
    /** @type {Promise<void>|null} In-flight load, to de-duplicate concurrent calls. */
    this.initPromise = null;
  }

  /**
   * Logs with the manager prefix.
   *
   * @param {...unknown} args - Values forwarded to `console.info`.
   * @returns {void}
   */
  log(...args) {
    console.info('[IllagerShopManager]', ...args);
  }

  /**
   * Reads the two data files once per session.
   *
   * A file that cannot be read leaves its list empty instead of throwing: the shop then behaves
   * like a shop with nothing to sell, which the dialog already knows how to show.
   *
   * @param {object} [options] - Load options.
   * @param {boolean} [options.force=false] - Re-read the files even when they are cached.
   * @returns {Promise<void>} Resolves once the manager is usable.
   */
  async init({ force = false } = {}) {
    if (this.currencies && this.sets && !force) return;
    if (this.initPromise && !force) return this.initPromise;

    this.initPromise = (async () => {
      const [currencies, sets] = await Promise.all([
        IllagerShopManager.readList(ILLAGER_CURRENCIES_PATH, 'currency'),
        IllagerShopManager.readList(ILLAGER_SHOP_PATH, 'set'),
      ]);
      this.currencies = currencies.map((entry) => IllagerShopManager.normalizeCurrency(entry));
      this.sets = sets.map((entry) => IllagerShopManager.normalizeSet(entry));
      this.log(
        `Ready (${this.currencies.length} currency(ies), ${this.sets.length} set(s)).`
      );
    })();

    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  /**
   * Reads a JSON list, or an empty one: the shop must survive a missing file.
   *
   * @param {string} path - Path relative to the application root.
   * @param {string} label - What the file holds, for the warning.
   * @returns {Promise<Array<object>>} The entries that are objects.
   */
  static async readList(path, label) {
    try {
      const payload = await BoosterManager.fetchJson(path);
      if (!Array.isArray(payload)) {
        console.warn(`[IllagerShopManager] "${path}" is not a list of ${label}; it is ignored.`);
        return [];
      }
      return payload.filter(isRecord);
    } catch (error) {
      console.warn(`[IllagerShopManager] "${path}" could not be read.`, error);
      return [];
    }
  }

  /**
   * Normalizes one currency entry.
   *
   * The quests are kept RAW: they belong to `IllagerQuestManager`, which validates their dates
   * against the currency and drops the entries that cannot run.
   *
   * @param {object} raw - Raw entry of `illager_currencies.json`.
   * @returns {{id: string, name: string, texture: string, expiration: string|null, conversionRate: number,
   *   quests: Array<object>}} The currency, with the null id of an unusable entry.
   */
  static normalizeCurrency(raw) {
    const id = typeof raw.ID === 'string' ? raw.ID.trim() : '';
    const name = typeof raw.Name === 'string' && raw.Name.trim() !== '' ? raw.Name.trim() : id;
    const texture = typeof raw.Texture === 'string' ? raw.Texture.trim().replace(/^\.\//, '') : '';
    const expiration = typeof raw.ExpirationDate === 'string' && DAY_PATTERN.test(raw.ExpirationDate.trim())
      ? raw.ExpirationDate.trim()
      : null;
    const rate = Math.trunc(Number(raw.ConversionRate));
    return {
      id,
      name,
      texture,
      expiration,
      conversionRate: Number.isFinite(rate) && rate > 0 ? rate : 0,
      quests: Array.isArray(raw.Quests) ? raw.Quests.filter(isRecord) : [],
    };
  }

  /**
   * Normalizes one set of offers.
   *
   * @param {object} raw - Raw entry of `illager_shop.json`.
   * @returns {{id: number, name: string, start: string|null, end: string|null, currencyId: string,
   *   trades: Array<object>}} The set.
   */
  static normalizeSet(raw) {
    const availability = isRecord(raw.Availabilities) ? raw.Availabilities : {};
    const day = (value) =>
      typeof value === 'string' && DAY_PATTERN.test(value.trim()) ? value.trim() : null;
    const trades = Array.isArray(raw.TradeSet) ? raw.TradeSet.filter(isRecord) : [];
    return {
      id: Number(raw.ID),
      name: typeof raw.SetName === 'string' ? raw.SetName.trim() : '',
      start: day(availability.Start),
      end: day(availability.End),
      currencyId: typeof raw.CurrencyUsed === 'string' ? raw.CurrencyUsed.trim() : '',
      trades,
    };
  }

  /**
   * Returns the currency of an id.
   *
   * @param {string} currencyId - Id written in the data.
   * @returns {object|null} The currency, or null when no file declares it.
   */
  getCurrency(currencyId) {
    if (typeof currencyId !== 'string' || currencyId.trim() === '') return null;
    return (this.currencies ?? []).find((currency) => currency.id === currencyId.trim()) ?? null;
  }

  /**
   * Normalizes a raw stored state.
   *
   * Anything malformed reads as its default, so a save written before the shop existed (or a
   * hand-edited one) starts with untouched balances instead of throwing.
   *
   * @param {unknown} raw - Value read from `user_state["illagerShop"]`.
   * @returns {{balances: Record<string, number>, purchases: Record<string, Record<string, number>>}}
   *   The normalized state.
   */
  static normalizeState(raw) {
    const source = isRecord(raw) ? raw : {};
    const balances = {};
    if (isRecord(source.balances)) {
      Object.entries(source.balances).forEach(([id, amount]) => {
        const value = Math.trunc(Number(amount));
        if (Number.isFinite(value) && value > 0) balances[id] = value;
      });
    }
    const purchases = {};
    if (isRecord(source.purchases)) {
      Object.entries(source.purchases).forEach(([setId, counters]) => {
        if (!isRecord(counters)) return;
        const counts = {};
        Object.entries(counters).forEach(([key, count]) => {
          const value = Math.trunc(Number(count));
          if (Number.isFinite(value) && value > 0) counts[key] = value;
        });
        purchases[setId] = counts;
      });
    }
    return { balances, purchases };
  }

  /**
   * Reads the stored state.
   *
   * @returns {Promise<{balances: Record<string, number>, purchases: Record<string, Record<string, number>>}>}
   *   The state.
   * @throws {Error} When the read fails.
   */
  async readState() {
    return IllagerShopManager.normalizeState(
      await storageRepository.getUserState(ILLAGER_STATE_KEY)
    );
  }

  /**
   * Returns the balance of one currency.
   *
   * @param {string} currencyId - Id of the currency.
   * @returns {Promise<number>} The amount owned (0 when none).
   * @throws {Error} When the read fails.
   */
  async getBalance(currencyId) {
    const state = await this.readState();
    return state.balances[currencyId] ?? 0;
  }

  /**
   * Credits (or debits, with a negative amount) a custom currency.
   *
   * The single entry point of every grant, so a redeem code and a daily reward can name nothing but
   * the id of the currency. An amount that would make the balance negative is clamped to zero.
   *
   * @param {string} currencyId - Id of the currency.
   * @param {number} amount - Signed integer.
   * @param {object|null} [context=null] - Optional transaction context to join instead of opening
   *   one (the daily reward and the redeem code write several rewards at once).
   * @returns {Promise<number>} The resulting balance.
   * @throws {TypeError} When the id or the amount is invalid.
   * @throws {IllagerError} With `NO_CURRENCY` when no file declares the currency.
   * @throws {Error} When the write fails.
   */
  async grantCurrency(currencyId, amount, context = null) {
    if (typeof currencyId !== 'string' || currencyId.trim() === '') {
      throw new TypeError('IllagerShopManager.grantCurrency requires a currency id.');
    }
    if (!Number.isInteger(amount) || amount === 0) {
      throw new TypeError(
        `IllagerShopManager.grantCurrency expects a non-zero integer (received: ${JSON.stringify(amount)}).`
      );
    }
    await this.init();
    const id = currencyId.trim();
    if (!this.getCurrency(id)) {
      throw new IllagerError(
        ILLAGER_ERRORS.NO_CURRENCY,
        `"${id}" is not declared by "${ILLAGER_CURRENCIES_PATH}".`
      );
    }

    /**
     * Adds the amount to the balance inside one transaction.
     *
     * @param {object} activeContext - Transaction context.
     * @returns {Promise<number>} The resulting balance.
     */
    const apply = async (activeContext) => {
      const state = IllagerShopManager.normalizeState(
        await activeContext.get(STORES.USER_STATE, ILLAGER_STATE_KEY)
      );
      const balance = Math.max(0, (state.balances[id] ?? 0) + amount);
      const balances = { ...state.balances };
      if (balance === 0) delete balances[id];
      else balances[id] = balance;
      await activeContext.put(
        STORES.USER_STATE,
        { ...state, balances },
        ILLAGER_STATE_KEY
      );
      return balance;
    };

    const balance = context
      ? await apply(context)
      : await storageRepository.transaction(STORES.USER_STATE, 'readwrite', apply);
    if (!context) {
      eventBus.emit(ILLAGER_SHOP_EVENT, { currencyId: id, balance });
    }
    return balance;
  }

  /**
   * Returns the set of offers open on a day.
   *
   * @param {string|null} day - UTC day (`YYYY-MM-DD`).
   * @returns {object|null} The open set, or null when no set covers that day.
   */
  getActiveSet(day) {
    if (!day) return null;
    return (
      (this.sets ?? []).find(
        (set) => set.start !== null && set.end !== null && day >= set.start && day <= set.end
      ) ?? null
    );
  }

  /**
   * Returns the FIRST set that opens after a day, without revealing it.
   *
   * @param {string|null} day - UTC day (`YYYY-MM-DD`).
   * @returns {object|null} The next set, or null when nothing is scheduled.
   */
  getNextSet(day) {
    if (!day) return null;
    return (
      (this.sets ?? [])
        .filter((set) => set.start !== null && set.start > day)
        .sort((left, right) => (left.start < right.start ? -1 : 1))[0] ?? null
    );
  }

  /**
   * Resolves the rewards of one trade into what has to be granted.
   *
   * A trade that names a card no catalogue declares, a booster of an unknown extension or a reward
   * type the code does not know is dropped with a warning: the shop sells what it can, instead of
   * showing an offer that would fail on purchase.
   *
   * Every reward also carries the picture the shop shows for it (`texture`): the texture of Sparks,
   * the one of a resource, the artwork of the pack of an extension or the illustration of the card.
   * A picture that cannot be resolved is null, and the offer simply shows its name.
   *
   * @param {Array<object>} rawRewards - `Rewards` of a trade.
   * @returns {Promise<Array<object>>} The resolved rewards, in declaration order.
   * @throws {Error} When a catalogue cannot be read.
   */
  async resolveRewards(rawRewards) {
    const rewards = [];
    for (const raw of rawRewards) {
      const type = typeof raw.Type === 'string' ? raw.Type.trim() : '';
      const quantity = Number(raw.Qte);
      if (!Number.isInteger(quantity) || quantity <= 0) {
        console.warn('[IllagerShopManager] A reward has an invalid quantity; it is ignored.', raw);
        continue;
      }

      if (type === ILLAGER_REWARD_TYPES.SPARKS) {
        rewards.push({ type, quantity, slug: null, card: null, setId: null, texture: SPARKS_TEXTURE });
        continue;
      }
      if (type === ILLAGER_REWARD_TYPES.ULTIMA) {
        rewards.push({
          type,
          quantity,
          slug: ULTIMA_SLUG,
          card: null,
          setId: null,
          texture: `${RESOURCE_TEXTURE_DIRECTORY}/${ULTIMA_SLUG}.png`,
        });
        continue;
      }
      if (type === ILLAGER_REWARD_TYPES.BOOSTER) {
        const setId = typeof raw.Data === 'string' ? raw.Data.trim() : '';
        try {
          dateSyncManager.assertKnownSet(setId);
        } catch (error) {
          console.warn('[IllagerShopManager] A reward names an unknown extension; it is ignored.', raw);
          continue;
        }
        rewards.push({
          type,
          quantity,
          slug: null,
          card: null,
          setId,
          texture: await IllagerShopManager.boosterTexture(setId),
        });
        continue;
      }
      if (type === ILLAGER_REWARD_TYPES.CARD) {
        const card = await this.resolveCard(raw.Data);
        if (!card) {
          console.warn('[IllagerShopManager] A reward names an unknown card; it is ignored.', raw);
          continue;
        }
        rewards.push({
          type,
          quantity,
          slug: null,
          card,
          setId: card.set ?? null,
          texture: card.illustration,
        });
        continue;
      }
      console.warn(`[IllagerShopManager] Unknown reward type "${type}"; it is ignored.`, raw);
    }
    return rewards;
  }

  /**
   * Returns the artwork of the pack of an extension, for the thumbnail of an offer.
   *
   * The picture is owned by the extension file (`BoosterTexture`). A set that is not released yet,
   * or whose file cannot be read, has none: the offer still sells it and shows its name alone.
   *
   * @param {string} setId - Extension id.
   * @returns {Promise<string|null>} A path relative to the application root, or null.
   */
  static async boosterTexture(setId) {
    try {
      const set = await boosterManager.getBoosterSet(setId);
      return set.texture ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Resolves the card of a reward from its path (`PROMO-A1 _ E01_fullart`).
   *
   * The name is read like an image path: the index of the card, then the layout after an underscore
   * (`_classic`, `_fullart`). The requested layout wins, then the classic one, then whatever the
   * catalogue holds: an offer naming a printing that does not exist still sells the card.
   *
   * @param {unknown} value - `Data` of a `Card` reward.
   * @returns {Promise<object|null>} The card, or null when no catalogue declares it.
   * @throws {Error} When a catalogue cannot be read.
   */
  async resolveCard(value) {
    const parsed = IllagerShopManager.parseCardPath(value);
    if (!parsed) return null;
    const wanted = IllagerShopManager.normalizeIndex(parsed.index);

    const rows = await promoManager.getAllCards();
    const promoCards = rows
      .filter((row) => IllagerShopManager.normalizeIndex(row.entry?.Index) === wanted)
      .map((row) => row.card);
    const promo = IllagerShopManager.pickLayout(promoCards, parsed.layout);
    if (promo) return promo;

    await boosterManager.init();
    for (const setId of boosterManager.getReleasedSetIds()) {
      const set = boosterManager.getLoadedSet(setId);
      const rawCards = set?.raw?.Cards;
      if (!Array.isArray(rawCards)) continue;
      const cards = rawCards
        .map((entry, position) => ({ entry, card: set.cards[position] }))
        .filter(({ card, entry }) => card && IllagerShopManager.normalizeIndex(entry?.Index) === wanted)
        .map(({ card }) => card);
      const found = IllagerShopManager.pickLayout(cards, parsed.layout);
      if (found) return found;
    }
    return null;
  }

  /**
   * Splits a card path into its index and its optional layout.
   *
   * @param {unknown} value - Path written in the data (`PROMO-A1 _ E01_fullart`).
   * @returns {{index: string, layout: string|null}|null} The parts, or null when it names nothing.
   */
  static parseCardPath(value) {
    if (typeof value !== 'string') return null;
    let rest = value.trim();
    if (rest === '') return null;
    let layout = null;
    const suffix = LAYOUT_SUFFIX.exec(rest);
    if (suffix) {
      layout = suffix[1].toLowerCase();
      rest = rest.slice(0, suffix.index).trim();
    }
    // The index of a card is written `SERIE-A1 / W001` in the catalogues and `SERIE-A1 _ W001` in
    // an image path: both spellings designate the same printing.
    const index = rest.replace(/\s*_\s*/g, ' / ').trim();
    return index === '' ? null : { index, layout };
  }

  /**
   * Normalizes a card identifier, ignoring the spacing around its slash and its case.
   *
   * @param {unknown} value - Raw index.
   * @returns {string} The identifier (`SERIE-A1 / W001`).
   */
  static normalizeIndex(value) {
    if (typeof value !== 'string') return '';
    return value
      .split('/')
      .map((part) => part.trim())
      .join(' / ')
      .toUpperCase();
  }

  /**
   * Picks the printing of a card that matches a requested layout.
   *
   * @param {Array<object>} cards - Printings sharing one index.
   * @param {string|null} layout - Layout asked for by the data, if any.
   * @returns {object|null} The chosen printing.
   */
  static pickLayout(cards, layout) {
    if (cards.length === 0) return null;
    if (layout) {
      const exact = cards.find((card) => (card.isFullArt ? 'fullart' : 'classic') === layout);
      if (exact) return exact;
    }
    return cards.find((card) => !card.isFullArt) ?? cards[0];
  }

  /**
   * Converts the balances of the currencies that reached their expiration day.
   *
   * `ExpirationDate` is the last day a currency is usable: the conversion therefore runs for the
   * days AFTER it, and it is idempotent (a zeroed balance is worth zero Sparks, and zero writes
   * nothing), so it can run on every read.
   *
   * @param {string} day - Current UTC day (`YYYY-MM-DD`).
   * @returns {Promise<Array<{id: string, name: string, texture: string, amount: number, sparks: number}>>}
   *   What was converted, with the name and the texture of each currency: the announcement of the
   *   conversion (`CurrencyExpiryPopup`) shows them.
   * @throws {Error} When the write fails.
   */
  async convertExpired(day) {
    const expired = (this.currencies ?? []).filter(
      (currency) => currency.expiration !== null && day > currency.expiration && currency.conversionRate > 0
    );
    if (expired.length === 0) return [];

    const converted = [];
    const result = await storageRepository.transaction(STORES.USER_STATE, 'readwrite', async (context) => {
      const state = IllagerShopManager.normalizeState(
        await context.get(STORES.USER_STATE, ILLAGER_STATE_KEY)
      );
      const balances = { ...state.balances };
      const done = [];
      for (const currency of expired) {
        const amount = balances[currency.id] ?? 0;
        if (amount <= 0) continue;
        const sparks = amount * currency.conversionRate;
        delete balances[currency.id];
        done.push({
          id: currency.id,
          name: currency.name,
          texture: currency.texture,
          amount,
          sparks,
        });
      }
      if (done.length === 0) return done;
      await context.put(
        STORES.USER_STATE,
        { ...state, balances },
        ILLAGER_STATE_KEY
      );
      const total = done.reduce((sum, entry) => sum + entry.sparks, 0);
      if (total > 0) await sparksManager.addSparks(total, context, SPARKS_SOURCES.ILLAGER);
      return done;
    });

    result.forEach((entry) => {
      converted.push(entry);
      this.log(
        `"${entry.id}" expired: ${entry.amount} converted into ${entry.sparks} Sparks.`
      );
    });
    if (converted.length > 0) {
      eventBus.emit(ILLAGER_SHOP_EVENT, { converted });
      await sparksManager.publishBalance();
    }
    return converted;
  }

  /**
   * Describes one trade, as the view reads it.
   *
   * @param {object} trade - Normalized trade (`{ Price, Rewards, Repeatable }`).
   * @param {string} key - Stable key of the offer.
   * @param {Array<object>} rewards - Rewards already resolved.
   * @param {number} bought - Times the offer was already bought in its set.
   * @param {number} balance - Balance of the currency of the set.
   * @returns {object} The offer.
   */
  static describeOffer({ trade, key, rewards, bought, balance }) {
    const price = Math.max(0, Math.trunc(Number(trade.Price)));
    const repeatable = trade.Repeatable !== false;
    return {
      key,
      price,
      rewards,
      repeatable,
      bought,
      remaining: repeatable ? null : Math.max(0, 1 - bought),
      exhausted: !repeatable && bought >= 1,
      affordable: balance >= price,
    };
  }

  /**
   * Reads the whole shop: the open set, its currency, the balance and the offers.
   *
   * @param {object} [options] - Read options.
   * @param {boolean} [options.force=false] - Re-read the data files.
   * @returns {Promise<{day: string|null, open: boolean, set: object|null, currency: object|null,
   *   balance: number, offers: Array<object>, endsOn: string|null, nextStart: string|null}>}
   *   The shop of the moment. `open` is false when no set covers the day, which is the patrol state.
   * @throws {Error} When the stored state cannot be read.
   */
  async getState({ force = false } = {}) {
    await this.init({ force });
    const day = dateSyncManager.getCurrentUtcDay();
    if (day) await this.convertExpired(day);

    const set = this.getActiveSet(day);
    const next = this.getNextSet(day);
    const state = await this.readState();
    const currency = set ? this.getCurrency(set.currencyId) : null;
    const balance = currency ? state.balances[currency.id] ?? 0 : 0;

    const offers = [];
    if (set) {
      const purchases = state.purchases[String(set.id)] ?? {};
      for (let index = 0; index < set.trades.length; index += 1) {
        const trade = set.trades[index];
        const key = `${set.id}-${index + 1}`;
        const rewards = await this.resolveRewards(Array.isArray(trade.Rewards) ? trade.Rewards : []);
        if (rewards.length === 0) {
          console.warn(`[IllagerShopManager] Offer "${key}" grants nothing usable; it is hidden.`);
          continue;
        }
        offers.push(
          IllagerShopManager.describeOffer({
            trade,
            key,
            rewards,
            bought: purchases[key] ?? 0,
            balance,
          })
        );
      }
    }

    return {
      day,
      open: Boolean(set) && offers.length > 0,
      set,
      currency,
      balance,
      offers,
      endsOn: set?.end ?? null,
      nextStart: next?.start ?? null,
    };
  }

  /**
   * Grants the rewards of a trade inside a transaction.
   *
   * @param {Array<object>} rewards - Rewards of the offer.
   * @param {object} context - Transaction context.
   * @returns {Promise<void>} Resolves once every reward is written.
   * @throws {Error} When a write fails (the whole purchase is rolled back).
   */
  async grantRewards(rewards, context) {
    for (const reward of rewards) {
      if (reward.type === ILLAGER_REWARD_TYPES.SPARKS) {
        await sparksManager.addSparks(reward.quantity, context, SPARKS_SOURCES.ILLAGER);
      } else if (reward.type === ILLAGER_REWARD_TYPES.ULTIMA) {
        await miningManager.grantResources({ [reward.slug]: reward.quantity }, context);
      } else if (reward.type === ILLAGER_REWARD_TYPES.CARD) {
        await boosterManager.addCardToCollection([reward.card], reward.quantity, context);
      } else if (reward.type === ILLAGER_REWARD_TYPES.BOOSTER) {
        await dateSyncManager.addBonusBoosters(reward.setId, reward.quantity, context);
      }
    }
  }

  /**
   * Pays one offer and grants its rewards.
   *
   * The balance, the purchase count and the rewards are written in ONE transaction: a failure can
   * never charge the currency without granting what was bought.
   *
   * @param {string} offerKey - Key of the offer to buy.
   * @returns {Promise<{offer: object, balance: number, card: object|null}>} What was bought.
   * @throws {IllagerError} With `NO_DAY` without a trusted clock, `NO_SET` when no set is open,
   *   `NO_OFFER` for an unknown key, `SOLD_OUT` for a used non-repeatable offer and
   *   `INSUFFICIENT_CURRENCY` when the balance does not cover the price.
   * @throws {Error} When the write fails.
   */
  async buy(offerKey) {
    if (typeof offerKey !== 'string' || offerKey === '') {
      throw new TypeError('IllagerShopManager.buy requires an offer key.');
    }
    const state = await this.getState();
    if (!state.day) {
      throw new IllagerError(ILLAGER_ERRORS.NO_DAY, 'The trusted clock never gave a day.');
    }
    if (!state.open || !state.set || !state.currency) {
      throw new IllagerError(ILLAGER_ERRORS.NO_SET, 'No set of offers is open today.');
    }
    const offer = state.offers.find((candidate) => candidate.key === offerKey);
    if (!offer) {
      throw new IllagerError(ILLAGER_ERRORS.NO_OFFER, `"${offerKey}" is not on sale.`);
    }
    if (offer.exhausted) {
      throw new IllagerError(ILLAGER_ERRORS.SOLD_OUT, `"${offerKey}" was already bought.`);
    }
    if (!offer.affordable) {
      throw new IllagerError(
        ILLAGER_ERRORS.INSUFFICIENT_CURRENCY,
        `The balance (${state.balance}) does not cover the price (${offer.price}).`
      );
    }

    // The quota of the bonus boosters is reset before the transaction opens: the shared-context
    // grant does not run that reset (see `DateSyncManager.addBonusBoosters`).
    if (offer.rewards.some((reward) => reward.type === ILLAGER_REWARD_TYPES.BOOSTER)) {
      await dateSyncManager.ensureDailyReset();
    }

    const setId = String(state.set.id);
    const currencyId = state.currency.id;
    const committed = await storageRepository.transaction(
      [STORES.USER_STATE, STORES.COLLECTION],
      'readwrite',
      async (context) => {
        // Re-read inside the transaction: two tabs, or a double tap, must not buy twice.
        const current = IllagerShopManager.normalizeState(
          await context.get(STORES.USER_STATE, ILLAGER_STATE_KEY)
        );
        const balance = current.balances[currencyId] ?? 0;
        const purchases = current.purchases[setId] ?? {};
        const bought = purchases[offerKey] ?? 0;
        if (!offer.repeatable && bought >= 1) {
          throw new IllagerError(ILLAGER_ERRORS.SOLD_OUT, `"${offerKey}" was already bought.`);
        }
        if (balance < offer.price) {
          throw new IllagerError(
            ILLAGER_ERRORS.INSUFFICIENT_CURRENCY,
            `The balance (${balance}) does not cover the price (${offer.price}).`
          );
        }

        const nextBalance = balance - offer.price;
        const balances = { ...current.balances };
        if (nextBalance === 0) delete balances[currencyId];
        else balances[currencyId] = nextBalance;

        await this.grantRewards(offer.rewards, context);
        await context.put(
          STORES.USER_STATE,
          {
            balances,
            purchases: {
              ...current.purchases,
              [setId]: { ...purchases, [offerKey]: bought + 1 },
            },
          },
          ILLAGER_STATE_KEY
        );
        return { balance: nextBalance };
      }
    );

    const card = offer.rewards.find((reward) => reward.card)?.card ?? null;
    this.log(`Bought "${offerKey}" for ${offer.price} ${currencyId} (balance: ${committed.balance}).`);
    eventBus.emit(ILLAGER_SHOP_EVENT, {
      currencyId,
      balance: committed.balance,
      offerKey,
    });
    // The card is what was bought: it is announced the way a trader announces one, so the
    // collection, the trophies and the notifications follow it.
    if (card) {
      eventBus.emit(EVENTS.CARDS_OBTAINED, {
        cards: [card],
        newKeys: [],
        source: 'illager',
      });
    }
    return { offer, balance: committed.balance, card };
  }

  /**
   * Drops the cached data files (the shop is rebuilt on the next read).
   *
   * @returns {void}
   */
  reset() {
    this.currencies = null;
    this.sets = null;
    this.initPromise = null;
  }
}

/** Shared instance used by the view and by the reward flows. */
export const illagerShopManager = new IllagerShopManager();

export default illagerShopManager;

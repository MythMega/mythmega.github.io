/**
 * MinePickManager - Mine Pick: ten simulated boosters a day, three picks.
 *
 * Reference: `settings/config.json` (`minePick`), `.docs/main.md` section 3.H.
 *
 * WHAT THE PLAYER SEES
 *   A board of `boosterCount` (10) simulated openings, laid out as a LIST: every row shows the
 *   booster texture, its name and its five cards FACE UP, so the player picks a pack knowing what
 *   it holds. Opening one turns its cards face down and shuffles them (a seeded permutation), the
 *   player then turns one over and KEEPS it, and the other cards are revealed. `picksPerDay` (3)
 *   free picks per UTC day, reset at midnight UTC exactly like the daily boosters, plus any pick
 *   bought with Sparks (`minePick.extraPickPriceSparks`) once the free ones are spent. A booster
 *   already picked from stays in the list with the card that was kept and can not be picked again
 *   the same day, so the choices really run out before the ten rows do.
 *
 * THE PACKS ARE REAL
 *   A simulated pack is drawn by the SAME `GachaEngine`, with the SAME rarity table (including the
 *   per-extension override) and the SAME `boosters.cardsPerBooster` / `boosters.godpackChancePercent`
 *   as an opened booster: editing `settings/config.json` really changes what the Mine Pick shows.
 *   The only difference is the randomness source (below), and that only the picked card is written.
 *
 * DETERMINISM
 *   The whole board comes from one seeded generator: `seedSalt` + the trusted UTC day + the account
 *   UUID. A reload therefore shows the same board, the board changes at the next UTC day, and two
 *   accounts never share one. The seed never uses `Math.random()`, and every draw is taken in a
 *   fixed order (boosters in index order), so the tenth booster does not depend on rendering.
 *
 * WHAT IS PERSISTED (`user_state["minePick"]`)
 *   `lastResetDay` / `remaining`  : the daily allowance, reset like the booster quota;
 *   `bonusPicks`                  : picks BOUGHT with Sparks, added to the free allowance, spent
 *                                   only once it is gone and never cleared by the daily reset;
 *   `picksByBooster`              : `{ [boosterIndex]: { key, rarity, setId, pickedAt } }` for the
 *                                   current day — what lets the list show which booster was already
 *                                   used and which card came out of it, and what `ALREADY_PICKED`
 *                                   reads;
 *   `totalPicks`                  : how many cards were picked since the account was created;
 *   `picksByRarity` / `picksByCard`: the dedicated statistics block of the feature;
 *   `history`                     : the last `historySize` picks (day, booster index, extension,
 *                                   card, revealed pack).
 *
 * A pick is committed in ONE transaction (collection row + minepick state), so a failure can never
 * consume a pick without granting the card. The obtained card is announced through
 * `CARDS_OBTAINED` (`source: 'minepick'`), which is what feeds the trophies, the experience and the
 * notifications: a picked card counts exactly like a drawn one for the collection, but it never
 * appears in the opening statistics (it is not an opened booster).
 */

import { storageRepository, STORES } from '../models/StorageRepository.js';
import { configLoader } from '../utils/ConfigLoader.js';
import eventBus, { EVENTS } from '../utils/EventBus.js';
import dateSyncManager from './DateSyncManager.js';
import boosterManager, { buildCollectionTimestamp } from './BoosterManager.js';
import accountManager, { USER_STATE_KEYS } from './AccountManager.js';
import sparksManager from './SparksManager.js';
import GachaEngine from './GachaEngine.js';
import { CARD_RARITY } from '../classes/Card.js';

/** Source carried by the `CARDS_OBTAINED` event of a picked card. */
export const MINE_PICK_SOURCE = 'minepick';

/** Error codes raised by this manager. */
export const MINE_PICK_ERRORS = Object.freeze({
  NO_PICK_LEFT: 'NO_PICK_LEFT',
  ALREADY_PICKED: 'ALREADY_PICKED',
  UNKNOWN_BOOSTER: 'UNKNOWN_BOOSTER',
  UNKNOWN_CARD: 'UNKNOWN_CARD',
  NO_BOARD: 'NO_BOARD',
});

/** i18n keys of the error codes, so a view never invents its own message. */
const ERROR_MESSAGE_KEYS = Object.freeze({
  [MINE_PICK_ERRORS.NO_PICK_LEFT]: 'minepick.error.noPick',
  [MINE_PICK_ERRORS.ALREADY_PICKED]: 'minepick.error.alreadyPicked',
  [MINE_PICK_ERRORS.UNKNOWN_BOOSTER]: 'minepick.error.booster',
  [MINE_PICK_ERRORS.UNKNOWN_CARD]: 'minepick.error.card',
  [MINE_PICK_ERRORS.NO_BOARD]: 'minepick.error.board',
});

/**
 * Returns the i18n key describing a Mine Pick error code.
 *
 * @param {unknown} code - Error code (`MINE_PICK_ERRORS`).
 * @returns {string} The translation key, falling back to the generic one.
 */
export function getMinePickErrorMessageKey(code) {
  return ERROR_MESSAGE_KEYS[code] ?? 'minepick.error.board';
}

/**
 * Turns a text into a 32-bit seed (xmur3-style mixing).
 *
 * Pure integer arithmetic: the same text always gives the same seed, on every browser, which is
 * what makes the daily board reproducible.
 *
 * @param {string} text - Seed material (salt + day + UUID).
 * @returns {number} An unsigned 32-bit seed.
 */
export function hashSeed(text) {
  const source = String(text);
  let hash = 1779033703 ^ source.length;
  for (let index = 0; index < source.length; index += 1) {
    hash = Math.imul(hash ^ source.charCodeAt(index), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }
  return hash >>> 0;
}

/**
 * Builds a deterministic pseudo-random generator (mulberry32).
 *
 * @param {number} seed - Unsigned 32-bit seed.
 * @returns {() => number} A function returning a float in [0, 1), `Math.random()` compatible.
 */
export function createSeededRandom(seed) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Raised by every refused Mine Pick operation, with a stable `code`. */
export class MinePickError extends Error {
  /**
   * @param {string} code - One of `MINE_PICK_ERRORS`.
   * @param {string} message - Technical message (the UI shows a translated one).
   */
  constructor(code, message) {
    super(message);
    this.name = 'MinePickError';
    this.code = code;
  }
}

export class MinePickManager {
  constructor() {
    /** @type {{day: string|null, uuid: string|null, board: Array<object>}|null} In-memory board. */
    this.boardCache = null;
    /** @type {Promise<Array<object>>|null} In-flight board build, to de-duplicate concurrent calls. */
    this.boardPromise = null;
    /** @type {boolean} True once `init()` completed. */
    this.isInitialized = false;
  }

  /**
   * Logs with the manager prefix.
   *
   * @param {...unknown} args - Values forwarded to `console.info`.
   * @returns {void}
   */
  log(...args) {
    console.info('[MinePickManager]', ...args);
  }

  /**
   * Loads the Mine Pick settings and the booster pools.
   *
   * @param {object} [options] - Load options.
   * @param {boolean} [options.force=false] - Reload even when already initialized.
   * @returns {Promise<void>} Resolves once the manager is usable.
   * @throws {Error} When `config.json` or an extension file cannot be read.
   */
  async init({ force = false } = {}) {
    if (this.isInitialized && !force) return;
    await configLoader.getMinePickSettings();
    await boosterManager.init();
    this.isInitialized = true;
    this.log(`Ready (${boosterManager.getReleasedSetIds().length} extension(s) available).`);
  }

  /**
   * Trusted UTC day of the current board.
   *
   * @returns {string|null} `YYYY-MM-DD`, or null when the clock was never anchored.
   */
  getDay() {
    return dateSyncManager.getCurrentUtcDay();
  }

  /**
   * Reads and normalizes the stored state, without writing anything.
   *
   * The daily allowance is resolved on the fly: when the stored day is older than the trusted one,
   * the state is reported as a fresh day (full allowance, no booster used yet) and the write happens
   * with the next pick. A stored day located in the FUTURE (tampered state) is not reset either,
   * exactly like the booster quota.
   *
   * `bonusPicks` counts the picks bought with Sparks: they are added to the free allowance and the
   * daily rollover never clears them (they were paid for).
   *
   * @returns {Promise<{day: string|null, lastResetDay: string|null, remaining: number,
   *   bonusPicks: number, picksPerDay: number, totalPicks: number,
   *   picksByRarity: Record<string, number>, picksByCard: Record<string, number>,
   *   picksByBooster: Record<string, object>, history: Array<object>}>} The effective state
   *   (`remaining` being the FREE picks, `bonusPicks` the bought ones).
   * @throws {Error} When the read or `config.json` fails.
   */
  async getState() {
    const { picksPerDay } = await configLoader.getMinePickSettings();
    // Nothing to migrate: the save of a player who picked before the rename keeps its collection,
    // but its old board state is simply not read anymore (the seed changed, so the packs it
    // remembers are not the ones on the screen anyway).
    const stored = this.normalizeState(
      await storageRepository.getUserState(USER_STATE_KEYS.MINE_PICK),
      picksPerDay
    );
    const day = this.getDay();
    const rolledOver =
      Boolean(day) &&
      dateSyncManager.isTimeTrusted() &&
      stored.lastResetDay !== day &&
      !(stored.lastResetDay && stored.lastResetDay > day);

    return {
      ...stored,
      day,
      picksPerDay,
      remaining: rolledOver ? picksPerDay : stored.remaining,
      picksByBooster: rolledOver ? {} : stored.picksByBooster,
    };
  }

  /**
   * Normalizes a raw `user_state["minePick"]` payload.
   *
   * @param {unknown} raw - Stored value.
   * @param {number} picksPerDay - Configured allowance.
   * @returns {object} A state guaranteed to be usable.
   */
  normalizeState(raw, picksPerDay) {
    const source = raw && typeof raw === 'object' ? raw : {};

    const picksByRarity = {};
    if (source.picksByRarity && typeof source.picksByRarity === 'object') {
      for (let rarity = CARD_RARITY.MIN; rarity <= CARD_RARITY.MAX; rarity += 1) {
        const count = source.picksByRarity[String(rarity)];
        if (Number.isFinite(count) && count > 0) picksByRarity[String(rarity)] = Math.floor(count);
      }
    }

    const picksByCard = {};
    if (source.picksByCard && typeof source.picksByCard === 'object') {
      Object.entries(source.picksByCard).forEach(([key, count]) => {
        if (typeof key === 'string' && Number.isFinite(count) && count > 0) {
          picksByCard[key] = Math.floor(count);
        }
      });
    }

    const picksByBooster = {};
    if (source.picksByBooster && typeof source.picksByBooster === 'object') {
      Object.entries(source.picksByBooster).forEach(([index, entry]) => {
        const rank = Number(index);
        if (!Number.isInteger(rank) || rank < 0) return;
        if (!entry || typeof entry !== 'object' || typeof entry.key !== 'string') return;
        picksByBooster[String(rank)] = {
          key: entry.key,
          rarity: Number.isFinite(entry.rarity) ? entry.rarity : null,
          setId: typeof entry.setId === 'string' ? entry.setId : null,
          pickedAt: typeof entry.pickedAt === 'string' ? entry.pickedAt : null,
        };
      });
    }

    return {
      lastResetDay: typeof source.lastResetDay === 'string' ? source.lastResetDay : null,
      remaining:
        Number.isInteger(source.remaining) && source.remaining >= 0
          ? Math.min(source.remaining, picksPerDay)
          : picksPerDay,
      // Never capped by `picksPerDay`: a bought pick is an extra one, and it survives the day.
      bonusPicks:
        Number.isInteger(source.bonusPicks) && source.bonusPicks >= 0 ? source.bonusPicks : 0,
      totalPicks: Number.isInteger(source.totalPicks) && source.totalPicks > 0 ? source.totalPicks : 0,
      picksByRarity,
      picksByCard,
      picksByBooster,
      history: Array.isArray(source.history) ? source.history.filter((entry) => entry && typeof entry === 'object') : [],
    };
  }

  /**
   * Remaining FREE picks of the current UTC day (bought picks excluded).
   *
   * @returns {Promise<number>} The number of free picks left (0 when the day is exhausted).
   * @throws {Error} See `getState()`.
   */
  async getRemainingPicks() {
    return (await this.getState()).remaining;
  }

  /**
   * Applies the daily rollover to a state read inside a transaction.
   *
   * Shared by `pick()` and `buyExtraPick()` so a same-day first action can never disagree with the
   * other one. The allowance is only refilled when the trusted day differs from the stored one AND
   * the stored day is not ahead of it (a frozen or tampered day never refills anything); the
   * `bonusPicks` are never touched.
   *
   * @param {object} state - Normalized stored state.
   * @param {string|null} trustedDay - Trusted UTC day, or null while the clock is unknown.
   * @param {number} picksPerDay - Configured daily allowance.
   * @returns {object} The state to work with (the very same object when no rollover is due).
   */
  resolveDailyRollover(state, trustedDay, picksPerDay) {
    if (!trustedDay || state.lastResetDay === trustedDay) return state;
    if (state.lastResetDay && state.lastResetDay > trustedDay) {
      console.warn(
        `[MinePickManager] The stored day (${state.lastResetDay}) is ahead of the trusted day (${trustedDay}): the allowance is left untouched.`
      );
      return state;
    }
    return { ...state, lastResetDay: trustedDay, remaining: picksPerDay, picksByBooster: {} };
  }

  /**
   * Buys one extra Mine Pick with Sparks (`minePick.extraPickPriceSparks`).
   *
   * Offered once both the free allowance and the bought picks of the day are spent: the purchased
   * pick is added to the same state under `bonusPicks`, is spent only once the daily allowance is
   * gone, and survives the daily reset.
   *
   * The debit and the credit run in ONE transaction over `user_state`: a failure can never charge
   * the balance without granting the pick, or grant the pick without charging it.
   *
   * @returns {Promise<{price: number, balance: number, bonusPicks: number}>} The price charged, the
   *   resulting Sparks balance and the number of bought picks left.
   * @throws {SparksError} With `INSUFFICIENT_SPARKS` when the balance does not cover the price.
   * @throws {Error} When the transaction fails.
   */
  async buyExtraPick() {
    const { picksPerDay, extraPickPriceSparks } = await configLoader.getMinePickSettings();
    const day = this.getDay();
    const trustedDay = dateSyncManager.isTimeTrusted() && day ? day : null;

    const result = await storageRepository.transaction(
      STORES.USER_STATE,
      'readwrite',
      async (context) => {
        const balance = await sparksManager.applyDelta(context, -extraPickPriceSparks);
        const stored = this.normalizeState(
          await context.get(STORES.USER_STATE, USER_STATE_KEYS.MINE_PICK),
          picksPerDay
        );
        const state = this.resolveDailyRollover(stored, trustedDay, picksPerDay);
        const next = { ...state, bonusPicks: (state.bonusPicks ?? 0) + 1 };
        await context.put(STORES.USER_STATE, next, USER_STATE_KEYS.MINE_PICK);
        return { balance, bonusPicks: next.bonusPicks };
      }
    );

    this.log(
      `Extra pick bought for ${extraPickPriceSparks} Sparks (${result.bonusPicks} bought pick(s) left, balance: ${result.balance}).`
    );
    await sparksManager.publishBalance();
    await this.emitStateUpdated();
    return { price: extraPickPriceSparks, balance: result.balance, bonusPicks: result.bonusPicks };
  }

  /**
   * Builds (or returns) the board of the day: `boosterCount` simulated openings.
   *
   * The board is cached in memory for the day it belongs to: the seed guarantees it would be
   * identical anyway, but the cache keeps a view refresh free.
   *
   * @param {object} [options] - Board options.
   * @param {boolean} [options.force=false] - Rebuild the board even when it is cached.
   * @returns {Promise<Array<{index: number, setId: string, name: string, texture: string|null,
   *   godpack: boolean, cards: Array, order: number[]}>>} The ten boosters of the day. `order` is
   *   the position in which the view deals the cards (a seeded permutation of `cards`).
   * @throws {Error} When the account, `config.json` or the extension files cannot be read.
   */
  async getBoard({ force = false } = {}) {
    await this.init();
    const day = this.getDay();
    const uuid = await accountManager.getUuid();

    if (force) {
      this.boardCache = null;
      this.boardPromise = null;
    }
    if (this.boardCache && this.boardCache.day === day && this.boardCache.uuid === uuid) {
      return this.boardCache.board;
    }
    if (this.boardPromise) return this.boardPromise;

    this.boardPromise = this.buildBoard({ day, uuid })
      .then((board) => {
        this.boardCache = { day, uuid, board };
        this.boardPromise = null;
        return board;
      })
      .catch((error) => {
        this.boardPromise = null;
        throw error;
      });
    return this.boardPromise;
  }

  /**
   * Draws the ten boosters of a day.
   *
   * @param {object} options - Draw options.
   * @param {string|null} options.day - Trusted UTC day (null while the clock is unknown: the board
   *   is then built on the UUID alone, which still makes it stable for the session).
   * @param {string} options.uuid - Account UUID.
   * @returns {Promise<Array<object>>} The drawn board.
   * @throws {Error} See `getBoard()`.
   */
  async buildBoard({ day, uuid }) {
    const { boosterCount, seedSalt, setWeightExponent } = await configLoader.getMinePickSettings();
    const { cardsPerBooster, godpackChancePercent } = await configLoader.getBoosterSettings();

    // Released sets only: the simulated board must never show a card of an announced set.
    const setIds = boosterManager.getReleasedSetIds();
    if (setIds.length === 0) {
      throw new MinePickError(MINE_PICK_ERRORS.NO_BOARD, 'No extension is available for the board.');
    }

    const random = createSeededRandom(hashSeed(`${seedSalt}|${day ?? 'unknown-day'}|${uuid ?? 'no-account'}`));
    const gachaEngine = new GachaEngine({ random });
    // The extensions are weighted by their rank: the id that sorts LAST is the likeliest, so the
    // newest extension comes up more often than the oldest one.
    const weightedSets = setIds
      .slice()
      .sort((left, right) => String(left).localeCompare(String(right), undefined, { numeric: true }));

    const board = [];
    for (let index = 0; index < boosterCount; index += 1) {
      const setId = MinePickManager.pickWeightedSet(weightedSets, setWeightExponent, random);
      const loadedSet = boosterManager.getLoadedSet(setId);
      if (!loadedSet) continue;

      const pack = { setId, cards: loadedSet.cards };
      const isGodpack = gachaEngine.shouldDrawGodpack(pack, { chancePercent: godpackChancePercent });
      const cards = isGodpack
        ? gachaEngine.drawGodpack(pack, loadedSet.rarityConfig, { cardsPerBooster })
        : gachaEngine.drawPack(pack, loadedSet.rarityConfig, { cardsPerBooster });

      board.push({
        index: board.length,
        setId,
        name: loadedSet.name,
        texture: loadedSet.texture,
        godpack: isGodpack,
        cards,
        order: [],
      });
    }

    // A SECOND generator, derived from the same seed, decides how each pack is shuffled before the
    // player picks: it is drawn once every pack is complete, so the first generator alone still
    // decides the cards (the drawn packs do not depend on this), while the order stays stable
    // across reloads and different from one booster to the next.
    const orderRandom = createSeededRandom(
      hashSeed(`${seedSalt}|order|${day ?? 'unknown-day'}|${uuid ?? 'no-account'}`)
    );
    board.forEach((entry) => {
      entry.order = MinePickManager.buildShuffleOrder(entry.cards.length, orderRandom);
    });

    this.log(`Board of ${board.length} booster(s) drawn for day ${day ?? 'unknown'} (seed "${seedSalt}").`);
    return board;
  }

  /**
   * Builds a shuffle order (a permutation of the card positions) from a seeded generator.
   *
   * Plain Fisher-Yates: every permutation is reachable, and the same generator always returns the
   * same order, which is what makes the shuffle of a pack reproducible.
   *
   * @param {number} length - Number of cards to shuffle.
   * @param {() => number} random - Seeded generator returning a float in [0, 1).
   * @returns {number[]} The positions in display order: slot `d` shows the card `order[d]`.
   */
  static buildShuffleOrder(length, random) {
    const order = Array.from({ length: Math.max(0, Math.floor(length)) }, (_, index) => index);
    for (let index = order.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(random() * (index + 1));
      const buffer = order[index];
      order[index] = order[swap];
      order[swap] = buffer;
    }
    return order;
  }

  /**
   * Draws one extension id, weighted by its rank.
   *
   * @param {string[]} setIds - Extension ids, sorted from the oldest to the highest id.
   * @param {number} exponent - Weight exponent: `weight = (rank + 1) ** exponent`.
   * @param {() => number} random - Seeded generator.
   * @returns {string} The chosen extension id.
   */
  static pickWeightedSet(setIds, exponent, random) {
    const weights = setIds.map((_, index) => (index + 1) ** exponent);
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let roll = random() * total;
    for (let index = 0; index < setIds.length; index += 1) {
      roll -= weights[index];
      if (roll < 0) return setIds[index];
    }
    return setIds[setIds.length - 1];
  }

  /**
   * Picks a card of the board: one free pick is spent, the card is added to the collection and the
   * dedicated statistics are updated.
   *
   * The read-modify-write of the allowance, the collection row and the statistics run in a SINGLE
   * transaction, so two rapid picks can never spend the same last pick, and a failure never leaves
   * a pick consumed without its card.
   *
   * @param {number} boosterIndex - Position of the booster on the board (0-based).
   * @param {number} cardIndex - Position of the card inside that booster (0-based).
   * @returns {Promise<{card: object, isNew: boolean, quantity: number, remaining: number,
   *   setId: string, setName: string, revealed: Array<object>, order: number[], godpack: boolean}>}
   *   The committed pick. `revealed` lists the whole pack and `order` the position of each card on
   *   screen, so the view can turn the other cards over where they stand.
   * @throws {MinePickError} With `NO_PICK_LEFT`, `ALREADY_PICKED`, `UNKNOWN_BOOSTER` or
   *   `UNKNOWN_CARD`.
   * @throws {Error} When the transaction fails.
   */
  async pick(boosterIndex, cardIndex) {
    const board = await this.getBoard();
    const entry = board.find((candidate) => candidate.index === Number(boosterIndex));
    if (!entry) {
      throw new MinePickError(
        MINE_PICK_ERRORS.UNKNOWN_BOOSTER,
        `No booster #${boosterIndex} on the board of the day.`
      );
    }
    const card = entry.cards[Number(cardIndex)];
    if (!card) {
      throw new MinePickError(
        MINE_PICK_ERRORS.UNKNOWN_CARD,
        `No card #${cardIndex} in booster #${boosterIndex}.`
      );
    }

    const { picksPerDay, historySize } = await configLoader.getMinePickSettings();
    const day = this.getDay();
    const trustedDay = dateSyncManager.isTimeTrusted() && day ? day : null;

    const result = await storageRepository.transaction(
      [STORES.COLLECTION, STORES.USER_STATE],
      'readwrite',
      async (context) => {
        const stored = this.normalizeState(
          await context.get(STORES.USER_STATE, USER_STATE_KEYS.MINE_PICK),
          picksPerDay
        );

        // Daily reset, evaluated inside the transaction: the stored day is only trusted when the
        // clock is (a frozen or tampered day never refills the picks).
        const state = this.resolveDailyRollover(stored, trustedDay, picksPerDay);

        // A bought pick counts too: only a state with neither a free nor a bought pick left is
        // exhausted.
        if (state.remaining <= 0 && state.bonusPicks <= 0) {
          throw new MinePickError(
            MINE_PICK_ERRORS.NO_PICK_LEFT,
            'No Mine Pick is left for the current UTC day.'
          );
        }

        // One pick per booster and per day: the list keeps showing the booster with the card that
        // came out of it, so it must never be played again the same day.
        if (state.picksByBooster[String(entry.index)]) {
          throw new MinePickError(
            MINE_PICK_ERRORS.ALREADY_PICKED,
            `Booster #${entry.index} was already used for the current UTC day.`
          );
        }

        const existing = await context.get(STORES.COLLECTION, card.uniqueKey);
        const quantity = (Number.isFinite(existing?.quantity) ? existing.quantity : 0) + 1;
        const timestamp = buildCollectionTimestamp();
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

        const rarityKey = String(card.rarity);
        // A bought pick is only spent once the free allowance is gone: the paid one keeps for
        // later, since the daily reset never clears it.
        const spendsBonus = state.remaining <= 0;
        const nextState = {
          ...state,
          lastResetDay: trustedDay ?? state.lastResetDay,
          remaining: spendsBonus ? state.remaining : state.remaining - 1,
          bonusPicks: spendsBonus ? Math.max(0, state.bonusPicks - 1) : state.bonusPicks,
          totalPicks: state.totalPicks + 1,
          picksByRarity: {
            ...state.picksByRarity,
            [rarityKey]: (state.picksByRarity[rarityKey] ?? 0) + 1,
          },
          picksByCard: {
            ...state.picksByCard,
            [card.uniqueKey]: (state.picksByCard[card.uniqueKey] ?? 0) + 1,
          },
          picksByBooster: {
            ...state.picksByBooster,
            [String(entry.index)]: {
              key: card.uniqueKey,
              rarity: card.rarity,
              setId: entry.setId,
              pickedAt: timestamp,
            },
          },
          history: [
            {
              day: trustedDay ?? state.lastResetDay,
              boosterIndex: entry.index,
              setId: entry.setId,
              setName: entry.name,
              key: card.uniqueKey,
              rarity: card.rarity,
              godpack: entry.godpack,
              pickedAt: timestamp,
              // The whole pack, in the order it was dealt (see `order`), so the statistics can show
              // what was offered next to what was kept.
              revealed: entry.cards.map((candidate) => candidate.uniqueKey),
            },
            ...state.history,
          ].slice(0, historySize),
        };

        await context.put(STORES.USER_STATE, nextState, USER_STATE_KEYS.MINE_PICK);
        return { nextState, quantity, isNew: !existing };
      }
    );

    this.log(
      `Picked "${card.uniqueKey}" (rarity ${card.rarity}) in booster #${entry.index} of "${entry.setId}", ` +
        `${result.nextState.remaining} free and ${result.nextState.bonusPicks} bought pick(s) left.`
    );

    eventBus.emit(EVENTS.MINE_PICK_UPDATED, this.buildUpdatePayload(result.nextState, picksPerDay));
    // A picked card is a second way into the collection (the first being an opening): publishing it
    // lets the trophies, the experience and the notifications follow it, exactly like a bought card.
    eventBus.emit(EVENTS.CARDS_OBTAINED, {
      cards: [card],
      newKeys: result.isNew ? [card.uniqueKey] : [],
      source: MINE_PICK_SOURCE,
    });

    return {
      card,
      isNew: result.isNew,
      quantity: result.quantity,
      // Picks the player can still make today, bought ones included: that is what the result line
      // announces ("you have N picks left today").
      remaining: result.nextState.remaining + result.nextState.bonusPicks,
      bonusPicks: result.nextState.bonusPicks,
      setId: entry.setId,
      setName: entry.name,
      revealed: entry.cards,
      order: entry.order,
      godpack: entry.godpack,
    };
  }

  /**
   * Payload published on `MINE_PICK_UPDATED`.
   *
   * @param {object} state - Normalized state.
   * @param {number} picksPerDay - Configured allowance.
   * @returns {{day: string|null, remaining: number, bonusPicks: number, picksPerDay: number,
   *   totalPicks: number}} Payload. `remaining` counts the FREE picks only and `bonusPicks` the
   *   bought ones, so a consumer can show the allowance without inventing a breakdown.
   */
  buildUpdatePayload(state, picksPerDay) {
    return {
      day: state.lastResetDay ?? this.getDay(),
      remaining: state.remaining,
      bonusPicks: state.bonusPicks ?? 0,
      picksPerDay,
      totalPicks: state.totalPicks,
    };
  }

  /**
   * Publishes the current state on `MINE_PICK_UPDATED`.
   *
   * Used after a clock tick or an import, so the screen reacts without waiting for the next pick.
   *
   * @returns {Promise<void>} Resolves once the event was emitted.
   * @throws {Error} See `getState()`.
   */
  async emitStateUpdated() {
    const state = await this.getState();
    eventBus.emit(EVENTS.MINE_PICK_UPDATED, {
      day: state.day,
      remaining: state.remaining,
      bonusPicks: state.bonusPicks ?? 0,
      picksPerDay: state.picksPerDay,
      totalPicks: state.totalPicks,
    });
  }

  /**
   * Drops the cached board (used when the account changes: an imported save has another UUID).
   *
   * @returns {void}
   */
  resetBoard() {
    this.boardCache = null;
    this.boardPromise = null;
  }
}

/** Shared instance used by the Mine Pick view and by `app.js`. */
export const minePickManager = new MinePickManager();

export default minePickManager;

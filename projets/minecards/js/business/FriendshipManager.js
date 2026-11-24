/**
 * FriendshipManager - the bond earned with each followed player.
 *
 * Reference: `settings/global_trophy.json` (entry `bestfriend`), `TradeManager`, `LikesManager`.
 *
 * XP
 *   A completed trade grants `10 x rarity` XP (the rarity of the two exchanged cards). A trade that
 *   was already finished before this feature existed is seeded from the history the worker still
 *   returns, at the same `10 x rarity` rate and once per trade id; what the history no longer holds
 *   is only known as a count per partner (`trades.stats.byPartner`) and pays the flat
 *   `FRIENDSHIP_TRADE_XP` rate. One like sent or received grants `FRIENDSHIP_LIKE_XP` XP.
 *
 * LEVELS
 *   The thresholds are read from the `bestfriend` tiers of `settings/global_trophy.json`, the very
 *   table the global trophy uses, so editing the file moves the stars and the trophy together. A
 *   friend reaches one star per tier, and the stars take the colour of that tier (`bronze`,
 *   `silver`, `gold`, `diamond`, `emerald`).
 *
 * STORAGE
 *   `user_state["friendship"]` holds `{ xp, trades, tradeIds, seenLikes }`: the XP per UUID, the
 *   number of completed trades already converted per UUID, the identifiers of the trades already
 *   converted from the worker history (what keeps both seeds idempotent), and the likes already
 *   counted (`recv:uuid|day` / `sent:uuid|day`). It travels with a save export. The best XP
 *   of the account is mirrored into `stats.bestfriend`, which is what the global trophy reads.
 */

import configLoader from '../utils/ConfigLoader.js';
import storageRepository, { STORES } from '../models/StorageRepository.js';
import { USER_STATE_KEYS } from './AccountManager.js';
import trophyManager from './TrophyManager.js';

/** XP granted by one completed trade when its rarity is unknown (legacy rows). */
export const FRIENDSHIP_TRADE_XP = 25;

/** XP granted per rarity point of a tracked trade (`10 x rarity`). */
export const FRIENDSHIP_XP_PER_RARITY = 10;

/** XP granted by one like, sent or received. */
export const FRIENDSHIP_LIKE_XP = 1;

/** Tiers used when `settings/global_trophy.json` cannot be read. */
export const DEFAULT_FRIENDSHIP_TIERS = Object.freeze([
  Object.freeze({ rarity: 'bronze', target: 25 }),
  Object.freeze({ rarity: 'silver', target: 100 }),
  Object.freeze({ rarity: 'gold', target: 250 }),
  Object.freeze({ rarity: 'diamond', target: 500 }),
  Object.freeze({ rarity: 'emerald', target: 1500 }),
]);

/** Tier rarities accepted from the configuration, in their display order. */
const TIER_RARITIES = Object.freeze(['bronze', 'silver', 'gold', 'diamond', 'emerald']);

/** Number of like events remembered for the de-duplication (the last ones). */
const SEEN_LIKES_LIMIT = 1000;

/** Number of trade identifiers remembered as already converted (the last ones). */
const TRADE_IDS_LIMIT = 500;

/**
 * Builds the empty friendship state.
 *
 * @returns {{xp: Record<string, number>, trades: Record<string, number>, tradeIds: string[],
 *   seenLikes: string[]}} A state with no XP and no remembered like.
 */
function emptyState() {
  return { xp: {}, trades: {}, tradeIds: [], seenLikes: [] };
}

/**
 * Normalizes a raw stored friendship state.
 *
 * @param {unknown} value - `user_state["friendship"]`.
 * @returns {{xp: Record<string, number>, trades: Record<string, number>, tradeIds: string[],
 *   seenLikes: string[]}} The cleaned state.
 */
function normalizeState(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const state = emptyState();

  const readCounter = (raw) => {
    const number = Math.trunc(Number(raw) || 0);
    return number > 0 ? number : 0;
  };

  if (source.xp && typeof source.xp === 'object' && !Array.isArray(source.xp)) {
    Object.entries(source.xp).forEach(([uuid, amount]) => {
      if (typeof uuid !== 'string' || uuid.trim() === '') return;
      const xp = readCounter(amount);
      if (xp > 0) state.xp[uuid] = xp;
    });
  }
  if (source.trades && typeof source.trades === 'object' && !Array.isArray(source.trades)) {
    Object.entries(source.trades).forEach(([uuid, count]) => {
      if (typeof uuid !== 'string' || uuid.trim() === '') return;
      const total = readCounter(count);
      if (total > 0) state.trades[uuid] = total;
    });
  }
  if (Array.isArray(source.tradeIds)) {
    state.tradeIds = trimTradeIds(
      Array.from(new Set(source.tradeIds.filter((id) => typeof id === 'string' && id !== '')))
    );
  }
  if (Array.isArray(source.seenLikes)) {
    state.seenLikes = source.seenLikes
      .filter((key) => typeof key === 'string' && key !== '')
      .slice(-SEEN_LIKES_LIMIT);
  }
  return state;
}

/**
 * Reads the highest XP of one friendship state.
 *
 * @param {Record<string, number>} xp - XP per UUID.
 * @returns {number} The highest XP, or 0 when nobody earned any.
 */
function highestXp(xp) {
  return Object.values(xp ?? {}).reduce((best, value) => Math.max(best, Number(value) || 0), 0);
}

/**
 * Builds the de-duplication key of one like.
 *
 * @param {string} prefix - `recv` or `sent`.
 * @param {string} uuid - Player UUID.
 * @param {string} day - UTC day of the like.
 * @returns {string} The key, or an empty string when it cannot identify the like.
 */
function likeKey(prefix, uuid, day) {
  if (uuid === '' || day === '') return '';
  return `${prefix}:${uuid}|${day}`;
}

/**
 * Keeps the most recent trade identifiers of one state.
 *
 * @param {string[]} ids - Identifiers, oldest first.
 * @returns {string[]} The same list, or its last `TRADE_IDS_LIMIT` entries.
 */
function trimTradeIds(ids) {
  return ids.length > TRADE_IDS_LIMIT ? ids.slice(-TRADE_IDS_LIMIT) : ids;
}

export class FriendshipManager {
  constructor() {
    /** @type {Promise<Array<{rarity: string, target: number}>>|null} Thresholds of the file. */
    this.tiersPromise = null;
    /** Serializes the read-modify-write cycles, so two likes cannot lose one another. */
    this.queue = Promise.resolve();
  }

  /**
   * Logs with the manager prefix.
   *
   * @param {...unknown} args - Values forwarded to `console.info`.
   * @returns {void}
   */
  log(...args) {
    console.info('[FriendshipManager]', ...args);
  }

  /**
   * Reads the friendship thresholds, once per page.
   *
   * @returns {Promise<Array<{rarity: string, target: number}>>} The tiers, ascending.
   */
  async getTiers() {
    if (!this.tiersPromise) this.tiersPromise = this.loadTiers();
    return this.tiersPromise;
  }

  /**
   * Reads the `bestfriend` tiers of the global trophy file.
   *
   * A file that cannot be read, or an entry with no usable tier, falls back to the shipped values:
   * a broken configuration must never hide the friendship levels.
   *
   * @returns {Promise<Array<{rarity: string, target: number}>>} The thresholds, ascending.
   */
  async loadTiers() {
    try {
      const { globalConfigPath } = await configLoader.getTrophySettings();
      const response = await fetch(globalConfigPath, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Unable to fetch "${globalConfigPath}" (HTTP ${response.status}).`);
      }
      const config = await response.json();
      const entry = Object.entries(config ?? {}).find(
        ([key]) => String(key).trim().toLowerCase() === 'bestfriend'
      )?.[1];
      const tiers = FriendshipManager.readTiers(entry);
      if (tiers.length > 0) return tiers;
    } catch (error) {
      console.warn(
        '[FriendshipManager] The friendship tiers could not be read, shipped values are used.',
        error
      );
    }
    return DEFAULT_FRIENDSHIP_TIERS.map((tier) => ({ ...tier }));
  }

  /**
   * Reads one `{ rarity: threshold }` tier table.
   *
   * @param {unknown} entry - `bestfriend` entry of `settings/global_trophy.json`.
   * @returns {Array<{rarity: string, target: number}>} The usable tiers, ascending.
   */
  static readTiers(entry) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    return Object.entries(entry)
      .filter(([key]) => !key.startsWith('_'))
      .map(([rarity, value]) => ({
        rarity: String(rarity).trim().toLowerCase(),
        target: Math.trunc(Number(value) || 0),
      }))
      .filter((tier) => TIER_RARITIES.includes(tier.rarity) && tier.target > 0)
      .sort((left, right) => left.target - right.target);
  }

  /**
   * Reads the stored friendship state.
   *
   * The state is never cached: a save import replaces the whole database behind the manager, and a
   * read of a few hundred bytes is cheaper than showing XP that no longer exists.
   *
   * @returns {Promise<{xp: Record<string, number>, trades: Record<string, number>,
   *   tradeIds: string[], seenLikes: string[]}>} The state.
   */
  async readState() {
    try {
      return normalizeState(await storageRepository.getUserState(USER_STATE_KEYS.FRIENDSHIP));
    } catch (error) {
      console.warn('[FriendshipManager] The friendship XP could not be read.', error);
      return emptyState();
    }
  }

  /**
   * Lists the XP of every known player.
   *
   * @returns {Promise<Record<string, number>>} UUID -> XP.
   */
  async getXpMap() {
    // A credit may still be running (a trade completed a moment ago): reading before it commits
    // would paint the old XP, then the write would land behind the screen.
    await this.queue;
    return { ...(await this.readState()).xp };
  }

  /**
   * Reads the thresholds and the XP in one call, the shape the views need to paint stars.
   *
   * @returns {Promise<{tiers: Array<{rarity: string, target: number}>, xp: Record<string, number>}>}
   *   The thresholds and the XP per UUID.
   */
  async getOverview() {
    await this.queue;
    const [tiers, state] = await Promise.all([this.getTiers(), this.readState()]);
    return { tiers, xp: { ...state.xp } };
  }

  /**
   * Computes the star level of one XP amount.
   *
   * @param {unknown} xp - Friendship XP.
   * @param {Array<{rarity: string, target: number}>} [tiers] - Thresholds to use.
   * @returns {{xp: number, stars: number, total: number, percent: number, currentTarget: number,
   *   nextTarget: number|null, maxed: boolean}} The progress toward the next star.
   */
  describeXp(xp, tiers) {
    const list = Array.isArray(tiers) && tiers.length > 0 ? tiers : DEFAULT_FRIENDSHIP_TIERS;
    const value = Math.max(0, Math.trunc(Number(xp) || 0));
    let stars = 0;
    while (stars < list.length && value >= list[stars].target) stars += 1;
    const currentTarget = stars === 0 ? 0 : list[stars - 1].target;
    const nextTarget = stars < list.length ? list[stars].target : null;
    const percent =
      nextTarget === null
        ? 100
        : Math.max(
            0,
            Math.min(100, Math.floor(((value - currentTarget) / (nextTarget - currentTarget)) * 100))
          );
    return { xp: value, stars, total: list.length, percent, currentTarget, nextTarget, maxed: nextTarget === null };
  }

  /**
   * Reads the star level of one player.
   *
   * @param {unknown} uuid - Player UUID.
   * @returns {Promise<{xp: number, stars: number, total: number, percent: number,
   *   currentTarget: number, nextTarget: number|null, maxed: boolean}>} The progress.
   */
  async getProgress(uuid) {
    const id = typeof uuid === 'string' ? uuid.trim() : '';
    await this.queue;
    const [tiers, state] = await Promise.all([this.getTiers(), this.readState()]);
    return this.describeXp(id === '' ? 0 : state.xp[id] ?? 0, tiers);
  }

  /**
   * Reads the number of stars of one player, the value that discounts their trades.
   *
   * @param {unknown} uuid - Player UUID.
   * @returns {Promise<number>} The reached stars.
   */
  async getStars(uuid) {
    return (await this.getProgress(uuid)).stars;
  }

  /**
   * Writes a new state and mirrors the best XP into the account statistics.
   *
   * @param {{xp: Record<string, number>, trades: Record<string, number>, seenLikes: string[]}} next
   *   - State to store.
   * @returns {Promise<void>} Resolves once the transaction committed.
   */
  async persist(next) {
    const best = Math.max(0, ...Object.values(next.xp));
    try {
      await storageRepository.transaction(STORES.USER_STATE, 'readwrite', async (context) => {
        await context.put(STORES.USER_STATE, next, USER_STATE_KEYS.FRIENDSHIP);
        const stored = await context.get(STORES.USER_STATE, USER_STATE_KEYS.STATS);
        const stats =
          stored && typeof stored === 'object' && !Array.isArray(stored) ? { ...stored } : {};
        const known =
          Number.isInteger(stats.bestfriend) && stats.bestfriend >= 0 ? stats.bestfriend : 0;
        if (best <= known) return;
        await context.put(
          STORES.USER_STATE,
          { ...stats, bestfriend: best },
          USER_STATE_KEYS.STATS
        );
      });
    } catch (error) {
      console.warn('[FriendshipManager] The friendship XP could not be saved.', error);
    }
  }

  /**
   * Runs one read-modify-write cycle, serialized with the other cycles.
   *
   * @param {(state: {xp: Record<string, number>, trades: Record<string, number>,
   *   tradeIds: string[], seenLikes: string[]}) => boolean} mutator - Applies the change in place,
   *   returns true when something changed.
   * @returns {Promise<object>} The state after the cycle.
   */
  async mutate(mutator) {
    const run = this.queue.then(async () => {
      const current = await this.readState();
      const next = {
        xp: { ...current.xp },
        trades: { ...current.trades },
        tradeIds: [...current.tradeIds],
        seenLikes: [...current.seenLikes],
      };
      if (!mutator(next)) return current;
      await this.persist(next);
      await this.evaluateTrophies(current.xp, next.xp);
      return next;
    });
    this.queue = run.catch(() => {});
    return run;
  }

  /**
   * Re-evaluates the trophies when the best friendship XP crosses a star threshold.
   *
   * The `bestfriend` trophy reads `stats.bestfriend`, which `persist()` has just mirrored, but
   * nothing evaluated the catalogue after a gain: a like or a trade that reached a tier stayed
   * invisible until the profile or the trophy screen was opened. The evaluation is skipped when no
   * star was gained, so a like that only moves the percentage costs no catalogue read.
   *
   * @param {Record<string, number>} previous - XP per UUID before the change.
   * @param {Record<string, number>} next - XP per UUID after the change.
   * @returns {Promise<void>} Resolves once the trophies were evaluated (failures are logged).
   */
  async evaluateTrophies(previous, next) {
    const before = highestXp(previous);
    const after = highestXp(next);
    if (after <= before) return;

    try {
      const tiers = await this.getTiers();
      if (this.describeXp(after, tiers).stars <= this.describeXp(before, tiers).stars) return;
      await trophyManager.evaluate({ notify: true });
      this.log(`Friendship tier crossed (${before} → ${after} XP): the trophies were re-evaluated.`);
    } catch (error) {
      console.warn('[FriendshipManager] The trophies could not be re-evaluated.', error);
    }
  }

  /**
   * Reads the UUID of the other player of one trade row.
   *
   * @param {object} trade - Trade returned by the worker.
   * @returns {string} The partner UUID, or an empty string when the side is unknown.
   */
  static partnerOf(trade) {
    const side =
      trade?.my_role === 'initiator'
        ? trade.responder
        : trade?.my_role === 'responder'
          ? trade.initiator
          : null;
    return typeof side?.uuid === 'string' ? side.uuid.trim() : '';
  }

  /**
   * Credits completed trades.
   *
   * A tracked trade pays `10 x rarity`; a row without a usable rarity pays the flat fallback. The
   * per-partner trade counter grows by one and the trade id is remembered, which is what tells
   * `syncTradeHistory()` that the exchange was already converted.
   *
   * @param {Array<{uuid: string, rarity: number, tradeId?: string}>} awards - Completed trades to
   *   credit.
   * @returns {Promise<void>} Resolves once the XP is stored.
   */
  async recordTrades(awards) {
    const list = (Array.isArray(awards) ? awards : []).filter(
      (award) => award && typeof award.uuid === 'string' && award.uuid !== ''
    );
    if (list.length === 0) return;
    await this.mutate((state) => {
      const known = new Set(state.tradeIds);
      let changed = false;
      list.forEach(({ uuid, rarity, tradeId }) => {
        const id = typeof tradeId === 'string' ? tradeId.trim() : '';
        if (id !== '' && known.has(id)) return;
        const value = Math.trunc(Number(rarity) || 0);
        const gain =
          Number.isInteger(value) && value > 0
            ? FRIENDSHIP_XP_PER_RARITY * value
            : FRIENDSHIP_TRADE_XP;
        state.xp[uuid] = (state.xp[uuid] ?? 0) + Math.max(1, gain);
        state.trades[uuid] = (state.trades[uuid] ?? 0) + 1;
        if (id !== '') {
          known.add(id);
          state.tradeIds.push(id);
        }
        changed = true;
      });
      state.tradeIds = trimTradeIds(state.tradeIds);
      return changed;
    });
  }

  /**
   * Seeds the trades that were completed before this feature existed.
   *
   * The worker history names the rarity of a past exchange, so a row it still returns pays
   * `10 x rarity` and its id is remembered, which makes the seed idempotent across refreshes. What
   * the history no longer holds is only known as a count per partner: those leftovers pay the flat
   * `FRIENDSHIP_TRADE_XP` once, and the per-partner counter keeps the already converted trades out
   * of both passes.
   *
   * @param {Record<string, number>} counts - `trades.stats.byPartner`.
   * @param {object[]} [history] - Trades returned by the worker, most recent first.
   * @returns {Promise<void>} Resolves once the XP is stored.
   */
  async syncTradeHistory(counts, history = []) {
    const totals = counts && typeof counts === 'object' ? counts : {};
    // Only a finished exchange pays: the history lists declined and cancelled ones too.
    const rows = (Array.isArray(history) ? history : []).filter(
      (row) => row && row.status === 'completed' && typeof row.id === 'string' && row.id !== ''
    );
    if (rows.length === 0 && Object.keys(totals).length === 0) return;
    await this.mutate((state) => {
      const known = new Set(state.tradeIds);
      let changed = false;
      const totalOf = (uuid) => Math.max(0, Math.trunc(Number(totals[uuid]) || 0));
      const creditedOf = (uuid) => Math.max(0, Math.trunc(Number(state.trades[uuid]) || 0));
      rows.forEach((row) => {
        const uuid = FriendshipManager.partnerOf(row);
        const rarity = Math.trunc(Number(row.rarity) || 0);
        const id = row.id.trim();
        if (uuid === '' || rarity < 1 || known.has(id)) return;
        // A partner whose local counter already covers the exchange was paid at the flat rate:
        // converting the row now would pay the same trade twice.
        if (Object.hasOwn(totals, uuid) && creditedOf(uuid) >= totalOf(uuid)) return;
        known.add(id);
        state.tradeIds.push(id);
        state.trades[uuid] = creditedOf(uuid) + 1;
        state.xp[uuid] = (state.xp[uuid] ?? 0) + FRIENDSHIP_XP_PER_RARITY * rarity;
        changed = true;
      });
      Object.entries(totals).forEach(([uuid, raw]) => {
        const total = Math.max(0, Math.trunc(Number(raw) || 0));
        if (uuid === '' || total <= 0) return;
        const owed = total - (state.trades[uuid] ?? 0);
        if (owed <= 0) return;
        state.xp[uuid] = (state.xp[uuid] ?? 0) + owed * FRIENDSHIP_TRADE_XP;
        state.trades[uuid] = total;
        changed = true;
      });
      state.tradeIds = trimTradeIds(state.tradeIds);
      return changed;
    });
  }

  /**
   * Credits likes, one XP per like and per direction.
   *
   * The key `direction:uuid|day` makes the backfill of the history idempotent: a like already
   * credited when it was sent is not paid a second time when the same history is read again.
   *
   * @param {Array<string|{uuid?: string, day?: string, likedAt?: string}>} entries - Players, or
   *   history rows.
   * @param {'sent'|'received'} direction - Side of the like.
   * @returns {Promise<void>} Resolves once the XP is stored.
   */
  async recordLikes(entries, direction) {
    const prefix = direction === 'received' ? 'recv' : 'sent';
    const events = (Array.isArray(entries) ? entries : [])
      .map((entry) => {
        const uuid =
          typeof entry === 'string' ? entry.trim() : String(entry?.uuid ?? '').trim();
        const day =
          typeof entry === 'string'
            ? ''
            : String(entry?.day ?? '').trim() ||
              String(entry?.likedAt ?? '').trim().slice(0, 10);
        return { uuid, key: likeKey(prefix, uuid, day) };
      })
      .filter((event) => event.key !== '');
    if (events.length === 0) return;
    await this.mutate((state) => {
      const seen = new Set(state.seenLikes);
      let changed = false;
      events.forEach(({ uuid, key }) => {
        if (seen.has(key)) return;
        seen.add(key);
        state.seenLikes.push(key);
        state.xp[uuid] = (state.xp[uuid] ?? 0) + FRIENDSHIP_LIKE_XP;
        changed = true;
      });
      if (!changed) return false;
      if (state.seenLikes.length > SEEN_LIKES_LIMIT) {
        state.seenLikes = state.seenLikes.slice(-SEEN_LIKES_LIMIT);
      }
      return true;
    });
  }

  /**
   * Forgets the thresholds, so the next level re-reads `settings/global_trophy.json`.
   *
   * @returns {void}
   */
  reset() {
    this.tiersPromise = null;
  }
}

/** Shared instance used by the trade, like and social surfaces. */
export const friendshipManager = new FriendshipManager();

export default friendshipManager;

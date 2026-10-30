/**
 * DailyRewardManager - The rewards of the daily connection.
 *
 * Reference: `settings/daily_connect_rewards.json` (the chapters and their days),
 * `js/UI/components/DailyRewardPopup.js` (the screen) and `.docs/projet/05-daily-rewards.md`.
 *
 * WHAT IT IS
 * A chapter is a list of rewards, one per day, that a player collects by showing up. The chapter
 * carries an availability window: outside of it, nothing is claimable. Inside it, a player claims at
 * most ONE reward per UTC day, and every claim advances the run by one day - the run is the
 * `progress` of the state, never a calendar index. Missing a day therefore costs the reward of that
 * day and nothing else: coming back the day after claims the NEXT reward of the list, whether two
 * days or two weeks went by.
 *
 * WHAT IT IS NOT
 * It is not a giveaway of a free booster per day: the quota of `DateSyncManager` stays the only
 * source of daily boosters, and a chapter only adds what its JSON declares.
 *
 * STATE (`user_state["dailyRewards"]`)
 *   `{ chapterId, progress, lastClaimDay, claimedUniques, seenDay }`
 *   - `chapterId`    : the chapter the run belongs to. A different chapter resets the run, which is
 *                      what "when a new series starts, we go back to zero" means;
 *   - `progress`     : how many rewards of that chapter were claimed (0 = none, 1 = day one done);
 *   - `lastClaimDay` : the UTC day of the last claim, the whole anti-double-claim rule;
 *   - `claimedUniques`: the `UniqueID`s already handed out, one reward per account and per id;
 *   - `seenDay`      : the last day the popup was shown, so the automatic opening happens once a day.
 *
 * DATES
 * The window is written either `DD-MM-YYYY` (the shape of the shipped file) or `YYYY-MM-DD`; both
 * are normalized to the `YYYY-MM-DD` form `DateSyncManager` produces, and both ends are INCLUSIVE.
 * A day is read from the trusted clock only: without it, nothing is claimable and the popup says so,
 * because a player who can move the system clock must not be able to claim twice.
 */

import { storageRepository, STORES } from '../models/StorageRepository.js';
import { USER_STATE_KEYS } from './AccountManager.js';
import eventBus, { EVENTS } from '../utils/EventBus.js';
import dateSyncManager from './DateSyncManager.js';
import boosterManager from './BoosterManager.js';
import promoManager from './PromoManager.js';
import miningManager, { RESOURCE_TEXTURE_DIRECTORY, SPARKS_TEXTURE } from './MiningManager.js';
import sparksManager from './SparksManager.js';

/** Path of the chapter file, relative to the application root. */
export const DAILY_REWARDS_PATH = 'settings/daily_connect_rewards.json';

/**
 * Texture of a booster reward: the pack drawn in the colours of the game, since the set is only
 * chosen at claim time.
 *
 * The same file on every theme on purpose: it is not a single-ink glyph like the icon of a counter,
 * it is a picture with its own palette, so `ThemeIcons` has no twin to swap it for and it stays
 * readable on both the dark and the light boards.
 */
export const BOOSTER_REWARD_TEXTURE = 'assets/img/booster.png';

/**
 * Texture of a `Card` reward whose card cannot be read from the catalogue.
 *
 * The shared back of every card, which is already part of the shell (`sw.js`): a day that gives a
 * card must show a card even when its `Index` points at nothing, instead of an empty tile the player
 * reads as "no reward". The claim stays blocked (`unavailable`), so this is a missing picture, never
 * a missing rule.
 */
export const CARD_REWARD_FALLBACK_TEXTURE = 'assets/img/card_back.png';

/** Kinds a day of a chapter can grant. */
export const DAILY_REWARD_KINDS = Object.freeze({
  SPARKS: 'sparks',
  RESOURCE: 'resource',
  BOOSTER: 'booster',
  CARD: 'card',
});

/**
 * Auras a tile of the popup can wear.
 *
 * `gold` marks what the game considers a rare material (a booster, the Void Dust), `pink` the two
 * top rewards (Ultima and a card). They are decorative only: the reward itself never depends on it.
 */
export const DAILY_REWARD_AURAS = Object.freeze({ GOLD: 'gold', PINK: 'pink' });

/** Stable error codes, so the popup never parses a message. */
export const DAILY_REWARD_ERRORS = Object.freeze({
  NO_CHAPTER: 'NO_CHAPTER',
  NO_REWARD: 'NO_REWARD',
  ALREADY_CLAIMED: 'ALREADY_CLAIMED',
  NOT_TRUSTED: 'NOT_TRUSTED',
  SET_REQUIRED: 'SET_REQUIRED',
  NO_SET: 'NO_SET',
  CONTENT_NOT_RELEASED: 'CONTENT_NOT_RELEASED',
});

/**
 * Resource slugs that wear the pink aura of the top rewards.
 *
 * Listed by slug rather than by raw type so the comparison is the one the save stores
 * (`resourceSlug("Void Dust") === "void_dust"`).
 */
const PINK_RESOURCES = new Set(['ultima']);

/** Resource slugs that wear the gold aura. */
const GOLD_RESOURCES = new Set(['void_dust']);

/** Raised by a refused claim, with a stable `code`. */
export class DailyRewardError extends Error {
  /**
   * @param {string} code - One of `DAILY_REWARD_ERRORS`.
   * @param {string} message - Technical message (the popup shows a translated one).
   * @param {object} [details] - Extra data the caller may use (`choices` for `SET_REQUIRED`).
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DailyRewardError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Reads a date of the chapter file as a `YYYY-MM-DD` day.
 *
 * Both orders are accepted because the file was authored by hand: `30-10-2026` is the shipped
 * shape, `2026-10-30` the one every other setting uses. An impossible day (2026-02-31) is refused
 * rather than silently shifted, exactly like `ConfigLoader.normalizeReleaseDate`.
 *
 * @param {unknown} value - Raw value of the file.
 * @returns {string|null} The normalized day, or null when unreadable.
 */
export function parseChapterDay(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const french = /^(\d{2})-(\d{2})-(\d{4})$/.exec(trimmed);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  const day = french
    ? `${french[3]}-${french[2]}-${french[1]}`
    : iso
      ? `${iso[1]}-${iso[2]}-${iso[3]}`
      : null;
  if (!day) return null;
  const time = Date.parse(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString().slice(0, 10) === day ? day : null;
}

/**
 * Number of whole days between two `YYYY-MM-DD` days (`to - from`).
 *
 * @param {string} from - Earlier day.
 * @param {string} to - Later day.
 * @returns {number} The difference in days (negative when `to` is earlier).
 */
function daysBetween(from, to) {
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);
  return Math.round((end - start) / 86400000);
}

/** True for an object literal. */
const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export class DailyRewardManager {
  constructor() {
    /** @type {Promise<Array<object>>|null} In-flight load of the chapter file. */
    this.loadPromise = null;
    /** @type {Array<object>} Normalized chapters, in the order of the file. */
    this.chapters = [];
    /** @type {Promise<Map<string, object>>|null} In-flight build of the card index. */
    this.cardIndexPromise = null;
    /** @type {Promise<Array<{setId: string, name: string}>>|null} Released sets, for a booster. */
    this.boosterChoicePromise = null;
  }

  /**
   * Logs with the manager prefix.
   *
   * @param {...unknown} args - Values forwarded to `console.info`.
   * @returns {void}
   */
  log(...args) {
    console.info('[DailyRewardManager]', ...args);
  }

  /**
   * Current trusted UTC day, or null when the clock was never anchored.
   *
   * @returns {string|null} `YYYY-MM-DD`.
   */
  getToday() {
    try {
      return dateSyncManager.isTimeTrusted() ? dateSyncManager.getCurrentUtcDay() : null;
    } catch (error) {
      console.warn('[DailyRewardManager] The trusted clock is unavailable.', error);
      return null;
    }
  }

  /**
   * Loads and normalizes the chapters (cached: the file ships with the game).
   *
   * @param {object} [options] - Load options.
   * @param {boolean} [options.force=false] - Re-read the file even when it is cached.
   * @returns {Promise<Array<object>>} The usable chapters.
   * @throws {Error} When the file cannot be fetched or is not valid JSON.
   */
  async load({ force = false } = {}) {
    if (this.chapters.length > 0 && !force) return this.chapters;
    if (this.loadPromise && !force) return this.loadPromise;

    this.loadPromise = this.fetchChapters().catch((error) => {
      this.loadPromise = null;
      throw error;
    });
    const chapters = await this.loadPromise;
    this.loadPromise = null;
    this.chapters = chapters;
    return chapters;
  }

  /**
   * Fetches, parses and normalizes `settings/daily_connect_rewards.json`.
   *
   * An entry the game cannot use is dropped with a warning instead of failing the whole file: a
   * half-edited chapter must hide a reward, never break the game. `tools/lint.mjs` is what refuses
   * those entries before they are shipped.
   *
   * @returns {Promise<Array<object>>} The usable chapters, in the order of the file.
   * @throws {Error} When the request fails, the status is not 2xx or the payload is not valid JSON.
   */
  async fetchChapters() {
    let response;
    try {
      response = await fetch(DAILY_REWARDS_PATH);
    } catch (error) {
      throw new Error(`Unable to fetch "${DAILY_REWARDS_PATH}".`, { cause: error });
    }
    if (!response.ok) {
      throw new Error(`Unable to fetch "${DAILY_REWARDS_PATH}" (HTTP ${response.status}).`);
    }

    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      throw new Error(`"${DAILY_REWARDS_PATH}" is not valid JSON.`, { cause: error });
    }

    const declared = Array.isArray(payload) ? payload : [];
    const seen = new Set();
    const chapters = [];

    declared.forEach((entry) => {
      const chapter = DailyRewardManager.parseChapter(entry);
      if (!chapter) return;
      if (seen.has(chapter.id)) {
        console.warn(`[DailyRewardManager] Chapter "${chapter.id}" is declared twice: the second one is ignored.`);
        return;
      }
      seen.add(chapter.id);
      chapters.push(chapter);
    });

    return chapters;
  }

  /**
   * Normalizes one chapter of the file.
   *
   * @param {unknown} entry - Raw chapter.
   * @returns {object|null} The chapter, or null when it cannot be used (no id, no window, no day).
   */
  static parseChapter(entry) {
    if (!isRecord(entry)) return null;
    const id = typeof entry.ID === 'string' ? entry.ID.trim() : '';
    if (id === '') return null;

    const start = parseChapterDay(entry.Dates?.Start);
    const end = parseChapterDay(entry.Dates?.End);
    if (!start || !end || start > end) {
      console.warn(`[DailyRewardManager] Chapter "${id}": the availability window is missing or empty, it is ignored.`);
      return null;
    }

    const days = new Map();
    let fallback = null;
    let maxDay = 0;
    const declaredDays = Array.isArray(entry.Days) ? entry.Days : [];

    declaredDays.forEach((raw) => {
      if (!isRecord(raw)) return;
      const reward = DailyRewardManager.parseReward(raw.Reward);
      // A day whose reward cannot be read keeps its place: the fallback entry covers it, which is
      // exactly what `Day: null` is for, instead of shifting every following reward by one.
      const day = Number.isInteger(raw.Day) && raw.Day > 0 ? raw.Day : null;
      if (!reward) return;

      const replacement = DailyRewardManager.parseReward(raw.ReplacementRewardIfClaimed);
      const unique = raw.Unique === true;
      const uniqueId = unique
        ? typeof raw.UniqueID === 'string' && raw.UniqueID.trim() !== ''
          ? raw.UniqueID.trim()
          : `${id}:${day ?? 'fallback'}`
        : null;

      const parsed = { day, reward, unique, uniqueId, replacement };
      if (day === null) {
        // The first `Day: null` wins: a second one is a duplicate of the same fallback.
        if (!fallback) fallback = parsed;
        return;
      }
      if (days.has(day)) {
        console.warn(`[DailyRewardManager] Chapter "${id}": day ${day} is declared twice, the first one is kept.`);
        return;
      }
      days.set(day, parsed);
      maxDay = Math.max(maxDay, day);
    });

    if (days.size === 0 && !fallback) return null;

    return {
      id,
      name: typeof entry.RewardListName === 'string' && entry.RewardListName.trim() !== ''
        ? entry.RewardListName.trim()
        : id,
      start,
      end,
      days,
      fallback,
      maxDay,
      totalDays: days.size,
    };
  }

  /**
   * Normalizes one reward of the file.
   *
   * @param {unknown} raw - Raw reward (`{ Type, Qte, CardID? }`).
   * @returns {{kind: string, type: string, quantity: number, slug: string|null, cardId: string|null}|null}
   *   The reward, or null when its type is unknown or its quantity is not a positive integer.
   */
  static parseReward(raw) {
    if (!isRecord(raw)) return null;
    const type = typeof raw.Type === 'string' ? raw.Type.trim() : '';
    if (type === '') return null;
    const quantity = Number.isInteger(raw.Qte) && raw.Qte > 0 ? raw.Qte : 0;
    if (quantity === 0) return null;

    if (type.toLowerCase() === 'sparks') {
      return { kind: DAILY_REWARD_KINDS.SPARKS, type, quantity, slug: null, cardId: null };
    }
    if (type.toLowerCase() === 'booster') {
      return { kind: DAILY_REWARD_KINDS.BOOSTER, type, quantity, slug: null, cardId: null };
    }
    if (type.toLowerCase() === 'card') {
      const cardId = typeof raw.CardID === 'string' ? raw.CardID.trim() : '';
      if (cardId === '') return null;
      return { kind: DAILY_REWARD_KINDS.CARD, type, quantity, slug: null, cardId };
    }
    // Anything else must be a resource of the mine ("Stone Dust", "Void Dust", "Ultima"…): the slug
    // is the one the save stores and the one the texture is named after.
    const slug = String(type)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (slug === '') return null;
    return { kind: DAILY_REWARD_KINDS.RESOURCE, type, quantity, slug, cardId: null };
  }

  /**
   * Reads and normalizes `user_state["dailyRewards"]`.
   *
   * @returns {Promise<{chapterId: string|null, progress: number, lastClaimDay: string|null,
   *   claimedUniques: string[], seenDay: string|null}>} A state safe to use.
   */
  async readState() {
    return DailyRewardManager.normalizeState(
      await storageRepository.getUserState(USER_STATE_KEYS.DAILY_REWARDS)
    );
  }

  /**
   * Normalizes a stored state.
   *
   * @param {unknown} raw - Value read from the store.
   * @returns {{chapterId: string|null, progress: number, lastClaimDay: string|null,
   *   claimedUniques: string[], seenDay: string|null}} A state safe to use.
   */
  static normalizeState(raw) {
    const source = isRecord(raw) ? raw : {};
    return {
      chapterId: typeof source.chapterId === 'string' && source.chapterId.trim() !== ''
        ? source.chapterId.trim()
        : null,
      progress: Number.isInteger(source.progress) && source.progress >= 0 ? source.progress : 0,
      lastClaimDay: typeof source.lastClaimDay === 'string' ? source.lastClaimDay : null,
      claimedUniques: Array.isArray(source.claimedUniques)
        ? source.claimedUniques.filter((value) => typeof value === 'string' && value !== '')
        : [],
      seenDay: typeof source.seenDay === 'string' ? source.seenDay : null,
    };
  }

  /**
   * Applies the reset a new chapter asks for, without writing anything.
   *
   * @param {object} state - Stored state.
   * @param {object} chapter - Active chapter.
   * @returns {object} The state the chapter starts from (`seenDay` is kept: it is not a reward).
   */
  static alignToChapter(state, chapter) {
    if (state.chapterId === chapter.id) return state;
    return {
      chapterId: chapter.id,
      progress: 0,
      lastClaimDay: null,
      claimedUniques: state.claimedUniques,
      seenDay: state.seenDay,
    };
  }

  /**
   * Chapter covering a day, or the nearest one when none does.
   *
   * @param {Array<object>} chapters - Normalized chapters.
   * @param {string} today - The trusted day.
   * @returns {{chapter: object|null, status: 'active'|'upcoming'|'ended'|'empty'}} The chapter and
   *   what to say about it: `upcoming` when the first window opens later, `ended` when every window
   *   is in the past.
   */
  static pickChapter(chapters, today) {
    if (chapters.length === 0) return { chapter: null, status: 'empty' };

    const active = chapters
      .filter((chapter) => chapter.start <= today && today <= chapter.end)
      // The last window to open wins, so fixing a typo by shipping a corrected chapter is enough.
      .sort((left, right) => left.start.localeCompare(right.start))
      .pop();
    if (active) return { chapter: active, status: 'active' };

    const upcoming = chapters
      .filter((chapter) => chapter.start > today)
      .sort((left, right) => left.start.localeCompare(right.start))[0];
    if (upcoming) return { chapter: upcoming, status: 'upcoming' };

    return { chapter: null, status: 'ended' };
  }

  /**
   * Reward a run position grants.
   *
   * `progress` counts the rewards already claimed, so position `progress` (0-based) is the reward of
   * today. A position past the highest declared day falls back to the `Day: null` entry, which is
   * what lets a chapter stay honest when it outlives its own list.
   *
   * @param {object} chapter - Chapter.
   * @param {number} position - 0-based position in the run.
   * @returns {object|null} The declared entry, or the fallback one.
   */
  static entryAt(chapter, position) {
    return chapter.days.get(position + 1) ?? chapter.fallback;
  }

  /**
   * Released extensions a booster reward may be spent on, for the picker.
   *
   * @param {object} [options] - Options.
   * @param {boolean} [options.force=false] - Re-read the catalogue.
   * @returns {Promise<Array<{setId: string, name: string}>>} The released sets, in declaration order.
   */
  async getBoosterChoices({ force = false } = {}) {
    if (this.boosterChoicePromise && !force) return this.boosterChoicePromise;
    this.boosterChoicePromise = boosterManager
      .listBoosterSets()
      .then((sets) => sets.map((set) => ({ setId: set.setId, name: set.name })))
      .catch((error) => {
        this.boosterChoicePromise = null;
        throw error;
      });
    return this.boosterChoicePromise;
  }

  /**
   * Builds the index of the printings of every obtainable card, keyed by `Index`.
   *
   * Only the released sets are read (`listBoosterSets()` and `listPromoSets()` both exclude an
   * extension that is not out yet), so a reward naming a card of a future set is simply unresolved:
   * that is the gate that keeps the popup from handing out content before its release.
   *
   * @returns {Promise<Map<string, Array<object>>>} `Index` to the cards printed from it.
   */
  async getCardIndex() {
    if (this.cardIndexPromise) return this.cardIndexPromise;

    this.cardIndexPromise = (async () => {
      const index = new Map();
      const add = (card) => {
        const key = typeof card?.index === 'string' ? card.index.trim() : '';
        if (key === '') return;
        if (!index.has(key)) index.set(key, []);
        index.get(key).push(card);
      };

      for (const summary of await boosterManager.listBoosterSets()) {
        const set = await boosterManager.getBoosterSet(summary.setId);
        set.cards.forEach(add);
      }
      try {
        for (const row of await promoManager.getAllCards()) {
          add(row.card);
        }
      } catch (error) {
        // A broken promo file degrades to "no promo is claimable", never to a popup that cannot
        // open: the drawn cards above are already indexed.
        console.warn('[DailyRewardManager] The promo cards could not be read.', error);
      }
      return index;
    })().catch((error) => {
      this.cardIndexPromise = null;
      throw error;
    });

    return this.cardIndexPromise;
  }

  /**
   * Resolves the card of a `Card` reward.
   *
   * The file names an `Index`, which may be printed twice: the full art printing is preferred, as
   * the reward is meant to be the best one the game can give.
   *
   * @param {string} cardId - `Index` read from the file.
   * @returns {Promise<object|null>} The card, or null when it is unknown or not released yet.
   */
  async resolveCard(cardId) {
    const index = await this.getCardIndex();
    const printings = index.get(String(cardId).trim()) ?? [];
    return printings.find((card) => card.isFullArt) ?? printings[0] ?? null;
  }

  /**
   * Describes a reward for the popup: what to show, and what is missing.
   *
   * Never throws: an unresolvable card is reported as `unavailable`, so the tile is still drawn and
   * the player reads why the day cannot be claimed instead of facing an empty box.
   *
   * @param {object|null} entry - Declared entry of the day.
   * @param {object|null} state - Stored state (the claimed `UniqueID`s are used for the replacement).
   * @returns {Promise<object|null>} `{ entry, reward, card, icon, aura, quantity, unavailable }`.
   */
  async describeEntry(entry, state = null) {
    if (!entry) return null;
    const claimed = state?.claimedUniques ?? [];
    const reward =
      entry.unique && entry.uniqueId && claimed.includes(entry.uniqueId)
        ? entry.replacement
        : entry.reward;

    if (!reward) {
      return {
        entry,
        reward: null,
        card: null,
        icon: '',
        aura: null,
        quantity: 0,
        unavailable: true,
      };
    }

    const card = reward.kind === DAILY_REWARD_KINDS.CARD ? await this.resolveCard(reward.cardId) : null;
    return {
      entry,
      reward,
      card,
      icon: DailyRewardManager.iconOf(reward, card),
      aura: DailyRewardManager.auraOf(reward),
      quantity: reward.quantity,
      unavailable: reward.kind === DAILY_REWARD_KINDS.CARD && !card,
    };
  }

  /**
   * Texture of a reward.
   *
   * @param {object} reward - Normalized reward.
   * @param {object|null} [card=null] - Resolved card, for a `Card` reward.
   * @returns {string} A path relative to the application root (empty when there is nothing to show).
   */
  static iconOf(reward, card = null) {
    if (!reward) return '';
    switch (reward.kind) {
      case DAILY_REWARD_KINDS.SPARKS:
        return SPARKS_TEXTURE;
      case DAILY_REWARD_KINDS.RESOURCE:
        return `${RESOURCE_TEXTURE_DIRECTORY}/${reward.slug}.png`;
      case DAILY_REWARD_KINDS.BOOSTER:
        return BOOSTER_REWARD_TEXTURE;
      case DAILY_REWARD_KINDS.CARD:
        // A card the catalogue cannot resolve still reads as a card: the back is honest about it
        // (the tile and the preview both say the day is unavailable), where an empty box said nothing.
        return card?.illustration || CARD_REWARD_FALLBACK_TEXTURE;
      default:
        return '';
    }
  }

  /**
   * Aura of a reward: gold for a booster and the Void Dust, pink for the Ultima and a card.
   *
   * @param {object} reward - Normalized reward.
   * @returns {'gold'|'pink'|null} The aura, or null for an ordinary reward.
   */
  static auraOf(reward) {
    if (!reward) return null;
    if (reward.kind === DAILY_REWARD_KINDS.BOOSTER) return DAILY_REWARD_AURAS.GOLD;
    if (reward.kind === DAILY_REWARD_KINDS.CARD) return DAILY_REWARD_AURAS.PINK;
    if (reward.kind === DAILY_REWARD_KINDS.RESOURCE) {
      if (GOLD_RESOURCES.has(reward.slug)) return DAILY_REWARD_AURAS.GOLD;
      if (PINK_RESOURCES.has(reward.slug)) return DAILY_REWARD_AURAS.PINK;
    }
    return null;
  }

  /**
   * Builds everything the popup and the header badge need.
   *
   * @returns {Promise<object>} The snapshot: status, chapter, today, progress, the days with their
   *   state, the reward of today, and the counters of the header.
   */
  async getSnapshot() {
    const chapters = await this.load();
    const state = await this.readState();
    const today = this.getToday();

    // Without the trusted clock there is no day, therefore no reward: the popup says so instead of
    // guessing from the device clock (which a player can move).
    if (!today) {
      return {
        trusted: false,
        today: null,
        status: 'unknown',
        chapter: null,
        progress: 0,
        claimedToday: false,
        claimable: false,
        dayNumber: 0,
        totalDays: 0,
        claimableDays: 0,
        daysUntilEnd: 0,
        days: [],
        current: null,
        seen: false,
      };
    }

    const { chapter, status } = DailyRewardManager.pickChapter(chapters, today);

    const empty = {
      trusted: true,
      today,
      status,
      chapter,
      progress: 0,
      claimedToday: false,
      claimable: false,
      dayNumber: 0,
      totalDays: chapter?.totalDays ?? 0,
      claimableDays: 0,
      daysUntilEnd: 0,
      days: [],
      current: null,
      seen: false,
    };
    if (!chapter) return empty;

    const aligned = DailyRewardManager.alignToChapter(state, chapter);
    const claimedToday = aligned.lastClaimDay === today;
    const days = [];
    const totalTiles = Math.max(chapter.maxDay, 1);
    for (let day = 1; day <= totalTiles; day += 1) {
      const position = day - 1;
      const entry = DailyRewardManager.entryAt(chapter, position);
      const info = await this.describeEntry(entry, aligned);
      // "current" is the day that can be claimed RIGHT NOW: once today's reward is taken, the next
      // one is simply locked again, so the highlight never points at a button that cannot work.
      const state = position < aligned.progress
        ? 'claimed'
        : position === aligned.progress && !claimedToday
          ? 'current'
          : 'locked';
      days.push({ day, state, ...info });
    }

    const currentEntry = DailyRewardManager.entryAt(chapter, aligned.progress);
    const current = await this.describeEntry(currentEntry, aligned);
    const daysUntilEnd = Math.max(0, daysBetween(today, chapter.end));

    return {
      trusted: true,
      today,
      status,
      chapter,
      progress: aligned.progress,
      claimedToday,
      // A claim needs a trusted day, an active window, a reward not taken today and a reward the
      // game can actually hand out (a card of a set that is not out yet cannot be claimed).
      claimable:
        status === 'active' && !claimedToday && Boolean(current) && current.unavailable !== true,
      dayNumber: aligned.progress + 1,
      totalDays: chapter.totalDays,
      // How many rewards are still claimable if the player comes back every day: one per remaining
      // day of the window, since the fallback entry always has something to give.
      claimableDays: status === 'active' ? daysUntilEnd + 1 : 0,
      daysUntilEnd,
      days,
      current,
      seen: aligned.seenDay === today,
    };
  }

  /**
   * Claims the reward of today.
   *
   * Everything is written in ONE transaction: the reward, the run position, the day of the claim and
   * the `UniqueID`. A failure therefore leaves the save exactly as it was - the player can retry,
   * and a network-free save can never lose a reward to a half-written claim.
   *
   * @param {object} [options] - Claim options.
   * @param {string|null} [options.setId=null] - Extension chosen for a `Booster` reward.
   * @returns {Promise<object>} What was granted (`reward`, `card`, `setId`, `quantity`, `snapshot`).
   * @throws {DailyRewardError} When the claim is refused (see `DAILY_REWARD_ERRORS`).
   * @throws {Error} When the write fails.
   */
  async claim({ setId = null } = {}) {
    const chapters = await this.load();
    const today = this.getToday();
    if (!today) {
      throw new DailyRewardError(
        DAILY_REWARD_ERRORS.NOT_TRUSTED,
        'The trusted UTC day is unavailable: no reward can be claimed.'
      );
    }

    const { chapter, status } = DailyRewardManager.pickChapter(chapters, today);
    if (!chapter || status !== 'active') {
      throw new DailyRewardError(
        DAILY_REWARD_ERRORS.NO_CHAPTER,
        `No chapter is open on ${today} (status: ${status}).`
      );
    }

    const stored = DailyRewardManager.alignToChapter(await this.readState(), chapter);
    if (stored.lastClaimDay === today) {
      throw new DailyRewardError(
        DAILY_REWARD_ERRORS.ALREADY_CLAIMED,
        `The reward of ${today} was already claimed.`
      );
    }

    const entry = DailyRewardManager.entryAt(chapter, stored.progress);
    if (!entry) {
      throw new DailyRewardError(DAILY_REWARD_ERRORS.NO_REWARD, 'The chapter has no reward for that position.');
    }

    const uniqueConsumed = Boolean(entry.unique && entry.uniqueId && stored.claimedUniques.includes(entry.uniqueId));
    const reward = uniqueConsumed ? entry.replacement : entry.reward;
    if (!reward) {
      throw new DailyRewardError(DAILY_REWARD_ERRORS.NO_REWARD, 'The replacement reward of that day is missing.');
    }

    const plan = await this.buildPlan(reward, setId);
    const grantedAt = new Date().toISOString();

    // The quota is written by the transaction below, so the daily reset has to happen first: the
    // shared-context grant does not do it (see `DateSyncManager.addBonusBoosters`).
    if (plan.kind === DAILY_REWARD_KINDS.BOOSTER) {
      await dateSyncManager.ensureDailyReset();
    }

    // Cards are collected here so the announcement can be emitted once the transaction committed.
    const grantedNewKeys = [];

    const committed = await storageRepository.transaction(
      [STORES.USER_STATE, STORES.COLLECTION],
      'readwrite',
      async (context) => {
        // Re-read inside the transaction: two tabs, or a double tap, must not claim twice.
        const current = DailyRewardManager.normalizeState(
          await context.get(STORES.USER_STATE, USER_STATE_KEYS.DAILY_REWARDS)
        );
        if (current.lastClaimDay === today && current.chapterId === chapter.id) {
          throw new DailyRewardError(
            DAILY_REWARD_ERRORS.ALREADY_CLAIMED,
            `The reward of ${today} was already claimed.`
          );
        }

        const base = DailyRewardManager.alignToChapter(current, chapter);
        let balance = null;

        if (plan.kind === DAILY_REWARD_KINDS.SPARKS) {
          balance = await sparksManager.addSparks(plan.quantity, context);
        } else if (plan.kind === DAILY_REWARD_KINDS.RESOURCE) {
          await miningManager.grantResources({ [plan.reward.slug]: plan.quantity }, context);
        } else if (plan.kind === DAILY_REWARD_KINDS.BOOSTER) {
          await dateSyncManager.addBonusBoosters(plan.setId, plan.quantity, context);
        } else if (plan.kind === DAILY_REWARD_KINDS.CARD) {
          const existing = await context.get(STORES.COLLECTION, plan.card.uniqueKey);
          const quantity = (existing?.quantity ?? 0) + plan.quantity;
          if (!existing) grantedNewKeys.push(plan.card.uniqueKey);
          await context.put(
            STORES.COLLECTION,
            existing
              ? { ...existing, quantity, lastObtainedAt: grantedAt }
              : {
                  key: plan.card.uniqueKey,
                  cardId: plan.card.id,
                  style: plan.card.style,
                  set: plan.card.set,
                  quantity,
                  firstObtainedAt: grantedAt,
                  lastObtainedAt: grantedAt,
                }
          );
        }

        const claimedUniques = entry.unique && entry.uniqueId && !uniqueConsumed
          ? [...base.claimedUniques, entry.uniqueId]
          : base.claimedUniques;

        await context.put(
          STORES.USER_STATE,
          {
            chapterId: chapter.id,
            progress: base.progress + 1,
            lastClaimDay: today,
            claimedUniques,
            seenDay: today,
          },
          USER_STATE_KEYS.DAILY_REWARDS
        );

        return { balance };
      }
    );

    // Announcements, once the commit is done: every screen that shows the reward follows the very
    // same events a booster, a gift or a trade already emits.
    if (plan.kind === DAILY_REWARD_KINDS.SPARKS) {
      eventBus.emit(EVENTS.SPARKS_UPDATED, { balance: committed.balance });
    } else if (plan.kind === DAILY_REWARD_KINDS.RESOURCE) {
      const state = await miningManager.getState();
      eventBus.emit(EVENTS.MINING_UPDATED, {
        day: state.day,
        minedToday: state.minedToday,
        remaining: state.remaining,
        blocksPerDay: state.blocksPerDay,
        totalMined: state.totalMined,
      });
    } else if (plan.kind === DAILY_REWARD_KINDS.BOOSTER) {
      await dateSyncManager.getRemainingBoosters(plan.setId);
      dateSyncManager.emitQuotaUpdated(plan.setId);
    } else if (plan.kind === DAILY_REWARD_KINDS.CARD) {
      eventBus.emit(EVENTS.CARDS_OBTAINED, {
        cards: [plan.card],
        newKeys: grantedNewKeys,
        source: 'dailyreward',
      });
    }

    const snapshot = await this.getSnapshot();
    eventBus.emit(EVENTS.DAILY_REWARDS_UPDATED, { snapshot });
    this.log(`Day ${snapshot.progress} claimed: ${plan.kind} ×${plan.quantity}${plan.setId ? ` (${plan.setId})` : ''}.`);

    return {
      kind: plan.kind,
      reward: plan.reward,
      quantity: plan.quantity,
      card: plan.card ?? null,
      setId: plan.setId ?? null,
      snapshot,
    };
  }

  /**
   * Turns a reward into the concrete grant of a claim, refusing what cannot be given.
   *
   * @param {object} reward - Normalized reward.
   * @param {string|null} setId - Extension chosen by the player, for a booster.
   * @returns {Promise<{kind: string, reward: object, quantity: number, card?: object, setId?: string}>}
   *   The plan.
   * @throws {DailyRewardError} When the content is not available yet, or when a booster still needs
   *   the player to choose its extension.
   */
  async buildPlan(reward, setId) {
    if (reward.kind === DAILY_REWARD_KINDS.CARD) {
      const card = await this.resolveCard(reward.cardId);
      if (!card) {
        throw new DailyRewardError(
          DAILY_REWARD_ERRORS.CONTENT_NOT_RELEASED,
          `The card "${reward.cardId}" is unknown or belongs to an extension that is not released yet.`
        );
      }
      return { kind: reward.kind, reward, quantity: reward.quantity, card };
    }

    if (reward.kind === DAILY_REWARD_KINDS.BOOSTER) {
      const choices = await this.getBoosterChoices();
      if (choices.length === 0) {
        throw new DailyRewardError(DAILY_REWARD_ERRORS.NO_SET, 'No extension is released: the booster cannot be given.');
      }
      const requested = typeof setId === 'string' ? setId.trim() : '';
      if (requested === '') {
        if (choices.length > 1) {
          throw new DailyRewardError(
            DAILY_REWARD_ERRORS.SET_REQUIRED,
            'Several extensions are released: the player has to choose one.',
            { choices }
          );
        }
        return { kind: reward.kind, reward, quantity: reward.quantity, setId: choices[0].setId };
      }
      if (!choices.some((choice) => choice.setId === requested)) {
        throw new DailyRewardError(
          DAILY_REWARD_ERRORS.NO_SET,
          `"${requested}" is not a released extension.`,
          { choices }
        );
      }
      return { kind: reward.kind, reward, quantity: reward.quantity, setId: requested };
    }

    return { kind: reward.kind, reward, quantity: reward.quantity };
  }

  /**
   * Remembers that the popup was displayed today.
   *
   * The automatic opening is a once-a-day offer, and "once" has to survive a reload; the claim
   * itself does not depend on it.
   *
   * @returns {Promise<void>} Resolves once the day was written (or the write failed, with a warning).
   */
  async markSeen() {
    const today = this.getToday();
    if (!today) return;
    try {
      const chapters = await this.load();
      const { chapter, status } = DailyRewardManager.pickChapter(chapters, today);
      const stored = await this.readState();
      const base = chapter && status === 'active'
        ? DailyRewardManager.alignToChapter(stored, chapter)
        : stored;
      if (base.seenDay === today) return;
      await storageRepository.setUserState(USER_STATE_KEYS.DAILY_REWARDS, { ...base, seenDay: today });
    } catch (error) {
      // Losing the memory of the popup only costs a second offer: it must never break a screen.
      console.warn('[DailyRewardManager] The day of the popup could not be saved.', error);
    }
  }

  /**
   * Tells whether the popup should open by itself.
   *
   * The offer is made once a day, and only when there is something to claim: an empty chapter or a
   * reward already taken would make a dialog appear for nothing.
   *
   * @returns {Promise<boolean>} True when the popup is due.
   */
  async isPopupDue() {
    try {
      const snapshot = await this.getSnapshot();
      return snapshot.claimable === true && snapshot.seen !== true;
    } catch (error) {
      console.warn('[DailyRewardManager] The daily reward offer could not be read.', error);
      return false;
    }
  }

  /**
   * Number of rewards still claimable today, for the header badge.
   *
   * @returns {Promise<boolean>} True when the popup has something to give.
   */
  async hasClaimable() {
    try {
      const snapshot = await this.getSnapshot();
      return snapshot.claimable === true;
    } catch (error) {
      console.warn('[DailyRewardManager] The claimable state could not be read.', error);
      return false;
    }
  }

  /**
   * Forgets the in-memory caches (imported save, reset).
   *
   * @returns {void}
   */
  reset() {
    this.chapters = [];
    this.loadPromise = null;
    this.cardIndexPromise = null;
    this.boosterChoicePromise = null;
  }
}

/** Shared instance used by the popup and the application bootstrap. */
export const dailyRewardManager = new DailyRewardManager();

export default dailyRewardManager;

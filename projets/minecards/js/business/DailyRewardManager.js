/**
 * DailyRewardManager - The rewards of the daily connection.
 *
 * Reference: `settings/daily_connect_rewards.json` (the chapters and their days),
 * `js/UI/components/DailyRewardPopup.js` (the screen) and `.docs/projet/05-daily-rewards.md`.
 *
 * WHAT IT IS
 * A chapter is a list of rewards, one per day, that a player collects by showing up. The chapter
 * carries an availability window: outside of it, nothing is claimable. Inside it, a player claims at
 * most ONE reward per UTC day and per chapter.
 *
 * TWO MODES (`Mode` of the file)
 *   - "progressive" (the default): every claim advances the run by one day - the run is the
 *     `progress` of the state, never a calendar index. Missing a day therefore costs nothing:
 *     coming back the day after claims the NEXT reward of the list, whether two days or two weeks
 *     went by;
 *   - "defined": the reward of a day belongs to that CALENDAR day of the window. A player who
 *     connects on days 3, 5 and 7 of a ten-day chapter receives the rewards 3, 5 and 7; the others
 *     are missed for good. The run remembers which days were claimed (`claimedDays`).
 *
 * SEVERAL CHAPTERS AT ONCE
 * Two chapters may be open on the same day (a long seasonal one and a short "road to" one). Each
 * one keeps ITS OWN run, so their progress never touches, and ONE connection day counts for all of
 * them: a claim on one chapter does not consume the day of the other, but the connection counter of
 * the save (`stats.daysConnected`) moves once per day, never once per chapter.
 *
 * HIDDEN REWARDS (`HiddenBeforeUnlock`)
 * A chapter may hide the rewards that are still ahead of the player: the board then shows a lock
 * icon instead of the prize, and the day only reveals itself once it becomes the claimable one.
 *
 * WHAT IT IS NOT
 * It is not a giveaway of a free booster per day: the quota of `DateSyncManager` stays the only
 * source of daily boosters, and a chapter only adds what its JSON declares.
 *
 * A "RANDOM CARD" REWARD (`RandomCard-List`, `RandomCard-Filter`) is drawn at claim time by
 * `js/business/RandomCardReward.js`, inside the same transaction, and the claim result carries the
 * strip the roulette spins. Nothing about it is written before the claim.
 *
 * STATE (`user_state["dailyRewards"]`)
 *   `{ chapters: { [chapterId]: { progress, claimedDays, lastClaimDay } }, claimedUniques, seenDay }`
 *   - `chapters`     : one run per chapter the player has touched. A chapter that is not there is a
 *                      fresh run, which is what "when a new series starts, we go back to zero" means;
 *   - `progress`     : how many rewards of that chapter were claimed (0 = none, 1 = day one done),
 *                      the position of a "progressive" chapter;
 *   - `claimedDays`  : the calendar days claimed by a "defined" chapter (1-based positions);
 *   - `lastClaimDay` : the UTC day of the last claim, the whole anti-double-claim rule;
 *   - `claimedUniques`: the `UniqueID`s already handed out, one reward per ACCOUNT and per id: the
 *                      list is global on purpose, so the same unique reward declared by a later
 *                      chapter is still replaced instead of granted twice;
 *   - `seenDay`      : the last day the popup was shown, so the automatic opening happens once a day.
 *
 * A save written before several chapters could be open holds `{ chapterId, progress, ... }` at the
 * top: `normalizeState()` moves it into `chapters[chapterId]`, so nobody loses a claimed day.
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
import miningManager, {
  BUNDLE_TEXTURE,
  RESOURCE_TEXTURE_DIRECTORY,
  SPARKS_TEXTURE,
} from './MiningManager.js';
import sparksManager, { SPARKS_SOURCES } from './SparksManager.js';
import illagerShopManager, { ILLAGER_SHOP_EVENT } from './IllagerShopManager.js';
import enderPearlManager, { PEARL_TEXTURE } from './EnderPearlManager.js';
import goldenPickaxeManager, {
  GOLDEN_PICKAXE_ITEM_ID,
  GOLDEN_PICKAXE_TEXTURE,
} from './GoldenPickaxeManager.js';
import {
  isRandomCardRewardType,
  parseRandomCardSpec,
  randomCardTint,
  resolveRandomCardReward,
  resetRandomCardCatalog,
} from './RandomCardReward.js';

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
  BUNDLE: 'bundle',
  CARD: 'card',
  // A card drawn at claim time and revealed by the roulette (`RandomCard-List`, `RandomCard-Filter`).
  RANDOM_CARD: 'randomcard',
  // A currency of the Illager Shop, named by its id alone (`AllaysCurrency`): the shop owns its
  // name, its texture and the day it expires, so a chapter only has to hand out an amount.
  CUSTOM_CURRENCY: 'currency',
  // An item of the inventory (`Type: "Ender Pearl"`, `"Golden Pickaxe"`): the quantity is the number
  // of items, and the player decides when to spend them (see `EnderPearlManager` and
  // `GoldenPickaxeManager`).
  PEARL: 'pearl',
  GOLDEN_PICKAXE: 'goldenpickaxe',
});

/** Modes a chapter can run in (`Mode` of the file). */
export const DAILY_REWARD_MODES = Object.freeze({
  // The next reward of the run, whatever day of the window the player connects.
  PROGRESSIVE: 'progressive',
  // The reward of the calendar day: a day the player misses is lost.
  DEFINED: 'defined',
});

/** Banner of a chapter that names no `Image`, and the background of its board. */
export const DEFAULT_CHAPTER_IMAGE = 'assets/icons/icon-192.png';

/** Picture that stands for a reward a chapter keeps hidden until its day comes. */
export const HIDDEN_REWARD_ICON = 'assets/icons/favicon-48.png';

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

/**
 * Normalizes the run of ONE chapter.
 *
 * A run is what a chapter remembers about a player: how far a "progressive" chapter went, which
 * calendar days a "defined" one claimed, the day of the last claim and the `UniqueID`s already used.
 * A field the save does not hold is simply empty: a chapter nobody touched is a fresh run.
 *
 * @param {unknown} raw - Value read from the store, or null.
 * @returns {{progress: number, claimedDays: number[], lastClaimDay: string|null}} A run safe to use.
 */
function normalizeChapterState(raw) {
  const source = isRecord(raw) ? raw : {};
  return {
    progress: Number.isInteger(source.progress) && source.progress >= 0 ? source.progress : 0,
    claimedDays: Array.isArray(source.claimedDays)
      ? source.claimedDays.filter((value) => Number.isInteger(value) && value > 0)
      : [],
    lastClaimDay: typeof source.lastClaimDay === 'string' ? source.lastClaimDay : null,
  };
}

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
      response = await fetch(DAILY_REWARDS_PATH, { cache: 'no-store' });
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

    // The mode decides how a claim moves the run: the next reward of the list, or the reward of the
    // calendar day. An unknown value falls back to progressive, the forgiving one.
    const mode =
      typeof entry.Mode === 'string' && entry.Mode.trim().toLowerCase() === DAILY_REWARD_MODES.DEFINED
        ? DAILY_REWARD_MODES.DEFINED
        : DAILY_REWARD_MODES.PROGRESSIVE;

    return {
      id,
      name: typeof entry.RewardListName === 'string' && entry.RewardListName.trim() !== ''
        ? entry.RewardListName.trim()
        : id,
      // The banner of the board and the backdrop of its grid are this picture, blurred: a chapter
      // that names none falls back to the icon of the application.
      image:
        typeof entry.Image === 'string' && entry.Image.trim() !== ''
          ? entry.Image.trim()
          : DEFAULT_CHAPTER_IMAGE,
      mode,
      hiddenBeforeUnlock: entry.HiddenBeforeUnlock === true,
      start,
      end,
      // Length of the window, both ends included: the number of calendar days a "defined" chapter
      // hands out, and the number of tiles its board draws.
      windowDays: daysBetween(start, end) + 1,
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
      // `Data` optionally names the extension the pack goes to (`"Data": "A1"`). Without it the
      // player picks one, as the picker of the board already offers.
      const setId = typeof raw.Data === 'string' && raw.Data.trim() !== '' ? raw.Data.trim() : null;
      return { kind: DAILY_REWARD_KINDS.BOOSTER, type, quantity, slug: null, cardId: null, setId };
    }
    if (type.toLowerCase() === 'bundle') {
      return { kind: DAILY_REWARD_KINDS.BUNDLE, type, quantity, slug: null, cardId: null };
    }
    // The Ender Pearl is declared by its name (`Ender Pearl`) like a resource, but it is granted to
    // the inventory, not to the mine: it therefore has a kind of its own.
    if (
      type.toLowerCase() === 'ender pearl' ||
      type.toLowerCase() === 'ender_pearl' ||
      type.toLowerCase() === 'enderpearl' ||
      type.toLowerCase() === 'pearl'
    ) {
      return {
        kind: DAILY_REWARD_KINDS.PEARL,
        type,
        quantity,
        slug: 'pearl',
        cardId: null,
      };
    }
    // Same idea for the Golden Pickaxe, declared by its name like a resource but granted to the
    // inventory. `slug` carries the item id, which is what the tile and the grant read.
    if (type.toLowerCase() === 'golden pickaxe' || type.toLowerCase() === 'golden_pickaxe' || type.toLowerCase() === 'goldenpickaxe') {
      return {
        kind: DAILY_REWARD_KINDS.GOLDEN_PICKAXE,
        type,
        quantity,
        slug: GOLDEN_PICKAXE_ITEM_ID,
        cardId: null,
      };
    }
    if (type.toLowerCase() === 'card') {
      const cardId = typeof raw.CardID === 'string' ? raw.CardID.trim() : '';
      if (cardId === '') return null;
      return { kind: DAILY_REWARD_KINDS.CARD, type, quantity, slug: null, cardId };
    }
    if (isRandomCardRewardType(type)) {
      const spec = parseRandomCardSpec(raw);
      if (!spec) return null;
      return { kind: DAILY_REWARD_KINDS.RANDOM_CARD, type, quantity, slug: null, cardId: null, spec };
    }
    // `Currency` is how the chapter files spell it, `CustomCurrency` the long form: both name the
    // same reward, and the id is the only thing that identifies a currency.
    if (type.toLowerCase() === 'currency' || type.toLowerCase() === 'customcurrency') {
      const rawId = raw.CurrencyID ?? raw.Data ?? raw.ItemId;
      const currencyId = typeof rawId === 'string' ? rawId.trim() : '';
      if (currencyId === '') return null;
      return {
        kind: DAILY_REWARD_KINDS.CUSTOM_CURRENCY,
        type,
        quantity,
        slug: null,
        cardId: null,
        currencyId,
      };
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
   * @returns {Promise<{chapters: Record<string, object>, seenDay: string|null}>} A state safe to use.
   */
  async readState() {
    return DailyRewardManager.normalizeState(
      await storageRepository.getUserState(USER_STATE_KEYS.DAILY_REWARDS)
    );
  }

  /**
   * Normalizes a stored state.
   *
   * A save written when only one chapter could run holds its run at the TOP level (`chapterId`,
   * `progress`, `lastClaimDay`, `claimedUniques`): that run becomes the one of the chapter it names,
   * so a player who already claimed days keeps them when the second chapter opens.
   *
   * `claimedUniques` stays GLOBAL: a unique reward is unique for the account, whatever chapter
   * declares it. A list found inside a run (the first shape of the multi-chapter save) is merged
   * into it.
   *
   * @param {unknown} raw - Value read from the store.
   * @returns {{chapters: Record<string, object>, claimedUniques: string[],
   *   seenDay: string|null}} A state safe to use.
   */
  static normalizeState(raw) {
    const source = isRecord(raw) ? raw : {};
    const chapters = {};
    const claimedUniques = Array.isArray(source.claimedUniques)
      ? source.claimedUniques.filter((value) => typeof value === 'string' && value !== '')
      : [];
    const addUniques = (value) => {
      if (!Array.isArray(value)) return;
      value.forEach((entry) => {
        if (typeof entry === 'string' && entry !== '' && !claimedUniques.includes(entry)) {
          claimedUniques.push(entry);
        }
      });
    };

    if (isRecord(source.chapters)) {
      Object.entries(source.chapters).forEach(([id, value]) => {
        const chapterId = typeof id === 'string' ? id.trim() : '';
        if (chapterId === '' || !isRecord(value)) return;
        chapters[chapterId] = normalizeChapterState(value);
        addUniques(value.claimedUniques);
      });
    } else if (typeof source.chapterId === 'string' && source.chapterId.trim() !== '') {
      chapters[source.chapterId.trim()] = normalizeChapterState(source);
      addUniques(source.claimedUniques);
    }

    return {
      chapters,
      claimedUniques,
      seenDay: typeof source.seenDay === 'string' ? source.seenDay : null,
    };
  }

  /**
   * Run of one chapter inside a stored state.
   *
   * @param {object} state - Normalized state.
   * @param {string} chapterId - Id of the chapter.
   * @returns {{progress: number, claimedDays: number[], lastClaimDay: string|null}} The run (a
   *   fresh one when the chapter was never touched).
   */
  static chapterState(state, chapterId) {
    const run = isRecord(state?.chapters) ? state.chapters[chapterId] : null;
    return normalizeChapterState(run);
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
   * Chapter a board was asked to open.
   *
   * @param {Array<object>} chapters - Normalized chapters.
   * @param {string} chapterId - Id asked by the caller.
   * @returns {object|null} The chapter, or null when the file no longer declares it.
   */
  static findChapter(chapters, chapterId) {
    const id = typeof chapterId === 'string' ? chapterId.trim() : '';
    if (id === '') return null;
    return chapters.find((chapter) => chapter.id === id) ?? null;
  }

  /**
   * Talks about a chapter against a day: open, not open yet, or over.
   *
   * @param {object} chapter - Normalized chapter.
   * @param {string} today - The trusted day.
   * @returns {'active'|'upcoming'|'ended'} The status.
   */
  static statusOf(chapter, today) {
    if (chapter.start > today) return 'upcoming';
    if (today > chapter.end) return 'ended';
    return 'active';
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

    // A currency of the Illager Shop is named by its id alone: its texture lives in the shop data,
    // which has to be read before a tile can show it.
    if (reward?.kind === DAILY_REWARD_KINDS.CUSTOM_CURRENCY) await illagerShopManager.init();

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
    // A random card is drawn at claim time only: describing the day never reads the catalogue, so
    // the board stays cheap and an empty pool fails at the claim, where the player can be told.
    const randomCard = reward.kind === DAILY_REWARD_KINDS.RANDOM_CARD;
    return {
      entry,
      reward,
      card,
      icon: DailyRewardManager.iconOf(reward, card),
      // The tile of a random card is drawn by the popup (a rounded card with a question mark),
      // tinted with the best rarity the reward can give.
      svg: randomCard ? 'random-card' : '',
      tint: randomCard ? randomCardTint(reward.spec) : null,
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
      case DAILY_REWARD_KINDS.BUNDLE:
        return BUNDLE_TEXTURE;
      case DAILY_REWARD_KINDS.CARD:
        // A card the catalogue cannot resolve still reads as a card: the back is honest about it
        // (the tile and the preview both say the day is unavailable), where an empty box said nothing.
        return card?.illustration || CARD_REWARD_FALLBACK_TEXTURE;
      case DAILY_REWARD_KINDS.CUSTOM_CURRENCY:
        // The texture of a currency belongs to the Illager Shop data, never to the chapter. Until
        // those files are read the tile simply stays empty, which is what an unknown id gives anyway.
        return illagerShopManager.getCurrency(reward.currencyId)?.texture ?? '';
      case DAILY_REWARD_KINDS.PEARL:
        return PEARL_TEXTURE;
      case DAILY_REWARD_KINDS.GOLDEN_PICKAXE:
        return GOLDEN_PICKAXE_TEXTURE;
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
    if (reward.kind === DAILY_REWARD_KINDS.BUNDLE) return DAILY_REWARD_AURAS.GOLD;
    if (reward.kind === DAILY_REWARD_KINDS.CARD) return DAILY_REWARD_AURAS.PINK;
    if (reward.kind === DAILY_REWARD_KINDS.RANDOM_CARD) return DAILY_REWARD_AURAS.PINK;
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
  /**
   * Builds everything the popup and the header badge need for ONE chapter.
   *
   * @param {string|null} [chapterId=null] - Chapter to describe. Null picks the chapter the game
   *   would open by itself (the last window to have opened).
   * @returns {Promise<object>} The snapshot: status, chapter, today, progress, the days with their
   *   state, the reward of today, and the counters of the header.
   */
  async getSnapshot(chapterId = null) {
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
        chapterId: null,
        chapter: null,
        mode: DAILY_REWARD_MODES.PROGRESSIVE,
        image: DEFAULT_CHAPTER_IMAGE,
        hiddenBeforeUnlock: false,
        progress: 0,
        claimedToday: false,
        claimable: false,
        dayNumber: 0,
        windowDay: null,
        totalDays: 0,
        claimableDays: 0,
        daysUntilEnd: 0,
        days: [],
        current: null,
        seen: false,
      };
    }

    const requested = chapterId ? DailyRewardManager.findChapter(chapters, chapterId) : null;
    const chapter = requested ?? DailyRewardManager.pickChapter(chapters, today).chapter;
    const status = chapter ? DailyRewardManager.statusOf(chapter, today) : 'empty';

    if (!chapter) {
      return {
        trusted: true,
        today,
        status,
        chapterId: null,
        chapter: null,
        mode: DAILY_REWARD_MODES.PROGRESSIVE,
        image: DEFAULT_CHAPTER_IMAGE,
        hiddenBeforeUnlock: false,
        progress: 0,
        claimedToday: false,
        claimable: false,
        dayNumber: 0,
        windowDay: null,
        totalDays: 0,
        claimableDays: 0,
        daysUntilEnd: 0,
        days: [],
        current: null,
        seen: false,
      };
    }

    const run = DailyRewardManager.chapterState(state, chapter.id);
    const defined = chapter.mode === DAILY_REWARD_MODES.DEFINED;
    // A "defined" chapter asks which day of the WINDOW today is; a progressive one simply continues
    // its run, so its position is the number of rewards already claimed.
    const windowDay = daysBetween(chapter.start, today) + 1;
    // A defined chapter draws exactly its window: its calendar days ARE its board. A progressive
    // one draws the days it declares.
    const totalTiles = defined ? Math.max(chapter.windowDays, 1) : Math.max(chapter.maxDay, 1);
    const claimedCount = defined ? run.claimedDays.length : run.progress;
    const dayNumber = defined ? windowDay : run.progress + 1;
    const claimedToday = run.lastClaimDay === today;
    const hiddenBeforeUnlock = chapter.hiddenBeforeUnlock === true;

    const days = [];
    for (let day = 1; day <= totalTiles; day += 1) {
      const info = await this.describeEntry(DailyRewardManager.entryAt(chapter, day - 1), state);
      const claimed = defined ? run.claimedDays.includes(day) : day <= run.progress;
      // A day of a defined chapter is missed as soon as its date is behind us, whether the chapter
      // is still open or already over.
      const missed = defined && !claimed && day < windowDay;
      const dayState = claimed
        ? 'claimed'
        : day === dayNumber && !claimedToday && status === 'active'
          ? 'current'
          : missed
            ? 'missed'
            : 'locked';
      // "Hidden before unlock": every reward still AHEAD of the player is a mystery. The reward of
      // the day is always readable - it is the one the button claims.
      const hidden = hiddenBeforeUnlock && !claimed && day > dayNumber;
      days.push({ day, state: dayState, hidden, ...info });
    }

    const currentEntry = DailyRewardManager.entryAt(chapter, dayNumber - 1);
    const current = await this.describeEntry(currentEntry, state);
    const daysUntilEnd = Math.max(0, daysBetween(today, chapter.end));
    // A "defined" chapter can have handed out today's reward already, even though no claim happened
    // today: the day belongs to the window, not to the run.
    const claimedWindowDay = defined && run.claimedDays.includes(windowDay);
    const claimable =
      status === 'active' &&
      !claimedToday &&
      !claimedWindowDay &&
      Boolean(current) &&
      current.unavailable !== true;

    // How many rewards are still claimable if the player comes back every day: one per remaining day
    // of the window for a progressive chapter, and the days of a defined one that are not claimed.
    let claimableDays = 0;
    if (status === 'active') {
      if (defined) {
        for (let day = Math.max(1, windowDay); day <= totalTiles; day += 1) {
          if (!run.claimedDays.includes(day)) claimableDays += 1;
        }
      } else {
        claimableDays = daysUntilEnd + 1;
      }
    }

    return {
      trusted: true,
      today,
      status,
      chapterId: chapter.id,
      chapter,
      mode: chapter.mode,
      image: chapter.image,
      hiddenBeforeUnlock,
      progress: claimedCount,
      claimedToday,
      claimable,
      dayNumber,
      windowDay: defined ? windowDay : null,
      totalDays: defined ? totalTiles : chapter.totalDays,
      claimableDays,
      daysUntilEnd,
      days,
      current: current ? { ...current, day: dayNumber, state: 'current', hidden: false } : null,
      seen: state.seenDay === today,
    };
  }

  /**
   * Lists the chapters with what a chooser needs to draw them.
   *
   * The button of the header has to know whether there is a choice at all: one open chapter opens
   * straight away, several open the chooser of the series.
   *
   * @returns {Promise<{trusted: boolean, today: string|null, seenDay: string|null,
   *   chapters: Array<object>}>} One entry per declared chapter, in the order of the file.
   */
  async listChapters() {
    const chapters = await this.load();
    const state = await this.readState();
    const today = this.getToday();
    if (!today) return { trusted: false, today: null, seenDay: null, chapters: [] };

    const entries = chapters.map((chapter) => {
      const run = DailyRewardManager.chapterState(state, chapter.id);
      const status = DailyRewardManager.statusOf(chapter, today);
      const defined = chapter.mode === DAILY_REWARD_MODES.DEFINED;
      const windowDay = daysBetween(chapter.start, today) + 1;
      const totalTiles = defined
        ? Math.max(chapter.windowDays, 1)
        : Math.max(chapter.maxDay, 1);
      const claimedToday = run.lastClaimDay === today;
      const claimedWindowDay = defined && run.claimedDays.includes(windowDay);

      return {
        id: chapter.id,
        name: chapter.name,
        image: chapter.image,
        mode: chapter.mode,
        hiddenBeforeUnlock: chapter.hiddenBeforeUnlock,
        start: chapter.start,
        end: chapter.end,
        status,
        dayNumber: defined ? windowDay : run.progress + 1,
        totalDays: defined ? totalTiles : chapter.totalDays,
        claimedToday,
        claimable: status === 'active' && !claimedToday && !claimedWindowDay,
      };
    });

    return { trusted: true, today, seenDay: state.seenDay, chapters: entries };
  }

  /**
   * Advances the run without granting the rewards it skips.
   *
   * This is what a personal code ("advance the daily reward") applies: the position moves forward
   * by `steps`, so the next reward the player may claim is the one after the skipped days.
   * `lastClaimDay` is deliberately left untouched - the code moves the run, it does not consume the
   * day - which lets the reward of the new position be claimed right away.
   *
   * The chapter file must ALREADY be loaded (`load()`): a fetch inside the caller's IndexedDB
   * transaction would commit it (see `RedeemManager.grantResolved`).
   *
   * @param {number} steps - Number of days to skip (positive integer).
   * @param {object} context - Open write context of `storageRepository.transaction`.
   * @returns {Promise<{chapterId: string, progress: number}>} The new run position.
   * @throws {DailyRewardError} Without a trusted day (`NOT_TRUSTED`) or without an open chapter
   *   (`NO_CHAPTER`).
   * @throws {Error} When the write fails.
   */
  /**
   * Advances the run without granting the rewards it skips.
   *
   * This is what a personal code ("advance the daily reward") applies: the position moves forward
   * by `steps`, so the next reward the player may claim is the one after the skipped days.
   * `lastClaimDay` is deliberately left untouched - the code moves the run, it does not consume the
   * day - which lets the reward of the new position be claimed right away.
   *
   * Only the OPEN progressive chapters move: a "defined" chapter is nailed to the calendar, so
   * skipping days into it would skip days that can never come back.
   *
   * The chapter file must ALREADY be loaded (`load()`): a fetch inside the caller's IndexedDB
   * transaction would commit it (see `RedeemManager.grantResolved`).
   *
   * @param {number} steps - Number of days to skip (positive integer).
   * @param {object} context - Open write context of `storageRepository.transaction`.
   * @returns {Promise<{advanced: Array<{chapterId: string, progress: number}>}>} The new positions.
   * @throws {DailyRewardError} Without a trusted day (`NOT_TRUSTED`) or without an open progressive
   *   chapter (`NO_CHAPTER`).
   * @throws {Error} When the write fails.
   */
  async advanceRun(steps, context) {
    const quantity = Math.trunc(Number(steps));
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new DailyRewardError(
        DAILY_REWARD_ERRORS.NO_REWARD,
        'The number of days to advance is not a positive integer.'
      );
    }

    const chapters = await this.load();
    const today = this.getToday();
    if (!today) {
      throw new DailyRewardError(
        DAILY_REWARD_ERRORS.NOT_TRUSTED,
        'The trusted UTC day is unavailable: the run cannot be advanced.'
      );
    }

    const open = chapters.filter(
      (chapter) =>
        chapter.mode === DAILY_REWARD_MODES.PROGRESSIVE &&
        chapter.start <= today &&
        today <= chapter.end
    );
    if (open.length === 0) {
      throw new DailyRewardError(
        DAILY_REWARD_ERRORS.NO_CHAPTER,
        `No progressive chapter is open on ${today}.`
      );
    }

    const stored = DailyRewardManager.normalizeState(
      await context.get(STORES.USER_STATE, USER_STATE_KEYS.DAILY_REWARDS)
    );
    const next = { ...stored, chapters: { ...stored.chapters } };
    const advanced = open.map((chapter) => {
      const run = DailyRewardManager.chapterState(stored, chapter.id);
      const progress = run.progress + quantity;
      next.chapters[chapter.id] = { ...run, progress };
      return { chapterId: chapter.id, progress };
    });

    await context.put(STORES.USER_STATE, next, USER_STATE_KEYS.DAILY_REWARDS);
    this.log(
      `Run advanced by ${quantity}: ${advanced.map((entry) => `${entry.chapterId} -> ${entry.progress}`).join(', ')}.`
    );
    return { advanced };
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
  /**
   * Claims the reward of today on ONE chapter.
   *
   * Everything is written in ONE transaction: the reward, the run position, the day of the claim and
   * the `UniqueID`. A failure therefore leaves the save exactly as it was - the player can retry,
   * and a network-free save can never lose a reward to a half-written claim.
   *
   * @param {object} [options] - Claim options.
   * @param {string|null} [options.chapterId=null] - Chapter to claim from. Null picks the chapter the
   *   game would open by itself.
   * @param {string|null} [options.setId=null] - Extension chosen for a `Booster` reward.
   * @returns {Promise<object>} What was granted (`reward`, `card`, `setId`, `quantity`, `snapshot`).
   * @throws {DailyRewardError} When the claim is refused (see `DAILY_REWARD_ERRORS`).
   * @throws {Error} When the write fails.
   */
  async claim({ chapterId = null, setId = null } = {}) {
    const chapters = await this.load();
    const today = this.getToday();
    if (!today) {
      throw new DailyRewardError(
        DAILY_REWARD_ERRORS.NOT_TRUSTED,
        'The trusted UTC day is unavailable: no reward can be claimed.'
      );
    }

    const requested = chapterId ? DailyRewardManager.findChapter(chapters, chapterId) : null;
    const chapter = requested ?? DailyRewardManager.pickChapter(chapters, today).chapter;
    const status = chapter ? DailyRewardManager.statusOf(chapter, today) : 'empty';
    if (!chapter || status !== 'active') {
      throw new DailyRewardError(
        DAILY_REWARD_ERRORS.NO_CHAPTER,
        `No chapter is open on ${today} (status: ${status}).`
      );
    }

    const stored = await this.readState();
    const base = DailyRewardManager.chapterState(stored, chapter.id);
    if (base.lastClaimDay === today) {
      throw new DailyRewardError(
        DAILY_REWARD_ERRORS.ALREADY_CLAIMED,
        `The reward of ${today} was already claimed on "${chapter.id}".`
      );
    }

    const defined = chapter.mode === DAILY_REWARD_MODES.DEFINED;
    // The position is the day of the WINDOW for a defined chapter, the next reward of the run for a
    // progressive one. Both are 1-based, exactly like the `Day` of the file.
    const position = defined ? daysBetween(chapter.start, today) + 1 : base.progress + 1;
    if (defined && base.claimedDays.includes(position)) {
      throw new DailyRewardError(
        DAILY_REWARD_ERRORS.ALREADY_CLAIMED,
        `Day ${position} of "${chapter.id}" was already claimed.`
      );
    }

    const entry = DailyRewardManager.entryAt(chapter, position - 1);
    if (!entry) {
      throw new DailyRewardError(DAILY_REWARD_ERRORS.NO_REWARD, 'The chapter has no reward for that position.');
    }

    const uniqueConsumed = Boolean(
      entry.unique && entry.uniqueId && stored.claimedUniques.includes(entry.uniqueId)
    );
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
        const run = DailyRewardManager.chapterState(current, chapter.id);
        if (run.lastClaimDay === today || (defined && run.claimedDays.includes(position))) {
          throw new DailyRewardError(
            DAILY_REWARD_ERRORS.ALREADY_CLAIMED,
            `The reward of ${today} was already claimed.`
          );
        }

        let balance = null;

        if (plan.kind === DAILY_REWARD_KINDS.SPARKS) {
          balance = await sparksManager.addSparks(plan.quantity, context, SPARKS_SOURCES.DAILY);
        } else if (plan.kind === DAILY_REWARD_KINDS.RESOURCE) {
          await miningManager.grantResources({ [plan.reward.slug]: plan.quantity }, context);
        } else if (plan.kind === DAILY_REWARD_KINDS.CUSTOM_CURRENCY) {
          await illagerShopManager.grantCurrency(plan.reward.currencyId, plan.quantity, context);
        } else if (plan.kind === DAILY_REWARD_KINDS.PEARL) {
          await enderPearlManager.grantPearls(plan.quantity, context);
        } else if (plan.kind === DAILY_REWARD_KINDS.GOLDEN_PICKAXE) {
          await goldenPickaxeManager.grant(plan.quantity, context);
        } else if (plan.kind === DAILY_REWARD_KINDS.BOOSTER) {
          await dateSyncManager.addBonusBoosters(plan.setId, plan.quantity, context);
        } else if (plan.kind === DAILY_REWARD_KINDS.BUNDLE) {
          await miningManager.grantBundles(plan.quantity, context);
        } else if (plan.kind === DAILY_REWARD_KINDS.CARD || plan.kind === DAILY_REWARD_KINDS.RANDOM_CARD) {
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

        // One connection day counts for EVERY open chapter, so the counter of the global trophy
        // moves once a day: claiming the second chapter of the same day must not count twice.
        const countedToday = Object.entries(current.chapters).some(
          ([id, value]) => id !== chapter.id && value.lastClaimDay === today
        );
        if (!countedToday) {
          const storedStats = await context.get(STORES.USER_STATE, USER_STATE_KEYS.STATS);
          const stats = storedStats && typeof storedStats === 'object' ? { ...storedStats } : {};
          stats.daysConnected =
            (Number.isInteger(stats.daysConnected) && stats.daysConnected >= 0
              ? stats.daysConnected
              : 0) + 1;
          await context.put(STORES.USER_STATE, stats, USER_STATE_KEYS.STATS);
        }

        // A `UniqueID` is unique for the ACCOUNT: the list lives at the root of the state, so the
        // same reward declared by a later chapter is still replaced instead of granted twice.
        const grantedUniques = entry.unique && entry.uniqueId && !uniqueConsumed
          ? [...current.claimedUniques, entry.uniqueId]
          : current.claimedUniques;
        const updated = {
          ...run,
          progress: defined ? run.progress : run.progress + 1,
          claimedDays: defined ? [...run.claimedDays, position] : run.claimedDays,
          lastClaimDay: today,
        };

        await context.put(
          STORES.USER_STATE,
          {
            chapters: { ...current.chapters, [chapter.id]: updated },
            claimedUniques: grantedUniques,
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
    } else if (plan.kind === DAILY_REWARD_KINDS.CUSTOM_CURRENCY) {
      eventBus.emit(ILLAGER_SHOP_EVENT, { currencyId: plan.reward.currencyId });
    } else if (plan.kind === DAILY_REWARD_KINDS.PEARL) {
      eventBus.emit(EVENTS.PEARLS_UPDATED, { count: await enderPearlManager.getCount() });
    } else if (plan.kind === DAILY_REWARD_KINDS.GOLDEN_PICKAXE) {
      eventBus.emit(EVENTS.GOLDEN_PICKAXES_UPDATED, { count: await goldenPickaxeManager.getCount() });
    } else if (
      plan.kind === DAILY_REWARD_KINDS.RESOURCE ||
      plan.kind === DAILY_REWARD_KINDS.BUNDLE
    ) {
      const state = await miningManager.getState();
      eventBus.emit(EVENTS.MINING_UPDATED, {
        day: state.day,
        minedToday: state.minedToday,
        remaining: state.remaining,
        blocksPerDay: state.blocksPerDay,
        totalMined: state.totalMined,
        bundles: state.bundles,
      });
    } else if (plan.kind === DAILY_REWARD_KINDS.BOOSTER) {
      await dateSyncManager.getRemainingBoosters(plan.setId);
      dateSyncManager.emitQuotaUpdated(plan.setId);
    } else if (plan.kind === DAILY_REWARD_KINDS.CARD || plan.kind === DAILY_REWARD_KINDS.RANDOM_CARD) {
      eventBus.emit(EVENTS.CARDS_OBTAINED, {
        cards: [plan.card],
        newKeys: grantedNewKeys,
        source: 'dailyreward',
      });
    }

    const snapshot = await this.getSnapshot(chapter.id);
    eventBus.emit(EVENTS.DAILY_REWARDS_UPDATED, { snapshot, chapterId: chapter.id });
    this.log(
      `Day ${position} of "${chapter.id}" claimed: ${plan.kind} ×${plan.quantity}${plan.setId ? ` (${plan.setId})` : ''}.`
    );

    return {
      kind: plan.kind,
      reward: plan.reward,
      quantity: plan.quantity,
      card: plan.card ?? null,
      // The roulette of the popup: the strip and the winning position, empty for every other kind.
      reel: plan.reel ?? null,
      // "New card" is decided by the transaction itself (the key it had to create).
      isNew: plan.card ? grantedNewKeys.includes(plan.card.uniqueKey) : false,
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
    // The roulette reward: the pool is read, one card is drawn uniformly among the DISTINCT
    // printings, and the strip the wheel spins is built here, once - it is the same list the
    // transaction grants, so the card the player sees under the marker is the card they receive.
    if (reward.kind === DAILY_REWARD_KINDS.RANDOM_CARD) {
      const draw = await resolveRandomCardReward(reward.spec);
      if (!draw) {
        throw new DailyRewardError(
          DAILY_REWARD_ERRORS.CONTENT_NOT_RELEASED,
          'No released card matches the random card reward.'
        );
      }
      return {
        kind: reward.kind,
        reward,
        quantity: reward.quantity,
        card: draw.winner,
        reel: { cards: draw.cards, winnerIndex: draw.winnerIndex },
      };
    }

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
      // A chapter may name the extension itself (`"Data": "A1"`): there is then nothing to ask,
      // and a set that is not released yet refuses the claim instead of silently giving another one.
      const fixed = typeof reward.setId === 'string' ? reward.setId.trim() : '';
      if (fixed !== '') {
        const match = choices.find((choice) => choice.setId.toUpperCase() === fixed.toUpperCase());
        if (!match) {
          throw new DailyRewardError(
            DAILY_REWARD_ERRORS.CONTENT_NOT_RELEASED,
            `"${fixed}" is not a released extension.`,
            { choices }
          );
        }
        return { kind: reward.kind, reward, quantity: reward.quantity, setId: match.setId };
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
  /**
   * Remembers that the popup was displayed today.
   *
   * The automatic opening is a once-a-day offer, and "once" has to survive a reload; the claim
   * itself does not depend on it. The day is shared by every chapter: the player is offered the
   * board once, then chooses which series to open.
   *
   * @returns {Promise<void>} Resolves once the day was written (or the write failed, with a warning).
   */
  async markSeen() {
    const today = this.getToday();
    if (!today) return;
    try {
      const state = await this.readState();
      if (state.seenDay === today) return;
      await storageRepository.setUserState(USER_STATE_KEYS.DAILY_REWARDS, { ...state, seenDay: today });
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
      const listing = await this.listChapters();
      const today = this.getToday();
      if (!listing.trusted || listing.seenDay === today) return false;
      return listing.chapters.some((chapter) => chapter.claimable === true);
    } catch (error) {
      console.warn('[DailyRewardManager] The daily reward offer could not be read.', error);
      return false;
    }
  }

  /**
   * Tells whether any open chapter has a reward the player can claim right now, for the badge.
   *
   * @returns {Promise<boolean>} True when a chapter has something to give.
   */
  async hasClaimable() {
    try {
      const listing = await this.listChapters();
      return listing.chapters.some((chapter) => chapter.claimable === true);
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
    resetRandomCardCatalog();
  }
}

/** Shared instance used by the popup and the application bootstrap. */
export const dailyRewardManager = new DailyRewardManager();

export default dailyRewardManager;

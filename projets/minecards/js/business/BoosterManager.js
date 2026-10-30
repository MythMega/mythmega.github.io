/**
 * BoosterManager - Opens boosters: quota, draw and persistence.
 *
 * Reference: `.docs/main.md` section 3.C and `.docs/steps/3.md` point 4.
 *
 * `openBooster(setId)` sequence:
 *   1. the extension JSON and the rarity table are loaded and VALIDATED before anything else, so
 *      a data error never costs a booster;
 *   2. the quota is consumed (`DateSyncManager.consumeBooster`), the authoritative remaining
 *      count being re-checked inside the write transaction;
 *   3. the pack is drawn (`GachaEngine.drawPack`);
 *   4. the 5 cards are written into `collection` and the `stats` counters are updated in ONE
 *      transaction, BEFORE the reveal animation: closing the tab during the reveal loses nothing.
 *
 * Consequences of that ordering, worth knowing when reading the code:
 *   - a booster is consumed just before the draw, so a draw failure is refunded explicitly rather
 *     than silently swallowing the quota;
 *   - `collection` is the only real inventory: if the quota decrement committed but the card
 *     write failed, the quota is given back. If the process dies between the two transactions,
 *     at worst one booster is lost (never a free booster), so the error is always player-friendly.
 *
 * Fields written to `collection` (see `main.md` section 2):
 *   `{ key, cardId, style, set, quantity, firstObtainedAt, lastObtainedAt }`
 * Fields written to `stats`:
 *   `{ boostersOpened, boostersOpenedBySet: { [setId]: count }, drawsByRarity: { "1".."5" },
 *      drawsByCard: { [key]: count } }`
 *
 * `boostersOpenedBySet` is what the per-extension trophy tiers read (`settings/boosters_trophy.json`
 * `boosterStats`): the global `boostersOpened` cannot tell how many packs of one extension were
 * opened.
 */

import Card from '../classes/Card.js';
import { storageRepository, STORES } from '../models/StorageRepository.js';
import { USER_STATE_KEYS } from './AccountManager.js';
import dateSyncManager, { BOOSTER_SOURCES } from './DateSyncManager.js';
import sparksManager from './SparksManager.js';
import GachaEngine from './GachaEngine.js';
import { configLoader, DEFAULT_CARDSET_SETTINGS } from '../utils/ConfigLoader.js';
import { buildBoosterCode } from '../utils/BoosterCode.js';
import eventBus, { EVENTS } from '../utils/EventBus.js';

/** Default directory of the extension JSON files (overridable through `boosters.directory`). */
export const BOOSTER_DIRECTORY = 'data/boosters';

/** Default path of the rarity table (overridable through `boosters.rarityConfigPath`). */
export const RARITY_PATH = 'settings/defaultRarity.json';

/** Default number of cards in a booster. */
export const DEFAULT_CARDS_PER_BOOSTER = 5;

/** Milliseconds in one day, used by the release-date comparison. */
const MS_PER_DAY = 86_400_000;

/** Default Sparks credited by one booster opening (`sparks.boosterReward` overrides it). */
export const DEFAULT_BOOSTER_SPARKS_REWARD = 5;

/**
 * Default number of past openings kept in `user_state["boosterHistory"]`.
 *
 * Overridable through `boosters.historySize` in `settings/config.json`; the history is only read
 * by the statistics view, so the default keeps ~10 entries which is what the UI displays.
 */
export const BOOSTER_HISTORY_SIZE = 10;

/**
 * Builds the timestamp stored in `collection`.
 *
 * Both halves of the timestamp come from the TRUSTED clock: the day makes the collection
 * groupable by day, the time of day makes the history readable. The system clock is never read,
 * so a cheater shifting it cannot shift a displayed time (same rule as the header clock).
 *
 * Exported so that every writer of the `collection` store uses the same convention: the redeem
 * codes (step 7) and the gifts (step 8) grant cards without going through `openBooster()`.
 *
 * @returns {string} An ISO 8601 timestamp (`YYYY-MM-DDTHH:MM:SS.000Z`).
 */
export function buildCollectionTimestamp() {
  const trustedDay = dateSyncManager.getCurrentUtcDay();
  if (!trustedDay) {
    // Never anchored (offline first launch with no stored anchor): the local clock is the only
    // available value. It cannot grant anything, the quota logic never reads this field.
    return new Date().toISOString();
  }
  // `getCurrentUtcDay()` and `getUtcDate()` read the same anchor, so day and time always agree.
  return `${trustedDay}T${dateSyncManager.getUtcDate().toISOString().slice(11, 19)}.000Z`;
}

export class BoosterManager {
  /**
   * @param {object} [options] - Manager options.
   * @param {GachaEngine} [options.gachaEngine] - Draw engine (a deterministic one can be injected).
   * @param {string} [options.boosterDirectory=BOOSTER_DIRECTORY] - Directory of the extension JSONs.
   * @param {string} [options.rarityPath=RARITY_PATH] - Path of the rarity table.
   */
  constructor({
    gachaEngine = new GachaEngine(),
    boosterDirectory = BOOSTER_DIRECTORY,
    rarityPath = RARITY_PATH,
  } = {}) {
    this.gachaEngine = gachaEngine;
    this.boosterDirectory = boosterDirectory;
    this.rarityPath = rarityPath;

    /** @type {Record<string, object>} Cache of the extension JSONs, keyed by extension id. */
    this.boosterSets = {};
    /** @type {Record<string, Array<{rarity: number, weight: number}>>|null} Cached rarity table. */
    this.rarityConfig = null;
    /**
     * @type {Map<string, {id: string, releaseDate: string|null, promo: boolean}>} Catalogue read
     *   from `settings/cardsets.json` (release date and promo flag of every declared set).
     */
    this.setCatalogue = new Map();
    /** @type {number} Days a set may be previewed before its release (0 hides it completely). */
    this.upcomingPreviewDays = DEFAULT_CARDSET_SETTINGS.previewDays;
    /** @type {number} Days after its release a set is still announced once (0 never). */
    this.releaseAnnouncementDays = DEFAULT_CARDSET_SETTINGS.announcementDays;
    /** @type {Promise<object>|null} In-flight load used to de-duplicate concurrent calls. */
    this.loadPromise = null;
    /** @type {boolean} True once `init()` completed. */
    this.isInitialized = false;
  }

  /**
   * Loads and validates the rarity table and every extension declared in `settings/config.json`.
   *
   * Loaded only once: subsequent calls reuse the cache (the JSON files ship with the application
   * and never change while the page is open).
   *
   * @param {object} [options] - Load options.
   * @param {boolean} [options.force=false] - Reload the files even when they are already cached.
   * @returns {Promise<{sets: string[]}>} The loaded extension ids.
   * @throws {Error} When a file is missing, invalid, or when an extension contradicts the rarity
   *   table (a drawable rarity with no card, a duplicate `${id}_${style}` key, ...).
   */
  async init({ force = false } = {}) {
    if (this.isInitialized && !force) return { sets: Object.keys(this.boosterSets) };
    if (this.loadPromise && !force) return this.loadPromise;

    this.loadPromise = this.loadAll().catch((error) => {
      this.loadPromise = null;
      throw error;
    });

    const result = await this.loadPromise;
    this.loadPromise = null;
    this.isInitialized = true;
    return result;
  }

  /**
   * Performs the actual loading and validation work of `init()`.
   *
   * @returns {Promise<{sets: string[]}>} The loaded extension ids.
   * @throws {Error} See `init()`.
   */
  async loadAll() {
    const {
      sets,
      directory,
      rarityConfigPath,
      cardsPerBooster,
      upcomingPreviewDays,
      releaseAnnouncementDays,
    } = await configLoader.getBoosterSettings();

    if (sets.length === 0) {
      throw new Error('settings/cardsets.json declares no booster set.');
    }

    // Every declared set is loaded, including the ones that are not released yet: their cards are
    // needed for the 3D preview of the picker, and the catalogue is what can tell a released set
    // from an upcoming one. `getSetAvailability()` is the single gate every consumer goes through.
    this.upcomingPreviewDays = upcomingPreviewDays;
    this.releaseAnnouncementDays = releaseAnnouncementDays;
    this.setCatalogue = new Map(
      (await configLoader.getCardSets()).map((entry) => [entry.id, entry])
    );

    this.boosterDirectory = directory || BOOSTER_DIRECTORY;
    this.rarityPath = rarityConfigPath || RARITY_PATH;
    this.rarityConfig = await BoosterManager.fetchJson(this.rarityPath);
    this.boosterSets = {};

    for (const setId of sets) {
      const path = `${this.boosterDirectory}/${setId}.json`;
      const setData = await BoosterManager.fetchJson(path);
      const declaredId = GachaEngine.safeSetId(setData);
      if (declaredId !== setId) {
        throw new Error(
          `Extension file "${path}" declares the identifier "${declaredId}": the file name must match the extension identifier.`
        );
      }

      // The booster JSON may override the default rarity table (`.docs/steps/3.md` point 1).
      const { config: rarityConfig, source: raritySource } =
        GachaEngine.resolveRarityConfig(setData, this.rarityConfig);
      const cards = GachaEngine.parseCards(setData, { setId });
      const cardsByRarity = GachaEngine.groupCardsByRarity(cards);

      // Full validation before any booster can be opened: a data error must never cost a booster.
      this.gachaEngine.validatePackConfig({ setId, cards }, rarityConfig, cardsPerBooster);

      this.boosterSets[setId] = {
        setId,
        id: setData.ID ?? setData.id ?? setId,
        serie: setId,
        // Display name of the booster, shown instead of the technical id in every language
        // (`Name` in the booster JSON, e.g. "Genesis Blocks"; a single neutral value, so no
        // per-language variant is needed). Falls back to the series/id when absent.
        name: setData.Name ?? setData.Serie ?? setId,
        texture: BoosterManager.normalizeAssetPath(setData.BoosterTexture),
        importMode: setData.ImportMode ?? null,
        raw: setData,
        cards,
        cardsByRarity,
        rarityConfig,
        raritySource,
      };
    }

    console.info(
      `[BoosterManager] Loaded ${Object.keys(this.boosterSets).length} extension(s): ${Object.keys(this.boosterSets).join(', ')}.`
    );
    return { sets: Object.keys(this.boosterSets) };
  }

  /**
   * Returns an extension loaded by `init()`.
   *
   * Public seam used by the Mine Pick: it draws its simulated packs from the very same card
   * pools and rarity tables as a real opening, so both can never disagree.
   *
   * @param {string} setId - Extension identifier (e.g. "A1").
   * @returns {{setId: string, name: string, texture: string|null, cards: Array, rarityConfig: Array,
   *   cardsByRarity: object, raw: object}|null} The loaded extension, or null when unknown.
   */
  getLoadedSet(setId) {
    if (typeof setId !== 'string') return null;
    return this.boosterSets[setId.trim()] ?? null;
  }

  /**
   * Ids of the extensions loaded by `init()`, in the order declared by `config.json`.
   *
   * @returns {string[]} The extension ids.
   */
  getLoadedSetIds() {
    return Object.keys(this.boosterSets);
  }

  /**
   * UTC day a release date is compared to.
   *
   * The trusted day of `DateSyncManager` is used whenever the game is anchored: a device clock set
   * a month ahead must not unlock a set (the same rule the daily quota follows). Before the first
   * anchor the local clock is the only available value, and it grants nothing by itself.
   *
   * @returns {string} An ISO day (`YYYY-MM-DD`).
   */
  static getTrustedUtcDay() {
    const trusted = dateSyncManager.getCurrentUtcDay?.();
    if (typeof trusted === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(trusted)) return trusted;
    return new Date().toISOString().slice(0, 10);
  }

  /**
   * Tells when a set is released, and whether it may be displayed.
   *
   * Three states: RELEASED (openable, in the collection, everywhere), PREVIEW (inside the
   * `upcomingPreviewDays` window: listed in the booster picker with its 3D model, never openable,
   * its cards never in the collection) and HIDDEN (not visible at all: it does not exist for the
   * player). A set without a release date is always released.
   *
   * @param {string} setId - Set id.
   * @returns {{setId: string, releaseDate: string|null, released: boolean, visible: boolean,
   *   daysUntilRelease: number, daysSinceRelease: number|null}} The availability of the set.
   */
  getSetAvailability(setId) {
    const meta = this.setCatalogue.get(setId) ?? null;
    const releaseDate = meta?.releaseDate ?? null;
    if (!releaseDate) {
      return {
        setId,
        releaseDate: null,
        released: true,
        visible: true,
        daysUntilRelease: 0,
        daysSinceRelease: null,
      };
    }

    const today = Date.parse(`${BoosterManager.getTrustedUtcDay()}T00:00:00.000Z`);
    const release = Date.parse(`${releaseDate}T00:00:00.000Z`);
    // Both sides are midnight UTC, so the difference is a whole number of days: the rounding only
    // absorbs a rounding error of the representation, and it never lets a release slip by a day.
    const days = Math.round((release - today) / MS_PER_DAY);
    const released = days <= 0;
    return {
      setId,
      releaseDate,
      released,
      visible: released || (this.upcomingPreviewDays > 0 && days <= this.upcomingPreviewDays),
      daysUntilRelease: Math.max(0, days),
      daysSinceRelease: Math.max(0, -days),
    };
  }

  /**
   * Tells whether a set can be opened right now.
   *
   * @param {string} setId - Set id.
   * @returns {boolean} False for a set announced but not released yet.
   */
  isSetReleased(setId) {
    return this.getSetAvailability(setId).released;
  }

  /**
   * Ids of the loaded sets the player may see (released, plus the ones inside the preview window).
   *
   * @returns {string[]} The visible set ids, in declaration order.
   */
  getVisibleSetIds() {
    return this.getLoadedSetIds().filter((setId) => this.getSetAvailability(setId).visible);
  }

  /**
   * Ids of the loaded sets that can be opened, drawn from and collected.
   *
   * This is what every card pool must use (Mine Pick, Wandering Trader, promo groups): a set
   * announced for next week must never leak a card before its release.
   *
   * @returns {string[]} The released set ids, in declaration order.
   */
  getReleasedSetIds() {
    return this.getLoadedSetIds().filter((setId) => this.getSetAvailability(setId).released);
  }

  /**
   * Normalizes an asset path coming from a booster JSON.
   *
   * The generated data prefixes its paths with `./` (`./assets/boosters/A1.png`), which must be
   * removed so the URL is resolved from the application root.
   *
   * @param {unknown} path - Raw path.
   * @returns {string|null} The normalized path, or null when absent.
   */
  static normalizeAssetPath(path) {
    if (typeof path !== 'string' || path.trim() === '') return null;
    return path.trim().replace(/^\.\//, '');
  }

  /**
   * Fetches and parses a JSON file shipped with the application.
   *
   * @param {string} path - Path relative to the application root (without `./`).
   * @returns {Promise<object>} The parsed payload.
   * @throws {Error} When the request fails, the status is not 2xx or the payload is not valid JSON.
   */
  static async fetchJson(path) {
    const normalized = String(path).replace(/^\.\//, '');
    let response;
    try {
      response = await fetch(normalized);
    } catch (error) {
      throw new Error(`Unable to fetch "${normalized}".`, { cause: error });
    }
    if (!response.ok) {
      throw new Error(`Unable to fetch "${normalized}" (HTTP ${response.status}).`);
    }
    try {
      return await response.json();
    } catch (error) {
      throw new Error(`"${normalized}" is not valid JSON.`, { cause: error });
    }
  }

  /**
   * Returns the loaded extension (cards, rarity table, booster texture).
   *
   * @param {string} setId - Extension id.
   * @returns {Promise<{setId: string, id: string|number, serie: string, name: string, texture: string|null, cards: Card[], cardsByRarity: Map<number, Card[]>, rarityConfig: object, raritySource: string, raw: object}>}
   *   The loaded extension object.
   * @throws {RangeError} When the extension is not declared in `settings/config.json`.
   * @throws {Error} When the file cannot be loaded.
   */
  async getBoosterSet(setId) {
    await this.init();
    const key = dateSyncManager.assertKnownSet(setId);
    const availability = this.getSetAvailability(key);
    if (!availability.released) {
      throw new RangeError(
        `Booster set "${key}" is not released yet${availability.releaseDate ? ` (released on ${availability.releaseDate})` : ''}.`
      );
    }
    return this.boosterSets[key];
  }

  /**
   * Reads the default rarity table, loading it when needed.
   *
   * @returns {Promise<object>} The parsed `settings/defaultRarity.json`.
   * @throws {Error} When the file cannot be loaded.
   */
  async getRarityConfig() {
    await this.init();
    return this.rarityConfig;
  }

  /**
   * Lists the extensions the player may see, for the opening view (step 4).
   *
   * Released sets only by default: this is the listing every catalogue reads (collection, info
   * page, redeem codes, gifts, trophies), so an unreleased set can never leak a card there. The
   * booster picker passes `includeUpcoming` to also get the sets inside the preview window, and
   * `released` tells it which ones it may actually start.
   *
   * @param {object} [options] - Listing options.
   * @param {boolean} [options.includeUpcoming=false] - Also list the sets inside the preview window.
   * @returns {Promise<Array<{setId: string, name: string, texture: string|null, cardCount: number,
   *   releaseDate: string|null, released: boolean, daysUntilRelease: number}>>}
   *   A lightweight description of every listed extension.
   * @throws {Error} When the extensions cannot be loaded.
   */
  async listBoosterSets({ includeUpcoming = false } = {}) {
    await this.init();
    const listed = [];
    Object.values(this.boosterSets).forEach((set) => {
      const availability = this.getSetAvailability(set.setId);
      if (!availability.visible) return;
      if (!availability.released && !includeUpcoming) return;
      listed.push({
        setId: set.setId,
        name: set.name,
        texture: set.texture,
        cardCount: set.cards.length,
        releaseDate: availability.releaseDate,
        released: availability.released,
        daysUntilRelease: availability.daysUntilRelease,
      });
    });
    return listed;
  }

  /**
   * Opens one booster: consumes the quota, draws 5 cards and persists them immediately.
   *
   * @param {string} setId - Extension to open.
   * @param {object} [options] - Opening options.
   * @param {'auto'|'daily'|'bonus'} [options.source='auto'] - Booster bucket to spend. `auto` keeps
   *   the historic order (daily first, then the extension bonus); the opening view passes an
   *   explicit source when the player chose between a daily and an inventory booster.
   * @returns {Promise<{setId: string, cards: Card[], newKeys: string[], source: 'daily'|'bonus', godpack: boolean, sparks: number, quantity: Object<string, number>, remaining: Object}>}
   *   The drawn cards, the keys that were NOT owned before this pack (used for the "NEW" badge of
   *   step 4), whether the booster came from the daily quota or from a bonus, whether it was a god
   *   pack, the Sparks balance after the reward, the resulting quantities and the remaining
   *   boosters for that extension.
   * @throws {RangeError} When the extension is unknown or the source is invalid.
   * @throws {Error} With the code `NO_BOOSTER_AVAILABLE` when neither the daily quota nor a bonus
   *   is available for that extension.
   * @throws {Error} When a JSON file is invalid or the write fails (the booster is then refunded).
   */
  async openBooster(setId, { source = BOOSTER_SOURCES.AUTO } = {}) {
    const key = dateSyncManager.assertKnownSet(setId);
    await this.init();

    // A set that is only previewed cannot be opened, whatever the quota says: checked before the
    // quota is even read, so a click can never consume a booster for an unreleased set.
    const availability = this.getSetAvailability(key);
    if (!availability.released) {
      throw BoosterManager.buildNotReleasedError(key, availability.releaseDate);
    }

    const loadedSet = this.boosterSets[key];
    const { cardsPerBooster, godpackChancePercent, historySize } =
      await configLoader.getBoosterSettings();
    const { boosterReward } = await configLoader.getSparksSettings();
    const quotaBefore = await dateSyncManager.getRemainingBoosters(key);
    const bonusBefore = quotaBefore.bonusBySet[key] ?? 0;

    const available =
      source === BOOSTER_SOURCES.DAILY
        ? quotaBefore.daily > 0
        : source === BOOSTER_SOURCES.BONUS
          ? bonusBefore > 0
          : source === BOOSTER_SOURCES.PURCHASED
            ? (quotaBefore.purchased ?? 0) > 0
            : quotaBefore.availableForSet > 0;
    if (!available) {
      throw BoosterManager.buildNoBoosterError(key);
    }

    // Drawn only after the availability check, and always validated at load time (the cards and
    // the rarity table were checked in `loadAll()`), so a draw cannot fail here.
    const boosterSetData = { setId: loadedSet.setId, cards: loadedSet.cards };
    // A "god pack" (settings/config.json `boosters.godpackChancePercent`) replaces the rarity
    // draw by a uniform draw inside the full art pool; it is only possible when the extension
    // declares enough distinct full art printings (see GachaEngine.MIN_GODPACK_FULL_ART).
    const isGodpack = this.gachaEngine.shouldDrawGodpack(boosterSetData, {
      chancePercent: godpackChancePercent,
    });
    const cards = isGodpack
      ? this.gachaEngine.drawGodpack(boosterSetData, loadedSet.rarityConfig, { cardsPerBooster })
      : this.gachaEngine.drawPack(boosterSetData, loadedSet.rarityConfig, { cardsPerBooster });
    if (isGodpack) {
      console.info(`[BoosterManager] God pack for "${key}": ${cards.length} full art card(s).`);
    }

    const consumed = await dateSyncManager.consumeBooster(key, source);
    if (!consumed) {
      throw BoosterManager.buildNoBoosterError(key);
    }

    const quotaAfter = dateSyncManager.getQuotaSnapshot(key);
    // An explicit source is trusted as-is; in `auto` mode `consumeBooster()` deletes the bonus key
    // once its bucket reaches zero, so the comparison needs a nullish fallback (`undefined < 1` is
    // false and would report "daily" wrongly).
    // In `auto` mode the buckets are read back: the bonus bucket first, then the boosters bought
    // with Sparks, and the daily allowance otherwise - the same order `consumeBooster()` spends
    // them in, so the reported source is the bucket that was really decremented.
    const consumedSource =
      source === BOOSTER_SOURCES.AUTO
        ? (quotaAfter.bonusBySet[key] ?? 0) < bonusBefore
          ? BOOSTER_SOURCES.BONUS
          : (quotaAfter.purchased ?? 0) < (quotaBefore.purchased ?? 0)
            ? BOOSTER_SOURCES.PURCHASED
            : BOOSTER_SOURCES.DAILY
        : source;

    // One single trusted timestamp for the collection row, the history entry and the stats.
    const openedAt = buildCollectionTimestamp();
    const historyEntry = this.buildHistoryEntry({
      setId: key,
      cards,
      set: loadedSet,
      openedAt,
      godpack: isGodpack,
    });

    let result;
    try {
      result = await this.persistBooster(cards, {
        historyEntry,
        historySize,
        timestamp: openedAt,
        sparksReward: boosterReward,
        setId: key,
      });
    } catch (error) {
      await this.refundBooster(key, consumedSource, error);
      throw error;
    }

    const remaining = await dateSyncManager.getRemainingBoosters(key);
    const summary = {
      setId: key,
      cards,
      newKeys: result.newKeys,
      source: consumedSource,
      godpack: isGodpack,
      sparks: result.sparks,
      quantity: result.quantity,
      remaining,
    };

    eventBus.emit(EVENTS.BOOSTER_OPENED, summary);
    if (Number.isFinite(result.sparks)) {
      eventBus.emit(EVENTS.SPARKS_UPDATED, { balance: result.sparks });
    }
    return summary;
  }

  /**
   * Buys one extra booster with Sparks (`boosters.extraBoosterPriceSparks`).
   *
   * Offered once the free daily boosters are all spent: the bought booster lands in its own quota
   * bucket, is spent after the daily allowance and the redeem/gift bonuses of the extension, and
   * survives the daily reset (it was paid for). The player can therefore keep opening without
   * waiting for midnight UTC.
   *
   * The debit and the credit run in ONE transaction over `user_state`: a failure can never charge
   * the balance without granting the booster, or grant the booster without charging it.
   *
   * @returns {Promise<{price: number, balance: number, quota: object}>} The price charged, the
   *   resulting Sparks balance and the quota after the purchase.
   * @throws {SparksError} With `INSUFFICIENT_SPARKS` when the balance does not cover the price.
   * @throws {Error} When the transaction fails.
   */
  async buyExtraBooster() {
    const { extraBoosterPriceSparks } = await configLoader.getBoosterSettings();

    const result = await storageRepository.transaction(
      STORES.USER_STATE,
      'readwrite',
      async (context) => {
        const balance = await sparksManager.applyDelta(context, -extraBoosterPriceSparks);
        await dateSyncManager.addPurchasedBoosters(1, context);
        return { balance };
      }
    );

    console.info(
      `[BoosterManager] Extra booster bought for ${extraBoosterPriceSparks} Sparks (balance: ${result.balance}).`
    );

    // THE PURCHASE IS COMMITTED from here on. Refreshing the mirrors is best effort on purpose: a
    // failure in that bookkeeping must never be reported as a failed purchase, or the player would
    // be told nothing happened while having been charged.
    let quota = dateSyncManager.getQuotaSnapshot(null);
    try {
      // `addPurchasedBoosters` wrote the record inside the shared transaction and left the
      // in-memory mirror alone on purpose: re-reading the quota refreshes it (and applies a pending
      // daily reset, which never clears the boosters that were bought).
      quota = await dateSyncManager.getRemainingBoosters();
      await sparksManager.publishBalance();
    } catch (error) {
      console.warn('[BoosterManager] The mirrors could not be refreshed after the purchase.', error);
    }
    dateSyncManager.emitQuotaUpdated(null);

    return { price: extraBoosterPriceSparks, balance: result.balance, quota };
  }

  /**
   * Builds the history entry of one opening, kept in `user_state["boosterHistory"]`.
   *
   * Only the card KEYS are stored (the full cards would bloat the save file): the statistics view
   * resolves them back through the extension JSON, exactly like `CollectionManager` does. The
   * shareable code is rebuilt here, before the write, so a code failure never costs the pack.
   *
   * @param {object} payload - Entry payload.
   * @param {string} payload.setId - Extension id.
   * @param {Card[]} payload.cards - Drawn cards (in slot order).
   * @param {object} payload.set - Loaded extension, used to resolve the card positions.
   * @param {string} payload.openedAt - Trusted timestamp of the opening.
   * @param {boolean} [payload.godpack=false] - True when the pack was a full art god pack.
   * @returns {{code: string|null, setId: string, openedAt: string, godpack: boolean, keys: string[]}}
   *   The entry ready to be stored.
   */
  buildHistoryEntry({ setId, cards, set, openedAt, godpack = false }) {
    let code = null;
    try {
      code = buildBoosterCode({ setId, cards }, set);
    } catch (error) {
      // `code` is optional: the history stays readable (it draws the broken card back) instead of
      // losing the entry because a card left the extension file.
      console.warn('[BoosterManager] The booster code could not be generated for the history.', error);
    }
    return {
      code,
      setId,
      openedAt,
      godpack: Boolean(godpack),
      keys: cards.map((card) => card.uniqueKey),
    };
  }

  /**
   * Normalizes a raw `user_state["boosterHistory"]` payload.
   *
   * Anything malformed is dropped instead of repaired: the history is a display convenience and an
   * imported save may come from any version of the application.
   *
   * @param {unknown} raw - Stored history.
   * @returns {Array<{code: string|null, setId: string, openedAt: string|null, godpack: boolean, keys: string[]}>}
   *   The valid entries, most recent first.
   */
  static normalizeHistory(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (entry) =>
        entry &&
        typeof entry === 'object' &&
        typeof entry.setId === 'string' &&
        Array.isArray(entry.keys) &&
        entry.keys.every((key) => typeof key === 'string')
    );
  }

  /**
   * Returns the kept openings, with their cards resolved from the extension JSONs.
   *
   * Used by the statistics view: each entry carries the loaded extension and the `Card` instances
   * (a card removed from the extension file becomes `null` at its position, the view skips it).
   *
   * @param {number} [limit=BOOSTER_HISTORY_SIZE] - Maximum number of entries to return.
   * @returns {Promise<Array<{code: string|null, setId: string, openedAt: string|null, godpack: boolean, keys: string[], set: object|null, cards: (Card|null)[]}>>}
   *   The most recent openings first.
   * @throws {Error} When the history cannot be read or the extensions cannot be loaded.
   */
  async getBoosterHistory(limit = BOOSTER_HISTORY_SIZE) {
    await this.init();
    const raw = await storageRepository.getItem(STORES.USER_STATE, USER_STATE_KEYS.BOOSTER_HISTORY);
    const entries = BoosterManager.normalizeHistory(raw);
    const size = Number.isInteger(limit) && limit > 0 ? limit : BOOSTER_HISTORY_SIZE;

    return entries.slice(0, size).map((entry) => {
      const set = this.boosterSets[entry.setId] ?? null;
      return {
        ...entry,
        set,
        cards: entry.keys.map(
          (key) => set?.cards.find((card) => card.uniqueKey === key) ?? null
        ),
      };
    });
  }

  /**
   * Builds the error thrown when no booster is available for an extension.
   *
   * @param {string} setId - Extension id.
   * @returns {Error} An error carrying the `NO_BOOSTER_AVAILABLE` code, easy to detect in the UI.
   */
  static buildNoBoosterError(setId) {
    const error = new Error(
      `No booster available for "${setId}": the daily quota is empty and no bonus booster is left for this extension.`
    );
    error.code = 'NO_BOOSTER_AVAILABLE';
    return error;
  }

  /**
   * Builds the error thrown when a set is announced but not released yet.
   *
   * @param {string} setId - Extension id.
   * @param {string|null} releaseDate - Release day (`YYYY-MM-DD`), when known.
   * @returns {Error} An error carrying the `SET_NOT_RELEASED` code and the release date.
   */
  static buildNotReleasedError(setId, releaseDate) {
    const error = new Error(
      `Booster set "${setId}" is not released yet${releaseDate ? ` (released on ${releaseDate})` : ''}.`
    );
    error.code = 'SET_NOT_RELEASED';
    error.releaseDate = releaseDate ?? null;
    return error;
  }

  /**
   * Writes the drawn cards, the statistics and the history entry in a single transaction.
   *
   * @param {Card[]} cards - Cards of the pack (duplicates allowed).
   * @param {object} [options] - Write options.
   * @param {{code: string|null, setId: string, openedAt: string, godpack: boolean, keys: string[]}|null} [options.historyEntry=null]
   *   Entry to push at the head of `user_state["boosterHistory"]` (see `buildHistoryEntry()`).
   * @param {number} [options.historySize=BOOSTER_HISTORY_SIZE] - Maximum number of kept openings.
   * @param {string|null} [options.timestamp=null] - Timestamp shared with the caller, so the
   *   collection rows, the statistics and the history of one opening all carry the same instant.
   * @param {number} [options.sparksReward=0] - Sparks credited by the opening (`sparks.boosterReward`),
   *   written in the SAME transaction as the cards so a failed write never credits them.
   * @param {string|null} [options.setId=null] - Extension the pack belongs to, incremented in
   *   `stats.boostersOpenedBySet` (the per-extension trophy tiers read that counter).
   * @returns {Promise<{newKeys: string[], quantity: Record<string, number>, sparks: number}>} The
   *   keys obtained for the first time, the resulting quantity per key, and the Sparks balance
   *   after the reward.
   * @throws {Error} When the transaction fails (nothing is written, it is aborted).
   */
  async persistBooster(
    cards,
    {
      historyEntry = null,
      historySize = BOOSTER_HISTORY_SIZE,
      timestamp = null,
      sparksReward = 0,
      setId = null,
    } = {}
  ) {
    const obtainedAt = timestamp ?? buildCollectionTimestamp();
    const drawsByRarity = BoosterManager.countByRarity(cards);
    const drawsByCard = BoosterManager.countByKey(cards);

    return storageRepository.transaction(
      [STORES.COLLECTION, STORES.USER_STATE],
      'readwrite',
      async (context) => {
        const newKeys = [];
        const quantity = {};

        for (const card of cards) {
          const existing = await context.get(STORES.COLLECTION, card.uniqueKey);
          const entry = existing
            ? { ...existing, quantity: existing.quantity + 1, lastObtainedAt: obtainedAt }
            : {
                key: card.uniqueKey,
                cardId: card.id,
                style: card.style,
                set: card.set,
                quantity: 1,
                firstObtainedAt: obtainedAt,
                lastObtainedAt: obtainedAt,
              };

          if (!existing) {
            newKeys.push(card.uniqueKey);
          }
          quantity[card.uniqueKey] = entry.quantity;
          await context.put(STORES.COLLECTION, entry);
        }

        const stats = this.normalizeStats(await context.get(STORES.USER_STATE, USER_STATE_KEYS.STATS));
        stats.boostersOpened += 1;
        if (typeof setId === 'string' && setId !== '') {
          stats.boostersOpenedBySet[setId] = (stats.boostersOpenedBySet[setId] ?? 0) + 1;
        }
        Object.entries(drawsByRarity).forEach(([rarity, count]) => {
          stats.drawsByRarity[rarity] = (stats.drawsByRarity[rarity] ?? 0) + count;
        });
        Object.entries(drawsByCard).forEach(([key, count]) => {
          stats.drawsByCard[key] = (stats.drawsByCard[key] ?? 0) + count;
        });

        await context.put(STORES.USER_STATE, stats, USER_STATE_KEYS.STATS);

        if (historyEntry) {
          // Same transaction as the pack: the stats view can never show an opening that was
          // refunded, and a failed write never leaves an orphan history entry.
          const kept = BoosterManager.normalizeHistory(
            await context.get(STORES.USER_STATE, USER_STATE_KEYS.BOOSTER_HISTORY)
          );
          const size = Number.isInteger(historySize) && historySize > 0 ? historySize : BOOSTER_HISTORY_SIZE;
          await context.put(
            STORES.USER_STATE,
            [historyEntry, ...kept].slice(0, size),
            USER_STATE_KEYS.BOOSTER_HISTORY
          );
        }

        // Sparks reward: same transaction as the pack, so a failed card/stats write never
        // credits the currency (the booster is refunded instead).
        const currentSparks = BoosterManager.normalizeSparks(
          await context.get(STORES.USER_STATE, USER_STATE_KEYS.SPARKS)
        );
        const reward = Number.isInteger(sparksReward) && sparksReward > 0 ? sparksReward : 0;
        const sparks = currentSparks + reward;
        if (reward > 0) {
          await context.put(STORES.USER_STATE, sparks, USER_STATE_KEYS.SPARKS);
        }

        return { newKeys, quantity, sparks };
      }
    );
  }

  /**
   * Gives a booster back after a failed write, so a storage error is never charged to the player.
   *
   * A `daily` booster is restored into `dailyRemaining`, capped at the configured allowance to
   * avoid creating one out of nothing; a `bonus` booster is given back to its extension bucket;
   * a `purchased` booster is refunded to its own bucket, uncapped - the player paid for it.
   *
   * @param {string} setId - Extension the booster was consumed for.
   * @param {'daily'|'bonus'|'purchased'} source - Bucket the booster came from.
   * @param {unknown} cause - Original error, only logged.
   * @returns {Promise<void>} Resolves once the refund committed (failures are logged, not thrown).
   */
  async refundBooster(setId, source, cause) {
    console.warn('[BoosterManager] The pack could not be saved: refunding the booster.', cause);

    try {
      const { dailyFreeBoosters } = await configLoader.getBoosterSettings();
      let restored = false;

      await storageRepository.transaction(STORES.USER_STATE, 'readwrite', async (context) => {
        const quota = dateSyncManager.normalizeQuota(await context.get(STORES.USER_STATE, USER_STATE_KEYS.QUOTA));

        if (source === BOOSTER_SOURCES.BONUS) {
          const bonusBoosters = { ...quota.bonusBoosters, [setId]: (quota.bonusBoosters[setId] ?? 0) + 1 };
          await context.put(STORES.USER_STATE, { ...quota, bonusBoosters }, USER_STATE_KEYS.QUOTA);
          restored = true;
          return;
        }

        if (source === BOOSTER_SOURCES.PURCHASED) {
          const purchasedBoosters = (quota.purchasedBoosters ?? 0) + 1;
          await context.put(STORES.USER_STATE, { ...quota, purchasedBoosters }, USER_STATE_KEYS.QUOTA);
          restored = true;
          return;
        }

        if (quota.dailyRemaining >= dailyFreeBoosters) {
          return;
        }
        await context.put(
          STORES.USER_STATE,
          { ...quota, dailyRemaining: quota.dailyRemaining + 1 },
          USER_STATE_KEYS.QUOTA
        );
        restored = true;
      });

      dateSyncManager.quota = await dateSyncManager.readQuota();
      if (restored) {
        dateSyncManager.emitQuotaUpdated(setId);
        console.info(`[BoosterManager] Booster refunded (${source}) for "${setId}".`);
      }
    } catch (error) {
      console.error('[BoosterManager] Refunding the booster failed.', error);
    }
  }

  /**
   * Adds cards to the collection without touching `stats.boostersOpened`.
   *
   * Shared by the redeem codes (step 7) and the gifts (step 8), which must not be counted as
   * opened boosters. Duplicates in the payload are merged into a single entry.
   *
   * @param {Card|Card[]} cards - One card or an array of cards.
   * @param {number} [quantityPerCard=1] - Number of copies added for each card of the payload.
   * @param {object} [context=null] - Optional `StorageRepository.transaction` context to join
   *   instead of opening a new transaction. Used by the redeem codes (step 9), which credit
   *   several rewards atomically: the caller owns the transaction.
   * @returns {Promise<{added: number, newKeys: string[], quantity: Record<string, number>}>} The
   *   number of copies written, the keys obtained for the first time, and the resulting quantities.
   * @throws {TypeError} When the payload contains something else than `Card` instances, or when the
   *   quantity is not a strictly positive integer.
   * @throws {Error} When the transaction fails.
   */
  async addCardToCollection(cards, quantityPerCard = 1, context = null) {
    const list = Array.isArray(cards) ? cards : [cards];
    if (list.length === 0) {
      throw new TypeError('BoosterManager.addCardToCollection requires at least one card.');
    }
    list.forEach((card) => {
      if (!(card instanceof Card)) {
        throw new TypeError('BoosterManager.addCardToCollection expects Card instances (see js/classes/Card.js).');
      }
    });
    dateSyncManager.assertPositiveInteger(quantityPerCard);

    const counts = BoosterManager.countByKey(list);
    const orderedKeys = list.map((card) => card.uniqueKey).filter((key, index, keys) => keys.indexOf(key) === index);
    const timestamp = buildCollectionTimestamp();

    /**
     * Writes the payload through the given transaction context (shared by both paths below).
     *
     * @param {object} activeContext - IndexedDB transaction context.
     * @returns {Promise<{newKeys: string[], quantity: Record<string, number>}>} The write result.
     */
    const apply = async (activeContext) => {
      const newKeys = [];
      const quantity = {};

      for (const key of orderedKeys) {
        const card = list.find((candidate) => candidate.uniqueKey === key);
        const existing = await activeContext.get(STORES.COLLECTION, key);
        const added = counts[key] * quantityPerCard;
        const entry = existing
          ? { ...existing, quantity: existing.quantity + added, lastObtainedAt: timestamp }
          : {
              key,
              cardId: card.id,
              style: card.style,
              set: card.set,
              quantity: added,
              firstObtainedAt: timestamp,
              lastObtainedAt: timestamp,
            };

        if (!existing) {
          newKeys.push(key);
        }
        quantity[key] = entry.quantity;
        await activeContext.put(STORES.COLLECTION, entry);
      }

      return { newKeys, quantity };
    };

    const result = context
      ? await apply(context)
      : await storageRepository.transaction(STORES.COLLECTION, 'readwrite', apply);

    return { added: list.length * quantityPerCard, newKeys: result.newKeys, quantity: result.quantity };
  }

  /**
   * Normalizes a raw Sparks balance read from `user_state["sparks"]`.
   *
   * Anything absent, negative or non-integer is read as 0, exactly like `SparksManager`.
   *
   * @param {unknown} raw - Stored balance.
   * @returns {number} A non-negative integer.
   */
  static normalizeSparks(raw) {
    const value = typeof raw === 'number' ? raw : Number(raw);
    return Number.isInteger(value) && value >= 0 ? value : 0;
  }

  /**
   * Normalizes a raw `stats` payload read from `user_state["stats"]`.
   *
   * @param {unknown} raw - Stored statistics.
   * @returns {{boostersOpened: number, boostersOpenedBySet: Record<string, number>, drawsByRarity: Record<string, number>, drawsByCard: Record<string, number>}}
   *   Statistics guaranteed to be writable, with every rarity initialized to zero.
   */
  normalizeStats(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const stats = {
      boostersOpened:
        Number.isInteger(source.boostersOpened) && source.boostersOpened >= 0 ? source.boostersOpened : 0,
      boostersOpenedBySet: {},
      drawsByRarity: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      drawsByCard: {},
    };

    if (source.boostersOpenedBySet && typeof source.boostersOpenedBySet === 'object') {
      Object.entries(source.boostersOpenedBySet).forEach(([setId, count]) => {
        if (typeof setId === 'string' && setId !== '' && Number.isInteger(count) && count >= 0) {
          stats.boostersOpenedBySet[setId] = count;
        }
      });
    }

    if (source.drawsByRarity && typeof source.drawsByRarity === 'object') {
      Object.entries(source.drawsByRarity).forEach(([rarity, count]) => {
        if (Number.isInteger(count) && count >= 0) {
          stats.drawsByRarity[rarity] = count;
        }
      });
    }
    if (source.drawsByCard && typeof source.drawsByCard === 'object') {
      Object.entries(source.drawsByCard).forEach(([key, count]) => {
        if (Number.isInteger(count) && count >= 0) {
          stats.drawsByCard[key] = count;
        }
      });
    }
    return stats;
  }

  /**
   * Counts the cards of a pack per unique key, for `stats.drawsByCard`.
   *
   * @param {Card[]} cards - Cards to count.
   * @returns {Record<string, number>} Number of copies per `${id}_${style}` key.
   */
  static countByKey(cards) {
    return cards.reduce((counts, card) => {
      counts[card.uniqueKey] = (counts[card.uniqueKey] ?? 0) + 1;
      return counts;
    }, {});
  }

  /**
   * Counts the cards of a pack per rarity, for `stats.drawsByRarity`.
   *
   * @param {Card[]} cards - Cards to count.
   * @returns {Record<string, number>} Number of cards per rarity.
   */
  static countByRarity(cards) {
    return cards.reduce((counts, card) => {
      counts[card.rarity] = (counts[card.rarity] ?? 0) + 1;
      return counts;
    }, {});
  }
}

/** Shared instance used by the opening view (step 4), the redeem and the gift managers. */
export const boosterManager = new BoosterManager();

export default boosterManager;

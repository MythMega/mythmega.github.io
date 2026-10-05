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
 *   `{ boostersOpened, drawsByRarity: { "1".."5" }, drawsByCard: { [key]: count } }`
 */

import Card from '../classes/Card.js';
import { storageRepository, STORES } from '../models/StorageRepository.js';
import { USER_STATE_KEYS } from './AccountManager.js';
import dateSyncManager from './DateSyncManager.js';
import GachaEngine from './GachaEngine.js';
import { configLoader } from '../utils/ConfigLoader.js';
import eventBus, { EVENTS } from '../utils/EventBus.js';

/** Default directory of the extension JSON files (overridable through `boosters.directory`). */
export const BOOSTER_DIRECTORY = 'data/boosters';

/** Default path of the rarity table (overridable through `boosters.rarityConfigPath`). */
export const RARITY_PATH = 'settings/defaultRarity.json';

/** Default number of cards in a booster. */
export const DEFAULT_CARDS_PER_BOOSTER = 5;

/**
 * Builds the timestamp stored in `collection`.
 *
 * The returned string follows the TRUSTED UTC day (so the collection can be grouped by day
 * without depending on the client clock) combined with the exact time of the local system clock,
 * which is only a display detail: `Date.now()` is never used to decide whether a reset happened.
 *
 * @returns {string} An ISO 8601 timestamp.
 */
function buildCollectionTimestamp() {
  const trustedDay = dateSyncManager.getCurrentUtcDay();
  if (!trustedDay) {
    // Never anchored (offline first launch with no stored anchor): the local clock is the only
    // available value. It cannot grant anything, the quota logic never reads this field.
    return new Date().toISOString();
  }
  return `${trustedDay}T${new Date().toTimeString().slice(0, 8)}.000Z`;
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
    const { sets, directory, rarityConfigPath, cardsPerBooster } = await configLoader.getBoosterSettings();
    if (sets.length === 0) {
      throw new Error('settings/config.json declares no booster extension in "boosters.sets".');
    }

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
        name: setData.Serie ?? setId,
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
   * Lists the loaded extensions, for the opening view (step 4).
   *
   * @returns {Promise<Array<{setId: string, name: string, texture: string|null, cardCount: number}>>}
   *   A lightweight description of every declared extension.
   * @throws {Error} When the extensions cannot be loaded.
   */
  async listBoosterSets() {
    await this.init();
    return Object.values(this.boosterSets).map((set) => ({
      setId: set.setId,
      name: set.name,
      texture: set.texture,
      cardCount: set.cards.length,
    }));
  }

  /**
   * Opens one booster: consumes the quota, draws 5 cards and persists them immediately.
   *
   * @param {string} setId - Extension to open.
   * @returns {Promise<{setId: string, cards: Card[], newKeys: string[], source: 'daily'|'bonus', quantity: Object<string, number>, remaining: Object}>}
   *   The drawn cards, the keys that were NOT owned before this pack (used for the "NEW" badge of
   *   step 4), whether the booster came from the daily quota or from a bonus, the resulting
   *   quantities and the remaining boosters for that extension.
   * @throws {RangeError} When the extension is unknown.
   * @throws {Error} With the code `NO_BOOSTER_AVAILABLE` when neither the daily quota nor a bonus
   *   is available for that extension.
   * @throws {Error} When a JSON file is invalid or the write fails (the booster is then refunded).
   */
  async openBooster(setId) {
    const key = dateSyncManager.assertKnownSet(setId);
    await this.init();

    const loadedSet = this.boosterSets[key];
    const { cardsPerBooster } = await configLoader.getBoosterSettings();
    const quotaBefore = await dateSyncManager.getRemainingBoosters(key);

    if (quotaBefore.availableForSet === 0) {
      throw BoosterManager.buildNoBoosterError(key);
    }

    // Drawn only after the availability check, and always validated at load time (the cards and
    // the rarity table were checked in `loadAll()`), so a draw cannot fail here.
    const cards = this.gachaEngine.drawPack(
      { setId: loadedSet.setId, cards: loadedSet.cards },
      loadedSet.rarityConfig,
      { cardsPerBooster }
    );

    const consumed = await dateSyncManager.consumeBooster(key);
    if (!consumed) {
      throw BoosterManager.buildNoBoosterError(key);
    }

    const quotaAfter = dateSyncManager.getQuotaSnapshot(key);
    // `consumeBooster()` deletes the bonus key once its bucket reaches zero, so the comparison
    // needs a nullish fallback: `undefined < 1` is false and would report "daily" wrongly.
    const source =
      (quotaAfter.bonusBySet[key] ?? 0) < (quotaBefore.bonusBySet[key] ?? 0) ? 'bonus' : 'daily';

    let result;
    try {
      result = await this.persistBooster(cards);
    } catch (error) {
      await this.refundBooster(key, source, error);
      throw error;
    }

    const remaining = await dateSyncManager.getRemainingBoosters(key);
    const summary = {
      setId: key,
      cards,
      newKeys: result.newKeys,
      source,
      quantity: result.quantity,
      remaining,
    };

    eventBus.emit(EVENTS.BOOSTER_OPENED, summary);
    return summary;
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
   * Writes the drawn cards and the statistics in a single IndexedDB transaction.
   *
   * @param {Card[]} cards - Cards of the pack (duplicates allowed).
   * @returns {Promise<{newKeys: string[], quantity: Record<string, number>}>} The keys obtained for
   *   the first time, and the resulting quantity per key after the pack.
   * @throws {Error} When the transaction fails (nothing is written, it is aborted).
   */
  async persistBooster(cards) {
    const timestamp = buildCollectionTimestamp();
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
            ? { ...existing, quantity: existing.quantity + 1, lastObtainedAt: timestamp }
            : {
                key: card.uniqueKey,
                cardId: card.id,
                style: card.style,
                set: card.set,
                quantity: 1,
                firstObtainedAt: timestamp,
                lastObtainedAt: timestamp,
              };

          if (!existing) {
            newKeys.push(card.uniqueKey);
          }
          quantity[card.uniqueKey] = entry.quantity;
          await context.put(STORES.COLLECTION, entry);
        }

        const stats = this.normalizeStats(await context.get(STORES.USER_STATE, USER_STATE_KEYS.STATS));
        stats.boostersOpened += 1;
        Object.entries(drawsByRarity).forEach(([rarity, count]) => {
          stats.drawsByRarity[rarity] = (stats.drawsByRarity[rarity] ?? 0) + count;
        });
        Object.entries(drawsByCard).forEach(([key, count]) => {
          stats.drawsByCard[key] = (stats.drawsByCard[key] ?? 0) + count;
        });

        await context.put(STORES.USER_STATE, stats, USER_STATE_KEYS.STATS);
        return { newKeys, quantity };
      }
    );
  }

  /**
   * Gives a booster back after a failed write, so a storage error is never charged to the player.
   *
   * A `daily` booster is restored into `dailyRemaining`, capped at the configured allowance to
   * avoid creating one out of nothing; a `bonus` booster is given back to its extension bucket.
   *
   * @param {string} setId - Extension the booster was consumed for.
   * @param {'daily'|'bonus'} source - Bucket the booster came from.
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

        if (source === 'bonus') {
          const bonusBoosters = { ...quota.bonusBoosters, [setId]: (quota.bonusBoosters[setId] ?? 0) + 1 };
          await context.put(STORES.USER_STATE, { ...quota, bonusBoosters }, USER_STATE_KEYS.QUOTA);
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
   * @returns {Promise<{added: number, newKeys: string[], quantity: Record<string, number>}>} The
   *   number of copies written, the keys obtained for the first time, and the resulting quantities.
   * @throws {TypeError} When the payload contains something else than `Card` instances, or when the
   *   quantity is not a strictly positive integer.
   * @throws {Error} When the transaction fails.
   */
  async addCardToCollection(cards, quantityPerCard = 1) {
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

    const result = await storageRepository.transaction(STORES.COLLECTION, 'readwrite', async (context) => {
      const newKeys = [];
      const quantity = {};

      for (const key of orderedKeys) {
        const card = list.find((candidate) => candidate.uniqueKey === key);
        const existing = await context.get(STORES.COLLECTION, key);
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
        await context.put(STORES.COLLECTION, entry);
      }

      return { newKeys, quantity };
    });

    return { added: list.length * quantityPerCard, newKeys: result.newKeys, quantity: result.quantity };
  }

  /**
   * Normalizes a raw `stats` payload read from `user_state["stats"]`.
   *
   * @param {unknown} raw - Stored statistics.
   * @returns {{boostersOpened: number, drawsByRarity: Record<string, number>, drawsByCard: Record<string, number>}}
   *   Statistics guaranteed to be writable, with every rarity initialized to zero.
   */
  normalizeStats(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const stats = {
      boostersOpened:
        Number.isInteger(source.boostersOpened) && source.boostersOpened >= 0 ? source.boostersOpened : 0,
      drawsByRarity: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      drawsByCard: {},
    };

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


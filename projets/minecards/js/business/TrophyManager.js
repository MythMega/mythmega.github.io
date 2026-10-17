/**
 * TrophyManager - Catalogue, evaluation and persistence of the trophies and of the player level.
 *
 * Reference: `settings/boosters_trophy.json`, `settings/global_trophy.json`,
 * `data/trophies/<setId>.json` and the `levelling` / `ExperiencePerTrophy` sections of
 * `settings/config.json`.
 *
 * THREE FAMILIES, all stored and displayed the same way:
 *   1. `booster` — recurring on every extension, declared once in `settings/boosters_trophy.json`:
 *        - `completionTrophy`  : a share of the extension's cards must be owned. `distinctCards:
 *          false` measures the distinct card indexes (`1` as soon as one printing of the index is
 *          owned), `distinctCards: true` measures every printing separately.
 *        - `boosterStats`      : N boosters of that extension must have been opened
 *          (`stats.boostersOpenedBySet`, written by `BoosterManager`).
 *   2. `global`  — account-wide, declared in `settings/global_trophy.json`: total cards owned,
 *      boosters opened, distinct cards of the collection, the blocks mined (all of them, or one
 *      block at a time) and the cards kept in the Mine Pick (all of them, or one card rarity at a
 *      time).
 *   3. `collection` — declared in `data/trophies/<setId>.json`: a list of card indexes to own
 *      (`RequirementType: "CardList"`), optionally restricted to one layout (`classic` / `fullart`).
 *      `MusthaveAllRequirementsCompleted` tells whether every listed index is required or one is
 *      enough. Any other requirement type is ignored for now, as documented in the file itself.
 *
 * EXPERIENCE AND LEVEL
 *   The total experience is DERIVED, never accumulated: `boostersOpened` × `experience.everyBooster`
 *   + distinct cards owned × `experience.everyDistinctCard` + `experience.nameChanged` when the
 *   player chose a name + the XP of every unlocked trophy (`ExperiencePerTrophy[rarity]`, or the
 *   trophy's own `Experience`). State derived from the collection can therefore never be counted
 *   twice, and an imported save immediately shows the right level. Only the trophies themselves are
 *   persisted (`user_state["trophies"]`), because an unlock is permanent: selling cards later must
 *   never take a trophy back.
 *
 *   The level curve is read from `config.json` (`levelling`): `defaultLevel` is where the account
 *   starts, the first level-up costs `baseRequiredExpToLevelUp` XP and every next one costs that
 *   plus `incrementRequiredXpBy` XP.
 */

import Card, { CARD_RARITY } from '../classes/Card.js';
import { storageRepository, STORES } from '../models/StorageRepository.js';
import { configLoader } from '../utils/ConfigLoader.js';
import boosterManager, { buildCollectionTimestamp } from './BoosterManager.js';
import miningManager from './MiningManager.js';
import minePickManager from './MinePickManager.js';
import profileManager from './ProfileManager.js';
import { USER_STATE_KEYS } from './AccountManager.js';
import eventBus, { EVENTS } from '../utils/EventBus.js';

/** `user_state` key holding the unlocked trophies. */
export const TROPHIES_STATE_KEY = USER_STATE_KEYS.TROPHIES;

/** Trophy rarities, from the most common to the rarest (`ExperiencePerTrophy` keys). */
export const TROPHY_RARITIES = Object.freeze(['bronze', 'silver', 'gold', 'diamond', 'emerald']);

/** Trophy families, used as the groups of the profile page. */
export const TROPHY_CATEGORIES = Object.freeze({
  BOOSTER: 'booster',
  GLOBAL: 'global',
  COLLECTION: 'collection',
});

/** Requirement types of `data/trophies/*.json` implemented today. */
export const TROPHY_REQUIREMENT_TYPES = Object.freeze({ CARD_LIST: 'cardlist' });

/**
 * Directory of the trophy medals.
 *
 * Three layouts, one per trophy family:
 *   - recurring per-extension tiers: `assets/img/trophy/<setId>/<family>/<rarity>.png`;
 *   - account-wide tiers: `assets/img/trophy/Global/<counter>/<rarity>.png`, the `<counter>` being
 *     the key of `settings/global_trophy.json` (`totalCards`, `boosters`, `differentCards`,
 *     `miningAllBlock`, `minepickTotalPicks`), the two families split one folder deeper
 *     (`Global/miningEachBlock/<block>/…`, `Global/minepickSpecificPicks/<cardRarity>/…`) adding
 *     that extra level;
 *   - collection trophies: the `Icon` field of the entry in `data/trophies/<setId>.json`, whatever
 *     its extension (the animated `QuinteFlushRoyale.gif` ships that way).
 *
 * A trophy without a usable image falls back to `DEFAULT_TROPHY_ICON`, at build time when the
 * catalogue declares nothing and at display time when the declared file is missing.
 */
export const TROPHY_ICON_DIRECTORY = 'assets/img/trophy';

/** Folder name of a recurring tier, per trophy kind. */
export const TROPHY_ICON_FOLDERS = Object.freeze({
  COMPLETION: 'completion',
  BOOSTER_STATS: 'booster_opened',
  /** Folder of the account-wide tiers, itself split per counter. */
  GLOBAL: 'Global',
});

/** Medal displayed when a trophy ships no image of its own (or when its image cannot be loaded). */
export const DEFAULT_TROPHY_ICON = `${TROPHY_ICON_DIRECTORY}/default.png`;

/**
 * Builds the medal path of a recurring tier.
 *
 * @param {string} setId - Extension id (e.g. `A1`).
 * @param {string} family - Folder name (one of `TROPHY_ICON_FOLDERS`).
 * @param {string} rarity - Rarity id (`bronze` … `emerald`).
 * @returns {string} The path, relative to the application root.
 */
export function buildTrophyIconPath(setId, family, rarity) {
  return `${TROPHY_ICON_DIRECTORY}/${setId}/${family}/${rarity}.png`;
}

/**
 * Builds the medal path of an account-wide tier.
 *
 * @param {string} statKey - Counter key of `settings/global_trophy.json` (`totalCards`, …).
 * @param {string} rarity - Rarity id (`bronze` … `emerald`).
 * @returns {string} The path, relative to the application root.
 */
export function buildGlobalTrophyIconPath(statKey, rarity) {
  return `${TROPHY_ICON_DIRECTORY}/${TROPHY_ICON_FOLDERS.GLOBAL}/${statKey}/${rarity}.png`;
}

/**
 * Builds the medal path of an account-wide family that is split one folder deeper.
 *
 * The mining and Mine Pick families live under `Global/` like every account-wide counter, but add
 * a level: the block id (`Global/miningEachBlock/material.stone/…`) or the card rarity
 * (`Global/minepickSpecificPicks/3/…`). The `family` therefore already carries that level.
 *
 * @param {string} family - Folder below `Global/` (a counter, or `<counter>/<key>`).
 * @param {string} rarity - Rarity id (`bronze` … `emerald`).
 * @returns {string} The path, relative to the application root.
 */
export function buildGlobalFamilyIconPath(family, rarity) {
  return `${TROPHY_ICON_DIRECTORY}/${TROPHY_ICON_FOLDERS.GLOBAL}/${family}/${rarity}.png`;
}

/**
 * Normalizes the `Icon` of a trophy entry read from `data/trophies/<setId>.json`.
 *
 * The field is optional and the file writes it with a leading `./` (`./assets/img/…`): both are
 * accepted here, and an absent field resolves to the default medal rather than to nothing.
 *
 * @param {unknown} path - Raw `Icon` value.
 * @returns {string} A path relative to the application root, never empty.
 */
export function resolveTrophyIcon(path) {
  const text = typeof path === 'string' ? path.trim().replace(/^\.\//, '') : '';
  return text === '' ? DEFAULT_TROPHY_ICON : text;
}

/** Layout filters accepted by a `CardList` requirement (`any` = any printing of the index). */
export const TROPHY_CARD_TYPES = Object.freeze({
  ANY: 'any',
  CLASSIC: 'classic',
  FULL_ART: 'fullart',
});

/**
 * Global counters a `global` trophy may target, mapped to their reading in the account.
 *
 * The values are SLUGS, the form used by the translation keys (`trophy.global.<slug>.title`). The
 * key of `settings/global_trophy.json` is matched case-insensitively (see `readGlobalCounter`), so
 * renaming `totalcards` to `totalCards` — which the icon folders follow — cannot silently drop five
 * trophies again; that key still names the folder of the medals, verbatim.
 */
export const GLOBAL_TROPHY_STATS = Object.freeze({
  TOTAL_CARDS: 'totalcards',
  BOOSTERS: 'boosters',
  DIFFERENT_CARDS: 'differentcards',
  /** Every block ever mined, whatever its type (the `totalMined` counter of the mine). */
  MINING_ALL_BLOCKS: 'miningallblock',
  /** One tier table applied to EVERY type of block of the mine (see `buildMiningBlockTrophies`). */
  MINING_EACH_BLOCK: 'miningeachblock',
  /** Every card ever kept in the Mine Pick (the `totalPicks` counter of the feature). */
  MINEPICK_TOTAL_PICKS: 'minepicktotalpicks',
  /** One tier table applied to the picks of EVERY card rarity (see `buildMinePickRarityTrophies`). */
  MINEPICK_SPECIFIC_PICKS: 'minepickspecificpicks',
});

/**
 * Directory of the mining medals, relative to `TROPHY_ICON_DIRECTORY`.
 *
 * Two layouts, both under `Global/` and named after the counter of
 * `settings/global_trophy.json`:
 *   - every block together: `Global/miningAllBlock/<rarity>.png`;
 *   - one block at a time:    `Global/miningEachBlock/<blockId>/<rarity>.png`, the folder being the
 *     raw `ID` of `settings/mining.json` (`material.stone`, dot included).
 */
export const MINING_TROPHY_ICON_FOLDERS = Object.freeze({
  ALL: 'miningAllBlock',
  EACH: 'miningEachBlock',
});

/**
 * Directory of the Mine Pick medals, relative to `TROPHY_ICON_DIRECTORY`.
 *
 * Both folders live under `Global/`, like every account-wide counter:
 *   - every pick together: `Global/minepickTotalPicks/<rarity>.png`;
 *   - one card rarity at a time: `Global/minepickSpecificPicks/<cardRarity>/<rarity>.png`, the
 *     folder being the rarity value used by the card files (`1` = common … `5` = mythic).
 */
export const MINEPICK_TROPHY_ICON_FOLDERS = Object.freeze({
  TOTAL: 'minepickTotalPicks',
  SPECIFIC: 'minepickSpecificPicks',
});

/**
 * Builds the trophy state a fresh account starts with.
 *
 * @returns {{unlocked: Record<string, {unlockedAt: string|null, experience: number}>}} An empty state.
 */
export function buildDefaultTrophyState() {
  return { unlocked: {} };
}

/**
 * Validates one trophy rarity.
 *
 * @param {unknown} rarity - Raw rarity.
 * @returns {string|null} The lowercase rarity when supported, null otherwise.
 */
export function normalizeRarity(rarity) {
  if (typeof rarity !== 'string') return null;
  const lowered = rarity.trim().toLowerCase();
  return TROPHY_RARITIES.includes(lowered) ? lowered : null;
}

/**
 * Builds a stable, readable trophy id.
 *
 * @param {string} category - One of `TROPHY_CATEGORIES`.
 * @param {Array<string|number>} parts - Discriminating parts (extension, tier, index, name…).
 * @returns {string} e.g. `booster:A1:completion:bronze`.
 */
export function buildTrophyId(category, parts) {
  const slug = parts
    .map((part) => String(part ?? '').trim())
    .filter((part) => part !== '')
    .map((part) => slugify(part))
    .join(':');
  return `${category}:${slug}`;
}

/**
 * Turns any label into an id-safe slug.
 *
 * @param {string} value - Raw label (e.g. "Full Diam's").
 * @returns {string} The slug (e.g. "full-diam-s").
 */
function slugify(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export class TrophyManager {
  constructor() {
    /** @type {object|null} Cached catalogue (the three JSON sources). */
    this.catalog = null;
    /** @type {Promise<object>|null} In-flight load, used to de-duplicate concurrent calls. */
    this.pendingLoad = null;
    /** @type {boolean} True once the manager subscribed to the application events. */
    this.isBound = false;
    /** @type {Function[]} Unsubscribers of the events this manager listens to. */
    this.unsubscribers = [];
  }

  /**
   * Logs with the manager prefix.
   *
   * @param {...unknown} args - Values forwarded to `console.info`.
   * @returns {void}
   */
  log(...args) {
    console.info('[TrophyManager]', ...args);
  }

  /**
   * Subscribes to the events that can unlock a trophy, then performs the first evaluation.
   *
   * Called once at boot by `app.js`. The first evaluation is silent (`notify: false`): an imported
   * or long-lived save can legitimately unlock a dozen trophies at once, and a wall of toasts on
   * load would be noise. Every following opening announces its unlocks.
   *
   * The two subscribed events are the two ways a card enters the collection: an opening
   * (`BOOSTER_OPENED`) and every other grant — purchase, promo code, gift — which all go through
   * `CARDS_OBTAINED`. A purchased card therefore unlocks its trophies exactly like a drawn one.
   *
   * @param {object} [options] - Initialization options.
   * @param {boolean} [options.notify=false] - Announce the trophies unlocked by this very first
   *   evaluation (useful for tests and for a manual refresh).
   * @returns {Promise<object>} The evaluated state (see `evaluate()`).
   * @throws {Error} When a catalogue file is unreadable (the caller logs and continues).
   */
  async init({ notify = false } = {}) {
    if (!this.isBound) {
      this.isBound = true;
      this.unsubscribers.push(
        eventBus.on(EVENTS.BOOSTER_OPENED, () => {
          void this.evaluate({ notify: true });
        })
      );
      this.unsubscribers.push(
        eventBus.on(EVENTS.CARDS_OBTAINED, () => {
          void this.evaluate({ notify: true });
        })
      );
      this.log('Event subscriptions registered.');
    }
    return this.evaluate({ notify });
  }

  /**
   * Reads and caches the trophy catalogue.
   *
   * The catalogue is static (it ships with the application), so it is read once per page load. A
   * missing per-extension file is not an error: an extension may legitimately declare no collection
   * trophy yet.
   *
   * @param {object} [options] - Load options.
   * @param {boolean} [options.force=false] - Re-read the files even when they are cached.
   * @returns {Promise<{boosters: object, global: object, collection: Map<string, object>, directory: string}>}
   *   The catalogue.
   * @throws {Error} When a shared tier file cannot be read.
   */
  async loadCatalog({ force = false } = {}) {
    if (this.catalog && !force) return this.catalog;
    if (this.pendingLoad && !force) return this.pendingLoad;

    this.pendingLoad = this.readCatalog().catch((error) => {
      this.pendingLoad = null;
      throw error;
    });

    const catalog = await this.pendingLoad;
    this.pendingLoad = null;
    this.catalog = catalog;
    return catalog;
  }

  /**
   * Performs the actual reading of `loadCatalog()`.
   *
   * @returns {Promise<object>} The catalogue.
   * @throws {Error} When a shared tier file cannot be read.
   */
  async readCatalog() {
    const [{ directory, boostersConfigPath, globalConfigPath }, { sets }] = await Promise.all([
      configLoader.getTrophySettings(),
      configLoader.getBoosterSettings(),
    ]);

    const [boosters, global] = await Promise.all([
      TrophyManager.fetchJson(boostersConfigPath),
      TrophyManager.fetchJson(globalConfigPath),
    ]);

    const collection = new Map();
    for (const setId of sets) {
      const path = `${directory}/${setId}.json`;
      try {
        collection.set(setId, await TrophyManager.fetchJson(path));
      } catch (error) {
        console.warn(`[TrophyManager] No collection trophies for \"${setId}\" (${error.message}).`);
      }
    }

    this.log(
      `Catalogue loaded: ${sets.length} extension(s) of collection trophies, ` +
        `${Object.keys(global ?? {}).filter((key) => key !== '_comment').length} global counter(s).`
    );
    return { boosters: boosters ?? {}, global: global ?? {}, collection, directory };
  }

  /**
   * Fetches and parses a JSON file shipped with the application.
   *
   * @param {string} path - Path relative to the application root.
   * @returns {Promise<object>} The parsed payload.
   * @throws {Error} When the request fails, the status is not 2xx or the payload is not valid JSON.
   */
  static async fetchJson(path) {
    const normalized = String(path).replace(/^\.\//, '');
    let response;
    try {
      response = await fetch(normalized);
    } catch (error) {
      throw new Error(`Unable to fetch \"${normalized}\".`, { cause: error });
    }
    if (!response.ok) {
      throw new Error(`Unable to fetch \"${normalized}\" (HTTP ${response.status}).`);
    }
    try {
      return await response.json();
    } catch (error) {
      throw new Error(`\"${normalized}\" is not valid JSON.`, { cause: error });
    }
  }

  /**
   * Builds the reading context shared by every trophy family.
   *
   * @returns {Promise<object>} The collection rows, the statistics, the loaded extensions and the
   *   profile.
   * @throws {Error} When the extensions or the storage cannot be read.
   */
  async buildContext() {
    await boosterManager.init();
    const [listed, ownedRows, stats, profile, limits, levelling, experiencePerTrophy] =
      await Promise.all([
        boosterManager.listBoosterSets(),
        storageRepository.getAll(STORES.COLLECTION),
        storageRepository.getItem(STORES.USER_STATE, USER_STATE_KEYS.STATS),
        profileManager.getProfile(),
        profileManager.getLimits(),
        configLoader.getLevellingSettings(),
        configLoader.getExperiencePerTrophy(),
      ]);
    // The mine keeps its counters apart from `stats` (a mined block is not an opened booster): the
    // two mining families read them here, once, instead of each trophy re-reading the save. A mine
    // whose files cannot be read leaves the two families at zero instead of taking the whole
    // catalogue down with it: the other trophies have nothing to do with it.
    let mining = { totalMined: 0, blocksMined: {} };
    let miningBlocks = [];
    try {
      mining = await miningManager.getState({ lang: 'fr' });
      miningBlocks = await miningManager.listBlocks();
    } catch (error) {
      console.warn('[TrophyManager] The counters of the mine could not be read.', error);
    }
    // The Mine Pick keeps its own counters too (`totalPicks`, `picksByRarity`): they feed its two
    // families of trophies. A feature that cannot be read leaves them at zero, exactly like the
    // mine: the rest of the catalogue has nothing to do with it.
    let minePick = { totalPicks: 0, picksByRarity: {} };
    try {
      minePick = await minePickManager.getState();
    } catch (error) {
      console.warn('[TrophyManager] The counters of the Mine Pick could not be read.', error);
    }

    const rows = Array.isArray(ownedRows) ? ownedRows.filter((row) => row && typeof row.key === 'string') : [];
    const ownedKeys = new Set(rows.map((row) => row.key));
    const totalCards = rows.reduce(
      (sum, row) => sum + (Number.isInteger(row.quantity) && row.quantity > 0 ? row.quantity : 0),
      0
    );

    const sets = [];
    for (const listedSet of listed) {
      const set = await boosterManager.getBoosterSet(listedSet.setId);
      const cards = set.cards ?? [];
      /** @type {Map<string, import('../classes/Card.js').Card[]>} Printings per card index. */
      const printingsByIndex = new Map();
      cards.forEach((card) => {
        if (!printingsByIndex.has(card.id)) printingsByIndex.set(card.id, []);
        printingsByIndex.get(card.id).push(card);
      });
      sets.push({
        setId: set.setId,
        name: set.name ?? set.setId,
        cards,
        printingsByIndex,
        distinctIndexes: printingsByIndex.size,
        totalPrintings: cards.length,
      });
    }

    const boostersOpened =
      Number.isInteger(stats?.boostersOpened) && stats.boostersOpened > 0 ? stats.boostersOpened : 0;
    const boostersOpenedBySet =
      stats?.boostersOpenedBySet && typeof stats.boostersOpenedBySet === 'object'
        ? stats.boostersOpenedBySet
        : {};

    return {
      sets,
      ownedKeys,
      distinctOwned: rows.length,
      totalCards,
      boostersOpened,
      boostersOpenedBySet,
      // Mining counters, shared by the two mining families.
      totalMined: mining.totalMined,
      blocksMined: mining.blocksMined,
      blocks: miningBlocks,
      // Mine Pick counters, shared by its two families.
      minePickTotalPicks: minePick.totalPicks,
      minePickPicksByRarity: minePick.picksByRarity ?? {},
      profile,
      defaultName: limits.defaultName,
      levelling,
      experiencePerTrophy,
    };
  }

  /**
   * Computes every trophy of the catalogue against a context.
   *
   * @param {object} catalog - Catalogue from `loadCatalog()`.
   * @param {object} context - Context from `buildContext()`.
   * @param {Record<string, object>} [persisted] - Trophies already unlocked by the player.
   * @returns {object[]} The trophy states, in catalogue order.
   */
  buildTrophies(catalog, context, persisted = {}) {
    // An unlock is permanent: a trophy already stored stays unlocked even when the current
    // collection no longer satisfies it (cards sold, extension rebalanced).
    const unlock = new Set(Object.keys(persisted ?? {}));
    return [
      ...this.buildBoosterTrophies(catalog.boosters, context),
      ...this.buildGlobalTrophies(catalog.global, context),
      ...this.buildCollectionTrophies(catalog, context),
    ].map((trophy) => {
      const record = persisted?.[trophy.id];
      return {
        ...trophy,
        unlocked: unlock.has(trophy.id) || trophy.unlocked,
        // The date the player earned it: shown by the detail modal of the profile page.
        unlockedAt: typeof record?.unlockedAt === 'string' ? record.unlockedAt : null,
        // The XP the trophy actually granted (its own `Experience`, or the persisted value of an
        // unlock recorded by an older version), so the detail modal never recomputes a different
        // number than the one already counted in the total.
        experience: Number.isInteger(record?.experience) && record.experience > 0
          ? record.experience
          : TrophyManager.resolveExperience(trophy, context.experiencePerTrophy),
      };
    });
  }

  /**
   * Builds the recurring per-extension trophies.
   *
   * @param {object} config - Content of `settings/boosters_trophy.json`.
   * @param {object} context - Reading context.
   * @returns {object[]} The trophies, completion tiers first.
   */
  buildBoosterTrophies(config = {}, context) {
    const source = config && typeof config === 'object' ? config : {};
    const trophies = [];
    const completionTiers = TrophyManager.readTiers(source.completionTrophy);
    const statsTiers = TrophyManager.readTiers(source.boosterStats);

    context.sets.forEach((set) => {
      const ownedPrintings = set.cards.filter((card) => context.ownedKeys.has(card.uniqueKey));
      const ownedIndexes = new Set(ownedPrintings.map((card) => card.id));

      if (source.enableCompletionTrophy !== false) {
        completionTiers.forEach((tier) => {
          const byIndex = tier.distinctCards !== true;
          const total = byIndex ? set.distinctIndexes : set.totalPrintings;
          const owned = byIndex ? ownedIndexes.size : ownedPrintings.length;
          const percent = total > 0 ? (owned / total) * 100 : 0;
          trophies.push({
            id: buildTrophyId(TROPHY_CATEGORIES.BOOSTER, [set.setId, 'completion', tier.rarity]),
            category: TROPHY_CATEGORIES.BOOSTER,
            // `group` sorts the catalogue page into blocks of the same TYPE of trophy (the label of
            // the block is `groupKey`): completion tiers and "boosters opened" tiers do not read the
            // same at all, and the page shows them apart.
            group: 'completion',
            groupKey: 'trophy.group.completion',
            rarity: tier.rarity,
            setId: set.setId,
            setName: set.name,
            titleKey: 'trophy.booster.completion.title',
            descriptionKey: byIndex
              ? 'trophy.booster.completion.desc'
              : 'trophy.booster.completionPrintings.desc',
            icon: buildTrophyIconPath(set.setId, TROPHY_ICON_FOLDERS.COMPLETION, tier.rarity),
            params: { set: set.name, rarityKey: `trophy.rarity.${tier.rarity}`, owned, total, percent: Math.round(percent), target: tier.target },
            progress: tier.target > 0 ? Math.min(percent / tier.target, 1) : 1,
            unlocked: percent >= tier.target,
            experience: null,
          });
        });
      }

      if (source.enableBoosterStatsTrophy !== false) {
        statsTiers.forEach((tier) => {
          const current = Number.isInteger(context.boostersOpenedBySet[set.setId])
            ? context.boostersOpenedBySet[set.setId]
            : 0;
          trophies.push({
            id: buildTrophyId(TROPHY_CATEGORIES.BOOSTER, [set.setId, 'opened', tier.rarity]),
            category: TROPHY_CATEGORIES.BOOSTER,
            group: 'opened',
            groupKey: 'trophy.group.opened',
            rarity: tier.rarity,
            setId: set.setId,
            setName: set.name,
            titleKey: 'trophy.booster.stats.title',
            descriptionKey: 'trophy.booster.stats.desc',
            icon: buildTrophyIconPath(set.setId, TROPHY_ICON_FOLDERS.BOOSTER_STATS, tier.rarity),
            params: { set: set.name, rarityKey: `trophy.rarity.${tier.rarity}`, current, target: tier.target },
            progress: tier.target > 0 ? Math.min(current / tier.target, 1) : 1,
            unlocked: current >= tier.target,
            experience: null,
          });
        });
      }
    });

    return trophies;
  }

  /**
   * Builds the account-wide trophies.
   *
   * @param {object} config - Content of `settings/global_trophy.json`.
   * @param {object} context - Reading context.
   * @returns {object[]} The trophies.
   */
  buildGlobalTrophies(config = {}, context) {
    const source = config && typeof config === 'object' ? config : {};
    const trophies = [];

    Object.entries(source).forEach(([statKey, tiers]) => {
      if (statKey.startsWith('_')) return;
      // `miningEachBlock` is one tier table for EVERY block of the mine: it expands into a family of
      // its own instead of reading a single counter.
      if (TrophyManager.isEachBlockCounter(statKey)) {
        trophies.push(...this.buildMiningBlockTrophies(statKey, tiers, context));
        return;
      }
      // `minepickSpecificPicks` works the same way, one family per rarity of the kept card.
      if (TrophyManager.isSpecificPickCounter(statKey)) {
        trophies.push(...this.buildMinePickRarityTrophies(statKey, tiers, context));
        return;
      }
      const current = TrophyManager.readGlobalCounter(statKey, context);
      if (current === null) {
        console.warn(`[TrophyManager] The global counter \"${statKey}\" is not implemented, its trophies are ignored.`);
        return;
      }
      // The counter is named by its slug in the translations, and by the raw key of the file in the
      // icon path (`Global/totalCards/…`): the two must stay distinguishable.
      const slug = slugify(statKey);
      TrophyManager.readTiers(tiers).forEach((tier) => {
        trophies.push({
          id: buildTrophyId(TROPHY_CATEGORIES.GLOBAL, [statKey, tier.rarity]),
          category: TROPHY_CATEGORIES.GLOBAL,
          // One block per global counter (`totalCards`, `boosters`, `differentCards`…), labelled by
          // the same slug as the title/description keys.
          group: statKey,
          groupKey: `trophy.group.${slug}`,
          rarity: tier.rarity,
          setId: null,
          setName: null,
          titleKey: `trophy.global.${slug}.title`,
          descriptionKey: `trophy.global.${slug}.desc`,
          icon: TrophyManager.globalTrophyIcon(statKey, tier.rarity),
          params: { rarityKey: `trophy.rarity.${tier.rarity}`, current, target: tier.target },
          progress: tier.target > 0 ? Math.min(current / tier.target, 1) : 1,
          unlocked: current >= tier.target,
          experience: null,
        });
      });
    });

    return trophies;
  }

  /**
   * Builds the collection trophies declared in `data/trophies/<setId>.json`.
   *
   * @param {object} catalog - Catalogue from `loadCatalog()`.
   * @param {object} context - Reading context.
   * @returns {object[]} The trophies; entries of an unsupported requirement type are skipped.
   */
  buildCollectionTrophies(catalog, context) {
    const trophies = [];

    context.sets.forEach((set) => {
      const file = catalog.collection.get(set.setId);
      const list = Array.isArray(file?.TrophyList) ? file.TrophyList : [];
      list.forEach((entry, index) => {
        if (!entry || typeof entry !== 'object') return;
        const rarity = normalizeRarity(entry.Rarity) ?? 'bronze';
        const requirement = entry.Requirements ?? {};
        const requirementType = String(requirement.RequirementType ?? '').trim().toLowerCase();
        if (requirementType !== TROPHY_REQUIREMENT_TYPES.CARD_LIST) {
          console.warn(
            `[TrophyManager] \"${set.setId}\" trophy #${index} uses the unsupported requirement type ` +
              `\"${requirement.RequirementType}\" and is ignored.`
          );
          return;
        }

        const wanted = TrophyManager.readRequirementIndexes(requirement.Items);
        const layout = String(requirement.Type ?? TROPHY_CARD_TYPES.ANY).trim().toLowerCase();
        const requireAll = entry.MusthaveAllRequirementsCompleted !== false;
        // One entry per required index, carrying the printing to display and whether the player
        // already owns it: the detail modal shows them in colour or in black and white.
        const requiredCards = wanted.map((cardIndex) =>
          TrophyManager.resolveRequiredCard(set, cardIndex, layout, context.ownedKeys)
        );
        const satisfied = requiredCards.filter((entry) => entry.owned).length;
        const total = wanted.length;
        const complete = total > 0 && (requireAll ? satisfied === total : satisfied > 0);
        const name = typeof entry.Name === 'string' && entry.Name.trim() !== ''
          ? entry.Name.trim()
          : `#${index + 1}`;

        trophies.push({
          id: buildTrophyId(TROPHY_CATEGORIES.COLLECTION, [set.setId, name]),
          category: TROPHY_CATEGORIES.COLLECTION,
          // Every collection trophy is of the same type (a list of cards to own): one single block.
          group: 'cards',
          groupKey: 'trophy.group.cards',
          rarity,
          setId: set.setId,
          setName: set.name,
          titleKey: null,
          name,
          descriptionKey: requireAll
            ? 'trophy.collection.desc'
            : 'trophy.collection.any.desc',
          icon: resolveTrophyIcon(entry.Icon),
          requiredCards,
          // `MusthaveAllRequirementsCompleted`: false means ONE required card is enough to validate
          // the collection. The notification of a collection needs it to say "validated".
          requireAll,
          params: { set: set.name, rarityKey: `trophy.rarity.${rarity}`, current: satisfied, target: total },
          progress: total > 0 ? satisfied / total : 0,
          unlocked: complete,
          experience:
            Number.isInteger(entry.Experience) && entry.Experience > 0 ? entry.Experience : null,
        });
      });
    });

    return trophies;
  }

  /**
   * Resolves the medal of a single-counter global trophy.
   *
   * Most counters name their folder verbatim (`Global/totalCards/bronze.png`), but the mining one
   * and the Mine Pick one have their own, explicitly named folders: this keeps the path in one
   * place instead of duplicating the condition in the catalogue builder.
   *
   * @param {string} statKey - Key of `settings/global_trophy.json`.
   * @param {string} rarity - Rarity id (`bronze` … `emerald`).
   * @returns {string} The medal path, relative to the application root.
   */
  static globalTrophyIcon(statKey, rarity) {
    const key = String(statKey ?? '').trim().toLowerCase();
    if (key === GLOBAL_TROPHY_STATS.MINING_ALL_BLOCKS) {
      return buildGlobalFamilyIconPath(MINING_TROPHY_ICON_FOLDERS.ALL, rarity);
    }
    if (key === GLOBAL_TROPHY_STATS.MINEPICK_TOTAL_PICKS) {
      return buildGlobalFamilyIconPath(MINEPICK_TROPHY_ICON_FOLDERS.TOTAL, rarity);
    }
    return buildGlobalTrophyIconPath(statKey, rarity);
  }

  /**
   * Tells whether a global counter is the per-block mining one.
   *
   * @param {string} statKey - Key of `settings/global_trophy.json`.
   * @returns {boolean} True for `miningEachBlock` (case-insensitive).
   */
  static isEachBlockCounter(statKey) {
    return String(statKey ?? '').trim().toLowerCase() === GLOBAL_TROPHY_STATS.MINING_EACH_BLOCK;
  }

  /**
   * Tells whether a global counter is the all-blocks mining one.
   *
   * @param {string} statKey - Key of `settings/global_trophy.json`.
   * @returns {boolean} True for `miningAllBlock` (case-insensitive).
   */
  static isMiningAllBlocksCounter(statKey) {
    return String(statKey ?? '').trim().toLowerCase() === GLOBAL_TROPHY_STATS.MINING_ALL_BLOCKS;
  }

  /**
   * Tells whether a trophy belongs to one of the two mining families.
   *
   * The family combo of the catalogue offers a single "Mine" entry for both of them (every block
   * together, then each block), so the view never has to know the shape of their groups.
   *
   * @param {object} trophy - Trophy state.
   * @returns {boolean} True for a mining trophy.
   */
  static isMiningTrophy(trophy) {
    if (trophy?.category !== TROPHY_CATEGORIES.GLOBAL) return false;
    // The group keeps the spelling of the file (`miningAllBlock`), while the slugs above are
    // lowercase: the comparison ignores the case so the two can never drift apart.
    const group = String(trophy.group ?? '').toLowerCase();
    return group === GLOBAL_TROPHY_STATS.MINING_ALL_BLOCKS ||
      group.startsWith(GLOBAL_TROPHY_STATS.MINING_EACH_BLOCK);
  }

  /**
   * Expands the per-block mining tiers: one trophy per block AND per rarity.
   *
   * The same `{ bronze: 5, silver: 25… }` table applies to every block of `settings/mining.json`, so
   * the catalogue grows by five medals per block without a line of configuration per block. Each
   * block gets its OWN group (`miningEachBlock:<blockId>`), otherwise the twenty-five trophies of
   * the five blocks would pile up in a single grid with five identical headings.
   *
   * @param {string} statKey - Key of the file (`miningEachBlock`).
   * @param {unknown} tiers - Raw tier table.
   * @param {object} context - Reading context (needs `blocks` and `blocksMined`).
   * @returns {object[]} The trophies, block by block.
   */
  buildMiningBlockTrophies(statKey, tiers, context) {
    const trophies = [];
    const slug = slugify(statKey);
    const blocks = Array.isArray(context.blocks) ? context.blocks : [];

    blocks.forEach((block) => {
      const current = Number.isInteger(context.blocksMined?.[block.id]) ? context.blocksMined[block.id] : 0;
      TrophyManager.readTiers(tiers).forEach((tier) => {
        trophies.push({
          id: buildTrophyId(TROPHY_CATEGORIES.GLOBAL, [statKey, block.id, tier.rarity]),
          category: TROPHY_CATEGORIES.GLOBAL,
          group: `${statKey}:${block.id}`,
          groupKey: `trophy.group.${slug}`,
          blockId: block.id,
          // The heading of the block is a translation with the name of the block in it, so the
          // heading is built from the same parameters as the trophy itself.
          groupParams: { block: block.name ?? block.id },
          rarity: tier.rarity,
          setId: null,
          setName: null,
          titleKey: `trophy.global.${slug}.title`,
          descriptionKey: `trophy.global.${slug}.desc`,
          // The folder of a block is the raw ID of the mine (`material.stone`), dot included.
          icon: buildGlobalFamilyIconPath(
            `${MINING_TROPHY_ICON_FOLDERS.EACH}/${block.id}`,
            tier.rarity
          ),
          // The name of the block is data (the mine files it in two languages), not a translation
          // key: both versions are carried and the detail picks the one of the current language.
          blockNames: block.names ?? null,
          params: {
            rarityKey: `trophy.rarity.${tier.rarity}`,
            current,
            target: tier.target,
            block: block.name ?? block.id,
          },
          progress: tier.target > 0 ? Math.min(current / tier.target, 1) : 1,
          unlocked: current >= tier.target,
          experience: null,
        });
      });
    });

    return trophies;
  }

  /**
   * Tells whether a global counter is the per-rarity Mine Pick one.
   *
   * @param {string} statKey - Key of `settings/global_trophy.json`.
   * @returns {boolean} True for `minepickSpecificPicks` (case-insensitive).
   */
  static isSpecificPickCounter(statKey) {
    return (
      String(statKey ?? '').trim().toLowerCase() === GLOBAL_TROPHY_STATS.MINEPICK_SPECIFIC_PICKS
    );
  }

  /**
   * Tells whether a trophy belongs to the Mine Pick family.
   *
   * The family combo of the catalogue offers a single "Mine Pick" entry for both counters (every
   * pick together, then each card rarity), the same way the mine has one "Mine" entry.
   *
   * @param {object} trophy - Trophy state.
   * @returns {boolean} True for a Mine Pick trophy.
   */
  static isMinePickTrophy(trophy) {
    if (trophy?.category !== TROPHY_CATEGORIES.GLOBAL) return false;
    const group = String(trophy.group ?? '').toLowerCase();
    return (
      group === GLOBAL_TROPHY_STATS.MINEPICK_TOTAL_PICKS ||
      group.startsWith(GLOBAL_TROPHY_STATS.MINEPICK_SPECIFIC_PICKS)
    );
  }

  /**
   * Expands the per-rarity Mine Pick tiers: one trophy per card rarity AND per tier.
   *
   * `minepickSpecificPicks` counts the cards KEPT per rarity of the card (1 = common … 5 =
   * mythic), so its single tier table applies to each of the five rarities. Every rarity gets its
   * own group (`minepickSpecificPicks:<rarity>`), otherwise the twenty-five trophies would pile up
   * in one grid with five identical headings.
   *
   * @param {string} statKey - Key of the file (`minepickSpecificPicks`).
   * @param {unknown} tiers - Raw tier table.
   * @param {object} context - Reading context (needs `minePickPicksByRarity`).
   * @returns {object[]} The trophies, rarity by rarity.
   */
  buildMinePickRarityTrophies(statKey, tiers, context) {
    const trophies = [];
    const slug = slugify(statKey);

    for (let cardRarity = CARD_RARITY.MIN; cardRarity <= CARD_RARITY.MAX; cardRarity += 1) {
      const current = Number.isInteger(context.minePickPicksByRarity?.[String(cardRarity)])
        ? context.minePickPicksByRarity[String(cardRarity)]
        : 0;
      TrophyManager.readTiers(tiers).forEach((tier) => {
        trophies.push({
          id: buildTrophyId(TROPHY_CATEGORIES.GLOBAL, [statKey, cardRarity, tier.rarity]),
          category: TROPHY_CATEGORIES.GLOBAL,
          group: `${statKey}:${cardRarity}`,
          groupKey: `trophy.group.${slug}`,
          cardRarity,
          // The name of the card rarity is a translation (`rarity.1` … `rarity.5`), resolved by the
          // detail modal in the language of the player.
          cardRarityKey: `rarity.${cardRarity}`,
          rarity: tier.rarity,
          setId: null,
          setName: null,
          titleKey: `trophy.global.${slug}.title`,
          descriptionKey: `trophy.global.${slug}.desc`,
          // `Global/minepickSpecificPicks/<cardRarity>/<trophyRarity>.png`: the folder is the rarity
          // value of the card files, exactly like the folders of this repository.
          icon: buildGlobalFamilyIconPath(
            `${MINEPICK_TROPHY_ICON_FOLDERS.SPECIFIC}/${cardRarity}`,
            tier.rarity
          ),
          params: {
            rarityKey: `trophy.rarity.${tier.rarity}`,
            current,
            target: tier.target,
          },
          progress: tier.target > 0 ? Math.min(current / tier.target, 1) : 1,
          unlocked: current >= tier.target,
          experience: null,
        });
      });
    }

    return trophies;
  }

  /**
   * Reads the experience a trophy grants.
   *
   * @param {object} trophy - Trophy state.
   * @param {Record<string, number>} experiencePerTrophy - `ExperiencePerTrophy` from the config.
   * @returns {number} The trophy's own `Experience`, or the value of its rarity.
   */
  static resolveExperience(trophy, experiencePerTrophy) {
    if (Number.isInteger(trophy.experience) && trophy.experience > 0) return trophy.experience;
    const byRarity = experiencePerTrophy?.[trophy.rarity];
    return Number.isInteger(byRarity) && byRarity > 0 ? byRarity : 0;
  }

  /**
   * Reads one global counter of the account.
   *
   * The key is compared in lowercase: the file writes `totalCards` where the slug is `totalcards`,
   * and the two must not be able to drift apart.
   *
   * @param {string} statKey - Key of `settings/global_trophy.json` (`totalCards`, `boosters`, …).
   * @param {object} context - Reading context.
   * @returns {number|null} The current value, or null when the counter is not implemented.
   */
  static readGlobalCounter(statKey, context) {
    switch (String(statKey ?? '').trim().toLowerCase()) {
      case GLOBAL_TROPHY_STATS.TOTAL_CARDS:
        return context.totalCards;
      case GLOBAL_TROPHY_STATS.BOOSTERS:
        return context.boostersOpened;
      case GLOBAL_TROPHY_STATS.DIFFERENT_CARDS:
        return context.distinctOwned;
      case GLOBAL_TROPHY_STATS.MINING_ALL_BLOCKS:
        return context.totalMined ?? 0;
      case GLOBAL_TROPHY_STATS.MINEPICK_TOTAL_PICKS:
        return context.minePickTotalPicks ?? 0;
      default:
        return null;
    }
  }

  /**
   * Reads a `{ rarity: threshold }` tier table, ignoring the `_comment` documentation keys.
   *
   * @param {unknown} tiers - Raw table from a trophy file.
   * @returns {Array<{rarity: string, target: number, distinctCards: boolean}>} The valid tiers.
   */
  static readTiers(tiers) {
    if (!tiers || typeof tiers !== 'object' || Array.isArray(tiers)) return [];
    return Object.entries(tiers)
      .filter(([key]) => !key.startsWith('_'))
      .map(([key, value]) => {
        const rarity = normalizeRarity(key);
        // Two accepted shapes, both used by the shipped files: `{ bronze: 10 }` (boosterStats) and
        // `{ bronze: { percentage: 10, distinctCards: false } }` (completionTrophy).
        const target = typeof value === 'number' ? value : value?.percentage;
        return {
          rarity,
          target: Number.isFinite(target) && target > 0 ? target : 0,
          distinctCards: typeof value === 'object' && value !== null ? value.distinctCards === true : false,
        };
      })
      .filter((tier) => tier.rarity !== null && tier.target > 0);
  }

  /**
   * Reads a `CardList` requirement into card indexes.
   *
   * Duplicates are removed: a file listing the same index twice (or more) would otherwise ask for
   * an impossible-to-count quantity.
   *
   * @param {unknown} items - Raw `Items` array.
   * @returns {string[]} The distinct normalized indexes (`SERIE-A1 _ D019`).
   */
  static readRequirementIndexes(items) {
    if (!Array.isArray(items)) return [];
    const seen = new Set();
    items.forEach((item) => {
      if (typeof item !== 'string' || item.trim() === '') return;
      try {
        // `Card.normalizeIndexToId` turns the file notation ("SERIE-A1 / D019") into the id used by
        // the catalogue ("SERIE-A1 _ D019"), so a trophy file and a booster JSON always agree.
        seen.add(Card.normalizeIndexToId(item));
      } catch (error) {
        console.warn(`[TrophyManager] Invalid requirement index ${JSON.stringify(item)}.`, error);
      }
    });
    return Array.from(seen);
  }

  /**
   * Tells whether one card index is owned, honouring the layout filter of the requirement.
   *
   * @param {object} set - Extension context (`cards`, `printingsByIndex`).
   * @param {string} cardIndex - Normalized index (`SERIE-A1 _ D019`).
   * @param {string} layout - `any`, `classic` or `fullart`.
   * @param {Set<string>} ownedKeys - Owned collection keys.
   * @returns {boolean} True when at least one matching printing is owned.
   */
  static isIndexOwned(set, cardIndex, layout, ownedKeys) {
    return TrophyManager.filterPrintings(set.printingsByIndex.get(cardIndex) ?? [], layout)
      .some((card) => ownedKeys.has(card.uniqueKey));
  }

  /**
   * Keeps only the printings accepted by the layout filter of a requirement.
   *
   * @param {Array<import('../classes/Card.js').Card>} printings - Every printing of one index.
   * @param {string} layout - `any`, `classic` or `fullart`.
   * @returns {Array<import('../classes/Card.js').Card>} The matching printings.
   */
  static filterPrintings(printings, layout) {
    return printings.filter((card) => {
      if (layout === TROPHY_CARD_TYPES.CLASSIC) return card.style === 'classic';
      if (layout === TROPHY_CARD_TYPES.FULL_ART) return card.style === 'fullart';
      return true;
    });
  }

  /**
   * Resolves the printing to show for one required card index.
   *
   * The owned printing wins, so a satisfied requirement is illustrated by the exact card the
   * player drew; otherwise the first printing accepted by the layout filter is displayed (in black
   * and white, since it is not owned yet). The `Card` instance is kept as-is — and not a name — so
   * the detail modal can translate it into the language active when it is opened.
   *
   * @param {object} set - Extension context (`printingsByIndex`).
   * @param {string} cardIndex - Normalized index (`SERIE-A1 _ D019`).
   * @param {string} layout - `any`, `classic` or `fullart`.
   * @param {Set<string>} ownedKeys - Owned collection keys.
   * @returns {{index: string, card: import('../classes/Card.js').Card|null, owned: boolean, layout: string}}
   *   The display entry of a `CardList` requirement. `layout` is repeated on every entry (it is
   *   declared per trophy in the file) so a reader of the entry — `GameNotifier`, which counts the
   *   printings a card actually satisfies — never has to look the requirement up again.
   */
  static resolveRequiredCard(set, cardIndex, layout, ownedKeys) {
    const everyPrinting = set.printingsByIndex.get(cardIndex) ?? [];
    const matching = TrophyManager.filterPrintings(everyPrinting, layout);
    const ownedCard = matching.find((card) => ownedKeys.has(card.uniqueKey)) ?? null;
    return {
      index: cardIndex,
      card: ownedCard ?? matching[0] ?? everyPrinting[0] ?? null,
      owned: ownedCard !== null,
      layout,
    };
  }

  /**
   * Creates the trophy state when the account does not have one yet.
   *
   * Called once at boot, next to `ProfileManager.ensureState()`: the state is then part of the next
   * `.save` export even for a brand new account that has not unlocked anything yet.
   *
   * @returns {Promise<boolean>} True when the default state was written.
   * @throws {Error} When the read or the write fails.
   */
  async ensureState() {
    if (await storageRepository.hasUserState(TROPHIES_STATE_KEY)) return false;
    await storageRepository.setUserState(TROPHIES_STATE_KEY, buildDefaultTrophyState());
    this.log('Default trophy state created.');
    return true;
  }

  /**
   * Reads the persisted trophy state.
   *
   * @returns {Promise<{unlocked: Record<string, {unlockedAt: string|null, experience: number}>}>}
   *   The normalized state.
   * @throws {Error} When the read fails.
   */
  async readState() {
    const raw = await storageRepository.getItem(STORES.USER_STATE, TROPHIES_STATE_KEY);
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const unlocked = {};
    const entries = source.unlocked && typeof source.unlocked === 'object' ? source.unlocked : {};
    Object.entries(entries).forEach(([id, value]) => {
      if (typeof id !== 'string' || id.trim() === '') return;
      const record = value && typeof value === 'object' ? value : {};
      unlocked[id] = {
        unlockedAt: typeof record.unlockedAt === 'string' ? record.unlockedAt : null,
        experience: Number.isInteger(record.experience) && record.experience > 0 ? record.experience : 0,
      };
    });
    return { unlocked };
  }

  /**
   * Evaluates the catalogue, persists the newly unlocked trophies and computes the level.
   *
   * @param {object} [options] - Evaluation options.
   * @param {boolean} [options.notify=true] - Emit `TROPHY_UNLOCKED` (the UI announces the new ones).
   * @returns {Promise<{trophies: object[], unlocked: object[], unlockedIds: string[], newlyUnlocked: object[], experience: number, level: object, experiencePerTrophy: Record<string, number>, counters: object}>}
   *   The full trophy state of the account.
   * @throws {Error} When a catalogue file or the storage cannot be read/written.
   */
  async evaluate({ notify = true } = {}) {
    const [catalog, context] = await Promise.all([this.loadCatalog(), this.buildContext()]);
    const stored = await this.readState();

    const trophies = this.buildTrophies(catalog, context, stored.unlocked);
    const newlyUnlocked = trophies.filter(
      (trophy) => trophy.unlocked && !Object.prototype.hasOwnProperty.call(stored.unlocked, trophy.id)
    );

    if (newlyUnlocked.length > 0) {
      const timestamp = buildCollectionTimestamp();
      const next = { ...stored.unlocked };
      newlyUnlocked.forEach((trophy) => {
        next[trophy.id] = {
          unlockedAt: timestamp,
          experience: TrophyManager.resolveExperience(trophy, context.experiencePerTrophy),
        };
      });
      await storageRepository.setUserState(TROPHIES_STATE_KEY, { unlocked: next });
      this.log(`Unlocked ${newlyUnlocked.length} trophy(ies): ${newlyUnlocked.map((t) => t.id).join(', ')}.`);
      if (notify) {
        eventBus.emit(EVENTS.TROPHY_UNLOCKED, { trophies: newlyUnlocked });
      }
    }

    const unlockedIds = trophies.filter((trophy) => trophy.unlocked).map((trophy) => trophy.id);
    const experience = TrophyManager.computeExperience(trophies, unlockedIds, stored.unlocked, context);
    const level = TrophyManager.resolveLevel(experience, context.levelling);

    if (notify || newlyUnlocked.length > 0) {
      eventBus.emit(EVENTS.EXPERIENCE_UPDATED, { experience, level });
    }

    return {
      trophies,
      unlocked: trophies.filter((trophy) => trophy.unlocked),
      unlockedIds,
      newlyUnlocked,
      experience,
      level,
      experiencePerTrophy: context.experiencePerTrophy,
      counters: {
        unlocked: unlockedIds.length,
        total: trophies.length,
        boostersOpened: context.boostersOpened,
        distinctOwned: context.distinctOwned,
        totalCards: context.totalCards,
      },
    };
  }

  /**
   * Computes the total experience of the account.
   *
   * @param {object[]} trophies - Evaluated trophies.
   * @param {string[]} unlockedIds - Ids of the unlocked trophies.
   * @param {Record<string, {experience: number}>} stored - Persisted unlock records.
   * @param {object} context - Reading context.
   * @returns {number} The total experience.
   */
  static computeExperience(trophies, unlockedIds, stored, context) {
    const { experience } = context.levelling;
    const byId = new Map(trophies.map((trophy) => [trophy.id, trophy]));

    let total =
      context.boostersOpened * experience.everyBooster + context.distinctOwned * experience.everyDistinctCard;

    // The name only counts when the player actually chose one (anything different from the
    // configured default name), so an untouched profile earns nothing.
    const name = typeof context.profile?.name === 'string' ? context.profile.name.trim() : '';
    if (name !== '' && name !== context.defaultName) {
      total += experience.nameChanged;
    }

    unlockedIds.forEach((id) => {
      const trophy = byId.get(id);
      total += trophy
        ? TrophyManager.resolveExperience(trophy, context.experiencePerTrophy)
        : stored?.[id]?.experience ?? 0;
    });

    return total;
  }

  /**
   * Resolves the level and the progress inside it.
   *
   * The requirement to move from level L to L+1 is `baseRequiredExpToLevelUp` +
   * `(L - defaultLevel) × incrementRequiredXpBy`, so every level asks for a bit more than the
   * previous one.
   *
   * @param {number} experience - Total experience.
   * @param {{defaultLevel: number, baseRequiredExpToLevelUp: number, incrementRequiredXpBy: number}} levelling
   *   The configured curve.
   * @returns {{level: number, experience: number, levelStart: number, levelEnd: number, required: number, progress: number, previousLevelsXp: number}}
   *   The level and the bounds of its bar.
   */
  static resolveLevel(experience, levelling) {
    const safeExperience = Number.isFinite(experience) && experience > 0 ? Math.floor(experience) : 0;
    const defaultLevel = Math.max(1, levelling.defaultLevel);
    const base = Math.max(1, levelling.baseRequiredExpToLevelUp);
    const increment = Math.max(0, levelling.incrementRequiredXpBy);

    let level = defaultLevel;
    let levelStart = 0;
    let required = base;
    while (safeExperience >= levelStart + required) {
      levelStart += required;
      level += 1;
      required = base + (level - defaultLevel) * increment;
    }

    const progress = required > 0 ? (safeExperience - levelStart) / required : 0;
    return {
      level,
      experience: safeExperience,
      levelStart,
      levelEnd: levelStart + required,
      required,
      progress: Math.max(0, Math.min(progress, 1)),
    };
  }

  /**
   * Performs a silent evaluation (no event, no announcement).
   *
   * @returns {Promise<object>} The evaluated state.
   * @throws {Error} When the evaluation fails.
   */
  async getSummary() {
    return this.evaluate({ notify: false });
  }

  /**
   * Removes the event subscriptions (used by a full reset and by an imported save).
   *
   * @returns {void}
   */
  destroy() {
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers = [];
    this.isBound = false;
    this.catalog = null;
  }
}

/** Shared instance used by the profile view and by `app.js`. */
export const trophyManager = new TrophyManager();

export default trophyManager;

/**
 * CraftManager - The crafting table: its recipes, its grid matching and what a craft grants.
 *
 * Reference: `settings/crafts.json` (the recipes), `js/UI/views/CraftView.js` (the screen) and
 * `js/business/MiningManager.js` (the resources the player places in the grid).
 *
 * WHAT A RECIPE IS
 * A recipe is an id, a 3 x 3 grid of mining-resource slugs (null for an empty slot) and a result.
 * The grid is matched on its BOUNDING BOX: the empty rows and columns around the placed items are
 * ignored, so the same recipe works anywhere in the table, exactly like a Minecraft shaped recipe.
 * The result is either an inventory item (`pearl`, `golden_pickaxe`), Sparks, or a mining resource.
 *
 * A CRAFT IS ONE TRANSACTION
 * The ingredients are spent (`MiningManager.spendResources`), the result is granted
 * (`EnderPearlManager.grantPearls`, `GoldenPickaxeManager.grant`, `SparksManager.addSparks` or
 * `MiningManager.grantResources`) and
 * the `stats.itemsCrafted` / `stats.craftedByResult` counters are raised in the SAME
 * `user_state` transaction: a failure can never take the ingredients without leaving the result
 * behind, which a save-level check would not survive a mid-write failure.
 *
 * The transactions of the other managers are joined through their `context` parameter, so nothing
 * is announced before the commit: this module publishes `CRAFT_UPDATED` (plus `SPARKS_UPDATED`,
 * `PEARLS_UPDATED` and `MINING_UPDATED` for what it actually granted) once the write landed.
 */

import { storageRepository, STORES } from '../models/StorageRepository.js';
import { USER_STATE_KEYS } from './AccountManager.js';
import miningManager, { RESOURCE_TEXTURE_DIRECTORY } from './MiningManager.js';
import sparksManager, { SPARKS_SOURCES } from './SparksManager.js';
import enderPearlManager, { PEARL_ITEM_ID, PEARL_TEXTURE } from './EnderPearlManager.js';
import goldenPickaxeManager, {
  GOLDEN_PICKAXE_ITEM_ID,
  GOLDEN_PICKAXE_TEXTURE,
} from './GoldenPickaxeManager.js';
import eventBus, { EVENTS } from '../utils/EventBus.js';

/** Path of the recipe file, relative to the application root. */
export const CRAFT_CONFIG_PATH = 'settings/crafts.json';

/** Side of the crafting grid (a Minecraft crafting table is 3 x 3). */
export const CRAFT_GRID_SIZE = 3;

/** Number of slots of the crafting grid. */
export const CRAFT_GRID_SLOTS = CRAFT_GRID_SIZE * CRAFT_GRID_SIZE;

/** Highest number a stack displays: a stock above it is drawn as 64, like a full Minecraft stack. */
export const CRAFT_MAX_STACK = 64;

/** Kinds of result a recipe may grant. */
export const CRAFT_RESULT_TYPES = Object.freeze({
  /** An item of `user_state["items"]` (`pearl`, `golden_pickaxe`). */
  ITEM: 'item',
  /** Sparks credited to the balance. */
  SPARKS: 'sparks',
  /** A mining resource added back to the mine's stock. */
  RESOURCE: 'resource',
});

/** Stable error codes, so the view never parses a message. */
export const CRAFT_ERRORS = Object.freeze({
  LOAD: 'LOAD',
  UNKNOWN_RECIPE: 'UNKNOWN_RECIPE',
  INVALID_GRID: 'INVALID_GRID',
  UNSUPPORTED_RESULT: 'UNSUPPORTED_RESULT',
});

/** i18n keys of the error codes, so the view never invents its own message. */
const ERROR_MESSAGE_KEYS = Object.freeze({
  [CRAFT_ERRORS.LOAD]: 'craft.error.load',
  [CRAFT_ERRORS.UNKNOWN_RECIPE]: 'craft.error.recipe',
  [CRAFT_ERRORS.INVALID_GRID]: 'craft.error.grid',
  [CRAFT_ERRORS.UNSUPPORTED_RESULT]: 'craft.error.craft',
});

/**
 * Returns the i18n key describing a crafting error code.
 *
 * @param {unknown} code - Error code (`CRAFT_ERRORS`).
 * @returns {string} The translation key, falling back to the generic one.
 */
export function getCraftErrorMessageKey(code) {
  return ERROR_MESSAGE_KEYS[code] ?? 'craft.error.craft';
}

/** Raised by every refused crafting operation, with a stable `code`. */
export class CraftError extends Error {
  /**
   * @param {string} code - One of `CRAFT_ERRORS`.
   * @param {string} message - Technical description (logged, not shown to the player).
   * @param {object} [options] - Native `Error` options (a `cause`).
   */
  constructor(code, message, options = undefined) {
    super(message, options);
    this.name = 'CraftError';
    this.code = code;
  }
}

/**
 * Reads a result quantity as a positive integer (1 when the value is unusable).
 *
 * @param {unknown} value - Raw value.
 * @returns {number} The quantity.
 */
function readQuantity(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 1;
}

/**
 * Normalizes the 9 slots of a grid (flat, or 3 rows of 3).
 *
 * @param {unknown} raw - Flat array of item ids, or rows of cells.
 * @returns {Array<string|null>} The 9 slots.
 */
function normalizeSlots(raw) {
  const flat = Array.isArray(raw) && Array.isArray(raw[0]) ? raw.flat() : raw;
  const slots = Array.isArray(flat) ? flat.slice(0, CRAFT_GRID_SLOTS) : [];
  while (slots.length < CRAFT_GRID_SLOTS) slots.push(null);
  return slots.map((cell) => (typeof cell === 'string' && cell.trim() !== '' ? cell.trim() : null));
}

/**
 * Normalizes a grid read from the settings (3 rows of 3 cells).
 *
 * @param {unknown} raw - Raw grid.
 * @returns {Array<string|null>|null} The flat grid, or null when the shape is not 3 x 3.
 */
export function normalizeCraftGrid(raw) {
  if (!Array.isArray(raw) || raw.length !== CRAFT_GRID_SIZE) return null;
  if (!raw.every((row) => Array.isArray(row) && row.length === CRAFT_GRID_SIZE)) return null;
  return normalizeSlots(raw);
}

/**
 * Trims the empty rows and columns around the items of a grid.
 *
 * @param {Array<string|null>} slots - Flat 3 x 3 grid.
 * @returns {{top: number, left: number, rows: number, columns: number,
 *   cells: Array<string|null>}|null} The bounding box, or null when the grid is empty.
 */
export function trimCraftGrid(slots) {
  const grid = normalizeSlots(slots);
  let top = CRAFT_GRID_SIZE;
  let left = CRAFT_GRID_SIZE;
  let bottom = -1;
  let right = -1;

  grid.forEach((cell, index) => {
    if (cell === null) return;
    const row = Math.floor(index / CRAFT_GRID_SIZE);
    const column = index % CRAFT_GRID_SIZE;
    top = Math.min(top, row);
    left = Math.min(left, column);
    bottom = Math.max(bottom, row);
    right = Math.max(right, column);
  });

  if (bottom === -1) return null;

  const cells = [];
  for (let row = top; row <= bottom; row += 1) {
    for (let column = left; column <= right; column += 1) {
      cells.push(grid[row * CRAFT_GRID_SIZE + column]);
    }
  }
  return { top, left, rows: bottom - top + 1, columns: right - left + 1, cells };
}

/**
 * Tells whether a grid holds exactly the shape of a recipe.
 *
 * @param {Array<string|null>} expected - Recipe grid (flat).
 * @param {Array<string|null>} slots - Grid filled by the player (flat).
 * @returns {boolean} True when both bounding boxes hold the same items in the same order.
 */
export function craftGridMatches(expected, slots) {
  const wanted = trimCraftGrid(expected);
  const placed = trimCraftGrid(slots);
  if (!wanted || !placed) return false;
  if (wanted.rows !== placed.rows || wanted.columns !== placed.columns) return false;
  return wanted.cells.every((cell, index) => cell === placed.cells[index]);
}

export class CraftManager {
  constructor() {
    /** @type {Array<{id: string, grid: Array<string|null>, result: object}>|null} Loaded recipes. */
    this.recipes = null;
    /** @type {string[]|null} Slugs of the resources of the mine, in the order of the mine file. */
    this.resources = null;
    /** @type {Promise<void>|null} In-flight load, shared by every caller. */
    this.loading = null;
  }

  /**
   * Logs with the manager prefix.
   *
   * @param {...unknown} args - Values forwarded to `console.info`.
   * @returns {void}
   */
  log(...args) {
    console.info('[CraftManager]', ...args);
  }

  /**
   * Loads the recipes and the resources once, then resolves immediately.
   *
   * @returns {Promise<void>} Resolves once the catalogue is readable.
   * @throws {CraftError} With `LOAD` when the files cannot be read.
   */
  async init() {
    if (this.recipes) return;
    if (!this.loading) {
      this.loading = this.loadCatalog().catch((error) => {
        this.loading = null;
        throw error;
      });
    }
    await this.loading;
  }

  /**
   * Fetches and validates the two files the crafting table reads.
   *
   * @returns {Promise<void>} Resolves once `recipes` and `resources` are filled.
   * @throws {CraftError} With `LOAD` when a file is missing or invalid.
   */
  async loadCatalog() {
    let config;
    let miningResources;
    try {
      // `listResources()` reads the mine file the configuration names and leaves the Sparks out:
      // the currency never enters the crafting grid, and the row of the hotbar is the mine's stock.
      [config, miningResources] = await Promise.all([
        CraftManager.fetchJson(CRAFT_CONFIG_PATH),
        miningManager.listResources(),
      ]);
    } catch (error) {
      throw new CraftError(CRAFT_ERRORS.LOAD, `Unable to read ${CRAFT_CONFIG_PATH}.`, { cause: error });
    }

    this.resources = miningResources.map((resource) => resource.slug);
    const known = new Set(this.resources);
    const seen = new Set();
    const recipes = [];

    const entries = Array.isArray(config?.Crafts) ? config.Crafts : [];
    entries.forEach((entry, index) => {
      const id = typeof entry?.Id === 'string' ? entry.Id.trim() : '';
      const grid = normalizeCraftGrid(entry?.Grid);
      const type = typeof entry?.Result?.Type === 'string' ? entry.Result.Type.trim().toLowerCase() : '';
      const resultId = typeof entry?.Result?.Id === 'string' ? entry.Result.Id.trim() : '';

      if (id === '' || seen.has(id) || !grid) {
        console.warn(`[CraftManager] Recipe #${index} has no usable id or grid, it is ignored.`);
        return;
      }
      // Ingredients are the resources of the mine: a slug the mine does not produce would make a
      // recipe no player can ever fill.
      if (grid.some((cell) => cell !== null && !known.has(cell))) {
        console.warn(`[CraftManager] Recipe "${id}" uses an unknown resource, it is ignored.`);
        return;
      }
      if (!Object.values(CRAFT_RESULT_TYPES).includes(type)) {
        console.warn(`[CraftManager] Recipe "${id}" has an unknown result type, it is ignored.`);
        return;
      }
      if (type === CRAFT_RESULT_TYPES.ITEM && resultId === '') {
        console.warn(`[CraftManager] Recipe "${id}" names no item, it is ignored.`);
        return;
      }
      if (type === CRAFT_RESULT_TYPES.RESOURCE && !known.has(resultId)) {
        console.warn(`[CraftManager] Recipe "${id}" grants an unknown resource, it is ignored.`);
        return;
      }

      seen.add(id);
      recipes.push({
        id,
        grid,
        result: {
          type,
          // The Sparks have no id in the file: they are named `sparks` everywhere else (the icon,
          // the label and the `stats.craftedByResult` key), so the reading fills it in once.
          id: type === CRAFT_RESULT_TYPES.SPARKS ? 'sparks' : resultId,
          quantity: readQuantity(entry?.Result?.Quantity),
        },
      });
    });

    if (recipes.length === 0) {
      throw new CraftError(CRAFT_ERRORS.LOAD, `${CRAFT_CONFIG_PATH} declares no usable recipe.`);
    }

    this.recipes = recipes;
    this.log(`${recipes.length} recipe(s) loaded, ${this.resources.length} resource(s) in the hotbar.`);
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
    const response = await fetch(normalized, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Unable to fetch "${normalized}" (HTTP ${response.status}).`);
    }
    return response.json();
  }

  /**
   * Returns the recipes, loaded on first use.
   *
   * @returns {Promise<Array<{id: string, grid: Array<string|null>, result: object}>>} The recipes.
   * @throws {CraftError} With `LOAD` when the file cannot be read.
   */
  async getRecipes() {
    await this.init();
    return this.recipes;
  }

  /**
   * Returns the resource slugs of the mine, in the order of `settings/mining.json`.
   *
   * @returns {Promise<string[]>} The slugs, which are what the hotbar places in the grid.
   * @throws {CraftError} With `LOAD` when the files cannot be read.
   */
  async getResources() {
    await this.init();
    return this.resources;
  }

  /**
   * Finds the recipe a grid satisfies.
   *
   * Synchronous on purpose: the view calls it on every slot change, and the catalogue is already
   * loaded by then (`getRecipes()` / `getResources()`). An unloaded catalogue simply matches
   * nothing instead of returning a promise the renderer cannot await.
   *
   * @param {Array<string|null>} slots - The 9 slots of the table.
   * @returns {{id: string, grid: Array<string|null>, result: object}|null} The recipe, or null.
   */
  match(slots) {
    if (!this.recipes) return null;
    return this.recipes.find((recipe) => craftGridMatches(recipe.grid, slots)) ?? null;
  }

  /**
   * Crafts a recipe: spends the ingredients, grants the result and raises the statistics.
   *
   * The grid is checked again here, so a tampered view cannot craft something else than what the
   * catalogue declares.
   *
   * @param {string} recipeId - Id of the recipe to craft.
   * @param {Array<string|null>} slots - The 9 slots of the table.
   * @returns {Promise<{recipe: object, result: object, totalCrafted: number, sparks: number|null,
   *   pearls: number|null, goldenPickaxes: number|null}>} What was crafted and the balances it
   *   changed.
   * @throws {CraftError} With `UNKNOWN_RECIPE`, `INVALID_GRID` or `UNSUPPORTED_RESULT`.
   * @throws {import('./MiningManager.js').MiningError} With `INSUFFICIENT_RESOURCES` when the grid
   *   holds more than the stock of the mine.
   * @throws {Error} When the write fails.
   */
  async craft(recipeId, slots) {
    await this.init();
    const recipe = this.recipes.find((entry) => entry.id === recipeId);
    if (!recipe) {
      throw new CraftError(CRAFT_ERRORS.UNKNOWN_RECIPE, `Unknown recipe "${recipeId}".`);
    }
    const grid = normalizeSlots(slots);
    if (!craftGridMatches(recipe.grid, grid)) {
      throw new CraftError(CRAFT_ERRORS.INVALID_GRID, `The grid does not match recipe "${recipeId}".`);
    }

    const cost = {};
    grid.forEach((cell) => {
      if (cell === null) return;
      cost[cell] = (cost[cell] ?? 0) + 1;
    });

    const outcome = await storageRepository.transaction(
      STORES.USER_STATE,
      'readwrite',
      async (context) => {
        // Payment first: it throws (`INSUFFICIENT_RESOURCES`) before anything is granted, and the
        // whole transaction is rolled back with it.
        await miningManager.spendResources(cost, context);

        let sparks = null;
        let pearls = null;
        let goldenPickaxes = null;
        if (recipe.result.type === CRAFT_RESULT_TYPES.SPARKS) {
          sparks = await sparksManager.addSparks(recipe.result.quantity, context, SPARKS_SOURCES.CRAFT);
        } else if (recipe.result.type === CRAFT_RESULT_TYPES.RESOURCE) {
          await miningManager.grantResources(
            { [recipe.result.id]: recipe.result.quantity },
            context
          );
        } else if (recipe.result.id === PEARL_ITEM_ID) {
          pearls = await enderPearlManager.grantPearls(recipe.result.quantity, context);
        } else if (recipe.result.id === GOLDEN_PICKAXE_ITEM_ID) {
          goldenPickaxes = await goldenPickaxeManager.grant(recipe.result.quantity, context);
        } else {
          throw new CraftError(
            CRAFT_ERRORS.UNSUPPORTED_RESULT,
            `No grant is implemented for the item "${recipe.result.id}".`
          );
        }

        // One crafted ITEM per granted item (a recipe may give several), and ONE for a batch of
        // Sparks: the currency is not an item, so a craft of 50 Sparks must not count as 50 items.
        const craftedCount =
          recipe.result.type === CRAFT_RESULT_TYPES.SPARKS ? 1 : recipe.result.quantity;
        const stored = await context.get(STORES.USER_STATE, USER_STATE_KEYS.STATS);
        const stats = stored && typeof stored === 'object' && !Array.isArray(stored) ? { ...stored } : {};
        const previousTotal =
          Number.isInteger(stats.itemsCrafted) && stats.itemsCrafted > 0 ? stats.itemsCrafted : 0;
        const byResult =
          stats.craftedByResult && typeof stats.craftedByResult === 'object' && !Array.isArray(stats.craftedByResult)
            ? { ...stats.craftedByResult }
            : {};
        const resultKey = CraftManager.resultKey(recipe.result);
        const previousResult =
          Number.isInteger(byResult[resultKey]) && byResult[resultKey] > 0 ? byResult[resultKey] : 0;
        byResult[resultKey] = previousResult + craftedCount;
        stats.craftedByResult = byResult;
        stats.itemsCrafted = previousTotal + craftedCount;
        await context.put(STORES.USER_STATE, stats, USER_STATE_KEYS.STATS);

        return { sparks, pearls, goldenPickaxes, totalCrafted: stats.itemsCrafted, craftedCount };
      }
    );

    // The write is committed: the screens and the trophies follow from here.
    eventBus.emit(EVENTS.CRAFT_UPDATED, {
      recipeId: recipe.id,
      result: { ...recipe.result },
      crafted: outcome.craftedCount,
      total: outcome.totalCrafted,
    });
    await this.publishBalances(outcome);
    this.log(`Crafted "${recipe.id}" (${outcome.totalCrafted} result(s) in total).`);

    return {
      recipe,
      result: { ...recipe.result },
      totalCrafted: outcome.totalCrafted,
      sparks: outcome.sparks,
      pearls: outcome.pearls,
      goldenPickaxes: outcome.goldenPickaxes,
    };
  }

  /**
   * Announces what a committed craft changed outside of the crafting table.
   *
   * @param {{sparks: number|null, pearls: number|null, goldenPickaxes: number|null}} outcome - Result
   *   of the transaction.
   * @returns {Promise<void>} Resolves once the events are emitted.
   */
  async publishBalances({ sparks, pearls, goldenPickaxes }) {
    const mining = await miningManager.getState();
    eventBus.emit(EVENTS.MINING_UPDATED, {
      day: mining.day,
      minedToday: mining.minedToday,
      remaining: mining.remaining,
      blocksPerDay: mining.blocksPerDay,
      totalMined: mining.totalMined,
    });
    if (Number.isInteger(sparks)) {
      eventBus.emit(EVENTS.SPARKS_UPDATED, { balance: sparks });
    }
    if (Number.isInteger(pearls)) {
      eventBus.emit(EVENTS.PEARLS_UPDATED, { count: pearls });
    }
    if (Number.isInteger(goldenPickaxes)) {
      eventBus.emit(EVENTS.GOLDEN_PICKAXES_UPDATED, { count: goldenPickaxes });
    }
  }

  /**
   * Key a result is counted under in `stats.craftedByResult`.
   *
   * @param {{type: string, id: string}} result - Result of a recipe.
   * @returns {string} `pearl`, `sparks` or the resource slug.
   */
  static resultKey(result) {
    return result.type === CRAFT_RESULT_TYPES.SPARKS ? 'sparks' : result.id;
  }

  /**
   * Icon of an item that can be placed in the grid or received from it.
   *
   * @param {string} id - Resource slug, `pearl`, `golden_pickaxe` or `sparks`.
   * @returns {string} The picture path.
   */
  static itemIcon(id) {
    if (id === 'sparks') return 'assets/img/sparks.png';
    if (id === PEARL_ITEM_ID) return PEARL_TEXTURE;
    if (id === GOLDEN_PICKAXE_ITEM_ID) return GOLDEN_PICKAXE_TEXTURE;
    return `${RESOURCE_TEXTURE_DIRECTORY}/${id}.png`;
  }
}

/** Shared instance used by the crafting table. */
export const craftManager = new CraftManager();

export default craftManager;

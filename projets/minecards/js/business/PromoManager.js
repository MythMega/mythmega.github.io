/**
 * PromoManager - Loads the promo card catalogue (`data/promo_cards/*.json`).
 *
 * THE PROMO CARDS ARE NOT DRAWABLE. They never belong to a booster extension and no rarity
 * table knows about them: they only enter the collection through a redeem code or a gift
 * (step 7/step 8 distributions), which is what `RedeemManager` and `GiftManager` ask this
 * module for. Consequently:
 *   - `BoosterManager` never reads these files, so an opening can never draw one;
 *   - the collection view lists them ONLY when they are owned, and they are excluded from
 *     every completion ratio (see `CollectionManager`).
 *
 * FILE NAMING. One file per group, named after the series it decorates: `A1.json` holds the
 * promos of the `A1` extension. The group id exposed to the rest of the application is that
 * name suffixed with `-Promo` (`A1-Promo`), which keeps a promo card out of its parent
 * extension's completion while still naming where it comes from. `data/promo_cards/A1.json`
 * therefore describes the `A1-Promo` group, exactly as `data/boosters/A1.json` describes `A1`.
 *
 * PAYLOAD SHAPE. Two shapes are accepted, in the same spirit as `Card.fromAnySchema`:
 *   - a bare array of card entries, which is what the shipped example uses;
 *   - the booster-schema object `{ Serie, Name, Cards: [...] }`, for a generated file.
 * A missing file is NOT an error: an extension that ships no promo simply has none. The load
 * is cached (the files ship with the application and never change while the page is open).
 */

import { configLoader } from '../utils/ConfigLoader.js';
import boosterManager from './BoosterManager.js';
import GachaEngine from './GachaEngine.js';

/** Directory holding the promo files, relative to the application root. */
export const PROMO_DIRECTORY = 'data/promo_cards';

/** Suffix appended to the parent series id to build a promo group id (`A1` -> `A1-Promo`). */
export const PROMO_SET_SUFFIX = '-Promo';

/**
 * Word appended to the parent extension name in the promo group label ("Genesis Blocks · Promo").
 *
 * Deliberately a neutral literal rather than a translation key: the two shipped languages spell
 * it identically, and a business module has no access to the i18n dictionary.
 */
export const PROMO_LABEL = 'Promo';

/**
 * Builds the group id of a promo file.
 *
 * @param {string} parentId - File basename / parent series id (e.g. "A1").
 * @returns {string} The promo group id (e.g. "A1-Promo").
 * @throws {TypeError} When the parent id is not a non-empty string.
 */
export function buildPromoSetId(parentId) {
  if (typeof parentId !== 'string' || parentId.trim() === '') {
    throw new TypeError(`A promo set id must be a non-empty string (received: ${JSON.stringify(parentId)}).`);
  }
  const id = parentId.trim();
  return id.toLowerCase().endsWith(PROMO_SET_SUFFIX.toLowerCase()) ? id : `${id}${PROMO_SET_SUFFIX}`;
}

/**
 * Indicates whether a collection/extension id designates a promo group.
 *
 * @param {unknown} setId - Candidate id.
 * @returns {boolean} True for an id ending with the promo suffix.
 */
export function isPromoSetId(setId) {
  return (
    typeof setId === 'string' && setId.trim().toLowerCase().endsWith(PROMO_SET_SUFFIX.toLowerCase())
  );
}

export class PromoManager {
  /**
   * @param {object} [options] - Manager options.
   * @param {object} [options.boosterManager=boosterManager] - Extension loader, used to resolve
   *   the group display name of a series and the default list of promo files.
   * @param {string|null} [options.directory=null] - Overrides the configured directory (tests).
   */
  constructor({ boosterManager: loader = boosterManager, directory = null } = {}) {
    if (!loader || typeof loader.init !== 'function' || typeof loader.listBoosterSets !== 'function') {
      throw new TypeError('PromoManager requires a BoosterManager-like loader.');
    }

    /** @type {object} Extension loader (parent names and default file list). */
    this.loader = loader;
    /** @type {string|null} Directory override; when null the configured one is used. */
    this.directoryOverride = directory;
    /** @type {Record<string, object>} Cache of the loaded promo groups, keyed by group id. */
    this.promoSets = {};
    /** @type {string} Directory actually used by the last load. */
    this.directory = directory ?? PROMO_DIRECTORY;
    /** @type {Promise<object>|null} In-flight load, used to de-duplicate concurrent calls. */
    this.loadPromise = null;
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
    console.info('[PromoManager]', ...args);
  }

  /**
   * Loads every declared promo file.
   *
   * Loaded only once: the files ship with the application and never change while the page is
   * open. A file that is missing, unreadable or invalid is skipped with a warning - promos are a
   * bonus catalogue and must never prevent the collection from rendering.
   *
   * @param {object} [options] - Load options.
   * @param {boolean} [options.force=false] - Reload even when already cached.
   * @returns {Promise<{sets: string[]}>} The loaded promo group ids.
   * @throws {Error} When `settings/config.json` cannot be read.
   */
  async init({ force = false } = {}) {
    if (this.isInitialized && !force) return { sets: Object.keys(this.promoSets) };
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
   * Performs the actual loading work of `init()`.
   *
   * @returns {Promise<{sets: string[]}>} The loaded promo group ids.
   * @throws {Error} When `settings/config.json` cannot be read.
   */
  async loadAll() {
    const { directory, sets } = await configLoader.getPromoSettings();
    this.directory = this.directoryOverride ?? directory;
    this.promoSets = {};

    // The parent names come from the extension files: a promo group is displayed with the name
    // of the series it decorates, so both always agree.
    const parentNames = new Map();
    if (sets.length > 0) {
      await this.loader.init();
      for (const descriptor of await this.loader.listBoosterSets()) {
        parentNames.set(descriptor.setId, descriptor.name ?? descriptor.setId);
      }
    }

    for (const parentId of sets) {
      const groupId = buildPromoSetId(parentId);
      const path = `${this.directory}/${parentId}.json`;
      const payload = await PromoManager.fetchOptionalJson(path);
      if (!payload) continue;

      try {
        const entries = PromoManager.getRawEntries(payload);
        if (entries.length === 0) {
          console.warn(`[PromoManager] "${path}" declares no promo card: the group is skipped.`);
          continue;
        }
        const declaredId = PromoManager.readDeclaredId(payload);
        if (declaredId && declaredId !== parentId) {
          throw new Error(
            `the file declares the identifier "${declaredId}" while its name is "${parentId}"`
          );
        }

        const cards = GachaEngine.parseCards({ cards: entries }, { setId: groupId });
        const parentName = parentNames.get(parentId) ?? PromoManager.readDeclaredName(payload) ?? parentId;
        this.promoSets[groupId] = {
          setId: groupId,
          parentSetId: parentId,
          name: `${parentName} · ${PROMO_LABEL}`,
          cards,
          raw: entries,
        };
      } catch (error) {
        console.warn(`[PromoManager] "${path}" could not be loaded: ${error.message}`);
      }
    }

    const ids = Object.keys(this.promoSets);
    const cardCount = ids.reduce((sum, id) => sum + this.promoSets[id].cards.length, 0);
    this.log(
      ids.length === 0
        ? 'No promo card found.'
        : `Loaded ${cardCount} promo card(s) in ${ids.length} group(s): ${ids.join(', ')}.`
    );
    return { sets: ids };
  }

  /**
   * Reads the card entries of a promo payload.
   *
   * @param {unknown} payload - Parsed promo JSON.
   * @returns {Array<object>} The raw card entries (`[]` when the payload holds none).
   */
  static getRawEntries(payload) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== 'object') return [];
    const entries = payload.Cards ?? payload.cards;
    return Array.isArray(entries) ? entries : [];
  }

  /**
   * Reads the series identifier declared by a wrapped payload, when it declares one.
   *
   * @param {unknown} payload - Parsed promo JSON.
   * @returns {string|null} The declared identifier, or null for a bare array.
   */
  static readDeclaredId(payload) {
    if (Array.isArray(payload) || !payload || typeof payload !== 'object') return null;
    const candidate = payload.Serie ?? payload.serie ?? payload.setId ?? payload.id;
    if (typeof candidate === 'number') return String(candidate);
    return typeof candidate === 'string' && candidate.trim() !== '' ? candidate.trim() : null;
  }

  /**
   * Reads the display name declared by a wrapped payload, when it declares one.
   *
   * @param {unknown} payload - Parsed promo JSON.
   * @returns {string|null} The declared name, or null.
   */
  static readDeclaredName(payload) {
    if (Array.isArray(payload) || !payload || typeof payload !== 'object') return null;
    return typeof payload.Name === 'string' && payload.Name.trim() !== '' ? payload.Name.trim() : null;
  }

  /**
   * Fetches a JSON file that is allowed to be absent.
   *
   * A 404 (an extension without promos) is the expected case and stays silent; any other failure
   * is a warning, never a rejection: a broken promo file must not break the collection.
   *
   * @param {string} path - Path relative to the application root.
   * @returns {Promise<object|Array|null>} The parsed payload, or null when unusable.
   */
  static async fetchOptionalJson(path) {
    const normalized = String(path).replace(/^\.\//, '');
    let response;
    try {
      response = await fetch(normalized);
    } catch (error) {
      console.warn(`[PromoManager] "${normalized}" could not be fetched: ${error.message}`);
      return null;
    }
    if (response.status === 404) return null;
    if (!response.ok) {
      console.warn(`[PromoManager] "${normalized}" answered HTTP ${response.status}: it is skipped.`);
      return null;
    }
    try {
      return await response.json();
    } catch (error) {
      console.warn(`[PromoManager] "${normalized}" is not valid JSON: ${error.message}`);
      return null;
    }
  }

  /**
   * Lists the loaded promo groups, for the collection view.
   *
   * @returns {Promise<Array<{setId: string, parentSetId: string, name: string, cards: Array, raw: Array}>>}
   *   A lightweight description of every group, `raw` holding the generator entries (needed by the
   *   personal-code catalogue, which keys on `Index` + `Layout`).
   * @throws {Error} See `init()`.
   */
  async listPromoSets() {
    await this.init();
    return Object.values(this.promoSets).map((group) => ({
      setId: group.setId,
      parentSetId: group.parentSetId,
      name: group.name,
      cards: group.cards,
      raw: group.raw,
    }));
  }

  /**
   * Returns one loaded promo group.
   *
   * @param {string} setId - Promo group id (e.g. "A1-Promo").
   * @returns {Promise<object|null>} The group, or null when unknown.
   * @throws {Error} See `init()`.
   */
  async getPromoSet(setId) {
    await this.init();
    if (typeof setId !== 'string') return null;
    return this.promoSets[setId.trim()] ?? null;
  }

  /**
   * Returns every promo card of every group, in declaration order.
   *
   * Used to extend the code/gift catalogues: a promo card is obtainable exactly like a drawn one,
   * it simply is not drawn.
   *
   * @returns {Promise<Array<{card: object, entry: object|null, setId: string}>>} The catalog rows.
   * @throws {Error} See `init()`.
   */
  async getAllCards() {
    const groups = await this.listPromoSets();
    const rows = [];
    for (const group of groups) {
      group.cards.forEach((card, index) => {
        rows.push({ card, entry: group.raw[index] ?? null, setId: group.setId });
      });
    }
    return rows;
  }
}

/** Shared manager built on the application `BoosterManager` singleton. */
export const promoManager = new PromoManager();

export default promoManager;

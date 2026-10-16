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
 *   - the booster-schema object `{ Serie, Name, Card: [...] }`, for a generated file. The list
 *     key is read as `Card`, `Cards` or `cards`, so both spellings of the generator work.
 *
 * `Serie` AND `Name` ARE DISPLAY VALUES, NOT IDENTIFIERS. `Serie` names the PROMO SERIES as the
 * player sees it in the collection filters ("Promo A1"), `Name` is the full title of the series
 * ("Promo Genesis Block"); neither is compared to the file name any more - the file name is what
 * identifies the group, because it is also the folder the illustrations are stored in
 * (`cards/A1-Promo/<lang>/...`). A group therefore carries `label` (from `Serie`) next to `name`
 * (from `Name`), and falls back to "<extension> · Promo" when its file declares neither.
 *
 * A missing file is NOT an error: an extension that ships no promo simply has none. The load
 * is cached (the files ship with the application and never change while the page is open).
 */

import { configLoader } from '../utils/ConfigLoader.js';
import boosterManager from './BoosterManager.js';
import GachaEngine from './GachaEngine.js';
// The id helpers live in a leaf module (no import at all), so `SparksManager` can recognise a promo
// card without this file - and therefore without `BoosterManager` - being pulled in. They are
// re-exported below to keep the historical import path working.
import { buildPromoSetId, isPromoSetId, PROMO_LABEL, PROMO_SET_SUFFIX } from './PromoSet.js';

/** Directory holding the promo files, relative to the application root. */
export const PROMO_DIRECTORY = 'data/promo_cards';

export { buildPromoSetId, isPromoSetId, PROMO_LABEL, PROMO_SET_SUFFIX };

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
        // The file NAME identifies the group (it is the illustration folder, `cards/A1-Promo/`),
        // so the declared `Serie` is a LABEL for the series, never a second identifier to compare:
        // the two are not supposed to match ("Promo A1" vs. the file "A1.json").
        const parentName = parentNames.get(parentId) ?? null;
        const label =
          PromoManager.readDeclaredLabel(payload) ??
          (parentName ? `${parentName} · ${PROMO_LABEL}` : `${parentId} · ${PROMO_LABEL}`);

        const cards = GachaEngine.parseCards({ cards: entries }, { setId: groupId });
        this.promoSets[groupId] = {
          setId: groupId,
          parentSetId: parentId,
          // What the collection filters display, and what the detail shows as the extension.
          label,
          name: PromoManager.readDeclaredName(payload) ?? label,
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
    // `Card` is the spelling of the promo files (`data/promo_cards/*.json`), `Cards` the one of the
    // extension files: both are accepted so a hand-written or generated file never comes out empty.
    const entries = payload.Card ?? payload.Cards ?? payload.cards;
    return Array.isArray(entries) ? entries : [];
  }

  /**
   * Reads the promo series label declared by a wrapped payload, when it declares one.
   *
   * The label is a DISPLAY value ("Promo A1"), used by the collection filters and by the detail
   * modal; the group itself is identified by its file name. `setId` and `id` are still read for a
   * file written with an older payload.
   *
   * @param {unknown} payload - Parsed promo JSON.
   * @returns {string|null} The declared label, or null for a bare array.
   */
  static readDeclaredLabel(payload) {
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
   * @returns {Promise<Array<{setId: string, parentSetId: string, label: string, name: string,
   *   cards: Array, raw: Array}>>}
   *   A lightweight description of every group, `raw` holding the generator entries (needed by the
   *   personal-code catalogue, which keys on `Index` + `Layout`).
   * @throws {Error} See `init()`.
   */
  async listPromoSets() {
    await this.init();
    return Object.values(this.promoSets).map((group) => ({
      setId: group.setId,
      parentSetId: group.parentSetId,
      label: group.label,
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

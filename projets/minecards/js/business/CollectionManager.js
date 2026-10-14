/**
 * CollectionManager - Cross-references the extension JSONs with the `collection` store.
 *
 * Reference: `.docs/steps/5.md` point 1.
 *
 * The extension files (loaded through `BoosterManager`) are the catalog: every `Card` they
 * declare exists, owned or not. The `collection` object store only holds what the player
 * actually drew (`{ key, cardId, style, set, quantity, firstObtainedAt, lastObtainedAt }`).
 * `getCollectionView()` merges both so the views can render the full grid (with silhouettes
 * for the missing cards) and the completion ratios, globally and per extension.
 *
 * PROMO CARDS (`data/promo_cards/<serie>.json`, see `PromoManager`) follow three rules:
 *   1. they are never drawn, so a promo the player does not hold is not listed at all: no
 *      silhouette, no empty slot - the collection only ever shows the promos that were obtained
 *      (through a redeem code or a gift);
 *   2. they are EXCLUDED from every completion counter (`completion` and each extension's), so
 *      the ratios keep measuring the drawable catalogue only;
 *   3. a promo group only appears in `sets` (the extension filter and the per-extension ratios)
 *      once it holds at least one owned card: a player without promos sees the very same
 *      collection as before.
 */

import boosterManager from './BoosterManager.js';
import promoManager from './PromoManager.js';
import { storageRepository, STORES } from '../models/StorageRepository.js';

/**
 * Builds an empty completion counter.
 *
 * @returns {{total: number, owned: number}} A zeroed completion object.
 */
function emptyCompletion() {
  return { total: 0, owned: 0 };
}

/**
 * Builds a collection entry for a card the player never drew.
 *
 * @param {Card} card - Catalog card.
 * @returns {object} The missing entry (`owned: false`, quantity 0).
 */
function buildMissingEntry(card) {
  return {
    key: card.uniqueKey,
    cardId: card.id,
    style: card.style,
    set: card.set,
    rarity: card.rarity,
    card,
    owned: false,
    quantity: 0,
    firstObtainedAt: null,
    lastObtainedAt: null,
  };
}

/**
 * Builds a collection entry for a card the player owns.
 *
 * @param {Card} card - Catalog card.
 * @param {object} record - Raw `collection` row.
 * @param {object} [options] - Entry options.
 * @param {boolean} [options.promo=false] - Marks an entry of the promo catalogue.
 * @returns {object} The owned entry.
 */
function buildOwnedEntry(card, record, { promo = false } = {}) {
  return {
    key: card.uniqueKey,
    cardId: card.id,
    style: card.style,
    set: card.set,
    rarity: card.rarity,
    card,
    promo,
    owned: true,
    quantity: Number.isFinite(record?.quantity) ? record.quantity : 0,
    firstObtainedAt: record?.firstObtainedAt ?? null,
    lastObtainedAt: record?.lastObtainedAt ?? null,
  };
}

export class CollectionManager {
  /**
   * @param {object} [options] - Manager options.
   * @param {object} [options.boosterManager=boosterManager] - Extension loader (defaults to the
   *   application singleton, so the extension JSONs are loaded only once).
   */
  constructor({ boosterManager: loader = boosterManager } = {}) {
    if (!loader || typeof loader.init !== 'function' || typeof loader.getBoosterSet !== 'function') {
      throw new TypeError('CollectionManager requires a BoosterManager-like loader.');
    }

    /** @type {object} Extension loader used as the catalog source. */
    this.loader = loader;
  }

  /**
   * Merges the extension catalogs with the owned rows.
   *
   * Every declared `Card` produces one entry; unknown `collection` rows (a card removed from
   * an extension file since the draw) are appended under `orphans` so no owned card is hidden.
   *
   * The promo catalogue is merged afterwards, owned cards only, without touching a single
   * completion counter (see the module header).
   *
   * @returns {Promise<{entries: object[], orphans: object[], completion: object, sets: object}>}
   *   The full collection view: every entry, the orphan rows, the global completion and the
   *   per-extension completion. A promo group carries `promo: true` in `sets`.
   */
  async getCollectionView() {
    console.info('[CollectionManager] Building the collection view…');
    await this.loader.init();
    const listed = await this.loader.listBoosterSets();
    const ownedRows = await storageRepository.getAll(STORES.COLLECTION);
    const ownedByKey = new Map((ownedRows ?? []).map((row) => [row?.key, row]));

    const entries = [];
    const orphans = [];
    const seenKeys = new Set();
    const completion = emptyCompletion();
    const sets = {};

    for (const listedSet of listed) {
      const set = await this.loader.getBoosterSet(listedSet.setId);
      const setCompletion = emptyCompletion();
      sets[set.setId] = {
        setId: set.setId,
        name: set.name,
        completion: setCompletion,
      };

      for (const card of set.cards ?? []) {
        const record = ownedByKey.get(card.uniqueKey);
        const entry = record ? buildOwnedEntry(card, record) : buildMissingEntry(card);
        entries.push(entry);
        seenKeys.add(card.uniqueKey);
        completion.total += 1;
        setCompletion.total += 1;
        if (entry.owned) {
          completion.owned += 1;
          setCompletion.owned += 1;
        }
      }
    }

    // Promo catalogue: owned cards only, and never counted in a completion ratio.
    for (const group of await this.loadPromoSets()) {
      let ownedInGroup = 0;
      for (const card of group.cards ?? []) {
        // Registered as seen even when not owned: a promo card is a known card, so an owned row
        // must never be reported as an orphan once its file stops being loaded.
        seenKeys.add(card.uniqueKey);
        const record = ownedByKey.get(card.uniqueKey);
        if (!record) continue;
        entries.push(buildOwnedEntry(card, record, { promo: true }));
        ownedInGroup += 1;
      }

      if (ownedInGroup > 0) {
        sets[group.setId] = {
          setId: group.setId,
          name: group.name,
          parentSetId: group.parentSetId,
          promo: true,
          // An empty counter on purpose: a promo group has no completion to report. The views
          // skip these groups when they render the per-extension ratios.
          completion: emptyCompletion(),
        };
      }
    }

    for (const row of ownedRows ?? []) {
      if (!row || seenKeys.has(row.key)) continue;
      orphans.push({
        key: row.key,
        cardId: row.cardId ?? row.key,
        style: row.style ?? null,
        set: row.set ?? null,
        rarity: null,
        card: null,
        owned: true,
        quantity: Number.isFinite(row.quantity) ? row.quantity : 0,
        firstObtainedAt: row.firstObtainedAt ?? null,
        lastObtainedAt: row.lastObtainedAt ?? null,
        orphan: true,
      });
    }

    if (orphans.length > 0) {
      console.warn(`[CollectionManager] ${orphans.length} owned row(s) have no catalog card.`);
    }
    const promoOwned = entries.filter((entry) => entry.promo).length;
    console.info(
      `[CollectionManager] Collection view ready: ${completion.owned}/${completion.total} owned, ` +
        `${promoOwned} promo(s), +${orphans.length} orphan(s).`
    );
    return { entries, orphans, completion, sets };
  }

  /**
   * Loads the promo catalogue without ever failing the collection.
   *
   * A missing, unreadable or invalid promo file is a degraded bonus catalog, never a broken
   * collection: the grid keeps rendering with the drawable cards.
   *
   * @returns {Promise<Array<object>>} The promo groups (empty when the catalogue is unusable).
   */
  async loadPromoSets() {
    try {
      return await promoManager.listPromoSets();
    } catch (error) {
      console.warn('[CollectionManager] The promo cards could not be loaded.', error);
      return [];
    }
  }

  /**
   * Computes the global and per-extension completion ratios.
   *
   * Promo cards are absent from both: they are never drawn, so they cannot be "missing".
   *
   * @returns {Promise<{completion: object, sets: object}>} The completion counters.
   */
  async getCompletion() {
    const view = await this.getCollectionView();
    return { completion: view.completion, sets: view.sets };
  }
}

/** Shared manager built on the application `BoosterManager` singleton. */
const collectionManager = new CollectionManager();

export default collectionManager;

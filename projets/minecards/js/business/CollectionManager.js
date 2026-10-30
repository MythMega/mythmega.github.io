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
 *
 * TWO NUMBERING AXES
 * Every entry carries `cardId` (the `Index` field of the card, "SERIE-A1 / W001") AND `index`
 * (its position in the `Cards` array of its extension file). They are genuinely different: a file
 * groups its cards by theme, so its order is not the order of the `Index` values. The grid offers
 * both as sorts - the file order is the default - and neither is stored: both are recomputed on
 * every `getCollectionView()`, so a reordered or extended file shows up immediately. A third sort
 * follows `firstObtainedAt`, the day the player got their first copy of each card.
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
 * @param {number} index - Position of the card in its extension JSON (`Cards` order).
 * @returns {object} The missing entry (`owned: false`, quantity 0).
 */
function buildMissingEntry(card, index) {
  return {
    key: card.uniqueKey,
    cardId: card.id,
    // The order the extension FILE lists the cards in (see "two numbering axes" above).
    index,
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
 * @param {number} [options.index=0] - Position of the card in its extension JSON (`Cards` order).
 * @returns {object} The owned entry.
 */
function buildOwnedEntry(card, record, { promo = false, index = 0 } = {}) {
  return {
    key: card.uniqueKey,
    cardId: card.id,
    // The order the extension FILE lists the cards in (see "two numbering axes" above).
    index,
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

      const cards = set.cards ?? [];
      for (let index = 0; index < cards.length; index += 1) {
        const card = cards[index];
        const record = ownedByKey.get(card.uniqueKey);
        const entry = record
          ? buildOwnedEntry(card, record, { index })
          : buildMissingEntry(card, index);
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

    // Extensions declared but not released yet: they own no entry in the collection, and a copy
    // granted before the release must not be reported as an orphan either. Their keys are simply
    // registered as known, which is exactly what the orphan detection compares against.
    const upcoming = (await this.loader.listBoosterSets({ includeUpcoming: true })).filter(
      (set) => set.released === false
    );
    for (const descriptor of upcoming) {
      const set = this.loader.getLoadedSet?.(descriptor.setId) ?? null;
      (set?.cards ?? []).forEach((card) => seenKeys.add(card.uniqueKey));
    }
    // Same rule for the promo cards of an upcoming set: hidden, but known, so an owned copy is not
    // reported as an orphan either.
    for (const group of await this.loadPromoSets({ includeUpcoming: true })) {
      if (this.loader.getSetAvailability?.(group.parentSetId)?.released !== false) continue;
      (group.cards ?? []).forEach((card) => seenKeys.add(card.uniqueKey));
    }

    // Promo catalogue: owned cards only, and never counted in a completion ratio.
    for (const group of await this.loadPromoSets()) {
      let ownedInGroup = 0;
      const promoCards = group.cards ?? [];
      for (let index = 0; index < promoCards.length; index += 1) {
        const card = promoCards[index];
        // Registered as seen even when not owned: a promo card is a known card, so an owned row
        // must never be reported as an orphan once its file stops being loaded.
        seenKeys.add(card.uniqueKey);
        const record = ownedByKey.get(card.uniqueKey);
        if (!record) continue;
        entries.push(buildOwnedEntry(card, record, { promo: true, index }));
        ownedInGroup += 1;
      }

      if (ownedInGroup > 0) {
        sets[group.setId] = {
          setId: group.setId,
          name: group.name,
          // Short label of the promo series ("Promo A1"): what the collection filters display.
          label: group.label ?? group.name,
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
        // An orphan has no catalog card, hence no place in any file: it sorts with the first ones
        // rather than shuffling the sort of the entries that do have one.
        index: null,
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
   * @param {object} [options] - Listing options.
   * @param {boolean} [options.includeUpcoming=false] - Also load the groups of an upcoming set.
   * @returns {Promise<Array<object>>} The promo groups (empty when the catalogue is unusable).
   */
  async loadPromoSets({ includeUpcoming = false } = {}) {
    try {
      return await promoManager.listPromoSets({ includeUpcoming });
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

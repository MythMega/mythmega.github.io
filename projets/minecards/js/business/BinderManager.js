/**
 * BinderManager - The personal binders of the player (30-slot showcases).
 *
 * Reference: `.docs/main.md` section 3.H (binders).
 *
 * A binder is a NAMED page of 30 slots (three cards per row, always) that the player fills with
 * cards they own. It is a showcase, not an allocation: the same owned copy can be shown in as many
 * binders as the player likes, so the ONLY rule is per binder - a binder can show a card at most as
 * many times as the player owns copies of it (`1` copy shows once, `2` copies show twice, ...).
 *
 * THE COVER
 * A binder has a representative card (its cover). The `Background` image of THAT card's JSON is used
 * as the backdrop of the binder page, so a binder looks like the card it is built around. The
 * property is carried by `Card.background` (raw absolute URL, never localised).
 *
 * THE LIMIT
 * A player owns as many binders as their level: `getLimit()` reads the level the trophy manager
 * evaluates and refuses the `(level + 1)`-th creation.
 *
 * SELLING
 * Selling a copy from the collection is the one event that can invalidate a binder: a page may end
 * up showing a card more times than the player still owns. `reconcile()` repairs every binder by
 * removing the placements beyond the owned quantity, ALWAYS starting from the farthest slot of the
 * page (the highest index), so the first rows the player arranged survive.
 *
 * Storage: the whole array of binders lives under the single `user_state` key `binders`, which the
 * `.save` export already carries. There is therefore no store, no schema version and no change to
 * the save format for this feature.
 */

import { storageRepository } from '../models/StorageRepository.js';
import { USER_STATE_KEYS, generateUuid } from './AccountManager.js';
import collectionManager from './CollectionManager.js';
import trophyManager from './TrophyManager.js';
import eventBus, { EVENTS } from '../utils/EventBus.js';
import {
  BINDER_CODE_VERSION,
  encodeBinderPayload,
  decodeBinderCode,
  buildBinderShareUrl,
} from '../utils/BinderCode.js';

/** Number of slots of a binder. Fixed: it is the shape of the page, not a setting. */
export const BINDER_SLOT_COUNT = 30;

/** Cards per row of a binder page. The page is ALWAYS laid out on rows of three. */
export const BINDER_COLUMNS = 3;

/** Maximum length of a binder name. */
export const BINDER_NAME_MAX_LENGTH = 40;

/** Version stamped in a share code, re-exported for the pages that build or read one. */
export const BINDER_SHARE_VERSION = BINDER_CODE_VERSION;

/** Error code thrown when the player already owns as many binders as their level allows. */
export const BINDER_LIMIT_REACHED = 'BINDER_LIMIT_REACHED';

/** Error code thrown when a slot would show a card more times than the player owns it. */
export const BINDER_COPY_UNAVAILABLE = 'BINDER_COPY_UNAVAILABLE';

/**
 * Trims a value into a valid binder name.
 *
 * @param {unknown} value - Candidate name.
 * @returns {string} The trimmed name, cut to `BINDER_NAME_MAX_LENGTH`.
 */
function normalizeName(value) {
  return typeof value === 'string' ? value.trim().slice(0, BINDER_NAME_MAX_LENGTH) : '';
}

/**
 * Normalizes one stored binder into the shape the views consume.
 *
 * A row written by an older version (or by hand) can miss anything: the slots are always rebuilt at
 * `BINDER_SLOT_COUNT`, so the page below never has to guard against a short array.
 *
 * @param {unknown} raw - Stored record.
 * @returns {object|null} The normalized binder, or null when the record is unusable.
 */
function normalizeBinder(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = typeof raw.id === 'string' && raw.id !== '' ? raw.id : null;
  if (!id) return null;

  const slots = new Array(BINDER_SLOT_COUNT).fill(null);
  (Array.isArray(raw.slots) ? raw.slots : []).forEach((value, index) => {
    if (index >= BINDER_SLOT_COUNT) return;
    slots[index] = typeof value === 'string' && value !== '' ? value : null;
  });

  return {
    id,
    name: normalizeName(raw.name),
    cover: typeof raw.cover === 'string' && raw.cover !== '' ? raw.cover : null,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    slots,
  };
}



export class BinderManager {
  /**
   * @param {object} [options] - Manager options.
   * @param {object} [options.collectionManager=collectionManager] - Collection reader (defaults to
   *   the application singleton).
   * @param {object} [options.trophyManager=trophyManager] - Level provider.
   */
  constructor({ collectionManager: collection = collectionManager, trophyManager: trophies = trophyManager } = {}) {
    /** @type {object} Collection reader, used to resolve owned quantities and card masters. */
    this.collection = collection;
    /** @type {object} Level provider. */
    this.trophies = trophies;
  }

  /**
   * Logs with the manager prefix.
   *
   * @param {...unknown} args - Values forwarded to `console.info`.
   * @returns {void}
   */
  log(...args) {
    console.info('[BinderManager]', ...args);
  }

  /**
   * Reads the stored binders.
   *
   * @returns {Promise<object[]>} The binders, in creation order.
   * @throws {Error} When the state cannot be read.
   */
  async listBinders() {
    const raw = await storageRepository.getUserState(USER_STATE_KEYS.BINDERS);
    if (!Array.isArray(raw)) return [];
    return raw.map(normalizeBinder).filter((binder) => binder !== null);
  }

  /**
   * Writes the whole binder list back to the state.
   *
   * @param {object[]} binders - Normalized binders.
   * @returns {Promise<void>} Resolves once the state is written.
   * @throws {Error} When the write fails.
   */
  async saveBinders(binders) {
    await storageRepository.setUserState(USER_STATE_KEYS.BINDERS, binders);
  }

  /**
   * Resolves the maximum number of binders the player can own (their level).
   *
   * @returns {Promise<number>} The allowed binder count (always at least 1).
   * @throws {Error} When the level cannot be evaluated.
   */
  async getLimit() {
    const state = await this.trophies.evaluate({ notify: false });
    const level = Number.isFinite(state?.level?.level) ? state.level.level : 1;
    return Math.max(1, Math.floor(level));
  }

  /**
   * Reads one binder by id.
   *
   * @param {string} id - Binder id.
   * @returns {Promise<object|null>} The binder, or null when it does not exist.
   * @throws {Error} When the state cannot be read.
   */
  async getBinder(id) {
    const binders = await this.listBinders();
    return binders.find((binder) => binder.id === id) ?? null;
  }

  /**
   * Counts how many times each collection key is placed on a page.
   *
   * Exported as a static so the editor can grey out a card whose copies are already all placed in
   * the draft it is building (a draft is not stored yet, so the manager cannot count it itself).
   *
   * @param {Array<string|null>} slots - Slots of a binder (or of a draft).
   * @returns {Map<string, number[]>} Key to the list of its slot indices, in ascending order.
   */
  static countPlacements(slots) {
    const placements = new Map();
    (Array.isArray(slots) ? slots : []).forEach((key, index) => {
      if (!key) return;
      const list = placements.get(key) ?? [];
      list.push(index);
      placements.set(key, list);
    });
    return placements;
  }

  /**
   * Validates the slots of a binder against the owned copies.
   *
   * @param {Array<string|null>} slots - Slots to check.
   * @param {Map<string, number>} owned - Owned quantities, keyed by collection key.
   * @returns {void}
   * @throws {Error} When a card is placed more times than the player owns it.
   */
  static validateSlots(slots, owned) {
    BinderManager.countPlacements(slots).forEach((indices, key) => {
      const allowed = owned.get(key) ?? 0;
      if (indices.length > allowed) {
        const error = new Error(
          `A binder cannot show "${key}" ${indices.length} time(s): the player owns ${allowed} copy(ies).`
        );
        error.code = BINDER_COPY_UNAVAILABLE;
        error.key = key;
        error.owned = allowed;
        error.placed = indices.length;
        throw error;
      }
    });
  }

  /**
   * Creates or replaces a binder from a complete draft.
   *
   * The editor builds a draft (name, cover, 30 slots) and this single call validates and writes it,
   * so a cancelled edit never leaves half of a page stored.
   *
   * @param {object} draft - Draft to write.
   * @param {string|null} [draft.id=null] - Id of the binder to replace, or null to create one.
   * @param {string} draft.name - Display name (trimmed, non-empty).
   * @param {string|null} [draft.cover=null] - Collection key of the representative card.
   * @param {Array<string|null>} [draft.slots] - The 30 slots.
   * @returns {Promise<object>} The stored binder.
   * @throws {Error} When the name is empty (`TypeError`), the level limit is reached, the id is
   *   unknown or a card is placed more times than the player owns it.
   */
  async upsertBinder({ id = null, name, cover = null, slots } = {}) {
    const displayName = normalizeName(name);
    if (displayName === '') {
      throw new TypeError('A binder needs a name.');
    }

    const binders = await this.listBinders();
    const existingIndex = id === null ? -1 : binders.findIndex((binder) => binder.id === id);
    if (id !== null && existingIndex < 0) {
      throw new Error(`Unknown binder "${id}".`);
    }

    if (existingIndex < 0) {
      const limit = await this.getLimit();
      if (binders.length >= limit) {
        const error = new Error(
          `The player already owns ${binders.length} binder(s), the maximum for their level (${limit}).`
        );
        error.code = BINDER_LIMIT_REACHED;
        error.limit = limit;
        throw error;
      }
    }

    const page = new Array(BINDER_SLOT_COUNT).fill(null);
    (Array.isArray(slots) ? slots : []).forEach((key, index) => {
      if (index >= BINDER_SLOT_COUNT) return;
      page[index] = typeof key === 'string' && key !== '' ? key : null;
    });

    BinderManager.validateSlots(page, await this.getOwnedQuantities());

    const binder = {
      id: existingIndex < 0 ? generateUuid() : id,
      name: displayName,
      cover: typeof cover === 'string' && cover !== '' ? cover : null,
      createdAt: existingIndex < 0 ? new Date().toISOString() : binders[existingIndex].createdAt,
      slots: page,
    };

    const next = binders.slice();
    if (existingIndex < 0) next.push(binder);
    else next[existingIndex] = binder;

    await this.saveBinders(next);
    this.log(
      `${existingIndex < 0 ? 'Created' : 'Updated'} binder "${binder.name}" (${next.length} total).`
    );
    eventBus.emit(EVENTS.BINDERS_UPDATED, { binders: next });
    return binder;
  }

  /**
   * Deletes a binder.
   *
   * @param {string} id - Binder id.
   * @returns {Promise<object[]>} The remaining binders.
   * @throws {Error} When the state cannot be read or written.
   */
  async deleteBinder(id) {
    const binders = await this.listBinders();
    const next = binders.filter((binder) => binder.id !== id);
    await this.saveBinders(next);
    this.log(`Deleted binder "${id}" (${next.length} left).`);
    eventBus.emit(EVENTS.BINDERS_UPDATED, { binders: next });
    return next;
  }

  /**
   * Reads how many copies of each card the player owns.
   *
   * @returns {Promise<Map<string, number>>} Collection key to owned quantity.
   * @throws {Error} When the collection cannot be read.
   */
  async getOwnedQuantities() {
    const view = await this.collection.getCollectionView();
    const map = new Map();
    (view.entries ?? []).forEach((entry) => {
      if (entry?.owned) map.set(entry.key, Number(entry.quantity) || 0);
    });
    return map;
  }

  /**
   * Repairs every binder after the collection changed (a sale, an import).
   *
   * Each page is trimmed so no card is shown more often than the player owns it, starting from the
   * FARTHEST slot of the page: the first rows the player arranged are the ones that survive.
   *
   * @returns {Promise<number>} The number of placements removed.
   * @throws {Error} When the state cannot be read or written.
   */
  async reconcile() {
    const binders = await this.listBinders();
    if (binders.length === 0) return 0;

    const owned = await this.getOwnedQuantities();
    let removed = 0;

    const next = binders.map((binder) => {
      const placements = BinderManager.countPlacements(binder.slots);
      let changed = false;
      const slots = binder.slots.slice();

      placements.forEach((indices, key) => {
        const allowed = owned.get(key) ?? 0;
        // `indices` is ascending: the tail is the farthest end of the page.
        const excess = indices.length - allowed;
        if (excess <= 0) return;
        for (let offset = 0; offset < excess; offset += 1) {
          slots[indices[indices.length - 1 - offset]] = null;
          removed += 1;
        }
        changed = true;
        this.log(`"${binder.id}": removed ${excess} placement(s) of "${key}" (owned: ${allowed}).`);
      });

      return changed ? { ...binder, slots } : binder;
    });

    if (removed > 0) {
      await this.saveBinders(next);
      eventBus.emit(EVENTS.BINDERS_UPDATED, { binders: next });
      this.log(`Reconciled the binders: ${removed} placement(s) removed.`);
    }
    return removed;
  }

  /**
   * Builds the compact, self-contained payload a share code encodes.
   *
   * The payload carries everything the read-only page needs to render the binder WITHOUT the local
   * database or even the card catalogue: the identity of the author, the name of the page, the
   * master fields of every card it shows (`id`, `style`, `rarity`, `set`, illustration, names and
   * the `Background` used as the backdrop), and the DISPLAY NAME of the extensions those cards
   * belong to.
   *
   * `sets` is optional and additive on purpose: a code written before it existed simply has none,
   * and the page falls back to the raw extension id. That is why it is not a new code version - a
   * reader of version 1 keeps working either way.
   *
   * @param {object} binder - Normalized binder.
   * @param {object} [profile] - Author identity (`{ name, icon, photo }`).
   * @returns {Promise<object>} The payload.
   * @throws {Error} When a slot holds a card the collection no longer knows.
   */
  async buildSharePayload(binder, profile = {}) {
    const view = await this.collection.getCollectionView();
    const byKey = new Map((view.entries ?? []).map((entry) => [entry.key, entry]));

    const keys = [];
    binder.slots.forEach((key) => {
      if (key && !keys.includes(key)) keys.push(key);
    });
    // The cover is part of the payload even when it is not placed in a slot: it names the binder.
    if (binder.cover && !keys.includes(binder.cover)) keys.unshift(binder.cover);

    const masters = keys.map((key) => {
      const entry = byKey.get(key);
      if (!entry?.card) {
        throw new Error(`The card "${key}" of the binder is not in the collection any more.`);
      }
      return BinderManager.serializeCard(entry.card, key);
    });
    const indexByKey = new Map(keys.map((key, index) => [key, index]));

    // The display name of every extension the page shows a card of (`A1` -> "Genesis Blocks"): the
    // read-only page has no catalogue to look it up in, and an id alone is a poor label.
    const sets = {};
    keys.forEach((key) => {
      const setId = byKey.get(key)?.card?.set;
      if (typeof setId !== 'string' || setId === '' || setId in sets) return;
      const info = view.sets?.[setId];
      sets[setId] = info?.label ?? info?.name ?? setId;
    });

    return {
      v: BINDER_SHARE_VERSION,
      name: binder.name,
      cover: binder.cover ? indexByKey.get(binder.cover) ?? null : null,
      user: {
        name: typeof profile.name === 'string' ? profile.name : '',
        icon: typeof profile.icon === 'string' ? profile.icon : '',
        // The avatar of an older save is an http(s) URL rather than an icon of the catalogue: it
        // travels too, so a player who never picked one of the shipped icons still shows their
        // picture on the page. Empty is a valid value: the page falls back on its own.
        photo: typeof profile.photo === 'string' ? profile.photo : '',
      },
      sets,
      cards: masters,
      slots: binder.slots.map((key) => (key === null ? null : indexByKey.get(key) ?? null)),
    };
  }

  /**
   * Serializes one card into the compact master a share code carries.
   *
   * @param {object} card - `Card` instance.
   * @param {string} key - Collection key of that card.
   * @returns {object} The compact master.
   */
  static serializeCard(card, key) {
    return {
      k: key,
      i: card.id,
      s: card.style,
      r: card.rarity,
      e: card.set,
      l: card.illustration,
      n: { ...card.names },
      b: card.background ?? '',
    };
  }

  /**
   * Encodes a binder (and its author) into the URL-safe share code.
   *
   * Deflate keeps a 30-card payload around a kilobyte, so the code stays pasteable.
   *
   * @param {object} binder - Normalized binder.
   * @param {object} [profile] - Author identity (`{ name, icon }`).
   * @returns {Promise<string>} The code.
   * @throws {Error} When the payload cannot be built or the runtime cannot deflate it.
   */
  async encodeShare(binder, profile = {}) {
    const payload = await this.buildSharePayload(binder, profile);
    const code = await encodeBinderPayload(payload);
    this.log(`Share code for "${binder.name}": ${code.length} character(s).`);
    return code;
  }

  /**
   * Decodes a share code.
   *
   * Pure and storage-free on purpose: the read-only page has no account and no database, it only
   * inflates the payload it was given.
   *
   * @param {string} code - Share code.
   * @returns {Promise<object>} The validated payload.
   * @throws {TypeError} When the code is not a string.
   * @throws {Error} When the code is not a valid binder share code.
   */
  static async decodeShare(code) {
    return decodeBinderCode(code);
  }

  /**
   * Builds the absolute, shareable URL of a binder.
   *
   * The link always points at `collection.html`, at the root of the game, whatever the view the
   * player is on: the read-only page is a page of its own. The full URL is returned, so the caller
   * only has to copy it.
   *
   * @param {string} code - Share code.
   * @returns {string} The absolute URL.
   */
  static buildShareUrl(code) {
    return buildBinderShareUrl(code);
  }
}

/** Shared manager built on the application singletons. */
export const binderManager = new BinderManager();

export default binderManager;

/**
 * TitleManager - Catalogue of the player titles ("Titre") and of what unlocks them.
 *
 * Reference: `settings/default_titles.json`, `data/titles/<setId>.json` and the `titles` section of
 * `settings/config.json` (`js/utils/ConfigLoader.js`), plus `js/business/TrophyManager.js` for the
 * level and the unlocked trophies the conditions are read against.
 *
 * A title is the line shown under the pseudo on the profile page. TWO SOURCES, two conditions:
 *   1. the LEVEL titles (`settings/default_titles.json`): every account starts with the catalogue,
 *      and a title of it is unlocked once the level reaches its `requiredLevel`:
 *        [{ "id": "level-3", "requiredLevel": 3, "text": { "fr": "Cubiste", "en": "Cubist" } }]
 *   2. the COLLECTION titles (`data/titles/<setId>.json`): each one is granted by ONE collection
 *      trophy of the extension, and carries its own text (which is what makes a title readable even
 *      where the trophy that grants it is not):
 *        { "Booster": "A1",
 *          "CollectionTitle": [
 *            { "CollectionTrophy": "Genesis Mobs",
 *              "UnlockedTitle": [{ "id": "collection-A1-2", "text": { "fr": "…", "en": "…" } }] } ] }
 *
 * A title is designated by its `id` everywhere - the texts are resolved for the active language at
 * render time, and a save only ever stores the id. A trophy is matched by its extension id and its
 * `Name`, never by a built identifier, exactly like `ProfileIconManager`.
 *
 * UNLOCKING IS DERIVED, NOT STORED
 *   A level never goes down and a trophy is never taken back, so "which titles are unlocked" is a
 *   pure function of the level and of the trophies (`listTitles({ trophyState })`). Nothing is
 *   therefore written to IndexedDB here: the selected title lives in the profile
 *   (`user_state["profile"].title`, `ProfileManager`), and the manager refuses to be told about a
 *   title the catalogue does not declare.
 *
 * NOTIFICATIONS
 *   The ids already ANNOUNCED are kept in memory (`this.announced`), seeded by the boot evaluation
 *   (`notify: false`), exactly like `TrophyManager`. From then on the manager listens to
 *   `TROPHY_UNLOCKED` and `EXPERIENCE_UPDATED` and emits `TITLE_UNLOCKED` with the titles that
 *   became available and were not announced yet — a save that unlocks ten titles at once therefore
 *   says nothing on load.
 *
 * This module deliberately does NOT import `TrophyManager`: `ProfileManager` reads it (to validate
 * the stored id) and `TrophyManager` already depends on `ProfileManager`. The trophy state is
 * passed IN, by the caller that has it (`app.js`, the titles page, the profile).
 */

import { configLoader } from '../utils/ConfigLoader.js';
import eventBus, { EVENTS } from '../utils/EventBus.js';

/** Sources of a title, and therefore of its unlock condition. */
export const TITLE_SOURCES = Object.freeze({
  /** Unlocked by the LEVEL of the account (`requiredLevel` of `settings/default_titles.json`). */
  LEVEL: 'level',
  /** Unlocked by a COLLECTION trophy (`data/titles/<setId>.json`). */
  COLLECTION: 'collection',
});

/**
 * Turns a raw icon-like text map into the two languages of the game.
 *
 * A value that only carries one language is understood as that language for both: a title is never
 * left nameless because a translation is missing.
 *
 * @param {unknown} raw - `text` of a title entry.
 * @returns {{fr: string, en: string}} The two texts (each one may be empty).
 */
export function normalizeTitleText(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const fr = typeof source.fr === 'string' ? source.fr.trim() : '';
  const en = typeof source.en === 'string' ? source.en.trim() : '';
  return { fr: fr !== '' ? fr : en, en: en !== '' ? en : fr };
}

export class TitleManager {
  constructor() {
    /** @type {object|null} Cached catalogue. */
    this.catalog = null;
    /** @type {Promise<object>|null} In-flight load, used to de-duplicate concurrent calls. */
    this.pendingLoad = null;
    /** @type {Set<string>} Ids already announced (the boot evaluation seeds it silently). */
    this.announced = new Set();
    /** @type {boolean} True once the event subscriptions are registered. */
    this.isBound = false;
    /** @type {Function[]} */
    this.unsubscribers = [];
  }

  /**
   * Logs with the manager prefix.
   *
   * @param {...unknown} args - Values forwarded to `console.info`.
   * @returns {void}
   */
  log(...args) {
    console.info('[TitleManager]', ...args);
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
   * Reads and caches the catalogue (the level list and every extension file).
   *
   * @param {object} [options] - Load options.
   * @param {boolean} [options.force=false] - Re-read the files even when they are cached.
   * @returns {Promise<{level: object[], collection: object[], byId: Map<string, object>, byTrophy: Map<string, object[]>}>}
   *   The catalogue: the two families and their two indexes.
   * @throws {Error} When the level list cannot be read.
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
   * A missing per-extension file is not an error: an extension may legitimately grant no title.
   *
   * @returns {Promise<object>} The catalogue.
   * @throws {Error} When the level list cannot be read.
   */
  async readCatalog() {
    const [{ defaultPath, directory }, { sets }] = await Promise.all([
      configLoader.getTitleSettings(),
      configLoader.getBoosterSettings(),
    ]);

    const levelRaw = await TitleManager.fetchJson(defaultPath);
    const level = TitleManager.readLevelList(levelRaw);

    const byId = new Map();
    level.forEach((title) => byId.set(title.id, title));
    /** @type {Map<string, object[]>} Titles granted by one trophy (`<setId>|<trophy name>`). */
    const byTrophy = new Map();
    const collection = [];

    for (const setId of sets) {
      const path = `${directory}/${setId}.json`;
      let file = null;
      try {
        file = await TitleManager.fetchJson(path);
      } catch (error) {
        console.warn(`[TitleManager] No unlockable title declared by "${setId}" (${error.message}).`);
        continue;
      }

      const extensionId = typeof file?.Booster === 'string' && file.Booster.trim() !== ''
        ? file.Booster.trim()
        : setId;
      const entries = Array.isArray(file?.CollectionTitle) ? file.CollectionTitle : [];
      entries.forEach((entry) => {
        const trophyName = typeof entry?.CollectionTrophy === 'string' ? entry.CollectionTrophy.trim() : '';
        const granted = Array.isArray(entry?.UnlockedTitle) ? entry.UnlockedTitle : [];
        if (trophyName === '' || granted.length === 0) return;

        const key = TitleManager.buildTrophyKey(extensionId, trophyName);
        const titles = granted
          .map((raw) => TitleManager.buildCollectionTitle(raw, extensionId, trophyName))
          .filter((title) => title !== null);

        titles.forEach((title) => {
          if (byId.has(title.id)) {
            // The id is the identity of a title in a save: two entries sharing one would make the
            // selected title ambiguous, so the first declaration wins and the second is reported.
            console.warn(`[TitleManager] The title id "${title.id}" is declared twice, ignoring the copy of "${key}".`);
            return;
          }
          byId.set(title.id, title);
          collection.push(title);
        });

        const known = byTrophy.get(key) ?? [];
        byTrophy.set(key, [...known, ...titles.filter((title) => byId.get(title.id) === title)]);
      });
    }

    const catalog = { level, collection, byId, byTrophy };
    this.log(
      `Catalogue loaded: ${level.length} level title(s), ${collection.length} collection title(s), ` +
        `${byTrophy.size} trophy link(s).`
    );
    return catalog;
  }

  /**
   * Turns `settings/default_titles.json` into validated level titles.
   *
   * @param {unknown} raw - Parsed payload of the level list.
   * @returns {object[]} The valid titles, in declaration order.
   */
  static readLevelList(raw) {
    if (!Array.isArray(raw)) return [];
    const titles = [];
    const seen = new Set();
    raw.forEach((entry) => {
      if (!entry || typeof entry !== 'object') return;
      const id = typeof entry.id === 'string' ? entry.id.trim() : '';
      if (id === '' || seen.has(id)) return;
      const required = Number.isInteger(entry.requiredLevel) && entry.requiredLevel >= 1
        ? entry.requiredLevel
        : 1;
      if (required !== entry.requiredLevel) {
        console.warn(`[TitleManager] The title "${id}" declares no usable "requiredLevel": it is unlocked from level 1.`);
      }
      seen.add(id);
      titles.push({
        id,
        source: TITLE_SOURCES.LEVEL,
        text: normalizeTitleText(entry.text),
        requiredLevel: required,
        grantingTrophy: null,
      });
    });
    return titles;
  }

  /**
   * Builds one collection title from an `UnlockedTitle` entry.
   *
   * @param {unknown} entry - Raw entry of a `CollectionTitle` list.
   * @param {string} setId - Extension the title belongs to.
   * @param {string} trophyName - `Name` of the trophy granting it.
   * @returns {object|null} The title, or null when the entry declares no usable id.
   */
  static buildCollectionTitle(entry, setId, trophyName) {
    const id = entry && typeof entry === 'object' && typeof entry.id === 'string' ? entry.id.trim() : '';
    if (id === '') {
      console.warn(`[TitleManager] A title of "${TitleManager.buildTrophyKey(setId, trophyName)}" declares no id, skipping it.`);
      return null;
    }
    return {
      id,
      source: TITLE_SOURCES.COLLECTION,
      text: normalizeTitleText(entry?.text),
      requiredLevel: null,
      grantingTrophy: { setId, name: trophyName },
    };
  }

  /**
   * Builds the catalogue key of a trophy (`<setId>|<trophy name>`).
   *
   * @param {string|number} setId - Extension id (`A1`).
   * @param {string} trophyName - `Name` of the collection trophy.
   * @returns {string} The key used by the per-extension mapping.
   */
  static buildTrophyKey(setId, trophyName) {
    return `${String(setId ?? '').trim()}|${String(trophyName ?? '').trim()}`;
  }

  /**
   * Resolves the text of a title for one language.
   *
   * @param {object} title - Catalogue entry.
   * @param {string} [lang='fr'] - Language code (`fr`, `en`).
   * @returns {string} The text, falling back to the other language, then to the id.
   */
  static titleText(title, lang = 'fr') {
    const text = title?.text ?? {};
    return text[lang] || text.en || text.fr || title?.id || '';
  }

  /**
   * Lists every title with its unlock state.
   *
   * @param {object} [options] - List options.
   * @param {object|null} [options.trophyState] - State returned by `TrophyManager.evaluate()`: its
   *   `level` unlocks the level titles, its unlocked trophies the collection ones.
   * @returns {Promise<{level: object[], collection: object[], all: object[]}>} The titles, each
   *   entry completed with `unlocked`.
   * @throws {Error} When the catalogue cannot be read.
   */
  async listTitles({ trophyState = null } = {}) {
    const catalog = await this.loadCatalog();
    const level = Number.isInteger(trophyState?.level?.level) ? trophyState.level.level : null;
    const unlockedTrophies = TitleManager.readUnlockedTrophies(trophyState);

    const withState = (title) => ({ ...title, unlocked: TitleManager.isUnlocked(title, level, unlockedTrophies) });
    const levelTitles = catalog.level.map(withState);
    const collectionTitles = catalog.collection.map(withState);
    return { level: levelTitles, collection: collectionTitles, all: [...levelTitles, ...collectionTitles] };
  }

  /**
   * Reads the unlocked trophies of a trophy state.
   *
   * @param {object|null} trophyState - State returned by `TrophyManager.evaluate()`.
   * @returns {Set<string>} The keys of the unlocked trophies.
   */
  static readUnlockedTrophies(trophyState) {
    const trophies = Array.isArray(trophyState?.unlocked)
      ? trophyState.unlocked
      : (Array.isArray(trophyState?.trophies) ? trophyState.trophies.filter((trophy) => trophy?.unlocked) : []);
    return new Set(trophies.map((trophy) => TitleManager.buildTrophyKey(trophy?.setId, trophy?.name)));
  }

  /**
   * Tells whether one title is unlocked.
   *
   * @param {object} title - Catalogue entry.
   * @param {number|null} level - Current level, or null when it is unknown.
   * @param {Set<string>} unlockedTrophies - Keys of the unlocked trophies.
   * @returns {boolean} True when the title may be selected.
   */
  static isUnlocked(title, level, unlockedTrophies) {
    if (title.source === TITLE_SOURCES.LEVEL) {
      return level !== null && level >= title.requiredLevel;
    }
    if (title.source === TITLE_SOURCES.COLLECTION) {
      const trophy = title.grantingTrophy;
      return trophy !== null && unlockedTrophies.has(TitleManager.buildTrophyKey(trophy.setId, trophy.name));
    }
    return false;
  }

  /**
   * Finds the catalogue entry of one id.
   *
   * @param {string} id - Title id.
   * @returns {Promise<object|null>} The title, or null when the catalogue does not declare it.
   * @throws {Error} When the catalogue cannot be read.
   */
  async getTitle(id) {
    const catalog = await this.loadCatalog();
    return catalog.byId.get(String(id ?? '').trim()) ?? null;
  }

  /**
   * Tells whether an id belongs to the catalogue.
   *
   * Used by `ProfileManager`: a save repaired by hand can never point the profile at a title that
   * does not exist (and the title of a locked one is simply not offered by the picker).
   *
   * @param {unknown} id - Stored title id.
   * @returns {Promise<boolean>} True when the id is one of the declared titles.
   * @throws {Error} When the catalogue cannot be read.
   */
  async isKnownTitle(id) {
    if (typeof id !== 'string' || id.trim() === '') return false;
    const catalog = await this.loadCatalog();
    return catalog.byId.has(id.trim());
  }

  /**
   * Lists the titles a trophy grants (`UnlockedTitle` of `data/titles/<setId>.json`).
   *
   * @param {object|null} trophy - Trophy state from `TrophyManager`.
   * @returns {Promise<object[]>} The titles, each one completed with `unlocked` following the
   *   trophy itself. A trophy that grants none simply returns an empty list.
   * @throws {Error} When the catalogue cannot be read.
   */
  async getTitlesForTrophy(trophy) {
    if (!trophy || typeof trophy !== 'object') return [];
    const catalog = await this.loadCatalog();
    const granted = catalog.byTrophy.get(TitleManager.buildTrophyKey(trophy.setId, trophy.name)) ?? [];
    return granted.map((title) => ({ ...title, unlocked: trophy.unlocked === true }));
  }

  /**
   * Derives the unlock state, marks what was already announced and emits the new ones.
   *
   * The first call (the boot one) is made with `notify: false`: everything unlocked by the save is
   * then already announced, so the player is only told about what happens from now on.
   *
   * @param {object} [options] - Evaluation options.
   * @param {object|null} [options.trophyState] - Current trophy state (`TrophyManager.evaluate()`).
   * @param {boolean} [options.notify=false] - Emit `TITLE_UNLOCKED` for the titles that were not
   *   announced yet.
   * @returns {Promise<object>} The state returned by `listTitles()`.
   * @throws {Error} When the catalogue cannot be read.
   */
  async evaluate({ trophyState = null, notify = false } = {}) {
    const state = await this.listTitles({ trophyState });
    const fresh = state.all.filter((title) => title.unlocked && !this.announced.has(title.id));
    state.all.forEach((title) => {
      if (title.unlocked) this.announced.add(title.id);
    });

    if (notify && fresh.length > 0) {
      eventBus.emit(EVENTS.TITLE_UNLOCKED, { titles: fresh });
      this.log(`Unlocked ${fresh.length} title(s): ${fresh.map((title) => title.id).join(', ')}.`);
    }
    return state;
  }

  /**
   * Subscribes to the events that move the unlock conditions and seeds the announced set.
   *
   * Called once by `app.js` after the boot evaluation of the trophies, whose state it consumes:
   * from then on the manager follows the TWO events that can unlock a title — a trophy
   * (`TROPHY_UNLOCKED`) and a level (`EXPERIENCE_UPDATED`).
   *
   * @param {object} [options] - Initialization options.
   * @param {object|null} [options.trophyState] - Trophy state of the boot evaluation.
   * @param {boolean} [options.notify=false] - Announce the titles the boot state unlocks.
   * @returns {Promise<void>} Resolves once the subscriptions are registered.
   * @throws {Error} When the catalogue cannot be read.
   */
  async init({ trophyState = null, notify = false } = {}) {
    this.bindEvents();
    await this.evaluate({ trophyState, notify });
  }

  /**
   * Registers the two subscriptions of the manager (idempotent).
   *
   * @returns {void}
   */
  bindEvents() {
    if (this.isBound) return;
    this.isBound = true;
    this.unsubscribers.push(eventBus.on(EVENTS.TROPHY_UNLOCKED, (payload) => this.handleTrophyUnlocked(payload)));
    this.unsubscribers.push(eventBus.on(EVENTS.EXPERIENCE_UPDATED, (payload) => this.handleExperienceUpdated(payload)));
    this.log('Event subscriptions registered.');
  }

  /**
   * Announces the titles granted by the trophies that were just unlocked.
   *
   * @param {object} payload - `TROPHY_UNLOCKED` payload.
   * @param {object[]} [payload.trophies] - Newly unlocked trophies.
   * @returns {Promise<void>} Resolves once the new titles were announced.
   */
  async handleTrophyUnlocked({ trophies } = {}) {
    const list = Array.isArray(trophies) ? trophies : [];
    if (list.length === 0) return;
    try {
      const catalog = await this.loadCatalog();
      const fresh = [];
      list.forEach((trophy) => {
        const granted = catalog.byTrophy.get(TitleManager.buildTrophyKey(trophy?.setId, trophy?.name)) ?? [];
        granted.forEach((title) => {
          if (!this.announced.has(title.id)) fresh.push({ ...title, unlocked: true });
        });
      });
      this.announce(fresh);
    } catch (error) {
      console.warn('[TitleManager] The titles of the unlocked trophies could not be read.', error);
    }
  }

  /**
   * Announces the level titles reached by a level-up.
   *
   * @param {object} payload - `EXPERIENCE_UPDATED` payload.
   * @param {object} [payload.level] - Resolved level (`{ level, … }`).
   * @returns {Promise<void>} Resolves once the new titles were announced.
   */
  async handleExperienceUpdated({ level } = {}) {
    const current = level?.level;
    if (!Number.isInteger(current)) return;
    try {
      const catalog = await this.loadCatalog();
      const fresh = catalog.level
        .filter((title) => current >= title.requiredLevel && !this.announced.has(title.id))
        .map((title) => ({ ...title, unlocked: true }));
      this.announce(fresh);
    } catch (error) {
      console.warn('[TitleManager] The titles of the reached level could not be read.', error);
    }
  }

  /**
   * Marks titles as announced and publishes them (the UI announces the new ones).
   *
   * @param {object[]} titles - Titles to announce.
   * @returns {void}
   */
  announce(titles) {
    const list = (Array.isArray(titles) ? titles : []).filter((title) => {
      if (title?.id === undefined || this.announced.has(title.id)) return false;
      this.announced.add(title.id);
      return true;
    });
    if (list.length === 0) return;
    eventBus.emit(EVENTS.TITLE_UNLOCKED, { titles: list });
    this.log(`Unlocked ${list.length} title(s): ${list.map((title) => title.id).join(', ')}.`);
  }

  /**
   * Drops the cached catalogue and releases the subscriptions (a full reset, an imported save).
   *
   * @returns {void}
   */
  destroy() {
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers = [];
    this.isBound = false;
    this.catalog = null;
    this.pendingLoad = null;
    this.announced = new Set();
  }
}

/** Shared instance used by the profile, the titles page and `app.js`. */
export const titleManager = new TitleManager();

export default titleManager;

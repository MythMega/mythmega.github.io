/**
 * ProfileIconManager - Catalogue of the profile avatars and of the icons a trophy unlocks.
 *
 * Reference: `settings/default_profile_icons.json`, `data/icon.json` and `data/profile_icons/`
 * (paths declared by the `profileIcons` section of `settings/config.json`).
 *
 * TWO SOURCES, both simple `[{ name, file }]` lists:
 *   1. the DEFAULT icons (`settings/default_profile_icons.json`): unlocked on every account, from
 *      the very first launch;
 *   2. the UNLOCKABLE icons (`data/icon.json`): each one is granted by a collection trophy.
 *
 * The link between a trophy and the icons it grants lives in `data/profile_icons/<setId>.json`:
 *
 *   { "Booster": "A1",
 *     "CollectionTrophy": [
 *       { "CollectionTrophy": "Quinte Flush Royale", "UnlockedIcon": ["Rainbow Sheep"] } ] }
 *
 * A trophy is designated by its `Name` (the same `Name` as in `data/trophies/<setId>.json`,
 * documented as language-neutral), never by its position: editing the trophy file therefore cannot
 * silently hand an icon to the wrong trophy. An icon is unlocked as soon as its trophy is, and the
 * unlock is permanent — `TrophyManager` never takes a trophy back, so neither does this manager.
 *
 * This module deliberately does NOT import `TrophyManager`: it is read by `ProfileManager`, and
 * `TrophyManager` already depends on `ProfileManager` (for the display name and the configured
 * limits). A trophy is matched by its extension id and its name, never by a built identifier.
 *
 * Persistence policy: nothing is written to IndexedDB here. The selected icon lives in the profile
 * (`user_state["profile"].icon`); the picker only ever offers catalogue entries, and
 * `ProfileManager` refuses a field that is not a catalogue path.
 */

import { configLoader } from '../utils/ConfigLoader.js';
import boosterManager from './BoosterManager.js';

/** Sources of an avatar: the ones everyone has, and the ones a trophy grants. */
export const PROFILE_ICON_SOURCES = Object.freeze({
  DEFAULT: 'default',
  UNLOCKABLE: 'unlockable',
});

/** Prefix of the purchase id of one paid avatar (`profileIcon.<file>`). */
export const PROFILE_ICON_FEATURE_PREFIX = 'profileIcon.';

/**
 * Normalizes an asset path coming from an icon list (`./assets/img/...` -> `assets/img/...`).
 *
 * @param {unknown} value - Raw path.
 * @returns {string} The trimmed path, or an empty string.
 */
export function normalizeIconPath(value) {
  return typeof value === 'string' ? value.trim().replace(/^\.\//, '') : '';
}

/**
 * Turns a raw icon list into validated descriptors.
 *
 * @param {unknown} raw - Parsed JSON payload of an icon list.
 * @returns {Array<{name: string, file: string}>} The valid entries, in declaration order.
 */
function readIconList(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const icons = [];
  raw.forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    const file = normalizeIconPath(entry.file);
    if (name === '' || file === '' || seen.has(file)) return;
    seen.add(file);
    // `requiredLevel` and `price` are optional. A malformed value falls back to "no requirement"
    // and "free", so a typo can never lock an icon behind an impossible level or charge for it.
    const requiredLevel = Number.isInteger(entry.requiredLevel) && entry.requiredLevel > 0
      ? entry.requiredLevel
      : 0;
    const price = Number.isInteger(entry.price) && entry.price > 0 ? entry.price : 0;
    icons.push({ name, file, requiredLevel, price });
  });
  return icons;
}

export class ProfileIconManager {
  constructor() {
    /** @type {object|null} Cached catalogue. */
    this.catalog = null;
    /** @type {Promise<object>|null} In-flight load, used to de-duplicate concurrent calls. */
    this.pendingLoad = null;
  }

  /**
   * Logs with the manager prefix.
   *
   * @param {...unknown} args - Values forwarded to `console.info`.
   * @returns {void}
   */
  log(...args) {
    console.info('[ProfileIconManager]', ...args);
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
   * Reads and caches the icon catalogue (the three JSON sources).
   *
   * @param {object} [options] - Load options.
   * @param {boolean} [options.force=false] - Re-read the files even when they are cached.
   * @returns {Promise<{default: Array<{name: string, file: string}>, unlockable: Array<{name: string, file: string}>, trophies: Map<string, string[]>}>}
   *   The catalogue: the two icon lists and the per-trophy mapping (`<setId>|<trophy name>` ->
   *   icon names).
   * @throws {Error} When a shared list cannot be read.
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
   * A missing per-extension mapping is not an error: an extension may legitimately unlock no icon.
   *
   * @returns {Promise<object>} The catalogue.
   * @throws {Error} When a shared list cannot be read.
   */
  async readCatalog() {
    const [{ defaultPath, unlockablePath, directory }, { sets }] = await Promise.all([
      configLoader.getProfileIconSettings(),
      configLoader.getBoosterSettings(),
    ]);

    const [defaultRaw, unlockableRaw] = await Promise.all([
      ProfileIconManager.fetchJson(defaultPath),
      ProfileIconManager.fetchJson(unlockablePath),
    ]);

    const trophies = new Map();
    for (const setId of sets) {
      const path = `${directory}/${setId}.json`;
      let file = null;
      try {
        file = await ProfileIconManager.fetchJson(path);
      } catch (error) {
        console.warn(`[ProfileIconManager] No unlockable icons declared by "${setId}" (${error.message}).`);
        continue;
      }

      const entries = Array.isArray(file?.CollectionTrophy) ? file.CollectionTrophy : [];
      entries.forEach((entry) => {
        const trophyName = typeof entry?.CollectionTrophy === 'string' ? entry.CollectionTrophy.trim() : '';
        const icons = Array.isArray(entry?.UnlockedIcon)
          ? entry.UnlockedIcon
            .filter((name) => typeof name === 'string' && name.trim() !== '')
            .map((name) => name.trim())
          : [];
        if (trophyName === '' || icons.length === 0) return;
        const key = ProfileIconManager.buildTrophyKey(file.Booster ?? setId, trophyName);
        const known = trophies.get(key) ?? [];
        trophies.set(key, Array.from(new Set([...known, ...icons])));
      });
    }

    const catalog = {
      default: readIconList(defaultRaw),
      unlockable: readIconList(unlockableRaw),
      trophies,
    };
    this.log(
      `Catalogue loaded: ${catalog.default.length} default icon(s), ` +
        `${catalog.unlockable.length} unlockable icon(s), ${catalog.trophies.size} trophy link(s).`
    );
    return catalog;
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
   * Lists every avatar with its unlock state.
   *
   * @param {object} [options] - List options.
   * @param {object|null} [options.trophyState] - State returned by `TrophyManager.evaluate()`; an
   *   unlockable icon is available only when the trophy granting it is unlocked.
   * @param {number} [options.level=1] - Current player level (gates `requiredLevel`).
   * @param {Record<string, {boughtAt: string}>} [options.purchases={}] - Purchases of the account
   *   (`FeatureManager.getPurchases()`), used to tell a paid icon the player owns from one they
   *   still have to buy.
   * @returns {Promise<{default: object[], unlockable: object[]}>} The two icon lists, each entry
   *   `{ name, file, price, requiredLevel, source, unlocked, purchasable, owned, lockedReason,
   *   grantingTrophy }` — `grantingTrophy` being `{ setId, name }`, or null for an icon no trophy
   *   grants.
   * @throws {Error} When the catalogue cannot be read.
   */
  async listIcons({ trophyState = null, level = 1, purchases = {} } = {}) {
    const catalog = await this.loadCatalog();
    const unlocked = new Set(
      (trophyState?.unlocked ?? []).map((trophy) => ProfileIconManager.buildTrophyKey(trophy.setId, trophy.name))
    );
    const currentLevel = Number.isInteger(level) && level > 0 ? level : 1;
    const owned = purchases && typeof purchases === 'object' ? purchases : {};

    return {
      default: catalog.default.map((icon) => {
        const levelMet = currentLevel >= icon.requiredLevel;
        const bought = icon.price === 0
          || Object.prototype.hasOwnProperty.call(
            owned,
            `${PROFILE_ICON_FEATURE_PREFIX}${icon.file}`
          );
        return {
          ...icon,
          source: PROFILE_ICON_SOURCES.DEFAULT,
          owned: bought,
          // An icon is selectable only when BOTH requirements are met; a paid one that the level
          // still gates is not purchasable either (the price would be paid for nothing).
          unlocked: levelMet && bought,
          purchasable: levelMet && !bought && icon.price > 0,
          lockedReason: levelMet ? (bought ? null : 'price') : 'level',
          grantingTrophy: null,
        };
      }),
      unlockable: catalog.unlockable.map((icon) => {
        const grantingTrophy = ProfileIconManager.findGrantingTrophy(catalog, icon.name);
        const trophyUnlocked = grantingTrophy !== null
          && unlocked.has(ProfileIconManager.buildTrophyKey(grantingTrophy.setId, grantingTrophy.name));
        return {
          ...icon,
          source: PROFILE_ICON_SOURCES.UNLOCKABLE,
          unlocked: trophyUnlocked,
          purchasable: false,
          owned: trophyUnlocked,
          lockedReason: trophyUnlocked ? null : 'trophy',
          grantingTrophy,
        };
      }),
    };
  }

  /**
   * Finds the trophy granting one icon.
   *
   * @param {object} catalog - Catalogue from `loadCatalog()`.
   * @param {string} iconName - `name` of the icon.
   * @returns {{setId: string, name: string}|null} The trophy descriptor, or null when no trophy
   *   grants this icon (an icon nobody unlocks is merely never available).
   */
  static findGrantingTrophy(catalog, iconName) {
    for (const [key, names] of catalog.trophies) {
      if (!names.includes(iconName)) continue;
      const [setId, name] = key.split('|');
      return { setId, name };
    }
    return null;
  }

  /**
   * Lists the icons a trophy grants (`UnlockedIcon` of `data/profile_icons/<setId>.json`).
   *
   * @param {object|null} trophy - Trophy state from `TrophyManager`.
   * @returns {Promise<object[]>} The icons, each one `{ name, file, unlocked }` where `unlocked`
   *   follows the trophy itself; an unknown icon name is skipped with a warning.
   * @throws {Error} When the catalogue cannot be read.
   */
  async getIconsForTrophy(trophy) {
    if (!trophy || typeof trophy !== 'object') return [];
    const catalog = await this.loadCatalog();
    const names = catalog.trophies.get(ProfileIconManager.buildTrophyKey(trophy.setId, trophy.name)) ?? [];
    const byName = new Map(catalog.unlockable.map((icon) => [icon.name, icon]));

    return names
      .map((name) => {
        const icon = byName.get(name);
        if (!icon) {
          console.warn(`[ProfileIconManager] The icon "${name}" is not declared in the unlockable list.`);
          return null;
        }
        return { ...icon, unlocked: trophy.unlocked === true };
      })
      .filter((icon) => icon !== null);
  }

  /**
   * Tells whether a stored path belongs to the catalogue.
   *
   * Used by `ProfileManager`: a save repaired by hand (or written by a version that shipped another
   * icon) can never point the avatar at an arbitrary file.
   *
   * @param {unknown} file - Stored icon path.
   * @returns {Promise<boolean>} True when the path is one of the declared icons.
   * @throws {Error} When the catalogue cannot be read.
   */
  async isKnownIcon(file) {
    if (typeof file !== 'string' || file.trim() === '') return false;
    const catalog = await this.loadCatalog();
    const wanted = normalizeIconPath(file);
    return [...catalog.default, ...catalog.unlockable].some((icon) => icon.file === wanted);
  }

  /**
   * Drops the cached catalogue (used by a full reset and by an imported save).
   *
   * @returns {void}
   */
  reset() {
    this.catalog = null;
    this.pendingLoad = null;
  }
}

/** Shared instance used by the profile manager and by the two trophy views. */
export const profileIconManager = new ProfileIconManager();

export default profileIconManager;

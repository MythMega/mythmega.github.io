/**
 * ColorManager - The colour catalogue of the player identity.
 *
 * Reference: `settings/colors.json`, `js/business/FeatureManager.js` (ownership and purchases),
 * `js/business/ProfileCardManager.js` (title line) and `js/UI/views/ProfileView.js` (pickers).
 *
 * One catalogue, two uses. A colour carries a stable `id` (what a save stores), a translated
 * `name`, a `hex` value and TWO independent prices: `titlePrice` for the title line of the profile
 * card and `usernamePrice` for the pseudo. The two purchases never unlock each other.
 *
 * THE FILE IS THE SOURCE OF TRUTH
 * Adding a colour is editing the JSON: nothing in the code lists the palette any more. The shipped
 * catalogue below is only the fallback used when the file is missing or unreadable, so a damaged
 * deployment still has a coherent picker instead of an empty one.
 */

/** Default colour id used when the player has not bought (or picked) any colour. */
export const AUTO_COLOR_ID = 'auto';

/** Alias used by the profile: the pseudo keeps the theme colour until another one is bought. */
export const USERNAME_DEFAULT_COLOR = AUTO_COLOR_ID;

/** Fallback catalogue, copied when `settings/colors.json` cannot be used. */
export const DEFAULT_COLOR_CATALOG = Object.freeze([
  Object.freeze({
    id: 'gold',
    name: Object.freeze({ fr: 'Or', en: 'Gold' }),
    hex: '#ffd54a',
    titlePrice: 125,
    usernamePrice: 125,
  }),
  Object.freeze({
    id: 'silver',
    name: Object.freeze({ fr: 'Argent', en: 'Silver' }),
    hex: '#d9dee8',
    titlePrice: 125,
    usernamePrice: 125,
  }),
  Object.freeze({
    id: 'crimson',
    name: Object.freeze({ fr: 'Cramoisi', en: 'Crimson' }),
    hex: '#ff6b6b',
    titlePrice: 125,
    usernamePrice: 125,
  }),
  Object.freeze({
    id: 'emerald',
    name: Object.freeze({ fr: 'Émeraude', en: 'Emerald' }),
    hex: '#35e08a',
    titlePrice: 125,
    usernamePrice: 125,
  }),
  Object.freeze({
    id: 'azure',
    name: Object.freeze({ fr: 'Azur', en: 'Azure' }),
    hex: '#5bc8ff',
    titlePrice: 125,
    usernamePrice: 125,
  }),
  Object.freeze({
    id: 'violet',
    name: Object.freeze({ fr: 'Violet', en: 'Violet' }),
    hex: '#b98cff',
    titlePrice: 125,
    usernamePrice: 125,
  }),
  Object.freeze({
    id: 'rose',
    name: Object.freeze({ fr: 'Rose', en: 'Rose' }),
    hex: '#ff8fc7',
    titlePrice: 125,
    usernamePrice: 125,
  }),
]);

/** Pattern of a colour id accepted from a save or from the catalogue. */
const COLOR_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/i;

/** Pattern of a hexadecimal CSS colour (`#RGB`, `#RGBA`, `#RRGGBB` or `#RRGGBBAA`). */
const HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * Reads a non-negative whole price.
 *
 * @param {unknown} value - Declared price.
 * @param {number} fallback - Price used when the value is malformed.
 * @returns {number} A usable price.
 */
function normalizePrice(value, fallback) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback;
}

/**
 * Normalizes the translated name of one colour.
 *
 * @param {unknown} raw - Declared name ({ fr, en }).
 * @param {string} id - Colour id, used when no usable name was declared.
 * @returns {{fr: string, en: string}} Both languages, never empty.
 */
function normalizeName(raw, id) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const fr = typeof source.fr === 'string' && source.fr.trim() !== '' ? source.fr.trim() : '';
  const en = typeof source.en === 'string' && source.en.trim() !== '' ? source.en.trim() : '';
  const fallback = fr || en || id;
  return { fr: fr || fallback, en: en || fallback };
}

/**
 * Validates the raw `settings/colors.json` payload.
 *
 * An entry with no id is skipped, and a duplicate id is ignored after the first occurrence. A
 * malformed price falls back to the shipped price of the same id when there is one, then to 125;
 * a malformed hex is the only unrecoverable field (the entry is dropped), because painting a
 * guessed colour would be worse than not offering it.
 *
 * @param {unknown} raw - Parsed JSON payload.
 * @returns {Array<{id: string, name: {fr: string, en: string}, hex: string, titlePrice: number,
 *   usernamePrice: number}>} The usable palette, in file order.
 */
export function normalizeColorCatalog(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const entries = Array.isArray(source.colors) ? source.colors : null;
  if (!entries) return DEFAULT_COLOR_CATALOG.map((entry) => ({ ...entry, name: { ...entry.name } }));

  const defaultsById = new Map(DEFAULT_COLOR_CATALOG.map((entry) => [entry.id, entry]));
  const seen = new Set();
  const palette = [];
  entries.forEach((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    if (!COLOR_ID_PATTERN.test(id) || seen.has(id)) return;
    const hex = typeof entry.hex === 'string' ? entry.hex.trim().toLowerCase() : '';
    if (!HEX_COLOR_PATTERN.test(hex)) {
      console.warn(`[ColorManager] Colour "${id}" ignored: "${entry.hex}" is not a hex colour.`);
      return;
    }
    const shipped = defaultsById.get(id);
    seen.add(id);
    palette.push({
      id,
      name: normalizeName(entry.name, id),
      hex,
      titlePrice: normalizePrice(entry.titlePrice, shipped?.titlePrice ?? 125),
      usernamePrice: normalizePrice(entry.usernamePrice, shipped?.usernamePrice ?? 125),
    });
  });

  if (palette.length === 0) {
    console.warn('[ColorManager] The colour catalogue is empty: the shipped palette is used.');
    return DEFAULT_COLOR_CATALOG.map((entry) => ({ ...entry, name: { ...entry.name } }));
  }
  return palette;
}

/**
 * Tells whether a stored colour id can be worn.
 *
 * @param {unknown} id - Stored preference.
 * @returns {boolean} True for `auto` or a syntactically valid colour id.
 */
export function isColorId(id) {
  return id === AUTO_COLOR_ID || (typeof id === 'string' && COLOR_ID_PATTERN.test(id.trim()));
}

/**
 * Finds a colour in a palette.
 *
 * @param {Array<{id: string}>} palette - Catalogue returned by `ColorManager.listColors()`.
 * @param {unknown} id - Colour id.
 * @returns {object|null} The entry, or null when the id is not in the catalogue.
 */
export function findColor(palette, id) {
  if (typeof id !== 'string') return null;
  return palette.find((entry) => entry.id === id) ?? null;
}

/**
 * Reads the translated name of one colour.
 *
 * @param {object|null} entry - Catalogue entry.
 * @param {string} lang - Language code.
 * @returns {string} The translated name, falling back to the other language then the id.
 */
export function colorName(entry, lang) {
  if (!entry) return '';
  return entry.name?.[lang] ?? entry.name?.fr ?? entry.name?.en ?? entry.id;
}

export class ColorManager {
  /** Builds the catalogue reader. */
  constructor() {
    /** @type {Array<object>|null} Cached palette. */
    this.cachedColors = null;
    /** @type {Promise<Array<object>>|null} In-flight read, used to de-duplicate concurrent calls. */
    this.pendingLoad = null;
    /** @type {string} Project-relative path of the catalogue. */
    this.path = 'settings/colors.json';
  }

  /**
   * Logs with the manager prefix.
   *
   * @param {...unknown} args - Values forwarded to `console.info`.
   * @returns {void}
   */
  log(...args) {
    console.info('[ColorManager]', ...args);
  }

  /**
   * Reads and validates the colour catalogue (cached).
   *
   * @param {object} [options] - Read options.
   * @param {boolean} [options.force=false] - Re-fetch the file even when a cached copy exists.
   * @returns {Promise<Array<{id: string, name: {fr: string, en: string}, hex: string,
   *   titlePrice: number, usernamePrice: number}>>} The usable palette.
   */
  async listColors({ force = false } = {}) {
    if (this.cachedColors && !force) return this.cachedColors;
    if (this.pendingLoad && !force) return this.pendingLoad;

    this.pendingLoad = (async () => {
      let raw = null;
      try {
        const response = await fetch(this.path, { cache: force ? 'no-store' : 'default' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        raw = await response.json();
      } catch (error) {
        console.warn(`[ColorManager] "${this.path}" could not be read: the shipped palette is used.`, error);
      }
      const colors = normalizeColorCatalog(raw);
      this.log(`${colors.length} colour(s) loaded.`);
      return colors;
    })();

    try {
      this.cachedColors = await this.pendingLoad;
      return this.cachedColors;
    } finally {
      this.pendingLoad = null;
    }
  }

  /**
   * Finds one colour of the catalogue.
   *
   * @param {string} id - Colour id.
   * @returns {Promise<object|null>} The entry, or null when it does not exist.
   */
  async getColor(id) {
    const colors = await this.listColors();
    return findColor(colors, id);
  }

  /**
   * Drops the cached catalogue (used when the settings file changed).
   *
   * @returns {void}
   */
  reset() {
    this.cachedColors = null;
    this.pendingLoad = null;
  }
}

/** Shared instance used by the profile, the card and the store. */
export const colorManager = new ColorManager();

export default colorManager;

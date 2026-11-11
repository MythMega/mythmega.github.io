/**
 * ColorManager - The colour catalogue of the player identity.
 *
 * Reference: `settings/colors.json`, `js/business/FeatureManager.js` (ownership and purchases),
 * `js/business/ProfileCardManager.js` (title line, pseudo and frame) and
 * `js/UI/views/ProfileView.js` (pickers).
 *
 * One catalogue, three uses. A colour carries a stable `id` (what a save stores), a translated
 * `name`, a colour value and THREE independent prices: `titlePrice` for the title line of the
 * profile card, `usernamePrice` for the pseudo and `borderPrice` for the frame of the card. The
 * three purchases never unlock each other.
 *
 * STATIC COLOURS AND GRADIENTS
 * A colour declares either a single `hex` string or a LIST of hex strings. A list paints a
 * gradient, whose angle is `direction` (degrees, 90 by default). The normalized entry therefore
 * exposes:
 *   - `hex`     : the first colour, kept for a caller that needs one solid value;
 *   - `colors`  : every colour of the entry, in declaration order (a single one when static);
 *   - `gradient`: true when the entry declares several colours;
 *   - `css`     : a ready-to-use CSS value, either `#rrggbb` or `linear-gradient(...)`, which is
 *                 what a swatch, a `background` or a text gradient consumes.
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

/** Angle of a gradient whose entry declares no valid `direction`, in degrees. */
export const DEFAULT_GRADIENT_DIRECTION = 90;

/** Price of one use of a static colour when neither the file nor the fallback declares one. */
const STATIC_PRICE_FALLBACK = Object.freeze({ title: 125, username: 125, border: 500 });

/** Price of one use of a gradient when neither the file nor the fallback declares one. */
const GRADIENT_PRICE_FALLBACK = Object.freeze({ title: 300, username: 300, border: 800 });

/** Fallback catalogue, copied when `settings/colors.json` cannot be used. */
export const DEFAULT_COLOR_CATALOG = Object.freeze([
  Object.freeze({
    id: 'gold',
    name: Object.freeze({ fr: 'Or', en: 'Gold' }),
    hex: '#ffd54a',
    titlePrice: 125,
    usernamePrice: 125,
    borderPrice: 500,
  }),
  Object.freeze({
    id: 'silver',
    name: Object.freeze({ fr: 'Argent', en: 'Silver' }),
    hex: '#d9dee8',
    titlePrice: 125,
    usernamePrice: 125,
    borderPrice: 500,
  }),
  Object.freeze({
    id: 'crimson',
    name: Object.freeze({ fr: 'Cramoisi', en: 'Crimson' }),
    hex: '#ff6b6b',
    titlePrice: 125,
    usernamePrice: 125,
    borderPrice: 500,
  }),
  Object.freeze({
    id: 'emerald',
    name: Object.freeze({ fr: 'Émeraude', en: 'Emerald' }),
    hex: '#35e08a',
    titlePrice: 125,
    usernamePrice: 125,
    borderPrice: 500,
  }),
  Object.freeze({
    id: 'azure',
    name: Object.freeze({ fr: 'Azur', en: 'Azure' }),
    hex: '#5bc8ff',
    titlePrice: 125,
    usernamePrice: 125,
    borderPrice: 500,
  }),
  Object.freeze({
    id: 'violet',
    name: Object.freeze({ fr: 'Violet', en: 'Violet' }),
    hex: '#b98cff',
    titlePrice: 125,
    usernamePrice: 125,
    borderPrice: 500,
  }),
  Object.freeze({
    id: 'rose',
    name: Object.freeze({ fr: 'Rose', en: 'Rose' }),
    hex: '#ff8fc7',
    titlePrice: 125,
    usernamePrice: 125,
    borderPrice: 500,
  }),
  Object.freeze({
    id: 'dawn',
    name: Object.freeze({ fr: 'Aube', en: 'Dawn' }),
    hex: Object.freeze(['#ff9a8b', '#ff6a88', '#ffc3a0']),
    direction: 90,
    titlePrice: 300,
    usernamePrice: 300,
    borderPrice: 800,
  }),
  Object.freeze({
    id: 'night',
    name: Object.freeze({ fr: 'Nuit', en: 'Night' }),
    hex: Object.freeze(['#1a1a4e', '#3b2a70', '#6a3fa0']),
    direction: 135,
    titlePrice: 300,
    usernamePrice: 300,
    borderPrice: 800,
  }),
  Object.freeze({
    id: 'dusk',
    name: Object.freeze({ fr: 'Crépuscule', en: 'Dusk' }),
    hex: Object.freeze(['#ffb26b', '#ff7b54', '#8a5bd6']),
    direction: 200,
    titlePrice: 300,
    usernamePrice: 300,
    borderPrice: 800,
  }),
  Object.freeze({
    id: 'snowy',
    name: Object.freeze({ fr: 'Snowy', en: 'Snowy' }),
    hex: Object.freeze(['#ffffff', '#b8c0cc', '#ffffff']),
    direction: 135,
    titlePrice: 300,
    usernamePrice: 300,
    borderPrice: 800,
  }),
  Object.freeze({
    id: 'jungle',
    name: Object.freeze({ fr: 'Jungle', en: 'Jungle' }),
    hex: Object.freeze(['#2f7d32', '#6b4a2b', '#215e28']),
    direction: 180,
    titlePrice: 300,
    usernamePrice: 300,
    borderPrice: 800,
  }),
  Object.freeze({
    id: 'overworld',
    name: Object.freeze({ fr: 'Overworld', en: 'Overworld' }),
    hex: Object.freeze(['#7ec8f5', '#58a45a', '#7b5a3a', '#9aa3ab']),
    direction: 180,
    titlePrice: 300,
    usernamePrice: 300,
    borderPrice: 800,
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
 * Reads the angle of a gradient.
 *
 * @param {unknown} value - Declared `direction`, in degrees.
 * @returns {number} The angle, normalized to [0, 360[, or `DEFAULT_GRADIENT_DIRECTION`.
 */
function normalizeDirection(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_GRADIENT_DIRECTION;
  const wrapped = Math.round(value) % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/**
 * Reads the colours of one entry.
 *
 * A string is one colour; a list is a gradient. Everything that is neither a valid hex nor a list
 * of them is unusable, and the entry is dropped by the caller rather than painted with a guess.
 *
 * @param {unknown} raw - Declared `hex` value (string or array of strings).
 * @returns {string[]} The colours, lowercased, in declaration order (empty when unusable).
 */
function readColors(raw) {
  const declared = Array.isArray(raw) ? raw : [raw];
  if (declared.length === 0) return [];
  const colors = [];
  for (const candidate of declared) {
    if (typeof candidate !== 'string') return [];
    const value = candidate.trim().toLowerCase();
    if (!HEX_COLOR_PATTERN.test(value)) return [];
    colors.push(value);
  }
  return colors;
}

/**
 * Builds the CSS value of one colour: a solid paint or a linear gradient.
 *
 * @param {string[]} colors - Colours of the entry (one or more).
 * @param {number} direction - Angle of the gradient, in degrees.
 * @returns {string} `#rrggbb` for a single colour, `linear-gradient(...)` otherwise.
 */
export function buildColorCss(colors, direction = DEFAULT_GRADIENT_DIRECTION) {
  if (!Array.isArray(colors) || colors.length === 0) return '';
  if (colors.length === 1) return colors[0];
  return `linear-gradient(${direction}deg, ${colors.join(', ')})`;
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
 * Copies one shipped entry into a writable descriptor.
 *
 * @param {object} entry - Entry of `DEFAULT_COLOR_CATALOG`.
 * @returns {object} A copy a caller may modify.
 */
function cloneShipped(entry) {
  const colors = Array.isArray(entry.hex) ? [...entry.hex] : [entry.hex];
  const direction = normalizeDirection(entry.direction);
  return {
    id: entry.id,
    name: { ...entry.name },
    hex: colors[0],
    colors,
    gradient: colors.length > 1,
    direction,
    css: buildColorCss(colors, direction),
    titlePrice: entry.titlePrice,
    usernamePrice: entry.usernamePrice,
    borderPrice: entry.borderPrice,
  };
}

/**
 * Validates the raw `settings/colors.json` payload.
 *
 * An entry with no id is skipped, and a duplicate id is ignored after the first occurrence. A
 * malformed price falls back to the shipped price of the same id when there is one, then to the
 * price of its kind (static or gradient), so a typo can never sell a gradient for the price of a
 * plain colour. A malformed colour is the only unrecoverable field (the entry is dropped), because
 * painting a guessed colour would be worse than not offering it.
 *
 * @param {unknown} raw - Parsed JSON payload.
 * @returns {Array<{id: string, name: {fr: string, en: string}, hex: string, colors: string[],
 *   gradient: boolean, direction: number, css: string, titlePrice: number, usernamePrice: number,
 *   borderPrice: number}>} The usable palette, in file order.
 */
export function normalizeColorCatalog(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const entries = Array.isArray(source.colors) ? source.colors : null;
  if (!entries) return DEFAULT_COLOR_CATALOG.map(cloneShipped);

  const defaultsById = new Map(DEFAULT_COLOR_CATALOG.map((entry) => [entry.id, entry]));
  const seen = new Set();
  const palette = [];
  entries.forEach((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    if (!COLOR_ID_PATTERN.test(id) || seen.has(id)) return;
    const colors = readColors(entry.hex);
    if (colors.length === 0) {
      console.warn(`[ColorManager] Colour "${id}" ignored: "${JSON.stringify(entry.hex)}" is not a hex colour.`);
      return;
    }
    const gradient = colors.length > 1;
    const direction = normalizeDirection(entry.direction);
    const shipped = defaultsById.get(id);
    const fallback = gradient ? GRADIENT_PRICE_FALLBACK : STATIC_PRICE_FALLBACK;
    seen.add(id);
    palette.push({
      id,
      name: normalizeName(entry.name, id),
      hex: colors[0],
      colors,
      gradient,
      direction,
      css: buildColorCss(colors, direction),
      titlePrice: normalizePrice(entry.titlePrice, shipped?.titlePrice ?? fallback.title),
      usernamePrice: normalizePrice(entry.usernamePrice, shipped?.usernamePrice ?? fallback.username),
      borderPrice: normalizePrice(entry.borderPrice, shipped?.borderPrice ?? fallback.border),
    });
  });

  if (palette.length === 0) {
    console.warn('[ColorManager] The colour catalogue is empty: the shipped palette is used.');
    return DEFAULT_COLOR_CATALOG.map(cloneShipped);
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
 * Reads the CSS value of one colour.
 *
 * @param {object|null} entry - Catalogue entry.
 * @returns {string} `#rrggbb` or `linear-gradient(...)`, empty for a missing entry.
 */
export function colorCss(entry) {
  return typeof entry?.css === 'string' ? entry.css : '';
}

/**
 * Tells whether one colour paints a gradient.
 *
 * @param {object|null} entry - Catalogue entry.
 * @returns {boolean} True when the entry declares several colours.
 */
export function isGradientColor(entry) {
  return entry?.gradient === true;
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
   * Reads and validates the colour catalogue (cached in memory).
   *
   * The file is always fetched with `cache: 'no-store'`: the palette is a CATALOGUE, and a player
   * who reloads the page after a deployment must get the colours that were added, not the copy an
   * HTTP cache kept from the previous visit.
   *
   * @param {object} [options] - Read options.
   * @param {boolean} [options.force=false] - Re-fetch the file even when a cached copy exists.
   * @returns {Promise<Array<object>>} The usable palette.
   */
  async listColors({ force = false } = {}) {
    if (this.cachedColors && !force) return this.cachedColors;
    if (this.pendingLoad && !force) return this.pendingLoad;

    this.pendingLoad = (async () => {
      let raw = null;
      try {
        const response = await fetch(this.path, { cache: 'no-store' });
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

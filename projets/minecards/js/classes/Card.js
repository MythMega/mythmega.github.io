/**
 * Card - Immutable value object describing one collectible printing.
 *
 * References: `.docs/main.md` section 2/3.D (generic model) and `.docs/steps/3.md` point 2
 * (real booster schema produced by `external/cardmakerz`).
 *
 * TWO INPUT SCHEMAS ARE SUPPORTED
 *   1. Booster data schema (`data/boosters/<setId>.json`, the real production format):
 *      { Index, Name_FR, Name_EN, Desc_FR, Desc_EN, Rarity, Style, Background, Underlay,
 *        Layout, Path } with `Layout` = "classic" | "fullart" and `Path` containing the
 *      `<lang>` placeholder (e.g. "./cards/A1/<lang>/SERIE-A1 _ W001_classic.png").
 *   2. Legacy documented schema (`.docs/main.md` section 3.D):
 *      { id, name, rarity, style, illustration, set } with `style` = "normal" | "fullart".
 *
 * UNIQUE KEY
 *   `uniqueKey` = `${id}_${style}`. For the booster schema the id is derived from the asset
 *   name (`Path` without its extension and without the trailing `_${layout}`), which yields
 *   the card code prefixed with its series ("SERIE-A1 _ W001"). Keeping the series inside the
 *   id is what makes the key unique across extensions, as required by `main.md` section 2: the
 *   `collection` key does not contain the extension. The resulting key is exactly the image
 *   file name, which keeps debugging trivial ("SERIE-A1 _ W001_classic" <-> the PNG).
 *
 * LOCALIZATION
 *   Names and descriptions exist in several languages; `getName(lang)` / `getDescription(lang)`
 *   resolve them with an explicit fallback chain, so a partially translated set never breaks
 *   the UI.
 */

/** Print styles. `classic` is the booster-schema name of the standard printing. */
export const CARD_STYLE = Object.freeze({
  CLASSIC: 'classic',
  FULL_ART: 'fullart',
});

/** Legacy alias kept for the documented model (`style: "normal"`). */
export const LEGACY_STYLE_NORMAL = 'normal';

/** Rarity bounds accepted in the rarity tables and in the booster data. */
export const CARD_RARITY = Object.freeze({ MIN: 1, MAX: 5 });

/**
 * Resolves the translated display name of a rarity (`rarity.1` … `rarity.5`).
 *
 * The translation lives in the `settings/i18n/*.json` dictionaries, NOT in this module
 * (which must stay dependency-free): the caller passes a translate function, typically
 * `(key) => i18n.t(key)`.
 *
 * @param {number|string} rarity - Rarity value (1-5).
 * @param {(key: string) => string} translate - Translation function.
 * @returns {string} The translated rarity name, or the raw number when unresolvable.
 */
export function getRarityLabel(rarity, translate) {
  const normalized = Number(rarity);
  if (!Number.isInteger(normalized)) return String(rarity);
  if (typeof translate !== 'function') return String(normalized);
  const label = translate(`rarity.${normalized}`);
  if (typeof label !== 'string' || label === '' || label === `rarity.${normalized}`) {
    return String(normalized);
  }
  return label;
}

/**
 * Validates that a value is a non-empty string.
 *
 * @param {unknown} value - Value to validate.
 * @param {string} fieldName - Field name used to build an explicit error message.
 * @returns {string} The validated string.
 * @throws {TypeError} When the value is not a non-empty string.
 */
function assertNonEmptyString(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`Card.${fieldName} must be a non-empty string (received: ${JSON.stringify(value)}).`);
  }
  return value;
}

/**
 * Validates that a value is an integer inside the rarity bounds.
 *
 * @param {unknown} value - Value to validate.
 * @returns {number} The validated rarity.
 * @throws {TypeError} When the value is not a number.
 * @throws {RangeError} When the value is not an integer inside [1, 5].
 */
function assertRarity(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new TypeError(`Card.rarity must be a number (received: ${JSON.stringify(value)}).`);
  }
  if (!Number.isInteger(value) || value < CARD_RARITY.MIN || value > CARD_RARITY.MAX) {
    throw new RangeError(
      `Card.rarity must be an integer between ${CARD_RARITY.MIN} and ${CARD_RARITY.MAX} (received: ${value}).`
    );
  }
  return value;
}

export class Card {
  /** Print styles, exposed for consumers that build keys manually. */
  static STYLES = CARD_STYLE;

  /** Rarity bounds, exposed for the gacha engine and the collection view. */
  static RARITY = CARD_RARITY;

  /**
   * Creates a card from an already normalized descriptor.
   *
   * @param {object} payload - Normalized descriptor.
   * @param {string} payload.id - Unique-in-all-extensions card id (e.g. "SERIE-A1 _ W001").
   * @param {Record<string, string>} payload.names - Display names keyed by language code.
   * @param {Record<string, string>} payload.descriptions - Descriptions keyed by language code.
   * @param {number} payload.rarity - Integer from 1 (common) to 5 (mythic).
   * @param {string} payload.style - "classic" or "fullart" ("normal" is normalized to classic).
   * @param {string} payload.illustration - Illustration path, `<lang>` placeholder or `/fr/`.
   * @param {string} payload.set - Owning extension id (e.g. "A1").
   * @param {string} [payload.background=''] - Raw `Background` image of the card data (the artwork
   *   behind the card). Optional: it is only used as the backdrop of a binder. Empty when absent.
   * @throws {TypeError|RangeError} When a field is missing or has an invalid type/range.
   */
  constructor(payload = {}) {
    const { id, names, descriptions, rarity, style, illustration, set, background } = payload;

    this.id = assertNonEmptyString(id, 'id');
    this.names = Object.freeze(Card.normalizeLocalizedMap(names, 'names'));
    this.descriptions = Object.freeze(Card.normalizeLocalizedMap(descriptions ?? {}, 'descriptions'));
    this.rarity = assertRarity(rarity);
    this.style = Card.assertStyle(style);
    this.illustration = assertNonEmptyString(illustration, 'illustration');
    this.set = assertNonEmptyString(set, 'set');
    // Raw on purpose: `Background` is an absolute URL of the asset repository, never a local
    // `<lang>` path, so it is NOT run through `resolveImagePath`. An unusable value is dropped
    // rather than thrown: a card without a backdrop is still a perfectly valid card.
    this.background = typeof background === 'string' ? background.trim() : '';

    Object.freeze(this);
  }

  /**
   * Composite key used by the `collection` store and by the gifts/redeem `key` field.
   *
   * @returns {string} `${id}_${style}` (e.g. "SERIE-A1 _ W001_classic").
   */
  get uniqueKey() {
    return Card.buildUniqueKey(this.id, this.style);
  }

  /**
   * True when the card uses the full art print style.
   *
   * @returns {boolean} Whether the style is "fullart".
   */
  get isFullArt() {
    return this.style === CARD_STYLE.FULL_ART;
  }

  /**
   * Resolves the display name for a language.
   *
   * @param {string} [lang='fr'] - Language code.
   * @returns {string} The localized name, falling back to another language then to the id.
   */
  getName(lang = 'fr') {
    return Card.resolveLocalized(this.names, lang, this.id);
  }

  /**
   * Resolves the description for a language.
   *
   * @param {string} [lang='fr'] - Language code.
   * @returns {string} The localized description, or an empty string when none exists.
   */
  getDescription(lang = 'fr') {
    return Card.resolveLocalized(this.descriptions, lang, '');
  }

  /**
   * Resolves a localized value with an explicit fallback chain.
   *
   * @param {Record<string, string>} map - Values keyed by language code.
   * @param {string} lang - Requested language.
   * @param {string} fallback - Value returned when no language matched.
   * @returns {string} The resolved value.
   */
  static resolveLocalized(map, lang, fallback) {
    if (map[lang]) return map[lang];
    if (map.fr) return map.fr;
    if (map.en) return map.en;
    const first = Object.values(map).find((value) => typeof value === 'string' && value !== '');
    return first ?? fallback;
  }

  /**
   * Validates and normalizes a `{ lang: text }` map.
   *
   * @param {unknown} map - Candidate map.
   * @param {string} fieldName - Field name used in error messages.
   * @returns {Record<string, string>} The normalized map (empty when the input is empty).
   * @throws {TypeError} When the value is neither empty nor a plain object.
   */
  static normalizeLocalizedMap(map, fieldName) {
    if (map === undefined || map === null) return {};
    if (typeof map !== 'object' || Array.isArray(map)) {
      throw new TypeError(`Card.${fieldName} must be an object keyed by language code.`);
    }
    const normalized = {};
    Object.entries(map).forEach(([code, text]) => {
      if (typeof text === 'string' && text !== '') {
        normalized[code] = text;
      }
    });
    return normalized;
  }

  /**
   * Validates and normalizes a style value.
   *
   * `normal` (documented model) and `classic` (booster data `Layout`) designate the same
   * printing; both are accepted and normalized to `classic`.
   *
   * @param {unknown} style - Candidate style.
   * @returns {string} The normalized style ("classic" or "fullart").
   * @throws {TypeError} When the style is missing or not a string.
   * @throws {RangeError} When the style is not supported.
   */
  static assertStyle(style) {
    if (typeof style !== 'string' || style.trim() === '') {
      throw new TypeError(`Card.style must be a non-empty string (received: ${JSON.stringify(style)}).`);
    }
    const normalized = style.trim().toLowerCase();
    if (normalized === LEGACY_STYLE_NORMAL) return CARD_STYLE.CLASSIC;
    if (!Card.isValidStyle(normalized)) {
      throw new RangeError(
        `Card.style must be one of [${Object.values(CARD_STYLE).join(', ')}] (received: "${style}").`
      );
    }
    return normalized;
  }

  /**
   * Checks whether a style value belongs to the supported styles.
   *
   * @param {unknown} style - Candidate style.
   * @returns {boolean} True when the style is supported.
   */
  static isValidStyle(style) {
    return typeof style === 'string' && Object.values(CARD_STYLE).includes(style);
  }

  /**
   * Builds the composite key without instantiating a card (used to resolve gift keys).
   *
   * @param {string} id - Card id.
   * @param {string} style - Card style.
   * @returns {string} `${id}_${style}`.
   * @throws {TypeError} When `id` is not a non-empty string.
   * @throws {RangeError} When the style is not supported.
   */
  static buildUniqueKey(id, style) {
    return `${assertNonEmptyString(id, 'id')}_${Card.assertStyle(style)}`;
  }

  /**
   * Derives the cross-extension card id from an illustration path and its layout.
   *
   * The booster data names its assets `.../<lang>/<id>_<layout>.png`, so removing the extension
   * and the `_<layout>` suffix yields the id, series included. That series prefix is what keeps
   * the `collection` key unique between extensions.
   *
   * @param {string} path - Illustration path (e.g. "./cards/A1/<lang>/SERIE-A1 _ W001_classic.png").
   * @param {string} style - Normalized layout ("classic" or "fullart").
   * @returns {string} The derived id (e.g. "SERIE-A1 _ W001").
   * @throws {TypeError} When the path does not match the expected `<id>_<style>` naming.
   */
  static deriveIdFromPath(path, style) {
    assertNonEmptyString(path, 'illustration');
    const fileName = path.split(/[\\/]/).pop() ?? '';
    const baseName = fileName.replace(/\.[a-z0-9]+$/i, '').trim();
    const suffix = `_${Card.assertStyle(style)}`;

    if (!baseName.toLowerCase().endsWith(suffix)) {
      throw new TypeError(
        `Card.illustration "${path}" must end with "${suffix}" so the card id can be derived from it.`
      );
    }
    const id = baseName.slice(0, baseName.length - suffix.length).trim();
    if (id === '') {
      throw new TypeError(`Card.illustration "${path}" does not contain a card id before "${suffix}".`);
    }
    return id;
  }

  /**
   * Converts an `Index` value ("SERIE-A1 / W001") into the id form used by the assets
   * ("SERIE-A1 _ W001"), for booster data whose `Path` is missing.
   *
   * @param {unknown} index - Raw `Index` field.
   * @returns {string} The normalized id prefix.
   * @throws {TypeError} When the value is not a non-empty string.
   */
  static normalizeIndexToId(index) {
    return assertNonEmptyString(index, 'Index')
      .split('/')
      .map((part) => part.trim())
      .filter((part) => part !== '')
      .join(' _ ');
  }

  /**
   * Builds a card from one entry of a booster JSON (`data/boosters/<setId>.json`).
   *
   * @param {object} entry - Raw card entry (see the module header for the field list).
   * @param {object} context - Build context.
   * @param {string} context.set - Owning extension id, e.g. the booster `Serie`/`ID`.
   * @returns {Card} A frozen card instance.
   * @throws {TypeError} When the entry misses a mandatory field or its `Path` has an unexpected shape.
   * @throws {RangeError} When `Rarity` or `Layout` is out of range / unsupported.
   */
  static fromSetEntry(entry, { set } = {}) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new TypeError('Card.fromSetEntry expects a plain object.');
    }

    const style = Card.assertStyle(entry.Layout ?? entry.Style);
    const illustration = assertNonEmptyString(entry.Path, 'Path');
    const id = entry.Path
      ? Card.deriveIdFromPath(illustration, style)
      : `${Card.normalizeIndexToId(entry.Index)}_${style}`;

    return new Card({
      id,
      names: Card.collectLocalized(entry, 'Name'),
      descriptions: Card.collectLocalized(entry, 'Desc'),
      rarity: assertRarity(entry.Rarity),
      style,
      illustration,
      set,
      background: entry.Background,
    });
  }

  /**
   * Builds a card from the legacy documented descriptor (`main.md` section 3.D).
   *
   * @param {object} raw - Raw descriptor: `{ id, name, rarity, style, illustration, set }`.
   * @param {string} [lang='fr'] - Language the single `name` field belongs to.
   * @returns {Card} A frozen card instance.
   * @throws {TypeError|RangeError} When the descriptor is invalid.
   */
  static fromJSON(raw, lang = 'fr') {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new TypeError('Card.fromJSON expects a plain object.');
    }

    return new Card({
      id: raw.id,
      names: { [lang]: raw.name },
      descriptions: {},
      rarity: raw.rarity,
      style: raw.style,
      illustration: raw.illustration,
      set: raw.set,
      background: raw.background,
    });
  }

  /**
   * Builds a card from either supported schema, detected from the entry itself.
   *
   * The booster schema is recognized by its `Index` field; anything else is treated as the
   * legacy descriptor. This keeps a mixed catalog (hand-written sets plus generated ones)
   * loadable with a single code path.
   *
   * @param {object} entry - Raw card entry.
   * @param {object} context - Build context.
   * @param {string} context.set - Owning extension id.
   * @param {string} [context.lang='fr'] - Language of the legacy single `name` field.
   * @returns {Card} A frozen card instance.
   * @throws {TypeError|RangeError} When the entry is invalid.
   */
  static fromAnySchema(entry, { set, lang = 'fr' } = {}) {
    const isBoosterEntry = entry && typeof entry === 'object' && 'Index' in entry;
    return isBoosterEntry ? Card.fromSetEntry(entry, { set }) : Card.fromJSON(entry, lang);
  }

  /**
   * Collects the `<prefix>_<LANG>` fields of a booster entry into a language map.
   *
   * @param {object} entry - Raw booster card entry.
   * @param {string} prefix - Field prefix ("Name" or "Desc").
   * @returns {Record<string, string>} Values keyed by the uppercase language code found in the
   *   field name, lowercased (e.g. `{ fr: "...", en: "..." }`).
   */
  static collectLocalized(entry, prefix) {
    const pattern = new RegExp(`^${prefix}_([A-Za-z]{2,5})$`);
    const map = {};
    Object.entries(entry).forEach(([key, value]) => {
      const match = pattern.exec(key);
      if (match && typeof value === 'string' && value !== '') {
        map[match[1].toLowerCase()] = value;
      }
    });
    return map;
  }

  /**
   * Serializes the card back to a plain object (safe for a `.save` export or a legacy JSON).
   *
   * @returns {{id: string, names: Record<string, string>, descriptions: Record<string, string>, rarity: number, style: string, illustration: string, set: string, background: string}}
   *   A plain descriptor with the persisted fields only.
   */
  toJSON() {
    return {
      id: this.id,
      names: { ...this.names },
      descriptions: { ...this.descriptions },
      rarity: this.rarity,
      style: this.style,
      illustration: this.illustration,
      set: this.set,
      background: this.background,
    };
  }
}

export default Card;
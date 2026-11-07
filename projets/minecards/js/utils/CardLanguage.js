/**
 * CardLanguage - Language of the card data (names, descriptions, artwork).
 *
 * Reference: `.docs/main.md` section 3.F.
 *
 * The interface and the cards are read independently: a French player may want the cards in
 * English, and an English player may collect the French printings. `I18n` therefore owns the
 * language of the INTERFACE (`i18n.t`, dates, `<html lang>`) and this module owns the language of
 * the GAME DATA (`Card.getName`, `Card.getDescription`, the `<lang>` placeholder of the
 * illustrations, the names of the mining blocks and of the colours).
 *
 * The preference is `auto` by default: it follows the browser language limited to the languages the
 * catalogue is written in (`cardLanguages` of `settings/config.json`), then falls back to English,
 * the one language every set is guaranteed to carry. Choosing `fr` or `en` pins the cards to that
 * language whatever the interface does.
 *
 * The preference is mirrored into `localStorage` (`mc_card_lang`) so it survives a boot that fails
 * before the account is read. The authoritative value lives in `user_state["settings"].cardLang`
 * and is written by `AccountManager.updateSettings`; this module never touches IndexedDB.
 */

import { configLoader } from './ConfigLoader.js';
import eventBus, { EVENTS } from './EventBus.js';

/** `localStorage` key mirrored before the account is read. */
export const CARD_LANG_STORAGE_KEY = 'mc_card_lang';

/** Preference meaning "follow the browser, then English". */
export const CARD_LANG_AUTO = 'auto';

/** Languages the card data ships with when `config.json` declares none. */
export const DEFAULT_CARD_LANGUAGES = Object.freeze(['fr', 'en']);

/** Language used when nothing else matches: every catalogue carries it. */
export const DEFAULT_CARD_LANG = 'en';

/**
 * Reads the mirrored card language from `localStorage`.
 *
 * @returns {string|null} The stored preference, or null when absent/unreadable.
 */
export function readMirroredCardLang() {
  try {
    return window.localStorage.getItem(CARD_LANG_STORAGE_KEY);
  } catch (error) {
    console.warn('[CardLanguage] localStorage is not readable.', error);
    return null;
  }
}

/**
 * Writes the mirror used before the account settings are read.
 *
 * @param {string} preference - Preference to mirror (`auto` or a language code).
 * @returns {void}
 */
export function writeMirroredCardLang(preference) {
  try {
    window.localStorage.setItem(CARD_LANG_STORAGE_KEY, preference);
  } catch (error) {
    console.warn('[CardLanguage] localStorage is not writable.', error);
  }
}

/**
 * Removes the mirror (used by a full reset).
 *
 * @returns {void}
 */
export function clearMirroredCardLang() {
  try {
    window.localStorage.removeItem(CARD_LANG_STORAGE_KEY);
  } catch (error) {
    console.warn('[CardLanguage] localStorage is not writable.', error);
  }
}

export class CardLanguage {
  constructor() {
    /** @type {string} Preference: `auto` or a language code. */
    this.preference = CARD_LANG_AUTO;
    /** @type {string} Language actually applied to the card data. */
    this.lang = DEFAULT_CARD_LANG;
    /** @type {string[]} Languages the card data is written in. */
    this.availableLangs = DEFAULT_CARD_LANGUAGES.slice();
    /** @type {string} Language used when the browser language is not available. */
    this.defaultLang = DEFAULT_CARD_LANG;
  }

  /**
   * Loads the card languages of `config.json` and applies the initial preference.
   *
   * Resolution order: explicit argument, mirrored `localStorage` value, then `auto`.
   *
   * @param {string|null} [preference=null] - Forced preference (`auto`, `fr`, `en`, ...).
   * @returns {Promise<string>} The language applied to the card data.
   * @throws {Error} When `config.json` cannot be loaded.
   */
  async init(preference = null) {
    this.availableLangs = await configLoader.getCardLanguages();
    this.defaultLang = await configLoader.getDefaultCardLang();

    this.preference =
      this.normalizePreference(preference ?? readMirroredCardLang()) ?? CARD_LANG_AUTO;
    this.lang = this.resolveLang(this.preference);
    return this.lang;
  }

  /**
   * Normalizes a raw language value against the languages of the card data.
   *
   * @param {unknown} lang - Candidate language code (e.g. "FR", "fr-FR").
   * @returns {string|null} A supported card language, or null.
   */
  normalizeLang(lang) {
    if (typeof lang !== 'string' || lang.trim() === '') return null;
    const lowered = lang.trim().toLowerCase();
    if (this.availableLangs.includes(lowered)) return lowered;
    const short = lowered.split(/[-_]/)[0];
    return this.availableLangs.includes(short) ? short : null;
  }

  /**
   * Normalizes a preference: either `auto` or one of the card languages.
   *
   * @param {unknown} value - Candidate preference.
   * @returns {string|null} `auto`, a supported card language, or null.
   */
  normalizePreference(value) {
    if (value === CARD_LANG_AUTO) return CARD_LANG_AUTO;
    return this.normalizeLang(value);
  }

  /**
   * Detects the browser language among the languages of the card data.
   *
   * @returns {string|null} A supported card language, or null when the browser speaks another one.
   */
  detectBrowserLang() {
    const candidates = [
      ...(Array.isArray(navigator.languages) ? navigator.languages : []),
      navigator.language,
    ];
    for (const candidate of candidates) {
      const normalized = this.normalizeLang(candidate);
      if (normalized) return normalized;
    }
    return null;
  }

  /**
   * Resolves the language applied to the card data for a preference.
   *
   * `auto` follows the browser and falls back to `config.json` (`en`): the cards never stay in a
   * language the catalogue does not carry.
   *
   * @param {string} [preference=this.preference] - `auto` or a language code.
   * @returns {string} The resolved language.
   */
  resolveLang(preference = this.preference) {
    return (
      this.normalizeLang(preference) ?? this.detectBrowserLang() ?? this.defaultLang
    );
  }

  /**
   * Currently applied preference (`auto` or a language code).
   *
   * @returns {string} The preference.
   */
  getPreference() {
    return this.preference;
  }

  /**
   * Language currently applied to the card data.
   *
   * @returns {string} The language code.
   */
  getLang() {
    return this.lang;
  }

  /**
   * Languages the card data is written in, in declaration order.
   *
   * @returns {string[]} A copy of the available language codes.
   */
  getAvailableLangs() {
    return this.availableLangs.slice();
  }

  /**
   * Options of the settings picker: the automatic mode first, then every card language.
   *
   * The automatic entry carries a translation key (it changes with the interface language), the
   * others carry the label declared in `config.json`.
   *
   * @returns {Promise<Array<{code: string, label?: string, labelKey?: string}>>} Picker options.
   * @throws {Error} When `config.json` cannot be loaded.
   */
  async getOptions() {
    const languages = await configLoader.getCardLanguageOptions();
    return [
      { code: CARD_LANG_AUTO, labelKey: 'settings.cardLanguage.auto' },
      ...languages,
    ];
  }

  /**
   * Applies a preference and emits `CARD_LANG_CHANGED`.
   *
   * Nothing is written when the preference is unknown: the previous one stays active and the
   * error is thrown, so the caller can report it instead of storing garbage.
   *
   * @param {string} preference - `auto` or a supported card language.
   * @param {object} [options] - Behaviour options.
   * @param {boolean} [options.mirror=true] - Refresh the `localStorage` mirror.
   * @returns {string} The language applied to the card data.
   * @throws {RangeError} When the preference is neither `auto` nor a declared card language.
   */
  setPreference(preference, { mirror = true } = {}) {
    const normalized = this.normalizePreference(preference);
    if (!normalized) {
      throw new RangeError(
        `Unknown card language "${preference}". Available: [${CARD_LANG_AUTO}, ${this.availableLangs.join(', ')}].`
      );
    }

    const previousLang = this.lang;
    const previousPreference = this.preference;
    this.preference = normalized;
    this.lang = this.resolveLang(normalized);

    if (mirror) writeMirroredCardLang(normalized);

    eventBus.emit(EVENTS.CARD_LANG_CHANGED, {
      lang: this.lang,
      previousLang,
      preference: this.preference,
      previousPreference,
    });
    return this.lang;
  }
}

/** Shared instance used by every view. */
export const cardLanguage = new CardLanguage();

export default cardLanguage;

/**
 * I18n - Translation and localized asset path manager.
 *
 * Reference: `.docs/main.md` section 3.F and `.docs/steps/1.md` point 5.
 *
 * Responsibilities:
 *   - load `settings/i18n/<code>.json` files (available languages come from `settings/config.json`);
 *   - translate DOM nodes tagged with `data-i18n*` attributes;
 *   - resolve card illustration paths (`/fr/` <-> `/en/`) without a page reload;
 *   - notify the application through the `LANG_CHANGED` event.
 *
 * The language preference is mirrored into `localStorage` (`mc_lang`) so the inline bootstrap
 * script of `index.html` can set `<html lang>` before the first paint. The authoritative value
 * lives in `user_state["settings"].lang` and is read/written by the business layer.
 *
 * Persistence policy: `I18n` never touches IndexedDB. It only refreshes the pre-render mirror;
 * storing the preference in `user_state["settings"]` is the caller's responsibility
 * (`AccountManager.updateSettings`).
 */

import { configLoader } from './ConfigLoader.js';
import eventBus, { EVENTS } from './EventBus.js';

/** Directory containing the translation files. */
export const I18N_DIRECTORY = 'settings/i18n';

/** `localStorage` key mirrored before the first paint (namespaced to avoid cross-project clashes). */
export const LANG_STORAGE_KEY = 'mc_lang';

/**
 * Placeholder found inside the illustration paths of the generated booster data
 * (e.g. "./cards/A1/<lang>/SERIE-A1 _ W001_classic.png"). It is replaced by the active language.
 */
export const LANG_PLACEHOLDER = '<lang>';

/** HTML attributes that can be translated, with the attribute each one fills. */
const TRANSLATABLE_ATTRIBUTES = Object.freeze([
  Object.freeze({ source: 'data-i18n', target: null }),
  Object.freeze({ source: 'data-i18n-title', target: 'title' }),
  Object.freeze({ source: 'data-i18n-placeholder', target: 'placeholder' }),
  Object.freeze({ source: 'data-i18n-aria-label', target: 'aria-label' }),
]);

/**
 * Reads the mirrored language from `localStorage`.
 *
 * @returns {string|null} The stored language code, or null when absent/unreadable.
 */
export function readMirroredLang() {
  try {
    return window.localStorage.getItem(LANG_STORAGE_KEY);
  } catch (error) {
    console.warn('[I18n] localStorage is not readable.', error);
    return null;
  }
}

/**
 * Writes the language mirror used before the first paint.
 *
 * @param {string} lang - Language code to mirror.
 * @returns {void}
 */
export function writeMirroredLang(lang) {
  try {
    window.localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch (error) {
    console.warn('[I18n] localStorage is not writable.', error);
  }
}

/**
 * Removes the language mirror (used by a full reset).
 *
 * @returns {void}
 */
export function clearMirroredLang() {
  try {
    window.localStorage.removeItem(LANG_STORAGE_KEY);
  } catch (error) {
    console.warn('[I18n] localStorage is not writable.', error);
  }
}

export class I18n {
  constructor() {
    /** @type {string|null} Currently applied language code. */
    this.lang = null;
    /** @type {string[]} Language codes declared in `config.json`. */
    this.availableLangs = [];
    /** @type {string|null} Language used as fallback when a key is missing. */
    this.defaultLang = null;
    /** @type {Map<string, object>} Loaded translation dictionaries, keyed by language code. */
    this.translations = new Map();
  }

  /**
   * Loads the configuration and applies the initial language.
   *
   * Resolution order: explicit argument, mirrored `localStorage` value, browser language
   * (`fr`/`en` only), then the `config.json` default.
   *
   * @param {string|null} [lang=null] - Forced language code (ignored when unavailable).
   * @returns {Promise<string>} The language that has been applied.
   * @throws {Error} When `config.json` or the translation file cannot be loaded.
   */
  async init(lang = null) {
    this.availableLangs = await configLoader.getLanguages();
    this.defaultLang = await configLoader.getDefaultLang();

    const candidate =
      this.normalizeLang(lang) ||
      this.normalizeLang(readMirroredLang()) ||
      this.detectBrowserLang() ||
      this.defaultLang;

    await this.setLang(candidate);
    return this.lang;
  }

  /**
   * Normalizes a raw language value against the available languages.
   *
   * @param {unknown} lang - Candidate language code (e.g. "FR", "fr-FR").
   * @returns {string|null} A supported language code, or null.
   */
  normalizeLang(lang) {
    if (typeof lang !== 'string' || lang.trim() === '') return null;
    const lowered = lang.trim().toLowerCase();
    if (this.availableLangs.includes(lowered)) return lowered;
    const short = lowered.split(/[-_]/)[0];
    return this.availableLangs.includes(short) ? short : null;
  }

  /**
   * Detects the browser language among the available languages.
   *
   * @returns {string|null} A supported language code, or null when the browser language
   *   does not match any declared language.
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
   * Loads and caches a translation dictionary.
   *
   * @param {string} lang - Language code to load.
   * @returns {Promise<object>} The flat dictionary of `key -> text` entries.
   * @throws {Error} When the file is missing, not valid JSON or not a JSON object.
   */
  async loadTranslations(lang) {
    if (this.translations.has(lang)) return this.translations.get(lang);

    const url = `${I18N_DIRECTORY}/${lang}.json`;
    let response;
    try {
      response = await fetch(url);
    } catch (error) {
      throw new Error(`Unable to fetch the translation file "${url}".`, { cause: error });
    }
    if (!response.ok) {
      throw new Error(`Unable to fetch the translation file "${url}" (HTTP ${response.status}).`);
    }

    let dictionary;
    try {
      dictionary = await response.json();
    } catch (error) {
      throw new Error(`The translation file "${url}" is not valid JSON.`, { cause: error });
    }
    if (!dictionary || typeof dictionary !== 'object' || Array.isArray(dictionary)) {
      throw new Error(`The translation file "${url}" must contain a JSON object of key/value pairs.`);
    }

    this.translations.set(lang, dictionary);
    return dictionary;
  }

  /**
   * Switches the active language: loads the dictionary, retranslates the DOM, updates the
   * `<html lang>` attribute, refreshes the `localStorage` mirror and emits `LANG_CHANGED`.
   *
   * Nothing is applied when the language is unknown or when its file fails to load: the
   * previous language stays active and the promise rejects.
   *
   * @param {string} lang - Target language code.
   * @param {object} [options] - Behaviour options.
   * @param {boolean} [options.applyToDom=true] - Re-translate the current DOM.
   * @param {boolean} [options.mirror=true] - Refresh the `localStorage` mirror.
   * @returns {Promise<string>} The applied language code.
   * @throws {RangeError} When the language is not declared in `config.json`.
   * @throws {Error} When the translation file cannot be loaded.
   */
  async setLang(lang, { applyToDom = true, mirror = true } = {}) {
    const requested = this.normalizeLang(lang);
    if (!requested) {
      throw new RangeError(
        `Unknown language "${lang}". Available languages: [${this.availableLangs.join(', ')}].`
      );
    }

    await this.loadTranslations(requested);
    await this.loadTranslations(this.defaultLang).catch((error) => {
      // The fallback dictionary is optional: a missing default file must not block a switch.
      console.warn('[I18n] Default language file is unavailable, fallback disabled.', error);
    });

    const previousLang = this.lang;
    this.lang = requested;

    if (mirror) writeMirroredLang(requested);
    if (applyToDom) this.applyToDom();

    eventBus.emit(EVENTS.LANG_CHANGED, { lang: this.lang, previousLang });
    return this.lang;
  }

  /**
   * Translates a key with optional `{placeholder}` interpolation.
   *
   * Lookup order: active language, default language, then the raw key (with a console warning
   * so a missing translation is visible during development).
   *
   * @param {string} key - Dot-separated key (e.g. "nav.opening").
   * @param {object} [params] - Values replacing `{name}` placeholders.
   * @returns {string} The translated text, or the key when no translation exists.
   * @throws {TypeError} When the key is not a non-empty string.
   */
  t(key, params = null) {
    if (typeof key !== 'string' || key === '') {
      throw new TypeError(`I18n.t expects a non-empty key (received: ${JSON.stringify(key)}).`);
    }

    const dictionary = this.translations.get(this.lang);
    const fallback = this.translations.get(this.defaultLang);
    let text = dictionary?.[key] ?? fallback?.[key];

    if (typeof text !== 'string') {
      console.warn(`[I18n] Missing translation for "${key}" (lang: ${this.lang}).`);
      return key;
    }

    if (params && typeof params === 'object') {
      text = text.replace(/\{(\w+)\}/g, (match, name) =>
        Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
      );
    }
    return text;
  }

  /**
   * Translates every tagged node of a subtree and updates `<html lang>`.
   *
   * Supported attributes: `data-i18n` (text content), `data-i18n-title`,
   * `data-i18n-placeholder`, `data-i18n-aria-label`.
   *
   * @param {ParentNode} [root=document] - Subtree to translate.
   * @returns {void}
   */
  applyToDom(root = document) {
    if (this.lang) {
      document.documentElement.lang = this.lang;
    }

    TRANSLATABLE_ATTRIBUTES.forEach(({ source, target }) => {
      root.querySelectorAll(`[${source}]`).forEach((element) => {
        const key = element.getAttribute(source);
        if (!key) return;
        const text = this.t(key);
        if (target) {
          element.setAttribute(target, text);
        } else {
          element.textContent = text;
        }
      });
    });
  }

  /**
   * Resolves a localized asset path.
   *
   * Two shapes are supported:
   *   1. the generated booster data placeholder: `./cards/A1/<lang>/SERIE-A1 _ W001_classic.png`
   *      -> `<lang>` is replaced by the active language;
   *   2. the documented scheme where the language is a path segment:
   *      `assets/img/cards/fr/042.png` -> `assets/img/cards/en/042.png`.
   * A path without any language marker is returned unchanged, so neutral assets
   * (`assets/img/badge/icon.png`) can be used as-is.
   *
   * @param {string} path - Raw path coming from a set JSON.
   * @returns {string} The path for the active language (returned as-is when empty).
   * @throws {TypeError} When the path is not a string.
   */
  resolveImagePath(path) {
    if (typeof path !== 'string') {
      throw new TypeError(`I18n.resolveImagePath expects a string (received: ${JSON.stringify(path)}).`);
    }
    if (path === '' || !this.lang) return path;

    if (path.includes(LANG_PLACEHOLDER)) {
      return path.split(LANG_PLACEHOLDER).join(this.lang);
    }

    const codes = this.availableLangs.length > 0 ? this.availableLangs : [this.lang];
    const pattern = new RegExp(`(^|/)(${codes.join('|')})(?=/)`, 'i');
    if (!pattern.test(path)) return path;

    return path.replace(pattern, (match, prefix) => `${prefix}${this.lang}`);
  }

  /**
   * Currently applied language code.
   *
   * @returns {string|null} The language code, or null before `init()`.
   */
  getLang() {
    return this.lang;
  }

  /**
   * Languages declared in `config.json`.
   *
   * @returns {string[]} A copy of the available language codes.
   */
  getAvailableLangs() {
    return this.availableLangs.slice();
  }

  /**
   * Languages with their display labels, for language pickers.
   *
   * @returns {Promise<Array<{code: string, label: string}>>} Language descriptors.
   * @throws {Error} When `config.json` cannot be loaded.
   */
  async getLanguageOptions() {
    return configLoader.getLanguageOptions();
  }
}

/** Shared instance used by every view. */
export const i18n = new I18n();

export default i18n;

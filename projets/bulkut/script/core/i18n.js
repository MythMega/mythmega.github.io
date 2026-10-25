/**
 * Internationalisation: lazy-load translation files, detect the browser
 * language, fall back to English and re-apply translations to the DOM.
 * @module core/i18n
 */

export const LANGUAGE_LABELS = {
  en: 'English',
  fr: 'Français',
  es: 'Español',
};

/** @param {Record<string, any>} source @param {string} key */
function lookup(source, key) {
  return key.split('.').reduce((value, part) => {
    if (value && typeof value === 'object' && part in value) return value[part];
    return undefined;
  }, source);
}

/** @param {string} template @param {Record<string, unknown>} [vars] */
function interpolate(template, vars = {}) {
  return template.replace(/\{(\w+)\}/g, (match, name) => {
    if (!(name in vars)) return match;
    const value = vars[name];
    return value === null || value === undefined ? '' : String(value);
  });
}

export class I18n {
  /** @type {Map<string, Record<string, any>>} */
  #cache = new Map();
  /** @type {Set<(lang: string) => void>} */
  #listeners = new Set();
  #warned = new Set();

  /**
   * @param {object} options
   * @param {string} [options.basePath]
   * @param {string[]} [options.languages]
   * @param {string} [options.fallback]
   * @param {string} [options.defaultLanguage] "auto" or a language code
   * @param {string} [options.storageKey]
   */
  constructor({
    basePath = 'translations',
    languages = ['en'],
    fallback = 'en',
    defaultLanguage = 'auto',
    storageKey = 'bulkut.lang',
  } = {}) {
    this.basePath = basePath;
    this.languages = languages.length ? languages : [fallback];
    this.fallback = this.languages.includes(fallback) ? fallback : this.languages[0];
    this.defaultLanguage = defaultLanguage;
    this.storageKey = storageKey;
    /** @type {string} */
    this.lang = this.fallback;
  }

  /** @param {string} [candidate] @returns {string|null} */
  #match(candidate) {
    if (!candidate) return null;
    const value = String(candidate).toLowerCase();
    if (this.languages.includes(value)) return value;
    const base = value.split('-')[0];
    return this.languages.includes(base) ? base : null;
  }

  /** @returns {string} */
  detect() {
    const candidates = [];
    if (Array.isArray(navigator.languages)) candidates.push(...navigator.languages);
    if (navigator.language) candidates.push(navigator.language);
    for (const candidate of candidates) {
      const match = this.#match(candidate);
      if (match) return match;
    }
    return this.fallback;
  }

  /** @param {string} [candidate] @returns {string} */
  resolve(candidate) {
    if (candidate === 'auto') return this.detect();
    return this.#match(candidate) ?? this.detect();
  }

  /** @param {string} lang */
  async #load(lang) {
    if (this.#cache.has(lang)) return this.#cache.get(lang);
    const base = new URL(this.basePath.replace(/\/?$/, '/'), document.baseURI);
    const url = new URL(`${lang}.json`, base);
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status} while loading ${url.pathname}`);
    const data = await response.json();
    this.#cache.set(lang, data && typeof data === 'object' ? data : {});
    return this.#cache.get(lang);
  }

  /** Load the active language plus the fallback. */
  async init() {
    let stored = null;
    try {
      stored = localStorage.getItem(this.storageKey);
    } catch {
      /* ignore */
    }

    const wanted = this.resolve(stored || this.defaultLanguage);
    try {
      await this.#load(wanted);
      this.lang = wanted;
    } catch (error) {
      console.warn('[Bulkut] Could not load translations, falling back to English.', error);
      this.lang = this.fallback;
    }

    if (!this.#cache.has(this.fallback)) {
      try {
        await this.#load(this.fallback);
      } catch (error) {
        console.error('[Bulkut] Missing translation files.', error);
      }
    }

    document.documentElement.lang = this.lang;
  }

  /**
   * @param {string} lang
   * @returns {Promise<string>} the language actually applied
   */
  async setLang(lang) {
    const next = this.resolve(lang);
    if (next === this.lang) return this.lang;

    try {
      await this.#load(next);
      this.lang = next;
    } catch (error) {
      console.warn(`[Bulkut] Language "${next}" unavailable.`, error);
      return this.lang;
    }

    try {
      localStorage.setItem(this.storageKey, this.lang);
    } catch {
      /* ignore */
    }

    document.documentElement.lang = this.lang;
    for (const listener of this.#listeners) listener(this.lang);
    return this.lang;
  }

  /** @param {(lang: string) => void} listener */
  onChange(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** @param {string} key @param {Record<string, unknown>} [vars] @returns {string} */
  t(key, vars = {}) {
    const value =
      lookup(this.#cache.get(this.lang), key) ??
      lookup(this.#cache.get(this.fallback), key);

    if (typeof value !== 'string') {
      if (!this.#warned.has(key)) {
        this.#warned.add(key);
        console.warn(`[Bulkut] Missing translation key: ${key}`);
      }
      return key;
    }
    return interpolate(value, vars);
  }

  /** @param {string} key @returns {boolean} */
  has(key) {
    const value =
      lookup(this.#cache.get(this.lang), key) ??
      lookup(this.#cache.get(this.fallback), key);
    return typeof value === 'string';
  }

  /** @param {string} code */
  languageLabel(code) {
    return LANGUAGE_LABELS[code] ?? code.toUpperCase();
  }

  /**
   * Apply translations to static markup and dynamic nodes.
   * @param {ParentNode} [root]
   */
  apply(root = document) {
    for (const node of root.querySelectorAll('[data-i18n]')) {
      const key = node.getAttribute('data-i18n');
      if (key) node.textContent = this.t(key);
    }
    for (const node of root.querySelectorAll('[data-i18n-placeholder]')) {
      const key = node.getAttribute('data-i18n-placeholder');
      if (key) node.setAttribute('placeholder', this.t(key));
    }
    for (const node of root.querySelectorAll('[data-i18n-title]')) {
      const key = node.getAttribute('data-i18n-title');
      if (key) node.setAttribute('title', this.t(key));
    }
    for (const node of root.querySelectorAll('[data-i18n-aria-label]')) {
      const key = node.getAttribute('data-i18n-aria-label');
      if (key) node.setAttribute('aria-label', this.t(key));
    }
  }
}

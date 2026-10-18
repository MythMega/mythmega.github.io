/**
 * ThemeManager - Applies the active theme through `data-theme` attributes.
 *
 * Reference: `.docs/main.md` section 3.F and `.docs/steps/1.md` point 6.
 *
 * The theme is exposed as CSS custom properties declared for
 * `body[data-theme="dark"|"light"|"classic"]` in `css/themes.css`. Dark is the default and is
 * also declared on `:root` so the very first paint (before the inline bootstrap script runs)
 * is already dark. The attribute is duplicated on `<html>` and `<body>`: the inline script
 * runs while `<body>` does not exist yet and must already be able to pick a theme.
 *
 * The available themes come from `settings/config.json` (`themes`), so adding a theme only
 * requires a new CSS block and a new `config.json` entry.
 *
 * The preference is mirrored into `localStorage` (`mc_theme`) for the pre-render script; the
 * authoritative value lives in `user_state["settings"].theme` (written by the caller).
 */

import { configLoader } from './ConfigLoader.js';
import eventBus, { EVENTS } from './EventBus.js';

/** `localStorage` key mirrored before the first paint (namespaced to avoid cross-project clashes). */
export const THEME_STORAGE_KEY = 'mc_theme';

/**
 * Color of the browser chrome for each theme (mirrors the `--color-bg` of `css/themes.css`).
 *
 * The pre-render bootstrap of `index.html` owns its own copy for the very first paint; this one
 * keeps the meta tag right when the player switches theme without reloading.
 */
const THEME_COLORS = {
  dark: '#0b0e14',
  light: '#eef1f8',
  classic: '#efe3c8',
  day: '#7fc0ea',
  night: '#050b1c',
};

/** Themes that draw the decorative layer (clouds or stars) behind the application. */
const DECORATED_THEMES = new Set(['day', 'night']);

/** Number of clouds of the day theme. */
const CLOUD_COUNT = 14;

/** Number of stars of the night theme. */
const STAR_COUNT = 220;

/**
 * Reads the mirrored theme from `localStorage`.
 *
 * @returns {string|null} The stored theme id, or null when absent/unreadable.
 */
export function readMirroredTheme() {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch (error) {
    console.warn('[ThemeManager] localStorage is not readable.', error);
    return null;
  }
}

/**
 * Writes the theme mirror used before the first paint.
 *
 * @param {string} theme - Theme id to mirror.
 * @returns {void}
 */
export function writeMirroredTheme(theme) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch (error) {
    console.warn('[ThemeManager] localStorage is not writable.', error);
  }
}

/**
 * Removes the theme mirror (used by a full reset).
 *
 * @returns {void}
 */
export function clearMirroredTheme() {
  try {
    window.localStorage.removeItem(THEME_STORAGE_KEY);
  } catch (error) {
    console.warn('[ThemeManager] localStorage is not writable.', error);
  }
}

export class ThemeManager {
  constructor() {
    /** @type {string|null} Currently applied theme id. */
    this.theme = null;
    /** @type {string[]} Theme ids declared in `config.json`. */
    this.availableThemes = [];
    /** @type {string|null} Fallback theme id. */
    this.defaultTheme = null;
  }

  /**
   * Loads the theme list and applies the initial theme.
   *
   * Resolution order: mirrored `localStorage` value, then the `config.json` default.
   *
   * @returns {Promise<string>} The theme that has been applied.
   * @throws {Error} When `config.json` cannot be loaded.
   * @throws {RangeError} When the resolved theme is not declared.
   */
  async init() {
    await this.loadAvailableThemes();
    const target = this.normalizeTheme(readMirroredTheme()) || this.defaultTheme;
    return this.applyTheme(target);
  }

  /**
   * Loads the theme ids and the default theme from `config.json`.
   *
   * @returns {Promise<Array<{id: string, labelKey: string}>>} Theme descriptors.
   * @throws {Error} When `config.json` cannot be loaded.
   */
  async loadAvailableThemes() {
    const options = await configLoader.getThemeOptions();
    this.availableThemes = options.map((option) => option.id);
    this.defaultTheme = await configLoader.getDefaultTheme();
    return options;
  }

  /**
   * Applies a theme: sets `data-theme` on `<html>` and `<body>`, refreshes the mirror and
   * emits `THEME_CHANGED`.
   *
   * @param {string} theme - Theme id (e.g. "dark", "light", "classic").
   * @param {object} [options] - Behaviour options.
   * @param {boolean} [options.mirror=true] - Refresh the `localStorage` mirror.
   * @returns {string} The applied theme id.
   * @throws {RangeError} When the theme is not declared in `config.json`.
   */
  applyTheme(theme, { mirror = true } = {}) {
    const requested = this.normalizeTheme(theme);
    if (!requested) {
      throw new RangeError(
        `Unknown theme "${theme}". Available themes: [${this.availableThemes.join(', ')}].`
      );
    }

    const previousTheme = this.theme;
    this.theme = requested;

    document.documentElement.dataset.theme = requested;
    if (document.body) {
      document.body.dataset.theme = requested;
    }
    if (mirror) writeMirroredTheme(requested);
    this.renderScenery(requested);
    const themeColor = document.getElementById('meta-theme-color');
    if (themeColor && THEME_COLORS[requested]) {
      themeColor.setAttribute('content', THEME_COLORS[requested]);
    }

    eventBus.emit(EVENTS.THEME_CHANGED, { theme: requested, previousTheme });
    return requested;
  }

  /**
   * Fills the decorative layer of the sky themes: clouds for `day`, stars for `night`.
   *
   * The layer is a single fixed element behind the application (`data-theme-scenery` in
   * `index.html`). The other themes own no decoration at all, so the layer is simply emptied: the
   * palettes of `dark`, `light` and `classic` are untouched.
   *
   * @param {string} theme - Theme being applied.
   * @returns {void}
   */
  renderScenery(theme) {
    const layer = document.querySelector('[data-theme-scenery]');
    if (!layer) return;
    layer.textContent = '';
    if (!DECORATED_THEMES.has(theme)) return;
    if (theme === 'day') {
      this.renderClouds(layer);
    } else {
      this.renderStars(layer);
    }
  }

  /**
   * Scatters blocky clouds of different sizes across the day sky.
   *
   * @param {HTMLElement} layer - Decorative layer.
   * @returns {void}
   */
  renderClouds(layer) {
    for (let index = 0; index < CLOUD_COUNT; index += 1) {
      const cloud = document.createElement('span');
      cloud.className = 'theme-scenery__cloud';
      const duration = 70 + Math.random() * 80;
      cloud.style.width = `${90 + Math.random() * 180}px`;
      cloud.style.height = `${28 + Math.random() * 38}px`;
      cloud.style.top = `${Math.random() * 82}%`;
      cloud.style.opacity = String(0.6 + Math.random() * 0.2);
      cloud.style.animationDuration = `${duration.toFixed(1)}s`;
      // A negative delay spreads the clouds out immediately instead of leaving the sky empty.
      cloud.style.animationDelay = `${(-Math.random() * duration).toFixed(1)}s`;
      layer.appendChild(cloud);
    }
  }

  /**
   * Scatters the stars of the night sky, with their own size, glow and twinkle.
   *
   * @param {HTMLElement} layer - Decorative layer.
   * @returns {void}
   */
  renderStars(layer) {
    for (let index = 0; index < STAR_COUNT; index += 1) {
      const star = document.createElement('span');
      star.className = 'theme-scenery__star';
      const roll = Math.random();
      const size = roll < 0.78 ? 1 : roll < 0.96 ? 2 + Math.random() * 0.8 : 3 + Math.random();
      star.style.left = `${Math.random() * 100}%`;
      star.style.top = `${Math.random() * 100}%`;
      star.style.width = `${size.toFixed(2)}px`;
      star.style.height = star.style.width;
      star.style.setProperty('--star-opacity', (0.35 + Math.random() * 0.65).toFixed(2));
      star.style.animationDuration = `${(2.5 + Math.random() * 4).toFixed(2)}s`;
      star.style.animationDelay = `${(-Math.random() * 6).toFixed(2)}s`;
      layer.appendChild(star);
    }
  }

  /**
   * Normalizes a raw theme value against the available themes.
   *
   * @param {unknown} theme - Candidate theme id (case-insensitive).
   * @returns {string|null} A declared theme id, or null when the value is unusable.
   */
  normalizeTheme(theme) {
    if (typeof theme !== 'string' || theme.trim() === '') return null;
    const normalized = theme.trim().toLowerCase();
    if (this.availableThemes.length === 0) {
      // Theme list not loaded yet (early bootstrap): keep the requested value so the first
      // paint still matches the user preference instead of falling back silently.
      console.warn('[ThemeManager] Theme list not loaded yet, applying the requested value as-is.');
      return normalized;
    }
    return this.availableThemes.includes(normalized) ? normalized : null;
  }

  /**
   * Checks whether a theme is declared in `config.json`.
   *
   * @param {unknown} theme - Candidate theme id.
   * @returns {boolean} True when the theme exists.
   */
  isAvailableTheme(theme) {
    return typeof theme === 'string' && this.availableThemes.includes(theme.trim().toLowerCase());
  }

  /**
   * Currently applied theme id.
   *
   * @returns {string|null} The theme id, or null before `init()`.
   */
  getTheme() {
    return this.theme;
  }

  /**
   * Theme ids declared in `config.json`.
   *
   * @returns {string[]} A copy of the available theme ids.
   */
  getAvailableThemes() {
    return this.availableThemes.slice();
  }

  /**
   * Themes with their i18n label keys, for theme pickers.
   *
   * @returns {Promise<Array<{id: string, labelKey: string}>>} Theme descriptors.
   * @throws {Error} When `config.json` cannot be loaded.
   */
  async getThemeOptions() {
    return configLoader.getThemeOptions();
  }
}

/** Shared instance used by settings views (step 6) and by the app bootstrap. */
export const themeManager = new ThemeManager();

export default themeManager;

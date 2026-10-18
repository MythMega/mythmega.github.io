/**
 * GlowManager - How strong the halo around a trophy medal is.
 *
 * Reference: `settings/config.json` (`glow.trophies`), `css/components/trophy.css` (the halos),
 * `css/components/profile-card.css` (the medals of the profile card) and `.docs/main.md` section
 * 3.G nonies.
 *
 * ONE LEVER, ONE UNIT
 *   The setting is a LEVEL, from 0 to 5 (2 by default), not a percentage: "no halo", then the four
 *   steps a player can actually tell apart. `0` switches the effect off completely, and the
 *   stylesheets stop painting anything. The level is published on `<html>` as the FACTOR
 *   `--trophy-glow-scale`, which every halo multiplies into its radius: level 2 (the tuned value)
 *   is a factor of 1, level 5 doubles the radius, level 1 halves it. The colour and the shape of a
 *   halo belong to the rarity (bronze has none, silver and gold are light, diamond and emerald are
 *   medium), never to this module: it only scales them, so a new rarity costs a rule and no code.
 *
 * WHY A CUSTOM PROPERTY
 *   The same halos are painted by three surfaces (the trophy catalogue, the pinned trophies of the
 *   profile and the medals of the profile card). A variable inherited from `<html>` reaches all of
 *   them, keeps the live preview of the settings slider free, and is serialized into the exported
 *   PNG of the card as soon as `ProfileCard` also sets it inline (the export document has no
 *   `<html>` of the game to inherit from).
 *
 * This module never touches IndexedDB: the authoritative value lives in
 * `user_state["settings"].glowTrophies`, written by `AccountManager.updateSettings`.
 */

import { configLoader, DEFAULT_GLOW_SETTINGS } from './ConfigLoader.js';

/** Custom property carrying the strength of every trophy halo, as a 0-N factor. */
export const TROPHY_GLOW_VARIABLE = '--trophy-glow-scale';

export class GlowManager {
  constructor() {
    /** @type {number} Currently applied level. */
    this.level = DEFAULT_GLOW_SETTINGS.default;
    /** @type {{min: number, max: number, step: number, default: number}} Declared bounds. */
    this.settings = { ...DEFAULT_GLOW_SETTINGS };
  }

  /**
   * Logs with the manager prefix.
   *
   * @param {...unknown} args - Values forwarded to `console.info`.
   * @returns {void}
   */
  log(...args) {
    console.info('[GlowManager]', ...args);
  }

  /**
   * Loads the declared range and applies its default.
   *
   * The stored preference is applied later by `js/app.js` (it comes from IndexedDB), exactly like
   * the theme and the foil: this call only guarantees that the variable exists before the first
   * trophy is drawn.
   *
   * @returns {Promise<number>} The applied level.
   * @throws {Error} When `config.json` cannot be loaded.
   */
  async init() {
    await this.loadSettings();
    return this.applyLevel(this.settings.default);
  }

  /**
   * Reads the range of the slider from `config.json`.
   *
   * @returns {Promise<{min: number, max: number, step: number, default: number}>} The bounds.
   * @throws {Error} When `config.json` cannot be loaded.
   */
  async loadSettings() {
    this.settings = await configLoader.getGlowSettings();
    return { ...this.settings };
  }

  /**
   * Reads the declared bounds (without touching the configuration).
   *
   * @returns {{min: number, max: number, step: number, default: number}} The bounds.
   */
  getSettings() {
    return { ...this.settings };
  }

  /**
   * The level currently applied.
   *
   * @returns {number} The level, between `min` and `max`.
   */
  getLevel() {
    return this.level;
  }

  /**
   * Brings any value back into the declared range.
   *
   * A level coming from a save written with a wider range is clamped rather than rejected: a
   * preference can never break the screen it dresses.
   *
   * @param {unknown} value - Requested level.
   * @returns {number} A whole level inside the declared bounds.
   * @throws {TypeError} When the value is not a number at all.
   */
  sanitizeLevel(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(`A glow level must be a finite number (received: ${JSON.stringify(value)}).`);
    }
    const { min, max } = this.settings;
    return Math.min(max, Math.max(min, Math.round(value)));
  }

  /**
   * Converts a level into the factor the stylesheets multiply.
   *
   * The declared default is the reference (factor 1), so retuning the slider never changes the
   * intensity the halos were designed at.
   *
   * @param {number} level - Level to convert.
   * @returns {number} The factor (0 when the effect is off).
   */
  toScale(level = this.level) {
    const sanitized = this.sanitizeLevel(level);
    if (sanitized <= 0) return 0;
    const reference = this.settings.default > 0 ? this.settings.default : 1;
    return sanitized / reference;
  }

  /**
   * Applies a level: custom property on `<html>` and the current value.
   *
   * @param {number} level - Requested level (clamped to the declared range).
   * @returns {number} The applied level.
   * @throws {TypeError} When the value is not a finite number.
   */
  applyLevel(level) {
    const applied = this.sanitizeLevel(level);
    this.level = applied;
    const root = document.documentElement;
    if (root) {
      root.style.setProperty(TROPHY_GLOW_VARIABLE, String(this.toScale(applied)));
    }
    this.log(`Trophy glow: level ${applied} (scale ${this.toScale(applied)}).`);
    return applied;
  }
}

/** Shared instance used by the settings screen, the boot sequence and the profile card. */
export const glowManager = new GlowManager();

export default glowManager;

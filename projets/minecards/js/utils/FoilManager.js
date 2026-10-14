/**
 * FoilManager - How strong the foil of the legendary and mythic printings is.
 *
 * Reference: `settings/config.json` (`foil`), `css/components/card-shine.css` and
 * `.docs/main.md` section 3.G quinquies.
 *
 * HOW IT IS APPLIED
 *   - `--foil-intensity` (a factor from 0 to 1, 1 by default) is published on `<html>`, and both
 *     planes of `css/components/card-shine.css` multiply their own opacity by it. One lever, placed
 *     where every layer meets: the gradients, the glints and the honeycomb data-URI alike, which no
 *     variable could tint on its own;
 *   - `data-foil="off"` is set on `<html>` AND on `<body>` when the intensity is zero, exactly like
 *     `data-theme` and `data-animation`. The planes are transparent at that point, so the stylesheet
 *     stops their animation instead of letting it run unseen;
 *   - `FOIL_INTENSITY_CHANGED` is emitted with `{ percent, previousPercent, intensity }`, so the
 *     settings screen and the collection can reflect the same value.
 *
 * THE UNIT
 * A percentage (0-100), never the 0-1 factor: the slider, `config.json` and the save file all speak
 * percentages, and `toIntensity()` is the single place that converts. A percentage is also what a
 * human edits in the configuration without wondering whether 1 means "off" or "full".
 *
 * CLAMPING RATHER THAN THROWING
 * An unknown animation mode is a mistake worth a `RangeError` (a mode is a discrete id), but an
 * intensity is a continuous value: a stored 120 coming from a save file written with a wider range
 * is simply clamped to the configured maximum, and the game keeps playing. Only a value that is not
 * a number at all throws, because that one is a programming error.
 *
 * This module never touches IndexedDB: the authoritative value lives in
 * `user_state["settings"].foilIntensity` and is written by `AccountManager.updateSettings`.
 */

import { configLoader, DEFAULT_FOIL_SETTINGS } from './ConfigLoader.js';
import eventBus, { EVENTS } from './EventBus.js';

/** Custom property carrying the strength of the foil, as a 0-1 factor. */
export const FOIL_INTENSITY_VARIABLE = '--foil-intensity';

/** Attribute flagging the document when the foil is switched off (intensity 0). */
export const FOIL_ATTRIBUTE = 'data-foil';

export class FoilManager {
  constructor() {
    /** @type {number} Currently applied intensity, in percents. */
    this.percent = DEFAULT_FOIL_SETTINGS.default;
    /** @type {{min: number, max: number, step: number, default: number}} Declared bounds. */
    this.settings = { ...DEFAULT_FOIL_SETTINGS };
  }

  /**
   * Logs with the manager prefix.
   *
   * @param {...unknown} args - Values forwarded to `console.info`.
   * @returns {void}
   */
  log(...args) {
    console.info('[FoilManager]', ...args);
  }

  /**
   * Loads the declared range and applies the default intensity.
   *
   * The stored preference is applied later by `js/app.js` (it comes from IndexedDB), exactly like
   * the theme and the animation mode: this call only guarantees that `--foil-intensity` exists
   * before the first card is rendered.
   *
   * @returns {Promise<number>} The applied intensity, in percents.
   * @throws {Error} When `config.json` cannot be loaded.
   */
  async init() {
    await this.loadSettings();
    return this.applyIntensity(this.settings.default);
  }

  /**
   * Reads the bounds from `config.json`.
   *
   * @returns {Promise<{min: number, max: number, step: number, default: number}>} The bounds, and
   *   the manager's own settings.
   * @throws {Error} When `config.json` cannot be loaded.
   */
  async loadSettings() {
    this.settings = await configLoader.getFoilSettings();
    return this.settings;
  }

  /**
   * Applies an intensity: custom property, `data-foil` flag and `FOIL_INTENSITY_CHANGED`.
   *
   * @param {number} percent - Requested intensity, in percents (clamped to the declared range).
   * @returns {number} The applied intensity, in percents.
   * @throws {TypeError} When the value is not a finite number.
   */
  applyIntensity(percent) {
    const requested = this.normalizePercent(percent);
    const previousPercent = this.percent;
    this.percent = requested;

    const intensity = this.toIntensity(requested);
    const root = document.documentElement;
    if (root?.style) {
      root.style.setProperty(FOIL_INTENSITY_VARIABLE, String(intensity));
    }

    /* Also mirrored on `<body>` like the theme and the animation mode, so a rule that needs the
       value before `<body>` exists can still use the `<html>` one. */
    const isOff = requested === 0 ? 'off' : null;
    [root, document.body].forEach((element) => {
      if (!element) return;
      if (isOff) {
        element.setAttribute(FOIL_ATTRIBUTE, isOff);
      } else {
        element.removeAttribute(FOIL_ATTRIBUTE);
      }
    });

    eventBus.emit(EVENTS.FOIL_INTENSITY_CHANGED, {
      percent: requested,
      previousPercent,
      intensity,
    });
    this.log(`Foil intensity applied: ${requested} % (factor ${intensity}).`);
    return requested;
  }

  /**
   * Re-applies the configured default intensity.
   *
   * @returns {number} The applied intensity, in percents.
   */
  applyDefaultIntensity() {
    return this.applyIntensity(this.settings.default);
  }

  /**
   * Turns a raw value into an intensity the range accepts.
   *
   * The value is rounded to the nearest step ABOVE the minimum (so the slider's marks stay
   * reachable) and then clamped, which keeps a stored value usable even after `config.json` moved
   * its bounds.
   *
   * @param {unknown} value - Raw intensity, in percents.
   * @returns {number} A whole number within `[min, max]`.
   * @throws {TypeError} When the value is not a finite number.
   */
  normalizePercent(value) {
    const { min, max, step } = this.settings;
    const number = Number(value);
    if (!Number.isFinite(number)) {
      throw new TypeError(`FoilManager expects a number (received: ${JSON.stringify(value)}).`);
    }
    const stepped = min + Math.round((number - min) / step) * step;
    return Math.min(Math.max(Math.round(stepped), min), max);
  }

  /**
   * Converts a percentage into the factor the stylesheet multiplies its opacities by.
   *
   * @param {number} [percent] - Intensity in percents (the active one by default).
   * @returns {number} A factor between 0 and 1.
   */
  toIntensity(percent = this.percent) {
    return Math.min(Math.max(percent / 100, 0), 1);
  }

  /**
   * Currently applied intensity.
   *
   * @returns {number} The intensity, in percents.
   */
  getPercent() {
    return this.percent;
  }

  /**
   * Tells whether the foil is painted at all.
   *
   * @returns {boolean} False only when the intensity is zero.
   */
  isEnabled() {
    return this.percent > 0;
  }

  /**
   * The declared range, with its default.
   *
   * @returns {{min: number, max: number, step: number, default: number}} A copy of the bounds, so a
   *   caller can not edit the manager's own settings by accident.
   */
  getSettings() {
    return { ...this.settings };
  }

  /**
   * Normalizes a stored value without applying anything.
   *
   * Used by `AccountManager` to validate what it is about to write, so an out-of-range value is
   * corrected at the moment it is saved rather than at the next startup.
   *
   * @param {unknown} value - Raw intensity, in percents.
   * @returns {number} A whole number within the declared range.
   * @throws {TypeError} When the value is not a finite number.
   */
  sanitizePercent(value) {
    return this.normalizePercent(value);
  }
}

/** Shared instance used by `js/app.js` and the settings view. */
export const foilManager = new FoilManager();

export default foilManager;

/**
 * FoilManager - How strong the foil of the super rare, legendary and mythic printings is, and how
 * bright the line sweeping across them is.
 *
 * Reference: `settings/config.json` (`foil` and `foil.glare`), `css/components/card-shine.css` and
 * `.docs/main.md` section 3.G quinquies.
 *
 * TWO EFFECTS, TWO LEVERS
 * A foil is made of two things that a player may want to tune apart, so they have one slider each:
 *   - the FOIL (`--foil-intensity`): the shapes of the print - the bevelled edge, the embossed grid,
 *     the honeycomb of a mythic, the diagonal weave of a super rare. It is painted by the two planes
 *     of `css/components/card-shine.css`, which multiply their own opacity by this factor;
 *   - the BRILLANCE (`--glare-intensity`): the bright line that crosses the artwork, back and forth
 *     (`.card-shine__gleam`, in the same stylesheet). The line is its own layer, which is exactly what
 *     lets it have its own strength: muting it keeps the shapes, and vice versa.
 * Both factors go from 0 to 1 (1 by default) and are published on `<html>`. One lever per effect,
 * placed where the layers meet: the gradients, the glints and the honeycomb data-URI alike, which no
 * variable could tint on its own.
 *
 * `data-foil="off"` is set on `<html>` AND on `<body>` when the FOIL intensity is zero, exactly like
 * `data-theme` and `data-animation`. The planes are transparent at that point, so the stylesheet stops
 * their animation instead of letting it run unseen; the line follows the same flag, since a print
 * without its foil has no moving reflection left. `FOIL_INTENSITY_CHANGED` and
 * `GLARE_INTENSITY_CHANGED` are emitted with `{ percent, previousPercent, intensity }`, so the settings
 * screen and the collection can reflect the same values.
 *
 * THE UNIT
 * A percentage (0-100), never the 0-1 factor: the sliders, `config.json` and the save file all speak
 * percentages, and `toIntensity()` is the single place that converts. A percentage is also what a
 * human edits in the configuration without wondering whether 1 means "off" or "full".
 *
 * CLAMPING RATHER THAN THROWING
 * An unknown animation mode is a mistake worth a `RangeError` (a mode is a discrete id), but an
 * intensity is a continuous value: a stored 120 coming from a save file written with a wider range
 * is simply clamped to the configured maximum, and the game keeps playing. Only a value that is not
 * a number at all throws, because that one is a programming error.
 *
 * This module never touches IndexedDB: the authoritative values live in
 * `user_state["settings"].foilIntensity` and `user_state["settings"].glareIntensity`, both written by
 * `AccountManager.updateSettings`.
 */

import { configLoader, DEFAULT_FOIL_SETTINGS, DEFAULT_GLARE_SETTINGS } from './ConfigLoader.js';
import eventBus, { EVENTS } from './EventBus.js';

/** Custom property carrying the strength of the foil, as a 0-1 factor. */
export const FOIL_INTENSITY_VARIABLE = '--foil-intensity';

/** Custom property carrying the strength of the sweeping line, as a 0-1 factor. */
export const GLARE_INTENSITY_VARIABLE = '--glare-intensity';

/** Attribute flagging the document when the foil is switched off (intensity 0). */
export const FOIL_ATTRIBUTE = 'data-foil';

export class FoilManager {
  constructor() {
    /** @type {number} Currently applied foil intensity, in percents. */
    this.percent = DEFAULT_FOIL_SETTINGS.default;
    /** @type {{min: number, max: number, step: number, default: number}} Declared foil bounds. */
    this.settings = { ...DEFAULT_FOIL_SETTINGS };
    /** @type {number} Currently applied brillance, in percents. */
    this.glarePercent = DEFAULT_GLARE_SETTINGS.default;
    /** @type {{min: number, max: number, step: number, default: number}} Declared glare bounds. */
    this.glareSettings = { ...DEFAULT_GLARE_SETTINGS };
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
   * Loads the two declared ranges and applies both defaults.
   *
   * The stored preferences are applied later by `js/app.js` (they come from IndexedDB), exactly like
   * the theme and the animation mode: this call only guarantees that `--foil-intensity` and
   * `--glare-intensity` exist before the first card is rendered.
   *
   * @returns {Promise<{foil: number, glare: number}>} The applied intensities, in percents.
   * @throws {Error} When `config.json` cannot be loaded.
   */
  async init() {
    await this.loadSettings();
    return {
      foil: this.applyIntensity(this.settings.default),
      glare: this.applyGlareIntensity(this.glareSettings.default),
    };
  }

  /**
   * Reads the two ranges from `config.json`.
   *
   * @returns {Promise<{foil: {min: number, max: number, step: number, default: number},
   *   glare: {min: number, max: number, step: number, default: number}}>} The bounds.
   * @throws {Error} When `config.json` cannot be loaded.
   */
  async loadSettings() {
    this.settings = await configLoader.getFoilSettings();
    this.glareSettings = await configLoader.getGlareSettings();
    return { foil: { ...this.settings }, glare: { ...this.glareSettings } };
  }

  /**
   * Applies a foil intensity: custom property, `data-foil` flag and `FOIL_INTENSITY_CHANGED`.
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
   * Applies a brillance: custom property and `GLARE_INTENSITY_CHANGED`.
   *
   * Unlike the foil, this one flips no `data-*` flag of its own: the sweeping line is animated by the
   * `data-foil="off"` flag of the foil it belongs to, so a foil switched off stops both planes and
   * the line at once, without two flags that could ever disagree.
   *
   * @param {number} percent - Requested brillance, in percents (clamped to the declared range).
   * @returns {number} The applied brillance, in percents.
   * @throws {TypeError} When the value is not a finite number.
   */
  applyGlareIntensity(percent) {
    const requested = this.normalizeGlarePercent(percent);
    const previousPercent = this.glarePercent;
    this.glarePercent = requested;

    const intensity = this.toIntensity(requested);
    const root = document.documentElement;
    if (root?.style) {
      root.style.setProperty(GLARE_INTENSITY_VARIABLE, String(intensity));
    }

    eventBus.emit(EVENTS.GLARE_INTENSITY_CHANGED, {
      percent: requested,
      previousPercent,
      intensity,
    });
    this.log(`Glare intensity applied: ${requested} % (factor ${intensity}).`);
    return requested;
  }

  /**
   * Re-applies the configured default intensities (foil and brillance).
   *
   * @returns {{foil: number, glare: number}} The applied intensities, in percents.
   */
  applyDefaultIntensity() {
    return {
      foil: this.applyIntensity(this.settings.default),
      glare: this.applyGlareIntensity(this.glareSettings.default),
    };
  }

  /**
   * Turns a raw value into an intensity the foil range accepts.
   *
   * @param {unknown} value - Raw intensity, in percents.
   * @returns {number} A whole number within the declared foil range.
   * @throws {TypeError} When the value is not a finite number.
   */
  normalizePercent(value) {
    return FoilManager.normalizeInRange(value, this.settings);
  }

  /**
   * Turns a raw value into an intensity the brillance range accepts.
   *
   * @param {unknown} value - Raw intensity, in percents.
   * @returns {number} A whole number within the declared brillance range.
   * @throws {TypeError} When the value is not a finite number.
   */
  normalizeGlarePercent(value) {
    return FoilManager.normalizeInRange(value, this.glareSettings);
  }

  /**
   * Rounds a value to the nearest step of a range, then clamps it inside that range.
   *
   * The rounding happens ABOVE the minimum (so the slider's marks stay reachable) and the clamping
   * comes last, which keeps a stored value usable even after `config.json` moved its bounds.
   *
   * @param {unknown} value - Raw intensity, in percents.
   * @param {{min: number, max: number, step: number}} range - Bounds the value must land in.
   * @returns {number} A whole number within `[min, max]`.
   * @throws {TypeError} When the value is not a finite number.
   */
  static normalizeInRange(value, range) {
    const { min, max, step } = range;
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
   * Shared by the two effects: a foil and a brillance are scaled the same way, only their ranges and
   * the layers they reach differ.
   *
   * @param {number} percent - Intensity in percents.
   * @returns {number} A factor between 0 and 1.
   */
  toIntensity(percent) {
    const value = Number(percent);
    if (!Number.isFinite(value)) {
      throw new TypeError(`FoilManager expects a number (received: ${JSON.stringify(percent)}).`);
    }
    return Math.min(Math.max(value / 100, 0), 1);
  }

  /**
   * Currently applied foil intensity.
   *
   * @returns {number} The intensity, in percents.
   */
  getPercent() {
    return this.percent;
  }

  /**
   * Currently applied brillance.
   *
   * @returns {number} The brillance, in percents.
   */
  getGlarePercent() {
    return this.glarePercent;
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
   * The declared foil range, with its default.
   *
   * @returns {{min: number, max: number, step: number, default: number}} A copy of the bounds, so a
   *   caller can not edit the manager's own settings by accident.
   */
  getSettings() {
    return { ...this.settings };
  }

  /**
   * The declared brillance range, with its default.
   *
   * @returns {{min: number, max: number, step: number, default: number}} A copy of the bounds.
   */
  getGlareSettings() {
    return { ...this.glareSettings };
  }

  /**
   * Normalizes a stored foil value without applying anything.
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

  /**
   * Normalizes a stored brillance without applying anything.
   *
   * @param {unknown} value - Raw brillance, in percents.
   * @returns {number} A whole number within the declared range.
   * @throws {TypeError} When the value is not a finite number.
   */
  sanitizeGlarePercent(value) {
    return this.normalizeGlarePercent(value);
  }
}

/** Shared instance used by `js/app.js` and the settings view. */
export const foilManager = new FoilManager();

export default foilManager;

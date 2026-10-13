/**
 * AnimationManager - Selects the flavour of the opening animations.
 *
 * Reference: `settings/config.json` (`animations.list`) and `css/animations.css`.
 *
 * HOW A MODE IS APPLIED
 *   - `data-animation="<id>"` is set on `<html>` AND on `<body>`, exactly like the theme:
 *     `css/animations.css` keys every override on `body[data-animation="…"]`, while a rule that
 *     needs the value before `<body>` exists can use the `<html>` one;
 *   - the three durations of the mode are published as custom properties on `<html>`
 *     (`--anim-tear-ms`, `--anim-flip-ms`, `--anim-stagger-ms`), so the stylesheets AND the JS
 *     timing (the WebGL tear animation of `Booster3DRenderer`) read the very same numbers. There
 *     is no duration hard-coded on either side;
 *   - `ANIMATION_CHANGED` is emitted with `{ mode, previousMode, parodic }`.
 *
 * THE THREE STAGES
 *   1. opening of the pack  : `--anim-tear-ms` (the booster is torn, thrown away or blown up);
 *   2. card flip            : `--anim-flip-ms` (see `.card-reveal__card.is-flipped`);
 *   3. summary              : `--anim-stagger-ms` (delay between two cards of the grid).
 *
 * THE PARODIC MODE
 *   `explosive` is flagged `parodic: true` in `config.json`. The flag is not decoration: the
 *   settings screen advertises it with a hazard banner, and the opening view fires a comic
 *   "BOUM !" burst. `isParodic()` is the single place that decides whether a mode is a joke.
 *
 * The available modes come from `config.json`, so a new mode only needs a `list` entry and,
 * optionally, its own block in `css/animations.css`. When the section is missing (an older cached
 * `config.json`), the manager degrades to the built-in neutral mode instead of throwing: the game
 * must stay playable.
 *
 * This module never touches IndexedDB: the authoritative value lives in
 * `user_state["settings"].animation` and is written by `AccountManager.updateSettings`.
 */

import { configLoader, DEFAULT_ANIMATION_TIMING } from './ConfigLoader.js';
import eventBus, { EVENTS } from './EventBus.js';

/** Mode used when `config.json` declares no animation at all. */
export const FALLBACK_ANIMATION = Object.freeze({
  id: 'normal',
  labelKey: 'settings.animation.normal',
  parodic: false,
  ...DEFAULT_ANIMATION_TIMING,
});

/** Custom property carrying the duration of the pack opening, in milliseconds. */
export const TEAR_DURATION_VARIABLE = '--anim-tear-ms';

/** Custom property carrying the duration of one card flip, in milliseconds. */
export const FLIP_DURATION_VARIABLE = '--anim-flip-ms';

/** Custom property carrying the delay between two cards of the summary, in milliseconds. */
export const STAGGER_DELAY_VARIABLE = '--anim-stagger-ms';

export class AnimationManager {
  constructor() {
    /** @type {string} Currently applied mode id. */
    this.mode = FALLBACK_ANIMATION.id;
    /** @type {Array<object>} Descriptors declared in `config.json`, in order. */
    this.animations = [];
    /** @type {string} Mode applied when nothing else is known. */
    this.defaultMode = FALLBACK_ANIMATION.id;
  }

  /**
   * Logs with the manager prefix.
   *
   * @param {...unknown} args - Values forwarded to `console.info`.
   * @returns {void}
   */
  log(...args) {
    console.info('[AnimationManager]', ...args);
  }

  /**
   * Loads the declared modes and applies the default one.
   *
   * The stored preference is applied later by `js/app.js` (it comes from IndexedDB), exactly like
   * the theme: this call only guarantees that `data-animation` and the duration variables exist
   * before the first view is built.
   *
   * @returns {Promise<string>} The applied mode id.
   */
  async init() {
    await this.loadAvailableAnimations();
    return this.applyAnimation(this.defaultMode);
  }

  /**
   * Reads the modes from `config.json`.
   *
   * @returns {Promise<Array<object>>} The descriptors, and the manager's own list.
   * @throws {Error} When `config.json` cannot be loaded.
   */
  async loadAvailableAnimations() {
    const options = await configLoader.getAnimationOptions();
    this.animations = options.length > 0 ? options : [{ ...FALLBACK_ANIMATION }];
    this.defaultMode = options.length > 0 ? await configLoader.getDefaultAnimation() : FALLBACK_ANIMATION.id;
    return this.animations;
  }

  /**
   * Applies a mode: attribute, duration variables and `ANIMATION_CHANGED`.
   *
   * @param {string} mode - Mode id (e.g. "normal", "epic", "explosive").
   * @returns {string} The applied mode id.
   * @throws {RangeError} When the mode is not declared in `config.json`.
   */
  applyAnimation(mode) {
    const requested = this.normalizeMode(mode);
    if (!requested) {
      throw new RangeError(
        `Unknown animation mode "${mode}". Available modes: [${this.getAvailableModes().join(', ')}].`
      );
    }

    const previousMode = this.mode;
    this.mode = requested;

    document.documentElement.dataset.animation = requested;
    if (document.body) {
      document.body.dataset.animation = requested;
    }
    this.publishTiming(requested);

    eventBus.emit(EVENTS.ANIMATION_CHANGED, {
      mode: requested,
      previousMode,
      parodic: this.isParodicMode(requested),
    });
    this.log(`Animation mode applied: ${requested}.`);
    return requested;
  }

  /**
   * Writes the durations of a mode as custom properties on `<html>`.
   *
   * @param {string} mode - Mode id.
   * @returns {void}
   */
  publishTiming(mode) {
    const { tearMs, flipMs, staggerMs } = this.getTiming(mode);
    const root = document.documentElement;
    if (!root?.style) return;
    root.style.setProperty(TEAR_DURATION_VARIABLE, `${tearMs}ms`);
    root.style.setProperty(FLIP_DURATION_VARIABLE, `${flipMs}ms`);
    root.style.setProperty(STAGGER_DELAY_VARIABLE, `${staggerMs}ms`);
  }

  /**
   * Descriptor of a mode.
   *
   * @param {string} [mode] - Mode id (the active one by default).
   * @returns {{id: string, labelKey: string, parodic: boolean, tearMs: number, flipMs: number,
   *   staggerMs: number}} The descriptor, falling back to the neutral one.
   */
  getAnimation(mode = this.mode) {
    const normalized = typeof mode === 'string' ? mode.trim().toLowerCase() : null;
    return this.animations.find((entry) => entry.id === normalized) ?? FALLBACK_ANIMATION;
  }

  /**
   * Durations of a mode, in milliseconds.
   *
   * The WebGL tear animation (`Booster3DRenderer`) MUST use `tearMs`: it is what keeps the 3D
   * movement and the CSS animation of the stage in sync whatever the mode.
   *
   * @param {string} [mode] - Mode id (the active one by default).
   * @returns {{tearMs: number, flipMs: number, staggerMs: number}} The durations.
   */
  getTiming(mode = this.mode) {
    const { tearMs, flipMs, staggerMs } = this.getAnimation(mode);
    return { tearMs, flipMs, staggerMs };
  }

  /**
   * Normalizes a raw mode value against the declared ones.
   *
   * @param {unknown} mode - Candidate id (case-insensitive).
   * @returns {string|null} A declared id, or null when the value is unusable.
   */
  normalizeMode(mode) {
    if (typeof mode !== 'string' || mode.trim() === '') return null;
    const normalized = mode.trim().toLowerCase();
    if (this.animations.length === 0) {
      // Mode list not loaded yet (early bootstrap): keep the requested value as-is rather than
      // silently falling back to the neutral animation.
      console.warn('[AnimationManager] Mode list not loaded yet, applying the requested value as-is.');
      return normalized;
    }
    return this.animations.some((entry) => entry.id === normalized) ? normalized : null;
  }

  /**
   * Checks whether a mode is declared in `config.json`.
   *
   * @param {unknown} mode - Candidate id.
   * @returns {boolean} True when the mode exists.
   */
  isAvailableMode(mode) {
    return (
      typeof mode === 'string' && this.animations.some((entry) => entry.id === mode.trim().toLowerCase())
    );
  }

  /**
   * Currently applied mode id.
   *
   * @returns {string} The mode id.
   */
  getMode() {
    return this.mode;
  }

  /**
   * Mode ids declared in `config.json`.
   *
   * @returns {string[]} A copy of the ids, in declaration order.
   */
  getAvailableModes() {
    return this.animations.map((entry) => entry.id);
  }

  /**
   * Modes with their labels and their durations, for the settings picker.
   *
   * @returns {Promise<Array<object>>} The descriptors.
   * @throws {Error} When `config.json` cannot be loaded.
   */
  async getAnimationOptions() {
    const options = await configLoader.getAnimationOptions();
    return options.length > 0 ? options : [{ ...FALLBACK_ANIMATION }];
  }

  /**
   * Tells whether a mode is the deliberate joke one.
   *
   * @param {string} [mode] - Mode id (the active one by default).
   * @returns {boolean} True when the mode is flagged `parodic` in `config.json`.
   */
  isParodicMode(mode = this.mode) {
    return this.getAnimation(mode).parodic === true;
  }
}

/** Shared instance used by the settings view, the opening view and `app.js`. */
export const animationManager = new AnimationManager();

export default animationManager;

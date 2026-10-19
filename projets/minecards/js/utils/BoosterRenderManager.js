/**
 * BoosterRenderManager - Which lighting and material recipe the 3D booster reflects with.
 *
 * Reference: `settings/config.json` (`boosterRender`), `js/UI/components/Booster3DRenderer.js`
 * and `.docs/main.md` section 3.G (the opening view).
 *
 * THE MODES
 * A mode is a complete recipe, not a single knob: the exposure, the strength of the studio
 * reflections, the five lights, the metalness and the roughness of the surface, the clearcoat layer
 * that turns the pack into a blister plastic, the self-illumination and the multiplier applied to
 * the normal map baked in the `.glb`. The shipped `config.json` declares four of them (blister,
 * classic, satin, metal) and one is the default; a missing block falls back to the classic recipe
 * through `ConfigLoader.getBoosterRenderSettings()`.
 *
 * THE PICKER
 * The other modes than the default one are a developer tool: the settings screen only draws the
 * picker when `settings.devMode` is on. This manager owns the active mode and the list, and emits
 * `BOOSTER_RENDER_CHANGED` with the full recipe so the live scenes can be retuned without being
 * rebuilt. Persisting the choice belongs to `AccountManager.updateSettings`
 * (`settings.boosterRenderMode`), exactly like the animation mode and the foil sliders.
 *
 * This module never touches IndexedDB: it is initialized from `config.json` by `js/app.js`, which
 * then applies the stored preference.
 */

import { configLoader, DEFAULT_BOOSTER_RENDER_SETTINGS } from './ConfigLoader.js';
import eventBus, { EVENTS } from './EventBus.js';

export class BoosterRenderManager {
  constructor() {
    /** @type {Array<object>} Declared modes, in the order the picker shows them. */
    this.modes = DEFAULT_BOOSTER_RENDER_SETTINGS.modes.map((mode) => ({ ...mode }));
    /** @type {string} Mode applied when the stored preference is unknown. */
    this.defaultMode = DEFAULT_BOOSTER_RENDER_SETTINGS.defaultMode;
    /** @type {string} Currently applied mode id. */
    this.mode = this.defaultMode;
    /** @type {object} Currently applied recipe (a mode descriptor). */
    this.settings = this.modes[0];
  }

  /**
   * Logs with the manager prefix.
   *
   * @param {...unknown} args - Values forwarded to `console.info`.
   * @returns {void}
   */
  log(...args) {
    console.info('[BoosterRenderManager]', ...args);
  }

  /**
   * Loads the declared modes and applies the default one.
   *
   * The stored preference is applied later by `js/app.js` (it comes from IndexedDB), exactly like
   * the theme and the animation mode: this call only guarantees that a valid recipe exists before
   * the first 3D scene is built.
   *
   * @returns {Promise<string>} The applied mode id.
   * @throws {Error} When `config.json` cannot be loaded.
   */
  async init() {
    await this.loadModes();
    return this.applyMode(this.defaultMode);
  }

  /**
   * Reads the modes from `config.json`.
   *
   * @returns {Promise<Array<object>>} The descriptors, and the manager's own list.
   * @throws {Error} See `ConfigLoader.getBoosterRenderSettings()`.
   */
  async loadModes() {
    const block = await configLoader.getBoosterRenderSettings();
    this.modes = block.modes;
    this.defaultMode = block.defaultMode;
    return this.modes;
  }

  /**
   * Applies a mode and publishes its full recipe.
   *
   * @param {string} mode - Mode id declared in `config.json` (e.g. "blister", "classic").
   * @returns {string} The applied mode id.
   * @throws {RangeError} When the mode is not declared.
   */
  applyMode(mode) {
    const requested = typeof mode === 'string' ? mode.trim().toLowerCase() : '';
    const descriptor = this.modes.find((entry) => entry.id === requested);
    if (!descriptor) {
      throw new RangeError(
        `Unknown booster render mode "${mode}". Available modes: [${this.getAvailableModes().join(', ')}].`
      );
    }

    const previousMode = this.mode;
    this.mode = descriptor.id;
    this.settings = descriptor;

    eventBus.emit(EVENTS.BOOSTER_RENDER_CHANGED, {
      mode: descriptor.id,
      previousMode,
      settings: this.getRenderSettings(),
    });
    this.log(`Render mode applied: ${descriptor.id}.`);
    return descriptor.id;
  }

  /**
   * Checks whether a mode is declared.
   *
   * @param {unknown} mode - Mode id.
   * @returns {boolean} True when the id belongs to the declared modes.
   */
  isAvailableMode(mode) {
    return (
      typeof mode === 'string' && this.modes.some((entry) => entry.id === mode.trim().toLowerCase())
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
    return this.modes.map((entry) => entry.id);
  }

  /**
   * Full descriptors of the declared modes.
   *
   * @returns {Array<object>} A shallow copy of each descriptor, in declaration order.
   */
  getModes() {
    return this.modes.map((entry) => ({ ...entry }));
  }

  /**
   * Recipe of the active mode, ready to be handed to a `Booster3DRenderer`.
   *
   * @returns {object} A copy of the active descriptor (id, labels and every render parameter).
   */
  getRenderSettings() {
    return { ...this.settings };
  }
}

export default new BoosterRenderManager();

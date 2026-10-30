/**
 * SoundManager - Every short feedback sound of the game.
 *
 * The application only needs one-shot effects, so no audio library is involved: one
 * `HTMLAudioElement` is created per sound, preloaded once and simply rewound on every playback.
 *
 * FAMILIES (settings > Sounds, and `settings/config.json` defaults)
 *   - `opening`       : tearing a booster, turning a card and the rarity stings;
 *   - `ui`            : the navigation map of `settings/sounds.json` (screens, dialogs, panels,
 *                       filters, card details and the steps of a reveal);
 *   - `mining`        : the two sounds of every mineable block (`assets/sound/blocks/`);
 *   - `notifications` : the tiny ping of a game notification.
 *
 * Each family has its own switch and a volume from 0 to 5. The global switch stays the master gate:
 * when it is off nothing is even preloaded, and the settings screen hides the families. A family
 * switched off (or at volume 0) is silent without touching the others.
 *
 * AUTOPLAY POLICY
 *   Browsers refuse to start an audio without a prior user gesture. Every sound here is played
 *   after a tap, a key press or a screen change caused by one, so the context is already unlocked.
 *   A refused `play()` is logged once per sound and never throws: a missing sound must never break
 *   an animation or a game action.
 *
 * The manager degrades to a no-op outside a browser (no `Audio` global), which keeps the business
 * modules testable under Node.
 */

/** Relative paths of the opening sounds, resolved from the application root. */
export const SOUNDS = Object.freeze({
  BOOSTER_OPENING: 'assets/sound/booster_opening.mp3',
  CARD_RETURN: 'assets/sound/card_return.mp3',
  CARD_RARITY_3: 'assets/sound/card_rarity_3.mp3',
  CARD_RARITY_4: 'assets/sound/card_rarity_4.mp3',
  CARD_RARITY_5: 'assets/sound/card_rarity_5.mp3',
});

/** Sound played when a card of the given rarity is revealed (only 3, 4 and 5 have one). */
export const RARITY_SOUNDS = Object.freeze({
  3: SOUNDS.CARD_RARITY_3,
  4: SOUNDS.CARD_RARITY_4,
  5: SOUNDS.CARD_RARITY_5,
});

/** Families of sounds, as stored in the account settings. */
export const SOUND_CATEGORIES = Object.freeze({
  OPENING: 'opening',
  UI: 'ui',
  MINING: 'mining',
  NOTIFICATIONS: 'notifications',
});

/** Display order of the families in the settings screen. */
export const SOUND_CATEGORY_ORDER = Object.freeze([
  SOUND_CATEGORIES.OPENING,
  SOUND_CATEGORIES.UI,
  SOUND_CATEGORIES.MINING,
  SOUND_CATEGORIES.NOTIFICATIONS,
]);

/** Volume levels a family can be set to (0 is silent, 5 is the loudest). */
export const SOUND_VOLUME_LEVELS = Object.freeze({ MIN: 0, MAX: 5 });

/** Shipped state of each family: all enabled, at a moderate volume. */
export const DEFAULT_SOUND_CATEGORIES = Object.freeze({
  [SOUND_CATEGORIES.OPENING]: Object.freeze({ enabled: true, volume: 3 }),
  [SOUND_CATEGORIES.UI]: Object.freeze({ enabled: true, volume: 3 }),
  [SOUND_CATEGORIES.MINING]: Object.freeze({ enabled: true, volume: 3 }),
  [SOUND_CATEGORIES.NOTIFICATIONS]: Object.freeze({ enabled: true, volume: 3 }),
});

/**
 * Stable ids of the interface sounds (`settings/sounds.json`).
 *
 * They are the names the code calls; the map itself owns the files and the `enabled` flag, so the
 * sound of one moment can be replaced without touching the views.
 */
export const UI_SOUNDS = Object.freeze({
  NAV_VIEW: 'nav.view',
  NAV_BACK: 'nav.back',
  MODAL_OPEN: 'modal.open',
  MODAL_CLOSE: 'modal.close',
  TRADER_OPEN: 'trader.open',
  TRADER_CLOSE: 'trader.close',
  CHEST_OPEN: 'chest.open',
  CHEST_CLOSE: 'chest.close',
  PANEL_OPEN: 'panel.open',
  PANEL_CLOSE: 'panel.close',
  FILTER_CHANGE: 'filter.change',
  SECTION_SWITCH: 'section.switch',
  CARD_OPEN: 'card.open',
  CARD_CLOSE: 'card.close',
  REVEAL_STEP: 'reveal.step',
  NOTIFICATION_SHOW: 'notification.show',
});

/** Fallback paths of the interface sounds, used until `settings/sounds.json` is loaded. */
const UI_SOUND_PATHS = Object.freeze({
  [UI_SOUNDS.NAV_VIEW]: 'assets/sound/ui/nav_view.mp3',
  [UI_SOUNDS.NAV_BACK]: 'assets/sound/ui/nav_back.mp3',
  [UI_SOUNDS.MODAL_OPEN]: 'assets/sound/ui/modal_open.mp3',
  [UI_SOUNDS.MODAL_CLOSE]: 'assets/sound/ui/modal_close.mp3',
  [UI_SOUNDS.TRADER_OPEN]: 'assets/sound/ui/wandering_open.mp3',
  [UI_SOUNDS.TRADER_CLOSE]: 'assets/sound/ui/wandering_close.mp3',
  [UI_SOUNDS.CHEST_OPEN]: 'assets/sound/ui/chest_open.mp3',
  [UI_SOUNDS.CHEST_CLOSE]: 'assets/sound/ui/chest_close.mp3',
  [UI_SOUNDS.PANEL_OPEN]: 'assets/sound/ui/panel_open.mp3',
  [UI_SOUNDS.PANEL_CLOSE]: 'assets/sound/ui/panel_close.mp3',
  [UI_SOUNDS.FILTER_CHANGE]: 'assets/sound/ui/filter_change.mp3',
  [UI_SOUNDS.SECTION_SWITCH]: 'assets/sound/ui/section_switch.mp3',
  [UI_SOUNDS.CARD_OPEN]: 'assets/sound/ui/card_open.mp3',
  [UI_SOUNDS.CARD_CLOSE]: 'assets/sound/ui/card_close.mp3',
  [UI_SOUNDS.REVEAL_STEP]: 'assets/sound/ui/reveal_step.mp3',
  [UI_SOUNDS.NOTIFICATION_SHOW]: 'assets/sound/ui/notification_show.mp3',
});

/** Master volume applied on top of the family volume (kept for the existing API). */
export const DEFAULT_VOLUME = 1;

/** Path of the interface sound map. */
export const UI_SOUND_MAP_PATH = 'settings/sounds.json';

export class SoundManager {
  /**
   * @param {object} [options] - Manager options.
   * @param {number} [options.volume=DEFAULT_VOLUME] - Master volume in [0, 1].
   * @param {boolean} [options.enabled=true] - Master switch (muting keeps the elements loaded).
   * @param {object} [options.categories] - Per-family settings (see `normalizeCategories()`).
   */
  constructor({ volume = DEFAULT_VOLUME, enabled = true, categories = null } = {}) {
    /** @type {number} Master multiplier, in [0, 1]. */
    this.volume = SoundManager.normalizeVolume(volume);
    /** @type {boolean} Master switch. */
    this.enabled = enabled !== false;
    /** @type {Record<string, {enabled: boolean, volume: number}>} Family settings. */
    this.categories = SoundManager.normalizeCategories(categories);
    /** @type {Map<string, HTMLAudioElement>} Loaded sounds, keyed by their path. */
    this.elements = new Map();
    /** @type {Set<string>} Paths whose playback was already reported as refused. */
    this.reportedFailures = new Set();
    /** @type {Map<string, {path: string, enabled: boolean}>|null} Map read from sounds.json. */
    this.uiSoundMap = null;
    /** @type {Promise<Map<string, {path: string, enabled: boolean}>>|null} In-flight map read. */
    this.uiSoundMapPromise = null;
  }

  /**
   * Checks that the runtime can play sounds.
   *
   * @returns {boolean} True when an `Audio` constructor is available.
   */
  static isSupported() {
    return typeof Audio === 'function';
  }

  /**
   * Clamps a volume into [0, 1].
   *
   * @param {unknown} value - Candidate volume.
   * @returns {number} A usable volume.
   */
  static normalizeVolume(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_VOLUME;
    return Math.min(Math.max(value, 0), 1);
  }

  /**
   * Brings a family volume back into the 0-5 range.
   *
   * @param {unknown} value - Stored level.
   * @param {number} fallback - Level used for a missing/corrupted value.
   * @returns {number} A whole level between 0 and 5.
   */
  static normalizeVolumeLevel(value, fallback = 3) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return Math.min(SOUND_VOLUME_LEVELS.MAX, Math.max(SOUND_VOLUME_LEVELS.MIN, Math.round(value)));
  }

  /**
   * Normalizes the per-family settings stored by the account.
   *
   * Only the known families are kept. A missing one reads as its shipped value, and a malformed
   * volume is clamped rather than rejected: a save written by an older version keeps loading.
   *
   * @param {unknown} value - Stored or requested map.
   * @returns {Record<string, {enabled: boolean, volume: number}>} One entry per known family.
   */
  static normalizeCategories(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const normalized = {};
    SOUND_CATEGORY_ORDER.forEach((category) => {
      const fallback = DEFAULT_SOUND_CATEGORIES[category];
      const entry = source[category];
      const record = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : {};
      normalized[category] = {
        enabled: record.enabled !== false,
        volume: SoundManager.normalizeVolumeLevel(record.volume, fallback.volume),
      };
    });
    return normalized;
  }

  /**
   * Tells which family one path belongs to.
   *
   * @param {string} path - Sound path.
   * @returns {string} One of `SOUND_CATEGORIES`.
   */
  static categoryOf(path) {
    const value = typeof path === 'string' ? path : '';
    if (value.includes('/sound/blocks/') || value.startsWith('assets/sound/blocks/')) {
      return SOUND_CATEGORIES.MINING;
    }
    if (value.endsWith('notification_show.mp3')) return SOUND_CATEGORIES.NOTIFICATIONS;
    if (value.includes('/sound/ui/') || value.startsWith('assets/sound/ui/')) {
      return SOUND_CATEGORIES.UI;
    }
    return SOUND_CATEGORIES.OPENING;
  }

  /**
   * Enables or disables every sound (master switch).
   *
   * @param {boolean} enabled - New state.
   * @returns {void}
   */
  setEnabled(enabled) {
    this.enabled = enabled !== false;
  }

  /**
   * Returns whether the master switch is on.
   *
   * @returns {boolean} True when sounds may play.
   */
  isEnabled() {
    return this.enabled;
  }

  /**
   * Replaces the per-family settings.
   *
   * @param {unknown} categories - Map of family -> `{enabled, volume}`.
   * @returns {void}
   */
  setCategorySettings(categories) {
    this.categories = SoundManager.normalizeCategories(categories);
    // The elements already loaded keep the volume of their family in memory: refresh them now so a
    // slider takes effect on the next playback without recreating anything.
    this.elements.forEach((element, path) => {
      element.volume = this.effectiveVolume(path);
    });
  }

  /**
   * Returns a copy of the per-family settings.
   *
   * @returns {Record<string, {enabled: boolean, volume: number}>} The settings.
   */
  getCategorySettings() {
    return SoundManager.normalizeCategories(this.categories);
  }

  /**
   * Enables or disables one family.
   *
   * @param {string} category - One of `SOUND_CATEGORIES`.
   * @param {boolean} enabled - New state.
   * @returns {void}
   */
  setCategoryEnabled(category, enabled) {
    const next = this.getCategorySettings();
    if (!Object.prototype.hasOwnProperty.call(next, category)) return;
    next[category] = { ...next[category], enabled: enabled !== false };
    this.setCategorySettings(next);
  }

  /**
   * Sets the volume of one family.
   *
   * @param {string} category - One of `SOUND_CATEGORIES`.
   * @param {number} level - Whole level from 0 to 5.
   * @returns {void}
   */
  setCategoryVolume(category, level) {
    const next = this.getCategorySettings();
    if (!Object.prototype.hasOwnProperty.call(next, category)) return;
    next[category] = {
      ...next[category],
      volume: SoundManager.normalizeVolumeLevel(level, next[category].volume),
    };
    this.setCategorySettings(next);
  }

  /**
   * Computed volume of one sound, master switch and family included.
   *
   * @param {string} path - Sound path.
   * @returns {number} Volume in [0, 1].
   */
  effectiveVolume(path) {
    const category = SoundManager.categoryOf(path);
    const settings = this.categories[category] ?? DEFAULT_SOUND_CATEGORIES[category];
    if (!this.enabled || !settings || settings.enabled === false) return 0;
    return this.volume * (settings.volume / SOUND_VOLUME_LEVELS.MAX);
  }

  /**
   * Updates the master volume of every loaded sound.
   *
   * The family volume is applied per playback (and by `setCategorySettings`), so this only rewrites
   * the elements with their computed volume.
   *
   * @param {number} volume - Volume in [0, 1].
   * @returns {void}
   */
  setVolume(volume) {
    this.volume = SoundManager.normalizeVolume(volume);
    this.elements.forEach((element, path) => {
      element.volume = this.effectiveVolume(path);
    });
  }

  /**
   * Returns (and lazily creates) the audio element of a sound.
   *
   * @param {string} path - Path of the sound, relative to the application root.
   * @returns {HTMLAudioElement|null} The element, or null when audio is unavailable.
   * @throws {TypeError} When the path is not a non-empty string.
   */
  getElement(path) {
    if (typeof path !== 'string' || path.trim() === '') {
      throw new TypeError(`SoundManager.getElement expects a non-empty path (received: ${JSON.stringify(path)}).`);
    }
    if (!SoundManager.isSupported()) return null;

    const existing = this.elements.get(path);
    if (existing) return existing;

    const element = new Audio(path);
    element.preload = 'auto';
    element.volume = this.effectiveVolume(path);
    this.elements.set(path, element);
    return element;
  }

  /**
   * Reads `settings/sounds.json`, the map of every interface moment.
   *
   * The map is the source of truth for the file and for its `enabled` flag; the paths are also kept
   * as a fallback in `UI_SOUND_PATHS` so an early navigation is not silent while the file loads.
   *
   * @param {object} [options] - Load options.
   * @param {boolean} [options.force=false] - Re-read the file even when it is cached.
   * @returns {Promise<Map<string, {path: string, enabled: boolean}>>} The map, keyed by event id.
   */
  async loadUiSoundMap({ force = false } = {}) {
    if (this.uiSoundMap && !force) return this.uiSoundMap;
    if (this.uiSoundMapPromise && !force) return this.uiSoundMapPromise;

    this.uiSoundMapPromise = (async () => {
      const map = new Map(
        Object.entries(UI_SOUND_PATHS).map(([event, path]) => [event, { path, enabled: true }])
      );
      if (typeof fetch === 'function') {
        try {
          const response = await fetch(UI_SOUND_MAP_PATH, { cache: 'no-cache' });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const payload = await response.json();
          const entries = Array.isArray(payload?.sounds) ? payload.sounds : [];
          entries.forEach((entry) => {
            const event = typeof entry?.event === 'string' ? entry.event.trim() : '';
            const path = typeof entry?.file === 'string' ? entry.file.trim().replace(/^\.\//, '') : '';
            if (event === '' || path === '') return;
            map.set(event, { path, enabled: entry.enabled !== false });
          });
        } catch (error) {
          console.warn('[SoundManager] The interface sound map could not be read, using the shipped paths.', error);
        }
      }
      this.uiSoundMap = map;
      if (this.enabled) {
        map.forEach((entry) => {
          if (!entry.enabled) return;
          if (this.effectiveVolume(entry.path) <= 0) return;
          try {
            this.getElement(entry.path)?.load();
          } catch (error) {
            console.warn(`[SoundManager] "${entry.path}" could not be preloaded.`, error);
          }
        });
      }
      return map;
    })().finally(() => {
      this.uiSoundMapPromise = null;
    });

    return this.uiSoundMapPromise;
  }

  /**
   * Plays one interface sound by its stable event id (`UI_SOUNDS`).
   *
   * @param {string} eventId - Event id (`nav.view`, `modal.open`…).
   * @returns {boolean} True when a playback was started.
   */
  playUi(eventId) {
    if (typeof eventId !== 'string' || eventId === '') return false;
    const entry = this.uiSoundMap?.get(eventId)
      ?? { path: UI_SOUND_PATHS[eventId] ?? '', enabled: true };
    if (entry.path === '' || entry.enabled === false) return false;
    return this.play(entry.path);
  }

  /**
   * Loads every declared sound ahead of the first playback.
   *
   * Called at boot so the first card flip does not carry a download delay. Failures are ignored:
   * `play()` loads the file on demand anyway. A muted manager preloads nothing: a player who
   * disabled the sounds should not download them.
   *
   * @returns {void}
   */
  preload() {
    if (!SoundManager.isSupported() || !this.enabled) return;
    Object.values(SOUNDS).forEach((path) => {
      try {
        this.getElement(path)?.load();
      } catch (error) {
        console.warn(`[SoundManager] "${path}" could not be preloaded.`, error);
      }
    });
    if (this.uiSoundMap) {
      this.uiSoundMap.forEach((entry) => {
        if (!entry.enabled) return;
        try {
          this.getElement(entry.path)?.load();
        } catch (error) {
          console.warn(`[SoundManager] "${entry.path}" could not be preloaded.`, error);
        }
      });
    } else {
      void this.loadUiSoundMap();
    }
  }

  /**
   * Plays one sound from the beginning.
   *
   * @param {string} path - Path of the sound (one of `SOUNDS` or a UI/block path).
   * @returns {boolean} True when a playback was actually started.
   */
  play(path) {
    if (!this.enabled) return false;
    const volume = this.effectiveVolume(path);
    if (volume <= 0) return false;

    let element;
    try {
      element = this.getElement(path);
    } catch (error) {
      console.warn('[SoundManager] Invalid sound path.', error);
      return false;
    }
    if (!element) return false;

    element.volume = volume;
    try {
      // Rewind so a repeated action replays the effect instead of being swallowed.
      element.currentTime = 0;
    } catch (error) {
      // Some browsers refuse to seek a not-yet-loaded media: playing from 0 is fine.
    }

    const promise = element.play();
    if (promise && typeof promise.catch === 'function') {
      promise.catch((error) => {
        if (this.reportedFailures.has(path)) return;
        this.reportedFailures.add(path);
        console.warn(`[SoundManager] "${path}" could not be played (autoplay policy?).`, error);
      });
    }
    return true;
  }

  /**
   * Plays the two sounds of one card reveal: the flip, then the rarity sting.
   *
   * Rarities 4 and 5 each have their own sound; the other rarities only play the flip.
   *
   * @param {number} rarity - Rarity of the revealed card (1-5).
   * @returns {boolean} True when the flip sound was started.
   */
  playCardReveal(rarity) {
    const played = this.play(SOUNDS.CARD_RETURN);
    const rarityPath = RARITY_SOUNDS[Number(rarity)];
    if (rarityPath) {
      this.play(rarityPath);
    }
    return played;
  }

  /**
   * Releases the audio elements.
   *
   * @returns {void}
   */
  destroy() {
    this.elements.forEach((element) => {
      try {
        element.pause();
        element.src = '';
      } catch (error) {
        console.warn('[SoundManager] An audio element could not be released.', error);
      }
    });
    this.elements.clear();
    this.reportedFailures.clear();
  }
}

/** Shared instance used by every view and by the overlay. */
export const soundManager = new SoundManager();

export default soundManager;

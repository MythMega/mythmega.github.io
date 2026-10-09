/**
 * SoundManager - Short feedback sounds of the booster opening.
 *
 * The application only needs a handful of one-shot effects, so no audio library is involved: one
 * `HTMLAudioElement` is created per sound, preloaded once and simply rewound on every playback.
 *
 * SOUNDS (all under `assets/sound/`, credits in `assets/sound/notes.txt` and in the info view)
 *   - `booster_opening` : tearing the booster open (the tap/swipe on the 3D model);
 *   - `card_return`     : one card is turned over;
 *   - `card_rarity_3`   : a super rare (rarity 3) card was revealed;
 *   - `card_rarity_4`   : a legendary (rarity 4) card was revealed;
 *   - `card_rarity_5`   : a mythic (rarity 5) card was revealed.
 *
 * AUTOPLAY POLICY
 *   Browsers refuse to start an audio without a prior user gesture. Every sound here is played
 *   after a tap (opening the booster, revealing a card), so the context is already unlocked. A
 *   refused `play()` is logged once per sound and never throws: a missing sound must never break
 *   an animation or a game action.
 *
 * The manager degrades to a no-op outside a browser (no `Audio` global), which keeps the business
 * modules testable under Node.
 */

/** Relative paths of the sound files, resolved from the application root. */
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

/** Default volume, applied to every effect. */
export const DEFAULT_VOLUME = 0.5;

export class SoundManager {
  /**
   * @param {object} [options] - Manager options.
   * @param {number} [options.volume=DEFAULT_VOLUME] - Volume in [0, 1].
   * @param {boolean} [options.enabled=true] - Master switch (muting keeps the elements loaded).
   */
  constructor({ volume = DEFAULT_VOLUME, enabled = true } = {}) {
    /** @type {number} */
    this.volume = SoundManager.normalizeVolume(volume);
    /** @type {boolean} */
    this.enabled = enabled !== false;
    /** @type {Map<string, HTMLAudioElement>} Loaded sounds, keyed by their path. */
    this.elements = new Map();
    /** @type {Set<string>} Paths whose playback was already reported as refused. */
    this.reportedFailures = new Set();
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
   * Enables or disables the sounds.
   *
   * @param {boolean} enabled - New state.
   * @returns {void}
   */
  setEnabled(enabled) {
    this.enabled = enabled !== false;
  }

  /**
   * Returns whether the sounds are enabled.
   *
   * @returns {boolean} True when sounds may play.
   */
  isEnabled() {
    return this.enabled;
  }

  /**
   * Updates the volume of every loaded sound.
   *
   * @param {number} volume - Volume in [0, 1].
   * @returns {void}
   */
  setVolume(volume) {
    this.volume = SoundManager.normalizeVolume(volume);
    this.elements.forEach((element) => {
      element.volume = this.volume;
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
    element.volume = this.volume;
    this.elements.set(path, element);
    return element;
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
  }

  /**
   * Plays one sound from the beginning.
   *
   * @param {string} path - Path of the sound (one of `SOUNDS`).
   * @returns {boolean} True when a playback was actually started.
   */
  play(path) {
    if (!this.enabled) return false;
    let element;
    try {
      element = this.getElement(path);
    } catch (error) {
      console.warn('[SoundManager] Invalid sound path.', error);
      return false;
    }
    if (!element) return false;

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

/** Shared instance used by the opening view and the overlay. */
export const soundManager = new SoundManager();

export default soundManager;

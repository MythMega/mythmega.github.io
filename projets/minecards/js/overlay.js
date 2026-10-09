/**
 * overlay.js - Standalone booster-opening overlay (`overlay.html`).
 *
 * Reference: step 11. This file is deliberately INDEPENDENT from the application code: it imports
 * nothing from `js/` (only the pinned Three.js CDN, for the 3D booster) and the only shared
 * things with the game are the transparent background and the data files it points to (the
 * booster JSON `data/boosters/<setId>.json`, the booster texture, the card back and the card
 * illustrations).
 *
 * URL: overlay.html?code=minecards:{code}&lang={fr|en}&username={name}&profileiconurl={url}
 *
 * CODE (see `js/utils/BoosterCode.js` for the writer)
 *   A compact binary record: version + extension id + the POSITION of each card in the booster
 *   `Cards` array. The overlay reloads `data/boosters/<setId>.json` to turn those positions into
 *   full cards (names, illustrations, rarity), which keeps the code under 150 characters.
 *
 * SEQUENCE (fully automatic, nothing to click)
 *   1. the 3D booster spins while "{name} opens a {booster} booster" is shown;
 *   2. each card appears face down, then the overlay EMULATES the player's click on it
 *      (`flipCard()`), which is what actually plays the CSS flip;
 *   3. the summary grid is shown;
 *   4. after `summaryHoldMs` everything is erased and the page shows NOTHING (transparent again).
 *
 * CONFIGURATION
 *   Every delay and the animation curve come from `settings/overlay.json`, read once at boot: the
 *   overlay uses the values for its own waits and republishes them to `css/overlay.css` as CSS
 *   variables (--ov-*), so the script and the stylesheet can never disagree. A missing file or an
 *   invalid key silently falls back to `DEFAULT_CONFIG` below.
 *
 * Any invalid/missing code leaves the page completely empty rather than showing an error: an
 * overlay must never display a broken UI on top of a stream.
 */

/** Prefix of a MineCards booster code (mirrors `js/utils/BoosterCode.js`, intentionally duplicated). */
const CODE_PREFIX = 'minecards:';

/** Supported payload version. */
const CODE_VERSION = 2;

/** Directory of the booster JSON files. */
const BOOSTER_DIRECTORY = 'data/boosters';

/** Path of the booster model, relative to `overlay.html`. */
const MODEL_PATH = 'assets/boostermodel.glb';

/** Shared card-back illustration (the same file the game uses). */
const CARD_BACK_IMAGE = 'assets/img/card_back.png';

/** Overlay configuration file, relative to `overlay.html`. */
const CONFIG_PATH = 'settings/overlay.json';

/**
 * Feedback sounds, shared with the game (`assets/sound/`, credits in `assets/sound/notes.txt`).
 *
 * The paths are duplicated on purpose: the overlay imports NOTHING from `js/`, so it can be served
 * on its own. `settings/overlay.json` (`sound.enabled`) turns the whole thing off for streamers
 * who already play their own background music.
 */
const SOUNDS = {
  BOOSTER_OPENING: 'assets/sound/booster_opening.mp3',
  CARD_RETURN: 'assets/sound/card_return.mp3',
  CARD_RARITY_3: 'assets/sound/card_rarity_3.mp3',
  CARD_RARITY_4: 'assets/sound/card_rarity_4.mp3',
  CARD_RARITY_5: 'assets/sound/card_rarity_5.mp3',
};

/**
 * Built-in overlay timeline: the single place the defaults are written down.
 *
 * `settings/overlay.json` overrides whatever it declares; every missing or invalid key keeps the
 * value below, so the overlay stays coherent (and never crashes) without its configuration file.
 * The timings are in milliseconds, `spinStepPerFrame` is a rotation applied per animation frame.
 */
const DEFAULT_CONFIG = {
  timings: {
    introMs: 4200,
    cardEntryMs: 250,
    flipDelayMs: 300,
    flipMs: 620,
    cardHoldMs: 1500,
    stageEnterMs: 480,
    stageTransitionMs: 420,
    headlineMs: 620,
    tileStaggerMs: 70,
    summaryHoldMs: 5000,
    fadeOutMs: 750,
    boosterFloatMs: 4500,
  },
  spinStepPerFrame: 0.012,
  easing: 'cubic-bezier(0.2, 0.8, 0.25, 1)',
  sound: {
    enabled: true,
    volume: 0.3,
  },
};

/** Small local dictionary: the overlay never loads the game translation files. */
const STRINGS = {
  fr: {
    opener: '{name} ouvre un booster {booster}',
    openerNoName: 'Ouverture d’un booster {booster}',
    summary: '{count} cartes révélées',
  },
  en: {
    opener: '{name} opens a {booster} booster',
    openerNoName: 'Opening a {booster} booster',
    summary: '{count} cards revealed',
  },
};

/**
 * Decodes a URL-safe (or standard) Base64 string into bytes.
 *
 * Self-contained duplicate of the writer helper: the overlay must not import any application
 * module, even the pure ones.
 *
 * @param {string} value - Base64 text.
 * @returns {Uint8Array} The decoded bytes.
 */
function decodeBase64Bytes(value) {
  const normalized = value.trim().replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * Parses the `code` query parameter into `{ setId, positions }`.
 *
 * @param {string} code - Raw code (with or without the `minecards:` prefix).
 * @returns {{setId: string, positions: number[]}|null} The decoded record, or null when invalid.
 */
function parseCode(code) {
  if (typeof code !== 'string' || code.trim() === '') return null;
  const trimmed = code.trim();
  const raw = trimmed.startsWith(CODE_PREFIX) ? trimmed.slice(CODE_PREFIX.length) : trimmed;
  if (raw === '') return null;
  try {
    const bytes = decodeBase64Bytes(raw);
    if (bytes.length < 3 || bytes[0] !== CODE_VERSION) return null;
    const idLength = bytes[1];
    if (bytes.length < 2 + idLength) return null;
    const setId = String.fromCharCode(...bytes.subarray(2, 2 + idLength));
    const rest = bytes.subarray(2 + idLength);
    if (rest.length === 0 || rest.length % 2 !== 0) return null;
    const positions = [];
    for (let index = 0; index < rest.length; index += 2) {
      positions.push((rest[index] << 8) | rest[index + 1]);
    }
    return { setId, positions };
  } catch (error) {
    console.warn('[overlay] The booster code could not be read.', error);
    return null;
  }
}

/**
 * Loads the booster JSON and turns the stored card positions into display cards.
 *
 * @param {string} setId - Extension id.
 * @param {number[]} positions - Positions of the drawn cards in the booster `Cards` array.
 * @returns {Promise<{name: string, texture: string, cards: Array}|null>} The resolved pack, or
 *   null when the booster file is missing/unreadable or a position is out of range.
 */
async function loadPack(setId, positions) {
  let data;
  try {
    const response = await fetch(`${BOOSTER_DIRECTORY}/${setId}.json`);
    if (!response.ok) return null;
    data = await response.json();
  } catch (error) {
    console.warn(`[overlay] Booster "${setId}" could not be loaded.`, error);
    return null;
  }
  if (!data || !Array.isArray(data.Cards)) return null;

  const cards = [];
  for (const position of positions) {
    const entry = data.Cards[position];
    if (!entry) return null;
    cards.push({
      rarity: Number(entry.Rarity ?? 1),
      illustration: entry.Path ?? '',
      names: { fr: entry.Name_FR ?? '', en: entry.Name_EN ?? '' },
    });
  }

  return {
    name: data.Name ?? setId,
    texture: String(data.BoosterTexture ?? '').replace(/^\.\//, ''),
    cards,
  };
}

/**
 * Resolves a localized asset path for the overlay language.
 *
 * Supports the two shapes of the game (`<lang>` placeholder and a `/fr/` path segment) without
 * importing `I18n`.
 *
 * @param {string} path - Raw path stored in the booster JSON.
 * @param {string} lang - Active language code.
 * @returns {string} The resolved path (empty when the input is empty).
 */
function resolveAssetPath(path, lang) {
  if (typeof path !== 'string' || path === '') return '';
  if (path.includes('<lang>')) return path.split('<lang>').join(lang);
  return path.replace(/(^|\/)(fr|en)(?=\/)/i, (match, prefix) => `${prefix}${lang}`);
}

/**
 * Resolves the display name of a card for a language (falls back to fr, then en).
 *
 * @param {object} card - Display card.
 * @param {string} lang - Active language code.
 * @returns {string} The localized name.
 */
function cardName(card, lang) {
  const names = card?.names ?? {};
  return names[lang] || names.fr || names.en || '';
}

/**
 * Formats a small template (`{token}` placeholders).
 *
 * @param {string} template - Template text.
 * @param {Record<string, string>} values - Replacement values.
 * @returns {string} The formatted text.
 */
function format(template, values) {
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match
  );
}

/**
 * Reads `settings/overlay.json` and merges it over `DEFAULT_CONFIG`.
 *
 * Never throws: the overlay is a stream overlay, so a missing or malformed configuration must
 * never stop it from running. Non-numeric or negative durations are ignored key by key.
 *
 * @returns {Promise<{timings: Record<string, number>, spinStepPerFrame: number, easing: string}>}
 *   The resolved configuration (always complete).
 */
async function loadConfig() {
  const resolved = {
    timings: { ...DEFAULT_CONFIG.timings },
    spinStepPerFrame: DEFAULT_CONFIG.spinStepPerFrame,
    easing: DEFAULT_CONFIG.easing,
    sound: { ...DEFAULT_CONFIG.sound },
  };

  let raw = null;
  try {
    const response = await fetch(CONFIG_PATH, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    raw = await response.json();
  } catch (error) {
    console.warn(`[overlay] "${CONFIG_PATH}" could not be loaded, using the built-in timings.`, error);
    return resolved;
  }

  Object.keys(resolved.timings).forEach((key) => {
    const value = Number(raw?.timings?.[key]);
    if (Number.isFinite(value) && value >= 0) resolved.timings[key] = value;
  });

  const spinStep = Number(raw?.booster?.spinStepPerFrame);
  if (Number.isFinite(spinStep) && spinStep !== 0) resolved.spinStepPerFrame = spinStep;
  if (typeof raw?.easing === 'string' && raw.easing.trim() !== '') resolved.easing = raw.easing.trim();

  if (raw?.sound && typeof raw.sound === 'object') {
    if (typeof raw.sound.enabled === 'boolean') resolved.sound.enabled = raw.sound.enabled;
    const volume = Number(raw.sound.volume);
    if (Number.isFinite(volume)) resolved.sound.volume = Math.min(Math.max(volume, 0), 1);
  }

  return resolved;
}

/**
 * Publishes the resolved configuration to the stylesheet as CSS custom properties.
 *
 * `css/overlay.css` only declares fallbacks (its own defaults), so the two halves of the overlay
 * share a single source of truth: `settings/overlay.json`.
 *
 * @param {{timings: Record<string, number>, easing: string}} config - Resolved configuration.
 * @returns {void}
 */
function applyCssVariables(config) {
  const style = document.documentElement.style;
  const { timings } = config;
  const variables = {
    '--ov-easing': config.easing,
    '--ov-card-entry-ms': `${timings.cardEntryMs}ms`,
    '--ov-flip-ms': `${timings.flipMs}ms`,
    '--ov-stage-enter-ms': `${timings.stageEnterMs}ms`,
    '--ov-stage-exit-ms': `${timings.stageTransitionMs}ms`,
    '--ov-headline-ms': `${timings.headlineMs}ms`,
    '--ov-tile-ms': `${timings.stageEnterMs}ms`,
    '--ov-overlay-out-ms': `${timings.fadeOutMs}ms`,
    '--ov-booster-float-ms': `${timings.boosterFloatMs}ms`,
  };
  Object.entries(variables).forEach(([name, value]) => style.setProperty(name, value));
}

/**
 * The overlay controller: builds the sequence and cleans everything up at the end.
 */
class BoosterOverlay {
  /**
   * @param {object} options - Overlay options.
   * @param {HTMLElement} options.root - The `.overlay` root element.
   * @param {object} options.pack - Resolved pack (`{ name, texture, cards }`).
   * @param {string} options.lang - Active language code.
   * @param {string} options.username - Player name from the query string.
   * @param {string} options.profileIconUrl - Player avatar URL from the query string.
   * @param {object} options.config - Resolved timeline (see `loadConfig`).
   */
  constructor({ root, pack, lang, username, profileIconUrl, config }) {
    this.root = root;
    this.pack = pack;
    this.lang = lang;
    this.username = username;
    this.profileIconUrl = profileIconUrl;
    this.config = config;
    this.timings = config.timings;
    this.spinStepPerFrame = config.spinStepPerFrame;
    this.sound = config.sound ?? DEFAULT_CONFIG.sound;
    this.strings = STRINGS[lang] ?? STRINGS.fr;

    this.introStage = root.querySelector('[data-stage="intro"]');
    this.revealStage = root.querySelector('[data-stage="reveal"]');
    this.summaryStage = root.querySelector('[data-stage="summary"]');
    this.boosterContainer = root.querySelector('[data-booster-3d]');
    this.boosterFallback = root.querySelector('[data-booster-fallback]');
    this.headline = root.querySelector('[data-headline]');
    this.revealHeadline = root.querySelector('[data-reveal-headline]');
    this.spotlight = root.querySelector('[data-spotlight]');
    this.summaryGrid = root.querySelector('[data-summary-grid]');
    this.summaryLine = root.querySelector('[data-summary-line]');

    /** @type {number[]} Pending timeouts, cleared if the page is torn down. */
    this.timers = [];
    /** @type {Map<string, HTMLAudioElement>} Loaded feedback sounds, keyed by their path. */
    this.audio = new Map();
    /** @type {object|null} Running Three.js scene. */
    this.three = null;
    /** @type {boolean} True once the sequence started (guards a double start). */
    this.started = false;
  }

  /**
   * Displays an element by clearing its `hidden` attribute.
   *
   * @param {HTMLElement|null} element - Target element.
   * @returns {void}
   */
  static show(element) {
    if (element) element.hidden = false;
  }

  /**
   * Starts the whole sequence.
   *
   * @returns {Promise<void>} Resolves once everything has been erased.
   */
  async start() {
    if (this.started) return;
    this.started = true;

    this.root.hidden = false;
    this.renderHeadline();
    await this.runIntro();
    await this.transition(this.introStage, this.revealStage);
    await this.runReveal();
    await this.transition(this.revealStage, this.summaryStage);
    this.renderSummary();
    await this.pause(this.timings.summaryHoldMs);
    await this.teardown();
  }

  /**
   * Writes the "{name} opens a {booster} booster" headline (with the optional avatar).
   *
   * @returns {void}
   */
  renderHeadline() {
    const text = format(this.username ? this.strings.opener : this.strings.openerNoName, {
      name: this.username,
      booster: this.pack.name,
    });
    if (!this.headline) return;
    this.headline.textContent = '';

    // The avatar is part of the name, not a separate element: it is simply prepended inline.
    if (this.username && this.profileIconUrl) {
      const avatar = document.createElement('img');
      avatar.className = 'overlay__avatar';
      avatar.alt = '';
      avatar.src = this.profileIconUrl;
      avatar.addEventListener('error', () => avatar.remove());
      this.headline.appendChild(avatar);
    }
    this.headline.appendChild(document.createTextNode(text));
    BoosterOverlay.show(this.headline);
  }

  /**
   * Runs stage 1: the 3D booster (or its 2D fallback) spins for `timings.introMs`.
   *
   * @returns {Promise<void>} Resolves when the intro is over.
   */
  async runIntro() {
    BoosterOverlay.show(this.introStage);
    await this.startBooster();
    await this.pause(this.timings.introMs);
    this.disposeBooster();
  }

  /**
   * Builds the rotating booster (Three.js), falling back to the texture image when 3D is
   * unavailable (no WebGL, blocked CDN, missing model).
   *
   * @returns {Promise<void>} Resolves once one of the two modes is visible.
   */
  async startBooster() {
    const texturePath = resolveAssetPath(this.pack.texture, this.lang);
    const ready = await this.setupThree(texturePath);
    if (!ready) {
      this.showBoosterFallback(texturePath);
    }
  }

  /**
   * Dynamically imports Three.js and prepares a spinning booster scene.
   *
   * Never throws: any failure resolves to false so the 2D fallback takes over.
   *
   * @param {string} texturePath - Booster texture declared by the booster JSON.
   * @returns {Promise<boolean>} True when the 3D booster is running.
   */
  async setupThree(texturePath) {
    if (!this.boosterContainer || !BoosterOverlay.isWebGLAvailable()) return false;
    try {
      const THREE = await import('three');
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');

      const width = this.boosterContainer.clientWidth || 320;
      const height = this.boosterContainer.clientHeight || 320;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height, false);
      this.boosterContainer.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 100);
      camera.position.set(0, 0.15, 3.1);

      scene.add(new THREE.AmbientLight(0xffffff, 1.2));
      const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
      keyLight.position.set(2, 3, 4);
      scene.add(keyLight);
      const rimLight = new THREE.DirectionalLight(0xffffff, 0.7);
      rimLight.position.set(-3, -1, -2);
      scene.add(rimLight);

      const pivot = new THREE.Group();
      scene.add(pivot);

      const gltf = await new GLTFLoader().loadAsync(MODEL_PATH);
      // Same redress rotation as the game scene, so the booster shows its face and spins on its side.
      gltf.scene.rotation.set(1.522, 4.75, 0);
      pivot.add(gltf.scene);

      if (texturePath) {
        try {
          const texture = await new THREE.TextureLoader().loadAsync(texturePath);
          texture.colorSpace = THREE.SRGBColorSpace;
          gltf.scene.traverse((child) => {
            if (!child.isMesh) return;
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach((material) => {
              if (material && 'map' in material) {
                material.map = texture;
                material.needsUpdate = true;
              }
            });
          });
        } catch (error) {
          console.warn('[overlay] Booster texture unavailable, keeping the model material.', error);
        }
      }

      this.three = { renderer, scene, camera, pivot, frame: null, running: true };

      const loop = () => {
        if (!this.three?.running) return;
        pivot.rotation.y += this.spinStepPerFrame;
        renderer.render(scene, camera);
        this.three.frame = window.requestAnimationFrame(loop);
      };
      loop();
      // The canvas is the only thing shown for the booster; the fallback never appears.
      if (this.boosterFallback) this.boosterFallback.hidden = true;
      return true;
    } catch (error) {
      console.warn('[overlay] 3D booster unavailable, using the 2D fallback.', error);
      this.disposeBooster();
      return false;
    }
  }

  /**
   * Shows the booster texture as a floating 2D fallback.
   *
   * @param {string} texturePath - Booster texture path.
   * @returns {void}
   */
  showBoosterFallback(texturePath) {
    if (!this.boosterFallback || !texturePath) return;
    this.boosterFallback.src = texturePath;
    this.boosterFallback.hidden = false;
  }

  /**
   * Releases the Three.js resources of the intro.
   *
   * @returns {void}
   */
  disposeBooster() {
    if (!this.three) return;
    this.three.running = false;
    if (this.three.frame !== null) window.cancelAnimationFrame(this.three.frame);
    this.three.renderer?.dispose?.();
    this.three.renderer?.domElement?.remove();
    this.three = null;
  }

  /**
   * Checks that a WebGL context can be created.
   *
   * @returns {boolean} True when WebGL is available.
   */
  static isWebGLAvailable() {
    try {
      const canvas = document.createElement('canvas');
      return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
    } catch (error) {
      return false;
    }
  }

  /**
   * Plays one sound from the beginning (no-op when the sounds are disabled or unsupported).
   *
   * @param {string} path - Path of the sound, relative to `overlay.html`.
   * @returns {void}
   */
  playSound(path) {
    if (!this.sound?.enabled || typeof Audio !== 'function') return;
    try {
      let element = this.audio.get(path);
      if (!element) {
        element = new Audio(path);
        element.preload = 'auto';
        element.volume = this.sound.volume;
        this.audio.set(path, element);
      }
      element.currentTime = 0;
      const promise = element.play();
      // Browsers block audio until a user gesture: a stream overlay may simply stay silent, which
      // must never interrupt the animation.
      if (promise && typeof promise.catch === 'function') promise.catch(() => {});
    } catch (error) {
      console.warn(`[overlay] "${path}" could not be played.`, error);
    }
  }

  /**
   * Plays the sounds of one card reveal: the flip, then the rarity sting (4 and 5 only).
   *
   * @param {object} card - Revealed card.
   * @returns {void}
   */
  playCardSound(card) {
    this.playSound(SOUNDS.CARD_RETURN);
    if (card?.rarity === 4) {
      this.playSound(SOUNDS.CARD_RARITY_4);
    } else if (card?.rarity === 5) {
      this.playSound(SOUNDS.CARD_RARITY_5);
    } else if (card?.rarity === 3) {
      this.playSound(SOUNDS.CARD_RARITY_3);
    }
  }

  /**
   * Plays stage 2: each card appears face down, is revealed, then the next one comes.
   *
   * @returns {Promise<void>} Resolves once every card has been revealed.
   */
  async runReveal() {
    if (!this.spotlight) return;
    // The tear-open moment: the intro booster is gone, the first card takes its place.
    this.playSound(SOUNDS.BOOSTER_OPENING);
    if (this.revealHeadline) {
      this.revealHeadline.textContent = format(this.strings.openerNoName, { booster: this.pack.name });
      BoosterOverlay.show(this.revealHeadline);
    }

    // The click is emulated once the card has settled: the entry animation animates `transform`,
    // so a `flipDelayMs` shorter than `cardEntryMs` is clamped instead of cutting it off.
    const flipDelay = Math.max(this.timings.flipDelayMs, this.timings.cardEntryMs);
    if (flipDelay !== this.timings.flipDelayMs) {
      console.warn(
        `[overlay] flipDelayMs (${this.timings.flipDelayMs}) is shorter than cardEntryMs ` +
          `(${this.timings.cardEntryMs}): using ${flipDelay}ms so the entry animation can finish.`
      );
    }

    for (const card of this.pack.cards) {
      this.spotlight.textContent = '';
      const element = this.buildCard(card);
      this.spotlight.appendChild(element);
      await this.pause(flipDelay);
      this.flipCard(element, card);
      await this.pause(this.timings.cardHoldMs);
    }
  }

  /**
   * Reveals a card: the exact equivalent of the player clicking it in the game.
   *
   * The overlay is fully automatic, so the click is emulated here. Two things happen:
   *   1. the entry animation (`card-in`) is dropped, because a running or filling animation
   *      outranks the `.is-flipped` rule and would keep the card face down forever;
   *   2. `.is-flipped` is added, which is precisely what the game's click handler does, and the
   *      `transform` transition of `css/overlay.css` plays the flip.
   *
   * @param {HTMLElement} element - Card element built by `buildCard()`.
   * @param {object} [card] - Revealed card, used for the rarity sting.
   * @returns {void}
   */
  flipCard(element, card = null) {
    if (!element) return;
    element.classList.remove('is-entering');
    // Flush the style so the transition starts from the settled card, not from the animation.
    void element.offsetWidth;
    element.classList.add('is-flipped');
    this.playCardSound(card);
    console.debug('[overlay] Card revealed (player click emulated).');
  }

  /**
   * Builds one revealing card (back + front).
   *
   * The card starts with `is-entering`: that class carries the entry animation, which
   * `flipCard()` removes right before the flip so the two never fight over `transform`.
   *
   * @param {object} card - Display card.
   * @returns {HTMLElement} The card element.
   */
  buildCard(card) {
    const container = document.createElement('div');
    container.className =
      'overlay__card is-entering' + (card.rarity >= 4 ? ` overlay__card--r${card.rarity}` : '');

    const back = document.createElement('div');
    back.className = 'overlay__face overlay__face--back';
    const backImage = document.createElement('img');
    backImage.className = 'overlay__back-image';
    backImage.src = CARD_BACK_IMAGE;
    backImage.alt = '';
    back.appendChild(backImage);

    const front = document.createElement('div');
    front.className = 'overlay__face overlay__face--front';
    const image = document.createElement('img');
    image.className = 'overlay__image';
    image.src = resolveAssetPath(card.illustration, this.lang);
    image.alt = cardName(card, this.lang);
    const name = document.createElement('p');
    name.className = 'overlay__card-name';
    name.textContent = cardName(card, this.lang);
    front.append(image, name);

    container.append(back, front);
    return container;
  }

  /**
   * Renders stage 3: the summary grid with every card, plus the count line.
   *
   * @returns {void}
   */
  renderSummary() {
    if (!this.summaryGrid) return;
    this.summaryGrid.textContent = '';

    this.pack.cards.forEach((card, index) => {
      const tile = document.createElement('div');
      tile.className = `overlay__tile${card.rarity >= 4 ? ` overlay__tile--r${card.rarity}` : ''}`;
      tile.style.animationDelay = `${index * this.timings.tileStaggerMs}ms`;
      const image = document.createElement('img');
      image.className = 'overlay__image';
      image.src = resolveAssetPath(card.illustration, this.lang);
      image.alt = cardName(card, this.lang);
      const name = document.createElement('p');
      name.className = 'overlay__card-name';
      name.textContent = cardName(card, this.lang);
      tile.append(image, name);
      this.summaryGrid.appendChild(tile);
    });

    if (this.summaryLine) {
      this.summaryLine.textContent = format(this.strings.summary, { count: this.pack.cards.length });
      BoosterOverlay.show(this.summaryLine);
    }
  }

  /**
   * Cross-fades between two stages.
   *
   * @param {HTMLElement|null} from - Stage leaving.
   * @param {HTMLElement|null} to - Stage entering.
   * @returns {Promise<void>} Resolves once the new stage is visible.
   */
  async transition(from, to) {
    if (from) {
      from.classList.add('is-leaving');
      await this.pause(this.timings.stageTransitionMs);
      from.hidden = true;
      from.classList.remove('is-leaving');
    }
    if (to) {
      to.hidden = false;
      // Replay the entry animation of the stage.
      to.style.animation = 'none';
      void to.offsetWidth;
      to.style.animation = '';
    }
  }

  /**
   * Waits for a duration, remembering the timer so `teardown()` can cancel it.
   *
   * @param {number} ms - Milliseconds to wait.
   * @returns {Promise<void>} Resolves after the delay.
   */
  async pause(ms) {
    await new Promise((resolve) => {
      const handle = window.setTimeout(() => {
        this.timers = this.timers.filter((timer) => timer !== handle);
        resolve();
      }, ms);
      this.timers.push(handle);
    });
  }

  /**
   * Fades everything out, then erases all content so the page shows nothing.
   *
   * @returns {Promise<void>} Resolves once the page is empty.
   */
  async teardown() {
    this.disposeBooster();
    this.timers.forEach((timer) => window.clearTimeout(timer));
    this.timers = [];
    this.audio.forEach((element) => {
      try {
        element.pause();
        element.src = '';
      } catch (error) {
        console.warn('[overlay] An audio element could not be released.', error);
      }
    });
    this.audio.clear();

    this.root.dataset.leaving = 'true';
    await new Promise((resolve) => window.setTimeout(resolve, this.timings.fadeOutMs));

    this.root.hidden = true;
    this.root.textContent = '';
    this.root.dataset.leaving = 'false';
    document.body.textContent = '';
  }
}

/**
 * Boots the overlay from the query string. A missing/invalid code leaves the page empty.
 *
 * @returns {Promise<void>} Resolves once the sequence finished (or immediately when empty).
 */
async function boot() {
  const params = new URLSearchParams(window.location.search);
  const parsed = parseCode(params.get('code') ?? '');
  if (!parsed) {
    console.warn('[overlay] No valid `code` parameter: nothing is displayed.');
    return;
  }

  const requestedLang = (params.get('lang') ?? 'fr').toLowerCase();
  const lang = requestedLang.startsWith('en') ? 'en' : 'fr';
  document.documentElement.lang = lang;

  const pack = await loadPack(parsed.setId, parsed.positions);
  if (!pack) {
    console.warn('[overlay] The booster could not be resolved: nothing is displayed.');
    return;
  }

  const root = document.getElementById('overlay-root');
  if (!root) return;

  // The timeline is published to the stylesheet BEFORE anything is displayed, so the entry
  // animations already run with the configured durations.
  const config = await loadConfig();
  applyCssVariables(config);

  const overlay = new BoosterOverlay({
    root,
    pack,
    lang,
    username: (params.get('username') ?? '').trim(),
    profileIconUrl: (params.get('profileiconurl') ?? '').trim(),
    config,
  });
  await overlay.start();
}

boot();

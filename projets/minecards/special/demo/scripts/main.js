/**
 * main.js - Boot, preload and runner of the MineCards showcase.
 *
 * Reference: `special/demo.html` (the loader and the stage), `special/demo/config.json` (palette
 * and strings), `special/demo/animations.json` (tempo) and `special/demo/assets.json` (cards and
 * pictures).
 *
 * The page has exactly two gestures: LOAD runs the whole preload (the two catalogues, every card,
 * every picture), then LAUNCH plays the film. Nothing is fetched, built or decoded while the show
 * runs: every scene and every card print already exists when the first beat starts.
 */

import {
  beat,
  cameraEnabled,
  nextFrame,
  parallax,
  resolve,
  runCamera,
  sleep,
  state,
  tr,
} from './core.js';
import { CardLibrary, applyDefaultDesign, preloadImages } from './cards.js';
import { buildScene } from './scenes.js';
import i18n from '../../../js/utils/I18n.js';
import cardLanguage from '../../../js/utils/CardLanguage.js';

/** Elements of the page, read once. */
const ui = {
  body: document.body,
  stage: document.querySelector('[data-demo-stage]'),
  camera: document.querySelector('[data-demo-camera]'),
  world: document.querySelector('[data-demo-world]'),
  flash: document.querySelector('[data-demo-flash]'),
  loader: document.querySelector('[data-demo-loader]'),
  loaderTitle: document.querySelector('[data-demo-loader-title]'),
  loaderSubtitle: document.querySelector('[data-demo-loader-subtitle]'),
  loaderLabel: document.querySelector('[data-demo-loader-label]'),
  loaderCount: document.querySelector('[data-demo-loader-count]'),
  loaderHint: document.querySelector('[data-demo-loader-hint]'),
  progress: document.querySelector('[data-demo-progress]'),
  progressBar: document.querySelector('.demo-loader__bar'),
  loadButton: document.querySelector('[data-demo-load]'),
  startButton: document.querySelector('[data-demo-start]'),
  bpm: document.querySelector('[data-demo-bpm]'),
  bpmValue: document.querySelector('[data-demo-bpm-value]'),
  bpmLabel: document.querySelector('[data-demo-bpm-label]'),
  hudToggle: document.querySelector('[data-demo-hud-toggle]'),
  hudLabel: document.querySelector('[data-demo-hud-label]'),
  langLabel: document.querySelector('[data-demo-lang-label]'),
  lang: document.querySelector('[data-demo-lang]'),
  formatLabel: document.querySelector('[data-demo-format-label]'),
  format: document.querySelector('[data-demo-format]'),
  hud: document.querySelector('[data-demo-hud]'),
  hudStage: document.querySelector('[data-demo-hud-stage]'),
  hudBpm: document.querySelector('[data-demo-hud-bpm]'),
  replay: document.querySelector('[data-demo-replay]'),
};

/** @type {{element: HTMLElement, play: () => Promise<void>}[]} Built scenes, in play order. */
let scenes = [];
/** @type {object|null} Context handed to every scene builder. */
let context = null;
/** @type {boolean} True while the preload runs. */
let loading = false;
/** @type {boolean} True once the whole preload succeeded. */
let ready = false;
/** @type {boolean} True once the visitor moved the tempo slider by hand. */
let bpmTouched = false;
/** @type {'auto'|'horizontal'|'vertical'} What the format select shows: the choice, not the result. */
let formatChoice = 'auto';
/**
 * Move of the camera currently on the stage. The ambient layers loop forever, so every one of them
 * has to be cancelled by hand when its scene ends: nothing else in the page stops them, and they
 * would stack on the camera of the next replay.
 *
 * @type {{cancel: () => void}|null}
 */
let cameraMove = null;

/**
 * Reads the tempo chosen in the loader, kept inside the supported range.
 *
 * @returns {number} The tempo in beats per minute.
 */
function chosenBpm() {
  const value = Number(ui.bpm?.value);
  return Math.min(280, Math.max(80, Number.isFinite(value) ? value : 96));
}

/**
 * Writes the chosen tempo in the loader, the hint and the HUD.
 *
 * @returns {void}
 */
function updateBpmText() {
  const bpm = chosenBpm();
  if (ui.bpmValue) ui.bpmValue.textContent = tr('hud.bpm', { bpm });
  ui.hudBpm.textContent = tr('hud.bpm', { bpm });
  ui.loaderHint.textContent = `${ui.hudStage.textContent} - ${ui.hudBpm.textContent}`;
}

/**
 * Fetches one JSON file of the demo folder, relative to the page.
 *
 * @param {string} name - File name inside `special/demo/`.
 * @returns {Promise<unknown>} The parsed value.
 * @throws {Error} When the file cannot be read.
 */
async function fetchDemoJson(name) {
  // A revalidated read: the show is tuned in these files, and a stale timeline in the HTTP cache
  // plays the previous lengths against the new scenes.
  const response = await fetch(new URL(`special/demo/${name}`, document.baseURI), { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error(`demo/${name} answered ${response.status}.`);
  }
  return response.json();
}

/**
 * Picks the language of the show: `?lang=`, then the browser, then the configured default.
 *
 * @param {object} config - Parsed `demo/config.json`.
 * @returns {'fr'|'en'} The language.
 */
function pickLanguage(config) {
  const requested = (new URLSearchParams(window.location.search).get('lang') ?? '')
    .trim()
    .toLowerCase();
  if (requested === 'fr' || requested === 'en') return requested;
  const browser = (navigator.language ?? '').slice(0, 2).toLowerCase();
  if (browser === 'fr' || browser === 'en') return browser;
  return config.meta?.defaultLang === 'en' ? 'en' : 'fr';
}

/**
 * Reads the shape of the window and returns the format that fills it best: the closest stage
 * ratio wins, so a phone held upright gets the vertical cut and a desktop window the horizontal one.
 *
 * @param {object} config - Parsed `demo/config.json`.
 * @returns {'horizontal'|'vertical'} The detected format.
 */
function detectFormat(config) {
  const [verticalWidth, verticalHeight] = config.stage?.vertical ?? [1080, 1920];
  const [horizontalWidth, horizontalHeight] = config.stage?.horizontal ?? [1920, 1080];
  const windowRatio = window.innerWidth / Math.max(1, window.innerHeight);
  if (!Number.isFinite(windowRatio) || windowRatio <= 0) {
    return config.meta?.defaultFormat === 'vertical' ? 'vertical' : 'horizontal';
  }
  const verticalGap = Math.abs(Math.log(windowRatio / (verticalWidth / verticalHeight)));
  const horizontalGap = Math.abs(Math.log(windowRatio / (horizontalWidth / horizontalHeight)));
  return verticalGap < horizontalGap ? 'vertical' : 'horizontal';
}

/**
 * Picks the format of the show: `?format=vertical` or `?format=horizontal` when the link forces
 * one, otherwise the shape of the window. `formatChoice` keeps what the loader must display.
 *
 * @param {object} config - Parsed `demo/config.json`.
 * @returns {'horizontal'|'vertical'} The format.
 */
function pickFormat(config) {
  const requested = (new URLSearchParams(window.location.search).get('format') ?? '')
    .trim()
    .toLowerCase();
  if (requested === 'vertical' || requested === 'horizontal') {
    formatChoice = requested;
    return requested;
  }
  formatChoice = 'auto';
  return detectFormat(config);
}

/**
 * Applies the theme of the configuration: the named application theme plus the colour tokens.
 *
 * @param {object} theme - `theme` block of `config.json`.
 * @returns {void}
 */
function applyTheme(theme = {}) {
  const preset = typeof theme.preset === 'string' && theme.preset !== '' ? theme.preset : 'night';
  document.documentElement.dataset.theme = preset;
  document.body.dataset.theme = preset;

  const tokens = {
    background: '--demo-ink',
    backgroundDeep: '--demo-deep',
    surface: '--demo-surface',
    surfaceAlt: '--demo-surface-alt',
    border: '--demo-border',
    text: '--demo-text',
    muted: '--demo-muted',
    accent: '--demo-accent',
    accentSoft: '--demo-accent-soft',
    gold: '--demo-gold',
    rose: '--demo-rose',
    cyan: '--demo-cyan',
    violet: '--demo-violet',
    success: '--demo-success',
    ink: '--demo-black',
    title: '--demo-title-ink',
  };
  Object.entries(tokens).forEach(([key, variable]) => {
    const value = theme.colors?.[key];
    if (typeof value === 'string' && value !== '') {
      document.documentElement.style.setProperty(variable, value);
    }
  });
}

/**
 * Sizes the stage from the format and scales it to the window.
 *
 * @param {object} config - Parsed `demo/config.json`.
 * @returns {void}
 */
function fitStage(config) {
  const format = state.format;
  const [width, height] = config.stage?.[format] ?? [1920, 1080];
  ui.stage.style.setProperty('--stage-w', `${width}px`);
  ui.stage.style.setProperty('--stage-h', `${height}px`);
  const scale = Math.min(window.innerWidth / width, window.innerHeight / height);
  ui.stage.style.setProperty('--stage-scale', String(scale));
}

/**
 * Writes the texts of the loader and of the HUD in the selected language.
 *
 * @param {object} config - Parsed `demo/config.json`.
 * @returns {void}
 */
function applyTexts(config) {
  document.title = config.meta?.title ?? 'MineCards - Demo';
  document.documentElement.lang = state.lang;
  ui.loaderTitle.textContent = tr('loader.title');
  ui.loaderSubtitle.textContent = tr('loader.subtitle');
  ui.loaderLabel.textContent = tr('loader.waiting');
  ui.loadButton.textContent = tr('loader.load');
  ui.startButton.textContent = tr('loader.start');
  ui.replay.textContent = tr('hud.replay');
  ui.hudStage.textContent = tr(state.format === 'vertical' ? 'hud.stageVertical' : 'hud.stage');
  if (ui.bpmLabel) ui.bpmLabel.textContent = tr('loader.bpm');
  if (ui.hudLabel) ui.hudLabel.textContent = tr('loader.hud');
  if (ui.langLabel) ui.langLabel.textContent = tr('loader.lang');
  if (ui.lang) ui.lang.value = state.lang;
  if (ui.formatLabel) ui.formatLabel.textContent = tr('loader.format');
  if (ui.format) {
    const names = {
      auto: 'loader.formatAuto',
      horizontal: 'loader.formatHorizontal',
      vertical: 'loader.formatVertical',
    };
    ui.format.value = formatChoice;
    Array.from(ui.format.options).forEach((option) => {
      option.textContent = tr(names[option.value] ?? option.value);
    });
  }
  updateBpmText();
}

/**
 * Switches the language of the configuration. Before a preload the texts can change in place;
 * once cards and scenes exist, the page reloads so every generated print and dictionary is rebuilt
 * in the new language instead of leaving a half-translated show behind.
 *
 * @param {string} lang - `fr` or `en`.
 * @returns {void}
 */
function switchLanguage(lang) {
  if (lang !== 'fr' && lang !== 'en') return;
  if (lang === state.lang) return;

  const url = new URL(window.location.href);
  url.searchParams.set('lang', lang);
  if (ready || loading || scenes.length > 0) {
    window.location.assign(url.href);
    return;
  }

  state.lang = lang;
  document.documentElement.lang = lang;
  window.history.replaceState(null, '', url.href);
  applyTexts(state.config);
}

/**
 * Switches the format of the show. `auto` drops the link parameter and follows the shape of the
 * window again. Before a preload the stage resizes in place; once scenes exist the page reloads,
 * because every scene was built for the previous cut.
 *
 * @param {'auto'|'horizontal'|'vertical'} value - Choice of the loader select.
 * @returns {void}
 */
function switchFormat(value) {
  if (value !== 'auto' && value !== 'horizontal' && value !== 'vertical') return;

  const url = new URL(window.location.href);
  if (value === 'auto') url.searchParams.delete('format');
  else url.searchParams.set('format', value);
  if (ready || loading || scenes.length > 0) {
    window.location.assign(url.href);
    return;
  }

  formatChoice = value;
  state.format = value === 'auto' ? detectFormat(state.config) : value;
  ui.body.dataset.format = state.format;
  window.history.replaceState(null, '', url.href);
  fitStage(state.config);
  applyTexts(state.config);
}

/**
 * Writes the progress of the preload.
 *
 * @param {number} done - Pictures settled.
 * @param {number} total - Pictures to load.
 * @returns {void}
 */
function setProgress(done, total) {
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  ui.progress.style.width = `${percent}%`;
  ui.progressBar.setAttribute('aria-valuenow', String(percent));
  ui.loaderCount.textContent = tr('loader.count', { done, total });
}

/**
 * Collects every card reference of the assets manifest.
 *
 * @param {object} assets - Parsed `demo/assets.json`.
 * @returns {string[]} The references.
 */
function collectReferences(assets) {
  const references = new Set(assets.phaseCards ?? []);
  const setId = new Set(Object.keys(assets.sets ?? {}));

  /**
   * Visits every value of the block and keeps the card references.
   *
   * @param {unknown} value - Value to walk.
   * @returns {void}
   */
  const walk = (value) => {
    if (typeof value === 'string') {
      const separator = value.indexOf(':');
      if (separator > 0 && setId.has(value.slice(0, separator))) references.add(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };

  walk(assets);
  return [...references];
}

/**
 * Collects every picture of the assets manifest.
 *
 * @param {object} assets - Parsed `demo/assets.json`.
 * @param {CardLibrary} library - Loaded cards.
 * @param {string[]} references - Every card displayed by the show.
 * @returns {string[]} The picture URLs (project-relative or absolute).
 */
function collectImages(assets, library, references) {
  const urls = new Set(library.images(references));
  const imagePattern = /\.(?:png|webp|jpe?g|gif|svg)$/i;

  /**
   * Visits every value and keeps the picture paths.
   *
   * @param {unknown} value - Value to walk.
   * @returns {void}
   */
  const walk = (value) => {
    if (typeof value === 'string' && imagePattern.test(value)) {
      urls.add(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };

  walk(assets.media);
  Object.values(assets.sets ?? {}).forEach((entry) => {
    if (entry.art) urls.add(entry.art);
    if (entry.icon) urls.add(entry.icon);
  });
  (assets.friends ?? []).forEach((friend) => urls.add(friend.avatar));
  (assets.profiles ?? []).forEach((profile) => urls.add(profile.avatar));
  return [...urls];
}

/**
 * Builds every scene of the timeline, before the first beat.
 *
 * @returns {void}
 */
function buildScenes() {
  scenes = state.animations.scenes.map((definition) => {
    const scene = buildScene(definition, context);
    ui.world.append(scene.element);
    return scene;
  });
}

/**
 * Runs the preload: catalogues, cards, pictures, then the construction of the scenes.
 *
 * @returns {Promise<void>} Resolves once LAUNCH is available.
 */
async function preload() {
  if (loading) return;
  loading = true;
  ui.loadButton.disabled = true;
  ui.loadButton.hidden = false;
  ui.startButton.hidden = true;
  ui.loaderLabel.textContent = tr('loader.preparing');
  setProgress(0, 0);

  try {
    const [animations, assets] = await Promise.all([
      fetchDemoJson('animations.json'),
      fetchDemoJson('assets.json'),
    ]);
    state.animations = animations;
    state.assets = assets;
    state.bpm = Number(animations.bpm) > 0 ? Number(animations.bpm) : 96;
    state.beatMs = 60000 / state.bpm;
    document.documentElement.style.setProperty('--beat-time', `${state.beatMs}ms`);
    if (ui.bpm && !bpmTouched) ui.bpm.value = String(Math.round(state.bpm));
    updateBpmText();

    applyDefaultDesign();
    // The real profile card reads the application dictionaries. The demo picks its language from
    // the query string, so the two mirrors are restored afterwards: visiting `?lang=en` must not
    // silently change the language of the game itself.
    const languageMirrors = ['mc_lang', 'mc_card_lang'].map((key) => {
      try {
        return [key, window.localStorage.getItem(key)];
      } catch (error) {
        return [key, null];
      }
    });
    try {
      await i18n.init(state.lang);
      await cardLanguage.init(state.lang);
    } catch (error) {
      console.warn('[demo] The application i18n could not be initialised; profile cards keep their fallback labels.', error);
    } finally {
      languageMirrors.forEach(([key, value]) => {
        try {
          if (value === null) window.localStorage.removeItem(key);
          else window.localStorage.setItem(key, value);
        } catch (error) {
          // Storage can be unavailable (private mode, blocked cookies): the demo still runs.
        }
      });
    }
    const library = await CardLibrary.load(assets, state.lang);
    const references = collectReferences(assets);
    const urls = collectImages(assets, library, references);
    const result = await preloadImages(urls, {
      onProgress: (done, total) => setProgress(done, total),
    });
    if (result.failed > 0) {
      console.warn(`[demo] ${result.failed} picture(s) could not be preloaded; the show continues.`);
    }

    // Long rows: three rows of ten cards need thirty prints, so the pool cycles the phase cards.
    const phaseRefs = assets.phaseCards ?? [];
    const phasePool = Array.from({ length: 30 }, (_, index) =>
      library.build(phaseRefs[index % phaseRefs.length], { className: 'demo__card--mini' })
    );
    context = {
      assets,
      animations,
      config: state.config,
      library,
      lib: library,
      asset: resolve,
      flashLayer: ui.flash,
      phasePool,
    };

    setProgress(result.total, result.total);
    buildScenes();
    // The 3D booster and the real profile cards prepare while the loader is still up, so no
    // WebGL context or profile stylesheet is ever built on the first beat.
    await Promise.all(scenes.map((scene) => scene.prepare).filter(Boolean));
    ui.loaderLabel.textContent = tr('loader.ready');
    ready = true;
    ui.loadButton.hidden = true;
    ui.startButton.hidden = false;
    ui.startButton.disabled = false;
    ui.startButton.focus({ preventScroll: true });
  } catch (error) {
    console.error('[demo] The preload failed.', error);
    ui.loaderLabel.textContent = tr('loader.error');
    ui.loadButton.disabled = false;
  } finally {
    loading = false;
  }
}

/**
 * Plays the whole timeline, one scene after another.
 *
 * @returns {Promise<void>} Resolves when the outro ended.
 */
async function playShow() {
  if (!ready || state.playing) return;
  state.playing = true;
  const bpm = chosenBpm();
  state.bpm = bpm;
  state.beatMs = 60000 / bpm;
  state.animations.bpm = bpm;
  document.documentElement.style.setProperty('--beat-time', `${state.beatMs}ms`);
  ui.hudBpm.textContent = tr('hud.bpm', { bpm });
  ui.body.classList.toggle('demo--no-hud', ui.hudToggle ? !ui.hudToggle.checked : false);
  ui.replay.hidden = true;
  // A move left behind by an interrupted run is dropped before the new one starts.
  cameraMove?.cancel();
  cameraMove = null;

  // REPLAY returns to the configuration and empties the world: the next LAUNCH rebuilds the
  // scenes from the same preloaded cards, without fetching a single picture again.
  if (scenes.length === 0) {
    ui.loaderLabel.textContent = tr('loader.preparing');
    try {
      buildScenes();
      await Promise.all(scenes.map((scene) => scene.prepare).filter(Boolean));
    } catch (error) {
      console.error('[demo] The scenes could not be rebuilt.', error);
      ui.loaderLabel.textContent = tr('loader.error');
      state.playing = false;
      return;
    }
  }

  ui.loaderLabel.textContent = tr('loader.ready');
  ui.loader.classList.add('is-hidden');
  ui.hud.hidden = false;
  await sleep(state.beatMs * 0.6);

  const crossfade = Number(state.animations?.crossfadeBeats) || 1;
  const lastIndex = state.animations.scenes.length - 1;

  for (let index = 0; index < state.animations.scenes.length; index += 1) {
    const definition = state.animations.scenes[index];
    const built = scenes[index];
    if (!built) continue;
    const duration = beat(definition.beats);
    const startedAt = performance.now();
    built.element.classList.add('is-live');
    await nextFrame();

    cameraMove = runCamera(ui.camera, definition.camera, duration, definition);
    if (cameraEnabled('parallax', definition)) {
      built.element.querySelectorAll('[data-depth]').forEach((layer, index) => {
        parallax(layer, duration, index % 2 === 0 ? -1 : 1);
      });
    }

    try {
      await Promise.race([built.play(), sleep(duration)]);
    } catch (error) {
      console.error(`[demo] The scene "${definition.id}" failed.`, error);
    }
    await sleep(Math.max(0, duration - (performance.now() - startedAt)));

    // The camera of every scene is released, the last one included: its layers loop, and leaving
    // them running would add a move to the camera of the next replay. The end card is the only
    // scene that stays on screen, and by now its black fade covers the reset.
    cameraMove?.cancel();
    cameraMove = null;

    // The end card is the only scene that stays on screen: the show ends on the name of the
    // game, not on the empty stage behind it. Every other scene hands its place to the next one.
    if (index !== lastIndex) {
      built.element.classList.remove('is-live');
      await sleep(state.beatMs * crossfade * 0.6);
    }
  }

  state.playing = false;
  ui.replay.hidden = false;
}

/**
 * Rebuilds the scenes and plays the show again.
 *
 * @returns {Promise<void>} Resolves once the replay ended.
 */
async function returnToConfiguration() {
  if (!ready || state.playing) return;
  ui.replay.hidden = true;
  ui.hud.hidden = true;
  ui.body.classList.remove('demo--no-hud');
  cameraMove?.cancel();
  cameraMove = null;
  scenes.forEach((scene) => {
    scene.dispose?.();
    scene.element.remove();
  });
  scenes = [];
  ui.world.replaceChildren();
  ui.loader.classList.remove('is-hidden');
  ui.loadButton.hidden = true;
  ui.startButton.hidden = false;
  ui.startButton.disabled = false;
  ui.loaderLabel.textContent = tr('loader.ready');
  ui.startButton.focus({ preventScroll: true });
}

/**
 * Boots the page: reads the query, applies the theme, wires the two buttons.
 *
 * @returns {Promise<void>} Resolves once the page is ready to be loaded.
 */
async function boot() {
  state.appRoot = new URL('./', document.baseURI).href;
  const config = await fetchDemoJson('config.json');
  state.config = config;
  state.lang = pickLanguage(config);
  state.format = pickFormat(config);
  state.animations = { bpm: 96 };
  state.beatMs = 625;

  applyTheme(config.theme);
  state.appRoot = new URL(config.paths?.appRoot ?? './', document.baseURI).href;
  ui.body.dataset.format = state.format;
  fitStage(config);
  applyTexts(config);

  const favicon = document.querySelector('link[rel="icon"]');
  if (favicon && config.paths?.favicon) favicon.href = resolve(config.paths.favicon);

  ui.loadButton.addEventListener('click', () => void preload());
  ui.startButton.addEventListener('click', () => void playShow());
  ui.replay.addEventListener('click', () => void returnToConfiguration());
  ui.bpm?.addEventListener('input', () => {
    bpmTouched = true;
    updateBpmText();
  });
  ui.lang?.addEventListener('change', () => switchLanguage(ui.lang.value));
  ui.format?.addEventListener('change', () => switchFormat(ui.format.value));
  // AUTO follows the window: turning a phone on the loader must swap the cut, while a format the
  // visitor forced is never overwritten. Once scenes exist they were built for one cut, hence the
  // reload rule of `switchFormat`.
  window.addEventListener('resize', () => {
    if (formatChoice === 'auto' && !ready && !loading && scenes.length === 0) {
      const detected = detectFormat(config);
      if (detected !== state.format) {
        state.format = detected;
        ui.body.dataset.format = detected;
        applyTexts(config);
      }
    }
    fitStage(config);
  });
}

boot().catch((error) => {
  console.error('[demo] The page could not start.', error);
  ui.loaderLabel.textContent = tr('loader.error');
});

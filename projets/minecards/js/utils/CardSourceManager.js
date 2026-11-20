/**
 * CardSourceManager - Where the game takes the face of a card from.
 *
 * Two sources, one developer preference (`settings.cardSource`):
 *   - `image`    : the current behaviour, the final PNG/WebP written in `Path`;
 *   - `generate` : a card built from the JSON fields (`Background`, `Underlay`, name, description,
 *                  rarity and layout) by `<card-print>`.
 *
 * The generated source only applies while the developer mode and the advanced developer mode are
 * both on. The preference is still stored when either switch is off, so turning them back on
 * restores the choice, but the effective source (`isGenerateEnabled()`) is the AND of the three.
 *
 * ONE HELPER FOR EVERY SCREEN
 *   `createCardVisual()` returns either the usual `<img>` or a `<card-print>`. Both wear the class
 *   the caller passed, so the box reserved by the view is unchanged. Every visual is tagged with
 *   `data-card-visual`, which is what lets `repaintCardVisuals()` swap the already displayed cards
 *   when the setting changes, without a reload.
 *
 * The manager does not import `AccountManager` (the account imports the two constants below):
 * `app.js` applies the stored settings at boot, and the settings screen applies them live.
 */

import i18n from './I18n.js';
import cardLanguage from './CardLanguage.js';
import eventBus, { EVENTS } from './EventBus.js';
import { CardPrint } from '../UI/components/CardPrint.js';

/** The two accepted values of `settings.cardSource`. */
export const CARD_SOURCE = Object.freeze({
  IMAGE: 'image',
  GENERATE: 'generate',
});

/** Accepted values, for normalization and validation. */
export const CARD_SOURCE_VALUES = Object.freeze(Object.values(CARD_SOURCE));

/** Source a new account starts from. */
export const DEFAULT_CARD_SOURCE = CARD_SOURCE.IMAGE;

/** Duration of one animated-layers cycle at 100 % speed, in seconds. */
export const ANIMATED_LAYERS_BASE_DURATION_SECONDS = 30;

/** Reference speed of the animated layers, in percent (100 % = one 30-second cycle). */
export const DEFAULT_ANIMATED_LAYERS_SPEED = 100;

/**
 * Converts the stored speed percentage into the duration of one animation cycle.
 *
 * The setting is a speed, so a higher percentage means a SHORTER cycle: 100 % keeps the reference
 * 30 seconds, 200 % runs twice as fast (15 s), 50 % takes 60 s. The value is rounded to a tenth of a
 * second so the stylesheet receives a stable string and the settings screen can show it.
 *
 * @param {unknown} speed - Speed in percent of the reference cycle.
 * @returns {number} Duration of one cycle, in seconds.
 */
export function resolveAnimatedLayersDuration(speed = DEFAULT_ANIMATED_LAYERS_SPEED) {
  const value = Number(speed);
  const factor = Number.isFinite(value) && value > 0 ? value / 100 : 1;
  return Math.round((ANIMATED_LAYERS_BASE_DURATION_SECONDS / factor) * 10) / 10;
}

/** Event dispatched on `document` after the source changed and the visible cards were repainted. */
export const CARD_SOURCE_CHANGED_EVENT = 'card-source-changed';

/** Cards seen by `createCardVisual()`, indexed by `uniqueKey` (used to repaint an existing image). */
const cardRegistry = new Map();

/** Current effective state. */
const state = {
  devMode: false,
  advancedDevMode: false,
  cardSource: DEFAULT_CARD_SOURCE,
  generate: false,
  animatedLayers: false,
  animatedLayersSpeed: DEFAULT_ANIMATED_LAYERS_SPEED,
  listening: false,
};

/**
 * Reads a stored value, falling back to `image`.
 *
 * @param {unknown} value - Stored or requested source.
 * @returns {string} `image` or `generate`.
 */
export function normalizeCardSource(value) {
  return CARD_SOURCE_VALUES.includes(value) ? value : DEFAULT_CARD_SOURCE;
}

/**
 * Tells whether cards must currently be built from JSON.
 *
 * @returns {boolean} True when both developer modes and the generated source are active.
 */
export function isGenerateEnabled() {
  return state.generate;
}

/**
 * Tells whether the generated-card animation is currently effective.
 *
 * The source must be generated AND the preference on. A detail uses this to decide whether it
 * needs the local "Effets" switch even for a common card: such a card has no glare and no foil, but
 * its layers still move, so the switch is the only way to stop them without changing the account.
 *
 * @returns {boolean} True when the next generated card will animate.
 */
export function isAnimatedLayersActive() {
  return state.generate && state.animatedLayers;
}

/**
 * The source selected in the settings, even when the developer mode is off.
 *
 * @returns {string} `image` or `generate`.
 */
export function getCardSource() {
  return state.cardSource;
}

/**
 * Subscribes once to the events that change the texts of an already drawn card.
 *
 * @returns {void}
 */
function listen() {
  if (state.listening) return;
  state.listening = true;
  const refresh = () => refreshCardVisuals();
  eventBus.on(EVENTS.LANG_CHANGED, refresh);
  eventBus.on(EVENTS.CARD_LANG_CHANGED, refresh);
}

/**
 * Remembers a card so an existing `<img>` can be replaced without the caller keeping it.
 *
 * @param {object|null} card - Card displayed.
 * @returns {void}
 */
function remember(card) {
  if (card && typeof card.uniqueKey === 'string') {
    cardRegistry.set(card.uniqueKey, card);
  }
}

/**
 * Builds the `<img>` of the image source.
 *
 * @param {object} card - Card to display.
 * @param {object} options - Display options.
 * @returns {HTMLImageElement} The image.
 */
function buildImage(card, options) {
  const image = document.createElement('img');
  applyCommonOptions(image, card, options);
  image.loading = options.loading ?? 'lazy';
  image.decoding = options.decoding ?? 'async';
  if (card) {
    image.src = i18n.resolveImagePath(card.illustration);
  }
  return image;
}

/**
 * Builds the generated card of the `generate` source.
 *
 * @param {object} card - Card to display.
 * @param {object} options - Display options.
 * @returns {CardPrint} The card element.
 */
function buildGenerated(card, options) {
  // Constructed directly rather than through `document.createElement`: the registry can hand back
  // an unupgraded HTMLUnknownElement for an already defined tag, while the class constructor always
  // produces the shadow-bearing autonomous element this helper expects.
  const visual = new CardPrint();
  applyCommonOptions(visual, card, options);
  visual.setCard(card, {
    mini: options.mini === true,
    lang: options.lang ?? cardLanguage.getLang(),
  });
  visual.setAnimatedLayers(state.animatedLayers);
  visual.setAnimatedLayersView(options.animatedLayers === true);
  return visual;
}

/**
 * Copies the class, accessibility and caller data every visual needs.
 *
 * @param {HTMLElement} element - Image or card element.
 * @param {object|null} card - Card displayed.
 * @param {object} options - Display options.
 * @returns {void}
 */
function applyCommonOptions(element, card, options) {
  if (options.className) element.className = options.className;
  if (card) element.dataset.cardVisual = card.uniqueKey;
  element.dataset.cardMini = String(options.mini === true);
  element.dataset.cardAnimated = String(options.animatedLayers === true);

  if (options.ariaHidden === true) {
    element.setAttribute('aria-hidden', 'true');
  } else if (options.alt !== undefined && options.alt !== null && options.alt !== '') {
    element.setAttribute('role', 'img');
    element.setAttribute('aria-label', options.alt);
  }
  if (options.alt !== undefined) element.setAttribute('alt', options.alt);
  if (options.title) element.setAttribute('title', options.title);
}

/**
 * Creates the face of a card: the final image or the generated card.
 *
 * @param {object|null} card - Card to display.
 * @param {object} [options] - Display options.
 * @param {string} [options.className] - Class the caller's stylesheet sizes the visual with.
 * @param {string} [options.alt] - Accessible name (empty for a decorative visual).
 * @param {boolean} [options.ariaHidden=false] - Hide the visual from assistive technologies.
 * @param {boolean} [options.mini=false] - Hide the card texts (generated source only).
 * @param {boolean} [options.animatedLayers=false] - Allow the layers to move (detail popups and
 *   booster reveals only; the grids stay still).
 * @param {string} [options.lang] - Language of the generated text.
 * @param {string} [options.loading='lazy'] - Native loading of an image.
 * @param {string} [options.decoding='async'] - Native decoding of an image.
 * @returns {HTMLElement} An `<img>` or a `<card-print>`.
 */
export function createCardVisual(card, options = {}) {
  listen();
  remember(card);
  return state.generate && card ? buildGenerated(card, options) : buildImage(card, options);
}

/**
 * Updates a visual in place, whichever source built it.
 *
 * @param {HTMLElement|null} element - Image or card element.
 * @param {object|null} card - Card to display.
 * @param {object} [options] - Display options (`alt`, `mini`, `animatedLayers`, `lang`).
 * @returns {HTMLElement|null} The same element.
 */
export function updateCardVisual(element, card, options = {}) {
  if (!element) return null;
  remember(card);
  if (options.animatedLayers !== undefined) {
    element.dataset.cardAnimated = String(options.animatedLayers === true);
  }
  if (element instanceof CardPrint || element.localName === 'card-print') {
    element.setCard(card, {
      mini: options.mini ?? element.hasAttribute('mini'),
      lang: options.lang ?? cardLanguage.getLang(),
    });
    element.setAnimatedLayers(state.animatedLayers);
    if (options.animatedLayers !== undefined) {
      element.setAnimatedLayersView(options.animatedLayers === true);
    }
    if (options.alt !== undefined) {
      element.setAttribute('aria-label', options.alt);
      element.setAttribute('alt', options.alt);
    }
    return element;
  }
  if (element instanceof HTMLImageElement || element.localName === 'img') {
    if (card) {
      element.src = i18n.resolveImagePath(card.illustration);
      element.dataset.cardVisual = card.uniqueKey;
    } else {
      element.removeAttribute('src');
      delete element.dataset.cardVisual;
    }
    if (options.alt !== undefined) element.alt = options.alt;
    return element;
  }
  return element;
}

/**
 * Copies the caller-owned attributes of one visual onto its replacement.
 *
 * @param {HTMLElement} from - Visual being replaced.
 * @param {HTMLElement} to - Visual taking its place.
 * @returns {void}
 */
function copyPresentation(from, to) {
  to.className = from.className;
  ['id', 'title', 'hidden', 'width', 'height', 'effects-off'].forEach((attribute) => {
    if (from.hasAttribute(attribute)) {
      to.setAttribute(attribute, from.getAttribute(attribute));
    }
  });
  if (from.hasAttribute('aria-hidden')) {
    to.setAttribute('aria-hidden', from.getAttribute('aria-hidden'));
  }
  for (const [key, value] of Object.entries(from.dataset)) {
    if (key !== 'cardVisual' && key !== 'cardMini') to.dataset[key] = value;
  }
}

/**
 * Replaces a single visual by the same card in the other source.
 *
 * @param {HTMLElement} current - Existing image or card element.
 * @param {object} card - Card displayed.
 * @param {object} [options] - Display options.
 * @returns {HTMLElement} The replacement (or `current` when no swap was needed).
 */
export function replaceCardVisual(current, card, options = {}) {
  const wantsGenerated = state.generate;
  const isGenerated = current instanceof CardPrint || current.localName === 'card-print';
  if (wantsGenerated === isGenerated) {
    return updateCardVisual(current, card, options);
  }

  const alt = options.alt ?? (current.hasAttribute('aria-hidden') ? '' : current.getAttribute('aria-label') ?? current.getAttribute('alt') ?? '');
  const mini = options.mini ?? current.dataset.cardMini === 'true';
  const animatedLayers = options.animatedLayers ?? current.dataset.cardAnimated === 'true';
  const replacement = wantsGenerated
    ? buildGenerated(card, { ...options, alt, mini, animatedLayers })
    : buildImage(card, { ...options, alt, mini, animatedLayers });
  copyPresentation(current, replacement);
  replacement.dataset.cardVisual = card.uniqueKey;
  replacement.dataset.cardMini = String(mini);
  replacement.dataset.cardAnimated = String(animatedLayers);
  current.replaceWith(replacement);
  return replacement;
}

/**
 * Swaps every card already on screen to the active source.
 *
 * Only the visuals built by `createCardVisual()` carry `data-card-visual`; an element the game
 * never tagged (the profile card, a card back, an icon) is deliberately left alone.
 *
 * @returns {void}
 */
export function repaintCardVisuals() {
  const selector = state.generate
    ? 'img[data-card-visual]'
    : 'card-print[data-card-visual]';
  document.querySelectorAll(selector).forEach((element) => {
    const card = cardRegistry.get(element.dataset.cardVisual);
    if (!card) return;
    const alt = element.hasAttribute('aria-hidden')
      ? ''
      : element.getAttribute('aria-label') ?? element.getAttribute('alt') ?? '';
    replaceCardVisual(element, card, {
      alt,
      mini: element.dataset.cardMini === 'true',
      animatedLayers: element.dataset.cardAnimated === 'true',
    });
  });
}

/**
 * Refreshes the language of every card already drawn.
 *
 * @returns {void}
 */
export function refreshCardVisuals() {
  document.querySelectorAll('card-print[data-card-visual]').forEach((element) => element.refresh());
  document.querySelectorAll('img[data-card-visual]').forEach((image) => {
    const card = cardRegistry.get(image.dataset.cardVisual);
    if (card) image.src = i18n.resolveImagePath(card.illustration);
  });
}

/**
 * Applies the stored preferences and repaints the visible cards when the source changes.
 *
 * @param {object} settings - Account settings (or the relevant fields alone).
 * @param {boolean} [settings.devMode] - Developer mode.
 * @param {boolean} [settings.advancedDevMode] - Authorized advanced developer mode.
 * @param {string} [settings.cardSource] - `image` or `generate`.
 * @param {boolean} [settings.animatedLayers] - Animate the generated card layers.
 * @param {number} [settings.animatedLayersSpeed] - Speed in percent of the reference cycle.
 * @returns {boolean} True when the effective source is now `generate`.
 */
export function applyCardSourceSettings({
  devMode = false,
  advancedDevMode = false,
  cardSource = DEFAULT_CARD_SOURCE,
  animatedLayers = state.animatedLayers,
  animatedLayersSpeed = state.animatedLayersSpeed,
} = {}) {
  listen();
  const previous = state.generate;
  state.devMode = devMode === true;
  state.advancedDevMode = advancedDevMode === true;
  state.cardSource = normalizeCardSource(cardSource);
  state.animatedLayers = animatedLayers === true;
  const requestedSpeed = Number(animatedLayersSpeed);
  state.animatedLayersSpeed =
    Number.isFinite(requestedSpeed) && requestedSpeed > 0
      ? requestedSpeed
      : DEFAULT_ANIMATED_LAYERS_SPEED;
  state.generate =
    state.devMode && state.advancedDevMode && state.cardSource === CARD_SOURCE.GENERATE;

  document.documentElement.dataset.cardSource = state.generate
    ? CARD_SOURCE.GENERATE
    : CARD_SOURCE.IMAGE;
  document.documentElement.dataset.animatedLayers = state.animatedLayers ? 'true' : 'false';
  document.documentElement.style.setProperty(
    '--animated-layers-duration',
    `${resolveAnimatedLayersDuration(state.animatedLayersSpeed)}s`
  );

  document.querySelectorAll('card-print[data-card-visual]').forEach((element) => {
    element.setAnimatedLayers(state.animatedLayers);
  });

  if (previous !== state.generate) {
    repaintCardVisuals();
    document.dispatchEvent(
      new CustomEvent(CARD_SOURCE_CHANGED_EVENT, {
        detail: { generate: state.generate, cardSource: state.cardSource },
      })
    );
  }
  return state.generate;
}

/** Shared instance, so every caller reads the same effective source. */
export const cardSourceManager = {
  CARD_SOURCE,
  applySettings: applyCardSourceSettings,
  createVisual: createCardVisual,
  updateVisual: updateCardVisual,
  replaceVisual: replaceCardVisual,
  repaint: repaintCardVisuals,
  refresh: refreshCardVisuals,
  isGenerateEnabled,
  isAnimatedLayersActive,
  getCardSource,
  normalize: normalizeCardSource,
  resolveAnimatedLayersDuration,
};

export default cardSourceManager;

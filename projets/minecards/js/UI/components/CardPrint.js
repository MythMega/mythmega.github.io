/**
 * CardPrint - One card rebuilt from its JSON data instead of its final image.
 *
 * Reference: `external/cardmakerz/cards.html` (the structure),
 * `css/components/profile-card.css` (the palette and the two layouts, copied from the card
 * maker) and `css/components/generated-card.css` (the rules that make that card fill the box of
 * an ordinary illustration and hide its texts at thumbnail size).
 *
 * WHY A CUSTOM ELEMENT
 *   Every screen of the game already reserves a fixed box for a card `<img>` (`.collection__image`,
 *   `.card-modal__image`, `.card-reveal__image`, ...). A `<card-print>` with the same class takes
 *   that box instead of duplicating the layout of ten views. Its shadow root keeps the card maker's
 *   `.card-*` rules away from the game's stylesheets, exactly like `ProfileCard`.
 *
 * ONE CONSTRUCTION
 *   Every generated card is built the same way, whatever the box it fills: the name, the artwork
 *   and the description keep their bands and their blurred backdrop from a 56px thumbnail to the
 *   large card of a detail. The only adaptation is the SIZE - below 4.5rem the series and the
 *   rarity symbol are hidden, the two lines that fit nowhere down there - and it lives in the
 *   stylesheet, next to the lines it silences.
 *
 * THE FOIL
 *   The card carries the two foil layers of the card maker and one brilliance line. They read
 *   `--foil-intensity` and `--glare-intensity`, published on `<html>` by `FoilManager`, so moving
 *   either slider changes every visible generated card without rebuilding it.
 */

import cardLanguage from '../../utils/CardLanguage.js';
import { getRarityAppearance } from '../../utils/CardGenerateManager.js';

/** Base class that also lets a Node test import this module without a DOM. */
const HTMLElementBase = globalThis.HTMLElement ?? class {};

/** The card maker's CSS classes, indexed like `Card.rarity`; the symbols come from `cardGenerate`. */
const RARITIES = Object.freeze({
  1: Object.freeze({ className: 'rarity-common' }),
  2: Object.freeze({ className: 'rarity-rare' }),
  3: Object.freeze({ className: 'rarity-super-rare' }),
  4: Object.freeze({ className: 'rarity-legendary' }),
  5: Object.freeze({ className: 'rarity-mythic' }),
  6: Object.freeze({ className: 'rarity-unique' }),
});

/** Number of sentences printed on a Full Art card, like the card maker's export. */
const FULL_ART_MAX_SENTENCES = 2;

/** Stylesheets injected into the shadow root, in cascade order. */
const STYLESHEETS = Object.freeze([
  'css/components/profile-card.css',
  'css/components/generated-card.css?v=f8b0c12d15',
]);

/**
 * Project root, resolved from this module rather than from the page.
 *
 * The game serves this component from the application root, but the admin browser opens from
 * `/admin/`; `document.baseURI` would then resolve the two stylesheets under `/admin/css/` and the
 * generated card would render unstyled. Every consumer imports this same module URL, so climbing
 * its three directories always lands on the project root.
 */
const MODULE_ROOT = new URL('../../../', import.meta.url);

/**
 * Wraps a path in a CSS `url()`, escaping what would end the string early.
 *
 * @param {string} path - Image path or URL.
 * @returns {string} The CSS value.
 */
function cssUrl(path) {
  return `url("${String(path).replace(/["\\]/g, '\\$&')}")`;
}

/**
 * Keeps the first sentences of a description.
 *
 * Mirrors `CardItem.limitSentences()` of the card maker: the Full Art export keeps two sentences,
 * and the generated card has to show the same text as the image it replaces.
 *
 * @param {string} text - Full description.
 * @param {number} maxSentences - Number of sentences to keep.
 * @returns {string} The shortened text.
 */
export function limitSentences(text, maxSentences) {
  const value = String(text ?? '').trim();
  if (value === '' || maxSentences < 1) return value;

  const enders = '.!?…';
  const closers = '"\'()]»’';
  let sentences = 0;

  for (let index = 0; index < value.length; index += 1) {
    if (!enders.includes(value[index])) continue;
    let end = index;
    while (
      end + 1 < value.length &&
      (enders.includes(value[end + 1]) || closers.includes(value[end + 1]))
    ) {
      end += 1;
    }
    sentences += 1;
    if (sentences >= maxSentences) return value.slice(0, end + 1).trim();
    index = end;
  }

  return value;
}

export class CardPrint extends HTMLElementBase {
  constructor() {
    super();

    /** @type {object|null} Card currently drawn. */
    this.card = null;
    /** @type {string} Language of the texts. */
    this.lang = cardLanguage.getLang();
    /** @type {{color: string, accent: string, symbol: string, symbolColor: string}|null}
     *   Rarity appearance overriding the account design (the settings preview uses it). */
    this.appearance = null;

    if (typeof this.attachShadow !== 'function') return;

    this.root = this.attachShadow({ mode: 'open' });
    this.build();
  }

  /**
   * Injects the two stylesheets and builds the card maker's structure once.
   *
   * @returns {void}
   */
  build() {
    STYLESHEETS.forEach((path) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = new URL(path, MODULE_ROOT).href;
      this.root.appendChild(link);
    });

    const wrapper = document.createElement('div');
    wrapper.className = 'profile-card-root font-pixel';

    const card = document.createElement('div');
    card.className = 'card-preview card-layout-classic rarity-common font-pixel';

    const inner = document.createElement('div');
    inner.className = 'card-inner';

    this.artElement = document.createElement('div');
    this.artElement.className = 'card-art';
    this.foilBackgroundElement = document.createElement('div');
    this.foilBackgroundElement.className = 'card-foil-bg';
    this.underlayElement = document.createElement('div');
    this.underlayElement.className = 'card-underlay';
    this.foilUnderlayElement = document.createElement('div');
    this.foilUnderlayElement.className = 'card-foil-underlay';
    this.glareElement = document.createElement('div');
    this.glareElement.className = 'card-glare';

    const header = document.createElement('div');
    header.className = 'card-header';
    const titleContainer = document.createElement('div');
    titleContainer.className = 'card-title-container';
    this.titleElement = document.createElement('span');
    this.titleElement.className = 'card-title';
    this.seriesElement = document.createElement('span');
    this.seriesElement.className = 'card-series';
    titleContainer.append(this.titleElement, this.seriesElement);
    this.rarityElement = document.createElement('span');
    this.rarityElement.className = 'card-rarity';
    header.append(titleContainer, this.rarityElement);

    const body = document.createElement('div');
    body.className = 'card-body';
    const text = document.createElement('p');
    text.className = 'card-text';
    this.textElement = text;
    body.appendChild(text);

    inner.append(
      this.artElement,
      this.foilBackgroundElement,
      this.underlayElement,
      this.foilUnderlayElement,
      this.glareElement,
      header,
      body
    );
    card.appendChild(inner);
    wrapper.appendChild(card);
    this.root.appendChild(wrapper);

    this.wrapperElement = wrapper;
    this.cardElement = card;
  }

  /**
   * Gives the element its card and display options.
   *
   * @param {object|null} card - Card to draw.
   * @param {object} [options] - Display options.
   * @param {string} [options.lang] - Language of the texts.
   * @param {{color: string, accent: string, symbol: string, symbolColor: string}} [options.appearance]
   *   Rarity appearance to use instead of the account design (a preview of another mode).
   * @returns {CardPrint} This element, for chaining.
   */
  setCard(card, { lang = null, appearance = null } = {}) {
    this.card = card;
    this.appearance = appearance && typeof appearance === 'object' ? appearance : null;
    this.lang = typeof lang === 'string' && lang !== '' ? lang : cardLanguage.getLang();
    this.setAttribute('lang', this.lang);
    this.render();
    return this;
  }

  /**
   * Starts or stops the optional movement of the background and underlay layers.
   *
   * The attribute is what the shadow stylesheet reads, so turning the preference off restores the
   * static card immediately, without rebuilding it or losing its scroll position.
   *
   * @param {boolean} enabled - Whether the generated layers may move.
   * @returns {CardPrint} This element, for chaining.
   */
  setAnimatedLayers(enabled) {
    this.toggleAttribute('animated-layers', enabled === true);
    return this;
  }

  /**
   * Marks this printing as a place where the layers may move (a detail popup or a booster reveal).
   *
   * The preference alone is not enough: the collection grid and the Mine Pick history are lists,
   * and a grid of moving cards is both noisy and expensive. The shadow stylesheet only animates a
   * card carrying BOTH attributes.
   *
   * @param {boolean} enabled - Whether this particular printing is allowed to animate.
   * @returns {CardPrint} This element, for chaining.
   */
  setAnimatedLayersView(enabled) {
    this.toggleAttribute('animated-layers-view', enabled === true);
    return this;
  }

  /**
   * Silences the generated glare and the layer movement for the "Effets" switch.
   *
   * The foil is deliberately left alone: the switch turns off the ambient effects of the detail,
   * not the printing the player owns.
   *
   * @param {boolean} enabled - False when the card effects are switched off.
   * @returns {CardPrint} This element, for chaining.
   */
  setEffectsEnabled(enabled) {
    this.toggleAttribute('effects-off', enabled === false);
    return this;
  }

  /**
   * Re-reads the card in the current language, without rebuilding the element.
   *
   * @returns {void}
   */
  refresh() {
    this.lang = cardLanguage.getLang();
    this.setAttribute('lang', this.lang);
    this.render();
  }

  /**
   * Writes every visible field of the card.
   *
   * @returns {void}
   */
  render() {
    if (!this.root) return;
    const card = this.card;
    if (!card) {
      this.root.querySelectorAll('[style]').forEach((element) => element.removeAttribute('style'));
      this.titleElement.textContent = '';
      this.seriesElement.textContent = '';
      this.rarityElement.textContent = '';
      this.rarityElement.style.removeProperty('color');
      this.textElement.textContent = '';
      return;
    }

    const rarity = RARITIES[card.rarity] ?? RARITIES[1];
    const appearance = this.appearance ?? getRarityAppearance(card.rarity);
    const name = card.getName(this.lang);
    const isFullArt = card.style === 'fullart';

    this.cardElement.classList.remove(...Object.values(RARITIES).map((entry) => entry.className));
    this.cardElement.classList.add(rarity.className);
    this.cardElement.classList.toggle('card-layout-classic', !isFullArt);
    this.cardElement.classList.toggle('card-layout-fullart', isFullArt);

    this.titleElement.textContent = name;
    this.titleElement.title = name;
    this.seriesElement.textContent = card.index || card.id || '';
    // The symbol and its colour belong to the rarity construction of `cardGenerate`: changing the
    // symbol in the settings screen re-renders the card, while the frame colours follow through
    // the custom properties published by `CardGenerateManager`.
    this.rarityElement.textContent = appearance.symbol;
    this.rarityElement.style.color = appearance.symbolColor;

    const description = card.getDescription(this.lang);
    this.textElement.textContent = isFullArt
      ? limitSentences(description, FULL_ART_MAX_SENTENCES)
      : description;
    this.textElement.hidden = description === '';

    const background = typeof card.background === 'string' ? card.background : '';
    this.artElement.style.backgroundImage = background === '' ? 'none' : cssUrl(background);
    // The card maker paints the description panel of the classic layout with a heavily blurred
    // copy of the same background. The variable is what `profile-card.css` reads; without it the
    // panel fell back to its opaque black and the artwork did not tint it at all.
    if (background === '') {
      this.cardElement.style.removeProperty('--card-background-image');
    } else {
      this.cardElement.style.setProperty('--card-background-image', cssUrl(background));
    }

    const underlay = typeof card.underlay === 'string' ? card.underlay : '';
    this.underlayElement.style.backgroundImage = underlay === '' ? 'none' : cssUrl(underlay);
    this.underlayElement.hidden = underlay === '';

    if (!this.hasAttribute('aria-hidden')) {
      this.setAttribute('aria-label', name);
    }
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('card-print')) {
  customElements.define('card-print', CardPrint);
}

export default CardPrint;

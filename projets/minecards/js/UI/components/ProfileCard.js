/**
 * ProfileCard - The player's own trading card, drawn like the one the card maker produces.
 *
 * Reference: `js/business/ProfileCardManager.js` (the facts), `css/components/profile-card.css`
 * (the card, adapted from `external/cardmakerz/`), `js/utils/I18n.js` (labels and localized
 * illustrations) and `js/business/TitleManager.js` (the title printed in the series line).
 *
 * WHY A SHADOW ROOT
 *   The card is a faithful copy of a tool with its own CSS (`clip-path` frames, `mix-blend-mode`
 *   foils, conic gradients, rarity variables). Those rules would leak into the game (they style
 *   `.card-*`, `.rarity-*`) and the game's own rules would leak in (`*.card` shorthands, themes,
 *   animations). A shadow root keeps both sides apart, which is also what makes the export
 *   predictable: the card is styled by ONE stylesheet, the same in the page and in the PNG.
 *
 * WHY THE EXPORT REIMPLEMENTS THE CARD MAKER'S RASTERIZER
 *   `html2canvas` cannot paint `clip-path`, `mix-blend-mode` or `conic-gradient`, which is exactly
 *   what a card is made of, so the card maker rasterizes through the browser itself: the DOM is
 *   serialized into an SVG `foreignObject`, loaded as an image, then drawn in a canvas. The same
 *   technique is used here, with two game-specific twists:
 *     - the stylesheet is FETCHED and inlined, because an SVG loaded as an image can reach no
 *       external resource;
 *     - the two illustrations and the `@font-face` files are turned into data URLs for the same
 *       reason. The pixel face is the only family the game ships (`css/fonts.css`), so embedding it
 *       is what keeps the PNG identical to the preview.
 */

import i18n from '../../utils/I18n.js';
import titleManager, { TitleManager } from '../../business/TitleManager.js';
import { resolveTrophyIcon } from '../../business/TrophyManager.js';
import TrophyDetail from './TrophyDetail.js';

/** Layouts of the card, in the order the switch offers them. */
export const PROFILE_CARD_LAYOUTS = Object.freeze({
  CLASSIC: 'classic',
  FULL_ART: 'fullart',
});

/** Layouts in display order (`classic` is the card maker's "Normal"). */
export const PROFILE_CARD_LAYOUT_ORDER = Object.freeze([
  PROFILE_CARD_LAYOUTS.CLASSIC,
  PROFILE_CARD_LAYOUTS.FULL_ART,
]);

/** Default layout: the one the switch starts on. */
export const PROFILE_CARD_DEFAULT_LAYOUT = PROFILE_CARD_LAYOUTS.CLASSIC;

/** Size of the card in its own coordinate system (the card maker's canvas). */
export const PROFILE_CARD_WIDTH = 360;
export const PROFILE_CARD_HEIGHT = 500;

/** Resolution multiplier of the exported PNG. */
export const PROFILE_CARD_EXPORT_SCALE = 2;

/** Stylesheet of the card, fetched once and inlined in the exported image. */
export const PROFILE_CARD_STYLESHEET = 'css/components/profile-card.css';

/** Stylesheet holding the `@font-face` rules of the game, inlined in the export as well. */
export const PROFILE_CARD_FONT_STYLESHEET = 'css/fonts.css';

/** Smallest scale the card accepts before the stage stops shrinking it. */
const MIN_SCALE = 0.35;

/**
 * Media type of the assets embedded in the exported image, by file extension.
 *
 * A `Blob` served without a type (Python's `http.server` answers `application/octet-stream`) would
 * produce a data URL the SVG-image context refuses to use as a font, so the type is derived from
 * the path instead of trusted from the response.
 */
const EMBEDDED_MIME_TYPES = Object.freeze({
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
});

/** How long the export waits for an image before giving up on it. */
const IMAGE_TIMEOUT = 20000;

/**
 * Card rarities, mirroring `external/cardmakerz/js/bulk/RarityDef.js` (1 = Commune … 5 = Mythique).
 *
 * The card maker is a classic script (`class RarityDef`), not a module: it cannot be imported, so
 * the three fields the card actually needs (symbol, CSS class, translation key) are copied here.
 */
export const PROFILE_CARD_RARITIES = Object.freeze({
  1: Object.freeze({ symbol: '★', className: 'rarity-common', labelKey: 'rarity.1' }),
  2: Object.freeze({ symbol: '★★', className: 'rarity-rare', labelKey: 'rarity.2' }),
  3: Object.freeze({ symbol: '★★★', className: 'rarity-super-rare', labelKey: 'rarity.3' }),
  4: Object.freeze({ symbol: '✦', className: 'rarity-legendary', labelKey: 'rarity.4' }),
  5: Object.freeze({ symbol: '💎', className: 'rarity-mythic', labelKey: 'rarity.5' }),
});

export class ProfileCard {
  /**
   * @param {HTMLElement} host - Element the card is attached to (the shadow host).
   * @param {object} [options] - Component options.
   * @param {(layout: string) => void} [options.onLayoutChange] - Called when `setLayout()` changes
   *   the layout (the view keeps the switch buttons in sync).
   */
  constructor(host, { onLayoutChange = null } = {}) {
    if (!host || typeof host.attachShadow !== 'function') {
      throw new TypeError('ProfileCard requires an element able to host a shadow root.');
    }

    this.host = host;
    this.onLayoutChange = typeof onLayoutChange === 'function' ? onLayoutChange : null;
    this.root = host.attachShadow({ mode: 'open' });

    /** @type {object|null} Last model received by `render()`. */
    this.model = null;
    /** @type {string} Active layout. */
    this.layout = PROFILE_CARD_DEFAULT_LAYOUT;
    /** @type {string} Card stylesheet text, fetched once. */
    this.stylesheet = '';
    /** @type {string} `@font-face` rules with the font files embedded, fetched once. */
    this.fontStylesheet = '';
    /** @type {ResizeObserver|null} Keeps the card fitted to the panel width. */
    this.resizeObserver = null;

    /** @type {HTMLStyleElement|null} Stylesheet of the card, injected into the shadow root. */
    this.styleElement = null;

    this.buildSkeleton();
    this.observeSize();
    // The stylesheet is FETCHED and injected (never a `<link>` in the shadow root): the very same
    // text is then inlined in the exported image, so the PNG cannot drift from the preview.
    void this.applyStyles();
  }

  /**
   * Fetches the card stylesheet and injects it into the shadow root.
   *
   * @returns {Promise<boolean>} True once the stylesheet is in place.
   */
  async applyStyles() {
    if (this.styleElement) return true;
    const css = await this.loadStylesheet();
    if (css === '') {
      console.warn('[ProfileCard] The card is displayed without its stylesheet.');
      return false;
    }
    this.styleElement = document.createElement('style');
    this.styleElement.textContent = css;
    this.root.prepend(this.styleElement);
    return true;
  }

  /**
   * Logs with the component prefix.
   *
   * @param {...unknown} args - Values forwarded to `console.info`.
   * @returns {void}
   */
  log(...args) {
    console.info('[ProfileCard]', ...args);
  }

  /**
   * Creates the card markup once: `render()` only ever fills the text and the layers.
   *
   * The structure is the card maker's (`cards.html` / `CardRenderer.setupCard`): the illustration,
   * the foil over it, the avatar underlay, its own foil, then the name band and the text block.
   *
   * @returns {void}
   */
  buildSkeleton() {
    const container = document.createElement('div');
    container.className = 'profile-card-root font-pixel';

    const card = document.createElement('div');
    card.className = 'card-preview card-layout-classic rarity-common font-pixel';

    const inner = document.createElement('div');
    inner.className = 'card-inner';

    const layers = ['card-art', 'card-foil-bg', 'card-underlay', 'card-foil-underlay'];
    this.layerElements = {};
    layers.forEach((name) => {
      const layer = document.createElement('div');
      layer.className = name;
      this.layerElements[name] = layer;
      inner.appendChild(layer);
    });

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
    this.featuredElement = document.createElement('span');
    this.featuredElement.className = 'card-text__featured';
    this.statsElement = document.createElement('span');
    this.statsElement.className = 'card-text__stats';
    const text = document.createElement('p');
    text.className = 'card-text';
    text.append(this.featuredElement, this.statsElement);
    body.appendChild(text);

    inner.append(header, body);
    card.appendChild(inner);
    container.appendChild(card);

    this.root.textContent = '';
    this.root.appendChild(container);
    this.rootElement = container;
    this.cardElement = card;

    // The card is a picture of the account: a screen reader gets the same facts from the text.
    this.host.setAttribute('role', 'img');
    this.applyStage();
  }

  /**
   * Wraps one path in a CSS `url()`, escaping what would end the string early.
   *
   * @param {string} path - Image path.
   * @returns {string} The CSS value.
   */
  static cssUrl(path) {
    return `url("${String(path).replace(/["\\]/g, '\\$&')}")`;
  }

  /**
   * Keeps the card fitted to the width of its container.
   *
   * The card is authored at its real pixel size and scaled as a whole, which is the only way to
   * keep every `calc()` of the stylesheet (the 10 % / 50 % bands of the normal layout) exact.
   *
   * @returns {void}
   */
  observeSize() {
    const parent = this.host.parentElement;
    if (!parent || typeof ResizeObserver !== 'function') {
      this.applyStage();
      return;
    }
    this.resizeObserver = new ResizeObserver(() => this.applyStage());
    this.resizeObserver.observe(parent);
  }

  /**
   * Computes and applies the scale of the card, then the matching stage height.
   *
   * @returns {void}
   */
  applyStage() {
    const parent = this.host.parentElement;
    const available = parent ? parent.clientWidth : 0;
    const scale = available > 0
      ? Math.min(1, Math.max(MIN_SCALE, available / PROFILE_CARD_WIDTH))
      : 1;
    this.host.style.setProperty('--profile-card-scale', String(scale));
    // A transformed element keeps its layout height: the stage takes the SCALED one instead, so the
    // panel leaves no dead space under the card.
    this.host.style.height = `${Math.ceil(PROFILE_CARD_HEIGHT * scale)}px`;
  }

  /**
   * Applies one layout (`classic` = "Normal", `fullart` = "Full Art").
   *
   * @param {string} layout - One of `PROFILE_CARD_LAYOUTS`.
   * @returns {string} The layout actually applied (an unknown value falls back to the default).
   */
  setLayout(layout) {
    const known = Object.values(PROFILE_CARD_LAYOUTS).includes(layout);
    this.layout = known ? layout : PROFILE_CARD_DEFAULT_LAYOUT;
    this.cardElement.classList.toggle(
      'card-layout-classic',
      this.layout === PROFILE_CARD_LAYOUTS.CLASSIC
    );
    this.cardElement.classList.toggle(
      'card-layout-fullart',
      this.layout === PROFILE_CARD_LAYOUTS.FULL_ART
    );
    this.log(`Layout: ${this.layout}.`);
    this.onLayoutChange?.(this.layout);
    return this.layout;
  }

  /**
   * Reads the worn title as a sentence.
   *
   * @param {string} id - Title id stored in the profile.
   * @returns {Promise<string>} The title text, or an empty string when there is none (or when the
   *   catalogue no longer knows it).
   */
  async resolveTitle(id) {
    if (typeof id !== 'string' || id === '') return '';
    try {
      const title = await titleManager.getTitle(id);
      return title ? TitleManager.titleText(title, i18n.getLang()) : '';
    } catch (error) {
      console.warn(`[ProfileCard] The title "${id}" could not be read.`, error);
      return '';
    }
  }

  /**
   * Fills the card from a model built by `ProfileCardManager`.
   *
   * @param {object} model - The card facts.
   * @returns {Promise<void>} Resolves once the card is displayed.
   */
  async render(model) {
    if (!model || typeof model !== 'object') return;
    await this.applyStyles();
    this.model = model;
    const name = typeof model.name === 'string' && model.name !== ''
      ? model.name
      : i18n.t('profile.anonymous');

    // The series line is "<title> #<number>": the title is the one worn under the pseudo, so a card
    // always looks like the profile page it comes from.
    const titleText = await this.resolveTitle(model.titleId);
    const seriesTitle = titleText !== '' ? titleText : i18n.t('profile.card.series.none');
    const number = typeof model.seriesNumber === 'string' ? model.seriesNumber : '';
    this.seriesElement.textContent = number !== '' ? `${seriesTitle} #${number}` : seriesTitle;
    this.titleElement.textContent = name;
    this.titleElement.title = name;

    const rarity = PROFILE_CARD_RARITIES[model.rarity] ?? PROFILE_CARD_RARITIES[1];
    this.cardElement.classList.remove(...Object.values(PROFILE_CARD_RARITIES).map((r) => r.className));
    this.cardElement.classList.add(rarity.className);
    this.rarityElement.textContent = rarity.symbol;
    this.rarityElement.title = i18n.t(rarity.labelKey);

    this.renderTitleColor(model);
    this.renderNameColor(model);
    this.renderLayers(model);
    this.renderText(model);

    this.host.setAttribute(
      'aria-label',
      i18n.t('profile.card.aria', { name, series: this.seriesElement.textContent })
    );
    this.log(`Card rendered for "${name}" (rarity ${model.rarity}).`);
  }

  /**
   * Paints the title line in the colour the player chose.
   *
   * The value is applied INLINE on the card element rather than through the stylesheet: the export
   * builds a standalone document that inherits none of the page variables, and an inline property
   * survives the serialization untouched. `auto` (and any colour the account does not own, already
   * filtered by `ProfileCardManager`) leaves the property out, so the rarity colour of the
   * stylesheet shows through.
   *
   * @param {object} model - The card facts.
   * @returns {void}
   */
  renderTitleColor(model) {
    const value = typeof model.titleColorValue === 'string' ? model.titleColorValue : '';
    if (value === '') {
      this.cardElement.style.removeProperty('--card-title-color');
      return;
    }
    this.cardElement.style.setProperty('--card-title-color', value);
  }

  /**
   * Paints the pseudo with the colour the account bought, if any.
   *
   * Like the series line, the property travels into the exported PNG: no page variable exists in
   * the standalone document, so an inline value is what survives the serialization. Without a
   * colour the stylesheet's rarity text colour shows through.
   *
   * @param {object} model - The card facts.
   * @returns {void}
   */
  renderNameColor(model) {
    const value = typeof model.nameColorValue === 'string' ? model.nameColorValue : '';
    if (value === '') {
      this.cardElement.style.removeProperty('--card-name-color');
      return;
    }
    this.cardElement.style.setProperty('--card-name-color', value);
  }

  /**
   * Paints the illustration and the avatar.
   *
   * A path is resolved through `I18n` (an illustration may still carry the `<lang>` placeholder) and
   * never blocks the render: a missing file simply leaves the layer empty.
   *
   * @param {object} model - The card facts.
   * @returns {void}
   */
  renderLayers(model) {
    const background = typeof model.background === 'string' && model.background !== ''
      ? i18n.resolveImagePath(model.background)
      : '';
    const underlay = typeof model.underlay === 'string' && model.underlay !== ''
      ? i18n.resolveImagePath(model.underlay)
      : '';

    this.layerElements['card-art'].style.backgroundImage = background
      ? ProfileCard.cssUrl(background)
      : 'none';
    this.cardElement.style.setProperty(
      '--card-background-image',
      background ? ProfileCard.cssUrl(background) : 'none'
    );

    this.layerElements['card-underlay'].style.backgroundImage = underlay
      ? ProfileCard.cssUrl(underlay)
      : 'none';
    this.layerElements['card-underlay'].hidden = underlay === '';
    this.host.dataset.hasUnderlay = String(underlay !== '');
  }

  /**
   * Writes the description: the pinned trophies as medals on one line, then the counters.
   *
   * The medals are IMAGES, not names: three names on a 360 pixel card would be three ellipsised
   * lines, while the three medals are exactly what the Trophies page shows and what the player
   * recognises. The names stay as the tooltip (and behind the accessible label of the card).
   *
   * @param {object} model - The card facts.
   * @returns {void}
   */
  renderText(model) {
    const featured = Array.isArray(model.featuredTrophies) ? model.featuredTrophies : [];
    const names = featured.map((trophy) => TrophyDetail.trophyTitle(trophy));

    this.featuredElement.textContent = '';
    featured.forEach((trophy) => {
      const medal = document.createElement('img');
      medal.className = 'card-text__medal';
      // The rarity stays on the medal as data, even though the card paints no halo: a profile could
      // one day style its trophies by rarity without rebuilding the component.
      if (typeof trophy.rarity === 'string' && trophy.rarity !== '') {
        medal.dataset.rarity = trophy.rarity;
      }
      medal.src = i18n.resolveImagePath(resolveTrophyIcon(trophy.icon));
      medal.alt = '';
      medal.decoding = 'async';
      medal.setAttribute('aria-hidden', 'true');
      medal.addEventListener('error', () => {
        console.warn(`[ProfileCard] Trophy medal not found: ${medal.src}`);
        medal.remove();
      });
      this.featuredElement.appendChild(medal);
    });
    this.featuredElement.hidden = featured.length === 0;
    this.featuredElement.title = names.join(' · ');

    const lines = [
      i18n.t('profile.card.stats.boosters', { count: model.boostersOpened ?? 0 }),
      i18n.t('profile.card.stats.cards', { count: model.distinctCards ?? 0 }),
      model.firstObtainedAt
        ? i18n.t('profile.card.stats.first', { date: TrophyDetail.formatDate(model.firstObtainedAt) })
        : i18n.t('profile.card.stats.none'),
      i18n.t('profile.card.stats.sparks', { count: model.sparks ?? 0 }),
      i18n.t('profile.card.stats.blocks', { count: model.blocksMined ?? 0 }),
      i18n.t('profile.card.stats.picks', { count: model.picksMade ?? 0 }),
    ];
    this.statsElement.textContent = '';
    lines.forEach((line) => {
      const span = document.createElement('span');
      span.textContent = line;
      this.statsElement.appendChild(span);
    });
  }

  /**
   * Fetches the card stylesheet once.
   *
   * @returns {Promise<string>} The stylesheet text (empty when it cannot be read).
   */
  async loadStylesheet() {
    if (this.stylesheet !== '') return this.stylesheet;
    this.stylesheet = await ProfileCard.fetchText(PROFILE_CARD_STYLESHEET);
    return this.stylesheet;
  }

  /**
   * Fetches `css/fonts.css` and embeds its font files as data URLs.
   *
   * An SVG loaded as an image cannot download a font: without this the exported card would fall
   * back to a system monospace and no longer match the preview.
   *
   * @returns {Promise<string>} The `@font-face` rules, fonts embedded.
   */
  async loadFontStylesheet() {
    if (this.fontStylesheet !== '') return this.fontStylesheet;
    const css = await ProfileCard.fetchText(PROFILE_CARD_FONT_STYLESHEET);
    if (css === '') return '';

    const pattern = /url\(['"]?([^'")]+)['"]?\)/g;
    const paths = [];
    let match = pattern.exec(css);
    while (match !== null) {
      paths.push(match[1]);
      match = pattern.exec(css);
    }

    let output = css;
    for (const path of new Set(paths)) {
      const embedded = await ProfileCard.readDataUrl(path, PROFILE_CARD_FONT_STYLESHEET);
      if (embedded !== '') output = output.split(path).join(embedded);
    }
    this.fontStylesheet = output;
    return output;
  }

  /**
   * Reads a file as a `data:` URL.
   *
   * @param {string} path - Path of the file, relative to the document.
   * @param {string} [from=''] - Path of the file the reference was found in (`css/fonts.css`), used
   *   to resolve a relative `url('../assets/...')`.
   * @returns {Promise<string>} The data URL, or an empty string when the file cannot be read.
   */
  static async readDataUrl(path, from = '') {
    if (typeof path !== 'string' || path === '') return '';
    try {
      const base = new URL(document.baseURI);
      const url = new URL(path, from !== '' ? new URL(from, base) : base);
      const response = await fetch(url);
      if (!response.ok) {
        console.warn(`[ProfileCard] Asset not found (HTTP ${response.status}): ${url.pathname}`);
        return '';
      }
      const blob = await response.blob();
      return ProfileCard.blobToDataUrl(blob, ProfileCard.mimeType(path, blob.type));
    } catch (error) {
      console.warn(`[ProfileCard] Asset could not be read: ${path}`, error);
      return '';
    }
  }

  /**
   * Resolves the media type of an embedded asset from its path.
   *
   * @param {string} path - Path of the asset.
   * @param {string} [fallback='application/octet-stream'] - Type used for an unknown extension.
   * @returns {string} The media type.
   */
  static mimeType(path, fallback = 'application/octet-stream') {
    const clean = String(path).split('?')[0].split('#')[0].toLowerCase();
    const dot = clean.lastIndexOf('.');
    const extension = dot === -1 ? '' : clean.slice(dot);
    return EMBEDDED_MIME_TYPES[extension] ?? (fallback || 'application/octet-stream');
  }

  /**
   * Encodes a blob as a base64 `data:` URL of a given media type.
   *
   * @param {Blob} blob - Content to embed.
   * @param {string} mime - Media type written in the URL.
   * @returns {Promise<string>} The data URL (empty when the blob cannot be encoded).
   */
  static async blobToDataUrl(blob, mime) {
    try {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      // Chunked: a single `String.fromCharCode(...bytes)` overflows the argument list on the
      // illustrations, which are far larger than the font files.
      let binary = '';
      const chunk = 0x8000;
      for (let index = 0; index < bytes.length; index += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunk));
      }
      return `data:${mime};base64,${btoa(binary)}`;
    } catch (error) {
      console.warn('[ProfileCard] Asset could not be encoded.', error);
      return '';
    }
  }

  /**
   * Fetches a text asset of the game.
   *
   * @param {string} path - Path relative to the document.
   * @returns {Promise<string>} The text, or an empty string when it cannot be read.
   */
  static async fetchText(path) {
    try {
      const response = await fetch(path);
      if (!response.ok) {
        console.warn(`[ProfileCard] Stylesheet not found (HTTP ${response.status}): ${path}`);
        return '';
      }
      return await response.text();
    } catch (error) {
      console.warn(`[ProfileCard] Stylesheet could not be read: ${path}`, error);
      return '';
    }
  }

  /**
   * Builds the CSS injected in the exported image.
   *
   * @param {string} stylesheet - Card stylesheet text.
   * @param {string} fonts - `@font-face` rules.
   * @returns {string} The complete CSS of the isolated document.
   */
  static buildExportStyle(stylesheet, fonts) {
    return [
      fonts,
      stylesheet,
      /* The fragment is not the page: no margin, no inherited theme, no animation. */
      '.xport-root{display:block;margin:0;padding:0;border:0;background:transparent;' +
        'position:relative;color:#fff;font-family:monospace;}',
      '.xport-root *{animation:none !important;transition:none !important;}',
    ].join('\n');
  }

  /**
   * Rasterizes the card into a PNG.
   *
   * @returns {Promise<Blob>} The image.
   * @throws {Error} When the card cannot be drawn (stylesheets unreadable, browser refusing the
   *   `foreignObject` rasterization, canvas too large).
   */
  async toBlob() {
    const [stylesheet, fonts] = await Promise.all([
      this.loadStylesheet(),
      this.loadFontStylesheet(),
    ]);
    if (stylesheet === '') throw new Error('The profile card stylesheet could not be read.');
    if (document.fonts?.ready) {
      try {
        await document.fonts.ready;
      } catch (error) {
        console.warn('[ProfileCard] The fonts did not settle before the export.', error);
      }
    }

    const url = await this.buildImageUrl(stylesheet, fonts);
    const image = await ProfileCard.loadImage(url);
    if (!image) throw new Error('The browser refused to rasterize the card.');

    const canvas = document.createElement('canvas');
    canvas.width = PROFILE_CARD_WIDTH * PROFILE_CARD_EXPORT_SCALE;
    canvas.height = PROFILE_CARD_HEIGHT * PROFILE_CARD_EXPORT_SCALE;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The canvas is unavailable.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise((resolve) => {
      try {
        canvas.toBlob((result) => resolve(result ?? null), 'image/png');
      } catch (error) {
        console.warn('[ProfileCard] The canvas could not be exported.', error);
        resolve(null);
      }
    });
    canvas.width = 0;
    canvas.height = 0;
    if (!blob) throw new Error('The card could not be encoded as a PNG.');
    this.log(`Card exported (${blob.size} bytes, ${PROFILE_CARD_EXPORT_SCALE}x).`);
    return blob;
  }

  /**
   * Serializes the card into a `data:image/svg+xml` URL.
   *
   * The two illustrations are replaced by data URLs on the CLONE, so the live card keeps its paths
   * (and the browser keeps them cached).
   *
   * @param {string} stylesheet - Card stylesheet text.
   * @param {string} fonts - `@font-face` rules.
   * @returns {Promise<string>} The URL of the standalone image.
   */
  async buildImageUrl(stylesheet, fonts) {
    // The CONTAINER is cloned, not the card alone: it is what carries the palette the whole card
    // reads (`--card-width`, the rarity variables of `ProfileCard.RARITIES`…).
    const clone = this.rootElement.cloneNode(true);
    clone.classList.add('is-exporting');
    clone.style.margin = '0';
    const card = clone.querySelector('.card-preview');

    if (this.model) {
      // The paths may still carry the `<lang>` placeholder: the export must embed the SAME files the
      // preview shows, not the template of the active language. `Background` is an absolute URL of
      // the asset repository in the card data, which the browser fetches directly (it answers with
      // `Access-Control-Allow-Origin: *`, so the image can also be read back as a data URL here).
      const backgroundPath = this.model.background ? i18n.resolveImagePath(this.model.background) : '';
      const underlayPath = this.model.underlay ? i18n.resolveImagePath(this.model.underlay) : '';
      const background = await ProfileCard.readDataUrl(backgroundPath, 'index.html');
      const underlay = await ProfileCard.readDataUrl(underlayPath, 'index.html');
      if (background !== '') {
        clone.querySelector('.card-art').style.backgroundImage = ProfileCard.cssUrl(background);
        card.style.setProperty('--card-background-image', ProfileCard.cssUrl(background));
      }
      if (underlay !== '') {
        clone.querySelector('.card-underlay').style.backgroundImage = ProfileCard.cssUrl(underlay);
      }
    }

    // Every `<img>` of the card (the trophy medals of the featured line) has to be embedded too: an
    // SVG loaded as an image reaches no external resource. One that cannot be read is dropped, so
    // the PNG never shows a broken image icon.
    for (const image of [...clone.querySelectorAll('img')]) {
      const source = image.getAttribute('src') ?? '';
      const embedded = await ProfileCard.readDataUrl(source, 'index.html');
      if (embedded !== '') image.setAttribute('src', embedded);
      else image.remove();
    }

    const style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.textContent = ProfileCard.buildExportStyle(stylesheet, fonts);

    const wrapper = document.createElement('div');
    wrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    wrapper.className = 'xport-root';
    wrapper.setAttribute('style', `width:${PROFILE_CARD_WIDTH}px;height:${PROFILE_CARD_HEIGHT}px;`);
    wrapper.append(style, clone);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('width', String(PROFILE_CARD_WIDTH * PROFILE_CARD_EXPORT_SCALE));
    svg.setAttribute('height', String(PROFILE_CARD_HEIGHT * PROFILE_CARD_EXPORT_SCALE));
    svg.setAttribute('viewBox', `0 0 ${PROFILE_CARD_WIDTH} ${PROFILE_CARD_HEIGHT}`);

    const foreignObject = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    foreignObject.setAttribute('x', '0');
    foreignObject.setAttribute('y', '0');
    foreignObject.setAttribute('width', String(PROFILE_CARD_WIDTH));
    foreignObject.setAttribute('height', String(PROFILE_CARD_HEIGHT));
    foreignObject.appendChild(wrapper);
    svg.appendChild(foreignObject);

    const xml = new XMLSerializer().serializeToString(svg);
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  }

  /**
   * Loads an image, with a timeout: a resource that never answers must not freeze the export.
   *
   * @param {string} url - Image URL.
   * @returns {Promise<HTMLImageElement|null>} The loaded image, or null.
   */
  static loadImage(url) {
    return new Promise((resolve) => {
      const image = new Image();
      const timer = setTimeout(() => resolve(null), IMAGE_TIMEOUT);
      image.onload = () => {
        clearTimeout(timer);
        resolve(image);
      };
      image.onerror = () => {
        clearTimeout(timer);
        resolve(null);
      };
      image.src = url;
    });
  }

  /**
   * Builds the file name of the exported card.
   *
   * @returns {string} A file name safe on every system (the number identifies the player).
   */
  getFileName() {
    const number = this.model?.seriesNumber ? `-${this.model.seriesNumber}` : '';
    return `minecards-profile${number}-${this.layout}.png`;
  }

  /**
   * Exports the card and hands the PNG to the browser's downloads.
   *
   * @returns {Promise<string>} The file name written.
   * @throws {Error} See `toBlob()`.
   */
  async download() {
    const blob = await this.toBlob();
    const filename = this.getFileName();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Safari needs the URL to outlive the click by a tick.
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    this.log(`Download triggered: ${filename}.`);
    return filename;
  }

  /**
   * Releases the observer and the shadow tree.
   *
   * @returns {void}
   */
  destroy() {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.root.textContent = '';
    this.model = null;
  }
}

export default ProfileCard;

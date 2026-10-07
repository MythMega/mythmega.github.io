/**
 * CardComponent - One card of the opening reveal.
 *
 * Reference: `.docs/steps/4.md` point 3.
 *
 * RESPONSIBILITIES
 *   - render a face-down card whose back is a pure CSS pattern;
 *   - flip it with a CSS 3D animation when the player taps it (rarities 4 and 5 add an animated
 *     glow coming from the theme variables, full art printings get a light sweep);
 *   - resolve the illustration through `I18n.resolveImagePath()` and follow `LANG_CHANGED`, so
 *     the artwork and the labels switch language without rebuilding the view;
 *   - show the "NEW" badge once the card is revealed, when the card was not owned before
 *     the pack (`openBooster()` returns the new keys, computed before the write). The badge is
 *     hidden while the card is face down (no spoiler) and sits inside the front face so the
 *     3D flip never mirrors it.
 *
 * The component owns its listeners and removes them in `destroy()`, which the opening view calls
 * when the reveal is dismissed.
 */

import i18n from '../../utils/I18n.js';
import eventBus, { EVENTS } from '../../utils/EventBus.js';
import { getRarityLabel } from '../../classes/Card.js';

export class CardComponent {
  /**
   * @param {Card} card - Card to display.
   * @param {object} [options] - Component options.
   * @param {boolean} [options.isNew=false] - True when the card entered the collection now.
   * @param {(card: Card, component: CardComponent) => void|null} [options.onFlipped=null] - Called
   *   the first time the card is revealed.
   * @param {boolean} [options.flipOnClick=true] - False disables the built-in click-to-flip
   *   listener, so the parent view can drive the reveal (spotlight tap-to-reveal).
   */
  constructor(card, { isNew = false, onFlipped = null, flipOnClick = true } = {}) {
    if (!card || typeof card.uniqueKey !== 'string') {
      throw new TypeError('CardComponent requires a Card instance.');
    }

    this.card = card;
    this.isNew = isNew;
    this.onFlipped = onFlipped;
    this.flipOnClick = flipOnClick !== false;
    this.isFlipped = false;

    /** @type {HTMLElement|null} */
    this.element = null;
    /** @type {HTMLImageElement|null} */
    this.image = null;
    /** @type {HTMLElement|null} */
    this.nameFallback = null;
    /** @type {HTMLElement|null} */
    this.badge = null;
    /** @type {Function|null} */
    this.unsubscribeLangChanged = null;

    console.debug(`[CardComponent] Prepared "${card.uniqueKey}" (new: ${isNew}).`);
  }

  /**
   * Builds the CSS class list of a card (rarity, style).
   *
   * @param {Card} card - Card to describe.
   * @returns {string} The class attribute value.
   */
  static buildClassName(card) {
    const classes = ['card-reveal__card', `card-reveal__card--r${card.rarity}`];
    if (card.isFullArt) {
      classes.push('card-reveal__card--fullart');
    }
    return classes.join(' ');
  }

  /**
   * Builds the card element (idempotent: a second call returns the same element).
   *
   * @returns {HTMLElement} The card button.
   */
  render() {
    if (this.element) return this.element;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = CardComponent.buildClassName(this.card);
    button.dataset.key = this.card.uniqueKey;
    button.setAttribute('aria-expanded', 'false');

    const back = document.createElement('span');
    back.className = 'card-reveal__face card-reveal__face--back';
    const backMark = document.createElement('span');
    backMark.className = 'card-reveal__back-mark';
    backMark.textContent = i18n.t('app.title');
    back.appendChild(backMark);

    const front = document.createElement('span');
    front.className = 'card-reveal__face card-reveal__face--front';

    if (this.isNew) {
      const badge = document.createElement('span');
      badge.className = 'card-reveal__badge';
      badge.hidden = true;
      front.appendChild(badge);
      this.badge = badge;
    }

    const image = document.createElement('img');
    image.className = 'card-reveal__image';
    image.loading = 'eager';
    image.decoding = 'async';
    image.addEventListener('error', () => this.handleImageError());
    front.appendChild(image);

    const nameFallback = document.createElement('span');
    nameFallback.className = 'card-reveal__fallback-name';
    nameFallback.hidden = true;
    front.appendChild(nameFallback);

    button.append(back, front);
    if (this.flipOnClick) {
      button.addEventListener('click', () => this.flip());
    }

    this.element = button;
    this.image = image;
    this.nameFallback = nameFallback;
    this.applyLanguage(i18n.getLang());

    this.unsubscribeLangChanged = eventBus.on(EVENTS.LANG_CHANGED, () => this.updateLanguage());
    console.debug(
      `[CardComponent] Rendered "${this.card.uniqueKey}" (rarity ${this.card.rarity}, style ${this.card.style}, new: ${this.isNew}).`
    );
    return button;
  }

  /**
   * Flips the card (first call only) and notifies the parent once.
   *
   * @returns {boolean} True when the flip happened on this call.
   */
  flip() {
    if (!this.element || this.isFlipped) return false;

    this.isFlipped = true;
    this.element.classList.add('is-flipped');
    this.element.setAttribute('aria-expanded', 'true');
    if (this.badge) {
      this.badge.hidden = false;
    }
    this.applyAriaLabel();
    console.info(`[CardComponent] Revealed "${this.card.uniqueKey}"${this.isNew ? ' (NEW)' : ''}.`);

    if (typeof this.onFlipped === 'function') {
      this.onFlipped(this.card, this);
    }
    return true;
  }

  /**
   * Re-applies the current language to the illustration and the labels.
   *
   * @returns {void}
   */
  updateLanguage() {
    const lang = i18n.getLang();
    this.applyLanguage(lang);
    console.debug(`[CardComponent] Language applied to "${this.card.uniqueKey}": ${lang}.`);
  }

  /**
   * Writes the resolved paths and the translated labels for a language.
   *
   * @param {string} lang - Language code.
   * @returns {void}
   */
  applyLanguage(lang) {
    const name = this.card.getName(lang);
    const rarityLabel = getRarityLabel(this.card.rarity, (key) => i18n.t(key));

    if (this.image) {
      this.image.src = i18n.resolveImagePath(this.card.illustration);
      this.image.alt = `${name} — ${rarityLabel}`;
    }
    if (this.nameFallback) {
      this.nameFallback.textContent = name;
    }
    if (this.badge) {
      this.badge.textContent = i18n.t('opening.card.new');
    }
    if (this.element) {
      this.applyAriaLabel();
    }
  }

  /**
   * Writes the accessible label of the card.
   *
   * While the card is face down the label stays neutral ("face-down card") so screen readers
   * do not spoil the content; once revealed it carries the name, the rarity and the "new" flag.
   *
   * @returns {void}
   */
  applyAriaLabel() {
    if (!this.element) return;
    if (!this.isFlipped) {
      this.element.setAttribute('aria-label', i18n.t('opening.card.hidden'));
      return;
    }
    const name = this.card.getName(i18n.getLang());
    const rarityLabel = getRarityLabel(this.card.rarity, (key) => i18n.t(key));
    const suffix = this.isNew ? ` — ${i18n.t('opening.card.new')}` : '';
    this.element.setAttribute('aria-label', `${name} — ${rarityLabel}${suffix}`);
  }

  /**
   * Falls back to the card name when the illustration cannot be loaded.
   *
   * @returns {void}
   */
  handleImageError() {
    console.warn(`[CardComponent] Illustration not found for "${this.card.uniqueKey}": ${this.image?.src}`);
    if (this.image) {
      this.image.hidden = true;
    }
    if (this.nameFallback) {
      this.nameFallback.hidden = false;
    }
  }

  /**
   * Removes the listeners held by the component.
   *
   * @returns {void}
   */
  destroy() {
    if (typeof this.unsubscribeLangChanged === 'function') {
      this.unsubscribeLangChanged();
      this.unsubscribeLangChanged = null;
    }
    this.element?.remove();
    this.element = null;
    this.image = null;
    this.nameFallback = null;
    this.badge = null;
    console.debug(`[CardComponent] Destroyed "${this.card.uniqueKey}".`);
  }
}

export default CardComponent;

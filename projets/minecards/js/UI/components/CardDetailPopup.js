/**
 * CardDetailPopup - The large, read-only view of one card, opened from a thumbnail.
 *
 * Reference: `js/utils/CardTilt.js` (the drag-to-tilt gesture), `js/utils/Shine.js` (the foil and
 * the halo), `js/UI/components/CardEffectsToggle.js` (the "Effets" switch),
 * `css/views/opening.css` (`.card-modal__*`, shared by every card detail) and
 * `css/components/modal.css` (the dialog shell).
 *
 * WHY A MODULE. The collection, the opening summary and the profile each own a dialog of their own
 * page, declared in `index.html`. A reward of the Illager Shop and a day of the daily board are
 * different: they are drawn on demand, wherever the player is, and both owe the player the SAME
 * large card - the artwork in the window of the foil, the felt thickness of the tilt, the halo of
 * the rarities and the switch that silences every effect. So this builds ONE overlay, appended to
 * `<body>` the first time a card is shown, and a caller only hands it a card and, optionally, the
 * rows of its own context (the price of an offer, the day of a reward).
 *
 * The body is rebuilt on every opening - the language of the names and the rows of the caller
 * change between two openings - while the shell is reused, so a second opening costs nothing.
 *
 * READ-ONLY. Nothing here grants, sells, pins or opens anything: the actions stay on the surface
 * that showed the thumbnail. Escape, the close button and a tap on the backdrop close the popup,
 * and the focus returns to the element that opened it.
 */

import i18n from '../../utils/I18n.js';
import cardLanguage from '../../utils/CardLanguage.js';
import { getRarityLabel } from '../../classes/Card.js';
import boosterManager from '../../business/BoosterManager.js';
import { attachCardTilt } from '../../utils/CardTilt.js';
import { applyShine, applyCardGlow, getShineClasses } from '../../utils/Shine.js';
import { buildCardEffectsToggle, syncCardEffectsToggle } from './CardEffectsToggle.js';

export class CardDetailPopup {
  constructor() {
    /** @type {HTMLElement|null} Overlay, built on the first opening. */
    this.root = null;
    /** @type {HTMLElement|null} Title of the dialog. */
    this.title = null;
    /** @type {HTMLElement|null} Body of the dialog, rebuilt on every opening. */
    this.body = null;
    /** @type {Element|null} Element focused before the popup opened. */
    this.previousFocus = null;
    /** @type {HTMLElement|null} Window of the effects, which the switch silences. */
    this.shineWindow = null;
    /** @type {boolean} Foil and halo of the large card (on by default, kept for the session). */
    this.shineEnabled = true;
    /** @type {Map<string, string>|null} Names of the extensions, read once. */
    this.setNames = null;
  }

  /**
   * Tells whether the popup is on screen.
   *
   * @returns {boolean} True when it is open.
   */
  isOpen() {
    return Boolean(this.root) && this.root.hidden === false;
  }

  /**
   * Creates the shell of the dialog once and binds its listeners.
   *
   * The listeners are bound to the shell, never to the card: the body is rebuilt on every opening,
   * so a listener per card would have to be undone each time.
   *
   * @returns {void}
   */
  ensureMarkup() {
    if (this.root) return;

    const root = document.createElement('div');
    root.className = 'modal modal--stacked card-detail-popup';
    root.hidden = true;
    root.addEventListener('click', (event) => {
      if (event.target === root) this.close();
    });

    const dialog = document.createElement('div');
    dialog.className = 'modal__dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'card-detail-popup-title');

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'modal__close';
    closeButton.setAttribute('aria-label', '×');
    closeButton.textContent = '×';
    closeButton.addEventListener('click', () => this.close());

    const title = document.createElement('h2');
    title.className = 'modal__title';
    title.id = 'card-detail-popup-title';

    const body = document.createElement('div');
    body.className = 'modal__body';
    // One delegated listener: the switch belongs to the body that is rebuilt on every opening.
    body.addEventListener('click', (event) => {
      const toggle = event.target instanceof Element
        ? event.target.closest('[data-card-effects]')
        : null;
      if (toggle) this.toggleShine();
    });

    dialog.append(closeButton, title, body);
    root.append(dialog);
    document.body.append(root);

    // The capture phase is what keeps Escape to the TOPMOST dialog: a merchant or the daily board
    // is still open behind this popup, and its own handler must not close it as well.
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !this.isOpen()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.close();
    }, true);

    this.root = root;
    this.title = title;
    this.body = body;
  }

  /**
   * Shows one card large.
   *
   * @param {object} card - Card to display.
   * @param {object} [options] - Opening options.
   * @param {Array<[string, string]>} [options.rows=[]] - Extra rows of the caller (a price, a day),
   *   appended after the ones every card detail shows.
   * @param {boolean} [options.effects=false] - Turns the effects back on for this opening, instead
   *   of reusing the state left by the switch of a previous visit.
   * @returns {Promise<void>} Resolves once the dialog is displayed.
   */
  async open(card, { rows = [], effects = false } = {}) {
    if (!card) return;
    this.ensureMarkup();
    if (effects) this.shineEnabled = true;
    this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const lang = cardLanguage.getLang();
    const name = card.getName(lang);
    this.title.textContent = name;
    this.body.textContent = '';

    this.body.append(this.buildArtwork(card, name));
    if (getShineClasses(card).length > 0) {
      this.body.append(buildCardEffectsToggle(this.shineEnabled));
    }

    const description = card.getDescription(lang);
    if (description) {
      const paragraph = document.createElement('p');
      paragraph.className = 'card-modal__desc';
      paragraph.textContent = description;
      this.body.append(paragraph);
    }

    this.body.append(await this.buildDetails(card, name, rows));

    this.root.hidden = false;
    this.root.querySelector('.modal__close')?.focus();
  }

  /**
   * Builds the window of the effects around the illustration.
   *
   * The wrapper takes the exact shape of the illustration (`--card-reveal-art-ratio`), which is what
   * lines the foil of `css/components/card-shine.css` up with the artwork: a classic and a full art
   * printing get the same window, and neither paints over the frame.
   *
   * @param {object} card - Card to display.
   * @param {string} name - Translated card name (also part of the accessible text).
   * @returns {HTMLElement} The artwork box.
   */
  buildArtwork(card, name) {
    const art = document.createElement('div');
    art.className = 'card-modal__art';

    const image = document.createElement('img');
    image.className = 'card-modal__image';
    image.src = i18n.resolveImagePath(card.illustration);
    image.alt = `${name} (${getRarityLabel(card.rarity, (key) => i18n.t(key))})`;
    image.decoding = 'async';
    image.addEventListener('load', () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        art.style.setProperty(
          '--card-reveal-art-ratio',
          String(image.naturalWidth / image.naturalHeight)
        );
      }
    });
    image.addEventListener('error', () => {
      console.warn(`[CardDetailPopup] The illustration of "${card.uniqueKey ?? name}" is missing.`);
      image.hidden = true;
    });
    art.appendChild(image);
    attachCardTilt(art);

    applyShine(art, card);
    applyCardGlow(art, card);
    art.classList.toggle('is-off', !this.shineEnabled);
    this.shineWindow = art;
    return art;
  }

  /**
   * Builds the printable details of the card: what every card detail shows, then the rows of the
   * caller.
   *
   * @param {object} card - Card to display.
   * @param {string} name - Translated card name.
   * @param {Array<[string, string]>} rows - Extra rows (term, value).
   * @returns {Promise<HTMLElement>} The list.
   */
  async buildDetails(card, name, rows) {
    const list = document.createElement('dl');
    list.className = 'card-modal__details';

    const entries = [
      [i18n.t('opening.card.name'), name],
      // The index is the reference printed in the JSON of a set: what a player quotes about a card.
      [i18n.t('opening.card.index'), card.index || card.id || ''],
      [i18n.t('opening.card.rarity'), getRarityLabel(card.rarity, (key) => i18n.t(key))],
      [i18n.t('opening.card.set'), await this.resolveSetName(card.set)],
      ...rows,
    ];
    entries.forEach(([term, value]) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'card-modal__row';
      const key = document.createElement('dt');
      key.textContent = term;
      const text = document.createElement('dd');
      text.textContent = value;
      wrapper.append(key, text);
      list.appendChild(wrapper);
    });
    return list;
  }

  /**
   * Resolves the display name of an extension.
   *
   * The catalogue is read once per page; a read failure leaves the raw id, which is still the name
   * the save and the cards use.
   *
   * @param {string|null} setId - Extension id.
   * @returns {Promise<string>} The translated or stored name, or an em dash.
   */
  async resolveSetName(setId) {
    if (!setId) return i18n.t('common.unknown');
    if (!this.setNames) {
      try {
        const sets = await boosterManager.listBoosterSets({ includeUpcoming: true });
        this.setNames = new Map(sets.map((set) => [set.setId, set.name]));
      } catch (error) {
        console.warn('[CardDetailPopup] The names of the extensions could not be read.', error);
        this.setNames = new Map();
      }
    }
    return this.setNames.get(setId) ?? setId;
  }

  /**
   * Switches every effect of the open detail on or off.
   *
   * The choice is a reading comfort, not a game setting: it is kept for the page and never written
   * to the account.
   *
   * @returns {void}
   */
  toggleShine() {
    this.shineEnabled = !this.shineEnabled;
    this.shineWindow?.classList.toggle('is-off', !this.shineEnabled);
    syncCardEffectsToggle(this.body, this.shineEnabled);
  }

  /**
   * Closes the popup and gives the focus back to the element that opened it.
   *
   * @returns {void}
   */
  close() {
    if (!this.isOpen()) return;
    this.root.hidden = true;
    const previous = this.previousFocus;
    this.previousFocus = null;
    if (previous && previous.isConnected && typeof previous.focus === 'function') previous.focus();
  }
}

/** Shared instance: one dialog serves the whole application. */
export const cardDetailPopup = new CardDetailPopup();

export default cardDetailPopup;

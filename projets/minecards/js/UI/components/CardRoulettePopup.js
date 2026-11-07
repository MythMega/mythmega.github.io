/**
 * CardRoulettePopup - The gacha wheel of a "random card" reward.
 *
 * Reference: `js/business/RandomCardReward.js` (the pool, the strip and the winner) and
 * `css/components/card-roulette.css` (the wheel and the reveal).
 *
 * WHY IT EXISTS
 * A daily reward or a code can hand out "a random card". The card is drawn and GRANTED before the
 * wheel starts (the manager's transaction is the only writer): this dialog only shows the result,
 * so the card the wheel stops on can never be a different one from the card in the save, and
 * closing the dialog never costs anything.
 *
 * THE TWO PHASES
 *   1. the wheel: a strip of card printings scrolls under a marker for five seconds, slows down and
 *      stops with the granted card under the marker. Clicking the strip (or pressing a key) skips
 *      the wait; the reward is already written, nothing is lost.
 *   2. the reveal: the card is shown large, with its name, its rarity and whether it is NEW, and
 *      the single button of the dialog collects it.
 *
 * FOCUS MODE
 * The roulette is a ritual, exactly like a booster opening or a Mine Pick choice: the app chrome
 * steps aside for its whole duration (`setFocusMode`), and comes back when it closes.
 */

import i18n from '../../utils/I18n.js';
import cardLanguage from '../../utils/CardLanguage.js';
import eventBus, { EVENTS } from '../../utils/EventBus.js';
import soundManager, { UI_SOUNDS } from '../../utils/SoundManager.js';
import { applyCardGlow } from '../../utils/Shine.js';
import { setFocusMode } from '../../utils/FocusMode.js';
import { getRarityLabel } from '../../classes/Card.js';
import { preloadImages, isImageReady } from '../../utils/ImagePreloader.js';

/** Class of the overlay, which is also a `.modal` for the shared dialog sounds. */
export const CARD_ROULETTE_CLASS = 'card-roulette';

/** Duration of the spin, in milliseconds (the brief: five seconds). */
export const CARD_ROULETTE_SPIN_MS = 5000;

/** Braking curve of the wheel: fast start, very long deceleration, no bounce. */
const SPIN_EASING = 'cubic-bezier(0.12, 0.72, 0.09, 1)';

/** Longest wait for the illustrations of the strip before the wheel starts anyway, in ms. */
const REEL_PRELOAD_TIMEOUT_MS = 8000;

export class CardRoulettePopup {
  constructor() {
    /** @type {HTMLElement|null} Overlay. */
    this.root = null;
    /** @type {HTMLElement|null} Dialog. */
    this.dialog = null;
    /** @type {boolean} True once the markup exists. */
    this.mounted = false;
    /** @type {object|null} What is being revealed (`{ winner, isNew }`). */
    this.state = null;
    /** @type {boolean} True while the wheel turns. */
    this.spinning = false;
    /** @type {number} Token guarding the asynchronous preload of the strip. */
    this.spinToken = 0;
    /** @type {number|null} Timer of the spin. */
    this.timer = null;
    /** @type {number|null} Timer of the reveal beat. */
    this.revealTimer = null;
    /** @type {(() => void)|null} Resolved when the dialog closes (the caller's `await`). */
    this.closedResolver = null;
    /** @type {Element|null} Element focused before the dialog opened. */
    this.previousFocus = null;
    /** @type {Function[]} */
    this.unsubscribers = [
      eventBus.on(EVENTS.LANG_CHANGED, () => this.handleLanguageChanged()),
      eventBus.on(EVENTS.CARD_LANG_CHANGED, () => this.handleLanguageChanged()),
    ];
    /** @type {(event: KeyboardEvent) => void} Escape / Enter handler, bound once. */
    this.handleKeyDown = (event) => {
      if (!this.isOpen()) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
        return;
      }
      // A tap anywhere skips the wait; the keyboard gets the same shortcut, so a player who cannot
      // click the wheel is not stuck for five seconds.
      if (this.spinning && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        this.finishSpin();
      }
    };
  }

  /**
   * Logs with the popup prefix.
   *
   * @param {...unknown} args - Values forwarded to `console.info`.
   * @returns {void}
   */
  log(...args) {
    console.info('[CardRoulettePopup]', ...args);
  }

  /**
   * Tells whether the dialog is on screen.
   *
   * @returns {boolean} True when it is open.
   */
  isOpen() {
    return Boolean(this.root) && this.root.hidden === false;
  }

  /**
   * Opens the roulette and resolves once the player closed it.
   *
   * @param {object} options - What to spin.
   * @param {object[]} options.cards - The strip (`RandomCardReward.buildRandomCardReel()`).
   * @param {number} options.winnerIndex - Position of the granted card in the strip.
   * @param {boolean} [options.isNew=false] - True when the card entered the collection now.
   * @param {string} [options.titleKey='card.roulette.title'] - Title of the dialog.
   * @returns {Promise<void>} Resolves when the dialog is closed (by the button, Escape or a click
   *   on the overlay).
   */
  async open({ cards, winnerIndex, isNew = false, titleKey = 'card.roulette.title' }) {
    if (!Array.isArray(cards) || cards.length === 0) return;
    this.ensureMarkup();
    if (!this.isOpen()) {
      this.previousFocus = document.activeElement;
      this.root.hidden = false;
      document.addEventListener('keydown', this.handleKeyDown);
      setFocusMode(true);
    }

    this.state = { winner: cards[winnerIndex] ?? cards[cards.length - 1], isNew, titleKey };
    this.closedResolver?.();
    const closed = new Promise((resolve) => {
      this.closedResolver = resolve;
    });

    this.renderStrip(cards);
    this.renderReveal();
    void this.startSpin(winnerIndex);
    this.log(`Spinning ${cards.length} tile(s), winner at ${winnerIndex}.`);
    return closed;
  }

  /**
   * Closes the dialog, brings the chrome back and releases the caller.
   *
   * @returns {void}
   */
  close() {
    if (!this.root) return;
    this.clearTimers();
    this.spinning = false;
    this.spinToken += 1;
    const loading = this.root.querySelector('[data-card-roulette-loading]');
    if (loading) loading.hidden = true;
    this.root.hidden = true;
    document.removeEventListener('keydown', this.handleKeyDown);
    setFocusMode(false);
    if (this.previousFocus instanceof HTMLElement && this.previousFocus.isConnected) {
      this.previousFocus.focus();
    }
    this.previousFocus = null;
    const resolve = this.closedResolver;
    this.closedResolver = null;
    resolve?.();
  }

  /**
   * Cancels every pending timer of the wheel.
   *
   * @returns {void}
   */
  clearTimers() {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.revealTimer !== null) {
      window.clearTimeout(this.revealTimer);
      this.revealTimer = null;
    }
  }

  /**
   * Creates the shell of the dialog once.
   *
   * @returns {void}
   */
  ensureMarkup() {
    if (this.mounted && this.root) return;

    const root = document.createElement('div');
    root.className = `modal modal--stacked ${CARD_ROULETTE_CLASS}`;
    root.hidden = true;
    root.dataset.cardRoulette = '';
    root.addEventListener('click', (event) => {
      if (event.target === root) this.close();
    });

    const dialog = document.createElement('div');
    dialog.className = `modal__dialog ${CARD_ROULETTE_CLASS}__dialog`;
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'card-roulette-title');

    const badge = document.createElement('p');
    badge.className = `${CARD_ROULETTE_CLASS}__badge`;
    badge.dataset.cardRouletteBadge = '';

    const title = document.createElement('h2');
    title.className = 'modal__title';
    title.id = 'card-roulette-title';
    title.dataset.cardRouletteTitle = '';

    const subtitle = document.createElement('p');
    subtitle.className = `${CARD_ROULETTE_CLASS}__subtitle`;
    subtitle.dataset.cardRouletteSubtitle = '';

    // The wheel waits for its pictures instead of turning over empty tiles (see `ImagePreloader`):
    // this line is only visible on a connection slow enough to need it.
    const loading = document.createElement('p');
    loading.className = 'image-loader';
    loading.dataset.cardRouletteLoading = '';
    loading.hidden = true;
    const loadingSpinner = document.createElement('span');
    loadingSpinner.className = 'image-loader__spinner';
    loadingSpinner.setAttribute('aria-hidden', 'true');
    const loadingLabel = document.createElement('span');
    loadingLabel.className = 'image-loader__label';
    loadingLabel.dataset.cardRouletteLoadingLabel = '';
    loading.append(loadingSpinner, loadingLabel);

    const windowElement = document.createElement('div');
    windowElement.className = `${CARD_ROULETTE_CLASS}__window`;
    windowElement.dataset.cardRouletteWindow = '';
    windowElement.setAttribute('role', 'button');
    windowElement.tabIndex = 0;
    windowElement.addEventListener('click', () => {
      if (this.spinning) this.finishSpin();
    });
    const marker = document.createElement('span');
    marker.className = `${CARD_ROULETTE_CLASS}__marker`;
    marker.setAttribute('aria-hidden', 'true');
    const strip = document.createElement('ul');
    strip.className = `${CARD_ROULETTE_CLASS}__strip`;
    strip.dataset.cardRouletteStrip = '';
    windowElement.append(marker, strip);

    const reveal = document.createElement('div');
    reveal.className = `${CARD_ROULETTE_CLASS}__reveal`;
    reveal.dataset.cardRouletteReveal = '';
    reveal.hidden = true;
    const revealImage = document.createElement('img');
    revealImage.className = `${CARD_ROULETTE_CLASS}__reveal-image`;
    revealImage.dataset.cardRouletteImage = '';
    revealImage.alt = '';
    revealImage.decoding = 'async';
    const revealName = document.createElement('p');
    revealName.className = `${CARD_ROULETTE_CLASS}__reveal-name`;
    revealName.dataset.cardRouletteName = '';
    const revealMeta = document.createElement('p');
    revealMeta.className = `${CARD_ROULETTE_CLASS}__reveal-meta`;
    revealMeta.dataset.cardRouletteMeta = '';
    const revealState = document.createElement('p');
    revealState.className = `${CARD_ROULETTE_CLASS}__reveal-state`;
    revealState.dataset.cardRouletteState = '';
    reveal.append(revealImage, revealName, revealMeta, revealState);

    const actions = document.createElement('div');
    actions.className = 'modal__actions';
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'btn btn--primary';
    confirm.dataset.cardRouletteConfirm = '';
    confirm.addEventListener('click', () => this.close());
    actions.append(confirm);

    dialog.append(badge, title, subtitle, loading, windowElement, reveal, actions);
    root.append(dialog);
    document.body.append(root);

    this.root = root;
    this.dialog = dialog;
    this.mounted = true;
  }

  /**
   * Writes the static labels of the open dialog.
   *
   * @returns {void}
   */
  renderLabels() {
    if (!this.root) return;
    const titleKey = this.state?.titleKey ?? 'card.roulette.title';
    const badge = this.root.querySelector('[data-card-roulette-badge]');
    const title = this.root.querySelector('[data-card-roulette-title]');
    const subtitle = this.root.querySelector('[data-card-roulette-subtitle]');
    const confirm = this.root.querySelector('[data-card-roulette-confirm]');
    if (badge) badge.textContent = i18n.t('card.roulette.badge');
    if (title) title.textContent = i18n.t(titleKey);
    if (subtitle) subtitle.textContent = i18n.t('card.roulette.subtitle');
    if (confirm) confirm.textContent = i18n.t('card.roulette.claim');
    const loadingLabel = this.root.querySelector('[data-card-roulette-loading-label]');
    if (loadingLabel) loadingLabel.textContent = i18n.t('card.roulette.loading');
  }

  /**
   * Builds the strip of the wheel.
   *
   * @param {object[]} cards - Cards of the strip, in order.
   * @returns {void}
   */
  renderStrip(cards) {
    const strip = this.root?.querySelector('[data-card-roulette-strip]');
    if (!strip) return;
    strip.textContent = '';
    cards.forEach((card) => {
      const item = document.createElement('li');
      item.className = `${CARD_ROULETTE_CLASS}__tile`;
      applyCardGlow(item, card);
      const image = document.createElement('img');
      image.className = `${CARD_ROULETTE_CLASS}__tile-image`;
      image.src = i18n.resolveImagePath(card.illustration);
      image.alt = '';
      image.loading = 'eager';
      image.decoding = 'async';
      image.setAttribute('aria-hidden', 'true');
      item.append(image);
      strip.append(item);
    });
  }

  /**
   * Writes the reveal block (image, name, rarity, new-or-duplicate).
   *
   * @returns {void}
   */
  renderReveal() {
    if (!this.root || !this.state) return;
    const { winner, isNew } = this.state;
    const image = this.root.querySelector('[data-card-roulette-image]');
    const name = this.root.querySelector('[data-card-roulette-name]');
    const meta = this.root.querySelector('[data-card-roulette-meta]');
    const state = this.root.querySelector('[data-card-roulette-state]');
    const reveal = this.root.querySelector('[data-card-roulette-reveal]');

    if (reveal) {
      applyCardGlow(reveal, winner);
    }
    if (image) {
      image.src = i18n.resolveImagePath(winner.illustration);
      image.alt = winner.getName(cardLanguage.getLang());
    }
    if (name) name.textContent = winner.getName(cardLanguage.getLang());
    if (meta) {
      meta.textContent = getRarityLabel(winner.rarity, (key) => i18n.t(key));
    }
    if (state) {
      state.textContent = i18n.t(isNew ? 'card.roulette.new' : 'card.roulette.duplicate');
      state.dataset.new = String(isNew);
    }
  }

  /**
   * Starts the spin of the strip and arms the end of the animation.
   *
   * @param {number} winnerIndex - Position the wheel must stop on.
   * @returns {void}
   */
  async startSpin(winnerIndex) {
    if (!this.root) return;
    this.clearTimers();
    this.spinning = true;
    const token = this.spinToken + 1;
    this.spinToken = token;

    const windowElement = this.root.querySelector('[data-card-roulette-window]');
    const strip = this.root.querySelector('[data-card-roulette-strip]');
    const reveal = this.root.querySelector('[data-card-roulette-reveal]');
    const confirm = this.root.querySelector('[data-card-roulette-confirm]');
    if (!windowElement || !strip) return;

    if (reveal) reveal.hidden = true;
    if (confirm) confirm.disabled = true;
    this.renderLabels();
    windowElement.hidden = false;
    windowElement.removeAttribute('aria-hidden');

    // The card is already granted, so waiting for the pictures costs nothing: the wheel then turns
    // over complete tiles instead of flashing empty ones on a slow connection.
    const loading = this.root.querySelector('[data-card-roulette-loading]');
    const urls = Array.from(strip.querySelectorAll('img')).map((image) => image.src);
    if (!urls.every((url) => isImageReady(url))) {
      if (loading) loading.hidden = false;
      await preloadImages(urls, { timeout: REEL_PRELOAD_TIMEOUT_MS });
      if (!this.spinning || token !== this.spinToken) return;
      if (loading) loading.hidden = true;
    }

    // Rewind, then let the browser settle the layout: measuring before it would read the previous
    // strip and stop the wheel a few pixels off the marker.
    strip.style.transition = 'none';
    strip.style.transform = 'translateX(0)';
    const tiles = strip.children;
    const tile = tiles[0];
    if (!tile) return;
    // The step includes the gap of the strip, read from the computed style so the layout is the
    // only source of truth (theme, zoom and font size all move the tiles).
    const gap = Number.parseFloat(window.getComputedStyle(strip).columnGap || '0') || 0;
    const tileWidth = tile.getBoundingClientRect().width;
    const windowWidth = windowElement.getBoundingClientRect().width;
    const step = tileWidth + gap;
    const target = windowWidth / 2 - (winnerIndex * step + tileWidth / 2);

    void strip.offsetWidth;
    strip.style.transition = `transform ${CARD_ROULETTE_SPIN_MS}ms ${SPIN_EASING}`;
    strip.style.transform = `translateX(${target}px)`;
    soundManager.playUi(UI_SOUNDS.SECTION_SWITCH);

    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.finishSpin();
    }, CARD_ROULETTE_SPIN_MS + 60);
  }

  /**
   * Ends the wheel (early on a tap, or on its own) and shows the granted card.
   *
   * @returns {void}
   */
  finishSpin() {
    if (!this.spinning) return;
    this.spinning = false;
    this.clearTimers();
    const loading = this.root?.querySelector('[data-card-roulette-loading]');
    if (loading) loading.hidden = true;
    const strip = this.root?.querySelector('[data-card-roulette-strip]');
    if (strip) strip.style.transition = 'none';

    this.revealTimer = window.setTimeout(() => {
      this.revealTimer = null;
      this.showReveal();
    }, 220);
  }

  /**
   * Switches the dialog to its reveal phase.
   *
   * @returns {void}
   */
  showReveal() {
    if (!this.root || !this.state) return;
    const windowElement = this.root.querySelector('[data-card-roulette-window]');
    const reveal = this.root.querySelector('[data-card-roulette-reveal]');
    const subtitle = this.root.querySelector('[data-card-roulette-subtitle]');
    const confirm = this.root.querySelector('[data-card-roulette-confirm]');
    if (windowElement) {
      windowElement.hidden = true;
      windowElement.setAttribute('aria-hidden', 'true');
    }
    if (subtitle) subtitle.textContent = i18n.t('card.roulette.subtitleDone');
    if (reveal) {
      reveal.hidden = false;
      void reveal.offsetWidth;
      reveal.classList.add('is-active');
    }
    if (confirm) {
      confirm.disabled = false;
      confirm.focus();
    }
    soundManager.playUi(UI_SOUNDS.NOTIFICATION_SHOW);
    this.log(`Revealed \"${this.state.winner.uniqueKey}\" (new: ${this.state.isNew}).`);
  }

  /**
   * Rewrites the dialog in the new language (a language change while it is open).
   *
   * @returns {void}
   */
  handleLanguageChanged() {
    if (!this.isOpen()) return;
    this.renderLabels();
    this.renderReveal();
  }

  /**
   * Releases the subscriptions and removes the dialog.
   *
   * @returns {void}
   */
  destroy() {
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers = [];
    this.clearTimers();
    document.removeEventListener('keydown', this.handleKeyDown);
    this.root?.remove();
    this.root = null;
    this.dialog = null;
    this.mounted = false;
    this.state = null;
  }
}

/** Shared instance used by the daily board and the redeem view. */
export const cardRoulettePopup = new CardRoulettePopup();

export default cardRoulettePopup;

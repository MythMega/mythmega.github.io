/**
 * TraderPurchaseModal - Confirmation shown before the Wandering Trader spends anything.
 *
 * Reference: `js/UI/views/MineBlockView.js` (the three trader actions) and
 * `css/components/modal.css`.
 *
 * A card offer, the daily Sparks offer and a resource-for-resource trade all commit
 * immediately in `TraderManager`. This dialog is the single gate in front of them: it only
 * answers "confirmed" or "cancelled", and the caller performs the transaction after a `true`.
 *
 * The markup is owned by the component because it is appended to `<body>`: it can therefore
 * stack on top of the trader dialog without depending on a view's markup.
 */

import i18n from '../../utils/I18n.js';

export class TraderPurchaseModal {
  /** Builds the dialog lazily: a player who never trades never builds it. */
  constructor() {
    /** @type {HTMLElement|null} Overlay of the dialog. */
    this.root = null;
    /** @type {HTMLElement|null} Title of the dialog. */
    this.titleElement = null;
    /** @type {HTMLElement|null} Sentence naming what is about to happen. */
    this.messageElement = null;
    /** @type {HTMLElement|null} Optional second line (price, once-a-day note). */
    this.detailsElement = null;
    /** @type {HTMLButtonElement|null} Confirm button. */
    this.confirmButton = null;
    /** @type {((confirmed: boolean) => void)|null} Pending answer of `open()`. */
    this.resolver = null;
    /** @type {HTMLElement|null} Element focused before the dialog opened. */
    this.returnFocus = null;
  }

  /** Whether the dialog is currently displayed. */
  get isOpen() {
    return this.root !== null && !this.root.hidden;
  }

  /**
   * Builds the dialog once, then reuses it.
   *
   * @returns {HTMLElement} The overlay.
   */
  ensureMarkup() {
    if (this.root) return this.root;

    const overlay = document.createElement('div');
    overlay.className = 'modal modal--stacked trader-confirm';
    overlay.hidden = true;

    const dialog = document.createElement('div');
    dialog.className = 'modal__dialog trader-confirm__dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'trader-confirm-title');
    dialog.setAttribute('aria-describedby', 'trader-confirm-message');

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'modal__close';
    close.dataset.traderConfirmClose = '';
    close.setAttribute('aria-label', i18n.t('mineblock.trader.confirm.cancel'));
    close.textContent = '×';

    this.titleElement = document.createElement('h2');
    this.titleElement.className = 'modal__title';
    this.titleElement.id = 'trader-confirm-title';

    this.messageElement = document.createElement('p');
    this.messageElement.className = 'trader-confirm__message';
    this.messageElement.id = 'trader-confirm-message';

    this.detailsElement = document.createElement('p');
    this.detailsElement.className = 'trader-confirm__details';

    const body = document.createElement('div');
    body.className = 'modal__body';
    body.append(this.messageElement, this.detailsElement);

    this.confirmButton = document.createElement('button');
    this.confirmButton.type = 'button';
    this.confirmButton.className = 'btn btn--primary';
    this.confirmButton.dataset.traderConfirm = '';
    this.confirmButton.textContent = i18n.t('mineblock.trader.confirm.confirm');
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn--ghost';
    cancel.dataset.traderConfirmClose = '';
    cancel.textContent = i18n.t('mineblock.trader.confirm.cancel');

    const actions = document.createElement('div');
    actions.className = 'modal__actions';
    actions.append(this.confirmButton, cancel);

    dialog.append(close, this.titleElement, body, actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) this.close(false);
    });
    overlay.querySelectorAll('[data-trader-confirm-close]').forEach((button) => {
      button.addEventListener('click', () => this.close(false));
    });
    this.confirmButton.addEventListener('click', () => this.close(true));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.root && !this.root.hidden) {
        event.preventDefault();
        this.close(false);
      }
    });

    this.root = overlay;
    return overlay;
  }

  /**
   * Asks the player to confirm one trader transaction.
   *
   * Opening a second confirmation cancels the first one, so a stale promise can never let an
   * older action through after the player moved on.
   *
   * @param {object} options - Content of the dialog.
   * @param {string} options.title - Title of the dialog.
   * @param {string} options.message - Sentence naming the transaction.
   * @param {string} [options.details=''] - Optional second line (price, once-a-day note).
   * @returns {Promise<boolean>} True when the player confirmed, false otherwise.
   */
  open({ title, message, details = '' }) {
    this.ensureMarkup();
    if (!this.root.hidden) this.close(false);

    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.titleElement.textContent = title;
    this.messageElement.textContent = message;
    this.detailsElement.textContent = details;
    this.detailsElement.hidden = details === '';
    this.confirmButton.textContent = i18n.t('mineblock.trader.confirm.confirm');
    this.root.querySelectorAll('[data-trader-confirm-close]').forEach((button) => {
      if (button.classList.contains('modal__close')) {
        button.setAttribute('aria-label', i18n.t('mineblock.trader.confirm.cancel'));
      } else {
        button.textContent = i18n.t('mineblock.trader.confirm.cancel');
      }
    });

    this.root.hidden = false;
    this.root.classList.remove('is-opening');
    void this.root.offsetWidth;
    this.root.classList.add('is-opening');
    this.confirmButton.focus();

    return new Promise((resolve) => {
      this.resolver = resolve;
    });
  }

  /**
   * Closes the dialog and answers the pending `open()`.
   *
   * @param {boolean} confirmed - True when the transaction may proceed.
   * @returns {void}
   */
  close(confirmed = false) {
    if (!this.root || this.root.hidden) {
      this.settle(false);
      return;
    }
    this.root.hidden = true;
    this.root.classList.remove('is-opening');
    this.settle(confirmed);

    const focus = this.returnFocus;
    this.returnFocus = null;
    if (focus && focus.isConnected) focus.focus();
  }

  /**
   * Resolves the promise of the open dialog, if any.
   *
   * @param {boolean} confirmed - Answer to give the caller.
   * @returns {void}
   */
  settle(confirmed) {
    const resolve = this.resolver;
    this.resolver = null;
    resolve?.(confirmed);
  }
}

/** Shared dialog: one confirmation at a time, stacked over the trader. */
export const traderPurchaseModal = new TraderPurchaseModal();

export default traderPurchaseModal;

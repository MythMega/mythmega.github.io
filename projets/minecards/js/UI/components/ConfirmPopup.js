/**
 * ConfirmPopup - The one generic confirmation dialog of the shell.
 *
 * Reference: `css/components/modal.css` (the styles it reuses), `js/app.js` (the inventory items
 * that ask before spending something) and `js/UI/components/SlotPurchaseModal.js` (the same
 * "own markup, built lazily" approach).
 *
 * It exists because spending an item is irreversible: an Ender Pearl becomes an Ender Eye, a Golden
 * Pickaxe becomes an extra Mine Pick, and neither can be taken back. The dialog says what the click
 * does, then waits for a second one.
 *
 * The markup is built on first use and appended to `<body>`, so a screen does not have to own it,
 * and only one confirmation is ever open.
 */

import i18n from '../../utils/I18n.js';

export class ConfirmPopup {
  constructor() {
    /** @type {HTMLElement|null} Overlay of the dialog. */
    this.root = null;
    /** @type {HTMLElement|null} Line explaining what the click does. */
    this.messageElement = null;
    /** @type {HTMLElement|null} Title of the dialog. */
    this.titleElement = null;
    /** @type {HTMLButtonElement|null} Confirm button. */
    this.confirmButton = null;
    /** @type {(() => unknown)|null} Callback run on the confirmation. */
    this.onConfirm = null;
    /** @type {boolean} True while the confirmed action is running. */
    this.isBusy = false;
  }

  /**
   * Builds the dialog once, then reuses it.
   *
   * @returns {HTMLElement} The overlay.
   */
  ensureMarkup() {
    if (this.root) return this.root;

    const overlay = document.createElement('div');
    overlay.className = 'modal';
    overlay.dataset.confirmPopup = '';
    overlay.hidden = true;

    const dialog = document.createElement('div');
    dialog.className = 'modal__dialog';
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'confirm-popup-title');
    dialog.setAttribute('aria-describedby', 'confirm-popup-message');

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'modal__close';
    close.dataset.confirmPopupClose = '';
    close.setAttribute('aria-label', '×');
    close.textContent = '×';

    const title = document.createElement('h2');
    title.className = 'modal__title';
    title.id = 'confirm-popup-title';

    const body = document.createElement('div');
    body.className = 'modal__body';
    this.messageElement = document.createElement('p');
    this.messageElement.className = 'modal__text';
    this.messageElement.id = 'confirm-popup-message';
    body.appendChild(this.messageElement);

    const actions = document.createElement('div');
    actions.className = 'modal__actions';
    this.confirmButton = document.createElement('button');
    this.confirmButton.type = 'button';
    this.confirmButton.className = 'btn btn--primary';
    this.confirmButton.dataset.confirmPopupConfirm = '';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn--ghost';
    cancel.dataset.confirmPopupClose = '';
    cancel.textContent = i18n.t('inventory.cancel');
    actions.append(this.confirmButton, cancel);

    dialog.append(close, title, body, actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) this.close();
    });
    overlay.querySelectorAll('[data-confirm-popup-close]').forEach((button) => {
      button.addEventListener('click', () => this.close());
    });
    this.confirmButton.addEventListener('click', () => void this.confirm());
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.root && !this.root.hidden) this.close();
    });

    this.root = overlay;
    this.titleElement = title;
    return overlay;
  }

  /**
   * Opens the dialog on one question.
   *
   * @param {object} options - Open options.
   * @param {string} options.titleKey - Translation key of the title.
   * @param {string} options.messageKey - Translation key of the explanation.
   * @param {object} [options.params={}] - Interpolation parameters of both keys.
   * @param {string} [options.confirmKey='inventory.use'] - Translation key of the confirm button.
   * @param {(() => unknown)|null} [options.onConfirm=null] - Run once the player confirms.
   * @returns {void}
   */
  open({ titleKey, messageKey, params = {}, confirmKey = 'inventory.use', onConfirm = null }) {
    this.ensureMarkup();
    this.onConfirm = typeof onConfirm === 'function' ? onConfirm : null;
    this.isBusy = false;
    this.titleElement.textContent = i18n.t(titleKey);
    this.messageElement.textContent = i18n.t(messageKey, params);
    this.confirmButton.textContent = i18n.t(confirmKey);
    this.confirmButton.disabled = false;
    this.root.hidden = false;
    this.confirmButton.focus();
  }

  /**
   * Closes the dialog without running its action.
   *
   * @returns {void}
   */
  close() {
    if (!this.root || this.root.hidden) return;
    this.root.hidden = true;
    this.onConfirm = null;
    this.isBusy = false;
    this.confirmButton.disabled = false;
  }

  /**
   * Runs the confirmed action, then closes the dialog.
   *
   * @returns {Promise<void>} Resolves once the action finished.
   */
  async confirm() {
    if (this.isBusy) return;
    const action = this.onConfirm;
    if (!action) {
      this.close();
      return;
    }
    this.isBusy = true;
    this.confirmButton.disabled = true;
    try {
      await action();
    } finally {
      this.isBusy = false;
      this.close();
    }
  }
}

/** Shared dialog: one confirmation at a time, on top of whatever screen asked for it. */
export const confirmPopup = new ConfirmPopup();

export default confirmPopup;

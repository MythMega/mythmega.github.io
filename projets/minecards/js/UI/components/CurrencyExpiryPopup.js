/**
 * CurrencyExpiryPopup - What became of the currencies of the Illager Shop that expired.
 *
 * Reference: `js/business/IllagerShopManager.js` (`convertExpired`), `css/components/modal.css`
 * (the dialog shell and this popup's block) and `SetAnnouncementPopup` (the same global-popup
 * contract: appended to `<body>`, created on the first announcement, `show()` resolving once the
 * player dismissed it).
 *
 * A currency has a last usable day: the morning after it, every remaining unit is multiplied by its
 * `ConversionRate` and credited as Sparks. That conversion is silent by nature (the player was not
 * there when it ran), so this dialog is the only place the player learns where their balance went:
 * the name of the currency, how much of it they had and how many Sparks it became.
 *
 * Several currencies can expire at once (a long absence): they are all listed in the SAME dialog,
 * one row each, with their texture.
 */

import i18n from '../../utils/I18n.js';

export class CurrencyExpiryPopup {
  constructor() {
    /** @type {HTMLElement|null} Overlay, created on the first announcement. */
    this.root = null;
    /** @type {HTMLButtonElement|null} Close button (the one that takes the focus). */
    this.closeButton = null;
    /** @type {boolean} True while a dialog is on screen. */
    this.open = false;
    /** @type {Element|null} Element focused before the dialog opened. */
    this.previousFocus = null;
    /** @type {(() => void)|null} Resolver of the promise returned by `show()`. */
    this.resolveDrained = null;
    /** @type {(event: KeyboardEvent) => void} Escape handler, bound once. */
    this.handleKeyDown = (event) => {
      if (event.key === 'Escape' && this.open) {
        event.preventDefault();
        this.close();
      }
    };
  }

  /**
   * Shows the conversion of the expired currencies, and resolves once it is dismissed.
   *
   * An empty list is not a dialog: the promise resolves at once, so the caller can chain the
   * announcement of the next popup without a special case.
   *
   * @param {Array<{id: string, name: string, texture: string, amount: number, sparks: number}>} entries
   *   What `IllagerShopManager.convertExpired()` returned.
   * @returns {Promise<void>} Resolves once the player closed the dialog (or immediately when empty).
   */
  show(entries) {
    const list = Array.isArray(entries) ? entries.filter((entry) => entry && entry.sparks > 0) : [];
    if (list.length === 0) return Promise.resolve();

    this.ensureMarkup();
    this.render(list);
    this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.root.hidden = false;
    this.open = true;
    document.addEventListener('keydown', this.handleKeyDown);
    this.closeButton?.focus();

    const drained = new Promise((resolve) => {
      this.resolveDrained = resolve;
    });
    return drained;
  }

  /**
   * Closes the dialog and resolves the promise of `show()`.
   *
   * @returns {void}
   */
  close() {
    if (!this.open) return;
    this.open = false;
    document.removeEventListener('keydown', this.handleKeyDown);
    this.root.hidden = true;
    const previous = this.previousFocus;
    this.previousFocus = null;
    if (previous && previous.isConnected && typeof previous.focus === 'function') previous.focus();
    const resolve = this.resolveDrained;
    this.resolveDrained = null;
    if (resolve) resolve();
  }

  /**
   * Drops the open dialog without leaving a pending promise behind (account reset, imported save).
   *
   * @returns {void}
   */
  clear() {
    if (!this.open) return;
    this.close();
  }

  /**
   * Creates the shell of the dialog once.
   *
   * `hidden` is toggled rather than the element being removed, so `UiSounds` keeps observing one
   * modal and plays the usual open/close sounds.
   *
   * @returns {void}
   */
  ensureMarkup() {
    if (this.root) return;

    const root = document.createElement('div');
    root.className = 'modal currency-expiry';
    root.hidden = true;
    root.addEventListener('click', (event) => {
      if (event.target === root) this.close();
    });

    const dialog = document.createElement('div');
    dialog.className = 'modal__dialog currency-expiry__dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'currency-expiry-title');

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'modal__close';
    closeButton.textContent = '×';
    closeButton.addEventListener('click', () => this.close());

    const title = document.createElement('h2');
    title.className = 'modal__title currency-expiry__title';
    title.id = 'currency-expiry-title';
    title.dataset.currencyExpiryTitle = '';

    const list = document.createElement('ul');
    list.className = 'currency-expiry__list';
    list.dataset.currencyExpiryList = '';

    const actions = document.createElement('div');
    actions.className = 'modal__actions';
    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    confirmButton.className = 'btn btn--primary';
    confirmButton.dataset.currencyExpiryClose = '';
    confirmButton.addEventListener('click', () => this.close());
    actions.appendChild(confirmButton);

    dialog.append(closeButton, title, list, actions);
    root.appendChild(dialog);
    document.body.appendChild(root);

    this.root = root;
    this.closeButton = closeButton;
  }

  /**
   * Writes the converted currencies into the dialog.
   *
   * @param {Array<object>} entries - Converted currencies.
   * @returns {void}
   */
  render(entries) {
    if (!this.root) return;

    this.root.querySelector('[data-currency-expiry-title]').textContent =
      i18n.t('illager.expired.title');

    const confirmButton = this.root.querySelector('[data-currency-expiry-close]');
    confirmButton.textContent = i18n.t('illager.expired.close');
    confirmButton.setAttribute('aria-label', i18n.t('illager.expired.close'));
    this.closeButton.setAttribute('aria-label', i18n.t('illager.expired.dismiss'));

    const list = this.root.querySelector('[data-currency-expiry-list]');
    list.textContent = '';
    entries.forEach((entry) => {
      const item = document.createElement('li');
      item.className = 'currency-expiry__item';

      const texture = document.createElement('img');
      texture.className = 'currency-expiry__texture';
      texture.alt = '';
      texture.decoding = 'async';
      if (entry.texture) {
        // A currency texture is written like an asset path of the game (see
        // `IllagerShopManager.normalizeCurrency`), so it is resolved like every other image.
        texture.src = i18n.resolveImagePath(entry.texture);
        texture.addEventListener('error', () => {
          texture.hidden = true;
        });
      } else {
        texture.hidden = true;
      }

      const message = document.createElement('p');
      message.className = 'currency-expiry__message';
      message.textContent = i18n.t('illager.expired.message', {
        currency: entry.name || entry.id,
        amount: entry.amount,
        sparks: entry.sparks,
      });

      item.append(texture, message);
      list.appendChild(item);
    });
  }
}

/** Shared instance used by the application bootstrap. */
export const currencyExpiryPopup = new CurrencyExpiryPopup();

export default currencyExpiryPopup;

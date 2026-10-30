/**
 * SetAnnouncementPopup - Announces the extensions that were just released.
 *
 * Built on the shared `.modal` styles and appended to `<body>`, so it can open over any view. Several
 * sets can be announced at once: they are queued and shown one dialog at a time, and
 * `announcePending()` resolves once the last one is closed (the application waits for it before
 * presenting an automatic gift).
 */

import i18n from '../../utils/I18n.js';
import setAnnouncementManager from '../../business/SetAnnouncementManager.js';

export class SetAnnouncementPopup {
  constructor() {
    /** @type {HTMLElement|null} Overlay, created on the first announcement. */
    this.root = null;
    /** @type {HTMLButtonElement|null} Dismiss button. */
    this.closeButton = null;
    /** @type {Array<object>} Sets waiting to be shown. */
    this.queue = [];
    /** @type {object|null} Set currently displayed. */
    this.current = null;
    /** @type {Element|null} Element focused before the dialog opened. */
    this.previousFocus = null;
    /** @type {Promise<void>|null} Resolved when the last dialog of the queue closes. */
    this.drained = null;
    /** @type {(() => void)|null} Resolver of `drained`. */
    this.resolveDrained = null;
    /** @type {(event: KeyboardEvent) => void} Escape handler, bound once. */
    this.handleKeyDown = (event) => {
      if (event.key === 'Escape' && this.current) {
        event.preventDefault();
        this.close();
      }
    };
  }

  /**
   * Shows every newly released set that was never announced on this account.
   *
   * The keys are recorded BEFORE the first dialog opens, so a reload in the middle of the queue
   * does not announce the same set twice.
   *
   * @returns {Promise<void>} Resolves once the last announced set was dismissed.
   * @throws {Error} When the extension catalogue cannot be read.
   */
  async announcePending() {
    const pending = await setAnnouncementManager.listPending();
    if (pending.length === 0) return;
    await setAnnouncementManager.markAnnounced(pending);
    await this.show(pending);
  }

  /**
   * Queues sets and returns a promise that resolves when they have all been dismissed.
   *
   * @param {Array<object>} entries - Set descriptions returned by `BoosterManager.listBoosterSets`.
   * @returns {Promise<void>} Resolves once the queue is empty.
   */
  show(entries) {
    const list = Array.isArray(entries) ? entries : [];
    if (list.length === 0) return Promise.resolve();

    this.queue.push(...list);
    if (!this.drained) {
      this.drained = new Promise((resolve) => {
        this.resolveDrained = resolve;
      });
    }
    if (!this.current) this.showNext();
    return this.drained;
  }

  /**
   * Displays the next queued set, or hides the dialog when the queue is empty.
   *
   * @returns {void}
   */
  showNext() {
    this.current = this.queue.shift() ?? null;
    if (!this.current) {
      this.hide();
      this.finishQueue();
      return;
    }

    this.ensureMarkup();
    if (this.root.hidden) this.previousFocus = document.activeElement;
    this.render(this.current);
    this.root.hidden = false;
    document.addEventListener('keydown', this.handleKeyDown);
    this.closeButton?.focus();
  }

  /**
   * Closes the open announcement and moves on to the next one.
   *
   * @returns {void}
   */
  close() {
    if (!this.current) return;
    this.current = null;
    document.removeEventListener('keydown', this.handleKeyDown);
    this.showNext();
  }

  /**
   * Drops the queue (full reset, imported save) without leaving a pending promise behind.
   *
   * @returns {void}
   */
  clear() {
    this.queue = [];
    this.current = null;
    document.removeEventListener('keydown', this.handleKeyDown);
    this.hide();
    this.finishQueue();
  }

  /**
   * Hides the overlay and gives the focus back to where it was.
   *
   * @returns {void}
   */
  hide() {
    if (this.root) this.root.hidden = true;
    if (this.previousFocus instanceof HTMLElement && this.previousFocus.isConnected) {
      this.previousFocus.focus();
    }
    this.previousFocus = null;
  }

  /**
   * Resolves the promise returned by `show()`.
   *
   * @returns {void}
   */
  finishQueue() {
    const resolve = this.resolveDrained;
    this.resolveDrained = null;
    this.drained = null;
    if (resolve) resolve();
  }

  /**
   * Creates the overlay once.
   *
   * `hidden` is toggled rather than the element being removed, so `UiSounds` keeps observing one
   * modal and plays the usual open/close sounds.
   *
   * @returns {void}
   */
  ensureMarkup() {
    if (this.root) return;

    const root = document.createElement('div');
    root.className = 'modal set-announcement';
    root.hidden = true;
    root.addEventListener('click', (event) => {
      if (event.target === root) this.close();
    });

    const dialog = document.createElement('div');
    dialog.className = 'modal__dialog set-announcement__dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'set-announcement-title');

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'modal__close';
    closeButton.textContent = '×';
    closeButton.addEventListener('click', () => this.close());

    const badge = document.createElement('p');
    badge.className = 'set-announcement__badge';
    badge.dataset.setAnnouncementBadge = '';

    const booster = document.createElement('img');
    booster.className = 'set-announcement__booster';
    booster.dataset.setAnnouncementBooster = '';
    booster.alt = '';
    booster.decoding = 'async';
    booster.hidden = true;

    const title = document.createElement('h2');
    title.className = 'modal__title set-announcement__title';
    title.id = 'set-announcement-title';
    title.dataset.setAnnouncementTitle = '';

    const date = document.createElement('p');
    date.className = 'set-announcement__date';
    date.dataset.setAnnouncementDate = '';

    const message = document.createElement('p');
    message.className = 'set-announcement__message';
    message.dataset.setAnnouncementMessage = '';

    const actions = document.createElement('div');
    actions.className = 'modal__actions';

    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    confirmButton.className = 'btn btn--primary';
    confirmButton.dataset.setAnnouncementClose = '';
    confirmButton.addEventListener('click', () => this.close());

    actions.appendChild(confirmButton);
    dialog.append(closeButton, badge, booster, title, date, message, actions);
    root.appendChild(dialog);
    document.body.appendChild(root);

    this.root = root;
    this.closeButton = closeButton;
  }

  /**
   * Writes one set into the dialog.
   *
   * @param {object} set - `{ setId, name, texture, releaseDate }`.
   * @returns {void}
   */
  render(set) {
    if (!this.root) return;

    this.root.querySelector('[data-set-announcement-badge]').textContent =
      i18n.t('setannounce.badge');
    this.root.querySelector('[data-set-announcement-title]').textContent = set.name ?? set.setId;
    this.root.querySelector('[data-set-announcement-message]').textContent =
      i18n.t('setannounce.message');

    const confirmButton = this.root.querySelector('[data-set-announcement-close]');
    confirmButton.textContent = i18n.t('setannounce.close');
    confirmButton.setAttribute('aria-label', i18n.t('setannounce.close'));
    this.closeButton.setAttribute('aria-label', i18n.t('setannounce.dismiss'));

    const booster = this.root.querySelector('[data-set-announcement-booster]');
    booster.hidden = !set.texture;
    if (set.texture) {
      booster.src = set.texture;
      booster.alt = set.name ?? '';
    }

    const date = this.root.querySelector('[data-set-announcement-date]');
    const formatted = i18n.formatUtcDay(set.releaseDate);
    date.hidden = formatted === '';
    date.textContent = formatted ? i18n.t('setannounce.release', { date: formatted }) : '';
  }

}

/** Shared instance used by the application bootstrap. */
export const setAnnouncementPopup = new SetAnnouncementPopup();

export default setAnnouncementPopup;

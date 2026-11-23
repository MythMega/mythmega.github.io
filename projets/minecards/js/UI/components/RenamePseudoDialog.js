/**
 * RenamePseudoDialog - Asks for another pseudo when a publication is refused.
 *
 * Reference: `js/business/SocialManager.js` (`publishOwnCard`, `isPseudoRefusal`),
 * `js/business/ProfileManager.js` (the only writer of the display name, and the owner of the
 * reserved-name rule) and `js/business/ReservedNamesManager.js` (`settings/blockednames.json`).
 *
 * WHY IT IS GLOBAL
 *   A card is published from TWO screens: "Update My Account" on the Social page and the publish
 *   button under the trainer card on the Profile page. A dialog living inside one of them would be
 *   invisible from the other one, because a `.view` section is hidden when it is not the active
 *   page. This dialog therefore lives at the end of `main`, outside every view, and both screens
 *   open the same instance through the `renamePseudoDialog` singleton.
 *
 * CONTRACT
 *   `open({ reason, onConfirm, onCancel })` shows the dialog with one of the two explanations
 *   (`taken` for a pseudo another account already owns, `reserved` for a word of
 *   `settings/blockednames.json`) and prefills the field with the current pseudo.
 *
 *   "Réessayer" stores the typed pseudo through `ProfileManager.setIdentity()`, which enforces the
 *   reserved-name rule, then calls `onConfirm`, where the caller re-sends the card. A retry refused
 *   again keeps the dialog open with a one-line message, so the player picks another name without
 *   leaving the flow. The pseudo typed here is the one the profile keeps: the next publication
 *   therefore shows the same name on the card as the one displayed by the game.
 *
 *   "Annuler" (button, cross or Escape) closes the dialog and calls `onCancel`: the card is simply
 *   not sent, and nothing of the profile is changed.
 *
 * The inline messages are deliberately SHORT ("ce pseudo est réservé, veuillez mettre un autre
 * pseudo"): they sit under the field, not in a second dialog.
 */

import i18n from '../../utils/I18n.js';
import profileManager, {
  PROFILE_ERROR_CODES,
  ProfileError,
  getProfileErrorMessageKey,
} from '../../business/ProfileManager.js';
import socialManager, {
  SOCIAL_ERROR_CODES,
  SocialError,
  getSocialErrorMessageKey,
} from '../../business/SocialManager.js';

export class RenamePseudoDialog {
  /**
   * @param {Document|HTMLElement} [rootElement=document] - Where the markup is looked up. Kept
   *   injectable so the dialog can be built from a fragment in a test page.
   */
  constructor(rootElement = typeof document === 'undefined' ? null : document) {
    this.root = rootElement;
    /** @type {HTMLElement|null} */
    this.modal = null;
    /** @type {HTMLElement|null} */
    this.reasonElement = null;
    /** @type {HTMLFormElement|null} */
    this.form = null;
    /** @type {HTMLInputElement|null} */
    this.input = null;
    /** @type {HTMLElement|null} */
    this.errorElement = null;
    /** @type {HTMLButtonElement|null} */
    this.submitButton = null;
    /** @type {HTMLElement[]} */
    this.cancelButtons = [];
    /** @type {HTMLElement[]} */
    this.closeButtons = [];
    this.isBound = false;
    this.isBusy = false;
    /** @type {(() => Promise<unknown>|unknown)|null} */
    this.onConfirm = null;
    /** @type {(() => void)|null} */
    this.onCancel = null;
    /** @type {'taken'|'reserved'} */
    this.reason = 'taken';
  }

  /**
   * Reads the markup and attaches the listeners, once per page.
   *
   * The dialog is only ever opened by a refused publication, so it binds on the first `open()`
   * instead of costing a lookup at boot.
   *
   * @returns {boolean} True when the markup is available.
   * @throws {Error} When the markup is incomplete.
   */
  bind() {
    if (this.isBound) return true;
    if (!this.root || typeof this.root.querySelector !== 'function') return false;

    this.modal = this.root.querySelector('[data-rename-pseudo-modal]');
    if (!this.modal) return false;

    const query = (selector) => this.modal.querySelector(selector);
    this.reasonElement = query('[data-rename-pseudo-reason]');
    this.form = query('[data-rename-pseudo-form]');
    this.input = query('[data-rename-pseudo-input]');
    this.errorElement = query('[data-rename-pseudo-error]');
    this.submitButton = query('[data-rename-pseudo-submit]');
    this.cancelButtons = [...this.modal.querySelectorAll('[data-rename-pseudo-cancel]')];
    this.closeButtons = [...this.modal.querySelectorAll('[data-rename-pseudo-close]')];

    const missing = [
      ['[data-rename-pseudo-reason]', this.reasonElement],
      ['[data-rename-pseudo-form]', this.form],
      ['[data-rename-pseudo-input]', this.input],
      ['[data-rename-pseudo-error]', this.errorElement],
      ['[data-rename-pseudo-submit]', this.submitButton],
    ]
      .filter(([, element]) => !element)
      .map(([selector]) => selector);
    if (missing.length > 0) {
      throw new Error('RenamePseudoDialog markup is incomplete, missing: ' + missing.join(', ') + '.');
    }

    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.submit();
    });
    [...this.cancelButtons, ...this.closeButtons].forEach((button) => {
      button.addEventListener('click', () => this.close());
    });
    this.modal.addEventListener('click', (event) => {
      if (event.target === this.modal) this.close();
    });
    this.input.addEventListener('input', () => this.setError(null));
    this.root.addEventListener?.('keydown', (event) => {
      if (event.key !== 'Escape' || !this.modal || this.modal.hidden) return;
      this.close();
    });

    this.isBound = true;
    return true;
  }

  /**
   * Opens the dialog for one refusal.
   *
   * @param {object} [options] - Opening options.
   * @param {'taken'|'reserved'} [options.reason='taken'] - Why the publication was refused.
   * @param {(() => Promise<unknown>|unknown)|null} [options.onConfirm=null] - Called once the new
   *   pseudo is stored: the caller re-sends the card there.
   * @param {(() => void)|null} [options.onCancel=null] - Called when the dialog is closed without
   *   a successful retry.
   * @returns {Promise<void>} Resolves once the dialog is on screen.
   */
  async open({ reason = 'taken', onConfirm = null, onCancel = null } = {}) {
    if (!this.bind()) return;

    this.reason = reason === 'reserved' ? 'reserved' : 'taken';
    this.onConfirm = typeof onConfirm === 'function' ? onConfirm : null;
    this.onCancel = typeof onCancel === 'function' ? onCancel : null;
    this.setBusy(false);
    this.setError(null);
    if (this.reasonElement) {
      this.reasonElement.textContent = i18n.t(
        this.reason === 'reserved' ? 'social.rename.reason.reserved' : 'social.rename.reason.taken'
      );
    }

    // The field starts on the current pseudo: the player usually only needs to change one word,
    // and seeing the refused name is what tells them which account they are fighting for.
    this.input.value = '';
    this.modal.hidden = false;
    try {
      const profile = await profileManager.getProfile();
      this.input.value = typeof profile?.name === 'string' ? profile.name : '';
    } catch (error) {
      console.warn('[RenamePseudoDialog] The current pseudo could not be read.', error);
    }
    this.input.focus();
    this.input.select();
  }

  /**
   * Stores the typed pseudo, then lets the caller re-send the card.
   *
   * @returns {Promise<void>} Resolves once the attempt finished (successfully or not).
   */
  async submit() {
    if (this.isBusy || !this.isBound || !this.input) return;
    const name = this.input.value.trim();
    if (name === '') {
      this.setError('social.rename.required');
      this.input.focus();
      return;
    }

    this.setBusy(true);
    this.setError(null);
    try {
      // The reserved-name rule lives in the profile manager: this dialog must not re-implement it,
      // otherwise a change of `settings/blockednames.json` would only reach one of the two screens.
      await profileManager.setIdentity({ name });
      if (this.onConfirm) await this.onConfirm();
      this.finish();
    } catch (error) {
      this.setError(this.resolveErrorKey(error));
    } finally {
      this.setBusy(false);
    }
  }

  /**
   * Maps a failure of the retry to the one-line message shown under the field.
   *
   * @param {unknown} error - Error thrown by the profile write or by the publication.
   * @returns {string} An i18n key.
   */
  resolveErrorKey(error) {
    if (error instanceof ProfileError) {
      return error.code === PROFILE_ERROR_CODES.RESERVED_NAME
        ? 'social.rename.reserved'
        : getProfileErrorMessageKey(error);
    }
    if (error instanceof SocialError) {
      return error.code === SOCIAL_ERROR_CODES.USERNAME_TAKEN
        ? 'social.rename.taken'
        : getSocialErrorMessageKey(error);
    }
    console.error('[RenamePseudoDialog] The publication could not be retried.', error);
    return 'social.rename.failed';
  }

  /**
   * Closes the dialog after a successful retry, without calling `onCancel`.
   *
   * @returns {void}
   */
  finish() {
    if (!this.modal) return;
    this.modal.hidden = true;
    this.setError(null);
    this.onConfirm = null;
    this.onCancel = null;
  }

  /**
   * Closes the dialog and reports the abandoned publication.
   *
   * @returns {void}
   */
  close() {
    if (!this.modal || this.modal.hidden) return;
    const cancel = this.onCancel;
    this.finish();
    if (cancel) cancel();
  }

  /**
   * Writes (or clears) the one-line message under the field.
   *
   * @param {string|null} key - i18n key, or null to clear it.
   * @returns {void}
   */
  setError(key) {
    if (!this.errorElement) return;
    if (!key) {
      this.errorElement.hidden = true;
      this.errorElement.textContent = '';
      this.errorElement.removeAttribute('data-tone');
      return;
    }
    this.errorElement.hidden = false;
    this.errorElement.textContent = i18n.t(key);
    this.errorElement.dataset.tone = 'error';
  }

  /**
   * Freezes the dialog while a retry runs: one publication at a time.
   *
   * @param {boolean} value - True while the request runs.
   * @returns {void}
   */
  setBusy(value) {
    this.isBusy = Boolean(value);
    if (this.submitButton) this.submitButton.disabled = this.isBusy;
    if (this.form) this.form.toggleAttribute('aria-busy', this.isBusy);
  }
}

/** Shared instance: one dialog for every screen that publishes a trainer card. */
export const renamePseudoDialog = new RenamePseudoDialog();

export default renamePseudoDialog;

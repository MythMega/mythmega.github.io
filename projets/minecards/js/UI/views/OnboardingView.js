/**
 * OnboardingView - First-launch screen: create a local save or import a `.save` file.
 *
 * Reference: `.docs/main.md` section 3.A and `.docs/steps/1.md` point 8.
 *
 * The view is displayed only when `AccountManager.hasAccount()` is false. While it is shown,
 * the application header and the bottom navigation stay hidden: the body carries the
 * `is-onboarding` class, which `css/base.css` uses to hide both bars.
 *
 * Import (step 6): `SaveFile.importFromFile()` decodes, validates and writes the whole save
 * (UUID included), then reloads the page. No confirmation is asked here: without an account
 * there is nothing to lose. The settings view, which replaces an existing account, asks for one.
 */

import eventBus, { EVENTS } from '../../utils/EventBus.js';
import i18n from '../../utils/I18n.js';
import accountManager from '../../business/AccountManager.js';
import { saveFile, getSaveErrorMessageKey, SAVE_EXTENSION } from '../../classes/SaveFile.js';

/** Name of the view section, matching `data-view="onboarding"` in `index.html`. */
export const ONBOARDING_VIEW_NAME = 'onboarding';

/** Body class hiding the header and the bottom navigation during onboarding. */
export const BODY_ONBOARDING_CLASS = 'is-onboarding';

export class OnboardingView {
  /**
   * @param {HTMLElement} rootElement - The onboarding `<section>`.
   * @param {object} [options] - View options.
   * @param {() => (void|Promise<void>)} [options.onAccountCreated=null] - Called after a
   *   successful account creation so the application can switch to its main UI.
   */
  constructor(rootElement, { onAccountCreated = null } = {}) {
    if (!rootElement || typeof rootElement.querySelector !== 'function') {
      throw new TypeError('OnboardingView requires the onboarding section element.');
    }

    this.root = rootElement;
    this.onAccountCreated = onAccountCreated;

    this.createButton = this.root.querySelector('[data-onboarding-action="create"]');
    this.importButton = this.root.querySelector('[data-onboarding-action="import"]');
    this.fileInput = this.root.querySelector('[data-onboarding-file]');
    this.languageContainer = this.root.querySelector('[data-onboarding-languages]');
    this.feedbackElement = this.root.querySelector('[data-onboarding-feedback]');

    this.assertMarkup();

    /** @type {Map<string, HTMLElement>} Language buttons, keyed by language code. */
    this.languageButtons = new Map();
    /** @type {boolean} Guards against double taps while an account is being created. */
    this.isBusy = false;
    /** @type {string|null} Last feedback i18n key, re-translated on `LANG_CHANGED`. */
    this.feedbackKey = null;
    /** @type {'info'|'error'} Tone of the current feedback message. */
    this.feedbackTone = 'info';
    /** @type {Function|null} Unsubscribe handle for `LANG_CHANGED`. */
    this.unsubscribeLangChanged = null;
    /** @type {Array<{element: HTMLElement, type: string, handler: EventListener}>} Registered
     * listeners, tracked so `destroy()` can remove them (no leak after a full reset). */
    this.bindings = [];
  }

  /**
   * Verifies that the markup matches the contract expected by this view.
   *
   * @returns {void}
   * @throws {Error} When a required element is missing from `index.html`.
   */
  assertMarkup() {
    const missing = [
      ['data-onboarding-action="create"', this.createButton],
      ['data-onboarding-action="import"', this.importButton],
      ['data-onboarding-file', this.fileInput],
      ['data-onboarding-languages', this.languageContainer],
      ['data-onboarding-feedback', this.feedbackElement],
    ]
      .filter(([, element]) => !element)
      .map(([selector]) => selector);

    if (missing.length > 0) {
      throw new Error(`OnboardingView markup is incomplete, missing: ${missing.join(', ')}.`);
    }
  }

  /**
   * Builds the language selector and binds every interaction.
   *
   * @returns {Promise<void>} Resolves once the selector is rendered.
   * @throws {Error} When the language list cannot be loaded.
   */
  async init() {
    await this.renderLanguageSelector();
    this.bindEvents();
    this.unsubscribeLangChanged = eventBus.on(EVENTS.LANG_CHANGED, () => this.refreshFeedback());
    this.syncLanguageButtons();
  }

  /**
   * Renders one button per language declared in `config.json`.
   *
   * @returns {Promise<void>} Resolves once the buttons exist.
   * @throws {Error} When `config.json` cannot be loaded.
   */
  async renderLanguageSelector() {
    const options = await i18n.getLanguageOptions();
    this.languageContainer.textContent = '';
    this.languageButtons.clear();

    options.forEach(({ code, label }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'lang-switch__option';
      button.dataset.lang = code;
      button.textContent = label;
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => this.handleLanguageChange(code));
      this.languageContainer.appendChild(button);
      this.languageButtons.set(code, button);
    });
  }

  /**
   * Reflects the active language on the selector buttons.
   *
   * @returns {void}
   */
  syncLanguageButtons() {
    const current = i18n.getLang();
    this.languageButtons.forEach((button, code) => {
      const isActive = code === current;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  }

  /**
   * Attaches every DOM listener (registration is tracked for `destroy()`).
   *
   * @returns {void}
   */
  bindEvents() {
    this.listen(this.createButton, 'click', () => this.handleCreate());
    this.listen(this.importButton, 'click', () => this.handleImportClick());
    this.listen(this.fileInput, 'change', (event) => this.handleFileSelected(event));
  }

  /**
   * Registers a listener and remembers it so `destroy()` can remove it.
   *
   * @param {HTMLElement} element - Target element.
   * @param {string} type - Event type.
   * @param {EventListener} handler - Listener.
   * @returns {void}
   */
  listen(element, type, handler) {
    element.addEventListener(type, handler);
    this.bindings.push({ element, type, handler });
  }

  /**
   * Displays the onboarding screen and hides the app chrome (header and bottom navigation).
   *
   * @returns {void}
   */
  show() {
    console.info('[OnboardingView] Showing the onboarding screen.');
    document.body.classList.add(BODY_ONBOARDING_CLASS);
    this.root.classList.add('is-active');
    this.root.setAttribute('aria-hidden', 'false');
  }

  /**
   * Hides the onboarding screen and restores the app chrome.
   *
   * @returns {void}
   */
  hide() {
    document.body.classList.remove(BODY_ONBOARDING_CLASS);
    this.root.classList.remove('is-active');
    this.root.setAttribute('aria-hidden', 'true');
  }

  /**
   * Removes the listeners registered by the view (used by a full reset).
   *
   * @returns {void}
   */
  destroy() {
    this.bindings.forEach(({ element, type, handler }) => element.removeEventListener(type, handler));
    this.bindings = [];
    if (typeof this.unsubscribeLangChanged === 'function') {
      this.unsubscribeLangChanged();
      this.unsubscribeLangChanged = null;
    }
  }

  /**
   * Switches the language at runtime (no reload) and keeps the selector in sync.
   *
   * The language is only persisted in `user_state["settings"]` once the account exists;
   * `AccountManager.createAccount()` reads the language applied here.
   *
   * @param {string} code - Language code of the clicked button.
   * @returns {Promise<void>} Resolves once the language has been applied.
   */
  async handleLanguageChange(code) {
    if (this.isBusy || code === i18n.getLang()) return;

    this.setBusy(true);
    try {
      await i18n.setLang(code);
    } catch (error) {
      console.error('[OnboardingView] Unable to switch the language.', error);
      this.setFeedback('error.unexpected', 'error');
    } finally {
      this.setBusy(false);
      this.syncLanguageButtons();
    }
  }

  /**
   * Creates the local save, then hands control back to the application.
   *
   * @returns {Promise<void>} Resolves when the flow finished (success or failure).
   */
  async handleCreate() {
    if (this.isBusy) return;

    this.setFeedback(null);
    this.setBusy(true, 'onboarding.creating');

    try {
      await accountManager.createAccount();
      this.setFeedback(null);
      if (typeof this.onAccountCreated === 'function') {
        await this.onAccountCreated();
      }
    } catch (error) {
      console.error('[OnboardingView] Account creation failed.', error);
      this.setFeedback('onboarding.create.error', 'error');
    } finally {
      this.setBusy(false, 'onboarding.create');
    }
  }

  /**
   * Opens the file picker for a `.save` import.
   *
   * The input value is reset first so picking the same file twice in a row still fires
   * a `change` event.
   *
   * @returns {void}
   */
  handleImportClick() {
    if (this.isBusy) return;
    this.fileInput.value = '';
    this.fileInput.click();
  }

  /**
   * Imports the chosen `.save` file, then restarts the application.
   *
   * `SaveFile.importFromFile()` overwrites the whole database in a single transaction and reloads
   * the page: the restored UUID, settings and quota are only applied by a fresh boot. Nothing is
   * changed when the file is refused (the transaction is aborted).
   *
   * @param {Event} event - `change` event of the file input.
   * @returns {Promise<void>} Resolves only when the import failed (the page reloads otherwise).
   */
  async handleFileSelected(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) {
      this.setFeedback('save.error.noFile', 'info');
      return;
    }

    if (!new RegExp(`${SAVE_EXTENSION.replace('.', '\\.')}$`, 'i').test(file.name)) {
      this.setFeedback('save.error.unsupportedFile', 'error');
      return;
    }

    this.setBusy(true);
    this.setFeedback('settings.save.importing', 'info');
    console.info(`[OnboardingView] Importing "${file.name}"…`);

    try {
      await saveFile.importFromFile(file);
    } catch (error) {
      console.error('[OnboardingView] The save could not be imported.', error);
      this.setFeedback(getSaveErrorMessageKey(error), 'error');
      this.setBusy(false);
    }
  }

  /**
   * Enables or disables the two actions (single source of truth for the busy state).
   *
   * @param {boolean} isBusy - Whether an operation is running.
   * @param {string|null} [createLabelKey=null] - i18n key used as the create button label
   *   while busy (defaults to "onboarding.create").
   * @returns {void}
   */
  setBusy(isBusy, createLabelKey = null) {
    this.isBusy = isBusy;
    [this.createButton, this.importButton].forEach((button) => {
      button.disabled = isBusy;
    });
    this.createButton.textContent = i18n.t(createLabelKey || 'onboarding.create');
    this.root.setAttribute('aria-busy', isBusy ? 'true' : 'false');
  }

  /**
   * Displays an informational or error message under the actions.
   *
   * @param {string|null} key - i18n key, or null to clear the message.
   * @param {'info'|'error'} [tone='info'] - Visual tone, exposed as `data-tone`.
   * @returns {void}
   */
  setFeedback(key, tone = 'info') {
    this.feedbackKey = key;
    this.feedbackTone = key ? tone : 'info';
    this.renderFeedback();
  }

  /**
   * Re-renders the current feedback message (used after a language change).
   *
   * @returns {void}
   */
  refreshFeedback() {
    this.renderFeedback();
  }

  /**
   * Writes the stored feedback key into the DOM.
   *
   * @returns {void}
   */
  renderFeedback() {
    if (!this.feedbackKey) {
      this.feedbackElement.textContent = '';
      this.feedbackElement.removeAttribute('data-tone');
      this.feedbackElement.hidden = true;
      return;
    }
    this.feedbackElement.textContent = i18n.t(this.feedbackKey);
    this.feedbackElement.setAttribute('data-tone', this.feedbackTone);
    this.feedbackElement.hidden = false;
  }
}

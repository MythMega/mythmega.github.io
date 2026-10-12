/**
 * SettingsView - Preferences, account identity, save management and reserved distributions.
 *
 * Reference: `.docs/steps/6.md` point 3 and `.docs/main.md` section 3.G (view 4).
 *
 * Sections:
 *   - language  : FR / EN through `I18n.setLang` (applied live), persisted in `settings`;
 *   - theme     : every theme declared in `settings/config.json`, applied through
 *                 `ThemeManager.applyTheme`, persisted in `settings`;
 *   - sound     : one switch ("Sons") driving `SoundManager.setEnabled`, persisted in `settings`;
 *   - account   : the immutable UUID (read-only) with a copy button;
 *   - save      : export, import (with a confirmation modal, because the current data is
 *                 replaced) and full reset (confirmation modal, UUID included);
 *   - distributions : "check the distributions" (reads the public Google Sheet through
 *                 `GiftManager.checkGifts()`, reports the outcome in an information modal and
 *                 links to the gift history).
 *
 * The modal is shared by the confirmations (import, reset) and by the distribution report: a
 * confirmation shows Cancel + Confirm, an information message only shows a Close button.
 *
 * Both pickers are rendered from `config.json`, so adding a language or a theme never requires a
 * code change here.
 *
 * Consistency note: applying a preference (live switch) and persisting it are two different
 * operations. The switch always wins in the current session; when the write fails the player is
 * warned through the feedback line, and the next startup falls back to the stored value.
 */

import eventBus, { EVENTS } from '../../utils/EventBus.js';
import i18n from '../../utils/I18n.js';
import themeManager from '../../utils/ThemeManager.js';
import soundManager from '../../utils/SoundManager.js';
import accountManager from '../../business/AccountManager.js';
import dateSyncManager from '../../business/DateSyncManager.js';
import { saveFile, getSaveErrorMessageKey, SAVE_EXTENSION } from '../../classes/SaveFile.js';
import giftManager, {
  getGiftErrorMessageKey,
  getGiftIgnoreReasonKey,
  GIFT_TYPES,
} from '../../business/GiftManager.js';
import Toast from '../components/Toast.js';

/** View name, matching `data-view="settings"` in `index.html`. */
export const SETTINGS_VIEW_NAME = 'settings';

export class SettingsView {
  /**
   * @param {HTMLElement} rootElement - The settings `<section>`.
   * @param {object} [options] - View options.
   * @param {(viewName: string) => void} [options.onNavigate=null] - Called when the view asks the
   *   application to switch to another view. Keeps this view decoupled from the router: it never
   *   imports `SpaRouter` itself.
   * @param {() => void} [options.onShowGiftHistory=null] - Called by the "gift history" button. The
   *   gift history is a panel of THIS screen: the application scrolls it into view instead of
   *   switching views (falls back to `onNavigate("gifts")` when not provided).
   */
  constructor(rootElement, { onNavigate = null, onShowGiftHistory = null } = {}) {
    if (!rootElement || typeof rootElement.querySelector !== 'function') {
      throw new TypeError('SettingsView requires the settings section element.');
    }

    this.root = rootElement;
    this.onNavigate = typeof onNavigate === 'function' ? onNavigate : null;
    this.onShowGiftHistory = typeof onShowGiftHistory === 'function' ? onShowGiftHistory : null;

    const query = (selector) => this.root.querySelector(selector);
    this.feedbackElement = query('[data-settings-feedback]');
    this.languageContainer = query('[data-settings-languages]');
    this.themeContainer = query('[data-settings-themes]');
    this.soundToggle = query('[data-settings-sound]');
    this.soundStateElement = query('[data-settings-sound-state]');
    this.uuidElement = query('[data-settings-uuid]');
    this.copyButton = query('[data-settings-copy]');
    this.exportButton = query('[data-settings-export]');
    this.importButton = query('[data-settings-import]');
    this.fileInput = query('[data-settings-file]');
    this.resetButton = query('[data-settings-reset]');
    this.checkGiftsButton = query('[data-settings-check-gifts]');
    this.giftHistoryButton = query('[data-settings-gift-history]');
    this.modal = query('[data-settings-modal]');
    this.modalTitle = query('[data-settings-modal-title]');
    this.modalBody = query('[data-settings-modal-body]');
    this.modalClose = query('[data-settings-modal-close]');
    this.modalCancel = query('[data-settings-modal-cancel]');
    this.modalConfirm = query('[data-settings-modal-confirm]');

    this.assertMarkup();

    /** @type {boolean} True once `init()` bound everything. */
    this.isInitialized = false;
    /** @type {boolean} True when the view is the active one. */
    this.isActive = false;
    /** @type {boolean} True while an export/import/reset runs. */
    this.isBusy = false;
    /** @type {string|null} UUID of the current account (read-only display). */
    this.uuid = null;
    /** @type {{key: string, tone: string, params: object|null}|null} Last feedback message. */
    this.feedback = null;
    /** @type {{mode: 'confirm'|'info', titleKey: string, bodyKey: string|null,
     *   params: object|null, report: object|null, confirmVariant: string,
     *   onConfirm: Function|null}|null} */
    this.pendingModal = null;

    /** @type {Map<string, HTMLButtonElement>} Language buttons, keyed by language code. */
    this.languageButtons = new Map();
    /** @type {Map<string, HTMLButtonElement>} Theme buttons, keyed by theme id. */
    this.themeButtons = new Map();
    /** @type {Array<{target: EventTarget, type: string, handler: EventListener}>} */
    this.bindings = [];
    /** @type {Function[]} */
    this.unsubscribers = [];
  }

  /**
   * Logs with the view prefix.
   *
   * @param {...unknown} args - Values forwarded to `console.info`.
   * @returns {void}
   */
  log(...args) {
    console.info('[SettingsView]', ...args);
  }

  /**
   * Verifies that the markup matches the contract expected by this view.
   *
   * @returns {void}
   * @throws {Error} When a required element is missing from `index.html`.
   */
  assertMarkup() {
    const missing = [
      ['[data-settings-feedback]', this.feedbackElement],
      ['[data-settings-languages]', this.languageContainer],
      ['[data-settings-themes]', this.themeContainer],
      ['[data-settings-sound]', this.soundToggle],
      ['[data-settings-sound-state]', this.soundStateElement],
      ['[data-settings-uuid]', this.uuidElement],
      ['[data-settings-copy]', this.copyButton],
      ['[data-settings-export]', this.exportButton],
      ['[data-settings-import]', this.importButton],
      ['[data-settings-file]', this.fileInput],
      ['[data-settings-reset]', this.resetButton],
      ['[data-settings-check-gifts]', this.checkGiftsButton],
      ['[data-settings-gift-history]', this.giftHistoryButton],
      ['[data-settings-modal]', this.modal],
      ['[data-settings-modal-title]', this.modalTitle],
      ['[data-settings-modal-body]', this.modalBody],
      ['[data-settings-modal-close]', this.modalClose],
      ['[data-settings-modal-cancel]', this.modalCancel],
      ['[data-settings-modal-confirm]', this.modalConfirm],
    ]
      .filter(([, element]) => !element)
      .map(([selector]) => selector);

    if (missing.length > 0) {
      throw new Error(`SettingsView markup is incomplete, missing: ${missing.join(', ')}.`);
    }
  }

  /**
   * Renders both pickers, reads the account and binds every interaction.
   *
   * @returns {Promise<void>} Resolves once the view is interactive.
   * @throws {Error} When `config.json`, the settings or the account cannot be read.
   */
  async init() {
    if (this.isInitialized) return;
    this.isInitialized = true;
    this.log('Initializing…');
    await this.renderLanguageSelector();
    await this.renderThemeSelector();
    this.syncSoundToggle();
    await this.renderAccount();
    this.bindEvents();
    this.subscribeToEvents();
    this.log(`Ready (lang: ${i18n.getLang()}, theme: ${themeManager.getTheme()}).`);
  }

  /**
   * Renders one button per language declared in `config.json`.
   *
   * @returns {Promise<void>} Resolves once the buttons exist.
   * @throws {Error} When the language list cannot be loaded.
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
    this.syncLanguageButtons();
  }

  /**
   * Renders one button per theme declared in `config.json`.
   *
   * The visible label comes from the `labelKey` of each theme descriptor, so a new theme only
   * needs a new translation entry.
   *
   * @returns {Promise<void>} Resolves once the buttons exist.
   * @throws {Error} When the theme list cannot be loaded.
   */
  async renderThemeSelector() {
    const options = await themeManager.getThemeOptions();
    this.themeContainer.textContent = '';
    this.themeButtons.clear();

    options.forEach(({ id, labelKey }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'lang-switch__option';
      button.dataset.themeId = id;
      button.textContent = i18n.t(labelKey);
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => this.handleThemeChange(id));
      this.themeContainer.appendChild(button);
      this.themeButtons.set(id, button);
    });
    this.syncThemeButtons();
  }

  /**
   * Displays the immutable UUID of the account.
   *
   * @returns {Promise<void>} Resolves once the identifier is displayed.
   * @throws {Error} When the account cannot be read.
   */
  async renderAccount() {
    this.uuid = await accountManager.getUuid();
    this.uuidElement.textContent = this.uuid ?? '—';
    this.uuidElement.setAttribute('title', this.uuid ?? '');
  }

  /**
   * Reflects the active language on the picker buttons.
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
   * Reflects the active theme on the picker buttons.
   *
   * @returns {void}
   */
  syncThemeButtons() {
    const current = themeManager.getTheme();
    this.themeButtons.forEach((button, id) => {
      const isActive = id === current;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  }

  /**
   * Reflects the sound preference on the switch.
   *
   * `SoundManager` is the single source of truth (the boot applied the stored value), and the
   * state text is written here rather than through `data-i18n`: it depends on the state, not only
   * on the language.
   *
   * @returns {void}
   */
  syncSoundToggle() {
    if (!this.soundToggle) return;
    const isEnabled = soundManager.isEnabled();
    this.soundToggle.setAttribute('aria-checked', isEnabled ? 'true' : 'false');
    if (this.soundStateElement) {
      this.soundStateElement.textContent = i18n.t(isEnabled ? 'settings.sound.on' : 'settings.sound.off');
    }
  }

  /**
   * Attaches every DOM listener (registration is tracked for `destroy()`).
   *
   * @returns {void}
   */
  bindEvents() {
    this.listen(this.soundToggle, 'click', () => this.handleSoundToggle());
    this.listen(this.copyButton, 'click', () => this.handleCopyUuid());
    this.listen(this.exportButton, 'click', () => this.handleExport());
    this.listen(this.importButton, 'click', () => this.handleImportClick());
    this.listen(this.fileInput, 'change', (event) => this.handleFileSelected(event));
    this.listen(this.resetButton, 'click', () => this.handleResetClick());
    this.listen(this.checkGiftsButton, 'click', () => this.handleCheckGifts());
    this.listen(this.giftHistoryButton, 'click', () => this.handleGiftHistory());
    this.listen(this.modalClose, 'click', () => this.closeModal());
    this.listen(this.modalCancel, 'click', () => this.closeModal());
    this.listen(this.modalConfirm, 'click', () => this.handleModalConfirm());
    this.listen(this.modal, 'click', (event) => {
      if (event?.target === this.modal) {
        this.closeModal();
      }
    });
    this.listen(document, 'keydown', (event) => {
      if (event?.key === 'Escape' && this.modal && !this.modal.hidden) {
        this.closeModal();
      }
    });
    this.log('DOM listeners bound.');
  }

  /**
   * Registers a listener and remembers it so `destroy()` can remove it.
   *
   * @param {EventTarget} target - Target element.
   * @param {string} type - Event type.
   * @param {EventListener} handler - Listener.
   * @returns {void}
   */
  listen(target, type, handler) {
    target.addEventListener(type, handler);
    this.bindings.push({ target, type, handler });
  }

  /**
   * Subscribes to the application events the view depends on.
   *
   * @returns {void}
   */
  subscribeToEvents() {
    this.unsubscribers.push(eventBus.on(EVENTS.VIEW_CHANGED, (payload) => {
      if (!payload || typeof payload.view !== 'string') return;
      if (payload.view === SETTINGS_VIEW_NAME) {
        this.handleViewActivated();
      } else if (payload.previousView === SETTINGS_VIEW_NAME) {
        this.handleViewDeactivated();
      }
    }));
    this.unsubscribers.push(eventBus.on(EVENTS.LANG_CHANGED, () => this.handleLanguageChanged()));
    this.unsubscribers.push(eventBus.on(EVENTS.THEME_CHANGED, () => this.syncThemeButtons()));
    this.log('Event subscriptions registered.');
  }

  /**
   * Switches the language at runtime (no reload) and persists the preference.
   *
   * @param {string} code - Language code of the clicked button.
   * @returns {Promise<void>} Resolves once the flow finished (success or failure).
   */
  async handleLanguageChange(code) {
    if (this.isBusy || code === i18n.getLang()) return;

    this.setBusy(true);
    this.setFeedback(null);
    try {
      await i18n.setLang(code);
    } catch (error) {
      console.error('[SettingsView] Unable to switch the language.', error);
      this.setFeedback('settings.error.lang', 'error');
      return;
    } finally {
      this.setBusy(false);
      this.syncLanguageButtons();
    }

    try {
      await accountManager.updateSettings({ lang: code });
      this.log(`Language set to "${code}" and saved.`);
    } catch (error) {
      // The switch is applied for this session but the preference was not stored.
      console.error('[SettingsView] The language preference could not be saved.', error);
      this.setFeedback('settings.error.lang', 'error');
    }
  }

  /**
   * Applies a theme and persists the preference.
   *
   * @param {string} id - Theme id of the clicked button.
   * @returns {Promise<void>} Resolves once the flow finished (success or failure).
   */
  async handleThemeChange(id) {
    if (this.isBusy || id === themeManager.getTheme()) return;

    this.setBusy(true);
    this.setFeedback(null);
    try {
      themeManager.applyTheme(id);
    } catch (error) {
      console.error('[SettingsView] Unable to apply the theme.', error);
      this.setFeedback('settings.error.theme', 'error');
    } finally {
      this.setBusy(false);
      this.syncThemeButtons();
    }

    try {
      await accountManager.updateSettings({ theme: id });
      this.log(`Theme set to "${id}" and saved.`);
    } catch (error) {
      console.error('[SettingsView] The theme preference could not be saved.', error);
      this.setFeedback('settings.error.theme', 'error');
    }
  }

  /**
   * Flips the sound switch and persists the preference.
   *
   * The new state is applied live first. Unlike the language and the theme, a failed write
   * restores the previous state: leaving a switch "off" that would come back "on" after a reload
   * would be a lie, and the feedback line explains why it moved back.
   *
   * @returns {Promise<void>} Resolves once the flow finished (success or failure).
   */
  async handleSoundToggle() {
    if (this.isBusy) return;

    const previous = soundManager.isEnabled();
    const next = !previous;

    soundManager.setEnabled(next);
    this.syncSoundToggle();
    this.setFeedback(null);

    try {
      await accountManager.updateSettings({ sound: next });
      this.log(`Sounds ${next ? 'enabled' : 'disabled'} and saved.`);
    } catch (error) {
      console.error('[SettingsView] The sound preference could not be saved.', error);
      soundManager.setEnabled(previous);
      this.syncSoundToggle();
      this.setFeedback('settings.error.sound', 'error');
    }
  }

  /**
   * Copies the UUID to the clipboard.
   *
   * @returns {Promise<void>} Resolves once the copy attempt finished.
   */
  async handleCopyUuid() {
    if (!this.uuid) return;

    try {
      await this.writeToClipboard(this.uuid);
      this.setFeedback('settings.account.copied', 'info');
    } catch (error) {
      console.error('[SettingsView] The UUID could not be copied.', error);
      this.setFeedback('settings.account.copyError', 'error');
    }
  }

  /**
   * Writes a text in the clipboard, with a fallback for non-secure contexts.
   *
   * `navigator.clipboard` requires a secure context (HTTPS or localhost), so a page served over
   * plain HTTP falls back to the legacy `execCommand('copy')` path.
   *
   * @param {string} text - Text to copy.
   * @returns {Promise<void>} Resolves when the text is in the clipboard.
   * @throws {Error} When both clipboard strategies fail.
   */
  async writeToClipboard(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch (error) {
        console.warn('[SettingsView] The clipboard API refused the write, trying the fallback.', error);
      }
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-1000px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = typeof document.execCommand === 'function' && document.execCommand('copy');
    textarea.remove();

    if (!copied) {
      throw new Error('The clipboard is not available in this browser context.');
    }
  }

  /**
   * Exports the current database as a `.save` file.
   *
   * @returns {Promise<void>} Resolves once the flow finished (success or failure).
   */
  async handleExport() {
    if (this.isBusy) return;

    this.setBusy(true);
    this.setFeedback('settings.save.exporting', 'info');
    try {
      const { filename } = await saveFile.export({ day: this.getTrustedDay() });
      this.setFeedback('settings.save.exported', 'info', { file: filename });
    } catch (error) {
      console.error('[SettingsView] The save could not be exported.', error);
      this.setFeedback('settings.save.exportError', 'error');
    } finally {
      this.setBusy(false);
    }
  }

  /**
   * Opens the file picker for a `.save` import.
   *
   * The input value is reset first so picking the same file twice in a row still fires a
   * `change` event.
   *
   * @returns {void}
   */
  handleImportClick() {
    if (this.isBusy) return;
    this.fileInput.value = '';
    this.fileInput.click();
  }

  /**
   * Handles the chosen `.save` file: the replacement is confirmed before anything is written.
   *
   * @param {Event} event - `change` event of the file input.
   * @returns {void}
   */
  handleFileSelected(event) {
    const file = event?.target?.files?.[0];
    if (!file) {
      this.setFeedback('save.error.noFile', 'info');
      return;
    }

    if (!new RegExp(`${SAVE_EXTENSION.replace('.', '\\.')}$`, 'i').test(file.name)) {
      this.setFeedback('save.error.unsupportedFile', 'error');
      return;
    }

    this.setFeedback(null);
    this.openConfirmation({
      titleKey: 'settings.save.importConfirmTitle',
      bodyKey: 'settings.save.importConfirmBody',
      params: { file: file.name },
      confirmVariant: 'primary',
      onConfirm: () => this.performImport(file),
    });
  }

  /**
   * Replaces the database with the content of the selected file.
   *
   * `SaveFile.importFromFile` reloads the page once the replacement is committed, so this method
   * never returns on success: the busy state is only released on failure.
   *
   * @param {File} file - Validated `.save` file.
   * @returns {Promise<void>} Resolves only when the import failed.
   */
  async performImport(file) {
    this.closeModal();
    this.setBusy(true);
    this.setFeedback('settings.save.importing', 'info');
    this.log(`Importing "${file.name}"…`);

    try {
      await saveFile.importFromFile(file);
    } catch (error) {
      console.error('[SettingsView] The save could not be imported.', error);
      this.setFeedback(getSaveErrorMessageKey(error), 'error');
      this.setBusy(false);
    }
  }

  /**
   * Asks for a confirmation before the full reset.
   *
   * @returns {void}
   */
  handleResetClick() {
    if (this.isBusy) return;

    this.openConfirmation({
      titleKey: 'settings.save.resetConfirmTitle',
      bodyKey: 'settings.save.resetConfirmBody',
      params: null,
      confirmVariant: 'danger',
      onConfirm: () => this.performReset(),
    });
  }

  /**
   * Deletes every local data (UUID included) and returns to the onboarding screen.
   *
   * `AccountManager.resetAll()` emits `ACCOUNT_REMOVED`, which makes `app.js` release the views
   * and the trusted clock; the page is then reloaded so the onboarding is rebuilt from a clean
   * state (`hasAccount()` is false again).
   *
   * @returns {Promise<void>} Resolves only when the reset failed.
   */
  async performReset() {
    this.closeModal();
    this.setBusy(true);
    this.setFeedback('settings.save.resetting', 'info');
    this.log('Full reset requested.');

    try {
      await accountManager.resetAll();
      window.location.reload();
    } catch (error) {
      console.error('[SettingsView] The full reset failed.', error);
      this.setFeedback('settings.save.resetError', 'error');
      this.setBusy(false);
    }
  }

  /**
   * Reads the distributions and credits every gift addressed to the account.
   *
   * The whole rule lives in `GiftManager.checkGifts()`: this method only drives the loading state
   * (the button is disabled and announces itself busy) and translates the outcome — an
   * information modal listing what was credited, or an error toast plus the inline feedback line
   * when the sheet cannot be read at all. A failed check never moves the sync cursor, so the
   * gifts can be checked again later.
   *
   * @returns {Promise<void>} Resolves once the flow finished (success or failure).
   */
  async handleCheckGifts() {
    if (this.isBusy) return;

    this.setBusy(true);
    this.setFeedback('settings.distributions.checking', 'info');
    this.log('Checking the distributions…');

    try {
      const report = await giftManager.checkGifts();
      this.setFeedback(null);
      this.log(
        `Distributions checked: ${report.received.length} gift(s) credited, ` +
          `${report.ignored.length} ignored, ${report.duplicates} already received.`
      );
      await this.openInformation({
        titleKey: 'gifts.check.title',
        report,
      });
    } catch (error) {
      console.error('[SettingsView] The distributions could not be checked.', error);
      const messageKey = getGiftErrorMessageKey(error);
      this.setFeedback(messageKey, 'error');
      Toast.error(messageKey);
    } finally {
      this.setBusy(false);
    }
  }

  /**
   * Builds the body of the distribution report, in the active language.
   *
   * Each credited gift is described through `GiftManager.describeGift()`, so the raw sheet key is
   * resolved into an extension or card name. Called again when the language changes while the
   * modal is open.
   *
   * @param {{received?: object[], ignored?: object[]}} report - Result of `GiftManager.checkGifts()`.
   * @returns {Promise<string>} The translated sentences of the report.
   */
  async buildCheckBody(report) {
    const received = Array.isArray(report?.received) ? report.received : [];
    const ignored = Array.isArray(report?.ignored) ? report.ignored : [];

    const sentences = received.length === 0 ? [i18n.t('gifts.check.emptyBody')] : [];

    // One sheet row is one credit, but several rows can grant the same thing (a booster pack for
    // the same extension, more copies of the same card): the report totals them per target.
    const totals = new Map();
    received.forEach((gift) => {
      const identity = `${gift.type}:${gift.key}`;
      const entry = totals.get(identity) ?? { type: gift.type, key: gift.key, quantity: 0 };
      entry.quantity += Number(gift.quantity) || 0;
      totals.set(identity, entry);
    });

    const items = [];
    for (const total of totals.values()) {
      const info = await giftManager.describeGift(total);
      if (total.type === GIFT_TYPES.CARD) {
        const name = info.card
          ? info.card.getName(i18n.getLang())
          : i18n.t('gifts.item.unknown', { key: total.key });
        items.push(i18n.t('gifts.result.card', { name, count: total.quantity }));
      } else if (total.type === GIFT_TYPES.SPARKS) {
        items.push(i18n.t('gifts.result.sparks', { count: total.quantity }));
      } else {
        const set = info.setName ?? i18n.t('gifts.item.unknown', { key: total.key });
        items.push(i18n.t('gifts.result.booster', { set, count: total.quantity }));
      }
    }

    if (items.length > 0) {
      sentences.push(i18n.t('gifts.check.receivedBody', { list: items.join(', ') }));
    }

    if (ignored.length > 0) {
      // A matching line can be refused (unknown key, invalid quantity...): telling why keeps the
      // player from re-checking forever for a gift that will never arrive.
      const counts = new Map();
      ignored.forEach((entry) => {
        const key = getGiftIgnoreReasonKey(entry.reason);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      });
      const reasons = [...counts.entries()]
        .map(([key, count]) => `${i18n.t(key)} (${count})`)
        .join(', ');
      sentences.push(i18n.t('gifts.check.ignored', { count: ignored.length, reasons }));
    }

    return sentences.join(' ');
  }

  /**
   * Reveals the gift history, which is a panel of this very screen.
   *
   * @returns {void}
   */
  handleGiftHistory() {
    if (this.onShowGiftHistory) {
      this.onShowGiftHistory();
      return;
    }
    if (!this.onNavigate) {
      console.warn('[SettingsView] No navigation callback was provided.');
      return;
    }
    this.onNavigate('gifts');
  }

  /**
   * Opens the confirmation modal.
   *
   * @param {object} confirmation - Content of the modal.
   * @param {string} confirmation.titleKey - i18n key of the title.
   * @param {string} confirmation.bodyKey - i18n key of the body.
   * @param {object|null} [confirmation.params=null] - Interpolation values of the body.
   * @param {'primary'|'danger'} [confirmation.confirmVariant='primary'] - Style of the confirm
   *   button (danger for a destructive action).
   * @param {() => (void|Promise<void>)} confirmation.onConfirm - Called when the player confirms.
   * @returns {void}
   */
  async openConfirmation({ titleKey, bodyKey, params = null, confirmVariant = 'primary', onConfirm }) {
    this.pendingModal = {
      mode: 'confirm',
      titleKey,
      bodyKey,
      params,
      report: null,
      confirmVariant,
      onConfirm,
    };
    await this.renderModal();
    this.modal.hidden = false;
    this.modalConfirm.focus();
  }

  /**
   * Opens an information modal (distribution report).
   *
   * Same dialog as a confirmation, but the cancel button is hidden and the only action closes it:
   * there is nothing to accept, the message reports work that already happened.
   *
   * @param {object} information - Content of the modal.
   * @param {string} information.titleKey - i18n key of the title.
   * @param {object} information.report - Result of `GiftManager.checkGifts()`.
   * @returns {Promise<void>} Resolves once the modal is displayed.
   */
  async openInformation({ titleKey, report }) {
    this.pendingModal = {
      mode: 'info',
      titleKey,
      bodyKey: null,
      params: null,
      report,
      confirmVariant: 'primary',
      onConfirm: null,
    };
    await this.renderModal();
    this.modal.hidden = false;
    this.modalConfirm.focus();
  }

  /**
   * Writes the pending modal into the DOM (translated in the active language).
   *
   * @returns {Promise<void>} Resolves once the content is displayed.
   */
  async renderModal() {
    const pending = this.pendingModal;
    if (!pending) return;

    const isInfo = pending.mode === 'info';
    this.modalTitle.textContent = i18n.t(pending.titleKey);
    this.modalCancel.textContent = i18n.t('settings.confirm.cancel');
    this.modalCancel.hidden = isInfo;
    this.modalConfirm.textContent = i18n.t(isInfo ? 'settings.info.close' : 'settings.confirm.accept');
    this.modalConfirm.classList.toggle('btn--danger', pending.confirmVariant === 'danger');
    this.modalConfirm.classList.toggle('btn--primary', pending.confirmVariant !== 'danger');
    this.modalBody.textContent = isInfo
      ? await this.buildCheckBody(pending.report)
      : i18n.t(pending.bodyKey, pending.params);
  }

  /**
   * Runs the action of the open confirmation modal (an information modal simply closes).
   *
   * @returns {Promise<void>} Resolves once the action finished.
   */
  async handleModalConfirm() {
    const pending = this.pendingModal;
    if (!pending || pending.mode === 'info' || typeof pending.onConfirm !== 'function') {
      this.closeModal();
      return;
    }

    try {
      await pending.onConfirm();
    } catch (error) {
      // The confirmation actions handle their own errors; this is the last safety net so a
      // listener exception can never leave the modal stuck open.
      console.error('[SettingsView] The confirmed action failed.', error);
      this.closeModal();
      this.setBusy(false);
      this.setFeedback('save.error.unknown', 'error');
    }
  }

  /**
   * Closes the modal (confirmation or information) and forgets the pending action.
   *
   * @returns {void}
   */
  closeModal() {
    this.pendingModal = null;
    if (this.modal) {
      this.modal.hidden = true;
    }
  }

  /**
   * Reads the trusted UTC day used in the exported file name.
   *
   * The file name is cosmetic metadata, but using the trusted clock keeps the whole application
   * consistent: `Date.now()` is never used for anything time related.
   *
   * @returns {string|null} `YYYY-MM-DD`, or null when the clock was never anchored this session.
   */
  getTrustedDay() {
    try {
      return dateSyncManager.isTimeTrusted() ? dateSyncManager.getCurrentUtcDay() : null;
    } catch (error) {
      console.warn('[SettingsView] Unable to read the trusted UTC day.', error);
      return null;
    }
  }

  /**
   * Enables or disables the action buttons (single source of truth for the busy state).
   *
   * @param {boolean} isBusy - Whether an export/import/reset is running.
   * @returns {void}
   */
  setBusy(isBusy) {
    this.isBusy = isBusy;
    [
      this.soundToggle,
      this.copyButton,
      this.exportButton,
      this.importButton,
      this.resetButton,
      this.checkGiftsButton,
      this.giftHistoryButton,
    ].forEach((button) => {
      button.disabled = isBusy;
    });
    // The check button also announces its own loading state: it is the only long network call here.
    this.checkGiftsButton.setAttribute('aria-busy', isBusy ? 'true' : 'false');
    this.root.setAttribute('aria-busy', isBusy ? 'true' : 'false');
  }

  /**
   * Displays an informational or error message above the panels.
   *
   * @param {string|null} key - i18n key, or null to clear the message.
   * @param {'info'|'error'} [tone='info'] - Visual tone, exposed as `data-tone`.
   * @param {object|null} [params=null] - Interpolation values.
   * @returns {void}
   */
  setFeedback(key, tone = 'info', params = null) {
    this.feedback = key ? { key, tone, params } : null;
    this.renderFeedback();
  }

  /**
   * Writes the stored feedback message into the DOM.
   *
   * @returns {void}
   */
  renderFeedback() {
    if (!this.feedbackElement) return;
    if (!this.feedback) {
      this.feedbackElement.hidden = true;
      this.feedbackElement.textContent = '';
      this.feedbackElement.removeAttribute('data-tone');
      return;
    }

    this.feedbackElement.hidden = false;
    this.feedbackElement.textContent = i18n.t(this.feedback.key, this.feedback.params);
    this.feedbackElement.dataset.tone = this.feedback.tone;
  }

  /**
   * Re-renders the dynamic labels when the language changed.
   *
   * @returns {void}
   */
  handleLanguageChanged() {
    this.log(`Language changed, re-rendering (${i18n.getLang()}).`);
    this.syncLanguageButtons();
    void this.renderThemeSelector().catch((error) => {
      console.error('[SettingsView] The theme list could not be re-rendered.', error);
    });
    this.syncSoundToggle();
    this.renderFeedback();
    if (this.pendingModal) {
      void this.renderModal().catch((error) => {
        console.error('[SettingsView] The modal could not be re-rendered.', error);
      });
    }
  }

  /**
   * Refreshes the account state when the view becomes active.
   *
   * Another view may have changed the data in the meantime (a `.save` import reloads the page,
   * but the UUID is also displayed right after an onboarding creation).
   *
   * @returns {void}
   */
  handleViewActivated() {
    this.isActive = true;
    this.log('View activated.');
    this.syncLanguageButtons();
    this.syncThemeButtons();
    this.syncSoundToggle();
    void this.renderAccount().catch((error) => {
      console.error('[SettingsView] The account could not be read.', error);
      this.setFeedback('settings.error.load', 'error');
    });
  }

  /**
   * Marks the view as inactive and drops any pending confirmation.
   *
   * @returns {void}
   */
  handleViewDeactivated() {
    this.isActive = false;
    this.closeModal();
    this.log('View deactivated.');
  }

  /**
   * Removes every listener and subscription.
   *
   * @returns {void}
   */
  destroy() {
    this.log('Destroying the view.');
    this.bindings.forEach(({ target, type, handler }) => target.removeEventListener(type, handler));
    this.bindings = [];
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers = [];
    this.languageButtons.clear();
    this.themeButtons.clear();
    this.closeModal();
    this.isInitialized = false;
  }
}

export default SettingsView;

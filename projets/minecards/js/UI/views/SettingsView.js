/**
 * SettingsView - Preferences, account identity, save management and reserved distributions.
 *
 * Reference: `.docs/steps/6.md` point 3 and `.docs/main.md` section 3.G (view 4).
 *
 * Sections:
 *   - language  : FR / EN through `I18n.setLang` (applied live), persisted in `settings`;
 *   - theme     : every theme declared in `settings/config.json`, applied through
 *                 `ThemeManager.applyTheme`, persisted in `settings`;
 *   - animation : every mode declared in `settings/config.json` ("normal", "epic", the parodic
 *                 "explosive"), applied through `AnimationManager.applyAnimation`, persisted in
 *                 `settings`. A mode flagged `parodic` in the configuration is advertised as a
 *                 deliberate joke (hazard banner + badge), and the panel carries a live DEMO of
 *                 the three stages of an opening so the choice is made by looking;
 *   - foil      : TWO sliders, one per foil effect. "Intensité du foil" drives
 *                 `FoilManager.applyIntensity` (the shapes of the print: grid, embossing, honeycomb,
 *                 weave) and "Brillance" drives `FoilManager.applyGlareIntensity` (the bright line
 *                 sweeping across the artwork). Each one is persisted in `settings` as a percentage,
 *                 takes its range from `config.json` (`foil` and `foil.glare`), applies its value
 *                 live (the demo card of the animation panel is a mythic, so the effect is visible
 *                 under the finger) and only writes to the database on release;
 *   - sound     : one switch ("Sons") driving `SoundManager.setEnabled`, persisted in `settings`;
 *   - clock     : the trusted UTC time of the game (the header clock is hidden on a phone);
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
import animationManager from '../../utils/AnimationManager.js';
import glowManager from '../../utils/GlowManager.js';
import foilManager from '../../utils/FoilManager.js';
import { configLoader } from '../../utils/ConfigLoader.js';
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
import notificationCenter from '../components/NotificationCenter.js';
import { applyShine } from '../components/CardComponent.js';

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
    this.animationContainer = query('[data-settings-animations]');
    this.foilSlider = query('[data-settings-foil]');
    this.foilValueElement = query('[data-settings-foil-value]');
    this.glareSlider = query('[data-settings-glare]');
    this.glareValueElement = query('[data-settings-glare-value]');
    this.glowSlider = query('[data-settings-glow]');
    this.glowValueElement = query('[data-settings-glow-value]');
    this.notificationDurationSlider = query('[data-settings-notification-duration]');
    this.notificationDurationValue = query('[data-settings-notification-duration-value]');
    this.notificationToggles = {
      collection: query('[data-settings-notification-collection]'),
      experience: query('[data-settings-notification-experience]'),
      title: query('[data-settings-notification-title]'),
    };
    this.notificationStateElements = {
      collection: query('[data-settings-notification-collection-state]'),
      experience: query('[data-settings-notification-experience-state]'),
      title: query('[data-settings-notification-title-state]'),
    };
    this.demoStage = query('[data-animation-demo-stage]');
    this.demoTiles = query('[data-animation-demo-tiles]');
    this.demoPlayButton = query('[data-animation-demo-play]');
    this.soundToggle = query('[data-settings-sound]');
    this.soundStateElement = query('[data-settings-sound-state]');
    this.devToggle = query('[data-settings-dev]');
    this.devModeStateElement = query('[data-settings-dev-state]');
    this.clockElement = query('[data-settings-utc]');
    this.clockDayElement = query('[data-settings-utc-day]');
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
    /** @type {boolean} Last known developer mode (the store is the source of truth). */
    this.devMode = false;
    /** @type {number} Duration of one notification, in seconds. */
    this.notificationDuration = 3;
    /** @type {Record<string, boolean>} Allowed notification kinds. */
    this.notificationTypes = { collection: true, experience: true, title: true };
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
    /** @type {Map<string, HTMLButtonElement>} Animation buttons, keyed by mode id. */
    this.animationButtons = new Map();
    /** @type {HTMLElement|null} Demo card (the flip preview). */
    this.demoCard = null;
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
      ['[data-settings-animations]', this.animationContainer],
      ['[data-settings-foil]', this.foilSlider],
      ['[data-settings-foil-value]', this.foilValueElement],
      ['[data-settings-glare]', this.glareSlider],
      ['[data-settings-glare-value]', this.glareValueElement],
      ['[data-settings-glow]', this.glowSlider],
      ['[data-settings-glow-value]', this.glowValueElement],
      ['[data-settings-notification-duration]', this.notificationDurationSlider],
      ['[data-settings-notification-duration-value]', this.notificationDurationValue],
      ['[data-settings-notification-collection]', this.notificationToggles.collection],
      ['[data-settings-notification-experience]', this.notificationToggles.experience],
      ['[data-settings-notification-title]', this.notificationToggles.title],
      ['[data-animation-demo-stage]', this.demoStage],
      ['[data-animation-demo-tiles]', this.demoTiles],
      ['[data-animation-demo-play]', this.demoPlayButton],
      ['[data-settings-sound]', this.soundToggle],
      ['[data-settings-sound-state]', this.soundStateElement],
      ['[data-settings-dev]', this.devToggle],
      ['[data-settings-dev-state]', this.devModeStateElement],
      ['[data-settings-utc]', this.clockElement],
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
    await this.renderAnimationSelector();
    this.renderAnimationDemo();
    this.renderFoilSlider();
    this.renderGlareSlider();
    this.renderGlowSlider();
    await this.renderNotificationSettings();
    this.syncSoundToggle();
    await this.syncDevToggle();
    await this.renderAccount();
    this.renderClock();
    this.bindEvents();
    this.subscribeToEvents();
    this.log(
      `Ready (lang: ${i18n.getLang()}, theme: ${themeManager.getTheme()}, animation: ${animationManager.getMode()}).`
    );
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
   * Renders one button per animation mode declared in `config.json`.
   *
   * The visible label comes from the `labelKey` of the descriptor, so a new mode only needs a
   * translation entry. A mode flagged `parodic` also carries a badge: the joke is announced before
   * it is played, never after.
   *
   * @returns {Promise<void>} Resolves once the buttons exist.
   * @throws {Error} When the mode list cannot be loaded.
   */
  async renderAnimationSelector() {
    const options = await animationManager.getAnimationOptions();
    this.animationContainer.textContent = '';
    this.animationButtons.clear();

    options.forEach(({ id, labelKey, parodic }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'lang-switch__option';
      button.dataset.animationId = id;
      button.textContent = i18n.t(labelKey);
      button.setAttribute('aria-pressed', 'false');
      if (parodic) {
        button.classList.add('is-parodic');
        const badge = document.createElement('span');
        badge.className = 'anim-option__badge';
        // Leading space: the badge is part of the label read by a screen reader ("Explosif
        // BLAGUE"), while the visible gap comes from the CSS margin.
        badge.textContent = ` ${i18n.t('settings.animation.parodic')}`;
        button.appendChild(badge);
      }
      button.addEventListener('click', () => this.handleAnimationChange(id));
      this.animationContainer.appendChild(button);
      this.animationButtons.set(id, button);
    });
    this.syncAnimationButtons();
  }

  /**
   * Builds the demo of the animation panel: one card and the five summary thumbnails.
   *
   * The demo reuses the REAL classes of the opening (`.card-reveal__card`,
   * `.card-reveal__summary-item`), so `css/animations/` dresses it exactly like the game and a
   * mode switch changes it without a single line of extra code here. The cards carry no artwork: a
   * dashed border makes them read as placeholders. The big one is a mythic, so the demo also shows
   * the foil reflection of `css/components/card-shine.css`.
   *
   * @returns {void}
   */
  renderAnimationDemo() {
    if (this.demoStage) {
      this.demoStage.textContent = '';
      const card = document.createElement('span');
      card.className = 'card-reveal__card anim-demo__card card-reveal__card--r5';
      const front = SettingsView.buildDemoFace('front');
      // Same rarity as the class above (`--r5`), so the demo and the reveal agree on the foil. The
      // demo card is what both sliders of the panel below move under the finger.
      applyShine(front, { rarity: 5 });
      card.append(SettingsView.buildDemoFace('back'), front);
      this.demoStage.appendChild(card);
      this.demoCard = card;
    }

    this.renderDemoTiles();
  }

  /**
   * Fills the demo strip with the five thumbnails of a summary.
   *
   * @returns {void}
   */
  renderDemoTiles() {
    if (!this.demoTiles) return;
    this.demoTiles.textContent = '';
    for (let index = 0; index < 5; index += 1) {
      const tile = document.createElement('span');
      tile.className = 'card-reveal__summary-item anim-demo__tile';
      const card = document.createElement('span');
      card.className = 'card-reveal__card card-reveal__card--r3';
      card.append(SettingsView.buildDemoFace('back'), SettingsView.buildDemoFace('front'));
      tile.appendChild(card);
      this.demoTiles.appendChild(tile);
    }
  }

  /**
   * Builds one face of a demo card.
   *
   * @param {'back'|'front'} kind - Face to build.
   * @returns {HTMLElement} The face element.
   */
  static buildDemoFace(kind) {
    const face = document.createElement('span');
    face.className = `card-reveal__face card-reveal__face--${kind}`;
    return face;
  }

  /**
   * Replays the demo: the card flips and the five thumbnails enter again.
   *
   * Removing the class, forcing a reflow and adding it back is what restarts a CSS animation on the
   * card; the thumbnails are rebuilt because a fresh element always plays its entry animation. The
   * durations and the stagger themselves come from the active mode (`--anim-flip-ms`,
   * `--anim-stagger-ms`), so nothing is duplicated here.
   *
   * @returns {void}
   */
  playAnimationDemo() {
    if (this.demoCard) {
      this.demoCard.classList.remove('is-flipped');
      void this.demoCard.offsetWidth;
      this.demoCard.classList.add('is-flipped');
    }
    this.renderDemoTiles();
  }

  /**
   * Displays the immutable UUID of the account.
   *
   * @returns {Promise<void>} Resolves once the identifier is displayed.
   * @throws {Error} When the account cannot be read.
   */
  async renderAccount() {
    this.uuid = await accountManager.getUuid();
    this.uuidElement.textContent = this.uuid ?? i18n.t('common.unknown');
    this.uuidElement.setAttribute('title', this.uuid ?? '');
  }

  /**
   * Displays the trusted UTC time of the game and the UTC day it belongs to.
   *
   * The header carries the same clock, but it is hidden on a phone; this panel is the one place
   * where the reference time stays readable. The value never comes from `Date.now()`: it is the
   * estimated time of `DateSyncManager`, published every second through `CLOCK_TICK`, so the panel
   * always agrees with the daily booster quota and with the availability windows of the codes.
   * Before the first tick — and while no provider answered — the timer shows `--:--:--`: a wrong
   * time would be worse than no time at all.
   *
   * @param {{utc?: Date, formatted?: string}|null} [payload=null] - Tick payload, or null to read
   *   the current value from the manager (used on activation, before the next tick).
   * @returns {void}
   */
  renderClock(payload = null) {
    if (!this.clockElement) return;

    let formatted = typeof payload?.formatted === 'string' ? payload.formatted : null;
    let day = null;
    try {
      const trusted = dateSyncManager.isTimeTrusted();
      day = trusted ? dateSyncManager.getCurrentUtcDay() : null;
      if (!formatted && trusted) {
        const utc = dateSyncManager.getUtcDate();
        formatted = [utc.getUTCHours(), utc.getUTCMinutes(), utc.getUTCSeconds()]
          .map((value) => String(value).padStart(2, '0'))
          .join(':');
      }
    } catch (error) {
      console.warn('[SettingsView] The trusted UTC time could not be read.', error);
    }

    this.clockElement.textContent = formatted ?? '--:--:--';
    if (this.clockDayElement) {
      this.clockDayElement.textContent = day ? i18n.t('stats.history.date', { date: day }) : '';
    }
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
   * Reflects the active animation mode on the picker, the hazard banner and the demo.
   *
   * The banner is the visual guarantee that the parodic mode is understood as a joke: it appears
   * with the mode, in the strongest styling of the palette (dashed warning border + a wobbling
   * icon), and disappears with it.
   *
   * @returns {void}
   */
  syncAnimationButtons() {
    const current = animationManager.getMode();

    this.animationButtons.forEach((button, id) => {
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
   * Reflects the stored developer mode on its switch.
   *
   * Unlike the sounds, there is no manager holding the value in memory: the account settings ARE
   * the state, so it is re-read here (another screen may have imported a save, and the collection
   * reads the very same setting on every card it opens).
   *
   * @returns {Promise<void>} Resolves once the switch matches the stored preference.
   */
  async syncDevToggle() {
    if (!this.devToggle) return;
    let enabled = false;
    try {
      const settings = await accountManager.getSettings();
      enabled = settings.devMode === true;
    } catch (error) {
      console.warn('[SettingsView] The developer mode could not be read.', error);
    }
    this.devMode = enabled;
    this.devToggle.setAttribute('aria-checked', enabled ? 'true' : 'false');
    if (this.devModeStateElement) {
      this.devModeStateElement.textContent = i18n.t(enabled ? 'settings.dev.on' : 'settings.dev.off');
    }
  }

  /**
   * Flips the developer mode and persists it.
   *
   * The switch moves first so the tap feels immediate; a failed write moves it back and says why,
   * like the sound preference: a switch left on that would come back off after a reload would lie.
   *
   * @returns {Promise<void>} Resolves once the flow finished (success or failure).
   */
  async handleDevToggle() {
    if (this.isBusy) return;

    const previous = this.devMode;
    const next = !previous;
    this.devMode = next;
    this.devToggle.setAttribute('aria-checked', next ? 'true' : 'false');
    if (this.devModeStateElement) {
      this.devModeStateElement.textContent = i18n.t(next ? 'settings.dev.on' : 'settings.dev.off');
    }
    this.setFeedback(null);

    try {
      await accountManager.updateSettings({ devMode: next });
      this.log(`Developer mode ${next ? 'enabled' : 'disabled'} and saved.`);
    } catch (error) {
      console.error('[SettingsView] The developer mode could not be saved.', error);
      this.devMode = previous;
      this.devToggle.setAttribute('aria-checked', previous ? 'true' : 'false');
      if (this.devModeStateElement) {
        this.devModeStateElement.textContent = i18n.t(previous ? 'settings.dev.on' : 'settings.dev.off');
      }
      this.setFeedback('settings.error.dev', 'error');
    }
  }

  /**
   * Fills the foil slider from the configuration and reflects the active intensity.
   *
   * The range lives in `settings/config.json` (`foil`), not in the markup: the slider is the only
   * consumer, and the bounds a player can reach must be the ones the game was tuned for.
   *
   * @returns {void}
   */
  renderFoilSlider() {
    if (!this.foilSlider) return;
    const { min, max, step } = foilManager.getSettings();
    this.foilSlider.min = String(min);
    this.foilSlider.max = String(max);
    this.foilSlider.step = String(step);
    this.syncFoilSlider();
  }

  /**
   * Reflects the active intensity on the slider and on its percentage.
   *
   * @returns {void}
   */
  syncFoilSlider() {
    if (!this.foilSlider) return;
    const percent = foilManager.getPercent();
    if (this.foilSlider.value !== String(percent)) {
      this.foilSlider.value = String(percent);
    }
    this.renderFoilValue(percent);
  }

  /**
   * Writes the percentage displayed next to the slider.
   *
   * Written through `i18n.t` instead of `data-i18n`: the text depends on the percentage, not only
   * on the language, exactly like the state of the sound switch.
   *
   * @param {number} [percent] - Value to display (the active one by default).
   * @returns {void}
   */
  renderFoilValue(percent = foilManager.getPercent()) {
    if (!this.foilValueElement) return;
    this.foilValueElement.textContent = i18n.t('settings.foil.value', { value: percent });
  }

  /**
   * Fills the brillance slider from the configuration and reflects the active value.
   *
   * Same contract as `renderFoilSlider()` for the second effect of the panel: the range belongs to
   * `config.json` (`foil.glare`), not to the markup, so a tuning change never has to touch the HTML.
   *
   * @returns {void}
   */
  renderGlareSlider() {
    if (!this.glareSlider) return;
    const { min, max, step } = foilManager.getGlareSettings();
    this.glareSlider.min = String(min);
    this.glareSlider.max = String(max);
    this.glareSlider.step = String(step);
    this.syncGlareSlider();
  }

  /**
   * Reflects the active brillance on the slider and on its percentage.
   *
   * @returns {void}
   */
  syncGlareSlider() {
    if (!this.glareSlider) return;
    const percent = foilManager.getGlarePercent();
    if (this.glareSlider.value !== String(percent)) {
      this.glareSlider.value = String(percent);
    }
    this.renderGlareValue(percent);
  }

  /**
   * Writes the percentage displayed next to the brillance slider.
   *
   * @param {number} [percent] - Value to display (the active one by default).
   * @returns {void}
   */
  renderGlareValue(percent = foilManager.getGlarePercent()) {
    if (!this.glareValueElement) return;
    this.glareValueElement.textContent = i18n.t('settings.foil.value', { value: percent });
  }

  /**
   * Applies the brillance while the thumb moves (the release is what saves).
   *
   * @param {Event} event - Input event of the range element.
   * @returns {void}
   */
  handleGlareInput(event) {
    const percent = Number(event?.target?.value);
    try {
      foilManager.applyGlareIntensity(percent);
    } catch (error) {
      console.error('[SettingsView] Unable to apply the brillance.', error);
      this.setFeedback('settings.error.glare', 'error');
      return;
    }
    this.setFeedback(null);
    this.renderGlareValue(foilManager.getGlarePercent());
  }

  /**
   * Persists the brillance once the player lets go of the thumb.
   *
   * Like the foil intensity, a failed write keeps the value applied for this session and reports it:
   * snapping the slider back under the finger would be a worse answer than a preference that only
   * lasts until the next start.
   *
   * @returns {Promise<void>} Resolves once the flow finished (success or failure).
   */
  async handleGlareChange() {
    const percent = foilManager.getGlarePercent();
    try {
      await accountManager.updateSettings({ glareIntensity: percent });
      this.log(`Glare intensity set to ${percent} % and saved.`);
    } catch (error) {
      console.error('[SettingsView] The brillance could not be saved.', error);
      this.setFeedback('settings.error.glare', 'error');
    }
  }

  /**
   * Fills the trophy glow slider from the configuration and reflects the active level.
   *
   * The range belongs to `settings/config.json` (`glow.trophies`), not to the markup: the slider
   * and the game must agree on what "strongest" means.
   *
   * @returns {void}
   */
  renderGlowSlider() {
    if (!this.glowSlider) return;
    const { min, max, step } = glowManager.getSettings();
    this.glowSlider.min = String(min);
    this.glowSlider.max = String(max);
    this.glowSlider.step = String(step);
    this.syncGlowSlider();
  }

  /**
   * Reflects the active level on the slider and on its value.
   *
   * @returns {void}
   */
  syncGlowSlider() {
    if (!this.glowSlider) return;
    const level = glowManager.getLevel();
    if (this.glowSlider.value !== String(level)) {
      this.glowSlider.value = String(level);
    }
    this.renderGlowValue(level);
  }

  /**
   * Writes the level displayed next to the slider.
   *
   * @param {number} [level] - Value to display (the active one by default).
   * @returns {void}
   */
  renderGlowValue(level = glowManager.getLevel()) {
    if (!this.glowValueElement) return;
    // The maximum comes from `config.json`, like the bounds of the slider: hard-coding it in the
    // translation would lie as soon as the range is retuned.
    this.glowValueElement.textContent = i18n.t('settings.glow.value', {
      value: level,
      max: glowManager.getSettings().max,
    });
  }

  /**
   * Applies the trophy glow while the thumb moves (the release is what saves).
   *
   * @param {Event} event - Input event of the range element.
   * @returns {void}
   */
  handleGlowInput(event) {
    const level = Number(event?.target?.value);
    try {
      glowManager.applyLevel(level);
    } catch (error) {
      console.error('[SettingsView] Unable to apply the trophy glow.', error);
      this.setFeedback('settings.error.glow', 'error');
      return;
    }
    this.setFeedback(null);
    this.renderGlowValue(glowManager.getLevel());
  }

  /**
   * Persists the trophy glow once the player lets go of the thumb.
   *
   * Like the foil sliders, a failed write keeps the value applied for this session and reports it.
   *
   * @returns {Promise<void>} Resolves once the flow finished (success or failure).
   */
  async handleGlowChange() {
    const level = glowManager.getLevel();
    try {
      await accountManager.updateSettings({ glowTrophies: level });
      this.log(`Trophy glow set to ${level} and saved.`);
    } catch (error) {
      console.error('[SettingsView] The trophy glow could not be saved.', error);
      this.setFeedback('settings.error.glow', 'error');
    }
  }

  /**
   * Fills the notification controls from `config.json` and the stored preferences.
   *
   * The duration range belongs to `notifications.duration`, like every other slider, and the
   * switches are the kinds `NotificationCenter` knows. The stored values are applied to the live
   * queue at the same time, so the screen can never show a state the next opening would ignore.
   *
   * @returns {Promise<void>} Resolves once the controls are painted.
   */
  async renderNotificationSettings() {
    if (!this.notificationDurationSlider) return;
    const { duration } = await configLoader.getNotificationSettings();
    this.notificationDurationSlider.min = String(duration.min);
    this.notificationDurationSlider.max = String(duration.max);
    this.notificationDurationSlider.step = String(duration.step);

    try {
      const settings = await accountManager.getSettings();
      this.notificationDuration = settings.notificationDuration ?? duration.default;
      this.notificationTypes = { ...settings.notificationTypes };
    } catch (error) {
      console.warn('[SettingsView] The notification settings could not be read.', error);
      this.notificationDuration = duration.default;
    }

    this.applyNotificationSettings();
  }

  /**
   * Writes the notification preferences on the controls and on the live queue.
   *
   * @returns {void}
   */
  applyNotificationSettings() {
    if (this.notificationDurationSlider) {
      this.notificationDurationSlider.value = String(this.notificationDuration);
    }
    notificationCenter.setDurationSeconds(this.notificationDuration);
    notificationCenter.setEnabledTypes(this.notificationTypes);
    this.renderNotificationDurationValue();
    Object.keys(this.notificationTypes).forEach((type) => this.syncNotificationToggle(type));
  }

  /**
   * Writes the duration displayed next to its slider.
   *
   * @param {number} [seconds] - Value to display (the current one by default).
   * @returns {void}
   */
  renderNotificationDurationValue(seconds = this.notificationDuration) {
    if (!this.notificationDurationValue) return;
    this.notificationDurationValue.textContent = i18n.t('settings.notifications.value', {
      value: seconds,
    });
  }

  /**
   * Reflects one kind switch and its caption.
   *
   * @param {string} type - Notification kind (`collection`, `experience`, `title`).
   * @returns {void}
   */
  syncNotificationToggle(type) {
    const toggle = this.notificationToggles[type];
    if (!toggle) return;
    const enabled = this.notificationTypes[type] !== false;
    toggle.setAttribute('aria-checked', enabled ? 'true' : 'false');
    const state = this.notificationStateElements[type];
    if (state) {
      state.textContent = i18n.t(enabled ? 'settings.dev.on' : 'settings.dev.off');
    }
  }

  /**
   * Applies the notification duration while the thumb moves (the release is what saves).
   *
   * @param {Event} event - Input event of the range element.
   * @returns {void}
   */
  handleNotificationDurationInput(event) {
    const seconds = Number(event?.target?.value);
    if (!Number.isFinite(seconds)) return;
    this.notificationDuration = Math.round(seconds);
    notificationCenter.setDurationSeconds(this.notificationDuration);
    this.setFeedback(null);
    this.renderNotificationDurationValue();
  }

  /**
   * Persists the notification duration once the player lets go of the thumb.
   *
   * Like the other sliders, a failed write keeps the value applied for this session and reports it.
   *
   * @returns {Promise<void>} Resolves once the flow finished (success or failure).
   */
  async handleNotificationDurationChange() {
    try {
      await accountManager.updateSettings({ notificationDuration: this.notificationDuration });
      this.log(`Notification duration set to ${this.notificationDuration} s and saved.`);
    } catch (error) {
      console.error('[SettingsView] The notification duration could not be saved.', error);
      this.setFeedback('settings.error.notifications', 'error');
    }
  }

  /**
   * Flips one notification kind and persists it.
   *
   * The switch applies live first, exactly like the sound preference: a kind switched off stops
   * appearing immediately, and a failed write moves the switch back so it cannot lie.
   *
   * @param {string} type - Notification kind (`collection`, `experience`, `title`).
   * @returns {Promise<void>} Resolves once the flow finished (success or failure).
   */
  async handleNotificationToggle(type) {
    if (this.isBusy || !this.notificationToggles[type]) return;

    const previous = this.notificationTypes[type] !== false;
    const next = !previous;
    this.notificationTypes = { ...this.notificationTypes, [type]: next };
    this.syncNotificationToggle(type);
    notificationCenter.setEnabledTypes(this.notificationTypes);
    this.setFeedback(null);

    try {
      await accountManager.updateSettings({ notificationTypes: { [type]: next } });
      this.log(`Notification kind "${type}" ${next ? 'enabled' : 'disabled'} and saved.`);
    } catch (error) {
      console.error('[SettingsView] The notification kind could not be saved.', error);
      this.notificationTypes = { ...this.notificationTypes, [type]: previous };
      this.syncNotificationToggle(type);
      notificationCenter.setEnabledTypes(this.notificationTypes);
      this.setFeedback('settings.error.notifications', 'error');
    }
  }

  /**
   * Applies the intensity while the thumb moves.
   *
   * Nothing is written to the database here: `input` fires for every step of the drag, and a write
   * per step would fill the transaction log for a value the player is still choosing. The release
   * (`change`) is what saves. The slider element itself is left alone for the same reason - moving
   * its value from code in the middle of a gesture is how a drag gets interrupted.
   *
   * @param {Event} event - Input event of the range element.
   * @returns {void}
   */
  handleFoilInput(event) {
    const percent = Number(event?.target?.value);
    try {
      foilManager.applyIntensity(percent);
    } catch (error) {
      console.error('[SettingsView] Unable to apply the foil intensity.', error);
      this.setFeedback('settings.error.foil', 'error');
      return;
    }
    this.setFeedback(null);
    this.renderFoilValue(foilManager.getPercent());
  }

  /**
   * Persists the intensity once the player lets go of the thumb.
   *
   * A failed write keeps the value applied for this session and reports it, like the animation
   * picker: snapping the foil back under the finger would be a worse answer than a preference that
   * only lasts until the next start.
   *
   * @returns {Promise<void>} Resolves once the flow finished (success or failure).
   */
  async handleFoilChange() {
    const percent = foilManager.getPercent();
    try {
      await accountManager.updateSettings({ foilIntensity: percent });
      this.log(`Foil intensity set to ${percent} % and saved.`);
    } catch (error) {
      console.error('[SettingsView] The foil intensity could not be saved.', error);
      this.setFeedback('settings.error.foil', 'error');
    }
  }

  /**
   * Attaches every DOM listener (registration is tracked for `destroy()`).
   *
   * @returns {void}
   */
  bindEvents() {
    this.listen(this.demoPlayButton, 'click', () => this.playAnimationDemo());
    this.listen(this.foilSlider, 'input', (event) => this.handleFoilInput(event));
    this.listen(this.foilSlider, 'change', () => this.handleFoilChange());
    this.listen(this.glareSlider, 'input', (event) => this.handleGlareInput(event));
    this.listen(this.glareSlider, 'change', () => this.handleGlareChange());
    this.listen(this.glowSlider, 'input', (event) => this.handleGlowInput(event));
    this.listen(this.glowSlider, 'change', () => this.handleGlowChange());
    this.listen(this.notificationDurationSlider, 'input', (event) =>
      this.handleNotificationDurationInput(event)
    );
    this.listen(this.notificationDurationSlider, 'change', () =>
      this.handleNotificationDurationChange()
    );
    Object.entries(this.notificationToggles).forEach(([type, toggle]) => {
      this.listen(toggle, 'click', () => void this.handleNotificationToggle(type));
    });
    this.listen(this.soundToggle, 'click', () => this.handleSoundToggle());
    this.listen(this.devToggle, 'click', () => void this.handleDevToggle());
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
    this.unsubscribers.push(
      eventBus.on(EVENTS.ANIMATION_CHANGED, () => {
        this.syncAnimationButtons();
        // The demo is replayed on every switch: the difference between two modes must be visible
        // immediately, without opening a booster to find out.
        this.playAnimationDemo();
      })
    );
    this.unsubscribers.push(
      eventBus.on(EVENTS.FOIL_INTENSITY_CHANGED, () => this.syncFoilSlider())
    );
    this.unsubscribers.push(
      eventBus.on(EVENTS.GLARE_INTENSITY_CHANGED, () => this.syncGlareSlider())
    );
    this.unsubscribers.push(eventBus.on(EVENTS.CLOCK_TICK, (payload) => this.renderClock(payload)));
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
   * Applies an animation mode and persists the preference.
   *
   * Like the theme, the mode is applied live first: the demo of the panel and the next opening
   * both follow it. A failed write leaves the session on the chosen mode and reports it, instead of
   * pretending the click did nothing.
   *
   * @param {string} id - Mode id of the clicked button.
   * @returns {Promise<void>} Resolves once the flow finished (success or failure).
   */
  async handleAnimationChange(id) {
    if (this.isBusy || id === animationManager.getMode()) return;

    this.setBusy(true);
    this.setFeedback(null);
    try {
      animationManager.applyAnimation(id);
    } catch (error) {
      console.error('[SettingsView] Unable to apply the animation mode.', error);
      this.setFeedback('settings.error.animation', 'error');
    } finally {
      this.setBusy(false);
      this.syncAnimationButtons();
    }

    try {
      await accountManager.updateSettings({ animation: id });
      this.log(`Animation mode set to "${id}" and saved.`);
    } catch (error) {
      console.error('[SettingsView] The animation preference could not be saved.', error);
      this.setFeedback('settings.error.animation', 'error');
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
      this.devToggle,
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
    void this.syncDevToggle();
    void this.renderAnimationSelector().catch((error) => {
      console.error('[SettingsView] The animation list could not be re-rendered.', error);
    });
    // The animation picker rebuilds its labels on its own; the foil percentage is a translated
    // string too, so it has to be rewritten here.
    this.renderFoilValue();
    this.renderNotificationDurationValue();
    this.renderClock();
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
    this.syncAnimationButtons();
    // Arriving on the page replays the demo: an animation is the one thing a picker can not
    // describe in words.
    this.playAnimationDemo();
    this.syncFoilSlider();
    this.syncSoundToggle();
    void this.syncDevToggle();
    this.renderClock();
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
    this.animationButtons.clear();
    this.demoCard = null;
    this.closeModal();
    this.isInitialized = false;
  }
}

export default SettingsView;

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
 *   - display   : one switch handing the scrollbars back to the system ("Affichage"), persisted in
 *                 `settings.nativeScrollbars` and applied by `ScrollHint.setNativeBars()`;
 *   - clock     : the trusted UTC time of the game (the header clock is hidden on a phone); it
 *                 lives in the "Game" section, next to the daily reset it explains;
 *   - account   : the immutable UUID (read-only) with a copy button;
 *   - save      : export, import (with a confirmation modal, because the current data is
 *                 replaced) and full reset (confirmation modal, UUID included);
 *   - distributions : "check the distributions" (reads the public Google Sheet through
 *                 `GiftManager.checkGifts()`, reports the outcome in an information modal and
 *                 links to the gift history), inside the "Gift" section with the promo codes and
 *                 the received gifts;
 *   - changelog : the release notes, drawn from `settings/changelog.json` (newest version first,
 *                 one note per line with its kind). The file is the only source: publishing a
 *                 version never touches this view.
 *
 *   - errors    : the last distinct incidents of the current release (`js/utils/ErrorLog.js`), with
 *                 their severity, their code and how often they were met. A MINOR incident never
 *                 opened a dialog, so this panel is the only place it can be read.
 *
 * SECTIONS
 * The panels above are grouped into seven sections (appearance, game, account, gift, premium, more
 * and the error report) and only one is displayed at a time, from the tab strip of the markup: the
 * page used to be a single column of a dozen panels, which nobody could scan. The selection is a
 * display concern only — every panel is rendered once, whether it is shown or not — and `app.js`
 * selects the section of a panel it has to reveal (the promo codes and the gift history live in the
 * gift one).
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
import cardLanguage from '../../utils/CardLanguage.js';
import themeManager from '../../utils/ThemeManager.js';
import animationManager from '../../utils/AnimationManager.js';
import glowManager from '../../utils/GlowManager.js';
import foilManager from '../../utils/FoilManager.js';
import boosterRenderManager from '../../utils/BoosterRenderManager.js';
import { configLoader, buildCardGenerateDefaults } from '../../utils/ConfigLoader.js';
import scrollHint from '../../utils/ScrollHint.js';
import soundManager, {
  DEFAULT_SOUND_CATEGORIES,
  SOUND_CATEGORIES,
  SOUND_CATEGORY_ORDER,
  SOUND_VOLUME_LEVELS,
  UI_SOUNDS,
} from '../../utils/SoundManager.js';
import accountManager, { DEFAULT_MINE_SPEED, MINE_SPEEDS } from '../../business/AccountManager.js';
import dateSyncManager from '../../business/DateSyncManager.js';
import { saveFile, getSaveErrorMessageKey, SAVE_EXTENSION } from '../../classes/SaveFile.js';
import giftManager, {
  getGiftErrorMessageKey,
  getGiftIgnoreReasonKey,
  GIFT_TYPES,
} from '../../business/GiftManager.js';
import autoClaimManager, { AUTO_CLAIM_REASONS } from '../../business/AutoClaimManager.js';
import Toast from '../components/Toast.js';
import notificationCenter from '../components/NotificationCenter.js';
import errorLog, { ERROR_SEVERITY } from '../../utils/ErrorLog.js';
import { applyShine } from '../components/CardComponent.js';
import cardSourceManager, {
  CARD_SOURCE,
  CARD_SOURCE_VALUES,
  DEFAULT_ANIMATED_LAYERS_SPEED,
  resolveAnimatedLayersDuration,
} from '../../utils/CardSourceManager.js';
import cardGenerateManager from '../../utils/CardGenerateManager.js';
import {
  CARD_RENDER_MODE,
  DEFAULT_CARD_RENDER_MODE,
  buildModeExport,
  findMode,
  getCardRenderModes,
  getModeLabel,
  isModeAvailable,
} from '../../utils/CardRenderManager.js';
import { CardPrint } from '../components/CardPrint.js';
import developerAccess from '../../utils/DeveloperAccess.js';
import { setDeveloperConsole } from '../../utils/ConsoleGate.js';
import socialManager from '../../business/SocialManager.js';
import saveSyncManager, {
  formatSyncTimestamp,
  getSaveSyncErrorMessageKey,
} from '../../business/SaveSyncManager.js';

/** View name, matching `data-view="settings"` in `index.html`. */
export const SETTINGS_VIEW_NAME = 'settings';

/**
 * Note kinds the game has a label for. Anything else keeps the word of the changelog file: a new
 * kind of note must never need a release of the game to be readable.
 */
const CHANGELOG_TYPES = ['feature', 'fix', 'qol'];

/**
 * Card drawn in the small preview of the "Card render" picker.
 *
 * It is a mythic so the preview also shows the foil and the accent of the frame, and it carries
 * the four fields `<card-print>` reads. The texts are translated lazily: the preview follows a
 * language change like every other label of the screen.
 */
const CARD_RENDER_SAMPLE = Object.freeze({
  id: 'SERIE-A1 / 001',
  index: 'SERIE-A1 / 001',
  rarity: 5,
  style: 'classic',
  background: 'assets/img/card_back.png',
  underlay: '',
  getName: () => i18n.t('settings.cardRender.sampleName'),
  getDescription: () => i18n.t('settings.cardRender.sampleDescription'),
});

/** Page the "buy" button of the premium offer opens, in a tab of its own. */
export const PREMIUM_OFFER_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ';

/**
 * What the premium offer advertises, in display order.
 *
 * ONE list for the two places that show it (the panel of the section and the dialog that buys it):
 * a benefit added here appears in both, and the two can never disagree on what is being sold.
 */
export const PREMIUM_PERK_KEYS = Object.freeze([
  'settings.premium.perk.boosters',
  'settings.premium.perk.card',
  'settings.premium.perk.legendary',
  'settings.premium.perk.sixcards',
  'settings.premium.perk.sparks',
  'settings.premium.perk.early',
  'settings.premium.perk.cardDiscount',
  'settings.premium.perk.illagerDiscount',
  'settings.premium.perk.traderMarkup',
]);

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
    this.tabsElement = query('[data-settings-tabs]');
    this.feedbackElement = query('[data-settings-feedback]');
    this.languageContainer = query('[data-settings-languages]');
    this.cardLanguageContainer = query('[data-settings-card-languages]');
    /** @type {Map<string, HTMLButtonElement>} Card language buttons, keyed by preference. */
    this.cardLanguageButtons = new Map();
    this.themeContainer = query('[data-settings-themes]');
    this.animationContainer = query('[data-settings-animations]');
    this.renderPanel = query('[data-settings-render-panel]');
    this.renderContainer = query('[data-settings-render]');
    this.renderDetailElement = query('[data-settings-render-detail]');
    this.changelogElement = query('[data-settings-changelog]');
    this.errorLogElement = query('[data-settings-error-log]');
    this.errorLogReleaseElement = query('[data-settings-error-release]');
    this.errorLogCopyButton = query('[data-settings-error-copy]');
    this.changelogAnnounceToggle = query('[data-settings-changelog-announce]');
    this.changelogAnnounceStateElement = query('[data-settings-changelog-announce-state]');
    /** @type {boolean} Last known state of the "new version" dialog preference. */
    this.changelogAnnounceEnabled = true;
    this.foilSlider = query('[data-settings-foil]');
    this.foilValueElement = query('[data-settings-foil-value]');
    this.glareSlider = query('[data-settings-glare]');
    this.glareValueElement = query('[data-settings-glare-value]');
    this.glowSlider = query('[data-settings-glow]');
    this.glowValueElement = query('[data-settings-glow-value]');
    this.notificationDurationSlider = query('[data-settings-notification-duration]');
    this.notificationDurationValue = query('[data-settings-notification-duration-value]');
    this.mineSpeedSlider = query('[data-settings-mine-speed]');
    this.mineSpeedValue = query('[data-settings-mine-speed-value]');
    this.socialRefreshSlider = query('[data-settings-social-refresh]');
    this.socialRefreshValueElement = query('[data-settings-social-refresh-value]');
    this.questTutorialToggle = query('[data-settings-quest-tutorial]');
    this.questTutorialStateElement = query('[data-settings-quest-tutorial-state]');
    this.notificationToggles = {
      collection: query('[data-settings-notification-collection]'),
      experience: query('[data-settings-notification-experience]'),
      title: query('[data-settings-notification-title]'),
      quest: query('[data-settings-notification-quest]'),
      trade: query('[data-settings-notification-trade]'),
    };
    this.notificationStateElements = {
      collection: query('[data-settings-notification-collection-state]'),
      experience: query('[data-settings-notification-experience-state]'),
      title: query('[data-settings-notification-title-state]'),
      quest: query('[data-settings-notification-quest-state]'),
      trade: query('[data-settings-notification-trade-state]'),
    };
    this.demoStage = query('[data-animation-demo-stage]');
    this.demoTiles = query('[data-animation-demo-tiles]');
    this.demoPlayButton = query('[data-animation-demo-play]');
    this.soundToggle = query('[data-settings-sound]');
    this.soundStateElement = query('[data-settings-sound-state]');
    this.soundCategoriesElement = query('[data-settings-sound-categories]');
    this.soundHelpElement = query('[data-settings-sound-help]');
    this.devToggle = query('[data-settings-dev]');
    this.devModeStateElement = query('[data-settings-dev-state]');
    this.advancedDevPanel = query('[data-settings-advanced-dev-panel]');
    this.advancedDevToggle = query('[data-settings-advanced-dev]');
    this.advancedDevStateElement = query('[data-settings-advanced-dev-state]');
    this.cardSourcePanel = query('[data-settings-card-source-panel]');
    this.cardSourceContainer = query('[data-settings-card-source]');
    this.cardGenerateBody = query('[data-settings-cardgen-content]');
    this.cardGenerateSpeedsContainer = query('[data-settings-cardgen-speeds]');
    this.cardGenerateZoomSlider = query('[data-settings-cardgen-zoom]');
    this.cardGenerateZoomValue = query('[data-settings-cardgen-zoom-value]');
    this.cardGenerateBlurSlider = query('[data-settings-cardgen-blur]');
    this.cardGenerateBlurValue = query('[data-settings-cardgen-blur-value]');
    this.cardGenerateRaritiesContainer = query('[data-settings-cardgen-rarities]');
    this.cardGenerateBorderSlider = query('[data-settings-cardgen-border]');
    this.cardGenerateBorderValue = query('[data-settings-cardgen-border-value]');
    this.cardGenerateHeaderSlider = query('[data-settings-cardgen-header]');
    this.cardGenerateHeaderValue = query('[data-settings-cardgen-header-value]');
    this.cardGenerateBodySlider = query('[data-settings-cardgen-body]');
    this.cardGenerateBodyValue = query('[data-settings-cardgen-body-value]');
    this.cardGenerateResetButton = query('[data-settings-cardgen-reset]');
    this.cardGenerateCopyButton = query('[data-settings-cardgen-copy]');
    this.cardGenerateUnderlayZoomSlider = query('[data-settings-cardgen-underlay-zoom]');
    this.cardGenerateUnderlayZoomValue = query('[data-settings-cardgen-underlay-zoom-value]');
    this.cardGenerateStillBackgroundSlider = query('[data-settings-cardgen-still-background]');
    this.cardGenerateStillBackgroundValue = query('[data-settings-cardgen-still-background-value]');
    this.cardGenerateStillUnderlaySlider = query('[data-settings-cardgen-still-underlay]');
    this.cardGenerateStillUnderlayValue = query('[data-settings-cardgen-still-underlay-value]');
    this.cardRenderContainer = query('[data-settings-card-render]');
    this.cardRenderStage = query('[data-settings-card-render-stage]');
    this.animatedLayersToggle = query('[data-settings-animated-layers]');
    this.animatedLayersStateElement = query('[data-settings-animated-layers-state]');
    this.animatedLayersSpeedSlider = query('[data-settings-animated-layers-speed]');
    this.animatedLayersSpeedValueElement = query('[data-settings-animated-layers-speed-value]');
    this.cardGenerateLayerTogglesContainer = query('[data-settings-cardgen-layers]');
    /** @type {Map<string, {toggle: HTMLButtonElement, state: HTMLElement|null}>} */
    this.cardGenerateLayerToggles = new Map(
      [...this.root.querySelectorAll('[data-settings-cardgen-layer][data-settings-cardgen-layout]')]
        .map((toggle) => [
          `${toggle.dataset.settingsCardgenLayout}:${toggle.dataset.settingsCardgenLayer}`,
          { toggle, state: toggle.querySelector('.switch__state') },
        ])
    );
    this.nativeScrollbarsToggle = query('[data-settings-native-scrollbars]');
    this.nativeScrollbarsStateElement = query('[data-settings-native-scrollbars-state]');
    this.clockElement = query('[data-settings-utc]');
    this.clockDayElement = query('[data-settings-utc-day]');
    this.uuidElement = query('[data-settings-uuid]');
    this.copyButton = query('[data-settings-copy]');
    this.authCodeElement = query('[data-settings-auth-code]');
    this.authCodeCopyButton = query('[data-settings-auth-code-copy]');
    this.authCodeEmptyElement = query('[data-settings-auth-code-empty]');
    this.authCodeDevPanel = query('[data-settings-auth-code-dev]');
    this.authCodeInput = query('[data-settings-auth-code-input]');
    this.authCodeSaveButton = query('[data-settings-auth-code-save]');
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
    this.onlineUploadButton = query('[data-settings-online-upload]');
    this.onlineDownloadButton = query('[data-settings-online-download]');
    this.onlineStatusElement = query('[data-settings-online-status]');
    this.onlineModal = query('[data-settings-online-modal]');
    this.onlineModalTitle = query('[data-settings-online-title]');
    this.onlineModalDate = query('[data-settings-online-date]');
    this.onlineBackupToggle = query('[data-settings-online-backup]');
    this.onlineBackupStateElement = query('[data-settings-online-backup-state]');
    this.onlineModalClose = query('[data-settings-online-close]');
    this.onlineModalCancel = query('[data-settings-online-cancel]');
    this.onlineModalConfirm = query('[data-settings-online-confirm]');
    this.premiumPerksElement = query('[data-settings-premium-perks]');
    this.premiumOpenButton = query('[data-settings-premium-open]');
    this.premiumModal = query('[data-settings-premium-modal]');
    this.premiumTitle = query('[data-settings-premium-title]');
    this.premiumBody = query('[data-settings-premium-body]');
    this.premiumClose = query('[data-settings-premium-close]');
    this.premiumCancel = query('[data-settings-premium-cancel]');
    this.premiumBuy = query('[data-settings-premium-buy]');

    /** @type {Map<string, HTMLButtonElement>} Tab buttons, keyed by section name. */
    this.tabButtons = new Map(
      [...this.root.querySelectorAll('[data-settings-tab]')].map((button) => [
        button.dataset.settingsTab,
        button,
      ])
    );
    /** @type {Map<string, HTMLElement>} Tab panels, keyed by section name. */
    this.tabPanels = new Map(
      [...this.root.querySelectorAll('[data-settings-tabpanel]')].map((panel) => [
        panel.dataset.settingsTabpanel,
        panel,
      ])
    );

    this.assertMarkup();

    /** @type {string|null} Section on screen (null until `renderTabs()` picks one). */
    this.activeTab = null;
    /** @type {boolean} True once `init()` bound everything. */
    this.isInitialized = false;
    /** @type {boolean} True when the view is the active one. */
    this.isActive = false;
    /** @type {boolean} True while an export/import/reset runs. */
    this.isBusy = false;
    /** @type {boolean} Last known developer mode (the store is the source of truth). */
    this.devMode = false;
    /** @type {boolean} Advanced mode after checking the developer allowlist. */
    this.advancedDevMode = false;
    /** @type {string} Effective card source (`image` or `generate`), derived from the render mode. */
    this.cardSource = CARD_SOURCE.IMAGE;
    /** @type {string} Entry of the "Card render" picker that produced `cardSource`. */
    this.cardRenderMode = DEFAULT_CARD_RENDER_MODE;
    /** @type {Array<object>} Card render presets (`settings/cardrender.json`). */
    this.cardRenderModes = [];
    /** @type {boolean} Whether the generated card layers move (off by default). */
    this.animatedLayers = false;
    /** @type {number} Animation speed, in percent of the reference 30-second cycle. */
    this.animatedLayersSpeed = DEFAULT_ANIMATED_LAYERS_SPEED;
    /** @type {object|null} Validated `cardGenerate` configuration (ranges and default design). */
    this.cardGenerateConfig = null;
    /** @type {object|null} Account values of the generated-card design. */
    this.cardGenerate = null;
    /** @type {boolean} Last known scrollbar preference (the store is the source of truth). */
    this.nativeScrollbars = false;
    /** @type {number} Duration of one notification, in seconds. */
    this.notificationDuration = 3;
    /** @type {Record<string, boolean>} Allowed notification kinds. */
    this.notificationTypes = { collection: true, experience: true, title: true, quest: true, trade: true };
    /** @type {string} Speed of the automatic mining (`normal`, `fast` or `veryFast`). */
    this.mineSpeed = DEFAULT_MINE_SPEED;
    /** @type {number} Minimum delay between two reads of a followed card, in minutes. */
    this.socialRefreshMinutes = 2;
    /** @type {boolean} Walk the player through the screens on "Y aller" (the store is the source). */
    this.questTutorial = true;
    /** @type {string|null} UUID of the current account (read-only display). */
    this.uuid = null;
    /** @type {string} Secret code of the social publication (empty before the first one). */
    this.authCode = '';
    /** @type {{key: string, tone: string, params: object|null}|null} Last feedback message. */
    this.feedback = null;
    /** @type {{mode: 'confirm'|'info', titleKey: string, bodyKey: string|null,
     *   params: object|null, report: object|null, confirmVariant: string,
     *   onConfirm: Function|null}|null} */
    this.pendingModal = null;
    /** @type {boolean} True once the premium dialog was used: it then only offers to close. */
    this.premiumUsed = false;
    /** @type {boolean} Whether the current game is downloaded before an online load. */
    this.onlineBackup = false;
    /** @type {string|null} Server date of the save the download dialog offers. */
    this.onlineSavedAt = null;
    /** @type {{key: string, tone: string, params: object|null}|null} Last online message. */
    this.onlineStatus = null;

    /** @type {Map<string, HTMLButtonElement>} Language buttons, keyed by language code. */
    this.languageButtons = new Map();
    /** @type {Map<string, HTMLButtonElement>} Theme buttons, keyed by theme id. */
    this.themeButtons = new Map();
    /** @type {Map<string, HTMLButtonElement>} Animation buttons, keyed by mode id. */
    this.animationButtons = new Map();
    /** @type {Map<string, HTMLButtonElement>} Booster render buttons, keyed by mode id. */
    this.renderButtons = new Map();
    /** @type {Map<string, HTMLButtonElement>} Card source buttons, keyed by source id. */
    this.cardSourceButtons = new Map();
    /** @type {Map<string, HTMLButtonElement>} Card render buttons, keyed by mode id. */
    this.cardRenderButtons = new Map();
    /** @type {Map<string, HTMLButtonElement>} Card Generate sub-tab buttons. */
    this.cardGenerateTabButtons = new Map();
    /** @type {Map<string, HTMLElement>} Card Generate sub-tab panels. */
    this.cardGeneratePanels = new Map();
    /** @type {Map<number, HTMLButtonElement>} Speed preset buttons of the Animation panel. */
    this.cardGenerateSpeedButtons = new Map();
    /** @type {Map<number, object>} Inputs of one rarity row, keyed by rarity level. */
    this.cardGenerateRarityControls = new Map();
    /** @type {Map<string, {switch: HTMLButtonElement, state: HTMLElement,
     *   slider: HTMLInputElement, output: HTMLOutputElement}>} Sound family controls. */
    this.soundCategoryControls = new Map();
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
      ['[data-settings-tabs]', this.tabsElement],
      ['[data-settings-tabpanel="appearance"]', this.tabPanels.get('appearance')],
      ['[data-settings-tabpanel="game"]', this.tabPanels.get('game')],
      ['[data-settings-tabpanel="account"]', this.tabPanels.get('account')],
      ['[data-settings-tabpanel="gift"]', this.tabPanels.get('gift')],
      ['[data-settings-tabpanel="premium"]', this.tabPanels.get('premium')],
      ['[data-settings-tabpanel="more"]', this.tabPanels.get('more')],
      ['[data-settings-tabpanel="errors"]', this.tabPanels.get('errors')],
      ['[data-settings-languages]', this.languageContainer],
      ['[data-settings-card-languages]', this.cardLanguageContainer],
      ['[data-settings-error-log]', this.errorLogElement],
      ['[data-settings-error-copy]', this.errorLogCopyButton],
      ['[data-settings-themes]', this.themeContainer],
      ['[data-settings-animations]', this.animationContainer],
      ['[data-settings-foil]', this.foilSlider],
      ['[data-settings-foil-value]', this.foilValueElement],
      ['[data-settings-glare]', this.glareSlider],
      ['[data-settings-glare-value]', this.glareValueElement],
      ['[data-settings-glow]', this.glowSlider],
      ['[data-settings-glow-value]', this.glowValueElement],
      ['[data-settings-changelog-announce]', this.changelogAnnounceToggle],
      ['[data-settings-notification-duration]', this.notificationDurationSlider],
      ['[data-settings-notification-duration-value]', this.notificationDurationValue],
      ['[data-settings-mine-speed]', this.mineSpeedSlider],
      ['[data-settings-mine-speed-value]', this.mineSpeedValue],
      ['[data-settings-social-refresh]', this.socialRefreshSlider],
      ['[data-settings-social-refresh-value]', this.socialRefreshValueElement],
      ['[data-settings-quest-tutorial]', this.questTutorialToggle],
      ['[data-settings-quest-tutorial-state]', this.questTutorialStateElement],
      ['[data-settings-notification-collection]', this.notificationToggles.collection],
      ['[data-settings-notification-experience]', this.notificationToggles.experience],
      ['[data-settings-notification-title]', this.notificationToggles.title],
      ['[data-settings-notification-quest]', this.notificationToggles.quest],
      ['[data-settings-notification-trade]', this.notificationToggles.trade],
      ['[data-animation-demo-stage]', this.demoStage],
      ['[data-animation-demo-tiles]', this.demoTiles],
      ['[data-animation-demo-play]', this.demoPlayButton],
      ['[data-settings-render-panel]', this.renderPanel],
      ['[data-settings-render]', this.renderContainer],
      ['[data-settings-render-detail]', this.renderDetailElement],
      ['[data-settings-sound]', this.soundToggle],
      ['[data-settings-sound-state]', this.soundStateElement],
      ['[data-settings-sound-categories]', this.soundCategoriesElement],
      ['[data-settings-dev]', this.devToggle],
      ['[data-settings-dev-state]', this.devModeStateElement],
      ['[data-settings-advanced-dev-panel]', this.advancedDevPanel],
      ['[data-settings-advanced-dev]', this.advancedDevToggle],
      ['[data-settings-advanced-dev-state]', this.advancedDevStateElement],
      ['[data-settings-card-source-panel]', this.cardSourcePanel],
      ['[data-settings-card-source]', this.cardSourceContainer],
      ['[data-settings-cardgen-content]', this.cardGenerateBody],
      ['[data-settings-cardgen-speeds]', this.cardGenerateSpeedsContainer],
      ['[data-settings-cardgen-zoom]', this.cardGenerateZoomSlider],
      ['[data-settings-cardgen-zoom-value]', this.cardGenerateZoomValue],
      ['[data-settings-cardgen-blur]', this.cardGenerateBlurSlider],
      ['[data-settings-cardgen-blur-value]', this.cardGenerateBlurValue],
      ['[data-settings-cardgen-rarities]', this.cardGenerateRaritiesContainer],
      ['[data-settings-cardgen-border]', this.cardGenerateBorderSlider],
      ['[data-settings-cardgen-border-value]', this.cardGenerateBorderValue],
      ['[data-settings-cardgen-header]', this.cardGenerateHeaderSlider],
      ['[data-settings-cardgen-header-value]', this.cardGenerateHeaderValue],
      ['[data-settings-cardgen-body]', this.cardGenerateBodySlider],
      ['[data-settings-cardgen-body-value]', this.cardGenerateBodyValue],
      ['[data-settings-cardgen-reset]', this.cardGenerateResetButton],
      ['[data-settings-cardgen-copy]', this.cardGenerateCopyButton],
      ['[data-settings-cardgen-underlay-zoom]', this.cardGenerateUnderlayZoomSlider],
      ['[data-settings-cardgen-underlay-zoom-value]', this.cardGenerateUnderlayZoomValue],
      ['[data-settings-cardgen-still-background]', this.cardGenerateStillBackgroundSlider],
      ['[data-settings-cardgen-still-background-value]', this.cardGenerateStillBackgroundValue],
      ['[data-settings-cardgen-still-underlay]', this.cardGenerateStillUnderlaySlider],
      ['[data-settings-cardgen-still-underlay-value]', this.cardGenerateStillUnderlayValue],
      ['[data-settings-card-render]', this.cardRenderContainer],
      ['[data-settings-card-render-stage]', this.cardRenderStage],
      ['[data-settings-animated-layers]', this.animatedLayersToggle],
      ['[data-settings-animated-layers-state]', this.animatedLayersStateElement],
      ['[data-settings-animated-layers-speed]', this.animatedLayersSpeedSlider],
      ['[data-settings-animated-layers-speed-value]', this.animatedLayersSpeedValueElement],
      ['[data-settings-cardgen-layers]', this.cardGenerateLayerTogglesContainer],
      ['[data-settings-native-scrollbars]', this.nativeScrollbarsToggle],
      ['[data-settings-native-scrollbars-state]', this.nativeScrollbarsStateElement],
      ['[data-settings-utc]', this.clockElement],
      ['[data-settings-uuid]', this.uuidElement],
      ['[data-settings-copy]', this.copyButton],
      ['[data-settings-auth-code]', this.authCodeElement],
      ['[data-settings-auth-code-copy]', this.authCodeCopyButton],
      ['[data-settings-auth-code-empty]', this.authCodeEmptyElement],
      ['[data-settings-auth-code-dev]', this.authCodeDevPanel],
      ['[data-settings-auth-code-input]', this.authCodeInput],
      ['[data-settings-auth-code-save]', this.authCodeSaveButton],
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
      ['[data-settings-online-upload]', this.onlineUploadButton],
      ['[data-settings-online-download]', this.onlineDownloadButton],
      ['[data-settings-online-status]', this.onlineStatusElement],
      ['[data-settings-online-modal]', this.onlineModal],
      ['[data-settings-online-title]', this.onlineModalTitle],
      ['[data-settings-online-date]', this.onlineModalDate],
      ['[data-settings-online-backup]', this.onlineBackupToggle],
      ['[data-settings-online-backup-state]', this.onlineBackupStateElement],
      ['[data-settings-online-close]', this.onlineModalClose],
      ['[data-settings-online-cancel]', this.onlineModalCancel],
      ['[data-settings-online-confirm]', this.onlineModalConfirm],
      ['[data-settings-premium-perks]', this.premiumPerksElement],
      ['[data-settings-premium-open]', this.premiumOpenButton],
      ['[data-settings-premium-modal]', this.premiumModal],
      ['[data-settings-premium-title]', this.premiumTitle],
      ['[data-settings-premium-body]', this.premiumBody],
      ['[data-settings-premium-close]', this.premiumClose],
      ['[data-settings-premium-cancel]', this.premiumCancel],
      ['[data-settings-premium-buy]', this.premiumBuy],
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
    this.renderTabs();
    await this.renderLanguageSelector();
    await this.renderCardLanguageSelector();
    await this.renderThemeSelector();
    await this.renderAnimationSelector();
    this.renderRenderSelector();
    this.renderAnimationDemo();
    this.renderPremiumPerks();
    this.renderFoilSlider();
    this.renderGlareSlider();
    this.renderGlowSlider();
    await this.renderNotificationSettings();
    await this.renderSocialRefresh();
    await this.renderMineSpeed();
    await this.renderCardGenerateControls();
    await this.renderQuestTutorial();
    this.syncSoundToggle();
    this.renderSoundCategories();
    await this.syncDevToggle();
    await this.renderCardRenderSelector();
    this.renderCardSourceSelector();
    await this.syncNativeScrollbarsToggle();
    await this.renderAccount();
    this.renderClock();
    await this.renderChangelog();
    await this.syncChangelogAnnounceToggle();
    this.renderErrorLog();
    this.bindEvents();
    this.subscribeToEvents();
    this.log(
      `Ready (lang: ${i18n.getLang()}, theme: ${themeManager.getTheme()}, animation: ${animationManager.getMode()}).`
    );
  }

  /**
   * Wires the tab strip and displays its first section.
   *
   * The buttons live in the markup, one per section, each carrying the id of the panel it controls:
   * adding a section is therefore a markup change, and every panel keeps being rendered normally
   * (a hidden panel is only `display: none`, never unmounted).
   *
   * @returns {void}
   */
  renderTabs() {
    if (!this.tabsElement) return;

    this.tabButtons.forEach((button, name) => {
      if (!this.tabPanels.has(name)) {
        console.warn(`[SettingsView] The tab "${name}" controls no panel; it is hidden.`);
        button.hidden = true;
        return;
      }
      button.addEventListener('click', () => this.showTab(name));
    });

    const first = this.tabButtons.keys().next().value ?? null;
    this.showTab(first, { silent: true });
  }

  /**
   * Shows one section and hides the others.
   *
   * The whole selection is driven by `aria-selected` and the `hidden` attribute, never by removing
   * elements: a panel that is shown again keeps its rendered content (the demo card, the changelog,
   * the generated pickers) exactly as it was. The strip follows the roving tabindex pattern, where
   * only the active button is reachable with Tab and the arrows move inside the strip.
   *
   * @param {string|null} name - Section to display.
   * @param {object} [options] - Display options.
   * @param {boolean} [options.silent=false] - Skips the sound and the log (used at startup, where
   *   nothing was clicked).
   * @returns {void}
   */
  showTab(name, { silent = false } = {}) {
    if (typeof name !== 'string' || !this.tabPanels.has(name)) return;
    if (this.activeTab === name && !silent) return;

    this.activeTab = name;
    this.tabButtons.forEach((button, key) => {
      const isActive = key === name;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-selected', isActive ? 'true' : 'false');
      button.tabIndex = isActive ? 0 : -1;
    });
    this.tabPanels.forEach((panel, key) => {
      panel.hidden = key !== name;
    });

    if (silent) return;
    // The changelog has a quest of its own: showing the panel is the visit it counts.
    if (name === 'more') eventBus.emit(EVENTS.CHANGELOG_OPENED);
    soundManager.playUi(UI_SOUNDS.SECTION_SWITCH);
    this.log(`Section "${name}" displayed.`);
  }

  /**
   * Moves the selection with the keyboard, as a tab list is expected to answer.
   *
   * @param {KeyboardEvent} event - Key pressed inside the strip.
   * @returns {void}
   */
  handleTabKeyDown(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const names = [...this.tabButtons.keys()].filter((name) => this.tabPanels.has(name));
    if (names.length === 0) return;

    event.preventDefault();
    const current = Math.max(names.indexOf(this.activeTab), 0);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? names.length - 1
          : event.key === 'ArrowLeft'
            ? (current - 1 + names.length) % names.length
            : (current + 1) % names.length;

    this.showTab(names[next]);
    this.tabButtons.get(names[next])?.focus();
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
   * Renders one button per booster render mode declared in `config.json`.
   *
   * The picker is a developer tool: the whole panel stays hidden until the developer mode is on
   * (`syncRenderPanelVisibility`), and the visible labels come from the `labelKey` of each mode so
   * a new recipe only needs a translation entry. Choosing a mode retunes the live 3D scenes through
   * `boosterRenderManager`, then persists the id in `settings.boosterRenderMode`.
   *
   * @returns {void}
   */
  renderRenderSelector() {
    if (!this.renderContainer) return;

    const modes = boosterRenderManager.getModes();
    this.renderContainer.textContent = '';
    this.renderButtons.clear();

    modes.forEach(({ id, labelKey }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'lang-switch__option';
      button.dataset.renderId = id;
      button.textContent = i18n.t(labelKey);
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => void this.handleRenderModeChange(id));
      this.renderContainer.appendChild(button);
      this.renderButtons.set(id, button);
    });

    this.syncRenderButtons();
    this.renderRenderDetail();
  }

  /**
   * Reflects the active booster render mode on the picker buttons.
   *
   * @returns {void}
   */
  syncRenderButtons() {
    const current = boosterRenderManager.getMode();
    this.renderButtons.forEach((button, id) => {
      const isActive = id === current;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  }

  /**
   * Writes the description of the active booster render mode under the picker.
   *
   * @returns {void}
   */
  renderRenderDetail() {
    if (!this.renderDetailElement) return;
    const { helpKey } = boosterRenderManager.getRenderSettings();
    this.renderDetailElement.textContent = helpKey ? i18n.t(helpKey) : '';
  }

  /**
   * Shows the booster render panel only when the developer mode is on.
   *
   * @returns {void}
   */
  syncRenderPanelVisibility() {
    if (this.renderPanel) {
      this.renderPanel.hidden = !this.devMode;
    }
  }

  /**
   * Shows the advanced developer switch only under the normal developer mode.
   *
   * It stays visible to an unauthorized account so that checking it opens the explanation modal.
   *
   * @returns {void}
   */
  syncAdvancedDevPanelVisibility() {
    if (this.advancedDevPanel) {
      this.advancedDevPanel.hidden = !this.devMode;
    }
  }

  /**
   * Reflects the effective advanced developer mode on its switch.
   *
   * @returns {void}
   */
  syncAdvancedDevToggle() {
    if (this.advancedDevToggle) {
      this.advancedDevToggle.setAttribute('aria-checked', this.advancedDevMode ? 'true' : 'false');
    }
    if (this.advancedDevStateElement) {
      this.advancedDevStateElement.textContent = i18n.t(
        this.advancedDevMode ? 'settings.advancedDev.on' : 'settings.advancedDev.off'
      );
    }
    this.syncAdvancedDevPanelVisibility();
  }

  /**
   * Checks the shipped allowlist for the current account.
   *
   * A missing file or a storage failure denies the access instead of throwing: advanced options
   * are an explicit privilege, never a best-effort default.
   *
   * @returns {Promise<boolean>} True when this account may use the advanced options.
   */
  async hasAdvancedDeveloperAccess() {
    try {
      const uuid = await accountManager.getUuid();
      return await developerAccess.isAdvancedDeveloper(uuid);
    } catch (error) {
      console.warn('[SettingsView] The advanced developer allowlist could not be checked.', error);
      return false;
    }
  }

  /**
   * Renders the two card sources: `Custom` (generated) and `Default` (images).
   *
   * The panel is an advanced developer tool, so `syncCardSourcePanelVisibility()` keeps it hidden
   * until both developer modes are on. The labels come from the translation files, while the
   * stored values are the two ids of `CARD_SOURCE`. The picker is the "render mode" of the
   * Appearance panel seen from the developer side: `Custom` selects the design edited here, which
   * is also what `CardRenderManager.CARD_RENDER_MODE.CUSTOM` stores.
   *
   * @returns {void}
   */
  renderCardSourceSelector() {
    if (!this.cardSourceContainer) return;

    this.cardSourceContainer.textContent = '';
    this.cardSourceButtons.clear();
    [
      { id: CARD_SOURCE.GENERATE, labelKey: 'settings.cardSource.custom' },
      { id: CARD_SOURCE.IMAGE, labelKey: 'settings.cardSource.default' },
    ].forEach(({ id, labelKey }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'lang-switch__option';
      button.dataset.cardSourceId = id;
      button.textContent = i18n.t(labelKey);
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => void this.handleCardSourceChange(id));
      this.cardSourceContainer.appendChild(button);
      this.cardSourceButtons.set(id, button);
    });

    this.syncCardSourceButtons();
    this.syncCardSourcePanelVisibility();
  }

  /**
   * Reflects the stored source on the picker buttons.
   *
   * @returns {void}
   */
  syncCardSourceButtons() {
    const active = this.resolveActiveCardRenderMode();
    this.cardSourceButtons.forEach((button, id) => {
      // A preset also renders the generated source, but it is NOT the `Custom` design: only
      // `Default` and `Custom` themselves light up, so the panel never claims the account renders a
      // design nobody picked here.
      const isActive =
        active === CARD_RENDER_MODE.IMAGES
          ? id === CARD_SOURCE.IMAGE
          : active === CARD_RENDER_MODE.CUSTOM && id === CARD_SOURCE.GENERATE;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  }

  /**
   * Shows the card source panel only when both developer modes are on.
   *
   * @returns {void}
   */
  syncCardSourcePanelVisibility() {
    if (this.cardSourcePanel) {
      this.cardSourcePanel.hidden = !(this.devMode && this.advancedDevMode);
    }
    this.syncAnimatedLayersVisibility();
  }

  /**
   * Shows the animated-layers switch only for the generated source.
   *
   * @returns {void}
   */
  syncAnimatedLayersVisibility() {
    // The whole generated-card module follows the source: the speed and the construction are
    // meaningful even while the layers are still, so only the source hides them.
    if (this.cardGenerateBody) {
      this.cardGenerateBody.hidden = !(
        this.devMode && this.advancedDevMode && this.cardSource === CARD_SOURCE.GENERATE
      );
    }
  }

  /**
   * Builds the Animation and Construction panels of Card Generate.
   *
   * @returns {Promise<void>} Resolves once the controls exist and the module is applied.
   */
  async renderCardGenerateControls() {
    this.cardGenerateConfig = await configLoader.getCardGenerateSettings();
    this.cardGenerate = buildCardGenerateDefaults(this.cardGenerateConfig);

    const ranges = [
      [this.cardGenerateZoomSlider, this.cardGenerateConfig.animation.zoom],
      [this.cardGenerateUnderlayZoomSlider, this.cardGenerateConfig.animation.zoomUnderlay],
      [this.cardGenerateStillBackgroundSlider, this.cardGenerateConfig.animation.stillScale],
      [this.cardGenerateStillUnderlaySlider, this.cardGenerateConfig.animation.stillScale],
      [this.cardGenerateBlurSlider, this.cardGenerateConfig.animation.blur],
      [this.cardGenerateBorderSlider, this.cardGenerateConfig.construction.borderWidth],
      [this.cardGenerateHeaderSlider, this.cardGenerateConfig.construction.headerHeight],
      [this.cardGenerateBodySlider, this.cardGenerateConfig.construction.bodyHeight],
    ];
    ranges.forEach(([slider, range]) => {
      slider.min = String(range.min);
      slider.max = String(range.max);
      slider.step = String(range.step);
    });

    const speedRange = this.cardGenerateConfig.animation.speed;
    this.animatedLayersSpeedSlider.min = String(speedRange.min);
    this.animatedLayersSpeedSlider.max = String(speedRange.max);
    this.animatedLayersSpeedSlider.step = String(speedRange.step);
    if (!Number.isFinite(this.animatedLayersSpeed)) {
      this.animatedLayersSpeed = speedRange.default;
    }

    this.cardGenerateTabButtons = new Map(
      [...this.root.querySelectorAll('[data-cardgen-tab]')].map((button) => [
        button.dataset.cardgenTab,
        button,
      ])
    );
    this.cardGeneratePanels = new Map(
      [...this.root.querySelectorAll('[data-cardgen-panel]')].map((panel) => [
        panel.dataset.cardgenPanel,
        panel,
      ])
    );
    this.cardGenerateTabButtons.forEach((button, name) => {
      this.listen(button, 'click', () => this.showCardGenerateTab(name));
    });

    this.renderCardGenerateSpeedPresets();
    this.renderCardGenerateRarities();
    this.showCardGenerateTab('animation');
    this.syncCardGenerateControls();
    this.applyCardGenerate();
  }

  /**
   * Shows one of the two Card Generate panels.
   *
   * @param {string} name - `animation` or `construction`.
   * @returns {void}
   */
  showCardGenerateTab(name) {
    if (!this.cardGeneratePanels.has(name)) return;
    this.cardGenerateTabButtons.forEach((button, key) => {
      const isActive = key === name;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-selected', isActive ? 'true' : 'false');
      button.tabIndex = isActive ? 0 : -1;
    });
    this.cardGeneratePanels.forEach((panel, key) => {
      panel.hidden = key !== name;
    });
  }

  /**
   * Draws the quick speed buttons declared by `cardGenerate.animation.speeds`.
   *
   * @returns {void}
   */
  renderCardGenerateSpeedPresets() {
    if (!this.cardGenerateSpeedsContainer || !this.cardGenerateConfig) return;
    this.cardGenerateSpeedsContainer.textContent = '';
    this.cardGenerateSpeedButtons.clear();
    this.cardGenerateConfig.animation.speeds.forEach((speed) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'lang-switch__option';
      button.dataset.cardgenSpeed = String(speed);
      button.textContent = `${speed} %`;
      button.setAttribute('aria-pressed', 'false');
      this.listen(button, 'click', () => this.handleCardGenerateSpeedPreset(speed));
      this.cardGenerateSpeedsContainer.appendChild(button);
      this.cardGenerateSpeedButtons.set(speed, button);
    });
    this.syncCardGenerateSpeedButtons();
  }

  /**
   * Builds one construction row per rarity.
   *
   * @returns {void}
   */
  renderCardGenerateRarities() {
    if (!this.cardGenerateRaritiesContainer || !this.cardGenerateConfig || !this.cardGenerate) {
      return;
    }
    this.cardGenerateRaritiesContainer.textContent = '';
    this.cardGenerateRarityControls.clear();

    this.cardGenerateConfig.construction.rarities.forEach((rarity) => {
      const current = this.cardGenerate.construction.rarities[rarity.id] ?? rarity;
      const row = document.createElement('div');
      row.className = 'settings__rarity-row';
      row.dataset.cardgenRarity = String(rarity.id);

      const title = document.createElement('h5');
      title.textContent = i18n.t(rarity.labelKey);
      row.appendChild(title);

      const fields = document.createElement('div');
      fields.className = 'settings__rarity-fields';

      const addColorField = (labelKey, field, hexField, value) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'settings__rarity-field';
        const label = document.createElement('span');
        label.className = 'settings__rarity-field-label';
        label.textContent = i18n.t(labelKey);
        const controls = document.createElement('div');
        controls.className = 'settings__rarity-color-controls';
        const color = document.createElement('input');
        color.type = 'color';
        color.className = 'settings__rarity-color';
        color.value = value;
        color.dataset.cardgenField = field;
        color.setAttribute(
          'aria-label',
          `${i18n.t(rarity.labelKey)} : ${i18n.t(labelKey)}`
        );
        const hex = document.createElement('input');
        hex.type = 'text';
        hex.className = 'settings__rarity-hex';
        hex.value = value;
        hex.maxLength = 7;
        hex.spellcheck = false;
        hex.dataset.cardgenField = hexField;
        hex.setAttribute(
          'aria-label',
          `${i18n.t(rarity.labelKey)} : ${i18n.t(labelKey)}`
        );
        controls.append(color, hex);
        wrapper.append(label, controls);
        fields.appendChild(wrapper);
        return { color, hex };
      };

      const color = addColorField(
        'settings.cardGenerate.frameColor',
        'color',
        'colorHex',
        current.color
      );
      const accent = addColorField(
        'settings.cardGenerate.accentColor',
        'accent',
        'accentHex',
        current.accent
      );
      const symbolColor = addColorField(
        'settings.cardGenerate.symbolColor',
        'symbolColor',
        'symbolColorHex',
        current.symbolColor
      );

      const symbolWrapper = document.createElement('div');
      symbolWrapper.className = 'settings__rarity-field';
      const symbolLabel = document.createElement('span');
      symbolLabel.className = 'settings__rarity-field-label';
      symbolLabel.textContent = i18n.t('settings.cardGenerate.symbol');
      const symbol = document.createElement('input');
      symbol.type = 'text';
      symbol.className = 'settings__rarity-symbol';
      symbol.value = current.symbol;
      symbol.maxLength = 8;
      symbol.spellcheck = false;
      symbol.dataset.cardgenField = 'symbol';
      symbol.setAttribute(
        'aria-label',
        `${i18n.t(rarity.labelKey)} : ${i18n.t('settings.cardGenerate.symbol')}`
      );
      symbolWrapper.append(symbolLabel, symbol);
      fields.appendChild(symbolWrapper);

      row.appendChild(fields);
      this.cardGenerateRaritiesContainer.appendChild(row);
      this.cardGenerateRarityControls.set(rarity.id, {
        color: color.color,
        colorHex: color.hex,
        accent: accent.color,
        accentHex: accent.hex,
        symbolColor: symbolColor.color,
        symbolColorHex: symbolColor.hex,
        symbol,
      });
    });
  }

  /**
   * Reflects the current design on every control of the module.
   *
   * @returns {void}
   */
  syncCardGenerateControls() {
    if (!this.cardGenerate) return;
    this.cardGenerateZoomSlider.value = String(this.cardGenerate.animation.zoomBackground);
    this.cardGenerateUnderlayZoomSlider.value = String(this.cardGenerate.animation.zoomUnderlay);
    this.cardGenerateStillBackgroundSlider.value = String(
      this.cardGenerate.animation.still.background.classic
    );
    this.cardGenerateStillUnderlaySlider.value = String(
      this.cardGenerate.animation.still.underlay.classic
    );
    this.cardGenerateBlurSlider.value = String(this.cardGenerate.animation.blur);
    this.cardGenerateBorderSlider.value = String(this.cardGenerate.construction.borderWidth);
    this.cardGenerateHeaderSlider.value = String(this.cardGenerate.construction.headerHeight);
    this.cardGenerateBodySlider.value = String(this.cardGenerate.construction.bodyHeight);
    this.renderCardGenerateSliderValues();

    this.cardGenerateRarityControls.forEach((controls, id) => {
      const rarity = this.cardGenerate.construction.rarities[id];
      if (!rarity) return;
      controls.color.value = rarity.color;
      controls.colorHex.value = rarity.color;
      controls.accent.value = rarity.accent;
      controls.accentHex.value = rarity.accent;
      controls.symbolColor.value = rarity.symbolColor;
      controls.symbolColorHex.value = rarity.symbolColor;
      controls.symbol.value = rarity.symbol;
    });
    this.syncAnimatedLayersSpeedSlider();
    this.syncCardGenerateSpeedButtons();
    this.syncCardGenerateLayerToggles();
  }

  /**
   * Reflects every per-layout animation switch.
   *
   * @returns {void}
   */
  syncCardGenerateLayerToggles() {
    if (!this.cardGenerate) return;
    this.cardGenerateLayerToggles.forEach(({ toggle, state }, key) => {
      const [layout, layer] = key.split(':');
      const enabled = this.cardGenerate.animation[layer]?.[layout] !== false;
      toggle.setAttribute('aria-checked', enabled ? 'true' : 'false');
      if (state) {
        state.textContent = i18n.t(enabled ? 'settings.dev.on' : 'settings.dev.off');
      }
    });
  }

  /**
   * Writes the values next to the construction and animation sliders.
   *
   * @returns {void}
   */
  renderCardGenerateSliderValues() {
    if (!this.cardGenerate) return;
    this.cardGenerateZoomValue.textContent = `${this.cardGenerate.animation.zoomBackground} %`;
    this.cardGenerateUnderlayZoomValue.textContent =
      `${this.cardGenerate.animation.zoomUnderlay} %`;
    this.cardGenerateStillBackgroundValue.textContent =
      `${this.cardGenerate.animation.still.background.classic} %`;
    this.cardGenerateStillUnderlayValue.textContent =
      `${this.cardGenerate.animation.still.underlay.classic} %`;
    this.cardGenerateBlurValue.textContent = `${this.cardGenerate.animation.blur} px`;
    this.cardGenerateBorderValue.textContent = `${this.cardGenerate.construction.borderWidth} px`;
    this.cardGenerateHeaderValue.textContent = `${this.cardGenerate.construction.headerHeight} %`;
    this.cardGenerateBodyValue.textContent = `${this.cardGenerate.construction.bodyHeight} %`;
  }

  /**
   * Reflects the current speed on the quick speed buttons.
   *
   * @returns {void}
   */
  syncCardGenerateSpeedButtons() {
    this.cardGenerateSpeedButtons.forEach((button, speed) => {
      const isActive = speed === this.animatedLayersSpeed;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  }

  /**
   * Applies the current design to every generated card, live.
   *
   * @returns {void}
   */
  applyCardGenerate() {
    if (this.cardGenerate) cardGenerateManager.applySettings(this.cardGenerate);
  }

  /**
   * Applies one of the configured animation speed presets.
   *
   * @param {number} speed - Speed in percent of the reference cycle.
   * @returns {void}
   */
  handleCardGenerateSpeedPreset(speed) {
    if (!Number.isFinite(speed)) return;
    this.animatedLayersSpeed = speed;
    this.syncAnimatedLayersSpeedSlider();
    this.syncCardGenerateSpeedButtons();
    this.applyCardSource();
    void this.handleAnimatedLayersSpeedChange();
  }

  /**
   * Starts or freezes one moving layer of one layout and persists the design.
   *
   * @param {string} key - `layout:layer`, as stored on the switch.
   * @returns {Promise<void>} Resolves once the flow finished (success or failure).
   */
  async handleCardGenerateLayerToggle(key) {
    const [layout, layer] = key.split(':');
    const flags = this.cardGenerate?.animation?.[layer];
    if (
      !flags ||
      typeof flags !== 'object' ||
      !Object.prototype.hasOwnProperty.call(flags, layout)
    ) {
      return;
    }
    const enabled = flags[layout] !== false;
    flags[layout] = !enabled;
    this.syncCardGenerateLayerToggles();
    this.applyCardGenerate();
    await this.saveCardGenerate();
  }

  /**
   * Applies a slider of the Card Generate panel while the thumb moves.
   *
   * @param {Event} event - Input event of one of the module sliders.
   * @returns {void}
   */
  handleCardGenerateSliderInput(event) {
    if (!this.cardGenerate) return;
    const input = event?.target;
    if (!(input instanceof HTMLInputElement) || !input.dataset.cardgenSlider) return;
    const value = Number(input.value);
    if (!Number.isFinite(value)) return;
    if (input.dataset.cardgenSlider === 'zoom') this.cardGenerate.animation.zoomBackground = value;
    if (input.dataset.cardgenSlider === 'underlayZoom') {
      this.cardGenerate.animation.zoomUnderlay = value;
    }
    // The two still scales are one slider per layer, applied to both layouts: a preset can still
    // give them distinct values, but the advanced panel keeps one control per layer.
    if (input.dataset.cardgenSlider === 'stillBackground') {
      this.cardGenerate.animation.still.background = { classic: value, fullart: value };
    }
    if (input.dataset.cardgenSlider === 'stillUnderlay') {
      this.cardGenerate.animation.still.underlay = { classic: value, fullart: value };
    }
    if (input.dataset.cardgenSlider === 'blur') this.cardGenerate.animation.blur = value;
    if (input.dataset.cardgenSlider === 'border') this.cardGenerate.construction.borderWidth = value;
    if (input.dataset.cardgenSlider === 'header') this.cardGenerate.construction.headerHeight = value;
    if (input.dataset.cardgenSlider === 'body') this.cardGenerate.construction.bodyHeight = value;
    this.renderCardGenerateSliderValues();
    this.applyCardGenerate();
  }

  /**
   * Saves a Card Generate slider once the player lets go of the thumb.
   *
   * @returns {Promise<void>} Resolves once the write finished.
   */
  async handleCardGenerateSliderChange() {
    if (this.cardGenerate) await this.saveCardGenerate();
  }

  /**
   * Updates one colour or symbol field of a rarity row.
   *
   * @param {Event} event - Input event delegated from the rarity container.
   * @returns {void}
   */
  handleCardGenerateRarityInput(event) {
    if (!this.cardGenerate) return;
    const input = event?.target;
    if (!(input instanceof HTMLInputElement)) return;
    const row = input.closest('[data-cardgen-rarity]');
    const field = input.dataset.cardgenField;
    if (!row || !field) return;
    const id = Number(row.dataset.cardgenRarity);
    const rarity = this.cardGenerate.construction.rarities[id];
    const controls = this.cardGenerateRarityControls.get(id);
    if (!rarity || !controls) return;

    let value = input.value.trim();
    const isHexField = field.endsWith('Hex');
    const property = isHexField ? field.slice(0, -3) : field;
    if (property === 'symbol') {
      if (value === '') return;
      value = [...value].slice(0, 8).join('');
      input.value = value;
    } else if (!/^#[0-9a-f]{6}$/i.test(value)) {
      return;
    } else {
      value = value.toLowerCase();
      if (isHexField) controls[property].value = value;
      else controls[`${property}Hex`].value = value;
    }

    rarity[property] = value;
    this.applyCardGenerate();
    // The frame and accent colours are custom properties and follow live; the symbol and its own
    // colour are DOM values, so an already built card needs a repaint to show them before the
    // release saves the value.
    if (property === 'symbol' || property === 'symbolColor') cardSourceManager.refresh();
  }

  /**
   * Saves the rarity design after a colour or symbol change.
   *
   * @returns {Promise<void>} Resolves once the write finished.
   */
  async handleCardGenerateRarityChange(event) {
    const input = event?.target;
    if (input instanceof HTMLInputElement) {
      const field = input.dataset.cardgenField ?? '';
      const invalidHex = field.endsWith('Hex') && !/^#[0-9a-f]{6}$/i.test(input.value.trim());
      const emptySymbol = field === 'symbol' && input.value.trim() === '';
      if (invalidHex || emptySymbol) this.syncCardGenerateControls();
    }
    await this.saveCardGenerate();
  }

  /**
   * Persists the generated-card design.
   *
   * @returns {Promise<void>} Resolves once the write finished (success or failure).
   */
  async saveCardGenerate() {
    if (!this.cardGenerate) return;
    const payload = { cardGenerate: this.cardGenerate };
    // Editing the design by hand makes it the `custom` mode: the picker must say that the account
    // no longer renders the preset it came from, otherwise it would keep claiming a mode nobody
    // is looking at anymore.
    if (
      this.cardSource === CARD_SOURCE.GENERATE &&
      this.cardRenderMode !== CARD_RENDER_MODE.CUSTOM
    ) {
      this.cardRenderMode = CARD_RENDER_MODE.CUSTOM;
      payload.cardRenderMode = CARD_RENDER_MODE.CUSTOM;
      this.syncCardRenderSelection();
    }
    try {
      await accountManager.updateSettings(payload);
      // Symbols are DOM text, not custom properties: repaint the cards so a live preview follows.
      cardSourceManager.refresh();
      this.log('Generated-card design saved.');
    } catch (error) {
      console.error('[SettingsView] The generated-card design could not be saved.', error);
      this.setFeedback('settings.error.cardGenerate', 'error');
    }
  }

  /**
   * Restores the construction rows and the classic layout to the configured defaults.
   *
   * @returns {Promise<void>} Resolves once the write finished.
   */
  async handleCardGenerateReset() {
    if (!this.cardGenerateConfig || !this.cardGenerate) return;
    this.cardGenerate = {
      ...this.cardGenerate,
      construction: buildCardGenerateDefaults(this.cardGenerateConfig).construction,
    };
    this.syncCardGenerateControls();
    this.applyCardGenerate();
    await this.saveCardGenerate();
  }

  /**
   * Reflects the animated-layers preference on its switch and state label.
   *
   * @returns {void}
   */
  syncAnimatedLayersLabel() {
    if (this.animatedLayersToggle) {
      this.animatedLayersToggle.setAttribute('aria-checked', this.animatedLayers ? 'true' : 'false');
    }
    if (this.animatedLayersStateElement) {
      this.animatedLayersStateElement.textContent = i18n.t(
        this.animatedLayers ? 'settings.dev.on' : 'settings.dev.off'
      );
    }
  }

  /**
   * Reflects the current speed on the slider and on its output.
   *
   * @returns {void}
   */
  syncAnimatedLayersSpeedSlider() {
    if (!this.animatedLayersSpeedSlider) return;
    const value = String(this.animatedLayersSpeed);
    if (this.animatedLayersSpeedSlider.value !== value) {
      this.animatedLayersSpeedSlider.value = value;
    }
    this.renderAnimatedLayersSpeedValue();
  }

  /**
   * Writes the speed and the resulting cycle length next to the slider.
   *
   * The output is translated in code instead of through `data-i18n`: it depends on the value, not
   * only on the language, like the notification duration.
   *
   * @param {number} [speed] - Speed in percent (the current one by default).
   * @returns {void}
   */
  renderAnimatedLayersSpeedValue(speed = this.animatedLayersSpeed) {
    if (!this.animatedLayersSpeedValueElement) return;
    const factor = speed / 100;
    this.animatedLayersSpeedValueElement.textContent = i18n.t(
      'settings.animatedLayers.speedValue',
      {
        speed: Number(factor.toFixed(2)).toString(),
        seconds: resolveAnimatedLayersDuration(speed),
      }
    );
  }

  /**
   * Applies the speed while the thumb moves; the release is what saves it.
   *
   * @param {Event} event - Input event of the range element.
   * @returns {void}
   */
  handleAnimatedLayersSpeedInput(event) {
    const speed = Number(event?.target?.value);
    if (!Number.isFinite(speed)) return;
    this.animatedLayersSpeed = speed;
    this.setFeedback(null);
    this.renderAnimatedLayersSpeedValue();
    this.syncCardGenerateSpeedButtons();
    this.applyCardSource();
  }

  /**
   * Persists the animated-layers speed once the player lets go of the thumb.
   *
   * Like the other sliders, a failed write keeps the speed applied for this session and reports it.
   *
   * @returns {Promise<void>} Resolves once the flow finished (success or failure).
   */
  async handleAnimatedLayersSpeedChange() {
    const payload = { animatedLayersSpeed: this.animatedLayersSpeed };
    if (
      this.cardSource === CARD_SOURCE.GENERATE &&
      this.cardRenderMode !== CARD_RENDER_MODE.CUSTOM
    ) {
      this.cardRenderMode = CARD_RENDER_MODE.CUSTOM;
      payload.cardRenderMode = CARD_RENDER_MODE.CUSTOM;
      this.syncCardRenderSelection();
    }
    try {
      await accountManager.updateSettings(payload);
      this.log(`Animated layers speed set to ${this.animatedLayersSpeed} % and saved.`);
    } catch (error) {
      console.error('[SettingsView] The animated-layers speed could not be saved.', error);
      this.setFeedback('settings.error.animatedLayersSpeed', 'error');
    }
  }

  /**
   * Applies the current developer mode and card source to the visible cards.
   *
   * @returns {void}
   */
  applyCardSource() {
    const cardRenderMode = this.resolveActiveCardRenderMode();
    this.cardSource =
      cardRenderMode === CARD_RENDER_MODE.IMAGES ? CARD_SOURCE.IMAGE : CARD_SOURCE.GENERATE;
    this.syncAnimatedLayersVisibility();
    cardSourceManager.applySettings({
      devMode: this.devMode,
      advancedDevMode: this.advancedDevMode,
      cardSource: this.cardSource,
      cardRenderMode,
      animatedLayers: this.animatedLayers,
      animatedLayersSpeed: this.animatedLayersSpeed,
    });
  }

  /**
   * Entry of the "Card render" picker that is actually in effect.
   *
   * A stored preset stays out of reach when it asks for the developer mode and that mode is off,
   * and `custom` needs BOTH developer modes: the settings screen then falls back to the plain
   * images instead of claiming a mode the player can no longer see.
   *
   * @returns {string} `images`, `custom`, or the id of an available preset.
   */
  resolveActiveCardRenderMode() {
    const stored = this.cardRenderMode;
    if (stored === CARD_RENDER_MODE.IMAGES) return CARD_RENDER_MODE.IMAGES;
    const customAllowed = this.devMode && this.advancedDevMode;
    if (stored === CARD_RENDER_MODE.CUSTOM) {
      return customAllowed ? CARD_RENDER_MODE.CUSTOM : CARD_RENDER_MODE.IMAGES;
    }
    // The list is not loaded yet (the boot path applies the source before the preset file is
    // read): trust what the account stores instead of flicking every card back to the images.
    if (this.cardRenderModes.length === 0) return stored;

    const preset = findMode(this.cardRenderModes, stored);
    if (preset && isModeAvailable(preset, { devMode: this.devMode })) return preset.id;
    // A mode removed from the file (or one that now asks for a developer mode this account does
    // not have) falls back to the design the account still carries, never to a broken card.
    return customAllowed ? CARD_RENDER_MODE.CUSTOM : CARD_RENDER_MODE.IMAGES;
  }

  /**
   * Loads the presets of `settings/cardrender.json` and builds the picker.
   *
   * A file that cannot be read leaves a picker with the images alone: the screen stays usable, and
   * the account keeps the mode it already had.
   *
   * @returns {Promise<void>} Resolves once the picker exists.
   */
  async renderCardRenderSelector() {
    this.cardRenderModes = await getCardRenderModes();
    this.buildCardRenderButtons();
  }

  /**
   * Draws one button per available mode, then repaints the preview.
   *
   * `images` is always first; a preset is listed when it does not ask for the developer mode (or
   * when that mode is on), and `custom` is the advanced option, shown with both developer modes.
   *
   * @returns {void}
   */
  buildCardRenderButtons() {
    if (!this.cardRenderContainer) return;
    this.cardRenderContainer.textContent = '';
    this.cardRenderButtons.clear();

    const lang = i18n.getLang();
    const entries = [{ id: CARD_RENDER_MODE.IMAGES, label: i18n.t('settings.cardRender.images') }];
    this.cardRenderModes.forEach((mode) => {
      if (!isModeAvailable(mode, { devMode: this.devMode })) return;
      entries.push({ id: mode.id, label: getModeLabel(mode, lang) });
    });
    if (this.advancedDevMode) {
      entries.push({ id: CARD_RENDER_MODE.CUSTOM, label: i18n.t('settings.cardRender.custom') });
    }

    entries.forEach(({ id, label }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'lang-switch__option';
      button.dataset.cardRenderId = id;
      button.textContent = label;
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => void this.handleCardRenderModeChange(id));
      this.cardRenderContainer.appendChild(button);
      this.cardRenderButtons.set(id, button);
    });

    this.syncCardRenderSelection();
  }

  /**
   * Reflects the effective mode on the picker buttons.
   *
   * @returns {void}
   */
  syncCardRenderButtons() {
    const active = this.resolveActiveCardRenderMode();
    this.cardRenderButtons.forEach((button, id) => {
      const isActive = id === active;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  }

  /**
   * Paints the small preview of the selected mode.
   *
   * The preview is a real `<card-print>`: the design of the mode is published as custom properties
   * on the stage itself, so only that card follows it, while the cards on the other screens keep
   * the design of the account. `images` shows the artwork the game would display instead.
   *
   * @returns {void}
   */
  renderCardRenderStage() {
    if (!this.cardRenderStage) return;
    const active = this.resolveActiveCardRenderMode();
    const preset = findMode(this.cardRenderModes, active);
    const design = preset ? preset.design : this.cardGenerate;
    const stage = this.cardRenderStage;
    stage.textContent = '';
    stage.removeAttribute('style');

    if (active === CARD_RENDER_MODE.IMAGES) {
      const image = document.createElement('img');
      image.className = 'settings__card-render-image';
      image.src = 'assets/img/card_back.png';
      image.alt = '';
      image.setAttribute('aria-hidden', 'true');
      stage.appendChild(image);
      return;
    }
    if (!design) return;

    Object.entries(cardGenerateManager.buildVariables(design)).forEach(([name, value]) => {
      stage.style.setProperty(name, value);
    });
    stage.style.setProperty(
      '--animated-layers-duration',
      `${resolveAnimatedLayersDuration(preset ? preset.speedPercent : this.animatedLayersSpeed)}s`
    );

    const print = new CardPrint();
    print.className = 'settings__card-render-image';
    print.setAttribute('aria-hidden', 'true');
    print.setCard(
      {
        ...CARD_RENDER_SAMPLE,
        // The artwork is painted from inside the shadow root, where a relative URL would resolve
        // against `css/components/`: the preview needs the absolute one.
        background: new URL(CARD_RENDER_SAMPLE.background, document.baseURI).href,
      },
      {
        mini: false,
        lang: i18n.getLang(),
        appearance: design.construction.rarities[CARD_RENDER_SAMPLE.rarity],
      }
    );
    print.setAnimatedLayers(preset ? preset.animatedLayers : this.animatedLayers);
    print.setAnimatedLayersView(true);
    stage.appendChild(print);
  }

  /**
   * Pushes the selected mode to every label, to the cards and to the preview.
   *
   * @returns {void}
   */
  syncCardRenderSelection() {
    this.syncCardSourceButtons();
    this.syncCardRenderButtons();
    this.applyCardSource();
    this.renderCardRenderStage();
  }

  /**
   * Applies one entry of the "Card render" picker and persists it.
   *
   * A preset carries a complete design, so choosing one copies its values into the account: the
   * cards keep rendering the same way even if `cardrender.json` changes afterwards. `images` and
   * `custom` only move the picker; the design stays whatever the account already stores.
   *
   * @param {string} modeId - Entry that was clicked.
   * @returns {Promise<void>} Resolves once the flow finished (success or failure).
   */
  async handleCardRenderModeChange(modeId) {
    if (this.isBusy) return;
    if (modeId === this.resolveActiveCardRenderMode()) return;

    const preset = findMode(this.cardRenderModes, modeId);
    await this.saveCardRenderSelection(
      preset ? preset.id : modeId,
      preset ? SettingsView.cloneCardDesign(preset.design) : null,
      preset
    );
  }

  /**
   * Writes a render selection, applies it live and rolls it back on failure.
   *
   * @param {string} modeId - `images`, `custom` or a preset id.
   * @param {object|null} [design] - Complete design of a preset, or null to keep the current one.
   * @param {object|null} [preset] - Preset the design comes from, or null.
   * @returns {Promise<void>} Resolves once the flow finished (success or failure).
   */
  async saveCardRenderSelection(modeId, design = null, preset = null) {
    const previous = {
      cardRenderMode: this.cardRenderMode,
      cardSource: this.cardSource,
      cardGenerate: this.cardGenerate,
      animatedLayers: this.animatedLayers,
      animatedLayersSpeed: this.animatedLayersSpeed,
    };

    this.cardRenderMode = modeId;
    if (preset) {
      this.cardGenerate = design;
      this.animatedLayers = preset.animatedLayers === true;
      this.animatedLayersSpeed = preset.speedPercent;
      this.syncAnimatedLayersLabel();
      this.syncAnimatedLayersSpeedSlider();
      this.syncCardGenerateControls();
      this.applyCardGenerate();
    }
    this.setFeedback(null);
    this.syncCardRenderSelection();

    const payload = {
      cardRenderMode: modeId,
      cardSource: modeId === CARD_RENDER_MODE.IMAGES ? CARD_SOURCE.IMAGE : CARD_SOURCE.GENERATE,
    };
    if (preset) {
      payload.cardGenerate = this.cardGenerate;
      payload.animatedLayers = this.animatedLayers;
      payload.animatedLayersSpeed = this.animatedLayersSpeed;
    }

    try {
      await accountManager.updateSettings(payload);
      this.log(`Card render mode set to "${modeId}" and saved.`);
    } catch (error) {
      console.error('[SettingsView] The card render mode could not be saved.', error);
      this.cardRenderMode = previous.cardRenderMode;
      this.cardSource = previous.cardSource;
      this.cardGenerate = previous.cardGenerate;
      this.animatedLayers = previous.animatedLayers;
      this.animatedLayersSpeed = previous.animatedLayersSpeed;
      this.syncAnimatedLayersLabel();
      this.syncAnimatedLayersSpeedSlider();
      this.syncCardGenerateControls();
      this.applyCardGenerate();
      this.syncCardRenderSelection();
      this.setFeedback('settings.error.cardSource', 'error');
    }
  }

  /**
   * Copies the active mode as an entry of `settings/cardrender.json`.
   *
   * The advanced panel offers it so adding a mode is: click, paste, change the id. The copied
   * object carries every property the file reads, in the vocabulary of the file.
   *
   * @returns {Promise<void>} Resolves once the flow finished (success or failure).
   */
  async handleCardGenerateCopy() {
    if (!this.cardGenerate) return;
    const preset = findMode(this.cardRenderModes, this.resolveActiveCardRenderMode());
    const entry = buildModeExport(
      preset ?? {
        id: CARD_RENDER_MODE.CUSTOM,
        name: { fr: i18n.t('settings.cardRender.custom'), en: 'Custom' },
        requiresDeveloperMode: true,
        animatedLayers: this.animatedLayers,
        speedPercent: this.animatedLayersSpeed,
        design: this.cardGenerate,
      },
      preset ? preset.id : 'custom-copy'
    );

    try {
      await this.writeToClipboard(JSON.stringify(entry, null, 2));
      this.setFeedback('settings.cardGenerate.copyDone', 'info');
      this.log(`Render mode "${entry.id}" copied as JSON.`);
    } catch (error) {
      console.error('[SettingsView] The render mode could not be copied.', error);
      this.setFeedback('settings.error.cardGenerateCopy', 'error');
    }
  }

  /**
   * Deep copy of a card design, so editing it never mutates the preset it came from.
   *
   * @param {object} design - Design to copy.
   * @returns {object} An independent copy.
   */
  static cloneCardDesign(design) {
    return JSON.parse(JSON.stringify(design));
  }

  /**
   * Applies a card source live and persists it.
   *
   * The cards already on screen are repainted by `CardSourceManager`, so the picker has an
   * immediate effect instead of waiting for the next screen. A failed write keeps the choice for
   * this session and reports it, like the booster render picker.
   *
   * @param {string} id - `generate` or `image`.
   * @returns {Promise<void>} Resolves once the flow finished (success or failure).
   */
  async handleCardSourceChange(id) {
    if (!CARD_SOURCE_VALUES.includes(id)) return;
    const mode =
      id === CARD_SOURCE.GENERATE ? CARD_RENDER_MODE.CUSTOM : CARD_RENDER_MODE.IMAGES;
    if (mode === this.resolveActiveCardRenderMode()) return;
    await this.saveCardRenderSelection(mode);
  }

  /**
   * Applies the animated-layers preference and persists it.
   *
   * Only the generated source uses it: the switch is hidden for image source, and the manager
   * removes the attribute from cards that may still be alive when the preference is turned off.
   *
   * @returns {Promise<void>} Resolves once the write finished (success or failure).
   */
  async handleAnimatedLayersToggle() {
    if (this.isBusy) return;

    const previous = this.animatedLayers;
    const next = !previous;
    this.animatedLayers = next;
    this.setFeedback(null);
    this.syncAnimatedLayersLabel();
    this.syncAnimatedLayersVisibility();
    this.applyCardSource();

    try {
      await accountManager.updateSettings({ animatedLayers: next });
      this.log(`Animated layers ${next ? 'enabled' : 'disabled'} and saved.`);
    } catch (error) {
      console.error('[SettingsView] The animated-layers preference could not be saved.', error);
      this.animatedLayers = previous;
      this.syncAnimatedLayersLabel();
      this.syncAnimatedLayersVisibility();
      this.applyCardSource();
      this.setFeedback('settings.error.animatedLayers', 'error');
    }
  }

  /**
   * Applies a booster render mode and persists the preference.
   *
   * Like the animation mode, the recipe is applied live first: the picker preview and the opening
   * scene follow it immediately. A failed write keeps the mode for this session and reports it,
   * instead of pretending the click did nothing.
   *
   * @param {string} id - Mode id of the clicked button.
   * @returns {Promise<void>} Resolves once the flow finished (success or failure).
   */
  async handleRenderModeChange(id) {
    if (this.isBusy || id === boosterRenderManager.getMode()) return;

    this.setFeedback(null);
    try {
      boosterRenderManager.applyMode(id);
    } catch (error) {
      console.error('[SettingsView] Unable to apply the booster render mode.', error);
      this.setFeedback('settings.error.render', 'error');
      return;
    }
    this.syncRenderButtons();
    this.renderRenderDetail();

    try {
      await accountManager.updateSettings({ boosterRenderMode: id });
      this.log(`Booster render mode set to "${id}" and saved.`);
    } catch (error) {
      console.error('[SettingsView] The booster render mode could not be saved.', error);
      this.setFeedback('settings.error.render', 'error');
    }
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
    this.authCode = await socialManager.getAuthCode();
    this.authCodeElement.textContent = this.authCode || '-';
    this.authCodeElement.setAttribute('title', this.authCode);
    this.authCodeCopyButton.disabled = this.authCode === '';
    this.authCodeEmptyElement.hidden = this.authCode !== '';
    this.authCodeInput.value = this.authCode;
    this.syncAuthCodeEditor();
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
   * Draws the release notes from `settings/changelog.json`.
   *
   * The newest version comes unfolded; the older ones stay folded, so a changelog of two years
   * still reads as one panel. A file that cannot be read leaves a sentence rather than an empty
   * box: this page is documentation, and nothing on it is something the player can act on.
   *
   * @returns {Promise<void>} Resolves once the panel is drawn.
   */
  async renderChangelog() {
    if (!this.changelogElement) return;

    let versions = [];
    try {
      versions = await configLoader.getChangelog();
    } catch (error) {
      console.error('[SettingsView] The release notes could not be read.', error);
      this.changelogElement.replaceChildren(this.buildChangelogNotice('settings.changelog.error'));
      return;
    }

    if (versions.length === 0) {
      this.changelogElement.replaceChildren(this.buildChangelogNotice('settings.changelog.empty'));
      return;
    }

    const lang = i18n.getLang();
    this.changelogElement.replaceChildren(
      ...versions.map((version, position) => this.buildChangelogVersion(version, position === 0, lang))
    );
    this.log(`Release notes displayed (${versions.length} version(s)).`);
  }

  /**
   * Builds the sentence the changelog shows instead of a list.
   *
   * @param {string} key - Translation key.
   * @returns {HTMLElement} The paragraph.
   */
  buildChangelogNotice(key) {
    const notice = document.createElement('p');
    notice.className = 'settings__help changelog__notice';
    notice.textContent = i18n.t(key);
    return notice;
  }

  /**
   * Builds one folded version of the changelog, with its notes.
   *
   * @param {{version: string, title: Record<string, string>, notes: Array<object>}} version -
   *   Version to draw.
   * @param {boolean} open - Whether the block starts unfolded (the newest one does).
   * @param {string} lang - Active language.
   * @returns {HTMLElement} The `<details>` block.
   */
  buildChangelogVersion(version, open, lang) {
    const block = document.createElement('details');
    block.className = 'changelog__version';
    block.open = open;

    const title =
      version.title?.[lang] ??
      version.title?.[i18n.defaultLang] ??
      Object.values(version.title ?? {})[0] ??
      '';
    const summary = document.createElement('summary');
    summary.className = 'changelog__summary';
    summary.textContent = i18n.t('settings.changelog.version', { version: version.version });
    if (title !== '') summary.textContent += ` · ${title}`;
    block.append(summary);

    if (version.notes.length === 0) {
      block.append(this.buildChangelogNotice('settings.changelog.noNotes'));
      return block;
    }

    const list = document.createElement('ul');
    list.className = 'changelog__notes';
    version.notes.forEach((note) => list.append(this.buildChangelogNote(note, lang)));
    block.append(list);
    return block;
  }

  /**
   * Builds one note: its kind, its text in the active language, and the mark of an important one.
   *
   * The file holds its text per language, so the note falls back to the default language and then
   * to whatever translation exists: a note written in one language only stays readable everywhere.
   *
   * @param {{type: string, label: string, important: boolean, text: Record<string, string>}} note -
   *   Note to draw.
   * @param {string} lang - Active language.
   * @returns {HTMLElement} The list item.
   */
  buildChangelogNote(note, lang) {
    const item = document.createElement('li');
    item.className = 'changelog__note';
    item.dataset.type = note.type;

    const badge = document.createElement('span');
    badge.className = 'changelog__badge';
    badge.textContent = CHANGELOG_TYPES.includes(note.type)
      ? i18n.t(`settings.changelog.type.${note.type}`)
      : note.label;
    if (note.important) {
      item.classList.add('is-important');
      const star = document.createElement('span');
      star.className = 'changelog__star';
      star.setAttribute('role', 'img');
      star.setAttribute('aria-label', i18n.t('settings.changelog.important'));
      star.textContent = '★';
      badge.append(star);
    }

    const text = document.createElement('p');
    text.className = 'changelog__text';
    text.textContent = note.text[lang] ?? note.text[i18n.defaultLang] ?? Object.values(note.text)[0] ?? '';

    item.append(badge, text);
    return item;
  }

  /**
   * Draws the error report: the last distinct incidents of this release.
   *
   * A minor incident never opened a dialog (see `ErrorReporter`), which is exactly why it is listed
   * here with its code: the player can still quote it, and this panel is the only place it shows.
   * The list follows the log live, so an incident raised while the settings is open appears without
   * a reload.
   *
   * @returns {void}
   */
  renderErrorLog() {
    if (!this.errorLogElement) return;

    const entries = errorLog.getEntries();
    const release = errorLog.getRelease();

    // Nothing to copy on a clean release: the button stays visible (it is part of the panel) but
    // disabled, rather than copying a report made of a single empty line.
    if (this.errorLogCopyButton) {
      this.errorLogCopyButton.disabled = entries.length === 0;
    }

    if (this.errorLogReleaseElement) {
      const known = release.version !== null;
      this.errorLogReleaseElement.hidden = !known;
      this.errorLogReleaseElement.textContent = known
        ? i18n.t('settings.errors.release', { version: release.version, count: entries.length })
        : '';
    }

    if (entries.length === 0) {
      this.errorLogElement.replaceChildren(this.buildErrorLogNotice());
      return;
    }

    this.errorLogElement.replaceChildren(...entries.map((entry) => this.buildErrorLogItem(entry)));
  }

  /**
   * Builds the sentence the report shows instead of a list.
   *
   * @returns {HTMLElement} The list item carrying the sentence.
   */
  buildErrorLogNotice() {
    const notice = document.createElement('li');
    notice.className = 'error-log__empty settings__help';
    notice.textContent = i18n.t('settings.errors.empty');
    return notice;
  }

  /**
   * Builds one incident: its severity, its code, its message, its detail and how often it was met.
   *
   * The code stays selectable so a player can quote it in a message, even for an incident the game
   * announced nowhere. The detail is what makes a refused worker request actionable: the route and
   * the status the server answered.
   *
   * @param {object} entry - Incident read from `errorLog.getEntries()`.
   * @returns {HTMLElement} The list item.
   */
  buildErrorLogItem(entry) {
    const item = document.createElement('li');
    item.className = 'error-log__item';
    item.dataset.severity = entry.severity;

    const head = document.createElement('p');
    head.className = 'error-log__head';
    const badge = document.createElement('span');
    badge.className = 'error-log__badge';
    badge.textContent = i18n.t(
      entry.severity === ERROR_SEVERITY.MINOR ? 'settings.errors.minor' : 'settings.errors.blocking'
    );
    const code = document.createElement('code');
    code.className = 'error-log__code';
    code.textContent = entry.code;
    head.append(badge, code);

    const message = document.createElement('p');
    message.className = 'error-log__message';
    message.textContent = entry.message;

    const meta = document.createElement('p');
    meta.className = 'error-log__meta';
    meta.textContent = [
      i18n.t('settings.errors.source', { source: entry.source }),
      i18n.t('settings.errors.count', { count: entry.count }),
      SettingsView.formatErrorDate(entry.at),
    ]
      .filter(Boolean)
      .join(' · ');

    item.append(head, message);
    if (typeof entry.details === 'string' && entry.details !== '') {
      const details = document.createElement('p');
      details.className = 'error-log__details';
      details.textContent = i18n.t('settings.errors.details', { details: entry.details });
      item.append(details);
    }
    item.append(meta);
    return item;
  }

  /**
   * Copies the whole report to the clipboard, formatted for Discord.
   *
   * A player reporting a bug rarely reformats anything: the text therefore carries the release and
   * one block per incident (severity, code in a code span, origin, occurrences, date, message). An
   * empty report is refused instead of copying a header with nothing under it.
   *
   * @returns {Promise<void>} Resolves once the copy attempt finished.
   */
  async handleCopyErrorLog() {
    const entries = errorLog.getEntries();
    if (entries.length === 0) {
      this.setFeedback('settings.errors.copyEmpty', 'info');
      return;
    }

    try {
      await this.writeToClipboard(this.buildErrorLogClipboardText());
      this.setFeedback('settings.errors.copied', 'info');
      this.log(`Error report copied (${entries.length} incident(s)).`);
    } catch (error) {
      console.error('[SettingsView] The error report could not be copied.', error);
      this.setFeedback('settings.errors.copyError', 'error');
    }
  }

  /**
   * Builds the text of the report, ready to paste on Discord.
   *
   * Discord markdown is used on purpose: the release line in bold, one bold heading per incident
   * with its code in a code span (which also keeps the code selectable after the paste), then the
   * message as a quote. Messages are flattened to one line so a stack trace never breaks the
   * heading, and the labels follow the language of the interface (a report is read by whoever plays
   * in that language).
   *
   * @returns {string} The plain-text report.
   */
  buildErrorLogClipboardText() {
    const release = errorLog.getRelease();
    const entries = errorLog.getEntries();
    const version = release.version ?? '?';
    const lines = [
      `**MineCards** · ${i18n.t('settings.errors.release', { version, count: entries.length })}`,
    ];

    entries.forEach((entry, index) => {
      const severity = i18n.t(
        entry.severity === ERROR_SEVERITY.MINOR
          ? 'settings.errors.minor'
          : 'settings.errors.blocking'
      );
      lines.push('');
      lines.push(
        [
          `**${index + 1}. ${severity}**`,
          `\`${entry.code}\``,
          entry.source,
          i18n.t('settings.errors.count', { count: entry.count }),
          SettingsView.formatErrorDate(entry.at),
        ]
          .filter(Boolean)
          .join(' · ')
      );
      lines.push(`> ${String(entry.message ?? '').replace(/\s*\n\s*/g, ' ')}`);
      if (typeof entry.details === 'string' && entry.details !== '') {
        lines.push(`> ${i18n.t('settings.errors.details', { details: entry.details })}`);
      }
    });

    return lines.join('\n');
  }

  /**
   * Formats the moment of an incident in the active language.
   *
   * @param {string} iso - ISO timestamp of the last occurrence.
   * @returns {string} The readable date, or an empty string when it cannot be read.
   */
  static formatErrorDate(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    try {
      return date.toLocaleString(i18n.getLang());
    } catch (error) {
      return date.toISOString();
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
   * Renders one button per card language declared in `config.json`, "Automatic" first.
   *
   * The cards have their own language: a player reading the interface in French can collect the
   * English printings. "Automatic" follows the browser and falls back to English, which is what a
   * new account starts with.
   *
   * @returns {Promise<void>} Resolves once the buttons exist.
   * @throws {Error} When the card language list cannot be loaded.
   */
  async renderCardLanguageSelector() {
    const options = await cardLanguage.getOptions();
    this.cardLanguageContainer.textContent = '';
    this.cardLanguageButtons.clear();

    options.forEach(({ code, label, labelKey }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'lang-switch__option';
      button.dataset.cardLang = code;
      button.textContent = labelKey ? i18n.t(labelKey) : label;
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => this.handleCardLanguageChange(code));
      this.cardLanguageContainer.appendChild(button);
      this.cardLanguageButtons.set(code, button);
    });
    this.syncCardLanguageButtons();
  }

  /**
   * Reflects the active card language preference on the picker buttons.
   *
   * `auto` is compared as a preference, not as a resolved language: a browser speaking French shows
   * "Automatique" active, not "Français".
   *
   * @returns {void}
   */
  syncCardLanguageButtons() {
    const current = cardLanguage.getPreference();
    this.cardLanguageButtons.forEach((button, code) => {
      const isActive = code === current;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  }

  /**
   * Switches the language of the cards at runtime (no reload) and persists the preference.
   *
   * The interface is deliberately left untouched: the two languages are independent, so switching
   * one never moves the other. The views showing card data re-render on `CARD_LANG_CHANGED`.
   *
   * @param {string} preference - `auto` or a card language code.
   * @returns {Promise<void>} Resolves once the flow finished (success or failure).
   */
  async handleCardLanguageChange(preference) {
    if (this.isBusy || preference === cardLanguage.getPreference()) return;

    soundManager.playUi(UI_SOUNDS.SECTION_SWITCH);
    this.setBusy(true);
    this.setFeedback(null);
    try {
      cardLanguage.setPreference(preference);
    } catch (error) {
      console.error('[SettingsView] Unable to switch the card language.', error);
      this.setFeedback('settings.error.cardLang', 'error');
      return;
    } finally {
      this.setBusy(false);
      this.syncCardLanguageButtons();
    }

    try {
      await accountManager.updateSettings({ cardLang: preference });
      this.log(`Card language set to "${preference}" and saved.`);
    } catch (error) {
      // The switch is applied for this session but the preference was not stored.
      console.error('[SettingsView] The card language preference could not be saved.', error);
      this.setFeedback('settings.error.cardLang', 'error');
    }
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
   * Builds one row per sound family: a switch and a 0-5 volume slider.
   *
   * The rows are generated from `SOUND_CATEGORY_ORDER`, so a family added to the manager appears
   * here (and in the settings it stores) without touching the markup.
   *
   * @returns {void}
   */
  renderSoundCategories() {
    if (!this.soundCategoriesElement) return;
    this.soundCategoryControls.clear();
    this.soundCategoriesElement.textContent = '';
    this.soundCategoriesElement.setAttribute('role', 'group');
    this.soundCategoriesElement.setAttribute(
      'aria-label',
      i18n.t('settings.sound.categories')
    );

    const settings = soundManager.getCategorySettings();
    SOUND_CATEGORY_ORDER.forEach((category) => {
      const entry = settings[category] ?? DEFAULT_SOUND_CATEGORIES[category];
      const row = document.createElement('div');
      row.className = 'settings__sound-row';
      row.dataset.soundCategory = category;

      const head = document.createElement('div');
      head.className = 'settings__sound-head';
      const label = document.createElement('span');
      label.className = 'settings__toggle-label';
      label.textContent = i18n.t(`settings.sound.category.${category}`);

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'switch';
      toggle.dataset.settingsSoundCategoryToggle = category;
      toggle.setAttribute('role', 'switch');
      toggle.setAttribute('aria-checked', String(entry.enabled));
      toggle.setAttribute('aria-label', i18n.t(`settings.sound.category.${category}`));
      const track = document.createElement('span');
      track.className = 'switch__track';
      track.setAttribute('aria-hidden', 'true');
      const thumb = document.createElement('span');
      thumb.className = 'switch__thumb';
      track.appendChild(thumb);
      const state = document.createElement('span');
      state.className = 'switch__state';
      toggle.append(track, state);
      head.append(label, toggle);

      const sliderWrapper = document.createElement('div');
      sliderWrapper.className = 'foil-slider settings__sound-slider';
      const sliderHead = document.createElement('div');
      sliderHead.className = 'foil-slider__head';
      const sliderLabel = document.createElement('label');
      sliderLabel.className = 'foil-slider__label';
      const inputId = `settings-sound-${category}`;
      sliderLabel.setAttribute('for', inputId);
      sliderLabel.textContent = i18n.t('settings.sound.volume');
      const output = document.createElement('output');
      output.className = 'foil-slider__value';
      output.setAttribute('for', inputId);
      output.textContent = String(entry.volume);
      sliderHead.append(sliderLabel, output);

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.className = 'foil-slider__input';
      slider.id = inputId;
      slider.dataset.settingsSoundCategoryVolume = category;
      slider.min = String(SOUND_VOLUME_LEVELS.MIN);
      slider.max = String(SOUND_VOLUME_LEVELS.MAX);
      slider.step = '1';
      slider.value = String(entry.volume);
      sliderWrapper.append(sliderHead, slider);

      row.append(head, sliderWrapper);
      this.soundCategoriesElement.appendChild(row);
      this.soundCategoryControls.set(category, {
        switch: toggle,
        state,
        slider,
        output,
      });
    });

    this.syncSoundCategories();
  }

  /**
   * Reflects the global switch and the family settings on the rows.
   *
   * The whole block is hidden while the master switch is off, as the sound is then a single on/off
   * decision. Inside it, a family switched off keeps its slider disabled (its volume is remembered
   * for the next time it is turned back on).
   *
   * @returns {void}
   */
  syncSoundCategories() {
    if (!this.soundCategoriesElement) return;
    const enabled = soundManager.isEnabled();
    this.soundCategoriesElement.hidden = !enabled;
    // The explanatory line belongs to the families: with the master switch off there is nothing
    // left to explain, so it folds away with the rows instead of floating alone under the switch.
    if (this.soundHelpElement) this.soundHelpElement.hidden = !enabled;
    const settings = soundManager.getCategorySettings();
    this.soundCategoryControls.forEach((controls, category) => {
      const entry = settings[category] ?? DEFAULT_SOUND_CATEGORIES[category];
      controls.switch.setAttribute('aria-checked', String(entry.enabled));
      controls.switch.disabled = !enabled;
      controls.state.textContent = i18n.t(entry.enabled ? 'settings.sound.on' : 'settings.sound.off');
      controls.slider.disabled = !enabled || !entry.enabled;
      controls.slider.value = String(entry.volume);
      controls.output.textContent = String(entry.volume);
      controls.slider.closest('.settings__sound-row')?.setAttribute(
        'data-enabled',
        String(enabled && entry.enabled)
      );
    });
  }

  /**
   * Flips one sound family and persists the whole map.
   *
   * @param {string} category - Family id.
   * @returns {Promise<void>} Resolves once the flow finished (success or failure).
   */
  async handleSoundCategoryToggle(category) {
    if (this.isBusy) return;
    const settings = soundManager.getCategorySettings();
    const entry = settings[category];
    if (!entry) return;
    const previous = entry.enabled !== false;
    soundManager.setCategoryEnabled(category, !previous);
    this.syncSoundCategories();
    this.setFeedback(null);
    try {
      await accountManager.updateSettings({ soundCategories: soundManager.getCategorySettings() });
      this.log(`Sound family "${category}" ${previous ? 'disabled' : 'enabled'} and saved.`);
    } catch (error) {
      console.error('[SettingsView] The sound family could not be saved.', error);
      soundManager.setCategoryEnabled(category, previous);
      this.syncSoundCategories();
      this.setFeedback('settings.error.sound', 'error');
    }
  }

  /**
   * Applies the volume of one family while the thumb moves.
   *
   * Nothing is written here (a write per step would fill the transaction log); the release saves.
   *
   * @param {string} category - Family id.
   * @param {Event} event - Input event of the range element.
   * @returns {void}
   */
  handleSoundCategoryVolumeInput(category, event) {
    const controls = this.soundCategoryControls.get(category);
    if (!controls) return;
    const level = Number(event?.target?.value);
    if (!Number.isFinite(level)) return;
    soundManager.setCategoryVolume(category, level);
    const applied = soundManager.getCategorySettings()[category];
    controls.output.textContent = String(applied.volume);
    this.setFeedback(null);
  }

  /**
   * Persists the family settings once the player lets go of a volume thumb.
   *
   * @returns {Promise<void>} Resolves once the flow finished (success or failure).
   */
  async handleSoundCategoryVolumeChange() {
    try {
      await accountManager.updateSettings({ soundCategories: soundManager.getCategorySettings() });
      this.log('Sound family volumes saved.');
    } catch (error) {
      console.error('[SettingsView] The sound family volumes could not be saved.', error);
      this.setFeedback('settings.error.sound', 'error');
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
      // The stored advanced switch only counts for an allowlisted UUID. A save copied from another
      // account (or a revoked UUID) falls back to the normal developer options without a popup.
      this.advancedDevMode = settings.advancedDevMode === true
        ? await this.hasAdvancedDeveloperAccess()
        : false;
      this.cardSource = CARD_SOURCE_VALUES.includes(settings.cardSource)
        ? settings.cardSource
        : CARD_SOURCE.IMAGE;
      this.cardRenderMode =
        typeof settings.cardRenderMode === 'string' && settings.cardRenderMode !== ''
          ? settings.cardRenderMode
          : DEFAULT_CARD_RENDER_MODE;
      this.animatedLayers = settings.animatedLayers === true;
      if (Number.isFinite(settings.animatedLayersSpeed)) {
        this.animatedLayersSpeed = settings.animatedLayersSpeed;
      }
      if (settings.cardGenerate && typeof settings.cardGenerate === 'object') {
        this.cardGenerate = settings.cardGenerate;
      }
    } catch (error) {
      console.warn('[SettingsView] The developer mode could not be read.', error);
    }
    this.devMode = enabled;
    this.devToggle.setAttribute('aria-checked', enabled ? 'true' : 'false');
    if (this.devModeStateElement) {
      this.devModeStateElement.textContent = i18n.t(enabled ? 'settings.dev.on' : 'settings.dev.off');
    }
    this.syncRenderPanelVisibility();
    this.syncAdvancedDevToggle();
    this.syncCardSourcePanelVisibility();
    this.syncAuthCodeEditor();
    this.syncCardSourceButtons();
    this.syncAnimatedLayersLabel();
    this.syncAnimatedLayersSpeedSlider();
    this.syncCardGenerateControls();
    this.applyCardGenerate();
    // The picker lists the modes this account may use, so the developer mode has to be reflected
    // on it: a mode that asks for that mode disappears when it is turned off, and the effective
    // selection falls back to the images.
    this.buildCardRenderButtons();
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
    this.syncAdvancedDevPanelVisibility();
    this.syncCardSourcePanelVisibility();
    this.setFeedback(null);
    // The generated source is only effective with both developer modes: turning the normal mode
    // off must bring the final images back now, not after a reload.
    this.applyCardSource();

    try {
      await accountManager.updateSettings({ devMode: next });
      // The console follows the switch at once: the lines a developer turned the mode on to read
      // are usually the next ones, and a reload would lose the very state being investigated.
      setDeveloperConsole(next);
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
    this.syncRenderPanelVisibility();
    this.syncAdvancedDevPanelVisibility();
    this.syncCardSourcePanelVisibility();
    this.syncAuthCodeEditor();
    this.buildCardRenderButtons();
  }

  /**
   * Checks the allowlist, then enables or disables the advanced developer mode.
   *
   * An unauthorized check leaves the switch off and opens the "ask MythMega/JMDev" modal; it is
   * never persisted. The check happens only when turning the switch on, because turning a
   * privilege off must always remain possible.
   *
   * @returns {Promise<void>} Resolves once the flow finished (success, refusal or failure).
   */
  async handleAdvancedDevToggle() {
    if (this.isBusy || !this.devMode) return;

    const previous = this.advancedDevMode;
    const next = !previous;

    if (next && !(await this.hasAdvancedDeveloperAccess())) {
      this.advancedDevMode = false;
      this.syncAdvancedDevToggle();
      this.syncCardSourcePanelVisibility();
      this.setFeedback(null);
      this.log('Advanced developer mode refused: the account is not on the allowlist.');
      await this.openInformation({
        titleKey: 'settings.advancedDev.deniedTitle',
        bodyKey: 'settings.advancedDev.deniedBody',
      });
      return;
    }

    this.advancedDevMode = next;
    this.syncAdvancedDevToggle();
    this.syncCardSourcePanelVisibility();
    this.setFeedback(null);
    this.buildCardRenderButtons();

    try {
      await accountManager.updateSettings({ advancedDevMode: next });
      this.log(`Advanced developer mode ${next ? 'enabled' : 'disabled'} and saved.`);
    } catch (error) {
      console.error('[SettingsView] The advanced developer mode could not be saved.', error);
      this.advancedDevMode = previous;
      this.syncAdvancedDevToggle();
      this.syncCardSourcePanelVisibility();
      this.setFeedback('settings.error.advancedDevMode', 'error');
      this.buildCardRenderButtons();
    }
  }

  /**
   * Reflects the stored scrollbar preference on its switch.
   *
   * The switch does not hold the value: `settings.nativeScrollbars` does, and the attribute on
   * `<html>` is what the stylesheet reads. Re-reading the store keeps the panel honest after an
   * imported save or a reset.
   *
   * @returns {Promise<void>} Resolves once the switch matches the stored preference.
   */
  async syncNativeScrollbarsToggle() {
    if (!this.nativeScrollbarsToggle) return;
    let enabled = false;
    try {
      const settings = await accountManager.getSettings();
      enabled = settings.nativeScrollbars === true;
    } catch (error) {
      console.warn('[SettingsView] The scrollbar preference could not be read.', error);
    }
    this.applyNativeScrollbars(enabled);
  }

  /**
   * Writes the scrollbar preference on the switch and on the document.
   *
   * @param {boolean} enabled - Whether the system bars are asked for.
   * @returns {void}
   */
  applyNativeScrollbars(enabled) {
    this.nativeScrollbars = enabled;
    if (this.nativeScrollbarsToggle) {
      this.nativeScrollbarsToggle.setAttribute('aria-checked', enabled ? 'true' : 'false');
    }
    if (this.nativeScrollbarsStateElement) {
      this.nativeScrollbarsStateElement.textContent = i18n.t(
        enabled ? 'settings.scrollbars.on' : 'settings.scrollbars.off'
      );
    }
    scrollHint.setNativeBars(enabled);
  }

  /**
   * Swaps the scrollbar indicator and persists the choice.
   *
   * The switch moves first, like the sound and the developer mode, and moves back with a message
   * when the write fails: a switch left on that would come back off at the next startup would lie.
   *
   * @returns {Promise<void>} Resolves once the flow finished (success or failure).
   */
  async handleNativeScrollbarsToggle() {
    if (this.isBusy) return;

    const previous = this.nativeScrollbars;
    const next = !previous;
    this.applyNativeScrollbars(next);
    this.setFeedback(null);

    try {
      await accountManager.updateSettings({ nativeScrollbars: next });
      this.log(`System scrollbars ${next ? 'enabled' : 'disabled'} and saved.`);
    } catch (error) {
      console.error('[SettingsView] The scrollbar preference could not be saved.', error);
      this.applyNativeScrollbars(previous);
      this.setFeedback('settings.error.scrollbars', 'error');
    }
  }

  /**
   * Reflects the stored release-notes preference on its switch.
   *
   * Like the scrollbars, the switch holds no value of its own: `settings.announceChangelog` does,
   * and `app.js` reads it at boot. Re-reading the store keeps the panel honest after an imported
   * save or a reset.
   *
   * @returns {Promise<void>} Resolves once the switch matches the stored preference.
   */
  async syncChangelogAnnounceToggle() {
    if (!this.changelogAnnounceToggle) return;
    let enabled = true;
    try {
      const settings = await accountManager.getSettings();
      enabled = settings.announceChangelog !== false;
    } catch (error) {
      console.warn('[SettingsView] The release-notes preference could not be read.', error);
    }
    this.applyChangelogAnnounce(enabled);
  }

  /**
   * Draws the release-notes switch and its state label.
   *
   * @param {boolean} enabled - Whether the dialog opens at startup.
   * @returns {void}
   */
  applyChangelogAnnounce(enabled) {
    this.changelogAnnounceEnabled = enabled;
    if (this.changelogAnnounceToggle) {
      this.changelogAnnounceToggle.setAttribute('aria-checked', enabled ? 'true' : 'false');
    }
    if (this.changelogAnnounceStateElement) {
      this.changelogAnnounceStateElement.textContent = i18n.t(
        enabled ? 'settings.dev.on' : 'settings.dev.off'
      );
    }
  }

  /**
   * Flips the release-notes preference and stores it.
   *
   * Nothing opens here: the dialog is read once at boot, so the change applies to the NEXT start.
   *
   * @returns {Promise<void>} Resolves once the flow finished (success or failure).
   */
  async handleChangelogAnnounceToggle() {
    if (this.isBusy) return;
    const previous = this.changelogAnnounceEnabled !== false;
    const next = !previous;
    this.applyChangelogAnnounce(next);
    this.setFeedback(null);

    try {
      await accountManager.updateSettings({ announceChangelog: next });
      this.log(`Release-notes dialog ${next ? 'enabled' : 'disabled'} and saved.`);
    } catch (error) {
      console.error('[SettingsView] The release-notes preference could not be saved.', error);
      this.applyChangelogAnnounce(previous);
      this.setFeedback('settings.changelog.announceError', 'error');
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
   * Fills the Follow List refresh-delay slider from `config.json` and the stored preference.
   *
   * The unit is MINUTES. Nothing is applied live: `SocialManager` reads the preference on its next
   * refresh, so saving the account setting is enough. The Refresh button of the Social view remains
   * a forced read and deliberately ignores this delay.
   *
   * @returns {Promise<void>} Resolves once the slider is painted.
   */
  async renderSocialRefresh() {
    if (!this.socialRefreshSlider) return;
    const range = await configLoader.getSocialRefreshSettings();
    this.socialRefreshSlider.min = String(range.min);
    this.socialRefreshSlider.max = String(range.max);
    this.socialRefreshSlider.step = String(range.step);

    try {
      const settings = await accountManager.getSettings();
      this.socialRefreshMinutes = settings.socialRefreshMinutes ?? range.default;
    } catch (error) {
      console.warn('[SettingsView] The Follow List refresh delay could not be read.', error);
      this.socialRefreshMinutes = range.default;
    }
    this.applySocialRefresh();
  }

  /**
   * Writes the Follow List refresh delay on its slider and output.
   *
   * @returns {void}
   */
  applySocialRefresh() {
    if (this.socialRefreshSlider) {
      this.socialRefreshSlider.value = String(this.socialRefreshMinutes);
    }
    this.renderSocialRefreshValue();
  }

  /**
   * Writes the delay displayed next to its slider.
   *
   * @param {number} [minutes] - Value to display (the current one by default).
   * @returns {void}
   */
  renderSocialRefreshValue(minutes = this.socialRefreshMinutes) {
    if (!this.socialRefreshValueElement) return;
    this.socialRefreshValueElement.textContent = i18n.t('settings.social.refreshValue', {
      value: minutes,
    });
  }

  /**
   * Applies the Follow List delay while the thumb moves (the release is what saves).
   *
   * @param {Event} event - Input event of the range element.
   * @returns {void}
   */
  handleSocialRefreshInput(event) {
    const minutes = Number(event?.target?.value);
    if (!Number.isFinite(minutes)) return;
    this.socialRefreshMinutes = Math.round(minutes);
    this.setFeedback(null);
    this.renderSocialRefreshValue();
  }

  /**
   * Persists the Follow List refresh delay once the player lets go of the thumb.
   *
   * @returns {Promise<void>} Resolves once the flow finished (success or failure).
   */
  async handleSocialRefreshChange() {
    try {
      await accountManager.updateSettings({
        socialRefreshMinutes: this.socialRefreshMinutes,
      });
      this.log(`Follow List refresh delay set to ${this.socialRefreshMinutes} min and saved.`);
    } catch (error) {
      console.error('[SettingsView] The Follow List refresh delay could not be saved.', error);
      this.setFeedback('settings.error.socialRefresh', 'error');
    }
  }

  /**
   * Fills the mining-speed slider from the stored preference.
   *
   * The three stops are the speeds `AccountManager` accepts, in the order they are read: `normal`
   * (the historical beat of `mining.keyHoldIntervalMs`), `fast`, and `veryFast`, which runs exactly
   * twice as fast as `normal`. Nothing is applied live: the mine reads the preference when it opens,
   * so storing it is enough.
   *
   * @returns {Promise<void>} Resolves once the slider is painted.
   */
  async renderMineSpeed() {
    if (!this.mineSpeedSlider) return;
    try {
      const settings = await accountManager.getSettings();
      this.mineSpeed = settings.mineSpeed ?? DEFAULT_MINE_SPEED;
    } catch (error) {
      console.warn('[SettingsView] The mining speed could not be read.', error);
      this.mineSpeed = DEFAULT_MINE_SPEED;
    }
    this.applyMineSpeed();
  }

  /**
   * Writes the speed on the slider and on its output.
   *
   * @returns {void}
   */
  applyMineSpeed() {
    if (this.mineSpeedSlider) {
      this.mineSpeedSlider.max = String(MINE_SPEEDS.length - 1);
      const index = MINE_SPEEDS.indexOf(this.mineSpeed);
      this.mineSpeedSlider.value = String(index === -1 ? 0 : index);
    }
    this.renderMineSpeedValue();
  }

  /**
   * Writes the name of the speed next to the slider.
   *
   * @param {string} [speed] - Speed to display (the current one by default).
   * @returns {void}
   */
  renderMineSpeedValue(speed = this.mineSpeed) {
    if (!this.mineSpeedValue) return;
    const labelKeys = {
      normal: 'settings.mine.normal',
      fast: 'settings.mine.fast',
      veryFast: 'settings.mine.veryFast',
    };
    this.mineSpeedValue.textContent = i18n.t(labelKeys[speed] ?? 'settings.mine.normal');
  }

  /**
   * Applies the speed while the thumb moves (the release is what saves).
   *
   * @returns {void}
   */
  handleMineSpeedInput() {
    const position = Number(this.mineSpeedSlider?.value);
    this.mineSpeed =
      MINE_SPEEDS[Number.isInteger(position) ? position : 0] ?? DEFAULT_MINE_SPEED;
    this.setFeedback(null);
    this.renderMineSpeedValue();
  }

  /**
   * Persists the mining speed once the player lets go of the thumb.
   *
   * Like the other sliders, a failed write keeps the value for this session and reports it.
   *
   * @returns {Promise<void>} Resolves once the flow finished (success or failure).
   */
  async handleMineSpeedChange() {
    try {
      await accountManager.updateSettings({ mineSpeed: this.mineSpeed });
      this.log(`Mining speed set to "${this.mineSpeed}" and saved.`);
    } catch (error) {
      console.error('[SettingsView] The mining speed could not be saved.', error);
      this.setFeedback('settings.error.mineSpeed', 'error');
    }
  }

  /**
   * Fills the quest walkthrough switch from the stored preference.
   *
   * The preference is read on every "Y aller" click by `app.js`; this switch only shows it.
   *
   * @returns {Promise<void>} Resolves once the switch is painted.
   */
  async renderQuestTutorial() {
    if (!this.questTutorialToggle) return;
    try {
      const settings = await accountManager.getSettings();
      this.questTutorial = settings.questNavigationTutorial !== false;
    } catch (error) {
      console.warn('[SettingsView] The quest tutorial preference could not be read.', error);
      this.questTutorial = true;
    }
    this.syncQuestTutorialToggle();
  }

  /**
   * Reflects the quest walkthrough preference on its switch and caption.
   *
   * @returns {void}
   */
  syncQuestTutorialToggle() {
    if (!this.questTutorialToggle) return;
    this.questTutorialToggle.setAttribute('aria-checked', this.questTutorial ? 'true' : 'false');
    if (this.questTutorialStateElement) {
      this.questTutorialStateElement.textContent = i18n.t(
        this.questTutorial ? 'settings.dev.on' : 'settings.dev.off'
      );
    }
  }

  /**
   * Flips the quest walkthrough and persists it.
   *
   * @returns {Promise<void>} Resolves once the flow finished (success or failure).
   */
  async handleQuestTutorialToggle() {
    if (this.isBusy) return;
    const previous = this.questTutorial;
    this.questTutorial = !previous;
    this.syncQuestTutorialToggle();
    this.setFeedback(null);

    try {
      await accountManager.updateSettings({ questNavigationTutorial: this.questTutorial });
      this.log(
        `Quest navigation tutorial ${this.questTutorial ? 'enabled' : 'disabled'} and saved.`
      );
    } catch (error) {
      console.error('[SettingsView] The quest tutorial preference could not be saved.', error);
      this.questTutorial = previous;
      this.syncQuestTutorialToggle();
      this.setFeedback('settings.questTutorial.error', 'error');
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
    this.listen(this.tabsElement, 'keydown', (event) => this.handleTabKeyDown(event));
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
    this.listen(this.socialRefreshSlider, 'input', (event) =>
      this.handleSocialRefreshInput(event)
    );
    this.listen(this.socialRefreshSlider, 'change', () =>
      this.handleSocialRefreshChange()
    );
    this.listen(this.mineSpeedSlider, 'input', () => this.handleMineSpeedInput());
    this.listen(this.mineSpeedSlider, 'change', () => void this.handleMineSpeedChange());
    this.listen(this.animatedLayersSpeedSlider, 'input', (event) =>
      this.handleAnimatedLayersSpeedInput(event)
    );
    this.listen(this.animatedLayersSpeedSlider, 'change', () =>
      void this.handleAnimatedLayersSpeedChange()
    );
    [
      this.cardGenerateZoomSlider,
      this.cardGenerateUnderlayZoomSlider,
      this.cardGenerateStillBackgroundSlider,
      this.cardGenerateStillUnderlaySlider,
      this.cardGenerateBlurSlider,
      this.cardGenerateBorderSlider,
      this.cardGenerateHeaderSlider,
      this.cardGenerateBodySlider,
    ].forEach((slider) => {
      this.listen(slider, 'input', (event) => this.handleCardGenerateSliderInput(event));
      this.listen(slider, 'change', () => void this.handleCardGenerateSliderChange());
    });
    this.listen(this.cardGenerateRaritiesContainer, 'input', (event) =>
      this.handleCardGenerateRarityInput(event)
    );
    this.listen(this.cardGenerateRaritiesContainer, 'change', (event) =>
      void this.handleCardGenerateRarityChange(event)
    );
    this.listen(this.cardGenerateResetButton, 'click', () => void this.handleCardGenerateReset());
    this.listen(this.cardGenerateCopyButton, 'click', () => void this.handleCardGenerateCopy());
    this.cardGenerateLayerToggles.forEach(({ toggle }, key) => {
      this.listen(toggle, 'click', () => void this.handleCardGenerateLayerToggle(key));
    });
    Object.entries(this.notificationToggles).forEach(([type, toggle]) => {
      this.listen(toggle, 'click', () => void this.handleNotificationToggle(type));
    });
    this.listen(this.soundToggle, 'click', () => this.handleSoundToggle());
    this.listen(this.soundCategoriesElement, 'click', (event) => {
      const button = event.target instanceof Element
        ? event.target.closest('[data-settings-sound-category-toggle]')
        : null;
      if (button) void this.handleSoundCategoryToggle(button.dataset.settingsSoundCategoryToggle);
    });
    this.listen(this.soundCategoriesElement, 'input', (event) => {
      const slider = event.target instanceof Element
        ? event.target.closest('[data-settings-sound-category-volume]')
        : null;
      if (slider) {
        this.handleSoundCategoryVolumeInput(slider.dataset.settingsSoundCategoryVolume, event);
      }
    });
    this.listen(this.soundCategoriesElement, 'change', (event) => {
      const slider = event.target instanceof Element
        ? event.target.closest('[data-settings-sound-category-volume]')
        : null;
      if (slider) void this.handleSoundCategoryVolumeChange();
    });
    this.listen(this.devToggle, 'click', () => void this.handleDevToggle());
    this.listen(this.advancedDevToggle, 'click', () => void this.handleAdvancedDevToggle());
    this.listen(this.animatedLayersToggle, 'click', () => void this.handleAnimatedLayersToggle());
    this.listen(this.nativeScrollbarsToggle, 'click', () => void this.handleNativeScrollbarsToggle());
    this.listen(this.questTutorialToggle, 'click', () => void this.handleQuestTutorialToggle());
    this.listen(this.changelogAnnounceToggle, 'click', () => void this.handleChangelogAnnounceToggle());
    this.listen(this.copyButton, 'click', () => this.handleCopyUuid());
    this.listen(this.authCodeCopyButton, 'click', () => void this.handleCopyAuthCode());
    this.listen(this.authCodeSaveButton, 'click', () => void this.handleSaveAuthCode());
    this.listen(this.errorLogCopyButton, 'click', () => void this.handleCopyErrorLog());
    this.listen(this.exportButton, 'click', () => this.handleExport());
    this.listen(this.importButton, 'click', () => this.handleImportClick());
    this.listen(this.onlineUploadButton, 'click', () => this.handleOnlineUpload());
    this.listen(this.onlineDownloadButton, 'click', () => this.handleOnlineDownload());
    this.listen(this.onlineBackupToggle, 'click', () => this.toggleOnlineBackup());
    this.listen(this.onlineModalClose, 'click', () => this.closeOnlineModal());
    this.listen(this.onlineModalCancel, 'click', () => this.closeOnlineModal());
    this.listen(this.onlineModalConfirm, 'click', () => this.handleOnlineConfirm());
    this.listen(this.onlineModal, 'click', (event) => {
      if (event?.target === this.onlineModal) {
        this.closeOnlineModal();
      }
    });
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
    this.listen(this.premiumOpenButton, 'click', () => this.openPremiumModal());
    this.listen(this.premiumClose, 'click', () => this.closePremiumModal());
    this.listen(this.premiumCancel, 'click', () => this.closePremiumModal());
    this.listen(this.premiumBuy, 'click', () => this.handlePremiumBuy());
    this.listen(this.premiumModal, 'click', (event) => {
      if (event?.target === this.premiumModal) {
        this.closePremiumModal();
      }
    });
    this.listen(document, 'keydown', (event) => {
      if (event?.key !== 'Escape') return;
      // The premium dialog is the one the player just opened: Escape closes it before the
      // confirmation dialog of the page, which can never be open at the same time anyway.
      if (this.premiumModal && !this.premiumModal.hidden) {
        this.closePremiumModal();
        return;
      }
      if (this.onlineModal && !this.onlineModal.hidden) {
        this.closeOnlineModal();
      }
      if (this.modal && !this.modal.hidden) {
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
    this.unsubscribers.push(
      eventBus.on(EVENTS.CARD_LANG_CHANGED, () => this.syncCardLanguageButtons())
    );
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
    this.unsubscribers.push(
      eventBus.on(EVENTS.BOOSTER_RENDER_CHANGED, () => {
        this.syncRenderButtons();
        this.renderRenderDetail();
      })
    );
    this.unsubscribers.push(eventBus.on(EVENTS.CLOCK_TICK, (payload) => this.renderClock(payload)));
    this.unsubscribers.push(errorLog.subscribe(() => this.renderErrorLog()));
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

    soundManager.playUi(UI_SOUNDS.SECTION_SWITCH);
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

    soundManager.playUi(UI_SOUNDS.SECTION_SWITCH);
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

    soundManager.playUi(UI_SOUNDS.SECTION_SWITCH);
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
    this.syncSoundCategories();
    this.setFeedback(null);

    try {
      await accountManager.updateSettings({ sound: next });
      this.log(`Sounds ${next ? 'enabled' : 'disabled'} and saved.`);
    } catch (error) {
      console.error('[SettingsView] The sound preference could not be saved.', error);
      soundManager.setEnabled(previous);
      this.syncSoundToggle();
      this.syncSoundCategories();
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
   * Copies the social publication code.
   *
   * The value is read from the manager rather than from the DOM so the copy always matches the
   * stored code, even after a reset or an imported save.
   *
   * @returns {Promise<void>} Resolves once the copy attempt finished.
   */
  async handleCopyAuthCode() {
    if (this.authCode === '') return;
    try {
      await this.writeToClipboard(this.authCode);
      this.setFeedback('settings.account.authCode.copied', 'info');
    } catch (error) {
      console.error('[SettingsView] The social code could not be copied.', error);
      this.setFeedback('settings.account.authCode.copyError', 'error');
    }
  }

  /**
   * Replaces the social publication code after an explicit confirmation.
   *
   * The basic developer mode reveals the field, the warning and this button; the confirmation is
   * the second safeguard, because a wrong code locks the account out of its own published card.
   *
   * @returns {Promise<void>} Resolves once the confirmation is displayed.
   */
  async handleSaveAuthCode() {
    if (!this.devMode || this.isBusy) return;
    const value = this.authCodeInput.value.trim().toUpperCase();
    if (!/^[A-Z0-9]{16}$/.test(value)) {
      this.setFeedback('settings.account.authCode.invalid', 'error');
      this.authCodeInput.focus();
      return;
    }

    await this.openConfirmation({
      titleKey: 'settings.account.authCode.confirmTitle',
      bodyKey: 'settings.account.authCode.confirmBody',
      confirmVariant: 'danger',
      onConfirm: async () => {
        try {
          await socialManager.setAuthCode(value);
          this.closeModal();
          await this.renderAccount();
          this.setFeedback('settings.account.authCode.saved', 'info');
        } catch (error) {
          console.error('[SettingsView] The social code could not be changed.', error);
          this.closeModal();
          this.setFeedback('settings.account.authCode.invalid', 'error');
        }
      },
    });
  }

  /**
   * Reveals the code editor only in the basic developer mode.
   *
   * @returns {void}
   */
  syncAuthCodeEditor() {
    if (!this.authCodeDevPanel) return;
    this.authCodeDevPanel.hidden = !this.devMode;
    if (!this.devMode && this.authCodeInput) this.authCodeInput.value = this.authCode;
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
   * Sends the current game to the worker as a `.save` file.
   *
   * @returns {Promise<void>} Resolves once the flow finished (success or failure).
   */
  async handleOnlineUpload() {
    if (this.isBusy) return;

    this.setBusy(true);
    this.setOnlineStatus('save.sync.uploading', 'info');
    this.log('Uploading the save…');
    try {
      const result = await saveSyncManager.uploadCurrentSave();
      const { date, time } = formatSyncTimestamp(result.savedAt);
      this.setOnlineStatus('save.sync.uploaded', 'info', { date, time });
      this.log(`Save uploaded (${result.byteLength} bytes).`);
    } catch (error) {
      console.error('[SettingsView] The save could not be uploaded.', error);
      this.setOnlineStatus(getSaveSyncErrorMessageKey(error), 'error');
    } finally {
      this.setBusy(false);
    }
  }

  /**
   * Reads the date of the last online save, then opens the download dialog.
   *
   * Nothing heavy is downloaded here: the file itself is only requested once the player confirms,
   * so opening the dialog on a slow connection stays cheap.
   *
   * @returns {Promise<void>} Resolves once the dialog is displayed (or the flow failed).
   */
  async handleOnlineDownload() {
    if (this.isBusy) return;

    this.setBusy(true);
    this.setOnlineStatus('save.sync.checking', 'info');
    try {
      const { exists, savedAt } = await saveSyncManager.getLastSaveDate();
      if (!exists) {
        this.setOnlineStatus('save.sync.none', 'info');
        return;
      }
      this.setOnlineStatus(null);
      this.openOnlineModal(savedAt);
    } catch (error) {
      console.error('[SettingsView] The last save date could not be read.', error);
      this.setOnlineStatus(getSaveSyncErrorMessageKey(error), 'error');
    } finally {
      this.setBusy(false);
    }
  }

  /**
   * Shows the download dialog with the date of the save it offers.
   *
   * @param {string|null} savedAt - Server timestamp of the last upload.
   * @returns {void}
   */
  openOnlineModal(savedAt) {
    this.onlineSavedAt = savedAt;
    const { date, time } = formatSyncTimestamp(savedAt);
    this.onlineModalTitle.textContent = i18n.t('save.sync.confirmTitle');
    this.onlineModalDate.textContent = i18n.t('save.sync.confirmBody', { date, time });
    // The switch starts off on every opening: a local copy is never written without being asked.
    this.onlineBackup = false;
    this.syncOnlineBackup();
    this.onlineModal.hidden = false;
    this.onlineModalConfirm.focus();
    this.log('Online download dialog displayed.');
  }

  /**
   * Flips the "backup the current session" switch.
   *
   * @returns {void}
   */
  toggleOnlineBackup() {
    this.onlineBackup = !this.onlineBackup;
    this.syncOnlineBackup();
  }

  /**
   * Reflects the backup switch in the dialog.
   *
   * @returns {void}
   */
  syncOnlineBackup() {
    this.onlineBackupToggle.setAttribute('aria-checked', this.onlineBackup ? 'true' : 'false');
    this.onlineBackupStateElement.textContent = i18n.t(
      this.onlineBackup ? 'save.sync.backupOn' : 'save.sync.backupOff'
    );
  }

  /**
   * Downloads the online save and replaces the local game with it.
   *
   * When the backup switch is on, the current game is first written to the device as
   * `minecard-backupsave-<date>.save`: the load is about to replace it, and the player keeps a
   * copy of what they had.
   *
   * @returns {Promise<void>} Resolves only when the load failed (a success reloads the page).
   */
  async handleOnlineConfirm() {
    if (this.isBusy) return;
    this.closeOnlineModal();
    this.setBusy(true);

    try {
      if (this.onlineBackup) {
        const { filename } = await saveSyncManager.backupCurrentSave({ day: this.getTrustedDay() });
        this.log(`Current session backed up to "${filename}".`);
      }
      this.setOnlineStatus('save.sync.loading', 'info');
      await saveSyncManager.downloadLastSave();
    } catch (error) {
      console.error('[SettingsView] The online save could not be loaded.', error);
      this.setOnlineStatus(getSaveSyncErrorMessageKey(error), 'error');
      this.setBusy(false);
    }
  }

  /**
   * Closes the download dialog.
   *
   * @returns {void}
   */
  closeOnlineModal() {
    this.onlineSavedAt = null;
    this.onlineModal.hidden = true;
  }

  /**
   * Displays a message under the two online buttons.
   *
   * @param {string|null} key - i18n key, or null to clear the message.
   * @param {'info'|'error'} [tone='info'] - Visual tone, exposed as `data-tone`.
   * @param {object|null} [params=null] - Interpolation values.
   * @returns {void}
   */
  setOnlineStatus(key, tone = 'info', params = null) {
    this.onlineStatus = key ? { key, tone, params } : null;
    this.renderOnlineStatus();
  }

  /**
   * Writes the stored online message into the DOM (re-translated on a language change).
   *
   * @returns {void}
   */
  renderOnlineStatus() {
    if (!this.onlineStatusElement) return;
    if (!this.onlineStatus) {
      this.onlineStatusElement.hidden = true;
      this.onlineStatusElement.textContent = '';
      this.onlineStatusElement.removeAttribute('data-tone');
      return;
    }
    this.onlineStatusElement.hidden = false;
    this.onlineStatusElement.textContent = i18n.t(
      this.onlineStatus.key,
      this.onlineStatus.params
    );
    this.onlineStatusElement.dataset.tone = this.onlineStatus.tone;
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
   * The same button also re-checks the automatic codes (`AutoClaim`): the distribution check is the
   * manual "look again" of the player, so it must catch a gift whose requirements are met — even
   * when the sheet itself cannot be read. The check is run AFTER the report, and the gift popup sits
   * above it: the player closes the gift, then reads the report underneath.
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

    try {
      await autoClaimManager.check({ reason: AUTO_CLAIM_REASONS.SETTINGS });
    } catch (error) {
      // `check()` never rejects; this is the last safety net for the button flow.
      console.warn('[SettingsView] The automatic codes could not be checked.', error);
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
          ? info.card.getName(cardLanguage.getLang())
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
   * Opens an information modal (distribution report or a translated message).
   *
   * Same dialog as a confirmation, but the cancel button is hidden and the only action closes it:
   * there is nothing to accept.
   *
   * @param {object} information - Content of the modal.
   * @param {string} information.titleKey - i18n key of the title.
   * @param {string|null} [information.bodyKey] - i18n key of a plain message instead of a report.
   * @param {object|null} [information.params] - Interpolation values for `bodyKey`.
   * @param {object|null} [information.report] - Result of `GiftManager.checkGifts()`.
   * @returns {Promise<void>} Resolves once the modal is displayed.
   */
  async openInformation({ titleKey, bodyKey = null, params = null, report = null }) {
    this.pendingModal = {
      mode: 'info',
      titleKey,
      bodyKey,
      params,
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
      ? pending.bodyKey
        ? i18n.t(pending.bodyKey, pending.params)
        : await this.buildCheckBody(pending.report)
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
   * Opens the premium offer: what the subscription grants, and the button that buys it.
   *
   * The dialog is rebuilt on every opening, so a player who closed it once reads the complete offer
   * again rather than the last thing that was on screen.
   *
   * @returns {void}
   */
  openPremiumModal() {
    if (!this.premiumModal) return;
    this.premiumUsed = false;
    this.renderPremiumBody();
    this.premiumCancel.hidden = false;
    this.premiumBuy.textContent = i18n.t('settings.premium.buy');
    this.premiumModal.hidden = false;
    this.premiumOpenButton.setAttribute('aria-expanded', 'true');
    this.premiumBuy.focus();
    this.log('Premium offer displayed.');
  }

  /**
   * Runs the purchase of the premium offer.
   *
   * The offer page opens in a tab of its own (the game keeps this one), and the dialog then says
   * what the subscription really is. A second press on the same button only closes the dialog: there
   * is nothing left to buy.
   *
   * @returns {void}
   */
  handlePremiumBuy() {
    if (!this.premiumModal || this.premiumModal.hidden) return;
    if (this.premiumUsed) {
      this.closePremiumModal();
      return;
    }

    // `noopener` keeps the opened page away from this window, and `noreferrer` keeps the address of
    // the game out of its logs: the offer is a page of somebody else.
    window.open(PREMIUM_OFFER_URL, '_blank', 'noopener,noreferrer');
    this.premiumUsed = true;
    this.renderPremiumBody();
    this.premiumCancel.hidden = true;
    this.premiumBuy.textContent = i18n.t('settings.premium.after.close');
    this.premiumBuy.focus();
    this.log('Premium offer opened in a new tab.');
  }

  /**
   * Writes the advantages of the offer in the panel of the section.
   *
   * @returns {void}
   */
  renderPremiumPerks() {
    if (!this.premiumPerksElement) return;
    this.premiumPerksElement.textContent = '';
    this.appendPremiumPerkItems(this.premiumPerksElement);
  }

  /**
   * Fills a list with one row per advantage of the offer, in the active language.
   *
   * @param {HTMLUListElement} list - The `<ul>` receiving the rows.
   * @returns {void}
   */
  appendPremiumPerkItems(list) {
    PREMIUM_PERK_KEYS.forEach((key) => {
      const item = document.createElement('li');
      item.textContent = i18n.t(key);
      list.appendChild(item);
    });
  }

  /**
   * Builds the list of the advantages, for the dialog.
   *
   * @returns {HTMLUListElement} The list, ready to append.
   */
  buildPremiumPerkList() {
    const list = document.createElement('ul');
    list.className = 'premium__perks premium__perks--dialog';
    this.appendPremiumPerkItems(list);
    return list;
  }

  /**
   * Writes the body of the premium dialog for the state it is in.
   *
   * Before the offer is used it is the pitch and the advantages; once the offer page was opened it
   * is the answer, which has no list and no second chance to buy.
   *
   * @returns {void}
   */
  renderPremiumBody() {
    if (!this.premiumBody) return;
    this.premiumTitle.textContent = i18n.t(
      this.premiumUsed ? 'settings.premium.after.title' : 'settings.premium.modal.title'
    );
    this.premiumBody.textContent = '';

    if (this.premiumUsed) {
      const answer = document.createElement('p');
      answer.textContent = i18n.t('settings.premium.after.body');
      this.premiumBody.appendChild(answer);
      return;
    }

    const pitch = document.createElement('p');
    pitch.textContent = i18n.t('settings.premium.modal.body');
    this.premiumBody.append(pitch, this.buildPremiumPerkList());
  }

  /**
   * Closes the premium dialog.
   *
   * @returns {void}
   */
  closePremiumModal() {
    if (!this.premiumModal) return;
    this.premiumModal.hidden = true;
    this.premiumOpenButton.setAttribute('aria-expanded', 'false');
    this.premiumUsed = false;
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
      this.advancedDevToggle,
      this.nativeScrollbarsToggle,
      this.copyButton,
      this.authCodeCopyButton,
      this.authCodeSaveButton,
      this.exportButton,
      this.importButton,
      this.onlineUploadButton,
      this.onlineDownloadButton,
      this.resetButton,
      this.checkGiftsButton,
      this.giftHistoryButton,
    ].forEach((button) => {
      button.disabled = isBusy;
    });
    this.soundCategoriesElement
      ?.querySelectorAll('button, input')
      .forEach((control) => {
        control.disabled = isBusy;
      });
    if (!isBusy) this.syncSoundCategories();
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
    // The "Automatic" entry of the card picker is a translated label: it follows the interface.
    void this.renderCardLanguageSelector().catch((error) => {
      console.error('[SettingsView] The card language list could not be re-rendered.', error);
    });
    void this.renderThemeSelector().catch((error) => {
      console.error('[SettingsView] The theme list could not be re-rendered.', error);
    });
    this.  renderSoundCategories();
    this.renderOnlineStatus();
    this.syncSoundToggle();
    void this.syncDevToggle();
    this.renderCardSourceSelector();
    void this.renderCardRenderSelector();
    this.renderCardGenerateRarities();
    void this.renderAnimationSelector().catch((error) => {
      console.error('[SettingsView] The animation list could not be re-rendered.', error);
    });
    this.renderRenderSelector();
    // The animation picker rebuilds its labels on its own; the foil percentage is a translated
    // string too, so it has to be rewritten here.
    this.renderFoilValue();
    this.renderNotificationDurationValue();
    this.renderClock();
    this.renderPremiumPerks();
    // An open dialog is part of the page: its pitch and its list follow the language too.
    if (this.premiumModal && !this.premiumModal.hidden) this.renderPremiumBody();
    void this.renderChangelog();
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
    this.syncCardLanguageButtons();
    this.syncThemeButtons();
    this.syncAnimationButtons();
    this.syncRenderButtons();
    this.renderRenderDetail();
    // Arriving on the page replays the demo: an animation is the one thing a picker can not
    // describe in words.
    this.playAnimationDemo();
    this.syncFoilSlider();
    this.syncSoundToggle();
    this.syncSoundCategories();
    void this.syncDevToggle();
    this.renderCardSourceSelector();
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
    this.renderButtons.clear();
    this.demoCard = null;
    this.closeModal();
    this.isInitialized = false;
  }
}

export default SettingsView;

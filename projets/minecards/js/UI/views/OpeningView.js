/**
 * OpeningView - Booster opening screen (choice of the extension, 3D scene, card reveal).
 *
 * Reference: `.docs/steps/4.md` points 1, 2 and 4.
 *
 * FLOW
 *   1. "select" stage: the extension picker, a 3D PREVIEW of the selected booster (it turns on its
 *      own, and the arrows on each side change the extension, which updates the combo — and the
 *      combo updates the texture), the remaining quota and the open button (disabled with the
 *      countdown to the next reset when nothing is left);
 *   2. pressing the button calls `BoosterManager.openBooster()`: the pack is DRAWN AND PERSISTED
 *      before anything is animated, so closing the tab during the reveal loses nothing;
 *   3. "scene" stage: the 3D booster is prepared (or the 2D fallback when WebGL/Three.js is
 *      unavailable); the player rotates it, then a tap or an upward swipe tears it open;
 *   4. spotlight: one big face-down card at a time; tap (or swipe left) to reveal it, then
 *      swipe left / tap / "Next" to move to the following card WITHOUT flipping it face down
 *      again ("Previous" goes back);
 *   5. summary: the 5 cards in a grid; tapping one opens the card detail modal (image, name,
 *      rarity); "Finish" performs NO write, it only closes the scene, while "Copy the booster
 *      code" puts a shareable `minecards:<base64url>` code in the clipboard (see `BoosterCode`).
 *
 * The view is instantiated once by `app.js` and driven through `handleViewActivated()` /
 * `handleViewDeactivated()` (from `VIEW_CHANGED`), so the WebGL loop never runs in the background.
 */

import eventBus, { EVENTS } from '../../utils/EventBus.js';
import i18n from '../../utils/I18n.js';
import cardLanguage from '../../utils/CardLanguage.js';
import boosterManager from '../../business/BoosterManager.js';
import collectionManager from '../../business/CollectionManager.js';
import profileManager from '../../business/ProfileManager.js';
import dateSyncManager, { BOOSTER_SOURCES } from '../../business/DateSyncManager.js';
import CardComponent from '../components/CardComponent.js';
import Toast from '../components/Toast.js';
import dailyRewardPopup from '../components/DailyRewardPopup.js';
import { buildBoosterCode } from '../../utils/BoosterCode.js';
import { writeToClipboard } from '../../utils/Clipboard.js';
import soundManager, { SOUNDS, UI_SOUNDS } from '../../utils/SoundManager.js';
import animationManager from '../../utils/AnimationManager.js';
import { setFocusMode } from '../../utils/FocusMode.js';
import { getRarityLabel } from '../../classes/Card.js';
import { attachCardTilt } from '../../utils/CardTilt.js';
import Booster3DRenderer, { DEFAULT_MODEL_PATH } from '../components/Booster3DRenderer.js';
import boosterRenderManager from '../../utils/BoosterRenderManager.js';
import { getShineClasses, applyShine, applyCardGlow } from '../../utils/Shine.js';
import { buildCardEffectsToggle, syncCardEffectsToggle } from '../components/CardEffectsToggle.js';
import { preloadImage, preloadImages, isImageReady } from '../../utils/ImagePreloader.js';
import { reportError } from '../../utils/ErrorReporter.js';

/** View name, matching `data-view="opening"` in `index.html`. */
export const OPENING_VIEW_NAME = 'opening';

/** Delay before releasing the WebGL resources of an inactive view, in milliseconds. */
const IDLE_DISPOSE_DELAY_MS = 30000;

/** Minimum horizontal swipe distance on the spotlight card, in pixels. */
const SWIPE_THRESHOLD_PX = 24;

/** Beat of the automatic reveal while Space is held, in milliseconds (the overlay's own pace). */
const SPACE_AUTO_ADVANCE_MS = 900;

/** Wait before the spotlight stops waiting for an illustration that never arrives, in ms. */
const SPOTLIGHT_IMAGE_TIMEOUT_MS = 8000;

/** Pieces the "explosive" mode throws over the stage. Enough to be silly, few enough to keep
 *  the burst readable (and 18 compositor layers is about what a phone takes for free). */
const CONFETTI_COUNT = 18;

/** Confetti palette. Theme variables, not hex codes: the three themes stay in charge. */
const CONFETTI_COLORS = [
  'var(--color-accent)',
  'var(--color-warning)',
  'var(--color-success)',
  'var(--color-text)',
];

export class OpeningView {
  /**
   * @param {HTMLElement} rootElement - The opening `<section>`.
   * @param {object} [options] - View options.
   * @param {(result: object) => void|null} [options.onBoosterOpened=null] - Called after a pack is
   *   persisted, before the reveal (used by `app.js` for the header/summary).
   */
  constructor(rootElement, { onBoosterOpened = null } = {}) {
    if (!rootElement || typeof rootElement.querySelector !== 'function') {
      throw new TypeError('OpeningView requires the opening section element.');
    }

    this.root = rootElement;
    this.onBoosterOpened = onBoosterOpened;

    this.selectStage = this.root.querySelector('[data-opening-stage="select"]');
    this.sceneStage = this.root.querySelector('[data-opening-stage="scene"]');
    this.setSelect = this.root.querySelector('[data-opening-set]');
    this.quotaElement = this.root.querySelector('[data-opening-quota]');
    this.countdownElement = this.root.querySelector('[data-opening-countdown]');
    this.countdownValue = this.root.querySelector('[data-opening-countdown-value]');
    this.releaseElement = this.root.querySelector('[data-opening-release]');
    this.openButton = this.root.querySelector('[data-opening-open]');
    this.feedbackElement = this.root.querySelector('[data-opening-feedback]');
    this.openManyButton = this.root.querySelector('[data-opening-open-many]');
    this.batchCounterElement = this.root.querySelector('[data-opening-batch-counter]');

    this.countModal = this.root.querySelector('[data-opening-count-modal]');
    this.countTitle = this.root.querySelector('[data-opening-count-title]');
    this.countBody = this.root.querySelector('[data-opening-count-body]');
    this.countClose = this.root.querySelector('[data-opening-count-close]');
    this.countCancel = this.root.querySelector('[data-opening-count-cancel]');
    this.countConfirm = this.root.querySelector('[data-opening-count-confirm]');
    this.countInputs = {
      daily: this.root.querySelector('[data-opening-count-input="daily"]'),
      bonus: this.root.querySelector('[data-opening-count-input="bonus"]'),
    };
    this.countLabels = {
      daily: this.root.querySelector('[data-opening-count-label="daily"]'),
      bonus: this.root.querySelector('[data-opening-count-label="bonus"]'),
    };
    this.countSteps = Array.from(this.root.querySelectorAll('[data-opening-count-step]'));
    this.countAllButtons = Array.from(this.root.querySelectorAll('[data-opening-count-all]'));

    this.boosterContainer = this.root.querySelector('[data-booster-3d]');
    this.boosterViewport = this.root.querySelector('[data-booster-canvas]');
    this.boosterFallback = this.root.querySelector('[data-booster-fallback]');
    this.boosterLoading = this.root.querySelector('[data-booster-loading]');
    this.boosterHint = this.root.querySelector('[data-booster-hint]');
    this.burstElement = this.root.querySelector('[data-opening-burst]');

    this.previewContainer = this.root.querySelector('[data-booster-preview]');
    this.previewViewport = this.root.querySelector('[data-booster-preview-canvas]');
    this.previewFallback = this.root.querySelector('[data-booster-preview-fallback]');
    this.previewLoading = this.root.querySelector('[data-booster-preview-loading]');
    this.prevSetButton = this.root.querySelector('[data-booster-prev-set]');
    this.nextSetButton = this.root.querySelector('[data-booster-next-set]');

    this.revealHint = this.root.querySelector('[data-opening-reveal-hint]');
    this.spotlightLoading = this.root.querySelector('[data-opening-spotlight-loading]');
    this.spotlightElement = this.root.querySelector('[data-opening-spotlight]');
    this.spotlightStage = this.root.querySelector('[data-opening-stage-card]');
    this.counterElement = this.root.querySelector('[data-opening-counter]');
    this.prevButton = this.root.querySelector('[data-opening-prev]');
    this.nextButton = this.root.querySelector('[data-opening-next]');
    this.revealContainer = this.root.querySelector('[data-card-summary]');
    this.summaryGrid = this.root.querySelector('[data-card-summary]');
    this.summaryElement = this.root.querySelector('[data-opening-summary]');
    this.actionsElement = this.root.querySelector('[data-opening-actions]');
    this.actionsMore = this.root.querySelector('[data-opening-actions-more]');
    this.actionsToggle = this.root.querySelector('[data-opening-actions-toggle]');
    this.actionsMenu = this.root.querySelector('[data-opening-actions-menu]');
    /** @type {number|null} Pending end of the closing animation of the "+" menu. */
    this.actionsMenuCloseTimer = null;
    this.copyCodeButton = this.root.querySelector('[data-opening-copy-code]');
    this.shareButton = this.root.querySelector('[data-opening-share]');
    this.saveButton = this.root.querySelector('[data-opening-save]');
    /** True while a saved opening is replayed: nothing is written, nothing is "new". */
    this.isReplay = false;
    /** True while a saved-opening slot is being written (guards a double click). */
    this.isSaving = false;
    /** Pack already pinned in a slot, so the same summary can never take two of them. */
    this.savedResult = null;
    this.finishButton = this.root.querySelector('[data-opening-finish]');
    this.cardModal = this.root.querySelector('[data-card-modal]');
    this.cardModalTitle = this.root.querySelector('[data-card-modal-title]');
    this.cardModalBody = this.root.querySelector('[data-card-modal-body]');
    this.cardModalClose = this.root.querySelector('[data-card-modal-close]');

    this.sourceModal = this.root.querySelector('[data-opening-source-modal]');
    this.sourceTitle = this.root.querySelector('[data-opening-source-title]');
    this.sourceBody = this.root.querySelector('[data-opening-source-body]');
    this.sourceClose = this.root.querySelector('[data-opening-source-close]');
    this.sourceButtons = Array.from(this.root.querySelectorAll('[data-opening-source-choice]'));

    this.storeButton = this.root.querySelector('[data-opening-store]');
    this.storeModal = this.root.querySelector('[data-opening-store-modal]');
    this.storeTitle = this.root.querySelector('[data-opening-store-title]');
    this.storeBody = this.root.querySelector('[data-opening-store-body]');
    this.storeSets = this.root.querySelector('[data-opening-store-sets]');
    this.storeClose = this.root.querySelector('[data-opening-store-close]');

    this.assertMarkup();

    /** @type {Map<string, object>} Extension descriptions, keyed by id. */
    this.sets = new Map();
    /** @type {string[]} Extension ids, in the display order of the picker (the arrows walk it). */
    this.setOrder = [];
    /** @type {string|null} Currently selected extension. */
    this.selectedSetId = null;
    /** @type {Booster3DRenderer|null} Non-interactive preview of the "select" stage. */
    this.previewRenderer = null;
    /** @type {Promise<void>|null} In-flight construction of the preview scene. */
    this.previewInitPromise = null;
    /** @type {boolean} True when the 3D preview is unavailable (2D image shown instead). */
    this.previewFailed = false;
    /** @type {object|null} Result of the last `openBooster()`, waiting for the reveal. */
    this.pendingResult = null;
    /** @type {Booster3DRenderer|null} */
    this.renderer3d = null;
    /** @type {CardComponent[]} Cards currently displayed. */
    this.cardComponents = [];
    /** @type {number} Index of the spotlighted card (0-based). */
    this.spotlightIndex = 0;
    /** @type {'idle'|'spotlight'|'summary'} Current reveal sub-stage. */
    this.revealStage = 'idle';
    /** @type {boolean} Effects (foil, brillance, halo) of the card detail; a reading comfort. */
    this.shineEnabled = true;
    /** @type {HTMLElement|null} Window the effects of the card detail are painted on. */
    this.shineWindow = null;
    /** @type {{x: number, y: number}|null} Touch start point for swipe detection. */
    this.touchStart = null;
    /** @type {boolean} True when the click following a swipe must be ignored. */
    this.suppressNextSpotlightClick = false;
    /** @type {boolean} True while a pack is being drawn or revealed. */
    this.isBusy = false;
    /** @type {boolean} True when the view is the active one. */
    this.isActive = false;
    /** @type {boolean} True when the 2D fallback is shown instead of the 3D scene. */
    this.isFallbackMode = false;
    /** @type {number|null} Timer releasing the idle WebGL context. */
    this.idleDisposeTimer = null;
    /** @type {number|null} Timer hiding the comic burst of the parodic mode. */
    this.burstTimer = null;
    /** @type {number|null} Timer guarding the arrival animation of the spotlight card. */
    this.spotlightEntryTimer = null;
    /** @type {boolean} True when a tap landed while the card was still arriving. */
    this.pendingSpotlightAction = false;
    /** @type {number} Token guarding the asynchronous picture warm-up of the spotlight. */
    this.spotlightLoadToken = 0;
    /** @type {number|null} Interval advancing the reveal while Space is held. */
    this.spaceHoldTimer = null;
    /** @type {string|null} Last feedback i18n key (re-translated on `LANG_CHANGED`). */
    this.feedbackKey = null;
    /** @type {'info'|'error'} */
    this.feedbackTone = 'info';
    /** @type {object|null} Last quota snapshot rendered. */
    this.lastQuota = null;
    /** @type {boolean} True while a daily booster is being parked in a bonus bucket. */
    this.isStoring = false;
    /** @type {Array<{setId: string, name: string, bonus: number}>|null} Sets offered by the store
     *  dialog while it is open. */
    this.storeChoices = null;
    /** @type {Array<{result: object, components: CardComponent[]}>} Packs of a batch reveal. */
    this.batchPacks = [];
    /** @type {number} Index of the pack being revealed inside `batchPacks`. */
    this.batchIndex = 0;
    /** @type {{daily: number, bonus: number}} Packs available while the count dialog is open. */
    this.countLimits = { daily: 0, bonus: 0 };
    /** @type {{daily: number, bonus: number}} Counts picked in the count dialog. */
    this.countValues = { daily: 0, bonus: 0 };

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
    console.info('[OpeningView]', ...args);
  }

  /**
   * Verifies that the markup matches the contract expected by this view.
   *
   * @returns {void}
   * @throws {Error} When a required element is missing from `index.html`.
   */
  assertMarkup() {
    const missing = [
      ['[data-opening-stage="select"]', this.selectStage],
      ['[data-opening-stage="scene"]', this.sceneStage],
      ['[data-opening-set]', this.setSelect],
      ['[data-opening-quota]', this.quotaElement],
      ['[data-opening-open]', this.openButton],
      ['[data-booster-canvas]', this.boosterViewport],
      ['[data-opening-burst]', this.burstElement],
      ['[data-opening-spotlight]', this.spotlightElement],
      ['[data-opening-stage-card]', this.spotlightStage],
      ['[data-opening-counter]', this.counterElement],
      ['[data-opening-prev]', this.prevButton],
      ['[data-opening-next]', this.nextButton],
      ['[data-card-summary]', this.summaryGrid],
      ['[data-card-modal]', this.cardModal],
      ['[data-card-modal-title]', this.cardModalTitle],
      ['[data-card-modal-body]', this.cardModalBody],
      ['[data-card-modal-close]', this.cardModalClose],
      ['[data-opening-source-modal]', this.sourceModal],
      ['[data-opening-source-title]', this.sourceTitle],
      ['[data-opening-source-body]', this.sourceBody],
      ['[data-opening-store]', this.storeButton],
      ['[data-opening-store-modal]', this.storeModal],
      ['[data-opening-store-title]', this.storeTitle],
      ['[data-opening-store-body]', this.storeBody],
      ['[data-opening-store-sets]', this.storeSets],
      ['[data-opening-copy-code]', this.copyCodeButton],
      ['[data-opening-share]', this.shareButton],
      ['[data-opening-actions-more]', this.actionsMore],
      ['[data-opening-actions-toggle]', this.actionsToggle],
      ['[data-opening-actions-menu]', this.actionsMenu],
      ['[data-opening-finish]', this.finishButton],
      ['[data-booster-3d]', this.boosterContainer],
      ['[data-booster-fallback]', this.boosterFallback],
      ['[data-booster-preview]', this.previewContainer],
      ['[data-booster-preview-canvas]', this.previewViewport],
      ['[data-booster-prev-set]', this.prevSetButton],
      ['[data-booster-next-set]', this.nextSetButton],
      ['[data-opening-open-many]', this.openManyButton],
      ['[data-opening-batch-counter]', this.batchCounterElement],
      ['[data-opening-count-modal]', this.countModal],
      ['[data-opening-count-input="daily"]', this.countInputs.daily],
      ['[data-opening-count-input="bonus"]', this.countInputs.bonus],
      ['[data-opening-count-confirm]', this.countConfirm],
    ]
      .filter(([, element]) => !element)
      .map(([selector]) => selector);

    if (missing.length > 0) {
      throw new Error(`OpeningView markup is incomplete, missing: ${missing.join(', ')}.`);
    }
  }

  /**
   * Registers a listener and remembers it for `destroy()`.
   *
   * @param {EventTarget} target - Event target.
   * @param {string} type - Event type.
   * @param {EventListener} handler - Listener.
   * @param {AddEventListenerOptions|boolean} [options=false] - Listener options.
   * @returns {void}
   */
  listen(target, type, handler, options = false) {
    target.addEventListener(type, handler, options);
    this.bindings.push({ target, type, handler, options });
  }

  /**
   * Loads the extensions, fills the picker and binds every interaction.
   *
   * @returns {Promise<void>} Resolves once the view is ready.
   * @throws {Error} When the booster data cannot be loaded (the caller shows the error).
   */
  async init() {
    this.log('Initializing…');
    await this.loadSets();
    // Loaded ahead of the first reveal so the very first card flip plays without a download delay.
    soundManager.preload();
    this.bindEvents();
    this.subscribeToEvents();
    this.refreshQuota();
    this.log(`Ready with ${this.sets.size} extension(s): ${[...this.sets.keys()].join(', ')}.`);
  }

  /**
   * Loads the declared extensions and builds the picker options.
   *
   * @returns {Promise<void>} Resolves once the options are rendered.
   * @throws {Error} When `BoosterManager` cannot load the extension JSONs.
   */
  async loadSets() {
    this.log('Loading booster extensions…');
    const loaded = await boosterManager.init();
    // The picker is the ONE place an announced set is allowed to appear before its release: it can
    // be looked at (3D model included) but never opened, see `refreshQuota()`.
    const listed = await boosterManager.listBoosterSets({ includeUpcoming: true });

    this.sets.clear();
    listed.forEach((set) => this.sets.set(set.setId, set));
    this.setOrder = listed.map((set) => set.setId);

    this.selectedSetId = listed[0]?.setId ?? null;
    await this.refreshSetOptions();
    this.log('Extensions loaded.', { sets: loaded.sets, selected: this.selectedSetId });
  }

  /**
   * (Re)builds the picker options, each one carrying the completion of its extension.
   *
   * The label reads `Nom (owned / total) [percentage %]`, where `owned` counts the DISTINCT cards
   * owned over the whole extension rather than the raw number of cards: the player sees what there
   * is left to find. A completion that cannot be read falls back to the extension card count
   * (0 owned), so a picker is always displayed.
   *
   * @returns {Promise<void>} Resolves once the options are rendered.
   */
  async refreshSetOptions() {
    let completion = null;
    try {
      completion = await collectionManager.getCompletion();
    } catch (error) {
      console.warn('[OpeningView] The completion could not be read for the extension picker.', error);
    }

    const previous = this.selectedSetId;
    this.setSelect.textContent = '';
    this.setOrder.forEach((setId) => {
      const set = this.sets.get(setId);
      if (!set) return;
      const stats = completion?.sets?.[setId]?.completion ?? null;
      const total = stats?.total ?? set.cardCount;
      const owned = stats?.owned ?? 0;
      const option = document.createElement('option');
      option.value = setId;
      // An announced set has no completion to show yet: its option carries its release date
      // instead, which is the only information the player can act on.
      option.textContent =
        set.released === false
          ? i18n.t('opening.set.optionUpcoming', {
              name: set.name,
              date: i18n.formatUtcDay(set.releaseDate),
            })
          : i18n.t('opening.set.option', {
              name: set.name,
              owned,
              total,
              percent: total > 0 ? Math.round((owned / total) * 100) : 0,
            });
      this.setSelect.appendChild(option);
    });

    if (previous && this.setOrder.includes(previous)) {
      this.selectedSetId = previous;
    } else {
      this.selectedSetId = this.setOrder[0] ?? null;
    }
    if (this.selectedSetId) {
      this.setSelect.value = this.selectedSetId;
    }
    this.log(`Extension picker refreshed (${this.setSelect.options.length} option(s)).`);
  }

  /**
   * Attaches the DOM listeners.
   *
   * @returns {void}
   */
  bindEvents() {
    this.listen(this.setSelect, 'change', () => this.handleSetChange());
    if (this.prevSetButton) {
      this.listen(this.prevSetButton, 'click', () => this.cycleSet(-1));
    }
    if (this.nextSetButton) {
      this.listen(this.nextSetButton, 'click', () => this.cycleSet(1));
    }
    this.listen(this.openButton, 'click', () => this.handleOpenClick());
    this.listen(this.openManyButton, 'click', () => this.handleOpenManyClick());
    if (this.saveButton) {
      this.listen(this.saveButton, 'click', () => {
        this.closeActionsMenu();
        void this.saveCurrentOpening();
      });
    }
    if (this.actionsToggle) {
      this.listen(this.actionsToggle, 'click', () => this.toggleActionsMenu());
      // A click anywhere else closes the menu; a click inside it is left to the button itself (the
      // menu is above the toggle, so it cannot be mistaken for the toggle).
      this.listen(document, 'pointerdown', (event) => {
        if (this.actionsMenu.hidden) return;
        if (this.actionsMore.contains(event.target)) return;
        this.closeActionsMenu();
      });
      this.listen(document, 'keydown', (event) => {
        if (event.key !== 'Escape' || this.actionsMenu.hidden) return;
        event.preventDefault();
        this.closeActionsMenu(true);
      });
      // Scrolling the summary slides the menu away from its "+": close it rather than leave it
      // floating over the cards. The focus of the first action is taken without scrolling (see
      // `toggleActionsMenu`), so this listener only ever sees a real scroll of the page.
      this.listen(window, 'scroll', () => this.closeActionsMenu(), { passive: true });
    }
    if (this.countModal) {
      this.listen(this.countModal, 'click', (event) => {
        if (event?.target === this.countModal) this.closeCountModal();
      });
    }
    if (this.countClose) this.listen(this.countClose, 'click', () => this.closeCountModal());
    if (this.countCancel) this.listen(this.countCancel, 'click', () => this.closeCountModal());
    if (this.countConfirm) this.listen(this.countConfirm, 'click', () => this.confirmCount());
    this.countSteps.forEach((button) => {
      this.listen(button, 'click', () => {
        this.stepCount(button.dataset.openingCountKind, Number(button.dataset.openingCountStep));
      });
    });
    this.countAllButtons.forEach((button) => {
      this.listen(button, 'click', () => this.fillCount(button.dataset.openingCountAll));
    });
    Object.entries(this.countInputs).forEach(([kind, input]) => {
      this.listen(input, 'input', (event) => this.setCountValue(kind, event.target.value));
    });
    this.listen(this.boosterFallback, 'click', (event) => this.handleFallbackClick(event));
    this.listen(this.copyCodeButton, 'click', () => {
      this.closeActionsMenu();
      this.handleCopyBoosterCode();
    });
    this.listen(this.shareButton, 'click', () => {
      this.closeActionsMenu();
      this.handleShareOpening();
    });
    this.listen(this.finishButton, 'click', () => this.finish());
    this.listen(this.prevButton, 'click', () => this.showPreviousCard());
    this.listen(this.nextButton, 'click', () => this.handleNextAction());
    if (this.spotlightStage) {
      this.listen(this.spotlightStage, 'click', () => this.handleSpotlightTap());
      this.listen(this.spotlightStage, 'touchstart', (event) => this.handleSpotlightTouchStart(event), { passive: true });
      this.listen(this.spotlightStage, 'touchend', (event) => this.handleSpotlightTouchEnd(event));
    }
    if (this.cardModal) {
      this.listen(this.cardModal, 'click', (event) => this.handleModalBackdropClick(event));
    }
    if (this.cardModalClose) {
      this.listen(this.cardModalClose, 'click', () => this.closeCardModal());
    }
    if (this.cardModalBody) {
      // The body is rebuilt for every card, so its buttons are handled by delegation.
      this.listen(this.cardModalBody, 'click', (event) => {
        const target = event?.target instanceof Element ? event.target : null;
        if (target?.closest('[data-card-effects]')) this.toggleCardEffects();
      });
    }
    if (this.sourceModal) {
      this.listen(this.sourceModal, 'click', (event) => {
        if (event?.target === this.sourceModal) this.closeSourceModal();
      });
    }
    if (this.sourceClose) {
      this.listen(this.sourceClose, 'click', () => this.closeSourceModal());
    }
    this.sourceButtons.forEach((button) => {
      this.listen(button, 'click', () => this.handleSourceChoice(button.dataset.openingSourceChoice));
    });
    if (this.storeButton) {
      this.listen(this.storeButton, 'click', () => this.handleStoreClick());
    }
    if (this.storeModal) {
      this.listen(this.storeModal, 'click', (event) => {
        if (event?.target === this.storeModal) this.closeStoreModal();
      });
    }
    if (this.storeClose) {
      this.listen(this.storeClose, 'click', () => this.closeStoreModal());
    }
    if (this.storeSets) {
      // One button per extension, rebuilt on every opening of the dialog: delegation keeps the
      // listener stable however many extensions the catalogue declares.
      this.listen(this.storeSets, 'click', (event) => this.handleStoreChoice(event));
    }
    this.listen(document, 'keydown', (event) => this.handleDocumentKeyDown(event));
    this.listen(document, 'keyup', (event) => this.handleDocumentKeyUp(event));
    // A window that loses the focus never sends the keyup: the automatic reveal must stop anyway.
    this.listen(window, 'blur', () => this.stopSpaceAutoAdvance());
    this.log('DOM listeners bound.');
  }

  /**
   * Subscribes to the application events the view depends on.
   *
   * @returns {void}
   */
  subscribeToEvents() {
    this.unsubscribers.push(eventBus.on(EVENTS.QUOTA_UPDATED, (payload) => this.handleQuotaUpdated(payload)));
    this.unsubscribers.push(eventBus.on(EVENTS.CLOCK_TICK, (payload) => this.handleClockTick(payload)));
    this.unsubscribers.push(eventBus.on(EVENTS.LANG_CHANGED, () => this.handleLanguageChanged()));
    this.unsubscribers.push(eventBus.on(EVENTS.CARD_LANG_CHANGED, () => this.handleLanguageChanged()));
    this.unsubscribers.push(
      eventBus.on(EVENTS.BOOSTER_RENDER_CHANGED, (payload) => this.handleRenderModeChanged(payload))
    );
    this.log('Event subscriptions registered.');
  }

  /**
   * Retunes the live 3D scenes when the developer render picker changes the mode.
   *
   * Both the picker preview and the opening scene may exist at the same time for a moment (the
   * preview is adopted by the opening stage): retuning both is cheap and keeps the recipe the same
   * on whichever canvas the player is looking at. The scene is NOT rebuilt: the geometry and the
   * textures stay uploaded, only the lights, the exposure and the materials change.
   *
   * @param {{mode?: string, settings?: object}|null} [payload=null] - Event payload; the manager's
   *   active recipe is used when it is missing.
   * @returns {void}
   */
  handleRenderModeChanged(payload = null) {
    const settings = payload?.settings ?? boosterRenderManager.getRenderSettings();
    this.previewRenderer?.setRenderSettings(settings);
    this.renderer3d?.setRenderSettings(settings);
    this.log(`Booster render mode applied to the live scenes: ${payload?.mode ?? settings.id}.`);
  }

  /**
   * Refreshes which top-level stage is visible (`select` or `scene`).
   *
   * Within the scene, the sub-stages are displayed one after another so the player never
   * sees the booster and the 5 cards at the same time:
   * 1. `booster` (3D model or 2D fallback, tap to open),
   * 2. `spotlight` (one big card at a time),
   * 3. `summary` (the 5 thumbnails, tap for the detail modal).
   *
   * @param {'select'|'scene'} stage - Stage to display.
   * @returns {void}
   */
  showStage(stage) {
    const showScene = stage === 'scene';
    this.selectStage.hidden = showScene;
    this.sceneStage.hidden = !showScene;
    // The ritual takes the whole screen: the brand, the counters, the bottom bar, the "how does it
    // work" pill and the title of the view go away for as long as the scene is up, and come back on
    // the way out (`setFocusMode`, `css/base.css`). It is toggled HERE because this method is the
    // exact boundary: the pack is drawn, then `showStage('scene')`; the summary is dismissed, then
    // `showStage('select')`.
    setFocusMode(showScene);
    this.log(`Stage displayed: ${stage} (focus mode ${showScene ? 'on' : 'off'}).`);
  }

  /**
   * Refreshes which sub-stage of the scene is visible: the booster to open, the one-by-one
   * spotlight reveal, or the summary grid. Never more than one at a time.
   *
   * @param {'booster'|'spotlight'|'summary'} subStage - Sub-stage to display inside the scene.
   * @returns {void}
   */
  showSceneSubStage(subStage) {
    const showBooster = subStage === 'booster';
    const showSpotlight = subStage === 'spotlight';
    const showSummary = subStage === 'summary';
    this.boosterContainer.hidden = !showBooster;
    if (this.spotlightElement) this.spotlightElement.hidden = !showSpotlight;
    if (this.summaryGrid) this.summaryGrid.hidden = !showSummary;
    if (this.revealHint) this.revealHint.hidden = !showSpotlight;
    if (this.actionsElement) this.actionsElement.hidden = !showSummary;
    if (!showSummary) this.closeActionsMenu();
    this.revealContainer.hidden = !showSummary;
    this.revealStage = subStage === 'booster' ? 'idle' : subStage;
    this.updateBatchCounter();
    this.log(`Scene sub-stage displayed: ${subStage}.`);
  }

  /**
   * Handles the extension picker change: the quota and the 3D preview follow the new selection.
   *
   * @returns {void}
   */
  handleSetChange() {
    this.selectedSetId = this.setSelect.value || null;
    this.log(`Extension selected: ${this.selectedSetId}.`);
    this.refreshQuota();
    void this.updatePreview();
  }

  /**
   * Moves the selection by one extension (the arrows on each side of the 3D preview).
   *
   * The combo is updated through the same path as a manual selection, so the quota and the preview
   * always agree with it.
   *
   * @param {number} step - `-1` for the previous extension, `1` for the next one.
   * @returns {void}
   */
  cycleSet(step) {
    if (this.setOrder.length < 2) {
      this.log('Extension arrows ignored: a single extension is declared.');
      return;
    }
    const current = this.setOrder.indexOf(this.selectedSetId);
    const index = ((current + step) % this.setOrder.length + this.setOrder.length) % this.setOrder.length;
    this.setSelect.value = this.setOrder[index];
    this.handleSetChange();
  }

  /**
   * Renders the remaining quota for the selected extension and toggles the open button.
   *
   * Shows the countdown to the next reset when nothing is left.
   *
   * @returns {void}
   */
  refreshQuota() {
    if (!this.selectedSetId) {
      this.openButton.disabled = true;
      // Nothing can be looked at, so nothing can be chosen either: the store button has no target.
      this.renderStoreButton(0);
      this.renderBatchButton(null);
      // No visible extension at all (every set is still hidden before its preview window): this is
      // an announcement, not a failure, so the message is informational.
      if (this.setOrder.length === 0) {
        this.setFeedback('opening.error.noSet', 'info');
        this.quotaElement.textContent = '';
        this.setPreviewVisible(false);
        if (this.countdownElement) this.countdownElement.hidden = true;
        if (this.releaseElement) this.releaseElement.hidden = true;
        return;
      }
      this.setPreviewVisible(true);
      this.setFeedback('opening.error.load', 'error');
      return;
    }
    this.setPreviewVisible(true);

    const quota = dateSyncManager.getQuotaSnapshot(this.selectedSetId);
    this.lastQuota = quota;
    this.renderStoreButton(quota.daily);
    this.renderBatchButton(quota);
    const available = quota.availableForSet ?? 0;
    this.log(`Quota refreshed for "${this.selectedSetId}":`, quota);

    // Announced but not released yet: the set is there to be looked at, not spent. The release date
    // replaces the quota, the countdown and the extra-booster purchase, so no action the player can
    // see would fail on a click (the manager refuses the opening a second time anyway).
    if (!this.isSelectedSetReleased()) {
      const set = this.sets.get(this.selectedSetId) ?? null;
      const date = i18n.formatUtcDay(set?.releaseDate ?? null);
      this.quotaElement.textContent = i18n.t('opening.upcoming.quota', {
        set: this.resolveSetName(this.selectedSetId),
        date,
      });
      if (this.countdownElement) this.countdownElement.hidden = true;
      if (this.releaseElement) {
        this.releaseElement.hidden = false;
        this.releaseElement.textContent = i18n.t('opening.upcoming.detail', { date });
      }
      this.openButton.disabled = true;
      this.openButton.textContent = i18n.t('opening.upcoming.open', { date });
      return;
    }
    if (this.releaseElement) this.releaseElement.hidden = true;

    this.quotaElement.textContent = i18n.t('opening.quota', {
      daily: quota.daily,
      set: this.resolveSetName(this.selectedSetId),
      bonus: quota.bonusBySet[this.selectedSetId] ?? 0,
    });
    // Bought boosters now live in the bonus bucket, so the breakdown already shows them. The total
    // adds the daily allowance to that bucket, which is the number the player can actually open.
    this.quotaElement.textContent += i18n.t('opening.quota.sum', {
      count: quota.availableForSet ?? 0,
    });

    if (available > 0) {
      this.openButton.disabled = false;
      this.openButton.textContent = i18n.t('opening.open');
      if (this.countdownElement) this.countdownElement.hidden = true;
    } else {
      this.openButton.disabled = true;
      this.openButton.textContent = i18n.t('opening.error.noBooster');
      this.updateCountdown(dateSyncManager.getFormattedTimeUntilReset());
    }
  }

  /**
   * Handles a quota event coming from `DateSyncManager`.
   *
   * @param {object|null} payload - Quota snapshot (`{ daily, bonusBySet, ... }`).
   * @returns {void}
   */
  handleQuotaUpdated(payload) {
    if (!payload || typeof payload !== 'object') return;
    this.log('Quota updated by DateSyncManager:', payload);
    this.refreshQuota();
  }

  /**
   * Handles a clock tick coming from `DateSyncManager`.
   *
   * @param {{timeUntilReset: string}|null} payload - Tick payload.
   * @returns {void}
   */
  handleClockTick(payload) {
    if (!payload || typeof payload.timeUntilReset !== 'string') return;
    if (this.openButton.disabled && this.selectedSetId && this.isSelectedSetReleased()) {
      this.updateCountdown(payload.timeUntilReset);
    }
  }

  /**
   * Writes the countdown to the next reset.
   *
   * @param {string} value - Formatted duration (`HH:MM:SS`).
   * @returns {void}
   */
  updateCountdown(value) {
    if (!this.countdownElement || !this.countdownValue) return;
    this.countdownElement.hidden = false;
    this.countdownValue.textContent = value;
  }

  /**
   * Shows or hides the 3D preview block of the picker (model and its two arrows).
   *
   * It is hidden when no extension is available at all: an empty viewport would otherwise sit there
   * with its "loading" line forever, promising a model that cannot come.
   *
   * @param {boolean} visible - Whether the block belongs on screen.
   * @returns {void}
   */
  setPreviewVisible(visible) {
    const block = this.previewContainer?.closest('.opening__preview') ?? null;
    if (block) block.hidden = !visible;
    if (!visible && this.previewLoading) this.previewLoading.hidden = true;
  }

  /**
   * Tells whether the selected extension is released, i.e. can be opened right now.
   *
   * The availability itself is computed by `BoosterManager` (trusted UTC day); this view only
   * reads the `released` flag it publishes with every descriptor.
   *
   * @returns {boolean} True when the selected extension may be opened.
   */
  isSelectedSetReleased() {
    const set = this.selectedSetId ? this.sets.get(this.selectedSetId) : null;
    return set ? set.released !== false : false;
  }

  /**
   * Resolves the display name of an extension (the booster `Name`, e.g. "Genesis Blocks").
   *
   * The technical id ("A1") is never shown to the player: only the display name is, in every
   * language (it is a single neutral value). Falls back to the id when the extension is unknown.
   *
   * @param {string|null} setId - Extension id.
   * @returns {string} The display name, or the id.
   */
  resolveSetName(setId) {
    if (!setId) return '';
    return this.sets.get(setId)?.name ?? setId;
  }

  /**
   * Re-translates the quota, the feedback and the summary when the language changes.
   *
   * @returns {void}
   */
  handleLanguageChanged() {
    this.log(`Language changed, re-rendering (${i18n.getLang()}).`);
    this.renderStoreButton(this.lastQuota?.daily ?? 0);
    if (this.feedbackKey) {
      this.setFeedback(this.feedbackKey, this.feedbackTone);
    }
    if (this.pendingResult) {
      if (this.revealStage === 'summary' && this.batchPacks.length > 1) {
        this.renderBatchSummary();
      }
      this.renderSummary(this.pendingResult);
    } else {
      void this.refreshSetOptions().then(() => this.updatePreview());
      this.refreshQuota();
    }
    if (this.revealStage === 'spotlight' && this.cardComponents.length > 0) {
      this.renderSpotlight('none');
    } else if (this.revealStage === 'summary') {
      this.renderSummaryGrid();
      if (this.cardModal && !this.cardModal.hidden) {
        this.closeCardModal();
      }
    }
  }

  /**
   * Displays a translated feedback message under the open button.
   *
   * @param {string|null} key - i18n key, or null to hide the message.
   * @param {'info'|'error'} [tone='info'] - Visual tone.
   * @param {object|null} [params=null] - Interpolation values of the key.
   * @returns {void}
   */
  setFeedback(key, tone = 'info', params = null) {
    this.feedbackKey = key;
    this.feedbackTone = tone;
    if (!key) {
      this.feedbackElement.hidden = true;
      this.feedbackElement.textContent = '';
      return;
    }
    this.feedbackElement.hidden = false;
    this.feedbackElement.textContent = i18n.t(key, params ?? undefined);
    this.feedbackElement.dataset.tone = tone;
    if (tone === 'error') {
      console.warn(`[OpeningView] ${i18n.t(key)}`);
    }
  }

  // __OPENING_BATCH__

  /**
   * Shows or hides the "+" control of the single opening, and reflects what can be opened now.
   *
   * The "+" opens the count dialog (`handleOpenManyClick`) as soon as one booster is available:
   * the dialog bounds each counter to the packs actually in its bucket, so it never promises a
   * count that is not there.
   *
   * @param {object|null} [quota] - Quota snapshot of the selected extension.
   * @returns {void}
   */
  renderBatchButton(quota = this.lastQuota) {
    if (!this.openManyButton) return;
    const released = Boolean(this.selectedSetId) && this.isSelectedSetReleased();
    const daily = quota?.daily ?? 0;
    const bonus = quota?.bonusBySet?.[this.selectedSetId] ?? 0;
    // Only the two buckets the count dialog can spend make the control worth showing: a stock that
    // exists only as purchased boosters has no batch to offer (the single opening still has one).
    const visible = released && daily + bonus > 0;
    this.openManyButton.hidden = !visible;
    this.openManyButton.disabled = !visible || this.isBusy;
  }

  /**
   * Opens the count dialog, bounded by the packs actually available.
   *
   * The daily counter starts at what the allowance holds (capped at ten, the usual batch), the
   * bonus one at zero. Both are clamped on every change, so no count can exceed its bucket.
   *
   * @returns {void}
   */
  handleOpenManyClick() {
    if (this.isBusy || !this.selectedSetId || !this.isSelectedSetReleased()) return;
    const quota = dateSyncManager.getQuotaSnapshot(this.selectedSetId);
    const daily = quota.daily;
    const bonus = quota.bonusBySet[this.selectedSetId] ?? 0;
    if (daily + bonus <= 0) {
      this.setFeedback('opening.error.noBooster', 'error');
      return;
    }
    if (!this.countModal) return;

    this.setFeedback(null);
    this.countLimits = { daily, bonus };
    this.countTitle.textContent = i18n.t('opening.batch.countTitle');
    this.countBody.textContent = i18n.t('opening.batch.countBody', {
      set: this.resolveSetName(this.selectedSetId),
    });
    this.setCountValue('daily', Math.min(daily, 10));
    this.setCountValue('bonus', 0);
    this.countModal.hidden = false;
    this.log(`Batch count dialog opened (daily ${daily}, bonus ${bonus}).`);
  }

  /**
   * Writes one of the two counters, clamped to its bucket.
   *
   * The labels always show the AVAILABLE count (not the selected one): what the player needs to
   * know while deciding is how much is left, and the "all" button writes exactly that value.
   *
   * @param {'daily'|'bonus'} kind - Counter to write.
   * @param {unknown} value - Requested value.
   * @returns {void}
   */
  setCountValue(kind, value) {
    if (kind !== 'daily' && kind !== 'bonus') return;
    const limit = this.countLimits[kind] ?? 0;
    const parsed = Number(value);
    const count = Number.isFinite(parsed) ? Math.min(Math.max(Math.round(parsed), 0), limit) : 0;
    this.countValues = { ...this.countValues, [kind]: count };

    const input = this.countInputs[kind];
    if (input && input.value !== String(count)) input.value = String(count);
    const label = this.countLabels[kind];
    if (label) {
      const baseKey = kind === 'daily' ? 'opening.batch.daily' : 'opening.batch.bonus';
      // A single pack must not read "1 disponibles": the agreement follows the AVAILABLE count,
      // which is the number the label shows (the selected count is in the input next to it).
      label.textContent = i18n.t(limit === 1 ? `${baseKey}One` : baseKey, {
        count: limit,
        set: this.resolveSetName(this.selectedSetId),
      });
      input?.setAttribute('aria-label', label.textContent);
    }
    this.refreshCountConfirm();
  }

  /**
   * Moves one counter by a number of packs.
   *
   * @param {string} kind - `daily` or `bonus`.
   * @param {number} step - `-1` or `1`.
   * @returns {void}
   */
  stepCount(kind, step) {
    if (!Number.isFinite(step)) return;
    this.setCountValue(kind, (this.countValues[kind] ?? 0) + step);
  }

  /**
   * Fills one counter with everything its bucket holds.
   *
   * @param {string} kind - `daily` or `bonus`.
   * @returns {void}
   */
  fillCount(kind) {
    this.setCountValue(kind, this.countLimits[kind] ?? 0);
  }

  /**
   * Refreshes the confirmation label and its state.
   *
   * @returns {void}
   */
  refreshCountConfirm() {
    const total = (this.countValues.daily ?? 0) + (this.countValues.bonus ?? 0);
    if (this.countConfirm) {
      // French treats zero as a singular ("0 booster") while English uses the plural ("0 boosters"),
      // so zero has its own key; the singular starts at one and the plural at the second pack.
      const key = total === 0
        ? 'opening.batch.confirmZero'
        : total === 1
          ? 'opening.batch.confirmOne'
          : 'opening.batch.confirm';
      this.countConfirm.textContent = i18n.t(key, { count: total });
      this.countConfirm.disabled = total <= 0;
    }
  }

  /**
   * Closes the count dialog.
   *
   * @returns {void}
   */
  closeCountModal() {
    if (this.countModal && !this.countModal.hidden) {
      this.countModal.hidden = true;
    }
  }

  /**
   * Starts the batch with the counts picked in the dialog.
   *
   * @returns {void}
   */
  confirmCount() {
    const daily = this.countValues.daily ?? 0;
    const bonus = this.countValues.bonus ?? 0;
    this.closeCountModal();
    void this.openBatch({ daily, bonus });
  }

  /**
   * Opens several packs of the selected extension, then starts their reveal.
   *
   * Every pack goes through `openBooster()`, so the quota, the refund and the statistics rules are
   * exactly the ones of a single opening. The loop stops at the first refusal (a bucket emptied by
   * another tab, a write failure): the packs already persisted are still revealed instead of being
   * thrown away, and the failure is announced afterwards.
   *
   * @param {{daily?: number, bonus?: number}} [counts] - Packs to spend in each bucket.
   * @returns {Promise<void>} Resolves once the reveal started (or the failure is displayed).
   */
  async openBatch({ daily = 0, bonus = 0 } = {}) {
    if (this.isBusy || !this.selectedSetId) return;
    const total = daily + bonus;
    if (total <= 0) {
      this.setFeedback('opening.batch.none', 'error');
      return;
    }
    if (!this.isSelectedSetReleased()) {
      this.setFeedback('opening.error.notReleased', 'info');
      return;
    }

    this.isBusy = true;
    this.openButton.disabled = true;
    this.renderBatchButton();
    this.setFeedback('opening.batch.running', 'info', { total });
    const sources = [
      ...Array.from({ length: daily }, () => BOOSTER_SOURCES.DAILY),
      ...Array.from({ length: bonus }, () => BOOSTER_SOURCES.BONUS),
    ];
    const results = [];
    let failure = null;

    try {
      for (const source of sources) {
        try {
          results.push(await boosterManager.openBooster(this.selectedSetId, { source }));
        } catch (error) {
          failure = error;
          console.error('[OpeningView] A booster of the batch could not be opened.', error);
          break;
        }
      }
    } finally {
      this.isBusy = false;
      this.openButton.disabled = false;
      this.renderBatchButton();
    }

    if (results.length === 0) {
      this.setFeedback(
        failure?.code === 'NO_BOOSTER_AVAILABLE'
          ? 'opening.error.noBooster'
          : 'opening.batch.error',
        'error'
      );
      this.refreshQuota();
      return;
    }
    if (failure) Toast.error('opening.batch.error');

    this.setFeedback(null);
    this.startBatchReveal(results);
    this.refreshQuota();
  }

  // __OPENING_OPEN__

  /**
   * Handles the open button.
   *
   * When the selected extension has BOTH a daily booster and a bonus one, the source dialog is
   * shown first; otherwise the opening starts immediately with the only available bucket.
   *
   * @returns {Promise<void>} Resolves once the opening started (or the dialog is displayed).
   */
  async handleOpenClick() {
    if (this.isBusy || !this.selectedSetId) return;
    if (!this.isSelectedSetReleased()) {
      this.log(`Opening refused: "${this.selectedSetId}" is not released yet.`);
      this.refreshQuota();
      return;
    }
    const quota = dateSyncManager.getQuotaSnapshot(this.selectedSetId);
    const bonus = quota.bonusBySet[this.selectedSetId] ?? 0;
    // Both buckets can pay for this extension: the player chooses which one is spent.
    if (quota.daily > 0 && bonus > 0) {
      this.openSourceModal({ daily: quota.daily, bonus });
      return;
    }
    const source = quota.daily > 0 ? 'daily' : bonus > 0 ? 'bonus' : null;
    await this.performOpen(source);
  }

  /**
   * Shows the source choice dialog (daily booster vs inventory booster).
   *
   * @param {{daily: number, bonus: number}} counts - Available boosters of each bucket.
   * @returns {void}
   */
  openSourceModal({ daily, bonus }) {
    if (!this.sourceModal) return;
    const set = this.resolveSetName(this.selectedSetId);
    this.sourceTitle.textContent = i18n.t('opening.source.title');
    this.sourceBody.textContent = i18n.t('opening.source.body', { set, daily, bonus });
    this.sourceButtons.forEach((button) => {
      const isDaily = button.dataset.openingSourceChoice === 'daily';
      button.textContent = i18n.t(isDaily ? 'opening.source.useDaily' : 'opening.source.useBonus', {
        count: isDaily ? daily : bonus,
      });
    });
    this.sourceModal.hidden = false;
    this.log(`Source choice required for "${this.selectedSetId}" (daily ${daily}, bonus ${bonus}).`);
  }

  /**
   * Handles a choice in the source dialog.
   *
   * @param {string} source - `daily` or `bonus`.
   * @returns {Promise<void>} Resolves once the opening started.
   */
  async handleSourceChoice(source) {
    if (source !== 'daily' && source !== 'bonus') return;
    this.closeSourceModal();
    await this.performOpen(source);
  }

  /**
   * Closes the source choice dialog.
   *
   * @returns {void}
   */
  closeSourceModal() {
    if (this.sourceModal && !this.sourceModal.hidden) {
      this.sourceModal.hidden = true;
    }
  }

  // __OPENING_STORE__

  /**
   * Renders the "store as bonus" button and hides it when there is nothing to store.
   *
   * The button shares its slot with the extra-booster purchase: they answer opposite situations
   * (a leftover allowance to keep, an empty one to buy back), so they never appear together.
   *
   * @param {number} daily - Remaining daily boosters.
   * @returns {void}
   */
  renderStoreButton(daily = 0) {
    if (!this.storeButton) return;
    const visible = daily > 0;
    this.storeButton.hidden = !visible;
    if (!visible) {
      this.closeStoreModal();
      return;
    }
    this.storeButton.textContent = i18n.t('opening.store', { count: daily });
    this.storeButton.setAttribute('aria-label', i18n.t('opening.store.aria', { count: daily }));
    this.storeButton.disabled = this.isStoring;
  }

  /**
   * Requests the storing of one daily booster in the bonus bucket of an extension.
   *
   * The extensions offered are the RELEASED ones, the same list the daily reward uses for a booster
   * (`DailyRewardManager.getBoosterChoices`): a pack parked on a set that cannot be opened yet would
   * be invisible, so the two screens must agree on where a booster may land.
   *
   * @returns {Promise<void>} Resolves once the booster is stored, or once the dialog is displayed.
   */
  async handleStoreClick() {
    if (this.isStoring || this.isBusy) return;
    const daily = this.lastQuota?.daily ?? 0;
    if (daily <= 0) {
      this.setFeedback('opening.store.empty', 'error');
      return;
    }

    let choices = [];
    try {
      choices = (await boosterManager.listBoosterSets()).map((set) => ({
        setId: set.setId,
        name: set.name,
        bonus: this.lastQuota?.bonusBySet?.[set.setId] ?? 0,
      }));
    } catch (error) {
      console.error('[OpeningView] The extensions could not be read for the store dialog.', error);
      this.setFeedback('opening.store.error', 'error');
      return;
    }

    if (choices.length === 0) {
      this.setFeedback('opening.store.noSet', 'error');
      return;
    }
    // A single extension is not a choice: the booster goes there without a question.
    if (choices.length === 1) {
      await this.storeDailyBooster(choices[0]);
      return;
    }

    this.storeChoices = choices;
    this.renderStoreModal(daily);
  }

  /**
   * Displays the extension picker of the store dialog.
   *
   * @param {number} daily - Remaining daily boosters, written in the introduction.
   * @returns {void}
   */
  renderStoreModal(daily) {
    if (!this.storeModal || !this.storeTitle || !this.storeBody || !this.storeSets) return;
    this.storeTitle.textContent = i18n.t('opening.store.title');
    this.storeBody.textContent = i18n.t('opening.store.body', { count: daily });
    this.storeSets.replaceChildren();
    (this.storeChoices ?? []).forEach((choice) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn--ghost';
      button.dataset.openingStoreSet = choice.setId;
      button.textContent = i18n.t('opening.store.set', { set: choice.name, count: choice.bonus });
      this.storeSets.append(button);
    });
    this.storeModal.hidden = false;
    this.log(`Store dialog displayed (${daily} daily booster(s), ${this.storeChoices?.length ?? 0} extension(s)).`);
  }

  /**
   * Handles a choice of the store dialog.
   *
   * @param {MouseEvent} event - Click event of the dialog buttons.
   * @returns {void}
   */
  handleStoreChoice(event) {
    const button = event.target instanceof Element
      ? event.target.closest('[data-opening-store-set]')
      : null;
    if (!button || this.isStoring) return;
    const choice = this.storeChoices?.find((entry) => entry.setId === button.dataset.openingStoreSet);
    if (!choice) return;
    soundManager.playUi(UI_SOUNDS.SECTION_SWITCH);
    void this.storeDailyBooster(choice);
  }

  /**
   * Moves one daily booster into the bonus bucket of an extension.
   *
   * One booster per gesture: the player keeps the choice of where the next one goes, and a single
   * tap can never empty the allowance into the wrong extension.
   *
   * @param {{setId: string, name: string}} choice - Extension that receives the booster.
   * @returns {Promise<void>} Resolves once the write finished (success or failure).
   */
  async storeDailyBooster({ setId, name }) {
    if (this.isStoring) return;
    this.isStoring = true;
    this.setFeedback(null);
    this.log(`Storing a daily booster as a bonus for "${setId}"…`);

    try {
      const { stored, quota } = await dateSyncManager.storeDailyBooster(setId);
      if (!stored) {
        // Two tabs, or a reset that happened between the click and the write: the allowance is
        // already gone, and the button follows the quota on its way out.
        this.setFeedback('opening.store.empty', 'error');
        return;
      }
      const total = quota.bonusBySet[setId] ?? 0;
      Toast.success('opening.store.done', { params: { set: name, total } });
      this.closeStoreModal();
      // The board is offered only after a booster was opened, so a player who stores their
      // allowance instead would never see it. Taking care of the day's boosters is the moment.
      void dailyRewardPopup.openIfDue();
    } catch (error) {
      console.error('[OpeningView] The daily booster could not be stored.', error);
      this.setFeedback('opening.store.error', 'error');
    } finally {
      this.isStoring = false;
      this.refreshQuota();
    }
  }

  /**
   * Closes the store dialog.
   *
   * @returns {void}
   */
  closeStoreModal() {
    if (this.storeModal && !this.storeModal.hidden) {
      this.storeModal.hidden = true;
    }
  }

  /**
   * Draws AND persists the pack, then starts the scene.
   *
   * @param {'daily'|'bonus'|null} [source=null] - Booster bucket to spend (null lets the manager
   *   pick: daily quota first, then the extension bonus).
   * @returns {Promise<void>} Resolves once the scene is displayed.
   */
  async performOpen(source = null) {
    if (this.isBusy || !this.selectedSetId) return;
    this.isBusy = true;
    this.openButton.disabled = true;
    const previousLabel = this.openButton.textContent;
    this.openButton.textContent = i18n.t('opening.opening');
    this.setFeedback(null);
    this.log(
      `Opening a "${this.selectedSetId}" booster (source: ${source ?? 'auto'}; draw persisted before the animation)…`
    );

    try {
      const result = await boosterManager.openBooster(
        this.selectedSetId,
        source ? { source } : {}
      );
      this.log(`Pack persisted: ${result.cards.length} cards, source "${result.source}".`, {
        newKeys: result.newKeys,
      });
      this.pendingResult = result;
      // The five illustrations are fetched NOW, while the booster is still on screen and the player
      // has to tear it open: the first card of the reveal then has nothing left to wait for.
      this.warmupCardImages(result.cards);
      if (typeof this.onBoosterOpened === 'function') {
        this.onBoosterOpened(result);
      }
      this.showStage('scene');
      this.showSceneSubStage('booster');
      // The picker preview is not thrown away: `prepareScene` moves its scene into the opening
      // viewport whenever it can, so the model already in GPU memory is simply adopted.
      await this.prepareScene(result);
      this.buildReveal(result);
    } catch (error) {
      if (error?.code === 'NO_BOOSTER_AVAILABLE') {
        console.warn(`[OpeningView] No booster left for "${this.selectedSetId}".`);
        this.setFeedback('opening.error.noBooster', 'error');
      } else if (error?.code === 'SET_NOT_RELEASED') {
        // Only reachable at a release boundary (the list was read before midnight): the screen is
        // simply redrawn as an announcement instead of showing an opening error.
        console.warn(`[OpeningView] "${this.selectedSetId}" is not released yet.`);
        this.setFeedback('opening.error.notReleased', 'info');
        await this.loadSets();
      } else {
        console.error('[OpeningView] The booster could not be opened.', error);
        this.setFeedback('opening.error.open', 'error');
      }
      // A failed opening must never leave the player on a scene with no way out: the app chrome
      // comes back, whatever the stage the failure happened in.
      setFocusMode(false);
      this.refreshQuota();
    } finally {
      this.openButton.textContent = previousLabel;
      this.isBusy = false;
      this.log('Open handler released.');
    }
  }

  /**
   * Prepares the 3D booster (or the 2D fallback image).
   *
   * @param {{setId: string}} result - Persisted pack, used for the extension texture.
   * @returns {Promise<void>} Resolves once the scene or the fallback is visible.
   */
  async prepareScene(result) {
    this.isFallbackMode = false;
    this.boosterContainer.classList.remove('is-dismissed');
    this.boosterLoading.hidden = false;
    this.boosterHint.hidden = true;
    this.boosterFallback.hidden = true;
    this.boosterViewport.textContent = '';
    this.log(`Preparing the 3D scene for "${result.setId}"…`);

    let set = null;
    try {
      set = await boosterManager.getBoosterSet(result.setId);
    } catch (error) {
      console.warn(`[OpeningView] Extension "${result.setId}" could not be reloaded.`, error);
    }

    this.disposeRenderer();
    const texture = set?.texture ?? null;
    const preview = await this.takePreviewRenderer();
    if (preview) {
      try {
        if (preview.texturePath !== texture) {
          await preview.setTexture(texture);
        }
        const adopted = preview.adopt({
          container: this.boosterViewport,
          onOpenStart: () => this.handleBoosterOpenStart(),
          onOpenRequest: () => this.handleBoosterOpenGesture(),
        });
        if (adopted) {
          this.renderer3d = preview;
          this.boosterLoading.hidden = true;
          this.log('The picker scene was adopted by the opening: no second download.');
          this.renderer3d.start();
          this.boosterHint.hidden = false;
          this.scheduleIdleDispose();
          return;
        }
      } catch (error) {
        console.warn('[OpeningView] The picker scene could not be adopted.', error);
      }
      preview.dispose();
    }

    this.renderer3d = new Booster3DRenderer({
      container: this.boosterViewport,
      texturePath: texture,
      renderSettings: boosterRenderManager.getRenderSettings(),
      label: result.setId,
      onOpenStart: () => this.handleBoosterOpenStart(),
      onOpenRequest: () => this.handleBoosterOpenGesture(),
      // A scene that dies AFTER its `init()` (a lost WebGL context, a canvas that stays blank)
      // cannot be caught by the `await` below: it hands the stage back to the 2D booster here.
      onUnavailable: (failure) => this.handleBoosterRendererFailure(failure, set),
    });

    const ready = await this.renderer3d.init();
    this.boosterLoading.hidden = true;

    if (ready) {
      this.log('3D scene ready, waiting for the open gesture.');
      this.renderer3d.start();
      this.boosterHint.hidden = false;
      this.scheduleIdleDispose();
    } else {
      console.warn('[OpeningView] 3D unavailable, showing the 2D fallback.');
      this.reportBoosterFailure(this.renderer3d?.describeFailure() ?? null);
      this.showBoosterFallback(set);
    }
  }

  /**
   * Builds the non-interactive 3D preview of the "select" stage, on first need.
   *
   * The preview is a SECOND scene: it only turns on its own, it never tears open, and it is released
   * as soon as the real booster appears (two WebGL loops at once would be a waste of battery).
   *
   * @returns {Promise<void>} Resolves once the preview is turning (or the 2D fallback is displayed).
   */
  async initPreview() {
    if (this.previewRenderer) return;
    if (this.previewInitPromise) return this.previewInitPromise;
    if (this.previewFailed || !this.selectedSetId || !this.previewViewport) {
      if (!this.selectedSetId && this.previewLoading) this.previewLoading.hidden = true;
      return;
    }

    const setId = this.selectedSetId;
    const set = this.sets.get(setId) ?? null;
    this.previewLoading.hidden = false;
    this.previewFallback.hidden = true;
    this.previewViewport.textContent = '';
    this.log(`Preparing the booster preview for "${setId}"…`);

    const renderer = new Booster3DRenderer({
      container: this.previewViewport,
      texturePath: set?.texture ?? null,
      interactive: false,
      renderSettings: boosterRenderManager.getRenderSettings(),
      label: `preview:${setId}`,
    });
    this.previewInitPromise = (async () => {
      const ready = await renderer.init();
      this.previewLoading.hidden = true;

      if (!ready) {
        console.warn('[OpeningView] The 3D preview is unavailable, showing the 2D image.');
        this.reportBoosterFailure(renderer.describeFailure());
        renderer.dispose();
        this.previewFailed = true;
        this.showPreviewFallback(set);
        return;
      }

      this.previewRenderer = renderer;
      renderer.start();
      this.log('Booster preview ready.');
    })();

    try {
      await this.previewInitPromise;
    } finally {
      this.previewInitPromise = null;
    }
  }

  /**
   * Hands the preview scene over to the opening stage.
   *
   * Waits for a construction that is still in flight (a player can press "Open" while the picker
   * preview is loading), then clears the reference so `disposePreview()` never releases a scene
   * that has become the opening one.
   *
   * @returns {Promise<Booster3DRenderer|null>} The adopted scene, or null when there is none.
   */
  async takePreviewRenderer() {
    if (this.previewInitPromise) {
      try {
        await this.previewInitPromise;
      } catch (error) {
        console.warn('[OpeningView] The preview scene failed while the opening started.', error);
      }
    }
    const renderer = this.previewRenderer;
    this.previewRenderer = null;
    return renderer;
  }

  /**
   * Shows the booster of the selected extension in the preview.
   *
   * @returns {Promise<void>} Resolves once the preview shows the selection.
   */
  async updatePreview() {
    if (this.previewFailed || !this.selectedSetId) return;
    if (!this.previewRenderer) {
      await this.initPreview();
      return;
    }
    const set = this.sets.get(this.selectedSetId) ?? null;
    await this.previewRenderer.setTexture(set?.texture ?? null);
  }

  /**
   * Shows the 2D image of an extension when the 3D preview cannot be displayed at all.
   *
   * @param {{texture: string|null, name: string}|null} set - Loaded extension, if any.
   * @returns {void}
   */
  showPreviewFallback(set) {
    if (set?.texture) {
      this.previewFallback.src = i18n.resolveImagePath(set.texture);
      this.previewFallback.alt = set.name ?? '';
      this.previewFallback.hidden = false;
    }
    this.log('2D booster preview displayed.');
  }

  /**
   * Stops the preview render loop (the WebGL context stays ready for the next activation).
   *
   * @returns {void}
   */
  stopPreview() {
    this.previewRenderer?.stop();
  }

  /**
   * Releases the WebGL resources of the preview.
   *
   * @returns {void}
   */
  disposePreview() {
    if (this.previewRenderer) {
      this.previewRenderer.dispose();
      this.previewRenderer = null;
    }
  }

  // __OPENING_REVEAL__

  /**
   * Shows the 2D fallback (booster texture, tap to open).
   *
   * @param {{texture: string|null, name: string}|null} set - Loaded extension, if any.
   * @returns {void}
   */
  showBoosterFallback(set) {
    this.isFallbackMode = true;
    this.setFeedback('opening.scene.fallback', 'info');
    if (set?.texture) {
      this.boosterFallback.src = i18n.resolveImagePath(set.texture);
      this.boosterFallback.alt = set.name ?? '';
      this.boosterFallback.hidden = false;
    }
    this.boosterHint.hidden = false;
    this.boosterHint.textContent = i18n.t('opening.scene.fallback');
  }

  /**
   * Called when the player taps (or swipes up) the booster in the 2D fallback mode.
   * Delegates to the shared gesture handler.
   *
   * @param {Event} event - Click or touch event on the fallback image.
   * @returns {void}
   */
  handleFallbackClick(event) {
    event?.preventDefault?.();
    if (!this.isFallbackMode) return;
    // The 2D image has no WebGL tear to start, but it must still fire the burst of the parodic
    // mode at the same moment the 3D scene would.
    this.handleBoosterOpenStart();
    this.handleBoosterOpenGesture();
  }

  /**
   * Called as the tear starts, i.e. at the exact moment the booster is hit.
   *
   * The "explosive" mode is the deliberate joke one: the stage takes the blast (a shake) and a
   * comic "BOUM !" is fired over the booster. Both are replayed on every opening, and both are
   * silent in the other modes - the burst is never even in the accessibility tree (`aria-hidden`).
   *
   * @returns {void}
   */
  handleBoosterOpenStart() {
    if (!animationManager.isParodicMode()) return;

    const timing = animationManager.getTiming();
    this.log(`Parodic mode "${animationManager.getMode()}": shake, boom and confetti, off we go.`);
    this.clearBurst();

    if (this.sceneStage) {
      this.sceneStage.classList.remove('is-booming');
      // Reading a layout property between the two writes restarts the CSS animation.
      void this.sceneStage.offsetWidth;
      this.sceneStage.classList.add('is-booming');
    }

    if (this.burstElement) {
      this.burstElement.hidden = false;
      this.burstElement.classList.remove('is-visible');
      void this.burstElement.offsetWidth;
      this.burstElement.classList.add('is-visible');
    }
    this.spawnConfetti();

    this.burstTimer = window.setTimeout(() => this.clearBurst(), timing.tearMs + 1400);
  }

  /**
   * Throws a handful of confetti over the burst.
   *
   * Every piece is a span whose direction, spin and delay ride in custom properties (see
   * `.opening__burst-confetti` in `css/animations/`), so the markup stays dumb and the CSS
   * stays the only thing that knows how a confetti moves. `Math.random()` is fine here: this is
   * decoration, nothing about it may ever be reproducible.
   *
   * @returns {void}
   */
  spawnConfetti() {
    if (!this.burstElement) return;
    this.clearConfetti();

    const fragment = document.createDocumentFragment();
    for (let index = 0; index < CONFETTI_COUNT; index += 1) {
      const piece = document.createElement('span');
      piece.className = 'opening__burst-confetti';
      piece.style.setProperty('--confetti-color', CONFETTI_COLORS[index % CONFETTI_COLORS.length]);
      // Mostly outward, a bit upward: a puff, not a fountain.
      piece.style.setProperty('--confetti-x', `${Math.round((Math.random() - 0.5) * 260)}px`);
      piece.style.setProperty('--confetti-y', `${Math.round(-40 - Math.random() * 170)}px`);
      piece.style.setProperty('--confetti-spin', `${Math.round(240 + Math.random() * 720)}deg`);
      piece.style.setProperty('--confetti-delay', `${Math.round(Math.random() * 160)}ms`);
      piece.style.setProperty('--confetti-flight', `${Math.round(1000 + Math.random() * 500)}ms`);
      fragment.appendChild(piece);
    }
    this.burstElement.appendChild(fragment);
  }

  /**
   * Drops the confetti of the previous blast.
   *
   * @returns {void}
   */
  clearConfetti() {
    if (!this.burstElement) return;
    this.burstElement.querySelectorAll('.opening__burst-confetti').forEach((piece) => piece.remove());
  }

  /**
   * Removes the comic burst and the shake of the stage.
   *
   * The confetti goes with it: the pieces are one-shot, and a leftover would fly again the next
   * time `is-visible` comes back.
   *
   * @returns {void}
   */
  clearBurst() {
    if (this.burstTimer !== null) {
      window.clearTimeout(this.burstTimer);
      this.burstTimer = null;
    }
    this.burstElement?.classList.remove('is-visible');
    if (this.burstElement) {
      this.burstElement.hidden = true;
    }
    this.clearConfetti();
    this.sceneStage?.classList.remove('is-booming');
  }

  /**
   * Called when the player taps or swipes the 3D booster. The pack is already persisted, so
   * only the reveal is triggered here. Hides the booster (3D or 2D) and starts the one-by-one
   * spotlight reveal.
   *
   * @returns {void}
   */
  handleBoosterOpenGesture() {
    if (!this.pendingResult) {
      console.warn('[OpeningView] Open gesture ignored: no pack is waiting for its reveal.');
      return;
    }
    this.log('Open gesture detected: hiding the booster, starting the spotlight reveal.');
    // The tear-open effect fires on the click/swipe of the model, before the booster disappears.
    soundManager.play(SOUNDS.BOOSTER_OPENING);
    this.boosterHint.hidden = true;
    this.cancelIdleDispose();
    this.disposeRenderer();
    this.isFallbackMode = false;
    this.startSpotlightReveal();
  }

  /**
   * Builds the 5 card components (all face down) once the pack is persisted. Nothing is shown
   * yet: the open gesture swaps the booster for the first spotlight card.
   *
   * @param {{cards: Array, newKeys: string[]}} result - Persisted pack.
   * @returns {void}
   */
  buildReveal(result) {
    this.clearReveal();

    const newKeys = new Set(result.newKeys ?? []);
    result.cards.forEach((card) => {
      const component = new CardComponent(card, {
        isNew: newKeys.has(card.uniqueKey),
        flipOnClick: false,
      });
      this.cardComponents.push(component);
    });
    this.log(`Reveal prepared (hidden): ${this.cardComponents.length} face-down cards.`);
  }

  /**
   * Starts the spotlight reveal at the first card.
   *
   * @returns {void}
   */
  startSpotlightReveal() {
    if (this.cardComponents.length === 0) {
      console.warn('[OpeningView] Spotlight reveal ignored: no card is waiting.');
      return;
    }
    this.spotlightIndex = 0;
    this.showSceneSubStage('spotlight');
    this.renderSpotlight('enter-next');
    this.log('Spotlight reveal started: first card face down.');
  }

  /**
   * Displays the spotlighted card (big, single) with the counter and the navigation buttons.
   *
   * @param {'enter-next'|'enter-prev'|'none'} [animation='none'] - Slide-in direction.
   * @returns {void}
   */
  renderSpotlight(animation = 'none') {
    const component = this.cardComponents[this.spotlightIndex];
    if (!component || !this.spotlightStage) return;

    this.spotlightStage.textContent = '';
    const element = component.render();
    if (animation !== 'none') {
      element.classList.remove('is-entering-next', 'is-entering-prev');
      void element.offsetWidth;
      element.classList.add(animation === 'enter-prev' ? 'is-entering-prev' : 'is-entering-next');
    }
    this.spotlightStage.appendChild(element);
    this.armSpotlightEntryGuard(animation === 'none' ? null : element);

    if (this.counterElement) {
      this.counterElement.textContent = i18n.t('opening.reveal.counter', {
        current: this.spotlightIndex + 1,
        total: this.cardComponents.length,
      });
    }
    if (this.revealHint) {
      this.revealHint.textContent = i18n.t(
        component.isFlipped ? 'opening.reveal.hintNext' : 'opening.reveal.hintFlip',
      );
    }
    this.refreshSpotlightButtons();
    this.syncSpotlightImage();
  }

  /**
   * Starts the download of the illustrations of a freshly drawn pack.
   *
   * The pictures live on a remote CDN: asking for them the moment the pack is drawn overlaps the
   * download with the tear of the booster, which is the time the player spends looking at the model
   * anyway. Nothing is awaited here: the reveal stays driven by the player, and `syncSpotlightImage`
   * is what covers the rare case where a picture is still on its way.
   *
   * @param {Array<{illustration: string}>} cards - Cards of the pack.
   * @returns {void}
   */
  warmupCardImages(cards) {
    const urls = (Array.isArray(cards) ? cards : []).map((card) =>
      i18n.resolveImagePath(card?.illustration)
    );
    this.log(`Preloading ${urls.length} illustration(s) of the pack…`);
    void preloadImages(urls).then((outcome) => {
      if (outcome.failed.length > 0) {
        console.warn(
          `[OpeningView] ${outcome.failed.length} illustration(s) could not be preloaded.`,
          outcome.failed
        );
        return;
      }
      this.log(`${outcome.ready} illustration(s) ready.`);
    });
  }

  /**
   * Shows the mini loader while the artwork of the spotlight card is not decoded yet.
   *
   * On a normal connection the five pictures were warmed up before the booster was torn open and this
   * never appears; on a slow one it is the difference between a card that flips on a blank face and a
   * card that says it is coming. The token makes a fast "next, next, next" harmless: only the card
   * displayed when the download ends may hide the loader.
   *
   * @returns {void}
   */
  syncSpotlightImage() {
    const loader = this.spotlightLoading;
    if (!loader) return;

    const token = this.spotlightLoadToken + 1;
    this.spotlightLoadToken = token;
    const card = this.cardComponents[this.spotlightIndex]?.card ?? null;
    if (!card) {
      loader.hidden = true;
      return;
    }

    const url = i18n.resolveImagePath(card.illustration);
    if (isImageReady(url)) {
      loader.hidden = true;
      return;
    }

    loader.hidden = false;
    void preloadImage(url, { timeout: SPOTLIGHT_IMAGE_TIMEOUT_MS }).then((ready) => {
      if (token !== this.spotlightLoadToken) return;
      loader.hidden = true;
      if (!ready) {
        console.warn(`[OpeningView] Illustration "${url}" is still unavailable.`);
      }
    });
  }

  /**
   * Reacts to a 3D scene that stopped working AFTER it started (a lost context, a blank canvas).
   *
   * @param {object|null} failure - Description returned by `Booster3DRenderer.describeFailure()`.
   * @param {object|null} set - Extension whose booster was on screen.
   * @returns {void}
   */
  handleBoosterRendererFailure(failure, set) {
    this.log(`The 3D scene stopped working (${failure?.reason ?? 'unknown'}).`);
    this.reportBoosterFailure(failure);
    if (!set) return;
    this.showBoosterFallback(set);
  }

  /**
   * Sends a 3D failure to the error dialog, once per session.
   *
   * The message is deliberately the same whatever the cause: the reason travels in the context, and
   * one fixed message is what lets two failures of the same scene collapse into a single dialog (the
   * reporter deduplicates on source and message).
   *
   * @param {object|null} failure - Description of the failure, when there is one.
   * @returns {void}
   */
  reportBoosterFailure(failure) {
    reportError(new Error('The 3D booster could not be rendered.'), {
      source: 'booster-3d',
      titleKey: 'error.popup.title3d',
      bodyKey: 'error.popup.body3d',
      context: failure ?? null,
    });
  }

  /**
   * Blocks the reveal while the arrival animation of the spotlight card is still running.
   *
   * A tap landing during the slide-in would REPLACE that animation: the flip of a card wins over
   * the entry one (see `css/animations/`), so the card would appear already face up, as if the
   * arrival had been skipped. The guard duration is read from the element itself
   * (`animation-duration` of the active mode), never duplicated here, and the tap is remembered:
   * it is replayed as soon as the card is in place, so the player never has to tap twice.
   *
   * @param {HTMLElement|null} element - Spotlight card just inserted, or null to clear the guard.
   * @returns {void}
   */
  armSpotlightEntryGuard(element = null) {
    this.clearSpotlightEntryGuard();
    if (!element) return;

    let durationMs = 0;
    try {
      durationMs = getComputedStyle(element)
        .animationDuration.split(',')
        .reduce((longest, value) => Math.max(longest, parseFloat(value) || 0), 0) * 1000;
    } catch (error) {
      console.warn('[OpeningView] The duration of the arrival animation could not be read.', error);
    }
    if (durationMs <= 0) return;

    this.spotlightEntryTimer = window.setTimeout(() => {
      this.spotlightEntryTimer = null;
      this.flushPendingSpotlightAction();
    }, durationMs + 20);
  }

  /**
   * Drops the arrival guard without replaying the remembered tap.
   *
   * @returns {void}
   */
  clearSpotlightEntryGuard() {
    if (this.spotlightEntryTimer !== null) {
      window.clearTimeout(this.spotlightEntryTimer);
      this.spotlightEntryTimer = null;
    }
    this.pendingSpotlightAction = false;
  }

  /**
   * Tells whether the spotlight card is still moving into place.
   *
   * @returns {boolean} True while the arrival animation runs.
   */
  isSpotlightArriving() {
    return this.spotlightEntryTimer !== null;
  }

  /**
   * Replays the tap that landed while the card was arriving.
   *
   * @returns {void}
   */
  flushPendingSpotlightAction() {
    if (!this.pendingSpotlightAction) return;
    this.pendingSpotlightAction = false;
    this.log('Replaying the tap that landed during the arrival animation.');
    this.handleNextAction();
  }

  /**
   * Refreshes the spotlight navigation buttons for the current card.
   *
   * The primary action is contextual: "Next" while cards remain, "See the summary" on the
   * last revealed card.
   *
   * @returns {void}
   */
  refreshSpotlightButtons() {
    const component = this.cardComponents[this.spotlightIndex];
    const isLast = this.spotlightIndex >= this.cardComponents.length - 1;
    if (this.prevButton) {
      this.prevButton.disabled = this.spotlightIndex <= 0;
    }
    if (this.nextButton) {
      if (isLast && component?.isFlipped) {
        this.nextButton.textContent = i18n.t('opening.reveal.showSummary');
      } else {
        this.nextButton.textContent = i18n.t('opening.reveal.next');
      }
    }
  }

  /**
   * Handles a tap on the spotlight card: reveals it the first time, then moves forward.
   *
   * @returns {void}
   */
  handleSpotlightTap() {
    if (this.suppressNextSpotlightClick) {
      this.suppressNextSpotlightClick = false;
      this.log('Spotlight tap ignored after a swipe (ghost click suppressed).');
      return;
    }
    this.handleNextAction();
  }

  /**
   * Handles the primary spotlight action: reveals first, then advances (or opens the summary
   * on the last revealed card).
   *
   * @returns {void}
   */
  handleNextAction() {
    const component = this.cardComponents[this.spotlightIndex];
    if (!component || this.revealStage !== 'spotlight') return;
    if (this.isSpotlightArriving()) {
      // The card is still sliding in: acting now would cut its arrival short (the flip animation
      // replaces the entry one). The gesture is remembered and replayed once it is in place.
      this.pendingSpotlightAction = true;
      this.log('Tap deferred: the spotlight card is still arriving.');
      return;
    }
    if (!component.isFlipped) {
      this.log(`Spotlight card ${this.spotlightIndex + 1} tapped: revealing.`);
      if (component.flip()) {
        // Mirrors what the player hears in the game: the flip, then the legendary/mythic sting.
        soundManager.playCardReveal(component.card.rarity);
        this.announceRevealedCard(component);
      }
      if (this.revealHint) {
        this.revealHint.textContent = i18n.t('opening.reveal.hintNext');
      }
      this.refreshSpotlightButtons();
      return;
    }
    const isLast = this.spotlightIndex >= this.cardComponents.length - 1;
    if (isLast) {
      this.log(`Spotlight card ${this.spotlightIndex + 1} tapped while revealed: next pack.`);
      this.advanceBatchOrSummarize();
      return;
    }
    this.log(`Spotlight card ${this.spotlightIndex + 1} tapped while revealed: next card.`);
    this.showNextCard({ reveal: false });
  }

  /**
   * Announces the card the player just turned face up.
   *
   * The announcement is an EVENT (never a direct call): the collections the card belongs to are
   * announced by `js/UI/components/GameNotifier.js`, which knows the trophies and the collection —
   * the opening view only knows the pack it is revealing.
   *
   * @param {import('../components/CardComponent.js').CardComponent} component - Revealed card.
   * @returns {void}
   */
  announceRevealedCard(component) {
    eventBus.emit(EVENTS.CARD_REVEALED, {
      setId: this.pendingResult?.setId ?? component.card.set,
      card: component.card,
      index: this.spotlightIndex,
      revealed: this.cardComponents.filter((candidate) => candidate.isFlipped).length,
      total: this.cardComponents.length,
    });
  }

  /**
   * Announces the end of the reveal (the summary is displayed, or the scene is left early).
   *
   * A collection is announced at most once per opening: the notifications prepared for cards that
   * were never turned face up are sent now, so closing the reveal with Escape can not silently
   * swallow the progress of the pack.
   *
   * @returns {void}
   */
  announceRevealFinished() {
    eventBus.emit(EVENTS.REVEAL_FINISHED, {
      setId: this.pendingResult?.setId ?? this.selectedSetId ?? null,
    });
  }

  /**
   * Moves the spotlight to the next card, keeping it face down (no flip).
   *
   * @param {object} [options] - Navigation options.
   * @param {boolean} [options.reveal=false] - Kept for readability at call sites.
   * @returns {void}
   */
  showNextCard({ reveal = false } = {}) {
    void reveal;
    if (this.revealStage !== 'spotlight') return;
    if (this.spotlightIndex >= this.cardComponents.length - 1) return;
    // An explicit navigation cancels both the guard and the tap it was holding: the next card
    // re-arms its own.
    this.clearSpotlightEntryGuard();
    this.spotlightIndex += 1;
    this.renderSpotlight('enter-next');
    soundManager.playUi(UI_SOUNDS.REVEAL_STEP);
    this.log(`Spotlight moved to card ${this.spotlightIndex + 1} (face down).`);
  }

  /**
   * Moves the spotlight back to the previous card (keeps its revealed state).
   *
   * @returns {void}
   */
  showPreviousCard() {
    if (this.revealStage !== 'spotlight') return;
    if (this.spotlightIndex <= 0) return;
    this.clearSpotlightEntryGuard();
    this.spotlightIndex -= 1;
    this.renderSpotlight('enter-prev');
    soundManager.playUi(UI_SOUNDS.REVEAL_STEP);
    this.log(`Spotlight moved back to card ${this.spotlightIndex + 1}.`);
  }

  /**
   * Records the touch start point for swipe detection on the spotlight stage.
   *
   * @param {TouchEvent} event - Touch start event.
   * @returns {void}
   */
  handleSpotlightTouchStart(event) {
    const touch = event?.changedTouches?.[0];
    if (!touch) return;
    this.touchStart = { x: touch.clientX, y: touch.clientY };
  }

  /**
   * Interprets the touch end on the spotlight stage: horizontal swipe navigates, tap reveals
   * then advances. A vertical swipe is ignored.
   *
   * @param {TouchEvent} event - Touch end event.
   * @returns {void}
   */
  handleSpotlightTouchEnd(event) {
    if (!this.touchStart) return;
    const touch = event?.changedTouches?.[0];
    const start = this.touchStart;
    this.touchStart = null;
    if (!touch) return;

    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (Math.abs(deltaX) < SWIPE_THRESHOLD_PX || Math.abs(deltaX) < Math.abs(deltaY)) {
      return;
    }
    if (event?.cancelable) {
      event.preventDefault();
    }
    this.suppressNextSpotlightClick = true;
    if (deltaX < 0) {
      this.handleNextAction();
    } else {
      this.showPreviousCard();
    }
    this.log(`Spotlight swipe detected (deltaX: ${Math.round(deltaX)}px).`);
  }

  /**
   * Moves to the next pack of a batch, or shows the summary on the last one.
   *
   * A single opening has one pack, so this is simply "show the summary": the batch header stays
   * hidden and nothing else changes.
   *
   * @returns {void}
   */
  advanceBatchOrSummarize() {
    if (this.batchPacks.length > 1 && this.batchIndex < this.batchPacks.length - 1) {
      this.batchIndex += 1;
      this.cardComponents = this.batchPacks[this.batchIndex].components;
      this.pendingResult = this.batchPacks[this.batchIndex].result;
      this.spotlightIndex = 0;
      this.updateBatchCounter();
      this.renderSpotlight('enter-next');
      soundManager.play(SOUNDS.BOOSTER_OPENING);
      this.log(`Batch: pack ${this.batchIndex + 1} of ${this.batchPacks.length}.`);
      return;
    }
    this.showSummaryStage();
  }

  /**
   * Writes the "opening booster n / X" line of a batch reveal.
   *
   * Hidden for a single opening: the card counter below it already says everything there is to say.
   *
   * @returns {void}
   */
  updateBatchCounter() {
    if (!this.batchCounterElement) return;
    const total = this.batchPacks.length;
    const visible = total > 1 && this.revealStage === 'spotlight';
    this.batchCounterElement.hidden = !visible;
    if (visible) {
      this.batchCounterElement.textContent = i18n.t('opening.batch.counter', {
        current: this.batchIndex + 1,
        total,
      });
    }
  }

  /**
   * Builds and displays the reveal of a batch, pack by pack.
   *
   * The 3D booster is skipped on purpose: tearing ten packs open one after another would turn a
   * single gesture into ten rituals. The cards of the first pack go face down on the spotlight
   * straight away, and the header names the pack being revealed.
   *
   * @param {object[]} results - Persisted packs, in the order they were opened.
   * @returns {void}
   */
  startBatchReveal(results) {
    this.clearReveal();
    this.batchPacks = results.map((result) => {
      const newKeys = new Set(result.newKeys ?? []);
      return {
        result,
        components: result.cards.map(
          (card) =>
            new CardComponent(card, {
              isNew: newKeys.has(card.uniqueKey),
              flipOnClick: false,
            })
        ),
      };
    });
    this.batchIndex = 0;
    this.cardComponents = this.batchPacks[0].components;
    this.pendingResult = this.batchPacks[0].result;
    this.warmupCardImages(this.batchPacks.flatMap((pack) => pack.result.cards));
    this.batchPacks.forEach((pack) => {
      if (typeof this.onBoosterOpened === 'function') this.onBoosterOpened(pack.result);
    });
    this.showStage('scene');
    this.showSceneSubStage('spotlight');
    soundManager.play(SOUNDS.BOOSTER_OPENING);
    this.renderSpotlight('enter-next');
    this.log(`Batch reveal started: ${this.batchPacks.length} pack(s).`);
  }

  /**
   * Shows the summary grid with the 5 cards and the summary line.
   *
   * @returns {void}
   */
  showSummaryStage() {
    this.stopSpaceAutoAdvance();
    if (!this.pendingResult) {
      console.warn('[OpeningView] Summary ignored: no pack is waiting.');
      return;
    }
    // A replay announces nothing: no pack was opened, so nothing that listens to the end of a
    // reveal (rewards, follow-ups) must believe one just happened.
    if (!this.isReplay) this.announceRevealFinished();
    this.closeCardModal();
    if (this.batchPacks.length > 1) {
      this.renderBatchSummary();
    } else {
      this.renderSummaryGrid();
    }
    this.renderSummary(this.pendingResult);
    // A batch has no single pack to share (the code of one of the ten packs would be misleading),
    // and a replay never wrote anything: neither can produce a share code, nor open the share page
    // of a pack.
    const canShare = this.batchPacks.length <= 1 && !this.isReplay;
    if (this.copyCodeButton) this.copyCodeButton.hidden = !canShare;
    if (this.shareButton) this.shareButton.hidden = !canShare;
    void this.refreshSaveButton();
    this.updateActionsToggle();
    this.showSceneSubStage('summary');
    this.log('Summary displayed: 5 cards, tap one for its detail.');
  }

  /**
   * Builds the summary grid: one thumbnail per card, opening the detail modal.
   *
   * The thumbnail reuses the same element as the spotlight (a `CardComponent` owns a single
   * element), wrapped in a `role="button"` tile so the markup stays valid (no button inside
   * a button).
   *
   * @returns {void}
   */
  renderSummaryGrid() {
    if (!this.summaryGrid) return;
    this.summaryGrid.textContent = '';
    this.summaryGrid.classList.remove('is-recap');
    this.cardComponents.forEach((component, index) => {
      const tile = document.createElement('div');
      tile.className = 'card-reveal__summary-item';
      tile.dataset.key = component.card.uniqueKey;
      tile.setAttribute('role', 'button');
      tile.tabIndex = 0;
      const name = component.card.getName(cardLanguage.getLang());
      const rarityLabel = getRarityLabel(component.card.rarity, (key) => i18n.t(key));
      tile.setAttribute('aria-label', `${name} (${rarityLabel})`);
      const thumbnail = component.render();
      thumbnail.setAttribute('aria-hidden', 'true');
      thumbnail.tabIndex = -1;
      tile.appendChild(thumbnail);
      tile.addEventListener('click', () => this.openCardModal(index));
      tile.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          this.openCardModal(index);
        }
      });
      this.summaryGrid.appendChild(tile);
    });
  }

  /**
   * Shows the recap of a batch: one scrollable section per pack, each with its five cards.
   *
   * The grid container of the single summary is reused (the `is-recap` class switches it to a
   * scrollable column), so a thumbnail behaves the same way in both cases: tapping one opens the
   * detail of that card, with the pack it came from.
   *
   * @returns {void}
   */
  renderBatchSummary() {
    if (!this.summaryGrid) return;
    this.summaryGrid.textContent = '';
    this.summaryGrid.classList.add('is-recap');
    const total = this.batchPacks.length;

    this.batchPacks.forEach((pack, packIndex) => {
      const section = document.createElement('section');
      section.className = 'opening__recap-pack';
      section.dataset.pack = String(packIndex);

      const title = document.createElement('h3');
      title.className = 'opening__recap-title';
      title.textContent = i18n.t('opening.batch.pack', {
        current: packIndex + 1,
        total,
        set: this.resolveSetName(pack.result.setId),
      });

      const cards = document.createElement('div');
      cards.className = 'opening__recap-cards';
      pack.components.forEach((component, index) => {
        const tile = document.createElement('div');
        tile.className = 'card-reveal__summary-item';
        tile.dataset.key = component.card.uniqueKey;
        tile.setAttribute('role', 'button');
        tile.tabIndex = 0;
        const name = component.card.getName(cardLanguage.getLang());
        const rarityLabel = getRarityLabel(component.card.rarity, (key) => i18n.t(key));
        tile.setAttribute('aria-label', `${name} (${rarityLabel})`);
        const thumbnail = component.render();
        thumbnail.setAttribute('aria-hidden', 'true');
        thumbnail.tabIndex = -1;
        tile.appendChild(thumbnail);
        tile.addEventListener('click', () => this.openCardModalFor(pack.components, index));
        tile.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            this.openCardModalFor(pack.components, index);
          }
        });
        cards.appendChild(tile);
      });

      section.append(title, cards);
      this.summaryGrid.appendChild(section);
    });
    this.log(`Batch recap displayed: ${total} pack(s).`);
  }

  /**
   * Updates the summary line (source + card count).
   *
   * @param {{cards: Array, source: string}} result - Persisted pack.
   * @returns {void}
   */
  renderSummary(result) {
    if (this.batchPacks.length > 1) {
      const cards = this.batchPacks.reduce((count, pack) => count + pack.result.cards.length, 0);
      this.summaryElement.hidden = false;
      this.summaryElement.textContent = i18n.t('opening.batch.summary', {
        packs: this.batchPacks.length,
        cards,
      });
      return;
    }
    if (result?.source === 'replay') {
      this.summaryElement.hidden = false;
      this.summaryElement.textContent = i18n.t('opening.replay.summary', {
        set: this.resolveSetName(result.setId),
        cards: result.cards.length,
      });
      return;
    }
    const sourceLabel = i18n.t(result.source === 'bonus' ? 'opening.source.bonus' : 'opening.source.daily');
    this.summaryElement.hidden = false;
    this.summaryElement.textContent = `${sourceLabel} : ${i18n.t('opening.summary', { count: result.cards.length })}`;
  }

  /**
   * Opens the card detail modal (artwork, effects, name, index, rarity) from the summary grid.
   *
   * The artwork is wrapped in the same window the collection uses: it takes the exact shape of the
   * illustration, which is what lets the foil line up with the art and stop there. The effects are
   * switched exactly like in the collection, by the shared `CardEffectsToggle`.
   *
   * @param {number} index - Index of the card in the current pack.
   * @returns {void}
   */
  openCardModal(index) {
    this.openCardModalFor(this.cardComponents, index);
  }

  /**
   * Opens the card detail modal of one card of a given pack.
   *
   * The recap of a batch shows several packs at once, so a card is named by its pack and its
   * position there, never by "the card on the spotlight".
   *
   * @param {CardComponent[]} components - Cards of the pack.
   * @param {number} index - Position of the card in that pack.
   * @returns {void}
   */
  openCardModalFor(components, index) {
    const component = components[index];
    if (!component || !this.cardModal || !this.cardModalTitle || !this.cardModalBody) return;
    const card = component.card;
    const lang = cardLanguage.getLang();
    const name = card.getName(lang);
    this.cardModalTitle.textContent = name;
    this.cardModalBody.textContent = '';

    const art = document.createElement('div');
    art.className = 'card-modal__art';
    const image = document.createElement('img');
    image.className = 'card-modal__image';
    image.src = i18n.resolveImagePath(card.illustration);
    image.alt = `${name} (${getRarityLabel(card.rarity, (key) => i18n.t(key))})`;
    // The shine is laid over the artwork, so the window needs the real ratio of the illustration.
    image.addEventListener('load', () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        art.style.setProperty(
          '--card-reveal-art-ratio',
          String(image.naturalWidth / image.naturalHeight)
        );
      }
    });
    image.addEventListener('error', () => {
      console.warn(`[OpeningView] Detail illustration not found for "${card.uniqueKey}": ${image.src}`);
      image.hidden = true;
    });
    art.appendChild(image);
    attachCardTilt(art);
    applyShine(art, card);
    applyCardGlow(art, card);
    art.classList.toggle('is-off', !this.shineEnabled);
    this.shineWindow = art;
    this.cardModalBody.appendChild(art);

    if (getShineClasses(card).length > 0) {
      this.cardModalBody.appendChild(buildCardEffectsToggle(this.shineEnabled));
    }

    const list = document.createElement('dl');
    list.className = 'card-modal__details';
    const statusLabel = component.isNew
      ? i18n.t('opening.card.statusNew')
      : i18n.t('opening.card.statusOwned');
    const rows = [
      [i18n.t('opening.card.count', { current: index + 1, total: components.length }), statusLabel],
      [i18n.t('opening.card.name'), name],
      // The index is the reference of the catalogue: what a player quotes about a card.
      [i18n.t('opening.card.index'), card.index || card.id],
      [i18n.t('opening.card.rarity'), getRarityLabel(card.rarity, (key) => i18n.t(key))],
      [i18n.t('opening.card.set'), this.resolveSetName(card.set)],
    ];
    rows.forEach(([term, value]) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'card-modal__row';
      const key = document.createElement('dt');
      key.textContent = term;
      const text = document.createElement('dd');
      text.textContent = value;
      wrapper.appendChild(key);
      wrapper.appendChild(text);
      list.appendChild(wrapper);
    });

    this.cardModalBody.appendChild(list);
    this.cardModal.hidden = false;
    this.log(`Card detail opened for "${card.uniqueKey}".`);
  }

  /**
   * Switches every effect of the open detail on or off.
   *
   * The choice is kept on the view, so opening another card of the same pack keeps it; it is a
   * reading comfort, not a preference, so nothing is written to the account.
   *
   * @returns {void}
   */
  toggleCardEffects() {
    this.shineEnabled = !this.shineEnabled;
    this.shineWindow?.classList.toggle('is-off', !this.shineEnabled);
    syncCardEffectsToggle(this.cardModalBody, this.shineEnabled);
    this.log(`Card effects ${this.shineEnabled ? 'enabled' : 'disabled'}.`);
  }

  /**
   * Closes the card detail modal.
   *
   * @returns {void}
   */
  closeCardModal() {
    if (!this.cardModal || this.cardModal.hidden) return;
    this.cardModal.hidden = true;
    this.log('Card detail closed.');
  }

  /**
   * Closes the modal when the backdrop itself is clicked.
   *
   * @param {MouseEvent} event - Click event on the modal overlay.
   * @returns {void}
   */
  handleModalBackdropClick(event) {
    if (event?.target === this.cardModal) {
      this.closeCardModal();
    }
  }

  /**
   * Handles global keys: Escape closes the modal, arrows navigate the spotlight.
   *
   * @param {KeyboardEvent} event - Key event.
   * @returns {void}
   */
  handleDocumentKeyDown(event) {
    if (!event || typeof event.key !== 'string') return;
    // The listener sits on `document` for the whole session, so it must stand down with the view:
    // without this guard, Space opened a pack from the collection or the settings page.
    if (!this.isActive) return;
    const isSpace = event.key === ' ' || event.code === 'Space';
    const target = event.target;
    // Only a text field keeps its own keys: a button that still holds the focus ("Ouvrir" was just
    // clicked, or "Suivante") must not swallow Space.
    const isTextControl = target instanceof HTMLElement
      && (target.closest('input, select, textarea, [contenteditable="true"]') !== null);
    if (this.countModal && !this.countModal.hidden) {
      if (event.key === 'Escape') this.closeCountModal();
      return;
    }
    if (this.sourceModal && !this.sourceModal.hidden) {
      if (event.key === 'Escape') {
        this.closeSourceModal();
      } else if (isSpace && !event.repeat && !isTextControl) {
        // The dialog asks which bucket pays: Space picks the free daily booster, the default the
        // same key chooses on the button itself.
        event.preventDefault();
        void this.handleSourceChoice('daily');
      }
      return;
    }
    if (this.cardModal && !this.cardModal.hidden) {
      if (event.key === 'Escape') {
        this.closeCardModal();
      }
      return;
    }

    if (isSpace && !event.repeat && !isTextControl) {
      // On the "Ouvrir" page, Space IS the open button.
      if (this.selectStage && !this.selectStage.hidden) {
        event.preventDefault();
        if (!this.openButton.disabled) this.openButton.click();
        return;
      }
      // Once the pack is drawn, the only gesture left is the tap on the 3D booster: Space plays it
      // (and lets the tear animation run) instead of skipping straight to the reveal.
      if (this.sceneStage && !this.sceneStage.hidden && this.revealStage === 'idle' && this.pendingResult) {
        event.preventDefault();
        this.openBoosterFromKeyboard();
        return;
      }
    }

    if (this.revealStage !== 'spotlight' || this.sceneStage.hidden) return;
    if (isTextControl) return;
    if (event.key === 'ArrowLeft') {
      this.stopSpaceAutoAdvance();
      this.showPreviousCard();
    } else if (event.key === 'ArrowRight') {
      this.stopSpaceAutoAdvance();
      this.handleNextAction();
    } else if (event.key === ' ') {
      // Holding Space walks the pack automatically, the way the streaming overlay does. The first
      // press acts immediately; the auto-repeat of the browser is ignored (the interval owns it).
      event.preventDefault();
      if (event.repeat) return;
      this.startSpaceAutoAdvance();
    } else if (event.key === 'Escape') {
      this.finish();
    }
  }

  /**
   * Stops the automatic reveal when Space comes back up.
   *
   * @param {KeyboardEvent} event - Key event.
   * @returns {void}
   */
  handleDocumentKeyUp(event) {
    if (event?.key === ' ') this.stopSpaceAutoAdvance();
  }

  /**
   * Simulates the tap on the booster from the keyboard (Space).
   *
   * The 3D renderer owns the tear animation: asking it to open keeps the same timing as a click.
   * When it is unavailable (2D fallback), the shared gesture handler does exactly what a tap does.
   *
   * @returns {void}
   */
  openBoosterFromKeyboard() {
    if (!this.pendingResult) return;
    if (this.isFallbackMode) {
      this.handleFallbackClick({ preventDefault() {} });
      return;
    }
    if (this.renderer3d) {
      const started = this.renderer3d.requestOpen();
      if (started) this.log('Space simulated the tap on the 3D booster.');
      return;
    }
    // The scene is still being built (or failed without a fallback): start the reveal directly so
    // Space never becomes a dead key.
    this.handleBoosterOpenStart();
    this.handleBoosterOpenGesture();
  }

  /**
   * Starts advancing the spotlight on a steady beat until Space is released.
   *
   * @returns {void}
   */
  startSpaceAutoAdvance() {
    this.stopSpaceAutoAdvance();
    this.handleNextAction();
    this.spaceHoldTimer = window.setInterval(() => {
      if (this.revealStage !== 'spotlight' || !this.isActive) {
        this.stopSpaceAutoAdvance();
        return;
      }
      this.handleNextAction();
    }, SPACE_AUTO_ADVANCE_MS);
    this.log('Space held: automatic reveal started.');
  }

  /**
   * Stops the automatic reveal (Space released, stage left, view hidden…).
   *
   * @returns {void}
   */
  stopSpaceAutoAdvance() {
    if (this.spaceHoldTimer === null) return;
    window.clearInterval(this.spaceHoldTimer);
    this.spaceHoldTimer = null;
    this.log('Automatic reveal stopped.');
  }

  /**
   * Copies the current booster as a shareable code (`minecards:<base64url>`, see `BoosterCode`).
   *
   * The pack is already persisted when this button exists, so the code is generated from the
   * in-memory result and the loaded extension (for the display name and the booster texture).
   *
   * @returns {Promise<void>} Resolves once the copy attempt finished.
   */
  async handleCopyBoosterCode() {
    if (!this.pendingResult) {
      console.warn('[OpeningView] Copy ignored: no booster is open.');
      return;
    }

    let set = null;
    try {
      set = await boosterManager.getBoosterSet(this.pendingResult.setId);
    } catch (error) {
      console.warn('[OpeningView] The extension could not be reloaded for the code.', error);
    }

    try {
      const code = buildBoosterCode(this.pendingResult, set);
      await this.writeToClipboard(code);
      this.log(`Booster code copied (${code.length} characters).`);
      Toast.success('opening.copyCode.done');
    } catch (error) {
      console.error('[OpeningView] The booster code could not be copied.', error);
      Toast.error('opening.copyCode.error');
    }
  }

  /**
   * Writes a text in the clipboard, with a fallback for non-secure contexts.
   *
   * @param {string} text - Text to copy.
   * @returns {Promise<void>} Resolves when the text is in the clipboard.
   * @throws {Error} When both clipboard strategies fail.
   */
  async writeToClipboard(text) {
    return writeToClipboard(text);
  }

  /**
   * Opens the share page of the pack on screen (`booster.html`) in a new tab.
   *
   * The page is standalone: it receives the same code the copy button writes, the language of the
   * cards, and the optional pseudo and avatar of the player, and it offers the overlay link in
   * turn. The tab is opened BEFORE the extension is awaited, because a `window.open()` that only
   * runs after an `await` no longer belongs to the click and every browser blocks it; the blank
   * tab is pointed at the page once it is built, and closed again if the code cannot be written.
   *
   * @returns {Promise<void>} Resolves once the tab points at the share page (or the failure shown).
   */
  async handleShareOpening() {
    if (!this.pendingResult) {
      console.warn('[OpeningView] Share ignored: no booster is open.');
      return;
    }

    const tab = window.open('about:blank', '_blank');
    if (!tab) {
      Toast.error('opening.share.error');
      return;
    }
    // The page is same-origin and only ever read: it has no reason to keep a handle on the game.
    tab.opener = null;

    let set = null;
    try {
      set = await boosterManager.getBoosterSet(this.pendingResult.setId);
    } catch (error) {
      console.warn('[OpeningView] The extension could not be reloaded for the share page.', error);
    }

    try {
      const url = new URL('booster.html', window.location.href);
      url.searchParams.set('code', buildBoosterCode(this.pendingResult, set));
      url.searchParams.set('lang', cardLanguage.getLang());

      // The identity is optional: a player who never named themselves still shares the pack, and
      // the share page shows its anonymous wording instead of an empty pill.
      let profile = null;
      try {
        profile = await profileManager.getProfile();
      } catch (error) {
        console.warn('[OpeningView] The profile could not be read for the share page.', error);
      }
      const name = typeof profile?.name === 'string' ? profile.name.trim() : '';
      if (name !== '') url.searchParams.set('username', name);
      const picture = typeof profile?.icon === 'string' && profile.icon !== ''
        ? profile.icon
        : (typeof profile?.photo === 'string' ? profile.photo : '');
      if (picture !== '') {
        url.searchParams.set('profileiconurl', new URL(picture, window.location.href).href);
      }

      tab.location.replace(url.href);
      this.log('Share page opened for the displayed pack.');
    } catch (error) {
      console.error('[OpeningView] The share page could not be opened.', error);
      tab.close();
      Toast.error('opening.share.error');
    }
  }

  /**
   * Opens or closes the "+" menu of the summary actions.
   *
   * The menu is only worth opening when at least one of its three buttons can act: a replay and a
   * batch hide save, copy and share, so the toggle is hidden instead (see `updateActionsToggle`).
   * Opening moves the focus to the first available action, which keeps the menu usable with the
   * keyboard; closing is left to `closeActionsMenu`.
   *
   * @returns {void}
   */
  toggleActionsMenu() {
    if (!this.actionsMenu || !this.actionsToggle) return;
    if (!this.actionsMenu.hidden && !this.actionsMenu.classList.contains('is-closing')) {
      this.closeActionsMenu(true);
      return;
    }
    if (!this.hasVisibleActions()) return;
    // A click during the closing animation simply reopens the menu: cancel the pending hide and
    // restart the entrance, instead of leaving a half-faded menu on screen.
    if (this.actionsMenuCloseTimer !== null) {
      window.clearTimeout(this.actionsMenuCloseTimer);
      this.actionsMenuCloseTimer = null;
    }
    this.actionsMenu.classList.remove('is-closing');
    this.actionsMenu.hidden = false;
    this.actionsToggle.setAttribute('aria-expanded', 'true');
    const first = Array.from(this.actionsMenu.querySelectorAll('.btn')).find((button) => !button.hidden);
    // `preventScroll`: focusing the first action must not scroll the summary, which would close the
    // menu on its own through the scroll listener.
    first?.focus({ preventScroll: true });
  }

  /**
   * Closes the "+" menu without touching the actions it contains.
   *
   * The menu is faded out first and hidden once the animation is over, so it does not blink away.
   * A player who asked for reduced motion gets the immediate hide instead. Calling this while the
   * menu is already leaving only updates the state, never starts a second timer.
   *
   * @param {boolean} [restoreFocus=false] - Whether the toggle must take the focus back (Escape).
   * @returns {void}
   */
  closeActionsMenu(restoreFocus = false) {
    if (!this.actionsMenu || this.actionsMenu.hidden) return;
    this.actionsToggle?.setAttribute('aria-expanded', 'false');
    if (restoreFocus) this.actionsToggle?.focus();
    if (this.actionsMenu.classList.contains('is-closing')) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      this.finishCloseActionsMenu();
      return;
    }
    this.actionsMenu.classList.add('is-closing');
    // A touch over the animation duration: even if `animationend` is throttled or skipped, the menu
    // never stays on screen without its toggle.
    this.actionsMenuCloseTimer = window.setTimeout(() => this.finishCloseActionsMenu(), 180);
  }

  /**
   * Hides the "+" menu once its closing animation is over.
   *
   * @returns {void}
   */
  finishCloseActionsMenu() {
    if (this.actionsMenuCloseTimer !== null) {
      window.clearTimeout(this.actionsMenuCloseTimer);
      this.actionsMenuCloseTimer = null;
    }
    if (!this.actionsMenu) return;
    this.actionsMenu.hidden = true;
    this.actionsMenu.classList.remove('is-closing');
    this.actionsToggle?.setAttribute('aria-expanded', 'false');
  }

  /**
   * Whether the summary has at least one secondary action to offer.
   *
   * @returns {boolean} True when save, copy or share is visible.
   */
  hasVisibleActions() {
    return [this.saveButton, this.copyCodeButton, this.shareButton].some(
      (button) => button && !button.hidden,
    );
  }

  /**
   * Shows the "+" only when it has something to open.
   *
   * Called wherever one of the three buttons appears or disappears: a replay or a batch hides them
   * all, and a lone finish button is clearer than an empty menu.
   *
   * @returns {void}
   */
  updateActionsToggle() {
    if (!this.actionsMore) return;
    const hasActions = this.hasVisibleActions();
    this.actionsMore.hidden = !hasActions;
    // The toggle is gone with its group: there is nothing left to animate out.
    if (!hasActions) this.finishCloseActionsMenu();
  }

  /**
   * Shows, hides and arms the "save this opening" button of the summary.
   *
   * A batch and a replay have nothing to save as one pack: the first would need one slot per pack,
   * the second never wrote anything. The button disappears for both, and stays disabled with an
   * explanation once the ten slots are taken.
   *
   * @returns {Promise<void>} Resolves once the button is up to date.
   */
  async refreshSaveButton() {
    if (!this.saveButton) {
      this.updateActionsToggle();
      return;
    }
    const result = this.pendingResult;
    const single = Boolean(result) && this.batchPacks.length <= 1 && !this.isReplay;
    if (!single) {
      this.saveButton.hidden = true;
      this.updateActionsToggle();
      return;
    }
    this.saveButton.hidden = false;
    this.updateActionsToggle();
    this.saveButton.title = '';
    this.saveButton.textContent = i18n.t('opening.save');
    if (this.savedResult === result) {
      this.saveButton.disabled = true;
      this.saveButton.textContent = i18n.t('opening.save.done');
      return;
    }
    this.saveButton.disabled = false;
    try {
      const state = await boosterManager.getSavedOpeningsState();
      // The player may have left the summary (or started a replay) while the slots were read: the
      // button must not come back on a screen that no longer shows this pack.
      if (this.pendingResult !== result || this.isReplay) return;
      this.saveButton.disabled = state.full;
      if (state.full) this.saveButton.title = i18n.t('opening.save.full');
    } catch (error) {
      console.warn('[OpeningView] The saved-opening slots could not be read.', error);
    }
  }

  /**
   * Pins the pack of the summary in one of the ten saved slots.
   *
   * Nothing is written to the collection or to the statistics: the pack was persisted when it was
   * drawn, and saving only keeps what the player is looking at. The button stays disabled once the
   * slot is taken, so a double click cannot consume two slots.
   *
   * @returns {Promise<void>} Resolves once the slot is written (or the error shown).
   */
  async saveCurrentOpening() {
    const result = this.pendingResult;
    if (!result || this.isReplay || this.batchPacks.length > 1 || this.isSaving) return;
    this.isSaving = true;
    if (this.saveButton) this.saveButton.disabled = true;
    try {
      await boosterManager.saveOpening({
        setId: result.setId,
        cards: result.cards,
        godpack: Boolean(result.godpack),
      });
      this.savedResult = result;
      if (this.saveButton && this.pendingResult === result) {
        this.saveButton.textContent = i18n.t('opening.save.done');
      }
      Toast.success('opening.save.toast');
      this.log('Opening pinned in the saved slots.');
    } catch (error) {
      if (error?.code === 'SAVED_OPENINGS_FULL') {
        this.setFeedback('opening.save.full', 'error');
      } else {
        console.error('[OpeningView] The opening could not be saved.', error);
        this.setFeedback('opening.save.error', 'error');
      }
      if (this.saveButton) this.saveButton.disabled = false;
    } finally {
      this.isSaving = false;
    }
  }

  /**
   * Replays a saved opening: the same cards, in the same order, with no other effect.
   *
   * The reveal is the normal one — the spotlight, one card at a time, then the summary — but the
   * pack is NOT drawn again: no booster is spent, no card enters the collection, no card is flagged
   * as new, no Sparks and no experience move. The share code and the "save" button are hidden,
   * because there is nothing to share and nothing to keep.
   *
   * @param {{setId: string, cards: (Card|null)[], godpack?: boolean}} entry - Resolved saved entry.
   * @returns {boolean} True when the replay started, false when the view was busy.
   */
  replaySaved(entry) {
    if (this.isBusy || this.revealStage !== 'idle') return false;
    const cards = (Array.isArray(entry?.cards) ? entry.cards : []).filter(Boolean);
    if (cards.length === 0 || typeof entry.setId !== 'string') return false;

    this.isBusy = true;
    try {
      const result = {
        setId: entry.setId,
        cards,
        newKeys: [],
        source: 'replay',
        godpack: Boolean(entry.godpack),
        remaining: null,
      };
      this.isReplay = true;
      this.pendingResult = result;
      this.savedResult = null;
      this.cancelIdleDispose();
      this.disposePreview();
      this.warmupCardImages(cards);
      this.showStage('scene');
      this.showSceneSubStage('booster');
      this.buildReveal(result);
      if (this.copyCodeButton) this.copyCodeButton.hidden = true;
      if (this.shareButton) this.shareButton.hidden = true;
      this.startSpotlightReveal();
      this.log(`Replaying a saved opening of "${entry.setId}" (visual only).`);
      return true;
    } finally {
      this.isBusy = false;
    }
  }

  /**
   * Closes the scene and goes back to the extension picker. Performs NO write: the pack was
   * already persisted by `openBooster()` before the animation.
   *
   * @returns {void}
   */
  finish() {
    this.closeActionsMenu();
    this.log('Finishing the reveal (no write, the pack was already persisted).');
    if (!this.isReplay) this.announceRevealFinished();
    this.closeSourceModal();
    this.cancelIdleDispose();
    this.disposeRenderer();
    this.isFallbackMode = false;
    this.clearReveal();
    this.pendingResult = null;
    this.isReplay = false;
    this.savedResult = null;
    this.setFeedback(null);
    this.showStage('select');
    this.showSceneSubStage('booster');
    if (this.saveButton) {
      // The button is reset here (not only when the next summary arms it) so a finished pack never
      // leaves a stale "Sauvegardée" label behind.
      this.saveButton.hidden = true;
      this.saveButton.disabled = false;
      this.saveButton.title = '';
      this.saveButton.textContent = i18n.t('opening.save');
    }
    if (this.copyCodeButton) this.copyCodeButton.hidden = false;
    if (this.shareButton) this.shareButton.hidden = false;
    void this.refreshSetOptions().then(() => this.updatePreview());
    this.refreshQuota();
  }

  // __OPENING_LIFECYCLE__

  /**
   * Destroys the displayed cards and hides the reveal block.
   *
   * @returns {void}
   */
  clearReveal() {
    this.stopSpaceAutoAdvance();
    this.clearBurst();
    this.clearSpotlightEntryGuard();
    // Every pack of a batch owns its cards: they are released together, whichever pack is on screen.
    const components = this.batchPacks.length > 0
      ? this.batchPacks.flatMap((pack) => pack.components)
      : this.cardComponents;
    components.forEach((component) => component.destroy());
    this.batchPacks = [];
    this.batchIndex = 0;
    this.cardComponents = [];
    if (this.batchCounterElement) this.batchCounterElement.hidden = true;
    this.spotlightIndex = 0;
    this.revealStage = 'idle';
    this.touchStart = null;
    this.suppressNextSpotlightClick = false;
    if (this.spotlightStage) this.spotlightStage.textContent = '';
    if (this.summaryGrid) {
      this.summaryGrid.textContent = '';
      this.summaryGrid.hidden = true;
      this.summaryGrid.classList.remove('is-recap');
    }
    if (this.revealContainer) this.revealContainer.hidden = true;
    if (this.summaryElement) this.summaryElement.hidden = true;
    this.closeCardModal();
  }

  /**
   * Releases the WebGL resources of the current scene.
   *
   * @returns {void}
   */
  disposeRenderer() {
    if (this.renderer3d) {
      this.renderer3d.dispose();
      this.renderer3d = null;
    }
  }

  /**
   * Schedules the release of the WebGL context when the view stays idle.
   *
   * @returns {void}
   */
  scheduleIdleDispose() {
    this.cancelIdleDispose();
    this.idleDisposeTimer = window.setTimeout(() => {
      this.idleDisposeTimer = null;
      if (!this.isActive) {
        console.info('[OpeningView] Releasing the idle WebGL context.');
        this.disposeRenderer();
      }
    }, IDLE_DISPOSE_DELAY_MS);
  }

  /**
   * Cancels the scheduled WebGL release.
   *
   * @returns {void}
   */
  cancelIdleDispose() {
    if (this.idleDisposeTimer !== null) {
      window.clearTimeout(this.idleDisposeTimer);
      this.idleDisposeTimer = null;
    }
  }

  /**
   * Tells whether the reveal scene owns the screen.
   *
   * @returns {boolean} True while the booster or its cards are displayed.
   */
  isSceneOpen() {
    return Boolean(this.sceneStage && !this.sceneStage.hidden);
  }

  /**
   * Called by `app.js` when the opening view becomes active.
   *
   * @returns {void}
   */
  handleViewActivated() {
    this.isActive = true;
    this.cancelIdleDispose();
    this.log('View activated.');
    this.refreshQuota();
    // The preview only runs while the picker is on screen: a pack being revealed owns the view
    // otherwise (and its own 3D scene).
    if (!this.selectStage.hidden) {
      if (this.previewRenderer) {
        this.previewRenderer.start();
      } else {
        void this.updatePreview();
      }
    }
  }

  /**
   * Called by `app.js` when another view becomes active: stops the render loop.
   *
   * @returns {void}
   */
  handleViewDeactivated() {
    this.isActive = false;
    this.stopSpaceAutoAdvance();
    this.log('View deactivated, stopping the render loop.');
    // Leaving the view mid-ritual (a deep link, the back button) gives the chrome back: the focus
    // class belongs to the screen, not to the pack being revealed.
    setFocusMode(false);
    this.stopPreview();
    if (this.renderer3d) {
      this.renderer3d.stop();
      this.scheduleIdleDispose();
    }
  }

  /**
   * Removes every listener and releases the scene.
   *
   * @returns {void}
   */
  destroy() {
    this.log('Destroying the view.');
    this.finishCloseActionsMenu();
    setFocusMode(false);
    this.cancelIdleDispose();
    this.disposeRenderer();
    this.disposePreview();
    this.clearReveal();
    this.bindings.forEach(({ target, type, handler, options }) => target.removeEventListener(type, handler, options));
    this.bindings = [];
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers = [];
  }
}

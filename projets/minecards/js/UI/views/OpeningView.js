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
import { configLoader } from '../../utils/ConfigLoader.js';
import boosterManager from '../../business/BoosterManager.js';
import collectionManager from '../../business/CollectionManager.js';
import dateSyncManager, { BOOSTER_SOURCES } from '../../business/DateSyncManager.js';
import sparksManager, { INSUFFICIENT_SPARKS } from '../../business/SparksManager.js';
import CardComponent from '../components/CardComponent.js';
import Toast from '../components/Toast.js';
import { buildBoosterCode } from '../../utils/BoosterCode.js';
import { writeToClipboard } from '../../utils/Clipboard.js';
import soundManager, { SOUNDS } from '../../utils/SoundManager.js';
import animationManager from '../../utils/AnimationManager.js';
import { getRarityLabel } from '../../classes/Card.js';
import Booster3DRenderer, { DEFAULT_MODEL_PATH } from '../components/Booster3DRenderer.js';

/** View name, matching `data-view="opening"` in `index.html`. */
export const OPENING_VIEW_NAME = 'opening';

/** Delay before releasing the WebGL resources of an inactive view, in milliseconds. */
const IDLE_DISPOSE_DELAY_MS = 30000;

/** Minimum horizontal swipe distance on the spotlight card, in pixels. */
const SWIPE_THRESHOLD_PX = 24;

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
    this.openButton = this.root.querySelector('[data-opening-open]');
    this.buyButton = this.root.querySelector('[data-opening-buy]');
    this.feedbackElement = this.root.querySelector('[data-opening-feedback]');

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
    this.spotlightElement = this.root.querySelector('[data-opening-spotlight]');
    this.spotlightStage = this.root.querySelector('[data-opening-stage-card]');
    this.counterElement = this.root.querySelector('[data-opening-counter]');
    this.prevButton = this.root.querySelector('[data-opening-prev]');
    this.nextButton = this.root.querySelector('[data-opening-next]');
    this.revealContainer = this.root.querySelector('[data-card-summary]');
    this.summaryGrid = this.root.querySelector('[data-card-summary]');
    this.summaryElement = this.root.querySelector('[data-opening-summary]');
    this.actionsElement = this.root.querySelector('[data-opening-actions]');
    this.copyCodeButton = this.root.querySelector('[data-opening-copy-code]');
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

    this.assertMarkup();

    /** @type {Map<string, object>} Extension descriptions, keyed by id. */
    this.sets = new Map();
    /** @type {string[]} Extension ids, in the display order of the picker (the arrows walk it). */
    this.setOrder = [];
    /** @type {string|null} Currently selected extension. */
    this.selectedSetId = null;
    /** @type {Booster3DRenderer|null} Non-interactive preview of the "select" stage. */
    this.previewRenderer = null;
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
    /** @type {string|null} Last feedback i18n key (re-translated on `LANG_CHANGED`). */
    this.feedbackKey = null;
    /** @type {'info'|'error'} */
    this.feedbackTone = 'info';
    /** @type {object|null} Last quota snapshot rendered. */
    this.lastQuota = null;
    /** @type {number} Sparks charged for one extra daily booster (`boosters`). */
    this.extraBoosterPrice = 0;
    /** @type {number} Last known Sparks balance, for the state of the buy button. */
    this.sparksBalance = 0;
    /** @type {boolean} True while the extra-booster purchase is in flight. */
    this.isBuying = false;

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
      ['[data-opening-buy]', this.buyButton],
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
      ['[data-opening-copy-code]', this.copyCodeButton],
      ['[data-opening-finish]', this.finishButton],
      ['[data-booster-3d]', this.boosterContainer],
      ['[data-booster-fallback]', this.boosterFallback],
      ['[data-booster-preview]', this.previewContainer],
      ['[data-booster-preview-canvas]', this.previewViewport],
      ['[data-booster-prev-set]', this.prevSetButton],
      ['[data-booster-next-set]', this.nextSetButton],
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
    try {
      const { extraBoosterPriceSparks } = await configLoader.getBoosterSettings();
      this.extraBoosterPrice = extraBoosterPriceSparks;
    } catch (error) {
      console.warn('[OpeningView] The extra-booster price could not be read.', error);
    }
    this.refreshQuota();
    void this.refreshSparksBalance();
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
    const listed = await boosterManager.listBoosterSets();

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
      option.textContent = i18n.t('opening.set.option', {
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
    this.listen(this.buyButton, 'click', () => this.handleBuyExtraBooster());
    this.listen(this.boosterFallback, 'click', (event) => this.handleFallbackClick(event));
    this.listen(this.copyCodeButton, 'click', () => this.handleCopyBoosterCode());
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
    this.listen(document, 'keydown', (event) => this.handleDocumentKeyDown(event));
    this.log('DOM listeners bound.');
  }

  /**
   * Subscribes to the application events the view depends on.
   *
   * @returns {void}
   */
  subscribeToEvents() {
    this.unsubscribers.push(eventBus.on(EVENTS.QUOTA_UPDATED, (payload) => this.handleQuotaUpdated(payload)));
    this.unsubscribers.push(eventBus.on(EVENTS.SPARKS_UPDATED, (payload) => this.handleSparksUpdated(payload)));
    this.unsubscribers.push(eventBus.on(EVENTS.CLOCK_TICK, (payload) => this.handleClockTick(payload)));
    this.unsubscribers.push(eventBus.on(EVENTS.LANG_CHANGED, () => this.handleLanguageChanged()));
    this.log('Event subscriptions registered.');
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
    this.log(`Stage displayed: ${stage}.`);
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
    this.revealContainer.hidden = !showSummary;
    this.revealStage = subStage === 'booster' ? 'idle' : subStage;
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
      this.setFeedback('opening.error.load', 'error');
      return;
    }

    const quota = dateSyncManager.getQuotaSnapshot(this.selectedSetId);
    this.lastQuota = quota;
    const available = quota.availableForSet ?? 0;
    this.log(`Quota refreshed for "${this.selectedSetId}":`, quota);

    this.quotaElement.textContent = i18n.t('opening.quota', {
      daily: quota.daily,
      set: this.resolveSetName(this.selectedSetId),
      bonus: quota.bonusBySet[this.selectedSetId] ?? 0,
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

    this.renderBuyButton();
  }

  /**
   * Renders the extra-booster button.
   *
   * The button answers one situation: the free daily boosters are spent and the player does not
   * want to wait for the next UTC day. It therefore appears only when the daily allowance is at
   * zero, carries its price, and is disabled (with the missing amount in its tooltip) while the
   * balance is short - a click that can only fail is not a click the player should be able to make.
   *
   * @returns {void}
   */
  renderBuyButton() {
    if (!this.buyButton) return;
    const price = this.extraBoosterPrice;
    const daily = this.lastQuota?.daily ?? 0;
    const visible = price > 0 && daily <= 0;
    this.buyButton.hidden = !visible;
    if (!visible) return;

    this.buyButton.textContent = i18n.t('opening.buyExtra', { price });
    this.buyButton.setAttribute('aria-label', i18n.t('opening.buyExtraAria', { price }));
    const missing = Math.max(0, price - this.sparksBalance);
    this.buyButton.disabled = this.isBuying || missing > 0;
    this.buyButton.title = missing > 0 ? i18n.t('opening.buyExtra.hint', { missing }) : '';
  }

  /**
   * Reads the Sparks balance, which decides whether an extra booster is affordable.
   *
   * A read failure leaves the button disabled rather than offering a purchase that cannot be paid.
   *
   * @returns {Promise<void>} Resolves once the button reflects the balance.
   */
  async refreshSparksBalance() {
    try {
      this.sparksBalance = await sparksManager.getBalance();
    } catch (error) {
      console.warn('[OpeningView] The Sparks balance could not be read.', error);
      this.sparksBalance = 0;
    }
    this.renderBuyButton();
  }

  /**
   * Follows the balance when it changes elsewhere (a sale or a purchase in the collection).
   *
   * @param {{balance?: number}|null} payload - `SPARKS_UPDATED` payload.
   * @returns {void}
   */
  handleSparksUpdated(payload) {
    if (!Number.isFinite(payload?.balance)) return;
    this.sparksBalance = payload.balance;
    this.renderBuyButton();
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
    if (this.openButton.disabled && this.selectedSetId) {
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
    // The price of the extra booster is part of its label, so the button is re-rendered whatever
    // sub-stage is on screen.
    this.renderBuyButton();
    if (this.feedbackKey) {
      this.setFeedback(this.feedbackKey, this.feedbackTone);
    }
    if (this.pendingResult) {
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
   * @returns {void}
   */
  setFeedback(key, tone = 'info') {
    this.feedbackKey = key;
    this.feedbackTone = tone;
    if (!key) {
      this.feedbackElement.hidden = true;
      this.feedbackElement.textContent = '';
      return;
    }
    this.feedbackElement.hidden = false;
    this.feedbackElement.textContent = i18n.t(key);
    this.feedbackElement.dataset.tone = tone;
    if (tone === 'error') {
      console.warn(`[OpeningView] ${i18n.t(key)}`);
    }
  }

  /**
   * Handles the extra-booster button: buys one booster, then opens it.
   *
   * Buying and opening are one gesture on purpose - the player who presses this button wants a
   * pack, not a quota entry they must then spend by hand. The purchase itself is atomic (see
   * `BoosterManager.buyExtraBooster`), so a failure never charges the balance.
   *
   * @returns {Promise<void>} Resolves once the purchase was made and the opening started.
   */
  async handleBuyExtraBooster() {
    if (this.isBuying || this.isBusy || !this.selectedSetId) return;

    if (this.sparksBalance < this.extraBoosterPrice) {
      this.setFeedback('opening.error.insufficientSparks', 'error');
      return;
    }

    this.isBuying = true;
    this.buyButton.disabled = true;
    this.setFeedback(null);
    this.log(`Buying an extra booster for ${this.extraBoosterPrice} Sparks…`);

    try {
      const { price, balance } = await boosterManager.buyExtraBooster();
      this.sparksBalance = balance;
      Toast.success('opening.buyExtra.done', { params: { price } });
      // `performOpen` owns `isBusy`: released here so the opening it triggers is not refused.
      this.isBuying = false;
      await this.performOpen(BOOSTER_SOURCES.PURCHASED);
    } catch (error) {
      console.error('[OpeningView] The extra booster could not be bought.', error);
      this.setFeedback(
        error?.code === INSUFFICIENT_SPARKS
          ? 'opening.error.insufficientSparks'
          : 'opening.error.buy',
        'error'
      );
    } finally {
      this.isBuying = false;
      this.refreshQuota();
    }
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
      if (typeof this.onBoosterOpened === 'function') {
        this.onBoosterOpened(result);
      }
      this.showStage('scene');
      this.showSceneSubStage('booster');
      // The picker preview is gone from the screen: its scene is released before the real one is
      // built, so only one WebGL loop ever runs.
      this.disposePreview();
      await this.prepareScene(result);
      this.buildReveal(result);
    } catch (error) {
      if (error?.code === 'NO_BOOSTER_AVAILABLE') {
        console.warn(`[OpeningView] No booster left for "${this.selectedSetId}".`);
        this.setFeedback('opening.error.noBooster', 'error');
      } else {
        console.error('[OpeningView] The booster could not be opened.', error);
        this.setFeedback('opening.error.open', 'error');
      }
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
    this.renderer3d = new Booster3DRenderer({
      container: this.boosterViewport,
      texturePath: set?.texture ?? null,
      label: result.setId,
      onOpenStart: () => this.handleBoosterOpenStart(),
      onOpenRequest: () => this.handleBoosterOpenGesture(),
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
    if (this.previewRenderer || this.previewFailed || !this.selectedSetId || !this.previewViewport) return;

    const set = this.sets.get(this.selectedSetId) ?? null;
    this.previewLoading.hidden = false;
    this.previewFallback.hidden = true;
    this.previewViewport.textContent = '';
    this.log(`Preparing the booster preview for "${this.selectedSetId}"…`);

    const renderer = new Booster3DRenderer({
      container: this.previewViewport,
      texturePath: set?.texture ?? null,
      interactive: false,
      label: `preview:${this.selectedSetId}`,
    });
    const ready = await renderer.init();
    this.previewLoading.hidden = true;

    if (!ready) {
      console.warn('[OpeningView] The 3D preview is unavailable, showing the 2D image.');
      renderer.dispose();
      this.previewFailed = true;
      this.showPreviewFallback(set);
      return;
    }

    this.previewRenderer = renderer;
    renderer.start();
    this.log('Booster preview ready.');
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
      this.log(`Spotlight card ${this.spotlightIndex + 1} tapped while revealed: summary.`);
      this.showSummaryStage();
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
   * Shows the summary grid with the 5 cards and the summary line.
   *
   * @returns {void}
   */
  showSummaryStage() {
    if (!this.pendingResult) {
      console.warn('[OpeningView] Summary ignored: no pack is waiting.');
      return;
    }
    this.announceRevealFinished();
    this.closeCardModal();
    this.renderSummaryGrid();
    this.renderSummary(this.pendingResult);
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
    this.cardComponents.forEach((component, index) => {
      const tile = document.createElement('div');
      tile.className = 'card-reveal__summary-item';
      tile.dataset.key = component.card.uniqueKey;
      tile.setAttribute('role', 'button');
      tile.tabIndex = 0;
      const name = component.card.getName(i18n.getLang());
      const rarityLabel = getRarityLabel(component.card.rarity, (key) => i18n.t(key));
      tile.setAttribute('aria-label', `${name} — ${rarityLabel}`);
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
   * Updates the summary line (source + card count).
   *
   * @param {{cards: Array, source: string}} result - Persisted pack.
   * @returns {void}
   */
  renderSummary(result) {
    const sourceLabel = i18n.t(result.source === 'bonus' ? 'opening.source.bonus' : 'opening.source.daily');
    this.summaryElement.hidden = false;
    this.summaryElement.textContent = `${sourceLabel} — ${i18n.t('opening.summary', { count: result.cards.length })}`;
  }

  /**
   * Opens the card detail modal (image, name, rarity) from the summary grid.
   *
   * @param {number} index - Index of the card in the current pack.
   * @returns {void}
   */
  openCardModal(index) {
    const component = this.cardComponents[index];
    if (!component || !this.cardModal || !this.cardModalTitle || !this.cardModalBody) return;
    const card = component.card;
    const lang = i18n.getLang();
    const name = card.getName(lang);
    this.cardModalTitle.textContent = name;
    this.cardModalBody.textContent = '';

    const image = document.createElement('img');
    image.className = 'card-modal__image';
    image.src = i18n.resolveImagePath(card.illustration);
    image.alt = `${name} — ${getRarityLabel(card.rarity, (key) => i18n.t(key))}`;
    image.addEventListener('error', () => {
      console.warn(`[OpeningView] Detail illustration not found for "${card.uniqueKey}": ${image.src}`);
      image.hidden = true;
    });

    const list = document.createElement('dl');
    list.className = 'card-modal__details';
    const statusLabel = component.isNew
      ? i18n.t('opening.card.statusNew')
      : i18n.t('opening.card.statusOwned');
    const rows = [
      [i18n.t('opening.card.count', { current: index + 1, total: this.cardComponents.length }), statusLabel],
      [i18n.t('opening.card.name'), name],
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

    this.cardModalBody.appendChild(image);
    this.cardModalBody.appendChild(list);
    this.cardModal.hidden = false;
    this.log(`Card detail opened for "${card.uniqueKey}".`);
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
    if (this.sourceModal && !this.sourceModal.hidden) {
      if (event.key === 'Escape') {
        this.closeSourceModal();
      }
      return;
    }
    if (this.cardModal && !this.cardModal.hidden) {
      if (event.key === 'Escape') {
        this.closeCardModal();
      }
      return;
    }
    if (this.revealStage !== 'spotlight' || this.sceneStage.hidden) return;
    const target = event.target;
    const isFormControl = target instanceof HTMLElement
      && (target.closest('button, input, select, textarea, [contenteditable="true"]') !== null);
    if (isFormControl) return;
    if (event.key === 'ArrowLeft') {
      this.showPreviousCard();
    } else if (event.key === 'ArrowRight' || event.key === ' ') {
      event.preventDefault();
      this.handleNextAction();
    } else if (event.key === 'Escape') {
      this.finish();
    }
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
   * Closes the scene and goes back to the extension picker. Performs NO write: the pack was
   * already persisted by `openBooster()` before the animation.
   *
   * @returns {void}
   */
  finish() {
    this.log('Finishing the reveal (no write, the pack was already persisted).');
    this.announceRevealFinished();
    this.closeSourceModal();
    this.cancelIdleDispose();
    this.disposeRenderer();
    this.isFallbackMode = false;
    this.clearReveal();
    this.pendingResult = null;
    this.setFeedback(null);
    this.showStage('select');
    this.showSceneSubStage('booster');
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
    this.clearBurst();
    this.clearSpotlightEntryGuard();
    this.cardComponents.forEach((component) => component.destroy());
    this.cardComponents = [];
    this.spotlightIndex = 0;
    this.revealStage = 'idle';
    this.touchStart = null;
    this.suppressNextSpotlightClick = false;
    if (this.spotlightStage) this.spotlightStage.textContent = '';
    if (this.summaryGrid) {
      this.summaryGrid.textContent = '';
      this.summaryGrid.hidden = true;
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
   * Called by `app.js` when the opening view becomes active.
   *
   * @returns {void}
   */
  handleViewActivated() {
    this.isActive = true;
    this.cancelIdleDispose();
    this.log('View activated.');
    this.refreshQuota();
    // The balance may have moved while the collection view was open (a card sold or bought).
    void this.refreshSparksBalance();
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
    this.log('View deactivated, stopping the render loop.');
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

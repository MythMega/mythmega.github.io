/**
 * OpeningView - Booster opening screen (choice of the extension, 3D scene, card reveal).
 *
 * Reference: `.docs/steps/4.md` points 1, 2 and 4.
 *
 * FLOW
 *   1. "select" stage: the extension picker, the remaining quota and the open button (disabled
 *      with the countdown to the next reset when nothing is left);
 *   2. pressing the button calls `BoosterManager.openBooster()`: the pack is DRAWN AND PERSISTED
 *      before anything is animated, so closing the tab during the reveal loses nothing;
 *   3. "scene" stage: the 3D booster is prepared (or the 2D fallback when WebGL/Three.js is
 *      unavailable); the player rotates it, then a tap or an upward swipe tears it open;
 *   4. spotlight: one big face-down card at a time; tap (or swipe left) to reveal it, then
 *      swipe left / tap / "Next" to move to the following card WITHOUT flipping it face down
 *      again ("Skip" jumps ahead keeping the card hidden, "Previous" goes back);
 *   5. summary: the 5 cards in a grid; tapping one opens the card detail modal (image, name,
 *      rarity); "Finish" performs NO write, it only closes the scene.
 *
 * The view is instantiated once by `app.js` and driven through `handleViewActivated()` /
 * `handleViewDeactivated()` (from `VIEW_CHANGED`), so the WebGL loop never runs in the background.
 */

import eventBus, { EVENTS } from '../../utils/EventBus.js';
import i18n from '../../utils/I18n.js';
import { configLoader } from '../../utils/ConfigLoader.js';
import boosterManager from '../../business/BoosterManager.js';
import dateSyncManager from '../../business/DateSyncManager.js';
import CardComponent from '../components/CardComponent.js';
import Booster3DRenderer, { DEFAULT_MODEL_PATH } from '../components/Booster3DRenderer.js';

/** View name, matching `data-view="opening"` in `index.html`. */
export const OPENING_VIEW_NAME = 'opening';

/** Delay before releasing the WebGL resources of an inactive view, in milliseconds. */
const IDLE_DISPOSE_DELAY_MS = 30000;

/** Minimum horizontal swipe distance on the spotlight card, in pixels. */
const SWIPE_THRESHOLD_PX = 24;

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
    this.feedbackElement = this.root.querySelector('[data-opening-feedback]');

    this.boosterContainer = this.root.querySelector('[data-booster-3d]');
    this.boosterViewport = this.root.querySelector('[data-booster-canvas]');
    this.boosterFallback = this.root.querySelector('[data-booster-fallback]');
    this.boosterLoading = this.root.querySelector('[data-booster-loading]');
    this.boosterHint = this.root.querySelector('[data-booster-hint]');

    this.revealHint = this.root.querySelector('[data-opening-reveal-hint]');
    this.spotlightElement = this.root.querySelector('[data-opening-spotlight]');
    this.spotlightStage = this.root.querySelector('[data-opening-stage-card]');
    this.counterElement = this.root.querySelector('[data-opening-counter]');
    this.prevButton = this.root.querySelector('[data-opening-prev]');
    this.skipButton = this.root.querySelector('[data-opening-skip]');
    this.nextButton = this.root.querySelector('[data-opening-next]');
    this.revealContainer = this.root.querySelector('[data-card-summary]');
    this.summaryGrid = this.root.querySelector('[data-card-summary]');
    this.summaryElement = this.root.querySelector('[data-opening-summary]');
    this.actionsElement = this.root.querySelector('[data-opening-actions]');
    this.revealAllButton = this.root.querySelector('[data-opening-reveal-all]');
    this.finishButton = this.root.querySelector('[data-opening-finish]');
    this.cardModal = this.root.querySelector('[data-card-modal]');
    this.cardModalTitle = this.root.querySelector('[data-card-modal-title]');
    this.cardModalBody = this.root.querySelector('[data-card-modal-body]');
    this.cardModalClose = this.root.querySelector('[data-card-modal-close]');

    this.assertMarkup();

    /** @type {Map<string, object>} Extension descriptions, keyed by id. */
    this.sets = new Map();
    /** @type {string|null} Currently selected extension. */
    this.selectedSetId = null;
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
    /** @type {string|null} Last feedback i18n key (re-translated on `LANG_CHANGED`). */
    this.feedbackKey = null;
    /** @type {'info'|'error'} */
    this.feedbackTone = 'info';
    /** @type {object|null} Last quota snapshot rendered. */
    this.lastQuota = null;

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
      ['[data-opening-spotlight]', this.spotlightElement],
      ['[data-opening-stage-card]', this.spotlightStage],
      ['[data-opening-counter]', this.counterElement],
      ['[data-opening-prev]', this.prevButton],
      ['[data-opening-skip]', this.skipButton],
      ['[data-opening-next]', this.nextButton],
      ['[data-card-summary]', this.summaryGrid],
      ['[data-card-modal]', this.cardModal],
      ['[data-card-modal-title]', this.cardModalTitle],
      ['[data-card-modal-body]', this.cardModalBody],
      ['[data-card-modal-close]', this.cardModalClose],
      ['[data-opening-reveal-all]', this.revealAllButton],
      ['[data-opening-finish]', this.finishButton],
      ['[data-booster-3d]', this.boosterContainer],
      ['[data-booster-fallback]', this.boosterFallback],
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
    const listed = await boosterManager.listBoosterSets();

    this.sets.clear();
    listed.forEach((set) => this.sets.set(set.setId, set));

    this.setSelect.textContent = '';
    listed.forEach((set) => {
      const option = document.createElement('option');
      option.value = set.setId;
      option.textContent = `${set.name} (${set.cardCount})`;
      this.setSelect.appendChild(option);
    });

    this.selectedSetId = listed[0]?.setId ?? null;
    if (this.selectedSetId) {
      this.setSelect.value = this.selectedSetId;
    }
    this.log('Extensions loaded.', { sets: loaded.sets, selected: this.selectedSetId });
  }

  /**
   * Attaches the DOM listeners.
   *
   * @returns {void}
   */
  bindEvents() {
    this.listen(this.setSelect, 'change', () => this.handleSetChange());
    this.listen(this.openButton, 'click', () => this.handleOpenClick());
    this.listen(this.boosterFallback, 'click', (event) => this.handleFallbackClick(event));
    this.listen(this.revealAllButton, 'click', () => this.revealAll());
    this.listen(this.finishButton, 'click', () => this.finish());
    this.listen(this.prevButton, 'click', () => this.showPreviousCard());
    this.listen(this.skipButton, 'click', () => this.showNextCard({ reveal: false }));
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
   * Handles the extension picker change.
   *
   * @returns {void}
   */
  handleSetChange() {
    this.selectedSetId = this.setSelect.value || null;
    this.log(`Extension selected: ${this.selectedSetId}.`);
    this.refreshQuota();
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
      set: this.selectedSetId,
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
   * Re-translates the quota, the feedback and the summary when the language changes.
   *
   * @returns {void}
   */
  handleLanguageChanged() {
    this.log(`Language changed, re-rendering (${i18n.getLang()}).`);
    if (this.feedbackKey) {
      this.setFeedback(this.feedbackKey, this.feedbackTone);
    }
    if (this.pendingResult) {
      this.renderSummary(this.pendingResult);
    } else {
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

  // __OPENING_OPEN__

  /**
   * Handles the open button: draws AND persists the pack, then starts the scene.
   *
   * @returns {Promise<void>} Resolves once the scene is displayed.
   */
  async handleOpenClick() {
    if (this.isBusy || !this.selectedSetId) return;
    this.isBusy = true;
    this.openButton.disabled = true;
    const previousLabel = this.openButton.textContent;
    this.openButton.textContent = i18n.t('opening.opening');
    this.setFeedback(null);
    this.log(`Opening a "${this.selectedSetId}" booster (draw persisted before the animation)…`);

    try {
      const result = await boosterManager.openBooster(this.selectedSetId);
      this.log(`Pack persisted: ${result.cards.length} cards, source "${result.source}".`, {
        newKeys: result.newKeys,
      });
      this.pendingResult = result;
      if (typeof this.onBoosterOpened === 'function') {
        this.onBoosterOpened(result);
      }
      this.showStage('scene');
      this.showSceneSubStage('booster');
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
    this.handleBoosterOpenGesture();
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
    if (!component.isFlipped) {
      this.log(`Spotlight card ${this.spotlightIndex + 1} tapped: revealing.`);
      component.flip();
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
      const rarityLabel = i18n.t('opening.card.rarity', { rarity: component.card.rarity });
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
    image.alt = `${name} — ${i18n.t('opening.card.rarity', { rarity: card.rarity })}`;
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
      [i18n.t('opening.card.rarity', { rarity: card.rarity }), String(card.rarity)],
      [i18n.t('opening.card.set'), card.set],
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
   * Flips every card at once, then jumps to the summary.
   *
   * @returns {void}
   */
  revealAll() {
    this.log('Revealing all the cards.');
    this.cardComponents.forEach((component) => component.flip());
    if (this.revealStage === 'spotlight') {
      this.showSummaryStage();
    }
  }

  /**
   * Closes the scene and goes back to the extension picker. Performs NO write: the pack was
   * already persisted by `openBooster()` before the animation.
   *
   * @returns {void}
   */
  finish() {
    this.log('Finishing the reveal (no write, the pack was already persisted).');
    this.cancelIdleDispose();
    this.disposeRenderer();
    this.isFallbackMode = false;
    this.clearReveal();
    this.pendingResult = null;
    this.setFeedback(null);
    this.showStage('select');
    this.showSceneSubStage('booster');
    this.refreshQuota();
  }

  // __OPENING_LIFECYCLE__

  /**
   * Destroys the displayed cards and hides the reveal block.
   *
   * @returns {void}
   */
  clearReveal() {
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
  }

  /**
   * Called by `app.js` when another view becomes active: stops the render loop.
   *
   * @returns {void}
   */
  handleViewDeactivated() {
    this.isActive = false;
    this.log('View deactivated, stopping the render loop.');
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
    this.clearReveal();
    this.bindings.forEach(({ target, type, handler, options }) => target.removeEventListener(type, handler, options));
    this.bindings = [];
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers = [];
  }
}

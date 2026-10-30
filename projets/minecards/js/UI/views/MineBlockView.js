/**
 * MineBlockView - the Mine screen: one block at a time, its loot, the inventory chest and the
 * wandering trader.
 *
 * The rules, the randomness and the daily allowance live in `MiningManager` (see
 * `settings/mining.json`); this view renders the state it returns and plays the feedback. A tap is
 * one `mine()` call, so a reload resumes the block with the same number of taps landed.
 *
 * The chest is drawn from a 7 x 6 sheet of its 41 source frames
 * (`assets/img/chest-sprite.webp`): frame 1 at rest, 1-21 on opening, 22-41 on closing, then frame
 * 1 again. The trader dialog is fed by `TraderManager`.
 */

import eventBus, { EVENTS } from '../../utils/EventBus.js';
import i18n from '../../utils/I18n.js';
import miningManager, { getMiningErrorMessageKey } from '../../business/MiningManager.js';
import traderManager, { getTraderErrorMessageKey } from '../../business/TraderManager.js';
import dateSyncManager from '../../business/DateSyncManager.js';
import soundManager, { RARITY_SOUNDS } from '../../utils/SoundManager.js';
import Toast from '../components/Toast.js';
import infoHint from '../components/InfoHint.js';
import { getRarityLabel } from '../../classes/Card.js';
import { attachCardTilt } from '../../utils/CardTilt.js';

/** View name, matching `data-view="mineblock"` in `index.html`. */
export const MINE_BLOCK_VIEW_NAME = 'mineblock';

/**
 * Delay before the next block lands, in milliseconds.
 *
 * Only a fallback: the real value is `mining.nextBlockDelayMs` of `settings/config.json`, so the
 * pace of the mine is tuned there, next to the daily allowance of blocks.
 */
export const DEFAULT_NEXT_BLOCK_DELAY_MS = 100;

/**
 * Beat of the automatic mining while Shift+Space is held, in milliseconds.
 *
 * Only a fallback: the real value is `mining.keyHoldIntervalMs` of `settings/config.json`.
 */
export const DEFAULT_KEY_HOLD_INTERVAL_MS = 250;

/** Animated webp of the chest, kept as the fallback when the sprite cannot be decoded. */
export const CHEST_TEXTURE = 'assets/img/chest.webp';

/** The 41 frames of the chest, packed into one sheet (7 columns of 150 px, 6 rows). */
export const CHEST_SPRITE = 'assets/img/chest-sprite.webp';

/** Size of one frame in the sprite, in pixels (the source webp is 150 × 150). */
const CHEST_FRAME_SIZE = 150;

/** Number of frames per row in the sprite. */
const CHEST_SPRITE_COLUMNS = 7;

/** Total number of frames in the sprite. */
const CHEST_FRAME_COUNT = 41;

/** Duration of one chest frame, in milliseconds (the source plays all 41 in 1600 ms). */
const CHEST_FRAME_MS = 40;

/** Frames of the opening segment (1 to 21 of the source animation, 0-based here). */
const CHEST_OPEN_FIRST = 0;
const CHEST_OPEN_LAST = 20;

/** Frames of the closing segment (22 to 41 of the source animation, 0-based here). */
const CHEST_CLOSE_FIRST = 35;
const CHEST_CLOSE_LAST = 40;

/** Lifetime of one flying reward, in milliseconds (must cover the stylesheet animation). */
const BURST_LIFETIME_MS = 1100;

/**
 * Duration of the landing of the next block, in milliseconds.
 *
 * It MUST stay equal to `mineblock-arrive` of `css/views/mineblock.css`: the class only lives for
 * the length of the animation, and taking it off early would cut the landing of the block.
 */
const ARRIVE_ANIMATION_MS = 160;

/** Duration of the flinch under a tap that did not break the block (see `mineblock-hit`). */
const HIT_ANIMATION_MS = 180;

/** Duration of the chest shake that greets a broken block (see `mineblock-chest-shake`). */
const CHEST_SHAKE_MS = 460;

/** Highest number of flying elements for one reward (a safety net for an edited configuration). */
const BURST_MAX_ITEMS = 24;

/** Distance range of a flying reward, in pixels. */
const BURST_MIN_DISTANCE = 70;
const BURST_MAX_DISTANCE = 170;

export class MineBlockView {
  /**
   * @param {HTMLElement} rootElement - The mine `<section>` (`[data-view="mineblock"]`).
   */
  constructor(rootElement) {
    if (!rootElement || typeof rootElement.querySelector !== 'function') {
      throw new TypeError('MineBlockView requires the mine section element.');
    }

    this.root = rootElement;
    this.feedbackElement = this.root.querySelector('[data-mineblock-feedback]');
    this.nameElement = this.root.querySelector('[data-mineblock-name]');
    this.remainingElement = this.root.querySelector('[data-mineblock-remaining]');
    this.countdownElement = this.root.querySelector('[data-mineblock-countdown]');
    this.countdownValue = this.root.querySelector('[data-mineblock-countdown-value]');
    this.rockElement = this.root.querySelector('[data-mineblock-rock]');
    this.textureImage = this.root.querySelector('[data-mineblock-texture]');
    this.crackImage = this.root.querySelector('[data-mineblock-crack]');
    this.burstElement = this.root.querySelector('[data-mineblock-burst]');
    this.hintElement = this.root.querySelector('[data-mineblock-hint]');
    this.emptyElement = this.root.querySelector('[data-mineblock-empty]');
    this.resourcesElement = this.root.querySelector('[data-mineblock-resources]');
    this.inventoryButton = this.root.querySelector('[data-mineblock-inventory]');
    this.inventoryIcon = this.root.querySelector('[data-mineblock-inventory-icon]');
    this.inventoryModal = this.root.querySelector('[data-mineblock-inventory-modal]');
    this.inventoryClose = this.root.querySelector('[data-mineblock-inventory-close]');
    this.inventoryDismiss = this.root.querySelector('[data-mineblock-inventory-dismiss]');
    this.inventoryList = this.root.querySelector('[data-mineblock-inventory-list]');
    this.inventoryEmpty = this.root.querySelector('[data-mineblock-inventory-empty]');
    this.traderButton = this.root.querySelector('[data-mineblock-trader]');
    this.traderModal = this.root.querySelector('[data-mineblock-trader-modal]');
    this.traderClose = this.root.querySelector('[data-mineblock-trader-close]');
    this.traderDismiss = this.root.querySelector('[data-mineblock-trader-dismiss]');
    this.traderWeek = this.root.querySelector('[data-mineblock-trader-week]');
    this.traderRestockRow = this.root.querySelector('[data-mineblock-trader-restock-row]');
    this.traderRestock = this.root.querySelector('[data-mineblock-trader-restock]');
    this.traderList = this.root.querySelector('[data-mineblock-trader-list]');
    this.traderEmpty = this.root.querySelector('[data-mineblock-trader-empty]');
    this.traderFeedback = this.root.querySelector('[data-mineblock-trader-feedback]');
    this.tradeList = this.root.querySelector('[data-mineblock-trade-list]');
    this.tradeEmpty = this.root.querySelector('[data-mineblock-trade-empty]');
    this.tradeRestockRow = this.root.querySelector('[data-mineblock-trade-restock-row]');
    this.tradeRestock = this.root.querySelector('[data-mineblock-trade-restock]');
    this.sparkOfferElement = this.root.querySelector('[data-mineblock-spark-offer]');
    this.sparkBody = this.root.querySelector('[data-mineblock-spark-body]');
    this.sparkRestockRow = this.root.querySelector('[data-mineblock-spark-restock-row]');
    this.sparkRestock = this.root.querySelector('[data-mineblock-spark-restock]');
    this.offerModal = this.root.querySelector('[data-mineblock-offer-modal]');
    this.offerTitle = this.root.querySelector('[data-mineblock-offer-title]');
    this.offerBody = this.root.querySelector('[data-mineblock-offer-body]');
    this.offerClose = this.root.querySelector('[data-mineblock-offer-close]');
    this.offerDismiss = this.root.querySelector('[data-mineblock-offer-dismiss]');

    this.assertMarkup();

    /** @type {object|null} Last state returned by `MiningManager.getState()`. */
    this.state = null;
    /** @type {Array<{slug: string, type: string, nameKey: string, texture: string}>} Harvested kinds. */
    this.resources = [];
    /** @type {number} Delay before the next block lands, in milliseconds (from the configuration). */
    this.nextBlockDelayMs = DEFAULT_NEXT_BLOCK_DELAY_MS;
    /** @type {number} Beat of the automatic mining while Shift+Space is held, in milliseconds. */
    this.keyHoldIntervalMs = DEFAULT_KEY_HOLD_INTERVAL_MS;
    /** @type {number|null} Interval applying a tap while Shift+Space is held. */
    this.mineHoldTimer = null;
    /** @type {HTMLImageElement|null} Decoded sprite of the chest (`null` until it is ready). */
    this.chestSprite = null;
    /** @type {number} Frame currently drawn on the chest canvas. */
    this.chestFrame = 0;
    /** @type {number|null} Pending animation frame of the chest. */
    this.chestAnimation = null;
    /** @type {{modal: HTMLElement, trigger: HTMLElement}|null} Dialog currently open. */
    this.openDialog = null;
    /** @type {{week: string|null, allItemsUniques: boolean, offers: Array<object>,
     *   resources: Record<string, number>}|null} Last shop read from `TraderManager`. */
    this.traderState = null;
    /** @type {boolean} True while a purchase is being committed (guards double taps). */
    this.isBuying = false;
    /**
     * @type {{modal: HTMLElement, trigger: HTMLElement}|null} Detail of an offer stacked on top of
     *   the shop. It is kept apart from `openDialog` on purpose: the shop stays open behind it, so
     *   a player who wanted the details of a card never loses the list they were reading.
     */
    this.offerDialog = null;
    /** @type {string|null} Key of the offer the detail dialog shows. */
    this.offerDetailKey = null;
    /** @type {boolean} True while a daily trade is being taken (one at a time). */
    this.isTrading = false;
    /** @type {boolean} True while the daily Sparks offer is being bought. */
    this.isBuyingSpark = false;
    /**
     * @type {Array<{element: HTMLElement, endMs: number}>} Every countdown of the shop, with the
     *   instant it runs to. Rebuilt on each render and ticked by `CLOCK_TICK`.
     */
    this.traderCountdowns = [];
    /** @type {boolean} True while a tap is being committed (guards double taps). */
    this.isMining = false;
    /** @type {boolean} True while the screen is reading its data. */
    this.isLoading = false;
    /** @type {boolean} True once `init()` bound everything. */
    this.isInitialized = false;
    /** @type {boolean} True when the view is the active one. */
    this.isActive = false;
    /** @type {string|null} Texture currently displayed (avoids re-setting a `src`). */
    this.displayedTexture = null;
    /** @type {string|null} Last feedback message, so a language switch can retranslate it. */
    this.feedback = null;
    /** @type {Set<string>} Sounds already warmed up (a second `load()` would cut a running `play()`). */
    this.prefetchedSounds = new Set();
    /** @type {number[]} Timers of the sequences still in flight. */
    this.timers = [];

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
    console.info('[MineBlockView]', ...args);
  }

  /**
   * Verifies that the markup matches the contract expected by this view.
   *
   * @returns {void}
   * @throws {Error} When a required element is missing from `index.html`.
   */
  assertMarkup() {
    const missing = [
      ['[data-mineblock-feedback]', this.feedbackElement],
      ['[data-mineblock-name]', this.nameElement],
      ['[data-mineblock-remaining]', this.remainingElement],
      ['[data-mineblock-countdown]', this.countdownElement],
      ['[data-mineblock-countdown-value]', this.countdownValue],
      ['[data-mineblock-rock]', this.rockElement],
      ['[data-mineblock-texture]', this.textureImage],
      ['[data-mineblock-crack]', this.crackImage],
      ['[data-mineblock-burst]', this.burstElement],
      ['[data-mineblock-hint]', this.hintElement],
      ['[data-mineblock-empty]', this.emptyElement],
      ['[data-mineblock-resources]', this.resourcesElement],
      ['[data-mineblock-inventory]', this.inventoryButton],
      ['[data-mineblock-inventory-icon]', this.inventoryIcon],
      ['[data-mineblock-inventory-modal]', this.inventoryModal],
      ['[data-mineblock-inventory-close]', this.inventoryClose],
      ['[data-mineblock-inventory-dismiss]', this.inventoryDismiss],
      ['[data-mineblock-inventory-list]', this.inventoryList],
      ['[data-mineblock-inventory-empty]', this.inventoryEmpty],
      ['[data-mineblock-trader]', this.traderButton],
      ['[data-mineblock-trader-modal]', this.traderModal],
      ['[data-mineblock-trader-close]', this.traderClose],
      ['[data-mineblock-trader-dismiss]', this.traderDismiss],
      ['[data-mineblock-trader-week]', this.traderWeek],
      ['[data-mineblock-trader-restock]', this.traderRestock],
      ['[data-mineblock-trader-list]', this.traderList],
      ['[data-mineblock-trader-empty]', this.traderEmpty],
      ['[data-mineblock-trader-feedback]', this.traderFeedback],
      ['[data-mineblock-trade-list]', this.tradeList],
      ['[data-mineblock-trade-empty]', this.tradeEmpty],
      ['[data-mineblock-trade-restock]', this.tradeRestock],
      ['[data-mineblock-spark-offer]', this.sparkOfferElement],
      ['[data-mineblock-spark-body]', this.sparkBody],
      ['[data-mineblock-spark-restock]', this.sparkRestock],
      ['[data-mineblock-offer-modal]', this.offerModal],
      ['[data-mineblock-offer-title]', this.offerTitle],
      ['[data-mineblock-offer-body]', this.offerBody],
      ['[data-mineblock-offer-close]', this.offerClose],
      ['[data-mineblock-offer-dismiss]', this.offerDismiss],
    ]
      .filter(([, element]) => !element)
      .map(([selector]) => selector);

    if (missing.length > 0) {
      throw new Error(`MineBlockView markup is incomplete, missing: ${missing.join(', ')}.`);
    }
  }

  /**
   * Binds the interactions, subscribes to the events and draws the mine.
   *
   * @returns {Promise<void>} Resolves once the screen is displayed.
   * @throws {Error} When the mine rules or the state cannot be read.
   */
  async init() {
    if (this.isInitialized) return;
    this.isInitialized = true;
    this.log('Initializing…');
    this.bindEvents();
    this.subscribeToEvents();
    try {
      this.resources = await miningManager.listResources();
      // The pace of the mine is a setting of `settings/config.json` (`mining.nextBlockDelayMs`).
      if (Number.isFinite(miningManager.settings?.nextBlockDelayMs)) {
        this.nextBlockDelayMs = miningManager.settings.nextBlockDelayMs;
      }
      // The beat of the held Shift+Space (`mining.keyHoldIntervalMs`): no faster than 100 ms, so an
      // edited configuration can never turn the mine into an infinite tap loop.
      if (Number.isFinite(miningManager.settings?.keyHoldIntervalMs)) {
        this.keyHoldIntervalMs = Math.max(100, miningManager.settings.keyHoldIntervalMs);
      }
    } catch (error) {
      console.error('[MineBlockView] The resources of the mine could not be listed.', error);
      this.resources = [];
    }
    void this.loadChest();
    await this.reload();
    this.log('Ready.');
  }

  /**
   * Registers a listener and remembers it for `destroy()`.
   *
   * @param {EventTarget} target - Event target.
   * @param {string} type - Event type.
   * @param {EventListener} handler - Listener.
   * @returns {void}
   */
  listen(target, type, handler) {
    target.addEventListener(type, handler);
    this.bindings.push({ target, type, handler });
  }

  /**
   * Attaches the DOM listeners (the block and the two dialogs).
   *
   * @returns {void}
   */
  bindEvents() {
    this.listen(this.rockElement, 'click', () => void this.handleMine());

    // The chest plays its opening frames from `openModal`, where the dialog really is displayed:
    // one click, one gesture, and the same path for a dialog opened by any other caller.
    this.listen(this.inventoryButton, 'click', () => {
      this.openModal(this.inventoryModal, this.inventoryButton);
    });
    this.listen(this.inventoryClose, 'click', () => this.closeModal(this.inventoryModal));
    this.listen(this.inventoryDismiss, 'click', () => this.closeModal(this.inventoryModal));
    this.listen(this.inventoryModal, 'click', (event) => {
      if (event.target === this.inventoryModal) this.closeModal(this.inventoryModal);
    });

    this.listen(this.traderButton, 'click', () => this.openModal(this.traderModal, this.traderButton));
    // One listener for the whole shop: the offers are rebuilt on every purchase, so a listener per
    // button would have to be undone each time (the view reads the key from the button itself).
    this.listen(this.traderList, 'click', (event) => {
      if (!(event.target instanceof Element)) return;
      const buy = event.target.closest('[data-offer-buy]');
      if (buy instanceof HTMLElement) {
        void this.buyOffer(buy.dataset.offerBuy);
        return;
      }
      // The picture of an offer opens the card itself: the shop only shows a thumbnail of it.
      const open = event.target.closest('[data-offer-open]');
      if (open instanceof HTMLElement) this.openOfferDetail(open.dataset.offerOpen, open);
    });
    // One listener for the trades too, for the same reason: the list is rebuilt at every exchange.
    this.listen(this.tradeList, 'click', (event) => {
      const action = event.target.closest('[data-trade-from]');
      if (action instanceof HTMLElement) {
        void this.swapTrade(action.dataset.tradeKey, action.dataset.tradeFrom);
      }
    });
    // The daily Sparks offer is rebuilt with every render: one delegated listener owns its button.
    this.listen(this.sparkBody, 'click', (event) => {
      const buy = event.target.closest('[data-spark-buy]');
      if (buy instanceof HTMLElement) void this.buySparkOffer();
    });
    this.listen(this.traderClose, 'click', () => this.closeModal(this.traderModal));
    this.listen(this.traderDismiss, 'click', () => this.closeModal(this.traderModal));
    // The backdrop closes a dialog: a tap outside is never a dead end.
    this.listen(this.traderModal, 'click', (event) => {
      if (event.target === this.traderModal) this.closeModal(this.traderModal);
    });

    // The offer detail is opened from the shop and stays on top of it.
    this.listen(this.offerClose, 'click', () => this.closeOfferDetail());
    this.listen(this.offerDismiss, 'click', () => this.closeOfferDetail());
    this.listen(this.offerModal, 'click', (event) => {
      if (event.target === this.offerModal) this.closeOfferDetail();
    });

    this.listen(document, 'keydown', (event) => this.handleDocumentKeyDown(event));
    this.listen(document, 'keyup', (event) => this.handleDocumentKeyUp(event));
    // A window that loses the focus never sends the keyup of a held Space.
    this.listen(window, 'blur', () => this.stopMineHold());
    this.log('DOM listeners bound.');
  }

  /**
   * Handles the keyboard of the mine: Space applies one tap, holding Shift+Space mines on a beat,
   * `S` opens the Wandering Trader, Escape closes the topmost dialog.
   *
   * A key is ignored while a dialog is open or while the focus sits on a control (a focused button
   * already reacts to Space by itself).
   *
   * @param {KeyboardEvent} event - Key event.
   * @returns {void}
   */
  handleDocumentKeyDown(event) {
    if (!event || typeof event.key !== 'string') return;
    if (event.key === 'Escape') {
      this.stopMineHold();
      // The detail is the topmost dialog: Escape closes it before the shop behind it.
      if (this.offerDialog) this.closeOfferDetail();
      else this.closeModal();
      return;
    }
    if (!this.isActive || !this.state?.block) return;
    if (this.openDialog || this.offerDialog) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    if (event.key === ' ') {
      // A focused button (the chest, the trader…) already answers Space by itself: only the rock
      // is mined. The rock itself is a button too, so its default activation is cancelled below
      // to avoid landing the same tap twice (keydown here, click on keyup).
      const target = event.target;
      const onOtherControl = target instanceof HTMLElement
        && target.closest('button, a, input, textarea, select, [contenteditable="true"]') !== null
        && target.closest('[data-mineblock-rock]') === null;
      if (onOtherControl) return;
      event.preventDefault();
      if (event.shiftKey) {
        // Hold to mine: the first tap lands immediately, then every `keyHoldIntervalMs`.
        if (!event.repeat) this.startMineHold();
        return;
      }
      this.stopMineHold();
      if (!event.repeat) void this.handleMine();
      return;
    }

    if (event.key.toLowerCase() !== 's' || event.shiftKey) return;
    const target = event.target;
    // A button that still holds the focus (the rock, the chest) is not a reason to swallow `S`:
    // only a text field owns its letters.
    if (target instanceof HTMLElement
      && target.closest('input, textarea, select, [contenteditable="true"]')) {
      return;
    }
    event.preventDefault();
    this.openModal(this.traderModal, this.traderButton);
  }

  /**
   * Stops the automatic mining when Space comes back up.
   *
   * @param {KeyboardEvent} event - Key event.
   * @returns {void}
   */
  handleDocumentKeyUp(event) {
    if (event?.key === ' ') this.stopMineHold();
  }

  /**
   * Applies one tap immediately, then keeps tapping while Shift+Space is held.
   *
   * @returns {void}
   */
  startMineHold() {
    this.stopMineHold();
    void this.handleMine();
    this.mineHoldTimer = window.setInterval(() => {
      if (!this.isActive || !this.state?.block || this.openDialog || this.offerDialog) {
        this.stopMineHold();
        return;
      }
      void this.handleMine();
    }, this.keyHoldIntervalMs);
    this.log(`Shift+Space held: a tap every ${this.keyHoldIntervalMs} ms.`);
  }

  /**
   * Stops the automatic mining.
   *
   * @returns {void}
   */
  stopMineHold() {
    if (this.mineHoldTimer === null) return;
    window.clearInterval(this.mineHoldTimer);
    this.mineHoldTimer = null;
    this.log('Automatic mining stopped.');
  }

  /**
   * Subscribes to the application events the view depends on.
   *
   * @returns {void}
   */
  subscribeToEvents() {
    this.unsubscribers.push(
      eventBus.on(EVENTS.VIEW_CHANGED, (payload) => {
        if (!payload || typeof payload.view !== 'string') return;
        if (payload.view === MINE_BLOCK_VIEW_NAME) {
          this.handleViewActivated();
        } else if (payload.previousView === MINE_BLOCK_VIEW_NAME) {
          this.handleViewDeactivated();
        }
      })
    );
    this.unsubscribers.push(
      eventBus.on(EVENTS.LANG_CHANGED, () => this.handleLanguageChanged())
    );
    this.unsubscribers.push(eventBus.on(EVENTS.CLOCK_TICK, (payload) => this.handleClockTick(payload)));
    this.unsubscribers.push(
      eventBus.on(EVENTS.MINING_UPDATED, () => {
        // The tap that is being committed already rendered its own result (`handleMine`), and
        // reloading here would swap the block BEFORE the loot has finished flying out of the one
        // that just broke: the view only follows the updates it did not cause itself.
        if (this.isActive && !this.isMining) {
          void this.reload().catch((error) => {
            console.warn('[MineBlockView] The mine could not be refreshed.', error);
          });
        }
      })
    );
    // The shop repaints from the trader's own event: a purchase changes the stock and the resources
    // long before the dialog is closed, so the screen can never show an offer that is already gone.
    this.unsubscribers.push(
      eventBus.on(EVENTS.TRADER_UPDATED, () => {
        if (this.openDialog?.modal === this.traderModal) {
          void this.renderTrader().catch((error) => {
            console.warn('[MineBlockView] The shop could not be refreshed.', error);
          });
        }
      })
    );
    // An imported save carries ANOTHER uuid, and therefore another order of the day — and another
    // shop, since its purchases are part of the save.
    this.unsubscribers.push(
      eventBus.on(EVENTS.SAVE_IMPORTED, () => {
        traderManager.resetOffers();
        void miningManager
          .init({ force: true })
          .then(() => this.reload())
          .catch((error) => console.warn('[MineBlockView] The mine rules could not be reloaded.', error));
      })
    );
    this.log('Event subscriptions registered.');
  }

  /**
   * Reads the state, then renders the screen.
   *
   * The Sparks balance is deliberately NOT read: the mine shows the resources it harvests, and the
   * currency has its own counter in the header (and its own toasts when a block yields some).
   *
   * @returns {Promise<void>} Resolves once the screen is rendered (or the error shown).
   */
  async reload() {
    if (this.isLoading) return;
    this.isLoading = true;
    this.setFeedback(null);
    try {
      this.state = await miningManager.getState({ lang: i18n.getLang() });
      this.render();
    } catch (error) {
      console.error('[MineBlockView] The mine could not be loaded.', error);
      this.setFeedback(getMiningErrorMessageKey(error?.code), 'error');
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Renders the whole screen from the last state.
   *
   * @returns {void}
   */
  render() {
    if (!this.state) return;
    this.renderQuota(this.state);
    this.renderBlock(this.state);
    this.renderResources();
  }

  /**
   * Writes the name of the block, the blocks left today and the countdown to the next reset.
   *
   * @param {object} state - State returned by `MiningManager.getState()`.
   * @returns {void}
   */
  renderQuota(state) {
    this.remainingElement.textContent = i18n.t('mineblock.remaining', {
      remaining: state.remaining,
      total: state.blocksPerDay,
    });

    const exhausted = state.remaining <= 0;
    this.countdownElement.hidden = !exhausted;
    if (exhausted) {
      this.countdownValue.textContent = dateSyncManager.getFormattedTimeUntilReset();
    }
  }

  /**
   * Writes the block of the moment: its name, its picture, its crack and the hint under it.
   *
   * @param {object} state - State returned by `MiningManager.getState()`.
   * @returns {void}
   */
  renderBlock(state) {
    const block = state.block;
    this.root.classList.toggle('is-exhausted', !block);
    this.emptyElement.hidden = Boolean(block);

    if (!block) {
      this.nameElement.textContent = '';
      this.textureImage.hidden = true;
      this.crackImage.hidden = true;
      this.displayedTexture = null;
      this.rockElement.disabled = true;
      this.rockElement.removeAttribute('aria-label');
      // "Every block is mined" and "the mine has no rule at all" are two very different situations:
      // a broken `settings/mining.json` must be reported as a failure, not as a day well spent.
      this.hintElement.textContent =
        miningManager.blocks.length === 0
          ? i18n.t('mineblock.error.load')
          : i18n.t('mineblock.hint.limit');
      return;
    }

    this.rockElement.disabled = false;
    this.rockElement.setAttribute('aria-label', i18n.t('mineblock.rock.aria', { name: block.name }));
    this.nameElement.textContent = block.name;
    this.emptyElement.hidden = true;

    if (this.displayedTexture !== block.texture) {
      this.displayedTexture = block.texture;
      this.textureImage.src = block.texture;
    }
    this.textureImage.hidden = false;
    this.textureImage.alt = '';
    this.renderCrack(state.progress);
    // The hint never counts the taps left: the crack under the player's finger already says how
    // close the block is, and a number next to it turned the ritual into a progress report.
    this.hintElement.textContent = i18n.t('mineblock.hint');

    this.prefetchSounds(block);
  }

  /**
   * Lays the crack texture matching a break percentage over the block.
   *
   * @param {number} percent - Break percentage (0-100).
   * @returns {void}
   */
  renderCrack(percent) {
    const texture = miningManager.getCrackTexture(percent);
    if (!texture) {
      this.crackImage.hidden = true;
      return;
    }
    if (this.crackImage.getAttribute('src') !== texture) {
      this.crackImage.src = texture;
    }
    this.crackImage.hidden = false;
  }

  /**
   * Displays the quantity of every resource of the mine: its picture, then its count.
   *
   * The chips are declared by `settings/mining.json` (the union of the rewards of the five blocks),
   * so adding a resource there is enough to see it here. A resource never harvested yet shows `0`
   * rather than disappearing, which is what makes the row readable as a stock.
   *
   * The NAME is not written on screen (the icon says it, and the inventory spells it out): it only
   * lives in the accessible text of the chip, so a screen reader still reads "12 Poussière de
   * pierre" instead of a lone number. The Sparks are not listed either - they are the currency, and
   * the header already counts them.
   *
   * @returns {void}
   */
  renderResources() {
    this.resourcesElement.textContent = '';
    const counts = this.state?.resources ?? {};

    this.resources.forEach((resource) => {
      this.resourcesElement.appendChild(
        this.buildResourceEntry(resource, counts[resource.slug] ?? 0, 'mineblock__resource')
      );
    });
  }

  /**
   * Builds one resource entry (picture, count, accessible name).
   *
   * Shared by the row under the block and the inventory dialog: both show the same thing, and only
   * the class and the way the name is written differ.
   *
   * @param {{slug: string, type?: string, nameKey?: string, texture: string}} resource - Resource.
   * @param {number} count - Quantity to display.
   * @param {string} className - Class of the built element.
   * @returns {HTMLElement} The `<li>` of the resource.
   */
  buildResourceEntry(resource, count, className) {
    const label = this.resolveResourceLabel(resource);

    const item = document.createElement('li');
    item.className = className;
    item.dataset.resource = resource.slug;

    const icon = document.createElement('img');
    icon.className = `${className}-icon`;
    icon.src = resource.texture;
    icon.alt = '';
    icon.decoding = 'async';
    // A resource whose picture was not shipped still shows its count: the entry never breaks.
    icon.addEventListener('error', () => {
      icon.hidden = true;
    });

    const value = document.createElement('span');
    value.className = `${className}-value`;
    value.textContent = String(count);

    // The name of the resource is the accessible text of the entry, in the order it is read.
    const accessible = document.createElement('span');
    accessible.className = 'sr-only';
    accessible.textContent = label;

    // Visually: the icon, then the count. For a screen reader: the count, then the name.
    item.append(icon, value, accessible);
    return item;
  }

  /**
   * Label of a resource: its translation, falling back to the raw type of the configuration.
   *
   * @param {{nameKey?: string, type?: string}} resource - Resource chip or reward.
   * @returns {string} The player-facing label.
   */
  resolveResourceLabel(resource) {
    const key = resource.nameKey;
    if (!key) return resource.type ?? '';
    const translated = i18n.t(key);
    return translated === key ? resource.type ?? translated : translated;
  }

  /**
   * Lands one tap on the block.
   *
   * The commit happens first (`MiningManager.mine()`), the feedback follows: a refused tap (every
   * block of the day already mined) is reported without touching the screen.
   *
   * @returns {Promise<void>} Resolves once the tap was applied (or the refusal reported).
   */
  async handleMine() {
    if (this.isMining || !this.state?.block) return;
    const block = this.state.block;
    this.isMining = true;
    this.setFeedback(null);

    try {
      const result = await miningManager.mine({ lang: i18n.getLang() });
      soundManager.play(result.broke ? block.sounds.break : block.sounds.mine);

      // A broken block reports its own full hardness and 100 %, but `block` is now the NEXT one,
      // untouched: keeping either would lay the last crack texture of the block that just
      // disappeared over the new block that just landed.
      this.state = {
        ...this.state,
        clicks: result.broke ? 0 : result.clicks,
        progress: result.broke ? 0 : result.percent,
        remaining: result.remaining,
        minedToday: result.minedToday,
        block: result.broke ? result.nextBlock : this.state.block,
        resources: result.resources,
        blocksMined: result.blocksMined,
        totalMined: result.totalMined,
        sparksFound: result.sparksFound,
      };
      this.renderQuota(this.state);

      if (result.broke) {
        this.animateBreak(result);
      } else {
        this.pulseRock();
        this.renderCrack(result.percent);
      }
    } catch (error) {
      console.error('[MineBlockView] The block could not be mined.', error);
      this.setFeedback(getMiningErrorMessageKey(error?.code), 'error');
      void this.reload();
    } finally {
      this.isMining = false;
    }
  }

  /**
   * Plays the breaking sequence: the rock shrinks, the loot flies out, the next one lands.
   *
   * The swap is DELAYED on purpose - but only just: the block that was broken disappears a moment
   * before its replacement drops in, so the picture stays readable while the loot is still flying
   * out of it (the burst has a life of its own, it is not cut by the swap). The delay is
   * `mining.nextBlockDelayMs` of `settings/config.json`. The state is already up to date, so nothing
   * depends on those milliseconds except the picture - a player who leaves the screen mid-sequence
   * loses nothing.
   *
   * @param {object} result - Result returned by `MiningManager.mine()`.
   * @returns {void}
   */
  animateBreak(result) {
    this.rockElement.classList.add('is-broken');
    this.burstRewards(result.rewards);
    this.announceRewards(result.rewards);
    this.renderResources();
    this.shakeChest();

    this.setViewTimeout(() => {
      this.rockElement?.classList.remove('is-broken');
      if (!this.state) return;
      this.renderBlock(this.state);
      if (this.state.block) {
        this.rockElement.classList.add('is-arriving');
        this.setViewTimeout(
          () => this.rockElement?.classList.remove('is-arriving'),
          ARRIVE_ANIMATION_MS
        );
      }
    }, this.nextBlockDelayMs);
  }

  /**
   * Makes the chest shake when a block breaks: the loot is on its way in.
   *
   * @returns {void}
   */
  shakeChest() {
    if (!this.inventoryButton) return;
    this.inventoryButton.classList.remove('is-shaking');
    // Reading `offsetWidth` restarts the animation when two blocks break in a row.
    void this.inventoryButton.offsetWidth;
    this.inventoryButton.classList.add('is-shaking');
    this.setViewTimeout(
      () => this.inventoryButton?.classList.remove('is-shaking'),
      CHEST_SHAKE_MS
    );
  }

  /**
   * Makes the rock flinch under a tap that did not break it.
   *
   * @returns {void}
   */
  pulseRock() {
    this.rockElement.classList.remove('is-hit');
    // Reading `offsetWidth` restarts the animation of a repeated tap instead of ignoring it.
    void this.rockElement.offsetWidth;
    this.rockElement.classList.add('is-hit');
    this.setViewTimeout(() => this.rockElement?.classList.remove('is-hit'), HIT_ANIMATION_MS);
  }

  /**
   * Spits one flying element per unit obtained, each in its own direction.
   *
   * Four Sparks give four Sparks flying away, one dust gives one dust: the number of elements is
   * the number obtained, and the direction, the distance, the delay and the spin are drawn at
   * random so two bursts never look alike.
   *
   * @param {Array<{kind: string, slug: string, amount: number, texture: string}>} rewards - Rewards
   *   of the broken block.
   * @returns {void}
   */
  burstRewards(rewards) {
    if (!this.burstElement) return;

    rewards.forEach((reward) => {
      const count = Math.min(Math.max(1, Math.trunc(reward.amount)), BURST_MAX_ITEMS);
      for (let index = 0; index < count; index += 1) {
        const angle = Math.random() * Math.PI * 2;
        const distance = BURST_MIN_DISTANCE + Math.random() * (BURST_MAX_DISTANCE - BURST_MIN_DISTANCE);

        const element = document.createElement('img');
        element.className = 'mineblock__burst-item';
        element.dataset.kind = reward.kind;
        element.src = reward.texture;
        element.alt = '';
        element.decoding = 'async';
        element.style.setProperty('--burst-x', `${Math.round(Math.cos(angle) * distance)}px`);
        element.style.setProperty('--burst-y', `${Math.round(Math.sin(angle) * distance)}px`);
        element.style.setProperty('--burst-spin', `${Math.round((Math.random() - 0.5) * 540)}deg`);
        element.style.setProperty('--burst-delay', `${Math.round(Math.random() * 90)}ms`);
        element.addEventListener('error', () => element.remove());

        this.burstElement.appendChild(element);
        window.setTimeout(() => element.remove(), BURST_LIFETIME_MS);
      }
    });
  }

  /**
   * Announces every reward as a notification (`+1 Stone Dust`).
   *
   * @param {Array<{kind: string, amount: number, nameKey: string, type: string}>} rewards - Rewards
   *   of the broken block.
   * @returns {void}
   */
  announceRewards(rewards) {
    rewards.forEach((reward) => {
      const params = { amount: reward.amount, resource: this.resolveResourceLabel(reward) };
      // The Sparks are the currency the header also shows: they get the louder tone.
      const element =
        reward.kind === 'sparks'
          ? Toast.success('mineblock.reward', { params })
          : Toast.info('mineblock.reward', { params });
      if (element) element.dataset.reward = reward.slug;
    });
  }

  /**
   * Loads the two sounds of the displayed block ahead of the first tap.
   *
   * The mining sounds are per block (`assets/sound/blocks/<id>.mine.mp3`) and therefore not part of
   * `SOUNDS` (which is preloaded as a whole at boot): only the block on screen is downloaded, which
   * is what keeps the page from pulling ten files nobody asked for.
   *
   * A path is warmed up ONCE per visit: `load()` on an element that is already playing aborts that
   * playback ("The play() request was interrupted by a new load request"), so warming the same block
   * again on every re-render would silence the very taps it is meant to serve.
   *
   * @param {{sounds: {mine: string, break: string}}} block - Block of the moment.
   * @returns {void}
   */
  prefetchSounds(block) {
    if (!soundManager.isEnabled()) return;
    Object.values(block.sounds).forEach((path) => {
      if (this.prefetchedSounds.has(path)) return;
      this.prefetchedSounds.add(path);
      try {
        soundManager.getElement(path)?.load();
      } catch (error) {
        console.warn(`[MineBlockView] "${path}" could not be preloaded.`, error);
      }
    });
  }

  /**
   * Runs a callback later, remembering the timer so leaving the view cancels it.
   *
   * @param {Function} callback - Callback to run.
   * @param {number} delay - Delay in milliseconds.
   * @returns {number} The timer id.
   */
  setViewTimeout(callback, delay) {
    const timer = window.setTimeout(() => {
      this.timers = this.timers.filter((candidate) => candidate !== timer);
      callback();
    }, delay);
    this.timers.push(timer);
    return timer;
  }

  /**
   * Cancels every sequence still in flight.
   *
   * @returns {void}
   */
  clearTimers() {
    this.timers.forEach((timer) => window.clearTimeout(timer));
    this.timers = [];
  }

  /**
   * Opens a dialog of the view (the inventory or the wandering trader).
   *
   * One dialog at a time: opening one closes the other, so the two can never be stacked. The
   * inventory is rebuilt on every opening - it is a snapshot of the resources, and it is cheap.
   *
   * @param {HTMLElement} modal - The `.modal` element to display.
   * @param {HTMLElement} trigger - The button it belongs to (receives `aria-expanded`).
   * @returns {void}
   */
  openModal(modal, trigger) {
    // One dialog at a time, detail included: opening the shop while a card is being studied would
    // otherwise leave two dialogs fighting for the same backdrop.
    if (this.offerDialog) this.closeOfferDetail();
    if (this.openDialog && this.openDialog.modal !== modal) {
      this.closeModal();
    }
    if (modal === this.inventoryModal) {
      this.renderInventory();
      this.playChestOpening();
    }
    if (modal === this.traderModal) {
      // The shop is read when it is opened, never at boot: a player who never trades with the
      // merchant never downloads his file, and one who does always sees the offers of the moment.
      this.setTraderFeedback(null);
      void this.renderTrader().catch((error) => {
        console.error('[MineBlockView] The shop could not be loaded.', error);
        this.setTraderFeedback(getTraderErrorMessageKey(error?.code), 'error');
      });
    }
    modal.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    this.openDialog = { modal, trigger };
    modal.querySelector('.modal__close')?.focus();
    this.log(`Dialog displayed: ${modal === this.inventoryModal ? 'inventory' : 'wandering trader'}.`);
  }

  /**
   * Closes the open dialog and gives the focus back to the button that opened it.
   *
   * @param {HTMLElement|null} [modal=null] - Only close this one (null closes whatever is open).
   * @returns {void}
   */
  closeModal(modal = null) {
    if (!this.openDialog) return;
    if (modal && this.openDialog.modal !== modal) return;
    const { modal: open, trigger } = this.openDialog;
    const wasInventory = open === this.inventoryModal;
    open.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    this.openDialog = null;
    trigger.focus();
    // The chest closes AFTER the dialog disappears, so its last frame is never hidden behind the
    // backdrop: the closing segment plays on the button the player is looking at.
    if (wasInventory) this.playChestClosing();
  }

  /**
   * Opens the detail of one offer, on top of the shop.
   *
   * The detail is a READ-ONLY view of the card: the shop behind it keeps the buy button, so the
   * price and the stock stay in one place only.
   *
   * @param {string|null|undefined} offerKey - Key of the offer (`weekly-…` or `pinned-…`).
   * @param {HTMLElement} trigger - Picture that opened it (receives the focus back on close).
   * @returns {void}
   */
  openOfferDetail(offerKey, trigger) {
    const offer = (this.traderState?.offers ?? []).find((candidate) => candidate.key === offerKey);
    if (!offer) {
      console.warn(`[MineBlockView] The offer "${offerKey}" is not in the shop any more.`);
      return;
    }

    this.offerDetailKey = offer.key;
    this.offerTitle.textContent = offer.card.getName(i18n.getLang());
    this.offerBody.textContent = '';
    this.offerBody.appendChild(this.buildOfferDetail(offer));

    this.offerModal.hidden = false;
    this.offerModal.dataset.source = offer.source;
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
    this.offerDialog = { modal: this.offerModal, trigger: trigger ?? null };
    this.offerClose.focus();
    this.log(`Offer detail displayed: ${offer.key}.`);
  }

  /**
   * Closes the detail of the open offer and gives the focus back to its picture.
   *
   * @returns {void}
   */
  closeOfferDetail() {
    if (!this.offerDialog) return;
    const { trigger } = this.offerDialog;
    this.offerModal.hidden = true;
    this.offerDialog = null;
    this.offerDetailKey = null;
    if (trigger && typeof trigger.focus === 'function' && trigger.isConnected) {
      trigger.setAttribute('aria-expanded', 'false');
      trigger.focus();
    }
  }

  /**
   * Builds the body of the detail of one offer: the artwork, its set, its description and the
   * whole price with what the player already owns of each line.
   *
   * @param {object} offer - Offer returned by `TraderManager.getState()`.
   * @returns {DocumentFragment} The content of the dialog.
   */
  buildOfferDetail(offer) {
    const fragment = document.createDocumentFragment();
    const lang = i18n.getLang();
    const rarityLabel = getRarityLabel(offer.rarity, (key) => i18n.t(key));

    const figure = document.createElement('figure');
    figure.className = 'mineblock__detail-figure';
    const picture = document.createElement('img');
    picture.className = 'mineblock__detail-image';
    picture.src = i18n.resolveImagePath(offer.card.illustration);
    picture.alt = `${offer.card.getName(lang)}, ${rarityLabel}`;
    picture.decoding = 'async';
    picture.addEventListener('error', () => picture.classList.add('is-missing'));
    attachCardTilt(picture);
    figure.appendChild(picture);
    fragment.appendChild(figure);

    const meta = document.createElement('p');
    meta.className = 'mineblock__detail-meta';
    const parts = [rarityLabel];
    if (offer.card.set) parts.push(offer.card.set);
    if (offer.source === 'pinned') parts.push(i18n.t('mineblock.trader.pinned'));
    meta.textContent = parts.join(' · ');
    fragment.appendChild(meta);

    const description = offer.card.getDescription(lang);
    if (description) {
      const text = document.createElement('p');
      text.className = 'mineblock__detail-desc';
      text.textContent = description;
      fragment.appendChild(text);
    }

    const heading = document.createElement('h3');
    heading.className = 'mineblock__detail-subtitle';
    heading.textContent = i18n.t('mineblock.trader.price');
    const price = document.createElement('ul');
    price.className = 'mineblock__offer-price mineblock__detail-price';
    offer.price.forEach((line) => price.appendChild(this.buildPriceLine(line)));
    fragment.append(heading, price);

    const footer = document.createElement('p');
    footer.className = 'mineblock__detail-stock';
    const stockParts = [];
    if (offer.maxUses !== null) {
      stockParts.push(
        i18n.t('mineblock.trader.stock', { remaining: offer.remaining, max: offer.maxUses })
      );
    }
    if (offer.source === 'pinned' && offer.period?.max) {
      stockParts.push(this.formatTraderPeriod(offer.period));
    }
    footer.textContent = stockParts.join(' · ');
    footer.hidden = stockParts.length === 0;
    fragment.appendChild(footer);

    return fragment;
  }

  /**
   * Builds the inventory list: every resource of the mine, its picture, its name and its quantity.
   *
   * @returns {void}
   */
  renderInventory() {
    this.inventoryList.textContent = '';
    const counts = this.state?.resources ?? {};
    const entries = this.resources.map((resource) => ({
      resource,
      count: counts[resource.slug] ?? 0,
    }));

    this.inventoryEmpty.hidden = entries.some(({ count }) => count > 0);

    entries.forEach(({ resource, count }) => {
      const item = document.createElement('li');
      item.className = 'mineblock__inventory-item';
      item.dataset.resource = resource.slug;

      const icon = document.createElement('img');
      icon.className = 'mineblock__inventory-item-icon';
      icon.src = resource.texture;
      icon.alt = '';
      icon.decoding = 'async';
      icon.addEventListener('error', () => {
        icon.hidden = true;
      });

      const name = document.createElement('span');
      name.className = 'mineblock__inventory-item-name';
      name.textContent = this.resolveResourceLabel(resource);

      const value = document.createElement('span');
      value.className = 'mineblock__inventory-item-value';
      value.textContent = String(count);

      item.append(icon, name, value);
      this.inventoryList.appendChild(item);
    });
  }

  /**
   * Reads the shop of the week, then draws it.
   *
   * The offers live in `TraderManager` (they are shared by every player and drawn from the Monday
   * of the week), the view only adds what the player can pay: the resources come with the shop so a
   * price line can be flagged the moment it is out of reach.
   *
   * @param {object} [options] - Read options.
   * @param {boolean} [options.force=false] - Rebuild the shop even when it is cached.
   * @returns {Promise<void>} Resolves once the shop is on screen.
   * @throws {Error} When the shop cannot be read.
   */
  async renderTrader({ force = false } = {}) {
    this.traderState = await traderManager.getState({ force });
    this.traderWeek.textContent = this.formatTraderWeek(this.traderState.week);
    if (this.traderState.week) {
      this.traderWeek.setAttribute('datetime', this.traderState.week);
    } else {
      this.traderWeek.removeAttribute('datetime');
    }
    this.renderTrades();
    this.renderOffers();
    this.renderSparkOffer();
    this.renderTraderClock();
    this.log(
      `Shop rendered: ${this.traderState.offers.length} offer(s), ` +
        `${this.traderState.trades.length} daily trade(s).`
    );
  }

  /**
   * Draws the daily offer that sells one resource for Sparks.
   *
   * The section is hidden when the day is unknown or no priced resource fits the configured budget;
   * otherwise it shows the resource, its quantity, the value of the draw and its price in Sparks.
   *
   * @returns {void}
   */
  renderSparkOffer() {
    const offer = this.traderState?.sparkOffer ?? null;
    this.sparkOfferElement.hidden = !offer;
    this.sparkBody.textContent = '';
    if (!offer) return;

    const help = document.createElement('p');
    help.className = 'mineblock__spark-help';
    help.dataset.infoHint = 'spark';
    help.textContent = i18n.t('mineblock.trader.spark.help');

    const card = document.createElement('div');
    card.className = 'mineblock__spark-card';
    card.dataset.state = offer.exhausted
      ? 'used'
      : offer.affordable
        ? 'ready'
        : 'expensive';

    const icon = document.createElement('img');
    icon.className = 'mineblock__spark-icon';
    icon.src = offer.item.texture;
    icon.alt = '';
    icon.decoding = 'async';
    icon.addEventListener('error', () => {
      icon.hidden = true;
    });

    const details = document.createElement('div');
    details.className = 'mineblock__spark-details';
    const name = document.createElement('p');
    name.className = 'mineblock__spark-name';
    name.textContent = i18n.t('mineblock.trader.spark.quantity', {
      count: offer.quantity,
      resource: this.resolveResourceLabel(offer.item),
    });
    const value = document.createElement('p');
    value.className = 'mineblock__spark-value';
    value.textContent = i18n.t('mineblock.trader.spark.value', { value: offer.value });
    const price = document.createElement('p');
    price.className = 'mineblock__spark-price';
    price.textContent = i18n.t('mineblock.trader.spark.price', { price: offer.priceSparks });
    details.append(name, value, price);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn--primary btn--small mineblock__spark-buy';
    button.dataset.sparkBuy = '';
    button.disabled = offer.exhausted || !offer.affordable;
    button.textContent = offer.exhausted
      ? i18n.t('mineblock.trader.spark.bought')
      : i18n.t('mineblock.trader.spark.buy', { price: offer.priceSparks });
    button.title = offer.exhausted
      ? i18n.t('mineblock.trader.spark.bought')
      : offer.affordable
        ? button.textContent
        : i18n.t('mineblock.trader.spark.insufficient', {
            balance: this.traderState.sparks ?? 0,
            price: offer.priceSparks,
          });

    card.append(icon, details, button);
    this.sparkBody.append(help, card);
    // The sentence of the daily offer moves behind the "i" of its title, like every panel help:
    // the section is redrawn on every shop refresh, so the previous popover content is replaced.
    infoHint.attach(help, {
      anchor: this.sparkOfferElement?.querySelector('.mineblock__trades-title') ?? null,
      replace: true,
    });
  }

  /**
   * Buys the daily Sparks offer and reports what landed in the inventory.
   *
   * @returns {Promise<void>} Resolves once the purchase was reported.
   */
  async buySparkOffer() {
    if (this.isBuyingSpark) return;
    this.isBuyingSpark = true;
    this.setTraderFeedback(null);
    this.sparkBody.classList.add('is-busy');

    try {
      const result = await traderManager.buySparkOffer();
      Toast.success('mineblock.trader.spark.done', {
        params: {
          count: result.offer.quantity,
          resource: this.resolveResourceLabel(result.offer.item),
          price: result.offer.priceSparks,
        },
      });
    } catch (error) {
      console.error('[MineBlockView] The daily Sparks offer could not be bought.', error);
      this.setTraderFeedback(getTraderErrorMessageKey(error?.code), 'error');
    } finally {
      this.isBuyingSpark = false;
      this.sparkBody.classList.remove('is-busy');
    }
  }

  /**
   * Draws the trades of the day, then the empty state when the configuration offers none.
   *
   * A trade is an exchange of equal value: it is shown as its two sides (one of them always counts
   * a single unit) and it can be taken in either direction, once a day. The quantities come from
   * `TraderManager`, never from this view.
   *
   * @returns {void}
   */
  renderTrades() {
    const trades = this.traderState?.trades ?? [];
    this.tradeList.textContent = '';
    trades.forEach((trade) => this.tradeList.appendChild(this.buildTrade(trade)));
    if (this.tradeEmpty) this.tradeEmpty.hidden = trades.length > 0;
  }

  /**
   * Builds one trade: its two sides, what the player holds of each, and a button per direction.
   *
   * @param {object} trade - Trade returned by `TraderManager.getState()`.
   * @returns {HTMLElement} The `<li>` of the trade.
   */
  buildTrade(trade) {
    const item = document.createElement('li');
    item.className = 'mineblock__trade';
    item.dataset.tradeKey = trade.key;
    item.dataset.state = trade.exhausted
      ? 'used'
      : trade.moves.some((move) => move.affordable)
        ? 'ready'
        : 'expensive';

    const head = document.createElement('div');
    head.className = 'mineblock__trade-head';
    head.append(
      this.buildTradeSide(trade, trade.left),
      this.buildTradeSign(),
      this.buildTradeSide(trade, trade.right)
    );

    const actions = document.createElement('div');
    actions.className = 'mineblock__trade-actions';
    trade.moves.forEach((move, index) => {
      const from = index === 0 ? trade.left : trade.right;
      const to = index === 0 ? trade.right : trade.left;
      const amount = (side) =>
        i18n.t('mineblock.trader.trades.amount', {
          count: side.quantity,
          resource: this.resolveResourceLabel(side),
        });
      const give = amount(from);
      const receive = amount(to);

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn--ghost btn--small mineblock__trade-action';
      button.dataset.tradeKey = trade.key;
      button.dataset.tradeFrom = from.slug;
      button.disabled = trade.exhausted || !move.affordable;
      button.textContent = trade.exhausted
        ? i18n.t('mineblock.trader.trades.used')
        : i18n.t('mineblock.trader.trades.take', { receive });
      button.setAttribute('aria-label', i18n.t('mineblock.trader.trades.takeAria', { give, receive }));
      button.title = move.affordable
        ? i18n.t('mineblock.trader.trades.takeAria', { give, receive })
        : i18n.t('mineblock.trader.missing', { count: move.missing });
      if (index > 0) button.classList.add('mineblock__trade-action--reverse');
      actions.appendChild(button);
    });

    item.append(head, actions);
    return item;
  }

  /**
   * Builds one side of a trade: the texture of the resource, the amount it counts and its name.
   *
   * @param {object} trade - Trade being drawn (its state tells whether it was already taken).
   * @param {{slug: string, type: string, nameKey: string, texture: string, quantity: number}} side -
   *   The side to draw.
   * @returns {HTMLElement} The chip.
   */
  buildTradeSide(trade, side) {
    const chip = document.createElement('span');
    chip.className = 'mineblock__trade-chip';
    chip.dataset.resource = side.slug;

    const icon = document.createElement('img');
    icon.className = 'mineblock__trade-chip-icon';
    icon.src = side.texture;
    // The name next to it says everything the picture says: the chip is not announced twice.
    icon.alt = '';
    icon.decoding = 'async';
    icon.addEventListener('error', () => {
      icon.hidden = true;
    });

    const text = document.createElement('span');
    text.className = 'mineblock__trade-chip-text';
    text.textContent = i18n.t('mineblock.trader.trades.amount', {
      count: side.quantity,
      resource: this.resolveResourceLabel(side),
    });

    chip.append(icon, text);

    // What the player holds of that resource: the same fact the price lines of the offers carry,
    // and what makes a disabled button readable at a glance.
    const move = trade.moves.find((candidate) => candidate.fromSlug === side.slug);
    if (move) {
      const have = document.createElement('span');
      have.className = 'mineblock__trade-chip-have';
      have.textContent = `×${move.available}`;
      have.title = i18n.t('mineblock.trader.trades.have', { count: move.available });
      chip.appendChild(have);
    }

    return chip;
  }

  /**
   * Builds the sign between the two sides of a trade.
   *
   * @returns {HTMLElement} The separator (decorative: the equation reads through the chips).
   */
  buildTradeSign() {
    const sign = document.createElement('span');
    sign.className = 'mineblock__trade-sign';
    sign.textContent = '⇄';
    sign.setAttribute('aria-hidden', 'true');
    return sign;
  }

  /**
   * Draws every offer of the shop, then the empty state when there is none.
   *
   * @returns {void}
   */
  renderOffers() {
    const offers = this.traderState?.offers ?? [];
    // The list is rebuilt from scratch, which drops the button the open detail was attached to:
    // closing it here is the only way to keep the focus and the "open" state honest.
    if (this.offerDialog) this.closeOfferDetail();
    this.traderCountdowns = [];
    this.traderList.textContent = '';
    offers.forEach((offer) => this.traderList.appendChild(this.buildOffer(offer)));
    this.traderEmpty.hidden = offers.length > 0;
  }

  /**
   * Builds one offer: the card, its name and its rarity, its price and the button that pays it.
   *
   * @param {object} offer - Offer returned by `TraderManager.getState()`.
   * @returns {HTMLElement} The `<li>` of the offer.
   */
  buildOffer(offer) {
    const name = offer.card.getName(i18n.getLang());
    const rarityLabel = getRarityLabel(offer.rarity, (key) => i18n.t(key));

    const item = document.createElement('li');
    item.className = 'mineblock__offer';
    item.dataset.offerKey = offer.key;
    item.dataset.source = offer.source;
    if (offer.exhausted) {
      item.dataset.state = 'exhausted';
    } else if (!offer.affordable) {
      item.dataset.state = 'expensive';
    }

    const picture = document.createElement('img');
    picture.className = 'mineblock__offer-image';
    picture.src = i18n.resolveImagePath(offer.card.illustration);
    // The picture is decorative inside the button below: the button is what is announced.
    picture.alt = '';
    picture.loading = 'lazy';
    picture.decoding = 'async';
    picture.addEventListener('error', () => picture.classList.add('is-missing'));

    // The picture is a button: the shop only shows a thumbnail, so a tap on it opens the card
    // itself (artwork, description, whole price).
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'mineblock__offer-open';
    open.dataset.offerOpen = offer.key;
    open.setAttribute('aria-expanded', String(this.offerDetailKey === offer.key));
    open.setAttribute('aria-label', i18n.t('mineblock.trader.details', { card: name }));
    open.title = i18n.t('mineblock.trader.details', { card: name });
    open.appendChild(picture);

    const body = document.createElement('div');
    body.className = 'mineblock__offer-body';

    if (offer.source === 'pinned') {
      const badge = document.createElement('span');
      badge.className = 'mineblock__offer-badge';
      badge.textContent = i18n.t('mineblock.trader.pinned');
      body.appendChild(badge);
    }

    const heading = document.createElement('p');
    heading.className = 'mineblock__offer-name';
    heading.textContent = name;

    const meta = document.createElement('p');
    meta.className = 'mineblock__offer-meta';
    // A pinned offer already carries its badge above the name: repeating it here would read twice.
    meta.textContent = rarityLabel;

    const price = document.createElement('ul');
    price.className = 'mineblock__offer-price';
    offer.price.forEach((line) => price.appendChild(this.buildPriceLine(line)));

    body.append(heading, meta, price, this.buildOfferFooter(offer));

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn--primary btn--small mineblock__offer-buy';
    button.dataset.offerBuy = offer.key;
    button.disabled = offer.exhausted || !offer.affordable;
    button.textContent = offer.exhausted
      ? i18n.t('mineblock.trader.exhausted')
      : i18n.t('mineblock.trader.buy');
    body.appendChild(button);

    item.append(open, body);
    return item;
  }

  /**
   * Builds the line under the price of an offer (its stock, and the reminder of a closed window).
   *
   * @param {object} offer - Offer returned by `TraderManager.getState()`.
   * @returns {HTMLElement} The paragraph (empty attributes when the offer has no stock).
   */
  buildOfferFooter(offer) {
    const wrapper = document.createElement('div');
    wrapper.className = 'mineblock__offer-footer';
    const footer = document.createElement('p');
    footer.className = 'mineblock__offer-stock';

    const parts = [];
    if (offer.maxUses !== null && (offer.maxUses > 1 || offer.bought > 0)) {
      parts.push(
        i18n.t('mineblock.trader.stock', { remaining: offer.remaining, max: offer.maxUses })
      );
    }
    if (offer.source === 'pinned' && offer.period) {
      parts.push(this.formatTraderPeriod(offer.period));
    }

    footer.textContent = parts.join(' · ');
    footer.hidden = parts.length === 0;
    wrapper.appendChild(footer);

    // A pinned offer is also counted down, live: the window comes from its own file, and the last
    // day it is sold ends at midnight UTC.
    if (offer.source === 'pinned' && offer.period?.max) {
      const endMs = MineBlockView.endOfUtcDay(offer.period.max);
      if (endMs !== null) {
        const countdown = document.createElement('p');
        countdown.className = 'mineblock__offer-countdown';
        const label = document.createElement('span');
        label.className = 'mineblock__offer-countdown-label';
        label.textContent = i18n.t('mineblock.trader.endsIn');
        const value = document.createElement('time');
        value.className = 'mineblock__offer-countdown-value';
        const now = dateSyncManager.getEstimatedUtcMs();
        // Without a trusted clock there is no countdown to show: a wrong deadline would be worse
        // than a placeholder.
        value.textContent = now > 0 ? this.formatRemaining(endMs - now) : '--:--:--';
        countdown.append(label, value);
        wrapper.appendChild(countdown);
        if (now > 0) this.traderCountdowns.push({ element: value, endMs });
      }
    }

    return wrapper;
  }

  /**
   * Writes a remaining time as a short, readable countdown (`2 j 04:12:33`).
   *
   * @param {number} remainingMs - Milliseconds left (anything negative reads as zero).
   * @returns {string} The countdown, or the "finished" wording once the deadline has passed.
   */
  formatRemaining(remainingMs) {
    const total = Math.max(0, Math.floor(Number(remainingMs) / 1000));
    if (!Number.isFinite(total)) return '';
    if (total === 0) return i18n.t('mineblock.trader.ended');
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    const clock = [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
    return days > 0 ? i18n.t('mineblock.trader.countdownDays', { days, time: clock }) : clock;
  }

  /**
   * Writes the restock clock of the shop and starts the countdown of each pinned offer.
   *
   * The weekly offers all reroll on the Monday that follows the one they were drawn from, at 00:00
   * UTC: the deadline is therefore the start of the shop, plus seven days, and it is the same for
   * every player.
   *
   * @returns {void}
   */
  renderTraderClock() {
    // The list of countdowns was started afresh by `renderOffers()`: the pinned ones are already in
    // it, and this method only adds the ones of the two rerolls before ticking them all.
    const now = dateSyncManager.getEstimatedUtcMs();

    // The daily trades end with the UTC day they were drawn from, exactly when the next ones begin.
    const tradeEndMs = MineBlockView.endOfUtcDay(this.traderState?.tradeDay ?? null);
    if (this.tradeRestockRow) {
      this.tradeRestockRow.hidden = tradeEndMs === null;
    }
    if (tradeEndMs !== null && this.tradeRestock) {
      this.tradeRestock.textContent = now > 0 ? this.formatRemaining(tradeEndMs - now) : '--:--:--';
      this.tradeRestock.setAttribute('datetime', new Date(tradeEndMs).toISOString());
      if (now > 0) this.traderCountdowns.push({ element: this.tradeRestock, endMs: tradeEndMs });
    }

    // The Sparks offer belongs to the UTC day it was drawn from: it ends when the next one begins.
    const sparkEndMs = MineBlockView.endOfUtcDay(this.traderState?.sparkOffer?.day ?? null);
    if (this.sparkRestockRow) this.sparkRestockRow.hidden = sparkEndMs === null;
    if (sparkEndMs !== null && this.sparkRestock) {
      this.sparkRestock.textContent = now > 0
        ? this.formatRemaining(sparkEndMs - now)
        : '--:--:--';
      this.sparkRestock.setAttribute('datetime', new Date(sparkEndMs).toISOString());
      if (now > 0) this.traderCountdowns.push({ element: this.sparkRestock, endMs: sparkEndMs });
    }

    // The weekly shop rerolls on the Monday that follows the one it was drawn from, at 00:00 UTC.
    const week = this.traderState?.week ?? null;
    const startMs = week ? Date.parse(`${week}T00:00:00.000Z`) : Number.NaN;
    const endMs = Number.isFinite(startMs) ? startMs + 7 * 24 * 60 * 60 * 1000 : null;

    if (this.traderRestockRow) {
      this.traderRestockRow.hidden = endMs === null;
    }
    if (endMs !== null && this.traderRestock) {
      this.traderRestock.textContent = now > 0 ? this.formatRemaining(endMs - now) : '--:--:--';
      this.traderRestock.setAttribute('datetime', new Date(endMs).toISOString());
      if (now > 0) this.traderCountdowns.push({ element: this.traderRestock, endMs });
    }

    if (now > 0) this.updateTraderCountdowns(now);
  }

  /**
   * Ticks every countdown of the shop.
   *
   * @param {number} [now] - Current trusted UTC time in milliseconds (read from the clock manager
   *   when omitted).
   * @returns {void}
   */
  updateTraderCountdowns(now = dateSyncManager.getEstimatedUtcMs()) {
    if (this.traderCountdowns.length === 0 || !(now > 0)) return;
    this.traderCountdowns.forEach(({ element, endMs }) => {
      if (element) element.textContent = this.formatRemaining(endMs - now);
    });
  }

  /**
   * Returns the instant a UTC day ends (`YYYY-MM-DD` at 23:59:59.999 UTC).
   *
   * @param {string|null} day - UTC day.
   * @returns {number|null} The epoch milliseconds, or null when the day is malformed.
   */
  static endOfUtcDay(day) {
    const start = Date.parse(`${day}T00:00:00.000Z`);
    return Number.isFinite(start) ? start + 24 * 60 * 60 * 1000 : null;
  }

  /**
   * Writes a sale window as a sentence (`du 15 oct. 2026 au 1 déc. 2026`).
   *
   * @param {{min?: string|null, max?: string|null}} period - Window of a pinned offer.
   * @returns {string} The sentence, or an empty string when the window is incomplete.
   */
  formatTraderPeriod(period) {
    if (!period?.min || !period?.max) return '';
    return i18n.t('mineblock.trader.period', {
      from: this.formatTraderWeek(period.min),
      to: this.formatTraderWeek(period.max),
    });
  }

  /**
   * Builds one line of the price of an offer: the picture of the resource, its quantity and its name.
   *
   * A line the player cannot pay for yet is flagged (`is-missing`): the shop shows the WHOLE price
   * even when it is out of reach, because the whole price is exactly what has to be mined.
   *
   * @param {{slug: string, type: string, nameKey?: string, texture: string, quantity: number,
   *   missing: number}} line - Price line.
   * @returns {HTMLElement} The `<li>` of the line.
   */
  buildPriceLine(line) {
    const entry = document.createElement('li');
    entry.className = 'mineblock__price';
    entry.dataset.resource = line.slug;
    if (line.missing > 0) entry.classList.add('is-missing');

    const icon = document.createElement('img');
    icon.className = 'mineblock__price-icon';
    icon.src = line.texture;
    icon.alt = '';
    icon.decoding = 'async';
    icon.addEventListener('error', () => {
      icon.hidden = true;
    });

    const value = document.createElement('span');
    value.className = 'mineblock__price-value';
    value.textContent = `×${line.quantity}`;

    const label = document.createElement('span');
    label.className = 'mineblock__price-name';
    label.textContent = this.resolveResourceLabel(line);

    // The price of a line that is out of reach says how much is missing, in the accessible text.
    if (line.missing > 0) {
      const missing = document.createElement('span');
      missing.className = 'sr-only';
      missing.textContent = i18n.t('mineblock.trader.missing', { count: line.missing });
      entry.append(icon, value, label, missing);
      return entry;
    }

    entry.append(icon, value, label);
    return entry;
  }

  /**
   * Pays an offer and grants its card.
   *
   * The commit itself belongs to `TraderManager` (one transaction for the price, the card and the
   * stock): this method only reports what came out of it. A refusal is shown in the dialog, next to
   * the offer that was refused.
   *
   * @param {string} offerKey - Key of the offer to buy.
   * @returns {Promise<void>} Resolves once the purchase was reported.
   */
  async buyOffer(offerKey) {
    if (!offerKey || this.isBuying) return;
    this.isBuying = true;
    this.setTraderFeedback(null);
    this.traderList.classList.add('is-busy');

    try {
      const result = await traderManager.buy(offerKey);
      const name = result.card.getName(i18n.getLang());
      const toast = result.isNew
        ? Toast.success('mineblock.trader.boughtNew', { params: { card: name } })
        : Toast.info('mineblock.trader.bought', { params: { card: name } });
      if (toast) toast.dataset.card = result.card.uniqueKey;
      // The card is what was bought: it is announced with the sound of its rarity (only 3, 4 and 5
      // ship one, a more ordinary card simply arrives in silence).
      const sound = RARITY_SOUNDS[result.card.rarity];
      if (sound) soundManager.play(sound);
    } catch (error) {
      console.error('[MineBlockView] The offer could not be bought.', error);
      this.setTraderFeedback(getTraderErrorMessageKey(error?.code), 'error');
    } finally {
      this.isBuying = false;
      this.traderList.classList.remove('is-busy');
    }
  }

  /**
   * Takes one of the daily trades: one resource is given, the other one is received.
   *
   * The exchange itself belongs to `TraderManager` (one transaction for both sides and the use
   * count), and so do the AMOUNTS: this view only names the trade and the side the player pays.
   *
   * @param {string} tradeKey - Key of the trade to take.
   * @param {string} fromSlug - Resource the player gives.
   * @returns {Promise<void>} Resolves once the exchange was reported.
   */
  async swapTrade(tradeKey, fromSlug) {
    if (!tradeKey || !fromSlug || this.isTrading) return;
    this.isTrading = true;
    this.setTraderFeedback(null);
    this.tradeList.classList.add('is-busy');

    /**
     * Reads a side of the exchange as `"2 Poussière du vide"`.
     *
     * @param {{nameKey?: string, type?: string, quantity: number}} side - Side of the exchange.
     * @returns {string} The readable amount.
     */
    const amount = (side) =>
      i18n.t('mineblock.trader.trades.amount', {
        count: side.quantity,
        resource: this.resolveResourceLabel(side),
      });

    try {
      const result = await traderManager.swap(tradeKey, fromSlug);
      Toast.success('mineblock.trader.trades.done', {
        params: { give: amount(result.give), receive: amount(result.receive) },
      });
      // A resource the player never held is worth saying out loud: it is a first of its kind, and
      // the inventory of the mine grows by one line.
      if (result.creates) {
        Toast.info('mineblock.trader.trades.discovered', {
          params: { resource: this.resolveResourceLabel(result.receive) },
        });
      }
    } catch (error) {
      console.error('[MineBlockView] The trade could not be taken.', error);
      this.setTraderFeedback(getTraderErrorMessageKey(error?.code), 'error');
    } finally {
      this.isTrading = false;
      this.tradeList.classList.remove('is-busy');
    }
  }

  /**
   * Writes the feedback line of the shop.
   *
   * @param {string|null} key - Translation key, or null to clear the line.
   * @param {'info'|'error'} [tone='info'] - Tone of the message.
   * @param {object} [params] - Values interpolated into the message.
   * @returns {void}
   */
  setTraderFeedback(key, tone = 'info', params = undefined) {
    if (!this.traderFeedback) return;
    if (!key) {
      this.traderFeedback.hidden = true;
      this.traderFeedback.textContent = '';
      return;
    }
    this.traderFeedback.textContent = i18n.t(key, params);
    this.traderFeedback.dataset.tone = tone;
    this.traderFeedback.hidden = false;
  }

  /**
   * Writes a UTC day of the shop in the language of the player.
   *
   * @param {string|null} day - Day returned by the shop (`YYYY-MM-DD`).
   * @returns {string} The formatted day, or a dash when the clock is unknown.
   */
  formatTraderWeek(day) {
    // The day is the one the SHOP uses (UTC), so it is formatted as UTC: a player west of Greenwich
    // must read the Monday the offers were drawn from, not the Sunday before it.
    const time = Date.parse(`${day}T00:00:00.000Z`);
    if (!Number.isFinite(time)) return i18n.t('common.unknown');
    return new Intl.DateTimeFormat(i18n.getLang(), { dateStyle: 'medium', timeZone: 'UTC' }).format(
      new Date(time)
    );
  }

  /**
   * Decodes the sprite of the chest and draws its resting frame.
   *
   * The sheet is one request instead of forty-one, and drawing a frame is a single `drawImage`:
   * the view owns the timing, so the opening and the closing segments are exact.
   *
   * A failure falls back to the animated webp (the chest then simply moves all the time), which is
   * a cosmetic regression, never a broken control.
   *
   * @returns {Promise<void>} Resolves once the first frame is on the canvas (or the fallback is in).
   */
  async loadChest() {
    if (typeof Image !== 'function') return;
    const sprite = new Image();
    sprite.src = CHEST_SPRITE;
    try {
      await (typeof sprite.decode === 'function'
        ? sprite.decode()
        : new Promise((resolve, reject) => {
            sprite.addEventListener('load', () => resolve());
            sprite.addEventListener('error', () => reject(new Error('The chest sprite could not be loaded.')));
          }));
    } catch (error) {
      console.warn('[MineBlockView] The chest sprite could not be loaded.', error);
      this.useAnimatedChest();
      return;
    }

    this.chestSprite = sprite;
    this.drawChestFrame(CHEST_OPEN_FIRST);
  }

  /**
   * Replaces the canvas by the animated webp when the sprite is unavailable.
   *
   * @returns {void}
   */
  useAnimatedChest() {
    if (!this.inventoryIcon || !this.inventoryButton) return;
    const image = document.createElement('img');
    image.className = 'mineblock__inventory-icon';
    image.dataset.mineblockInventoryIcon = '';
    image.src = CHEST_TEXTURE;
    image.alt = '';
    image.decoding = 'async';
    this.inventoryIcon.replaceWith(image);
    this.inventoryIcon = image;
  }

  /**
   * Draws one frame of the sprite on the chest canvas.
   *
   * @param {number} index - Frame index (0-based, clamped to the sheet).
   * @returns {void}
   */
  drawChestFrame(index) {
    if (!(this.inventoryIcon instanceof HTMLCanvasElement) || !this.chestSprite) return;
    const context = this.inventoryIcon.getContext('2d');
    if (!context) return;

    const frame = Math.min(Math.max(index, 0), CHEST_FRAME_COUNT - 1);
    const column = frame % CHEST_SPRITE_COLUMNS;
    const row = Math.floor(frame / CHEST_SPRITE_COLUMNS);
    context.clearRect(0, 0, CHEST_FRAME_SIZE, CHEST_FRAME_SIZE);
    context.drawImage(
      this.chestSprite,
      column * CHEST_FRAME_SIZE,
      row * CHEST_FRAME_SIZE,
      CHEST_FRAME_SIZE,
      CHEST_FRAME_SIZE,
      0,
      0,
      CHEST_FRAME_SIZE,
      CHEST_FRAME_SIZE
    );
    this.chestFrame = frame;
  }

  /**
   * Plays a segment of the sheet, one frame every `CHEST_FRAME_MS`.
   *
   * A second animation cancels the first instead of stacking two loops on the same canvas.
   *
   * @param {number} from - First frame index.
   * @param {number} to - Last frame index (the animation stops on it).
   * @param {(() => void)|null} [onDone=null] - Called once the last frame is drawn.
   * @returns {void}
   */
  animateChest(from, to, onDone = null) {
    this.stopChestAnimation();
    if (!this.chestSprite) return;

    const startedAt = performance.now();
    this.drawChestFrame(from);
    const step = (now) => {
      const index = Math.min(to, from + Math.floor((now - startedAt) / CHEST_FRAME_MS));
      this.drawChestFrame(index);
      if (index >= to) {
        this.chestAnimation = null;
        if (typeof onDone === 'function') onDone();
        return;
      }
      this.chestAnimation = window.requestAnimationFrame(step);
    };
    this.chestAnimation = window.requestAnimationFrame(step);
  }

  /**
   * Plays the opening frames of the chest and holds the open chest.
   *
   * @returns {void}
   */
  playChestOpening() {
    this.animateChest(CHEST_OPEN_FIRST, CHEST_OPEN_LAST);
  }

  /**
   * Plays the closing frames of the chest, then returns to its resting frame.
   *
   * @returns {void}
   */
  playChestClosing() {
    this.animateChest(CHEST_CLOSE_FIRST, CHEST_CLOSE_LAST, () => this.drawChestFrame(CHEST_OPEN_FIRST));
  }

  /**
   * Cancels the running chest animation, if any.
   *
   * @returns {void}
   */
  stopChestAnimation() {
    if (this.chestAnimation === null) return;
    window.cancelAnimationFrame(this.chestAnimation);
    this.chestAnimation = null;
  }

  /**
   * Keeps the countdown to the next reset up to date, and follows the UTC day change.
   *
   * The allowance rolls over at midnight UTC, exactly like the daily boosters: while the page stays
   * open, the trusted day carried by the tick is what announces it (the same trigger as the Mine
   * Pick counter of the header). A placeholder tick, emitted before the first synchronization,
   * carries an estimated date and must not be mistaken for a real day change.
   *
   * @param {{utc?: Date, formatted?: string, timeUntilReset?: string}|null} payload - Clock tick.
   * @returns {void}
   */
  handleClockTick(payload) {
    if (payload?.utc instanceof Date) this.updateTraderCountdowns(payload.utc.getTime());
    if (!payload || typeof payload.timeUntilReset !== 'string') return;
    if (!this.countdownElement.hidden) {
      this.countdownValue.textContent = payload.timeUntilReset;
    }
    if (!(payload.utc instanceof Date) || payload.formatted === '--:--:--') return;
    const day = payload.utc.toISOString().slice(0, 10);
    if (this.state?.day && day !== this.state.day) {
      this.log(`New UTC day (${day}): reloading the mine.`);
      this.state = null;
      void this.reload().catch((error) => {
        console.warn('[MineBlockView] The new day could not be loaded.', error);
      });
    }
  }

  /**
   * Reloads the mine when the view becomes active (the day, or the state, may have changed).
   *
   * @returns {void}
   */
  handleViewActivated() {
    this.isActive = true;
    this.log('View activated.');
    void this.reload().catch((error) => {
      console.error('[MineBlockView] The mine could not be reloaded.', error);
      this.setFeedback('mineblock.error.load', 'error');
    });
  }

  /**
   * Marks the view as inactive: the sequences in flight are cancelled and the dialogs closed.
   *
   * @returns {void}
   */
  handleViewDeactivated() {
    this.isActive = false;
    this.stopMineHold();
    this.log('View deactivated.');
    this.clearTimers();
    this.closeOfferDetail();
    this.closeModal();
    this.burstElement.textContent = '';
    this.rockElement.classList.remove('is-hit', 'is-broken', 'is-arriving');
  }

  /**
   * Re-translates the labels and the block name when the language changes.
   *
   * @returns {void}
   */
  handleLanguageChanged() {
    this.log(`Language changed, re-rendering (${i18n.getLang()}).`);
    void this.reload().catch((error) => {
      console.warn('[MineBlockView] The mine could not be re-rendered.', error);
    });
    if (this.feedback) {
      this.setFeedback(this.feedback.key, this.feedback.tone, this.feedback.params);
    }
    // The name and the rarity of every offer are translated on screen, so an open shop is redrawn.
    if (this.openDialog?.modal === this.traderModal) {
      void this.renderTrader().catch((error) => {
        console.warn('[MineBlockView] The shop could not be re-rendered.', error);
      });
    }
  }

  /**
   * Writes the feedback line.
   *
   * @param {string|null} key - Translation key, or null to clear the line.
   * @param {'info'|'error'} [tone='info'] - Tone of the message.
   * @param {object|null} [params=null] - Interpolation values.
   * @returns {void}
   */
  setFeedback(key, tone = 'info', params = null) {
    this.feedback = key ? { key, tone, params } : null;
    if (!this.feedbackElement) return;
    if (!key) {
      this.feedbackElement.hidden = true;
      this.feedbackElement.textContent = '';
      return;
    }
    this.feedbackElement.textContent = i18n.t(key, params);
    this.feedbackElement.dataset.tone = tone;
    this.feedbackElement.hidden = false;
  }

  /**
   * Removes every listener, timer and flying element.
   *
   * @returns {void}
   */
  destroy() {
    this.log('Destroying the view.');
    this.stopMineHold();
    this.clearTimers();
    this.stopChestAnimation();
    this.bindings.forEach(({ target, type, handler }) => target.removeEventListener(type, handler));
    this.bindings = [];
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers = [];
    this.state = null;
    this.displayedTexture = null;
    this.isInitialized = false;
  }
}

export default MineBlockView;

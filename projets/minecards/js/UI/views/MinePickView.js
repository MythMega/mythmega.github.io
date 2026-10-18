/**
 * MinePickView - Mine Pick screen.
 *
 * Reference: `js/business/MinePickManager.js` (the board, the allowance, the statistics) and
 * `.docs/main.md` section 3.G quater.
 *
 * FLOW
 *   1. `board` stage: the ten simulated boosters of the day, one per LINE, each showing its texture,
 *      its name and its five cards FACE UP — the player chooses a pack knowing what it holds. The
 *      line also carries the state of the booster: pickable, already picked (with the card that was
 *      kept) or locked because the day's allowance is gone. A booster already used the same day can
 *      not be played again, so the choices really run out before the ten lines do.
 *      Picking a pack takes TWO taps, on purpose: the first one only SELECTS the line (it lights
 *      up, its button turns into "Open this booster" and nothing is spent), the second one opens
 *      it. Opening a pack costs a free pick, so it must never happen because a thumb brushed a
 *      row while the list was scrolling.
 *   2. `pick` stage: the chosen pack is dealt face up (the very content that was listed), then its
 *      cards turn over one after another and the pack is shuffled (a seeded permutation, so a reload
 *      always deals the same pack the same way). The shuffle gathers every card into ONE pile in the
 *      middle of the stage before dealing them back out: a player who could follow a single card
 *      from slot to slot would no longer be picking at random. Only then can the player keep a card;
 *      the other cards are revealed one after another.
 *   3. the result line names the kept card, says whether it was new, and the remaining picks.
 *      "Back to the boosters" returns to the list, where the booster now shows the card that was
 *      taken from it.
 *
 * Every step of that ritual is animated (`css/views/minepick.css`): the blast of light when the
 * pack lands, the cards dealing in, the slow breathing of the pack face up while it is studied,
 * the turn-over, the pile of the shuffle and the shockwave of the kept card. The durations
 * come from the animation mode, so an "epic" player gets a slower, wider version of all of it.
 *
 * Reference: `settings/config.json` (`minePick`).
 *

 * The cards reuse `CardComponent`, so the Mine Pick inherits the illustrations, the rarity glow,
 * the language switch and — because that component is driven by CSS classes — the opening animation
 * mode (`css/animations/`) of the player. The view never draws anything itself:
 * `MinePickManager` decides the board, the shuffle and the state of every booster, and the screen
 * only renders what came back.
 */

import eventBus, { EVENTS } from '../../utils/EventBus.js';
import i18n from '../../utils/I18n.js';
import minePickManager, {
  getMinePickErrorMessageKey,
  MINE_PICK_ERRORS,
} from '../../business/MinePickManager.js';
import dateSyncManager from '../../business/DateSyncManager.js';
import sparksManager, { INSUFFICIENT_SPARKS } from '../../business/SparksManager.js';
import { configLoader } from '../../utils/ConfigLoader.js';
import soundManager, { SOUNDS } from '../../utils/SoundManager.js';
import CardComponent, { applyCardGlow } from '../components/CardComponent.js';
import { getRarityLabel } from '../../classes/Card.js';
import animationManager from '../../utils/AnimationManager.js';
import { setFocusMode } from '../../utils/FocusMode.js';

/** View name, matching `data-view="minepick"` in `index.html`. */
export const MINE_PICK_VIEW_NAME = 'minepick';

/**
 * Bounds of the delay between two automatic card reveals, in milliseconds.
 *
 * The base value is the flip duration of the active animation mode (`AnimationManager`), so an
 * "epic" player sees a slower sequence and an "explosive" one a snappier beat — but it is clamped:
 * the parodic mode reaches 900 ms, which would make four reveals drag on.
 */
const REVEAL_STEP_MIN_MS = 180;
const REVEAL_STEP_MAX_MS = 420;

/** Delay between two cards of the same movement (dealing, turning over), in milliseconds. */
const FLIP_STEP_MS = 70;

/**
 * Length of the staggered dealing of a pack, in milliseconds (last card of `minepick-deal`).
 *
 * Picked by hand, not computed: 700 ms reads as a deal, 500 flies by and 900 feels like a wait.
 */
const DEAL_MS = 700;

/** Bounds of the pause during which the player studies the pack face up, in milliseconds. */
const STUDY_MIN_MS = 900;
const STUDY_MAX_MS = 1800;

/**
 * Bounds of the shuffle, in milliseconds.
 *
 * The gesture is read in three beats (gather, pile, deal back out), so it is deliberately longer
 * than a simple swap: under half a second the pile is a blink, and the player cannot tell that the
 * cards really went through one single place.
 */
const SHUFFLE_MIN_MS = 620;
const SHUFFLE_MAX_MS = 900;

/** How long the pack sits in its pile before it is dealt back out, in milliseconds. */
const PILE_HOLD_MS = 140;

/** Multiplier applied to the flip duration to size the study pause. */
const STUDY_FLIP_FACTOR = 1.5;

/**
 * Number-row shortcuts of the pick stage, as a visible SLOT (0-based).
 *
 * The digits are the QWERTY shape and the five other characters the unshifted number row of an
 * AZERTY keyboard (& é " ' (): both layouts can pick a card without switching anything.
 */
const CARD_SLOT_KEYS = new Map([
  ['1', 0], ['&', 0],
  ['2', 1], ['é', 1],
  ['3', 2], ['"', 2],
  ['4', 3], ["'", 3],
  ['5', 4], ['(', 4],
]);

export class MinePickView {
  /**
   * @param {HTMLElement} rootElement - The Mine Pick `<section>`.
   */
  constructor(rootElement) {
    if (!rootElement || typeof rootElement.querySelector !== 'function') {
      throw new TypeError('MinePickView requires the minepick section element.');
    }

    this.root = rootElement;
    this.feedbackElement = this.root.querySelector('[data-minepick-feedback]');
    this.boardStage = this.root.querySelector('[data-minepick-stage="board"]');
    this.pickStage = this.root.querySelector('[data-minepick-stage="pick"]');
    this.quotaElement = this.root.querySelector('[data-minepick-quota]');
    this.buyButton = this.root.querySelector('[data-minepick-buy]');
    this.countdownElement = this.root.querySelector('[data-minepick-countdown]');
    this.countdownValue = this.root.querySelector('[data-minepick-countdown-value]');
    this.boardElement = this.root.querySelector('[data-minepick-board]');
    this.setNameElement = this.root.querySelector('[data-minepick-set-name]');
    this.hintElement = this.root.querySelector('[data-minepick-hint]');
    this.cardsElement = this.root.querySelector('[data-minepick-cards]');
    this.resultElement = this.root.querySelector('[data-minepick-result]');
    this.backButton = this.root.querySelector('[data-minepick-back]');

    this.assertMarkup();

    /** @type {Array<object>} Boosters of the current board. */
    this.board = [];
    /** @type {CardComponent[]} Cards of the opened booster, in the order they were drawn. */
    this.cardComponents = [];
    /** @type {number|null} Index of the booster SELECTED in the list (not opened yet). */
    this.selectedIndex = null;
    /** @type {number|null} Index of the booster being picked from. */
    this.boosterIndex = null;
    /** @type {number|null} Index of the card the player kept. */
    this.keptIndex = null;
    /** @type {boolean} True while a pick is being committed or revealed. */
    this.isPicking = false;
    /** @type {boolean} True once the pack was dealt, turned over and shuffled: only then can the player pick. */
    this.canPick = false;
    /** @type {boolean} True once `init()` bound everything. */
    this.isInitialized = false;
    /** @type {boolean} True when the view is the active one. */
    this.isActive = false;
    /** @type {Record<string, object>} Boosters already used today, by board index. */
    this.picksByBooster = {};
    /** @type {number} Remaining FREE picks of the day, as last read from the manager. */
    this.remaining = 0;
    /** @type {number} Picks bought with Sparks, as last read from the manager. */
    this.bonusPicks = 0;
    /** @type {number} Sparks charged for one extra pick (`minePick`). */
    this.extraPickPrice = 0;
    /** @type {number} Last known Sparks balance, for the state of the buy button. */
    this.sparksBalance = 0;
    /** @type {boolean} True while the extra-pick purchase is in flight. */
    this.isBuying = false;
    /** @type {string} Signature of the rendered board state, to avoid needless rebuilds. */
    this.boardSignature = '';
    /** @type {string|null} Translation key currently shown in the hint line. */
    this.hintKey = null;
    /** @type {{key: string, tone: string}|null} Last feedback message. */
    this.feedback = null;

    /** @type {number[]} Timers of the automatic sequences (dealing, turning over, shuffling, revealing). */
    this.timers = [];
    /** @type {number|null} Timer clearing the inline transforms left by the shuffle. */
    this.shuffleTimer = null;
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
    console.info('[MinePickView]', ...args);
  }

  /**
   * Picks the player can still make today: the free allowance plus the ones bought with Sparks.
   *
   * Every "is there anything left to play?" decision of the view reads this, so the free picks and
   * the bought ones can never disagree with what the board offers.
   *
   * @returns {number} The number of available picks.
   */
  get availablePicks() {
    return this.remaining + this.bonusPicks;
  }

  /**
   * Boosters of the day that have not been picked from yet.
   *
   * The board is FINITE (`minePick.boosterCount`): once every pack has been used, an extra pick has
   * nothing left to open, so the allowance is no longer what makes the day playable.
   *
   * @returns {number} The number of rows still waiting for their pick.
   */
  get openBoosters() {
    return this.board.filter((entry) => !this.picksByBooster[String(entry.index)]).length;
  }

  /**
   * Verifies that the markup matches the contract expected by this view.
   *
   * @returns {void}
   * @throws {Error} When a required element is missing from `index.html`.
   */
  assertMarkup() {
    const missing = [
      ['[data-minepick-stage="board"]', this.boardStage],
      ['[data-minepick-stage="pick"]', this.pickStage],
      ['[data-minepick-quota]', this.quotaElement],
      ['[data-minepick-buy]', this.buyButton],
      ['[data-minepick-board]', this.boardElement],
      ['[data-minepick-cards]', this.cardsElement],
      ['[data-minepick-result]', this.resultElement],
      ['[data-minepick-back]', this.backButton],
    ]
      .filter(([, element]) => !element)
      .map(([selector]) => selector);

    if (missing.length > 0) {
      throw new Error(`MinePickView markup is incomplete, missing: ${missing.join(', ')}.`);
    }
  }

  /**
   * Binds the interactions, subscribes to the events and draws the board of the day.
   *
   * @returns {Promise<void>} Resolves once the board is displayed.
   * @throws {Error} When the board cannot be built.
   */
  async init() {
    if (this.isInitialized) return;
    this.isInitialized = true;
    this.log('Initializing…');
    this.bindEvents();
    this.subscribeToEvents();
    try {
      const { extraPickPriceSparks } = await configLoader.getMinePickSettings();
      this.extraPickPrice = extraPickPriceSparks;
    } catch (error) {
      console.warn('[MinePickView] The extra-pick price could not be read.', error);
    }
    await this.reload();
    void this.refreshSparksBalance();
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
   * Attaches the DOM listeners (the booster list, the cards and the back button).
   *
   * @returns {void}
   */
  bindEvents() {
    this.listen(this.boardElement, 'click', (event) => this.handleBoardClick(event));
    this.listen(this.cardsElement, 'click', (event) => this.handleCardsClick(event));
    this.listen(this.backButton, 'click', () => this.backToBoard());
    this.listen(this.buyButton, 'click', () => this.handleBuyExtraPick());
    this.listen(document, 'keydown', (event) => this.handleDocumentKeyDown(event));
    this.log('DOM listeners bound.');
  }

  /**
   * Picks a face-down card with the number row (`1`-`5`, and the AZERTY `& é " ' (`).
   *
   * The key names the SLOT on screen, not the card in the pack: after the shuffle the two differ,
   * and a player pressing "3" expects the third card from the left. The actual pick goes through
   * the very click handler of the card, so the guards (pack being dealt, pick already committed)
   * stay in one place only.
   *
   * @param {KeyboardEvent} event - Key event.
   * @returns {void}
   */
  handleDocumentKeyDown(event) {
    if (!event || typeof event.key !== 'string') return;
    if (!this.isActive || this.pickStage?.hidden || !this.canPick) return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
    const slot = CARD_SLOT_KEYS.get(event.key);
    if (slot === undefined) return;
    const target = event.target;
    if (target instanceof HTMLElement
      && target.closest('input, textarea, select, [contenteditable="true"]')) {
      return;
    }
    const element = this.cardsElement?.children?.[slot];
    if (!(element instanceof HTMLElement) || element.disabled) return;
    event.preventDefault();
    element.click();
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
        if (payload.view === MINE_PICK_VIEW_NAME) {
          this.handleViewActivated();
        } else if (payload.previousView === MINE_PICK_VIEW_NAME) {
          this.handleViewDeactivated();
        }
      })
    );
    this.unsubscribers.push(eventBus.on(EVENTS.LANG_CHANGED, () => this.handleLanguageChanged()));
    this.unsubscribers.push(eventBus.on(EVENTS.CLOCK_TICK, (payload) => this.handleClockTick(payload)));
    this.unsubscribers.push(eventBus.on(EVENTS.SPARKS_UPDATED, (payload) => this.handleSparksUpdated(payload)));
    this.unsubscribers.push(
      eventBus.on(EVENTS.MINE_PICK_UPDATED, () => {
        void this.refreshQuota().catch((error) => {
          console.warn('[MinePickView] The allowance could not be refreshed.', error);
        });
      })
    );
    // An imported save carries ANOTHER uuid: the board of the day changes with it.
    this.unsubscribers.push(
      eventBus.on(EVENTS.SAVE_IMPORTED, () => {
        minePickManager.resetBoard();
      })
    );
    this.log('Event subscriptions registered.');
  }

  /**
   * Rebuilds the board and the allowance line.
   *
   * @returns {Promise<void>} Resolves once the screen is rendered.
   * @throws {Error} When the board or the state cannot be read.
   */
  async reload() {
    this.setFeedback(null);
    this.setLoading(true);
    try {
      this.board = await minePickManager.getBoard();
      // A fresh board invalidates the rendered list whatever the stored state says. The selection
      // goes with it: the index may not even point at the same pack anymore.
      this.boardSignature = '';
      this.selectedIndex = null;
      await this.refreshQuota();
      this.renderBoard(true);
    } catch (error) {
      console.error('[MinePickView] The Mine Pick board could not be loaded.', error);
      this.setFeedback('minepick.error.board', 'error');
    } finally {
      this.setLoading(false);
    }
  }

  /**
   * Writes the remaining picks, the countdown and the state of every line of the list.
   *
   * The list is only rebuilt when something it shows actually changed (a pick, a daily reset): a
   * clock tick that merely refreshes the countdown never rebuilds the DOM under the player's finger.
   *
   * @returns {Promise<void>} Resolves once the allowance line is rendered.
   * @throws {Error} When the state cannot be read.
   */
  async refreshQuota() {
    const state = await minePickManager.getState();
    this.remaining = state.remaining;
    this.bonusPicks = state.bonusPicks ?? 0;
    this.picksByBooster = state.picksByBooster ?? {};
    const quota = i18n.t('minepick.quota', {
      remaining: state.remaining,
      total: state.picksPerDay,
    });
    // The bought picks are announced next to the allowance: the line must account for the picks
    // the player can actually make, not only for the free ones.
    this.quotaElement.textContent =
      this.bonusPicks > 0
        ? `${quota}${i18n.t('minepick.quota.purchased', { count: this.bonusPicks })}`
        : quota;

    if (this.countdownElement) {
      if (this.availablePicks > 0) {
        this.countdownElement.hidden = true;
      } else {
        this.countdownElement.hidden = false;
        if (this.countdownValue) {
          this.countdownValue.textContent = dateSyncManager.getFormattedTimeUntilReset();
        }
      }
    }

    this.renderBuyButton();
    this.renderBoard();
  }

  /**
   * Renders the extra-pick button.
   *
   * The button answers one situation: the allowance AND the bought picks are spent. While a bought
   * pick is left there is nothing to sell (the player still has something to play), and while the
   * free allowance lasts the extra pick would be pointless. It carries its price and stays disabled
   * while the balance is short, with the missing amount as its tooltip.
   *
   * It is ALSO disabled once every booster of the day has been picked: the board holds
   * `minePick.boosterCount` packs, and a bought pick would have nothing to open until the reset.
   * Selling it then would charge the player for an unusable pick.
   *
   * @returns {void}
   */
  renderBuyButton() {
    if (!this.buyButton) return;
    const price = this.extraPickPrice;
    const visible = price > 0 && this.availablePicks <= 0;
    this.buyButton.hidden = !visible;
    if (!visible) return;

    this.buyButton.textContent = i18n.t('minepick.buyExtra', { price });
    this.buyButton.setAttribute('aria-label', i18n.t('minepick.buyExtraAria', { price }));
    const missing = Math.max(0, price - this.sparksBalance);
    const exhausted = this.openBoosters <= 0;
    this.buyButton.disabled = this.isBuying || exhausted || missing > 0;
    this.buyButton.title = exhausted
      ? i18n.t('minepick.buyExtra.exhausted')
      : missing > 0
        ? i18n.t('minepick.buyExtra.hint', { missing })
        : '';
  }

  /**
   * Reads the Sparks balance, which decides whether an extra pick is affordable.
   *
   * A read failure leaves the button disabled rather than offering a purchase that cannot be paid.
   *
   * @returns {Promise<void>} Resolves once the button reflects the balance.
   */
  async refreshSparksBalance() {
    try {
      this.sparksBalance = await sparksManager.getBalance();
    } catch (error) {
      console.warn('[MinePickView] The Sparks balance could not be read.', error);
      this.sparksBalance = 0;
    }
    this.renderBuyButton();
  }

  /**
   * Follows the balance when it changes elsewhere (a card sold or bought in the collection).
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
   * Handles the extra-pick button: buys one pick, which immediately makes the board playable again.
   *
   * The purchase is atomic (see `MinePickManager.buyExtraPick`), so a failure never charges the
   * balance.
   *
   * @returns {Promise<void>} Resolves once the purchase was made (or the refusal reported).
   */
  async handleBuyExtraPick() {
    if (this.isBuying) return;

    // The button is already disabled in that case; this guards a stale render (the last pack was
    // picked while the pointer was on its way to the button).
    if (this.openBoosters <= 0) {
      this.setFeedback('minepick.buyExtra.exhausted', 'info');
      this.renderBuyButton();
      return;
    }

    if (this.sparksBalance < this.extraPickPrice) {
      this.setFeedback('minepick.error.insufficientSparks', 'error');
      return;
    }

    this.isBuying = true;
    this.renderBuyButton();
    this.setFeedback(null);
    this.log(`Buying an extra pick for ${this.extraPickPrice} Sparks…`);

    try {
      const { price, balance } = await minePickManager.buyExtraPick();
      this.sparksBalance = balance;
      this.setFeedback('minepick.buyExtra.done', 'info', { price });
      await this.refreshQuota();
    } catch (error) {
      console.error('[MinePickView] The extra pick could not be bought.', error);
      this.setFeedback(
        error?.code === INSUFFICIENT_SPARKS ? 'minepick.error.insufficientSparks' : 'minepick.error.buy',
        'error'
      );
    } finally {
      this.isBuying = false;
      this.renderBuyButton();
    }
  }

  /**
   * Toggles the loading state of the board (a spinner replaces the list).
   *
   * @param {boolean} loading - True while the board is being read.
   * @returns {void}
   */
  setLoading(loading) {
    this.root.classList.toggle('is-loading', loading === true);
  }

  /**
   * Displays one line per booster of the day.
   *
   * @param {boolean} [force=false] - Rebuild even when the rendered state did not change.
   * @returns {void}
   */
  renderBoard(force = false) {
    if (this.board.length === 0) {
      const signature = 'empty';
      if (!force && this.boardSignature === signature) return;
      this.boardSignature = signature;
      this.boardElement.textContent = '';
      const empty = document.createElement('li');
      empty.className = 'minepick__empty';
      empty.textContent = i18n.t('minepick.empty');
      this.boardElement.appendChild(empty);
      return;
    }

    const signature = [
      `picks:${this.availablePicks}`,
      `free:${this.remaining}`,
      `selected:${this.selectedIndex ?? 'none'}`,
      ...Object.keys(this.picksByBooster)
        .sort()
        .map((index) => `${index}:${this.picksByBooster[index].key}`),
    ].join('|');
    if (!force && this.boardSignature === signature) return;
    this.boardSignature = signature;

    this.boardElement.textContent = '';
    this.board.forEach((entry) => this.boardElement.appendChild(this.buildRow(entry)));
    this.log(`Board rendered: ${this.board.length} booster(s).`);
  }

  /**
   * Builds one line of the list: the booster, its five cards face up and its action.
   *
   * A line is `available` (pickable), `picked` (used today: the kept card is marked and the four
   * others are greyed out) or `locked` (no pick left today). The texture and the name are enough to
   * recognise the pack; the cards make the choice informed, never random.
   *
   * An available line can also be `is-selected`: the row the player previewed with a first tap.
   *
   * @param {{index: number, setId: string, name: string, texture: string|null, cards: Array}} entry - Board entry.
   * @returns {HTMLElement} The `<li>` of the list.
   */
  buildRow(entry) {
    const item = document.createElement('li');
    item.className = 'minepick__slot';

    const picked = this.picksByBooster[String(entry.index)] ?? null;
    const state = picked ? 'picked' : this.availablePicks > 0 ? 'available' : 'locked';
    const selected = state === 'available' && this.selectedIndex === entry.index;
    const name = entry.name ?? entry.setId;
    const keptCard = picked ? entry.cards.find((card) => card.uniqueKey === picked.key) ?? null : null;

    const row = document.createElement('article');
    row.className = 'minepick__row';
    row.dataset.minepickIndex = String(entry.index);
    row.dataset.minepickState = state;
    if (selected) row.classList.add('is-selected');
    if (state !== 'available') row.classList.add(`is-${state}`);
    row.setAttribute('aria-label', i18n.t('minepick.board.booster', { index: entry.index + 1, name }));

    const figure = document.createElement('div');
    figure.className = 'minepick__row-figure';
    if (entry.texture) {
      const image = document.createElement('img');
      image.className = 'minepick__booster-image';
      image.src = i18n.resolveImagePath(entry.texture);
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      figure.appendChild(image);
    }
    row.appendChild(figure);

    const head = document.createElement('div');
    head.className = 'minepick__row-head';
    const title = document.createElement('p');
    title.className = 'minepick__booster-name';
    // The ten packs often share one extension: the number is what tells two lines apart.
    title.textContent = i18n.t('minepick.stage.title', { index: entry.index + 1, name });
    const stateLine = document.createElement('p');
    stateLine.className = 'minepick__row-state';
    stateLine.textContent = selected
      ? i18n.t('minepick.board.selected')
      : this.buildRowStateText({ state, picked, keptCard, entry });
    head.append(title, stateLine);
    row.appendChild(head);

    const cards = document.createElement('ul');
    cards.className = 'minepick__row-cards';
    cards.setAttribute('aria-label', i18n.t('minepick.board.cards'));
    entry.cards.forEach((card) => {
      cards.appendChild(
        this.buildMiniCard(card, {
          // A pack only tells what it held once it has been opened AND picked from: the ring of a
          // legendary is information, and the board would otherwise hand it over for free.
          revealed: Boolean(picked),
          kept: Boolean(picked) && picked.key === card.uniqueKey,
          discarded: Boolean(picked) && picked.key !== card.uniqueKey,
        })
      );
    });
    row.appendChild(cards);

    const action = document.createElement('div');
    action.className = 'minepick__row-action';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = selected ? 'btn btn--primary btn--block' : 'btn btn--ghost btn--block';
    button.dataset.minepickOpen = String(entry.index);
    button.disabled = state !== 'available';
    const label = i18n.t(selected ? 'minepick.board.open' : 'minepick.board.pick');
    button.textContent = label;
    if (selected) button.dataset.minepickSelected = 'true';
    button.setAttribute('aria-label', `${label} (${name})`);
    action.appendChild(button);
    row.appendChild(action);

    item.appendChild(row);
    return item;
  }

  /**
   * Writes the small line describing the state of a booster of the list.
   *
   * @param {object} options - State options.
   * @param {'available'|'picked'|'locked'} options.state - Line state.
   * @param {object|null} options.picked - Stored pick of that booster, when it was used today.
   * @param {object|null} options.keptCard - Card object of the pick, when it can be resolved.
   * @param {object} options.entry - Board entry.
   * @returns {string} The translated sentence.
   */
  buildRowStateText({ state, picked, keptCard, entry }) {
    if (state === 'picked' && picked) {
      return i18n.t('minepick.board.picked', { name: keptCard?.getName(i18n.getLang()) ?? picked.key });
    }
    if (state === 'locked') {
      return i18n.t('minepick.board.locked');
    }
    return i18n.t('minepick.board.count', { cards: entry.cards.length });
  }

  /**
   * Builds one face-up thumbnail of a pack.
   *
   * @param {object} card - Card to display.
   * @param {object} [options] - Thumbnail options.
   * @param {boolean} [options.revealed=false] - True once the pack was opened and picked from: only
   *   then does the thumbnail carry the rarity ring of the card (see `css/views/minepick.css`).
   * @param {boolean} [options.kept=false] - True for the card the player kept (marked).
   * @param {boolean} [options.discarded=false] - True for a card that was offered but not kept.
   * @returns {HTMLElement} The `<li>` of the pack.
   */
  buildMiniCard(card, { revealed = false, kept = false, discarded = false } = {}) {
    const item = document.createElement('li');
    item.className = `minepick__mini minepick__mini--r${card.rarity}`;
    if (card.isFullArt) item.classList.add('minepick__mini--fullart');
    if (revealed) {
      item.classList.add('is-revealed');
      // The halo names the rarity, so it follows the same rule as the ring of the thumbnail: only
      // once the pack has been opened AND picked from. Before that the board would announce where
      // every legendary is.
      applyCardGlow(item, card);
    }
    if (kept) item.classList.add('is-kept');
    if (discarded) item.classList.add('is-discarded');

    const image = document.createElement('img');
    image.className = 'minepick__mini-image';
    image.src = i18n.resolveImagePath(card.illustration);
    image.alt = this.describeCard(card);
    image.loading = 'lazy';
    image.decoding = 'async';
    item.appendChild(image);

    if (kept) {
      const flag = document.createElement('span');
      flag.className = 'minepick__mini-flag';
      flag.textContent = i18n.t('minepick.board.pickedFlag');
      item.appendChild(flag);
    }
    return item;
  }

  /**
   * Describes a card for screen readers ("Name — Rarity").
   *
   * @param {object} card - Card to describe.
   * @returns {string} The description.
   */
  describeCard(card) {
    return `${card.getName(i18n.getLang())} (${getRarityLabel(card.rarity, (key) => i18n.t(key))})`;
  }

  /**
   * Handles a click on the list: the booster button, or anywhere on a pickable line.
   *
   * Two taps to open a pack, and the first one only selects: a pick is spent for good, so it can
   * not be triggered by a thumb sliding over the list. Clicking the row of the SELECTED booster
   * opens it, which is also what its button does.
   *
   * @param {MouseEvent} event - Click event (delegated).
   * @returns {Promise<void>} Resolves once the booster is selected or displayed.
   */
  async handleBoardClick(event) {
    const cell = event?.target?.closest?.('[data-minepick-index]');
    if (!cell) return;

    const button = event.target.closest('[data-minepick-open]');
    if (button?.disabled) return;

    const row = cell.closest('.minepick__row') ?? cell;
    const state = row.dataset.minepickState;
    if (state === 'picked') {
      this.setFeedback('minepick.error.alreadyPicked', 'error');
      return;
    }
    if (state === 'locked') {
      this.setFeedback('minepick.error.noPick', 'error');
      return;
    }

    const index = Number(cell.dataset.minepickIndex);
    if (!Number.isInteger(index)) return;
    if (this.selectedIndex !== index) {
      this.selectBooster(index);
      return;
    }
    await this.openBooster(index);
  }

  /**
   * Marks one booster of the list as the chosen one (no pick is spent yet).
   *
   * @param {number} index - Index of the booster on the board.
   * @returns {void}
   */
  selectBooster(index) {
    this.selectedIndex = index;
    this.setFeedback(null);
    this.renderBoard(true);
    this.log(`Booster #${index} selected (not opened yet).`);
  }

  /**
   * Clears the selection.
   *
   * @returns {void}
   */
  clearSelection() {
    this.selectedIndex = null;
  }

  /**
   * Shows the cards of a booster, face up, then turns them over and shuffles them.
   *
   * @param {number} index - Index of the booster on the board.
   * @returns {Promise<void>} Resolves once the sequence started.
   */
  async openBooster(index) {
    const entry = this.board.find((candidate) => candidate.index === index);
    if (!entry) {
      console.warn(`[MinePickView] Booster #${index} is not on the board.`);
      return;
    }
    if (this.picksByBooster[String(index)]) {
      this.setFeedback('minepick.error.alreadyPicked', 'error');
      return;
    }

    const state = await minePickManager.getState();
    this.remaining = state.remaining;
    this.bonusPicks = state.bonusPicks ?? 0;
    this.picksByBooster = state.picksByBooster ?? {};
    if (this.availablePicks <= 0) {
      this.setFeedback('minepick.error.noPick', 'error');
      this.renderBoard();
      return;
    }

    this.clearCards();
    this.boosterIndex = index;
    this.keptIndex = null;
    this.isPicking = false;
    this.canPick = false;
    this.clearSelection();
    this.resultElement.hidden = true;
    this.setFeedback(null);

    if (this.setNameElement) {
      this.setNameElement.textContent = i18n.t('minepick.stage.title', {
        index: index + 1,
        name: entry.name ?? entry.setId,
      });
    }
    this.setHint('minepick.hint.preview');

    this.buildPack();
    this.showStage('pick');
    this.flashStage();
    this.runOpenSequence(entry);
    this.log(`Booster #${index} dealt face up (${entry.cards.length} card(s)).`);
  }

  /**
   * Fires the light burst of the "pack lands here" moment.
   *
   * The animation itself lives in `css/views/minepick.css` (`.is-dealing`); the class is dropped
   * when it is over so the next opening replays it, and it is only there for decoration - a
   * reduced-motion player never sees it. Yes, `offsetWidth` below is a reflow asked on purpose
   * (the classic way to restart a CSS animation), not an accident.
   *
   * @returns {void}
   */
  flashStage() {
    if (!this.cardsElement) return;
    this.cardsElement.classList.remove('is-dealing');
    void this.cardsElement.offsetWidth;
    this.cardsElement.classList.add('is-dealing');
    this.setViewTimeout(() => this.cardsElement?.classList.remove('is-dealing'), DEAL_MS + FLIP_STEP_MS * 4);
  }

  /**
   * Creates the five cards of the current booster, in the order they were drawn.
   *
   * Every card remembers its own position in the pack (`data-minepick-card`), NOT its position on
   * screen: the shuffle moves the elements around, and the pick must always name the same card.
   *
   * @returns {void}
   */
  buildPack() {
    const entry = this.board.find((candidate) => candidate.index === this.boosterIndex);
    if (!entry) return;

    entry.cards.forEach((card, cardIndex) => {
      const component = new CardComponent(card, { isNew: false, flipOnClick: false });
      const element = component.render();
      element.dataset.minepickCard = String(cardIndex);
      // The rarity is duplicated on the stage element as a plain class: the ring of the card is
      // drawn by `minepick.css`, which must not have to know the internal classes of `CardComponent`.
      element.classList.add('minepick__card', `minepick__card--r${card.rarity}`);
      element.disabled = true;
      this.cardComponents.push(component);
      this.cardsElement.appendChild(element);
    });
  }

  /**
   * Plays the opening ritual: deal, look at the pack, turn it over, shuffle, then hand over.
   *
   * Every step honours the durations of the active animation mode, and every timer goes through
   * `setViewTimeout()` so leaving the view in the middle of the sequence cancels the rest.
   *
   * @param {{order: number[], cards: Array}} entry - Board entry being opened.
   * @returns {void}
   */
  runOpenSequence(entry) {
    const flipMs = this.resolveFlipDuration();
    const step = FLIP_STEP_MS;
    const lastFlipStart = DEAL_MS + step * (this.cardComponents.length - 1);
    const flipUpEnd = lastFlipStart + flipMs;
    const study = this.resolveStudyDuration();
    const flipDownStart = flipUpEnd + study;
    const flipDownEnd = flipDownStart + step * (this.cardComponents.length - 1) + flipMs;
    const shuffle = this.resolveShuffleDuration();

    this.cardComponents.forEach((component, index) => {
      // Face up: the pack the player chose in the list, shown exactly as it was listed.
      this.setViewTimeout(() => {
        component.element.classList.add('is-preview');
        if (index === 0) soundManager.play(SOUNDS.CARD_RETURN);
      }, DEAL_MS + step * index);

      // Face down again, one card after another. `is-turning` carries the motion and goes away
      // when it is done, so the inline styles of the shuffle start from a clean card.
      this.setViewTimeout(() => this.turnCardDown(component, flipMs), flipDownStart + step * index);
    });

    this.setViewTimeout(() => this.setHint('minepick.hint.mixing'), flipDownStart);
    this.setViewTimeout(() => this.shuffleCards(entry.order), flipDownEnd);
    this.setViewTimeout(() => this.releasePack(), flipDownEnd + shuffle + 60);

    this.log(
      `Sequence armed: preview ${DEAL_MS} ms + ${Math.round(flipMs)} ms, study ${study} ms, shuffle ${shuffle} ms.`
    );
  }

  /**
   * Turns one card face down, with the little lift of the turn-over animation.
   *
   * @param {CardComponent} component - Card to turn over.
   * @param {number} flipMs - Duration of the movement, in milliseconds.
   * @returns {void}
   */
  turnCardDown(component, flipMs) {
    const element = component.element;
    if (!element) return;
    element.classList.remove('is-preview');
    element.classList.add('is-turning');
    this.setViewTimeout(() => element.classList.remove('is-turning'), Math.max(flipMs, 120) + 40);
  }

  /**
   * Enables the pick once the pack is face down and shuffled.
   *
   * @returns {void}
   */
  releasePack() {
    this.cardComponents.forEach((component) => {
      if (component.element) component.element.disabled = false;
    });
    this.canPick = true;
    this.cardsElement?.classList.remove('is-shuffling');
    this.setHint('minepick.hint');
    this.log('Pack shuffled: the player can pick.');
  }

  /**
   * Shuffles the pack by piling every card in ONE place, face down.
   *
   * Tracking a card from its slot to another would defeat the whole ritual: a player who can
   * follow the one they want would not be picking at random any more. So the pack is NOT spread into
   * its new order at all: every card travels to the same point, in the middle of the stage, where
   * they all end up stacked on top of each other. The DOM is reordered while they are in that pile
   * (an invisible moment: same place, same face), then they fly back out to the five slots, where
   * any of them could be the one that started anywhere.
   *
   * @param {number[]} order - Display order: slot `d` holds the card `order[d]`.
   * @returns {void}
   */
  shuffleCards(order) {
    const elements = this.cardComponents.map((component) => component.element);
    if (elements.some((element) => !element)) return;
    if (!Array.isArray(order) || order.length !== elements.length) {
      this.log('Shuffle skipped: the pack has no valid order.');
      this.releasePack();
      return;
    }

    const duration = this.resolveShuffleDuration();
    // The turn-down animation of the last card may still own `transform`: it has to go before an
    // inline translation can move the card.
    this.cardComponents.forEach((component) => component.element?.classList.remove('is-turning'));
    if (duration <= 0) {
      this.applyCardOrder(order, elements);
      return;
    }

    // The three beats of the gesture: gather into the pile, hold it, then deal back out of it.
    const gather = Math.round(duration * 0.4);
    const spread = Math.max(0, duration - gather - PILE_HOLD_MS);
    const stage = this.cardsElement.getBoundingClientRect();
    const center = {
      x: stage.left + stage.width / 2,
      y: stage.top + stage.height / 2,
    };
    const tilts = [-5, 4, -3, 6, -6];

    elements.forEach((element) => {
      element.style.transition = 'none';
      element.style.transform = '';
    });
    void this.cardsElement.offsetWidth;

    // 1. Every card, to the same point. The slight tilts and the z-index make a believable pile
    //    instead of five cards perfectly glued together.
    elements.forEach((element, index) => {
      const rect = element.getBoundingClientRect();
      const deltaX = center.x - (rect.left + rect.width / 2);
      const deltaY = center.y - (rect.top + rect.height / 2);
      element.style.transition = `transform ${gather}ms var(--easing-standard)`;
      element.style.transform =
        `translate(${deltaX}px, ${deltaY}px) rotate(${tilts[index % tilts.length]}deg) scale(0.9)`;
      element.style.zIndex = String(index + 1);
    });

    // The wobble rides on the independent `rotate`/`scale` properties, which composes with the
    // inline translation instead of fighting it. The duration rides on the container so the
    // stylesheet does not have to guess how long this shuffle lasts.
    this.cardsElement.style.setProperty('--minepick-shuffle-ms', `${duration}ms`);
    this.cardsElement.classList.remove('is-shuffling');
    void this.cardsElement.offsetWidth;
    this.cardsElement.classList.add('is-shuffling');

    this.shuffleTimer = this.setViewTimeout(
      () => this.dealFromPile(order, { center, spread, tilts }),
      gather + PILE_HOLD_MS
    );
  }

  /**
   * Reorders the pack inside the pile, then deals it back out to the five slots.
   *
   * The reorder happens with every card still at the same place and under the same face: the browser
   * paints once, at the end of this task, so not a single frame ever shows a card jumping to another
   * slot. What leaves the pile is therefore a pack nobody can map back to the one that went in.
   *
   * @param {number[]} order - Display order: slot `d` holds the card `order[d]`.
   * @param {{center: {x: number, y: number}, spread: number, tilts: number[]}} scene - Geometry of
   *   the gesture, measured by `shuffleCards()`.
   * @returns {void}
   */
  dealFromPile(order, { center, spread, tilts }) {
    const elements = this.cardComponents.map((component) => component.element);
    if (elements.some((element) => !element)) return;

    elements.forEach((element) => {
      element.style.transition = 'none';
      element.style.transform = '';
    });
    void this.cardsElement.offsetWidth;
    this.applyCardOrder(order, elements);

    // 2. Back on the pile, from the fresh layout of each card's NEW slot: one synchronous block, so
    //    the swap itself is never painted.
    elements.forEach((element, index) => {
      const rect = element.getBoundingClientRect();
      const deltaX = center.x - (rect.left + rect.width / 2);
      const deltaY = center.y - (rect.top + rect.height / 2);
      element.style.transition = 'none';
      element.style.transform =
        `translate(${deltaX}px, ${deltaY}px) rotate(${tilts[index % tilts.length]}deg) scale(0.9)`;
    });
    void this.cardsElement.offsetWidth;

    // 3. And out to the slots, where the pack is finally handed to the player.
    elements.forEach((element) => {
      element.style.transition = `transform ${spread}ms var(--easing-standard)`;
      element.style.transform = '';
    });
    this.shuffleTimer = this.setViewTimeout(() => this.clearShuffleTransforms(), spread + 40);
  }

  /**
   * Reorders the card elements to the shuffled positions (no animation).
   *
   * @param {number[]} order - Display order: slot `d` holds the card `order[d]`.
   * @param {HTMLElement[]} elements - Card elements, indexed by card position in the pack.
   * @returns {void}
   */
  applyCardOrder(order, elements) {
    order.forEach((cardIndex) => {
      const element = elements[cardIndex];
      if (element) this.cardsElement.appendChild(element);
    });
  }

  /**
   * Drops the inline transforms left by the shuffle.
   *
   * A kept card is turned over with `transform: rotateY(180deg)` (`css/components/card-reveal.css`):
   * an inline translation would win over it, so the shuffle must be fully cleaned up before the
   * first flip.
   *
   * @returns {void}
   */
  clearShuffleTransforms() {
    if (this.shuffleTimer !== null) {
      window.clearTimeout(this.shuffleTimer);
      this.shuffleTimer = null;
    }
    this.cardComponents.forEach((component) => {
      const element = component.element;
      if (!element) return;
      element.style.transition = '';
      element.style.transform = '';
      element.style.zIndex = '';
    });
  }

  /**
   * Writes the hint line under the title of the pack.
   *
   * @param {string} key - Translation key.
   * @returns {void}
   */
  setHint(key) {
    this.hintKey = key;
    if (this.hintElement) this.hintElement.textContent = i18n.t(key);
  }

  /**
   * Handles a click on a face-down card: keeps it, then reveals the rest of the pack.
   *
   * @param {MouseEvent} event - Click event (delegated).
   * @returns {Promise<void>} Resolves once the pick is committed and revealed.
   */
  async handleCardsClick(event) {
    const element = event?.target?.closest?.('[data-minepick-card]');
    if (!element || this.isPicking || this.keptIndex !== null) return;
    if (!this.canPick) {
      this.log('Pick ignored: the pack is still being dealt and shuffled.');
      return;
    }
    const cardIndex = Number(element.dataset.minepickCard);
    if (!Number.isInteger(cardIndex) || this.boosterIndex === null) return;

    this.isPicking = true;
    this.canPick = false;
    this.setFeedback(null);
    this.clearShuffleTransforms();
    this.lockCards();

    let result;
    try {
      result = await minePickManager.pick(this.boosterIndex, cardIndex);
    } catch (error) {
      console.error('[MinePickView] The pick failed.', error);
      this.isPicking = false;
      this.canPick = true;
      this.unlockCards();
      this.setFeedback(getMinePickErrorMessageKey(error?.code), 'error');
      if (error?.code === MINE_PICK_ERRORS.NO_PICK_LEFT || error?.code === MINE_PICK_ERRORS.ALREADY_PICKED) {
        await this.refreshQuota().catch((error2) => {
          console.warn('[MinePickView] The allowance could not be refreshed.', error2);
        });
      }
      return;
    }

    this.keptIndex = cardIndex;
    const kept = this.cardComponents[cardIndex];
    kept?.render().classList.add('is-kept');
    this.hitStage();
    if (kept?.flip()) {
      // The kept card gets the full sting of its rarity: it is the one that joins the collection.
      soundManager.playCardReveal(result.card.rarity);
    }
    this.announceResult(result);
    this.revealOtherCards(cardIndex);
    await this.refreshQuota();
    this.isPicking = false;
    this.log(`Kept "${result.card.uniqueKey}" (${result.remaining} pick(s) left).`);
  }

  /**
   * Sends the shockwave of the stage when a card is kept.
   *
   * The animation lives on the stage container (`.is-hitting`, `css/views/minepick.css`) rather
   * than on the card: the card is already busy playing the flip of the current animation mode,
   * and two animations on the same property would have meant choosing between them.
   *
   * @returns {void}
   */
  hitStage() {
    if (!this.cardsElement) return;
    this.cardsElement.classList.remove('is-hitting');
    // A reflow between the two writes, so a second pick replays the animation.
    void this.cardsElement.offsetWidth;
    this.cardsElement.classList.add('is-hitting');
    this.setViewTimeout(() => this.cardsElement?.classList.remove('is-hitting'), 900);
  }

  /**
   * Blocks the pack while the pick is being committed.
   *
   * @returns {void}
   */
  lockCards() {
    this.cardComponents.forEach((component) => {
      if (component.element) component.element.disabled = true;
    });
  }

  /**
   * Gives the pack back to the player (a refused pick must not freeze the screen).
   *
   * @returns {void}
   */
  unlockCards() {
    this.cardComponents.forEach((component) => {
      if (component.element && this.keptIndex === null) component.element.disabled = false;
    });
  }

  /**
   * Turns the other cards of the pack over, one after another.
   *
   * @param {number} keptIndex - Index already revealed.
   * @returns {void}
   */
  revealOtherCards(keptIndex) {
    const step = this.resolveRevealStep();
    let lastTurn = 0;
    this.cardComponents.forEach((component, index) => {
      if (index === keptIndex) return;
      const delay = step * (index + 1);
      lastTurn = Math.max(lastTurn, delay);
      this.setViewTimeout(() => {
        if (component.flip()) {
          soundManager.play(SOUNDS.CARD_RETURN);
        }
      }, delay);
    });
    // The rarity rings of the pack appear ONLY once the last card has finished turning over: the
    // pack keeps its secret until the player has looked at all five of them.
    this.setViewTimeout(() => this.markPackRevealed(), lastTurn + this.resolveFlipDuration());
  }

  /**
   * Marks the end of the pick: every card of the pack is face up.
   *
   * This is the ONLY moment the rarity rings of the pick stage appear (`.is-summary`, see the rarity
   * rules of `css/views/minepick.css`). Drawn any earlier - they used to be drawn from the deal, on
   * every card of the pack - they hand the player the rarity of the four cards they did not keep
   * while those are still turning over, which is exactly what a face-down pack is there to hide.
   *
   * @returns {void}
   */
  markPackRevealed() {
    this.cardsElement?.classList.add('is-summary');
  }

  /**
   * Delay between two reveals, from the active animation mode.
   *
   * TODO: the two bounds below are hard-coded on purpose for now. If a fourth mode ever shows up,
   * move them to `settings/config.json` (`minePick.revealStepMs`) instead of piling up clamps here.
   *
   * @returns {number} A duration in milliseconds, clamped for an automatic sequence.
   */
  resolveRevealStep() {
    const { flipMs } = animationManager.getTiming();
    return Math.min(Math.max(flipMs, REVEAL_STEP_MIN_MS), REVEAL_STEP_MAX_MS);
  }

  /**
   * Duration of one card flip, from the active animation mode.
   *
   * @returns {number} A duration in milliseconds.
   */
  resolveFlipDuration() {
    return Math.max(0, animationManager.getTiming().flipMs);
  }

  /**
   * How long the pack stays face up for the player to study it.
   *
   * @returns {number} A duration in milliseconds, clamped so a slow mode does not become a wait.
   */
  resolveStudyDuration() {
    const { flipMs } = animationManager.getTiming();
    return Math.min(Math.max(flipMs * STUDY_FLIP_FACTOR, STUDY_MIN_MS), STUDY_MAX_MS);
  }

  /**
   * Duration of the shuffle movement.
   *
   * @returns {number} A duration in milliseconds; 0 when the player asked for reduced motion.
   */
  resolveShuffleDuration() {
    if (this.prefersReducedMotion()) return 0;
    const { flipMs } = animationManager.getTiming();
    return Math.min(Math.max(flipMs, SHUFFLE_MIN_MS), SHUFFLE_MAX_MS);
  }

  /**
   * Tells whether the player asked the system for reduced motion.
   *
   * @returns {boolean} True when animations should be avoided.
   */
  prefersReducedMotion() {
    return Boolean(
      typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  /**
   * Writes the result line: the kept card, its rarity, the "new" flag and the remaining picks.
   *
   * @param {{card: object, isNew: boolean, remaining: number, godpack: boolean}} result - Committed pick.
   * @returns {void}
   */
  announceResult(result) {
    const name = result.card.getName(i18n.getLang());
    const rarity = getRarityLabel(result.card.rarity, (key) => i18n.t(key));
    const parts = [i18n.t('minepick.result.kept', { name, rarity })];
    if (result.isNew) parts.push(i18n.t('minepick.result.new'));
    if (result.godpack) parts.push(i18n.t('minepick.result.godpack'));
    parts.push(i18n.t('minepick.result.remaining', { count: result.remaining }));
    this.resultElement.textContent = parts.join(' · ');
    this.resultElement.hidden = false;
  }

  /**
   * Shows one of the two stages of the screen.
   *
   * @param {'board'|'pick'} stage - Stage to display.
   * @returns {void}
   */
  showStage(stage) {
    const showPick = stage === 'pick';
    if (this.boardStage) this.boardStage.hidden = showPick;
    if (this.pickStage) this.pickStage.hidden = !showPick;
    // The pick is a ritual: from the moment the pack is dealt until the player goes back to the
    // list, the brand, the counters, the bottom bar, the "how does it work" pill and the title of
    // the view step aside so nothing competes with the cards (`setFocusMode`, `css/base.css`). The
    // "Retour aux boosters" button of the stage keeps a way out at every instant, including on the
    // result screen, which is part of the same stage.
    setFocusMode(showPick);
    this.log(`Stage displayed: ${stage} (focus mode ${showPick ? 'on' : 'off'}).`);
  }

  /**
   * Returns to the list, where the booster just played shows the card that was kept.
   *
   * @returns {void}
   */
  backToBoard() {
    this.clearCards();
    this.boosterIndex = null;
    this.keptIndex = null;
    this.canPick = false;
    this.clearSelection();
    this.showStage('board');
    this.renderBoard(true);
    void this.refreshQuota().catch((error) => {
      console.warn('[MinePickView] The allowance could not be refreshed.', error);
    });
  }

  /**
   * Removes the displayed cards, cancels the pending timers and drops the shuffle transforms.
   *
   * @returns {void}
   */
  clearCards() {
    this.clearTimers();
    this.clearShuffleTransforms();
    this.cardComponents.forEach((component) => component.destroy());
    this.cardComponents = [];
    if (this.cardsElement) {
      this.cardsElement.textContent = '';
      // The classes of the sequence live on the container, not on the cards it just dropped. The
      // RINGS of the pack go with them: a new pack starts with its rarities hidden again.
      this.cardsElement.classList.remove('is-dealing', 'is-shuffling', 'is-hitting', 'is-summary');
    }
    this.keptIndex = null;
    this.isPicking = false;
    this.canPick = false;
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
   * Cancels every timer of the sequences still in flight.
   *
   * @returns {void}
   */
  clearTimers() {
    this.timers.forEach((timer) => window.clearTimeout(timer));
    this.timers = [];
  }

  /**
   * Writes the feedback line.
   *
   * @param {string|null} key - Translation key, or null to clear the line.
   * @param {'info'|'error'} [tone='info'] - Tone of the message.
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
   * Re-translates the labels when the language changes.
   *
   * The cards themselves follow the language on their own (`CardComponent` listens to
   * `LANG_CHANGED`): the list, the hints and the result line are rewritten here.
   *
   * @returns {void}
   */
  handleLanguageChanged() {
    this.log(`Language changed, re-rendering (${i18n.getLang()}).`);
    this.renderBoard(true);
    if (this.feedback) {
      this.setFeedback(this.feedback.key, this.feedback.tone, this.feedback.params);
    }
    if (this.hintKey) {
      this.setHint(this.hintKey);
    }
    void this.refreshQuota().catch((error) => {
      console.warn('[MinePickView] The allowance could not be refreshed.', error);
    });
  }

  /**
   * Keeps the countdown to the next reset up to date.
   *
   * @param {{timeUntilReset?: string}|null} payload - Clock tick payload.
   * @returns {void}
   */
  handleClockTick(payload) {
    if (!payload || typeof payload.timeUntilReset !== 'string') return;
    if (this.countdownElement && !this.countdownElement.hidden && this.countdownValue) {
      this.countdownValue.textContent = payload.timeUntilReset;
    }
  }

  /**
   * Reloads the list and the allowance when the view becomes active (the day may have changed).
   *
   * The screen deliberately comes back on the LIST, never on a half-finished pick: leaving the tab
   * in the middle of a pack would otherwise keep the pick stage on screen, with the boosters hidden
   * behind it and no way back but a manual reload. A forgotten pack is simply dealt again (it is the
   * same seeded pack) when its booster is opened again.
   *
   * @returns {void}
   */
  handleViewActivated() {
    this.isActive = true;
    this.log('View activated.');
    this.setFeedback(null);
    this.clearCards();
    this.boosterIndex = null;
    this.clearSelection();
    if (this.resultElement) this.resultElement.hidden = true;
    this.showStage('board');
    // The balance may have moved while another view was open (a card sold or bought).
    void this.refreshSparksBalance();
    void this.reload().catch((error) => {
      console.error('[MinePickView] The board could not be reloaded.', error);
      this.setFeedback('minepick.error.board', 'error');
    });
  }

  /**
   * Marks the view as inactive.
   *
   * @returns {void}
   */
  handleViewDeactivated() {
    this.isActive = false;
    this.log('View deactivated.');
    // Leaving mid-pick (a deep link, the back button) gives the chrome back: the focus class
    // belongs to the screen, not to the pack being studied.
    setFocusMode(false);
  }

  /**
   * Removes every listener, timer and card.
   *
   * @returns {void}
   */
  destroy() {
    this.log('Destroying the view.');
    setFocusMode(false);
    this.clearCards();
    this.bindings.forEach(({ target, type, handler }) => target.removeEventListener(type, handler));
    this.bindings = [];
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers = [];
    this.board = [];
    this.picksByBooster = {};
    this.boardSignature = '';
    this.selectedIndex = null;
    this.isInitialized = false;
  }
}

export default MinePickView;

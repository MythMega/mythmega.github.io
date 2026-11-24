/**
 * TradeIndicators - the dots that announce a trade, and the notifications of the steps the OTHER
 * player takes.
 *
 * Reference: `js/business/TradeManager.js` (what a refresh observes, and what it announces).
 *
 * WHAT IT IS
 *   Three places of the shell answer the same question ("is there anything to do in the trade
 *   tab?"): the menu button of the bottom bar, the "Social" row of the floating menu and the
 *   "Échanges" tab of the Social page. They all carry the same `data-trade-dot` attribute, painted
 *   ORANGE while a trade is running and GREEN as soon as one of them waits for this player to claim
 *   the card it received (the dot rules live in `css/base.css`, with one position per place).
 *
 * WHERE THE STATE COMES FROM
 *   `TradeManager` emits `TRADE_ATTENTION` on every refresh it completes, so the dots are right at
 *   boot (the start-up refresh) and after every action of the trade tab, without a request of their
 *   own. A refresh that fails leaves the last known state alone: an unknown state is not a finished
 *   one, and clearing the dot would hide a card still waiting to be claimed.
 *
 * NOTIFICATIONS
 *   A step this player did not take (a request, a counter-proposal, an acceptance, a refusal, an
 *   expiry, a completion) is announced by a notification, which opens the trade tab when it is
 *   clicked - the item only carries `{ view, tab }` and the application binds that action to its
 *   router (see `handleNotificationAction()` of `js/app.js`). The one player who does not need the
 *   message is the one already reading that tab: its own refresh paints the change, so a trade item
 *   is dropped while the tab is on screen.
 *
 * BACKGROUND REFRESH
 *   Nothing else asks the worker on a timer: the boot asks once, the trade tab asks when it opens.
 *   A step taken by the other player in the meantime would therefore stay silent for the whole
 *   session, and the dots would describe the last time the page was loaded. This component is what
 *   makes both true: it refreshes the trades on a slow timer, and again when the page becomes
 *   visible (the phone was away, which is exactly when the other player had the time to act). The
 *   timer never runs twice at once, is skipped while the page is hidden or offline, and a failure
 *   is only logged - the game keeps working without the worker.
 */

import eventBus, { EVENTS } from '../../utils/EventBus.js';
import notificationCenter, { NOTIFICATION_TYPES } from './NotificationCenter.js';
import tradeManager from '../../business/TradeManager.js';

/** How often the trades are re-read while the page is visible, in milliseconds. */
export const TRADE_POLL_MS = 3 * 60_000;

/** Values of `data-trade-dot`, matching the rules of `css/base.css`. */
export const TRADE_DOT_STATES = Object.freeze({
  /** A trade is running and waits for someone (orange). */
  ACTIVE: 'active',
  /** A card received waits for this player to claim it (green). */
  READY: 'ready',
});

export class TradeIndicators {
  /**
   * @param {ParentNode} [root=document] - Subtree scanned for the marked elements.
   */
  constructor(root = document) {
    this.root = root;
    /** @type {{active: boolean, ready: boolean}} Last known state of the trade lists. */
    this.state = { active: false, ready: false };
    /** @type {HTMLElement[]} Elements that carry the dot. */
    this.targets = [];
    /** @type {number|null} Background refresh timer. */
    this.timer = null;
    /** @type {boolean} True while a background refresh is in flight. */
    this.isRefreshing = false;
    this.isInitialized = false;
  }

  /**
   * Finds the three marked places, follows `TRADE_ATTENTION` and starts the slow timer.
   *
   * @returns {void}
   */
  init() {
    if (this.isInitialized) return;
    this.isInitialized = true;

    // The trade tab is painted last: `SocialView.init()` builds it from the same markup, and the
    // tab element itself is static, so looking it up here is enough.
    this.targets = [
      this.root.querySelector('[data-app-menu-toggle]'),
      this.root.querySelector('[data-app-menu] [data-nav-target="social"]'),
      this.root.querySelector('[data-social-tab="trade"]'),
    ].filter((element) => element !== null);

    eventBus.on(EVENTS.TRADE_ATTENTION, (payload) => this.update(payload));

    this.visibilityHandler = () => {
      if (!document.hidden) void this.refreshInBackground();
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);

    this.timer = window.setInterval(() => void this.refreshInBackground(), TRADE_POLL_MS);
    this.log(`Watching ${this.targets.length} place(s), polling every ${TRADE_POLL_MS / 1000}s.`);
  }

  /**
   * Logs with the component prefix.
   *
   * @param {...unknown} args - Values forwarded to `console.info`.
   * @returns {void}
   */
  log(...args) {
    console.info('[TradeIndicators]', ...args);
  }

  /**
   * Applies one `TRADE_ATTENTION` payload to every marked place.
   *
   * @param {{active?: boolean, ready?: boolean}|null} payload - Event payload.
   * @returns {void}
   */
  update(payload) {
    this.state = { active: payload?.active === true, ready: payload?.ready === true };
    const value = this.state.ready
      ? TRADE_DOT_STATES.READY
      : this.state.active
        ? TRADE_DOT_STATES.ACTIVE
        : '';

    this.targets.forEach((element) => {
      if (value === '') delete element.dataset.tradeDot;
      else element.dataset.tradeDot = value;
    });
  }

  /**
   * Tells whether the player is currently reading the trade tab.
   *
   * Read from the DOM on purpose: the panel is only `hidden` while another tab is shown, and the
   * whole Social view is only `is-active` while it is on screen. Both facts are needed, because a
   * player who leaves the page while the trade tab is selected keeps `hidden` at false.
   *
   * @returns {boolean} True when the trade tab is on screen.
   */
  isTradeTabVisible() {
    const panel = this.root.querySelector('[data-social-panel="trade"]');
    if (!panel || panel.hidden) return false;
    const view = panel.closest('[data-view]');
    return view?.classList.contains('is-active') === true;
  }

  /**
   * Displays the transitions observed by a refresh.
   *
   * A trade item is dropped while the trade tab is on screen: the change it describes is already
   * painted in the list the player is looking at, and a message on top of it would only repeat it.
   *
   * @param {object[]} items - Items built by `TradeManager`.
   * @returns {void}
   */
  pushNotifications(items) {
    if (!Array.isArray(items)) return;
    const inTradeTab = this.isTradeTabVisible();
    items.forEach((item) => {
      if (inTradeTab && item?.type === NOTIFICATION_TYPES.TRADE) {
        this.log(`Dropped "${item.title}" (the trade tab is on screen).`);
        return;
      }
      notificationCenter.push(item);
    });
  }

  /**
   * Re-reads the trades in the background and announces what changed.
   *
   * The dots follow the refresh by themselves (`TRADE_ATTENTION`). Nothing throws: a player who is
   * offline, or a worker that answers an error, must not see a broken game for it.
   *
   * @returns {Promise<void>} Always resolves.
   */
  async refreshInBackground() {
    if (this.isRefreshing) return;
    if (document.hidden) return;
    if (navigator.onLine === false) return;
    this.isRefreshing = true;
    try {
      const view = await tradeManager.refresh({ silent: true });
      this.pushNotifications(view.notifications);
    } catch (error) {
      console.warn('[TradeIndicators] The trades could not be refreshed in the background.', error);
    } finally {
      this.isRefreshing = false;
    }
  }
}

/** One instance for the whole application: the three places share the same truth. */
export default new TradeIndicators();

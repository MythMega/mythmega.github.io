/**
 * TradeView - The "Échanges" tab of the Social page.
 *
 * The view owns the DOM only: `TradeManager` speaks to the worker and to the local escrow,
 * `SocialManager` provides the followed players, `CollectionManager` the cards that can be offered.
 *
 * TRADE RULES
 *   A promo card is never offered, both cards always share one rarity, the extensions closed by
 *   `settings/cardsets.json` stay out of both lists (`trade` flag) and `trades.sameExtension` of
 *   `settings/config.json` restricts a proposal to the extension of the incoming card. The rules
 *   themselves live in `TradeManager`; this view only asks for the accepted cards.
 *
 * THREE DIALOGS
 *   - `new`: choose a followed player and one duplicate of rarity 1-5, see the cost (1 Ender Eye
 *     per rarity + rarity² Sparks) and send the request;
 *   - `proposal`: answer an incoming request with a card of the same rarity;
 *   - `confirm`: a single confirmation dialog for the irreversible actions (deny, cancel, accept),
 *     with the worker error shown inside the dialog rather than behind it.
 *
 * CLAIM ANIMATION
 *   When both sides agreed, each player "récupère" their card: the card given rises out of the
 *   stage, then the card received drops in from the top. The animation is a pure CSS timeline
 *   (`css/views/social.css`), started by one class, so it can be skipped by `prefers-reduced-motion`.
 */

import i18n from '../../utils/I18n.js';
import Toast from '../components/Toast.js';
import tradeIndicators from '../components/TradeIndicators.js';
import socialManager, {
  getSocialErrorMessageKey,
  safeSocialAssetPath,
} from '../../business/SocialManager.js';
import collectionManager from '../../business/CollectionManager.js';
import boosterManager from '../../business/BoosterManager.js';
import accountManager from '../../business/AccountManager.js';
import wishlistManager from '../../business/WishlistManager.js';
import sparksManager from '../../business/SparksManager.js';
import { buildPrice } from '../components/PriceIcons.js';
import {
  askWishlistRemoval,
  WISHLIST_POPUP_ANSWERS,
} from '../components/WishlistRemovePopup.js';
import friendshipManager from '../../business/FriendshipManager.js';
import { buildFriendshipLevel } from '../components/FriendshipLevel.js';
import tradeManager, {
  TRADE_EXPIRY_HOURS,
  TRADE_MAX_ENDER_EYES,
  TRADE_MAX_RARITY,
  TRADE_MIN_RARITY,
  TRADE_STATUSES,
  getTradeCost,
  getTradeErrorMessageKey,
} from '../../business/TradeManager.js';

/** How long a loaded trade list is considered fresh when the tab is shown again. */
const TRADE_VIEW_CACHE_MS = 15_000;

/** How long the claim animation runs before the dialog can be closed, in milliseconds. */
const CLAIM_ANIMATION_MS = 7800;

/** How long after one of our own actions the lists are fetched again, in milliseconds. */
const TRADE_AUTO_REFRESH_MS = 500;

/** Sorts offered by the card chooser, matching the `data-trade-cards-sort` values. */
const CARD_SORT_MODES = Object.freeze(['rarity', 'quantity', 'number']);

/**
 * Normalizes a card search text: lowercased, without diacritics or repeated spaces.
 *
 * @param {unknown} value - Typed query.
 * @returns {string} The comparable text.
 */
function normalizeCardQuery(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Builds the searchable text of one card: its name in the active language, its id and its key.
 *
 * @param {{card?: object, cardId?: string, key?: string}} entry - Collection entry, or a bare key.
 * @returns {string} The normalized text.
 */
function cardHaystack(entry) {
  const name =
    typeof entry?.card?.getName === 'function' ? entry.card.getName(i18n.getLang()) : '';
  return normalizeCardQuery([name, entry?.cardId ?? '', entry?.key ?? ''].join(' '));
}

/**
 * Reads the printed number of a card ("SERIE-A1 / W001").
 *
 * @param {object} entry - Collection entry.
 * @returns {string} The printed index, or the card id when the catalogue has none.
 */
function cardNumber(entry) {
  const index = typeof entry?.card?.index === 'string' ? entry.card.index.trim() : '';
  return index || String(entry?.cardId ?? '');
}

export class TradeView {
  /**
   * @param {HTMLElement} rootElement - The `[data-social-panel="trade"]` element.
   * @param {HTMLElement} [scopeElement=rootElement] - Element owning the dialogs (the Social
   *   section): the modals are siblings of the panels, not children of the trade one.
   */
  constructor(rootElement, scopeElement = rootElement) {
    if (!rootElement || typeof rootElement.querySelector !== 'function') {
      throw new TypeError('TradeView requires the trade panel element.');
    }
    if (!scopeElement || typeof scopeElement.querySelector !== 'function') {
      throw new TypeError('TradeView requires a scope element for its dialogs.');
    }
    this.root = rootElement;
    const query = (selector) => this.root.querySelector(selector);
    const modalQuery = (selector) => scopeElement.querySelector(selector);

    this.eyesElement = query('[data-trade-eyes]');
    this.feedbackElement = query('[data-trade-feedback]');
    this.emptyElement = query('[data-trade-empty]');
    this.tradeMain = query('[data-trade-main]');
    this.historyPage = query('[data-trade-history-page]');
    this.historyButton = query('[data-trade-history-open]');
    this.historyBackButton = query('[data-trade-history-back]');
    this.historyRefreshButton = query('[data-trade-history-refresh]');
    this.historyEmpty = query('[data-trade-history-empty]');
    this.incomingGroup = query('[data-trade-incoming-group]');
    this.outgoingGroup = query('[data-trade-outgoing-group]');
    this.incomingList = query('[data-trade-incoming]');
    this.outgoingList = query('[data-trade-outgoing]');
    this.historyList = query('[data-trade-history]');
    this.newButton = query('[data-trade-new]');
    this.refreshButton = query('[data-trade-refresh]');

    this.newModal = modalQuery('[data-trade-new-modal]');
    this.newForm = modalQuery('[data-trade-new-form]');
    this.partnerButton = modalQuery('[data-trade-partner-open]');
    this.partnerAvatar = modalQuery('[data-trade-partner-avatar]');
    this.partnerLabel = modalQuery('[data-trade-partner-label]');
    this.partnerCount = modalQuery('[data-trade-partner-count]');
    this.partnerStarsElement = modalQuery('[data-trade-partner-stars]');
    this.cardList = modalQuery('[data-trade-cards]');
    this.cardSearch = modalQuery('[data-trade-cards-search]');
    this.cardSort = modalQuery('[data-trade-cards-sort]');
    this.cardEmpty = modalQuery('[data-trade-cards-empty]');
    this.newError = modalQuery('[data-trade-new-error]');
    this.newConfirm = modalQuery('[data-trade-new-confirm]');
    this.newCost = modalQuery('[data-trade-new-cost]');
    this.newCloseButtons = scopeElement.querySelectorAll('[data-trade-new-close]');

    this.partnerModal = modalQuery('[data-trade-partner-modal]');
    this.partnerSearch = modalQuery('[data-trade-partner-search]');
    this.partnerList = modalQuery('[data-trade-partner-list]');
    this.partnerEmpty = modalQuery('[data-trade-partner-empty]');
    this.partnerCloseButtons = scopeElement.querySelectorAll('[data-trade-partner-close]');

    this.proposalModal = modalQuery('[data-trade-proposal-modal]');
    this.proposalForm = modalQuery('[data-trade-proposal-form]');
    this.proposalCards = modalQuery('[data-trade-proposal-cards]');
    this.proposalError = modalQuery('[data-trade-proposal-error]');
    this.proposalConfirm = modalQuery('[data-trade-proposal-confirm]');
    this.proposalCost = modalQuery('[data-trade-proposal-cost]');
    this.proposalCloseButtons = scopeElement.querySelectorAll('[data-trade-proposal-close]');

    this.confirmModal = modalQuery('[data-trade-confirm-modal]');
    this.confirmTitle = modalQuery('[data-trade-confirm-title]');
    this.confirmBody = modalQuery('[data-trade-confirm-body]');
    this.confirmError = modalQuery('[data-trade-confirm-error]');
    this.confirmAction = modalQuery('[data-trade-confirm-action]');
    this.confirmCloseButtons = scopeElement.querySelectorAll('[data-trade-confirm-close]');

    this.claimModal = modalQuery('[data-trade-claim-modal]');
    this.claimTitle = modalQuery('[data-trade-claim-title]');
    this.claimText = modalQuery('[data-trade-claim-text]');
    this.claimStage = modalQuery('[data-trade-claim-stage]');
    this.claimOut = modalQuery('[data-trade-claim-out]');
    this.claimIn = modalQuery('[data-trade-claim-in]');
    this.claimClose = modalQuery('[data-trade-claim-close]');

    this.friendModal = modalQuery('[data-trade-friend-modal]');
    this.friendTitle = modalQuery('[data-trade-friend-title]');
    this.friendBody = modalQuery('[data-trade-friend-body]');
    this.friendError = modalQuery('[data-trade-friend-error]');
    this.friendAdd = modalQuery('[data-trade-friend-add]');
    this.friendCloseButtons = scopeElement.querySelectorAll('[data-trade-friend-close], [data-trade-friend-later]');

    this.view = tradeManager.buildEmptyView();
    this.collectionEntries = [];
    /** @type {{sameExtension: boolean}|null} Rules read from `settings/config.json`. */
    this.tradeRules = null;
    this.friends = [];
    /** Wishlist keys of the followed players, read in the same batch as their cards. */
    this.wishlists = new Map();
    /** Wishlist of the partner currently selected in the new-trade dialog. */
    this.partnerWishlist = new Set();
    /** @type {Array<{uuid: string, username: string, iconPath: string, trades: number}>} Followed
     *   players of the new-trade dialog, busiest partner first. */
    this.partners = [];
    /** UUID chosen in the partner picker (empty until the player picks one). */
    this.partnerUuid = '';
    /** Friendship XP per player, read with the dialog so the partner stars can be painted. */
    this.friendshipXp = new Map();
    /** Friendship thresholds, shared with the global trophy file. */
    this.friendshipTiers = [];
    /** Stars of the partner selected in the new-trade dialog, which discount the Sparks. */
    this.partnerStars = 0;
    /** Stars of the requester in the proposal dialog, which discount the Sparks as well. */
    this.proposalStars = 0;
    this.imageCache = new Map();
    this.selectedCardKey = '';
    /** Text typed in the card chooser, normalized on every filter. */
    this.cardQuery = '';
    /** Sort chosen in the chooser: `rarity`, `quantity` or `number`. */
    this.cardSortMode = 'rarity';
    /** Collection snapshot of the open new-trade dialog, used to explain the greyed cards. */
    this.collectionView = null;
    /** Sparks balance read with the collection, null when it could not be read. */
    this.sparksBalance = null;
    /** Tiles of the chooser, grouped: wished, blocked wishes, others, untradable. */
    this.cardGroups = { wished: [], blocked: [], rest: [], untradable: [] };
    /** Heading that introduces the greyed block, or null when there is none. */
    this.cardHeading = null;
    this.proposalTrade = null;
    this.proposalCardKey = '';
    this.pendingConfirm = null;
    this.pendingFriend = null;
    this.isBusy = false;
    this.isFriendBusy = false;
    this.isActive = false;
    this.loadedAt = 0;
    this.animationTimer = null;
    this.refreshTimer = null;
    this.bindings = [];

    this.assertMarkup();
  }

  /**
   * Logs with the view prefix.
   *
   * @param {...unknown} args - Values forwarded to `console.info`.
   * @returns {void}
   */
  log(...args) {
    console.info('[TradeView]', ...args);
  }

  /**
   * Verifies the markup contract.
   *
   * @returns {void}
   * @throws {Error} When a required element is missing.
   */
  assertMarkup() {
    const missing = [
      ['[data-trade-eyes]', this.eyesElement],
      ['[data-trade-main]', this.tradeMain],
      ['[data-trade-history-page]', this.historyPage],
      ['[data-trade-history-open]', this.historyButton],
      ['[data-trade-history-back]', this.historyBackButton],
      ['[data-trade-incoming]', this.incomingList],
      ['[data-trade-outgoing]', this.outgoingList],
      ['[data-trade-history]', this.historyList],
      ['[data-trade-new]', this.newButton],
      ['[data-trade-refresh]', this.refreshButton],
      ['[data-trade-new-modal]', this.newModal],
      ['[data-trade-new-form]', this.newForm],
      ['[data-trade-partner-open]', this.partnerButton],
      ['[data-trade-partner-stars]', this.partnerStarsElement],
      ['[data-trade-partner-modal]', this.partnerModal],
      ['[data-trade-partner-search]', this.partnerSearch],
      ['[data-trade-partner-list]', this.partnerList],
      ['[data-trade-cards]', this.cardList],
      ['[data-trade-cards-search]', this.cardSearch],
      ['[data-trade-cards-sort]', this.cardSort],
      ['[data-trade-cards-empty]', this.cardEmpty],
      ['[data-trade-new-confirm]', this.newConfirm],
      ['[data-trade-proposal-modal]', this.proposalModal],
      ['[data-trade-proposal-cards]', this.proposalCards],
      ['[data-trade-proposal-confirm]', this.proposalConfirm],
      ['[data-trade-confirm-modal]', this.confirmModal],
      ['[data-trade-confirm-action]', this.confirmAction],
      ['[data-trade-claim-modal]', this.claimModal],
      ['[data-trade-claim-stage]', this.claimStage],
      ['[data-trade-friend-modal]', this.friendModal],
      ['[data-trade-friend-add]', this.friendAdd],
    ]
      .filter(([, element]) => !element)
      .map(([selector]) => selector);
    if (missing.length > 0) {
      throw new Error(`TradeView markup is incomplete, missing: ${missing.join(', ')}.`);
    }
  }

  /**
   * Binds the interactions.
   *
   * @returns {void}
   */
  init() {
    this.listen(this.newButton, 'click', () => void this.openNewTrade());
    this.listen(this.refreshButton, 'click', () => void this.reload({ announce: true }));
    this.listen(this.historyButton, 'click', () => this.openHistory());
    this.listen(this.historyBackButton, 'click', () => this.closeHistory());
    this.listen(this.historyRefreshButton, 'click', () => void this.reload({ announce: true }));
    this.listen(this.root, 'click', (event) => void this.handleActionClick(event));

    this.listen(this.newForm, 'submit', (event) => {
      event.preventDefault();
      void this.submitNewTrade();
    });
    this.listen(this.partnerButton, 'click', () => this.openPartnerPicker());
    this.listen(this.partnerSearch, 'input', () => this.renderPartners());
    this.listen(this.partnerList, 'click', (event) => void this.selectPartner(event));
    this.partnerCloseButtons.forEach((button) => {
      this.listen(button, 'click', () => this.closePartnerPicker());
    });
    this.listen(this.partnerModal, 'click', (event) => {
      if (event.target === this.partnerModal) this.closePartnerPicker();
    });
    this.listen(this.cardList, 'click', (event) => this.selectCard(event, 'new'));
    this.listen(this.cardSearch, 'input', () => {
      this.cardQuery = this.cardSearch.value;
      this.applyCardFilter();
    });
    this.listen(this.cardSort, 'change', () => {
      this.cardSortMode = CARD_SORT_MODES.includes(this.cardSort.value)
        ? this.cardSort.value
        : 'rarity';
      this.applyCardOrder();
    });
    this.newCloseButtons.forEach((button) => {
      this.listen(button, 'click', () => this.closeNewTrade());
    });
    this.listen(this.newModal, 'click', (event) => {
      if (event.target === this.newModal) this.closeNewTrade();
    });

    this.listen(this.proposalForm, 'submit', (event) => {
      event.preventDefault();
      void this.submitProposal();
    });
    this.listen(this.proposalCards, 'click', (event) => this.selectCard(event, 'proposal'));
    this.proposalCloseButtons.forEach((button) => {
      this.listen(button, 'click', () => this.closeProposal());
    });
    this.listen(this.proposalModal, 'click', (event) => {
      if (event.target === this.proposalModal) this.closeProposal();
    });

    this.confirmCloseButtons.forEach((button) => {
      this.listen(button, 'click', () => this.closeConfirm());
    });
    this.listen(this.confirmAction, 'click', () => void this.runConfirm());
    this.listen(this.confirmModal, 'click', (event) => {
      if (event.target === this.confirmModal) this.closeConfirm();
    });

    this.listen(this.claimClose, 'click', () => this.closeClaim());
    this.listen(this.claimModal, 'click', (event) => {
      if (event.target === this.claimModal) this.closeClaim();
    });

    this.friendCloseButtons.forEach((button) => {
      this.listen(button, 'click', () => this.closeFriendPrompt());
    });
    this.listen(this.friendAdd, 'click', () => void this.addFriend());
    this.listen(this.friendModal, 'click', (event) => {
      if (event.target === this.friendModal) this.closeFriendPrompt();
    });

    this.listen(document, 'keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (!this.partnerModal.hidden) {
        this.closePartnerPicker();
      } else if (!this.friendModal.hidden) {
        this.closeFriendPrompt();
      } else if (!this.claimModal.hidden) {
        this.closeClaim();
      } else if (!this.historyPage.hidden) {
        this.closeHistory();
      } else if (!this.confirmModal.hidden) {
        this.closeConfirm();
      } else if (!this.proposalModal.hidden) {
        this.closeProposal();
      } else if (!this.newModal.hidden) {
        this.closeNewTrade();
      }
    });

    this.log('Ready.');
  }

  /**
   * Registers a listener for `destroy()`.
   *
   * @param {EventTarget} target - Listener target.
   * @param {string} type - Event type.
   * @param {EventListener} handler - Handler.
   * @returns {void}
   */
  listen(target, type, handler) {
    target.addEventListener(type, handler);
    this.bindings.push({ target, type, handler });
  }

  /**
   * Shows the tab and loads the trades when the data is not fresh anymore.
   *
   * @returns {void}
   */
  activate() {
    this.isActive = true;
    if (Date.now() - this.loadedAt < TRADE_VIEW_CACHE_MS) {
      this.render();
      return;
    }
    void this.reload();
  }

  /**
   * Hides the tab and closes every dialog.
   *
   * @returns {void}
   */
  deactivate() {
    this.isActive = false;
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.closePartnerPicker();
    this.closeNewTrade();
    this.closeProposal();
    this.closeConfirm();
    this.closeClaim();
    this.closeFriendPrompt();
    this.closeHistory();
  }

  /**
   * Shows the history screen: the live lists make room for the closed trades.
   *
   * @returns {void}
   */
  openHistory() {
    this.historyPage.hidden = false;
    this.tradeMain.hidden = true;
    this.historyBackButton.focus();
  }

  /**
   * Goes back to the live requests.
   *
   * @returns {void}
   */
  closeHistory() {
    this.historyPage.hidden = true;
    this.tradeMain.hidden = false;
  }

  /**
   * Fetches the trades and paints the tab.
   *
   * @param {{announce?: boolean}} [options] - Display options.
   * @returns {Promise<void>} Resolves once the tab is painted.
   */
  async reload({ announce = false } = {}) {
    if (this.isBusy) return;
    this.isBusy = true;
    this.root.setAttribute('aria-busy', 'true');
    this.setFeedback(announce ? 'trade.refreshing' : null);
    try {
      const view = await tradeManager.refresh({ silent: !this.isActive });
      this.view = view;
      this.loadedAt = Date.now();
      this.render();
      this.pushNotifications(view.notifications);
      // `notReady` is already the empty-state sentence: repeating it above the list would say the
      // same thing twice.
      this.setFeedback(announce && view.ready ? 'trade.refreshed' : null);
    } catch (error) {
      console.error('[TradeView] The trades could not be loaded.', error);
      this.setFeedback(getTradeErrorMessageKey(error), 'error');
    } finally {
      this.isBusy = false;
      this.root.removeAttribute('aria-busy');
    }
  }

  /**
   * Displays the transitions observed by the refresh.
   *
   * @param {object[]} notifications - Items built by `TradeManager`.
   * @returns {void}
   */
  pushNotifications(notifications) {
    // Shared with the background refresh of `js/app.js`: the same rule drops a trade message while
    // the trade tab is on screen (see `TradeIndicators.pushNotifications`).
    tradeIndicators.pushNotifications(notifications);
  }

  /**
   * Fetches the lists again shortly after one of our own actions.
   *
   * The other player may answer in the same second (a counter-proposal, a denial, a claim), and
   * the worker write settles just after the response. Polling once half a second later keeps the
   * tab truthful without the player having to press "Actualiser", while the immediate reload of
   * the action still paints our own change at once.
   *
   * @returns {void}
   */
  scheduleRefresh() {
    if (this.refreshTimer !== null) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      if (this.isActive) void this.reload();
    }, TRADE_AUTO_REFRESH_MS);
  }

  /**
   * Paints the balance and the lists.
   *
   * @returns {void}
   */
  render() {
    // A missing balance is the initial stock (`TRADE_MAX_ENDER_EYES`), never a dash: the worker
    // opens the trade account full, see `TradeManager`.
    const eyes = this.view.enderEyes ?? TRADE_MAX_ENDER_EYES;
    // The button is NEVER disabled: a greyed-out button explains nothing. Clicking it opens
    // `openNewTrade()`, which names the missing piece in a dialog instead (see `showBlocked()`).
    this.newButton.disabled = false;
    this.eyesElement.textContent = `${eyes} / ${TRADE_MAX_ENDER_EYES}`;

    const active = [...this.view.incoming, ...this.view.outgoing];
    void this.renderGroup(this.incomingList, this.incomingGroup, this.view.incoming);
    void this.renderGroup(this.outgoingList, this.outgoingGroup, this.view.outgoing);
    // The history lives on its own screen: it is painted from the same snapshot, so opening it
    // never performs another read.
    void this.renderGroup(this.historyList, null, this.view.history);
    this.historyEmpty.textContent = i18n.t('trade.history.empty');
    this.historyEmpty.hidden = this.view.history.length > 0;
    this.emptyElement.hidden = active.length > 0;
    this.emptyElement.textContent = this.view.ready
      ? i18n.t('trade.empty')
      : i18n.t('trade.notReady');

  }

  /**
   * Paints one list of trades.
   *
   * @param {HTMLElement} list - Target `<ul>`.
   * @param {HTMLElement|null} group - Section wrapping the list, or null on the history screen.
   * @param {object[]} trades - Trades to paint.
   * @returns {Promise<void>} Resolves once every row is built.
   */
  async renderGroup(list, group, trades) {
    list.textContent = '';
    const rows = await Promise.all(trades.map((trade) => this.buildTradeRow(trade)));
    rows.forEach((row) => list.appendChild(row));
    if (group) group.hidden = rows.length === 0;
  }

  /**
   * Builds one trade row: the two cards, the status and the available actions.
   *
   * @param {object} trade - Trade view returned by the worker.
   * @returns {Promise<HTMLLIElement>} The row.
   */
  async buildTradeRow(trade) {
    const item = document.createElement('li');
    item.className = 'trade__item';
    item.dataset.status = trade.status;

    const isInitiator = trade.my_role === 'initiator';
    const other = isInitiator ? trade.responder : trade.initiator;
    const myCard = isInitiator ? trade.initiator.card : trade.responder.card;
    const otherCard = isInitiator ? trade.responder.card : trade.initiator.card;

    const header = document.createElement('div');
    header.className = 'trade__item-header';
    const name = document.createElement('strong');
    name.className = 'trade__item-name';
    name.textContent = `${i18n.t(isInitiator ? 'trade.with' : 'trade.from')} ${
      other?.username || i18n.t('profile.anonymous')
    }`;
    const badge = document.createElement('span');
    badge.className = 'trade__status';
    badge.dataset.status = trade.status;
    badge.textContent = i18n.t(`trade.status.${trade.status}`, { hours: TRADE_EXPIRY_HOURS });
    header.append(name, badge);

    const cards = document.createElement('div');
    cards.className = 'trade__item-cards';
    cards.append(
      await this.buildCardTile(myCard, { label: i18n.t('trade.given'), compact: true }),
      this.buildArrow(),
      await this.buildCardTile(otherCard, { label: i18n.t('trade.received'), compact: true })
    );

    const meta = document.createElement('div');
    meta.className = 'trade__item-meta';
    const rarity = document.createElement('span');
    rarity.className = 'trade__rarity';
    rarity.dataset.rarity = String(trade.rarity);
    rarity.textContent = i18n.t(`rarity.${trade.rarity}`);
    const cost = document.createElement('span');
    cost.className = 'trade__cost';
    cost.append(
      document.createTextNode(i18n.t('trade.costLabel')),
      buildPrice({ enderEyes: trade.ender_eyes_cost, sparks: trade.sparks_cost })
    );
    const date = document.createElement('span');
    date.textContent = this.formatDate(trade.created_at);
    meta.append(rarity, cost, date);

    item.append(header, cards, meta);

    const actions = document.createElement('div');
    actions.className = 'trade__item-actions';
    this.buildActions(trade, actions);
    if (actions.childElementCount > 0) item.appendChild(actions);
    return item;
  }

  /**
   * Adds the buttons the current status allows.
   *
   * @param {object} trade - Trade view.
   * @param {HTMLElement} actions - Container.
   * @returns {void}
   */
  buildActions(trade, actions) {
    const isInitiator = trade.my_role === 'initiator';
    const button = (action, labelKey, tone = 'ghost') => {
      const element = document.createElement('button');
      element.type = 'button';
      element.className = `btn btn--${tone}`;
      element.dataset.tradeAction = action;
      element.dataset.tradeId = trade.id;
      element.textContent = i18n.t(labelKey);
      actions.appendChild(element);
    };

    if (trade.status === TRADE_STATUSES.PENDING) {
      if (isInitiator) {
        button('cancel', 'trade.action.cancel', 'danger');
      } else {
        button('propose', 'trade.action.propose', 'primary');
        button('deny', 'trade.action.deny', 'danger');
      }
    } else if (trade.status === TRADE_STATUSES.PROPOSED) {
      if (isInitiator) {
        button('accept', 'trade.action.accept', 'primary');
        button('cancel', 'trade.action.cancel', 'danger');
      } else {
        button('propose', 'trade.action.replace');
        button('withdraw', 'trade.action.withdraw');
        button('deny', 'trade.action.deny', 'danger');
      }
    } else if (trade.status === TRADE_STATUSES.ACCEPTED) {
      const claimed = (isInitiator ? trade.initiator.claimed : trade.responder.claimed) === true;
      if (claimed) {
        const waiting = document.createElement('span');
        waiting.className = 'trade__waiting';
        waiting.textContent = i18n.t('trade.action.waiting');
        actions.appendChild(waiting);
      } else {
        button('claim', 'trade.action.claim', 'primary');
      }
    }
  }

  /**
   * Builds one card tile.
   *
   * @param {object|null} payload - Card stored in the trade.
   * @param {{label?: string, compact?: boolean, quantity?: number, cost?: string,
   *   artOnly?: boolean}} [options] - Tile options. `artOnly` drops the caption and the name, which
   *   the claim animation does not want over the artwork.
   * @returns {Promise<HTMLElement>} The tile.
   */
  async buildCardTile(
    payload,
    { label = '', compact = false, quantity = 0, cost = null, artOnly = false } = {}
  ) {
    const tile = document.createElement('div');
    tile.className = compact ? 'trade__card trade__card--compact' : 'trade__card';
    if (artOnly) tile.classList.add('trade__card--art');

    if (!payload) {
      tile.classList.add('is-empty');
      const placeholder = document.createElement('span');
      placeholder.className = 'trade__card-label';
      placeholder.textContent = i18n.t('trade.noCard');
      tile.appendChild(placeholder);
      return tile;
    }

    const image = document.createElement('img');
    image.className = 'trade__card-image';
    image.alt = payload.name || '';
    image.loading = 'lazy';
    image.decoding = 'async';
    const source = await this.resolveCardImage(payload.key);
    if (source) {
      image.src = source;
      image.addEventListener('error', () => image.remove());
      tile.appendChild(image);
    }
    if (artOnly) return tile;

    const body = document.createElement('span');
    body.className = 'trade__card-body';
    if (label) {
      const caption = document.createElement('span');
      caption.className = 'trade__card-label';
      caption.textContent = label;
      body.appendChild(caption);
    }
    const title = document.createElement('strong');
    title.className = 'trade__card-name';
    title.textContent = payload.name || payload.card_id || payload.key;
    body.appendChild(title);

    if (quantity > 0 || cost) {
      const detail = document.createElement('span');
      detail.className = 'trade__card-detail';
      if (quantity > 0) {
        detail.textContent = i18n.t('trade.quantity', { count: quantity });
      }
      if (cost) {
        if (quantity > 0) detail.append(' · ');
        detail.appendChild(cost);
      }
      body.appendChild(detail);
    }
    tile.appendChild(body);
    return tile;
  }

  /**
   * Builds the arrow between the two cards.
   *
   * @returns {HTMLElement} The arrow.
   */
  buildArrow() {
    const arrow = document.createElement('span');
    arrow.className = 'trade__arrow';
    arrow.textContent = '⇄';
    arrow.setAttribute('aria-hidden', 'true');
    return arrow;
  }

  /**
   * Resolves the illustration of a card from the local catalogue.
   *
   * The worker sends no path on purpose (the asset URLs are remote): the receiver draws the card
   * exactly like its own collection does.
   *
   * @param {string} key - Collection key.
   * @returns {Promise<string>} The resolved path, or an empty string.
   */
  async resolveCardImage(key) {
    if (typeof key !== 'string' || key === '') return '';
    if (this.imageCache.has(key)) return this.imageCache.get(key);
    let source = '';
    try {
      const card = await boosterManager.getCardByKey(key);
      if (card?.illustration) source = i18n.resolveImagePath(card.illustration);
    } catch (error) {
      console.warn(`[TradeView] The card "${key}" could not be resolved.`, error);
    }
    this.imageCache.set(key, source);
    return source;
  }

  /**
   * Handles a click on one of the row actions.
   *
   * @param {MouseEvent} event - Click event.
   * @returns {Promise<void>} Resolves once the dialog is open.
   */
  async handleActionClick(event) {
    const button = event.target instanceof Element
      ? event.target.closest('[data-trade-action]')
      : null;
    if (!button) return;
    const trade = [...this.view.incoming, ...this.view.outgoing].find(
      (candidate) => candidate.id === button.dataset.tradeId
    );
    if (!trade) return;

    const action = button.dataset.tradeAction;
    if (action === 'propose') {
      await this.openProposal(trade);
      return;
    }
    if (action === 'deny') {
      this.openConfirm({
        titleKey: 'trade.confirm.deny.title',
        bodyKey: 'trade.confirm.deny.body',
        confirmKey: 'trade.action.deny',
        tone: 'danger',
        action: () => this.deny(trade),
      });
      return;
    }
    if (action === 'withdraw') {
      this.openConfirm({
        titleKey: 'trade.confirm.withdraw.title',
        bodyKey: 'trade.confirm.withdraw.body',
        confirmKey: 'trade.action.withdraw',
        tone: 'danger',
        action: () => this.withdraw(trade),
      });
      return;
    }
    if (action === 'cancel') {
      this.openConfirm({
        titleKey: 'trade.confirm.cancel.title',
        bodyKey: 'trade.confirm.cancel.body',
        // Not the label of the row button: the dialog already comes FROM "Annuler", so its own
        // button has to say what it does ("Annuler l'échange") while the dismiss button steps back.
        confirmKey: 'trade.confirm.cancel.confirm',
        tone: 'danger',
        action: () => this.cancel(trade),
      });
      return;
    }
    if (action === 'accept') {
      this.openConfirm({
        titleKey: 'trade.confirm.accept.title',
        bodyKey: 'trade.confirm.accept.body',
        confirmKey: 'trade.action.accept',
        tone: 'primary',
        action: () => this.accept(trade),
      });
      return;
    }
    if (action === 'claim') {
      await this.claim(trade);
    }
  }

  /**
   * Reads what prevents trading right now, if anything does.
   *
   * The worker refuses a request from an account whose trainer card was never published (it has
   * no auth code), so the form would open on something nothing can send. The balance and the lists
   * are not read here: they are explained inside the dialog once it is open, where the player sees
   * the friends and the cards they actually have.
   *
   * @returns {Promise<string|null>} Translation key of the blocker, or null when trading is open.
   */
  async getTradeBlocker() {
    if (this.view.ready) return null;
    try {
      // No exception: the account exists and is published, the lists were simply not loaded yet.
      await tradeManager.getCredentials();
      return null;
    } catch (error) {
      return getTradeErrorMessageKey(error);
    }
  }

  /**
   * Shows why an action is not possible, in the dialog this view already owns.
   *
   * The shared confirmation modal is reused as a plain message: its action button only closes it
   * (`runConfirm()` handles a null action), so no second piece of markup is needed.
   *
   * @param {string} titleKey - Translation key of the title.
   * @param {string} messageKey - Translation key of the explanation.
   * @returns {void}
   */
  showBlocked(titleKey, messageKey) {
    this.pendingConfirm = null;
    this.confirmTitle.textContent = i18n.t(titleKey);
    this.confirmBody.textContent = i18n.t(messageKey);
    this.confirmAction.textContent = i18n.t('social.detail.close');
    this.confirmAction.className = 'btn btn--primary';
    this.confirmError.hidden = true;
    this.confirmError.textContent = '';
    this.confirmAction.disabled = false;
    this.confirmModal.hidden = false;
    this.confirmAction.focus();
  }

  /**
   * Tells whether the balance covers the Ender Eyes of one trade.
   *
   * @param {{enderEyes: number}} cost - Cost returned by `getTradeCost()`.
   * @returns {boolean} True when the balance is unknown or large enough.
   */
  hasEnoughEyes(cost) {
    if (this.view.enderEyes === null || this.view.enderEyes === undefined) return true;
    return this.view.enderEyes >= cost.enderEyes;
  }

  /**
   * Shows an explanation inside the new-trade dialog.
   *
   * @param {string} key - Translation key.
   * @returns {void}
   */
  setNewError(key) {
    this.newError.hidden = false;
    this.newError.textContent = i18n.t(key);
  }

  /**
   * Opens the new-trade dialog with the friends and the tradable cards.
   *
   * @returns {Promise<void>} Resolves once the dialog is filled.
   */
  async openNewTrade() {
    if (this.isBusy) return;
    const blocker = await this.getTradeBlocker();
    if (blocker) {
      this.showBlocked('trade.blocked.title', blocker);
      return;
    }
    this.selectedCardKey = '';
    this.cardQuery = '';
    this.cardSearch.value = '';
    this.cardSortMode = 'rarity';
    this.cardSort.value = 'rarity';
    this.newError.hidden = true;
    this.newError.textContent = '';
    this.newConfirm.disabled = false;
    this.cardList.textContent = '';
    this.newCost.textContent = '';
    this.newModal.hidden = false;

    try {
      const [{ cards, wishlists }, collection, partnerCounts, sparks, friendship] =
        await Promise.all([
          socialManager.refreshFollowing(),
          collectionManager.getCollectionView(),
          tradeManager.getPartnerCounts(),
          sparksManager.getBalance().catch(() => null),
          friendshipManager.getOverview(),
        ]);
      this.collectionView = collection;
      this.sparksBalance = sparks;
      this.friendshipTiers = friendship.tiers;
      this.friendshipXp = new Map(Object.entries(friendship.xp));
      this.wishlists = new Map(Object.entries(wishlists ?? {}));
      this.friends = cards.filter((card) => card && typeof card.uuid === 'string');
      this.partners = this.buildPartners(this.friends, partnerCounts);
      this.partnerUuid = '';
      this.partnerWishlist = new Set();
      this.partnerButton.disabled = this.partners.length === 0;
      this.updatePartnerDisplay();
      // Promo cards and the extensions closed in `settings/cardsets.json` are already out; rarity 6
      // stays in, its price table decides whether the friendship is high enough.
      this.tradeRules = await tradeManager.getRules();
      this.collectionEntries = await tradeManager.getTradableEntries(collection);

      if (this.friends.length === 0) {
        this.newError.hidden = false;
        this.newError.textContent = i18n.t('trade.error.noFriends');
      }

      await this.renderNewTradeCards();
      this.partnerButton.focus();
    } catch (error) {
      console.error('[TradeView] The new-trade dialog could not be filled.', error);
      this.newError.hidden = false;
      this.newError.textContent = i18n.t(getTradeErrorMessageKey(error));
    }
  }

  /**
   * Repaints the cards the new-trade dialog offers.
   *
   * Groups, top to bottom: the partner's wishes that can be offered (badge), the wishes that
   * cannot (no copy or only the last one), the other tradable cards, then every owned card the
   * rules or the balance refuse, greyed and disabled under their own heading. The search hides
   * tiles in place and the sort only re-orders each group, so a keystroke never rebuilds the grid.
   *
   * @returns {Promise<void>} Resolves once the list is filled.
   */
  async renderNewTradeCards() {
    this.cardList.textContent = '';
    this.cardGroups = { wished: [], blocked: [], rest: [], untradable: [] };
    this.cardHeading = null;
    this.selectedCardKey = '';
    this.updateNewCost();

    const wished = this.partnerWishlist;
    // Every refusal is read once: the cards that fail a rule or the price leave the selectable
    // list, so an unaffordable card is greyed at the bottom instead of appearing twice.
    const refused = this.buildUntradableEntries(this.collectionView);
    const refusedReasons = new Map(refused.map(({ entry, reasonKey }) => [entry.key, reasonKey]));
    const refusedKeys = new Set(refusedReasons.keys());
    const offerable = this.collectionEntries.filter((entry) => !refusedKeys.has(entry.key));
    const tradableKeys = new Set(offerable.map((entry) => entry.key));
    const wishedEntries = offerable.filter((entry) => wished.has(entry.key));
    const otherEntries = offerable.filter((entry) => !wished.has(entry.key));

    for (const entry of wishedEntries) {
      this.cardGroups.wished.push({
        button: await this.buildSelectableCard(entry, { wished: true, stars: this.partnerStars }),
        entry,
        haystack: cardHaystack(entry),
      });
    }
    for (const key of wished) {
      if (!tradableKeys.has(key)) {
        this.cardGroups.blocked.push(
          await this.buildBlockedWishCard(key, refusedReasons.get(key) ?? null)
        );
      }
    }
    for (const entry of otherEntries) {
      this.cardGroups.rest.push({
        button: await this.buildSelectableCard(entry, { stars: this.partnerStars }),
        entry,
        haystack: cardHaystack(entry),
      });
    }

    // A wish that cannot be offered is already explained above: it must not appear twice.
    const untradable = refused.filter(({ entry }) => !wished.has(entry.key));
    if (untradable.length > 0) this.cardHeading = this.buildUntradableHeading();
    for (const { entry, reasonKey } of untradable) {
      this.cardGroups.untradable.push({
        button: await this.buildUntradableCard(entry, reasonKey),
        entry,
        haystack: cardHaystack(entry),
      });
    }

    this.applyCardOrder();
    this.applyCardFilter();
  }

  /**
   * Builds one selectable card of a trade dialog.
   *
   * @param {object} entry - Owned collection entry.
   * @param {{wished?: boolean, stars?: number}} [options] - `wished` marks a card the other player
   *   asked for, `stars` is the friendship level whose discount applies to the Sparks.
   * @returns {Promise<HTMLElement>} The button.
   */
  async buildSelectableCard(entry, { wished = false, stars = 0 } = {}) {
    const cost = getTradeCost(entry.rarity, stars);
    const tile = await this.buildCardTile(
      {
        key: entry.key,
        card_id: entry.cardId,
        name: entry.card?.getName?.(i18n.getLang()) || entry.cardId,
      },
      {
        quantity: entry.quantity,
        cost: buildPrice(cost),
      }
    );
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'trade__card-button';
    button.dataset.tradeCard = entry.key;
    button.dataset.rarity = String(entry.rarity);
    button.setAttribute('aria-pressed', 'false');
    button.appendChild(tile);
    if (wished) {
      button.classList.add('is-wished');
      const badge = document.createElement('span');
      badge.className = 'trade__card-wish';
      badge.textContent = i18n.t('trade.wishlist.badge');
      button.appendChild(badge);
    }
    return button;
  }

  /**
   * Builds a greyed card of the partner's wishlist that this player cannot offer.
   *
   * @param {string} key - Collection key wished by the partner.
   * @param {string|null} [reasonKey=null] - Exact refusal, when the collection explains it.
   * @returns {Promise<{button: HTMLElement, entry: null, haystack: string}>} The disabled tile.
   */
  async buildBlockedWishCard(key, reasonKey = null) {
    let name = key;
    try {
      const card = await boosterManager.getCardByKey(key);
      if (card) name = card.getName(i18n.getLang());
    } catch (error) {
      console.warn(`[TradeView] The wished card "${key}" could not be read.`, error);
    }

    const tile = await this.buildCardTile({ key, name }, {});
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'trade__card-button is-unavailable is-wished';
    button.dataset.tradeWishBlocked = key;
    button.disabled = true;
    const reason = i18n.t(reasonKey ?? 'trade.wishlist.notTradable');
    button.title = reason;
    button.appendChild(tile);
    const badge = document.createElement('span');
    badge.className = 'trade__card-wish';
    badge.textContent = reason;
    button.appendChild(badge);
    return { button, entry: null, haystack: normalizeCardQuery(`${name} ${key}`) };
  }

  /**
   * Lists the owned cards the current rules and balance refuse, with the reason of each refusal.
   *
   * Missing cards are not listed: the collection view holds every catalogue card, and a wall of
   * silhouettes would bury the cards the player actually owns.
   *
   * @param {object} collectionView - Result of `CollectionManager.getCollectionView()`.
   * @returns {Array<{entry: object, reasonKey: string}>} The refused owned entries.
   */
  buildUntradableEntries(collectionView) {
    const entries = Array.isArray(collectionView?.entries) ? collectionView.entries : [];
    return entries
      .filter((entry) => entry?.owned === true && Number(entry.quantity) > 0)
      .map((entry) => ({ entry, reasonKey: this.getUntradableReason(entry) }))
      .filter(({ reasonKey }) => reasonKey !== '');
  }

  /**
   * Explains why one owned card cannot be offered.
   *
   * The order of the checks is the order a player reads: the card itself (promo, closed extension,
   * rarity), then the copy count, then the price of the exchange.
   *
   * @param {object} entry - Owned collection entry.
   * @returns {string} Translation key of the reason, or an empty string when the card is tradable.
   */
  getUntradableReason(entry, stars = this.partnerStars) {
    if (entry.promo === true) return 'trade.cards.reason.promo';
    if (!tradeManager.isSetTradable(entry.set, this.tradeRules)) return 'trade.cards.reason.set';
    if (
      !Number.isInteger(entry.rarity) ||
      entry.rarity < TRADE_MIN_RARITY ||
      entry.rarity > TRADE_MAX_RARITY
    ) {
      return 'trade.cards.reason.rarity';
    }
    if (!Number.isInteger(entry.quantity) || entry.quantity < 2) return 'trade.cards.reason.single';
    const cost = getTradeCost(entry.rarity, stars);
    // Rarity 6 has no Ender Eye price below four stars: the table itself says so.
    if (!cost.tradable) return 'trade.cards.reason.friendship';
    if (!this.hasEnoughEyes(cost)) return 'trade.cards.reason.eyes';
    if (Number.isFinite(this.sparksBalance) && this.sparksBalance < cost.sparks) {
      return 'trade.cards.reason.sparks';
    }
    return '';
  }

  /**
   * Builds one greyed card of the untradable block.
   *
   * @param {object} entry - Owned collection entry.
   * @param {string} reasonKey - Translation key of the refusal.
   * @param {number} [stars=this.partnerStars] - Friendship level whose price applies.
   * @returns {Promise<HTMLElement>} The disabled button.
   */
  async buildUntradableCard(entry, reasonKey, stars = this.partnerStars) {
    const cost = getTradeCost(entry.rarity, stars);
    const tile = await this.buildCardTile(
      {
        key: entry.key,
        card_id: entry.cardId,
        name: entry.card?.getName?.(i18n.getLang()) || entry.cardId,
      },
      {
        quantity: entry.quantity,
        // An untradable card carries no price: the badge already says why it cannot be offered.
        cost: cost.tradable ? buildPrice(cost) : null,
      }
    );
    const reason = i18n.t(reasonKey);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'trade__card-button is-unavailable is-untradable';
    button.dataset.tradeUntradable = entry.key;
    button.disabled = true;
    button.title = reason;
    button.appendChild(tile);
    const badge = document.createElement('span');
    badge.className = 'trade__card-wish';
    badge.textContent = reason;
    button.appendChild(badge);
    return button;
  }

  /**
   * Builds the heading that introduces the greyed block.
   *
   * @returns {HTMLElement} The heading inserted in the grid.
   */
  buildUntradableHeading() {
    const heading = document.createElement('p');
    heading.className = 'trade__cards-heading';
    heading.textContent = i18n.t('trade.cards.untradable');
    return heading;
  }

  /**
   * Orders two tiles of the chooser for the sort chosen in the dialog.
   *
   * The partner's wishes always keep their own group (they are drawn first): this comparator only
   * orders the tiles INSIDE one group.
   *
   * @param {{entry: object|null, haystack: string}} left - First tile.
   * @param {{entry: object|null, haystack: string}} right - Second tile.
   * @param {string} mode - `rarity`, `quantity` or `number`.
   * @returns {number} Negative when `left` comes first.
   */
  compareCardTiles(left, right, mode) {
    const first = left.entry;
    const second = right.entry;
    if (!first || !second) return left.haystack.localeCompare(right.haystack);
    const byNumber = () =>
      cardNumber(first).localeCompare(cardNumber(second), i18n.getLang(), {
        numeric: true,
        sensitivity: 'base',
      });
    if (mode === 'quantity') {
      return second.quantity - first.quantity || second.rarity - first.rarity || byNumber();
    }
    if (mode === 'number') return byNumber() || second.rarity - first.rarity;
    return second.rarity - first.rarity || byNumber();
  }

  /**
   * Sorts one group of tiles.
   *
   * @param {Array<{entry: object|null, haystack: string}>} tiles - Group to sort.
   * @returns {Array<{entry: object|null, haystack: string}>} A sorted copy.
   */
  sortCardTiles(tiles) {
    return [...tiles].sort((left, right) => this.compareCardTiles(left, right, this.cardSortMode));
  }

  /**
   * Re-appends the tiles in display order: tradable wishes, blocked wishes, other tradable cards,
   * then the greyed block under its heading.
   *
   * @returns {void}
   */
  applyCardOrder() {
    const nodes = [
      ...this.sortCardTiles(this.cardGroups.wished),
      ...this.sortCardTiles(this.cardGroups.blocked),
      ...this.sortCardTiles(this.cardGroups.rest),
    ].map((tile) => tile.button);
    if (this.cardHeading) nodes.push(this.cardHeading);
    nodes.push(...this.sortCardTiles(this.cardGroups.untradable).map((tile) => tile.button));
    nodes.forEach((node) => this.cardList.appendChild(node));
  }

  /**
   * Hides the tiles that do not match the search field and updates the empty state.
   *
   * @returns {void}
   */
  applyCardFilter() {
    const query = normalizeCardQuery(this.cardQuery);
    let visible = 0;
    let visibleUntradable = 0;
    Object.entries(this.cardGroups).forEach(([group, tiles]) => {
      tiles.forEach((tile) => {
        const match = query === '' || tile.haystack.includes(query);
        tile.button.hidden = !match;
        if (!match) return;
        visible += 1;
        if (group === 'untradable') visibleUntradable += 1;
      });
    });
    if (this.cardHeading) this.cardHeading.hidden = visibleUntradable === 0;
    this.updateCardEmptyState(visible, query === '');
  }

  /**
   * Shows or clears the message of an empty chooser.
   *
   * @param {number} visible - Number of tiles currently displayed.
   * @param {boolean} unfiltered - True when the search field is empty.
   * @returns {void}
   */
  updateCardEmptyState(visible, unfiltered) {
    if (!this.cardEmpty) return;
    this.cardEmpty.hidden = visible > 0;
    this.cardEmpty.textContent =
      visible > 0 ? '' : i18n.t(unfiltered ? 'trade.error.noDuplicates' : 'trade.cards.noMatch');
  }

  /**
   * Selects one card in a dialog.
   *
   * @param {MouseEvent} event - Click event.
   * @param {'new'|'proposal'} dialog - Dialog being filled.
   * @returns {void}
   */
  selectCard(event, dialog) {
    const button = event.target instanceof Element
      ? event.target.closest('[data-trade-card]')
      : null;
    if (!button) return;
    const key = button.dataset.tradeCard;
    const host = dialog === 'new' ? this.cardList : this.proposalCards;
    host.querySelectorAll('[data-trade-card]').forEach((candidate) => {
      const selected = candidate.dataset.tradeCard === key;
      candidate.classList.toggle('is-selected', selected);
      candidate.setAttribute('aria-pressed', String(selected));
    });
    if (dialog === 'new') {
      this.selectedCardKey = key;
      this.updateNewCost();
    } else {
      this.proposalCardKey = key;
      this.updateProposalCost();
    }
  }

  /**
   * Updates the cost line and the confirm state of the new-trade dialog.
   *
   * @returns {void}
   */
  updateNewCost() {
    // The confirm button is never disabled: `submitNewTrade()` names what is missing instead.
    this.newConfirm.disabled = false;
    const entry = this.collectionEntries.find((candidate) => candidate.key === this.selectedCardKey);
    if (!entry) {
      this.newCost.textContent = '';
      return;
    }
    const cost = getTradeCost(entry.rarity, this.partnerStars);
    const enoughEyes = this.hasEnoughEyes(cost);
    this.newCost.textContent = '';
    this.newCost.append(
      document.createTextNode(`${i18n.t('trade.costRarity', { rarity: i18n.t(`rarity.${entry.rarity}`) })} `),
      buildPrice(cost)
    );
    this.newCost.dataset.tone = enoughEyes ? 'info' : 'error';
    if (!enoughEyes) {
      this.newCost.append(` · ${i18n.t('trade.error.notEnoughEnderEyes')}`);
    }
  }

  /**
   * Sends the request (player A).
   *
   * @returns {Promise<void>} Resolves once the worker answered.
   */
  async submitNewTrade() {
    if (this.isBusy) return;
    const entry = this.collectionEntries.find((candidate) => candidate.key === this.selectedCardKey);
    const responderUuid = this.partnerUuid;
    if (!entry) {
      this.setNewError('trade.error.pickCard');
      return;
    }
    if (!responderUuid) {
      this.setNewError('trade.error.noFriends');
      return;
    }
    if (!this.hasEnoughEyes(getTradeCost(entry.rarity, this.partnerStars))) {
      this.setNewError('trade.error.notEnoughEnderEyes');
      return;
    }

    this.isBusy = true;
    this.newConfirm.disabled = true;
    this.newError.hidden = true;
    try {
      await tradeManager.createTrade({ responderUuid, entry });
      this.closeNewTrade();
      Toast.success('trade.created');
      await this.reload();
      this.scheduleRefresh();
    } catch (error) {
      console.warn('[TradeView] The trade could not be created.', error);
      // 409: another tab or device already opened a request. The dialog is about a state that no
      // longer exists, so it closes and the list is repainted with the real request.
      if (error?.status === 409 || error?.status === 404) {
        this.closeNewTrade();
        Toast.error(getTradeErrorMessageKey(error));
        await this.reload();
      } else {
        this.newError.hidden = false;
        this.newError.textContent = i18n.t(getTradeErrorMessageKey(error));
      }
    } finally {
      this.isBusy = false;
      this.updateNewCost();
    }
  }

  /**
   * Closes the new-trade dialog.
   *
   * @returns {void}
   */
  closeNewTrade() {
    this.newModal.hidden = true;
    this.closePartnerPicker();
    this.selectedCardKey = '';
    this.cardQuery = '';
    this.cardSearch.value = '';
    this.partnerUuid = '';
    this.partnerStars = 0;
    this.updatePartnerDisplay();
    this.newError.hidden = true;
    this.newError.textContent = '';
  }

  /**
   * Builds the followed players the new-trade dialog offers, busiest partner first.
   *
   * The count comes from the local trade statistics (`stats.byPartner`): the players this account
   * already completed exchanges with go to the top, then the rest by name. A player never traded
   * with stays at zero and no counter is invented for them.
   *
   * @param {object[]} cards - Public cards of the followed players.
   * @param {Record<string, number>} counts - Completed trades per player UUID.
   * @returns {Array<{uuid: string, username: string, iconPath: string, trades: number}>} The rows.
   */
  buildPartners(cards, counts) {
    const lang = i18n.getLang();
    return cards
      .filter((card) => card && typeof card.uuid === 'string' && card.uuid !== '')
      .map((card) => ({
        uuid: card.uuid,
        username: card.username || i18n.t('profile.anonymous'),
        iconPath: safeSocialAssetPath(card.profile_picture_id),
        trades:
          Number.isInteger(counts?.[card.uuid]) && counts[card.uuid] > 0 ? counts[card.uuid] : 0,
      }))
      .sort(
        (a, b) =>
          b.trades - a.trades || a.username.localeCompare(b.username, lang, { sensitivity: 'base' })
      );
  }

  /**
   * Opens the partner picker on the full list.
   *
   * @returns {void}
   */
  openPartnerPicker() {
    if (this.partners.length === 0) return;
    this.partnerSearch.value = '';
    this.renderPartners();
    this.partnerModal.hidden = false;
    this.partnerSearch.focus();
  }

  /**
   * Closes the partner picker, leaving the new-trade dialog open underneath.
   *
   * @returns {void}
   */
  closePartnerPicker() {
    this.partnerModal.hidden = true;
  }

  /**
   * Repaints the rows matching the search field.
   *
   * The list is already sorted by completed trades, so filtering keeps that order.
   *
   * @returns {void}
   */
  renderPartners() {
    const query = this.partnerSearch.value.trim().toLocaleLowerCase();
    const matches = this.partners.filter((partner) =>
      partner.username.toLocaleLowerCase().includes(query)
    );
    this.partnerList.textContent = '';
    matches.forEach((partner) => this.partnerList.appendChild(this.buildPartnerRow(partner)));
    this.partnerEmpty.hidden = matches.length > 0;
  }

  /**
   * Builds one row of the partner picker: avatar, pseudo and completed trades.
   *
   * @param {{uuid: string, username: string, iconPath: string, trades: number}} partner - Player.
   * @returns {HTMLElement} The list item.
   */
  buildPartnerRow(partner) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'trade__partner-row';
    button.dataset.tradePartnerUuid = partner.uuid;
    const selected = partner.uuid === this.partnerUuid;
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-pressed', String(selected));

    const avatar = document.createElement('span');
    avatar.className = 'trade__partner-avatar';
    this.fillPartnerAvatar(avatar, partner);

    const name = document.createElement('span');
    name.className = 'trade__partner-name';
    name.textContent = partner.username;

    const identity = document.createElement('span');
    identity.className = 'trade__partner-identity';
    identity.append(name, buildFriendshipLevel(this.friendProgress(partner.uuid)));

    const count = document.createElement('span');
    count.className = 'trade__partner-count';
    count.textContent = i18n.t('trade.partner.trades', { count: partner.trades });

    button.append(avatar, identity, count);
    item.appendChild(button);
    return item;
  }

  /**
   * Draws the recognizable icon of a followed player, with the initial as fallback.
   *
   * @param {HTMLElement} host - Element that receives the picture.
   * @param {{username: string, iconPath: string}} partner - Player, or an empty placeholder.
   * @returns {void}
   */
  fillPartnerAvatar(host, partner) {
    host.textContent = '';
    if (partner.iconPath !== '') {
      const image = document.createElement('img');
      image.className = 'trade__partner-avatar-image';
      image.src = i18n.resolveImagePath(partner.iconPath);
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.addEventListener('error', () => image.remove());
      host.appendChild(image);
      return;
    }
    const fallback = document.createElement('span');
    fallback.className = 'trade__partner-avatar-initial';
    fallback.textContent = partner.username.slice(0, 1).toUpperCase();
    host.appendChild(fallback);
  }

  /**
   * Picks one player from the picker.
   *
   * @param {MouseEvent} event - Click event.
   * @returns {void}
   */
  async selectPartner(event) {
    const row =
      event.target instanceof Element ? event.target.closest('[data-trade-partner-uuid]') : null;
    if (!row) return;
    this.partnerUuid = row.dataset.tradePartnerUuid || '';
    this.partnerWishlist = new Set(this.wishlists.get(this.partnerUuid) ?? []);
    this.updatePartnerDisplay();
    this.closePartnerPicker();
    // The cards come back re-ordered, the partner's wishes first: choosing a partner is what makes
    // their wishlist relevant, so the list follows the choice.
    await this.renderNewTradeCards();
  }

  /**
   * Shows the chosen player in the new-trade dialog (or its placeholder).
   *
   * @returns {void}
   */
  updatePartnerDisplay() {
    const partner = this.partners.find((candidate) => candidate.uuid === this.partnerUuid) ?? null;
    this.partnerAvatar.hidden = partner === null;
    this.fillPartnerAvatar(this.partnerAvatar, partner ?? { username: '', iconPath: '' });
    this.partnerLabel.textContent = partner
      ? partner.username
      : i18n.t('trade.partner.choose');
    this.partnerLabel.classList.toggle('is-placeholder', partner === null);
    this.partnerCount.textContent = partner
      ? i18n.t('trade.partner.trades', { count: partner.trades })
      : '';
    const progress = partner === null ? null : this.friendProgress(partner.uuid);
    this.partnerStars = progress?.stars ?? 0;
    if (this.partnerStarsElement) {
      this.partnerStarsElement.textContent = '';
      this.partnerStarsElement.hidden = partner === null;
      if (progress) this.partnerStarsElement.appendChild(buildFriendshipLevel(progress));
    }
  }

  /**
   * Reads the star level of one player from the loaded thresholds.
   *
   * @param {string} uuid - Player UUID.
   * @returns {object} The object `buildFriendshipLevel()` expects.
   */
  friendProgress(uuid) {
    const xp = this.friendshipXp.get(uuid) ?? 0;
    return friendshipManager.describeXp(xp, this.friendshipTiers);
  }

  /**
   * Opens the proposal dialog for an incoming request (player B).
   *
   * @param {object} trade - Incoming trade.
   * @returns {Promise<void>} Resolves once the dialog is filled.
   */
  async openProposal(trade) {
    if (this.isBusy) return;
    this.proposalTrade = trade;
    this.proposalCardKey = '';
    this.proposalError.hidden = true;
    this.proposalError.textContent = '';
    this.proposalConfirm.disabled = false;
    this.proposalCost.textContent = '';
    this.proposalCards.textContent = '';
    this.proposalModal.hidden = false;

    try {
      const collection = await collectionManager.getCollectionView();
      const friendship = await friendshipManager.getOverview();
      this.friendshipTiers = friendship.tiers;
      this.friendshipXp = new Map(Object.entries(friendship.xp));
      this.proposalStars = this.friendProgress(trade.initiator?.uuid ?? '').stars;
      const excluded = trade.initiator?.card?.key ?? '';
      // Same rarity is mandatory; the same extension is only required when the configuration says
      // so (`trades.sameExtension`), in which case the offered card must match the other one's set.
      this.tradeRules = await tradeManager.getRules();
      const wishedByInitiator = new Set(
        await this.getWishlistOf(trade.initiator?.uuid ?? '')
      );
      this.collectionEntries = (
        await tradeManager.getTradableEntries(collection, {
          rarity: trade.rarity,
          set: trade.initiator?.card?.set ?? '',
        })
      )
        .filter((entry) => entry.key !== excluded)
        // The cards the requester wished for first, then the rest: the proposal is about giving
        // them something they want, so their wishlist leads the list.
        .sort(
          (left, right) =>
            Number(wishedByInitiator.has(right.key)) - Number(wishedByInitiator.has(left.key))
        );
      if (this.collectionEntries.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'trade__empty-cards';
        empty.textContent = i18n.t(
          this.tradeRules.sameExtension
            ? 'trade.error.noMatchingSameExtension'
            : 'trade.error.noMatchingDuplicate',
          { rarity: trade.rarity, set: trade.initiator?.card?.set ?? '' }
        );
        this.proposalCards.appendChild(empty);
      } else {
        for (const entry of this.collectionEntries) {
          // The same split as the new-trade dialog: a rare card the responder cannot pay for (rarity
          // 6 below four stars, missing Eyes or Sparks) is greyed with its reason instead of being
          // offered at a price the dialog would then refuse.
          const reasonKey = this.getUntradableReason(entry, this.proposalStars);
          this.proposalCards.appendChild(
            reasonKey
              ? await this.buildUntradableCard(entry, reasonKey, this.proposalStars)
              : await this.buildSelectableCard(entry, {
                  wished: wishedByInitiator.has(entry.key),
                  stars: this.proposalStars,
                })
          );
        }
      }
      this.updateProposalCost();
    } catch (error) {
      console.error('[TradeView] The proposal dialog could not be filled.', error);
      this.proposalError.hidden = false;
      this.proposalError.textContent = i18n.t(getTradeErrorMessageKey(error));
    }
  }

  /**
   * Updates the cost line and the confirm state of the proposal dialog.
   *
   * @returns {void}
   */
  updateProposalCost() {
    // Same contract as the new-trade dialog: the confirm stays clickable, the error says what
    // is missing (`submitProposal()`).
    this.proposalConfirm.disabled = false;
    const entry = this.collectionEntries.find(
      (candidate) => candidate.key === this.proposalCardKey
    );
    if (!entry || !this.proposalTrade) {
      this.proposalCost.textContent = '';
      return;
    }
    const cost = getTradeCost(entry.rarity, this.proposalStars);
    if (!cost.tradable) {
      this.proposalCost.textContent = i18n.t('trade.cards.reason.friendship');
      this.proposalConfirm.disabled = true;
      return;
    }
    this.proposalCost.textContent = '';
    this.proposalCost.append(
      document.createTextNode(`${i18n.t('trade.costRarity', { rarity: i18n.t(`rarity.${entry.rarity}`) })} `),
      buildPrice(cost)
    );
    this.proposalConfirm.disabled = false;
  }

  /**
   * Sends the proposal.
   *
   * @returns {Promise<void>} Resolves once the worker answered.
   */
  async submitProposal() {
    if (this.isBusy || !this.proposalTrade) return;
    const entry = this.collectionEntries.find(
      (candidate) => candidate.key === this.proposalCardKey
    );
    if (!entry) {
      this.proposalError.hidden = false;
      this.proposalError.textContent = i18n.t('trade.error.pickCard');
      return;
    }

    this.isBusy = true;
    this.proposalConfirm.disabled = true;
    this.proposalError.hidden = true;
    try {
      await tradeManager.proposeTrade({
        tradeId: this.proposalTrade.id,
        entry,
        otherSet: this.proposalTrade?.initiator?.card?.set ?? '',
        partnerUuid: this.proposalTrade?.initiator?.uuid ?? '',
      });
      this.closeProposal();
      Toast.success('trade.proposed');
      await this.reload();
      this.scheduleRefresh();
    } catch (error) {
      console.warn('[TradeView] The proposal could not be sent.', error);
      // The request was denied, cancelled or accepted meanwhile: the dialog targets a dead state.
      if (error?.status === 409 || error?.status === 404) {
        this.closeProposal();
        Toast.error(getTradeErrorMessageKey(error));
        await this.reload();
      } else {
        this.proposalError.hidden = false;
        this.proposalError.textContent = i18n.t(getTradeErrorMessageKey(error));
      }
    } finally {
      this.isBusy = false;
      this.updateProposalCost();
    }
  }

  /**
   * Closes the proposal dialog.
   *
   * @returns {void}
   */
  closeProposal() {
    this.proposalModal.hidden = true;
    this.proposalTrade = null;
    this.proposalCardKey = '';
    this.proposalStars = 0;
    this.proposalError.hidden = true;
    this.proposalError.textContent = '';
  }

  /**
   * Opens the shared confirmation dialog.
   *
   * @param {{titleKey: string, bodyKey: string, confirmKey: string, tone: 'danger'|'primary',
   *   action: () => Promise<unknown>}} options - Dialog content and action.
   * @returns {void}
   */
  openConfirm({ titleKey, bodyKey, confirmKey, tone, action }) {
    this.pendingConfirm = action;
    this.confirmTitle.textContent = i18n.t(titleKey);
    this.confirmBody.textContent = i18n.t(bodyKey);
    this.confirmAction.textContent = i18n.t(confirmKey);
    this.confirmAction.className = `btn btn--${tone}`;
    this.confirmError.hidden = true;
    this.confirmError.textContent = '';
    this.confirmAction.disabled = false;
    this.confirmModal.hidden = false;
    this.confirmAction.focus();
  }

  /**
   * Runs the pending confirmation action.
   *
   * @returns {Promise<void>} Resolves once the action finished.
   */
  async runConfirm() {
    if (this.isBusy) return;
    // A dialog opened only to explain something (`showBlocked()`): its button closes it.
    if (!this.pendingConfirm) {
      this.closeConfirm();
      return;
    }
    const action = this.pendingConfirm;
    this.isBusy = true;
    this.confirmAction.disabled = true;
    this.confirmError.hidden = true;
    try {
      await action();
      this.closeConfirm();
      await this.reload();
      this.scheduleRefresh();
    } catch (error) {
      console.warn('[TradeView] The trade action failed.', error);
      // 409/404: the trade moved on the other side (denied, withdrawn, expired, completed). The
      // dialog is about a state that no longer exists, so it closes and the lists are repainted
      // instead of letting the player retry the same impossible action.
      if (error?.status === 409 || error?.status === 404) {
        this.closeConfirm();
        Toast.error(getTradeErrorMessageKey(error));
        await this.reload();
      } else {
        this.confirmError.hidden = false;
        this.confirmError.textContent = i18n.t(getTradeErrorMessageKey(error));
      }
    } finally {
      this.isBusy = false;
      this.confirmAction.disabled = false;
    }
  }

  /**
   * Closes the confirmation dialog.
   *
   * @returns {void}
   */
  closeConfirm() {
    this.confirmModal.hidden = true;
    this.pendingConfirm = null;
    this.confirmError.hidden = true;
    this.confirmError.textContent = '';
  }

  /**
   * Denies a request. Kept as a method so the confirm dialog owns the busy state.
   *
   * @param {object} trade - Incoming trade.
   * @returns {Promise<void>} Resolves once the worker answered.
   */
  async deny(trade) {
    await tradeManager.denyTrade(trade.id);
    Toast.info('trade.denied');
  }

  /**
   * Withdraws the counter-proposal of a responder, back to the initiator's request.
   *
   * @param {object} trade - Trade with an open proposal.
   * @returns {Promise<void>} Resolves once the worker answered.
   */
  async withdraw(trade) {
    await tradeManager.cancelTrade(trade.id);
    Toast.info('trade.withdrawn');
  }

  /**
   * Cancels a request.
   *
   * @param {object} trade - Outgoing trade.
   * @returns {Promise<void>} Resolves once the worker answered.
   */
  async cancel(trade) {
    await tradeManager.cancelTrade(trade.id);
    Toast.info('trade.cancelled');
  }

  /**
   * Accepts a proposal.
   *
   * @param {object} trade - Outgoing trade.
   * @returns {Promise<void>} Resolves once the worker answered.
   */
  async accept(trade) {
    await tradeManager.acceptTrade(trade.id);
    Toast.success('trade.accepted');
  }

  /**
   * Claims the received card and plays the exchange animation.
   *
   * @param {object} trade - Accepted trade.
   * @returns {Promise<void>} Resolves once the card is claimed.
   */
  async claim(trade) {
    if (this.isBusy) return;
    this.isBusy = true;
    try {
      const received = await tradeManager.claimTrade(trade);
      // A received card may be wishlisted: the dialog is shown BEFORE the animation, so the answer
      // is stored while the trade is still the current screen. The option decides for the player
      // when it is on (`wishlistAutoRemoveTrade`, OFF by default).
      await this.handleReceivedWishlist(received);
      await this.reload();
      this.scheduleRefresh();
      // A finished exchange is when the partner is worth offering as a friend. The prompt is
      // prepared here and displayed once the claim animation is closed.
      this.pendingFriend = received ? await this.findFriendCandidate(trade) : null;
      if (received) {
        await this.playClaimAnimation(trade, received);
      } else {
        Toast.info('trade.claimed');
        this.openFriendPrompt();
      }
    } catch (error) {
      console.warn('[TradeView] The card could not be claimed.', error);
      Toast.error(getTradeErrorMessageKey(error));
      // A closed trade (expired while the list was stale, already claimed on the other side) must
      // disappear from the lists rather than stay claimable on screen.
      if (error?.status === 409 || error?.status === 404) await this.reload();
    } finally {
      this.isBusy = false;
    }
  }

  /**
   * Plays the exchange animation: the card given leaves upwards, the card received drops in.
   *
   * @param {object} trade - Trade claimed.
   * @param {object} received - Card payload received.
   * @returns {Promise<void>} Resolves once the dialog is displayed.
   */
  async playClaimAnimation(trade, received) {
    const isInitiator = trade.my_role === 'initiator';
    const given = isInitiator ? trade.initiator.card : trade.responder.card;

    this.claimTitle.textContent = i18n.t('trade.claim.title');
    this.claimText.textContent = i18n.t('trade.claim.body', {
      card: received.name || received.card_id,
    });
    this.claimStage.classList.remove('is-animating');
    this.claimOut.textContent = '';
    this.claimIn.textContent = '';
    // Artwork only: the animation is about the two cards, and a caption over an 8rem card would
    // hide half of it.
    this.claimOut.appendChild(await this.buildCardTile(given, { artOnly: true }));
    this.claimIn.appendChild(await this.buildCardTile(received, { artOnly: true }));
    this.claimClose.disabled = true;
    this.claimModal.hidden = false;

    // Two frames so the browser paints the initial state before the timeline starts.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => this.claimStage.classList.add('is-animating'));
    });

    if (this.animationTimer !== null) clearTimeout(this.animationTimer);
    this.animationTimer = setTimeout(() => {
      this.claimClose.disabled = false;
      this.animationTimer = null;
    }, CLAIM_ANIMATION_MS);
  }

  /**
   * Reads the wishlist of one player from the Follow List cache.
   *
   * The cache is filled by `refreshFollowing()` in the same batch as the cards, so this never
   * costs a request of its own.
   *
   * @param {string} uuid - Player UUID.
   * @returns {Promise<string[]>} The wishlisted keys (empty for an unknown player).
   */
  async getWishlistOf(uuid) {
    if (typeof uuid !== 'string' || uuid === '') return [];
    try {
      const { wishlists } = await socialManager.refreshFollowing();
      this.wishlists = new Map(Object.entries(wishlists ?? {}));
    } catch (error) {
      console.warn('[TradeView] The wishlists could not be refreshed.', error);
    }
    return this.wishlists.get(uuid) ?? [];
  }

  /**
   * Asks the player what to do with a wishlisted card just received in a trade.
   *
   * @param {object|null} received - Card payload received, or null when nothing was claimed.
   * @returns {Promise<void>} Resolves once the wishlist reflects the answer.
   */
  async handleReceivedWishlist(received) {
    if (!received || typeof received.key !== 'string' || received.key === '') return;
    let state = 'absent';
    try {
      state = await wishlistManager.handleTradeReceived(received.key);
    } catch (error) {
      console.warn('[TradeView] The wishlist of the received card could not be read.', error);
      return;
    }
    if (state !== 'ask') return;

    const answer = await askWishlistRemoval({
      cardName: received.name || received.card_id || received.key,
    });
    if (answer === WISHLIST_POPUP_ANSWERS.NO) return;

    try {
      await wishlistManager.remove(received.key);
      if (answer === WISHLIST_POPUP_ANSWERS.ALWAYS) {
        await accountManager.updateSettings({ wishlistAutoRemoveTrade: true });
      }
      Toast.success('trade.wishlist.removed');
    } catch (error) {
      console.error('[TradeView] The received card could not leave the wishlist.', error);
      Toast.error('trade.wishlist.error');
    }
  }

  /**
   * Reads the partner of a trade and tells whether they still have to be followed.
   *
   * @param {object} trade - Trade that was just claimed.
   * @returns {Promise<{uuid: string, name: string}|null>} The partner, or null when the trade has
   *   no usable uuid or the player already follows them.
   */
  async findFriendCandidate(trade) {
    const isInitiator = trade.my_role === 'initiator';
    const other = isInitiator ? trade.responder : trade.initiator;
    if (!other || typeof other.uuid !== 'string' || other.uuid === '') return null;
    try {
      const following = await socialManager.getFollowing();
      if (following.includes(other.uuid)) return null;
    } catch (error) {
      console.warn('[TradeView] The follow list could not be read.', error);
      return null;
    }
    return {
      uuid: other.uuid,
      name: other.username || i18n.t('profile.anonymous'),
    };
  }

  /**
   * Offers to follow the partner of the exchange that just completed.
   *
   * @returns {void}
   */
  openFriendPrompt() {
    if (!this.pendingFriend) return;
    this.friendTitle.textContent = i18n.t('trade.friend.title', { name: this.pendingFriend.name });
    this.friendBody.textContent = i18n.t('trade.friend.body', { name: this.pendingFriend.name });
    this.friendError.hidden = true;
    this.friendError.textContent = '';
    this.friendAdd.disabled = false;
    this.friendModal.hidden = false;
    this.friendAdd.focus();
  }

  /**
   * Dismisses the friend proposal.
   *
   * @returns {void}
   */
  closeFriendPrompt() {
    this.friendModal.hidden = true;
    this.friendError.hidden = true;
    this.friendError.textContent = '';
    this.pendingFriend = null;
  }

  /**
   * Follows the partner of the exchange.
   *
   * @returns {Promise<void>} Resolves once the worker answered.
   */
  async addFriend() {
    if (!this.pendingFriend || this.isFriendBusy) return;
    this.isFriendBusy = true;
    this.friendAdd.disabled = true;
    this.friendError.hidden = true;
    const { uuid, name } = this.pendingFriend;
    try {
      await socialManager.addFollow(uuid);
      this.closeFriendPrompt();
      Toast.success('trade.friend.added', { params: { name } });
    } catch (error) {
      console.warn('[TradeView] The partner could not be followed.', error);
      this.friendError.hidden = false;
      this.friendError.textContent = i18n.t(getSocialErrorMessageKey(error));
    } finally {
      this.isFriendBusy = false;
      this.friendAdd.disabled = false;
    }
  }

  /**
   * Closes the claim dialog, then offers the partner as a friend.
   *
   * @returns {void}
   */
  closeClaim() {
    if (this.animationTimer !== null) {
      clearTimeout(this.animationTimer);
      this.animationTimer = null;
    }
    this.claimModal.hidden = true;
    this.claimStage.classList.remove('is-animating');
    this.claimClose.disabled = false;
    if (this.isActive) this.openFriendPrompt();
  }

  /**
   * Removes every listener.
   *
   * @returns {void}
   */
  destroy() {
    this.bindings.forEach(({ target, type, handler }) => target.removeEventListener(type, handler));
    this.bindings = [];
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    // No dialog may be opened on a torn-down view: `closeClaim()` chains the friend prompt.
    this.isActive = false;
    this.closeClaim();
    this.closeFriendPrompt();
  }

  /**
   * Formats a worker timestamp (`YYYY-MM-DD HH:MM:SS`, UTC).
   *
   * @param {unknown} value - Raw timestamp.
   * @returns {string} A localized date, or an empty string.
   */
  formatDate(value) {
    if (typeof value !== 'string' || value === '') return '';
    const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
      ? `${value.replace(' ', 'T')}Z`
      : value;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(i18n.getLang(), {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  /**
   * Displays a feedback line above the lists.
   *
   * @param {string|null} key - Translation key, or null to clear.
   * @param {'info'|'warning'|'error'} [tone='info'] - Visual tone.
   * @returns {void}
   */
  setFeedback(key, tone = 'info') {
    if (!this.feedbackElement) return;
    if (!key) {
      this.feedbackElement.hidden = true;
      this.feedbackElement.textContent = '';
      this.feedbackElement.removeAttribute('data-tone');
      return;
    }
    this.feedbackElement.hidden = false;
    this.feedbackElement.textContent = i18n.t(key);
    this.feedbackElement.dataset.tone = tone;
  }

}

export default TradeView;

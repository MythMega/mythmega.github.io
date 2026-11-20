/**
 * TradeView - The "Échanges" tab of the Social page.
 *
 * The view owns the DOM only: `TradeManager` speaks to the worker and to the local escrow,
 * `SocialManager` provides the followed players, `CollectionManager` the cards that can be offered.
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
import notificationCenter from '../components/NotificationCenter.js';
import socialManager from '../../business/SocialManager.js';
import collectionManager from '../../business/CollectionManager.js';
import boosterManager from '../../business/BoosterManager.js';
import tradeManager, {
  TradeManager,
  TRADE_EXPIRY_HOURS,
  TRADE_MAX_ENDER_EYES,
  TRADE_STATUSES,
  getTradeCost,
  getTradeErrorMessageKey,
} from '../../business/TradeManager.js';

/** How long a loaded trade list is considered fresh when the tab is shown again. */
const TRADE_VIEW_CACHE_MS = 15_000;

/** How long the claim animation runs before the dialog can be closed, in milliseconds. */
const CLAIM_ANIMATION_MS = 2400;

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
    this.incomingGroup = query('[data-trade-incoming-group]');
    this.outgoingGroup = query('[data-trade-outgoing-group]');
    this.historyGroup = query('[data-trade-history-group]');
    this.incomingList = query('[data-trade-incoming]');
    this.outgoingList = query('[data-trade-outgoing]');
    this.historyList = query('[data-trade-history]');
    this.newButton = query('[data-trade-new]');
    this.refreshButton = query('[data-trade-refresh]');

    this.newModal = modalQuery('[data-trade-new-modal]');
    this.newForm = modalQuery('[data-trade-new-form]');
    this.friendSelect = modalQuery('[data-trade-friend]');
    this.cardList = modalQuery('[data-trade-cards]');
    this.newError = modalQuery('[data-trade-new-error]');
    this.newConfirm = modalQuery('[data-trade-new-confirm]');
    this.newCost = modalQuery('[data-trade-new-cost]');
    this.newCloseButtons = scopeElement.querySelectorAll('[data-trade-new-close]');

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

    this.view = tradeManager.buildEmptyView();
    this.collectionEntries = [];
    this.friends = [];
    this.imageCache = new Map();
    this.selectedCardKey = '';
    this.proposalTrade = null;
    this.proposalCardKey = '';
    this.pendingConfirm = null;
    this.isBusy = false;
    this.isActive = false;
    this.loadedAt = 0;
    this.animationTimer = null;
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
      ['[data-trade-incoming]', this.incomingList],
      ['[data-trade-outgoing]', this.outgoingList],
      ['[data-trade-history]', this.historyList],
      ['[data-trade-new]', this.newButton],
      ['[data-trade-refresh]', this.refreshButton],
      ['[data-trade-new-modal]', this.newModal],
      ['[data-trade-new-form]', this.newForm],
      ['[data-trade-friend]', this.friendSelect],
      ['[data-trade-cards]', this.cardList],
      ['[data-trade-new-confirm]', this.newConfirm],
      ['[data-trade-proposal-modal]', this.proposalModal],
      ['[data-trade-proposal-cards]', this.proposalCards],
      ['[data-trade-proposal-confirm]', this.proposalConfirm],
      ['[data-trade-confirm-modal]', this.confirmModal],
      ['[data-trade-confirm-action]', this.confirmAction],
      ['[data-trade-claim-modal]', this.claimModal],
      ['[data-trade-claim-stage]', this.claimStage],
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
    this.listen(this.root, 'click', (event) => void this.handleActionClick(event));

    this.listen(this.newForm, 'submit', (event) => {
      event.preventDefault();
      void this.submitNewTrade();
    });
    this.listen(this.friendSelect, 'change', () => this.updateNewCost());
    this.listen(this.cardList, 'click', (event) => this.selectCard(event, 'new'));
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

    this.listen(document, 'keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (!this.claimModal.hidden) {
        this.closeClaim();
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
    this.closeNewTrade();
    this.closeProposal();
    this.closeConfirm();
    this.closeClaim();
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
    if (!Array.isArray(notifications)) return;
    notifications.forEach((item) => notificationCenter.push(item));
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
    this.newButton.disabled = !this.view.ready;
    this.eyesElement.textContent = `${eyes} / ${TRADE_MAX_ENDER_EYES}`;

    const active = [...this.view.incoming, ...this.view.outgoing];
    void this.renderGroup(this.incomingList, this.incomingGroup, this.view.incoming);
    void this.renderGroup(this.outgoingList, this.outgoingGroup, this.view.outgoing);
    void this.renderGroup(this.historyList, this.historyGroup, this.view.history);
    this.emptyElement.hidden = active.length > 0 || this.view.history.length > 0;
    this.emptyElement.textContent = this.view.ready
      ? i18n.t('trade.empty')
      : i18n.t('trade.notReady');

  }

  /**
   * Paints one list of trades.
   *
   * @param {HTMLElement} list - Target `<ul>`.
   * @param {HTMLElement} group - Section wrapping the list.
   * @param {object[]} trades - Trades to paint.
   * @returns {Promise<void>} Resolves once every row is built.
   */
  async renderGroup(list, group, trades) {
    list.textContent = '';
    const rows = await Promise.all(trades.map((trade) => this.buildTradeRow(trade)));
    rows.forEach((row) => list.appendChild(row));
    group.hidden = rows.length === 0;
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
    cost.textContent = i18n.t('trade.cost', {
      eyes: trade.ender_eyes_cost,
      sparks: trade.sparks_cost,
    });
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
        button('propose', 'trade.action.replace', 'ghost');
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
   * @param {{label?: string, compact?: boolean, quantity?: number, cost?: string}} [options] - Tile
   *   options.
   * @returns {Promise<HTMLElement>} The tile.
   */
  async buildCardTile(payload, { label = '', compact = false, quantity = 0, cost = '' } = {}) {
    const tile = document.createElement('div');
    tile.className = compact ? 'trade__card trade__card--compact' : 'trade__card';

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
      detail.textContent = [
        quantity > 0 ? i18n.t('trade.quantity', { count: quantity }) : '',
        cost,
      ]
        .filter(Boolean)
        .join(' · ');
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
    if (action === 'cancel') {
      this.openConfirm({
        titleKey: 'trade.confirm.cancel.title',
        bodyKey: 'trade.confirm.cancel.body',
        confirmKey: 'trade.action.cancel',
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
   * Opens the new-trade dialog with the friends and the tradable cards.
   *
   * @returns {Promise<void>} Resolves once the dialog is filled.
   */
  async openNewTrade() {
    if (this.isBusy) return;
    this.selectedCardKey = '';
    this.newError.hidden = true;
    this.newError.textContent = '';
    this.newConfirm.disabled = true;
    this.cardList.textContent = '';
    this.newCost.textContent = '';
    this.newModal.hidden = false;

    try {
      const [{ cards }, collection] = await Promise.all([
        socialManager.refreshFollowing(),
        collectionManager.getCollectionView(),
      ]);
      this.friends = cards.filter((card) => card && typeof card.uuid === 'string');
      this.collectionEntries = TradeManager.listTradableEntries(collection);

      this.friendSelect.textContent = '';
      if (this.friends.length === 0) {
        this.newError.hidden = false;
        this.newError.textContent = i18n.t('trade.error.noFriends');
      }
      this.friends.forEach((card) => {
        const option = document.createElement('option');
        option.value = card.uuid;
        option.textContent = card.username || i18n.t('profile.anonymous');
        this.friendSelect.appendChild(option);
      });

      if (this.collectionEntries.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'trade__empty-cards';
        empty.textContent = i18n.t('trade.error.noDuplicates');
        this.cardList.appendChild(empty);
      } else {
        for (const entry of this.collectionEntries) {
          this.cardList.appendChild(await this.buildSelectableCard(entry));
        }
      }
      this.updateNewCost();
      this.friendSelect.focus();
    } catch (error) {
      console.error('[TradeView] The new-trade dialog could not be filled.', error);
      this.newError.hidden = false;
      this.newError.textContent = i18n.t(getTradeErrorMessageKey(error));
    }
  }

  /**
   * Builds one selectable card of the new-trade dialog.
   *
   * @param {object} entry - Owned collection entry.
   * @returns {Promise<HTMLElement>} The button.
   */
  async buildSelectableCard(entry) {
    const cost = getTradeCost(entry.rarity);
    const tile = await this.buildCardTile(
      {
        key: entry.key,
        card_id: entry.cardId,
        name: entry.card?.getName?.(i18n.getLang()) || entry.cardId,
      },
      {
        quantity: entry.quantity,
        cost: i18n.t('trade.costShort', { eyes: cost.enderEyes, sparks: cost.sparks }),
      }
    );
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'trade__card-button';
    button.dataset.tradeCard = entry.key;
    button.dataset.rarity = String(entry.rarity);
    button.setAttribute('aria-pressed', 'false');
    button.appendChild(tile);
    return button;
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
    const entry = this.collectionEntries.find((candidate) => candidate.key === this.selectedCardKey);
    if (!entry) {
      this.newCost.textContent = '';
      this.newConfirm.disabled = true;
      return;
    }
    const cost = getTradeCost(entry.rarity);
    const enoughEyes =
      this.view.enderEyes === null || this.view.enderEyes === undefined
        ? true
        : this.view.enderEyes >= cost.enderEyes;
    this.newCost.textContent = i18n.t('trade.costDetail', {
      rarity: i18n.t(`rarity.${entry.rarity}`),
      eyes: cost.enderEyes,
      sparks: cost.sparks,
    });
    this.newCost.dataset.tone = enoughEyes ? 'info' : 'error';
    this.newConfirm.disabled = this.friends.length === 0 || !enoughEyes;
    if (!enoughEyes) {
      this.newCost.textContent += ` · ${i18n.t('trade.error.notEnoughEnderEyes')}`;
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
    const responderUuid = this.friendSelect.value;
    if (!entry || !responderUuid) return;

    this.isBusy = true;
    this.newConfirm.disabled = true;
    this.newError.hidden = true;
    try {
      await tradeManager.createTrade({ responderUuid, entry });
      this.closeNewTrade();
      Toast.success('trade.created');
      await this.reload();
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
    this.selectedCardKey = '';
    this.newError.hidden = true;
    this.newError.textContent = '';
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
    this.proposalConfirm.disabled = true;
    this.proposalCost.textContent = '';
    this.proposalCards.textContent = '';
    this.proposalModal.hidden = false;

    try {
      const collection = await collectionManager.getCollectionView();
      const excluded = trade.initiator?.card?.key ?? '';
      this.collectionEntries = TradeManager.listTradableEntries(collection).filter(
        (entry) => entry.rarity === trade.rarity && entry.key !== excluded
      );
      if (this.collectionEntries.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'trade__empty-cards';
        empty.textContent = i18n.t('trade.error.noMatchingDuplicate', { rarity: trade.rarity });
        this.proposalCards.appendChild(empty);
      } else {
        for (const entry of this.collectionEntries) {
          this.proposalCards.appendChild(await this.buildSelectableCard(entry));
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
    const entry = this.collectionEntries.find(
      (candidate) => candidate.key === this.proposalCardKey
    );
    if (!entry || !this.proposalTrade) {
      this.proposalCost.textContent = '';
      this.proposalConfirm.disabled = true;
      return;
    }
    const cost = getTradeCost(entry.rarity);
    this.proposalCost.textContent = i18n.t('trade.costDetail', {
      rarity: i18n.t(`rarity.${entry.rarity}`),
      eyes: cost.enderEyes,
      sparks: cost.sparks,
    });
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
    if (!entry) return;

    this.isBusy = true;
    this.proposalConfirm.disabled = true;
    this.proposalError.hidden = true;
    try {
      await tradeManager.proposeTrade({ tradeId: this.proposalTrade.id, entry });
      this.closeProposal();
      Toast.success('trade.proposed');
      await this.reload();
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
    if (!this.pendingConfirm || this.isBusy) return;
    const action = this.pendingConfirm;
    this.isBusy = true;
    this.confirmAction.disabled = true;
    this.confirmError.hidden = true;
    try {
      await action();
      this.closeConfirm();
      await this.reload();
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
      await this.reload();
      if (received) {
        await this.playClaimAnimation(trade, received);
      } else {
        Toast.info('trade.claimed');
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
    this.claimOut.appendChild(await this.buildCardTile(given, { compact: true }));
    this.claimIn.appendChild(await this.buildCardTile(received, { compact: true }));
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
   * Closes the claim dialog.
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

  /**
   * Removes every listener.
   *
   * @returns {void}
   */
  destroy() {
    this.bindings.forEach(({ target, type, handler }) => target.removeEventListener(type, handler));
    this.bindings = [];
    this.closeClaim();
  }
}

export default TradeView;

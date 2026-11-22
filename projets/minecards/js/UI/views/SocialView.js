/**
 * SocialView - Follow List of published trainer cards.
 *
 * The view only orchestrates the DOM: `SocialManager` owns the worker calls and the local state,
 * `ProfileCard` redraws a followed card with the exact component of the profile page.
 */

import i18n from '../../utils/I18n.js';
import eventBus, { EVENTS } from '../../utils/EventBus.js';
import cardLanguage from '../../utils/CardLanguage.js';
import { createCardVisual } from '../../utils/CardSourceManager.js';
import socialManager, {
  getSocialErrorMessageKey,
  safeSocialAssetPath,
} from '../../business/SocialManager.js';
import likesManager, { LIKES_ERROR_CODES } from '../../business/LikesManager.js';
import titleManager, { TitleManager } from '../../business/TitleManager.js';
import boosterManager from '../../business/BoosterManager.js';
import collectionManager from '../../business/CollectionManager.js';
import trophyManager, { DEFAULT_TROPHY_ICON } from '../../business/TrophyManager.js';
import TrophyDetail from '../components/TrophyDetail.js';
import { decodeBinderCode } from '../../utils/BinderCode.js';
import { ProfileCard } from '../components/ProfileCard.js';
import TradeView from './TradeView.js';

/** View name, matching `data-view="social"` in `index.html`. */
export const SOCIAL_VIEW_NAME = 'social';

export class SocialView {
  /**
   * @param {HTMLElement} rootElement - The social `<section>`.
   */
  constructor(rootElement) {
    if (!rootElement || typeof rootElement.querySelector !== 'function') {
      throw new TypeError('SocialView requires the social section element.');
    }
    this.root = rootElement;
    const query = (selector) => this.root.querySelector(selector);

    this.tabs = [...this.root.querySelectorAll('[data-social-tab]')];
    this.panels = [...this.root.querySelectorAll('[data-social-panel]')];
    this.followList = query('[data-social-list]');
    this.emptyElement = query('[data-social-empty]');
    this.countElement = query('[data-social-count]');
    this.feedbackElement = query('[data-social-feedback]');
    this.addButton = query('[data-social-add]');
    this.refreshButton = query('[data-social-refresh]');
    this.updateButton = query('[data-social-update]');

    this.addModal = query('[data-social-add-modal]');
    this.addForm = query('[data-social-add-form]');
    this.addInput = query('[data-social-add-input]');
    this.addError = query('[data-social-add-error]');
    this.addSubmit = query('[data-social-add-submit]');
    this.addCloseButtons = this.root.querySelectorAll('[data-social-add-close]');

    this.detailModal = query('[data-social-detail-modal]');
    this.detailTitle = query('[data-social-detail-title]');
    this.detailCardHost = query('[data-social-detail-card]');
    this.detailMeta = query('[data-social-detail-meta]');
    this.detailUnfollow = query('[data-social-detail-unfollow]');
    this.detailLikes = query('[data-social-detail-likes]');
    this.detailLike = query('[data-social-detail-like]');
    this.detailFavorites = query('[data-social-detail-favorites]');
    this.detailBinder = query('[data-social-detail-binder]');
    this.detailWishlistButton = query('[data-social-detail-wishlist]');
    this.detailWishlistPanel = query('[data-social-detail-wishlist-panel]');
    this.detailCloseButtons = this.root.querySelectorAll('[data-social-detail-close]');

    this.binderModal = query('[data-social-binder-modal]');
    this.binderTitle = query('[data-social-binder-title]');
    this.binderPage = query('[data-social-binder-page]');
    this.binderSlots = query('[data-social-binder-slots]');
    this.binderCloseButtons = this.root.querySelectorAll('[data-social-binder-close]');

    this.likeAllButton = query('[data-social-like-all]');
    this.likeAllModal = query('[data-social-like-all-modal]');
    this.likeAllProgress = query('[data-social-like-all-progress]');
    this.likeAllRing = query('[data-social-like-all-ring]');
    this.likeAllValue = query('[data-social-like-all-value]');
    this.likeAllText = query('[data-social-like-all-text]');
    this.likeAllCloseButtons = this.root.querySelectorAll('[data-social-like-all-close]');

    this.unfollowModal = query('[data-social-unfollow-modal]');
    this.unfollowTitle = query('[data-social-unfollow-title]');
    this.unfollowBody = query('[data-social-unfollow-body]');
    this.unfollowError = query('[data-social-unfollow-error]');
    this.unfollowConfirm = query('[data-social-unfollow-confirm]');
    this.unfollowCloseButtons = this.root.querySelectorAll('[data-social-unfollow-close]');

    this.tradePanel = query('[data-social-panel="trade"]');
    this.tradeView = null;
    this.activeTab = 'follows';

    this.cards = new Map();
    this.following = [];
    /** Likes received by each followed player, read in one batch with the list. */
    this.likes = new Map();
    /** Favourites of each followed player (`{ cards, trophies, binder }`), read with the list. */
    this.favorites = new Map();
    /** Wishlist keys of each followed player, read in the same batch as the cards. */
    this.wishlists = new Map();
    /** Decoded binder of the opened friend, kept while their dialog is on screen. */
    this.openBinderPayload = null;
    /** Trophy catalogue indexed by id, loaded once for the pins of the card dialog. */
    this.trophyIndex = null;
    /** Friends that already received the like of the UTC day, from the save and the worker. */
    this.likedTargets = new Set();
    /** True while the "Like tout le monde" batch runs: the button and the dialog follow it. */
    this.likeAllRunning = false;
    this.openFriendUuid = '';
    this.pendingUnfollowUuid = '';
    this.profileCard = null;
    this.isLoading = false;
    this.isBusy = false;
    this.isInitialized = false;
    this.bindings = [];
    this.unsubscribers = [];

    this.assertMarkup();
  }

  /**
   * Logs with the view prefix.
   *
   * @param {...unknown} args - Values forwarded to `console.info`.
   * @returns {void}
   */
  log(...args) {
    console.info('[SocialView]', ...args);
  }

  /**
   * Verifies the markup contract.
   *
   * @returns {void}
   * @throws {Error} When a required element is missing.
   */
  assertMarkup() {
    const missing = [
      ['[data-social-list]', this.followList],
      ['[data-social-empty]', this.emptyElement],
      ['[data-social-feedback]', this.feedbackElement],
      ['[data-social-add]', this.addButton],
      ['[data-social-refresh]', this.refreshButton],
      ['[data-social-update]', this.updateButton],
      ['[data-social-add-modal]', this.addModal],
      ['[data-social-add-form]', this.addForm],
      ['[data-social-add-input]', this.addInput],
      ['[data-social-add-error]', this.addError],
      ['[data-social-detail-modal]', this.detailModal],
      ['[data-social-detail-card]', this.detailCardHost],
      ['[data-social-detail-meta]', this.detailMeta],
      ['[data-social-detail-unfollow]', this.detailUnfollow],
      ['[data-social-detail-likes]', this.detailLikes],
      ['[data-social-detail-like]', this.detailLike],
      ['[data-social-detail-favorites]', this.detailFavorites],
      ['[data-social-detail-binder]', this.detailBinder],
      ['[data-social-binder-modal]', this.binderModal],
      ['[data-social-binder-title]', this.binderTitle],
      ['[data-social-binder-page]', this.binderPage],
      ['[data-social-binder-slots]', this.binderSlots],
      ['[data-social-like-all]', this.likeAllButton],
      ['[data-social-like-all-modal]', this.likeAllModal],
      ['[data-social-like-all-progress]', this.likeAllProgress],
      ['[data-social-like-all-ring]', this.likeAllRing],
      ['[data-social-like-all-value]', this.likeAllValue],
      ['[data-social-like-all-text]', this.likeAllText],
      ['[data-social-unfollow-modal]', this.unfollowModal],
      ['[data-social-unfollow-title]', this.unfollowTitle],
      ['[data-social-unfollow-body]', this.unfollowBody],
      ['[data-social-unfollow-error]', this.unfollowError],
      ['[data-social-unfollow-confirm]', this.unfollowConfirm],
    ]
      .filter(([, element]) => !element)
      .map(([selector]) => selector);
    if (missing.length > 0) {
      throw new Error(`SocialView markup is incomplete, missing: ${missing.join(', ')}.`);
    }
    if (this.tabs.length === 0 || this.panels.length === 0) {
      throw new Error('SocialView markup is incomplete, missing the Follow List tab.');
    }
  }

  /**
   * Binds the interactions and waits for the first activation.
   *
   * @returns {void}
   */
  init() {
    if (this.isInitialized) return;
    this.isInitialized = true;
    this.bindEvents();
    this.subscribeToEvents();
    // The trade tab is optional: a stale `index.html` keeps the Follow List working alone.
    if (this.tradePanel) {
      try {
        this.tradeView = new TradeView(this.tradePanel, this.root);
        this.tradeView.init();
      } catch (error) {
        console.error('[SocialView] The trade tab could not be initialized.', error);
        this.tradeView = null;
      }
    }
    this.log('Ready.');
  }

  /**
   * Loads the list every time the page becomes visible.
   *
   * @returns {void}
   */
  handleViewActivated() {
    if (this.activeTab === 'trade' && this.tradeView) {
      this.tradeView.activate();
      return;
    }
    void this.reload();
  }

  /**
   * Attaches the local listeners.
   *
   * @returns {void}
   */
  bindEvents() {
    this.tabs.forEach((tab) => {
      this.listen(tab, 'click', () => this.showTab(tab.dataset.socialTab));
    });

    this.listen(this.addButton, 'click', () => this.openAddModal());
    this.listen(this.refreshButton, 'click', () =>
      void this.reload({ announce: true, force: true })
    );
    this.listen(this.updateButton, 'click', () => void this.publish());
    this.listen(this.likeAllButton, 'click', () => void this.openLikeAll());
    this.likeAllCloseButtons.forEach((button) => {
      this.listen(button, 'click', () => this.closeLikeAll());
    });
    this.listen(this.likeAllModal, 'click', (event) => {
      if (event.target === this.likeAllModal) this.closeLikeAll();
    });

    this.listen(this.followList, 'click', (event) => {
      const button = event.target instanceof Element
        ? event.target.closest('[data-social-friend]')
        : null;
      if (button) void this.openFriend(button.dataset.socialFriend);
    });

    this.listen(this.addForm, 'submit', (event) => {
      event.preventDefault();
      void this.addFollow();
    });
    this.addCloseButtons.forEach((button) => {
      this.listen(button, 'click', () => this.closeAddModal());
    });
    this.listen(this.addModal, 'click', (event) => {
      if (event.target === this.addModal) this.closeAddModal();
    });

    this.detailCloseButtons.forEach((button) => {
      this.listen(button, 'click', () => this.closeFriend());
    });
    this.listen(this.detailUnfollow, 'click', () => this.openUnfollowConfirmation());
    this.listen(this.detailLike, 'click', () => void this.likeFriend());
    this.listen(this.detailModal, 'click', (event) => {
      if (event.target === this.detailModal) this.closeFriend();
    });

    this.listen(this.detailWishlistButton, 'click', () => this.toggleDetailWishlist());

    this.listen(this.detailBinder, 'click', (event) => {
      const button = event.target instanceof Element
        ? event.target.closest('[data-social-binder-open]')
        : null;
      if (button) this.openFriendBinder();
    });
    this.binderCloseButtons.forEach((button) => {
      this.listen(button, 'click', () => this.closeFriendBinder());
    });
    this.listen(this.binderModal, 'click', (event) => {
      if (event.target === this.binderModal) this.closeFriendBinder();
    });

    this.unfollowCloseButtons.forEach((button) => {
      this.listen(button, 'click', () => this.closeUnfollowConfirmation());
    });
    this.listen(this.unfollowConfirm, 'click', () => void this.unfollowFriend());
    this.listen(this.unfollowModal, 'click', (event) => {
      if (event.target === this.unfollowModal) this.closeUnfollowConfirmation();
    });

    this.listen(document, 'keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (!this.likeAllModal.hidden) {
        this.closeLikeAll();
      } else if (!this.binderModal.hidden) {
        this.closeFriendBinder();
      } else if (!this.unfollowModal.hidden) {
        this.closeUnfollowConfirmation();
      } else if (!this.detailModal.hidden) {
        this.closeFriend();
      } else if (!this.addModal.hidden) {
        this.closeAddModal();
      }
    });
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
   * Follows the page lifecycle.
   *
   * @returns {void}
   */
  subscribeToEvents() {
    this.unsubscribers.push(eventBus.on(EVENTS.VIEW_CHANGED, (payload) => {
      if (payload?.view === SOCIAL_VIEW_NAME) this.handleViewActivated();
      if (payload?.previousView === SOCIAL_VIEW_NAME) {
        this.closeAddModal();
        this.closeUnfollowConfirmation();
        this.closeFriend();
        this.tradeView?.deactivate();
      }
    }));
  }

  /**
   * Shows one internal tab (Follow List for now).
   *
   * @param {string} name - `data-social-tab` value.
   * @returns {void}
   */
  showTab(name) {
    if (typeof name !== 'string') return;
    this.tabs.forEach((tab) => {
      const active = tab.dataset.socialTab === name;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    this.panels.forEach((panel) => {
      panel.hidden = panel.dataset.socialPanel !== name;
    });
    this.activeTab = name;
    // The trade tab owns its own loading: switching to it must not perform a Follow List read.
    if (this.tradeView) {
      if (name === 'trade') this.tradeView.activate();
      else this.tradeView.deactivate();
    }
  }

  /**
   * Fetches the followed cards and paints the list.
   *
   * @param {object} [options] - Display options.
   * @param {boolean} [options.announce=false] - Shows the "refreshed" confirmation.
   * @param {boolean} [options.force=false] - Ignores the per-card refresh delay.
   * @returns {Promise<void>} Resolves once the list is painted.
   */
  async reload({ announce = false, force = false } = {}) {
    if (this.isLoading) return;
    this.isLoading = true;
    this.root.setAttribute('aria-busy', 'true');
    this.setFeedback(announce ? 'social.refreshing' : null);
    try {
      const { following, cards, favorites, wishlists } = await socialManager.refreshFollowing({
        force,
      });
      this.following = following;
      await this.renderCount();
      this.cards = new Map(cards.map((card) => [card.uuid, card]));
      this.favorites = new Map(Object.entries(favorites ?? {}));
      this.wishlists = new Map(Object.entries(wishlists ?? {}));
      // The hearts of the whole list come in one public request. A failure only hides them: the
      // Follow List itself must never depend on the likes endpoint.
      try {
        this.likes = new Map(Object.entries(await likesManager.getCounts(following)));
      } catch (error) {
        console.warn('[SocialView] The likes of the followed players could not be read.', error);
        this.likes = new Map();
      }
      this.likedTargets = await likesManager.getLikedTargets();
      await this.renderList();
      this.refreshLikeAllButton();
      const missing = following.filter((uuid) => !this.cards.has(uuid)).length;
      if (following.length === 0) {
        this.setFeedback(null);
      } else if (missing > 0) {
        this.setFeedback('social.missing', 'warning', { count: missing });
      } else if (announce) {
        this.setFeedback('social.refreshed', 'info');
      } else {
        this.setFeedback(null);
      }
    } catch (error) {
      console.error('[SocialView] The followed cards could not be loaded.', error);
      this.setFeedback(getSocialErrorMessageKey(error), 'error');
    } finally {
      this.isLoading = false;
      this.root.removeAttribute('aria-busy');
    }
  }

  /**
   * Paints the friend counter: how many players are followed, over the configured limit.
   *
   * The limit comes from `social.maxFriends` of `config.json` (`SocialManager.getMaxFriends()`),
   * the same value `addFollow` enforces. It turns the accent colour once the list is full, so the
   * refusal of the next follow is announced before the player tries.
   *
   * @returns {Promise<void>} Resolves once the counter is painted.
   */
  async renderCount() {
    if (!this.countElement) return;
    let max = 50;
    try {
      max = await socialManager.getMaxFriends();
    } catch (error) {
      console.warn('[SocialView] The friend limit could not be read.', error);
    }
    this.countElement.textContent = i18n.t('social.count', {
      count: this.following.length,
      max,
    });
    this.countElement.dataset.full = this.following.length >= max ? 'true' : 'false';
  }

  /**
   * Paints the followed players in follow order.
   *
   * @returns {Promise<void>} Resolves once every row is built.
   */
  async renderList() {
    this.followList.textContent = '';
    const rows = await Promise.all(
      this.following
        .map((uuid) => this.cards.get(uuid))
        .filter(Boolean)
        .map((card) => this.buildFriendRow(card))
    );
    rows.forEach((row) => this.followList.appendChild(row));
    this.emptyElement.hidden = rows.length > 0;
  }

  /**
   * Builds one friend card: avatar with rarity ring and level, identity, rarity, three stats and
   * the last publication date. The whole card stays a single button that opens the full card.
   *
   * @param {object} card - Public card.
   * @returns {Promise<HTMLLIElement>} The row.
   */
  async buildFriendRow(card) {
    const item = document.createElement('li');
    item.className = 'social__item';
    const rarity = Math.min(6, Math.max(1, Math.trunc(Number(card.card_rarity) || 1)));
    const rarityLabel = i18n.t(`rarity.${rarity}`);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'social__friend';
    button.dataset.socialFriend = card.uuid;
    button.dataset.rarity = String(rarity);

    const avatar = document.createElement('span');
    avatar.className = 'social__avatar';
    avatar.dataset.rarity = String(rarity);
    const path = safeSocialAssetPath(card.profile_picture_id);
    if (path !== '') {
      const image = document.createElement('img');
      image.className = 'social__avatar-image';
      image.src = i18n.resolveImagePath(path);
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.addEventListener('error', () => image.remove());
      avatar.appendChild(image);
    } else {
      const fallback = document.createElement('span');
      fallback.className = 'social__avatar-fallback';
      fallback.textContent = (card.username || '?').slice(0, 1).toUpperCase();
      avatar.appendChild(fallback);
    }
    const level = document.createElement('span');
    level.className = 'social__level';
    level.textContent = String(Math.max(1, Math.trunc(Number(card.level) || 1)));
    level.setAttribute('aria-hidden', 'true');
    avatar.appendChild(level);

    const identity = document.createElement('span');
    identity.className = 'social__identity';
    const headline = document.createElement('span');
    headline.className = 'social__headline';
    const name = document.createElement('span');
    name.className = 'social__name';
    name.textContent = card.username || i18n.t('profile.anonymous');
    const badge = document.createElement('span');
    badge.className = 'social__rarity';
    badge.dataset.rarity = String(rarity);
    badge.textContent = rarityLabel;
    badge.title = rarityLabel;
    headline.append(name, badge);

    const title = document.createElement('span');
    title.className = 'social__title';
    const titleText = await this.resolveTitle(card.title_id);
    title.textContent = titleText || i18n.t('social.friend.noTitle');
    title.classList.toggle('is-empty', titleText === '');

    const stats = document.createElement('span');
    stats.className = 'social__stats';
    [
      ['social.stat.likes', this.likes.get(card.uuid) ?? 0],
      ['social.stat.cards', card.different_cards],
      ['social.stat.boosters', card.open_booster],
      ['social.stat.points', card.points],
    ].forEach(([labelKey, value]) => {
      const stat = document.createElement('span');
      stat.className = 'social__stat';
      const amount = document.createElement('strong');
      amount.className = 'social__stat-value';
      amount.textContent = this.formatNumber(value);
      const label = document.createElement('span');
      label.className = 'social__stat-label';
      label.textContent = i18n.t(labelKey);
      stat.append(amount, label);
      stats.appendChild(stat);
    });

    const updated = document.createElement('span');
    updated.className = 'social__updated';
    const updatedDate = this.formatDate(card.updated_at);
    updated.textContent = updatedDate ? i18n.t('social.friend.updated', { date: updatedDate }) : '';
    if (!updatedDate) updated.hidden = true;

    identity.append(headline, title, stats, updated);

    const chevron = document.createElement('span');
    chevron.className = 'social__chevron';
    chevron.textContent = '›';
    chevron.setAttribute('aria-hidden', 'true');

    button.setAttribute(
      'aria-label',
      i18n.t('social.friend.aria', {
        name: name.textContent,
        level: String(Math.max(1, Math.trunc(Number(card.level) || 1))),
      })
    );
    button.append(avatar, identity, chevron);
    item.appendChild(button);
    return item;
  }

  /**
   * Formats a counter with the separators of the active language.
   *
   * @param {unknown} value - Raw counter.
   * @returns {string} The formatted non-negative integer.
   */
  formatNumber(value) {
    const count = Math.max(0, Math.trunc(Number(value) || 0));
    return new Intl.NumberFormat(i18n.getLang()).format(count);
  }

  /**
   * Formats the worker timestamp of a publication.
   *
   * The worker stores `YYYY-MM-DD HH:MM:SS` in UTC, which `Date` does not parse consistently in
   * every browser: the space is replaced and the UTC suffix added explicitly.
   *
   * @param {unknown} value - Raw `updated_at` value.
   * @returns {string} A localized date, or an empty string when the value is unusable.
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
      year: 'numeric',
    }).format(date);
  }

  /**
   * Resolves the worn title of a remote card.
   *
   * @param {unknown} id - Title id.
   * @returns {Promise<string>} The translated title, or an empty string.
   */
  async resolveTitle(id) {
    if (typeof id !== 'string' || id === '' || id === 'none') return '';
    try {
      const title = await titleManager.getTitle(id);
      return title ? TitleManager.titleText(title, i18n.getLang()) : '';
    } catch (error) {
      console.warn(`[SocialView] The title "${id}" could not be read.`, error);
      return '';
    }
  }

  /**
   * Opens the UUID dialog.
   *
   * @returns {void}
   */
  openAddModal() {
    this.addInput.value = '';
    this.addError.hidden = true;
    this.addError.textContent = '';
    this.addModal.hidden = false;
    this.addInput.focus();
  }

  /**
   * Closes the UUID dialog.
   *
   * @returns {void}
   */
  closeAddModal() {
    if (this.addModal.hidden) return;
    this.addModal.hidden = true;
    this.addInput.value = '';
    this.addError.hidden = true;
  }

  /**
   * Validates, checks and saves a followed UUID.
   *
   * @returns {Promise<void>} Resolves once the flow finishes.
   */
  async addFollow() {
    if (this.isBusy) return;
    const uuid = this.addInput.value.trim();
    this.addError.hidden = true;
    this.addSubmit.disabled = true;
    try {
      await socialManager.addFollow(uuid);
      this.closeAddModal();
      this.setFeedback('social.added', 'info');
      await this.reload();
    } catch (error) {
      console.warn('[SocialView] The player could not be followed.', error);
      this.addError.hidden = false;
      this.addError.textContent = i18n.t(getSocialErrorMessageKey(error));
    } finally {
      this.addSubmit.disabled = false;
      if (!this.addModal.hidden) this.addInput.focus();
    }
  }

  /**
   * Publishes or updates the local card.
   *
   * @returns {Promise<void>} Resolves once the worker answered.
   */
  async publish() {
    if (this.isBusy) return;
    this.isBusy = true;
    this.updateButton.disabled = true;
    this.setFeedback('social.publish.loading');
    try {
      await socialManager.publishOwnCard();
      this.setFeedback('social.publish.success', 'info');
    } catch (error) {
      console.error('[SocialView] The trainer card could not be published.', error);
      this.setFeedback(getSocialErrorMessageKey(error), 'error');
    } finally {
      this.isBusy = false;
      this.updateButton.disabled = false;
    }
  }

  /**
   * Shows one followed card in the detail dialog.
   *
   * @param {string} uuid - Followed UUID.
   * @returns {Promise<void>} Resolves once the card is drawn.
   */
  async openFriend(uuid) {
    const card = this.cards.get(uuid);
    if (!card) return;

    this.openFriendUuid = uuid;
    this.detailUnfollow.disabled = false;

    this.detailTitle.textContent = i18n.t('social.detail.title', {
      name: card.username || i18n.t('profile.anonymous'),
    });
    const updated = typeof card.updated_at === 'string' ? card.updated_at.replace(' ', ' · ') : '-';
    this.detailMeta.textContent = i18n.t('social.detail.updated', { date: updated });
    // The header already read the authenticated state: reusing it avoids a second claim just for
    // knowing whether the button must be disabled.
    // The daily state of every friend comes from the save and from the worker: it is one read for
    // the whole session, not one per dialog.
    this.likedTargets = await likesManager.getLikedTargets();
    this.renderDetailLikes();
    await this.renderDetailFavorites(uuid);
    await this.renderDetailBinder(uuid);
    await this.renderDetailWishlist(uuid);

    this.detailModal.hidden = false;
    try {
      if (!this.profileCard) {
        this.profileCard = new ProfileCard(this.detailCardHost);
      }
      const model = await socialManager.buildRemoteCardModel(card);
      this.profileCard.setLayout(model.layout);
      await this.profileCard.render(model);
      this.profileCard.applyStage();
    } catch (error) {
      console.error('[SocialView] The followed card could not be rebuilt.', error);
      this.setFeedback('social.error.card', 'error');
    }
  }

  /**
   * Closes the card dialog.
   *
   * @returns {void}
   */
  closeFriend() {
    this.closeFriendBinder();
    this.detailModal.hidden = true;
    this.openFriendUuid = '';
    this.detailLikes.textContent = '';
    this.detailFavorites.textContent = '';
    this.detailFavorites.hidden = true;
    this.detailBinder.textContent = '';
    this.detailBinder.hidden = true;
    this.detailWishlistButton.textContent = '';
    this.detailWishlistButton.hidden = true;
    this.detailWishlistPanel.textContent = '';
    this.detailWishlistPanel.hidden = true;
    this.openBinderPayload = null;
  }

  /**
   * Draws the wishlist of the opened friend, with what the player owns.
   *
   * The three states the operator asked for: a card the viewer does not own at all is shown dark,
   * but its NAME is still there; a card owned once is greyed with "possédé : 1"; a card owned in
   * several copies keeps its normal colour (it is the tradable one) with its count.
   *
   * The quantities come from the local collection: the wishlist itself only holds keys.
   *
   * @param {string} uuid - Followed UUID.
   * @returns {Promise<void>} Resolves once the block is drawn (or hidden).
   */
  async renderDetailWishlist(uuid) {
    const host = this.detailWishlistPanel;
    if (!host || !this.detailWishlistButton) return;
    host.textContent = '';
    host.hidden = true;
    this.detailWishlistButton.hidden = true;

    const keys = this.wishlists.get(uuid) ?? [];
    if (!Array.isArray(keys) || keys.length === 0) return;

    const quantities = new Map();
    try {
      const view = await collectionManager.getCollectionView();
      (view.entries ?? []).forEach((entry) => {
        quantities.set(entry.key, entry.owned && entry.quantity > 0 ? entry.quantity : 0);
      });
    } catch (error) {
      console.warn('[SocialView] The local collection could not be read for the wishlist.', error);
    }

    const section = this.buildFavoriteSection('social.wishlist.title');
    const list = document.createElement('ul');
    list.className = 'social__wishlist-list';
    for (const key of keys) {
      let name = key;
      try {
        const card = await boosterManager.getCardByKey(key);
        if (card) name = card.getName(cardLanguage.getLang());
      } catch (error) {
        console.warn(`[SocialView] The wishlisted card \"${key}\" could not be read.`, error);
      }
      const quantity = quantities.get(key) ?? 0;
      const item = document.createElement('li');
      item.className = 'social__wishlist-item';
      // `missing`: not owned at all, `single`: owned once, `many`: at least one copy is tradable.
      item.dataset.state = quantity === 0 ? 'missing' : quantity === 1 ? 'single' : 'many';

      const label = document.createElement('span');
      label.className = 'social__wishlist-name';
      label.textContent = name;
      const count = document.createElement('span');
      count.className = 'social__wishlist-count';
      count.textContent =
        quantity > 0
          ? i18n.t('social.wishlist.owned', { count: quantity })
          : i18n.t('social.wishlist.none');
      item.append(label, count);
      list.appendChild(item);
    }
    section.appendChild(list);
    host.appendChild(section);

    this.detailWishlistButton.textContent = i18n.t('social.wishlist.open', { count: keys.length });
    this.detailWishlistButton.hidden = false;
  }

  /**
   * Shows or hides the wishlist block of the opened friend.
   *
   * @returns {void}
   */
  toggleDetailWishlist() {
    if (!this.detailWishlistPanel) return;
    this.detailWishlistPanel.hidden = !this.detailWishlistPanel.hidden;
  }

  /**
   * Shows the button that opens the binder a friend pinned on their card.
   *
   * The worker only relays the share code, so the NAME of the page comes from the code itself:
   * the button is labelled with it, and the page can be drawn without any binder route. A code
   * this version cannot read (a damaged row, a format written by a future version) leaves the
   * dialog exactly as it was, without a button that could only fail.
   *
   * @param {string} uuid - Followed UUID.
   * @returns {Promise<void>} Resolves once the block is drawn (or hidden).
   */
  async renderDetailBinder(uuid) {
    const host = this.detailBinder;
    if (!host) return;
    host.textContent = '';
    host.hidden = true;
    this.openBinderPayload = null;

    const code = this.favorites.get(uuid)?.binder ?? '';
    if (typeof code !== 'string' || code === '') return;

    let payload;
    try {
      payload = await decodeBinderCode(code);
    } catch (error) {
      console.warn('[SocialView] The binder of the opened player could not be read.', error);
      return;
    }
    this.openBinderPayload = payload;

    const name = typeof payload.name === 'string' ? payload.name.trim() : '';
    const label = name !== '' ? name : i18n.t('social.binder.untitled');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn--ghost social__binder-button';
    button.dataset.socialBinderOpen = '';
    button.textContent = i18n.t('social.binder.button', { name: label });
    button.setAttribute('aria-label', i18n.t('social.binder.openAria', { name: label }));
    host.appendChild(button);
    host.hidden = false;
  }

  /**
   * Opens the binder of the friend whose card is shown.
   *
   * The page is drawn from the decoded code alone: the cover card is the backdrop and every slot
   * holds the illustration of its card. The identity of the dialog stays the friend's card: the
   * `user` block of the code is ignored on purpose.
   *
   * @returns {void}
   */
  openFriendBinder() {
    const payload = this.openBinderPayload;
    if (!payload || !this.binderModal) return;

    const cards = Array.isArray(payload.cards) ? payload.cards : [];
    const slots = Array.isArray(payload.slots) ? payload.slots : [];
    const name = typeof payload.name === 'string' ? payload.name.trim() : '';
    this.binderTitle.textContent = name !== '' ? name : i18n.t('social.binder.untitled');

    // The backdrop is the `Background` of the representative card, exactly like the read-only page
    // of a shared binder.
    const cover = cards[payload.cover ?? -1];
    if (typeof cover?.b === 'string' && cover.b !== '') {
      this.binderPage.style.setProperty('--binder-backdrop', `url("${cover.b}")`);
    } else {
      this.binderPage.style.removeProperty('--binder-backdrop');
    }

    this.binderSlots.textContent = '';
    slots.forEach((index) => {
      const master = index === null || index === undefined ? null : cards[index] ?? null;
      const item = document.createElement('li');
      item.className = 'social__binder-slot';
      if (!master) {
        item.classList.add('is-empty');
      } else {
        const image = document.createElement('img');
        image.className = 'social__binder-card';
        image.src = i18n.resolveImagePath(String(master.l ?? ''));
        image.alt = this.binderCardName(master);
        image.loading = 'lazy';
        image.decoding = 'async';
        item.dataset.rarity = String(master.r ?? 1);
        item.appendChild(image);
      }
      this.binderSlots.appendChild(item);
    });

    this.binderModal.hidden = false;
    this.binderCloseButtons[0]?.focus();
    this.log('Binder of the opened player displayed.');
  }

  /**
   * Closes the binder dialog.
   *
   * @returns {void}
   */
  closeFriendBinder() {
    if (!this.binderModal || this.binderModal.hidden) return;
    this.binderModal.hidden = true;
  }

  /**
   * Picks the display name of a card of a decoded binder.
   *
   * @param {object} master - Compact card of the share code.
   * @returns {string} The name in the active language, falling back to the card id.
   */
  binderCardName(master) {
    const names = master?.n && typeof master.n === 'object' ? master.n : {};
    const lang = i18n.getLang();
    return names[lang] || names.fr || names.en || Object.values(names)[0] || String(master?.i ?? '');
  }

  /**
   * Paints the favourite cards and the featured trophies of the opened friend.
   *
   * Both lists come from the worker (`favorite` row of the account, written by the publication of
   * the card) and are resolved LOCALLY: a card key through the booster catalogue, a trophy id
   * through the trophy catalogue, so the dialog shows the same artwork the owner sees.
   *
   * @param {string} uuid - Followed UUID.
   * @returns {Promise<void>} Resolves once the block is drawn (or hidden).
   */
  async renderDetailFavorites(uuid) {
    const host = this.detailFavorites;
    if (!host) return;
    host.textContent = '';
    const entry = this.favorites.get(uuid) ?? null;
    const cards = Array.isArray(entry?.cards) ? entry.cards : [];
    const trophies = Array.isArray(entry?.trophies) ? entry.trophies : [];
    if (cards.length === 0 && trophies.length === 0) {
      host.hidden = true;
      return;
    }

    try {
      if (cards.length > 0) host.appendChild(await this.buildFavoriteCardsSection(cards));
      if (trophies.length > 0) {
        await this.loadTrophyIndex();
        host.appendChild(this.buildFavoriteTrophiesSection(trophies));
      }
      host.hidden = false;
    } catch (error) {
      console.warn('[SocialView] The favourites of the opened player could not be drawn.', error);
      host.textContent = '';
      host.hidden = true;
    }
  }

  /**
   * Builds the title of one favourites block.
   *
   * @param {string} labelKey - Translation key.
   * @returns {HTMLElement} The section, ready to receive its list.
   */
  buildFavoriteSection(labelKey) {
    const section = document.createElement('section');
    section.className = 'social__favorites';
    const title = document.createElement('h3');
    title.className = 'social__favorites-title';
    title.textContent = i18n.t(labelKey);
    section.appendChild(title);
    return section;
  }

  /**
   * Builds the strip of favourite cards.
   *
   * A key the local catalogue does not know any more (rebalanced extension, older save) keeps its
   * slot with the card back and the raw key as tooltip: hiding it would leave a pin nobody can see.
   *
   * @param {string[]} keys - Collection keys, in display order.
   * @returns {Promise<HTMLElement>} The section holding the strip.
   */
  async buildFavoriteCardsSection(keys) {
    const section = this.buildFavoriteSection('social.detail.favorites.cards');
    const list = document.createElement('ul');
    list.className = 'social__favorites-list';

    for (const key of keys) {
      let card = null;
      try {
        card = await boosterManager.getCardByKey(key);
      } catch (error) {
        console.warn(`[SocialView] The favourite card "${key}" could not be read.`, error);
      }
      const name = card ? card.getName(cardLanguage.getLang()) : key;
      const item = document.createElement('li');
      item.className = 'social__favorite social__favorite--card';
      item.title = name;

      if (card) {
        item.dataset.rarity = String(card.rarity);
        item.appendChild(createCardVisual(card, {
          className: 'social__favorite-image',
          alt: name,
          mini: true,
          loading: 'lazy',
          decoding: 'async',
        }));
      } else {
        const fallback = document.createElement('img');
        fallback.className = 'social__favorite-image is-missing';
        fallback.src = i18n.resolveImagePath('assets/img/card_back.png');
        fallback.alt = key;
        fallback.loading = 'lazy';
        fallback.decoding = 'async';
        item.appendChild(fallback);
      }
      list.appendChild(item);
    }

    section.appendChild(list);
    return section;
  }

  /**
   * Builds the strip of featured trophies.
   *
   * @param {string[]} ids - Trophy ids, in display order.
   * @returns {HTMLElement} The section holding the strip.
   */
  buildFavoriteTrophiesSection(ids) {
    const section = this.buildFavoriteSection('social.detail.favorites.trophies');
    const list = document.createElement('ul');
    list.className = 'social__favorites-list';

    ids.forEach((id) => {
      const trophy = this.trophyIndex?.get(id) ?? null;
      const label = trophy ? TrophyDetail.trophyTitle(trophy) : id;
      const item = document.createElement('li');
      item.className = 'social__favorite social__favorite--trophy';
      item.title = label;
      if (trophy && typeof trophy.rarity === 'string') item.dataset.rarity = trophy.rarity;
      // A featured trophy is unlocked by definition (the owner could only pin it): the medal is
      // drawn as such even when this player has not earned it yet.
      item.appendChild(TrophyDetail.buildMedal(
        trophy ?? { icon: DEFAULT_TROPHY_ICON, rarity: '', unlocked: true },
        'social__favorite-medal'
      ));
      list.appendChild(item);
    });

    section.appendChild(list);
    return section;
  }

  /**
   * Loads the trophy catalogue once, indexed by id.
   *
   * @returns {Promise<Map<string, object>>} Trophy id -> trophy entry.
   */
  async loadTrophyIndex() {
    if (this.trophyIndex) return this.trophyIndex;
    try {
      const state = await trophyManager.evaluate({ notify: false });
      this.trophyIndex = new Map((state?.trophies ?? []).map((trophy) => [trophy.id, trophy]));
    } catch (error) {
      console.warn('[SocialView] The trophy catalogue could not be read.', error);
      this.trophyIndex = new Map();
    }
    return this.trophyIndex;
  }

  /**
   * Writes the likes of the opened friend and the state of the like button.
   *
   * @returns {void}
   */
  renderDetailLikes() {
    const uuid = this.openFriendUuid;
    const count = this.likes.get(uuid) ?? 0;
    const liked = uuid !== '' && this.likedTargets.has(uuid);
    this.detailLikes.textContent =
      uuid === '' ? '' : i18n.t('social.detail.likes', { count: this.formatNumber(count) });
    this.detailLike.disabled = uuid === '' || liked;
    this.detailLike.title = liked ? i18n.t('social.like.already') : '';
  }

  /**
   * Gives the like of the UTC day to the opened friend.
   *
   * The worker refuses a second like the same day: the error is shown as is, and the button stays
   * disabled for the rest of the session once the day is used.
   *
   * @returns {Promise<void>} Resolves once the list and the dialog are repainted.
   */
  async likeFriend() {
    const uuid = this.openFriendUuid;
    if (uuid === '' || this.isBusy || this.likedTargets.has(uuid)) return;

    this.isBusy = true;
    this.detailLike.disabled = true;
    try {
      const result = await likesManager.like(uuid);
      this.likes.set(uuid, result.likes);
      this.likedTargets.add(uuid);
      const name = this.cards.get(uuid)?.username || i18n.t('profile.anonymous');
      this.setFeedback('social.like.success', 'info', { name });
      await this.renderList();
      this.refreshLikeAllButton();
    } catch (error) {
      const messageKey =
        error?.code === LIKES_ERROR_CODES.ALREADY_LIKED
          ? 'social.like.already'
          : error?.code === LIKES_ERROR_CODES.NO_ACCOUNT
            ? 'social.like.noAccount'
            : 'social.like.error';
      console.warn('[SocialView] The like could not be given.', error);
      this.setFeedback(messageKey, 'error');
      if (error?.code === LIKES_ERROR_CODES.ALREADY_LIKED) this.likedTargets.add(uuid);
    } finally {
      this.isBusy = false;
      this.renderDetailLikes();
    }
  }

  /**
   * Opens the "Like tout le monde" dialog and gives the like of the day to every followed player.
   *
   * The whole Follow List is sent in chunks of `LIKES_BATCH_SIZE` (`LikesManager.likeEveryone`), so
   * the circular progress shows a REAL ratio and a hundred friends cost four requests instead of a
   * hundred. The counts of the batch come back with it: the list is repainted without a second read.
   *
   * @returns {Promise<void>} Resolves once the batch finished (or its error was shown).
   */
  async openLikeAll() {
    if (this.likeAllRunning) return;

    const targets = this.following.filter((uuid) => uuid !== '' && this.cards.has(uuid));
    if (targets.length === 0) {
      this.setFeedback('social.likeAll.empty', 'warning');
      return;
    }

    this.likedTargets = await likesManager.getLikedTargets();
    const pending = targets.filter((uuid) => !this.likedTargets.has(uuid));
    if (pending.length === 0) {
      this.setFeedback('social.likeAll.done', 'info');
      return;
    }

    this.likeAllRunning = true;
    this.likeAllModal.hidden = false;
    this.setLikeAllProgress(0);
    this.likeAllText.textContent = i18n.t('social.likeAll.running', { done: 0, total: pending.length });
    this.refreshLikeAllButton();

    try {
      const result = await likesManager.likeEveryone(targets, {
        onProgress: ({ done, total }) => {
          this.setLikeAllProgress(total === 0 ? 1 : done / total);
          this.likeAllText.textContent = i18n.t('social.likeAll.running', { done, total });
        },
      });
      Object.entries(result.likes).forEach(([uuid, count]) => this.likes.set(uuid, count));
      this.likedTargets = await likesManager.getLikedTargets();
      this.setLikeAllProgress(1);
      const summary = i18n.t('social.likeAll.result', {
        count: this.formatNumber(result.liked.length),
        total: this.formatNumber(result.requested),
      });
      this.likeAllText.textContent =
        result.unknown.length > 0
          ? `${summary} ${i18n.t('social.likeAll.missing', { count: this.formatNumber(result.unknown.length) })}`
          : summary;
      await this.renderList();
      this.renderDetailLikes();
    } catch (error) {
      console.warn('[SocialView] The batch of likes failed.', error);
      this.likeAllText.textContent = i18n.t(
        error?.code === LIKES_ERROR_CODES.NO_ACCOUNT
          ? 'social.like.noAccount'
          : 'social.likeAll.error'
      );
    } finally {
      this.likeAllRunning = false;
      this.refreshLikeAllButton();
    }
  }

  /**
   * Draws the circular progress of the batch.
   *
   * @param {number} value - Ratio between 0 and 1.
   * @returns {void}
   */
  setLikeAllProgress(value) {
    const ratio = Math.max(0, Math.min(1, Number(value) || 0));
    const percent = Math.round(ratio * 100);
    if (this.likeAllValue) this.likeAllValue.textContent = `${percent} %`;
    if (this.likeAllProgress) this.likeAllProgress.setAttribute('aria-valuenow', String(percent));
    if (this.likeAllRing) {
      // The ring is a circle of radius 52: its full length is what the dash offset eats away.
      const circumference = 2 * Math.PI * 52;
      this.likeAllRing.style.strokeDasharray = `${circumference}`;
      this.likeAllRing.style.strokeDashoffset = `${circumference * (1 - ratio)}`;
    }
  }

  /**
   * Closes the batch dialog. A running batch keeps going: only its window is hidden.
   *
   * @returns {void}
   */
  closeLikeAll() {
    if (!this.likeAllModal || this.likeAllModal.hidden) return;
    this.likeAllModal.hidden = true;
  }

  /**
   * Disables the batch button when there is nobody left to like today.
   *
   * @returns {void}
   */
  refreshLikeAllButton() {
    if (!this.likeAllButton) return;
    const targets = this.following.filter((uuid) => this.cards.has(uuid));
    const pending = targets.filter((uuid) => !this.likedTargets.has(uuid));
    this.likeAllButton.disabled = this.likeAllRunning || pending.length === 0;
    this.likeAllButton.title =
      !this.likeAllRunning && targets.length > 0 && pending.length === 0
        ? i18n.t('social.likeAll.done')
        : '';
  }

  /**
   * Opens the confirmation dialog before removing the followed player shown in the card dialog.
   *
   * @returns {void}
   */
  openUnfollowConfirmation() {
    const card = this.cards.get(this.openFriendUuid);
    if (!card) return;

    this.pendingUnfollowUuid = this.openFriendUuid;
    this.unfollowTitle.textContent = i18n.t('social.unfollow.title', {
      name: card.username || i18n.t('profile.anonymous'),
    });
    this.unfollowBody.textContent = i18n.t('social.unfollow.body');
    this.unfollowError.hidden = true;
    this.unfollowError.textContent = '';
    this.unfollowConfirm.disabled = false;
    this.unfollowModal.hidden = false;
    this.unfollowConfirm.focus();
  }

  /**
   * Closes the unfollow confirmation and forgets the pending UUID.
   *
   * @returns {void}
   */
  closeUnfollowConfirmation() {
    this.unfollowModal.hidden = true;
    this.pendingUnfollowUuid = '';
    this.unfollowError.hidden = true;
    this.unfollowError.textContent = '';
  }

  /**
   * Stops following the player shown in the detail dialog and paints the shortened list.
   *
   * @returns {Promise<void>} Resolves once the list is up to date.
   */
  async unfollowFriend() {
    const uuid = this.pendingUnfollowUuid;
    if (uuid === '' || this.isBusy) return;

    this.isBusy = true;
    this.detailUnfollow.disabled = true;
    this.unfollowConfirm.disabled = true;
    try {
      await socialManager.removeFollow(uuid);
      this.following = this.following.filter((followed) => followed !== uuid);
      this.cards.delete(uuid);
      this.closeUnfollowConfirmation();
      this.closeFriend();
      await this.renderCount();
      await this.renderList();
      this.setFeedback('social.unfollowed', 'info');
    } catch (error) {
      console.error('[SocialView] The followed player could not be removed.', error);
      this.unfollowError.textContent = i18n.t('social.error.unfollow');
      this.unfollowError.hidden = false;
    } finally {
      this.isBusy = false;
      this.detailUnfollow.disabled = false;
      this.unfollowConfirm.disabled = false;
    }
  }

  /**
   * Displays a feedback line above the list.
   *
   * @param {string|null} key - Translation key, or null to clear.
   * @param {'info'|'warning'|'error'} [tone='info'] - Visual tone.
   * @param {object|null} [params=null] - Interpolation values.
   * @returns {void}
   */
  setFeedback(key, tone = 'info', params = null) {
    if (!this.feedbackElement) return;
    if (!key) {
      this.feedbackElement.hidden = true;
      this.feedbackElement.textContent = '';
      this.feedbackElement.removeAttribute('data-tone');
      return;
    }
    this.feedbackElement.hidden = false;
    this.feedbackElement.textContent = i18n.t(key, params);
    this.feedbackElement.dataset.tone = tone;
  }

  /**
   * Removes every listener (used when the application tears a view down).
   *
   * @returns {void}
   */
  destroy() {
    this.tradeView?.destroy();
    this.bindings.forEach(({ target, type, handler }) => target.removeEventListener(type, handler));
    this.bindings = [];
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers = [];
    this.isInitialized = false;
  }
}

export default SocialView;

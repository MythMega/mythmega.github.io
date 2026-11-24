/**
 * SocialView - Follow List of published trainer cards.
 *
 * The view only orchestrates the DOM: `SocialManager` owns the worker calls and the local state,
 * `ProfileCard` redraws a followed card with the exact component of the profile page.
 */

import i18n from '../../utils/I18n.js';
import eventBus, { EVENTS } from '../../utils/EventBus.js';
import cardLanguage from '../../utils/CardLanguage.js';
import { formatCompactNumber } from '../../utils/CompactNumber.js';
import { createCardVisual } from '../../utils/CardSourceManager.js';
import socialManager, {
  SOCIAL_ERROR_CODES,
  getSocialErrorMessageKey,
  isPseudoRefusal,
  safeSocialAssetPath,
} from '../../business/SocialManager.js';
import likesManager, { LIKES_ERROR_CODES } from '../../business/LikesManager.js';
import friendshipManager from '../../business/FriendshipManager.js';
import titleManager, { TitleManager } from '../../business/TitleManager.js';
import boosterManager from '../../business/BoosterManager.js';
import collectionManager from '../../business/CollectionManager.js';
import trophyManager, { DEFAULT_TROPHY_ICON } from '../../business/TrophyManager.js';
import TrophyDetail from '../components/TrophyDetail.js';
import { decodeBinderCode } from '../../utils/BinderCode.js';
import { attachCardTilt } from '../../utils/CardTilt.js';
import { ProfileCard } from '../components/ProfileCard.js';
import renamePseudoDialog from '../components/RenamePseudoDialog.js';
import cardDetailPopup from '../components/CardDetailPopup.js';
import { buildFriendshipLevel } from '../components/FriendshipLevel.js';
import TradeView from './TradeView.js';

/** View name, matching `data-view="social"` in `index.html`. */
export const SOCIAL_VIEW_NAME = 'social';

/** How long the like history read that feeds the friendship XP stays fresh, in milliseconds. */
const FRIENDSHIP_LIKES_SYNC_MS = 5 * 60_000;

/**
 * Normalizes a search text or a player name for the friend filter.
 *
 * Lowercases and strips the diacritics of both sides, so `Barriere` finds `Barrière` and
 * `MYTH` finds `Myth`. Control characters of a pasted value are replaced by a space, exactly
 * like `ProfileManager.sanitizeName()`, so the comparison never depends on an invisible byte.
 *
 * @param {unknown} value - Typed query or stored pseudo.
 * @returns {string} The comparable text (empty when the value carries nothing).
 */
function normalizeFriendQuery(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

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
    this.searchInput = query('[data-social-search]');
    this.searchFeedback = query('[data-social-search-feedback]');
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
    this.detailFriendship = query('[data-social-detail-friendship]');
    this.detailLike = query('[data-social-detail-like]');
    this.detailFavorites = query('[data-social-detail-favorites]');
    this.detailBinder = query('[data-social-detail-binder]');
    this.detailWishlistButton = query('[data-social-detail-wishlist]');
    /** @type {Array<{key: string, card: object|null, quantity: number}>} Wishlist of the opened friend. */
    this.detailWishlistEntries = [];
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

    this.historyButton = query('[data-social-history]');
    this.historyModal = query('[data-social-history-modal]');
    this.historyReceived = query('[data-social-history-received]');
    this.historySent = query('[data-social-history-sent]');
    this.historyFeedback = query('[data-social-history-feedback]');
    this.historyCloseButtons = this.root.querySelectorAll('[data-social-history-close]');
    this.historyTabs = [...this.root.querySelectorAll('[data-social-history-tab]')];
    this.historyPanels = [...this.root.querySelectorAll('[data-social-history-panel]')];

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
    /** Friendship XP per player, read with the list to paint the stars of every row. */
    this.friendshipXp = new Map();
    /** Friendship thresholds, read once from `settings/global_trophy.json`. */
    this.friendshipTiers = [];
    /** Last time the like history was read for the friendship XP (throttled). */
    this.likesSyncedAt = 0;
    /** Decoded binder of the opened friend, kept while their dialog is on screen. */
    this.openBinderPayload = null;
    /** Trophy catalogue indexed by id, loaded once for the pins of the card dialog. */
    this.trophyIndex = null;
    /** Friends that already received the like of the UTC day, from the save and the worker. */
    this.likedTargets = new Set();
    /** True while the "Like tout le monde" batch runs: the button and the dialog follow it. */
    this.likeAllRunning = false;
    /** True while the history request runs: the button refuses a second opening. */
    this.isHistoryLoading = false;
    /** Last history read from the worker, kept so a follow can repaint the dialog in place. */
    this.likeHistory = { received: [], sent: [] };
    /**
     * Rows of the Follow List with the text each one answers to, rebuilt by `renderList()`.
     *
     * The search field hides these rows instead of rebuilding them: a keystroke must not redraw
     * a hundred friend cards (and reload their avatars) again.
     *
     * @type {Array<{row: HTMLLIElement, haystack: string}>}
     */
    this.friendRows = [];
    /** Favourite cards of the opened friend, resolved through the local catalogue. */
    this.favoriteCards = new Map();
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
      ['[data-social-search]', this.searchInput],
      ['[data-social-search-feedback]', this.searchFeedback],
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
      ['[data-social-detail-friendship]', this.detailFriendship],
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
      ['[data-social-history]', this.historyButton],
      ['[data-social-history-modal]', this.historyModal],
      ['[data-social-history-received]', this.historyReceived],
      ['[data-social-history-sent]', this.historySent],
      ['[data-social-history-feedback]', this.historyFeedback],
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

    this.listen(this.searchInput, 'input', () => this.applyFriendFilter());

    this.listen(this.addButton, 'click', () => this.openAddModal());
    this.listen(this.refreshButton, 'click', () =>
      void this.reload({ announce: true, force: true })
    );
    this.listen(this.updateButton, 'click', () => void this.publish());
    this.listen(this.likeAllButton, 'click', () => void this.openLikeAll());
    this.listen(this.historyButton, 'click', () => void this.openLikeHistory());
    this.historyTabs.forEach((tab) => {
      this.listen(tab, 'click', () => this.showHistoryTab(tab.dataset.socialHistoryTab));
    });
    this.historyCloseButtons.forEach((button) => {
      this.listen(button, 'click', () => this.closeLikeHistory());
    });
    this.listen(this.historyModal, 'click', (event) => {
      if (event.target === this.historyModal) this.closeLikeHistory();
    });
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

    this.listen(this.detailWishlistButton, 'click', () => this.openDetailWishlist());
    this.listen(this.detailFavorites, 'click', (event) => {
      if (!(event.target instanceof Element)) return;
      const card = event.target.closest('[data-social-favorite-card]');
      if (card) {
        this.openFavoriteCard(card.dataset.socialFavoriteCard);
        return;
      }
      const trophy = event.target.closest('[data-social-favorite-trophy]');
      if (trophy) this.openFavoriteTrophy(trophy.dataset.socialFavoriteTrophy);
    });

    // The "add as friend" buttons of the received likes are built on every history paint: one
    // delegated listener serves them all.
    this.listen(this.historyReceived, 'click', (event) => {
      const button = event.target instanceof Element
        ? event.target.closest('[data-social-history-follow]')
        : null;
      if (button) {
        void this.followFromHistory(button.dataset.socialHistoryFollow, button);
      }
    });

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
      if (!this.historyModal.hidden) {
        this.closeLikeHistory();
      } else if (!this.likeAllModal.hidden) {
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
    // A trade just completed elsewhere (the trade tab, a background refresh, another screen): the
    // friendship XP it credits must repaint the stars, including the ones of an open friend.
    this.unsubscribers.push(eventBus.on(EVENTS.TRADES_UPDATED, () => {
      if (!this.isInitialized || this.isLoading) return;
      void this.refreshFriendshipLevels();
    }));
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
      // The friendship stars read the local trade counters and the last likes: both are local or
      // heavily throttled, so painting the list never waits on the worker.
      await this.syncFriendship();
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
   * Feeds the friendship XP with the last likes, then reads the stars.
   *
   * The trades are seeded by `TradeManager.refresh`, the only place that knows both the worker
   * history (the rarity and the id of every past exchange) and the local counters, so seeding from
   * a count alone would pay those trades the flat rate instead. The like history is a worker
   * request, so it is read at most once per `FRIENDSHIP_LIKES_SYNC_MS` and silently skipped for an
   * account that was never published online.
   *
   * @returns {Promise<void>} Resolves once the stars can be painted.
   */
  async syncFriendship() {
    if (Date.now() - this.likesSyncedAt >= FRIENDSHIP_LIKES_SYNC_MS) {
      try {
        const history = await likesManager.getHistory();
        await this.recordHistoryFriendship(history);
        this.likesSyncedAt = Date.now();
      } catch (error) {
        if (error?.code !== LIKES_ERROR_CODES.NO_ACCOUNT) {
          console.warn('[SocialView] The like history could not feed the friendship XP.', error);
        }
      }
    }

    try {
      const { tiers, xp } = await friendshipManager.getOverview();
      this.friendshipTiers = tiers;
      this.friendshipXp = new Map(Object.entries(xp));
    } catch (error) {
      console.warn('[SocialView] The friendship levels could not be read.', error);
    }
  }

  /**
   * Re-reads the friendship XP and repaints the stars that are on screen.
   *
   * Used when a trade completes while the page is already displayed: waiting for the next manual
   * refresh would leave the old percentage in front of the player.
   *
   * @returns {Promise<void>} Resolves once the stars are repainted.
   */
  async refreshFriendshipLevels() {
    try {
      const { tiers, xp } = await friendshipManager.getOverview();
      this.friendshipTiers = tiers;
      this.friendshipXp = new Map(Object.entries(xp));
      if (this.following.length > 0) await this.renderList();
      if (this.openFriendUuid !== '') this.renderDetailFriendship(this.openFriendUuid);
    } catch (error) {
      console.warn('[SocialView] The friendship levels could not be refreshed.', error);
    }
  }

  /**
   * Credits the likes of one history read, in both directions.
   *
   * @param {{received?: object[], sent?: object[]}} history - Value of `likesManager.getHistory()`.
   * @returns {Promise<void>} Resolves once the XP and the local map are updated.
   */
  async recordHistoryFriendship(history) {
    try {
      await friendshipManager.recordLikes(history?.received ?? [], 'received');
      await friendshipManager.recordLikes(history?.sent ?? [], 'sent');
      this.friendshipXp = new Map(Object.entries(await friendshipManager.getXpMap()));
    } catch (error) {
      console.warn('[SocialView] The like history could not feed the friendship XP.', error);
    }
  }

  /**
   * Reads the star level of one player from the loaded thresholds.
   *
   * @param {string} uuid - Player UUID.
   * @returns {object} The object `buildFriendshipLevel()` expects.
   */
  friendshipProgress(uuid) {
    const xp = this.friendshipXp.get(uuid) ?? 0;
    return friendshipManager.describeXp(xp, this.friendshipTiers);
  }

  /**
   * Draws the friendship stars of the opened friend, under the dialog title.
   *
   * @param {string} uuid - Followed UUID.
   * @returns {void}
   */
  renderDetailFriendship(uuid) {
    if (!this.detailFriendship) return;
    this.detailFriendship.textContent = '';
    if (typeof uuid !== 'string' || uuid === '') {
      this.detailFriendship.hidden = true;
      return;
    }
    this.detailFriendship.appendChild(buildFriendshipLevel(this.friendshipProgress(uuid)));
    this.detailFriendship.hidden = false;
  }

  /**
   * Paints the friend counter: how many players are followed, over the configured limit.
   *
   * The limit comes from the level of the account (`SocialManager.getMaxFriends()`, that is
   * `social.baseMaxFriend` grown by `social.friendStepIncrease` every `social.friendStepLevelGap`
   * levels, capped by `social.maxFriends`), the same value `addFollow` enforces. It turns the
   * accent colour once the list is full, so the refusal of the next follow is announced before
   * the player tries.
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
   * Paints the followed players in follow order, then applies the current search.
   *
   * The rows are built once and kept in `friendRows`: filtering only toggles `hidden`, so a
   * keystroke never rebuilds a friend card (nor reloads its avatar) again.
   *
   * @returns {Promise<void>} Resolves once every row is built.
   */
  async renderList() {
    this.followList.textContent = '';
    const cards = this.following.map((uuid) => this.cards.get(uuid)).filter(Boolean);
    const rows = await Promise.all(cards.map((card) => this.buildFriendRow(card)));
    this.friendRows = cards.map((card, index) => ({
      row: rows[index],
      haystack: normalizeFriendQuery(card.username),
    }));
    rows.forEach((row) => this.followList.appendChild(row));
    this.applyFriendFilter();
  }

  /**
   * Hides the followed players whose pseudo does not contain the typed search.
   *
   * An empty field shows the whole Follow List. The number of matching friends is written under
   * the field, so a missing card is explained instead of looking like a lost friend.
   *
   * @returns {void}
   */
  applyFriendFilter() {
    const query = normalizeFriendQuery(this.searchInput?.value);
    let visible = 0;
    this.friendRows.forEach(({ row, haystack }) => {
      const match = query === '' || haystack.includes(query);
      row.hidden = !match;
      if (match) visible += 1;
    });

    const total = this.friendRows.length;
    if (this.searchFeedback) {
      const filtering = query !== '' && total > 0;
      this.searchFeedback.hidden = !filtering;
      this.searchFeedback.textContent = filtering
        ? i18n.t(visible === 0 ? 'social.search.none' : 'social.search.found', { visible, total })
        : '';
    }
    this.emptyElement.hidden = total > 0;
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

    identity.append(
      headline,
      title,
      buildFriendshipLevel(this.friendshipProgress(card.uuid)),
      stats,
      updated
    );

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
   * The counts of an account (likes, cards, boosters, points) are big numbers: they wear the same
   * compact label as the likes of the header and the points of the profile card (`10.2K`).
   *
   * @param {unknown} value - Raw counter.
   * @returns {string} The formatted non-negative integer.
   */
  formatNumber(value) {
    const count = Math.max(0, Math.trunc(Number(value) || 0));
    return formatCompactNumber(count, i18n.getLang());
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
   * Validates, checks and saves a followed player, typed as a pseudo or a UUID.
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
      if (isPseudoRefusal(error)) {
        // The card cannot go out under this name: the dialog asks for another pseudo and sends
        // it again itself, so the player never has to press "Update My Account" twice.
        this.setFeedback(null);
        void renamePseudoDialog.open({
          reason: error.code === SOCIAL_ERROR_CODES.USERNAME_TAKEN ? 'taken' : 'reserved',
          onConfirm: async () => {
            await socialManager.publishOwnCard();
            this.setFeedback('social.publish.success', 'info');
          },
          onCancel: () => this.setFeedback('social.publish.cancelled', 'warning'),
        });
      } else {
        this.setFeedback(getSocialErrorMessageKey(error), 'error');
      }
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

    // The title is the pseudo itself: the card under it already says what it is, so "Carte de"
    // only pushed the name the player came to read to the right of a redundant word.
    this.detailTitle.textContent = card.username || i18n.t('profile.anonymous');
    this.renderDetailFriendship(uuid);
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
        // Same 3D drag as the player's own card. The dialog scrolls on a phone, so only the
        // sideways axis belongs to the card: a vertical swipe keeps scrolling the dialog.
        attachCardTilt(this.detailCardHost);
        this.detailCardHost.style.touchAction = 'pan-y';
        this.profileCard = new ProfileCard(this.detailCardHost);
      }
      const model = await socialManager.buildRemoteCardModel(card);
      // The pinned trophies of the friend close the description exactly like the owner's own card:
      // the worker only relays their ids, so they are resolved through the local trophy catalogue.
      // A pinned trophy is unlocked by definition, which is what draws its halo.
      const featuredIds = this.favorites.get(uuid)?.trophies ?? [];
      if (featuredIds.length > 0) {
        await this.loadTrophyIndex();
        model.featuredTrophies = featuredIds
          .map((id) => this.trophyIndex.get(id))
          .filter(Boolean)
          .map((trophy) => ({ ...trophy, unlocked: true }));
      }
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
    this.detailFriendship.textContent = '';
    this.detailFriendship.hidden = true;
    this.detailFavorites.textContent = '';
    this.detailFavorites.hidden = true;
    this.detailBinder.textContent = '';
    this.detailBinder.hidden = true;
    this.detailWishlistButton.textContent = '';
    this.detailWishlistButton.hidden = true;
    this.detailWishlistEntries = [];
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
    this.detailWishlistEntries = [];
    if (!this.detailWishlistButton) return;
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

    for (const key of keys) {
      let card = null;
      try {
        card = await boosterManager.getCardByKey(key);
      } catch (error) {
        console.warn(`[SocialView] The wishlisted card \"${key}\" could not be read.`, error);
      }
      this.detailWishlistEntries.push({ key, card, quantity: quantities.get(key) ?? 0 });
    }

    this.detailWishlistButton.textContent = i18n.t('social.wishlist.open', { count: keys.length });
    this.detailWishlistButton.hidden = false;
  }

  /**
   * Opens the wishlist of the opened friend in its own dialog.
   *
   * The cards are drawn with the very tiles of the trade dialogs (`trade__card` + the wish badge of
   * `trade__card-wish`), so a wish reads the same wherever the player meets it. Each tile keeps the
   * three states of the wishlist: a card the viewer does not own at all is dimmed but still named, a
   * single copy is greyed with its count, and several copies keep the normal colour.
   *
   * Written by hand rather than `dialog.showModal()`: the game's dialogs are plain overlays closed
   * by Escape, a backdrop click and their close button, exactly like `WishlistRemovePopup`.
   *
   * @returns {void}
   */
  openDetailWishlist() {
    const entries = this.detailWishlistEntries ?? [];
    if (entries.length === 0) return;

    const overlay = document.createElement('div');
    overlay.className = 'modal wishlist-cards-popup';
    overlay.dataset.socialWishlistPopup = '';

    const dialog = document.createElement('div');
    dialog.className = 'modal__dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'social-wishlist-popup-title');

    const title = document.createElement('h2');
    title.className = 'modal__title';
    title.id = 'social-wishlist-popup-title';
    title.textContent = i18n.t('social.wishlist.title');

    const grid = document.createElement('ul');
    grid.className = 'wishlist-cards-popup__grid';
    entries.forEach(({ key, card, quantity }) => {
      const name = card ? card.getName(cardLanguage.getLang()) : key;
      const item = document.createElement('li');
      item.className = 'wishlist-cards-popup__item';
      // `missing`: not owned at all, `single`: owned once, `many`: at least one copy is tradable.
      item.dataset.state = quantity === 0 ? 'missing' : quantity === 1 ? 'single' : 'many';
      if (card) item.dataset.rarity = String(card.rarity);
      item.title = name;

      const tile = document.createElement('div');
      tile.className = 'trade__card';
      if (card) {
        tile.appendChild(createCardVisual(card, {
          className: 'trade__card-image',
          alt: name,
          loading: 'lazy',
          decoding: 'async',
        }));
      } else {
        const fallback = document.createElement('img');
        fallback.className = 'trade__card-image is-missing';
        fallback.src = i18n.resolveImagePath('assets/img/card_back.png');
        fallback.alt = key;
        fallback.loading = 'lazy';
        fallback.decoding = 'async';
        tile.appendChild(fallback);
      }

      const body = document.createElement('span');
      body.className = 'trade__card-body';
      const label = document.createElement('strong');
      label.className = 'trade__card-name';
      label.textContent = name;
      const detail = document.createElement('span');
      detail.className = 'trade__card-detail';
      detail.textContent =
        quantity > 0
          ? i18n.t('social.wishlist.owned', { count: quantity })
          : i18n.t('social.wishlist.none');
      body.append(label, detail);
      tile.appendChild(body);

      const badge = document.createElement('span');
      badge.className = 'trade__card-wish';
      badge.textContent = i18n.t('trade.wishlist.badge');

      item.append(tile, badge);
      grid.appendChild(item);
    });

    const actions = document.createElement('div');
    actions.className = 'modal__actions';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn btn--primary';
    close.dataset.socialWishlistClose = '';
    close.textContent = i18n.t('social.detail.close');
    actions.appendChild(close);

    dialog.append(title, grid, actions);
    overlay.appendChild(dialog);

    let closed = false;
    const dismiss = () => {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
    };
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        dismiss();
      }
    };

    close.addEventListener('click', dismiss);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) dismiss();
    });
    document.addEventListener('keydown', onKey, true);

    document.body.appendChild(overlay);
    close.focus();
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
    this.favoriteCards = new Map();

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
      this.favoriteCards.set(key, card);

      // Every tile is a button: the info of the card opens in the same dialog as the collection.
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'social__favorite-button';
      button.dataset.socialFavoriteCard = key;
      button.setAttribute('aria-label', name);
      if (card) {
        item.dataset.rarity = String(card.rarity);
        button.appendChild(createCardVisual(card, {
          className: 'social__favorite-image',
          alt: name,
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
        button.appendChild(fallback);
      }
      item.appendChild(button);
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
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'social__favorite-button';
      button.dataset.socialFavoriteTrophy = id;
      button.setAttribute('aria-label', label);
      // A featured trophy is unlocked by definition (the owner could only pin it): the medal is
      // drawn as such even when this player has not earned it yet.
      button.appendChild(TrophyDetail.buildMedal(
        trophy ?? { icon: DEFAULT_TROPHY_ICON, rarity: '', unlocked: true },
        'social__favorite-medal'
      ));
      item.appendChild(button);
      list.appendChild(item);
    });

    section.appendChild(list);
    return section;
  }

  /**
   * Opens the detail of a favourite card in the shared card dialog.
   *
   * The friend only relayed a collection key: the card itself is read from the local catalogue,
   * exactly like the collection page, so the rarity, the set and the illustration are the ones
   * every other screen shows.
   *
   * @param {string} key - Collection key.
   * @returns {void}
   */
  openFavoriteCard(key) {
    const card = this.favoriteCards?.get(key) ?? null;
    if (!card) {
      console.warn(`[SocialView] The favourite card "${key}" is not in the local catalogue.`);
      return;
    }
    void cardDetailPopup.open(card);
  }

  /**
   * Opens the sheet of a favourite trophy: what it takes to earn it, and where this player stands.
   *
   * The friend could only pin a trophy they earned, so their side is settled; ours is read from the
   * local catalogue, with the description of the requirement, our progress bar and a comparison of
   * the two accounts.
   *
   * @param {string} id - Trophy id.
   * @returns {void}
   */
  openFavoriteTrophy(id) {
    const trophy = this.trophyIndex?.get(id) ?? null;
    if (!trophy) {
      console.warn(`[SocialView] The favourite trophy "${id}" is not in the local catalogue.`);
      return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal';
    overlay.dataset.socialTrophyDetail = '';

    const dialog = document.createElement('div');
    dialog.className = 'modal__dialog modal__dialog--wide';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'social-trophy-detail-title');

    const title = document.createElement('h2');
    title.className = 'modal__title';
    title.id = 'social-trophy-detail-title';
    title.textContent = TrophyDetail.trophyTitle(trophy);

    const body = document.createElement('div');
    body.className = 'modal__body';
    const friendName = this.cards.get(this.openFriendUuid)?.username || i18n.t('profile.anonymous');
    const owner = document.createElement('p');
    owner.className = 'social__compare-owner';
    owner.textContent = i18n.t('social.favorite.trophy.owner', { name: friendName });
    body.appendChild(owner);
    body.appendChild(TrophyDetail.buildDetailBody(trophy));

    const comparison = document.createElement('section');
    comparison.className = 'social__compare-block';
    const heading = document.createElement('h3');
    heading.className = 'social__favorites-title';
    heading.textContent = i18n.t('social.favorite.trophy.compare');
    comparison.appendChild(heading);
    const rows = document.createElement('dl');
    rows.className = 'card-modal__details';
    rows.appendChild(TrophyDetail.buildDetailRow(
      i18n.t('social.favorite.trophy.friend'),
      i18n.t('trophy.unlocked')
    ));
    rows.appendChild(TrophyDetail.buildDetailRow(
      i18n.t('social.favorite.trophy.you'),
      trophy.unlocked
        ? i18n.t('trophy.unlocked')
        : i18n.t('social.favorite.trophy.progress', {
          percent: Math.round((trophy.progress ?? 0) * 100),
        })
    ));
    comparison.appendChild(rows);
    body.appendChild(comparison);

    const actions = document.createElement('div');
    actions.className = 'modal__actions';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn btn--primary';
    close.dataset.socialTrophyClose = '';
    close.textContent = i18n.t('social.detail.close');
    actions.appendChild(close);

    dialog.append(title, body, actions);
    overlay.appendChild(dialog);

    let closed = false;
    const dismiss = () => {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
    };
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        dismiss();
      }
    };

    close.addEventListener('click', dismiss);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) dismiss();
    });
    document.addEventListener('keydown', onKey, true);

    document.body.appendChild(overlay);
    close.focus();
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
      this.friendshipXp = new Map(Object.entries(await friendshipManager.getXpMap()));
      const name = this.cards.get(uuid)?.username || i18n.t('profile.anonymous');
      this.setFeedback('social.like.success', 'info', { name });
      this.renderDetailFriendship(uuid);
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
      this.friendshipXp = new Map(Object.entries(await friendshipManager.getXpMap()));
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
   * Opens the like history: the ten last likes received and the ten last likes sent.
   *
   * The history comes from `like_daily_target`, read by the worker in one authenticated request.
   * A liker this account does not follow yet carries a button of its own: following is a decision,
   * never a side effect of opening the dialog.
   *
   * @returns {Promise<void>} Resolves once the dialog is drawn (or its error is shown).
   */
  async openLikeHistory() {
    if (this.isHistoryLoading) return;
    this.isHistoryLoading = true;
    this.historyModal.hidden = false;
    this.setHistoryFeedback(null);
    this.renderHistoryPlaceholder();

    try {
      this.likeHistory = await likesManager.getHistory();
      await this.recordHistoryFriendship(this.likeHistory);
      this.renderHistory();
    } catch (error) {
      console.warn('[SocialView] The like history could not be loaded.', error);
      this.likeHistory = { received: [], sent: [] };
      this.renderHistory();
      this.setHistoryFeedback(
        error?.code === LIKES_ERROR_CODES.NO_ACCOUNT
          ? 'social.history.noAccount'
          : 'social.history.error',
        'error'
      );
    } finally {
      this.isHistoryLoading = false;
    }
  }

  /**
   * Follows the liker whose button was clicked, then repaints the history in place.
   *
   * The player stays free to ignore a liker: nothing here runs on its own. A refusal (a full Follow
   * List, a vanished card) only reports itself in the dialog.
   *
   * @param {string} uuid - UUID of the liker.
   * @param {HTMLButtonElement} button - Button that was clicked (disabled while the call runs).
   * @returns {Promise<void>} Resolves once the row is repainted (or the refusal shown).
   */
  async followFromHistory(uuid, button) {
    if (uuid === '' || this.isBusy) return;
    this.isBusy = true;
    button.disabled = true;
    const name = this.likeHistory.received
      .find((entry) => entry.uuid === uuid)?.username
      || i18n.t('profile.anonymous');
    try {
      await socialManager.addFollow(uuid);
      this.following = await socialManager.getFollowing();
      await this.renderCount();
      this.renderHistory();
      this.setHistoryFeedback('social.history.followed', 'info', { name });
      // The Follow List showed the friend without their card: a full reload paints it below the
      // dialog, exactly like a follow added from the toolbar.
      void this.reload();
    } catch (error) {
      console.warn('[SocialView] The liker could not be followed.', error);
      this.setHistoryFeedback(getSocialErrorMessageKey(error), 'error');
      button.disabled = false;
    } finally {
      this.isBusy = false;
    }
  }

  /**
   * Shows one side of the like history.
   *
   * Both lists are painted on every read, so switching tabs is instant and never re-asks the
   * worker: only the visibility of the panels changes.
   *
   * @param {string} name - `data-social-history-tab` value (`received` or `sent`).
   * @returns {void}
   */
  showHistoryTab(name) {
    if (typeof name !== 'string') return;
    this.historyTabs.forEach((tab) => {
      const active = tab.dataset.socialHistoryTab === name;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    this.historyPanels.forEach((panel) => {
      panel.hidden = panel.dataset.socialHistoryPanel !== name;
    });
  }

  /**
   * Paints both sides of the last 25 likes from the last response.
   *
   * Only the received side offers to add a liker: a heart received from a stranger must never
   * become a friend without a click.
   *
   * @returns {void}
   */
  renderHistory() {
    this.renderHistoryList(
      this.historyReceived,
      this.likeHistory.received,
      'social.history.received.empty',
      { offerFollow: true }
    );
    this.renderHistoryList(this.historySent, this.likeHistory.sent, 'social.history.sent.empty');
  }

  /**
   * Closes the like history dialog.
   *
   * @returns {void}
   */
  closeLikeHistory() {
    if (!this.historyModal || this.historyModal.hidden) return;
    this.historyModal.hidden = true;
    this.setHistoryFeedback(null);
  }

  /**
   * Paints a loading row on both sides of the history.
   *
   * @returns {void}
   */
  renderHistoryPlaceholder() {
    [this.historyReceived, this.historySent].forEach((host) => {
      if (!host) return;
      host.textContent = '';
      const item = document.createElement('li');
      item.className = 'social__history-empty';
      item.textContent = i18n.t('social.history.loading');
      host.appendChild(item);
    });
  }

  /**
   * Paints one side of the history.
   *
   * @param {HTMLElement|null} host - List to fill.
   * @param {object[]} entries - Normalized entries.
   * @param {string} emptyKey - Translation key shown when there is nothing to list.
   * @param {object} [options] - Row options.
   * @param {boolean} [options.offerFollow=false] - Offers to add the likers that are not friends.
   * @returns {void}
   */
  renderHistoryList(host, entries, emptyKey, { offerFollow = false } = {}) {
    if (!host) return;
    host.textContent = '';
    if (entries.length === 0) {
      const item = document.createElement('li');
      item.className = 'social__history-empty';
      item.textContent = i18n.t(emptyKey);
      host.appendChild(item);
      return;
    }
    entries.forEach((entry) => host.appendChild(this.buildHistoryRow(entry, { offerFollow })));
  }

  /**
   * Builds one row of the history: the avatar of the other player, their name, the moment of the
   * like, and, when they are not a friend, either an "add as friend" button or a badge.
   *
   * @param {{uuid: string, username: string, profilePicture: string, rarity: number, day: string,
   *   likedAt: string}} entry - Normalized entry.
   * @param {object} [options] - Row options.
   * @param {boolean} [options.offerFollow=false] - Draws the button instead of the badge.
   * @returns {HTMLLIElement} The row.
   */
  buildHistoryRow(entry, { offerFollow = false } = {}) {
    const item = document.createElement('li');
    item.className = 'social__history-item';
    item.dataset.rarity = String(entry.rarity);

    const avatar = document.createElement('span');
    avatar.className = 'social__history-avatar';
    avatar.dataset.rarity = String(entry.rarity);
    const path = safeSocialAssetPath(entry.profilePicture);
    if (path !== '') {
      const image = document.createElement('img');
      image.className = 'social__history-avatar-image';
      image.src = i18n.resolveImagePath(path);
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.addEventListener('error', () => image.remove());
      avatar.appendChild(image);
    } else {
      const fallback = document.createElement('span');
      fallback.textContent = (entry.username || '?').slice(0, 1).toUpperCase();
      avatar.appendChild(fallback);
    }

    const identity = document.createElement('span');
    identity.className = 'social__history-identity';
    const name = document.createElement('span');
    name.className = 'social__history-name';
    name.textContent = entry.username || i18n.t('profile.anonymous');
    const date = document.createElement('span');
    date.className = 'social__history-date';
    date.textContent = this.formatDateTime(entry.likedAt) || this.formatDate(entry.day);
    identity.append(name, date);

    item.append(avatar, identity);
    if (!this.following.includes(entry.uuid)) {
      if (offerFollow && entry.username !== '') {
        const follow = document.createElement('button');
        follow.type = 'button';
        follow.className = 'btn btn--ghost social__history-follow';
        follow.dataset.socialHistoryFollow = entry.uuid;
        follow.textContent = i18n.t('social.history.addFriend');
        follow.setAttribute('aria-label', i18n.t('social.history.addFriendNamed', { name: entry.username }));
        item.appendChild(follow);
      } else {
        const badge = document.createElement('span');
        badge.className = 'social__history-badge';
        badge.textContent = i18n.t('social.history.notFriend');
        item.appendChild(badge);
      }
    }
    return item;
  }

  /**
   * Formats the worker timestamp of a like, with its time.
   *
   * @param {unknown} value - Raw `liked_at` (`YYYY-MM-DD HH:MM:SS`, UTC).
   * @returns {string} A localized date and time, or an empty string.
   */
  formatDateTime(value) {
    if (typeof value !== 'string' || value === '') return '';
    const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
      ? `${value.replace(' ', 'T')}Z`
      : value;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(i18n.getLang(), {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(date);
  }

  /**
   * Displays a feedback line inside the like history dialog.
   *
   * @param {string|null} key - Translation key, or null to clear.
   * @param {'info'|'warning'|'error'} [tone='info'] - Visual tone.
   * @param {object|null} [params=null] - Interpolation values.
   * @returns {void}
   */
  setHistoryFeedback(key, tone = 'info', params = null) {
    if (!this.historyFeedback) return;
    if (!key) {
      this.historyFeedback.hidden = true;
      this.historyFeedback.textContent = '';
      this.historyFeedback.removeAttribute('data-tone');
      return;
    }
    this.historyFeedback.hidden = false;
    this.historyFeedback.textContent = i18n.t(key, params);
    this.historyFeedback.dataset.tone = tone;
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

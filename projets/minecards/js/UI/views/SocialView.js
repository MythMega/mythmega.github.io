/**
 * SocialView - Follow List of published trainer cards.
 *
 * The view only orchestrates the DOM: `SocialManager` owns the worker calls and the local state,
 * `ProfileCard` redraws a followed card with the exact component of the profile page.
 */

import i18n from '../../utils/I18n.js';
import eventBus, { EVENTS } from '../../utils/EventBus.js';
import socialManager, {
  getSocialErrorMessageKey,
  safeSocialAssetPath,
} from '../../business/SocialManager.js';
import titleManager, { TitleManager } from '../../business/TitleManager.js';
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
    this.detailCloseButtons = this.root.querySelectorAll('[data-social-detail-close]');

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
    this.listen(this.detailModal, 'click', (event) => {
      if (event.target === this.detailModal) this.closeFriend();
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
      if (!this.unfollowModal.hidden) {
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
      const { following, cards } = await socialManager.refreshFollowing({ force });
      this.following = following;
      this.cards = new Map(cards.map((card) => [card.uuid, card]));
      await this.renderList();
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
    this.detailModal.hidden = true;
    this.openFriendUuid = '';
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

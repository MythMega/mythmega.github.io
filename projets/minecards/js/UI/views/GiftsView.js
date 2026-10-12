/**
 * GiftsView - History of the distributions received.
 *
 * Reference: `.docs/steps/8.md` point 3 and `.docs/main.md` section 3.G (view 5).
 *
 * The list is read from the `gifts_received` store and sorted by `receivedAt` (newest first). A
 * record only stores the raw key, so the readable name of the extension or of the card is resolved
 * by `GiftManager.describeGift()`, which keeps the catalog logic in the business layer and this
 * view free of JSON knowledge.
 *
 * Step 9: the store holds two categories. `distribution` records come from the Google Sheet (the
 * line number is shown), `codes` records come from a redeemed promo code (the code itself is never
 * stored, only the reward). A record without a `category` (older saves) is read as `distribution`.
 * The view offers a Tous / Distributions / Codes filter and a category badge per row.
 *
 * The view refreshes when it becomes active (the check itself is triggered from the settings
 * screen) and whenever a record changes through the shared `GIFTS_UPDATED` event.
 */

import eventBus, { EVENTS } from '../../utils/EventBus.js';
import i18n from '../../utils/I18n.js';
import { storageRepository, STORES } from '../../models/StorageRepository.js';
import { USER_STATE_KEYS } from '../../business/AccountManager.js';
import { giftManager, GIFT_TYPES, GIFT_CATEGORIES } from '../../business/GiftManager.js';
import { getRarityLabel } from '../../classes/Card.js';

/**
 * Identity of the panel. It is NOT a router view anymore: the gift history lives inside the
 * settings screen (`data-panel="gifts"`), and the application passes `viewName: 'settings'` so the
 * panel activates with that view.
 */
export const GIFTS_VIEW_NAME = 'gifts';

export class GiftsView {
  /**
   * @param {HTMLElement} rootElement - The gifts panel inside the settings screen.
   * @param {object} [options] - View options.
   * @param {(viewName: string) => void} [options.onNavigate=null] - Called when the empty state
   *   asks the application to open another view (the settings screen, where the check lives).
   * @param {string} [options.viewName=GIFTS_VIEW_NAME] - Name of the ROUTER view this panel belongs
   *   to. The panel is embedded in the settings screen, so the application passes `"settings"`:
   *   the panel then activates and reloads with that view instead of waiting for a `"gifts"` view
   *   that no longer exists in the bottom bar.
   */
  constructor(rootElement, { onNavigate = null, viewName = GIFTS_VIEW_NAME } = {}) {
    if (!rootElement || typeof rootElement.querySelector !== 'function') {
      throw new TypeError('GiftsView requires the gifts section element.');
    }

    this.root = rootElement;
    this.onNavigate = typeof onNavigate === 'function' ? onNavigate : null;
    this.viewName = typeof viewName === 'string' && viewName !== '' ? viewName : GIFTS_VIEW_NAME;
    this.feedbackElement = this.root.querySelector('[data-gifts-feedback]');
    this.lastCheckElement = this.root.querySelector('[data-gifts-last-check]');
    this.countElement = this.root.querySelector('[data-gifts-count]');
    this.listElement = this.root.querySelector('[data-gifts-list]');
    this.emptyElement = this.root.querySelector('[data-gifts-empty]');
    this.emptyAction = this.root.querySelector('[data-gifts-empty-action]');
    this.filtersElement = this.root.querySelector('[data-gifts-filters]');
    this.filterButtons = Array.from(this.root.querySelectorAll('[data-gifts-filter]'));

    this.assertMarkup();

    /** @type {boolean} True once `init()` bound everything. */
    this.isInitialized = false;
    /** @type {boolean} True when the view is the active one. */
    this.isActive = false;
    /** @type {boolean} True while the list is loading. */
    this.isLoading = false;
    /** @type {Array<object>} Last loaded records, re-rendered on a language change. */
    this.gifts = [];
    /** @type {'all'|'distribution'|'codes'} Active category filter. */
    this.categoryFilter = 'all';
    /** @type {{lastCheckedLine: number, lastCheckAt: string|null}|null} Last read sync state. */
    this.giftSync = null;

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
    console.info('[GiftsView]', ...args);
  }

  /**
   * Verifies that the markup matches the contract expected by this view.
   *
   * @returns {void}
   * @throws {Error} When a required element is missing from `index.html`.
   */
  assertMarkup() {
    const missing = [
      ['[data-gifts-feedback]', this.feedbackElement],
      ['[data-gifts-last-check]', this.lastCheckElement],
      ['[data-gifts-count]', this.countElement],
      ['[data-gifts-list]', this.listElement],
      ['[data-gifts-empty]', this.emptyElement],
      ['[data-gifts-empty-action]', this.emptyAction],
      ['[data-gifts-filters]', this.filtersElement],
    ]
      .filter(([, element]) => !element)
      .map(([selector]) => selector);

    if (missing.length > 0) {
      throw new Error(`GiftsView markup is incomplete, missing: ${missing.join(', ')}.`);
    }
  }

  /**
   * Binds the interactions and loads the first render.
   *
   * @returns {Promise<void>} Resolves once the history is rendered (or the error shown).
   */
  async init() {
    if (this.isInitialized) return;
    this.isInitialized = true;
    this.log('Initializing…');
    this.bindEvents();
    this.subscribeToEvents();
    await this.reload();
    this.log('Ready.');
  }

  /**
   * Attaches the DOM listeners (registration is tracked for `destroy()`).
   *
   * @returns {void}
   */
  bindEvents() {
    this.listen(this.emptyAction, 'click', () => this.handleEmptyAction());
    this.filterButtons.forEach((button) => {
      this.listen(button, 'click', () => this.handleFilter(button.dataset.giftsFilter));
    });
    this.log('DOM listeners bound.');
  }

  /**
   * Registers a listener and remembers it so `destroy()` can remove it.
   *
   * @param {EventTarget} target - Target element.
   * @param {string} type - Event type.
   * @param {EventListener} handler - Listener.
   * @returns {void}
   */
  listen(target, type, handler) {
    target.addEventListener(type, handler);
    this.bindings.push({ target, type, handler });
  }

  /**
   * Subscribes to the application events the view depends on.
   *
   * @returns {void}
   */
  subscribeToEvents() {
    this.unsubscribers.push(eventBus.on(EVENTS.VIEW_CHANGED, (payload) => {
      if (!payload || typeof payload.view !== 'string') return;
      if (payload.view === this.viewName) {
        this.handleViewActivated();
      } else if (payload.previousView === this.viewName) {
        this.handleViewDeactivated();
      }
    }));
    this.unsubscribers.push(eventBus.on(EVENTS.LANG_CHANGED, () => this.handleLanguageChanged()));
    this.unsubscribers.push(eventBus.on(EVENTS.GIFTS_UPDATED, () => this.handleGiftsUpdated()));
    this.log('Event subscriptions registered.');
  }

  /**
   * Reads `gifts_received` and `giftSync`, then renders the history.
   *
   * @returns {Promise<void>} Resolves once the list is rendered (or the error shown).
   */
  async reload() {
    if (this.isLoading) return;
    this.isLoading = true;
    this.setFeedback(null);
    this.log('Loading the gift history…');

    try {
      const records = await storageRepository.getAll(STORES.GIFTS_RECEIVED);
      // A record without a `category` predates step 9 (or is a distribution): it is normalized here
      // so the rest of the view never has to guess.
      this.gifts = records.map((gift) => ({
        ...gift,
        category: gift.category === GIFT_CATEGORIES.CODES ? GIFT_CATEGORIES.CODES : GIFT_CATEGORIES.DISTRIBUTION,
      }));
      this.giftSync = giftManager.normalizeGiftSync(
        await storageRepository.getUserState(USER_STATE_KEYS.GIFT_SYNC)
      );
      this.renderLastCheck();
      this.renderFilters();
      await this.renderList();
    } catch (error) {
      console.error('[GiftsView] The gift history could not be loaded.', error);
      this.setFeedback('gifts.error.load', 'error');
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Displays the timestamp of the last check.
   *
   * @returns {void}
   */
  renderLastCheck() {
    const lastCheckAt = this.giftSync?.lastCheckAt ?? null;
    this.lastCheckElement.textContent = lastCheckAt
      ? i18n.t('gifts.lastCheck', { date: this.formatDate(lastCheckAt) })
      : i18n.t('gifts.neverChecked');
  }

  /**
   * Renders the category filter buttons and their active state.
   *
   * @returns {void}
   */
  renderFilters() {
    this.filterButtons.forEach((button) => {
      const value = button.dataset.giftsFilter;
      const isActive = value === this.categoryFilter;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      button.textContent = i18n.t(`gifts.filter.${value === 'distribution' || value === 'codes' ? value : 'all'}`);
    });
  }

  /**
   * Changes the active category filter.
   *
   * @param {string} value - Requested filter ("all", "distribution" or "codes").
   * @returns {void}
   */
  handleFilter(value) {
    const allowed = ['all', GIFT_CATEGORIES.DISTRIBUTION, GIFT_CATEGORIES.CODES];
    const next = allowed.includes(value) ? value : 'all';
    if (next === this.categoryFilter) return;
    this.categoryFilter = next;
    this.renderFilters();
    void this.renderList().catch((error) => {
      console.error('[GiftsView] The history could not be re-rendered.', error);
    });
  }

  /**
   * Renders the history, newest first and filtered by category.
   *
   * @returns {Promise<void>} Resolves once the list is in the DOM.
   */
  async renderList() {
    const filtered = this.categoryFilter === 'all'
      ? this.gifts
      : this.gifts.filter((gift) => gift.category === this.categoryFilter);

    // Primary sort is the trusted timestamp; the line number is only a deterministic tie-breaker
    // (a `codes` record has a string key, so a numeric comparison is meaningless there).
    const sorted = [...filtered].sort((left, right) => {
      const rightTime = Date.parse(right.receivedAt);
      const leftTime = Date.parse(left.receivedAt);
      if (!Number.isNaN(rightTime) && !Number.isNaN(leftTime) && rightTime !== leftTime) {
        return rightTime - leftTime;
      }
      return String(right.line).localeCompare(String(left.line), undefined, { numeric: true });
    });

    this.listElement.textContent = '';
    this.emptyElement.hidden = sorted.length > 0;
    this.countElement.textContent = sorted.length > 0 ? i18n.t('gifts.count', { count: sorted.length }) : '';
    this.countElement.hidden = sorted.length === 0;

    for (const gift of sorted) {
      this.listElement.appendChild(await this.buildItem(gift));
    }
  }

  /**
   * Builds one history row.
   *
   * @param {object} gift - Record read from `gifts_received`.
   * @returns {Promise<HTMLElement>} The row element.
   */
  async buildItem(gift) {
    const info = await giftManager.describeGift(gift);
    const isCard = info.type === GIFT_TYPES.CARD;
    const isSparks = info.type === GIFT_TYPES.SPARKS;

    const item = document.createElement('li');
    item.className = 'gifts__item';
    item.dataset.type = info.type || 'unknown';
    item.dataset.category = gift.category;

    if (isCard && info.card) {
      const image = document.createElement('img');
      image.className = 'gifts__image';
      image.loading = 'lazy';
      image.src = i18n.resolveImagePath(info.card.illustration);
      image.alt = info.card.getName(i18n.getLang());
      image.addEventListener('error', () => {
        console.warn(`[GiftsView] Illustration not found for "${gift.key}": ${image.src}`);
        image.hidden = true;
      });
      item.appendChild(image);
    }

    const body = document.createElement('div');
    body.className = 'gifts__body';

    const head = document.createElement('div');
    head.className = 'gifts__head';

    const title = document.createElement('p');
    title.className = 'gifts__title';
    title.textContent = isCard
      ? i18n.t('gifts.item.card', {
          name: info.card ? info.card.getName(i18n.getLang()) : i18n.t('gifts.item.unknown', { key: gift.key }),
          rarity: info.card ? getRarityLabel(info.card.rarity, (key) => i18n.t(key)) : '',
        })
      : isSparks
        ? i18n.t('gifts.item.sparks', { count: gift.quantity })
        : i18n.t('gifts.item.booster', {
            set: info.setName ?? i18n.t('gifts.item.unknown', { key: gift.key }),
          });
    head.appendChild(title);

    const badge = document.createElement('span');
    badge.className = 'gifts__badge';
    badge.textContent = i18n.t(`gifts.category.${gift.category}`);
    head.appendChild(badge);
    body.appendChild(head);

    // The line number only identifies a sheet row: a promo code has none, so it is hidden.
    const metaParts = [];
    if (gift.category === GIFT_CATEGORIES.DISTRIBUTION) {
      metaParts.push(i18n.t('gifts.line', { line: gift.line }));
    }
    metaParts.push(this.formatDate(gift.receivedAt));
    metaParts.push(i18n.t('gifts.quantity', { count: gift.quantity }));

    const meta = document.createElement('p');
    meta.className = 'gifts__meta';
    meta.textContent = metaParts.join(' · ');
    body.appendChild(meta);

    if (info.unknown) {
      const warning = document.createElement('p');
      warning.className = 'gifts__warning';
      warning.textContent = i18n.t('gifts.item.unknown', { key: gift.key });
      body.appendChild(warning);
    }

    item.appendChild(body);
    return item;
  }

  /**
   * Formats an ISO timestamp for the current locale (date and time).
   *
   * @param {string} value - ISO timestamp stored in `gifts_received`.
   * @returns {string} The localized date, or the raw value when unparseable.
   */
  formatDate(value) {
    const time = Date.parse(value);
    if (Number.isNaN(time)) return String(value);
    try {
      return new Intl.DateTimeFormat(i18n.getLang(), {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(new Date(time));
    } catch (error) {
      console.warn(`[GiftsView] Date formatting failed for "${value}".`, error);
      return String(value);
    }
  }

  /**
   * Opens the settings screen, where the distributions are checked.
   *
   * @returns {void}
   */
  handleEmptyAction() {
    if (!this.onNavigate) {
      console.warn('[GiftsView] No navigation callback was provided.');
      return;
    }
    this.onNavigate('settings');
  }

  /**
   * Displays a translated feedback message.
   *
   * @param {string|null} key - i18n key, or null to hide the message.
   * @param {'info'|'error'} [tone='info'] - Visual tone.
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
    if (tone === 'error') {
      console.warn(`[GiftsView] ${i18n.t(key)}`);
    }
  }

  /**
   * Re-renders the list when the language changes.
   *
   * @returns {void}
   */
  handleLanguageChanged() {
    this.log(`Language changed, re-rendering (${i18n.getLang()}).`);
    // The date is localized too, so the "last check" line is re-rendered with the list.
    this.renderLastCheck();
    this.renderFilters();
    void this.renderList().catch((error) => {
      console.error('[GiftsView] The history could not be re-rendered.', error);
    });
  }

  /**
   * Reloads the history after a distribution check credited something.
   *
   * @returns {void}
   */
  handleGiftsUpdated() {
    if (!this.isInitialized) return;
    this.log('Gifts updated: reloading the history.');
    void this.reload();
  }

  /**
   * Reloads the history when the view becomes active.
   *
   * @returns {void}
   */
  handleViewActivated() {
    this.isActive = true;
    this.log('View activated.');
    if (this.isInitialized && !this.isLoading) {
      void this.reload();
    }
  }

  /**
   * Marks the view as inactive.
   *
   * @returns {void}
   */
  handleViewDeactivated() {
    this.isActive = false;
    this.log('View deactivated.');
  }

  /**
   * Removes every listener and subscription.
   *
   * @returns {void}
   */
  destroy() {
    this.log('Destroying the view.');
    this.bindings.forEach(({ target, type, handler }) => target.removeEventListener(type, handler));
    this.bindings = [];
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers = [];
    this.isInitialized = false;
  }
}

export default GiftsView;

/**
 * StatsView - Booster count, completion, rarity distribution and most drawn card.
 *
 * Reference: `.docs/steps/5.md` point 3. Reads `user_state["stats"]` and the collection
 * (via `CollectionManager`). Only booster draws feed these counters: redeem/gift cards
 * (steps 7 and 8) never touch `stats`. Refreshes on `VIEW_CHANGED`, `LANG_CHANGED` and
 * `BOOSTER_OPENED`.
 */

import eventBus, { EVENTS } from '../../utils/EventBus.js';
import i18n from '../../utils/I18n.js';
import collectionManager from '../../business/CollectionManager.js';
import { storageRepository, STORES } from '../../models/StorageRepository.js';
import { USER_STATE_KEYS } from '../../business/AccountManager.js';
import { CARD_RARITY, getRarityLabel } from '../../classes/Card.js';

/** View name, matching `data-view="stats"` in `index.html`. */
export const STATS_VIEW_NAME = 'stats';

export class StatsView {
  /**
   * @param {HTMLElement} rootElement - The stats `<section>`.
   */
  constructor(rootElement) {
    if (!rootElement || typeof rootElement.querySelector !== 'function') {
      throw new TypeError('StatsView requires the stats section element.');
    }

    this.root = rootElement;
    this.feedbackElement = this.root.querySelector('[data-stats-feedback]');
    this.boostersElement = this.root.querySelector('[data-stats-boosters]');
    this.completionGlobalElement = this.root.querySelector('[data-stats-completion-global]');
    this.completionSetsElement = this.root.querySelector('[data-stats-completion-sets]');
    this.rarityElement = this.root.querySelector('[data-stats-rarity]');
    this.topElement = this.root.querySelector('[data-stats-top]');

    this.assertMarkup();

    /** @type {boolean} True once `init()` bound everything. */
    this.isInitialized = false;
    /** @type {boolean} True when the view is the active one. */
    this.isActive = false;
    /** @type {boolean} True while the view is loading its data. */
    this.isLoading = false;

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
    console.info('[StatsView]', ...args);
  }

  /**
   * Verifies that the markup matches the contract expected by this view.
   *
   * @returns {void}
   * @throws {Error} When a required element is missing from `index.html`.
   */
  assertMarkup() {
    const missing = [
      ['[data-stats-boosters]', this.boostersElement],
      ['[data-stats-completion-global]', this.completionGlobalElement],
      ['[data-stats-completion-sets]', this.completionSetsElement],
      ['[data-stats-rarity]', this.rarityElement],
      ['[data-stats-top]', this.topElement],
    ]
      .filter(([, element]) => !element)
      .map(([selector]) => selector);

    if (missing.length > 0) {
      throw new Error(`StatsView markup is incomplete, missing: ${missing.join(', ')}.`);
    }
  }

  /**
   * Subscribes to the events and loads the first render.
   *
   * @returns {Promise<void>} Resolves once the first render finished.
   */
  async init() {
    if (this.isInitialized) return;
    this.isInitialized = true;
    this.log('Initializing…');
    this.subscribeToEvents();
    await this.reload();
    this.log('Ready.');
  }

  /**
   * Subscribes to the application events the view depends on.
   *
   * @returns {void}
   */
  subscribeToEvents() {
    this.unsubscribers.push(eventBus.on(EVENTS.VIEW_CHANGED, (payload) => {
      if (!payload || typeof payload.view !== 'string') return;
      if (payload.view === STATS_VIEW_NAME) {
        this.handleViewActivated();
      } else if (payload.previousView === STATS_VIEW_NAME) {
        this.handleViewDeactivated();
      }
    }));
    this.unsubscribers.push(eventBus.on(EVENTS.LANG_CHANGED, () => this.handleLanguageChanged()));
    this.unsubscribers.push(eventBus.on(EVENTS.BOOSTER_OPENED, () => this.handleBoosterOpened()));
    this.log('Event subscriptions registered.');
  }

  /**
   * Reloads the stats and the completion, then re-renders every panel.
   *
   * @returns {Promise<void>} Resolves once the view is rendered (or the error shown).
   */
  async reload() {
    if (this.isLoading) return;
    this.isLoading = true;
    this.setFeedback(null);
    this.log('Loading the statistics…');
    try {
      const stats = (await storageRepository.getItem(STORES.USER_STATE, USER_STATE_KEYS.STATS)) ?? {};
      const view = await collectionManager.getCollectionView();
      this.renderBoosters(stats);
      this.renderCompletion(view);
      this.renderRarity(stats);
      this.renderTop(stats, view);
    } catch (error) {
      console.error('[StatsView] The statistics could not be loaded.', error);
      this.setFeedback('stats.error.load', 'error');
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Renders the booster counter.
   *
   * @param {object} stats - Raw `user_state["stats"]` value.
   * @returns {void}
   */
  renderBoosters(stats) {
    const count = Number.isFinite(stats?.boostersOpened) ? stats.boostersOpened : 0;
    this.boostersElement.textContent = String(Math.max(0, count));
  }

  /**
   * Renders the global completion line and one native bar per extension.
   *
   * @param {{completion: object, sets: object}} view - Collection view from the manager.
   * @returns {void}
   */
  renderCompletion(view) {
    const total = view?.completion?.total ?? 0;
    const owned = view?.completion?.owned ?? 0;
    if (total === 0) {
      this.completionGlobalElement.textContent = i18n.t('stats.completion.empty');
    } else {
      const percent = Math.round((owned / total) * 100);
      this.completionGlobalElement.textContent = i18n.t('stats.completion.global', { owned, total, percent });
    }

    this.completionSetsElement.textContent = '';
    Object.values(view?.sets ?? {})
      .sort((left, right) => String(left.name ?? left.setId).localeCompare(String(right.name ?? right.setId)))
      .forEach((set) => {
        this.completionSetsElement.appendChild(
          this.buildBar(set.name ?? set.setId, set.completion?.owned ?? 0, set.completion?.total ?? 0)
        );
      });
  }

  /**
   * Renders one native bar per rarity from `stats.drawsByRarity`.
   *
   * @param {object} stats - Raw `user_state["stats"]` value.
   * @returns {void}
   */
  renderRarity(stats) {
    const draws = stats?.drawsByRarity ?? {};
    const rarities = Array.from({ length: CARD_RARITY.MAX }, (_, index) => CARD_RARITY.MIN + index);
    const total = rarities.reduce((sum, rarity) => sum + (Number(draws[String(rarity)]) || 0), 0);
    this.rarityElement.textContent = '';
    if (total === 0) {
      this.rarityElement.textContent = i18n.t('stats.rarity.empty');
      return;
    }
    rarities.forEach((rarity) => {
      const count = Number(draws[String(rarity)]) || 0;
      const label = getRarityLabel(rarity, (key) => i18n.t(key));
      this.rarityElement.appendChild(this.buildBar(label, count, total));
    });
  }

  /**
   * Renders the most drawn card (name, illustration thumbnail, draw count).
   *
   * @param {object} stats - Raw `user_state["stats"]` value.
   * @param {{entries: object[]}} view - Collection view from the manager.
   * @returns {void}
   */
  renderTop(stats, view) {
    this.topElement.textContent = '';
    const drawsByCard = stats?.drawsByCard ?? {};
    const pairs = Object.entries(drawsByCard).filter(([, count]) => Number(count) > 0);
    if (pairs.length === 0) {
      this.topElement.textContent = i18n.t('stats.top.empty');
      return;
    }
    pairs.sort((left, right) => right[1] - left[1]);
    const [key, count] = pairs[0];
    const entry = (view?.entries ?? []).find((candidate) => candidate.key === key);

    const wrapper = document.createElement('div');
    wrapper.className = 'stats__top-card';

    if (entry?.card) {
      const image = document.createElement('img');
      image.className = 'stats__top-image';
      image.loading = 'lazy';
      image.src = i18n.resolveImagePath(entry.card.illustration);
      image.alt = entry.card.getName(i18n.getLang());
      image.addEventListener('error', () => {
        console.warn(`[StatsView] Top card illustration not found for "${key}": ${image.src}`);
        image.hidden = true;
      });
      wrapper.appendChild(image);
    }

    const name = document.createElement('p');
    name.className = 'stats__top-name';
    name.textContent = entry?.card?.getName(i18n.getLang()) ?? key;
    wrapper.appendChild(name);

    const draws = document.createElement('p');
    draws.className = 'stats__top-count';
    draws.textContent = i18n.t('collection.quantity', { count });
    wrapper.appendChild(draws);

    this.topElement.appendChild(wrapper);
    this.log(`Top card: "${key}" drawn ${count} time(s).`);
  }

  /**
   * Builds one labeled native progress bar (`owned / total` + percent).
   *
   * @param {string} label - Bar label.
   * @param {number} owned - Numerator.
   * @param {number} total - Denominator.
   * @returns {HTMLElement} The bar row.
   */
  buildBar(label, owned, total) {
    const safeTotal = Math.max(0, total);
    const safeOwned = Math.min(Math.max(0, owned), Math.max(safeTotal, 0));
    const percent = safeTotal > 0 ? Math.round((safeOwned / safeTotal) * 100) : 0;

    const row = document.createElement('div');
    row.className = 'stats__bar';

    const header = document.createElement('div');
    header.className = 'stats__bar-header';
    const name = document.createElement('span');
    name.className = 'stats__bar-label';
    name.textContent = label;
    const value = document.createElement('span');
    value.className = 'stats__bar-value';
    value.textContent = `${Math.max(0, owned)}/${safeTotal} (${percent} %)`;
    header.appendChild(name);
    header.appendChild(value);

    const track = document.createElement('div');
    track.className = 'stats__track';
    const fill = document.createElement('div');
    fill.className = 'stats__fill';
    fill.style.width = `${percent}%`;
    fill.setAttribute('role', 'progressbar');
    fill.setAttribute('aria-valuenow', String(percent));
    fill.setAttribute('aria-valuemin', '0');
    fill.setAttribute('aria-valuemax', '100');
    fill.setAttribute('aria-label', label);
    track.appendChild(fill);

    row.appendChild(header);
    row.appendChild(track);
    return row;
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
      return;
    }
    this.feedbackElement.hidden = false;
    this.feedbackElement.textContent = i18n.t(key);
    this.feedbackElement.dataset.tone = tone;
    if (tone === 'error') {
      console.warn(`[StatsView] ${i18n.t(key)}`);
    }
  }

  /**
   * Re-renders everything when the language changes.
   *
   * @returns {void}
   */
  handleLanguageChanged() {
    this.log(`Language changed, re-rendering (${i18n.getLang()}).`);
    if (this.isInitialized && !this.isLoading) {
      void this.reload();
    }
  }

  /**
   * Reloads the panels when a pack was just opened.
   *
   * @returns {void}
   */
  handleBoosterOpened() {
    if (!this.isInitialized) return;
    this.log('Booster opened: reloading the statistics.');
    void this.reload();
  }

  /**
   * Reloads the panels when the view becomes active.
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
   * Removes every subscription.
   *
   * @returns {void}
   */
  destroy() {
    this.log('Destroying the view.');
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers = [];
    this.isInitialized = false;
  }
}

export default StatsView;

/**
 * CollectionView - Full-card grid with filters and a detail modal.
 *
 * Reference: `.docs/steps/5.md` point 2.
 *
 * Renders EVERY card declared by the extension JSONs (`CollectionManager.getCollectionView()`):
 * owned cards in color with a `xN` badge, missing cards as grey silhouettes
 * (`filter: grayscale(100%) opacity(0.4)`). Filters: extension, rarity (1-5), style
 * (classic / fullart), status (owned / missing), plus a name search. A tap opens the large
 * modal (illustration, first obtained date, quantity).
 *
 * Illustrations go through `I18n.resolveImagePath()`, labels through `I18n.t()`, and images
 * use `loading="lazy"`. The view refreshes on `VIEW_CHANGED` (activation), `LANG_CHANGED`
 * and `BOOSTER_OPENED` (a pack just changed the quantities).
 */

import eventBus, { EVENTS } from '../../utils/EventBus.js';
import i18n from '../../utils/I18n.js';
import collectionManager from '../../business/CollectionManager.js';
import { CARD_RARITY, CARD_STYLE } from '../../classes/Card.js';

/** View name, matching `data-view="collection"` in `index.html`. */
export const COLLECTION_VIEW_NAME = 'collection';

/** Status filter values (the empty string means "no status filter"). */
export const COLLECTION_STATUS = Object.freeze({
  ALL: '',
  OWNED: 'owned',
  MISSING: 'missing',
});

export class CollectionView {
  /**
   * @param {HTMLElement} rootElement - The collection `<section>`.
   */
  constructor(rootElement) {
    if (!rootElement || typeof rootElement.querySelector !== 'function') {
      throw new TypeError('CollectionView requires the collection section element.');
    }

    this.root = rootElement;
    this.progressElement = this.root.querySelector('[data-collection-progress]');
    this.setSelect = this.root.querySelector('[data-collection-set]');
    this.raritySelect = this.root.querySelector('[data-collection-rarity]');
    this.styleSelect = this.root.querySelector('[data-collection-style]');
    this.statusSelect = this.root.querySelector('[data-collection-status]');
    this.searchInput = this.root.querySelector('[data-collection-search]');
    this.countElement = this.root.querySelector('[data-collection-count]');
    this.feedbackElement = this.root.querySelector('[data-collection-feedback]');
    this.gridElement = this.root.querySelector('[data-collection-grid]');
    this.emptyElement = this.root.querySelector('[data-collection-empty]');
    this.modal = this.root.querySelector('[data-collection-modal]');
    this.modalTitle = this.root.querySelector('[data-collection-modal-title]');
    this.modalBody = this.root.querySelector('[data-collection-modal-body]');
    this.modalClose = this.root.querySelector('[data-collection-modal-close]');

    this.assertMarkup();

    /** @type {object[]} Every catalog entry (owned or missing). */
    this.entries = [];
    /** @type {object} Global completion counters. */
    this.completion = { total: 0, owned: 0 };
    /** @type {object} Per-extension metadata keyed by extension id. */
    this.sets = {};
    /** @type {boolean} True while the view is loading its data. */
    this.isLoading = false;
    /** @type {boolean} True once `init()` bound everything. */
    this.isInitialized = false;
    /** @type {boolean} True when the view is the active one. */
    this.isActive = false;
    /** @type {number|null} Pending search debounce timer. */
    this.searchTimer = null;

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
    console.info('[CollectionView]', ...args);
  }

  /**
   * Verifies that the markup matches the contract expected by this view.
   *
   * @returns {void}
   * @throws {Error} When a required element is missing from `index.html`.
   */
  assertMarkup() {
    const missing = [
      ['[data-collection-set]', this.setSelect],
      ['[data-collection-rarity]', this.raritySelect],
      ['[data-collection-style]', this.styleSelect],
      ['[data-collection-status]', this.statusSelect],
      ['[data-collection-search]', this.searchInput],
      ['[data-collection-grid]', this.gridElement],
      ['[data-collection-modal]', this.modal],
      ['[data-collection-modal-title]', this.modalTitle],
      ['[data-collection-modal-body]', this.modalBody],
      ['[data-collection-modal-close]', this.modalClose],
    ]
      .filter(([, element]) => !element)
      .map(([selector]) => selector);

    if (missing.length > 0) {
      throw new Error(`CollectionView markup is incomplete, missing: ${missing.join(', ')}.`);
    }
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
   * Builds the static filter options, binds the interactions and loads the grid.
   *
   * @returns {Promise<void>} Resolves once the first render finished.
   */
  async init() {
    if (this.isInitialized) return;
    this.isInitialized = true;
    this.log('Initializing…');
    this.buildFilterOptions();
    this.bindEvents();
    this.subscribeToEvents();
    await this.reload();
    this.log('Ready.');
  }

  /**
   * Builds the static filter options (rarity, style, status). The extension options are
   * rebuilt on every reload so a newly added extension JSON appears without a refresh.
   *
   * @returns {void}
   */
  buildFilterOptions() {
    this.fillSelect(this.raritySelect, [
      { value: '', label: i18n.t('collection.filter.allRarities') },
      ...Array.from({ length: CARD_RARITY.MAX - CARD_RARITY.MIN + 1 }, (_, index) => {
        const rarity = CARD_RARITY.MIN + index;
        return { value: String(rarity), label: i18n.t('opening.card.rarity', { rarity }) };
      }),
    ]);
    this.fillSelect(this.styleSelect, [
      { value: '', label: i18n.t('collection.filter.allStyles') },
      { value: CARD_STYLE.CLASSIC, label: i18n.t('collection.filter.styleClassic') },
      { value: CARD_STYLE.FULL_ART, label: i18n.t('collection.filter.styleFullart') },
    ]);
    this.fillSelect(this.statusSelect, [
      { value: COLLECTION_STATUS.ALL, label: i18n.t('collection.filter.allStatuses') },
      { value: COLLECTION_STATUS.OWNED, label: i18n.t('collection.filter.statusOwned') },
      { value: COLLECTION_STATUS.MISSING, label: i18n.t('collection.filter.statusMissing') },
    ]);
  }

  /**
   * Replaces the options of a `<select>`, preserving the current value when still valid.
   *
   * @param {HTMLSelectElement} select - Select to fill.
   * @param {Array<{value: string, label: string}>} options - Options to render.
   * @returns {void}
   */
  fillSelect(select, options) {
    const previous = select.value;
    select.textContent = '';
    options.forEach(({ value, label }) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    });
    if (options.some((option) => option.value === previous)) {
      select.value = previous;
    }
  }

  /**
   * Rebuilds the extension filter from the loaded catalog.
   *
   * @returns {void}
   */
  buildSetOptions() {
    const sets = Object.values(this.sets).sort((left, right) =>
      String(left.name ?? left.setId).localeCompare(String(right.name ?? right.setId))
    );
    this.fillSelect(this.setSelect, [
      { value: '', label: i18n.t('collection.filter.allSets') },
      ...sets.map((set) => ({ value: set.setId, label: set.name ?? set.setId })),
    ]);
  }

  /**
   * Attaches the DOM listeners.
   *
   * @returns {void}
   */
  bindEvents() {
    const rerender = () => this.renderGrid();
    this.listen(this.setSelect, 'change', rerender);
    this.listen(this.raritySelect, 'change', rerender);
    this.listen(this.styleSelect, 'change', rerender);
    this.listen(this.statusSelect, 'change', rerender);
    this.listen(this.searchInput, 'input', () => {
      if (this.searchTimer !== null) {
        window.clearTimeout(this.searchTimer);
      }
      this.searchTimer = window.setTimeout(() => {
        this.searchTimer = null;
        this.renderGrid();
      }, 150);
    });
    this.listen(this.gridElement, 'click', (event) => {
      const tile = event.target instanceof HTMLElement
        ? event.target.closest('[data-collection-key]')
        : null;
      if (tile && this.gridElement.contains(tile)) {
        this.openDetail(tile.dataset.collectionKey);
      }
    });
    this.listen(this.modal, 'click', (event) => {
      if (event?.target === this.modal) {
        this.closeDetail();
      }
    });
    this.listen(this.modalClose, 'click', () => this.closeDetail());
    this.listen(document, 'keydown', (event) => {
      if (event?.key === 'Escape' && this.modal && !this.modal.hidden) {
        this.closeDetail();
      }
    });
    this.log('DOM listeners bound.');
  }

  /**
   * Subscribes to the application events the view depends on.
   *
   * @returns {void}
   */
  subscribeToEvents() {
    this.unsubscribers.push(eventBus.on(EVENTS.VIEW_CHANGED, (payload) => {
      if (!payload || typeof payload.view !== 'string') return;
      if (payload.view === COLLECTION_VIEW_NAME) {
        this.handleViewActivated();
      } else if (payload.previousView === COLLECTION_VIEW_NAME) {
        this.handleViewDeactivated();
      }
    }));
    this.unsubscribers.push(eventBus.on(EVENTS.LANG_CHANGED, () => this.handleLanguageChanged()));
    this.unsubscribers.push(eventBus.on(EVENTS.BOOSTER_OPENED, () => this.handleBoosterOpened()));
    this.log('Event subscriptions registered.');
  }

  /**
   * Reloads the catalog + owned rows, then re-renders the filters and the grid.
   *
   * @returns {Promise<void>} Resolves once the grid is rendered (or the error shown).
   */
  async reload() {
    if (this.isLoading) return;
    this.isLoading = true;
    this.setFeedback(null);
    this.log('Loading the collection…');
    try {
      const view = await collectionManager.getCollectionView();
      this.entries = view.entries ?? [];
      this.completion = view.completion ?? { total: 0, owned: 0 };
      this.sets = view.sets ?? {};
      this.buildSetOptions();
      this.buildFilterOptions();
      this.renderProgress();
      this.renderGrid();
    } catch (error) {
      console.error('[CollectionView] The collection could not be loaded.', error);
      this.setFeedback('collection.error.load', 'error');
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Renders the global completion line (`owned / total (percent %)`).
   *
   * @returns {void}
   */
  renderProgress() {
    if (!this.progressElement) return;
    const total = this.completion.total ?? 0;
    const owned = this.completion.owned ?? 0;
    const percent = total > 0 ? Math.round((owned / total) * 100) : 0;
    this.progressElement.textContent = i18n.t('collection.progress', { owned, total, percent });
  }

  /**
   * Reads the current filter values.
   *
   * @returns {{setId: string, rarity: string, style: string, status: string, search: string}}
   *   The active filters (empty strings mean "no filter").
   */
  readFilters() {
    return {
      setId: this.setSelect?.value ?? '',
      rarity: this.raritySelect?.value ?? '',
      style: this.styleSelect?.value ?? '',
      status: this.statusSelect?.value ?? '',
      search: (this.searchInput?.value ?? '').trim().toLowerCase(),
    };
  }

  /**
   * Applies the active filters to the loaded entries.
   *
   * @param {object} filters - Active filters from `readFilters()`.
   * @returns {object[]} The matching entries, sorted by extension, rarity, then name.
   */
  applyFilters(filters) {
    const lang = i18n.getLang();
    return this.entries
      .filter((entry) => {
        if (filters.setId && entry.set !== filters.setId) return false;
        if (filters.rarity && String(entry.rarity ?? '') !== filters.rarity) return false;
        if (filters.style && entry.style !== filters.style) return false;
        if (filters.status === COLLECTION_STATUS.OWNED && !entry.owned) return false;
        if (filters.status === COLLECTION_STATUS.MISSING && entry.owned) return false;
        if (filters.search) {
          const name = (entry.card?.getName(lang) ?? entry.cardId ?? '').toLowerCase();
          if (!name.includes(filters.search)) return false;
        }
        return true;
      })
      .sort((left, right) => {
        if (left.set !== right.set) return String(left.set).localeCompare(String(right.set));
        if ((left.rarity ?? 0) !== (right.rarity ?? 0)) return (left.rarity ?? 0) - (right.rarity ?? 0);
        const leftName = left.card?.getName(lang) ?? left.cardId ?? '';
        const rightName = right.card?.getName(lang) ?? right.cardId ?? '';
        return leftName.localeCompare(rightName);
      });
  }

  /**
   * Renders the filtered grid.
   *
   * @returns {void}
   */
  renderGrid() {
    if (!this.gridElement) return;
    const shown = this.applyFilters(this.readFilters());
    this.gridElement.textContent = '';
    shown.forEach((entry) => {
      this.gridElement.appendChild(this.buildTile(entry));
    });
    if (this.countElement) {
      this.countElement.textContent = i18n.t('collection.count', { shown: shown.length });
    }
    if (this.emptyElement) {
      this.emptyElement.hidden = shown.length > 0;
    }
    this.log(`Grid rendered: ${shown.length}/${this.entries.length} card(s) shown.`);
  }

  /**
   * Builds one grid tile (owned in color with `xN`, missing as a grey silhouette).
   *
   * @param {object} entry - Collection entry from `getCollectionView()`.
   * @returns {HTMLElement} The tile element.
   */
  buildTile(entry) {
    const lang = i18n.getLang();
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = `collection__tile${entry.owned ? '' : ' is-missing'}`;
    tile.dataset.collectionKey = entry.key;
    const name = entry.card?.getName(lang) ?? entry.cardId ?? entry.key;
    tile.setAttribute(
      'aria-label',
      entry.owned ? name : `${name} — ${i18n.t('collection.missing')}`
    );

    const image = document.createElement('img');
    image.className = 'collection__image';
    image.loading = 'lazy';
    image.alt = name;
    if (entry.card) {
      image.src = i18n.resolveImagePath(entry.card.illustration);
      image.addEventListener('error', () => {
        console.warn(`[CollectionView] Illustration not found for "${entry.key}": ${image.src}`);
        image.hidden = true;
      });
    } else {
      image.hidden = true;
    }

    const caption = document.createElement('span');
    caption.className = 'collection__caption';
    caption.textContent = name;

    tile.appendChild(image);
    tile.appendChild(caption);

    if (entry.owned && entry.quantity > 1) {
      const badge = document.createElement('span');
      badge.className = 'collection__badge';
      badge.textContent = i18n.t('collection.quantity', { count: entry.quantity });
      tile.appendChild(badge);
    }
    return tile;
  }

  /**
   * Opens the large detail modal for one card.
   *
   * @param {string} key - Collection key (`${id}_${style}`).
   * @returns {void}
   */
  openDetail(key) {
    const entry = this.entries.find((candidate) => candidate.key === key);
    if (!entry || !this.modal || !this.modalTitle || !this.modalBody) return;
    const card = entry.card;
    const lang = i18n.getLang();
    const name = card?.getName(lang) ?? entry.cardId ?? key;
    this.modalTitle.textContent = name;
    this.modalBody.textContent = '';

    if (card) {
      const image = document.createElement('img');
      image.className = 'collection-modal__image';
      image.src = i18n.resolveImagePath(card.illustration);
      image.alt = `${name} — ${i18n.t('opening.card.rarity', { rarity: card.rarity })}`;
      image.addEventListener('error', () => {
        console.warn(`[CollectionView] Detail illustration not found for "${key}": ${image.src}`);
        image.hidden = true;
      });
      this.modalBody.appendChild(image);
    }

    const list = document.createElement('dl');
    list.className = 'card-modal__details';
    const rows = [
      [i18n.t('opening.card.name'), name],
      [i18n.t('opening.card.rarity', { rarity: entry.rarity ?? card?.rarity ?? '—' }),
        String(entry.rarity ?? card?.rarity ?? '—')],
      [i18n.t('opening.card.set'), entry.set ?? card?.set ?? '—'],
      [i18n.t('collection.filter.status'),
        entry.owned ? i18n.t('collection.filter.statusOwned') : i18n.t('collection.missing')],
    ];
    if (entry.owned) {
      rows.push([i18n.t('collection.quantity', { count: entry.quantity }), `x${entry.quantity}`]);
      if (entry.firstObtainedAt) {
        rows.push([i18n.t('collection.firstObtained', { date: '' }), this.formatDate(entry.firstObtainedAt)]);
      }
    }
    rows.forEach(([term, value]) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'card-modal__row';
      const keyElement = document.createElement('dt');
      keyElement.textContent = term;
      const valueElement = document.createElement('dd');
      valueElement.textContent = value;
      wrapper.appendChild(keyElement);
      wrapper.appendChild(valueElement);
      list.appendChild(wrapper);
    });
    this.modalBody.appendChild(list);
    this.modal.hidden = false;
    this.log(`Detail opened for "${key}".`);
  }

  /**
   * Formats an ISO timestamp for the current locale (date only).
   *
   * @param {string} value - ISO timestamp from the `collection` store.
   * @returns {string} The localized date, or the raw value when unparseable.
   */
  formatDate(value) {
    const time = Date.parse(value);
    if (Number.isNaN(time)) return String(value);
    try {
      return new Intl.DateTimeFormat(i18n.getLang()).format(new Date(time));
    } catch (error) {
      console.warn(`[CollectionView] Date formatting failed for "${value}".`, error);
      return String(value);
    }
  }

  /**
   * Closes the detail modal.
   *
   * @returns {void}
   */
  closeDetail() {
    if (!this.modal || this.modal.hidden) return;
    this.modal.hidden = true;
    this.log('Detail closed.');
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
      console.warn(`[CollectionView] ${i18n.t(key)}`);
    }
  }

  /**
   * Re-renders everything when the language changes.
   *
   * @returns {void}
   */
  handleLanguageChanged() {
    this.log(`Language changed, re-rendering (${i18n.getLang()}).`);
    this.buildFilterOptions();
    this.buildSetOptions();
    this.renderProgress();
    this.renderGrid();
    this.closeDetail();
  }

  /**
   * Reloads the grid when a pack was just opened (quantities changed).
   *
   * @returns {Promise<void>} Resolves once the reload finished.
   */
  async handleBoosterOpened() {
    if (!this.isInitialized) return;
    this.log('Booster opened: reloading the collection.');
    await this.reload();
  }

  /**
   * Reloads the grid when the view becomes active (a pack may have been opened meanwhile).
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
   * Removes every listener.
   *
   * @returns {void}
   */
  destroy() {
    this.log('Destroying the view.');
    if (this.searchTimer !== null) {
      window.clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
    this.bindings.forEach(({ target, type, handler }) => target.removeEventListener(type, handler));
    this.bindings = [];
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers = [];
    this.isInitialized = false;
  }
}

export default CollectionView;


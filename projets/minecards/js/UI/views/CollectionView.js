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
 *
 * FAVOURITES
 *   An owned card carries a heart button (top-left of the tile, and in the detail modal) that pins
 *   it in `user_state["profile"].favorites` through `ProfileManager` (at most
 *   `profile.maxFavorites`). The heart is a SIBLING of the tile, not a child: the tile is itself a
 *   `<button>` and nested buttons are invalid HTML. The hearts repaint from `FAVORITES_UPDATED`
 *   without rebuilding the grid, so clicking one never restarts the tile animation.
 */

import eventBus, { EVENTS } from '../../utils/EventBus.js';
import i18n from '../../utils/I18n.js';
import collectionManager from '../../business/CollectionManager.js';
import sparksManager from '../../business/SparksManager.js';
import profileManager, { getProfileErrorMessageKey } from '../../business/ProfileManager.js';
import Toast from '../components/Toast.js';
import { getShineClasses } from '../components/CardComponent.js';
import { CARD_RARITY, CARD_STYLE, getRarityLabel } from '../../classes/Card.js';

/** Icon of the Sparks currency, relative to the application root. */
export const SPARKS_ICON_PATH = 'assets/img/sparks.png';

/** SVG namespace used to build the favourite icon without injecting markup. */
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

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
    /** @type {boolean} True while a sale or a purchase is running. */
    this.tradeBusy = false;
    /** @type {Set<string>} Collection keys pinned as favourites. */
    this.favorites = new Set();
    /** @type {boolean} True while a favourite toggle is running (serializes the read-modify-write). */
    this.favoriteBusy = false;
    /** @type {boolean} Foil reflection of the large card of the detail modal (on by default). */
    this.shineEnabled = true;
    /** @type {HTMLElement|null} Window carrying the foil reflection of the open detail. */
    this.shineWindow = null;

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
        return { value: String(rarity), label: getRarityLabel(rarity, (key) => i18n.t(key)) };
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
   * Resolves the display name of an extension (the booster `Name`, e.g. "Genesis Blocks").
   *
   * The technical id ("A1") is never shown to the player: only the display name is, in every
   * language (it is a single neutral value). Falls back to the id when the extension is unknown.
   *
   * @param {string|null} setId - Extension id.
   * @returns {string} The display name, or the id.
   */
  resolveSetName(setId) {
    if (!setId) return '—';
    return this.sets?.[setId]?.name ?? setId;
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
      // `Element`, not `HTMLElement`: a click on the heart lands on its inline `<svg>`, which is an
      // `SVGElement` and would be discarded by an HTML-only guard.
      const target = event.target instanceof Element ? event.target : null;
      // The heart is checked first: it is a sibling of the tile, so both would match `closest()`.
      const heart = target?.closest('[data-collection-favorite]');
      if (heart && this.gridElement.contains(heart)) {
        void this.toggleFavorite(heart.dataset.collectionFavorite);
        return;
      }
      const tile = target?.closest('[data-collection-key]');
      if (tile && this.gridElement.contains(tile)) {
        void this.openDetail(tile.dataset.collectionKey);
      }
    });
    this.listen(this.modal, 'click', (event) => {
      if (event?.target === this.modal) {
        this.closeDetail();
      }
    });
    this.listen(this.modalClose, 'click', () => this.closeDetail());
    // The modal body is rebuilt on every opening, so its buttons are handled by delegation instead
    // of one listener per built button.
    this.listen(this.modalBody, 'click', (event) => {
      const toggle =
        event?.target instanceof Element ? event.target.closest('[data-collection-shine]') : null;
      if (toggle && this.modalBody?.contains(toggle)) {
        this.toggleShine();
      }
    });
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
    this.unsubscribers.push(eventBus.on(EVENTS.FAVORITES_UPDATED, (payload) => this.handleFavoritesUpdated(payload)));
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
      const [view] = await Promise.all([collectionManager.getCollectionView(), this.loadFavorites()]);
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
   * Reads the favourite cards of the profile.
   *
   * A read failure is not fatal: the grid is still usable without its hearts, so the collection is
   * drawn with an empty favourite set instead of failing the whole view.
   *
   * @returns {Promise<void>} Resolves once the set is up to date.
   */
  async loadFavorites() {
    try {
      const profile = await profileManager.getProfile();
      this.favorites = new Set(profile.favorites);
    } catch (error) {
      console.warn('[CollectionView] The favourite cards could not be read.', error);
      this.favorites = new Set();
    }
  }

  /**
   * Builds the heart icon of a favourite button.
   *
   * The icon is built node by node (never through `innerHTML`) and inherits `currentColor`, so the
   * filled/outlined state only depends on the `is-active` class of its button.
   *
   * @returns {SVGElement} The icon.
   */
  static buildHeartIcon() {
    const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const path = document.createElementNS(SVG_NAMESPACE, 'path');
    path.setAttribute(
      'd',
      'M12 20.4 4.9 13.3a4.4 4.4 0 0 1 6.2-6.2l.9.8.9-.8a4.4 4.4 0 0 1 6.2 6.2z'
    );
    svg.appendChild(path);
    return svg;
  }

  /**
   * Builds the heart button overlaid on an owned tile.
   *
   * @param {object} entry - Owned collection entry.
   * @returns {HTMLButtonElement} The button.
   */
  buildFavoriteButton(entry) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'collection__favorite';
    button.dataset.collectionFavorite = entry.key;
    button.appendChild(CollectionView.buildHeartIcon());
    this.applyFavoriteState(button);
    return button;
  }

  /**
   * Writes the active state and the accessible label of a favourite control.
   *
   * @param {HTMLElement} element - Element carrying a `data-collection-favorite` or
   *   `data-collection-modal-favorite` key.
   * @returns {void}
   */
  applyFavoriteState(element) {
    const key = element.dataset.collectionFavorite ?? element.dataset.collectionModalFavorite;
    const active = this.favorites.has(key);
    const label = i18n.t(active ? 'collection.favorite.remove' : 'collection.favorite.add');
    element.classList.toggle('is-active', active);
    element.setAttribute('aria-pressed', String(active));
    element.setAttribute('aria-label', label);
    element.title = label;
    const text = element.querySelector('.collection-favorite__label');
    if (text) text.textContent = label;
  }

  /**
   * Repaints every heart of the grid and of the open modal.
   *
   * @returns {void}
   */
  syncFavoriteControls() {
    this.gridElement
      ?.querySelectorAll('[data-collection-favorite]')
      .forEach((element) => this.applyFavoriteState(element));
    this.modalBody
      ?.querySelectorAll('[data-collection-modal-favorite]')
      .forEach((element) => this.applyFavoriteState(element));
  }

  /**
   * Pins or unpins one card and repaints the hearts.
   *
   * @param {string} key - Collection key.
   * @returns {Promise<void>} Resolves once the toggle finished (or the refusal was reported).
   */
  async toggleFavorite(key) {
    // `ProfileManager` toggles a favourite with a read-then-write: two fast clicks must not race.
    if (this.favoriteBusy || typeof key !== 'string') return;
    this.favoriteBusy = true;
    try {
      const { favorites, added } = await profileManager.toggleFavorite(key);
      this.favorites = new Set(favorites);
      this.syncFavoriteControls();
      Toast.success(added ? 'collection.favorite.added' : 'collection.favorite.removed');
      this.log(`Favourite ${added ? 'added' : 'removed'}: "${key}" (${favorites.length} pinned).`);
    } catch (error) {
      console.error('[CollectionView] The favourite card could not be saved.', error);
      Toast.error(getProfileErrorMessageKey(error));
    } finally {
      this.favoriteBusy = false;
    }
  }

  /**
   * Repaints the hearts when the favourite list changed elsewhere (profile page).
   *
   * @param {{favorites?: string[]}|null} payload - `FAVORITES_UPDATED` payload.
   * @returns {void}
   */
  handleFavoritesUpdated(payload) {
    if (!Array.isArray(payload?.favorites)) return;
    this.favorites = new Set(payload.favorites);
    this.syncFavoriteControls();
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
    const cell = document.createElement('div');
    cell.className = 'collection__cell';
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

    // A promo card is not drawn: it was granted by a code or an event. The chip is what tells the
    // player where that card they cannot open their way to came from.
    if (entry.promo) {
      const chip = document.createElement('span');
      chip.className = 'collection__promo';
      chip.textContent = i18n.t('collection.promo');
      tile.appendChild(chip);
    }

    if (entry.owned && entry.quantity > 1) {
      const badge = document.createElement('span');
      badge.className = 'collection__badge';
      badge.textContent = i18n.t('collection.quantity', { count: entry.quantity });
      tile.appendChild(badge);
    }

    cell.appendChild(tile);
    // The heart is reserved to the cards the player actually owns: a favourite is a card pinned in
    // the collection, and its key must stay resolvable when the profile page renders it.
    if (entry.owned) {
      cell.appendChild(this.buildFavoriteButton(entry));
    }
    return cell;
  }

  /**
   * Opens the large detail modal for one card.
   *
   * @param {string} key - Collection key (`${id}_${style}`).
   * @returns {Promise<void>} Resolves once the modal is displayed (the Sparks actions load prices).
   */
  async openDetail(key) {
    const entry = this.entries.find((candidate) => candidate.key === key);
    if (!entry || !this.modal || !this.modalTitle || !this.modalBody) return;
    const card = entry.card;
    const lang = i18n.getLang();
    const name = card?.getName(lang) ?? entry.cardId ?? key;
    this.modalTitle.textContent = name;
    this.modalBody.textContent = '';

    if (card) {
      this.modalBody.appendChild(this.buildDetailArtwork(card, name, key));
      if (getShineClasses(card).length > 0) {
        this.modalBody.appendChild(this.buildShineToggle());
      }
    }

    const list = document.createElement('dl');
    list.className = 'card-modal__details';
    const rarityValue = entry.rarity ?? card?.rarity ?? null;
    const rows = [
      [i18n.t('opening.card.name'), name],
      [i18n.t('opening.card.rarity'),
        rarityValue === null ? '—' : getRarityLabel(rarityValue, (key) => i18n.t(key))],
      [i18n.t('opening.card.set'), this.resolveSetName(entry.set ?? card?.set ?? null)],
      [i18n.t('collection.filter.status'),
        entry.owned ? i18n.t('collection.filter.statusOwned') : i18n.t('collection.missing')],
    ];
    if (entry.owned) {
      // `collection.quantity` ("x{count}") is the VALUE of a copy count, not its label: using it as
      // the label printed "x1 x1" in the detail row.
      rows.push([i18n.t('collection.copies'), `x${entry.quantity}`]);
      if (entry.firstObtainedAt) {
        rows.push([i18n.t('collection.firstObtained'), this.formatDate(entry.firstObtainedAt)]);
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

    const trade = await this.buildTradeActions(entry);
    if (trade) {
      this.modalBody.appendChild(trade);
    }

    if (entry.owned) {
      this.modalBody.appendChild(this.buildFavoriteToggle(entry));
    }

    this.modal.hidden = false;
    this.log(`Detail opened for "${key}".`);
  }

  /**
   * Builds the large artwork of the detail modal, wrapped so the foil reflection has a window.
   *
   * The wrapper takes the exact shape of the ILLUSTRATION (`--card-reveal-art-ratio`), which is what
   * lets the highlight of `css/components/card-shine.css` line up with the artwork and stop there -
   * a classic and a full art printing get the same window. The reflection itself is only added for
   * the rarities that carry one, through the very same helper the opening uses, so a legendary looks
   * the same in both places.
   *
   * @param {object} card - Card to display.
   * @param {string} name - Translated card name (also the accessible text).
   * @param {string} key - Collection key, used in the logs.
   * @returns {HTMLElement} The artwork box.
   */
  buildDetailArtwork(card, name, key) {
    const art = document.createElement('div');
    art.className = 'collection-modal__art';

    const image = document.createElement('img');
    image.className = 'collection-modal__image';
    image.src = i18n.resolveImagePath(card.illustration);
    image.alt = `${name} — ${getRarityLabel(card.rarity, (labelKey) => i18n.t(labelKey))}`;
    // The shine is laid over the artwork, so the box needs the real ratio of the illustration.
    image.addEventListener('load', () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        art.style.setProperty(
          '--card-reveal-art-ratio',
          String(image.naturalWidth / image.naturalHeight)
        );
      }
    });
    image.addEventListener('error', () => {
      console.warn(`[CollectionView] Detail illustration not found for "${key}": ${image.src}`);
      image.hidden = true;
    });
    art.appendChild(image);

    art.classList.add(...getShineClasses(card));
    art.classList.toggle('is-off', !this.shineEnabled);
    this.shineWindow = art;
    return art;
  }

  /**
   * Builds the button switching the foil reflection of the large card on and off.
   *
   * @returns {HTMLElement} The block holding the toggle.
   */
  buildShineToggle() {
    const wrapper = document.createElement('div');
    wrapper.className = 'collection-shine';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn--ghost collection-shine__toggle';
    button.dataset.collectionShine = 'toggle';
    button.textContent = i18n.t('collection.shine.toggle');
    button.setAttribute('aria-label', i18n.t('collection.shine.aria'));
    button.setAttribute('aria-pressed', String(this.shineEnabled));
    if (this.shineEnabled) {
      button.classList.add('is-active');
    }

    wrapper.appendChild(button);
    return wrapper;
  }

  /**
   * Switches the foil reflection of the open detail on or off.
   *
   * The choice is kept on the view, so opening another card keeps it for the session; it is not a
   * stored preference, since it is a reading comfort, not a game setting.
   *
   * @returns {void}
   */
  toggleShine() {
    this.shineEnabled = !this.shineEnabled;
    this.shineWindow?.classList.toggle('is-off', !this.shineEnabled);
    this.modalBody?.querySelectorAll('[data-collection-shine]').forEach((button) => {
      button.classList.toggle('is-active', this.shineEnabled);
      button.setAttribute('aria-pressed', String(this.shineEnabled));
    });
    this.log(`Foil reflection ${this.shineEnabled ? 'enabled' : 'disabled'}.`);
  }

  /**
   * Builds the favourite toggle of the detail modal.
   *
   * The element is rebuilt on every `openDetail()`, so its listener is registered through
   * `listen()` and released with the other bindings by `destroy()`.
   *
   * @param {object} entry - Owned collection entry.
   * @returns {HTMLElement} The block holding the toggle.
   */
  buildFavoriteToggle(entry) {
    const wrapper = document.createElement('div');
    wrapper.className = 'collection-favorite';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn--ghost collection-favorite__toggle';
    button.dataset.collectionModalFavorite = entry.key;
    button.appendChild(CollectionView.buildHeartIcon());
    const label = document.createElement('span');
    label.className = 'collection-favorite__label';
    button.appendChild(label);
    this.applyFavoriteState(button);

    this.listen(button, 'click', () => void this.toggleFavorite(entry.key));
    wrapper.appendChild(button);
    return wrapper;
  }

  /**
   * Builds the Sparks trade block of the detail modal: wallet, sell and buy buttons.
   *
   * Selling is only offered from two owned copies (the last copy is never sellable); buying is
   * always offered for a catalog card. Prices come from `settings/config.json` (`sparks`).
   *
   * @param {object} entry - Collection entry.
   * @returns {Promise<HTMLElement|null>} The block, or null when the rarity/economy is unavailable.
   */
  async buildTradeActions(entry) {
    const rarity = entry.rarity ?? entry.card?.rarity ?? null;
    if (rarity === null) return null;

    let balance = 0;
    let sellPrice = 0;
    let buyPrice = 0;
    try {
      const prices = await sparksManager.getPrices();
      sellPrice = prices.sellPrice[String(rarity)] ?? 0;
      buyPrice = prices.buyPrice[String(rarity)] ?? 0;
      balance = await sparksManager.getBalance();
    } catch (error) {
      console.warn('[CollectionView] The Sparks economy could not be read.', error);
      return null;
    }

    const container = document.createElement('div');
    container.className = 'collection-trade';

    const wallet = document.createElement('p');
    wallet.className = 'collection-trade__wallet';
    const icon = document.createElement('img');
    icon.className = 'collection-trade__icon';
    icon.src = SPARKS_ICON_PATH;
    icon.alt = '';
    icon.setAttribute('aria-hidden', 'true');
    const walletValue = document.createElement('strong');
    walletValue.className = 'collection-trade__balance';
    walletValue.textContent = String(balance);
    const walletLabel = document.createElement('span');
    walletLabel.className = 'collection-trade__label';
    walletLabel.textContent = i18n.t('sparks.title');
    wallet.append(icon, walletValue, walletLabel);

    const actions = document.createElement('div');
    actions.className = 'collection-trade__actions';

    const quantity = entry.owned && Number.isFinite(entry.quantity) ? entry.quantity : 0;
    if (quantity >= 2) {
      actions.appendChild(
        this.buildTradeButton({
          label: i18n.t('collection.trade.sellOne'),
          ariaLabel: i18n.t('collection.trade.sellAria', { count: 1, sparks: sellPrice }),
          amount: sellPrice,
          tone: 'gain',
          variant: 'ghost',
          onClick: () => void this.handleSell(entry, 1),
        })
      );

      const extra = quantity - 1;
      actions.appendChild(
        this.buildTradeButton({
          label: extra === 1
            ? i18n.t('collection.trade.sellOne')
            : i18n.t('collection.trade.sellMany', { count: extra }),
          ariaLabel: i18n.t('collection.trade.sellAria', { count: extra, sparks: sellPrice * extra }),
          amount: sellPrice * extra,
          tone: 'gain',
          variant: 'ghost',
          onClick: () => void this.handleSell(entry, extra),
        })
      );
    }

    actions.appendChild(
      this.buildTradeButton({
        label: i18n.t('collection.trade.buyOne'),
        ariaLabel: i18n.t('collection.trade.buyAria', { count: 1, sparks: buyPrice }),
        amount: buyPrice,
        tone: 'cost',
        variant: 'primary',
        disabled: !entry.card || balance < buyPrice,
        onClick: () => void this.handleBuy(entry),
      })
    );

    container.append(wallet, actions);
    return container;
  }

  /**
   * Builds one Sparks trade button: an action label followed by a coloured Sparks delta.
   *
   * The delta carries the inline Sparks icon (an `<img>`, so it cannot live in the translation
   * string). A sale is a GAIN (green, `+`), a purchase is a COST (red, `−`).
   *
   * @param {object} options - Button options.
   * @param {string} options.label - Visible action label ("Vendre 2 cartes").
   * @param {string} options.ariaLabel - Full accessible label, price included.
   * @param {number} options.amount - Sparks amount (always positive).
   * @param {'gain'|'cost'} options.tone - `gain` (green, `+`) or `cost` (red, `−`).
   * @param {'ghost'|'primary'} options.variant - Button style variant.
   * @param {() => void} options.onClick - Click handler.
   * @param {boolean} [options.disabled=false] - Whether the button is disabled.
   * @returns {HTMLButtonElement} The button element.
   */
  buildTradeButton({ label, ariaLabel, amount, tone, variant, onClick, disabled = false }) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `btn btn--${variant}`;
    button.disabled = disabled;
    if (ariaLabel) {
      button.setAttribute('aria-label', ariaLabel);
    }

    const labelElement = document.createElement('span');
    labelElement.className = 'collection-trade__label';
    labelElement.textContent = label;

    const delta = document.createElement('span');
    delta.className = 'collection-trade__delta';
    delta.dataset.tone = tone;
    const sign = tone === 'gain' ? '+' : '−';
    const icon = document.createElement('img');
    icon.className = 'collection-trade__delta-icon';
    icon.src = SPARKS_ICON_PATH;
    icon.alt = '';
    icon.setAttribute('aria-hidden', 'true');
    delta.append(document.createTextNode(`(${sign}${amount} `), icon, document.createTextNode(')'));

    button.append(labelElement, delta);
    button.addEventListener('click', onClick);
    return button;
  }

  /**
   * Sells copies of an owned card and refreshes the grid and the modal.
   *
   * @param {object} entry - Collection entry.
   * @param {number} copies - Number of copies to sell (strictly positive).
   * @returns {Promise<void>} Resolves once the sale finished (or the error was reported).
   */
  async handleSell(entry, copies) {
    if (this.tradeBusy) return;
    this.tradeBusy = true;
    try {
      const rarity = entry.rarity ?? entry.card?.rarity ?? null;
      const result = await sparksManager.sellCard({ key: entry.key, rarity, copies });
      Toast.success('collection.trade.sold', { params: { count: copies, sparks: result.gained } });
      this.log(`Sold ${copies} copy(ies) of "${entry.key}" for ${result.gained} Sparks.`);
      await this.reload();
      await this.openDetail(entry.key);
    } catch (error) {
      if (error?.code === 'LAST_COPY_PROTECTED') {
        Toast.error('collection.error.lastCopy');
      } else {
        console.error('[CollectionView] The sale failed.', error);
        Toast.error('collection.error.sell');
      }
    } finally {
      this.tradeBusy = false;
    }
  }

  /**
   * Buys one copy of a catalog card and refreshes the grid and the modal.
   *
   * @param {object} entry - Collection entry.
   * @returns {Promise<void>} Resolves once the purchase finished (or the error was reported).
   */
  async handleBuy(entry) {
    if (this.tradeBusy || !entry.card) return;
    this.tradeBusy = true;
    try {
      await sparksManager.buyCard(entry.card);
      Toast.success('collection.trade.bought');
      this.log(`Bought a copy of "${entry.key}".`);
      await this.reload();
      await this.openDetail(entry.key);
    } catch (error) {
      if (error?.code === 'INSUFFICIENT_SPARKS') {
        Toast.error('collection.error.insufficient');
      } else {
        console.error('[CollectionView] The purchase failed.', error);
        Toast.error('collection.error.buy');
      }
    } finally {
      this.tradeBusy = false;
    }
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
    this.shineWindow = null;
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


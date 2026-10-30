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
 *
 * PROMO FILTERS
 *   The extension filter lists the extensions, but the promo cards form a family of their own: the
 *   popup adds `COLLECTION_PROMO_FILTER`, a "Promo" toggle that is ALWAYS offered and gathers every
 *   owned promo, followed by one toggle per promo series the player actually owns something in
 *   ("Promo A1", the `Serie` of the promo file). The promo family lives in the popup with every
 *   other filter: the bar of the page carries no filter of its own any more.
 *
 * TRADING AND PROMOS
 *   A promo card is neither sellable nor buyable: the detail modal offers no trade button for one
 *   (it explains why instead), and `SparksManager` refuses the operation whatever the caller does.
 *
 * DEVELOPER MODE
 *   When `settings["devMode"]` is on (`SettingsView`), the detail modal shows the collection key of
 *   the open card and a button copying it: the exact string stored in the `collection` store, which
 *   is what an operator needs to look a card up in a save, a `.json` or a report. Nothing else
 *   changes for the player when the switch is off.
 */

import eventBus, { EVENTS } from '../../utils/EventBus.js';
import i18n from '../../utils/I18n.js';
import { DEFAULT_BINDER_SETTINGS } from '../../utils/ConfigLoader.js';
import collectionManager from '../../business/CollectionManager.js';
import accountManager from '../../business/AccountManager.js';
import sparksManager, { PROMO_PROTECTED } from '../../business/SparksManager.js';
import profileManager, {
  PROFILE_ERROR_CODES,
  getProfileErrorMessageKey,
} from '../../business/ProfileManager.js';
import { PROFILE_SLOT_KINDS } from '../../business/FeatureManager.js';
import slotPurchaseModal from '../components/SlotPurchaseModal.js';
import binderManager, {
  BinderManager,
  BINDER_SLOT_COUNT,
  BINDER_NAME_MAX_LENGTH,
  BINDER_LIMIT_REACHED,
  BINDER_COPY_UNAVAILABLE,
} from '../../business/BinderManager.js';
import Toast from '../components/Toast.js';
import { writeToClipboard } from '../../utils/Clipboard.js';
import { attachCardTilt } from '../../utils/CardTilt.js';
import soundManager, { UI_SOUNDS } from '../../utils/SoundManager.js';
import { getShineClasses, applyShine, applyCardGlow } from '../components/CardComponent.js';
import { buildCardEffectsToggle, syncCardEffectsToggle } from '../components/CardEffectsToggle.js';
import { CARD_RARITY, CARD_STYLE, getRarityLabel } from '../../classes/Card.js';

/** Icon of the Sparks currency, relative to the application root. */
export const SPARKS_ICON_PATH = 'assets/img/sparks.png';

/**
 * Value of the extension filter that gathers every promo group at once.
 *
 * It is not a set id (no group is ever named that), so it can live in the `<select>` next to the
 * real ones without risking a collision, and `applyFilters()` recognises it explicitly.
 */
export const COLLECTION_PROMO_FILTER = '__promo';

/** SVG namespace used to build the favourite icon without injecting markup. */
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/** View name, matching `data-view="collection"` in `index.html`. */
export const COLLECTION_VIEW_NAME = 'collection';

/**
 * Status filter values (the empty string means "no status filter").
 *
 * `SELLABLE` is the "I have at least two copies" view: the first one is the collection, every extra
 * one can be traded, so it is exactly the set the trade screen of a card works on.
 */
export const COLLECTION_STATUS = Object.freeze({
  ALL: '',
  OWNED: 'owned',
  MISSING: 'missing',
  SELLABLE: 'sellable',
});

/** Sort keys of the collection grid. */
export const COLLECTION_SORT = Object.freeze({
  /**
   * The card NUMBER ("SERIE-A1 / W001", `entry.cardId`). The extension id comes first, so the grid
   * reads extension by extension.
   */
  INDEX: 'index',
  /**
   * The order the extension FILE lists the cards in (`entry.index`), extension first as well - the
   * default. Distinct from `INDEX` on purpose: a file groups its cards by theme, so its order is
   * not the order of the card numbers. The option is labelled "Index" in the popup.
   */
  FILE_INDEX: 'fileIndex',
  RARITY: 'rarity',
  STYLE: 'style',
  QUANTITY: 'quantity',
  /**
   * The day the player got the card for the first time (`entry.firstObtainedAt`), oldest first. The
   * cards never obtained (the silhouettes) always come last, in both directions: a missing card has
   * no date, and mixing it into the dates would push the collection around at random.
   */
  OBTAINED: 'obtained',
});

/** Sort directions. */
export const COLLECTION_DIRECTION = Object.freeze({
  ASC: 'asc',
  DESC: 'desc',
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
    this.searchInput = this.root.querySelector('[data-collection-search]');
    this.countElement = this.root.querySelector('[data-collection-count]');
    this.feedbackElement = this.root.querySelector('[data-collection-feedback]');
    this.gridElement = this.root.querySelector('[data-collection-grid]');
    this.emptyElement = this.root.querySelector('[data-collection-empty]');
    this.filterOpenButton = this.root.querySelector('[data-collection-filter-open]');
    this.filterBadgeElement = this.root.querySelector('[data-collection-filter-badge]');
    this.filterSummaryElement = this.root.querySelector('[data-collection-filter-summary]');
    this.filterModal = this.root.querySelector('[data-collection-filter-modal]');
    this.filterBody = this.root.querySelector('[data-collection-filter-body]');
    this.filterClose = this.root.querySelector('[data-collection-filter-close]');
    this.filterReset = this.root.querySelector('[data-collection-filter-reset]');
    this.filterApply = this.root.querySelector('[data-collection-filter-apply]');
    this.filterCountElement = null;
    this.bindersOpenButton = this.root.querySelector('[data-collection-binders-open]');
    this.bindersModal = this.root.querySelector('[data-collection-binders-modal]');
    this.bindersList = this.root.querySelector('[data-collection-binders-list]');
    this.bindersSummary = this.root.querySelector('[data-collection-binders-summary]');
    this.bindersEmpty = this.root.querySelector('[data-collection-binders-empty]');
    this.bindersClose = this.root.querySelector('[data-collection-binders-close]');
    this.binderModal = this.root.querySelector('[data-collection-binder-modal]');
    this.binderTitle = this.root.querySelector('[data-collection-binder-title]');
    this.binderBody = this.root.querySelector('[data-collection-binder-body]');
    this.binderFeedback = this.root.querySelector('[data-collection-binder-feedback]');
    this.binderClose = this.root.querySelector('[data-collection-binder-close]');
    this.binderCancel = this.root.querySelector('[data-collection-binder-cancel]');
    this.binderSave = this.root.querySelector('[data-collection-binder-save]');
    this.binderShare = this.root.querySelector('[data-collection-binder-share]');
    this.binderDelete = this.root.querySelector('[data-collection-binder-delete]');
    this.binderPickerModal = this.root.querySelector('[data-collection-binder-picker-modal]');
    this.binderPickerTitle = this.root.querySelector('[data-collection-binder-picker-title]');
    this.binderPickerSearch = this.root.querySelector('[data-collection-binder-picker-search]');
    this.binderPickerBody = this.root.querySelector('[data-collection-binder-picker-body]');
    this.binderPickerEmpty = this.root.querySelector('[data-collection-binder-picker-empty]');
    this.binderPickerClose = this.root.querySelector('[data-collection-binder-picker-close]');
    this.binderPickerCancel = this.root.querySelector('[data-collection-binder-picker-cancel]');
    this.binderPickerClear = this.root.querySelector('[data-collection-binder-picker-clear]');
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
    /** @type {string|null} Collection key of the card the detail modal shows. */
    this.detailKey = null;
    /** @type {boolean} Developer mode: shows the key of the open card and a copy button. */
    this.devMode = false;
    /** @type {object[]} The binders of the player, in creation order. */
    this.binders = [];
    /**
     * @type {{id: string|null, name: string, cover: string|null, slots: Array<string|null>}|null}
     *   The page being edited. It is a DRAFT: nothing reaches the storage before "Enregistrer", so
     *   closing the editor throws the work away instead of leaving half of a page behind.
     */
    this.binderDraft = null;
    /** @type {{type: 'cover'|'slot', index: number}|null} Target of the open card picker. */
    this.binderPickerTarget = null;
    /** @type {boolean} True while a binder write is running. */
    this.binderBusy = false;
    /** @type {number|null} Pending search debounce timer of the binder picker. */
    this.binderPickerTimer = null;
    /**
     * @type {{promoAll: boolean, sets: Set<string>, status: string, rarities: Set<string>,
     *   style: string, sort: string, direction: string}}
     *   Active filter state. `promoAll` gathers every promo group, `sets` the individually enabled
     *   extensions (an empty set means "all extensions") and `rarities` the individually enabled
     *   rarity levels (an empty set means "every rarity"): those three are multiple-choice, the rest
     *   are the single-choice controls of the popup. It is the single source of truth of the grid:
     *   the controls of the popup are the only thing that writes here, so what the popup shows is
     *   what the grid renders.
     *
     *   The DEFAULT is the collection itself: the status starts on "owned", so the grid opens on
     *   the cards the player actually has instead of the 343 silhouettes of the catalogue. Clearing
     *   the status (`resetFilters`, or the "all statuses" button) shows the whole catalogue again.
     */
    this.filters = {
      promoAll: false,
      sets: new Set(),
      status: COLLECTION_STATUS.OWNED,
      rarities: new Set(),
      style: '',
      sort: COLLECTION_SORT.FILE_INDEX,
      direction: COLLECTION_DIRECTION.ASC,
    };

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
      ['[data-collection-search]', this.searchInput],
      ['[data-collection-grid]', this.gridElement],
      ['[data-collection-filter-open]', this.filterOpenButton],
      ['[data-collection-filter-modal]', this.filterModal],
      ['[data-collection-filter-body]', this.filterBody],
      ['[data-collection-filter-close]', this.filterClose],
      ['[data-collection-binders-open]', this.bindersOpenButton],
      ['[data-collection-binders-modal]', this.bindersModal],
      ['[data-collection-binders-list]', this.bindersList],
      ['[data-collection-binder-modal]', this.binderModal],
      ['[data-collection-binder-body]', this.binderBody],
      ['[data-collection-binder-save]', this.binderSave],
      ['[data-collection-binder-picker-modal]', this.binderPickerModal],
      ['[data-collection-binder-picker-body]', this.binderPickerBody],
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
   * Rebuilds the whole body of the filter popup.
   *
   * It is rebuilt rather than toggled: the extension list is loaded with the catalog, so a new
   * extension JSON (or a promo series the player just obtained something in) must appear in the
   * popup without a page reload. Called on every data reload and on a language change.
   *
   * @returns {void}
   */
  buildFilterOptions() {
    if (!this.filterBody) return;
    const previousCount = this.filterCountElement;
    this.filterBody.textContent = '';

    this.filterBody.append(
      this.buildExtensionGroup(),
      this.buildFilterGroup({
        titleKey: 'collection.filter.status',
        name: 'status',
        value: this.filters.status,
        options: [
          { value: COLLECTION_STATUS.ALL, label: i18n.t('collection.filter.allStatuses') },
          { value: COLLECTION_STATUS.OWNED, label: i18n.t('collection.filter.statusOwned') },
          { value: COLLECTION_STATUS.MISSING, label: i18n.t('collection.filter.statusMissing') },
          { value: COLLECTION_STATUS.SELLABLE, label: i18n.t('collection.filter.statusSellable') },
        ],
      }),
      // The rarities are a MULTIPLE choice, like the extensions: a player looking for their
      // legendaries and their mythics at once should not have to look twice.
      this.buildFilterGroup({
        titleKey: 'collection.filter.rarity',
        name: 'rarity',
        multi: true,
        options: [
          { value: '', label: i18n.t('collection.filter.allRarities') },
          ...Array.from({ length: CARD_RARITY.MAX - CARD_RARITY.MIN + 1 }, (_, index) => {
            const rarity = CARD_RARITY.MIN + index;
            return { value: String(rarity), label: getRarityLabel(rarity, (key) => i18n.t(key)) };
          }),
        ],
      }),
      this.buildFilterGroup({
        titleKey: 'collection.filter.style',
        name: 'style',
        value: this.filters.style,
        options: [
          { value: '', label: i18n.t('collection.filter.allStyles') },
          { value: CARD_STYLE.CLASSIC, label: i18n.t('collection.filter.styleClassic') },
          { value: CARD_STYLE.FULL_ART, label: i18n.t('collection.filter.styleFullart') },
        ],
      }),
      this.buildFilterGroup({
        titleKey: 'collection.filter.sort',
        name: 'sort',
        value: this.filters.sort,
        options: [
          { value: COLLECTION_SORT.INDEX, label: i18n.t('collection.sort.index') },
          { value: COLLECTION_SORT.FILE_INDEX, label: i18n.t('collection.sort.fileIndex') },
          { value: COLLECTION_SORT.RARITY, label: i18n.t('collection.sort.rarity') },
          { value: COLLECTION_SORT.STYLE, label: i18n.t('collection.sort.style') },
          { value: COLLECTION_SORT.QUANTITY, label: i18n.t('collection.sort.quantity') },
          { value: COLLECTION_SORT.OBTAINED, label: i18n.t('collection.sort.obtained') },
        ],
      }),
      this.buildFilterGroup({
        titleKey: 'collection.filter.direction',
        name: 'direction',
        value: this.filters.direction,
        options: [
          { value: COLLECTION_DIRECTION.ASC, label: i18n.t('collection.sort.asc') },
          { value: COLLECTION_DIRECTION.DESC, label: i18n.t('collection.sort.desc') },
        ],
      })
    );

    // The line the popup writes the live count into: the grid is hidden behind the popup, so the
    // player has to read the effect of a toggle somewhere.
    const count = document.createElement('p');
    count.className = 'collection-filter__count';
    count.dataset.collectionFilterCount = '';
    count.setAttribute('role', 'status');
    if (previousCount) count.textContent = previousCount.textContent;
    this.filterBody.appendChild(count);
    this.filterCountElement = count;

    this.syncFilterControls();
  }

  /**
   * Builds the "Extensions" section of the popup: the "all extensions" reset, the aggregate promo
   * family and one toggle per extension (promo series included).
   *
   * @returns {HTMLElement} The section.
   */
  buildExtensionGroup() {
    const sets = Object.values(this.sets).sort((left, right) =>
      String(left.name ?? left.setId).localeCompare(String(right.name ?? right.setId))
    );
    return this.buildFilterGroup({
      titleKey: 'collection.filter.extensions',
      name: 'extensions',
      multi: true,
      options: [
        { value: '', label: i18n.t('collection.filter.allSets') },
        { value: COLLECTION_PROMO_FILTER, label: i18n.t('collection.promo') },
        ...sets
          .filter((set) => set.promo !== true)
          .map((set) => ({ value: set.setId, label: set.name ?? set.setId })),
        ...sets
          .filter((set) => set.promo === true)
          .map((set) => ({ value: set.setId, label: set.label ?? set.name ?? set.setId })),
      ],
    });
  }

  /**
   * Builds one section of the popup: a title and the row of its toggle buttons.
   *
   * @param {object} group - Section descriptor.
   * @param {string} group.titleKey - i18n key of the title.
   * @param {string} group.name - Filter name carried by every button (`data-collection-filter`).
   * @param {Array<{value: string, label: string}>} group.options - The buttons to render.
   * @param {boolean} [group.multi=false] - True for a multiple-choice section (extensions).
   * @param {string} [group.value=''] - Active value of a single-choice section.
   * @returns {HTMLElement} The section.
   */
  buildFilterGroup({ titleKey, name, options, multi = false, value = '' }) {
    const group = document.createElement('div');
    group.className = 'collection-filter__group';

    const legend = document.createElement('span');
    legend.className = 'field__label';
    legend.textContent = i18n.t(titleKey);

    const list = document.createElement('div');
    list.className = 'collection-filter__options';
    options.forEach((option) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'collection-filter__option';
      button.dataset.collectionFilter = name;
      button.dataset.collectionFilterValue = option.value;
      if (multi) button.dataset.collectionFilterMulti = 'true';
      button.textContent = option.label;
      button.setAttribute('aria-pressed', 'false');
      list.appendChild(button);
    });

    group.append(legend, list);
    return group;
  }

  /**
   * Repaints every filter control.
   *
   * The controls live in ONE place - the filter & sort popup - so a toggle can never look active
   * while the grid shows something else. The fixed lines of the bar (the active-filter count) follow
   * along.
   *
   * @returns {void}
   */
  buildSetOptions() {
    this.syncFilterControls();
  }

  /**
   * Repaints every filter control from the current state.
   *
   * @returns {void}
   */
  syncFilterControls() {
    const isActive = (name, value) => {
      switch (name) {
        case 'extensions':
          if (value === '') return !this.filters.promoAll && this.filters.sets.size === 0;
          if (value === COLLECTION_PROMO_FILTER) return this.filters.promoAll;
          return !this.filters.promoAll && this.filters.sets.has(value);
        case 'status':
          return this.filters.status === value;
        case 'rarity':
          if (value === '') return this.filters.rarities.size === 0;
          return this.filters.rarities.has(value);
        case 'style':
          return this.filters.style === value;
        case 'sort':
          return this.filters.sort === value;
        case 'direction':
          return this.filters.direction === value;
        default:
          return false;
      }
    };

    const paint = (button, name, value) => {
      const active = isActive(name, value);
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    };

    if (this.filterBody) {
      this.filterBody.querySelectorAll('[data-collection-filter]').forEach((button) => {
        paint(button, button.dataset.collectionFilter, button.dataset.collectionFilterValue ?? '');
      });
    }

    this.renderFilterSummary();
  }

  /**
   * Counts the filters that actually narrow the grid (the sort is not a filter).
   *
   * @returns {number} The number of active filters.
   */
  activeFilterCount() {
    let count = 0;
    if (this.filters.promoAll || this.filters.sets.size > 0) count += 1;
    if (this.filters.status) count += 1;
    if (this.filters.rarities.size > 0) count += 1;
    if (this.filters.style) count += 1;
    return count;
  }

  /**
   * Writes the active-filter count of the bar and its small badge.
   *
   * @returns {void}
   */
  renderFilterSummary() {
    const count = this.activeFilterCount();
    if (this.filterSummaryElement) {
      this.filterSummaryElement.textContent = i18n.t(
        count === 0 ? 'collection.filter.none' : 'collection.filter.active',
        { count }
      );
    }
    if (this.filterBadgeElement) {
      this.filterBadgeElement.hidden = count === 0;
      this.filterBadgeElement.textContent = String(count);
    }
  }

  /**
   * Applies one click on a filter control of the popup.
   *
   * @param {string} name - Filter name (`data-collection-filter`).
   * @param {string} value - Value carried by the button.
   * @returns {void}
   */
  handleFilterOption(name, value) {
    switch (name) {
      case 'extensions':
        this.applyExtensionFilter(value);
        return;
      case 'status':
        this.filters.status = value;
        break;
      case 'rarity':
        this.applyRarityFilter(value);
        return;
      case 'style':
        this.filters.style = value;
        break;
      case 'sort':
        this.filters.sort = value;
        break;
      case 'direction':
        this.filters.direction = value;
        break;
      default:
        return;
    }
    this.syncFilterControls();
    this.renderGrid();
    soundManager.playUi(UI_SOUNDS.FILTER_CHANGE);
    this.log(`Filter "${name}" set to "${value || 'all'}".`);
  }

  /**
   * Applies an extension value (every extension toggle of the popup comes through here).
   *
   * The three cases:
   *   - `''`               the "all extensions" reset;
   *   - the promo family   toggles the aggregate "Promo" filter, which clears the individual ones;
   *   - a set id           toggles that extension alone (multiple extensions can be on at once).
   * Clicking an active control clears it, so the popup never gets stuck on a single extension.
   *
   * @param {string} value - Extension value to apply.
   * @returns {void}
   */
  applyExtensionFilter(value) {
    const { filters } = this;
    if (value === '') {
      filters.promoAll = false;
      filters.sets.clear();
    } else if (value === COLLECTION_PROMO_FILTER) {
      filters.promoAll = !filters.promoAll;
      filters.sets.clear();
    } else if (filters.sets.has(value)) {
      filters.promoAll = false;
      filters.sets.delete(value);
    } else {
      filters.promoAll = false;
      filters.sets.add(value);
    }

    this.syncFilterControls();
    this.renderGrid();
    this.log(
      `Extensions: promoAll=${filters.promoAll}, sets=[${[...filters.sets].join(', ') || 'all'}].`
    );
  }

  /**
   * Applies a rarity value (every rarity toggle of the popup comes through here).
   *
   * `''` is the "all rarities" reset; any other value toggles that rarity alone, and several can be
   * on at once. Clicking an active control clears it, exactly like an extension.
   *
   * @param {string} value - Rarity value to apply (`''` for "every rarity").
   * @returns {void}
   */
  applyRarityFilter(value) {
    const { rarities } = this.filters;
    if (value === '') {
      rarities.clear();
    } else if (rarities.has(value)) {
      rarities.delete(value);
    } else {
      rarities.add(value);
    }

    this.syncFilterControls();
    this.renderGrid();
    this.log(`Rarities: [${[...rarities].join(', ') || 'all'}].`);
  }

  /**
   * Puts every filter back to its default and clears the search field.
   *
   * "Default" is the state the view opens in: the status is back on the collection itself (the
   * cards the player owns), everything else is off and the sort is the catalogue order.
   *
   * @returns {void}
   */
  resetFilters() {
    this.filters.promoAll = false;
    this.filters.sets.clear();
    this.filters.status = COLLECTION_STATUS.OWNED;
    this.filters.rarities.clear();
    this.filters.style = '';
    this.filters.sort = COLLECTION_SORT.FILE_INDEX;
    this.filters.direction = COLLECTION_DIRECTION.ASC;
    if (this.searchInput) this.searchInput.value = '';

    this.syncFilterControls();
    this.renderGrid();
    soundManager.playUi(UI_SOUNDS.FILTER_CHANGE);
    this.log('Filters reset.');
  }

  /**
   * Opens the filter & sort popup.
   *
   * @returns {void}
   */
  openFilterModal() {
    if (!this.filterModal) return;
    this.filterModal.hidden = false;
    this.filterOpenButton?.setAttribute('aria-expanded', 'true');
    this.filterClose?.focus();
    this.log('Filter popup opened.');
  }

  /**
   * Closes the filter & sort popup.
   *
   * @returns {void}
   */
  closeFilterModal() {
    if (!this.filterModal || this.filterModal.hidden) return;
    this.filterModal.hidden = true;
    this.filterOpenButton?.setAttribute('aria-expanded', 'false');
    this.log('Filter popup closed.');
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
    if (!setId) return i18n.t('common.unknown');
    return this.sets?.[setId]?.name ?? setId;
  }

  /**
   * Attaches the DOM listeners.
   *
   * @returns {void}
   */
  bindEvents() {
    this.listen(this.searchInput, 'input', () => {
      if (this.searchTimer !== null) {
        window.clearTimeout(this.searchTimer);
      }
      this.searchTimer = window.setTimeout(() => {
        this.searchTimer = null;
        this.renderGrid();
      }, 150);
    });
    // Filter & sort popup: the shell is static, the controls inside are rebuilt on every reload
    // (the extension list is dynamic), so the clicks are delegated to the body.
    this.listen(this.filterOpenButton, 'click', () => this.openFilterModal());
    this.listen(this.filterClose, 'click', () => this.closeFilterModal());
    this.listen(this.filterApply, 'click', () => this.closeFilterModal());
    this.listen(this.filterReset, 'click', () => this.resetFilters());
    this.listen(this.filterModal, 'click', (event) => {
      if (event?.target === this.filterModal) this.closeFilterModal();
    });
    this.listen(this.filterBody, 'click', (event) => {
      const button =
        event?.target instanceof Element ? event.target.closest('[data-collection-filter]') : null;
      if (button && this.filterBody.contains(button)) {
        this.handleFilterOption(
          button.dataset.collectionFilter,
          button.dataset.collectionFilterValue ?? ''
        );
      }
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
    // Binders: list, editor and card picker. Every click inside them is delegated, because the
    // list, the 30 slots and the picker grid are all rebuilt from the state.
    this.listen(this.bindersOpenButton, 'click', () => void this.openBinders());
    this.listen(this.bindersClose, 'click', () => this.closeBindersModal());
    this.listen(this.bindersModal, 'click', (event) => {
      if (event?.target === this.bindersModal) this.closeBindersModal();
    });
    this.listen(this.bindersList, 'click', (event) => {
      const target = event?.target instanceof Element ? event.target : null;
      // The creation tile: the dashed frame that closes the list (see `buildBinderCreateTile`).
      const create = target?.closest('[data-collection-binders-create]');
      if (create && this.bindersList.contains(create)) {
        void this.startCreateBinder();
        return;
      }
      // "Open": the read-only page of a binder, in a new tab.
      const view = target?.closest('[data-collection-binder-view]');
      if (view && this.bindersList.contains(view)) {
        void this.openBinderInNewTab(view.dataset.collectionBinderView);
        return;
      }
      // The share glyph is an inline `<svg>`, so the click lands on an `SVGElement` rather than on
      // the button itself: `closest()` walks up to the button either way.
      const share = target?.closest('[data-collection-binder-share]');
      if (share && this.bindersList.contains(share)) {
        void this.shareBinder(share.dataset.collectionBinderShare);
        return;
      }
      const remove = target?.closest('[data-collection-binder-remove]');
      if (remove && this.bindersList.contains(remove)) {
        void this.deleteBinder(remove.dataset.collectionBinderRemove);
        return;
      }
      const open = target?.closest('[data-collection-binder-open]');
      if (open && this.bindersList.contains(open)) {
        void this.openBinderEditor(open.dataset.collectionBinderOpen);
      }
    });
    this.listen(this.binderClose, 'click', () => this.closeBinderEditor());
    this.listen(this.binderCancel, 'click', () => this.closeBinderEditor());
    this.listen(this.binderModal, 'click', (event) => {
      if (event?.target === this.binderModal) this.closeBinderEditor();
    });
    this.listen(this.binderSave, 'click', () => void this.saveBinderDraft());
    this.listen(this.binderShare, 'click', () => void this.shareBinderDraft());
    this.listen(this.binderDelete, 'click', () => void this.deleteBinderDraft());
    this.listen(this.binderBody, 'click', (event) => {
      const target = event?.target instanceof Element ? event.target : null;
      const cover = target?.closest('[data-collection-binder-cover]');
      if (cover && this.binderBody.contains(cover)) {
        this.openBinderPicker({ type: 'cover' });
        return;
      }
      const slot = target?.closest('[data-collection-binder-slot]');
      if (slot && this.binderBody.contains(slot)) {
        this.openBinderPicker({ type: 'slot', index: Number(slot.dataset.collectionBinderSlot) });
      }
    });
    this.listen(this.binderBody, 'input', (event) => {
      const input =
        event?.target instanceof Element ? event.target.closest('[data-collection-binder-name]') : null;
      if (input && this.binderDraft) this.binderDraft.name = input.value;
    });
    this.listen(this.binderPickerSearch, 'input', () => {
      if (this.binderPickerTimer !== null) window.clearTimeout(this.binderPickerTimer);
      this.binderPickerTimer = window.setTimeout(() => {
        this.binderPickerTimer = null;
        this.renderBinderPicker();
      }, 150);
    });
    this.listen(this.binderPickerClose, 'click', () => this.closeBinderPicker());
    this.listen(this.binderPickerCancel, 'click', () => this.closeBinderPicker());
    this.listen(this.binderPickerClear, 'click', () => this.clearBinderPickerTarget());
    this.listen(this.binderPickerModal, 'click', (event) => {
      if (event?.target === this.binderPickerModal) this.closeBinderPicker();
    });
    this.listen(this.binderPickerBody, 'click', (event) => {
      const tile =
        event?.target instanceof Element
          ? event.target.closest('[data-collection-binder-pick]')
          : null;
      if (tile && this.binderPickerBody.contains(tile)) {
        this.pickBinderCard(tile.dataset.collectionBinderPick);
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
      const closest = (selector) =>
        event?.target instanceof Element ? event.target.closest(selector) : null;
      const toggle = closest('[data-card-effects]');
      if (toggle && this.modalBody?.contains(toggle)) {
        this.toggleShine();
        return;
      }
      const copy = closest('[data-collection-dev-copy]');
      if (copy && this.modalBody?.contains(copy)) {
        void this.copyDetailKey();
      }
    });
    this.listen(document, 'keydown', (event) => this.handleDocumentKeyDown(event));
    this.log('DOM listeners bound.');
  }

  /**
   * Handles the keyboard shortcuts: Escape closes the topmost popup, and the open card can be
   * sold (`S` / `V`, `Shift` for every duplicate), bought (`B` / `A`) or pinned (`P` / `F`).
   *
   * The keys mirror the buttons of the detail modal, they never replace them: the same guards
   * apply (`handleSell`, `handleBuy` and `toggleFavorite` own the economy rules).
   *
   * @param {KeyboardEvent} event - Key event.
   * @returns {void}
   */
  handleDocumentKeyDown(event) {
    if (!event || typeof event.key !== 'string') return;
    if (event.key === 'Escape') {
      // The popups stack: the card picker sits on the editor, which sits on the binder list, which
      // sits on the filter popup, which sits on the card detail. Escape closes the topmost one only.
      if (this.binderPickerModal && !this.binderPickerModal.hidden) {
        this.closeBinderPicker();
        return;
      }
      if (this.binderModal && !this.binderModal.hidden) {
        this.closeBinderEditor();
        return;
      }
      if (this.bindersModal && !this.bindersModal.hidden) {
        this.closeBindersModal();
        return;
      }
      if (this.filterModal && !this.filterModal.hidden) {
        this.closeFilterModal();
        return;
      }
      if (this.modal && !this.modal.hidden) {
        this.closeDetail();
      }
      return;
    }

    if (!this.isActive || !this.modal || this.modal.hidden || !this.detailKey) return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
    if (this.isPopupAboveDetail()) return;
    const target = event.target;
    if (target instanceof HTMLElement
      && target.closest('input, textarea, select, [contenteditable="true"]')) {
      return;
    }

    const entry = this.entries.find((candidate) => candidate.key === this.detailKey);
    if (!entry) return;
    const key = event.key.toLowerCase();
    const quantity = entry.owned && Number.isFinite(entry.quantity) ? entry.quantity : 0;

    if ((key === 's' || key === 'v') && quantity >= 2) {
      event.preventDefault();
      // Shift sells every duplicate, exactly like the second button of the modal (which keeps
      // the last copy of the card).
      void this.handleSell(entry, event.shiftKey ? quantity - 1 : 1);
      return;
    }
    if ((key === 'b' || key === 'a') && entry.card && !entry.promo) {
      event.preventDefault();
      void this.handleBuy(entry);
      return;
    }
    if ((key === 'p' || key === 'f') && entry.owned) {
      event.preventDefault();
      void this.toggleFavorite(entry.key);
    }
  }

  /**
   * Tells whether a popup is stacked over the card detail (its shortcuts must not fire then).
   *
   * @returns {boolean} True when the filter, the binders or the binder editor is open.
   */
  isPopupAboveDetail() {
    return [this.filterModal, this.bindersModal, this.binderModal, this.binderPickerModal]
      .some((modal) => modal && !modal.hidden);
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
   * Builds the share icon of a binder row.
   *
   * The project ships no share asset (unlike the pin of a trophy), so the glyph is drawn node by
   * node like the heart of a favourite - never through `innerHTML` - and inherits `currentColor`,
   * so the hover colour of its button is enough to paint it.
   *
   * @returns {SVGElement} The icon.
   */
  static buildShareIcon() {
    const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    // A link leaving a page: the arrow of a share, over the box it comes from.
    const box = document.createElementNS(SVG_NAMESPACE, 'path');
    box.setAttribute('d', 'M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5');
    svg.appendChild(box);
    return svg;
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
      // A full list that still has a slot for sale turns the refusal into the purchase offer, then
      // retries the very heart the player touched once the slot is owned.
      if (error?.code === PROFILE_ERROR_CODES.FAVORITES_FULL) {
        const opened = await slotPurchaseModal.open({
          kind: PROFILE_SLOT_KINDS.FAVORITES,
          onPurchased: () => void this.toggleFavorite(key),
        }).catch(() => false);
        if (opened) return;
      }
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
   * The state owns everything but the search field, which is read from the input on every render
   * (it is the one control that does not need to survive a rebuild of the popup).
   *
   * @returns {object} The active filters, search included.
   */
  readFilters() {
    return {
      ...this.filters,
      search: (this.searchInput?.value ?? '').trim().toLowerCase(),
    };
  }

  /**
   * Reads the timestamp a card entered the collection.
   *
   * @param {object} entry - Collection entry.
   * @returns {number|null} The epoch milliseconds of the first copy, or null when the card is not
   *   owned (or when a very old save recorded no date).
   */
  static obtainedTime(entry) {
    if (!entry?.owned || !entry.firstObtainedAt) return null;
    const time = Date.parse(entry.firstObtainedAt);
    return Number.isFinite(time) ? time : null;
  }

  /**
   * Applies the active filters to the loaded entries.
   *
   * An extension is kept when it is one of the enabled ones; `promoAll` gathers every promo group
   * instead and wins over the individual extensions (the two are exclusive by construction).
   *
   * @param {object} filters - Active filters from `readFilters()`.
   * @returns {object[]} The matching entries, in the requested order.
   */
  applyFilters(filters) {
    const lang = i18n.getLang();
    const kept = this.entries.filter((entry) => {
      // The aggregate promo family is not a set id: it matches the family instead of a group.
      if (filters.promoAll) {
        if (!entry.promo) return false;
      } else if (filters.sets.size > 0 && !filters.sets.has(entry.set)) {
        return false;
      }
      if (filters.rarities.size > 0 && !filters.rarities.has(String(entry.rarity ?? ''))) return false;
      if (filters.style && entry.style !== filters.style) return false;
      if (filters.status === COLLECTION_STATUS.OWNED && !entry.owned) return false;
      if (filters.status === COLLECTION_STATUS.MISSING && entry.owned) return false;
      // "Sellable" is the trade view of a card: the first copy is the collection, only the
      // duplicates can go, so it takes two.
      if (filters.status === COLLECTION_STATUS.SELLABLE && !(entry.owned && entry.quantity >= 2)) {
        return false;
      }
      if (filters.search) {
        const name = (entry.card?.getName(lang) ?? entry.cardId ?? '').toLowerCase();
        if (!name.includes(filters.search)) return false;
      }
      return true;
    });

    const direction = filters.direction === COLLECTION_DIRECTION.DESC ? -1 : 1;
    const nameOf = (entry) => entry.card?.getName(lang) ?? entry.cardId ?? '';
    const comparator = (left, right) => {
      switch (filters.sort) {
        case COLLECTION_SORT.RARITY:
          if ((left.rarity ?? 0) !== (right.rarity ?? 0)) {
            return ((left.rarity ?? 0) - (right.rarity ?? 0)) * direction;
          }
          break;
        case COLLECTION_SORT.STYLE:
          if (left.style !== right.style) {
            return String(left.style).localeCompare(String(right.style)) * direction;
          }
          break;
        case COLLECTION_SORT.QUANTITY:
          if ((left.quantity ?? 0) !== (right.quantity ?? 0)) {
            return ((left.quantity ?? 0) - (right.quantity ?? 0)) * direction;
          }
          break;
        case COLLECTION_SORT.OBTAINED: {
          const leftTime = CollectionView.obtainedTime(left);
          const rightTime = CollectionView.obtainedTime(right);
          // A card the player does not own goes after the owned ones whatever the direction is.
          if (leftTime === null || rightTime === null) {
            if (leftTime === rightTime) break;
            return leftTime === null ? 1 : -1;
          }
          if (leftTime !== rightTime) return (leftTime - rightTime) * direction;
          break;
        }
        case COLLECTION_SORT.FILE_INDEX:
          // The order of the extension FILE, `entry.index`: the grid follows the JSON exactly as it
          // was authored, extension by extension. Not to be confused with the card NUMBER below.
          if (left.set !== right.set) {
            return String(left.set).localeCompare(String(right.set)) * direction;
          }
          // Compared as NUMBERS and not as strings: entry 10 comes after entry 9, whatever the
          // padding of the file happens to be.
          if ((left.index ?? 0) !== (right.index ?? 0)) {
            return ((left.index ?? 0) - (right.index ?? 0)) * direction;
          }
          break;
        default:
          // The card number ("SERIE-A1 / W001"). `numeric` is what sorts W2 before W10 instead of
          // putting it after W0010: the ids carry their padding sometimes and not always.
          if (left.set !== right.set) {
            return String(left.set).localeCompare(String(right.set)) * direction;
          }
          if (left.cardId !== right.cardId) {
            return String(left.cardId).localeCompare(String(right.cardId), undefined, {
              numeric: true,
            }) * direction;
          }
      }
      // Every sort falls back on the name, in the SAME direction the sorting axis runs, so a
      // descending list does not end up with its names in ascending order.
      return nameOf(left).localeCompare(nameOf(right), undefined, { numeric: true }) * direction;
    };

    return kept.sort(comparator);
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
    // The popup hides the grid, so it repeats the count: a toggle must show its effect right there.
    if (this.filterCountElement) {
      this.filterCountElement.textContent = i18n.t('collection.count', { shown: shown.length });
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
      entry.owned ? name : `${name} (${i18n.t('collection.missing')})`
    );
    // Only an OWNED card carries the halo of its rarity: a missing one is a grey silhouette, and
    // glowing it would announce a card the player does not have.
    if (entry.owned && entry.card) applyCardGlow(tile, entry.card);

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
    this.detailKey = key;
    // Read on every opening rather than cached at boot: the switch lives in the settings, which is
    // another screen, and the modal must follow it without a reload.
    this.devMode = await this.readDevMode();

    if (card) {
      this.modalBody.appendChild(this.buildDetailArtwork(card, name, key));
      // "Under the card", as the operator asked: the tool of the developer mode sits directly
      // below the illustration, before the printable details.
      if (this.devMode) {
        this.modalBody.appendChild(this.buildDevKeyBlock(entry));
      }
      if (getShineClasses(card).length > 0) {
        this.modalBody.appendChild(this.buildShineToggle());
      }
    } else if (this.devMode) {
      // An orphan row has no illustration but still has a key worth copying.
      this.modalBody.appendChild(this.buildDevKeyBlock(entry));
    }

    const list = document.createElement('dl');
    list.className = 'card-modal__details';
    const rarityValue = entry.rarity ?? card?.rarity ?? null;
    const rows = [
      [i18n.t('opening.card.name'), name],
      // The index is the reference printed in the JSON of the set: what a player quotes when they
      // talk about a card, and what the `cards/` tree is named after.
      [i18n.t('opening.card.index'), card?.index || entry.cardId || entry.key],
      [i18n.t('opening.card.rarity'),
        rarityValue === null
          ? i18n.t('common.unknown')
          : getRarityLabel(rarityValue, (key) => i18n.t(key))],
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
    image.alt = `${name} (${getRarityLabel(card.rarity, (labelKey) => i18n.t(labelKey))})`;
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
    attachCardTilt(art);

    // `applyShine` adds the classes of the rarity AND the sweeping line (`card-shine__gleam`),
    // which is a layer of its own so the "Brillance" slider can scale it alone.
    applyShine(art, card);
    applyCardGlow(art, card);
    art.classList.toggle('is-off', !this.shineEnabled);
    this.shineWindow = art;
    return art;
  }

  /**
   * Builds the switch turning every effect of the large card on and off.
   *
   * @returns {HTMLElement} The row, label and switch together.
   */
  buildShineToggle() {
    return buildCardEffectsToggle(this.shineEnabled);
  }

  /**
   * Switches every effect of the open detail on or off.
   *
   * The choice is kept on the view, so opening another card keeps it for the session; it is not a
   * stored preference, since it is a reading comfort, not a game setting. Only the window is touched
   * - never the artwork - and the switch is rewritten by the shared component.
   *
   * @returns {void}
   */
  toggleShine() {
    this.shineEnabled = !this.shineEnabled;
    this.shineWindow?.classList.toggle('is-off', !this.shineEnabled);
    syncCardEffectsToggle(this.modalBody, this.shineEnabled);
    this.log(`Card effects ${this.shineEnabled ? 'enabled' : 'disabled'}.`);
  }

  /**
   * Tells whether the developer mode is on for the current account.
   *
   * A read failure is not fatal: the mode simply stays off, so a broken settings store can never
   * keep a player out of the collection.
   *
   * @returns {Promise<boolean>} True when `settings.devMode` is on.
   */
  async readDevMode() {
    try {
      const settings = await accountManager.getSettings();
      return settings.devMode === true;
    } catch (error) {
      console.warn('[CollectionView] The developer mode could not be read.', error);
      return false;
    }
  }

  /**
   * Builds the developer block of the detail modal: the key of the card and a button copying it.
   *
   * The key is the string the `collection` store is keyed on (`<id>_<style>`), which is also the
   * illustration file name without its extension and its folder: the one value an operator needs to
   * find a card in a save, an export, a log or the `cards/` tree.
   *
   * @param {object} entry - Collection entry being displayed.
   * @returns {HTMLElement} The block holding the key and the copy button.
   */
  buildDevKeyBlock(entry) {
    const wrapper = document.createElement('div');
    wrapper.className = 'collection-dev';

    const key = document.createElement('code');
    key.className = 'collection-dev__key';
    key.textContent = entry.key;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn--ghost collection-dev__copy';
    button.dataset.collectionDevCopy = 'copy';
    button.textContent = i18n.t('collection.dev.copy');

    wrapper.append(key, button);
    return wrapper;
  }

  /**
   * Copies the key of the open card to the clipboard.
   *
   * @returns {Promise<void>} Resolves once the copy attempt finished.
   */
  async copyDetailKey() {
    if (!this.detailKey) return;
    try {
      await writeToClipboard(this.detailKey);
      Toast.success('collection.dev.copied');
      this.log(`Key copied: "${this.detailKey}".`);
    } catch (error) {
      console.error('[CollectionView] The card key could not be copied.', error);
      Toast.error('collection.dev.copyError');
    }
  }

  /**
   * Builds the note explaining why a promo card has no trade button.
   *
   * The rule is enforced inside `SparksManager`; saying it in the modal is what turns a missing
   * button into an understood one.
   *
   * @returns {HTMLElement} The note.
   */
  buildPromoLockNote() {
    const note = document.createElement('p');
    note.className = 'collection-trade__locked';
    note.textContent = i18n.t('collection.trade.promoLocked');
    return note;
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
   * A promo card is NOT part of the economy at all (it is neither sellable nor buyable): it gets
   * the explanation note instead of the buttons, and `SparksManager` would refuse the trade anyway.
   *
   * @param {object} entry - Collection entry.
   * @returns {Promise<HTMLElement|null>} The block, or null when the rarity/economy is unavailable.
   */
  async buildTradeActions(entry) {
    // A promo card is out of the economy entirely: no wallet, no price, no button.
    if (entry.promo) return this.buildPromoLockNote();

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
      // Selling is the one event that can invalidate a binder: a page may now show more copies of
      // that card than the player owns. The far placements of every page are dropped here.
      try {
        await binderManager.reconcile();
      } catch (error) {
        console.warn('[CollectionView] The binders could not be repaired after the sale.', error);
      }
      await this.reload();
      await this.openDetail(entry.key);
    } catch (error) {
      if (error?.code === PROMO_PROTECTED) {
        Toast.error('collection.error.promo');
      } else if (error?.code === 'LAST_COPY_PROTECTED') {
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
      if (error?.code === PROMO_PROTECTED) {
        Toast.error('collection.error.promo');
      } else if (error?.code === 'INSUFFICIENT_SPARKS') {
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
  /**
   * Indexes the loaded entries by collection key (the binders show cards by key).
   *
   * @returns {Map<string, object>} Key to collection entry.
   */
  entriesByKey() {
    return new Map(this.entries.map((entry) => [entry.key, entry]));
  }

  /**
   * Opens the binder list.
   *
   * Public entry point of the binder counter of the header (`js/app.js`), which switches to this
   * view before calling it: the list, the editor and the card picker all live in the markup of the
   * collection. The pages are reconciled first: a sale (or an imported save) may have left one of
   * them showing more copies of a card than the player still owns, and the list is the natural
   * repair point.
   *
   * @returns {Promise<void>} Resolves once the list is displayed (or the error reported).
   */
  async openBinders() {
    if (!this.bindersModal) return;
    try {
      await binderManager.reconcile();
      this.binders = await binderManager.listBinders();
    } catch (error) {
      console.error('[CollectionView] The binders could not be read.', error);
      Toast.error('binders.error.load');
      return;
    }

    await this.renderBindersList();
    this.bindersModal.hidden = false;
    this.bindersOpenButton?.setAttribute('aria-expanded', 'true');
    this.bindersClose?.focus();
    this.log(`${this.binders.length} binder(s) listed.`);
  }

  /**
   * Closes the binder list.
   *
   * @returns {void}
   */
  closeBindersModal() {
    if (!this.bindersModal || this.bindersModal.hidden) return;
    this.bindersModal.hidden = true;
    this.bindersOpenButton?.setAttribute('aria-expanded', 'false');
    this.log('Binder list closed.');
  }

  /**
   * Renders the list of binders and its counter (`n / allowance, +1 at level X`).
   *
   * @returns {Promise<void>} Resolves once the list is painted.
   */
  async renderBindersList() {
    if (!this.bindersList) return;
    let limit = Math.max(1, this.binders.length);
    // Before the configuration answers, the shipped interval keeps the announced level plausible.
    // A level that cannot be read at all leaves the list usable rather than blank.
    let nextLevel = limit * DEFAULT_BINDER_SETTINGS.unlockEveryLevels;
    try {
      const progress = await binderManager.getProgress();
      limit = progress.limit;
      nextLevel = progress.nextLevel;
    } catch (error) {
      console.warn('[CollectionView] The binder allowance could not be read.', error);
    }

    const byKey = this.entriesByKey();
    this.bindersList.textContent = '';
    this.binders.forEach((binder) => {
      this.bindersList.appendChild(this.buildBinderRow(binder, byKey));
    });
    // The tile that creates one: the LAST LINE of the list, shaped like the pages above it. It is
    // shown even when the level cap is reached - a player who cannot create a binder today still has
    // to see where one is created tomorrow - but it is then disabled, and its tooltip says why.
    this.bindersList.appendChild(this.buildBinderCreateTile(this.binders.length < limit));

    if (this.bindersSummary) {
      this.bindersSummary.textContent = i18n.t('binders.summary', {
        count: this.binders.length,
        max: limit,
        level: nextLevel,
      });
    }
    if (this.bindersEmpty) this.bindersEmpty.hidden = this.binders.length > 0;
  }

  /**
   * Builds one row of the binder list: its cover, its name, its fill and its delete button.
   *
   * The backdrop of the row is the `Background` image of the representative card: it is what makes
   * a binder look like the card it is built around.
   *
   * @param {object} binder - Normalized binder.
   * @param {Map<string, object>} byKey - Entries indexed by collection key.
   * @returns {HTMLLIElement} The row.
   */
  buildBinderRow(binder, byKey) {
    const item = document.createElement('li');
    item.className = 'binders__item';

    const cover = binder.cover ? byKey.get(binder.cover) : null;
    if (cover?.card?.background) {
      item.style.setProperty('--binder-backdrop', `url("${cover.card.background}")`);
    }

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'binders__open';
    open.dataset.collectionBinderOpen = binder.id;

    const thumb = document.createElement('span');
    thumb.className = 'binders__thumb';
    if (cover?.card) {
      const image = document.createElement('img');
      image.className = 'binders__thumb-image';
      image.src = i18n.resolveImagePath(cover.card.illustration);
      image.alt = '';
      image.loading = 'lazy';
      thumb.appendChild(image);
      applyCardGlow(thumb, cover.card);
    }

    const name = document.createElement('span');
    name.className = 'binders__name';
    name.textContent = binder.name === '' ? i18n.t('binders.untitled') : binder.name;

    const filled = document.createElement('span');
    filled.className = 'binders__count';
    filled.textContent = i18n.t('binders.filled', {
      filled: binder.slots.filter(Boolean).length,
      total: BINDER_SLOT_COUNT,
    });

    open.append(thumb, name, filled);

    // The actions of the row: LOOK at the page in a new tab, share it as a link, or delete it. They
    // sit NEXT to each other, so a binder is shown without opening its editor first.
    const actions = document.createElement('div');
    actions.className = 'binders__actions';

    // "Open" is a NAMED button rather than a third glyph: it is not the same gesture as the share
    // one (nothing is copied here, the page is simply put on screen), and two arrows would say
    // neither. It opens the read-only page of the binder (`collection.html?code=…`) in a new tab.
    const view = document.createElement('button');
    view.type = 'button';
    view.className = 'btn btn--ghost btn--small binders__view';
    view.dataset.collectionBinderView = binder.id;
    view.textContent = i18n.t('binders.open');
    view.setAttribute('aria-label', i18n.t('binders.openAria', { name: binder.name }));
    view.title = i18n.t('binders.openAria', { name: binder.name });

    const share = document.createElement('button');
    share.type = 'button';
    share.className = 'binders__share';
    share.dataset.collectionBinderShare = binder.id;
    share.appendChild(CollectionView.buildShareIcon());
    share.setAttribute('aria-label', i18n.t('binders.shareAria', { name: binder.name }));
    share.title = i18n.t('binders.share');

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'binders__remove';
    remove.dataset.collectionBinderRemove = binder.id;
    remove.textContent = '×';
    remove.setAttribute('aria-label', i18n.t('binders.deleteAria', { name: binder.name }));

    actions.append(view, share, remove);
    item.append(open, actions);
    return item;
  }

  /**
   * Builds the tile that creates a binder: the last line of the list.
   *
   * It wears the SHAPE of the rows above it (same width, same radius, and the height of a row) but
   * its border is dashed and it carries a big "+": the list ends on "one more page", not on a form
   * button. Clicking it opens the creation form (`startCreateBinder`).
   *
   * @param {boolean} [canCreate=true] - False when the player already owns as many binders as their
   *   level allows: the tile is then disabled, and its tooltip says so.
   * @returns {HTMLLIElement} The tile.
   */
  buildBinderCreateTile(canCreate = true) {
    const item = document.createElement('li');
    item.className = 'binders__create';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'binders__create-button';
    button.dataset.collectionBindersCreate = '';
    button.textContent = '+';
    button.disabled = !canCreate;
    button.setAttribute('aria-label', i18n.t('binders.create'));
    button.title = canCreate ? i18n.t('binders.create') : i18n.t('binders.error.limit');

    item.appendChild(button);
    return item;
  }

  /**
   * Opens the read-only page of a binder in a NEW tab.
   *
   * The tab is opened BEFORE the code is built, straight from the click: a browser refuses a
   * `window.open()` that happens after an `await`, so the blank tab is claimed while the gesture is
   * still the one being handled and is pointed at the page once the code exists. Nothing is written
   * to the clipboard - "Open" and "Share" are two different intents.
   *
   * @param {object|string} binder - Stored binder, or the id of one.
   * @returns {Promise<void>} Resolves once the tab was pointed at the page (or the error reported).
   */
  async openBinderInNewTab(binder) {
    // The tab is claimed FIRST, before anything is awaited: a browser refuses a `window.open()` that
    // happens after an `await`, and reading a binder is asynchronous by nature. A blank tab is
    // therefore opened while the click is still being handled, then pointed at the page.
    const tab = window.open('about:blank', '_blank');
    if (!tab) {
      Toast.error('binders.error.open');
      return;
    }

    try {
      const target =
        typeof binder === 'string'
          ? (await binderManager.listBinders()).find((item) => item.id === binder) ?? null
          : binder;
      if (!target) {
        tab.close();
        return;
      }
      if (String(target.name ?? '').trim() === '') {
        tab.close();
        this.reportBinderShareError('binders.error.name');
        return;
      }

      const profile = await profileManager.getProfile();
      const code = await binderManager.encodeShare(target, {
        name: profile.name,
        icon: profile.icon,
        photo: profile.photo,
      });
      tab.location.href = BinderManager.buildShareUrl(code);
      this.log(`Binder "${target.name}" opened in a new tab.`);
    } catch (error) {
      console.error('[CollectionView] The binder could not be opened in a new tab.', error);
      tab.close();
      this.reportBinderShareError('binders.error.open');
    }
  }

  /**
   * Opens the editor on a brand-new, empty draft.
   *
   * @returns {Promise<void>} Resolves once the editor is displayed.
   */
  async startCreateBinder() {
    if (this.binderBusy) return;
    this.binderDraft = {
      id: null,
      name: '',
      cover: null,
      slots: new Array(BINDER_SLOT_COUNT).fill(null),
    };
    this.renderBinderEditor();
    this.binderModal.hidden = false;
    this.binderBody?.querySelector('[data-collection-binder-name]')?.focus();
    this.log('New binder draft opened.');
  }

  /**
   * Opens the editor on an existing binder.
   *
   * @param {string} id - Binder id.
   * @returns {Promise<void>} Resolves once the editor is displayed (or the error reported).
   */
  async openBinderEditor(id) {
    if (this.binderBusy) return;
    let binder = this.binders.find((candidate) => candidate.id === id) ?? null;
    if (!binder) {
      try {
        binder = await binderManager.getBinder(id);
      } catch (error) {
        console.error('[CollectionView] The binder could not be read.', error);
      }
    }
    if (!binder) {
      Toast.error('binders.error.load');
      return;
    }

    this.binderDraft = {
      id: binder.id,
      name: binder.name,
      cover: binder.cover,
      slots: binder.slots.slice(),
    };
    this.renderBinderEditor();
    this.binderModal.hidden = false;
    this.binderBody?.querySelector('[data-collection-binder-name]')?.focus();
    this.log(`Binder "${binder.name}" opened in the editor.`);
  }

  /**
   * Closes the editor and throws the draft away.
   *
   * @returns {void}
   */
  closeBinderEditor() {
    if (!this.binderModal || this.binderModal.hidden) return;
    this.closeBinderPicker();
    this.binderModal.hidden = true;
    this.binderDraft = null;
    this.log('Binder editor closed.');
  }

  /**
   * Renders the editor: the name, the representative card and the 30 clickable slots.
   *
   * @returns {void}
   */
  renderBinderEditor() {
    const draft = this.binderDraft;
    if (!draft || !this.binderBody) return;
    const byKey = this.entriesByKey();

    if (this.binderTitle) {
      this.binderTitle.textContent = i18n.t(draft.id ? 'binders.editTitle' : 'binders.createTitle');
    }
    if (this.binderDelete) this.binderDelete.hidden = draft.id === null;

    this.binderBody.textContent = '';

    const nameField = document.createElement('label');
    nameField.className = 'field binder-editor__field';
    const nameLabel = document.createElement('span');
    nameLabel.className = 'field__label';
    nameLabel.textContent = i18n.t('binders.name');
    const nameInput = document.createElement('input');
    nameInput.className = 'field__input';
    nameInput.type = 'text';
    nameInput.maxLength = BINDER_NAME_MAX_LENGTH;
    nameInput.value = draft.name;
    nameInput.placeholder = i18n.t('binders.namePlaceholder');
    nameInput.dataset.collectionBinderName = '';
    nameField.append(nameLabel, nameInput);

    const coverField = document.createElement('div');
    coverField.className = 'binder-editor__cover';
    const coverLabel = document.createElement('span');
    coverLabel.className = 'field__label';
    coverLabel.textContent = i18n.t('binders.cover');
    const coverButton = document.createElement('button');
    coverButton.type = 'button';
    coverButton.className = 'binder-editor__cover-button';
    coverButton.dataset.collectionBinderCover = '';
    const cover = draft.cover ? byKey.get(draft.cover) : null;
    if (cover?.card) {
      const image = document.createElement('img');
      image.className = 'binder-editor__cover-image';
      image.src = i18n.resolveImagePath(cover.card.illustration);
      image.alt = '';
      const text = document.createElement('span');
      text.textContent = cover.card.getName(i18n.getLang());
      coverButton.append(image, text);
    } else {
      coverButton.textContent = i18n.t('binders.coverChoose');
    }
    coverField.append(coverLabel, coverButton);

    // The page itself: the slots on a backdrop taken from the `Background` of the cover card, which
    // is what makes a binder look like the card it is built around.
    const page = document.createElement('div');
    page.className = 'binder-page';
    if (cover?.card?.background) {
      page.style.setProperty('--binder-backdrop', `url("${cover.card.background}")`);
    }

    const slotsLabel = document.createElement('span');
    slotsLabel.className = 'field__label';
    slotsLabel.textContent = i18n.t('binders.slots', { count: BINDER_SLOT_COUNT });
    const grid = document.createElement('ul');
    grid.className = 'binder-slots';
    draft.slots.forEach((key, index) => {
      const slot = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'binder-slot';
      button.dataset.collectionBinderSlot = String(index);
      const entry = key ? byKey.get(key) : null;
      button.setAttribute(
        'aria-label',
        entry?.card
          ? `${index + 1}. ${entry.card.getName(i18n.getLang())}`
          : i18n.t('binders.slotEmpty', { index: index + 1 })
      );
      if (entry?.card) {
        const image = document.createElement('img');
        image.className = 'binder-slot__image';
        image.src = i18n.resolveImagePath(entry.card.illustration);
        image.alt = '';
        image.loading = 'lazy';
        button.appendChild(image);
        button.classList.add('is-filled');
        // The foil and the brillance of the high rarities are painted on the slot itself: a binder
        // shows the very printings of the collection, not a flat thumbnail of them.
        applyShine(button, entry.card);
        applyCardGlow(button, entry.card);
        button.classList.add(`binder-slot--r${entry.card.rarity}`);
      } else {
        const mark = document.createElement('span');
        mark.className = 'binder-slot__mark';
        mark.textContent = '+';
        button.appendChild(mark);
      }
      slot.appendChild(button);
      grid.appendChild(slot);
    });

    page.append(slotsLabel, grid);
    this.binderBody.append(nameField, coverField, page);
    this.setBinderFeedback(null);
  }

  /**
   * Saves the draft (creates the binder, or replaces it) and repaints both popups.
   *
   * @returns {Promise<void>} Resolves once the write finished (or the error reported).
   */
  async saveBinderDraft() {
    const draft = this.binderDraft;
    if (!draft || this.binderBusy) return;
    this.binderBusy = true;
    this.setBinderFeedback(null);
    try {
      const saved = await binderManager.upsertBinder(draft);
      this.binders = await binderManager.listBinders();
      this.binderDraft = {
        id: saved.id,
        name: saved.name,
        cover: saved.cover,
        slots: saved.slots.slice(),
      };
      Toast.success(draft.id === null ? 'binders.created' : 'binders.saved');
      await this.renderBindersList();
      this.renderBinderEditor();
      this.log(`Binder "${saved.name}" saved.`);
    } catch (error) {
      this.reportBinderError(error);
    } finally {
      this.binderBusy = false;
    }
  }

  /**
   * Copies the share link of the draft to the clipboard.
   *
   * The code is self-contained (author, name and the master data of the cards), so the page it
   * opens renders without the local account or database.
   *
   * @returns {Promise<void>} Resolves once the link is copied (or the error reported).
   */
  async shareBinderDraft() {
    const draft = this.binderDraft;
    if (!draft) return;
    if (draft.name.trim() === '') {
      this.setBinderFeedback('binders.error.name', 'error');
      return;
    }
    await this.shareBinder(draft);
  }

  /**
   * Copies the share link of a binder to the clipboard.
   *
   * Accepts a stored binder (the share button of the list) or the draft of the editor: the draft is
   * already the same shape, so both callers share one path and one error handling. A failure is
   * reported where the caller can read it - the feedback line of the editor, or a toast for the
   * list, which has no feedback line of its own.
   *
   * @param {object|string} binder - Stored binder, draft, or the id of a stored one.
   * @returns {Promise<void>} Resolves once the link is copied (or the error reported).
   */
  async shareBinder(binder) {
    try {
      const target =
        typeof binder === 'string'
          ? (await binderManager.listBinders()).find((item) => item.id === binder) ?? null
          : binder;
      if (!target) return;
      if (String(target.name ?? '').trim() === '') {
        this.reportBinderShareError('binders.error.name');
        return;
      }

      const profile = await profileManager.getProfile();
      const code = await binderManager.encodeShare(target, {
        name: profile.name,
        icon: profile.icon,
        // The avatar of an older save is a URL of its own: it travels with the code too, so the
        // read-only page can show a picture of an author who never chose one of the icons.
        photo: profile.photo,
      });
      await writeToClipboard(BinderManager.buildShareUrl(code));
      Toast.success('binders.shared');
      this.setBinderFeedback('binders.sharedHelp', 'info');
      this.log(`Binder share link copied (${code.length} characters of code).`);
    } catch (error) {
      console.error('[CollectionView] The binder share link could not be built.', error);
      this.reportBinderShareError('binders.error.share');
    }
  }

  /**
   * Reports a share failure in whichever place is on screen.
   *
   * @param {string} key - Translation key of the message.
   * @returns {void}
   */
  reportBinderShareError(key) {
    if (this.binderModal && !this.binderModal.hidden) {
      this.setBinderFeedback(key, 'error');
      return;
    }
    Toast.error(key);
  }

  /**
   * Deletes the binder currently open in the editor.
   *
   * @returns {Promise<void>} Resolves once the deletion finished.
   */
  async deleteBinderDraft() {
    if (!this.binderDraft?.id) return;
    await this.deleteBinder(this.binderDraft.id, { closeEditor: true });
  }

  /**
   * Deletes a binder (from the list or from the editor).
   *
   * @param {string} id - Binder id.
   * @param {object} [options] - Deletion options.
   * @param {boolean} [options.closeEditor=false] - Also close the editor when it shows that binder.
   * @returns {Promise<void>} Resolves once the deletion finished (or the error reported).
   */
  async deleteBinder(id, { closeEditor = false } = {}) {
    if (this.binderBusy) return;
    this.binderBusy = true;
    try {
      this.binders = await binderManager.deleteBinder(id);
      if (closeEditor && this.binderDraft?.id === id) {
        this.binderModal.hidden = true;
        this.binderDraft = null;
      }
      Toast.success('binders.deleted');
      await this.renderBindersList();
      this.log(`Binder "${id}" deleted.`);
    } catch (error) {
      console.error('[CollectionView] The binder could not be deleted.', error);
      Toast.error('binders.error.delete');
    } finally {
      this.binderBusy = false;
    }
  }

  /**
   * Opens the card picker on the cover or on one slot.
   *
   * @param {{type: 'cover'|'slot', index?: number}} target - What the picker fills.
   * @returns {void}
   */
  openBinderPicker(target) {
    if (!this.binderDraft) return;
    this.binderPickerTarget = target;
    if (this.binderPickerSearch) this.binderPickerSearch.value = '';
    if (this.binderPickerTitle) {
      this.binderPickerTitle.textContent =
        target.type === 'cover'
          ? i18n.t('binders.pickCover')
          : i18n.t('binders.pickSlot', { index: (target.index ?? 0) + 1 });
    }
    // The cover may stay empty (a plain binder), a slot may not: "no card" IS the empty slot.
    if (this.binderPickerClear) this.binderPickerClear.hidden = target.type === 'cover';
    this.renderBinderPicker();
    this.binderPickerModal.hidden = false;
    this.log(`Picker opened for ${target.type}${target.type === 'slot' ? ` ${target.index}` : ''}.`);
  }

  /**
   * Closes the card picker.
   *
   * @returns {void}
   */
  closeBinderPicker() {
    if (!this.binderPickerModal || this.binderPickerModal.hidden) return;
    this.binderPickerModal.hidden = true;
    this.binderPickerTarget = null;
  }

  /**
   * Renders the owned cards the picker can place.
   *
   * A card is disabled when the draft already shows as many copies of it as the player owns: the
   * page may not promise more copies than the collection holds. The card already in the target
   * slot is always selectable (it holds its own copy).
   *
   * Picking a COVER is a different gesture: the representative card does not fill a slot, it only
   * lends its `Background` to the page, so it is exempt from that budget - every owned card stays
   * selectable there however many times the page already shows it (the manager never counts the
   * cover either, see `BinderManager.validateSlots`).
   *
   * @returns {void}
   */
  renderBinderPicker() {
    const draft = this.binderDraft;
    const target = this.binderPickerTarget;
    if (!this.binderPickerBody || !draft || !target) return;

    const lang = i18n.getLang();
    const search = (this.binderPickerSearch?.value ?? '').trim().toLowerCase();
    const placements = BinderManager.countPlacements(draft.slots);
    const currentKey = target.type === 'cover' ? draft.cover : draft.slots[target.index ?? -1];

    this.binderPickerBody.textContent = '';
    let shown = 0;

    this.entries
      .filter((entry) => entry.owned)
      .map((entry) => ({ entry, name: entry.card?.getName(lang) ?? entry.cardId ?? entry.key }))
      .filter(({ name }) => search === '' || name.toLowerCase().includes(search))
      .sort((left, right) => left.name.localeCompare(right.name))
      .forEach(({ entry, name }) => {
        const isCurrent = entry.key === currentKey;
        // The cover does not consume a copy, so nothing is subtracted from the owned quantity when
        // the target IS the cover; for a slot, the card already sitting there holds its own copy and
        // does not count against itself.
        const used =
          target.type === 'cover'
            ? 0
            : (placements.get(entry.key) ?? []).filter((slot) => slot !== target.index).length;
        const available = Math.max(0, (entry.quantity ?? 0) - used);
        if (!isCurrent && available <= 0) return;

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'binder-picker__card';
        button.dataset.collectionBinderPick = entry.key;
        button.classList.toggle('is-current', isCurrent);

        const image = document.createElement('img');
        image.className = 'binder-picker__image';
        image.src = i18n.resolveImagePath(entry.card.illustration);
        image.alt = '';
        image.loading = 'lazy';

        const label = document.createElement('span');
        label.className = 'binder-picker__name';
        label.textContent = name;

        const left = document.createElement('span');
        left.className = 'binder-picker__left';
        left.textContent = i18n.t('binders.copiesLeft', { count: available });

        button.append(image, label, left);
        this.binderPickerBody.appendChild(button);
        shown += 1;
      });

    if (this.binderPickerEmpty) this.binderPickerEmpty.hidden = shown > 0;
  }

  /**
   * Writes the picked card into the draft (cover or slot) and repaints the editor.
   *
   * @param {string} key - Collection key of the picked card.
   * @returns {void}
   */
  pickBinderCard(key) {
    const target = this.binderPickerTarget;
    if (!target || !this.binderDraft) return;
    if (target.type === 'cover') {
      this.binderDraft.cover = key;
    } else {
      this.binderDraft.slots[target.index] = key;
    }
    this.closeBinderPicker();
    this.renderBinderEditor();
  }

  /**
   * Empties the target of the open picker (a slot, or the cover).
   *
   * @returns {void}
   */
  clearBinderPickerTarget() {
    const target = this.binderPickerTarget;
    if (!target || !this.binderDraft) return;
    if (target.type === 'cover') {
      this.binderDraft.cover = null;
    } else {
      this.binderDraft.slots[target.index] = null;
    }
    this.closeBinderPicker();
    this.renderBinderEditor();
  }

  /**
   * Reports a binder write failure in the editor, translated.
   *
   * @param {Error} error - Thrown error.
   * @returns {void}
   */
  reportBinderError(error) {
    console.error('[CollectionView] The binder could not be saved.', error);
    if (error?.code === BINDER_LIMIT_REACHED) {
      this.setBinderFeedback('binders.error.limit', 'error');
    } else if (error?.code === BINDER_COPY_UNAVAILABLE) {
      this.setBinderFeedback('binders.error.copies', 'error');
    } else if (error instanceof TypeError) {
      this.setBinderFeedback('binders.error.name', 'error');
    } else {
      this.setBinderFeedback('binders.error.save', 'error');
    }
  }

  /**
   * Displays a translated feedback message inside the binder editor.
   *
   * @param {string|null} key - i18n key, or null to hide the message.
   * @param {'info'|'error'} [tone='info'] - Visual tone.
   * @returns {void}
   */
  setBinderFeedback(key, tone = 'info') {
    if (!this.binderFeedback) return;
    if (!key) {
      this.binderFeedback.hidden = true;
      this.binderFeedback.textContent = '';
      return;
    }
    this.binderFeedback.hidden = false;
    this.binderFeedback.textContent = i18n.t(key);
    this.binderFeedback.dataset.tone = tone;
  }

  /**
   * Closes the card detail dialog and forgets the card it was showing.
   *
   * The shine of the enlarged card runs on an animation frame of its own: dropping the handle here
   * stops it, so a dialog left open in the background cannot keep the game busy.
   *
   * @returns {void}
   */
  closeDetail() {
    if (!this.modal || this.modal.hidden) return;
    this.modal.hidden = true;
    this.shineWindow = null;
    this.detailKey = null;
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
    this.closeFilterModal();
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
    if (this.binderPickerTimer !== null) {
      window.clearTimeout(this.binderPickerTimer);
      this.binderPickerTimer = null;
    }
    this.bindings.forEach(({ target, type, handler }) => target.removeEventListener(type, handler));
    this.bindings = [];
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers = [];
    this.isInitialized = false;
  }
}

export default CollectionView;

/**
 * TrophiesView - Global trophy catalogue ("Trophées" destination of the bottom bar).
 *
 * Reference: `js/business/TrophyManager.js` (catalogue, unlocks, experience),
 * `js/business/ProfileManager.js` (pins) and `js/UI/components/TrophyDetail.js` (detail rendering).
 *
 * The catalogue used to be a tab of the profile page. It is now a destination of its own, between
 * the statistics and the information pages, because a hundred trophies do not belong to a page
 * that also shows the player's identity.
 *
 * TWO COMBOS narrow the list, so the page never renders the whole catalogue at once:
 *   - FAMILY: every trophy, one extension's trophies, the account-wide ones, or the collection
 *     trophies of one extension ("Collections - Genesis Blocks", read from the `Booster` of
 *     `data/trophies/<setId>.json` — a collection trophy always depends on its extension);
 *   - STATUS: every trophy, the unlocked ones, or the ones still to unlock.
 *
 * Once a family and a status are chosen, the list itself is a GRID of tiles — three per row on a
 * phone, five on a wide screen, centred — and every tile shows nothing but its medal, its name and
 * its progress bar with the percentage. Tapping a tile opens the shared detail modal, which carries
 * everything else: rarity, description, XP, unlock date, the cards the trophy requires (in colour
 * when owned) and the avatars it unlocks. The pin toggle of an unlocked trophy lives in that modal
 * too (the picks shown on the profile page are made from there), so a tile stays a pure button.
 *
 * Inside one category the tiles are cut into GROUPS of the same type (`trophy.group.*`): the
 * completion tiers of an extension read nothing like its "boosters opened" tiers, and the global
 * counters have nothing to do with the collection trophies, so each type gets its own heading.
 */

import eventBus, { EVENTS } from '../../utils/EventBus.js';
import i18n from '../../utils/I18n.js';
import trophyManager, { TROPHY_CATEGORIES, TrophyManager } from '../../business/TrophyManager.js';
import profileManager, { getProfileErrorMessageKey } from '../../business/ProfileManager.js';
import profileIconManager from '../../business/ProfileIconManager.js';
import TrophyDetail, { TROPHY_PIN_ICON, TROPHY_UNPIN_ICON } from '../components/TrophyDetail.js';
import Toast from '../components/Toast.js';

/** View name, matching `data-view="trophies"` in `index.html`. */
export const TROPHIES_VIEW_NAME = 'trophies';

/**
 * View the back button returns to: the profile.
 *
 * The catalogue is no longer a destination of the bottom bar, it is opened from the profile (next
 * to the statistics, which work exactly the same way): a page reached that way owes the player a
 * way back to where they came from. Spelled out here rather than imported from `ProfileView`, which
 * imports THIS module: the two would then depend on each other.
 */
export const TROPHIES_BACK_VIEW = 'profile';

/** Status filter of the trophy list (the second combo). */
export const TROPHY_FILTERS = Object.freeze({
  ALL: 'all',
  UNLOCKED: 'unlocked',
  LOCKED: 'locked',
});

/** Value of the "every family" option of the family combo. */
export const TROPHY_FAMILY_ALL = 'all';

/** Prefix of the per-extension options of the family combo (`set:<setId>`). */
export const TROPHY_FAMILY_SET_PREFIX = 'set:';

/** Value of the "account-wide trophies" option of the family combo. */
export const TROPHY_FAMILY_GLOBAL = 'global';

/** Value of the "every mining trophy" option of the family combo. */
export const TROPHY_FAMILY_MINING = 'mining';

/** Value of the "every Mine Pick trophy" option of the family combo. */
export const TROPHY_FAMILY_MINEPICK = 'minepick';

/** Prefix of the per-block options of the family combo (`block:<blockId>`). */
export const TROPHY_FAMILY_BLOCK_PREFIX = 'block:';

/** Prefix of the per-extension collection options of the family combo (`collection:<setId>`). */
export const TROPHY_FAMILY_COLLECTION_PREFIX = 'collection:';

/** Rendering order of the trophy families. */
const CATEGORY_ORDER = Object.freeze([
  TROPHY_CATEGORIES.BOOSTER,
  TROPHY_CATEGORIES.GLOBAL,
  TROPHY_CATEGORIES.COLLECTION,
]);

export class TrophiesView {
  /**
   * @param {HTMLElement} rootElement - The trophies `<section>`.
   * @param {object} [options] - View options.
   * @param {(viewName: string) => void} [options.onNavigate] - Called by the back button to switch
   *   view (the router belongs to `app.js`, which passes its `show()`).
   */
  constructor(rootElement, { onNavigate = null } = {}) {
    if (!rootElement || typeof rootElement.querySelector !== 'function') {
      throw new TypeError('TrophiesView requires the trophies section element.');
    }

    this.root = rootElement;
    this.backButton = this.root.querySelector('[data-trophies-back]');
    this.feedbackElement = this.root.querySelector('[data-trophies-feedback]');
    this.summaryElement = this.root.querySelector('[data-trophies-summary]');
    this.familySelect = this.root.querySelector('[data-trophies-family]');
    this.statusSelect = this.root.querySelector('[data-trophies-status]');
    this.emptyElement = this.root.querySelector('[data-trophies-empty]');
    this.listElement = this.root.querySelector('[data-trophies-list]');
    this.modal = this.root.querySelector('[data-trophies-modal]');
    this.modalTitle = this.root.querySelector('[data-trophies-modal-title]');
    this.modalBody = this.root.querySelector('[data-trophies-modal-body]');
    this.modalClose = this.root.querySelector('[data-trophies-modal-close]');

    this.assertMarkup();

    /** @type {((viewName: string) => void)|null} */
    this.onNavigate = typeof onNavigate === 'function' ? onNavigate : null;

    /** @type {object|null} Last trophy state returned by `TrophyManager`. */
    this.trophyState = null;
    /** @type {object|null} Last profile read from `ProfileManager` (for the pins). */
    this.profile = null;
    /** @type {string} Active value of the family combo. */
    this.family = TROPHY_FAMILY_ALL;
    /** @type {string} Active value of the status combo. */
    this.status = TROPHY_FILTERS.ALL;
    /** @type {boolean} True once `init()` bound everything. */
    this.isInitialized = false;
    /** @type {boolean} True when the view is the active one. */
    this.isActive = false;
    /** @type {boolean} True while the view is loading its data. */
    this.isLoading = false;

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
    console.info('[TrophiesView]', ...args);
  }

  /**
   * Verifies that the markup matches the contract expected by this view.
   *
   * @returns {void}
   * @throws {Error} When a required element is missing from `index.html`.
   */
  assertMarkup() {
    const missing = [
      ['[data-trophies-back]', this.backButton],
      ['[data-trophies-summary]', this.summaryElement],
      ['[data-trophies-family]', this.familySelect],
      ['[data-trophies-status]', this.statusSelect],
      ['[data-trophies-list]', this.listElement],
      ['[data-trophies-modal]', this.modal],
      ['[data-trophies-modal-title]', this.modalTitle],
      ['[data-trophies-modal-close]', this.modalClose],
      ['[data-trophies-modal-body]', this.modalBody],
    ]
      .filter(([, element]) => !element)
      .map(([selector]) => selector);

    if (missing.length > 0) {
      throw new Error(`TrophiesView markup is incomplete, missing: ${missing.join(', ')}.`);
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
   * Binds the interactions and loads the first catalogue.
   *
   * @returns {Promise<void>} Resolves once the first render finished.
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
   * Attaches the DOM listeners (combos, rows and detail modal).
   *
   * @returns {void}
   */
  bindEvents() {
    // The catalogue lives on its own page: this button only asks the application to leave it.
    this.listen(this.backButton, 'click', () => this.onNavigate?.(TROPHIES_BACK_VIEW));
    this.listen(this.familySelect, 'change', () => {
      this.family = this.familySelect.value;
      this.renderTrophies();
    });
    this.listen(this.statusSelect, 'change', () => {
      this.status = this.statusSelect.value;
      this.renderTrophies();
    });

    // One delegated listener: the tiles are rebuilt on every render. A tile is a plain button that
    // opens the detail, nothing else.
    this.listen(this.listElement, 'click', (event) => {
      if (!(event.target instanceof Element)) return;
      const open = event.target.closest('[data-trophy-open]');
      if (open) void this.openTrophyDetail(open.dataset.trophyOpen);
    });

    // The pin toggle lives in the detail modal, whose body is rebuilt on every opening.
    this.listen(this.modalBody, 'click', (event) => {
      if (!(event.target instanceof Element)) return;
      const pin = event.target.closest('[data-trophy-pin]');
      if (pin) void this.toggleFeatured(pin.dataset.trophyPin);
    });

    this.listen(this.modal, 'click', (event) => {
      // A click on the backdrop (never on the dialog itself) closes the modal.
      if (event?.target === this.modal) this.closeDetail();
    });
    this.listen(this.modalClose, 'click', () => this.closeDetail());
    this.listen(document, 'keydown', (event) => {
      if (event?.key === 'Escape' && this.modal && !this.modal.hidden) this.closeDetail();
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
      if (payload.view === TROPHIES_VIEW_NAME) {
        this.handleViewActivated();
      } else if (payload.previousView === TROPHIES_VIEW_NAME) {
        this.handleViewDeactivated();
      }
    }));
    this.unsubscribers.push(eventBus.on(EVENTS.LANG_CHANGED, () => this.handleLanguageChanged()));
    this.unsubscribers.push(eventBus.on(EVENTS.TROPHY_UNLOCKED, () => this.handleTrophyUnlocked()));
    this.unsubscribers.push(eventBus.on(EVENTS.BOOSTER_OPENED, () => {
      // An opening moves the progress of every family: refresh the list while it is on screen.
      if (this.isInitialized && !this.isLoading && this.isActive) void this.reload();
    }));
    this.log('Event subscriptions registered.');
  }

  /**
   * Reads the trophies and the profile, then renders the list.
   *
   * @returns {Promise<void>} Resolves once the page is rendered (or the error shown).
   */
  async reload() {
    if (this.isLoading) return;
    this.isLoading = true;
    this.setFeedback(null);
    this.log('Loading the trophies…');
    try {
      // Silent evaluation: only the openings and the boot own the announcements (see `app.js`).
      const [trophyState, profile] = await Promise.all([
        trophyManager.evaluate({ notify: false }),
        profileManager.getProfile(),
      ]);
      this.trophyState = trophyState;
      this.profile = profile;

      this.buildCombos();
      this.renderTrophies();
    } catch (error) {
      console.error('[TrophiesView] The trophies could not be loaded.', error);
      this.setFeedback('trophies.error.load', 'error');
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Rebuilds the two combos of the page.
   *
   * The family combo offers every family NOT present in the current catalogue as a single option,
   * plus one option per extension, so the player can isolate the ten trophies of an extension
   * instead of facing the whole catalogue.
   *
   * @returns {void}
   */
  buildCombos() {
    const families = TrophiesView.buildFamilyOptions(this.trophyState);
    // A filter kept from a previous render must survive a catalogue change: if its option is gone,
    // fall back to "every family" instead of leaving the combo on a value it does not offer.
    if (!families.some((family) => family.value === this.family)) {
      this.family = TROPHY_FAMILY_ALL;
    }

    this.familySelect.textContent = '';
    families.forEach(({ value, label }) => {
      this.familySelect.appendChild(TrophiesView.buildOption(value, label));
    });
    this.familySelect.value = this.family;

    this.statusSelect.textContent = '';
    [TROPHY_FILTERS.ALL, TROPHY_FILTERS.UNLOCKED, TROPHY_FILTERS.LOCKED].forEach((value) => {
      this.statusSelect.appendChild(TrophiesView.buildOption(value, i18n.t(`trophies.filter.${value}`)));
    });
    this.statusSelect.value = this.status;
  }

  /**
   * Builds the options of the family combo.
   *
   * The collection trophies are offered ONE EXTENSION AT A TIME ("Collections - Genesis Blocks"):
   * they are declared per extension (`data/trophies/<setId>.json`) and their requirements only make
   * sense against that extension's cards, so there is deliberately no extension-less "Collection"
   * option.
   *
   * @param {object|null} trophyState - Last trophy state (its `setId`/`setName` name the extensions).
   * @returns {Array<{value: string, label: string}>} The options, in display order.
   */
  static buildFamilyOptions(trophyState) {
    const options = [
      { value: TROPHY_FAMILY_ALL, label: i18n.t('trophies.familyAll') },
    ];

    const trophies = trophyState?.trophies ?? [];
    // Extensions come from the trophy catalogue itself, so a family that no longer exists can never
    // show up in the combo.
    const sets = new Map();
    trophies.forEach((trophy) => {
      if (typeof trophy.setId !== 'string' || trophy.setId === '') return;
      if (sets.has(trophy.setId)) return;
      sets.set(trophy.setId, trophy.setName ?? trophy.setId);
    });

    sets.forEach((name, setId) => {
      options.push({
        value: `${TROPHY_FAMILY_SET_PREFIX}${setId}`,
        label: i18n.t('trophies.familySet', { set: name }),
      });
    });

    options.push({
      value: TROPHY_FAMILY_GLOBAL,
      label: i18n.t('trophy.category.global'),
    });

    // The mining families are account-wide too, and they are the two only ones a player may want
    // to isolate block by block: the per-block tiers are twenty-five trophies on their own.
    const miningBlocks = new Map();
    trophies.forEach((trophy) => {
      if (typeof trophy.blockId !== 'string' || trophy.blockId === '') return;
      const label = trophy.blockNames?.[i18n.getLang()] ?? trophy.blockNames?.en ?? trophy.blockId;
      if (!miningBlocks.has(trophy.blockId)) miningBlocks.set(trophy.blockId, label);
    });
    if (miningBlocks.size > 0 || trophies.some((trophy) => TrophyManager.isMiningTrophy(trophy))) {
      options.push({ value: TROPHY_FAMILY_MINING, label: i18n.t('trophies.familyMining') });
    }
    // The Mine Pick families also hold thirty trophies on their own: they get their own entry, so
    // the global list never buries them among the collection counters.
    if (trophies.some((trophy) => TrophyManager.isMinePickTrophy(trophy))) {
      options.push({ value: TROPHY_FAMILY_MINEPICK, label: i18n.t('trophies.familyMinePick') });
    }
    miningBlocks.forEach((label, blockId) => {
      options.push({
        value: `${TROPHY_FAMILY_BLOCK_PREFIX}${blockId}`,
        label: i18n.t('trophies.familyMiningBlock', { block: label }),
      });
    });

    const collectionSets = new Map();
    trophies.forEach((trophy) => {
      if (trophy.category !== TROPHY_CATEGORIES.COLLECTION) return;
      if (typeof trophy.setId !== 'string' || trophy.setId === '' || collectionSets.has(trophy.setId)) return;
      collectionSets.set(trophy.setId, trophy.setName ?? trophy.setId);
    });
    collectionSets.forEach((name, setId) => {
      options.push({
        value: `${TROPHY_FAMILY_COLLECTION_PREFIX}${setId}`,
        label: i18n.t('trophies.familyCollection', { set: name }),
      });
    });

    return options;
  }

  /**
   * Builds one `<option>` element.
   *
   * @param {string} value - Option value.
   * @param {string} label - Translated label.
   * @returns {HTMLOptionElement} The option.
   */
  static buildOption(value, label) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    return option;
  }

  /**
   * Renders the trophy list for the active family and status.
   *
   * @returns {void}
   */
  renderTrophies() {
    if (!this.trophyState) return;
    const trophies = this.trophyState.trophies.filter((trophy) => {
      if (!this.matchesFamily(trophy)) return false;
      if (this.status === TROPHY_FILTERS.UNLOCKED) return trophy.unlocked;
      if (this.status === TROPHY_FILTERS.LOCKED) return !trophy.unlocked;
      return true;
    });

    if (this.summaryElement) {
      this.summaryElement.textContent = i18n.t('trophies.summary', {
        unlocked: this.trophyState.counters.unlocked,
        total: this.trophyState.counters.total,
        shown: trophies.length,
      });
    }

    this.listElement.textContent = '';
    CATEGORY_ORDER.forEach((category) => {
      const inCategory = trophies.filter((trophy) => trophy.category === category);
      if (inCategory.length === 0) return;

      const heading = document.createElement('h3');
      heading.className = 'trophy-group';
      heading.textContent = i18n.t(`trophy.category.${category}`);
      this.listElement.appendChild(heading);

      // Then the TYPE of trophy: the tiers of one extension do not all measure the same thing, so
      // "complétion" and "boosters ouverts" are separated instead of being mixed in one grid.
      TrophiesView.groupByType(inCategory).forEach((entries) => {
        const subheading = document.createElement('h4');
        subheading.className = 'trophy-subgroup';
        // The heading may name a block (the per-block mining tiers): the parameters of the group
        // resolve that name in the language of the player, exactly like the trophy itself.
        subheading.textContent = i18n.t(
          entries[0].groupKey ?? `trophy.category.${category}`,
          TrophyDetail.buildParams(entries[0])
        );

        const list = document.createElement('ul');
        list.className = 'trophy-grid';
        entries.forEach((trophy, index) => list.appendChild(this.buildTrophyTile(trophy, index)));

        this.listElement.append(subheading, list);
      });
    });

    if (this.emptyElement) {
      this.emptyElement.hidden = trophies.length > 0;
    }
    this.log(`${trophies.length} trophy(ies) rendered (family: ${this.family}, status: ${this.status}).`);
  }

  /**
   * Cuts a list of trophies into its types, keeping the order of the state.
   *
   * @param {object[]} trophies - Trophies of one category.
   * @returns {Array<object[]>} One array per type, in order of first appearance.
   */
  static groupByType(trophies) {
    const groups = new Map();
    trophies.forEach((trophy) => {
      // The category is part of the key: two categories must never share a group by accident.
      const key = `${trophy.category}:${trophy.group ?? ''}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(trophy);
    });
    return Array.from(groups.values());
  }

  /**
   * Tells whether a trophy belongs to the family selected in the combo.
   *
   * @param {object} trophy - Trophy state.
   * @returns {boolean} True when the trophy must be shown.
   */
  matchesFamily(trophy) {
    if (this.family === TROPHY_FAMILY_ALL) return true;
    if (this.family === TROPHY_FAMILY_GLOBAL) {
      return trophy.category === TROPHY_CATEGORIES.GLOBAL;
    }
    if (this.family === TROPHY_FAMILY_MINING) {
      return TrophyManager.isMiningTrophy(trophy);
    }
    if (this.family === TROPHY_FAMILY_MINEPICK) {
      return TrophyManager.isMinePickTrophy(trophy);
    }
    if (this.family.startsWith(TROPHY_FAMILY_BLOCK_PREFIX)) {
      return trophy.blockId === this.family.slice(TROPHY_FAMILY_BLOCK_PREFIX.length);
    }
    if (this.family.startsWith(TROPHY_FAMILY_SET_PREFIX)) {
      return trophy.setId === this.family.slice(TROPHY_FAMILY_SET_PREFIX.length);
    }
    if (this.family.startsWith(TROPHY_FAMILY_COLLECTION_PREFIX)) {
      return (
        trophy.category === TROPHY_CATEGORIES.COLLECTION &&
        trophy.setId === this.family.slice(TROPHY_FAMILY_COLLECTION_PREFIX.length)
      );
    }
    return true;
  }

  /**
   * Builds one trophy tile: its medal, its name and its progress bar with the percentage.
   *
   * Nothing else is printed here — the rarity, the description, the experience, the unlock date,
   * the required cards and the avatars the trophy grants all live in the detail modal, which the
   * tile opens. The accessible name of the button therefore carries the two facts a screen reader
   * cannot read from the pictures: the rarity and the state of the trophy.
   *
   * @param {object} trophy - Trophy state.
   * @param {number} index - Position in the grid (drives the staggered entry animation).
   * @returns {HTMLLIElement} The `<li>` element.
   */
  buildTrophyTile(trophy, index = 0) {
    const item = document.createElement('li');
    item.className = 'trophy-tile';
    item.dataset.trophyId = trophy.id;
    item.dataset.rarity = trophy.rarity;
    item.dataset.unlocked = String(trophy.unlocked);
    item.style.setProperty('--tile-index', String(index));

    // A pinned trophy is flagged on the tile itself. The pin is only toggled from the detail modal,
    // so without this marker the catalogue gives no sign of what the profile already highlights.
    const pinned = (this.profile?.featured ?? []).includes(trophy.id);
    item.dataset.pinned = String(pinned);

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'trophy-tile__open';
    open.dataset.trophyOpen = trophy.id;
    open.title = TrophyDetail.trophyTitle(trophy);
    open.setAttribute(
      'aria-label',
      `${TrophyDetail.trophyTitle(trophy)}, ${TrophyDetail.rarityLabel(trophy.rarity)}, ` +
        i18n.t(trophy.unlocked ? 'trophy.unlocked' : 'trophy.locked') +
        (pinned ? `, ${i18n.t('profile.featured.badge')}` : '')
    );

    const medal = TrophyDetail.buildMedal(trophy, 'trophy-tile__icon');
    if (medal) open.appendChild(medal);

    const title = document.createElement('span');
    title.className = 'trophy-tile__title';
    title.textContent = TrophyDetail.trophyTitle(trophy);
    open.appendChild(title);

    const progress = document.createElement('span');
    progress.className = 'trophy-tile__progress';
    progress.appendChild(TrophyDetail.buildProgress(trophy, 'trophy-tile__track'));

    const percent = document.createElement('span');
    percent.className = 'trophy-tile__percent';
    percent.textContent = i18n.t('trophy.progressValue', {
      percent: Math.round((trophy.progress ?? 0) * 100),
    });
    progress.appendChild(percent);
    open.appendChild(progress);

    item.appendChild(open);

    // The marker itself: a small pin in the top-right corner of the tile, drawn outside the button
    // so the tile stays one single interactive element.
    if (pinned) {
      const marker = document.createElement('span');
      marker.className = 'trophy-tile__pin';
      marker.title = i18n.t('profile.featured.badge');
      marker.setAttribute('aria-hidden', 'true');
      const glyph = document.createElement('img');
      glyph.src = TROPHY_PIN_ICON;
      glyph.alt = '';
      marker.appendChild(glyph);
      item.appendChild(marker);
    }

    return item;
  }

  /**
   * Adds or removes the pin marker of one already-rendered catalogue tile.
   *
   * @param {string} id - Trophy id.
   * @param {boolean} pinned - New pin state.
   * @returns {void}
   */
  syncPinnedMarker(id, pinned) {
    const tile = this.listElement?.querySelector(`[data-trophy-id="${id}"]`);
    if (!tile) return;
    tile.dataset.pinned = String(pinned);

    const existing = tile.querySelector('.trophy-tile__pin');
    if (!pinned) {
      existing?.remove();
      return;
    }
    if (existing) return;

    const marker = document.createElement('span');
    marker.className = 'trophy-tile__pin';
    marker.title = i18n.t('profile.featured.badge');
    marker.setAttribute('aria-hidden', 'true');
    const glyph = document.createElement('img');
    glyph.src = TROPHY_PIN_ICON;
    glyph.alt = '';
    marker.appendChild(glyph);
    tile.appendChild(marker);
  }

  /**
   * Builds the pin toggle of the detail modal.
   *
   * The pins of the profile are chosen from the detail of a trophy, because the tiles of the
   * catalogue are plain buttons: an unlocked trophy is therefore pinned (or unpinned) here.
   *
   * @param {object} trophy - Trophy state.
   * @returns {HTMLElement|null} The toggle with its label, or null when the trophy is locked.
   */
  buildModalPin(trophy) {
    if (!trophy.unlocked) return null;
    const pinned = (this.profile?.featured ?? []).includes(trophy.id);
    const label = i18n.t(pinned ? 'profile.featured.unpin' : 'profile.featured.pin');

    const row = document.createElement('div');
    row.className = 'trophy-modal__actions';
    row.appendChild(TrophyDetail.buildIconButton({
      className: 'trophy-modal__pin',
      datasetKey: 'trophyPin',
      value: trophy.id,
      icon: pinned ? TROPHY_UNPIN_ICON : TROPHY_PIN_ICON,
      label,
      pressed: pinned,
    }));

    const text = document.createElement('span');
    text.className = 'trophy-modal__pin-label';
    text.textContent = label;
    row.appendChild(text);
    return row;
  }

  /**
   * Opens the detail modal for one trophy.
   *
   * @param {string} id - Trophy id.
   * @param {object} [options] - Opening options.
   * @param {boolean} [options.animate=true] - Replays the entry animation. Only a refresh of an
   *   already open modal (a pin toggled from it) turns it off.
   * @returns {Promise<void>} Resolves once the modal is displayed.
   */
  async openTrophyDetail(id, { animate = true } = {}) {
    const trophy = this.trophyState?.trophies?.find((candidate) => candidate.id === id);
    if (!trophy || !this.modal || !this.modalBody || !this.modalTitle) {
      console.warn(`[TrophiesView] Unknown trophy "${id}".`);
      return;
    }

    this.modalTitle.textContent = TrophyDetail.trophyTitle(trophy);
    this.modalBody.textContent = '';

    let icons = [];
    try {
      icons = await profileIconManager.getIconsForTrophy(trophy);
    } catch (error) {
      console.warn(`[TrophiesView] The avatars unlocked by "${id}" could not be read.`, error);
    }

    this.modalBody.appendChild(TrophyDetail.buildDetailBody(trophy, {
      experiencePerTrophy: this.trophyState.experiencePerTrophy,
      icons,
    }));

    const pin = this.buildModalPin(trophy);
    if (pin) this.modalBody.appendChild(pin);

    if (animate) {
      this.openModal(trophy.id);
    } else {
      this.log(`Detail refreshed for "${id}".`);
    }
  }

  /**
   * Displays the detail modal and restarts its entry animation.
   *
   * @param {string} source - Identifier of the shown item (a trophy id).
   * @returns {void}
   */
  openModal(source) {
    this.modal.hidden = false;
    this.modal.classList.remove('is-opening');
    void this.modal.offsetWidth;
    this.modal.classList.add('is-opening');
    this.log(`Detail opened for "${source}".`);
  }

  /**
   * Closes the detail modal.
   *
   * @returns {void}
   */
  closeDetail() {
    if (!this.modal || this.modal.hidden) return;
    this.modal.hidden = true;
    this.modal.classList.remove('is-opening');
  }

  /**
   * Pins or unpins one trophy (the profile page shows the picks).
   *
   * @param {string} id - Trophy id.
   * @returns {Promise<void>} Resolves once the pin state is stored (or the refusal reported).
   */
  async toggleFeatured(id) {
    try {
      const { featured, added } = await profileManager.toggleFeatured(id);
      this.profile = { ...this.profile, featured };
      Toast.success(added ? 'profile.featured.pinned' : 'profile.featured.unpinned');
      // The tile marker follows without a full re-render: re-rendering the grid would replay the
      // entry animation of every tile just to light up one corner.
      this.syncPinnedMarker(id, added);
      // The toggle only exists in the detail modal: it is rebuilt in place (no entry animation) so
      // its icon, its label and `aria-pressed` follow the new state immediately.
      if (this.modal && !this.modal.hidden) {
        await this.openTrophyDetail(id, { animate: false });
        TrophiesView.pop(this.modalBody.querySelector(`[data-trophy-pin="${id}"]`));
      }
    } catch (error) {
      console.error('[TrophiesView] The trophy could not be pinned.', error);
      Toast.error(getProfileErrorMessageKey(error));
    }
  }

  /**
   * Restarts a short "pop" animation on an element.
   *
   * @param {HTMLElement|null} element - Target, ignored when null.
   * @returns {void}
   */
  static pop(element) {
    if (!element) return;
    element.classList.remove('is-popping');
    void element.offsetWidth;
    element.classList.add('is-popping');
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
      console.warn(`[TrophiesView] ${i18n.t(key)}`);
    }
  }

  /**
   * Re-renders the list and its labels after a language change.
   *
   * @returns {void}
   */
  handleLanguageChanged() {
    this.log(`Language changed, re-rendering (${i18n.getLang()}).`);
    this.closeDetail();
    if (this.isInitialized && !this.isLoading) {
      void this.reload();
    }
  }

  /**
   * Refreshes the list when a trophy is unlocked (the toast is announced by `app.js`).
   *
   * @returns {void}
   */
  handleTrophyUnlocked() {
    if (this.isInitialized && !this.isLoading) {
      void this.reload();
    }
  }

  /**
   * Reloads the list when the view becomes active (progress may have moved meanwhile).
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
    this.bindings.forEach(({ target, type, handler }) => target.removeEventListener(type, handler));
    this.bindings = [];
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers = [];
    this.trophyState = null;
    this.profile = null;
    this.isInitialized = false;
  }
}

export default TrophiesView;

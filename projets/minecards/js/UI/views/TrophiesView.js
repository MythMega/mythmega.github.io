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
 * A row opens the shared detail modal (medal, rarity, progress, XP, unlock date, the cards the
 * trophy requires — in colour when owned — and the avatars it unlocks). An unlocked row carries the
 * pin toggle: the picks shown on the profile page are made from here.
 */

import eventBus, { EVENTS } from '../../utils/EventBus.js';
import i18n from '../../utils/I18n.js';
import trophyManager, { TROPHY_CATEGORIES } from '../../business/TrophyManager.js';
import profileManager, { getProfileErrorMessageKey } from '../../business/ProfileManager.js';
import profileIconManager from '../../business/ProfileIconManager.js';
import TrophyDetail, { TROPHY_PIN_ICON, TROPHY_UNPIN_ICON } from '../components/TrophyDetail.js';
import Toast from '../components/Toast.js';

/** View name, matching `data-view="trophies"` in `index.html`. */
export const TROPHIES_VIEW_NAME = 'trophies';

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
   */
  constructor(rootElement) {
    if (!rootElement || typeof rootElement.querySelector !== 'function') {
      throw new TypeError('TrophiesView requires the trophies section element.');
    }

    this.root = rootElement;
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
      ['[data-trophies-summary]', this.summaryElement],
      ['[data-trophies-family]', this.familySelect],
      ['[data-trophies-status]', this.statusSelect],
      ['[data-trophies-list]', this.listElement],
      ['[data-trophies-modal]', this.modal],
      ['[data-trophies-modal-title]', this.modalTitle],
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
    this.listen(this.familySelect, 'change', () => {
      this.family = this.familySelect.value;
      this.renderTrophies();
    });
    this.listen(this.statusSelect, 'change', () => {
      this.status = this.statusSelect.value;
      this.renderTrophies();
    });

    // One delegated listener: the rows are rebuilt on every render.
    this.listen(this.listElement, 'click', (event) => {
      if (!(event.target instanceof Element)) return;
      const pin = event.target.closest('[data-trophy-pin]');
      if (pin) {
        void this.toggleFeatured(pin.dataset.trophyPin);
        return;
      }
      const open = event.target.closest('[data-trophy-open]');
      if (open) void this.openTrophyDetail(open.dataset.trophyOpen);
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
      const group = trophies.filter((trophy) => trophy.category === category);
      if (group.length === 0) return;

      const heading = document.createElement('h3');
      heading.className = 'trophy-group';
      heading.textContent = i18n.t(`trophy.category.${category}`);

      const list = document.createElement('ul');
      list.className = 'trophy-list';
      group.forEach((trophy, index) => list.appendChild(this.buildTrophyRow(trophy, index)));

      this.listElement.append(heading, list);
    });

    if (this.emptyElement) {
      this.emptyElement.hidden = trophies.length > 0;
    }
    this.log(`${trophies.length} trophy(ies) rendered (family: ${this.family}, status: ${this.status}).`);
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
   * Builds one trophy row: rarity, title, XP, progress and the pin/unpin icon button.
   *
   * @param {object} trophy - Trophy state.
   * @param {number} index - Position in the list (drives the staggered entry animation).
   * @returns {HTMLLIElement} The `<li>` element.
   */
  buildTrophyRow(trophy, index = 0) {
    const item = document.createElement('li');
    item.className = 'trophy';
    item.dataset.trophyId = trophy.id;
    item.dataset.rarity = trophy.rarity;
    item.dataset.unlocked = String(trophy.unlocked);
    item.style.setProperty('--tile-index', String(index));

    const head = document.createElement('div');
    head.className = 'trophy__head';

    const medal = TrophyDetail.buildMedal(trophy);
    const title = document.createElement('span');
    title.className = 'trophy__title';
    title.textContent = TrophyDetail.trophyTitle(trophy);

    const xp = document.createElement('span');
    xp.className = 'trophy__xp';
    xp.textContent = trophy.unlocked
      ? i18n.t('trophy.xp', {
        experience: TrophyDetail.resolveExperience(trophy, this.trophyState?.experiencePerTrophy),
      })
      : i18n.t('trophy.locked');

    if (medal) head.appendChild(medal);
    head.append(TrophyDetail.buildRarityBadge(trophy), title, xp);
    item.appendChild(head);

    const description = document.createElement('p');
    description.className = 'trophy__desc';
    description.textContent = TrophyDetail.trophyDescription(trophy);
    item.appendChild(description);

    item.appendChild(TrophyDetail.buildProgress(trophy));

    // The whole row opens the detail; the icon button next to it pins, so a tap on the row never
    // toggles a pin by accident.
    const actions = document.createElement('div');
    actions.className = 'trophy__actions';

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'trophy__open';
    open.dataset.trophyOpen = trophy.id;
    open.textContent = i18n.t('trophies.details');
    actions.appendChild(open);

    if (trophy.unlocked) {
      const pinned = (this.profile?.featured ?? []).includes(trophy.id);
      actions.appendChild(TrophyDetail.buildIconButton({
        className: 'trophy__pin',
        datasetKey: 'trophyPin',
        value: trophy.id,
        icon: pinned ? TROPHY_UNPIN_ICON : TROPHY_PIN_ICON,
        label: i18n.t(pinned ? 'profile.featured.unpin' : 'profile.featured.pin'),
        pressed: pinned,
      }));
    }

    item.appendChild(actions);
    return item;
  }

  /**
   * Opens the detail modal for one trophy.
   *
   * @param {string} id - Trophy id.
   * @returns {Promise<void>} Resolves once the modal is displayed.
   */
  async openTrophyDetail(id) {
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
    this.openModal(trophy.id);
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
      this.renderTrophies();
      TrophiesView.pop(this.listElement.querySelector(`[data-trophy-pin="${id}"]`));
      Toast.success(added ? 'profile.featured.pinned' : 'profile.featured.unpinned');
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

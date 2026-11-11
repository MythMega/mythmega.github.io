/**
 * TitlesView - Player titles ("Titre"): the whole catalogue, one ROW per title.
 *
 * Reference: `js/business/TitleManager.js` (the catalogue and the unlock conditions),
 * `js/business/ProfileManager.js` (the stored title), `js/business/TrophyManager.js` (the level and
 * the unlocked trophies) and `js/UI/components/TrophyDetail.js` (the detail of the trophy that
 * grants a collection title).
 *
 * The page is reached from the profile, next to the statistics and the trophies, and it comes back
 * there with its own back button; the router stays in `app.js`.
 *
 * A ROW PER TITLE, not a grid: a title is a sentence ("Approuvé par Jeb_."), and a tile would cut
 * it. Every row shows the title in the pixel face it will be displayed in under the pseudo, which
 * makes the page its own preview:
 *   - "Aucun titre" comes first and is a CHOICE of its own: a player may own titles and want none
 *     displayed, so this row is what clears `profile.title` (nothing else does);
 *   - an unlocked title is selectable (a click stores it at once, no save button: a title is one
 *     click, not a form);
 *   - a LOCKED title is greyed out, cannot be selected, and carries the "voir la condition de
 *     déblocage" button that opens what unlocks it: the level to reach, or the collection trophy to
 *     complete, shown with the very same detail component as the trophies page (so the player reads
 *     the requirement, the progress and the cards it needs in one place).
 *
 * The rows are grouped by source (the levels, then the collections, one heading per extension), and
 * every heading is translated at render time: a language switch rebuilds the list.
 */

import eventBus, { EVENTS } from '../../utils/EventBus.js';
import i18n from '../../utils/I18n.js';
import cardLanguage from '../../utils/CardLanguage.js';
import titleManager, { TITLE_SOURCES, TitleManager } from '../../business/TitleManager.js';
import trophyManager from '../../business/TrophyManager.js';
import profileManager, { getProfileErrorMessageKey } from '../../business/ProfileManager.js';
import profileIconManager from '../../business/ProfileIconManager.js';
import TrophyDetail from '../components/TrophyDetail.js';
import Toast from '../components/Toast.js';

/** View name, matching `data-view="titles"` in `index.html`. */
export const TITLES_VIEW_NAME = 'titles';

/**
 * View the back button returns to: the profile.
 *
 * Spelled out here rather than imported from `ProfileView`, which imports THIS module: the two
 * would then depend on each other (the same reason `TrophiesView` does it).
 */
export const TITLES_BACK_VIEW = 'profile';

/** Id used by the row that displays no title at all ("Aucun titre"). */
export const NO_TITLE_ID = '';

export class TitlesView {
  /**
   * @param {HTMLElement} rootElement - The titles `<section>`.
   * @param {object} [options] - View options.
   * @param {(viewName: string) => void} [options.onNavigate] - Called by the back button to switch
   *   view (the router belongs to `app.js`, which passes its `show()`).
   */
  constructor(rootElement, { onNavigate = null } = {}) {
    if (!rootElement || typeof rootElement.querySelector !== 'function') {
      throw new TypeError('TitlesView requires the titles section element.');
    }

    this.root = rootElement;
    this.backButton = this.root.querySelector('[data-titles-back]');
    this.feedbackElement = this.root.querySelector('[data-titles-feedback]');
    this.summaryElement = this.root.querySelector('[data-titles-summary]');
    this.noneListElement = this.root.querySelector('[data-titles-none-list]');
    this.tabsElement = this.root.querySelector('[data-titles-tabs]');
    this.panelsElement = this.root.querySelector('[data-titles-panels]');
    this.emptyElement = this.root.querySelector('[data-titles-empty]');
    this.modal = this.root.querySelector('[data-titles-modal]');
    this.modalTitle = this.root.querySelector('[data-titles-modal-title]');
    this.modalBody = this.root.querySelector('[data-titles-modal-body]');
    this.modalClose = this.root.querySelector('[data-titles-modal-close]');

    this.assertMarkup();

    /** @type {((viewName: string) => void)|null} */
    this.onNavigate = typeof onNavigate === 'function' ? onNavigate : null;

    /** @type {object|null} Last profile read from `ProfileManager`. */
    this.profile = null;
    /** @type {object|null} Last trophy state returned by `TrophyManager`. */
    this.trophyState = null;
    /** @type {{level: object[], collection: object[], all: object[]}|null} Catalogue of the last render. */
    this.titles = null;
    /** @type {Map<string, HTMLButtonElement>} Tab buttons, keyed by category id. */
    this.categoryTabs = new Map();
    /** @type {Map<string, HTMLElement>} Panels, keyed by category id. */
    this.categoryPanels = new Map();
    /** @type {string|null} Category displayed, kept across a reload. */
    this.activeCategory = null;
    /** @type {boolean} True once `init()` bound everything. */
    this.isInitialized = false;
    /** @type {boolean} True when the view is the active one. */
    this.isActive = false;
    /** @type {boolean} True while the view is loading its data. */
    this.isLoading = false;
    /** @type {boolean} True while a selection is being stored (guards double clicks). */
    this.isSaving = false;

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
    console.info('[TitlesView]', ...args);
  }

  /**
   * Verifies that the markup matches the contract expected by this view.
   *
   * @returns {void}
   * @throws {Error} When a required element is missing from `index.html`.
   */
  assertMarkup() {
    const missing = [
      ['[data-titles-back]', this.backButton],
      ['[data-titles-summary]', this.summaryElement],
      ['[data-titles-none-list]', this.noneListElement],
      ['[data-titles-tabs]', this.tabsElement],
      ['[data-titles-panels]', this.panelsElement],
      ['[data-titles-modal]', this.modal],
      ['[data-titles-modal-title]', this.modalTitle],
      ['[data-titles-modal-body]', this.modalBody],
      ['[data-titles-modal-close]', this.modalClose],
    ]
      .filter(([, element]) => !element)
      .map(([selector]) => selector);

    if (missing.length > 0) {
      throw new Error(`TitlesView markup is incomplete, missing: ${missing.join(', ')}.`);
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
   * Attaches the DOM listeners (back button, rows and condition modal).
   *
   * @returns {void}
   */
  bindEvents() {
    this.listen(this.backButton, 'click', () => this.onNavigate?.(TITLES_BACK_VIEW));

    // ONE delegated listener per container: the rows are rebuilt on every render. The condition
    // button is checked FIRST, because it lives inside the row of a locked title, whose choose
    // button is disabled. The "no title" row lives outside the tabs, so it has its own container.
    const handleRowClick = (event) => {
      if (!(event.target instanceof Element)) return;
      const condition = event.target.closest('[data-title-condition]');
      if (condition) {
        void this.openCondition(condition.dataset.titleCondition);
        return;
      }
      const choose = event.target.closest('[data-title-choose]');
      if (choose && !choose.disabled) void this.selectTitle(choose.dataset.titleChoose);
    };
    this.listen(this.noneListElement, 'click', handleRowClick);
    this.listen(this.panelsElement, 'click', handleRowClick);

    this.listen(this.tabsElement, 'click', (event) => {
      const button =
        event?.target instanceof Element ? event.target.closest('[data-titles-tab]') : null;
      if (button) this.showTab(button.dataset.titlesTab);
    });
    this.listen(this.tabsElement, 'keydown', (event) => this.handleTabKeyDown(event));

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
      if (payload.view === TITLES_VIEW_NAME) {
        this.handleViewActivated();
      } else if (payload.previousView === TITLES_VIEW_NAME) {
        this.handleViewDeactivated();
      }
    }));
    this.unsubscribers.push(eventBus.on(EVENTS.LANG_CHANGED, () => this.handleLanguageChanged()));
    this.unsubscribers.push(eventBus.on(EVENTS.CARD_LANG_CHANGED, () => this.handleLanguageChanged()));
    // A trophy (and therefore a collection title) and a level (and therefore a level title) both
    // move the list: whichever unlocks them, the page repaints.
    this.unsubscribers.push(eventBus.on(EVENTS.TROPHY_UNLOCKED, () => this.handleProgressChanged()));
    this.unsubscribers.push(eventBus.on(EVENTS.EXPERIENCE_UPDATED, () => this.handleProgressChanged()));
    this.log('Event subscriptions registered.');
  }

  /**
   * Reads the profile, the trophies and the catalogue, then renders the list.
   *
   * @returns {Promise<void>} Resolves once the page is rendered (or the error shown).
   */
  async reload() {
    if (this.isLoading) return;
    this.isLoading = true;
    this.setFeedback(null);
    this.log('Loading the titles…');
    try {
      // Silent evaluation: only the openings and the boot own the announcements (see `app.js`).
      const [profile, trophyState] = await Promise.all([
        profileManager.getProfile(),
        trophyManager.evaluate({ notify: false }),
      ]);
      this.profile = profile;
      this.trophyState = trophyState;
      this.titles = await titleManager.listTitles({ trophyState });

      this.renderSummary();
      this.renderTitles();
    } catch (error) {
      console.error('[TitlesView] The titles could not be loaded.', error);
      this.setFeedback('titles.error.load', 'error');
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Renders the "how many" line of the page.
   *
   * @returns {void}
   */
  renderSummary() {
    if (!this.summaryElement || !this.titles) return;
    const unlocked = this.titles.all.filter((title) => title.unlocked).length;
    this.summaryElement.textContent = i18n.t('titles.summary', {
      unlocked,
      total: this.titles.all.length,
    });
  }

  /**
   * Renders the "no title" row, then the tabs and the panels of the categories.
   *
   * @returns {void}
   */
  renderTitles() {
    if (!this.titles || !this.panelsElement) return;
    const selected = TitlesView.readSelectedId(this.profile);
    const categories = this.buildCategories();

    this.noneListElement.replaceChildren(this.buildNoneRow(selected));

    if (categories.length === 0) {
      this.categoryTabs.clear();
      this.categoryPanels.clear();
      this.tabsElement.replaceChildren();
      this.panelsElement.replaceChildren();
    } else {
      this.renderPanels(categories, selected);
      this.renderTabs(categories);
    }

    if (this.emptyElement) {
      this.emptyElement.hidden = this.titles.all.length > 0;
    }
    this.log(
      `${this.titles.all.length} title(s) rendered ` +
        `(${this.titles.all.filter((title) => title.unlocked).length} unlocked, ` +
        `${categories.length} category(ies), selected: ${selected || 'none'}).`
    );
  }

  /**
   * Groups the catalogue into the categories the tabs show.
   *
   * The collection titles are cut per extension: they are granted by the collection trophies of ONE
   * extension, and mixing the two extensions in one panel would hide that.
   *
   * @returns {Array<{id: string, label: string, titles: object[]}>} One entry per category.
   */
  buildCategories() {
    const categories = [];
    if (this.titles.level.length > 0) {
      categories.push({
        id: 'level',
        label: i18n.t('titles.group.level'),
        titles: this.titles.level,
      });
    }

    const bySet = new Map();
    this.titles.collection.forEach((title) => {
      const setId = title.grantingTrophy?.setId ?? '';
      if (!bySet.has(setId)) bySet.set(setId, []);
      bySet.get(setId).push(title);
    });
    bySet.forEach((titles, setId) => {
      categories.push({
        id: `set:${setId}`,
        label: i18n.t('titles.group.collection', { set: this.resolveSetName(setId) }),
        titles,
      });
    });
    return categories;
  }

  /**
   * DOM id of the panel of a category.
   *
   * @param {string} id - Category id (`level`, `set:A1`).
   * @returns {string} A valid element id.
   */
  static panelIdOf(id) {
    return `titles-panel-${String(id).replace(/[^A-Za-z0-9_-]+/g, '-')}`;
  }

  /**
   * Draws one panel per category.
   *
   * Every panel is built, then hidden but the selected one: switching tabs never rebuilds a row,
   * and the selected title stays where it belongs.
   *
   * @param {Array<{id: string, label: string, titles: object[]}>} categories - Categories.
   * @param {string} selected - Id displayed by the profile.
   * @returns {void}
   */
  renderPanels(categories, selected) {
    const panels = categories.map((category) => {
      const panel = document.createElement('div');
      panel.className = 'titles__panel';
      panel.id = TitlesView.panelIdOf(category.id);
      panel.dataset.titlesPanel = category.id;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', `${TitlesView.panelIdOf(category.id)}-tab`);

      const list = document.createElement('ul');
      list.className = 'titles__list';
      list.append(...category.titles.map((title) => this.buildRow(title, selected)));
      panel.append(list);
      return panel;
    });

    this.panelsElement.replaceChildren(...panels);
    this.categoryPanels = new Map(panels.map((panel) => [panel.dataset.titlesPanel, panel]));
  }

  /**
   * Draws the strip of categories and displays its tab.
   *
   * The roving tabindex keeps the strip to a single stop of the Tab key: only the selected button
   * is reachable with Tab, the others are reached with the arrows.
   *
   * @param {Array<{id: string, label: string, titles: object[]}>} categories - Categories.
   * @returns {void}
   */
  renderTabs(categories) {
    const buttons = categories.map((category) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'titles__tab';
      button.id = `${TitlesView.panelIdOf(category.id)}-tab`;
      button.dataset.titlesTab = category.id;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', TitlesView.panelIdOf(category.id));
      button.setAttribute('aria-selected', 'false');
      button.tabIndex = -1;
      button.textContent = category.label;
      return button;
    });

    this.tabsElement.replaceChildren(...buttons);
    this.categoryTabs = new Map(buttons.map((button) => [button.dataset.titlesTab, button]));

    // The category the player was reading survives a reload (an unlock, a language change).
    const keep = this.categoryTabs.has(this.activeCategory)
      ? this.activeCategory
      : this.categoryTabs.keys().next().value;
    this.showTab(keep, { silent: true });
  }

  /**
   * Shows one category and hides the others.
   *
   * @param {string|null} id - Category id.
   * @param {object} [options] - Display options.
   * @param {boolean} [options.silent=false] - Skips the log (used at render time).
   * @returns {void}
   */
  showTab(id, { silent = false } = {}) {
    if (typeof id !== 'string' || !this.categoryTabs.has(id)) return;
    this.activeCategory = id;

    this.categoryTabs.forEach((button, key) => {
      const isActive = key === id;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-selected', isActive ? 'true' : 'false');
      button.tabIndex = isActive ? 0 : -1;
    });
    this.categoryPanels.forEach((panel, key) => {
      panel.hidden = key !== id;
    });

    if (silent) return;
    this.log(`Category "${id}" displayed.`);
  }

  /**
   * Moves the selection with the keyboard, as a tab list is expected to answer.
   *
   * @param {KeyboardEvent} event - Key pressed inside the strip.
   * @returns {void}
   */
  handleTabKeyDown(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const ids = [...this.categoryTabs.keys()];
    if (ids.length === 0) return;

    event.preventDefault();
    const current = Math.max(ids.indexOf(this.activeCategory), 0);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? ids.length - 1
          : event.key === 'ArrowLeft'
            ? (current - 1 + ids.length) % ids.length
            : (current + 1) % ids.length;

    this.showTab(ids[next]);
    this.categoryTabs.get(ids[next])?.focus();
  }

  /**
   * Resolves the display name of the extension a title belongs to.
   *
   * @param {string} setId - Extension id (`A1`).
   * @returns {string} Its name, or the id when the trophy state does not know it.
   */
  resolveSetName(setId) {
    const trophy = (this.trophyState?.trophies ?? []).find((candidate) => candidate.setId === setId);
    return trophy?.setName ?? setId;
  }

  /**
   * Reads the id of the title the profile displays.
   *
   * @param {object|null} profile - Stored profile.
   * @returns {string} The id, or the empty string for "no title".
   */
  static readSelectedId(profile) {
    return typeof profile?.title === 'string' ? profile.title.trim() : '';
  }

  /**
   * Builds the "Aucun titre" row, which is always available.
   *
   * @param {string} selected - Id displayed by the profile.
   * @returns {HTMLLIElement} The row.
   */
  buildNoneRow(selected) {
    const item = this.buildRowShell({ unlocked: true, selected: selected === NO_TITLE_ID });
    const choose = item.querySelector('.titles__choose');
    choose.dataset.titleChoose = NO_TITLE_ID;

    const text = choose.querySelector('.titles__text');
    text.textContent = i18n.t('titles.none');
    text.dataset.variant = 'none';

    const hint = document.createElement('span');
    hint.className = 'titles__hint';
    hint.textContent = i18n.t('titles.none.hint');
    choose.appendChild(hint);
    return item;
  }

  /**
   * Builds one title row.
   *
   * @param {object} title - Catalogue entry completed with `unlocked`.
   * @param {string} selected - Id displayed by the profile.
   * @returns {HTMLLIElement} The row.
   */
  buildRow(title, selected) {
    const item = this.buildRowShell({
      id: title.id,
      unlocked: title.unlocked,
      selected: title.unlocked && selected === title.id,
    });

    const choose = item.querySelector('.titles__choose');
    choose.dataset.titleChoose = title.id;

    const text = choose.querySelector('.titles__text');
    text.textContent = TitleManager.titleText(title, cardLanguage.getLang());

    const hint = document.createElement('span');
    hint.className = 'titles__hint';
    hint.textContent = title.unlocked
      ? i18n.t(title.source === TITLE_SOURCES.LEVEL ? 'titles.source.level' : 'titles.source.collection')
      : i18n.t('titles.locked');
    choose.appendChild(hint);

    if (!title.unlocked) {
      const condition = document.createElement('button');
      condition.type = 'button';
      condition.className = 'btn btn--ghost btn--small titles__condition';
      condition.dataset.titleCondition = title.id;
      condition.textContent = i18n.t('titles.condition.open');
      item.appendChild(condition);
    }
    return item;
  }

  /**
   * Builds the common shell of a row: the wrapper and its choose button.
   *
   * @param {object} options - Row options.
   * @param {string} [options.id=''] - Title id (`''` for the "no title" row).
   * @param {boolean} options.unlocked - Whether the row can be selected.
   * @param {boolean} options.selected - Whether the row is the stored choice.
   * @returns {HTMLLIElement} The row, with its choose button inside.
   */
  buildRowShell({ id = '', unlocked, selected }) {
    // The row is an `<li>`: the container is a `<ul>`, and a list only accepts list items.
    const item = document.createElement('li');
    item.className = 'titles__row';
    item.dataset.titleId = id;
    item.dataset.unlocked = String(unlocked);
    item.dataset.selected = String(selected);

    const choose = document.createElement('button');
    choose.type = 'button';
    choose.className = 'titles__choose';
    // A toggle button rather than a radio: the rows are mixed with the group headings, and
    // `aria-pressed` says "this is the displayed title" without constraining the list to radios.
    choose.setAttribute('aria-pressed', String(selected));
    choose.dataset.selected = String(selected);
    choose.disabled = !unlocked;
    // No `aria-label`: the accessible name of the button is its own text (the title) followed by
    // the hint the caller appends (its state), which is exactly what should be announced.

    const text = document.createElement('span');
    text.className = 'titles__text';
    choose.appendChild(text);
    item.appendChild(choose);
    return item;
  }

  /**
   * Stores the title the player clicked.
   *
   * @param {string} id - Title id (`''` for "no title").
   * @returns {Promise<void>} Resolves once the choice is stored (or the refusal reported).
   */
  async selectTitle(id) {
    if (this.isSaving) return;
    const current = TitlesView.readSelectedId(this.profile);
    if (current === id) return;

    this.isSaving = true;
    try {
      this.profile = await profileManager.setIdentity({ title: id });
      this.renderTitles();
      this.setFeedback(id === NO_TITLE_ID ? 'titles.cleared' : 'titles.saved', 'info');
      Toast.success(id === NO_TITLE_ID ? 'titles.cleared' : 'titles.saved');
      this.log(`Title selected: ${id === NO_TITLE_ID ? 'none' : id}.`);
      eventBus.emit(EVENTS.TITLE_SELECTED, { id });
    } catch (error) {
      console.error('[TitlesView] The title could not be stored.', error);
      const key = getProfileErrorMessageKey(error);
      this.setFeedback(key, 'error');
      Toast.error(key);
    } finally {
      this.isSaving = false;
    }
  }

  /**
   * Opens the modal describing what unlocks one title.
   *
   * A collection title borrows the trophy detail of the trophies page (description, progress,
   * required cards, rewards): the player reads the exact requirement instead of a sentence that
   * would paraphrase it. A level title only needs the two levels - the one to reach, and the
   * current one.
   *
   * @param {string} id - Title id.
   * @returns {Promise<void>} Resolves once the modal is displayed.
   */
  async openCondition(id) {
    const title = this.titles?.all.find((candidate) => candidate.id === id) ?? null;
    if (!title || !this.modal || !this.modalBody || !this.modalTitle) {
      console.warn(`[TitlesView] Unknown title "${id}".`);
      return;
    }

    this.modalTitle.textContent = TitleManager.titleText(title, cardLanguage.getLang());
    this.modalBody.textContent = '';

    const intro = document.createElement('p');
    intro.className = 'titles-modal__intro';
    intro.textContent = i18n.t('titles.condition.intro');
    this.modalBody.appendChild(intro);

    if (title.source === TITLE_SOURCES.COLLECTION) {
      await this.renderTrophyCondition(title);
    } else {
      this.renderLevelCondition(title);
    }

    this.openModal(title.id);
  }

  /**
   * Renders the condition of a collection title: the trophy that grants it, in full.
   *
   * @param {object} title - Catalogue entry.
   * @returns {Promise<void>} Resolves once the body is built.
   */
  async renderTrophyCondition(title) {
    const trophy = TitlesView.findTrophy(this.trophyState, title.grantingTrophy);
    if (!trophy) {
      // A title whose trophy left the catalogue can no longer be unlocked: say so instead of
      // showing an empty modal.
      const missing = document.createElement('p');
      missing.className = 'titles-modal__text';
      missing.textContent = i18n.t('titles.condition.unknown');
      this.modalBody.appendChild(missing);
      return;
    }

    if (!trophy.unlocked) {
      const [icons, titles] = await Promise.all([
        profileIconManager.getIconsForTrophy(trophy).catch(() => []),
        titleManager.getTitlesForTrophy(trophy).catch(() => []),
      ]);
      this.modalBody.appendChild(TrophyDetail.buildDetailBody(trophy, {
        experiencePerTrophy: this.trophyState?.experiencePerTrophy ?? null,
        icons,
        titles,
      }));
      return;
    }

    const unlocked = document.createElement('p');
    unlocked.className = 'titles-modal__text';
    unlocked.textContent = i18n.t('titles.condition.unlocked', { trophy: TrophyDetail.trophyTitle(trophy) });
    this.modalBody.appendChild(unlocked);
  }

  /**
   * Renders the condition of a level title: the level to reach and the current one.
   *
   * @param {object} title - Catalogue entry.
   * @returns {void}
   */
  renderLevelCondition(title) {
    const current = Number.isInteger(this.trophyState?.level?.level) ? this.trophyState.level.level : null;
    const list = document.createElement('dl');
    list.className = 'card-modal__details';
    list.appendChild(TrophyDetail.buildDetailRow(
      i18n.t('titles.condition.level'),
      i18n.t('titles.condition.levelValue', { level: title.requiredLevel })
    ));
    list.appendChild(TrophyDetail.buildDetailRow(
      i18n.t('titles.condition.currentLevel'),
      current === null ? i18n.t('common.unknown') : String(current)
    ));
    this.modalBody.appendChild(list);
  }

  /**
   * Resolves the trophy that grants one title.
   *
   * The catalogue pairs a title with its trophy by extension id and name, never by a built
   * identifier.
   *
   * @param {object|null} trophyState - Value returned by `TrophyManager.evaluate()`.
   * @param {{setId: string, name: string}|null} grantingTrophy - Granting trophy descriptor.
   * @returns {object|null} The trophy, or null when it is not in the catalogue any more.
   */
  static findTrophy(trophyState, grantingTrophy) {
    if (!grantingTrophy) return null;
    return (trophyState?.trophies ?? []).find(
      (candidate) => candidate.setId === grantingTrophy.setId && candidate.name === grantingTrophy.name
    ) ?? null;
  }

  /**
   * Displays the condition modal and restarts its entry animation.
   *
   * @param {string} source - Identifier of the shown title.
   * @returns {void}
   */
  openModal(source) {
    this.modal.hidden = false;
    this.modal.classList.remove('is-opening');
    void this.modal.offsetWidth;
    this.modal.classList.add('is-opening');
    this.log(`Condition opened for "${source}".`);
  }

  /**
   * Closes the condition modal.
   *
   * @returns {void}
   */
  closeDetail() {
    if (!this.modal || this.modal.hidden) return;
    this.modal.hidden = true;
    this.modal.classList.remove('is-opening');
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
      console.warn(`[TitlesView] ${i18n.t(key)}`);
    }
  }

  /**
   * Rebuilds the list after a language change (the texts and the groups are translated).
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
   * Refreshes the unlock states when a trophy or a level moved, while the page is on screen.
   *
   * @returns {void}
   */
  handleProgressChanged() {
    if (this.isInitialized && !this.isLoading && this.isActive) {
      void this.reload();
    }
  }

  /**
   * Reloads the page when the view becomes active (a title may have been unlocked meanwhile).
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
    this.profile = null;
    this.trophyState = null;
    this.titles = null;
    this.categoryTabs.clear();
    this.categoryPanels.clear();
    this.isInitialized = false;
  }
}

export default TitlesView;

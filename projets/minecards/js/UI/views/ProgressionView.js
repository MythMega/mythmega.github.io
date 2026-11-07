/**
 * ProgressionView - The two completion bars of every extension.
 *
 * Reference: `js/business/CollectionManager.js` (`getCollectionView()`), the `.progression__*`
 * block of `css/views/collection.css` and `js/UI/views/CollectionView.js`, the page this one is
 * opened from.
 *
 * The page is reached from the collection, next to the binders, and comes back there with its own
 * back button; the router stays in `app.js`. It used to be a tab INSIDE the collection, which put a
 * whole second page in a box: the grid already fills the screen, so the strip had nothing to
 * switch to that was not another screen.
 *
 * ONE EXTENSION AT A TIME. The strip of buttons is built from the catalog, one button per
 * extension, and the panel below carries the two bars of the selected one: the page shows two
 * numbers per extension, so stacking eight of them would be a scroll with no reading order.
 *
 * THE TWO BARS
 *   - "Collection" counts the NUMBERS: the classic and the Full Art of a number are one index, so
 *     holding either completes it;
 *   - "Collection+" counts every PRINTING: the same number is worth two.
 * Promo cards never count (they are not drawable, so they cannot be missing) and an entry the
 * catalog does not know is skipped. Both counts come from the entries the manager already returns,
 * in a single pass; percentages are rounded, so `1 / 208` really is 0 %.
 *
 * Nothing is stored here: the page is a read-only report, rebuilt from the collection on every
 * activation, so an opening made meanwhile is already counted when the player comes back.
 */

import eventBus, { EVENTS } from '../../utils/EventBus.js';
import i18n from '../../utils/I18n.js';
import cardLanguage from '../../utils/CardLanguage.js';
import collectionManager from '../../business/CollectionManager.js';
import soundManager, { UI_SOUNDS } from '../../utils/SoundManager.js';

/** View name, matching `data-view="progression"` in `index.html`. */
export const PROGRESSION_VIEW_NAME = 'progression';

/**
 * View the back button returns to: the collection.
 *
 * Spelled out here rather than imported from `CollectionView`, which imports THIS module: the two
 * would then depend on each other (the same reason `TrophiesView` does it).
 */
export const PROGRESSION_BACK_VIEW = 'collection';

export class ProgressionView {
  /**
   * @param {HTMLElement} rootElement - The progression `<section>`.
   * @param {object} [options] - View options.
   * @param {(viewName: string) => void} [options.onNavigate] - Called by the back button to switch
   *   view (the router belongs to `app.js`, which passes its `show()`).
   */
  constructor(rootElement, { onNavigate = null } = {}) {
    if (!rootElement || typeof rootElement.querySelector !== 'function') {
      throw new TypeError('ProgressionView requires the progression section element.');
    }

    this.root = rootElement;
    this.backButton = this.root.querySelector('[data-progression-back]');
    this.tabsElement = this.root.querySelector('[data-progression-tabs]');
    this.panelsElement = this.root.querySelector('[data-progression-panels]');
    this.emptyElement = this.root.querySelector('[data-progression-empty]');
    this.feedbackElement = this.root.querySelector('[data-progression-feedback]');

    this.assertMarkup();

    /** @type {((viewName: string) => void)|null} */
    this.onNavigate = typeof onNavigate === 'function' ? onNavigate : null;

    /** @type {Array<object>} Collection entries of the last load. */
    this.entries = [];
    /** @type {Record<string, object>} Extension descriptors of the last load, keyed by id. */
    this.sets = {};
    /** @type {Array<object>} Rows of the last render (one per extension). */
    this.rows = [];
    /** @type {Map<string, HTMLButtonElement>} Tab buttons, keyed by extension id. */
    this.tabButtons = new Map();
    /** @type {Map<string, HTMLElement>} Panels, keyed by extension id. */
    this.panels = new Map();
    /** @type {string|null} Extension displayed, kept across a reload. */
    this.activeSetId = null;
    /** @type {boolean} True once `init()` bound everything. */
    this.isInitialized = false;
    /** @type {boolean} True when the view is the active one. */
    this.isActive = false;
    /** @type {boolean} True while the collection is being read. */
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
    console.info('[ProgressionView]', ...args);
  }

  /**
   * Verifies that the markup matches the contract expected by this view.
   *
   * @returns {void}
   * @throws {Error} When a required element is missing from `index.html`.
   */
  assertMarkup() {
    const missing = [
      ['[data-progression-back]', this.backButton],
      ['[data-progression-tabs]', this.tabsElement],
      ['[data-progression-panels]', this.panelsElement],
      ['[data-progression-empty]', this.emptyElement],
      ['[data-progression-feedback]', this.feedbackElement],
    ]
      .filter(([, element]) => !element)
      .map(([selector]) => selector);

    if (missing.length > 0) {
      throw new Error(`ProgressionView markup is incomplete, missing: ${missing.join(', ')}.`);
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
   * Binds the interactions and loads the first report.
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
   * Attaches the DOM listeners (back button and the strip of extensions).
   *
   * @returns {void}
   */
  bindEvents() {
    this.listen(this.backButton, 'click', () => this.onNavigate?.(PROGRESSION_BACK_VIEW));

    // One delegated listener: the buttons are rebuilt whenever the catalog changes.
    this.listen(this.tabsElement, 'click', (event) => {
      const button =
        event?.target instanceof Element ? event.target.closest('[data-progression-tab]') : null;
      if (button) this.showTab(button.dataset.progressionTab);
    });
    this.listen(this.tabsElement, 'keydown', (event) => this.handleTabKeyDown(event));

    this.log('DOM listeners bound.');
  }

  /**
   * Subscribes to the application events the view depends on.
   *
   * Like the statistics, the page repaints itself when it is shown: an opening made elsewhere is
   * therefore already counted when the player comes back.
   *
   * @returns {void}
   */
  subscribeToEvents() {
    this.unsubscribers.push(
      eventBus.on(EVENTS.VIEW_CHANGED, (payload) => {
        if (!payload || typeof payload.view !== 'string') return;
        if (payload.view === PROGRESSION_VIEW_NAME) {
          this.handleViewActivated();
        } else if (payload.previousView === PROGRESSION_VIEW_NAME) {
          this.handleViewDeactivated();
        }
      })
    );
    this.unsubscribers.push(eventBus.on(EVENTS.LANG_CHANGED, () => this.handleLanguageChanged()));
    this.unsubscribers.push(eventBus.on(EVENTS.CARD_LANG_CHANGED, () => this.handleLanguageChanged()));
    this.unsubscribers.push(
      eventBus.on(EVENTS.BOOSTER_OPENED, () => {
        if (this.isActive) void this.reload();
      })
    );
    this.log('Event subscriptions registered.');
  }

  /**
   * Reads the collection and draws the report.
   *
   * @returns {Promise<void>} Resolves once the report is drawn (or the error shown).
   */
  async reload() {
    if (this.isLoading) return;
    this.isLoading = true;
    this.setFeedback(null);
    try {
      const view = await collectionManager.getCollectionView();
      this.entries = view.entries ?? [];
      this.sets = view.sets ?? {};
      this.render();
    } catch (error) {
      console.error('[ProgressionView] The collection could not be loaded.', error);
      this.setFeedback('progression.error.load', 'error');
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Draws the strip and the panels of the current rows.
   *
   * @returns {void}
   */
  render() {
    const rows = this.buildRows();
    this.rows = rows;

    if (rows.length === 0) {
      this.tabButtons.clear();
      this.panels.clear();
      this.tabsElement.replaceChildren();
      this.panelsElement.replaceChildren();
      this.emptyElement.hidden = false;
      return;
    }

    this.emptyElement.hidden = true;
    this.renderPanels(rows);
    this.renderTabs(rows);
  }

  /**
   * Groups the catalog by extension.
   *
   * An entry of an extension file is one PRINTING: the classic and the Full Art of the same number
   * are two cards. The two bars therefore answer two questions - how many NUMBERS of the extension
   * are held ("Collection"), and how many PRINTINGS are held ("Collection+") - which is why both
   * are computed here, in the same pass over the entries.
   *
   * @returns {Array<{setId: string, name: string, cards: number, ownedCards: number,
   *   indexes: number, ownedIndexes: number}>} One row per extension, sorted by name.
   */
  buildRows() {
    const buckets = new Map();

    this.entries.forEach((entry) => {
      if (!entry || entry.promo || entry.orphan) return;
      const setId = entry.set;
      if (typeof setId !== 'string' || setId === '') return;

      const bucket = buckets.get(setId) ?? {
        setId,
        cards: 0,
        ownedCards: 0,
        indexes: new Set(),
        ownedIndexes: new Set(),
      };
      const indexKey = ProgressionView.indexKeyOf(entry);
      bucket.cards += 1;
      bucket.indexes.add(indexKey);
      if (entry.owned) {
        bucket.ownedCards += 1;
        bucket.ownedIndexes.add(indexKey);
      }
      buckets.set(setId, bucket);
    });

    return [...buckets.values()]
      .map((bucket) => ({
        setId: bucket.setId,
        name: this.sets[bucket.setId]?.name ?? bucket.setId,
        cards: bucket.cards,
        ownedCards: bucket.ownedCards,
        indexes: bucket.indexes.size,
        ownedIndexes: bucket.ownedIndexes.size,
      }))
      .sort((left, right) => String(left.name).localeCompare(String(right.name)));
  }

  /**
   * The number of an entry, whatever printing it is.
   *
   * A `collection` key is `<number>_<layout>` (`SERIE-A1 _ W001_classic`), and the entry already
   * carries the number as `cardId`: the fallback only serves a hand-built entry.
   *
   * @param {object} entry - Collection entry.
   * @returns {string} The number (e.g. `SERIE-A1 _ W001`).
   */
  static indexKeyOf(entry) {
    if (typeof entry.cardId === 'string' && entry.cardId !== '') return entry.cardId;
    return String(entry.key ?? '').replace(/_(?:classic|fullart)$/, '');
  }

  /**
   * DOM id of the panel of an extension.
   *
   * The id is derived from the extension id, which comes from `cardsets.json`: anything that is not
   * safe in an id is folded to a dash instead of being trusted.
   *
   * @param {string} setId - Extension id.
   * @returns {string} A valid element id.
   */
  static panelIdOf(setId) {
    return `progression-panel-${String(setId).replace(/[^A-Za-z0-9_-]+/g, '-')}`;
  }

  /**
   * Draws the buttons of the strip, one per extension.
   *
   * The roving tabindex keeps the strip to a single stop of the Tab key: only the selected button
   * is reachable with Tab, the others are reached with the arrows.
   *
   * @param {Array<object>} rows - Rows returned by `buildRows()`.
   * @returns {void}
   */
  renderTabs(rows) {
    const buttons = rows.map((row) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'progression__tab';
      button.id = `${ProgressionView.panelIdOf(row.setId)}-tab`;
      button.dataset.progressionTab = row.setId;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', ProgressionView.panelIdOf(row.setId));
      button.setAttribute('aria-selected', 'false');
      button.tabIndex = -1;
      button.textContent = row.name;
      return button;
    });

    this.tabsElement.replaceChildren(...buttons);
    this.tabButtons = new Map(buttons.map((button) => [button.dataset.progressionTab, button]));

    const keep = this.tabButtons.has(this.activeSetId)
      ? this.activeSetId
      : this.tabButtons.keys().next().value;
    this.showTab(keep, { silent: true });
  }

  /**
   * Draws one panel per extension, each holding its two bars.
   *
   * Every panel is built, then hidden but the selected one: switching tabs never recomputes
   * anything, and a panel keeps its bars whatever the width of the screen.
   *
   * @param {Array<object>} rows - Rows returned by `buildRows()`.
   * @returns {void}
   */
  renderPanels(rows) {
    const panels = rows.map((row) => {
      const panel = document.createElement('div');
      panel.className = 'progression__panel';
      panel.id = ProgressionView.panelIdOf(row.setId);
      panel.dataset.progressionPanel = row.setId;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', `${ProgressionView.panelIdOf(row.setId)}-tab`);
      panel.append(this.buildSet(row));
      return panel;
    });

    this.panelsElement.replaceChildren(...panels);
    this.panels = new Map(panels.map((panel) => [panel.dataset.progressionPanel, panel]));
  }

  /**
   * Shows one extension and hides the others.
   *
   * @param {string|null} setId - Extension to display.
   * @param {object} [options] - Display options.
   * @param {boolean} [options.silent=false] - Skips the sound and the log (used at render time).
   * @returns {void}
   */
  showTab(setId, { silent = false } = {}) {
    if (typeof setId !== 'string' || !this.tabButtons.has(setId)) return;
    const changed = this.activeSetId !== setId;
    this.activeSetId = setId;

    this.tabButtons.forEach((button, key) => {
      const isActive = key === setId;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-selected', isActive ? 'true' : 'false');
      button.tabIndex = isActive ? 0 : -1;
    });
    this.panels.forEach((panel, key) => {
      panel.hidden = key !== setId;
    });

    if (silent || !changed) return;
    soundManager.playUi(UI_SOUNDS.SECTION_SWITCH);
    this.log(`Extension "${setId}" displayed.`);
  }

  /**
   * Moves the selection with the keyboard, as a tab list is expected to answer.
   *
   * @param {KeyboardEvent} event - Key pressed inside the strip.
   * @returns {void}
   */
  handleTabKeyDown(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const names = [...this.tabButtons.keys()];
    if (names.length === 0) return;

    event.preventDefault();
    const current = Math.max(names.indexOf(this.activeSetId), 0);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? names.length - 1
          : event.key === 'ArrowLeft'
            ? (current - 1 + names.length) % names.length
            : (current + 1) % names.length;

    this.showTab(names[next]);
    this.tabButtons.get(names[next])?.focus();
  }

  /**
   * Builds the block of one extension: its name, its code, then the two bars.
   *
   * @param {object} row - Row returned by `buildRows()`.
   * @returns {HTMLElement} The block.
   */
  buildSet(row) {
    const block = document.createElement('article');
    block.className = 'progression__set';
    block.dataset.progressionSet = row.setId;

    const head = document.createElement('header');
    head.className = 'progression__head';
    const name = document.createElement('h3');
    name.className = 'progression__name';
    name.textContent = row.name;
    const code = document.createElement('span');
    code.className = 'progression__code';
    code.textContent = row.setId;
    head.append(name, code);

    block.append(
      head,
      this.buildBar({
        set: row.name,
        labelKey: 'collection.progression.basic',
        owned: row.ownedIndexes,
        total: row.indexes,
      }),
      this.buildBar({
        set: row.name,
        labelKey: 'collection.progression.plus',
        owned: row.ownedCards,
        total: row.cards,
      })
    );
    return block;
  }

  /**
   * Builds one labelled bar.
   *
   * The track is a real `progressbar`, so the percentage is read by a screen reader as well as seen;
   * the fill is a `<span>` whose width is the percentage, which keeps the animation trivial.
   *
   * @param {object} options - Bar description.
   * @param {string} options.set - Extension name (accessible label).
   * @param {string} options.labelKey - Translation key of the bar label.
   * @param {number} options.owned - Owned count.
   * @param {number} options.total - Total count.
   * @returns {HTMLElement} The row: its label, its value and the bar.
   */
  buildBar({ set, labelKey, owned, total }) {
    const percent = total > 0 ? Math.round((owned / total) * 100) : 0;
    const row = document.createElement('div');
    row.className = 'progression__row';
    if (owned >= total && total > 0) row.dataset.complete = 'true';

    const head = document.createElement('div');
    head.className = 'progression__row-head';
    const label = document.createElement('span');
    label.className = 'progression__label';
    label.textContent = i18n.t(labelKey);
    const value = document.createElement('span');
    value.className = 'progression__value';
    value.textContent = i18n.t('collection.progression.value', { owned, total, percent });
    head.append(label, value);

    const bar = document.createElement('div');
    bar.className = 'progression__bar';
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    bar.setAttribute('aria-valuenow', String(percent));
    bar.setAttribute('aria-valuetext', value.textContent);
    bar.setAttribute('aria-label', `${set} · ${i18n.t(labelKey)}`);
    const fill = document.createElement('span');
    fill.className = 'progression__fill';
    fill.style.width = `${percent}%`;
    bar.append(fill);

    row.append(head, bar);
    return row;
  }

  /**
   * Shows or clears the feedback line of the page.
   *
   * @param {string|null} key - Translation key, or null to clear.
   * @param {'info'|'success'|'error'} [tone='info'] - Tone of the message.
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
    if (tone === 'error') console.warn(`[ProgressionView] ${i18n.t(key)}`);
  }

  /**
   * Redraws the labels when the language changes.
   *
   * @returns {void}
   */
  handleLanguageChanged() {
    if (this.rows.length === 0) return;
    this.log(`Language changed, re-rendering (${i18n.getLang()}).`);
    this.render();
  }

  /**
   * Reloads the report when the page is shown.
   *
   * @returns {void}
   */
  handleViewActivated() {
    this.isActive = true;
    this.log('View activated.');
    if (this.isInitialized && !this.isLoading) void this.reload();
  }

  /**
   * Marks the page as hidden.
   *
   * @returns {void}
   */
  handleViewDeactivated() {
    this.isActive = false;
    this.log('View deactivated.');
  }

  /**
   * Releases the listeners and the subscriptions.
   *
   * @returns {void}
   */
  destroy() {
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers = [];
    this.bindings.forEach(({ target, type, handler }) => target.removeEventListener(type, handler));
    this.bindings = [];
    this.tabButtons.clear();
    this.panels.clear();
    this.rows = [];
    this.isInitialized = false;
    this.log('Destroyed.');
  }
}

export default ProgressionView;

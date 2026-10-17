/**
 * ViewHelp - The "how does it work?" mini popup of every view.
 *
 * Reference: `.docs/main.md` section 3.G (views and navigation).
 *
 * WHY A COMPONENT AND NOT MARKUP
 * Every page of the application answers a question a first-time player cannot guess from its title
 * alone ("Ouvrir", "Mine Pick", "Statistiques"). Instead of eight hand-written blocks in `index.html`
 * that would drift apart, the component walks the views, drops a small pill in the header of each one
 * and owns the popup it opens. Adding a view later is then one entry in the name list plus two
 * translation keys - a view whose section or header is missing is simply skipped with a warning, which
 * keeps a half-built view from breaking the boot of the whole application.
 *
 * WHAT THE POPUP CONTAINS
 * The title of the view, TWO sentences of explanation at most (`view.<name>.help`, kept in the two
 * dictionaries so they follow the language like the rest of the interface), and one button leading to
 * the information page, where the long version lives. The text is written through `data-i18n`, so a
 * language switch retranslates the popup without reopening it.
 *
 * BEHAVIOUR
 *   - one popup at a time: opening another one closes the previous one;
 *   - a click outside, or `Escape`, closes it;
 *   - the pill is the accessible control (`aria-expanded` + `aria-controls`); the panel is declared
 *     as a dialog labelled by the title of the view, and focus moves to its button on open, then back
 *     to the pill on close - the keyboard path stays inside the popup while it is open.
 */

import i18n from '../../utils/I18n.js';

/** Views that carry the popup, in the order of the bottom bar. */
export const VIEW_HELP_NAMES = Object.freeze([
  'opening',
  'collection',
  'profile',
  'stats',
  'trophies',
  'minepick',
  'mineblock',
  'settings',
  'info',
]);

/** View opened by the "more" button of every popup: the long-form explanations live there. */
export const VIEW_HELP_TARGET = 'info';

/** Class of the pill wrapper, exposed for the stylesheet and the tests. */
export const VIEW_HELP_CLASS = 'view-help';

export class ViewHelp {
  /**
   * @param {object} [options] - Component options.
   * @param {ParentNode} [options.root=document] - Subtree scanned for the views.
   * @param {((view: string) => void)|null} [options.onNavigate=null] - Called when the player asks for
   *   the information page (the caller owns the router).
   * @param {string[]} [options.views=VIEW_HELP_NAMES] - Views to equip.
   */
  constructor({ root = document, onNavigate = null, views = VIEW_HELP_NAMES } = {}) {
    this.root = root;
    this.onNavigate = typeof onNavigate === 'function' ? onNavigate : null;
    this.views = Array.from(views);
    /** @type {Map<string, HTMLElement>} Wrapper mounted per view, keyed by view name. */
    this.mounts = new Map();
    /** @type {HTMLElement|null} Currently open wrapper. */
    this.openWrapper = null;
    /** @type {Array<{target: EventTarget, type: string, handler: EventListener}>} */
    this.bindings = [];
  }

  /**
   * Logs with the component prefix.
   *
   * @param {...unknown} args - Values forwarded to `console.info`.
   * @returns {void}
   */
  log(...args) {
    console.info('[ViewHelp]', ...args);
  }

  /**
   * Mounts the pill and the popup of every declared view.
   *
   * @returns {number} The number of views equipped (zero means the markup is not the expected one).
   */
  mount() {
    this.views.forEach((name) => this.mountView(name));

    if (this.mounts.size === 0) {
      console.warn('[ViewHelp] No view header was found: the popups are not mounted.');
      return 0;
    }

    this.bindGlobalEvents();
    this.log(`Mounted on ${this.mounts.size} view(s): [${Array.from(this.mounts.keys()).join(', ')}].`);
    return this.mounts.size;
  }

  /**
   * Builds the pill and its popup, and appends them to the header of one view.
   *
   * @param {string} name - View name (`data-view` value).
   * @returns {HTMLElement|null} The wrapper, or null when the view has no header to attach to.
   */
  mountView(name) {
    if (this.mounts.has(name)) return this.mounts.get(name);

    const section = this.root.querySelector(`[data-view="${name}"]`);
    const header = section?.querySelector('.view__header');
    if (!header) {
      console.warn(`[ViewHelp] The view "${name}" has no ".view__header": its popup is skipped.`);
      return null;
    }

    const wrapper = document.createElement('div');
    wrapper.className = VIEW_HELP_CLASS;
    wrapper.dataset.viewHelp = name;

    const panelId = `view-help-panel-${name}`;
    const titleId = `view-help-title-${name}`;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'view-help__button';
    button.dataset.viewHelpToggle = name;
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', panelId);
    button.setAttribute('aria-label', `${i18n.t('view.help.label')} (${i18n.t(`view.${name}.title`)})`);
    button.appendChild(ViewHelp.buildInfoIcon());
    const label = document.createElement('span');
    label.dataset.i18n = 'view.help.label';
    label.textContent = i18n.t('view.help.label');
    button.appendChild(label);

    const panel = document.createElement('div');
    panel.className = 'view-help__panel';
    panel.id = panelId;
    panel.dataset.viewHelpPanel = name;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-labelledby', titleId);
    panel.hidden = true;

    const title = document.createElement('p');
    title.className = 'view-help__title';
    title.id = titleId;
    title.dataset.i18n = `view.${name}.title`;
    title.textContent = i18n.t(`view.${name}.title`);

    const text = document.createElement('p');
    text.className = 'view-help__text';
    text.dataset.i18n = `view.${name}.help`;
    text.textContent = i18n.t(`view.${name}.help`);

    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'btn btn--ghost btn--small view-help__more';
    more.dataset.viewHelpMore = name;
    more.dataset.i18n = 'view.help.more';
    more.textContent = i18n.t('view.help.more');

    panel.append(title, text, more);
    wrapper.append(button, panel);
    header.appendChild(wrapper);

    this.listen(button, 'click', () => this.toggle(name));
    this.listen(more, 'click', () => this.navigate());

    this.mounts.set(name, wrapper);
    return wrapper;
  }

  /**
   * Builds the small "information" icon of the pill (an inline SVG path, never a picture).
   *
   * @returns {SVGElement} The icon.
   */
  static buildInfoIcon() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('class', 'view-help__icon');
    const circle = document.createElementNS(NS, 'circle');
    circle.setAttribute('cx', '12');
    circle.setAttribute('cy', '12');
    circle.setAttribute('r', '9');
    const stem = document.createElementNS(NS, 'path');
    stem.setAttribute('d', 'M12 11v6');
    const dot = document.createElementNS(NS, 'path');
    dot.setAttribute('d', 'M12 7.6v.8');
    svg.append(circle, stem, dot);
    return svg;
  }

  /**
   * Opens the popup of a view, closing whichever other popup was open.
   *
   * @param {string} name - View name.
   * @returns {boolean} True when a popup was opened.
   */
  open(name) {
    const wrapper = this.mounts.get(name);
    if (!wrapper) return false;
    if (this.openWrapper && this.openWrapper !== wrapper) {
      this.close();
    }

    const button = wrapper.querySelector('[data-view-help-toggle]');
    const panel = wrapper.querySelector('[data-view-help-panel]');
    if (!panel) return false;

    panel.hidden = false;
    button?.setAttribute('aria-expanded', 'true');
    this.openWrapper = wrapper;
    // The keyboard path enters the popup on its only action, which is also what tells a screen
    // reader that the content appeared without moving the visual focus away from the header.
    panel.querySelector('[data-view-help-more]')?.focus();
    this.log(`Opened for "${name}".`);
    return true;
  }

  /**
   * Closes the open popup, if any, and returns the focus to its pill.
   *
   * @param {object} [options] - Behaviour options.
   * @param {boolean} [options.restoreFocus=true] - Moves the focus back to the pill button.
   * @returns {boolean} True when a popup was closed.
   */
  close({ restoreFocus = true } = {}) {
    const wrapper = this.openWrapper;
    if (!wrapper) return false;

    wrapper.querySelector('[data-view-help-panel]').hidden = true;
    const button = wrapper.querySelector('[data-view-help-toggle]');
    button?.setAttribute('aria-expanded', 'false');
    this.openWrapper = null;
    if (restoreFocus) {
      button?.focus();
    }
    return true;
  }

  /**
   * Toggles the popup of a view.
   *
   * @param {string} name - View name.
   * @returns {void}
   */
  toggle(name) {
    if (this.openWrapper && this.openWrapper.dataset.viewHelp === name) {
      this.close();
      return;
    }
    this.open(name);
  }

  /**
   * Leads the player to the information page and closes the popup.
   *
   * Without a navigation callback (a caller that only mounts the markup) the popup still closes: a
   * button that does nothing at all would be worse than one that only closes.
   *
   * @returns {void}
   */
  navigate() {
    this.close({ restoreFocus: false });
    if (this.onNavigate) {
      this.onNavigate(VIEW_HELP_TARGET);
      this.log(`Navigation requested to "${VIEW_HELP_TARGET}".`);
    }
  }

  /**
   * Registers the listeners shared by every popup: `Escape` and a click outside.
   *
   * A single listener on the document, rather than one per popup, keeps the component from adding
   * sixteen listeners to close something that only one element can open.
   *
   * @returns {void}
   */
  bindGlobalEvents() {
    this.listen(document, 'keydown', (event) => {
      if (event?.key === 'Escape' && this.openWrapper) {
        this.close();
      }
    });
    this.listen(document, 'click', (event) => {
      if (!this.openWrapper) return;
      if (event.target instanceof Node && this.openWrapper.contains(event.target)) return;
      this.close({ restoreFocus: false });
    });
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
   * Removes every listener and every mounted popup (full reset and teardown).
   *
   * @returns {void}
   */
  destroy() {
    this.bindings.forEach(({ target, type, handler }) => target.removeEventListener(type, handler));
    this.bindings = [];
    this.mounts.forEach((wrapper) => wrapper.remove());
    this.mounts.clear();
    this.openWrapper = null;
    this.log('Destroyed.');
  }
}

export default ViewHelp;

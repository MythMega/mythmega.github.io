/**
 * SpaRouter - Single Page Application view switcher.
 *
 * Reference: `.docs/main.md` section 3.G (views and navigation) and `.docs/steps/1.md` point 9.
 *
 * Exactly one `<section class="view" data-view="...">` is active at a time. Views are
 * discovered from the DOM (`data-view` attribute) and the bottom navigation buttons are
 * declared with `data-nav-target="<view>"`, so adding a view only requires markup:
 * no route table to maintain.
 *
 * Views are never destroyed when hidden: they stay in the DOM and later steps hook the
 * `VIEW_CHANGED` event to load their data on demand (and to release expensive resources such
 * as the WebGL context of the 3D booster scene in step 4).
 */

import eventBus, { EVENTS } from '../utils/EventBus.js';
import soundManager, { UI_SOUNDS } from '../utils/SoundManager.js';

/** Attribute identifying a view section. */
export const VIEW_ATTRIBUTE = 'data-view';

/** Attribute identifying a bottom navigation button. */
export const NAV_ATTRIBUTE = 'data-nav-target';

/** Class applied to the active view. */
export const ACTIVE_VIEW_CLASS = 'is-active';

export class SpaRouter {
  /**
   * @param {object} [options] - Router options.
   * @param {string|null} [options.defaultView=null] - View shown by `start()` when no initial
   *   view is provided.
   * @param {ParentNode} [options.root=document] - Subtree scanned for views and nav buttons.
   */
  constructor({ defaultView = null, root = document } = {}) {
    this.defaultView = defaultView;
    this.root = root;
    /** @type {Map<string, HTMLElement>} Registered views, keyed by view name. */
    this.views = new Map();
    /** @type {Array<{element: HTMLElement, handler: EventListener}>} Bound nav buttons. */
    this.navBindings = [];
    /** @type {string|null} Currently active view name. */
    this.currentView = null;
  }

  /**
   * Discovers every `[data-view]` section of the root subtree.
   *
   * @returns {string[]} The discovered view names.
   * @throws {Error} When two sections declare the same view name.
   */
  discoverViews() {
    this.root.querySelectorAll(`[${VIEW_ATTRIBUTE}]`).forEach((element) => {
      const name = element.getAttribute(VIEW_ATTRIBUTE);
      if (!name) return;
      if (this.views.has(name) && this.views.get(name) !== element) {
        throw new Error(`Two view sections declare the same name "${name}".`);
      }
      this.registerView(name, element);
    });
    return Array.from(this.views.keys());
  }

  /**
   * Registers a view element.
   *
   * @param {string} name - View name.
   * @param {HTMLElement} element - View section.
   * @returns {void}
   * @throws {TypeError} When the name or the element is invalid.
   */
  registerView(name, element) {
    if (typeof name !== 'string' || name.trim() === '') {
      throw new TypeError('SpaRouter.registerView requires a non-empty view name.');
    }
    if (!element || typeof element.classList === 'undefined') {
      throw new TypeError(`SpaRouter.registerView("${name}") requires a DOM element.`);
    }
    this.views.set(name.trim(), element);
    element.setAttribute('aria-hidden', 'true');
  }

  /**
   * Checks whether a view is registered.
   *
   * @param {string} name - View name.
   * @returns {boolean} True when the view exists.
   */
  hasView(name) {
    return this.views.has(name);
  }

  /**
   * Returns the element of a view.
   *
   * @param {string} name - View name.
   * @returns {HTMLElement|null} The view element, or null when unknown.
   */
  getViewElement(name) {
    return this.views.get(name) ?? null;
  }

  /**
   * Hooks every `[data-nav-target]` button so a tap switches the view.
   *
   * @returns {number} The number of bound buttons.
   */
  bindNavigation() {
    this.root.querySelectorAll(`[${NAV_ATTRIBUTE}]`).forEach((button) => {
      const handler = () => this.show(button.getAttribute(NAV_ATTRIBUTE));
      button.addEventListener('click', handler);
      this.navBindings.push({ element: button, handler });
    });
    return this.navBindings.length;
  }

  /**
   * Shows a view and hides the previous one.
   *
   * @param {string} name - View name to activate.
   * @param {object} [options] - Behaviour options.
   * @param {boolean} [options.scrollToTop=true] - Scrolls the page back to the top.
   * @returns {string} The active view name.
   * @throws {RangeError} When the view is unknown.
   */
  show(name, { scrollToTop = true } = {}) {
    const target = this.views.get(name);
    if (!target) {
      throw new RangeError(
        `Unknown view "${name}". Registered views: [${Array.from(this.views.keys()).join(', ')}].`
      );
    }
    if (this.currentView === name) return this.currentView;

    const previousView = this.currentView;
    const previousElement = previousView ? this.views.get(previousView) : null;
    if (previousElement) {
      previousElement.classList.remove(ACTIVE_VIEW_CLASS);
      previousElement.setAttribute('aria-hidden', 'true');
    }

    // A sub-page (trophies, titles, statistics) declares its own back button: going back to the
    // profile from one of them is a retreat, not a tab switch. The router stays generic: it reads
    // the markup instead of knowing the view names.
    if (previousElement) {
      const leavesSubPage = previousElement.querySelector('[data-trophies-back], [data-titles-back], [data-stats-back]') !== null;
      soundManager.playUi(
        leavesSubPage && name === 'profile' ? UI_SOUNDS.NAV_BACK : UI_SOUNDS.NAV_VIEW
      );
    }

    target.classList.add(ACTIVE_VIEW_CLASS);
    target.setAttribute('aria-hidden', 'false');
    this.currentView = name;
    this.syncNavigationState(name);

    if (scrollToTop) {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }

    eventBus.emit(EVENTS.VIEW_CHANGED, { view: name, previousView });
    return this.currentView;
  }

  /**
   * Reflects the active view on the navigation buttons (`aria-current` + active class).
   *
   * @param {string} name - Active view name.
   * @returns {void}
   */
  syncNavigationState(name) {
    this.root.querySelectorAll(`[${NAV_ATTRIBUTE}]`).forEach((button) => {
      const isCurrent = button.getAttribute(NAV_ATTRIBUTE) === name;
      button.classList.toggle(ACTIVE_VIEW_CLASS, isCurrent);
      if (isCurrent) {
        button.setAttribute('aria-current', 'page');
      } else {
        button.removeAttribute('aria-current');
      }
    });
  }

  /**
   * Discovers the views, binds the navigation and activates the initial view.
   *
   * @param {string|null} [initialView=null] - View to activate (defaults to `defaultView`,
   *   then to the first discovered view).
   * @returns {string} The activated view name.
   * @throws {RangeError} When no view is available or the requested view is unknown.
   */
  start(initialView = null) {
    if (this.views.size === 0) {
      this.discoverViews();
    }
    this.bindNavigation();

    const target = initialView || this.defaultView || Array.from(this.views.keys())[0];
    if (!target) {
      throw new RangeError('SpaRouter.start() found no [data-view] section in the document.');
    }
    return this.show(target);
  }

  /**
   * Currently active view name.
   *
   * @returns {string|null} The view name, or null before the first `show()`.
   */
  getCurrentView() {
    return this.currentView;
  }

  /**
   * Removes the navigation listeners (used by a full reset).
   *
   * @returns {void}
   */
  destroy() {
    this.navBindings.forEach(({ element, handler }) => element.removeEventListener('click', handler));
    this.navBindings = [];
  }
}

export default SpaRouter;

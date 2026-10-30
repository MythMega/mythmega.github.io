/**
 * InfoHint - The small "i" that reveals the explanation of one panel.
 *
 * Reference: the detail help of the settings and profile panels, which used to be printed under
 * every control. A page of the game is read once; the sentence explaining how a slider works is
 * useful the first time and noise afterwards. The explanation therefore stays in the markup (it is
 * the same `data-i18n` text as before) but moves behind a discreet icon, and the Information page
 * prints it again with the long-form rules.
 *
 * CONTRACT
 *   - an element carrying `data-info-hint="<group>"` opts in; the value names the hint, so two
 *     sentences that explain the same panel share one icon by using the same group;
 *   - the icon is placed inside the nearest preceding heading or field label of the sentence (the
 *     title of the panel, the label of the slider), which is where a reader looks for it; a sentence
 *     with no such neighbour keeps its place and the icon is inserted there instead;
 *   - the sentence itself is MOVED into the popover, never copied: a view that rewrites it later
 *     (`ProfileView` does, for the colours) keeps writing to the element it already holds;
 *   - `replace: true` clears the popover first, which is what a view that re-renders its own
 *     explanation on every draw (`MineBlockView`) needs.
 *
 * BEHAVIOUR
 *   - one popover at a time; `Escape` and a click outside close it;
 *   - the button is the accessible control (`aria-expanded` + `aria-controls`), labelled through
 *     `data-i18n-aria-label` so a language switch retranslates it;
 *   - the popover is clamped to the viewport: it opens below the icon, flips above it when there is
 *     no room, and never runs past the right edge;
 *   - without JavaScript the sentences simply stay visible where they are written.
 */

import i18n from '../../utils/I18n.js';
import soundManager, { UI_SOUNDS } from '../../utils/SoundManager.js';

/** Class of the icon wrapper, exposed for the stylesheet. */
export const INFO_HINT_CLASS = 'info-hint';

/** Attribute that opts an explanation in and names its group. */
export const INFO_HINT_SOURCE_ATTRIBUTE = 'data-info-hint';

/** Neighbours an icon can be attached to, next to the control the explanation belongs to. */
const ANCHOR_SELECTOR = 'h3, h4, .field__label, .profile-card-panel__colors-title';

/** Gap kept between an open popover and the edge of the viewport, in pixels. */
const VIEWPORT_MARGIN = 8;

export class InfoHint {
  /**
   * @param {object} [options] - Component options.
   * @param {ParentNode} [options.root=document] - Subtree scanned by `mount()`.
   */
  constructor({ root = document } = {}) {
    this.root = root;
    /** @type {Map<string, {group: string, wrapper: HTMLElement, button: HTMLButtonElement, panel: HTMLElement}>} */
    this.hints = new Map();
    /** @type {WeakSet<HTMLElement>} Sources already mounted, so a second `mount()` is a no-op. */
    this.attached = new WeakSet();
    /** @type {WeakMap<HTMLElement, {parent: Element|null, nextSibling: Node|null}>} Where each
     *   explanation came from, so `destroy()` can put it back (a language switch rebuilds the app). */
    this.origins = new WeakMap();
    /** @type {Array<{target: EventTarget, type: string, handler: EventListener}>} */
    this.bindings = [];
    /** @type {number} Fallback counter for sources that declare no group name. */
    this.counter = 0;
    /** @type {object|null} Open hint, if any. */
    this.openHint = null;
    /** @type {boolean} True once the shared listeners are registered. */
    this.isBound = false;
  }

  /**
   * Logs with the component prefix.
   *
   * @param {...unknown} args - Values forwarded to `console.info`.
   * @returns {void}
   */
  log(...args) {
    console.info('[InfoHint]', ...args);
  }

  /**
   * Mounts every explanation of the subtree that is not mounted yet.
   *
   * @returns {number} The number of hints known to the component.
   */
  mount() {
    this.root.querySelectorAll(`[${INFO_HINT_SOURCE_ATTRIBUTE}]`).forEach((source) => this.attach(source));
    if (this.hints.size > 0) {
      this.bindGlobalEvents();
      this.log(`Mounted ${this.hints.size} hint(s).`);
    }
    return this.hints.size;
  }

  /**
   * Hides one explanation behind an icon.
   *
   * @param {HTMLElement} source - Element carrying the explanation (usually a `<p>`).
   * @param {object} [options] - Placement options.
   * @param {HTMLElement|null} [options.anchor=null] - Element the icon is appended to; by default
   *   the nearest preceding heading or label of the source.
   * @param {boolean} [options.replace=false] - Clears an existing hint of the same group first.
   * @returns {object|null} The hint, or null when the source cannot be mounted.
   */
  attach(source, { anchor = null, replace = false } = {}) {
    if (!(source instanceof HTMLElement)) {
      console.warn('[InfoHint] Ignoring an explanation that is not an element.');
      return null;
    }
    const declared = source.dataset.infoHint;
    const group = typeof declared === 'string' && declared !== ''
      ? declared
      : `auto-${++this.counter}`;

    if (this.attached.has(source)) return this.hints.get(group) ?? null;

    const existing = this.hints.get(group) ?? null;
    if (existing) {
      if (replace) existing.panel.textContent = '';
      this.origins.set(source, { parent: source.parentElement, nextSibling: source.nextSibling });
      InfoHint.markSource(source);
      existing.panel.appendChild(source);
      this.attached.add(source);
      return existing;
    }

    // The anchor and the original position are read BEFORE the sentence moves into the popover:
    // once it is detached it has no previous sibling left to walk.
    const parent = source.parentElement;
    const nextSibling = source.nextSibling;
    this.origins.set(source, { parent, nextSibling });
    const host = anchor ?? this.findAnchor(source) ?? null;
    const panelId = `info-hint-${InfoHint.slug(group)}`;

    const wrapper = document.createElement('span');
    wrapper.className = INFO_HINT_CLASS;
    wrapper.dataset.infoHintGroup = group;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'info-hint__toggle';
    button.dataset.infoHintToggle = group;
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', panelId);
    button.setAttribute('aria-label', i18n.t('info.hint.label'));
    button.dataset.i18nAriaLabel = 'info.hint.label';
    button.appendChild(InfoHint.buildInfoIcon());

    const panel = document.createElement('span');
    panel.className = 'info-hint__panel';
    panel.id = panelId;
    panel.hidden = true;

    InfoHint.markSource(source);
    panel.appendChild(source);
    wrapper.appendChild(button);
    // The popover is a SIBLING of the sentence's original container, never a child of the heading:
    // a heading must keep only its icon in its text, and the sentence must stay inside the view that
    // owns it (a view keeps direct references to some of these elements and rewrites them). It is
    // `position: fixed`, so its parent has no effect on where it opens.
    (parent ?? document.body).appendChild(panel);

    const hint = { group, wrapper, button, panel };
    if (host) {
      InfoHint.detachTranslation(host);
      host.appendChild(wrapper);
    } else if (parent) {
      parent.insertBefore(wrapper, nextSibling);
    }

    this.listen(button, 'click', () => this.toggle(hint));
    this.bindGlobalEvents();
    this.hints.set(group, hint);
    this.attached.add(source);
    return hint;
  }

  /**
   * Finds the heading or label the icon should sit next to.
   *
   * The walk goes through the previous siblings of the sentence (the controls it explains), which
   * is what lands on the title of a panel or the label of a slider without knowing the markup of
   * the view that hosts it.
   *
   * @param {HTMLElement} source - Explanation being mounted.
   * @returns {Element|null} The neighbour, or null when the sentence is first in its container.
   */
  findAnchor(source) {
    let node = source.previousElementSibling;
    while (node) {
      if (node.matches(ANCHOR_SELECTOR)) return node;
      node = node.previousElementSibling;
    }
    return null;
  }

  /**
   * Moves the `data-i18n` of an anchor into an inner span before the icon is appended to it.
   *
   * `I18n.applyToDom()` translates a tagged element by rewriting its `textContent`, children
   * included. An icon appended to a tagged title would therefore be erased by the first language
   * switch, together with the explanation it holds. The attribute moves to a span that wraps the
   * text, so a later translation only replaces that span and leaves the icon in place.
   *
   * @param {Element} anchor - Heading or label that receives the icon.
   * @returns {void}
   */
  static detachTranslation(anchor) {
    const key = anchor?.getAttribute('data-i18n');
    if (!key) return;
    const text = document.createElement('span');
    text.dataset.i18n = key;
    while (anchor.firstChild) text.appendChild(anchor.firstChild);
    anchor.removeAttribute('data-i18n');
    anchor.appendChild(text);
  }

  /**
   * Adds the classes shared by every mounted explanation.
   *
   * @param {HTMLElement} source - Explanation being mounted.
   * @returns {void}
   */
  static markSource(source) {
    source.classList.add('info-hint__text');
    source.dataset.infoHintMounted = 'true';
  }

  /**
   * Builds the small "information" icon (an inline SVG, never a picture).
   *
   * @returns {SVGElement} The icon.
   */
  static buildInfoIcon() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('class', 'info-hint__icon');
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
   * Turns a group name into a valid element id.
   *
   * @param {string} value - Group name.
   * @returns {string} The id suffix.
   */
  static slug(value) {
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
  }

  /**
   * Opens or closes a hint.
   *
   * @param {object} hint - Hint returned by `attach()`.
   * @returns {void}
   */
  toggle(hint) {
    if (this.openHint === hint) {
      this.close();
      return;
    }
    this.open(hint);
  }

  /**
   * Opens a hint, closing the previous one.
   *
   * @param {object} hint - Hint to open.
   * @returns {void}
   */
  open(hint) {
    if (!hint) return;
    // A view may empty an explanation it no longer applies (`ProfileView` drops the background help
    // when no favourite card is offered): an icon that opens nothing must stay closed.
    if (hint.panel.textContent.trim() === '') return;
    if (this.openHint && this.openHint !== hint) this.close({ restoreFocus: false });

    hint.panel.hidden = false;
    hint.button.setAttribute('aria-expanded', 'true');
    this.openHint = hint;
    soundManager.playUi(UI_SOUNDS.PANEL_OPEN);
    this.position(hint);
    this.log(`Opened "${hint.group}".`);
  }

  /**
   * Places the popover next to its icon, inside the viewport.
   *
   * The popover is `position: fixed`: it escapes the scrolling box of a dialog (the daily Sparks
   * offer lives inside the trader modal) and is placed from the icon's own rectangle, so it stays
   * readable whatever the panel that hosts it. It opens below the icon, flips above it when the
   * bottom of the screen would cut it, and never runs past either edge.
   *
   * @param {object} hint - Open hint.
   * @returns {void}
   */
  position(hint) {
    const { panel, button } = hint;
    const margin = VIEWPORT_MARGIN;
    panel.style.left = '0px';
    panel.style.top = '0px';
    panel.style.maxWidth = '';

    const available = Math.max(window.innerWidth - 2 * margin, 140);
    panel.style.maxWidth = `${Math.min(available, 21 * 16)}px`;

    const rect = panel.getBoundingClientRect();
    if (rect.width === 0) return;

    const icon = button.getBoundingClientRect();
    const left = Math.min(Math.max(icon.left, margin), window.innerWidth - rect.width - margin);
    let top = icon.bottom + 6;
    if (top + rect.height > window.innerHeight - margin) {
      top = Math.max(margin, icon.top - rect.height - 6);
    }

    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;

    // A transformed ancestor (the entry animation of a view leaves a `translateY` on `.view`) turns
    // the element into the containing block of a fixed child, so the applied coordinates are read
    // back once and corrected: the popover lands on the icon whatever box the browser chose.
    const placed = panel.getBoundingClientRect();
    const shiftX = left - placed.left;
    const shiftY = top - placed.top;
    if (Math.abs(shiftX) > 0.5 || Math.abs(shiftY) > 0.5) {
      panel.style.left = `${left + shiftX}px`;
      panel.style.top = `${top + shiftY}px`;
    }
  }

  /**
   * Closes the open hint, if any.
   *
   * @param {object} [options] - Behaviour options.
   * @param {boolean} [options.restoreFocus=false] - Gives the focus back to the icon.
   * @returns {boolean} True when a hint was closed.
   */
  close({ restoreFocus = false } = {}) {
    const hint = this.openHint;
    if (!hint) return false;
    hint.panel.hidden = true;
    hint.button.setAttribute('aria-expanded', 'false');
    this.openHint = null;
    soundManager.playUi(UI_SOUNDS.PANEL_CLOSE);
    if (restoreFocus) hint.button.focus();
    return true;
  }

  /**
   * Registers the listeners shared by every hint: `Escape` and a click outside.
   *
   * @returns {void}
   */
  bindGlobalEvents() {
    if (this.isBound) return;
    this.isBound = true;
    this.listen(document, 'keydown', (event) => {
      if (event?.key === 'Escape' && this.openHint) this.close({ restoreFocus: true });
    });
    this.listen(document, 'click', (event) => {
      if (!this.openHint) return;
      if (event.target instanceof Node && this.openHint.wrapper.contains(event.target)) return;
      this.close();
    });
    // A fixed popover does not follow its icon: the first scroll closes it instead of leaving it
    // floating over unrelated content (the capture phase also catches the dialogs' own scrolling).
    this.listen(document, 'scroll', () => {
      if (this.openHint) this.close();
    }, true);
  }

  /**
   * Registers a listener and remembers it for `destroy()`.
   *
   * @param {EventTarget} target - Event target.
   * @param {string} type - Event type.
   * @param {EventListener} handler - Listener.
   * @param {AddEventListenerOptions|boolean} [options=false] - Listener options (the capture flag
   *   is needed for `scroll`, which does not bubble).
   * @returns {void}
   */
  listen(target, type, handler, options = false) {
    target.addEventListener(type, handler, options);
    this.bindings.push({ target, type, handler, options });
  }

  /**
   * Removes every listener and every mounted icon (full reset, teardown).
   *
   * @returns {void}
   */
  destroy() {
    this.close({ restoreFocus: false });
    this.bindings.forEach(({ target, type, handler, options }) => target.removeEventListener(type, handler, options));
    this.bindings = [];
    this.hints.forEach(({ wrapper, panel }) => {
      // The sentences are the original markup, not a copy: they go back to their parent before the
      // wrapper disappears, otherwise a teardown followed by a new mount (a language switch) would
      // leave the page without any explanation to mount.
      Array.from(panel.querySelectorAll('.info-hint__text')).forEach((source) => {
        const origin = this.origins.get(source);
        if (origin?.parent) {
          const next = origin.nextSibling?.parentNode === origin.parent ? origin.nextSibling : null;
          origin.parent.insertBefore(source, next);
        } else if (wrapper.parentElement) {
          wrapper.parentElement.insertBefore(source, wrapper);
        }
      });
      panel.remove();
      wrapper.remove();
    });
    this.hints.clear();
    this.attached = new WeakSet();
    this.origins = new WeakMap();
    this.isBound = false;
    this.log('Destroyed.');
  }
}

/** Shared instance: settings, profile and mine block all declare their explanations in markup. */
export const infoHint = new InfoHint();

export default infoHint;

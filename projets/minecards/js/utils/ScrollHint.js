/**
 * ScrollHint - the thin bar drawn on a box while it scrolls.
 *
 * Reference: the `Scrollbars` section of `css/base.css`, which hides the native bar of every
 * element, and the `.scroll-hint` block at the end of the same file, which styles this layer.
 *
 * WHY
 * The game scrolls in two kinds of places: the page itself, and the dialogs whose body has a
 * maximum height (the card detail, the daily offer, the information page). A system scrollbar next
 * to those panels reads as a browser widget that escaped its window, so the native one is hidden
 * everywhere. Hiding it also removes the only feedback a long list gives, which is the problem this
 * module solves: it paints a thin bar back while the content moves, and fades it out once the
 * player stops.
 *
 * CONTRACT
 *   - one listener, on `document` in the capture phase: `scroll` does not bubble, so the capture
 *     phase is the only way to hear the scrolling of a dialog from a single place, without watching
 *     boxes appear;
 *   - the layer is `position: fixed` and `pointer-events: none`: it never swallows a click, and it is
 *     placed from the rectangle of the box it follows, whatever view that box lives in;
 *   - the bar is a HINT, not a control, so it cannot be dragged. A hidden native bar cannot be
 *     dragged either: nothing is lost, and the wheel, the finger and the scroll snapping of the
 *     horizontal strips keep working untouched;
 *   - a box that scrolls both ways shows its vertical bar: a panel taller than its frame is read
 *     top to bottom, the sideways overflow of that same panel is the rare case;
 *   - the native bar can be asked for from the settings screen: `setNativeBars()` writes
 *     `data-native-scrollbars` on `<html>`, which turns the hiding rules of the stylesheet off and
 *     keeps this layer out of the way.
 *
 * LIMITS
 *   - the bar disappears with an idle timer, not with the end of the gesture: a dialog closed inside
 *     that window leaves the bar on screen for `IDLE_MS` at the place it was;
 *   - `prefers-reduced-motion` is honoured by `css/animations/accessibility.css`, which shortens the
 *     fade to nothing: the bar then simply appears and disappears.
 */

/** Class of the layer, exposed for the stylesheet. */
export const SCROLL_HINT_CLASS = 'scroll-hint';

/** Class revealing the layer (`opacity` in `css/base.css`). */
export const SCROLL_HINT_VISIBLE_CLASS = 'is-visible';

/** Id of the layer: a second `start()` reuses the mounted one instead of stacking a second bar. */
const LAYER_ID = 'scroll-hint-layer';

/** Thickness of the bar, in pixels. */
const THICKNESS = 4;

/** Shortest bar drawn, so a very long list still shows something a player notices. */
const MIN_LENGTH = 28;

/** Distance kept between the bar and the edge of its box, in pixels. */
const EDGE_GAP = 3;

/** Time the bar stays on screen after the last movement, in milliseconds. */
const IDLE_MS = 700;

export class ScrollHint {
  constructor() {
    /** @type {HTMLElement|null} Fixed layer holding the bar, created by `mount()`. */
    this.layer = null;
    /** @type {HTMLElement|null} The bar itself, the only element whose geometry changes. */
    this.bar = null;
    /** @type {HTMLElement|null} Box currently followed (the page's `<html>` for the page scroll). */
    this.container = null;
    /** @type {number|null} Pending animation frame, if a scroll is waiting to be painted. */
    this.frame = null;
    /** @type {number|null} Pending idle timer, if the bar is on screen. */
    this.idleTimer = null;
    /** @type {EventListener|null} */
    this.onScroll = null;
    /** @type {EventListener|null} */
    this.onResize = null;
    /** @type {boolean} True once the listeners are registered. */
    this.started = false;
  }

  /**
   * Starts following the scrolling of the page and of every box inside it.
   *
   * Idempotent, because two entry points call it: the game (`js/app.js`) and the shared binder page
   * (`js/binder-share.js`), which loads `css/base.css` without the application.
   *
   * @returns {void}
   */
  start() {
    if (this.started) return;
    this.mount();
    this.onScroll = (event) => this.queue(event.target);
    this.onResize = () => this.hide();
    document.addEventListener('scroll', this.onScroll, { capture: true, passive: true });
    // A resize invalidates the geometry of the tracked box, and a bar left where it was would be
    // wrong rather than late: it is cheaper to hide it than to recompute a track nobody looks at.
    window.addEventListener('resize', this.onResize, { passive: true });
    this.started = true;
  }

  /**
   * Chooses between the thin bar of the game and the bar of the system.
   *
   * The stylesheet hides the native bar through `html:not([data-native-scrollbars="true"])`, so this
   * attribute is the whole switch: the browser paints its own bar again, this layer stops following
   * the scrolling (and is hidden by the same stylesheet, in case a frame was already drawn).
   *
   * @param {boolean} enabled - True to hand the indicator back to the system.
   * @returns {void}
   */
  setNativeBars(enabled) {
    const native = enabled === true;
    document.documentElement.dataset.nativeScrollbars = native ? 'true' : 'false';
    if (native) {
      this.stop();
    } else {
      this.start();
    }
  }

  /**
   * Removes the listeners and the layer (teardown; the game itself never calls it).
   *
   * @returns {void}
   */
  stop() {
    if (!this.started) return;
    document.removeEventListener('scroll', this.onScroll, { capture: true });
    window.removeEventListener('resize', this.onResize);
    if (this.frame !== null) window.cancelAnimationFrame(this.frame);
    this.hide();
    this.layer?.remove();
    this.layer = null;
    this.bar = null;
    this.container = null;
    this.onScroll = null;
    this.onResize = null;
    this.started = false;
  }

  /**
   * Creates the layer and its bar, or adopts the ones already in the page.
   *
   * The layer lives at the end of `<body>`, outside every view: a bar painted inside the view that
   * scrolls would be clipped by that view's own `overflow`.
   *
   * @returns {void}
   */
  mount() {
    let layer = document.getElementById(LAYER_ID);
    if (!layer) {
      layer = document.createElement('div');
      layer.id = LAYER_ID;
      layer.className = SCROLL_HINT_CLASS;
      layer.setAttribute('aria-hidden', 'true');
      const bar = document.createElement('span');
      bar.className = `${SCROLL_HINT_CLASS}__bar`;
      layer.append(bar);
      document.body.append(layer);
    }
    this.layer = layer;
    this.bar = layer.firstElementChild;
  }

  /**
   * Records the box that scrolled and asks for one paint on the next frame.
   *
   * @param {EventTarget|null} target - `event.target` of the `scroll` event.
   * @returns {void}
   */
  queue(target) {
    const container = ScrollHint.resolveTarget(target);
    if (!container) return;
    this.container = container;
    if (this.frame !== null) return;
    // One measurement per frame at most: `getBoundingClientRect()` on the scrolling box forces a
    // layout, and a wheel can fire several scroll events between two frames.
    this.frame = window.requestAnimationFrame(() => {
      this.frame = null;
      this.paint();
    });
  }

  /**
   * Places the bar on the tracked box, then reveals it and restarts the idle timer.
   *
   * @returns {void}
   */
  paint() {
    const container = this.container;
    if (!this.layer || !this.bar || !container) return;
    if (!container.isConnected) {
      this.hide();
      return;
    }

    const box = ScrollHint.boxOf(container);
    const vertical = container.scrollHeight > Math.round(box.height) + 1;
    const horizontal = container.scrollWidth > Math.round(box.width) + 1;
    if (!vertical && !horizontal) {
      this.hide();
      return;
    }

    const length = vertical ? box.height : box.width;
    const total = vertical ? container.scrollHeight : container.scrollWidth;
    const position = vertical ? container.scrollTop : container.scrollLeft;

    // The bar runs inside the box, `EDGE_GAP` away from both ends, and keeps `MIN_LENGTH` even when
    // the content is so long that its true share would be a dot nobody sees.
    const track = Math.max(length - 2 * EDGE_GAP, MIN_LENGTH);
    const size = Math.min(track, Math.max(MIN_LENGTH, Math.round((track * length) / total)));
    const travel = Math.max(total - length, 1);
    const offset = Math.min(Math.max((position / travel) * (track - size), 0), track - size);

    const bar = this.bar;
    if (vertical) {
      bar.style.width = `${THICKNESS}px`;
      bar.style.height = `${size}px`;
      bar.style.left = `${box.left + box.width - THICKNESS - EDGE_GAP}px`;
      bar.style.top = `${box.top + EDGE_GAP + offset}px`;
    } else {
      bar.style.width = `${size}px`;
      bar.style.height = `${THICKNESS}px`;
      bar.style.left = `${box.left + EDGE_GAP + offset}px`;
      bar.style.top = `${box.top + box.height - THICKNESS - EDGE_GAP}px`;
    }
    this.reveal();
  }

  /**
   * Shows the bar and pushes the fade-out back.
   *
   * @returns {void}
   */
  reveal() {
    this.layer?.classList.add(SCROLL_HINT_VISIBLE_CLASS);
    if (this.idleTimer !== null) window.clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => this.hide(), IDLE_MS);
  }

  /**
   * Fades the bar out and cancels the pending idle timer.
   *
   * @returns {void}
   */
  hide() {
    if (this.idleTimer !== null) {
      window.clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.layer?.classList.remove(SCROLL_HINT_VISIBLE_CLASS);
  }

  /**
   * Finds the box an event scrolled: the scrolling element for the page, the element otherwise.
   *
   * @param {EventTarget|null} target - `event.target` of the `scroll` event.
   * @returns {HTMLElement|null} The box, or null for a target that is not a scroll container.
   */
  static resolveTarget(target) {
    if (!target) return null;
    if (target === window || target === document || target instanceof Document) {
      return document.scrollingElement ?? document.documentElement;
    }
    return target instanceof HTMLElement ? target : null;
  }

  /**
   * Rectangle of the area a bar can be drawn in: the viewport for the page, the padding box for an
   * element (its border and, where a browser keeps one, its scrollbar are not part of it).
   *
   * The rectangle is taken from the painted box, not only from the laid-out one: a dialog opening
   * runs `modal-rise` (`scale(0.98)` to `none`) for 220ms, which happens exactly when its content is
   * first scrollable. The ratio between the two is applied to the padding box, so the bar stays
   * inside the dialog it decorates instead of sticking out of its edge for the length of the
   * animation.
   *
   * @param {HTMLElement} container - Box being followed.
   * @returns {{top: number, left: number, width: number, height: number}} The rectangle.
   */
  static boxOf(container) {
    const page = document.scrollingElement ?? document.documentElement;
    if (container === page) {
      return { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight };
    }
    const rect = container.getBoundingClientRect();
    const scaleX = container.offsetWidth > 0 ? rect.width / container.offsetWidth : 1;
    const scaleY = container.offsetHeight > 0 ? rect.height / container.offsetHeight : 1;
    return {
      top: rect.top + container.clientTop * scaleY,
      left: rect.left + container.clientLeft * scaleX,
      width: container.clientWidth * scaleX,
      height: container.clientHeight * scaleY,
    };
  }
}

/** Shared instance: the page and the binder page each call `start()` once. */
export const scrollHint = new ScrollHint();

export default scrollHint;

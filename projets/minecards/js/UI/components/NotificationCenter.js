/**
 * NotificationCenter - Queue of the game notifications (progress and experience).
 *
 * Reference: `js/UI/components/GameNotifier.js` (what is announced, and when).
 *
 * WHAT IT IS (and what it is NOT)
 *   The toasts (`js/UI/components/Toast.js`) acknowledge an ACTION the player just performed
 *   ("profile saved", "card purchased") and stack at the BOTTOM of the screen. This component
 *   announces what the game GRANTED (a collection moving forward, experience earned): it sits at
 *   the top — top right in landscape, top center on a portrait screen — and shows ONE notification
 *   at a time.
 *
 * QUEUE
 *   Notifications are queued, never stacked: a booster opening can grant experience AND move two
 *   collections forward at once, and three cards sliding over the booster would be unreadable.
 *   The first item of the queue is displayed for the DURATION THE PLAYER CHOSE in the settings
 *   (`settings.notificationDuration`, in seconds, `NOTIFICATION_DURATION_MS` by default), then the
 *   next one takes its place. A KIND the player switched off (`settings.notificationTypes`) is
 *   dropped on arrival, so a silenced family never even waits in the queue. A `priority` item (a collection discovered while the reveal is playing) is news
 *   the player must read AT THE MOMENT its card is turned over: it therefore jumps to the front of
 *   the queue AND interrupts the message on screen, which goes back to the front of its own band and
 *   is shown again (for a full duration) once the discoveries have been read.
 *
 * DISMISSAL
 *   A notification disappears on its own after the chosen duration, and immediately when it
 *   is clicked, tapped, activated from the keyboard (Enter/Space) or swiped sideways on a touch
 *   screen. Dismissing always reveals the next queued item.
 *
 * TEXT
 *   Unlike `Toast`, this component carries RESOLVED strings: a notification mixes data (a trophy or
 *   card name) with translated labels, so the caller (`GameNotifier`) owns the translation and the
 *   component stays a pure renderer. It re-reads nothing on a language switch: a notification
 *   only lives a few seconds.
 *
 * Styling lives in `css/components/notifications.css`.
 */

/** Notification kinds, exposed as `data-type` in the DOM. */
export const NOTIFICATION_TYPES = Object.freeze({
  /** A collection trophy moved forward (or was completed) by the cards just discovered. */
  COLLECTION: 'collection',
  /** Experience earned, or a level reached. */
  EXPERIENCE: 'experience',
  /** A player TITLE became selectable (a level reached, or a collection trophy unlocked). */
  TITLE: 'title',
});

/** Visual variants, exposed as `data-variant` (an extra accent on top of the type). */
export const NOTIFICATION_VARIANTS = Object.freeze({
  /** Plain progress message (default). */
  DEFAULT: 'default',
  /** A collection that this very opening completed. */
  COMPLETE: 'complete',
  /** A level reached: the amount of experience is no longer the point. */
  LEVEL: 'level',
});

/** Id of the container element created on demand. */
export const NOTIFICATION_CONTAINER_ID = 'notification-center';

/** Class of the container element. */
export const NOTIFICATION_CONTAINER_CLASS = 'notifications';

/** Class of one notification. */
export const NOTIFICATION_CLASS = 'notification';

/** Class applied while a notification leaves (drives the exit animation of the stylesheet). */
export const NOTIFICATION_LEAVING_CLASS = 'is-leaving';

/** How long one notification stays on screen before the next one is shown, in milliseconds. */
export const NOTIFICATION_DURATION_MS = 3000;

/** Duration of the exit animation, in milliseconds (must match the stylesheet). */
export const NOTIFICATION_EXIT_MS = 220;

/** Horizontal travel (pixels) that dismisses a notification by swipe. */
export const NOTIFICATION_SWIPE_PX = 40;

export class NotificationCenter {
  constructor() {
    /** @type {object[]} Items waiting for their turn (the first one is the next displayed). */
    this.queue = [];
    /** @type {HTMLElement|null} Notification currently displayed. */
    this.current = null;
    /** @type {object|null} Item displayed (kept to put it back in the queue when it is interrupted). */
    this.currentItem = null;
    /** @type {number|null} Auto-dismiss timer of the displayed notification. */
    this.timer = null;
    /** @type {Array<{target: EventTarget, type: string, handler: EventListener}>} Touch bindings. */
    this.bindings = [];
    /** @type {number|null} Horizontal travel of the running swipe, in pixels. */
    this.swipeDelta = 0;
    /** @type {number|null} Horizontal position where the running swipe started. */
    this.swipeStartX = null;
    /** @type {number} How long one notification stays on screen, in milliseconds. */
    this.durationMs = NOTIFICATION_DURATION_MS;
    /** @type {Set<string>} Kinds the player allows (`settings.notificationTypes`). */
    this.enabledTypes = new Set(Object.values(NOTIFICATION_TYPES));
  }

  /**
   * Sets how long one notification stays on screen.
   *
   * The settings screen stores whole SECONDS; the queue schedules milliseconds. The value is
   * clamped to a readable window (half a second to a minute), so a hand-edited save can neither
   * flash a message away nor freeze the queue.
   *
   * @param {number} seconds - Duration, in seconds.
   * @returns {number} The applied duration, in milliseconds.
   */
  setDurationSeconds(seconds) {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return this.durationMs;
    this.durationMs = Math.min(60000, Math.max(500, Math.round(seconds * 1000)));
    this.log(`Notification duration: ${this.durationMs} ms.`);
    return this.durationMs;
  }

  /**
   * Applies the per-kind switches of the settings.
   *
   * A missing kind reads as enabled, like every other preference of the game: only an explicit
   * `false` silences one. Unknown keys are ignored, and the order of `NOTIFICATION_TYPES` always
   * decides what the queue accepts.
   *
   * @param {Record<string, boolean>|null|undefined} types - Enabled kinds.
   * @returns {void}
   */
  setEnabledTypes(types) {
    const source = types && typeof types === 'object' && !Array.isArray(types) ? types : {};
    this.enabledTypes = new Set(
      Object.values(NOTIFICATION_TYPES).filter((type) => source[type] !== false)
    );
    this.log(`Enabled notification types: ${[...this.enabledTypes].join(', ') || 'none'}.`);
  }

  /**
   * Tells whether one kind of notification is allowed.
   *
   * @param {string} type - Notification kind (`data-type`).
   * @returns {boolean} True when the queue may display it.
   */
  isTypeEnabled(type) {
    return this.enabledTypes.has(type);
  }

  /**
   * Logs with the component prefix.
   *
   * @param {...unknown} args - Values forwarded to `console.info`.
   * @returns {void}
   */
  log(...args) {
    console.info('[NotificationCenter]', ...args);
  }

  /**
   * Checks that a runtime can display notifications.
   *
   * @returns {boolean} True when a DOM is available.
   */
  isSupported() {
    return typeof document !== 'undefined' && typeof document.createElement === 'function';
  }

  /**
   * Returns the container element, creating it on first use.
   *
   * @returns {HTMLElement|null} The container, or null when no DOM is available.
   */
  ensureContainer() {
    if (!this.isSupported()) {
      console.warn('[NotificationCenter] No DOM is available: the notification was not displayed.');
      return null;
    }

    const existing = document.getElementById(NOTIFICATION_CONTAINER_ID);
    if (existing) return existing;

    const container = document.createElement('div');
    container.id = NOTIFICATION_CONTAINER_ID;
    container.className = NOTIFICATION_CONTAINER_CLASS;
    container.setAttribute('role', 'status');
    container.setAttribute('aria-live', 'polite');
    document.body.appendChild(container);
    this.anchorUnderHeader(container);
    return container;
  }

  /**
   * Anchors the stack just below the header.
   *
   * `--header-height` only describes the brand row of the header: the row of counters (daily/bonus
   * boosters, Sparks, UTC clock) wraps UNDER it on a narrow screen, and the header is sticky, so its
   * real height is measured instead of guessed. The measurement also covers the safe-area inset the
   * header reserves for a notched device.
   *
   * @param {HTMLElement} container - Stack element.
   * @returns {void}
   */
  anchorUnderHeader(container) {
    const header = document.querySelector('.app-header');
    if (!header || typeof header.getBoundingClientRect !== 'function') return;
    const bottom = Math.round(header.getBoundingClientRect().bottom);
    if (bottom > 0) {
      container.style.setProperty('--notifications-top', `${bottom}px`);
    }
  }

  /**
   * Queues a notification and displays it when its turn comes.
   *
   * @param {object} item - Notification content (see the module header for the text rule).
   * @param {'collection'|'experience'|'title'} item.type - Notification kind (`data-type`).
   * @param {string} [item.variant='default'] - Extra accent (`data-variant`).
   * @param {string} [item.badge=''] - Short label shown above the title (e.g. "+15 XP").
   * @param {string} item.title - Main line (already translated / already a data name).
   * @param {string} [item.message=''] - Secondary line.
   * @param {number|null} [item.progress=null] - Completion ratio (0-1) drawn as a bar.
   * @param {boolean} [options.priority=false] - True to jump the queue (collection discoveries).
   * @returns {void}
   */
  push(item, { priority = false } = {}) {
    if (!item || typeof item !== 'object') {
      throw new TypeError('NotificationCenter.push expects an item object.');
    }
    const normalized = {
      type: Object.values(NOTIFICATION_TYPES).includes(item.type)
        ? item.type
        : NOTIFICATION_TYPES.EXPERIENCE,
      variant: Object.values(NOTIFICATION_VARIANTS).includes(item.variant)
        ? item.variant
        : NOTIFICATION_VARIANTS.DEFAULT,
      badge: typeof item.badge === 'string' ? item.badge : '',
      title: typeof item.title === 'string' ? item.title : '',
      message: typeof item.message === 'string' ? item.message : '',
      progress: Number.isFinite(item.progress) ? Math.max(0, Math.min(item.progress, 1)) : null,
      /** @type {boolean} True when the item jumped the queue (kept in its own order band). */
      priority: priority === true,
    };

    // A silenced family never enters the queue: dropping it here also keeps a disabled collection
    // notification from interrupting the message on screen.
    if (!this.isTypeEnabled(normalized.type)) {
      this.log(`Dropped "${normalized.title}" (${normalized.type} is switched off).`);
      return;
    }

    // Queued FIRST: if the new item has to interrupt the message on screen, dismissing that message
    // displays the head of the queue — which must be the new item, not the interrupted one.
    this.enqueue(normalized, normalized.priority);

    if (normalized.priority && this.current) {
      // A discovered collection is read NOW: the message on screen steps aside. It is not lost — it
      // goes back to the front of the regular items and is displayed again right after (see
      // `requeue`), with its whole duration ahead of it.
      this.requeue(this.currentItem);
      this.dismiss(this.current);
    }

    this.log(`Queued "${normalized.title}" (${normalized.type}, priority: ${priority}).`);
    this.showNext();
  }

  /**
   * Adds an item to the queue, in its own band.
   *
   * The queue is ordered in two bands: the PRIORITY items first (the discoveries of the reveal),
   * then the regular ones. Inside a band, the order is the arrival order.
   *
   * @param {object} item - Normalized item (see `push`).
   * @param {boolean} priority - True for a priority item.
   * @returns {void}
   */
  enqueue(item, priority) {
    if (!priority) {
      this.queue.push(item);
      return;
    }
    // Inserted BEFORE the first regular item, and AFTER the priority items already waiting: two
    // collections discovered by the same opening keep the order in which their cards came up.
    const index = this.queue.findIndex((queued) => queued.priority !== true);
    if (index === -1) {
      this.queue.push(item);
    } else {
      this.queue.splice(index, 0, item);
    }
  }

  /**
   * Puts an interrupted item back at the FRONT of the regular band.
   *
   * Front, and not the back: it was already being read, so it must come back before the experience
   * notifications that were queued after it. Behind the priority band, so the discoveries that
   * interrupt it are still displayed first.
   *
   * @param {object|null} item - Item that was on screen.
   * @returns {void}
   */
  requeue(item) {
    if (!item) return;
    const index = this.queue.findIndex((queued) => queued.priority !== true);
    if (index === -1) {
      this.queue.push(item);
    } else {
      this.queue.splice(index, 0, item);
    }
  }

  /**
   * Displays the next queued notification when nothing is on screen.
   *
   * @returns {void}
   */
  showNext() {
    if (this.current || this.queue.length === 0) return;

    const container = this.ensureContainer();
    if (!container) {
      this.queue = [];
      return;
    }
    // Re-measured on every display: the header wraps differently after a rotation or a language
    // change, and the notification must never cover it.
    this.anchorUnderHeader(container);

    const item = this.queue.shift();
    const element = this.buildElement(item);
    this.current = element;
    this.currentItem = item;
    // Only the elements that are NOT leaving are swept away: a notification that is fading out keeps
    // its place until its animation ends (it is positioned absolutely, see the stylesheet).
    Array.from(container.children).forEach((child) => {
      if (!child.classList.contains(NOTIFICATION_LEAVING_CLASS)) child.remove();
    });
    container.appendChild(element);

    // The item is clickable and swiped: the listeners die with the element, so they are removed
    // from the binding list as soon as the notification leaves.
    this.bind(element, 'click', () => this.dismiss(element));
    this.bind(element, 'keydown', (event) => this.handleKeydown(event, element));
    this.bind(element, 'touchstart', (event) => this.handleTouchStart(event), { passive: true });
    this.bind(element, 'touchmove', (event) => this.handleTouchMove(event), { passive: true });
    this.bind(element, 'touchend', () => this.handleTouchEnd(element));
    this.bind(element, 'touchcancel', () => this.handleTouchEnd(element));

    this.timer = window.setTimeout(() => this.dismiss(element), this.durationMs);
    this.log(`Displayed "${item.title}" (${this.queue.length} item(s) left in the queue).`);
  }

  /**
   * Builds the DOM of one notification.
   *
   * @param {object} item - Normalized item (see `push`).
   * @returns {HTMLElement} The element, ready to be inserted.
   */
  buildElement(item) {
    const element = document.createElement('div');
    element.className = NOTIFICATION_CLASS;
    element.dataset.type = item.type;
    element.dataset.variant = item.variant;
    element.tabIndex = 0;
    // The whole card dismisses the notification, so the accessible name says so.
    element.setAttribute('aria-label', item.title);

    if (item.badge !== '') {
      const badge = document.createElement('span');
      badge.className = 'notification__badge';
      badge.textContent = item.badge;
      element.appendChild(badge);
    }

    const title = document.createElement('p');
    title.className = 'notification__title';
    title.textContent = item.title;
    element.appendChild(title);

    if (item.message !== '') {
      const message = document.createElement('p');
      message.className = 'notification__message';
      message.textContent = item.message;
      element.appendChild(message);
    }

    if (item.progress !== null) {
      const track = document.createElement('div');
      track.className = 'notification__track';
      const fill = document.createElement('div');
      fill.className = 'notification__fill';
      fill.style.width = `${Math.round(item.progress * 100)}%`;
      fill.setAttribute('role', 'progressbar');
      fill.setAttribute('aria-valuemin', '0');
      fill.setAttribute('aria-valuemax', '100');
      fill.setAttribute('aria-valuenow', String(Math.round(item.progress * 100)));
      track.appendChild(fill);
      element.appendChild(track);
    }

    return element;
  }

  /**
   * Dismisses a notification and reveals the next one.
   *
   * Passing the ELEMENT (and not the item) is what makes the ghost click of a touch swipe
   * harmless: the click that follows the swipe targets an element that is no longer displayed, so
   * the notification shown in the meantime is not closed by accident.
   *
   * @param {HTMLElement|null} element - Element to remove.
   * @returns {void}
   */
  dismiss(element) {
    if (!element || element !== this.current) return;

    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    this.current = null;
    this.currentItem = null;
    this.unbindAll(element);

    // The element is left in the DOM for its exit animation, but it no longer takes a place, so the
    // next notification is displayed AT ONCE: the player waits one duration per message, not one
    // duration plus an animation.
    element.classList.add(NOTIFICATION_LEAVING_CLASS);
    window.setTimeout(() => element.remove(), NOTIFICATION_EXIT_MS);
    this.showNext();
  }

  /**
   * Handles the keyboard activation of a notification (Enter/Space dismiss it).
   *
   * @param {Event} event - Key event.
   * @param {HTMLElement} element - Notification that received the event.
   * @returns {void}
   */
  handleKeydown(event, element) {
    const key = event?.key;
    if (key !== 'Enter' && key !== ' ' && key !== 'Spacebar') return;
    event.preventDefault();
    this.dismiss(element);
  }

  /**
   * Starts a horizontal swipe.
   *
   * @param {TouchEvent} event - Touch event.
   * @returns {void}
   */
  handleTouchStart(event) {
    const touch = event?.touches?.[0];
    if (!touch) return;
    this.swipeStartX = touch.clientX;
    this.swipeDelta = 0;
  }

  /**
   * Follows a horizontal swipe (the card follows the finger, so the gesture is visible).
   *
   * @param {TouchEvent} event - Touch event.
   * @returns {void}
   */
  handleTouchMove(event) {
    const touch = event?.touches?.[0];
    if (!touch || this.swipeStartX === null || !this.current) return;
    this.swipeDelta = touch.clientX - this.swipeStartX;
    this.current.style.transform = `translateX(${this.swipeDelta}px)`;
    this.current.style.opacity = String(Math.max(0.35, 1 - Math.abs(this.swipeDelta) / 160));
  }

  /**
   * Ends a swipe: far enough sideways dismisses the notification, otherwise it returns to place.
   *
   * @param {HTMLElement} element - Notification that was being swiped.
   * @returns {void}
   */
  handleTouchEnd(element) {
    const travelled = Math.abs(this.swipeDelta);
    this.swipeStartX = null;
    this.swipeDelta = 0;
    if (element !== this.current) return;

    if (travelled >= NOTIFICATION_SWIPE_PX) {
      this.dismiss(element);
      return;
    }
    element.style.transform = '';
    element.style.opacity = '';
  }

  /**
   * Attaches a listener to an element and remembers it, so it can be released with the element.
   *
   * @param {HTMLElement} target - Element receiving the listener.
   * @param {string} type - Event name.
   * @param {EventListener} handler - Callback.
   * @param {object} [options] - `addEventListener` options.
   * @returns {void}
   */
  bind(target, type, handler, options = undefined) {
    target.addEventListener(type, handler, options);
    this.bindings.push({ target, type, handler, options });
  }

  /**
   * Releases every listener attached to one element (the element is about to be removed).
   *
   * @param {HTMLElement} element - Element whose listeners are released.
   * @returns {void}
   */
  unbindAll(element) {
    const remaining = [];
    this.bindings.forEach((binding) => {
      if (binding.target === element) {
        binding.target.removeEventListener(binding.type, binding.handler, binding.options);
        return;
      }
      remaining.push(binding);
    });
    this.bindings = remaining;
  }

  /**
   * Empties the queue and removes the displayed notification (used by a full reset).
   *
   * @returns {void}
   */
  clear() {
    this.queue = [];
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.current) {
      this.unbindAll(this.current);
      this.current.remove();
      this.current = null;
    }
    this.currentItem = null;
    if (this.isSupported()) {
      document.getElementById(NOTIFICATION_CONTAINER_ID)?.remove();
    }
  }

  /**
   * Counts the notifications waiting for their turn (the displayed one excluded).
   *
   * @returns {number} The queue length.
   */
  getQueuedCount() {
    return this.queue.length;
  }

  /**
   * Counts the notifications currently displayed (0 or 1).
   *
   * @returns {number} The displayed count.
   */
  getVisibleCount() {
    return this.current ? 1 : 0;
  }
}

/** Shared instance used by `GameNotifier` and by `app.js`. */
export const notificationCenter = new NotificationCenter();

export default notificationCenter;

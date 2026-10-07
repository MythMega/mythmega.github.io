/**
 * Toast - Transient, non-blocking feedback messages.
 *
 * Reference: `.docs/steps/7.md` point 3 (the redeem view reports success and errors as toasts).
 *
 * Design decisions:
 *   - the messages are translated through `I18n.t(key, params)`, so the component only carries
 *     TRANSLATION KEYS, never user-facing text;
 *   - the stack is appended to `<body>`, reused between calls and never blocks a tap
 *     (`pointer-events: none` in `css/components/toast.css`): a toast must not steal the touch of
 *     the control the player is aiming at;
 *   - at most `TOAST_VISIBLE_LIMIT` messages are shown at once, the oldest one leaving first, and
 *     every message disappears on its own after `duration`;
 *   - an error toast carries `role="alert"` so it is announced immediately, while the stack is a
 *     polite live region for the informational/success messages;
 *   - without a DOM (module imported in a non-browser runtime) every method degrades to a warning
 *     instead of throwing: feedback must never break a business operation that already succeeded.
 *
 * Styling lives in `css/components/toast.css`.
 */

import i18n from '../../utils/I18n.js';

/** Id of the stack element created on demand. */
export const TOAST_CONTAINER_ID = 'toast-container';

/** Class of the stack element. */
export const TOAST_CONTAINER_CLASS = 'toast-stack';

/** Class of one message. */
export const TOAST_CLASS = 'toast';

/** Class applied while a message leaves (drives the exit animation of the stylesheet). */
export const TOAST_LEAVING_CLASS = 'is-leaving';

/** Maximum number of messages visible at the same time. */
export const TOAST_VISIBLE_LIMIT = 3;

/** Default lifetime of a message, in milliseconds. */
export const TOAST_DEFAULT_DURATION_MS = 4000;

/** Duration of the exit animation, in milliseconds (must match `--duration-fast`). */
const TOAST_EXIT_MS = 200;

/** Supported tones, exposed as `data-tone` in the DOM. */
export const TOAST_TONES = Object.freeze({ INFO: 'info', SUCCESS: 'success', ERROR: 'error' });

export class Toast {
  /**
   * Checks that a runtime can display toasts.
   *
   * @returns {boolean} True when a DOM is available.
   */
  static isSupported() {
    return typeof document !== 'undefined' && typeof document.createElement === 'function';
  }

  /**
   * Returns the stack element, creating it on first use.
   *
   * @returns {HTMLElement|null} The stack, or null when no DOM is available.
   */
  static ensureContainer() {
    if (!Toast.isSupported()) {
      console.warn('[Toast] No DOM is available: the message was not displayed.');
      return null;
    }

    const existing = document.getElementById(TOAST_CONTAINER_ID);
    if (existing) return existing;

    const container = document.createElement('div');
    container.id = TOAST_CONTAINER_ID;
    container.className = TOAST_CONTAINER_CLASS;
    // The stack itself is a polite live region; error messages override it with `role="alert"`.
    container.setAttribute('role', 'status');
    container.setAttribute('aria-live', 'polite');
    document.body.appendChild(container);
    return container;
  }

  /**
   * Displays a translated message.
   *
   * @param {string} key - i18n key of the message.
   * @param {object} [options] - Display options.
   * @param {'info'|'success'|'error'} [options.tone='info'] - Visual tone and announcement mode.
   * @param {object|null} [options.params=null] - Interpolation values of the message.
   * @param {number} [options.duration=TOAST_DEFAULT_DURATION_MS] - Lifetime in milliseconds
   *   (a non-positive value keeps the message until `dismiss()` is called).
   * @returns {HTMLElement|null} The created element, or null when nothing could be displayed.
   * @throws {TypeError} When the key is not a non-empty string.
   */
  static show(key, { tone = TOAST_TONES.INFO, params = null, duration = TOAST_DEFAULT_DURATION_MS } = {}) {
    if (typeof key !== 'string' || key.trim() === '') {
      throw new TypeError(`Toast.show expects a non-empty i18n key (received: ${JSON.stringify(key)}).`);
    }

    const container = Toast.ensureContainer();
    if (!container) return null;

    const normalizedTone = Object.values(TOAST_TONES).includes(tone) ? tone : TOAST_TONES.INFO;
    const element = document.createElement('p');
    element.className = TOAST_CLASS;
    element.dataset.tone = normalizedTone;
    element.dataset.i18nKey = key;
    element.textContent = i18n.t(key, params);
    if (normalizedTone === TOAST_TONES.ERROR) {
      element.setAttribute('role', 'alert');
    }

    Toast.enforceLimit(container);
    container.appendChild(element);

    if (Number.isFinite(duration) && duration > 0) {
      window.setTimeout(() => Toast.dismiss(element), duration);
    }
    return element;
  }

  /**
   * Displays a success message.
   *
   * @param {string} key - i18n key of the message.
   * @param {object} [options] - Display options (see `show`).
   * @returns {HTMLElement|null} The created element.
   */
  static success(key, options = {}) {
    return Toast.show(key, { ...options, tone: TOAST_TONES.SUCCESS });
  }

  /**
   * Displays an error message.
   *
   * @param {string} key - i18n key of the message.
   * @param {object} [options] - Display options (see `show`).
   * @returns {HTMLElement|null} The created element.
   */
  static error(key, options = {}) {
    return Toast.show(key, { ...options, tone: TOAST_TONES.ERROR });
  }

  /**
   * Displays an informational message.
   *
   * @param {string} key - i18n key of the message.
   * @param {object} [options] - Display options (see `show`).
   * @returns {HTMLElement|null} The created element.
   */
  static info(key, options = {}) {
    return Toast.show(key, { ...options, tone: TOAST_TONES.INFO });
  }

  /**
   * Removes the oldest messages so the stack never exceeds `TOAST_VISIBLE_LIMIT`.
   *
   * @param {HTMLElement} container - Stack element.
   * @returns {void}
   */
  static enforceLimit(container) {
    const visible = Array.from(container.children).filter(
      (child) => !child.classList.contains(TOAST_LEAVING_CLASS)
    );
    for (let index = 0; index <= visible.length - TOAST_VISIBLE_LIMIT; index += 1) {
      Toast.dismiss(visible[index]);
    }
  }

  /**
   * Makes a message leave, then removes it from the DOM.
   *
   * @param {HTMLElement|null} element - Message to dismiss.
   * @returns {void}
   */
  static dismiss(element) {
    if (!element || !element.isConnected) return;

    if (element.classList.contains(TOAST_LEAVING_CLASS)) {
      element.remove();
      return;
    }

    element.classList.add(TOAST_LEAVING_CLASS);
    window.setTimeout(() => element.remove(), TOAST_EXIT_MS);
  }

  /**
   * Removes every message and the stack itself.
   *
   * @returns {void}
   */
  static clear() {
    if (!Toast.isSupported()) return;
    document.getElementById(TOAST_CONTAINER_ID)?.remove();
  }

  /**
   * Counts the messages currently displayed (including the leaving ones).
   *
   * @returns {number} The number of messages, or 0 when no DOM is available.
   */
  static count() {
    if (!Toast.isSupported()) return 0;
    return document.getElementById(TOAST_CONTAINER_ID)?.childElementCount ?? 0;
  }
}

export default Toast;

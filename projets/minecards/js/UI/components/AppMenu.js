/**
 * AppMenu - Floating right-side menu that replaced the "Info" destination of the bottom bar.
 *
 * The bottom button is a plain toggle; this component owns its open state, closes the panel on an
 * outside click, Escape or a destination click, and keeps `aria-expanded` in sync. Navigation
 * itself stays with `SpaRouter`, because every entry carries `data-nav-target`.
 */

import eventBus, { EVENTS } from '../../utils/EventBus.js';

export class AppMenu {
  /**
   * @param {ParentNode} [root=document] - Subtree scanned for the menu markup.
   */
  constructor(root = document) {
    this.root = root;
    this.toggle = root.querySelector('[data-app-menu-toggle]');
    this.menu = root.querySelector('[data-app-menu]');
    this.items = this.menu
      ? [...this.menu.querySelectorAll('[data-nav-target]')]
      : [];
    this.clock = this.menu?.querySelector('[data-app-menu-clock]') ?? null;
    this.clockTime = this.menu?.querySelector('[data-app-menu-clock-time]') ?? null;
    this.clockSeconds = this.menu?.querySelector('[data-app-menu-clock-seconds]') ?? null;
    this.isOpen = false;
    this.isInitialized = false;
  }

  /**
   * Binds the menu and its global listeners.
   *
   * @returns {void}
   */
  init() {
    if (this.isInitialized) return;
    if (!this.toggle || !this.menu) {
      console.warn('[AppMenu] The floating menu is missing from index.html.');
      return;
    }
    this.isInitialized = true;

    this.toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      this.setOpen(!this.isOpen);
    });
    this.items.forEach((item) => {
      item.addEventListener('click', () => this.setOpen(false));
    });
    this.menu.addEventListener('click', (event) => event.stopPropagation());
    document.addEventListener('click', () => this.setOpen(false));
    window.addEventListener('resize', () => {
      if (this.isOpen) this.positionMenu();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.isOpen) {
        this.setOpen(false);
        this.toggle.focus();
      }
    });
    eventBus.on(EVENTS.CLOCK_TICK, (payload) => this.renderClock(payload));
    eventBus.on(EVENTS.VIEW_CHANGED, () => this.setOpen(false));
  }

  /**
   * Opens or closes the panel.
   *
   * @param {boolean} open - Requested state.
   * @returns {void}
   */
  setOpen(open) {
    if (!this.toggle || !this.menu) return;
    this.isOpen = Boolean(open);
    this.menu.hidden = !this.isOpen;
    this.toggle.setAttribute('aria-expanded', String(this.isOpen));
    this.toggle.classList.toggle('is-active', this.isOpen);
    if (this.isOpen) {
      this.positionMenu();
      window.requestAnimationFrame(() => this.items[0]?.focus());
    }
  }

  /**
   * Anchors the panel on the real position of its button.
   *
   * The bottom bar stretches across the whole window, so a fixed `right` would leave the menu at
   * the far edge of a wide screen while its button sits much closer to the centre. The right edge
   * follows the button instead, and the small pointer is moved to the button centre.
   *
   * @returns {void}
   */
  positionMenu() {
    if (!this.toggle || !this.menu) return;
    const button = this.toggle.getBoundingClientRect();
    const viewportGap = 8;
    const menuWidth = this.menu.offsetWidth || 240;
    const right = Math.min(
      Math.max(viewportGap, window.innerWidth - button.right),
      Math.max(viewportGap, window.innerWidth - menuWidth - viewportGap)
    );
    this.menu.style.right = `${right}px`;

    const panel = this.menu.getBoundingClientRect();
    const pointerRight = Math.min(
      panel.width - 18,
      Math.max(18, panel.right - (button.left + button.width / 2) - 6)
    );
    this.menu.style.setProperty('--app-menu-arrow-right', `${pointerRight}px`);
  }

  /**
   * Mirrors the trusted UTC clock of the header in the menu.
   *
   * The menu never runs a timer: it follows the same `CLOCK_TICK` as the header, so both always
   * show the same time. The element is plain text, not a button.
   *
   * @param {{utc?: Date, formatted?: string}|null} payload - `CLOCK_TICK` payload.
   * @returns {void}
   */
  renderClock(payload) {
    if (!this.clock) return;
    const formatted = typeof payload?.formatted === 'string' ? payload.formatted : '';
    const valid = /^\d{2}:\d{2}:\d{2}$/.test(formatted);
    if (this.clockTime) this.clockTime.textContent = valid ? formatted.slice(0, 5) : '--:--';
    if (this.clockSeconds) this.clockSeconds.textContent = valid ? formatted.slice(5) : ':--';
    if (valid && payload.utc instanceof Date) {
      this.clock.setAttribute('datetime', payload.utc.toISOString());
    } else {
      this.clock.removeAttribute('datetime');
    }
  }
}

export default AppMenu;

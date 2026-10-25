/**
 * Lightweight toast notifications.
 * @module ui/toasts
 */

import { el } from '../core/dom.js';

export class Toasts {
  /**
   * @param {HTMLElement} container
   * @param {{ duration?: number }} [options]
   */
  constructor(container, { duration = 4500 } = {}) {
    this.container = container;
    this.duration = duration;
  }

  /**
   * @param {string} message
   * @param {{ type?: 'info'|'success'|'error', duration?: number }} [options]
   */
  show(message, { type = 'info', duration = this.duration } = {}) {
    const toast = el(
      'div',
      {
        class: `toast is-${type}`,
        role: type === 'error' ? 'alert' : 'status',
      },
      el('div', { class: 'toast-text', text: message }),
    );

    this.container.append(toast);

    const remove = () => {
      if (!toast.isConnected) return;
      toast.classList.add('is-leaving');
      window.setTimeout(() => toast.remove(), 220);
    };

    const timer = window.setTimeout(remove, Math.max(1500, duration));
    toast.addEventListener('click', () => {
      window.clearTimeout(timer);
      remove();
    });
  }

  /** @param {string} message */
  info(message) {
    this.show(message, { type: 'info' });
  }

  /** @param {string} message */
  success(message) {
    this.show(message, { type: 'success' });
  }

  /** @param {string} message */
  error(message) {
    this.show(message, { type: 'error', duration: Math.max(this.duration, 6500) });
  }
}

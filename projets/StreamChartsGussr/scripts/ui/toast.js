/**
 * Toast discret pour les confirmations et messages fugaces.
 */
import { play } from './animations.js';
import { el } from './dom.js';

let placeholder = null;

function getContainer() {
  if (!placeholder) {
    placeholder = el('div', { className: 'toast-region', attrs: { 'aria-live': 'polite' } });
    document.body.append(placeholder);
  }
  return placeholder;
}

export function toast(message, { tone = '' } = {}) {
  const region = getContainer();
  const node = el('div', { className: `toast aero ${tone}`.trim(), text: message });
  region.append(node);
  play(node, 'reveal-item');

  setTimeout(() => {
    node.classList.add('toast-leave');
    node.addEventListener('transitionend', () => node.remove(), { once: true });
  }, 2400);

  return node;
}
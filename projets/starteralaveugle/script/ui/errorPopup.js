/**
 * UI: errorPopup
 * Displays a styled error popup overlay with a descriptive message.
 */

import { log } from '../business/logger.js';

/**
 * Show a modal error popup with a message.
 * Clicking the overlay or the close button dismisses it.
 * @param {string} message - The error message to display (may contain newlines)
 */
export function showError(message) {
  log('showError', message);

  // Remove any existing popup
  const existing = document.getElementById('error-popup-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'error-popup-overlay';
  overlay.className = 'error-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Erreur');

  overlay.innerHTML = `
    <div class="error-popup">
      <div class="error-popup__header">
        <span class="error-popup__icon">⚠️</span>
        <strong>Erreur</strong>
        <button class="error-popup__close" aria-label="Fermer">&times;</button>
      </div>
      <div class="error-popup__body">
        <pre>${escapeHtml(message)}</pre>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector('.error-popup__close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
}

/**
 * Escape HTML special characters in a string.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

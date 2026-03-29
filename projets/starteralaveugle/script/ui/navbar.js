/**
 * UI: navbar
 * Renders and manages the top navigation bar (menu + theme).
 */

import { toggleTheme, getCurrentTheme } from '../business/themeManager.js';
import { log } from '../business/logger.js';

/**
 * Initialize the navbar: theme toggle button and info link.
 * Should be called on DOMContentLoaded for every page.
 */
export function initNavbar() {
  const themeBtn = document.getElementById('btn-theme');
  const infoBtn = document.getElementById('btn-info');

  if (themeBtn) {
    updateThemeButton(themeBtn);
    themeBtn.addEventListener('click', () => {
      toggleTheme();
      updateThemeButton(themeBtn);
      log('navbar', 'Theme toggled to:', getCurrentTheme());
    });
  }

  if (infoBtn) {
    infoBtn.addEventListener('click', () => {
      window.open('info.html', '_blank');
    });
  }

  log('initNavbar', 'Navbar initialized');
}

/**
 * Update the label/icon of the theme button.
 * @param {HTMLElement} btn
 */
function updateThemeButton(btn) {
  const theme = getCurrentTheme();
  btn.textContent = theme === 'dark' ? '☀️ Clair' : '🌙 Sombre';
  btn.setAttribute('aria-label', theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre');
}

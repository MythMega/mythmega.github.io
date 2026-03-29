/**
 * Business: ThemeManager
 * Handles dark/light theme toggle, persisted in localStorage.
 */

import { log } from './logger.js';

const STORAGE_KEY = 'sav_theme';
const DARK = 'dark';
const LIGHT = 'light';

/**
 * Initialize the theme on page load.
 * Apply saved theme or default to dark.
 */
export function initTheme() {
  const saved = localStorage.getItem(STORAGE_KEY) ?? DARK;
  applyTheme(saved);
  log('initTheme', `Theme initialized: ${saved}`);
}

/**
 * Toggle between dark and light theme.
 */
export function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') ?? DARK;
  const next = current === DARK ? LIGHT : DARK;
  applyTheme(next);
  localStorage.setItem(STORAGE_KEY, next);
  log('toggleTheme', `Theme switched to: ${next}`);
}

/**
 * Apply a theme to the document.
 * @param {string} theme - 'dark' | 'light'
 */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

/**
 * Get the current theme.
 * @returns {string}
 */
export function getCurrentTheme() {
  return document.documentElement.getAttribute('data-theme') ?? DARK;
}

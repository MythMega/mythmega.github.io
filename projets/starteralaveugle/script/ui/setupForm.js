/**
 * UI: setupForm
 * Manages the setup page form controls (switches, option buttons).
 */

import { DEFAULT_SETTINGS } from '../entity/settings.js';
import { log } from '../business/logger.js';

/**
 * Read the current values of all form controls and return a settings object.
 * @returns {Object} Settings object matching GameSettings shape
 */
export function readForm() {
  const settings = {};

  // Switches
  settings.remove_evolvable = getSwitchValue('remove_evolvable');
  settings.smogon_only      = getSwitchValue('smogon_only');
  settings.show_size        = getSwitchValue('show_size');
  settings.show_multilang   = getSwitchValue('show_multilang');
  settings.show_categories  = getSwitchValue('show_categories');
  settings.show_stats       = getSwitchValue('show_stats');
  settings.show_egg_groups  = getSwitchValue('show_egg_groups');
  settings.show_catch_rate  = getSwitchValue('show_catch_rate');
  settings.show_evolution_status = getSwitchValue('show_evolution_status');
  settings.show_index       = getSwitchValue('show_index');
  settings.show_types       = getSwitchValue('show_types');

  // Option button groups
  settings.legendary = getOptionValue('legendary');
  settings.shiny     = getOptionValue('shiny');

  log('readForm', settings);
  return settings;
}

/**
 * Initialize the form with default values and wire up interactions.
 */
export function initForm() {
  // Initialize all switch states
  setSwitchValue('remove_evolvable', DEFAULT_SETTINGS.remove_evolvable);
  setSwitchValue('smogon_only',      DEFAULT_SETTINGS.smogon_only);
  setSwitchValue('show_size',        DEFAULT_SETTINGS.show_size);
  setSwitchValue('show_multilang',   DEFAULT_SETTINGS.show_multilang);
  setSwitchValue('show_categories',  DEFAULT_SETTINGS.show_categories);
  setSwitchValue('show_stats',       DEFAULT_SETTINGS.show_stats);
  setSwitchValue('show_egg_groups',  DEFAULT_SETTINGS.show_egg_groups);
  setSwitchValue('show_catch_rate',  DEFAULT_SETTINGS.show_catch_rate);
  setSwitchValue('show_evolution_status', DEFAULT_SETTINGS.show_evolution_status);
  setSwitchValue('show_index',       DEFAULT_SETTINGS.show_index);
  setSwitchValue('show_types',       DEFAULT_SETTINGS.show_types);

  // Initialize option button groups
  setOptionValue('legendary', DEFAULT_SETTINGS.legendary);
  setOptionValue('shiny',     DEFAULT_SETTINGS.shiny);

  // Wire up option button groups
  document.querySelectorAll('.option-group').forEach(group => {
    const groupId = group.dataset.group;
    group.querySelectorAll('.option-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.classList.contains('option-btn--disabled')) return;
        setOptionValue(groupId, btn.dataset.value);
        log('initForm', `Option group "${groupId}" → "${btn.dataset.value}"`);
      });
    });
  });

  log('initForm', 'Form initialized with defaults');
}

// ---- Helpers ----

function getSwitchValue(name) {
  const el = document.querySelector(`[data-switch="${name}"]`);
  return el ? el.classList.contains('switch--on') : false;
}

function setSwitchValue(name, value) {
  const el = document.querySelector(`[data-switch="${name}"]`);
  if (!el) return;
  if (value) {
    el.classList.add('switch--on');
    el.classList.remove('switch--off');
  } else {
    el.classList.add('switch--off');
    el.classList.remove('switch--on');
  }
  el.setAttribute('aria-checked', String(value));

  // Re-wire click if not already done
  if (!el.dataset.wired) {
    el.dataset.wired = '1';
    el.addEventListener('click', () => {
      const current = el.classList.contains('switch--on');
      setSwitchValue(name, !current);
    });
  }
}

function getOptionValue(group) {
  const active = document.querySelector(`[data-group="${group}"] .option-btn--active`);
  return active ? active.dataset.value : null;
}

function setOptionValue(group, value) {
  const groupEl = document.querySelector(`[data-group="${group}"]`);
  if (!groupEl) return;
  groupEl.querySelectorAll('.option-btn').forEach(btn => {
    const isActive = btn.dataset.value === value;
    btn.classList.toggle('option-btn--active', isActive);
    btn.disabled = isActive;
  });
}

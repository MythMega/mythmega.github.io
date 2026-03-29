/**
 * Entity: GameSettings
 * Represents the configuration parsed from URL query parameters.
 */

import { log } from '../business/logger.js';

/**
 * Default game settings.
 */
export const DEFAULT_SETTINGS = {
  // Selection
  remove_evolvable: false,  // remove Pokémon that can still evolve
  smogon_only: true,        // only include Pokémon with Smogon sets
  legendary: 'yes',         // 'yes' | 'no' | 'only'

  // Display
  shiny: 'normal',          // 'normal' | 'shiny'
  show_index: true,
  show_size: false,
  show_types: true,
  show_multilang: false,
  show_categories: false,
  show_stats: false,
  show_egg_groups: false,
  show_catch_rate: false,
  show_evolution_status: false
};

/**
 * Valid values for multi-option params.
 */
const VALID_LEGENDARY = ['yes', 'no', 'only'];
const VALID_SHINY = ['normal', 'shiny'];

/**
 * Parse and validate game settings from URLSearchParams.
 * Throws an Error with a descriptive message if a param is invalid.
 * @param {URLSearchParams} params
 * @returns {Object} Validated settings object
 */
export function parseSettings(params) {
  const settings = { ...DEFAULT_SETTINGS };
  const errors = [];

  function parseBool(key, paramName) {
    if (params.has(paramName)) {
      const val = params.get(paramName);
      if (val === '1' || val === 'true' || val === 'yes') {
        settings[key] = true;
      } else if (val === '0' || val === 'false' || val === 'no') {
        settings[key] = false;
      } else {
        errors.push(`Paramètre "${paramName}" invalide : "${val}". Valeurs acceptées : 1, 0, true, false, yes, no.`);
      }
    }
  }

  // Selection params
  parseBool('remove_evolvable', 'remove_evolvable');
  parseBool('smogon_only', 'smogon_only');

  if (params.has('legendary')) {
    const val = params.get('legendary');
    if (VALID_LEGENDARY.includes(val)) {
      settings.legendary = val;
    } else {
      errors.push(`Paramètre "legendary" invalide : "${val}". Valeurs acceptées : ${VALID_LEGENDARY.join(', ')}.`);
    }
  }

  // Display params
  if (params.has('shiny')) {
    const val = params.get('shiny');
    if (VALID_SHINY.includes(val)) {
      settings.shiny = val;
    } else {
      errors.push(`Paramètre "shiny" invalide : "${val}". Valeurs acceptées : ${VALID_SHINY.join(', ')}.`);
    }
  }

  parseBool('show_index', 'show_index');
  parseBool('show_size', 'show_size');
  parseBool('show_types', 'show_types');
  parseBool('show_multilang', 'show_multilang');
  parseBool('show_categories', 'show_categories');
  parseBool('show_stats', 'show_stats');
  parseBool('show_egg_groups', 'show_egg_groups');
  parseBool('show_catch_rate', 'show_catch_rate');
  parseBool('show_evolution_status', 'show_evolution_status');

  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }

  log('parseSettings', settings);
  return settings;
}

/**
 * Serialize settings to URLSearchParams string.
 * @param {Object} settings
 * @returns {string} Query string (without leading '?')
 */
export function settingsToQueryString(settings) {
  const p = new URLSearchParams();
  p.set('remove_evolvable', settings.remove_evolvable ? '1' : '0');
  p.set('smogon_only', settings.smogon_only ? '1' : '0');
  p.set('legendary', settings.legendary);
  p.set('shiny', settings.shiny);
  p.set('show_index', settings.show_index ? '1' : '0');
  p.set('show_size', settings.show_size ? '1' : '0');
  p.set('show_types', settings.show_types ? '1' : '0');
  p.set('show_multilang', settings.show_multilang ? '1' : '0');
  p.set('show_categories', settings.show_categories ? '1' : '0');
  p.set('show_stats', settings.show_stats ? '1' : '0');
  p.set('show_egg_groups', settings.show_egg_groups ? '1' : '0');
  p.set('show_catch_rate', settings.show_catch_rate ? '1' : '0');
  p.set('show_evolution_status', settings.show_evolution_status ? '1' : '0');
  return p.toString();
}

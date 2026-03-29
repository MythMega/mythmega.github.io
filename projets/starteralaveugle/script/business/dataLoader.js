/**
 * Business: DataLoader
 * Loads and caches Pokémon data from data.json.
 */

import { DATA_PATH } from '../../admin/settings.js';
import { createPokemon } from '../entity/pokemon.js';
import { log, error } from './logger.js';

let _cache = null;

/**
 * Load all Pokémon data from the JSON file.
 * Results are cached after the first load.
 * @returns {Promise<Object[]>} Array of normalized Pokémon entities
 */
export async function loadAllPokemon() {
  if (_cache) {
    log('loadAllPokemon', 'Returning cached data', _cache.length, 'pokémon');
    return _cache;
  }

  log('loadAllPokemon', 'Fetching', DATA_PATH);
  const response = await fetch(DATA_PATH);
  if (!response.ok) {
    throw new Error(`Impossible de charger les données (${response.status} ${response.statusText})`);
  }

  const raw = await response.json();
  log('loadAllPokemon', 'Raw entries loaded:', raw.length);

  _cache = raw
    .filter(p => p.pokedex_id !== 0)  // exclude MissingNo.
    .map(createPokemon);

  log('loadAllPokemon', 'Valid pokémon after MissingNo. filter:', _cache.length);
  return _cache;
}

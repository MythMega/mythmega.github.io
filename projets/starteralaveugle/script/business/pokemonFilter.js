/**
 * Business: PokemonFilter
 * Filters a list of Pokémon according to game settings.
 */

import { log } from './logger.js';

/**
 * Apply selection filters from settings to the full Pokémon list.
 * @param {Object[]} allPokemon - All Pokémon entities
 * @param {Object} settings - GameSettings entity
 * @returns {Object[]} Filtered Pokémon list
 */
export function filterPokemon(allPokemon, settings) {
  let pool = [...allPokemon];
  const initialCount = pool.length;

  // Filter out Pokémon that can still evolve
  if (settings.remove_evolvable) {
    pool = pool.filter(p => !p.has_evolution);
    log('filterPokemon', `remove_evolvable: ${initialCount} → ${pool.length}`);
  }

  // Filter out Pokémon without Smogon sets
  if (settings.smogon_only) {
    const before = pool.length;
    pool = pool.filter(p => p.sets && p.sets.length > 0);
    log('filterPokemon', `smogon_only: ${before} → ${pool.length}`);
  }

  // Legendary filter
  const beforeLeg = pool.length;
  if (settings.legendary === 'no') {
    pool = pool.filter(p => !p.is_legendary);
  } else if (settings.legendary === 'only') {
    pool = pool.filter(p => p.is_legendary);
  }
  // 'yes' = keep all
  log('filterPokemon', `legendary="${settings.legendary}": ${beforeLeg} → ${pool.length}`);

  log('filterPokemon', `Final pool size: ${pool.length}`);
  return pool;
}

/**
 * Pick N unique random Pokémon from the pool.
 * @param {Object[]} pool
 * @param {number} count
 * @returns {Object[]} Selected Pokémon
 */
export function pickRandom(pool, count) {
  if (pool.length < count) {
    throw new Error(
      `Impossible de sélectionner ${count} pokémon : seulement ${pool.length} disponibles avec ces filtres. Essayez d'assouplir les paramètres.`
    );
  }

  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const picked = shuffled.slice(0, count);
  log('pickRandom', `Picked ${count} from pool of ${pool.length}`, picked.map(p => p.name.fr));
  return picked;
}

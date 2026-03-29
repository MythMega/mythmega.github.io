/**
 * Business: TeamBuilder
 * Assembles the final Showdown export string from selected Pokémon.
 */

import { getSetString, pickRandomSetIndex } from '../entity/pokemonSet.js';
import { log } from './logger.js';

/**
 * Assign a random set index to each selected Pokémon.
 * @param {Object[]} selectedPokemon - Array of Pokémon entities
 * @returns {{ pokemon: Object, setIndex: number }[]}
 */
export function assignSets(selectedPokemon) {
  const result = selectedPokemon.map(pokemon => {
    const setIndex = pickRandomSetIndex(pokemon);
    log('assignSets', `${pokemon.name.fr} → set index ${setIndex}`);
    return { pokemon, setIndex };
  });
  return result;
}

/**
 * Build the full Showdown team export string.
 * @param {{ pokemon: Object, setIndex: number }[]} assignments
 * @returns {string}
 */
export function buildTeamExport(assignments) {
  const parts = assignments.map(({ pokemon, setIndex }) =>
    getSetString(pokemon, setIndex)
  );
  const exported = parts.join('\n\n');
  log('buildTeamExport', exported);
  return exported;
}

/**
 * Encode selected Pokémon + set indices to a URL query string.
 * Format: p1=<id>:<setIndex>&p2=...
 * @param {{ pokemon: Object, setIndex: number }[]} assignments
 * @returns {string}
 */
export function assignmentsToQueryString(assignments) {
  const p = new URLSearchParams();
  assignments.forEach(({ pokemon, setIndex }, i) => {
    p.set(`p${i + 1}`, `${pokemon.pokedex_id}:${setIndex}`);
  });
  return p.toString();
}

/**
 * Parse the result page URL params to get Pokémon IDs and set indices.
 * @param {URLSearchParams} params
 * @returns {{ pokedexId: number, setIndex: number }[]}
 */
export function parseAssignments(params) {
  const result = [];
  for (let i = 1; i <= 6; i++) {
    const raw = params.get(`p${i}`);
    if (!raw) continue;
    const parts = raw.split(':');
    if (parts.length !== 2) {
      throw new Error(`Paramètre "p${i}" invalide : "${raw}". Format attendu : <pokedex_id>:<set_index>.`);
    }
    const pokedexId = parseInt(parts[0], 10);
    const setIndex = parseInt(parts[1], 10);
    if (isNaN(pokedexId) || isNaN(setIndex)) {
      throw new Error(`Paramètre "p${i}" invalide : "${raw}". Les valeurs doivent être des entiers.`);
    }
    result.push({ pokedexId, setIndex });
  }

  if (result.length !== 6) {
    throw new Error(`Il faut exactement 6 pokémon en paramètres (p1 à p6). Reçu : ${result.length}.`);
  }

  return result;
}

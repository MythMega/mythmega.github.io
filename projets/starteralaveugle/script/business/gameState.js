/**
 * Business: GameState
 * Manages the state of an ongoing classic game session.
 */

import { log } from './logger.js';
import { pickRandom } from './pokemonFilter.js';

export const ROUNDS_TOTAL = 6;
export const POKEMON_PER_ROUND = 3;

/**
 * Create a new game state.
 * @param {Object[]} pool - Filtered Pokémon pool
 * @returns {Object} GameState
 */
export function createGameState(pool) {
  const state = {
    pool,
    selected: [],       // Pokémon chosen by the player (max ROUNDS_TOTAL)
    shownIds: new Set(), // IDs of all Pokémon shown so far (no duplicate across rounds)
    currentRound: []    // Pokémon shown in current round
  };
  log('createGameState', `Pool size: ${pool.length}`);
  return state;
}

/**
 * Draw a new round of 3 Pokémon (no duplicates with already shown).
 * Mutates state.currentRound and state.shownIds.
 * @param {Object} state - GameState
 * @returns {Object[]} The 3 Pokémon for this round
 */
export function drawRound(state) {
  const available = state.pool.filter(p => !state.shownIds.has(p.pokedex_id));
  const round = pickRandom(available, POKEMON_PER_ROUND);
  state.currentRound = round;
  round.forEach(p => state.shownIds.add(p.pokedex_id));
  log('drawRound', `Round drawn:`, round.map(p => p.name.fr));
  return round;
}

/**
 * Register a player's choice.
 * @param {Object} state - GameState
 * @param {Object} pokemon - Chosen Pokémon entity
 */
export function choosePokemon(state, pokemon) {
  state.selected.push(pokemon);
  log('choosePokemon', `Chosen: ${pokemon.name.fr} | Total chosen: ${state.selected.length}`);
}

/**
 * Returns true if the game is over (6 Pokémon selected).
 * @param {Object} state
 * @returns {boolean}
 */
export function isGameOver(state) {
  return state.selected.length >= ROUNDS_TOTAL;
}

/**
 * Entity: PokemonSet
 * Represents a Smogon competitive set for a Pokémon.
 */

/**
 * Creates a PokemonSet entity.
 * @param {string} name - Set name
 * @param {string} setString - Full Showdown export string
 * @returns {Object}
 */
export function createPokemonSet(name, setString) {
  return {
    name,
    set: setString
  };
}

/**
 * Pick a random set index from a Pokémon's sets array.
 * Returns -1 if no sets are available.
 * @param {Object} pokemon - Pokemon entity
 * @returns {number} Index of the chosen set, or -1
 */
export function pickRandomSetIndex(pokemon) {
  if (!pokemon.sets || pokemon.sets.length === 0) return -1;
  return Math.floor(Math.random() * pokemon.sets.length);
}

/**
 * Get the Showdown export string for a given Pokémon and set index.
 * Returns just the English name if index is -1 or invalid.
 * @param {Object} pokemon - Pokemon entity
 * @param {number} setIndex
 * @returns {string}
 */
export function getSetString(pokemon, setIndex) {
  if (setIndex === -1 || !pokemon.sets || !pokemon.sets[setIndex]) {
    return pokemon.name.en;
  }
  return pokemon.sets[setIndex].Set ?? pokemon.name.en;
}

/**
 * Entity: Pokemon
 * Represents a single Pokémon entry from data.json.
 */

/**
 * List of legendary/mythical Pokémon IDs.
 * Based on the official Pokémon games (Gens 1-9).
 */
export const LEGENDARY_IDS = new Set([
  // Gen 1
  144, 145, 146, 150, 151,
  // Gen 2
  243, 244, 245, 249, 250, 251,
  // Gen 3
  377, 378, 379, 380, 381, 382, 383, 384, 385, 386,
  // Gen 4
  480, 481, 482, 483, 484, 485, 486, 487, 488, 489, 490, 491, 492, 493,
  // Gen 5
  494, 638, 639, 640, 641, 642, 643, 644, 645, 646, 647, 648, 649,
  // Gen 6
  716, 717, 718, 719, 720, 721,
  // Gen 7
  772, 773, 785, 786, 787, 788, 789, 790, 791, 792, 793, 794, 795, 796,
  797, 798, 799, 800, 801, 802, 803, 804, 805, 806, 807,
  // Gen 8
  888, 889, 890, 891, 892, 893, 894, 895, 896, 897, 898,
  // Gen 9
  1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009, 1010,
  1017, 1023, 1024, 1025
]);

/**
 * Creates a normalized Pokemon object from raw JSON data.
 * @param {Object} raw - Raw object from data.json
 * @returns {Object} Normalized Pokémon entity
 */
export function createPokemon(raw) {
  return {
    pokedex_id: raw.pokedex_id,
    generation: raw.generation,
    name: {
      fr: raw.name?.fr ?? 'Inconnu',
      en: raw.name?.en ?? 'Unknown',
      jp: raw.name?.jp ?? '?'
    },
    category: raw.category ?? null,
    catch_rate: raw.catch_rate ?? null,
    types: Array.isArray(raw.types) ? raw.types : [],
    height: raw.height ?? null,
    weight: raw.weight ?? null,
    has_evolution: raw.has_evolution ?? false,
    is_evolved: raw.is_evolved ?? false,
    stats: raw.stats ?? null,
    talents: Array.isArray(raw.talents) ? raw.talents : [],
    egg_groups: Array.isArray(raw.egg_groups) ? raw.egg_groups : [],
    sprites: {
      regular: raw.sprites?.regular ?? null,
      shiny: raw.sprites?.shiny ?? null,
      gmax: raw.sprites?.gmax ?? null
    },
    sets: Array.isArray(raw.Sets) ? raw.Sets : [],
    is_legendary: LEGENDARY_IDS.has(raw.pokedex_id)
  };
}

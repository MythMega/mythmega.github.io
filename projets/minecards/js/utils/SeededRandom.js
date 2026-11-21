/**
 * SeededRandom - Deterministic random source of the booster draws.
 *
 * WHY
 * A pack must contain the same cards when the same save is replayed. The number of openings of an
 * extension is part of the save, so a player who saves, opens a pack, is not satisfied, reloads
 * and opens again must get the SAME pack: otherwise reloading would be a free reroll.
 *
 * THE SEED
 * `<uuid>-<n>-<setId>`, where `uuid` identifies the player (an imported `.save` carries its
 * original one), `n` is the 1-based number of openings of that extension already written, and
 * `setId` keeps the counters of two extensions independent. A refunded opening is never counted,
 * so a failed draw does not move the seed of the next one.
 *
 * THE PRNG
 * `hashSeed()` reduces the string to a 32-bit state (`xmur3`), `createSeededRandom()` produces the
 * floats from it (`mulberry32`). Both are tiny, dependency-free and stable: the sequence of a given
 * seed never changes between versions of the game.
 */

/**
 * Hashes a seed to a 32-bit unsigned integer.
 *
 * @param {string} seed - Seed text (UUID, opening number and extension id).
 * @returns {number} A 32-bit unsigned integer.
 */
export function hashSeed(seed) {
  const text = String(seed);
  let hash = 1779033703 ^ text.length;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }
  hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
  hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
  return (hash ^ (hash >>> 16)) >>> 0;
}

/**
 * Builds the random source of one opening.
 *
 * @param {string} seed - Seed text (see the module comment).
 * @returns {() => number} A function returning a float in [0, 1), in the same order for the same
 *   seed.
 */
export function createSeededRandom(seed) {
  let state = hashSeed(seed);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export default createSeededRandom;

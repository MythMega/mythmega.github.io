/**
 * Seeded pseudo-random number generator (Mulberry32).
 * Used to deterministically pick daily items from a date seed.
 */

/**
 * Creates a seeded PRNG from a string seed.
 * @param {string} seed
 * @returns {() => number} - function returning [0, 1)
 */
export function createSeededRng(seed) {
  // Hash the seed string to a 32-bit integer
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(31, h) + seed.charCodeAt(i) | 0;
  }
  // Mulberry32
  let state = h >>> 0;
  return function () {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Picks `count` unique random items from the array using the seeded PRNG.
 * @param {any[]} arr
 * @param {number} count
 * @param {() => number} rng
 * @returns {any[]}
 */
export function pickRandom(arr, count, rng) {
  const pool = [...arr];
  const result = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const idx = Math.floor(rng() * pool.length);
    result.push(pool.splice(idx, 1)[0]);
  }
  return result;
}

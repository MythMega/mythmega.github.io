/**
 * SeededRandom tests - a booster must replay the same pack from the same save.
 *
 * The seed of an opening is `<uuid>-<n>-<setId>`; the draw engine turns it into a deterministic
 * float sequence. These tests pin what the rest relies on:
 *   - the same seed always gives the same sequence, so reloading a save cannot reroll a pack;
 *   - two different seeds give two different sequences, so two openings cannot share cards;
 *   - every value is in [0, 1), which `GachaEngine.getRandomFloat()` requires;
 *   - the documented seed of the example save keeps its exact sequence: changing the hash or the
 *     generator would silently reroll every pack already saved.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSeededRandom, hashSeed } from '../../js/utils/SeededRandom.js';

/** Seed of the documented example: player UUID, 26th opening of the set A1. */
const EXAMPLE_SEED = 'a614f06d-1c26-480b-af6d-60346b8c306f-26-A1';

/**
 * Draws the first values of a seeded source.
 *
 * @param {string} seed - Seed text.
 * @param {number} count - How many values to draw.
 * @returns {number[]} The values, in order.
 */
function draw(seed, count) {
  const random = createSeededRandom(seed);
  return Array.from({ length: count }, () => random());
}

test('the same seed always draws the same pack', () => {
  assert.deepEqual(draw(EXAMPLE_SEED, 15), draw(EXAMPLE_SEED, 15));
});

test('two seeds draw two different packs', () => {
  const first = draw(EXAMPLE_SEED, 5);
  const second = draw('a614f06d-1c26-480b-af6d-60346b8c306f-27-A1', 5);
  assert.notDeepEqual(first, second);
});

test('every value is a float in [0, 1)', () => {
  draw(EXAMPLE_SEED, 500).forEach((value) => {
    assert.equal(typeof value, 'number');
    assert.ok(value >= 0 && value < 1, `unexpected value: ${value}`);
  });
});

test('the documented seed keeps its exact sequence', () => {
  assert.equal(hashSeed(EXAMPLE_SEED), 3789910302);
  assert.deepEqual(draw(EXAMPLE_SEED, 5), [
    0.03696626494638622,
    0.5123902645427734,
    0.29553410317748785,
    0.6838068573269993,
    0.6033012925181538,
  ]);
});

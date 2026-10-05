/**
 * GachaEngine - Weighted draw engine of the booster openings.
 *
 * Reference: `.docs/main.md` section 3.C and `.docs/steps/3.md`.
 *
 * Rules:
 *   - a booster contains 5 cards (one per "slot"), declared in `settings/rarity.json` under the
 *     keys "1".."5";
 *   - for each slot the rarity is drawn with a weighted roll over the slot entries;
 *   - once the rarity R is chosen, one card is picked uniformly among the cards of rarity R of
 *     the extension JSON;
 *   - duplicates are allowed, both inside a single booster and across boosters.
 *
 * This module is intentionally pure: it never touches IndexedDB nor the DOM, so it can be
 * exercised in isolation. Everything it can reject is validated BEFORE anything is persisted
 * (`validatePackConfig` is called by `BoosterManager` before the booster is consumed), because a
 * data error must never cost the player a booster.
 *
 * Randomness: `Math.random()` is the default source, overridable through the `random` option.
 * A collectible single-player game has nothing to protect against a predictable PRNG (the odds
 * are public); the anti-cheat concern of the project is the clock, not the draw. The override
 * exists to make the engine deterministic in tests and reproducible when debugging a report.
 */

import Card from '../classes/Card.js';

/** Rarity bounds accepted in `settings/rarity.json` and in the set JSON. */
const MIN_RARITY = Card.RARITY.MIN;
const MAX_RARITY = Card.RARITY.MAX;

/** Number of cards in a booster when the caller does not declare one. */
const DEFAULT_CARDS_PER_BOOSTER = 5;

export class GachaEngine {
  /**
   * @param {object} [options] - Engine options.
   * @param {() => number} [options.random=Math.random] - Random source returning a float in [0, 1).
   */
  constructor({ random = Math.random } = {}) {
    if (typeof random !== 'function') {
      throw new TypeError('GachaEngine expects the `random` option to be a function.');
    }
    this.random = random;
  }

  /**
   * Draws a complete booster.
   *
   * @param {object} boosterSetData - Parsed extension JSON (`{ id|ID, Serie, Cards: [...] }`) or
   *   an already resolved set object (`{ setId, cards: Card[] }`).
   * @param {Record<string, Array<{rarity: number, weight: number}>>} rarityConfig - Slot table of
   *   `settings/defaultRarity.json`, keyed by slot number as a string.
   * @param {object} [options] - Draw options.
   * @param {number} [options.cardsPerBooster=DEFAULT_CARDS_PER_BOOSTER] - Expected number of slots.
   * @returns {Card[]} The drawn cards, in slot order (duplicates possible).
   * @throws {TypeError|RangeError} When the set data or the rarity table is invalid.
   * @throws {Error} When a drawn rarity has no card in the extension (corrupted data).
   */
  drawPack(boosterSetData, rarityConfig, { cardsPerBooster = DEFAULT_CARDS_PER_BOOSTER } = {}) {
    const { slots, cardsByRarity } = this.validatePackConfig(boosterSetData, rarityConfig, cardsPerBooster);
    const setId = GachaEngine.resolveSetId(boosterSetData);

    return slots.map((slot) => {
      const rarity = this.drawRarity(rarityConfig[slot], `slot ${slot}`);
      return this.drawCardOfRarity(cardsByRarity, rarity, setId, `slot ${slot}`);
    });
  }

  /**
   * Validates everything `drawPack` needs, without drawing anything.
   *
   * Called by `BoosterManager` when a set is loaded AND before a booster is consumed: a corrupted
   * extension or rarity table must fail before the quota is touched.
   *
   * @param {object} boosterSetData - Parsed extension JSON or resolved set object.
   * @param {Record<string, Array<{rarity: number, weight: number}>>} rarityConfig - Slot table.
   * @param {number} [cardsPerBooster=DEFAULT_CARDS_PER_BOOSTER] - Expected number of slots.
   * @returns {{slots: number[], cardsByRarity: Map<number, Card[]>, setId: string}} Draw context.
   * @throws {TypeError} When an argument is missing or of the wrong type.
   * @throws {RangeError} When a slot, a weight, a rarity or the slot count is invalid.
   * @throws {Error} When a drawable rarity has no card in the extension.
   */
  validatePackConfig(boosterSetData, rarityConfig, cardsPerBooster = DEFAULT_CARDS_PER_BOOSTER) {
    const setId = GachaEngine.resolveSetId(boosterSetData);
    const cardsByRarity = GachaEngine.groupCardsByRarity(boosterSetData, { setId });
    const slots = GachaEngine.getSortedSlots(rarityConfig);

    if (!Number.isInteger(cardsPerBooster) || cardsPerBooster <= 0) {
      throw new RangeError(`cardsPerBooster must be a strictly positive integer (received: ${cardsPerBooster}).`);
    }
    if (slots.length !== cardsPerBooster) {
      throw new RangeError(
        `The rarity table declares ${slots.length} slot(s) but the booster contains ${cardsPerBooster} card(s).`
      );
    }

    slots.forEach((slot) => {
      const entries = this.normalizeWeights(rarityConfig[slot], `slot ${slot}`);
      entries.forEach(({ rarity }) => {
        if (!cardsByRarity.has(rarity)) {
          throw new Error(
            `Extension "${setId}" has no card of rarity ${rarity} while slot ${slot} can draw it: the booster data is incomplete.`
          );
        }
      });
    });

    return { slots, cardsByRarity, setId };
  }

  /**
   * Draws a rarity for one slot.
   *
   * @param {Array<{rarity: number, weight: number}>} slotEntries - Raw slot table.
   * @param {string} [label='slot'] - Label used in error messages.
   * @returns {number} The drawn rarity (integer from 1 to 5).
   * @throws {TypeError|RangeError} When the slot table is malformed.
   */
  drawRarity(slotEntries, label = 'slot') {
    const entries = this.normalizeWeights(slotEntries, label);
    const roll = this.getRandomFloat() * 100;
    let cumulative = 0;

    for (const entry of entries) {
      cumulative += entry.normalizedWeight;
      if (roll < cumulative) {
        return entry.rarity;
      }
    }
    // Floating point safety net: the rounding of the normalized weights can leave a gap of
    // ~1e-13 at the very end of the range.
    return entries[entries.length - 1].rarity;
  }

  /**
   * Picks a random card among the cards of one rarity.
   *
   * @param {Map<number, Card[]>} cardsByRarity - Cards of the extension, grouped by rarity.
   * @param {number} rarity - Drawn rarity.
   * @param {string} setId - Extension id, used in the error message.
   * @param {string} [label='slot'] - Label used in error messages.
   * @returns {Card} A randomly picked card.
   * @throws {Error} When no card of that rarity exists in the extension.
   */
  drawCardOfRarity(cardsByRarity, rarity, setId, label = 'slot') {
    const candidates = cardsByRarity.get(rarity);
    if (!candidates || candidates.length === 0) {
      throw new Error(
        `Extension "${setId}" has no card of rarity ${rarity} (${label}): the booster data is incomplete.`
      );
    }
    return candidates[Math.floor(this.getRandomFloat() * candidates.length)];
  }

  /**
   * Normalizes the weights of a slot table so they sum up to 100.
   *
   * @param {unknown} slotEntries - Raw slot table.
   * @param {string} [label='slot'] - Label used in error messages.
   * @returns {Array<{rarity: number, weight: number, normalizedWeight: number}>} The entries, in
   *   declaration order, with their normalized weight (percentage).
   * @throws {TypeError} When a rarity or a weight has the wrong type.
   * @throws {RangeError} When the table is empty or a value is out of range.
   */
  normalizeWeights(slotEntries, label = 'slot') {
    if (!Array.isArray(slotEntries) || slotEntries.length === 0) {
      throw new RangeError(`${label}: settings/rarity.json must declare at least one rarity entry.`);
    }

    let total = 0;
    const entries = slotEntries.map((entry, index) => {
      if (!entry || typeof entry !== 'object') {
        throw new TypeError(`${label}: entry #${index} must be an object.`);
      }
      const { rarity, weight } = entry;

      if (typeof rarity !== 'number' || !Number.isInteger(rarity)) {
        throw new TypeError(`${label}: entry #${index} rarity must be an integer (received: ${JSON.stringify(rarity)}).`);
      }
      if (rarity < MIN_RARITY || rarity > MAX_RARITY) {
        throw new RangeError(
          `${label}: entry #${index} rarity must be between ${MIN_RARITY} and ${MAX_RARITY} (received: ${rarity}).`
        );
      }
      if (typeof weight !== 'number' || !Number.isFinite(weight)) {
        throw new TypeError(`${label}: entry #${index} weight must be a number (received: ${JSON.stringify(weight)}).`);
      }
      if (weight <= 0) {
        throw new RangeError(`${label}: entry #${index} weight must be strictly positive (received: ${weight}).`);
      }

      total += weight;
      return { rarity, weight, normalizedWeight: 0 };
    });

    entries.forEach((entry) => {
      entry.normalizedWeight = (entry.weight / total) * 100;
    });
    return entries;
  }

  /**
   * Returns a random float in [0, 1).
   *
   * @returns {number} The random value.
   * @throws {RangeError} When the injected source returns a value outside [0, 1).
   */
  getRandomFloat() {
    const value = this.random();
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value >= 1) {
      throw new RangeError(`The random source must return a float in [0, 1) (received: ${JSON.stringify(value)}).`);
    }
    return value;
  }

  /**
   * Resolves the extension id of a booster payload.
   *
   * The real generated data uses `ID` (a number) plus `Serie` ("A1"), the documented schema used
   * `id`. The series is what identifies the extension (file name, `config.json` entry), so it
   * takes precedence; `setId` is accepted for an already resolved set object.
   *
   * @param {object} boosterSetData - Parsed extension JSON or resolved set object.
   * @returns {string} The extension id (e.g. "A1").
   * @throws {TypeError} When no usable identifier is found.
   */
  static resolveSetId(boosterSetData) {
    if (!boosterSetData || typeof boosterSetData !== 'object') {
      throw new TypeError('The booster set data must be an object.');
    }
    const candidates = [boosterSetData.setId, boosterSetData.Serie, boosterSetData.serie, boosterSetData.id];
    const found = candidates.find((value) => typeof value === 'string' && value.trim() !== '');
    if (!found) {
      throw new TypeError('The booster set data must declare a "Serie" (or a "setId"/"id") identifier.');
    }
    return found.trim();
  }

  /**
   * Returns the raw card entries of a booster payload.
   *
   * Accepts both field names: `Cards` (real generated data) and `cards` (documented schema).
   *
   * @param {object} boosterSetData - Parsed extension JSON or resolved set object.
   * @returns {Array<object|Card>} The raw entries or already built cards.
   * @throws {TypeError} When the payload declares no non-empty card array.
   */
  static getRawCards(boosterSetData) {
    if (!boosterSetData || typeof boosterSetData !== 'object') {
      throw new TypeError('The booster set data must be an object.');
    }
    const entries = boosterSetData.Cards ?? boosterSetData.cards;
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new TypeError(
        `Extension "${GachaEngine.safeSetId(boosterSetData)}" must declare a non-empty "Cards" array.`
      );
    }
    return entries;
  }

  /**
   * Reads the extension id when the payload is malformed, without throwing.
   *
   * @param {object} boosterSetData - Parsed extension JSON.
   * @returns {string} The id, or "?" when it cannot be resolved.
   */
  static safeSetId(boosterSetData) {
    try {
      return GachaEngine.resolveSetId(boosterSetData);
    } catch {
      return '?';
    }
  }

  /**
   * Builds and validates the cards of an extension.
   *
   * Card ids are unique across extensions, so a duplicate `${id}_${style}` inside one file means
   * two distinct entries would collide in the `collection` store: it is rejected here.
   *
   * @param {object} boosterSetData - Parsed extension JSON, or `{ setId, cards: Card[] }`.
   * @param {object} [context] - Build context.
   * @param {string} [context.setId] - Forced extension id (used when the payload has none).
   * @param {string} [context.lang='fr'] - Language of legacy single-name cards.
   * @returns {Card[]} The validated cards, in declaration order.
   * @throws {TypeError} When the extension data is not an object with a non-empty card array.
   * @throws {RangeError} When two entries share the same `${id}_${style}` key.
   */
  static parseCards(boosterSetData, { setId = null, lang = 'fr' } = {}) {
    const entries = GachaEngine.getRawCards(boosterSetData);
    const resolvedSetId = setId ?? GachaEngine.safeSetId(boosterSetData);
    const alreadyBuilt = entries.every((entry) => entry instanceof Card);
    const seen = new Map();

    return entries.map((entry, index) => {
      if (alreadyBuilt) return entry;

      let card;
      try {
        card = Card.fromAnySchema(entry, { set: resolvedSetId, lang });
      } catch (error) {
        throw new TypeError(
          `Extension "${resolvedSetId}": card #${index} is invalid (${error.message}).`,
          { cause: error }
        );
      }
      if (seen.has(card.uniqueKey)) {
        throw new RangeError(
          `Extension "${resolvedSetId}": card #${index} duplicates the key "${card.uniqueKey}" already used by card #${seen.get(card.uniqueKey)}.`
        );
      }
      seen.set(card.uniqueKey, index);
      return card;
    });
  }

  /**
   * Picks the rarity table used by a draw.
   *
   * `settings/defaultRarity.json` is the default. If the booster JSON itself declares a `Rarity`
   * slot table, it overrides the default (`.docs/steps/3.md` point 1). A `Rarity` value that is
   * not a slot table (for instance a number, which is the per-card rarity field) is ignored with
   * a warning so a card-level field can never silently replace the whole probability table.
   *
   * @param {object} boosterSetData - Parsed extension JSON.
   * @param {Record<string, Array<{rarity: number, weight: number}>>} defaultRarityConfig - Default table.
   * @returns {{config: Record<string, Array<{rarity: number, weight: number}>>, source: 'booster'|'default'}}
   *   The table to use and where it came from.
   * @throws {TypeError} When neither table is usable.
   */
  static resolveRarityConfig(boosterSetData, defaultRarityConfig) {
    const override = boosterSetData && typeof boosterSetData === 'object' ? boosterSetData.Rarity : undefined;
    const isSlotTable = override && typeof override === 'object' && !Array.isArray(override);

    if (override !== undefined && !isSlotTable) {
      console.warn(
        `[GachaEngine] Extension "${GachaEngine.safeSetId(boosterSetData)}" declares a "Rarity" field that is not a slot table: the default rarity table is used.`
      );
    }
    if (isSlotTable) {
      GachaEngine.getSortedSlots(override);
      return { config: override, source: 'booster' };
    }
    if (!defaultRarityConfig || typeof defaultRarityConfig !== 'object') {
      throw new TypeError('No rarity table available: settings/defaultRarity.json is missing or invalid.');
    }
    GachaEngine.getSortedSlots(defaultRarityConfig);
    return { config: defaultRarityConfig, source: 'default' };
  }

  /**
   * Groups the cards of an extension by rarity.
   *
   * @param {object|Card[]} boosterSetData - Parsed extension JSON, resolved set object, or an
   *   already built card array.
   * @param {object} [context] - Build context passed to `parseCards()`.
   * @param {string} [context.setId] - Forced extension id.
   * @returns {Map<number, Card[]>} Cards grouped by rarity, in declaration order.
   * @throws {TypeError|RangeError} See `parseCards()`.
   */
  static groupCardsByRarity(boosterSetData, context = {}) {
    const cards = Array.isArray(boosterSetData) ? boosterSetData : GachaEngine.parseCards(boosterSetData, context);
    const cardsByRarity = new Map();

    cards.forEach((card) => {
      if (!cardsByRarity.has(card.rarity)) {
        cardsByRarity.set(card.rarity, []);
      }
      cardsByRarity.get(card.rarity).push(card);
    });
    return cardsByRarity;
  }

  /**
   * Returns the slot numbers of a rarity table, sorted numerically.
   *
   * @param {unknown} rarityConfig - Parsed `settings/defaultRarity.json` (or a booster override).
   * @param {string} [source='settings/defaultRarity.json'] - Source label used in error messages.
   * @returns {number[]} The slot numbers (e.g. `[1, 2, 3, 4, 5]`).
   * @throws {TypeError} When the table is not a JSON object.
   * @throws {RangeError} When a slot key is not a strictly positive integer or the table is empty.
   */
  static getSortedSlots(rarityConfig, source = 'settings/defaultRarity.json') {
    if (!rarityConfig || typeof rarityConfig !== 'object' || Array.isArray(rarityConfig)) {
      throw new TypeError(`${source} must be a JSON object keyed by slot number.`);
    }

    const slots = Object.keys(rarityConfig).map((key) => {
      const slot = Number(key);
      if (!Number.isInteger(slot) || slot <= 0) {
        throw new RangeError(`${source} has an invalid slot key "${key}": expected a strictly positive integer.`);
      }
      return slot;
    });

    if (slots.length === 0) {
      throw new RangeError(`${source} must declare at least one slot.`);
    }
    return slots.sort((left, right) => left - right);
  }

  /**
   * Counts the distinct printings of an extension per rarity, for the statistics and diagnostics.
   *
   * @param {object|Card[]} boosterSetData - Parsed extension JSON or an array of cards.
   * @param {object} [context] - Build context passed to `groupCardsByRarity()`.
   * @returns {Record<number, number>} Number of printings per rarity.
   * @throws {TypeError|RangeError} See `parseCards()`.
   */
  static countCardsByRarity(boosterSetData, context = {}) {
    const counts = {};
    GachaEngine.groupCardsByRarity(boosterSetData, context).forEach((cards, rarity) => {
      counts[rarity] = cards.length;
    });
    return counts;
  }
}

export default GachaEngine;
/**
 * RandomCardReward - The "a random card" rewards of the daily connection and of the codes.
 *
 * Reference: `settings/daily_connect_rewards.json` (days 5, 10 and 20), `settings/codes.json`
 * (`WoollyD4nce`) and `.docs/projet/05-daily-rewards.md`.
 *
 * TWO SHAPES, one reward:
 *
 *   { "Type": "RandomCard-List",   "Qte": 1, "Data": { "ListCard": ["SERIE-A1 _ W001_classic", ...] } }
 *   { "Type": "RandomCard-Filter", "Qte": 1, "Data": { "Rarities": [4], "layouts": ["fullart"],
 *                                                       "Sets": ["A1"], "BePromo": false } }
 *
 *   - `RandomCard-List` names printings by `uniqueKey` (`<id>_<layout>`, the key the collection
 *     stores). A list may be empty and then declare `DefaultLayout`: the reward is then "any card
 *     printed that way", which is what day 20 of the shipped chapter asks for. An empty list with
 *     no `DefaultLayout` means every released printing.
 *   - `RandomCard-Filter` keeps the cards whose rarity is one of `Rarities`, whose layout is one of
 *     `layouts` (`classic`, `fullart`, or `normal` for `classic`) and that belong to one of `Sets`.
 *     A set may be written as its extension id (`A1`) or as a promo group (`A1-Promo`,
 *     `PROMO-A1`). `BePromo` states whether the reward is a PROMO card: true keeps the promo
 *     printings only, false the regular ones only. An absent or empty filter keeps everything.
 *
 * THE POOL
 * Up to `RANDOM_CARD_POOL_LIMIT` DISTINCT printings, shuffled, among the released sets only - a
 * reward can never hand out content before its release, exactly like a `Card` reward. Every
 * distinct card of the pool has the SAME chance: the draw is a uniform pick, never a weighted one.
 *
 * THE REEL
 * The wheel of the roulette always shows at least `RANDOM_CARD_REEL_MIN_TILES` tiles: a pool of
 * three cards is repeated along the strip, duplicates included, so the window is never empty and
 * the spin is always readable. The winner sits at a known index near the end of the strip, and it
 * is the only tile the wheel can stop under.
 *
 * This module is pure data: it never writes to the save and never touches the DOM. `DailyReward`
 * and `RedeemManager` both grant the card inside their own transaction, then hand the reel to
 * `js/UI/components/CardRoulettePopup.js`.
 */

import boosterManager from './BoosterManager.js';
import promoManager from './PromoManager.js';
import { isPromoSetId, PROMO_SET_SUFFIX } from './PromoSet.js';

/** Reward `Type` values handled here, as the data files spell them. */
export const RANDOM_CARD_REWARD_TYPES = Object.freeze({
  LIST: 'RandomCard-List',
  FILTER: 'RandomCard-Filter',
});

/** How the reward designates its cards. */
export const RANDOM_CARD_MODES = Object.freeze({ LIST: 'list', FILTER: 'filter' });

/** Highest number of distinct cards a roulette may hold. */
export const RANDOM_CARD_POOL_LIMIT = 10;

/** Length of the strip the wheel spins, in tiles (long enough for a five-second spin). */
export const RANDOM_CARD_REEL_LENGTH = 26;

/** Minimum number of DIFFERENT tiles a reel shows before repeating them. */
export const RANDOM_CARD_REEL_MIN_TILES = 5;

/** Tints a random-card tile of the daily board can wear (see `randomCardTint()`). */
export const RANDOM_CARD_TINTS = Object.freeze({
  INK: 'ink',
  SUPER: 'super',
  LEGENDARY: 'legendary',
  MYTHIC: 'mythic',
});

/** True for a plain object (not null, not an array). */
const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** True for a string holding at least one non-whitespace character. */
const isFilled = (value) => typeof value === 'string' && value.trim() !== '';

/**
 * Tells whether a reward `Type` is one of the random card ones.
 *
 * @param {unknown} type - Raw `Type` of a reward.
 * @returns {boolean} True for `RandomCard-List` and `RandomCard-Filter`, case notwithstanding.
 */
export function isRandomCardRewardType(type) {
  return normalizeRandomCardMode(type) !== null;
}

/**
 * Reads the mode a reward `Type` designates.
 *
 * @param {unknown} type - Raw `Type` of a reward.
 * @returns {'list'|'filter'|null} The mode, or null when the type is not a random card one.
 */
export function normalizeRandomCardMode(type) {
  if (!isFilled(type)) return null;
  const normalized = type.trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (normalized === 'randomcard-list') return RANDOM_CARD_MODES.LIST;
  if (normalized === 'randomcard-filter') return RANDOM_CARD_MODES.FILTER;
  return null;
}

/**
 * Normalizes one print style of a filter.
 *
 * `normal` is the documented name of `classic` in the rest of the game (see `Card.assertStyle`).
 *
 * @param {unknown} value - Raw layout.
 * @returns {string|null} `classic`, `fullart`, or null when the value is not a print style.
 */
function normalizeLayout(value) {
  if (!isFilled(value)) return null;
  const layout = value.trim().toLowerCase();
  if (layout === 'normal') return 'classic';
  if (layout === 'classic' || layout === 'fullart') return layout;
  return null;
}

/**
 * Normalizes one extension id of a filter, and tells whether it designates a promo group.
 *
 * @param {unknown} value - Raw set id (`A1`, `A1-Promo`, `PROMO-A1`).
 * @returns {{parentSetId: string, promo: boolean}|null} The extension and its promo flag, or null.
 */
function normalizeSet(value) {
  if (!isFilled(value)) return null;
  let setId = value.trim();
  let promo = false;
  if (isPromoSetId(setId)) {
    setId = setId.slice(0, -PROMO_SET_SUFFIX.length);
    promo = true;
  } else if (/^promo[-_ ]/i.test(setId)) {
    setId = setId.replace(/^promo[-_ ]+/i, '');
    promo = true;
  }
  return setId === '' ? null : { parentSetId: setId.toUpperCase(), promo };
}

/**
 * Reads the raw list of one `Data` field as strings.
 *
 * @param {unknown} value - Raw field (an array, or a single string).
 * @returns {string[]} The trimmed, non-empty values, in declaration order.
 */
function readStringList(value) {
  const entries = Array.isArray(value) ? value : [value];
  return entries.filter(isFilled).map((entry) => entry.trim());
}

/**
 * Reads the raw list of a numeric field (`Rarities`, written `[4]` or `["4"]`).
 *
 * A number is not a string: `readStringList` would drop it, and the filter would then silently
 * match every rarity instead of the declared one.
 *
 * @param {unknown} value - Raw field (an array, a number or a numeric string).
 * @returns {number[]} The values that are integers, in declaration order.
 */
function readNumberList(value) {
  const entries = Array.isArray(value) ? value : [value];
  return entries
    .map((entry) => (typeof entry === 'number' ? entry : Number(String(entry ?? '').trim())))
    .filter((entry) => Number.isInteger(entry));
}

/**
 * Normalizes a random card reward.
 *
 * Never throws: a field the game cannot read is dropped, so a typo costs one criterion, never the
 * whole day (the same policy as `DailyRewardManager.parseReward`).
 *
 * @param {unknown} raw - Reward object (`{ Type, Qte, Data }`).
 * @returns {{mode: 'list'|'filter', list: string[], layouts: string[], rarities: number[],
 *   sets: string[], promoOnly: boolean, defaultLayout: string|null, maxRarity: number}|null}
 *   The spec, or null when the reward is not a random card one.
 */
export function parseRandomCardSpec(raw) {
  if (!isRecord(raw)) return null;
  const mode = normalizeRandomCardMode(raw.Type);
  if (!mode) return null;

  const data = isRecord(raw.Data) ? raw.Data : {};
  const layouts = readStringList(data.layouts ?? data.Layouts)
    .map(normalizeLayout)
    .filter((layout) => layout !== null);
  const rarities = readNumberList(data.Rarities).filter((value) => value >= 1 && value <= 5);
  const sets = readStringList(data.Sets)
    .map(normalizeSet)
    .filter((entry) => entry !== null);

  return {
    mode,
    list: readStringList(data.ListCard),
    layouts: Array.from(new Set(layouts)),
    rarities: Array.from(new Set(rarities)),
    sets: Array.from(new Set(sets.map((entry) => entry.parentSetId))),
    // A set written as a promo group is a promo reward too, whatever `BePromo` says.
    promoOnly: data.BePromo === true || sets.some((entry) => entry.promo),
    defaultLayout: normalizeLayout(data.DefaultLayout),
    maxRarity: rarities.length > 0 ? Math.max(...rarities) : 0,
  };
}

/**
 * True when a catalogue row belongs to an extension of the filter.
 *
 * @param {{card: object, parentSetId: string}} row - Catalogue row.
 * @param {object} spec - Normalized spec.
 * @returns {boolean} True when the set matches (an empty filter matches everything).
 */
function matchesSet(row, spec) {
  if (spec.sets.length === 0) return true;
  return spec.sets.includes(String(row.parentSetId).toUpperCase());
}

/**
 * True when a catalogue row satisfies a filter.
 *
 * @param {{card: object, parentSetId: string, promo: boolean}} row - Catalogue row.
 * @param {object} spec - Normalized spec.
 * @returns {boolean} True when the row is part of the pool.
 */
function matchesFilter(row, spec) {
  if (!matchesSet(row, spec)) return false;
  if (spec.promoOnly && !row.promo) return false;
  if (spec.rarities.length > 0 && !spec.rarities.includes(row.card.rarity)) return false;
  if (spec.layouts.length > 0 && !spec.layouts.includes(row.card.style)) return false;
  return true;
}

/** @type {Promise<Array<object>>|null} In-flight catalogue, shared by both claim paths. */
let catalogPromise = null;

/**
 * Reads the printings every random card reward can draw from.
 *
 * Only the RELEASED sets are read (`listBoosterSets()` and `listPromoSets()` both leave an
 * extension that is not out yet), and the result is cached: a roulette, a board redraw and a claim
 * all walk the same list.
 *
 * @returns {Promise<Array<{card: object, setId: string, parentSetId: string, promo: boolean}>>}
 *   The rows, regular extensions first, then the promo groups.
 * @throws {Error} When an extension catalogue cannot be read.
 */
export function loadRandomCardCatalog() {
  if (catalogPromise) return catalogPromise;

  catalogPromise = (async () => {
    const rows = [];
    for (const summary of await boosterManager.listBoosterSets()) {
      const set = await boosterManager.getBoosterSet(summary.setId);
      for (const card of set.cards ?? []) {
        rows.push({ card, setId: summary.setId, parentSetId: summary.setId, promo: false });
      }
    }
    try {
      for (const group of await promoManager.listPromoSets()) {
        for (const card of group.cards ?? []) {
          rows.push({
            card,
            setId: group.setId,
            parentSetId: group.parentSetId,
            promo: true,
          });
        }
      }
    } catch (error) {
      // A broken promo file must cost the promo printings, never the whole reward.
      console.warn('[RandomCardReward] The promo cards could not be read.', error);
    }
    return rows;
  })().catch((error) => {
    catalogPromise = null;
    throw error;
  });

  return catalogPromise;
}

/**
 * Shuffles a list without touching the input.
 *
 * @param {Array<unknown>} values - Values to shuffle.
 * @param {() => number} random - Random source returning a float in [0, 1).
 * @returns {Array<unknown>} A new, shuffled array.
 */
function shuffle(values, random) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

/**
 * Resolves the printed cards a random card reward may give.
 *
 * @param {object} spec - Normalized spec (`parseRandomCardSpec()`).
 * @param {object} [options] - Resolution options.
 * @param {() => number} [options.random=Math.random] - Random source used to build the pool.
 * @returns {Promise<object[]>} Up to `RANDOM_CARD_POOL_LIMIT` distinct `Card` instances.
 * @throws {Error} When a catalogue cannot be read.
 */
export async function resolveRandomCardPool(spec, { random = Math.random } = {}) {
  if (!isRecord(spec)) return [];
  const rows = await loadRandomCardCatalog();

  let cards;
  if (spec.mode === RANDOM_CARD_MODES.LIST && spec.list.length > 0) {
    const byKey = new Map(rows.map((row) => [row.card.uniqueKey, row.card]));
    cards = spec.list.map((key) => byKey.get(key)).filter(Boolean);
  } else if (spec.mode === RANDOM_CARD_MODES.LIST) {
    cards = rows
      .filter((row) => (spec.defaultLayout ? row.card.style === spec.defaultLayout : true))
      .map((row) => row.card);
  } else {
    cards = rows.filter((row) => matchesFilter(row, spec)).map((row) => row.card);
  }

  // Distinct keys, then a shuffle: a pool is "some of the matching cards", never the first ones
  // of the catalogue, otherwise a 10-card pool of a 200-card set would always be the same ten.
  const distinct = new Map();
  cards.forEach((card) => {
    if (!distinct.has(card.uniqueKey)) distinct.set(card.uniqueKey, card);
  });

  return shuffle([...distinct.values()], random).slice(0, RANDOM_CARD_POOL_LIMIT);
}

/**
 * Draws one card of a pool, uniformly.
 *
 * @param {object[]} pool - Cards of the pool.
 * @param {() => number} [random=Math.random] - Random source.
 * @returns {object|null} The drawn card, or null when the pool is empty.
 */
export function drawRandomCard(pool, random = Math.random) {
  if (!Array.isArray(pool) || pool.length === 0) return null;
  const index = Math.min(pool.length - 1, Math.floor(random() * pool.length));
  return pool[index];
}

/**
 * Builds the strip the roulette spins and the index the wheel stops on.
 *
 * @param {object[]} pool - Cards of the pool (at least the winner).
 * @param {object} winner - Card that must be under the marker at the end.
 * @param {object} [options] - Reel options.
 * @param {() => number} [options.random=Math.random] - Random source used to order the strip.
 * @returns {{cards: object[], winnerIndex: number}} The strip and the winning position.
 */
export function buildRandomCardReel(pool, winner, { random = Math.random } = {}) {
  const distinct = Array.isArray(pool) ? pool.filter(Boolean) : [];
  const source = distinct.length > 0 ? distinct : [winner];
  const length = Math.max(RANDOM_CARD_REEL_LENGTH, source.length * 3);
  // Six tiles after the winner: the wheel visibly slows down before the marker, and the strip
  // never ends on the card being revealed.
  const winnerIndex = length - 6;
  const order = shuffle(source, random);
  const cards = Array.from({ length }, (_, index) => order[index % order.length]);
  cards[winnerIndex] = winner;
  return { cards, winnerIndex };
}

/**
 * Tint of the tile a random card day wears on the board.
 *
 * A list reward, and a filter whose best rarity is an ordinary one, is drawn in the ink of the
 * text: the day does not promise anything better than a regular card. From the super rare up, the
 * tile takes the colour of that rarity, so the board says "there is a legendary behind this".
 *
 * @param {object|null} spec - Normalized spec.
 * @returns {'ink'|'super'|'legendary'|'mythic'} The tint.
 */
export function randomCardTint(spec) {
  if (!isRecord(spec) || spec.mode !== RANDOM_CARD_MODES.FILTER) return RANDOM_CARD_TINTS.INK;
  if (spec.maxRarity >= 5) return RANDOM_CARD_TINTS.MYTHIC;
  if (spec.maxRarity === 4) return RANDOM_CARD_TINTS.LEGENDARY;
  if (spec.maxRarity === 3) return RANDOM_CARD_TINTS.SUPER;
  return RANDOM_CARD_TINTS.INK;
}

/**
 * Draws the card of a random card reward, with its reel.
 *
 * @param {object} spec - Normalized spec.
 * @param {object} [options] - Draw options.
 * @param {() => number} [options.random=Math.random] - Random source.
 * @returns {Promise<{pool: object[], winner: object, cards: object[], winnerIndex: number}|null>}
 *   The draw, or null when no released card matches the reward.
 * @throws {Error} When a catalogue cannot be read.
 */
export async function resolveRandomCardReward(spec, { random = Math.random } = {}) {
  const pool = await resolveRandomCardPool(spec, { random });
  const winner = drawRandomCard(pool, random);
  if (!winner) return null;
  const reel = buildRandomCardReel(pool, winner, { random });
  return { pool, winner, cards: reel.cards, winnerIndex: reel.winnerIndex };
}

/**
 * Forgets the cached catalogue (imported save, reset).
 *
 * @returns {void}
 */
export function resetRandomCardCatalog() {
  catalogPromise = null;
}

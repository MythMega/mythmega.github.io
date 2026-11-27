/**
 * Trade list rules - what the card chooser of a trade may show, and in what order.
 *
 * A PROMO CARD IS NEVER TRADED, in any condition: it only enters a collection through a code or a
 * gift, so it can neither be offered nor received. The chooser must therefore not draw it at all
 * (a greyed tile would invite the player to try an offer the game always refuses), and this test
 * guards both doors:
 *   - `TradeManager.listTradableEntries`, the business list a request is built from;
 *   - `TradeView.listRefusedEntries`, the greyed block of the dialog.
 *
 * The second half of the file guards the ORDER of the chooser: the cards the rules or the balance
 * refuse are greyed UNDER their heading, at the bottom of the list, never between the tradable
 * ones. `TradeView.applyCardOrder` is the single place that decides it, so the test drives it with
 * fake tiles and a fake list: no DOM and no catalogue are needed.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

// `TradeView` imports the singletons of the page, and a few of them default to `document` at load
// time (the trade indicators). These rules never touch the DOM, so an empty one is enough to let
// the modules load: nothing here queries or paints anything.
globalThis.document ??= {
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  removeEventListener() {},
};

const { TradeView } = await import('../../js/UI/views/TradeView.js');
const { TradeManager } = await import('../../js/business/TradeManager.js');

/**
 * Builds one owned entry of a collection view, the way `CollectionManager` writes them.
 *
 * @param {object} [overrides] - Fields of the case (key, extension, rarity, copies, promo...).
 * @returns {object} The entry.
 */
function ownedEntry(overrides = {}) {
  return {
    key: 'A1-1',
    cardId: 'A1-1',
    set: 'A1',
    rarity: 3,
    quantity: 2,
    owned: true,
    promo: false,
    index: 1,
    card: { index: '1' },
    ...overrides,
  };
}

/**
 * Builds the `TradeView` half these tests use.
 *
 * No rules file (every extension is open), a balance and an Ender Eye stock the dialog never
 * refuses: a card is then greyed only for a reason of its own (a promo, a single copy).
 *
 * @returns {TradeView} A view without DOM.
 */
function buildView() {
  const view = Object.create(TradeView.prototype);
  view.tradeRules = null;
  view.partnerStars = 0;
  view.sparksBalance = Number.POSITIVE_INFINITY;
  view.hasEnoughEyes = () => true;
  return view;
}

/** A promo of the catalogue, flagged as such by the collection. */
const PROMO_FLAG = ownedEntry({ key: 'promo-flag', cardId: 'P1', promo: true });
/** A promo of a promo group (`A1-Promo`), recognised by its extension alone. */
const PROMO_SET = ownedEntry({ key: 'promo-set', cardId: 'P2', set: 'A1-Promo' });
/** The same promo group, on its last copy: refused for a copy reason as well. */
const PROMO_SET_SINGLE = ownedEntry({
  key: 'promo-set-single',
  cardId: 'P3',
  set: 'A1-Promo',
  quantity: 1,
});
/** A flagged promo on its last copy: refused for a promo reason as well. */
const PROMO_FLAG_SINGLE = ownedEntry({
  key: 'promo-flag-single',
  cardId: 'P4',
  promo: true,
  quantity: 1,
});
/** A regular duplicate: the only card of this set that may be offered. */
const DUPLICATE = ownedEntry({ key: 'duplicate', cardId: 'A1-3' });
/** A regular card on its last copy: untradable, but neither a promo nor hidden. */
const SINGLE_COPY = ownedEntry({ key: 'single', cardId: 'A1-2', quantity: 1 });

test('a promo card is never part of the cards a player may offer', () => {
  const offerable = TradeManager.listTradableEntries({
    entries: [PROMO_FLAG, PROMO_SET, PROMO_FLAG_SINGLE, PROMO_SET_SINGLE, SINGLE_COPY, DUPLICATE],
  });

  assert.deepEqual(
    offerable.map((entry) => entry.key),
    ['duplicate'],
    'the offerable list hands a promo to the trade dialog (or drops a regular card)'
  );
});

test('the greyed block of the chooser never lists a promo, however it is marked', () => {
  const view = buildView();
  const refused = view.listRefusedEntries({
    entries: [PROMO_FLAG, PROMO_SET, PROMO_FLAG_SINGLE, PROMO_SET_SINGLE, SINGLE_COPY, DUPLICATE],
  });

  assert.deepEqual(
    refused.map(({ entry }) => entry.key),
    ['single'],
    'the greyed block lists a promo, or forgets a card that is only untradable'
  );
  assert.equal(
    refused[0].reasonKey,
    'trade.cards.reason.single',
    'the regularly untradable card lost its reason'
  );
});

test('the greyed cards are the last block of the chooser, under their heading', () => {
  const view = buildView();
  view.cardSortMode = 'rarity';
  const tile = (name, entry) => ({ button: { name }, entry, haystack: name });
  view.cardGroups = {
    wished: [tile('wished', ownedEntry({ key: 'wished', rarity: 5 }))],
    blocked: [tile('blocked', null)],
    rest: [tile('rest', ownedEntry({ key: 'rest', rarity: 4 }))],
    untradable: [
      tile('untradable-low', ownedEntry({ key: 'untradable-low', rarity: 1, quantity: 1 })),
      tile('untradable-high', ownedEntry({ key: 'untradable-high', rarity: 6, quantity: 1 })),
    ],
  };
  view.cardHeading = { name: 'heading' };
  const appended = [];
  view.cardList = { appendChild: (node) => appended.push(node.name) };

  view.applyCardOrder();

  assert.deepEqual(
    appended,
    ['wished', 'blocked', 'rest', 'heading', 'untradable-high', 'untradable-low'],
    'the chooser no longer ends with the greyed cards under their heading'
  );
  const headingIndex = appended.indexOf('heading');
  assert.ok(
    appended.slice(headingIndex + 1).every((name) => name.startsWith('untradable')),
    'a tradable card is listed after the greyed block'
  );
  assert.ok(
    appended.slice(0, headingIndex).every((name) => !name.startsWith('untradable')),
    'a greyed card is listed before its heading'
  );
});

test('a chooser with nothing refused has no greyed block and no heading', () => {
  const view = buildView();
  view.cardSortMode = 'rarity';
  view.cardGroups = {
    wished: [],
    blocked: [],
    rest: [{ button: { name: 'rest' }, entry: ownedEntry({ key: 'rest' }), haystack: 'rest' }],
    untradable: [],
  };
  view.cardHeading = null;
  const appended = [];
  view.cardList = { appendChild: (node) => appended.push(node.name) };

  view.applyCardOrder();

  assert.deepEqual(appended, ['rest'], 'the chooser invented a heading or a greyed card');
});

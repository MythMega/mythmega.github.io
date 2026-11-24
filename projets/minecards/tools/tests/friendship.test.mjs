/**
 * Friendship tests - the XP, the stars, the seed of the past trades and the trade discount.
 *
 * The XP is local (`user_state["friendship"]`), so these tests exercise the rules themselves:
 *   - a completed trade pays `10 x rarity`, the flat rate when the rarity is unknown;
 *   - the worker history seeds a past trade once per trade id, the counters pay the leftovers;
 *   - a like pays once per direction, player and day;
 *   - the thresholds are read from `settings/global_trophy.json`;
 *   - each friendship star takes 10 % off the Sparks, down to zero.
 *
 * `fetch` is stubbed: only the configuration files are served, from disk.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { installFakeStorage, resetStorage, readState } from './helpers/fake_storage.mjs';
import { USER_STATE_KEYS } from '../../js/business/AccountManager.js';
import friendshipManager, {
  DEFAULT_FRIENDSHIP_TIERS,
  FRIENDSHIP_LIKE_XP,
  FRIENDSHIP_TRADE_XP,
  FRIENDSHIP_XP_PER_RARITY,
} from '../../js/business/FriendshipManager.js';
import { getTradeCost, parseTradePrices } from '../../js/business/TradeManager.js';

installFakeStorage();

const FRIEND = '211d06bb-6cb7-492a-9d55-10a3d58d2885';

/** Files of `settings/` the managers read (they are never counted as worker requests). */
const LOCAL_FILES = new Set(['settings/config.json', 'settings/global_trophy.json']);

/** Original `fetch`, restored when the suite ends. */
const realFetch = globalThis.fetch;

/** Replacement body of `settings/global_trophy.json`, when a test needs another table. */
let trophyOverride = null;

/**
 * Serves the shipped configuration files, with an optional replacement trophy table.
 *
 * @param {unknown} url - Requested URL.
 * @returns {Promise<object>} A minimal `Response`-like object.
 */
async function fetchStub(url) {
  const target = String(url);
  if (target === 'settings/global_trophy.json' && trophyOverride) {
    return { ok: true, status: 200, json: async () => trophyOverride };
  }
  if (LOCAL_FILES.has(target)) {
    const body = JSON.parse(readFileSync(new URL(`../../${target}`, import.meta.url), 'utf8'));
    return { ok: true, status: 200, json: async () => body };
  }
  throw new Error(`Unexpected request: ${target}`);
}

globalThis.fetch = fetchStub;

test.after(() => {
  globalThis.fetch = realFetch;
});

test('the thresholds are read from the global trophy file', async () => {
  // The expected ladder is the file itself: editing `settings/global_trophy.json` must move the
  // stars without ever touching this test.
  const config = JSON.parse(
    readFileSync(new URL('../../settings/global_trophy.json', import.meta.url), 'utf8')
  );
  const fromFile = Object.entries(config.bestfriend ?? {})
    .filter(([key]) => !key.startsWith('_'))
    .map(([rarity, target]) => [String(rarity).trim().toLowerCase(), Math.trunc(Number(target) || 0)])
    .filter(([, target]) => target > 0)
    .sort((left, right) => left[1] - right[1]);

  friendshipManager.reset();
  const tiers = await friendshipManager.getTiers();
  assert.deepEqual(tiers.map((tier) => [tier.rarity, tier.target]), fromFile);

  // The stars follow the file: editing it moves the levels without touching the code.
  trophyOverride = { bestfriend: { bronze: 10, silver: 20, gold: 30, diamond: 40, emerald: 50 } };
  friendshipManager.reset();
  try {
    const edited = await friendshipManager.getTiers();
    assert.deepEqual(
      edited.map((tier) => tier.target),
      [10, 20, 30, 40, 50]
    );
    assert.equal(friendshipManager.describeXp(20, edited).stars, 2);
  } finally {
    trophyOverride = null;
    friendshipManager.reset();
  }

  // A file without a usable entry falls back to the shipped table instead of hiding the levels.
  trophyOverride = { bestfriend: {} };
  friendshipManager.reset();
  try {
    assert.deepEqual(
      await friendshipManager.getTiers(),
      DEFAULT_FRIENDSHIP_TIERS.map((tier) => ({ ...tier }))
    );
  } finally {
    trophyOverride = null;
    friendshipManager.reset();
  }
});

test('a level is the number of reached thresholds, with the progress to the next one', () => {
  const tiers = DEFAULT_FRIENDSHIP_TIERS.map((tier) => ({ ...tier }));
  const half = friendshipManager.describeXp(30, tiers);
  assert.equal(half.stars, 1);
  // floor((30 - 25) / (100 - 25) * 100)
  assert.equal(half.percent, 6);
  assert.equal(half.nextTarget, 100);
  const maxed = friendshipManager.describeXp(5000, tiers);
  assert.deepEqual([maxed.stars, maxed.maxed, maxed.percent], [5, true, 100]);
});

test('a completed trade pays ten XP per rarity point, once per trade id', async () => {
  resetStorage();
  await friendshipManager.recordTrades([{ uuid: FRIEND, rarity: 3, tradeId: 't1' }]);
  const state = readState(USER_STATE_KEYS.FRIENDSHIP);
  assert.equal(state.xp[FRIEND], FRIENDSHIP_XP_PER_RARITY * 3);
  assert.equal(state.trades[FRIEND], 1);
  assert.deepEqual(state.tradeIds, ['t1']);

  // The same trade observed again pays nothing: its identifier is remembered.
  await friendshipManager.recordTrades([{ uuid: FRIEND, rarity: 3, tradeId: 't1' }]);
  assert.equal(readState(USER_STATE_KEYS.FRIENDSHIP).xp[FRIEND], 30);
});

test('a trade without a usable rarity falls back to the flat rate', async () => {
  resetStorage();
  await friendshipManager.recordTrades([{ uuid: FRIEND, rarity: 0 }]);
  assert.equal(readState(USER_STATE_KEYS.FRIENDSHIP).xp[FRIEND], FRIENDSHIP_TRADE_XP);
});

test('the worker history seeds past trades at ten XP per rarity, once per id', async () => {
  resetStorage();
  const history = [
    { id: 'h1', status: 'completed', rarity: 4, my_role: 'initiator', responder: { uuid: FRIEND } },
    { id: 'h2', status: 'completed', rarity: 2, my_role: 'responder', initiator: { uuid: FRIEND } },
    { id: 'h3', status: 'cancelled', rarity: 5, my_role: 'initiator', responder: { uuid: FRIEND } },
    { id: 'h4', status: 'completed', my_role: 'initiator', responder: { uuid: FRIEND } },
  ];
  await friendshipManager.syncTradeHistory({}, history);
  assert.equal(readState(USER_STATE_KEYS.FRIENDSHIP).xp[FRIEND], 40 + 20);

  // Reading the same history again adds nothing; the cancelled row and the row without a rarity
  // are left to the counters instead of paying a wrong amount.
  await friendshipManager.syncTradeHistory({}, history);
  const state = readState(USER_STATE_KEYS.FRIENDSHIP);
  assert.equal(state.xp[FRIEND], 60);
  assert.deepEqual(state.tradeIds, ['h1', 'h2']);
  assert.equal(state.trades[FRIEND], 2);
});

test('the per-partner counters pay what the history no longer holds', async () => {
  resetStorage();
  const history = [
    { id: 'h1', status: 'completed', rarity: 3, my_role: 'initiator', responder: { uuid: FRIEND } },
  ];
  await friendshipManager.syncTradeHistory({ [FRIEND]: 3 }, history);
  // 30 for the row the history knows, 25 for each of the two it does not.
  assert.equal(readState(USER_STATE_KEYS.FRIENDSHIP).xp[FRIEND], 30 + 2 * FRIENDSHIP_TRADE_XP);

  // Both seeds are idempotent.
  await friendshipManager.syncTradeHistory({ [FRIEND]: 3 }, history);
  await friendshipManager.syncTradeHistory({ [FRIEND]: 3 }, []);
  const state = readState(USER_STATE_KEYS.FRIENDSHIP);
  assert.equal(state.xp[FRIEND], 80);
  assert.equal(state.trades[FRIEND], 3);
});

test('a counter that already covers the history keeps the flat rate instead of paying twice', async () => {
  resetStorage();
  // An older save was seeded from the counters alone: those trades already paid.
  await friendshipManager.syncTradeHistory({ [FRIEND]: 2 }, []);
  assert.equal(readState(USER_STATE_KEYS.FRIENDSHIP).xp[FRIEND], 2 * FRIENDSHIP_TRADE_XP);

  await friendshipManager.syncTradeHistory(
    { [FRIEND]: 2 },
    [{ id: 'h1', status: 'completed', rarity: 4, my_role: 'initiator', responder: { uuid: FRIEND } }]
  );
  const state = readState(USER_STATE_KEYS.FRIENDSHIP);
  assert.equal(state.xp[FRIEND], 2 * FRIENDSHIP_TRADE_XP);
  assert.equal(state.trades[FRIEND], 2);
});

test('a like pays once per direction, player and day', async () => {
  resetStorage();
  const day = '2026-11-23';
  await friendshipManager.recordLikes([{ uuid: FRIEND, day }], 'sent');
  await friendshipManager.recordLikes([{ uuid: FRIEND, day }], 'sent');
  assert.equal(readState(USER_STATE_KEYS.FRIENDSHIP).xp[FRIEND], FRIENDSHIP_LIKE_XP);

  // The same like read back from the history (another payload shape) pays nothing.
  await friendshipManager.recordLikes([{ uuid: FRIEND, likedAt: `${day}T10:00:00Z` }], 'sent');
  assert.equal(readState(USER_STATE_KEYS.FRIENDSHIP).xp[FRIEND], FRIENDSHIP_LIKE_XP);

  // The like of the other side is another event, and so is the like of another day.
  await friendshipManager.recordLikes([{ uuid: FRIEND, day }], 'received');
  await friendshipManager.recordLikes([{ uuid: FRIEND, day: '2026-11-24' }], 'sent');
  assert.equal(readState(USER_STATE_KEYS.FRIENDSHIP).xp[FRIEND], 3 * FRIENDSHIP_LIKE_XP);

  // A row without a day cannot be de-duplicated: it is ignored rather than paid every read.
  await friendshipManager.recordLikes([{ uuid: FRIEND }], 'sent');
  assert.equal(readState(USER_STATE_KEYS.FRIENDSHIP).xp[FRIEND], 3 * FRIENDSHIP_LIKE_XP);
});

test('the configured friendship table discounts both the Sparks and the Ender Eyes', () => {
  const config = JSON.parse(
    readFileSync(new URL('../../settings/config.json', import.meta.url), 'utf8')
  );
  const prices = parseTradePrices(config.trades?.prices);

  // Both prices come from the file: the Ender Eyes from their table (stars then rarity), the Sparks
  // from rarity² minus the percentage of the same star level. Editing either table must move the
  // expected values without touching this test.
  const reduction = (stars) => {
    const raw = Number(config.trades?.prices?.Sparks?.[`friendshiplevel.${stars}`]);
    return Math.min(100, Math.max(0, Number.isFinite(raw) ? raw : 0));
  };
  const sparks = (rarity, stars) => Math.floor(rarity * rarity * (1 - reduction(stars) / 100));

  assert.deepEqual(getTradeCost(5, 1, prices), {
    sparks: sparks(5, 1),
    enderEyes: prices.eye[1][5],
    tradable: true,
  });
  assert.deepEqual(getTradeCost(5, 5, prices), {
    sparks: sparks(5, 5),
    enderEyes: prices.eye[5][5],
    tradable: true,
  });
  assert.deepEqual(getTradeCost(3, 3, prices), {
    sparks: sparks(3, 3),
    enderEyes: prices.eye[3][3],
    tradable: true,
  });

  // A cheap trade becomes free.
  assert.deepEqual(getTradeCost(1, 5, prices), {
    sparks: sparks(1, 5),
    enderEyes: prices.eye[5][1],
    tradable: true,
  });

  // Rarity 6 opens at four stars: null below, a price from four (the table is the source).
  assert.deepEqual(getTradeCost(6, 3, prices), {
    sparks: 0,
    enderEyes: 0,
    tradable: false,
  });
  assert.deepEqual(getTradeCost(6, 4, prices), {
    sparks: sparks(6, 4),
    enderEyes: prices.eye[4][6],
    tradable: true,
  });
  assert.equal(prices.eye[0][6], null);

  // More stars than the table allows are clamped to the last tier.
  assert.deepEqual(getTradeCost(5, 9, prices), getTradeCost(5, 5, prices));
});

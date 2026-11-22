/**
 * Trade tests - local escrow, refunds and received cards.
 *
 * The worker owns the trade status machine, the Ender Eyes stock and the 24 h deadline; these
 * tests therefore exercise the half that lives in the browser:
 *   - a sent trade removes exactly one copy and the Sparks, and stores an escrow;
 *   - a refused request leaves the collection and the balance untouched;
 *   - a closed trade gives the card and the Sparks back ONCE, even after a reload;
 *   - a claimed trade adds the received card ONCE;
 *   - a received card refused locally is closed for BOTH players, so the other one is refunded;
 *   - the first refresh announces a new incoming request, never the imported history.
 *
 * `fetch` is stubbed: the tests assert what the client does with a worker answer, not the worker
 * itself (which is covered by D1 and `src/tradeService.ts`).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  installFakeStorage,
  resetStorage,
  readCollection,
  readState,
  STORES,
} from './helpers/fake_storage.mjs';
import { USER_STATE_KEYS } from '../../js/business/AccountManager.js';
import { SocialError, SOCIAL_ERROR_CODES } from '../../js/business/SocialManager.js';
import { storageRepository } from '../../js/models/StorageRepository.js';
import tradeManager, {
  TradeError,
  TradeManager,
  buildDefaultTradeState,
  getTradeCost,
  getTradeErrorMessageKey,
  TRADE_ERROR_CODES,
  TRADE_MAX_ENDER_EYES,
  TRADE_STATUSES,
} from '../../js/business/TradeManager.js';

installFakeStorage();

const UUID = '38cc0f6a-a0e9-43d1-9c30-1c239d64af48';
const FRIEND = '211d06bb-6cb7-492a-9d55-10a3d58d2885';
const KEY = 'SERIE-A1 / W001_classic';
const RECEIVED_KEY = 'SERIE-A1 / W002_classic';

/** Requests the stub received, in order. */
let calls = [];

/** Responses waiting to be served by the stub, in order. */
let queue = [];

/** Original `fetch`, restored when the suite ends. */
const realFetch = globalThis.fetch;

/** Files of `settings/` the trade rules are read from (never counted as worker requests). */
const LOCAL_FILES = new Set(['settings/config.json', 'settings/cardsets.json']);

/**
 * Serves one canned response per call.
 *
 * @param {unknown} url - Requested URL.
 * @param {object} [options] - Fetch options.
 * @returns {Promise<object>} A minimal `Response`-like object.
 */
async function fetchStub(url, options = {}) {
  // The trade rules are read from the shipped configuration: answer those two files from disk and
  // keep them out of `calls`, which only counts the requests sent to the worker.
  const target = String(url);
  if (LOCAL_FILES.has(target)) {
    const body = JSON.parse(readFileSync(new URL(`../../${target}`, import.meta.url), 'utf8'));
    return { ok: true, status: 200, json: async () => body };
  }
  calls.push({ url: target, method: options.method ?? 'GET', body: options.body ?? null });
  const next = queue.shift();
  if (!next) throw new Error(`Unexpected request: ${options.method ?? 'GET'} ${url}`);
  const status = next.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => next.body,
  };
}

globalThis.fetch = fetchStub;

test.after(() => {
  globalThis.fetch = realFetch;
});

/**
 * Seeds one account with a duplicate and a Sparks balance.
 *
 * @param {object} [options] - Seed options.
 * @returns {void}
 */
function seed({
  quantity = 2,
  sparks = 50,
  escrows = {},
  claimed = {},
  refused = {},
  seen = {},
  lastRefreshAt = 0,
  enderEyes = 5,
} = {}) {
  calls = [];
  queue = [];
  resetStorage({
    [STORES.USER_STATE]: {
      account: { uuid: UUID, createdAt: '2026-01-01T00:00:00.000Z' },
      social: {
        authCode: 'ABCDEFGHIJKLMNOP',
        following: [FRIEND],
        cardFetchedAt: {},
        cardCache: {},
      },
      sparks,
      [USER_STATE_KEYS.TRADES]: {
        ...buildDefaultTradeState(),
        escrows,
        claimed,
        refused,
        seen,
        lastRefreshAt,
        enderEyes,
      },
      stats: {
        sparksEarned: 0,
        sparksSpent: 0,
        sparksEarnedBySource: {},
        sparksSpentBySource: {},
      },
    },
    [STORES.COLLECTION]: {
      [KEY]: {
        key: KEY,
        cardId: 'SERIE-A1 / W001',
        style: 'classic',
        set: 'A1',
        quantity,
        firstObtainedAt: '2026-01-01T00:00:00.000Z',
        lastObtainedAt: '2026-01-01T00:00:00.000Z',
      },
    },
  });
}

/**
 * Builds the collection entry the trade flow receives.
 *
 * @param {number} [rarity=3] - Card rarity.
 * @returns {object} The entry.
 */
function buildEntry(rarity = 3) {
  return {
    key: KEY,
    cardId: 'SERIE-A1 / W001',
    style: 'classic',
    set: 'A1',
    rarity,
    quantity: 2,
    card: { getName: () => 'Creeper' },
  };
}

test('a trade costs one Ender Eye per rarity and rarity squared Sparks', () => {
  assert.deepEqual(getTradeCost(1), { sparks: 1, enderEyes: 1 });
  assert.deepEqual(getTradeCost(4), { sparks: 16, enderEyes: 4 });
  assert.deepEqual(getTradeCost(5), { sparks: 25, enderEyes: 5 });
});

test('a missing Ender Eyes balance starts at the full stock of 5', async () => {
  resetStorage();
  // A player who discovers the feature has no `user_state["trades"]` yet: the worker opens the
  // account with 5 Eyes, so the client shows that initial stock instead of 0 or a dash.
  assert.equal((await tradeManager.getState()).enderEyes, TRADE_MAX_ENDER_EYES);
  // The same goes for a state that was stored with a null balance.
  await storageRepository.setUserState(USER_STATE_KEYS.TRADES, { enderEyes: null });
  assert.equal((await tradeManager.getState()).enderEyes, TRADE_MAX_ENDER_EYES);
  // A real balance is kept as is, clamped to the maximum.
  await storageRepository.setUserState(USER_STATE_KEYS.TRADES, { enderEyes: 2 });
  assert.equal((await tradeManager.getState()).enderEyes, 2);
});

test('the local Ender Eyes stock refills by one per UTC day, capped at 5', async () => {
  seed({ enderEyes: 2 });
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  await storageRepository.setUserState(USER_STATE_KEYS.TRADES, {
    ...buildDefaultTradeState(),
    enderEyes: 2,
    enderEyesDay: yesterday,
  });
  assert.equal((await tradeManager.getState()).enderEyes, 3);

  // Several days at once never exceed the cap.
  await storageRepository.setUserState(USER_STATE_KEYS.TRADES, {
    ...buildDefaultTradeState(),
    enderEyes: 4,
    enderEyesDay: '2026-01-01',
  });
  assert.equal((await tradeManager.getState()).enderEyes, 5);

  // A second read on the same day does not grant anything more.
  await storageRepository.setUserState(USER_STATE_KEYS.TRADES, {
    ...buildDefaultTradeState(),
    enderEyes: 1,
    enderEyesDay: today,
  });
  assert.equal((await tradeManager.getState()).enderEyes, 1);
});

test('only duplicates of rarity 1 to 5 are tradable, promos excluded', () => {
  const entries = TradeManager.listTradableEntries({
    entries: [
      { key: 'dup3', cardId: 'A', rarity: 3, quantity: 2, owned: true },
      { key: 'single', cardId: 'B', rarity: 3, quantity: 1, owned: true },
      { key: 'unique', cardId: 'C', rarity: 6, quantity: 4, owned: true },
      { key: 'promo', cardId: 'D', rarity: 2, quantity: 2, owned: true, promo: true },
      { key: 'dup1', cardId: 'E', rarity: 1, quantity: 3, owned: true },
      { key: 'missing', cardId: 'F', rarity: 2, quantity: 0, owned: false },
    ],
  });
  assert.deepEqual(
    entries.map((entry) => entry.key),
    ['dup3', 'dup1']
  );
});

test('a promo card and a closed extension are never offered', async () => {
  // The configuration closes A2 here: its cards must leave the list, exactly like the promos.
  tradeManager.rules = { sameExtension: false, tradableSets: new Set(['A1']) };
  try {
    const entries = await tradeManager.getTradableEntries({
      entries: [
        { key: 'a2', cardId: 'A2 / X', rarity: 3, quantity: 2, owned: true, set: 'A2' },
        { key: 'a1', cardId: 'A1 / Y', rarity: 3, quantity: 2, owned: true, set: 'A1' },
        {
          key: 'promo',
          cardId: 'PROMO-A1 / B01',
          rarity: 3,
          quantity: 2,
          owned: true,
          set: 'A1-Promo',
          promo: true,
        },
      ],
    });
    assert.deepEqual(
      entries.map((entry) => entry.key),
      ['a1']
    );
  } finally {
    tradeManager.rules = null;
  }
});

test('a promo card is refused before anything leaves the save', async () => {
  seed();
  await assert.rejects(
    () => tradeManager.createTrade({ responderUuid: FRIEND, entry: { ...buildEntry(3), promo: true } }),
    (error) => error instanceof TradeError && error.code === TRADE_ERROR_CODES.PROMO_NOT_TRADABLE
  );
  assert.equal(calls.length, 0, 'the refusal must not reach the worker');
  assert.equal(readCollection(KEY).quantity, 2, 'the card must stay in the collection');
});

test('the same-extension rule refuses a proposal from another extension', async () => {
  seed();
  tradeManager.rules = { sameExtension: true, tradableSets: null };
  try {
    await assert.rejects(
      () =>
        tradeManager.proposeTrade({
          tradeId: 't1',
          entry: { ...buildEntry(3), set: 'A2' },
          otherSet: 'A1',
        }),
      (error) => error instanceof TradeError && error.code === TRADE_ERROR_CODES.SAME_EXTENSION
    );
    assert.equal(calls.length, 0, 'the refusal must not reach the worker');
    assert.equal(readCollection(KEY).quantity, 2);
  } finally {
    tradeManager.rules = null;
  }
});

test('sending a trade consumes one copy, the Sparks and stores the escrow', async () => {
  seed();
  queue.push({ status: 201, body: { trade: { id: 't1' }, ender_eyes: 2 } });

  await tradeManager.createTrade({ responderUuid: FRIEND, entry: buildEntry(3) });

  const row = readCollection(KEY);
  assert.equal(row.quantity, 1);
  assert.equal(readState(USER_STATE_KEYS.SPARKS), 41);
  const state = readState(USER_STATE_KEYS.TRADES);
  assert.equal(state.enderEyes, 2);
  assert.equal(state.escrows.t1.sparks, 9);
  assert.equal(state.escrows.t1.card.key, KEY);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.match(calls[0].url, /\/trades$/);
  // Every worker request carries the pair, even though the trade itself is public data.
  const sent = JSON.parse(calls[0].body);
  assert.equal(sent.uuid, UUID);
  assert.equal(sent.auth_code, 'ABCDEFGHIJKLMNOP');
  assert.equal(sent.ender_eyes, undefined);
});

test('a trade that moved on the other side maps to a conflict message', () => {
  // The worker answers 409 when the trade moved (denied, withdrawn, expired, accepted meanwhile)
  // and 404 when it is gone: both must read as a stale trade, not as a generic HTTP failure.
  const refusedWith = (status) =>
    new SocialError(SOCIAL_ERROR_CODES.HTTP, 'refused', { status });
  assert.equal(getTradeErrorMessageKey(refusedWith(409)), 'trade.error.conflict');
  assert.equal(getTradeErrorMessageKey(refusedWith(404)), 'trade.error.notFound');
  assert.equal(getTradeErrorMessageKey(refusedWith(403)), 'trade.error.auth');
  assert.equal(getTradeErrorMessageKey(refusedWith(500)), 'trade.error.http');
});

test('a trade is refused locally when there are not enough Ender Eyes', async () => {
  seed({ enderEyes: 2 });
  // No response is queued: any call to the worker would throw instead of being answered.
  await assert.rejects(
    () => tradeManager.createTrade({ responderUuid: FRIEND, entry: buildEntry(3) }),
    (error) =>
      error instanceof TradeError && error.code === TRADE_ERROR_CODES.NOT_ENOUGH_ENDER_EYES
  );

  assert.equal(calls.length, 0, 'the refusal must not reach the worker');
  assert.equal(readCollection(KEY).quantity, 2, 'the card must stay in the collection');
  assert.equal(readState(USER_STATE_KEYS.SPARKS), 50, 'no Sparks may be spent');
  assert.equal(readState(USER_STATE_KEYS.TRADES).enderEyes, 2, 'the stock is unchanged');
  assert.deepEqual(readState(USER_STATE_KEYS.TRADES).escrows, {}, 'no escrow is recorded');
});

test('a trade is refused locally when there are not enough Sparks', async () => {
  seed({ sparks: 5 });
  await assert.rejects(
    () => tradeManager.createTrade({ responderUuid: FRIEND, entry: buildEntry(3) }),
    (error) => error instanceof TradeError && error.code === TRADE_ERROR_CODES.NOT_ENOUGH_SPARKS
  );
  assert.equal(calls.length, 0, 'the refusal must not reach the worker');
  assert.equal(readCollection(KEY).quantity, 2);
  assert.equal(readState(USER_STATE_KEYS.SPARKS), 5);
  assert.equal(readState(USER_STATE_KEYS.TRADES).enderEyes, 5);
});

test('a counter-proposal is refused locally when the stock cannot pay it', async () => {
  seed({ enderEyes: 1, quantity: 1 });
  await assert.rejects(
    () => tradeManager.proposeTrade({ tradeId: 't1', entry: buildEntry(3) }),
    (error) =>
      error instanceof TradeError && error.code === TRADE_ERROR_CODES.NOT_ENOUGH_ENDER_EYES
  );
  assert.equal(calls.length, 0, 'the refusal must not reach the worker');
  assert.equal(readState(USER_STATE_KEYS.TRADES).enderEyes, 1);
});

test('a refused request leaves the collection and the balance untouched', async () => {
  seed();
  queue.push({ status: 403, body: { error: 'Authentification invalide pour cet UUID.' } });

  await assert.rejects(
    () => tradeManager.createTrade({ responderUuid: FRIEND, entry: buildEntry(3) }),
    (error) => error.status === 403
  );

  assert.equal(readCollection(KEY).quantity, 2);
  assert.equal(readState(USER_STATE_KEYS.SPARKS), 50);
  assert.deepEqual(readState(USER_STATE_KEYS.TRADES).escrows, {});
});

test('a declined trade gives the card and the Sparks back exactly once', async () => {
  seed({
    quantity: 1,
    sparks: 41,
    lastRefreshAt: Date.now(),
    enderEyes: 2,
    escrows: {
      t1: {
        role: 'initiator',
        card: { key: KEY, card_id: 'SERIE-A1 / W001', style: 'classic', set: 'A1', rarity: 3 },
        sparks: 9,
        enderEyes: 3,
        createdAt: Date.now(),
      },
    },
  });

  const declined = {
    id: 't1',
    status: TRADE_STATUSES.DECLINED,
    rarity: 3,
    sparks_cost: 9,
    ender_eyes_cost: 3,
    my_role: 'initiator',
    initiator: { uuid: UUID, username: 'Myth', card: null, claimed: false },
    responder: { uuid: FRIEND, username: 'Bonhomme', card: null, claimed: false },
    created_at: '2026-11-20 10:00:00',
  };
  queue.push({ body: { ender_eyes: 5, incoming: [], outgoing: [], history: [declined], stats: null } });
  const first = await tradeManager.refresh();
  assert.equal(first.ready, true);
  assert.equal(readCollection(KEY).quantity, 2);
  assert.equal(readState(USER_STATE_KEYS.SPARKS), 50);
  // The Ender Eyes are local too: the escrow holds them and the refund gives them back, capped.
  assert.equal(readState(USER_STATE_KEYS.TRADES).enderEyes, 5);
  assert.deepEqual(readState(USER_STATE_KEYS.TRADES).escrows, {});

  // A second refresh must not refund again: the escrow entry is gone.
  queue.push({ body: { ender_eyes: 5, incoming: [], outgoing: [], history: [declined], stats: null } });
  await tradeManager.refresh();
  assert.equal(readCollection(KEY).quantity, 2);
  assert.equal(readState(USER_STATE_KEYS.SPARKS), 50);
});

test('the first refresh announces a new incoming request but not imported history', async () => {
  seed();
  const incoming = {
    id: 't2',
    status: TRADE_STATUSES.PENDING,
    rarity: 2,
    sparks_cost: 4,
    ender_eyes_cost: 2,
    my_role: 'responder',
    initiator: {
      uuid: FRIEND,
      username: 'Bonhomme',
      card: { key: RECEIVED_KEY, name: 'Zombie', rarity: 2 },
      claimed: false,
    },
    responder: { uuid: UUID, username: 'Myth', card: null, claimed: false },
    created_at: '2026-11-20 10:00:00',
  };
  const oldTrade = { ...incoming, id: 't3', status: TRADE_STATUSES.COMPLETED };
  queue.push({
    body: { ender_eyes: 5, incoming: [incoming], outgoing: [], history: [oldTrade], stats: null },
  });

  const view = await tradeManager.refresh();
  assert.equal(view.notifications.length, 1);
  assert.equal(view.notifications[0].type, 'trade');
  assert.match(view.notifications[0].title, /./);
  const state = readState(USER_STATE_KEYS.TRADES);
  assert.equal(state.seen.t2, TRADE_STATUSES.PENDING);
  assert.equal(state.seen.t3, TRADE_STATUSES.COMPLETED);
});

test('claiming adds the received card once and clears the escrow', async () => {
  seed({
    quantity: 1,
    sparks: 41,
    lastRefreshAt: Date.now(),
    escrows: {
      t4: {
        role: 'initiator',
        card: { key: KEY, card_id: 'SERIE-A1 / W001', style: 'classic', set: 'A1', rarity: 3 },
        sparks: 9,
        createdAt: Date.now(),
      },
    },
  });

  const trade = {
    id: 't4',
    status: TRADE_STATUSES.ACCEPTED,
    rarity: 3,
    sparks_cost: 9,
    ender_eyes_cost: 3,
    my_role: 'initiator',
    initiator: {
      uuid: UUID,
      username: 'Myth',
      card: { key: KEY, name: 'Creeper', rarity: 3 },
      claimed: false,
    },
    responder: {
      uuid: FRIEND,
      username: 'Bonhomme',
      card: { key: RECEIVED_KEY, card_id: 'SERIE-A1 / W002', style: 'classic', set: 'A1', rarity: 3, name: 'Zombie' },
      claimed: false,
    },
    created_at: '2026-11-20 10:00:00',
  };

  queue.push({ body: { trade_id: 't4', status: 'accepted', claimed: true } });
  queue.push({
    body: { ender_eyes: 2, incoming: [], outgoing: [trade], history: [], stats: null },
  });

  const received = await tradeManager.claimTrade(trade);
  assert.equal(received.key, RECEIVED_KEY);
  assert.equal(readCollection(RECEIVED_KEY).quantity, 1);
  assert.equal(readCollection(KEY).quantity, 1);
  const state = readState(USER_STATE_KEYS.TRADES);
  assert.equal(state.claimed.t4, true);
  assert.equal(state.escrows.t4, undefined);

  // Claiming twice is a no-op: the card is not added again.
  assert.equal(await tradeManager.claimTrade(trade), null);
  assert.equal(readCollection(RECEIVED_KEY).quantity, 1);
});

test('a refused received card cancels the trade and refunds the escrow', async () => {
  seed({
    quantity: 1,
    sparks: 41,
    enderEyes: 2,
    lastRefreshAt: Date.now(),
    escrows: {
      t7: {
        role: 'initiator',
        card: { key: KEY, card_id: 'SERIE-A1 / W001', style: 'classic', set: 'A1', rarity: 3 },
        sparks: 9,
        enderEyes: 3,
        createdAt: Date.now(),
      },
    },
  });

  const trade = {
    id: 't7',
    status: TRADE_STATUSES.ACCEPTED,
    rarity: 3,
    sparks_cost: 9,
    ender_eyes_cost: 3,
    my_role: 'initiator',
    initiator: {
      uuid: UUID,
      username: 'Myth',
      card: { key: KEY, name: 'Creeper', rarity: 3 },
      claimed: false,
    },
    responder: {
      uuid: FRIEND,
      username: 'Bonhomme',
      card: {
        key: 'PROMO-A1 / B01_classic',
        card_id: 'PROMO-A1 / B01',
        style: 'classic',
        set: 'A1-Promo',
        rarity: 3,
        name: 'Promo',
      },
      claimed: false,
    },
    created_at: '2026-11-20 10:00:00',
  };

  // An accepted trade cannot be cancelled anymore: the refusal is shared with the worker, which
  // closes it for BOTH players. Then the refresh that follows the refusal.
  queue.push({ body: { trade_id: 't7', status: TRADE_STATUSES.CANCELLED } });
  queue.push({
    body: {
      ender_eyes: 5,
      incoming: [],
      outgoing: [],
      history: [{ ...trade, status: TRADE_STATUSES.CANCELLED }],
    },
  });

  // A refused trade must never notify: every notification built is recorded.
  const notified = [];
  const buildNotification = tradeManager.buildNotification.bind(tradeManager);
  tradeManager.buildNotification = (candidate, previous, known) => {
    const notification = buildNotification(candidate, previous, known);
    if (notification) notified.push(candidate.id);
    return notification;
  };

  await assert.rejects(
    () => tradeManager.claimTrade(trade),
    (error) => error instanceof TradeError && error.code === TRADE_ERROR_CODES.PROMO_NOT_TRADABLE
  );

  // Nothing was claimed, and the trade was closed for both players on the worker: this is what
  // refunds the other player's escrow at its next refresh.
  assert.equal(calls.filter((call) => call.url.endsWith('/trades/claim')).length, 0);
  assert.equal(calls.filter((call) => call.url.endsWith('/trades/refuse')).length, 1);
  assert.equal(calls.filter((call) => call.url.endsWith('/trades/cancel')).length, 0);
  assert.equal(JSON.parse(calls.find((call) => call.url.endsWith('/trades/refuse')).body).trade_id, 't7');
  assert.equal(readCollection('PROMO-A1 / B01_classic'), undefined);

  // The escrow came back whole: the card, the Sparks and the Ender Eyes.
  assert.equal(readCollection(KEY).quantity, 2);
  assert.equal(readState(USER_STATE_KEYS.SPARKS), 50);
  const state = readState(USER_STATE_KEYS.TRADES);
  assert.equal(state.enderEyes, 5);
  assert.deepEqual(state.escrows, {});
  assert.equal(state.refused.t7, TRADE_ERROR_CODES.PROMO_NOT_TRADABLE);

  // The worker keeps announcing the trade, and even turns it into `completed` afterwards: a refused
  // trade must not be listed, must not notify, and must not be counted.
  queue.push({
    body: {
      ender_eyes: 5,
      incoming: [],
      outgoing: [{ ...trade, status: TRADE_STATUSES.COMPLETED }],
      history: [],
    },
  });
  const view = await tradeManager.refresh();
  assert.equal(view.outgoing.length, 0, 'a refused trade is no longer listed');
  assert.deepEqual(view.notifications, []);
  assert.deepEqual(notified, [], 'a refused trade never raises a notification');
  assert.equal(view.stats.totals.completed, 0);
  assert.equal(view.stats.totals.cards_given, 0);
  assert.equal(readState(USER_STATE_KEYS.TRADES).stats.completed, 0);
});

test("a refusal shared by the worker refunds the other player's escrow", async () => {
  seed({
    quantity: 1,
    sparks: 41,
    enderEyes: 2,
    lastRefreshAt: Date.now(),
    seen: { t8: TRADE_STATUSES.ACCEPTED },
    escrows: {
      t8: {
        role: 'responder',
        card: { key: KEY, card_id: 'SERIE-A1 / W001', style: 'classic', set: 'A1', rarity: 3 },
        sparks: 9,
        enderEyes: 3,
        createdAt: Date.now(),
      },
    },
  });

  // The refuser closed the trade on the worker (`/trades/refuse` -> `cancelled`): the other
  // player's next refresh must give back its card, its Sparks and its Ender Eyes.
  queue.push({
    body: {
      ender_eyes: 2,
      incoming: [],
      outgoing: [],
      history: [
        {
          id: 't8',
          status: TRADE_STATUSES.CANCELLED,
          rarity: 3,
          sparks_cost: 9,
          ender_eyes_cost: 3,
          my_role: 'responder',
          initiator: { uuid: FRIEND, username: 'Bonhomme', card: null, claimed: false },
          responder: { uuid: UUID, username: 'Myth', card: null, claimed: false },
          created_at: '2026-11-20 10:00:00',
        },
      ],
    },
  });

  const view = await tradeManager.refresh();
  assert.equal(readCollection(KEY).quantity, 2);
  assert.equal(readState(USER_STATE_KEYS.SPARKS), 50);
  assert.equal(readState(USER_STATE_KEYS.TRADES).enderEyes, 5);
  assert.deepEqual(readState(USER_STATE_KEYS.TRADES).escrows, {});
  assert.equal(view.stats.totals.cancelled, 1);
});

test('trade statistics live locally and count each transition once', async () => {
  seed({ lastRefreshAt: Date.now(), seen: { t5: 'accepted', t6: 'pending' } });

  const completed = {
    id: 't5',
    status: TRADE_STATUSES.COMPLETED,
    rarity: 3,
    sparks_cost: 9,
    ender_eyes_cost: 3,
    my_role: 'initiator',
    initiator: { uuid: UUID, username: 'Myth', card: { key: KEY, name: 'Creeper' }, claimed: true },
    responder: { uuid: FRIEND, username: 'Bonhomme', card: { key: RECEIVED_KEY, name: 'Zombie' }, claimed: true },
    created_at: '2026-11-20 10:00:00',
  };
  const cancelled = {
    ...completed,
    id: 't6',
    status: TRADE_STATUSES.CANCELLED,
    rarity: 2,
    sparks_cost: 4,
    ender_eyes_cost: 2,
  };

  queue.push({
    body: { ender_eyes: 5, incoming: [], outgoing: [], history: [completed, cancelled] },
  });
  const view = await tradeManager.refresh();
  assert.equal(view.stats.totals.completed, 1);
  assert.equal(view.stats.totals.cancelled, 1);
  assert.equal(view.stats.totals.sparks_spent, 9);
  assert.equal(view.stats.totals.ender_eyes_spent, 3);
  assert.equal(view.stats.totals.cards_given, 1);
  assert.equal(view.stats.totals.cards_received, 1);
  assert.equal(view.stats.by_rarity['3'].completed, 1);
  assert.equal(view.stats.by_rarity['2'].cancelled, 1);
  assert.equal(readState(USER_STATE_KEYS.TRADES).stats.completed, 1);

  // The same statuses observed again must not increment anything.
  queue.push({
    body: { ender_eyes: 5, incoming: [], outgoing: [], history: [completed, cancelled] },
  });
  const again = await tradeManager.refresh();
  assert.equal(again.stats.totals.completed, 1);
  assert.equal(again.stats.totals.cancelled, 1);
  assert.equal(again.stats.totals.sparks_spent, 9);
});

/**
 * Builds one accepted trade where the received card is already in my hands.
 *
 * @param {string} id - Trade id.
 * @param {boolean} claimedByMe - True when this side already claimed its card.
 * @returns {object} The trade payload.
 */
function acceptedTrade(id, claimedByMe) {
  return {
    id,
    status: TRADE_STATUSES.ACCEPTED,
    rarity: 1,
    sparks_cost: 1,
    ender_eyes_cost: 1,
    my_role: 'responder',
    initiator: {
      uuid: FRIEND,
      username: 'Bonhomme',
      card: { key: RECEIVED_KEY, name: 'Zombie', rarity: 1, set: 'A1', style: 'classic' },
      claimed: false,
    },
    responder: {
      uuid: UUID,
      username: 'Myth',
      card: { key: KEY, name: 'Creeper', rarity: 1, set: 'A1', style: 'classic' },
      claimed: claimedByMe,
    },
    created_at: '2026-11-22 10:00:00',
  };
}

test('a trade this side already claimed leaves the active lists for the history', async () => {
  seed({ lastRefreshAt: Date.now() });
  queue.push({
    body: {
      ender_eyes: 5,
      incoming: [acceptedTrade('t7', true), acceptedTrade('t8', false)],
      outgoing: [],
      history: [],
    },
  });

  const view = await tradeManager.refresh();

  // t7 is over for this player: the worker only waits for the OTHER side. t8 still waits for me.
  assert.deepEqual(view.incoming.map((trade) => trade.id), ['t8']);
  assert.equal(view.history.length, 1);
  assert.equal(view.history[0].id, 't7');
  assert.equal(view.history[0].status, TRADE_STATUSES.COMPLETED);
  assert.equal(view.history[0].settled_locally, true);
  // The statistics must NOT count it yet: the worker has not completed it.
  assert.equal(view.stats.totals.completed, 0);
});

test('the claim recorded locally settles a trade the worker still lists as accepted', async () => {
  // A save restored from another device has no payload flag to trust, but the claim was recorded.
  seed({ lastRefreshAt: Date.now(), claimed: { t9: true } });
  queue.push({
    body: { ender_eyes: 5, incoming: [acceptedTrade('t9', false)], outgoing: [], history: [] },
  });

  const view = await tradeManager.refresh();

  assert.deepEqual(view.incoming, []);
  assert.equal(view.history[0].id, 't9');
  assert.equal(view.history[0].status, TRADE_STATUSES.COMPLETED);
});

test('a refused request still open on the worker is closed once', async () => {
  seed({ refused: { t5: 'promo' } });
  // The request this player sent, and gave up on locally: the worker still counts it as open.
  const stale = {
    ...acceptedTrade('t5', false),
    status: TRADE_STATUSES.PENDING,
    my_role: 'initiator',
    initiator: { uuid: UUID, username: 'Myth', card: { key: KEY, name: 'Creeper', rarity: 1 }, claimed: false },
    responder: { uuid: FRIEND, username: 'Bonhomme', card: null, claimed: false },
  };
  queue.push({ body: { ender_eyes: 5, incoming: [], outgoing: [stale], history: [] } });
  queue.push({ body: { trade_id: 't5', status: 'cancelled' } });

  const view = await tradeManager.refresh();

  assert.deepEqual(view.outgoing, []);
  assert.deepEqual(calls.map((call) => call.method), ['GET', 'POST']);
  assert.match(calls[1].url, /\/trades\/cancel$/);
  assert.equal(JSON.parse(calls[1].body).trade_id, 't5');
});

test('a creation answered 409 is retried once after a refresh', async () => {
  seed();
  // The worker refuses because it still holds an open request; the refresh finds nothing to close,
  // and the retry is the one that creates the trade.
  queue.push({ status: 409, body: { error: "Vous avez déjà une demande d'échange en cours." } });
  queue.push({ body: { ender_eyes: 5, incoming: [], outgoing: [], history: [] } });
  queue.push({ status: 201, body: { trade: { id: 't-retry' } } });

  const response = await tradeManager.createTrade({ responderUuid: FRIEND, entry: buildEntry(3) });

  assert.equal(response.trade.id, 't-retry');
  assert.deepEqual(calls.map((call) => call.method), ['POST', 'GET', 'POST']);
  // The card and the cost are locked ONCE, after the successful request.
  assert.equal(readCollection(KEY).quantity, 1);
  assert.equal(readState(USER_STATE_KEYS.SPARKS), 41);
  assert.equal(readState(USER_STATE_KEYS.TRADES).escrows['t-retry'].sparks, 9);
});

test('a 409 that survives the retry is still reported as a conflict', async () => {
  seed();
  queue.push({ status: 409, body: {} });
  queue.push({ body: { ender_eyes: 5, incoming: [], outgoing: [], history: [] } });
  queue.push({ status: 409, body: {} });

  await assert.rejects(
    () => tradeManager.createTrade({ responderUuid: FRIEND, entry: buildEntry(3) }),
    (error) => error.status === 409
  );

  assert.deepEqual(calls.map((call) => call.method), ['POST', 'GET', 'POST']);
  assert.equal(readCollection(KEY).quantity, 2, 'nothing was sent');
  assert.equal(readState(USER_STATE_KEYS.SPARKS), 50);
  assert.deepEqual(readState(USER_STATE_KEYS.TRADES).escrows, {});
});

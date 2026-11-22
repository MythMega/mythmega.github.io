/**
 * Sparks publication tests - the balance must reach the header and the inventory.
 *
 * Three flows credit or debit Sparks INSIDE a storage transaction, where `addSparks` and
 * `applyDelta` cannot publish (the caller owns the commit). Each one therefore has to emit
 * `SPARKS_UPDATED` itself once the transaction committed, or the top bar and the inventory keep
 * the wallet of the previous render:
 *   - an Illager Shop offer whose rewards include Sparks;
 *   - the escrow of a trade (the Sparks of the proposal are charged);
 *   - the refund of an escrow (they come back when the trade is dropped).
 *
 * These tests are regressions: before the fix all three wrote the balance silently.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  installFakeStorage,
  readState,
  resetStorage,
  STORES,
} from './helpers/fake_storage.mjs';
import { USER_STATE_KEYS } from '../../js/business/AccountManager.js';
import dateSyncManager from '../../js/business/DateSyncManager.js';
import { ILLAGER_STATE_KEY, IllagerShopManager } from '../../js/business/IllagerShopManager.js';
import tradeManager, { buildDefaultTradeState } from '../../js/business/TradeManager.js';
import eventBus, { EVENTS } from '../../js/utils/EventBus.js';

installFakeStorage();

const DAY = '2026-11-13';
const CURRENCY = 'TestCurrency';
const SET_ID = 7;
const OFFER_KEY = '7-1';
const TRADE_KEY = 'SERIE-A1 / W001_classic';

/** Original UTC-day lookup, restored after each test. */
const originalGetCurrentUtcDay = dateSyncManager.getCurrentUtcDay;

test.afterEach(() => {
  dateSyncManager.getCurrentUtcDay = originalGetCurrentUtcDay;
});

/**
 * Records every balance published on `SPARKS_UPDATED` while a flow runs.
 *
 * @param {Function} work - Async callback under test.
 * @returns {Promise<number[]>} The published balances, in order.
 */
async function publishedDuring(work) {
  const balances = [];
  const unsubscribe = eventBus.on(EVENTS.SPARKS_UPDATED, (payload) => {
    balances.push(payload?.balance);
  });
  try {
    await work();
  } finally {
    unsubscribe();
  }
  return balances;
}

/**
 * Builds a shop with one deterministic offer.
 *
 * @param {Array<object>} rewards - Rewards of the offer.
 * @returns {IllagerShopManager} The shop.
 */
function buildShop(rewards) {
  const shop = new IllagerShopManager();
  shop.currencies = [
    {
      id: CURRENCY,
      name: 'Test currency',
      texture: '',
      expiration: null,
      conversionRate: 0,
      quests: [],
    },
  ];
  shop.sets = [
    {
      id: SET_ID,
      name: 'Test set',
      start: '2026-01-01',
      end: '2026-12-31',
      currencyId: CURRENCY,
      trades: [{ Price: 3, Rewards: [], Repeatable: true }],
    },
  ];
  shop.resolveRewards = async () => rewards;
  shop.log = () => {};
  return shop;
}

/**
 * Seeds the shop state and its currency balance.
 *
 * @param {object} [options] - Seeding options.
 * @param {number} [options.balance=5] - Balance of the shop currency.
 * @returns {void}
 */
function seedShop({ balance = 5 } = {}) {
  resetStorage({
    user_state: {
      [USER_STATE_KEYS.SPARKS]: 0,
      [USER_STATE_KEYS.STATS]: {},
      [ILLAGER_STATE_KEY]: { balances: { [CURRENCY]: balance }, purchases: {} },
    },
  });
}

test('an Illager Shop purchase that grants Sparks publishes the new balance', async () => {
  dateSyncManager.getCurrentUtcDay = () => DAY;
  seedShop();

  const balances = await publishedDuring(() =>
    buildShop([{ type: 'Sparks', quantity: 25 }]).buy(OFFER_KEY)
  );

  // Exactly once, with the committed balance: the header and the inventory listen to this event.
  assert.deepEqual(balances, [25]);
  assert.equal(readState(USER_STATE_KEYS.SPARKS), 25);
});

/**
 * Seeds an account with one duplicate card to trade and a Sparks balance.
 *
 * @param {object} [options] - Seeding options.
 * @param {number} [options.sparks=50] - Starting balance.
 * @returns {void}
 */
function seedTrade({ sparks = 50 } = {}) {
  resetStorage({
    [STORES.USER_STATE]: {
      [USER_STATE_KEYS.SPARKS]: sparks,
      [USER_STATE_KEYS.STATS]: {},
      [USER_STATE_KEYS.TRADES]: buildDefaultTradeState(),
    },
    [STORES.COLLECTION]: {
      [TRADE_KEY]: {
        key: TRADE_KEY,
        cardId: 'SERIE-A1 / W001',
        style: 'classic',
        set: 'A1',
        quantity: 2,
        firstObtainedAt: '2026-01-01T00:00:00.000Z',
        lastObtainedAt: '2026-01-01T00:00:00.000Z',
      },
    },
  });
}

test('a trade escrow and its refund publish the balance', async () => {
  seedTrade();

  const spent = await publishedDuring(() =>
    tradeManager.lockCard(
      { key: TRADE_KEY },
      { role: 'initiator', tradeId: 't-regression', sparks: 9, enderEyes: 1 }
    )
  );
  assert.deepEqual(spent, [41]);
  assert.equal(readState(USER_STATE_KEYS.SPARKS), 41);

  const escrow = readState(USER_STATE_KEYS.TRADES).escrows['t-regression'];
  assert.ok(escrow, 'the escrow must be stored by the debit');

  const refunded = await publishedDuring(() => tradeManager.refundEscrow(escrow, 't-regression'));
  assert.deepEqual(refunded, [50]);
  assert.equal(readState(USER_STATE_KEYS.SPARKS), 50);
});

/**
 * Resource-safety tests for the Illager Shop.
 *
 * The shop charges a temporary currency and grants Sparks, cards, boosters or resources. The tested
 * guarantees are:
 *   - a purchase charges the balance and grants the reward in one transaction;
 *   - a failed reward write leaves the currency untouched;
 *   - a failed shop-state write rolls the reward back;
 *   - an expired currency is converted into Sparks exactly once, and a failed conversion keeps it.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearWriteFailure,
  failWrite,
  installFakeStorage,
  readCollection,
  readState,
  resetStorage,
  STORES,
} from './helpers/fake_storage.mjs';
import Card from '../../js/classes/Card.js';
import { USER_STATE_KEYS } from '../../js/business/AccountManager.js';
import dateSyncManager from '../../js/business/DateSyncManager.js';
import { ILLAGER_STATE_KEY, IllagerShopManager } from '../../js/business/IllagerShopManager.js';

installFakeStorage();

const DAY = '2026-11-13';
const CURRENCY = 'TestCurrency';
const SET_ID = 7;
const OFFER_KEY = '7-1';

const CARD = new Card({
  id: 'SERIE-A1 / I001',
  names: { fr: 'Carte Illager' },
  descriptions: {},
  rarity: 1,
  style: 'classic',
  illustration: 'cards/test.png',
  set: 'A1',
});

/** Original UTC-day lookup, restored after each test. */
const originalGetCurrentUtcDay = dateSyncManager.getCurrentUtcDay;

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
 * Seeds the shop state and the destination of the tested reward.
 *
 * @param {object} [options] - Seeding options.
 * @param {number} [options.balance] - Currency balance.
 * @returns {void}
 */
function seedShopState({ balance = 5 } = {}) {
  resetStorage({
    user_state: {
      [USER_STATE_KEYS.SPARKS]: 0,
      [USER_STATE_KEYS.STATS]: {},
      [ILLAGER_STATE_KEY]: { balances: { [CURRENCY]: balance }, purchases: {} },
    },
  });
}

test.afterEach(() => {
  dateSyncManager.getCurrentUtcDay = originalGetCurrentUtcDay;
  clearWriteFailure();
});

test('buying a Sparks reward charges the currency and credits the Sparks together', async () => {
  dateSyncManager.getCurrentUtcDay = () => DAY;
  seedShopState();

  const result = await buildShop([{ type: 'Sparks', quantity: 25 }]).buy(OFFER_KEY);

  assert.equal(result.balance, 2);
  assert.equal(readState(ILLAGER_STATE_KEY).balances[CURRENCY], 2);
  assert.equal(readState(USER_STATE_KEYS.SPARKS), 25);
  assert.equal(readState(ILLAGER_STATE_KEY).purchases[String(SET_ID)][OFFER_KEY], 1);
});

test('a failed Sparks write leaves the Illager currency untouched', async () => {
  dateSyncManager.getCurrentUtcDay = () => DAY;
  seedShopState();
  failWrite((store, key) => store === STORES.USER_STATE && key === USER_STATE_KEYS.SPARKS);

  await assert.rejects(() => buildShop([{ type: 'Sparks', quantity: 25 }]).buy(OFFER_KEY));

  assert.equal(readState(ILLAGER_STATE_KEY).balances[CURRENCY], 5);
  assert.equal(readState(USER_STATE_KEYS.SPARKS), 0);
  assert.deepEqual(readState(ILLAGER_STATE_KEY).purchases, {});
});

test('buying a card charges the currency and writes the card together', async () => {
  dateSyncManager.getCurrentUtcDay = () => DAY;
  seedShopState();

  const result = await buildShop([{ type: 'Card', quantity: 1, card: CARD }]).buy(OFFER_KEY);

  assert.equal(result.card, CARD);
  assert.equal(readState(ILLAGER_STATE_KEY).balances[CURRENCY], 2);
  assert.equal(readCollection(CARD.uniqueKey).quantity, 1);
});

test('a failed shop-state write rolls the purchased card back', async () => {
  dateSyncManager.getCurrentUtcDay = () => DAY;
  seedShopState();
  failWrite(
    (store, key) => store === STORES.USER_STATE && key === ILLAGER_STATE_KEY
  );

  await assert.rejects(() =>
    buildShop([{ type: 'Card', quantity: 1, card: CARD }]).buy(OFFER_KEY)
  );

  assert.equal(readState(ILLAGER_STATE_KEY).balances[CURRENCY], 5);
  assert.equal(readCollection(CARD.uniqueKey), undefined);
  assert.deepEqual(readState(ILLAGER_STATE_KEY).purchases, {});
});

test('an expired currency is converted into Sparks in one transaction', async () => {
  const shop = new IllagerShopManager();
  shop.currencies = [
    {
      id: CURRENCY,
      name: 'Test currency',
      texture: '',
      expiration: '2026-11-12',
      conversionRate: 2,
      quests: [],
    },
  ];
  seedShopState({ balance: 3 });

  const converted = await shop.convertExpired(DAY);

  assert.deepEqual(converted.map((entry) => entry.amount), [3]);
  assert.equal(readState(ILLAGER_STATE_KEY).balances[CURRENCY], undefined);
  assert.equal(readState(USER_STATE_KEYS.SPARKS), 6);
});

test('a failed conversion keeps the expired currency and credits no Sparks', async () => {
  const shop = new IllagerShopManager();
  shop.currencies = [
    {
      id: CURRENCY,
      name: 'Test currency',
      texture: '',
      expiration: '2026-11-12',
      conversionRate: 2,
      quests: [],
    },
  ];
  seedShopState({ balance: 3 });
  failWrite((store, key) => store === STORES.USER_STATE && key === USER_STATE_KEYS.SPARKS);

  await assert.rejects(() => shop.convertExpired(DAY));

  assert.equal(readState(ILLAGER_STATE_KEY).balances[CURRENCY], 3);
  assert.equal(readState(USER_STATE_KEYS.SPARKS), 0);
});

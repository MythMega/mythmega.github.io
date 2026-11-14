/**
 * Resource-safety tests for the Sparks economy and card ownership.
 *
 * These tests exercise the paths where a player gives something away:
 *   - selling copies of a card credits Sparks in the same transaction;
 *   - buying a card debits Sparks in the same transaction;
 *   - buying a feature debits Sparks and records the purchase together.
 *
 * Every test also injects a storage failure AFTER the first write of the transaction, which is the
 * only way to prove the rollback: a partial write would leave the player with neither the resource
 * nor the thing it paid for.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  failWrite,
  clearWriteFailure,
  installFakeStorage,
  readCollection,
  readState,
  resetStorage,
  STORES,
} from './helpers/fake_storage.mjs';
import Card from '../../js/classes/Card.js';
import { USER_STATE_KEYS } from '../../js/business/AccountManager.js';
import sparksManager, { SparksError } from '../../js/business/SparksManager.js';
import featureManager from '../../js/business/FeatureManager.js';

installFakeStorage();

const CARD_KEY = 'SERIE-A1 / W001_classic';

/** Original price lookup, restored after each test. */
const originalSellPrice = sparksManager.getSellPrice;
/** Original buy-price lookup, restored after each test. */
const originalBuyPrice = sparksManager.getBuyPrice;

/**
 * Builds a valid card for the purchase tests.
 *
 * @returns {Card} The card.
 */
function buildCard() {
  return new Card({
    id: 'SERIE-A1 / W001',
    names: { fr: 'Carte' },
    descriptions: {},
    rarity: 1,
    style: 'classic',
    illustration: 'cards/test.png',
    set: 'A1',
  });
}

/**
 * Seeds a collection row with a chosen number of copies.
 *
 * @param {number} quantity - Owned copies.
 * @returns {object} The stored row.
 */
function seedCard(quantity) {
  const row = {
    key: CARD_KEY,
    cardId: 'SERIE-A1 / W001',
    style: 'classic',
    set: 'A1',
    quantity,
    firstObtainedAt: '2026-01-01T00:00:00.000Z',
    lastObtainedAt: '2026-01-01T00:00:00.000Z',
  };
  resetStorage({
    user_state: {
      [USER_STATE_KEYS.SPARKS]: 10,
      [USER_STATE_KEYS.STATS]: {
        soldByRarity: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
        cardsSold: 0,
      },
    },
    collection: { [CARD_KEY]: row },
  });
  return row;
}

test.afterEach(() => {
  sparksManager.getSellPrice = originalSellPrice;
  sparksManager.getBuyPrice = originalBuyPrice;
  clearWriteFailure();
});

test('selling one duplicate credits Sparks and decrements the collection together', async () => {
  seedCard(2);
  sparksManager.getSellPrice = async () => 7;

  const result = await sparksManager.sellCard({ key: CARD_KEY, rarity: 1, copies: 1 });

  assert.equal(result.gained, 7);
  assert.equal(result.balance, 17);
  assert.equal(result.quantity, 1);
  assert.equal(readState(USER_STATE_KEYS.SPARKS), 17);
  assert.equal(readCollection(CARD_KEY).quantity, 1);
  assert.equal(readState(USER_STATE_KEYS.STATS).cardsSold, 1);
});

test('selling every duplicate always keeps the last copy', async () => {
  seedCard(3);
  sparksManager.getSellPrice = async () => 7;

  const result = await sparksManager.sellCard({ key: CARD_KEY, rarity: 1, copies: 2 });

  assert.equal(result.quantity, 1);
  assert.equal(result.gained, 14);
  assert.equal(readCollection(CARD_KEY).quantity, 1);
  assert.equal(readState(USER_STATE_KEYS.STATS).cardsSold, 2);
});

test('the last copy cannot be sold and nothing changes', async () => {
  seedCard(1);
  sparksManager.getSellPrice = async () => 7;

  await assert.rejects(
    () => sparksManager.sellCard({ key: CARD_KEY, rarity: 1, copies: 1 }),
    (error) => error instanceof SparksError && error.code === 'LAST_COPY_PROTECTED'
  );

  assert.equal(readState(USER_STATE_KEYS.SPARKS), 10);
  assert.equal(readCollection(CARD_KEY).quantity, 1);
  assert.equal(readState(USER_STATE_KEYS.STATS).cardsSold, 0);
});

test('a failed Sparks write rolls a card sale back', async () => {
  seedCard(2);
  sparksManager.getSellPrice = async () => 7;
  failWrite((store, key) => store === STORES.USER_STATE && key === USER_STATE_KEYS.SPARKS);

  await assert.rejects(() => sparksManager.sellCard({ key: CARD_KEY, rarity: 1, copies: 1 }));

  assert.equal(readState(USER_STATE_KEYS.SPARKS), 10);
  assert.equal(readCollection(CARD_KEY).quantity, 2);
  assert.equal(readState(USER_STATE_KEYS.STATS).cardsSold, 0);
});

test('buying a card debits Sparks and adds the copy together', async () => {
  resetStorage({
    user_state: {
      [USER_STATE_KEYS.SPARKS]: 100,
      [USER_STATE_KEYS.STATS]: {},
    },
  });
  sparksManager.getBuyPrice = async () => 25;
  const card = buildCard();

  const result = await sparksManager.buyCard(card);

  assert.equal(result.spent, 25);
  assert.equal(result.balance, 75);
  assert.equal(readState(USER_STATE_KEYS.SPARKS), 75);
  assert.equal(readCollection(card.uniqueKey).quantity, 1);
});

test('a failed collection write rolls a card purchase back', async () => {
  resetStorage({
    user_state: {
      [USER_STATE_KEYS.SPARKS]: 100,
      [USER_STATE_KEYS.STATS]: {},
    },
  });
  sparksManager.getBuyPrice = async () => 25;
  failWrite((store) => store === STORES.COLLECTION);

  await assert.rejects(() => sparksManager.buyCard(buildCard()));

  assert.equal(readState(USER_STATE_KEYS.SPARKS), 100);
  assert.equal(readCollection(buildCard().uniqueKey), undefined);
});

test('buying a feature debits Sparks and records it once', async () => {
  resetStorage({
    user_state: {
      [USER_STATE_KEYS.SPARKS]: 100,
      [USER_STATE_KEYS.PURCHASES]: {},
    },
  });

  const first = await featureManager.charge('test-feature', 25);
  const second = await featureManager.charge('test-feature', 25);

  assert.equal(first.alreadyOwned, false);
  assert.equal(first.balance, 75);
  assert.equal(second.alreadyOwned, true);
  assert.equal(second.balance, 75);
  assert.ok(readState(USER_STATE_KEYS.PURCHASES)['test-feature']);
  assert.equal(readState(USER_STATE_KEYS.SPARKS), 75);
});

test('a failed purchases write rolls the feature debit back', async () => {
  resetStorage({
    user_state: {
      [USER_STATE_KEYS.SPARKS]: 100,
      [USER_STATE_KEYS.PURCHASES]: {},
    },
  });
  failWrite((store, key) => store === STORES.USER_STATE && key === USER_STATE_KEYS.PURCHASES);

  await assert.rejects(() => featureManager.charge('test-feature', 25));

  assert.equal(readState(USER_STATE_KEYS.SPARKS), 100);
  assert.deepEqual(readState(USER_STATE_KEYS.PURCHASES), {});
});

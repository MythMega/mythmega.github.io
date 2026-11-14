/**
 * Resource-safety tests for boosters.
 *
 * The tested guarantees are:
 *   - a booster-shop purchase debits Sparks, increments the monthly counter and credits the bonus
 *     bucket in one transaction;
 *   - a failed shop write rolls the Sparks and the bonus booster back;
 *   - a failed opening asks for the consumed booster to be refunded;
 *   - the refund itself restores the bucket instead of losing the booster.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearWriteFailure,
  failWrite,
  installFakeStorage,
  readState,
  resetStorage,
  STORES,
} from './helpers/fake_storage.mjs';
import Card from '../../js/classes/Card.js';
import { USER_STATE_KEYS } from '../../js/business/AccountManager.js';
import { BoosterManager } from '../../js/business/BoosterManager.js';
import dateSyncManager from '../../js/business/DateSyncManager.js';
import { configLoader } from '../../js/utils/ConfigLoader.js';

installFakeStorage();

const DAY = '2026-11-13';
const SET_ID = 'A1';

const CARD = new Card({
  id: 'SERIE-A1 / B001',
  names: { fr: 'Carte booster' },
  descriptions: {},
  rarity: 1,
  style: 'classic',
  illustration: 'cards/test.png',
  set: SET_ID,
});

/** Original dependencies, restored after each test. */
const originalKnownSets = dateSyncManager.knownSets;
const originalGetCurrentUtcDay = dateSyncManager.getCurrentUtcDay;
const originalGetRemainingBoosters = dateSyncManager.getRemainingBoosters;
const originalConsumeBooster = dateSyncManager.consumeBooster;
const originalGetBoosterSettings = configLoader.getBoosterSettings;
const originalGetSparksSettings = configLoader.getSparksSettings;

test.afterEach(() => {
  dateSyncManager.knownSets = originalKnownSets;
  dateSyncManager.getCurrentUtcDay = originalGetCurrentUtcDay;
  dateSyncManager.getRemainingBoosters = originalGetRemainingBoosters;
  dateSyncManager.consumeBooster = originalConsumeBooster;
  configLoader.getBoosterSettings = originalGetBoosterSettings;
  configLoader.getSparksSettings = originalGetSparksSettings;
  clearWriteFailure();
});

/**
 * Seeds the quota, the shop state and the Sparks balance.
 *
 * @param {object} [options] - Seeding options.
 * @param {number} [options.balance] - Sparks balance.
 * @returns {void}
 */
function seedBoosterState({ balance = 1000 } = {}) {
  resetStorage({
    user_state: {
      [USER_STATE_KEYS.SPARKS]: balance,
      [USER_STATE_KEYS.STATS]: {},
      [USER_STATE_KEYS.QUOTA]: {
        lastResetDay: DAY,
        dailyRemaining: 3,
        bonusBoosters: {},
        purchasedBoosters: 0,
        purchasedBySet: {},
      },
      [USER_STATE_KEYS.BOOSTER_SHOP]: { month: '2026-10', purchased: 9 },
    },
  });
}

/**
 * Builds a shop manager with no catalogue or network dependency.
 *
 * @returns {BoosterManager} The manager.
 */
function buildShop() {
  const manager = new BoosterManager();
  manager.init = async () => {};
  manager.getSetAvailability = () => ({ released: true, releaseDate: null });
  return manager;
}

test('a booster-shop purchase debits Sparks, counts it and credits the bonus together', async () => {
  seedBoosterState();
  dateSyncManager.knownSets = [SET_ID];
  dateSyncManager.getCurrentUtcDay = () => DAY;
  dateSyncManager.getRemainingBoosters = async () => ({
    daily: 3,
    bonusBySet: { [SET_ID]: 1 },
    bonusTotal: 1,
    purchased: 0,
    purchasedForSet: 0,
    availableForSet: 4,
  });
  configLoader.getBoosterSettings = async () => ({
    extraBoosterPriceSparks: 100,
    monthlyBoosterLimit: 10,
  });

  const result = await buildShop().buyMonthlyBoosters(1, SET_ID);

  assert.equal(result.unitPrice, 100);
  assert.equal(result.total, 100);
  assert.equal(readState(USER_STATE_KEYS.SPARKS), 900);
  assert.equal(readState(USER_STATE_KEYS.BOOSTER_SHOP).month, '2026-11');
  assert.equal(readState(USER_STATE_KEYS.BOOSTER_SHOP).purchased, 1);
  assert.equal(readState(USER_STATE_KEYS.QUOTA).bonusBoosters[SET_ID], 1);
});

test('a failed shop write rolls the Sparks and the bonus booster back', async () => {
  seedBoosterState();
  dateSyncManager.knownSets = [SET_ID];
  dateSyncManager.getCurrentUtcDay = () => DAY;
  dateSyncManager.getRemainingBoosters = async () => ({});
  configLoader.getBoosterSettings = async () => ({
    extraBoosterPriceSparks: 100,
    monthlyBoosterLimit: 10,
  });
  failWrite(
    (store, key) => store === STORES.USER_STATE && key === USER_STATE_KEYS.BOOSTER_SHOP
  );

  await assert.rejects(() => buildShop().buyMonthlyBoosters(1, SET_ID));

  assert.equal(readState(USER_STATE_KEYS.SPARKS), 1000);
  assert.equal(readState(USER_STATE_KEYS.BOOSTER_SHOP).purchased, 9);
  assert.deepEqual(readState(USER_STATE_KEYS.QUOTA).bonusBoosters, {});
});

test('a failed opening refunds the consumed booster', async () => {
  configLoader.getBoosterSettings = async () => ({
    cardsPerBooster: 1,
    godpackChancePercent: 0,
    historySize: 10,
    dailyFreeBoosters: 3,
  });
  configLoader.getSparksSettings = async () => ({ boosterReward: 0 });
  dateSyncManager.knownSets = [SET_ID];
  dateSyncManager.getRemainingBoosters = async () => ({
    daily: 1,
    bonusBySet: {},
    purchased: 0,
    purchasedForSet: 0,
    availableForSet: 1,
  });
  dateSyncManager.consumeBooster = async () => true;

  const manager = buildShop();
  manager.boosterSets = { [SET_ID]: { setId: SET_ID, cards: [CARD] } };
  manager.gachaEngine = {
    shouldDrawGodpack: () => false,
    drawPack: () => [CARD],
  };
  manager.buildHistoryEntry = () => ({ setId: SET_ID, keys: [CARD.uniqueKey] });
  manager.persistBooster = async () => {
    throw new Error('Injected persistence failure');
  };
  const refunds = [];
  manager.refundBooster = async (...args) => {
    refunds.push(args);
  };

  await assert.rejects(
    () => manager.openBooster(SET_ID, { source: 'daily' }),
    /Injected persistence failure/
  );

  assert.equal(refunds.length, 1);
  assert.equal(refunds[0][0], SET_ID);
  assert.equal(refunds[0][1], 'daily');
});

test('refunding a bonus booster restores its bucket', async () => {
  seedBoosterState();
  configLoader.getBoosterSettings = async () => ({ dailyFreeBoosters: 3 });
  dateSyncManager.knownSets = [SET_ID];
  const manager = buildShop();

  await manager.refundBooster(SET_ID, 'bonus', new Error('Injected failure'));

  assert.equal(readState(USER_STATE_KEYS.QUOTA).bonusBoosters[SET_ID], 1);
  assert.equal(readState(USER_STATE_KEYS.SPARKS), 1000);
});

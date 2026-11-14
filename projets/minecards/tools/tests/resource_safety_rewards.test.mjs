/**
 * Resource-safety tests for the reward flows.
 *
 * These flows credit several different stores at once. A partial write would either consume a code
 * without giving its rewards, give a reward twice, or lose a gift that was already read from the
 * sheet. The tests inject a storage failure after the first write and prove that everything is
 * rolled back, then verify the successful path.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearWriteFailure,
  failWrite,
  installFakeStorage,
  readCollection,
  readState,
  readStore,
  resetStorage,
  STORES,
} from './helpers/fake_storage.mjs';
import Card from '../../js/classes/Card.js';
import accountManager, { USER_STATE_KEYS } from '../../js/business/AccountManager.js';
import {
  DAILY_REWARD_KINDS,
  DailyRewardManager,
} from '../../js/business/DailyRewardManager.js';
import { GiftManager, GIFT_CATEGORIES } from '../../js/business/GiftManager.js';
import miningManager from '../../js/business/MiningManager.js';
import { RedeemManager } from '../../js/business/RedeemManager.js';
import { configLoader } from '../../js/utils/ConfigLoader.js';

installFakeStorage();

const DAY = '2026-11-13';
const CARD = new Card({
  id: 'SERIE-A1 / R001',
  names: { fr: 'Carte récompense' },
  descriptions: {},
  rarity: 1,
  style: 'classic',
  illustration: 'cards/test.png',
  set: 'A1',
});

/** Original dependencies, restored after each test. */
const originalGetUuid = accountManager.getUuid;
const originalMiningGetState = miningManager.getState;
const originalGetGiftSheet = configLoader.getGiftSheet;

test.afterEach(() => {
  accountManager.getUuid = originalGetUuid;
  miningManager.getState = originalMiningGetState;
  configLoader.getGiftSheet = originalGetGiftSheet;
  clearWriteFailure();
});

/**
 * Seeds the stores written by the reward flows.
 *
 * @returns {void}
 */
function seedRewardState() {
  resetStorage({
    user_state: {
      [USER_STATE_KEYS.SPARKS]: 0,
      [USER_STATE_KEYS.STATS]: {},
      [USER_STATE_KEYS.MINING]: {
        lastResetDay: DAY,
        minedToday: 0,
        clicks: 0,
        resources: {},
        blocksMined: {},
        totalMined: 0,
        sparksFound: 0,
        bundles: 0,
        bundleBlocks: 0,
      },
    },
  });
  accountManager.getUuid = async () => '00000000-0000-4000-8000-000000000001';
  miningManager.getState = async () => ({
    day: DAY,
    minedToday: 0,
    remaining: 1,
    blocksPerDay: 1,
    totalMined: 0,
    bundles: 1,
  });
}

test('a redeem code credits Sparks, a resource, a bundle and a card together', async () => {
  seedRewardState();
  const manager = new RedeemManager();

  const result = await manager.grantResolved({
    kind: 'special',
    repeatable: false,
    storeKey: 'TEST-CODE',
    rewards: [
      { type: 'sparks', quantity: 10 },
      { type: 'resource', key: 'stone_dust', quantity: 2 },
      { type: 'bundle', quantity: 1 },
      { type: 'card', card: CARD, quantity: 1 },
    ],
  });

  assert.equal(result.rewards.length, 4);
  assert.equal(readState(USER_STATE_KEYS.SPARKS), 10);
  assert.equal(readState(USER_STATE_KEYS.MINING).resources.stone_dust, 2);
  assert.equal(readState(USER_STATE_KEYS.MINING).bundles, 1);
  assert.equal(readCollection(CARD.uniqueKey).quantity, 1);
  assert.ok(readStore(STORES.REDEEMED_CODES)['TEST-CODE']);
  assert.equal(Object.keys(readStore(STORES.GIFTS_RECEIVED)).length, 4);
});

test('a failed reward history write rolls the whole redeem code back', async () => {
  seedRewardState();
  const manager = new RedeemManager();
  failWrite((store) => store === STORES.GIFTS_RECEIVED);

  await assert.rejects(() =>
    manager.grantResolved({
      kind: 'special',
      repeatable: false,
      storeKey: 'TEST-CODE',
      rewards: [
        { type: 'sparks', quantity: 10 },
        { type: 'resource', key: 'stone_dust', quantity: 2 },
        { type: 'bundle', quantity: 1 },
        { type: 'card', card: CARD, quantity: 1 },
      ],
    })
  );

  assert.equal(readState(USER_STATE_KEYS.SPARKS), 0);
  assert.deepEqual(readState(USER_STATE_KEYS.MINING).resources, {});
  assert.equal(readState(USER_STATE_KEYS.MINING).bundles, 0);
  assert.equal(readCollection(CARD.uniqueKey), undefined);
  assert.deepEqual(readStore(STORES.REDEEMED_CODES), {});
  assert.deepEqual(readStore(STORES.GIFTS_RECEIVED), {});
});

test('a daily reward claim credits its Sparks and advances the run together', async () => {
  seedRewardState();
  const manager = new DailyRewardManager();
  const chapter = {
    id: 'TEST-CHAPTER',
    start: '2026-11-01',
    end: '2026-11-30',
    days: new Map([[1, { reward: { kind: 'sparks', quantity: 5 } }]]),
    fallback: null,
  };
  manager.load = async () => [chapter];
  manager.getToday = () => DAY;
  manager.readState = async () => ({
    chapterId: chapter.id,
    progress: 0,
    lastClaimDay: null,
    claimedUniques: [],
    seenDay: null,
  });
  manager.buildPlan = async (reward) => ({ kind: DAILY_REWARD_KINDS.SPARKS, quantity: 5, reward });
  manager.getSnapshot = async () => ({ progress: 1 });
  manager.log = () => {};

  await manager.claim();

  assert.equal(readState(USER_STATE_KEYS.SPARKS), 5);
  assert.equal(readState(USER_STATE_KEYS.DAILY_REWARDS).lastClaimDay, DAY);
  assert.equal(readState(USER_STATE_KEYS.DAILY_REWARDS).progress, 1);
  assert.equal(readState(USER_STATE_KEYS.STATS).daysConnected, 1);
});

test('a failed daily claim write rolls its Sparks and counters back', async () => {
  seedRewardState();
  const manager = new DailyRewardManager();
  const chapter = {
    id: 'TEST-CHAPTER',
    start: '2026-11-01',
    end: '2026-11-30',
    days: new Map([[1, { reward: { kind: 'sparks', quantity: 5 } }]]),
    fallback: null,
  };
  manager.load = async () => [chapter];
  manager.getToday = () => DAY;
  manager.readState = async () => ({
    chapterId: chapter.id,
    progress: 0,
    lastClaimDay: null,
    claimedUniques: [],
    seenDay: null,
  });
  manager.buildPlan = async (reward) => ({ kind: DAILY_REWARD_KINDS.SPARKS, quantity: 5, reward });
  manager.getSnapshot = async () => ({ progress: 0 });
  manager.log = () => {};
  failWrite(
    (store, key) => store === STORES.USER_STATE && key === USER_STATE_KEYS.DAILY_REWARDS
  );

  await assert.rejects(() => manager.claim());

  assert.equal(readState(USER_STATE_KEYS.SPARKS), 0);
  assert.equal(readState(USER_STATE_KEYS.DAILY_REWARDS), undefined);
  assert.equal(readState(USER_STATE_KEYS.STATS).daysConnected, undefined);
});

test('a gift distribution credits Sparks and a card together', async () => {
  seedRewardState();
  const manager = new GiftManager();
  manager.fetchCsv = async () => ({
    url: 'test',
    text:
      'uuid,type,key,quantity\r\n' +
      '00000000-0000-4000-8000-000000000001,sparks,,10\r\n' +
      `00000000-0000-4000-8000-000000000001,card,${CARD.uniqueKey},1\r\n`,
  });
  manager.loadCatalog = async () => ({
    cardsByKey: new Map([[CARD.uniqueKey, CARD]]),
    setsById: new Map(),
  });
  configLoader.getGiftSheet = async () => ({ id: 'test', gid: '0' });

  const result = await manager.checkGifts();

  assert.equal(result.received.length, 2);
  assert.equal(readState(USER_STATE_KEYS.SPARKS), 10);
  assert.equal(readCollection(CARD.uniqueKey).quantity, 1);
  assert.equal(readState(USER_STATE_KEYS.GIFT_SYNC).lastCheckedLine, 3);
  assert.equal(Object.keys(readStore(STORES.GIFTS_RECEIVED)).length, 2);
  assert.equal(
    readStore(STORES.GIFTS_RECEIVED)[String(2)].category,
    GIFT_CATEGORIES.DISTRIBUTION
  );
});

test('a failed gift-cursor write rolls the whole distribution back', async () => {
  seedRewardState();
  const manager = new GiftManager();
  manager.fetchCsv = async () => ({
    url: 'test',
    text:
      'uuid,type,key,quantity\r\n' +
      '00000000-0000-4000-8000-000000000001,sparks,,10\r\n' +
      `00000000-0000-4000-8000-000000000001,card,${CARD.uniqueKey},1\r\n`,
  });
  manager.loadCatalog = async () => ({
    cardsByKey: new Map([[CARD.uniqueKey, CARD]]),
    setsById: new Map(),
  });
  configLoader.getGiftSheet = async () => ({ id: 'test', gid: '0' });
  failWrite(
    (store, key) => store === STORES.USER_STATE && key === USER_STATE_KEYS.GIFT_SYNC
  );

  await assert.rejects(() => manager.checkGifts());

  assert.equal(readState(USER_STATE_KEYS.SPARKS), 0);
  assert.equal(readCollection(CARD.uniqueKey), undefined);
  assert.equal(readState(USER_STATE_KEYS.GIFT_SYNC), undefined);
  assert.deepEqual(readStore(STORES.GIFTS_RECEIVED), {});
});

/**
 * Resource-safety tests for Illager quest claims.
 *
 * A claim pays a custom currency, Sparks and XP, and marks the quest as claimed. The tests prove
 * that all four writes commit together, so a storage failure never pays part of a quest or marks it
 * claimed without paying it.
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
import { USER_STATE_KEYS } from '../../js/business/AccountManager.js';
import dateSyncManager from '../../js/business/DateSyncManager.js';
import illagerShopManager, {
  ILLAGER_STATE_KEY,
} from '../../js/business/IllagerShopManager.js';
import { IllagerQuestManager } from '../../js/business/IllagerQuestManager.js';
import { ILLAGER_QUESTS_STATE_KEY } from '../../js/business/IllagerQuestState.js';
import trophyManager from '../../js/business/TrophyManager.js';

installFakeStorage();

const DAY = '2026-11-13';
const CURRENCY = 'TestCurrency';
const QUEST_ID = 'quest-1';

/** Original dependencies, restored after each test. */
const originalGetCurrentUtcDay = dateSyncManager.getCurrentUtcDay;
const originalEvaluate = trophyManager.evaluate;

/**
 * Builds a quest manager with one completed quest.
 *
 * @returns {IllagerQuestManager} The manager.
 */
function buildQuestManager() {
  const manager = new IllagerQuestManager();
  manager.init = async () => {};
  manager.quests = [
    {
      id: QUEST_ID,
      type: 'MineBlock',
      currencyId: CURRENCY,
      requirement: 1,
      start: '2026-11-01',
      expiration: '2026-11-30',
      rewards: { currency: 2, sparks: 5, xp: 10 },
    },
  ];
  manager.log = () => {};
  return manager;
}

/**
 * Seeds the quest progress, the currency and the Sparks balance.
 *
 * @returns {void}
 */
function seedQuestState() {
  resetStorage({
    user_state: {
      [USER_STATE_KEYS.SPARKS]: 0,
      [USER_STATE_KEYS.STATS]: {},
      [ILLAGER_STATE_KEY]: { balances: { [CURRENCY]: 0 }, purchases: {} },
      [ILLAGER_QUESTS_STATE_KEY]: {
        progress: { [QUEST_ID]: { count: 1, claimedAt: null } },
        experience: 0,
        lastTotalMined: 0,
        announced: [],
      },
    },
  });
  illagerShopManager.currencies = [
    {
      id: CURRENCY,
      name: 'Test currency',
      texture: '',
      expiration: null,
      conversionRate: 0,
      quests: [],
    },
  ];
  illagerShopManager.sets = [];
}

test.afterEach(() => {
  dateSyncManager.getCurrentUtcDay = originalGetCurrentUtcDay;
  trophyManager.evaluate = originalEvaluate;
  clearWriteFailure();
});

test('a quest claim pays currency, Sparks, XP and the claim mark together', async () => {
  seedQuestState();
  dateSyncManager.getCurrentUtcDay = () => DAY;
  trophyManager.evaluate = async () => {};

  const result = await buildQuestManager().claim(QUEST_ID);

  assert.equal(result.rewards.currency, 2);
  assert.equal(result.rewards.sparks, 5);
  assert.equal(result.experience, 10);
  assert.equal(readState(ILLAGER_STATE_KEY).balances[CURRENCY], 2);
  assert.equal(readState(USER_STATE_KEYS.SPARKS), 5);
  assert.equal(readState(USER_STATE_KEYS.STATS).questsCompleted, 1);
  assert.equal(readState(ILLAGER_QUESTS_STATE_KEY).experience, 10);
  assert.ok(readState(ILLAGER_QUESTS_STATE_KEY).progress[QUEST_ID].claimedAt);
});

test('a failed claim write rolls the currency, Sparks and XP back', async () => {
  seedQuestState();
  dateSyncManager.getCurrentUtcDay = () => DAY;
  trophyManager.evaluate = async () => {};
  failWrite(
    (store, key) => store === STORES.USER_STATE && key === ILLAGER_QUESTS_STATE_KEY
  );

  await assert.rejects(() => buildQuestManager().claim(QUEST_ID));

  assert.equal(readState(ILLAGER_STATE_KEY).balances[CURRENCY], 0);
  assert.equal(readState(USER_STATE_KEYS.SPARKS), 0);
  assert.equal(readState(USER_STATE_KEYS.STATS).questsCompleted, undefined);
  assert.equal(readState(ILLAGER_QUESTS_STATE_KEY).experience, 0);
  assert.equal(readState(ILLAGER_QUESTS_STATE_KEY).progress[QUEST_ID].claimedAt, null);
});

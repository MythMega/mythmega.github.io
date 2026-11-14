/**
 * Resource-safety tests for Mine Pick.
 *
 * A pick consumes one of the daily choices and writes a card. The tests prove that the collection
 * row and the pick state are committed together, so a storage failure never spends a pick without
 * granting its card (and never grants a card while restoring the pick).
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
import { MinePickManager } from '../../js/business/MinePickManager.js';
import { configLoader } from '../../js/utils/ConfigLoader.js';

installFakeStorage();

const DAY = '2026-11-13';
const MINE_PICK = USER_STATE_KEYS.MINE_PICK;
const CARD = new Card({
  id: 'SERIE-A1 / P001',
  names: { fr: 'Carte Mine Pick' },
  descriptions: {},
  rarity: 1,
  style: 'classic',
  illustration: 'cards/test.png',
  set: 'A1',
});

/** Original dependencies, restored after each test. */
const originalGetMinePickSettings = configLoader.getMinePickSettings;
const originalIsTimeTrusted = dateSyncManager.isTimeTrusted;

/**
 * Builds a Mine Pick with a deterministic one-card board.
 *
 * @returns {MinePickManager} The manager.
 */
function buildMinePick() {
  const manager = new MinePickManager();
  manager.getBoard = async () => [
    {
      index: 0,
      setId: 'A1',
      name: 'Test set',
      godpack: false,
      cards: [CARD],
      order: [0],
    },
  ];
  manager.getDay = () => DAY;
  manager.log = () => {};
  return manager;
}

/**
 * Seeds the Mine Pick allowance.
 *
 * @returns {void}
 */
function seedMinePickState() {
  resetStorage({
    user_state: {
      [MINE_PICK]: {
        lastResetDay: DAY,
        remaining: 3,
        picksByBooster: {},
        totalPicks: 0,
        picksByRarity: {},
        picksByCard: {},
        history: [],
      },
    },
  });
}

test.afterEach(() => {
  configLoader.getMinePickSettings = originalGetMinePickSettings;
  dateSyncManager.isTimeTrusted = originalIsTimeTrusted;
  clearWriteFailure();
});

test('a Mine Pick consumes one pick and adds its card together', async () => {
  seedMinePickState();
  configLoader.getMinePickSettings = async () => ({ picksPerDay: 3, historySize: 10 });
  dateSyncManager.isTimeTrusted = () => true;

  const result = await buildMinePick().pick(0, 0);

  assert.equal(result.isNew, true);
  assert.equal(result.remaining, 2);
  assert.equal(readCollection(CARD.uniqueKey).quantity, 1);
  assert.equal(readState(MINE_PICK).remaining, 2);
  assert.equal(readState(MINE_PICK).totalPicks, 1);
  assert.equal(readState(MINE_PICK).picksByCard[CARD.uniqueKey], 1);
});

test('a failed collection write keeps the Mine Pick available', async () => {
  seedMinePickState();
  configLoader.getMinePickSettings = async () => ({ picksPerDay: 3, historySize: 10 });
  dateSyncManager.isTimeTrusted = () => true;
  failWrite((store) => store === STORES.COLLECTION);

  await assert.rejects(() => buildMinePick().pick(0, 0));

  assert.equal(readState(MINE_PICK).remaining, 3);
  assert.equal(readState(MINE_PICK).totalPicks, 0);
  assert.deepEqual(readState(MINE_PICK).picksByBooster, {});
  assert.equal(readCollection(CARD.uniqueKey), undefined);
});

test('a failed pick-state write rolls the picked card back', async () => {
  seedMinePickState();
  configLoader.getMinePickSettings = async () => ({ picksPerDay: 3, historySize: 10 });
  dateSyncManager.isTimeTrusted = () => true;
  failWrite((store, key) => store === STORES.USER_STATE && key === MINE_PICK);

  await assert.rejects(() => buildMinePick().pick(0, 0));

  assert.equal(readState(MINE_PICK).remaining, 3);
  assert.equal(readState(MINE_PICK).totalPicks, 0);
  assert.equal(readCollection(CARD.uniqueKey), undefined);
});

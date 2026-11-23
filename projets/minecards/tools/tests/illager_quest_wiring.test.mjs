/**
 * Wiring tests for the Illager quests that had no progress event.
 *
 * `UploadSave` and `ChangeCardRendering` are declared in `IllagerQuestTypes` and used by the data
 * file, but nothing published their progress, so they could never be triggered. The online upload
 * now emits `SAVE_UPLOADED` and the settings emit `CARD_RENDER_MODE_CHANGED`; the quest manager
 * listens to both. These tests run the real manager against the in-memory storage and check the
 * counter actually moves.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { installFakeStorage, readState, resetStorage } from './helpers/fake_storage.mjs';
import dateSyncManager from '../../js/business/DateSyncManager.js';
import eventBus, { EVENTS } from '../../js/utils/EventBus.js';
import { IllagerQuestManager } from '../../js/business/IllagerQuestManager.js';
import { ILLAGER_QUESTS_STATE_KEY } from '../../js/business/IllagerQuestState.js';
import { ILLAGER_QUEST_TYPES } from '../../js/business/IllagerQuestTypes.js';

installFakeStorage();

const DAY = '2026-11-25';
const originalGetCurrentUtcDay = dateSyncManager.getCurrentUtcDay;

test.afterEach(() => {
  dateSyncManager.getCurrentUtcDay = originalGetCurrentUtcDay;
});

/**
 * Builds a started manager with one open quest of each type under test.
 *
 * The requirement is 2 so the single event recorded by each test moves the counter WITHOUT
 * completing the quest, which keeps the completion announcements out of the assertion.
 *
 * @returns {IllagerQuestManager} The started manager.
 */
function buildManager() {
  resetStorage();
  dateSyncManager.getCurrentUtcDay = () => DAY;

  const manager = new IllagerQuestManager();
  manager.init = async () => {};
  manager.quests = [
    {
      id: 'upload-save',
      type: ILLAGER_QUEST_TYPES.UPLOAD_SAVE,
      currencyId: 'TestCurrency',
      requirement: 2,
      start: '2026-11-01',
      expiration: '2026-11-30',
      rewards: { currency: 1, sparks: 0, xp: 0 },
    },
    {
      id: 'change-rendering',
      type: ILLAGER_QUEST_TYPES.CHANGE_CARD_RENDERING,
      currencyId: 'TestCurrency',
      requirement: 2,
      start: '2026-11-01',
      expiration: '2026-11-30',
      rewards: { currency: 1, sparks: 0, xp: 0 },
    },
  ];
  manager.log = () => {};
  manager.start();
  return manager;
}

/**
 * Lets the asynchronous `record()` calls started by an event run to completion.
 *
 * @returns {Promise<void>} Resolves on the next macrotask.
 */
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Reads the persisted counter of one quest.
 *
 * @param {string} questId - Quest id.
 * @returns {number} The counter, 0 when the quest never recorded anything.
 */
function progressOf(questId) {
  return readState(ILLAGER_QUESTS_STATE_KEY)?.progress?.[questId]?.count ?? 0;
}

test('an online save upload moves the UploadSave quest', async () => {
  const manager = buildManager();
  try {
    eventBus.emit(EVENTS.SAVE_UPLOADED, { savedAt: '2026-11-25 10:00:00', kept: 1 });
    await flush();
    assert.equal(progressOf('upload-save'), 1);
  } finally {
    manager.unsubscribers.forEach((unsubscribe) => unsubscribe());
  }
});

test('a card render change moves the ChangeCardRendering quest', async () => {
  const manager = buildManager();
  try {
    eventBus.emit(EVENTS.CARD_RENDER_MODE_CHANGED, { modeId: 'images' });
    await flush();
    assert.equal(progressOf('change-rendering'), 1);
  } finally {
    manager.unsubscribers.forEach((unsubscribe) => unsubscribe());
  }
});

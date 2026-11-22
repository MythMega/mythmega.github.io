/**
 * Regression tests for the defaults the game SHIPS.
 *
 * Three rules live in the configuration files, and each one can break the game silently when the
 * code and the files disagree:
 *   - the kinds of game notification the settings screen may switch off. A kind declared in
 *     `settings/config.json` but missing from the code list was refused by
 *     `AccountManager.updateSettings()`, which answered "settings could not be saved" for the
 *     "Quests ready" and "Trades" switches;
 *   - the number of boosters opened before the "new quest" notification is allowed: the first
 *     minutes of a run must not be interrupted by it;
 *   - the card render mode a new account starts with (`cardRender.default`): "dynamic" today, the
 *     "Minecards dynamic" preset of `settings/cardrender.json`.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { installFakeStorage, readState, resetStorage } from './helpers/fake_storage.mjs';
import accountManager, { USER_STATE_KEYS } from '../../js/business/AccountManager.js';
import dateSyncManager from '../../js/business/DateSyncManager.js';
import {
  IllagerQuestManager,
  QUEST_ANNOUNCEMENT_MIN_BOOSTERS,
} from '../../js/business/IllagerQuestManager.js';
import { ILLAGER_QUESTS_STATE_KEY } from '../../js/business/IllagerQuestState.js';
import { getShippedDefaultMode } from '../../js/utils/CardRenderManager.js';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  ConfigLoader,
  configLoader,
} from '../../js/utils/ConfigLoader.js';

installFakeStorage();

const DAY = '2026-11-13';
const QUEST_ID = 'quest-1';

/** Raw `settings/config.json`, read once. */
let rawConfig;

/** `settings/config.json` as the managers see it, kept to be restored after each test. */
let shippedConfig;

/** Original trusted-day lookup, restored after each test. */
const originalGetCurrentUtcDay = dateSyncManager.getCurrentUtcDay;

test.before(async () => {
  // `AccountManager` pulls `I18n` in, which reads `navigator` at boot.
  if (typeof globalThis.navigator === 'undefined') {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { language: 'fr', languages: ['fr'] },
    });
  }
  rawConfig = JSON.parse(await readFile(new URL('../../settings/config.json', import.meta.url), 'utf8'));
  configLoader.cachedConfig = configLoader.validate(rawConfig);
  shippedConfig = configLoader.cachedConfig;
  // The presets are read over the network in the browser and from `import.meta` here: seeding the
  // cache is what makes `getShippedDefaultMode()` resolve the SHIPPED file in a test.
  configLoader.cachedCardRenderModes = ConfigLoader.normalizeCardRenderModes(
    JSON.parse(await readFile(new URL('../../settings/cardrender.json', import.meta.url), 'utf8'))
  );
});

test.afterEach(() => {
  dateSyncManager.getCurrentUtcDay = originalGetCurrentUtcDay;
  configLoader.cachedConfig = shippedConfig;
});

/**
 * Builds a quest manager with ONE quest open on {@link DAY}.
 *
 * @returns {IllagerQuestManager} The manager, ready without reading a data file.
 */
function buildQuestManager() {
  const manager = new IllagerQuestManager();
  manager.init = async () => {};
  manager.quests = [
    {
      id: QUEST_ID,
      type: 'MineBlock',
      currencyId: 'TestCurrency',
      requirement: 1,
      start: '2026-11-01',
      expiration: '2026-11-30',
      rewards: { currency: 1, sparks: 0, xp: 0 },
    },
  ];
  manager.log = () => {};
  return manager;
}

/**
 * Seeds the global statistics of the account.
 *
 * @param {number} boostersOpened - Boosters the account ever opened.
 * @returns {void}
 */
function seedBoostersOpened(boostersOpened) {
  resetStorage({ user_state: { [USER_STATE_KEYS.STATS]: { boostersOpened } } });
  dateSyncManager.getCurrentUtcDay = () => DAY;
}

test('every notification kind of the configuration can be switched off', async () => {
  const declared = rawConfig.notifications.types;
  const { types } = await configLoader.getNotificationSettings();

  assert.ok(declared.includes('quest') && declared.includes('trade'), 'the file declares both kinds');
  // The settings screen offers one switch per declared kind: the code list has to accept them all,
  // otherwise the switch flips back and the write is refused.
  declared.forEach((type) => {
    assert.ok(
      DEFAULT_NOTIFICATION_SETTINGS.types.includes(type),
      `"${type}" is declared by config.json but refused by DEFAULT_NOTIFICATION_SETTINGS.types`
    );
  });
  assert.deepEqual(types, declared);
});

test('the settings accept a quest and a trade switch', async () => {
  // The exact call of the settings screen: a PARTIAL map, one kind at a time. It has to be
  // validated against the same list the picker is built from - the crash was a range error here.
  const original = accountManager.getSettings;
  accountManager.getSettings = () => accountManager.buildInitialSettings({});
  try {
    for (const [type, enabled] of [
      ['quest', false],
      ['trade', false],
      ['quest', true],
      ['trade', true],
    ]) {
      const merged = await accountManager.updateSettings({ notificationTypes: { [type]: enabled } });
      assert.equal(merged.notificationTypes[type], enabled, `"${type}" was not stored`);
    }
  } finally {
    accountManager.getSettings = original;
  }
});

test('the "new quest" notification waits for three opened boosters', async () => {
  seedBoostersOpened(QUEST_ANNOUNCEMENT_MIN_BOOSTERS - 1);
  const manager = buildQuestManager();

  assert.deepEqual(await manager.announceAvailable(), []);
  // Nothing was marked: the quest is told later, not lost.
  assert.deepEqual(readState(ILLAGER_QUESTS_STATE_KEY)?.announced ?? [], []);

  seedBoostersOpened(QUEST_ANNOUNCEMENT_MIN_BOOSTERS);
  const announced = await manager.announceAvailable();
  assert.equal(announced.length, 1);
  assert.deepEqual(readState(ILLAGER_QUESTS_STATE_KEY).announced, [QUEST_ID]);

  // And it is told once, however many boosters are opened afterwards.
  assert.deepEqual(await manager.announceAvailable(), []);
});

test('a new account starts on the shipped card render mode', async () => {
  const shipped = await getShippedDefaultMode();
  assert.ok(shipped, 'config.json ships a preset');
  assert.equal(shipped.id, 'dynamic');
  assert.equal(rawConfig.cardRender.default, 'dynamic');

  const settings = await accountManager.buildInitialSettings({});
  assert.equal(settings.cardRenderMode, 'dynamic');
  assert.equal(settings.cardSource, 'generate');
  assert.equal(settings.animatedLayers, shipped.animatedLayers);
  assert.equal(settings.animatedLayersSpeed, shipped.speedPercent);
  // The preset is a COMPLETE design: it is the starting card of the advanced panel too.
  assert.equal(
    settings.cardGenerate.construction.borderWidth,
    shipped.design.construction.borderWidth
  );
  assert.equal(
    settings.cardGenerate.construction.rarities['2'].accent,
    shipped.design.construction.rarities[2].accent
  );
});

test('a stored choice wins over the shipped mode', async () => {
  resetStorage({
    user_state: {
      [USER_STATE_KEYS.SETTINGS]: { cardRenderMode: 'images', cardSource: 'image' },
    },
  });

  const settings = await accountManager.getSettings();
  assert.equal(settings.cardRenderMode, 'images');
  assert.equal(settings.cardSource, 'image');
});

test('a missing or unknown shipped id keeps the images', async () => {
  for (const shipped of [null, 'images', 'a-mode-that-no-longer-exists']) {
    configLoader.cachedConfig = { ...rawConfig, cardRender: { default: shipped } };
    assert.equal(await getShippedDefaultMode(), null, `"${shipped}" must ship no preset`);

    const settings = await accountManager.buildInitialSettings({});
    assert.equal(settings.cardRenderMode, 'images');
    assert.equal(settings.cardSource, 'image');
  }
});

/**
 * Regression tests for the generated-card animation switches.
 *
 * The tested guarantees are:
 *   - a fresh design animates the background and the underlay on both layouts;
 *   - an old account that stored one global boolean per layer is migrated to both layouts;
 *   - a partial per-layout map keeps the layout it does not mention;
 *   - the switches survive an account read/write cycle.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  installFakeStorage,
  readState,
  resetStorage,
} from './helpers/fake_storage.mjs';
import accountManager, {
  AccountManager,
  USER_STATE_KEYS,
} from '../../js/business/AccountManager.js';
import { configLoader } from '../../js/utils/ConfigLoader.js';

installFakeStorage();

test.before(async () => {
  // `I18n.detectBrowserLang()` reads `navigator`, which older Node versions do not expose.
  if (typeof globalThis.navigator === 'undefined') {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { language: 'fr', languages: ['fr'] },
    });
  }
  const rawConfig = JSON.parse(
    await readFile(new URL('../../settings/config.json', import.meta.url), 'utf8')
  );
  configLoader.cachedConfig = configLoader.validate(rawConfig);
});

test('a fresh card design animates both layers on both layouts', async () => {
  const config = await configLoader.getCardGenerateSettings();
  const freshAccount = AccountManager.sanitizeCardGenerateSettings(undefined, config);

  assert.deepEqual(freshAccount.animation.background, { classic: true, fullart: true });
  assert.deepEqual(freshAccount.animation.underlay, { classic: true, fullart: true });
});

test('legacy global switches are copied to both layouts', async () => {
  const config = await configLoader.getCardGenerateSettings();
  const migrated = AccountManager.sanitizeCardGenerateSettings(
    {
      animation: {
        background: false,
        underlay: false,
      },
    },
    config
  );

  assert.deepEqual(migrated.animation.background, { classic: false, fullart: false });
  assert.deepEqual(migrated.animation.underlay, { classic: false, fullart: false });
});

test('per-layout switches stay independent and fall back per layout', async () => {
  const config = await configLoader.getCardGenerateSettings();
  const settings = AccountManager.sanitizeCardGenerateSettings(
    {
      animation: {
        background: { classic: false },
        underlay: { fullart: false },
      },
    },
    config
  );

  assert.deepEqual(settings.animation.background, { classic: false, fullart: true });
  assert.deepEqual(settings.animation.underlay, { classic: true, fullart: false });
});

test('an old account is migrated and its layer switches persist', async () => {
  resetStorage({
    user_state: {
      [USER_STATE_KEYS.SETTINGS]: {
        cardGenerate: {
          animation: {
            background: false,
            underlay: true,
          },
        },
      },
    },
  });

  const migrated = await accountManager.getSettings();
  assert.deepEqual(migrated.cardGenerate.animation.background, {
    classic: false,
    fullart: false,
  });
  assert.deepEqual(migrated.cardGenerate.animation.underlay, {
    classic: true,
    fullart: true,
  });

  await accountManager.updateSettings({
    cardGenerate: {
      animation: {
        background: { classic: true, fullart: false },
        underlay: { classic: false, fullart: true },
      },
    },
  });

  const stored = readState(USER_STATE_KEYS.SETTINGS).cardGenerate.animation;
  assert.deepEqual(stored.background, { classic: true, fullart: false });
  assert.deepEqual(stored.underlay, { classic: false, fullart: true });

  const reread = await accountManager.getSettings();
  assert.deepEqual(reread.cardGenerate.animation.background, {
    classic: true,
    fullart: false,
  });
  assert.deepEqual(reread.cardGenerate.animation.underlay, {
    classic: false,
    fullart: true,
  });
});

test('the advanced developer switch defaults off and persists', async () => {
  resetStorage();

  assert.equal((await accountManager.getSettings()).advancedDevMode, false);

  await accountManager.updateSettings({ advancedDevMode: true });
  assert.equal(readState(USER_STATE_KEYS.SETTINGS).advancedDevMode, true);
  assert.equal((await accountManager.getSettings()).advancedDevMode, true);

  await accountManager.updateSettings({ advancedDevMode: false });
  assert.equal((await accountManager.getSettings()).advancedDevMode, false);
});

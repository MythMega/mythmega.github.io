/**
 * Online save tests - upload, last-save date and download of a `.save` through the worker.
 *
 * The worker itself is covered by `saves_api.test.mjs` (which runs against the deployed API when
 * `MINECARD_API_BASE` is set). These tests prove the half that lives in the browser:
 *   - the upload sends the exact `.save` text and the `uuid` + `auth_code` pair;
 *   - a refused code is reported as an authentication failure, not as a generic error;
 *   - a download only replaces the local game with a VALID file, and reloads the page once;
 *   - a downloaded file that is not a save leaves the current data untouched;
 *   - the local copy taken before a load is named `minecard-backupsave-<date>.save`.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  installFakeStorage,
  readCollection,
  readState,
  resetStorage,
  STORES,
} from './helpers/fake_storage.mjs';
import { USER_STATE_KEYS } from '../../js/business/AccountManager.js';
import errorLog, { ERROR_SEVERITY } from '../../js/utils/ErrorLog.js';
import { compressJson, decompressJson } from '../../js/utils/Compression.js';
import { saveFile, SAVE_VERSION } from '../../js/classes/SaveFile.js';
import {
  formatSyncTimestamp,
  getSaveSyncErrorMessageKey,
  normalizeSyncAuthCode,
  normalizeSyncUuid,
  SaveSyncError,
  SAVE_SYNC_ERROR_CODES,
  SAVE_SYNC_MAX_BYTES,
  saveSyncManager,
} from '../../js/business/SaveSyncManager.js';

installFakeStorage();

const UUID = '38cc0f6a-a0e9-43d1-9c30-1c239d64af48';
const AUTH_CODE = 'ABCDEFGH12345678';

/** Requests received by the stub, in order. */
let calls = [];

/** Responses waiting to be served by the stub, in order. */
let responses = [];

/** Number of `window.location.reload()` calls. */
let reloads = 0;

const realFetch = globalThis.fetch;

/**
 * Serves the queued responses and records every request.
 *
 * @param {string} url - Requested URL.
 * @param {object} [options] - Fetch options.
 * @returns {Promise<object>} A `Response`-like object.
 */
async function fetchStub(url, options = {}) {
  calls.push({ url, options });
  const next = responses.shift();
  if (!next) throw new Error(`Unexpected request: ${url}`);
  return {
    ok: next.status >= 200 && next.status < 300,
    status: next.status,
    json: async () => next.body,
  };
}

globalThis.fetch = fetchStub;

/** Values written by the error log (`localStorage`) during the suite. */
const storedValues = new Map();

globalThis.window = {
  location: { reload: () => { reloads += 1; } },
  localStorage: {
    getItem: (key) => (storedValues.has(key) ? storedValues.get(key) : null),
    setItem: (key, value) => storedValues.set(key, String(value)),
  },
  setTimeout: (callback) => globalThis.setTimeout(callback, 0),
  clearTimeout: (id) => globalThis.clearTimeout(id),
};

test.after(() => {
  globalThis.fetch = realFetch;
  delete globalThis.window;
});

/**
 * Seeds an account with a secret code and one owned card.
 *
 * @returns {void}
 */
function seedAccount() {
  resetStorage({
    collection: {
      'SERIE-A1 / T001_classic': {
        key: 'SERIE-A1 / T001_classic',
        cardId: 'SERIE-A1 / T001',
        style: 'classic',
        set: 'A1',
        quantity: 1,
        firstObtainedAt: '2026-11-01',
        lastObtainedAt: '2026-11-01',
      },
    },
    user_state: {
      [USER_STATE_KEYS.ACCOUNT]: { uuid: UUID, createdAt: '2026-11-01T00:00:00.000Z' },
      [USER_STATE_KEYS.SETTINGS]: {},
      [USER_STATE_KEYS.QUOTA]: { dailyRemaining: 3 },
      [USER_STATE_KEYS.STATS]: { boostersOpened: 1 },
      [USER_STATE_KEYS.GIFT_SYNC]: { lastCheckedLine: 0 },
      [USER_STATE_KEYS.SOCIAL]: { authCode: AUTH_CODE, following: [] },
    },
  });
}

/**
 * Builds a valid `.save` text for another account.
 *
 * @param {string} uuid - Account of the save.
 * @returns {Promise<string>} The Base64 content.
 */
async function buildSaveText(uuid) {
  return compressJson({
    version: SAVE_VERSION,
    exportedAt: '2026-11-20T10:00:00.000Z',
    stores: {
      [STORES.COLLECTION]: [
        {
          key: 'SERIE-A2 / T002_classic',
          cardId: 'SERIE-A2 / T002',
          style: 'classic',
          set: 'A2',
          quantity: 2,
          firstObtainedAt: '2026-11-10',
          lastObtainedAt: '2026-11-10',
        },
      ],
      [STORES.USER_STATE]: {
        [USER_STATE_KEYS.ACCOUNT]: { uuid, createdAt: '2026-11-02T00:00:00.000Z' },
        [USER_STATE_KEYS.SETTINGS]: {},
        [USER_STATE_KEYS.QUOTA]: { dailyRemaining: 1 },
        [USER_STATE_KEYS.STATS]: { boostersOpened: 7 },
        [USER_STATE_KEYS.GIFT_SYNC]: { lastCheckedLine: 0 },
      },
      [STORES.REDEEMED_CODES]: [],
      [STORES.GIFTS_RECEIVED]: [],
    },
  });
}

/**
 * Resets the request bookkeeping.
 *
 * @returns {void}
 */
function resetCalls() {
  calls = [];
  responses = [];
  reloads = 0;
}

test('the upload limit matches the worker (1 000 000 bytes)', () => {
  assert.equal(SAVE_SYNC_MAX_BYTES, 1000000);
});

test('a refused worker response lands in the error report with its request detail', async () => {
  seedAccount();
  resetCalls();
  errorLog.clear();
  responses = [
    {
      status: 413,
      body: { error: 'La sauvegarde dépasse la limite de 1 Mo (1000000 caractères).' },
    },
  ];

  await assert.rejects(
    () => saveSyncManager.uploadCurrentSave(),
    (error) => error instanceof SaveSyncError && error.code === SAVE_SYNC_ERROR_CODES.HTTP
  );

  const entries = errorLog.getEntries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].source, 'save-sync');
  assert.equal(entries[0].severity, ERROR_SEVERITY.MINOR);
  assert.match(entries[0].details, /^POST \/saves → 413 · La sauvegarde dépasse/);
  // The secret code of the query string must never reach a log the player copies.
  assert.ok(!entries[0].details.includes('auth_code'));
});

test('the server timestamp is read as UTC date and time', () => {
  assert.deepEqual(formatSyncTimestamp('2026-11-20 14:05:09'), { date: '2026-11-20', time: '14:05' });
  assert.deepEqual(formatSyncTimestamp(null), { date: '', time: '' });
  assert.deepEqual(formatSyncTimestamp('nonsense'), { date: '', time: '' });
});

test('the typed credentials are checked before any request', () => {
  assert.equal(normalizeSyncUuid(' 38CC0F6A-A0E9-43D1-9C30-1C239D64AF48 '), UUID);
  assert.equal(normalizeSyncUuid('38cc0f6a-a0e9-13d1-9c30-1c239d64af48'), '');
  assert.equal(normalizeSyncAuthCode('abcdefgh12345678'), AUTH_CODE);
  assert.equal(normalizeSyncAuthCode('too-short'), '');
});

test('an upload sends the exact save and the account credentials', async () => {
  seedAccount();
  resetCalls();
  responses = [{ status: 201, body: { saved_at: '2026-11-21 09:30:00', kept: 5 } }];

  const result = await saveSyncManager.uploadCurrentSave();

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/saves$/);
  assert.equal(calls[0].options.method, 'POST');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.uuid, UUID);
  assert.equal(body.auth_code, AUTH_CODE);
  // The content is the real `.save` container of the game, not a re-encoded copy.
  const decoded = await decompressJson(body.save);
  assert.equal(decoded.version, SAVE_VERSION);
  assert.equal(decoded.stores[STORES.COLLECTION].length, 1);
  assert.equal(result.savedAt, '2026-11-21 09:30:00');
  assert.equal(result.kept, 5);
});

test('a refused code is reported as an authentication failure', async () => {
  seedAccount();
  resetCalls();
  responses = [{ status: 403, body: { error: "Code d'authentification invalide pour cet UUID." } }];

  await assert.rejects(
    () => saveSyncManager.uploadCurrentSave(),
    (error) => error instanceof SaveSyncError && error.code === SAVE_SYNC_ERROR_CODES.AUTH_REJECTED
  );
  responses = [{ status: 403, body: {} }];
  await assert.rejects(
    () => saveSyncManager.getLastSaveDate(),
    (error) => getSaveSyncErrorMessageKey(error) === 'save.sync.error.authRejected'
  );
});

test('the last-save query tells whether a save exists', async () => {
  seedAccount();
  resetCalls();
  responses = [{ status: 200, body: { exists: false, saved_at: null } }];
  assert.deepEqual(await saveSyncManager.getLastSaveDate(), { exists: false, savedAt: null });

  responses = [{ status: 200, body: { exists: true, saved_at: '2026-11-20 08:00:00' } }];
  assert.deepEqual(await saveSyncManager.getLastSaveDate(), {
    exists: true,
    savedAt: '2026-11-20 08:00:00',
  });
  assert.match(calls[0].url, new RegExp(`/saves/last\\?uuid=${UUID}&auth_code=${AUTH_CODE}`));
});

test('a download replaces the game with a valid save and reloads once', async () => {
  seedAccount();
  resetCalls();
  const remoteUuid = '211d06bb-6cb7-492a-9d55-10a3d58d2885';
  responses = [
    {
      status: 200,
      body: { exists: true, saved_at: '2026-11-20 10:00:00', save: await buildSaveText(remoteUuid) },
    },
  ];

  const result = await saveSyncManager.downloadLastSave();

  assert.equal(result.uuid, remoteUuid);
  assert.equal(result.savedAt, '2026-11-20 10:00:00');
  assert.equal(reloads, 1);
  assert.equal(readState(USER_STATE_KEYS.ACCOUNT).uuid, remoteUuid);
  assert.equal(readCollection('SERIE-A2 / T002_classic').quantity, 2);
  assert.equal(readCollection('SERIE-A1 / T001_classic'), undefined);
});

test('a downloaded file that is not a save leaves the game untouched', async () => {
  seedAccount();
  resetCalls();
  responses = [
    {
      status: 200,
      body: { exists: true, saved_at: '2026-11-20 10:00:00', save: 'not-a-deflate-stream' },
    },
  ];

  await assert.rejects(
    () => saveSyncManager.downloadLastSave(),
    (error) => error instanceof SaveSyncError && error.code === SAVE_SYNC_ERROR_CODES.INVALID_SAVE
  );
  assert.equal(reloads, 0);
  assert.equal(readState(USER_STATE_KEYS.ACCOUNT).uuid, UUID);
  assert.equal(readCollection('SERIE-A1 / T001_classic').quantity, 1);
});

test('an account without online save is refused before any file is read', async () => {
  seedAccount();
  resetCalls();
  responses = [{ status: 200, body: { exists: false, saved_at: null } }];

  await assert.rejects(
    () => saveSyncManager.downloadLastSave(),
    (error) => error.code === SAVE_SYNC_ERROR_CODES.NO_SAVE
  );
  assert.equal(reloads, 0);
});

test('the local copy taken before a load carries the requested name', async () => {
  seedAccount();
  resetCalls();
  const captured = [];
  const original = saveFile.triggerDownload;
  saveFile.triggerDownload = (filename, content) => captured.push({ filename, content });
  try {
    const { filename } = await saveSyncManager.backupCurrentSave({ day: '2026-11-21' });
    assert.equal(filename, 'minecard-backupsave-2026-11-21.save');
    assert.equal(captured.length, 1);
    assert.equal(captured[0].filename, filename);
    assert.equal((await decompressJson(captured[0].content)).stores[STORES.COLLECTION].length, 1);
  } finally {
    saveFile.triggerDownload = original;
  }
});

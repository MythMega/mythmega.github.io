/**
 * Likes guard tests - the like of the day is sent at most once per friend.
 *
 * The worker allows ONE like per FRIEND and per UTC day (`likeService.hasLikedToday`, table
 * `like_daily_target` keyed by `liker_uuid, target_uuid, day`). Asking again for the same friend can
 * only earn a 409, so the client keeps the UTC day and the friends it already liked in the save and
 * refuses to call the API for them - even after a reload.
 *
 * These tests are regressions for that guard AND for the batch ("Like tout le monde"): what they
 * check is the number of requests the stub received and the state written back, not an internal flag.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { installFakeStorage, readState, resetStorage } from './helpers/fake_storage.mjs';
import { USER_STATE_KEYS } from '../../js/business/AccountManager.js';
import dateSyncManager from '../../js/business/DateSyncManager.js';
import {
  LikesManager,
  LikesError,
  LIKES_BATCH_SIZE,
  LIKES_ERROR_CODES,
} from '../../js/business/LikesManager.js';

installFakeStorage();

const UUID = '38cc0f6a-a0e9-43d1-9c30-1c239d64af48';
const AUTH_CODE = 'ABCDEFGH12345678';
const TARGET = '52a48990-cf0e-4923-a440-0113cbad6e9b';
const OTHER_TARGET = '9fff628d-0d89-402a-9ed0-66bb901fdee6';
const THIRD_TARGET = '0b3f5f6e-1c2d-4b5a-8c7d-9e0f1a2b3c4d';
const DAY = '2026-11-22';
const NEXT_DAY = '2026-11-23';

/** UTC day the manager reads; a test moves it to simulate the next day. */
let currentDay = DAY;

/** Requests received by the stub, in order. */
let calls = [];

/** Responses waiting to be served by the stub, in order. */
let responses = [];

const originalIsTimeTrusted = dateSyncManager.isTimeTrusted;
const originalGetCurrentUtcDay = dateSyncManager.getCurrentUtcDay;
const realFetch = globalThis.fetch;

dateSyncManager.isTimeTrusted = () => true;
dateSyncManager.getCurrentUtcDay = () => currentDay;

/**
 * Serves the queued responses and records every request.
 *
 * @param {string} url - Requested URL.
 * @param {object} [options] - Fetch options.
 * @returns {Promise<object>} A `Response`-like object.
 */
async function fetchStub(url, options = {}) {
  calls.push({ url: String(url), options });
  const next = responses.shift();
  if (!next) throw new Error(`Unexpected request: ${url}`);
  return {
    ok: next.status >= 200 && next.status < 300,
    status: next.status,
    json: async () => next.body,
  };
}

globalThis.fetch = fetchStub;

// The error log persists through `window`: without it, a refused like would only print a
// `ReferenceError` instead of reaching the report the player can copy.
globalThis.window = {
  localStorage: { getItem: () => null, setItem: () => {} },
  setTimeout: (callback) => globalThis.setTimeout(callback, 0),
  clearTimeout: (id) => globalThis.clearTimeout(id),
};

test.beforeEach(() => {
  currentDay = DAY;
  calls = [];
  responses = [];
  // A published account (UUID + secret code) with no like of the day yet.
  resetStorage({
    user_state: {
      [USER_STATE_KEYS.ACCOUNT]: { uuid: UUID, createdAt: '2026-11-01T00:00:00.000Z' },
      [USER_STATE_KEYS.SETTINGS]: {},
      [USER_STATE_KEYS.SOCIAL]: { authCode: AUTH_CODE, following: [] },
      [USER_STATE_KEYS.STATS]: { likesSent: 0, likesReceived: 0 },
    },
  });
});

test.after(() => {
  globalThis.fetch = realFetch;
  delete globalThis.window;
  dateSyncManager.isTimeTrusted = originalIsTimeTrusted;
  dateSyncManager.getCurrentUtcDay = originalGetCurrentUtcDay;
});

/**
 * Serves one accepted like, ready for the next `like()`.
 *
 * @returns {void}
 */
function expectLikeAccepted() {
  responses = [{ status: 200, body: { likes: 1 } }];
}

test('a like is sent once, with the account credentials, and recorded', async () => {
  const manager = new LikesManager();
  expectLikeAccepted();
  await manager.like(TARGET);

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/likes\/friend$/);
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    uuid: UUID,
    auth_code: AUTH_CODE,
    target_uuid: TARGET,
  });
  // The friend is remembered in the save, and the statistics counted the like.
  assert.deepEqual(readState(USER_STATE_KEYS.LIKES), { day: DAY, targets: [TARGET] });
  assert.equal(readState(USER_STATE_KEYS.STATS).likesSent, 1);
});

test('a second like to the same friend the same day sends no request at all', async () => {
  const manager = new LikesManager();
  expectLikeAccepted();
  await manager.like(TARGET);

  await assert.rejects(
    () => manager.like(TARGET),
    (error) => error instanceof LikesError && error.code === LIKES_ERROR_CODES.ALREADY_LIKED
  );

  // The regression: one friend, one request.
  assert.equal(calls.length, 1);
});

test('another friend can be liked the same day', async () => {
  const manager = new LikesManager();
  expectLikeAccepted();
  await manager.like(TARGET);

  expectLikeAccepted();
  await manager.like(OTHER_TARGET);

  assert.equal(calls.length, 2);
  assert.deepEqual(readState(USER_STATE_KEYS.LIKES).targets, [TARGET, OTHER_TARGET]);
  assert.equal(readState(USER_STATE_KEYS.STATS).likesSent, 2);
});

test('the guard survives a reload: a fresh manager sends no request either', async () => {
  expectLikeAccepted();
  await new LikesManager().like(TARGET);

  // A new instance is what the page builds after a reload: only the save is shared.
  await assert.rejects(
    () => new LikesManager().like(TARGET),
    (error) => error.code === LIKES_ERROR_CODES.ALREADY_LIKED
  );

  assert.equal(calls.length, 1);
});

test('a new UTC day allows a new like to the same friend', async () => {
  expectLikeAccepted();
  await new LikesManager().like(TARGET);

  currentDay = NEXT_DAY;
  expectLikeAccepted();
  await new LikesManager().like(TARGET);

  assert.equal(calls.length, 2);
  assert.deepEqual(readState(USER_STATE_KEYS.LIKES), { day: NEXT_DAY, targets: [TARGET] });
});

test('the authenticated read seeds the day, the counters and the statistics', async () => {
  responses = [
    {
      status: 200,
      body: {
        likes: 4,
        sparks: 0,
        bonus_from_like: 0.4,
        likes_sent: 9,
        liked_targets_today: [TARGET, OTHER_TARGET],
      },
    },
  ];
  const manager = new LikesManager();
  const state = await manager.sync();

  assert.equal(state.likesSent, 9);
  assert.deepEqual(readState(USER_STATE_KEYS.LIKES), {
    day: DAY,
    targets: [TARGET, OTHER_TARGET],
  });
  assert.equal(readState(USER_STATE_KEYS.STATS).likesSent, 9);
  assert.equal(readState(USER_STATE_KEYS.STATS).likesReceived, 4);

  // A friend the worker already liked is never asked again, without any extra request.
  await assert.rejects(
    () => manager.like(TARGET),
    (error) => error.code === LIKES_ERROR_CODES.ALREADY_LIKED
  );
  assert.equal(calls.length, 1);
});

test('liking everyone sends one batch request and skips the friend already liked', async () => {
  expectLikeAccepted();
  await new LikesManager().like(TARGET);

  responses = [
    {
      status: 200,
      body: {
        liked: [OTHER_TARGET],
        already: [THIRD_TARGET],
        unknown: [],
        likes: { [OTHER_TARGET]: 3, [THIRD_TARGET]: 1 },
        likes_sent: 3,
      },
    },
  ];
  const progress = [];
  const manager = new LikesManager();
  const result = await manager.likeEveryone([TARGET, OTHER_TARGET, THIRD_TARGET], {
    onProgress: (step) => progress.push(step),
  });

  // TARGET was liked already: it is not even sent again.
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /\/likes\/batch$/);
  assert.deepEqual(JSON.parse(calls[1].options.body).target_uuids, [OTHER_TARGET, THIRD_TARGET]);
  assert.deepEqual(result.liked, [OTHER_TARGET]);
  assert.deepEqual(result.already, [THIRD_TARGET]);
  assert.deepEqual(result.likes, { [OTHER_TARGET]: 3, [THIRD_TARGET]: 1 });
  assert.deepEqual(progress, [
    { done: 0, total: 2 },
    { done: 2, total: 2 },
  ]);
  // The friends the worker accepted are remembered, and the statistics follow.
  assert.deepEqual(readState(USER_STATE_KEYS.LIKES).targets, [
    TARGET,
    OTHER_TARGET,
    THIRD_TARGET,
  ]);
  assert.equal(readState(USER_STATE_KEYS.STATS).likesSent, 2);
});

test('a long Follow List is sent in chunks, so the progress advances', async () => {
  const targets = Array.from({ length: LIKES_BATCH_SIZE + 5 }, (_, index) => {
    const head = (index + 1).toString(16).padStart(8, '0');
    return `${head}-1111-4111-8111-111111111111`;
  });
  responses = [
    { status: 200, body: { liked: targets.slice(0, LIKES_BATCH_SIZE), already: [], unknown: [], likes: {} } },
    { status: 200, body: { liked: targets.slice(LIKES_BATCH_SIZE), already: [], unknown: [], likes: {} } },
  ];
  const progress = [];

  await new LikesManager().likeEveryone(targets, {
    onProgress: (step) => progress.push(step.done),
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(progress, [0, LIKES_BATCH_SIZE, targets.length]);
  assert.equal(readState(USER_STATE_KEYS.STATS).likesSent, targets.length);
});

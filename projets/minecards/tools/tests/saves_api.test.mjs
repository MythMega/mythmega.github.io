/**
 * Online save API integration tests - run against the DEPLOYED worker.
 *
 * The unit suite (`save_sync.test.mjs`) covers the browser half with a stubbed `fetch`; this one
 * drives the real routes, the real D1 schema and the real `auth_code` rules. It is skipped unless
 * the base URL is given, so `npm test` stays offline-safe:
 *
 *   MINECARD_API_BASE=https://minecard-backend.jordanmorindev.workers.dev npm test
 *
 * It creates throwaway accounts through the first upload (that is the documented path for an
 * account that never published its trainer card) and leaves their `users`/`saves` rows behind.
 * Remove them with the admin SQL of the backend (`sql/schema/admin/clear_user.sql`).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

const BASE = (process.env.MINECARD_API_BASE ?? '').replace(/\/+$/, '');
const skip = BASE === '' ? 'MINECARD_API_BASE is not set' : false;

/**
 * Sends one JSON request.
 *
 * @param {string} path - Route beginning with `/`.
 * @param {object} [options] - Method and body.
 * @returns {Promise<{status: number, body: object}>} The decoded answer.
 */
async function send(path, { method = 'GET', body = null } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, body: payload };
}

/**
 * Builds a fresh `uuid` + `auth_code` pair that the worker has never seen.
 *
 * @returns {{uuid: string, authCode: string}} The credentials.
 */
function buildCredentials() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const authCode = Array.from(
    crypto.getRandomValues(new Uint8Array(16)),
    (byte) => alphabet[byte % alphabet.length]
  ).join('');
  return { uuid: crypto.randomUUID(), authCode };
}

/**
 * Builds a fake `.save` payload of a given size (the route stores text, it does not parse it).
 *
 * @param {string} marker - Text embedded in the payload.
 * @param {number} [padding=0] - Number of filler characters.
 * @returns {string} The save text.
 */
function buildSaveText(marker, padding = 0) {
  return `TEST-SAVE:${marker}:${'x'.repeat(padding)}`;
}

/**
 * Uploads one save and asserts it was accepted.
 *
 * @param {{uuid: string, authCode: string}} credentials - Owner.
 * @param {string} save - Save text.
 * @returns {Promise<{saved_at: string|null, kept: number}>} The answer body.
 */
async function upload(credentials, save) {
  const { status, body } = await send('/saves', {
    method: 'POST',
    body: { uuid: credentials.uuid, auth_code: credentials.authCode, save },
  });
  assert.equal(status, 201, `the save was refused (${JSON.stringify(body)})`);
  return body;
}

/**
 * Builds the authenticated query string of a read route.
 *
 * @param {{uuid: string, authCode: string}} credentials - Owner.
 * @returns {string} `uuid=…&auth_code=…`.
 */
function query(credentials) {
  return `uuid=${encodeURIComponent(credentials.uuid)}&auth_code=${encodeURIComponent(credentials.authCode)}`;
}

test('a first upload creates the account and returns the server date', { skip }, async () => {
  const credentials = buildCredentials();
  const body = await upload(credentials, buildSaveText('first'));

  assert.equal(body.kept, 5);
  assert.match(body.saved_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

  const last = await send(`/saves/last?${query(credentials)}`);
  assert.equal(last.status, 200);
  assert.equal(last.body.exists, true);
  assert.equal(last.body.saved_at, body.saved_at);

  const file = await send(`/saves/last/file?${query(credentials)}`);
  assert.equal(file.status, 200);
  assert.equal(file.body.save, buildSaveText('first'));
});

test('a wrong code is refused on every route and writes nothing', { skip }, async () => {
  const credentials = buildCredentials();
  const first = await upload(credentials, buildSaveText('kept'));
  const wrong = { uuid: credentials.uuid, authCode: 'WRONGCODE0000000' };

  const refusedUpload = await send('/saves', {
    method: 'POST',
    body: { uuid: credentials.uuid, auth_code: wrong.authCode, save: buildSaveText('intruder') },
  });
  assert.equal(refusedUpload.status, 403);

  const refusedDate = await send(`/saves/last?${query(wrong)}`);
  assert.equal(refusedDate.status, 403);

  const refusedFile = await send(`/saves/last/file?${query(wrong)}`);
  assert.equal(refusedFile.status, 403);

  // The row is untouched by the refused upload.
  const last = await send(`/saves/last/file?${query(credentials)}`);
  assert.equal(last.body.save, buildSaveText('kept'));
  assert.equal(last.body.saved_at, first.saved_at);
});

test('an account with no save answers exists:false', { skip }, async () => {
  // The code of an account that never uploaded lives in `users`, which `POST /cards` creates.
  const credentials = buildCredentials();
  const { status: published } = await send('/cards', {
    method: 'POST',
    body: {
      uuid: credentials.uuid,
      auth_code: credentials.authCode,
      username: 'SaveTester',
      background_card_id: 'default',
      profile_picture_id: 'none',
      title_id: 'none',
      card_color_id: 'auto',
      username_color_id: 'auto',
      location_id: 'assets/img/endereye.webp',
      card_layout: 'classic',
      profile_icon_size: 'normal',
      profile_icon_align: 'center',
      profile_icon_shape: 'normal',
      card_rarity: 3,
      title_color_id: 'auto',
      open_booster: 0,
      different_cards: 0,
      date_first_card: '2026-11-20',
      level: 1,
      block_mined: 0,
      picks: 0,
      points: 0,
    },
  });
  assert.equal(published, 201, 'the test account could not be published');

  const empty = await send(`/saves/last?${query(credentials)}`);
  assert.equal(empty.status, 200);
  assert.equal(empty.body.exists, false);
  assert.equal(empty.body.saved_at, null);

  const file = await send(`/saves/last/file?${query(credentials)}`);
  assert.equal(file.status, 200);
  assert.equal(file.body.exists, false);
  assert.equal(file.body.save, null);
});

test('the newest upload is the one downloaded, and only 5 are kept', { skip }, async () => {
  const credentials = buildCredentials();
  for (let index = 1; index <= 7; index += 1) {
    await upload(credentials, buildSaveText(`upload-${index}`));
  }

  const file = await send(`/saves/last/file?${query(credentials)}`);
  assert.equal(file.status, 200);
  assert.equal(file.body.save, buildSaveText('upload-7'));
});

test('a save at the 1 MB limit is stored, and a bigger one is refused', { skip }, async () => {
  const credentials = buildCredentials();
  const smallSave = buildSaveText('small');
  await upload(credentials, smallSave);

  // Exactly the documented limit (`MAX_SAVE_BYTES`, mirrored by the game): D1 must store it, which
  // is the point of the test - the row also carries uuid, byte_size and created_at.
  const atLimit = 'y'.repeat(1000000);
  const atLimitBody = await upload(credentials, atLimit);
  const stored = await send(`/saves/last/file?${query(credentials)}`);
  assert.equal(stored.status, 200);
  assert.equal(stored.body.save.length, atLimit.length);

  const tooBig = buildSaveText('big', 2 * 1024 * 1024 + 10);
  const refused = await send('/saves', {
    method: 'POST',
    body: { uuid: credentials.uuid, auth_code: credentials.authCode, save: tooBig },
  });
  assert.equal(refused.status, 413);
  // The wording of the worker ("dépasse la limite de 1 Mo") ships with its deployment; the suite
  // only requires that the refusal carries a reason.
  assert.equal(typeof refused.body.error, 'string');
  assert.notEqual(refused.body.error, '');

  // Nothing was written by the refused upload: the 1 MB one is still the newest. The timestamp
  // cannot tell them apart (one-second resolution), so the content does.
  const last = await send(`/saves/last/file?${query(credentials)}`);
  assert.equal(last.body.save.length, atLimit.length);
  assert.equal(last.body.saved_at, atLimitBody.saved_at);
  assert.notEqual(last.body.save, smallSave);
});

test('a malformed pair or an empty save is refused', { skip }, async () => {
  const notUuid = await send('/saves', {
    method: 'POST',
    body: { uuid: 'not-a-uuid', auth_code: 'ABCDEFGH12345678', save: 'x' },
  });
  assert.equal(notUuid.status, 400);

  const noSave = await send('/saves', {
    method: 'POST',
    body: { uuid: crypto.randomUUID(), auth_code: 'ABCDEFGH12345678', save: '' },
  });
  assert.equal(noSave.status, 400);
});

/**
 * Regression tests for the advanced developer allowlist.
 *
 * The tested guarantees are:
 *   - the shipped `developpers.json` contains the production account;
 *   - only a listed UUID is accepted;
 *   - a malformed or missing allowlist grants nobody.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { isAdvancedDeveloper, loadDevelopers } from '../../js/utils/DeveloperAccess.js';

const PRODUCTION_UUID = 'a614f06d-1c26-480b-af6d-60346b8c306f';
const OTHER_UUID = '00000000-0000-4000-8000-000000000000';
const originalFetch = globalThis.fetch;

/**
 * Replaces `fetch` for the next allowlist read.
 *
 * @param {object} response - `{ ok, status, body }` of the fake response.
 * @returns {void}
 */
function mockFetch({ ok = true, status = 200, body = [] } = {}) {
  globalThis.fetch = async () => ({
    ok,
    status,
    json: async () => body,
  });
}

test.after(() => {
  globalThis.fetch = originalFetch;
});

test('the shipped allowlist contains the production UUID', async () => {
  const raw = JSON.parse(
    await readFile(new URL('../../developpers.json', import.meta.url), 'utf8')
  );
  assert.ok(Array.isArray(raw));
  assert.ok(raw.includes(PRODUCTION_UUID));
});

test('only a listed UUID is accepted', async () => {
  mockFetch({ body: [PRODUCTION_UUID.toUpperCase()] });
  assert.deepEqual(await loadDevelopers({ force: true }), [PRODUCTION_UUID]);
  assert.equal(await isAdvancedDeveloper(PRODUCTION_UUID), true);
  assert.equal(await isAdvancedDeveloper(OTHER_UUID), false);
  assert.equal(await isAdvancedDeveloper(''), false);
});

test('a malformed or missing allowlist grants nobody', async () => {
  mockFetch({ body: { uuid: PRODUCTION_UUID } });
  assert.deepEqual(await loadDevelopers({ force: true }), []);
  assert.equal(await isAdvancedDeveloper(PRODUCTION_UUID), false);

  mockFetch({ ok: false, status: 404 });
  assert.deepEqual(await loadDevelopers({ force: true }), []);
  assert.equal(await isAdvancedDeveloper(PRODUCTION_UUID), false);
});

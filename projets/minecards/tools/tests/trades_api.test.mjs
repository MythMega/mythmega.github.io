/**
 * Trade API integration tests - run against the DEPLOYED worker.
 *
 * The unit suite (`trades.test.mjs`) covers the local escrow with a stubbed `fetch`; this one drives
 * the real routes, the real D1 schema and the real Ender Eyes accounting. It is skipped unless the
 * base URL is given, so `npm test` stays offline-safe:
 *
 *   MINECARD_API_BASE=https://minecard-backend.jordanmorindev.workers.dev npm test
 *
 * It creates TWO throwaway accounts through `POST /cards` (the only way to get a valid
 * `uuid` + `auth_code` pair) and leaves them in `users`/`cards`. Remove them with the admin SQL of
 * the backend (`sql/schema/admin/clear_user.sql`) and their `trade_accounts`/`trades` rows.
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
 * Publishes a trainer card, which is what creates the `uuid` + `auth_code` pair.
 *
 * @param {string} username - Display name of the test account.
 * @returns {Promise<{uuid: string, authCode: string}>} The credentials.
 */
async function createAccount(username) {
  const uuid = crypto.randomUUID();
  const authCode = `TRADETEST${Math.floor(Math.random() * 1e6)
    .toString()
    .padStart(6, '0')}`.slice(0, 16);
  const { status } = await send('/cards', {
    method: 'POST',
    body: {
      uuid,
      auth_code: authCode,
      username,
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
  assert.equal(status, 201, 'the test account could not be published');
  return { uuid, authCode };
}

/**
 * Reads the trade state of one player.
 *
 * @param {{uuid: string, authCode: string}} account - Credentials.
 * @returns {Promise<object>} The `GET /trades` payload.
 */
async function readTrades(account) {
  const { status, body } = await send(
    `/trades?uuid=${encodeURIComponent(account.uuid)}&auth_code=${encodeURIComponent(account.authCode)}`
  );
  assert.equal(status, 200, JSON.stringify(body));
  return body;
}

/**
 * Builds a card payload for a given rarity.
 *
 * @param {number} rarity - Card rarity.
 * @param {string} [key] - Collection key.
 * @returns {object} The payload.
 */
function card(rarity, key = `TRADE-TEST / W00${rarity}_classic`) {
  return {
    key,
    card_id: `TRADE-TEST / W00${rarity}`,
    style: 'classic',
    set: 'TEST',
    rarity,
    name: `Carte ${rarity}`,
  };
}

test('the full trade lifecycle works against the deployed worker', { skip }, async (t) => {
  const a = await createAccount('Trade Test A');
  const b = await createAccount('Trade Test B');
  // Reported for the cleanup: these two accounts stay in the production database.
  t.diagnostic(`created accounts ${a.uuid} and ${b.uuid}`);

  // Starting stock: 5 Ender Eyes each.
  const initial = await readTrades(a);
  assert.deepEqual(initial.incoming, []);
  assert.deepEqual(initial.outgoing, []);

  // Rarity 6 is never tradable.
  const refused = await send('/trades', {
    method: 'POST',
    body: { uuid: a.uuid, auth_code: a.authCode, responder_uuid: b.uuid, rarity: 6, card: card(6) },
  });
  assert.equal(refused.status, 400);

  // A proposes a rarity 3 card: 3 Ender Eyes are spent.
  const created = await send('/trades', {
    method: 'POST',
    body: { uuid: a.uuid, auth_code: a.authCode, responder_uuid: b.uuid, rarity: 3, card: card(3) },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const tradeId = created.body.trade.id;
  assert.equal(created.body.trade.status, 'pending');

  // Only one open request at a time.
  const second = await send('/trades', {
    method: 'POST',
    body: { uuid: a.uuid, auth_code: a.authCode, responder_uuid: b.uuid, rarity: 1, card: card(1) },
  });
  assert.equal(second.status, 409);

  // B sees it, and cannot answer with another rarity.
  const seenByB = await readTrades(b);
  assert.equal(seenByB.incoming.length, 1);
  assert.equal(seenByB.incoming[0].my_role, 'responder');
  const wrongRarity = await send('/trades/respond', {
    method: 'POST',
    body: { uuid: b.uuid, auth_code: b.authCode, trade_id: tradeId, action: 'propose', card: card(2) },
  });
  assert.equal(wrongRarity.status, 400);

  // B proposes a rarity 3 card: 3 Ender Eyes are spent.
  const proposed = await send('/trades/respond', {
    method: 'POST',
    body: { uuid: b.uuid, auth_code: b.authCode, trade_id: tradeId, action: 'propose', card: card(3, 'TRADE-TEST / W009_classic') },
  });
  assert.equal(proposed.status, 200, JSON.stringify(proposed.body));

  // A accepts, both claim, the trade completes.
  const accepted = await send('/trades/accept', {
    method: 'POST',
    body: { uuid: a.uuid, auth_code: a.authCode, trade_id: tradeId },
  });
  assert.equal(accepted.status, 200);
  const claimedByB = await send('/trades/claim', {
    method: 'POST',
    body: { uuid: b.uuid, auth_code: b.authCode, trade_id: tradeId },
  });
  assert.equal(claimedByB.status, 200);
  assert.equal(claimedByB.body.status, 'accepted');
  const claimedByA = await send('/trades/claim', {
    method: 'POST',
    body: { uuid: a.uuid, auth_code: a.authCode, trade_id: tradeId },
  });
  assert.equal(claimedByA.body.status, 'completed');

  const historyA = await readTrades(a);
  const completed = historyA.history.find((row) => row.id === tradeId);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.responder.card.key, 'TRADE-TEST / W009_classic');

  // Decline refunds the Ender Eyes of A.
  const toDecline = await send('/trades', {
    method: 'POST',
    body: { uuid: a.uuid, auth_code: a.authCode, responder_uuid: b.uuid, rarity: 1, card: card(1) },
  });
  assert.equal(toDecline.status, 201);
  const denied = await send('/trades/respond', {
    method: 'POST',
    body: { uuid: b.uuid, auth_code: b.authCode, trade_id: toDecline.body.trade.id, action: 'deny' },
  });
  assert.equal(denied.status, 200);

  // Cancel refunds too.
  const toCancel = await send('/trades', {
    method: 'POST',
    body: { uuid: a.uuid, auth_code: a.authCode, responder_uuid: b.uuid, rarity: 1, card: card(1) },
  });
  assert.equal(toCancel.status, 201);
  const cancelled = await send('/trades/cancel', {
    method: 'POST',
    body: { uuid: a.uuid, auth_code: a.authCode, trade_id: toCancel.body.trade.id },
  });
  assert.equal(cancelled.status, 200);

  // Every route refuses a request without the uuid + auth_code pair.
  assert.equal((await send('/trades')).status, 403);
  assert.equal((await send('/trades', { method: 'POST', body: {} })).status, 403);
  assert.equal(
    (await send('/trades/respond', { method: 'POST', body: { trade_id: tradeId } })).status,
    403
  );
  assert.equal(
    (await send('/trades/accept', { method: 'POST', body: { trade_id: tradeId } })).status,
    403
  );
  assert.equal(
    (await send('/trades/cancel', { method: 'POST', body: { trade_id: tradeId } })).status,
    403
  );
  assert.equal(
    (await send('/trades/claim', { method: 'POST', body: { trade_id: tradeId } })).status,
    403
  );

  // A wrong secret code is refused too.
  const badAuth = await send(
    `/trades?uuid=${encodeURIComponent(a.uuid)}&auth_code=0000000000000000`
  );
  assert.equal(badAuth.status, 403);
});

test('an action on a trade that moved on the other side is refused with 409', { skip }, async (t) => {
  const a = await createAccount('Trade Race A');
  const b = await createAccount('Trade Race B');
  t.diagnostic(`created accounts ${a.uuid} and ${b.uuid}`);

  /**
   * Runs one authenticated POST.
   *
   * @param {string} path - Trade route.
   * @param {{uuid: string, authCode: string}} account - Actor.
   * @param {object} body - Route fields, credentials excluded.
   * @returns {Promise<{status: number, body: object}>} The answer.
   */
  const act = (path, account, body) =>
    send(path, {
      method: 'POST',
      body: { uuid: account.uuid, auth_code: account.authCode, ...body },
    });

  /**
   * Opens a rarity 1 request from A to B.
   *
   * @param {string} key - Card key of the request.
   * @returns {Promise<string>} The trade id.
   */
  const open = async (key) => {
    const created = await act('/trades', a, {
      responder_uuid: b.uuid,
      rarity: 1,
      card: card(1, key),
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    return created.body.trade.id;
  };

  // 1. B withdraws its proposal: A can no longer accept it, and the card is gone from the view.
  const firstId = await open('RACE-A1_classic');
  const proposed = await act('/trades/respond', b, {
    trade_id: firstId,
    action: 'propose',
    card: card(1, 'RACE-B1_classic'),
  });
  assert.equal(proposed.status, 200);
  const withdrawal = await act('/trades/cancel', b, { trade_id: firstId });
  assert.equal(withdrawal.status, 200);
  assert.equal(withdrawal.body.status, 'pending');

  const lateAccept = await act('/trades/accept', a, { trade_id: firstId });
  assert.equal(lateAccept.status, 409);
  const afterWithdrawal = await readTrades(a);
  assert.equal(afterWithdrawal.outgoing[0].status, 'pending');
  assert.equal(afterWithdrawal.outgoing[0].responder.card, null);
  assert.equal((await act('/trades/cancel', a, { trade_id: firstId })).status, 200);

  // 2. B denies: accepting or claiming afterwards is refused on both sides.
  const secondId = await open('RACE-A2_classic');
  assert.equal((await act('/trades/respond', b, { trade_id: secondId, action: 'deny' })).status, 200);
  assert.equal((await act('/trades/accept', a, { trade_id: secondId })).status, 409);
  assert.equal((await act('/trades/claim', a, { trade_id: secondId })).status, 409);
  assert.equal((await act('/trades/claim', b, { trade_id: secondId })).status, 409);
  const declinedRow = (await readTrades(a)).history.find((row) => row.id === secondId);
  assert.equal(declinedRow.status, 'declined');

  // 3. A cancels: B can no longer answer, and A has nothing left to claim.
  const thirdId = await open('RACE-A3_classic');
  assert.equal((await act('/trades/cancel', a, { trade_id: thirdId })).status, 200);
  const lateProposal = await act('/trades/respond', b, {
    trade_id: thirdId,
    action: 'propose',
    card: card(1, 'RACE-B3_classic'),
  });
  assert.equal(lateProposal.status, 409);
  assert.equal((await act('/trades/claim', a, { trade_id: thirdId })).status, 409);

  // 4. A denial cannot be replayed either.
  const fourthId = await open('RACE-A4_classic');
  assert.equal((await act('/trades/respond', b, { trade_id: fourthId, action: 'deny' })).status, 200);
  assert.equal((await act('/trades/respond', b, { trade_id: fourthId, action: 'deny' })).status, 409);
});

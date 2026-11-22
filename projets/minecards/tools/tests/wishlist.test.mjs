/**
 * Wishlist tests - the whole local chain of the feature, plus its round trip with the worker.
 *
 * What is exercised here:
 *   - the list itself: ten distinct keys, order kept, duplicates ignored, persistence in
 *     `user_state["wishlist"]`, explicit empty list;
 *   - the two options of `settings > jeu`: the defaults (gain ON, trade OFF), their persistence,
 *     and what each one changes (`consumeGained` stays silent, `handleTradeReceived` asks);
 *   - the read half of the online round trip: `SocialManager.refreshFollowing()` gets the
 *     `wishlists` of the followed players in the same answer as their cards, caches them, and
 *     updates the cached copy when a player changes theirs.
 *
 * The worker itself is stubbed (`fetch`) exactly like `trades.test.mjs`, because the HTTP + D1
 * half is covered live by `test/live/worker.live.mjs` (which now publishes and reads a wishlist).
 * Together, the two files are the end-to-end check of the feature.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { installFakeStorage, resetStorage, readState, STORES } from './helpers/fake_storage.mjs';
import accountManager, { USER_STATE_KEYS } from '../../js/business/AccountManager.js';
import wishlistManager, {
  WISHLIST_ERRORS,
  WISHLIST_MAX,
  WishlistError,
  buildDefaultWishlistState,
  normalizeWishlistState,
} from '../../js/business/WishlistManager.js';
import socialManager, { SOCIAL_API_BASE_URL } from '../../js/business/SocialManager.js';

installFakeStorage();

const UUID = '38cc0f6a-a0e9-43d1-9c30-1c239d64af48';
const FRIEND = '211d06bb-6cb7-492a-9d55-10a3d58d2885';
const KEY_A = 'SERIE-A1 / W001_classic';
const KEY_B = 'SERIE-A1 / W002_foil';
const KEY_C = 'SERIE-A1 / W003_classic';

/** Original `fetch`, restored when the suite ends. */
const realFetch = globalThis.fetch;

/** Answer queued for the next worker read. */
let nextCardsAnswer = null;

/**
 * Serves the shipped configuration from disk, and the queued worker answer for `GET /cards`.
 *
 * @param {unknown} url - Requested URL.
 * @returns {Promise<object>} A minimal `Response`-like object.
 */
async function fetchStub(url) {
  const target = String(url);
  if (target === 'settings/config.json') {
    const body = JSON.parse(readFileSync(new URL('../../settings/config.json', import.meta.url), 'utf8'));
    return { ok: true, status: 200, json: async () => body };
  }
  if (target.startsWith(`${SOCIAL_API_BASE_URL}/cards?`)) {
    const body = nextCardsAnswer ?? { cards: [], favorites: {}, wishlists: {} };
    return { ok: true, status: 200, json: async () => body };
  }
  throw new Error(`Unexpected request: ${target}`);
}

globalThis.fetch = fetchStub;

test.after(() => {
  globalThis.fetch = realFetch;
});

/**
 * Seeds one account and the social state of a player who follows `FRIEND`.
 *
 * @param {{resetOptions?: boolean}} [options] - `resetOptions` removes the stored settings.
 * @returns {void}
 */
function seed({ resetOptions = true } = {}) {
  nextCardsAnswer = null;
  resetStorage({
    [STORES.USER_STATE]: {
      account: { uuid: UUID, createdAt: '2026-01-01T00:00:00.000Z' },
      ...(resetOptions ? {} : {}),
      social: {
        authCode: 'ABCDEFGHIJKLMNOP',
        following: [FRIEND],
        cardFetchedAt: {},
        cardCache: {},
        favoriteCache: {},
        wishlistCache: {},
      },
    },
  });
}

test('a new account starts with the option defaults: gain ON, trade OFF', async () => {
  seed();
  const settings = await accountManager.getSettings();
  assert.equal(settings.wishlistAutoRemoveGain, true);
  assert.equal(settings.wishlistAutoRemoveTrade, false);
});

test('the list keeps ten distinct keys in order, and survives a reload', async () => {
  seed();
  assert.deepEqual(await wishlistManager.getCards(), []);

  assert.equal(await wishlistManager.add(KEY_A), true);
  assert.equal(await wishlistManager.add(KEY_B), true);
  assert.equal(await wishlistManager.add(KEY_A), false, 'a duplicate is a no-op');

  assert.deepEqual(await wishlistManager.getCards(), [KEY_A, KEY_B]);
  // Stored under its own `user_state` key, so a `.save` carries it with no format change.
  assert.deepEqual(readState(USER_STATE_KEYS.WISHLIST), { cards: [KEY_A, KEY_B] });
  // Read back from storage, not from an in-memory copy.
  assert.deepEqual(normalizeWishlistState(readState(USER_STATE_KEYS.WISHLIST)), {
    cards: [KEY_A, KEY_B],
  });
  assert.equal(await wishlistManager.has(KEY_A), true);
});

test('the eleventh wish is refused and the list stays at ten', async () => {
  seed();
  for (let index = 0; index < WISHLIST_MAX; index += 1) {
    await wishlistManager.add(`SERIE-A1 / W0${index}_classic`);
  }
  assert.equal((await wishlistManager.getCards()).length, WISHLIST_MAX);

  await assert.rejects(
    () => wishlistManager.add('SERIE-A1 / W999_classic'),
    (error) => error instanceof WishlistError && error.code === WISHLIST_ERRORS.FULL
  );
  assert.equal((await wishlistManager.getCards()).length, WISHLIST_MAX);
});

test('a control character or an oversized key is refused before anything is stored', async () => {
  seed();
  await assert.rejects(
    () => wishlistManager.add('bad\u0000key'),
    (error) => error instanceof WishlistError && error.code === WISHLIST_ERRORS.INVALID_KEY
  );
  await assert.rejects(
    () => wishlistManager.add('k'.repeat(65)),
    (error) => error instanceof WishlistError && error.code === WISHLIST_ERRORS.INVALID_KEY
  );
  await assert.rejects(
    () => wishlistManager.add(''),
    (error) => error instanceof WishlistError && error.code === WISHLIST_ERRORS.INVALID_KEY
  );
  assert.deepEqual(await wishlistManager.getCards(), []);
  // `has` and `remove` are tolerant on purpose: a stale key of an older catalogue is not an error.
  assert.equal(await wishlistManager.has(''), false);
  assert.equal(await wishlistManager.remove(''), false);

  // The keys the catalogues really produce contain spaces and a slash: they must be accepted.
  assert.equal(await wishlistManager.add('SERIE-A1 / W001_classic'), true);
});

test('toggle adds then removes, and clear empties the list once', async () => {
  seed();
  assert.equal(await wishlistManager.toggle(KEY_A), true);
  assert.equal(await wishlistManager.toggle(KEY_A), false);
  assert.deepEqual(await wishlistManager.getCards(), []);

  await wishlistManager.add(KEY_B);
  await wishlistManager.add(KEY_C);
  assert.equal(await wishlistManager.clear(), true);
  assert.equal(await wishlistManager.clear(), false);
  assert.deepEqual(await wishlistManager.getCards(), []);
});

test('a booster, a purchase or a pick remove the card silently, by default', async () => {
  seed();
  await wishlistManager.add(KEY_A);
  await wishlistManager.add(KEY_B);

  const removed = await wishlistManager.consumeGained([KEY_A]);
  assert.deepEqual(removed, [KEY_A]);
  assert.deepEqual(await wishlistManager.getCards(), [KEY_B]);
});

test('with the gain option off, an obtained card stays in the list', async () => {
  seed();
  await accountManager.updateSettings({ wishlistAutoRemoveGain: false });
  assert.equal((await accountManager.getSettings()).wishlistAutoRemoveGain, false);

  await wishlistManager.add(KEY_A);
  assert.deepEqual(await wishlistManager.consumeGained([KEY_A]), []);
  assert.deepEqual(await wishlistManager.getCards(), [KEY_A]);
});

test('a received trade card asks by default, and removes without asking when enabled', async () => {
  seed();
  await wishlistManager.add(KEY_A);

  assert.equal(await wishlistManager.handleTradeReceived(KEY_A), 'ask');
  assert.deepEqual(await wishlistManager.getCards(), [KEY_A], 'asking never removes anything');
  assert.equal(await wishlistManager.handleTradeReceived(KEY_B), 'absent');

  await accountManager.updateSettings({ wishlistAutoRemoveTrade: true });
  assert.equal((await accountManager.getSettings()).wishlistAutoRemoveTrade, true);
  assert.equal(await wishlistManager.handleTradeReceived(KEY_A), 'removed');
  assert.deepEqual(await wishlistManager.getCards(), []);
});

test('the followed player wishlist arrives with their card and is cached', async () => {
  seed();
  nextCardsAnswer = {
    cards: [
      {
        uuid: FRIEND,
        username: 'Friend',
        background_card_id: 'default',
        profile_picture_id: 'none',
        title_id: 'none',
        card_color_id: 'auto',
        username_color_id: 'auto',
        location_id: '',
        card_layout: 'classic',
        profile_icon_size: 'normal',
        profile_icon_align: 'center',
        profile_icon_shape: 'normal',
        card_rarity: 1,
        title_color_id: 'auto',
        open_booster: 0,
        different_cards: 0,
        date_first_card: '2026-01-01',
        level: 1,
        block_mined: 0,
        picks: 0,
        points: 0,
        updated_at: '2026-11-22 10:00:00',
      },
    ],
    favorites: { [FRIEND]: { cards: [], trophies: [], binder: '' } },
    wishlists: { [FRIEND]: [KEY_A, KEY_B] },
  };

  const view = await socialManager.refreshFollowing({ force: true });
  assert.deepEqual(view.wishlists[FRIEND], [KEY_A, KEY_B]);
  assert.deepEqual(readState(USER_STATE_KEYS.SOCIAL).wishlistCache[FRIEND], [KEY_A, KEY_B]);

  // An explicit empty list is a real answer: the player cleared their wishlist, and the cache
  // records that instead of keeping the previous keys.
  nextCardsAnswer = {
    ...nextCardsAnswer,
    wishlists: { [FRIEND]: [] },
  };
  const refreshed = await socialManager.refreshFollowing({ force: true });
  assert.deepEqual(refreshed.wishlists[FRIEND], []);
  assert.deepEqual(readState(USER_STATE_KEYS.SOCIAL).wishlistCache[FRIEND], []);
});

test('unfollowing a player drops their cached wishlist', async () => {
  seed();
  nextCardsAnswer = { cards: [], favorites: {}, wishlists: { [FRIEND]: [KEY_A] } };
  await socialManager.refreshFollowing({ force: true });
  assert.deepEqual(readState(USER_STATE_KEYS.SOCIAL).wishlistCache[FRIEND], [KEY_A]);

  await socialManager.removeFollow(FRIEND);
  assert.equal(readState(USER_STATE_KEYS.SOCIAL).wishlistCache[FRIEND], undefined);
});

test('the default state is an empty list', () => {
  assert.deepEqual(buildDefaultWishlistState(), { cards: [] });
  assert.deepEqual(normalizeWishlistState(undefined), { cards: [] });
  assert.deepEqual(normalizeWishlistState({ cards: ['a', 'a', 'b', 12] }), { cards: ['a', 'b'] });
});

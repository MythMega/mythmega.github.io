/**
 * Tests of the Illager quests of `data/illager_shop/illager_currencies.json`.
 *
 * Reference: `.docs/projet/04-donnees-et-configuration.md` (the shape of a quest) and
 * `tools/lint/rules/data.mjs` (the same rules, applied at build time). The test runs the contract
 * ON THE SHIPPED FILE, so a hand-edited data file fails `npm run test:quests` before a release
 * instead of surfacing as a quest that can never be claimed.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const CURRENCIES_PATH = new URL('../../data/illager_shop/illager_currencies.json', import.meta.url);

const QUEST_TYPES = new Set([
  'OpenBooster_Daily',
  'DailyRewardClaim',
  'SellCard',
  'MineBlock',
  'ShareBinder',
  'MinePickCards',
  'DownloadProfilCard',
  'OpenChangelog',
  'ChangeSelectedTitle',
  'DownloadCurrentSaveBackup',
  'CustomWebsiteOpen',
]);

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Reads the currencies of the shop.
 *
 * @returns {Array<object>} The raw entries.
 */
function readCurrencies() {
  const payload = JSON.parse(readFileSync(CURRENCIES_PATH, 'utf8'));
  assert.ok(Array.isArray(payload), 'illager_currencies.json must be a list');
  return payload;
}

/**
 * Tells whether a value is a real UTC day (a well-formed day that exists in the calendar).
 *
 * @param {unknown} value - Candidate.
 * @returns {boolean} True for a real day.
 */
function isDay(value) {
  if (typeof value !== 'string' || !DAY_PATTERN.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

/**
 * Flattens every quest with the currency that carries it.
 *
 * @returns {Array<{currency: object, quest: object}>} The pairs.
 */
function readQuests() {
  return readCurrencies().flatMap((currency) =>
    (Array.isArray(currency?.Quests) ? currency.Quests : []).map((quest) => ({ currency, quest }))
  );
}

test('every quest id is unique across the whole file', () => {
  const ids = readQuests().map(({ quest }) => quest?.ID);
  assert.ok(ids.length > 0, 'the file must declare at least one quest');
  ids.forEach((id) => assert.ok(typeof id === 'string' && id.trim() !== '', 'a quest has no ID'));
  assert.equal(new Set(ids).size, ids.length, `duplicate quest id(s): ${ids.join(', ')}`);
});

test('every quest has a known objective and a positive requirement', () => {
  readQuests().forEach(({ quest }) => {
    const where = `quest ${JSON.stringify(quest?.ID)}`;
    assert.ok(QUEST_TYPES.has(quest?.Type), `${where} has an unknown Type ${JSON.stringify(quest?.Type)}`);
    assert.ok(
      Number.isInteger(quest?.RequirementsToUnlock) && quest.RequirementsToUnlock > 0,
      `${where} has no positive RequirementsToUnlock`
    );
  });
});

test('every quest starts on a real day and ends after it', () => {
  readQuests().forEach(({ currency, quest }) => {
    const where = `quest ${JSON.stringify(quest?.ID)}`;
    assert.ok(isDay(quest?.StartDate), `${where} has no real StartDate`);

    const start = quest.StartDate;
    const currencyExpiration = isDay(currency?.ExpirationDate) ? currency.ExpirationDate : null;
    const ownExpiration = quest.ExpirationDate === undefined ? null : quest.ExpirationDate;
    if (ownExpiration !== null) {
      assert.ok(isDay(ownExpiration), `${where} has an invalid ExpirationDate`);
    }
    // The expiration of the currency is the default of the quest AND its ceiling.
    const expiration = ownExpiration ?? currencyExpiration;
    if (expiration !== null) {
      assert.ok(start <= expiration, `${where} starts after it expires (${expiration})`);
    }
    if (currencyExpiration !== null) {
      assert.ok(start <= currencyExpiration, `${where} starts after its currency expired`);
      if (expiration !== null) {
        assert.ok(
          expiration <= currencyExpiration,
          `${where} ends after its currency (${currencyExpiration})`
        );
      }
    }
  });
});

test('every quest grants at least one non-negative integer reward', () => {
  readQuests().forEach(({ quest }) => {
    const where = `quest ${JSON.stringify(quest?.ID)}`;
    const rewards = ['RewardCurrency', 'RewardSparks', 'RewardXP'].map((key) => quest?.[key] ?? 0);
    rewards.forEach((value, index) => {
      assert.ok(
        Number.isInteger(value) && value >= 0,
        `${where} has an invalid ${['RewardCurrency', 'RewardSparks', 'RewardXP'][index]}`
      );
    });
    assert.ok(rewards.some((value) => value > 0), `${where} grants nothing`);
  });
});

/**
 * Resource-safety tests for the Wandering Trader.
 *
 * The trader is where mined resources are turned into cards, and where resources are exchanged.
 * The tests prove that:
 *   - a card purchase debits the resources and writes the card in one transaction;
 *   - a failed card write leaves the resources untouched;
 *   - a failed trader-state write rolls the resource debit and the card back;
 *   - a resource swap moves both sides together;
 *   - a swap preserves the permanent pinned-offer counts and the daily Sparks-offer flag.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearWriteFailure,
  failWrite,
  installFakeStorage,
  readCollection,
  readState,
  resetStorage,
  STORES,
} from './helpers/fake_storage.mjs';
import Card from '../../js/classes/Card.js';
import { USER_STATE_KEYS } from '../../js/business/AccountManager.js';
import { TraderManager } from '../../js/business/TraderManager.js';
import miningManager from '../../js/business/MiningManager.js';

installFakeStorage();

const DAY = '2026-11-13';
const WEEK = '2026-11-09';
const MINING = USER_STATE_KEYS.MINING;
const TRADER = USER_STATE_KEYS.TRADER;

const CARD = new Card({
  id: 'SERIE-A1 / T001',
  names: { fr: 'Carte du marchand' },
  descriptions: {},
  rarity: 1,
  style: 'classic',
  illustration: 'cards/test.png',
  set: 'A1',
});

const OFFER = {
  key: 'weekly-test',
  source: 'weekly',
  card: CARD,
  price: [{ slug: 'stone_dust', quantity: 2, type: 'stone_dust' }],
  maxUses: null,
};

const TRADE = {
  key: 'swap-1',
  day: DAY,
  left: { slug: 'stone_dust', quantity: 2, type: 'stone_dust' },
  right: { slug: 'sculk_dust', quantity: 1, type: 'sculk_dust' },
};

/** Original mining state reader, restored after each test. */
const originalMiningGetState = miningManager.getState;

/**
 * Builds a trader with deterministic offers and no network access.
 *
 * @returns {TraderManager} The manager.
 */
function buildTrader() {
  const trader = new TraderManager();
  trader.getOffers = async () => [OFFER];
  trader.getTrades = async () => [TRADE];
  trader.getWeekStart = async () => WEEK;
  trader.getState = async () => ({ week: WEEK, offers: [OFFER], sparkOffer: null, trades: [TRADE] });
  trader.log = () => {};
  return trader;
}

/**
 * Seeds the trader state and the mined resources used by the tests.
 *
 * @param {object} [options] - Seeding options.
 * @param {Record<string, number>} [options.resources] - Mined resources.
 * @returns {void}
 */
function seedTraderState({ resources = { stone_dust: 5 } } = {}) {
  resetStorage({
    user_state: {
      [USER_STATE_KEYS.SPARKS]: 0,
      [USER_STATE_KEYS.STATS]: {},
      [MINING]: {
        lastResetDay: DAY,
        minedToday: 0,
        clicks: 0,
        resources,
        blocksMined: {},
        totalMined: 0,
        sparksFound: 0,
        bundles: 0,
        bundleBlocks: 0,
      },
      [TRADER]: {
        week: WEEK,
        purchases: {},
        pinnedUsed: { 'pinned-test': 1 },
        tradeDay: DAY,
        tradeUses: { 'swap-old': 1 },
        sparkDay: DAY,
        sparkBought: true,
      },
    },
  });
}

test.afterEach(() => {
  miningManager.getState = originalMiningGetState;
  clearWriteFailure();
});

test('buying a card debits resources and writes the card in one transaction', async () => {
  seedTraderState();
  miningManager.getState = async () => ({
    day: DAY,
    minedToday: 0,
    remaining: 1,
    blocksPerDay: 1,
    totalMined: 0,
  });

  const result = await buildTrader().buy(OFFER.key);

  assert.equal(result.isNew, true);
  assert.deepEqual(result.resources, { stone_dust: 3 });
  assert.equal(readState(MINING).resources.stone_dust, 3);
  assert.equal(readCollection(CARD.uniqueKey).quantity, 1);
  assert.equal(readState(TRADER).purchases[OFFER.key], 1);
  assert.equal(readState(TRADER).pinnedUsed['pinned-test'], 1);
  assert.equal(readState(TRADER).sparkDay, DAY);
  assert.equal(readState(TRADER).sparkBought, true);
});

test('a failed card write leaves the trader price in the inventory', async () => {
  seedTraderState();
  failWrite((store) => store === STORES.COLLECTION);

  await assert.rejects(() => buildTrader().buy(OFFER.key));

  assert.equal(readState(MINING).resources.stone_dust, 5);
  assert.equal(readCollection(CARD.uniqueKey), undefined);
  assert.deepEqual(readState(TRADER).purchases, {});
});

test('a failed trader-state write rolls the card and the resources back', async () => {
  seedTraderState();
  failWrite((store, key) => store === STORES.USER_STATE && key === TRADER);

  await assert.rejects(() => buildTrader().buy(OFFER.key));

  assert.equal(readState(MINING).resources.stone_dust, 5);
  assert.equal(readCollection(CARD.uniqueKey), undefined);
  assert.deepEqual(readState(TRADER).purchases, {});
});

test('buying the daily Sparks offer debits Sparks and grants the resource together', async () => {
  seedTraderState({ resources: {} });
  const trader = buildTrader();
  const offer = {
    day: DAY,
    priceSparks: 10,
    quantity: 2,
    item: { slug: 'stone_dust', type: 'stone_dust' },
  };
  trader.getSparkOffer = async () => offer;
  trader.getTradeDay = async () => DAY;
  trader.getState = async () => ({ week: WEEK, offers: [OFFER], sparkOffer: offer, trades: [] });
  miningManager.getState = async () => ({
    day: DAY,
    minedToday: 0,
    remaining: 1,
    blocksPerDay: 1,
    totalMined: 0,
  });
  resetStorage({
    user_state: {
      [USER_STATE_KEYS.SPARKS]: 100,
      [USER_STATE_KEYS.STATS]: {},
      [MINING]: { lastResetDay: DAY, resources: {}, bundles: 0, bundleBlocks: 0 },
      [TRADER]: {
        week: WEEK,
        purchases: {},
        pinnedUsed: { 'pinned-test': 1 },
        tradeDay: DAY,
        tradeUses: {},
        sparkDay: null,
        sparkBought: false,
      },
    },
  });

  const result = await trader.buySparkOffer();

  assert.equal(result.balance, 90);
  assert.equal(readState(USER_STATE_KEYS.SPARKS), 90);
  assert.equal(readState(MINING).resources.stone_dust, 2);
  assert.equal(readState(TRADER).sparkBought, true);
  assert.equal(readState(TRADER).sparkDay, DAY);
});

test('a failed daily Sparks-offer write rolls both the Sparks and the resource back', async () => {
  seedTraderState({ resources: {} });
  const trader = buildTrader();
  const offer = {
    day: DAY,
    priceSparks: 10,
    quantity: 2,
    item: { slug: 'stone_dust', type: 'stone_dust' },
  };
  trader.getSparkOffer = async () => offer;
  trader.getTradeDay = async () => DAY;
  resetStorage({
    user_state: {
      [USER_STATE_KEYS.SPARKS]: 100,
      [USER_STATE_KEYS.STATS]: {},
      [MINING]: { lastResetDay: DAY, resources: {}, bundles: 0, bundleBlocks: 0 },
      [TRADER]: {
        week: WEEK,
        purchases: {},
        pinnedUsed: {},
        tradeDay: DAY,
        tradeUses: {},
        sparkDay: null,
        sparkBought: false,
      },
    },
  });
  failWrite((store, key) => store === STORES.USER_STATE && key === TRADER);

  await assert.rejects(() => trader.buySparkOffer());

  assert.equal(readState(USER_STATE_KEYS.SPARKS), 100);
  assert.equal(readState(MINING).resources.stone_dust, undefined);
  assert.equal(readState(TRADER).sparkBought, false);
});

test('a resource swap gives both resources and records its use', async () => {
  seedTraderState({ resources: { stone_dust: 5, sculk_dust: 0 } });
  miningManager.getState = async () => ({
    day: DAY,
    minedToday: 0,
    remaining: 1,
    blocksPerDay: 1,
    totalMined: 0,
  });

  const result = await buildTrader().swap(TRADE.key, 'stone_dust');

  assert.deepEqual(result.resources, { stone_dust: 3, sculk_dust: 1 });
  assert.equal(readState(MINING).resources.stone_dust, 3);
  assert.equal(readState(MINING).resources.sculk_dust, 1);
  assert.equal(readState(TRADER).tradeUses[TRADE.key], 1);
  assert.equal(readState(TRADER).pinnedUsed['pinned-test'], 1);
  assert.equal(readState(TRADER).sparkDay, DAY);
  assert.equal(readState(TRADER).sparkBought, true);
});

test('a failed swap write moves neither resource and keeps the use count', async () => {
  seedTraderState({ resources: { stone_dust: 5, sculk_dust: 0 } });
  failWrite((store, key) => store === STORES.USER_STATE && key === TRADER);

  await assert.rejects(() => buildTrader().swap(TRADE.key, 'stone_dust'));

  assert.equal(readState(MINING).resources.stone_dust, 5);
  assert.equal(readState(MINING).resources.sculk_dust, 0);
  assert.deepEqual(readState(TRADER).tradeUses, { 'swap-old': 1 });
});

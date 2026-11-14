/**
 * Resource-safety tests for the Mine.
 *
 * The mine is the main source of mined resources and Sparks. The tested guarantees are:
 *   - a broken block writes its loot and its Sparks in one transaction;
 *   - a failed loot write does not consume the block or its rewards;
 *   - spending or swapping resources never takes one side without the other;
 *   - a bundle purchase debits Sparks and credits bundles atomically;
 *   - a bundle is only consumed once its blocks are credited.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearWriteFailure,
  failWrite,
  installFakeStorage,
  readState,
  resetStorage,
  STORES,
} from './helpers/fake_storage.mjs';
import { USER_STATE_KEYS } from '../../js/business/AccountManager.js';
import dateSyncManager from '../../js/business/DateSyncManager.js';
import sparksManager from '../../js/business/SparksManager.js';
import { MiningManager } from '../../js/business/MiningManager.js';

installFakeStorage();

const MINING = USER_STATE_KEYS.MINING;
const DAY = '2026-11-13';

/** Original Sparks crossing, restored after each test. */
const originalAddSparks = sparksManager.addSparks;
/** Original UTC-day lookup, restored after each test. */
const originalGetCurrentUtcDay = dateSyncManager.getCurrentUtcDay;
/** Original trusted-time check, restored after each test. */
const originalIsTimeTrusted = dateSyncManager.isTimeTrusted;

/**
 * Builds a mine manager with deterministic rules and no network access.
 *
 * @returns {MiningManager} The manager.
 */
function buildMine() {
  const mine = new MiningManager();
  mine.settings = { blocksPerDay: 1, seedSalt: 'tests', monthlyBundleLimit: 2, bundlePriceSparks: 10, blocksPerBundle: 5 };
  mine.blocks = [
    {
      id: 'material.stone',
      weight: 1,
      hardness: 1,
      names: { fr: 'Pierre', en: 'Stone' },
      texture: 'stone.webp',
      sounds: { mine: '', break: '' },
      rewards: [],
    },
  ];
  mine.blocksById = new Map([['material.stone', mine.blocks[0]]]);
  mine.uuid = '00000000-0000-4000-8000-000000000001';
  mine.cracks = [];
  mine.getDay = () => DAY;
  mine.describe = (block) => ({ id: block.id, name: block.names.fr, names: block.names, texture: '', hardness: block.hardness, sounds: {} });
  mine.log = () => {};
  return mine;
}

/**
 * Seeds the minimal user state used by the mine tests.
 *
 * @param {object} [overrides] - Values overriding the defaults.
 * @returns {void}
 */
function seedMineState(overrides = {}) {
  resetStorage({
    user_state: {
      [USER_STATE_KEYS.SPARKS]: 0,
      [USER_STATE_KEYS.STATS]: {},
      [MINING]: {
        lastResetDay: DAY,
        minedToday: 0,
        clicks: 0,
        resources: { stone_dust: 1 },
        blocksMined: {},
        totalMined: 0,
        sparksFound: 0,
        bundles: 0,
        bundleBlocks: 0,
        ...overrides,
      },
    },
  });
}

test.afterEach(() => {
  sparksManager.addSparks = originalAddSparks;
  dateSyncManager.getCurrentUtcDay = originalGetCurrentUtcDay;
  dateSyncManager.isTimeTrusted = originalIsTimeTrusted;
  clearWriteFailure();
});

test('a broken block credits its resources and Sparks together', async () => {
  seedMineState();
  dateSyncManager.isTimeTrusted = () => true;
  dateSyncManager.getCurrentUtcDay = () => DAY;

  const mine = buildMine();
  mine.getState = async () => ({
    day: DAY,
    blocksPerDay: 1,
    minedToday: 0,
    dailyRemaining: 1,
    bundleBlocks: 0,
    bundles: 0,
    remaining: 1,
    clicks: 0,
    block: { id: 'material.stone' },
    resources: { stone_dust: 1 },
    blocksMined: {},
    totalMined: 0,
    sparksFound: 0,
  });
  mine.rollRewards = () => [
    { kind: 'resource', slug: 'stone_dust', amount: 2, type: 'stone_dust' },
    { kind: 'sparks', amount: 5, type: 'sparks' },
  ];

  const result = await mine.mine();

  assert.equal(result.broke, true);
  assert.equal(result.sparks, 5);
  assert.equal(result.minedToday, 1);
  assert.deepEqual(readState(MINING).resources, { stone_dust: 3 });
  assert.equal(readState(MINING).totalMined, 1);
  assert.equal(readState(USER_STATE_KEYS.SPARKS), 5);
});

test('a failed loot write consumes neither the block nor its rewards', async () => {
  seedMineState();
  dateSyncManager.isTimeTrusted = () => true;
  dateSyncManager.getCurrentUtcDay = () => DAY;

  const mine = buildMine();
  mine.getState = async () => ({
    day: DAY,
    blocksPerDay: 1,
    minedToday: 0,
    dailyRemaining: 1,
    bundleBlocks: 0,
    bundles: 0,
    remaining: 1,
    clicks: 0,
    block: { id: 'material.stone' },
    resources: { stone_dust: 1 },
    blocksMined: {},
    totalMined: 0,
    sparksFound: 0,
  });
  mine.rollRewards = () => [
    { kind: 'resource', slug: 'stone_dust', amount: 2, type: 'stone_dust' },
    { kind: 'sparks', amount: 5, type: 'sparks' },
  ];
  sparksManager.addSparks = async () => {
    throw new Error('Injected Sparks failure');
  };

  await assert.rejects(() => mine.mine());

  assert.equal(readState(MINING).minedToday, 0);
  assert.equal(readState(MINING).clicks, 0);
  assert.deepEqual(readState(MINING).resources, { stone_dust: 1 });
  assert.equal(readState(USER_STATE_KEYS.SPARKS), 0);
});

test('spending resources is all-or-nothing', async () => {
  seedMineState({ resources: { stone_dust: 5, sculk_dust: 2 } });
  const mine = buildMine();

  const left = await mine.spendResources({ stone_dust: 2, sculk_dust: 1 });
  assert.deepEqual(left, { stone_dust: 3, sculk_dust: 1 });

  await assert.rejects(
    () => mine.spendResources({ stone_dust: 99 }),
    (error) => error.code === 'INSUFFICIENT_RESOURCES'
  );
  assert.deepEqual(readState(MINING).resources, { stone_dust: 3, sculk_dust: 1 });
});

test('a failed outer transaction rolls a resource payment back', async () => {
  seedMineState({ resources: { stone_dust: 5 } });
  const mine = buildMine();

  const { storageRepository } = await import('../../js/models/StorageRepository.js');
  await assert.rejects(() =>
    storageRepository.transaction(STORES.USER_STATE, 'readwrite', async (context) => {
      await mine.spendResources({ stone_dust: 2 }, context);
      throw new Error('Injected failure after the payment');
    })
  );

  assert.deepEqual(readState(MINING).resources, { stone_dust: 5 });
});

test('swapping resources gives both sides in one write', async () => {
  seedMineState({ resources: { stone_dust: 5, sculk_dust: 1 } });
  const mine = buildMine();

  const left = await mine.swapResources({
    give: { stone_dust: 2 },
    receive: { sculk_dust: 3 },
  });

  assert.deepEqual(left, { stone_dust: 3, sculk_dust: 4 });
  assert.deepEqual(readState(MINING).resources, { stone_dust: 3, sculk_dust: 4 });
});

test('a bundle purchase debits Sparks and credits the bundle together', async () => {
  seedMineState();
  resetStorage({
    user_state: {
      [USER_STATE_KEYS.SPARKS]: 100,
      [USER_STATE_KEYS.STATS]: {},
      [MINING]: { lastResetDay: DAY, minedToday: 0, clicks: 0, resources: {}, blocksMined: {}, totalMined: 0, sparksFound: 0, bundles: 0, bundleBlocks: 0 },
    },
  });
  dateSyncManager.getCurrentUtcDay = () => DAY;
  const mine = buildMine();
  mine.getState = async () => ({ day: DAY, blocksPerDay: 1, minedToday: 0, remaining: 1, totalMined: 0, bundles: readState(MINING).bundles ?? 0 });

  const result = await mine.buyMonthlyBundles(1);

  assert.equal(result.balance, 90);
  assert.equal(readState(MINING).bundles, 1);
  assert.deepEqual(readState(USER_STATE_KEYS.BUNDLE_SHOP), { month: '2026-11', purchased: 1 });
});

test('a failed bundle write rolls the Sparks debit back', async () => {
  resetStorage({
    user_state: {
      [USER_STATE_KEYS.SPARKS]: 100,
      [USER_STATE_KEYS.STATS]: {},
      [MINING]: { lastResetDay: DAY, minedToday: 0, clicks: 0, resources: {}, blocksMined: {}, totalMined: 0, sparksFound: 0, bundles: 0, bundleBlocks: 0 },
    },
  });
  dateSyncManager.getCurrentUtcDay = () => DAY;
  const mine = buildMine();
  mine.getState = async () => ({ day: DAY, blocksPerDay: 1, minedToday: 0, remaining: 1, totalMined: 0, bundles: 0 });
  failWrite((store, key) => store === STORES.USER_STATE && key === MINING);

  await assert.rejects(() => mine.buyMonthlyBundles(1));

  assert.equal(readState(USER_STATE_KEYS.SPARKS), 100);
  assert.equal(readState(MINING).bundles, 0);
  assert.equal(readState(USER_STATE_KEYS.BUNDLE_SHOP), undefined);
});

test('a failed bundle use keeps the bundle and adds no blocks', async () => {
  seedMineState({ minedToday: 1, bundles: 1, bundleBlocks: 0 });
  const mine = buildMine();
  mine.getState = async () => ({
    day: DAY,
    blocksPerDay: 1,
    minedToday: 1,
    remaining: 5,
    totalMined: 1,
    bundles: 1,
    bundleBlocks: 0,
  });
  failWrite((store, key) => store === STORES.USER_STATE && key === MINING);

  await assert.rejects(() => mine.useBundle());

  assert.equal(readState(MINING).bundles, 1);
  assert.equal(readState(MINING).bundleBlocks, 0);
});

test('using a bundle consumes it only while adding its paid blocks', async () => {
  seedMineState({ minedToday: 1, bundles: 1, bundleBlocks: 0 });
  const mine = buildMine();
  mine.getState = async () => ({
    day: DAY,
    blocksPerDay: 1,
    minedToday: 1,
    remaining: 5,
    totalMined: 1,
    bundles: readState(MINING).bundles ?? 0,
    bundleBlocks: readState(MINING).bundleBlocks ?? 0,
  });

  const result = await mine.useBundle();

  assert.equal(result.blocksAdded, 5);
  assert.equal(result.bundles, 0);
  assert.equal(readState(MINING).bundles, 0);
  assert.equal(readState(MINING).bundleBlocks, 5);
});

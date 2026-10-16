/**
 * MiningManager - the Mine (MineBlock): ten blocks a day, mined one by one.
 *
 * Reference: `settings/mining.json` (the blocks themselves: weight, hardness, loot) and
 * `settings/config.json` (`mining`: the daily allowance, the path of that file and the seed salt).
 *
 * WHAT THE PLAYER SEES
 *   One block at a time. It is drawn at random among the five kinds, with a `Weight` deciding how
 *   often each one comes up (`material.stone` is the common one, `material.obsidian` the rare one),
 *   and breaking it takes as many taps as its `Hardness`. Every tap cracks the block a little more
 *   (the `Cracks` table maps a break percentage to a crack texture), and the tap that breaks it
 *   yields the loot of the block: ALWAYS its own dust (or its ultima), and sometimes Sparks.
 *   `blocksPerDay` (10) blocks per UTC day, reset at midnight UTC exactly like the daily boosters
 *   and the Mine Pick.
 *
 * THE ORDER OF THE DAY IS DETERMINISTIC
 *   The nth block of the day comes from `seedSalt` + the UTC day + the account UUID + n, through the
 *   very same seeded generator as the Mine Pick board. Two accounts never share a sequence, the
 *   sequence is the same all day, and a reload therefore resumes the exact block that was being
 *   mined - which is why only the number of taps already landed (`clicks`) is persisted, never the
 *   block itself: the block is derived, the progress is stored. Only the LOOT is rolled live.
 *
 * WHAT IS PERSISTED (`user_state["mining"]`)
 *   `lastResetDay` / `minedToday` : the daily allowance, resolved on the fly exactly like the
 *                                   booster quota (a stored day older than the trusted one reads as
 *                                   a fresh day; a day in the FUTURE, i.e. a tampered state, is not
 *                                   reset either);
 *   `clicks`                      : taps already landed on the block of the moment;
 *   `resources`                   : how much of each resource was harvested (`stone_dust`, …);
 *   `blocksMined`                 : the dedicated statistics block - one counter PER BLOCK KIND;
 *   `totalMined` / `sparksFound`  : how many blocks were broken and how many Sparks they gave since
 *                                   the account was created.
 *
 * A broken block is committed in ONE transaction (the mining state and the Sparks balance, both in
 * `user_state`), so a failure can never consume the tap without granting the loot. The daily
 * allowance and the resources are announced through `MINING_UPDATED`, the Sparks through
 * `SPARKS_UPDATED` (which the header already listens to).
 */

import { storageRepository, STORES } from '../models/StorageRepository.js';
import { configLoader } from '../utils/ConfigLoader.js';
import eventBus, { EVENTS } from '../utils/EventBus.js';
import dateSyncManager from './DateSyncManager.js';
import accountManager, { USER_STATE_KEYS } from './AccountManager.js';
import sparksManager from './SparksManager.js';
// The seeded generator of the Mine Pick is reused as is: both features draw a DETERMINISTIC daily
// sequence from the same material (salt + UTC day + account UUID), and sharing the two tiny pure
// functions is what keeps them from drifting apart.
import { createSeededRandom, hashSeed } from './MinePickManager.js';

/** Resource slug of the Sparks (the currency is one of the rewards of the mine). */
export const SPARKS_RESOURCE = 'sparks';

/** Directory of the block textures (`<kind>.webp`). */
export const BLOCK_TEXTURE_DIRECTORY = 'assets/img/blocks';

/** Directory of the crack textures (`<n>.png`). */
export const CRACK_TEXTURE_DIRECTORY = 'assets/img/blocks/break';

/** Directory of the resource textures (`<slug>.png`). */
export const RESOURCE_TEXTURE_DIRECTORY = 'assets/img/dusts';

/** Texture of the Sparks. */
export const SPARKS_TEXTURE = 'assets/img/sparks.png';

/** Directory of the mining sounds (`<blockId>.mine.mp3` / `<blockId>.break.mp3`). */
export const BLOCK_SOUND_DIRECTORY = 'assets/sound/blocks';

/** Error codes raised by this manager. */
export const MINING_ERRORS = Object.freeze({
  NO_BLOCK: 'NO_BLOCK',
  NO_BLOCK_CONFIGURED: 'NO_BLOCK_CONFIGURED',
});

/** i18n keys of the error codes, so a view never invents its own message. */
const ERROR_MESSAGE_KEYS = Object.freeze({
  [MINING_ERRORS.NO_BLOCK]: 'mineblock.error.empty',
  [MINING_ERRORS.NO_BLOCK_CONFIGURED]: 'mineblock.error.load',
});

/**
 * Returns the i18n key describing a mining error code.
 *
 * @param {unknown} code - Error code (`MINING_ERRORS`).
 * @returns {string} The translation key, falling back to the generic one.
 */
export function getMiningErrorMessageKey(code) {
  return ERROR_MESSAGE_KEYS[code] ?? 'mineblock.error.mine';
}

/**
 * Turns a reward type into a stable resource slug.
 *
 * `"Stone Dust"` -> `"stone_dust"`, which is both the key stored in the save and the name of the
 * texture (`assets/img/dusts/stone_dust.png`) and of the translation key
 * (`mineblock.resource.stone_dust`), so a resource added to `settings/mining.json` only needs its
 * picture (the label falls back to the raw type when the translation is missing).
 *
 * @param {unknown} type - Reward type read from the configuration.
 * @returns {string} The slug (empty when the type is unusable).
 */
export function resourceSlug(type) {
  if (typeof type !== 'string') return '';
  return type
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Raised by every refused mining operation, with a stable `code`. */
export class MiningError extends Error {
  /**
   * @param {string} code - One of `MINING_ERRORS`.
   * @param {string} message - Technical message (the UI shows a translated one).
   */
  constructor(code, message) {
    super(message);
    this.name = 'MiningError';
    this.code = code;
  }
}

export class MiningManager {
  constructor() {
    /** @type {{configPath: string, blocksPerDay: number, seedSalt: string}|null} Mine settings. */
    this.settings = null;
    /** @type {Array<object>} Block kinds, in the order of the configuration file. */
    this.blocks = [];
    /** @type {Map<string, object>} Block kinds, keyed by id. */
    this.blocksById = new Map();
    /** @type {Array<{min: number, max: number, texture: string|null}>} Crack table, by percent. */
    this.cracks = [];
    /** @type {Promise<void>|null} In-flight rules load, to de-duplicate concurrent calls. */
    this.rulesPromise = null;
    /** @type {string} Account UUID seeding the order of the day (read once by `init()`). */
    this.uuid = '';
  }

  /**
   * Logs with the manager prefix.
   *
   * @param {...unknown} args - Values forwarded to `console.info`.
   * @returns {void}
   */
  log(...args) {
    console.info('[MiningManager]', ...args);
  }

  /**
   * Loads the mine settings and the block rules.
   *
   * @param {object} [options] - Load options.
   * @param {boolean} [options.force=false] - Reload even when already initialized.
   * @returns {Promise<void>} Resolves once the manager is usable.
   * @throws {MiningError} When the rules declare no usable block.
   * @throws {Error} When `config.json` or `settings/mining.json` cannot be read.
   */
  async init({ force = false } = {}) {
    if (this.settings && !force) return;
    if (this.rulesPromise && !force) return this.rulesPromise;

    this.rulesPromise = this.loadRules(force);
    try {
      await this.rulesPromise;
    } finally {
      this.rulesPromise = null;
    }
  }

  /**
   * Performs the fetch, parse and normalize steps of `init()`.
   *
   * @param {boolean} force - When true, the browser HTTP cache is bypassed.
   * @returns {Promise<void>} Resolves once the rules are in memory.
   * @throws {MiningError} When the rules declare no usable block.
   * @throws {Error} When a file cannot be read.
   */
  async loadRules(force) {
    this.settings = await configLoader.getMiningSettings();
    this.uuid = (await accountManager.getUuid()) ?? '';
    const raw = await MiningManager.fetchJson(this.settings.configPath, force);

    this.cracks = MiningManager.normalizeCracks(raw?.Cracks);
    this.blocks = MiningManager.normalizeBlocks(raw?.Blocks);
    this.blocksById = new Map(this.blocks.map((block) => [block.id, block]));

    if (this.blocks.length === 0) {
      throw new MiningError(
        MINING_ERRORS.NO_BLOCK_CONFIGURED,
        `"${this.settings.configPath}" declares no usable block.`
      );
    }
    this.log(
      `Ready (${this.blocks.length} block kind(s), ${this.settings.blocksPerDay} block(s) a day).`
    );
  }

  /**
   * Fetches and parses a JSON file shipped with the application.
   *
   * @param {string} path - Path relative to the application root (without `./`).
   * @param {boolean} [force=false] - Bypass the browser HTTP cache.
   * @returns {Promise<object>} The parsed payload.
   * @throws {Error} When the request fails, the status is not 2xx or the payload is not valid JSON.
   */
  static async fetchJson(path, force = false) {
    const normalized = String(path).replace(/^\.\//, '');
    let response;
    try {
      response = await fetch(normalized, { cache: force ? 'no-store' : 'default' });
    } catch (error) {
      throw new Error(`Unable to fetch "${normalized}".`, { cause: error });
    }
    if (!response.ok) {
      throw new Error(`Unable to fetch "${normalized}" (HTTP ${response.status}).`);
    }
    try {
      return await response.json();
    } catch (error) {
      throw new Error(`"${normalized}" is not valid JSON.`, { cause: error });
    }
  }

  /**
   * Normalizes the `Blocks` section of `settings/mining.json`.
   *
   * The texture and the two sounds of a block are DERIVED from its id (`material.stone` ->
   * `assets/img/blocks/stone.webp`, `assets/sound/blocks/material.stone.mine.mp3`), which is how the
   * shipped assets are named; a block may still declare its own `Texture` to override the picture.
   *
   * The id is read from `ID` (the spelling of `settings/mining.json`) and, as a convenience, from
   * `id`: the two are the same field, and refusing one of them would silently empty the mine.
   *
   * @param {unknown} raw - Raw `Blocks` array.
   * @returns {Array<object>} The usable blocks, in declaration order.
   */
  static normalizeBlocks(raw) {
    if (!Array.isArray(raw)) return [];

    return raw
      .map((entry) => {
        if (!entry) return null;
        const rawId = entry.ID ?? entry.id;
        if (typeof rawId !== 'string' || rawId.trim() === '') return null;
        return { entry, id: rawId.trim() };
      })
      .filter((entry) => entry !== null)
      .map(({ entry, id }) => {
        const shortName = id.split('.').pop();
        const nameFR = MiningManager.normalizeName(entry.Name_FR) ?? MiningManager.normalizeName(entry.Name_EN) ?? id;
        const nameEN = MiningManager.normalizeName(entry.Name_EN) ?? nameFR;

        return {
          id,
          names: Object.freeze({ fr: nameFR, en: nameEN }),
          weight: MiningManager.normalizePositiveNumber(entry.Weight, 1),
          hardness: Math.max(1, Math.round(MiningManager.normalizePositiveNumber(entry.Hardness, 1))),
          texture:
            MiningManager.normalizeAssetPath(entry.Texture) ??
            `${BLOCK_TEXTURE_DIRECTORY}/${shortName}.webp`,
          sounds: Object.freeze({
            mine: `${BLOCK_SOUND_DIRECTORY}/${id}.mine.mp3`,
            break: `${BLOCK_SOUND_DIRECTORY}/${id}.break.mp3`,
          }),
          rewards: MiningManager.normalizeRewards(entry.Rewards),
        };
      });
  }

  /**
   * Normalizes the `Rewards` section of one block.
   *
   * A reward without `Chance` is guaranteed (1 = 100 %), a reward without `Range` gives exactly one
   * unit: the same defaults the configuration file documents.
   *
   * @param {unknown} raw - Raw `Rewards` array.
   * @returns {Array<object>} The usable rewards, in declaration order.
   */
  static normalizeRewards(raw) {
    if (!Array.isArray(raw)) return [];

    return raw
      .map((entry) => {
        if (!entry || typeof entry.Type !== 'string') return null;
        const type = entry.Type.trim();
        const slug = resourceSlug(type);
        if (slug === '') return null;

        const chance = MiningManager.normalizeChance(entry.Chance);
        const min = Math.max(0, Math.round(MiningManager.normalizePositiveNumber(entry.Range?.Min, 1)));
        const max = Math.max(min, Math.round(MiningManager.normalizePositiveNumber(entry.Range?.Max, min)));

        return {
          type,
          slug,
          kind: slug === SPARKS_RESOURCE ? 'sparks' : 'resource',
          chance,
          min,
          max,
          texture: slug === SPARKS_RESOURCE ? SPARKS_TEXTURE : `${RESOURCE_TEXTURE_DIRECTORY}/${slug}.png`,
        };
      })
      .filter((reward) => reward !== null && reward.max > 0);
  }

  /**
   * Normalizes the `Cracks` table (a break percentage range -> a crack texture).
   *
   * @param {unknown} raw - Raw `Cracks` array.
   * @returns {Array<{min: number, max: number, texture: string|null}>} The table, sorted by `min`.
   */
  static normalizeCracks(raw) {
    if (!Array.isArray(raw)) return [];

    return raw
      .map((entry) => {
        if (!entry) return null;
        const min = Number(entry.Range?.Min);
        const max = Number(entry.Range?.Max);
        if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
        return {
          min: Math.max(0, Math.min(100, Math.round(min))),
          max: Math.max(0, Math.min(100, Math.round(max))),
          texture: MiningManager.normalizeAssetPath(entry.Texture),
        };
      })
      .filter((crack) => crack !== null)
      .sort((left, right) => left.min - right.min);
  }

  /**
   * Normalizes a name read from the configuration.
   *
   * @param {unknown} value - Raw name.
   * @returns {string|null} The trimmed name, or null when unusable.
   */
  static normalizeName(value) {
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
  }

  /**
   * Normalizes a relative asset path (a leading `./` is dropped).
   *
   * @param {unknown} value - Raw path.
   * @returns {string|null} The normalized path, or null when absent.
   */
  static normalizeAssetPath(value) {
    if (typeof value !== 'string' || value.trim() === '') return null;
    return value.trim().replace(/^\.\//, '');
  }

  /**
   * Normalizes a strictly positive number.
   *
   * @param {unknown} value - Raw value.
   * @param {number} fallback - Value used when the raw one is unusable.
   * @returns {number} A positive number.
   */
  static normalizePositiveNumber(value, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return fallback;
    return number;
  }

  /**
   * Normalizes a probability.
   *
   * @param {unknown} value - Raw chance (absent means "guaranteed", as the configuration documents).
   * @returns {number} A probability in [0, 1].
   */
  static normalizeChance(value) {
    if (value === null || value === undefined || value === '') return 1;
    const number = Number(value);
    if (!Number.isFinite(number)) return 1;
    return Math.min(Math.max(number, 0), 1);
  }

  /**
   * Returns a random number in [0, 1).
   *
   * The order of the day is deterministic (see the class doc), but the LOOT is rolled live: this is
   * a plain uniform draw, seeded by the platform CSPRNG when there is one.
   *
   * @returns {number} A float in [0, 1).
   */
  static random() {
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const buffer = new Uint32Array(1);
      crypto.getRandomValues(buffer);
      return buffer[0] / 4294967296;
    }
    return Math.random();
  }

  /**
   * Trusted UTC day of the current allowance.
   *
   * @returns {string|null} `YYYY-MM-DD`, or null when the clock was never anchored.
   */
  getDay() {
    return dateSyncManager.getCurrentUtcDay();
  }

  /**
   * Reads and normalizes the stored state, without writing anything.
   *
   * The daily allowance is resolved on the fly: when the stored day is older than the trusted one,
   * the state is reported as a fresh day (every block available again, no tap landed) and the write
   * happens with the next tap. A stored day located in the FUTURE (tampered state) is not reset
   * either, exactly like the booster quota.
   *
   * @param {object} [options] - Read options.
   * @param {string} [options.lang='fr'] - Language used to resolve the name of the block.
   * @returns {Promise<{day: string|null, blocksPerDay: number, lastResetDay: string|null,
   *   minedToday: number, remaining: number, clicks: number, progress: number,
   *   block: object|null, resources: Record<string, number>, blocksMined: Record<string, number>,
   *   totalMined: number, sparksFound: number}>} The effective state. `block` is null once every
   *   block of the day was mined.
   * @throws {Error} When the read or the rules fail.
   */
  async getState({ lang = 'fr' } = {}) {
    await this.init();
    const { blocksPerDay } = this.settings;
    const stored = this.normalizeState(
      await storageRepository.getUserState(USER_STATE_KEYS.MINING)
    );

    const day = this.getDay();
    const rolledOver =
      Boolean(day) &&
      dateSyncManager.isTimeTrusted() &&
      stored.lastResetDay !== day &&
      !(stored.lastResetDay && stored.lastResetDay > day);

    const current = rolledOver
      ? { ...stored, lastResetDay: day, minedToday: 0, clicks: 0 }
      : stored;

    const remaining = Math.max(0, blocksPerDay - current.minedToday);
    const block = remaining > 0 ? this.getBlockForIndex(current.minedToday) : null;
    // The number of taps landed is clamped to one short of the hardness: a hand-edited save can make
    // a block easier to break, never a block that breaks without being touched.
    const clicks = block ? Math.min(current.clicks, block.hardness - 1) : 0;

    return {
      day,
      blocksPerDay,
      lastResetDay: current.lastResetDay,
      minedToday: current.minedToday,
      remaining,
      clicks,
      progress: block ? MiningManager.percentOf(clicks, block.hardness) : 0,
      block: block ? this.describe(block, lang) : null,
      resources: current.resources,
      blocksMined: current.blocksMined,
      totalMined: current.totalMined,
      sparksFound: current.sparksFound,
    };
  }

  /**
   * Normalizes a raw stored state.
   *
   * Anything absent, negative or malformed is read as its default, so an imported save from a
   * version without the mine (or a hand-edited one) starts empty instead of throwing.
   *
   * @param {unknown} raw - Value read from `user_state["mining"]`.
   * @returns {{lastResetDay: string|null, minedToday: number, clicks: number,
   *   resources: Record<string, number>, blocksMined: Record<string, number>, totalMined: number,
   *   sparksFound: number}} The normalized state.
   */
  normalizeState(raw) {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    return {
      lastResetDay: /^\d{4}-\d{2}-\d{2}$/.test(source.lastResetDay) ? source.lastResetDay : null,
      minedToday: MiningManager.normalizeCounter(source.minedToday),
      clicks: MiningManager.normalizeCounter(source.clicks),
      resources: MiningManager.normalizeCounters(source.resources),
      blocksMined: MiningManager.normalizeCounters(source.blocksMined),
      totalMined: MiningManager.normalizeCounter(source.totalMined),
      sparksFound: MiningManager.normalizeCounter(source.sparksFound),
    };
  }

  /**
   * Normalizes a raw counter (a non-negative integer, 0 when unusable).
   *
   * @param {unknown} value - Raw value.
   * @returns {number} A non-negative integer.
   */
  static normalizeCounter(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : 0;
  }

  /**
   * Normalizes a `{ slug: count }` map.
   *
   * @param {unknown} raw - Raw map.
   * @returns {Record<string, number>} The map, without its unusable entries.
   */
  static normalizeCounters(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const map = {};
    Object.entries(raw).forEach(([key, value]) => {
      const count = MiningManager.normalizeCounter(value);
      if (count > 0) map[key] = count;
    });
    return map;
  }

  /**
   * Returns the block of the given rank of the day.
   *
   * The draw is weighted by `Weight` and seeded with the salt, the UTC day, the account UUID and the
   * rank, so it is stable all day, different for another account, and does not depend on the taps.
   *
   * @param {number} index - Rank of the block in the day (0 = the first one).
   * @returns {object|null} The block, or null when the mine has no block at all.
   */
  getBlockForIndex(index) {
    if (this.blocks.length === 0) return null;

    const material = `${this.settings?.seedSalt ?? ''}:${this.getDay() ?? 'untimed'}:${this.uuid}:${index}`;
    const random = createSeededRandom(hashSeed(material));
    const total = this.blocks.reduce((sum, block) => sum + block.weight, 0);

    let ticket = random() * total;
    for (const block of this.blocks) {
      ticket -= block.weight;
      if (ticket < 0) return block;
    }
    return this.blocks[this.blocks.length - 1];
  }

  /**
   * Breaks the percentage of a block into a crack texture.
   *
   * @param {number} percent - Progress percentage (0-100).
   * @returns {string|null} The crack texture, or null while the block shows no crack yet.
   */
  getCrackTexture(percent) {
    const value = Number(percent);
    if (!Number.isFinite(value)) return null;
    const match = this.cracks.find((crack) => value >= crack.min && value <= crack.max);
    return match?.texture ?? null;
  }

  /**
   * Percentage of a block that is broken after `clicks` taps.
   *
   * @param {number} clicks - Taps already landed.
   * @param {number} hardness - Taps needed to break the block.
   * @returns {number} A whole percentage in [0, 100].
   */
  static percentOf(clicks, hardness) {
    if (!Number.isFinite(hardness) || hardness <= 0) return 0;
    return Math.min(100, Math.max(0, Math.floor((clicks / hardness) * 100)));
  }

  /**
   * Describes a block for the UI.
   *
   * @param {object} block - Normalized block.
   * @param {string} [lang='fr'] - Language of the name.
   * @returns {{id: string, name: string, names: object, texture: string, hardness: number,
   *   sounds: {mine: string, break: string}}} The public descriptor.
   */
  describe(block, lang = 'fr') {
    return {
      id: block.id,
      name: block.names[lang] ?? block.names.en,
      names: block.names,
      texture: block.texture,
      hardness: block.hardness,
      sounds: block.sounds,
    };
  }

  /**
   * Rolls the loot of one broken block.
   *
   * @param {object} block - Normalized block.
   * @returns {Array<{kind: 'sparks'|'resource', type: string, slug: string, nameKey: string,
   *   amount: number, texture: string}>} The rewards, in declaration order (empty entries dropped).
   */
  rollRewards(block) {
    return block.rewards
      .filter((reward) => MiningManager.random() <= reward.chance)
      .map((reward) => {
        const span = reward.max - reward.min + 1;
        const amount = reward.min + Math.floor(MiningManager.random() * span);
        return {
          kind: reward.kind,
          type: reward.type,
          slug: reward.slug,
          nameKey: `mineblock.resource.${reward.slug}`,
          amount,
          texture: reward.texture,
        };
      })
      .filter((reward) => reward.amount > 0);
  }

  /**
   * Lands one tap on the block of the moment.
   *
   * A tap that does not break the block only records the progress; the tap that breaks it commits
   * the loot and moves on to the next block of the day. Both write the resolved day, so the first tap
   * after midnight UTC also performs the rollover.
   *
   * @param {object} [options] - Tap options.
   * @param {string} [options.lang='fr'] - Language used to resolve the name of the block.
   * @returns {Promise<object>} The tap result: `{ broke, block, clicks, hardness, remainingTaps,
   *   percent, crack, rewards, sparks, resources, nextBlock, minedToday, remaining, blocksMined,
   *   totalMined, sparksFound }`.
   * @throws {MiningError} With `NO_BLOCK` when every block of the day was already mined.
   * @throws {Error} When a write fails.
   */
  async mine({ lang = 'fr' } = {}) {
    await this.init();
    const state = await this.getState({ lang });
    if (!state.block) {
      throw new MiningError(
        MINING_ERRORS.NO_BLOCK,
        `Every block of the day (${state.blocksPerDay}) was already mined.`
      );
    }

    const source = this.blocksById.get(state.block.id) ?? this.blocks[0];
    const hardness = source.hardness;
    const clicks = state.clicks + 1;
    const percent = MiningManager.percentOf(clicks, hardness);
    const nextBlock =
      state.minedToday + 1 < state.blocksPerDay
        ? this.describe(this.getBlockForIndex(state.minedToday + 1), lang)
        : null;

    if (clicks < hardness) {
      await this.writeState({
        ...state,
        clicks,
      });
      eventBus.emit(EVENTS.MINING_UPDATED, {
        day: state.day,
        minedToday: state.minedToday,
        remaining: state.remaining,
        blocksPerDay: state.blocksPerDay,
        totalMined: state.totalMined,
      });
      return {
        broke: false,
        block: state.block,
        clicks,
        hardness,
        remainingTaps: hardness - clicks,
        percent,
        crack: this.getCrackTexture(percent),
        rewards: [],
        sparks: 0,
        nextBlock,
        minedToday: state.minedToday,
        remaining: state.remaining,
        resources: state.resources,
        blocksMined: state.blocksMined,
        totalMined: state.totalMined,
        sparksFound: state.sparksFound,
      };
    }

    // The block breaks: the loot is rolled, the counters move on, and everything is written in ONE
    // transaction (the mining state and the Sparks balance live in the same store).
    const rewards = this.rollRewards(source);
    const sparks = rewards
      .filter((reward) => reward.kind === 'sparks')
      .reduce((sum, reward) => sum + reward.amount, 0);

    const resources = { ...state.resources };
    rewards
      .filter((reward) => reward.kind === 'resource')
      .forEach((reward) => {
        resources[reward.slug] = (resources[reward.slug] ?? 0) + reward.amount;
      });

    const blocksMined = { ...state.blocksMined, [source.id]: (state.blocksMined[source.id] ?? 0) + 1 };
    const minedToday = state.minedToday + 1;
    const totalMined = state.totalMined + 1;
    const sparksFound = state.sparksFound + sparks;
    const nextState = {
      lastResetDay: state.day,
      minedToday,
      clicks: 0,
      resources,
      blocksMined,
      totalMined,
      sparksFound,
    };

    let balance = null;
    await storageRepository.transaction(STORES.USER_STATE, 'readwrite', async (context) => {
      await context.put(STORES.USER_STATE, nextState, USER_STATE_KEYS.MINING);
      if (sparks > 0) {
        balance = await sparksManager.addSparks(sparks, context);
      }
    });

    if (sparks > 0) {
      eventBus.emit(EVENTS.SPARKS_UPDATED, { balance });
    }
    const remaining = Math.max(0, state.blocksPerDay - minedToday);
    eventBus.emit(EVENTS.MINING_UPDATED, {
      day: state.day,
      minedToday,
      remaining,
      blocksPerDay: state.blocksPerDay,
      totalMined,
    });
    this.log(
      `"${source.id}" broken: ${rewards.map((reward) => `${reward.amount} ${reward.type}`).join(', ') || 'no reward'} (block ${minedToday}/${state.blocksPerDay}).`
    );

    return {
      broke: true,
      block: state.block,
      clicks: hardness,
      hardness,
      remainingTaps: 0,
      percent: 100,
      crack: null,
      rewards,
      sparks,
      nextBlock,
      minedToday,
      remaining,
      resources,
      blocksMined,
      totalMined,
      sparksFound,
    };
  }

  /**
   * Persists the mining state, in its own transaction.
   *
   * @param {object} state - Effective state (as returned by `getState()`).
   * @returns {Promise<void>} Resolves once the write committed.
   */
  async writeState(state) {
    await storageRepository.transaction(STORES.USER_STATE, 'readwrite', async (context) => {
      await context.put(
        STORES.USER_STATE,
        {
          lastResetDay: state.day,
          minedToday: state.minedToday,
          clicks: state.clicks,
          resources: state.resources,
          blocksMined: state.blocksMined,
          totalMined: state.totalMined,
          sparksFound: state.sparksFound,
        },
        USER_STATE_KEYS.MINING
      );
    });
  }

  /**
   * Returns the distinct resources the mine can give, in declaration order.
   *
   * The panel of the mine shows them all, even the ones never harvested yet (a stock reads as a
   * stock only when the empty lines are there), which is why they come from the CONFIGURATION and
   * not from the save. The Sparks are left out: they are the currency, the view shows their balance
   * next to the others.
   *
   * @returns {Promise<Array<{slug: string, type: string, nameKey: string, texture: string}>>} The
   *   resources.
   */
  async listResources() {
    await this.init();
    const resources = new Map();
    this.blocks.forEach((block) => {
      block.rewards.forEach((reward) => {
        if (reward.kind === 'sparks' || resources.has(reward.slug)) return;
        resources.set(reward.slug, {
          slug: reward.slug,
          type: reward.type,
          nameKey: `mineblock.resource.${reward.slug}`,
          texture: reward.texture,
        });
      });
    });
    return Array.from(resources.values());
  }

  /**
   * Returns the description of every block kind, for the statistics and the information pages.
   *
   * @param {string} [lang='fr'] - Language of the names.
   * @returns {Promise<Array<object>>} The blocks, in declaration order.
   */
  async listBlocks(lang = 'fr') {
    await this.init();
    return this.blocks.map((block) => ({
      ...this.describe(block, lang),
      resources: block.rewards.map((reward) => ({
        slug: reward.slug,
        type: reward.type,
        nameKey: `mineblock.resource.${reward.slug}`,
        texture: reward.texture,
        chance: reward.chance,
        min: reward.min,
        max: reward.max,
      })),
    }));
  }
}

/** Shared instance used by the mine view and the statistics page. */
export const miningManager = new MiningManager();

export default miningManager;

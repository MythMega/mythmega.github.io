/**
 * IllagerQuestManager - the dated quests of the Illager currencies.
 *
 * Reference: `data/illager_shop/illager_currencies.json` (each currency carries its `Quests`),
 * `js/business/IllagerShopManager.js` (the currency and its balance) and
 * `js/business/SparksManager.js` (the Sparks reward).
 *
 * WHAT THE PLAYER SEES
 *   A quest is a dated objective attached to ONE currency: reaching its requirement pays a quantity
 *   of that currency, some Sparks and some experience. The quests of a currency start on their
 *   `StartDate` and end on their own `ExpirationDate`, or on the one of the currency when the quest
 *   does not give one. A quest that is not available yet is never revealed with its requirement:
 *   the dialog only counts down to the next start.
 *
 * COUNTERS
 *   A counter starts on the first day of the quest and belongs to the quest id: a quest of a later
 *   week is a different id, so its counter starts at zero without any reset pass. The events that
 *   move a counter are the ones the rest of the app already publishes (`MINING_UPDATED`,
 *   `BOOSTER_OPENED`, `DAILY_REWARDS_UPDATED`, `CARDS_OBTAINED` from the Mine Pick) plus the four
 *   flows that had no event of their own (`CARD_SOLD`, `BINDER_SHARED`, `PROFILE_CARD_EXPORTED`).
 *   The mine counter is absolute (`totalMined`): the manager keeps the last value it saw and adds
 *   only the difference, so a reload never counts a block twice.
 *
 * A CLAIM IS ONE TRANSACTION: the currency, the Sparks, the XP and the claim mark are written
 * together, so a failure can never pay a reward without recording it (or the other way around).
 * The experience is stored here and added to the derived total of `TrophyManager`.
 */

import { storageRepository, STORES } from '../models/StorageRepository.js';
import eventBus, { EVENTS } from '../utils/EventBus.js';
import dateSyncManager from './DateSyncManager.js';
import miningManager from './MiningManager.js';
import illagerShopManager, { ILLAGER_SHOP_EVENT } from './IllagerShopManager.js';
import sparksManager, { SPARKS_SOURCES } from './SparksManager.js';
import trophyManager from './TrophyManager.js';
import { ILLAGER_QUESTS_STATE_KEY, normalizeQuestState } from './IllagerQuestState.js';

/** Objective a quest asks the player to reach. */
export const ILLAGER_QUEST_TYPES = Object.freeze({
  OPEN_BOOSTER_DAILY: 'OpenBooster_Daily',
  DAILY_REWARD_CLAIM: 'DailyRewardClaim',
  SELL_CARD: 'SellCard',
  MINE_BLOCK: 'MineBlock',
  SHARE_BINDER: 'ShareBinder',
  MINE_PICK_CARDS: 'MinePickCards',
  DOWNLOAD_PROFILE_CARD: 'DownloadProfilCard',
});

/** Name of the event published when a quest progresses or is claimed. */
export const ILLAGER_QUESTS_EVENT = 'ILLAGER_QUESTS_UPDATED';

/** Error codes raised by this manager. */
export const ILLAGER_QUEST_ERRORS = Object.freeze({
  NO_DAY: 'NO_DAY',
  UNKNOWN_QUEST: 'UNKNOWN_QUEST',
  NOT_AVAILABLE: 'NOT_AVAILABLE',
  INCOMPLETE: 'INCOMPLETE',
  ALREADY_CLAIMED: 'ALREADY_CLAIMED',
});

/** i18n keys of the error codes, so the view never invents its own message. */
const ERROR_MESSAGE_KEYS = Object.freeze({
  [ILLAGER_QUEST_ERRORS.NO_DAY]: 'mineblock.quests.error.day',
  [ILLAGER_QUEST_ERRORS.UNKNOWN_QUEST]: 'mineblock.quests.error.unknown',
  [ILLAGER_QUEST_ERRORS.NOT_AVAILABLE]: 'mineblock.quests.error.unavailable',
  [ILLAGER_QUEST_ERRORS.INCOMPLETE]: 'mineblock.quests.error.incomplete',
  [ILLAGER_QUEST_ERRORS.ALREADY_CLAIMED]: 'mineblock.quests.error.claimed',
});

/**
 * Returns the i18n key describing a quest error code.
 *
 * @param {unknown} code - Error code (`ILLAGER_QUEST_ERRORS`).
 * @returns {string} The translation key, falling back to the generic one.
 */
export function getIllagerQuestErrorMessageKey(code) {
  return ERROR_MESSAGE_KEYS[code] ?? 'mineblock.quests.error.generic';
}

/** UTC day written `YYYY-MM-DD`. */
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const QUEST_TYPE_VALUES = new Set(Object.values(ILLAGER_QUEST_TYPES));

/** Raised by every refused quest operation, with a stable `code`. */
export class IllagerQuestError extends Error {
  /**
   * @param {string} code - One of `ILLAGER_QUEST_ERRORS`.
   * @param {string} message - Technical message (the UI shows a translated one).
   */
  constructor(code, message) {
    super(message);
    this.name = 'IllagerQuestError';
    this.code = code;
  }
}

export class IllagerQuestManager {
  constructor() {
    /** @type {Array<object>|null} Quests read from the currencies. */
    this.quests = null;
    /** @type {Promise<void>|null} In-flight load, to de-duplicate concurrent calls. */
    this.initPromise = null;
    /** @type {boolean} Whether the progress listeners were attached. */
    this.started = false;
    /** @type {Array<Function>} Unsubscribers of the progress listeners. */
    this.unsubscribers = [];
  }

  /**
   * Logs with the manager prefix.
   *
   * @param {...unknown} args - Values forwarded to `console.info`.
   * @returns {void}
   */
  log(...args) {
    console.info('[IllagerQuestManager]', ...args);
  }

  /**
   * Reads and normalizes the quests of every currency once per session.
   *
   * @param {object} [options] - Load options.
   * @param {boolean} [options.force=false] - Re-read the data files even when they are cached.
   * @returns {Promise<void>} Resolves once the manager is usable.
   */
  async init({ force = false } = {}) {
    if (this.quests && !force) return;
    if (this.initPromise && !force) return this.initPromise;

    this.initPromise = (async () => {
      await illagerShopManager.init({ force });
      const quests = [];
      const seen = new Set();
      (illagerShopManager.currencies ?? []).forEach((currency) => {
        (currency.quests ?? []).forEach((raw) => {
          const quest = IllagerQuestManager.normalizeQuest(raw, currency, seen);
          if (!quest) return;
          seen.add(quest.id);
          quests.push(quest);
        });
      });
      quests.sort((left, right) => {
        if (left.start !== right.start) return left.start < right.start ? -1 : 1;
        return left.id < right.id ? -1 : 1;
      });
      this.quests = quests;
      this.log(`Ready (${quests.length} quest(s)).`);
    })();

    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  /**
   * Tells whether a value is a real UTC day.
   *
   * @param {unknown} value - Candidate.
   * @returns {boolean} True for a `YYYY-MM-DD` day that exists in the calendar.
   */
  static isDay(value) {
    if (typeof value !== 'string' || !DAY_PATTERN.test(value)) return false;
    const ms = Date.parse(`${value}T00:00:00.000Z`);
    return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
  }

  /**
   * Normalizes one quest and rejects the ones that cannot run.
   *
   * The checks are the contract of the data file: a quest with an unknown type, a negative reward,
   * a start after its end (or after the end of its currency) or a duplicate id would either never
   * be reachable or be paid twice. Such an entry is dropped with a warning, so the rest of the file
   * keeps working.
   *
   * @param {object} raw - Entry of `Quests`.
   * @param {object} currency - Normalized currency that carries it.
   * @param {Set<string>} seen - Ids already declared by the file.
   * @returns {object|null} The quest, or null when the entry is unusable.
   */
  static normalizeQuest(raw, currency, seen) {
    const id = typeof raw.ID === 'string' ? raw.ID.trim() : '';
    if (id === '') {
      console.warn('[IllagerQuestManager] A quest has no ID; it is ignored.', raw);
      return null;
    }
    if (seen.has(id)) {
      console.warn(`[IllagerQuestManager] Quest "${id}" is declared twice; the second one is ignored.`);
      return null;
    }

    const type = typeof raw.Type === 'string' ? raw.Type.trim() : '';
    if (!QUEST_TYPE_VALUES.has(type)) {
      console.warn(`[IllagerQuestManager] Quest "${id}" has an unknown type "${type}"; it is ignored.`);
      return null;
    }

    const requirement = Math.trunc(Number(raw.RequirementsToUnlock));
    if (!Number.isFinite(requirement) || requirement <= 0) {
      console.warn(`[IllagerQuestManager] Quest "${id}" has no usable requirement; it is ignored.`);
      return null;
    }

    const reward = (value) => {
      const amount = Math.trunc(Number(value));
      return Number.isFinite(amount) && amount > 0 ? amount : 0;
    };
    const rewards = {
      currency: reward(raw.RewardCurrency),
      sparks: reward(raw.RewardSparks),
      xp: reward(raw.RewardXP),
    };
    if (rewards.currency + rewards.sparks + rewards.xp === 0) {
      console.warn(`[IllagerQuestManager] Quest "${id}" grants nothing; it is ignored.`);
      return null;
    }

    const start = typeof raw.StartDate === 'string' ? raw.StartDate.trim() : '';
    if (!IllagerQuestManager.isDay(start)) {
      console.warn(`[IllagerQuestManager] Quest "${id}" has no valid StartDate; it is ignored.`, raw.StartDate);
      return null;
    }

    // The expiration of the currency is the default of the quest, and the ceiling of an explicit
    // one: a quest can never outlive the currency it pays in.
    let expiration = currency.expiration;
    if (raw.ExpirationDate !== undefined && raw.ExpirationDate !== null) {
      const declared = typeof raw.ExpirationDate === 'string' ? raw.ExpirationDate.trim() : '';
      if (IllagerQuestManager.isDay(declared)) {
        expiration = declared;
      } else {
        console.warn(
          `[IllagerQuestManager] Quest "${id}" has an invalid ExpirationDate; the currency expiration is used instead.`,
          raw.ExpirationDate
        );
      }
    }
    if (currency.expiration && expiration && expiration > currency.expiration) {
      console.warn(
        `[IllagerQuestManager] Quest "${id}" ends after its currency; it is clamped to ${currency.expiration}.`
      );
      expiration = currency.expiration;
    }
    if (currency.expiration && start > currency.expiration) {
      console.warn(`[IllagerQuestManager] Quest "${id}" starts after its currency expired; it is ignored.`);
      return null;
    }
    if (expiration && start > expiration) {
      console.warn(`[IllagerQuestManager] Quest "${id}" starts after it expires; it is ignored.`);
      return null;
    }

    return {
      id,
      type,
      typeKey: `mineblock.quests.type.${type}`,
      currencyId: currency.id,
      currencyName: currency.name,
      currencyTexture: currency.texture,
      requirement,
      start,
      expiration,
      rewards,
    };
  }

  /**
   * Tells whether a quest is available on a day (both bounds included).
   *
   * @param {object} quest - Normalized quest.
   * @param {string|null} day - UTC day.
   * @returns {boolean} True while the quest accepts progress.
   */
  isActive(quest, day) {
    if (!day || !quest) return false;
    if (day < quest.start) return false;
    return quest.expiration === null || day <= quest.expiration;
  }

  /**
   * Returns the quests available on the current day, with the progress of the player.
   *
   * @param {object} [options] - Read options.
   * @param {boolean} [options.force=false] - Re-read the data files.
   * @returns {Promise<{day: string|null, currency: object|null, balance: number, open: boolean,
   *   quests: Array<object>, nextStart: string|null}>} The quests of the moment. `open` is false
   *   when every available quest is claimed, which is the grey state of the button.
   * @throws {Error} When the save cannot be read.
   */
  async getState({ force = false } = {}) {
    await this.init({ force });
    const day = dateSyncManager.getCurrentUtcDay();
    if (day) await illagerShopManager.convertExpired(day);

    const state = normalizeQuestState(await storageRepository.getUserState(ILLAGER_QUESTS_STATE_KEY));
    const available = (this.quests ?? []).filter((quest) => this.isActive(quest, day));
    const upcoming = (this.quests ?? []).filter((quest) => day !== null && quest.start > day);

    const currencyId = (available[0] ?? upcoming[0] ?? this.quests?.[0])?.currencyId ?? null;
    const currency = currencyId ? illagerShopManager.getCurrency(currencyId) : null;
    const shop = await illagerShopManager.readState();
    const balance = currency ? shop.balances[currency.id] ?? 0 : 0;

    const quests = available
      .map((quest) => {
        const entry = state.progress[quest.id] ?? { count: 0, claimedAt: null };
        const count = Math.min(quest.requirement, Math.max(0, entry.count));
        return {
          id: quest.id,
          type: quest.type,
          typeKey: quest.typeKey,
          requirement: quest.requirement,
          count,
          percent: Math.round((count / quest.requirement) * 100),
          complete: count >= quest.requirement,
          claimed: Boolean(entry.claimedAt),
          startsOn: quest.start,
          expiresOn: quest.expiration,
          rewards: quest.rewards,
          currencyId: quest.currencyId,
        };
      })
      .sort((left, right) => {
        if (left.claimed !== right.claimed) return left.claimed ? 1 : -1;
        if (left.complete !== right.complete) return left.complete ? -1 : 1;
        return left.startsOn < right.startsOn ? -1 : 1;
      });

    return {
      day,
      currency,
      balance,
      open: quests.some((quest) => !quest.claimed),
      readyCount: quests.filter((quest) => quest.complete && !quest.claimed).length,
      quests,
      nextStart: upcoming.length > 0 ? upcoming[0].start : null,
    };
  }

  /**
   * Adds progress to every available quest of one type, inside one transaction.
   *
   * @param {string} type - One of `ILLAGER_QUEST_TYPES`.
   * @param {number} [amount=1] - Positive integer.
   * @returns {Promise<boolean>} True when at least one counter moved.
   * @throws {Error} When the write fails.
   */
  async record(type, amount = 1) {
    if (!Number.isInteger(amount) || amount <= 0) return false;
    await this.init();
    const day = dateSyncManager.getCurrentUtcDay();
    if (!day) return false;

    const relevant = (this.quests ?? []).filter(
      (quest) => quest.type === type && this.isActive(quest, day)
    );
    if (relevant.length === 0) return false;

    const outcome = await storageRepository.transaction(
      STORES.USER_STATE,
      'readwrite',
      async (context) => {
        const state = normalizeQuestState(
          await context.get(STORES.USER_STATE, ILLAGER_QUESTS_STATE_KEY)
        );
        let changed = false;
        const completed = [];
        const progress = { ...state.progress };
        relevant.forEach((quest) => {
          const entry = progress[quest.id] ?? { count: 0, claimedAt: null };
          if (entry.claimedAt) return;
          const next = Math.min(quest.requirement, entry.count + amount);
          if (next === entry.count) return;
          progress[quest.id] = { ...entry, count: next };
          changed = true;
          // Announced ONCE, on the move that reaches the requirement: the quest stays complete
          // while it waits for its claim, and must not be announced again on every later tap.
          if (next >= quest.requirement && entry.count < quest.requirement) completed.push(quest);
        });
        if (!changed) return { moved: false, completed: [] };
        await context.put(STORES.USER_STATE, { ...state, progress }, ILLAGER_QUESTS_STATE_KEY);
        return { moved: true, completed };
      }
    );

    if (outcome.moved) eventBus.emit(ILLAGER_QUESTS_EVENT, { type, amount });
    this.announceReady(outcome.completed);
    return outcome.moved;
  }

  /**
   * Turns the absolute counter of the mine into a quest delta.
   *
   * `MINING_UPDATED` carries `totalMined`, not the block that was just broken: the manager keeps the
   * last value it saw in the save and adds only the difference. A tap that does not break the block
   * carries the same total and writes nothing.
   *
   * @param {number} totalMined - `totalMined` of the mining event.
   * @returns {Promise<void>} Resolves once the delta was recorded.
   * @throws {Error} When the write fails.
   */
  async trackMinedBlocks(totalMined) {
    if (!Number.isInteger(totalMined) || totalMined < 0) return;
    await this.init();
    const day = dateSyncManager.getCurrentUtcDay();
    if (!day) return;

    const relevant = (this.quests ?? []).filter(
      (quest) => quest.type === ILLAGER_QUEST_TYPES.MINE_BLOCK && this.isActive(quest, day)
    );

    const outcome = await storageRepository.transaction(
      STORES.USER_STATE,
      'readwrite',
      async (context) => {
        const state = normalizeQuestState(
          await context.get(STORES.USER_STATE, ILLAGER_QUESTS_STATE_KEY)
        );
        const baseline = state.lastTotalMined;
        const delta = baseline === null ? 0 : Math.max(0, totalMined - baseline);
        if (delta === 0 && baseline !== null) return { moved: false, completed: [] };

        const progress = { ...state.progress };
        const completed = [];
        let changed = false;
        relevant.forEach((quest) => {
          const entry = progress[quest.id] ?? { count: 0, claimedAt: null };
          if (entry.claimedAt) return;
          const next = Math.min(quest.requirement, entry.count + delta);
          if (next === entry.count) return;
          progress[quest.id] = { ...entry, count: next };
          changed = true;
          if (next >= quest.requirement && entry.count < quest.requirement) completed.push(quest);
        });

        await context.put(
          STORES.USER_STATE,
          { ...state, progress, lastTotalMined: totalMined },
          ILLAGER_QUESTS_STATE_KEY
        );
        return { moved: changed, completed };
      }
    );

    if (outcome.moved) eventBus.emit(ILLAGER_QUESTS_EVENT, { type: ILLAGER_QUEST_TYPES.MINE_BLOCK });
    this.announceReady(outcome.completed);
  }

  /**
   * Announces the quests that just became ready for their claim.
   *
   * @param {Array<object>} quests - Quests that reached their requirement on this move.
   * @returns {void}
   */
  announceReady(quests) {
    (quests ?? []).forEach((quest) => {
      this.log(`Quest "${quest.id}" is ready to claim.`);
      eventBus.emit(EVENTS.ILLAGER_QUEST_READY, {
        questId: quest.id,
        typeKey: quest.typeKey,
        currencyId: quest.currencyId,
        currencyName: quest.currencyName,
        rewards: quest.rewards,
      });
    });
  }

  /**
   * Pays one completed quest.
   *
   * The currency, the Sparks, the experience and the claim mark are written in ONE transaction: a
   * failure can never grant a reward without marking the quest (or the other way around).
   *
   * @param {string} questId - Id of the quest.
   * @returns {Promise<{quest: object, rewards: object, balance: number, experience: number}>} What
   *   was paid.
   * @throws {IllagerQuestError} With `NO_DAY` without a trusted clock, `UNKNOWN_QUEST` for an
   *   unknown id, `NOT_AVAILABLE` outside its window, `INCOMPLETE` under its requirement and
   *   `ALREADY_CLAIMED` when it was already paid.
   * @throws {Error} When the write fails.
   */
  async claim(questId) {
    await this.init();
    const day = dateSyncManager.getCurrentUtcDay();
    if (!day) {
      throw new IllagerQuestError(ILLAGER_QUEST_ERRORS.NO_DAY, 'The trusted clock never gave a day.');
    }
    const quest = (this.quests ?? []).find((candidate) => candidate.id === questId);
    if (!quest) {
      throw new IllagerQuestError(
        ILLAGER_QUEST_ERRORS.UNKNOWN_QUEST,
        `"${questId}" is not a declared quest.`
      );
    }
    if (!this.isActive(quest, day)) {
      throw new IllagerQuestError(
        ILLAGER_QUEST_ERRORS.NOT_AVAILABLE,
        `"${questId}" is not available on ${day}.`
      );
    }

    const committed = await storageRepository.transaction(
      STORES.USER_STATE,
      'readwrite',
      async (context) => {
        const state = normalizeQuestState(
          await context.get(STORES.USER_STATE, ILLAGER_QUESTS_STATE_KEY)
        );
        const entry = state.progress[quest.id] ?? { count: 0, claimedAt: null };
        if (entry.claimedAt) {
          throw new IllagerQuestError(
            ILLAGER_QUEST_ERRORS.ALREADY_CLAIMED,
            `"${quest.id}" was already claimed.`
          );
        }
        if (entry.count < quest.requirement) {
          throw new IllagerQuestError(
            ILLAGER_QUEST_ERRORS.INCOMPLETE,
            `"${quest.id}" needs ${quest.requirement}, the player reached ${entry.count}.`
          );
        }

        if (quest.rewards.currency > 0) {
          await illagerShopManager.grantCurrency(quest.currencyId, quest.rewards.currency, context);
        }
        if (quest.rewards.sparks > 0) {
          await sparksManager.addSparks(quest.rewards.sparks, context, SPARKS_SOURCES.QUEST);
        }

        const experience = state.experience + quest.rewards.xp;
        await context.put(
          STORES.USER_STATE,
          {
            ...state,
            experience,
            progress: {
              ...state.progress,
              [quest.id]: { count: entry.count, claimedAt: new Date().toISOString() },
            },
          },
          ILLAGER_QUESTS_STATE_KEY
        );
        return { experience };
      }
    );

    const balance = await illagerShopManager.getBalance(quest.currencyId);
    this.log(
      `Quest "${quest.id}" claimed: ${quest.rewards.currency} ${quest.currencyId}, ` +
        `${quest.rewards.sparks} Sparks, ${quest.rewards.xp} XP.`
    );
    eventBus.emit(ILLAGER_SHOP_EVENT, { currencyId: quest.currencyId, balance });
    eventBus.emit(ILLAGER_QUESTS_EVENT, { questId: quest.id, claimed: true });
    if (quest.rewards.sparks > 0) await sparksManager.publishBalance();
    if (quest.rewards.xp > 0) {
      try {
        // The experience of the profile is derived: the new quest XP only shows once the trophies
        // re-evaluate it. The notification is left to the trophy popups of the same evaluation.
        await trophyManager.evaluate({ notify: false });
      } catch (error) {
        console.warn('[IllagerQuestManager] The experience could not be refreshed.', error);
      }
    }

    return {
      quest,
      rewards: quest.rewards,
      balance,
      experience: committed.experience,
    };
  }

  /**
   * Attaches the progress listeners once.
   *
   * The manager listens instead of being called by each flow: the events already describe what
   * happened, and a quest never changes a feature it observes.
   *
   * @returns {void}
   */
  start() {
    if (this.started) return;
    this.started = true;

    const safely = (promise) => promise.catch((error) => {
      console.warn('[IllagerQuestManager] A quest counter could not be written.', error);
    });

    this.unsubscribers.push(
      eventBus.on(EVENTS.BOOSTER_OPENED, (payload) => {
        if (payload?.source !== 'daily') return;
        safely(this.record(ILLAGER_QUEST_TYPES.OPEN_BOOSTER_DAILY, 1));
      }),
      eventBus.on(EVENTS.DAILY_REWARDS_UPDATED, () =>
        safely(this.record(ILLAGER_QUEST_TYPES.DAILY_REWARD_CLAIM, 1))
      ),
      eventBus.on(EVENTS.CARD_SOLD, (payload) =>
        safely(this.record(ILLAGER_QUEST_TYPES.SELL_CARD, payload?.copies ?? 1))
      ),
      eventBus.on(EVENTS.BINDER_SHARED, () =>
        safely(this.record(ILLAGER_QUEST_TYPES.SHARE_BINDER, 1))
      ),
      eventBus.on(EVENTS.CARDS_OBTAINED, (payload) => {
        if (payload?.source !== 'minepick') return;
        const amount = Array.isArray(payload.cards) ? payload.cards.length : 1;
        safely(this.record(ILLAGER_QUEST_TYPES.MINE_PICK_CARDS, amount));
      }),
      eventBus.on(EVENTS.PROFILE_CARD_EXPORTED, () =>
        safely(this.record(ILLAGER_QUEST_TYPES.DOWNLOAD_PROFILE_CARD, 1))
      ),
      eventBus.on(EVENTS.MINING_UPDATED, (payload) => {
        if (!Number.isInteger(payload?.totalMined)) return;
        safely(this.trackMinedBlocks(payload.totalMined));
      })
    );

    // The mine counter is absolute: the first block of a fresh save must be counted, so the
    // baseline is taken NOW (before any tap) instead of on the first MINING_UPDATED, which would
    // swallow that block.
    this.initializeMiningBaseline().catch((error) => {
      console.warn('[IllagerQuestManager] The mining baseline could not be initialized.', error);
    });

    this.log('Quest progress listeners attached.');
  }

  /**
   * Stores the current `totalMined` as the baseline of the mining delta, once.
   *
   * A save written before the quests have no baseline: without this call the first block the
   * player breaks after the update would only seed the counter and never reach a quest.
   *
   * @returns {Promise<void>} Resolves once the baseline is known.
   * @throws {Error} When the mine or the save cannot be read.
   */
  async initializeMiningBaseline() {
    await this.init();
    const mining = await miningManager.getState();
    const total = Number.isInteger(mining?.totalMined) ? mining.totalMined : null;
    if (total === null) return;

    await storageRepository.transaction(
      STORES.USER_STATE,
      'readwrite',
      async (context) => {
        const state = normalizeQuestState(
          await context.get(STORES.USER_STATE, ILLAGER_QUESTS_STATE_KEY)
        );
        if (state.lastTotalMined !== null) return false;
        await context.put(
          STORES.USER_STATE,
          { ...state, lastTotalMined: total },
          ILLAGER_QUESTS_STATE_KEY
        );
        return true;
      }
    );
  }

  /**
   * Detaches the progress listeners (used by the tests and the save reset).
   *
   * @returns {void}
   */
  stop() {
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers = [];
    this.started = false;
  }

  /**
   * Drops the cached data files (the quests are rebuilt on the next read).
   *
   * @returns {void}
   */
  reset() {
    this.quests = null;
    this.initPromise = null;
  }
}

/** Shared instance used by the view and the progress listeners. */
export const illagerQuestManager = new IllagerQuestManager();

export default illagerQuestManager;

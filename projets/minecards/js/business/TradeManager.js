/**
 * TradeManager - Card exchanges between two followed players.
 *
 * Reference: `minecard.backend` (`src/tradeService.ts`, `doc/trades.md`) and
 * `sql/schema/trade-table.sql`.
 *
 * THE TWO SIDES OF A TRADE
 *   The worker owns the trade itself: its status machine, the 24 h deadline and the one-open-request
 *   rule. The browser owns what the player actually gives: the collection row, the Sparks and the
 *   Ender Eyes. This module is the bridge between the two.
 *
 * LOCAL ESCROW (`user_state["trades"].escrows`)
 *   A card, its Sparks and its Ender Eyes are removed from the local save as soon as the trade is
 *   sent, exactly like the product spec asks ("ça lui consomme temporairement la carte et les ender
 *   eye + les sparks"). The worker writes none of that, so the refund has to be decided here: when
 *   a refresh sees a closed trade (`declined`, `cancelled`, `expired`, or a withdrawn proposal)
 *   whose escrow is still stored, the card is added back and the Sparks and the Eyes credited, and
 *   the escrow entry is removed. That entry is what makes the refund idempotent: it is deleted in
 *   the same transaction that gives the resources back, so a reload can never refund twice.
 *
 * ENDER EYES
 *   The stock is local (`user_state["trades"].enderEyes`, max 5, +1 per UTC day) like every other
 *   currency of the game. Keeping it out of the worker means an exchange costs no currency query:
 *   the trade routes only authenticate the player and move the status machine. `getState()` applies
 *   the daily refill (tracked by `enderEyesDay`) before any read, and a save without a balance
 *   starts at 5.
 *
 * COST (`getTradeCost`)
 *   1 Ender Eye per rarity + rarity² Sparks, per side. Rarity 6 is never tradable, which the worker
 *   enforces with a CHECK constraint as well.
 *
 * TRADE RULES (`getRules`)
 *   Two cards are always exchanged at the SAME rarity: that rule is not configurable. On top of it,
 *   `settings/config.json` -> `trades.sameExtension` forces both cards into the same extension, and
 *   the `trade` flag of each set in `settings/cardsets.json` decides whether its cards may be
 *   exchanged at all (missing flag = allowed). A PROMO card is never tradable, whatever the
 *   configuration says: it only enters a collection through a code or a gift, so exchanging one
 *   would turn it into a free reward. The rules are read once per page, only ever offer accepted
 *   cards in the lists, and are checked again before an offer leaves the local save.
 *
 * NOTIFICATIONS
 *   `refresh()` returns the transitions it observed instead of displaying them: `app.js` and
 *   `TradeView` push them into the notification queue. The module stays free of UI imports.
 */

import storageRepository, { STORES } from '../models/StorageRepository.js';
import configLoader from '../utils/ConfigLoader.js';
import accountManager, { USER_STATE_KEYS } from './AccountManager.js';
import sparksManager, { SPARKS_SOURCES } from './SparksManager.js';
import socialManager, { SOCIAL_ERROR_CODES, SocialError } from './SocialManager.js';
import i18n from '../utils/I18n.js';
import eventBus, { EVENTS } from '../utils/EventBus.js';

/** Maximum number of Ender Eyes an account can hold. */
export const TRADE_MAX_ENDER_EYES = 5;

/** Ender Eyes granted per elapsed UTC day. */
export const TRADE_ENDER_EYES_PER_DAY = 1;

/** Rarities a trade can involve. Rarity 6 (Unique) is never tradable. */
export const TRADE_MIN_RARITY = 1;
export const TRADE_MAX_RARITY = 5;

/** Deadlines and outcomes, mirrored from the worker so the UI can explain them. */
export const TRADE_EXPIRY_HOURS = 24;

/** Every status the worker can return. */
export const TRADE_STATUSES = Object.freeze({
  PENDING: 'pending',
  PROPOSED: 'proposed',
  ACCEPTED: 'accepted',
  COMPLETED: 'completed',
  DECLINED: 'declined',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
});

/**
 * How many trade identifiers the local state remembers.
 *
 * `seen` and `claimed` only have to survive the trades the worker still returns (the active ones
 * plus the last 20 of the history): a few hundred entries is already far beyond that, and it keeps
 * the save from growing forever on a very active account.
 */
const MAX_TRACKED_TRADES = 200;

/** Statuses that gave the resources back. */
export const TRADE_REFUND_STATUSES = Object.freeze([
  TRADE_STATUSES.DECLINED,
  TRADE_STATUSES.CANCELLED,
  TRADE_STATUSES.EXPIRED,
]);

/** Error codes thrown by this module, mapped to `trade.error.*` translation keys. */
export const TRADE_ERROR_CODES = Object.freeze({
  NO_ACCOUNT: 'noAccount',
  NO_AUTH_CODE: 'noAuthCode',
  NOT_DUPLICATE: 'notDuplicate',
  NOT_ENOUGH_SPARKS: 'notEnoughSparks',
  NOT_ENOUGH_ENDER_EYES: 'notEnoughEnderEyes',
  INVALID_RARITY: 'invalidRarity',
  PROMO_NOT_TRADABLE: 'promoNotTradable',
  SET_NOT_TRADABLE: 'setNotTradable',
  SAME_EXTENSION: 'sameExtension',
  SELF: 'self',
  CONFLICT: 'conflict',
  NOT_FOUND: 'notFound',
  NETWORK: 'network',
  HTTP: 'http',
});

/** Error raised by the trade manager, with a stable code for the views. */
export class TradeError extends Error {
  /**
   * @param {string} code - One of `TRADE_ERROR_CODES`.
   * @param {string} [message] - Developer-facing detail.
   * @param {object} [details] - Optional HTTP status.
   */
  constructor(code, message = '', details = {}) {
    super(message || code);
    this.name = 'TradeError';
    this.code = code;
    this.status = Number.isInteger(details.status) ? details.status : null;
  }
}

/**
 * Resolves the translation key describing a trade failure.
 *
 * @param {unknown} error - Error thrown by this module or by `SocialManager`.
 * @returns {string} A `trade.error.*` key.
 */
export function getTradeErrorMessageKey(error) {
  if (error instanceof TradeError) return `trade.error.${error.code}`;
  if (error instanceof SocialError) {
    if (error.code === SOCIAL_ERROR_CODES.NETWORK) return 'trade.error.network';
    if (error.status === 403) return 'trade.error.auth';
    if (error.status === 404) return 'trade.error.notFound';
    if (error.status === 409) return 'trade.error.conflict';
    return 'trade.error.http';
  }
  return 'trade.error.http';
}

/**
 * Tells whether a card payload or a collection entry is a promo card.
 *
 * A collection entry carries the flag built by `CollectionManager`; a card payload received from
 * the worker only carries its extension, and a promo card's extension is its promo group
 * (`A1-Promo`), so the suffix is what both forms have in common.
 *
 * @param {object|null|undefined} card - Collection entry or card payload.
 * @returns {boolean} True for a promo card.
 */
export function isPromoCard(card) {
  if (!card || typeof card !== 'object') return false;
  if (card.promo === true) return true;
  const set = typeof card.set === 'string' ? card.set.trim() : '';
  return /-promo$/i.test(set);
}

/**
 * Cost of one side of a trade.
 *
 * @param {number} rarity - Shared rarity (1-5).
 * @returns {{sparks: number, enderEyes: number}} The cost.
 */
export function getTradeCost(rarity) {
  const value = Math.trunc(Number(rarity) || 0);
  return { sparks: value * value, enderEyes: value };
}

/**
 * Builds the empty local trade statistics.
 *
 * The statistics are NOT stored by the worker: like the draws, the sales or the Sparks, they live
 * in the player's save, so an export carries them and the worker keeps no second progression of
 * its own.
 *
 * @returns {{completed: number, cancelled: number, declined: number, expired: number,
 *   sparksSpent: number, enderEyesSpent: number, cardsGiven: number, cardsReceived: number,
 *   byRarity: Record<string, object>}} Zeroed counters.
 */
export function buildDefaultTradeStats() {
  return {
    completed: 0,
    cancelled: 0,
    declined: 0,
    expired: 0,
    sparksSpent: 0,
    enderEyesSpent: 0,
    cardsGiven: 0,
    cardsReceived: 0,
    byRarity: {},
  };
}

/**
 * Normalizes one stored counter.
 *
 * @param {unknown} value - Raw counter.
 * @returns {number} A non-negative integer.
 */
function normalizeCounter(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

/**
 * Normalizes one per-rarity statistics row.
 *
 * @param {unknown} raw - Stored row.
 * @returns {object} A complete row.
 */
function normalizeRarityStats(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    completed: normalizeCounter(source.completed),
    cancelled: normalizeCounter(source.cancelled),
    declined: normalizeCounter(source.declined),
    expired: normalizeCounter(source.expired),
    sparksSpent: normalizeCounter(source.sparksSpent),
    enderEyesSpent: normalizeCounter(source.enderEyesSpent),
    cardsGiven: normalizeCounter(source.cardsGiven),
    cardsReceived: normalizeCounter(source.cardsReceived),
  };
}

/**
 * Normalizes the stored trade statistics.
 *
 * @param {unknown} raw - Value of `user_state["trades"].stats`.
 * @returns {object} A complete statistics object.
 */
function normalizeTradeStats(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const stats = buildDefaultTradeStats();
  stats.completed = normalizeCounter(source.completed);
  stats.cancelled = normalizeCounter(source.cancelled);
  stats.declined = normalizeCounter(source.declined);
  stats.expired = normalizeCounter(source.expired);
  stats.sparksSpent = normalizeCounter(source.sparksSpent);
  stats.enderEyesSpent = normalizeCounter(source.enderEyesSpent);
  stats.cardsGiven = normalizeCounter(source.cardsGiven);
  stats.cardsReceived = normalizeCounter(source.cardsReceived);

  if (source.byRarity && typeof source.byRarity === 'object' && !Array.isArray(source.byRarity)) {
    Object.entries(source.byRarity).forEach(([rarity, row]) => {
      const value = Number(rarity);
      if (!Number.isInteger(value) || value < TRADE_MIN_RARITY || value > TRADE_MAX_RARITY) return;
      stats.byRarity[String(value)] = normalizeRarityStats(row);
    });
  }
  return stats;
}

/**
 * Reads the current UTC day (`YYYY-MM-DD`): the clock of the Ender Eyes refill.
 *
 * @returns {string} The current UTC day.
 */
function currentUtcDay() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Counts the whole UTC days between two `YYYY-MM-DD` values.
 *
 * A malformed or future origin reads as 0, so a broken save can never grant a burst of Eyes.
 *
 * @param {string} from - Earlier day.
 * @param {string} to - Later day.
 * @returns {number} A non-negative integer.
 */
function daysBetweenDays(from, to) {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.floor((end - start) / 86_400_000));
}

/**
 * Clamps an Ender Eyes balance to the stock the game allows.
 *
 * A missing value is the INITIAL stock, never zero: a player who discovers the feature sees a full
 * stock rather than a dash, and an old save without the field starts on the same footing.
 *
 * @param {unknown} value - Balance read from the save.
 * @returns {number} A balance between 0 and `TRADE_MAX_ENDER_EYES`.
 */
function normalizeEyes(value) {
  if (value === null || value === undefined || value === '') return TRADE_MAX_ENDER_EYES;
  const eyes = Number(value);
  if (!Number.isInteger(eyes) || eyes < 0) return TRADE_MAX_ENDER_EYES;
  return Math.min(TRADE_MAX_ENDER_EYES, eyes);
}

/**
 * Normalizes the stored trade state.
 *
 * @param {unknown} raw - Value of `user_state["trades"]`.
 * @returns {{enderEyes: number, enderEyesDay: string, escrows: Record<string, object>,
 *   claimed: Record<string, boolean>, seen: Record<string, string>,
 *   refused: Record<string, string>, stats: object, lastRefreshAt: number}} A writable state.
 */
function normalizeTradeState(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const escrows = {};
  if (source.escrows && typeof source.escrows === 'object' && !Array.isArray(source.escrows)) {
    Object.entries(source.escrows).forEach(([tradeId, escrow]) => {
      if (!escrow || typeof escrow !== 'object') return;
      const card = escrow.card;
      if (!card || typeof card.key !== 'string' || card.key === '') return;
      const sparks = Number(escrow.sparks);
      const eyes = Number(escrow.enderEyes);
      escrows[tradeId] = {
        role: escrow.role === 'responder' ? 'responder' : 'initiator',
        card,
        sparks: Number.isFinite(sparks) && sparks > 0 ? Math.trunc(sparks) : 0,
        enderEyes: Number.isFinite(eyes) && eyes > 0 ? Math.trunc(eyes) : 0,
        createdAt: Number.isFinite(Number(escrow.createdAt)) ? Number(escrow.createdAt) : 0,
      };
    });
  }

  const claimed = {};
  if (source.claimed && typeof source.claimed === 'object' && !Array.isArray(source.claimed)) {
    Object.entries(source.claimed).forEach(([tradeId, value]) => {
      if (value === true) claimed[tradeId] = true;
    });
  }

  const seen = {};
  if (source.seen && typeof source.seen === 'object' && !Array.isArray(source.seen)) {
    Object.entries(source.seen).forEach(([tradeId, status]) => {
      if (typeof status === 'string' && status !== '') seen[tradeId] = status;
    });
  }

  // Trades the game refused locally (see `refuseTrade`): the card received broke the rules, so the
  // trade is dead for this account whatever the worker still answers. Values are error codes.
  const refused = {};
  if (source.refused && typeof source.refused === 'object' && !Array.isArray(source.refused)) {
    Object.entries(source.refused).forEach(([tradeId, code]) => {
      if (typeof code === 'string' && code !== '') refused[tradeId] = code;
    });
  }

  return {
    enderEyes: normalizeEyes(source.enderEyes),
    enderEyesDay: typeof source.enderEyesDay === 'string' ? source.enderEyesDay : '',
    escrows,
    claimed,
    seen,
    refused,
    stats: normalizeTradeStats(source.stats),
    lastRefreshAt: Number.isFinite(Number(source.lastRefreshAt))
      ? Math.max(0, Number(source.lastRefreshAt))
      : 0,
  };
}

/**
 * Builds the default trade state.
 *
 * @returns {{enderEyes: number, enderEyesDay: string, escrows: object, claimed: object, seen: object,
 *   refused: object, stats: object, lastRefreshAt: number}} An empty state.
 */
export function buildDefaultTradeState() {
  return {
    enderEyes: TRADE_MAX_ENDER_EYES,
    enderEyesDay: '',
    escrows: {},
    claimed: {},
    seen: {},
    refused: {},
    stats: buildDefaultTradeStats(),
    lastRefreshAt: 0,
  };
}

/**
 * Builds the payload sent to the worker for a collection entry.
 *
 * The illustration is deliberately absent: card paths are remote asset URLs, and the receiver
 * resolves the artwork from its own catalogue with `card_key`. Only what the collection row needs
 * travels, so a received card is added exactly like a drawn one.
 *
 * @param {object} entry - Owned entry of `CollectionManager.getCollectionView()`.
 * @returns {{key: string, card_id: string, style: string, set: string, rarity: number,
 *   name: string}} The card payload.
 */
export function buildTradeCard(entry) {
  const card = entry?.card ?? null;
  const name =
    card && typeof card.getName === 'function'
      ? card.getName(i18n.getLang()) || entry.cardId || entry.key
      : entry?.cardId || entry?.key || '';
  return {
    key: String(entry?.key ?? ''),
    card_id: String(entry?.cardId ?? entry?.key ?? ''),
    style: String(entry?.style ?? 'classic'),
    set: String(entry?.set ?? ''),
    rarity: Math.trunc(Number(entry?.rarity) || 0),
    name: String(name).slice(0, 120),
  };
}

export class TradeManager {
  constructor() {
    /**
     * @type {{sameExtension: boolean, tradableSets: Set<string>|null}|null} Rules read from the
     *   configuration, cached for the page (`getRules`). `null` until the first read, and
     *   `tradableSets` stays `null` when the files could not be read (every extension is open).
     */
    this.rules = null;
  }

  /**
   * Logs with the manager prefix.
   *
   * @param {...unknown} args - Values forwarded to `console.info`.
   * @returns {void}
   */
  log(...args) {
    console.info('[TradeManager]', ...args);
  }

  /**
   * Creates `user_state["trades"]` when the account does not have it yet.
   *
   * @returns {Promise<void>} Resolves once the entry exists.
   */
  async ensureState() {
    const stored = await storageRepository.getUserState(USER_STATE_KEYS.TRADES);
    if (stored === null || stored === undefined) {
      await storageRepository.setUserState(USER_STATE_KEYS.TRADES, buildDefaultTradeState());
    }
  }

  /**
   * Reads the normalized local trade state.
   *
   * @returns {Promise<object>} The state.
   */
  async getState() {
    const state = normalizeTradeState(
      await storageRepository.getUserState(USER_STATE_KEYS.TRADES)
    );
    return this.applyDailyRefill(state);
  }

  /**
   * Brings the local Ender Eyes stock up to date with the UTC day.
   *
   * One Eye is granted per elapsed day, capped at `TRADE_MAX_ENDER_EYES`. The day is written even
   * when nothing was granted (a fresh save, or a refill already at the cap), so the next read does
   * not redo the work. This is the only place the stock grows.
   *
   * @param {object} state - Normalized trade state.
   * @returns {Promise<object>} The state, refilled and persisted when the day changed.
   */
  async applyDailyRefill(state) {
    const today = currentUtcDay();
    if (state.enderEyesDay === today) return state;
    const granted =
      state.enderEyesDay === ''
        ? 0
        : daysBetweenDays(state.enderEyesDay, today) * TRADE_ENDER_EYES_PER_DAY;
    const next = {
      ...state,
      enderEyesDay: today,
      enderEyes: Math.min(TRADE_MAX_ENDER_EYES, state.enderEyes + granted),
    };
    await storageRepository.setUserState(USER_STATE_KEYS.TRADES, next);
    eventBus.emit(EVENTS.TRADES_UPDATED, { balance: next.enderEyes });
    return next;
  }

  /**
   * Reads the identity and the secret code the worker expects.
   *
   * @returns {Promise<{uuid: string, authCode: string}>} The credentials.
   * @throws {TradeError} When the account or its code is missing.
   */
  async getCredentials() {
    const uuid = await accountManager.getUuid();
    if (!uuid) {
      throw new TradeError(TRADE_ERROR_CODES.NO_ACCOUNT, 'No local account exists.');
    }
    const authCode = await socialManager.getAuthCode();
    if (!authCode) {
      throw new TradeError(
        TRADE_ERROR_CODES.NO_AUTH_CODE,
        'The trainer card has never been published on this browser.'
      );
    }
    return { uuid, authCode };
  }

  /**
   * Reads the cards the player may offer: a duplicate of rarity 1-5.
   *
   * A promo card is excluded even when it is a duplicate: it only ever enters a collection through
   * a redeem code or a distribution, so trading it would turn it into a free reward for the other
   * player.
   *
   * @param {object} collectionView - Result of `CollectionManager.getCollectionView()`.
   * @returns {object[]} The tradable entries, rarest first.
   */
  static listTradableEntries(collectionView) {
    const entries = Array.isArray(collectionView?.entries) ? collectionView.entries : [];
    return entries
      .filter(
        (entry) =>
          entry &&
          entry.owned === true &&
          entry.promo !== true &&
          Number.isInteger(entry.quantity) &&
          entry.quantity >= 2 &&
          Number.isInteger(entry.rarity) &&
          entry.rarity >= TRADE_MIN_RARITY &&
          entry.rarity <= TRADE_MAX_RARITY
      )
      .sort((a, b) => b.rarity - a.rarity || String(a.cardId).localeCompare(String(b.cardId)));
  }

  /**
   * Reads the trade rules from the configuration, once per page.
   *
   * `settings/config.json` -> `trades.sameExtension` decides whether both cards must come from the
   * same extension, and the `trade` flag of every set of `settings/cardsets.json` decides whether
   * its cards may be exchanged at all. A file that cannot be read leaves every extension open and
   * the same-extension rule off: a broken configuration must never block the exchanges.
   *
   * @param {{force?: boolean}} [options] - `force` re-reads the files.
   * @returns {Promise<{sameExtension: boolean, tradableSets: Set<string>|null}>} The rules.
   */
  async getRules({ force = false } = {}) {
    if (this.rules && !force) return this.rules;
    let sameExtension = false;
    let tradableSets = null;
    try {
      const [settings, sets] = await Promise.all([
        configLoader.getTradeSettings(),
        configLoader.getCardSets(),
      ]);
      sameExtension = settings.sameExtension === true;
      tradableSets = new Set(sets.filter((set) => set.trade !== false).map((set) => set.id));
    } catch (error) {
      console.warn(
        '[TradeManager] The trade rules could not be read, every extension stays tradable.',
        error
      );
    }
    this.rules = { sameExtension, tradableSets };
    return this.rules;
  }

  /**
   * Tells whether an extension allows exchanges.
   *
   * @param {string} setId - Extension identifier of the card.
   * @param {{tradableSets: Set<string>|null}|null} [rules] - Rules already read.
   * @returns {boolean} True when the extension is tradable (or unknown to the catalogue).
   */
  isSetTradable(setId, rules = null) {
    const tradable = (rules ?? this.rules)?.tradableSets ?? null;
    if (!tradable) return true;
    const id = typeof setId === 'string' ? setId.trim() : '';
    // A card whose extension is unknown (an orphan row of an old save) stays tradable: hiding it
    // would only strand a card the player already owns.
    return id === '' ? true : tradable.has(id);
  }

  /**
   * Reads the cards the player may offer, under the current rules.
   *
   * @param {object} collectionView - Result of `CollectionManager.getCollectionView()`.
   * @param {{rarity?: number|null, set?: string|null}} [options] - `rarity` keeps one rarity (an
   *   incoming request always exchanges one rarity), `set` keeps one extension (used when
   *   `trades.sameExtension` is on).
   * @returns {Promise<object[]>} The tradable entries, rarest first.
   */
  async getTradableEntries(collectionView, { rarity = null, set = null } = {}) {
    const rules = await this.getRules();
    const target = typeof set === 'string' ? set.trim() : '';
    return TradeManager.listTradableEntries(collectionView).filter(
      (entry) =>
        !isPromoCard(entry) &&
        this.isSetTradable(entry.set, rules) &&
        (rarity === null || entry.rarity === rarity) &&
        (!rules.sameExtension || target === '' || entry.set === target)
    );
  }

  /**
   * Refuses an offer the rules forbid, before anything leaves the local save.
   *
   * This is the second line of defence: the dialogs already only list accepted cards, but an offer
   * is checked again here so no code path can exchange a promo card, a closed extension or a card
   * of another extension while `trades.sameExtension` is on.
   *
   * @param {object} entry - Collection entry offered.
   * @param {{otherSet?: string|null}} [options] - Extension of the other card, when known.
   * @returns {Promise<void>} Resolves when the offer is allowed.
   * @throws {TradeError} When the offer breaks the rules.
   */
  async assertTradable(entry, { otherSet = null } = {}) {
    if (isPromoCard(entry)) {
      throw new TradeError(
        TRADE_ERROR_CODES.PROMO_NOT_TRADABLE,
        'A promo card is never tradable.'
      );
    }
    const rules = await this.getRules();
    if (!this.isSetTradable(entry?.set, rules)) {
      throw new TradeError(
        TRADE_ERROR_CODES.SET_NOT_TRADABLE,
        `The extension "${entry?.set}" does not allow trades.`
      );
    }
    const target = typeof otherSet === 'string' ? otherSet.trim() : '';
    const own = typeof entry?.set === 'string' ? entry.set.trim() : '';
    if (rules.sameExtension && target !== '' && own !== '' && own !== target) {
      throw new TradeError(
        TRADE_ERROR_CODES.SAME_EXTENSION,
        `A trade must oppose two cards of "${target}".`
      );
    }
  }

  /**
   * Reads one trade from the worker.
   *
   * @param {{uuid: string, authCode: string}} credentials - Sender credentials.
   * @returns {Promise<object>} The worker payload.
   * @throws {SocialError} On a network error or a refused request.
   */
  async fetchTrades({ uuid, authCode }) {
    const query = `uuid=${encodeURIComponent(uuid)}&auth_code=${encodeURIComponent(authCode)}`;
    return socialManager.request(`/trades?${query}`);
  }

  /**
   * Reads the trades, refunds what the local escrow still holds, and reports what changed.
   *
   * @param {{silent?: boolean}} [options] - Refresh options. `silent` only skips the log line.
   * @returns {Promise<{ready: boolean, enderEyes: number, maxEnderEyes: number,
   *   incoming: object[], outgoing: object[], history: object[], stats: object,
   *   notifications: object[]}>} The refreshed view model.
   */
  async refresh({ silent = false } = {}) {
    let credentials;
    try {
      credentials = await this.getCredentials();
    } catch (error) {
      if (error instanceof TradeError) {
        const state = await this.getState();
        return this.buildEmptyView(state.enderEyes);
      }
      throw error;
    }

    const payload = await this.fetchTrades(credentials);
    const incoming = Array.isArray(payload?.incoming) ? payload.incoming : [];
    const outgoing = Array.isArray(payload?.outgoing) ? payload.outgoing : [];
    const history = Array.isArray(payload?.history) ? payload.history : [];
    const { notifications, state } = await this.reconcile({ incoming, outgoing, history });
    // A trade the game closed locally (its received card broke the rules) can never be claimed: it
    // leaves every list here, once, so no reader of the view model can offer it again.
    const listed = (trades) => trades.filter((trade) => !state.refused[trade?.id]);

    if (!silent) {
      this.log(
        `Trades refreshed: ${incoming.length} incoming, ${outgoing.length} outgoing, ` +
          `${state.enderEyes} Ender Eye(s).`
      );
    }

    return {
      ready: true,
      enderEyes: state.enderEyes,
      maxEnderEyes: TRADE_MAX_ENDER_EYES,
      incoming: listed(incoming),
      outgoing: listed(outgoing),
      history: listed(history),
      // The statistics are local: the worker only describes the trades themselves.
      stats: this.buildStatsView(state.stats),
      notifications,
    };
  }

  /**
   * Builds the view model of an account that cannot trade yet.
   *
   * @returns {{ready: boolean, enderEyes: number, maxEnderEyes: number, incoming: object[],
   *   outgoing: object[], history: object[], stats: null, notifications: object[]}} An empty view.
   */
  buildEmptyView(enderEyes = TRADE_MAX_ENDER_EYES) {
    return {
      ready: false,
      enderEyes,
      maxEnderEyes: TRADE_MAX_ENDER_EYES,
      incoming: [],
      outgoing: [],
      history: [],
      stats: null,
      notifications: [],
    };
  }

  /**
   * Applies the refunds the worker cannot apply, then stores what was observed.
   *
   * @param {{incoming: object[], outgoing: object[], history: object[]}} input - Worker payload.
   * @returns {Promise<{notifications: object[], state: object}>} Detected transitions and the
   *   updated local state.
   */
  async reconcile({ incoming, outgoing, history }) {
    const state = await this.getState();
    const escrows = { ...state.escrows };
    const claimed = { ...state.claimed };
    const seen = { ...state.seen };
    const notifications = [];
    const known = state.lastRefreshAt > 0;
    let eyes = state.enderEyes;
    // `getState()` returns fresh objects: the rows can be incremented in place and written back.
    const stats = state.stats;
    const trades = [...incoming, ...outgoing, ...history];

    for (const trade of trades) {
      if (!trade || typeof trade.id !== 'string') continue;
      const escrow = escrows[trade.id];

      // B withdrew their counter-proposal: the trade is back to A's request, so B's card, Sparks
      // and Eyes leave the escrow just like on a closed trade.
      const withdrawn = escrow?.role === 'responder' && trade.status === TRADE_STATUSES.PENDING;
      if (escrow && (withdrawn || TRADE_REFUND_STATUSES.includes(trade.status))) {
        // The refund runs in its own transaction and returns the balance it reached: the final
        // write below reuses it instead of re-reading a stock it could overwrite.
        eyes = (await this.refundEscrow(escrow, trade.id)) ?? eyes;
        delete escrows[trade.id];
        this.log(`Trade ${trade.id} (${trade.status}): escrow refunded.`);
      } else if (escrow && trade.status === TRADE_STATUSES.COMPLETED) {
        // The card was given, and the card received was added when the player claimed it.
        delete escrows[trade.id];
      }

      // A trade the game closed locally (its received card broke the rules) stays dead whatever the
      // worker still answers: it must never count in the statistics nor raise a notification, even
      // when the worker keeps describing it as `accepted` or turns it into `completed`.
      if (state.refused[trade.id]) {
        seen[trade.id] = trade.status;
        continue;
      }

      // Local statistics: a transition is counted once. An imported history (`previous` undefined)
      // is never replayed, and a closed trade seen again keeps its counter.
      const previous = seen[trade.id];
      if (known && previous && previous !== trade.status) {
        if (trade.status === TRADE_STATUSES.COMPLETED) {
          this.recordOutcome(stats, trade, TRADE_STATUSES.COMPLETED);
          // One event per trade: the transition is observed once, and the `TradeComplete` quest
          // then counts a finished exchange instead of every later refresh.
          eventBus.emit(EVENTS.TRADE_COMPLETED, { tradeId: trade.id });
        } else if (TRADE_REFUND_STATUSES.includes(trade.status)) {
          this.recordOutcome(stats, trade, trade.status);
        }
      }

      const notification = this.buildNotification(trade, previous, known);
      if (notification) notifications.push(notification);
      seen[trade.id] = trade.status;
    }

    const nextState = {
      ...state,
      enderEyes: eyes,
      escrows,
      claimed: TradeManager.trim(claimed),
      seen: TradeManager.trim(seen),
      refused: TradeManager.trim(state.refused),
      stats,
      lastRefreshAt: Date.now(),
    };
    await storageRepository.setUserState(USER_STATE_KEYS.TRADES, nextState);
    eventBus.emit(EVENTS.TRADES_UPDATED, { balance: nextState.enderEyes });
    return { notifications, state: nextState };
  }

  /**
   * Increments the local statistics of one finished trade.
   *
   * Only a COMPLETED trade records Sparks and Ender Eyes spent: a refunded trade gives them back,
   * so counting them would make the totals lie.
   *
   * @param {object} stats - Local statistics, mutated in place.
   * @param {object} trade - Trade view returned by the worker.
   * @param {'completed'|'cancelled'|'declined'|'expired'} outcome - Observed outcome.
   * @returns {void}
   */
  recordOutcome(stats, trade, outcome) {
    const rarity = Math.trunc(Number(trade.rarity));
    if (!Number.isInteger(rarity) || rarity < TRADE_MIN_RARITY || rarity > TRADE_MAX_RARITY) {
      return;
    }
    const completed = outcome === TRADE_STATUSES.COMPLETED;
    const sparks = completed ? Math.max(0, Math.trunc(Number(trade.sparks_cost) || 0)) : 0;
    const eyes = completed ? Math.max(0, Math.trunc(Number(trade.ender_eyes_cost) || 0)) : 0;
    const count = (row) => {
      row[outcome] += 1;
      if (!completed) return;
      row.sparksSpent += sparks;
      row.enderEyesSpent += eyes;
      row.cardsGiven += 1;
      row.cardsReceived += 1;
    };

    const key = String(rarity);
    stats.byRarity[key] ??= normalizeRarityStats({});
    count(stats.byRarity[key]);
    count(stats);
  }

  /**
   * Keeps the last `MAX_TRACKED_TRADES` entries of a trade-id map.
   *
   * @param {Record<string, unknown>} record - Insertion-ordered map keyed by trade id.
   * @returns {Record<string, unknown>} The trimmed map (the same one when it is small enough).
   */
  static trim(record) {
    const keys = Object.keys(record);
    if (keys.length <= MAX_TRACKED_TRADES) return record;
    const trimmed = {};
    keys.slice(keys.length - MAX_TRACKED_TRADES).forEach((key) => {
      trimmed[key] = record[key];
    });
    return trimmed;
  }

  /**
   * Shapes the local counters for the view (snake_case keys, like the worker used to send).
   *
   * @param {object} stats - Local statistics.
   * @returns {{totals: object, by_rarity: Record<string, object>}} The statistics view.
   */
  buildStatsView(stats) {
    const shape = (row) => ({
      completed: row.completed,
      cancelled: row.cancelled,
      declined: row.declined,
      expired: row.expired,
      sparks_spent: row.sparksSpent,
      ender_eyes_spent: row.enderEyesSpent,
      cards_given: row.cardsGiven,
      cards_received: row.cardsReceived,
    });
    const byRarity = {};
    Object.entries(stats.byRarity).forEach(([rarity, row]) => {
      byRarity[rarity] = shape(row);
    });
    return { totals: shape(stats), by_rarity: byRarity };
  }

  /**
   * Builds the notification of one status transition.
   *
   * A closed trade discovered on the very first refresh of an account is NOT announced: importing
   * a save must not replay a month of history. An incoming request always is.
   *
   * @param {object} trade - Trade view returned by the worker.
   * @param {string|undefined} previous - Status seen at the previous refresh.
   * @param {boolean} known - True when at least one refresh already happened.
   * @returns {object|null} A notification item, or null when there is nothing to announce.
   */
  buildNotification(trade, previous, known) {
    if (previous === trade.status) return null;
    const isClosed =
      TRADE_REFUND_STATUSES.includes(trade.status) || trade.status === TRADE_STATUSES.COMPLETED;
    if (!known && isClosed) return null;

    const isInitiator = trade.my_role === 'initiator';
    const other = isInitiator ? trade.responder : trade.initiator;
    const otherName = other?.username || i18n.t('profile.anonymous');
    const cardName = other?.card?.name || '';
    const base = { type: 'trade', badge: i18n.t('notif.trade.badge') };

    const localized = (titleKey, messageKey, params) => ({
      ...base,
      title: i18n.t(titleKey),
      message: i18n.t(messageKey, params),
    });

    switch (trade.status) {
      case TRADE_STATUSES.PENDING:
        return isInitiator
          ? null
          : localized('notif.trade.incoming.title', 'notif.trade.incoming.body', {
              name: otherName,
              card: cardName,
            });
      case TRADE_STATUSES.PROPOSED:
        return isInitiator
          ? localized('notif.trade.counter.title', 'notif.trade.counter.body', {
              name: otherName,
              card: cardName,
            })
          : null;
      case TRADE_STATUSES.ACCEPTED:
        return isInitiator
          ? null
          : localized('notif.trade.accepted.title', 'notif.trade.accepted.body', {
              name: otherName,
            });
      case TRADE_STATUSES.DECLINED:
        return isInitiator
          ? localized('notif.trade.declined.title', 'notif.trade.declined.body', {
              name: otherName,
              card: trade.initiator?.card?.name || '',
            })
          : null;
      case TRADE_STATUSES.CANCELLED:
        return localized('notif.trade.cancelled.title', 'notif.trade.cancelled.body', {
          name: otherName,
        });
      case TRADE_STATUSES.EXPIRED:
        return localized('notif.trade.expired.title', 'notif.trade.expired.body', {
          name: otherName,
        });
      case TRADE_STATUSES.COMPLETED:
        return localized('notif.trade.completed.title', 'notif.trade.completed.body', {
          card: isInitiator ? trade.responder?.card?.name || '' : trade.initiator?.card?.name || '',
        });
      default:
        return null;
    }
  }

  /**
   * Creates a trade request (player A).
   *
   * The stock and the price are LOCAL: a missing Eye is refused here, before any request, so a
   * player who cannot pay never consumes a card nor reaches the worker. The local card is only
   * removed once the worker accepted the trade, and a removal that fails (a stale quantity) cancels
   * the request immediately.
   *
   * @param {{responderUuid: string, entry: object}} options - Target and offered card.
   * @returns {Promise<object>} The worker payload.
   * @throws {TradeError} On an invalid rarity or a local failure.
   * @throws {SocialError} When the worker refuses the request.
   */
  async createTrade({ responderUuid, entry }) {
    if (!entry || !Number.isInteger(entry.rarity)) {
      throw new TradeError(TRADE_ERROR_CODES.INVALID_RARITY, 'The card has no usable rarity.');
    }
    if (entry.rarity < TRADE_MIN_RARITY || entry.rarity > TRADE_MAX_RARITY) {
      throw new TradeError(TRADE_ERROR_CODES.INVALID_RARITY, 'This rarity cannot be traded.');
    }
    await this.assertTradable(entry);
    const credentials = await this.getCredentials();
    const cost = getTradeCost(entry.rarity);
    if ((await this.getState()).enderEyes < cost.enderEyes) {
      throw new TradeError(TRADE_ERROR_CODES.NOT_ENOUGH_ENDER_EYES, 'Not enough Ender Eyes.');
    }
    if ((await sparksManager.getBalance()) < cost.sparks) {
      throw new TradeError(TRADE_ERROR_CODES.NOT_ENOUGH_SPARKS, 'Not enough Sparks.');
    }
    const card = buildTradeCard(entry);

    const response = await socialManager.request('/trades', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uuid: credentials.uuid,
        auth_code: credentials.authCode,
        responder_uuid: responderUuid,
        rarity: entry.rarity,
        card,
      }),
    });

    const tradeId = response?.trade?.id;
    if (typeof tradeId !== 'string' || tradeId === '') {
      throw new TradeError(TRADE_ERROR_CODES.HTTP, 'The worker did not return a trade identifier.');
    }

    let balance;
    try {
      balance = await this.lockCard(entry, {
        role: 'initiator',
        tradeId,
        sparks: cost.sparks,
        enderEyes: cost.enderEyes,
      });
    } catch (error) {
      await this.cancelTrade(tradeId, { quiet: true });
      throw error;
    }

    eventBus.emit(EVENTS.TRADES_UPDATED, { balance });
    return response;
  }

  /**
   * Publishes a proposal, replacing a previous one when B already answered.
   *
   * @param {{tradeId: string, entry: object, otherSet?: string|null}} options - Trade, offered card
   *   and the extension of the card already offered by the other player (what
   *   `trades.sameExtension` compares against).
   * @returns {Promise<object>} The worker payload.
   * @throws {TradeError} On an invalid rarity or an offer the rules forbid.
   * @throws {SocialError} When the worker refuses the proposal.
   */
  async proposeTrade({ tradeId, entry, otherSet = null }) {
    if (!entry || !Number.isInteger(entry.rarity)) {
      throw new TradeError(TRADE_ERROR_CODES.INVALID_RARITY, 'The card has no usable rarity.');
    }
    await this.assertTradable(entry, { otherSet });
    const credentials = await this.getCredentials();
    const card = buildTradeCard(entry);
    const cost = getTradeCost(entry.rarity);
    // A replaced proposal gives its Eyes back, so they count towards the new one.
    const state = await this.getState();
    const previous = state.escrows[tradeId];
    if (state.enderEyes + (Number(previous?.enderEyes) || 0) < cost.enderEyes) {
      throw new TradeError(TRADE_ERROR_CODES.NOT_ENOUGH_ENDER_EYES, 'Not enough Ender Eyes.');
    }
    if ((await sparksManager.getBalance()) + (Number(previous?.sparks) || 0) < cost.sparks) {
      throw new TradeError(TRADE_ERROR_CODES.NOT_ENOUGH_SPARKS, 'Not enough Sparks.');
    }

    const response = await socialManager.request('/trades/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uuid: credentials.uuid,
        auth_code: credentials.authCode,
        trade_id: tradeId,
        action: 'propose',
        card,
      }),
    });

    // A replaced proposal: its escrow is no longer part of the trade.
    if (previous) await this.refundEscrow(previous, tradeId);

    let balance;
    try {
      balance = await this.lockCard(entry, {
        role: 'responder',
        tradeId,
        sparks: cost.sparks,
        enderEyes: cost.enderEyes,
      });
    } catch (error) {
      await this.cancelTrade(tradeId, { quiet: true });
      throw error;
    }

    eventBus.emit(EVENTS.TRADES_UPDATED, { balance });
    return response;
  }

  /**
   * Denies an incoming request (player B).
   *
   * @param {string} tradeId - Trade to deny.
   * @returns {Promise<void>} Resolves once the worker answered.
   */
  async denyTrade(tradeId) {
    const credentials = await this.getCredentials();
    await socialManager.request('/trades/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uuid: credentials.uuid,
        auth_code: credentials.authCode,
        trade_id: tradeId,
        action: 'deny',
      }),
    });
    await this.syncAfterAction();
  }

  /**
   * Acceps B's proposal (player A).
   *
   * @param {string} tradeId - Trade to accept.
   * @returns {Promise<void>} Resolves once the worker answered.
   */
  async acceptTrade(tradeId) {
    const credentials = await this.getCredentials();
    await socialManager.request('/trades/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uuid: credentials.uuid,
        auth_code: credentials.authCode,
        trade_id: tradeId,
      }),
    });
    await this.syncAfterAction();
  }

  /**
   * Cancels a trade (player A) or withdraws a proposal (player B).
   *
   * @param {string} tradeId - Trade to cancel.
   * @param {{quiet?: boolean}} [options] - `quiet` skips the post-action refresh.
   * @returns {Promise<void>} Resolves once the worker answered.
   */
  async cancelTrade(tradeId, { quiet = false } = {}) {
    const credentials = await this.getCredentials();
    await socialManager.request('/trades/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uuid: credentials.uuid,
        auth_code: credentials.authCode,
        trade_id: tradeId,
      }),
    });
    if (!quiet) await this.syncAfterAction();
  }

  /**
   * Claims the card received in an accepted trade.
   *
   * The card is added BEFORE the claim is recorded locally: a failure therefore leaves the trade
   * claimable, and the next attempt cannot add the card twice because the worker answers the same
   * `accepted`/`completed` status without consuming anything.
   *
   * @param {object} trade - Trade view returned by the worker.
   * @returns {Promise<object>} The claimed card payload.
   */
  async claimTrade(trade) {
    if (!trade || typeof trade.id !== 'string') {
      throw new TradeError(TRADE_ERROR_CODES.NOT_FOUND, 'The trade is missing.');
    }
    const state = await this.getState();
    if (state.claimed[trade.id] === true) return null;

    const received = trade.my_role === 'initiator' ? trade.responder?.card : trade.initiator?.card;
    // The rules protect BOTH sides: a card the game forbids to trade is never added to a
    // collection, even when the other client sent it anyway. The trade is then closed and the
    // escrow refunded at once, otherwise the card, the Sparks and the Eyes would stay locked for an
    // exchange that can never be completed.
    try {
      await this.assertTradable(received);
    } catch (error) {
      await this.refuseTrade(trade, error?.code ?? TRADE_ERROR_CODES.HTTP);
      throw error;
    }

    const credentials = await this.getCredentials();
    await socialManager.request('/trades/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uuid: credentials.uuid,
        auth_code: credentials.authCode,
        trade_id: trade.id,
      }),
    });

    if (received) await this.addReceivedCard(received, trade.id);
    await this.syncAfterAction();
    return received ?? null;
  }

  /**
   * Closes a trade for BOTH players after its received card was refused, and gives its escrow back.
   *
   * The worker owns the shared death of an accepted trade: `/trades/refuse` moves it to
   * `cancelled`, a status every client refunds on its next refresh. That is what frees the OTHER
   * player: a plain cancellation is answered 409 once the trade is accepted, so their card, Sparks
   * and Eyes would otherwise stay in escrow forever.
   *
   * A worker that cannot close the trade (a side already claimed) or cannot be reached still leaves
   * the local refund to run: a player must never lose a card, its Sparks or its Eyes to a trade the
   * game will not let them receive.
   *
   * The identifier is then recorded in `refused`, which is what `refresh` filters out and what
   * `reconcile` skips: the claim button would only fail again, and the worker keeps answering
   * `accepted` forever.
   *
   * @param {object} trade - Trade whose received card was refused.
   * @param {string} reason - Error code explaining the refusal.
   * @returns {Promise<void>} Resolves once the trade is closed locally.
   */
  async refuseTrade(trade, reason) {
    try {
      await this.requestRefusal(trade.id);
    } catch (error) {
      // 409: a side already claimed the card it received, the exchange can no longer be undone.
      console.warn(`[TradeManager] Trade ${trade.id} could not be closed on the server.`, error);
    }
    const state = await this.getState();
    const escrow = state.escrows[trade.id];
    if (escrow) await this.refundEscrow(escrow, trade.id);
    const afterRefund = await this.getState();
    // Nothing else is needed: an id in `refused` is skipped by `reconcile` (no notification, no
    // statistic) and filtered out by `refresh` (no row).
    await storageRepository.setUserState(USER_STATE_KEYS.TRADES, {
      ...afterRefund,
      refused: { ...afterRefund.refused, [trade.id]: reason },
    });
    eventBus.emit(EVENTS.TRADES_UPDATED, { balance: afterRefund.enderEyes });
    await this.syncAfterAction();
  }

  /**
   * Asks the worker to close an accepted trade for both players (see `refuseTrade`).
   *
   * @param {string} tradeId - Trade whose received card was refused.
   * @returns {Promise<void>} Resolves once the worker closed the trade.
   * @throws {SocialError} When the worker refuses (409) or cannot be reached.
   */
  async requestRefusal(tradeId) {
    const credentials = await this.getCredentials();
    await socialManager.request('/trades/refuse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uuid: credentials.uuid,
        auth_code: credentials.authCode,
        trade_id: tradeId,
      }),
    });
  }

  /**
   * Refreshes right after an action, ignoring a network failure.
   *
   * The action itself already succeeded: a refresh that fails must not turn it into an error. The
   * refunds are retried by the next refresh, since the escrow is still stored.
   *
   * @returns {Promise<void>} Always resolves.
   */
  async syncAfterAction() {
    try {
      await this.refresh({ silent: true });
    } catch (error) {
      console.warn('[TradeManager] The trades could not be refreshed after the action.', error);
    }
  }

  /**
   * Removes one copy of a card and the Sparks from the local save, and records the escrow.
   *
   * @param {object} entry - Collection entry offered.
   * @param {{role: 'initiator'|'responder', tradeId: string, sparks: number, enderEyes: number}} escrow
   *   - Escrow data.
   * @returns {Promise<number>} The remaining stock of Ender Eyes.
   * @throws {TradeError} When the card is no longer a duplicate, or the Eyes are missing.
   * @throws {SparksError} When the balance does not cover the cost.
   */
  async lockCard(entry, { role, tradeId, sparks, enderEyes }) {
    const remainingEyes = await storageRepository.transaction(
      [STORES.COLLECTION, STORES.USER_STATE],
      'readwrite',
      async (context) => {
        const row = await context.get(STORES.COLLECTION, entry.key);
        if (!row || !Number.isInteger(row.quantity) || row.quantity < 2) {
          throw new TradeError(
            TRADE_ERROR_CODES.NOT_DUPLICATE,
            `"${entry.key}" is not a duplicate anymore.`
          );
        }

        const remaining = row.quantity - 1;
        if (remaining > 0) {
          await context.put(STORES.COLLECTION, { ...row, quantity: remaining });
        } else {
          await context.delete(STORES.COLLECTION, row.key);
        }

        await sparksManager.applyDelta(context, -sparks, SPARKS_SOURCES.TRADE);

        const state = normalizeTradeState(await context.get(STORES.USER_STATE, USER_STATE_KEYS.TRADES));
        const eyes = Math.max(0, Math.trunc(Number(enderEyes) || 0));
        if (state.enderEyes < eyes) {
          throw new TradeError(
            TRADE_ERROR_CODES.NOT_ENOUGH_ENDER_EYES,
            'Not enough Ender Eyes for this trade.'
          );
        }
        const remainingEyes = state.enderEyes - eyes;
        await context.put(
          STORES.USER_STATE,
          {
            ...state,
            enderEyes: remainingEyes,
            escrows: {
              ...state.escrows,
              [tradeId]: {
                role,
                card: buildTradeCard(entry),
                sparks,
                enderEyes: eyes,
                createdAt: Date.now(),
              },
            },
          },
          USER_STATE_KEYS.TRADES
        );
        return remainingEyes;
      }
    );

    // The Sparks were debited inside the transaction, where `applyDelta` cannot publish (the
    // caller owns the commit): the wallet of the header and of the inventory is republished here.
    if (sparks > 0) await sparksManager.publishBalance();
    return remainingEyes;
  }

  /**
   * Gives one copy of a card and its Sparks back, and forgets the escrow.
   *
   * The three writes (card, Sparks, escrow) share ONE transaction: a crash between them would
   * otherwise let the next refresh refund a trade that was already refunded.
   *
   * @param {object} escrow - Stored escrow entry.
   * @param {string} tradeId - Trade whose escrow must be dropped.
   * @returns {Promise<number|undefined>} The stock of Ender Eyes after the refund, or `undefined`
   *   when the escrow has no usable card.
   */
  async refundEscrow(escrow, tradeId) {
    const card = escrow?.card;
    if (!card || typeof card.key !== 'string' || card.key === '') return undefined;
    const timestamp = new Date().toISOString();
    const remainingEyes = await storageRepository.transaction(
      [STORES.COLLECTION, STORES.USER_STATE],
      'readwrite',
      async (context) => {
        const row = await context.get(STORES.COLLECTION, card.key);
        const quantity = Number.isInteger(row?.quantity) && row.quantity > 0 ? row.quantity : 0;
        await context.put(STORES.COLLECTION, {
          key: card.key,
          cardId: row?.cardId ?? card.card_id ?? card.key,
          style: row?.style ?? card.style ?? 'classic',
          set: row?.set ?? card.set ?? '',
          quantity: quantity + 1,
          firstObtainedAt: row?.firstObtainedAt ?? timestamp,
          lastObtainedAt: timestamp,
        });
        if (escrow.sparks > 0) {
          await sparksManager.addSparks(escrow.sparks, context, SPARKS_SOURCES.TRADE);
        }
        const state = normalizeTradeState(
          await context.get(STORES.USER_STATE, USER_STATE_KEYS.TRADES)
        );
        const escrows = { ...state.escrows };
        delete escrows[tradeId];
        const eyes = Math.max(0, Math.trunc(Number(escrow.enderEyes) || 0));
        await context.put(
          STORES.USER_STATE,
          {
            ...state,
            enderEyes: Math.min(TRADE_MAX_ENDER_EYES, state.enderEyes + eyes),
            escrows,
          },
          USER_STATE_KEYS.TRADES
        );
        return Math.min(TRADE_MAX_ENDER_EYES, state.enderEyes + eyes);
      }
    );

    // Returning an escrow credits its Sparks inside the transaction: publish them, like the debit
    // of `lockCard`, or the header would still show the balance of the proposal.
    if (Number(escrow.sparks) > 0) await sparksManager.publishBalance();
    return remainingEyes;
  }

  /**
   * Adds one copy of the card received in a trade and marks it claimed.
   *
   * The card, the `claimed` flag and the escrow removal share ONE transaction: a retry after a
   * partial write could otherwise add the card twice.
   *
   * @param {object} card - Card payload stored by the worker.
   * @param {string} [tradeId=''] - Trade to mark as claimed.
   * @returns {Promise<void>} Resolves once the transaction committed.
   */
  async addReceivedCard(card, tradeId = '') {
    if (!card || typeof card.key !== 'string' || card.key === '') {
      throw new TradeError(TRADE_ERROR_CODES.HTTP, 'The received card is unusable.');
    }
    if (isPromoCard(card)) {
      throw new TradeError(
        TRADE_ERROR_CODES.PROMO_NOT_TRADABLE,
        'A promo card is never tradable.'
      );
    }
    const timestamp = new Date().toISOString();
    await storageRepository.transaction(
      [STORES.COLLECTION, STORES.USER_STATE],
      'readwrite',
      async (context) => {
        const row = await context.get(STORES.COLLECTION, card.key);
        const quantity = Number.isInteger(row?.quantity) && row.quantity > 0 ? row.quantity : 0;
        await context.put(STORES.COLLECTION, {
          key: card.key,
          cardId: row?.cardId ?? card.card_id ?? card.key,
          style: row?.style ?? card.style ?? 'classic',
          set: row?.set ?? card.set ?? '',
          quantity: quantity + 1,
          firstObtainedAt: row?.firstObtainedAt ?? timestamp,
          lastObtainedAt: timestamp,
        });
        if (tradeId !== '') {
          const state = normalizeTradeState(
            await context.get(STORES.USER_STATE, USER_STATE_KEYS.TRADES)
          );
          const escrows = { ...state.escrows };
          delete escrows[tradeId];
          await context.put(
            STORES.USER_STATE,
            { ...state, escrows, claimed: { ...state.claimed, [tradeId]: true } },
            USER_STATE_KEYS.TRADES
          );
        }
      }
    );
  }
}

/** Shared manager instance. */
export const tradeManager = new TradeManager();

export default tradeManager;

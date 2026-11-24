/**
 * LikesManager - the daily "cœur", the like counts of the friends and the Sparks they pay.
 *
 * Reference: `minecard.backend` (`src/likeService.ts`, `sql/schema/05-likes.sql`,
 * `sql/schema/07-like-everyone.sql`).
 *
 * WHAT LIVES WHERE
 *   - The COUNTS and the BONUS live in the worker (`likes`: one row per liked player).
 *   - The SPARKS stay local, like every other currency of the game: the authenticated read of the
 *     counts also consumes the whole units of the bonus (4.8 -> 0.8) and returns them as an amount
 *     this module credits through `SparksManager`.
 *   - The LIKES SENT are counted by the worker (`like_daily_target`) and copied into the local
 *     statistics (`stats.likesSent`) so the `likessent` trophy and the statistics page can read them
 *     without a request.
 *
 * FOUR CALLS
 *   - `getCounts(uuids)` is the public batch read of the Follow List: counts only, no secret code,
 *     so looking at a friend never touches their bonus;
 *   - `like(targetUuid)` gives the like of the UTC day to ONE friend (one per friend per day, held
 *     by the primary key of `like_daily_target`);
 *   - `likeEveryone(uuids, { onProgress })` gives it to the whole Follow List in ONE batched request
 *     per chunk of `LIKES_BATCH_SIZE` friends, reporting its progress;
 *   - `sync()` is the authenticated read: it refreshes the count of the local player, the likes it
 *     sent, the friends it already liked today, and claims the bonus - which is why it needs the
 *     secret code. A player who never created an online account has no code: every call then fails
 *     with `NO_ACCOUNT`, and the header simply hides the widget.
 */

import socialManager from './SocialManager.js';
import accountManager, { USER_STATE_KEYS } from './AccountManager.js';
import friendshipManager from './FriendshipManager.js';
import sparksManager, { SPARKS_SOURCES } from './SparksManager.js';
import dateSyncManager from './DateSyncManager.js';
import storageRepository, { STORES } from '../models/StorageRepository.js';
import eventBus, { EVENTS } from '../utils/EventBus.js';

/** Maximum number of UUIDs one batch read may ask for (mirrors the worker). */
export const LIKES_MAX_BATCH = 100;

/** Number of entries each side of the like history asks for (mirrors the worker). */
export const LIKES_HISTORY_LIMIT = 25;

/**
 * Friends per batch like request. The worker accepts 100, but one request of 100 leaves the popup
 * frozen on 0 % until it ends: chunks of 25 make the circular progress advance for real. Five
 * requests for a hundred friends is still one request for a hundred likes instead of a hundred.
 */
export const LIKES_BATCH_SIZE = 25;

/** Error codes thrown by this manager, mapped to `social.like.error.*` translation keys. */
export const LIKES_ERROR_CODES = Object.freeze({
  NO_ACCOUNT: 'noAccount',
  ALREADY_LIKED: 'alreadyLiked',
  INVALID_TARGET: 'invalidTarget',
});

/** Error of the likes feature: `code` is stable, the message is only logged. */
export class LikesError extends Error {
  /**
   * @param {string} code - One of `LIKES_ERROR_CODES`.
   * @param {string} message - Technical description.
   * @param {object} [options] - Standard `Error` options (`cause`).
   */
  constructor(code, message, options = undefined) {
    super(message, options);
    this.name = 'LikesError';
    this.code = code;
  }
}

/**
 * Reads a non-negative integer from a worker payload.
 *
 * @param {unknown} value - Raw counter.
 * @returns {number} The counter, or 0.
 */
function readCount(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

/**
 * Cleans a list of UUIDs into the unique, non-empty strings it holds.
 *
 * @param {unknown} uuids - Candidate UUIDs.
 * @returns {string[]} The cleaned list, in its original order.
 */
function readUuidList(uuids) {
  return Array.from(
    new Set(
      (Array.isArray(uuids) ? uuids : [])
        .filter((uuid) => typeof uuid === 'string' && uuid !== '')
        .map((uuid) => uuid.trim())
        .filter((uuid) => uuid !== '')
    )
  );
}

/**
 * Normalizes one side of the like history returned by the worker.
 *
 * The worker already rounds every field; the checks here only keep a damaged answer from painting
 * a nameless row or a broken avatar.
 *
 * @param {unknown} value - `received` or `sent` of the worker payload.
 * @returns {Array<{uuid: string, username: string, profilePicture: string, rarity: number,
 *   day: string, likedAt: string}>} The entries, newest first, at most `LIKES_HISTORY_LIMIT`.
 */
function readHistoryEntries(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
    .filter((entry) => typeof entry.uuid === 'string' && entry.uuid.trim() !== '')
    .map((entry) => ({
      uuid: entry.uuid.trim(),
      username: typeof entry.username === 'string' ? entry.username.trim() : '',
      profilePicture:
        typeof entry.profile_picture_id === 'string' ? entry.profile_picture_id.trim() : '',
      rarity: Math.min(6, Math.max(1, Math.trunc(Number(entry.card_rarity) || 1))),
      day: typeof entry.day === 'string' ? entry.day : '',
      likedAt: typeof entry.liked_at === 'string' ? entry.liked_at : '',
    }))
    .slice(0, LIKES_HISTORY_LIMIT);
}

export class LikesManager {
  constructor() {
    /**
     * @type {{likes: number, sparks: number, bonus: number, likesSent: number}|null} Last
     *   successful authenticated read. `null` until one succeeds, which keeps the header hidden.
     */
    this.state = null;
    /** UTC day whose likes are stored in `likedTargets`. */
    this.likedDay = '';
    /** Friends already liked during `likedDay`. */
    this.likedTargets = new Set();
    /** True once the stored day was read: one read of the save is enough for the whole session. */
    this.likedDayLoaded = false;
  }

  /**
   * Reads the trusted UTC day, with the system date only as a last resort.
   *
   * The like of the day is a daily quota, so the same trusted clock as the other quotas is used.
   *
   * @returns {string} A `YYYY-MM-DD` day.
   */
  getUtcDay() {
    try {
      if (dateSyncManager.isTimeTrusted()) {
        const day = dateSyncManager.getCurrentUtcDay();
        if (typeof day === 'string' && day !== '') return day;
      }
    } catch (error) {
      console.warn('[LikesManager] The trusted day could not be read.', error);
    }
    return new Date().toISOString().slice(0, 10);
  }

  /**
   * Logs with the manager prefix.
   *
   * @param {...unknown} args - Values forwarded to `console.info`.
   * @returns {void}
   */
  log(...args) {
    console.info('[LikesManager]', ...args);
  }

  /**
   * Reads the day and the friends the save remembers as liked.
   *
   * A stored day that is not the current one is discarded: the quota of yesterday says nothing
   * about today.
   *
   * @returns {Promise<void>} Resolves once `likedDay` and `likedTargets` are filled.
   */
  async loadLikedDay() {
    if (this.likedDayLoaded) return;
    const today = this.getUtcDay();
    try {
      const stored = await storageRepository.getUserState(USER_STATE_KEYS.LIKES);
      const day = typeof stored?.day === 'string' ? stored.day : '';
      const targets = readUuidList(stored?.targets);
      this.likedDay = day === today ? day : '';
      this.likedTargets = new Set(day === today ? targets : []);
    } catch (error) {
      console.warn('[LikesManager] The likes of the day could not be read.', error);
      this.likedDay = '';
      this.likedTargets = new Set();
    }
    // Set last: two calls started together both read, instead of the second one trusting an empty
    // memory that the first has not filled yet.
    this.likedDayLoaded = true;
  }

  /**
   * Lists the friends already liked during the current UTC day.
   *
   * @returns {Promise<Set<string>>} Their UUIDs.
   */
  async getLikedTargets() {
    await this.loadLikedDay();
    if (this.likedDay !== this.getUtcDay()) {
      this.likedDay = '';
      this.likedTargets = new Set();
    }
    return new Set(this.likedTargets);
  }

  /**
   * Tells whether the like of the current UTC day was already given to one friend.
   *
   * The worker allows one like PER FRIEND AND PER DAY (see `likeService`): asking again for the
   * same friend could only earn a 409, so the request is not sent.
   *
   * @param {unknown} targetUuid - Friend UUID.
   * @returns {Promise<boolean>} True when that friend was already liked today.
   */
  async hasLikedToday(targetUuid) {
    const uuid = typeof targetUuid === 'string' ? targetUuid.trim() : '';
    if (uuid === '') return false;
    return (await this.getLikedTargets()).has(uuid);
  }

  /**
   * Remembers friends as liked today, in memory and in the save.
   *
   * Best effort: losing the memory only costs one request the worker refuses anyway, so a storage
   * failure never fails the like itself.
   *
   * @param {unknown} targets - UUIDs that were just liked.
   * @returns {Promise<void>} Resolves once the day is written.
   */
  async rememberLikes(targets) {
    const today = this.getUtcDay();
    // A new day starts from an empty set: yesterday's likes must not block today's buttons.
    if (this.likedDay !== today) {
      this.likedDay = today;
      this.likedTargets = new Set();
    }
    readUuidList(targets).forEach((uuid) => this.likedTargets.add(uuid));
    this.likedDayLoaded = true;
    try {
      await storageRepository.setUserState(USER_STATE_KEYS.LIKES, {
        day: this.likedDay,
        targets: [...this.likedTargets],
      });
    } catch (error) {
      console.warn('[LikesManager] The likes of the day could not be saved.', error);
    }
  }

  /**
   * Records the statistics the likes feed: `likesSent` (trophies, statistics page) and
   * `likesReceived`.
   *
   * Both are counters of the account, stored with the other statistics. `likesReceived` only ever
   * takes the highest value seen, so a read that lands late can never lower it.
   *
   * @param {{sent?: unknown, received?: unknown}} [counters] - Likes to add (`sent`) and the total
   *   received (`received`).
   * @returns {Promise<void>} Resolves once the counters are written.
   */
  async recordStats({ sent = 0, received = null } = {}) {
    const added = Math.max(0, Math.trunc(Number(sent) || 0));
    const receivedTotal = Number.isFinite(Number(received)) ? Math.max(0, Math.trunc(Number(received))) : null;
    if (added === 0 && receivedTotal === null) return;

    try {
      await storageRepository.transaction(STORES.USER_STATE, 'readwrite', async (context) => {
        const stored = await context.get(STORES.USER_STATE, USER_STATE_KEYS.STATS);
        const stats = stored && typeof stored === 'object' && !Array.isArray(stored) ? { ...stored } : {};
        const sentTotal =
          Number.isInteger(stats.likesSent) && stats.likesSent >= 0 ? stats.likesSent : 0;
        const knownReceived =
          Number.isInteger(stats.likesReceived) && stats.likesReceived >= 0 ? stats.likesReceived : 0;
        await context.put(
          STORES.USER_STATE,
          {
            ...stats,
            likesSent: sentTotal + added,
            likesReceived: receivedTotal === null ? knownReceived : Math.max(knownReceived, receivedTotal),
          },
          USER_STATE_KEYS.STATS
        );
      });
    } catch (error) {
      console.warn('[LikesManager] The likes could not be added to the statistics.', error);
    }
  }

  /**
   * Reads the identity and the secret code the worker expects.
   *
   * @returns {Promise<{uuid: string, authCode: string}>} The credentials, empty when the account
   *   was never published online (there is no code to authenticate with).
   */
  async getCredentials() {
    const uuid = await accountManager.getUuid();
    if (!uuid) return { uuid: '', authCode: '' };
    return { uuid, authCode: await socialManager.getAuthCode() };
  }

  /**
   * Reads the like counts of several players (public, no secret code).
   *
   * @param {unknown} uuids - Player UUIDs.
   * @returns {Promise<Record<string, number>>} UUID -> likes, missing players at 0.
   * @throws {SocialError} When the worker cannot be reached.
   */
  async getCounts(uuids) {
    const list = readUuidList(uuids).slice(0, LIKES_MAX_BATCH);
    if (list.length === 0) return {};

    const payload = await socialManager.request(
      `/likes?uuids=${encodeURIComponent(list.join(','))}`
    );
    const raw = payload?.likes && typeof payload.likes === 'object' ? payload.likes : {};
    const counts = {};
    list.forEach((uuid) => {
      counts[uuid] = readCount(raw[uuid]);
    });
    return counts;
  }

  /**
   * Gives the like of the UTC day to one followed player.
   *
   * @param {unknown} targetUuid - Player to like.
   * @returns {Promise<{targetUuid: string, likes: number}>} The target and its new count.
   * @throws {LikesError} With `NO_ACCOUNT` when no online account exists, `ALREADY_LIKED` when that
   *   friend already received the like of the day, `INVALID_TARGET` for a missing UUID.
   * @throws {SocialError} When the worker refuses the request.
   */
  async like(targetUuid) {
    const uuid = typeof targetUuid === 'string' ? targetUuid.trim() : '';
    if (uuid === '') {
      throw new LikesError(LIKES_ERROR_CODES.INVALID_TARGET, 'The target UUID is missing.');
    }
    // That friend already received the like of the day: asking the worker again would only earn a
    // 409, so the request is never sent.
    if (await this.hasLikedToday(uuid)) {
      throw new LikesError(
        LIKES_ERROR_CODES.ALREADY_LIKED,
        'This friend already received the like of the day.'
      );
    }
    const credentials = await this.getCredentials();
    if (!credentials.uuid || !credentials.authCode) {
      throw new LikesError(
        LIKES_ERROR_CODES.NO_ACCOUNT,
        'No online account exists for this player.'
      );
    }

    let payload;
    try {
      payload = await socialManager.request('/likes/friend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uuid: credentials.uuid,
          auth_code: credentials.authCode,
          target_uuid: uuid,
        }),
      });
    } catch (error) {
      if (error?.status === 409) {
        throw new LikesError(
          LIKES_ERROR_CODES.ALREADY_LIKED,
          'This friend already received the like of the day.',
          { cause: error }
        );
      }
      throw error;
    }

    const result = { targetUuid: uuid, likes: readCount(payload?.likes) };
    await this.rememberLikes([uuid]);
    await friendshipManager.recordLikes([{ uuid, day: this.getUtcDay() }], 'sent');
    await this.recordStats({ sent: 1 });
    this.log(`Liked ${uuid} (${result.likes} like(s)).`);
    return result;
  }

  /**
   * Gives the like of the UTC day to a whole Follow List, in batched requests.
   *
   * Only the friends this browser has not liked yet today are sent: the worker refuses the others
   * with the same answer, so asking would cost time for nothing. The count it reports is the truth
   * of the server (another browser may have liked some of them), and only the friends it accepted
   * are remembered locally.
   *
   * @param {unknown} uuids - Friends to like.
   * @param {{onProgress?: (progress: {done: number, total: number}) => void}} [options] - Progress
   *   callback, called after every chunk (and once with `0` before the first request).
   * @returns {Promise<{liked: string[], already: string[], unknown: string[], likes: Record<string,
   *   number>, requested: number}>} What the worker did.
   * @throws {LikesError} With `NO_ACCOUNT` when no online account exists.
   * @throws {SocialError} When the worker refuses a chunk.
   */
  async likeEveryone(uuids, { onProgress = null } = {}) {
    const credentials = await this.getCredentials();
    if (!credentials.uuid || !credentials.authCode) {
      throw new LikesError(
        LIKES_ERROR_CODES.NO_ACCOUNT,
        'No online account exists for this player.'
      );
    }

    const liked = new Set(await this.getLikedTargets());
    const targets = readUuidList(uuids)
      .filter((uuid) => uuid !== credentials.uuid)
      .filter((uuid) => !liked.has(uuid));
    const result = {
      liked: [],
      already: [],
      unknown: [],
      likes: {},
      requested: targets.length,
    };
    onProgress?.({ done: 0, total: targets.length });
    if (targets.length === 0) return result;

    let done = 0;
    for (let start = 0; start < targets.length; start += LIKES_BATCH_SIZE) {
      const chunk = targets.slice(start, start + LIKES_BATCH_SIZE);
      const payload = await socialManager.request('/likes/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uuid: credentials.uuid,
          auth_code: credentials.authCode,
          target_uuids: chunk,
        }),
      });

      const accepted = readUuidList(payload?.liked).filter((uuid) => chunk.includes(uuid));
      const skipped = readUuidList(payload?.already).filter((uuid) => chunk.includes(uuid));
      const missing = readUuidList(payload?.unknown).filter((uuid) => chunk.includes(uuid));
      result.liked.push(...accepted);
      result.already.push(...skipped);
      result.unknown.push(...missing);
      if (payload?.likes && typeof payload.likes === 'object') {
        Object.entries(payload.likes).forEach(([uuid, count]) => {
          result.likes[uuid] = readCount(count);
        });
      }
      // The worker is the authority on what was accepted; remembering its answer (not the chunk)
      // keeps a friend already liked by another browser out of the local memory's way.
      await this.rememberLikes([...accepted, ...skipped]);

      done = Math.min(targets.length, start + chunk.length);
      onProgress?.({ done, total: targets.length });
    }

    await friendshipManager.recordLikes(
      result.liked.map((uuid) => ({ uuid, day: this.getUtcDay() })),
      'sent'
    );
    await this.recordStats({ sent: result.liked.length });
    this.log(`Liked ${result.liked.length} friend(s) out of ${targets.length}.`);
    return result;
  }

  /**
   * Reads the last 25 likes this player RECEIVED and the last 25 likes it SENT.
   *
   * One authenticated request: the worker reads both sides of `like_daily_target` in a single
   * batch, and joins the public card of the other player so the Social page can name a liker (and
   * follow one) without a second call.
   *
   * @returns {Promise<{received: object[], sent: object[]}>} Both sides of the history.
   * @throws {LikesError} With `NO_ACCOUNT` when the account was never published online.
   * @throws {SocialError} When the worker refuses the read.
   */
  async getHistory() {
    const credentials = await this.getCredentials();
    if (!credentials.uuid || !credentials.authCode) {
      throw new LikesError(
        LIKES_ERROR_CODES.NO_ACCOUNT,
        'No online account exists for this player.'
      );
    }

    const payload = await socialManager.request(
      `/likes/history?uuid=${encodeURIComponent(credentials.uuid)}` +
        `&auth_code=${encodeURIComponent(credentials.authCode)}`
    );
    return {
      received: readHistoryEntries(payload?.received),
      sent: readHistoryEntries(payload?.sent),
    };
  }

  /**
   * Reads the local player's likes AND claims the whole units of the bonus.
   *
   * The Sparks the claim pays are credited locally, which is the only effect of the call besides
   * the count: 4.8 units of bonus become 0.8 plus 4 Sparks. The same read returns the likes the
   * player SENT and the friends already liked today, which it copies into the save and into the
   * statistics.
   *
   * @returns {Promise<{likes: number, sparks: number, bonus: number, likesSent: number}>} The
   *   count, the Sparks gained, the remaining bonus and the likes sent so far.
   * @throws {LikesError} With `NO_ACCOUNT` when the account was never published online.
   * @throws {SocialError} When the worker refuses the read.
   */
  async sync() {
    const credentials = await this.getCredentials();
    if (!credentials.uuid || !credentials.authCode) {
      throw new LikesError(
        LIKES_ERROR_CODES.NO_ACCOUNT,
        'No online account exists for this player.'
      );
    }

    const payload = await socialManager.request(
      `/likes?uuid=${encodeURIComponent(credentials.uuid)}` +
        `&auth_code=${encodeURIComponent(credentials.authCode)}`
    );

    const result = {
      likes: readCount(payload?.likes),
      sparks: readCount(payload?.sparks),
      bonus: Math.max(0, Number(payload?.bonus_from_like) || 0),
      likesSent: readCount(payload?.likes_sent),
    };

    // The bonus is the only thing this read changes on the worker side: crediting it here keeps
    // the balance local and the header (which listens to `SPARKS_UPDATED`) in sync.
    if (result.sparks > 0) {
      await sparksManager.addSparks(result.sparks, null, SPARKS_SOURCES.LIKES);
      this.log(`${result.sparks} Spark(s) claimed from the like bonus.`);
    }
    // The worker answers the truth of the day, another browser included: the friends it already
    // liked are written as is, so a second click on any of them sends nothing.
    const likedToday = readUuidList(payload?.liked_targets_today);
    this.likedDay = this.getUtcDay();
    this.likedTargets = new Set(likedToday);
    this.likedDayLoaded = true;
    await this.rememberLikes(likedToday);
    // The statistics follow the server for the likes sent: a device that reinstalled the game has
    // no local history, and the trophies must not restart at zero.
    await this.recordStats({ received: result.likes });
    await this.setSentTotal(result.likesSent);

    this.state = result;
    eventBus.emit(EVENTS.LIKES_UPDATED, result);
    return result;
  }

  /**
   * Raises the `stats.likesSent` counter to the total the worker reports.
   *
   * The counter only ever grows, so a local increment that has not been seen by the worker yet is
   * never lost by a read that lands first.
   *
   * @param {unknown} total - Likes sent according to the worker.
   * @returns {Promise<void>} Resolves once the counter is written.
   */
  async setSentTotal(total) {
    const value = Math.max(0, Math.trunc(Number(total) || 0));
    try {
      await storageRepository.transaction(STORES.USER_STATE, 'readwrite', async (context) => {
        const stored = await context.get(STORES.USER_STATE, USER_STATE_KEYS.STATS);
        const stats = stored && typeof stored === 'object' && !Array.isArray(stored) ? { ...stored } : {};
        const known = Number.isInteger(stats.likesSent) && stats.likesSent >= 0 ? stats.likesSent : 0;
        if (value <= known) return;
        await context.put(STORES.USER_STATE, { ...stats, likesSent: value }, USER_STATE_KEYS.STATS);
      });
    } catch (error) {
      console.warn('[LikesManager] The sent likes counter could not be set.', error);
    }
  }

  /**
   * Reads the last successful authenticated read, without any network call.
   *
   * The Social page uses it to know whether the like of the day is already given before offering
   * the button; `null` means the header never reached the worker.
   *
   * @returns {{likes: number, sparks: number, bonus: number, likesSent: number}|null} The state.
   */
  getLastState() {
    return this.state;
  }

  /**
   * Tells whether a code exists locally, without any network call.
   *
   * @returns {Promise<boolean>} True when the account can authenticate online.
   */
  async hasCredentials() {
    const { uuid, authCode } = await this.getCredentials();
    return uuid !== '' && authCode !== '';
  }
}

/** Shared instance used by the header and the Social page. */
export const likesManager = new LikesManager();

export default likesManager;

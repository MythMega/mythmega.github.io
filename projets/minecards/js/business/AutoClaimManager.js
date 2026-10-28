/**
 * AutoClaimManager - Automatic grants of the `AutoClaim` codes of `settings/codes.json`.
 *
 * Reference: `js/business/RedeemManager.js` (catalogue, availability, atomic grant) and
 * `settings/codes.json` (`AutoClaim` block).
 *
 * WHAT AN AUTOMATIC CODE IS
 *   A code may carry an `AutoClaim` block:
 *     "AutoClaim": {
 *       "Auto": true,
 *       "RequiredLevel": 1,
 *       "RequiredOpenBoosterStats": 3,
 *       "CustomMessage": { "FR": "…", "EN": "…" }
 *     }
 *   The rewards are then granted without the player typing anything, once, when ALL of these hold:
 *     - the trusted UTC day is inside the `Availabilities` window (same rule as a typed code);
 *     - the account reached `RequiredLevel` (player level, derived from the trophies);
 *     - the account opened at least `RequiredOpenBoosterStats` boosters.
 *   A missing/null requirement is not a requirement. The consumption is the `redeemed_codes` record
 *   written by `RedeemManager`: once granted, the code never fires again, even across reloads.
 *
 * WHEN IT RUNS
 *   - at boot (after the silent trophy evaluation, so the level is already known);
 *   - after every booster opening (`BOOSTER_OPENED`): the counter it reads is written before the
 *     event, so a requirement of "open N packs" is met on the N-th opening;
 *   - on every level change (`EXPERIENCE_UPDATED`), which covers a level gained by a card purchase,
 *     a code or a distribution as well as by an opening.
 *
 * WHY A MANAGER OF ITS OWN
 *   `RedeemManager` owns the rule of a code (availability, rewards, consumption) but knows nothing
 *   about the player. This class adds the two ACCOUNT requirements and the re-check triggers, and
 *   publishes `AUTO_CLAIM_GRANTED` so the UI can present the gift wherever the player is. It never
 *   throws at the caller: a failure is logged and the next check tries again.
 */

import eventBus, { EVENTS } from '../utils/EventBus.js';
import redeemManager, { RedeemError, REDEEM_ERROR_CODES, REDEEM_STATUSES } from './RedeemManager.js';
import trophyManager from './TrophyManager.js';
import { storageRepository, STORES } from '../models/StorageRepository.js';
import { USER_STATE_KEYS } from './AccountManager.js';

/** Reasons a check was run (kept in the logs and in the published payload). */
export const AUTO_CLAIM_REASONS = Object.freeze({
  BOOT: 'boot',
  EVENT: 'event',
  SETTINGS: 'settings',
  MANUAL: 'manual',
});

export class AutoClaimManager {
  /**
   * @param {object} [options] - Manager options.
   * @param {object} [options.redeem=redeemManager] - Code catalogue and atomic grant.
   * @param {object} [options.trophies=trophyManager] - Level source (fallback when no event was
   *   seen yet).
   */
  constructor({ redeem = redeemManager, trophies = trophyManager } = {}) {
    this.redeem = redeem;
    this.trophies = trophies;
    /** @type {boolean} True once the event subscriptions are registered. */
    this.isBound = false;
    /** @type {boolean} True while a check is running (re-entrancy guard). */
    this.isChecking = false;
    /** @type {boolean} True when an event arrived during a check: one more pass is needed. */
    this.isDirty = false;
    /** @type {ReturnType<typeof setTimeout>|null} Pending coalesced check. */
    this.scheduleTimer = null;
    /** @type {string|null} Reason attached to the pending check. */
    this.pendingReason = null;
    /** @type {number|null} Last known player level. */
    this.level = null;
    /** @type {Function[]} Unsubscribers of the subscribed events. */
    this.unsubscribers = [];
  }

  /**
   * Logs with the manager prefix.
   *
   * @param {...unknown} args - Values forwarded to `console.info`.
   * @returns {void}
   */
  log(...args) {
    console.info('[AutoClaimManager]', ...args);
  }

  /**
   * Subscribes to the re-check events and schedules the first check.
   *
   * The first check is deferred to the next task on purpose: `app.js` calls this before removing
   * the boot overlay, and the popup must not appear under it.
   *
   * @param {object} [options] - Start options.
   * @param {number|null} [options.level=null] - Level already evaluated at boot (`null` lets the
   *   manager ask the trophy manager on its first check).
   * @returns {boolean} True when the manager is armed.
   */
  start({ level = null } = {}) {
    if (Number.isInteger(level) && level > 0) this.level = level;

    if (!this.isBound) {
      this.isBound = true;
      this.unsubscribers.push(
        eventBus.on(EVENTS.BOOSTER_OPENED, () => this.schedule())
      );
      this.unsubscribers.push(
        eventBus.on(EVENTS.EXPERIENCE_UPDATED, (payload) => this.handleExperienceUpdated(payload))
      );
      this.log('Event subscriptions registered.');
    }

    this.schedule(AUTO_CLAIM_REASONS.BOOT);
    return true;
  }

  /**
   * Releases the subscriptions (a full reset or an imported save reloads the page anyway).
   *
   * @returns {void}
   */
  stop() {
    if (this.scheduleTimer !== null) {
      clearTimeout(this.scheduleTimer);
      this.scheduleTimer = null;
    }
    this.pendingReason = null;
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers = [];
    this.isBound = false;
    this.isDirty = false;
    this.level = null;
    this.log('Released.');
  }

  /**
   * Coalesces the checks triggered by the same opening (the counter event and the level event).
   *
   * @param {string} [reason=AUTO_CLAIM_REASONS.EVENT] - Why the check is scheduled; the last caller
   *   before the timer fires wins.
   * @returns {void}
   */
  schedule(reason = AUTO_CLAIM_REASONS.EVENT) {
    if (!this.isBound) return;
    this.pendingReason = reason;
    if (this.scheduleTimer !== null) return;
    this.scheduleTimer = setTimeout(() => {
      this.scheduleTimer = null;
      const reason = this.pendingReason ?? AUTO_CLAIM_REASONS.EVENT;
      this.pendingReason = null;
      void this.check({ reason });
    }, 0);
  }

  /**
   * Caches the level published by the trophy evaluation.
   *
   * @param {object} payload - `EXPERIENCE_UPDATED` payload.
   * @param {object} [payload.level] - Resolved level (`{ level, … }`).
   * @returns {void}
   */
  handleExperienceUpdated({ level } = {}) {
    if (Number.isInteger(level?.level) && level.level > 0) this.level = level.level;
    this.schedule();
  }

  /**
   * Reads the player level, falling back to a full evaluation when no event was seen yet.
   *
   * @returns {Promise<number|null>} The level, or null when it cannot be evaluated.
   */
  async resolveLevel() {
    if (Number.isInteger(this.level) && this.level > 0) return this.level;
    try {
      const summary = await this.trophies.getSummary();
      const level = summary?.level?.level;
      this.level = Number.isInteger(level) && level > 0 ? level : null;
      return this.level;
    } catch (error) {
      console.warn('[AutoClaimManager] The player level could not be evaluated.', error);
      return null;
    }
  }

  /**
   * Reads the number of boosters the account has ever opened.
   *
   * @returns {Promise<number>} The counter (0 when missing or malformed).
   */
  async readBoostersOpened() {
    try {
      const stats = await storageRepository.getItem(STORES.USER_STATE, USER_STATE_KEYS.STATS);
      return Number.isInteger(stats?.boostersOpened) && stats.boostersOpened >= 0
        ? stats.boostersOpened
        : 0;
    } catch (error) {
      console.warn('[AutoClaimManager] The booster counter could not be read.', error);
      return 0;
    }
  }

  /**
   * Tells whether a descriptor can be granted right now.
   *
   * Availability and consumption are re-checked by `RedeemManager.claimAuto()` inside its
   * transaction; they are checked here first so an expired or already used code never reaches the
   * write. The two account requirements are checked only when they are declared.
   *
   * @param {object} descriptor - Auto-claim descriptor.
   * @param {number|null} level - Player level.
   * @param {number} boostersOpened - Boosters ever opened.
   * @returns {Promise<boolean>} True when the gift can be granted.
   */
  async isEligible(descriptor, level, boostersOpened) {
    const autoClaim = descriptor?.autoClaim;
    if (!autoClaim) return false;

    if (this.redeem.checkAvailability(descriptor).status !== REDEEM_STATUSES.OK) return false;
    if (descriptor.storeKey) {
      const already = await storageRepository.getItem(STORES.REDEEMED_CODES, descriptor.storeKey);
      if (already) return false;
    }

    if (autoClaim.requiredLevel !== null && (level === null || level < autoClaim.requiredLevel)) {
      return false;
    }
    if (
      autoClaim.requiredOpenBoosterStats !== null &&
      boostersOpened < autoClaim.requiredOpenBoosterStats
    ) {
      return false;
    }
    return true;
  }

  /**
   * Grants every eligible automatic code.
   *
   * Never rejects: a storage or catalogue failure is logged and the next check simply tries again.
   * Concurrent calls are absorbed into one extra pass instead of running in parallel (the popup must
   * not open twice for the same gift).
   *
   * @param {object} [options] - Check options.
   * @param {string} [options.reason=AUTO_CLAIM_REASONS.MANUAL] - Why the check runs (logged and
   *   published).
   * @returns {Promise<Array<{message: object|null, rewards: object[], code: string|null}>>} The
   *   granted gifts, in catalogue order (empty when nothing was granted).
   */
  async check({ reason = AUTO_CLAIM_REASONS.MANUAL } = {}) {
    if (this.isChecking) {
      this.isDirty = true;
      return [];
    }
    this.isChecking = true;

    try {
      const descriptors = await this.redeem.listAutoClaims();
      if (descriptors.length === 0) return [];

      const [level, boostersOpened] = await Promise.all([
        this.resolveLevel(),
        this.readBoostersOpened(),
      ]);

      const claims = [];
      for (const descriptor of descriptors) {
        if (!(await this.isEligible(descriptor, level, boostersOpened))) continue;

        try {
          const result = await this.redeem.claimAuto(descriptor);
          claims.push({
            code: descriptor.code,
            message: descriptor.autoClaim.customMessage,
            rewards: result.rewards,
          });
          this.log(
            `Automatic code granted (${reason}): level ${level ?? 'unknown'}, ` +
              `${boostersOpened} booster(s) opened.`
          );
        } catch (error) {
          if (error instanceof RedeemError && error.code === REDEEM_ERROR_CODES.ALREADY_USED) {
            // Two checks raced: the other one wrote the record, nothing to report.
            this.log('Automatic code already granted by a concurrent check.');
            continue;
          }
          console.warn('[AutoClaimManager] An automatic code could not be granted.', error);
        }
      }

      if (claims.length > 0) {
        eventBus.emit(EVENTS.AUTO_CLAIM_GRANTED, { claims, reason });
      }
      return claims;
    } catch (error) {
      console.warn('[AutoClaimManager] The automatic codes could not be checked.', error);
      return [];
    } finally {
      this.isChecking = false;
      if (this.isDirty) {
        this.isDirty = false;
        this.schedule();
      }
    }
  }
}

/** Shared instance used by `app.js` and by the settings screen. */
export const autoClaimManager = new AutoClaimManager();

export default autoClaimManager;

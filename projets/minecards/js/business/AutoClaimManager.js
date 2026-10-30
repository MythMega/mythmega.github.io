/**
 * AutoClaimManager - Grants the automatic codes of `settings/codes.json` (`AutoClaim`).
 *
 * A code is granted without being typed once its availability window is open, the account has
 * reached `RequiredLevel` and it has opened `RequiredOpenBoosterStats` boosters. The grant and the
 * `redeemed_codes` record belong to `RedeemManager.claimAuto()`.
 *
 * Checks run at boot, after an opening and on a level change. They are held while a dialog owns
 * the screen (`hold`, `deferWhile`), so a gift never covers a booster reveal or an announcement.
 * `AUTO_CLAIM_GRANTED` is published once at least one code was granted.
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
    /** @type {Set<string>} Reasons the presentation is currently held back. */
    this.holds = new Set();
    /** @type {(() => boolean)|null} Extra condition checked before presenting a gift. */
    this.deferWhile = null;
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
   * @param {(() => boolean)|null} [options.deferWhile=null] - Returns true while the current screen
   *   must not be interrupted (the booster reveal, for instance).
   * @returns {boolean} True when the manager is armed.
   */
  start({ level = null, deferWhile = null } = {}) {
    if (Number.isInteger(level) && level > 0) this.level = level;
    if (typeof deferWhile === 'function') this.deferWhile = deferWhile;

    if (!this.isBound) {
      this.isBound = true;
      this.unsubscribers.push(
        eventBus.on(EVENTS.BOOSTER_OPENED, () => this.schedule())
      );
      this.unsubscribers.push(
        eventBus.on(EVENTS.EXPERIENCE_UPDATED, (payload) => this.handleExperienceUpdated(payload))
      );
      // The opening view announces the end of its reveal: the check held back while the pack was
      // being shown can run now, unless the summary is still on screen (`deferWhile`).
      this.unsubscribers.push(eventBus.on(EVENTS.REVEAL_FINISHED, () => this.schedule()));
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
    this.holds.clear();
    this.deferWhile = null;
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
   * Prevents a gift from being presented until the matching `release()`.
   *
   * Used by the screens that own the attention of the player (an announcement popup, for example):
   * a gift must never land on top of another dialog.
   *
   * @param {string} [reason='external'] - Who is holding the presentation back.
   * @returns {void}
   */
  hold(reason = 'external') {
    this.holds.add(reason);
  }

  /**
   * Lifts a hold and runs the check it was blocking.
   *
   * @param {string} [reason='external'] - The reason given to `hold()`.
   * @returns {void}
   */
  release(reason = 'external') {
    if (!this.holds.delete(reason)) return;
    if (this.holds.size === 0) this.schedule();
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
    if (this.holds.size > 0 || this.deferWhile?.()) {
      this.log(`Check deferred (${reason}): the player is busy elsewhere.`);
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
          if (error instanceof RedeemError && error.code === REDEEM_ERROR_CODES.CONTENT_NOT_RELEASED) {
            // The code stays pending until the set it grants is released: nothing to report yet.
            this.log('Automatic code waiting for its set to be released.');
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

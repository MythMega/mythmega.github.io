/**
 * SetAnnouncementManager - Which extensions the player has already been told about.
 *
 * A set is announced on the first load that happens after its release date, within
 * `boosters.releaseAnnouncementDays` (a player who skips the release day still gets the message).
 * Each announcement is remembered under `<setId>@<releaseDate>` in `user_state["setAnnouncements"]`:
 * the date is part of the key, so postponing a release announces it again.
 */

import boosterManager from './BoosterManager.js';
import { storageRepository } from '../models/StorageRepository.js';
import { USER_STATE_KEYS } from './AccountManager.js';

/**
 * Builds the key remembered for one announcement.
 *
 * @param {{setId: string, releaseDate: string}} set - Set description.
 * @returns {string} `<setId>@<releaseDate>`.
 */
function announcementKey(set) {
  return `${set.setId}@${set.releaseDate}`;
}

export class SetAnnouncementManager {
  /**
   * Reads the keys already announced.
   *
   * @returns {Promise<Set<string>>} The announced keys (empty when the entry is missing or broken).
   */
  async readAnnounced() {
    try {
      const stored = await storageRepository.getUserState(USER_STATE_KEYS.SET_ANNOUNCEMENTS);
      return new Set(
        Array.isArray(stored) ? stored.filter((key) => typeof key === 'string' && key !== '') : []
      );
    } catch (error) {
      console.warn('[SetAnnouncementManager] The announced extensions could not be read.', error);
      return new Set();
    }
  }

  /**
   * Lists the released extensions to announce.
   *
   * Only a set with a release date qualifies: a set without one was never "new". The window is
   * counted from the trusted UTC day, so moving the device clock forward announces nothing early.
   *
   * @returns {Promise<Array<object>>} The sets to announce, in catalogue order.
   */
  async listPending() {
    const window = boosterManager.releaseAnnouncementDays;
    if (!(window > 0)) return [];

    const sets = await boosterManager.listBoosterSets();
    const announced = await this.readAnnounced();

    return sets.filter((set) => {
      if (announced.has(announcementKey(set))) return false;
      const availability = boosterManager.getSetAvailability(set.setId);
      if (!availability.released || availability.daysSinceRelease === null) return false;
      return availability.daysSinceRelease <= window;
    });
  }

  /**
   * Records that the given extensions were announced.
   *
   * @param {Array<object>} sets - Sets returned by `listPending()`.
   * @returns {Promise<void>} Resolves once the state is written (a failure is only logged).
   */
  async markAnnounced(sets) {
    const keys = (Array.isArray(sets) ? sets : [])
      .filter((set) => set?.setId && set?.releaseDate)
      .map(announcementKey);
    if (keys.length === 0) return;

    try {
      const announced = await this.readAnnounced();
      keys.forEach((key) => announced.add(key));
      await storageRepository.setUserState(
        USER_STATE_KEYS.SET_ANNOUNCEMENTS,
        [...announced].sort()
      );
    } catch (error) {
      console.warn('[SetAnnouncementManager] The announcement could not be remembered.', error);
    }
  }
}

/** Shared instance used by the announcement popup. */
export const setAnnouncementManager = new SetAnnouncementManager();

export default setAnnouncementManager;

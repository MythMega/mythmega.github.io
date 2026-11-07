/**
 * ChangelogManager - Which release note the player has already read.
 *
 * Reference: `settings/changelog.json`, `js/utils/ConfigLoader.js` (`getChangelog()`).
 *
 * The settings screen is the only place the notes are readable, and nothing there tells a returning
 * player that a version was published since their last visit. This manager answers that question:
 * the highest `Id` already seen is remembered in `user_state["changelogSeen"]`, so the badge on the
 * settings button only means "something you have not read yet", not "this version is recent".
 *
 * A missing entry means nothing was ever read: the whole file counts as unread, which is what a
 * returning player expects the first time the badge appears.
 */

import { configLoader } from '../utils/ConfigLoader.js';
import { storageRepository } from '../models/StorageRepository.js';
import { USER_STATE_KEYS } from './AccountManager.js';

export class ChangelogManager {
  /**
   * Reads the highest version id the player already opened.
   *
   * @returns {Promise<number>} The seen id, or 0 when nothing was ever read.
   */
  async readSeenId() {
    try {
      const stored = await storageRepository.getUserState(USER_STATE_KEYS.CHANGELOG_SEEN);
      return Number.isInteger(stored) && stored > 0 ? stored : 0;
    } catch (error) {
      console.warn('[ChangelogManager] The read version could not be read.', error);
      return 0;
    }
  }

  /**
   * Compares the newest version of the file with the one already seen.
   *
   * The notes are documentation: an unreadable file is not an error the player has to see, it simply
   * means there is nothing to announce (`latest: null`).
   *
   * @returns {Promise<{latest: object|null, seenId: number, unread: boolean}>} The newest version,
   *   the id already seen and whether a badge is due.
   */
  async getUnreadState() {
    let latest = null;
    try {
      const versions = await configLoader.getChangelog();
      latest = versions[0] ?? null;
    } catch (error) {
      console.warn('[ChangelogManager] The release notes could not be read.', error);
    }

    const seenId = await this.readSeenId();
    return {
      latest,
      seenId,
      unread: Boolean(latest) && latest.id > seenId,
    };
  }

  /**
   * Remembers the version the player just opened.
   *
   * The id never goes down: an older note opened after a newer one must not bring the badge back.
   *
   * @param {number} id - `id` of the version displayed (`ConfigLoader.getChangelog()` shape).
   * @returns {Promise<boolean>} True when the stored value moved (a badge refresh is then needed).
   */
  async markSeen(id) {
    if (!Number.isInteger(id) || id <= 0) return false;

    try {
      const seenId = await this.readSeenId();
      if (id <= seenId) return false;
      await storageRepository.setUserState(USER_STATE_KEYS.CHANGELOG_SEEN, id);
      return true;
    } catch (error) {
      console.warn('[ChangelogManager] The read version could not be saved.', error);
      return false;
    }
  }

  /**
   * Reads the highest version already announced by the startup popup.
   *
   * @returns {Promise<number>} The announced id, or 0 when no popup was ever shown.
   */
  async readAnnouncedId() {
    try {
      const stored = await storageRepository.getUserState(USER_STATE_KEYS.CHANGELOG_ANNOUNCED);
      return Number.isInteger(stored) && stored > 0 ? stored : 0;
    } catch (error) {
      console.warn('[ChangelogManager] The announced version could not be read.', error);
      return 0;
    }
  }

  /**
   * Tells whether the startup popup has to announce the newest version on this save.
   *
   * A separate marker from `getUnreadState()`: the popup is due once per VERSION, even if the
   * player already opened the settings screen (and therefore already cleared the badge dot).
   *
   * @returns {Promise<{latest: object|null, announcedId: number, due: boolean}>} The newest
   *   version, the id already announced and whether the popup is due.
   */
  async getAnnouncementState() {
    let latest = null;
    try {
      const versions = await configLoader.getChangelog();
      latest = versions[0] ?? null;
    } catch (error) {
      console.warn('[ChangelogManager] The release notes could not be read.', error);
    }

    const announcedId = await this.readAnnouncedId();
    return {
      latest,
      announcedId,
      due: Boolean(latest) && latest.id > announcedId,
    };
  }

  /**
   * Remembers the version announced by the startup popup.
   *
   * The id never goes down, so an imported save, an older release opened later or a reload in the
   * middle of the dialog can never announce the same version twice.
   *
   * @param {number} id - `id` of the announced version (`ConfigLoader.getChangelog()` shape).
   * @returns {Promise<boolean>} True when the stored value moved.
   */
  async markAnnounced(id) {
    if (!Number.isInteger(id) || id <= 0) return false;

    try {
      const announcedId = await this.readAnnouncedId();
      if (id <= announcedId) return false;
      await storageRepository.setUserState(USER_STATE_KEYS.CHANGELOG_ANNOUNCED, id);
      return true;
    } catch (error) {
      console.warn('[ChangelogManager] The announced version could not be saved.', error);
      return false;
    }
  }
}

/** Shared instance used by the header badge. */
export const changelogManager = new ChangelogManager();

export default changelogManager;

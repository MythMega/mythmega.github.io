/**
 * SaveSyncManager - Online backups of the `.save` file ("Sauvegarde en ligne").
 *
 * Reference: `minecard.backend` (`src/saveService.ts`, `doc/saves.md`) and
 * `.docs/main.md` section 3.G.
 *
 * The game already exports its whole database as a `.save` file (see `SaveFile`). This manager
 * sends that exact file to the worker, so another device can download it and continue the same
 * game: the last 5 uploads of an account are kept.
 *
 * WHY IT EXISTS
 *   Two devices cannot share an IndexedDB database. The online backup is the bridge, and the
 *   server never interprets the file: it stores the text and hands it back. A download is
 *   therefore the same operation as importing a `.save` picked from the disk — validation
 *   included (`SaveFile.validateSavePayload()`), which is what keeps a corrupted or foreign
 *   backup from overwriting the local game.
 *
 * AUTHENTICATION
 *   `uuid` + `auth_code`, the pair the trainer card already uses. The code is created on demand
 *   (`SocialManager.ensureAuthCode()`) so a player who never published their card can still
 *   upload: the worker creates the account row with that first code. Every upload and download
 *   presents it, so an UUID alone never exposes a save.
 */

import accountManager from './AccountManager.js';
import socialManager, { SOCIAL_API_BASE_URL } from './SocialManager.js';
import { saveFile, getSaveErrorMessageKey } from '../classes/SaveFile.js';
import { ERROR_SEVERITY } from '../utils/ErrorLog.js';
import { reportError } from '../utils/ErrorReporter.js';

/**
 * Maximum size of one uploaded save, in bytes (the worker refuses above it).
 *
 * Both halves MUST agree: `MAX_SAVE_BYTES` in `minecard.backend/src/saveService.ts` holds the same
 * value, and the messages quote it. D1 documents a 2,000,000-byte limit per ROW, and the row also
 * holds `uuid`, `byte_size` and `created_at`: a live test stored a 2 MiB value, but staying at half
 * of the documented ceiling keeps the whole row legal whatever the platform enforces. A real
 * `.save` is a few dozen KiB, so this is a guard rail, never a real constraint.
 */
export const SAVE_SYNC_MAX_BYTES = 1000000;

/** Prefix of the local copy downloaded before an online load: `minecard-backupsave-<date>.save`. */
export const SAVE_SYNC_BACKUP_PREFIX = 'minecard-backupsave';

/** Error codes thrown by this manager, mapped to `save.sync.error.*` translation keys. */
export const SAVE_SYNC_ERROR_CODES = Object.freeze({
  NO_ACCOUNT: 'noAccount',
  AUTH_MISSING: 'authMissing',
  AUTH_REJECTED: 'authRejected',
  INVALID_CREDENTIALS: 'invalidCredentials',
  NO_SAVE: 'noSave',
  TOO_LARGE: 'tooLarge',
  NETWORK: 'network',
  HTTP: 'http',
  INVALID_SAVE: 'invalidSave',
});

/** Error raised by the save sync manager, carrying a stable code for the views. */
export class SaveSyncError extends Error {
  /**
   * @param {string} code - One of `SAVE_SYNC_ERROR_CODES`.
   * @param {string} [message] - Developer-facing detail (never shown as-is to the player).
   * @param {object} [details] - Optional HTTP status, server message or wrapped save error.
   */
  constructor(code, message = '', details = {}) {
    super(message || code);
    this.name = 'SaveSyncError';
    this.code = code;
    this.status = Number.isInteger(details.status) ? details.status : null;
    this.serverMessage = typeof details.serverMessage === 'string' ? details.serverMessage : '';
    this.cause = details.cause;
  }
}

/**
 * Resolves the translation key describing a sync failure.
 *
 * @param {unknown} error - Error thrown by this manager.
 * @returns {string} A `save.sync.error.*` key.
 */
export function getSaveSyncErrorMessageKey(error) {
  if (error instanceof SaveSyncError) {
    return error.code === SAVE_SYNC_ERROR_CODES.INVALID_SAVE && error.cause
      ? getSaveErrorMessageKey(error.cause)
      : `save.sync.error.${error.code}`;
  }
  return 'save.sync.error.unknown';
}

/**
 * Checks the shape of a v4 UUID typed by the player.
 *
 * @param {unknown} value - Raw value.
 * @returns {string} The lowercase UUID, or an empty string.
 */
export function normalizeSyncUuid(value) {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(text)
    ? text
    : '';
}

/**
 * Checks the shape of the 16-character secret code.
 *
 * @param {unknown} value - Raw value.
 * @returns {string} The uppercase code, or an empty string.
 */
export function normalizeSyncAuthCode(value) {
  const text = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return /^[A-Z0-9]{16}$/.test(text) ? text : '';
}

/**
 * Formats a server timestamp (`YYYY-MM-DD HH:MM:SS`, UTC) for the player.
 *
 * The worker writes `datetime('now')`, which is UTC and carries no time zone marker: it is read
 * back as UTC on purpose, so the date shown is the one stored and never a local reinterpretation.
 *
 * @param {unknown} value - Stored timestamp.
 * @returns {{date: string, time: string}} The UTC date and time, or two empty strings.
 */
export function formatSyncTimestamp(value) {
  if (typeof value !== 'string') return { date: '', time: '' };
  const match = value.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2})?/);
  return match ? { date: match[1], time: match[2] } : { date: '', time: '' };
}

export class SaveSyncManager {
  /**
   * Reads the UUID and the secret code, creating the code when the account has none yet.
   *
   * @returns {Promise<{uuid: string, authCode: string}>} The credentials.
   * @throws {SaveSyncError} When the account or the code is unavailable.
   */
  async ensureCredentials() {
    const uuid = await accountManager.getUuid();
    if (!uuid) {
      throw new SaveSyncError(SAVE_SYNC_ERROR_CODES.NO_ACCOUNT, 'No local account exists.');
    }
    const authCode = await socialManager.ensureAuthCode();
    if (!authCode) {
      throw new SaveSyncError(
        SAVE_SYNC_ERROR_CODES.AUTH_MISSING,
        'The secret code of the account could not be created.'
      );
    }
    return { uuid, authCode };
  }

  /**
   * Uploads the current game as a `.save` file.
   *
   * @returns {Promise<{savedAt: string|null, kept: number, byteLength: number}>} The upload result.
   * @throws {SaveSyncError} When the save cannot be built, is too large, or the upload fails.
   */
  async uploadCurrentSave() {
    const { uuid, authCode } = await this.ensureCredentials();
    const file = await saveFile.createSaveFile();
    if (file.byteLength > SAVE_SYNC_MAX_BYTES) {
      throw new SaveSyncError(
        SAVE_SYNC_ERROR_CODES.TOO_LARGE,
        `The save is too large (${file.byteLength} bytes, maximum ${SAVE_SYNC_MAX_BYTES}).`
      );
    }

    const payload = await this.request('/saves', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uuid, auth_code: authCode, save: file.content }),
    });

    return {
      savedAt: typeof payload?.saved_at === 'string' ? payload.saved_at : null,
      kept: Number.isInteger(payload?.kept) ? payload.kept : 0,
      byteLength: file.byteLength,
    };
  }

  /**
   * Reads the date of the newest online save, without its content.
   *
   * @param {{uuid?: string, authCode?: string}} [credentials] - Explicit credentials (onboarding
   *   screen); the local account is used when absent.
   * @returns {Promise<{exists: boolean, savedAt: string|null}>} The date of the last upload.
   * @throws {SaveSyncError} When the credentials are invalid or the request fails.
   */
  async getLastSaveDate({ uuid = null, authCode = null } = {}) {
    const resolved = await this.resolveCredentials({ uuid, authCode });
    const query = `uuid=${encodeURIComponent(resolved.uuid)}&auth_code=${encodeURIComponent(resolved.authCode)}`;
    const payload = await this.request(`/saves/last?${query}`, { method: 'GET' });
    return {
      exists: payload?.exists === true,
      savedAt: typeof payload?.saved_at === 'string' ? payload.saved_at : null,
    };
  }

  /**
   * Downloads the newest online save and replaces the local game with it.
   *
   * The page is reloaded once the database was replaced, exactly like a `.save` import: the UUID,
   * the settings and every view depend on the new data.
   *
   * @param {object} [options] - Download options.
   * @param {string|null} [options.uuid] - Explicit UUID (onboarding screen).
   * @param {string|null} [options.authCode] - Explicit secret code (onboarding screen).
   * @returns {Promise<{uuid: string, savedAt: string|null}>} Resolves only when the download
   *   failed; a successful load reloads the page.
   * @throws {SaveSyncError} When nothing is online, the credentials are refused, or the file is
   *   not a valid save.
   */
  async downloadLastSave({ uuid = null, authCode = null } = {}) {
    const resolved = await this.resolveCredentials({ uuid, authCode });
    const query = `uuid=${encodeURIComponent(resolved.uuid)}&auth_code=${encodeURIComponent(resolved.authCode)}`;
    const payload = await this.request(`/saves/last/file?${query}`, { method: 'GET' });
    if (payload?.exists !== true || typeof payload.save !== 'string' || payload.save === '') {
      throw new SaveSyncError(SAVE_SYNC_ERROR_CODES.NO_SAVE, 'This account has no online save.');
    }

    let restored;
    try {
      restored = await saveFile.importFromFile(new Blob([payload.save], { type: 'text/plain' }));
    } catch (error) {
      // A refused file leaves the current data untouched: `importFromFile` validates before it
      // opens its transaction and the transaction is aborted on any failure.
      throw new SaveSyncError(
        SAVE_SYNC_ERROR_CODES.INVALID_SAVE,
        'The downloaded file is not a usable save.',
        { cause: error }
      );
    }
    return {
      uuid: restored?.uuid ?? resolved.uuid,
      savedAt: typeof payload.saved_at === 'string' ? payload.saved_at : null,
    };
  }

  /**
   * Writes the current game to a local file before an online load replaces it.
   *
   * @param {object} [options] - Backup options.
   * @param {string|null} [options.day] - `YYYY-MM-DD` used in the file name (trusted day).
   * @returns {Promise<{filename: string}>} The downloaded file.
   * @throws {Error} When the database cannot be read or the download cannot be triggered.
   */
  async backupCurrentSave({ day = null } = {}) {
    const date = typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)
      ? day
      : new Date().toISOString().slice(0, 10);
    const file = await saveFile.createSaveFile({ day: date });
    const filename = `${SAVE_SYNC_BACKUP_PREFIX}-${date}.save`;
    saveFile.triggerDownload(filename, file.content);
    return { filename };
  }

  /**
   * Resolves the credentials of a request: explicit ones (onboarding), or the local account.
   *
   * @param {{uuid: string|null, authCode: string|null}} credentials - Raw values.
   * @returns {Promise<{uuid: string, authCode: string}>} The validated pair.
   * @throws {SaveSyncError} When the pair is missing or malformed.
   */
  async resolveCredentials({ uuid, authCode }) {
    const typedUuid = uuid === null ? null : normalizeSyncUuid(uuid);
    const typedCode = authCode === null ? null : normalizeSyncAuthCode(authCode);
    if (typedUuid !== null || typedCode !== null) {
      if (!typedUuid || !typedCode) {
        throw new SaveSyncError(
          SAVE_SYNC_ERROR_CODES.INVALID_CREDENTIALS,
          'The UUID must be a v4 UUID and the code 16 letters or digits.'
        );
      }
      return { uuid: typedUuid, authCode: typedCode };
    }
    return this.ensureCredentials();
  }

  /**
   * Adds a failed worker request to the error report of the settings.
   *
   * The player already reads the failure under the buttons; this second copy exists for whoever
   * diagnoses it: "Sauvegarde en ligne" answering 413 is only actionable with the route and the
   * status, which the one-line message never carries. Recorded as a MINOR incident, so it never
   * opens a dialog.
   *
   * The detail NEVER contains the query string: it holds `auth_code`, and the secret code must
   * never land in a log the player copies onto Discord.
   *
   * @param {SaveSyncError} error - Failure about to be thrown.
   * @param {string} detail - Request line, e.g. `POST /saves → 413 · …`.
   * @returns {void}
   */
  reportRequestFailure(error, detail) {
    reportError(error, {
      source: 'save-sync',
      severity: ERROR_SEVERITY.MINOR,
      details: detail,
    });
  }

  /**
   * Performs one worker request and normalizes its failures.
   *
   * The API base URL comes from `SocialManager`: both features share the same worker, so a
   * deployment move only changes one constant.
   *
   * @param {string} path - Path beginning with `/`, query string included when there is one.
   * @param {RequestInit} [options] - Fetch options.
   * @returns {Promise<object>} The parsed JSON payload.
   * @throws {SaveSyncError} On a network failure or a non-2xx response.
   */
  async request(path, options = {}) {
    const method = String(options.method ?? 'GET').toUpperCase();
    const requestLine = `${method} ${path.split('?')[0]}`;
    let response;
    try {
      response = await fetch(`${SOCIAL_API_BASE_URL}${path}`, {
        cache: 'no-store',
        ...options,
      });
    } catch (error) {
      const failure = new SaveSyncError(
        SAVE_SYNC_ERROR_CODES.NETWORK,
        'The save server is unreachable.',
        { cause: error }
      );
      this.reportRequestFailure(failure, `${requestLine} → aucune réponse`);
      throw failure;
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      console.warn('[SaveSyncManager] The server response is not valid JSON.', error);
    }

    if (!response.ok) {
      const code =
        response.status === 403
          ? SAVE_SYNC_ERROR_CODES.AUTH_REJECTED
          : SAVE_SYNC_ERROR_CODES.HTTP;
      const serverMessage = typeof payload?.error === 'string' ? payload.error : '';
      const failure = new SaveSyncError(
        code,
        serverMessage || `HTTP ${response.status}`,
        { status: response.status, serverMessage }
      );
      this.reportRequestFailure(
        failure,
        `${requestLine} → ${response.status}${serverMessage ? ` · ${serverMessage}` : ''}`
      );
      throw failure;
    }
    return payload ?? {};
  }
}

/** Shared manager instance. */
export const saveSyncManager = new SaveSyncManager();

export default saveSyncManager;

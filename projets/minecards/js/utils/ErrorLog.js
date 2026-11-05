/**
 * ErrorLog - The last distinct failures of the CURRENT release, kept across reloads.
 *
 * Reference: `js/utils/ErrorReporter.js` (which records into it), `js/utils/ErrorReport.js` (the
 * report a failure is turned into) and `js/UI/views/SettingsView.js` (the "error report" section
 * that reads it).
 *
 * WHY IT EXISTS
 * Not every exception deserves a dialog. An illustration that fails to load, a service worker the
 * browser refuses (a scope it does not allow), a 3D scene that fell back to its 2D picture, a
 * promise nobody awaited: the game keeps running, and interrupting the player for one of those
 * buries the failure that actually stopped them. Those incidents are therefore shown nowhere -
 * except in the console, which is emptied by the next reload. This module keeps the last
 * `ERROR_LOG_LIMIT` DISTINCT incidents, each with its severity, so the settings can list them.
 *
 * ONE RELEASE ONLY
 * A failure of a previous release is not actionable: it may already be fixed. Every incident
 * therefore carries the release that met it (the newest `Id` of `settings/changelog.json`), and
 * loading a NEWER release drops the incidents of the older ones (`syncRelease`). An incident whose
 * release is unknown (`null`) is KEPT: it was recorded before the page could read the changelog
 * (a boot failure, the service worker registered on `load`), so it belongs to the page that is
 * running, not to the release being cleared.
 *
 * WHY `localStorage`
 * A boot failure happens before IndexedDB is open, and a page with no account never opens it at
 * all: this is the only storage that exists at the first line of `app.js`. Every access is guarded,
 * because a private window refuses it, and a log that cannot be written must never become the
 * reason a failure disappears.
 */

import { configLoader } from './ConfigLoader.js';

/** Key of the persisted payload. */
export const ERROR_LOG_STORAGE_KEY = 'minecards:errorLog';

/** Number of DISTINCT incidents kept. */
export const ERROR_LOG_LIMIT = 5;

/** Severity carried by a logged incident. */
export const ERROR_SEVERITY = Object.freeze({
  /** The game stopped doing what the player asked: a dialog is opened for it. */
  BLOCKING: 'blocking',
  /** The game survived it: listed here, never shown as a dialog. */
  MINOR: 'minor',
});

/** Longest message kept per incident, in characters. */
const MESSAGE_MAX_CHARS = 300;

/**
 * Delay coalescing the writes, in milliseconds.
 *
 * A failure that repeats (a promise rejected on every frame) must not write `localStorage` on
 * every occurrence: the count is kept in memory and the payload is written once the storm calms
 * down.
 */
const PERSIST_DELAY_MS = 250;

export class ErrorLog {
  constructor() {
    /** @type {Array<{code: string, message: string, source: string, severity: string,
     *   at: string, count: number}>} Incidents, newest first. */
    this.entries = [];
    /** @type {number|null} Newest `Id` of the changelog the log belongs to. */
    this.releaseId = null;
    /** @type {string|null} Version of that release, as displayed by the settings. */
    this.version = null;
    /** @type {boolean} True once `localStorage` was read. */
    this.loaded = false;
    /** @type {Set<Function>} Readers to notify when the log changes. */
    this.listeners = new Set();
    /** @type {number|null} Pending coalesced write. */
    this.persistTimer = null;
  }

  /**
   * Reads the persisted payload, without ever throwing.
   *
   * @returns {object|null} The payload, or null when it is absent or unreadable.
   */
  static readPayload() {
    try {
      const raw = window.localStorage.getItem(ERROR_LOG_STORAGE_KEY);
      if (typeof raw !== 'string' || raw === '') return null;
      const payload = JSON.parse(raw);
      return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Tells whether a stored incident has the expected shape.
   *
   * A payload written by an older release of the game is not trusted: one malformed entry must not
   * break the whole panel.
   *
   * @param {unknown} entry - Candidate entry.
   * @returns {boolean} True when it can be displayed.
   */
  static isEntry(entry) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const candidate = entry;
    return (
      typeof candidate.code === 'string' &&
      candidate.code !== '' &&
      typeof candidate.message === 'string' &&
      typeof candidate.source === 'string' &&
      (candidate.severity === ERROR_SEVERITY.MINOR || candidate.severity === ERROR_SEVERITY.BLOCKING) &&
      typeof candidate.at === 'string' &&
      (candidate.release === null ||
        candidate.release === undefined ||
        Number.isInteger(candidate.release)) &&
      Number.isInteger(candidate.count) &&
      candidate.count > 0
    );
  }

  /**
   * Reads the stored log once per page.
   *
   * @returns {this} The log, for chaining.
   */
  load() {
    if (this.loaded) return this;
    this.loaded = true;

    const payload = ErrorLog.readPayload();
    if (!payload) return this;

    if (Number.isInteger(payload.releaseId) && payload.releaseId > 0) {
      this.releaseId = payload.releaseId;
    }
    if (typeof payload.version === 'string' && payload.version.trim() !== '') {
      this.version = payload.version.trim();
    }
    this.entries = Array.isArray(payload.entries)
      ? payload.entries.filter((entry) => ErrorLog.isEntry(entry)).slice(0, ERROR_LOG_LIMIT)
      : [];
    return this;
  }

  /**
   * Writes the payload now.
   *
   * @returns {boolean} True when the payload reached the storage.
   */
  persistNow() {
    if (this.persistTimer !== null) {
      window.clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    try {
      window.localStorage.setItem(
        ERROR_LOG_STORAGE_KEY,
        JSON.stringify({
          releaseId: this.releaseId,
          version: this.version,
          entries: this.entries,
        })
      );
      return true;
    } catch (error) {
      console.warn('[ErrorLog] The log could not be saved.', error);
      return false;
    }
  }

  /**
   * Schedules one coalesced write.
   *
   * @returns {void}
   */
  schedulePersist() {
    if (this.persistTimer !== null) return;
    this.persistTimer = window.setTimeout(() => {
      this.persistTimer = null;
      this.persistNow();
    }, PERSIST_DELAY_MS);
  }

  /**
   * Registers a reader, called whenever the log changes.
   *
   * @param {Function} listener - Function to call.
   * @returns {() => void} Unsubscribe function (no-op when the listener was unknown).
   */
  subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Calls every reader, each one guarded on its own.
   *
   * @returns {void}
   */
  notify() {
    this.listeners.forEach((listener) => {
      try {
        listener(this);
      } catch (error) {
        console.warn('[ErrorLog] A reader failed.', error);
      }
    });
  }

  /**
   * Records one incident, or adds one occurrence to the incident already known.
   *
   * The incidents are keyed by their code, which is derived from the error name, its message and
   * the place it was caught: two failures sharing a code are the same bug met twice, and the panel
   * shows them once with their count.
   *
   * @param {object} entry - Incident to record.
   * @param {string} entry.code - `MC-XXXXXX` code of the failure.
   * @param {string} [entry.message] - Message of the failure.
   * @param {string} [entry.source] - Where it was caught.
   * @param {string} [entry.severity] - `ERROR_SEVERITY.MINOR` or `ERROR_SEVERITY.BLOCKING`.
   * @returns {object|null} The stored incident, or null when the code was unusable.
   */
  record({ code, message, source, severity } = {}) {
    if (typeof code !== 'string' || code === '') return null;
    this.load();

    const label = severity === ERROR_SEVERITY.MINOR ? ERROR_SEVERITY.MINOR : ERROR_SEVERITY.BLOCKING;
    const text = typeof message === 'string' ? message.slice(0, MESSAGE_MAX_CHARS) : '';
    const origin = typeof source === 'string' && source !== '' ? source : 'app';
    const at = new Date().toISOString();
    const existing = this.entries.find((entry) => entry.code === code);

    if (existing) {
      existing.count += 1;
      existing.at = at;
      existing.source = origin;
      if (text !== '') existing.message = text;
      // A failure met as blocking wins: the dialog it opened is the one that matters.
      if (label === ERROR_SEVERITY.BLOCKING) existing.severity = label;
      this.entries = [existing, ...this.entries.filter((entry) => entry !== existing)];
    } else {
      this.entries.unshift({
        code,
        message: text,
        source: origin,
        severity: label,
        at,
        count: 1,
        release: Number.isInteger(this.releaseId) ? this.releaseId : null,
      });
      while (this.entries.length > ERROR_LOG_LIMIT) this.entries.pop();
    }

    this.schedulePersist();
    this.notify();
    return this.entries[0] ?? null;
  }

  /**
   * Returns the recorded incidents, newest first.
   *
   * @returns {Array<object>} Copies of the incidents.
   */
  getEntries() {
    this.load();
    return this.entries.map((entry) => ({ ...entry }));
  }

  /**
   * Returns the release the log belongs to.
   *
   * @returns {{id: number|null, version: string|null}} The release.
   */
  getRelease() {
    this.load();
    return { id: this.releaseId, version: this.version };
  }

  /**
   * Empties the log.
   *
   * @returns {void}
   */
  clear() {
    this.entries = [];
    this.schedulePersist();
    this.notify();
  }

  /**
   * Adopts the release of the page, clearing a log written by an OLDER one.
   *
   * A newer version means the failures it lists may already be fixed: the player is not asked to
   * read a report of a release that is gone. A log of an unknown release is kept (see the module
   * docblock), and a release that cannot be read leaves the log exactly as it was.
   *
   * @returns {Promise<number|null>} The release now adopted, or null when none could be read.
   */
  async syncRelease() {
    let latest = null;
    try {
      const versions = await configLoader.getChangelog();
      latest = Array.isArray(versions) ? (versions[0] ?? null) : null;
    } catch (error) {
      console.warn('[ErrorLog] The release could not be read.', error);
      return this.releaseId;
    }
    if (!latest || !Number.isInteger(latest.id) || latest.id <= 0) return this.releaseId;

    this.load();
    if (Number.isInteger(this.releaseId) && latest.id > this.releaseId) {
      // Only the incidents of an OLDER release go away: the ones recorded before this page knew
      // its release belong to it, and dropping them would hide the very failure of the new build.
      const kept = this.entries.filter((entry) => !Number.isInteger(entry.release));
      console.info(
        `[ErrorLog] Release ${latest.version} is newer than the logged ${this.version ?? this.releaseId}: ${this.entries.length - kept.length} incident(s) cleared, ${kept.length} kept.`
      );
      this.entries = kept.map((entry) => ({ ...entry, release: latest.id }));
    }
    this.releaseId = latest.id;
    this.version = latest.version;
    this.persistNow();
    this.notify();
    return latest.id;
  }
}

/** Shared instance: the reporter writes, the settings read. */
export const errorLog = new ErrorLog();

export default errorLog;

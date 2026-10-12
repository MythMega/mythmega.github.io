/**
 * DateSyncManager - Trusted UTC clock and booster quota.
 *
 * Reference: `.docs/main.md` section 3.B and `.docs/steps/2.md`.
 *
 * THREAT MODEL AND DESIGN (why the local clock is never trusted)
 *   - 3 free boosters per day, reset at 00:00:00 UTC exactly.
 *   - The reference time comes from an external UTC API, never from `Date.now()`: a player
 *     cannot advance the reset by changing the operating system clock.
 *   - Once anchored on the API answer, the time is extrapolated with `performance.now()`,
 *     which is monotonic and cannot be moved by the user.
 *   - `performance.now()` restarts at zero on every page load, so a stored anchor cannot be
 *     extrapolated after a reload. A `sessionId` generated per page load is stored with the
 *     anchor: when it does not match the current session, the extrapolation is impossible and
 *     the time is FROZEN at `lastKnownUtcMs` (the last trusted value). A reload without
 *     network therefore never grants the daily reset - which is the intended behaviour.
 *   - The estimated time can never move backwards: `max(estimate, lastKnownUtcMs)`.
 *   - IndexedDB remains editable by the user (devtools). This blocks simple cheating through
 *     the system clock, not a determined attacker with full control of the browser.
 *
 * Storage (`user_state`):
 *   - `quota`      : { lastResetDay: "YYYY-MM-DD", dailyRemaining, bonusBoosters: { [setId]: n } }
 *   - `timeAnchor` : { sessionId, apiUtcMs, perfNow, lastKnownUtcMs }
 *
 * TIME PROVIDERS (CORS)
 *   The reference time is read in a browser page, so a provider is only usable when its response
 *   carries `Access-Control-Allow-Origin`. That is why the spec's `worldtimeapi.org` is not first
 *   any more: it closes the connection and is blocked by CORS, which left the application
 *   permanently "offline" and therefore without any daily reset. The ordered list lives in
 *   `settings/config.json` (`timeSync.providers`, three formats: `json`, `trace`, `headers`) and
 *   defaults to `DEFAULT_PROVIDERS` below. The third default provider is our own origin
 *   (`index.html`), whose `Date` header is always readable because CORS does not filter
 *   same-origin responses.
 *
 * Bonus boosters are granted per extension and are NEVER overwritten by the daily reset;
 * `consumeBooster()` spends `dailyRemaining` first, then `bonusBoosters[setId]`.
 */

import { storageRepository, STORES } from '../models/StorageRepository.js';
import { USER_STATE_KEYS } from './AccountManager.js';
import { configLoader } from '../utils/ConfigLoader.js';
import eventBus, { EVENTS } from '../utils/EventBus.js';

/** Interval of the internal clock, in milliseconds. */
const CLOCK_INTERVAL_MS = 1000;

/** Minimum delay between two `timeAnchor` persistences, in milliseconds. */
const PERSIST_MIN_INTERVAL_MS = 10000;

/** Number of free boosters granted each UTC day when `config.json` declares none. */
const DEFAULT_DAILY_FREE_BOOSTERS = 3;

/**
 * Built-in providers, used when `settings/config.json` declares none.
 *
 * ORDER IS ABOUT BROWSER REACHABILITY, NOT PREFERENCE: the application runs in a page, so a
 * provider only counts if its response carries `Access-Control-Allow-Origin`. Verified with a
 * real request carrying an `Origin` header:
 *   - `timeapi.io` answers 200 with `Access-Control-Allow-Origin: *` and a `dateTime` field
 *     WITHOUT timezone suffix (read as UTC, see `normalizeIsoTimestamp`);
 *   - `cloudflare.com/cdn-cgi/trace` answers 200 with `Access-Control-Allow-Origin: *` and a
 *     plain-text body containing `ts=<unix seconds>` (this endpoint is a CDN trace, not a
 *     purpose-built time API, but its timestamp is served by Cloudflare's own edge);
 *   - `index.html` is OUR OWN origin: CORS does not filter same-origin responses, so the `Date`
 *     response header is always readable. It is the guaranteed last resort (1-second resolution),
 *     which matters because without a trusted answer the daily reset never happens;
 *   - `worldtimeapi.org` (the provider named in the specification) closes the connection and is
 *     blocked by CORS from a browser: it is kept last for environments where it does answer.
 *
 * The list stays fully configurable: reorder `timeSync.providers` in `settings/config.json`.
 */
const DEFAULT_PROVIDERS = Object.freeze([
  Object.freeze({ url: 'https://timeapi.io/api/Time/current/zone?timeZone=UTC', format: 'json', field: 'dateTime', unit: 'iso' }),
  Object.freeze({ url: 'https://cloudflare.com/cdn-cgi/trace', format: 'trace', field: 'ts', unit: 'seconds' }),
  Object.freeze({ url: 'index.html', format: 'headers', field: 'date', unit: 'http-date' }),
  Object.freeze({ url: 'https://worldtimeapi.org/api/timezone/Etc/UTC', format: 'json', field: 'unixtime', unit: 'seconds' }),
]);

/**
 * Formats a timestamp as the UTC day key `YYYY-MM-DD`.
 *
 * @param {number} utcMs - Timestamp in milliseconds.
 * @returns {string} The UTC day, lexicographically comparable.
 */
function formatUtcDay(utcMs) {
  const date = new Date(utcMs);
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${date.getUTCFullYear()}-${month}-${day}`;
}

/**
 * Formats a duration (or a timestamp) as `HH:MM:SS`.
 *
 * @param {number} milliseconds - Duration in milliseconds.
 * @returns {string} Zero-padded hours, minutes and seconds.
 */
function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
}

/**
 * Formats a timestamp as the UTC time of day `HH:MM:SS`.
 *
 * @param {number} utcMs - UTC timestamp in milliseconds.
 * @returns {string} Zero-padded hours, minutes and seconds.
 */
function formatClockTime(utcMs) {
  const date = new Date(utcMs);
  return [date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
}

/**
 * Booster sources accepted by `consumeBooster()`.
 *
 * `auto` keeps the historic behaviour (daily quota first, then the per-extension bonus bucket);
 * `daily` and `bonus` force one bucket, which is what the opening view uses when a booster is
 * available BOTH ways and the player must choose.
 */
export const BOOSTER_SOURCES = Object.freeze({
  AUTO: 'auto',
  DAILY: 'daily',
  BONUS: 'bonus',
});

export class DateSyncManager {
  constructor() {
    /** @type {string} Identifies the current page load: an anchor from another session is not
     * extrapolatable, because `performance.now()` restarted at zero. */
    this.sessionId = DateSyncManager.createSessionId();

    /** @type {Array<{url: string, field: string, unit: string}>} */
    this.providers = DEFAULT_PROVIDERS.slice();
    /** @type {number} */
    this.requestTimeoutMs = 4000;
    /** @type {number} */
    this.resyncIntervalMs = 900000;

    /**
     * @type {{sessionId: string, apiUtcMs: number, perfNow: number, lastKnownUtcMs: number}|null}
     * The anchor is the last API answer; it is extrapolated with `performance.now()`.
     */
    this.anchor = null;
    /** @type {boolean} True when the current session holds a usable anchor. */
    this.timeTrusted = false;

    /**
     * @type {{lastResetDay: string|null, dailyRemaining: number, bonusBoosters: Record<string, number>}|null}
     * In-memory mirror of `user_state["quota"]`, kept in sync with every write.
     */
    this.quota = null;
    /** @type {number} Free boosters granted each UTC day. */
    this.dailyFreeBoosters = DEFAULT_DAILY_FREE_BOOSTERS;
    /** @type {string[]} Extension ids declared in `config.json`, the only valid bonus keys. */
    this.knownSets = [];
    /** @type {boolean} True while a synchronization request is in flight. */
    this.isSyncing = false;
    /** @type {boolean} True once the manager initialized at least once. */
    this.isInitialized = false;

    /** @type {number|null} */
    this.clockTimer = null;
    /** @type {number|null} */
    this.resyncTimer = null;
    /** @type {EventListener|null} */
    this.onlineHandler = null;
    /** @type {number} Last `performance.now()` at which the anchor was persisted. */
    this.lastPersistPerfNow = 0;
    /** @type {string|null} Last warned day, avoids spamming the console every second. */
    this.warnedFutureDay = null;
  }

  /**
   * Generates an identifier for the current page load.
   *
   * @returns {string} A random identifier (crypto based when available).
   */
  static createSessionId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `session-${Math.random().toString(36).slice(2)}-${performance.now().toFixed(0)}`;
  }

  /**
   * Indicates whether the estimated time can be trusted for a daily reset.
   *
   * True only after a successful API answer during the current page load. A stale anchor
   * (previous session) or no answer at all leaves the time frozen, so no reset is granted.
   *
   * @returns {boolean} True when the time is anchored in this session.
   */
  isTimeTrusted() {
    return this.timeTrusted;
  }

  /**
   * Synchronous snapshot of the quota, for the header and the booster button.
   *
   * @param {string|null} [setId=null] - Extension to compute `availableForSet` for.
   * @returns {{daily: number, bonusBySet: Record<string, number>, bonusTotal: number, availableForSet: number|null}}
   *   The current quota (zeroes before the first `init()`).
   */
  getQuotaSnapshot(setId = null) {
    const quota = this.quota ?? { lastResetDay: null, dailyRemaining: 0, bonusBoosters: {} };
    const bonusBoosters = { ...(quota.bonusBoosters ?? {}) };
    const bonusTotal = Object.values(bonusBoosters).reduce((sum, value) => sum + value, 0);

    return {
      daily: quota.dailyRemaining,
      bonusBySet: bonusBoosters,
      bonusTotal,
      availableForSet: setId ? quota.dailyRemaining + (bonusBoosters[setId] ?? 0) : null,
    };
  }

  /**
   * Diagnostics used by the settings view and by the test harnesses.
   *
   * @returns {{online: boolean, trusted: boolean, day: string|null, lastKnownUtcMs: number, anchorSession: string|null, timeUntilReset: string}}
   *   The current synchronization status.
   */
  getStatus() {
    return {
      online: this.timeTrusted,
      trusted: this.timeTrusted,
      day: this.anchor ? formatUtcDay(this.getEstimatedUtcMs()) : null,
      lastKnownUtcMs: this.anchor ? this.anchor.lastKnownUtcMs : 0,
      anchorSession: this.anchor ? this.anchor.sessionId : null,
      timeUntilReset: this.getFormattedTimeUntilReset(),
    };
  }

  /**
   * Initializes the manager: reads the stored anchor, synchronizes with the UTC API, applies
   * the daily reset when needed, then starts the internal clock.
   *
   * A failed synchronization is not fatal: the quota stays usable (frozen time, no reset) and
   * `CONNECTION_STATUS { online: false }` is emitted so the header can show the offline state.
   *
   * @returns {Promise<{online: boolean, trusted: boolean, reset: boolean}>} The initialization result.
   * @throws {Error} When the stored state cannot be read.
   */
  async init() {
    await this.loadSettings();
    await this.restoreAnchor();

    const online = await this.syncTime('init');
    const reset = await this.ensureDailyReset();

    this.startClock();
    this.bindNetworkEvents();
    this.isInitialized = true;

    this.emitQuotaUpdated(null);
    return { online, trusted: this.timeTrusted, reset };
  }

  /**
   * Loads the provider list, the daily allowance and the known extension ids.
   *
   * @returns {Promise<void>} Resolves once the configuration is applied.
   * @throws {Error} When `settings/config.json` cannot be loaded.
   */
  async loadSettings() {
    const { providers, requestTimeoutMs, resyncIntervalMs } = await configLoader.getTimeSyncSettings();
    this.providers = providers.length > 0 ? providers : DEFAULT_PROVIDERS.slice();
    this.requestTimeoutMs = requestTimeoutMs;
    this.resyncIntervalMs = resyncIntervalMs;

    const { sets, dailyFreeBoosters } = await configLoader.getBoosterSettings();
    this.knownSets = sets;
    this.dailyFreeBoosters = dailyFreeBoosters;
  }

  /**
   * Loads the stored anchor and the quota from IndexedDB.
   *
   * A stored anchor is only extrapolatable when it was created during the current page load
   * (`sessionId` match). Otherwise it is kept for its `lastKnownUtcMs` value only: the time is
   * then frozen and no reset can be granted until a new API answer arrives.
   *
   * @returns {Promise<void>} Resolves once the state is restored.
   * @throws {Error} When the read fails.
   */
  async restoreAnchor() {
    const storedAnchor = await storageRepository.getUserState(USER_STATE_KEYS.TIME_ANCHOR);
    this.quota = this.normalizeQuota(await storageRepository.getUserState(USER_STATE_KEYS.QUOTA));

    if (!storedAnchor || !Number.isFinite(storedAnchor.lastKnownUtcMs)) {
      this.anchor = null;
      this.timeTrusted = false;
      return;
    }

    this.anchor = {
      sessionId: typeof storedAnchor.sessionId === 'string' ? storedAnchor.sessionId : 'unknown',
      apiUtcMs: Number(storedAnchor.apiUtcMs) || storedAnchor.lastKnownUtcMs,
      perfNow: Number(storedAnchor.perfNow) || 0,
      lastKnownUtcMs: storedAnchor.lastKnownUtcMs,
    };
    this.timeTrusted = this.anchor.sessionId === this.sessionId;

    if (!this.timeTrusted) {
      console.info('[DateSyncManager] The stored anchor belongs to a previous page load: the time is frozen at the last known UTC value until the API answers again.');
    }
  }

  /**
   * Queries the configured providers in order and anchors the clock on the first answer.
   *
   * A failure never invalidates an anchor acquired earlier in the same session: the
   * `performance.now()` extrapolation stays valid (monotonic and user-proof).
   *
   * @param {string} [reason='manual'] - Diagnostic label ("init", "periodic", "online", ...).
   * @returns {Promise<boolean>} True when a provider answered.
   */
  async syncTime(reason = 'manual') {
    if (this.isSyncing) return this.timeTrusted;
    this.isSyncing = true;

    try {
      for (const provider of this.providers) {
        try {
          const apiUtcMs = await this.requestProvider(provider);
          await this.applyAnchor(apiUtcMs);
          eventBus.emit(EVENTS.CONNECTION_STATUS, { online: true });
          console.info(`[DateSyncManager] Clock synchronized (${reason}) through ${provider.url}.`);
          return true;
        } catch (error) {
          console.warn(`[DateSyncManager] Provider "${provider.url}" failed (${reason}).`, error.message);
        }
      }

      eventBus.emit(EVENTS.CONNECTION_STATUS, { online: false });
      console.warn('[DateSyncManager] No time provider answered: keeping the last known UTC value.');
      return false;
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Fetches one provider with a short timeout.
   *
   * The body is read as JSON, plain text or not at all depending on `provider.format`, and
   * `mode: 'cors'` / `credentials: 'omit'` are set explicitly: the providers are third-party
   * origins that must not receive cookies.
   *
   * @param {{url: string, format: string, field: string, unit: string}} provider - Provider descriptor.
   * @returns {Promise<number>} The UTC timestamp in milliseconds.
   * @throws {Error} When the request fails (network/CORS), times out, or the payload cannot be parsed.
   */
  async requestProvider(provider) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => {
      if (controller) controller.abort();
    }, this.requestTimeoutMs);

    try {
      const response = await fetch(provider.url, {
        cache: 'no-store',
        mode: 'cors',
        credentials: 'omit',
        signal: controller ? controller.signal : undefined,
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = provider.format === 'json' ? await response.json() : await response.text();
      return this.parseProviderPayload(provider, payload, response);
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(`request timed out after ${this.requestTimeoutMs} ms`);
      }
      // A `TypeError` from `fetch` means the request never produced a readable response: offline
      // network or, most often in a page, a response without `Access-Control-Allow-Origin`.
      if (error instanceof TypeError) {
        throw new Error(
          `network or CORS error (the provider may not allow browser requests): ${error.message}`,
          { cause: error }
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Extracts a UTC timestamp from a provider response, whatever its format.
   *
   * @param {{format: string, field: string, unit: string}} provider - Provider descriptor.
   * @param {unknown} payload - Parsed JSON object, plain-text body, or `null` for `headers`.
   * @param {Response|null} [response=null] - Response, required by the `headers` format.
   * @returns {number} The UTC timestamp in milliseconds.
   * @throws {Error} When the expected field is missing or not interpretable.
   */
  parseProviderPayload(provider, payload, response = null) {
    const raw = this.extractProviderValue(provider, payload, response);
    return DateSyncManager.convertToUtcMs(raw, provider.unit, `${provider.format}:${provider.field}`);
  }

  /**
   * Reads the raw timestamp out of a provider response.
   *
   * @param {{format: string, field: string}} provider - Provider descriptor.
   * @param {unknown} payload - Parsed JSON object or plain-text body.
   * @param {Response|null} response - Response, required by the `headers` format.
   * @returns {string|number} The raw value, ready for `convertToUtcMs()`.
   * @throws {Error} When the response does not carry the expected field.
   */
  extractProviderValue(provider, payload, response) {
    if (provider.format === 'headers') {
      if (!response || typeof response.headers?.get !== 'function') {
        throw new Error('the response headers are not readable (a same-origin URL is required)');
      }
      const header = response.headers.get(provider.field);
      if (header === null || header === '') {
        throw new Error(`the header "${provider.field}" is missing from the response`);
      }
      return header;
    }

    if (provider.format === 'trace') {
      return DateSyncManager.parseTraceField(payload, provider.field);
    }

    if (!payload || typeof payload !== 'object') {
      throw new Error('the response body is not a JSON object');
    }
    const value = payload[provider.field];
    if (value === undefined || value === null || value === '') {
      throw new Error(`the field "${provider.field}" is missing from the response`);
    }
    return value;
  }

  /**
   * Reads one `key=value` field out of a plain-text trace body.
   *
   * Cloudflare's `/cdn-cgi/trace` (and similar endpoints) answer one field per line, for example:
   *   fl=... \n h=cloudflare.com \n ts=1790903600.000
   *
   * @param {unknown} body - Plain-text response body.
   * @param {string} field - Field name to read (e.g. "ts").
   * @returns {string} The trimmed value.
   * @throws {Error} When the body is not text or the field is absent/empty.
   */
  static parseTraceField(body, field) {
    if (typeof body !== 'string') {
      throw new Error('the trace response body is not text');
    }
    const prefix = `${field}=`;
    const line = body.split(/\r?\n/).find((candidate) => candidate.trim().startsWith(prefix));
    if (line === undefined) {
      throw new Error(`the field "${field}" is missing from the trace response`);
    }
    const value = line.trim().slice(prefix.length).trim();
    if (value === '') {
      throw new Error(`the field "${field}" is empty in the trace response`);
    }
    return value;
  }

  /**
   * Converts a raw provider value into a UTC timestamp in milliseconds.
   *
   * ISO values without an explicit timezone are read as UTC: every provider is queried on the UTC
   * zone, and `Date.parse('2026-01-01T00:00:00')` would otherwise be interpreted in the local
   * timezone, shifting the whole quota by the user's offset.
   *
   * @param {string|number} raw - Raw value extracted from the response.
   * @param {string} unit - Interpretation mode ("seconds", "milliseconds", "iso", "http-date").
   * @param {string} label - Label used in error messages.
   * @returns {number} The UTC timestamp in milliseconds.
   * @throws {Error} When the value cannot be interpreted.
   */
  static convertToUtcMs(raw, unit, label) {
    let utcMs;
    switch (unit) {
      case 'iso':
        utcMs = Date.parse(DateSyncManager.normalizeIsoTimestamp(String(raw)));
        break;
      case 'http-date':
        // RFC 1123 date, e.g. "Fri, 02 Oct 2026 01:13:20 GMT". Never passed through the ISO
        // normalizer: appending "Z" to a value ending in "GMT" would break the parse.
        utcMs = Date.parse(String(raw).trim());
        break;
      case 'milliseconds':
        utcMs = Number(raw);
        break;
      default:
        utcMs = Number(raw) * 1000;
        break;
    }

    if (!Number.isFinite(utcMs)) {
      throw new Error(`unable to read a (${unit}) UTC timestamp from "${label}"`);
    }
    return utcMs;
  }

  /**
   * Normalizes an ISO 8601 timestamp so `Date.parse()` reads it as UTC.
   *
   * Two real-world quirks observed on the configured providers are handled here:
   *   - `timeapi.io` answers `2026-09-30T21:48:58.7493124` with no timezone suffix. Without an
   *     explicit zone, `Date.parse()` interprets it in the local timezone and shifts the whole
   *     quota by the player's UTC offset (measured: 2 hours on a UTC+2 machine). Both providers
   *     are queried on the UTC zone, so `Z` is appended;
   *   - the same service returns up to seven fractional digits while the ECMAScript date format
   *     defines three. They are truncated, so the result does not depend on the leniency of the
   *     JavaScript engine.
   *
   * @param {string} value - Raw timestamp coming from the provider payload.
   * @returns {string} An ISO 8601 string ending with `Z` and at most three fractional digits.
   */
  static normalizeIsoTimestamp(value) {
    let text = value.trim().replace(/\s+/g, '');

    // `.1234567` -> `.123`
    text = text.replace(/\.(\d{3})\d+/, '.$1');

    if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
      text = `${text}Z`;
    }
    return text;
  }

  /**
   * Anchors the clock on an API answer and persists it.
   *
   * The stored `lastKnownUtcMs` is kept as a floor: a provider answering an older time (broken
   * upstream clock or hostile answer) can never make the estimated time move backwards.
   *
   * @param {number} apiUtcMs - Trusted UTC timestamp in milliseconds.
   * @returns {Promise<void>} Resolves once the anchor is persisted.
   */
  async applyAnchor(apiUtcMs) {
    const previousLastKnown = this.anchor ? this.anchor.lastKnownUtcMs : 0;
    const perfNow = performance.now();

    this.anchor = {
      sessionId: this.sessionId,
      apiUtcMs,
      perfNow,
      lastKnownUtcMs: Math.max(apiUtcMs, previousLastKnown),
    };
    this.timeTrusted = true;
    this.lastPersistPerfNow = perfNow;

    await this.persistAnchor();
  }

  /**
   * Writes the anchor to `user_state["timeAnchor"]`.
   *
   * The `sessionId` is stored in addition to the fields documented in `main.md` section 2: it
   * is what makes the reload detection exact instead of a heuristic on `performance.now()`.
   *
   * @returns {Promise<void>} Resolves once the write committed (failures are logged, not thrown).
   */
  async persistAnchor() {
    if (!this.anchor || this.anchor.sessionId !== this.sessionId) return;

    try {
      await storageRepository.setUserState(USER_STATE_KEYS.TIME_ANCHOR, { ...this.anchor });
    } catch (error) {
      console.warn('[DateSyncManager] Unable to persist the time anchor.', error);
    }
  }

  /**
   * Persists the anchor at most once every `PERSIST_MIN_INTERVAL_MS`.
   *
   * Called from the one-second tick: writing to IndexedDB every second would be wasteful, and
   * losing a few seconds of `lastKnownUtcMs` after a crash only freezes the clock slightly
   * earlier, which is the safe direction.
   *
   * @returns {void}
   */
  schedulePersist() {
    if (!this.anchor || this.anchor.sessionId !== this.sessionId) return;

    const now = performance.now();
    if (now - this.lastPersistPerfNow < PERSIST_MIN_INTERVAL_MS) return;
    this.lastPersistPerfNow = now;
    this.persistAnchor();
  }

  /**
   * Returns the current UTC time in milliseconds, extrapolated from the anchor.
   *
   * `performance.now()` is monotonic and cannot be altered by the user, which is why it is
   * used instead of `Date.now()`. When the anchor comes from another page load the
   * extrapolation is impossible, so the time is frozen at `lastKnownUtcMs`.
   *
   * The returned value never decreases: `max(estimate, lastKnownUtcMs)`.
   *
   * @returns {number} The estimated UTC timestamp in milliseconds (0 when never anchored).
   */
  getEstimatedUtcMs() {
    if (!this.anchor) return 0;

    const elapsed =
      this.anchor.sessionId === this.sessionId ? Math.max(0, performance.now() - this.anchor.perfNow) : 0;
    const estimated = this.anchor.apiUtcMs + elapsed;
    const safe = Math.max(estimated, this.anchor.lastKnownUtcMs);

    if (safe > this.anchor.lastKnownUtcMs) {
      this.anchor.lastKnownUtcMs = safe;
      this.schedulePersist();
    }
    return safe;
  }

  /**
   * Returns the estimated UTC time as a `Date`, for the header clock.
   *
   * @returns {Date} The estimated UTC date (epoch when never anchored).
   */
  getUtcDate() {
    return new Date(this.getEstimatedUtcMs());
  }

  /**
   * Returns the current UTC day used by the quota.
   *
   * @returns {string|null} `YYYY-MM-DD`, or null when the clock was never anchored.
   */
  getCurrentUtcDay() {
    return this.anchor ? formatUtcDay(this.getEstimatedUtcMs()) : null;
  }

  /**
   * Normalizes a raw quota payload, dropping corrupted values.
   *
   * @param {unknown} raw - Value read from `user_state["quota"]`.
   * @returns {{lastResetDay: string|null, dailyRemaining: number, bonusBoosters: Record<string, number>}}
   *   A quota guaranteed to be usable by the rest of the application.
   */
  normalizeQuota(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const bonusBoosters = {};

    if (source.bonusBoosters && typeof source.bonusBoosters === 'object') {
      Object.entries(source.bonusBoosters).forEach(([setId, quantity]) => {
        if (Number.isInteger(quantity) && quantity > 0) {
          bonusBoosters[setId] = quantity;
        }
      });
    }

    return {
      lastResetDay: typeof source.lastResetDay === 'string' ? source.lastResetDay : null,
      dailyRemaining:
        Number.isInteger(source.dailyRemaining) && source.dailyRemaining >= 0 ? source.dailyRemaining : 0,
      bonusBoosters,
    };
  }

  /**
   * Reads and normalizes the quota from IndexedDB.
   *
   * @returns {Promise<{lastResetDay: string|null, dailyRemaining: number, bonusBoosters: Record<string, number>}>}
   *   The stored quota.
   * @throws {Error} When the read fails.
   */
  async readQuota() {
    return this.normalizeQuota(await storageRepository.getUserState(USER_STATE_KEYS.QUOTA));
  }

  /**
   * Applies the daily reset when the trusted UTC day changed.
   *
   * Rules:
   *   - never runs on a frozen clock (offline after a reload): no reset can be earned offline;
   *   - `dailyRemaining` is set back to the configured allowance (3 by default);
   *   - `bonusBoosters` is spread as-is: bonuses granted by redeem codes and gifts are never
   *     overwritten by the reset;
   *   - a stored day located in the future (tampered state) is left untouched and logged once.
   *
   * @returns {Promise<boolean>} True when a reset was applied.
   * @throws {Error} When the write fails.
   */
  async ensureDailyReset() {
    const quota = await this.readQuota();
    this.quota = quota;

    if (!this.timeTrusted) return false;

    const today = this.getCurrentUtcDay();
    if (!today || quota.lastResetDay === today) return false;

    if (quota.lastResetDay && quota.lastResetDay > today) {
      if (this.warnedFutureDay !== today) {
        this.warnedFutureDay = today;
        console.warn(
          `[DateSyncManager] The stored reset day (${quota.lastResetDay}) is ahead of the trusted day (${today}): the quota is left untouched.`
        );
      }
      return false;
    }

    const updated = { ...quota, lastResetDay: today, dailyRemaining: this.dailyFreeBoosters };
    await storageRepository.setUserState(USER_STATE_KEYS.QUOTA, updated);
    this.quota = updated;

    console.info(`[DateSyncManager] Daily reset applied for ${today}: ${this.dailyFreeBoosters} free boosters.`);
    this.emitQuotaUpdated(null);
    return true;
  }

  /**
   * Validates a booster set id against the extensions declared in `config.json`.
   *
   * `config.json` (`boosters.sets`) is the source of truth that `BoosterManager` (step 3) uses
   * to load `settings/boosters/<setId>.json`: an unknown id can therefore never receive a
   * bonus booster.
   *
   * @param {unknown} setId - Candidate extension id.
   * @returns {string} The normalized extension id.
   * @throws {TypeError} When the id is not a non-empty string.
   * @throws {RangeError} When the extension is not declared.
   */
  assertKnownSet(setId) {
    if (typeof setId !== 'string' || setId.trim() === '') {
      throw new TypeError(`setId must be a non-empty string (received: ${JSON.stringify(setId)}).`);
    }
    const key = setId.trim();
    if (!this.knownSets.includes(key)) {
      throw new RangeError(`Unknown booster set "${key}". Declared sets: [${this.knownSets.join(', ')}].`);
    }
    return key;
  }

  /**
   * Validates a booster quantity.
   *
   * @param {unknown} quantity - Candidate quantity.
   * @returns {number} The validated positive integer.
   * @throws {TypeError} When the value is not a number.
   * @throws {RangeError} When the value is not a strictly positive integer.
   */
  assertPositiveInteger(quantity) {
    if (typeof quantity !== 'number' || Number.isNaN(quantity)) {
      throw new TypeError(`quantity must be a number (received: ${JSON.stringify(quantity)}).`);
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new RangeError(`quantity must be a strictly positive integer (received: ${quantity}).`);
    }
    return quantity;
  }

  /**
   * Returns the remaining boosters for an extension.
   *
   * @param {string|null} [setId=null] - Extension used to compute `availableForSet`.
   * @returns {Promise<{daily: number, bonusBySet: Record<string, number>, bonusTotal: number, availableForSet: number|null}>}
   *   The quota after the daily reset check.
   * @throws {Error} When the stored quota cannot be read.
   */
  async getRemainingBoosters(setId = null) {
    await this.ensureDailyReset();
    return this.getQuotaSnapshot(setId);
  }

  /**
   * Consumes one booster for an extension.
   *
   * With the default source (`auto`) the daily quota is spent first, then the per-extension bonus
   * bucket. An explicit source (`daily` or `bonus`) only spends that bucket, which lets the UI ask
   * the player which booster to use when both are available.
   *
   * The read-modify-write runs inside a single IndexedDB transaction, so two rapid openings
   * cannot both consume the same last booster.
   *
   * @param {string} setId - Extension the booster is opened for.
   * @param {'auto'|'daily'|'bonus'} [source='auto'] - Bucket to consume.
   * @returns {Promise<boolean>} False when the requested bucket (or both, in `auto` mode) is empty.
   * @throws {TypeError|RangeError} When `setId` is invalid/unknown or `source` is invalid.
   * @throws {Error} When the transaction fails.
   */
  async consumeBooster(setId, source = BOOSTER_SOURCES.AUTO) {
    const key = this.assertKnownSet(setId);
    if (!Object.values(BOOSTER_SOURCES).includes(source)) {
      throw new RangeError(
        `Unknown booster source "${source}". Expected one of [${Object.values(BOOSTER_SOURCES).join(', ')}].`
      );
    }
    await this.ensureDailyReset();

    const result = await storageRepository.transaction(STORES.USER_STATE, 'readwrite', async (context) => {
      const quota = this.normalizeQuota(await context.get(STORES.USER_STATE, USER_STATE_KEYS.QUOTA));

      const spendDaily = () => {
        if (quota.dailyRemaining <= 0) return false;
        quota.dailyRemaining -= 1;
        return true;
      };
      const spendBonus = () => {
        if ((quota.bonusBoosters[key] ?? 0) <= 0) return false;
        quota.bonusBoosters[key] -= 1;
        if (quota.bonusBoosters[key] === 0) {
          delete quota.bonusBoosters[key];
        }
        return true;
      };

      const consumed =
        source === BOOSTER_SOURCES.DAILY
          ? spendDaily()
          : source === BOOSTER_SOURCES.BONUS
            ? spendBonus()
            : spendDaily() || spendBonus();

      if (!consumed) {
        return { consumed: false, quota };
      }

      await context.put(STORES.USER_STATE, quota, USER_STATE_KEYS.QUOTA);
      return { consumed: true, quota };
    });

    this.quota = result.quota;
    if (result.consumed) {
      this.emitQuotaUpdated(key);
    }
    return result.consumed;
  }

  /**
   * Grants bonus boosters for one extension.
   *
   * Used by the redeem codes (step 7) and by the gifts (step 8). The bonuses are never
   * overwritten by the daily reset and are stored per extension.
   *
   * @param {string} setId - Extension the boosters belong to.
   * @param {number} quantity - Number of boosters to grant (strictly positive integer).
   * @param {object} [context=null] - Optional `StorageRepository.transaction` context to join
   *   instead of opening a new transaction. Used by the redeem codes (step 9), which credit
   *   several rewards atomically: the caller owns the transaction and is responsible for the
   *   daily reset, because `ensureDailyReset()` opens its own transaction. The in-memory quota
   *   mirror is NOT updated in that mode: the caller re-reads the quota from the database after
   *   the commit (`getRemainingBoosters`).
   * @returns {Promise<object>} The quota after the grant (a snapshot on the standalone path, the
   *   stored record on the shared-context path).
   * @throws {TypeError|RangeError} When `setId` is invalid/unknown or `quantity` is invalid.
   * @throws {Error} When the transaction fails.
   */
  async addBonusBoosters(setId, quantity, context = null) {
    const key = this.assertKnownSet(setId);
    const amount = this.assertPositiveInteger(quantity);

    if (context) {
      const quota = this.normalizeQuota(await context.get(STORES.USER_STATE, USER_STATE_KEYS.QUOTA));
      const next = {
        ...quota,
        bonusBoosters: { ...quota.bonusBoosters, [key]: (quota.bonusBoosters[key] ?? 0) + amount },
      };
      await context.put(STORES.USER_STATE, next, USER_STATE_KEYS.QUOTA);
      return next;
    }

    await this.ensureDailyReset();

    const updated = await storageRepository.transaction(STORES.USER_STATE, 'readwrite', async (transactionContext) => {
      const quota = this.normalizeQuota(await transactionContext.get(STORES.USER_STATE, USER_STATE_KEYS.QUOTA));
      const bonusBoosters = { ...quota.bonusBoosters, [key]: (quota.bonusBoosters[key] ?? 0) + amount };
      const next = { ...quota, bonusBoosters };

      await transactionContext.put(STORES.USER_STATE, next, USER_STATE_KEYS.QUOTA);
      return next;
    });

    this.quota = updated;
    this.emitQuotaUpdated(key);
    return this.getQuotaSnapshot(key);
  }

  /**
   * Notifies the application that the quota changed (`EVENTS.QUOTA_UPDATED`).
   *
   * @param {string|null} [setId=null] - Extension used to compute `availableForSet`.
   * @returns {void}
   */
  emitQuotaUpdated(setId = null) {
    eventBus.emit(EVENTS.QUOTA_UPDATED, this.getQuotaSnapshot(setId));
  }

  /**
   * Formats the time remaining before the next daily reset (00:00:00 UTC).
   *
   * Computed from the trusted estimate, never from the system clock. On a frozen clock the
   * countdown appears stuck, which is the honest reading of "the time is no longer known".
   * The UI can rely on `isTimeTrusted()` to add a hint.
   *
   * @returns {string} `HH:MM:SS`, or `--:--:--` when the clock was never anchored.
   */
  getFormattedTimeUntilReset() {
    if (!this.anchor) return '--:--:--';

    const now = this.getEstimatedUtcMs();
    const date = new Date(now);
    const nextMidnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1, 0, 0, 0, 0);
    return formatDuration(nextMidnight - now);
  }

  /**
   * Starts the one-second clock.
   *
   * It is the single timer of the application: the header follows it through `CLOCK_TICK`
   * instead of running its own interval.
   *
   * @returns {void}
   */
  startClock() {
    if (this.clockTimer !== null) return;
    this.tick();
    this.clockTimer = setInterval(() => this.tick(), CLOCK_INTERVAL_MS);
    this.startResyncTimer();
  }

  /**
   * Stops the clock and the periodic resynchronization.
   *
   * @returns {void}
   */
  stopClock() {
    if (this.clockTimer !== null) {
      clearInterval(this.clockTimer);
      this.clockTimer = null;
    }
    if (this.resyncTimer !== null) {
      clearInterval(this.resyncTimer);
      this.resyncTimer = null;
    }
  }

  /**
   * Re-synchronizes the clock periodically so the anchor stays fresh and a long-running tab
   * keeps a bounded drift.
   *
   * @returns {void}
   */
  startResyncTimer() {
    if (this.resyncTimer !== null || this.resyncIntervalMs <= 0) return;
    this.resyncTimer = setInterval(() => this.syncTime('periodic'), this.resyncIntervalMs);
  }

  /**
   * One clock tick: refreshes the last known UTC value, applies the daily reset when the UTC
   * day changed while the page stayed open, then publishes the time to every listener.
   *
   * Never throws: a failure is logged so the interval keeps running.
   *
   * @returns {Promise<void>} Resolves once the tick is published.
   */
  async tick() {
    try {
      const utcMs = this.getEstimatedUtcMs();
      const utc = new Date(utcMs);
      const day = this.timeTrusted ? this.getCurrentUtcDay() : null;

      if (day && this.quota && this.quota.lastResetDay && day > this.quota.lastResetDay) {
        await this.ensureDailyReset();
      }

      eventBus.emit(EVENTS.CLOCK_TICK, {
        utc,
        formatted: utcMs > 0 ? formatClockTime(utcMs) : '--:--:--',
        timeUntilReset: this.getFormattedTimeUntilReset(),
      });
    } catch (error) {
      console.warn('[DateSyncManager] Clock tick failed.', error);
    }
  }

  /**
   * Re-synchronizes when the browser reports that the connection is back.
   *
   * Only registered once; the handler cannot be removed by `stopClock()` (the manager lives as
   * long as the page), which is intended.
   *
   * @returns {void}
   */
  bindNetworkEvents() {
    if (this.onlineHandler || typeof window === 'undefined') return;

    this.onlineHandler = () => {
      this.syncTime('online');
    };
    window.addEventListener('online', this.onlineHandler);
  }

  /**
   * Releases the timers and the network listener (used by a full reset).
   *
   * @returns {void}
   */
  destroy() {
    this.stopClock();
    if (this.onlineHandler) {
      window.removeEventListener('online', this.onlineHandler);
      this.onlineHandler = null;
    }
    this.anchor = null;
    this.quota = null;
    this.timeTrusted = false;
    this.isInitialized = false;
  }
}

/** Shared instance used by the booster manager (step 3), the views and `app.js`. */
export const dateSyncManager = new DateSyncManager();

export default dateSyncManager;


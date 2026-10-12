/**
 * AccountManager - Local account lifecycle (creation, read, settings, full reset).
 *
 * Reference: `.docs/main.md` sections 2 and 3.A, `.docs/steps/1.md` point 7.
 *
 * There is no server: the account is the presence of `user_state["account"]`, holding an
 * immutable UUID generated with the Web Crypto API. That UUID identifies the player for the
 * redeem codes (step 7) and the Google Sheet distributions (step 8), so it is never
 * regenerated: importing a `.save` restores the original UUID (step 6).
 *
 * Created state, all written in one atomic transaction:
 *   - `account`   : { uuid, createdAt }
 *   - `settings`  : { lang, theme, sound }
 *   - `quota`     : { lastResetDay, dailyRemaining, bonusBoosters }
 *   - `stats`     : { boostersOpened, drawsByRarity, drawsByCard }
 *   - `giftSync`  : { lastCheckedLine, lastCheckAt }
 *   - `sparks`    : number (starting balance of the Sparks currency)
 *   - `profile`   : { name, photo, favorites, featured } (created at the first boot, see
 *     `js/business/ProfileManager.js`)
 *   - `trophies`  : { unlocked } (created at the first boot, see `js/business/TrophyManager.js`)
 *
 * Timestamps note: `account.createdAt` is informational metadata produced with the system
 * clock. It must never be used for quota or expiration logic: the trusted clock is owned by
 * `DateSyncManager` (step 2), which never relies on `Date.now()`.
 */

import { storageRepository, STORES } from '../models/StorageRepository.js';
import { configLoader } from '../utils/ConfigLoader.js';
import i18n, { clearMirroredLang } from '../utils/I18n.js';
import themeManager, { clearMirroredTheme } from '../utils/ThemeManager.js';
import eventBus, { EVENTS } from '../utils/EventBus.js';

/** `user_state` keys, exactly as defined in `main.md` section 2. */
export const USER_STATE_KEYS = Object.freeze({
  ACCOUNT: 'account',
  SETTINGS: 'settings',
  QUOTA: 'quota',
  TIME_ANCHOR: 'timeAnchor',
  STATS: 'stats',
  GIFT_SYNC: 'giftSync',
  BOOSTER_HISTORY: 'boosterHistory',
  SPARKS: 'sparks',
  PROFILE: 'profile',
  TROPHIES: 'trophies',
});

/** RFC 4122 version 4 UUID pattern, used to validate generated and imported identifiers. */
export const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Checks whether a value is a valid version 4 UUID.
 *
 * Shared with the `.save` import validation (step 6).
 *
 * @param {unknown} value - Candidate identifier.
 * @returns {boolean} True when the value is a v4 UUID string.
 */
export function isUuid(value) {
  return typeof value === 'string' && UUID_V4_PATTERN.test(value.trim());
}

/**
 * Generates a version 4 UUID.
 *
 * `crypto.randomUUID()` is preferred; a `crypto.getRandomValues()` fallback covers browsers
 * that do not expose it yet. `Math.random()` is never used: the UUID is a security-relevant
 * identifier for gifts and redeem codes.
 *
 * @returns {string} A lowercase v4 UUID.
 * @throws {Error} When the Web Crypto API is unavailable (insecure context without a fallback).
 */
export function generateUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    throw new Error(
      'The Web Crypto API is unavailable: a UUID cannot be generated. Serve the app over HTTPS or localhost.'
    );
  }

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 1
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Builds the initial quota state.
 *
 * `lastResetDay` stays null so `DateSyncManager` (step 2) performs the first day comparison
 * itself; `bonusBoosters` is keyed by set id and is never cleared by the daily reset.
 *
 * @param {number} dailyFreeBoosters - Number of free boosters granted each UTC day.
 * @returns {{lastResetDay: null, dailyRemaining: number, bonusBoosters: Record<string, number>}}
 *   A fresh quota state.
 */
export function buildDefaultQuota(dailyFreeBoosters = 3) {
  return {
    lastResetDay: null,
    dailyRemaining: dailyFreeBoosters,
    bonusBoosters: {},
  };
}

/**
 * Builds the initial statistics state.
 *
 * @returns {{boostersOpened: number, drawsByRarity: Record<string, number>, drawsByCard: Record<string, number>}}
 *   A fresh statistics state with every rarity initialized to zero.
 */
export function buildDefaultStats() {
  return {
    boostersOpened: 0,
    drawsByRarity: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    drawsByCard: {},
  };
}

/**
 * Builds the initial gift synchronization state.
 *
 * `lastCheckedLine = 1` because line 1 of the Google Sheet is the header row (step 8).
 *
 * @returns {{lastCheckedLine: number, lastCheckAt: null}} A fresh gift sync state.
 */
export function buildDefaultGiftSync() {
  return {
    lastCheckedLine: 1,
    lastCheckAt: null,
  };
}

export class AccountManager {
  /**
   * Checks whether a local account exists.
   *
   * The mere presence of a valid `user_state["account"].uuid` means "an account exists".
   *
   * @returns {Promise<boolean>} True when the app must skip the onboarding screen.
   * @throws {Error} When the read fails.
   */
  async hasAccount() {
    const account = await storageRepository.getUserState(USER_STATE_KEYS.ACCOUNT);
    return Boolean(account && isUuid(account.uuid));
  }

  /**
   * Reads the stored account.
   *
   * @returns {Promise<{uuid: string, createdAt: string}|null>} The account, or null when absent.
   * @throws {Error} When the read fails.
   */
  async getAccount() {
    const account = await storageRepository.getUserState(USER_STATE_KEYS.ACCOUNT);
    return account && isUuid(account.uuid) ? account : null;
  }

  /**
   * Reads the UUID of the account (read-only, never regenerated).
   *
   * @returns {Promise<string|null>} The UUID, or null when no account exists.
   * @throws {Error} When the read fails.
   */
  async getUuid() {
    const account = await this.getAccount();
    return account ? account.uuid : null;
  }

  /**
   * Creates the local account and every initial state entry, in a single transaction.
   *
   * Also requests persistent storage (`navigator.storage.persist()`) to reduce the risk of the
   * browser evicting the data; a refusal is logged but not fatal.
   *
   * @param {object} [options] - Creation options.
   * @param {string|null} [options.lang] - Forced initial language (must be declared in `config.json`).
   * @param {string|null} [options.theme] - Forced initial theme (must be declared in `config.json`).
   * @param {boolean} [options.force=false] - Overwrite an existing account. Reserved for the
   *   `.save` import of step 6; the normal flow never overwrites (the UUID is immutable).
   * @returns {Promise<{uuid: string, createdAt: string, settings: {lang: string, theme: string, sound: boolean}}>}
   *   The created account and the resolved preferences.
   * @throws {Error} When an account already exists without `force`, or when the write fails.
   */
  async createAccount({ lang = null, theme = null, force = false } = {}) {
    if (!force && (await this.hasAccount())) {
      throw new Error('An account already exists: the UUID is immutable and cannot be regenerated.');
    }

    const settings = await this.buildInitialSettings({ lang, theme });
    const { dailyFreeBoosters } = await this.getDailyFreeBoosters();
    const uuid = generateUuid();
    const createdAt = new Date().toISOString();
    const account = { uuid, createdAt };
    const quota = buildDefaultQuota(dailyFreeBoosters);
    const stats = buildDefaultStats();
    const giftSync = buildDefaultGiftSync();

    await storageRepository.transaction(STORES.USER_STATE, 'readwrite', async (context) => {
      await context.put(STORES.USER_STATE, account, USER_STATE_KEYS.ACCOUNT);
      await context.put(STORES.USER_STATE, settings, USER_STATE_KEYS.SETTINGS);
      await context.put(STORES.USER_STATE, quota, USER_STATE_KEYS.QUOTA);
      await context.put(STORES.USER_STATE, stats, USER_STATE_KEYS.STATS);
      await context.put(STORES.USER_STATE, giftSync, USER_STATE_KEYS.GIFT_SYNC);
      await context.put(STORES.USER_STATE, 0, USER_STATE_KEYS.SPARKS);
    });

    await this.requestPersistence();
    eventBus.emit(EVENTS.ACCOUNT_CREATED, { uuid });

    return { uuid, createdAt, settings };
  }

  /**
   * Resolves the initial settings.
   *
   * Language resolution order: explicit argument, language already applied by `I18n` (the user
   * may have used the onboarding language picker), browser language limited to the declared
   * languages, then the `config.json` default. The theme defaults to `dark` through the
   * `config.json` default.
   *
   * @param {{lang?: string|null, theme?: string|null}} [overrides] - Requested preferences.
   * @returns {Promise<{lang: string, theme: string, sound: boolean}>} Validated preferences.
   * @throws {Error} When `config.json` cannot be loaded.
   */
  async buildInitialSettings(overrides = {}) {
    const availableLangs = await configLoader.getLanguages();
    const defaultLang = await configLoader.getDefaultLang();
    const availableThemes = themeManager.getAvailableThemes();
    const defaultTheme = themeManager.getTheme() || (await configLoader.getDefaultTheme());

    const langCandidates = [overrides.lang, i18n.getLang(), i18n.detectBrowserLang(), defaultLang];
    const lang = langCandidates.find((candidate) => availableLangs.includes(candidate)) || defaultLang;

    const themeCandidates = [overrides.theme, themeManager.getTheme(), defaultTheme];
    const theme = themeCandidates.find((candidate) => availableThemes.includes(candidate)) || defaultTheme;

    return { lang, theme, sound: overrides.sound !== false };
  }

  /**
   * Reads the number of free boosters granted each day (3 by default).
   *
   * @returns {Promise<{dailyFreeBoosters: number}>} The configured daily allowance.
   * @throws {Error} When `config.json` cannot be loaded.
   */
  async getDailyFreeBoosters() {
    const { dailyFreeBoosters } = await configLoader.getBoosterSettings();
    return { dailyFreeBoosters };
  }

  /**
   * Requests persistent storage so the browser is less likely to evict the database
   * (called on the very first launch, as required by `main.md` section 3.A).
   *
   * @returns {Promise<boolean>} True when the storage is (already) persistent.
   */
  async requestPersistence() {
    if (!navigator.storage || typeof navigator.storage.persist !== 'function') {
      console.warn('[AccountManager] navigator.storage.persist() is not supported by this browser.');
      return false;
    }

    try {
      if (typeof navigator.storage.persisted === 'function' && (await navigator.storage.persisted())) {
        return true;
      }
      const granted = await navigator.storage.persist();
      console.info(`[AccountManager] Persistent storage ${granted ? 'granted' : 'refused'} by the browser.`);
      return granted;
    } catch (error) {
      console.warn('[AccountManager] Unable to request persistent storage.', error);
      return false;
    }
  }

  /**
   * Reads the account settings, completed with safe defaults.
   *
   * @returns {Promise<{lang: string, theme: string, sound: boolean}>} The stored preferences.
   * @throws {Error} When the read or the configuration loading fails.
   */
  async getSettings() {
    const stored = await storageRepository.getUserState(USER_STATE_KEYS.SETTINGS);
    const defaults = await this.buildInitialSettings();
    if (!stored || typeof stored !== 'object') return defaults;

    return {
      lang: typeof stored.lang === 'string' && stored.lang !== '' ? stored.lang : defaults.lang,
      theme: typeof stored.theme === 'string' && stored.theme !== '' ? stored.theme : defaults.theme,
      // `false` is the only way to silence the app, so any other stored value (missing, legacy
      // save, garbage) falls back to the enabled default instead of muting by accident.
      sound: typeof stored.sound === 'boolean' ? stored.sound : defaults.sound,
    };
  }

  /**
   * Merges and persists the account settings.
   *
   * Only `lang`, `theme` and `sound` are accepted; unknown keys are ignored. Values are
   * validated against `config.json` as soon as the corresponding lists are loaded, so a typo
   * cannot silently break the next startup. Applying the new values (calling `I18n.setLang`,
   * `ThemeManager.applyTheme` and `SoundManager.setEnabled`) remains the caller's responsibility.
   *
   * @param {{lang?: string, theme?: string, sound?: boolean}} partialSettings - Preferences to
   *   update.
   * @returns {Promise<{lang: string, theme: string, sound: boolean}>} The merged settings.
   * @throws {TypeError} When the argument or a provided value is invalid.
   * @throws {RangeError} When a provided value is not declared in `config.json`.
   * @throws {Error} When the write fails.
   */
  async updateSettings(partialSettings = {}) {
    if (!partialSettings || typeof partialSettings !== 'object' || Array.isArray(partialSettings)) {
      throw new TypeError('AccountManager.updateSettings expects a plain object.');
    }

    const merged = await this.getSettings();
    const availableLangs = i18n.getAvailableLangs();
    const availableThemes = themeManager.getAvailableThemes();

    if (Object.prototype.hasOwnProperty.call(partialSettings, 'lang')) {
      const { lang } = partialSettings;
      if (typeof lang !== 'string' || lang.trim() === '') {
        throw new TypeError(`settings.lang must be a non-empty string (received: ${JSON.stringify(lang)}).`);
      }
      if (availableLangs.length > 0 && !availableLangs.includes(lang)) {
        throw new RangeError(`Unknown language "${lang}". Available: [${availableLangs.join(', ')}].`);
      }
      merged.lang = lang;
    }

    if (Object.prototype.hasOwnProperty.call(partialSettings, 'theme')) {
      const { theme } = partialSettings;
      if (typeof theme !== 'string' || theme.trim() === '') {
        throw new TypeError(`settings.theme must be a non-empty string (received: ${JSON.stringify(theme)}).`);
      }
      if (availableThemes.length > 0 && !availableThemes.includes(theme)) {
        throw new RangeError(`Unknown theme "${theme}". Available: [${availableThemes.join(', ')}].`);
      }
      merged.theme = theme;
    }

    if (Object.prototype.hasOwnProperty.call(partialSettings, 'sound')) {
      const { sound } = partialSettings;
      if (typeof sound !== 'boolean') {
        throw new TypeError(`settings.sound must be a boolean (received: ${JSON.stringify(sound)}).`);
      }
      merged.sound = sound;
    }

    await storageRepository.setUserState(USER_STATE_KEYS.SETTINGS, merged);
    return merged;
  }

  /**
   * Performs a full reset: every store is cleared (the UUID included) and the pre-render
   * mirrors are removed, so the app returns to the onboarding screen on the next start
   * ("Réinitialisation complète" of `main.md` section 3.A).
   *
   * @returns {Promise<void>} Resolves once the reset is committed.
   * @throws {Error} When the clearing fails.
   */
  async resetAll() {
    await storageRepository.clearAll();
    clearMirroredLang();
    clearMirroredTheme();
    eventBus.emit(EVENTS.ACCOUNT_REMOVED, null);
  }
}

/** Shared instance used by the onboarding view, the settings view (step 6) and `app.js`. */
export const accountManager = new AccountManager();

export default accountManager;

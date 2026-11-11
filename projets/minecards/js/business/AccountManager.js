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
 *   - `settings`  : { lang, cardLang, theme, sound, soundCategories, animation, foilIntensity,
 *                   glareIntensity, glowTrophies, notificationDuration, notificationTypes,
 *                   boosterRenderMode, nativeScrollbars }
 *   - `quota`     : { lastResetDay, dailyRemaining, bonusBoosters }
 *   - `stats`     : { boostersOpened, godpacksOpened, boostersOpenedBySet, drawsByRarity,
 *                   drawsByCard, soldByRarity, questsCompleted, daysConnected, cardsSold,
 *                   sparksEarned, sparksSpent, sparksEarnedBySource, sparksSpentBySource }
 *     `questsCompleted`, `daysConnected` and `cardsSold` are created retroactively on boot from
 *     `illagerQuests`, `dailyRewards` and `soldByRarity` for a save written before they existed
 *     (see `ensureStatistics()`).
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
import cardLanguage, { CARD_LANG_AUTO, clearMirroredCardLang } from '../utils/CardLanguage.js';
import themeManager, { clearMirroredTheme } from '../utils/ThemeManager.js';
import animationManager from '../utils/AnimationManager.js';
import glowManager from '../utils/GlowManager.js';
import foilManager from '../utils/FoilManager.js';
import eventBus, { EVENTS } from '../utils/EventBus.js';
import { DEFAULT_SOUND_CATEGORIES, SoundManager } from '../utils/SoundManager.js';
import { ILLAGER_QUESTS_STATE_KEY, countClaimedQuests } from './IllagerQuestState.js';

/** `user_state` keys, exactly as defined in `main.md` section 2. */
export const USER_STATE_KEYS = Object.freeze({
  ACCOUNT: 'account',
  SETTINGS: 'settings',
  QUOTA: 'quota',
  TIME_ANCHOR: 'timeAnchor',
  STATS: 'stats',
  GIFT_SYNC: 'giftSync',
  BOOSTER_HISTORY: 'boosterHistory',
  // Openings the player pinned from the statistics screen to keep them forever (see
  // `BoosterManager.saveOpening()`): at most `SAVED_OPENINGS_SIZE` slots, never reset.
  SAVED_OPENINGS: 'savedOpenings',
  SPARKS: 'sparks',
  PROFILE: 'profile',
  TROPHIES: 'trophies',
  // Daily state, statistics and history of the Mine Pick (see `MinePickManager`).
  MINE_PICK: 'minePick',
  // Daily allowance, resources and statistics of the Mine (see `MiningManager`).
  MINING: 'mining',
  // Weekly shop of the Wandering Trader: the Monday its purchases belong to, and how many times
  // each offer was bought (see `TraderManager`).
  TRADER: 'trader',
  ILLAGER_SHOP: 'illagerShop',
  // Monthly allowance of the booster shop: the `YYYY-MM` month it belongs to and how many packs
  // were bought in it (see `BoosterManager`). Kept in `user_state` so a `.save` carries it.
  BOOSTER_SHOP: 'boosterShop',
  // Monthly allowance of the block-bundle shop (see `MiningManager`): its own month and count, so
  // buying boosters can never consume a bundle purchase or the other way round.
  BUNDLE_SHOP: 'bundleShop',
  // Personal binders (see `BinderManager`). A single value: the array of binders, in creation
  // order. It lives in `user_state` rather than in a store of its own so that a `.save` export
  // carries it with no change to the save format.
  BINDERS: 'binders',
  // Purchased features (see `FeatureManager`): one entry per bought feature, so a `.save` carries
  // what the player paid for like any other progression.
  PURCHASES: 'purchases',
  // Display preferences of the profile card (see `ProfileCardManager`): the layout the player chose
  // and the rarity the card wears, both optional. Kept out of `profile` on purpose: the profile is
  // the identity other screens read, while these two only dress the card.
  PROFILE_CARD: 'profileCard',
  // Upcoming extensions already announced to this account (see `SetAnnouncementManager`).
  SET_ANNOUNCEMENTS: 'setAnnouncements',
  // Run of the daily connection rewards (see `DailyRewardManager`): the chapter it belongs to, the
  // number of rewards already claimed in it, the day of the last claim and the `UniqueID`s already
  // handed out.
  DAILY_REWARDS: 'dailyRewards',
  // Highest `Id` of `settings/changelog.json` the player has opened (see `ChangelogManager`): what
  // the "new version" badge of the settings button is measured against.
  CHANGELOG_SEEN: 'changelogSeen',
  // Highest release announced by the startup popup (see `ChangelogManager` and
  // `js/UI/components/ChangelogPopup.js`). Distinct from `CHANGELOG_SEEN` on purpose: the popup
  // is shown ONCE per version, whether or not the player then opens the full notes, while the dot
  // of the settings button keeps meaning "notes you have not opened yet".
  CHANGELOG_ANNOUNCED: 'changelogAnnounced',
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
 * `soldByRarity` counts the copies sold to the shop (see `SparksManager.sellCard`), not the
 * copies obtained: the two counters answer different questions and must not be merged.
 *
 * @returns {{boostersOpened: number, godpacksOpened: number, drawsByRarity: Record<string, number>,
 *   drawsByCard: Record<string, number>, soldByRarity: Record<string, number>, questsCompleted: number,
 *   daysConnected: number, cardsSold: number, sparksEarned: number,
 *   sparksSpent: number, sparksEarnedBySource: Record<string, number>,
 *   sparksSpentBySource: Record<string, number>}}
 *   A fresh statistics state with every rarity initialized to zero.
 */
export function buildDefaultStats() {
  return {
    boostersOpened: 0,
    godpacksOpened: 0,
    drawsByRarity: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    drawsByCard: {},
    soldByRarity: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    // Account-wide counters added after the first saves: `ensureStatistics()` fills them once
    // from the quests, the daily rewards and the sales already recorded.
    questsCompleted: 0,
    daysConnected: 0,
    cardsSold: 0,
    sparksEarned: 0,
    sparksSpent: 0,
    sparksEarnedBySource: {},
    sparksSpentBySource: {},
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
   * @param {{lang?: string|null, cardLang?: string|null, theme?: string|null, sound?: boolean|null,
   *   soundCategories?: Record<string, {enabled: boolean, volume: number}>|null,
   *   animation?: string|null, foilIntensity?: number|null, glareIntensity?: number|null,
   *   glowTrophies?: number|null, notificationDuration?: number|null,
   *   notificationTypes?: Record<string, boolean>|null, devMode?: boolean|null,
   *   boosterRenderMode?: string|null}} [overrides] -
   *   Requested preferences.
   * @returns {Promise<{lang: string, cardLang: string, theme: string, sound: boolean,
   *   soundCategories: Record<string, {enabled: boolean, volume: number}>, animation: string,
   *   foilIntensity: number, glareIntensity: number, glowTrophies: number,
   *   notificationDuration: number, notificationTypes: Record<string, boolean>,
   *   devMode: boolean, boosterRenderMode: string}>} Validated preferences.
   * @throws {Error} When `config.json` cannot be loaded.
   */
  async buildInitialSettings(overrides = {}) {
    const availableLangs = await configLoader.getLanguages();
    const defaultLang = await configLoader.getDefaultLang();
    const availableThemes = themeManager.getAvailableThemes();
    const defaultTheme = themeManager.getTheme() || (await configLoader.getDefaultTheme());

    const langCandidates = [overrides.lang, i18n.getLang(), i18n.detectBrowserLang(), defaultLang];
    const lang = langCandidates.find((candidate) => availableLangs.includes(candidate)) || defaultLang;

    // The cards have their own language (see `js/utils/CardLanguage.js`): `auto` follows the
    // browser, limited to the languages the catalogues are written in, and falls back to English.
    // A new account keeps the preference already applied on this device (onboarding, previous
    // session), so the cards never jump back to `auto` after a save export/import.
    const cardLangCandidates = [overrides.cardLang, cardLanguage.getPreference(), CARD_LANG_AUTO];
    const cardLang =
      cardLangCandidates.map((candidate) => cardLanguage.normalizePreference(candidate)).find(Boolean) ??
      CARD_LANG_AUTO;

    const themeCandidates = [overrides.theme, themeManager.getTheme(), defaultTheme];
    const theme = themeCandidates.find((candidate) => availableThemes.includes(candidate)) || defaultTheme;

    // The animation mode follows `config.json` (`animations.default`, "epic" today), so a new
    // account never starts in a joke mode by accident.
    const availableAnimations = animationManager.getAvailableModes();
    const defaultAnimation = animationManager.defaultMode;
    const animationCandidates = [overrides.animation, animationManager.getMode(), defaultAnimation];
    const animation =
      animationCandidates.find((candidate) => availableAnimations.includes(candidate)) ||
      defaultAnimation;

    // The foil intensity follows `config.json` (`foil.default`, "100" today) as well, so a new
    // account always starts at the intensity the foil was designed for. The brillance (the sweeping
    // line of the same foil) has its own range and its own default, right next to it.
    const foilIntensity =
      typeof overrides.foilIntensity === 'number' && Number.isFinite(overrides.foilIntensity)
        ? foilManager.sanitizePercent(overrides.foilIntensity)
        : foilManager.getSettings().default;
    const glareIntensity =
      typeof overrides.glareIntensity === 'number' && Number.isFinite(overrides.glareIntensity)
        ? foilManager.sanitizeGlarePercent(overrides.glareIntensity)
        : foilManager.getGlareSettings().default;

    // The trophy glow is a LEVEL (0-5, 2 by default), with its own range next to the foil above.
    // A brand new account starts at the intensity the halos were tuned at.
    const glowTrophies =
      typeof overrides.glowTrophies === 'number' && Number.isFinite(overrides.glowTrophies)
        ? glowManager.sanitizeLevel(overrides.glowTrophies)
        : glowManager.getSettings().default;

    // The notifications have their own block (`notifications` of `config.json`): the duration is in
    // SECONDS and every known kind starts enabled. A new account therefore hears about everything
    // the game grants, and can shorten or silence it from the settings screen.
    const notificationSettings = await configLoader.getNotificationSettings();
    const notificationDuration = AccountManager.sanitizeNotificationDuration(
      overrides.notificationDuration,
      notificationSettings.duration
    );

    // The automatic mining (Shift+Space held, or a finger kept on the block) has its own speed: the
    // historical beat of `mining.keyHoldIntervalMs` is "normal", a new account starts there.
    const mineSpeed = AccountManager.sanitizeMineSpeed(overrides.mineSpeed);
    const notificationTypes = AccountManager.normalizeNotificationTypes(
      overrides.notificationTypes,
      notificationSettings.types
    );

    // The rendering of the 3D booster follows `boosterRender.defaultMode` of `config.json`
    // ("blister" today): the default look of the pack is a design choice, not a leftover of the
    // first implementation. A stored mode that disappeared from the configuration falls back to it.
    const boosterRender = await configLoader.getBoosterRenderSettings();
    const boosterRenderMode =
      typeof overrides.boosterRenderMode === 'string' &&
      boosterRender.modes.some((mode) => mode.id === overrides.boosterRenderMode)
        ? overrides.boosterRenderMode
        : boosterRender.defaultMode;

    // `devMode` is off unless it was explicitly asked for: it only adds a tool to the collection
    // (the key of the open card and a copy button) and the booster render picker, never anything a
    // player would want by default.
    // `nativeScrollbars` is off as well: the game ships its own thin indicator, and a player who
    // prefers the bar of the system asks for it from the settings screen.
    return {
      lang,
      cardLang,
      theme,
      sound: overrides.sound !== false,
      soundCategories: SoundManager.normalizeCategories(
        overrides.soundCategories ?? DEFAULT_SOUND_CATEGORIES
      ),
      animation,
      foilIntensity,
      glareIntensity,
      glowTrophies,
      notificationDuration,
      notificationTypes,
      mineSpeed,
      devMode: overrides.devMode === true,
      boosterRenderMode,
      nativeScrollbars: overrides.nativeScrollbars === true,
      // Quest guidance is ON by default: "Y aller" walks the player through the screens instead of
      // teleporting them, which is what makes the button teach the interface.
      questNavigationTutorial: overrides.questNavigationTutorial !== false,
      // The "new version" dialog is ON by default: a save that already exists should hear about what
      // changed, and the switch of the release-notes tab is there to silence it (see `app.js`).
      announceChangelog: overrides.announceChangelog !== false,
    };
  }

  /**
   * Brings a mining speed back into the three modes the settings slider offers.
   *
   * The value is an id, not a number, so an unknown one is replaced instead of clamped: a beat has
   * no "closest" mode that would make sense to guess.
   *
   * @param {unknown} value - Requested speed (`normal`, `fast` or `veryFast`).
   * @returns {string} A declared speed, `normal` when the value is missing or unknown.
   */
  static sanitizeMineSpeed(value) {
    return MINE_SPEEDS.includes(value) ? value : DEFAULT_MINE_SPEED;
  }

  /**
   * Brings a notification duration back into the declared range.
   *
   * The value is whole SECONDS. A missing or corrupted value reads as the configured default, and a
   * value outside the range is clamped rather than rejected: a save written with an older range
   * must keep loading, it simply lands on the closest duration the slider offers.
   *
   * @param {unknown} value - Requested duration, in seconds.
   * @param {{min: number, max: number, step: number, default: number}} range - Declared bounds.
   * @returns {number} A whole duration inside the range.
   */
  static sanitizeNotificationDuration(value, range) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return range.default;
    return Math.min(range.max, Math.max(range.min, Math.round(value)));
  }

  /**
   * Normalizes the per-kind switches of the notifications.
   *
   * Only the known kinds are kept, and only an explicit `false` turns one off: a missing key (an
   * older save, a save written before a kind existed) reads as enabled, exactly like the sound
   * preference reads a missing value as on.
   *
   * @param {unknown} value - Stored or requested map of kinds.
   * @param {string[]} types - Kinds the configuration declares.
   * @returns {Record<string, boolean>} One boolean per known kind.
   */
  static normalizeNotificationTypes(value, types) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const normalized = {};
    types.forEach((type) => {
      normalized[type] = source[type] !== false;
    });
    return normalized;
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
   * Creates the account-wide statistics added after the first saves.
   *
   * The three counters are derived from data that already exists, so importing an old save adopts
   * its history instead of starting the medals at zero:
   *   - `questsCompleted` counts the Illager quests whose `claimedAt` is set;
   *   - `daysConnected` reads the run position of the daily rewards (the only connection history
   *     the save keeps);
   *   - `cardsSold` sums `soldByRarity`.
   *
   * Only a MISSING counter is filled: an existing zero is a real value and is never replaced.
   *
   * @returns {Promise<boolean>} True when a counter was written.
   * @throws {Error} When the state cannot be read or written.
   */
  async ensureStatistics() {
    return storageRepository.transaction(STORES.USER_STATE, 'readwrite', async (context) => {
      const rawStats = await context.get(STORES.USER_STATE, USER_STATE_KEYS.STATS);
      if (!rawStats || typeof rawStats !== 'object' || Array.isArray(rawStats)) return false;
      const stats = { ...rawStats };
      let changed = false;

      if (!Number.isInteger(stats.questsCompleted) || stats.questsCompleted < 0) {
        const questState = await context.get(STORES.USER_STATE, ILLAGER_QUESTS_STATE_KEY);
        stats.questsCompleted = countClaimedQuests(questState);
        changed = true;
      }
      if (!Number.isInteger(stats.daysConnected) || stats.daysConnected < 0) {
        const daily = await context.get(STORES.USER_STATE, USER_STATE_KEYS.DAILY_REWARDS);
        stats.daysConnected =
          Number.isInteger(daily?.progress) && daily.progress >= 0 ? daily.progress : 0;
        changed = true;
      }
      if (!Number.isInteger(stats.cardsSold) || stats.cardsSold < 0) {
        stats.cardsSold = AccountManager.sumSoldByRarity(stats.soldByRarity);
        changed = true;
      }

      if (!changed) return false;
      await context.put(STORES.USER_STATE, stats, USER_STATE_KEYS.STATS);
      return true;
    });
  }

  /**
   * Sums the per-rarity sale counters.
   *
   * @param {unknown} soldByRarity - Stored `soldByRarity` map.
   * @returns {number} The total number of copies sold.
   */
  static sumSoldByRarity(soldByRarity) {
    if (!soldByRarity || typeof soldByRarity !== 'object') return 0;
    return Object.values(soldByRarity).reduce(
      (sum, count) => sum + (Number.isInteger(count) && count > 0 ? count : 0),
      0
    );
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
   * @returns {Promise<{lang: string, cardLang: string, theme: string, sound: boolean,
   *   soundCategories: Record<string, {enabled: boolean, volume: number}>, animation: string,
   *   foilIntensity: number, glareIntensity: number, glowTrophies: number,
   *   notificationDuration: number, notificationTypes: Record<string, boolean>,
   *   devMode: boolean, boosterRenderMode: string, nativeScrollbars: boolean,
 *   announceChangelog: boolean}>} The stored preferences.
   * @throws {Error} When the read or the configuration loading fails.
   */
  async getSettings() {
    const stored = await storageRepository.getUserState(USER_STATE_KEYS.SETTINGS);
    const defaults = await this.buildInitialSettings();
    const notificationSettings = await configLoader.getNotificationSettings();
    const boosterRender = await configLoader.getBoosterRenderSettings();
    if (!stored || typeof stored !== 'object') return defaults;

    return {
      lang: typeof stored.lang === 'string' && stored.lang !== '' ? stored.lang : defaults.lang,
      // The card language is a preference of its own: `auto` (the default) follows the browser, a
      // code pins the cards. An unknown code (a language removed from `config.json`) falls back to
      // the default preference instead of leaving the cards in a language nothing can resolve.
      cardLang: cardLanguage.normalizePreference(stored.cardLang) ?? defaults.cardLang,
      theme: typeof stored.theme === 'string' && stored.theme !== '' ? stored.theme : defaults.theme,
      // `false` is the only way to silence the app, so any other stored value (missing, legacy
      // save, garbage) falls back to the enabled default instead of muting by accident.
      sound: typeof stored.sound === 'boolean' ? stored.sound : defaults.sound,
      // Every family keeps its switch and its volume, each independently clamped/normalized: a
      // save written before the families existed simply starts from the shipped defaults.
      soundCategories: SoundManager.normalizeCategories(
        stored.soundCategories ?? defaults.soundCategories
      ),
      // A mode that disappeared from `config.json` (or a save written by an older version) falls
      // back to the current one instead of leaving the opening without an animation.
      animation:
        typeof stored.animation === 'string' && animationManager.isAvailableMode(stored.animation)
          ? stored.animation
          : defaults.animation,
      // An intensity stored before `config.json` narrowed its range (or a corrupted value) is
      // brought back into the current bounds instead of hiding the foil or blowing it up. Both
      // intensities of the foil panel (the foil and its brillance) follow the same rule.
      foilIntensity:
        typeof stored.foilIntensity === 'number' && Number.isFinite(stored.foilIntensity)
          ? foilManager.sanitizePercent(stored.foilIntensity)
          : defaults.foilIntensity,
      glareIntensity:
        typeof stored.glareIntensity === 'number' && Number.isFinite(stored.glareIntensity)
          ? foilManager.sanitizeGlarePercent(stored.glareIntensity)
          : defaults.glareIntensity,
      // A level outside the declared range (an older save, a hand-edited file) is clamped, never
      // rejected: the halos simply come back to the strongest or dimmest level the game offers.
      glowTrophies:
        typeof stored.glowTrophies === 'number' && Number.isFinite(stored.glowTrophies)
          ? glowManager.sanitizeLevel(stored.glowTrophies)
          : defaults.glowTrophies,
      // The duration lives in whole seconds and is clamped like the sliders above; the switches
      // keep one boolean per kind the configuration declares, defaulting every missing one to on.
      notificationDuration: AccountManager.sanitizeNotificationDuration(
        stored.notificationDuration,
        notificationSettings.duration
      ),
      notificationTypes: AccountManager.normalizeNotificationTypes(
        stored.notificationTypes,
        notificationSettings.types
      ),
      // A speed that disappeared from the game (or a hand-edited save) falls back to the historical
      // pace instead of leaving the mine without a beat.
      mineSpeed: AccountManager.sanitizeMineSpeed(stored.mineSpeed ?? defaults.mineSpeed),
      // Same rule as the sounds: only an explicit `true` turns it on, so a missing key, an old save
      // or a corrupted value reads as "off" instead of surprising the player with developer tools.
      devMode: typeof stored.devMode === 'boolean' ? stored.devMode : defaults.devMode,
      // A mode removed from `config.json` (or a save written before the modes existed) falls back
      // to the configured default: an unknown id would leave the opening without a usable recipe.
      boosterRenderMode:
        typeof stored.boosterRenderMode === 'string' &&
        boosterRender.modes.some((mode) => mode.id === stored.boosterRenderMode)
          ? stored.boosterRenderMode
          : defaults.boosterRenderMode,
      // Same rule as `devMode`: only an explicit `true` hands the scrollbars back to the system, so
      // a save written before the switch existed keeps the indicator of the game.
      nativeScrollbars:
        typeof stored.nativeScrollbars === 'boolean'
          ? stored.nativeScrollbars
          : defaults.nativeScrollbars,
      // Same rule as the sounds: only an explicit `false` turns the guidance off, so a save written
      // before the switch existed keeps the tutorial walkthrough.
      questNavigationTutorial:
        typeof stored.questNavigationTutorial === 'boolean'
          ? stored.questNavigationTutorial
          : defaults.questNavigationTutorial,
      // Same rule as the sounds: only an explicit `false` silences the release notes, so a save
      // written before the switch existed keeps being announced the new versions.
      announceChangelog:
        typeof stored.announceChangelog === 'boolean'
          ? stored.announceChangelog
          : defaults.announceChangelog,
    };
  }

  /**
   * Merges and persists the account settings.
   *
   * Only `lang`, `cardLang`, `theme`, `sound`, `soundCategories`, `animation`, `foilIntensity`,
   * `glareIntensity`, `glowTrophies`, `notificationDuration`, `notificationTypes`, `devMode`,
   * `boosterRenderMode`, `nativeScrollbars` and `announceChangelog` are accepted;
   * unknown keys are ignored. Values are validated against `config.json` as soon as the corresponding
   * lists are loaded, so a typo cannot silently break the next startup. Applying the new values
   * (calling `I18n.setLang`, `ThemeManager.applyTheme`, `SoundManager.setEnabled`,
   * `AnimationManager.applyAnimation`, `FoilManager.applyIntensity` and
   * `FoilManager.applyGlareIntensity`) remains the caller's responsibility.
   *
   * @param {{lang?: string, cardLang?: string, theme?: string, sound?: boolean,
   *   soundCategories?: Record<string, {enabled: boolean, volume: number}>, animation?: string,
   *   foilIntensity?: number, glareIntensity?: number, glowTrophies?: number,
   *   notificationDuration?: number, notificationTypes?: Record<string, boolean>,
   *   devMode?: boolean, nativeScrollbars?: boolean, announceChangelog?: boolean}} partialSettings
   *   - Preferences to update.
   * @returns {Promise<{lang: string, cardLang: string, theme: string, sound: boolean,
   *   soundCategories: Record<string, {enabled: boolean, volume: number}>, animation: string,
   *   foilIntensity: number, glareIntensity: number, glowTrophies: number,
   *   notificationDuration: number, notificationTypes: Record<string, boolean>,
   *   devMode: boolean, nativeScrollbars: boolean, announceChangelog: boolean}>} The merged
   *   settings.
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
    const availableCardLangs = await configLoader.getCardLanguages();
    const availableThemes = themeManager.getAvailableThemes();
    const availableAnimations = animationManager.getAvailableModes();

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

    if (Object.prototype.hasOwnProperty.call(partialSettings, 'cardLang')) {
      const { cardLang } = partialSettings;
      if (typeof cardLang !== 'string' || cardLang.trim() === '') {
        throw new TypeError(`settings.cardLang must be a non-empty string (received: ${JSON.stringify(cardLang)}).`);
      }
      // `auto` is a value of its own, not a language code: the two are normalized the same way so a
      // save can never hold a preference the picker cannot show.
      const normalizedCardLang = cardLanguage.normalizePreference(cardLang);
      if (!normalizedCardLang) {
        throw new RangeError(
          `Unknown card language "${cardLang}". Available: [${CARD_LANG_AUTO}, ${availableCardLangs.join(', ')}].`
        );
      }
      merged.cardLang = normalizedCardLang;
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

    if (Object.prototype.hasOwnProperty.call(partialSettings, 'animation')) {
      const { animation } = partialSettings;
      if (typeof animation !== 'string' || animation.trim() === '') {
        throw new TypeError(`settings.animation must be a non-empty string (received: ${JSON.stringify(animation)}).`);
      }
      if (availableAnimations.length > 0 && !availableAnimations.includes(animation)) {
        throw new RangeError(
          `Unknown animation mode "${animation}". Available: [${availableAnimations.join(', ')}].`
        );
      }
      merged.animation = animation;
    }

    if (Object.prototype.hasOwnProperty.call(partialSettings, 'sound')) {
      const { sound } = partialSettings;
      if (typeof sound !== 'boolean') {
        throw new TypeError(`settings.sound must be a boolean (received: ${JSON.stringify(sound)}).`);
      }
      merged.sound = sound;
    }

    if (Object.prototype.hasOwnProperty.call(partialSettings, 'soundCategories')) {
      const { soundCategories } = partialSettings;
      if (!soundCategories || typeof soundCategories !== 'object' || Array.isArray(soundCategories)) {
        throw new TypeError(
          `settings.soundCategories must be a plain object (received: ${JSON.stringify(soundCategories)}).`
        );
      }
      merged.soundCategories = SoundManager.normalizeCategories(soundCategories);
    }

    if (Object.prototype.hasOwnProperty.call(partialSettings, 'devMode')) {
      const { devMode } = partialSettings;
      if (typeof devMode !== 'boolean') {
        throw new TypeError(`settings.devMode must be a boolean (received: ${JSON.stringify(devMode)}).`);
      }
      merged.devMode = devMode;
    }

    if (Object.prototype.hasOwnProperty.call(partialSettings, 'nativeScrollbars')) {
      const { nativeScrollbars } = partialSettings;
      if (typeof nativeScrollbars !== 'boolean') {
        throw new TypeError(
          `settings.nativeScrollbars must be a boolean (received: ${JSON.stringify(nativeScrollbars)}).`
        );
      }
      merged.nativeScrollbars = nativeScrollbars;
    }

    if (Object.prototype.hasOwnProperty.call(partialSettings, 'announceChangelog')) {
      const { announceChangelog } = partialSettings;
      if (typeof announceChangelog !== 'boolean') {
        throw new TypeError(
          `settings.announceChangelog must be a boolean (received: ${JSON.stringify(announceChangelog)}).`
        );
      }
      merged.announceChangelog = announceChangelog;
    }

    if (Object.prototype.hasOwnProperty.call(partialSettings, 'foilIntensity')) {
      const { foilIntensity } = partialSettings;
      if (typeof foilIntensity !== 'number' || !Number.isFinite(foilIntensity)) {
        throw new TypeError(
          `settings.foilIntensity must be a number (received: ${JSON.stringify(foilIntensity)}).`
        );
      }
      // Clamped rather than rejected: the range belongs to `config.json`, and a save file written
      // with a wider one must keep loading.
      merged.foilIntensity = foilManager.sanitizePercent(foilIntensity);
    }

    if (Object.prototype.hasOwnProperty.call(partialSettings, 'glareIntensity')) {
      const { glareIntensity } = partialSettings;
      if (typeof glareIntensity !== 'number' || !Number.isFinite(glareIntensity)) {
        throw new TypeError(
          `settings.glareIntensity must be a number (received: ${JSON.stringify(glareIntensity)}).`
        );
      }
      // Same clamping rule as the foil above, against its own range.
      merged.glareIntensity = foilManager.sanitizeGlarePercent(glareIntensity);
    }

    if (Object.prototype.hasOwnProperty.call(partialSettings, 'glowTrophies')) {
      const { glowTrophies } = partialSettings;
      if (typeof glowTrophies !== 'number' || !Number.isFinite(glowTrophies)) {
        throw new TypeError(
          `settings.glowTrophies must be a number (received: ${JSON.stringify(glowTrophies)}).`
        );
      }
      // Clamped like the foil: the 0-5 range belongs to `config.json`.
      merged.glowTrophies = glowManager.sanitizeLevel(glowTrophies);
    }

    if (Object.prototype.hasOwnProperty.call(partialSettings, 'notificationDuration')) {
      const { notificationDuration } = partialSettings;
      if (typeof notificationDuration !== 'number' || !Number.isFinite(notificationDuration)) {
        throw new TypeError(
          `settings.notificationDuration must be a number (received: ${JSON.stringify(notificationDuration)}).`
        );
      }
      const { duration } = await configLoader.getNotificationSettings();
      merged.notificationDuration = AccountManager.sanitizeNotificationDuration(
        notificationDuration,
        duration
      );
    }

    if (Object.prototype.hasOwnProperty.call(partialSettings, 'boosterRenderMode')) {
      const { boosterRenderMode } = partialSettings;
      if (typeof boosterRenderMode !== 'string' || boosterRenderMode.trim() === '') {
        throw new TypeError(
          `settings.boosterRenderMode must be a non-empty string (received: ${JSON.stringify(boosterRenderMode)}).`
        );
      }
      const { modes } = await configLoader.getBoosterRenderSettings();
      const normalized = boosterRenderMode.trim().toLowerCase();
      if (!modes.some((mode) => mode.id === normalized)) {
        throw new RangeError(
          `Unknown booster render mode "${boosterRenderMode}". Available: [${modes
            .map((mode) => mode.id)
            .join(', ')}].`
        );
      }
      merged.boosterRenderMode = normalized;
    }

    if (Object.prototype.hasOwnProperty.call(partialSettings, 'notificationTypes')) {
      const { notificationTypes } = partialSettings;
      if (!notificationTypes || typeof notificationTypes !== 'object' || Array.isArray(notificationTypes)) {
        throw new TypeError(
          `settings.notificationTypes must be an object (received: ${JSON.stringify(notificationTypes)}).`
        );
      }
      const { types } = await configLoader.getNotificationSettings();
      // A PARTIAL map is accepted (the settings screen flips one switch at a time): unknown kinds
      // are refused instead of silently stored, and the others keep their current value.
      Object.entries(notificationTypes).forEach(([type, enabled]) => {
        if (!types.includes(type)) {
          throw new RangeError(`Unknown notification type "${type}". Available: [${types.join(', ')}].`);
        }
        if (typeof enabled !== 'boolean') {
          throw new TypeError(
            `settings.notificationTypes.${type} must be a boolean (received: ${JSON.stringify(enabled)}).`
          );
        }
        merged.notificationTypes[type] = enabled;
      });
    }

    if (Object.prototype.hasOwnProperty.call(partialSettings, 'questNavigationTutorial')) {
      const { questNavigationTutorial } = partialSettings;
      if (typeof questNavigationTutorial !== 'boolean') {
        throw new TypeError(
          `settings.questNavigationTutorial must be a boolean (received: ${JSON.stringify(questNavigationTutorial)}).`
        );
      }
      merged.questNavigationTutorial = questNavigationTutorial;
    }

    if (Object.prototype.hasOwnProperty.call(partialSettings, 'mineSpeed')) {
      const { mineSpeed } = partialSettings;
      if (typeof mineSpeed !== 'string' || mineSpeed.trim() === '') {
        throw new TypeError(
          `settings.mineSpeed must be a non-empty string (received: ${JSON.stringify(mineSpeed)}).`
        );
      }
      const normalized = mineSpeed.trim();
      if (!MINE_SPEEDS.includes(normalized)) {
        throw new RangeError(
          `Unknown mining speed "${mineSpeed}". Available: [${MINE_SPEEDS.join(', ')}].`
        );
      }
      merged.mineSpeed = normalized;
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
    clearMirroredCardLang();
    clearMirroredTheme();
    eventBus.emit(EVENTS.ACCOUNT_REMOVED, null);
  }
}

/**
 * Speeds of the automatic mining (`settings.mineSpeed`), slowest first.
 *
 * The order is the one of the settings slider, so the two cannot drift apart: `fast` divides the
 * beat of `mining.keyHoldIntervalMs` by 1.5 and `veryFast` by 2 (see `mineHoldInterval` in
 * `MineBlockView`).
 */
export const MINE_SPEEDS = Object.freeze(['normal', 'fast', 'veryFast']);

/** Speed a new account starts at: the historical pace of `mining.keyHoldIntervalMs`. */
export const DEFAULT_MINE_SPEED = 'normal';

/** Shared instance used by the onboarding view, the settings view (step 6) and `app.js`. */
export const accountManager = new AccountManager();

export default accountManager;

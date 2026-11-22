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
 *                   boosterRenderMode, cardSource, animatedLayers, animatedLayersSpeed,
 *                   advancedDevMode, nativeScrollbars }
 *   - `quota`     : { lastResetDay, dailyRemaining, bonusBoosters }
 *   - `stats`     : { boostersOpened, godpacksOpened, boostersOpenedBySet, drawsByRarity,
 *                   drawsByCard, soldByRarity, questsCompleted, daysConnected, cardsSold,
 *                   friendsPeak, sparksEarned, sparksSpent, sparksEarnedBySource,
 *                   sparksSpentBySource }
 *     `questsCompleted`, `daysConnected`, `cardsSold` and `friendsPeak` are created retroactively
 *     on boot from `illagerQuests`, `dailyRewards`, `soldByRarity` and `social.following` for a
 *     save written before they existed (see `ensureStatistics()`).
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
import {
  ConfigLoader,
  configLoader,
  buildCardGenerateDefaults,
  normalizeCardGenerateLayerSwitches,
} from '../utils/ConfigLoader.js';
import i18n, { clearMirroredLang } from '../utils/I18n.js';
import cardLanguage, { CARD_LANG_AUTO, clearMirroredCardLang } from '../utils/CardLanguage.js';
import themeManager, { clearMirroredTheme } from '../utils/ThemeManager.js';
import animationManager from '../utils/AnimationManager.js';
import glowManager from '../utils/GlowManager.js';
import foilManager from '../utils/FoilManager.js';
import eventBus, { EVENTS } from '../utils/EventBus.js';
import { DEFAULT_SOUND_CATEGORIES, SoundManager } from '../utils/SoundManager.js';
import { ILLAGER_QUESTS_STATE_KEY, countClaimedQuests } from './IllagerQuestState.js';
import {
  CARD_SOURCE,
  CARD_SOURCE_VALUES,
  DEFAULT_CARD_SOURCE,
} from '../utils/CardSourceManager.js';
import {
  CARD_RENDER_MODE,
  DEFAULT_CARD_RENDER_MODE,
  getShippedDefaultMode,
} from '../utils/CardRenderManager.js';

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
  // Social publication: the secret write code of the trainer card and the followed UUIDs
  // (see `SocialManager`). The code stays in clear because the worker needs it on every update.
  SOCIAL: 'social',
  // The UTC day whose like was given (`LikesManager`): once it is used, the client never asks the
  // worker for another one, whatever the player it would like.
  LIKES: 'likes',
  // Trades with followed players (see `TradeManager`): the cached Ender Eyes balance, the cards
  // and Sparks currently escrowed, and the statuses already announced.
  TRADES: 'trades',
  // Wishlist (see `WishlistManager`): the collection keys of the cards the player hopes to receive.
  // Published with the trainer card, so a followed player can see it and favour them in a trade.
  WISHLIST: 'wishlist',
  TROPHIES: 'trophies',
  // Daily state, statistics and history of the Mine Pick (see `MinePickManager`).
  MINE_PICK: 'minePick',
  // Daily allowance, resources and statistics of the Mine (see `MiningManager`).
  MINING: 'mining',
  // Weekly shop of the Wandering Trader: the Monday its purchases belong to, and how many times
  // each offer was bought (see `TraderManager`).
  TRADER: 'trader',
  // PERMANENT stock of the pinned offers (see `TraderManager`): the same counts as `trader`, in a
  // record of their own. A pinned offer is bought `MaxUse` times for good, so its stock must
  // survive anything that rewrites the weekly record (an old save, a hand-edited one, a tab still
  // running a previous build): the two maps are merged, keeping the higher count.
  TRADER_PINNED: 'traderPinned',
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
    drawsByRarity: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
    drawsByCard: {},
    soldByRarity: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
    // Account-wide counters added after the first saves: `ensureStatistics()` fills them once
    // from the quests, the daily rewards and the sales already recorded.
    questsCompleted: 0,
    daysConnected: 0,
    cardsSold: 0,
    friendsPeak: 0,
    // Likes given and received: `LikesManager` keeps them in step with the worker, which is what
    // the `likessent` and `likesreceived` trophies count.
    likesSent: 0,
    likesReceived: 0,
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
   *   cardSource?: string|null, animatedLayers?: boolean|null,
   *   animatedLayersSpeed?: number|null, cardGenerate?: object|null,
   *   advancedDevMode?: boolean|null, boosterRenderMode?: string|null}} [overrides] -
   *   Requested preferences.
   * @returns {Promise<{lang: string, cardLang: string, theme: string, sound: boolean,
   *   soundCategories: Record<string, {enabled: boolean, volume: number}>, animation: string,
   *   foilIntensity: number, glareIntensity: number, glowTrophies: number,
   *   notificationDuration: number, notificationTypes: Record<string, boolean>,
   *   devMode: boolean, cardSource: string, animatedLayers: boolean,
   *   animatedLayersSpeed: number, cardGenerate: object, advancedDevMode: boolean,
   *   boosterRenderMode: string}>} Validated preferences.
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

    // A mode can be SHIPPED as the default (`cardRender.default` of `config.json`): "dynamic"
    // today, the "Minecards dynamic" preset of `cardrender.json`. The preset is a COMPLETE design,
    // so it is used as the starting card itself - a new account renders it without ever opening
    // the settings, and the advanced panel starts from its values instead of the shipped design.
    // A null id, or one no longer declared, keeps the historical images.
    const shippedPreset = await getShippedDefaultMode();

    // The animated layers have their own speed, in PERCENT of the reference 30-second cycle. The
    // bounds and the default live in `config.json` so the tuned speed can become the shipped
    // default without touching the manager.
    const animatedLayersRange = await configLoader.getAnimatedLayersSettings();
    const animatedLayersSpeed = AccountManager.sanitizeAnimatedLayersSpeed(
      overrides.animatedLayersSpeed ?? shippedPreset?.speedPercent,
      animatedLayersRange
    );
    // The generated card has its own design module (`cardGenerate` of `config.json`): the stored
    // overrides are completed and clamped here, so a save written before a slider existed still
    // produces a complete card.
    const cardGenerateSettings = await configLoader.getCardGenerateSettings();
    const cardGenerate = AccountManager.sanitizeCardGenerateSettings(
      overrides.cardGenerate ?? shippedPreset?.design ?? null,
      cardGenerateSettings
    );
    // What a card of this account looks like when nothing is stored: the shipped preset, or the
    // final images that have always been the fallback.
    const defaultCardSource = shippedPreset ? CARD_SOURCE.GENERATE : DEFAULT_CARD_SOURCE;
    const defaultCardRenderMode = shippedPreset ? shippedPreset.id : DEFAULT_CARD_RENDER_MODE;

    // The notifications have their own block (`notifications` of `config.json`): the duration is in
    // SECONDS and every known kind starts enabled. A new account therefore hears about everything
    // the game grants, and can shorten or silence it from the settings screen.
    const notificationSettings = await configLoader.getNotificationSettings();
    const notificationDuration = AccountManager.sanitizeNotificationDuration(
      overrides.notificationDuration,
      notificationSettings.duration
    );
    // The Follow List cache delay is stored in MINUTES. It only decides when an already known card
    // is reused; the Social Refresh button deliberately bypasses it.
    const socialRefreshSettings = await configLoader.getSocialRefreshSettings();
    const socialRefreshMinutes = AccountManager.sanitizeSocialRefreshMinutes(
      overrides.socialRefreshMinutes,
      socialRefreshSettings
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
      socialRefreshMinutes,
      // Wishlist housekeeping. Removing a card from the wishlist once it was obtained is ON by
      // default for the flows that never ask (booster, purchase, Mine Pick), and OFF for a trade:
      // a received card is exactly the moment a player may want to keep hoping for a nicer printing
      // of it, so the post-trade dialog asks instead (see `WishlistManager`).
      wishlistAutoRemoveGain: overrides.wishlistAutoRemoveGain !== false,
      wishlistAutoRemoveTrade: overrides.wishlistAutoRemoveTrade === true,
      mineSpeed,
      devMode: overrides.devMode === true,
      // The source of the card faces is a developer choice (`generate` draws the card from its
      // JSON, `image` keeps the final `Path`). It is stored even when the developer mode is off,
      // so switching that mode back on restores the choice; `CardSourceManager` decides whether
      // the setting is effective.
      cardSource: CARD_SOURCE_VALUES.includes(overrides.cardSource)
        ? overrides.cardSource
        : defaultCardSource,
      // Which entry of the "Card render" picker produced that source: `images`, `custom` (the
      // design edited in the advanced panel) or the id of a preset of `cardrender.json`. A save
      // written before the picker existed derives it from the source it already stores.
      cardRenderMode:
        typeof overrides.cardRenderMode === 'string' && overrides.cardRenderMode.trim() !== ''
          ? overrides.cardRenderMode.trim()
          : shippedPreset
            ? defaultCardRenderMode
            : overrides.cardSource === CARD_SOURCE.GENERATE
              ? CARD_RENDER_MODE.CUSTOM
              : defaultCardRenderMode,
      // The generated-card animation follows the shipped mode (the "dynamic" preset animates),
      // then the player's own switch. Without a shipped preset it stays OFF: a card must stay still
      // unless someone asked for moving layers.
      animatedLayers:
        typeof overrides.animatedLayers === 'boolean'
          ? overrides.animatedLayers
          : shippedPreset?.animatedLayers === true,
      animatedLayersSpeed,
      cardGenerate,
      // The advanced developer options are a separate privilege. The allowlist is checked by the
      // settings screen and at boot; the account only stores the requested switch.
      advancedDevMode: overrides.advancedDevMode === true,
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
   * Brings the Follow List refresh delay back into its declared range.
   *
   * The value is a whole number of MINUTES. A missing or corrupted value reads as the configured
   * default, and an out-of-range value is clamped: a save written with older bounds must keep
   * loading while still honouring the delay the player chose.
   *
   * @param {unknown} value - Requested delay, in minutes.
   * @param {{min: number, max: number, step: number, default: number}} range - Declared bounds.
   * @returns {number} A whole delay inside the range.
   */
  static sanitizeSocialRefreshMinutes(value, range) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return range.default;
    return Math.min(range.max, Math.max(range.min, Math.round(value)));
  }

  /**
   * Brings an animated-layers speed back into the declared percentage range.
   *
   * The value is an integer percentage of the reference speed, not a duration. A missing or
   * corrupted value reads as the configured default, and an out-of-range value is clamped to the
   * nearest step of the slider so a save written with a wider range still loads.
   *
   * @param {unknown} value - Requested speed, in percent of the reference speed.
   * @param {{min: number, max: number, step: number, default: number}} range - Declared bounds.
   * @returns {number} A percentage inside the range, on a slider step.
   */
  static sanitizeAnimatedLayersSpeed(value, range) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return range.default;
    const clamped = Math.min(range.max, Math.max(range.min, value));
    const steps = Math.round((clamped - range.min) / range.step);
    return Math.min(range.max, range.min + steps * range.step);
  }

  /**
   * Brings a generated-card design back into the declared ranges.
   *
   * The animation has two switches per layout (background and underlay) and two values (zoom and
   * blur), and the construction has three geometry values plus one complete row per rarity.
   * Numbers are clamped to their range and snapped to the slider step; colours are normalized to
   * six-digit hex; symbols are kept short. Every missing field comes from
   * `buildCardGenerateDefaults(config)`, so the result is always safe to hand to
   * `CardGenerateManager`.
   *
   * @param {unknown} value - Stored or requested `settings.cardGenerate`.
   * @param {{animation: {zoom: object, blur: object},
   *   construction: {borderWidth: object, headerHeight: object, bodyHeight: object,
   *   rarities: Array<object>}}} config - Result of `getCardGenerateSettings()`.
   * @returns {{animation: {background: Record<string, boolean>,
   *   underlay: Record<string, boolean>, zoom: number, blur: number},
   *   construction: {borderWidth: number, headerHeight: number, bodyHeight: number,
   *   rarities: Record<string, {color: string, accent: string, symbol: string,
   *   symbolColor: string}>}}} The complete validated design.
   */
  static sanitizeCardGenerateSettings(value, config) {
    const defaults = buildCardGenerateDefaults(config);
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const animation = source.animation && typeof source.animation === 'object' ? source.animation : {};
    const construction =
      source.construction && typeof source.construction === 'object' ? source.construction : {};
    const storedRarities =
      construction.rarities && typeof construction.rarities === 'object'
        ? construction.rarities
        : {};

    const sanitizeNumber = (candidate, range, fallback) => {
      const number = typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : fallback;
      const clamped = Math.min(range.max, Math.max(range.min, number));
      const steps = Math.round((clamped - range.min) / range.step);
      const snapped = Math.min(range.max, range.min + steps * range.step);
      return Number(snapped.toFixed(4));
    };

    // The scale a layer keeps while still is stored per layout. A single number (a hand-edited
    // save, or a preset that only cares about one value) applies to both layouts.
    const sanitizeStillScales = (value, fallbackDesign, layer) => {
      const stored = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
      const simple = typeof value === 'number' && Number.isFinite(value) ? value : undefined;
      const fallback = fallbackDesign.animation.still[layer];
      return {
        classic: sanitizeNumber(
          stored.classic ?? simple,
          config.animation.stillScale,
          fallback.classic
        ),
        fullart: sanitizeNumber(
          stored.fullart ?? simple,
          config.animation.stillScale,
          fallback.fullart
        ),
      };
    };

    const rarities = {};
    config.construction.rarities.forEach((rarity) => {
      const stored = storedRarities[rarity.id] ?? {};
      rarities[rarity.id] = {
        color: ConfigLoader.normalizeHexColor(stored.color, rarity.color),
        accent: ConfigLoader.normalizeHexColor(stored.accent, rarity.accent),
        symbol: ConfigLoader.normalizeGeneratedSymbol(stored.symbol, rarity.symbol),
        symbolColor: ConfigLoader.normalizeHexColor(stored.symbolColor, rarity.symbolColor),
      };
    });

    return {
      animation: {
        background: normalizeCardGenerateLayerSwitches(
          animation.background,
          defaults.animation.background
        ),
        underlay: normalizeCardGenerateLayerSwitches(
          animation.underlay,
          defaults.animation.underlay
        ),
        // Two zooms: `zoom` is what a save written before the split carries, read as the
        // background one, so an older account keeps exactly the amplitude it had.
        zoomBackground: sanitizeNumber(
          animation.zoomBackground ?? animation.zoom,
          config.animation.zoom,
          defaults.animation.zoomBackground
        ),
        zoomUnderlay: sanitizeNumber(
          animation.zoomUnderlay ?? animation.zoom,
          config.animation.zoomUnderlay,
          defaults.animation.zoomUnderlay
        ),
        still: {
          background: sanitizeStillScales(animation.still?.background, defaults, 'background'),
          underlay: sanitizeStillScales(animation.still?.underlay, defaults, 'underlay'),
        },
        blur: sanitizeNumber(animation.blur, config.animation.blur, defaults.animation.blur),
      },
      construction: {
        borderWidth: sanitizeNumber(
          construction.borderWidth,
          config.construction.borderWidth,
          defaults.construction.borderWidth
        ),
        headerHeight: sanitizeNumber(
          construction.headerHeight,
          config.construction.headerHeight,
          defaults.construction.headerHeight
        ),
        bodyHeight: sanitizeNumber(
          construction.bodyHeight,
          config.construction.bodyHeight,
          defaults.construction.bodyHeight
        ),
        rarities,
      },
    };
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
   * The counters are derived from data that already exists, so importing an old save adopts its
   * history instead of starting the medals at zero:
   *   - `questsCompleted` counts the Illager quests whose `claimedAt` is set;
   *   - `daysConnected` reads the run position of the daily rewards (the only connection history
   *     the save keeps);
   *   - `cardsSold` sums `soldByRarity`;
   *   - `friendsPeak` starts at the number of distinct followed players the save already has (it
   *     is a record, so `SocialManager` only ever raises it afterwards).
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
      // The record of friends starts at the list the save already has: an old account adopts its
      // history instead of starting the medals at zero.
      if (!Number.isInteger(stats.friendsPeak) || stats.friendsPeak < 0) {
        const social = await context.get(STORES.USER_STATE, USER_STATE_KEYS.SOCIAL);
        const following = Array.isArray(social?.following) ? social.following : [];
        stats.friendsPeak = new Set(
          following.filter((uuid) => typeof uuid === 'string' && uuid !== '')
        ).size;
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
   *   devMode: boolean, cardSource: string, animatedLayers: boolean,
   *   animatedLayersSpeed: number, advancedDevMode: boolean, boosterRenderMode: string,
   *   nativeScrollbars: boolean, announceChangelog: boolean}>} The stored preferences.
   * @throws {Error} When the read or the configuration loading fails.
   */
  async getSettings() {
    const stored = await storageRepository.getUserState(USER_STATE_KEYS.SETTINGS);
    const defaults = await this.buildInitialSettings();
    const notificationSettings = await configLoader.getNotificationSettings();
    const socialRefreshSettings = await configLoader.getSocialRefreshSettings();
    const animatedLayersRange = await configLoader.getAnimatedLayersSettings();
    const cardGenerateSettings = await configLoader.getCardGenerateSettings();
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
      socialRefreshMinutes: AccountManager.sanitizeSocialRefreshMinutes(
        stored.socialRefreshMinutes,
        socialRefreshSettings
      ),
      // Only an explicit `false` turns the automatic removal off (the historical behaviour of a
      // wishlist did not exist, so the flow that never asks removes by default), and only an
      // explicit `true` turns the trade one on.
      wishlistAutoRemoveGain:
        typeof stored.wishlistAutoRemoveGain === 'boolean'
          ? stored.wishlistAutoRemoveGain
          : defaults.wishlistAutoRemoveGain,
      wishlistAutoRemoveTrade:
        typeof stored.wishlistAutoRemoveTrade === 'boolean'
          ? stored.wishlistAutoRemoveTrade
          : defaults.wishlistAutoRemoveTrade,
      // A speed that disappeared from the game (or a hand-edited save) falls back to the historical
      // pace instead of leaving the mine without a beat.
      mineSpeed: AccountManager.sanitizeMineSpeed(stored.mineSpeed ?? defaults.mineSpeed),
      // Same rule as the sounds: only an explicit `true` turns it on, so a missing key, an old save
      // or a corrupted value reads as "off" instead of surprising the player with developer tools.
      devMode: typeof stored.devMode === 'boolean' ? stored.devMode : defaults.devMode,
      // An unknown source (a hand-edited save, a value removed from a later release) falls back to
      // the final image, which is always available and is the historical behaviour.
      cardSource: CARD_SOURCE_VALUES.includes(stored.cardSource)
        ? stored.cardSource
        : defaults.cardSource,
      // The picker entry is kept as stored: it may be a preset id this client does not know
      // (another release added it), which simply falls back to `images` when the list is read.
      cardRenderMode:
        typeof stored.cardRenderMode === 'string' && stored.cardRenderMode.trim() !== ''
          ? stored.cardRenderMode.trim()
          : stored.cardSource === CARD_SOURCE.GENERATE
            ? CARD_RENDER_MODE.CUSTOM
            : defaults.cardRenderMode,
      // Only an explicit `true` animates the generated card layers, so an older save or a corrupted
      // value stays still instead of starting an animation nobody asked for.
      animatedLayers:
        typeof stored.animatedLayers === 'boolean'
          ? stored.animatedLayers
          : defaults.animatedLayers,
      // The advanced mode is a stored request; the allowlist is enforced by the settings screen and
      // by the boot path before it is allowed to affect the card source.
      advancedDevMode:
        typeof stored.advancedDevMode === 'boolean'
          ? stored.advancedDevMode
          : defaults.advancedDevMode,
      // The speed is independent of the switch: turning the animation off keeps the chosen pace for
      // the next time it is turned on. A save written before the slider existed gets the default.
      animatedLayersSpeed: AccountManager.sanitizeAnimatedLayersSpeed(
        stored.animatedLayersSpeed,
        animatedLayersRange
      ),
      // The generated card design is a per-account override of the `cardGenerate` block. Missing
      // fields, old saves and hand-edited values are completed from the configuration.
      cardGenerate: AccountManager.sanitizeCardGenerateSettings(
        stored.cardGenerate,
        cardGenerateSettings
      ),
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
   * `cardSource`, `animatedLayers`, `animatedLayersSpeed`, `advancedDevMode`, `boosterRenderMode`,
   * `nativeScrollbars` and `announceChangelog` are accepted;
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
   *   devMode?: boolean, cardSource?: string, cardRenderMode?: string,
   *   animatedLayers?: boolean, animatedLayersSpeed?: number, advancedDevMode?: boolean,
   *   nativeScrollbars?: boolean, announceChangelog?: boolean}} partialSettings - Preferences
   *   to update.
   * @returns {Promise<{lang: string, cardLang: string, theme: string, sound: boolean,
   *   soundCategories: Record<string, {enabled: boolean, volume: number}>, animation: string,
   *   foilIntensity: number, glareIntensity: number, glowTrophies: number,
   *   notificationDuration: number, notificationTypes: Record<string, boolean>,
   *   devMode: boolean, cardSource: string, animatedLayers: boolean,
   *   animatedLayersSpeed: number, advancedDevMode: boolean, nativeScrollbars: boolean,
   *   announceChangelog: boolean}>} The merged
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

    if (Object.prototype.hasOwnProperty.call(partialSettings, 'cardSource')) {
      const { cardSource } = partialSettings;
      if (typeof cardSource !== 'string' || cardSource.trim() === '') {
        throw new TypeError(
          `settings.cardSource must be a non-empty string (received: ${JSON.stringify(cardSource)}).`
        );
      }
      const normalized = cardSource.trim().toLowerCase();
      if (!CARD_SOURCE_VALUES.includes(normalized)) {
        throw new RangeError(
          `Unknown card source "${cardSource}". Available: [${CARD_SOURCE_VALUES.join(', ')}].`
        );
      }
      merged.cardSource = normalized;
    }

    if (Object.prototype.hasOwnProperty.call(partialSettings, 'cardRenderMode')) {
      const { cardRenderMode } = partialSettings;
      if (typeof cardRenderMode !== 'string' || cardRenderMode.trim() === '') {
        throw new TypeError(
          `settings.cardRenderMode must be a non-empty string (received: ${JSON.stringify(cardRenderMode)}).`
        );
      }
      // The id is NOT checked against `cardrender.json` here: the file can change without a save
      // migration, and an unknown id already falls back to the images when the list is read.
      merged.cardRenderMode = cardRenderMode.trim();
    }

    if (Object.prototype.hasOwnProperty.call(partialSettings, 'advancedDevMode')) {
      const { advancedDevMode } = partialSettings;
      if (typeof advancedDevMode !== 'boolean') {
        throw new TypeError(
          `settings.advancedDevMode must be a boolean (received: ${JSON.stringify(advancedDevMode)}).`
        );
      }
      merged.advancedDevMode = advancedDevMode;
    }

    if (Object.prototype.hasOwnProperty.call(partialSettings, 'animatedLayers')) {
      const { animatedLayers } = partialSettings;
      if (typeof animatedLayers !== 'boolean') {
        throw new TypeError(
          `settings.animatedLayers must be a boolean (received: ${JSON.stringify(animatedLayers)}).`
        );
      }
      merged.animatedLayers = animatedLayers;
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

    if (Object.prototype.hasOwnProperty.call(partialSettings, 'animatedLayersSpeed')) {
      const { animatedLayersSpeed } = partialSettings;
      if (typeof animatedLayersSpeed !== 'number' || !Number.isFinite(animatedLayersSpeed)) {
        throw new TypeError(
          `settings.animatedLayersSpeed must be a number (received: ${JSON.stringify(animatedLayersSpeed)}).`
        );
      }
      const range = await configLoader.getAnimatedLayersSettings();
      merged.animatedLayersSpeed = AccountManager.sanitizeAnimatedLayersSpeed(
        animatedLayersSpeed,
        range
      );
    }

    if (Object.prototype.hasOwnProperty.call(partialSettings, 'cardGenerate')) {
      const { cardGenerate } = partialSettings;
      if (!cardGenerate || typeof cardGenerate !== 'object' || Array.isArray(cardGenerate)) {
        throw new TypeError(
          `settings.cardGenerate must be a plain object (received: ${JSON.stringify(cardGenerate)}).`
        );
      }
      const config = await configLoader.getCardGenerateSettings();
      // A PARTIAL object is accepted: the settings screen can save one slider without having to
      // rebuild the whole design. The nested blocks are merged one level at a time so a partial
      // `animation` or `rarities` map keeps the other current values.
      merged.cardGenerate = AccountManager.sanitizeCardGenerateSettings(
        {
          ...merged.cardGenerate,
          ...cardGenerate,
          animation: { ...merged.cardGenerate.animation, ...cardGenerate.animation },
          construction: {
            ...merged.cardGenerate.construction,
            ...cardGenerate.construction,
            rarities: {
              ...merged.cardGenerate.construction.rarities,
              ...cardGenerate.construction?.rarities,
            },
          },
        },
        config
      );
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

    if (Object.prototype.hasOwnProperty.call(partialSettings, 'socialRefreshMinutes')) {
      const { socialRefreshMinutes } = partialSettings;
      if (typeof socialRefreshMinutes !== 'number' || !Number.isFinite(socialRefreshMinutes)) {
        throw new TypeError(
          `settings.socialRefreshMinutes must be a number (received: ${JSON.stringify(socialRefreshMinutes)}).`
        );
      }
      const socialRefreshSettings = await configLoader.getSocialRefreshSettings();
      merged.socialRefreshMinutes = AccountManager.sanitizeSocialRefreshMinutes(
        socialRefreshMinutes,
        socialRefreshSettings
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

    // The two wishlist switches are plain booleans: the dialog they silence is the only thing that
    // reads them, so a switch that lies would be invisible until a card was received.
    for (const key of ['wishlistAutoRemoveGain', 'wishlistAutoRemoveTrade']) {
      if (!Object.prototype.hasOwnProperty.call(partialSettings, key)) continue;
      if (typeof partialSettings[key] !== 'boolean') {
        throw new TypeError(
          `settings.${key} must be a boolean (received: ${JSON.stringify(partialSettings[key])}).`
        );
      }
      merged[key] = partialSettings[key];
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

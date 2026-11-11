/**
 * app.js - Application bootstrap and orchestration.
 *
 * Reference: `.docs/steps/1.md` point 9 and `.docs/main.md` section 3.G.
 *
 * Startup order:
 *   1. open the IndexedDB database (schema creation on the first launch);
 *   2. load and validate `settings/config.json` (languages, themes, booster settings);
 *   3. apply the theme and the animation mode (the pre-render inline script already set the theme;
 *      this re-syncs both from the stored preferences);
 *   4. initialize i18n (translation files + `data-i18n` attributes);
 *   5. if no account exists: show the onboarding screen and stop here;
 *      otherwise: apply the stored settings, start the SPA router and wire the header.
 *
 * The statistics are NOT wired here anymore: they are a block of the profile page, hosted (and
 * lifecycled) by `ProfileView`.
 *
 * The header identity is fed by `DateSyncManager` (step 2) through `EVENTS.CLOCK_TICK` and by the
 * profile through `EVENTS.PROFILE_UPDATED`; the numbers of the inventory dialog are read when it
 * opens. `Date.now()` is never used to display a time, so a cheater cannot shift the displayed
 * reset by changing the system clock.
 */

import storageRepository from './models/StorageRepository.js';
import accountManager from './business/AccountManager.js';
import dateSyncManager from './business/DateSyncManager.js';
import boosterManager from './business/BoosterManager.js';
import sparksManager from './business/SparksManager.js';
import profileManager from './business/ProfileManager.js';
import trophyManager from './business/TrophyManager.js';
import i18n from './utils/I18n.js';
import cardLanguage from './utils/CardLanguage.js';
import themeManager from './utils/ThemeManager.js';
import { applyThemeIcons } from './utils/ThemeIcons.js';
import animationManager from './utils/AnimationManager.js';
import foilManager from './utils/FoilManager.js';
import glowManager from './utils/GlowManager.js';
import boosterRenderManager from './utils/BoosterRenderManager.js';
import scrollHint from './utils/ScrollHint.js';
import soundManager from './utils/SoundManager.js';
import { startUiSounds } from './utils/UiSounds.js';
import { configLoader } from './utils/ConfigLoader.js';
import eventBus, { EVENTS } from './utils/EventBus.js';
import { capturePendingRedeem, consumePendingRedeem } from './utils/DeepLink.js';
import notificationCenter from './UI/components/NotificationCenter.js';
import { SpaRouter } from './UI/SpaRouter.js';
import { OnboardingView } from './UI/views/OnboardingView.js';
import { OpeningView, OPENING_VIEW_NAME } from './UI/views/OpeningView.js';
import { CollectionView, COLLECTION_VIEW_NAME } from './UI/views/CollectionView.js';
import { MinePickView, MINE_PICK_VIEW_NAME } from './UI/views/MinePickView.js';
import { MineBlockView, MINE_BLOCK_VIEW_NAME } from './UI/views/MineBlockView.js';
import { ProgressionView, PROGRESSION_VIEW_NAME } from './UI/views/ProgressionView.js';
import { ProfileView, PROFILE_VIEW_NAME } from './UI/views/ProfileView.js';
import { StatsView, STATS_VIEW_NAME } from './UI/views/StatsView.js';
import { TrophiesView, TROPHIES_VIEW_NAME } from './UI/views/TrophiesView.js';
import { TitlesView, TITLES_VIEW_NAME } from './UI/views/TitlesView.js';
import { SettingsView, SETTINGS_VIEW_NAME } from './UI/views/SettingsView.js';
import { RedeemView } from './UI/views/RedeemView.js';
import { GiftsView } from './UI/views/GiftsView.js';
import { InfoView, INFO_VIEW_NAME } from './UI/views/InfoView.js';
import { ShopView, SHOP_VIEW_NAME } from './UI/views/ShopView.js';
import titleManager from './business/TitleManager.js';
import minePickManager from './business/MinePickManager.js';
import { miningManager } from './business/MiningManager.js';
import gameNotifier from './UI/components/GameNotifier.js';
import autoClaimPopup from './UI/components/AutoClaimPopup.js';
import dailyRewardPopup from './UI/components/DailyRewardPopup.js';
import setAnnouncementPopup from './UI/components/SetAnnouncementPopup.js';
import changelogPopup from './UI/components/ChangelogPopup.js';
import currencyExpiryPopup from './UI/components/CurrencyExpiryPopup.js';
import illagerShopManager from './business/IllagerShopManager.js';
import illagerQuestManager, { ILLAGER_QUEST_TYPES } from './business/IllagerQuestManager.js';
import autoClaimManager from './business/AutoClaimManager.js';
import dailyRewardManager from './business/DailyRewardManager.js';
import changelogManager from './business/ChangelogManager.js';
import ViewHelp from './UI/components/ViewHelp.js';
import infoHint from './UI/components/InfoHint.js';
import installPrompt from './UI/components/InstallPrompt.js';
import errorPopup from './UI/components/ErrorPopup.js';
import { installErrorReporter, setErrorPresenter, reportError } from './utils/ErrorReporter.js';
import errorLog from './utils/ErrorLog.js';

/** Id of the boot overlay removed once the application is ready. */
export const BOOT_OVERLAY_ID = 'app-boot';

/** Id of the fatal error container. */
export const FATAL_ERROR_ID = 'app-fatal';

/**
 * Session flag remembering that the page already tried to repair itself.
 *
 * A browser that keeps an old module (a profile view that still expects the markup of the previous
 * release, for instance) makes the boot fail with a message nobody can act on. Clearing the caches
 * and reloading fixes it, but only ONCE: a second failure in the same session is a real bug, and
 * reloading again would loop forever.
 */
const BOOT_REPAIR_KEY = 'minecards:bootRepair';

/** Namespace of the inline SVG glyphs built at run time (the meter and the sparkle). */
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/**
 * Selectors of the inventory dialog: the one button of the header that still carries numbers, and
 * the dialog it opens (boosters left, blocks and picks of the day, bonus boosters, block bundles,
 * Sparks).
 */
export const INVENTORY_SELECTORS = Object.freeze({
  BUTTON: '[data-header-inventory]',
  MODAL: '[data-inventory-modal]',
  BODY: '[data-inventory-modal-body]',
  CLOSE: '[data-inventory-modal-close]',
});

/** Selectors of the daily reward button of the header and of its "something to claim" dot. */
export const DAILY_REWARDS_SELECTORS = Object.freeze({
  BUTTON: '[data-header-daily-rewards]',
  DOT: '[data-header-daily-rewards-dot]',
});

/**
 * Selectors of the identity of the header: the avatar of the player, the level on its corner and the
 * ring that carries the progress of that level.
 */
/**
 * Pseudo the brand of the header shows until the player chose one.
 *
 * The name of the character the game is about: a header without a pseudo reads "Steve - MineCards",
 * which is still a name, where an empty slot would read as a profile that failed to load.
 */
export const DEFAULT_PLAYER_NAME = 'Steve';

/** Selector of the pseudo of the brand (`<pseudo> - MineCards`, see `css/base.css`). */
export const HEADER_PLAYER_SELECTOR = '[data-header-player]';

export const HEADER_IDENTITY_SELECTORS = Object.freeze({
  ROOT: '[data-header-identity]',
  AVATAR: '[data-header-avatar]',
  IMAGE: '[data-header-avatar-image]',
  INITIAL: '[data-header-avatar-initial]',
  LEVEL: '[data-header-avatar-level]',
  LABEL: '[data-header-identity-label]',
});

/**
 * Selector of the settings button of the header, and of the dot that announces an unread release
 * note on it.
 */
export const SETTINGS_NAV_SELECTOR = '[data-nav-target="settings"]';

/** Selector of the "new version" dot inside the settings button. */
export const SETTINGS_BADGE_SELECTOR = '[data-settings-badge]';

/** Wait between the end of a reveal and the daily reward offer, in milliseconds. */
const DAILY_REWARD_OFFER_DELAY_MS = 900;

/** Views managed by `index.html`, used by the router and by the reset flow. */
export const VIEW_NAMES = Object.freeze({
  ONBOARDING: 'onboarding',
  OPENING: 'opening',
  SHOP: 'shop',
  COLLECTION: 'collection',
  // Progression: a page of its own, opened from the header of the collection.
  PROGRESSION: 'progression',
  PROFILE: 'profile',
  // Statistics: opened from the profile, not a destination of the bottom bar of its own anymore.
  STATS: 'stats',
  TROPHIES: 'trophies',
  MINE_PICK: 'minepick',
  // The Mine: the bottom-bar destination that replaced the trophies (now opened from the profile).
  MINE_BLOCK: 'mineblock',
  SETTINGS: 'settings',
  INFO: 'info',
});

/**
 * Panels embedded in the settings view, addressed by `data-panel`.
 *
 * The promo codes and the gift history are not bottom-bar destinations anymore: they live inside
 * the settings screen (next to the distributions they belong to). They are therefore NOT registered
 * as router views, and they are wired from here on their own root element.
 */
export const SETTINGS_PANELS = Object.freeze({
  REDEEM: '[data-panel="redeem"]',
  GIFTS: '[data-panel="gifts"]',
});

/** View activated after the onboarding (the booster opening screen). */
export const DEFAULT_VIEW = VIEW_NAMES.OPENING;

export class App {
  constructor() {
    /** @type {SpaRouter|null} */
    this.router = null;
    /** @type {OnboardingView|null} */
    this.onboardingView = null;
    /** @type {OpeningView|null} Booster opening view (step 4). */
    this.openingView = null;
    /** @type {CollectionView|null} Card collection grid (step 5). */
    this.collectionView = null;
    /** @type {ProgressionView|null} Completion bars of every extension (opened from the collection). */
    this.progressionView = null;
    /** @type {ProfileView|null} Profile page (identity, level, pinned trophies, favourites). */
    this.profileView = null;
    /** @type {StatsView|null} Statistics page (opened from the profile). */
    this.statsView = null;
    /** @type {TrophiesView|null} Trophy catalogue (opened from the profile since the Mine took its
     * bottom-bar slot). */
    this.trophiesView = null;
    /** @type {TitlesView|null} Player titles (opened from the profile, next to the trophies). */
    this.titlesView = null;
    /** @type {MinePickView|null} Mine Pick screen (ten simulated boosters a day, three picks). */
    this.minePickView = null;
    /** @type {MineBlockView|null} Mine screen (ten blocks a day, mined one by one). */
    this.mineBlockView = null;
    /** @type {SettingsView|null} Preferences, account and save management (step 6). */
    this.settingsView = null;
    /** @type {RedeemView|null} Promo code entry (step 7). */
    this.redeemView = null;
    /** @type {GiftsView|null} Gift history (step 8). */
    this.giftsView = null;
    /** @type {InfoView|null} Information page (mechanics, drop rates, credits). */
    this.infoView = null;
    /** @type {ViewHelp|null} "How does it work?" popup mounted on every view. */
    this.viewHelp = null;
    /** @type {boolean} True once the header event subscriptions are registered. */
    this.headerBound = false;
    /** @type {boolean} True once the game notifications (experience, collections) are armed. */
    this.notificationsStarted = false;
    /** @type {AutoClaimPopup|null} Global popup of the automatic codes (`AutoClaim`). */
    this.autoClaimPopup = null;
    /** @type {boolean} True once the automatic codes are watched. */
    this.autoClaimsStarted = false;
    /** @type {boolean} True once the upcoming-set announcements were scheduled. */
    this.setAnnouncementsStarted = false;
    /** @type {boolean} True when the account was created during THIS session (onboarding). */
    this.accountCreatedThisSession = false;
    /** @type {Array<object>|null} Currencies expired while away, announced once the boot is done. */
    this.expiredCurrencies = null;
    /** @type {number|null} Level evaluated by the boot trophy pass, reused by the auto-claims. */
    this.currentLevel = null;
    /** @type {boolean} True once the inventory dialog is wired. */
    this.inventoryBound = false;
    /** @type {boolean} True once the daily reward button and its events are wired. */
    this.dailyRewardsBound = false;
    /** @type {number|null} Pending offer of the daily reward after a reveal. */
    this.dailyRewardOfferTimer = null;
    /** @type {number|null} Pending removal of the guided quest destination highlight. */
    this.guideHighlightTimer = null;
    /** @type {string|null} UTC day the daily reward badge was last refreshed for. */
    this.dailyRewardDay = null;
    /** @type {boolean} True once the identity of the header follows the level and the profile. */
    this.headerIdentityBound = false;
    /** @type {object|null} Level returned by the last trophy pass (`{level, progress, …}`). */
    this.levelSnapshot = null;
    /** @type {number} Level shown by the identity of the header (the number under the avatar). */
    this.headerLevel = 1;
    /** @type {boolean} True once the "new version" dot of the settings button is watched. */
    this.changelogBadgeBound = false;
    /** @type {Function|null} Unsubscribe function of the VIEW_CHANGED subscription. */
    this.unsubscribeViewChanged = null;

    /** @type {boolean} */
    this.isStarted = false;
  }

  /**
   * Boots the application.
   *
   * Never rejects: a fatal error is displayed in the DOM instead of leaving a blank page.
   *
   * @returns {Promise<void>} Resolves once the boot finished (successfully or not).
   */
  async start() {
    if (this.isStarted) return;
    this.isStarted = true;

    try {
      await this.bootServices();
      const hasAccount = await accountManager.hasAccount();
      if (hasAccount) {
        await this.startMainApp();
      } else {
        await this.startOnboarding();
      }
      // The boot went through: a later failure is a real bug, not a repaired page, and may be
      // repaired on its own turn.
      this.forgetBootRepair();
    } catch (error) {
      console.error('[App] Fatal boot error.', error);
      // A page that mixes two releases (an old module kept by the browser, the new markup) fails
      // here with a message about missing elements. One clean reload repairs it; after that, the
      // player gets a panel they can act on instead of a dead page.
      if (await this.repairStaleBuild(error)) return;
      // The fatal panel is the last resort of the boot; the report is what the player pastes on the
      // Discord, and it is built from the same error.
      reportError(error, {
        source: 'boot',
        titleKey: 'error.popup.titleBoot',
        bodyKey: 'error.popup.bodyBoot',
      });
      this.showFatalError(error);
    } finally {
      this.hideBootOverlay();
    }
  }

  /**
   * Tells whether an error comes from a page mixing two releases of the game.
   *
   * The views verify their markup (`ProfileView markup is incomplete…`) and the browser refuses to
   * load a module that changed under its feet: both mean that `index.html` and one of the modules
   * do not belong to the same release, which is exactly what a clean reload fixes.
   *
   * @param {unknown} error - Error raised by the boot.
   * @returns {boolean} True when reloading is worth a try.
   */
  static isStaleBuildError(error) {
    const message = error instanceof Error ? error.message : String(error);
    return /markup is incomplete|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
      message
    );
  }

  /**
   * Repairs a page that mixes two releases, at most once per session.
   *
   * @param {unknown} error - Error raised by the boot.
   * @returns {Promise<boolean>} True when the page is reloading (the caller must stop here).
   */
  async repairStaleBuild(error) {
    if (!App.isStaleBuildError(error)) return false;
    let alreadyRepaired = false;
    try {
      alreadyRepaired = sessionStorage.getItem(BOOT_REPAIR_KEY) === '1';
      if (!alreadyRepaired) sessionStorage.setItem(BOOT_REPAIR_KEY, '1');
    } catch (storageError) {
      // A private window may refuse `sessionStorage`: the repair is then attempted, unguarded.
      console.warn('[App] The boot repair flag could not be stored.', storageError);
    }
    if (alreadyRepaired) {
      console.error('[App] The page is still mixing two releases after a reload.');
      return false;
    }
    console.warn('[App] Two releases of the game were mixed: clearing the caches and reloading.');
    await this.hardReload();
    return true;
  }

  /**
   * Forgets that the page had to be repaired, once the boot succeeds.
   *
   * @returns {void}
   */
  forgetBootRepair() {
    try {
      sessionStorage.removeItem(BOOT_REPAIR_KEY);
    } catch (error) {
      console.warn('[App] The boot repair flag could not be cleared.', error);
    }
  }

  /**
   * Drops every stored copy of the game and reloads the page.
   *
   * The service worker and its caches go first: they are what keeps an old module alive after a
   * release. The page is then reloaded as-is, which re-fetches `index.html` and every module it
   * imports from the server.
   *
   * @returns {Promise<void>} Resolves once the reload was requested (never returns otherwise).
   */
  async hardReload() {
    try {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
      }
    } catch (error) {
      console.warn('[App] The service worker could not be unregistered.', error);
    }
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }
    } catch (error) {
      console.warn('[App] A cache could not be cleared.', error);
    }
    window.location.reload();
  }

  /**
   * Initializes the shared services (database, configuration, theme, translations).
   *
   * @returns {Promise<void>} Resolves when every service is ready.
   * @throws {Error} When the database, `config.json` or the default translation file fails.
   */
  async bootServices() {
    await storageRepository.open();
    await configLoader.load();
    await themeManager.init();
    // The animation mode is applied before the views exist, so the very first opening already
    // plays in the stored flavour and the stage markup is never rendered in the neutral one.
    await animationManager.init();
    // Same reasoning for the foil: `--foil-intensity` (and `--glare-intensity`, the sweeping line)
    // must exist before the first card is built, otherwise a legendary would flash at the default
    // strength while the stored one loads.
    await foilManager.init();
    // Same for the trophy glow: `--trophy-glow-scale` must exist before the first trophy is drawn
    // (the profile names its pinned ones on its first paint).
    await glowManager.init();
    // The booster render modes are loaded before the first 3D scene, so the very first preview
    // already reflects with the configured recipe (blister by default). The stored mode replaces
    // the default below, once the account settings are read.
    await boosterRenderManager.init();
    await i18n.init();
    // The card language is resolved right after the interface one, and independently of it: the
    // mirror it reads is what the cards of the onboarding preview are drawn with, before any
    // account (and therefore any stored preference) exists.
    await cardLanguage.init();
    // The log of the settings belongs to ONE release: a page that runs a newer version than the
    // one that wrote it clears it, because a failure of the previous release may already be fixed.
    await errorLog.syncRelease();
  }

  /**
   * Displays the onboarding screen and hides the application chrome.
   *
   * @returns {Promise<void>} Resolves once the view is interactive.
   * @throws {Error} When the onboarding markup is missing from `index.html`.
   */
  async startOnboarding() {
    const root = document.querySelector(`[data-view="${VIEW_NAMES.ONBOARDING}"]`);
    this.onboardingView = new OnboardingView(root, {
      onAccountCreated: () => {
        // A save created right now is a first launch, not an update: the "what's new" popup has
        // nothing to announce, and the version is recorded so the SECOND launch stays silent too.
        this.accountCreatedThisSession = true;
        return this.startMainApp();
      },
    });
    await this.onboardingView.init();
    this.onboardingView.show();
    console.info('[App] No account found: onboarding displayed.');
  }

  /**
   * Starts the main application (views, navigation, header).
   *
   * Also used right after the onboarding created the account, which is why the onboarding
   * screen is hidden here rather than after the account creation itself.
   *
   * @returns {Promise<void>} Resolves once the initial view is displayed.
   * @throws {Error} When a required view or navigation element is missing.
   */
  async startMainApp() {
    const settings = await accountManager.getSettings();

    // The stored values may predate a `config.json` change: fall back to what is already
    // loaded instead of failing the whole boot on an obsolete preference.
    const targetLang = i18n.normalizeLang(settings.lang) || i18n.getLang();
    if (targetLang && targetLang !== i18n.getLang()) {
      await i18n.setLang(targetLang);
    }

    // The cards have their own language. The stored preference (`auto` by default) is applied
    // before the first view is built, so the first collection is already drawn in the right one;
    // the mirror written by `CardLanguage.init()` only covered the screens shown until now.
    const targetCardLang = cardLanguage.normalizePreference(settings.cardLang);
    if (targetCardLang && targetCardLang !== cardLanguage.getPreference()) {
      cardLanguage.setPreference(targetCardLang);
    }

    const targetTheme = themeManager.isAvailableTheme(settings.theme)
      ? settings.theme
      : themeManager.getTheme() || (await configLoader.getDefaultTheme());
    themeManager.applyTheme(targetTheme);

    // Animation mode: fall back to the neutral one when the stored value is unknown (a mode
    // removed from `config.json` must not leave the opening without an animation).
    const targetAnimation = animationManager.isAvailableMode(settings.animation)
      ? settings.animation
      : animationManager.defaultMode;
    animationManager.applyAnimation(targetAnimation);

    // Sound preference: applied before the opening view is built, so its `preload()` never
    // downloads the effects of a muted player. Missing/legacy values stay enabled. The families
    // are restored first, so the preload uses their real volumes and switches.
    soundManager.setEnabled(settings.sound !== false);
    soundManager.setCategorySettings(settings.soundCategories);
    // Scrollbars: the stylesheet hides the native one and `ScrollHint` paints its own back. A player
    // who asked for the bars of the system gets them back BEFORE the first screen is painted, so
    // the header is not drawn with a 15px column that then disappears.
    scrollHint.setNativeBars(settings.nativeScrollbars === true);
    // The interface map is read before the first navigation: a missing file falls back to the
    // shipped paths, so a tab switch is never silent.
    await soundManager.loadUiSoundMap();
    startUiSounds();

    // Foil intensity: a value stored before `config.json` narrowed the range is clamped by the
    // manager, so an obsolete preference can never hide the foil for good. The brillance (the
    // sweeping line of the same foil) is its own preference and its own range.
    foilManager.applyIntensity(settings.foilIntensity);
    foilManager.applyGlareIntensity(settings.glareIntensity);
    // Trophy glow: a level outside the declared range is clamped by the manager, so an obsolete
    // preference can never blow the halos up (or hide them for good).
    glowManager.applyLevel(settings.glowTrophies);
    // Booster rendering: the stored mode is applied before the opening view builds its preview.
    // A mode removed from `config.json` was already normalized by `AccountManager.getSettings()`.
    try {
      boosterRenderManager.applyMode(settings.boosterRenderMode);
    } catch (error) {
      console.warn('[App] The stored booster render mode is unavailable, keeping the default.', error);
    }
    // Game notifications: the duration and the per-kind switches live in the same settings block,
    // and are applied here so the very first opening already obeys them.
    notificationCenter.setDurationSeconds(settings.notificationDuration);
    notificationCenter.setEnabledTypes(settings.notificationTypes);

    // The profile and the trophies are part of the saved state: both entries are created here, so
    // an export made before the player ever opened the profile page still carries them.
    await this.ensureAccountStates();

    if (this.onboardingView) {
      this.onboardingView.destroy();
      this.onboardingView.hide();
      this.onboardingView = null;
    } else {
      const onboardingRoot = document.querySelector(`[data-view="${VIEW_NAMES.ONBOARDING}"]`);
      onboardingRoot?.classList.remove('is-active');
      document.body.classList.remove('is-onboarding');
    }

    if (!this.router) {
      this.router = new SpaRouter({ defaultView: DEFAULT_VIEW });
    }
    this.router.start(DEFAULT_VIEW);

    // The header listens before the time synchronization so the very first CLOCK_TICK emission is
    // already displayed.
    this.bindHeader();
    this.bindHeaderIdentity();
    this.bindChangelogBadge();
    this.bindInventory();
    this.bindDailyRewards();
    this.bindViewLifecycle();
    this.startViewHelp();
    this.startInfoHints();
    await this.startTimeSync();
    // The quests listen to the events of the other features: they must be attached before the
    // first screen lets the player act, not when the quests dialog is first opened.
    illagerQuestManager.start();
    await this.refreshDailyRewardBadge();
    await this.startOpeningView();
    await this.startCollectionView();
    await this.startProgressionView();
    await this.startProfileView();
    await this.startStatsView();
    await this.startTrophiesView();
    await this.startTitlesView();
    await this.startMinePickView();
    // The conversion of the expired currencies runs BEFORE the mine view reads the shop: it is what
    // captures what the player lost while away, so the popup of the boot can name it.
    await this.collectExpiredCurrencies();
    await this.startMineBlockView();
    await this.startSettingsView();
    await this.startRedeemView();
    await this.startGiftsView();
    await this.startInfoView();
    await this.startShopView();
    // The deep link is handled LAST: the account exists, the views are ready and the trusted clock
    // is initialized, which is exactly what `?Redeem=` needs (step 10).
    await this.handlePendingRedeem();
    // The trophies and the experience are evaluated once at boot, SILENTLY (a save can legitimately
    // unlock a dozen trophies at once: a wall of notifications on load would be noise). The
    // notifications are therefore armed only AFTER that first evaluation — from then on, every key
    // moment (an opening, a trophy, a title, a purchase, a custom name, a level) announces itself.
    await this.startTrophies();
    // The identity of the header is drawn once the level is known: the avatar and the ring are the
    // first thing the player looks at, and a ring filled from a guess would be a lie for the whole
    // session. The boot overlay is still on screen, so this paints nothing visible late.
    await this.refreshHeaderIdentity();
    await this.refreshChangelogBadge();
    // The titles are derived from that very evaluation (a level, an unlocked trophy) and have to be
    // seeded BEFORE the notifications are armed, for the same reason.
    await this.startTitles();
    await this.startGameNotifications();
    // The announcements come first, then the automatic codes (AutoClaim): both are deferred to
    // the next task, after the boot overlay is gone, and a gift waits for the announcement.
    this.startSetAnnouncements();
    // "Add to home screen": the event was captured at boot, the banner is allowed from here on.
    // It still waits for a quiet moment of its own (`InstallPrompt`), so a dialog of the boot is
    // never covered by an offer to install a game the player is already playing.
    installPrompt.arm();

    console.info(
      `[App] Ready (lang: ${i18n.getLang()}, card lang: ${cardLanguage.getLang()} [${cardLanguage.getPreference()}], theme: ${themeManager.getTheme()}).`
    );
  }

  /**
   * Starts the booster opening view (step 4): extension picker, quota, 3D scene, reveal.
   *
   * A load failure must not break the whole boot: the view then shows its own error message
   * and the header keeps working.
   *
   * @returns {Promise<void>} Resolves once the view is ready or has failed gracefully.
   */
  async startOpeningView() {
    const root = document.querySelector(`[data-view="${OPENING_VIEW_NAME}"]`);
    if (!root) {
      console.warn('[App] The opening view is missing from index.html, skipping its wiring.');
      return;
    }
    console.info('[App] Starting the opening view…');
    this.openingView = new OpeningView(root);
    try {
      await this.openingView.init();
    } catch (error) {
      console.error('[App] The opening view could not be loaded.', error);
      this.openingView.setFeedback('opening.error.load', 'error');
      return;
    }
    console.info('[App] Opening view ready.');
    if (this.router?.getCurrentView() === OPENING_VIEW_NAME) {
      this.openingView.handleViewActivated();
    }
  }

  /**
   * Starts the collection view (step 5): full-card grid, filters and detail modal.
   *
   * A load failure must not break the whole boot: the view then shows its own error message
   * and the other views keep working.
   *
   * @returns {Promise<void>} Resolves once the view is ready or has failed gracefully.
   */
  async startCollectionView() {
    const root = document.querySelector(`[data-view="${COLLECTION_VIEW_NAME}"]`);
    if (!root) {
      console.warn('[App] The collection view is missing from index.html, skipping its wiring.');
      return;
    }
    console.info('[App] Starting the collection view…');
    // The progression left the page for one of its own: the view only asks the router for it.
    this.collectionView = new CollectionView(root, {
      onNavigate: (viewName) => this.router?.show(viewName),
    });
    try {
      await this.collectionView.init();
    } catch (error) {
      console.error('[App] The collection view could not be loaded.', error);
      this.collectionView.setFeedback('collection.error.load', 'error');
      return;
    }
    console.info('[App] Collection view ready.');
    if (this.router?.getCurrentView() === COLLECTION_VIEW_NAME) {
      this.collectionView.handleViewActivated();
    }
  }

  /**
   * Wires the progression page (the two completion bars of every extension).
   *
   * The page left the collection like the statistics left the profile: it is opened from the header
   * of the collection and comes back there with its own back button, so the router stays the only
   * thing that switches views.
   *
   * @returns {Promise<void>} Resolves once the view is ready or has failed gracefully.
   */
  async startProgressionView() {
    const root = document.querySelector(`[data-view="${PROGRESSION_VIEW_NAME}"]`);
    if (!root) {
      console.warn('[App] The progression view is missing from index.html, skipping its wiring.');
      return;
    }
    console.info('[App] Starting the progression view…');
    this.progressionView = new ProgressionView(root, {
      onNavigate: (viewName) => this.router?.show(viewName),
    });
    try {
      await this.progressionView.init();
    } catch (error) {
      console.error('[App] The progression view could not be loaded.', error);
      this.progressionView.setFeedback('progression.error.load', 'error');
      return;
    }
    console.info('[App] Progression view ready.');
    if (this.router?.getCurrentView() === PROGRESSION_VIEW_NAME) {
      this.progressionView.handleViewActivated();
    }
  }

  /**
   * Creates the `profile` and `trophies` states when the account does not have them yet, and the
   * account-wide counters added after the first saves (quests, connection days, cards sold).
   *
   * A failure is not fatal: both managers normalize a missing state on read, so the application
   * still works (the save simply does not carry them until the first write).
   *
   * @returns {Promise<void>} Resolves once both states exist (or the failure was logged).
   */
  async ensureAccountStates() {
    try {
      await Promise.all([
        profileManager.ensureState(),
        trophyManager.ensureState(),
        accountManager.ensureStatistics(),
      ]);
    } catch (error) {
      console.warn('[App] The profile and trophy states could not be created.', error);
    }
  }

  /**
   * Starts the trophy system: subscribes to the openings and evaluates the catalogue once.
   *
   * A failure is not fatal: the trophy page then shows its own error message and the rest of the
   * application keeps working.
   *
   * @returns {Promise<void>} Resolves once the first evaluation finished.
   */
  async startTrophies() {
    console.info('[App] Evaluating the trophies…');
    try {
      const state = await trophyManager.init({ notify: false });
      this.currentLevel = Number.isInteger(state?.level?.level) ? state.level.level : null;
      this.levelSnapshot = state?.level ?? null;
      console.info(
        `[App] Trophies ready: ${state.counters.unlocked}/${state.counters.total} unlocked (level ${state.level.level}).`
      );
    } catch (error) {
      console.error('[App] The trophies could not be evaluated.', error);
    }
  }

  /**
   * Starts the profile view: identity (name, avatar), level, pinned trophies and favourite cards.
   *
   * A load failure must not break the whole boot: the view then shows its own error message and the
   * other views keep working.
   *
   * @returns {Promise<void>} Resolves once the view is ready or has failed gracefully.
   */
  async startProfileView() {
    const root = document.querySelector(`[data-view="${PROFILE_VIEW_NAME}"]`);
    if (!root) {
      console.warn('[App] The profile view is missing from index.html, skipping its wiring.');
      return;
    }
    console.info('[App] Starting the profile view…');
    // The profile carries the button that opens the statistics: the router stays here.
    try {
      // The CONSTRUCTOR is inside the `try` on purpose: it is where the markup is verified, and a
      // module kept from the previous release fails there. One broken page must not cost the player
      // the whole game (the boot used to stop on the fatal panel for this alone).
      this.profileView = new ProfileView(root, {
        onNavigate: (viewName) => this.router?.show(viewName),
      });
      await this.profileView.init();
    } catch (error) {
      console.error('[App] The profile view could not be loaded.', error);
      this.profileView?.setFeedback('profile.error.load', 'error');
      this.profileView = null;
      // A page mixing two releases usually announces itself HERE, and only here: the view checks
      // its markup when it is built. One clean reload fixes it; if it already was tried, the panel
      // says so and lets the player continue with the rest of the game.
      if (App.isStaleBuildError(error)) {
        if (await this.repairStaleBuild(error)) return;
        this.showFatalError(error);
      }
      return;
    }
    console.info('[App] Profile view ready.');
    if (this.router?.getCurrentView() === PROFILE_VIEW_NAME) {
      this.profileView.handleViewActivated();
    }
  }

  /**
   * Starts the statistics page: opened from the small button of the profile, never from the bottom
   * bar (it is therefore not a navigation destination, only a view).
   *
   * A load failure must not break the whole boot: the view then shows its own error message and the
   * other views keep working.
   *
   * @returns {Promise<void>} Resolves once the view is ready or has failed gracefully.
   */
  async startStatsView() {
    const root = document.querySelector(`[data-view="${STATS_VIEW_NAME}"]`);
    if (!root) {
      console.warn('[App] The statistics view is missing from index.html, skipping its wiring.');
      return;
    }
    console.info('[App] Starting the statistics view…');
    this.statsView = new StatsView(root, {
      onNavigate: (viewName) => this.router?.show(viewName),
      onReplay: (entry) => this.replaySavedOpening(entry),
    });
    try {
      await this.statsView.init();
    } catch (error) {
      console.error('[App] The statistics view could not be loaded.', error);
      this.statsView.setFeedback('stats.error.load', 'error');
      return;
    }
    console.info('[App] Statistics view ready.');
    if (this.router?.getCurrentView() === STATS_VIEW_NAME) {
      this.statsView.handleViewActivated();
    }
  }

  /**
   * Starts the trophy catalogue view: opened from the profile, next to the statistics.
   *
   * A load failure must not break the whole boot: the view then shows its own error message and the
   * other views keep working.
   *
   * @returns {Promise<void>} Resolves once the view is ready or has failed gracefully.
   */
  async startTrophiesView() {
    const root = document.querySelector(`[data-view="${TROPHIES_VIEW_NAME}"]`);
    if (!root) {
      console.warn('[App] The trophies view is missing from index.html, skipping its wiring.');
      return;
    }
    console.info('[App] Starting the trophies view…');
    // The catalogue carries its own back button since it left the bottom bar for the Mine: the
    // router stays here, the view only asks for the profile.
    this.trophiesView = new TrophiesView(root, {
      onNavigate: (viewName) => this.router?.show(viewName),
    });
    try {
      await this.trophiesView.init();
    } catch (error) {
      console.error('[App] The trophies view could not be loaded.', error);
      this.trophiesView.setFeedback('trophies.error.load', 'error');
      return;
    }
    console.info('[App] Trophies view ready.');
    if (this.router?.getCurrentView() === TROPHIES_VIEW_NAME) {
      this.trophiesView.handleViewActivated();
    }
  }

  /**
   * Starts the player titles page: opened from the profile, next to the trophies.
   *
   * A load failure must not break the whole boot: the view then shows its own error message and the
   * other views keep working.
   *
   * @returns {Promise<void>} Resolves once the view is ready or has failed gracefully.
   */
  async startTitlesView() {
    const root = document.querySelector(`[data-view="${TITLES_VIEW_NAME}"]`);
    if (!root) {
      console.warn('[App] The titles view is missing from index.html, skipping its wiring.');
      return;
    }
    console.info('[App] Starting the titles view…');
    // Like the statistics and the trophies, the page left the bottom bar: it carries its own back
    // button and only asks the router for the profile.
    this.titlesView = new TitlesView(root, {
      onNavigate: (viewName) => this.router?.show(viewName),
    });
    try {
      await this.titlesView.init();
    } catch (error) {
      console.error('[App] The titles view could not be loaded.', error);
      this.titlesView.setFeedback('titles.error.load', 'error');
      return;
    }
    console.info('[App] Titles view ready.');
    if (this.router?.getCurrentView() === TITLES_VIEW_NAME) {
      this.titlesView.handleViewActivated();
    }
  }

  /**
   * Starts the player titles: seeds what the save already unlocked and follows the progress.
   *
   * The catalogue itself is loaded lazily by whoever needs it; what happens here is the SEEDING of
   * the announced titles (`notify: false`) and the subscriptions that will announce the next ones
   * (`TROPHY_UNLOCKED`, `EXPERIENCE_UPDATED`, both handled by `TitleManager`).
   *
   * A failure is not fatal: the titles page then shows its own error message and the rest of the
   * application keeps working.
   *
   * @returns {Promise<void>} Resolves once the titles are seeded.
   */
  async startTitles() {
    console.info('[App] Seeding the player titles…');
    try {
      const trophyState = await trophyManager.getSummary();
      await titleManager.init({ trophyState, notify: false });
    } catch (error) {
      console.error('[App] The titles could not be evaluated.', error);
    }
  }

  /**
   * Arms the notifications of the key moments (experience, collections, trophies, titles, levels).
   *
   * They live here — and not in a view — because they concern the whole application: an opening
   * happens on the opening screen, the profile shows the pins and the trophies screen shows the
   * catalogue, and all three must see the same notification. `GameNotifier` subscribes to the events
   * of the managers and takes the level of the boot evaluation as its baseline, which is what keeps
   * the first evaluation silent.
   *
   * A failure is not fatal: the application then simply shows no notification.
   *
   * @returns {Promise<void>} Resolves once the notifications are armed (or have failed).
   */
  async startGameNotifications() {
    if (this.notificationsStarted) return;
    const armed = await gameNotifier.start();
    this.notificationsStarted = armed;
    if (!armed) {
      console.warn('[App] The game notifications are unavailable.');
    }
  }

  /**
   * Arms the automatic codes (`AutoClaim`): the global popup and the re-check triggers.
   *
   * The popup is created here (it subscribes to `AUTO_CLAIM_GRANTED`) before the first check, so a
   * gift earned at boot is never lost. A failure keeps the application usable: the codes simply
   * stay unclaimed, and the settings button can check them again later.
   *
   * @returns {void}
   */
  startAutoClaims() {
    if (this.autoClaimsStarted) return;
    this.autoClaimsStarted = true;
    this.autoClaimPopup = autoClaimPopup;
    // A gift earned by opening a pack waits for the reveal to close: the player must see the cards
    // they just drew before anything else covers them.
    autoClaimManager.start({
      level: this.currentLevel,
      deferWhile: () => Boolean(this.openingView?.isSceneOpen()),
    });
    console.info('[App] Automatic codes armed.');
  }

  /**
   * Announces the upcoming extensions once the page is on screen.
   *
   * The automatic codes wait for the announcement to be dismissed, so two popups never fight for
   * the same tap. Scheduling the whole sequence on the next task keeps it above the boot overlay.
   *
   * @returns {void}
   */
  startSetAnnouncements() {
    if (this.setAnnouncementsStarted) return;
    this.setAnnouncementsStarted = true;
    window.setTimeout(async () => {
      // The release notes come FIRST: they are the only dialog that says what the game became,
      // and it is shown once per version, right above the boot overlay.
      await this.startChangelogAnnouncement();
      // What became of an expired currency comes FIRST: it is money the player already lost, and the
      // dialog says how much of it came back as Sparks.
      if (this.expiredCurrencies?.length) {
        autoClaimManager.hold('currency-expiry');
        try {
          await currencyExpiryPopup.show(this.expiredCurrencies);
        } catch (error) {
          console.warn('[App] The expired currencies could not be announced.', error);
        } finally {
          autoClaimManager.release('currency-expiry');
          this.expiredCurrencies = null;
        }
      }
      autoClaimManager.hold('set-announcement');
      try {
        await setAnnouncementPopup.announcePending();
      } catch (error) {
        console.warn('[App] The extensions could not be announced.', error);
      } finally {
        autoClaimManager.release('set-announcement');
      }
      this.startAutoClaims();
    }, 0);
  }

  /**
   * Announces the newest release on the first launch of that version.
   *
   * Only an EXISTING save sees it (the onboarding path records the version without a dialog), and
   * only once per version: `ChangelogManager` keeps the highest announced id in
   * `user_state["changelogAnnounced"]`, which is written BEFORE the dialog opens so a reload in
   * the middle of it cannot announce the same version twice.
   *
   * @returns {Promise<void>} Resolves once the dialog was dismissed (or skipped).
   */
  async startChangelogAnnouncement() {
    const state = await changelogManager.getAnnouncementState();
    if (!state.latest) return;

    if (this.accountCreatedThisSession) {
      await changelogManager.markAnnounced(state.latest.id);
      return;
    }
    if (!state.due) return;

    // The switch of the release-notes tab silences the dialog, but the version is recorded anyway:
    // turning it back on later announces the NEXT release instead of the whole backlog.
    if (!(await this.isChangelogAnnouncementEnabled())) {
      await changelogManager.markAnnounced(state.latest.id);
      return;
    }

    await changelogManager.markAnnounced(state.latest.id);
    // A dialog owns the screen: the automatic codes wait for it, like they wait for an extension
    // announcement or an expired currency.
    autoClaimManager.hold('changelog-popup');
    try {
      await changelogPopup.show(state.latest, {
        onOpenChangelog: () => this.openFullChangelog(),
      });
    } catch (error) {
      console.warn('[App] The release notes could not be announced.', error);
    } finally {
      autoClaimManager.release('changelog-popup');
    }
  }

  /**
   * Reads the "new version" dialog preference.
   *
   * The default is ON (`settings.announceChangelog`), so a save written before the switch existed
   * keeps seeing the dialog. An unreadable settings store fails open: showing the notes once more
   * is harmless, silently swallowing a release is not.
   *
   * @returns {Promise<boolean>} True when the dialog may open.
   */
  async isChangelogAnnouncementEnabled() {
    try {
      const settings = await accountManager.getSettings();
      return settings.announceChangelog !== false;
    } catch (error) {
      console.warn('[App] The release-notes preference could not be read.', error);
      return true;
    }
  }

  /**
   * Brings the full changelog forward: the settings screen, on its release-notes section.
   *
   * The router shows the settings view and the view selects its own section, so the player lands
   * on the whole history without having to look for the tab. Opening the screen also marks the
   * version as read, which is what clears the dot of the settings button.
   *
   * @returns {void}
   */
  openFullChangelog() {
    this.router?.show(SETTINGS_VIEW_NAME);
    this.settingsView?.showTab('more');
  }

  /**
   * Walks the player to the screen where an Illager quest happens.
   *
   * The walkthrough is a SETTING (`settings.questNavigationTutorial`, on by default): when it is
   * on, the route is played step by step - the profile first, then the titles; the settings first,
   * then the save panel - so the button teaches where things live instead of teleporting. When it
   * is off, the destination is reached directly.
   *
   * The last step only REVEALS the place and rings it briefly: nothing is claimed, bought or
   * downloaded for the player (the quest still progresses from their own action, as every quest
   * counter does). The pause between two steps is `questGuide.stepDelayMs` of
   * `settings/config.json` (250 ms by default), so the pace is tuned without touching the route.
   *
   * @param {{questId?: string, type?: string}} [payload] - `QUEST_GUIDE_REQUESTED` payload.
   * @returns {Promise<void>} Resolves once the destination is displayed.
   */
  async guideToQuest({ type } = {}) {
    if (!this.router || typeof type !== 'string') return;

    let tutorial = true;
    try {
      tutorial = (await accountManager.getSettings()).questNavigationTutorial !== false;
    } catch (error) {
      console.warn('[App] The quest guidance preference could not be read; keeping the walkthrough.', error);
    }

    let stepDelayMs = 250;
    try {
      stepDelayMs = await configLoader.getQuestGuideStepDelay();
    } catch (error) {
      console.warn('[App] The quest walkthrough delay could not be read; keeping the default.', error);
    }

    const pause = () => new Promise((resolve) => window.setTimeout(resolve, tutorial ? stepDelayMs : 0));
    const show = (viewName) => this.router?.show(viewName);
    const reveal = (selector) => {
      const element = document.querySelector(selector);
      element?.scrollIntoView({ block: 'center', behavior: tutorial ? 'smooth' : 'auto' });
    };
    const highlight = (selector) => this.highlightGuideTarget(selector);

    switch (type) {
      case ILLAGER_QUEST_TYPES.OPEN_BOOSTER_DAILY:
        show(OPENING_VIEW_NAME);
        highlight('[data-opening-open]');
        return;
      case ILLAGER_QUEST_TYPES.DAILY_REWARD_CLAIM:
        await dailyRewardPopup.open();
        highlight('.daily-reward__dialog');
        return;
      case ILLAGER_QUEST_TYPES.SELL_CARD:
        show(COLLECTION_VIEW_NAME);
        highlight('[data-collection-grid]');
        return;
      case ILLAGER_QUEST_TYPES.SHARE_BINDER:
        show(COLLECTION_VIEW_NAME);
        if (tutorial) await pause();
        await this.collectionView?.openBinders();
        highlight('[data-collection-binders-modal] .modal__dialog');
        return;
      case ILLAGER_QUEST_TYPES.MINE_BLOCK:
        show(MINE_BLOCK_VIEW_NAME);
        highlight('[data-mineblock-rock]');
        return;
      case ILLAGER_QUEST_TYPES.MINE_PICK_CARDS:
        show(MINE_PICK_VIEW_NAME);
        highlight('[data-minepick-board]');
        return;
      case ILLAGER_QUEST_TYPES.DOWNLOAD_PROFILE_CARD:
        show(PROFILE_VIEW_NAME);
        if (tutorial) await pause();
        reveal('[data-profile-card-stage]');
        highlight('[data-profile-card-stage]');
        return;
      case ILLAGER_QUEST_TYPES.OPEN_CHANGELOG:
        show(SETTINGS_VIEW_NAME);
        if (tutorial) await pause();
        this.settingsView?.showTab('more');
        highlight('[data-settings-tab="more"]');
        return;
      case ILLAGER_QUEST_TYPES.CHANGE_SELECTED_TITLE:
        if (tutorial) {
          show(PROFILE_VIEW_NAME);
          await pause();
        }
        show(TITLES_VIEW_NAME);
        highlight('[data-titles-panels]');
        return;
      case ILLAGER_QUEST_TYPES.DOWNLOAD_SAVE_BACKUP:
        show(SETTINGS_VIEW_NAME);
        if (tutorial) await pause();
        this.settingsView?.showTab('account');
        if (tutorial) await pause();
        reveal('[data-settings-export]');
        highlight('[data-settings-export]');
        return;
      default:
        return;
    }
  }

  /**
   * Briefly rings the destination of a quest walkthrough.
   *
   * The class owns the outline through `guide-highlight` (see `css/base.css`), so the element keeps
   * its own border and shadow: only a temporary ring is added. The previous ring is dropped first
   * and the animation is restarted (`offsetWidth`), so reaching the same place twice in a row still
   * shows the pulse. The timer removes the class once the animation is over.
   *
   * @param {string} selector - Element that must be highlighted.
   * @returns {void}
   */
  highlightGuideTarget(selector) {
    const target = document.querySelector(selector);
    if (!(target instanceof Element)) return;
    window.clearTimeout(this.guideHighlightTimer);
    document.querySelectorAll('.is-guide-highlight').forEach((element) => {
      element.classList.remove('is-guide-highlight');
    });
    // Restart the animation even when the same element is highlighted twice in a row.
    void target.offsetWidth;
    target.classList.add('is-guide-highlight');
    this.guideHighlightTimer = window.setTimeout(() => {
      target.classList.remove('is-guide-highlight');
      this.guideHighlightTimer = null;
    }, 1600);
  }

  /**
   * Converts the balances of the currencies that expired while the player was away.
   *
   * The conversion belongs to `IllagerShopManager.convertExpired()`, which is idempotent (an empty
   * balance is worth no Sparks, and nothing is written for zero) and also runs on every read of the
   * shop. Running it here first is what lets the boot TELL the player: the result is kept for the
   * announcement of `startSetAnnouncements()`, which happens once the boot overlay is gone.
   *
   * A failure is not fatal: the balance then stays in the save and is converted on the next read.
   *
   * @returns {Promise<void>} Resolves once the expired balances were converted (or the failure logged).
   */
  async collectExpiredCurrencies() {
    this.expiredCurrencies = [];
    const day = dateSyncManager.getCurrentUtcDay();
    if (!day) return;
    try {
      await illagerShopManager.init();
      this.expiredCurrencies = await illagerShopManager.convertExpired(day);
    } catch (error) {
      console.warn('[App] The expired currencies could not be converted.', error);
      this.expiredCurrencies = [];
    }
  }

  /**
   * Starts the Mine Pick view: the ten simulated boosters of the day and the three daily picks.
   *
   * A load failure must not break the whole boot: the view then shows its own error message and the
   * other views keep working.
   *
   * @returns {Promise<void>} Resolves once the view is ready or has failed gracefully.
   */
  async startMinePickView() {
    const root = document.querySelector(`[data-view="${MINE_PICK_VIEW_NAME}"]`);
    if (!root) {
      console.warn('[App] The Mine Pick view is missing from index.html, skipping its wiring.');
      return;
    }
    console.info('[App] Starting the Mine Pick view…');
    this.minePickView = new MinePickView(root);
    try {
      await this.minePickView.init();
    } catch (error) {
      console.error('[App] The Mine Pick view could not be loaded.', error);
      this.minePickView.setFeedback('minepick.error.board', 'error');
      return;
    }
    console.info('[App] Mine Pick view ready.');
    if (this.router?.getCurrentView() === MINE_PICK_VIEW_NAME) {
      this.minePickView.handleViewActivated();
    }
  }

  /**
   * Starts the mine view: the block of the moment, its cracks, its loot and the resources.
   *
   * A load failure must not break the whole boot: the view then shows its own error message and the
   * other views keep working.
   *
   * @returns {Promise<void>} Resolves once the view is ready or has failed gracefully.
   */
  async startMineBlockView() {
    const root = document.querySelector(`[data-view="${MINE_BLOCK_VIEW_NAME}"]`);
    if (!root) {
      console.warn('[App] The mine view is missing from index.html, skipping its wiring.');
      return;
    }
    console.info('[App] Starting the mine view…');
    this.mineBlockView = new MineBlockView(root);
    try {
      await this.mineBlockView.init();
    } catch (error) {
      console.error('[App] The mine view could not be loaded.', error);
      this.mineBlockView.setFeedback('mineblock.error.load', 'error');
      return;
    }
    console.info('[App] Mine view ready.');
    if (this.router?.getCurrentView() === MINE_BLOCK_VIEW_NAME) {
      this.mineBlockView.handleViewActivated();
    }
  }

  /**
   * Starts the settings view (step 6): language, theme, account UUID, save export/import/reset
   * and the distributions check (step 8).
   *
   * A load failure must not break the whole boot: the view then shows its own error message and
   * the other views keep working.
   *
   * @returns {Promise<void>} Resolves once the view is ready or has failed gracefully.
   */
  async startSettingsView() {
    const root = document.querySelector(`[data-view="${SETTINGS_VIEW_NAME}"]`);
    if (!root) {
      console.warn('[App] The settings view is missing from index.html, skipping its wiring.');
      return;
    }
    console.info('[App] Starting the settings view…');
    this.settingsView = new SettingsView(root, {
      // Decoupled from the router: the view only asks the application to change the active view.
      onNavigate: (viewName) => this.router?.show(viewName),
      // The gift history is a panel of this very screen: scroll to it instead of navigating.
      onShowGiftHistory: () => this.revealSettingsPanel(SETTINGS_PANELS.GIFTS),
    });
    try {
      await this.settingsView.init();
    } catch (error) {
      console.error('[App] The settings view could not be loaded.', error);
      this.settingsView.setFeedback('settings.error.load', 'error');
      return;
    }
    console.info('[App] Settings view ready.');
    if (this.router?.getCurrentView() === SETTINGS_VIEW_NAME) {
      this.settingsView.handleViewActivated();
    }
  }

  /**
   * Starts the promo codes panel (step 7): code entry, validation and reward display.
   *
   * The panel lives INSIDE the settings screen (`data-panel="redeem"`), which is why it is not a
   * router view: it activates with the settings view and is revealed by `revealSettingsPanel()`.
   * A load failure must not break the whole boot: the panel then shows its own error message and
   * the other views keep working.
   *
   * @returns {Promise<void>} Resolves once the panel is ready or has failed gracefully.
   */
  async startRedeemView() {
    const root = document.querySelector(SETTINGS_PANELS.REDEEM);
    if (!root) {
      console.warn('[App] The promo codes panel is missing from index.html, skipping its wiring.');
      return;
    }
    console.info('[App] Starting the promo codes panel…');
    this.redeemView = new RedeemView(root, {
      // Belongs to the settings screen now, so it activates with it…
      viewName: SETTINGS_VIEW_NAME,
      // …and it must not steal the focus (and scroll) every time the settings screen opens.
      autoFocus: false,
      // A `?Redeem=` deep link only asks the application to bring the settings screen forward.
      onNavigate: () => this.revealSettingsPanel(SETTINGS_PANELS.REDEEM),
    });
    try {
      await this.redeemView.init();
    } catch (error) {
      console.error('[App] The redeem view could not be loaded.', error);
      this.redeemView.setFeedback('redeem.error.load', 'error');
      return;
    }
    console.info('[App] Promo codes panel ready.');
    // The panel activates with the settings view (`viewName` option): no router check needed here.
  }

  /**
   * Shows the settings screen and scrolls one of its panels into view.
   *
   * Used by the panels that live inside the settings screen (promo codes, gift history) and by the
   * "Historique des cadeaux" button: they cannot switch to a view of their own anymore.
   *
   * @param {string} selector - `data-panel` selector of the target panel.
   * @returns {void}
   */
  revealSettingsPanel(selector) {
    this.router?.show(SETTINGS_VIEW_NAME);
    const panel = document.querySelector(selector);
    if (!panel) {
      console.warn(`[App] The settings panel "${selector}" is missing from index.html.`);
      return;
    }
    // The panel may live in a section of the settings that is not the one on screen: the section is
    // selected first, otherwise there would be no layout to jump to.
    const section = panel.closest('[data-settings-tabpanel]')?.dataset.settingsTabpanel;
    if (section) this.settingsView?.showTab(section);
    // Called synchronously: `SpaRouter.show()` has already applied the active class, so the panel
    // has a layout to scroll to and the jump is instantaneous (a deferred, animated scroll is
    // throttled by the browser and can be interrupted by the next tap).
    panel.scrollIntoView({ block: 'start' });
  }

  /**
   * Handles a `?Redeem=` code captured at boot (step 10).
   *
   * The code was stored by `DeepLink.capturePendingRedeem()` before the onboarding and is consumed
   * here, once the account and the views are ready. `RedeemView` inspects it and either opens the
   * claim modal (never an automatic claim) or shows a translated error toast.
   *
   * @returns {Promise<void>} Resolves once the pending code has been handled (or ignored).
   */
  async handlePendingRedeem() {
    const code = consumePendingRedeem();
    if (!code) return;

    if (!this.redeemView) {
      console.warn('[App] A pending redeem code was captured but the redeem view is unavailable.');
      return;
    }
    await this.redeemView.handlePendingRedeem(code);
  }

  /**
   * Starts the gift history panel (step 8): the distributions already credited to the account.
   *
   * Like the promo codes, the panel lives INSIDE the settings screen (`data-panel="gifts"`).
   * A load failure must not break the whole boot: the panel then shows its own error message and
   * the other views keep working.
   *
   * @returns {Promise<void>} Resolves once the panel is ready or has failed gracefully.
   */
  async startGiftsView() {
    const root = document.querySelector(SETTINGS_PANELS.GIFTS);
    if (!root) {
      console.warn('[App] The gift history panel is missing from index.html, skipping its wiring.');
      return;
    }
    console.info('[App] Starting the gift history panel…');
    this.giftsView = new GiftsView(root, {
      // Embedded in the settings screen: it activates with that view.
      viewName: SETTINGS_VIEW_NAME,
    });
    try {
      await this.giftsView.init();
    } catch (error) {
      console.error('[App] The gift history view could not be loaded.', error);
      this.giftsView.setFeedback('gifts.error.load', 'error');
      return;
    }
    console.info('[App] Gift history panel ready.');
    // The panel activates with the settings view (`viewName` option): no router check needed here.
  }

  /**
   * Starts the information page: mechanics, drop rates read from the booster JSONs and credits.
   *
   * A load failure must not break the whole boot: the view then shows its own error message and
   * the other views keep working.
   *
   * @returns {Promise<void>} Resolves once the view is ready or has failed gracefully.
   */
  async startInfoView() {
    const root = document.querySelector(`[data-view="${INFO_VIEW_NAME}"]`);
    if (!root) {
      console.warn('[App] The info view is missing from index.html, skipping its wiring.');
      return;
    }
    console.info('[App] Starting the info view…');
    this.infoView = new InfoView(root);
    try {
      await this.infoView.init();
    } catch (error) {
      console.error('[App] The info view could not be loaded.', error);
      this.infoView.setFeedback('info.error.load', 'error');
      return;
    }
    console.info('[App] Info view ready.');
  }

  /**
   * Starts the monthly booster shop: allowance, price, quantity and purchase.
   *
   * A load failure must not break the whole boot: the view shows its own error message and the
   * other screens keep working.
   *
   * @returns {Promise<void>} Resolves once the view is ready or has failed gracefully.
   */
  async startShopView() {
    const root = document.querySelector(`[data-view="${SHOP_VIEW_NAME}"]`);
    if (!root) {
      console.warn('[App] The shop view is missing from index.html, skipping its wiring.');
      return;
    }
    console.info('[App] Starting the shop view…');
    this.shopView = new ShopView(root);
    try {
      await this.shopView.init();
    } catch (error) {
      console.error('[App] The shop view could not be loaded.', error);
      this.shopView.setFeedback('shop.error.load', 'error');
      return;
    }
    console.info('[App] Shop view ready.');
  }

  /**
   * Mounts the "how does it work?" popup on every view.
   *
   * The markup is static (one `.view__header` per section), so the popups are built once, right
   * after the router has been started: a view is equipped before it can be displayed, and the popup
   * of a view the player never opens costs nothing but its DOM.
   *
   * @returns {number} The number of views equipped.
   */
  startViewHelp() {
    if (this.viewHelp) return this.viewHelp.mounts.size;
    this.viewHelp = new ViewHelp({ onNavigate: (view) => this.router?.show(view) });
    return this.viewHelp.mount();
  }

  /**
   * Moves the explanation of every settings and profile panel behind its "i".
   *
   * The sentences are declared in `index.html` with `data-info-hint`; the component reads them once,
   * right after the router is up. The Information page prints the same `data-i18n` keys, so the
   * popover and the long-form help can never disagree. `mount()` is idempotent: a view that creates
   * its own explanation later (`MineBlockView`, for the daily Sparks offer) calls `attach()` itself.
   *
   * @returns {number} The number of hints mounted.
   */
  startInfoHints() {
    const mounted = infoHint.mount();
    console.info(`[App] ${mounted} info hint(s) mounted.`);
    return mounted;
  }

  /**
   * Forwards the router activations to the opening view so the WebGL loop never runs while
   * another view is displayed (step 4, point 1).
   *
   * The collection, stats (step 5), settings (step 6), redeem (step 7) and gifts (step 8) views
   * listen to `VIEW_CHANGED` themselves, so only the opening view needs an explicit forward here.
   *
   * @returns {void}
   */
  bindViewLifecycle() {
    if (this.unsubscribeViewChanged) return;
    this.unsubscribeViewChanged = eventBus.on(EVENTS.VIEW_CHANGED, (payload) => {
      if (!this.openingView || !payload || typeof payload.view !== 'string') return;
      console.info(`[App] View changed: ${payload.previousView ?? 'none'} -> ${payload.view}.`);
      if (payload.view === OPENING_VIEW_NAME) {
        this.openingView.handleViewActivated();
      } else if (payload.previousView === OPENING_VIEW_NAME) {
        this.openingView.handleViewDeactivated();
      }
    });
  }

  /**
   * Starts the trusted UTC clock and the booster quota (step 2).
   *
   * `DateSyncManager` owns the single one-second timer of the application and publishes every tick
   * through `CLOCK_TICK`; the views read the trusted date from it.
   *
   * @returns {Promise<boolean>} True when the trusted clock is available.
   */
  async startTimeSync() {
    try {
      await dateSyncManager.init();
      return dateSyncManager.isTimeTrusted();
    } catch (error) {
      console.error('[App] Time synchronization failed.', error);
      return false;
    }
  }

  /**
   * Subscribes the header to the events it follows.
   *
   * Called once; step 2 emits `CONNECTION_STATUS` and `CLOCK_TICK` so the header stays in sync
   * without any direct dependency between `DateSyncManager` and this module.
   *
   * @returns {void}
   */
  bindHeader() {
    if (this.headerBound) return;
    this.headerBound = true;
    // The three PNG counters of the header ship in two inks: this paints the one the stored theme
    // asks for, then follows every change of theme. `startMainApp()` applies the theme before this
    // runs, so the first pass already has its answer - no black icon flashes on a dark header.
    applyThemeIcons();
    eventBus.on(EVENTS.THEME_CHANGED, () => applyThemeIcons());
    eventBus.on(EVENTS.CONNECTION_STATUS, (payload) => this.setConnectionState(payload?.online));
    eventBus.on(EVENTS.CLOCK_TICK, (payload) => this.handleClockTick(payload));
    eventBus.on(EVENTS.ACCOUNT_REMOVED, () => this.handleAccountRemoved());
    eventBus.on(EVENTS.SAVE_IMPORTED, (payload) => this.handleSaveImported(payload));
    eventBus.on(EVENTS.QUEST_GUIDE_REQUESTED, (payload) => void this.guideToQuest(payload));
  }

  /**
   * Keeps the identity of the header in sync with the level and the profile.
   *
   * Two events carry it: `EXPERIENCE_UPDATED` (a trophy, an opening, a level-up) for the number and
   * the ring, `PROFILE_UPDATED` (a new pseudo or avatar) for the picture. Nothing polls: the header
   * changes when the player's progress does, and only then.
   *
   * @returns {void}
   */
  bindHeaderIdentity() {
    if (this.headerIdentityBound) return;
    this.headerIdentityBound = true;
    eventBus.on(EVENTS.EXPERIENCE_UPDATED, (payload) => this.renderHeaderLevel(payload?.level));
    eventBus.on(EVENTS.PROFILE_UPDATED, (payload) => {
      this.renderHeaderAvatar(payload?.profile);
      this.renderHeaderPlayer(payload?.profile);
    });
    // The label of the button is a sentence built here, so a language switch has to rebuild it.
    eventBus.on(EVENTS.LANG_CHANGED, () => this.renderHeaderIdentityLabel());
  }

  /**
   * Draws the identity of the header from the saved profile and the level of the boot pass.
   *
   * @returns {Promise<void>} Resolves once both halves are drawn (a failure only logs).
   */
  async refreshHeaderIdentity() {
    let profile = null;
    try {
      profile = await profileManager.getProfile();
    } catch (error) {
      console.warn('[App] The profile of the header could not be read.', error);
    }
    this.renderHeaderAvatar(profile);
    this.renderHeaderPlayer(profile);
    this.renderHeaderLevel(this.levelSnapshot);
  }

  /**
   * Writes the pseudo of the player in the header, first after the avatar.
   *
   * The wide bar reads `avatar, pseudo, clock, MineCards, tagline` (see `css/base.css`): the pseudo
   * names the player as soon as the game is open, and the clock follows it. A player who never chose
   * a name is `Steve`, and an account that is leaving (reset, imported save) falls back to it, so
   * the header never keeps the name of a save that is gone.
   *
   * @param {object|null} profile - Stored profile (`{name}`), or null after a reset.
   * @returns {void}
   */
  renderHeaderPlayer(profile) {
    const player = document.querySelector(HEADER_PLAYER_SELECTOR);
    if (!player) return;
    const name = typeof profile?.name === 'string' ? profile.name.trim() : '';
    player.textContent = name === '' ? DEFAULT_PLAYER_NAME : name;
    player.hidden = false;
  }

  /**
   * Draws the avatar (or the initial of the pseudo) of the header.
   *
   * The picture is the same one the profile page shows: the chosen icon, or the `photo` URL of a
   * profile written by an older version. Without either, the first letter of the pseudo takes over -
   * the empty circle of a player who never picked an icon must not look like a broken image.
   *
   * @param {object|null} profile - Stored profile (`{name, icon, photo}`), or null after a reset.
   * @returns {void}
   */
  renderHeaderAvatar(profile) {
    const root = document.querySelector(HEADER_IDENTITY_SELECTORS.ROOT);
    if (!root) return;
    const image = root.querySelector(HEADER_IDENTITY_SELECTORS.IMAGE);
    const initial = root.querySelector(HEADER_IDENTITY_SELECTORS.INITIAL);
    if (!image || !initial) return;

    const icon = typeof profile?.icon === 'string' ? profile.icon.trim() : '';
    const photo = typeof profile?.photo === 'string' ? profile.photo.trim() : '';
    const path = icon !== '' ? icon : photo;
    const name = typeof profile?.name === 'string' ? profile.name : '';

    if (path !== '') {
      if (image.getAttribute('src') !== path) image.src = path;
      image.hidden = false;
      initial.hidden = true;
      image.alt = '';
    } else {
      image.hidden = true;
      initial.hidden = false;
      // Same rule as the profile page: the pseudo, or the anonymous name it falls back to.
      const display = name.trim() !== '' ? name.trim() : i18n.t('profile.anonymous');
      initial.textContent = display.slice(0, 1).toUpperCase();
    }
  }

  /**
   * Draws the level and the progress of that level around the avatar of the header.
   *
   * @param {{level?: number, progress?: number}|null} level - Value of `TrophyManager.resolveLevel()`.
   * @returns {void}
   */
  renderHeaderLevel(level) {
    const root = document.querySelector(HEADER_IDENTITY_SELECTORS.ROOT);
    if (!root) return;
    const number = root.querySelector(HEADER_IDENTITY_SELECTORS.LEVEL);
    const avatar = root.querySelector(HEADER_IDENTITY_SELECTORS.AVATAR);

    const current = Number.isInteger(level?.level) && level.level > 0 ? level.level : 1;
    this.headerLevel = current;
    if (number) number.textContent = String(current);

    // The ring is a share of a circle: it is clamped here rather than trusted, so an out-of-range
    // progress can never paint a full ring over an empty level (or wrap around the wrong way).
    const raw = Number.isFinite(level?.progress) ? level.progress : 0;
    const percent = Math.min(100, Math.max(0, raw * 100));
    if (avatar) avatar.style.setProperty('--level-progress', String(Number(percent.toFixed(2))));

    this.renderHeaderIdentityLabel();
  }

  /**
   * Writes the spoken name of the identity button ("Profil - niveau 7").
   *
   * The level is written twice in the markup (the number and this label) because the number is
   * `aria-hidden`: a screen reader would otherwise announce a lone "7" next to nothing.
   *
   * @returns {void}
   */
  renderHeaderIdentityLabel() {
    const label = document.querySelector(HEADER_IDENTITY_SELECTORS.LABEL);
    if (!label) return;
    label.textContent = i18n.t('header.identity.label', { level: this.headerLevel });
  }

  /**
   * Follows one trusted clock tick.
   *
   * `DateSyncManager` is the single one-second timer of the application: the header only watches
   * the day the tick carries, so the daily reward dot is renewed at midnight UTC.
   *
   * @param {{utc: Date, formatted: string, timeUntilReset: string}|null} payload - Tick payload.
   * @returns {void}
   */
  handleClockTick(payload) {
    this.renderHeaderClock(payload);
    if (!payload || typeof payload.formatted !== 'string') return;
    this.refreshDailyRewardsOnNewDay(payload);
  }

  /**
   * Writes the trusted UTC time in the clock of the header.
   *
   * The time comes from `DateSyncManager` only: the header runs no timer of its own, so a device
   * clock moved by the player can never change what is displayed. The seconds live in their own
   * span, which the stylesheet drops on a portrait screen (`hh:mm` there, `hh:mm:ss` on a wide
   * one). A tick without a usable time (never anchored, offline) resets the pill to `--:--`.
   *
   * @param {{utc?: Date, formatted?: string}|null} payload - `CLOCK_TICK` payload.
   * @returns {void}
   */
  renderHeaderClock(payload) {
    const clock = document.querySelector('[data-header-clock]');
    if (!clock) return;
    const time = clock.querySelector('[data-header-clock-time]');
    const seconds = clock.querySelector('[data-header-clock-seconds]');
    const formatted = typeof payload?.formatted === 'string' ? payload.formatted : '';
    const valid = /^\d{2}:\d{2}:\d{2}$/.test(formatted);
    if (time) time.textContent = valid ? formatted.slice(0, 5) : '--:--';
    if (seconds) seconds.textContent = valid ? formatted.slice(5) : ':--';
    if (valid && payload.utc instanceof Date) {
      clock.setAttribute('datetime', payload.utc.toISOString());
    } else {
      clock.removeAttribute('datetime');
    }
  }

  /**
   * Releases the trusted clock and resets the header after a full reset.
   *
   * The account is gone: the quota, the time anchor and the counters must not survive in memory
   * while the onboarding screen is displayed again.
   *
   * @returns {void}
   */
  handleAccountRemoved() {
    console.info('[App] Account removed: releasing the clock and the views.');
    this.releaseAccountRuntime();
  }

  /**
   * Releases the in-memory account state before an imported save replaces the database.
   *
   * The restored save has its own UUID and its own time anchor: keeping the current anchor alive
   * would let a `persistAnchor()` write the previous account's anchor into the freshly imported
   * database. `SaveFile` reloads the page right after the swap, so the released services are
   * never used again in this page load.
   *
   * @param {{uuid?: string}|null} payload - `SAVE_IMPORTED` payload.
   * @returns {void}
   */
  handleSaveImported(payload) {
    console.info(
      `[App] Save imported (uuid: ${payload?.uuid ?? 'unknown'}): releasing the clock and the views.`
    );
    this.releaseAccountRuntime();
  }

  /**
   * Replays a saved opening from the statistics screen: the opening view is shown, then replays
   * the pack as a visual only (no card, no experience, no Sparks).
   *
   * @param {{setId: string, cards: Array, godpack?: boolean}} entry - Resolved saved entry.
   * @returns {boolean} True when the replay started (false when the view was busy).
   */
  replaySavedOpening(entry) {
    if (!this.openingView) return false;
    this.router?.show(OPENING_VIEW_NAME);
    return this.openingView.replaySaved(entry);
  }

  /**
   * Destroys the views and the trusted clock, and resets the header to its placeholder state.
   *
   * Shared by the full reset (`ACCOUNT_REMOVED`) and the save import (`SAVE_IMPORTED`).
   *
   * @returns {void}
   */
  releaseAccountRuntime() {
    if (this.unsubscribeViewChanged) {
      this.unsubscribeViewChanged();
      this.unsubscribeViewChanged = null;
    }
    // The daily board belongs to the account that is being released: its run must not survive into
    // the next one, and a dialog left open would sit on top of the onboarding.
    dailyRewardPopup.clear();
    this.dailyRewardDay = null;
    if (this.openingView) {
      this.openingView.destroy();
      this.openingView = null;
    }
    if (this.collectionView) {
      this.collectionView.destroy();
      this.collectionView = null;
    }
    if (this.progressionView) {
      this.progressionView.destroy();
      this.progressionView = null;
    }
    if (this.profileView) {
      this.profileView.destroy();
      this.profileView = null;
    }
    if (this.statsView) {
      this.statsView.destroy();
      this.statsView = null;
    }
    if (this.trophiesView) {
      this.trophiesView.destroy();
      this.trophiesView = null;
    }
    if (this.titlesView) {
      this.titlesView.destroy();
      this.titlesView = null;
    }
    if (this.minePickView) {
      this.minePickView.destroy();
      this.minePickView = null;
    }
    if (this.mineBlockView) {
      this.mineBlockView.destroy();
      this.mineBlockView = null;
    }
    if (this.settingsView) {
      this.settingsView.destroy();
      this.settingsView = null;
    }
    if (this.redeemView) {
      this.redeemView.destroy();
      this.redeemView = null;
    }
    if (this.giftsView) {
      this.giftsView.destroy();
      this.giftsView = null;
    }
    if (this.infoView) {
      this.infoView.destroy();
      this.infoView = null;
    }
    infoHint.destroy();
    dateSyncManager.destroy();
    trophyManager.destroy();
    titleManager.destroy();
    gameNotifier.stop();
    this.notificationsStarted = false;
    autoClaimManager.stop();
    this.autoClaimPopup?.clear();
    this.autoClaimPopup = null;
    this.autoClaimsStarted = false;
    setAnnouncementPopup.clear();
    this.setAnnouncementsStarted = false;
    currencyExpiryPopup.clear();
    this.expiredCurrencies = null;
    // The install offer belongs to the device, not to the account: it is only taken off the
    // screen, so it can come back once the new account reaches the main screen.
    installPrompt.hide();
    this.currentLevel = null;
    // The identity belongs to the account that is leaving: the next one paints its own on top of a
    // clean circle instead of inheriting the avatar and the level of a save that is not its own.
    this.levelSnapshot = null;
    this.renderHeaderAvatar(null);
    this.renderHeaderPlayer(null);
    this.renderHeaderLevel(null);
    this.renderHeaderClock(null);
    this.closeInventory();
    this.setConnectionState(undefined);
  }

  /**
   * Wires the daily reward button of the header and the automatic offer.
   *
   * Two entry points, as the feature asks: the button (always available) and the end of a booster
   * reveal, which offers the board once a day. The offer waits a moment after the reveal so it does
   * not land on the very frame the summary appears.
   *
   * @returns {void}
   */
  bindDailyRewards() {
    if (this.dailyRewardsBound) return;
    const button = document.querySelector(DAILY_REWARDS_SELECTORS.BUTTON);
    if (!button) {
      console.warn('[App] The daily reward button is missing from index.html.');
      return;
    }
    this.dailyRewardsBound = true;
    button.addEventListener('click', () => void dailyRewardPopup.open());
    eventBus.on(EVENTS.DAILY_REWARDS_UPDATED, () => void this.refreshDailyRewardBadge());
    eventBus.on(EVENTS.REVEAL_FINISHED, () => this.scheduleDailyRewardOffer());
    eventBus.on(EVENTS.ACCOUNT_REMOVED, () => void this.refreshDailyRewardBadge());
    eventBus.on(EVENTS.SAVE_IMPORTED, () => void this.refreshDailyRewardBadge());
  }

  /**
   * Offers the daily reward board once a day, after a booster opening.
   *
   * Only one offer is ever pending (three packs opened in a row schedule one), and it is dropped when
   * the board is already open: the player is looking at it.
   *
   * @returns {void}
   */
  scheduleDailyRewardOffer() {
    if (this.dailyRewardOfferTimer !== null) return;
    this.dailyRewardOfferTimer = window.setTimeout(() => {
      this.dailyRewardOfferTimer = null;
      void dailyRewardPopup.openIfDue();
    }, DAILY_REWARD_OFFER_DELAY_MS);
  }

  /**
   * Lights the dot of the header button when today's reward can be claimed.
   *
   * @returns {Promise<void>} Resolves once the header is refreshed.
   */
  async refreshDailyRewardBadge() {
    const dot = document.querySelector(DAILY_REWARDS_SELECTORS.DOT);
    if (!dot) return;
    try {
      dot.hidden = !(await dailyRewardManager.hasClaimable());
    } catch (error) {
      console.warn('[App] The daily reward could not be checked.', error);
      dot.hidden = true;
    }
  }

  /**
   * Wires the "new version" dot of the settings button.
   *
   * The dot lives on the bottom bar rather than in the settings screen: the point of the feature is
   * to be seen by someone who is NOT on that screen. It is cleared as soon as the screen is opened,
   * which is what "read" means here - the notes are on that page, in full, in one scroll.
   *
   * @returns {void}
   */
  bindChangelogBadge() {
    if (this.changelogBadgeBound) return;
    const button = document.querySelector(SETTINGS_NAV_SELECTOR);
    if (!button) {
      console.warn('[App] The settings destination is missing from index.html.');
      return;
    }
    this.changelogBadgeBound = true;
    eventBus.on(EVENTS.VIEW_CHANGED, (payload) => {
      if (payload?.view === SETTINGS_VIEW_NAME) void this.markChangelogRead();
    });
    // The accessible name of the button is a sentence, and the tooltip of the dot is translated:
    // both follow the language like the rest of the bar.
    eventBus.on(EVENTS.LANG_CHANGED, () => void this.refreshChangelogBadge());
  }

  /**
   * Remembers the newest release note as read and clears the dot.
   *
   * @returns {Promise<void>} Resolves once the badge is refreshed.
   */
  async markChangelogRead() {
    try {
      const { latest } = await changelogManager.getUnreadState();
      if (latest) await changelogManager.markSeen(latest.id);
    } catch (error) {
      console.warn('[App] The read version of the release notes could not be saved.', error);
    }
    await this.refreshChangelogBadge();
  }

  /**
   * Lights (or clears) the dot that announces an unread release note.
   *
   * @returns {Promise<void>} Resolves once the button is refreshed.
   */
  async refreshChangelogBadge() {
    const button = document.querySelector(SETTINGS_NAV_SELECTOR);
    const badge = button?.querySelector(SETTINGS_BADGE_SELECTOR);
    if (!button || !badge) return;

    let unread = false;
    try {
      unread = (await changelogManager.getUnreadState()).unread;
    } catch (error) {
      console.warn('[App] The release notes could not be checked.', error);
    }

    badge.hidden = !unread;
    // The button is the gear of the header: the "new version" part only exists as a dot, so it is
    // spelled out in the accessible name.
    if (unread) {
      button.setAttribute('aria-label', i18n.t('nav.settings.newVersion'));
    } else {
      button.removeAttribute('aria-label');
    }
  }

  /**
   * Offers the daily board when the UTC day changes while the page stays open.
   *
   * The chapter rolls over at midnight UTC: without this the dot of a page left open overnight
   * would keep saying "claimed", and tomorrow's reward would never be offered.
   *
   * @param {{utc?: Date, formatted?: string}} payload - `CLOCK_TICK` payload.
   * @returns {void}
   */
  refreshDailyRewardsOnNewDay(payload) {
    if (!(payload.utc instanceof Date) || payload.formatted === '--:--:--') return;
    const day = payload.utc.toISOString().slice(0, 10);
    if (day === this.dailyRewardDay) return;
    this.dailyRewardDay = day;
    void this.refreshDailyRewardBadge();
  }

  /**
   * Wires the inventory button of the header and its dialog.
   *
   * @returns {void}
   */
  bindInventory() {
    if (this.inventoryBound) return;
    const button = document.querySelector(INVENTORY_SELECTORS.BUTTON);
    const modal = document.querySelector(INVENTORY_SELECTORS.MODAL);
    const close = document.querySelector(INVENTORY_SELECTORS.CLOSE);
    if (!button || !modal) {
      console.warn('[App] The inventory markup is missing from index.html.');
      return;
    }
    this.inventoryBound = true;
    button.addEventListener('click', () => void this.openInventory());
    close?.addEventListener('click', () => this.closeInventory());
    modal.addEventListener('click', (event) => {
      if (event.target === modal) this.closeInventory();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !modal.hidden) this.closeInventory();
    });
  }

  /**
   * Opens the inventory: what the day still grants and what the player owns.
   *
   * The numbers are read when the dialog opens rather than mirrored in the bar, so a pack opened, a
   * pick spent or a bonus claimed while the page stays open can never leave it stale.
   *
   * @returns {Promise<void>} Resolves once the dialog is displayed.
   */
  async openInventory() {
    const modal = document.querySelector(INVENTORY_SELECTORS.MODAL);
    const body = document.querySelector(INVENTORY_SELECTORS.BODY);
    if (!modal || !body) return;

    const quota = dateSyncManager.getQuotaSnapshot();
    const daily = Number.isFinite(quota?.daily) ? quota.daily : 0;
    const bonusTotal = Number.isFinite(quota?.bonusTotal) ? quota.bonusTotal : 0;
    const [blocks, picks, bundles, sparks] = await Promise.all([
      this.readBlocksLeft(),
      this.readPicksLeft(),
      this.readOwnedBundles(),
      this.readSparksBalance(),
    ]);

    body.textContent = '';
    // Three sections: what the day still grants (boosters, blocks, picks), what the player owns
    // outside the daily allowance (bonus boosters, block bundles), then the wallet. Sparks are a
    // balance, not a stock, so they never share a list with the counters and the owned items.
    body.appendChild(App.buildInventoryHeading('inventory.today'));
    const dailyList = document.createElement('ul');
    dailyList.className = 'inventory__list';
    dailyList.append(
      App.buildInventoryRow({ icon: 'daily', labelKey: 'inventory.daily', value: daily }),
      App.buildInventoryRow({ icon: 'blocks', labelKey: 'inventory.blocks', value: blocks }),
      App.buildInventoryRow({ icon: 'picks', labelKey: 'inventory.picks', value: picks })
    );
    body.appendChild(dailyList);

    await this.appendBonusBoosters(body, quota, bonusTotal);

    body.appendChild(App.buildInventoryHeading('inventory.bundles'));
    const bundlesList = document.createElement('ul');
    bundlesList.className = 'inventory__list';
    bundlesList.append(
      App.buildInventoryRow({
        icon: 'bundle',
        labelKey: 'inventory.bundleStock',
        value: bundles,
      })
    );
    body.appendChild(bundlesList);

    body.appendChild(App.buildInventoryHeading('inventory.wallet'));
    const wallet = document.createElement('ul');
    wallet.className = 'inventory__list';
    wallet.append(
      App.buildInventoryRow({ icon: 'sparks', labelKey: 'inventory.sparks', value: sparks })
    );
    body.appendChild(wallet);

    applyThemeIcons(body);
    modal.hidden = false;
  }

  /**
   * Closes the inventory dialog.
   *
   * @returns {void}
   */
  closeInventory() {
    const modal = document.querySelector(INVENTORY_SELECTORS.MODAL);
    if (modal && !modal.hidden) {
      modal.hidden = true;
    }
  }

  /**
   * Reads the blocks the player can still mine today.
   *
   * @returns {Promise<number>} Remaining blocks (0 when the state cannot be read).
   */
  async readBlocksLeft() {
    try {
      return (await miningManager.getState()).remaining;
    } catch (error) {
      console.warn('[App] The blocks left today could not be read.', error);
      return 0;
    }
  }

  /**
   * Reads the Mine Pick packs the player can still open today.
   *
   * @returns {Promise<number>} Remaining picks (0 when the state cannot be read).
   */
  async readPicksLeft() {
    try {
      const state = await minePickManager.getState();
      return Math.max(0, state.remaining);
    } catch (error) {
      console.warn('[App] The picks left today could not be read.', error);
      return 0;
    }
  }

  /**
   * Reads the block bundles owned by the player.
   *
   * @returns {Promise<number>} The bundle count (0 when the mine state cannot be read).
   */
  async readOwnedBundles() {
    try {
      return (await miningManager.getState()).bundles;
    } catch (error) {
      console.warn('[App] The block bundles could not be read.', error);
      return 0;
    }
  }

  /**
   * Reads the Sparks balance of the player.
   *
   * @returns {Promise<number>} The balance (0 when it cannot be read).
   */
  async readSparksBalance() {
    try {
      return await sparksManager.getBalance();
    } catch (error) {
      console.warn('[App] The Sparks balance could not be read.', error);
      return 0;
    }
  }

  /**
   * Appends the bonus boosters owned per extension, each with the artwork of its booster.
   *
   * @param {HTMLElement} body - Body of the inventory dialog.
   * @param {{bonusBySet?: object}|null} quota - Quota snapshot.
   * @param {number} bonusTotal - Total of bonus boosters.
   * @returns {Promise<void>} Resolves once the section is appended.
   */
  async appendBonusBoosters(body, quota, bonusTotal) {
    const heading = document.createElement('h3');
    heading.className = 'inventory__heading';
    heading.textContent = i18n.t('inventory.bonus');
    body.appendChild(heading);

    let listed = [];
    try {
      // The set names and booster artworks of an upcoming bonus are needed here too, even if the
      // extension cannot be opened yet.
      listed = await boosterManager.listBoosterSets({ includeUpcoming: true });
    } catch (error) {
      console.warn('[App] The extensions could not be listed for the inventory.', error);
    }
    const sets = new Map(listed.map((set) => [set.setId, set]));
    const owned = Object.entries(quota?.bonusBySet ?? {})
      .filter(([, count]) => Number.isFinite(count) && count > 0)
      .sort(([left], [right]) =>
        (sets.get(left)?.name ?? left).localeCompare(sets.get(right)?.name ?? right)
      );

    if (owned.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'inventory__empty';
      empty.textContent = i18n.t('inventory.bonusEmpty');
      body.appendChild(empty);
      return;
    }

    const list = document.createElement('ul');
    list.className = 'inventory__list';
    owned.forEach(([setId, count]) => {
      const set = sets.get(setId);
      const item = document.createElement('li');
      item.className = 'inventory__item';

      const icon = document.createElement('span');
      icon.className = 'inventory__icon inventory__icon--booster';
      icon.setAttribute('aria-hidden', 'true');
      if (set?.texture) {
        const artwork = document.createElement('img');
        artwork.className = 'inventory__booster booster-art';
        artwork.src = i18n.resolveImagePath(set.texture);
        artwork.alt = '';
        icon.appendChild(artwork);
      }

      const label = document.createElement('span');
      label.className = 'inventory__label';
      label.textContent = set?.name ?? setId;
      const value = document.createElement('span');
      value.className = 'inventory__value';
      value.textContent = `×${count}`;
      item.append(icon, label, value);
      list.appendChild(item);
    });
    body.appendChild(list);

    const total = document.createElement('p');
    total.className = 'inventory__total';
    total.textContent = i18n.t('inventory.bonusTotal', { count: bonusTotal });
    body.appendChild(total);
  }

  /**
   * Builds one section title of the inventory dialog.
   *
   * @param {string} labelKey - Translation key of the title.
   * @returns {HTMLHeadingElement} The heading.
   */
  static buildInventoryHeading(labelKey) {
    const heading = document.createElement('h3');
    heading.className = 'inventory__heading';
    heading.textContent = i18n.t(labelKey);
    return heading;
  }

  /**
   * Builds one row of the inventory dialog.
   *
   * @param {{icon: 'daily'|'blocks'|'picks'|'bundle'|'sparks', labelKey: string, value: number}}
   *   row - Icon kind, translation key of the label and number to print.
   * @returns {HTMLLIElement} The row.
   */
  static buildInventoryRow({ icon, labelKey, value }) {
    const item = document.createElement('li');
    item.className = 'inventory__item';

    const badge = document.createElement('span');
    badge.className = `inventory__icon inventory__icon--${icon}`;
    badge.setAttribute('aria-hidden', 'true');
    if (icon === 'blocks') {
      badge.appendChild(App.buildPickaxeIcon());
    } else if (icon === 'picks') {
      badge.appendChild(App.buildSparkleIcon());
    } else {
      const image = document.createElement('img');
      image.className = 'inventory__icon-image';
      if (icon === 'sparks') {
        image.src = 'assets/img/sparks.png';
      } else if (icon === 'bundle') {
        image.src = 'assets/img/bundle.png';
      } else {
        // The daily boosters ship in two inks; `applyThemeIcons` paints the one of the palette.
        image.dataset.icon = 'daily_boosters';
      }
      image.alt = '';
      badge.appendChild(image);
    }

    const label = document.createElement('span');
    label.className = 'inventory__label';
    label.textContent = i18n.t(labelKey);
    const amount = document.createElement('span');
    amount.className = 'inventory__value';
    amount.textContent = String(Math.max(0, Number.isFinite(value) ? value : 0));
    item.append(badge, label, amount);
    return item;
  }

  /**
   * Builds the pickaxe glyph of the "blocks left" row (the one of the Mine destination).
   *
   * @returns {SVGElement} The icon.
   */
  static buildPickaxeIcon() {
    const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const group = document.createElementNS(SVG_NAMESPACE, 'g');
    group.setAttribute('transform', 'rotate(-45 12 12)');
    const head = document.createElementNS(SVG_NAMESPACE, 'path');
    head.setAttribute('d', 'M3 9C8 4 16 4 21 9 16 6.5 8 6.5 3 9Z');
    const handle = document.createElementNS(SVG_NAMESPACE, 'path');
    handle.setAttribute('d', 'M12 7v14');
    group.append(head, handle);
    svg.appendChild(group);
    return svg;
  }

  /**
   * Builds the sparkle glyph of the "picks left" row (the one of the Mine Pick destination).
   *
   * @returns {SVGElement} The icon.
   */
  static buildSparkleIcon() {
    const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const core = document.createElementNS(SVG_NAMESPACE, 'path');
    core.setAttribute('d', 'M12 3.5 14 9.5 20 12 14 14.5 12 20.5 10 14.5 4 12 10 9.5Z');
    const glint = document.createElementNS(SVG_NAMESPACE, 'path');
    glint.setAttribute('d', 'M18.5 4.5v3M17 6h3');
    svg.append(core, glint);
    return svg;
  }

  /**
   * Reflects the date synchronization status (offline indicator).
   *
   * @param {boolean|undefined} online - True when the UTC API answered, false when offline,
   *   undefined to clear the indicator.
   * @returns {void}
   */
  setConnectionState(online) {
    if (typeof online !== 'boolean') {
      document.body.removeAttribute('data-connection');
      return;
    }
    document.body.setAttribute('data-connection', online ? 'online' : 'offline');
  }

  /**
   * Removes the boot overlay once the application is ready (or has failed).
   *
   * @returns {void}
   */
  hideBootOverlay() {
    document.getElementById(BOOT_OVERLAY_ID)?.remove();
  }

  /**
   * Displays a fatal boot error inside the DOM.
   *
   * Translated with a hard-coded English fallback: the failure may well be the i18n file or
   * the database itself, so the message must survive a partially initialized application.
   *
   * @param {unknown} error - Error that prevented the boot.
   * @returns {void}
   */
  showFatalError(error) {
    const container = document.getElementById(FATAL_ERROR_ID);
    if (!container) return;

    const isStorageError = error instanceof Error && /IndexedDB|storage/i.test(error.message);

    const title = document.createElement('h2');
    title.textContent = this.translate('app.fatal.title', 'Unable to start');

    const message = document.createElement('p');
    message.textContent = isStorageError
      ? this.translate('app.fatal.db', 'The local storage could not be opened.')
      : this.translate('app.fatal.generic', 'An unexpected error occurred while starting the application.');

    const detail = document.createElement('pre');
    detail.textContent = error instanceof Error ? `${error.name}: ${error.message}` : String(error);

    // The page is most often ONE release behind: saying so, with a button that really clears the
    // copies the browser kept, is the only useful thing this panel can offer. "Continue" is kept
    // as the risky way out for a player who prefers a partial game to a closed one.
    const hint = document.createElement('p');
    hint.className = 'app-fatal__hint';
    hint.textContent = this.translate(
      'app.fatal.hint',
      'The page may be showing an old version of the game. Reloading downloads the current one.'
    );

    const actions = document.createElement('div');
    actions.className = 'app-fatal__actions';

    const reload = document.createElement('button');
    reload.type = 'button';
    reload.className = 'btn btn--primary';
    reload.textContent = this.translate('app.fatal.reload', 'Reload the game');
    reload.addEventListener('click', () => {
      reload.disabled = true;
      void this.hardReload();
    });

    const ignore = document.createElement('button');
    ignore.type = 'button';
    ignore.className = 'btn btn--ghost';
    ignore.textContent = this.translate('app.fatal.continue', 'Continue anyway');
    ignore.addEventListener('click', () => {
      container.hidden = true;
    });

    actions.append(reload, ignore);

    container.textContent = '';
    container.append(title, message, hint, detail, actions);
    container.hidden = false;
  }

  /**
   * Translates a key with an English fallback when i18n is not usable yet.
   *
   * @param {string} key - i18n key.
   * @param {string} fallback - Text used when no translation is available.
   * @returns {string} The translated or fallback text.
   */
  translate(key, fallback) {
    try {
      const text = i18n.t(key);
      return text === key ? fallback : text;
    } catch (error) {
      console.warn(`[App] Unable to translate "${key}".`, error);
      return fallback;
    }
  }
}

// The error reporter is armed before ANY of the game boots: a module that fails to load, a view that
// throws while it is built or a promise nobody awaited has to be reportable, and the report is the
// only thing a player can hand over (`ErrorPopup`: copy the code, paste it on the Discord).
installErrorReporter();
setErrorPresenter((report) => errorPopup.show(report));

// Capture the `?Redeem=` deep link before anything else renders, so a first-visit player keeps
// their pending code through the onboarding (step 10).
capturePendingRedeem();

// Same reasoning for the install event of the browser: it fires once, whenever Chrome decides the
// game qualifies, and an event nobody kept is an event lost. The banner itself only appears once
// the main screen is up (`installPrompt.arm()` at the end of `startMainApp`).
installPrompt.start();

// The service worker (PWA, offline shell) is registered from here and not from an inline script in
// `index.html`: waiting for `load` keeps the first paint free, and the worker's own install step
// precaches the whole shell, which would otherwise compete with the files the page is still loading.
// The scope names the mounted path of the game (`manifest.json` declares the same one), so moving
// the game stays one visible edit instead of a silent behaviour change.
//
// A page that was already controlled is showing the previous release: when the freshly installed
// worker takes over (`skipWaiting` + `claim` in `sw.js`), a single reload is what actually paints the
// new views, instead of waiting for the player's next visit. The first visit is left alone on
// purpose: there was no controller, the page already runs the version that worker just precached,
// and reloading would restart the onboarding under the player's hands.
if ('serviceWorker' in navigator) {
  const wasControlled = Boolean(navigator.serviceWorker.controller);
  let reloadingForUpdate = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!wasControlled || reloadingForUpdate) return;
    reloadingForUpdate = true;
    console.info('[PWA] New service worker in control: reloading for the new version.');
    window.location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js', { scope: '/projets/minecards/' })
      .then((registration) => console.info('[PWA] Service worker registered:', registration.scope))
      .catch((error) => {
        console.error('[PWA] Service worker registration failed:', error);
        reportError(error, { source: 'service-worker' });
      });
  });
}

// The native scrollbars are hidden by `css/base.css`: this paints the thin bar back while a box
// moves. Started with the install event, before the first screen exists, so the scroll of the boot
// overlay is already followed.
scrollHint.start();

const app = new App();
app.start();

export default app;

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
 * The header booster counters and the UTC clock are fed by `DateSyncManager` (step 2) through
 * `EVENTS.QUOTA_UPDATED`, `EVENTS.CONNECTION_STATUS` and `EVENTS.CLOCK_TICK`. `Date.now()` is
 * never used to display a time, so a cheater cannot shift the displayed reset by changing the
 * system clock.
 */

import storageRepository from './models/StorageRepository.js';
import accountManager from './business/AccountManager.js';
import dateSyncManager from './business/DateSyncManager.js';
import boosterManager from './business/BoosterManager.js';
import sparksManager from './business/SparksManager.js';
import profileManager from './business/ProfileManager.js';
import trophyManager from './business/TrophyManager.js';
import i18n from './utils/I18n.js';
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
import { ProfileView, PROFILE_VIEW_NAME } from './UI/views/ProfileView.js';
import { StatsView, STATS_VIEW_NAME } from './UI/views/StatsView.js';
import { TrophiesView, TROPHIES_VIEW_NAME } from './UI/views/TrophiesView.js';
import { TitlesView, TITLES_VIEW_NAME } from './UI/views/TitlesView.js';
import { SettingsView, SETTINGS_VIEW_NAME } from './UI/views/SettingsView.js';
import { RedeemView } from './UI/views/RedeemView.js';
import { GiftsView } from './UI/views/GiftsView.js';
import { InfoView, INFO_VIEW_NAME } from './UI/views/InfoView.js';
import titleManager from './business/TitleManager.js';
import minePickManager from './business/MinePickManager.js';
import binderManager from './business/BinderManager.js';
import gameNotifier from './UI/components/GameNotifier.js';
import autoClaimPopup from './UI/components/AutoClaimPopup.js';
import dailyRewardPopup from './UI/components/DailyRewardPopup.js';
import setAnnouncementPopup from './UI/components/SetAnnouncementPopup.js';
import autoClaimManager from './business/AutoClaimManager.js';
import dailyRewardManager from './business/DailyRewardManager.js';
import ViewHelp from './UI/components/ViewHelp.js';
import infoHint from './UI/components/InfoHint.js';
import installPrompt from './UI/components/InstallPrompt.js';

/** Id of the boot overlay removed once the application is ready. */
export const BOOT_OVERLAY_ID = 'app-boot';

/** Id of the fatal error container. */
export const FATAL_ERROR_ID = 'app-fatal';

/** Ids of the header elements updated through events. */
export const HEADER_IDS = Object.freeze({
  DAILY: 'header-daily-boosters',
  BONUS: 'header-bonus-boosters',
  MINE_PICK: 'header-minepick',
  CLOCK: 'header-utc-clock',
  SPARKS: 'header-sparks',
  BINDERS: 'header-binders',
});

/**
 * Selector of the header counter of the binders.
 *
 * A selector of its own (rather than one more entry of `HEADER_IDS`) because the button carries the
 * click while the id only carries the value: `renderHeaderBinders` writes into `HEADER_IDS.BINDERS`,
 * `bindBindersCounter` listens on this one.
 */
export const BINDERS_COUNTER_SELECTOR = '[data-header-binders]';

/** Selectors of the daily reward button of the header and of its "something to claim" dot. */
export const DAILY_REWARDS_SELECTORS = Object.freeze({
  BUTTON: '[data-header-daily-rewards]',
  DOT: '[data-header-daily-rewards-dot]',
});

/** Wait between the end of a reveal and the daily reward offer, in milliseconds. */
const DAILY_REWARD_OFFER_DELAY_MS = 900;

/**
 * Largest value a header counter displays before it switches to the "9999+" form.
 *
 * The five counters share ONE row on a phone (see the mobile block of `css/base.css`), and five
 * glyphs is the widest a fifth of a 360 px screen holds next to its icon. Nothing is lost: the exact
 * balance is on the Sparks page and the per-extension split is in the bonus inventory, which the
 * counter opens.
 */
const HEADER_COUNT_MAX = 9999;

/**
 * Formats a header counter for its chip.
 *
 * @param {number} value - Raw value (the daily boosters, the bonus total, the Sparks balance…).
 * @returns {string} The value as text, or `"9999+"` past {@link HEADER_COUNT_MAX}.
 */
function formatHeaderCount(value) {
  const count = Number.isFinite(value) ? Math.trunc(value) : 0;
  return count > HEADER_COUNT_MAX ? `${HEADER_COUNT_MAX}+` : String(count);
}

/**
 * Selectors of the bonus inventory (the header count is the total, the modal splits it per set).
 * It is a dialog of the header, not a router view.
 */
export const BONUS_INVENTORY_SELECTORS = Object.freeze({
  BUTTON: '[data-header-bonus]',
  MODAL: '[data-bonus-modal]',
  TITLE: '[data-bonus-modal-title]',
  BODY: '[data-bonus-modal-body]',
  CLOSE: '[data-bonus-modal-close]',
});

/** Views managed by `index.html`, used by the router and by the reset flow. */
export const VIEW_NAMES = Object.freeze({
  ONBOARDING: 'onboarding',
  OPENING: 'opening',
  COLLECTION: 'collection',
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

/** Refresh interval of the UTC clock, in milliseconds. */
const CLOCK_INTERVAL_MS = 1000;

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
    /** @type {number|null} Level evaluated by the boot trophy pass, reused by the auto-claims. */
    this.currentLevel = null;
    /** @type {boolean} True once the bonus inventory dialog is wired. */
    this.bonusInventoryBound = false;
    /** @type {boolean} True once the daily reward button and its events are wired. */
    this.dailyRewardsBound = false;
    /** @type {number|null} Pending offer of the daily reward after a reveal. */
    this.dailyRewardOfferTimer = null;
    /** @type {string|null} UTC day the daily reward badge was last refreshed for. */
    this.dailyRewardDay = null;
    /** @type {Function|null} Unsubscribe function of the VIEW_CHANGED subscription. */
    this.unsubscribeViewChanged = null;
    /** @type {(() => (Date|string|number))|null} Trusted UTC provider injected by step 2. */
    this.utcTimeProvider = null;
    /** @type {number|null} */
    this.clockTimer = null;
    /** @type {{utc: Date, formatted: string, timeUntilReset: string}|null} Last published tick. */
    this.lastTick = null;
    /** @type {string|null} UTC day the header Mine Pick counter was last refreshed for. */
    this.headerMinePickDay = null;
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
    } catch (error) {
      console.error('[App] Fatal boot error.', error);
      this.showFatalError(error);
    } finally {
      this.hideBootOverlay();
    }
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
      onAccountCreated: () => this.startMainApp(),
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

    // The header listens before the time synchronization so the very first QUOTA_UPDATED and
    // CLOCK_TICK emissions are already displayed.
    this.bindHeader();
    this.bindBonusInventory();
    this.bindBindersCounter();
    this.bindDailyRewards();
    this.bindViewLifecycle();
    this.startViewHelp();
    this.startInfoHints();
    await this.startTimeSync();
    this.renderHeaderCounters(dateSyncManager.getQuotaSnapshot());
    await this.refreshHeaderSparks();
    await this.refreshHeaderBinders();
    await this.refreshDailyRewardBadge();
    await this.startOpeningView();
    await this.startCollectionView();
    await this.startProfileView();
    await this.startStatsView();
    await this.startTrophiesView();
    await this.startTitlesView();
    await this.startMinePickView();
    await this.startMineBlockView();
    await this.startSettingsView();
    await this.startRedeemView();
    await this.startGiftsView();
    await this.startInfoView();
    // The deep link is handled LAST: the account exists, the views are ready and the trusted clock
    // is initialized, which is exactly what `?Redeem=` needs (step 10).
    await this.handlePendingRedeem();
    // The trophies and the experience are evaluated once at boot, SILENTLY (a save can legitimately
    // unlock a dozen trophies at once: a wall of notifications on load would be noise). The
    // notifications are therefore armed only AFTER that first evaluation — from then on, every key
    // moment (an opening, a trophy, a title, a purchase, a custom name, a level) announces itself.
    await this.startTrophies();
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
    if (!this.utcTimeProvider) {
      // Fallback used only when the time synchronization is unusable: the clock then shows the
      // "unknown time" placeholder instead of an untrusted system time.
      this.startUtcClock();
    }

    console.info(`[App] Ready (lang: ${i18n.getLang()}, theme: ${themeManager.getTheme()}).`);
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
    this.openingView = new OpeningView(root, {
      onBoosterOpened: (result) => this.renderHeaderCounters(result.remaining),
    });
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
    this.collectionView = new CollectionView(root);
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
   * Creates the `profile` and `trophies` states when the account does not have them yet.
   *
   * A failure is not fatal: both managers normalize a missing state on read, so the application
   * still works (the save simply does not carry them until the first write).
   *
   * @returns {Promise<void>} Resolves once both states exist (or the failure was logged).
   */
  async ensureAccountStates() {
    try {
      await Promise.all([profileManager.ensureState(), trophyManager.ensureState()]);
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
    this.profileView = new ProfileView(root, {
      onNavigate: (viewName) => this.router?.show(viewName),
    });
    try {
      await this.profileView.init();
    } catch (error) {
      console.error('[App] The profile view could not be loaded.', error);
      this.profileView.setFeedback('profile.error.load', 'error');
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
   * `DateSyncManager` owns the single one-second timer of the application and publishes every
   * tick through `CLOCK_TICK`; this method only exposes its UTC date to the header clock.
   *
   * @returns {Promise<boolean>} True when the trusted clock is available.
   */
  async startTimeSync() {
    try {
      await dateSyncManager.init();
      this.setUtcTimeProvider(() => dateSyncManager.getUtcDate());
      return dateSyncManager.isTimeTrusted();
    } catch (error) {
      console.error('[App] Time synchronization failed, the clock stays in placeholder mode.', error);
      this.utcTimeProvider = null;
      return false;
    }
  }

  /**
   * Subscribes the header to the quota and connection events.
   *
   * Called once; step 2 emits `QUOTA_UPDATED` and `CONNECTION_STATUS` so the header stays
   * in sync without any direct dependency between `DateSyncManager` and this module.
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
    eventBus.on(EVENTS.QUOTA_UPDATED, (payload) => this.renderHeaderCounters(payload));
    eventBus.on(EVENTS.SPARKS_UPDATED, (payload) => this.renderHeaderSparks(payload));
    eventBus.on(EVENTS.MINE_PICK_UPDATED, (payload) => this.renderHeaderMinePick(payload));
    // The binder counter follows every write of `BinderManager` (create, delete, share): the number
    // of the header is the length of the stored list, and nothing else announces a change of it.
    eventBus.on(EVENTS.BINDERS_UPDATED, (payload) => this.renderHeaderBinders(payload));
    eventBus.on(EVENTS.CONNECTION_STATUS, (payload) => this.setConnectionState(payload?.online));
    eventBus.on(EVENTS.CLOCK_TICK, (payload) => this.handleClockTick(payload));
    eventBus.on(EVENTS.ACCOUNT_REMOVED, () => this.handleAccountRemoved());
    eventBus.on(EVENTS.SAVE_IMPORTED, (payload) => this.handleSaveImported(payload));
  }

  /**
   * Writes one trusted clock tick into the header.
   *
   * The first external tick releases the fallback interval started by `startUtcClock()`:
   * `DateSyncManager` becomes the single one-second timer of the application.
   *
   * @param {{utc: Date, formatted: string, timeUntilReset: string}|null} payload - Tick payload.
   * @returns {void}
   */
  handleClockTick(payload) {
    if (!payload || typeof payload.formatted !== 'string') return;
    this.lastTick = payload;
    this.setText(HEADER_IDS.CLOCK, payload.formatted);
    this.stopUtcClock();
    this.refreshHeaderMinePickOnNewDay(payload);
    this.refreshDailyRewardsOnNewDay(payload);
  }

  /**
   * Refreshes the Mine Pick counter when the UTC day changes while the page stays open.
   *
   * The free picks roll over at midnight UTC, exactly like the daily boosters, but nothing else
   * announces it to the header: the day carried by the clock is the trigger (and it is also the
   * first refresh after the boot, since no day was known yet).
   *
   * @param {{utc?: Date, formatted?: string}} payload - `CLOCK_TICK` payload.
   * @returns {void}
   */
  refreshHeaderMinePickOnNewDay(payload) {
    // A placeholder tick (before the first trusted synchronization) carries an estimated date: it
    // must not be mistaken for a real day change.
    if (!(payload.utc instanceof Date) || payload.formatted === '--:--:--') return;
    const day = payload.utc.toISOString().slice(0, 10);
    if (day === this.headerMinePickDay) return;
    this.headerMinePickDay = day;
    void this.refreshHeaderMinePick();
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
    // The install offer belongs to the device, not to the account: it is only taken off the
    // screen, so it can come back once the new account reaches the main screen.
    installPrompt.hide();
    this.currentLevel = null;
    this.stopUtcClock();
    this.utcTimeProvider = null;
    this.lastTick = null;
    this.renderHeaderCounters(null);
    this.closeBonusInventory();
    this.renderHeaderSparks(null);
    this.renderHeaderMinePick(null);
    this.renderHeaderBinders(null);
    this.headerMinePickDay = null;
    this.setText(HEADER_IDS.CLOCK, '--:--:--');
    this.setConnectionState(undefined);
  }

  /**
   * Renders the daily and bonus booster counters.
   *
   * @param {{daily?: number, bonusTotal?: number}|null} quota - Quota snapshot, or null to
   *   display the placeholder values used before step 2.
   * @returns {void}
   */
  renderHeaderCounters(quota) {
    const daily = Number.isFinite(quota?.daily) ? quota.daily : 0;
    const bonusTotal = Number.isFinite(quota?.bonusTotal) ? quota.bonusTotal : 0;
    this.setCount(HEADER_IDS.DAILY, daily);
    this.setCount(HEADER_IDS.BONUS, bonusTotal);
  }

  /**
   * Renders the Sparks balance in the header.
   *
   * @param {{balance?: number}|null} payload - `SPARKS_UPDATED` payload, or null to reset.
   * @returns {void}
   */
  renderHeaderSparks(payload) {
    const balance = Number.isFinite(payload?.balance) ? payload.balance : 0;
    this.setCount(HEADER_IDS.SPARKS, balance);
  }

  /**
   * Reads the current Sparks balance from storage and displays it.
   *
   * @returns {Promise<void>} Resolves once the header is refreshed.
   */
  async refreshHeaderSparks() {
    try {
      this.renderHeaderSparks({ balance: await sparksManager.getBalance() });
    } catch (error) {
      console.warn('[App] The Sparks balance could not be read.', error);
    }
  }

  /**
   * Renders the daily Mine Pick allowance in the header.
   *
   * The counter shows the FREE picks plus the ones bought with Sparks: what it announces is how
   * many packs the player can still open today, not how much of the free allowance is left.
   *
   * @param {{remaining?: number, bonusPicks?: number, picksPerDay?: number}|null} payload -
   *   `MINE_PICK_UPDATED` payload, or null to reset.
   * @returns {void}
   */
  renderHeaderMinePick(payload) {
    const remaining = Number.isFinite(payload?.remaining) ? payload.remaining : 0;
    const bonusPicks = Number.isFinite(payload?.bonusPicks) ? payload.bonusPicks : 0;
    this.setCount(HEADER_IDS.MINE_PICK, Math.max(0, remaining + bonusPicks));
  }

  /**
   * Reads the free picks left today from the Mine Pick state and displays them.
   *
   * @returns {Promise<void>} Resolves once the header is refreshed.
   */
  async refreshHeaderMinePick() {
    try {
      const state = await minePickManager.getState();
      this.renderHeaderMinePick({
        remaining: state.remaining,
        bonusPicks: state.bonusPicks ?? 0,
        picksPerDay: state.picksPerDay,
      });
    } catch (error) {
      console.warn('[App] The Mine Pick allowance could not be read.', error);
    }
  }

  /**
   * Renders the number of binders the player owns in the header.
   *
   * @param {{binders?: Array}|null} payload - `BINDERS_UPDATED` payload, or null to reset.
   * @returns {void}
   */
  renderHeaderBinders(payload) {
    const count = Array.isArray(payload?.binders) ? payload.binders.length : 0;
    this.setCount(HEADER_IDS.BINDERS, count);
  }

  /**
   * Reads the stored binders and displays how many exist.
   *
   * Called once at boot: the header must not wait for the first binder of the session to show the
   * pages the player already had.
   *
   * @returns {Promise<void>} Resolves once the header is refreshed.
   */
  async refreshHeaderBinders() {
    try {
      this.renderHeaderBinders({ binders: await binderManager.listBinders() });
    } catch (error) {
      console.warn('[App] The binders could not be counted.', error);
    }
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
   * Wires the header binder counter: a click opens the list of the binders.
   *
   * The list is a dialog of the COLLECTION view (the binder editor fills a page from the catalogue
   * the collection has already loaded), so the click switches to that view first and only then asks
   * it to open the list. `show()` is synchronous for the routing, the dialog opens a tick later.
   *
   * @returns {void}
   */
  bindBindersCounter() {
    if (this.bindersCounterBound) return;
    const button = document.querySelector(BINDERS_COUNTER_SELECTOR);
    if (!button) {
      console.warn('[App] The binder counter is missing from index.html.');
      return;
    }
    this.bindersCounterBound = true;
    button.addEventListener('click', () => void this.openBinders());
  }

  /**
   * Opens the binder list of the collection from the header.
   *
   * @returns {Promise<void>} Resolves once the list is displayed (or the view is unavailable).
   */
  async openBinders() {
    this.router?.show(COLLECTION_VIEW_NAME);
    if (!this.collectionView) {
      console.warn('[App] The collection view is not ready: the binders cannot be listed.');
      return;
    }
    await this.collectionView.openBinders();
  }

  /**
   * Wires the header bonus counter and its inventory dialog.
   *
   * @returns {void}
   */
  bindBonusInventory() {
    if (this.bonusInventoryBound) return;
    const button = document.querySelector(BONUS_INVENTORY_SELECTORS.BUTTON);
    const modal = document.querySelector(BONUS_INVENTORY_SELECTORS.MODAL);
    const close = document.querySelector(BONUS_INVENTORY_SELECTORS.CLOSE);
    if (!button || !modal) {
      console.warn('[App] The bonus inventory markup is missing from index.html.');
      return;
    }
    this.bonusInventoryBound = true;
    button.addEventListener('click', () => void this.openBonusInventory());
    close?.addEventListener('click', () => this.closeBonusInventory());
    modal.addEventListener('click', (event) => {
      if (event.target === modal) this.closeBonusInventory();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !modal.hidden) this.closeBonusInventory();
    });
  }

  /**
   * Opens the bonus inventory: the number of bonus boosters of every extension.
   *
   * The header only shows the TOTAL (it has no room for the split), so the per-extension detail
   * lives in this dialog, opened by clicking the counter.
   *
   * @returns {Promise<void>} Resolves once the dialog is displayed.
   */
  async openBonusInventory() {
    const modal = document.querySelector(BONUS_INVENTORY_SELECTORS.MODAL);
    const title = document.querySelector(BONUS_INVENTORY_SELECTORS.TITLE);
    const body = document.querySelector(BONUS_INVENTORY_SELECTORS.BODY);
    if (!modal || !title || !body) return;

    const quota = dateSyncManager.getQuotaSnapshot();
    title.textContent = i18n.t('header.bonus.title');
    body.textContent = '';

    let listed = [];
    try {
      // The set names of an upcoming bonus are needed here too, even if it cannot be opened yet.
      listed = await boosterManager.listBoosterSets({ includeUpcoming: true });
    } catch (error) {
      console.warn('[App] The extensions could not be listed for the bonus inventory.', error);
    }
    const names = new Map(listed.map((set) => [set.setId, set.name ?? set.setId]));
    const rows = Object.entries(quota.bonusBySet)
      .filter(([, count]) => count > 0)
      .map(([setId, count]) => ({ label: names.get(setId) ?? setId, count }))
      .sort((left, right) => left.label.localeCompare(right.label));

    if (rows.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'bonus-inventory__empty';
      empty.textContent = i18n.t('header.bonus.empty');
      body.appendChild(empty);
    } else {
      const list = document.createElement('ul');
      list.className = 'bonus-inventory__list';
      rows.forEach((row) => {
        const item = document.createElement('li');
        item.className = 'bonus-inventory__item';
        const label = document.createElement('span');
        label.className = 'bonus-inventory__name';
        label.textContent = row.label;
        const value = document.createElement('span');
        value.className = 'bonus-inventory__count';
        value.textContent = `×${row.count}`;
        item.append(label, value);
        list.appendChild(item);
      });
      body.appendChild(list);
      const total = document.createElement('p');
      total.className = 'bonus-inventory__total';
      total.textContent = i18n.t('header.bonus.total', { count: quota.bonusTotal });
      body.appendChild(total);
    }

    modal.hidden = false;
  }

  /**
   * Closes the bonus inventory dialog.
   *
   * @returns {void}
   */
  closeBonusInventory() {
    const modal = document.querySelector(BONUS_INVENTORY_SELECTORS.MODAL);
    if (modal && !modal.hidden) {
      modal.hidden = true;
    }
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
   * Injects the trusted UTC time provider (implemented by `DateSyncManager` in step 2).
   *
   * @param {(() => (Date|string|number))|null} provider - Function returning the estimated UTC
   *   time, or null to go back to the placeholder.
   * @returns {void}
   * @throws {TypeError} When the provider is neither a function nor null.
   */
  setUtcTimeProvider(provider) {
    if (provider !== null && typeof provider !== 'function') {
      throw new TypeError('App.setUtcTimeProvider expects a function or null.');
    }
    this.utcTimeProvider = provider;
    this.renderUtcClock();
  }

  /**
   * Starts the one-second UTC clock.
   *
   * @returns {void}
   */
  startUtcClock() {
    if (this.clockTimer !== null) return;
    this.renderUtcClock();
    this.clockTimer = window.setInterval(() => this.renderUtcClock(), CLOCK_INTERVAL_MS);
  }

  /**
   * Stops the UTC clock (used before a full reset).
   *
   * @returns {void}
   */
  stopUtcClock() {
    if (this.clockTimer === null) return;
    window.clearInterval(this.clockTimer);
    this.clockTimer = null;
  }

  /**
   * Writes the current UTC time in the header.
   *
   * Without a provider (before step 2) the placeholder `--:--:--` is displayed instead of a
   * system-clock based value: showing an untrusted time would defeat the anti-cheat design.
   *
   * @returns {void}
   */
  renderUtcClock() {
    const element = document.getElementById(HEADER_IDS.CLOCK);
    if (!element) return;

    if (!this.utcTimeProvider) {
      element.textContent = '--:--:--';
      return;
    }

    try {
      element.textContent = this.formatUtcTime(this.utcTimeProvider());
    } catch (error) {
      console.warn('[App] The UTC time provider failed.', error);
      element.textContent = '--:--:--';
    }
  }

  /**
   * Formats a UTC value as `HH:MM:SS`.
   *
   * @param {Date|string|number} value - Trusted UTC value.
   * @returns {string} The formatted time.
   * @throws {RangeError} When the value cannot be converted to a valid date.
   */
  formatUtcTime(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new RangeError('App.formatUtcTime received an invalid date value.');
    }
    return [date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()]
      .map((part) => String(part).padStart(2, '0'))
      .join(':');
  }

  /**
   * Sets the text of an element by id (no-op when the element is absent).
   *
   * @param {string} id - Target element id.
   * @param {string} text - Text to display.
   * @returns {void}
   */
  setText(id, text) {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = text;
    }
  }

  /**
   * Writes one of the header counters, capped for the narrow chips of a phone.
   *
   * Every counter of the header goes through here; the UTC clock does NOT (it is not a counter, it
   * has its own width and its own meaning, and it goes through `setText` directly).
   *
   * @param {string} id - Element id of the counter (`HEADER_IDS`).
   * @param {number} value - Raw value to display.
   * @returns {void}
   */
  setCount(id, value) {
    this.setText(id, formatHeaderCount(value));
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

    container.textContent = '';
    container.append(title, message, detail);
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
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js', { scope: '/projets/minecards/' })
      .then((registration) => console.info('[PWA] Service worker registered:', registration.scope))
      .catch((error) => console.error('[PWA] Service worker registration failed:', error));
  });
}

// The native scrollbars are hidden by `css/base.css`: this paints the thin bar back while a box
// moves. Started with the install event, before the first screen exists, so the scroll of the boot
// overlay is already followed.
scrollHint.start();

const app = new App();
app.start();

export default app;

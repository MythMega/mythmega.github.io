/**
 * app.js - Application bootstrap and orchestration.
 *
 * Reference: `.docs/steps/1.md` point 9 and `.docs/main.md` section 3.G.
 *
 * Startup order:
 *   1. open the IndexedDB database (schema creation on the first launch);
 *   2. load and validate `settings/config.json` (languages, themes, booster settings);
 *   3. apply the theme (the pre-render inline script already did it; this re-syncs the state);
 *   4. initialize i18n (translation files + `data-i18n` attributes);
 *   5. if no account exists: show the onboarding screen and stop here;
 *      otherwise: apply the stored settings, start the SPA router and wire the header.
 *
 * The header booster counters and the UTC clock are fed by `DateSyncManager` (step 2) through
 * `EVENTS.QUOTA_UPDATED`, `EVENTS.CONNECTION_STATUS` and `EVENTS.CLOCK_TICK`. `Date.now()` is
 * never used to display a time, so a cheater cannot shift the displayed reset by changing the
 * system clock.
 */

import storageRepository from './models/StorageRepository.js';
import accountManager from './business/AccountManager.js';
import dateSyncManager from './business/DateSyncManager.js';
import i18n from './utils/I18n.js';
import themeManager from './utils/ThemeManager.js';
import { configLoader } from './utils/ConfigLoader.js';
import eventBus, { EVENTS } from './utils/EventBus.js';
import { SpaRouter } from './UI/SpaRouter.js';
import { OnboardingView } from './UI/views/OnboardingView.js';
import { OpeningView, OPENING_VIEW_NAME } from './UI/views/OpeningView.js';
import { CollectionView, COLLECTION_VIEW_NAME } from './UI/views/CollectionView.js';
import { StatsView, STATS_VIEW_NAME } from './UI/views/StatsView.js';

/** Id of the boot overlay removed once the application is ready. */
export const BOOT_OVERLAY_ID = 'app-boot';

/** Id of the fatal error container. */
export const FATAL_ERROR_ID = 'app-fatal';

/** Ids of the header elements updated through events. */
export const HEADER_IDS = Object.freeze({
  DAILY: 'header-daily-boosters',
  BONUS: 'header-bonus-boosters',
  CLOCK: 'header-utc-clock',
});

/** Views managed by `index.html`, used by the router and by the reset flow. */
export const VIEW_NAMES = Object.freeze({
  ONBOARDING: 'onboarding',
  OPENING: 'opening',
  COLLECTION: 'collection',
  STATS: 'stats',
  SETTINGS: 'settings',
  GIFTS: 'gifts',
  REDEEM: 'redeem',
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
    /** @type {StatsView|null} Statistics panels (step 5). */
    this.statsView = null;
    /** @type {boolean} True once the header event subscriptions are registered. */
    this.headerBound = false;
    /** @type {Function|null} Unsubscribe function of the VIEW_CHANGED subscription. */
    this.unsubscribeViewChanged = null;
    /** @type {(() => (Date|string|number))|null} Trusted UTC provider injected by step 2. */
    this.utcTimeProvider = null;
    /** @type {number|null} */
    this.clockTimer = null;
    /** @type {{utc: Date, formatted: string, timeUntilReset: string}|null} Last published tick. */
    this.lastTick = null;
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
    this.bindViewLifecycle();
    await this.startTimeSync();
    this.renderHeaderCounters(dateSyncManager.getQuotaSnapshot());
    await this.startOpeningView();
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
   * Forwards the router activations to the opening view so the WebGL loop never runs while
   * another view is displayed (step 4, point 1).
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
    eventBus.on(EVENTS.QUOTA_UPDATED, (payload) => this.renderHeaderCounters(payload));
    eventBus.on(EVENTS.CONNECTION_STATUS, (payload) => this.setConnectionState(payload?.online));
    eventBus.on(EVENTS.CLOCK_TICK, (payload) => this.handleClockTick(payload));
    eventBus.on(EVENTS.ACCOUNT_REMOVED, () => this.handleAccountRemoved());
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
    console.info('[App] Account removed: releasing the clock and the opening view.');
    if (this.unsubscribeViewChanged) {
      this.unsubscribeViewChanged();
      this.unsubscribeViewChanged = null;
    }
    if (this.openingView) {
      this.openingView.destroy();
      this.openingView = null;
    }
    dateSyncManager.destroy();
    this.stopUtcClock();
    this.utcTimeProvider = null;
    this.lastTick = null;
    this.renderHeaderCounters(null);
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
    this.setText(HEADER_IDS.DAILY, String(daily));
    this.setText(HEADER_IDS.BONUS, String(bonusTotal));
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

const app = new App();
app.start();

export default app;
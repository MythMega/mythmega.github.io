/**
 * InstallPrompt - The "add MineCards to the home screen" banner of Chrome on Android.
 *
 * Reference: `manifest.json` (the manifest that makes the page installable, in portrait) and the
 * standalone meta tags of `index.html`.
 *
 * Chrome never installs a page by itself on a phone: once the manifest, the icons and the service
 * worker qualify, it fires `beforeinstallprompt` and leaves the page free to ask whenever it likes.
 * The default mini infobar is suppressed here (the only way to offer something better) and the
 * question is asked in the look of the game, as a banner above the bottom bar rather than a full
 * dialog: it never covers a game screen, and it can be put off.
 *
 * The answer is kept in `localStorage` and not in the save: an installation belongs to the browser,
 * not to the account, so wiping the save of a phone that already has the app must not ask again.
 * "Later" is honoured for `RETRY_AFTER_DAYS`, an accepted installation forever.
 *
 * `start()` only listens, and must run as early as the module boot: the browser fires its event
 * whenever it wants and it is gone once missed. `arm()` allows the banner to appear, which the
 * application calls once the main screen is up, so the onboarding is never covered by the offer.
 */

import i18n from '../../utils/I18n.js';
import eventBus, { EVENTS } from '../../utils/EventBus.js';

/** `localStorage` key remembering the answer given on this device. */
export const INSTALL_PROMPT_STORAGE_KEY = 'mc_install_prompt';

/** Wait between the moment the game is ready and the banner, in milliseconds. */
const SHOW_DELAY_MS = 6000;

/** How long "Later" keeps the banner away, in days. */
const RETRY_AFTER_DAYS = 30;

/** Delay used when the banner has to step aside for a dialog or a ritual, in milliseconds. */
const BUSY_RETRY_MS = 4000;

/** Display modes that mean the page is already running as the installed app. */
const INSTALLED_DISPLAY_MODES = ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'];

/**
 * Tells whether the page already runs as the installed application.
 *
 * `navigator.standalone` is the iOS answer, kept because a browser that never fires the install
 * event is still able to hide the banner once the app has been added to the home screen.
 *
 * @returns {boolean} True when the page is displayed in an installed window.
 */
function isInstalled() {
  if (window.navigator.standalone === true) return true;
  if (typeof window.matchMedia !== 'function') return false;
  return INSTALLED_DISPLAY_MODES.some((mode) => window.matchMedia(`(display-mode: ${mode})`).matches);
}

/**
 * Tells whether the device is a phone or a tablet.
 *
 * The install event only exists in the Chromium browsers, but it also fires on the desktop, where
 * Chrome already shows its own install icon in the address bar: the banner is for mobile, as the
 * request was. `userAgentData` is the short answer on Chromium; the user agent string covers the
 * browsers that do not expose it.
 *
 * @returns {boolean} True on a mobile device.
 */
function isMobileDevice() {
  const data = window.navigator.userAgentData;
  if (data && typeof data.mobile === 'boolean') return data.mobile;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(window.navigator.userAgent);
}

/**
 * Reads the answer stored on this device.
 *
 * A broken or hand-edited entry is treated as "never answered": the worst case is one banner too
 * many, never a banner that can never come back.
 *
 * @returns {{dismissedAt: number, installed: boolean}} The stored answer.
 */
function readAnswer() {
  const empty = { dismissedAt: 0, installed: false };
  try {
    const raw = window.localStorage.getItem(INSTALL_PROMPT_STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw);
    return {
      dismissedAt: Number.isFinite(parsed?.dismissedAt) ? parsed.dismissedAt : 0,
      installed: parsed?.installed === true,
    };
  } catch (error) {
    console.warn('[InstallPrompt] The stored answer could not be read.', error);
    return empty;
  }
}

/**
 * Writes the answer of this device.
 *
 * @param {{dismissedAt?: number, installed?: boolean}} answer - Values to remember.
 * @returns {void}
 */
function writeAnswer(answer) {
  const merged = { ...readAnswer(), ...answer };
  try {
    window.localStorage.setItem(INSTALL_PROMPT_STORAGE_KEY, JSON.stringify(merged));
  } catch (error) {
    console.warn('[InstallPrompt] The answer could not be stored.', error);
  }
}

export class InstallPrompt {
  constructor() {
    /** @type {HTMLElement|null} The banner, created on first display. */
    this.root = null;
    /** @type {Event|null} The `beforeinstallprompt` event, valid until `prompt()` is called. */
    this.deferredEvent = null;
    /** @type {number|null} Pending display timer. */
    this.timer = null;
    /** @type {boolean} True once the listeners are registered. */
    this.started = false;
    /** @type {boolean} True once the application allows the banner to appear. */
    this.armed = false;
    /** @type {(event: Event) => void} Kept bound so `start()` stays idempotent. */
    this.handleBeforeInstallPrompt = (event) => this.capture(event);
    /** @type {() => void} `appinstalled` listener. */
    this.handleInstalled = () => this.handleAppInstalled();
    /** @type {(event: KeyboardEvent) => void} Escape listener, active while the banner is visible. */
    this.handleKeyDown = (event) => {
      if (event.key !== 'Escape' || !this.isVisible()) return;
      // A dialog opened on top of the banner owns the key: closing it must not also drop the offer.
      if (document.querySelector('.modal:not([hidden])')) return;
      event.preventDefault();
      this.dismiss();
    };
  }

  /**
   * Registers the install listeners.
   *
   * Called at boot, before the browser can fire `beforeinstallprompt`: an event missed there is
   * missed for the whole page load, since Chrome will not fire it again before the next visit.
   *
   * @returns {void}
   */
  start() {
    if (this.started) return;
    this.started = true;
    window.addEventListener('beforeinstallprompt', this.handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', this.handleInstalled);
    eventBus.on(EVENTS.LANG_CHANGED, () => {
      if (this.isVisible()) this.render();
    });
  }

  /**
   * Allows the banner to appear.
   *
   * Called once the main screen is displayed: before that, the onboarding is the only thing a new
   * player should see. Safe to call again (a reset followed by a new account), and harmless when
   * the install event has not arrived yet (the capture schedules it then): the timer is simply
   * re-armed, and `schedule()` refuses on its own when there is nothing to offer.
   *
   * @returns {void}
   */
  arm() {
    this.armed = true;
    this.schedule(SHOW_DELAY_MS);
  }

  /**
   * Keeps the browser's install event instead of letting it show its own infobar.
   *
   * @param {Event} event - The `beforeinstallprompt` event.
   * @returns {void}
   */
  capture(event) {
    event.preventDefault();
    this.deferredEvent = event;
    if (this.armed) this.schedule(SHOW_DELAY_MS);
  }

  /**
   * Arms the display timer, unless the banner has already been answered or cannot be offered.
   *
   * @param {number} delay - Delay in milliseconds.
   * @returns {void}
   */
  schedule(delay) {
    this.clearTimer();
    if (!this.canOffer()) return;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.show();
    }, delay);
  }

  /**
   * Cancels the pending display timer.
   *
   * @returns {void}
   */
  clearTimer() {
    if (this.timer === null) return;
    window.clearTimeout(this.timer);
    this.timer = null;
  }

  /**
   * Tells whether the banner may be offered at all on this device.
   *
   * @returns {boolean} True when the game can still be installed and was not declined recently.
   */
  canOffer() {
    if (!this.deferredEvent) return false;
    if (!isMobileDevice() || isInstalled()) return false;
    const answer = readAnswer();
    if (answer.installed) return false;
    if (answer.dismissedAt <= 0) return true;
    const elapsedDays = (Date.now() - answer.dismissedAt) / 86_400_000;
    return elapsedDays >= RETRY_AFTER_DAYS;
  }

  /**
   * Tells whether the banner is currently on screen.
   *
   * @returns {boolean} True when it is displayed.
   */
  isVisible() {
    return this.root !== null && !this.root.hidden;
  }

  /**
   * Displays the banner, or waits for a quieter moment.
   *
   * A dialog or a ritual (opening a booster, picking a Mine Pick card) is never interrupted: the
   * offer would be a tap target in the middle of the thing the player came for. The banner simply
   * comes back a few seconds later. The gift popup of the automatic codes counts as a dialog even
   * though it is not a `.modal`: it owns the screen until it is dismissed.
   *
   * @returns {void}
   */
  show() {
    if (!this.canOffer() || this.isVisible()) return;
    const busy =
      document.body.classList.contains('is-focus') ||
      document.body.classList.contains('is-onboarding') ||
      document.querySelector('.modal:not([hidden])') !== null ||
      document.querySelector('.auto-claim:not([hidden])') !== null;
    if (busy) {
      this.schedule(BUSY_RETRY_MS);
      return;
    }

    this.ensureMarkup();
    this.render();
    this.root.hidden = false;
    document.addEventListener('keydown', this.handleKeyDown);
  }

  /**
   * Creates the banner once, and appends it to `<body>`.
   *
   * Built with DOM calls rather than markup: every text is translated at display time, so switching
   * language while the banner is up only needs `render()`.
   *
   * @returns {void}
   */
  ensureMarkup() {
    if (this.root) return;

    const root = document.createElement('aside');
    root.className = 'install-prompt';
    root.hidden = true;

    const icon = document.createElement('img');
    icon.className = 'install-prompt__icon';
    icon.src = 'assets/icons/icon-192.png';
    icon.alt = '';
    icon.width = 48;
    icon.height = 48;
    icon.decoding = 'async';

    const text = document.createElement('div');
    text.className = 'install-prompt__text';

    const title = document.createElement('p');
    title.className = 'install-prompt__title';
    title.dataset.installTitle = '';

    const message = document.createElement('p');
    message.className = 'install-prompt__message';
    message.dataset.installMessage = '';

    const actions = document.createElement('div');
    actions.className = 'install-prompt__actions';

    const laterButton = document.createElement('button');
    laterButton.type = 'button';
    laterButton.className = 'btn btn--ghost btn--small';
    laterButton.dataset.installLater = '';
    laterButton.addEventListener('click', () => this.dismiss());

    const installButton = document.createElement('button');
    installButton.type = 'button';
    installButton.className = 'btn btn--primary btn--small';
    installButton.dataset.installConfirm = '';
    installButton.addEventListener('click', () => void this.install());

    text.append(title, message);
    actions.append(laterButton, installButton);
    root.append(icon, text, actions);
    document.body.appendChild(root);

    this.root = root;
  }

  /**
   * Writes the current translations into the banner.
   *
   * @returns {void}
   */
  render() {
    if (!this.root) return;
    const title = i18n.t('install.title');
    this.root.setAttribute('aria-label', title);
    this.root.querySelector('[data-install-title]').textContent = title;
    this.root.querySelector('[data-install-message]').textContent = i18n.t('install.message');

    const installButton = this.root.querySelector('[data-install-confirm]');
    installButton.textContent = i18n.t('install.action');
    installButton.setAttribute('aria-label', i18n.t('install.actionLabel'));

    this.root.querySelector('[data-install-later]').textContent = i18n.t('install.later');
  }

  /**
   * Opens the browser's installation dialog.
   *
   * The deferred event can be used once: it is dropped before the call, so a second click does
   * nothing rather than throwing. Declining the native dialog counts as "Later": the player made a
   * choice and the banner must not come back on the next visit.
   *
   * @returns {Promise<void>} Resolves once the choice of the player is known.
   */
  async install() {
    const event = this.deferredEvent;
    this.deferredEvent = null;
    this.hide();

    if (!event || typeof event.prompt !== 'function') {
      console.warn('[InstallPrompt] The install event is no longer available.');
      return;
    }

    try {
      await event.prompt();
      const choice = await event.userChoice;
      if (choice?.outcome !== 'accepted') writeAnswer({ dismissedAt: Date.now() });
    } catch (error) {
      console.warn('[InstallPrompt] The installation could not be started.', error);
    }
  }

  /**
   * Puts the offer off for {@link RETRY_AFTER_DAYS}.
   *
   * @returns {void}
   */
  dismiss() {
    writeAnswer({ dismissedAt: Date.now() });
    this.hide();
  }

  /**
   * Removes the banner from the screen without recording anything.
   *
   * Used by the account reset (the banner must not float over the onboarding again) and by the
   * installation itself, which is remembered by `appinstalled` rather than by the click.
   *
   * @returns {void}
   */
  hide() {
    this.clearTimer();
    document.removeEventListener('keydown', this.handleKeyDown);
    if (this.root) this.root.hidden = true;
  }

  /**
   * Clears everything the browser has established once the app is installed.
   *
   * @returns {void}
   */
  handleAppInstalled() {
    this.deferredEvent = null;
    writeAnswer({ installed: true });
    this.hide();
  }
}

/** Shared instance used by the application bootstrap. */
export const installPrompt = new InstallPrompt();

export default installPrompt;

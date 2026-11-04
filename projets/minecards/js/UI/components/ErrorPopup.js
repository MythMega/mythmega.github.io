/**
 * ErrorPopup - The dialog a failure of the game is announced in.
 *
 * Reference: `js/utils/ErrorReporter.js` (which decides WHEN), `js/utils/ErrorReport.js` (what a
 * report holds), `css/components/error-popup.css` (the styles) and `.docs/main.md` section 3.K.
 *
 * WHY IT EXISTS
 * An error the player cannot quote is an error nobody can fix: "the 3D does not work" is a
 * conversation, "MC-4F1A02" plus the pasted text is a bug report. This dialog shows what broke, the
 * short code of the failure, and three ways to hand the report over:
 *   - "Copier le code" copies the WHOLE report and stays here, for a player who reports by mail or
 *     in a message of their own;
 *   - "Copier & report Discord" copies it and opens the invite in a new tab;
 *   - "Copier & report GitHub" copies it and opens a new issue on the repository.
 * Either way the clipboard holds everything (browser, GPU, WebGL, storage, release, stack), so the
 * player has nothing left to do but paste.
 *
 * THE TWO SAFETY NETS
 *   - the report is also written in a `<details>` block, selectable: a browser that refuses the
 *     clipboard (Firefox over plain HTTP, a denied permission) still lets the player copy it by hand;
 *   - every label goes through `translate()`, which falls back to a French sentence when the
 *     dictionaries are not loaded yet. This dialog has to work while the rest of the game does not.
 *
 * The markup is built by the component (not by `index.html`): it must be creatable on a page whose
 * views never booted, which is exactly when it is needed.
 */

import i18n from '../../utils/I18n.js';
import { writeToClipboard } from '../../utils/Clipboard.js';

/** Discord invite of the game: where the copied code has to be pasted. */
export const DISCORD_INVITE_URL = 'https://discord.gg/Zk8TRnwCxG';

/** Repository of the game: the "new issue" page is where a copied report is pasted too. */
export const GITHUB_ISSUE_URL = 'https://github.com/MythMega/mythmega.github.io/issues/new';

/** Class of the overlay, which is also a `.modal` so it inherits the shared dialog look. */
export const ERROR_POPUP_CLASS = 'error-popup';

/** Label shown on the clicked button for a few seconds after a successful copy. */
const COPY_FEEDBACK_MS = 6000;

/**
 * French fallbacks of every label.
 *
 * Used when `i18n.t()` returns the key itself (dictionaries not loaded: a boot failure), so the
 * dialog never shows `error.popup.copy` to a player.
 */
const FALLBACK_TEXTS = Object.freeze({
  'error.popup.badge': 'Erreur',
  'error.popup.title': 'Une erreur est survenue',
  'error.popup.body':
    "Le jeu a rencontré un problème. Le rapport contient tout ce qu'il faut pour comprendre le souci : copie-le et envoie-le sur Discord ou sur GitHub.",
  'error.popup.code': "Code d'erreur",
  'error.popup.copy': 'Copier le code',
  'error.popup.discord': 'Copier & report Discord',
  'error.popup.github': 'Copier & report GitHub',
  'error.popup.copied': 'Copié.',
  'error.popup.copyFailed': 'La copie a été refusée : sélectionne le texte des détails ci-dessus.',
  'error.popup.details': 'Détails techniques',
  'error.popup.close': 'Fermer',
  'error.popup.hint':
    "Chaque bouton copie le rapport complet ; les deux derniers ouvrent en plus Discord ou GitHub dans un nouvel onglet. Colle-le dans le canal d'aide ou dans un ticket.",
});

export class ErrorPopup {
  constructor() {
    /** @type {HTMLElement|null} Overlay. */
    this.root = null;
    /** @type {HTMLElement|null} Dialog. */
    this.dialog = null;
    /** @type {object|null} Report currently displayed. */
    this.report = null;
    /** @type {boolean} True once the markup exists. */
    this.mounted = false;
    /** @type {Element|null} Element focused before the dialog opened. */
    this.previousFocus = null;
    /** @type {number|null} Timer restoring the label of the copy buttons. */
    this.copyTimer = null;
    /** @type {HTMLElement|null} Button whose label carries the copy feedback. */
    this.feedbackButton = null;
    /** @type {(event: KeyboardEvent) => void} Escape handler, bound once. */
    this.handleKeyDown = (event) => {
      if (!this.isOpen() || event.key !== 'Escape') return;
      event.preventDefault();
      this.close();
    };
  }

  /**
   * Tells whether the dialog is on screen.
   *
   * @returns {boolean} True when it is open.
   */
  isOpen() {
    return Boolean(this.root) && this.root.hidden === false;
  }

  /**
   * Translates a key, falling back to a French sentence before the dictionaries load.
   *
   * @param {string} key - i18n key.
   * @returns {string} The translated text, or its fallback.
   */
  translate(key) {
    const fallback = FALLBACK_TEXTS[key] ?? key;
    try {
      const text = i18n.t(key);
      return text === key ? fallback : text;
    } catch (error) {
      return fallback;
    }
  }

  /**
   * Creates the shell of the dialog once.
   *
   * @returns {void}
   */
  ensureMarkup() {
    if (this.mounted && this.root) return;

    const root = document.createElement('div');
    root.className = `modal modal--stacked ${ERROR_POPUP_CLASS}`;
    root.dataset.errorPopup = '';
    root.hidden = true;
    root.addEventListener('click', (event) => {
      if (event.target === root) this.close();
    });

    const dialog = document.createElement('div');
    dialog.className = `modal__dialog ${ERROR_POPUP_CLASS}__dialog`;
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'error-popup-title');
    dialog.setAttribute('aria-describedby', 'error-popup-body');

    const badge = document.createElement('p');
    badge.className = `${ERROR_POPUP_CLASS}__badge`;
    badge.dataset.errorPopupBadge = '';

    const title = document.createElement('h2');
    title.className = 'modal__title';
    title.id = 'error-popup-title';
    title.dataset.errorPopupTitle = '';

    const body = document.createElement('p');
    body.className = `${ERROR_POPUP_CLASS}__body`;
    body.id = 'error-popup-body';
    body.dataset.errorPopupBody = '';

    const codeRow = document.createElement('p');
    codeRow.className = `${ERROR_POPUP_CLASS}__code-row`;
    const codeLabel = document.createElement('span');
    codeLabel.className = `${ERROR_POPUP_CLASS}__code-label`;
    codeLabel.dataset.errorPopupCodeLabel = '';
    const code = document.createElement('code');
    code.className = `${ERROR_POPUP_CLASS}__code`;
    code.dataset.errorPopupCode = '';
    codeRow.append(codeLabel, code);

    const details = document.createElement('details');
    details.className = `${ERROR_POPUP_CLASS}__details`;
    details.dataset.errorPopupDetails = '';
    const summary = document.createElement('summary');
    summary.dataset.errorPopupDetailsLabel = '';
    const pre = document.createElement('pre');
    pre.className = `${ERROR_POPUP_CLASS}__detail`;
    pre.dataset.errorPopupDetail = '';
    details.append(summary, pre);

    // The three reports copy the very same text; they differ by where they send the player next.
    const actions = document.createElement('div');
    actions.className = 'modal__actions';
    const copyButton = this.buildAction('data-error-popup-copy', 'btn--ghost', null);
    const discordButton = this.buildAction('data-error-popup-discord', 'btn--primary', DISCORD_INVITE_URL);
    const githubButton = this.buildAction('data-error-popup-github', 'btn--ghost', GITHUB_ISSUE_URL);
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'btn btn--ghost';
    closeButton.dataset.errorPopupClose = '';
    closeButton.addEventListener('click', () => this.close());
    actions.append(copyButton, discordButton, githubButton, closeButton);

    const hint = document.createElement('p');
    hint.className = `${ERROR_POPUP_CLASS}__hint`;
    hint.dataset.errorPopupHint = '';

    dialog.append(badge, title, body, codeRow, details, actions, hint);
    root.append(dialog);
    document.body.append(root);

    this.root = root;
    this.dialog = dialog;
    this.mounted = true;
  }

  /**
   * Builds one of the three report buttons.
   *
   * @param {string} dataAttribute - `data-…` marker the renderer writes the label into.
   * @param {string} modifier - Button modifier (`btn--primary` or `btn--ghost`).
   * @param {string|null} url - Page opened in a new tab when the report is copied, or null.
   * @returns {HTMLButtonElement} The button.
   */
  buildAction(dataAttribute, modifier, url) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `btn ${modifier}`;
    const key = dataAttribute.replace('data-', '').replace(/-([a-z])/g, (match, letter) => letter.toUpperCase());
    button.dataset[key] = '';
    button.addEventListener('click', () => {
      void this.copyCode({ button, url });
    });
    return button;
  }

  /**
   * Displays a report.
   *
   * A second report while the dialog is open replaces its content instead of stacking a second
   * dialog: the player sees the last failure, and the code of the one they are reading stays
   * reachable in the details block.
   *
   * @param {object} report - Report built by `createErrorReport()`.
   * @returns {void}
   */
  show(report) {
    if (!report || typeof report !== 'object') return;
    this.ensureMarkup();
    if (!this.root) return;

    if (!this.isOpen()) {
      this.previousFocus = document.activeElement;
      this.root.hidden = false;
      document.addEventListener('keydown', this.handleKeyDown);
    }

    this.report = report;
    this.render();
    this.log(`Displayed ${report.code ?? '(no code)'} (source: ${report.source ?? '?'}).`);
  }

  /**
   * Writes the labels and the content of the open dialog.
   *
   * @returns {void}
   */
  render() {
    if (!this.root || !this.report) return;
    const report = this.report;
    const query = (selector) => this.root.querySelector(selector);

    const badge = query('[data-error-popup-badge]');
    const title = query('[data-error-popup-title]');
    const body = query('[data-error-popup-body]');
    const codeLabel = query('[data-error-popup-code-label]');
    const code = query('[data-error-popup-code]');
    const details = query('[data-error-popup-details]');
    const detailsLabel = query('[data-error-popup-details-label]');
    const detail = query('[data-error-popup-detail]');
    const copy = query('[data-error-popup-copy]');
    const discord = query('[data-error-popup-discord]');
    const github = query('[data-error-popup-github]');
    const close = query('[data-error-popup-close]');
    const hint = query('[data-error-popup-hint]');

    if (badge) badge.textContent = this.translate('error.popup.badge');
    if (title) title.textContent = this.translate(report.titleKey ?? 'error.popup.title');
    if (body) body.textContent = this.translate(report.bodyKey ?? 'error.popup.body');
    if (codeLabel) codeLabel.textContent = this.translate('error.popup.code');
    if (code) code.textContent = report.code ?? '';
    if (details) details.open = false;
    if (detailsLabel) detailsLabel.textContent = this.translate('error.popup.details');
    if (detail) detail.textContent = report.text ?? '';
    if (copy) {
      copy.textContent = this.translate('error.popup.copy');
      copy.disabled = false;
    }
    if (discord) {
      discord.textContent = this.translate('error.popup.discord');
      discord.disabled = false;
    }
    if (github) {
      github.textContent = this.translate('error.popup.github');
      github.disabled = false;
    }
    if (close) close.textContent = this.translate('error.popup.close');
    if (hint) hint.textContent = this.translate('error.popup.hint');

    if (this.copyTimer !== null) {
      window.clearTimeout(this.copyTimer);
      this.copyTimer = null;
    }
    this.feedbackButton = null;

    window.requestAnimationFrame(() => {
      if (this.isOpen() && copy instanceof HTMLElement) copy.focus();
    });
  }

  /**
   * Copies the report and, when the button asked for it, opens Discord or GitHub.
   *
   * The tab is opened FIRST and synchronously: a browser only allows `window.open` inside the user
   * gesture that triggered it, and awaiting the clipboard first made the tab depend on a permission
   * prompt (and therefore be blocked). Copying after it changes nothing for the player: they paste a
   * few seconds later, on the other tab.
   *
   * @param {object} [options] - Copy options.
   * @param {HTMLElement|null} [options.button=null] - Button that carries the feedback label.
   * @param {string|null} [options.url=null] - Page to open in a new tab, or null to stay here.
   * @returns {Promise<boolean>} True when the text reached the clipboard.
   */
  async copyCode({ button = null, url = null } = {}) {
    const report = this.report;
    if (!report) return false;

    if (url) {
      try {
        window.open(url, '_blank', 'noopener,noreferrer');
      } catch (error) {
        console.warn('[ErrorPopup] The report tab could not be opened.', error);
      }
    }

    const text = report.text ?? `${report.code ?? ''}`;
    let copied = false;
    try {
      await writeToClipboard(text);
      copied = true;
    } catch (error) {
      console.warn('[ErrorPopup] The report could not be copied.', error);
    }

    const label = this.translate(copied ? 'error.popup.copied' : 'error.popup.copyFailed');
    const target = button instanceof HTMLElement ? button : null;
    if (target) {
      target.textContent = copied ? this.translate('error.popup.copied') : label;
      this.feedbackButton = target;
    }

    if (this.copyTimer !== null) window.clearTimeout(this.copyTimer);
    this.copyTimer = window.setTimeout(() => {
      this.copyTimer = null;
      this.restoreLabels();
    }, COPY_FEEDBACK_MS);

    // A refused copy leaves the player with the details block: it is opened for them.
    if (!copied) {
      const details = this.root?.querySelector('[data-error-popup-details]');
      if (details instanceof HTMLElement) details.open = true;
    }

    this.log(`Report ${report.code ?? ''} ${copied ? 'copied' : 'not copied'}.`);
    return copied;
  }

  /**
   * Puts the original labels back on the three report buttons.
   *
   * @returns {void}
   */
  restoreLabels() {
    if (!this.root) return;
    const labels = {
      '[data-error-popup-copy]': 'error.popup.copy',
      '[data-error-popup-discord]': 'error.popup.discord',
      '[data-error-popup-github]': 'error.popup.github',
    };
    Object.entries(labels).forEach(([selector, key]) => {
      const button = this.root.querySelector(selector);
      if (button instanceof HTMLElement) button.textContent = this.translate(key);
    });
    this.feedbackButton = null;
  }

  /**
   * Closes the dialog.
   *
   * @returns {void}
   */
  close() {
    if (!this.root) return;
    if (this.copyTimer !== null) {
      window.clearTimeout(this.copyTimer);
      this.copyTimer = null;
    }
    this.restoreLabels();
    this.root.hidden = true;
    document.removeEventListener('keydown', this.handleKeyDown);
    if (this.previousFocus instanceof HTMLElement && this.previousFocus.isConnected) {
      this.previousFocus.focus();
    }
    this.previousFocus = null;
  }

  /**
   * Logs with the popup prefix.
   *
   * @param {...unknown} args - Values forwarded to `console.info`.
   * @returns {void}
   */
  log(...args) {
    console.info('[ErrorPopup]', ...args);
  }

  /**
   * Removes the dialog from the page.
   *
   * @returns {void}
   */
  destroy() {
    this.close();
    this.root?.remove();
    this.root = null;
    this.dialog = null;
    this.mounted = false;
    this.report = null;
  }
}

/** Shared instance, used by the error reporter. */
export const errorPopup = new ErrorPopup();

export default errorPopup;

/**
 * ChangelogPopup - "What's new" dialog, shown once per version at startup.
 *
 * Reference: `settings/changelog.json`, `js/business/ChangelogManager.js`.
 *
 * It announces the notes of the NEWEST release only; the full history stays in the settings screen,
 * which the "full changelog" button opens. The dialog is built like `SetAnnouncementPopup`: the
 * shared `.modal` styles, appended to `<body>` so it can open over any view, and dismissed by the
 * backdrop, `Escape`, the close cross, `OK` or the "full changelog" button.
 *
 * The decision to show it belongs to the application (`js/app.js`): this component never reads the
 * save, and never writes the "announced" marker.
 */

import i18n from '../../utils/I18n.js';

/** Kinds of note the game can translate; anything else falls back to the label of the file. */
const CHANGELOG_TYPES = ['feature', 'fix', 'qol'];

export class ChangelogPopup {
  constructor() {
    /** @type {HTMLElement|null} Overlay, created on the first announcement. */
    this.root = null;
    /** @type {HTMLButtonElement|null} Close cross. */
    this.closeButton = null;
    /** @type {HTMLButtonElement|null} "Full changelog" button. */
    this.moreButton = null;
    /** @type {HTMLButtonElement|null} "OK" button. */
    this.okButton = null;
    /** @type {HTMLUListElement|null} List of the notes of the announced version. */
    this.notesElement = null;
    /** @type {HTMLParagraphElement|null} Badge above the title. */
    this.badgeElement = null;
    /** @type {HTMLHeadingElement|null} Title (the version). */
    this.titleElement = null;
    /** @type {HTMLParagraphElement|null} Sentence under the title. */
    this.introElement = null;
    /** @type {(() => void)|null} Called when the player asks for the full changelog. */
    this.onOpenChangelog = null;
    /** @type {Element|null} Element focused before the dialog opened. */
    this.previousFocus = null;
    /** @type {Promise<void>|null} Resolved when the dialog closes. */
    this.resolved = null;
    /** @type {(() => void)|null} Resolver of `resolved`. */
    this.resolveOpen = null;
    /** @type {(event: KeyboardEvent) => void} Escape handler, bound once. */
    this.handleKeyDown = (event) => {
      if (event.key !== 'Escape' || !this.isOpen()) return;
      event.preventDefault();
      this.close();
    };
  }

  /**
   * Tells whether the dialog is on screen.
   *
   * @returns {boolean} True when the overlay exists and is not hidden.
   */
  isOpen() {
    return Boolean(this.root) && this.root.hidden === false;
  }

  /**
   * Shows the notes of one version and resolves once the dialog is dismissed.
   *
   * The callback of the "full changelog" button runs AFTER the dialog closed, so the settings
   * screen it opens is not covered by the dialog that asked for it.
   *
   * @param {{version: string, notes: Array<object>}} version - Newest version of the changelog.
   * @param {object} [options] - Behaviour options.
   * @param {(() => void)|null} [options.onOpenChangelog] - Action of the "full changelog" button.
   * @returns {Promise<void>} Resolves once the dialog closed.
   */
  show(version, { onOpenChangelog = null } = {}) {
    if (!version || typeof version.version !== 'string' || version.version === '') {
      return Promise.resolve();
    }

    this.ensureMarkup();
    this.onOpenChangelog = typeof onOpenChangelog === 'function' ? onOpenChangelog : null;

    if (this.root.hidden) this.previousFocus = document.activeElement;
    this.render(version);
    this.root.hidden = false;
    document.addEventListener('keydown', this.handleKeyDown);
    this.okButton?.focus();

    if (!this.resolved) {
      this.resolved = new Promise((resolve) => {
        this.resolveOpen = resolve;
      });
    }
    return this.resolved;
  }

  /**
   * Closes the dialog and, when asked, runs the action of the "full changelog" button.
   *
   * @param {object} [options] - Close options.
   * @param {boolean} [options.openChangelog=false] - Opens the full changelog after closing.
   * @returns {void}
   */
  close({ openChangelog = false } = {}) {
    if (!this.isOpen()) return;

    document.removeEventListener('keydown', this.handleKeyDown);
    this.root.hidden = true;
    if (this.previousFocus instanceof HTMLElement && this.previousFocus.isConnected) {
      this.previousFocus.focus();
    }
    this.previousFocus = null;

    const resolve = this.resolveOpen;
    const callback = openChangelog ? this.onOpenChangelog : null;
    this.resolveOpen = null;
    this.resolved = null;
    this.onOpenChangelog = null;

    if (resolve) resolve();
    if (callback) callback();
  }

  /**
   * Creates the overlay once.
   *
   * `hidden` is toggled rather than the element being removed, so `UiSounds` keeps observing one
   * modal and plays its usual open/close sounds.
   *
   * @returns {void}
   */
  ensureMarkup() {
    if (this.root) return;

    const root = document.createElement('div');
    root.className = 'modal changelog-popup';
    root.hidden = true;
    root.addEventListener('click', (event) => {
      if (event.target === root) this.close();
    });

    const dialog = document.createElement('div');
    dialog.className = 'modal__dialog changelog-popup__dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'changelog-popup-title');

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'modal__close';
    closeButton.textContent = '×';
    closeButton.addEventListener('click', () => this.close());

    const badge = document.createElement('p');
    badge.className = 'changelog-popup__badge';

    const title = document.createElement('h2');
    title.className = 'modal__title changelog-popup__title';
    title.id = 'changelog-popup-title';

    const intro = document.createElement('p');
    intro.className = 'changelog-popup__intro';

    const notes = document.createElement('ul');
    notes.className = 'changelog__notes changelog-popup__notes';

    const actions = document.createElement('div');
    actions.className = 'modal__actions';

    const moreButton = document.createElement('button');
    moreButton.type = 'button';
    moreButton.className = 'btn btn--ghost';
    moreButton.addEventListener('click', () => this.close({ openChangelog: true }));

    const okButton = document.createElement('button');
    okButton.type = 'button';
    okButton.className = 'btn btn--primary';
    okButton.addEventListener('click', () => this.close());

    actions.append(moreButton, okButton);
    dialog.append(closeButton, badge, title, intro, notes, actions);
    root.appendChild(dialog);
    document.body.appendChild(root);

    this.root = root;
    this.closeButton = closeButton;
    this.moreButton = moreButton;
    this.okButton = okButton;
    this.notesElement = notes;
    this.badgeElement = badge;
    this.titleElement = title;
    this.introElement = intro;
  }

  /**
   * Writes one version into the dialog.
   *
   * The labels are rewritten on every opening: the interface language may have changed since the
   * last time, and the notes themselves are picked per language with a fallback chain.
   *
   * @param {{version: string, notes: Array<object>}} version - Version to announce.
   * @returns {void}
   */
  render(version) {
    if (!this.root) return;

    this.badgeElement.textContent = i18n.t('changelogpopup.badge');
    this.titleElement.textContent = i18n.t('changelogpopup.title', { version: version.version });
    this.introElement.textContent = i18n.t('changelogpopup.intro');
    this.moreButton.textContent = i18n.t('changelogpopup.more');
    this.okButton.textContent = i18n.t('changelogpopup.close');
    this.closeButton.setAttribute('aria-label', i18n.t('changelogpopup.dismiss'));

    const notes = Array.isArray(version.notes) ? version.notes : [];
    this.notesElement.hidden = notes.length === 0;
    this.notesElement.replaceChildren(...notes.map((note) => this.buildNote(note)));
  }

  /**
   * Builds one note: its kind and its text in the card... interface language.
   *
   * The classes are the ones of the changelog of the settings screen, so the popup and the full
   * page read the same (and an important note keeps its star).
   *
   * @param {{type: string, label: string, important: boolean, text: Record<string, string>}} note -
   *   Note to draw.
   * @returns {HTMLElement} The list item.
   */
  buildNote(note) {
    const item = document.createElement('li');
    item.className = 'changelog__note';
    item.dataset.type = note.type;

    const badge = document.createElement('span');
    badge.className = 'changelog__badge';
    badge.textContent = CHANGELOG_TYPES.includes(note.type)
      ? i18n.t(`settings.changelog.type.${note.type}`)
      : note.label;

    if (note.important) {
      item.classList.add('is-important');
      const star = document.createElement('span');
      star.className = 'changelog__star';
      star.setAttribute('role', 'img');
      star.setAttribute('aria-label', i18n.t('settings.changelog.important'));
      star.textContent = '★';
      badge.append(star);
    }

    const lang = i18n.getLang();
    const text = document.createElement('p');
    text.className = 'changelog__text';
    text.textContent =
      note.text?.[lang] ??
      note.text?.[i18n.defaultLang] ??
      Object.values(note.text ?? {})[0] ??
      '';

    item.append(badge, text);
    return item;
  }
}

/** Shared instance used by the application bootstrap. */
export const changelogPopup = new ChangelogPopup();

export default changelogPopup;

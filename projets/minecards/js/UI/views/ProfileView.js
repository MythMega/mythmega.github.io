/**
 * ProfileView - Player profile: identity, level, pinned trophies and favourite cards.
 *
 * Reference: `js/business/ProfileManager.js` (name, avatar icon, favourites, pins),
 * `js/business/TrophyManager.js` (level, experience, trophies) and
 * `js/UI/components/TrophyDetail.js` (the detail of a pinned trophy).
 *
 * The page shows the player's identity read-only — the pencil reveals the form, so a stray tap can
 * never change the name or the avatar — the level right under it, the pinned trophies and the
 * favourite cards. The whole trophy CATALOGUE is not here any more: it is a page of its own
 * (`js/UI/views/TrophiesView.js`), which pins the trophies this page highlights, opened by the
 * second small button under the subtitle since it left the bottom bar (the Mine took that slot).
 *
 * The avatar is picked from a closed list of icons (`js/business/ProfileIconManager.js`): the
 * default ones are always available, the others are granted by a trophy. A profile written by an
 * older version can still carry a photo URL: it stays displayed until an icon is chosen.
 *
 * The favourite cards are a grid of at most `profile.maxFavorites` columns, so they all fit on one
 * screen without scrolling and without their names — the illustration is the identifier, and the
 * detail modal (tap a card) still gives the name, the rarity and the copies.
 *
 * TO THE STATISTICS
 *   The statistics used to be a destination of the bottom bar of their own, then a block at the
 *   bottom of this page. They are now a page of their own (`js/UI/views/StatsView.js`, the `stats`
 *   view), which shows NOTHING but the statistics — no tab next to the title: the small button
 *   below the subtitle switches to it, and its back button comes back here. The navigation goes
 *   through `onNavigate`, because the router belongs to `app.js`: this view never touches it.
 */

import eventBus, { EVENTS } from '../../utils/EventBus.js';
import i18n from '../../utils/I18n.js';
import profileManager, { getProfileErrorMessageKey } from '../../business/ProfileManager.js';
import trophyManager from '../../business/TrophyManager.js';
import profileIconManager from '../../business/ProfileIconManager.js';
import collectionManager from '../../business/CollectionManager.js';
import TrophyDetail, { TROPHY_UNPIN_ICON } from '../components/TrophyDetail.js';
import { STATS_VIEW_NAME } from './StatsView.js';
import { TROPHIES_VIEW_NAME } from './TrophiesView.js';
import Toast from '../components/Toast.js';
import { getRarityLabel } from '../../classes/Card.js';

/** View name, matching `data-view="profile"` in `index.html`. */
export const PROFILE_VIEW_NAME = 'profile';

export class ProfileView {
  /**
   * @param {HTMLElement} rootElement - The profile `<section>`.
   * @param {object} [options] - View options.
   * @param {(viewName: string) => void} [options.onNavigate] - Called by the statistics button to
   *   switch view (the router belongs to `app.js`, which passes its `show()`).
   */
  constructor(rootElement, { onNavigate = null } = {}) {
    if (!rootElement || typeof rootElement.querySelector !== 'function') {
      throw new TypeError('ProfileView requires the profile section element.');
    }

    this.root = rootElement;
    this.feedbackElement = this.root.querySelector('[data-profile-feedback]');
    this.avatarImage = this.root.querySelector('[data-profile-avatar]');
    this.avatarFallback = this.root.querySelector('[data-profile-avatar-fallback]');
    this.displayNameElement = this.root.querySelector('[data-profile-display-name]');
    this.form = this.root.querySelector('[data-profile-form]');
    this.nameInput = this.root.querySelector('[data-profile-name]');
    this.iconsList = this.root.querySelector('[data-profile-icons]');
    this.submitButton = this.root.querySelector('[data-profile-submit]');
    this.cancelButton = this.root.querySelector('[data-profile-cancel]');
    this.editButton = this.root.querySelector('[data-profile-edit]');
    this.levelElement = this.root.querySelector('[data-profile-level]');
    this.xpFill = this.root.querySelector('[data-profile-xp-fill]');
    this.xpTextElement = this.root.querySelector('[data-profile-xp-text]');
    this.featuredElement = this.root.querySelector('[data-profile-featured]');
    this.featuredEmptyElement = this.root.querySelector('[data-profile-featured-empty]');
    this.favoritesElement = this.root.querySelector('[data-profile-favorites]');
    this.favoritesCountElement = this.root.querySelector('[data-profile-favorites-count]');
    this.favoritesEmptyElement = this.root.querySelector('[data-profile-favorites-empty]');
    this.modal = this.root.querySelector('[data-profile-modal]');
    this.modalTitle = this.root.querySelector('[data-profile-modal-title]');
    this.modalBody = this.root.querySelector('[data-profile-modal-body]');
    this.modalClose = this.root.querySelector('[data-profile-modal-close]');
    this.statsButton = this.root.querySelector('[data-profile-stats]');
    this.trophiesButton = this.root.querySelector('[data-profile-trophies]');

    this.assertMarkup();

    /** @type {((viewName: string) => void)|null} */
    this.onNavigate = typeof onNavigate === 'function' ? onNavigate : null;

    /** @type {object|null} Last profile read from `ProfileManager`. */
    this.profile = null;
    /** @type {object|null} Last trophy state returned by `TrophyManager`. */
    this.trophyState = null;
    /** @type {Map<string, object>} Collection entries keyed by card key. */
    this.entriesByKey = new Map();
    /** @type {Map<string, object>} Extension descriptors keyed by id (for the set names). */
    this.sets = new Map();
    /** @type {{default: object[], unlockable: object[]}|null} Avatar catalogue of the last render. */
    this.icons = null;
    /** @type {string} Icon selected in the form (stored on save). */
    this.selectedIcon = '';
    /**
     * @type {boolean} True when the displayed avatar is the `photo` URL of an older save, which is
     * not part of the icon picker (no tile is checked until the player chooses one).
     */
    this.hasLegacyAvatar = false;
    /** @type {boolean} True while the identity form is open. */
    this.isEditing = false;
    /** @type {boolean} True while a save is running (guards double submissions). */
    this.isSaving = false;
    /** @type {boolean} True once `init()` bound everything. */
    this.isInitialized = false;
    /** @type {boolean} True when the view is the active one. */
    this.isActive = false;
    /** @type {boolean} True while the view is loading its data. */
    this.isLoading = false;

    /** @type {Array<{target: EventTarget, type: string, handler: EventListener}>} */
    this.bindings = [];
    /** @type {Function[]} */
    this.unsubscribers = [];
  }

  /**
   * Logs with the view prefix.
   *
   * @param {...unknown} args - Values forwarded to `console.info`.
   * @returns {void}
   */
  log(...args) {
    console.info('[ProfileView]', ...args);
  }

  /**
   * Verifies that the markup matches the contract expected by this view.
   *
   * @returns {void}
   * @throws {Error} When a required element is missing from `index.html`.
   */
  assertMarkup() {
    const missing = [
      ['[data-profile-form]', this.form],
      ['[data-profile-name]', this.nameInput],
      ['[data-profile-icons]', this.iconsList],
      ['[data-profile-edit]', this.editButton],
      ['[data-profile-level]', this.levelElement],
      ['[data-profile-xp-fill]', this.xpFill],
      ['[data-profile-featured]', this.featuredElement],
      ['[data-profile-favorites]', this.favoritesElement],
      ['[data-profile-modal]', this.modal],
      ['[data-profile-modal-title]', this.modalTitle],
      ['[data-profile-modal-body]', this.modalBody],
      ['[data-profile-stats]', this.statsButton],
      ['[data-profile-trophies]', this.trophiesButton],
    ]
      .filter(([, element]) => !element)
      .map(([selector]) => selector);

    if (missing.length > 0) {
      throw new Error(`ProfileView markup is incomplete, missing: ${missing.join(', ')}.`);
    }
  }

  /**
   * Registers a listener and remembers it for `destroy()`.
   *
   * @param {EventTarget} target - Event target.
   * @param {string} type - Event type.
   * @param {EventListener} handler - Listener.
   * @returns {void}
   */
  listen(target, type, handler) {
    target.addEventListener(type, handler);
    this.bindings.push({ target, type, handler });
  }

  /**
   * Binds the interactions and loads the first render.
   *
   * @returns {Promise<void>} Resolves once the first render finished.
   */
  async init() {
    if (this.isInitialized) return;
    this.isInitialized = true;
    this.log('Initializing…');
    this.bindEvents();
    this.subscribeToEvents();
    await this.reload();
    this.log('Ready.');
  }

  /**
   * Attaches the DOM listeners (form, icon picker, pins and detail modal).
   *
   * @returns {void}
   */
  bindEvents() {
    // The statistics and the trophy catalogue both live on their own page: these buttons only ask
    // the application to show it (the catalogue left the bottom bar for this row).
    this.listen(this.statsButton, 'click', () => this.onNavigate?.(STATS_VIEW_NAME));
    this.listen(this.trophiesButton, 'click', () => this.onNavigate?.(TROPHIES_VIEW_NAME));
    this.listen(this.editButton, 'click', () => this.setEditing(!this.isEditing));
    this.listen(this.cancelButton, 'click', () => {
      this.renderIdentity(this.profile);
      this.setEditing(false);
    });

    this.listen(this.form, 'submit', (event) => {
      event.preventDefault();
      void this.handleSubmit();
    });

    // A single delegated listener: the picker is rebuilt whenever the catalogue changes.
    this.listen(this.iconsList, 'click', (event) => {
      const button = event.target instanceof Element ? event.target.closest('[data-profile-icon]') : null;
      if (button && !button.disabled) this.selectIcon(button.dataset.profileIcon);
    });

    // A dead avatar (an old remote photo URL) must not leave a broken image icon: the initial takes over.
    this.listen(this.avatarImage, 'error', () => {
      console.warn(`[ProfileView] The avatar could not be loaded: ${this.avatarImage.src}`);
      this.avatarImage.hidden = true;
      this.avatarFallback.hidden = false;
    });

    // One delegated listener per strip: the tiles are rebuilt on every render.
    this.listen(this.featuredElement, 'click', (event) => {
      if (!(event.target instanceof Element)) return;
      const unpin = event.target.closest('[data-trophy-unpin]');
      if (unpin) {
        void this.toggleFeatured(unpin.dataset.trophyUnpin);
        return;
      }
      const open = event.target.closest('[data-trophy-open]');
      if (open) void this.openTrophyDetail(open.dataset.trophyOpen);
    });

    this.listen(this.favoritesElement, 'click', (event) => {
      const open = event.target instanceof Element ? event.target.closest('[data-favorite-open]') : null;
      if (open) void this.openCardDetail(open.dataset.favoriteOpen);
    });

    this.listen(this.modal, 'click', (event) => {
      // A click on the backdrop (never on the dialog itself) closes the modal.
      if (event?.target === this.modal) this.closeDetail();
    });
    this.listen(this.modalClose, 'click', () => this.closeDetail());
    this.listen(document, 'keydown', (event) => {
      if (event?.key === 'Escape' && this.modal && !this.modal.hidden) this.closeDetail();
    });

    // The modal is rebuilt on every open, so its action buttons are handled by delegation.
    this.listen(this.modalBody, 'click', (event) => {
      const button = event.target instanceof Element ? event.target.closest('[data-favorite-remove]') : null;
      if (button) void this.removeFavorite(button.dataset.favoriteRemove);
    });

    this.log('DOM listeners bound.');
  }

  /**
   * Subscribes to the application events the view depends on.
   *
   * @returns {void}
   */
  subscribeToEvents() {
    this.unsubscribers.push(eventBus.on(EVENTS.VIEW_CHANGED, (payload) => {
      if (!payload || typeof payload.view !== 'string') return;
      if (payload.view === PROFILE_VIEW_NAME) {
        this.handleViewActivated();
      } else if (payload.previousView === PROFILE_VIEW_NAME) {
        this.handleViewDeactivated();
      }
    }));
    this.unsubscribers.push(eventBus.on(EVENTS.LANG_CHANGED, () => this.handleLanguageChanged()));
    this.unsubscribers.push(eventBus.on(EVENTS.TROPHY_UNLOCKED, () => this.handleTrophyUnlocked()));
    this.unsubscribers.push(eventBus.on(EVENTS.EXPERIENCE_UPDATED, (payload) => {
      if (payload?.level) this.renderLevel(payload.level);
    }));
    this.unsubscribers.push(eventBus.on(EVENTS.FAVORITES_UPDATED, (payload) => {
      if (Array.isArray(payload?.favorites)) void this.renderFavorites({ ...this.profile, favorites: payload.favorites });
    }));
    this.unsubscribers.push(eventBus.on(EVENTS.BOOSTER_OPENED, () => {
      // An opening adds cards: the level, the counters and the trophies all move.
      if (this.isInitialized && !this.isLoading) void this.reload();
    }));
    this.log('Event subscriptions registered.');
  }

  /**
   * Reads the profile, the trophies, the avatars and the collection, then renders every panel.
   *
   * @returns {Promise<void>} Resolves once the page is rendered (or the error shown).
   */
  async reload() {
    if (this.isLoading) return;
    this.isLoading = true;
    this.setFeedback(null);
    this.log('Loading the profile…');
    try {
      // The evaluation stays SILENT here: opening the page must never announce trophies. Only the
      // openings (`TrophyManager` subscribes to `BOOSTER_OPENED`) and the automatic boot evaluation
      // own the announcements, so a save that unlocks a dozen trophies shows one toast, not twelve.
      const [profile, trophyState, collection] = await Promise.all([
        profileManager.getProfile(),
        trophyManager.evaluate({ notify: false }),
        collectionManager.getCollectionView(),
      ]);
      this.profile = profile;
      this.trophyState = trophyState;
      this.entriesByKey = new Map((collection.entries ?? []).map((entry) => [entry.key, entry]));
      this.sets = new Map(Object.entries(collection.sets ?? {}));
      this.icons = await profileIconManager.listIcons({ trophyState });

      this.selectedIcon = profile.icon;
      this.renderIdentity(profile);
      this.renderIconPicker();
      this.renderLevel(trophyState.level);
      this.renderFeatured(trophyState, profile);
      await this.renderFavorites(profile);
    } catch (error) {
      console.error('[ProfileView] The profile could not be loaded.', error);
      this.setFeedback('profile.error.load', 'error');
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Opens or closes the identity form.
   *
   * The identity is displayed read-only by default: the form only exists while the player asked
   * for it, so the name and the avatar can never be changed by a stray tap.
   *
   * @param {boolean} editing - True to reveal the form.
   * @returns {void}
   */
  setEditing(editing) {
    this.isEditing = Boolean(editing);
    this.form.hidden = !this.isEditing;
    this.editButton.setAttribute('aria-expanded', String(this.isEditing));
    this.editButton.classList.toggle('is-active', this.isEditing);
    if (this.isEditing) {
      this.nameInput.focus();
    }
    this.log(this.isEditing ? 'Edit mode opened.' : 'Edit mode closed.');
  }

  /**
   * Renders the avatar, the display name and the name input.
   *
   * The avatar shows the selected icon, or the photo URL of a profile written by an older version,
   * or the initial of the display name when neither is set.
   *
   * @param {object} profile - Stored profile.
   * @returns {void}
   */
  renderIdentity(profile) {
    if (!profile) return;
    const name = typeof profile.name === 'string' ? profile.name : '';
    this.selectedIcon = typeof profile.icon === 'string' ? profile.icon : '';
    // A profile written by an older version stores its avatar in `photo` (a URL). Such an avatar is
    // still DISPLAYED, but it is none of the icons of the picker: no tile may claim the selection.
    this.hasLegacyAvatar = this.selectedIcon === ''
      && typeof profile.photo === 'string'
      && profile.photo !== '';
    // Only write the field when the value really changes: the preview is re-rendered when the
    // player picks another avatar, and re-assigning the same text would move the caret to the end
    // of a pseudo being typed.
    if (this.nameInput.value !== name) this.nameInput.value = name;

    const avatarPath = this.selectedIcon !== ''
      ? this.selectedIcon
      : (typeof profile.photo === 'string' ? profile.photo : '');
    const hasAvatar = avatarPath !== '';
    this.avatarImage.hidden = !hasAvatar;
    if (hasAvatar && this.avatarImage.getAttribute('src') !== avatarPath) {
      this.avatarImage.src = avatarPath;
    }
    this.avatarImage.alt = i18n.t('profile.avatar.alt');
    this.avatarFallback.hidden = hasAvatar;

    const display = name !== '' ? name : i18n.t('profile.anonymous');
    this.avatarFallback.textContent = display.slice(0, 1).toUpperCase();
    if (this.displayNameElement) {
      this.displayNameElement.textContent = display;
    }
  }

  /**
   * Renders the avatar picker: the "no icon" choice, the default icons and the trophy-pinned ones.
   *
   * A locked icon stays visible but disabled, with the trophy that grants it as a hint: the picker
   * is also the list of what there is to earn.
   *
   * @returns {void}
   */
  renderIconPicker() {
    if (!this.iconsList || !this.icons) return;
    this.iconsList.textContent = '';
    this.iconsList.appendChild(this.buildIconOption({
      name: i18n.t('profile.icons.none'),
      file: '',
      unlocked: true,
      source: 'none',
    }));

    [...this.icons.default, ...this.icons.unlockable].forEach((icon) => {
      this.iconsList.appendChild(this.buildIconOption(icon));
    });
    this.log(`${this.iconsList.children.length} avatar(s) offered in the picker.`);
  }

  /**
   * Builds one picker entry (`role="radio"` button wrapping the icon image).
   *
   * @param {object} icon - Icon descriptor (`{ name, file, unlocked, source, grantingTrophy }`).
   * @returns {HTMLLIElement} The entry.
   */
  buildIconOption(icon) {
    const item = document.createElement('li');
    item.className = 'profile__icon-option';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'profile__icon-choice';
    button.dataset.profileIcon = icon.file;
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', String(this.isIconChecked(icon.file)));
    button.disabled = !icon.unlocked;
    button.dataset.locked = String(!icon.unlocked);

    let accessibleLabel = icon.file === '' ? i18n.t('profile.icons.none') : icon.name;
    if (!icon.unlocked) {
      // A locked icon names the trophy that grants it: the picker doubles as a to-do list.
      const trophy = ProfileView.findGrantingTrophy(this.trophyState, icon.grantingTrophy);
      accessibleLabel = i18n.t('profile.icons.lockedBy', {
        trophy: trophy ? TrophyDetail.trophyTitle(trophy) : i18n.t('trophy.unknown'),
      });
      if (trophy) button.dataset.lockedBy = trophy.id;
    }
    button.setAttribute('aria-label', accessibleLabel);
    button.title = accessibleLabel;

    if (icon.file === '') {
      const fallback = document.createElement('span');
      fallback.className = 'profile__icon-none';
      // The "no avatar" tile: the empty set reads as "nothing" without borrowing a dash.
      fallback.textContent = '∅';
      fallback.setAttribute('aria-hidden', 'true');
      button.appendChild(fallback);
    } else {
      const image = document.createElement('img');
      image.className = 'profile__icon-image';
      image.src = i18n.resolveImagePath(icon.file);
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.setAttribute('aria-hidden', 'true');
      image.addEventListener('error', () => {
        console.warn(`[ProfileView] Avatar icon not found: ${image.src}`);
        image.hidden = true;
      });
      button.appendChild(image);
    }

    item.appendChild(button);
    return item;
  }

  /**
   * Tells whether one picker tile reads as the selected choice.
   *
   * @param {string} file - Icon path of the tile (`''` for the "no icon" choice).
   * @returns {boolean} True when the tile is the current selection.
   */
  isIconChecked(file) {
    if (file !== this.selectedIcon) return false;
    // The avatar of an older save (a `photo` URL) is not one of the declared icons: until the player
    // picks a tile, no tile is checked, not even "Aucune".
    return !(file === '' && this.hasLegacyAvatar === true);
  }

  /**
   * Resolves the trophy granting one unlockable icon.
   *
   * The catalogue pairs a trophy with its icons by extension + name, never by a built identifier.
   *
   * @param {object|null} trophyState - Value returned by `TrophyManager.evaluate()`.
   * @param {{setId: string, name: string}|null} grantingTrophy - Granting trophy descriptor.
   * @returns {object|null} The trophy, or null when it is not part of the catalogue any more.
   */
  static findGrantingTrophy(trophyState, grantingTrophy) {
    if (!grantingTrophy) return null;
    return (trophyState?.trophies ?? []).find(
      (candidate) => candidate.setId === grantingTrophy.setId && candidate.name === grantingTrophy.name
    ) ?? null;
  }

  /**
   * Selects one icon in the form (a live preview, saved with the form).
   *
   * @param {string} file - Icon path (`''` clears the avatar).
   * @returns {void}
   */
  selectIcon(file) {
    this.selectedIcon = typeof file === 'string' ? file : '';
    // Clicking a tile settles the choice: the legacy avatar of an older save is no longer "current",
    // so the picker shows the clicked tile as the selection ("Aucune" included, which then saves
    // an avatar-less profile).
    this.hasLegacyAvatar = false;
    this.iconsList.querySelectorAll('[data-profile-icon]').forEach((button) => {
      button.setAttribute('aria-checked', String(this.isIconChecked(button.dataset.profileIcon)));
    });
    // The preview mirrors what the save will store: the picked icon replaces the legacy URL (`photo`)
    // of an older save, so choosing "no icon" clears the displayed avatar right away. The pseudo
    // being typed is carried over: picking an avatar must never undo a name that is not saved yet.
    this.renderIdentity({
      ...this.profile,
      name: this.nameInput?.value ?? this.profile?.name ?? '',
      icon: this.selectedIcon,
      photo: '',
    });
    this.log(`Avatar icon selected: ${this.selectedIcon === '' ? 'none' : this.selectedIcon}.`);
  }

  /**
   * Renders the level, its bar and the XP line.
   *
   * @param {object} level - Value returned by `TrophyManager.resolveLevel()`.
   * @returns {void}
   */
  renderLevel(level) {
    const percent = Math.round((level.progress ?? 0) * 100);
    this.levelElement.textContent = String(level.level);
    this.xpFill.style.width = `${percent}%`;
    this.xpFill.setAttribute('role', 'progressbar');
    this.xpFill.setAttribute('aria-valuemin', '0');
    this.xpFill.setAttribute('aria-valuemax', '100');
    this.xpFill.setAttribute('aria-valuenow', String(percent));
    this.xpFill.setAttribute('aria-label', i18n.t('profile.level.label', { level: level.level }));

    if (this.xpTextElement) {
      const current = Math.max(0, level.experience - level.levelStart);
      this.xpTextElement.textContent = i18n.t('profile.level.progress', {
        current,
        required: level.required,
        next: level.level + 1,
        experience: level.experience,
      });
    }
  }

  /**
   * Renders the pinned trophies as a single row of clickable tiles.
   *
   * @param {object} trophyState - Value returned by `TrophyManager.evaluate()`.
   * @param {object} profile - Stored profile.
   * @returns {void}
   */
  renderFeatured(trophyState, profile) {
    const byId = new Map(trophyState.trophies.map((trophy) => [trophy.id, trophy]));
    const pinned = (profile.featured ?? [])
      .map((id) => byId.get(id))
      .filter((trophy) => Boolean(trophy));

    this.featuredElement.textContent = '';
    pinned.forEach((trophy, index) => {
      this.featuredElement.appendChild(this.buildTrophyTile(trophy, index));
    });
    if (this.featuredEmptyElement) {
      this.featuredEmptyElement.hidden = pinned.length > 0;
    }
  }

  /**
   * Builds one pinned-trophy tile: a button that opens its detail, plus the unpin icon on top-right.
   *
   * @param {object} trophy - Trophy state.
   * @param {number} index - Position in the row (drives the staggered entry animation).
   * @returns {HTMLLIElement} The tile.
   */
  buildTrophyTile(trophy, index) {
    const item = document.createElement('li');
    item.className = 'profile__tile profile__tile--trophy';
    item.dataset.rarity = trophy.rarity;
    item.dataset.unlocked = String(trophy.unlocked);
    item.style.setProperty('--tile-index', String(index));

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'profile__tile-open';
    open.dataset.trophyOpen = trophy.id;
    open.setAttribute('aria-label', TrophyDetail.trophyTitle(trophy));

    const medal = TrophyDetail.buildMedal(trophy);
    if (medal) open.appendChild(medal);
    open.appendChild(TrophyDetail.buildRarityBadge(trophy));

    const title = document.createElement('span');
    title.className = 'profile__tile-title';
    title.textContent = TrophyDetail.trophyTitle(trophy);
    open.appendChild(title);

    item.appendChild(open);
    item.appendChild(TrophyDetail.buildIconButton({
      className: 'profile__tile-action',
      datasetKey: 'trophyUnpin',
      value: trophy.id,
      icon: TROPHY_UNPIN_ICON,
      label: i18n.t('profile.featured.unpin'),
    }));

    return item;
  }

  /**
   * Renders the favourite cards as a grid that never needs scrolling.
   *
   * A favourite whose card cannot be resolved any more (extension rebalanced, orphan row) is still
   * listed with its raw key: hiding it would leave a pin the player could never get rid of.
   *
   * @param {object} profile - Stored profile.
   * @returns {Promise<void>} Resolves once the grid is rendered.
   */
  async renderFavorites(profile) {
    if (!profile) return;
    const limits = await profileManager.getLimits();
    const favorites = Array.isArray(profile.favorites) ? profile.favorites : [];

    // The grid has exactly one column per allowed favourite: five cards, no horizontal scrolling.
    this.favoritesElement.style.setProperty('--favorite-columns', String(Math.max(limits.maxFavorites, 1)));

    if (this.favoritesCountElement) {
      this.favoritesCountElement.textContent = i18n.t('profile.favorites.count', {
        count: favorites.length,
        max: limits.maxFavorites,
      });
    }
    if (this.favoritesEmptyElement) {
      this.favoritesEmptyElement.hidden = favorites.length > 0;
      this.favoritesEmptyElement.textContent = i18n.t('profile.favorites.empty', { max: limits.maxFavorites });
    }

    this.favoritesElement.textContent = '';
    favorites.forEach((key, index) => {
      const entry = this.entriesByKey.get(key);
      this.favoritesElement.appendChild(this.buildCardTile(key, entry, index));
    });
  }

  /**
   * Builds one favourite tile: a button showing the illustration only, which opens the card detail.
   *
   * The name is deliberately NOT displayed (the panel must fit on one screen); it stays the
   * accessible name of the button and is spelled out in the detail modal.
   *
   * @param {string} key - Collection key.
   * @param {object|undefined} entry - Collection entry, when the card still exists.
   * @param {number} index - Position in the grid (drives the staggered entry animation).
   * @returns {HTMLLIElement} The tile.
   */
  buildCardTile(key, entry, index) {
    const card = entry?.card ?? null;
    const name = card ? card.getName(i18n.getLang()) : key;

    const item = document.createElement('li');
    item.className = 'profile__tile profile__tile--card';
    item.style.setProperty('--tile-index', String(index));
    if (card) item.dataset.rarity = String(card.rarity);

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'profile__tile-open';
    open.dataset.favoriteOpen = key;
    open.setAttribute('aria-label', name);
    open.title = name;

    if (card) {
      const image = document.createElement('img');
      image.className = 'profile__tile-image';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.src = i18n.resolveImagePath(card.illustration);
      image.alt = '';
      image.setAttribute('aria-hidden', 'true');
      image.addEventListener('error', () => {
        console.warn(`[ProfileView] Favourite illustration not found for "${key}": ${image.src}`);
        image.hidden = true;
      });
      open.appendChild(image);
    }

    item.appendChild(open);
    return item;
  }

  /**
   * Opens the detail modal for one pinned trophy.
   *
   * @param {string} id - Trophy id.
   * @returns {Promise<void>} Resolves once the modal is displayed.
   */
  async openTrophyDetail(id) {
    const trophy = this.trophyState?.trophies?.find((candidate) => candidate.id === id);
    if (!trophy || !this.modal || !this.modalBody || !this.modalTitle) {
      console.warn(`[ProfileView] Unknown trophy "${id}".`);
      return;
    }

    this.modalTitle.textContent = TrophyDetail.trophyTitle(trophy);
    this.modalBody.textContent = '';

    let icons = [];
    try {
      icons = await profileIconManager.getIconsForTrophy(trophy);
    } catch (error) {
      console.warn(`[ProfileView] The avatars unlocked by "${id}" could not be read.`, error);
    }

    this.modalBody.appendChild(TrophyDetail.buildDetailBody(trophy, {
      experiencePerTrophy: this.trophyState.experiencePerTrophy,
      icons,
    }));
    this.openModal(trophy.id);
  }

  /**
   * Opens the detail modal for one favourite card.
   *
   * @param {string} key - Collection key.
   * @returns {Promise<void>} Resolves once the modal is displayed.
   */
  async openCardDetail(key) {
    const entry = this.entriesByKey.get(key);
    if (!this.modal || !this.modalBody || !this.modalTitle) return;

    const card = entry?.card ?? null;
    const name = card ? card.getName(i18n.getLang()) : key;
    this.modalTitle.textContent = name;
    this.modalBody.textContent = '';

    if (card) {
      const image = document.createElement('img');
      image.className = 'profile-modal__card';
      image.decoding = 'async';
      image.src = i18n.resolveImagePath(card.illustration);
      image.alt = name;
      image.addEventListener('error', () => {
        console.warn(`[ProfileView] Detail illustration not found for "${key}": ${image.src}`);
        image.hidden = true;
      });
      this.modalBody.appendChild(image);
    }

    const list = document.createElement('dl');
    list.className = 'card-modal__details';
    const rows = [];
    if (card) {
      rows.push([i18n.t('opening.card.rarity'), getRarityLabel(card.rarity, (translationKey) => i18n.t(translationKey))]);
      rows.push([i18n.t('opening.card.set'), this.resolveSetName(entry.set ?? card.set ?? null)]);
    }
    if (entry?.owned) {
      rows.push([i18n.t('collection.copies'), `x${entry.quantity}`]);
      if (entry.firstObtainedAt) {
        rows.push([i18n.t('collection.firstObtained'), TrophyDetail.formatDate(entry.firstObtainedAt)]);
      }
    } else if (!entry) {
      // A favourite whose card left the catalogue: say so instead of showing an empty modal.
      rows.push([i18n.t('collection.filter.status'), i18n.t('profile.favorites.unknown')]);
    }
    rows.forEach(([term, value]) => list.appendChild(TrophyDetail.buildDetailRow(term, value)));
    this.modalBody.appendChild(list);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn profile-modal__remove';
    remove.dataset.favoriteRemove = key;
    remove.textContent = i18n.t('profile.favorites.remove');
    this.modalBody.appendChild(remove);

    this.openModal(`card:${key}`);
  }

  /**
   * Displays the detail modal and restarts its entry animation.
   *
   * @param {string} source - Identifier of the shown item (trophy id or `card:<key>`).
   * @returns {void}
   */
  openModal(source) {
    this.modal.hidden = false;
    this.modal.classList.remove('is-opening');
    // Restarting the animation is what makes a second open feel alive too.
    void this.modal.offsetWidth;
    this.modal.classList.add('is-opening');
    this.log(`Detail opened for "${source}".`);
  }

  /**
   * Closes the detail modal.
   *
   * @returns {void}
   */
  closeDetail() {
    if (!this.modal || this.modal.hidden) return;
    this.modal.hidden = true;
    this.modal.classList.remove('is-opening');
  }

  /**
   * Resolves the display name of an extension.
   *
   * @param {string|null} setId - Extension id.
   * @returns {string} The translated or stored name, or an em dash.
   */
  resolveSetName(setId) {
    if (!setId) return i18n.t('common.unknown');
    return this.sets?.get(setId)?.name ?? setId;
  }

  /**
   * Saves the identity form (the display name and the selected avatar).
   *
   * @returns {Promise<void>} Resolves once the save finished (or the refusal was reported).
   */
  async handleSubmit() {
    if (this.isSaving) return;
    this.isSaving = true;
    if (this.submitButton) this.submitButton.disabled = true;
    try {
      const next = await profileManager.setIdentity({
        name: this.nameInput.value,
        icon: this.selectedIcon,
      });
      this.profile = next;
      this.renderIdentity(next);
      this.renderIconPicker();
      this.setEditing(false);
      this.setFeedback('profile.saved', 'info');
      Toast.success('profile.saved');
      this.log('Profile saved.');
      // The level depends on whether a custom name is set (see the levelling experience).
      if (this.trophyState) {
        void this.reload();
      }
    } catch (error) {
      console.error('[ProfileView] The profile could not be saved.', error);
      const key = getProfileErrorMessageKey(error);
      this.setFeedback(key, 'error');
      Toast.error(key);
    } finally {
      this.isSaving = false;
      if (this.submitButton) this.submitButton.disabled = false;
    }
  }

  /**
   * Unpins one trophy (pinning happens on the Trophées page).
   *
   * @param {string} id - Trophy id.
   * @returns {Promise<void>} Resolves once the pin state is stored (or the refusal reported).
   */
  async toggleFeatured(id) {
    try {
      const { featured, added } = await profileManager.toggleFeatured(id);
      this.profile = { ...this.profile, featured };
      this.renderFeatured(this.trophyState, this.profile);
      Toast.success(added ? 'profile.featured.pinned' : 'profile.featured.unpinned');
    } catch (error) {
      console.error('[ProfileView] The trophy could not be unpinned.', error);
      Toast.error(getProfileErrorMessageKey(error));
    }
  }

  /**
   * Removes one card from the favourites.
   *
   * @param {string} key - Collection key.
   * @returns {Promise<void>} Resolves once the removal is stored (or the failure reported).
   */
  async removeFavorite(key) {
    try {
      const { favorites } = await profileManager.toggleFavorite(key);
      this.profile = { ...this.profile, favorites };
      await this.renderFavorites(this.profile);
      this.closeDetail();
      Toast.success('profile.favorites.removed');
    } catch (error) {
      console.error('[ProfileView] The favourite could not be removed.', error);
      Toast.error(getProfileErrorMessageKey(error));
    }
  }

  /**
   * Refreshes the page when a trophy is unlocked (the announcement is made by `app.js`).
   *
   * @returns {void}
   */
  handleTrophyUnlocked() {
    if (this.isInitialized && !this.isLoading) {
      void this.reload();
    }
  }

  /**
   * Displays a translated feedback message.
   *
   * @param {string|null} key - i18n key, or null to hide the message.
   * @param {'info'|'error'} [tone='info'] - Visual tone.
   * @returns {void}
   */
  setFeedback(key, tone = 'info') {
    if (!this.feedbackElement) return;
    if (!key) {
      this.feedbackElement.hidden = true;
      this.feedbackElement.textContent = '';
      return;
    }
    this.feedbackElement.hidden = false;
    this.feedbackElement.textContent = i18n.t(key);
    this.feedbackElement.dataset.tone = tone;
    if (tone === 'error') {
      console.warn(`[ProfileView] ${i18n.t(key)}`);
    }
  }

  /**
   * Re-renders every translated label after a language change.
   *
   * @returns {void}
   */
  handleLanguageChanged() {
    this.log(`Language changed, re-rendering (${i18n.getLang()}).`);
    if (this.isInitialized && !this.isLoading) {
      void this.reload();
    }
  }

  /**
   * Reloads the page when the view becomes active (a pack may have been opened meanwhile).
   *
   * @returns {void}
   */
  handleViewActivated() {
    this.isActive = true;
    this.log('View activated.');
    if (this.isInitialized && !this.isLoading) {
      void this.reload();
    }
  }

  /**
   * Marks the view as inactive.
   *
   * @returns {void}
   */
  handleViewDeactivated() {
    this.isActive = false;
    this.log('View deactivated.');
  }

  /**
   * Removes every listener.
   *
   * @returns {void}
   */
  destroy() {
    this.log('Destroying the view.');
    this.bindings.forEach(({ target, type, handler }) => target.removeEventListener(type, handler));
    this.bindings = [];
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers = [];
    this.profile = null;
    this.trophyState = null;
    this.entriesByKey = new Map();
    this.sets = new Map();
    this.icons = null;
    this.isInitialized = false;
  }
}

export default ProfileView;

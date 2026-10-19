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
import trophyManager, { DEFAULT_TROPHY_ICON } from '../../business/TrophyManager.js';
import profileIconManager from '../../business/ProfileIconManager.js';
import titleManager, { TitleManager } from '../../business/TitleManager.js';
import collectionManager from '../../business/CollectionManager.js';
import TrophyDetail, { TROPHY_UNPIN_ICON } from '../components/TrophyDetail.js';
import { applyCardGlow } from '../../utils/Shine.js';
import { attachCardTilt } from '../../utils/CardTilt.js';
import ProfileCard, {
  PROFILE_CARD_DEFAULT_LAYOUT,
  PROFILE_CARD_LAYOUT_ORDER,
  PROFILE_CARD_LAYOUTS,
  PROFILE_CARD_RARITIES,
} from '../components/ProfileCard.js';
import profileCardManager, {
  ProfileCardManager,
  PROFILE_CARD_DEFAULT_TITLE_COLOR,
} from '../../business/ProfileCardManager.js';
import colorManager, { AUTO_COLOR_ID, colorName } from '../../business/ColorManager.js';
import featureManager, {
  FEATURES,
  FEATURE_ERROR_CODES,
  PROFILE_SLOT_KINDS,
  TITLE_COLOR_FEATURE_PREFIX,
  USERNAME_COLOR_FEATURE_PREFIX,
} from '../../business/FeatureManager.js';
import sparksManager from '../../business/SparksManager.js';
import slotPurchaseModal from '../components/SlotPurchaseModal.js';

/**
 * i18n keys naming the purchasable features (`FeatureManager.FEATURES`).
 *
 * The catalogue is keyed by identifier, so the name of a feature is read from this table: a feature
 * added later needs one entry here and one key per dictionary, nothing else.
 */
const FEATURE_LABEL_KEYS = Object.freeze({
  [FEATURES.CARD_LAYOUT_FULL_ART]: 'profile.card.feature.cardLayoutFullArt',
});
import { STATS_VIEW_NAME } from './StatsView.js';
import { TITLES_VIEW_NAME } from './TitlesView.js';
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
    this.titleLineElement = this.root.querySelector('[data-profile-title-line]');
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
    this.featuredHelpElement = this.root.querySelector('[data-profile-featured-help]');
    this.favoritesElement = this.root.querySelector('[data-profile-favorites]');
    this.favoritesCountElement = this.root.querySelector('[data-profile-favorites-count]');
    this.favoritesEmptyElement = this.root.querySelector('[data-profile-favorites-empty]');
    this.cardBackgroundsElement = this.root.querySelector('[data-profile-card-backgrounds]');
    this.cardBackgroundsHelpElement = this.root.querySelector('[data-profile-card-backgrounds-help]');
    this.cardStage = this.root.querySelector('[data-profile-card-stage]');
    this.cardHost = this.root.querySelector('[data-profile-card-host]');
    this.cardRarityElement = this.root.querySelector('[data-profile-card-rarity]');
    this.cardFeedbackElement = this.root.querySelector('[data-profile-card-feedback]');
    this.cardLayoutsElement = this.root.querySelector('[data-profile-card-layouts]');
    this.cardFullArtButton = this.root.querySelector('[data-profile-card-layout="fullart"]');
    this.cardLockElement = this.root.querySelector('[data-profile-card-layout-lock]');
    this.cardPriceElement = this.root.querySelector('[data-profile-card-layout-price]');
    this.cardPriceValueElement = this.root.querySelector('[data-profile-card-layout-price-value]');
    this.cardRaritiesElement = this.root.querySelector('[data-profile-card-rarities]');
    this.cardTitleColorsElement = this.root.querySelector('[data-profile-card-title-colors]');
    this.cardTitleColorsPriceElement = this.root.querySelector('[data-profile-card-title-colors-price]');
    this.usernameColorsElement = this.root.querySelector('[data-profile-username-colors]');
    this.usernameColorsHelpElement = this.root.querySelector('[data-profile-username-colors-help]');
    this.cardBuyModal = this.root.querySelector('[data-profile-card-buy-modal]');
    this.cardBuyFeatureElement = this.root.querySelector('[data-profile-card-buy-feature]');
    this.cardBuyPriceElement = this.root.querySelector('[data-profile-card-buy-price]');
    this.cardBuyBalanceElement = this.root.querySelector('[data-profile-card-buy-balance]');
    this.cardBuyMessageElement = this.root.querySelector('[data-profile-card-buy-message]');
    this.cardBuyConfirmButton = this.root.querySelector('[data-profile-card-buy-confirm]');
    this.cardBuyCloseButtons = this.root.querySelectorAll('[data-profile-card-buy-close]');
    this.cardDownloadButton = this.root.querySelector('[data-profile-card-download]');
    this.cardExpandButton = this.root.querySelector('[data-profile-card-expand]');
    this.cardModal = this.root.querySelector('[data-profile-card-modal]');
    this.cardModalBody = this.root.querySelector('[data-profile-card-modal-body]');
    this.cardModalDownloadButton = this.root.querySelector('[data-profile-card-modal-download]');
    this.cardModalCloseButtons = this.root.querySelectorAll('[data-profile-card-modal-close]');
    this.modal = this.root.querySelector('[data-profile-modal]');
    this.modalTitle = this.root.querySelector('[data-profile-modal-title]');
    this.modalBody = this.root.querySelector('[data-profile-modal-body]');
    this.modalClose = this.root.querySelector('[data-profile-modal-close]');
    this.statsButton = this.root.querySelector('[data-profile-stats]');
    this.trophiesButton = this.root.querySelector('[data-profile-trophies]');
    this.titlesButton = this.root.querySelector('[data-profile-titles]');

    this.assertMarkup();

    /** @type {((viewName: string) => void)|null} */
    this.onNavigate = typeof onNavigate === 'function' ? onNavigate : null;

    /** @type {object|null} Last profile read from `ProfileManager`. */
    this.profile = null;
    /** @type {object|null} Last trophy state returned by `TrophyManager`. */
    this.trophyState = null;
    /** @type {Map<string, object>} Collection entries keyed by card key. */
    this.entriesByKey = new Map();
    /** @type {object|null} Last value returned by `CollectionManager.getCollectionView()`. */
    this.collection = null;
    /** @type {ProfileCard|null} The card of the profile (built on first render). */
    this.profileCard = null;
    /**
     * @type {string} Layout of the card, kept by the view so a reload (an opening, a language
     * change) does not reset the switch the player chose.
     */
    this.cardLayout = PROFILE_CARD_DEFAULT_LAYOUT;
    /** @type {{layout: string, rarity: number|null, titleColor: string}} Display preferences stored
     *   by the account. */
    this.cardPreferences = {
      layout: PROFILE_CARD_DEFAULT_LAYOUT,
      rarity: null,
      titleColor: PROFILE_CARD_DEFAULT_TITLE_COLOR,
      background: null,
    };
    /** @type {object|null} Last card model built by `ProfileCardManager` (drives the rarity picker). */
    this.lastCardModel = null;
    /** @type {boolean} True when the Full Art layout has been bought (`FeatureManager`). */
    this.fullArtOwned = false;
    /** @type {number} Price of the Full Art layout, in Sparks. */
    this.fullArtPrice = 0;
    /** @type {Record<string, number>} Price of each title colour, in Sparks. */
    this.titleColorPrices = {};
    /** @type {number} Price announced for a colour that declares none, in Sparks. */
    this.titleColorDefaultPrice = 0;
    /** @type {Set<string>} Ids of the title colours the account bought. */
    this.ownedTitleColors = new Set();
    /** @type {Array<object>} Palette read from `settings/colors.json`. */
    this.colorCatalog = [];
    /** @type {Record<string, number>} Price of each pseudo colour, in Sparks. */
    this.usernameColorPrices = {};
    /** @type {Set<string>} Ids of the pseudo colours the account bought. */
    this.ownedUsernameColors = new Set();
    /** @type {string} Pseudo colour selected in the form (saved with the identity). */
    this.selectedUsernameColor = AUTO_COLOR_ID;
    /** @type {string} Identifier the buy modal is about (a feature or a colour). */
    this.pendingFeatureId = null;
    /** @type {'feature'|'titleColor'|'usernameColor'|'icon'} Which catalogue the pending purchase
     *   belongs to. */
    this.pendingPurchaseType = 'feature';
    /** @type {HTMLElement|null} Element the card stage lives in outside the enlargement modal. */
    this.cardStageHome = null;
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
      ['[data-profile-featured-help]', this.featuredHelpElement],
      ['[data-profile-favorites]', this.favoritesElement],
      ['[data-profile-card-backgrounds]', this.cardBackgroundsElement],
      ['[data-profile-card-backgrounds-help]', this.cardBackgroundsHelpElement],
      ['[data-profile-card-stage]', this.cardStage],
      ['[data-profile-card-host]', this.cardHost],
      ['[data-profile-card-rarity]', this.cardRarityElement],
      ['[data-profile-card-feedback]', this.cardFeedbackElement],
      ['[data-profile-card-layouts]', this.cardLayoutsElement],
      ['[data-profile-card-layout="fullart"]', this.cardFullArtButton],
      ['[data-profile-card-layout-lock]', this.cardLockElement],
      ['[data-profile-card-layout-price]', this.cardPriceElement],
      ['[data-profile-card-rarities]', this.cardRaritiesElement],
      ['[data-profile-card-title-colors]', this.cardTitleColorsElement],
      ['[data-profile-card-title-colors-price]', this.cardTitleColorsPriceElement],
      ['[data-profile-username-colors]', this.usernameColorsElement],
      ['[data-profile-card-buy-modal]', this.cardBuyModal],
      ['[data-profile-card-buy-feature]', this.cardBuyFeatureElement],
      ['[data-profile-card-buy-confirm]', this.cardBuyConfirmButton],
      ['[data-profile-card-download]', this.cardDownloadButton],
      ['[data-profile-card-expand]', this.cardExpandButton],
      ['[data-profile-card-modal]', this.cardModal],
      ['[data-profile-card-modal-body]', this.cardModalBody],
      ['[data-profile-modal]', this.modal],
      ['[data-profile-modal-title]', this.modalTitle],
      ['[data-profile-modal-body]', this.modalBody],
      ['[data-profile-stats]', this.statsButton],
      ['[data-profile-trophies]', this.trophiesButton],
      ['[data-profile-titles]', this.titlesButton],
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
    // The statistics, the trophy catalogue and the titles all live on their own page: these buttons
    // only ask the application to show them (the catalogue left the bottom bar for this row).
    this.listen(this.statsButton, 'click', () => this.onNavigate?.(STATS_VIEW_NAME));
    this.listen(this.trophiesButton, 'click', () => this.onNavigate?.(TROPHIES_VIEW_NAME));
    this.listen(this.titlesButton, 'click', () => this.onNavigate?.(TITLES_VIEW_NAME));
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
      if (button && !button.disabled) this.handleIconClick(button.dataset.profileIcon);
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
      const buy = event.target.closest('[data-profile-slot-buy]');
      if (buy) {
        void this.openSlotPurchase(buy.dataset.profileSlotBuy);
        return;
      }
      const pick = event.target.closest('[data-profile-slot-pick]');
      if (pick) {
        void this.openSlotPicker(pick.dataset.profileSlotPick);
        return;
      }
      const unpin = event.target.closest('[data-trophy-unpin]');
      if (unpin) {
        void this.toggleFeatured(unpin.dataset.trophyUnpin);
        return;
      }
      const open = event.target.closest('[data-trophy-open]');
      if (open) void this.openTrophyDetail(open.dataset.trophyOpen);
    });

    this.listen(this.favoritesElement, 'click', (event) => {
      if (!(event.target instanceof Element)) return;
      const buy = event.target.closest('[data-profile-slot-buy]');
      if (buy) {
        void this.openSlotPurchase(buy.dataset.profileSlotBuy);
        return;
      }
      const pick = event.target.closest('[data-profile-slot-pick]');
      if (pick) {
        void this.openSlotPicker(pick.dataset.profileSlotPick);
        return;
      }
      const open = event.target.closest('[data-favorite-open]');
      if (open) void this.openCardDetail(open.dataset.favoriteOpen);
    });

    this.listen(this.modal, 'click', (event) => {
      // A click on the backdrop (never on the dialog itself) closes the modal.
      if (event?.target === this.modal) this.closeDetail();
    });
    this.listen(this.modalClose, 'click', () => this.closeDetail());
    this.listen(document, 'keydown', (event) => {
      if (event?.key !== 'Escape') return;
      // The enlargement of the card is on top of everything: Escape closes it first.
      if (this.cardBuyModal && !this.cardBuyModal.hidden) {
        this.closeBuyModal();
        return;
      }
      if (this.cardModal && !this.cardModal.hidden) {
        this.closeCardModal();
        return;
      }
      if (this.modal && !this.modal.hidden) this.closeDetail();
    });

    // Profile card: the layout switch, the rarity picker, the PNG export and the enlargement.
    this.listen(this.cardLayoutsElement, 'click', (event) => {
      const button = event.target instanceof Element
        ? event.target.closest('[data-profile-card-layout]')
        : null;
      if (button) this.handleCardLayoutClick(button.dataset.profileCardLayout);
    });
    this.listen(this.cardRaritiesElement, 'click', (event) => {
      const button = event.target instanceof Element
        ? event.target.closest('[data-profile-card-rarity-option]')
        : null;
      if (button && !button.disabled) this.setCardRarity(Number(button.dataset.profileCardRarityOption));
    });
    this.listen(this.cardTitleColorsElement, 'click', (event) => {
      const button = event.target instanceof Element
        ? event.target.closest('[data-profile-card-title-color]')
        : null;
      if (button) this.handleCardTitleColorClick(button.dataset.profileCardTitleColor);
    });
    this.listen(this.usernameColorsElement, 'click', (event) => {
      const button = event.target instanceof Element
        ? event.target.closest('[data-profile-username-color]')
        : null;
      if (button) this.handleUsernameColorClick(button.dataset.profileUsernameColor);
    });
    this.listen(this.cardBackgroundsElement, 'click', (event) => {
      const button = event.target instanceof Element
        ? event.target.closest('[data-profile-card-background]')
        : null;
      if (button) this.setCardBackground(button.dataset.profileCardBackground);
    });

    // Buying a feature: the confirmation modal, reachable from a locked switch button only.
    this.listen(this.cardBuyConfirmButton, 'click', () => void this.confirmFeaturePurchase());
    this.cardBuyCloseButtons.forEach((button) => this.listen(button, 'click', () => this.closeBuyModal()));
    this.listen(this.cardBuyModal, 'click', (event) => {
      if (event?.target === this.cardBuyModal) this.closeBuyModal();
    });
    this.listen(this.cardDownloadButton, 'click', () => void this.downloadProfileCard());
    this.listen(this.cardModalDownloadButton, 'click', () => void this.downloadProfileCard());
    this.listen(this.cardExpandButton, 'click', () => this.openCardModal());
    this.cardModalCloseButtons.forEach((button) => this.listen(button, 'click', () => this.closeCardModal()));
    this.listen(this.cardModal, 'click', (event) => {
      if (event?.target === this.cardModal) this.closeCardModal();
    });

    // The modal is rebuilt on every open, so its action buttons are handled by delegation.
    this.listen(this.modalBody, 'click', (event) => {
      if (!(event.target instanceof Element)) return;
      const remove = event.target.closest('[data-favorite-remove]');
      if (remove) {
        void this.removeFavorite(remove.dataset.favoriteRemove);
        return;
      }
      const choice = event.target.closest('[data-profile-slot-choice]');
      if (choice) {
        void this.applySlotChoice(choice.dataset.profileSlotChoice, choice.dataset.profileSlotValue);
      }
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
    this.unsubscribers.push(eventBus.on(EVENTS.TITLE_UNLOCKED, () => this.handleTitleUnlocked()));
    this.unsubscribers.push(eventBus.on(EVENTS.EXPERIENCE_UPDATED, (payload) => {
      if (payload?.level) this.renderLevel(payload.level);
    }));
    // A profile change (a new title, another avatar, a pin) redraws the card: it is a picture of
    // the account, so it must never show what the page next to it no longer says.
    this.unsubscribers.push(eventBus.on(EVENTS.PROFILE_UPDATED, (payload) => {
      if (payload?.profile) this.profile = payload.profile;
      void this.renderProfileCard();
    }));
    this.unsubscribers.push(eventBus.on(EVENTS.FAVORITES_UPDATED, (payload) => {
      if (!Array.isArray(payload?.favorites)) return;
      this.profile = { ...this.profile, favorites: payload.favorites };
      void this.renderFavorites(this.profile);
      // The card borrows its illustration from one of the favourites.
      void this.renderProfileCard();
    }));
    // A feature bought from another tab (or another screen, later) unlocks its switch here too.
    this.unsubscribers.push(eventBus.on(EVENTS.FEATURE_UNLOCKED, () => {
      if (this.isInitialized && !this.isLoading) void this.reload();
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
      const [profile, trophyState, collection, preferences, catalog, purchases, titleColors,
        usernameColors, colorCatalog] = await Promise.all([
        profileManager.getProfile(),
        trophyManager.evaluate({ notify: false }),
        collectionManager.getCollectionView(),
        profileCardManager.getPreferences(),
        featureManager.getCatalog(),
        featureManager.getPurchases(),
        featureManager.getTitleColors(),
        featureManager.getUsernameColors(),
        colorManager.listColors(),
      ]);
      this.profile = profile;
      this.trophyState = trophyState;
      this.collection = collection;
      this.cardPreferences = preferences;
      this.fullArtPrice = catalog[FEATURES.CARD_LAYOUT_FULL_ART]?.priceSparks ?? 0;
      this.fullArtOwned = Object.prototype.hasOwnProperty.call(
        purchases,
        FEATURES.CARD_LAYOUT_FULL_ART
      );
      this.colorCatalog = Array.isArray(colorCatalog) ? colorCatalog : [];
      this.titleColorPrices = { ...(titleColors.items ?? {}) };
      this.titleColorDefaultPrice = 0;
      this.ownedTitleColors = new Set(
        Object.keys(purchases)
          .filter((id) => id.startsWith(TITLE_COLOR_FEATURE_PREFIX))
          .map((id) => id.slice(TITLE_COLOR_FEATURE_PREFIX.length))
      );
      this.usernameColorPrices = { ...(usernameColors.items ?? {}) };
      this.ownedUsernameColors = new Set(
        Object.keys(purchases)
          .filter((id) => id.startsWith(USERNAME_COLOR_FEATURE_PREFIX))
          .map((id) => id.slice(USERNAME_COLOR_FEATURE_PREFIX.length))
      );
      this.selectedUsernameColor = typeof profile.usernameColor === 'string'
        ? profile.usernameColor
        : AUTO_COLOR_ID;
      this.entriesByKey = new Map((collection.entries ?? []).map((entry) => [entry.key, entry]));
      this.sets = new Map(Object.entries(collection.sets ?? {}));
      this.icons = await profileIconManager.listIcons({
        trophyState,
        level: trophyState.level?.level ?? 1,
        purchases,
      });

      this.selectedIcon = profile.icon;
      this.renderIdentity(profile);
      this.renderUsernameColors();
      await this.renderTitleLine(profile);
      this.renderIconPicker();
      this.renderLevel(trophyState.level);
      await this.renderFeatured(trophyState, profile);
      await this.renderFavorites(profile);
      await this.renderProfileCard();
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
    this.selectedUsernameColor = ProfileView.resolveOwnedColor(
      profile.usernameColor,
      this.ownedUsernameColors,
      this.colorCatalog
    );
    if (this.displayNameElement) {
      this.displayNameElement.textContent = display;
      this.displayNameElement.style.removeProperty('--profile-name-color');
      const colorId = ProfileView.resolveOwnedColor(
        profile.usernameColor,
        this.ownedUsernameColors,
        this.colorCatalog
      );
      const entry = this.colorCatalog.find((candidate) => candidate.id === colorId);
      if (entry) this.displayNameElement.style.setProperty('--profile-name-color', entry.hex);
    }
  }

  /**
   * Resolves a stored colour against what the account can actually wear.
   *
   * `auto` is always allowed; any other id must be both declared by `settings/colors.json` and
   * bought (`FeatureManager`). A hand-edited save therefore cannot paint the pseudo with a colour
   * that was never paid for.
   *
   * @param {unknown} preference - Stored colour id.
   * @param {Set<string>} owned - Ids the account bought.
   * @param {Array<{id: string}>} catalog - Palette read from `settings/colors.json`.
   * @returns {string} `auto` or the id of an owned colour.
   */
  static resolveOwnedColor(preference, owned, catalog) {
    const text = typeof preference === 'string' ? preference : '';
    if (text === AUTO_COLOR_ID) return AUTO_COLOR_ID;
    const declared = Array.isArray(catalog) && catalog.some((entry) => entry.id === text);
    return declared && owned instanceof Set && owned.has(text) ? text : AUTO_COLOR_ID;
  }

  /**
   * Renders the pseudo-colour picker of the identity form.
   *
   * It shares the palette of `settings/colors.json` with the title line, but not the purchases:
   * a colour bought for one line is not bought for the other. A locked swatch stays clickable and
   * opens the same confirmation modal as the title colours.
   *
   * @returns {void}
   */
  renderUsernameColors() {
    if (!this.usernameColorsElement) return;
    const entries = [
      { id: AUTO_COLOR_ID, hex: 'var(--color-text)', name: i18n.t('profile.usernameColor.auto') },
      ...this.colorCatalog.map((entry) => ({
        id: entry.id,
        hex: entry.hex,
        name: colorName(entry, i18n.getLang()),
      })),
    ];

    this.usernameColorsElement.textContent = '';
    entries.forEach((entry) => {
      const owned = entry.id === AUTO_COLOR_ID || this.ownedUsernameColors.has(entry.id);
      const selected = entry.id === this.selectedUsernameColor;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'profile__color profile-card-panel__color';
      button.dataset.profileUsernameColor = entry.id;
      button.dataset.owned = String(owned);
      button.dataset.selected = String(selected);
      button.setAttribute('aria-pressed', String(selected));
      button.style.setProperty('--swatch-color', entry.hex);

      const price = this.usernameColorPrices[entry.id] ?? 0;
      const label = owned
        ? entry.name
        : i18n.t('profile.usernameColor.locked', { color: entry.name, price });
      button.title = label;
      button.setAttribute('aria-label', label);

      const dot = document.createElement('span');
      dot.className = 'profile-card-panel__color-dot';
      dot.setAttribute('aria-hidden', 'true');
      button.appendChild(dot);

      const name = document.createElement('span');
      name.className = 'profile-card-panel__color-name';
      name.textContent = entry.name;
      button.appendChild(name);

      if (!owned) {
        const priceElement = document.createElement('span');
        priceElement.className = 'profile-card-panel__color-price';
        const coin = document.createElement('img');
        coin.className = 'profile-card-panel__price-icon';
        coin.src = 'assets/img/sparks.png';
        coin.alt = '';
        coin.setAttribute('aria-hidden', 'true');
        const value = document.createElement('span');
        value.textContent = String(price);
        priceElement.append(coin, value);
        button.appendChild(priceElement);
      }

      this.usernameColorsElement.appendChild(button);
    });

    if (this.usernameColorsHelpElement) {
      this.usernameColorsHelpElement.textContent = i18n.t('profile.usernameColor.help');
    }
  }

  /**
   * Selects a pseudo colour in the form (a live preview, saved with the identity).
   *
   * An owned (or `auto`) colour is applied right away; a locked one opens the purchase instead,
   * exactly like the title colours of the profile card.
   *
   * @param {string} id - Colour id, or `auto`.
   * @returns {void}
   */
  handleUsernameColorClick(id) {
    if (typeof id !== 'string' || id === '') return;
    if (id === AUTO_COLOR_ID || this.ownedUsernameColors.has(id)) {
      this.selectedUsernameColor = id;
      // The pseudo being typed is carried over: picking a colour must never undo a name that is
      // not saved yet (the same rule as the avatar picker).
      const preview = {
        ...this.profile,
        name: this.nameInput?.value ?? this.profile?.name ?? '',
        usernameColor: id,
      };
      this.renderIdentity(preview);
      this.renderUsernameColors();
      // The picker lives with the card controls now, away from the identity form's Save button:
      // wearing an owned colour is saved immediately, exactly like the title colour above it.
      void this.persistUsernameColor(id);
      return;
    }
    const entry = this.colorCatalog.find((candidate) => candidate.id === id);
    if (!entry) return;
    void this.openBuyModal(id, {
      type: 'usernameColor',
      label: colorName(entry, i18n.getLang()),
      price: this.usernameColorPrices[id] ?? 0,
    });
  }

  /**
   * Wears one pseudo colour and stores it on the profile.
   *
   * Only `auto` and an OWNED colour are accepted. The identity itself (name and avatar) is carried
   * over untouched: this is a colour choice, not a save of the edit form.
   *
   * @param {string} id - Colour id, or `auto`.
   * @returns {Promise<void>} Resolves once the choice is stored (or the failure reported).
   */
  async persistUsernameColor(id) {
    if (!this.profile) return;
    const accepted = id === AUTO_COLOR_ID || this.ownedUsernameColors.has(id);
    if (!accepted) return;
    try {
      const next = await profileManager.setIdentity({
        name: this.profile.name ?? '',
        icon: this.profile.icon ?? '',
        usernameColor: id,
      });
      this.profile = next;
      void this.renderProfileCard();
      this.log(`Pseudo colour set to "${id}" and saved.`);
    } catch (error) {
      console.error('[ProfileView] The pseudo colour could not be saved.', error);
      this.setCardFeedback('profile.error.color', 'error');
    }
  }

  /**
   * Renders the player TITLE, the line under the pseudo.
   *
   * The profile only stores the ID of the title (`ProfileManager`): the catalogue is what turns it
   * into the sentence of the active language, and a title that left the catalogue simply leaves the
   * line empty (a worn title is never a broken string).
   *
   * @param {object} profile - Stored profile.
   * @returns {Promise<void>} Resolves once the line is rendered.
   */
  async renderTitleLine(profile) {
    if (!this.titleLineElement) return;
    const id = typeof profile?.title === 'string' ? profile.title.trim() : '';
    let text = '';
    if (id !== '') {
      try {
        const title = await titleManager.getTitle(id);
        if (title) text = TitleManager.titleText(title, i18n.getLang());
      } catch (error) {
        console.warn(`[ProfileView] The title "${id}" could not be read.`, error);
      }
    }
    this.titleLineElement.textContent = text;
    this.titleLineElement.hidden = text === '';
    this.titleLineElement.dataset.titleId = text === '' ? '' : id;
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
   * Re-reads the avatar catalogue after a purchase and redraws the picker.
   *
   * The bought icon must stop showing its price (and become selectable) without a page reload.
   *
   * @returns {Promise<void>} Resolves once the picker is redrawn.
   */
  async refreshIcons() {
    try {
      const purchases = await featureManager.getPurchases();
      this.icons = await profileIconManager.listIcons({
        trophyState: this.trophyState,
        level: this.trophyState?.level?.level ?? 1,
        purchases,
      });
      this.renderIconPicker();
    } catch (error) {
      console.error('[ProfileView] The avatar catalogue could not be refreshed.', error);
    }
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
    // A paid icon the player can afford to unlock stays CLICKABLE: it opens the purchase instead of
    // selecting itself. An icon gated by a level (or by a trophy) stays disabled.
    button.disabled = !icon.unlocked && !icon.purchasable;
    button.dataset.locked = String(!icon.unlocked);
    button.dataset.purchasable = String(Boolean(icon.purchasable));

    let accessibleLabel = icon.file === '' ? i18n.t('profile.icons.none') : icon.name;
    if (!icon.unlocked) {
      if (icon.lockedReason === 'price') {
        accessibleLabel = i18n.t('profile.icons.lockedByPrice', {
          name: icon.name,
          price: icon.price,
        });
      } else if (icon.lockedReason === 'level') {
        accessibleLabel = icon.price > 0
          ? i18n.t('profile.icons.lockedByLevelPrice', {
              level: icon.requiredLevel,
              price: icon.price,
            })
          : i18n.t('profile.icons.lockedByLevel', { level: icon.requiredLevel });
      } else {
        // A trophy-gated icon names the trophy that grants it: the picker doubles as a to-do list.
        const trophy = ProfileView.findGrantingTrophy(this.trophyState, icon.grantingTrophy);
        accessibleLabel = i18n.t('profile.icons.lockedBy', {
          trophy: trophy ? TrophyDetail.trophyTitle(trophy) : i18n.t('trophy.unknown'),
        });
        if (trophy) button.dataset.lockedBy = trophy.id;
      }
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

    if (icon.price > 0 && !icon.owned) {
      const price = document.createElement('span');
      price.className = 'profile__icon-price';
      const coin = document.createElement('img');
      coin.className = 'profile-card-panel__price-icon';
      coin.src = 'assets/img/sparks.png';
      coin.alt = '';
      coin.setAttribute('aria-hidden', 'true');
      const value = document.createElement('span');
      value.textContent = String(icon.price);
      price.append(coin, value);
      button.appendChild(price);
    }

    item.appendChild(button);
    return item;
  }

  /**
   * Handles a click on one avatar tile.
   *
   * An available icon is selected; a paid one the level does not gate opens the purchase modal. A
   * tile gated by a level or a trophy is disabled and never reaches this method.
   *
   * @param {string} file - Icon path.
   * @returns {void}
   */
  handleIconClick(file) {
    const icon = [...(this.icons?.default ?? []), ...(this.icons?.unlockable ?? [])]
      .find((candidate) => candidate.file === file);
    if (!icon) return;
    if (icon.unlocked) {
      this.selectIcon(file);
      return;
    }
    if (!icon.purchasable) return;
    void this.openBuyModal(file, {
      type: 'icon',
      label: icon.name,
      price: icon.price,
    });
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
  async renderFeatured(trophyState, profile) {
    const byId = new Map(trophyState.trophies.map((trophy) => [trophy.id, trophy]));
    const pinned = (profile.featured ?? [])
      .map((id) => byId.get(id))
      .filter((trophy) => Boolean(trophy));
    const slotState = await featureManager.getSlotState(PROFILE_SLOT_KINDS.FEATURED);
    // Every slot is always drawn: the owned ones are either a trophy or an empty slot the player
    // can fill, the others carry their price and can be bought one after the other.
    const slots = Math.max(slotState.owned, pinned.length);

    this.featuredElement.textContent = '';
    for (let index = 0; index < slots; index += 1) {
      const trophy = pinned[index];
      this.featuredElement.appendChild(trophy
        ? this.buildTrophyTile(trophy, index)
        : this.buildEmptySlotTile(PROFILE_SLOT_KINDS.FEATURED, index + 1, index));
    }
    this.renderLockedSlots(this.featuredElement, slotState, slots, PROFILE_SLOT_KINDS.FEATURED);

    if (this.featuredHelpElement) {
      this.featuredHelpElement.textContent = i18n.t('profile.featured.help', {
        max: slotState.owned,
      });
    }
    if (this.featuredEmptyElement) {
      // Slots are always visible now: the empty state would only repeat them.
      this.featuredEmptyElement.hidden = true;
    }
  }

  /**
   * Appends the slots the account does not own yet.
   *
   * Only the NEXT slot is purchasable (the prices are a ladder); the following ones are drawn as
   * locked slots with their price, so the player sees what the list can become.
   *
   * @param {HTMLElement} container - Strip receiving the tiles.
   * @param {{owned: number, max: number, next: object|null, prices: Record<number, number>}} slotState
   *   Value returned by `FeatureManager.getSlotState()`.
   * @param {number} start - First slot to draw (the owned count).
   * @param {string} kind - `PROFILE_SLOT_KINDS` member.
   * @returns {void}
   */
  renderLockedSlots(container, slotState, start, kind) {
    for (let slot = start + 1; slot <= slotState.max; slot += 1) {
      const price = slotState.prices[slot];
      if (!Number.isInteger(price) || price < 0) continue;
      const purchasable = slotState.next?.slot === slot;
      container.appendChild(this.buildLockedSlotTile(kind, slot, price, purchasable, slot - 1));
    }
  }

  /**
   * Builds an EMPTY owned slot: clicking it opens the picker of trophies or cards.
   *
   * @param {string} kind - `PROFILE_SLOT_KINDS` member.
   * @param {number} slot - Slot number (1-based).
   * @param {number} index - Position in the strip.
   * @returns {HTMLLIElement} The tile.
   */
  buildEmptySlotTile(kind, slot, index) {
    const label = i18n.t(
      kind === PROFILE_SLOT_KINDS.FAVORITES
        ? 'profile.slots.pick.favorites'
        : 'profile.slots.pick.featured'
    );
    const item = document.createElement('li');
    item.className = 'profile__tile profile__tile--slot';
    item.style.setProperty('--tile-index', String(index));

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'profile__tile-open profile__tile-slot-empty';
    button.dataset.profileSlotPick = kind;
    button.setAttribute('aria-label', label);
    button.title = label;

    const plus = document.createElement('span');
    plus.className = 'profile__tile-slot-plus';
    plus.textContent = '+';
    plus.setAttribute('aria-hidden', 'true');

    const text = document.createElement('span');
    text.className = 'profile__tile-slot-label';
    text.textContent = i18n.t('profile.slots.label', { slot });

    button.append(plus, text);
    item.appendChild(button);
    return item;
  }

  /**
   * Builds a slot that is not owned yet, with its price.
   *
   * @param {string} kind - `PROFILE_SLOT_KINDS` member.
   * @param {number} slot - Slot number (1-based).
   * @param {number} price - Price in Sparks.
   * @param {boolean} purchasable - True for the next slot of the ladder only.
   * @param {number} index - Position in the strip.
   * @returns {HTMLLIElement} The tile.
   */
  buildLockedSlotTile(kind, slot, price, purchasable, index) {
    const label = purchasable
      ? i18n.t(
          kind === PROFILE_SLOT_KINDS.FAVORITES
            ? 'profile.slots.buy.favoritesAria'
            : 'profile.slots.buy.featuredAria',
          { slot, price }
        )
      : i18n.t('profile.slots.locked', { slot });

    const item = document.createElement('li');
    item.className = 'profile__tile profile__tile--slot profile__tile--slot-locked';
    item.style.setProperty('--tile-index', String(index));

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'profile__tile-open profile__tile-slot-locked';
    button.setAttribute('aria-label', label);
    button.title = label;
    button.disabled = !purchasable;
    if (purchasable) button.dataset.profileSlotBuy = kind;

    const name = document.createElement('span');
    name.className = 'profile__tile-slot-label';
    name.textContent = i18n.t('profile.slots.label', { slot });

    const lock = document.createElement('span');
    lock.className = 'profile__tile-slot-lock';
    lock.textContent = '🔒';
    lock.setAttribute('aria-hidden', 'true');

    const priceElement = document.createElement('span');
    priceElement.className = 'profile__tile-buy-price';
    const coin = document.createElement('img');
    coin.className = 'profile-card-panel__price-icon';
    coin.src = 'assets/img/sparks.png';
    coin.alt = '';
    coin.setAttribute('aria-hidden', 'true');
    const value = document.createElement('span');
    value.textContent = String(price);
    priceElement.append(coin, value);

    button.append(lock, name, priceElement);
    item.appendChild(button);
    return item;
  }

  /**
   * Opens the shared purchase dialog for the next slot of one list.
   *
   * @param {string} kind - `PROFILE_SLOT_KINDS` member.
   * @returns {Promise<void>} Resolves once the dialog is displayed.
   */
  async openSlotPurchase(kind) {
    try {
      await slotPurchaseModal.open({
        kind,
        onPurchased: () => {
          if (this.isInitialized && !this.isLoading) void this.reload();
        },
      });
    } catch (error) {
      console.error('[ProfileView] The slot purchase could not be opened.', error);
      Toast.error('profile.card.buy.error');
    }
  }

  /**
   * Opens the picker filling one empty owned slot.
   *
   * `featured` offers the unlocked trophies that are not pinned yet, `favorites` the owned cards
   * that are not favourites. The choice is applied through the same `ProfileManager` calls the
   * catalogue pages use, so the limits are still enforced in one place.
   *
   * @param {string} kind - `PROFILE_SLOT_KINDS` member.
   * @returns {void}
   */
  openSlotPicker(kind) {
    if (!this.profile || !this.modal || !this.modalBody || !this.modalTitle) return;
    const normalized = kind === PROFILE_SLOT_KINDS.FAVORITES
      ? PROFILE_SLOT_KINDS.FAVORITES
      : PROFILE_SLOT_KINDS.FEATURED;
    const isFavorites = normalized === PROFILE_SLOT_KINDS.FAVORITES;
    this.modalTitle.textContent = i18n.t(
      isFavorites ? 'profile.slots.pick.favoritesTitle' : 'profile.slots.pick.featuredTitle'
    );
    this.modalBody.textContent = '';

    const list = document.createElement('ul');
    list.className = 'profile-picker';

    if (isFavorites) {
      const favorites = new Set(this.profile.favorites ?? []);
      const entries = Array.from(this.entriesByKey.values())
        .filter((entry) => entry?.owned && entry.card && !favorites.has(entry.key))
        .sort((a, b) => a.card.getName(i18n.getLang()).localeCompare(b.card.getName(i18n.getLang())));
      entries.forEach((entry) => {
        const name = entry.card.getName(i18n.getLang());
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'profile-picker__choice';
        button.dataset.profileSlotChoice = 'card';
        button.dataset.profileSlotValue = entry.key;
        button.setAttribute('aria-label', name);
        button.title = name;

        const image = document.createElement('img');
        image.className = 'profile-picker__image';
        image.src = i18n.resolveImagePath(entry.card.illustration);
        image.alt = '';
        image.loading = 'lazy';
        image.decoding = 'async';
        image.setAttribute('aria-hidden', 'true');

        const label = document.createElement('span');
        label.className = 'profile-picker__label';
        label.textContent = name;

        button.append(image, label);
        item.appendChild(button);
        list.appendChild(item);
      });
    } else {
      const pinned = new Set(this.profile.featured ?? []);
      const trophies = (this.trophyState?.trophies ?? [])
        .filter((trophy) => trophy.unlocked && !pinned.has(trophy.id));
      trophies.forEach((trophy) => {
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'profile-picker__choice profile-picker__choice--trophy';
        button.dataset.profileSlotChoice = 'trophy';
        button.dataset.profileSlotValue = trophy.id;
        const name = TrophyDetail.trophyTitle(trophy);
        button.setAttribute('aria-label', name);
        button.title = name;

        const medal = TrophyDetail.buildMedal(trophy);
        if (medal) button.appendChild(medal);

        const label = document.createElement('span');
        label.className = 'profile-picker__label';
        label.textContent = name;
        button.appendChild(label);
        item.appendChild(button);
        list.appendChild(item);
      });
    }

    if (list.children.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'profile-picker__empty';
      empty.textContent = i18n.t(
        isFavorites ? 'profile.slots.pick.noCard' : 'profile.slots.pick.noTrophy'
      );
      this.modalBody.appendChild(empty);
    } else {
      this.modalBody.appendChild(list);
    }
    this.openModal(`slot-picker:${normalized}`);
  }

  /**
   * Fills an empty slot with the chosen trophy or card.
   *
   * @param {string} kind - `trophy` or `card`.
   * @param {string} value - Trophy id or collection key.
   * @returns {Promise<void>} Resolves once the choice is stored (or the failure reported).
   */
  async applySlotChoice(kind, value) {
    if (!this.profile || typeof value !== 'string' || value === '') return;
    try {
      if (kind === 'trophy') {
        const featured = new Set(this.profile.featured ?? []);
        if (featured.has(value)) return;
        const result = await profileManager.toggleFeatured(value);
        this.profile = { ...this.profile, featured: result.featured };
        await this.renderFeatured(this.trophyState, this.profile);
        Toast.success('profile.featured.pinned');
      } else if (kind === 'card') {
        const favorites = new Set(this.profile.favorites ?? []);
        if (favorites.has(value)) return;
        const { favorites: next } = await profileManager.toggleFavorite(value);
        this.profile = { ...this.profile, favorites: next };
        await this.renderFavorites(this.profile);
        void this.renderProfileCard();
        Toast.success('profile.favorites.added');
      } else {
        return;
      }
      this.closeDetail();
    } catch (error) {
      console.error('[ProfileView] The slot could not be filled.', error);
      Toast.error(getProfileErrorMessageKey(error));
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
    const [limits, slotState] = await Promise.all([
      profileManager.getLimits(),
      featureManager.getSlotState(PROFILE_SLOT_KINDS.FAVORITES),
    ]);
    const favorites = Array.isArray(profile.favorites) ? profile.favorites : [];

    // The grid has exactly one column per slot the list can ever have: every card and every empty
    // or locked slot stays on one row, with no horizontal scrolling.
    this.favoritesElement.style.setProperty(
      '--favorite-columns',
      String(Math.max(slotState.max, limits.maxFavorites, 1))
    );

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
    const slots = Math.max(slotState.owned, favorites.length);
    for (let index = 0; index < slots; index += 1) {
      const key = favorites[index];
      if (key) {
        this.favoritesElement.appendChild(this.buildCardTile(key, this.entriesByKey.get(key), index));
      } else {
        this.favoritesElement.appendChild(
          this.buildEmptySlotTile(PROFILE_SLOT_KINDS.FAVORITES, index + 1, index)
        );
      }
    }
    this.renderLockedSlots(this.favoritesElement, slotState, slots, PROFILE_SLOT_KINDS.FAVORITES);
    if (this.favoritesEmptyElement) this.favoritesEmptyElement.hidden = true;
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
    if (card) {
      item.dataset.rarity = String(card.rarity);
      applyCardGlow(item, card);
    }

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
   * Renders the player CARD: the account itself, drawn as a trading card.
   *
   * Everything the card shows is read from the account on every render (`ProfileCardManager`), so
   * the panel can never drift from the identity, the pins and the collection around it. The card is
   * built once (`ensureProfileCard`) and only UPDATED afterwards: keeping the same component is
   * what lets the player's layout choice survive a reload of the page (an opening, a new language),
   * and what keeps the shadow tree out of the DOM churn of every other panel.
   *
   * @returns {Promise<void>} Resolves once the card is displayed.
   */
  async renderProfileCard() {
    if (!this.profile || !this.cardStage) return;
    try {
      const model = await profileCardManager.build({
        profile: this.profile,
        trophyState: this.trophyState,
        collection: this.collection,
        entriesByKey: this.entriesByKey,
        preferences: this.cardPreferences,
      });
      this.lastCardModel = model;
      this.cardLayout = this.resolveCardLayout(model.layout);
      this.ensureProfileCard();
      this.profileCard.setLayout(this.cardLayout);
      await this.profileCard.render(model);
      this.renderCardRarity(model);
      this.renderCardRarities(model);
      this.renderCardTitleColors(model);
      this.renderCardBackgrounds(model);
      this.renderCardLayoutPrice();
    } catch (error) {
      console.error('[ProfileView] The profile card could not be built.', error);
      this.setCardFeedback('profile.card.error.load', 'error');
    }
  }

  /**
   * Creates the card component on first use.
   *
   * The component owns a shadow root: creating it lazily keeps the page light for a player who
   * never opens the profile, and creating it only ONCE is what makes the enlargement a move of the
   * same element rather than a second card.
   *
   * @returns {void}
   */
  ensureProfileCard() {
    if (this.profileCard || !this.cardStage || !this.cardHost) return;
    this.cardStageHome = this.cardStage.parentElement ?? null;
    // The STAGE is moved, never rebuilt, when the card is enlarged: one controller follows the card
    // into the modal instead of a second one being attached there. The tilt is attached to the
    // inner host (the exact card footprint), not to the stage, so the wide strip and its shadow do
    // not rotate with the card.
    attachCardTilt(this.cardHost);
    this.profileCard = new ProfileCard(this.cardHost, {
      onLayoutChange: (layout) => this.syncCardLayoutButtons(layout),
    });
    this.profileCard.setLayout(this.cardLayout);
    this.syncCardLayoutButtons(this.cardLayout);
    this.log('Profile card component created.');
  }

  /**
   * Renders the line under the card: the rarity reached, then the next one as a goal.
   *
   * The thresholds live in `settings/config.json` (section `profileCard`), so the line is also what
   * tells the player how far the card still has to grow.
   *
   * @param {object} model - Card model built by `ProfileCardManager`.
   * @returns {void}
   */
  renderCardRarity(model) {
    if (!this.cardRarityElement) return;
    const translate = (key) => i18n.t(key);
    const label = getRarityLabel(model.rarity, translate);
    this.cardRarityElement.textContent = [
      i18n.t('profile.card.rarity', { rarity: label }),
      i18n.t('profile.card.trophies', { count: model.trophyCount }),
    ].join(' · ');

    const next = ProfileCardManager.findNextRarity(model.thresholds, model.rarity, model.trophyCount);
    const goal = document.createElement('span');
    goal.className = 'profile-card-panel__goal';
    goal.textContent = next
      ? i18n.t('profile.card.next', {
          count: next.count,
          rarity: getRarityLabel(next.rarity, translate),
        })
      : i18n.t('profile.card.max');
    this.cardRarityElement.appendChild(document.createElement('br'));
    this.cardRarityElement.appendChild(goal);
    this.cardRarityElement.dataset.rarity = String(model.rarity);
  }

  /**
   * Resolves the layout the card may actually wear.
   *
   * Full Art is a FEATURE (`FeatureManager`): a stored preference that has not been paid for (a save
   * written by another version, or a purchase removed from the configuration) falls back to the
   * free layout instead of granting a paid one.
   *
   * @param {string} layout - Stored layout.
   * @returns {string} The layout to display.
   */
  resolveCardLayout(layout) {
    if (layout === PROFILE_CARD_LAYOUTS.FULL_ART && !this.fullArtOwned) {
      return PROFILE_CARD_DEFAULT_LAYOUT;
    }
    return PROFILE_CARD_LAYOUT_ORDER.includes(layout) ? layout : PROFILE_CARD_DEFAULT_LAYOUT;
  }

  /**
   * Reacts to a click on the layout switch.
   *
   * A locked layout does NOT switch and does not buy: it opens the confirmation, and the switch only
   * moves on a LATER click, once the feature is owned.
   *
   * @param {string} layout - Layout of the clicked button.
   * @returns {void}
   */
  handleCardLayoutClick(layout) {
    if (layout === PROFILE_CARD_LAYOUTS.FULL_ART && !this.fullArtOwned) {
      void this.openBuyModal(FEATURES.CARD_LAYOUT_FULL_ART);
      return;
    }
    this.setCardLayout(layout);
  }

  /**
   * Applies one layout to the card ("Normale" or "Full Art") and remembers it.
   *
   * @param {string} layout - Layout name, one of `PROFILE_CARD_LAYOUT_ORDER`.
   * @returns {void}
   */
  setCardLayout(layout) {
    const next = this.resolveCardLayout(layout);
    this.cardLayout = next;
    this.cardPreferences = { ...this.cardPreferences, layout: next };
    this.profileCard?.setLayout(next);
    this.syncCardLayoutButtons(next);
    void profileCardManager.savePreferences({ layout: next }).catch((error) => {
      console.error('[ProfileView] The card layout could not be saved.', error);
      this.setCardFeedback('profile.card.error.load', 'error');
    });
  }

  /**
   * Reads the label of a purchasable feature.
   *
   * @param {string} id - Feature identifier.
   * @returns {string} The translated name (the identifier itself when it has no entry yet).
   */
  static featureLabel(id) {
    const key = FEATURE_LABEL_KEYS[id];
    return key ? i18n.t(key) : id;
  }

  /**
   * Marks the Full Art button as a price tag while the feature is not owned.
   *
   * @returns {void}
   */
  renderCardLayoutPrice() {
    if (!this.cardFullArtButton) return;
    const locked = !this.fullArtOwned;
    this.cardFullArtButton.dataset.locked = String(locked);
    this.cardLockElement.hidden = !locked;
    this.cardPriceElement.hidden = !locked;
    this.cardPriceValueElement.textContent = String(this.fullArtPrice);
    this.cardFullArtButton.setAttribute(
      'aria-label',
      locked
        ? i18n.t('profile.card.layout.locked', { price: this.fullArtPrice })
        : i18n.t('profile.card.layout.fullart')
    );
  }

  /**
   * Builds the rarity picker of the card.
   *
   * One option per card rarity: the unlocked ones are selectable and show their symbol and name, the
   * locked ones are disabled and show the trophy medal with the count the account has against the
   * count the threshold asks for, in the colour of a refusal. The picker is therefore also the list
   * of the rarities the card can still grow into.
   *
   * @param {object} model - Card model built by `ProfileCardManager`.
   * @returns {void}
   */
  renderCardRarities(model) {
    if (!this.cardRaritiesElement) return;
    const translate = (key) => i18n.t(key);
    this.cardRaritiesElement.textContent = '';

    (model?.rarities ?? []).forEach((entry) => {
      const rarity = PROFILE_CARD_RARITIES[entry.rarity] ?? PROFILE_CARD_RARITIES[1];
      const label = getRarityLabel(entry.rarity, translate);

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'profile-card-panel__rarity';
      button.dataset.profileCardRarityOption = String(entry.rarity);
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', String(entry.worn));
      button.disabled = !entry.unlocked;
      button.setAttribute(
        'aria-label',
        entry.unlocked
          ? label
          : i18n.t('profile.card.rarity.lockedLabel', {
              rarity: label,
              count: entry.count,
              required: entry.required,
            })
      );
      button.title = button.getAttribute('aria-label');

      const symbol = document.createElement('span');
      symbol.className = 'profile-card-panel__rarity-symbol';
      symbol.textContent = rarity.symbol;
      symbol.setAttribute('aria-hidden', 'true');
      button.appendChild(symbol);

      const name = document.createElement('span');
      name.className = 'profile-card-panel__rarity-name';
      name.textContent = label;
      button.appendChild(name);

      if (!entry.unlocked) {
        const count = document.createElement('span');
        count.className = 'profile-card-panel__rarity-count';
        const medal = document.createElement('img');
        medal.className = 'profile-card-panel__rarity-medal';
        medal.src = DEFAULT_TROPHY_ICON;
        medal.alt = '';
        medal.setAttribute('aria-hidden', 'true');
        const text = document.createElement('span');
        text.textContent = `${entry.count} / ${entry.required}`;
        count.append(medal, text);
        button.appendChild(count);
      }

      this.cardRaritiesElement.appendChild(button);
    });
  }

  /**
   * Builds the title-colour picker of the card.
   *
   * `auto` comes first and is always available: it is the rarity colour, so it costs nothing and
   * follows the rarity the player picked just above. The palette follows; a colour that was not
   * bought is dimmed, carries its price and opens the purchase confirmation instead of selecting
   * itself. The swatch itself is the colour, which is the only label a player needs.
   *
   * @param {object} model - Card model built by `ProfileCardManager`.
   * @returns {void}
   */
  renderCardTitleColors(model) {
    if (!this.cardTitleColorsElement) return;
    const chosen = typeof model?.titleColor === 'string'
      ? model.titleColor
      : this.cardPreferences.titleColor;

    const entries = [
      {
        id: PROFILE_CARD_DEFAULT_TITLE_COLOR,
        color: 'var(--color-title)',
        label: i18n.t('profile.card.titleColor.auto'),
        owned: true,
        price: 0,
      },
      ...this.colorCatalog.map((entry) => ({
        id: entry.id,
        color: entry.hex,
        label: colorName(entry, i18n.getLang()),
        owned: this.ownedTitleColors.has(entry.id),
        price: this.titleColorPrices[entry.id] ?? this.titleColorDefaultPrice,
      })),
    ];

    this.cardTitleColorsElement.textContent = '';
    entries.forEach((entry) => {
      const selected = entry.id === chosen;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'profile-card-panel__color';
      button.dataset.profileCardTitleColor = entry.id;
      button.dataset.owned = String(entry.owned);
      button.dataset.selected = String(selected);
      button.setAttribute('aria-pressed', String(selected));
      button.style.setProperty('--swatch-color', entry.color);

      const label = entry.owned
        ? entry.label
        : i18n.t('profile.card.titleColor.locked', { color: entry.label, price: entry.price });
      button.title = label;
      button.setAttribute('aria-label', label);

      const dot = document.createElement('span');
      dot.className = 'profile-card-panel__color-dot';
      dot.setAttribute('aria-hidden', 'true');
      button.appendChild(dot);

      const name = document.createElement('span');
      name.className = 'profile-card-panel__color-name';
      name.textContent = entry.label;
      button.appendChild(name);

      if (!entry.owned) {
        const price = document.createElement('span');
        price.className = 'profile-card-panel__color-price';
        const coin = document.createElement('img');
        coin.className = 'profile-card-panel__price-icon';
        coin.src = 'assets/img/sparks.png';
        coin.alt = '';
        coin.setAttribute('aria-hidden', 'true');
        const value = document.createElement('span');
        value.textContent = String(entry.price);
        price.append(coin, value);
        button.appendChild(price);
      }

      this.cardTitleColorsElement.appendChild(button);
    });

    if (this.cardTitleColorsPriceElement) {
      this.cardTitleColorsPriceElement.textContent = i18n.t('profile.card.titleColor.help');
    }
  }

  /**
   * Builds the background picker of the card from the FAVOURITE cards.
   *
   * The first favourite is the default: the card borrows its artwork until the player picks another
   * one. A favourite whose card left the catalogue is skipped (its key stays in the profile, the
   * picker simply cannot draw it), and a selection that is no longer a favourite falls back to the
   * first one through `ProfileCardManager`.
   *
   * @param {object} model - Card model built by `ProfileCardManager`.
   * @returns {void}
   */
  renderCardBackgrounds(model) {
    if (!this.cardBackgroundsElement) return;
    const favorites = Array.isArray(this.profile?.favorites) ? this.profile.favorites : [];
    const selected = typeof model?.backgroundKey === 'string' ? model.backgroundKey : null;
    let offered = 0;

    this.cardBackgroundsElement.textContent = '';
    favorites.forEach((key) => {
      const entry = this.entriesByKey.get(key);
      const card = entry?.card;
      if (!card) return;
      // The same fallback order as `ProfileCardManager`: `Background`, then `Underlay`, then the
      // card illustration. A card with no `Background` is therefore still offered, with the very
      // backdrop the profile card will actually use.
      const artwork = ProfileCardManager.cardBackdrop(card);
      if (artwork === '') return;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'profile-card-panel__background';
      button.dataset.profileCardBackground = key;
      button.dataset.selected = String(key === selected);
      button.setAttribute('aria-pressed', String(key === selected));
      const name = card.getName(i18n.getLang());
      button.setAttribute('aria-label', i18n.t('profile.card.background.pick', { card: name }));
      button.title = name;

      const image = document.createElement('img');
      image.className = 'profile-card-panel__background-image';
      image.src = i18n.resolveImagePath(artwork);
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.setAttribute('aria-hidden', 'true');
      image.addEventListener('error', () => {
        console.warn(`[ProfileView] Background artwork not found for "${key}": ${image.src}`);
        image.hidden = true;
      });
      button.appendChild(image);

      const label = document.createElement('span');
      label.className = 'profile-card-panel__background-name';
      label.textContent = name;
      button.appendChild(label);

      this.cardBackgroundsElement.appendChild(button);
      offered += 1;
    });

    if (this.cardBackgroundsHelpElement) {
      this.cardBackgroundsHelpElement.textContent = offered > 0
        ? i18n.t('profile.card.background.help')
        : i18n.t('profile.card.background.empty');
    }
  }

  /**
   * Wears one favourite card as the background of the profile card.
   *
   * Only a favourite is accepted: the picker only offers those, and a removed favourite must never
   * stay on the card through a hand-written preference.
   *
   * @param {string} key - Collection key of a favourite card.
   * @returns {void}
   */
  setCardBackground(key) {
    if (typeof key !== 'string' || key === '') return;
    if (!(this.profile?.favorites ?? []).includes(key)) return;
    this.cardPreferences = { ...this.cardPreferences, background: key };
    void profileCardManager.savePreferences({ background: key }).catch((error) => {
      console.error('[ProfileView] The card background could not be saved.', error);
      this.setCardFeedback('profile.card.error.load', 'error');
    });
    void this.renderProfileCard();
  }

  /**
   * Handles a click on a title colour.
   *
   * An owned colour (and `auto`) is worn immediately; a locked one opens the purchase confirmation,
   * exactly like the Full Art switch. Nothing is bought without a second click in the modal.
   *
   * @param {string} id - Colour id, or `auto`.
   * @returns {void}
   */
  handleCardTitleColorClick(id) {
    if (typeof id !== 'string' || id === '') return;
    if (id === PROFILE_CARD_DEFAULT_TITLE_COLOR || this.ownedTitleColors.has(id)) {
      this.setCardTitleColor(id);
      return;
    }
    const entry = this.colorCatalog.find((candidate) => candidate.id === id);
    if (!entry) return;
    void this.openBuyModal(id, {
      type: 'titleColor',
      label: colorName(entry, i18n.getLang()),
      price: this.titleColorPrices[id] ?? this.titleColorDefaultPrice,
    });
  }

  /**
   * Wears one title colour and remembers it.
   *
   * Only `auto` and an OWNED colour are accepted (the picker already blocks the others): a
   * hand-written preference can never dress the card in a colour the player did not pay for.
   *
   * @param {string} id - Colour id, or `auto`.
   * @returns {void}
   */
  setCardTitleColor(id) {
    const accepted = id === PROFILE_CARD_DEFAULT_TITLE_COLOR || this.ownedTitleColors.has(id);
    if (!accepted) return;
    this.cardPreferences = { ...this.cardPreferences, titleColor: id };
    void profileCardManager.savePreferences({ titleColor: id }).catch((error) => {
      console.error('[ProfileView] The title colour could not be saved.', error);
      this.setCardFeedback('profile.card.error.load', 'error');
    });
    void this.renderProfileCard();
  }

  /**
   * Wears one of the unlocked rarities.
   *
   * Only an UNLOCKED rarity is accepted (the picker already disables the others): the card can never
   * show a rarity the account did not earn, whatever a hand-written save says.
   *
   * @param {number} rarity - Rarity to wear.
   * @returns {void}
   */
  setCardRarity(rarity) {
    const entry = (this.lastCardModel?.rarities ?? []).find(
      (candidate) => candidate.rarity === rarity
    );
    if (!entry || !entry.unlocked) return;
    this.cardPreferences = { ...this.cardPreferences, rarity };
    void profileCardManager.savePreferences({ rarity }).catch((error) => {
      console.error('[ProfileView] The card rarity could not be saved.', error);
      this.setCardFeedback('profile.card.error.load', 'error');
    });
    void this.renderProfileCard();
  }

  /**
   * Opens the purchase confirmation of one feature.
   *
   * The balance is read NOW rather than from the last render: it is what decides between the
   * confirmation and the "not enough Sparks" refusal, and a booster may have been opened since.
   *
   * @param {string} id - Feature identifier.
   * @returns {Promise<void>} Resolves once the modal is displayed.
   */
  async openBuyModal(id, { type = 'feature', label = null, price = null } = {}) {
    if (!this.cardBuyModal) return;
    this.pendingFeatureId = id;
    this.pendingPurchaseType = type === 'titleColor' || type === 'usernameColor' || type === 'icon'
      ? type
      : 'feature';
    const featureLabel = label ?? ProfileView.featureLabel(id);
    const knownPrice = Number.isInteger(price) ? price : null;
    let priceValue = knownPrice ?? 0;
    let balance = 0;
    try {
      [priceValue, balance] = await Promise.all([
        knownPrice !== null
          ? Promise.resolve(knownPrice)
          : featureManager.getPrice(id),
        sparksManager.getBalance(),
      ]);
    } catch (error) {
      console.error('[ProfileView] The price of the feature could not be read.', error);
      Toast.error('profile.card.buy.error');
      this.pendingFeatureId = null;
      return;
    }

    const enough = balance >= priceValue;
    this.cardBuyFeatureElement.textContent = featureLabel;
    this.cardBuyPriceElement.textContent = i18n.t('profile.card.buy.price', { price: priceValue });
    this.cardBuyBalanceElement.textContent = i18n.t('profile.card.buy.balance', { balance });
    this.cardBuyMessageElement.textContent = enough
      ? i18n.t('profile.card.buy.ask', { feature: featureLabel, price: priceValue })
      : i18n.t('profile.card.buy.insufficient', { balance, price: priceValue });
    this.cardBuyMessageElement.dataset.tone = enough ? 'info' : 'error';
    this.cardBuyConfirmButton.disabled = !enough;

    this.cardBuyModal.hidden = false;
    this.cardBuyModal.classList.remove('is-opening');
    void this.cardBuyModal.offsetWidth;
    this.cardBuyModal.classList.add('is-opening');
    this.log(`Purchase of "${id}" offered (${priceValue} Sparks, balance ${balance}).`);
  }

  /**
   * Closes the purchase confirmation.
   *
   * @returns {void}
   */
  closeBuyModal() {
    if (!this.cardBuyModal || this.cardBuyModal.hidden) return;
    this.cardBuyModal.hidden = true;
    this.cardBuyModal.classList.remove('is-opening');
    this.pendingFeatureId = null;
    this.pendingPurchaseType = 'feature';
  }

  /**
   * Buys the feature the modal is about.
   *
   * Neither the layout nor the title colour moves here: the player asked to OWN them, not to wear
   * them, so they only change on the next click. A refusal (not enough Sparks in the meantime) is
   * shown in the modal rather than thrown away.
   *
   * @returns {Promise<void>} Resolves once the purchase finished (or the refusal was reported).
   */
  async confirmFeaturePurchase() {
    const id = this.pendingFeatureId;
    if (!id) return;
    const purchaseType = this.pendingPurchaseType;
    const isTitleColor = purchaseType === 'titleColor';
    const isUsernameColor = purchaseType === 'usernameColor';
    const isIcon = purchaseType === 'icon';
    this.cardBuyConfirmButton.disabled = true;
    try {
      const result = isTitleColor
        ? await featureManager.purchaseTitleColor(id)
        : isUsernameColor
          ? await featureManager.purchaseUsernameColor(id)
          : isIcon
            ? await featureManager.purchaseProfileIcon(id)
            : await featureManager.purchase(id);
      let label;
      const entry = this.colorCatalog.find((candidate) => candidate.id === id);
      if (isTitleColor) {
        this.ownedTitleColors.add(id);
        label = entry ? colorName(entry, i18n.getLang()) : id;
      } else if (isUsernameColor) {
        this.ownedUsernameColors.add(id);
        label = entry ? colorName(entry, i18n.getLang()) : id;
      } else if (isIcon) {
        label = this.icons?.default?.find((candidate) => candidate.file === id)?.name ?? id;
      } else {
        this.fullArtOwned = this.fullArtOwned || id === FEATURES.CARD_LAYOUT_FULL_ART;
        label = ProfileView.featureLabel(id);
      }
      this.setCardFeedback('profile.card.buy.bought', 'info', { feature: label });
      if (!result.alreadyOwned) Toast.success('profile.card.buy.bought', { params: { feature: label } });
      this.closeBuyModal();
      // The lock and the price go away; the switch (and the worn colour) stay where they are.
      this.renderCardLayoutPrice();
      this.renderCardTitleColors(this.lastCardModel);
      this.renderUsernameColors();
      if (isIcon) await this.refreshIcons();
    } catch (error) {
      console.error('[ProfileView] The feature could not be bought.', error);
      if (error?.code === FEATURE_ERROR_CODES.INSUFFICIENT_SPARKS) {
        const price = await (isTitleColor
          ? featureManager.getTitleColorPrice(id)
          : isUsernameColor
            ? featureManager.getUsernameColorPrice(id)
            : isIcon
              ? featureManager.getProfileIconPrice(id)
              : featureManager.getPrice(id)
        ).catch(() => 0);
        const balance = await sparksManager.getBalance().catch(() => 0);
        this.cardBuyMessageElement.textContent = i18n.t('profile.card.buy.insufficient', {
          balance,
          price,
        });
        this.cardBuyMessageElement.dataset.tone = 'error';
        this.cardBuyConfirmButton.disabled = true;
        return;
      }
      this.setCardFeedback('profile.card.buy.error', 'error');
      Toast.error('profile.card.buy.error');
      this.closeBuyModal();
    } finally {
      if (this.cardBuyModal?.hidden) this.cardBuyConfirmButton.disabled = false;
    }
  }

  /**
   * Marks the layout button of the active layout.
   *
   * @param {string} layout - Active layout.
   * @returns {void}
   */
  syncCardLayoutButtons(layout) {
    if (!this.cardLayoutsElement) return;
    this.cardLayoutsElement.querySelectorAll('[data-profile-card-layout]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.profileCardLayout === layout));
    });
  }

  /**
   * Displays a translated message under the card.
   *
   * @param {string|null} key - i18n key, or null to hide the message.
   * @param {'info'|'error'} [tone='info'] - Visual tone.
   * @param {object|null} [params=null] - Interpolation values.
   * @returns {void}
   */
  setCardFeedback(key, tone = 'info', params = null) {
    if (!this.cardFeedbackElement) return;
    if (!key) {
      this.cardFeedbackElement.hidden = true;
      this.cardFeedbackElement.textContent = '';
      return;
    }
    this.cardFeedbackElement.hidden = false;
    this.cardFeedbackElement.textContent = i18n.t(key, params ?? undefined);
    this.cardFeedbackElement.dataset.tone = tone;
    if (tone === 'error') console.warn(`[ProfileView] ${this.cardFeedbackElement.textContent}`);
  }

  /**
   * Exports the card as a PNG and hands it to the browser.
   *
   * Both download buttons (the panel and the enlarged card) are disabled while the image is built:
   * rasterizing the card twice at once would only waste memory.
   *
   * @returns {Promise<void>} Resolves once the file was written (or the failure reported).
   */
  async downloadProfileCard() {
    if (!this.profileCard) return;
    const buttons = [this.cardDownloadButton, this.cardModalDownloadButton].filter((button) => button);
    buttons.forEach((button) => {
      button.disabled = true;
    });
    this.setCardFeedback('profile.card.exporting');
    try {
      const file = await this.profileCard.download();
      this.setCardFeedback('profile.card.downloaded', 'info', { file });
    } catch (error) {
      console.error('[ProfileView] The profile card could not be exported.', error);
      this.setCardFeedback('profile.card.error.export', 'error');
      Toast.error('profile.card.error.export');
    } finally {
      buttons.forEach((button) => {
        button.disabled = false;
      });
    }
  }

  /**
   * Enlarges the card by moving its stage into the modal.
   *
   * Moving the host (never rebuilding it) keeps the shadow tree, the selected layout and the
   * already-decoded illustrations: the enlarged card is literally the same card, drawn bigger.
   *
   * @returns {void}
   */
  openCardModal() {
    if (!this.cardModal || !this.cardModalBody || !this.cardStage) return;
    this.cardModalBody.appendChild(this.cardStage);
    this.cardModal.hidden = false;
    this.profileCard?.applyStage();
    this.log('Profile card enlarged.');
  }

  /**
   * Puts the card back into its panel.
   *
   * @returns {void}
   */
  closeCardModal() {
    if (!this.cardModal || this.cardModal.hidden) return;
    this.cardModal.hidden = true;
    // `prepend` restores the exact place the stage has in the panel (its first child).
    if (this.cardStageHome && this.cardStage) this.cardStageHome.prepend(this.cardStage);
    this.profileCard?.applyStage();
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

    // Avatars and player titles are read from their own catalogues, and a failure of one must not
    // hide the trophy itself: each read falls back to an empty list.
    const [icons, titles] = await Promise.all([
      profileIconManager.getIconsForTrophy(trophy).catch((error) => {
        console.warn(`[ProfileView] The avatars unlocked by "${id}" could not be read.`, error);
        return [];
      }),
      titleManager.getTitlesForTrophy(trophy).catch((error) => {
        console.warn(`[ProfileView] The titles unlocked by "${id}" could not be read.`, error);
        return [];
      }),
    ]);

    this.modalBody.appendChild(TrophyDetail.buildDetailBody(trophy, {
      experiencePerTrophy: this.trophyState.experiencePerTrophy,
      icons,
      titles,
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
      applyCardGlow(image, card);
      attachCardTilt(image);
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
        usernameColor: this.selectedUsernameColor,
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
   * Refreshes the page when a title was unlocked or selected.
   *
   * The titles page is a view of its own: coming back from it re-renders this page anyway
   * (`handleViewActivated`), but a title may also be unlocked by an opening while the profile is on
   * screen, and the line under the pseudo must follow the announcement.
   *
   * @returns {void}
   */
  handleTitleUnlocked() {
    if (this.isInitialized && !this.isLoading) {
      void this.reload();
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
    this.profileCard?.destroy();
    this.profileCard = null;
    this.profile = null;
    this.trophyState = null;
    this.collection = null;
    this.entriesByKey = new Map();
    this.sets = new Map();
    this.icons = null;
    this.isInitialized = false;
  }
}

export default ProfileView;

/**
 * ProfileManager - Player profile: display name, avatar, favourite cards and pinned trophies.
 *
 * Reference: `.docs/main.md` section 2 (data model) and section 3.A (local account).
 *
 * The profile lives in `user_state["profile"]`, exactly like every other application state: it is
 * therefore part of the `.save` export, restored by an import and cleared by a full reset. There is
 * deliberately no cookie and no server call.
 *
 * Stored shape:
 *   {
 *     name:      string,          // "" means "no name chosen yet" (the UI shows the default name)
 *     icon:      string,          // "" or a path of the catalogue (`ProfileIconManager`)
 *     photo:     string,          // legacy avatar URL, read (displayed) but no longer written
 *     title:     string,          // "" or the id of a title (`TitleManager`)
 *     usernameColor: string,      // "auto" or the id of a colour (`settings/colors.json`)
 *     favorites: string[],        // card keys (`${id}_${style}`), up to the owned favourite slots
 *     featured:  string[],        // unlocked trophy ids, up to the owned featured slots
 *   }
 *
 * A TITLE is deliberately OPTIONAL, and clearing it is a choice of its own: unlike the avatar (which
 * always shows something, if only the initial of the pseudo), the player may own titles and still
 * want none displayed, so `""` is a legitimate stored value and the picker offers it explicitly.
 *
 * The avatar used to be a free URL. It is now picked from `ProfileIconManager`, which owns the list
 * of the shipped icons; the `photo` key stays readable so a profile written by an older version
 * keeps showing the avatar it had until the player chooses an icon.
 *
 * Every read goes through `normalizeProfile()`, so a save written by another version (missing key,
 * wrong type, too many pins) always yields a writable profile instead of breaking a view.
 *
 * Persistence policy: this manager is the ONLY writer of the profile state and it never touches
 * anything else. Deciding which card keys are legitimately owned is the collection's business
 * (`CollectionView` only offers owned cards); the manager only enforces the shape and the limits.
 */

import { storageRepository, STORES } from '../models/StorageRepository.js';
import { configLoader } from '../utils/ConfigLoader.js';
import eventBus, { EVENTS } from '../utils/EventBus.js';
import { USER_STATE_KEYS } from './AccountManager.js';
import profileIconManager from './ProfileIconManager.js';
import titleManager from './TitleManager.js';
import featureManager, { FeatureManager, PROFILE_SLOT_KINDS } from './FeatureManager.js';
import { USERNAME_DEFAULT_COLOR, isColorId } from './ColorManager.js';

/**
 * `user_state` key holding the profile.
 *
 * Re-exported from `USER_STATE_KEYS` so the documented data model stays declared in one place
 * (`js/business/AccountManager.js`).
 */
export const PROFILE_STATE_KEY = USER_STATE_KEYS.PROFILE;

/** Maximum number of characters of a display name. */
export const PROFILE_NAME_MAX_LENGTH = 24;

/** Maximum number of characters of an avatar URL. */
export const PROFILE_PHOTO_MAX_LENGTH = 512;

/** Protocols accepted for an avatar URL (anything else is refused before being stored). */
export const PROFILE_PHOTO_PROTOCOLS = Object.freeze(['http:', 'https:']);

/**
 * Error codes thrown by the profile manager, mapped to translation keys by
 * `getProfileErrorMessageKey()`. The values are the suffixes of the `profile.error.*` i18n keys.
 */
export const PROFILE_ERROR_CODES = Object.freeze({
  NAME_TOO_LONG: 'name',
  PHOTO_INVALID_URL: 'photo',
  ICON_UNKNOWN: 'icon',
  TITLE_UNKNOWN: 'title',
  COLOR_UNKNOWN: 'color',
  FAVORITES_FULL: 'favoritesFull',
  FEATURED_FULL: 'featuredFull',
  INVALID_KEY: 'invalidKey',
});

/** Error raised by the profile manager, carrying a stable `code` for the UI. */
export class ProfileError extends Error {
  /**
   * @param {string} code - One of `PROFILE_ERROR_CODES`.
   * @param {string} message - Technical description (logged, not shown to the player).
   * @param {object} [options] - Standard `Error` options (`cause`).
   */
  constructor(code, message, options = undefined) {
    super(message, options);
    this.name = 'ProfileError';
    this.code = code;
  }
}

/**
 * Resolves the i18n key describing a profile failure.
 *
 * @param {unknown} error - Error thrown by the profile manager.
 * @returns {string} A `profile.error.*` translation key.
 */
export function getProfileErrorMessageKey(error) {
  const code = error instanceof ProfileError ? error.code : 'save';
  return `profile.error.${code}`;
}

/**
 * Builds the profile every account starts with.
 *   * @returns {{name: string, icon: string, photo: string, title: string, usernameColor: string, favorites: string[], featured: string[]}}
   *   An empty profile.
   */
export function buildDefaultProfile() {
  return {
    name: '',
    icon: '',
    photo: '',
    title: '',
    usernameColor: USERNAME_DEFAULT_COLOR,
    favorites: [],
    featured: [],
  };
}

export class ProfileManager {
  /**
   * Boilerplate of the singleton: nothing to inject, the profile only depends on the storage
   * repository and on `settings/config.json`.
   */
  constructor() {
    /** @type {Promise<object>|null} In-flight read used to de-duplicate concurrent calls. */
    this.pendingRead = null;
  }

  /**
   * Logs with the manager prefix.
   *
   * @param {...unknown} args - Values forwarded to `console.info`.
   * @returns {void}
   */
  log(...args) {
    console.info('[ProfileManager]', ...args);
  }

  /**
   * Reads the EFFECTIVE limits of the profile: the slots every account starts with, plus the ones
   * it bought with Sparks (`FeatureManager`).
   *
   * Every caller (the profile page, the collection hearts, the trophy pins) reads its maximum here,
   * so a purchased slot opens everywhere at once and a hand-edited save can never use a slot it did
   * not pay for. The configured absolute limits stay available in `configuredMaxFavorites` and
   * `configuredMaxFeaturedTrophies` for the page that draws the next price.
   *
   * @returns {Promise<{maxFavorites: number, maxFeaturedTrophies: number, defaultFavorites: number,
   *   defaultFeaturedTrophies: number, favoriteSlotPrices: Record<number, number>,
   *   featuredSlotPrices: Record<number, number>, configuredMaxFavorites: number,
   *   configuredMaxFeaturedTrophies: number, defaultName: string}>} The effective limits.
   * @throws {Error} When `settings/config.json` or the purchases cannot be loaded.
   */
  async getLimits() {
    const [settings, purchases] = await Promise.all([
      configLoader.getProfileSettings(),
      featureManager.getPurchases(),
    ]);
    return {
      ...settings,
      maxFavorites: FeatureManager.countOwnedSlots(
        PROFILE_SLOT_KINDS.FAVORITES,
        settings,
        purchases
      ),
      maxFeaturedTrophies: FeatureManager.countOwnedSlots(
        PROFILE_SLOT_KINDS.FEATURED,
        settings,
        purchases
      ),
      configuredMaxFavorites: settings.maxFavorites,
      configuredMaxFeaturedTrophies: settings.maxFeaturedTrophies,
    };
  }

  /**
   * Reads the stored profile, completed with the documented defaults.
   *
   * Never throws on a malformed state: an imported save may come from any version, so anything
   * unusable is replaced by its default instead of failing the profile page.
   *
   * @returns {Promise<{name: string, icon: string, photo: string, title: string, usernameColor: string, favorites: string[], featured: string[]}>}
   *   The normalized profile.
   * @throws {Error} When the read or the configuration loading fails.
   */
  async getProfile() {
    const [raw, limits] = await Promise.all([
      storageRepository.getUserState(PROFILE_STATE_KEY),
      this.getLimits(),
    ]);
    return ProfileManager.normalizeProfile(raw, limits);
  }

  /**
   * Creates the profile state when the account does not have one yet.
   *
   * Called once at boot: every account (created locally or restored from a save written by an
   * older version) therefore carries a `profile` entry, so the state is part of the next export
   * even when the player never opened the profile page.
   *
   * @returns {Promise<boolean>} True when the default state was written.
   * @throws {Error} When the read or the write fails.
   */
  async ensureState() {
    if (await storageRepository.hasUserState(PROFILE_STATE_KEY)) return false;
    await storageRepository.setUserState(PROFILE_STATE_KEY, buildDefaultProfile());
    this.log('Default profile state created.');
    return true;
  }

  /**
   * Saves the display name, the avatar and the title.
   *
   * Every field is optional: only the ones present in the payload are updated, so the profile page
   * can save its two inputs in a single call without erasing the other one, and the titles page can
   * store a title without touching the pseudo. A supplied `icon` is the avatar of the whole profile
   * though: it always replaces `photo`, since only one avatar is ever displayed (see
   * `renderIdentity`).
   *
   * @param {object} payload - Identity fields to update.
   * @param {unknown} [payload.name] - New display name (empty string clears it).
   * @param {unknown} [payload.icon] - Catalogue path of the new avatar (empty string clears it, and
   *   with it the legacy URL of an older save).
   * @param {unknown} [payload.photo] - Legacy avatar URL (still accepted, no longer offered).
   * @param {unknown} [payload.title] - Id of a catalogue title (empty string clears it: displaying
   *   no title is a choice of its own).
   * @param {unknown} [payload.usernameColor] - `auto` or the id of a username colour. Owning the
   *   colour is checked by `ColorManager`; an unknown orientation falls back to `auto`.
   * @returns {Promise<object>} The stored profile after the update.
   * @throws {TypeError} When `payload` is not a plain object.
   * @throws {ProfileError} When the name is too long, the URL is not an absolute http(s) URL, or the
   *   icon or the title does not belong to the catalogue.
   * @throws {Error} When the write fails.
   */
  async setIdentity(payload = {}) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new TypeError('ProfileManager.setIdentity expects a plain object.');
    }

    const current = await this.getProfile();
    const next = { ...current };

    if (Object.prototype.hasOwnProperty.call(payload, 'name')) {
      next.name = ProfileManager.normalizeName(payload.name);
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'icon')) {
      next.icon = await ProfileManager.normalizeIcon(payload.icon);
      // A supplied `icon` is the avatar the player chose in the picker, so it replaces the legacy
      // URL whatever it is: an icon, or the explicit "no icon" choice (`''`), which must be able
      // to clear the avatar of an older save instead of silently keeping it.
      next.photo = '';
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'photo')) {
      next.photo = ProfileManager.normalizePhoto(payload.photo);
      if (next.photo !== '') next.icon = '';
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'title')) {
      next.title = await ProfileManager.normalizeTitle(payload.title);
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'usernameColor')) {
      next.usernameColor = ProfileManager.normalizeUsernameColor(payload.usernameColor);
    }

    await storageRepository.setUserState(PROFILE_STATE_KEY, next);
    this.log(
      `Identity saved (name: ${next.name === '' ? 'none' : 'set'}, ` +
        `avatar: ${next.icon !== '' ? 'icon' : next.photo !== '' ? 'legacy photo' : 'none'}, ` +
        `title: ${next.title === '' ? 'none' : 'set'}).`
    );
    eventBus.emit(EVENTS.PROFILE_UPDATED, { profile: next });
    return next;
  }

  /**
   * Replaces the whole favourite list.
   *
   * The keys are deduplicated and truncated to `profile.maxFavorites`; a longer list is refused
   * rather than silently trimmed, so the collection can tell the player why the heart did nothing.
   *
   * @param {unknown} keys - Candidate card keys.
   * @returns {Promise<string[]>} The stored favourites.
   * @throws {TypeError} When the argument is not an array of non-empty strings.
   * @throws {ProfileError} When more keys than allowed are provided.
   * @throws {Error} When the write fails.
   */
  async setFavorites(keys) {
    const list = ProfileManager.assertKeyList(keys, 'favorites');
    const unique = Array.from(new Set(list));
    const { maxFavorites } = await this.getLimits();
    if (unique.length > maxFavorites) {
      throw new ProfileError(
        PROFILE_ERROR_CODES.FAVORITES_FULL,
        `The profile accepts at most ${maxFavorites} favourite card(s) (received ${unique.length}).`
      );
    }

    const current = await this.getProfile();
    return this.persist({ ...current, favorites: unique });
  }

  /**
   * Adds or removes one card from the favourites.
   *
   * @param {unknown} key - Collection key (`${id}_${style}`).
   * @returns {Promise<{favorites: string[], added: boolean}>} The resulting list and whether the
   *   card was added (false when it was removed).
   * @throws {TypeError} When the key is not a non-empty string.
   * @throws {ProfileError} When the list is already full and the card is not in it.
   * @throws {Error} When the write fails.
   */
  async toggleFavorite(key) {
    const normalized = ProfileManager.assertKey(key);
    const current = await this.getProfile();
    const favorites = current.favorites.slice();
    const index = favorites.indexOf(normalized);

    if (index >= 0) {
      favorites.splice(index, 1);
      await this.persist({ ...current, favorites });
      return { favorites, added: false };
    }

    const { maxFavorites } = await this.getLimits();
    if (favorites.length >= maxFavorites) {
      throw new ProfileError(
        PROFILE_ERROR_CODES.FAVORITES_FULL,
        `The profile accepts at most ${maxFavorites} favourite card(s).`
      );
    }
    favorites.push(normalized);
    await this.persist({ ...current, favorites });
    return { favorites, added: true };
  }

  /**
   * Replaces the whole list of highlighted trophies.
   *
   * @param {unknown} ids - Candidate trophy ids (unlocked ones only: the caller checks that).
   * @returns {Promise<string[]>} The stored ids.
   * @throws {TypeError} When the argument is not an array of non-empty strings.
   * @throws {ProfileError} When more ids than allowed are provided.
   * @throws {Error} When the write fails.
   */
  async setFeatured(ids) {
    const list = ProfileManager.assertKeyList(ids, 'featured');
    const unique = Array.from(new Set(list));
    const { maxFeaturedTrophies } = await this.getLimits();
    if (unique.length > maxFeaturedTrophies) {
      throw new ProfileError(
        PROFILE_ERROR_CODES.FEATURED_FULL,
        `The profile highlights at most ${maxFeaturedTrophies} trophy(ies) (received ${unique.length}).`
      );
    }

    const current = await this.getProfile();
    return this.persist({ ...current, featured: unique }).then((profile) => profile.featured);
  }

  /**
   * Pins or unpins one trophy.
   *
   * @param {unknown} id - Trophy id.
   * @returns {Promise<{featured: string[], added: boolean}>} The resulting list and whether the
   *   trophy was pinned (false when it was unpinned).
   * @throws {TypeError} When the id is not a non-empty string.
   * @throws {ProfileError} When every owned slot is already pinned and this one is not.
   * @throws {Error} When the write fails.
   */
  async toggleFeatured(id) {
    const normalized = ProfileManager.assertKey(id);
    const current = await this.getProfile();
    const featured = current.featured.slice();
    const index = featured.indexOf(normalized);

    if (index >= 0) {
      featured.splice(index, 1);
      await this.persist({ ...current, featured });
      return { featured, added: false };
    }

    const { maxFeaturedTrophies } = await this.getLimits();
    if (featured.length >= maxFeaturedTrophies) {
      throw new ProfileError(
        PROFILE_ERROR_CODES.FEATURED_FULL,
        `The profile highlights at most ${maxFeaturedTrophies} trophy(ies).`
      );
    }
    featured.push(normalized);
    await this.persist({ ...current, featured });
    return { featured, added: true };
  }

  /**
   * Tells whether a card is pinned in the favourites.
   *
   * @param {unknown} key - Collection key.
   * @returns {Promise<boolean>} True when the card is a favourite.
   * @throws {Error} When the read fails.
   */
  async isFavorite(key) {
    const profile = await this.getProfile();
    return profile.favorites.includes(String(key));
  }

  /**
   * Writes a profile and notifies the application.
   *
   * @param {object} profile - Profile to store (already normalized by the callers).
   * @returns {Promise<object>} The stored profile.
   * @throws {Error} When the write fails.
   */
  async persist(profile) {
    await storageRepository.setUserState(PROFILE_STATE_KEY, profile);
    eventBus.emit(EVENTS.PROFILE_UPDATED, { profile });
    eventBus.emit(EVENTS.FAVORITES_UPDATED, { favorites: profile.favorites });
    return profile;
  }

  /**
   * Counts the pinned cards, for the \"1 / 5\" counter of the profile page.
   *
   * @returns {Promise<{favorites: number, featured: number, maxFavorites: number, maxFeaturedTrophies: number}>}
   *   The current and maximum pin counts.
   * @throws {Error} When the read fails.
   */
  async getPinCounts() {
    const [profile, limits] = await Promise.all([this.getProfile(), this.getLimits()]);
    return {
      favorites: profile.favorites.length,
      featured: profile.featured.length,
      maxFavorites: limits.maxFavorites,
      maxFeaturedTrophies: limits.maxFeaturedTrophies,
    };
  }

  /**
   * Normalizes a raw `user_state["profile"]` payload.
   *
   * @param {unknown} raw - Stored value.
   * @param {{maxFavorites?: number, maxFeaturedTrophies?: number}} [limits] - Configured limits.
   * @returns {{name: string, icon: string, photo: string, title: string, usernameColor: string, favorites: string[], featured: string[]}}
   *   A writable profile.
   */
  static normalizeProfile(raw, limits = {}) {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const maxFavorites = Number.isInteger(limits.maxFavorites) ? limits.maxFavorites : 0;
    const maxFeatured = Number.isInteger(limits.maxFeaturedTrophies) ? limits.maxFeaturedTrophies : 0;

    return {
      name: ProfileManager.sanitizeName(source.name),
      icon: ProfileManager.sanitizeIcon(source.icon),
      photo: ProfileManager.sanitizePhoto(source.photo),
      title: ProfileManager.sanitizeTitle(source.title),
      usernameColor: ProfileManager.sanitizeColorId(source.usernameColor),
      favorites: ProfileManager.sanitizeKeyList(source.favorites).slice(0, Math.max(maxFavorites, 0)),
      featured: ProfileManager.sanitizeKeyList(source.featured).slice(0, Math.max(maxFeatured, 0)),
    };
  }

  /**
   * Validates a display name coming from the profile form.
   *
   * @param {unknown} name - Submitted name.
   * @returns {string} The trimmed name (empty when the field was cleared).
   * @throws {ProfileError} When the name is longer than `PROFILE_NAME_MAX_LENGTH`.
   */
  static normalizeName(name) {
    const text = ProfileManager.sanitizeName(name);
    if (text.length > PROFILE_NAME_MAX_LENGTH) {
      throw new ProfileError(
        PROFILE_ERROR_CODES.NAME_TOO_LONG,
        `The display name accepts at most ${PROFILE_NAME_MAX_LENGTH} characters (received ${text.length}).`
      );
    }
    return text;
  }

  /**
   * Validates an avatar URL coming from the profile form.
   *
   * Only `http` and `https` are accepted: a `javascript:` or `data:` URL pasted in the field must
   * never reach an `<img src>` (the browser would execute or inline it). Anything else is refused
   * with an explicit error rather than silently stored.
   *
   * @param {unknown} photo - Submitted URL.
   * @returns {string} The trimmed URL (empty when the field was cleared).
   * @throws {ProfileError} When the URL is too long or not an absolute http(s) URL.
   */
  static normalizePhoto(photo) {
    const text = typeof photo === 'string' ? photo.trim() : '';
    if (text === '') return '';
    if (text.length > PROFILE_PHOTO_MAX_LENGTH) {
      throw new ProfileError(
        PROFILE_ERROR_CODES.PHOTO_INVALID_URL,
        `The avatar URL accepts at most ${PROFILE_PHOTO_MAX_LENGTH} characters (received ${text.length}).`
      );
    }

    let parsed;
    try {
      parsed = new URL(text);
    } catch (error) {
      throw new ProfileError(
        PROFILE_ERROR_CODES.PHOTO_INVALID_URL,
        `The avatar URL must be absolute (received: ${JSON.stringify(text.slice(0, 64))}).`,
        { cause: error }
      );
    }
    if (!PROFILE_PHOTO_PROTOCOLS.includes(parsed.protocol)) {
      throw new ProfileError(
        PROFILE_ERROR_CODES.PHOTO_INVALID_URL,
        `The avatar URL must use http or https (received: ${parsed.protocol}).`
      );
    }
    return parsed.href;
  }

  /**
   * Validates the avatar icon coming from the profile form.
   *
   * The value must be one of the icons `ProfileIconManager` declares (default or unlockable): the
   * avatar is never an arbitrary path, so a repaired save cannot point it at any file of the site.
   *
   * @param {unknown} icon - Submitted icon path.
   * @returns {Promise<string>} The catalogue path (empty when the field was cleared).
   * @throws {ProfileError} When the path is not part of the catalogue.
   * @throws {Error} When the catalogue cannot be read.
   */
  static async normalizeIcon(icon) {
    const text = ProfileManager.sanitizeIcon(icon);
    if (text === '') return '';
    if (!(await profileIconManager.isKnownIcon(text))) {
      throw new ProfileError(
        PROFILE_ERROR_CODES.ICON_UNKNOWN,
        `The avatar must be one of the declared icons (received: ${JSON.stringify(text.slice(0, 64))}).`
      );
    }
    return text;
  }

  /**
   * Cleans a raw value into an avatar path (no validation: used on read, not on write).
   *
   * @param {unknown} value - Raw value.
   * @returns {string} The trimmed path with a leading `./` removed, or an empty string.
   */
  static sanitizeIcon(value) {
    return typeof value === 'string' ? value.trim().replace(/^\.\//, '').slice(0, PROFILE_PHOTO_MAX_LENGTH) : '';
  }

  /**
   * Validates the title coming from the titles page.
   *
   * The value must be the id of a title the catalogue declares (`TitleManager`), or the empty
   * string, which is the explicit "no title" choice: a title is never displayed by accident, and a
   * repaired save can never point the profile at an id that does not exist.
   *
   * The UNLOCK state is deliberately not checked here: this manager owns the shape of the profile,
   * not the conditions of the catalogue (the picker only offers the unlocked ones, and a title that
   * a later rebalance locks again simply stays displayed until the player chooses another).
   *
   * @param {unknown} title - Submitted id.
   * @returns {Promise<string>} The id (empty when no title was chosen).
   * @throws {ProfileError} When the id is not part of the catalogue.
   * @throws {Error} When the catalogue cannot be read.
   */
  static async normalizeTitle(title) {
    const text = ProfileManager.sanitizeTitle(title);
    if (text === '') return '';
    if (!(await titleManager.isKnownTitle(text))) {
      throw new ProfileError(
        PROFILE_ERROR_CODES.TITLE_UNKNOWN,
        `The title must be one of the declared ones (received: ${JSON.stringify(text.slice(0, 64))}).`
      );
    }
    return text;
  }

  /**
   * Cleans a raw value into a title id (no validation: used on read, not on write).
   *
   * @param {unknown} value - Raw value.
   * @returns {string} The trimmed id, or an empty string.
   */
  static sanitizeTitle(value) {
    return typeof value === 'string' ? value.trim().slice(0, 120) : '';
  }

  /**
   * Cleans a raw value into a username colour id (no ownership check: used on read).
   *
   * @param {unknown} value - Raw value.
   * @returns {string} The id, or `auto` when the value is not usable.
   */
  static sanitizeColorId(value) {
    const text = typeof value === 'string' ? value.trim().slice(0, 40) : '';
    return text === '' ? USERNAME_DEFAULT_COLOR : text;
  }

  /**
   * Validates the username colour chosen in the profile editor.
   *
   * Any syntactically valid id is stored, but a colour the player does not OWN paints nothing:
   * `ProfileCardManager` and `ProfileView` resolve the preference against the purchases, exactly
   * like the title colour of the profile card.
   *
   * @param {unknown} value - Submitted id (`auto` clears the colour).
   * @returns {string} The stored id.
   * @throws {ProfileError} When the id cannot be a colour identifier.
   */
  static normalizeUsernameColor(value) {
    const text = ProfileManager.sanitizeColorId(value);
    if (isColorId(text)) return text;
    throw new ProfileError(
      PROFILE_ERROR_CODES.COLOR_UNKNOWN,
      `The username colour must be a colour identifier (received: ${JSON.stringify(text.slice(0, 64))}).`
    );
  }

  /**
   * Cleans a raw value into a name.
   *
   * Control characters are dropped and runs of whitespace collapsed, so a pasted value cannot
   * inject a line break in a header or a card caption. Sanitizing never throws (a corrupted state
   * must stay readable); only `normalizeName()` enforces the length for a player submission.
   *
   * @param {unknown} value - Raw value.
   * @returns {string} The cleaned name.
   */
  static sanitizeName(value) {
    if (typeof value !== 'string') return '';
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point here.
    return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  }

  /**
   * Cleans a raw value into a photo URL (no validation: used on read, not on write).
   *
   * @param {unknown} value - Raw value.
   * @returns {string} The trimmed URL, or an empty string.
   */
  static sanitizePhoto(value) {
    return typeof value === 'string' ? value.trim().slice(0, PROFILE_PHOTO_MAX_LENGTH) : '';
  }

  /**
   * Cleans a raw value into a list of unique keys.
   *
   * @param {unknown} value - Raw value.
   * @returns {string[]} The valid keys, in their original order.
   */
  static sanitizeKeyList(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    value.forEach((entry) => {
      if (typeof entry !== 'string' || entry.trim() === '') return;
      seen.add(entry.trim());
    });
    return Array.from(seen);
  }

  /**
   * Validates one requested key.
   *
   * @param {unknown} key - Candidate key.
   * @returns {string} The trimmed key.
   * @throws {ProfileError} When the value is not a non-empty string.
   */
  static assertKey(key) {
    if (typeof key !== 'string' || key.trim() === '') {
      throw new ProfileError(
        PROFILE_ERROR_CODES.INVALID_KEY,
        `The profile expects a non-empty key (received: ${JSON.stringify(key)}).`
      );
    }
    return key.trim();
  }

  /**
   * Validates a requested list of keys.
   *
   * @param {unknown} keys - Candidate list.
   * @param {string} label - Label used in error messages.
   * @returns {string[]} The trimmed keys.
   * @throws {TypeError} When the value is not an array of non-empty strings.
   */
  static assertKeyList(keys, label) {
    if (!Array.isArray(keys)) {
      throw new TypeError(`ProfileManager.${label} expects an array of keys.`);
    }
    return keys.map((key) => ProfileManager.assertKey(key));
  }
}

/** Shared instance used by the profile view, the collection view and the trophy manager. */
export const profileManager = new ProfileManager();

export default profileManager;

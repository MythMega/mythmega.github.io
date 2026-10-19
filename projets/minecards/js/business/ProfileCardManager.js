/**
 * ProfileCardManager - Everything a player's PROFILE CARD is made of.
 *
 * Reference: `settings/config.json` (section `profileCard`), `js/business/ProfileManager.js`
 * (pseudo, title, favourites, pinned trophies) and `js/business/CollectionManager.js`
 * (owned cards and the date of the first copy). The card itself is drawn by
 * `js/UI/components/ProfileCard.js`, which only receives the plain facts built here.
 *
 * THE CARD IS A PROJECTION OF THE ACCOUNT, NEVER ITS OWN STATE
 * Nothing is stored: every field is recomputed from what the account already holds, so the card
 * can never disagree with the profile page next to it. The fields are:
 *   - `name`            : the pseudo (`profile.name`), empty when the player has not chosen one;
 *   - `titleId`         : the worn title, resolved to a sentence by the component;
 *   - `seriesNumber`    : the last characters of the account UUID (the "Origines #001" slot);
 *   - `rarity`          : 1..5, from the NUMBER OF UNLOCKED TROPHIES and the configured
 *                         thresholds (the highest rarity the account reaches), or the rarity the
 *                         player picked among the unlocked ones;
 *   - `titleColor`      : `auto` (the rarity colour, free) or an OWNED colour of the palette, with
 *                         the CSS value the component applies inline (`titleColorValue`);
 *   - `background`      : the artwork of the favourite card the player picked (the first one by
 *                         default), or the configured fallback;
 *   - `underlay`        : the avatar icon of the profile, drawn over the illustration;
 *   - the counters      : pinned trophies, boosters opened, distinct cards, oldest card, Sparks,
 *                         blocks mined and Mine Picks made.
 *
 * WHAT THE PLAYER PAID FOR IS CHECKED HERE, NOT ONLY BY THE PAGE
 *   The title colour is filtered against `FeatureManager.getPurchases()`: a preference alone is
 *   never enough, so a hand-edited save can never dress the card in a colour it did not buy.
 *
 * A missing value is never an error: an empty pseudo, no favourite, no card at all still produce a
 * readable card, so the panel is useful from the very first booster.
 */

import { configLoader } from '../utils/ConfigLoader.js';
import { storageRepository, STORES } from '../models/StorageRepository.js';
import accountManager, { USER_STATE_KEYS } from './AccountManager.js';
import { AUTO_COLOR_ID, colorManager, findColor, isColorId } from './ColorManager.js';
import featureManager, { FeatureManager } from './FeatureManager.js';
import minePickManager from './MinePickManager.js';
import miningManager from './MiningManager.js';
import sparksManager from './SparksManager.js';

/** Lowest and highest rarity of a card (`1` = Commune … `5` = Mythique). */
export const PROFILE_CARD_RARITY_MIN = 1;
export const PROFILE_CARD_RARITY_MAX = 5;

/** The two layouts of the card, as stored in `user_state["profileCard"].layout`. */
export const PROFILE_CARD_LAYOUTS = Object.freeze(['classic', 'fullart']);

/** Layout stored when the account has never chosen one. */
export const PROFILE_CARD_DEFAULT_LAYOUT = 'classic';

/** Title colour stored when the account has never chosen one (the rarity colour). */
export const PROFILE_CARD_DEFAULT_TITLE_COLOR = AUTO_COLOR_ID;

export class ProfileCardManager {
  /**
   * Logs with the manager prefix.
   *
   * @param {...unknown} args - Values forwarded to `console.info`.
   * @returns {void}
   */
  log(...args) {
    console.info('[ProfileCardManager]', ...args);
  }

  /**
   * Reads the validated `profileCard` section of `settings/config.json`.
   *
   * @returns {Promise<{rarityThresholds: Record<number, number>, defaultArtPath: string, seriesDigits: number}>}
   *   The settings, with the thresholds already clamped to a non-decreasing sequence.
   * @throws {Error} When `settings/config.json` cannot be loaded.
   */
  async getSettings() {
    return configLoader.getProfileCardSettings();
  }

  /**
   * Resolves the card rarity from the number of unlocked trophies.
   *
   * The rarity is the HIGHEST one whose threshold the account reaches, so a brand new account
   * (0 trophy) is Commune and only the last threshold has to be tuned to keep a card Mythique.
   *
   * @param {Record<number, number>} thresholds - Minimum trophy count per rarity.
   * @param {number} trophyCount - Unlocked trophies of the account.
   * @returns {number} The rarity, between `PROFILE_CARD_RARITY_MIN` and `PROFILE_CARD_RARITY_MAX`.
   */
  static resolveRarity(thresholds, trophyCount) {
    const count = Number.isFinite(trophyCount) ? Math.max(0, Math.trunc(trophyCount)) : 0;
    let rarity = PROFILE_CARD_RARITY_MIN;
    for (let current = PROFILE_CARD_RARITY_MIN; current <= PROFILE_CARD_RARITY_MAX; current += 1) {
      const threshold = Number(thresholds?.[current]);
      if (!Number.isFinite(threshold)) continue;
      if (count >= threshold) rarity = current;
    }
    return rarity;
  }

  /**
   * Tells whether one rarity is unlocked by the trophy count.
   *
   * @param {Record<number, number>} thresholds - Minimum trophy count per rarity.
   * @param {number} rarity - Rarity to test.
   * @param {number} trophyCount - Unlocked trophies of the account.
   * @returns {boolean} True when the threshold is reached.
   */
  static isRarityUnlocked(thresholds, rarity, trophyCount) {
    const threshold = Number(thresholds?.[rarity]);
    const count = Number.isFinite(trophyCount) ? Math.max(0, Math.trunc(trophyCount)) : 0;
    return Number.isFinite(threshold) && count >= threshold;
  }

  /**
   * Resolves the rarity the card actually wears.
   *
   * A player may CHOOSE among the rarities their trophies unlocked: the choice wins as long as it
   * is still unlocked, and anything else (no choice, a choice that is no longer reachable, a value
   * written by another version) falls back to the highest rarity reached. The card can therefore
   * never show a rarity the account did not earn.
   *
   * @param {Record<number, number>} thresholds - Minimum trophy count per rarity.
   * @param {number} trophyCount - Unlocked trophies of the account.
   * @param {number|null} [chosen=null] - Rarity picked by the player, if any.
   * @returns {number} The rarity to display.
   */
  static resolveWornRarity(thresholds, trophyCount, chosen = null) {
    const picked = Number.isInteger(chosen) ? chosen : null;
    if (
      picked !== null
      && picked >= PROFILE_CARD_RARITY_MIN
      && picked <= PROFILE_CARD_RARITY_MAX
      && ProfileCardManager.isRarityUnlocked(thresholds, picked, trophyCount)
    ) {
      return picked;
    }
    return ProfileCardManager.resolveRarity(thresholds, trophyCount);
  }

  /**
   * Lists the five rarities with their unlock state, for the picker of the profile page.
   *
   * @param {Record<number, number>} thresholds - Minimum trophy count per rarity.
   * @param {number} trophyCount - Unlocked trophies of the account.
   * @param {number|null} [chosen=null] - Rarity currently worn.
   * @returns {Array<{rarity: number, unlocked: boolean, required: number, count: number, worn: boolean}>}
   *   One entry per rarity, in ascending order.
   */
  static listRarities(thresholds, trophyCount, chosen = null) {
    const count = Number.isFinite(trophyCount) ? Math.max(0, Math.trunc(trophyCount)) : 0;
    const worn = ProfileCardManager.resolveWornRarity(thresholds, count, chosen);
    const rarities = [];
    for (let rarity = PROFILE_CARD_RARITY_MIN; rarity <= PROFILE_CARD_RARITY_MAX; rarity += 1) {
      const required = Number(thresholds?.[rarity]);
      rarities.push({
        rarity,
        unlocked: ProfileCardManager.isRarityUnlocked(thresholds, rarity, count),
        required: Number.isFinite(required) ? required : 0,
        count,
        worn: rarity === worn,
      });
    }
    return rarities;
  }

  /**
   * Normalizes the stored `user_state["profileCard"]` preferences.
   *
   * @param {unknown} raw - Stored value.
   * @returns {{layout: string, rarity: number|null, titleColor: string, background: string|null}}
   *   The validated preferences (shipped defaults for anything malformed).
   */
  static normalizePreferences(raw) {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const layout = PROFILE_CARD_LAYOUTS.includes(source.layout)
      ? source.layout
      : PROFILE_CARD_DEFAULT_LAYOUT;
    const rarity = Number.isInteger(source.rarity)
      && source.rarity >= PROFILE_CARD_RARITY_MIN
      && source.rarity <= PROFILE_CARD_RARITY_MAX
      ? source.rarity
      : null;
    // `auto` and a syntactically valid colour id are stored as-is. The catalogue is checked when
    // the card is BUILT, so removing a colour from `settings/colors.json` falls back to `auto`
    // instead of leaving the title unpainted.
    const titleColor = isColorId(source.titleColor)
      ? source.titleColor
      : PROFILE_CARD_DEFAULT_TITLE_COLOR;
    // The background is a FAVOURITE key, never a path: the page refuses a key that is not pinned,
    // and the model falls back to the first favourite when this one is gone.
    const background = typeof source.background === 'string' && source.background.trim() !== ''
      ? source.background.trim()
      : null;
    return { layout, rarity, titleColor, background };
  }

  /**
   * Reads the display preferences of the card.
   *
   * Nothing here is checked against what the player OWNS: this manager stores a valid value, the
   * page is the one that refuses to offer a layout that has not been paid for
   * (`FeatureManager`), exactly like `ProfileManager` stores card keys without owning them.
   *
   * @returns {Promise<{layout: string, rarity: number|null}>} The preferences.
   * @throws {Error} When the read fails.
   */
  async getPreferences() {
    return ProfileCardManager.normalizePreferences(
      await storageRepository.getUserState(USER_STATE_KEYS.PROFILE_CARD)
    );
  }

  /**
   * Saves the display preferences of the card.
   *
   * Only the supplied fields are updated, so the page can store a layout without touching the
   * chosen rarity (and the other way around).
   *
   * @param {object} payload - Fields to update.
   * @param {unknown} [payload.layout] - `'classic'` or `'fullart'`.
   * @param {unknown} [payload.rarity] - Rarity 1-5, or null to go back to the highest reached.
   * @param {unknown} [payload.titleColor] - `'auto'` or the id of a palette colour.
   * @param {unknown} [payload.background] - Collection key of a favourite card, or null for "the
   *   first favourite".
   * @returns {Promise<{layout: string, rarity: number|null, titleColor: string,
   *   background: string|null}>} The resulting preferences.
   * @throws {Error} When the write fails.
   */
  async savePreferences(payload = {}) {
    const current = await this.getPreferences();
    const next = { ...current };
    if (payload && typeof payload === 'object') {
      if (Object.prototype.hasOwnProperty.call(payload, 'layout')) {
        next.layout = PROFILE_CARD_LAYOUTS.includes(payload.layout)
          ? payload.layout
          : current.layout;
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'rarity')) {
        next.rarity = payload.rarity === null
          ? null
          : ProfileCardManager.normalizePreferences({ rarity: payload.rarity }).rarity;
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'titleColor')) {
        next.titleColor = ProfileCardManager.normalizePreferences({
          titleColor: payload.titleColor,
        }).titleColor;
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'background')) {
        next.background = ProfileCardManager.normalizePreferences({
          background: payload.background,
        }).background;
      }
    }
    await storageRepository.setUserState(USER_STATE_KEYS.PROFILE_CARD, next);
    this.log(
      `Card preferences saved (layout: ${next.layout}, rarity: ${next.rarity ?? 'auto'}, ` +
        `title colour: ${next.titleColor}, background: ${next.background ?? 'first favourite'}).`
    );
    return next;
  }

  /**
   * Finds the next rarity the account can reach, and how many trophies are missing.
   *
   * The profile page turns this into a small goal ("5 more trophies before the Legendary rarity")
   * so the card is also a progress display, not only a badge.
   *
   * @param {Record<number, number>} thresholds - Minimum trophy count per rarity.
   * @param {number} rarity - Rarity currently reached.
   * @param {number} trophyCount - Unlocked trophies of the account.
   * @returns {{rarity: number, count: number}|null} The next rarity and the missing trophies, or null
   *   when the card already is Mythique.
   */
  static findNextRarity(thresholds, rarity, trophyCount) {
    const count = Number.isFinite(trophyCount) ? Math.max(0, Math.trunc(trophyCount)) : 0;
    for (let next = rarity + 1; next <= PROFILE_CARD_RARITY_MAX; next += 1) {
      const threshold = Number(thresholds?.[next]);
      if (!Number.isFinite(threshold) || threshold <= count) continue;
      return { rarity: next, count: threshold - count };
    }
    return null;
  }

  /**
   * Builds the series number printed after the player title.
   *
   * The account UUID is immutable, so the number identifies the player for good; the hyphens are
   * dropped and the LAST characters are kept, which is where a v4 UUID is the most random.
   *
   * @param {string|null} uuid - Account UUID.
   * @param {number} digits - How many characters to keep.
   * @returns {string} The number, uppercased, or an empty string when there is no UUID.
   */
  static buildSeriesNumber(uuid, digits) {
    if (typeof uuid !== 'string') return '';
    const compact = uuid.replace(/-/g, '').toUpperCase();
    const size = Number.isInteger(digits) ? Math.min(Math.max(digits, 1), 8) : 4;
    return compact.slice(-size);
  }

  /**
   * Resolves which favourite lends its artwork to the card.
   *
   * The chosen key wins while it is still a favourite whose card resolves; anything else falls back
   * to the FIRST favourite, which is therefore the default without storing anything.
   *
   * @param {object} profile - Stored profile.
   * @param {Map<string, object>} entriesByKey - Collection entries keyed by card key.
   * @param {string|null} [preferred=null] - Stored choice.
   * @returns {string|null} The key of the favourite used, or null when none resolves.
   */
  static resolveBackgroundKey(profile, entriesByKey, preferred = null) {
    const favorites = Array.isArray(profile?.favorites) ? profile.favorites : [];
    // A card without `Background` is still a usable backdrop: its `Underlay` and, failing that,
    // its own illustration (`Path`) are the two documented fallbacks (see `findBackground`).
    const usable = favorites.filter((key) => {
      const card = entriesByKey?.get(key)?.card;
      return ProfileCardManager.cardBackdrop(card) !== '';
    });
    if (typeof preferred === 'string' && usable.includes(preferred)) return preferred;
    return usable[0] ?? null;
  }

  /**
   * Resolves the backdrop of one card, in the documented fallback order.
   *
   * `Background` is the artwork alone (the very image a binder uses), `Underlay` is the texture
   * behind the illustration, and `Path` (the illustration) is the last resort: it is the WHOLE card
   * (frame, title, description), so it is only used when a card has neither of the two others.
   *
   * @param {object|null} card - Card instance.
   * @returns {string} The best backdrop path, or an empty string when the card declares none.
   */
  static cardBackdrop(card) {
    if (!card) return '';
    const candidates = [card.background, card.underlay, card.illustration];
    return candidates.find((path) => typeof path === 'string' && path !== '') ?? '';
  }

  /**
   * Resolves the illustration that fills the card background.
   *
   * The chosen favourite lends its artwork, or the first one when no choice was made. A favourite
   * whose card left the catalogue is skipped: a pin the player can no longer resolve must not leave
   * a blank card.
   *
   * @param {object} profile - Stored profile.
   * @param {Map<string, object>} entriesByKey - Collection entries keyed by card key.
   * @param {string} fallback - Illustration used when no favourite resolves.
   * @param {string|null} [preferred=null] - Stored choice.
   * @returns {string} The illustration path (may still contain the `<lang>` placeholder).
   */
  static findBackground(profile, entriesByKey, fallback, preferred = null) {
    const key = ProfileCardManager.resolveBackgroundKey(profile, entriesByKey, preferred);
    // `Background` and not the illustration (`Path`) when it exists: the illustration of a card
    // data file is the WHOLE card (frame, title, description), which would draw a card inside the
    // card. Cards that declare no `Background` nevertheless have an `Underlay` (the texture behind
    // the illustration) and, failing that, their illustration is the last resort - a fallback is
    // always better than a blank card.
    const artwork = key ? ProfileCardManager.cardBackdrop(entriesByKey?.get(key)?.card) : '';
    if (artwork !== '') return artwork;
    return typeof fallback === 'string' ? fallback : '';
  }

  /**
   * Resolves the avatar drawn over the illustration.
   *
   * The selected icon wins; a profile written by an older version only carries a `photo` URL, which
   * is still the avatar the player sees on the page, so it is used as well.
   *
   * @param {object} profile - Stored profile.
   * @returns {string} The avatar path, or an empty string when the profile has none.
   */
  static findUnderlay(profile) {
    if (!profile) return '';
    if (typeof profile.icon === 'string' && profile.icon !== '') return profile.icon;
    if (typeof profile.photo === 'string' && profile.photo !== '') return profile.photo;
    return '';
  }

  /**
   * Counts the cards the player owns, promos included.
   *
   * `completion.owned` deliberately excludes the promo cards (it measures the drawable catalogue),
   * while the card tells the player how many DIFFERENT cards they hold: every owned entry counts.
   *
   * @param {object[]} entries - Collection entries.
   * @returns {number} The number of distinct owned cards.
   */
  static countDistinctCards(entries) {
    if (!Array.isArray(entries)) return 0;
    return entries.filter((entry) => entry?.owned).length;
  }

  /**
   * Finds the oldest copy of the collection.
   *
   * A very old save may hold rows without `firstObtainedAt`: they are ignored, so the date is the
   * oldest one the game can actually prove.
   *
   * @param {object[]} entries - Collection entries.
   * @returns {string|null} The ISO timestamp of the first card, or null when none is known.
   */
  static findFirstObtainedAt(entries) {
    if (!Array.isArray(entries)) return null;
    let oldest = null;
    let oldestTime = Number.POSITIVE_INFINITY;
    entries.forEach((entry) => {
      if (!entry?.owned || typeof entry.firstObtainedAt !== 'string') return;
      const time = Date.parse(entry.firstObtainedAt);
      if (!Number.isFinite(time) || time >= oldestTime) return;
      oldest = entry.firstObtainedAt;
      oldestTime = time;
    });
    return oldest;
  }

  /**
   * Reads the number of boosters the account has opened.
   *
   * The counter lives in `user_state["stats"]` (`boosterManager` only ever increments it, the
   * statistics page reads it the same way): a missing or malformed value reads as 0.
   *
   * @returns {Promise<number>} The number of opened boosters.
   * @throws {Error} When the statistics cannot be read.
   */
  async getBoostersOpened() {
    const stats = await storageRepository.getItem(STORES.USER_STATE, USER_STATE_KEYS.STATS);
    return Number.isInteger(stats?.boostersOpened) && stats.boostersOpened >= 0
      ? stats.boostersOpened
      : 0;
  }

  /**
   * Reads the two counters the card borrows from the other screens of the game.
   *
   * They are the numbers a player is proud of and that no other panel of the profile shows: the
   * Sparks in the bank, every block ever mined and every Mine Pick ever made.
   *
   * @returns {Promise<{sparks: number, blocksMined: number, picksMade: number}>} The counters.
   * @throws {Error} When one of the states cannot be read.
   */
  async getProgressCounters() {
    const [sparks, mining, minepick] = await Promise.all([
      sparksManager.getBalance(),
      miningManager.getState(),
      minePickManager.getState(),
    ]);
    return {
      sparks,
      blocksMined: Number.isInteger(mining?.totalMined) ? mining.totalMined : 0,
      picksMade: Number.isInteger(minepick?.totalPicks) ? minepick.totalPicks : 0,
    };
  }

  /**
   * Resolves the colour a line of the card may actually wear.
   *
   * `auto` is always allowed and costs nothing. A palette colour is only applied when it exists
   * in `settings/colors.json` AND was bought for that line: the preference alone is not enough, so
   * a hand-edited save can never dress the card in a colour the player did not pay for.
   *
   * @param {unknown} preference - Stored preference (`auto` or a colour id).
   * @param {Record<string, {boughtAt: string}>} purchases - Value of `FeatureManager.getPurchases()`.
   * @param {Array<{id: string}>} catalog - Palette returned by `ColorManager.listColors()`.
   * @param {'title'|'username'} kind - Which purchase unlocks the colour.
   * @returns {string} `auto` or the id of an owned colour.
   */
  static resolveColor(preference, purchases, catalog, kind) {
    if (preference === AUTO_COLOR_ID) return AUTO_COLOR_ID;
    const entry = findColor(catalog, preference);
    if (!entry) return AUTO_COLOR_ID;
    const featureId = kind === 'username'
      ? FeatureManager.usernameColorFeatureId(entry.id)
      : FeatureManager.titleColorFeatureId(entry.id);
    const owned = Boolean(purchases) && Object.prototype.hasOwnProperty.call(purchases, featureId);
    return owned ? entry.id : AUTO_COLOR_ID;
  }

  /**
   * Resolves the pinned trophies, in the order the player pinned them.
   *
   * @param {object} profile - Stored profile.
   * @param {object|null} trophyState - Value returned by `TrophyManager.evaluate()`.
   * @returns {object[]} The trophy states (a pin whose trophy disappeared is dropped).
   */
  static findFeaturedTrophies(profile, trophyState) {
    const byId = new Map((trophyState?.trophies ?? []).map((trophy) => [trophy.id, trophy]));
    return (profile?.featured ?? []).map((id) => byId.get(id)).filter((trophy) => Boolean(trophy));
  }

  /**
   * Builds every field of the card.
   *
   * @param {object} [sources] - Everything the card is read from.
   * @param {object|null} [sources.profile] - Stored profile.
   * @param {object|null} [sources.trophyState] - Value returned by `TrophyManager.evaluate()`.
   * @param {object|null} [sources.collection] - Value returned by `CollectionManager.getCollectionView()`.
   * @param {Map<string, object>|null} [sources.entriesByKey] - The same entries, keyed by card key.
   * @param {string|null} [sources.uuid] - Account UUID (read from the account when omitted).
   * @param {{layout: string, rarity: number|null, titleColor: string}|null} [sources.preferences] -
   *   Stored display preferences (read from the account when omitted).
   * @returns {Promise<object>} The card model, ready for `ProfileCard.render()`.
   * @throws {Error} When `settings/config.json`, the statistics or a counter cannot be read.
   */
  async build({
    profile = null,
    trophyState = null,
    collection = null,
    entriesByKey = null,
    uuid = null,
    preferences = null,
  } = {}) {
    const [settings, boostersOpened, stored, counters, purchases, colorCatalog] = await Promise.all([
      this.getSettings(),
      this.getBoostersOpened(),
      preferences ?? this.getPreferences(),
      this.getProgressCounters(),
      featureManager.getPurchases(),
      colorManager.listColors(),
    ]);
    const entries = Array.isArray(collection?.entries) ? collection.entries : [];
    const byKey = entriesByKey instanceof Map
      ? entriesByKey
      : new Map(entries.map((entry) => [entry.key, entry]));
    const accountUuid = typeof uuid === 'string' && uuid !== '' ? uuid : await accountManager.getUuid();

    const trophyCount = Number.isInteger(trophyState?.counters?.unlocked)
      ? trophyState.counters.unlocked
      : 0;
    const chosenRarity = stored.rarity;
    const titleColor = ProfileCardManager.resolveColor(
      stored.titleColor,
      purchases,
      colorCatalog,
      'title'
    );
    const titleColorEntry = findColor(colorCatalog, titleColor);
    const nameColor = ProfileCardManager.resolveColor(
      profile?.usernameColor,
      purchases,
      colorCatalog,
      'username'
    );
    const nameColorEntry = findColor(colorCatalog, nameColor);

    const model = {
      name: typeof profile?.name === 'string' ? profile.name.trim() : '',
      titleId: typeof profile?.title === 'string' ? profile.title : '',
      seriesNumber: ProfileCardManager.buildSeriesNumber(accountUuid, settings.seriesDigits),
      rarity: ProfileCardManager.resolveWornRarity(settings.rarityThresholds, trophyCount, chosenRarity),
      chosenRarity,
      layout: stored.layout,
      // The title line wears `auto` (the rarity colour, resolved by the stylesheet) unless an OWNED
      // colour is selected; `titleColorValue` is the CSS value the component applies inline.
      titleColor,
      titleColorValue: titleColorEntry ? titleColorEntry.hex : null,
      nameColor,
      nameColorValue: nameColorEntry ? nameColorEntry.hex : null,
      trophyCount,
      thresholds: settings.rarityThresholds,
      rarities: ProfileCardManager.listRarities(settings.rarityThresholds, trophyCount, chosenRarity),
      backgroundKey: ProfileCardManager.resolveBackgroundKey(profile, byKey, stored.background),
      background: ProfileCardManager.findBackground(
        profile,
        byKey,
        settings.defaultArtPath,
        stored.background
      ),
      underlay: ProfileCardManager.findUnderlay(profile),
      featuredTrophies: ProfileCardManager.findFeaturedTrophies(profile, trophyState),
      boostersOpened,
      distinctCards: ProfileCardManager.countDistinctCards(entries),
      firstObtainedAt: ProfileCardManager.findFirstObtainedAt(entries),
      sparks: counters.sparks,
      blocksMined: counters.blocksMined,
      picksMade: counters.picksMade,
    };

    this.log(
      `Card built: rarity ${model.rarity} (${model.trophyCount} trophies), ` +
        `${model.distinctCards} card(s), ${model.boostersOpened} booster(s), ` +
        `${model.sparks} Sparks.`
    );
    return model;
  }
}

/** Shared manager instance. */
export const profileCardManager = new ProfileCardManager();

export default profileCardManager;

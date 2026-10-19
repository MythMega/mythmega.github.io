/**
 * FeatureManager - The extra features a player BUYS with Sparks.
 *
 * Reference: `settings/config.json` (section `features`), `js/business/SparksManager.js` (the
 * currency) and `js/utils/EventBus.js` (`FEATURE_UNLOCKED`).
 *
 * WHY A MANAGER OF ITS OWN
 *   Sparks already buy CARDS (`SparksManager.buyCard`), but a bought card is collection data while
 *   a bought feature is an ACCOUNT CAPABILITY: the Full Art layout of the profile card, and every
 *   capability added later. Keeping them apart means a capability is never mistaken for a card (it
 *   has no rarity, never enters the collection, never feeds a trophy) and that the answer to "what
 *   did this player pay for?" is a single, small map.
 *
 * WHAT IS STORED
 *   `user_state["purchases"]`, an object keyed by feature id: `{ cardLayoutFullArt: { boughtAt } }`.
 *   Only what was BOUGHT is written; the price is read from the configuration on every use, so
 *   raising a price never retroactively charges an owner anything, and the purchase itself is final
 *   (there is no refund, which is why the price is shown before the confirmation).
 *
 * Atoms: the debit and the purchase record are written in ONE `user_state` transaction. A purchase
 * that fails therefore leaves no trace: no Sparks spent, nothing owned.
 */

import eventBus, { EVENTS } from '../utils/EventBus.js';
import { configLoader } from '../utils/ConfigLoader.js';
import { storageRepository, STORES } from '../models/StorageRepository.js';
import { USER_STATE_KEYS } from './AccountManager.js';
import { colorManager } from './ColorManager.js';
import profileIconManager, {
  normalizeIconPath,
  PROFILE_ICON_FEATURE_PREFIX,
} from './ProfileIconManager.js';
import sparksManager from './SparksManager.js';

/** The features the code knows how to lock something behind. */
export const FEATURES = Object.freeze({
  /** The Full Art layout of the profile card (`ProfileCard`). */
  CARD_LAYOUT_FULL_ART: 'cardLayoutFullArt',
});

/**
 * Prefix of the purchase id of one title colour of the profile card.
 *
 * A colour is a capability like the Full Art layout, but there are several of them and they come
 * from their own catalogue (`settings/colors.json`). They still share the ONE purchases map, so
 * "what did this player pay for?" stays a single small object: the prefix is what tells a colour
 * apart from a feature, and it is the only place that knows how they are written.
 */
export const TITLE_COLOR_FEATURE_PREFIX = 'cardTitleColor.';

/**
 * Prefix of the purchase id of one pseudo colour.
 *
 * A pseudo colour and a title colour share the palette (`settings/colors.json`) but not the
 * purchase: buying one never unlocks the other, which is why the map keeps two distinct prefixes.
 */
export const USERNAME_COLOR_FEATURE_PREFIX = 'usernameColor.';

/** The two lists of the profile whose extra slots are bought with Sparks. */
export const PROFILE_SLOT_KINDS = Object.freeze({
  FAVORITES: 'favorites',
  FEATURED: 'featured',
});

/** Prefix of the purchase id of one paid avatar (`profileIcon.<file>`). */
export { PROFILE_ICON_FEATURE_PREFIX };

/** Prefix of the purchase id of one extra favourite-card slot (`profileFavoriteSlot.4`). */
export const FAVORITE_SLOT_FEATURE_PREFIX = 'profileFavoriteSlot.';

/** Prefix of the purchase id of one extra featured-trophy slot (`profileFeaturedSlot.2`). */
export const FEATURED_SLOT_FEATURE_PREFIX = 'profileFeaturedSlot.';

/** Machine-readable reasons a purchase was refused. */
export const FEATURE_ERROR_CODES = Object.freeze({
  UNKNOWN: 'unknownFeature',
  INSUFFICIENT_SPARKS: 'insufficientSparks',
  SLOT_MAXED: 'slotMaxed',
});

/**
 * Error thrown when a purchase cannot be completed.
 */
export class FeatureError extends Error {
  /**
   * @param {string} code - One of `FEATURE_ERROR_CODES`.
   * @param {string} message - Human-readable cause, for the console.
   */
  constructor(code, message) {
    super(message);
    this.name = 'FeatureError';
    this.code = code;
  }
}

export class FeatureManager {
  /**
   * Logs with the manager prefix.
   *
   * @param {...unknown} args - Values forwarded to `console.info`.
   * @returns {void}
   */
  log(...args) {
    console.info('[FeatureManager]', ...args);
  }

  /**
   * Reads the catalogue of purchasable features.
   *
   * @returns {Promise<Record<string, {priceSparks: number}>>} The prices, in Sparks.
   * @throws {Error} When `settings/config.json` cannot be read.
   */
  async getCatalog() {
    const { items } = await configLoader.getFeatureSettings();
    return items;
  }

  /**
   * Price of one feature.
   *
   * @param {string} id - Feature identifier.
   * @returns {Promise<number>} Its price in Sparks.
   * @throws {FeatureError} With `UNKNOWN` when the catalogue does not declare it.
   * @throws {Error} When the configuration cannot be read.
   */
  async getPrice(id) {
    const catalog = await this.getCatalog();
    const entry = catalog[id];
    if (!entry) {
      throw new FeatureError(
        FEATURE_ERROR_CODES.UNKNOWN,
        `"${id}" is not a purchasable feature (known: ${Object.keys(catalog).join(', ')}).`
      );
    }
    return entry.priceSparks;
  }

  /**
   * Builds the purchase id of one title colour.
   *
   * @param {string} colorId - Colour id (`gold`, `emerald`…).
   * @returns {string} The id written in `user_state["purchases"]`.
   */
  static titleColorFeatureId(colorId) {
    return `${TITLE_COLOR_FEATURE_PREFIX}${colorId}`;
  }

  /**
   * Builds the purchase id of one pseudo colour.
   *
   * @param {string} colorId - Colour id (`gold`, `emerald`…).
   * @returns {string} The id written in `user_state["purchases"]`.
   */
  static usernameColorFeatureId(colorId) {
    return `${USERNAME_COLOR_FEATURE_PREFIX}${colorId}`;
  }

  /**
   * Validates one of the two lists of the profile that can grow.
   *
   * @param {unknown} kind - `PROFILE_SLOT_KINDS` member.
   * @returns {string} The validated kind.
   * @throws {TypeError} When the kind is unknown.
   */
  static slotKind(kind) {
    if (kind === PROFILE_SLOT_KINDS.FAVORITES) return PROFILE_SLOT_KINDS.FAVORITES;
    if (kind === PROFILE_SLOT_KINDS.FEATURED) return PROFILE_SLOT_KINDS.FEATURED;
    throw new TypeError(`Unknown profile slot kind: ${JSON.stringify(kind)}.`);
  }

  /**
   * Builds the purchase id of one extra slot.
   *
   * @param {string} kind - `PROFILE_SLOT_KINDS` member.
   * @param {number} slot - Slot number (above the free ones).
   * @returns {string} The id written in `user_state["purchases"]`.
   */
  static slotFeatureId(kind, slot) {
    const prefix = FeatureManager.slotKind(kind) === PROFILE_SLOT_KINDS.FAVORITES
      ? FAVORITE_SLOT_FEATURE_PREFIX
      : FEATURED_SLOT_FEATURE_PREFIX;
    return `${prefix}${slot}`;
  }

  /**
   * Reads the number of slots a list actually has.
   *
   * The free slots count as owned, then every CONSECUTIVE purchased slot adds one. The purchases are
   * therefore read as a ladder: a hand-edited save that owns slot 5 without slot 4 cannot skip a
   * price, it simply stops at the first missing rung.
   *
   * @param {string} kind - `PROFILE_SLOT_KINDS` member.
   * @param {object} settings - Value returned by `ConfigLoader.getProfileSettings()`.
   * @param {Record<string, {boughtAt: string}>} purchases - Purchases of the account.
   * @returns {number} The number of usable slots.
   */
  static countOwnedSlots(kind, settings, purchases) {
    const normalized = FeatureManager.slotKind(kind);
    const base = normalized === PROFILE_SLOT_KINDS.FAVORITES
      ? settings.defaultFavorites
      : settings.defaultFeaturedTrophies;
    const max = normalized === PROFILE_SLOT_KINDS.FAVORITES
      ? settings.maxFavorites
      : settings.maxFeaturedTrophies;
    let count = Math.min(Math.max(0, base), max);
    while (count < max && purchases?.[FeatureManager.slotFeatureId(normalized, count + 1)]) {
      count += 1;
    }
    return count;
  }

  /**
   * Reads the state of one list of the profile: its free slots, its purchased ones and the next
   * slot that can be bought.
   *
   * @param {string} kind - `PROFILE_SLOT_KINDS` member.
   * @returns {Promise<{kind: string, owned: number, base: number, max: number,
   *   next: {slot: number, priceSparks: number}|null, prices: Record<number, number>}>} The state.
   * @throws {TypeError} When the kind is unknown.
   * @throws {Error} When the configuration or the purchases cannot be read.
   */
  async getSlotState(kind) {
    const normalized = FeatureManager.slotKind(kind);
    const [settings, purchases] = await Promise.all([
      configLoader.getProfileSettings(),
      this.getPurchases(),
    ]);
    const owned = FeatureManager.countOwnedSlots(normalized, settings, purchases);
    const base = normalized === PROFILE_SLOT_KINDS.FAVORITES
      ? settings.defaultFavorites
      : settings.defaultFeaturedTrophies;
    const max = normalized === PROFILE_SLOT_KINDS.FAVORITES
      ? settings.maxFavorites
      : settings.maxFeaturedTrophies;
    const prices = normalized === PROFILE_SLOT_KINDS.FAVORITES
      ? settings.favoriteSlotPrices
      : settings.featuredSlotPrices;
    const nextSlot = owned + 1;
    const nextPrice = prices[nextSlot];
    return {
      kind: normalized,
      owned,
      base,
      max,
      prices: { ...prices },
      next: owned < max && Number.isInteger(nextPrice)
        ? { slot: nextSlot, priceSparks: nextPrice }
        : null,
    };
  }

  /**
   * Buys the next slot of one list of the profile.
   *
   * Same transaction as every other feature: the Sparks and the purchase record are written
   * together, so a failure never charges for a slot the account does not get.
   *
   * @param {string} kind - `PROFILE_SLOT_KINDS` member.
   * @returns {Promise<{id: string, kind: string, slot: number, priceSparks: number, balance: number,
   *   alreadyOwned: boolean}>} The purchase result.
   * @throws {TypeError} When the kind is unknown.
   * @throws {FeatureError} With `SLOT_MAXED` when every slot is already owned, with `UNKNOWN` when
   *   the configuration declares no price for the next one, or with `INSUFFICIENT_SPARKS`.
   * @throws {Error} When the write fails.
   */
  async purchaseSlot(kind) {
    const state = await this.getSlotState(kind);
    if (!state.next) {
      throw new FeatureError(
        FEATURE_ERROR_CODES.SLOT_MAXED,
        `Every "${state.kind}" slot is already owned (${state.owned} / ${state.max}).`
      );
    }
    const id = FeatureManager.slotFeatureId(state.kind, state.next.slot);
    const result = await this.charge(id, state.next.priceSparks);
    if (result.alreadyOwned) {
      this.log(`Slot "${id}" is already owned: nothing was charged.`);
      return { id, kind: state.kind, slot: state.next.slot, ...result };
    }

    this.log(
      `Bought "${state.kind}" slot ${state.next.slot} for ${result.priceSparks} Sparks ` +
        `(balance: ${result.balance}).`
    );
    this.publish(result.balance, {
      id,
      slotKind: state.kind,
      slot: state.next.slot,
      priceSparks: result.priceSparks,
    });
    return { id, kind: state.kind, slot: state.next.slot, ...result };
  }

  /**
   * Reads the catalogue of purchasable title colours.
   *
   * @returns {Promise<{items: Record<string, number>}>} One price per colour, in Sparks.
   * @throws {Error} When `settings/colors.json` cannot be read.
   */
  async getTitleColors() {
    const colors = await colorManager.listColors();
    return { items: Object.fromEntries(colors.map((entry) => [entry.id, entry.titlePrice])) };
  }

  /**
   * Reads the catalogue of purchasable pseudo colours.
   *
   * @returns {Promise<{items: Record<string, number>}>} One price per colour, in Sparks.
   * @throws {Error} When `settings/colors.json` cannot be read.
   */
  async getUsernameColors() {
    const colors = await colorManager.listColors();
    return { items: Object.fromEntries(colors.map((entry) => [entry.id, entry.usernamePrice])) };
  }

  /**
   * Price of one title colour.
   *
   * @param {string} colorId - Colour id.
   * @returns {Promise<number>} Its price in Sparks.
   * @throws {FeatureError} With `UNKNOWN` when the palette does not declare it.
   * @throws {Error} When the configuration cannot be read.
   */
  async getTitleColorPrice(colorId) {
    const catalog = await this.getTitleColors();
    const price = catalog.items[colorId];
    if (!Number.isInteger(price) || price < 0) {
      throw new FeatureError(
        FEATURE_ERROR_CODES.UNKNOWN,
        `"${colorId}" is not a title colour (known: ${Object.keys(catalog.items).join(', ')}).`
      );
    }
    return price;
  }

  /**
   * Tells whether the account owns one title colour.
   *
   * @param {string} colorId - Colour id.
   * @returns {Promise<boolean>} True when it was bought.
   * @throws {Error} When the read fails.
   */
  async hasTitleColor(colorId) {
    return this.has(FeatureManager.titleColorFeatureId(colorId));
  }

  /**
   * Price of one pseudo colour.
   *
   * @param {string} colorId - Colour id.
   * @returns {Promise<number>} Its price in Sparks.
   * @throws {FeatureError} With `UNKNOWN` when the palette does not declare it.
   * @throws {Error} When the configuration cannot be read.
   */
  async getUsernameColorPrice(colorId) {
    const catalog = await this.getUsernameColors();
    const price = catalog.items[colorId];
    if (!Number.isInteger(price) || price < 0) {
      throw new FeatureError(
        FEATURE_ERROR_CODES.UNKNOWN,
        `"${colorId}" is not a username colour (known: ${Object.keys(catalog.items).join(', ')}).`
      );
    }
    return price;
  }

  /**
   * Tells whether the account owns one pseudo colour.
   *
   * @param {string} colorId - Colour id.
   * @returns {Promise<boolean>} True when it was bought.
   * @throws {Error} When the read fails.
   */
  async hasUsernameColor(colorId) {
    return this.has(FeatureManager.usernameColorFeatureId(colorId));
  }

  /**
   * Builds the purchase id of one paid avatar.
   *
   * The path of the icon is the identifier: the catalogue declares it, and a renamed entry is a
   * different avatar that has to be bought again.
   *
   * @param {string} file - Icon path as declared in `settings/default_profile_icons.json`.
   * @returns {string} The id written in `user_state["purchases"]`.
   */
  static profileIconFeatureId(file) {
    return `${PROFILE_ICON_FEATURE_PREFIX}${normalizeIconPath(file)}`;
  }

  /**
   * Price of one paid avatar.
   *
   * @param {string} file - Icon path.
   * @returns {Promise<number>} Its price in Sparks.
   * @throws {FeatureError} With `UNKNOWN` when the icon is not a declared default icon or is free.
   * @throws {Error} When the catalogue cannot be read.
   */
  async getProfileIconPrice(file) {
    const catalog = await profileIconManager.loadCatalog();
    const path = normalizeIconPath(file);
    const entry = catalog.default.find((icon) => icon.file === path);
    if (!entry || !Number.isInteger(entry.price) || entry.price <= 0) {
      throw new FeatureError(
        FEATURE_ERROR_CODES.UNKNOWN,
        `"${path}" is not a paid profile icon.`
      );
    }
    return entry.price;
  }

  /**
   * Tells whether the account bought one paid avatar.
   *
   * @param {string} file - Icon path.
   * @returns {Promise<boolean>} True when it was bought.
   * @throws {Error} When the read fails.
   */
  async hasProfileIcon(file) {
    return this.has(FeatureManager.profileIconFeatureId(file));
  }

  /**
   * Buys one paid avatar.
   *
   * Same transaction and the same `purchases` map as every other capability; the price is read from
   * the icon catalogue, never from the caller.
   *
   * @param {string} file - Icon path.
   * @returns {Promise<{id: string, file: string, priceSparks: number, balance: number,
   *   alreadyOwned: boolean}>} The purchase result.
   * @throws {TypeError} When `file` is not a non-empty string.
   * @throws {FeatureError} With `UNKNOWN` when the catalogue does not declare the icon, or with
   *   `INSUFFICIENT_SPARKS` when the balance does not cover the price.
   * @throws {Error} When the write fails.
   */
  async purchaseProfileIcon(file) {
    if (typeof file !== 'string' || file.trim() === '') {
      throw new TypeError('FeatureManager.purchaseProfileIcon requires an icon path.');
    }
    const path = normalizeIconPath(file);
    const priceSparks = await this.getProfileIconPrice(path);
    const id = FeatureManager.profileIconFeatureId(path);
    const result = await this.charge(id, priceSparks);
    if (result.alreadyOwned) {
      this.log(`Profile icon "${path}" is already owned: nothing was charged.`);
      return { id, file: path, ...result };
    }

    this.log(
      `Bought profile icon "${path}" for ${result.priceSparks} Sparks (balance: ${result.balance}).`
    );
    this.publish(result.balance, { id, file: path, priceSparks: result.priceSparks });
    return { id, file: path, ...result };
  }

  /**
   * Normalizes the raw `user_state["purchases"]` value.
   *
   * Anything else than a plain object reads as "nothing was ever bought", and an entry without a
   * usable date is kept with an empty one: the purchase itself is what matters, a save written by
   * another version must not lose a feature the player paid for.
   *
   * @param {unknown} raw - Stored value.
   * @returns {Record<string, {boughtAt: string}>} The purchases.
   */
  static normalizePurchases(raw) {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const purchases = {};
    Object.entries(source).forEach(([id, entry]) => {
      if (typeof id !== 'string' || id === '' || id.startsWith('_')) return;
      const record = entry && typeof entry === 'object' ? entry : {};
      purchases[id] = { boughtAt: typeof record.boughtAt === 'string' ? record.boughtAt : '' };
    });
    return purchases;
  }

  /**
   * Reads every feature the account owns.
   *
   * @returns {Promise<Record<string, {boughtAt: string}>>} The purchases, keyed by feature id.
   * @throws {Error} When the read fails.
   */
  async getPurchases() {
    return FeatureManager.normalizePurchases(
      await storageRepository.getUserState(USER_STATE_KEYS.PURCHASES)
    );
  }

  /**
   * Tells whether the account owns one feature.
   *
   * @param {string} id - Feature identifier.
   * @returns {Promise<boolean>} True when it was bought.
   * @throws {Error} When the read fails.
   */
  async has(id) {
    const purchases = await this.getPurchases();
    return Object.prototype.hasOwnProperty.call(purchases, id);
  }

  /**
   * Buys one feature.
   *
   * The whole flow runs in a single `user_state` transaction: the price is charged, the purchase is
   * recorded, and only then is the event published. Buying something already owned is NOT an error:
   * it simply costs nothing and is reported as `alreadyOwned`, which is what makes a double click
   * harmless.
   *
   * @param {string} id - Feature identifier (`FEATURES`).
   * @returns {Promise<{id: string, priceSparks: number, balance: number, alreadyOwned: boolean}>} The
   *   purchase result: what was paid and the resulting balance.
   * @throws {TypeError} When `id` is not a non-empty string.
   * @throws {FeatureError} With `UNKNOWN` when the feature does not exist, or with
   *   `INSUFFICIENT_SPARKS` when the balance does not cover the price.
   * @throws {Error} When the write fails.
   */
  async purchase(id) {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new TypeError('FeatureManager.purchase requires a feature identifier.');
    }
    const priceSparks = await this.getPrice(id);
    const result = await this.charge(id, priceSparks);
    if (result.alreadyOwned) {
      this.log(`"${id}" is already owned: nothing was charged.`);
      return { id, ...result };
    }

    this.log(`Bought "${id}" for ${result.priceSparks} Sparks (balance: ${result.balance}).`);
    this.publish(result.balance, { id, priceSparks: result.priceSparks });
    return { id, ...result };
  }

  /**
   * Buys one title colour of the profile card.
   *
   * Same contract as `purchase()`, with two differences: the price comes from the colour catalogue
   * (`settings/colors.json`, `titlePrice`) and the purchase is recorded under the
   * prefixed id, so colours and features share one map without ever colliding.
   *
   * @param {string} colorId - Colour id (`gold`, `emerald`…).
   * @returns {Promise<{id: string, colorId: string, priceSparks: number, balance: number,
   *   alreadyOwned: boolean}>} The purchase result: what was paid and the resulting balance.
   * @throws {TypeError} When `colorId` is not a non-empty string.
   * @throws {FeatureError} With `UNKNOWN` when the palette does not declare the colour, or with
   *   `INSUFFICIENT_SPARKS` when the balance does not cover the price.
   * @throws {Error} When the write fails.
   */
  async purchaseTitleColor(colorId) {
    if (typeof colorId !== 'string' || colorId.trim() === '') {
      throw new TypeError('FeatureManager.purchaseTitleColor requires a colour identifier.');
    }
    const priceSparks = await this.getTitleColorPrice(colorId);
    const id = FeatureManager.titleColorFeatureId(colorId);
    const result = await this.charge(id, priceSparks);
    if (result.alreadyOwned) {
      this.log(`Title colour "${colorId}" is already owned: nothing was charged.`);
      return { id, colorId, ...result };
    }

    this.log(
      `Bought title colour "${colorId}" for ${result.priceSparks} Sparks (balance: ${result.balance}).`
    );
    this.publish(result.balance, { id, colorId, priceSparks: result.priceSparks });
    return { id, colorId, ...result };
  }

  /**
   * Buys one pseudo colour.
   *
   * Same contract as `purchaseTitleColor()`, under the `usernameColor.` prefix: the two uses of
   * the palette are bought separately, so a player can own the colour of one line only.
   *
   * @param {string} colorId - Colour id (`gold`, `emerald`…).
   * @returns {Promise<{id: string, colorId: string, priceSparks: number, balance: number,
   *   alreadyOwned: boolean}>} The purchase result: what was paid and the resulting balance.
   * @throws {TypeError} When `colorId` is not a non-empty string.
   * @throws {FeatureError} With `UNKNOWN` when the palette does not declare the colour, or with
   *   `INSUFFICIENT_SPARKS` when the balance does not cover the price.
   * @throws {Error} When the write fails.
   */
  async purchaseUsernameColor(colorId) {
    if (typeof colorId !== 'string' || colorId.trim() === '') {
      throw new TypeError('FeatureManager.purchaseUsernameColor requires a colour identifier.');
    }
    const priceSparks = await this.getUsernameColorPrice(colorId);
    const id = FeatureManager.usernameColorFeatureId(colorId);
    const result = await this.charge(id, priceSparks);
    if (result.alreadyOwned) {
      this.log(`Username colour "${colorId}" is already owned: nothing was charged.`);
      return { id, colorId, ...result };
    }

    this.log(
      `Bought username colour "${colorId}" for ${result.priceSparks} Sparks (balance: ${result.balance}).`
    );
    this.publish(result.balance, { id, colorId, priceSparks: result.priceSparks });
    return { id, colorId, ...result };
  }

  /**
   * Debits the price of one purchase and records it, atomically.
   *
   * Shared by every catalogue (features, title colours and pseudo colours): only the price lookup differs, the
   * money part must not exist twice. A purchase that fails, for any reason, leaves no trace.
   *
   * @param {string} id - Identifier written in `user_state["purchases"]`.
   * @param {number} priceSparks - Price to charge, in Sparks.
   * @returns {Promise<{priceSparks: number, balance: number, alreadyOwned: boolean}>} The outcome.
   * @throws {FeatureError} With `INSUFFICIENT_SPARKS` when the balance does not cover the price.
   * @throws {Error} When the write fails.
   */
  async charge(id, priceSparks) {
    const timestamp = new Date().toISOString();

    const result = await storageRepository.transaction(STORES.USER_STATE, 'readwrite', async (context) => {
      const stored = FeatureManager.normalizePurchases(
        await context.get(STORES.USER_STATE, USER_STATE_KEYS.PURCHASES)
      );
      if (Object.prototype.hasOwnProperty.call(stored, id)) {
        // Re-read INSIDE the transaction: two tabs (or two fast clicks) can race, and the second
        // one must not be charged twice.
        const owned = sparksManager.normalizeBalance(
          await context.get(STORES.USER_STATE, USER_STATE_KEYS.SPARKS)
        );
        return { alreadyOwned: true, balance: owned, priceSparks };
      }

      const balance = priceSparks > 0
        ? await sparksManager.applyDelta(context, -priceSparks)
        : sparksManager.normalizeBalance(
            await context.get(STORES.USER_STATE, USER_STATE_KEYS.SPARKS)
          );
      await context.put(
        STORES.USER_STATE,
        { ...stored, [id]: { boughtAt: timestamp } },
        USER_STATE_KEYS.PURCHASES
      );
      return { alreadyOwned: false, balance, priceSparks };
    });
    return result;
  }

  /**
   * Publishes the balance and the unlock of a successful purchase.
   *
   * The transaction owns the write, so the events are emitted here, once it has committed, like
   * every other flow that writes several values atomically.
   *
   * @param {number} balance - Resulting balance, in Sparks.
   * @param {{id: string, colorId?: string, slotKind?: string, slot?: number,
   *   priceSparks: number}} payload - What was bought.
   * @returns {void}
   */
  publish(balance, payload) {
    eventBus.emit(EVENTS.SPARKS_UPDATED, { balance });
    eventBus.emit(EVENTS.FEATURE_UNLOCKED, {
      id: payload.id,
      colorId: payload.colorId ?? null,
      slotKind: payload.slotKind ?? null,
      slot: payload.slot ?? null,
      priceSparks: payload.priceSparks,
      balance,
    });
  }
}

/** Shared instance used by the profile card (and every feature locked behind a purchase). */
export const featureManager = new FeatureManager();

export default featureManager;

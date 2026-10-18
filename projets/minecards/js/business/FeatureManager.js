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
 * from their own catalogue (`profileCard.titleColors`). They still share the ONE purchases map, so
 * "what did this player pay for?" stays a single small object: the prefix is what tells a colour
 * apart from a feature, and it is the only place that knows how they are written.
 */
export const TITLE_COLOR_FEATURE_PREFIX = 'cardTitleColor.';

/** Machine-readable reasons a purchase was refused. */
export const FEATURE_ERROR_CODES = Object.freeze({
  UNKNOWN: 'unknownFeature',
  INSUFFICIENT_SPARKS: 'insufficientSparks',
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
   * Reads the catalogue of purchasable title colours.
   *
   * @returns {Promise<{defaultPriceSparks: number, items: Record<string, number>}>} One price per
   *   colour, in Sparks.
   * @throws {Error} When `settings/config.json` cannot be read.
   */
  async getTitleColors() {
    return configLoader.getTitleColorSettings();
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
   * (`profileCard.titleColors`, 125 Sparks by default) and the purchase is recorded under the
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
   * Debits the price of one purchase and records it, atomically.
   *
   * Shared by every catalogue (features and title colours): only the price lookup differs, the
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
   * @param {{id: string, colorId?: string, priceSparks: number}} payload - What was bought.
   * @returns {void}
   */
  publish(balance, payload) {
    eventBus.emit(EVENTS.SPARKS_UPDATED, { balance });
    eventBus.emit(EVENTS.FEATURE_UNLOCKED, {
      id: payload.id,
      colorId: payload.colorId ?? null,
      priceSparks: payload.priceSparks,
      balance,
    });
  }
}

/** Shared instance used by the profile card (and every feature locked behind a purchase). */
export const featureManager = new FeatureManager();

export default featureManager;

/**
 * AccountValueManager - The Spark-equivalent value of an account.
 *
 * Reference: `js/business/ProfileCardManager.js` (the only caller today), `js/business/
 * CollectionManager.js` (collection entries), `js/business/SparksManager.js` (Sparks and card
 * sale prices), `js/business/MiningManager.js` (mined resources and block bundles),
 * `js/business/IllagerShopManager.js` (custom currencies), `js/business/DateSyncManager.js`
 * (bonus boosters), `js/business/FeatureManager.js` (bought profile customisations) and
 * `settings/config.json` (shop prices, feature prices and resource values).
 *
 * THE FORMULA (always in Spark-equivalent units)
 *   total = Sparks
 *         + Σ owned copy × its sale price (promo cards use their fixed 10-Spark sale price)
 *         + Σ distinct owned card × rarity³ × 10
 *         + level × 10
 *         + Σ mined resource quantity × its Wandering Trader value
 *         + Σ custom currency balance × 25
 *         + Σ bonus booster × the booster shop price
 *         + block bundles × the block-bundle shop price
 *         + Σ purchased profile customisation × its current price in Sparks
 *
 * WHY EACH TERM
 *   - Sparks are already the unit of the result.
 *   - Every COPY in the collection is worth what selling it would credit, not what buying it
 *     costs: the value describes the collection's liquidation value. A promo is worth its fixed
 *     duplicate price, exactly as `SparksManager.sellCard()` charges.
 *   - Every DISTINCT card adds its rarity cubed, multiplied by 10 (1 → 10, 5 → 1,250,
 *     6 → 2,160): rarity is the collection's progression axis, while the sale value above already
 *     covers duplicate copies.
 *   - The player level is progression that cannot be bought, hence a flat 10 per level.
 *   - Mined resources use the same `shop.itemsValues` map as the Wandering Trader, so their
 *     value here is the value the game already gives them.
 *   - Every custom currency (Illager Shop) is worth 25 per unit: no currency has an individual
 *     exchange rate for this indicator, so the same weight is used for all of them.
 *   - Bonus boosters and block bundles are valued at their CURRENT shop price, not at a price
 *     remembered at purchase time.
 *   - Bought profile customisations (Full Art, title/pseudo/frame colours, paid avatars, avatar
 *     sizes and anchors, extra favourite and featured slots) are part of the account: each one is
 *     worth its price in Sparks, one Spark for one point. The purchase record does not store the
 *     price, so the CURRENT catalogue price is used, like the boosters and the bundles above.
 *
 * The result is an INDICATOR, never a balance: nothing is credited, spent or persisted. A
 * missing or malformed source contributes zero rather than failing the profile card.
 *
 * DISPLAY
 *   The card labels the result "Points". Below one million the number keeps its usual digits;
 *   from one million it is abbreviated with two TRUNCATED decimals so it always stays on one
 *   short line: `1.43 M`, then `1.43 Md` in French / `1.43 B` in English for billions.
 */

import { configLoader } from '../utils/ConfigLoader.js';
import sparksManager, { PROMO_SELL_PRICE } from './SparksManager.js';
import miningManager from './MiningManager.js';
import illagerShopManager from './IllagerShopManager.js';
import dateSyncManager from './DateSyncManager.js';
import { colorManager } from './ColorManager.js';
import profileIconManager from './ProfileIconManager.js';
import featureManager, {
  BORDER_COLOR_FEATURE_PREFIX,
  FAVORITE_SLOT_FEATURE_PREFIX,
  FEATURED_SLOT_FEATURE_PREFIX,
  PROFILE_ICON_FEATURE_PREFIX,
  TITLE_COLOR_FEATURE_PREFIX,
  USERNAME_COLOR_FEATURE_PREFIX,
} from './FeatureManager.js';

/** Flat weights of the parts of the formula that are not read from a price table. */
export const ACCOUNT_VALUE_RULES = Object.freeze({
  level: 10,
  customCurrency: 25,
  distinctCard: 10,
  maxRarity: 6,
});

/**
 * Reads a non-negative integer from a stored/configuration value.
 *
 * @param {unknown} value - Raw value.
 * @returns {number} The normalized amount (0 when unusable).
 */
function amountOf(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : 0;
}

/** Shared account-value calculator. */
export class AccountValueManager {
  /**
   * Values the owned copies of the collection at their sale price.
   *
   * A card's sale price depends on its rarity, except for a promo: the game sells every duplicate
   * promo for the same fixed price (`PROMO_SELL_PRICE`), whatever its rarity. The last copy cannot
   * actually be sold, but it is still part of the collection's value.
   *
   * @param {object[]} entries - Collection entries (`CollectionManager.getCollectionView().entries`).
   * @param {Record<string, number>} sellPrice - `sparks.sellPrice` by rarity.
   * @returns {number} The total sale value of every owned copy.
   */
  static cardSaleValue(entries, sellPrice) {
    if (!Array.isArray(entries)) return 0;
    return entries.reduce((total, entry) => {
      if (!entry?.owned) return total;
      const quantity = amountOf(entry.quantity);
      if (quantity === 0) return total;
      const rarity = Math.trunc(Number(entry.rarity));
      const catalogPrice = Number.isFinite(sellPrice?.[String(rarity)])
        ? Math.max(0, sellPrice[String(rarity)])
        : 0;
      const price = entry.promo === true ? PROMO_SELL_PRICE : catalogPrice;
      return total + quantity * price;
    }, 0);
  }

  /**
   * Adds the rarity cubed × 10 of every DISTINCT owned card.
   *
   * The collection view holds one entry per printing, so this is one term per distinct card. A
   * missing or out-of-range rarity contributes nothing.
   *
   * @param {object[]} entries - Collection entries.
   * @returns {number} The rarity-cubed total, multiplied by 10.
   */
  static distinctRarityValue(entries) {
    if (!Array.isArray(entries)) return 0;
    return entries.reduce((total, entry) => {
      if (!entry?.owned) return total;
      const rarity = Math.trunc(Number(entry.rarity));
      if (!Number.isInteger(rarity) || rarity < 1 || rarity > ACCOUNT_VALUE_RULES.maxRarity) {
        return total;
      }
      return total + rarity * rarity * rarity * ACCOUNT_VALUE_RULES.distinctCard;
    }, 0);
  }

  /**
   * Values the harvested resources with the Wandering Trader's value map.
   *
   * The mined state is keyed by resource slug (`stone_dust`), while the configuration is keyed by
   * the resource's display type (`Stone Dust`): `resourceTypes` is the bridge built from
   * `MiningManager.listResources()`.
   *
   * @param {Record<string, number>} resources - `mining.resources`, keyed by slug.
   * @param {Map<string, string>} resourceTypes - Slug -> configured resource type.
   * @param {Record<string, number>} itemsValues - `shop.itemsValues`, keyed by resource type.
   * @returns {number} The total value of the harvested resources.
   */
  static resourceValue(resources, resourceTypes, itemsValues) {
    if (!resources || typeof resources !== 'object') return 0;
    let total = 0;
    Object.entries(resources).forEach(([slug, rawQuantity]) => {
      const quantity = amountOf(rawQuantity);
      const type = resourceTypes.get(slug);
      if (quantity === 0 || !type) return;
      const unitValue = Number(itemsValues?.[type]);
      if (Number.isFinite(unitValue) && unitValue > 0) total += quantity * unitValue;
    });
    return total;
  }

  /**
   * Values every custom currency balance at the shared custom-currency weight.
   *
   * @param {Record<string, number>} balances - `illagerShop.balances`, keyed by currency id.
   * @returns {number} The custom-currency total.
   */
  static customCurrencyValue(balances) {
    if (!balances || typeof balances !== 'object') return 0;
    return Object.values(balances).reduce(
      (total, balance) => total + amountOf(balance) * ACCOUNT_VALUE_RULES.customCurrency,
      0
    );
  }

  /**
   * Values every profile customisation the account bought, at its price in Sparks (1:1).
   *
   * The purchases map only records WHAT was bought (with a date), never what it cost, so the
   * current catalogues are the source of truth. Every family of purchase is resolved by its id:
   *   - a plain feature id (`cardLayoutFullArt`, `profileIconLarge`...) -> `features[id]`;
   *   - `cardTitleColor.<id>` -> the colour's `titlePrice`;
   *   - `usernameColor.<id>` -> the colour's `usernamePrice`;
   *   - `cardBorderColor.<id>` -> the colour's `borderPrice`;
   *   - `profileIcon.<file>` -> the paid avatar's `price`;
   *   - `profileFavoriteSlot.<n>` / `profileFeaturedSlot.<n>` -> the slot price.
   *
   * An unknown or malformed purchase contributes zero, so an old or hand-edited save can never
   * invent points.
   *
   * @param {Record<string, {boughtAt: string}>} purchases - `FeatureManager.getPurchases()`.
   * @param {object} [catalogs] - Current price catalogues.
   * @param {Record<string, {priceSparks: number}>} [catalogs.features={}] - Feature prices.
   * @param {object[]} [catalogs.colors=[]] - `ColorManager.listColors()`.
   * @param {object[]} [catalogs.profileIcons=[]] - Default avatar entries of `ProfileIconManager`.
   * @param {Record<string, number>} [catalogs.favoriteSlotPrices={}] - Extra favourite slot prices.
   * @param {Record<string, number>} [catalogs.featuredSlotPrices={}] - Extra featured slot prices.
   * @returns {number} The total value of the bought customisations, in points.
   */
  static profileCustomizationValue(purchases, {
    features = {},
    colors = [],
    profileIcons = [],
    favoriteSlotPrices = {},
    featuredSlotPrices = {},
  } = {}) {
    if (!purchases || typeof purchases !== 'object' || Array.isArray(purchases)) return 0;
    const colorsById = new Map(
      (Array.isArray(colors) ? colors : []).map((entry) => [entry.id, entry])
    );
    const iconsByFile = new Map(
      (Array.isArray(profileIcons) ? profileIcons : []).map((entry) => [entry.file, entry])
    );

    return Object.keys(purchases).reduce((total, id) => {
      let price = 0;
      if (Object.prototype.hasOwnProperty.call(features, id)) {
        price = amountOf(features[id]?.priceSparks);
      } else if (id.startsWith(TITLE_COLOR_FEATURE_PREFIX)) {
        const color = colorsById.get(id.slice(TITLE_COLOR_FEATURE_PREFIX.length));
        price = amountOf(color?.titlePrice);
      } else if (id.startsWith(USERNAME_COLOR_FEATURE_PREFIX)) {
        const color = colorsById.get(id.slice(USERNAME_COLOR_FEATURE_PREFIX.length));
        price = amountOf(color?.usernamePrice);
      } else if (id.startsWith(BORDER_COLOR_FEATURE_PREFIX)) {
        const color = colorsById.get(id.slice(BORDER_COLOR_FEATURE_PREFIX.length));
        price = amountOf(color?.borderPrice);
      } else if (id.startsWith(PROFILE_ICON_FEATURE_PREFIX)) {
        const icon = iconsByFile.get(id.slice(PROFILE_ICON_FEATURE_PREFIX.length));
        price = amountOf(icon?.price);
      } else if (id.startsWith(FAVORITE_SLOT_FEATURE_PREFIX)) {
        const slot = id.slice(FAVORITE_SLOT_FEATURE_PREFIX.length);
        price = amountOf(favoriteSlotPrices?.[slot]);
      } else if (id.startsWith(FEATURED_SLOT_FEATURE_PREFIX)) {
        const slot = id.slice(FEATURED_SLOT_FEATURE_PREFIX.length);
        price = amountOf(featuredSlotPrices?.[slot]);
      }
      return total + price;
    }, 0);
  }

  /**
   * Builds the complete account value and its breakdown.
   *
   * The level is read from the caller's trophy state through `ProfileCardManager.build()`, which
   * avoids evaluating the trophies a second time. A missing level falls back to 1, the default of
   * a fresh account.
   *
   * @param {object} [options] - Calculation options.
   * @param {object[]} [options.entries=[]] - Collection entries.
   * @param {number} [options.level=1] - Current player level.
   * @returns {Promise<{total: number, sparks: number, cardSaleValue: number,
   *   distinctRarityValue: number, levelValue: number, resourceValue: number,
   *   customCurrencyValue: number, bonusBoosterValue: number, bundleValue: number,
   *   profileCustomizationValue: number, bonusBoosters: number, bundles: number}>}
   *   The value and every term of the formula.
   * @throws {Error} When one of the account sources cannot be read.
   */
  async build({ entries = [], level = 1 } = {}) {
    const [
      sparks,
      prices,
      mining,
      resources,
      shop,
      boosters,
      miningSettings,
      shopState,
      purchases,
      featureSettings,
      profileSettings,
      colorCatalog,
      iconCatalog,
    ] = await Promise.all([
      sparksManager.getBalance(),
      sparksManager.getPrices(),
      miningManager.getState(),
      miningManager.listResources(),
      configLoader.getShopSettings(),
      configLoader.getBoosterSettings(),
      configLoader.getMiningSettings(),
      illagerShopManager.readState(),
      featureManager.getPurchases(),
      configLoader.getFeatureSettings(),
      configLoader.getProfileSettings(),
      colorManager.listColors(),
      profileIconManager.loadCatalog(),
    ]);

    const resourceTypes = new Map(
      (Array.isArray(resources) ? resources : []).map((resource) => [resource.slug, resource.type])
    );
    const quota = dateSyncManager.getQuotaSnapshot();
    const bonusBoosters = amountOf(quota?.bonusTotal);
    const bundles = amountOf(mining?.bundles);
    const levelValue = Math.max(1, amountOf(level)) * ACCOUNT_VALUE_RULES.level;
    const boosterPrice = amountOf(boosters?.extraBoosterPriceSparks);
    const bundlePrice = amountOf(miningSettings?.bundlePriceSparks);
    const values = {
      sparks,
      cardSaleValue: AccountValueManager.cardSaleValue(entries, prices?.sellPrice),
      distinctRarityValue: AccountValueManager.distinctRarityValue(entries),
      levelValue,
      resourceValue: AccountValueManager.resourceValue(
        mining?.resources,
        resourceTypes,
        shop?.itemsValues
      ),
      customCurrencyValue: AccountValueManager.customCurrencyValue(shopState?.balances),
      bonusBoosterValue: bonusBoosters * boosterPrice,
      bundleValue: bundles * bundlePrice,
      profileCustomizationValue: AccountValueManager.profileCustomizationValue(purchases, {
        features: featureSettings?.items,
        colors: colorCatalog,
        profileIcons: iconCatalog?.default,
        favoriteSlotPrices: profileSettings?.favoriteSlotPrices,
        featuredSlotPrices: profileSettings?.featuredSlotPrices,
      }),
      bonusBoosters,
      bundles,
    };
    return {
      ...values,
      total: Object.entries(values)
        .filter(([key]) => key !== 'bonusBoosters' && key !== 'bundles')
        .reduce((total, [, value]) => total + value, 0),
    };
  }
}

/**
 * Formats an account value for the compact line of the profile card.
 *
 * The decimals are TRUNCATED, not rounded: the documented example 1,435,789 must read `1.43 M`.
 * The suffix is `M` for millions and `Md` (French) / `B` (English) for billions.
 *
 * @param {number} value - Account value in points.
 * @param {string} [lang='fr'] - Active language (`fr` or `en`).
 * @returns {string} The compact label value, without the "Points" prefix.
 */
export function formatAccountValue(value, lang = 'fr') {
  const amount = Number.isFinite(value) ? Math.max(0, value) : 0;
  const isFrench = String(lang).toLowerCase().startsWith('fr');
  if (amount >= 1_000_000_000) {
    const billions = Math.floor((amount / 1_000_000_000) * 100) / 100;
    return `${billions.toFixed(2)} ${isFrench ? 'Md' : 'B'}`;
  }
  if (amount >= 1_000_000) {
    const millions = Math.floor((amount / 1_000_000) * 100) / 100;
    return `${millions.toFixed(2)} M`;
  }
  return Math.floor(amount).toLocaleString(isFrench ? 'fr' : 'en');
}

/** Shared instance used by the profile card. */
export const accountValueManager = new AccountValueManager();

export default accountValueManager;

/**
 * AccountValueManager - The Spark-equivalent value of an account.
 *
 * Reference: `js/business/ProfileCardManager.js` (the only caller today), `js/business/
 * CollectionManager.js` (collection entries), `js/business/SparksManager.js` (Sparks and card
 * sale prices), `js/business/MiningManager.js` (mined resources and block bundles),
 * `js/business/IllagerShopManager.js` (custom currencies), `js/business/DateSyncManager.js`
 * (bonus boosters) and `settings/config.json` (shop prices and resource values).
 *
 * THE FORMULA (always in Spark-equivalent units)
 *   total = Sparks
 *         + Σ owned copy × its sale price (promo cards use their fixed 10-Spark sale price)
 *         + Σ distinct owned card × rarity²
 *         + level × 10
 *         + Σ mined resource quantity × its Wandering Trader value
 *         + Σ custom currency balance × 25
 *         + Σ bonus booster × the booster shop price
 *         + block bundles × the block-bundle shop price
 *
 * WHY EACH TERM
 *   - Sparks are already the unit of the result.
 *   - Every COPY in the collection is worth what selling it would credit, not what buying it
 *     costs: the value describes the collection's liquidation value. A promo is worth its fixed
 *     duplicate price, exactly as `SparksManager.sellCard()` charges.
 *   - Every DISTINCT card adds its rarity squared (1 → 1, 5 → 25): rarity is the collection's
 *     progression axis, while the sale value above already covers duplicate copies.
 *   - The player level is progression that cannot be bought, hence a flat 10 per level.
 *   - Mined resources use the same `shop.itemsValues` map as the Wandering Trader, so their
 *     value here is the value the game already gives them.
 *   - Every custom currency (Illager Shop) is worth 25 per unit: no currency has an individual
 *     exchange rate for this indicator, so the same weight is used for all of them.
 *   - Bonus boosters and block bundles are valued at their CURRENT shop price, not at a price
 *     remembered at purchase time.
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

/** Flat weights of the parts of the formula that are not read from a price table. */
export const ACCOUNT_VALUE_RULES = Object.freeze({
  level: 10,
  customCurrency: 25,
  maxRarity: 5,
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
   * Adds the rarity squared of every DISTINCT owned card.
   *
   * The collection view holds one entry per printing, so this is one term per distinct card. A
   * missing or out-of-range rarity contributes nothing.
   *
   * @param {object[]} entries - Collection entries.
   * @returns {number} The rarity-squared total.
   */
  static distinctRarityValue(entries) {
    if (!Array.isArray(entries)) return 0;
    return entries.reduce((total, entry) => {
      if (!entry?.owned) return total;
      const rarity = Math.trunc(Number(entry.rarity));
      if (!Number.isInteger(rarity) || rarity < 1 || rarity > ACCOUNT_VALUE_RULES.maxRarity) {
        return total;
      }
      return total + rarity * rarity;
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
   *   bonusBoosters: number, bundles: number}>} The value and every term of the formula.
   * @throws {Error} When one of the account sources cannot be read.
   */
  async build({ entries = [], level = 1 } = {}) {
    const [sparks, prices, mining, resources, shop, boosters, miningSettings, shopState] =
      await Promise.all([
        sparksManager.getBalance(),
        sparksManager.getPrices(),
        miningManager.getState(),
        miningManager.listResources(),
        configLoader.getShopSettings(),
        configLoader.getBoosterSettings(),
        configLoader.getMiningSettings(),
        illagerShopManager.readState(),
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

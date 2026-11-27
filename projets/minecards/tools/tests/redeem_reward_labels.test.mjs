/**
 * Promo code reward labels - one sentence per reward type, in both surfaces that announce a code.
 *
 * A code credits Sparks, an Ender Pearl, a bundle, a mining resource, an Illager currency, days of
 * connection rewards or a bonus booster. `RedeemView` (confirmation modal) and `AutoClaimPopup`
 * (gift dialog) describe it from its `type`, so a type added later must land on its own branch: the
 * last test makes sure it reads as unknown instead of being announced as a booster.
 *
 * The dictionaries are read from `settings/i18n/*.json` and installed directly, because
 * `I18n.init()` fetches them and a Node test cannot. The currency name is written into the manager
 * for the same reason (`IllagerShopManager.init()` reads a data file), so this test never depends on
 * a load finishing.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { readText } from '../lint/lib/repo.mjs';
import i18n from '../../js/utils/I18n.js';
import illagerShopManager from '../../js/business/IllagerShopManager.js';
import { RedeemView } from '../../js/UI/views/RedeemView.js';
import { AutoClaimPopup } from '../../js/UI/components/AutoClaimPopup.js';

for (const lang of ['fr', 'en']) {
  i18n.translations.set(lang, JSON.parse(readText(`settings/i18n/${lang}.json`)));
}
i18n.lang = 'fr';
i18n.defaultLang = 'fr';

/** Currency of the shipped codes, and the name the Illager Shop data gives it. */
const CURRENCY_ID = 'AllaysCurrency';
const CURRENCY_NAME = "Allay's Sparks";
illagerShopManager.currencies = [{ id: CURRENCY_ID, name: CURRENCY_NAME }];

/**
 * Rewards of a code, one per type, with the `key` the manager writes on them.
 *
 * `unknown` stands for a type no view knows yet: it must not read as a booster.
 */
const REWARDS = Object.freeze({
  sparks: { type: 'sparks', key: 'sparks', quantity: 150 },
  pearl: { type: 'pearl', key: 'pearl', quantity: 2 },
  bundle: { type: 'bundle', key: 'bundle', quantity: 3 },
  resource: { type: 'resource', key: 'stone_dust', quantity: 40 },
  currency: { type: 'currency', key: CURRENCY_ID, quantity: 3 },
  dailyreward: { type: 'dailyreward', key: 'dailyreward', quantity: 1 },
  booster: { type: 'booster', key: 'A1', quantity: 2 },
  unknown: { type: 'mystery', key: 'mystery', quantity: 5 },
});

/**
 * Builds the reward surface of `RedeemView` without its DOM.
 *
 * @returns {RedeemView} A view whose extension names are already resolved.
 */
function buildRedeemView() {
  const view = Object.create(RedeemView.prototype);
  view.setNames = new Map([['A1', 'Genesis Blocks']]);
  return view;
}

const redeemView = buildRedeemView();
const autoClaimPopup = Object.create(AutoClaimPopup.prototype);

const SURFACES = Object.freeze([
  ['RedeemView', (reward) => redeemView.describeReward(reward)],
  ['AutoClaimPopup', (reward) => autoClaimPopup.describeReward(reward)],
]);

/** Expected sentences of the confirmation modal. */
const REDEEM_EXPECTED = Object.freeze({
  fr: {
    sparks: '150 Sparks',
    pearl: "2 perle(s) de l'End",
    bundle: '3 bundle(s) de blocs',
    resource: '40 × Poussière de pierre',
    currency: "3 Allay's Sparks",
    dailyreward: 'Avance de 1 jour(s) les récompenses de connexion',
    booster: '2 booster(s) bonus (Genesis Blocks)',
    unknown: 'Élément inconnu : mystery',
  },
  en: {
    sparks: '150 Sparks',
    pearl: '2 Ender Pearl(s)',
    bundle: '3 block bundle(s)',
    resource: '40 × Stone Dust',
    currency: "3 Allay's Sparks",
    dailyreward: 'Advances the daily rewards by 1 day(s)',
    booster: '2 bonus booster(s) (Genesis Blocks)',
    unknown: 'Unknown item: mystery',
  },
});

/** Expected sentences of the gift dialog: it never names an extension, so no `(set)`. */
const AUTO_CLAIM_EXPECTED = Object.freeze({
  fr: { ...REDEEM_EXPECTED.fr, booster: '2 booster(s) bonus' },
  en: { ...REDEEM_EXPECTED.en, booster: '2 bonus booster(s)' },
});

for (const lang of ['fr', 'en']) {
  test(`the redeem modal describes every reward type of a code (${lang})`, () => {
    i18n.lang = lang;
    for (const [name, expected] of Object.entries(REDEEM_EXPECTED[lang])) {
      assert.equal(
        redeemView.describeReward(REWARDS[name]),
        expected,
        `RedeemView describes the ${name} reward as something else`
      );
    }
  });

  test(`the gift dialog describes every reward type of a code (${lang})`, () => {
    i18n.lang = lang;
    for (const [name, expected] of Object.entries(AUTO_CLAIM_EXPECTED[lang])) {
      assert.equal(
        autoClaimPopup.describeReward(REWARDS[name]),
        expected,
        `AutoClaimPopup describes the ${name} reward as something else`
      );
    }
  });
}

test('a reward type the views do not know is announced as unknown, never as a booster', () => {
  i18n.lang = 'fr';
  for (const [surface, describe] of SURFACES) {
    const text = describe(REWARDS.unknown);
    assert.match(text, /Élément inconnu : mystery/, `${surface} does not announce the unknown type`);
    assert.doesNotMatch(text, /booster/, `${surface} still falls back on the booster label`);
  }
});

test('the currency label uses the data name, and the id when no data was loaded', () => {
  i18n.lang = 'fr';
  const saved = illagerShopManager.currencies;
  try {
    illagerShopManager.currencies = [];
    for (const [surface, describe] of SURFACES) {
      assert.equal(
        describe(REWARDS.currency),
        `3 ${CURRENCY_ID}`,
        `${surface} does not fall back on the currency id`
      );
    }
  } finally {
    illagerShopManager.currencies = saved;
  }
});

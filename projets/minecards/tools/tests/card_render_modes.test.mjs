/**
 * Regression tests for the card render presets of `settings/cardrender.json`.
 *
 * The tested guarantees are:
 *   - the shipped file exposes one complete design per mode, with its own zooms;
 *   - the per-layout still scales of a preset are kept and every number is clamped;
 *   - an entry without an id is dropped, a duplicate keeps its first declaration;
 *   - a save written before the zooms were split keeps one amplitude on both layers.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { installFakeStorage } from './helpers/fake_storage.mjs';
import { AccountManager } from '../../js/business/AccountManager.js';
import { configLoader, ConfigLoader } from '../../js/utils/ConfigLoader.js';

installFakeStorage();

/** Validated `cardGenerate` block of the shipped configuration. */
let cardGenerateConfig;

test.before(async () => {
  // `AccountManager` pulls `I18n` in, which reads `navigator` at boot.
  if (typeof globalThis.navigator === 'undefined') {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { language: 'fr', languages: ['fr'] },
    });
  }
  const rawConfig = JSON.parse(
    await readFile(new URL('../../settings/config.json', import.meta.url), 'utf8')
  );
  configLoader.cachedConfig = configLoader.validate(rawConfig);
  cardGenerateConfig = await configLoader.getCardGenerateSettings();
});

test('the shipped presets are complete designs with separate zooms', async () => {
  const raw = JSON.parse(
    await readFile(new URL('../../settings/cardrender.json', import.meta.url), 'utf8')
  );
  const modes = ConfigLoader.normalizeCardRenderModes(raw);

  assert.equal(modes.length, raw.modes.length);
  const mode = modes.find((entry) => entry.id === 'dynamic');
  assert.ok(mode, 'the shipped preset keeps its id');
  assert.equal(mode.name.fr, 'Minecards dynamique');
  assert.equal(mode.name.en, 'Minecards dynamic');
  assert.equal(mode.requiresDeveloperMode, false);
  assert.equal(mode.animatedLayers, true);
  assert.equal(mode.speedPercent, 200);

  assert.equal(mode.design.animation.zoomBackground, 100);
  assert.equal(mode.design.animation.zoomUnderlay, 130);
  assert.deepEqual(mode.design.animation.still.background, { classic: 120, fullart: 110 });
  assert.deepEqual(mode.design.animation.still.underlay, { classic: 120, fullart: 120 });

  assert.equal(mode.design.animation.blur, 5);
  assert.equal(mode.design.construction.borderWidth, 4);
  assert.equal(mode.design.construction.headerHeight, 10);
  assert.equal(mode.design.construction.bodyHeight, 50);
  assert.equal(mode.design.construction.rarities[5].symbol, '💎');
  assert.equal(mode.design.construction.rarities[5].color, '#ff2a8d');
});

test('a hand-edited preset is clamped, completed and deduplicated', () => {
  const modes = ConfigLoader.normalizeCardRenderModes({
    modes: [
      { id: 'wild', requiresDeveloperMode: true, backgroundZoomPercent: 999, underlayZoomPercent: -4, blurPx: 99, borderWidth: 0, headerHeightPercent: 90, bodyHeightPercent: 1, animation: { classic: { stillBackgroundScalePercent: 999, stillUnderlayScalePercent: 101 } } },
      { id: 'wild', backgroundZoomPercent: 120 },
      { name: 'no id' },
      { id: '   ' },
      null,
    ],
  });

  assert.deepEqual(
    modes.map((entry) => entry.id),
    ['wild']
  );
  const [wild] = modes;
  assert.equal(wild.requiresDeveloperMode, true);
  assert.equal(wild.animatedLayers, false);

  assert.equal(wild.design.animation.zoomBackground, 150);
  assert.equal(wild.design.animation.zoomUnderlay, 100);
  assert.equal(wild.design.animation.blur, 5);
  assert.equal(wild.design.construction.borderWidth, 1);
  assert.equal(wild.design.construction.headerHeight, 20);
  assert.equal(wild.design.construction.bodyHeight, 30);

  assert.deepEqual(wild.design.animation.still.background, { classic: 150, fullart: 100 });
  assert.deepEqual(wild.design.animation.still.underlay, { classic: 101, fullart: 100 });

  // A preset that overrides a rarity keeps the others from the shipped design.
  const rarities = ConfigLoader.normalizeCardRenderModes([
    { id: 'one', rarities: [{ tier: 3, borderColor: '#ABC', accentColor: 'nope' }] },
  ])[0].design.construction.rarities;
  assert.equal(rarities[3].color, '#aabbcc');
  assert.equal(rarities[3].accent, '#c084fc');
  assert.equal(rarities[1].color, '#4a4a5a');
});

test('a bare array is still read and a single name is used for both languages', () => {
  const modes = ConfigLoader.normalizeCardRenderModes([
    { id: ' Solo ', name: 'Solo mode' },
    { name: 'no id' },
  ]);

  assert.equal(modes.length, 1);
  assert.equal(modes[0].id, 'Solo');
  assert.deepEqual(modes[0].name, { fr: 'Solo mode', en: 'Solo mode' });
  assert.equal(modes[0].requiresDeveloperMode, false);
});

test('a configuration with a single zoom block feeds both ranges', () => {
  const config = ConfigLoader.normalizeCardGenerateSettings({
    animation: { zoom: { min: 100, max: 140, step: 5, default: 120 } },
    construction: {},
  });

  assert.deepEqual(config.animation.zoom, { min: 100, max: 140, step: 5, default: 120 });
  assert.deepEqual(config.animation.zoomUnderlay, { min: 100, max: 140, step: 5, default: 120 });
  assert.equal(config.animation.stillScale.default, 100);
});

test('a save written before the zooms were split keeps one amplitude on both layers', () => {
  const legacy = AccountManager.sanitizeCardGenerateSettings(
    { animation: { zoom: 135 } },
    cardGenerateConfig
  );
  assert.equal(legacy.animation.zoomBackground, 135);
  assert.equal(legacy.animation.zoomUnderlay, 135);

  const split = AccountManager.sanitizeCardGenerateSettings(
    { animation: { zoom: 120, zoomUnderlay: 145 } },
    cardGenerateConfig
  );
  assert.equal(split.animation.zoomBackground, 120);
  assert.equal(split.animation.zoomUnderlay, 145);

  const fresh = AccountManager.sanitizeCardGenerateSettings(undefined, cardGenerateConfig);
  assert.equal(fresh.animation.zoomBackground, cardGenerateConfig.animation.zoom.default);
  assert.equal(
    fresh.animation.zoomUnderlay,
    cardGenerateConfig.animation.zoomUnderlay.default
  );
});

test('a single still scale applies to both layouts and both layers', () => {
  const stillDefault = cardGenerateConfig.animation.stillScale.default;
  const design = AccountManager.sanitizeCardGenerateSettings(
    { animation: { still: { background: 125, underlay: { fullart: 140 } } } },
    cardGenerateConfig
  );

  assert.deepEqual(design.animation.still.background, { classic: 125, fullart: 125 });
  assert.deepEqual(design.animation.still.underlay, { classic: stillDefault, fullart: 140 });
});

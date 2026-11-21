/**
 * CardGenerateManager - Runtime values of the generated-card module.
 *
 * The module is declared in `settings/config.json` under `cardGenerate`: one `animation` block
 * (per-layout layer switches, a zoom per layer, the scale each layer keeps while still, the blur
 * and the speed presets) and one `construction` block (frame geometry, per-rarity colours and
 * symbols). The account stores the values the player picked — by hand in the advanced panel, or by
 * choosing a preset of `settings/cardrender.json` — so a save carries a card design with it.
 *
 * WHY A MANAGER SEPARATE FROM CardSourceManager
 *   `<card-print>` needs the rarity symbols while it renders. Importing `CardSourceManager` there
 *   would create a cycle (that manager imports `CardPrint` to build the generated source). This
 *   module only holds the resolved values, publishes the colour and geometry custom properties on
 *   `<html>`, and answers `getRarityAppearance()` for the renderer.
 *
 * WHY THE VARIABLES ARE BUILT SEPARATELY
 *   `buildCardGenerateVariables()` returns the very same custom properties as a plain object, so
 *   the settings screen can paint a small preview with a design that is NOT the account's one
 *   (the next preset under the pointer) without touching the cards already on screen.
 *
 * The shipped defaults come from `ConfigLoader`: the settings screen and the account validation
 * already build their defaults there, so the fallback of a hand-called `applySettings()` cannot
 * drift from the configuration file.
 */

import {
  ConfigLoader,
  DEFAULT_CARD_GENERATE_SETTINGS,
  DEFAULT_STILL_SCALE_SETTINGS,
  buildCardGenerateDefaults,
  normalizeCardGenerateLayerSwitches,
} from './ConfigLoader.js';

/** Complete shipped design, used until the account settings are applied. */
const SHIPPED_DESIGN = buildCardGenerateDefaults(DEFAULT_CARD_GENERATE_SETTINGS);

/** Current resolved settings, read by the renderer. */
const state = {
  animation: {
    background: { ...SHIPPED_DESIGN.animation.background },
    underlay: { ...SHIPPED_DESIGN.animation.underlay },
    zoomBackground: SHIPPED_DESIGN.animation.zoomBackground,
    zoomUnderlay: SHIPPED_DESIGN.animation.zoomUnderlay,
    still: {
      background: { ...SHIPPED_DESIGN.animation.still.background },
      underlay: { ...SHIPPED_DESIGN.animation.still.underlay },
    },
    blur: SHIPPED_DESIGN.animation.blur,
  },
  construction: {
    borderWidth: SHIPPED_DESIGN.construction.borderWidth,
    headerHeight: SHIPPED_DESIGN.construction.headerHeight,
    bodyHeight: SHIPPED_DESIGN.construction.bodyHeight,
  },
  rarities: {},
};

/**
 * Copies a finite number, with a fallback.
 *
 * @param {unknown} value - Candidate.
 * @param {number} fallback - Value to use when the candidate is unusable.
 * @returns {number} The finite value.
 */
function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/**
 * Reads one rarity, completing the missing fields from its shipped fallback.
 *
 * @param {number|string} id - Rarity level.
 * @param {object|null|undefined} value - Stored rarity entry.
 * @returns {{color: string, accent: string, symbol: string, symbolColor: string}} The entry.
 */
function normalizeRarity(id, value) {
  const fallback =
    SHIPPED_DESIGN.construction.rarities[id] ?? SHIPPED_DESIGN.construction.rarities[1];
  const entry = value && typeof value === 'object' ? value : {};
  return {
    color: ConfigLoader.normalizeHexColor(entry.color, fallback.color),
    accent: ConfigLoader.normalizeHexColor(entry.accent, fallback.accent),
    symbol: ConfigLoader.normalizeGeneratedSymbol(entry.symbol, fallback.symbol),
    symbolColor: ConfigLoader.normalizeHexColor(entry.symbolColor, fallback.symbolColor),
  };
}

/**
 * Completes one per-layout scale map.
 *
 * @param {unknown} value - Stored map (`{classic, fullart}`), or a single number.
 * @param {Record<string, number>} fallback - Shipped value per layout.
 * @returns {Record<string, number>} A complete map, clamped to the configured range.
 */
function normalizeStillScales(value, fallback) {
  const stored = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  return Object.fromEntries(
    Object.entries(fallback).map(([layout]) => [
      layout,
      ConfigLoader.normalizeValueInRange(
        stored ? stored[layout] : value,
        DEFAULT_STILL_SCALE_SETTINGS
      ),
    ])
  );
}

/**
 * Completes a stored design.
 *
 * The values are validated by `AccountManager` before they reach this function; this is the safety
 * net of a hand-called `applySettings()`, a preset read from the configuration file or a save
 * written before a field existed.
 *
 * @param {object} [settings] - `settings.cardGenerate`.
 * @returns {{animation: object, construction: object, rarities: Record<string, object>}} The
 *   complete design.
 */
function resolveDesign(settings = {}) {
  const animation = settings.animation && typeof settings.animation === 'object' ? settings.animation : {};
  const construction =
    settings.construction && typeof settings.construction === 'object' ? settings.construction : {};
  const storedRarities =
    construction.rarities && typeof construction.rarities === 'object' ? construction.rarities : {};

  const rarities = {};
  Object.keys(SHIPPED_DESIGN.construction.rarities).forEach((id) => {
    rarities[id] = normalizeRarity(id, storedRarities[id]);
  });

  return {
    animation: {
      background: normalizeCardGenerateLayerSwitches(
        animation.background,
        SHIPPED_DESIGN.animation.background
      ),
      underlay: normalizeCardGenerateLayerSwitches(
        animation.underlay,
        SHIPPED_DESIGN.animation.underlay
      ),
      // `zoom` is the field a save written before the split carries: it was the background one.
      zoomBackground: finiteNumber(
        animation.zoomBackground ?? animation.zoom,
        SHIPPED_DESIGN.animation.zoomBackground
      ),
      zoomUnderlay: finiteNumber(
        animation.zoomUnderlay ?? animation.zoom,
        SHIPPED_DESIGN.animation.zoomUnderlay
      ),
      still: {
        background: normalizeStillScales(
          animation.still?.background,
          SHIPPED_DESIGN.animation.still.background
        ),
        underlay: normalizeStillScales(
          animation.still?.underlay,
          SHIPPED_DESIGN.animation.still.underlay
        ),
      },
      blur: finiteNumber(animation.blur, SHIPPED_DESIGN.animation.blur),
    },
    construction: {
      borderWidth: finiteNumber(
        construction.borderWidth,
        SHIPPED_DESIGN.construction.borderWidth
      ),
      headerHeight: finiteNumber(
        construction.headerHeight,
        SHIPPED_DESIGN.construction.headerHeight
      ),
      bodyHeight: finiteNumber(construction.bodyHeight, SHIPPED_DESIGN.construction.bodyHeight),
    },
    rarities,
  };
}

/**
 * Builds the custom properties describing one design.
 *
 * Colour, geometry, zoom and the per-layout animation names are custom properties: setting them on
 * an element is enough to restyle every generated card inside it, which is exactly what the
 * preview of the render picker does.
 *
 * @param {object} [settings] - `settings.cardGenerate`.
 * @returns {Record<string, string>} Custom property name -> value.
 */
export function buildCardGenerateVariables(settings = {}) {
  const design = resolveDesign(settings);
  const variables = {};

  Object.entries(design.animation.background).forEach(([layout, enabled]) => {
    variables[`--generated-card-${layout}-background-animation`] = enabled
      ? 'generated-card-background'
      : 'none';
  });
  Object.entries(design.animation.underlay).forEach(([layout, enabled]) => {
    variables[`--generated-card-${layout}-underlay-animation`] = enabled
      ? 'generated-card-underlay-zoom'
      : 'none';
  });
  Object.entries(design.animation.still.background).forEach(([layout, percent]) => {
    variables[`--generated-card-${layout}-background-still`] = String(percent / 100);
  });
  Object.entries(design.animation.still.underlay).forEach(([layout, percent]) => {
    variables[`--generated-card-${layout}-underlay-still`] = String(percent / 100);
  });
  variables['--generated-card-background-zoom'] = String(design.animation.zoomBackground / 100);
  variables['--generated-card-underlay-zoom'] = String(design.animation.zoomUnderlay / 100);
  variables['--generated-card-blur'] = `${design.animation.blur}px`;
  variables['--generated-card-border-width'] = `${design.construction.borderWidth}px`;
  variables['--generated-card-header-ratio'] = String(design.construction.headerHeight / 100);
  variables['--generated-card-body-ratio'] = String(design.construction.bodyHeight / 100);

  Object.entries(design.rarities).forEach(([id, rarity]) => {
    variables[`--generated-rarity-${id}-color`] = rarity.color;
    variables[`--generated-rarity-${id}-accent`] = rarity.accent;
  });

  return variables;
}

/**
 * Applies resolved settings to the document and remembers them for the renderer.
 *
 * The values are published on `<html>`: they inherit through the shadow boundary, so every card
 * already on screen follows the change without being rebuilt. The symbols live in the DOM, so the
 * caller that needs them updated (the settings screen) calls `CardSourceManager.refresh()` after
 * this.
 *
 * @param {object} [settings] - Resolved settings from `AccountManager.getSettings()`.
 * @returns {void}
 */
export function applyCardGenerateSettings(settings = {}) {
  const design = resolveDesign(settings);
  state.animation = design.animation;
  state.construction = design.construction;
  state.rarities = design.rarities;

  const root = document.documentElement;
  Object.entries(buildCardGenerateVariables(settings)).forEach(([name, value]) => {
    root.style.setProperty(name, value);
  });
}

/**
 * Reads the symbol and colours of one rarity.
 *
 * @param {number|string} rarity - Rarity level (`1` to `6`).
 * @returns {{color: string, accent: string, symbol: string, symbolColor: string}} The appearance.
 */
export function getRarityAppearance(rarity) {
  const id = SHIPPED_DESIGN.construction.rarities[rarity] ? rarity : 1;
  return normalizeRarity(id, state.rarities[id]);
}

/** Shared manager instance. */
export const cardGenerateManager = {
  applySettings: applyCardGenerateSettings,
  getRarityAppearance,
  buildVariables: buildCardGenerateVariables,
};

export default cardGenerateManager;

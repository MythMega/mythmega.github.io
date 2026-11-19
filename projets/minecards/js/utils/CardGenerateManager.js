/**
 * CardGenerateManager - Runtime values of the generated-card module.
 *
 * The module is declared in `settings/config.json` under `cardGenerate`: one `animation` block
 * (per-layout layer switches, zoom, blur, speed presets) and one `construction` block (frame
 * geometry, per-rarity colours and symbols). The account stores the values the developer picked,
 * so a save carries a card design with it.
 *
 * WHY A MANAGER SEPARATE FROM CardSourceManager
 *   `<card-print>` needs the rarity symbols while it renders. Importing `CardSourceManager` there
 *   would create a cycle (that manager imports `CardPrint` to build the generated source). This
 *   module only holds the resolved values, publishes the colour and geometry custom properties on
 *   `<html>`, and answers `getRarityAppearance()` for the renderer.
 *
 * The shipped defaults come from `ConfigLoader`: the settings screen and the account validation
 * already build their defaults there, so the fallback of a hand-called `applySettings()` cannot
 * drift from the configuration file.
 */

import {
  ConfigLoader,
  DEFAULT_CARD_GENERATE_SETTINGS,
  buildCardGenerateDefaults,
  normalizeCardGenerateLayerSwitches,
} from './ConfigLoader.js';

/** Complete shipped design, used until the account settings are applied. */
const SHIPPED_DESIGN = buildCardGenerateDefaults(DEFAULT_CARD_GENERATE_SETTINGS);

/** Current resolved settings, read by the renderer. */
const state = {
  animation: { ...SHIPPED_DESIGN.animation },
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

/** Fills the runtime rarity map with the shipped rows. */
function resetRarities() {
  state.rarities = {};
  Object.keys(SHIPPED_DESIGN.construction.rarities).forEach((id) => {
    state.rarities[id] = { ...SHIPPED_DESIGN.construction.rarities[id] };
  });
}

resetRarities();

/**
 * Applies resolved settings to the document and remembers them for the renderer.
 *
 * Colour, geometry, zoom and the per-layout animation names are custom properties on `<html>`:
 * they inherit through the shadow boundary, so every card already on screen follows the change
 * without being rebuilt. The symbols live in the DOM, so the caller that needs them updated (the
 * settings screen) calls `CardSourceManager.refresh()` after this.
 *
 * The values are validated by `AccountManager` before they reach this function. A missing field
 * still falls back to the shipped design, which keeps a hand-called `applySettings()` safe.
 *
 * @param {object} [settings] - Resolved settings from `AccountManager.getSettings()`.
 * @returns {void}
 */
export function applyCardGenerateSettings(settings = {}) {
  const animation = settings.animation && typeof settings.animation === 'object' ? settings.animation : {};
  const construction =
    settings.construction && typeof settings.construction === 'object' ? settings.construction : {};
  const storedRarities =
    construction.rarities && typeof construction.rarities === 'object' ? construction.rarities : {};

  state.animation = {
    background: normalizeCardGenerateLayerSwitches(
      animation.background,
      SHIPPED_DESIGN.animation.background
    ),
    underlay: normalizeCardGenerateLayerSwitches(
      animation.underlay,
      SHIPPED_DESIGN.animation.underlay
    ),
    zoom: finiteNumber(animation.zoom, SHIPPED_DESIGN.animation.zoom),
    blur: finiteNumber(animation.blur, SHIPPED_DESIGN.animation.blur),
  };
  state.construction = {
    borderWidth: finiteNumber(
      construction.borderWidth,
      SHIPPED_DESIGN.construction.borderWidth
    ),
    headerHeight: finiteNumber(
      construction.headerHeight,
      SHIPPED_DESIGN.construction.headerHeight
    ),
    bodyHeight: finiteNumber(
      construction.bodyHeight,
      SHIPPED_DESIGN.construction.bodyHeight
    ),
  };
  state.rarities = {};
  Object.keys(SHIPPED_DESIGN.construction.rarities).forEach((id) => {
    state.rarities[id] = normalizeRarity(id, storedRarities[id]);
  });

  const root = document.documentElement;
  Object.entries(state.animation.background).forEach(([layout, enabled]) => {
    root.style.setProperty(
      `--generated-card-${layout}-background-animation`,
      enabled ? 'generated-card-background' : 'none'
    );
  });
  Object.entries(state.animation.underlay).forEach(([layout, enabled]) => {
    root.style.setProperty(
      `--generated-card-${layout}-underlay-animation`,
      enabled ? 'generated-card-underlay-zoom' : 'none'
    );
  });
  root.style.setProperty('--generated-card-zoom', String(state.animation.zoom / 100));
  root.style.setProperty('--generated-card-blur', `${state.animation.blur}px`);
  root.style.setProperty('--generated-card-border-width', `${state.construction.borderWidth}px`);
  root.style.setProperty(
    '--generated-card-header-ratio',
    String(state.construction.headerHeight / 100)
  );
  root.style.setProperty('--generated-card-body-ratio', String(state.construction.bodyHeight / 100));
  Object.entries(state.rarities).forEach(([id, rarity]) => {
    root.style.setProperty(`--generated-rarity-${id}-color`, rarity.color);
    root.style.setProperty(`--generated-rarity-${id}-accent`, rarity.accent);
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
};

export default cardGenerateManager;

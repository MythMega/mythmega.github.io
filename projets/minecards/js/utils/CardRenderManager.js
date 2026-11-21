/**
 * CardRenderManager - The list of card render modes and what one mode means for the account.
 *
 * Two kinds of choice live behind the same picker:
 *   - `images` : the historical source, the final PNG/WebP written in `Path`;
 *   - `custom` : the design edited by hand in the advanced developer panel (`settings.cardGenerate`);
 *   - a preset: one entry of `settings/cardrender.json` (`ConfigLoader.getCardRenderModes()`), which
 *     is a COMPLETE design. Choosing it only copies its values into the account, so nothing else
 *     has to know the file exists, and a save keeps rendering the same card even if the file is
 *     edited or removed afterwards.
 *
 * A preset may declare `requiresDeveloperMode`: it then stays out of the picker until the basic
 * developer mode is on (the restricted/advanced one is not needed). `custom` is the advanced
 * option: it is only offered, and only effective, with both developer modes on
 * (`CardSourceManager` gates it).
 *
 * This module never touches the DOM: it only answers questions about the list, which is what keeps
 * the settings screen, the boot path and the export button of the advanced panel in agreement.
 */

import { configLoader } from './ConfigLoader.js';

/** Values of `settings.cardRenderMode` that are not a preset. */
export const CARD_RENDER_MODE = Object.freeze({
  IMAGES: 'images',
  CUSTOM: 'custom',
});

/** Mode used when nothing valid is stored. */
export const DEFAULT_CARD_RENDER_MODE = CARD_RENDER_MODE.IMAGES;

/**
 * Reads the presets, falling back to an empty list.
 *
 * The settings screen must stay usable when the file cannot be read: the player then keeps the
 * images and the picker only offers them, instead of seeing a broken panel.
 *
 * @returns {Promise<Array<object>>} The validated presets (`ConfigLoader.getCardRenderModes()`).
 */
export async function getCardRenderModes() {
  try {
    return await configLoader.getCardRenderModes();
  } catch (error) {
    console.warn('[CardRenderManager] The card render presets could not be read.', error);
    return [];
  }
}

/**
 * Tells whether a preset may be offered to this account.
 *
 * @param {{requiresDeveloperMode?: boolean}} mode - Preset to test.
 * @param {object} [access] - Current access.
 * @param {boolean} [access.devMode=false] - Basic developer mode.
 * @returns {boolean} True when the preset belongs in the picker.
 */
export function isModeAvailable(mode, { devMode = false } = {}) {
  return mode?.requiresDeveloperMode !== true || devMode === true;
}

/**
 * Finds a preset by id.
 *
 * @param {Array<object>} modes - Presets.
 * @param {unknown} id - Requested id.
 * @returns {object|null} The preset, or null.
 */
export function findMode(modes, id) {
  if (typeof id !== 'string') return null;
  return modes.find((mode) => mode.id === id) ?? null;
}

/**
 * Label of a preset, in the current language.
 *
 * A file that only names a mode in one language still reads correctly everywhere: the missing
 * translation falls back to another one, then to the id.
 *
 * @param {{id: string, name?: Record<string, string>}} mode - Preset.
 * @param {string} [lang='fr'] - Interface language.
 * @returns {string} The label.
 */
export function getModeLabel(mode, lang = 'fr') {
  const value =
    mode?.name?.[lang] ??
    mode?.name?.en ??
    mode?.name?.fr ??
    Object.values(mode?.name ?? {})[0] ??
    mode?.id ??
    '';
  return typeof value === 'string' && value.trim() !== '' ? value : mode?.id ?? '';
}

/**
 * Turns a preset into the account settings it applies.
 *
 * @param {object} mode - Validated preset.
 * @returns {{cardGenerate: object, animatedLayers: boolean, animatedLayersSpeed: number}} Values
 *   to write with `AccountManager.updateSettings()`.
 */
export function buildModeSettings(mode) {
  return {
    cardGenerate: mode.design,
    animatedLayers: mode.animatedLayers === true,
    animatedLayersSpeed: mode.speedPercent,
  };
}

/**
 * Builds the JSON entry of a preset, in the shape `settings/cardrender.json` expects.
 *
 * The advanced panel copies it so a developer can paste an entry and only change its id: the
 * result therefore carries every property the file reads, named the way the file names them.
 *
 * @param {object} mode - Validated preset.
 * @param {string} [id] - Id of the copied entry.
 * @returns {object} A ready-to-paste entry.
 */
export function buildModeExport(mode, id = mode.id) {
  const design = mode.design;
  return {
    id,
    name: { ...mode.name },
    requiresDeveloperMode: mode.requiresDeveloperMode === true,
    animatedLayers: mode.animatedLayers === true,
    speedPercent: mode.speedPercent,
    animation: {
      classic: {
        animateBackground: design.animation.background.classic !== false,
        animateUnderlay: design.animation.underlay.classic !== false,
        stillBackgroundScalePercent: design.animation.still.background.classic,
        stillUnderlayScalePercent: design.animation.still.underlay.classic,
      },
      fullart: {
        animateBackground: design.animation.background.fullart !== false,
        animateUnderlay: design.animation.underlay.fullart !== false,
        stillBackgroundScalePercent: design.animation.still.background.fullart,
        stillUnderlayScalePercent: design.animation.still.underlay.fullart,
      },
    },
    backgroundZoomPercent: design.animation.zoomBackground,
    underlayZoomPercent: design.animation.zoomUnderlay,
    blurPx: design.animation.blur,
    borderWidth: design.construction.borderWidth,
    headerHeightPercent: design.construction.headerHeight,
    bodyHeightPercent: design.construction.bodyHeight,
    rarities: Object.entries(design.construction.rarities).map(([tier, rarity]) => ({
      tier: Number(tier),
      borderColor: rarity.color,
      accentColor: rarity.accent,
      symbol: rarity.symbol,
      symbolColor: rarity.symbolColor,
    })),
  };
}

/** Shared instance. */
export const cardRenderManager = {
  CARD_RENDER_MODE,
  DEFAULT_CARD_RENDER_MODE,
  getModes: getCardRenderModes,
  isModeAvailable,
  findMode,
  getModeLabel,
  buildModeSettings,
  buildModeExport,
};

export default cardRenderManager;

/**
 * Autocut parameter schema (labels + bounds). Bounds are read from
 * `settings/config.json` so the sliders stay configurable.
 * @module features/autocut/autocut-fields
 */

import { formatNumber } from '../../core/timecode.js';

const LAYOUT = [
  { key: 'thresholdDb', label: 'threshold', unit: 'dB', decimals: 0, min: -60, max: -5, step: 1 },
  { key: 'preCut', label: 'precut', unit: 's', decimals: 2, min: 0, max: 2, step: 0.05 },
  { key: 'postCut', label: 'postcut', unit: 's', decimals: 2, min: 0, max: 2, step: 0.05 },
  { key: 'minClipDuration', label: 'minClip', unit: 's', decimals: 2, min: 0, max: 10, step: 0.05 },
];

/** Parameters that actually affect the rendered output. */
export const RENDER_PARAM_KEYS = ['thresholdDb', 'preCut', 'postCut', 'minClipDuration'];

/**
 * Normalise the render-affecting parameters so two snapshots can be compared.
 * @param {Record<string, any>} params
 * @returns {Record<string, number>}
 */
export function renderParamsOf(params) {
  const snapshot = {};
  for (const key of RENDER_PARAM_KEYS) {
    const value = Number(params?.[key]);
    snapshot[key] = Number.isFinite(value) ? Math.round(value * 10000) / 10000 : 0;
  }
  return snapshot;
}

/**
 * @param {Record<string, number>|null|undefined} previous snapshot used by the last render
 * @param {Record<string, any>} current current effective parameters
 * @returns {boolean}
 */
export function hasRenderParamsChanged(previous, current) {
  if (!previous) return true;
  const next = renderParamsOf(current);
  return RENDER_PARAM_KEYS.some((key) => Math.abs((previous[key] ?? 0) - next[key]) > 1e-9);
}

/**
 * @param {Record<string, any>} config
 * @returns {Array<{ key: string, label: string, unit: string, decimals: number, min: number, max: number, step: number }>}
 */
export function getAutocutFieldSpecs(config) {
  return LAYOUT.map((field) => {
    const bounds = config.autocut?.fields?.[field.key] ?? {};
    return {
      ...field,
      min: Number.isFinite(Number(bounds.min)) ? Number(bounds.min) : field.min,
      max: Number.isFinite(Number(bounds.max)) ? Number(bounds.max) : field.max,
      step: Number.isFinite(Number(bounds.step)) ? Number(bounds.step) : field.step,
    };
  });
}

/**
 * Compact parameter line shown on every video row.
 * @param {{ thresholdDb: number, preCut: number, postCut: number, minClipDuration: number }} params
 */
export function formatParamSummary(params) {
  return [
    `${formatNumber(params.thresholdDb, 0)} dB`,
    `${formatNumber(params.preCut, 2)} s`,
    `${formatNumber(params.postCut, 2)} s`,
    `≥ ${formatNumber(params.minClipDuration, 2)} s`,
  ].join(' · ');
}

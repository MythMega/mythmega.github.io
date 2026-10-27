/**
 * Autocut parameter schema (labels + bounds). Bounds are read from
 * `settings/config.json` so the sliders stay configurable.
 * @module features/autocut/autocut-fields
 */

import { normalizeOutputFormat } from '../../core/output-format.js';
import { formatNumber } from '../../core/timecode.js';

const LAYOUT = [
  { key: 'thresholdDb', label: 'threshold', unit: 'dB', decimals: 0, min: -60, max: -5, step: 1 },
  { key: 'preCut', label: 'precut', unit: 's', decimals: 2, min: 0, max: 2, step: 0.05 },
  { key: 'postCut', label: 'postcut', unit: 's', decimals: 2, min: 0, max: 2, step: 0.05 },
  { key: 'minClipDuration', label: 'minClip', unit: 's', decimals: 2, min: 0, max: 10, step: 0.05 },
];

/** Parameters that change what Autocut produces. */
export const RENDER_PARAM_KEYS = [
  'thresholdDb',
  'preCut',
  'postCut',
  'minClipDuration',
  'fadeAudio',
  'fadeVideo',
  'fadeDuration',
  'output',
];

/**
 * Pick one render-affecting value, wherever it lives in the parameters.
 * @param {Record<string, any>} params
 * @param {string} key
 */
function renderValue(params, key) {
  if (key === 'fadeAudio') return params?.fade?.audio;
  if (key === 'fadeVideo') return params?.fade?.video;
  if (key === 'fadeDuration') return params?.fade?.duration;
  if (key === 'output') return normalizeOutputFormat(params?.output);
  return params?.[key];
}

/**
 * Round numbers so tiny float differences do not mark a finished item as stale.
 * @param {Record<string, any>} params
 * @returns {Record<string, number|string>}
 */
export function renderParamsOf(params) {
  const snapshot = {};
  for (const key of RENDER_PARAM_KEYS) {
    const raw = renderValue(params, key);
    if (typeof raw === 'string') {
      snapshot[key] = raw;
      continue;
    }
    const value = Number(raw);
    snapshot[key] = Number.isFinite(value) ? Math.round(value * 10000) / 10000 : 0;
  }
  return snapshot;
}

/**
 * @param {Record<string, unknown>|null|undefined} previous snapshot of the last render
 * @param {Record<string, any>} current effective parameters
 * @returns {boolean}
 */
export function hasRenderParamsChanged(previous, current) {
  if (!previous) return true;
  return JSON.stringify(renderParamsOf(current)) !== JSON.stringify(previous);
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

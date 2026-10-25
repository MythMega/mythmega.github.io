/**
 * Configuration loading.
 *
 * - `settings/config.json` holds app-level configuration (paths, limits, codecs).
 * - `settings/default.json` holds the default processing values.
 * - User changes made in the UI are persisted in localStorage and merged on top.
 * @module core/settings
 */

import { sanitizeSuffix } from './media.js';

const CONFIG_PATH = 'settings/config.json';

const PROCESSING_FALLBACKS = {
  maxFileSizeMb: 512,
  previewDuration: 60,
  videoCodec: 'libx264',
  preset: 'veryfast',
  crf: 23,
  pixelFormat: 'yuv420p',
  audioCodec: 'aac',
  audioBitrate: '128k',
  maxSegments: 400,
  reverseWarningSeconds: 120,
};

/** @param {string} path @returns {Promise<any>} */
async function fetchJson(path) {
  const response = await fetch(new URL(path, document.baseURI), { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status} while loading ${path}`);
  return response.json();
}

/** @param {string} key */
function readStoredJson(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Deep merge `override` onto `base` (arrays are replaced, not concatenated).
 * @param {any} base
 * @param {any} override
 */
export function deepMerge(base, override) {
  if (Array.isArray(base) || Array.isArray(override)) {
    return Array.isArray(override) ? override.slice() : Array.isArray(base) ? base.slice() : override;
  }
  if (!isPlainObject(base)) return override === undefined ? base : override;
  const result = { ...base };
  if (isPlainObject(override)) {
    for (const [key, value] of Object.entries(override)) {
      result[key] = key in base ? deepMerge(base[key], value) : value;
    }
  }
  return result;
}

/** @param {number} value @param {number} fallback */
function numberOr(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

/**
 * Clamp numeric params to the ranges declared in config.json.
 * @param {Record<string, any>} params
 * @param {Record<string, any>} config
 * @param {Record<string, any>} defaults
 */
function normalizeParams(params, config, defaults) {
  const fields = config.autocut?.fields ?? {};
  const autocut = { ...defaults.autocut, ...(isPlainObject(params.autocut) ? params.autocut : {}) };

  for (const [key, field] of Object.entries(fields)) {
    const fallback = numberOr(defaults.autocut?.[key], 0);
    const value = numberOr(autocut[key], fallback);
    const min = numberOr(field?.min, value);
    const max = numberOr(field?.max, value);
    autocut[key] = Math.min(max, Math.max(min, value));
  }
  autocut.minSilence = Math.max(0.1, numberOr(autocut.minSilence, numberOr(defaults.autocut?.minSilence, 0.5)));
  autocut.suffix = sanitizeSuffix(autocut.suffix ?? defaults.autocut?.suffix ?? '');

  const fastcut = {
    ...defaults.fastcut,
    ...(isPlainObject(params.fastcut) ? params.fastcut : {}),
  };
  fastcut.suffix = sanitizeSuffix(fastcut.suffix ?? defaults.fastcut?.suffix ?? '');

  const reverse = {
    ...defaults.reverse,
    ...(isPlainObject(params.reverse) ? params.reverse : {}),
  };
  reverse.suffix = sanitizeSuffix(reverse.suffix ?? defaults.reverse?.suffix ?? '');

  return { autocut, fastcut, reverse };
}

/**
 * @typedef {object} Settings
 * @property {Record<string, any>} config
 * @property {Record<string, any>} defaults
 * @property {Record<string, any>} params live, mutable parameters
 * @property {Record<string, any>} processing normalized processing options
 * @property {{ params: string, lang: string }} storageKeys
 */

/**
 * Load everything the app needs before rendering.
 * @returns {Promise<Settings>}
 */
export async function loadSettings() {
  const config = await fetchJson(CONFIG_PATH);
  const defaultsPath = config.assets?.settingsDefaults || 'settings/default.json';
  const defaults = await fetchJson(defaultsPath);

  const prefix = config.app?.storagePrefix || 'bulkut';
  const storageKeys = { params: `${prefix}.params`, lang: `${prefix}.lang` };
  const stored = readStoredJson(storageKeys.params);
  const params = normalizeParams(deepMerge(defaults, stored ?? {}), config, defaults);

  return {
    config,
    defaults,
    params,
    processing: { ...PROCESSING_FALLBACKS, ...(config.processing ?? {}) },
    storageKeys,
  };
}

/** Persist the current parameters (best effort). @param {Settings} settings */
export function saveParams(settings) {
  try {
    localStorage.setItem(settings.storageKeys.params, JSON.stringify(settings.params));
  } catch {
    /* Storage can be unavailable (private mode, file://). */
  }
}

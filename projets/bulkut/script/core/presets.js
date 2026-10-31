/**
 * Presets: a named snapshot of one tab's settings, stored in a cookie.
 *
 * Presets are deliberately small (numbers and suffixes only) so they fit in a
 * single cookie. Names are unique per tab (case-insensitive). The module stays
 * free of DOM dependencies outside the cookie helpers so the encoding and the
 * naming rules can be unit tested.
 * @module core/presets
 */

import { AppError } from './app-error.js';

const COOKIE_DAYS = 365;
/** Conservative limit: browsers reject cookies larger than ~4 KB. */
const MAX_COOKIE_LENGTH = 3900;
export const MAX_PRESET_NAME_LENGTH = 40;

/**
 * @param {string} prefix cookie prefix from the settings
 * @param {string} scope tab name
 */
function cookieName(prefix, scope) {
  return `${prefix}.${scope}`;
}

/**
 * Trim, collapse whitespace, drop control characters and cap the length.
 * @param {unknown} value
 * @returns {string}
 */
export function sanitizePresetName(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_PRESET_NAME_LENGTH);
}

/**
 * @param {Array<{ name: string }>} presets
 * @param {string} name
 * @returns {boolean}
 */
export function isPresetNameTaken(presets, name) {
  const target = sanitizePresetName(name).toLowerCase();
  if (!target) return false;
  return presets.some((preset) => sanitizePresetName(preset?.name).toLowerCase() === target);
}

/**
 * @param {Array<object>} presets
 * @returns {string} cookie-safe value
 */
export function encodePresets(presets) {
  return encodeURIComponent(JSON.stringify({ v: 1, presets }));
}

/** @param {any} preset */
function isPreset(preset) {
  return (
    preset &&
    typeof preset === 'object' &&
    typeof preset.id === 'string' &&
    typeof preset.name === 'string' &&
    preset.values &&
    typeof preset.values === 'object' &&
    !Array.isArray(preset.values)
  );
}

/** @param {any} preset */
function normalisePreset(preset) {
  return {
    id: preset.id,
    name: sanitizePresetName(preset.name),
    createdAt: typeof preset.createdAt === 'string' ? preset.createdAt : '',
    values: preset.values,
  };
}

/**
 * Never throws: a corrupted or foreign cookie simply means "no presets".
 * @param {string} raw encoded cookie value
 * @returns {Array<{ id: string, name: string, createdAt: string, values: Record<string, any> }>
 */
export function decodePresets(raw) {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(decodeURIComponent(raw));
    if (!Array.isArray(parsed?.presets)) return [];

    return parsed.presets
      .filter(isPreset)
      .map(normalisePreset)
      .filter((preset) => preset.name);
  } catch {
    return [];
  }
}

/** @param {string} name */
function readCookie(name) {
  const target = `${name}=`;
  for (const part of document.cookie.split('; ')) {
    if (part.startsWith(target)) return part.slice(target.length);
  }
  return '';
}

/**
 * @param {string} name
 * @param {string} value
 */
function writeCookie(name, value) {
  const expires = new Date(Date.now() + COOKIE_DAYS * 24 * 60 * 60 * 1000).toUTCString();
  document.cookie = `${name}=${value}; path=/; expires=${expires}; SameSite=Lax`;

  // A browser with cookies disabled, or one that rejects an oversized cookie,
  // fails silently: read it back to surface a useful error.
  if (readCookie(name) !== value) throw new AppError('presetStorage');
}

/** @param {string} name */
function clearCookie(name) {
  document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
}

/** @returns {string} */
function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * @param {Record<string, any>} values
 * @returns {Record<string, any>}
 */
function cloneValues(values) {
  return JSON.parse(JSON.stringify(values ?? {}));
}

/**
 * One store per tab. Every call re-reads the cookie, so two tabs that save
 * presets do not overwrite each other's list with a stale snapshot.
 * @param {string} scope 'autocut' | 'fastcut' | 'reverse' | 'collage' | 'introoutro'
 * @param {string} [prefix] cookie prefix, derived from the app storage prefix
 */
export function createPresetStore(scope, prefix = 'bulkut.presets') {
  const name = cookieName(prefix, scope);

  function list() {
    return decodePresets(readCookie(name));
  }

  /**
   * @param {string} rawName
   * @param {Record<string, any>} values
   * @returns {{ id: string, name: string, createdAt: string, values: Record<string, any> }}
   */
  function save(rawName, values) {
    const presetName = sanitizePresetName(rawName);
    if (!presetName) throw new AppError('presetNameEmpty');

    const presets = list();
    if (isPresetNameTaken(presets, presetName)) {
      throw new AppError('presetNameTaken', { name: presetName });
    }

    const preset = {
      id: createId(),
      name: presetName,
      createdAt: new Date().toISOString(),
      values: cloneValues(values),
    };
    const encoded = encodePresets([...presets, preset]);
    if (encoded.length > MAX_COOKIE_LENGTH) throw new AppError('presetTooLarge');

    writeCookie(name, encoded);
    return preset;
  }

  /** @param {string} id */
  function remove(id) {
    const next = list().filter((preset) => preset.id !== id);
    if (next.length) writeCookie(name, encodePresets(next));
    else clearCookie(name);
  }

  return { list, save, remove };
}

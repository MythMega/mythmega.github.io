/**
 * Timecode helpers (pure functions, no DOM).
 * @module core/timecode
 */

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** @param {number} value @param {number} [size] */
export function pad(value, size = 2) {
  return String(Math.trunc(Math.abs(value))).padStart(size, '0');
}

/**
 * Split seconds into whole hours/minutes/seconds.
 * @param {number} seconds
 * @returns {{ hours: number, minutes: number, seconds: number }}
 */
export function splitTimecode(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  return {
    hours: Math.floor(total / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

/**
 * `00:01:23` style timecode.
 * @param {number} seconds
 */
export function formatTimecode(seconds) {
  const { hours, minutes, seconds: secs } = splitTimecode(seconds);
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
}

/**
 * Compact duration for meta lines: `1:23` or `1:02:03`.
 * @param {number} seconds
 */
export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

/**
 * Parse `hh:mm:ss`, `mm:ss` or `ss`.
 * @param {string|number} value
 * @returns {number|null}
 */
export function parseTimecode(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parts = String(value ?? '').trim().split(':');
  if (parts.length === 0 || parts.length > 3) return null;
  const numbers = parts.map((part) => (part.trim() === '' ? NaN : Number(part)));
  if (numbers.some((number) => !Number.isFinite(number) || number < 0)) return null;
  if (numbers.length === 3) return numbers[0] * 3600 + numbers[1] * 60 + numbers[2];
  if (numbers.length === 2) return numbers[0] * 60 + numbers[1];
  return numbers[0];
}

/**
 * @param {number} hours
 * @param {number} minutes
 * @param {number} seconds
 */
export function timecodeToSeconds(hours, minutes, seconds) {
  const h = Number(hours) || 0;
  const m = Number(minutes) || 0;
  const s = Number(seconds) || 0;
  return h * 3600 + m * 60 + s;
}

/**
 * Format a decimal number with a fixed number of digits, trimming useless zeros.
 * @param {number} value
 * @param {number} [decimals]
 */
export function formatNumber(value, decimals = 2) {
  if (!Number.isFinite(value)) return '0';
  const fixed = Number(value).toFixed(decimals);
  return fixed.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

/**
 * Round to a given number of decimals (avoids float noise in filter strings).
 * @param {number} value @param {number} [decimals]
 */
export function roundTo(value, decimals = 3) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

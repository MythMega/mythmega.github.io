/**
 * Audio and video fades applied to a finished file.
 *
 * A fade is a per-tab setting: `audio` and `video` are independent and each can
 * fade in, out, both or not at all. The duration is shared by both streams.
 * @module core/fade
 */

import { clamp } from './timecode.js';

export const FADE_MODES = ['none', 'in', 'out', 'both'];

export const FADE_FALLBACK_BOUNDS = { min: 0.1, max: 1, step: 0.1, defaultDuration: 1 };

/** @returns {{ audio: string, video: string, duration: number }} */
export function emptyFade() {
  return { audio: 'none', video: 'none', duration: FADE_FALLBACK_BOUNDS.defaultDuration };
}

/**
 * @param {unknown} value
 * @param {{ min?: number, max?: number, defaultDuration?: number }} [bounds]
 * @param {{ audio?: string, video?: string, duration?: number }} [fallback]
 * @returns {{ audio: string, video: string, duration: number }}
 */
export function normalizeFade(value, bounds = FADE_FALLBACK_BOUNDS, fallback = emptyFade()) {
  const source = value && typeof value === 'object' ? value : {};
  const base = fallback ?? emptyFade();
  const min = Number(bounds?.min);
  const max = Number(bounds?.max);
  const fallbackDuration = Number(bounds?.defaultDuration) || Number(base.duration) || 1;
  const duration = clamp(
    Number.isFinite(Number(source.duration)) ? Number(source.duration) : Number(base.duration) || fallbackDuration,
    Number.isFinite(min) ? min : 0.1,
    Number.isFinite(max) ? max : 1,
  );

  return {
    audio: FADE_MODES.includes(source.audio) ? source.audio : FADE_MODES.includes(base.audio) ? base.audio : 'none',
    video: FADE_MODES.includes(source.video) ? source.video : FADE_MODES.includes(base.video) ? base.video : 'none',
    duration,
  };
}

/** @param {{ audio?: string, video?: string }} [fade] */
export function fadeIsActive(fade) {
  return Boolean(fade) && (fade.audio !== 'none' || fade.video !== 'none');
}

/**
 * @param {'none'|'in'|'out'|'both'} mode
 * @param {'fade'|'afade'} name
 * @param {number} duration
 * @param {number} totalDuration
 * @returns {string[]}
 */
function filtersFor(mode, name, duration, totalDuration) {
  if (mode === 'none') return [];
  const length = Math.max(0.05, Number(duration) || 0.1);
  const total = Math.max(length, Number(totalDuration) || length);
  const outStart = Math.max(0, total - length);
  const filters = [];

  if (mode === 'in' || mode === 'both') filters.push(`${name}=t=in:st=0:d=${length.toFixed(3)}`);
  if (mode === 'out' || mode === 'both') filters.push(`${name}=t=out:st=${outStart.toFixed(3)}:d=${length.toFixed(3)}`);
  return filters;
}

/**
 * Build the final filter fragments for one finished file.
 * @param {{ audio?: string, video?: string, duration?: number } | null | undefined} fade
 * @param {number} totalDuration output duration in seconds
 * @returns {{ video: string, audio: string }}
 */
export function buildFadeFilters(fade, totalDuration) {
  if (!fade) return { video: '', audio: '' };
  const duration = clamp(Number(fade.duration) || 1, 0.1, 1);
  return {
    video: filtersFor(fade.video, 'fade', duration, totalDuration).join(','),
    audio: filtersFor(fade.audio, 'afade', duration, totalDuration).join(','),
  };
}

/**
 * Merge existing filters with the fade filters, in that order.
 * @param {string} existing
 * @param {string} fade
 * @returns {string}
 */
export function joinFilters(existing, fade) {
  return [existing, fade].filter(Boolean).join(',');
}

/**
 * Flat preset keys used by every tab.
 * @param {{ audio: string, video: string, duration: number }} fade
 */
export function fadePresetValues(fade) {
  return {
    fadeAudio: fade.audio,
    fadeVideo: fade.video,
    fadeDuration: fade.duration,
  };
}

/**
 * Read fade values back from a preset, keeping the current values when absent.
 * @param {Record<string, any>} values
 * @param {{ audio: string, video: string, duration: number }} current
 * @param {{ min?: number, max?: number }} [bounds]
 */
export function fadeFromPreset(values, current, bounds = FADE_FALLBACK_BOUNDS) {
  return normalizeFade(
    {
      audio: values?.fadeAudio,
      video: values?.fadeVideo,
      duration: values?.fadeDuration,
    },
    bounds,
    current,
  );
}

/**
 * @param {(key: string, args?: Record<string, any>) => string} t
 * @param {{ audio: string, video: string, duration: number }} fade
 * @returns {Array<{ label: string, value: string }>}
 */
export function fadeSummary(t, fade) {
  const mode = (value) => t(`fade.modes.${value}`);
  return [
    { label: t('fade.audio'), value: mode(fade.audio) },
    { label: t('fade.video'), value: mode(fade.video) },
    { label: t('fade.duration'), value: `${Number(fade.duration).toFixed(1)} s` },
  ];
}

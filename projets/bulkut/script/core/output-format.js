/**
 * Output formats shared by the UI, settings and timeline writers.
 * @module core/output-format
 */

export const OUTPUT_FORMATS = ['video', 'premiere', 'davinci'];
export const TIMELINE_FORMATS = ['premiere', 'davinci'];

/** @param {unknown} value */
export function normalizeOutputFormat(value) {
  return OUTPUT_FORMATS.includes(value) ? value : 'video';
}

/** @param {unknown} value */
export function isTimelineFormat(value) {
  return TIMELINE_FORMATS.includes(normalizeOutputFormat(value));
}

/** @param {unknown} value */
export function outputExtension(value) {
  const format = normalizeOutputFormat(value);
  if (format === 'premiere') return 'xml';
  if (format === 'davinci') return 'fcpxml';
  return 'mp4';
}

/** Translation key for a format name, e.g. `autocut.output.premiere`. */
export function outputLabelKey(value) {
  return `autocut.output.${normalizeOutputFormat(value)}`;
}

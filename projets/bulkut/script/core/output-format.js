/**
 * Output formats shared by the UI, settings and timeline writers.
 *
 * Sony Vegas reads the same FCP 7 XML as Premiere, so it gets its own entry in
 * the picker while sharing the Premiere writer.
 * @module core/output-format
 */

export const OUTPUT_FORMATS = ['video', 'premiere', 'davinci', 'shotcut', 'finalcut', 'vegas'];
export const TIMELINE_FORMATS = ['premiere', 'davinci', 'shotcut', 'finalcut', 'vegas'];

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
  if (format === 'premiere' || format === 'vegas') return 'xml';
  if (format === 'davinci' || format === 'finalcut') return 'fcpxml';
  if (format === 'shotcut') return 'mlt';
  return 'mp4';
}

/** Translation key for a format name, e.g. `autocut.output.premiere`. */
export function outputLabelKey(value) {
  return `autocut.output.${normalizeOutputFormat(value)}`;
}

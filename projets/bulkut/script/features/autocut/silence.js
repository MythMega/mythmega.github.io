/**
 * Autocut maths: parse `silencedetect` output, apply pre/post-cut margins,
 * build the kept segments and the FFmpeg filter graph.
 *
 * All functions here are pure so they can be unit tested.
 * @module features/autocut/silence
 */

import { clamp, roundTo } from '../../core/timecode.js';

const SILENCE_START = /silence_start:\s*(-?\d+(?:\.\d+)?)/;
const SILENCE_END = /silence_end:\s*(-?\d+(?:\.\d+)?)/;

/**
 * Parse ffmpeg `silencedetect` log lines.
 *
 * An unterminated silence (still silent at EOF) is returned with `end: null`
 * and resolved by {@link computeKeepSegments}.
 *
 * @param {string[]} lines
 * @returns {Array<{ start: number, end: number|null }>}
 */
export function parseSilenceLogs(lines) {
  const silences = [];
  let openStart = null;

  for (const line of lines) {
    const startMatch = SILENCE_START.exec(line);
    if (startMatch) {
      openStart = Math.max(0, Number(startMatch[1]));
      continue;
    }

    const endMatch = SILENCE_END.exec(line);
    if (endMatch) {
      const end = Math.max(0, Number(endMatch[1]));
      const start = openStart ?? 0;
      if (end > start) silences.push({ start, end });
      openStart = null;
    }
  }

  if (openStart !== null) silences.push({ start: openStart, end: null });
  return silences;
}

/**
 * Inverse the silences into the blocks to keep, then apply the margins:
 * keep a little air before speech (`preCut`) and after it (`postCut`).
 *
 * @param {Array<{ start: number, end: number|null }>} silences
 * @param {number} duration
 * @param {{ preCut?: number, postCut?: number, minSegment?: number }} [options]
 * @returns {Array<{ start: number, end: number }>}
 */
export function computeKeepSegments(silences, duration, { preCut = 0, postCut = 0, minSegment = 0.25 } = {}) {
  const total = Math.max(0, Number(duration) || 0);
  if (!total) return [];

  const safePre = clamp(Number(preCut) || 0, 0, total);
  const safePost = clamp(Number(postCut) || 0, 0, total);
  const minLength = Math.max(0, Number(minSegment) || 0);

  // Normalise, clamp and merge overlapping detected silences.
  const mergedSilences = [];
  const normalised = silences
    .map((silence) => ({
      start: clamp(Number(silence.start) || 0, 0, total),
      end: clamp(silence.end === null || silence.end === undefined ? total : Number(silence.end) || 0, 0, total),
    }))
    .filter((silence) => silence.end > silence.start)
    .sort((a, b) => a.start - b.start);

  for (const silence of normalised) {
    const last = mergedSilences[mergedSilences.length - 1];
    if (last && silence.start <= last.end) {
      last.end = Math.max(last.end, silence.end);
    } else {
      mergedSilences.push({ ...silence });
    }
  }

  // Speech = the gaps between silences.
  const speech = [];
  let cursor = 0;
  for (const silence of mergedSilences) {
    if (silence.start > cursor) speech.push({ start: cursor, end: silence.start });
    cursor = Math.max(cursor, silence.end);
  }
  if (cursor < total) speech.push({ start: cursor, end: total });

  // Margins can make neighbours overlap: merge them again.
  const kept = [];
  for (const block of speech) {
    const start = Math.max(0, block.start - safePre);
    const end = Math.min(total, block.end + safePost);
    const last = kept[kept.length - 1];
    if (last && start <= last.end) {
      last.end = Math.max(last.end, end);
    } else {
      kept.push({ start, end });
    }
  }

  return kept
    .filter((block) => block.end - block.start >= minLength)
    .map((block) => ({
      start: roundTo(block.start, 3),
      end: roundTo(block.end, 3),
    }));
}

/** @param {Array<{start:number,end:number}>} segments */
export function totalKeptDuration(segments) {
  return roundTo(segments.reduce((sum, segment) => sum + (segment.end - segment.start), 0), 3);
}

/**
 * Build the FFmpeg filter graph that trims each segment and concatenates them.
 * @param {Array<{ start: number, end: number }>} segments
 * @param {boolean} hasAudio
 * @returns {string}
 */
export function buildFilterGraph(segments, hasAudio) {
  const chains = [];
  let concatInputs = '';

  segments.forEach((segment, index) => {
    const start = segment.start.toFixed(3);
    const end = segment.end.toFixed(3);
    chains.push(`[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${index}]`);
    if (hasAudio) {
      chains.push(`[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${index}]`);
      concatInputs += `[v${index}][a${index}]`;
    } else {
      concatInputs += `[v${index}]`;
    }
  });

  chains.push(
    `${concatInputs}concat=n=${segments.length}:v=1:a=${hasAudio ? 1 : 0}[vout]${hasAudio ? '[aout]' : ''}`,
  );

  return chains.join(';');
}

/**
 * @param {object} options
 * @param {string} options.input
 * @param {number} options.thresholdDb
 * @param {number} options.minSilence
 * @param {number} [options.seek]
 * @param {number} [options.length]
 * @returns {string[]}
 */
export function buildSilenceArgs({ input, thresholdDb, minSilence, seek = 0, length = 0 }) {
  const args = ['-hide_banner'];
  if (seek > 0) args.push('-ss', seek.toFixed(3));
  args.push('-i', input);
  if (length > 0) args.push('-t', length.toFixed(3));
  args.push(
    '-af',
    `silencedetect=noise=${Number(thresholdDb).toFixed(2)}dB:d=${Number(minSilence).toFixed(2)}`,
    '-vn',
    '-f',
    'null',
    '-',
  );
  return args;
}

/**
 * @param {object} options
 * @param {string} options.input
 * @param {string} options.output
 * @param {Array<{ start: number, end: number }>} options.segments
 * @param {boolean} options.hasAudio
 * @param {Record<string, any>} options.processing
 * @param {number} [options.seek]
 * @param {number} [options.length]
 * @returns {string[]}
 */
export function buildAutocutArgs({ input, output, segments, hasAudio, processing, seek = 0, length = 0 }) {
  const args = ['-hide_banner'];
  if (seek > 0) args.push('-ss', seek.toFixed(3));
  args.push('-i', input);
  if (length > 0) args.push('-t', length.toFixed(3));

  args.push('-filter_complex', buildFilterGraph(segments, hasAudio), '-map', '[vout]');
  if (hasAudio) args.push('-map', '[aout]');

  args.push(
    '-c:v',
    processing.videoCodec,
    '-preset',
    processing.preset,
    '-crf',
    String(processing.crf),
    '-pix_fmt',
    processing.pixelFormat,
  );

  if (hasAudio) {
    args.push('-c:a', processing.audioCodec, '-b:a', processing.audioBitrate);
  }

  args.push('-movflags', '+faststart', '-map_metadata', '-1', '-y', output);
  return args;
}

/**
 * Window used by the "preview" action: one minute at the middle of the video.
 * @param {number} duration
 * @param {number} [previewDuration]
 * @returns {{ seek: number, length: number }}
 */
export function computePreviewWindow(duration, previewDuration = 60) {
  const total = Math.max(0, Number(duration) || 0);
  const length = Math.min(Math.max(0.1, Number(previewDuration) || 60), total);
  const seek = Math.max(0, (total - length) / 2);
  return { seek: roundTo(seek, 3), length: roundTo(length, 3) };
}

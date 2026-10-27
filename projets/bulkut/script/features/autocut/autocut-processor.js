/**
 * Autocut pipeline: analyse silence, compute the kept segments, then trim and
 * concatenate everything in a single FFmpeg pass.
 *
 * The same analysis is exposed as a cheap "estimate" job that only computes
 * the output duration, without encoding anything.
 * @module features/autocut/autocut-processor
 */

import { AppError } from '../../core/app-error.js';
import { parseMediaInfo, probeMedia } from '../../core/media-probe.js';
import {
  buildAutocutArgs,
  buildSilenceArgs,
  computeKeepSegments,
  computePreviewWindow,
  parseSilenceLogs,
  totalKeptDuration,
} from './silence.js';
import { buildTimeline } from './timeline-export.js';

let jobCounter = 0;
function uniqueId() {
  jobCounter += 1;
  return `${Date.now().toString(36)}-${jobCounter.toString(36)}`;
}

/**
 * @param {import('../../core/ffmpeg-service.js').FFmpegService} ffmpeg
 * @param {string} path
 * @param {number} durationHint
 * @returns {Promise<number>}
 */
async function resolveDuration(ffmpeg, path, durationHint, token) {
  const hint = Number(durationHint) || 0;
  if (hint) return hint;

  const info = await probeMedia(ffmpeg, path, token);
  if (!info.duration) throw new AppError('duration');
  return info.duration;
}

/**
 * Run `silencedetect` and turn its output into the segments to keep.
 * @param {import('../../core/ffmpeg-service.js').FFmpegService} ffmpeg
 * @param {string} path
 * @param {object} options
 * @returns {Promise<Array<{ start: number, end: number }>>}
 */
async function analyseSegments(ffmpeg, path, { params, window, onProgress, token }) {
  const analysis = await ffmpeg.run(
    buildSilenceArgs({
      input: path,
      thresholdDb: params.thresholdDb,
      minSilence: params.minSilence,
      seek: window.seek,
      length: window.length,
    }),
    {
      duration: window.length,
      onProgress,
      // A video without audio makes `silencedetect` fail: inspect the logs
      // first so the user gets a precise message instead of a render error.
      allowFailure: true,
      token,
    },
  );

  const info = parseMediaInfo(analysis.logs);
  if (!info.hasAudio) throw new AppError('noAudio');
  if (analysis.code !== 0) throw new AppError('renderFailed');

  return computeKeepSegments(parseSilenceLogs(analysis.logs), window.length, {
    preCut: params.preCut,
    postCut: params.postCut,
    minSegment: params.minClipDuration,
  });
}

/**
 * Mount the source, read its metadata and turn the silences into kept blocks.
 * The same pass serves renders, duration estimates and timeline exports.
 * @param {object} options
 * @param {boolean} [options.withMediaInfo] also report width, height and fps
 * @returns {Promise<{ duration: number, window: { seek: number, length: number }, segments: Array<{ start: number, end: number }>, info: object|null }>}
 */
async function analyseSource({
  ffmpeg,
  source,
  params,
  processing,
  durationHint = 0,
  preview = null,
  withMediaInfo = false,
  hooks = {},
  token,
}) {
  await ffmpeg.ensureLoaded(token);
  const attached = await source.attach(ffmpeg, token);

  try {
    hooks.onPhase?.('preparing', 0.04);
    const duration = await resolveDuration(ffmpeg, attached.path, durationHint, token);
    const info = withMediaInfo ? await probeMedia(ffmpeg, attached.path, token) : null;
    const window = preview
      ? computePreviewWindow(duration, preview.duration ?? processing.previewDuration)
      : { seek: 0, length: duration };

    hooks.onPhase?.('analyzing', 0.08);
    const segments = await analyseSegments(ffmpeg, attached.path, {
      params,
      window,
      onProgress: (ratio) => hooks.onPhase?.('analyzing', 0.08 + ratio * 0.9),
      token,
    });

    return { duration, window, segments, info };
  } finally {
    await attached.cleanup();
  }
}

/**
 * Compute the output duration of an autocut render without encoding.
 * @param {object} options
 * @param {import('../../core/ffmpeg-service.js').FFmpegService} options.ffmpeg
 * @param {import('../../core/file-source.js').FileSource} options.source
 * @param {{ thresholdDb: number, preCut: number, postCut: number, minClipDuration: number, minSilence: number }} options.params
 * @param {Record<string, any>} options.processing
 * @param {number} [options.durationHint]
 * @param {{ onPhase?: (phase: 'preparing'|'analyzing', progress: number) => void }} [options.hooks]
 * @returns {Promise<{ duration: number, clips: number, sourceDuration: number }>}
 */
export async function estimateAutocut({ ffmpeg, source, params, processing, durationHint = 0, hooks = {}, token }) {
  hooks.onPhase?.('preparing', 0.01);
  const { duration, segments } = await analyseSource({
    ffmpeg,
    source,
    params,
    processing,
    durationHint,
    hooks,
    token,
  });

  hooks.onPhase?.('analyzing', 1);
  return { duration: totalKeptDuration(segments), clips: segments.length, sourceDuration: duration };
}

/**
 * @param {object} options
 * @param {import('../../core/ffmpeg-service.js').FFmpegService} options.ffmpeg
 * @param {import('../../core/file-source.js').FileSource} options.source
 * @param {{ thresholdDb: number, preCut: number, postCut: number, minClipDuration: number, minSilence: number }} options.params
 * @param {Record<string, any>} options.processing
 * @param {number} [options.durationHint]
 * @param {{ duration: number }|null} [options.preview] render only a middle window
 * @param {{ audio: string, video: string, duration: number } | null} [options.fade] final-file fades
 * @param {{ onPhase?: (phase: 'preparing'|'analyzing'|'rendering', progress: number) => void }} [options.hooks]
 * @returns {Promise<{ blob: Blob, segments: Array<{start:number,end:number}>, duration: number }>}
 */
export async function processAutocut({
  ffmpeg,
  source,
  params,
  processing,
  durationHint = 0,
  preview = null,
  fade = null,
  hooks = {},
  token,
}) {
  hooks.onPhase?.('preparing', 0.01);
  await ffmpeg.ensureLoaded(token);

  const output = `bulkut-out-${uniqueId()}.mp4`;
  const attached = await source.attach(ffmpeg, token);

  try {
    const duration = await resolveDuration(ffmpeg, attached.path, durationHint, token);
    const window = preview
      ? computePreviewWindow(duration, preview.duration ?? processing.previewDuration)
      : { seek: 0, length: duration };

    // Silence detection is quick next to encoding, so it only takes 5% of the
    // progress bar. The rest follows FFmpeg's output timestamp.
    hooks.onPhase?.('analyzing', 0.02);
    const segments = await analyseSegments(ffmpeg, attached.path, {
      params,
      window,
      onProgress: (ratio) => hooks.onPhase?.('analyzing', 0.02 + ratio * 0.05),
      token,
    });

    if (segments.length === 0) throw new AppError('noSegments');
    if (segments.length > processing.maxSegments) {
      throw new AppError('tooManySegments', { max: processing.maxSegments });
    }

    // `time=` follows the concatenated output, which is shorter than the source
    // whenever silences are removed: using the source duration stalled the bar
    // and made the last third jump at once.
    const keptDuration = totalKeptDuration(segments);

    hooks.onPhase?.('rendering', 0.07);
    await ffmpeg.run(
      buildAutocutArgs({
        input: attached.path,
        output,
        segments,
        hasAudio: true,
        processing,
        seek: window.seek,
        length: window.length,
        fade,
      }),
      {
        duration: keptDuration,
        onProgress: (ratio, stats) => hooks.onPhase?.('rendering', 0.07 + ratio * 0.89, stats),
        token,
      },
    );

    // Reading the result back from the wasm filesystem is a real step for long
    // videos: reserve a few percent for it instead of an instant jump.
    hooks.onPhase?.('rendering', 0.96);
    const data = await ffmpeg.readFile(output, token);
    const blob = new Blob([data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)], {
      type: 'video/mp4',
    });

    hooks.onPhase?.('rendering', 1);
    return { blob, segments, duration: window.length };
  } finally {
    await ffmpeg.deleteFile(output);
    await attached.cleanup();
  }
}

/**
 * Write the kept segments as an editor timeline instead of encoding a video.
 * Only the silence analysis runs, so this is much faster than a render.
 *
 * @param {object} options
 * @param {import('../../core/ffmpeg-service.js').FFmpegService} options.ffmpeg
 * @param {import('../../core/file-source.js').FileSource} options.source
 * @param {{ thresholdDb: number, preCut: number, postCut: number, minClipDuration: number, minSilence: number }} options.params
 * @param {Record<string, any>} options.processing
 * @param {'premiere'|'davinci'} options.format
 * @param {number} [options.durationHint]
 * @param {{ onPhase?: (phase: 'preparing'|'analyzing', progress: number) => void }} [options.hooks]
 * @returns {Promise<{ text: string, segments: Array<{start:number,end:number}>, duration: number }>}
 */
export async function exportAutocutTimeline({
  ffmpeg,
  source,
  params,
  processing,
  format,
  durationHint = 0,
  hooks = {},
  token,
}) {
  hooks.onPhase?.('preparing', 0.01);
  const { duration, segments, info } = await analyseSource({
    ffmpeg,
    source,
    params,
    processing,
    durationHint,
    withMediaInfo: true,
    hooks,
    token,
  });

  if (segments.length === 0) throw new AppError('noSegments');
  if (segments.length > processing.maxSegments) {
    throw new AppError('tooManySegments', { max: processing.maxSegments });
  }

  hooks.onPhase?.('analyzing', 0.98);
  const mediaName = source.name || 'video.mp4';
  const text = buildTimeline({
    format,
    name: mediaName,
    // Browsers never expose the absolute path: a relative reference lets the
    // editor relink the file when the XML sits next to it.
    mediaPath: `./${mediaName}`,
    duration: info?.duration || duration,
    width: info?.width || 0,
    height: info?.height || 0,
    fps: info?.fps || processing.concatFps || 30,
    hasAudio: info?.hasAudio ?? true,
    segments,
  });

  hooks.onPhase?.('analyzing', 1);
  return { text, segments, duration };
}

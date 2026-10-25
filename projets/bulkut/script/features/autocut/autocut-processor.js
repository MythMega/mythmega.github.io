/**
 * Autocut pipeline: analyse silence, compute the kept segments, then trim and
 * concatenate everything in a single FFmpeg pass.
 * @module features/autocut/autocut-processor
 */

import { AppError } from '../../core/app-error.js';
import { extensionOf } from '../../core/media.js';
import { parseMediaInfo, probeMedia } from '../../core/media-probe.js';
import {
  buildAutocutArgs,
  buildSilenceArgs,
  computeKeepSegments,
  computePreviewWindow,
  parseSilenceLogs,
} from './silence.js';

let jobCounter = 0;
function uniqueId() {
  jobCounter += 1;
  return `${Date.now().toString(36)}-${jobCounter.toString(36)}`;
}

/**
 * @param {object} options
 * @param {import('../../core/ffmpeg-service.js').FFmpegService} options.ffmpeg
 * @param {File} options.file
 * @param {{ thresholdDb: number, preCut: number, postCut: number, minClipDuration: number, minSilence: number }} options.params
 * @param {Record<string, any>} options.processing
 * @param {number} [options.durationHint]
 * @param {{ duration: number }|null} [options.preview] render only a middle window
 * @param {{ onPhase?: (phase: 'preparing'|'analyzing'|'rendering', progress: number) => void }} [options.hooks]
 * @returns {Promise<{ blob: Blob, segments: Array<{start:number,end:number}>, duration: number }>}
 */
export async function processAutocut({
  ffmpeg,
  file,
  params,
  processing,
  durationHint = 0,
  preview = null,
  hooks = {},
}) {
  hooks.onPhase?.('preparing', 0.01);
  await ffmpeg.ensureLoaded();

  const input = `bulkut-in-${uniqueId()}.${extensionOf(file.name)}`;
  const output = `bulkut-out-${uniqueId()}.mp4`;

  try {
    hooks.onPhase?.('preparing', 0.03);
    await ffmpeg.writeFile(input, new Uint8Array(await file.arrayBuffer()));

    let duration = Number(durationHint) || 0;
    if (!duration) {
      const info = await probeMedia(ffmpeg, input);
      duration = info.duration;
    }
    if (!duration) throw new AppError('duration');

    const window = preview
      ? computePreviewWindow(duration, preview.duration ?? processing.previewDuration)
      : { seek: 0, length: duration };

    hooks.onPhase?.('analyzing', 0.06);
    const analysis = await ffmpeg.run(
      buildSilenceArgs({
        input,
        thresholdDb: params.thresholdDb,
        minSilence: params.minSilence,
        seek: window.seek,
        length: window.length,
      }),
      {
        duration: window.length,
        onProgress: (ratio) => hooks.onPhase?.('analyzing', 0.06 + ratio * 0.34),
        // A video without audio makes `silencedetect` fail: inspect the logs
        // first so the user gets a precise message instead of a render error.
        allowFailure: true,
      },
    );

    const analyzedInfo = parseMediaInfo(analysis.logs);
    if (!analyzedInfo.hasAudio) throw new AppError('noAudio');
    if (analysis.code !== 0) throw new AppError('renderFailed');

    const silences = parseSilenceLogs(analysis.logs);
    const segments = computeKeepSegments(silences, window.length, {
      preCut: params.preCut,
      postCut: params.postCut,
      minSegment: params.minClipDuration,
    });

    if (segments.length === 0) throw new AppError('noSegments');
    if (segments.length > processing.maxSegments) {
      throw new AppError('tooManySegments', { max: processing.maxSegments });
    }

    hooks.onPhase?.('rendering', 0.42);
    await ffmpeg.run(
      buildAutocutArgs({
        input,
        output,
        segments,
        hasAudio: true,
        processing,
        seek: window.seek,
        length: window.length,
      }),
      {
        duration: window.length,
        onProgress: (ratio) => hooks.onPhase?.('rendering', 0.42 + ratio * 0.56),
      },
    );

    const data = await ffmpeg.readFile(output);
    const blob = new Blob([data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)], {
      type: 'video/mp4',
    });

    hooks.onPhase?.('rendering', 1);
    return { blob, segments, duration: window.length };
  } finally {
    await ffmpeg.deleteFile(input);
    await ffmpeg.deleteFile(output);
  }
}

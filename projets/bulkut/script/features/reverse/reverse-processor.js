/**
 * Reverse pipeline: play the video and its audio backwards.
 * @module features/reverse/reverse-processor
 */

import { AppError } from '../../core/app-error.js';
import { buildFadeFilters } from '../../core/fade.js';
import { probeMedia } from '../../core/media-probe.js';

let counter = 0;

/**
 * @param {object} options
 * @param {string} options.input
 * @param {string} options.output
 * @param {boolean} options.hasAudio
 * @param {number} [options.duration]
 * @param {{ audio: string, video: string, duration: number } | null} [options.fade]
 * @param {Record<string, any>} options.processing
 * @returns {string[]}
 */
export function buildReverseArgs({ input, output, hasAudio, duration = 0, fade = null, processing }) {
  const filters = buildFadeFilters(fade, duration);
  const video = ['reverse', filters.video].filter(Boolean).join(',');
  const audio = ['areverse', filters.audio].filter(Boolean).join(',');
  const args = ['-hide_banner', '-i', input, '-vf', video];
  if (hasAudio) args.push('-af', audio);

  args.push(
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    '-c:v',
    processing.videoCodec,
    '-preset',
    processing.preset,
    '-crf',
    String(processing.crf),
    '-pix_fmt',
    processing.pixelFormat,
    '-c:a',
    processing.audioCodec,
    '-b:a',
    processing.audioBitrate,
    '-movflags',
    '+faststart',
    '-map_metadata',
    '-1',
    '-y',
    output,
  );

  return args;
}

/**
 * @param {object} options
 * @param {import('../../core/ffmpeg-service.js').FFmpegService} options.ffmpeg
 * @param {import('../../core/file-source.js').FileSource} options.source
 * @param {Record<string, any>} options.processing
 * @param {{ audio: string, video: string, duration: number } | null} [options.fade]
 * @param {{ onPhase?: (phase: 'preparing'|'rendering', progress: number) => void }} [options.hooks]
 * @returns {Promise<{ blob: Blob, duration: number }>}
 */
export async function processReverse({ ffmpeg, source, processing, fade = null, hooks = {}, token }) {
  hooks.onPhase?.('preparing', 0.01);
  await ffmpeg.ensureLoaded(token);

  counter += 1;
  const output = `bulkut-reversed-${Date.now().toString(36)}-${counter}.mp4`;

  const attached = await source.attach(ffmpeg, token);
  try {
    hooks.onPhase?.('preparing', 0.04);

    const info = await probeMedia(ffmpeg, attached.path, token);
    if (!info.hasVideo) throw new AppError('noVideoStream');
    if (!info.duration) throw new AppError('duration');

    hooks.onPhase?.('rendering', 0.08);
    await ffmpeg.run(
      buildReverseArgs({
        input: attached.path,
        output,
        hasAudio: info.hasAudio,
        duration: info.duration,
        fade,
        processing,
      }),
      {
        duration: info.duration,
        onProgress: (ratio, stats) => hooks.onPhase?.('rendering', 0.08 + ratio * 0.86, stats),
        token,
      },
    );

    hooks.onPhase?.('rendering', 0.94);
    const data = await ffmpeg.readFile(output, token);
    const blob = new Blob([data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)], {
      type: 'video/mp4',
    });

    hooks.onPhase?.('rendering', 1);
    return { blob, duration: info.duration };
  } finally {
    await ffmpeg.deleteFile(output);
    await attached.cleanup();
  }
}

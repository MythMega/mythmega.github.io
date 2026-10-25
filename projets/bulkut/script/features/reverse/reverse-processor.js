/**
 * Reverse pipeline: play the video and its audio backwards.
 * @module features/reverse/reverse-processor
 */

import { AppError } from '../../core/app-error.js';
import { extensionOf } from '../../core/media.js';
import { probeMedia } from '../../core/media-probe.js';

let counter = 0;

/**
 * @param {object} options
 * @param {string} options.input
 * @param {string} options.output
 * @param {boolean} options.hasAudio
 * @param {Record<string, any>} options.processing
 * @returns {string[]}
 */
export function buildReverseArgs({ input, output, hasAudio, processing }) {
  const args = ['-hide_banner', '-i', input, '-vf', 'reverse'];
  if (hasAudio) args.push('-af', 'areverse');

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
 * @param {File} options.file
 * @param {Record<string, any>} options.processing
 * @param {{ onPhase?: (phase: 'preparing'|'rendering', progress: number) => void }} [options.hooks]
 * @returns {Promise<{ blob: Blob, duration: number }>}
 */
export async function processReverse({ ffmpeg, file, processing, hooks = {} }) {
  hooks.onPhase?.('preparing', 0.01);
  await ffmpeg.ensureLoaded();

  counter += 1;
  const input = `bulkut-in-${Date.now().toString(36)}-${counter}.${extensionOf(file.name)}`;
  const output = `bulkut-reversed-${Date.now().toString(36)}-${counter}.mp4`;

  try {
    hooks.onPhase?.('preparing', 0.03);
    await ffmpeg.writeFile(input, new Uint8Array(await file.arrayBuffer()));

    const info = await probeMedia(ffmpeg, input);
    if (!info.hasVideo) throw new AppError('noVideoStream');
    if (!info.duration) throw new AppError('duration');

    hooks.onPhase?.('rendering', 0.08);
    await ffmpeg.run(
      buildReverseArgs({ input, output, hasAudio: info.hasAudio, processing }),
      {
        duration: info.duration,
        onProgress: (ratio) => hooks.onPhase?.('rendering', 0.08 + ratio * 0.9),
      },
    );

    const data = await ffmpeg.readFile(output);
    const blob = new Blob([data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)], {
      type: 'video/mp4',
    });

    hooks.onPhase?.('rendering', 1);
    return { blob, duration: info.duration };
  } finally {
    await ffmpeg.deleteFile(input);
    await ffmpeg.deleteFile(output);
  }
}

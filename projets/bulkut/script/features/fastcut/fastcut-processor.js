/**
 * Fastcut pipeline: cut a precise start/end range and re-encode it.
 * @module features/fastcut/fastcut-processor
 */

import { extensionOf } from '../../core/media.js';

let counter = 0;

/**
 * @param {object} options
 * @param {string} options.input
 * @param {string} options.output
 * @param {number} options.start seconds
 * @param {number} options.duration seconds
 * @param {Record<string, any>} options.processing
 * @returns {string[]}
 */
export function buildFastcutArgs({ input, output, start, duration, processing }) {
  return [
    '-hide_banner',
    '-ss',
    Number(start).toFixed(3),
    '-i',
    input,
    '-t',
    Number(duration).toFixed(3),
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
    '-avoid_negative_ts',
    'make_zero',
    '-movflags',
    '+faststart',
    '-map_metadata',
    '-1',
    '-y',
    output,
  ];
}

/**
 * @param {object} options
 * @param {import('../../core/ffmpeg-service.js').FFmpegService} options.ffmpeg
 * @param {File} options.file
 * @param {number} options.start
 * @param {number} options.end
 * @param {Record<string, any>} options.processing
 * @param {{ onPhase?: (phase: 'preparing'|'rendering', progress: number) => void }} [options.hooks]
 * @returns {Promise<{ blob: Blob, duration: number }>}
 */
export async function processFastcut({ ffmpeg, file, start, end, processing, hooks = {} }) {
  hooks.onPhase?.('preparing', 0.01);
  await ffmpeg.ensureLoaded();

  counter += 1;
  const input = `bulkut-in-${Date.now().toString(36)}-${counter}.${extensionOf(file.name)}`;
  const output = `bulkut-cut-${Date.now().toString(36)}-${counter}.mp4`;
  const duration = Math.max(0.1, Number(end) - Number(start));

  try {
    hooks.onPhase?.('preparing', 0.02);
    await ffmpeg.writeFile(input, new Uint8Array(await file.arrayBuffer()));

    hooks.onPhase?.('rendering', 0.06);
    await ffmpeg.run(buildFastcutArgs({ input, output, start, duration, processing }), {
      duration,
      onProgress: (ratio) => hooks.onPhase?.('rendering', 0.06 + ratio * 0.92),
    });

    const data = await ffmpeg.readFile(output);
    const blob = new Blob([data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)], {
      type: 'video/mp4',
    });

    hooks.onPhase?.('rendering', 1);
    return { blob, duration };
  } finally {
    await ffmpeg.deleteFile(input);
    await ffmpeg.deleteFile(output);
  }
}

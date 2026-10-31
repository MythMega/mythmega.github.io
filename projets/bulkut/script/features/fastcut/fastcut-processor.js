/**
 * Fastcut pipeline: cut a precise start/end range and re-encode it.
 * @module features/fastcut/fastcut-processor
 */

import { buildFadeFilters } from '../../core/fade.js';
import { probeMedia } from '../../core/media-probe.js';

let counter = 0;

/**
 * @param {object} options
 * @param {string} options.input
 * @param {string} options.output
 * @param {number} options.start seconds
 * @param {number} options.duration seconds
 * @param {boolean} [options.hasAudio]
 * @param {{ audio: string, video: string, duration: number } | null} [options.fade]
 * @param {Record<string, any>} options.processing
 * @returns {string[]}
 */
export function buildFastcutArgs({ input, output, start, duration, hasAudio = true, fade = null, processing }) {
  const filters = buildFadeFilters(fade, duration);
  const args = [
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
  ];

  if (filters.video) args.push('-vf', filters.video);
  if (hasAudio && filters.audio) args.push('-af', filters.audio);

  args.push(
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
  );

  return args;
}

/**
 * @param {object} options
 * @param {import('../../core/ffmpeg-service.js').FFmpegService} options.ffmpeg
 * @param {import('../../core/file-source.js').FileSource} options.source
 * @param {number} options.start
 * @param {number} options.end
 * @param {Record<string, any>} options.processing
 * @param {{ audio: string, video: string, duration: number } | null} [options.fade]
 * @param {{ onPhase?: (phase: 'preparing'|'rendering', progress: number) => void }} [options.hooks]
 * @returns {Promise<{ blob: Blob, duration: number }>}
 */
export async function processFastcut({ ffmpeg, source, start, end, processing, fade = null, hooks = {}, token }) {
  hooks.onPhase?.('preparing', 0.01);
  await ffmpeg.ensureLoaded(token);

  counter += 1;
  const output = `bulkut-cut-${Date.now().toString(36)}-${counter}.mp4`;
  const duration = Math.max(0.1, Number(end) - Number(start));

  const attached = await source.attach(ffmpeg, token);
  try {
    hooks.onPhase?.('preparing', 0.04);
    const info = await probeMedia(ffmpeg, attached.path, token);

    hooks.onPhase?.('rendering', 0.06);
    await ffmpeg.run(
      buildFastcutArgs({
        input: attached.path,
        output,
        start,
        duration,
        hasAudio: info.hasAudio,
        fade,
        processing,
      }),
      {
        duration,
        onProgress: (ratio, stats) => hooks.onPhase?.('rendering', 0.06 + ratio * 0.88, stats),
        token,
      },
    );

    hooks.onPhase?.('rendering', 0.94);
    const data = await ffmpeg.readFile(output, token);
    const blob = new Blob([data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)], {
      type: 'video/mp4',
    });

    hooks.onPhase?.('rendering', 1);
    return { blob, duration };
  } finally {
    await ffmpeg.deleteFile(output);
    await attached.cleanup();
  }
}

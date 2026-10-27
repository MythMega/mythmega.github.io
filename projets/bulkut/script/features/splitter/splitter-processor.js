/**
 * Splitter pipeline: export each user-defined range as its own MP4.
 * Fades are applied to every exported segment, because each one is a final file.
 * @module features/splitter/splitter-processor
 */

import { AppError } from '../../core/app-error.js';
import { probeMedia } from '../../core/media-probe.js';
import { buildFastcutArgs } from '../fastcut/fastcut-processor.js';

let counter = 0;

/**
 * @param {object} options
 * @param {string} options.input
 * @param {string} options.output
 * @param {number} options.start
 * @param {number} options.end
 * @param {boolean} options.hasAudio
 * @param {{ audio: string, video: string, duration: number } | null} options.fade
 * @param {Record<string, any>} options.processing
 * @returns {string[]}
 */
export function buildSplitArgs({ input, output, start, end, hasAudio, fade, processing }) {
  return buildFastcutArgs({
    input,
    output,
    start,
    duration: Math.max(0.1, end - start),
    hasAudio,
    fade,
    processing,
  });
}

/**
 * @param {object} options
 * @param {import('../../core/ffmpeg-service.js').FFmpegService} options.ffmpeg
 * @param {import('../../core/file-source.js').FileSource} options.source
 * @param {Array<{ start: number, end: number }>} options.segments
 * @param {Record<string, any>} options.processing
 * @param {{ audio: string, video: string, duration: number } | null} options.fade
 * @param {{ onPhase?: (phase: 'preparing'|'rendering', progress: number, stats?: object, index?: number) => void }} [options.hooks]
 * @returns {Promise<{ files: Array<{ blob: Blob, start: number, end: number }>, duration: number }>}
 */
export async function processSplit({ ffmpeg, source, segments, processing, fade, hooks = {}, token }) {
  if (!segments?.length) throw new AppError('noSegments');

  hooks.onPhase?.('preparing', 0.01);
  await ffmpeg.ensureLoaded(token);

  counter += 1;
  const base = `bulkut-split-${Date.now().toString(36)}-${counter}`;
  const attached = await source.attach(ffmpeg, token);

  try {
    hooks.onPhase?.('preparing', 0.04);
    const info = await probeMedia(ffmpeg, attached.path, token);
    if (!info.hasVideo) throw new AppError('noVideoStream');
    if (!info.duration) throw new AppError('duration');

    const files = [];
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const start = Math.max(0, Number(segment.start) || 0);
      const end = Math.min(info.duration, Number(segment.end) || 0);
      if (!(end > start)) throw new AppError('startBeforeEnd');

      const output = `${base}-${index + 1}.mp4`;
      try {
        await ffmpeg.run(
          buildSplitArgs({
            input: attached.path,
            output,
            start,
            end,
            hasAudio: info.hasAudio,
            fade,
            processing,
          }),
          {
            duration: Math.max(0.1, end - start),
            onProgress: (ratio, stats) =>
              hooks.onPhase?.('rendering', (index + ratio) / segments.length, stats, index),
            token,
          },
        );

        const data = await ffmpeg.readFile(output, token);
        files.push({
          blob: new Blob([data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)], {
            type: 'video/mp4',
          }),
          start,
          end,
        });
      } finally {
        await ffmpeg.deleteFile(output);
      }
    }

    hooks.onPhase?.('rendering', 1);
    return { files, duration: info.duration };
  } finally {
    await attached.cleanup();
  }
}

/**
 * One FFmpeg pass that joins several sources into a single MP4.
 *
 * Used by the Collage tab (all the clips) and the Intro/Outro tab (intro, clip
 * and outro). Sources are attached together, probed for their size and audio
 * track, normalised by {@link module:features/shared/concat} and rendered.
 * @module features/shared/concat-processor
 */

import { AppError } from '../../core/app-error.js';
import { probeMedia } from '../../core/media-probe.js';
import { buildConcatArgs } from './concat.js';

let counter = 0;

/**
 * @param {object} options
 * @param {import('../../core/ffmpeg-service.js').FFmpegService} options.ffmpeg
 * @param {Array<import('../../core/file-source.js').FileSource>} options.sources in output order
 * @param {number[]} [options.durations] known durations, used when FFmpeg cannot read them
 * @param {Record<string, any>} options.processing
 * @param {number} [options.fps]
 * @param {{ audio: string, video: string, duration: number } | null} [options.fade]
 * @param {{ onPhase?: (phase: 'preparing'|'rendering', progress: number, stats?: object) => void }} [options.hooks]
 * @param {{ cancelled?: boolean }} [options.token]
 * @returns {Promise<{ blob: Blob, duration: number }>}
 */
export async function processConcat({
  ffmpeg,
  sources,
  durations = [],
  processing,
  fps,
  fade = null,
  hooks = {},
  token,
}) {
  if (!sources?.length) throw new AppError('noClips');

  hooks.onPhase?.('preparing', 0.01);
  await ffmpeg.ensureLoaded(token);

  counter += 1;
  const output = `bulkut-join-${Date.now().toString(36)}-${counter}.mp4`;
  const attached = [];

  try {
    for (let index = 0; index < sources.length; index += 1) {
      attached.push(await sources[index].attach(ffmpeg, token));
      hooks.onPhase?.('preparing', 0.01 + ((index + 1) / sources.length) * 0.04);
    }

    // The concat filter needs the real size and audio layout of each input.
    const clips = [];
    for (let index = 0; index < attached.length; index += 1) {
      const info = await probeMedia(ffmpeg, attached[index].path, token);
      if (!info.hasVideo) throw new AppError('noVideoStream');

      const duration = info.duration || Number(durations[index]) || 0;
      if (!(duration > 0)) throw new AppError('duration');

      clips.push({
        hasAudio: info.hasAudio,
        duration,
        width: info.width,
        height: info.height,
      });
    }

    const { args, duration } = buildConcatArgs({
      inputs: attached.map((item) => item.path),
      clips,
      output,
      processing,
      fps,
      fade,
    });

    hooks.onPhase?.('rendering', 0.06);
    await ffmpeg.run(args, {
      duration,
      onProgress: (ratio, stats) => hooks.onPhase?.('rendering', 0.06 + ratio * 0.88, stats),
      token,
    });

    // Pulling the file out of the wasm filesystem takes a moment for long videos.
    hooks.onPhase?.('rendering', 0.94);
    const data = await ffmpeg.readFile(output, token);
    const blob = new Blob([data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)], {
      type: 'video/mp4',
    });

    hooks.onPhase?.('rendering', 1);
    return { blob, duration };
  } finally {
    await ffmpeg.deleteFile(output);
    for (const item of attached.reverse()) await item.cleanup();
  }
}

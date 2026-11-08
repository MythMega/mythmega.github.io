/**
 * Conversion pipeline: probe a source, re-encode it into the chosen container
 * and return the encoded file.
 * @module features/convert/convert-processor
 */

import { AppError } from '../../core/app-error.js';
import {
  buildConvertArgs,
  convertMimeType,
  parseEncoders,
  parseMuxers,
  resolveConvertTargets,
} from '../../core/convert.js';
import { probeMedia } from '../../core/media-probe.js';

let counter = 0;

/**
 * Ask the loaded engine which containers and codecs it supports.
 * @param {import('../../core/ffmpeg-service.js').FFmpegService} ffmpeg
 * @param {{ cancelled?: boolean }} [token]
 * @returns {Promise<ReturnType<typeof resolveConvertTargets>|null>}
 */
export async function detectConvertTargets(ffmpeg, token) {
  const muxers = await ffmpeg.run(['-hide_banner', '-muxers'], { allowFailure: true, token });
  const encoders = await ffmpeg.run(['-hide_banner', '-encoders'], { allowFailure: true, token });

  const targets = resolveConvertTargets({
    muxers: parseMuxers(muxers.logs),
    encoders: parseEncoders(encoders.logs),
  });

  return targets.length > 0 ? targets : null;
}

/**
 * @param {object} options
 * @param {import('../../core/ffmpeg-service.js').FFmpegService} options.ffmpeg
 * @param {import('../../core/file-source.js').FileSource} options.source
 * @param {{ id: string, extension: string, videoCodec: string, audioCodec: string|null, fastStart: boolean }} options.target
 * @param {string} [options.videoBitrate]
 * @param {string} [options.audioBitrate]
 * @param {Record<string, any>} [options.processing]
 * @param {{ onPhase?: (phase: 'preparing'|'rendering', progress: number, stats?: object) => void }} [options.hooks]
 * @param {{ cancelled?: boolean }} [options.token]
 * @returns {Promise<{ blob: Blob, duration: number, fileName: string }>}
 */
export async function processConvert({
  ffmpeg,
  source,
  target,
  videoBitrate = 'auto',
  audioBitrate = 'auto',
  processing = {},
  hooks = {},
  token,
}) {
  hooks.onPhase?.('preparing', 0.01);
  await ffmpeg.ensureLoaded(token);

  counter += 1;
  const output = `bulkut-convert-${Date.now().toString(36)}-${counter}.${target.extension}`;
  const attached = await source.attach(ffmpeg, token);

  try {
    hooks.onPhase?.('preparing', 0.04);
    const info = await probeMedia(ffmpeg, attached.path, token);
    if (!info.hasVideo) throw new AppError('noVideoStream');
    if (!(info.duration > 0)) throw new AppError('duration');

    hooks.onPhase?.('rendering', 0.06);
    await ffmpeg.run(
      buildConvertArgs({
        input: attached.path,
        output,
        target,
        videoBitrate,
        audioBitrate,
        processing,
      }),
      {
        duration: info.duration,
        onProgress: (ratio, stats) => hooks.onPhase?.('rendering', 0.06 + ratio * 0.88, stats),
        token,
      },
    );

    hooks.onPhase?.('rendering', 0.94);
    const data = await ffmpeg.readFile(output, token);
    const blob = new Blob([data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)], {
      type: convertMimeType(target.extension),
    });

    hooks.onPhase?.('rendering', 1);
    return { blob, duration: info.duration, fileName: output };
  } finally {
    await ffmpeg.deleteFile(output);
    await attached.cleanup();
  }
}

/**
 * Joining several videos into one.
 *
 * The clips can come from different cameras, so they rarely share a resolution,
 * a frame rate or even an audio track. The filter graph normalises every input
 * (letterboxed scale, constant frame rate, stereo 48 kHz audio) and the concat
 * filter then glues the normalised segments together.
 *
 * All functions here are pure so they can be unit tested.
 * @module features/shared/concat
 */

import { buildFadeFilters } from '../../core/fade.js';
import { roundTo } from '../../core/timecode.js';

const FALLBACK_SIZE = { width: 1280, height: 720 };

/** @param {number} value */
function evenDimension(value) {
  const rounded = Math.max(2, Math.round(Number(value) || 0));
  return Math.max(2, Math.round(rounded / 2) * 2);
}

/**
 * Use the largest clip as the reference, so upscaling never happens unless the
 * user mixes resolutions on purpose.
 * @param {Array<{ width?: number, height?: number }>} clips
 * @param {{ width?: number, height?: number }} [fallback]
 * @returns {{ width: number, height: number }}
 */
export function concatTargetSize(clips, fallback = FALLBACK_SIZE) {
  let best = null;
  for (const clip of clips) {
    const width = Number(clip?.width) || 0;
    const height = Number(clip?.height) || 0;
    if (width < 16 || height < 16) continue;
    if (!best || width * height > best.width * best.height) best = { width, height };
  }

  const size = best ?? {
    width: Number(fallback?.width) || FALLBACK_SIZE.width,
    height: Number(fallback?.height) || FALLBACK_SIZE.height,
  };

  return { width: evenDimension(size.width), height: evenDimension(size.height) };
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * @param {Array<{ hasAudio?: boolean, duration: number }>} clips
 * @returns {number}
 */
export function totalClipsDuration(clips) {
  return roundTo(
    clips.reduce((sum, clip) => sum + Math.max(0, Number(clip?.duration) || 0), 0),
    3,
  );
}

/**
 * @param {Array<{ hasAudio?: boolean, duration: number }>} clips in output order
 * @param {object} options
 * @param {number} options.width
 * @param {number} options.height
 * @param {number} [options.fps]
 * @param {string} [options.pixelFormat]
 * @param {{ audio: string, video: string, duration: number } | null} [options.fade]
 * @param {number} [options.duration]
 * @returns {string}
 */
export function buildConcatFilterGraph(
  clips,
  { width, height, fps = 30, pixelFormat = 'yuv420p', fade = null, duration = 0 } = {},
) {
  const hasAudio = clips.some((clip) => clip.hasAudio);
  const chains = [];
  const concatInputs = [];
  const rate = clamp(Math.round(Number(fps) || 30), 1, 120);

  clips.forEach((clip, index) => {
    chains.push(
      `[${index}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,` +
        `setsar=1,fps=${rate},format=${pixelFormat}[v${index}]`,
    );

    if (!hasAudio) {
      concatInputs.push(`[v${index}]`);
      return;
    }

    const duration = Math.max(0.01, Number(clip.duration) || 0).toFixed(3);
    if (clip.hasAudio) {
      // Pad then trim so the audio of every segment has exactly the clip length:
      // the concat filter wants matching streams.
      chains.push(
        `[${index}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,` +
          `apad,atrim=0:${duration},asetpts=PTS-STARTPTS[a${index}]`,
      );
    } else {
      chains.push(
        `anullsrc=channel_layout=stereo:sample_rate=48000:d=${duration},asetpts=PTS-STARTPTS[a${index}]`,
      );
    }
    concatInputs.push(`[v${index}][a${index}]`);
  });

  const total = Number(duration) || totalClipsDuration(clips);
  const filters = buildFadeFilters(fade, total);
  const videoLabel = filters.video ? 'vcat' : 'vout';
  const audioLabel = hasAudio ? (filters.audio ? 'acat' : 'aout') : '';

  chains.push(
    `${concatInputs.join('')}concat=n=${clips.length}:v=1:a=${hasAudio ? 1 : 0}[${videoLabel}]${
      hasAudio ? `[${audioLabel}]` : ''
    }`,
  );
  if (filters.video) chains.push(`[vcat]${filters.video}[vout]`);
  if (hasAudio && filters.audio) chains.push(`[acat]${filters.audio}[aout]`);

  return chains.join(';');
}

/**
 * @param {object} options
 * @param {string[]} options.inputs paths inside ffmpeg.wasm, same order as `clips`
 * @param {Array<{ hasAudio?: boolean, duration: number, width?: number, height?: number }>} options.clips
 * @param {string} options.output
 * @param {Record<string, any>} options.processing
 * @param {number} [options.fps]
 * @param {{ audio: string, video: string, duration: number } | null} [options.fade]
 * @returns {{ args: string[], duration: number }}
 */
export function buildConcatArgs({ inputs, clips, output, processing, fps, fade = null }) {
  const hasAudio = clips.some((clip) => clip.hasAudio);
  const { width, height } = concatTargetSize(clips);
  const rate = clamp(Math.round(Number(fps ?? processing?.concatFps) || 30), 1, 120);
  const duration = totalClipsDuration(clips);

  const args = ['-hide_banner'];
  for (const input of inputs) args.push('-i', input);

  args.push(
    '-filter_complex',
    buildConcatFilterGraph(clips, {
      width,
      height,
      fps: rate,
      pixelFormat: processing.pixelFormat,
      fade,
      duration,
    }),
    '-map',
    '[vout]',
  );
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
    '-r',
    String(rate),
  );

  if (hasAudio) args.push('-c:a', processing.audioCodec, '-b:a', processing.audioBitrate);

  args.push('-movflags', '+faststart', '-map_metadata', '-1', '-y', output);

  return { args, duration };
}

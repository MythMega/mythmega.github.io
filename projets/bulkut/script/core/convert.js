/**
 * Conversion formats and FFmpeg arguments.
 *
 * A target is only offered when the running FFmpeg build can actually write
 * its container and encode its video stream. The lists below are ordered by
 * preference: the first available codec wins.
 * @module core/convert
 */

/** @type {Array<{ id: string, extension: string, muxer: string, video: string[], audio: string[], fastStart: boolean }>} */
export const CONVERT_FORMATS = [
  { id: 'mp4', extension: 'mp4', muxer: 'mp4', video: ['libx264'], audio: ['aac'], fastStart: true },
  { id: 'mov', extension: 'mov', muxer: 'mov', video: ['libx264'], audio: ['aac'], fastStart: true },
  {
    id: 'mkv',
    extension: 'mkv',
    muxer: 'matroska',
    video: ['libx264'],
    audio: ['aac', 'libopus', 'libvorbis', 'libmp3lame'],
    fastStart: false,
  },
  {
    id: 'avi',
    extension: 'avi',
    muxer: 'avi',
    video: ['mpeg4', 'libx264'],
    audio: ['libmp3lame', 'libvorbis', 'aac'],
    fastStart: false,
  },
  {
    id: 'webm',
    extension: 'webm',
    muxer: 'webm',
    video: ['libvpx-vp9', 'libvpx'],
    audio: ['libopus', 'libvorbis'],
    fastStart: false,
  },
];

const MIME_TYPES = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  webm: 'video/webm',
};

/**
 * Muxers FFmpeg can write, parsed from `ffmpeg -muxers`.
 * @param {string[]} logs
 * @returns {Set<string>}
 */
export function parseMuxers(logs) {
  const muxers = new Set();
  for (const line of logs ?? []) {
    const match = /^\s*[D ]E\s+([A-Za-z0-9_]+)/.exec(String(line));
    if (match) muxers.add(match[1].toLowerCase());
  }
  return muxers;
}

/**
 * Encoders parsed from `ffmpeg -encoders`.
 * @param {string[]} logs
 * @returns {{ video: Set<string>, audio: Set<string> }}
 */
export function parseEncoders(logs) {
  const video = new Set();
  const audio = new Set();
  for (const line of logs ?? []) {
    const match = /^\s*([VAS])[A-Z.]{5}\s+([A-Za-z0-9_-]+)/.exec(String(line));
    if (!match) continue;
    if (match[1] === 'V') video.add(match[2].toLowerCase());
    else if (match[1] === 'A') audio.add(match[2].toLowerCase());
  }
  return { video, audio };
}

/** @param {string} id */
export function normalizeConvertFormat(id) {
  return CONVERT_FORMATS.some((format) => format.id === id) ? id : 'mp4';
}

/**
 * "auto" or a positive bitrate in kbps (as a string, to keep the setting
 * stable through localStorage).
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeBitrateChoice(value) {
  if (value === 'auto' || value === null || value === undefined || value === '') return 'auto';
  const number = Math.round(Number(value));
  if (!Number.isFinite(number) || number <= 0) return 'auto';
  return String(Math.min(100000, Math.max(100, number)));
}

/**
 * Keep the formats this build can write, with the codecs it can encode.
 * @param {{ muxers: Set<string>, encoders: { video: Set<string>, audio: Set<string> } }} support
 * @returns {Array<{ id: string, extension: string, muxer: string, videoCodec: string, audioCodec: string|null, fastStart: boolean }>}
 */
export function resolveConvertTargets({ muxers, encoders }) {
  /** @type {Array<{ id: string, extension: string, muxer: string, videoCodec: string, audioCodec: string|null, fastStart: boolean }>} */
  const targets = [];

  for (const format of CONVERT_FORMATS) {
    if (!muxers.has(format.muxer)) continue;
    const videoCodec = format.video.find((codec) => encoders.video.has(codec));
    if (!videoCodec) continue;
    const audioCodec = format.audio.find((codec) => encoders.audio.has(codec)) ?? null;
    targets.push({
      id: format.id,
      extension: format.extension,
      muxer: format.muxer,
      videoCodec,
      audioCodec,
      fastStart: format.fastStart,
    });
  }

  return targets;
}

/**
 * Every format with its preferred codecs; used before (or without) detection.
 * @returns {Array<{ id: string, extension: string, muxer: string, videoCodec: string, audioCodec: string|null, fastStart: boolean }>}
 */
export function defaultConvertTargets() {
  return CONVERT_FORMATS.map((format) => ({
    id: format.id,
    extension: format.extension,
    muxer: format.muxer,
    videoCodec: format.video[0],
    audioCodec: format.audio[0],
    fastStart: format.fastStart,
  }));
}

/** @param {string} extension */
export function convertMimeType(extension) {
  return MIME_TYPES[String(extension).toLowerCase()] ?? 'video/mp4';
}

/**
 * @param {object} options
 * @param {string} options.input
 * @param {string} options.output
 * @param {{ videoCodec: string, audioCodec: string|null, fastStart: boolean }} options.target
 * @param {string} [options.videoBitrate] "auto" or kbps
 * @param {string} [options.audioBitrate] "auto" or kbps
 * @param {{ preset?: string }} [options.processing]
 * @returns {string[]}
 */
export function buildConvertArgs({ input, output, target, videoBitrate = 'auto', audioBitrate = 'auto', processing = {} }) {
  const args = ['-hide_banner', '-i', input, '-map', '0:v:0', '-map', '0:a:0?'];

  args.push('-c:v', target.videoCodec, '-pix_fmt', 'yuv420p');
  if (target.videoCodec === 'libx264') {
    args.push('-preset', processing.preset || 'veryfast');
  } else if (target.videoCodec === 'libvpx' || target.videoCodec === 'libvpx-vp9') {
    args.push('-deadline', 'good', '-cpu-used', '2');
  }

  const video = normalizeBitrateChoice(videoBitrate);
  if (video !== 'auto') args.push('-b:v', `${video}k`);

  if (target.audioCodec) {
    args.push('-c:a', target.audioCodec);
    const audio = normalizeBitrateChoice(audioBitrate);
    if (audio !== 'auto') args.push('-b:a', `${audio}k`);
  } else {
    args.push('-an');
  }

  if (target.fastStart) args.push('-movflags', '+faststart');
  args.push('-map_metadata', '-1', '-y', output);
  return args;
}

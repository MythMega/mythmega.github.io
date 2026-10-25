/**
 * Read media information from `ffmpeg -i` output (ffmpeg.wasm has no ffprobe).
 * @module core/media-probe
 */

const DURATION_PATTERN = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/;
const AUDIO_PATTERN = /Stream #\d+:\d+[^\n]*: Audio:/;
const VIDEO_PATTERN = /Stream #\d+:\d+[^\n]*: Video:/;

/**
 * @param {string[]} logs
 * @returns {{ duration: number, hasAudio: boolean, hasVideo: boolean }}
 */
export function parseMediaInfo(logs) {
  const text = logs.join('\n');
  const match = DURATION_PATTERN.exec(text);
  const duration = match
    ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
    : 0;
  return {
    duration: Number.isFinite(duration) ? duration : 0,
    hasAudio: AUDIO_PATTERN.test(text),
    hasVideo: VIDEO_PATTERN.test(text),
  };
}

/**
 * @param {import('./ffmpeg-service.js').FFmpegService} ffmpeg
 * @param {string} path virtual file name inside ffmpeg.wasm
 */
export async function probeMedia(ffmpeg, path) {
  const { logs } = await ffmpeg.run(['-hide_banner', '-i', path], { allowFailure: true });
  return parseMediaInfo(logs);
}

/**
 * Read media information from `ffmpeg -i` output (ffmpeg.wasm has no ffprobe).
 * @module core/media-probe
 */

const DURATION_PATTERN = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/;
const AUDIO_PATTERN = /Stream #\d+:\d+[^\n]*: Audio:/;
const VIDEO_PATTERN = /Stream #\d+:\d+[^\n]*: Video:/;
// e.g. "Video: h264 (...), yuv420p, 1920x1080 [SAR 1:1 DAR 16:9], 59.94 fps".
// Codec tags such as "0x31637661" only have one digit before the x, so they
// are skipped by requiring at least two digits on each side.
const VIDEO_SIZE_PATTERN = /Stream #\d+:\d+[^\n]*: Video:[^\n]*?(\d{2,5})x(\d{2,5})/;
const VIDEO_FPS_PATTERN = /Stream #\d+:\d+[^\n]*: Video:[^\n]*?([\d.]+)\s*fps/;

/**
 * @param {string[]} logs
 * @returns {{ duration: number, hasAudio: boolean, hasVideo: boolean, width: number, height: number, fps: number }}
 */
export function parseMediaInfo(logs) {
  const text = logs.join('\n');
  const match = DURATION_PATTERN.exec(text);
  const duration = match
    ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
    : 0;
  const size = VIDEO_SIZE_PATTERN.exec(text);
  const fps = VIDEO_FPS_PATTERN.exec(text);
  return {
    duration: Number.isFinite(duration) ? duration : 0,
    hasAudio: AUDIO_PATTERN.test(text),
    hasVideo: VIDEO_PATTERN.test(text),
    width: size ? Number(size[1]) : 0,
    height: size ? Number(size[2]) : 0,
    fps: fps ? Number(fps[1]) : 0,
  };
}

/**
 * @param {import('./ffmpeg-service.js').FFmpegService} ffmpeg
 * @param {string} path virtual file name inside ffmpeg.wasm
 * @param {{ cancelled?: boolean }} [token]
 */
export async function probeMedia(ffmpeg, path, token) {
  const { logs } = await ffmpeg.run(['-hide_banner', '-i', path], { allowFailure: true, token });
  return parseMediaInfo(logs);
}

/**
 * FFmpeg progress parsing.
 *
 * FFmpeg prints a stats line roughly twice a second while it works:
 *
 *   frame=  642 fps= 61 q=28.0 size=   1344kB time=00:00:10.72 bitrate=1027.0kbits/s speed=1.02x
 *
 * `time=` is the position in the *output* timeline, so the caller must pass the
 * duration that FFmpeg is actually producing (for Autocut, the sum of the kept
 * segments — not the source duration, which would stall the bar).
 *
 * Everything here is pure so it can be unit tested.
 * @module core/ffmpeg-stats
 */

const TIME_PATTERN = /\btime=\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/;
const SPEED_PATTERN = /\bspeed=\s*([\d.]+)\s*x/;
const FPS_PATTERN = /\bfps=\s*([\d.]+)/;
const FRAME_PATTERN = /\bframe=\s*(\d+)/;

/**
 * @param {string} line
 * @returns {{ seconds: number, speed: number, fps: number, frame: number } | null}
 */
export function parseStatsLine(line) {
  if (typeof line !== 'string') return null;

  const time = TIME_PATTERN.exec(line);
  if (!time) return null;

  const speed = SPEED_PATTERN.exec(line);
  const fps = FPS_PATTERN.exec(line);
  const frame = FRAME_PATTERN.exec(line);

  return {
    seconds: Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3]),
    speed: speed ? Number(speed[1]) : 0,
    fps: fps ? Number(fps[1]) : 0,
    frame: frame ? Number(frame[1]) : 0,
  };
}

/**
 * Exponential smoothing, so a single slow or fast tick does not move the ETA.
 * @param {number} previous
 * @param {number} next
 * @param {number} [weight] share of the new value
 * @returns {number}
 */
export function smoothValue(previous, next, weight = 0.35) {
  if (!Number.isFinite(next) || next <= 0) return previous > 0 ? previous : 0;
  if (!(previous > 0)) return next;
  return previous * (1 - weight) + next * weight;
}

/**
 * Seconds left, estimated two ways and blended:
 * - FFmpeg's own `speed=` (media seconds produced per wall second);
 * - the elapsed time divided by the progress made so far.
 *
 * The second one is ignored while the progress is still tiny (the first ticks
 * are not representative), and 0 means "unknown".
 *
 * @param {object} options
 * @param {number} options.mediaSeconds position reached in the output
 * @param {number} options.duration total output duration
 * @param {number} [options.ratio] progress between 0 and 1
 * @param {number} [options.speed] FFmpeg speed multiplier
 * @param {number} [options.elapsedMs] wall time spent so far
 * @returns {number} seconds, rounded to the nearest second
 */
export function estimateEtaSeconds({ mediaSeconds, duration, ratio = 0, speed = 0, elapsedMs = 0 }) {
  const total = Number(duration) || 0;
  const current = Math.max(0, Number(mediaSeconds) || 0);
  if (!total || current >= total) return 0;

  const remaining = total - current;
  const bySpeed = speed > 0 ? remaining / speed : 0;
  const byRatio =
    ratio >= 0.02 && elapsedMs > 700 ? (elapsedMs / 1000) * ((1 - ratio) / ratio) : 0;

  if (bySpeed > 0 && byRatio > 0) return Math.round(bySpeed * 0.6 + byRatio * 0.4);
  return Math.round(bySpeed || byRatio);
}

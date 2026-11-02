import assert from 'node:assert/strict';
import test from 'node:test';

import {
  estimateEtaSeconds,
  parseStatsLine,
  smoothValue,
} from '../script/core/ffmpeg-stats.js';
import { formatEta } from '../script/core/timecode.js';

const LINE =
  'frame=  642 fps= 61 q=28.0 size=   1344kB time=00:00:10.72 bitrate=1027.0kbits/s speed=1.02x';

test('parses the FFmpeg stats line', () => {
  assert.deepEqual(parseStatsLine(LINE), {
    seconds: 10.72,
    speed: 1.02,
    fps: 61,
    frame: 642,
  });
});

test('reads a multi-hour position and ignores non-stats lines', () => {
  const stats = parseStatsLine('frame=1 fps=0.0 size=0kB time=01:02:03.50 bitrate=0.0kbits/s');
  assert.equal(stats.seconds, 3723.5);
  assert.equal(stats.speed, 0);
  assert.equal(parseStatsLine('Stream #0:0: Video: h264'), null);
  assert.equal(parseStatsLine(undefined), null);
});

test('smooths a fluctuating speed without losing the previous value', () => {
  assert.equal(smoothValue(0, 2), 2);
  assert.equal(smoothValue(2, 4, 0.5), 3);
  assert.equal(smoothValue(3, 0), 3);
  assert.equal(smoothValue(0, Number.NaN), 0);
});

test('estimates the remaining time from the FFmpeg speed', () => {
  const eta = estimateEtaSeconds({ mediaSeconds: 10, duration: 40, ratio: 0.25, speed: 2 });
  // 30 media seconds left, produced two per wall second.
  assert.equal(eta, 15);
});

test('falls back to the elapsed time when no speed is reported', () => {
  const eta = estimateEtaSeconds({
    mediaSeconds: 25,
    duration: 50,
    ratio: 0.5,
    speed: 0,
    elapsedMs: 10000,
  });
  assert.equal(eta, 10);
});

test('returns 0 when the duration is unknown or already reached', () => {
  assert.equal(estimateEtaSeconds({ mediaSeconds: 10, duration: 0, speed: 2 }), 0);
  assert.equal(estimateEtaSeconds({ mediaSeconds: 40, duration: 40, speed: 2 }), 0);
  assert.equal(
    estimateEtaSeconds({ mediaSeconds: 1, duration: 40, ratio: 0.001, speed: 0, elapsedMs: 200 }),
    0,
  );
});

test('formats a short ETA', () => {
  assert.equal(formatEta(8), '8 s');
  assert.equal(formatEta(83), '1:23');
  assert.equal(formatEta(3783), '1:03:03');
});

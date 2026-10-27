import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAutocutArgs,
  buildFilterGraph,
  buildSilenceArgs,
  computeKeepSegments,
  computePreviewWindow,
  parseSilenceLogs,
  totalKeptDuration,
} from '../script/features/autocut/silence.js';
import { hasRenderParamsChanged, renderParamsOf } from '../script/features/autocut/autocut-fields.js';
import { buildFastcutArgs } from '../script/features/fastcut/fastcut-processor.js';
import { buildReverseArgs } from '../script/features/reverse/reverse-processor.js';
import {
  formatDuration,
  formatNumber,
  formatTimecode,
  parseTimecode,
  splitTimecode,
} from '../script/core/timecode.js';

const PROCESSING = {
  videoCodec: 'libx264',
  preset: 'veryfast',
  crf: 23,
  pixelFormat: 'yuv420p',
  audioCodec: 'aac',
  audioBitrate: '128k',
};

test('parses silencedetect log lines', () => {
  const logs = [
    '[silencedetect @ 0x1] silence_start: 2.5',
    '[silencedetect @ 0x1] silence_end: 4.75 | silence_duration: 2.25',
    '[silencedetect @ 0x1] silence_start: 8',
    '[silencedetect @ 0x1] silence_end: 9.2 | silence_duration: 1.2',
  ];

  assert.deepEqual(parseSilenceLogs(logs), [
    { start: 2.5, end: 4.75 },
    { start: 8, end: 9.2 },
  ]);
});

test('keeps an unterminated trailing silence open', () => {
  const logs = ['silence_start: 6.5'];
  assert.deepEqual(parseSilenceLogs(logs), [{ start: 6.5, end: null }]);
});

test('applies pre-cut and post-cut margins to speech blocks', () => {
  const segments = computeKeepSegments(
    [
      { start: 2, end: 4 },
      { start: 6, end: 8 },
    ],
    10,
    { preCut: 0.15, postCut: 0.2, minSegment: 0.1 },
  );

  assert.deepEqual(segments, [
    { start: 0, end: 2.2 },
    { start: 3.85, end: 6.2 },
    { start: 7.85, end: 10 },
  ]);
});

test('merges overlapping silences and segments made adjacent by margins', () => {
  const segments = computeKeepSegments(
    [
      { start: 2, end: 3 },
      { start: 2.5, end: 4 },
      { start: 4.2, end: 6 },
    ],
    10,
    { preCut: 1.5, postCut: 1.5, minSegment: 0.1 },
  );

  assert.deepEqual(segments, [{ start: 0, end: 10 }]);
});

test('treats an open trailing silence as silence until the end', () => {
  const segments = computeKeepSegments([{ start: 7, end: null }], 10, {
    preCut: 0,
    postCut: 1,
    minSegment: 0.1,
  });

  assert.deepEqual(segments, [{ start: 0, end: 8 }]);
});

test('returns a single segment when no silence is detected', () => {
  const segments = computeKeepSegments([], 12.5, { preCut: 0.2, postCut: 0.2, minSegment: 0.25 });
  assert.deepEqual(segments, [{ start: 0, end: 12.5 }]);
});

test('drops blocks shorter than the minimum segment duration', () => {
  const segments = computeKeepSegments(
    [
      { start: 0, end: 5 },
      { start: 5.2, end: 9.9 },
    ],
    10,
    { preCut: 0, postCut: 0, minSegment: 0.5 },
  );

  assert.deepEqual(segments, []);
});

test('drops clips shorter than the minimum clip duration', () => {
  const segments = computeKeepSegments(
    [
      { start: 1, end: 2 },
      { start: 5, end: 6 },
      { start: 7, end: 8 },
    ],
    10,
    { preCut: 0, postCut: 0, minSegment: 1.5 },
  );

  assert.deepEqual(segments, [
    { start: 2, end: 5 },
    { start: 8, end: 10 },
  ]);
});

test('a minimum clip duration of zero keeps even very short clips', () => {
  const segments = computeKeepSegments([{ start: 0.1, end: 9.8 }], 10, {
    preCut: 0,
    postCut: 0,
    minSegment: 0,
  });

  assert.deepEqual(segments, [
    { start: 0, end: 0.1 },
    { start: 9.8, end: 10 },
  ]);
});

test('clamps margins and ignores invalid durations', () => {
  assert.deepEqual(computeKeepSegments([], 0), []);
  assert.deepEqual(computeKeepSegments([], 4, { preCut: 10, postCut: 10, minSegment: 0.1 }), [
    { start: 0, end: 4 },
  ]);
});

test('builds a trim/concat filter graph with audio', () => {
  const graph = buildFilterGraph(
    [
      { start: 0, end: 2.2 },
      { start: 3.85, end: 6.2 },
    ],
    true,
  );

  assert.equal(
    graph,
    '[0:v]trim=start=0.000:end=2.200,setpts=PTS-STARTPTS[v0];' +
      '[0:a]atrim=start=0.000:end=2.200,asetpts=PTS-STARTPTS[a0];' +
      '[0:v]trim=start=3.850:end=6.200,setpts=PTS-STARTPTS[v1];' +
      '[0:a]atrim=start=3.850:end=6.200,asetpts=PTS-STARTPTS[a1];' +
      '[v0][a0][v1][a1]concat=n=2:v=1:a=1[vout][aout]',
  );
});

test('silence analysis command seeks and limits the window', () => {
  const args = buildSilenceArgs({
    input: 'in.mp4',
    thresholdDb: -30,
    minSilence: 0.5,
    seek: 12.345,
    length: 60,
  });

  assert.deepEqual(args.slice(0, 4), ['-hide_banner', '-ss', '12.345', '-i']);
  assert.ok(args.includes('silencedetect=noise=-30.00dB:d=0.50'));
  assert.ok(args.includes('-vn'));
  assert.equal(args.at(-1), '-');
});

test('autocut command maps the concatenated video and audio', () => {
  const args = buildAutocutArgs({
    input: 'in.mp4',
    output: 'out.mp4',
    segments: [{ start: 0, end: 2.2 }],
    hasAudio: true,
    processing: PROCESSING,
  });

  assert.ok(args.includes('-filter_complex'));
  assert.deepEqual(args.slice(args.indexOf('-map'), args.indexOf('-map') + 4), ['-map', '[vout]', '-map', '[aout]']);
  assert.ok(args.includes('libx264'));
  assert.equal(args.at(-1), 'out.mp4');
});

test('preview window is one minute at the middle of the video', () => {
  assert.deepEqual(computePreviewWindow(600, 60), { seek: 270, length: 60 });
  assert.deepEqual(computePreviewWindow(30, 60), { seek: 0, length: 30 });
  assert.deepEqual(computePreviewWindow(0, 60), { seek: 0, length: 0 });
});

test('fastcut command cuts with accurate re-encoding', () => {
  const args = buildFastcutArgs({
    input: 'in.mp4',
    output: 'out.mp4',
    start: 4,
    duration: 6,
    processing: PROCESSING,
  });

  assert.deepEqual(args.slice(0, 4), ['-hide_banner', '-ss', '4.000', '-i']);
  assert.deepEqual(args.slice(args.indexOf('-t'), args.indexOf('-t') + 2), ['-t', '6.000']);
  assert.ok(args.includes('0:a:0?'));
  assert.equal(args.at(-1), 'out.mp4');
});

test('reverse command reverses audio only when present', () => {
  const withAudio = buildReverseArgs({
    input: 'in.mp4',
    output: 'out.mp4',
    hasAudio: true,
    processing: PROCESSING,
  });
  const silent = buildReverseArgs({
    input: 'in.mp4',
    output: 'out.mp4',
    hasAudio: false,
    processing: PROCESSING,
  });

  assert.ok(withAudio.includes('areverse'));
  assert.ok(withAudio.includes('reverse'));
  assert.ok(!silent.includes('areverse'));
});

test('sums the kept segments into the estimated output duration', () => {
  const segments = computeKeepSegments(
    [
      { start: 3, end: 5 },
      { start: 8, end: 9.5 },
    ],
    12,
    { preCut: 0.15, postCut: 0.2, minSegment: 0.25 },
  );

  assert.equal(totalKeptDuration(segments), 9.2);
  assert.equal(totalKeptDuration([]), 0);
});

test('detects when the effective render parameters changed', () => {
  const base = {
    thresholdDb: -30,
    preCut: 0.15,
    postCut: 0.2,
    minClipDuration: 0.25,
    suffix: '-autocut',
  };
  const snapshot = renderParamsOf(base);

  assert.equal(hasRenderParamsChanged(snapshot, { ...base, suffix: '-other' }), false);
  assert.equal(hasRenderParamsChanged(snapshot, { ...base }), false);
  assert.equal(hasRenderParamsChanged(snapshot, { ...base, minClipDuration: 0.5 }), true);
  assert.equal(hasRenderParamsChanged(snapshot, { ...base, thresholdDb: -35 }), true);
  assert.equal(hasRenderParamsChanged(null, base), true);
});

test('timecode helpers round-trip', () => {
  assert.equal(formatTimecode(3723.4), '01:02:03');
  assert.equal(formatDuration(3723), '1:02:03');
  assert.equal(formatDuration(83), '1:23');
  assert.equal(parseTimecode('01:02:03'), 3723);
  assert.equal(parseTimecode('02:03'), 123);
  assert.equal(parseTimecode('45'), 45);
  assert.equal(parseTimecode('aa:bb'), null);
  assert.deepEqual(splitTimecode(3723), { hours: 1, minutes: 2, seconds: 3 });
  assert.equal(formatNumber(0.15000000000000002, 2), '0.15');
  assert.equal(formatNumber(30, 0), '30');
});

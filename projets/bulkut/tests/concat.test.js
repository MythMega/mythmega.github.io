import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildConcatArgs,
  buildConcatFilterGraph,
  concatTargetSize,
  totalClipsDuration,
} from '../script/features/shared/concat.js';

const PROCESSING = {
  videoCodec: 'libx264',
  preset: 'veryfast',
  crf: 23,
  pixelFormat: 'yuv420p',
  audioCodec: 'aac',
  audioBitrate: '128k',
  concatFps: 30,
};

test('uses the largest clip as the reference and keeps dimensions even', () => {
  assert.deepEqual(
    concatTargetSize([
      { width: 641, height: 361 },
      { width: 1280, height: 720 },
    ]),
    { width: 1280, height: 720 },
  );

  assert.deepEqual(concatTargetSize([{ width: 1919, height: 1079 }]), {
    width: 1920,
    height: 1080,
  });
});

test('falls back to 1280x720 when no clip exposes its size', () => {
  assert.deepEqual(concatTargetSize([{}]), { width: 1280, height: 720 });
});

test('normalises every input and concatenates video and audio', () => {
  const graph = buildConcatFilterGraph(
    [
      { hasAudio: true, duration: 3 },
      { hasAudio: false, duration: 2 },
    ],
    { width: 640, height: 360, fps: 30, pixelFormat: 'yuv420p' },
  );

  assert.match(graph, /\[0:v\]scale=640:360:force_original_aspect_ratio=decrease/);
  assert.match(graph, /pad=640:360:\(ow-iw\)\/2:\(oh-ih\)\/2:color=black/);
  assert.match(graph, /\[0:a\]aresample=48000/);
  assert.match(graph, /apad,atrim=0:3\.000/);
  // The silent clip gets a stereo silence track of its own length.
  assert.match(graph, /anullsrc=channel_layout=stereo:sample_rate=48000:d=2\.000/);
  assert.match(graph, /\[v0\]\[a0\]\[v1\]\[a1\]concat=n=2:v=1:a=1\[vout\]\[aout\]/);
});

test('keeps the graph video-only when no clip has audio', () => {
  const graph = buildConcatFilterGraph([{ hasAudio: false, duration: 4 }], {
    width: 1280,
    height: 720,
  });

  assert.doesNotMatch(graph, /anullsrc/);
  assert.match(graph, /concat=n=1:v=1:a=0\[vout\]$/);
});

test('builds one FFmpeg command with an input per clip', () => {
  const clips = [
    { hasAudio: true, duration: 2.5, width: 640, height: 360 },
    { hasAudio: true, duration: 1.5, width: 640, height: 360 },
  ];

  const { args, duration } = buildConcatArgs({
    inputs: ['/in/a.mp4', '/in/b.mp4'],
    clips,
    output: 'out.mp4',
    processing: PROCESSING,
  });

  assert.equal(duration, 4);

  const inputs = args.reduce(
    (found, value, index) => (value === '-i' ? [...found, args[index + 1]] : found),
    [],
  );
  assert.deepEqual(inputs, ['/in/a.mp4', '/in/b.mp4']);

  assert.ok(args.includes('-filter_complex'));
  assert.deepEqual(args.slice(-6), ['-movflags', '+faststart', '-map_metadata', '-1', '-y', 'out.mp4']);
  assert.equal(args.at(-1), 'out.mp4');
  assert.ok(args.includes('libx264'));
  assert.ok(args.includes('-r'));
});

test('sums clip durations without float noise', () => {
  assert.equal(
    totalClipsDuration([{ duration: 0.1 }, { duration: 0.2 }, { duration: 0.3 }]),
    0.6,
  );
});

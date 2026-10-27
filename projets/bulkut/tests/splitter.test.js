import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSplitArgs } from '../script/features/splitter/splitter-processor.js';

const PROCESSING = {
  videoCodec: 'libx264',
  preset: 'veryfast',
  crf: 23,
  pixelFormat: 'yuv420p',
  audioCodec: 'aac',
  audioBitrate: '128k',
};

test('split segments use their own range and final-file fades', () => {
  const args = buildSplitArgs({
    input: 'in.mp4',
    output: 'out.mp4',
    start: 4,
    end: 9,
    hasAudio: true,
    processing: PROCESSING,
    fade: { audio: 'both', video: 'out', duration: 0.5 },
  });

  assert.equal(args[args.indexOf('-ss') + 1], '4.000');
  assert.equal(args[args.indexOf('-t') + 1], '5.000');
  assert.equal(args[args.indexOf('-vf') + 1], 'fade=t=out:st=4.500:d=0.500');
  assert.equal(
    args[args.indexOf('-af') + 1],
    'afade=t=in:st=0:d=0.500,afade=t=out:st=4.500:d=0.500',
  );
});

test('split skips the audio fade for a silent source', () => {
  const args = buildSplitArgs({
    input: 'in.mp4',
    output: 'out.mp4',
    start: 0,
    end: 2,
    hasAudio: false,
    processing: PROCESSING,
    fade: { audio: 'both', video: 'none', duration: 1 },
  });

  assert.equal(args.includes('-af'), false);
  assert.equal(args.includes('-vf'), false);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildConvertArgs,
  normalizeBitrateChoice,
  parseEncoders,
  parseMuxers,
  resolveConvertTargets,
} from '../script/core/convert.js';

const MUXERS = [
  'File formats:',
  ' D. = Demuxing supported',
  ' .E = Muxing supported',
  ' --',
  ' DE matroska        Matroska',
  '  E mp4             MP4 (MPEG-4 Part 14)',
  '  E mov             QuickTime / MOV',
  '  E avi             AVI (Audio Video Interleaved)',
  '  E webm            WebM',
];

const ENCODERS = [
  'Encoders:',
  ' V..... libx264          libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10',
  ' V..... libvpx-vp9       libvpx VP9',
  ' V..... mpeg4            MPEG-4 part 2',
  ' A..... aac              AAC (Advanced Audio Coding)',
  ' A..... libopus          libopus Opus',
  ' A..... libmp3lame       libmp3lame MP3 (MPEG audio layer 3)',
];

test('muxers and encoders are read from the ffmpeg listings', () => {
  const muxers = parseMuxers(MUXERS);
  assert.deepEqual([...muxers].sort(), ['avi', 'matroska', 'mov', 'mp4', 'webm']);

  const { video, audio } = parseEncoders(ENCODERS);
  assert.equal(video.has('libx264'), true);
  assert.equal(video.has('libvpx-vp9'), true);
  assert.equal(audio.has('aac'), true);
  assert.equal(audio.has('libmp3lame'), true);
});

test('only the formats this build can write are offered', () => {
  const { video, audio } = parseEncoders(ENCODERS);
  const targets = resolveConvertTargets({ muxers: parseMuxers(MUXERS), encoders: { video, audio } });

  assert.deepEqual(
    targets.map((target) => target.id),
    ['mp4', 'mov', 'mkv', 'avi', 'webm'],
  );
  assert.equal(targets.find((target) => target.id === 'webm').videoCodec, 'libvpx-vp9');
  assert.equal(targets.find((target) => target.id === 'avi').videoCodec, 'mpeg4');

  const withoutVp9 = new Set([...video].filter((codec) => codec !== 'libvpx-vp9' && codec !== 'libvpx'));
  const reduced = resolveConvertTargets({
    muxers: parseMuxers(MUXERS),
    encoders: { video: withoutVp9, audio },
  });
  assert.equal(reduced.some((target) => target.id === 'webm'), false);
});

test('a format without a usable audio encoder is kept, without audio', () => {
  const targets = resolveConvertTargets({
    muxers: new Set(['webm']),
    encoders: { video: new Set(['libvpx']), audio: new Set(['aac']) },
  });

  assert.equal(targets.length, 1);
  assert.equal(targets[0].id, 'webm');
  assert.equal(targets[0].audioCodec, null);
  assert.equal(buildConvertArgs({ input: 'in.mp4', output: 'out.webm', target: targets[0] }).includes('-an'), true);
});

test('auto bitrate leaves the choice to ffmpeg, custom sets kbps', () => {
  const [mp4] = resolveConvertTargets({
    muxers: parseMuxers(MUXERS),
    encoders: parseEncoders(ENCODERS),
  });

  const auto = buildConvertArgs({ input: 'in.mp4', output: 'out.mp4', target: mp4, processing: { preset: 'fast' } });
  assert.equal(auto.includes('-b:v'), false);
  assert.equal(auto.includes('-b:a'), false);
  assert.equal(auto[auto.indexOf('-preset') + 1], 'fast');

  const custom = buildConvertArgs({
    input: 'in.mp4',
    output: 'out.mp4',
    target: mp4,
    videoBitrate: '2500',
    audioBitrate: '128',
  });
  assert.equal(custom[custom.indexOf('-b:v') + 1], '2500k');
  assert.equal(custom[custom.indexOf('-b:a') + 1], '128k');
  assert.equal(custom.includes('+faststart'), true);
});

test('bitrate values are normalized and clamped', () => {
  assert.equal(normalizeBitrateChoice('auto'), 'auto');
  assert.equal(normalizeBitrateChoice(''), 'auto');
  assert.equal(normalizeBitrateChoice('abc'), 'auto');
  assert.equal(normalizeBitrateChoice(-4), 'auto');
  assert.equal(normalizeBitrateChoice('2500.4'), '2500');
  assert.equal(normalizeBitrateChoice(12), '100');
  assert.equal(normalizeBitrateChoice(999999), '100000');
});

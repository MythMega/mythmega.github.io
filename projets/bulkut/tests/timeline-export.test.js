import assert from 'node:assert/strict';
import test from 'node:test';

import { parseMediaInfo } from '../script/core/media-probe.js';
import {
  isTimelineFormat,
  normalizeOutputFormat,
  outputExtension,
} from '../script/core/output-format.js';
import { hasRenderParamsChanged, renderParamsOf } from '../script/features/autocut/autocut-fields.js';
import { buildDavinciFcpxml, buildPremiereXml } from '../script/features/autocut/timeline-export.js';

const SOURCE = {
  name: 'interview.mp4',
  mediaPath: './interview.mp4',
  duration: 10,
  width: 1920,
  height: 1080,
  fps: 30,
  hasAudio: true,
};

test('normalises output choices and their extensions', () => {
  assert.equal(normalizeOutputFormat('premiere'), 'premiere');
  assert.equal(normalizeOutputFormat('unknown'), 'video');
  assert.equal(outputExtension('premiere'), 'xml');
  assert.equal(outputExtension('davinci'), 'fcpxml');
  assert.equal(outputExtension('video'), 'mp4');
  assert.equal(isTimelineFormat('davinci'), true);
  assert.equal(isTimelineFormat('video'), false);
});

test('writes Premiere clips with timeline and source frame ranges', () => {
  const xml = buildPremiereXml({
    ...SOURCE,
    segments: [
      { start: 0, end: 2 },
      { start: 3.5, end: 5 },
    ],
  });

  assert.match(xml, /<xmeml version="5">/);
  assert.match(xml, /<duration>105<\/duration>/);
  assert.match(xml, /<pathurl>\.\/interview\.mp4<\/pathurl>/);
  assert.match(xml, /<start>0<\/start>\s*<end>60<\/end>\s*<in>0<\/in>\s*<out>60<\/out>/);
  assert.match(xml, /<start>60<\/start>\s*<end>105<\/end>\s*<in>105<\/in>\s*<out>150<\/out>/);
  assert.equal((xml.match(/<clipitem id="clipitem-/g) ?? []).length, 6);
});

test('writes DaVinci clips using exact NTSC frame durations', () => {
  const xml = buildDavinciFcpxml({
    ...SOURCE,
    fps: 59.94,
    segments: [{ start: 1, end: 3 }],
  });

  assert.match(xml, /<fcpxml version="1.10">/);
  assert.match(xml, /frameDuration="1001\/60000s"/);
  assert.match(xml, /<media-rep kind="original-media" src="\.\/interview\.mp4" \/>/);
  assert.match(xml, /offset="0s" duration="120120\/60000s" start="60060\/60000s"/);
});

test('escapes names and keeps folder paths intact', () => {
  const xml = buildPremiereXml({
    ...SOURCE,
    name: 'A & B.mp4',
    mediaPath: 'C:\\Videos\\A & B.mp4',
    segments: [{ start: 0, end: 1 }],
  });

  assert.match(xml, /A &amp; B/);
  assert.match(xml, /C:\\Videos\\A &amp; B\.mp4/);
});

test('reads the frame rate printed by ffmpeg', () => {
  const info = parseMediaInfo([
    'Duration: 00:00:10.00, start: 0.000000, bitrate: 2400 kb/s',
    'Stream #0:0(und): Video: h264 (High), yuv420p, 1920x1080, 59.94 fps, 59.94 tbr',
    'Stream #0:1(und): Audio: aac, 48000 Hz, stereo',
  ]);

  assert.equal(info.fps, 59.94);
  assert.equal(info.width, 1920);
  assert.equal(info.height, 1080);
});

test('the output format triggers a stale render', () => {
  const params = { thresholdDb: -30, preCut: 0.15, postCut: 0.2, minClipDuration: 0.25, output: 'video' };
  const previous = renderParamsOf(params);

  assert.equal(hasRenderParamsChanged(previous, params), false);
  assert.equal(hasRenderParamsChanged(previous, { ...params, output: 'premiere' }), true);
});

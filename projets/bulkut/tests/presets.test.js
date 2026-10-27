import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_PRESET_NAME_LENGTH,
  decodePresets,
  encodePresets,
  isPresetNameTaken,
  sanitizePresetName,
} from '../script/core/presets.js';

test('preset names are trimmed, collapsed and capped', () => {
  assert.equal(sanitizePresetName('  My   podcast \n '), 'My podcast');
  assert.equal(sanitizePresetName('a\u0000b\u001fc'), 'abc');
  assert.equal(sanitizePresetName(null), '');
  assert.equal(sanitizePresetName('x'.repeat(80)).length, MAX_PRESET_NAME_LENGTH);
});

test('preset names are unique per tab, ignoring case and spacing', () => {
  const presets = [{ id: '1', name: 'Podcast' }];
  assert.equal(isPresetNameTaken(presets, ' podcast '), true);
  assert.equal(isPresetNameTaken(presets, 'PODCAST'), true);
  assert.equal(isPresetNameTaken(presets, 'Vlog'), false);
  assert.equal(isPresetNameTaken(presets, '   '), false);
});

test('presets round-trip through the cookie encoding', () => {
  const presets = [
    {
      id: 'a',
      name: 'Podcast',
      createdAt: '2026-01-02T03:04:05.000Z',
      values: { thresholdDb: -32, preCut: 0.2, suffix: '-pod' },
    },
  ];
  assert.deepEqual(decodePresets(encodePresets(presets)), presets);
});

test('corrupted cookies never throw and are treated as empty', () => {
  assert.deepEqual(decodePresets(''), []);
  assert.deepEqual(decodePresets('%E0%A4%A'), []);
  assert.deepEqual(decodePresets(encodeURIComponent('{"v":1}')), []);
  assert.deepEqual(
    decodePresets(
      encodeURIComponent(
        JSON.stringify({
          v: 1,
          presets: [
            { id: '1', name: '  ', values: { suffix: '-x' } },
            { id: '2', name: 'No values' },
            { id: '3', name: 'Bad values', values: [1, 2] },
            null,
          ],
        }),
      ),
    ),
    [],
  );
});

test('decoded presets get a sanitised name and a fallback date', () => {
  const [preset] = decodePresets(
    encodeURIComponent(
      JSON.stringify({ v: 1, presets: [{ id: '1', name: '  Tight   cuts ', values: { suffix: '-t' } }] }),
    ),
  );
  assert.equal(preset.name, 'Tight cuts');
  assert.equal(preset.createdAt, '');
  assert.deepEqual(preset.values, { suffix: '-t' });
});

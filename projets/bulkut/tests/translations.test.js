import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const LANGUAGES = ['en', 'fr', 'es'];

/** @param {string} file */
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));

/** @param {Record<string, any>} source @param {string} [prefix] @returns {string[]} */
function flatten(source, prefix = '') {
  return Object.entries(source).flatMap(([key, value]) =>
    value && typeof value === 'object' ? flatten(value, `${prefix}${key}.`) : [`${prefix}${key}`],
  );
}

/** @param {string} dir @param {string[]} files */
function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (full.endsWith('.js') || full.endsWith('.html')) files.push(full);
  }
  return files;
}

function collectUsedKeys() {
  const keys = new Set();
  const sources = [path.join(ROOT, 'index.html'), ...walk(path.join(ROOT, 'script'))];

  for (const file of sources) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\bt\(\s*['`"]([\w.-]+)['`"]/g)) keys.add(match[1]);
    for (const match of source.matchAll(/\bt\(\s*`([\w.-]+)`/g)) keys.add(match[1]);
    for (const match of source.matchAll(/data-i18n(?:-[a-z-]+)?=["']([\w.-]+)["']/g)) keys.add(match[1]);
    for (const match of source.matchAll(/(?:labelKey|hintKey):\s*'([\w.-]+)'/g)) keys.add(match[1]);
  }

  return keys;
}

const translations = Object.fromEntries(LANGUAGES.map((lang) => [lang, readJson(`translations/${lang}.json`)]));
const baseKeys = flatten(translations.en).sort();

test('all languages expose the same keys', () => {
  for (const lang of LANGUAGES.slice(1)) {
    assert.deepEqual(flatten(translations[lang]).sort(), baseKeys, `key mismatch in ${lang}.json`);
  }
});

test('every translation is a non-empty string', () => {
  for (const lang of LANGUAGES) {
    const flat = flatten(translations[lang]);
    for (const key of flat) {
      const value = key.split('.').reduce((current, part) => current?.[part], translations[lang]);
      assert.equal(typeof value, 'string', `${lang}.${key} should be a string`);
      assert.ok(value.trim().length > 0, `${lang}.${key} should not be empty`);
    }
  }
});

test('every key used by the app exists in en.json', () => {
  const known = new Set(baseKeys);
  const missing = [...collectUsedKeys()].filter((key) => !known.has(key)).sort();
  assert.deepEqual(missing, [], `missing keys: ${missing.join(', ')}`);
});

test('dynamic key families are complete', () => {
  const dynamic = [
    ...['idle', 'loading', 'ready', 'error'].map((status) => `engine.${status}`),
    ...['ready', 'queued', 'preparing', 'analyzing', 'rendering', 'done', 'error'].map((status) => `common.${status}`),
    ...[
      'duration',
      'noAudio',
      'noSegments',
      'tooManySegments',
      'noVideoStream',
      'renderFailed',
      'ffmpegLoad',
      'ffmpegUnavailable',
      'unknown',
    ].map((code) => `errors.${code}`),
    ...['threshold', 'thresholdHint', 'precut', 'precutHint', 'postcut', 'postcutHint', 'minClip', 'minClipHint'].map(
      (field) => `autocut.fields.${field}`,
    ),
  ];
  const known = new Set(baseKeys);
  assert.deepEqual(dynamic.filter((key) => !known.has(key)), []);
});

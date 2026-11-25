/**
 * Interface tests - the promises the shell makes about its own DOM.
 *
 * These are static checks of `index.html`: the menu order, the UTC label of the menu clock, the
 * numeric control of the "store as bonus" dialog and the single level-1 heading. They are cheap
 * (one read) and they break the run when a later edit reorders the menu, moves the clock back
 * after the time or drops a control the dialog needs.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { readText } from '../lint/lib/repo.mjs';

const PAGE = readText('index.html');

/**
 * Returns the offset of a snippet, failing with the snippet when it is gone.
 *
 * @param {string} snippet - Text to find.
 * @param {number} [from=0] - Offset where the search starts.
 * @returns {number} The offset.
 */
function offsetOf(snippet, from = 0) {
  const index = PAGE.indexOf(snippet, from);
  assert.notEqual(index, -1, `index.html no longer contains: ${snippet}`);
  return index;
}

test('the menu starts with settings and keeps inventory and daily reward under the AI policy', () => {
  const menu = PAGE.slice(offsetOf('<div class="app-menu"'), offsetOf('<div class="app-fatal"'));
  const needles = [
    'data-nav-target="settings"',
    'data-nav-target="info"',
    'data-nav-target="data-policy"',
    'data-nav-target="ai-policy"',
    'data-menu-inventory',
    'data-menu-daily-rewards',
    'data-nav-target="profile"',
    'data-nav-target="social"',
  ];
  const offsets = needles.map((needle) => {
    const index = menu.indexOf(needle);
    assert.notEqual(index, -1, `the menu has no ${needle} entry`);
    return index;
  });

  assert.deepEqual(
    offsets,
    [...offsets].sort((left, right) => left - right),
    'the menu entries are not in the expected order'
  );
});

test('the menu clock always writes UTC before the time', () => {
  const start = offsetOf('<time class="app-menu__clock"');
  const clock = PAGE.slice(start, offsetOf('</time>', start));
  const utc = clock.indexOf('data-i18n="header.clock.utc"');
  const time = clock.indexOf('data-app-menu-clock-time');

  assert.notEqual(utc, -1, 'the menu clock has no UTC label');
  assert.notEqual(time, -1, 'the menu clock has no time element');
  assert.ok(utc < time, 'the UTC label must come before the time');
});

test('the store dialog offers a 1 to 3 numeric control', () => {
  const start = offsetOf('data-opening-store-modal');
  const dialog = PAGE.slice(start, offsetOf('data-opening-store-sets', start));
  const input = /<input[^>]*data-opening-store-count[^>]*>/.exec(dialog)?.[0] ?? '';

  assert.match(input, /type="number"/, 'the quantity must be a number input');
  assert.match(input, /min="1"/, 'the quantity starts at one');
  assert.match(input, /max="3"/, 'the quantity stops at three');
  assert.match(dialog, /data-opening-store-step="-1"/, 'the dialog has no down step');
  assert.match(dialog, /data-opening-store-step="1"/, 'the dialog has no up step');
});

test('the page keeps exactly one level-1 heading, hidden but readable', () => {
  assert.equal((PAGE.match(/<h1\b/g) ?? []).length, 1, 'the page must have a single h1');
  assert.match(
    PAGE,
    /<h1 class="sr-only" data-i18n="app\.title">/,
    'the h1 must stay screen-reader only (the bar no longer prints the brand)'
  );
});

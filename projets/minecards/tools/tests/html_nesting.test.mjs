/**
 * HtmlNesting tests - a page must close its elements in the order it opened them.
 *
 * The regression pinned here is the settings tabs: `#settings-panel-account` had lost its `</div>`,
 * so the Gift, Premium, Notes de mise a jour and Rapport d'erreurs panels became its CHILDREN and
 * inherited its `display: none`. Everything was in the DOM, every browser said nothing, and the four
 * tabs simply looked empty. A tag COUNT does not catch it (the end tag meant for the outer panel
 * closes the inner one); comparing the nesting against the document does.
 *
 * The cases below pin both halves of the contract:
 *   - the shape of that bug is reported, at the line of the element left open;
 *   - the legal forms of HTML are NOT reported (void elements, self-closing foreign content, raw
 *     text, optional end tags, a quoted `>` in an attribute, a tag written in a comment), because a
 *     rule that cries on valid markup gets switched off;
 *   - every page the linter inspects is clean, so the next unclosed tag breaks the run instead of
 *     the settings screen. The list comes from the linter itself, never from a copy of it.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { findHtmlNestingIssues } from '../lint/lib/html.mjs';
import { listFiles, readText } from '../lint/lib/repo.mjs';

/** Every page the rule applies to: the same set the linter walks, minus the other extensions. */
const PAGES = listFiles().filter((file) => file.endsWith('.html'));

test('a page that closes everything is clean', () => {
  const page = [
    '<section class="panel">',
    '  <h3 class="settings__title">Titre</h3>',
    '  <div class="settings__actions"><button type="button">Ok</button></div>',
    '</section>',
  ].join('\n');
  assert.deepEqual(findHtmlNestingIssues(page), []);
});

test('a panel left open is reported at the element that is never closed', () => {
  // The exact shape of the regression: the account panel forgets its `</div>`, so the panel that
  // follows becomes its child and every closing tag lands one element too deep. The settings block
  // is the element the browser then has to close itself, at the end of its own section.
  const page = [
    '<section class="view" data-view="settings">',
    '  <div class="settings">',
    '    <div class="settings__tabpanel" id="settings-panel-appearance">',
    '      <section class="panel"></section>',
    '    </div>',
    '    <div class="settings__tabpanel" id="settings-panel-account">',
    '      <section class="panel"></section>',
    '    <div class="settings__tabpanel" id="settings-panel-gift">',
    '      <section class="panel"></section>',
    '    </div>',
    '  </div>',
    '</section>',
  ].join('\n');

  const findings = findHtmlNestingIssues(page);
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /<div class="settings"> is never closed/);
  assert.match(findings[0].message, /<\/section> on line 12/);
  assert.equal(findings[0].line, 2);
});

test('the reported element is the one left open, not the one that reveals it', () => {
  const page = [
    '<header>',
    '  <div class="menu">',
    '    <span>ok</span>',
    '  <div class="panel">',
    '    <p>texte</p>',
    '  </div>',
    '</header>',
  ].join('\n');

  const findings = findHtmlNestingIssues(page);
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /<div class="menu"> is never closed/);
  assert.match(findings[0].message, /<\/header> on line 7/);
  assert.equal(findings[0].line, 2);
});

test('a closing tag with no opening tag is reported', () => {
  const findings = findHtmlNestingIssues('<div>\n  </span>\n</div>');
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /<\/span> closes nothing/);
  assert.equal(findings[0].line, 2);
});

test('void elements, self-closing tags and raw text are not markup to balance', () => {
  const page = [
    '<!-- <div class="exemple"> non ferme, mais commente -->',
    '<div data-tip="1 > 0" title="a < b">',
    '  <img src="assets/img/card.png" alt="">',
    '  <br>',
    '  <svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z" /></svg>',
    '  <script>for (var i = 0; i < n; i += 1) { if (i > 2) break; }</script>',
    '  <style>a > b { color: red; }</style>',
    '</div>',
  ].join('\n');
  assert.deepEqual(findHtmlNestingIssues(page), []);
});

test('the optional end tags of HTML are accepted where they are omitted', () => {
  const page = [
    '<ul>',
    '  <li>un',
    '  <li>deux',
    '</ul>',
    '<table>',
    '  <tr><td>a<td>b',
    '</table>',
    '<p>un paragraphe',
    '<div>un bloc</div>',
  ].join('\n');
  assert.deepEqual(findHtmlNestingIssues(page), []);
});

test('every page of the project is nested', () => {
  assert.ok(PAGES.length > 0, 'the linter found no HTML page to check');
  PAGES.forEach((file) => {
    assert.deepEqual(findHtmlNestingIssues(readText(file)), [], `${file} is not nested`);
  });
});

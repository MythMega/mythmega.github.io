/**
 * Regression tests for the ONE construction of a generated card, and for the hearts of the UI.
 *
 * A `<card-print>` is built the same way everywhere since the `mini` flag was removed: no view
 * chooses a textless variant, a thumbnail differs only by its SIZE, and the stylesheet alone
 * decides what a tiny box cannot show. Three things can regress silently here:
 *   - a view starts passing `mini` again (or a component keeps a `cardMini` dataset), and the card
 *     of that screen stops matching the others;
 *   - the small-thumbnail rule grows from "hide the series and the rarity symbol" to "hide the
 *     texts", which is the state the game just left;
 *   - the hearts of the interface go back to a mask (`heart.svg`) instead of the two images the
 *     design now ships, the counter being the hardcore heart.
 *
 * These are contracts about source files: they need no DOM and run in milliseconds.
 */

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const ROOT = new URL('../../', import.meta.url);

/**
 * Reads one file of the project.
 *
 * @param {string} relativePath - Path from the project root, with `/` separators.
 * @returns {Promise<string>} The file contents.
 */
async function read(relativePath) {
  return readFile(new URL(relativePath, ROOT), 'utf8');
}

/**
 * Lists every `.js` file under a directory, relative to the project root.
 *
 * @param {string} relativeDir - Directory to walk, with `/` separators.
 * @returns {Promise<string[]>} Paths of the modules found.
 */
async function listModules(relativeDir) {
  const entries = await readdir(new URL(relativeDir, ROOT), { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    const path = `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) {
      paths.push(...(await listModules(path)));
    } else if (entry.name.endsWith('.js')) {
      paths.push(path);
    }
  }
  return paths;
}

/**
 * Extracts the body of the first `@container` block matching a query.
 *
 * The file is small and the rule is a single flat block, so a brace count is enough: a real CSS
 * parser would be a dependency for one assertion.
 *
 * @param {string} css - Stylesheet contents.
 * @param {string} query - `@container` prelude to find, e.g. `(max-width: 4.5rem)`.
 * @returns {string} The declarations inside the block.
 */
function containerBlock(css, query) {
  const start = css.indexOf(`@container ${query}`);
  assert.notEqual(start, -1, `No \`@container ${query}\` rule in the stylesheet.`);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    if (css[index] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, index);
    }
  }
  assert.fail(`The \`@container ${query}\` block is never closed.`);
}

/**
 * Splits a stylesheet into `{selector, body}` rules, skipping at-rule bodies.
 *
 * @param {string} css - Stylesheet contents.
 * @returns {{selector: string, body: string}[]} The plain rules.
 */
function plainRules(css) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  for (const match of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    rules.push({ selector: match[1].trim(), body: match[2] });
  }
  return rules;
}

test('no module builds a textless ("mini") card any more', async () => {
  const modules = await listModules('js');
  const offenders = [];
  for (const path of modules) {
    const source = await read(path);
    // The flag is gone from every option object (`mini:`), every dataset (`cardMini`) and every
    // attribute (`setAttribute('mini'`). "mining" / "miniature" are ordinary words and stay.
    if (/cardMini/.test(source) || /\bmini\s*:/.test(source) || /setAttribute\(\s*'mini'/.test(source)) {
      offenders.push(path);
    }
  }
  assert.deepEqual(offenders, [], 'A module still builds a mini card: every card must look the same.');
});

test('the smallest thumbnails hide the series and the rarity symbol only', async () => {
  const css = await read('css/components/generated-card.css');
  const block = containerBlock(css, '(max-width: 4.5rem)');

  assert.match(block, /\.card-series\s*,?[\s\S]*?\.card-rarity\s*\{[\s\S]*?visibility:\s*hidden/,
    'The small-thumbnail rule must hide the series and the rarity symbol.');
  assert.doesNotMatch(block, /\.card-title(?![-\w])[\s\S]*?visibility:\s*hidden/,
    'The name of a small card must stay visible.');
  assert.doesNotMatch(block, /\.card-text(?![-\w])[\s\S]*?visibility:\s*hidden/,
    'The description of a small card must stay visible.');
});

test('no rule hides the name or the description of a generated card', async () => {
  const css = await read('css/components/generated-card.css');
  const hiding = plainRules(css).filter(({ selector, body }) => {
    const hides = /(visibility|display)\s*:\s*(hidden|none)/.test(body);
    // `.card-title-container` is the wrapper of the name and the series: it must stay too, or the
    // name would go with the series it is asked to keep.
    return hides && /\.card-title|\.card-text/.test(selector);
  });
  assert.deepEqual(hiding, [], 'A generated card must always print its name and its description.');
});

test('the likes counter draws the hardcore heart, the like actions the plain one', async () => {
  const [html, base, social] = await Promise.all([
    read('index.html'),
    read('css/base.css'),
    read('css/views/social.css'),
  ]);

  assert.match(html, /app-header__stat-icon--heart"[^>]*src="assets\/img\/Hardcore_Heart\.webp"/,
    'The header counter must use `assets/img/Hardcore_Heart.webp`.');
  assert.doesNotMatch(`${html}${base}${social}`, /heart\.svg/,
    'No heart of the interface is a mask of `heart.svg` any more.');
  assert.match(social, /url\("\.\.\/\.\.\/assets\/img\/Heart\.webp"\)/,
    'The like actions must draw `assets/img/Heart.webp`.');
});

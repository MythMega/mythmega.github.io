/**
 * markup.mjs - The rules of the stylesheets, of the two pages, and of the files they point at.
 *
 * A path that no longer exists (an illustration renamed, a trophy folder not created yet), a class
 * name that leaves the BEM convention, an `!important` that silences a theme, a duplicated `id` in a
 * page or a file listed in the service worker's precache list but absent from the repository: none
 * of these is visible in a browser until the exact screen that uses it is opened, which is why they
 * belong to a linter rather than to a reviewer.
 */

import path from 'node:path';
import { maskCss, maskHtml, maskJavaScript, splitLines } from '../lib/text.mjs';

/** Extensions searched for asset paths. */
const ASSET_EXTENSIONS = /\.(png|jpe?g|svg|webp|gif|mp3|ogg|wav|glb|json)/;

/** Class name of the BEM convention: `block`, `block__element`, `block--modifier`. */
const BEM_CLASS = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:__[a-z0-9]+(?:-[a-z0-9]+)*)?(?:--[a-z0-9]+(?:-[a-z0-9]+)*)?$/;

/** Prefixes accepted beside BEM: state and scripting hooks (`is-revealed`, `js-scroll-top`). */
const UTILITY_CLASS = /^(?:is|has|no|js)-/;

/** Media query that legitimately needs `!important` to win over every animation of the project. */
const REDUCED_MOTION = /prefers-reduced-motion/;

/** @type {string[]} Trophy rarities, from the most common to the rarest. */
const TROPHY_RARITIES = ['bronze', 'silver', 'gold', 'diamond', 'emerald'];

/**
 * Turns a path written in a file into a project-relative path.
 *
 * @param {string} raw - Raw path (`./assets/img/…`, `/assets/img/…`, `assets/img/…`).
 * @returns {string} The project-relative path.
 */
function normalizeAssetPath(raw) {
  return raw.replace(/^\.?\//, '').replace(/\/{2,}/g, '/');
}

/**
 * Lists the asset paths quoted by a file, ignoring the comments.
 *
 * @param {string} file - Project-relative path of the file.
 * @param {string} text - Raw content of the file.
 * @returns {Array<{path: string, line: number, column: number}>} The quoted asset paths.
 */
function listAssetReferences(file, text) {
  const extension = file.slice(file.lastIndexOf('.'));
  let source;
  if (extension === '.js') source = maskJavaScript(text, { strings: false });
  else if (extension === '.css') source = maskCss(text);
  else if (extension === '.html') source = maskHtml(text);
  else source = text;

  const found = [];
  const pattern = /(?:^|['"(])(\.{0,2}\/)?assets\/[A-Za-z0-9_./-]+/g;
  splitLines(source).forEach((line, index) => {
    [...line.matchAll(pattern)].forEach((match) => {
      const candidate = normalizeAssetPath(match[0].slice(match[0].indexOf('assets/')));
      if (!ASSET_EXTENSIONS.test(candidate)) return;
      found.push({ path: candidate, line: index + 1, column: match.index + 1 });
    });
  });
  return found;
}

/**
 * Lists the medals the trophy catalogue expects, folder by folder.
 *
 * The layout mirrored here is the one documented by `js/business/TrophyManager.js`. Deriving it from
 * the settings files rather than from the code is deliberate: the two must agree, and a folder the
 * code would look for is exactly what this rule has to check.
 *
 * @param {object} context - Rule context.
 * @returns {Array<{settings: string, line: number, folder: string, rarities: string[]}>} One entry
 *   per folder of medals, with the rarities its tiers declare.
 */
function listExpectedMedals(context) {
  /** @type {Array<{settings: string, line: number, folder: string, rarities: string[]}>} */
  const folders = [];
  const lineOfCounter = (text, key) => {
    const index = text.indexOf(`"${key}"`);
    return index === -1 ? 1 : text.slice(0, index).split('\n').length;
  };

  /**
   * Reads the rarity keys of a tier table.
   *
   * @param {object} table - `{ bronze: … , silver: … }`, possibly with `_comment` entries.
   * @returns {string[]} The rarity names, in source order.
   */
  const raritiesOf = (table) =>
    Object.keys(table ?? {}).filter((key) => !key.startsWith('_') && table[key] !== undefined);

  const globalFile = 'settings/global_trophy.json';
  const globalText = context.readText(globalFile);
  const global = context.readJsonValue(globalFile);
  const mining = context.readJsonValue('settings/mining.json');
  const blockIds = (Array.isArray(mining?.Blocks) ? mining.Blocks : [])
    .map((block) => block?.ID)
    .filter((id) => typeof id === 'string');

  Object.entries(global ?? {}).forEach(([key, tiers]) => {
    if (key.startsWith('_')) return;
    if (key.toLowerCase() === 'miningeachblock') {
      blockIds.forEach((blockId) => {
        folders.push({
          settings: globalFile,
          line: lineOfCounter(globalText, key),
          folder: `assets/img/trophy/Global/miningEachBlock/${blockId}`,
          rarities: raritiesOf(tiers)
        });
      });
      return;
    }
    if (key.toLowerCase() === 'minepickspecificpicks') {
      for (let rarity = 1; rarity <= 5; rarity += 1) {
        folders.push({
          settings: globalFile,
          line: lineOfCounter(globalText, key),
          folder: `assets/img/trophy/Global/minepickSpecificPicks/${rarity}`,
          rarities: raritiesOf(tiers)
        });
      }
      return;
    }
    folders.push({
      settings: globalFile,
      line: lineOfCounter(globalText, key),
      folder: `assets/img/trophy/Global/${key}`,
      rarities: raritiesOf(tiers)
    });
  });

  const boostersFile = 'settings/boosters_trophy.json';
  const boostersText = context.readText(boostersFile);
  const boosters = context.readJsonValue(boostersFile);
  // The declared sets moved to `settings/cardsets.json`: every one of them needs its trophy folder,
  // announced or not.
  const cardSets = context.readJsonValue('settings/cardsets.json');
  const setIds = (Array.isArray(cardSets?.sets) ? cardSets.sets : [])
    .map((entry) => (typeof entry?.id === 'string' ? entry.id.trim() : ''))
    .filter((id) => id !== '');
  const families = [
    { enabled: boosters?.enableCompletionTrophy !== false, key: 'completionTrophy', folder: 'completion' },
    { enabled: boosters?.enableBoosterStatsTrophy !== false, key: 'boosterStats', folder: 'booster_opened' }
  ];
  families.forEach(({ enabled, key, folder }) => {
    if (!enabled) return;
    const rarities = raritiesOf(boosters?.[key]);
    setIds.forEach((setId) => {
      folders.push({
        settings: boostersFile,
        line: lineOfCounter(boostersText, key),
        folder: `assets/img/trophy/${setId}/${folder}`,
        rarities
      });
    });
  });

  return folders;
}

/** @type {object[]} The rules of this module, in report order. */
export default [
  {
    id: 'css/important',
    summary: '`!important` is reserved to the two documented exceptions.',
    severity: 'error',
    /**
     * @param {object} context - Rule context.
     * @returns {void}
     */
    run(context) {
      context.eachFile(({ file, text }) => {
        if (path.extname(file) !== '.css') return;
        const masked = maskCss(text);
        // The scanner walks the blocks to know WHERE an `!important` sits: inside the reduced-motion
        // media query (the project stops every animation there) or inside a plain rule (where it is
        // only allowed on the `[hidden]` guard, `display: none`).
        const pattern = /@[a-z-]+[^{;]*\{|!important|\{|\}|[;]/g;
        /** @type {Array<{prelude: string|null}>} */
        const stack = [];
        let statementStart = 0;
        let match;
        while ((match = pattern.exec(masked)) !== null) {
          const token = match[0];
          if (token.startsWith('@')) {
            stack.push({ prelude: token });
            statementStart = match.index + token.length;
            continue;
          }
          if (token === '{') {
            stack.push({ prelude: null });
            statementStart = match.index + 1;
            continue;
          }
          if (token === '}') {
            stack.pop();
            statementStart = match.index + 1;
            continue;
          }
          if (token === ';') {
            statementStart = match.index + 1;
            continue;
          }
          const declaration = masked.slice(statementStart, match.index).trim();
          const inReducedMotion = stack.some((entry) => entry.prelude && REDUCED_MOTION.test(entry.prelude));
          const isHiddenGuard = /^display\s*:\s*none$/.test(declaration);
          if (inReducedMotion || isHiddenGuard) continue;
          const before = masked.slice(0, match.index);
          context.report({
            file,
            line: before.split('\n').length,
            column: match.index - (before.lastIndexOf('\n') + 1) + 1,
            message: `\`!important\` on "${declaration}": fix the specificity instead`
          });
        }
      });
    }
  },
  {
    id: 'css/class-naming',
    summary: 'Every class follows the BEM convention of the project.',
    severity: 'error',
    /**
     * @param {object} context - Rule context.
     * @returns {void}
     */
    run(context) {
      context.eachFile(({ file, text }) => {
        if (path.extname(file) !== '.css') return;
        const masked = maskCss(text);
        // Only the text before a `{` is a selector; a declaration never names a class.
        const selectors = masked.matchAll(/(^|[},;\s])([^{}@;]+)\{/g);
        [...selectors].forEach((match) => {
          const selector = match[2].trim();
          if (selector === '' || /^(?:from|to|\d)/.test(selector)) return;
          [...selector.matchAll(/\.([A-Za-z_][\w-]*)/g)].forEach((classMatch) => {
            const name = classMatch[1];
            if (BEM_CLASS.test(name) || UTILITY_CLASS.test(name)) return;
            const offset = match.index + match[1].length + match[2].indexOf(`.${name}`);
            const before = masked.slice(0, offset);
            context.report({
              file,
              line: before.split('\n').length,
              column: offset - (before.lastIndexOf('\n') + 1) + 1,
              message: `".${name}" is not a BEM class (block, block__element, block--modifier)`
            });
          });
        });
      });
    }
  },
  {
    id: 'html/ids',
    summary: 'A page declares each `id` once.',
    severity: 'error',
    /**
     * @param {object} context - Rule context.
     * @returns {void}
     */
    run(context) {
      context.eachFile(({ file, text }) => {
        if (path.extname(file) !== '.html') return;
        const masked = maskHtml(text);
        const seen = new Map();
        splitLines(masked).forEach((line, index) => {
          [...line.matchAll(/\sid="([^"]+)"/g)].forEach((match) => {
            const id = match[1];
            if (!seen.has(id)) {
              seen.set(id, index + 1);
              return;
            }
            context.report({
              file,
              line: index + 1,
              column: match.index + 1,
              message: `id "${id}" is already used on line ${seen.get(id)}`
            });
          });
        });
      });
    }
  },
  {
    id: 'html/inline-handlers',
    summary: 'No inline event handler (`onclick`, `onchange`…) in a page.',
    severity: 'error',
    /**
     * @param {object} context - Rule context.
     * @returns {void}
     */
    run(context) {
      context.eachFile(({ file, text }) => {
        if (path.extname(file) !== '.html') return;
        const masked = maskHtml(text);
        splitLines(masked).forEach((line, index) => {
          [...line.matchAll(/\son(?:click|change|input|submit|load|error|mouse\w+|key\w+|focus|blur)\s*=/gi)].forEach(
            (match) => {
              context.report({
                file,
                line: index + 1,
                column: match.index + 1,
                message: 'inline event handler: bind the listener in the view instead'
              });
            }
          );
        });
      });
    }
  },
  {
    id: 'assets/references',
    summary: 'Every asset path quoted by a file exists.',
    severity: 'error',
    /**
     * @param {object} context - Rule context.
     * @returns {void}
     */
    run(context) {
      context.eachFile(({ file, text }) => {
        const extension = path.extname(file);
        if (!['.js', '.css', '.html', '.json'].includes(extension)) return;
        // A settings or data file may legitimately point at art that is still being produced: the
        // screen falls back to a default picture, which is worth a warning, not a broken run.
        const isData = file.startsWith('settings/') || file.startsWith('data/');
        listAssetReferences(file, text).forEach((reference) => {
          if (context.exists(reference.path)) return;
          context.report({
            file,
            line: reference.line,
            column: reference.column,
            severity: isData ? 'warning' : 'error',
            message: isData
              ? `"${reference.path}" does not exist yet (data reference, the screen falls back)`
              : `"${reference.path}" does not exist`
          });
        });
      });
    }
  },
  {
    id: 'sw/precache',
    summary: 'Every file of the service worker precache list exists.',
    severity: 'error',
    /**
     * @param {object} context - Rule context.
     * @returns {void}
     */
    run(context) {
      const file = 'sw.js';
      const text = context.readText(file);
      const list = /const\s+PRECACHE_URLS\s*=\s*\[([\s\S]*?)\]/.exec(text);
      if (!list) {
        context.report({
          file,
          line: 1,
          column: 1,
          message: 'the precache list (`PRECACHE_URLS`) could not be found'
        });
        return;
      }
      const listStart = list.index + list[0].indexOf('[');
      [...list[1].matchAll(/'([^']*)'/g)].forEach((match) => {
        const url = match[1].trim();
        if (url === '' || /^https?:/.test(url)) return;
        const target = normalizeAssetPath(url);
        if (context.exists(target)) return;
        const offset = listStart + match.index;
        const before = text.slice(0, offset);
        context.report({
          file,
          line: before.split('\n').length,
          column: offset - (before.lastIndexOf('\n') + 1) + 1,
          message: `"${target}" is precached but does not exist`
        });
      });
    }
  },
  {
    id: 'assets/trophy-medals',
    summary: 'The medals the trophy catalogue looks for are present (warning: the fallback hides it).',
    severity: 'warning',
    /**
     * @param {object} context - Rule context.
     * @returns {void}
     */
    run(context) {
      listExpectedMedals(context).forEach(({ settings, line, folder, rarities }) => {
        const missing = rarities.filter((rarity) => !context.exists(`${folder}/${rarity}.png`));
        if (missing.length === 0) return;
        context.report({
          file: settings,
          line,
          column: 1,
          message:
            `${folder}: ${missing.length} missing medal(s) (${missing.join(', ')}). ` +
            'Missing medals fall back to assets/img/trophy/default.png.'
        });
      });
    }
  }
];

/**
 * repo.mjs - Reads the project: which files belong to the linted set, and their raw text.
 *
 * Reference: `tools/lint/README.md` for the rule set itself.
 *
 * Everything a rule needs to look at comes from here, so the set of inspected files is defined in
 * ONE place: a directory added to the project is linted as soon as it is not listed in `IGNORED`.
 * Reads are cached, because a dozen rules read the dictionaries, the settings and the two HTML
 * pages, and a rule must never see a file change under its feet during a single run.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJsonStrict } from './json.mjs';

/** Root of the project (the folder that holds `js/`, `css/`, `settings/`…). */
export const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..'
);

/**
 * Directories never inspected.
 *
 *   - `.git`, `.freebuff`, `.clinerules`: not project content;
 *   - `node_modules`: installed packages, never authored here;
 *   - `external`: third-party code (the card maker editor, the C# link tools) that follows its own
 *     conventions and is not maintained from this repository;
 *   - `cards`: the card illustrations (374 MB of images), nothing to lint.
 *
 * The private documentation (`.docs/`) and the game master tool (`admin/`) ARE linted: they are part
 * of the project and drift just as easily as the game itself.
 */
export const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.freebuff',
  '.clinerules',
  'node_modules',
  'external',
  'cards'
]);

/**
 * Extensions the linter has a rule for. Anything else is ignored, not silently broken.
 *
 * Markdown is deliberately absent: two trailing spaces at the end of a line ARE a forced line break
 * in Markdown, so the trailing-whitespace rule would rewrite the rendering of `.docs/` instead of
 * tidying it.
 */
export const LINTED_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.css',
  '.html',
  '.json',
  '.webmanifest',
  '.xml',
  '.txt',
  '.cmd'
]);

/** @type {Map<string, string>} Raw text of every file read so far, keyed by relative path. */
const textCache = new Map();

/** @type {Map<string, object>} Parsed JSON of every `.json` read so far, keyed by relative path. */
const jsonCache = new Map();

/**
 * Lists every linted file of the project.
 *
 * @returns {string[]} Project-relative paths, always separated by `/`, in alphabetical order.
 */
export function listFiles() {
  const found = [];
  const walk = (absoluteDirectory) => {
    const entries = fs.readdirSync(absoluteDirectory, { withFileTypes: true });
    entries.forEach((entry) => {
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) return;
        walk(path.join(absoluteDirectory, entry.name));
        return;
      }
      if (!entry.isFile()) return;
      if (!LINTED_EXTENSIONS.has(path.extname(entry.name))) return;
      found.push(toRelative(path.join(absoluteDirectory, entry.name)));
    });
  };
  walk(PROJECT_ROOT);
  return found.sort();
}

/**
 * Turns an absolute path into the project-relative, `/`-separated form used everywhere else.
 *
 * @param {string} absolutePath - Absolute path inside the project.
 * @returns {string} The relative path.
 */
export function toRelative(absolutePath) {
  return path.relative(PROJECT_ROOT, absolutePath).split(path.sep).join('/');
}

/**
 * Reads a file as UTF-8 text, once per run.
 *
 * @param {string} relativePath - Project-relative path.
 * @returns {string} The content, with its original line endings.
 * @throws {Error} When the file cannot be read.
 */
export function readText(relativePath) {
  if (!textCache.has(relativePath)) {
    textCache.set(relativePath, fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf8'));
  }
  return textCache.get(relativePath);
}

/**
 * Reads and parses a JSON file, once per run.
 *
 * A file that repeats a key is still parsed (the last value wins, exactly like in a browser): the
 * duplicate itself is the business of the `data/json` rule, and the readers must not take every
 * other rule down with them because of it.
 *
 * @param {string} relativePath - Project-relative path of a `.json` file.
 * @returns {{value: unknown, duplicates: Array<{key: string, line: number, column: number}>}} The
 *   parsed value and the repeated keys (in source order).
 * @throws {Error} When the file does not exist or is not valid JSON.
 */
export function readJson(relativePath) {
  if (!jsonCache.has(relativePath)) {
    jsonCache.set(relativePath, parseJsonStrict(readText(relativePath)));
  }
  return jsonCache.get(relativePath);
}

/**
 * Reads the parsed value of a JSON file, ignoring its repeated keys.
 *
 * @param {string} relativePath - Project-relative path of a `.json` file.
 * @returns {unknown} The parsed value.
 * @throws {Error} When the file does not exist or is not valid JSON.
 */
export function readJsonValue(relativePath) {
  return readJson(relativePath).value;
}

/**
 * Tells whether a project-relative path exists on disk.
 *
 * @param {string} relativePath - Project-relative path (a file or a directory).
 * @returns {boolean} True when it exists.
 */
export function exists(relativePath) {
  return fs.existsSync(path.join(PROJECT_ROOT, relativePath));
}

/**
 * Lists the names of the entries of a directory.
 *
 * @param {string} relativePath - Project-relative path of a directory.
 * @returns {string[]} The entry names (empty when the directory does not exist).
 */
export function listDirectory(relativePath) {
  const absolute = path.join(PROJECT_ROOT, relativePath);
  if (!fs.existsSync(absolute)) return [];
  return fs.readdirSync(absolute, { withFileTypes: true }).map((entry) =>
    entry.isDirectory() ? `${entry.name}/` : entry.name
  );
}

/**
 * Writes a file back to disk, preserving its original line endings as long as the new content keeps
 * them (`--fix` only rewrites what a fix explicitly built).
 *
 * @param {string} relativePath - Project-relative path.
 * @param {string} content - New content.
 * @returns {void}
 */
export function writeText(relativePath, content) {
  fs.writeFileSync(path.join(PROJECT_ROOT, relativePath), content, 'utf8');
  textCache.set(relativePath, content);
  jsonCache.delete(relativePath);
}

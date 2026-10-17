/**
 * javascript.mjs - The rules of `js/`, `sw.js` and `admin/`.
 *
 * The project writes ES modules with no build step, so the linter is the only thing that ever reads
 * them before the browser does: a syntax error, an import pointing at a file that was renamed, an
 * undocumented method or a leftover `console.log` must be caught here, not by a player.
 *
 * The rules work on the MASKED source (`lib/text.mjs`), so a construct quoted in a comment or in a
 * string is never mistaken for the construct itself. The one exception is the import rule: an
 * import specifier IS a string, so it reads the real text, on the lines that declare an import.
 */

import path from 'node:path';
import { spawn } from 'node:child_process';
import { maskJavaScript } from '../lib/text.mjs';

/** Build tools and dependencies, never linted as project code. */
const JAVASCRIPT_EXTENSIONS = new Set(['.js', '.mjs']);

/** Keywords that look like a method call but never declare one. */
const NON_DECLARATIONS = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'return',
  'typeof',
  'instanceof',
  'new',
  'do',
  'else',
  'with',
  'await',
  'throw',
  'super',
  'this',
  'of',
  'in',
  'case',
  'default',
  'delete',
  'void',
  'yield',
  'import',
  'export',
  'const',
  'let',
  'var',
  'class',
  'try',
  'finally',
  'break',
  'continue',
  'async',
  'function'
]);

/** `function name(`, at the top level or after `export`. */
const FUNCTION_DECLARATION = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/;

/** A class member declaration, alone on its line: `  static async load() {`. */
const METHOD_DECLARATION = /^ {2,}(?:static\s+)?(?:(?:async|get|set)\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{\s*$/;

/**
 * Lists the JavaScript files of the linted set.
 *
 * @param {string[]} files - Every linted file.
 * @returns {string[]} The JavaScript ones.
 */
const javascriptFiles = (files) =>
  files.filter((file) => JAVASCRIPT_EXTENSIONS.has(path.extname(file)));

/**
 * Runs `node --check` on one file: the same parser the browser-adjacent tooling uses, so a module
 * that the game could not load is reported here with the engine's own message and line.
 *
 * @param {string} absolutePath - Absolute path of the file.
 * @returns {Promise<string|null>} The error message, or null when the file parses.
 */
function checkSyntax(absolutePath) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--check', absolutePath], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.on('error', (error) => resolve(error.message));
    child.on('close', (code) => resolve(code === 0 ? null : output.trim() || 'syntax error'));
  });
}

/**
 * Reads the line a `node --check` failure points at.
 *
 * Node prints the offending line and a caret, prefixed by the position of the error in its message
 * (`path:line`); a message without any position falls back to the first line.
 *
 * @param {string} message - Raw output of `node --check`.
 * @returns {number} The 1-based line.
 */
function extractLine(message) {
  const match = /:(\d+)\r?\n/.exec(message);
  return match ? Number(match[1]) : 1;
}

/**
 * Runs a worker over a list, at most `concurrency` at a time.
 *
 * @param {unknown[]} items - Items to process.
 * @param {(item: unknown, index: number) => Promise<unknown>} worker - Async worker.
 * @param {number} concurrency - Maximum number of parallel workers.
 * @returns {Promise<unknown[]>} The results, in the order of the input.
 */
async function runPool(items, worker, concurrency) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = new Array(Math.min(concurrency, items.length)).fill(null).map(async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/** @type {object[]} The rules of this module, in report order. */
export default [
  {
    id: 'js/parse',
    summary: 'Every JavaScript module parses.',
    severity: 'error',
    /**
     * @param {object} context - Rule context.
     * @returns {Promise<void>} Resolves once every file was checked.
     */
    async run(context) {
      const files = javascriptFiles(context.files);
      const results = await runPool(
        files,
        (file) => checkSyntax(context.absolutePath(file)),
        4
      );
      results.forEach((message, index) => {
        if (!message) return;
        context.report({
          file: files[index],
          line: extractLine(message),
          column: 1,
          message: `does not parse: ${message.split(/\r?\n/)[0]}`
        });
      });
    }
  },
  {
    id: 'js/module-doc',
    summary: 'A module opens with the block comment describing it.',
    severity: 'error',
    /**
     * @param {object} context - Rule context.
     * @returns {void}
     */
    run(context) {
      context.eachFile(({ file, lines }) => {
        if (!JAVASCRIPT_EXTENSIONS.has(path.extname(file))) return;
        // A command line tool of the repository starts with a shebang: the doc block follows it.
        const first = lines.findIndex((line, index) => line.trim() !== '' && !(index === 0 && line.startsWith('#!')));
        if (first === -1) {
          context.report({ file, line: 1, column: 1, message: 'empty module' });
          return;
        }
        if (!lines[first].trimStart().startsWith('/**')) {
          context.report({
            file,
            line: first + 1,
            column: 1,
            message: 'the module does not open with a `/** … */` documentation block'
          });
        }
      });
    }
  },
  {
    id: 'js/docblock',
    summary: 'Every function and class method is documented.',
    severity: 'error',
    /**
     * @param {object} context - Rule context.
     * @returns {void}
     */
    run(context) {
      context.eachFile(({ file, lines }) => {
        if (!JAVASCRIPT_EXTENSIONS.has(path.extname(file))) return;
        lines.forEach((line, index) => {
          // A class is documented by the module header of its file, which names it and describes
          // what it does: a second block right above it would only repeat that. Its methods, on the
          // other hand, are all documented one by one, and that is what this rule checks.
          if (/^\s*(?:export\s+)?(?:default\s+)?class\s+[A-Za-z_$]/.test(line)) return;

          const declaration = /^ {2,}/.test(line)
            ? METHOD_DECLARATION.exec(line)
            : FUNCTION_DECLARATION.exec(line);
          if (!declaration) return;
          const name = declaration[1];
          if (NON_DECLARATIONS.has(name)) return;

          let cursor = index - 1;
          while (cursor >= 0 && lines[cursor].trim() === '') cursor -= 1;
          if ((lines[cursor] ?? '').trim().endsWith('*/')) return;

          // A constructor has no doc of its own in this project: the class it belongs to (or the
          // module header) describes the instance it builds, and its fields are documented one by
          // one inside the body.
          if (name === 'constructor') return;

          context.report({
            file,
            line: index + 1,
            column: 1,
            message: `\`${name}\` is not documented by a preceding block comment`
          });
        });
      });
    }
  },
  {
    id: 'js/legacy-syntax',
    summary: 'No `var`, no loose comparison, no `console.log`, no `debugger`.',
    severity: 'error',
    /**
     * @param {object} context - Rule context.
     * @returns {void}
     */
    run(context) {
      context.eachFile(({ file, text }) => {
        if (!JAVASCRIPT_EXTENSIONS.has(path.extname(file))) return;
        const masked = maskJavaScript(text);
        const patterns = [
          { pattern: /(^|[^\w$.])var\s+[A-Za-z_$]/, message: '`var` is replaced by `let` or `const`' },
          { pattern: /[^=!<>]==[^=]/, message: 'loose comparison: use `===`' },
          { pattern: /!=[^=]/, message: 'loose comparison: use `!==`' },
          { pattern: /console\.log\s*\(/, message: '`console.log` left in the code' },
          { pattern: /(^|[^\w$.])debugger\b/, message: '`debugger` left in the code' }
        ];
        patterns.forEach(({ pattern, message }) => {
          // Every occurrence is reported, not only the first one: a single run must show all the
          // places to fix.
          const scanner = new RegExp(
            pattern.source,
            pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
          );
          masked.matchAll(scanner).forEach((match) => {
            const offset = match.index + (match[1] ? match[1].length : 0);
            const before = masked.slice(0, offset);
            const line = before.split('\n').length;
            const column = offset - (before.lastIndexOf('\n') + 1) + 1;
            context.report({ file, line, column, message });
          });
        });
      });
    }
  },
  {
    id: 'js/imports',
    summary: 'Every relative import resolves, and no module is imported twice.',
    severity: 'error',
    /**
     * @param {object} context - Rule context.
     * @returns {void}
     */
    run(context) {
      context.eachFile(({ file, lines }) => {
        if (!JAVASCRIPT_EXTENSIONS.has(path.extname(file))) return;
        const declared = new Map();
        lines.forEach((line, index) => {
          if (!/^\s*(?:import|export)\b/.test(line)) return;
          const match = /(?:\bfrom\s*|\bimport\s*)['"]([^'"]+)['"]/.exec(line);
          if (!match) return;
          const specifier = match[1];
          if (!specifier.startsWith('.')) return;

          if (declared.has(specifier)) {
            context.report({
              file,
              line: index + 1,
              column: 1,
              message: `"${specifier}" is imported twice (first on line ${declared.get(specifier)})`
            });
          } else {
            declared.set(specifier, index + 1);
          }

          const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
          const candidates = [target, `${target}.js`, `${target}/index.js`];
          if (!candidates.some((candidate) => context.exists(candidate))) {
            context.report({
              file,
              line: index + 1,
              column: 1,
              message: `"${specifier}" does not resolve to any file of the project`
            });
          }
        });
      });
    }
  }
];

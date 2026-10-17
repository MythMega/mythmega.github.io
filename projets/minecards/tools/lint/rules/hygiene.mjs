/**
 * hygiene.mjs - The rules every text file of the project must satisfy, whatever its language.
 *
 * Nothing here is a matter of taste: a byte order mark, a stray tab used as indentation, a trailing
 * space or a file that stops mid-line all end up as a phantom diff in a review or as a broken parse
 * in a tool that reads the file later. Two of them are auto-fixable (`--fix`).
 */

import { parseJsonStrict } from '../lib/json.mjs';
import { splitLines } from '../lib/text.mjs';

/** Extensions holding JSON (the manifest is JSON too, whatever its extension says). */
const JSON_EXTENSIONS = new Set(['.json', '.webmanifest']);

/**
 * Detects the line ending of a text from its first one.
 *
 * @param {string} text - File content.
 * @returns {string} `\r\n`, `\n` or `\r`, defaulting to `\n` for a file with no line break at all.
 */
function detectEol(text) {
  const match = /\r\n|\n|\r/.exec(text);
  return match ? match[0] : '\n';
}

/** @type {object[]} The rules of this module, in report order. */
export default [
  {
    id: 'hygiene/encoding',
    summary: 'A text file is UTF-8 without a byte order mark.',
    severity: 'error',
    fixable: true,
    /**
     * Removes the byte order mark, if any.
     *
     * @param {string} text - File content.
     * @returns {string} The content without its mark.
     */
    fix(text) {
      return text.startsWith('\uFEFF') ? text.slice(1) : text;
    },
    /**
     * @param {object} context - Rule context.
     * @returns {void}
     */
    run(context) {
      context.eachFile(({ file, text }) => {
        if (text.startsWith('\uFEFF')) {
          context.report({ file, line: 1, column: 1, message: 'byte order mark (BOM) found' });
        }
      });
    }
  },
  {
    id: 'hygiene/line-endings',
    summary: 'A file does not mix CRLF and LF line endings.',
    severity: 'error',
    /**
     * @param {object} context - Rule context.
     * @returns {void}
     */
    run(context) {
      context.eachFile(({ file, text }) => {
        const crlf = (text.match(/\r\n/g) ?? []).length;
        const lf = (text.match(/(^|[^\r])\n/g) ?? []).length;
        if (crlf > 0 && lf > 0) {
          const offender = text.search(/(^|[^\r])\n/);
          const line = text.slice(0, Math.max(offender, 0)).split('\n').length;
          context.report({
            file,
            line,
            column: 1,
            message: `mixed line endings (${crlf} CRLF and ${lf} LF)`
          });
        }
      });
    }
  },
  {
    id: 'hygiene/trailing-whitespace',
    summary: 'No line ends with a space or a tab.',
    severity: 'error',
    fixable: true,
    /**
     * @param {string} text - File content.
     * @returns {string} The content without trailing whitespace.
     */
    fix(text) {
      return text
        .replace(/[ \t]+(?=\r?\n)/g, '')
        .replace(/[ \t]+$/, '');
    },
    /**
     * @param {object} context - Rule context.
     * @returns {void}
     */
    run(context) {
      context.eachFile(({ file, text }) => {
        splitLines(text).forEach((line, index) => {
          const match = /[ \t]+$/.exec(line);
          if (match) {
            context.report({
              file,
              line: index + 1,
              column: match.index + 1,
              message: 'trailing whitespace'
            });
          }
        });
      });
    }
  },
  {
    id: 'hygiene/final-newline',
    summary: 'A file ends with exactly one line break.',
    severity: 'error',
    fixable: true,
    /**
     * @param {string} text - File content.
     * @returns {string} The content, terminated by the line ending the file already uses.
     */
    fix(text) {
      const eol = detectEol(text);
      return `${text.replace(/(?:\r\n|\n|\r)+$/, '')}${eol}`;
    },
    /**
     * @param {object} context - Rule context.
     * @returns {void}
     */
    run(context) {
      context.eachFile(({ file, text, lines }) => {
        if (text === '') return;
        const trailing = /((?:\r\n|\n|\r)+)$/.exec(text)?.[1] ?? '';
        if (trailing === '') {
          context.report({
            file,
            line: lines.length,
            column: (lines[lines.length - 1] ?? '').length + 1,
            message: 'no line break at the end of the file'
          });
          return;
        }
        // The fix removes the extra blank lines, so the rule has to report them: a fix that
        // changes more than what a rule reported is a fix nobody can review.
        const breaks = trailing.split(/\r\n|\n|\r/).length - 1;
        if (breaks > 1) {
          context.report({
            file,
            line: Math.max(1, lines.length - (breaks - 1)),
            column: 1,
            message: `${breaks - 1} blank line(s) at the end of the file`
          });
        }
      });
    }
  },
  {
    id: 'hygiene/indentation',
    summary: 'Indentation uses spaces, never a tab.',
    severity: 'error',
    /**
     * @param {object} context - Rule context.
     * @returns {void}
     */
    run(context) {
      context.eachFile(({ file, text }) => {
        splitLines(text).forEach((line, index) => {
          const match = /^[ \t]*\t/.exec(line);
          if (match) {
            context.report({
              file,
              line: index + 1,
              column: match.index + 1,
              message: 'tab character in the indentation'
            });
          }
        });
      });
    }
  },
  {
    id: 'data/json',
    summary: 'Every JSON file parses and declares each key once.',
    severity: 'error',
    files: (relativePath) => JSON_EXTENSIONS.has(relativePath.slice(relativePath.lastIndexOf('.'))),
    /**
     * @param {object} context - Rule context.
     * @returns {void}
     */
    run(context) {
      context.eachFile(({ file, text }) => {
        let result;
        try {
          result = parseJsonStrict(text);
        } catch (error) {
          context.report({
            file,
            line: Number.isInteger(error.line) ? error.line : 1,
            column: Number.isInteger(error.column) ? error.column : 1,
            message: `invalid JSON: ${error.message}`
          });
          return;
        }
        result.duplicates.forEach((duplicate) => {
          context.report({
            file,
            line: duplicate.line,
            column: duplicate.column,
            message: `key "${duplicate.key}" is declared twice in the same object`
          });
        });
      });
    }
  }
];

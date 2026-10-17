#!/usr/bin/env node
/**
 * lint.mjs - The linter of MineCards.
 *
 * Reference: `tools/lint/README.md` (the rule set and its rationale).
 *
 * WHAT IT IS
 * The game is plain ES modules with no bundler, no transpiler and no test runner: nothing reads the
 * sources between the editor and the browser. This program is that missing step. It checks the code
 * (syntax, documentation, imports, syntax of the settings), the translations (two dictionaries that
 * must say the same thing, and the keys the catalogue composes), the stylesheets, the pages, and the
 * files every path in the project points at.
 *
 * USAGE
 *   node tools/lint.mjs                 lint everything, exit 1 when an error is found
 *   node tools/lint.mjs --fix           fix what can be fixed without a judgement call, then lint
 *   node tools/lint.mjs --only js/      run the rules whose id starts with `js/`
 *   node tools/lint.mjs --strict        treat warnings as errors
 *   node tools/lint.mjs --json          machine-readable report
 *   node tools/lint.mjs --list          list the rules
 *
 * The rules themselves live in `tools/lint/rules/`; the helpers they share in `tools/lint/lib/`.
 */

import path from 'node:path';
import {
  PROJECT_ROOT,
  exists,
  listDirectory,
  listFiles,
  readJson,
  readJsonValue,
  readText,
  toRelative,
  writeText
} from './lint/lib/repo.mjs';
import { splitLines } from './lint/lib/text.mjs';
import hygieneRules from './lint/rules/hygiene.mjs';
import javascriptRules from './lint/rules/javascript.mjs';
import i18nRules from './lint/rules/i18n.mjs';
import markupRules from './lint/rules/markup.mjs';

/** Every rule of the linter, in report order. */
const RULES = [...hygieneRules, ...javascriptRules, ...i18nRules, ...markupRules];

/** Colour codes, dropped when the output is piped (or asked for through `NO_COLOR`). */
const COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const PAINT = {
  error: (text) => (COLOR ? `\u001B[31m${text}\u001B[0m` : text),
  warning: (text) => (COLOR ? `\u001B[33m${text}\u001B[0m` : text),
  dim: (text) => (COLOR ? `\u001B[2m${text}\u001B[0m` : text),
  bold: (text) => (COLOR ? `\u001B[1m${text}\u001B[0m` : text)
};

/**
 * Reads the command line.
 *
 * @param {string[]} argv - Arguments, without the two first ones.
 * @returns {{fix: boolean, list: boolean, json: boolean, strict: boolean, only: string[]}} Options.
 */
function parseArgs(argv) {
  const options = { fix: false, list: false, json: false, strict: false, only: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--fix') options.fix = true;
    else if (argument === '--list') options.list = true;
    else if (argument === '--json') options.json = true;
    else if (argument === '--strict') options.strict = true;
    else if (argument === '--only') {
      index += 1;
      if (argv[index]) options.only.push(argv[index]);
    } else if (argument.startsWith('--only=')) {
      options.only.push(argument.slice('--only='.length));
    } else if (!argument.startsWith('--')) {
      options.only.push(argument);
    }
  }
  return options;
}

/**
 * Keeps the rules selected by `--only`.
 *
 * @param {object[]} rules - Every rule.
 * @param {string[]} selectors - Ids, or prefixes of ids.
 * @returns {object[]} The selected rules.
 */
function selectRules(rules, selectors) {
  if (selectors.length === 0) return rules;
  return rules.filter((rule) => selectors.some((selector) => rule.id.startsWith(selector)));
}

/**
 * Builds the object handed to every rule.
 *
 * @param {string[]} files - Every linted file.
 * @returns {object} The rule context.
 */
function buildContext(files) {
  return {
    files,
    /**
     * Calls back for every linted file, with its text and its lines already read.
     *
     * @param {(file: {file: string, text: string, lines: string[]}) => void} callback - Called once
     *   per file.
     * @returns {void}
     */
    eachFile(callback) {
      files.forEach((file) => {
        const text = readText(file);
        callback({ file, text, lines: splitLines(text) });
      });
    },
    /**
     * Records a finding. `runRule` replaces this method with one that knows the running rule, so the
     * id and the severity of a diagnostic can never depend on the caller.
     *
     * @param {{file: string, line: number, column: number, message: string, severity?: string}} finding
     *   What was found.
     * @returns {void}
     */
    report(finding) {
      throw new Error(`A rule reported outside of a run: ${JSON.stringify(finding)}`);
    },
    /**
     * Reads a project file as text.
     *
     * @param {string} file - Project-relative path.
     * @returns {string} The content.
     */
    readText,
    /**
     * Reads the parsed value of a project JSON file.
     *
     * @param {string} file - Project-relative path.
     * @returns {unknown} The parsed value.
     */
    readJsonValue,
    /**
     * Reads a JSON file with its repeated keys.
     *
     * @param {string} file - Project-relative path.
     * @returns {object} `{value, duplicates}`.
     */
    readJson,
    /**
     * Tells whether a project-relative path exists.
     *
     * @param {string} file - Project-relative path.
     * @returns {boolean} True when it exists.
     */
    exists,
    /**
     * Lists the entries of a project-relative directory.
     *
     * @param {string} file - Project-relative path.
     * @returns {string[]} The entry names.
     */
    listDirectory,
    /**
     * Turns a project-relative path into an absolute one.
     *
     * @param {string} file - Project-relative path.
     * @returns {string} The absolute path.
     */
    absolutePath: (file) => path.join(PROJECT_ROOT, file)
  };
}

/**
 * Applies the auto-fixable rules to every file they claim.
 *
 * A fix is only written when it actually changes something, so a second `--fix` writes nothing at
 * all; the caller then runs the regular pass, which reads the files that were just written.
 *
 * @param {object[]} rules - The selected rules.
 * @param {string[]} files - Every linted file.
 * @returns {string[]} The files that were changed.
 */
function applyFixes(rules, files) {
  const changed = [];
  rules
    .filter((rule) => rule.fixable && typeof rule.fix === 'function')
    .forEach((rule) => {
      files.forEach((file) => {
        if (rule.files && !rule.files(file)) return;
        const before = readText(file);
        const after = rule.fix(before);
        if (typeof after !== 'string' || after === before) return;
        writeText(file, after);
        if (!changed.includes(file)) changed.push(file);
      });
    });
  return changed;
}

/**
 * Runs one rule and turns its raw reports into diagnostics.
 *
 * @param {object} rule - The rule.
 * @param {object} context - Rule context.
 * @returns {Promise<Array<object>>} The diagnostics of that rule.
 */
async function runRule(rule, context) {
  const collected = [];
  // A rule may restrict itself to a set of files (the JSON rules do): the restriction is applied
  // here, once, so a rule cannot forget it.
  const files = rule.files ? context.files.filter((file) => rule.files(file)) : context.files;
  const ruleContext = Object.create(context);
  ruleContext.files = files;
  ruleContext.eachFile = (callback) => {
    files.forEach((file) => {
      const text = readText(file);
      callback({ file, text, lines: splitLines(text) });
    });
  };
  ruleContext.report = (finding) => {
    collected.push({
      ruleId: rule.id,
      severity: finding.severity ?? rule.severity,
      file: toRelative(path.join(PROJECT_ROOT, finding.file)),
      line: Math.max(1, Number(finding.line) || 1),
      column: Math.max(1, Number(finding.column) || 1),
      message: finding.message,
      fixable: Boolean(rule.fixable)
    });
  };
  try {
    await rule.run(ruleContext);
  } catch (error) {
    // A rule that cannot even run (a settings file renamed, a JSON file unreadable) must not hide
    // the findings of the other twenty-two: it reports its own failure and the run continues.
    collected.push({
      ruleId: rule.id,
      severity: 'error',
      file: toRelative(path.join(PROJECT_ROOT, 'tools/lint.mjs')),
      line: 1,
      column: 1,
      message: `the rule could not run: ${error instanceof Error ? error.message : String(error)}`,
      fixable: false
    });
  }
  return collected;
}

/**
 * Sorts diagnostics by file, then by position, so two runs always print the same order.
 *
 * @param {object[]} diagnostics - The diagnostics.
 * @returns {object[]} The sorted list.
 */
function sortDiagnostics(diagnostics) {
  return [...diagnostics].sort(
    (left, right) =>
      left.file.localeCompare(right.file) ||
      left.line - right.line ||
      left.column - right.column ||
      left.ruleId.localeCompare(right.ruleId)
  );
}

/**
 * Prints the report, grouped by file.
 *
 * @param {object[]} diagnostics - Sorted diagnostics.
 * @param {number} fileCount - Number of linted files.
 * @returns {{errors: number, warnings: number, files: number}} The counts.
 */
function printReport(diagnostics, fileCount) {
  const byFile = new Map();
  diagnostics.forEach((diagnostic) => {
    if (!byFile.has(diagnostic.file)) byFile.set(diagnostic.file, []);
    byFile.get(diagnostic.file).push(diagnostic);
  });

  byFile.forEach((entries, file) => {
    process.stdout.write(`${PAINT.bold(file)}\n`);
    entries.forEach((entry) => {
      const label = entry.severity === 'error' ? PAINT.error('error  ') : PAINT.warning('warning');
      const position = PAINT.dim(`${entry.line}:${entry.column}`);
      process.stdout.write(
        `  ${position.padEnd(14)} ${label} ${entry.message}  ${PAINT.dim(`[${entry.ruleId}]`)}\n`
      );
    });
  });

  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length;
  const warnings = diagnostics.length - errors;
  const summary =
    `${errors} error(s), ${warnings} warning(s) in ${byFile.size} file(s) ` +
    `(of ${fileCount} inspected)`;
  process.stdout.write(`${errors > 0 ? PAINT.error(summary) : PAINT.bold(summary)}\n`);
  return { errors, warnings, files: byFile.size };
}

/**
 * Entry point.
 *
 * @returns {Promise<void>} Resolves once the report was printed.
 */
async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.list) {
    RULES.forEach((rule) => {
      process.stdout.write(`${rule.id.padEnd(24)} ${PAINT.dim(rule.severity.padEnd(8))} ${rule.summary}\n`);
    });
    return;
  }

  const files = listFiles();
  const rules = selectRules(RULES, options.only);
  if (rules.length === 0) {
    process.stderr.write(`No rule matches ${options.only.join(', ')}.\n`);
    process.exitCode = 1;
    return;
  }

  if (options.fix) {
    const changed = applyFixes(rules, files);
    if (!options.json) {
      process.stdout.write(
        changed.length === 0
          ? 'Nothing to fix.\n'
          : `Fixed ${changed.length} file(s), now checking.\n`
      );
    }
  }

  const diagnostics = [];
  const context = buildContext(files);
  for (const rule of rules) {
    const found = await runRule(rule, context);
    diagnostics.push(...found);
  }

  const sorted = sortDiagnostics(diagnostics);

  const errors = sorted.filter((diagnostic) => diagnostic.severity === 'error').length;
  const warnings = sorted.length - errors;

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ files: files.length, errors, warnings, diagnostics: sorted }, null, 2)}\n`);
  } else {
    printReport(sorted, files.length);
  }

  const failed = errors > 0 || (options.strict && warnings > 0);
  process.exitCode = failed ? 1 : 0;
}

await main();

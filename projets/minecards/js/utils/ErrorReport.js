/**
 * ErrorReport - One error, turned into a code a player can quote and a text a developer can read.
 *
 * Reference: `js/utils/Diagnostics.js` (the runtime snapshot it embeds),
 * `js/utils/ErrorReporter.js` (which decides when a report is worth a dialog) and
 * `js/UI/components/ErrorPopup.js` (which copies it).
 *
 * SHAPE OF A REPORT
 *   { code, capturedAt, source, titleKey, bodyKey, error: { name, message, stack },
 *     context, diagnostics, consoleErrors, text }
 *
 * THE CODE
 * `MC-1A2B3C`: six hex characters derived from the name, the message and the source. The same bug
 * therefore quotes the same code on every machine, while two different failures never share one. It
 * is short enough to be typed in a Discord message, which is the whole point: a player pastes the
 * code, a developer searches for it.
 *
 * THE TEXT
 * `buildReportText()` writes it once, in plain ASCII-ish English, with one section per probe. It is
 * what the copy button puts in the clipboard: no formatting a Discord message would eat, no hidden
 * characters, one line per fact.
 */

import { collectDiagnostics } from './Diagnostics.js';

/** Version of the report layout, so an old pasted report stays readable. */
export const ERROR_REPORT_VERSION = 1;

/** Prefix of every error code. */
export const ERROR_CODE_PREFIX = 'MC';

/** Longest stack kept in the text, in characters. */
const MAX_STACK_CHARS = 4000;

/** Longest value kept for one context field, in characters. */
const MAX_CONTEXT_CHARS = 300;

/**
 * Turns anything thrown into a plain, printable object.
 *
 * `throw 'oops'`, a rejected `Response` or an `Error` with a `cause` all reach the reporter: none of
 * them may crash the report itself.
 *
 * @param {unknown} error - Value thrown or rejected.
 * @returns {{name: string, message: string, stack: string|null}} The normalized error.
 */
export function normalizeError(error) {
  if (error instanceof Error) {
    return {
      name: error.name || 'Error',
      message: String(error.message ?? ''),
      stack: typeof error.stack === 'string' ? error.stack.slice(0, MAX_STACK_CHARS) : null,
    };
  }

  if (error && typeof error === 'object') {
    const record = error;
    const message = typeof record.message === 'string' ? record.message : null;
    if (message !== null) {
      return {
        name: typeof record.name === 'string' ? record.name : 'Error',
        message,
        stack: typeof record.stack === 'string' ? record.stack.slice(0, MAX_STACK_CHARS) : null,
      };
    }
    let serialized;
    try {
      serialized = JSON.stringify(error);
    } catch (nested) {
      serialized = null;
    }
    return { name: 'Object', message: serialized ?? String(error), stack: null };
  }

  return { name: 'Value', message: String(error), stack: null };
}

/**
 * Builds the short code quoted by a player.
 *
 * FNV-1a over `name|message|source`: cheap, dependency-free and stable across browsers, which is all
 * a search key needs.
 *
 * @param {object} payload - What identifies the failure.
 * @param {string} payload.name - Error name.
 * @param {string} payload.message - Error message.
 * @param {string} payload.source - Where it was caught (`boot`, `runtime`, `booster-3d`…).
 * @returns {string} The code, e.g. `MC-3F2A9C`.
 */
export function buildErrorCode({ name = '', message = '', source = '' } = {}) {
  const input = `${name}|${message}|${source}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  const code = (hash >>> 0).toString(16).toUpperCase().padStart(8, '0');
  return `${ERROR_CODE_PREFIX}-${code.slice(0, 6)}`;
}

/**
 * Copies a context object into something a report can print.
 *
 * A cyclic structure, a DOM node or a huge string is exactly what a caller passes by accident: the
 * value is truncated or stringified instead of being allowed to break the copy.
 *
 * @param {object|null} context - Free-form details of the failure.
 * @returns {Record<string, string|number|boolean|null>|null} The printable context.
 */
function sanitizeContext(context) {
  if (!context || typeof context !== 'object') return null;

  const result = {};
  Object.entries(context).forEach(([key, value]) => {
    if (value === undefined) return;
    if (value === null || typeof value === 'number' || typeof value === 'boolean') {
      result[key] = value;
      return;
    }
    if (typeof value === 'string') {
      result[key] = value.length > MAX_CONTEXT_CHARS ? `${value.slice(0, MAX_CONTEXT_CHARS)}…` : value;
      return;
    }
    try {
      const serialized = JSON.stringify(value);
      result[key] =
        serialized.length > MAX_CONTEXT_CHARS
          ? `${serialized.slice(0, MAX_CONTEXT_CHARS)}…`
          : serialized;
    } catch (error) {
      result[key] = String(value);
    }
  });

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Writes one `label: value` line, skipping the empty values.
 *
 * @param {string[]} lines - Destination lines.
 * @param {string} label - Field name.
 * @param {unknown} value - Field value.
 * @returns {void}
 */
function push(lines, label, value) {
  if (value === null || value === undefined || value === '') return;
  lines.push(`${label}: ${value}`);
}

/**
 * Builds the copy-paste text of a report.
 *
 * @param {object} report - Report returned by `createErrorReport()`.
 * @returns {string} The plain-text report.
 */
export function buildReportText(report) {
  const lines = [];
  const { error, diagnostics } = report;

  lines.push('=== MineCards error report ===');
  push(lines, 'Code', report.code);
  push(lines, 'Captured', report.capturedAt);
  push(lines, 'Version', report.version);
  push(lines, 'Source', report.source);
  push(lines, 'Language', diagnostics?.game?.language);
  push(lines, 'Theme', diagnostics?.game?.theme);

  lines.push('');
  lines.push('--- Error ---');
  push(lines, 'Name', error?.name);
  push(lines, 'Message', error?.message);
  if (report.context) {
    Object.entries(report.context).forEach(([key, value]) => push(lines, `Context.${key}`, value));
  }
  if (error?.stack) {
    lines.push('Stack:');
    error.stack.split('\n').forEach((line) => lines.push(`  ${line.trim()}`));
  }

  const game = diagnostics?.game;
  if (game) {
    lines.push('');
    lines.push('--- Build ---');
    push(lines, 'URL', game.url);
    push(lines, 'Visible views', game.views?.length ? game.views.join(', ') : null);
    push(lines, 'Mirrored language', game.mirroredLanguage);
    push(lines, 'Shell caches', diagnostics.shell?.caches?.length ? diagnostics.shell.caches.join(', ') : null);
    push(lines, 'Service worker controller', diagnostics.shell?.controller);
    push(lines, 'Boot overlay', game.bootOverlay);
  }

  const browserInfo = diagnostics?.browser;
  const os = diagnostics?.os;
  if (browserInfo) {
    lines.push('');
    lines.push('--- Browser ---');
    push(lines, 'Browser', `${browserInfo.name} ${browserInfo.version ?? ''}`.trim());
    push(lines, 'Engine', browserInfo.engine);
    push(lines, 'OS', `${os?.name ?? '?'} ${os?.version ?? ''}`.trim());
    push(lines, 'User agent', browserInfo.userAgent);
    push(lines, 'Online', browserInfo.online);
  }

  const device = diagnostics?.device;
  if (device) {
    lines.push('');
    lines.push('--- Device ---');
    push(lines, 'Viewport', `${device.viewport} @${device.devicePixelRatio}x`);
    push(lines, 'Screen', `${device.screen} (${device.colorDepth} bits)`);
    push(lines, 'Touch', device.touch);
    push(lines, 'Cores', device.hardwareConcurrency);
    push(lines, 'Memory (GB)', device.deviceMemory);
    if (device.connection) {
      push(lines, 'Network', `${device.connection.effectiveType ?? '?'}, ${device.connection.downlink ?? '?'} Mb/s, ${device.connection.rtt ?? '?'} ms`);
    }
    push(lines, 'Reduced motion', device.reducedMotion);
    push(lines, 'Dark mode', device.darkMode);
  }

  const graphics = diagnostics?.graphics;
  if (graphics) {
    lines.push('');
    lines.push('--- Graphics ---');
    push(lines, 'WebGL', graphics.webgl);
    push(lines, 'WebGL 2', graphics.webgl2);
    push(lines, 'SOFTWARE RENDERING', graphics.software);
    push(lines, 'Major performance caveat refused', graphics.failedIfCaveat);
    push(lines, 'Vendor', graphics.vendor);
    push(lines, 'Renderer', graphics.renderer);
    push(lines, 'GL version', graphics.version);
    push(lines, 'Max texture size', graphics.maxTextureSize);
    push(lines, 'Probe error', graphics.error);
  }

  const storage = diagnostics?.storage;
  if (storage) {
    lines.push('');
    lines.push('--- Storage ---');
    push(lines, 'Usage (MB)', storage.usage === null ? null : Math.round(storage.usage / 1048576));
    push(lines, 'Quota (MB)', storage.quota === null ? null : Math.round(storage.quota / 1048576));
    push(lines, 'Persistent', storage.persisted);
  }

  if (Array.isArray(report.consoleErrors) && report.consoleErrors.length > 0) {
    lines.push('');
    lines.push('--- Last console errors ---');
    report.consoleErrors.forEach((line) => lines.push(`  ${line}`));
  }

  return lines.join('\n');
}

/**
 * Builds a complete report for one error.
 *
 * Never rejects: when the diagnostics cannot be read (a page so broken that even `navigator` throws)
 * the report is built from what is known, because a report without a graphics card is still better
 * than no report at all.
 *
 * @param {unknown} error - Value thrown or rejected.
 * @param {object} [options] - Report options.
 * @param {string} [options.source='app'] - Where the error was caught.
 * @param {string} [options.titleKey='error.popup.title'] - i18n key of the dialog title.
 * @param {string} [options.bodyKey='error.popup.body'] - i18n key of the dialog message.
 * @param {object|null} [options.context=null] - Details of the failure.
 * @param {string[]} [options.consoleErrors=[]] - Recent `console.error` lines.
 * @returns {Promise<object>} The report, `text` included.
 */
export async function createErrorReport(
  error,
  {
    source = 'app',
    titleKey = 'error.popup.title',
    bodyKey = 'error.popup.body',
    context = null,
    consoleErrors = [],
  } = {}
) {
  const normalized = normalizeError(error);

  let diagnostics = null;
  try {
    diagnostics = await collectDiagnostics();
  } catch (diagnosticError) {
    diagnostics = null;
  }

  const report = {
    version: ERROR_REPORT_VERSION,
    code: buildErrorCode({ name: normalized.name, message: normalized.message, source }),
    capturedAt: new Date().toISOString(),
    source,
    titleKey,
    bodyKey,
    error: normalized,
    context: sanitizeContext(context),
    diagnostics,
    consoleErrors: Array.isArray(consoleErrors) ? consoleErrors.slice(-12) : [],
  };

  try {
    report.text = buildReportText(report);
  } catch (textError) {
    report.text = `${report.code}\n${normalized.name}: ${normalized.message}`;
  }

  return report;
}

export default createErrorReport;

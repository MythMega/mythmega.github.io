/**
 * ErrorReporter - The single door every failure of the game goes through.
 *
 * Reference: `js/utils/ErrorReport.js` (the report it builds), `js/UI/components/ErrorPopup.js` (the
 * dialog it feeds) and `.docs/main.md` section 3.K.
 *
 * WHY IT EXISTS
 * A failure that only reaches the console is invisible to a player and unusable for a developer: the
 * player sees a black booster, the console line is lost on reload, and the Discord conversation
 * starts at "it does not work". This module listens to the three ways a browser reports a failure
 * that nobody caught, keeps the last console errors as context, and hands ONE report at a time to the
 * dialog.
 *
 * WHAT IT WATCHES
 *   - `window.error` in CAPTURE phase: both uncaught exceptions and failed resources (an `<img>`,
 *     a `<link>`, a module that 404s), which do not bubble;
 *   - `unhandledrejection`: the promise nobody awaited, the most common bug of a `void` call;
 *   - `console.error`: kept as context for the next report, never displayed on its own.
 *
 * WHAT IT GUARANTEES
 *   - the same failure is reported ONCE per page (fingerprint on source + name + message);
 *   - at most `MAX_ERROR_DIALOGS_PER_SESSION` dialogs per page, so a broken CDN cannot bury the game
 *     under modals: past that limit the failures stay in the console (and in the next report);
 *   - nothing here ever throws: an error reporter that breaks the page it reports on would be worse
 *     than no reporter at all.
 */

import { createErrorReport, normalizeError } from './ErrorReport.js';

/** Maximum number of dialogs opened per page, whatever the number of failures. */
export const MAX_ERROR_DIALOGS_PER_SESSION = 3;

/** Maximum number of console errors kept as context. */
const CONSOLE_MEMORY_LIMIT = 12;

/** Longest console line kept, in characters. */
const CONSOLE_LINE_MAX_CHARS = 220;

/** @type {boolean} True once the listeners are installed. */
let installed = false;

/** @type {((report: object) => void)|null} Function displaying a report (the popup). */
let presenter = null;

/** @type {object[]} Reports built before a presenter existed, waiting for one. */
let pending = [];

/** @type {Set<string>} Fingerprints already reported, so a loop cannot open ten dialogs. */
const reported = new Set();

/** @type {string[]} Last `console.error` lines, used as context. */
const consoleMemory = [];

/** @type {number} Number of dialogs already opened in this page. */
let dialogCount = 0;

/** @type {boolean} True once the fallback presenter is being loaded. */
let fallbackScheduled = false;

/** @type {(...args: unknown[]) => void} `console.error` before the hook, kept to restore it. */
let originalConsoleError = null;

/**
 * Stores one `console.error` call as context.
 *
 * The values are stringified defensively: a console call may receive an Error, a DOM node or a huge
 * object, and this runs on the path that logs a failure.
 *
 * @param {unknown[]} args - Arguments of the `console.error` call.
 * @returns {void}
 */
function rememberConsoleError(args) {
  try {
    const text = args
      .map((value) => {
        if (value instanceof Error) return `${value.name}: ${value.message}`;
        if (typeof value === 'string') return value;
        try {
          return JSON.stringify(value);
        } catch (error) {
          return String(value);
        }
      })
      .join(' ')
      .replace(/\s+/g, ' ')
      .slice(0, CONSOLE_LINE_MAX_CHARS);
    consoleMemory.push(`${new Date().toISOString()} ${text}`);
    while (consoleMemory.length > CONSOLE_MEMORY_LIMIT) consoleMemory.shift();
  } catch (error) {
    // Keeping context must never be the reason a failure becomes invisible.
  }
}

/**
 * Returns the console errors kept so far.
 *
 * @returns {string[]} The most recent lines, oldest first.
 */
export function getRecentConsoleErrors() {
  return [...consoleMemory];
}

/**
 * Forgets every fingerprint and dialog counted so far.
 *
 * @returns {void}
 */
export function resetErrorReporter() {
  reported.clear();
  consoleMemory.length = 0;
  dialogCount = 0;
}

/**
 * Registers the function displaying a report.
 *
 * Reports that arrived before it (a boot failure, where `app.js` has not finished evaluating) are
 * flushed immediately.
 *
 * @param {(report: object) => void} nextPresenter - Function showing the dialog.
 * @returns {void}
 */
export function setErrorPresenter(nextPresenter) {
  presenter = typeof nextPresenter === 'function' ? nextPresenter : null;
  if (!presenter || pending.length === 0) return;

  const queued = pending;
  pending = [];
  queued.forEach((report) => {
    try {
      presenter(report);
    } catch (error) {
      console.error('[ErrorReporter] The presenter refused a report.', error);
    }
  });
}

/**
 * Loads the popup by itself when nothing else did.
 *
 * A page whose `app.js` never finished evaluating still has to be able to report why: the dialog is
 * the only module of the game that must work while everything else is broken.
 *
 * @returns {void}
 */
function schedulePresenterFallback() {
  if (fallbackScheduled) return;
  fallbackScheduled = true;
  window.setTimeout(async () => {
    if (presenter || pending.length === 0) return;
    try {
      const module = await import('../UI/components/ErrorPopup.js');
      setErrorPresenter((report) => module.default.show(report));
    } catch (error) {
      console.error('[ErrorReporter] The error dialog could not be loaded.', error);
    }
  }, 0);
}

/**
 * Hands a report to the dialog, or keeps it until one exists.
 *
 * @param {object} report - Report built by `createErrorReport()`.
 * @returns {void}
 */
function dispatch(report) {
  if (!presenter) {
    pending.push(report);
    schedulePresenterFallback();
    return;
  }
  try {
    presenter(report);
  } catch (error) {
    console.error('[ErrorReporter] The error dialog failed.', error);
  }
}

/**
 * Reports one failure: builds its report, then displays it once.
 *
 * The call is safe anywhere (a `catch`, a global listener, a view callback): it never throws, and it
 * returns the report so a caller can chain on it.
 *
 * @param {unknown} error - Value thrown or rejected.
 * @param {object} [options] - Report options.
 * @param {string} [options.source='app'] - Where the failure was caught.
 * @param {string} [options.titleKey] - i18n key of the dialog title.
 * @param {string} [options.bodyKey] - i18n key of the dialog message.
 * @param {object|null} [options.context=null] - Details of the failure.
 * @param {boolean} [options.silent=false] - True to log without opening a dialog.
 * @returns {Promise<object|null>} The report, or null when it was refused.
 */
export function reportError(
  error,
  { source = 'app', titleKey, bodyKey, context = null, silent = false } = {}
) {
  try {
    const normalized = normalizeError(error);
    const fingerprint = `${source}|${normalized.name}|${normalized.message}`;

    if (silent) {
      return Promise.resolve(null);
    }
    if (reported.has(fingerprint)) {
      console.warn(`[ErrorReporter] Already reported (${normalized.message}).`);
      return Promise.resolve(null);
    }
    reported.add(fingerprint);

    if (dialogCount >= MAX_ERROR_DIALOGS_PER_SESSION) {
      console.warn('[ErrorReporter] Error dialog limit reached for this page.');
      return Promise.resolve(null);
    }
    dialogCount += 1;

    return createErrorReport(error, {
      source,
      ...(titleKey ? { titleKey } : {}),
      ...(bodyKey ? { bodyKey } : {}),
      context,
      consoleErrors: getRecentConsoleErrors(),
    })
      .then((report) => {
        dispatch(report);
        return report;
      })
      .catch((reportError_) => {
        console.error('[ErrorReporter] The report could not be built.', reportError_);
        return null;
      });
  } catch (unexpected) {
    console.error('[ErrorReporter] Unexpected failure while reporting.', unexpected);
    return Promise.resolve(null);
  }
}

/**
 * Reports a failed resource (an image, a stylesheet, a module).
 *
 * Kept separate from the generic handler so the localisation of the popup matches what actually
 * broke, and so the URL is part of the fingerprint: ten missing images are ten distinct failures, but
 * the session limit keeps the tenth from opening a tenth dialog.
 *
 * @param {Element} element - Element that failed to load.
 * @returns {void}
 */
function reportResourceFailure(element) {
  const url = element.currentSrc || element.src || element.href || '(unknown)';
  const tag = element.tagName ? element.tagName.toLowerCase() : 'element';
  reportError(new Error(`Resource failed to load: ${tag} ${url}`), {
    source: 'resource',
    titleKey: 'error.popup.titleImage',
    bodyKey: 'error.popup.bodyImage',
    context: { tag, url },
  });
}

/**
 * Installs the global listeners, once per page.
 *
 * Called as early as possible (top of `app.js`), so a failure raised while the views boot is already
 * reported.
 *
 * @returns {void}
 */
export function installErrorReporter() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  // Capture phase: a failed `<img>` or `<link>` fires `error` on the element and does NOT let it
  // bubble, so listening on `window` without capture would miss every broken asset.
  window.addEventListener(
    'error',
    (event) => {
      const target = event.target;
      if (target && target !== window && target.nodeType === 1 && target.tagName) {
        reportResourceFailure(target);
        return;
      }
      const error = event.error instanceof Error ? event.error : new Error(event.message || 'Script error');
      reportError(error, {
        source: 'runtime',
        context: {
          file: event.filename ?? null,
          line: event.lineno ?? null,
          column: event.colno ?? null,
        },
      });
    },
    true
  );

  window.addEventListener('unhandledrejection', (event) => {
    reportError(event.reason, { source: 'promise' });
  });

  if (typeof console !== 'undefined' && !originalConsoleError) {
    originalConsoleError = console.error.bind(console);
    console.error = (...args) => {
      rememberConsoleError(args);
      originalConsoleError(...args);
    };
  }
}

export default reportError;

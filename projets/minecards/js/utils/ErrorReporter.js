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
 * SEVERITY AND THE ERROR LOG
 * Every failure is recorded in `js/utils/ErrorLog.js`, which the settings lists (last five DISTINCT
 * incidents, with their severity and occurrence count). Only a BLOCKING one opens a dialog: the
 * sources of `MINOR_ERROR_SOURCES` are failures the game survives, and interrupting the player for
 * them would bury the failure that really stopped them. A minor incident is therefore visible in
 * the settings, never as a popup.
 *
 * WHAT IT GUARANTEES
 *   - the same failure is reported ONCE per page (fingerprint on source + name + message);
 *   - at most `MAX_ERROR_DIALOGS_PER_SESSION` dialogs per page, so a broken CDN cannot bury the game
 *     under modals: past that limit the failures stay in the console (and in the next report);
 *   - nothing here ever throws: an error reporter that breaks the page it reports on would be worse
 *     than no reporter at all.
 */

import { buildErrorCode, createErrorReport, normalizeError } from './ErrorReport.js';
import { errorLog, ERROR_SEVERITY } from './ErrorLog.js';

/** Maximum number of dialogs opened per page, whatever the number of failures. */
export const MAX_ERROR_DIALOGS_PER_SESSION = 3;

/** Maximum number of console errors kept as context. */
const CONSOLE_MEMORY_LIMIT = 12;

/** Longest console line kept, in characters. */
const CONSOLE_LINE_MAX_CHARS = 220;

/**
 * Browser warnings that are NOT failures of the game.
 *
 * Blink raises "ResizeObserver loop completed with undelivered notifications" (and its "limit
 * exceeded" sibling) when an observed element changes size while the observer callbacks run. The
 * layout is correct on the next frame, nothing is broken, and the browser itself calls it a warning:
 * opening a crash dialog for it buries the real failures under noise nobody can act on.
 */
const IGNORED_ERROR_PATTERNS = [/^ResizeObserver loop/i];

/**
 * Sources whose failure the game SURVIVES, so no dialog is worth interrupting the player for.
 *
 * Interrupting a player is a cost: the dialog stops the game, and three of them already saturate a
 * page. These failures leave the game playable, which is what makes them MINOR:
 *   - `resource`: an illustration, a stylesheet or a module failed to load, and the screen fell
 *     back to its placeholder (`ImagePreloader`, `image-loader`);
 *   - `service-worker`: the browser refused to install the offline shell (a scope it does not
 *     allow, a hardened profile). The game runs, only the offline mode is missing;
 *   - `booster-3d`: the 3D scene failed and the opening already switched to its 2D booster;
 *   - `promise`: a promise nobody awaited rejected. The page continues; the operation that failed
 *     reports its own feedback where the player can act on it.
 * A `runtime` exception, a failed `boot` or the default `app` source stay BLOCKING: nothing tells
 * whether the game is still doing what it was asked, so the player gets the dialog and the code.
 */
export const MINOR_ERROR_SOURCES = Object.freeze([
  'resource',
  'service-worker',
  'booster-3d',
  'promise',
]);

/**
 * Resolves the severity of a failure.
 *
 * @param {string} source - Where the failure was caught.
 * @param {string|null} [explicit=null] - Severity explicitly asked by the caller, when known.
 * @returns {string} `ERROR_SEVERITY.MINOR` or `ERROR_SEVERITY.BLOCKING`.
 */
export function resolveErrorSeverity(source, explicit = null) {
  if (explicit === ERROR_SEVERITY.MINOR || explicit === ERROR_SEVERITY.BLOCKING) return explicit;
  return MINOR_ERROR_SOURCES.includes(source) ? ERROR_SEVERITY.MINOR : ERROR_SEVERITY.BLOCKING;
}

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
 * @param {string|null} [options.severity=null] - Severity to force (`minor` or `blocking`); by
 *   default it comes from the source (`MINOR_ERROR_SOURCES`). A minor failure is recorded in the
 *   error log of the settings and NEVER opens a dialog.
 * @returns {Promise<object|null>} The report (blocking failures only), or null otherwise.
 */
export function reportError(
  error,
  { source = 'app', titleKey, bodyKey, context = null, silent = false, severity = null } = {}
) {
  try {
    const normalized = normalizeError(error);
    if (IGNORED_ERROR_PATTERNS.some((pattern) => pattern.test(normalized.message))) {
      console.info('[ErrorReporter] Ignored a browser warning.', normalized.message);
      return Promise.resolve(null);
    }
    const fingerprint = `${source}|${normalized.name}|${normalized.message}`;

    if (silent) {
      return Promise.resolve(null);
    }
    if (reported.has(fingerprint)) {
      console.warn(`[ErrorReporter] Already reported (${normalized.message}).`);
      return Promise.resolve(null);
    }
    reported.add(fingerprint);

    // Remembered whatever its severity: the settings is where a minor failure is read, since it
    // never opens a dialog.
    const resolvedSeverity = resolveErrorSeverity(source, severity);
    errorLog.record({
      code: buildErrorCode({ name: normalized.name, message: normalized.message, source }),
      message: normalized.message,
      source,
      severity: resolvedSeverity,
    });

    if (resolvedSeverity === ERROR_SEVERITY.MINOR) {
      console.info(`[ErrorReporter] Minor failure recorded (${source}): ${normalized.message}`);
      return Promise.resolve(null);
    }

    if (dialogCount >= MAX_ERROR_DIALOGS_PER_SESSION) {
      console.warn('[ErrorReporter] Error dialog limit reached for this page.');
      return Promise.resolve(null);
    }
    dialogCount += 1;

    return createErrorReport(error, {
      source,
      severity: resolvedSeverity,
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

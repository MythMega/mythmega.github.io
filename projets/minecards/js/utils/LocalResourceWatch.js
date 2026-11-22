/**
 * LocalResourceWatch - Names the `file:///` a page is not allowed to reach.
 *
 * Reference: `js/utils/ErrorReporter.js` (the door every finding goes through), `js/utils/ErrorLog.js`
 * (the "Rapport d'erreurs" panel of the settings) and `.docs/main.md` section 3.K.
 *
 * WHY IT EXISTS
 * A page served over HTTP may not load or link a `file:///` URL. Firefox refuses it without raising
 * any JavaScript error, and says only: "Security Error: Content at http://localhost:4587/index.html
 * may not load data or link to file:///". The line names the PAGE, never the resource and never the
 * code that asked for it, so the report is unusable as it stands. Nothing in this game builds a
 * `file:` URL: when one appears it comes from data (a stored path, an imported save), from a
 * stylesheet, or from outside the game (an extension or a userscript that adds a node to the page),
 * and finding it by hand means bisecting the DOM.
 *
 * WHAT IT WATCHES
 *   - the DOM: every `src`, `href`, `srcset`, `poster`, `data` and inline `style` carrying a `file:`
 *     URL, once at boot and then on every insertion or attribute change;
 *   - the stylesheets: an `@import` or a `url()` of `file:` in a same-origin sheet or a `<style>`;
 *   - the two APIs that take a URL from code - `fetch` and `XMLHttpRequest#open` - where a complete
 *     stack is available and names the caller.
 *
 * WHAT IT REPORTS
 * One MINOR incident per reference: the message names the kind and the URL, the detail names the
 * element path or the calling frame, and the console keeps the whole stack. The incident is listed
 * in the settings, and opens no dialog - the game runs, and interrupting the player for it would
 * bury the failure that actually stopped them. At most `MAX_REPORTS` incidents are recorded per page,
 * so a page that repeats the same reference cannot flush the five slots of the log; the rest stays in
 * the console.
 *
 * WHY IT DOES NOTHING ON A `file:` PAGE
 * Opening the game by double-clicking `index.html` makes EVERY relative URL local: there is nothing
 * to diagnose, and `start_server.cmd` already explains why that page cannot work.
 */

import { reportError } from './ErrorReporter.js';

/** Incidents recorded per page, before the console alone carries the rest. */
const MAX_REPORTS = 2;

/** Attributes carrying a URL that a page may load or follow. */
const URL_ATTRIBUTES = ['src', 'href', 'srcset', 'poster', 'data'];

/** Elements holding one of the attributes above, or an inline style. */
const URL_SELECTOR = '[src], [href], [srcset], [poster], [data], [style]';

/** A URL of the `file:` scheme, with the whitespace a hand-written value may carry. */
const LOCAL_URL = /^\s*file:/i;

/** A `url(...)` of a stylesheet or of an inline style. */
const CSS_URL = /url\(\s*['"]?([^'")]+)['"]?\s*\)/gi;

/** @type {boolean} True once the listeners are installed. */
let installed = false;

/** @type {number} Incidents recorded so far. */
let reportCount = 0;

/** @type {Set<string>} References already seen, so a re-render cannot report the same one twice. */
const seen = new Set();

/**
 * Tells whether a value is a local (`file:`) URL.
 *
 * @param {unknown} value - URL to test, as written in an attribute, a style or a call.
 * @returns {boolean} True for the `file:` scheme.
 */
function isLocalResourceUrl(value) {
  return typeof value === 'string' && LOCAL_URL.test(value);
}

/**
 * Lists the local URLs of a stylesheet text.
 *
 * @param {string} css - Text of a `<style>` block or of a rule.
 * @returns {string[]} The `file:` URLs it references.
 */
function listLocalCssUrls(css) {
  const urls = [];
  CSS_URL.lastIndex = 0;
  let match = CSS_URL.exec(css);
  while (match !== null) {
    if (isLocalResourceUrl(match[1])) urls.push(match[1].trim());
    match = CSS_URL.exec(css);
  }
  return urls;
}

/**
 * Describes an element as a short path, for a message a developer can locate.
 *
 * @param {Element} element - Element carrying the reference.
 * @returns {string} Up to three steps, `section#settings-panel-errors > div.settings > img`.
 */
function describeElement(element) {
  const parts = [];
  let node = element;
  while (node && node.nodeType === 1 && parts.length < 3) {
    const className = typeof node.className === 'string' ? node.className.trim().split(/\s+/)[0] : '';
    parts.unshift(
      `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ''}${className ? `.${className}` : ''}`
    );
    node = node.parentElement;
  }
  return parts.join(' > ');
}

/**
 * Adds the local references carried by one element to a list.
 *
 * @param {Element} element - Element to inspect.
 * @param {Array<{kind: string, url: string, label: string}>} found - List to append to.
 * @returns {void}
 */
function inspectElement(element, found) {
  if (!element || element.nodeType !== 1) return;
  const label = describeElement(element);
  URL_ATTRIBUTES.forEach((attribute) => {
    const value = element.getAttribute(attribute);
    if (isLocalResourceUrl(value)) found.push({ kind: attribute, url: value, label });
  });
  const style = element.getAttribute('style');
  if (typeof style === 'string') {
    listLocalCssUrls(style).forEach((url) => found.push({ kind: 'inline style', url, label }));
  }
}

/**
 * Reads the `file:` URLs of the stylesheets the page can read.
 *
 * A cross-origin sheet throws on `cssRules`: it is skipped, because a local URL never comes from one.
 *
 * @returns {Array<{kind: string, url: string, label: string}>} The references found.
 */
function scanStyleSheets() {
  const found = [];
  Array.from(document.styleSheets ?? []).forEach((sheet) => {
    let rules;
    try {
      rules = Array.from(sheet.cssRules ?? []);
    } catch (error) {
      return;
    }
    rules.forEach((rule) => {
      listLocalCssUrls(rule.cssText ?? '').forEach((url) =>
        found.push({ kind: 'stylesheet', url, label: sheet.href ? sheet.href.split('/').pop() : 'inline' })
      );
    });
  });
  return found;
}

/**
 * Lists every local reference the page currently carries.
 *
 * @returns {Array<{kind: string, url: string, label: string}>} The references, in document order.
 */
function findLocalReferences() {
  if (typeof document === 'undefined') return [];
  const found = [];
  document.querySelectorAll(URL_SELECTOR).forEach((element) => inspectElement(element, found));
  document.querySelectorAll('style').forEach((element) => {
    listLocalCssUrls(element.textContent ?? '').forEach((url) =>
      found.push({ kind: '<style>', url, label: describeElement(element) })
    );
  });
  scanStyleSheets().forEach((entry) => found.push(entry));
  return found;
}

/**
 * Reads the first frame of a stack that belongs to the game.
 *
 * The frame of this module is skipped: a wrapper is always the top of the stack it captures, and
 * naming `watchedFetch` would hide the caller it exists to find.
 *
 * @param {string|null} stack - Stack captured with `new Error().stack`.
 * @returns {string} The frame, e.g. `at StatsView.js:519`, or an empty string.
 */
function firstApplicationFrame(stack) {
  if (typeof stack !== 'string') return '';
  const frame = stack
    .split('\n')
    .find((line) => line.includes('js/') && !line.includes('LocalResourceWatch.js'));
  return frame ? frame.trim().replace(/^at\s+/, '') : '';
}

/**
 * Logs one reference in the console and records it in the error log of the settings.
 *
 * @param {{kind: string, url: string, label?: string, stack?: string|null}} reference - The reference.
 * @returns {void}
 */
function reportReference({ kind, url, label = '', stack = null }) {
  const key = `${kind}|${url}`;
  if (seen.has(key)) return;
  seen.add(key);

  const shortUrl = url.length > 120 ? `${url.slice(0, 119)}…` : url;
  const message = `file:/// reference in ${kind}: ${shortUrl}`;
  const caller = firstApplicationFrame(stack);

  // The console keeps what the log cannot: the whole stack, on one line per frame.
  console.warn(`[LocalResourceWatch] ${message}${label ? ` (${label})` : ''}`, stack ?? '');

  if (reportCount >= MAX_REPORTS) {
    console.warn('[LocalResourceWatch] Further references stay in the console, unrecorded.');
    return;
  }
  reportCount += 1;

  reportError(new Error(message), {
    source: 'resource',
    details: label ? `element: ${label}` : caller ? `caller: ${caller}` : null,
    context: { kind, url: shortUrl, label: label || null, caller: caller || null },
  });
}

/**
 * Wraps `fetch` and `XMLHttpRequest#open`, the two APIs where a stack is available.
 *
 * @returns {void}
 */
function installApiWrappers() {
  const nativeFetch = window.fetch;
  if (typeof nativeFetch === 'function') {
    window.fetch = function watchedFetch(input, init) {
      const url = typeof input === 'string' ? input : (input?.url ?? '');
      if (isLocalResourceUrl(url)) reportReference({ kind: 'fetch', url, stack: new Error().stack });
      return nativeFetch.call(this, input, init);
    };
  }

  const prototype = window.XMLHttpRequest?.prototype;
  if (prototype && typeof prototype.open === 'function') {
    const nativeOpen = prototype.open;
    prototype.open = function watchedOpen(method, url, ...rest) {
      if (isLocalResourceUrl(url)) {
        reportReference({ kind: 'XMLHttpRequest', url, stack: new Error().stack });
      }
      return nativeOpen.call(this, method, url, ...rest);
    };
  }
}

/**
 * Installs the watch, once per page.
 *
 * Called as early as the error reporter in `app.js`: a reference added to the DOM before the first
 * view is built is exactly the one that produces the unexplained console line.
 *
 * @returns {void}
 */
export function installLocalResourceWatch() {
  if (installed || typeof window === 'undefined' || typeof document === 'undefined') return;
  installed = true;

  if (!/^https?:$/.test(window.location.protocol)) {
    console.info(
      `[LocalResourceWatch] Page served over "${window.location.protocol}": every relative URL is ` +
        'local, nothing to diagnose. Start the game with start_server.cmd.'
    );
    return;
  }

  const initial = findLocalReferences();
  initial.forEach((reference) => reportReference(reference));
  installApiWrappers();

  console.info(
    `[LocalResourceWatch] Watching for file:/// references: ${initial.length} found at boot.`
  );

  if (typeof MutationObserver !== 'function' || !document.documentElement) return;
  const observer = new MutationObserver((records) => {
    records.forEach((record) => {
      if (record.type === 'attributes') {
        const found = [];
        inspectElement(record.target, found);
        found.forEach((reference) => reportReference(reference));
        return;
      }
      record.addedNodes.forEach((node) => {
        if (!node || node.nodeType !== 1) return;
        const found = [];
        inspectElement(node, found);
        node.querySelectorAll(URL_SELECTOR).forEach((child) => inspectElement(child, found));
        found.forEach((reference) => reportReference(reference));
      });
    });
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: [...URL_ATTRIBUTES, 'style'],
  });
}

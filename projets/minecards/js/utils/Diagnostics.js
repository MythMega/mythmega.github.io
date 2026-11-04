/**
 * Diagnostics - Runtime snapshot an error report is built from.
 *
 * Reference: `js/utils/ErrorReport.js` (the report that carries it),
 * `js/UI/components/ErrorPopup.js` (the dialog that copies it) and `.docs/main.md` section 3.K.
 *
 * WHY IT EXISTS
 * A player writing "the 3D scene is black" cannot answer, and must not be asked, which graphics card,
 * driver, browser build, WebGL vendor or game release they run: every one of those is exactly what
 * decides the answer. This module gathers them once, as plain data, so the report a player pastes in
 * the Discord holds the technical context nobody would type by hand.
 *
 * WHAT IT READS
 *   - the browser (user agent, engine, language, online state, connection quality);
 *   - the device (screen, viewport, pixel ratio, cores, memory, touch, motion and colour
 *     preferences), which is where a "black canvas on a weak machine" story starts;
 *   - the graphics stack (WebGL 1 and 2, vendor and renderer strings, SOFTWARE emulation flag,
 *     maximum texture size): a canvas that stays black is almost always one of those values;
 *   - the storage (IndexedDB, quota, usage, persistent flag) and the shell release (`caches`
 *     names carry the service worker `VERSION`, i.e. which build the player actually runs);
 *   - the game itself (URL, language mirror, theme, visible view).
 *
 * NOTHING HERE THROWS. Every probe is guarded: a browser that refuses `navigator.storage`, a page
 * without WebGL or a `localStorage` disabled by a privacy setting must degrade to `null` fields, not
 * break the very report that describes the failure.
 */

/** Timeout of the storage estimate, in milliseconds: the dialog must not wait on a slow quota. */
const STORAGE_ESTIMATE_TIMEOUT_MS = 1200;

/**
 * Cached WebGL description.
 *
 * The probe creates up to three contexts (WebGL 2, WebGL 1 and the software check): browsers cap the
 * number of live contexts, so it runs once per page and every context is released immediately.
 *
 * @type {object|null}
 */
let webglCache = null;

/**
 * Reads a `localStorage` value without ever throwing.
 *
 * Private windows and hardened privacy settings throw on ACCESS, not only on write, so the call
 * itself is inside the guard.
 *
 * @param {string} key - Storage key.
 * @returns {string|null} The value, or null when it cannot be read.
 */
function readStorageItem(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (error) {
    return null;
  }
}

/**
 * Names the browser from its user agent.
 *
 * Order matters: Edge and Opera both announce `Chrome`, and Chrome announces `Safari`, so the most
 * specific token is tested first.
 *
 * @param {string} userAgent - `navigator.userAgent`.
 * @returns {{name: string, version: string|null}} A readable name and version.
 */
function detectBrowser(userAgent) {
  const ua = String(userAgent ?? '');
  const match = (pattern) => {
    const found = pattern.exec(ua);
    return found ? found[1] ?? null : null;
  };

  if (/Firefox\//.test(ua)) return { name: 'Firefox', version: match(/Firefox\/([\d.]+)/) };
  if (/Edg\//.test(ua)) return { name: 'Edge', version: match(/Edg\/([\d.]+)/) };
  if (/OPR\//.test(ua) || /\bOpera\b/.test(ua)) return { name: 'Opera', version: match(/OPR\/([\d.]+)/) };
  if (/SamsungBrowser\//.test(ua)) {
    return { name: 'Samsung Internet', version: match(/SamsungBrowser\/([\d.]+)/) };
  }
  if (/Chrome\//.test(ua) || /CriOS\//.test(ua)) {
    return { name: 'Chrome', version: match(/(?:Chrome|CriOS)\/([\d.]+)/) };
  }
  if (/Safari\//.test(ua)) return { name: 'Safari', version: match(/Version\/([\d.]+)/) };
  if (/Trident\/|MSIE /.test(ua)) return { name: 'Internet Explorer', version: match(/(?:rv|MSIE):? ?([\d.]+)/) };
  return { name: 'unknown', version: null };
}

/**
 * Names the operating system from its user agent.
 *
 * Windows announces `Windows NT 10.0` for both Windows 10 and 11 (the token is frozen on purpose),
 * so the raw token is kept beside the readable name.
 *
 * @param {string} userAgent - `navigator.userAgent`.
 * @returns {{name: string, version: string|null}} A readable name and version.
 */
function detectOs(userAgent) {
  const ua = String(userAgent ?? '');
  const match = (pattern) => {
    const found = pattern.exec(ua);
    return found ? found[1] ?? null : null;
  };

  if (/Windows NT/.test(ua)) {
    return { name: 'Windows', version: match(/Windows NT ([\d.]+)/) };
  }
  if (/Android/.test(ua)) return { name: 'Android', version: match(/Android ([\d.]+)/) };
  if (/iPhone|iPad|iPod/.test(ua)) {
    return { name: 'iOS', version: match(/OS ([\d_]+)/)?.replace(/_/g, '.') ?? null };
  }
  if (/Mac OS X/.test(ua)) return { name: 'macOS', version: match(/Mac OS X ([\d_.]+)/)?.replace(/_/g, '.') ?? null };
  if (/CrOS/.test(ua)) return { name: 'ChromeOS', version: null };
  if (/Linux/.test(ua)) return { name: 'Linux', version: null };
  return { name: 'unknown', version: null };
}

/**
 * Tells whether a renderer string names a software rasterizer.
 *
 * A Windows install without its graphics driver falls back to the Microsoft Basic Render Driver, and
 * Firefox or Chrome then emulate WebGL in software: the context EXISTS, the shaders compile, and the
 * canvas can still stay black or crawl. Those strings are the only trace of it a page can read.
 *
 * @param {string|null} renderer - Unmasked renderer string of the context.
 * @returns {boolean} True when the renderer is a software one.
 */
function looksLikeSoftwareRenderer(renderer) {
  if (typeof renderer !== 'string') return false;
  return /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic|angle \(google, vulkan 1\.\d+ \(swiftshader/i.test(
    renderer
  );
}

/**
 * Builds a WebGL context on a throwaway canvas.
 *
 * @param {'webgl2'|'webgl'} kind - Context kind to request.
 * @param {object} [attributes] - Context attributes.
 * @returns {object|null} The context, or null when the browser refuses it.
 */
function createProbeContext(kind, attributes = {}) {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    return canvas.getContext(kind, attributes);
  } catch (error) {
    return null;
  }
}

/**
 * Releases a probe context.
 *
 * @param {object|null} context - Context to release.
 * @returns {void}
 */
function releaseProbeContext(context) {
  try {
    context?.getExtension?.('WEBGL_lose_context')?.loseContext?.();
  } catch (error) {
    // A context that refuses to be lost is collected by the browser anyway.
  }
}

/**
 * Describes the graphics stack of the browser.
 *
 * @returns {{webgl: boolean, webgl2: boolean, software: boolean, vendor: string|null,
 *   renderer: string|null, version: string|null, maxTextureSize: number|null,
 *   failedIfCaveat: boolean|null, error: string|null}} The description.
 */
function readWebGlInfo() {
  if (webglCache) return webglCache;

  const info = {
    webgl: false,
    webgl2: false,
    software: false,
    vendor: null,
    renderer: null,
    version: null,
    maxTextureSize: null,
    failedIfCaveat: null,
    error: null,
  };

  let context = createProbeContext('webgl2');
  if (context) {
    info.webgl = true;
    info.webgl2 = true;
  } else {
    context = createProbeContext('webgl');
    info.webgl = Boolean(context);
  }

  if (context) {
    try {
      const debug = context.getExtension('WEBGL_debug_renderer_info');
      info.vendor = debug
        ? String(context.getParameter(debug.UNMASKED_VENDOR_WEBGL) ?? '')
        : String(context.getParameter(context.VENDOR) ?? '');
      info.renderer = debug
        ? String(context.getParameter(debug.UNMASKED_RENDERER_WEBGL) ?? '')
        : String(context.getParameter(context.RENDERER) ?? '');
      info.version = String(context.getParameter(context.VERSION) ?? '');
      const maxTextureSize = context.getParameter(context.MAX_TEXTURE_SIZE);
      info.maxTextureSize = typeof maxTextureSize === 'number' ? maxTextureSize : null;
      info.software = looksLikeSoftwareRenderer(info.renderer);
    } catch (error) {
      info.error = error instanceof Error ? error.message : String(error);
    }
    releaseProbeContext(context);
  }

  // The only way to ask "will this be slow?" instead of guessing from the renderer string: a
  // context that refuses a MAJOR performance caveat is one the browser itself calls emulated.
  const strict = createProbeContext('webgl', { failIfMajorPerformanceCaveat: true });
  if (strict) {
    info.failedIfCaveat = false;
    releaseProbeContext(strict);
  } else if (info.webgl) {
    info.failedIfCaveat = true;
    info.software = true;
  }

  webglCache = info;
  return info;
}

/**
 * Reads the storage quota and usage.
 *
 * @returns {Promise<{usage: number|null, quota: number|null, persisted: boolean|null}>} The estimate.
 */
async function readStorageInfo() {
  const info = { usage: null, quota: null, persisted: null };
  const storage = typeof navigator !== 'undefined' ? navigator.storage : null;
  if (!storage) return info;

  try {
    if (typeof storage.estimate === 'function') {
      const estimate = await Promise.race([
        storage.estimate(),
        new Promise((resolve) => {
          window.setTimeout(() => resolve(null), STORAGE_ESTIMATE_TIMEOUT_MS);
        }),
      ]);
      if (estimate) {
        info.usage = Number.isFinite(estimate.usage) ? estimate.usage : null;
        info.quota = Number.isFinite(estimate.quota) ? estimate.quota : null;
      }
    }
    if (typeof storage.persisted === 'function') {
      info.persisted = await storage.persisted();
    }
  } catch (error) {
    // A browser without a quota manager simply reports nothing.
  }
  return info;
}

/**
 * Reads the release of the shell the page runs on.
 *
 * The service worker names its caches after its `VERSION` constant, which is the only build number a
 * page can read without an extra download: it tells whether a player is on an old cached shell.
 *
 * @returns {Promise<{serviceWorker: boolean, controller: boolean, caches: string[]}>} The shell info.
 */
async function readShellInfo() {
  const info = { serviceWorker: false, controller: false, caches: [] };
  try {
    info.serviceWorker = 'serviceWorker' in navigator;
    info.controller = Boolean(navigator.serviceWorker?.controller);
  } catch (error) {
    // Nothing to read.
  }
  try {
    if ('caches' in window) {
      info.caches = (await caches.keys()).sort();
    }
  } catch (error) {
    // The Cache API is closed: the list stays empty.
  }
  return info;
}

/**
 * Reads what the game itself currently displays.
 *
 * @returns {{url: string, referrer: string, language: string, mirroredLanguage: string|null,
 *   theme: string|null, views: string[], bootOverlay: boolean}} The page state.
 */
function readGameInfo() {
  const root = typeof document !== 'undefined' ? document.documentElement : null;
  const visibleViews = Array.from(document.querySelectorAll('[data-view]'))
    .filter((section) => !section.hidden && section.getClientRects().length > 0)
    .map((section) => section.dataset.view ?? '?');

  return {
    url: typeof location !== 'undefined' ? location.href : '',
    referrer: typeof document !== 'undefined' ? document.referrer : '',
    language: root?.lang ?? '',
    mirroredLanguage: readStorageItem('mc_lang'),
    theme: root?.dataset.theme ?? null,
    views: visibleViews,
    bootOverlay: Boolean(document.querySelector('[data-boot-overlay]')),
  };
}

/**
 * Reads the device and the display it renders on.
 *
 * @returns {object} Screen, viewport, cores, memory, touch and motion preferences.
 */
function readDeviceInfo() {
  const matchMedia = (query) => {
    try {
      return window.matchMedia(query).matches;
    } catch (error) {
      return null;
    }
  };
  const connection =
    navigator.connection ?? navigator.mozConnection ?? navigator.webkitConnection ?? null;

  return {
    platform: navigator.platform ?? '',
    userAgent: navigator.userAgent ?? '',
    language: navigator.language ?? '',
    languages: Array.isArray(navigator.languages) ? navigator.languages.slice(0, 5) : [],
    hardwareConcurrency: Number.isFinite(navigator.hardwareConcurrency)
      ? navigator.hardwareConcurrency
      : null,
    deviceMemory: Number.isFinite(navigator.deviceMemory) ? navigator.deviceMemory : null,
    online: navigator.onLine ?? null,
    connection: connection
      ? {
          effectiveType: connection.effectiveType ?? null,
          downlink: Number.isFinite(connection.downlink) ? connection.downlink : null,
          rtt: Number.isFinite(connection.rtt) ? connection.rtt : null,
          saveData: connection.saveData ?? null,
        }
      : null,
    touch: (navigator.maxTouchPoints ?? 0) > 0,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    devicePixelRatio: Number.isFinite(window.devicePixelRatio) ? window.devicePixelRatio : null,
    screen: `${window.screen?.width ?? 0}x${window.screen?.height ?? 0}`,
    colorDepth: window.screen?.colorDepth ?? null,
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)'),
    darkMode: matchMedia('(prefers-color-scheme: dark)'),
  };
}

/**
 * Collects the whole runtime snapshot of a report.
 *
 * @returns {Promise<{browser: object, os: object, device: object, game: object, graphics: object,
 *   storage: object, shell: object, timezone: string|null}>} The snapshot.
 */
export async function collectDiagnostics() {
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  let timezone = null;
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch (error) {
    timezone = null;
  }

  return {
    browser: {
      ...detectBrowser(userAgent),
      engine: /Gecko\/|Firefox\//.test(userAgent)
        ? 'Gecko'
        : /AppleWebKit/.test(userAgent) && !/Chrome|Chromium/.test(userAgent)
          ? 'WebKit'
          : 'Blink',
      userAgent,
      language: navigator.language ?? '',
      online: navigator.onLine ?? null,
    },
    os: detectOs(userAgent),
    device: readDeviceInfo(),
    game: readGameInfo(),
    graphics: readWebGlInfo(),
    storage: await readStorageInfo(),
    shell: await readShellInfo(),
    timezone,
  };
}

/**
 * Forgets the cached graphics description (a context lost for good can change it).
 *
 * @returns {void}
 */
export function resetDiagnosticsCache() {
  webglCache = null;
}

export default collectDiagnostics;

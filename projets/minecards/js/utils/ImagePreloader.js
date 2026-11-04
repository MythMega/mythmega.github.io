/**
 * ImagePreloader - Warms the pictures a flow is about to display.
 *
 * Reference: `js/UI/components/CardRoulettePopup.js` and `js/UI/views/OpeningView.js` (the two
 * flows that show several illustrations at once), `.docs/main.md` section 3.K.
 *
 * WHY IT EXISTS
 * Card illustrations live on a remote CDN and every flow used to let the browser fetch them the
 * moment they were needed: the wheel span with empty tiles, the first card of a booster flipped to a
 * blank face for a fraction of a second, and a slow connection turned that fraction into a visible
 * stall. Asking for the pictures BEFORE the animation starts removes the stall without touching the
 * animation.
 *
 * THE ONE PROMISE PER URL
 * A URL is downloaded and decoded once per page: the second call gets the promise of the first,
 * which is what makes it safe to preload eagerly (opening a booster, opening a wheel) and to await
 * lazily (just before painting the tile) without ever requesting the file twice.
 *
 * A FAILURE IS NOT FATAL
 * Preloading never rejects. Each entry resolves to `true` (ready) or `false` (failed or too slow),
 * and a failed entry is forgotten so a later attempt can retry: a flow must degrade to its normal
 * behaviour (the browser's own `img` load, or the card name fallback), never block on this module.
 */

/** Timeout of one preload, in milliseconds: past it the flow stops waiting and paints anyway. */
export const IMAGE_PRELOAD_TIMEOUT_MS = 15000;

/**
 * One entry per URL, keeping the `Image` object alive.
 *
 * The reference matters: an `Image` that nobody holds can be collected between the preload and the
 * insertion of the `<img>`, which decodes the file a second time and reintroduces the very stall this
 * module removes.
 *
 * @type {Map<string, {image: HTMLImageElement, promise: Promise<boolean>}>}
 */
const entries = new Map();

/**
 * Preloads one picture.
 *
 * @param {string|null|undefined} url - Picture to download.
 * @param {object} [options] - Preload options.
 * @param {number} [options.timeout=IMAGE_PRELOAD_TIMEOUT_MS] - Maximum wait, in milliseconds.
 * @returns {Promise<boolean>} True when the picture is decoded and ready to paint.
 */
export function preloadImage(url, { timeout = IMAGE_PRELOAD_TIMEOUT_MS } = {}) {
  if (typeof url !== 'string' || url.trim() === '') return Promise.resolve(false);

  const known = entries.get(url);
  if (known) return known.promise;

  const image = new Image();
  image.decoding = 'async';

  const promise = new Promise((resolve) => {
    let settled = false;
    let timer = null;

    /**
     * Ends the wait once.
     *
     * @param {boolean} ready - True when the picture loaded.
     * @returns {void}
     */
    const settle = (ready) => {
      if (settled) return;
      settled = true;
      if (timer !== null) window.clearTimeout(timer);
      resolve(ready);
    };

    timer = window.setTimeout(() => settle(false), timeout);
    image.addEventListener('load', () => settle(true), { once: true });
    image.addEventListener('error', () => settle(false), { once: true });
    image.src = url;

    // A data URI or an already decoded file: `load` may not fire again.
    if (image.complete) settle(image.naturalWidth > 0);
  });

  entries.set(url, { image, promise });
  // A failed entry is forgotten, so a retry after a reconnection starts a real request instead of
  // replaying the rejected promise.
  void promise.then((ready) => {
    if (!ready) entries.delete(url);
  });

  return promise;
}

/**
 * Preloads several pictures at once.
 *
 * Every URL is requested in parallel and the promise resolves when all of them settled: the slowest
 * picture decides, which is exactly what a flow waiting for a complete strip needs.
 *
 * @param {Array<string|null|undefined>} urls - Pictures to download (duplicates are ignored).
 * @param {object} [options] - Preload options (see `preloadImage`).
 * @returns {Promise<{total: number, ready: number, failed: string[]}>} The outcome.
 */
export async function preloadImages(urls, { timeout = IMAGE_PRELOAD_TIMEOUT_MS } = {}) {
  const unique = Array.from(new Set((Array.isArray(urls) ? urls : []).filter(Boolean)));
  if (unique.length === 0) return { total: 0, ready: 0, failed: [] };

  const results = await Promise.all(unique.map((url) => preloadImage(url, { timeout })));
  const failed = unique.filter((url, index) => !results[index]);
  return { total: unique.length, ready: unique.length - failed.length, failed };
}

/**
 * Tells whether a picture is already decoded.
 *
 * @param {string|null|undefined} url - Picture to test.
 * @returns {boolean} True when the picture can be painted without a network round trip.
 */
export function isImageReady(url) {
  if (typeof url !== 'string') return false;
  const entry = entries.get(url);
  if (!entry) return false;
  return entry.image.complete && entry.image.naturalWidth > 0;
}

/**
 * Tells whether a preload was started for a picture and is still running.
 *
 * @param {string|null|undefined} url - Picture to test.
 * @returns {boolean} True when a download is in flight for that picture.
 */
export function isImagePending(url) {
  if (typeof url !== 'string') return false;
  const entry = entries.get(url);
  return Boolean(entry) && !entry.image.complete;
}

/**
 * Forgets every preloaded picture.
 *
 * @returns {void}
 */
export function resetPreloadedImages() {
  entries.clear();
}

export default preloadImages;

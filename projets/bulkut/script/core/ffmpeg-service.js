/**
 * ffmpeg.wasm loader + command runner.
 *
 * Uses the single-threaded `@ffmpeg/core` build (no SharedArrayBuffer, no
 * COOP/COEP headers), so it also works on GitHub Pages.
 * @module core/ffmpeg-service
 */

import { AppError } from './app-error.js';

const TIME_PATTERN = /\btime=\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/;
const MAX_LOGS = 5000;

/**
 * @param {string} url
 * @param {string} mime
 * @returns {Promise<string>} blob URL
 */
async function toBlobURL(url, mime) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} — ${url}`);
  const buffer = await response.arrayBuffer();
  return URL.createObjectURL(new Blob([buffer], { type: mime }));
}

export class FFmpegService {
  #config;
  #ffmpeg = null;
  #loadPromise = null;
  #status = 'idle';
  /** @type {Set<(status: string, detail?: unknown) => void>} */
  #statusListeners = new Set();
  /** @type {null | { duration: number, logs: string[], onProgress?: (ratio: number) => void, lastRatio: number, lastEmit: number }} */
  #run = null;
  /** @type {{ coreURL: string, wasmURL: string } | null} */
  #assetUrls = null;

  /** @param {Record<string, any>} config */
  constructor(config) {
    this.#config = config;
  }

  get status() {
    return this.#status;
  }

  get loaded() {
    return Boolean(this.#ffmpeg);
  }

  /** @param {(status: string, detail?: unknown) => void} listener */
  onStatus(listener) {
    this.#statusListeners.add(listener);
    listener(this.#status);
    return () => this.#statusListeners.delete(listener);
  }

  #setStatus(status, detail) {
    this.#status = status;
    for (const listener of this.#statusListeners) listener(status, detail);
  }

  /** @returns {Promise<import('@ffmpeg/ffmpeg').FFmpeg>} */
  async ensureLoaded() {
    if (this.#ffmpeg) return this.#ffmpeg;
    if (this.#loadPromise) return this.#loadPromise;

    this.#setStatus('loading');
    this.#loadPromise = (async () => {
      const Constructor = window.FFmpegWASM?.FFmpeg;
      if (!Constructor) throw new AppError('ffmpegUnavailable');

      const ffmpeg = new Constructor();
      ffmpeg.on('log', ({ message }) => this.#handleLog(message));

      if (!this.#assetUrls) {
        const base = new URL(
          String(this.#config.assets?.ffmpegBase ?? 'vendor/ffmpeg').replace(/\/?$/, '/'),
          document.baseURI,
        );
        const core = new URL(this.#config.assets?.ffmpegCore ?? 'ffmpeg-core.js', base).href;
        const wasm = new URL(this.#config.assets?.ffmpegWasm ?? 'ffmpeg-core.wasm', base).href;
        this.#assetUrls = {
          coreURL: await toBlobURL(core, 'text/javascript'),
          wasmURL: await toBlobURL(wasm, 'application/wasm'),
        };
      }

      await ffmpeg.load(this.#assetUrls);
      this.#ffmpeg = ffmpeg;
      this.#setStatus('ready');
      return ffmpeg;
    })().catch((error) => {
      this.#loadPromise = null;
      this.#setStatus('error', error);
      if (error instanceof AppError) throw error;
      throw new AppError('ffmpegLoad', {}, error);
    });

    return this.#loadPromise;
  }

  /** @param {string} message */
  #handleLog(message) {
    const context = this.#run;
    if (!context) return;

    if (context.logs.length < MAX_LOGS) context.logs.push(message);

    const match = TIME_PATTERN.exec(message);
    if (!match || !context.duration) return;

    const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
    const ratio = Math.min(1, Math.max(0, seconds / context.duration));
    const now = performance.now();
    if (ratio - context.lastRatio < 0.003 && now - context.lastEmit < 120) return;
    context.lastRatio = ratio;
    context.lastEmit = now;
    context.onProgress?.(ratio);
  }

  /**
   * Run an ffmpeg command.
   * @param {string[]} args
   * @param {object} [options]
   * @param {number} [options.duration] media duration, used to compute progress
   * @param {(ratio: number) => void} [options.onProgress]
   * @param {(line: string) => void} [options.onLog]
   * @param {boolean} [options.allowFailure] do not throw on a non-zero exit code
   * @param {number} [options.timeout] milliseconds, -1 for none
   * @returns {Promise<{ code: number, logs: string[] }>}
   */
  async run(args, { duration = 0, onProgress, onLog, allowFailure = false, timeout = -1 } = {}) {
    const ffmpeg = await this.ensureLoaded();

    /** @type {typeof this.#run} */
    const context = { duration, logs: [], onProgress, onLog, lastRatio: -1, lastEmit: 0 };
    this.#run = context;

    let code;
    try {
      code = await ffmpeg.exec(args, timeout);
    } catch (error) {
      console.error('[Bulkut] ffmpeg execution error', error, context.logs.slice(-25).join('\n'));
      throw new AppError('renderFailed', {}, error);
    } finally {
      this.#run = null;
    }

    if (code !== 0 && !allowFailure) {
      console.error('[Bulkut] ffmpeg failed', context.logs.slice(-25).join('\n'));
      throw new AppError('renderFailed', { code });
    }

    return { code, logs: context.logs };
  }

  /**
   * @param {string} path
   * @param {Uint8Array|string} data
   */
  async writeFile(path, data) {
    const ffmpeg = await this.ensureLoaded();
    await ffmpeg.writeFile(path, data);
  }

  /** @param {string} path @returns {Promise<Uint8Array>} */
  async readFile(path) {
    if (!this.#ffmpeg) throw new AppError('ffmpegLoad');
    return this.#ffmpeg.readFile(path);
  }

  /** @param {string} path */
  async deleteFile(path) {
    if (!this.#ffmpeg) return;
    try {
      await this.#ffmpeg.deleteFile(path);
    } catch {
      /* The file may already be gone. */
    }
  }
}

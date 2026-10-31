/**
 * ffmpeg.wasm loader + command runner.
 *
 * Uses the single-threaded `@ffmpeg/core` build (no SharedArrayBuffer, no
 * COOP/COEP headers), so it also works on GitHub Pages.
 * @module core/ffmpeg-service
 */

import { AppError } from './app-error.js';
import { estimateEtaSeconds, parseStatsLine, smoothValue } from './ffmpeg-stats.js';

const MAX_LOGS = 5000;
/** Minimum movement (0–1) before another DOM update, unless the ETA ticks. */
const PROGRESS_STEP = 0.002;
const PROGRESS_INTERVAL = 250;

/**
 * A job token lets the caller abort between two FFmpeg operations, before the
 * engine had to be touched again.
 * @param {{ cancelled?: boolean } | undefined} token
 */
function assertActive(token) {
  if (token?.cancelled) throw new AppError('cancelled');
}

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
  /** @type {null | { duration: number, logs: string[], onProgress?: (ratio: number, stats: object) => void, lastRatio: number, lastEmit: number, startedAt: number, speed: number, etaSeconds: number, cancelled: boolean }} */
  #run = null;
  /** @type {{ coreURL: string, wasmURL: string } | null} */
  #assetUrls = null;
  /** Bumped by {@link cancel}; a load or command from an older epoch is discarded. */
  #epoch = 0;

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

  /**
   * @param {{ cancelled?: boolean }} [token]
   * @returns {Promise<import('@ffmpeg/ffmpeg').FFmpeg>}
   */
  async ensureLoaded(token) {
    assertActive(token);
    if (this.#ffmpeg) return this.#ffmpeg;
    if (this.#loadPromise) {
      const instance = await this.#loadPromise;
      assertActive(token);
      return instance;
    }

    const epoch = this.#epoch;
    this.#setStatus('loading');
    const load = (async () => {
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

      if (epoch !== this.#epoch) {
        try {
          ffmpeg.terminate();
        } catch {
          /* Already gone. */
        }
        throw new AppError('cancelled');
      }

      this.#ffmpeg = ffmpeg;
      this.#setStatus('ready');
      return ffmpeg;
    })();

    const tracked = load.catch((error) => {
      if (this.#loadPromise === tracked) this.#loadPromise = null;
      if (epoch !== this.#epoch) {
        if (error instanceof AppError) throw error;
        throw new AppError('cancelled');
      }
      this.#setStatus('error', error);
      if (error instanceof AppError) throw error;
      throw new AppError('ffmpegLoad', {}, error);
    });

    this.#loadPromise = tracked;
    const instance = await tracked;
    assertActive(token);
    return instance;
  }

  /** @param {string} message */
  #handleLog(message) {
    const context = this.#run;
    if (!context) return;

    if (context.logs.length < MAX_LOGS) context.logs.push(message);

    const stats = parseStatsLine(message);
    if (!stats) return;

    context.speed = smoothValue(context.speed, stats.speed);
    if (!context.duration) return;

    // `time=` is monotonic in practice, but clamping keeps the bar from
    // stepping back after a duplicated or slightly out-of-order line.
    const ratio = Math.min(1, Math.max(context.lastRatio, stats.seconds / context.duration));
    const now = performance.now();
    const eta = estimateEtaSeconds({
      mediaSeconds: stats.seconds,
      duration: context.duration,
      ratio,
      speed: context.speed,
      elapsedMs: now - context.startedAt,
    });

    const moved = ratio - context.lastRatio >= PROGRESS_STEP;
    if (!moved && now - context.lastEmit < PROGRESS_INTERVAL) return;

    context.lastRatio = ratio;
    context.lastEmit = now;
    context.etaSeconds = eta;
    context.onProgress?.(ratio, {
      seconds: stats.seconds,
      speed: context.speed,
      fps: stats.fps,
      frame: stats.frame,
      etaSeconds: eta,
    });
  }

  /**
   * Run an ffmpeg command.
   * @param {string[]} args
   * @param {object} [options]
   * @param {number} [options.duration] output duration, used to compute progress
   * @param {(ratio: number, stats: { seconds: number, speed: number, fps: number, frame: number, etaSeconds: number }) => void} [options.onProgress]
   * @param {(line: string) => void} [options.onLog]
   * @param {boolean} [options.allowFailure] do not throw on a non-zero exit code
   * @param {number} [options.timeout] milliseconds, -1 for none
   * @returns {Promise<{ code: number, logs: string[] }>}
   */
  async run(args, { duration = 0, onProgress, onLog, allowFailure = false, timeout = -1, token } = {}) {
    assertActive(token);
    const epoch = this.#epoch;
    const ffmpeg = await this.ensureLoaded(token);
    assertActive(token);
    if (epoch !== this.#epoch) throw new AppError('cancelled');

    /** @type {typeof this.#run} */
    const context = {
      duration,
      logs: [],
      onProgress,
      onLog,
      lastRatio: 0,
      lastEmit: 0,
      startedAt: performance.now(),
      speed: 0,
      etaSeconds: 0,
      cancelled: false,
    };
    this.#run = context;

    let code;
    try {
      code = await ffmpeg.exec(args, timeout);
    } catch (error) {
      if (context.cancelled || epoch !== this.#epoch) throw new AppError('cancelled');
      console.error('[Bulkut] ffmpeg execution error', error, context.logs.slice(-25).join('\n'));
      throw new AppError('renderFailed', {}, error);
    } finally {
      if (this.#run === context) this.#run = null;
    }

    if (epoch !== this.#epoch) throw new AppError('cancelled');

    if (code !== 0 && !allowFailure) {
      console.error('[Bulkut] ffmpeg failed', context.logs.slice(-25).join('\n'));
      throw new AppError('renderFailed', { code });
    }

    return { code, logs: context.logs };
  }

  /**
   * Kill the current render (and its worker) or abandon a load in progress.
   * FFmpeg.wasm has no cooperative cancel, so the next job reloads the core.
   */
  async cancel() {
    this.#epoch += 1;

    if (this.#run) this.#run.cancelled = true;

    const instance = this.#ffmpeg;
    this.#ffmpeg = null;

    if (instance) {
      // A later `ensureLoaded()` must not resolve with this terminated instance.
      this.#loadPromise = null;
      try {
        instance.terminate();
      } catch {
        /* Already terminated. */
      }
    }
    // If a load is in flight it notices the new epoch, terminates the instance
    // it produced and clears `#loadPromise` itself. Starting a second load here
    // would briefly run two wasm cores side by side.

    this.#setStatus('idle');
  }

  /**
   * @param {string} path
   * @param {Uint8Array|string} data
   */
  async writeFile(path, data, token) {
    assertActive(token);
    const epoch = this.#epoch;
    const ffmpeg = await this.ensureLoaded(token);
    assertActive(token);
    if (epoch !== this.#epoch) throw new AppError('cancelled');
    try {
      await ffmpeg.writeFile(path, data);
    } catch (error) {
      if (epoch !== this.#epoch) throw new AppError('cancelled');
      throw error;
    }
  }

  /** @param {string} path @returns {Promise<Uint8Array>} */
  async readFile(path, token) {
    assertActive(token);
    const epoch = this.#epoch;
    if (!this.#ffmpeg) throw new AppError('ffmpegLoad');
    try {
      return await this.#ffmpeg.readFile(path);
    } catch (error) {
      if (epoch !== this.#epoch) throw new AppError('cancelled');
      throw error;
    }
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

  /** @param {string} path */
  async createDir(path, token) {
    assertActive(token);
    const ffmpeg = await this.ensureLoaded(token);
    assertActive(token);
    await ffmpeg.createDir(path);
  }

  /**
   * Mount throw-away files read-only (WORKERFS reads them lazily from disk).
   * @param {File[]} files
   * @param {string} mountPoint
   */
  async mountWorkerFS(files, mountPoint, token) {
    assertActive(token);
    const ffmpeg = await this.ensureLoaded(token);
    assertActive(token);
    await ffmpeg.mount('WORKERFS', { files }, mountPoint);
  }

  /** @param {string} mountPoint */
  async unmount(mountPoint) {
    if (!this.#ffmpeg) return;
    try {
      await this.#ffmpeg.unmount(mountPoint);
    } catch {
      /* The engine was terminated. */
    }
  }

  /** @param {string} path */
  async deleteDir(path) {
    if (!this.#ffmpeg) return;
    try {
      await this.#ffmpeg.deleteDir(path);
    } catch {
      /* The engine was terminated or the directory is not empty. */
    }
  }
}

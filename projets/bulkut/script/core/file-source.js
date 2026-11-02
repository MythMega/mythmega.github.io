/**
 * File sources: how a video is handed to FFmpeg.
 *
 * - `memory`: the `File` is kept in memory and copied into FFmpeg's MEMFS for
 *   every job (the classic path, used by `index.html`).
 * - `opfs`: the `File` is streamed into the Origin Private File System and
 *   mounted read-only inside FFmpeg with WORKERFS, so the input never has to
 *   fit in the JS heap or in MEMFS (used by `pro.html`).
 *
 * Both sources expose the same interface so the processors do not care where
 * the bytes come from.
 * @module core/file-source
 */

import { AppError } from './app-error.js';
import { extensionOf } from './media.js';

const OPFS_DIRECTORY = 'bulkut-pro-files';
const COPY_CHUNK = 16 * 1024 * 1024;

let counter = 0;

/** @returns {string} */
function uniqueId() {
  counter += 1;
  return `${Date.now().toString(36)}-${counter.toString(36)}`;
}

/** @param {{ cancelled?: boolean } | undefined} token */
function assertActive(token) {
  if (token?.cancelled) throw new AppError('cancelled');
}

/** @returns {boolean} */
export function isOpfsSupported() {
  return Boolean(
    typeof navigator !== 'undefined' &&
      navigator.storage &&
      typeof navigator.storage.getDirectory === 'function' &&
      typeof FileSystemFileHandle !== 'undefined',
  );
}

/**
 * @typedef {object} FileSource
 * @property {'memory'|'opfs'} kind
 * @property {string} name original file name
 * @property {number} size
 * @property {string} type
 * @property {() => Promise<File>} getFile a readable file for metadata probing
 * @property {(ffmpeg: import('./ffmpeg-service.js').FFmpegService, token?: { cancelled?: boolean }) => Promise<{ path: string, cleanup: () => Promise<void> }>} attach
 * @property {() => Promise<void>} remove release the stored bytes
 */

/**
 * @param {File} file
 * @returns {FileSource}
 */
export function createMemorySource(file) {
  return {
    kind: 'memory',
    name: file.name,
    size: file.size,
    type: file.type,
    async getFile() {
      return file;
    },
    async attach(ffmpeg, token) {
      assertActive(token);
      const data = new Uint8Array(await file.arrayBuffer());
      assertActive(token);

      const path = `bulkut-in-${uniqueId()}.${extensionOf(file.name)}`;
      await ffmpeg.writeFile(path, data, token);
      return {
        path,
        cleanup: async () => {
          await ffmpeg.deleteFile(path);
        },
      };
    },
    async remove() {
      /* The File is released with the item. */
    },
  };
}

/**
 * Copy a file into OPFS, in chunks, and expose it as a mountable source.
 * @param {File} file
 * @param {{ onProgress?: (ratio: number) => void }} [options]
 * @returns {Promise<FileSource>}
 */
export async function createOpfsSource(file, { onProgress } = {}) {
  if (!isOpfsSupported()) throw new AppError('opfsUnavailable');

  let directory;
  let handle;
  const storedName = `${uniqueId()}.${extensionOf(file.name)}`;

  try {
    const root = await navigator.storage.getDirectory();
    directory = await root.getDirectoryHandle(OPFS_DIRECTORY, { create: true });
    handle = await directory.getFileHandle(storedName, { create: true });

    const writable = await handle.createWritable();
    try {
      const reader = file.stream().getReader();
      let written = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        await writable.write(value);
        written += value.byteLength;
        onProgress?.(file.size ? Math.min(1, written / file.size) : 1);
      }
      await writable.close();
    } catch (error) {
      try {
        await writable.abort();
      } catch {
        /* The stream may already be closed. */
      }
      throw error;
    }
  } catch (error) {
    if (directory) await directory.removeEntry(storedName).catch(() => {});
    if (error instanceof AppError) throw error;
    throw new AppError('opfsImport', { name: file.name }, error);
  }

  onProgress?.(1);

  return {
    kind: 'opfs',
    name: file.name,
    size: file.size,
    type: file.type,
    async getFile() {
      return handle.getFile();
    },
    async attach(ffmpeg, token) {
      assertActive(token);
      await ffmpeg.ensureLoaded(token);
      assertActive(token);

      const mountPoint = `/bulkut-src-${uniqueId()}`;
      const stored = await handle.getFile();
      assertActive(token);

      await ffmpeg.createDir(mountPoint, token);
      try {
        await ffmpeg.mountWorkerFS([stored], mountPoint, token);
      } catch (error) {
        await ffmpeg.deleteDir(mountPoint);
        if (token?.cancelled) throw new AppError('cancelled');
        throw new AppError('opfsMount', { name: file.name }, error);
      }

      if (token?.cancelled) {
        await ffmpeg.unmount(mountPoint);
        await ffmpeg.deleteDir(mountPoint);
        throw new AppError('cancelled');
      }

      return {
        path: `${mountPoint}/${stored.name}`,
        cleanup: async () => {
          await ffmpeg.unmount(mountPoint);
          await ffmpeg.deleteDir(mountPoint);
        },
      };
    },
    async remove() {
      try {
        await directory.removeEntry(storedName);
      } catch {
        /* Already gone. */
      }
    },
  };
}

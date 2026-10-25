/**
 * Shared helpers for importing a video file into the app.
 * @module features/shared/video-file
 */

import { extensionOf, formatBytes, isVideoFile } from '../../core/media.js';
import { probeMedia } from '../../core/media-probe.js';

/**
 * @param {File} file
 * @param {{ i18n: import('../../core/i18n.js').I18n, processing: Record<string, any> }} options
 * @returns {string|null} translated error message, or null when valid
 */
export function validateVideoFile(file, { i18n, processing }) {
  if (!isVideoFile(file)) {
    return i18n.t('errors.notVideo', { name: file.name });
  }
  const limit = processing.maxFileSizeMb * 1024 * 1024;
  if (file.size > limit) {
    return i18n.t('errors.fileTooLarge', {
      name: file.name,
      size: formatBytes(file.size),
      limit: `${processing.maxFileSizeMb} MB`,
    });
  }
  return null;
}

/**
 * Probe a file through FFmpeg when the browser cannot read its metadata
 * (mkv for instance). Writes a temporary copy inside the wasm filesystem.
 * @param {import('../../core/ffmpeg-service.js').FFmpegService} ffmpeg
 * @param {File} file
 * @returns {Promise<{ duration: number, hasAudio: boolean, hasVideo: boolean }>}
 */
export async function probeDurationWithFFmpeg(ffmpeg, file) {
  const path = `bulkut-probe-${Date.now().toString(36)}.${extensionOf(file.name)}`;
  try {
    await ffmpeg.writeFile(path, new Uint8Array(await file.arrayBuffer()));
    return await probeMedia(ffmpeg, path);
  } catch (error) {
    console.warn('[Bulkut] Could not probe the file.', error);
    return { duration: 0, hasAudio: false, hasVideo: false };
  } finally {
    await ffmpeg.deleteFile(path);
  }
}

/**
 * Shared helpers for importing a video file into the app.
 * @module features/shared/video-file
 */

import { formatBytes, isVideoFile } from '../../core/media.js';
import { probeMedia } from '../../core/media-probe.js';

/**
 * @param {File} file
 * @param {{ i18n: import('../../core/i18n.js').I18n, processing: Record<string, any>, skipSizeLimit?: boolean }} options
 * @returns {string|null} translated error message, or null when valid
 */
export function validateVideoFile(file, { i18n, processing, skipSizeLimit = false }) {
  if (!isVideoFile(file)) {
    return i18n.t('errors.notVideo', { name: file.name });
  }
  if (skipSizeLimit) return null;

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
 * (mkv for instance). The source is attached (and released) for the probe.
 * @param {import('../../core/ffmpeg-service.js').FFmpegService} ffmpeg
 * @param {import('../../core/file-source.js').FileSource} source
 * @returns {Promise<{ duration: number, hasAudio: boolean, hasVideo: boolean }>}
 */
export async function probeDurationWithFFmpeg(ffmpeg, source) {
  if (!source) return { duration: 0, hasAudio: false, hasVideo: false };

  try {
    await ffmpeg.ensureLoaded();
    const attached = await source.attach(ffmpeg);
    try {
      return await probeMedia(ffmpeg, attached.path);
    } finally {
      await attached.cleanup();
    }
  } catch (error) {
    console.warn('[Bulkut] Could not probe the file.', error);
    return { duration: 0, hasAudio: false, hasVideo: false };
  }
}

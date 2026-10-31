/**
 * Shared import pipeline for the list-based tabs: validate, store the source,
 * then read its duration (browser metadata first, FFmpeg as a fallback for
 * containers such as mkv).
 * @module features/shared/import-video
 */

import { probeVideoDuration } from '../../core/media.js';
import { probeDurationWithFFmpeg, validateVideoFile } from './video-file.js';

/**
 * @param {File} file
 * @param {import('../../main.js').AppContext} ctx
 * @param {{ onProgress?: (ratio: number) => void }} [options]
 * @returns {Promise<{ error: string } | { source: import('../../core/file-source.js').FileSource, duration: number }>}
 */
export async function importVideoFile(file, ctx, { onProgress } = {}) {
  const { i18n, ffmpeg, settings, isPro, createSource } = ctx;

  const error = validateVideoFile(file, {
    i18n,
    processing: settings.processing,
    skipSizeLimit: isPro,
  });
  if (error) return { error };

  const source = await createSource(file, { onProgress });

  try {
    let duration = await probeVideoDuration(await source.getFile());
    if (!duration) duration = (await probeDurationWithFFmpeg(ffmpeg, source)).duration;
    return { source, duration };
  } catch (error) {
    await source.remove();
    throw error;
  }
}

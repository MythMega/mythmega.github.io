/**
 * Browser-side media helpers (file naming, downloads, duration probing).
 * @module core/media
 */

import { formatNumber } from './timecode.js';

const VIDEO_EXTENSIONS = /\.(mp4|m4v|mov|webm|mkv|avi|ogv|ogg|mpg|mpeg|3gp|3g2|ts|mts|m2ts|flv|wmv)$/i;

/**
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB'];
  let size = value / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${formatNumber(size, size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

/**
 * Remove characters that break downloads or inject paths, then trim.
 * @param {string} value
 * @returns {string}
 */
export function sanitizeSuffix(value) {
  return String(value ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .slice(0, 40);
}

/**
 * @param {string} name
 * @returns {string}
 */
export function extensionOf(name) {
  const match = /\.([a-z0-9]{1,6})$/i.exec(String(name ?? ''));
  return match ? match[1].toLowerCase() : 'mp4';
}

/**
 * `clip.mp4` + `-autocut` -> `clip-autocut.mp4`
 * @param {string} originalName
 * @param {string} suffix
 * @param {string} [extension]
 * @returns {string}
 */
export function buildOutputName(originalName, suffix, extension = 'mp4') {
  const name = String(originalName ?? 'video');
  const base = name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim() || 'video';
  const cleanSuffix = sanitizeSuffix(suffix);
  return `${base}${cleanSuffix}.${extension}`;
}

/**
 * @param {File} file
 * @returns {boolean}
 */
export function isVideoFile(file) {
  if (!file) return false;
  if (typeof file.type === 'string' && file.type.startsWith('video/')) return true;
  return VIDEO_EXTENSIONS.test(file.name ?? '');
}

/**
 * Read the duration from a video element. Resolves to 0 when metadata is not
 * readable by the browser (the FFmpeg probe is used as a fallback).
 * @param {File|Blob} file
 * @returns {Promise<number>}
 */
export function probeVideoDuration(file) {
  return new Promise((resolve) => {
    let settled = false;
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;

    const finish = (duration) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(duration) && duration > 0 ? duration : 0);
    };

    const timer = window.setTimeout(() => finish(0), 15000);

    video.addEventListener('loadedmetadata', () => finish(video.duration), { once: true });
    video.addEventListener('error', () => finish(0), { once: true });
    video.src = url;
  });
}

/**
 * Trigger a browser download for a blob.
 * @param {Blob} blob
 * @param {string} filename
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

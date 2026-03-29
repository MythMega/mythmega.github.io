/**
 * Business: Logger
 * Centralized logging utility, controlled by DEV_MODE.
 */

import { DEV_MODE } from '../../admin/settings.js';

/**
 * Log a message to the console only in dev mode.
 * @param {string} context - The module/function emitting the log
 * @param {...any} args - Values to log
 */
export function log(context, ...args) {
  if (DEV_MODE) {
    console.log(`[DEV][${context}]`, ...args);
  }
}

/**
 * Log a warning.
 */
export function warn(context, ...args) {
  if (DEV_MODE) {
    console.warn(`[DEV][${context}]`, ...args);
  }
}

/**
 * Log an error (always, not just in dev mode).
 */
export function error(context, ...args) {
  console.error(`[ERROR][${context}]`, ...args);
}

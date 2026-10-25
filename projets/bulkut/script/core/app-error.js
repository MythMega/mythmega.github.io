/**
 * Application errors carry a translation key (`errors.<code>`) instead of a
 * hard-coded message, so the UI can render them in the active language.
 * @module core/app-error
 */

export class AppError extends Error {
  /**
   * @param {string} code translation key under `errors.`
   * @param {Record<string, unknown>} [vars]
   * @param {unknown} [cause]
   */
  constructor(code, vars = {}, cause) {
    super(code);
    this.name = 'AppError';
    this.code = code;
    this.vars = vars;
    this.cause = cause;
  }
}

/**
 * Turn any thrown value into a translated, user-facing message.
 * @param {unknown} error
 * @param {import('./i18n.js').I18n} i18n
 * @returns {string}
 */
export function describeError(error, i18n) {
  if (error instanceof AppError) {
    const key = `errors.${error.code}`;
    if (i18n.has(key)) return i18n.t(key, error.vars);
    console.error(`[Bulkut] Missing translation for ${key}`, error);
  } else {
    console.error('[Bulkut] Unexpected error', error);
  }
  const detail = error instanceof Error ? error.message : String(error ?? '');
  return detail
    ? `${i18n.t('errors.unknown')} (${detail})`
    : i18n.t('errors.unknown');
}

/**
 * Clipboard - Small cross-context text copy helper.
 *
 * `navigator.clipboard` requires a SECURE CONTEXT (HTTPS or localhost): the application is also
 * served over plain HTTP on a LAN, so a legacy `document.execCommand('copy')` fallback is used
 * there. Shared by the opening view (booster code) and the statistics view (past openings).
 */

/**
 * Writes a text in the clipboard.
 *
 * @param {string} text - Text to copy.
 * @returns {Promise<void>} Resolves once the text is in the clipboard.
 * @throws {TypeError} When the argument is not a string.
 * @throws {Error} When both clipboard strategies fail.
 */
export async function writeToClipboard(text) {
  if (typeof text !== 'string') {
    throw new TypeError(`Clipboard.writeToClipboard expects a string (received: ${typeof text}).`);
  }

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (error) {
      console.warn('[Clipboard] The clipboard API refused the write, trying the fallback.', error);
    }
  }

  if (typeof document === 'undefined') {
    throw new Error('The clipboard is not available outside a browser.');
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-1000px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = typeof document.execCommand === 'function' && document.execCommand('copy');
  textarea.remove();

  if (!copied) {
    throw new Error('The clipboard is not available in this browser context.');
  }
}

export default writeToClipboard;

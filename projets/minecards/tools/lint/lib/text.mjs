/**
 * text.mjs - Line helpers, and the masking that lets a rule read CODE instead of prose.
 *
 * A regular expression cannot tell `// a == b` from a real comparison: both are just characters.
 * Every rule that greps for a construct therefore works on a MASKED copy of the file, in which the
 * content of the comments, the strings and the regular expressions has been replaced by spaces —
 * the masking never touches the line endings, so a reported line number always points at the right
 * line of the original file.
 *
 * Known limitation, deliberate: the `${…}` expressions of a template literal are masked along with
 * the template itself. They hold an expression, not a statement, and no rule of this linter needs to
 * look inside one.
 */

/**
 * Splits a text into lines, whatever its line endings.
 *
 * @param {string} text - File content.
 * @returns {string[]} The lines, without their line ending.
 */
export function splitLines(text) {
  return text.split(/\r\n|\n|\r/);
}

/**
 * Converts a character offset into a 1-based line and column.
 *
 * @param {string} text - File content.
 * @param {number} offset - Character offset.
 * @returns {{line: number, column: number}} The position.
 */
export function positionAt(text, offset) {
  const clamped = Math.max(0, Math.min(offset, text.length));
  const before = text.slice(0, clamped);
  const line = before.split('\n').length;
  const column = clamped - (before.lastIndexOf('\n') + 1) + 1;
  return { line, column };
}

/**
 * Masks the comments, the strings and the regular expressions of a JavaScript source.
 *
 * The characters of a masked region become spaces; newlines are kept so the line numbering of the
 * result matches the original file character for character.
 *
 * A rule that looks for something INSIDE a string (an asset path, an import specifier) asks for
 * `strings: false`: the comments and the regular expressions stay masked, the strings do not.
 *
 * @param {string} source - JavaScript source.
 * @param {object} [options] - Masking options.
 * @param {boolean} [options.strings=true] - Mask the content of the strings.
 * @returns {string} A same-length copy: the code, the strings when they were kept, and nothing else.
 */
export function maskJavaScript(source, { strings = true } = {}) {
  const masked = source.split('');

  /**
   * Replaces a range by spaces, keeping the line endings.
   *
   * @param {number} from - First index to hide.
   * @param {number} to - Index after the last one to hide.
   * @returns {void}
   */
  const hide = (from, to) => {
    for (let cursor = from; cursor < to && cursor < masked.length; cursor += 1) {
      if (source[cursor] !== '\n' && source[cursor] !== '\r') masked[cursor] = ' ';
    }
  };

  scanJavaScript(source, {
    onComment: hide,
    onRegex: hide,
    onString: strings ? hide : null
  });

  return masked.join('');
}

/**
 * Lists the string literals of a JavaScript source, comments and regular expressions excluded.
 *
 * A rule concerned with the TEXT a player reads (a label, a message) must look at the strings and
 * nowhere else: this project writes long English comments, and an em dash in a comment hurts nobody.
 *
 * @param {string} source - JavaScript source.
 * @returns {Array<{raw: string, offset: number, quote: string}>} The literals, in source order; `raw`
 *   keeps the quotes, `offset` points at the opening one.
 */
export function listJavaScriptStrings(source) {
  const found = [];
  scanJavaScript(source, {
    onString: (from, to) => {
      found.push({ raw: source.slice(from, to), offset: from, quote: source[from] });
    }
  });
  return found;
}

/**
 * Walks a JavaScript source, calling back on every comment, string and regular expression.
 *
 * One single scanner serves the masking and the listing above, so the two can never disagree on
 * what a comment or a string is.
 *
 * @param {string} source - JavaScript source.
 * @param {object} handlers - Callbacks, all optional.
 * @param {(from: number, to: number) => void} [handlers.onComment] - A comment.
 * @param {(from: number, to: number) => void} [handlers.onString] - A quoted string or a template.
 * @param {(from: number, to: number) => void} [handlers.onRegex] - A regular expression literal.
 * @returns {void}
 */
function scanJavaScript(source, { onComment = null, onString = null, onRegex = null }) {
  let index = 0;
  let previousSignificant = '';

  while (index < source.length) {
    const char = source[index];

    if (char === '/' && source[index + 1] === '/') {
      const end = source.indexOf('\n', index);
      const stop = end === -1 ? source.length : end;
      if (onComment) onComment(index, stop);
      index = stop;
      continue;
    }
    if (char === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2);
      const stop = end === -1 ? source.length : end + 2;
      if (onComment) onComment(index, stop);
      index = stop;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      const stop = scanString(source, index);
      if (onString) onString(index, stop);
      previousSignificant = 'x';
      index = stop;
      continue;
    }
    if (char === '/' && canStartRegex(source, index, previousSignificant)) {
      const stop = scanRegex(source, index);
      if (onRegex) onRegex(index, stop);
      previousSignificant = 'x';
      index = stop;
      continue;
    }
    if (!/\s/.test(char)) previousSignificant = char;
    index += 1;
  }
}

/**
 * Masks the comments of a CSS stylesheet.
 *
 * @param {string} source - CSS source.
 * @returns {string} A same-length copy, without comment content.
 */
export function maskCss(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n\r]/g, ' '));
}

/**
 * Masks the comments of an HTML document.
 *
 * @param {string} source - HTML source.
 * @returns {string} A same-length copy, without comment content.
 */
export function maskHtml(source) {
  return source.replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n\r]/g, ' '));
}

/**
 * Scans a quoted string or a template literal from its opening quote.
 *
 * @param {string} source - Source being scanned.
 * @param {number} start - Index of the opening quote.
 * @returns {number} The index just after the closing quote (or the end of the source).
 */
function scanString(source, start) {
  const quote = source[start];
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === '\\') {
      index += 2;
      continue;
    }
    if (source[index] === quote) return index + 1;
    index += 1;
  }
  return source.length;
}

/**
 * Scans a regular expression literal from its opening slash.
 *
 * @param {string} source - Source being scanned.
 * @param {number} start - Index of the opening slash.
 * @returns {number} The index just after the flags (or the end of the source).
 */
function scanRegex(source, start) {
  let index = start + 1;
  let inClass = false;
  while (index < source.length) {
    const char = source[index];
    if (char === '\\') {
      index += 2;
      continue;
    }
    if (char === '\n') return index;
    if (char === '[') inClass = true;
    else if (char === ']') inClass = false;
    else if (char === '/' && !inClass) {
      index += 1;
      while (index < source.length && /[a-z]/i.test(source[index])) index += 1;
      return index;
    }
    index += 1;
  }
  return source.length;
}

/**
 * Tells whether the slash at an index opens a regular expression rather than a division.
 *
 * @param {string} source - Source being scanned.
 * @param {number} index - Index of the slash.
 * @param {string} previousSignificant - Last significant character before it.
 * @returns {boolean} True when a regular expression starts here.
 */
function canStartRegex(source, index, previousSignificant) {
  if (previousSignificant === '') return true;
  if (/[([{,;:!&|?=+\-*%<>^~]/.test(previousSignificant)) return true;
  const word = readWordBefore(source, index);
  return /^(return|typeof|instanceof|in|of|new|delete|void|case|do|else|yield|await)$/.test(word);
}

/**
 * Reads the identifier that ends just before an index.
 *
 * @param {string} source - Source being scanned.
 * @param {number} index - Index of the character after the identifier.
 * @returns {string} The identifier, or an empty string.
 */
function readWordBefore(source, index) {
  let start = index;
  while (start > 0 && /[\w$]/.test(source[start - 1])) start -= 1;
  return source.slice(start, index);
}

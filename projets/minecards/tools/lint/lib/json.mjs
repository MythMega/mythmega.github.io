/**
 * json.mjs - Strict JSON reading: syntax, and the repeated keys `JSON.parse` silently swallows.
 *
 * `JSON.parse` keeps the LAST of two identical keys without a word, which is exactly how a trophy
 * tier, a translation or a price quietly disappears from the game. The scanner below only walks the
 * structure (braces, brackets, strings and the colons that follow a property name) and never builds
 * a value of its own: `JSON.parse` still does the parsing, this file only reports what it hides.
 */

/**
 * Parses a JSON document and lists its repeated keys.
 *
 * @param {string} text - Raw content of a `.json` file.
 * @returns {{value: unknown, duplicates: Array<{key: string, line: number, column: number}>}} The
 *   parsed value and every key declared twice in the same object, in source order.
 * @throws {Error} When the document is not valid JSON (message carries the line and the column).
 */
export function parseJsonStrict(text) {
  const duplicates = scanDuplicates(text);

  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    const position = readErrorPosition(error, text);
    const failure = new Error(
      `${error.message}${position ? ` (line ${position.line}, column ${position.column})` : ''}`
    );
    if (position) {
      failure.line = position.line;
      failure.column = position.column;
    }
    throw failure;
  }

  return { value, duplicates };
}

/**
 * Walks the document and reports the property names declared twice in the same object.
 *
 * @param {string} text - Raw content of a `.json` file.
 * @returns {Array<{key: string, line: number, column: number}>} The repeated keys, in source order.
 */
function scanDuplicates(text) {
  const duplicates = [];
  /** @type {Set<string>[]} Keys already seen, one set per open object. */
  const scopes = [];
  let index = 0;
  let line = 1;
  let column = 1;

  /**
   * Advances the cursor by one character, keeping the position up to date.
   *
   * @param {number} count - Number of characters to consume.
   * @returns {void}
   */
  const advance = (count) => {
    for (let step = 0; step < count; step += 1) {
      if (text[index] === '\n') {
        line += 1;
        column = 1;
      } else {
        column += 1;
      }
      index += 1;
    }
  };

  while (index < text.length) {
    const char = text[index];

    if (char === '{') {
      scopes.push(new Set());
      advance(1);
      continue;
    }
    if (char === '}') {
      scopes.pop();
      advance(1);
      continue;
    }
    if (char === '"') {
      // A string is a property name when the next significant character is a colon.
      const startLine = line;
      const startColumn = column;
      const raw = readString(text, index);
      advance(raw.length);
      let lookahead = index;
      while (lookahead < text.length && /\s/.test(text[lookahead])) lookahead += 1;
      if (text[lookahead] === ':' && scopes.length > 0) {
        let name;
        try {
          name = JSON.parse(raw);
        } catch {
          name = raw.slice(1, -1);
        }
        const scope = scopes[scopes.length - 1];
        if (scope.has(name)) duplicates.push({ key: name, line: startLine, column: startColumn });
        else scope.add(name);
      }
      continue;
    }
    advance(1);
  }

  return duplicates;
}

/**
 * Reads a JSON string literal from its opening quote.
 *
 * @param {string} text - Whole document.
 * @param {number} start - Index of the opening quote.
 * @returns {string} The literal, quotes included, escapes left untouched.
 */
function readString(text, start) {
  let index = start + 1;
  while (index < text.length) {
    if (text[index] === '\\') {
      index += 2;
      continue;
    }
    if (text[index] === '"') return text.slice(start, index + 1);
    index += 1;
  }
  return text.slice(start);
}

/**
 * Converts the character offset an engine error carries into a line and a column.
 *
 * Node spells the offset differently from browser engines, hence the two shapes handled here; a
 * message without any offset simply gets no position.
 *
 * @param {Error} error - The error thrown by `JSON.parse`.
 * @param {string} text - Whole document.
 * @returns {{line: number, column: number}|null} The position, or null when the error carries none.
 */
function readErrorPosition(error, text) {
  const match = /position (\d+)/.exec(String(error.message));
  if (!match) return null;
  const offset = Math.min(Number(match[1]), text.length);
  const before = text.slice(0, offset);
  const line = before.split('\n').length;
  const column = offset - (before.lastIndexOf('\n') + 1) + 1;
  return { line, column };
}

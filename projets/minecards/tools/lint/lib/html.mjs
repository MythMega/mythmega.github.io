/**
 * html.mjs - The tag scanner, and the one question the linter asks of a page: is it nested?
 *
 * WHY IT EXISTS
 * A browser never refuses a page with an unclosed element: it closes it for you, at the next end
 * tag that does not match, and the screen simply comes out empty. That is exactly what happened to
 * the settings tabs - `#settings-panel-account` had lost its `</div>`, so the four panels that
 * follow (Gift, Premium, Notes de mise a jour, Rapport d'erreurs) became its CHILDREN, inherited
 * its `display: none` whenever another tab was active, and rendered as 0x0 boxes with all their
 * text inside. Nothing in a browser console says a word about it, and a tag COUNT is balanced too:
 * the `</div>` meant for the outer panel simply closes the inner one.
 *
 * The scan below therefore walks the document as a parser would, and a finding points at the line
 * of the OPENING tag, which is where the missing `</div>` belongs.
 */

import { positionAt } from './text.mjs';

/** Elements that never have a closing tag. */
const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/** Elements whose content is text, never markup: the scan skips straight to their end tag. */
const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'textarea', 'title']);

/** Elements a page is allowed to end by simply ending: `</html>` and `</body>` are optional. */
const OPTIONAL_AT_EOF = new Set(['html', 'head', 'body']);

/** Block-level start tags that close an open `<p>`. */
const PARAGRAPH_CLOSERS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'details',
  'div',
  'dl',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'main',
  'menu',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'ul',
]);

/**
 * The optional end tags of HTML, as `element -> start tags that close it`.
 *
 * `IMPLIED_END.get(open).has(start)` means "this start tag ends the element `open`". An element
 * listed here may legally omit its end tag, so its absence is neither an implied error nor a
 * finding at the end of the page; anything else must be balanced, in order.
 */
const IMPLIED_END = new Map([
  ['li', new Set(['li'])],
  ['dt', new Set(['dt', 'dd'])],
  ['dd', new Set(['dt', 'dd'])],
  ['p', PARAGRAPH_CLOSERS],
  ['option', new Set(['option', 'optgroup'])],
  ['optgroup', new Set(['optgroup'])],
  ['rt', new Set(['rt', 'rp'])],
  ['rp', new Set(['rt', 'rp'])],
  ['caption', new Set(['colgroup', 'thead', 'tbody', 'tfoot', 'tr'])],
  ['colgroup', new Set(['thead', 'tbody', 'tfoot', 'tr'])],
  ['thead', new Set(['tbody', 'tfoot'])],
  ['tbody', new Set(['tbody', 'tfoot'])],
  ['tfoot', new Set(['tbody'])],
  ['tr', new Set(['tr', 'thead', 'tbody', 'tfoot'])],
  ['td', new Set(['td', 'th', 'tr', 'thead', 'tbody', 'tfoot'])],
  ['th', new Set(['td', 'th', 'tr', 'thead', 'tbody', 'tfoot'])],
]);

/**
 * Tells whether an element may omit its end tag.
 *
 * @param {string} name - Lowercase element name.
 * @returns {boolean} True when a missing `</name>` is legal.
 */
function hasOptionalEnd(name) {
  return OPTIONAL_AT_EOF.has(name) || IMPLIED_END.has(name);
}

/**
 * Reads the index of the `>` that ends a tag, honouring the quoted attribute values.
 *
 * @param {string} text - HTML source.
 * @param {number} from - Index of the `<` opening the tag.
 * @returns {number} Index of the closing `>`, or -1 when the tag is cut by the end of the file.
 */
function readTagEnd(text, from) {
  let quote = '';
  for (let index = from + 1; index < text.length; index += 1) {
    const char = text[index];
    if (quote !== '') {
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '>') return index;
  }
  return -1;
}

/**
 * Lists the tags of a page, in source order.
 *
 * The comments, the doctype, the processing instructions and the content of the raw text elements
 * are skipped: a `for (i = 0; i < n; i++)` in an inline script would otherwise look like a `<n>` tag.
 *
 * @param {string} text - HTML source.
 * @returns {Array<{type: 'start'|'end', name: string, index: number, selfClosing: boolean,
 *   raw: string}>} The tags, each with the offset of its `<`.
 */
function scanHtmlTags(text) {
  const tokens = [];
  let index = 0;

  while (index < text.length) {
    const open = text.indexOf('<', index);
    if (open === -1) break;

    if (text.startsWith('<!--', open)) {
      const end = text.indexOf('-->', open + 4);
      index = end === -1 ? text.length : end + 3;
      continue;
    }

    const next = text[open + 1] ?? '';
    if (next === '!' || next === '?') {
      const end = readTagEnd(text, open);
      index = end === -1 ? text.length : end + 1;
      continue;
    }

    const isEnd = next === '/';
    const nameStart = isEnd ? open + 2 : open + 1;
    if (!/[a-zA-Z]/.test(text[nameStart] ?? '')) {
      // A `<` that starts nothing (`a < b` in prose): it is text, not a tag.
      index = open + 1;
      continue;
    }

    let nameEnd = nameStart;
    while (nameEnd < text.length && /[a-zA-Z0-9:_.-]/.test(text[nameEnd])) nameEnd += 1;
    const name = text.slice(nameStart, nameEnd).toLowerCase();

    const end = readTagEnd(text, open);
    const truncated = end === -1;
    const raw = truncated ? text.slice(open) : text.slice(open, end + 1);
    index = truncated ? text.length : end + 1;

    if (isEnd) {
      tokens.push({ type: 'end', name, index: open, selfClosing: false, raw });
      continue;
    }

    const selfClosing = /\/\s*>$/.test(raw);
    tokens.push({ type: 'start', name, index: open, selfClosing, raw });
    if (selfClosing || !RAW_TEXT_ELEMENTS.has(name)) continue;

    const close = new RegExp(`</${name}\\s*>`, 'i').exec(text.slice(index));
    if (!close) continue;
    tokens.push({
      type: 'end',
      name,
      index: index + close.index,
      selfClosing: false,
      raw: close[0],
    });
    index += close.index + close[0].length;
  }

  return tokens;
}

/**
 * Shortens a start tag for a message: its name, its `class` or `id`, and nothing else.
 *
 * The reading `unclosed <div class="settings__tabpanel">` names the element the author has to find;
 * the whole five-line tag with eighteen attributes would bury it.
 *
 * @param {string} raw - The start tag, as written.
 * @returns {string} A one-line description.
 */
function describeTag(raw) {
  const name = /^<([a-zA-Z][\w:-]*)/.exec(raw)?.[1] ?? '?';
  const attribute = /\s(id|class)="([^"]*)"/.exec(raw);
  return attribute ? `<${name} ${attribute[1]}="${attribute[2]}">` : `<${name}>`;
}

/**
 * Finds the elements a page opens and never closes in order.
 *
 * @param {string} text - HTML source.
 * @returns {Array<{line: number, column: number, message: string}>} One finding per element, at the
 *   line of its opening tag (where the closing tag belongs).
 */
export function findHtmlNestingIssues(text) {
  /** @type {Array<{line: number, column: number, message: string}>} */
  const findings = [];
  /** @type {Array<{name: string, index: number, label: string}>} */
  const stack = [];

  /**
   * Records a finding at a character offset.
   *
   * @param {number} offset - Offset to point at.
   * @param {string} message - What is wrong.
   * @returns {void}
   */
  const report = (offset, message) => {
    const { line, column } = positionAt(text, offset);
    findings.push({ line, column, message });
  };

  scanHtmlTags(text).forEach((token) => {
    if (token.type === 'start') {
      if (VOID_ELEMENTS.has(token.name) || token.selfClosing) return;
      // The start tag that follows closes what HTML says it closes (`<li>`, `<td>`, `<p>`...).
      while (stack.length > 0) {
        const top = stack[stack.length - 1];
        const closers = IMPLIED_END.get(top.name);
        if (!closers || !closers.has(token.name)) break;
        stack.pop();
      }
      stack.push({ name: token.name, index: token.index, label: describeTag(token.raw) });
      return;
    }

    let depth = -1;
    for (let cursor = stack.length - 1; cursor >= 0; cursor -= 1) {
      if (stack[cursor].name === token.name) {
        depth = cursor;
        break;
      }
    }

    if (depth === -1) {
      // A stray closing tag is a real defect too, unless HTML lets the element be absent altogether.
      if (!hasOptionalEnd(token.name)) {
        report(token.index, `</${token.name}> closes nothing: no <${token.name}> is open`);
      }
      return;
    }

    // Everything opened above the matched element is closed by this end tag, implicitly: it is the
    // signature of a missing closing tag higher up.
    for (let cursor = stack.length - 1; cursor > depth; cursor -= 1) {
      const entry = stack[cursor];
      if (hasOptionalEnd(entry.name)) continue;
      report(
        entry.index,
        `${entry.label} is never closed: </${token.name}> on line ` +
          `${positionAt(text, token.index).line} finds it still open (a closing tag is missing ` +
          'between the two)'
      );
    }
    stack.length = depth;
  });

  stack.forEach((entry) => {
    if (hasOptionalEnd(entry.name)) return;
    report(entry.index, `${entry.label} is never closed: no </${entry.name}> before the end of the page`);
  });

  return findings;
}

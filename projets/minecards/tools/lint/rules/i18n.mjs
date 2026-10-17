/**
 * i18n.mjs - The rules of the dictionaries (`settings/i18n/<lang>.json`) and of the keys they serve.
 *
 * Two languages that drift apart are invisible until a player switches language and reads a raw key
 * name: a missing translation, a placeholder present on one side only, or a trophy whose composed
 * key (`trophy.global.<counter>.title`) was never written all produce the same broken screen. These
 * rules compare the dictionaries with each other, then with the code that reads them, then with the
 * settings files that GENERATE key names.
 */

import { listJavaScriptStrings, maskHtml, positionAt } from '../lib/text.mjs';

/** Files never checked for typography: the internal documentation and the linter itself. */
const TYPOGRAPHY_EXEMPT_PREFIXES = ['.docs/', 'tools/', 'robots.txt', 'sitemap.xml'];


/**
 * Extensions holding text a player can read.
 *
 * `robots.txt`, `sitemap.xml` and the launch scripts are searched engines' and developers' material,
 * never displayed by the game; the stylesheets and the comments of the code are addressed by every
 * other rule of this file, and an em dash there hurts nobody.
 */
const TEXT_EXTENSIONS = ['.json', '.js', '.html', '.webmanifest'];

/** Attributes whose value a player can read, in the pages. */
const VISIBLE_ATTRIBUTES = ['title', 'aria-label', 'alt', 'placeholder', 'content'];

/** The character the rule refuses: the em dash, never used in the project's copy. */
const EM_DASH = '\u2014';

/**
 * Lists the languages declared by `settings/config.json`.
 *
 * @param {object} context - Rule context.
 * @returns {string[]} The language codes (e.g. `['fr', 'en']`).
 */
function listLanguages(context) {
  const config = context.readJsonValue('settings/config.json');
  const declared = Array.isArray(config.languages) ? config.languages : [];
  const codes = declared
    .map((entry) => (entry && typeof entry.code === 'string' ? entry.code.trim() : ''))
    .filter((code) => code !== '');
  return codes.length > 0 ? codes : ['fr', 'en'];
}

/**
 * Reads every dictionary of the project.
 *
 * @param {object} context - Rule context.
 * @returns {Array<{code: string, file: string, entries: Record<string, string>}>} The dictionaries.
 * @throws {Error} When a dictionary cannot be read: the run stops, since every other i18n rule
 *   depends on them.
 */
function loadDictionaries(context) {
  return listLanguages(context).map((code) => {
    const file = `settings/i18n/${code}.json`;
    const entries = context.readJsonValue(file);
    return { code, file, entries: entries && typeof entries === 'object' ? entries : {} };
  });
}

/**
 * Lists the `{placeholder}` names of a translation.
 *
 * @param {unknown} value - Translation value.
 * @returns {string[]} The placeholder names, sorted and de-duplicated.
 */
function placeholders(value) {
  if (typeof value !== 'string') return [];
  return [...new Set([...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]))].sort();
}

/**
 * Finds the line of a key in the raw text of a dictionary.
 *
 * @param {string} text - Raw content of the dictionary.
 * @param {string} key - Translation key.
 * @returns {number} The 1-based line (1 when the key cannot be located, which cannot happen for a
 *   key that was just read from the parsed object).
 */
function lineOfKey(text, key) {
  const needle = `"${key}"`;
  const index = text.indexOf(needle);
  if (index === -1) return 1;
  return text.slice(0, index).split('\n').length;
}

/**
 * Mirrors `slugify()` of `js/business/TrophyManager.js`.
 *
 * The trophy keys are built from the COUNTER NAME of `settings/global_trophy.json`
 * (`trophy.global.<slug>.title`), so the linter has to compose the very same slug. If that function
 * ever changes, this one must change with it; the `i18n/trophy-keys` rule is what makes the
 * divergence visible.
 *
 * @param {string} value - Raw label (`minepickTotalPicks`).
 * @returns {string} The slug (`minepicktotalpicks`).
 */
function slugify(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** @type {object[]} The rules of this module, in report order. */
export default [
  {
    id: 'i18n/parity',
    summary: 'Every language declares exactly the same keys.',
    severity: 'error',
    /**
     * @param {object} context - Rule context.
     * @returns {void}
     */
    run(context) {
      const dictionaries = loadDictionaries(context);
      const [reference, ...others] = dictionaries;
      if (!reference) return;

      others.forEach((dictionary) => {
        const text = context.readText(dictionary.file);
        Object.keys(reference.entries)
          .filter((key) => !Object.prototype.hasOwnProperty.call(dictionary.entries, key))
          .forEach((key) => {
            context.report({
              file: dictionary.file,
              line: text.split('\n').length,
              column: 1,
              message: `key "${key}" is missing (declared by "${reference.code}")`
            });
          });
        Object.keys(dictionary.entries)
          .filter((key) => !Object.prototype.hasOwnProperty.call(reference.entries, key))
          .forEach((key) => {
            context.report({
              file: dictionary.file,
              line: lineOfKey(text, key),
              column: 1,
              message: `key "${key}" is unknown (absent from "${reference.code}")`
            });
          });
      });
    }
  },
  {
    id: 'i18n/placeholders',
    summary: 'A translation keeps the placeholders of the other languages.',
    severity: 'error',
    /**
     * @param {object} context - Rule context.
     * @returns {void}
     */
    run(context) {
      const dictionaries = loadDictionaries(context);
      const [reference, ...others] = dictionaries;
      if (!reference) return;

      others.forEach((dictionary) => {
        const text = context.readText(dictionary.file);
        Object.entries(reference.entries).forEach(([key, value]) => {
          const translated = dictionary.entries[key];
          if (typeof translated !== 'string') return;
          const expected = placeholders(value).join(',');
          const found = placeholders(translated).join(',');
          if (expected === found) return;
          context.report({
            file: dictionary.file,
            line: lineOfKey(text, key),
            column: 1,
            message:
              `"${key}" interpolates {${found || 'nothing'}} where "${reference.code}" interpolates ` +
              `{${expected || 'nothing'}}`
          });
        });
      });
    }
  },
  {
    id: 'i18n/em-dash',
    summary: 'No em dash (U+2014) in anything a player can read.',
    severity: 'error',
    files: (file) => TEXT_EXTENSIONS.includes(file.slice(file.lastIndexOf('.'))),
    /**
     * Reports every em dash, at the line and the column it was found at.
     *
     * @param {object} context - Rule context.
     * @param {string} file - File being read.
     * @param {string} text - The fragment a player can read.
     * @returns {void}
     */
    checkFragment(context, file, text) {
      text.split(/\r?\n/).forEach((line, index) => {
        let column = line.indexOf(EM_DASH);
        while (column !== -1) {
          context.report({
            file,
            line: index + 1,
            column: column + 1,
            message: 'em dash (U+2014): use a colon, a comma or a plain hyphen'
          });
          column = line.indexOf(EM_DASH, column + 1);
        }
      });
    },
    /**
     * @param {object} context - Rule context.
     * @returns {void}
     */
    run(context) {
      context.eachFile(({ file, text }) => {
        if (TYPOGRAPHY_EXEMPT_PREFIXES.some((prefix) => file.startsWith(prefix))) return;
        const extension = file.slice(file.lastIndexOf('.'));

        // A JSON file holds data and nothing else: any dash in it is data the game may display.
        if (extension === '.json' || extension === '.webmanifest') {
          this.checkFragment(context, file, text);
          return;
        }

        // In a module, only the strings are read by a player; the comments document the code.
        if (extension === '.js') {
          listJavaScriptStrings(text).forEach((literal) => {
            const position = positionAt(text, literal.offset);
            const column = literal.raw.indexOf(EM_DASH);
            if (column === -1) return;
            context.report({
              file,
              line: position.line,
              column: position.column + column,
              message: 'em dash (U+2014) in a user-facing string'
            });
          });
          return;
        }

        // In a page: the visible text (tags removed), and the few attributes a player reads.
        const masked = maskHtml(text);
        const visibleText = masked.replace(/<[^>]*>/g, (tag) => tag.replace(/[^\n\r]/g, ' '));
        this.checkFragment(context, file, visibleText);
        const attributes = VISIBLE_ATTRIBUTES.map(
          (name) => new RegExp(`\\s${name}="([^"]*)"`, 'g')
        );
        attributes.forEach((pattern) => {
          [...masked.matchAll(pattern)].forEach((match) => {
            const column = match[1].indexOf(EM_DASH);
            if (column === -1) return;
            const position = positionAt(masked, match.index + match[0].indexOf('"') + 1 + column);
            context.report({
              file,
              line: position.line,
              column: position.column,
              message: 'em dash (U+2014) in a user-facing attribute'
            });
          });
        });
      });
    }
  },
  {
    id: 'i18n/usage',
    summary: 'Every translation key the code reads literally exists.',
    severity: 'error',
    /**
     * @param {object} context - Rule context.
     * @returns {void}
     */
    run(context) {
      const dictionaries = loadDictionaries(context);
      const known = new Set(dictionaries.flatMap((dictionary) => Object.keys(dictionary.entries)));

      context.eachFile(({ file, text }) => {
        if (!['.js', '.html'].includes(file.slice(file.lastIndexOf('.')))) return;
        const patterns = [
          /\bt\(\s*'([A-Za-z0-9_][A-Za-z0-9_.-]*)'/g,
          /\bt\(\s*"([A-Za-z0-9_][A-Za-z0-9_.-]*)"/g,
          /data-i18n(?:-[a-z]+)?="([A-Za-z0-9_][A-Za-z0-9_.-]*)"/g
        ];
        patterns.forEach((pattern) => {
          text.split(/\r?\n/).forEach((line, index) => {
            [...line.matchAll(pattern)].forEach((match) => {
              if (known.has(match[1])) return;
              context.report({
                file,
                line: index + 1,
                column: match.index + 1,
                message: `"${match[1]}" is not declared by any dictionary`
              });
            });
          });
        });
      });
    }
  },
  {
    id: 'i18n/trophy-keys',
    summary: 'Every trophy counter declared in the settings has its translations.',
    severity: 'error',
    /**
     * @param {object} context - Rule context.
     * @returns {void}
     */
    run(context) {
      const dictionaries = loadDictionaries(context);
      const texts = new Map(
        dictionaries.map((dictionary) => [dictionary.file, context.readText(dictionary.file)])
      );
      /** @type {string[]} Composed keys every dictionary must declare. */
      const expected = [];

      const global = context.readJsonValue('settings/global_trophy.json');
      Object.keys(global ?? {})
        .filter((key) => !key.startsWith('_'))
        .forEach((statKey) => {
          const slug = slugify(statKey);
          expected.push(`trophy.group.${slug}`);
          expected.push(`trophy.global.${slug}.title`);
          expected.push(`trophy.global.${slug}.desc`);
        });

      const boosters = context.readJsonValue('settings/boosters_trophy.json');
      if (boosters?.enableCompletionTrophy !== false) {
        expected.push(
          'trophy.group.completion',
          'trophy.booster.completion.title',
          'trophy.booster.completion.desc',
          'trophy.booster.completionPrintings.desc'
        );
      }
      if (boosters?.enableBoosterStatsTrophy !== false) {
        expected.push(
          'trophy.group.opened',
          'trophy.booster.stats.title',
          'trophy.booster.stats.desc'
        );
      }

      dictionaries.forEach((dictionary) => {
        expected.forEach((key) => {
          if (Object.prototype.hasOwnProperty.call(dictionary.entries, key)) return;
          context.report({
            file: dictionary.file,
            line: texts.get(dictionary.file).split('\n').length,
            column: 1,
            message: `the catalogue composes the key "${key}", which is not declared`
          });
        });
      });
    }
  }
];

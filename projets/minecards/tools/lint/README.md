# The MineCards linter

`node tools/lint.mjs` — the single check the project runs before anything else. No dependency, no
install step, no build: the game itself is plain ES modules served as they are, so this program is
the only thing that reads the sources between the editor and the browser.

```
npm run lint          # lint everything (exit 1 on the first error)
npm run lint:fix      # fix what can be fixed without a judgement call, then lint
npm run lint:strict   # warnings are errors too (what a CI should run)
npm run lint:list     # list the rules
node tools/lint.mjs --only js/       # only the rules whose id starts with `js/`
node tools/lint.mjs --json           # machine-readable report
node tools/lint.mjs --only css/important --fix
```

On Windows, `lint.cmd` at the root of the project does the same thing with a double click.

## Severities

Two levels, and the difference matters:

- **error** — the project is broken or inconsistent *today*. The run fails.
- **warning** — something is expected and not there yet, and the game copes with it (a medal that
  falls back to `assets/img/trophy/default.png`, an artwork reference the screen hides). The run
  succeeds; `npm run lint:strict` is what turns them into a failure.

There is no third level and no silencing mechanism: a rule that no longer matches the project is
fixed or deleted, never muted. A `// eslint-disable`-style comment does not exist here on purpose —
a line of code that must break a rule is a sign the rule is wrong.

## The rules

### Hygiene — every text file

| Rule | What it refuses |
| --- | --- |
| `hygiene/encoding` | a UTF-8 byte order mark (fixable) |
| `hygiene/line-endings` | a file mixing CRLF and LF |
| `hygiene/trailing-whitespace` | a line ending with a space or a tab (fixable) |
| `hygiene/final-newline` | a file without its final line break (fixable) |
| `hygiene/indentation` | a tab used as indentation |
| `data/json` | invalid JSON, or a key declared twice in the same object (the silent killer: `JSON.parse` keeps the last one) |

### Game data — `data/`, `settings/`

A card is one `Index` printed in one `Layout` (`classic` or `fullart`), and that pair is the
identity of a printing: it is what the collection stores. The rules below treat it as one, and check
that every file naming a card, a trophy, an icon or a resource names one that exists.

| Rule | What it refuses |
| --- | --- |
| `data/card-catalogue` | a card without index, layout, rarity, style, names or descriptions; an index outside the prefix of its set (`SERIE-A1 / `, `PROMO-A1 / `); an image path that does not match its index and layout; a backdrop that is not an absolute URL (warning) |
| `data/card-unique` | the same `Index` printed twice in the same `Layout`, in one catalogue or across two |
| `data/card-references` | a code reward, a pinned offer or a trophy requirement naming a card no catalogue declares, or a printing that does not exist (warning for a code that only prefers it) |
| `data/codes` | a code declared twice (compared case-insensitively, like the game reads it), an unknown reward type, a non-positive quantity, an availability window that is empty or not a real day |
| `data/sets` | a set declared twice or without its catalogue, a release date that is not a real day, a promo catalogue the set does not declare (the game would never read it), a catalogue missing from `settings/cardsets.json`, a booster file whose `Serie` is not its own name |
| `data/trophies` | a trophy without a name, a rarity of its own, requirements or an icon; an unknown requirement type (warning); an icon, a title or a collection trophy naming something that does not exist; a title declared twice or translated in one language only |
| `data/economy` | a Sparks price map missing a rarity, a shop resource no block of the mine rewards, a pinned offer priced in an unknown resource or sold over an empty period, a mining block with a broken weight, hardness, reward chance or crack range |
| `data/rarity-table` | a rarity table drawing a rarity outside 1-5, or weights that do not add up to 1 (warning) |
| `data/daily-rewards` | a daily reward chapter without an id or a real window, a day declared twice, a missing default day, a reward type or quantity the game cannot hand out, a `CardID` no catalogue declares, a `UniqueID` reused, a `Unique` day without its replacement |

### JavaScript — `js/`, `sw.js`, `admin/`, `tools/`

| Rule | What it refuses |
| --- | --- |
| `js/parse` | a module `node --check` cannot parse |
| `js/module-doc` | a module that does not open with its `/** … */` header |
| `js/docblock` | an `export`ed function or a class method without a documentation block (a class is documented by its module header, a constructor by its fields) |
| `js/legacy-syntax` | `var`, `==` / `!=`, `console.log`, `debugger` |
| `js/imports` | a relative import that resolves to nothing, or the same module imported twice |

### Translations — `settings/i18n/*.json` and the keys they serve

| Rule | What it refuses |
| --- | --- |
| `i18n/parity` | a key declared by one language and not by another |
| `i18n/placeholders` | `{current}` on one side and nothing (or another name) on the other |
| `i18n/em-dash` | an em dash (U+2014) in a string a player can read: dictionaries, data, module strings, page text and visible attributes. Comments and `.docs/` are exempt |
| `i18n/usage` | `i18n.t('key')` or `data-i18n="key"` naming a key no dictionary declares |
| `i18n/trophy-keys` | a trophy counter of `settings/global_trophy.json` (or a family of `settings/boosters_trophy.json`) without its `trophy.group.<slug>`, `trophy.global.<slug>.title` and `.desc` |

### Stylesheets, pages, paths

| Rule | What it refuses |
| --- | --- |
| `css/important` | `!important`, except on the `[hidden]` guard and inside `@media (prefers-reduced-motion: reduce)` |
| `css/class-naming` | a class outside BEM (`block__element--modifier`); `is-`, `has-`, `no-`, `js-` prefixes are the accepted utility names |
| `html/ids` | an `id` declared twice in the same page |
| `html/inline-handlers` | an `onclick="…"`-style attribute |
| `assets/references` | a quoted asset path that does not exist (error in code, warning in a settings or data file: the screen falls back) |
| `sw/precache` | a file listed in `PRECACHE_URLS` of `sw.js` that is absent |
| `assets/trophy-medals` | a medal the trophy catalogue looks for and does not find (warning: `TrophyDetail` falls back to `default.png`) |

## Layout

```
tools/lint.mjs            the CLI: options, rule registry, report, exit code
tools/lint/lib/repo.mjs   which files are linted, and their raw text (cached)
tools/lint/lib/json.mjs   strict JSON reading (syntax + repeated keys)
tools/lint/lib/text.mjs   lines, positions, and the masking of comments/strings/regex
tools/lint/rules/*.mjs    the rules themselves
```

A rule is an object `{ id, summary, severity, files?, fixable?, fix?, run(context) }`:

```js
export default [
  {
    id: 'group/rule',
    summary: 'One sentence, printed by --list.',
    severity: 'error',
    files: (file) => file.endsWith('.css'),   // optional: restrict the rule to a subset
    fixable: true,                            // optional: --fix may rewrite the file
    fix(text) { return text; },               // and that is how
    run(context) {
      context.eachFile(({ file, text, lines }) => {
        context.report({ file, line: 1, column: 1, message: 'what is wrong' });
      });
    }
  }
];
```

`context` also exposes `files`, `readText(file)`, `readJsonValue(file)`, `readJson(file)`,
`exists(file)`, `listDirectory(file)` and `absolutePath(file)`. Two things are worth knowing before
writing a rule:

- work on the MASKED source (`maskJavaScript`, `maskCss`, `maskHtml`): a construct quoted in a
  comment is not that construct. `listJavaScriptStrings` is the opposite tool for the rules that
  care about the text a player reads;
- a diagnostic must point at the line the reader has to open. Masking keeps the line endings, which
  is what makes that possible.

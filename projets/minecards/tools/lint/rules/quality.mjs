/**
 * quality.mjs - The rules of the data quality: the shape of every JSON file, the media it names,
 * the sound map, the profile icons, the manifest and the assets themselves.
 *
 * Reference: `tools/lint/README.md`, `.docs/projet/04-donnees-et-configuration.md`,
 * `settings/sounds.json` (whose `_comment` documents the map) and `manifest.json`.
 *
 * WHY THEY EXIST
 * `data.mjs` checks what the game READS: a card, a trophy, a price. These rules check what the game
 * SERVES: a JSON file whose root is an object, a picture the catalogue names, a sound the interface
 * plays, an icon a phone downloads, a file that is really on disk. A missing file does not fail at
 * boot, it fails on the screen of one player, months later, which is exactly what a linter is for.
 *
 * LOCAL VERSUS REMOTE
 * The card illustrations live in another repository, named by absolute URLs: they cannot be opened
 * from here, so their SHAPE is checked (filled, absolute, image extension, index and layout of the
 * file name). Everything shipped in this repository (`assets/`, `data/`, `settings/`) is checked on
 * disk, byte for byte.
 *
 * A rule that cannot read a file reports nothing and lets `data/json` speak: an unreadable file is
 * ONE finding, not seven.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Settings the rules below read. */
const SOUNDS_FILE = 'settings/sounds.json';
const ICON_FILES = ['data/icon.json', 'settings/default_profile_icons.json'];
const MANIFEST_FILE = 'manifest.json';
const BOOSTER_DIRECTORY = 'data/boosters';
const PROMO_DIRECTORY = 'data/promo_cards';

/** Folders whose files are shipped as they are, with the extensions they may use. */
const ASSET_FOLDERS = ['assets/img', 'assets/sound', 'assets/icons', 'assets/fonts'];

/**
 * Folder of the booster renders. It also holds their sources (`A1.xcf`) and the helper that flips
 * them (`flip_down.py`), which are not assets: its files are checked for being readable and
 * non-empty, never for their extension.
 */
const BOOSTER_ASSET_FOLDER = 'assets/boosters';

/** Extensions an asset of the folders above may declare. */
const ASSET_EXTENSIONS = new Set([
  '.png',
  '.webp',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.ico',
  '.mp3',
  '.ogg',
  '.wav',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.glb',
]);

/** Extensions a picture named by a catalogue may use. */
const IMAGE_EXTENSIONS = new Set(['.png', '.webp', '.jpg', '.jpeg', '.gif', '.svg']);

/** Display modes the web app manifest understands. */
const DISPLAY_MODES = new Set(['fullscreen', 'standalone', 'minimal-ui', 'browser', 'window-controls-overlay']);

/** True for a string that still holds something once trimmed. */
const isFilled = (value) => typeof value === 'string' && value.trim() !== '';

/** True for an object literal (not an array, not null). */
const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * Line of a fragment in a text, or the line it was searched from when it is not found.
 *
 * @param {string} text - Raw content of the file.
 * @param {string} needle - Fragment to look for, quotes included.
 * @param {number} [from=0] - Offset to start the search from.
 * @returns {number} The 1-based line number.
 */
function lineAt(text, needle, from = 0) {
  const index = isFilled(needle) ? text.indexOf(needle, from) : -1;
  const offset = index >= 0 ? index : Math.max(0, from);
  if (offset <= 0) return 1;
  return text.slice(0, offset).split('\n').length;
}

/**
 * Reads a JSON file, or null when it does not parse (`data/json` reports that one).
 *
 * @param {object} context - Rule context.
 * @param {string} file - Project-relative path.
 * @returns {unknown|null} The parsed value, or null.
 */
function readOrNull(context, file) {
  try {
    return context.readJsonValue(file);
  } catch (error) {
    return null;
  }
}

/**
 * Lists the files of a folder, recursively.
 *
 * @param {object} context - Rule context.
 * @param {string} folder - Project-relative folder.
 * @returns {string[]} Project-relative paths, `/`-separated, sorted.
 */
function listFilesUnder(context, folder) {
  const found = [];
  const walk = (absolute) => {
    if (!fs.existsSync(absolute)) return;
    fs.readdirSync(absolute, { withFileTypes: true }).forEach((entry) => {
      const child = path.join(absolute, entry.name);
      if (entry.isDirectory()) {
        walk(child);
        return;
      }
      if (entry.isFile()) {
        found.push(path.relative(context.absolutePath('.'), child).split(path.sep).join('/'));
      }
    });
  };
  walk(context.absolutePath(folder));
  return found.sort();
}

/**
 * Walks every string of a parsed JSON value, parents included.
 *
 * @param {unknown} value - Parsed JSON value.
 * @param {(text: string, key: string|null) => void} visit - Called for every string.
 * @param {string|null} [key=null] - Key the value is stored under.
 * @returns {void}
 */
function walkStrings(value, visit, key = null) {
  if (typeof value === 'string') {
    visit(value, key);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => walkStrings(entry, visit, key));
    return;
  }
  if (isRecord(value)) {
    Object.entries(value).forEach(([childKey, child]) => walkStrings(child, visit, childKey));
  }
}

/**
 * Turns a path as written in a file into a project-relative one.
 *
 * @param {string} value - Path as declared (`./assets/img/x.png`, `assets/x.png`).
 * @returns {string} The project-relative path.
 */
function projectPathOf(value) {
  return value.replace(/^\.\//, '').replace(/^\/+/, '');
}

/**
 * True for a URL served by another host (the card illustrations repository).
 *
 * @param {string} value - Candidate.
 * @returns {boolean} True when it is absolute http(s).
 */
function isAbsoluteUrl(value) {
  return /^https?:\/\//i.test(value);
}

export default [
  {
    id: 'data/json-root',
    summary: 'Every JSON file has an object or a non-empty array at its root.',
    severity: 'error',
    files: (relativePath) => relativePath.endsWith('.json'),
    /**
     * @param {object} context - Rule context.
     * @returns {void}
     */
    run(context) {
      context.eachFile(({ file }) => {
        const value = readOrNull(context, file);
        if (value === null) return;
        if (typeof value !== 'object') {
          context.report({
            file,
            line: 1,
            column: 1,
            message: `the root is a ${typeof value}, not an object or an array`,
          });
          return;
        }
        if (!Array.isArray(value) && !isRecord(value)) {
          context.report({ file, line: 1, column: 1, message: 'the root is null' });
          return;
        }
        if (Array.isArray(value) && value.length === 0) {
          context.report({ file, line: 1, column: 1, message: 'the root is an empty array' });
        }
      });
    },
  },
  {
    id: 'data/media-paths',
    summary: 'Every asset path a data or settings file names exists on disk.',
    severity: 'error',
    /**
     * @param {object} context - Rule context.
     * @returns {void}
     */
    run(context) {
      context.eachFile(({ file, text }) => {
        if (!file.endsWith('.json')) return;
        if (!file.startsWith('data/') && !file.startsWith('settings/')) return;
        const value = readOrNull(context, file);
        if (value === null) return;

        walkStrings(value, (candidate) => {
          const trimmed = candidate.trim();
          if (!/^\.?\/?assets\//.test(trimmed)) return;
          if (isAbsoluteUrl(trimmed)) return;
          const target = projectPathOf(trimmed);
          if (context.exists(target)) return;
          context.report({
            file,
            line: lineAt(text, trimmed),
            column: 1,
            message: `"${trimmed}" is named by the data but does not exist`,
          });
        });
      });
    },
  },
  {
    id: 'data/card-media',
    summary: 'A booster names its texture, and every card names a picture with an image extension.',
    severity: 'error',
    /**
     * @param {object} context - Rule context.
     * @returns {void}
     */
    run(context) {
      const catalogues = [
        ...context.listDirectory(BOOSTER_DIRECTORY)
          .filter((name) => name.endsWith('.json'))
          .map((name) => `${BOOSTER_DIRECTORY}/${name}`),
        ...context.listDirectory(PROMO_DIRECTORY)
          .filter((name) => name.endsWith('.json'))
          .map((name) => `${PROMO_DIRECTORY}/${name}`),
      ];

      catalogues.forEach((file) => {
        const catalogue = readOrNull(context, file);
        if (!isRecord(catalogue)) return;
        const text = context.readText(file);
        const isBooster = file.startsWith(BOOSTER_DIRECTORY);

        if (isBooster) {
          const texture = catalogue.BoosterTexture;
          if (!isFilled(texture)) {
            context.report({
              file,
              line: 1,
              column: 1,
              message: 'the booster declares no BoosterTexture',
            });
          } else if (!isAbsoluteUrl(texture) && !context.exists(projectPathOf(texture))) {
            context.report({
              file,
              line: lineAt(text, texture),
              column: 1,
              message: `BoosterTexture "${texture}" does not exist`,
            });
          }
        }

        const cards = Array.isArray(catalogue.Cards)
          ? catalogue.Cards
          : Array.isArray(catalogue.Card)
            ? catalogue.Card
            : [];
        cards.forEach((card, position) => {
          if (!isRecord(card)) return;
          const label = `card #${position + 1}`;
          ['Background', 'Underlay', 'Path'].forEach((field) => {
            const value = card[field];
            if (value === undefined || value === null) return;
            if (!isFilled(value)) {
              // A card without a backdrop is drawn without one (the views cope with it); a card
              // without its illustration is a hole in the collection, so only `Path` is mandatory.
              if (field !== 'Path') return;
              context.report({ file, line: lineAt(text, `"${field}"`), column: 1, message: `${label} ${field} is empty` });
              return;
            }
            if (isAbsoluteUrl(value)) {
              const extension = path.extname(value.split('?')[0]).toLowerCase();
              if (!IMAGE_EXTENSIONS.has(extension)) {
                context.report({
                  file,
                  line: lineAt(text, value),
                  column: 1,
                  message: `${label} ${field} is not an image (${extension || 'no extension'})`,
                });
              }
              return;
            }
            if (!context.exists(projectPathOf(value))) {
              context.report({
                file,
                line: lineAt(text, value),
                column: 1,
                message: `${label} ${field} names a local file that does not exist: ${value}`,
              });
            }
          });
        });
      });
    },
  },
  {
    id: 'data/sound-map',
    summary: 'Every sound of the interface map has a unique event and a shipped mp3.',
    severity: 'error',
    files: (relativePath) => relativePath === SOUNDS_FILE,
    /**
     * @param {object} context - Rule context.
     * @returns {void}
     */
    run(context) {
      const value = readOrNull(context, SOUNDS_FILE);
      if (!isRecord(value)) return;
      if (!Array.isArray(value.sounds)) {
        context.report({ file: SOUNDS_FILE, line: 1, column: 1, message: 'the map declares no "sounds" array' });
        return;
      }
      if (value.sounds.length === 0) {
        context.report({ file: SOUNDS_FILE, line: 1, column: 1, message: 'the sound map is empty' });
        return;
      }

      const text = context.readText(SOUNDS_FILE);
      const events = new Set();
      value.sounds.forEach((entry, position) => {
        const label = `sound #${position + 1}`;
        if (!isRecord(entry)) {
          context.report({ file: SOUNDS_FILE, line: 1, column: 1, message: `${label} is not an object` });
          return;
        }
        const line = lineAt(text, isFilled(entry.file) ? entry.file : '"event"');

        if (!isFilled(entry.event)) {
          context.report({ file: SOUNDS_FILE, line, column: 1, message: `${label} has no event` });
        } else if (events.has(entry.event)) {
          context.report({
            file: SOUNDS_FILE,
            line,
            column: 1,
            message: `${label} event "${entry.event}" is declared twice`,
          });
        } else {
          events.add(entry.event);
        }

        if (entry.enabled !== undefined && typeof entry.enabled !== 'boolean') {
          context.report({ file: SOUNDS_FILE, line, column: 1, message: `${label} enabled is not a boolean` });
        }

        if (!isFilled(entry.file)) {
          context.report({ file: SOUNDS_FILE, line, column: 1, message: `${label} has no file` });
          return;
        }
        if (!entry.file.startsWith('assets/sound/')) {
          context.report({
            file: SOUNDS_FILE,
            line,
            column: 1,
            message: `${label} file "${entry.file}" is not under assets/sound/`,
          });
        }
        if (path.extname(entry.file).toLowerCase() !== '.mp3') {
          context.report({
            file: SOUNDS_FILE,
            line,
            column: 1,
            message: `${label} file "${entry.file}" is not an mp3`,
          });
        }
        if (!context.exists(projectPathOf(entry.file))) {
          context.report({
            file: SOUNDS_FILE,
            line,
            column: 1,
            message: `${label} file "${entry.file}" does not exist`,
          });
        }
      });
    },
  },
  {
    id: 'data/profile-icons',
    summary: 'Every profile icon catalogue names existing pictures, once per file.',
    severity: 'error',
    files: (relativePath) => ICON_FILES.includes(relativePath),
    /**
     * @param {object} context - Rule context.
     * @returns {void}
     */
    run(context) {
      ICON_FILES.forEach((file) => {
        const value = readOrNull(context, file);
        if (value === null) return;
        if (!Array.isArray(value)) {
          context.report({ file, line: 1, column: 1, message: 'the catalogue is not an array' });
          return;
        }

        const text = context.readText(file);
        const declared = new Set();
        value.forEach((entry, position) => {
          const label = `icon #${position + 1}`;
          if (!isRecord(entry)) {
            context.report({ file, line: 1, column: 1, message: `${label} is not an object` });
            return;
          }
          const line = lineAt(text, isFilled(entry.file) ? entry.file : '"name"');
          if (!isFilled(entry.name)) {
            context.report({ file, line, column: 1, message: `${label} has no name` });
          }
          if (!isFilled(entry.file)) {
            context.report({ file, line, column: 1, message: `${label} has no file` });
            return;
          }
          if (declared.has(entry.file)) {
            context.report({ file, line, column: 1, message: `${label} file "${entry.file}" is declared twice` });
            return;
          }
          declared.add(entry.file);
          if (isAbsoluteUrl(entry.file)) return;
          if (!context.exists(projectPathOf(entry.file))) {
            context.report({
              file,
              line,
              column: 1,
              message: `${label} file "${entry.file}" does not exist`,
            });
          }
        });
      });
    },
  },
  {
    id: 'data/manifest',
    summary: 'The web app manifest is complete, and every icon it promises is shipped.',
    severity: 'error',
    files: (relativePath) => relativePath === MANIFEST_FILE,
    /**
     * @param {object} context - Rule context.
     * @returns {void}
     */
    run(context) {
      const manifest = readOrNull(context, MANIFEST_FILE);
      if (!isRecord(manifest)) {
        context.report({ file: MANIFEST_FILE, line: 1, column: 1, message: 'the manifest is not an object' });
        return;
      }
      const text = context.readText(MANIFEST_FILE);

      ['name', 'short_name', 'start_url', 'scope', 'display', 'theme_color', 'background_color'].forEach((key) => {
        if (!isFilled(manifest[key])) {
          context.report({ file: MANIFEST_FILE, line: 1, column: 1, message: `the manifest has no "${key}"` });
        }
      });

      ['start_url', 'scope'].forEach((key) => {
        if (isFilled(manifest[key]) && !manifest[key].startsWith('/')) {
          context.report({
            file: MANIFEST_FILE,
            line: lineAt(text, `"${key}"`),
            column: 1,
            message: `"${key}" must be an absolute path (it starts with "/")`,
          });
        }
      });

      if (isFilled(manifest.display) && !DISPLAY_MODES.has(manifest.display)) {
        context.report({
          file: MANIFEST_FILE,
          line: lineAt(text, manifest.display),
          column: 1,
          message: `display "${manifest.display}" is not a known display mode`,
        });
      }

      if (!Array.isArray(manifest.icons) || manifest.icons.length === 0) {
        context.report({ file: MANIFEST_FILE, line: 1, column: 1, message: 'the manifest declares no icon' });
        return;
      }

      manifest.icons.forEach((icon, position) => {
        const label = `icon #${position + 1}`;
        if (!isRecord(icon) || !isFilled(icon.src)) {
          context.report({ file: MANIFEST_FILE, line: 1, column: 1, message: `${label} has no src` });
          return;
        }
        const line = lineAt(text, icon.src);
        if (!/^\d+x\d+$/.test(String(icon.sizes ?? ''))) {
          context.report({
            file: MANIFEST_FILE,
            line,
            column: 1,
            message: `${label} sizes "${icon.sizes}" is not WIDTHxHEIGHT`,
          });
        }
        if (!String(icon.type ?? '').startsWith('image/')) {
          context.report({ file: MANIFEST_FILE, line, column: 1, message: `${label} type "${icon.type}" is not an image` });
        }
        if (isAbsoluteUrl(icon.src)) {
          const extension = path.extname(icon.src.split('?')[0]).toLowerCase();
          if (!IMAGE_EXTENSIONS.has(extension)) {
            context.report({ file: MANIFEST_FILE, line, column: 1, message: `${label} src is not an image` });
          }
          return;
        }
        // The paths of the manifest are absolute from the host, under the folder the game is served
        // from (`/projets/minecards/`): what is left after it is the project-relative path.
        const local = icon.src.includes('/minecards/')
          ? icon.src.slice(icon.src.indexOf('/minecards/') + '/minecards/'.length)
          : projectPathOf(icon.src);
        if (!context.exists(local)) {
          context.report({
            file: MANIFEST_FILE,
            line,
            column: 1,
            message: `${label} src "${icon.src}" does not exist in the project (${local})`,
          });
        }
      });
    },
  },
  {
    id: 'assets/files',
    summary: 'Every shipped asset has a known extension and is not empty.',
    severity: 'error',
    /**
     * @param {object} context - Rule context.
     * @returns {void}
     */
    run(context) {
      /**
       * Checks one folder.
       *
       * @param {string} folder - Project-relative folder.
       * @param {boolean} requireKnownExtension - True for a folder that only ships assets.
       * @returns {void}
       */
      const checkFolder = (folder, requireKnownExtension) => {
        if (!context.exists(folder)) {
          context.report({ file: folder, line: 1, column: 1, message: `the folder "${folder}" is missing` });
          return;
        }
        listFilesUnder(context, folder).forEach((file) => {
          if (requireKnownExtension) {
            const extension = path.extname(file).toLowerCase();
            if (!ASSET_EXTENSIONS.has(extension)) {
              context.report({
                file,
                line: 1,
                column: 1,
                message: `unknown asset extension "${extension || '(none)'}"`,
              });
            }
          }
          let size = 0;
          try {
            size = fs.statSync(context.absolutePath(file)).size;
          } catch (error) {
            context.report({ file, line: 1, column: 1, message: 'the file cannot be read' });
            return;
          }
          if (size === 0) {
            context.report({ file, line: 1, column: 1, message: 'the file is empty (0 bytes)' });
          }
        });
      };

      ASSET_FOLDERS.forEach((folder) => checkFolder(folder, true));
      checkFolder(BOOSTER_ASSET_FOLDER, false);
    },
  },
];

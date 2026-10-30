/**
 * ThemeIcons - Draws the icon file that reads on the active theme.
 *
 * Reference: `css/themes.css` (`--icon-variant`, `--icon-ink`) and `js/utils/ThemeManager.js`.
 *
 * WHY
 * Three interface glyphs - the daily boosters, the bonus boosters and the binders - are a single ink
 * on a transparent background. Drawn in black they vanish on the two dark palettes, so they ship
 * twice: the black file and a white twin suffixed `_dark`. Which of the two to draw is NOT decided
 * here: `--icon-variant` is declared in the very CSS block that declares the background, beside
 * `--icon-filter`, so a dark palette added later is one more block and nothing else.
 *
 * The inline glyphs of the header (the sparkle of the Mine Pick, the gift of the daily rewards) have
 * no file to swap: they take `--icon-ink` as their colour, which the same block provides.
 *
 * TWO WAYS IN
 *   - static markup: `<img data-icon="bonus_booster">`, then `applyThemeIcons()`, which rewrites
 *     every `[data-icon]` of a subtree. The header calls it once at boot and again on every
 *     `THEME_CHANGED`;
 *   - a path built at run time (a reward of the daily board): `themeIcon(path)`, which leaves any
 *     path that has no `_dark` twin untouched - an illustration, a dust, the card back.
 *
 * No `src` is written in the markup for the swapped icons: the browser would start fetching the
 * black file before the theme is known. The first pass happens before the boot overlay is removed,
 * so nothing is missing on screen.
 */

/** Folder of the interface icons, relative to the application root. */
const ICON_DIRECTORY = 'assets/img';

/**
 * Icons that exist in a white `_dark` twin. One entry per file actually shipped: a name that is
 * listed here without its file is a broken image, and a `_dark` file added without this entry is a
 * file nobody draws.
 */
export const DARK_ICONS = Object.freeze(['daily_boosters', 'bonus_booster', 'binders']);

/** Shape of an interface icon path. Anything else (a card, a texture) is returned as it came. */
const ICON_PATH_PATTERN = /^assets\/img\/([a-z0-9_]+)\.png$/;

/**
 * Tells whether the active palette wants the white twin.
 *
 * Read from the custom property rather than from the theme id: the id is a name, the property is the
 * decision, and a theme that renames itself keeps working.
 *
 * Read on `<body>`, never on `<html>`: the dark palette is also declared on `:root`, which keeps
 * matching after a switch, while the light ones only exist on `body[data-theme="…"]`. Asked on the
 * root element, this question would answer "dark" for every theme.
 *
 * @returns {boolean} True on the dark palettes.
 */
export function usesDarkIcons() {
  const scope = document.body ?? document.documentElement;
  const variant = window.getComputedStyle(scope).getPropertyValue('--icon-variant');
  return variant.trim().toLowerCase() === 'dark';
}

/**
 * Returns the path of the file to draw for an interface icon.
 *
 * @param {string} path - Path relative to the application root (`assets/img/<name>.png`).
 * @returns {string} The same path, or its `_dark` twin when the palette asks for it.
 */
export function themeIcon(path) {
  const match = typeof path === 'string' ? ICON_PATH_PATTERN.exec(path) : null;
  if (!match || !DARK_ICONS.includes(match[1])) return path;
  return `${ICON_DIRECTORY}/${match[1]}${usesDarkIcons() ? '_dark' : ''}.png`;
}

/**
 * Writes the right variant into every `[data-icon]` image of a subtree.
 *
 * Idempotent: an image that already carries the right path is left alone, so calling it on every
 * theme change costs one comparison per icon and never re-downloads anything.
 *
 * @param {ParentNode} [root=document] - Subtree to walk (the document, or a dialog about to be drawn).
 * @returns {void}
 */
export function applyThemeIcons(root = document) {
  root.querySelectorAll('img[data-icon]').forEach((image) => {
    const name = image.dataset.icon;
    if (!name) return;
    const src = themeIcon(`${ICON_DIRECTORY}/${name}.png`);
    if (image.getAttribute('src') !== src) image.src = src;
  });
}

/**
 * ConsoleGate - Keeps the informational logs out of a player's console.
 *
 * Reference: `js/app.js` (installs it before anything else boots, then resolves it from the stored
 * settings), `js/UI/views/SettingsView.js` (the developer switch that flips it live) and
 * `.docs/main.md` section 3.K.
 *
 * WHY IT EXISTS
 * The game narrates itself: view changes, asset loads, retries, saved steps. That narration is what
 * makes a bug report possible, and it is also everything a player sees when they open the DevTools
 * looking for the one red line. A warning buried under a hundred `[info]` lines is a warning nobody
 * reads.
 *
 * THE RULE
 * `log`, `info`, `debug`, `table`, `dir`, `trace` and the `group` family reach the console only when
 * the account has the BASIC developer mode on (`settings.devMode`, the switch of the settings
 * screen), never on the allowlisted advanced one. `warn` and `error` are not touched: a warning is a
 * problem the player may have to report, and hiding it would be the opposite of the point.
 *
 * WHY A BUFFER
 * The settings are read after the modules load and after the first views are built, so the most
 * interesting lines (the boot) would be gone before the switch is even known. They are therefore
 * queued while the answer is unknown, then replayed in order for a developer and dropped for a
 * player. The queue is capped, so a boot that loops cannot grow it without bound.
 *
 * NOT A LOGGER
 * Nothing here changes what a module writes: the calls stay `console.info(...)`, so every line still
 * points at the call site that produced it, and a warning or an error keeps working even before the
 * gate is installed.
 */

/** Methods silenced unless the basic developer mode is on. */
const VERBOSE_METHODS = [
  'log',
  'info',
  'debug',
  'table',
  'dir',
  'trace',
  'group',
  'groupCollapsed',
  'groupEnd',
];

/** Lines queued while the stored settings are still unknown. */
const BUFFER_LIMIT = 200;

/** @type {Map<string, Function>} Native methods, bound once. */
const nativeMethods = new Map();

/** @type {Array<{method: string, args: unknown[]}>} Lines written before the settings were read. */
const pending = [];

/** @type {boolean|null} Null until the stored settings say which console this is. */
let developerConsole = null;

/** @type {boolean} True once the methods are replaced. */
let installed = false;

/**
 * Enables or disables the informational logs.
 *
 * Called twice: at boot with the stored `settings.devMode`, and when the developer switch of the
 * settings screen is flipped, so a developer does not have to reload to read the next lines.
 *
 * @param {boolean} enabled - True when the account has the basic developer mode on.
 * @returns {void}
 */
export function setDeveloperConsole(enabled) {
  const next = enabled === true;
  const opening = next && developerConsole !== true;
  developerConsole = next;

  if (!opening) {
    pending.length = 0;
    return;
  }
  // Replayed in the order they were written, through the native methods: the queue IS the boot a
  // developer would have seen, and replaying through the wrappers would drop it again.
  pending.splice(0).forEach(({ method, args }) => nativeMethods.get(method)?.(...args));
}

/**
 * Replaces the informational console methods with a gate.
 *
 * Installed once, at the very top of `js/app.js`: every module loaded before it can log freely, its
 * lines are queued until the settings answer. Calling it twice is a no-op.
 *
 * @returns {void}
 */
export function installConsoleGate() {
  if (installed || typeof console === 'undefined') return;
  installed = true;

  VERBOSE_METHODS.forEach((method) => {
    const native = console[method];
    if (typeof native !== 'function') return;
    const bound = native.bind(console);
    nativeMethods.set(method, bound);
    console[method] = (...args) => {
      if (developerConsole === true) {
        bound(...args);
        return;
      }
      if (developerConsole === false) return;
      if (pending.length >= BUFFER_LIMIT) pending.shift();
      pending.push({ method, args });
    };
  });
}

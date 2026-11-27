/**
 * core.js - Shared runtime of the MineCards showcase.
 *
 * Reference: `special/demo/config.json` (strings and palette), `special/demo/animations.json`
 * (tempo) and `special/demo/scripts/main.js` (the runner).
 *
 * Everything the scenes reuse lives here: the beat clock (`bpm` is the only tempo knob), the DOM
 * helpers that keep the markup readable, the camera moves, the parallax of a layer, the bursts of
 * particles and the letter-by-letter reveal of a text phase. No scene owns a duration of its own:
 * they all ask this module for a multiple of the beat.
 */

/** Runtime state shared by every module of the demo. */
export const state = {
  /** @type {'fr'|'en'} Interface and card language of the show. */
  lang: 'fr',
  /** @type {'horizontal'|'vertical'} Format picked by the query string. */
  format: 'horizontal',
  /** @type {string} Absolute URL of the application root. */
  appRoot: '/',
  /** @type {object|null} Parsed `demo/config.json`. */
  config: null,
  /** @type {object|null} Parsed `demo/animations.json`. */
  animations: null,
  /** @type {object|null} Parsed `demo/assets.json`. */
  assets: null,
  /** @type {number} Duration of one beat, in milliseconds. */
  beatMs: 625,
  /** @type {boolean} True while the show runs. */
  playing: false,
};

/**
 * Turns a project-relative path into an absolute URL.
 *
 * @param {string} path - Path such as `assets/img/minepick.png`, or an absolute URL.
 * @returns {string} The URL the browser can fetch.
 */
export function resolve(path) {
  try {
    return new URL(path, `${state.appRoot}`).href;
  } catch (error) {
    console.warn('[demo] The path could not be resolved.', path, error);
    return path;
  }
}

/**
 * Reads one flat key of the language of the show.
 *
 * @param {string} key - Key such as `phase.intro.title`.
 * @param {Record<string, string|number>} [values] - Values of the `{placeholder}` slots.
 * @returns {string} The translated sentence, or the key itself when it is missing.
 */
export function tr(key, values = {}) {
  const strings = state.config?.strings?.[state.lang] ?? {};
  const fallback = state.config?.strings?.fr ?? {};
  const template = strings[key] ?? fallback[key] ?? key;
  return String(template).replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match
  );
}

/**
 * Creates an element with a class and an optional text.
 *
 * @param {string} tag - Tag name.
 * @param {string} [className] - Class of the element.
 * @param {string} [text] - Text content.
 * @returns {HTMLElement} The new element.
 */
export function create(tag, className = '', text = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== '') element.textContent = text;
  return element;
}

/**
 * Waits a number of milliseconds.
 *
 * @param {number} milliseconds - Delay.
 * @returns {Promise<void>} Resolves after the delay.
 */
export function sleep(milliseconds) {
  return new Promise((done) => {
    window.setTimeout(done, Math.max(0, milliseconds));
  });
}

/**
 * Waits for the next painted frame.
 *
 * @returns {Promise<void>} Resolves once the browser had a chance to paint.
 */
export function nextFrame() {
  return new Promise((done) => requestAnimationFrame(() => done()));
}

/**
 * Returns a duration expressed in beats, in milliseconds.
 *
 * @param {number} [beats=1] - Number of beats.
 * @returns {number} The duration.
 */
export function beat(beats = 1) {
  return state.beatMs * beats;
}

/**
 * Starts a Web Animation with a `both` fill so the end state is kept while the scene waits.
 *
 * @param {Element} element - Element to animate.
 * @param {Keyframe[]|PropertyIndexedKeyframes} frames - Keyframes.
 * @param {KeyframeAnimationOptions} options - Timing options.
 * @returns {Animation} The running animation.
 */
export function animate(element, frames, options) {
  return element.animate(frames, { fill: 'both', ...options });
}

/**
 * Plays one animation and resolves once it ended (or was cancelled).
 *
 * @param {Element} element - Element to animate.
 * @param {Keyframe[]|PropertyIndexedKeyframes} frames - Keyframes.
 * @param {KeyframeAnimationOptions} options - Timing options.
 * @returns {Promise<void>} Resolves when the animation is over.
 */
export async function play(element, frames, options) {
  const animation = animate(element, frames, options);
  try {
    await animation.finished;
  } catch (error) {
    // A cancelled animation (a scene that changed its mind) is not a failure of the show.
  }
}

/**
 * Splits the text of an element into one span per character.
 *
 * The spans are returned, not animated: a scene decides how they enter, and every letter keeps its
 * place in the reading order (the text is still the text, only wrapped).
 *
 * @param {HTMLElement} element - Element whose text is split.
 * @returns {HTMLElement[]} The letter spans.
 */
export function splitLetters(element) {
  const text = element.textContent ?? '';
  element.textContent = '';
  const letters = [];
  // One wrapper per word: the letters are inline-blocks, so without it the browser is allowed
  // to break inside a word ("TOUTES" became "TOU / TES" in portrait). A word now moves to the
  // next line as a whole.
  text.split(' ').forEach((word, index) => {
    if (index > 0) element.append(document.createTextNode(' '));
    const group = create('span', 'demo-word');
    [...word].forEach((character) => {
      const letter = create('span', 'demo-letter', character);
      group.append(letter);
      letters.push(letter);
    });
    element.append(group);
  });
  return letters;
}

/**
 * Reveals a split title, one beat-scaled stagger per letter.
 *
 * @param {HTMLElement[]} letters - Spans returned by `splitLetters()`.
 * @param {number} [step=0.045] - Delay between two letters, in beats.
 * @returns {Promise<void>} Resolves once the last letter landed.
 */
export async function revealLetters(letters, step = 0.045) {
  const duration = beat(0.55);
  letters.forEach((letter, index) => {
    animate(
      letter,
      [
        { opacity: 0, transform: 'translateY(0.5em) rotate(6deg)' },
        { opacity: 1, transform: 'translateY(0) rotate(0)' },
      ],
      { duration, delay: beat(step) * index, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)' }
    );
  });
  await sleep(beat(step) * letters.length + duration * 0.6);
}

/**
 * Camera move of a scene, applied to the wrapper of the world.
 *
 * @param {string} name - `push`, `pull`, `pan-left`, `pan-right`, `orbit` or `shake`.
 * @returns {Keyframe[]} The keyframes of the move.
 */
export function cameraFrames(name) {
  switch (name) {
    case 'pull':
      return [
        { transform: 'translate3d(0, 2%, 0) scale(1.1)' },
        { transform: 'translate3d(0, 0, 0) scale(1)' },
      ];
    case 'pan-left':
      return [
        { transform: 'translate3d(1.8%, 0, 0) scale(1.08)' },
        { transform: 'translate3d(-1.8%, 0, 0) scale(1.08)' },
      ];
    case 'pan-right':
      return [
        { transform: 'translate3d(-1.8%, 0, 0) scale(1.08)' },
        { transform: 'translate3d(1.8%, 0, 0) scale(1.08)' },
      ];
    case 'orbit':
      return [
        { transform: 'rotateY(-5deg) rotateX(1.5deg) scale(1.04)' },
        { transform: 'rotateY(5deg) rotateX(-1.5deg) scale(1.08)' },
      ];
    case 'crane':
      return [
        { transform: 'translate3d(0, 2%, 0) scale(1.08)' },
        { transform: 'translate3d(0, -1.5%, 0) scale(1.04)' },
      ];
    case 'swing':
      return [
        { transform: 'rotate(-0.7deg) translate3d(-0.8%, 0, 0) scale(1.06)' },
        { transform: 'rotate(0.7deg) translate3d(0.8%, 0, 0) scale(1.06)' },
      ];
    // The start of a dolly is the widest the lens ever is: 1.12 still reads as a strong return,
    // and keeps the content of the frame clear of the edges on both formats.
    case 'dolly':
      return [
        { transform: 'scale(1.12) translate3d(0, 1.2%, 0)' },
        { transform: 'scale(1.02) translate3d(0, 0, 0)' },
      ];
    case 'shake':
      return [
        { transform: 'translate3d(0, 0, 0) scale(1.02)' },
        { transform: 'translate3d(-10px, 4px, 0) scale(1.01)' },
        { transform: 'translate3d(9px, -5px, 0) scale(1.03)' },
        { transform: 'translate3d(-6px, 3px, 0) scale(1.02)' },
        { transform: 'translate3d(4px, -2px, 0) scale(1.03)' },
        { transform: 'translate3d(0, 0, 0) scale(1.02)' },
      ];
    case 'push':
    default:
      return [
        { transform: 'translate3d(0, 0, 0) scale(1)' },
        { transform: 'translate3d(0, -1%, 0) scale(1.06)' },
      ];
  }
}

/**
 * Reads one switch of the extra camera layers, kept in `animations.camera`.
 *
 * A switch that is absent counts as on: the block only names the moves it wants to turn off.
 * A scene can decide for itself with its own `cameraLayers` block, which wins over the global one:
 * the looping moves are off in the film and only the mining turns them back on.
 *
 * @param {string} name - Layer name such as `handheld` or `pulse`.
 * @param {object} [scene] - Definition of the scene being played, if it has its own switches.
 * @returns {boolean} True when the layer plays.
 */
export function cameraEnabled(name, scene = null) {
  const local = scene?.cameraLayers?.[name];
  if (local !== undefined) return local !== false;
  return state.animations?.camera?.[name] !== false;
}

/**
 * Ambient camera layers, composed on top of the base move of a scene.
 *
 * Each entry is a small move of its own, and `runCamera` stacks them on the base move with the
 * additive composite: a pan can breathe, roll, drift and shake at the same time without any scene
 * writing a second timeline. `beats` is the length of one loop in beats, or null when the layer
 * lasts as long as the scene; a missing `iterations` plays the layer once.
 */
const CAMERA_LAYERS = {
  // A tripod in the hands of somebody breathing: a few pixels, never enough to read as a shove.
  handheld: {
    beats: 3,
    iterations: Infinity,
    easing: 'ease-in-out',
    frames: [
      { transform: 'translate3d(0px, 0px, 0)' },
      { transform: 'translate3d(3px, -2px, 0)' },
      { transform: 'translate3d(-2px, 3px, 0)' },
      { transform: 'translate3d(2px, 2px, 0)' },
      { transform: 'translate3d(-3px, -1px, 0)' },
      { transform: 'translate3d(0px, 0px, 0)' },
    ],
  },
  // The slow scale of a camera that is not quite locked: the frame is never perfectly still.
  breath: {
    beats: 4,
    iterations: Infinity,
    easing: 'ease-in-out',
    frames: [{ transform: 'scale(1)' }, { transform: 'scale(1.012)' }, { transform: 'scale(1)' }],
  },
  // A constant push, whatever the base move is: no scene is ever frozen in place.
  zoom: {
    beats: null,
    easing: 'cubic-bezier(0.2, 0, 0.6, 1)',
    frames: [{ transform: 'scale(1)' }, { transform: 'scale(1.06)' }],
  },
  // A lateral travelling that ignores the composition: the whole frame slides under the lens.
  drift: {
    beats: null,
    easing: 'ease-in-out',
    frames: [
      { transform: 'translate3d(-0.8%, 0, 0)' },
      { transform: 'translate3d(0.8%, 0, 0)' },
    ],
  },
  // The horizon of a camera on a shoulder rig: under a degree, but the frame visibly tilts.
  roll: {
    beats: null,
    easing: 'ease-in-out',
    frames: [{ transform: 'rotate(-0.35deg)' }, { transform: 'rotate(0.35deg)' }],
  },
  // The same idea on the other axis, in 3D, so the stage keeps a little depth all the time.
  tilt: {
    beats: null,
    easing: 'ease-in-out',
    frames: [{ transform: 'rotateX(1.2deg)' }, { transform: 'rotateX(-1.2deg)' }],
  },
  // Two loops slower than the music: a lateral sway and a vertical bob, out of phase on purpose.
  sway: {
    beats: 5,
    iterations: Infinity,
    easing: 'ease-in-out',
    frames: [
      { transform: 'translate3d(-0.4%, 0, 0)' },
      { transform: 'translate3d(0.4%, 0, 0)' },
      { transform: 'translate3d(-0.4%, 0, 0)' },
    ],
  },
  bob: {
    beats: 6,
    iterations: Infinity,
    easing: 'ease-in-out',
    frames: [
      { transform: 'translate3d(0, 0.5%, 0)' },
      { transform: 'translate3d(0, -0.5%, 0)' },
      { transform: 'translate3d(0, 0.5%, 0)' },
    ],
  },
  // One pulse per beat: the whole frame follows the tempo of the show, so even a still scene
  // breathes with the music.
  pulse: {
    beats: 1,
    iterations: Infinity,
    easing: 'ease-in-out',
    frames: [{ transform: 'scale(1)' }, { transform: 'scale(1.01)' }, { transform: 'scale(1)' }],
  },
  // The impact of a cut: the frame is already slightly too close and settles.
  kick: {
    beats: 0.7,
    easing: 'cubic-bezier(0.15, 0.9, 0.3, 1)',
    frames: [{ transform: 'scale(1.06)' }, { transform: 'scale(1)' }],
  },
};

/**
 * Runs the camera of one scene: its base move plus every ambient layer left on in the config.
 *
 * @param {HTMLElement} element - The camera wrapper of the stage.
 * @param {string} name - Base move (`push`, `dolly`, `swing`, ...).
 * @param {number} duration - Length of the scene, in milliseconds.
 * @param {object} [scene] - Definition of the scene, whose `cameraLayers` override the config.
 * @returns {{cancel: () => void}} Handle that stops every layer of the move.
 */
export function runCamera(element, name, duration, scene = null) {
  const running = [
    animate(element, cameraFrames(name), {
      duration,
      easing: name === 'shake' ? 'linear' : 'cubic-bezier(0.3, 0, 0.4, 1)',
    }),
  ];

  // A visitor who asked for less motion keeps the base move of each scene and loses the ambient
  // layers, which are the only part of the camera that never stops.
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  if (!still) {
    Object.entries(CAMERA_LAYERS).forEach(([layerName, layer]) => {
      if (!cameraEnabled(layerName, scene)) return;
      running.push(
        animate(element, layer.frames, {
          duration: layer.beats === null ? duration : beat(layer.beats),
          iterations: layer.iterations ?? 1,
          easing: layer.easing,
          composite: 'add',
        })
      );
    });
  }

  return {
    cancel: () => running.forEach((animation) => animation.cancel()),
  };
}

/**
 * Moves a background layer against the camera, at its own depth.
 *
 * @param {HTMLElement} layer - Layer carrying `data-depth`.
 * @param {number} duration - Duration of the scene, in milliseconds.
 * @param {number} direction - 1 or -1, to make two layers drift apart.
 * @returns {void}
 */
export function parallax(layer, duration, direction = 1) {
  const depth = Number(layer.dataset.depth) || 0;
  if (depth === 0) return;
  animate(
    layer,
    [
      { transform: 'translate3d(0, 0, 0)' },
      { transform: `translate3d(${depth * 22 * direction}px, ${depth * -12}px, 0)` },
    ],
    { duration, easing: 'linear' }
  );
}

/**
 * Shows a white flash over the stage.
 *
 * @param {HTMLElement} flash - The flash layer of the stage.
 * @param {number} [strength=0.85] - Peak opacity.
 * @param {number} [duration=420] - Duration, in milliseconds.
 * @returns {void}
 */
export function flash(flashLayer, strength = 0.85, duration = 420) {
  play(flashLayer, [{ opacity: strength }, { opacity: 0 }], {
    duration,
    easing: 'cubic-bezier(0.1, 0.8, 0.2, 1)',
  });
}

/**
 * Throws a burst of particles from one point of a scene.
 *
 * @param {HTMLElement} container - Scene (or layer) that hosts the particles.
 * @param {object} [options] - Burst options.
 * @param {number} [options.count=24] - Number of particles.
 * @param {number} [options.x=0] - Horizontal origin, in pixels inside the container.
 * @param {number} [options.y=0] - Vertical origin, in pixels inside the container.
 * @param {string[]} [options.colors] - Palette of the particles.
 * @param {number} [options.spread=280] - Maximum distance of the burst.
 * @param {number} [options.size=9] - Base size, in pixels.
 * @param {number} [options.duration=900] - Lifetime, in milliseconds.
 * @param {number} [options.gravity=240] - Downward drift added at the end.
 * @param {string} [options.shape='square'] - `square`, `spark` or `heart`.
 * @param {string} [options.text=''] - Text drawn instead of a shape (hearts).
 * @returns {void}
 */
export function burst(container, options = {}) {
  const {
    count = 24,
    x = 0,
    y = 0,
    colors = ['#ffd54a', '#7fa5ff', '#ffffff', '#f472b6'],
    spread = 280,
    size = 9,
    duration = 900,
    gravity = 240,
    shape = 'square',
    text = '',
  } = options;

  for (let index = 0; index < count; index += 1) {
    const particle = create(
      'span',
      `demo__particle${shape === 'spark' ? ' demo__particle--spark' : ''}${
        shape === 'heart' ? ' demo__particle--heart' : ''
      }`
    );
    if (text !== '') particle.textContent = text;
    particle.style.setProperty('--particle-size', `${Math.round(size * (0.5 + Math.random()))}px`);
    particle.style.setProperty('--particle-color', colors[index % colors.length]);
    particle.style.left = `${x}px`;
    particle.style.top = `${y}px`;
    container.append(particle);

    const angle = Math.random() * Math.PI * 2;
    const distance = spread * (0.25 + Math.random() * 0.75);
    const driftX = Math.cos(angle) * distance;
    const driftY = Math.sin(angle) * distance * 0.7 - 50;
    const animation = particle.animate(
      [
        { transform: 'translate3d(0, 0, 0) scale(1)', opacity: 1 },
        {
          transform: `translate3d(${driftX}px, ${driftY + gravity}px, 0) scale(0.2) rotate(${
            Math.random() * 540
          }deg)`,
          opacity: 0,
        },
      ],
      {
        duration: duration * (0.7 + Math.random() * 0.6),
        easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)',
      }
    );
    animation.onfinish = () => particle.remove();
  }
}

/**
 * Draws a ring that expands from a point of the scene.
 *
 * @param {HTMLElement} container - Scene that hosts the ring.
 * @param {number} x - Horizontal origin, in pixels inside the container.
 * @param {number} y - Vertical origin, in pixels inside the container.
 * @param {string} [color='#ffd54a'] - Colour of the ring.
 * @param {number} [size=520] - Diameter the ring reaches, in pixels.
 * @returns {void}
 */
export function shockwave(container, x, y, color = '#ffd54a', size = 520) {
  const ring = create('span', 'demo__shockwave');
  ring.style.left = `${x}px`;
  ring.style.top = `${y}px`;
  ring.style.borderColor = color;
  container.append(ring);
  const animation = ring.animate(
    [
      { width: '20px', height: '20px', margin: '-10px', opacity: 0.9, borderWidth: '6px' },
      { width: `${size}px`, height: `${size}px`, margin: `${-size / 2}px`, opacity: 0, borderWidth: '1px' },
    ],
    { duration: beat(1.4), easing: 'cubic-bezier(0.1, 0.7, 0.2, 1)' }
  );
  animation.onfinish = () => ring.remove();
}

/**
 * Counts a number into an element, with the locale of the show.
 *
 * @param {HTMLElement} element - Element that receives the number.
 * @param {number} from - Starting value.
 * @param {number} to - Ending value.
 * @param {number} duration - Duration, in milliseconds.
 * @returns {Promise<void>} Resolves once the final value is written.
 */
export function countTo(element, from, to, duration) {
  const format = new Intl.NumberFormat(state.lang === 'fr' ? 'fr-FR' : 'en-US');
  let startTime = null;
  return new Promise((done) => {
    const step = (timestamp) => {
      if (startTime === null) startTime = timestamp;
      const progress = Math.min(1, (timestamp - startTime) / duration);
      const eased = 1 - (1 - progress) ** 3;
      element.textContent = format.format(Math.round(from + (to - from) * eased));
      if (progress < 1) requestAnimationFrame(step);
      else done();
    };
    requestAnimationFrame(step);
  });
}

/**
 * Formats a number the way the show writes them.
 *
 * @param {number} value - Number to format.
 * @returns {string} The formatted number.
 */
export function formatNumber(value) {
  return new Intl.NumberFormat(state.lang === 'fr' ? 'fr-FR' : 'en-US').format(value);
}

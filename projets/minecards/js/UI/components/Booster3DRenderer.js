/**
 * Booster3DRenderer - Three.js booster of the opening view.
 *
 * Reference: `.docs/steps/4.md` point 1 and `css/animations/` (the animation modes).
 *
 * RESPONSIBILITIES
 *   - load a `.glb` model (path from `config.json` -> `boosters.model`) and paint it with the
 *     texture declared by the extension JSON (`BoosterTexture`, e.g. `assets/boosters/A1.png`);
 *   - let the player rotate the booster with the mouse or a finger (drag + inertia);
 *   - expose an "open" gesture: a tap or an upward swipe calls `onOpenStart` (the tear begins)
 *     then `onOpenRequest` once the tear is over;
 *   - play the tear in the flavour of the active animation mode: its duration and its movement come
 *     from `AnimationManager` (`--anim-tear-ms`, the very same number the CSS of the stage uses),
 *     so the WebGL movement, the CSS animation and the comic burst can never drift apart;
 *   - run NON-INTERACTIVE (`interactive: false`) as the preview of the extension picker: the model
 *     then only turns on its own and its texture can be swapped without rebuilding the scene;
 *   - release every GPU resource and stop the render loop as soon as the view is left
 *     (`stop()` / `dispose()`): a background WebGL loop on a phone drains the battery.
 *
 * ROBUSTNESS
 *   Three.js is imported DYNAMICALLY from a pinned CDN (import map declared in `index.html`).
 *   If WebGL is unavailable, or if the import/`.glb`/texture download fails (offline, blocked
 *   host), `init()` resolves to `false` and the opening view falls back to the 2D booster image:
 *   the game stays playable without any 3D support.
 *
 * Logging: every lifecycle step is logged with the `[Booster3DRenderer]` prefix so the console
 * tells exactly which stage failed when the 3D scene does not show up.
 */

import animationManager from '../../utils/AnimationManager.js';

/** Import specifiers resolved by the import map of `index.html`. */
const THREE_MODULE = 'three';
const GLTF_LOADER_MODULE = 'three/addons/loaders/GLTFLoader.js';
const ROOM_ENVIRONMENT_MODULE = 'three/addons/environments/RoomEnvironment.js';

/** Default model, used when the caller does not provide one. */
export const DEFAULT_MODEL_PATH = 'assets/boostermodel.glb';

/**
 * Delay before the studio environment is built, in milliseconds.
 *
 * The reflections are a detail of the lighting: the booster must be on screen first. Building the
 * PMREM (a chain of GPU passes and shader compilations) during `init()` is what made a phone wait
 * after the model was already uploaded, so it is now deferred by a few frames.
 */
const ENVIRONMENT_DELAY_MS = 250;

/**
 * Binary payloads already downloaded in this page, keyed by URL.
 *
 * The select-stage preview, the opening scene and every later booster share the same `.glb` and
 * the same textures: keeping the bytes (and the object URLs made from them) means the second scene
 * never touches the network again, even if the HTTP cache is cold or disabled.
 *
 * @type {Map<string, Promise<ArrayBuffer>>}
 */
const BINARY_CACHE = new Map();

/** Object URLs created from `BINARY_CACHE`, keyed by the source URL. @type {Map<string, Promise<string>>} */
const BLOB_URL_CACHE = new Map();

/**
 * Downloads a file once per page and hands back its bytes.
 *
 * A shared `fetch` also lets several renderers await the same in-flight download instead of
 * starting a second request.
 *
 * @param {string} url - Path of the file.
 * @returns {Promise<ArrayBuffer>} The downloaded bytes.
 * @throws {Error} When the response is not successful.
 */
function fetchBinary(url) {
  const cached = BINARY_CACHE.get(url);
  if (cached) return cached;

  const promise = fetch(url, { credentials: 'same-origin' }).then((response) => {
    if (!response.ok) {
      throw new Error(`Unable to download "${url}" (HTTP ${response.status}).`);
    }
    return response.arrayBuffer();
  });
  BINARY_CACHE.set(url, promise);
  promise.catch(() => BINARY_CACHE.delete(url));
  return promise;
}

/**
 * Downloads an image once per page and returns a local object URL for it.
 *
 * The texture loader then decodes it from memory: the network request overlaps the model and the
 * Three.js modules instead of following them.
 *
 * @param {string} url - Path of the image.
 * @returns {Promise<string>} Object URL of the downloaded image.
 * @throws {Error} When the response is not successful.
 */
function fetchBlobUrl(url) {
  const cached = BLOB_URL_CACHE.get(url);
  if (cached) return cached;

  const promise = fetch(url, { credentials: 'same-origin' })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Unable to download "${url}" (HTTP ${response.status}).`);
      }
      return response.blob();
    })
    .then((blob) => URL.createObjectURL(blob));
  BLOB_URL_CACHE.set(url, promise);
  promise.catch(() => BLOB_URL_CACHE.delete(url));
  return promise;
}

// The opening screen is the default view and always shows the booster: the model starts
// downloading while the rest of the application boots, so the 960 KB no longer sits on the
// critical path of `init()`. The promise is the very one `init()` awaits, so this costs one
// request, not two.
void fetchBinary(DEFAULT_MODEL_PATH).catch(() => {});

/** Radians added per pixel of horizontal drag. */
const DRAG_ROTATION_SPEED = 0.01;

/** Upward swipe distance (pixels) that opens the booster. */
const SWIPE_THRESHOLD_PX = 60;

/** A tap is a short press that did not really move. */
const TAP_MAX_DURATION_MS = 400;
const TAP_MAX_MOVEMENT_PX = 14;

/**
 * Distance of the camera from the booster, i.e. how much the model is zoomed out.
 *
 * The original value was `3.2`; it is 10 % larger here, which shrinks the booster by 10 % in the
 * scene. That compensates the 10 % taller (and 10 % narrower) viewport of `css/components/
 * booster-3d.css`, so the booster keeps the same room around it and never touches the sides.
 */
const CAMERA_DISTANCE = 3.52;

/* ------------------------------------------------------------------------------------------------
 * LIGHTING / MATERIALS
 *
 * The values below are the CLASSIC recipe, used when no render mode was provided (a renderer built
 * by hand) or as the fallback of a mode that omits a value. The shipped recipes live in
 * `settings/config.json` (`boosterRender`) and reach this class through `BoosterRenderManager`:
 * a mode can be switched at runtime without rebuilding the scene.
 * ---------------------------------------------------------------------------------------------- */

/**
 * Classic lighting and material recipe of the booster.
 *
 * `exposure` is the linear tone-mapping exposure, `environmentIntensity` the strength of the studio
 * reflections on each material, then the five lights, the PBR surface, the clearcoat layer (a
 * blister plastic film, 0 disables it), the self-illumination and the multiplier of the normal map
 * baked in the `.glb`.
 */
export const DEFAULT_RENDER_SETTINGS = Object.freeze({
  id: 'classic',
  exposure: 0.94,
  environmentIntensity: 0.9,
  ambient: 1.1,
  key: 1.5,
  rim: 0.9,
  front: 0.25,
  hemisphere: 0.4,
  metalness: 0.25,
  roughness: 0.55,
  clearcoat: 0,
  clearcoatRoughness: 0.4,
  emissive: 0.06,
  normalScale: 1,
});

/**
 * Properties never copied when a standard material is converted to a physical one.
 *
 * They belong to the object identity of the material (`uuid`, `id`, `version`), to its compiled
 * shader (`defines`) or to the previous instance's bookkeeping (`userData`): copying them would
 * either throw or make two materials share state. Every texture, colour, vector and scalar is
 * copied, which is what preserves the normal map baked in the model.
 */
const IGNORED_MATERIAL_KEYS = new Set([
  'uuid',
  'id',
  'type',
  'version',
  'defines',
  'userData',
  'needsUpdate',
]);

export class Booster3DRenderer {
  /**
   * @param {object} options - Renderer options.
   * @param {HTMLElement} options.container - Element receiving the WebGL canvas.
   * @param {string|null} [options.texturePath=null] - Booster texture from the extension JSON.
   * @param {string} [options.modelPath=DEFAULT_MODEL_PATH] - Path of the `.glb` model.
   * @param {() => void|null} [options.onOpenRequest=null] - Called once when the player opens it.
   * @param {() => void|null} [options.onOpenStart=null] - Called as the tear starts (the scene of
   *   the "explosive" mode uses it to fire its comic burst at the exact moment of the blast).
   * @param {boolean} [options.interactive=true] - False for a preview: no drag, no tap and no tear,
   *   so the booster merely turns on its own while the player picks an extension.
   * @param {object|null} [options.renderSettings=null] - Lighting/material recipe of the active
   *   render mode (see `BoosterRenderManager`); the classic recipe is used when omitted.
   * @param {string} [options.label='booster'] - Label used in the logs.
   */
  constructor({
    container,
    texturePath = null,
    modelPath = DEFAULT_MODEL_PATH,
    onOpenRequest = null,
    onOpenStart = null,
    interactive = true,
    renderSettings = null,
    label = 'booster',
  } = {}) {
    if (!container || typeof container.appendChild !== 'function') {
      throw new TypeError('Booster3DRenderer requires a container element.');
    }

    this.container = container;
    this.texturePath = texturePath;
    this.modelPath = modelPath;
    this.onOpenRequest = onOpenRequest;
    this.onOpenStart = onOpenStart;
    this.interactive = interactive !== false;
    this.label = label;
    /** @type {object} Active lighting/material recipe (merged over the classic defaults). */
    this.renderSettings = { ...DEFAULT_RENDER_SETTINGS, ...(renderSettings ?? {}) };
    /** @type {{ambient?: object, key?: object, rim?: object, front?: object, hemisphere?: object}}
     *   Lights kept by reference so a mode switch only changes their intensity. */
    this.lights = {};

    /** @type {object|null} Dynamically imported `three` namespace. */
    this.THREE = null;
    /** @type {object|null} Loaded GLTF scene. */
    this.model = null;
    /** @type {object|null} Group holding the model (rotated by the player). */
    this.pivot = null;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.resizeObserver = null;

    /** @type {number|null} requestAnimationFrame handle. */
    this.frameHandle = null;
    /** @type {boolean} True while the loop must run. */
    this.isRunning = false;
    /** @type {boolean} True when the player already asked to open the booster. */
    this.openRequested = false;
    /** @type {boolean} True while the tear animation plays. */
    this.isTearing = false;
    /** @type {boolean} True when WebGL + Three.js are usable. */
    this.isAvailable = false;

    /** @type {{x: number, y: number}|null} Last pointer position. */
    this.pointerStart = null;
    /** @type {number} Timestamp of the pointer down. */
    this.pointerStartTime = 0;
    /** @type {number} Accumulated horizontal drag. */
    this.dragOffset = 0;
    /** @type {number} Current angular velocity used for the inertia. */
    this.spinVelocity = 0;
    /** @type {number} Elapsed time of the tear animation. */
    this.tearElapsed = 0;
    /** @type {number} Duration of the current tear, read from the animation mode. */
    this.tearDurationMs = animationManager.getTiming().tearMs;
    /** @type {string} Animation mode the current tear plays in. */
    this.tearMode = animationManager.getMode();

    /** @type {Array<{target: EventTarget, type: string, handler: EventListener}>} Bound listeners. */
    this.bindings = [];
    /** @type {Promise<object>|null} In-flight import of the studio environment module. */
    this.environmentPromise = null;
    /** @type {number|null} Timer deferring the environment pass out of the first frames. */
    this.environmentTimer = null;
  }

  /**
   * Logs with the renderer prefix, so the console shows which booster failed.
   *
   * @param {...unknown} args - Values forwarded to `console.info`.
   * @returns {void}
   */
  log(...args) {
    console.info(`[Booster3DRenderer:${this.label}]`, ...args);
  }

  /**
   * Checks that a WebGL context can be created.
   *
   * @returns {boolean} True when WebGL is available.
   */
  static isWebGLAvailable() {
    try {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      return Boolean(context);
    } catch (error) {
      console.warn('[Booster3DRenderer] WebGL probe failed.', error);
      return false;
    }
  }

  /**
   * Loads Three.js, the model and the texture, then prepares the scene.
   *
   * Never throws: any failure (no WebGL, CDN blocked, missing `.glb`) resolves to `false` so the
   * caller can display the 2D fallback.
   *
   * @returns {Promise<boolean>} True when the 3D scene is ready to be started.
   */
  async init() {
    if (this.isAvailable) return true;

    if (!Booster3DRenderer.isWebGLAvailable()) {
      console.warn(`[Booster3DRenderer:${this.label}] WebGL is unavailable: 2D fallback.`);
      return false;
    }

    try {
      // Every download starts here, at the SAME time: the pinned Three.js modules, the `.glb` and
      // the texture of the set. Awaiting them one after the other (three, the loader, the
      // environment, the model, the texture) added one network round trip per step - the very
      // thing that made a phone feel slow while a stripped-down prototype stayed quick. On a
      // remote connection the whole payload now travels in a single wave.
      this.log('loading the 3D payload…');
      const threePromise = import(THREE_MODULE);
      const gltfPromise = import(GLTF_LOADER_MODULE);
      const modelPromise = fetchBinary(this.modelPath);
      const texturePromise = this.texturePath ? fetchBlobUrl(this.texturePath) : null;
      // Always fetched, even when the active recipe asks for no reflection: another mode can be
      // selected afterwards, and the module travels with Three.js anyway. Never awaited here: the
      // reflections land after the booster.
      this.environmentPromise = import(ROOM_ENVIRONMENT_MODULE);

      this.THREE = await threePromise;
      const { GLTFLoader } = await gltfPromise;
      this.log(`Three.js r${this.THREE.REVISION ?? '?'} ready.`);

      this.buildScene();
      await this.loadModel(GLTFLoader, await modelPromise);
      await this.applyTexture(texturePromise ? await texturePromise : null);
      this.tuneMaterials();

      this.isAvailable = true;
      this.log('3D scene ready.', { model: this.modelPath, texture: this.texturePath ?? 'none' });
      this.scheduleEnvironment();
      return true;
    } catch (error) {
      console.error(`[Booster3DRenderer:${this.label}] 3D initialization failed: 2D fallback.`, error);
      this.dispose();
      return false;
    }
  }

  /**
   * Creates the renderer, the camera, the lights and the pivot group.
   *
   * @returns {void}
   * @throws {Error} When the WebGL renderer cannot be created.
   */
  buildScene() {
    const THREE = this.THREE;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    // `updateStyle: false` on purpose: the canvas is sized by the stylesheet
    // (`.booster-3d__viewport canvas { width: 100%; height: 100% }`). Letting Three write an
    // inline width/height here would freeze the size of the PREVIEW container on the canvas, and
    // moving that canvas to the opening viewport (`adopt()`) would leave it small and pinned to the
    // left instead of filling the new stage.
    this.renderer.setSize(
      this.container.clientWidth || 320,
      this.container.clientHeight || 320,
      false
    );
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    this.camera.position.set(0, 0.2, CAMERA_DISTANCE);

    // Linear tone mapping: its only effect is the exposure multiplier, colours stay untouched.
    this.renderer.toneMapping = THREE.LinearToneMapping;

    const { ambient, key, rim, front, hemisphere } = this.renderSettings;
    this.lights.ambient = new THREE.AmbientLight(0xffffff, ambient);
    this.scene.add(this.lights.ambient);

    this.lights.key = new THREE.DirectionalLight(0xffffff, key);
    this.lights.key.position.set(2, 3, 4);
    this.scene.add(this.lights.key);

    this.lights.rim = new THREE.DirectionalLight(0xffffff, rim);
    this.lights.rim.position.set(-3, -1, -2);
    this.scene.add(this.lights.rim);

    // The two fill lights are ALWAYS created, at whatever intensity the recipe asks for (0 = off):
    // a mode switch has to be able to turn them back on without rebuilding the scene.
    this.lights.front = new THREE.DirectionalLight(0xffffff, front);
    this.lights.front.position.set(0, 0.5, 5);
    this.scene.add(this.lights.front);

    this.lights.hemisphere = new THREE.HemisphereLight(0xffffff, 0xbbbbcc, hemisphere);
    this.scene.add(this.lights.hemisphere);
    this.applyLighting();

    this.pivot = new THREE.Group();
    this.scene.add(this.pivot);

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.container);
    this.handleResize();

    this.log('Scene built.');
  }

  /**
   * Defers the studio environment out of the loading path.
   *
   * The pass is a chain of GPU renders (PMREM) that can take a few hundred milliseconds on a
   * phone: the booster is shown first, the reflections follow.
   *
   * @returns {void}
   */
  scheduleEnvironment() {
    if (!this.environmentPromise || this.environmentTimer !== null) return;
    this.environmentTimer = window.setTimeout(() => {
      this.environmentTimer = null;
      void this.buildEnvironment();
    }, ENVIRONMENT_DELAY_MS);
  }

  /**
   * Generates a neutral studio environment (`RoomEnvironment`) used for the reflections.
   *
   * Without it, metallic materials reflect nothing and look almost black. A failure is not fatal:
   * the booster is then lit by the lights only.
   *
   * @returns {Promise<void>} Resolves once the environment is set (or skipped).
   */
  async buildEnvironment() {
    if (!this.scene || !this.renderer) return;

    try {
      const source = this.environmentPromise ?? import(ROOM_ENVIRONMENT_MODULE);
      const { RoomEnvironment } = await source;
      // The scene may have been disposed while the module was in flight.
      if (!this.scene || !this.renderer) return;
      const pmrem = new this.THREE.PMREMGenerator(this.renderer);
      const environment = new RoomEnvironment();
      this.scene.environment = pmrem.fromScene(environment, 0.04).texture;
      // `scene.environmentIntensity` needs Three.js r163+, while the pinned build is older: the
      // strength is ALSO written on each material (`envMapIntensity`), which is what actually
      // drives the reflection of this renderer. The scene property is kept for a future upgrade.
      this.scene.environmentIntensity = this.renderSettings.environmentIntensity;
      this.applyEnvironmentIntensity();
      environment.dispose?.();
      pmrem.dispose();
      this.log(
        `Studio environment ready (intensity: ${this.renderSettings.environmentIntensity}).`
      );
    } catch (error) {
      console.warn(`[Booster3DRenderer:${this.label}] Environment unavailable, lights only.`, error);
    }
  }

  /**
   * Brightens the model materials: less metal, less gloss, and a light self-illumination taken
   * from the texture. Safe to call several times (e.g. after a texture swap).
   *
   * @returns {void}
   */
  tuneMaterials() {
    if (!this.model || !this.THREE) return;

    const THREE = this.THREE;
    const settings = this.renderSettings;
    let tuned = 0;
    let normalMapped = 0;

    this.model.traverse((child) => {
      if (!child.isMesh) return;
      const isArray = Array.isArray(child.material);
      const materials = isArray ? child.material : [child.material];

      const nextMaterials = materials.map((material) => {
        if (!material) return material;

        // A clearcoat only exists on `MeshPhysicalMaterial`: the standard material of the `.glb`
        // is converted when a recipe asks for it, and stays physical afterwards (clearcoat 0 is
        // simply a disabled layer). Every texture, including the normal map, is carried over.
        const tunedMaterial =
          settings.clearcoat > 0 ? this.ensurePhysicalMaterial(material) : material;

        if (typeof tunedMaterial.metalness === 'number') {
          tunedMaterial.metalness = settings.metalness;
        }
        if (typeof tunedMaterial.roughness === 'number') {
          tunedMaterial.roughness = settings.roughness;
        }
        if ('envMapIntensity' in tunedMaterial) {
          tunedMaterial.envMapIntensity = settings.environmentIntensity;
        }
        if ('clearcoat' in tunedMaterial) {
          tunedMaterial.clearcoat = settings.clearcoat;
          tunedMaterial.clearcoatRoughness = settings.clearcoatRoughness;
        }

        // The normal map baked in the `.glb` (tangent-space, authored at a small scale) is kept
        // exactly as the loader built it: the mode only multiplies its authored scale. The first
        // authored value is remembered on the material so repeated switches never compound.
        if (tunedMaterial.normalMap && tunedMaterial.normalScale) {
          if (!tunedMaterial.userData) tunedMaterial.userData = {};
          if (!tunedMaterial.userData.boosterBaseNormalScale) {
            tunedMaterial.userData.boosterBaseNormalScale = {
              x: tunedMaterial.normalScale.x,
              y: tunedMaterial.normalScale.y,
            };
          }
          const base = tunedMaterial.userData.boosterBaseNormalScale;
          tunedMaterial.normalScale.set(
            base.x * settings.normalScale,
            base.y * settings.normalScale
          );
          normalMapped += 1;
        }

        if ('emissive' in tunedMaterial) {
          if (settings.emissive > 0) {
            if (tunedMaterial.map) {
              tunedMaterial.emissive = new THREE.Color(0xffffff);
              tunedMaterial.emissiveMap = tunedMaterial.map;
            } else {
              // No texture: glow with the base colour instead of a flat white.
              tunedMaterial.emissive = tunedMaterial.color
                ? tunedMaterial.color.clone()
                : new THREE.Color(0x000000);
              tunedMaterial.emissiveMap = null;
            }
            tunedMaterial.emissiveIntensity = settings.emissive;
          } else {
            tunedMaterial.emissive = new THREE.Color(0x000000);
            tunedMaterial.emissiveMap = null;
            tunedMaterial.emissiveIntensity = 0;
          }
        }

        tunedMaterial.needsUpdate = true;
        tuned += 1;
        return tunedMaterial;
      });

      child.material = isArray ? nextMaterials : nextMaterials[0];
    });

    if (tuned > 0) {
      this.log(
        `Materials tuned (${tuned} material(s), ${normalMapped} normal map(s), ` +
          `mode: ${settings.id ?? 'custom'}).`
      );
    }
  }

  /**
   * Applies the active recipe to the lights and to the tone mapping.
   *
   * The lights are held by reference, so switching a mode never rebuilds the scene: only their
   * intensity (and the exposure) changes. Safe to call before the scene exists.
   *
   * @returns {void}
   */
  applyLighting() {
    if (!this.renderer) return;
    const settings = this.renderSettings;
    this.renderer.toneMappingExposure = settings.exposure;
    if (this.scene) {
      this.scene.environmentIntensity = settings.environmentIntensity;
    }

    const { ambient, key, rim, front, hemisphere } = this.lights;
    if (ambient) ambient.intensity = settings.ambient;
    if (key) key.intensity = settings.key;
    if (rim) rim.intensity = settings.rim;
    if (front) front.intensity = settings.front;
    if (hemisphere) hemisphere.intensity = settings.hemisphere;
  }

  /**
   * Writes the reflection strength of the active recipe on every material.
   *
   * `MeshStandardMaterial.envMapIntensity` is what the pinned Three.js build actually reads: the
   * `scene.environmentIntensity` property of the newest versions is kept for a future upgrade, but
   * it is not enough on its own today.
   *
   * @returns {void}
   */
  applyEnvironmentIntensity() {
    if (!this.model) return;
    const intensity = this.renderSettings.environmentIntensity;
    this.model.traverse((child) => {
      if (!child.isMesh) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        if (material && 'envMapIntensity' in material) {
          material.envMapIntensity = intensity;
        }
      });
    });
  }

  /**
   * Converts a material to `MeshPhysicalMaterial` so it can carry a clearcoat layer.
   *
   * Three.js has no `MeshPhysicalMaterial` variant of `MeshStandardMaterial.clone()`: the new
   * material is built property by property. Textures (map, normalMap, emissiveMap, the PBR maps),
   * colours and vectors are copied, while the identity, the compiled defines and the bookkeeping of
   * the previous object are not. The old material is disposed (its textures are untouched).
   *
   * @param {object} material - A material of the loaded model.
   * @returns {object} The same material when it is already physical, a physical copy otherwise.
   */
  ensurePhysicalMaterial(material) {
    const THREE = this.THREE;
    if (!material || material.isMeshPhysicalMaterial || !THREE?.MeshPhysicalMaterial) {
      return material;
    }

    const physical = new THREE.MeshPhysicalMaterial();
    Object.keys(material).forEach((key) => {
      if (IGNORED_MATERIAL_KEYS.has(key) || key.startsWith('_')) return;
      if (!(key in physical)) return;
      const value = material[key];
      if (typeof value === 'function') return;

      // Clone the small value objects: sharing a colour or a vector between two materials would
      // make a later tuning of one visible on the other.
      if (value?.isColor || value?.isVector2 || value?.isVector3 || value?.isVector4) {
        physical[key] = value.clone();
        return;
      }
      try {
        physical[key] = value;
      } catch (error) {
        console.warn(`[Booster3DRenderer:${this.label}] Material property "${key}" skipped.`, error);
      }
    });

    // Kept on purpose: it holds the authored normal scale remembered by `tuneMaterials()`.
    physical.userData = { ...(material.userData ?? {}) };
    physical.name = material.name;
    physical.needsUpdate = true;
    material.dispose?.();
    return physical;
  }

  /**
   * Applies another lighting/material recipe to the live scene.
   *
   * Called when the developer render picker changes the mode: the lights, the exposure and every
   * material are retuned, while the geometry and the textures stay uploaded. Safe to call before
   * `init()` (the recipe is kept and used when the scene is built).
   *
   * @param {object|null} [settings=null] - Recipe to apply, or null to reset to the classic one.
   * @returns {object} The applied recipe.
   */
  setRenderSettings(settings = null) {
    this.renderSettings = { ...DEFAULT_RENDER_SETTINGS, ...(settings ?? {}) };
    if (!this.isAvailable) return this.renderSettings;

    this.applyLighting();
    this.tuneMaterials();
    this.log(`Render mode "${this.renderSettings.id ?? 'custom'}" applied.`);
    return this.renderSettings;
  }

  /**
   * Loads the `.glb` model into the pivot group.
   *
   * @param {new (manager?: object) => object} GLTFLoader - Loader class from the Three.js addons.
   * @param {ArrayBuffer} buffer - Bytes of the `.glb`, downloaded by `fetchBinary`.
   * @returns {Promise<void>} Resolves once the model is added to the scene.
   * @throws {Error} When the model cannot be parsed.
   */
  async loadModel(GLTFLoader, buffer) {
    this.log(`parsing model "${this.modelPath}"…`);
    const loader = new GLTFLoader();
    const gltf = await this.parseModel(loader, buffer);

    let meshCount = 0;
    gltf.scene.traverse((child) => {
      if (child.isMesh) {
        meshCount += 1;
      }
    });
    if (meshCount === 0) {
      throw new Error(`The model "${this.modelPath}" contains no mesh.`);
    }

    this.model = gltf.scene;

    // Redressement du modèle source
    this.model.rotation.set(1.522, 4.75, 0);

    this.pivot.add(this.model);
    this.log(`Model loaded (${meshCount} mesh(es)).`);
  }

  /**
   * Parses a `.glb` already in memory.
   *
   * `parseAsync` is the r160 API; the explicit Promise keeps an older pinned build working.
   *
   * @param {object} loader - `GLTFLoader` instance.
   * @param {ArrayBuffer} buffer - Bytes of the model.
   * @returns {Promise<object>} The parsed glTF payload.
   */
  parseModel(loader, buffer) {
    if (typeof loader.parseAsync === 'function') {
      return loader.parseAsync(buffer, '');
    }
    return new Promise((resolve, reject) => {
      loader.parse(buffer, '', resolve, reject);
    });
  }

  /**
   * Applies the texture declared by the extension JSON to the model materials.
   *
   * The `.glb` may already carry its own texture: in that case the JSON texture overrides it, as
   * required by `.docs/steps/4.md` ("texture issue du JSON du set"). A missing or failing texture
   * is not fatal, the model keeps its baked material.
   *
   * @param {string|null} [preloadedUrl=null] - Object URL of a texture already downloaded, used
   *   instead of a second request to `this.texturePath`.
   * @returns {Promise<void>} Resolves once the texture is applied (or skipped).
   */
  async applyTexture(preloadedUrl = null) {
    if (!this.texturePath && !preloadedUrl) {
      this.log('No texture declared by the extension JSON: keeping the model material.');
      return;
    }

    const THREE = this.THREE;
    try {
      const texture = await new THREE.TextureLoader().loadAsync(preloadedUrl ?? this.texturePath);
      texture.colorSpace = THREE.SRGBColorSpace;
      this.texture = texture;

      let applied = 0;
      this.model.traverse((child) => {
        if (!child.isMesh) return;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((material) => {
          if (material && 'map' in material) {
            material.map = texture;
            material.needsUpdate = true;
            applied += 1;
          }
        });
      });
      this.tuneMaterials();
      this.log(`Texture "${this.texturePath}" applied to ${applied} material(s).`);
    } catch (error) {
      console.warn(`[Booster3DRenderer:${this.label}] Texture "${this.texturePath}" unavailable.`, error);
    }
  }

  /**
   * Swaps the booster texture without rebuilding the scene (used by the extension picker preview).
   *
   * The previous texture is released only once the new one is in place, so a texture that fails to
   * load leaves the model as it was instead of turning it blank.
   *
   * @param {string|null} texturePath - Texture of the newly selected extension, or null.
   * @returns {Promise<boolean>} True when a texture was applied.
   */
  async setTexture(texturePath) {
    if (!this.isAvailable) return false;
    const next = texturePath ?? null;
    if (next === this.texturePath) return false;

    const previous = this.texture ?? null;
    this.texturePath = next;
    this.texture = null;
    const preloaded = next ? await fetchBlobUrl(next) : null;
    await this.applyTexture(preloaded);

    if (this.texture && previous) {
      previous.dispose?.();
    } else if (!this.texture) {
      // The new texture could not be loaded: how far the materials got is unknown, so the previous
      // one is restored on every material that still carries it.
      this.texture = previous;
    }
    this.log(`Texture switched to "${this.texturePath ?? 'none'}".`);
    return Boolean(this.texture);
  }

  /**
   * Returns the stage element carrying the state classes (`is-tearing`, `is-dismissed`,
   * `is-fallback`): the closest `.booster-3d` ancestor, or the container itself.
   *
   * @returns {HTMLElement} Stage element.
   */
  getStageElement() {
    return this.container?.closest?.('.booster-3d') ?? this.container;
  }

  /**
   * Starts the render loop and binds the interaction listeners (none in preview mode).
   *
   * Called every time the opening view becomes active; a second call while running is ignored.
   *
   * @returns {void}
   */
  start() {
    if (!this.isAvailable) {
      this.log('start() ignored: the 3D scene is not available.');
      return;
    }
    if (this.isRunning) return;

    this.isRunning = true;
    if (this.interactive) {
      this.bindInteractions();
    }
    this.resizeObserver?.observe(this.container);
    this.log('Render loop started.');
    this.loop();
  }

  /**
   * Stops the render loop and releases the interaction listeners (battery friendly).
   *
   * @returns {void}
   */
  stop() {
    if (this.frameHandle !== null) {
      cancelAnimationFrame(this.frameHandle);
      this.frameHandle = null;
    }
    if (this.isRunning) {
      this.log('Render loop stopped.');
    }
    this.isRunning = false;
    this.unbindInteractions();
  }

  /**
   * Returns whether the scene is currently animating.
   *
   * @returns {boolean} True while the render loop runs.
   */
  getIsRunning() {
    return this.isRunning;
  }

  /**
   * Runs one frame: automatic spin, drag inertia and the tear animation.
   *
   * @returns {void}
   */
  loop() {
    if (!this.isRunning) return;

    const delta = 1 / 60;
    if (this.isTearing) {
      this.tearElapsed += delta * 1000;
      const progress = Math.min(1, this.tearElapsed / this.tearDurationMs);
      const eased = 1 - (1 - progress) ** 3;
      this.playTearMotion(progress, eased);

      if (progress >= 1) {
        this.log('Tear animation finished.');
        this.getStageElement()?.classList?.add('is-dismissed');
        this.stop();
        if (typeof this.onOpenRequest === 'function') {
          this.onOpenRequest();
        }
        return;
      }
    } else {
      // Idle: slow automatic rotation plus the inertia of the last drag.
      this.pivot.rotation.y += this.spinVelocity + 0.004;
      this.spinVelocity *= 0.94;
      if (Math.abs(this.spinVelocity) < 0.0005) {
        this.spinVelocity = 0;
      }
    }

    this.renderer?.render(this.scene, this.camera);
    this.frameHandle = requestAnimationFrame(() => this.loop());
  }

  /**
   * Moves the booster for the current frame of the tear, in the flavour of the active mode.
   *
   * The three modes only differ by those numbers: the CSS of the stage (`.booster-3d.is-tearing`)
   * reads the same duration and draws the fades, the flash and the comic burst.
   *
   * @param {number} progress - Progress of the animation, in [0, 1].
   * @param {number} eased - Cubically eased progress.
   * @returns {void}
   */
  playTearMotion(progress, eased) {
    if (!this.pivot) return;
    const elapsed = this.tearElapsed;

    switch (this.tearMode) {
      case 'epic':
        // A slow, wide take-off: the booster rises high while turning on itself.
        this.pivot.rotation.y += 0.2;
        this.pivot.rotation.z = Math.sin(progress * Math.PI) * 0.12;
        this.pivot.position.y = eased * 2.2;
        this.pivot.position.x = 0;
        this.pivot.scale.setScalar(1 + eased * 0.45);
        return;

      case 'explosive':
        // Deliberately ridiculous: the booster is shaken, spun and launched out of the frame.
        this.pivot.rotation.y += 0.5;
        this.pivot.rotation.x = Math.sin(elapsed * 0.03) * 0.4;
        this.pivot.rotation.z = Math.sin(elapsed * 0.045) * 0.5;
        this.pivot.position.x = Math.sin(elapsed * 0.02) * 0.35;
        this.pivot.position.y = eased * 2.8;
        this.pivot.scale.setScalar(1 + eased * 0.6 * (1 + progress));
        return;

      default:
        // "normal": the original take-off (a light spin, a short rise, a small zoom).
        this.pivot.rotation.y += 0.12;
        this.pivot.position.y = eased * 1.2;
        this.pivot.scale.setScalar(1 + eased * 0.25);
    }
  }

  /**
   * Binds the pointer listeners used to rotate and open the booster.
   *
   * @returns {void}
   */
  bindInteractions() {
    if (this.bindings.length > 0) return;
    const target = this.container;
    this.bind(target, 'pointerdown', (event) => this.handlePointerDown(event));
    this.bind(target, 'pointermove', (event) => this.handlePointerMove(event));
    this.bind(target, 'pointerup', (event) => this.handlePointerUp(event));
    this.bind(target, 'pointercancel', () => this.handlePointerCancel());
    this.bind(target, 'pointerleave', () => this.handlePointerCancel());
  }

  /**
   * Registers one listener and remembers it for `unbindInteractions()`.
   *
   * @param {EventTarget} target - Event target.
   * @param {string} type - Event type.
   * @param {EventListener} handler - Listener.
   * @returns {void}
   */
  bind(target, type, handler) {
    target.addEventListener(type, handler);
    this.bindings.push({ target, type, handler });
  }

  /**
   * Removes every interaction listener.
   *
   * @returns {void}
   */
  unbindInteractions() {
    this.bindings.forEach(({ target, type, handler }) => target.removeEventListener(type, handler));
    this.bindings = [];
  }

  /**
   * Handles the beginning of a drag or tap.
   *
   * @param {PointerEvent} event - Pointer event.
   * @returns {void}
   */
  handlePointerDown(event) {
    if (!this.isRunning || this.isTearing) return;
    this.pointerStart = { x: event.clientX, y: event.clientY };
    this.pointerStartTime = performance.now();
    this.dragOffset = 0;
  }

  /**
   * Rotates the booster while dragging.
   *
   * @param {PointerEvent} event - Pointer event.
   * @returns {void}
   */
  handlePointerMove(event) {
    if (!this.pointerStart || !this.pivot) return;

    const deltaX = event.clientX - this.pointerStart.x;
    const deltaY = event.clientY - this.pointerStart.y;
    this.pivot.rotation.y += deltaX * DRAG_ROTATION_SPEED;
    this.pivot.rotation.x = Math.max(-0.6, Math.min(0.6, this.pivot.rotation.x + deltaY * 0.003));

    this.dragOffset += deltaX;
    this.spinVelocity = deltaX * DRAG_ROTATION_SPEED * 0.08;
    this.pointerStart = { x: event.clientX, y: event.clientY };
  }

  /**
   * Ends a drag: a tap or an upward swipe opens the booster.
   *
   * @param {PointerEvent} event - Pointer event.
   * @returns {void}
   */
  handlePointerUp(event) {
    if (!this.pointerStart) return;

    const duration = performance.now() - this.pointerStartTime;
    const deltaX = event.clientX - this.pointerStart.x;
    const deltaY = event.clientY - this.pointerStart.y;
    this.pointerStart = null;

    if (deltaY < -SWIPE_THRESHOLD_PX) {
      this.log('Upward swipe detected: opening the booster.');
      this.requestOpen();
      return;
    }

    const isTap =
      Math.abs(deltaX) < TAP_MAX_MOVEMENT_PX &&
      Math.abs(deltaY) < TAP_MAX_MOVEMENT_PX &&
      duration < TAP_MAX_DURATION_MS;
    if (isTap) {
      this.log('Tap detected: opening the booster.');
      this.requestOpen();
    }
  }

  /**
   * Cancels an in-progress drag (pointer left the area).
   *
   * @returns {void}
   */
  handlePointerCancel() {
    this.pointerStart = null;
  }

  /**
   * Starts the tear animation. Ignored when it already played.
   *
   * @returns {boolean} True when the animation was started.
   */
  requestOpen() {
    if (!this.interactive || this.openRequested || this.isTearing) return false;

    this.openRequested = true;
    this.isTearing = true;
    this.tearElapsed = 0;
    // Read the mode NOW: a switch made in the settings during the animation must not retime a tear
    // that is already running.
    this.tearMode = animationManager.getMode();
    this.tearDurationMs = animationManager.getTiming().tearMs;
    this.getStageElement()?.classList?.add('is-tearing');
    if (typeof this.onOpenStart === 'function') {
      this.onOpenStart();
    }
    this.log(`Tear animation started (mode: ${this.tearMode}, ${this.tearDurationMs}ms).`);
    return true;
  }

  /**
   * Turns the picker preview into the interactive booster of the opening, without rebuilding it.
   *
   * The preview and the opening scene show the same model and the same texture: downloading,
   * parsing and uploading them again when the player pressed "Open" was the largest remaining cost
   * of the flow. The scene is moved to the new viewport instead, so the canvas, the geometry and
   * the GPU textures are reused as they are.
   *
   * @param {object} options - Adoption options.
   * @param {HTMLElement} options.container - Viewport that must host the canvas.
   * @param {() => void|null} [options.onOpenStart=null] - Tear-start callback.
   * @param {() => void|null} [options.onOpenRequest=null] - Reveal callback.
   * @returns {boolean} True when the scene was adopted.
   */
  adopt({ container, onOpenStart = null, onOpenRequest = null } = {}) {
    if (!this.isAvailable || !this.renderer || !container || typeof container.appendChild !== 'function') {
      return false;
    }
    this.unbindInteractions();
    this.resizeObserver?.unobserve(this.container);
    // Cleared on the PREVIOUS stage element, before the canvas moves.
    this.getStageElement()?.classList?.remove('is-tearing', 'is-dismissed', 'is-fallback');
    this.container = container;
    container.appendChild(this.renderer.domElement);
    this.interactive = true;
    this.openRequested = false;
    this.isTearing = false;
    this.spinVelocity = 0;
    this.pointerStart = null;
    this.tearElapsed = 0;
    this.onOpenStart = onOpenStart;
    this.onOpenRequest = onOpenRequest;
    this.resizeObserver?.observe(container);
    this.handleResize();
    if (this.isRunning) this.bindInteractions();
    this.log('Scene adopted by the opening stage.');
    return true;
  }

  /**
   * Adapts the renderer to the container size.
   *
   * @returns {void}
   */
  handleResize() {
    if (!this.renderer || !this.camera) return;

    const width = this.container.clientWidth || 320;
    const height = this.container.clientHeight || 320;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Releases every GPU resource and listener. The renderer becomes usable again by calling
   * `init()` (used when the player comes back to the opening view).
   *
   * @returns {void}
   */
  dispose() {
    this.stop();
    this.unbindInteractions();
    if (this.environmentTimer !== null) {
      window.clearTimeout(this.environmentTimer);
      this.environmentTimer = null;
    }
    this.environmentPromise = null;
    this.getStageElement()?.classList?.remove('is-tearing', 'is-dismissed');
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    this.model?.traverse((child) => {
      if (!child.isMesh) return;
      child.geometry?.dispose?.();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        Object.values(material ?? {}).forEach((value) => {
          if (value && value.isTexture) value.dispose();
        });
        material?.dispose?.();
      });
    });
    this.texture?.dispose?.();
    this.texture = null;
    this.model = null;
    this.pivot = null;
    this.scene = null;

    if (this.renderer) {
      this.renderer.dispose?.();
      this.renderer.domElement?.remove();
      this.renderer = null;
    }

    this.camera = null;
    this.isAvailable = false;
    this.isTearing = false;
    this.openRequested = false;
    this.log('Resources released.');
  }
}

export default Booster3DRenderer;

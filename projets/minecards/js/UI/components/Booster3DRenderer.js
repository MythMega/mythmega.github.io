/**
 * Booster3DRenderer - Three.js booster of the opening view.
 *
 * Reference: `.docs/steps/4.md` point 1.
 *
 * RESPONSIBILITIES
 *   - load a `.glb` model (path from `config.json` -> `boosters.model`) and paint it with the
 *     texture declared by the extension JSON (`BoosterTexture`, e.g. `assets/boosters/A1.png`);
 *   - let the player rotate the booster with the mouse or a finger (drag + inertia);
 *   - expose an "open" gesture: a tap or an upward swipe calls the `onOpenRequest` callback once,
 *     after playing the tear animation;
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

/** Import specifiers resolved by the import map of `index.html`. */
const THREE_MODULE = 'three';
const GLTF_LOADER_MODULE = 'three/addons/loaders/GLTFLoader.js';

/** Default model, used when the caller does not provide one. */
export const DEFAULT_MODEL_PATH = 'assets/boostermodel.glb';

/** Radians added per pixel of horizontal drag. */
const DRAG_ROTATION_SPEED = 0.01;

/** Upward swipe distance (pixels) that opens the booster. */
const SWIPE_THRESHOLD_PX = 60;

/** A tap is a short press that did not really move. */
const TAP_MAX_DURATION_MS = 400;
const TAP_MAX_MOVEMENT_PX = 14;

/** Duration of the tear ("open") animation, in milliseconds. */
const TEAR_DURATION_MS = 700;

/**
 * Distance of the camera from the booster, i.e. how much the model is zoomed out.
 *
 * The original value was `3.2`; it is 10 % larger here, which shrinks the booster by 10 % in the
 * scene. That compensates the 10 % taller (and 10 % narrower) viewport of `css/components/
 * booster-3d.css`, so the booster keeps the same room around it and never touches the sides.
 */
const CAMERA_DISTANCE = 3.52;

export class Booster3DRenderer {
  /**
   * @param {object} options - Renderer options.
   * @param {HTMLElement} options.container - Element receiving the WebGL canvas.
   * @param {string|null} [options.texturePath=null] - Booster texture from the extension JSON.
   * @param {string} [options.modelPath=DEFAULT_MODEL_PATH] - Path of the `.glb` model.
   * @param {() => void|null} [options.onOpenRequest=null] - Called once when the player opens it.
   * @param {boolean} [options.interactive=true] - False for a preview: no drag, no tap and no tear,
   *   so the booster merely turns on its own while the player picks an extension.
   * @param {string} [options.label='booster'] - Label used in the logs.
   */
  constructor({
    container,
    texturePath = null,
    modelPath = DEFAULT_MODEL_PATH,
    onOpenRequest = null,
    interactive = true,
    label = 'booster',
  } = {}) {
    if (!container || typeof container.appendChild !== 'function') {
      throw new TypeError('Booster3DRenderer requires a container element.');
    }

    this.container = container;
    this.texturePath = texturePath;
    this.modelPath = modelPath;
    this.onOpenRequest = onOpenRequest;
    this.interactive = interactive !== false;
    this.label = label;

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

    /** @type {Array<{target: EventTarget, type: string, handler: EventListener}>} Bound listeners. */
    this.bindings = [];
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
      this.log('importing Three.js…');
      this.THREE = await import(THREE_MODULE);
      const { GLTFLoader } = await import(GLTF_LOADER_MODULE);
      this.log(`Three.js r${this.THREE.REVISION ?? '?'} ready.`);

      this.buildScene();
      await this.loadModel(GLTFLoader);
      await this.applyTexture();

      this.isAvailable = true;
      this.log('3D scene ready.', { model: this.modelPath, texture: this.texturePath ?? 'none' });
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
    this.renderer.setSize(this.container.clientWidth || 320, this.container.clientHeight || 320);
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    this.camera.position.set(0, 0.2, CAMERA_DISTANCE);

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.4);
    keyLight.position.set(2, 3, 4);
    this.scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0xffffff, 0.7);
    rimLight.position.set(-3, -1, -2);
    this.scene.add(rimLight);

    this.pivot = new THREE.Group();
    this.scene.add(this.pivot);

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.container);
    this.handleResize();

    this.log('Scene built.');
  }

  /**
   * Loads the `.glb` model into the pivot group.
   *
   * @param {new (manager?: object) => object} GLTFLoader - Loader class from the Three.js addons.
   * @returns {Promise<void>} Resolves once the model is added to the scene.
   * @throws {Error} When the model cannot be loaded.
   */
  /**
   * Loads the `.glb` model into the pivot group.
   *
   * @param {new (manager?: object) => object} GLTFLoader - Loader class from the Three.js addons.
   * @returns {Promise<void>} Resolves once the model is added to the scene.
   * @throws {Error} When the model cannot be loaded.
   */
  async loadModel(GLTFLoader) {
    this.log(`loading model "${this.modelPath}"…`);
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(this.modelPath);

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
   * Applies the texture declared by the extension JSON to the model materials.
   *
   * The `.glb` may already carry its own texture: in that case the JSON texture overrides it, as
   * required by `.docs/steps/4.md` ("texture issue du JSON du set"). A missing or failing texture
   * is not fatal, the model keeps its baked material.
   *
   * @returns {Promise<void>} Resolves once the texture is applied (or skipped).
   */
  async applyTexture() {
    if (!this.texturePath) {
      this.log('No texture declared by the extension JSON: keeping the model material.');
      return;
    }

    const THREE = this.THREE;
    try {
      const texture = await new THREE.TextureLoader().loadAsync(this.texturePath);
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
    await this.applyTexture();

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
      const progress = Math.min(1, this.tearElapsed / TEAR_DURATION_MS);
      const eased = 1 - (1 - progress) ** 3;

      this.pivot.rotation.y += 0.12;
      this.pivot.position.y = eased * 1.2;
      this.pivot.scale.setScalar(1 + eased * 0.25);

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
    this.getStageElement()?.classList?.add('is-tearing');
    this.log('Tear animation started.');
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

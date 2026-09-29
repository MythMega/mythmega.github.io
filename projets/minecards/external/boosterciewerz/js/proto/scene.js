import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class SceneManager {
    constructor(container) {
        this.container = container;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.model = null;

        this._initScene();
        this._initLights();
        this._initListeners();
    }

    _initScene() {
        console.log('[SceneManager] Initialisation de la scène Three.js');
        this.scene = new THREE.Scene();

        this.camera = new THREE.PerspectiveCamera(
            45,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
        this.camera.position.set(0, 0, 5);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;

        this.container.appendChild(this.renderer.domElement);
    }

    _initLights() {
        // Lumière ambiante diffuse pour déboucher toutes les ombres et garantir une visibilité globale
        const ambientLight = new THREE.AmbientLight(0xffffff, 1.8);
        this.scene.add(ambientLight);

        // Lumière principale attachée à la position de la caméra (face au modèle)
        const frontLight = new THREE.DirectionalLight(0xffffff, 2.2);
        frontLight.position.set(0, 0, 5); // Placé dans l'axe de la vue spectateur
        this.scene.add(frontLight);

        // Lumière de débouchage douce légèrement au-dessus pour donner du volume sans créer de zones sombres
        const topLight = new THREE.DirectionalLight(0xffffff, 0.8);
        topLight.position.set(0, 5, 2);
        this.scene.add(topLight);
    }

    _initListeners() {
        window.addEventListener('resize', () => this.onWindowResize());
    }

    onWindowResize() {
        if (!this.camera || !this.renderer) return;
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    async loadModel(path, config) {
        console.log(`[SceneManager] Chargement du modèle GLB : ${path}`);
        const loader = new GLTFLoader();

        return new Promise((resolve, reject) => {
            loader.load(
                path,
                (gltf) => {
                    const rawMesh = gltf.scene;

                    // Redressement physique du maillage d'origine
                    // On applique la rotation sur le mesh interne pour corriger ses UV/axes natifs
                    rawMesh.rotation.set(1.522, 4.75, -0.0);

                    // Création d'un groupe conteneur neutre
                    // C'est ce groupe qui recevra les rotations utilisateur du settings.json et de la souris
                    this.model = new THREE.Group();
                    this.model.add(rawMesh);

                    if (config.initialPosition) {
                        this.model.position.set(
                            config.initialPosition.x,
                            config.initialPosition.y,
                            config.initialPosition.z
                        );
                    }

                    if (config.initialRotation) {
                        this.model.rotation.set(
                            config.initialRotation.x,
                            config.initialRotation.y,
                            config.initialRotation.z
                        );
                    }

                    this.scene.add(this.model);
                    console.log('[SceneManager] Modèle redressé et ajouté à la scène avec succès');
                    resolve(this.model);
                },
                undefined,
                (error) => {
                    console.error('[SceneManager] Erreur lors du chargement du modèle :', error);
                    reject(error);
                }
            );
        });
    }

    render() {
        this.renderer.render(this.scene, this.camera);
    }
}
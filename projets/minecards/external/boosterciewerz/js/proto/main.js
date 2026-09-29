import { ConfigLoader } from './config.js';
import { SceneManager } from './scene.js';
import { TextureManager } from './textureManager.js';
import { ModelControls } from './controls.js';

class App {
    constructor() {
        this.container = document.getElementById('canvas-container');
        this.selectElement = document.getElementById('texture-select');
        this.sceneManager = null;
        this.textureManager = null;
        this.controls = null;
        this.config = null;
    }

    async init() {
        console.log('[App] Démarrage du prototype');

        try {
            this.config = await ConfigLoader.load('./app/settings.json');

            this.sceneManager = new SceneManager(this.container);

            const model = await this.sceneManager.loadModel(this.config.model, this.config);

            this.textureManager = new TextureManager(model);

            this.controls = new ModelControls(model, this.container, this.config);

            const initialTexturePath = this.selectElement.value;
            await this.textureManager.applyTexture(initialTexturePath);

            this._initUIEvents();

            this._animate();

            console.log('[App] Initialisation terminée avec succès');
        } catch (error) {
            console.error('[App] Erreur critique durant l\'initialisation :', error);
        }
    }

    _initUIEvents() {
        this.selectElement.addEventListener('change', async (event) => {
            const texturePath = event.target.value;
            console.log(`[App] Changement de sélection UI : ${texturePath}`);
            await this.textureManager.applyTexture(texturePath);
        });
    }

    _animate() {
        requestAnimationFrame(() => this._animate());
        this.sceneManager.render();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const app = new App();
    app.init();
});
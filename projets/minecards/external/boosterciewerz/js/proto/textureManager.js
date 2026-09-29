import * as THREE from 'three';

export class TextureManager {
    constructor(model) {
        this.model = model;
        this.textureLoader = new THREE.TextureLoader();
        this.cache = new Map();
        this.targetMaterials = [];

        this._findMaterials();
    }

    _findMaterials() {
        this.model.traverse((child) => {
            if (child.isMesh && child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach((mat) => this.targetMaterials.push(mat));
                } else {
                    this.targetMaterials.push(child.material);
                }
            }
        });
        console.log(`[TextureManager] ${this.targetMaterials.length} matériau(x) ciblé(s) identifié(s)`);
    }

    loadTexture(path) {
        if (this.cache.has(path)) {
            console.log(`[TextureManager] Utilisation de la texture en cache : ${path}`);
            return Promise.resolve(this.cache.get(path));
        }

        console.log(`[TextureManager] Chargement de la texture : ${path}`);
        return new Promise((resolve, reject) => {
            this.textureLoader.load(
                path,
                (texture) => {
                    texture.flipY = false;
                    texture.colorSpace = THREE.SRGBColorSpace;
                    this.cache.set(path, texture);
                    console.log(`[TextureManager] Texture chargée et mise en cache : ${path}`);
                    resolve(texture);
                },
                undefined,
                (error) => {
                    console.error(`[TextureManager] Erreur lors du chargement de la texture ${path} :`, error);
                    reject(error);
                }
            );
        });
    }

    async applyTexture(path) {
        try {
            const texture = await this.loadTexture(path);
            this.targetMaterials.forEach((material) => {
                material.map = texture;
                material.needsUpdate = true;
            });
            console.log(`[TextureManager] Texture appliquée instantanément : ${path}`);
        } catch (error) {
            console.error(`[TextureManager] Échec de l'application de la texture : ${path}`, error);
        }
    }
}
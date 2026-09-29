export class ModelControls {
    constructor(model, container, config) {
        this.model = model;
        this.container = container;
        this.config = config;

        this.isDragging = false;
        this.previousMousePosition = { x: 0, y: 0 };

        this._initEvents();
    }

    _initEvents() {
        this.container.addEventListener('mousedown', (e) => this._onMouseDown(e));
        window.addEventListener('mousemove', (e) => this._onMouseMove(e));
        window.addEventListener('mouseup', () => this._onMouseUp());
    }

    _onMouseDown(event) {
        if (event.button !== 0) return;
        this.isDragging = true;
        this.previousMousePosition = {
            x: event.clientX,
            y: event.clientY
        };
        console.log('[Controls] Début de la rotation (mousedown)');
    }

    _onMouseMove(event) {
        if (!this.isDragging || !this.model) return;

        const deltaX = event.clientX - this.previousMousePosition.x;
        const deltaY = event.clientY - this.previousMousePosition.y;

        const sensitivity = this.config.dragSensitivity || 0.01;
        const axis = this.config.rotationAxis || { x: true, y: true, z: false };

        if (axis.y) {
            this.model.rotation.y += deltaX * sensitivity;
        }

        if (axis.x) {
            this.model.rotation.x += deltaY * sensitivity;
        }

        // Rotation sur l'axe Z pilotée par le mouvement horizontal de la souris (deltaX)
        if (axis.z) {
            this.model.rotation.z += deltaX * sensitivity;
        }

        this.previousMousePosition = {
            x: event.clientX,
            y: event.clientY
        };

        console.log(`[Controls] Rotation en cours - X: ${this.model.rotation.x.toFixed(2)}, Y: ${this.model.rotation.y.toFixed(2)}, Z: ${this.model.rotation.z.toFixed(2)}`);
    }

    _onMouseUp() {
        if (this.isDragging) {
            this.isDragging = false;
            console.log('[Controls] Fin de la rotation (mouseup)');
        }
    }
}
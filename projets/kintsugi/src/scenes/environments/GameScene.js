// GameScene.js — Classe de base abstraite pour tous les environnements de jeu
// Référence : _specifications/technical-architecture.md §4, coding-guidelines.md §3
//
// Usage :
//   Ne jamais instancier directement.
//   Chaque environnement hérite de cette classe et implémente les méthodes abstraites.
//
// Méthodes abstraites (doivent être surchargées) :
//   _createWorld()          — Tilemap, sol, obstacles
//   _createSkater()         — Placement du skater au spawn
//   _createSystems()        — InputSystem, TrickSystem, KintsugiSystem…
//   _createHUD()            — HUD in-game
//   _setupCollisions()      — Colliders Phaser Arcade
//   _setupEventListeners()  — Abonnements EventBus spécifiques
//
// Méthodes communes (ne pas surcharger sauf raison valable) :
//   create()     — Orchestre l'init en appelant les méthodes abstraites dans l'ordre
//   update()     — Boucle principale
//   shutdown()   — Nettoyage EventBus + ressources
//   _goToMenu()  — Transition fadeOut → BoardScene
//
// Contraintes :
//   - Pas de new dans update()
//   - EventBus.off() impérativement appelé dans shutdown()

import EventBus from '../../utils/EventBus.js';
import { GAME_WIDTH, GAME_HEIGHT, COLORS, EVENTS } from '../../config.js';

export default class GameScene extends Phaser.Scene {
  constructor(key) {
    super({ key });

    /** @type {string} Identifiant de l'environnement (ex: 'street') */
    this.envId = key.replace('Scene', '').toLowerCase();

    /** @type {Object|null} Référence au Skater (ajouté par sous-classe) */
    this.skater = null;

    /** @type {Object|null} Référence à l'InputSystem */
    this.inputSystem = null;

    /** @type {Object|null} Référence au TrickSystem */
    this.trickSystem = null;

    /** @type {Object|null} Référence au HUD */
    this.hud = null;

    /** @type {Phaser.Tilemaps.Tilemap|null} */
    this.map = null;

    /** @type {number} Largeur du monde en pixels */
    this.worldWidth = 1920;

    /** @type {number} Hauteur du monde en pixels */
    this.worldHeight = GAME_HEIGHT;

    /** @type {boolean} ESCAPE traité ce frame (anti-rebond) */
    this._escHandled = false;

    /** @type {Phaser.Input.Keyboard.Key|null} */
    this._escKey = null;

    /** @type {Function[]} Handlers EventBus à démonter dans shutdown() */
    this._busHandlers = [];
  }

  // ── Cycle de vie Phaser ────────────────────────────────────────────────────

  /**
   * Orchestrateur principal — appelé automatiquement par Phaser.
   * Les sous-classes surchargent les méthodes _create* plutôt que create().
   */
  create() {
    this.cameras.main.setBackgroundColor(COLORS.bg);
    this.cameras.main.fadeIn(200, 0, 0, 0);

    // Bounds physiques = monde entier
    this.physics.world.setBounds(0, 0, this.worldWidth, this.worldHeight);

    // ── Méthodes abstraites dans l'ordre ──────────────────────────────────
    this._createWorld();
    this._createSkater();
    this._createSystems();
    this._createHUD();
    this._setupCollisions();
    this._setupEventListeners();

    // ── Caméra ─────────────────────────────────────────────────────────────
    this._setupCamera();

    // ── Input ESCAPE ───────────────────────────────────────────────────────
    this._escKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
  }

  /**
   * Boucle principale — appelée chaque frame.
   * @param {number} time  Temps absolu (ms)
   * @param {number} delta Temps depuis la dernière frame (ms)
   */
  update(time, delta) {
    // Gestion ESCAPE (retour menu) — une seule fois par pression
    if (Phaser.Input.Keyboard.JustDown(this._escKey)) {
      this._goToMenu();
      return;
    }

    // Déléguer aux sous-classes via _update hook
    this._update(time, delta);
  }

  /**
   * Appelé par Phaser quand la scène est mise en veille ou stoppée.
   * IMPORTANT : toujours appeler super.shutdown() dans les sous-classes.
   */
  shutdown() {
    // Démonter tous les handlers EventBus enregistrés via _onBus()
    this._busHandlers.forEach(({ event, handler }) => {
      EventBus.off(event, handler, this);
    });
    this._busHandlers = [];

    // Nettoyer les keys clavier
    if (this._escKey) {
      this._escKey.destroy();
      this._escKey = null;
    }

    // Hook pour les sous-classes
    this._shutdown();
  }

  // ── Caméra ─────────────────────────────────────────────────────────────────

  /**
   * Configure la caméra pour suivre le skater avec bounds.
   * Appelé automatiquement dans create() après _createSkater().
   */
  _setupCamera() {
    const cam = this.cameras.main;
    cam.setBounds(0, 0, this.worldWidth, this.worldHeight);

    if (this.skater) {
      cam.startFollow(this.skater, true, 0.12, 0.12);
    }
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  /**
   * Transition fadeOut → BoardScene.
   * Les sous-classes peuvent appeler cette méthode directement.
   */
  _goToMenu() {
    this.cameras.main.fadeOut(350, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start('BoardScene');
    });
  }

  // ── Helpers EventBus ───────────────────────────────────────────────────────

  /**
   * Enregistre un handler sur l'EventBus et mémorise pour le cleanup automatique.
   * @param {string}   event    Nom de l'événement (cf. EVENTS dans config.js)
   * @param {Function} handler  Callback
   */
  _onBus(event, handler) {
    EventBus.on(event, handler, this);
    this._busHandlers.push({ event, handler });
  }

  // ── Méthodes abstraites — DOIVENT être surchargées par les sous-classes ────

  /**
   * Créer le monde : tilemap, sol, obstacles.
   * @abstract
   */
  _createWorld() {
    if (this.constructor === GameScene) {
      throw new Error('GameScene._createWorld() doit être surchargé.');
    }
  }

  /**
   * Placer le skater au spawn point de l'environnement.
   * @abstract
   */
  _createSkater() {
    if (this.constructor === GameScene) {
      throw new Error('GameScene._createSkater() doit être surchargé.');
    }
  }

  /**
   * Instancier et configurer InputSystem, TrickSystem, KintsugiSystem, etc.
   * @abstract
   */
  _createSystems() {
    if (this.constructor === GameScene) {
      throw new Error('GameScene._createSystems() doit être surchargé.');
    }
  }

  /**
   * Créer le HUD in-game.
   * @abstract
   */
  _createHUD() {
    if (this.constructor === GameScene) {
      throw new Error('GameScene._createHUD() doit être surchargé.');
    }
  }

  /**
   * Configurer les colliders Phaser Arcade entre skater, sol, obstacles.
   * @abstract
   */
  _setupCollisions() {
    if (this.constructor === GameScene) {
      throw new Error('GameScene._setupCollisions() doit être surchargé.');
    }
  }

  /**
   * S'abonner aux événements EventBus spécifiques à l'environnement.
   * Utiliser this._onBus() pour l'enregistrement automatique du cleanup.
   * @abstract
   */
  _setupEventListeners() {
    if (this.constructor === GameScene) {
      throw new Error('GameScene._setupEventListeners() doit être surchargé.');
    }
  }

  // ── Méthodes hook — PEUVENT être surchargées ──────────────────────────────

  /**
   * Hook update appelé chaque frame (après la gestion ESCAPE).
   * Surcharger dans les sous-classes pour la logique de jeu.
   * @param {number} time
   * @param {number} delta
   */
  _update(time, delta) {}  // eslint-disable-line no-unused-vars

  /**
   * Hook shutdown — appelé avant le nettoyage EventBus.
   * Surcharger dans les sous-classes pour libérer les ressources spécifiques.
   */
  _shutdown() {}

  // ── Utilitaires communs ────────────────────────────────────────────────────

  /**
   * Retourne le spawn point par défaut (centre bas du monde).
   * Les sous-classes peuvent surcharger ou définir leur propre spawn.
   * @returns {{ x: number, y: number }}
   */
  getSpawnPoint() {
    return { x: 80, y: GAME_HEIGHT - 80 };
  }

  /**
   * Affiche un message debug sur la caméra (désactivé en production).
   * @param {string} msg
   */
  _debug(msg) {
    if (typeof msg === 'string') {
      console.debug(`[${this.scene.key}] ${msg}`);
    }
  }
}

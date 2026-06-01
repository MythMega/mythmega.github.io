// Skater.js — Entité joueur avec physique et machine à états
// Référence : _specifications/technical-architecture.md §5.3, tricks-system.md §2
//
// Step 07 : physique de base + états IDLE/PUSHING/ROLLING/JUMPING/LANDING/CRASHED
// Step 12 : ajout CROUCHING/TRICK_AIR/GRINDING/SLIDING/MANUAL/NOSE_MANUAL
// Step 24 : intégration spritesheet réel (remplace le rectangle placeholder)

import {
  PLAYER_SPEED, PLAYER_JUMP, PLAYER_MAX_SPD,
  COYOTE_TIME, GAME_HEIGHT,
} from '../config.js';

// ── Machine à états ────────────────────────────────────────────────────────

export const SKATER_STATE = {
  IDLE:        'idle',
  PUSHING:     'pushing',
  ROLLING:     'rolling',
  CROUCHING:   'crouching',   // step-12
  JUMPING:     'jumping',
  TRICK_AIR:   'trick_air',   // step-12
  GRINDING:    'grinding',    // step-12
  SLIDING:     'sliding',     // step-12
  MANUAL:      'manual',      // step-12
  NOSE_MANUAL: 'nose_manual', // step-12
  LANDING:     'landing',
  CRASHED:     'crashed',
};

// Durées en ms
const LANDING_DURATION = 150;
const CRASH_DURATION   = 1000;

// ── Couleurs placeholder (rectangle) ─────────────────────────────────────
const COLOR_BY_STATE = {
  [SKATER_STATE.IDLE]:       0x4a90d9,
  [SKATER_STATE.PUSHING]:    0x5ba3e3,
  [SKATER_STATE.ROLLING]:    0x5ba3e3,
  [SKATER_STATE.CROUCHING]:  0x3a70b9,
  [SKATER_STATE.JUMPING]:    0x9b59b6,
  [SKATER_STATE.TRICK_AIR]:  0xe74c3c,
  [SKATER_STATE.GRINDING]:   0xf39c12,
  [SKATER_STATE.SLIDING]:    0xe67e22,
  [SKATER_STATE.MANUAL]:     0x2ecc71,
  [SKATER_STATE.NOSE_MANUAL]:0x27ae60,
  [SKATER_STATE.LANDING]:    0x1abc9c,
  [SKATER_STATE.CRASHED]:    0x7f8c8d,
};

// ── Classe Skater ─────────────────────────────────────────────────────────

export default class Skater extends Phaser.Physics.Arcade.Sprite {
  /**
   * @param {Phaser.Scene} scene
   * @param {number} x  Position initiale X
   * @param {number} y  Position initiale Y
   */
  constructor(scene, x, y) {
    // Texture placeholder : rectangle 20×32 px
    const textureKey = Skater._ensurePlaceholderTexture(scene);
    super(scene, x, y, textureKey);

    scene.add.existing(this);
    scene.physics.add.existing(this);

    // ── Physique ──────────────────────────────────────────────────────────
    this.body.setCollideWorldBounds(true);
    this.body.setMaxVelocityX(PLAYER_MAX_SPD);
    this.body.setSize(14, 28);       // hitbox réduite (centrée dans le sprite)
    this.body.setOffset(3, 4);

    // ── État ──────────────────────────────────────────────────────────────
    /** @type {string} État courant */
    this._state = SKATER_STATE.IDLE;

    /** @type {string} Direction : 'right' | 'left' */
    this._dir = 'right';

    /** @type {number} Timestamp de début d'état (ms) */
    this._stateStartTime = 0;

    // ── Coyote time ───────────────────────────────────────────────────────
    /** @type {number} ms depuis dernière fois onGround → pour coyote */
    this._lastGroundTime = 0;

    /** @type {boolean} A déjà sauté ce coyote ? */
    this._coyoteUsed = false;

    // ── Dernier point stable (pour reset après crash) ─────────────────────
    /** @type {{ x: number, y: number }} */
    this._lastSafePoint = { x, y };
    this._safePointTimer = 0;

    // ── Tint initial ──────────────────────────────────────────────────────
    this.setTint(COLOR_BY_STATE[SKATER_STATE.IDLE]);
  }

  // ── Accesseurs ─────────────────────────────────────────────────────────────

  /** @returns {string} État courant */
  get state() { return this._state; }

  /** @returns {string} Direction courante */
  get direction() { return this._dir; }

  // ── API publique ───────────────────────────────────────────────────────────

  /**
   * Mise à jour principale — appelée par la scène chaque frame.
   * @param {number} time   Temps absolu (ms)
   * @param {number} delta  Delta frame (ms)
   * @param {Object} input  Snapshot d'inputs fourni par InputSystem (step-08)
   *                        Pour step-07, passer null → utilisation directe du clavier
   * @param {Phaser.Input.Keyboard.CursorKeys} cursors  Cursors Phaser (step-07 seulement)
   */
  update(time, delta, input, cursors) {
    this._updateSafePoint(time);
    this._updateCoyoteTime(time);
    this._updateStateMachine(time, delta, input, cursors);
    this._updateVisuals();
  }

  /**
   * Transition d'état.
   * @param {string} newState  Constante SKATER_STATE
   * @param {number} time      Temps courant (ms)
   */
  setState(newState, time = 0) {
    if (this._state === newState) return;
    this._state = newState;
    this._stateStartTime = time;
    this.setTint(COLOR_BY_STATE[newState] || 0xffffff);
  }

  /** @returns {boolean} Le skater est-il au sol ? */
  onGround() {
    return this.body.blocked.down;
  }

  /**
   * Peut-il exécuter un trick aérien ?
   * @returns {boolean}
   */
  canTrick() {
    return (
      this._state === SKATER_STATE.JUMPING ||
      this._state === SKATER_STATE.TRICK_AIR
    );
  }

  /** Déclenche l'état CRASHED et programme le reset. */
  crash() {
    if (this._state === SKATER_STATE.CRASHED) return;
    this.setState(SKATER_STATE.CRASHED);
    this.body.setVelocityX(0);
    this.scene.time.delayedCall(CRASH_DURATION, () => this._resetAfterCrash());
  }

  // ── Logique interne ────────────────────────────────────────────────────────

  /** Met à jour le coyote timer. */
  _updateCoyoteTime(time) {
    if (this.onGround()) {
      this._lastGroundTime = time;
      this._coyoteUsed = false;
    }
  }

  /** @returns {boolean} Peut sauter grâce au coyote time ? */
  _hasCoyoteTime(time) {
    return (
      !this._coyoteUsed &&
      !this.onGround() &&
      (time - this._lastGroundTime) < COYOTE_TIME
    );
  }

  /**
   * Enregistre le dernier point stable (au sol, pas en crash).
   * Toutes les 500ms pour éviter les micro-mises à jour.
   */
  _updateSafePoint(time) {
    if (this.onGround() && this._state !== SKATER_STATE.CRASHED) {
      if (time - this._safePointTimer > 500) {
        this._lastSafePoint = { x: this.x, y: this.y };
        this._safePointTimer = time;
      }
    }
  }

  /** Téléporte le skater au dernier point stable après un crash. */
  _resetAfterCrash() {
    this.setPosition(this._lastSafePoint.x, this._lastSafePoint.y);
    this.body.setVelocity(0, 0);
    this.setState(SKATER_STATE.IDLE);
  }

  // ── Machine à états ────────────────────────────────────────────────────────

  _updateStateMachine(time, delta, input, cursors) {
    // En step-07, on utilise directement les cursors Phaser si input est null
    const left  = input ? input.isDown('LEFT')  : (cursors && cursors.left.isDown);
    const right = input ? input.isDown('RIGHT') : (cursors && cursors.right.isDown);
    const up    = input ? input.isDown('UP')    : (cursors && cursors.up.isDown);
    const jump  = input ? input.wasJustPressed('JUMP') : (cursors && Phaser.Input.Keyboard.JustDown(cursors.space));

    switch (this._state) {
      case SKATER_STATE.IDLE:
        this._stateIdle(time, left, right, up, jump);
        break;
      case SKATER_STATE.PUSHING:
        this._statePushing(time, delta, left, right, jump);
        break;
      case SKATER_STATE.ROLLING:
        this._stateRolling(time, left, right, jump);
        break;
      case SKATER_STATE.JUMPING:
        this._stateJumping(time, left, right);
        break;
      case SKATER_STATE.LANDING:
        this._stateLanding(time);
        break;
      case SKATER_STATE.CRASHED:
        // Géré par delayedCall dans crash()
        break;
      default:
        // États avancés (step-12) — pas de logique ici
        this._stateRolling(time, left, right, jump);
        break;
    }

    // Atterrissage universel
    if (
      !this.onGround() === false &&  // est au sol
      this.onGround() &&
      (this._state === SKATER_STATE.JUMPING || this._state === SKATER_STATE.TRICK_AIR)
    ) {
      this._land(time);
    }
  }

  _stateIdle(time, left, right, up, jump) {
    // Ralentissement progressif
    this.body.setVelocityX(this.body.velocity.x * 0.85);

    if (left || right) {
      this.setState(SKATER_STATE.PUSHING, time);
    }
    if (jump && (this.onGround() || this._hasCoyoteTime(time))) {
      this._jump(time);
    }
  }

  _statePushing(time, delta, left, right, jump) {
    if (right) {
      this._dir = 'right';
      this.body.setVelocityX(Math.min(this.body.velocity.x + PLAYER_SPEED * 0.15, PLAYER_MAX_SPD));
    } else if (left) {
      this._dir = 'left';
      this.body.setVelocityX(Math.max(this.body.velocity.x - PLAYER_SPEED * 0.15, -PLAYER_MAX_SPD));
    } else {
      this.setState(SKATER_STATE.ROLLING, time);
    }

    if (jump && (this.onGround() || this._hasCoyoteTime(time))) {
      this._jump(time);
    }

    if (!this.onGround()) {
      this.setState(SKATER_STATE.JUMPING, time);
    }
  }

  _stateRolling(time, left, right, jump) {
    // Friction au sol
    this.body.setVelocityX(this.body.velocity.x * 0.92);

    if (Math.abs(this.body.velocity.x) < 5) {
      this.setState(SKATER_STATE.IDLE, time);
    }

    if (left || right) {
      this.setState(SKATER_STATE.PUSHING, time);
    }

    if (jump && (this.onGround() || this._hasCoyoteTime(time))) {
      this._jump(time);
    }

    if (!this.onGround()) {
      this.setState(SKATER_STATE.JUMPING, time);
    }
  }

  _stateJumping(time, left, right) {
    // Contrôle aérien léger
    if (right) {
      this._dir = 'right';
      this.body.setVelocityX(Math.min(this.body.velocity.x + 6, PLAYER_MAX_SPD));
    } else if (left) {
      this._dir = 'left';
      this.body.setVelocityX(Math.max(this.body.velocity.x - 6, -PLAYER_MAX_SPD));
    }

    // Atterrissage
    if (this.onGround()) {
      this._land(time);
    }
  }

  _stateLanding(time) {
    // Finit la LANDING et repasse en ROLLING
    const elapsed = (time || 0) - this._stateStartTime;
    if (elapsed >= LANDING_DURATION) {
      this.setState(SKATER_STATE.ROLLING, time);
    }
  }

  _jump(time) {
    this.body.setVelocityY(PLAYER_JUMP);
    this._coyoteUsed = true;
    this.setState(SKATER_STATE.JUMPING, time);
  }

  _land(time) {
    this.setState(SKATER_STATE.LANDING, time);
    // Squash visuel (sera remplacé par une vraie anim en step-24)
    this.scene.tweens.add({
      targets: this,
      scaleX: 1.3, scaleY: 0.7,
      duration: 60,
      yoyo: true,
    });
  }

  // ── Visuels ────────────────────────────────────────────────────────────────

  _updateVisuals() {
    // Flip horizontal selon direction
    this.setFlipX(this._dir === 'left');
  }

  // ── Texture placeholder ────────────────────────────────────────────────────

  /**
   * Génère une texture rectangle 20×32 si elle n'existe pas.
   * @param {Phaser.Scene} scene
   * @returns {string} Clé de texture
   */
  static _ensurePlaceholderTexture(scene) {
    const key = 'skater_placeholder';
    if (scene.textures.exists(key)) return key;

    const g = scene.make.graphics({ x: 0, y: 0, add: false });
    // Corps
    g.fillStyle(0x4a90d9, 1);
    g.fillRect(0, 0, 20, 28);
    // Tête
    g.fillStyle(0x7ab4f0, 1);
    g.fillRect(4, -8, 12, 10);
    // Board
    g.fillStyle(0x1a1a2e, 1);
    g.fillRect(-2, 28, 24, 4);
    g.generateTexture(key, 24, 32);
    g.destroy();

    return key;
  }
}

// Obstacle.js — Classe de base pour tous les obstacles du jeu
// Référence : _specifications/environments.md, technical-architecture.md #5
//
// Les sous-classes (Rail, Ledge, Stair, ManualPad) héritent de cette classe.
// Chaque obstacle :
//   - Accepte un objet config issu de src/data/environments.json
//   - Crée son propre visuel (rectangle placeholder) et ses corps physiques
//   - Expose les méthodes nécessaires au TrickSystem (step-11) et à Skater (step-12)
//
// Usage dans une scène :
//   const obs = new Rail(scene, configObj);
//   scene.physics.add.collider(skater, obs.getBodies());

import { GRIND_SNAP } from '../../config.js';

// Couleurs placeholder (remplacées par assets step-31)
export const OBS_COLORS = {
  ledge:      0x4a4a6a,
  rail:       0xd4a017,
  stair:      0x3a3a5a,
  manual_pad: 0x2ecc71,
  ramp:       0x5a3a5a,
};

export default class Obstacle {
  /**
   * @param {Phaser.Scene} scene
   * @param {object}       config  Entrée depuis environments.json
   *   config.id         {string}
   *   config.type       {string}  'rail'|'ledge'|'stair'|'manual_pad'|'ramp'
   *   config.x          {number}  Bord gauche (world px)
   *   config.y          {number}  Bord haut (world px)
   *   config.width      {number}
   *   config.height     {number}
   *   config.grindable  {boolean}
   *   config.slideType  {string|null}  'ledge'|'rail'|null
   */
  constructor(scene, config) {
    /** @type {Phaser.Scene} */
    this.scene = scene;

    this.id        = config.id;
    this.type      = config.type;
    this.x         = config.x;
    this.y         = config.y;
    this.width     = config.width  || 0;
    this.height    = config.height || 0;
    this.grindable = config.grindable  || false;
    this.slideType = config.slideType  || null;

    /** Portée verticale de snapping (px) — utilisée par Skater.canGrind() */
    this.snapRange = GRIND_SNAP;

    /** @type {Phaser.Physics.Arcade.StaticImage[]} */
    this._bodies = [];

    /** @type {Phaser.GameObjects.GameObject[]} */
    this._visuals = [];
  }

  // ── API publique ────────────────────────────────────────────────────────────

  /**
   * Retourne tous les corps physiques statiques de cet obstacle.
   * Passer à physics.add.collider(skater, obs.getBodies()).
   * @returns {Phaser.Physics.Arcade.StaticImage[]}
   */
  getBodies() {
    return this._bodies;
  }

  /**
   * Rectangle englobant de l'obstacle (coordonnées monde).
   * @returns {Phaser.Geom.Rectangle}
   */
  getBounds() {
    return new Phaser.Geom.Rectangle(this.x, this.y, this.width, this.height);
  }

  /**
   * Y du bord supérieur de l'obstacle.
   * Utilisé pour les collisions d'atterrissage.
   * @returns {number}
   */
  getTopY() {
    return this.y;
  }

  /**
   * Y cible pour snapper le skater lors d'un grind/slide.
   * Par défaut = bord supérieur. Surcharger dans Rail si besoin.
   * @returns {number}
   */
  getGrindY() {
    return this.y;
  }

  /**
   * Clamp le X du skater à l'intérieur de l'obstacle (pour le grind).
   * @param {number} skaterX
   * @returns {number}
   */
  getSnapX(skaterX) {
    return Phaser.Math.Clamp(skaterX, this.x, this.x + this.width);
  }

  /**
   * Indique si le skater est horizontalement proche de cet obstacle
   * (dans la plage x ± snapRange).
   * @param {number} skaterX
   * @returns {boolean}
   */
  isHorizontallyNear(skaterX) {
    return skaterX >= this.x - this.snapRange
        && skaterX <= this.x + this.width + this.snapRange;
  }

  /**
   * Indique si le skater est verticalement proche pour initier un grind
   * (Y skater dans getGrindY() ± snapRange).
   * @param {number} skaterY  Centre Y du skater
   * @returns {boolean}
   */
  isVerticallyNear(skaterY) {
    const gy = this.getGrindY();
    return Math.abs(skaterY - gy) <= this.snapRange;
  }

  /**
   * Raccourci : le skater peut-il initier un grind/slide sur cet obstacle ?
   * @param {number} skaterX
   * @param {number} skaterY
   * @returns {boolean}
   */
  canSnapTo(skaterX, skaterY) {
    return this.grindable
        && this.isHorizontallyNear(skaterX)
        && this.isVerticallyNear(skaterY);
  }

  /**
   * Libère les corps physiques et les visuels.
   * Appeler dans la méthode shutdown() de la scène.
   */
  destroy() {
    for (const b of this._bodies)  { b.destroy(); }
    for (const v of this._visuals) { v.destroy(); }
    this._bodies  = [];
    this._visuals = [];
  }

  // ── Helpers protégés ────────────────────────────────────────────────────────

  /**
   * Crée un corps physique statique (invisible) et l'enregistre.
   * @param {number} cx  Centre X
   * @param {number} cy  Centre Y
   * @param {number} w
   * @param {number} h
   * @returns {Phaser.Physics.Arcade.StaticImage}
   */
  _addBody(cx, cy, w, h) {
    const body = this.scene.physics.add
      .staticImage(cx, cy, '__DEFAULT')
      .setVisible(false);
    body.setDisplaySize(w, h);
    body.refreshBody();
    // Référence retour pour que le TrickSystem puisse retrouver l'obstacle
    body.setData('obstacle', this);
    this._bodies.push(body);
    return body;
  }

  /**
   * Crée un rectangle visuel (placeholder) et l'enregistre.
   * @param {number} x      Bord gauche
   * @param {number} y      Bord haut
   * @param {number} w
   * @param {number} h
   * @param {number} color  Couleur hex
   * @param {number} [depth=5]
   * @returns {Phaser.GameObjects.Rectangle}
   */
  _addVisual(x, y, w, h, color, depth = 5) {
    const rect = this.scene.add
      .rectangle(x, y, w, h, color)
      .setOrigin(0, 0)
      .setDepth(depth);
    this._visuals.push(rect);
    return rect;
  }

  /**
   * Ajoute un label texte debug au-dessus de l'obstacle.
   * @param {string} text
   * @param {number} depth
   */
  _addLabel(text, depth = 6) {
    const lx = this.x + this.width / 2;
    const ly = this.y - 6;
    const label = this.scene.add.text(lx, ly, text, {
      fontFamily: 'monospace',
      fontSize:   '5px',
      color:      '#8a8a9a',
    }).setOrigin(0.5, 1).setDepth(depth);
    this._visuals.push(label);
  }
}

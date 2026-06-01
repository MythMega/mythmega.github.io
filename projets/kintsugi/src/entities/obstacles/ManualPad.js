// ManualPad.js — Plateforme pour manuals (Manual, Nose Manual)
// Référence : _specifications/environments.md, tricks-system.md
//
// Config attendue (depuis environments.json) :
//   { id, type:'manual_pad', x, y, width, height, grindable:false }
//
// Un ManualPad est un bloc plat, légèrement surélevé.
// Le skater peut y atterrir et y effectuer des manuals.
// Non grindable, mais le TrickSystem vérifie que le skater est dessus
// (onGround + sur un ManualPad) pour valider MANUAL / NOSE_MANUAL.

import Obstacle, { OBS_COLORS } from './Obstacle.js';

export default class ManualPad extends Obstacle {
  /**
   * @param {Phaser.Scene} scene
   * @param {object}       config
   */
  constructor(scene, config) {
    super(scene, config);
    this.grindable = false;
    this.slideType  = null;
    this._build();
  }

  // ── Surcharges ─────────────────────────────────────────────────────────────

  /**
   * Y du dessus du pad (là où le skater se pose).
   */
  getTopY() {
    return this.y;
  }

  /**
   * Le ManualPad n'est pas grindable — canSnapTo() retourne toujours false.
   */
  canSnapTo() {
    return false;
  }

  /**
   * Indique si le skater est sur ce pad (test rapide en X).
   * Utilisé par TrickSystem pour valider MANUAL / NOSE_MANUAL.
   * @param {number} skaterX
   * @returns {boolean}
   */
  isSkaterOnPad(skaterX) {
    return skaterX >= this.x && skaterX <= this.x + this.width;
  }

  // ── Construction ───────────────────────────────────────────────────────────

  _build() {
    const { x, y, width: w, height: h } = this;

    // Visuel : rectangle vert pour différencier des ledges
    this._addVisual(x, y, w, h, OBS_COLORS.manual_pad);

    // Corps physique
    this._addBody(x + w / 2, y + h / 2, w, h);

    // Label debug
    this._addLabel('MANUAL');
  }
}

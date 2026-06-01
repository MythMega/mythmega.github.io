// Rail.js — Rail grindable (50-50, 5-0, etc.)
// Référence : _specifications/environments.md, tricks-system.md
//
// Config attendue (depuis environments.json) :
//   { id, type:'rail', x, y, width, height, grindable:true }
//
// Un rail est une barre fine (height ≈ 6px).
// Le skater se snape sur le dessus (getGrindY = y).
// Le rail est toujours grindable (sinon ce n'est pas un rail).

import Obstacle, { OBS_COLORS } from './Obstacle.js';

export default class Rail extends Obstacle {
  /**
   * @param {Phaser.Scene} scene
   * @param {object}       config
   */
  constructor(scene, config) {
    super(scene, config);

    // Un rail est grindable par définition
    this.grindable = true;
    this.slideType = config.slideType || 'rail';

    this._build();
  }

  // ── Surcharge ──────────────────────────────────────────────────────────────

  /**
   * Y de surface pour le grind (dessus du rail).
   * Le skater doit avoir ses pieds à ce niveau.
   */
  getGrindY() {
    return this.y;
  }

  // ── Construction ───────────────────────────────────────────────────────────

  _build() {
    const { x, y, width: w, height: h } = this;

    // Visuel : barre dorée fine
    this._addVisual(x, y, w, h, OBS_COLORS.rail);

    // Corps physique : rectangle mince correspondant au rail
    const bodyH = Math.max(h, 4); // minimum 4px pour la détection de collision
    this._addBody(x + w / 2, y + bodyH / 2, w, bodyH);

    // Label debug
    this._addLabel('RAIL');
  }
}

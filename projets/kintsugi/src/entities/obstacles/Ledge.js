// Ledge.js — Ledge / boîte grindable (noseslide, boardslide, 50-50…)
// Référence : _specifications/environments.md, tricks-system.md
//
// Config attendue (depuis environments.json) :
//   { id, type:'ledge', x, y, width, height, grindable:true|false,
//     slideType:'ledge'|null }
//
// Un ledge est un bloc plein. Le skater peut :
//   - Atterrir dessus (collision top)
//   - Grinder / slider le dessus (getGrindY = y)
//   - (Futur step-12 : slider la tranche latérale)

import Obstacle, { OBS_COLORS } from './Obstacle.js';

export default class Ledge extends Obstacle {
  /**
   * @param {Phaser.Scene} scene
   * @param {object}       config
   */
  constructor(scene, config) {
    super(scene, config);
    this.slideType = config.slideType || 'ledge';
    this._build();
  }

  // ── Surcharge ──────────────────────────────────────────────────────────────

  /**
   * Y de surface pour le grind (dessus du ledge).
   */
  getGrindY() {
    return this.y;
  }

  // ── Construction ───────────────────────────────────────────────────────────

  _build() {
    const { x, y, width: w, height: h } = this;

    // Visuel : bloc coloré
    this._addVisual(x, y, w, h, OBS_COLORS.ledge);

    // Corps physique : bloc complet (le skater peut atterrir dessus)
    this._addBody(x + w / 2, y + h / 2, w, h);

    // Label debug si grindable
    if (this.grindable) {
      this._addLabel('LEDGE');
    }
  }
}

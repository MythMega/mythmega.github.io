// Stair.js — Escalier (3 ou 5 marches, non grindable)
// Référence : _specifications/environments.md
//
// Config attendue (depuis environments.json) :
//   { id, type:'stair', x, y (=groundY), steps, stepWidth, stepHeight,
//     grindable:false }
//
// L'escalier est composé de N marches. Chaque marche est un corps physique
// statique indépendant. Les marches descendent de gauche (plus haute) à
// droite (niveau du sol).
//
// Calcul des marches :
//   RISER = 6 px (hauteur de montée par marche — constante spec)
//   Pour la marche i (0 = plus haute/gauche) :
//     x_step  = config.x + i * stepWidth
//     top_y   = groundY - (steps - 1 - i) * RISER
//     bodyH   = (steps - 1 - i) * RISER
//   La dernière marche (i = steps-1) est au niveau du sol → bodyH = 0, ignorée.
//
// Vérification :
//   stair_3 (steps=3, riser=6, groundY=288) :
//     i=0 → topY=276, h=12  ✓
//     i=1 → topY=282, h=6   ✓
//     i=2 → topY=288, h=0   (ignorée) ✓
//   stair_5 (steps=5, riser=6, groundY=288) :
//     i=0 → topY=264, h=24  ✓
//     i=1 → topY=270, h=18  ✓
//     …etc.

import Obstacle, { OBS_COLORS } from './Obstacle.js';

const STAIR_RISER = 6; // px — hauteur de montée entre deux marches (spec constante)

export default class Stair extends Obstacle {
  /**
   * @param {Phaser.Scene} scene
   * @param {object}       config
   *   config.x          {number}  X de la première marche (la plus haute)
   *   config.y          {number}  Y du sol (bas de l'escalier)
   *   config.steps      {number}  Nombre de marches
   *   config.stepWidth  {number}  Largeur de chaque marche (px)
   *   config.stepHeight {number}  (ignoré — on utilise STAIR_RISER=6 constante)
   */
  constructor(scene, config) {
    // L'escalier n'a pas de width/height unique — on les calcule
    const totalW = (config.steps || 1) * (config.stepWidth || 40);
    const totalH = (config.steps - 1) * STAIR_RISER;

    super(scene, {
      ...config,
      width:  totalW,
      height: totalH,
      grindable: false,
      slideType:  null,
    });

    this._steps     = config.steps      || 3;
    this._stepWidth = config.stepWidth  || 40;
    this._groundY   = config.y;          // y dans config = niveau sol

    this._build();
  }

  // ── Surcharges ─────────────────────────────────────────────────────────────

  /**
   * Les escaliers ne supportent pas le grind.
   */
  getGrindY() { return this._groundY; }
  canSnapTo()  { return false; }

  // ── Construction ───────────────────────────────────────────────────────────

  _build() {
    const steps = this._steps;
    const sw    = this._stepWidth;
    const gY    = this._groundY;

    for (let i = 0; i < steps; i++) {
      const stepX = this.x + i * sw;
      const topY  = gY - (steps - 1 - i) * STAIR_RISER;
      const bodyH = (steps - 1 - i) * STAIR_RISER;

      // La dernière marche est au sol → pas de corps physique dédié
      if (bodyH <= 0) continue;

      // Visuel
      this._addVisual(stepX, topY, sw, bodyH, OBS_COLORS.stair);

      // Corps physique
      this._addBody(stepX + sw / 2, topY + bodyH / 2, sw, bodyH);
    }

    // Label debug sur la plus haute marche
    const labelX = this.x + sw / 2;
    const labelY = gY - (steps - 1) * STAIR_RISER - 6;
    const label = this.scene.add.text(labelX, labelY, `STAIR ${steps}`, {
      fontFamily: 'monospace',
      fontSize:   '5px',
      color:      '#8a8a9a',
    }).setOrigin(0.5, 1).setDepth(6);
    this._visuals.push(label);
  }
}

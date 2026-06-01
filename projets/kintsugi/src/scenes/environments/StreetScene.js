// StreetScene.js — Premier environnement jouable
// Référence : _specifications/environments.md #1, technical-architecture.md §7
//
// Hérite de GameScene (step-06).
// Monde 1920×360px, ground y=288, spawn x=64.
//
// Obstacles (placeholders rectangles jusqu'au step-31) :
//   LEDGE_1     : x 80-200,  y 255  (120×33)
//   STAIR_3     : x 380-500, marches de 6px
//   RAIL_1      : x 620-780, y 238  (160×6)
//   STAIR_5     : x 980-1180, marches de 6px
//   MANUAL_PAD  : x 1300-1400, y 268 (100×20)
//
// Backgrounds parallax : couches far/mid/near chargées dans PreloadScene.
// Si les assets sont absents → fond couleur plat (pas de crash).

import GameScene from './GameScene.js';
import Skater from '../../entities/Skater.js';
import InputSystem from '../../systems/InputSystem.js';
import { GAME_HEIGHT, GROUND_Y, COLORS } from '../../config.js';

// ── Constantes scène ────────────────────────────────────────────────────────
const WORLD_WIDTH  = 1920;
const SPAWN_X      = 64;
const SPAWN_Y      = GROUND_Y - 16;   // juste au-dessus du sol

// Couleurs placeholder obstacles
const COL_GROUND  = 0x2a2a3a;
const COL_LEDGE   = 0x4a4a6a;
const COL_RAIL    = 0xd4a017;
const COL_STAIR   = 0x3a3a5a;
const COL_MANPAD  = 0x2ecc71;

export default class StreetScene extends GameScene {
  constructor() {
    super('StreetScene');
    this.worldWidth  = WORLD_WIDTH;
    this.worldHeight = GAME_HEIGHT;

    /** @type {Phaser.Physics.Arcade.StaticGroup} Groupe sol */
    this._groundGroup = null;

    /** @type {Phaser.Physics.Arcade.StaticGroup} Groupe obstacles */
    this._obstacleGroup = null;

    /** @type {Phaser.GameObjects.Group} Visuels uniquement (backgrounds) */
    this._bgLayers = [];
  }

  // ── Méthodes abstraites de GameScene ──────────────────────────────────────

  _createWorld() {
    this._createBackground();
    this._createGround();
    this._createObstacles();
  }

  _createSkater() {
    this.skater = new Skater(this, SPAWN_X, SPAWN_Y);
  }

  _createSystems() {
    this.inputSystem = new InputSystem(this);
  }

  _createHUD() {
    // HUD minimal (step-16 implémentera le HUD complet)
    this._envLabel = this.add.text(8, GAME_HEIGHT - 12, 'STREET  ストリート', {
      fontFamily: 'PixelFont, "Press Start 2P", monospace',
      fontSize: '6px',
      color: '#8a8a9a',
    }).setScrollFactor(0).setDepth(10);

    this._escHint = this.add.text(this.cameras.main.width - 8, GAME_HEIGHT - 12, 'ECHAP — menu', {
      fontFamily: 'PixelFont, "Press Start 2P", monospace',
      fontSize: '5px',
      color: '#8a8a9a',
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(10);
  }

  _setupCollisions() {
    // Sol
    this.physics.add.collider(this.skater, this._groundGroup);
    // Obstacles (le skater peut atterrir dessus)
    this.physics.add.collider(this.skater, this._obstacleGroup);
  }

  _setupEventListeners() {
    // Touche R → reset position
    this.input.keyboard.on('keydown-R', () => {
      this.skater.setPosition(SPAWN_X, SPAWN_Y);
      this.skater.body.setVelocity(0, 0);
    });
  }

  // ── Update hook ────────────────────────────────────────────────────────────

  _update(time, delta) {
    this.inputSystem.update(time);

    // Met à jour le skater avec l'InputSystem
    this.skater.update(time, delta, this.inputSystem, null);

    // Parallax backgrounds
    this._updateParallax();
  }

  // ── Shutdown hook ──────────────────────────────────────────────────────────

  _shutdown() {
    if (this.inputSystem) {
      this.inputSystem.destroy();
      this.inputSystem = null;
    }
    this.input.keyboard.removeAllListeners();
  }

  // ── Construction du monde ──────────────────────────────────────────────────

  /** Fonds parallax (3 couches + ciel de fallback). */
  _createBackground() {
    const textures = this.textures;
    const W = WORLD_WIDTH;
    const H = GAME_HEIGHT;

    // Couche de fallback : dégradé sombre (toujours affiché)
    const fallback = this.add.graphics().setDepth(0).setScrollFactor(0);
    fallback.fillGradientStyle(0x0a0a14, 0x0a0a14, 0x0f0f24, 0x0f0f24, 1);
    fallback.fillRect(0, 0, this.cameras.main.width, H);

    // Couches réelles si assets chargés
    const layers = [
      { key: 'bg_street_far',  scrollX: 0.1, depth: 1 },
      { key: 'bg_street_mid',  scrollX: 0.4, depth: 2 },
      { key: 'bg_street_near', scrollX: 0.7, depth: 3 },
    ];

    this._bgLayers = [];

    for (const { key, scrollX, depth } of layers) {
      if (!textures.exists(key)) continue;

      const img = this.add.tileSprite(0, 0, W, H, key)
        .setOrigin(0, 0)
        .setScrollFactor(0)   // on gère le scroll manuellement pour le tiling
        .setDepth(depth);

      this._bgLayers.push({ sprite: img, scrollX });
    }
  }

  /** Scrolling parallax manuellement sur les tileSprites. */
  _updateParallax() {
    const camX = this.cameras.main.scrollX;
    for (const { sprite, scrollX } of this._bgLayers) {
      sprite.setTilePosition(camX * scrollX, 0);
    }
  }

  /** Sol statique physique + visuel. */
  _createGround() {
    this._groundGroup = this.physics.add.staticGroup();

    // Sol principal (1920×72 px, du bas de l'écran)
    const groundY = GROUND_Y;
    const groundH = GAME_HEIGHT - groundY;

    const groundVis = this.add.rectangle(0, groundY, WORLD_WIDTH, groundH, COL_GROUND)
      .setOrigin(0, 0)
      .setDepth(4);

    const groundBody = this.physics.add.staticImage(
      WORLD_WIDTH / 2, groundY, '__DEFAULT'
    ).setVisible(false);
    groundBody.setDisplaySize(WORLD_WIDTH, groundH);
    groundBody.refreshBody();

    this._groundGroup.add(groundBody);
  }

  /** Obstacles placeholder (rectangles colorés + corps statiques). */
  _createObstacles() {
    this._obstacleGroup = this.physics.add.staticGroup();

    const defs = [
      // { id, x, y, w, h, color, label }
      { id: 'ledge_1',    x: 80,   y: 255, w: 120, h: 33,  color: COL_LEDGE,  label: 'LEDGE' },
      { id: 'stair_3_1',  x: 380,  y: 276, w: 40,  h: 12,  color: COL_STAIR,  label: null },
      { id: 'stair_3_2',  x: 420,  y: 282, w: 40,  h: 6,   color: COL_STAIR,  label: null },
      { id: 'stair_3_3',  x: 460,  y: 288, w: 40,  h: 0,   color: COL_STAIR,  label: null },  // niveau sol
      { id: 'rail_1',     x: 620,  y: 238, w: 160, h: 6,   color: COL_RAIL,   label: 'RAIL' },
      { id: 'stair_5_1',  x: 980,  y: 264, w: 40,  h: 24,  color: COL_STAIR,  label: null },
      { id: 'stair_5_2',  x: 1020, y: 270, w: 40,  h: 18,  color: COL_STAIR,  label: null },
      { id: 'stair_5_3',  x: 1060, y: 276, w: 40,  h: 12,  color: COL_STAIR,  label: null },
      { id: 'stair_5_4',  x: 1100, y: 282, w: 40,  h: 6,   color: COL_STAIR,  label: null },
      { id: 'stair_5_5',  x: 1140, y: 288, w: 40,  h: 0,   color: COL_STAIR,  label: null },
      { id: 'manual_pad', x: 1300, y: 268, w: 100, h: 20,  color: COL_MANPAD, label: 'MANUAL' },
    ];

    for (const def of defs) {
      if (def.h <= 0) continue; // marche de niveau sol — pas de corps physique

      const cx = def.x + def.w / 2;
      const cy = def.y + def.h / 2;

      // Visuel
      this.add.rectangle(def.x, def.y, def.w, def.h, def.color)
        .setOrigin(0, 0)
        .setDepth(5);

      // Label debug
      if (def.label) {
        this.add.text(cx, def.y - 6, def.label, {
          fontFamily: 'monospace',
          fontSize: '5px',
          color: '#8a8a9a',
        }).setOrigin(0.5, 1).setDepth(6);
      }

      // Corps physique statique
      const body = this.physics.add.staticImage(cx, cy, '__DEFAULT').setVisible(false);
      body.setDisplaySize(def.w, def.h);
      body.refreshBody();
      body.setData('obstacleId', def.id);

      this._obstacleGroup.add(body);
    }
  }
}

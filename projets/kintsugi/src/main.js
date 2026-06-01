// main.js — Point d'entrée Phaser
// Référence : _specifications/technical-architecture.md #2

import { GAME_WIDTH, GAME_HEIGHT, ZOOM, GRAVITY, COLORS } from './config.js';
import BootScene from './scenes/BootScene.js';
import PreloadScene from './scenes/PreloadScene.js';
import MenuScene from './scenes/MenuScene.js';
import StreetScene from './scenes/environments/StreetScene.js';

// ── Placeholder BoardScene (step-17) ───────────────────────────────────────
class BoardScenePlaceholder extends Phaser.Scene {
  constructor() {
    super({ key: 'BoardScene' });
  }

  create() {
    const cx = GAME_WIDTH / 2;
    const cy = GAME_HEIGHT / 2;
    this.cameras.main.setBackgroundColor(COLORS.bg);

    this.add.text(cx, cy - 16, 'BOARD KINTSUGI', {
      fontFamily: 'monospace', fontSize: '10px', color: '#d4a017',
    }).setOrigin(0.5);

    this.add.text(cx, cy + 2, 'Step 05 — MenuScene OK', {
      fontFamily: 'monospace', fontSize: '7px', color: '#44ff88',
    }).setOrigin(0.5);

    this.add.text(cx, cy + 16, '(BoardScene → step-17)', {
      fontFamily: 'monospace', fontSize: '6px', color: '#8a8a9a',
    }).setOrigin(0.5);

    // ESCAPE → retour MenuScene
    this.input.keyboard.once('keydown-ESC', () => this.scene.start('MenuScene'));
    this.add.text(cx, cy + 30, 'ECHAP — retour menu', {
      fontFamily: 'monospace', fontSize: '5px', color: '#8a8a9a',
    }).setOrigin(0.5);
  }
}

// ── Configuration Phaser ────────────────────────────────────────────────────
const config = {
  type: Phaser.AUTO,
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  zoom: ZOOM,
  pixelArt: true,
  backgroundColor: '#0a0a0a',
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { y: GRAVITY },
      debug: true,   // false en production (step-32)
    },
  },
  scene: [
    BootScene,
    PreloadScene,
    MenuScene,
    BoardScenePlaceholder,   // remplacé par BoardScene à step-17
    // EnvSelectScene,        ← step-18
    StreetScene,             // step-09
    // SkateparkScene,        ← step-20
    // RooftopScene,          ← step-21
    // TunnelScene,           ← step-22
    // GardenScene,           ← step-23
  ],
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
};

// ── Lancement ───────────────────────────────────────────────────────────────
const game = new Phaser.Game(config);

export default game;

// MenuScene.js — Écran titre et navigation principale
// Référence : _specifications/ui-screens.md §6
//
// Layout :
//   Logo "KOKORO GAME / 金継ぎ KINTSUGI" avec shimmer doré (toutes les 3s)
//   "APPUYER SUR ↵" clignotant (alpha 1↔0.35, 1.5s période)
//   Particules flottantes or subtiles
//   Bouton hint "O - OPTIONS" bas-droite
//
// Navigation :
//   ENTER / SPACE  → fadeOut 400ms → BoardScene
//   O              → OptionsOverlay (toggle)
//   ESCAPE         → ferme OptionsOverlay si ouverte

import { GAME_WIDTH, GAME_HEIGHT, COLORS } from '../config.js';
import { OptionsOverlay } from '../ui/MenuComponents.js';

export default class MenuScene extends Phaser.Scene {
  constructor() {
    super({ key: 'MenuScene' });

    /** @type {OptionsOverlay} */
    this._options = null;
    /** @type {Phaser.GameObjects.Text} */
    this._pressEnter = null;
  }

  create() {
    const cx = GAME_WIDTH / 2;
    const cy = GAME_HEIGHT / 2;

    this.cameras.main.setBackgroundColor(COLORS.bg);
    this.cameras.main.fadeIn(300, 0, 0, 0);

    // ── Fond animé (particules or flottantes) ──────────────────────────────
    this._createParticles();

    // ── Logo ──────────────────────────────────────────────────────────────
    const logoLine1 = this.add.text(cx, cy - 52, 'KOKORO GAME', {
      fontFamily: 'PixelFont, "Press Start 2P", monospace',
      fontSize: '16px',
      color: '#f5c842',
    }).setOrigin(0.5).setDepth(1);

    const logoLine2 = this.add.text(cx, cy - 28, '金継ぎ  KINTSUGI', {
      fontFamily: 'PixelFont, "Press Start 2P", monospace',
      fontSize: '9px',
      color: '#d4a017',
    }).setOrigin(0.5).setDepth(1);

    // Ligne décorative sous le titre
    const line = this.add.graphics().setDepth(1);
    line.lineStyle(1, 0xd4a017, 0.4);
    line.lineBetween(cx - 90, cy - 12, cx + 90, cy - 12);

    this._createLogoShimmer(logoLine1, logoLine2);

    // ── "APPUYER SUR ↵" clignotant ─────────────────────────────────────────
    this._pressEnter = this.add.text(cx, cy + 14, 'APPUYER SUR  ↵', {
      fontFamily: 'PixelFont, "Press Start 2P", monospace',
      fontSize: '7px',
      color: '#e8e8d8',
    }).setOrigin(0.5).setDepth(1);

    this.tweens.add({
      targets: this._pressEnter,
      alpha: { from: 1, to: 0.35 },
      duration: 750,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // ── Hints bas-droite ───────────────────────────────────────────────────
    this.add.text(GAME_WIDTH - 8, GAME_HEIGHT - 8, 'O - OPTIONS', {
      fontFamily: 'PixelFont, "Press Start 2P", monospace',
      fontSize: '5px',
      color: '#8a8a9a',
    }).setOrigin(1, 1).setDepth(1);

    // ── OptionsOverlay ─────────────────────────────────────────────────────
    this._options = new OptionsOverlay(this);
    this._options.build();

    // ── Inputs ────────────────────────────────────────────────────────────
    this._setupInput();
  }

  // ── Inputs ─────────────────────────────────────────────────────────────────

  _setupInput() {
    this.input.keyboard.on('keydown-ENTER', () => this._onConfirm());
    this.input.keyboard.on('keydown-SPACE', () => this._onConfirm());
    this.input.keyboard.on('keydown-O', () => this._onToggleOptions());
    this.input.keyboard.on('keydown-ESC', () => {
      if (this._options.isVisible()) this._options.hide();
    });
  }

  _onConfirm() {
    if (this._options.isVisible()) return;
    this._goTo('BoardScene');
  }

  _onToggleOptions() {
    if (this._options.isVisible()) {
      this._options.hide();
    } else {
      this._options.show();
    }
  }

  // ── Transitions ────────────────────────────────────────────────────────────

  /**
   * Fondu noir 400ms puis change de scène.
   * @param {string} sceneKey
   */
  _goTo(sceneKey) {
    this.cameras.main.fadeOut(400, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start(sceneKey);
    });
  }

  // ── Animations ─────────────────────────────────────────────────────────────

  /**
   * Shimmer doré sur le logo : pulse rapide toutes les 3 secondes.
   * @param {...Phaser.GameObjects.Text} targets
   */
  _createLogoShimmer(...targets) {
    const shimmer = () => {
      this.tweens.add({
        targets,
        alpha: { from: 1, to: 0.55 },
        duration: 110,
        yoyo: true,
        repeat: 3,
        ease: 'Sine.easeInOut',
        onComplete: () => targets.forEach((t) => t.setAlpha(1)),
      });
    };
    // Premier shimmer à 2s, puis toutes les 3s
    this.time.addEvent({ delay: 3000, callback: shimmer, loop: true, startAt: 2000 });
  }

  /**
   * Petites particules or flottantes (montant du bas vers le haut).
   * Utilise une texture générée en mémoire (2×2px) pour éviter les assets manquants.
   */
  _createParticles() {
    // Générer une texture 2×2 or si elle n'existe pas encore
    if (!this.textures.exists('menu_particle')) {
      const gfx = this.make.graphics({ x: 0, y: 0, add: false });
      gfx.fillStyle(0xd4a017, 1);
      gfx.fillRect(0, 0, 2, 2);
      gfx.generateTexture('menu_particle', 2, 2);
      gfx.destroy();
    }

    this.add.particles(0, 0, 'menu_particle', {
      x: { min: 0, max: GAME_WIDTH },
      y: GAME_HEIGHT + 4,
      speedY: { min: -18, max: -7 },
      speedX: { min: -3, max: 3 },
      lifespan: { min: 5000, max: 9000 },
      alpha: { start: 0.28, end: 0 },
      quantity: 1,
      frequency: 350,
      scale: 1,
    }).setDepth(0);
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────

  shutdown() {
    this.input.keyboard.removeAllListeners();
  }
}

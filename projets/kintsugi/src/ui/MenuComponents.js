// MenuComponents.js — Composants UI réutilisables pour les menus
// Référence : _specifications/ui-screens.md
//
// Contenu actuel :
//   - OptionsOverlay  : panel musique/SFX (step-05, étendu step-29)
//
// Extensions futures (ajoutées dans les steps suivants) :
//   - UnlockOverlay   : animation de débloquage d'environnement (step-27)
//   - EndScreen       : écran final board:complete (step-28)

import SaveManager from '../utils/SaveManager.js';

// ── OptionsOverlay ─────────────────────────────────────────────────────────

/**
 * Overlay semi-transparent affiché par MenuScene avec la touche O.
 * Gère les toggles musique / SFX et persiste via SaveManager.
 */
export class OptionsOverlay {
  /**
   * @param {Phaser.Scene} scene  Scène parente
   */
  constructor(scene) {
    this._scene = scene;
    this._container = null;
    this._musicLabel = null;
    this._sfxLabel = null;
    this._visible = false;
  }

  /**
   * Crée les objets Phaser.
   * Doit être appelé une seule fois dans create() de la scène parente.
   */
  build() {
    const scene = this._scene;
    const W = scene.cameras.main.width;
    const H = scene.cameras.main.height;
    const cx = W / 2;
    const cy = H / 2;

    // Fond semi-transparent (couvre tout le canvas)
    const bg = scene.add.rectangle(cx, cy, W, H, 0x000000, 0.82)
      .setInteractive(); // bloque les clics derrière

    // Cadre
    const frame = scene.add.graphics();
    frame.lineStyle(1, 0xd4a017, 0.6);
    frame.strokeRect(cx - 80, cy - 55, 160, 110);

    // Titre
    const title = scene.add.text(cx, cy - 38, 'OPTIONS', {
      fontFamily: 'PixelFont, "Press Start 2P", monospace',
      fontSize: '10px',
      color: '#d4a017',
    }).setOrigin(0.5);

    // Toggle musique
    this._musicLabel = scene.add.text(cx, cy - 10, '', {
      fontFamily: 'PixelFont, "Press Start 2P", monospace',
      fontSize: '7px',
      color: '#e8e8d8',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    // Toggle SFX
    this._sfxLabel = scene.add.text(cx, cy + 10, '', {
      fontFamily: 'PixelFont, "Press Start 2P", monospace',
      fontSize: '7px',
      color: '#e8e8d8',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    // Hint fermeture
    const hint = scene.add.text(cx, cy + 38, 'ECHAP — FERMER', {
      fontFamily: 'PixelFont, "Press Start 2P", monospace',
      fontSize: '5px',
      color: '#8a8a9a',
    }).setOrigin(0.5);

    this._container = scene.add.container(0, 0, [bg, frame, title, this._musicLabel, this._sfxLabel, hint]);
    this._container.setDepth(100);
    this._container.setVisible(false);

    // Clics sur les labels
    this._musicLabel.on('pointerdown', () => this._toggleMusic());
    this._sfxLabel.on('pointerdown', () => this._toggleSfx());

    this._updateLabels();
  }

  /** Affiche l'overlay et rafraîchit les labels */
  show() {
    this._updateLabels();
    this._container.setVisible(true);
    this._visible = true;
  }

  /** Cache l'overlay */
  hide() {
    this._container.setVisible(false);
    this._visible = false;
  }

  /** @returns {boolean} */
  isVisible() {
    return this._visible;
  }

  // ── Logique interne ────────────────────────────────────────────────────────

  _toggleMusic() {
    const save = SaveManager.load();
    if (!save) return;
    SaveManager.patch({ settings: { ...save.settings, musicEnabled: !save.settings.musicEnabled } });
    this._updateLabels();
  }

  _toggleSfx() {
    const save = SaveManager.load();
    if (!save) return;
    SaveManager.patch({ settings: { ...save.settings, sfxEnabled: !save.settings.sfxEnabled } });
    this._updateLabels();
  }

  _updateLabels() {
    const save = SaveManager.load();
    const settings = save ? save.settings : { musicEnabled: true, sfxEnabled: true };
    const colorOn = '#2ecc71';
    const colorOff = '#8a8a9a';

    this._musicLabel
      .setText(`[♪] MUSIQUE : ${settings.musicEnabled ? 'ON' : 'OFF'}`)
      .setColor(settings.musicEnabled ? colorOn : colorOff);

    this._sfxLabel
      .setText(`[♦] SFX : ${settings.sfxEnabled ? 'ON' : 'OFF'}`)
      .setColor(settings.sfxEnabled ? colorOn : colorOff);
  }
}

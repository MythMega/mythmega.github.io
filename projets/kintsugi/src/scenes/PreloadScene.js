// PreloadScene.js — Chargement de tous les assets du jeu
// Référence : _specifications/technical-architecture.md §3, assets-specification.md
//
// Flux en deux phases :
//   Phase 1 (preload) : charger les 3 fichiers manifeste JSON (tiny, rapide)
//   Phase 2 (create)  : parser les manifestes, queuer tous les assets, lancer this.load.start()
//
// Gestion des assets manquants : loaderror est logué mais ne bloque pas.
// Les assets réels seront ajoutés progressivement (step-31).

import { GAME_WIDTH, GAME_HEIGHT, COLORS } from '../config.js';

// Hauteur de la barre de progression (pixels internes 640×360)
const BAR_W = 300;
const BAR_H = 8;
const BAR_X = (GAME_WIDTH - BAR_W) / 2;
const BAR_Y = GAME_HEIGHT / 2 + 20;

export default class PreloadScene extends Phaser.Scene {
  constructor() {
    super({ key: 'PreloadScene' });

    /** @type {Phaser.GameObjects.Graphics} */
    this._barFill = null;
    /** @type {Phaser.GameObjects.Text} */
    this._labelText = null;
    /** @type {number} Nombre d'erreurs de chargement (assets manquants) */
    this._errorCount = 0;
  }

  // ── Phase 1 : charger les manifestes ───────────────────────────────────────

  preload() {
    this.load.json('manifest_images', 'manifests/images.json');
    this.load.json('manifest_audio', 'manifests/audio.json');
    this.load.json('manifest_fonts', 'manifests/fonts.json');
  }

  // ── Phase 2 : parser, queuer et charger tous les assets ───────────────────

  create() {
    this.cameras.main.setBackgroundColor(COLORS.bg);

    this._createLoadingUI();
    this._loadFonts();
    this._queueImages();
    this._queueAudio();

    // Gestion des erreurs (assets pas encore créés — ok pour le dev)
    this.load.on('loaderror', (file) => {
      this._errorCount++;
      console.warn(`[PreloadScene] Asset manquant : ${file.src}`);
    });

    // Progression
    this.load.on('progress', (value) => this._updateBar(value));

    // Fin du chargement → MenuScene
    this.load.on('complete', () => {
      if (this._errorCount > 0) {
        console.warn(`[PreloadScene] ${this._errorCount} asset(s) manquant(s) — le jeu continuera avec des placeholders.`);
      }
      this._showReady();
      // Court délai pour que l'UI "PRÊT" soit visible une fraction de seconde
      this.time.delayedCall(300, () => this.scene.start('MenuScene'));
    });

    // Lancer le chargement phase 2
    this.load.start();
  }

  // ── UI de chargement ───────────────────────────────────────────────────────

  _createLoadingUI() {
    const cx = GAME_WIDTH / 2;
    const cy = GAME_HEIGHT / 2;

    // Titre
    this.add.text(cx, cy - 30, '金継ぎ  KINTSUGI', {
      fontFamily: 'monospace',
      fontSize: '10px',
      color: '#d4a017',
    }).setOrigin(0.5);

    this.add.text(cx, cy - 16, 'CHARGEMENT…', {
      fontFamily: 'monospace',
      fontSize: '7px',
      color: '#8a8a9a',
    }).setOrigin(0.5);

    // Contour de la barre (1px border, pixel art)
    const border = this.add.graphics();
    border.lineStyle(1, 0x8a8a9a, 1);
    border.strokeRect(BAR_X - 1, BAR_Y - 1, BAR_W + 2, BAR_H + 2);

    // Fond de la barre
    const bg = this.add.graphics();
    bg.fillStyle(0x1a1a2e, 1);
    bg.fillRect(BAR_X, BAR_Y, BAR_W, BAR_H);

    // Remplissage (mis à jour dans _updateBar)
    this._barFill = this.add.graphics();

    // Label pourcentage
    this._labelText = this.add.text(cx, BAR_Y + BAR_H + 8, '0 %', {
      fontFamily: 'monospace',
      fontSize: '6px',
      color: '#8a8a9a',
    }).setOrigin(0.5);
  }

  _updateBar(value) {
    this._barFill.clear();
    this._barFill.fillStyle(COLORS.crackGold, 1);
    this._barFill.fillRect(BAR_X, BAR_Y, Math.floor(BAR_W * value), BAR_H);
    this._labelText.setText(`${Math.floor(value * 100)} %`);
  }

  _showReady() {
    this._updateBar(1);
    this._labelText.setColor('#f5c842').setText('PRÊT');
  }

  // ── Fonts ──────────────────────────────────────────────────────────────────

  _loadFonts() {
    const manifest = this.cache.json.get('manifest_fonts');
    if (!manifest || !manifest.fonts) return;

    manifest.fonts.forEach((font) => {
      // Tenter de charger la police locale
      // Phaser n'a pas de loader natif pour TTF — on utilise FontFace API
      this._loadFontFace(font.family, font.path);
    });
  }

  /**
   * Charge une police TTF via FontFace API (web standard).
   * Si elle échoue, la police alternative (Google Fonts) est chargée via CSS.
   * @param {string} family  Nom de la famille CSS
   * @param {string} path    Chemin vers le fichier TTF
   */
  _loadFontFace(family, path) {
    const face = new FontFace(family, `url(${path})`);
    face.load()
      .then((loaded) => {
        document.fonts.add(loaded);
        console.log(`[PreloadScene] Police chargée : ${family}`);
      })
      .catch(() => {
        console.warn(`[PreloadScene] Police locale introuvable : ${path} — utilisation du fallback`);
        this._loadGoogleFontsFallback();
      });
  }

  /** Injecte le CSS Google Fonts en fallback (une seule fois) */
  _loadGoogleFontsFallback() {
    if (document.getElementById('kintsugi-fonts-fallback')) return;
    const link = document.createElement('link');
    link.id = 'kintsugi-fonts-fallback';
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Press+Start+2P&family=DotGothic16&display=swap';
    document.head.appendChild(link);
  }

  // ── Images ─────────────────────────────────────────────────────────────────

  _queueImages() {
    const manifest = this.cache.json.get('manifest_images');
    if (!manifest) return;

    // Images simples
    (manifest.images || []).forEach(({ key, path }) => {
      this.load.image(key, path);
    });

    // Spritesheets
    (manifest.spritesheets || []).forEach(({ key, path, frameWidth, frameHeight }) => {
      this.load.spritesheet(key, path, { frameWidth, frameHeight });
    });

    // 60 cracks individuelles (crack_00 … crack_59)
    const cracks = manifest.cracks;
    if (cracks) {
      for (let i = 0; i < cracks.count; i++) {
        const index = String(i).padStart(2, '0');
        const key = cracks.keyPattern.replace('{index}', index);
        const path = `${cracks.basePath}crack_${index}.png`;
        this.load.image(key, path);
      }
    }

    // Tilesets
    (manifest.tilesets || []).forEach(({ key, path }) => {
      this.load.image(key, path);
    });

    // Thumbnails d'environnements
    (manifest.env_thumbnails || []).forEach(({ key, path }) => {
      this.load.image(key, path);
    });
  }

  // ── Audio ──────────────────────────────────────────────────────────────────

  _queueAudio() {
    const manifest = this.cache.json.get('manifest_audio');
    if (!manifest) return;

    // SFX
    (manifest.sfx || []).forEach(({ key, path }) => {
      this.load.audio(key, path);
    });

    // Ambiances
    (manifest.ambient || []).forEach(({ key, path }) => {
      this.load.audio(key, path);
    });

    // Musiques
    (manifest.music || []).forEach(({ key, path }) => {
      this.load.audio(key, path);
    });
  }
}

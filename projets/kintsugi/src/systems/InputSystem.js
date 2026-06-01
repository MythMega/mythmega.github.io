// InputSystem.js — Buffer d'inputs et mapping clavier
// Référence : _specifications/controls-input.md, tricks-system.md §5
//
// Fonctionnement :
//   Chaque frame, toutes les touches configurées sont échantillonnées.
//   Les événements "vient d'être pressé" sont ajoutés au buffer circulaire
//   avec un timestamp. Le TrickSystem interroge le buffer via getBuffer()
//   ou matchSequence() pour détecter les tricks.
//
// Mapping logique → physique :
//   LEFT / RIGHT / UP / DOWN  → ArrowLeft/Right/Up/Down
//   JUMP                       → SPACE
//   MOD_A                      → Z
//   MOD_B                      → X
//   MOD_C                      → C
//   GRIND                      → G
//   MANUAL                     → M
//   RESET                      → R

import { INPUT_BUFFER, COYOTE_TIME } from '../config.js';

// ── Mapping logique → KeyCodes Phaser ─────────────────────────────────────
const KEY_MAP = {
  LEFT:   'LEFT',
  RIGHT:  'RIGHT',
  UP:     'UP',
  DOWN:   'DOWN',
  JUMP:   'SPACE',
  MOD_A:  'Z',
  MOD_B:  'X',
  MOD_C:  'C',
  GRIND:  'G',
  MANUAL: 'M',
  RESET:  'R',
};

// Toutes les clés logiques
const ALL_LOGICAL_KEYS = Object.keys(KEY_MAP);

export default class InputSystem {
  /**
   * @param {Phaser.Scene} scene  Scène parente
   */
  constructor(scene) {
    this._scene = scene;

    /** @type {Map<string, Phaser.Input.Keyboard.Key>} clé logique → Key Phaser */
    this._keys = new Map();

    /** @type {{ key: string, time: number }[]} Buffer circulaire d'inputs */
    this._buffer = [];

    /** @type {number} Durée de rétention du buffer en ms */
    this._bufferWindow = INPUT_BUFFER;

    /** @type {Map<string, boolean>} État "maintenu" du frame précédent */
    this._prevDown = new Map();

    this._registerKeys();
  }

  // ── API publique ───────────────────────────────────────────────────────────

  /**
   * Mise à jour — appeler chaque frame depuis la scène.
   * @param {number} time  Temps absolu Phaser (ms)
   */
  update(time) {
    // Purge les entrées trop vieilles du buffer
    this._pruneBuffer(time);

    // Détecter les "just pressed" et les ajouter au buffer
    for (const logical of ALL_LOGICAL_KEYS) {
      const key = this._keys.get(logical);
      if (!key) continue;

      const downNow = key.isDown;
      const downPrev = this._prevDown.get(logical) || false;

      if (downNow && !downPrev) {
        // Nouvelle pression ce frame
        this._buffer.push({ key: logical, time });
      }

      this._prevDown.set(logical, downNow);
    }
  }

  /**
   * Retourne true si la touche logique est actuellement maintenue.
   * @param {string} logical  ex: 'LEFT', 'JUMP', 'MOD_A'
   * @returns {boolean}
   */
  isDown(logical) {
    const key = this._keys.get(logical);
    return key ? key.isDown : false;
  }

  /**
   * Retourne true si la touche vient d'être pressée ce frame.
   * @param {string} logical
   * @returns {boolean}
   */
  wasJustPressed(logical) {
    const key = this._keys.get(logical);
    return key ? Phaser.Input.Keyboard.JustDown(key) : false;
  }

  /**
   * Retourne tous les inputs dans la fenêtre de temps spécifiée.
   * @param {number} time       Temps courant (ms)
   * @param {number} [windowMs] Fenêtre (défaut : INPUT_BUFFER)
   * @returns {{ key: string, time: number }[]}  Du plus ancien au plus récent
   */
  getBuffer(time, windowMs) {
    const win = windowMs !== undefined ? windowMs : this._bufferWindow;
    const cutoff = time - win;
    return this._buffer.filter((e) => e.time >= cutoff);
  }

  /**
   * Retourne uniquement les clés logiques présentes dans la fenêtre.
   * @param {number} time
   * @param {number} [windowMs]
   * @returns {string[]}  Liste de clés sans doublons, ordre chronologique
   */
  getBufferedSequence(time, windowMs) {
    const seen = new Set();
    return this.getBuffer(time, windowMs)
      .map((e) => e.key)
      .filter((k) => {
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
  }

  /**
   * Vérifie si toutes les clés du pattern sont présentes dans le buffer
   * (dans n'importe quel ordre, dans la fenêtre).
   * @param {string[]} pattern   ex: ['MOD_A', 'JUMP']
   * @param {number}   time      Temps courant
   * @param {number}   [windowMs]
   * @returns {boolean}
   */
  matchSequence(pattern, time, windowMs) {
    const buffered = new Set(this.getBufferedSequence(time, windowMs));
    return pattern.every((k) => buffered.has(k));
  }

  /**
   * Vide tout le buffer (appelé après chaque trick détecté ou à l'atterrissage).
   */
  consumeBuffer() {
    this._buffer = [];
  }

  /**
   * Vide uniquement les clés spécifiées du buffer.
   * @param {string[]} keys  Clés logiques à retirer
   */
  consumeKeys(keys) {
    const toRemove = new Set(keys);
    this._buffer = this._buffer.filter((e) => !toRemove.has(e.key));
  }

  /**
   * Retourne les cursors Phaser standard (compatible avec les appels
   * legacy Skater.update() en step-07 mode).
   * @returns {Phaser.Types.Input.Keyboard.CursorKeys}
   */
  getCursors() {
    return this._cursors;
  }

  /**
   * Libère toutes les clés clavier enregistrées.
   * Appeler dans shutdown() de la scène.
   */
  destroy() {
    for (const key of this._keys.values()) {
      key.destroy();
    }
    this._keys.clear();
    this._buffer = [];
  }

  // ── Privé ──────────────────────────────────────────────────────────────────

  _registerKeys() {
    const kb = this._scene.input.keyboard;

    for (const [logical, code] of Object.entries(KEY_MAP)) {
      const phKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes[code]);
      this._keys.set(logical, phKey);
      this._prevDown.set(logical, false);
    }

    // Cursors standard (pour compatibilité step-07)
    this._cursors = kb.createCursorKeys();
    // Ajouter SPACE aux cursors si absent
    this._cursors.space = this._keys.get('JUMP');
  }

  /**
   * Supprime du buffer les entrées plus vieilles que la fenêtre.
   * @param {number} time  Temps courant
   */
  _pruneBuffer(time) {
    const cutoff = time - this._bufferWindow;
    // Garder seulement les entrées récentes (buffer est chronologique)
    let i = 0;
    while (i < this._buffer.length && this._buffer[i].time < cutoff) {
      i++;
    }
    if (i > 0) this._buffer = this._buffer.slice(i);
  }
}

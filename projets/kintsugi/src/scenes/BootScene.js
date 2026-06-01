// BootScene.js — Initialisation et détection de sauvegarde
// Référence : _specifications/technical-architecture.md §3
//
// Rôle :
//   1. Charger progression.json (template de l'état initial)
//   2. Vérifier si une sauvegarde existe en localStorage
//   3. Si non → copier le template comme sauvegarde initiale
//   4. Si oui → migrer si version obsolète
//   5. Lancer PreloadScene
//
// Cette scène ne charge AUCUN asset visuel — pas de preload().
// Elle est volontairement rapide et silencieuse.

import SaveManager from '../utils/SaveManager.js';

const CURRENT_SAVE_VERSION = '1.0';

export default class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  init() {
    // Pas de données passées à cette scène — point d'entrée du jeu
  }

  preload() {
    // Charger uniquement le template de progression (JSON léger, pas d'assets)
    this.load.json('progressionTemplate', 'src/data/progression.json');
  }

  create() {
    const template = this.cache.json.get('progressionTemplate');
    this._initSave(template);
    this.scene.start('PreloadScene');
  }

  // ── Logique privée ─────────────────────────────────────────────────────────

  /**
   * Vérifie et initialise la sauvegarde localStorage.
   * @param {Object} template  Contenu de progression.json
   */
  _initSave(template) {
    if (!SaveManager.exists()) {
      // Nouveau joueur — on copie le template (sans le champ _comment)
      const initial = this._cleanTemplate(template);
      SaveManager.save(initial);
      console.log('[BootScene] Nouvelle sauvegarde créée.');
      return;
    }

    const existing = SaveManager.load();

    if (!existing) {
      // Données corrompues — SaveManager.load() a déjà reset, on recrée
      SaveManager.save(this._cleanTemplate(template));
      console.warn('[BootScene] Sauvegarde corrompue, réinitialisée.');
      return;
    }

    // Migration de version si nécessaire
    if (existing.version !== CURRENT_SAVE_VERSION) {
      const migrated = this._migrate(existing, template);
      SaveManager.save(migrated);
      console.log(`[BootScene] Sauvegarde migrée → v${CURRENT_SAVE_VERSION}`);
    }
  }

  /**
   * Retourne une copie propre du template (sans _comment).
   * @param {Object} template
   * @returns {Object}
   */
  _cleanTemplate(template) {
    const { _comment, ...clean } = template;
    return clean;
  }

  /**
   * Migre une sauvegarde ancienne vers la version courante.
   * Principe : conserver les données existantes, ajouter les champs manquants
   * depuis le template, ne jamais supprimer de données acquises.
   * @param {Object} existing  Sauvegarde actuelle
   * @param {Object} template  Template de référence
   * @returns {Object}  Sauvegarde migrée
   */
  _migrate(existing, template) {
    const clean = this._cleanTemplate(template);

    // Fusionner les cracks : conserver les états acquis, ajouter les nouveaux à 'absent'
    const mergedCracks = Object.assign({}, clean.cracks, existing.cracks);

    // Fusionner les settings : conserver les préférences du joueur
    const mergedSettings = Object.assign({}, clean.settings, existing.settings);

    // Fusionner les stats (conserver les plus élevées)
    const mergedStats = Object.assign({}, clean.stats, existing.stats);

    return {
      ...clean,
      ...existing,
      version: CURRENT_SAVE_VERSION,
      cracks: mergedCracks,
      settings: mergedSettings,
      stats: mergedStats,
    };
  }
}

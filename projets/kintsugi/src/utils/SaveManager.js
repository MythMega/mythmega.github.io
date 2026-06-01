// SaveManager.js — Wrapper localStorage
// Référence : _specifications/technical-architecture.md §5.8
//
// Clé de sauvegarde : 'kokoro_kintsugi_save'
// Le format du contenu est défini dans src/data/progression.json.
//
// Usage :
//   import SaveManager from '../utils/SaveManager.js';
//   SaveManager.save({ version: '1.0', cracks: { ... }, settings: { ... } });
//   const data = SaveManager.load(); // null si aucune sauvegarde

import { SAVE_KEY } from '../config.js';

const SaveManager = {
  /**
   * Sauvegarde les données de progression en localStorage.
   * @param {Object} data  Objet de progression complet.
   */
  save(data) {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('[SaveManager] Impossible d\'écrire en localStorage :', e);
    }
  },

  /**
   * Charge et parse les données de progression.
   * @returns {Object|null} Données parsées, ou null si aucune sauvegarde.
   */
  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.warn('[SaveManager] Données corrompues, reset :', e);
      this.clear();
      return null;
    }
  },

  /**
   * Supprime la sauvegarde (reset complet).
   */
  clear() {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch (e) {
      console.warn('[SaveManager] Impossible de supprimer la sauvegarde :', e);
    }
  },

  /**
   * Vérifie si une sauvegarde existe.
   * @returns {boolean}
   */
  exists() {
    try {
      return localStorage.getItem(SAVE_KEY) !== null;
    } catch (e) {
      return false;
    }
  },

  /**
   * Met à jour partiellement la sauvegarde existante.
   * Si aucune sauvegarde n'existe, crée un nouvel objet avec les données fournies.
   * @param {Object} partial  Champs à fusionner dans la sauvegarde actuelle.
   */
  patch(partial) {
    const current = this.load() || {};
    this.save(Object.assign({}, current, partial));
  },
};

export default SaveManager;

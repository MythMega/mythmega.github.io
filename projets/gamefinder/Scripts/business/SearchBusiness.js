/**
 * SearchBusiness.js
 * Logique métier pour la recherche dynamique multi-type.
 * Cherche dans : games.name, game_genres.genre, game_platforms.platform,
 *                game_modes_rel.mode, game_themes.theme,
 *                game_developers.company_name, franchises.name
 *
 * Limite : 3 résultats par type.
 * Déclenchement : à partir de 3 caractères.
 * La recherche est annulée si le texte est mis à jour avant la fin.
 */

class SearchBusiness {
  /**
   * @param {Database} db
   */
  constructor(db) {
    this.db           = db;
    this._currentId   = 0; // ID de requête courant — pour annulation
  }

  /**
   * Lance une recherche multi-type et retourne un tableau de résultats groupés.
   * Chaque résultat : { id, name, type }
   * @param {string} term
   * @returns {Promise<Array<{id:number|string, name:string, type:string}>>}
   */
  async search(term) {
    if (!term || term.trim().length < 3) {
      console.log('[SearchBusiness] Terme trop court, recherche annulée');
      return [];
    }

    const searchId = ++this._currentId;
    const like     = `%${term.trim()}%`;
    console.log(`[SearchBusiness] Recherche #${searchId} pour :`, term);

    const results = [];

    // Garde-fou d'annulation
    const isCancelled = () => searchId !== this._currentId;

    try {
      // --- Jeux ---
      const games = this.db.query(
        `SELECT id, name FROM games WHERE name LIKE ? LIMIT 3`,
        [like]
      );
      if (isCancelled()) { console.log(`[SearchBusiness] #${searchId} annulée`); return []; }
      games.forEach(r => results.push({ id: r.id, name: r.name, type: 'game' }));

      // --- Genres ---
      const genres = this.db.query(
        `SELECT DISTINCT genre FROM game_genres WHERE genre LIKE ? LIMIT 3`,
        [like]
      );
      if (isCancelled()) return [];
      genres.forEach(r => results.push({ id: null, name: r.genre, type: 'genre' }));

      // --- Plateformes ---
      const platforms = this.db.query(
        `SELECT DISTINCT platform FROM game_platforms WHERE platform LIKE ? LIMIT 3`,
        [like]
      );
      if (isCancelled()) return [];
      platforms.forEach(r => results.push({ id: null, name: r.platform, type: 'platform' }));

      // --- Modes de jeu ---
      const modes = this.db.query(
        `SELECT DISTINCT mode FROM game_modes_rel WHERE mode LIKE ? LIMIT 3`,
        [like]
      );
      if (isCancelled()) return [];
      modes.forEach(r => results.push({ id: null, name: r.mode, type: 'mode' }));

      // --- Thèmes ---
      const themes = this.db.query(
        `SELECT DISTINCT theme FROM game_themes WHERE theme LIKE ? LIMIT 3`,
        [like]
      );
      if (isCancelled()) return [];
      themes.forEach(r => results.push({ id: null, name: r.theme, type: 'theme' }));

      // --- Développeurs ---
      const devs = this.db.query(
        `SELECT DISTINCT company_id, company_name FROM game_developers WHERE company_name LIKE ? LIMIT 3`,
        [like]
      );
      if (isCancelled()) return [];
      devs.forEach(r => results.push({ id: r.company_id, name: r.company_name, type: 'developer' }));

      // --- Franchises ---
      const franchises = this.db.query(
        `SELECT id, name FROM franchises WHERE name LIKE ? LIMIT 3`,
        [like]
      );
      if (isCancelled()) return [];
      franchises.forEach(r => results.push({ id: r.id, name: r.name, type: 'franchise' }));

      console.log(`[SearchBusiness] #${searchId} → ${results.length} résultats`);
      return results;

    } catch (e) {
      console.error('[SearchBusiness] Erreur lors de la recherche :', e);
      return [];
    }
  }

  /** Annule toute recherche en cours (incrément de l'ID). */
  cancel() {
    this._currentId++;
    console.log('[SearchBusiness] Recherche annulée manuellement');
  }
}

window.SearchBusiness = SearchBusiness;

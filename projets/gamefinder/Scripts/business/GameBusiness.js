/**
 * GameBusiness.js
 * Logique métier pour la récupération et l'enrichissement des jeux.
 */

class GameBusiness {
  /**
   * @param {Database} db
   */
  constructor(db) {
    this.db = db;
  }

  /**
   * Récupère un jeu par son ID avec toutes ses relations.
   * @param {number} id
   * @returns {Game|null}
   */
  getById(id) {
    console.log('[GameBusiness] getById :', id);
    const row = this.db.queryOne(`SELECT * FROM games WHERE id = ?`, [id]);
    if (!row) { console.warn('[GameBusiness] Jeu introuvable :', id); return null; }

    const game = Game.fromRow(row);
    this._enrich(game);
    return game;
  }

  /**
   * Liste paginée de jeux (30 par page).
   * Les IDs manquants sont ignorés.
   * @param {number} page - 1-based
   * @returns {{games: Game[], page: number, hasNext: boolean}}
   */
  getList(page = 1) {
    const limit  = 30;
    const offset = (page - 1) * limit;
    console.log(`[GameBusiness] getList page=${page} offset=${offset}`);

    const rows = this.db.query(
      `SELECT id, name, cover_url, aggregated_rating, rating, first_release_date
       FROM games ORDER BY id ASC LIMIT ? OFFSET ?`,
      [limit + 1, offset]
    );

    const hasNext = rows.length > limit;
    const games   = rows.slice(0, limit).map(r => Game.fromRow(r));
    console.log(`[GameBusiness] getList → ${games.length} jeux, hasNext=${hasNext}`);
    return { games, page, hasNext };
  }

  /**
   * Enrichit un objet Game avec toutes ses relations.
   * @param {Game} game
   */
  _enrich(game) {
    game.genres = this.db.query(
      `SELECT genre FROM game_genres WHERE game_id = ?`, [game.id]
    ).map(r => r.genre);

    game.platforms = this.db.query(
      `SELECT platform FROM game_platforms WHERE game_id = ?`, [game.id]
    ).map(r => r.platform);

    game.modes = this.db.query(
      `SELECT mode FROM game_modes_rel WHERE game_id = ?`, [game.id]
    ).map(r => r.mode);

    game.themes = this.db.query(
      `SELECT theme FROM game_themes WHERE game_id = ?`, [game.id]
    ).map(r => r.theme);

    game.perspectives = this.db.query(
      `SELECT perspective FROM game_perspectives WHERE game_id = ?`, [game.id]
    ).map(r => r.perspective);

    game.developers = this.db.query(
      `SELECT company_id, company_name FROM game_developers WHERE game_id = ?`, [game.id]
    );

    game.screenshots = this.db.query(
      `SELECT url FROM game_screenshots WHERE game_id = ?`, [game.id]
    );

    game.videos = this.db.query(
      `SELECT youtube_id FROM game_videos WHERE game_id = ?`, [game.id]
    );

    game.keywords = this.db.query(
      `SELECT keyword FROM game_keywords WHERE game_id = ?`, [game.id]
    ).map(r => r.keyword);

    console.log(`[GameBusiness] Jeu #${game.id} enrichi :`, {
      genres: game.genres.length,
      platforms: game.platforms.length,
      developers: game.developers.length
    });
  }
}

window.GameBusiness = GameBusiness;

/**
 * FranchiseBusiness.js
 * Logique métier pour les franchises.
 */

class FranchiseBusiness {
  constructor(db) {
    this.db = db;
  }

  /**
   * @param {number} id
   * @returns {{franchise: Franchise, games: Game[]}|null}
   */
  getById(id) {
    console.log('[FranchiseBusiness] getById :', id);
    const row = this.db.queryOne(`SELECT * FROM franchises WHERE id = ?`, [id]);
    if (!row) { console.warn('[FranchiseBusiness] Franchise introuvable :', id); return null; }

    const franchise = Franchise.fromRow(row);

    const gameRows = this.db.query(
      `SELECT g.id, g.name, g.cover_url, g.first_release_date
       FROM game_franchises gf
       JOIN games g ON g.id = gf.game_id
       WHERE gf.franchise = ?
       ORDER BY g.first_release_date DESC`,
      [franchise.name]
    );
    const games = gameRows.map(r => Game.fromRow(r));
    console.log(`[FranchiseBusiness] Franchise #${id} → ${games.length} jeux`);
    return { franchise, games };
  }

  /**
   * Liste paginée des franchises avec cover du dernier jeu via game_franchises.
   * @param {number} page
   */
  getList(page = 1) {
    const limit  = 30;
    const offset = (page - 1) * limit;
    const rows   = this.db.query(
      `SELECT f.id, f.name,
         (SELECT g.cover_url FROM games g
          JOIN game_franchises gf ON gf.game_id = g.id
          WHERE gf.franchise = f.name AND g.cover_url IS NOT NULL
          ORDER BY g.first_release_date DESC LIMIT 1) AS cover_url
       FROM franchises f ORDER BY f.name ASC LIMIT ? OFFSET ?`,
      [limit + 1, offset]
    );
    const hasNext = rows.length > limit;
    const items   = rows.slice(0, limit).map(r => {
      const f = Franchise.fromRow(r);
      f.cover_url = r.cover_url || null;
      return f;
    });
    return { items, page, hasNext };
  }
}

window.FranchiseBusiness = FranchiseBusiness;

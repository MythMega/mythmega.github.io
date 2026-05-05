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
    // Note : la DB n'a pas de table game_franchises, on cherche dans les noms de jeux si besoin
    // Pour l'instant on retourne la franchise seule
    return { franchise, games: [] };
  }

  /**
   * Liste paginée des franchises.
   * @param {number} page
   */
  getList(page = 1) {
    const limit  = 30;
    const offset = (page - 1) * limit;
    const rows   = this.db.query(
      `SELECT * FROM franchises ORDER BY name ASC LIMIT ? OFFSET ?`,
      [limit + 1, offset]
    );
    const hasNext = rows.length > limit;
    const items   = rows.slice(0, limit).map(r => Franchise.fromRow(r));
    return { items, page, hasNext };
  }
}

window.FranchiseBusiness = FranchiseBusiness;

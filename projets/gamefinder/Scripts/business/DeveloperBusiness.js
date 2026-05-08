/**
 * DeveloperBusiness.js
 * Logique métier pour les développeurs.
 */

class DeveloperBusiness {
  constructor(db) {
    this.db = db;
  }

  /**
   * Récupère un développeur par son company_id.
   * @param {number} id
   * @returns {{id:number, name:string, games:Game[]}|null}
   */
  getById(id) {
    console.log('[DeveloperBusiness] getById :', id);
    const row = this.db.queryOne(
      `SELECT company_id, company_name, url, logo_url FROM game_developers WHERE company_id = ? LIMIT 1`, [id]
    );
    if (!row) { console.warn('[DeveloperBusiness] Développeur introuvable :', id); return null; }

    const dev   = Developer.fromRow(row);
    dev.gameIds = this.db.query(
      `SELECT game_id FROM game_developers WHERE company_id = ?`, [id]
    ).map(r => r.game_id);

    // Récupérer les jeux associés (infos minimales)
    const games = dev.gameIds.map(gid => {
      const g = this.db.queryOne(
        `SELECT id, name, cover_url, first_release_date FROM games WHERE id = ?`, [gid]
      );
      return g ? Game.fromRow(g) : null;
    }).filter(Boolean);

    console.log(`[DeveloperBusiness] Dev #${id} → ${games.length} jeux`);
    return { dev, games };
  }

  /**
   * Liste paginée des développeurs (30 par page).
   * @param {number} page
   * @returns {{items: Developer[], page: number, hasNext: boolean}}
   */
  getList(page = 1) {
    const limit  = 30;
    const offset = (page - 1) * limit;
    const rows   = this.db.query(
      `SELECT company_id, company_name, url, logo_url FROM game_developers GROUP BY company_id ORDER BY company_name ASC LIMIT ? OFFSET ?`,
      [limit + 1, offset]
    );
    const hasNext = rows.length > limit;
    const items   = rows.slice(0, limit).map(r => Developer.fromRow(r));
    return { items, page, hasNext };
  }
}

window.DeveloperBusiness = DeveloperBusiness;

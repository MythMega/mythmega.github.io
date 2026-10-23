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

    const dev = Developer.fromRow(row);

    const totalRow = this.db.queryOne(
      `SELECT COUNT(DISTINCT game_id) AS cnt FROM game_developers WHERE company_id = ?`, [id]
    );
    const totalGames = totalRow ? (totalRow.cnt || 0) : 0;

    // Une seule requête jointe plutôt qu'une requête par jeu (N+1),
    // bornée pour ne jamais construire des milliers de cartes d'un coup.
    const games = this.db.query(
      `SELECT g.id, g.name, g.cover_url, g.first_release_date
         FROM game_developers d
         JOIN games g ON g.id = d.game_id
        WHERE d.company_id = ?
        GROUP BY g.id
        ORDER BY g.first_release_date DESC
        LIMIT 60`,
      [id]
    ).map(r => Game.fromRow(r));
    dev.gameIds = games.map(g => g.id);

    console.log(`[DeveloperBusiness] Dev #${id} → ${totalGames} jeux (${games.length} affichés)`);
    return { dev, games, totalGames };
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

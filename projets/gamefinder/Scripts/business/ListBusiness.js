/**
 * ListBusiness.js
 * Logique métier générique pour les listes paginées.
 * Délègue aux businesses spécialisés selon le type.
 */

class ListBusiness {
  /**
   * @param {GameBusiness}      gameBusiness
   * @param {DeveloperBusiness} developerBusiness
   * @param {FranchiseBusiness} franchiseBusiness
   * @param {Database}          db  (pour genres, platforms, themes)
   */
  constructor(gameBusiness, developerBusiness, franchiseBusiness, db) {
    this.gameBusiness      = gameBusiness;
    this.developerBusiness = developerBusiness;
    this.franchiseBusiness = franchiseBusiness;
    this.db                = db;
  }

  /**
   * Retourne une liste paginée selon le type.
   * @param {string} type  - 'game'|'developer'|'franchise'|'genre'|'platform'|'theme'
   * @param {number} page  - 1-based
   * @returns {{items: Object[], page: number, hasNext: boolean, type: string}}
   */
  getList(type, page = 1) {
    console.log(`[ListBusiness] getList type=${type} page=${page}`);
    const limit  = 30;
    const offset = (page - 1) * limit;

    switch (type) {
      case 'game':
        return this._wrap(this.gameBusiness.getList(page), type);

      case 'developer':
        return this._wrap(this.developerBusiness.getList(page), type);

      case 'franchise':
        return this._wrap(this.franchiseBusiness.getList(page), type);

      case 'genre': {
        const rows = this.db.query(
          `SELECT id, name FROM genres ORDER BY name ASC LIMIT ? OFFSET ?`,
          [limit + 1, offset]
        );
        return this._buildResult(rows, page, type);
      }

      case 'platform': {
        const rows = this.db.query(
          `SELECT id, name, url, logo_url FROM platforms ORDER BY name ASC LIMIT ? OFFSET ?`,
          [limit + 1, offset]
        );
        return this._buildResult(rows, page, type);
      }

      case 'theme': {
        const rows = this.db.query(
          `SELECT id, name FROM themes ORDER BY name ASC LIMIT ? OFFSET ?`,
          [limit + 1, offset]
        );
        return this._buildResult(rows, page, type);
      }

      default:
        console.warn('[ListBusiness] Type inconnu :', type);
        return { items: [], page, hasNext: false, type };
    }
  }

  _buildResult(rows, page, type) {
    const limit   = 30;
    const hasNext = rows.length > limit;
    const items   = rows.slice(0, limit);
    return { items, page, hasNext, type };
  }

  _wrap(result, type) {
    const items = result.games || result.items || [];
    return { items, page: result.page, hasNext: result.hasNext, type };
  }

  /**
   * Retourne la liste des types disponibles pour le menu Données.
   */
  static availableTypes() {
    return [
      { key: 'game',       label: 'Jeux' },
      { key: 'developer',  label: 'Développeurs' },
      { key: 'franchise',  label: 'Franchises' },
      { key: 'genre',      label: 'Genres' },
      { key: 'platform',   label: 'Plateformes' },
      { key: 'theme',      label: 'Thèmes' },
    ];
  }
}

window.ListBusiness = ListBusiness;

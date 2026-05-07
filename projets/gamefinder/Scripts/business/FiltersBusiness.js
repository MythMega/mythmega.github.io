/**
 * FiltersBusiness.js
 * Logique métier pour la page Roulette / Filtres.
 *
 * Responsabilités :
 *  - Charger les données nécessaires aux boxes de filtres (plateformes, modes, genres, thèmes, plage d'années)
 *  - Exécuter la requête de recherche avec les critères sélectionnés
 *  - Encoder / décoder les settings dans l'URL (base64url)
 *  - Fournir les settings par défaut
 */

class FiltersBusiness {
  /** IDs IGDB des plateformes "vedettes" affichées en premier, ON par défaut. */
  static FEATURED_PLATFORM_IDS = [6, 130, 167, 169]; // PC, Nintendo Switch, PS5, Xbox Series X|S

  /**
   * @param {Database} db
   */
  constructor(db) {
    this.db          = db;
    this._filterData = null; // cache — chargé une seule fois
  }

  /**
   * Charge et retourne toutes les données nécessaires aux boxes de filtres.
   * Résultat mis en cache après le premier appel.
   * @returns {{platforms, gameModes, genres, themes, minYear, maxYear}}
   */
  getFilterData() {
    if (this._filterData) return this._filterData;

    console.log('[FiltersBusiness] Chargement des données de filtres…');

    const platforms = this.db.query(`SELECT id, name FROM platforms ORDER BY name ASC`);
    const gameModes = this.db.query(`SELECT id, name FROM game_modes ORDER BY name ASC`);
    const genres    = this.db.query(`SELECT id, name FROM genres    ORDER BY name ASC`);
    const themes    = this.db.query(`SELECT id, name FROM themes    ORDER BY name ASC`);

    // Plage d'années à partir des timestamps UNIX de la table games
    const yearRow = this.db.queryOne(`
      SELECT
        MIN(CAST(strftime('%Y', datetime(first_release_date, 'unixepoch')) AS INTEGER)) AS min_year,
        MAX(CAST(strftime('%Y', datetime(first_release_date, 'unixepoch')) AS INTEGER)) AS max_year
      FROM games
      WHERE first_release_date IS NOT NULL AND first_release_date > 0
    `);

    this._filterData = {
      platforms,
      gameModes,
      genres,
      themes,
      minYear: yearRow ? (yearRow.min_year || 1970) : 1970,
      maxYear: yearRow ? (yearRow.max_year || new Date().getFullYear()) : new Date().getFullYear(),
    };

    console.log('[FiltersBusiness] Données chargées :', {
      platforms: platforms.length,
      gameModes: gameModes.length,
      genres:    genres.length,
      themes:    themes.length,
      yearRange: `${this._filterData.minYear}–${this._filterData.maxYear}`,
    });

    return this._filterData;
  }

  /**
   * Retourne les settings par défaut :
   * - Plateformes vedettes ON, autres OFF
   * - Tous les modes, genres, thèmes ON
   * - Plage d'années complète
   */
  getDefaultSettings() {
    const fd = this.getFilterData();
    return {
      p: [...FiltersBusiness.FEATURED_PLATFORM_IDS],
      y: [fd.minYear, fd.maxYear],
      m: fd.gameModes.map(m => m.id),
      g: fd.genres.map(g => g.id),
      t: fd.themes.map(t => t.id),
      scoreMin:    0,
      scoreMax:    100,
      allowNoScore: false,
      allowFangame: false,
    };
  }

  /**
   * Exécute la requête avec les settings fournis.
   *
   * Stratégie :
   *  - Utilise INTERSECT (ensembles SQLite) plutôt que EXISTS corrélé.
   *    → Le query planner utilise les index créés au chargement (idx_game_*).
   *    → Chaque sous-requête est un index-scan au lieu d'un full-scan.
   *  - Si TOUS les éléments d'une catégorie sont sélectionnés (ou aucun),
   *    le filtre est ignoré (pas de clause INTERSECT inutile).
   *  - Mélange Fisher-Yates en JS (ORDER BY RANDOM() est lent sur 300k+ lignes).
   *
   * @param {Object} settings - { p, y, m, g, t }
   * @returns {number[]} Jusqu'à 50 IDs mélangés
   */
  runQuery(settings) {
    const tTotal = performance.now();
    const fd = this.getFilterData();
    console.groupCollapsed('[FiltersBusiness] ── runQuery ──────────────────────');
    console.log('Settings :', JSON.stringify(settings));

    // ── Plage de timestamps ───────────────────────────────────────
    const minTs = Math.floor(new Date(settings.y[0], 0, 1).getTime() / 1000);
    const maxTs = Math.floor(new Date(settings.y[1], 11, 31, 23, 59, 59).getTime() / 1000);
    console.log(`Plage timestamps : ${minTs} (${settings.y[0]}) → ${maxTs} (${settings.y[1]})`);

    // ── IDs → noms (pour les colonnes TEXT des tables relationnelles) ─
    const t1 = performance.now();
    const toNames = (selectedIds, allItems) => {
      if (!selectedIds || selectedIds.length === 0) return null; // aucun sélectionné = pas de filtre
      if (selectedIds.length >= allItems.length)   return null; // tous sélectionnés = pas de filtre
      const set = new Set(selectedIds);
      return allItems.filter(i => set.has(i.id)).map(i => i.name);
    };
    const sqlList = (names) =>
      names.map(n => `'${n.replace(/'/g, "''")}'`).join(',');

    const platformNames = toNames(settings.p, fd.platforms);
    const modeNames     = toNames(settings.m, fd.gameModes);
    const genreNames    = toNames(settings.g, fd.genres);
    const themeNames    = toNames(settings.t, fd.themes);
    console.log(`Résolution IDs→noms : ${(performance.now() - t1).toFixed(1)}ms`);
    console.log('Filtres actifs :', {
      plateformes: platformNames ? platformNames.length : 'toutes',
      modes:       modeNames     ? modeNames.length     : 'tous',
      genres:      genreNames    ? genreNames.length     : 'tous',
      thèmes:      themeNames    ? themeNames.length     : 'tous',
    });

    // ── Construction SQL avec INTERSECT ──────────────────────────
    // Chaque partie est un ensemble de game IDs.
    // INTERSECT = intersection de ces ensembles = jeux qui satisfont TOUS les filtres.
    // Le query planner SQLite utilise les index (platform, game_id), etc.
    // ── Score filter ──────────────────────────────────────────────
    const scoreMin     = settings.scoreMin    ?? 0;
    const scoreMax     = settings.scoreMax    ?? 100;
    const allowNoScore = settings.allowNoScore ?? false;

    const parts = [
      `SELECT id FROM games WHERE first_release_date IS NOT NULL AND first_release_date BETWEEN ${minTs} AND ${maxTs}`,
    ];
    if (platformNames) parts.push(`SELECT game_id AS id FROM game_platforms WHERE platform IN (${sqlList(platformNames)})`);
    if (modeNames)     parts.push(`SELECT game_id AS id FROM game_modes_rel  WHERE mode     IN (${sqlList(modeNames)})`);
    if (genreNames)    parts.push(`SELECT game_id AS id FROM game_genres      WHERE genre    IN (${sqlList(genreNames)})`);
    if (themeNames)    parts.push(`SELECT game_id AS id FROM game_themes      WHERE theme    IN (${sqlList(themeNames)})`);

    // ── Exclusion du thème Erotic si contenu adulte désactivé ─────
    if (!settings.allowAdultContent) {
      const eroticTheme = fd.themes.find(t => t.name.toLowerCase() === 'erotic');
      if (eroticTheme) {
        parts.push(`SELECT id FROM games WHERE id NOT IN (SELECT game_id FROM game_themes WHERE theme = '${eroticTheme.name.replace(/'/g, "''")}')`);
        console.log(`[FiltersBusiness] Thème "${eroticTheme.name}" (id=${eroticTheme.id}) exclu — contenu adulte désactivé`);
      }
    }
    if (scoreMin > 0 || scoreMax < 100) {
      const scoreNull = allowNoScore ? ' OR aggregated_rating IS NULL' : '';
      parts.push(`SELECT id FROM games WHERE aggregated_rating BETWEEN ${scoreMin} AND ${scoreMax}${scoreNull}`);
    }

    const sql = parts.join('\nINTERSECT\n');
    console.log('SQL :', sql.replace(/\s+/g, ' ').trim());

    // ── Exécution ─────────────────────────────────────────────────
    const tSQL = performance.now();
    const rows = this.db.query(sql);
    console.log(`Requête SQL : ${(performance.now() - tSQL).toFixed(0)}ms — ${rows.length} jeux`);

    if (rows.length === 0) {
      console.log(`Durée totale runQuery : ${(performance.now() - tTotal).toFixed(0)}ms`);
      console.groupEnd();
      return [];
    }

    // ── Mélange Fisher-Yates en JS ────────────────────────────────
    const tShuffle = performance.now();
    const allIds = rows.map(r => r.id);
    for (let i = allIds.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allIds[i], allIds[j]] = [allIds[j], allIds[i]];
    }
    console.log(`Mélange Fisher-Yates : ${(performance.now() - tShuffle).toFixed(1)}ms`);

    console.log(`Durée totale runQuery : ${(performance.now() - tTotal).toFixed(0)}ms`);
    console.groupEnd();
    return allIds.slice(0, 50);
  }

  /**
   * Encode les settings en base64url compact pour l'URL.
   * @param {Object} settings
   * @returns {string}
   */
  encodeSettings(settings) {
    return btoa(JSON.stringify(settings))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  /**
   * Décode les settings depuis une chaîne base64url.
   * @param {string} encoded
   * @returns {Object|null}
   */
  decodeSettings(encoded) {
    try {
      const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(base64));
    } catch (e) {
      console.error('[FiltersBusiness] Impossible de décoder les settings :', e);
      return null;
    }
  }
}

window.FiltersBusiness = FiltersBusiness;

/**
 * FiltersBusiness.js
 * Logique métier de la page Roulette / Filtres.
 *
 * Responsabilités :
 *  - Charger les données nécessaires aux boîtes de filtres (plateformes, modes,
 *    genres, thèmes, perspectives, types de jeux, plage d'années)
 *  - Normaliser / migrer les réglages (ancien format → format tri-état)
 *  - Construire et exécuter la requête de sélection (SQL paramétré)
 *  - Encoder / décoder les réglages dans l'URL (base64url)
 *
 * ── Modèle tri-état ──────────────────────────────────────────────────────────
 * Chaque valeur d'une facette possède trois états :
 *   1  = INCLURE  → le jeu doit posséder au moins une valeur incluse
 *   0  = IGNORER  → la présence / absence de la valeur n'a aucun impact (N/A)
 *  -1 = EXCLURE  → le jeu ne doit posséder aucune valeur exclue
 *
 * Une facette est donc un couple { inc: number[], exc: number[] }.
 *  - Les valeurs « inc » d'une même facette sont combinées en OU.
 *  - Les facettes sont combinées en ET (INTERSECT).
 *  - Les valeurs « exc » sont retirées de l'ensemble final.
 *  - Une facette sans valeur inc ni exc est totalement ignorée.
 *
 * Attention : « inclure » est une liste blanche. Si l'on inclut « Action »,
 * les jeux sans le thème Action sont écartés, même si le thème « Horreur »
 * est en N/A. Pour ne contraindre que l'absence, utiliser « exclure ».
 */

class FiltersBusiness {
  static SETTINGS_VERSION = 2;

  /**
   * Définition des facettes.
   *  - kind 'rel'      : table relationnelle (game_id, colonne TEXT)
   *  - kind 'gameType' : colonne games.game_type (INTEGER)
   */
  static FACETS = [
    { key: 'platform',    kind: 'rel',      table: 'game_platforms',    column: 'platform',    label: 'Plateformes' },
    { key: 'genre',       kind: 'rel',      table: 'game_genres',       column: 'genre',       label: 'Genres' },
    { key: 'theme',       kind: 'rel',      table: 'game_themes',       column: 'theme',       label: 'Thèmes' },
    { key: 'mode',        kind: 'rel',      table: 'game_modes_rel',    column: 'mode',        label: 'Modes de jeu' },
    { key: 'perspective', kind: 'rel',      table: 'game_perspectives', column: 'perspective', label: 'Perspectives' },
    { key: 'gameType',    kind: 'gameType', table: 'games',             column: 'game_type',   label: 'Types de jeux' },
  ];

  /** Clés de l'ancien format (v1) → clé de facette. */
  static LEGACY_KEYS = {
    platform: 'p',
    mode: 'm',
    genre: 'g',
    theme: 't',
  };

  /** Libellés de repli pour les game_type absents du dictionnaire. */
  static GAME_TYPE_FALLBACK = {
    0: 'Jeu principal',
    2: 'Extension',
    9: 'Remaster',
    10: 'Jeu étendu',
    13: 'Pack',
  };

  /**
   * @param {Database} db
   * @param {string[]} [fangameKeywords=[]]      - Mots-clés exclus si allowFangame est désactivé
   * @param {string[]} [pinnedPlatformNames=[]]  - Noms des plateformes épinglées (JSON)
   */
  constructor(db, fangameKeywords = [], pinnedPlatformNames = []) {
    this.db                   = db;
    this._filterData          = null;
    this._knownIds            = new Map();
    this._fangameKeywords     = (fangameKeywords || []).map(k => String(k).toLowerCase());
    this._pinnedPlatformNames = pinnedPlatformNames || [];
    this.pinnedPlatformIds    = [];
    /** Nombre total de jeux correspondant à la dernière requête (avant limite). */
    this.lastResultCount      = 0;
    /** Dernière requête exécutée ({ sql, params }) — utile pour le diagnostic. */
    this.lastQuery            = null;
  }

  // ─────────────────────────────────────────────────────────────────
  // DONNÉES DES FILTRES
  // ─────────────────────────────────────────────────────────────────

  /**
   * Charge et met en cache toutes les données nécessaires aux filtres.
   * @returns {{platforms, gameModes, genres, themes, perspectives, gameTypes, minYear, maxYear}}
   */
  getFilterData() {
    if (this._filterData) return this._filterData;

    console.log('[FiltersBusiness] Chargement des données de filtres…');

    const platforms    = this.db.query(`SELECT id, name FROM platforms ORDER BY name ASC`);
    const gameModes    = this.db.query(`SELECT id, name FROM game_modes ORDER BY name ASC`);
    const genres       = this.db.query(`SELECT id, name FROM genres ORDER BY name ASC`);
    const themes       = this.db.query(`SELECT id, name FROM themes ORDER BY name ASC`);
    const perspectives = this.db.query(`SELECT id, name FROM player_perspectives ORDER BY name ASC`);

    // Le dictionnaire game_types est incomplet (0, 2, 9, 13 manquants) :
    // on part des valeurs réellement présentes dans games pour ne rien masquer.
    const dictTypes = this.db.query(`SELECT id, type AS name FROM game_types`);
    const usedTypes = this.db.query(`SELECT DISTINCT game_type AS id FROM games WHERE game_type IS NOT NULL`);
    const typeById  = new Map(dictTypes.map(t => [Number(t.id), t.name]));
    const usedIds   = new Set(usedTypes.map(r => Number(r.id)));
    const allTypeIds = new Set([...typeById.keys(), ...usedIds, 0]);
    const gameTypes = [...allTypeIds]
      .sort((a, b) => a - b)
      .map(id => ({
        id,
        name: typeById.get(id) || FiltersBusiness.GAME_TYPE_FALLBACK[id] || `Type #${id}`,
      }));

    const yearRow = this.db.queryOne(`
      SELECT
        MIN(CAST(strftime('%Y', datetime(first_release_date, 'unixepoch')) AS INTEGER)) AS min_year,
        MAX(CAST(strftime('%Y', datetime(first_release_date, 'unixepoch')) AS INTEGER)) AS max_year
      FROM games
      WHERE first_release_date IS NOT NULL AND first_release_date > 0
    `);

    // Résolution des noms de plateformes épinglées → IDs
    if (this._pinnedPlatformNames.length > 0) {
      const nameSet = new Set(this._pinnedPlatformNames.map(n => n.toLowerCase()));
      this.pinnedPlatformIds = platforms
        .filter(p => nameSet.has(p.name.toLowerCase()))
        .map(p => p.id);
      console.log(`[FiltersBusiness] Plateformes épinglées résolues : ${this.pinnedPlatformIds.length}/${this._pinnedPlatformNames.length}`);
    }

    this._filterData = {
      platforms,
      gameModes,
      genres,
      themes,
      perspectives,
      gameTypes,
      minYear: yearRow ? (yearRow.min_year || 1970) : 1970,
      maxYear: yearRow ? (yearRow.max_year || new Date().getFullYear()) : new Date().getFullYear(),
    };

    // Index des identifiants connus, par facette
    this._knownIds.set('platform', new Set(platforms.map(p => Number(p.id))));
    this._knownIds.set('genre', new Set(genres.map(g => Number(g.id))));
    this._knownIds.set('theme', new Set(themes.map(t => Number(t.id))));
    this._knownIds.set('mode', new Set(gameModes.map(m => Number(m.id))));
    this._knownIds.set('perspective', new Set(perspectives.map(p => Number(p.id))));
    this._knownIds.set('gameType', new Set(gameTypes.map(t => Number(t.id))));

    console.log('[FiltersBusiness] Données chargées :', {
      platforms: platforms.length,
      gameModes: gameModes.length,
      genres: genres.length,
      themes: themes.length,
      perspectives: perspectives.length,
      gameTypes: gameTypes.length,
      yearRange: `${this._filterData.minYear}–${this._filterData.maxYear}`,
    });

    return this._filterData;
  }

  /** Retourne les items d'une facette : [{ id, name }, …]. */
  getFacetItems(facetKey) {
    const fd = this.getFilterData();
    switch (facetKey) {
      case 'platform':    return fd.platforms;
      case 'genre':       return fd.genres;
      case 'theme':       return fd.themes;
      case 'mode':        return fd.gameModes;
      case 'perspective': return fd.perspectives;
      case 'gameType':    return fd.gameTypes;
      default:            return [];
    }
  }

  /** Retourne l'ID du thème « Erotic » (ou null). */
  getEroticThemeId() {
    const theme = this.getFilterData().themes.find(t => t.name.toLowerCase() === 'erotic');
    return theme ? theme.id : null;
  }

  // ─────────────────────────────────────────────────────────────────
  // RÉGLAGES
  // ─────────────────────────────────────────────────────────────────

  /** Réglages par défaut.
   *  - Plateformes épinglées incluses
   *  - Type « Jeu principal » inclus (les DLC/mods ne sont pas proposés par défaut)
   *  - Toutes les autres facettes en N/A
   */
  getDefaultSettings() {
    const fd = this.getFilterData();
    const currentYear = new Date().getFullYear();
    return {
      v: FiltersBusiness.SETTINGS_VERSION,
      y: [fd.minYear, Math.min(fd.maxYear, currentYear)],
      facets: {
        platform:    { inc: [...this.pinnedPlatformIds], exc: [] },
        genre:       { inc: [], exc: [] },
        theme:       { inc: [], exc: [] },
        mode:        { inc: [], exc: [] },
        perspective: { inc: [], exc: [] },
        gameType:    { inc: [0], exc: [] },
      },
      scoreMin:         0,
      scoreMax:         100,
      allowNoScore:     false,
      allowFangame:     false,
      onlyGameAwards:   false,
    };
  }

  /** Nombre de types non triviaux (hors « Jeu principal »). */
  _nonZeroTypeIds() {
    return this.getFilterData().gameTypes.filter(t => Number(t.id) !== 0).map(t => Number(t.id));
  }

  /**
   * Normalise un état de filtres : validation, migration v1 → v2, bornes.
   * Ne lève jamais d'exception : retourne toujours un état exploitable.
   * @param {Object} raw
   * @returns {Object}
   */
  normalizeSettings(raw) {
    const fd   = this.getFilterData();
    const def  = this.getDefaultSettings();
    const out  = {
      v: FiltersBusiness.SETTINGS_VERSION,
      y: [...def.y],
      facets: {},
      scoreMin:        def.scoreMin,
      scoreMax:        def.scoreMax,
      allowNoScore:    !!def.allowNoScore,
      allowFangame:    !!def.allowFangame,
      onlyGameAwards:  !!def.onlyGameAwards,
    };

    if (!raw || typeof raw !== 'object') return out;

    const isV2 = Number(raw.v) === FiltersBusiness.SETTINGS_VERSION && raw.facets && typeof raw.facets === 'object';

    // ── Années ───────────────────────────────────────────────────
    if (Array.isArray(raw.y) && raw.y.length === 2) {
      let lo = Math.floor(Number(raw.y[0]));
      let hi = Math.floor(Number(raw.y[1]));
      if (Number.isFinite(lo) && Number.isFinite(hi)) {
        lo = Math.min(Math.max(lo, fd.minYear), fd.maxYear);
        hi = Math.min(Math.max(hi, fd.minYear), fd.maxYear);
        if (lo > hi) [lo, hi] = [hi, lo];
        out.y = [lo, hi];
      }
    }

    // ── Facettes ─────────────────────────────────────────────────
    for (const facet of FiltersBusiness.FACETS) {
      const known = this._knownIds.get(facet.key) || new Set();
      let inc = [];
      let exc = [];

      if (isV2) {
        const src = raw.facets[facet.key];
        if (src && typeof src === 'object') {
          inc = this._ids(src.inc, known);
          exc = this._ids(src.exc, known);
        } else {
          const fallback = def.facets[facet.key];
          inc = [...fallback.inc];
          exc = [...fallback.exc];
        }
      } else {
        // ── Migration v1 ─────────────────────────────────────────
        const legacyKey = FiltersBusiness.LEGACY_KEYS[facet.key];
        const hadLegacy = legacyKey && Array.isArray(raw[legacyKey]);
        if (hadLegacy) {
          // En v1, une valeur cochée = incluse, une valeur décochée = ignorée.
          // « Tout coché » n'appliquait en réalité aucun filtre : on migre vers N/A
          // pour ne pas exclure les jeux dépourvus de cette facette.
          inc = this._ids(raw[legacyKey], known);
          if (known.size > 0 && inc.length >= known.size) inc = [];
        } else if (facet.key === 'gameType') {
          inc = this._migrateLegacyGameTypes(raw.allowedGameTypes, known);
        } else {
          const fallback = def.facets[facet.key];
          inc = [...fallback.inc];
          exc = [...fallback.exc];
        }
      }

      // Une valeur ne peut pas être incluse ET exclue : l'inclusion gagne.
      const incSet = new Set(inc);
      exc = exc.filter(id => !incSet.has(id));

      out.facets[facet.key] = { inc: [...incSet], exc };
    }

    // ── Score & interrupteurs ────────────────────────────────────
    const scoreMin = Number(raw.scoreMin);
    const scoreMax = Number(raw.scoreMax);
    if (Number.isFinite(scoreMin)) out.scoreMin = Math.min(100, Math.max(0, Math.round(scoreMin)));
    if (Number.isFinite(scoreMax)) out.scoreMax = Math.min(100, Math.max(0, Math.round(scoreMax)));
    if (out.scoreMin > out.scoreMax) [out.scoreMin, out.scoreMax] = [out.scoreMax, out.scoreMin];

    if (typeof raw.allowNoScore   === 'boolean') out.allowNoScore   = raw.allowNoScore;
    if (typeof raw.allowFangame   === 'boolean') out.allowFangame   = raw.allowFangame;
    if (typeof raw.onlyGameAwards === 'boolean') out.onlyGameAwards = raw.onlyGameAwards;

    return out;
  }

  /** Convertit un tableau d'IDs en tableau d'entiers connus, sans doublon. */
  _ids(value, known) {
    if (!Array.isArray(value)) return [];
    const set = new Set();
    for (const raw of value) {
      const id = Number(raw);
      if (Number.isFinite(id) && known.has(id)) set.add(id);
    }
    return [...set];
  }

  /**
   * Migration du filtre v1 « types de jeux » :
   *   []                      → jeu principal uniquement (comportement v1)
   *   tous les types          → aucun filtre (N/A)
   *   une sélection partielle → jeu principal + sélection
   */
  _migrateLegacyGameTypes(value, known) {
    if (!Array.isArray(value)) return [0];
    const all = this._nonZeroTypeIds().filter(id => known.has(id));
    const selected = this._ids(value, known).filter(id => id !== 0);
    if (selected.length === 0) return [0];
    if (selected.length >= all.length) return [];
    return [0, ...selected];
  }

  // ─────────────────────────────────────────────────────────────────
  // REQUÊTE
  // ─────────────────────────────────────────────────────────────────

  /** Placeholders SQLite : (?, ?, ?) */
  static _ph(n) {
    return Array(n).fill('?').join(', ');
  }

  /**
   * Condition SQL pour la facette « types de jeux » (games.game_type).
   * Renvoie un fragment de condition (sans SELECT), ou null si la facette est ignorée.
   * @param {Object} state   - { inc, exc }
   * @param {boolean} exclude
   * @returns {{sql: string, params: any[]}|null}
   */
  _gameTypeCondition(state, exclude) {
    const ids = (exclude ? state.exc : state.inc) || [];
    if (ids.length === 0) return null;

    const values   = ids.map(Number).filter(Number.isFinite);
    const list     = values.filter(id => id !== 0);
    const withZero = values.includes(0);
    if (list.length === 0 && !withZero) return null;

    const conds  = [];
    const params = [];
    if (list.length) {
      conds.push(`game_type IN (${FiltersBusiness._ph(list.length)})`);
      params.push(...list);
    }
    if (withZero) {
      conds.push('game_type = 0');
      conds.push('game_type IS NULL');
    }

    if (exclude) {
      // On conserve les lignes NULL quand « jeu principal » n'est pas exclu.
      if (withZero) return { sql: `NOT (${conds.join(' OR ')})`, params };
      return { sql: `(game_type IS NULL OR NOT (${conds.join(' OR ')}))`, params };
    }
    return { sql: `(${conds.join(' OR ')})`, params };
  }

  /**
   * Construit l'ensemble de game_id d'une facette relationnelle.
   * @param {Object} facet
   * @param {Object} state - { inc, exc }
   * @param {boolean} exclude
   * @returns {{sql: string, params: any[]}|null}
   */
  _relationalClause(facet, state, exclude) {
    const ids = (exclude ? state.exc : state.inc) || [];
    if (ids.length === 0) return null;

    // Les tables relationnelles stockent des libellés : on résout les IDs en noms.
    const items = this.getFacetItems(facet.key);
    const byId  = new Map(items.map(item => [Number(item.id), item.name]));
    const names = ids.map(id => byId.get(Number(id))).filter(Boolean);
    if (names.length === 0) return null;

    const placeholders = FiltersBusiness._ph(names.length);
    if (exclude) {
      return {
        sql: `SELECT id FROM games WHERE id NOT IN (
                SELECT game_id FROM ${facet.table}
                WHERE game_id IS NOT NULL AND ${facet.column} IN (${placeholders})
              )`,
        params: names,
      };
    }
    return {
      sql: `SELECT game_id AS id FROM ${facet.table} WHERE ${facet.column} IN (${placeholders})`,
      params: names,
    };
  }

  /**
   * Exécute la sélection avec les réglages fournis.
   * @param {Object} settings
   * @param {{allowAdultContent?: boolean}} [options]
   * @returns {number[]} Jusqu'à 50 IDs, mélangés (Fisher-Yates).
   */
  runQuery(settings, options = {}) {
    const tTotal = performance.now();
    const fd     = this.getFilterData();
    const state  = this.normalizeSettings(settings);
    const allowAdultContent = options.allowAdultContent ?? !!settings?.allowAdultContent;

    // La requête de base porte la plage de dates, le type de jeu, le score,
    // le contenu adulte et les mots-clés exclus. Les autres facettes sont
    // ajoutées en INTERSECT (ensembles de game_id).
    const baseConds  = ['first_release_date IS NOT NULL', 'first_release_date BETWEEN ? AND ?'];
    const baseParams = [];

    // ── Plage de sortie ──────────────────────────────────────────
    const minTs = Math.floor(new Date(state.y[0], 0, 1).getTime() / 1000);
    const maxTs = Math.floor(new Date(state.y[1], 11, 31, 23, 59, 59).getTime() / 1000);
    baseParams.push(minTs, maxTs);

    const addBase = (clause) => {
      if (!clause) return;
      baseConds.push(clause.sql);
      baseParams.push(...clause.params);
    };

    // ── Type de jeu (colonne games.game_type) ────────────────────
    addBase(this._gameTypeCondition(state.facets.gameType, false));
    addBase(this._gameTypeCondition(state.facets.gameType, true));

    // ── Score ────────────────────────────────────────────────────
    if (!state.allowNoScore) {
      baseConds.push('aggregated_rating IS NOT NULL');
    }
    if (state.scoreMin > 0 || state.scoreMax < 100) {
      baseConds.push(state.allowNoScore
        ? '(aggregated_rating BETWEEN ? AND ? OR aggregated_rating IS NULL)'
        : 'aggregated_rating BETWEEN ? AND ?');
      baseParams.push(state.scoreMin, state.scoreMax);
    }

    // ── Contenu adulte : exclusion forcée du thème Erotic ────────
    if (!allowAdultContent) {
      const eroticId   = this.getEroticThemeId();
      const eroticName = eroticId === null ? null : fd.themes.find(t => t.id === eroticId)?.name;
      if (eroticName) {
        baseConds.push('id NOT IN (SELECT game_id FROM game_themes WHERE game_id IS NOT NULL AND theme = ?)');
        baseParams.push(eroticName);
      }
    }

    // ── Fangames / mods ──────────────────────────────────────────
    if (!state.allowFangame && this._fangameKeywords.length > 0) {
      const ph = FiltersBusiness._ph(this._fangameKeywords.length);
      // La colonne keyword est déjà normalisée en minuscules en base
      // (permet d'utiliser l'index idx_game_keywords_keyword).
      baseConds.push(`id NOT IN (
        SELECT game_id FROM game_keywords
        WHERE game_id IS NOT NULL AND keyword IN (${ph})
      )`);
      baseParams.push(...this._fangameKeywords);
    }

    // ── Uniquement Game Awards ───────────────────────────────────
    if (state.onlyGameAwards) {
      baseConds.push(`id IN (
        SELECT game_id FROM game_keywords
        WHERE game_id IS NOT NULL AND keyword LIKE ?
      )`);
      baseParams.push('%game award%');
    }

    const parts  = [`SELECT id FROM games WHERE ${baseConds.join('\n  AND ')}`];
    const params = [...baseParams];
    const addPart = (clause) => {
      if (!clause) return;
      parts.push(clause.sql);
      params.push(...clause.params);
    };

    // ── Facettes relationnelles tri-état ─────────────────────────
    for (const facet of FiltersBusiness.FACETS) {
      if (facet.kind !== 'rel') continue;
      const facetState = state.facets[facet.key];
      addPart(this._relationalClause(facet, facetState, false)); // inclusions
      addPart(this._relationalClause(facet, facetState, true));  // exclusions
    }

    const sql = parts.join('\nINTERSECT\n');
    this.lastQuery = { sql, params };

    const tSQL = performance.now();
    const rows = this.db.query(sql, params);
    const sqlMs = performance.now() - tSQL;

    this.lastResultCount = rows.length;

    if (rows.length === 0) {
      console.log(`[FiltersBusiness] runQuery → 0 jeu (${sqlMs.toFixed(0)} ms SQL, ${(performance.now() - tTotal).toFixed(0)} ms total)`);
      return [];
    }

    // Mélange Fisher-Yates (ORDER BY RANDOM() est lent sur 300k+ lignes)
    const allIds = rows.map(r => r.id);
    for (let i = allIds.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allIds[i], allIds[j]] = [allIds[j], allIds[i]];
    }

    console.log(`[FiltersBusiness] runQuery → ${rows.length} jeux en ${sqlMs.toFixed(0)} ms (total ${(performance.now() - tTotal).toFixed(0)} ms)`);
    return allIds.slice(0, 50);
  }

  /**
   * Résumé lisible des réglages, pour l'UI et les logs.
   * @param {Object} settings
   * @returns {{inc:number, exc:number, activeFacets:number, txt:string}}
   */
  summarize(settings) {
    const state = this.normalizeSettings(settings);
    let inc = 0;
    let exc = 0;
    let activeFacets = 0;
    for (const facet of FiltersBusiness.FACETS) {
      const s = state.facets[facet.key];
      inc += s.inc.length;
      exc += s.exc.length;
      if (s.inc.length || s.exc.length) activeFacets++;
    }
    return { inc, exc, activeFacets, txt: `${inc} inclusion(s) · ${exc} exclusion(s) · ${activeFacets} facette(s)` };
  }

  // ─────────────────────────────────────────────────────────────────
  // URL
  // ─────────────────────────────────────────────────────────────────

  /**
   * Encode les réglages en base64url compact pour l'URL.
   * Les facettes vides et les valeurs par défaut sont omises.
   * @param {Object} settings
   * @returns {string}
   */
  encodeSettings(settings) {
    const state = this.normalizeSettings(settings);
    const def   = this.getDefaultSettings();

    /** @type {Object} */
    const payload = { v: FiltersBusiness.SETTINGS_VERSION, y: state.y, facets: {} };

    for (const facet of FiltersBusiness.FACETS) {
      const s = state.facets[facet.key];
      const d = def.facets[facet.key];
      const sameDefault = s.inc.length === d.inc.length
        && s.inc.every((id, i) => id === d.inc[i])
        && s.exc.length === d.exc.length
        && s.exc.every((id, i) => id === d.exc[i]);
      if (!sameDefault) {
        const entry = {};
        if (s.inc.length) entry.inc = s.inc;
        if (s.exc.length) entry.exc = s.exc;
        payload.facets[facet.key] = entry;
      }
    }

    if (state.scoreMin !== def.scoreMin)     payload.scoreMin = state.scoreMin;
    if (state.scoreMax !== def.scoreMax)     payload.scoreMax = state.scoreMax;
    if (state.allowNoScore !== def.allowNoScore)       payload.allowNoScore = state.allowNoScore;
    if (state.allowFangame !== def.allowFangame)       payload.allowFangame = state.allowFangame;
    if (state.onlyGameAwards !== def.onlyGameAwards)   payload.onlyGameAwards = state.onlyGameAwards;

    return btoa(JSON.stringify(payload))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  /**
   * Décode des réglages depuis une chaîne base64url (v1 ou v2).
   * @param {string} encoded
   * @returns {Object|null}
   */
  decodeSettings(encoded) {
    if (!encoded || typeof encoded !== 'string') return null;
    try {
      const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
      // atob exige un padding correct
      const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
      const parsed = JSON.parse(atob(padded));
      return this.normalizeSettings(parsed);
    } catch (e) {
      console.warn('[FiltersBusiness] Réglages d\'URL invalides :', e.message);
      return null;
    }
  }
}

window.FiltersBusiness = FiltersBusiness;

/**
 * Database.js
 * Classe responsable du chargement, de la décompression (brotli)
 * et de l'initialisation de la base de données SQLite WASM (sql.js).
 */

class Database {
  /**
   * @param {string} dbUrl        - URL du fichier .db.br à charger
   * @param {Function} onProgress - Callback(percent, statusText)
   */
  constructor(dbUrl, onProgress) {
    this.dbUrl      = dbUrl;
    this.onProgress = onProgress || (() => {});
    /** @type {import('sql.js').Database|null} */
    this.db = null;
  }

  /**
   * Charge, décompresse et ouvre la base de données.
   * Retourne une Promise résolue quand la DB est prête.
   */
  async load() {
    console.log('[Database] Démarrage du chargement…', this.dbUrl);
    this.onProgress(5, 'Téléchargement de la base de données…');

    // 1. Téléchargement du fichier compressé
    const response = await fetch(this.dbUrl);
    if (!response.ok) {
      throw new Error(`[Database] Échec du téléchargement : ${response.status} ${response.statusText}`);
    }
    const compressed = await response.arrayBuffer();
    console.log('[Database] Fichier téléchargé, taille compressée :', compressed.byteLength, 'octets');
    this.onProgress(35, 'Décompression (brotli)…');

    // 2. Décompression brotli
    let sqliteBuffer;
    try {
      sqliteBuffer = await this._decompressBrotli(compressed);
    } catch (e) {
      throw new Error('[Database] Impossible de décompresser le fichier brotli : ' + e.message);
    }
    console.log('[Database] Taille décompressée :', sqliteBuffer.byteLength, 'octets');
    this.onProgress(65, 'Initialisation sql.js…');

    // 3. Initialisation de sql.js
    const SQL = await this._initSqlJs();
    this.onProgress(85, 'Ouverture de la base de données…');

    // 4. Ouverture de la DB en mémoire
    this.db = new SQL.Database(new Uint8Array(sqliteBuffer));
    console.log('[Database] Base de données prête.');

    // 5. Création des index en mémoire (accélération massive des requêtes filtrées)
    this.onProgress(90, 'Création des index…');
    this._createIndexes();

    // 6. Log des statistiques par table
    this._logStats();

    this.onProgress(100, 'Prêt !');

    // Retourne le wrapper Database (qui expose .query / .queryOne),
    // et non this.db (objet sql.js brut).
    return this;
  }

  /**
   * Décompresse un ArrayBuffer brotli via DecompressionStream.
   * @param {ArrayBuffer} compressed
   * @returns {Promise<ArrayBuffer>}
   */
  /**
   * Décompresse un ArrayBuffer brotli.
   * Stratégie 1 : DecompressionStream('br') — natif, Chrome 123+, Firefox 128+, Safari 18+
   * Stratégie 2 : BrotliDecompressBuffer — chargé depuis CDN jsDelivr via _loadBrotliFromCDN()
   * Sinon : erreur explicite (on ne passe jamais des données corrompues à sql.js)
   */
  async _decompressBrotli(compressed) {
    // --- Stratégie 1 : API native du navigateur ---
    if (typeof DecompressionStream !== 'undefined') {
      try {
        console.log('[Database] Tentative décompression via DecompressionStream(\'br\')…');
        const ds     = new DecompressionStream('br');
        const stream = new Blob([compressed]).stream().pipeThrough(ds);
        const reader = stream.getReader();
        const chunks = [];
        let totalSize = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          totalSize += value.byteLength;
        }
        const result = new Uint8Array(totalSize);
        let offset = 0;
        for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
        console.log('[Database] Décompression native réussie (DecompressionStream br)');
        return result.buffer;
      } catch (e) {
        // 'br' non supporté sur ce navigateur, on tente le fallback JS
        console.warn('[Database] DecompressionStream(\'br\') échoué :', e.message, '— chargement bibliothèque brotli…');
      }
    }

    // --- Stratégie 2 : bibliothèque JS chargée dynamiquement ---
    if (typeof window.BrotliDecompressBuffer === 'undefined') {
      await this._loadBrotliFromCDN();
    }
    if (typeof window.BrotliDecompressBuffer !== 'undefined') {
      console.log('[Database] Décompression via BrotliDecompressBuffer…');
      const result = window.BrotliDecompressBuffer(new Uint8Array(compressed));
      return result.buffer;
    }

    // --- Aucun décodeur disponible ---
    throw new Error(
      'Aucun décodeur brotli disponible. ' +
      'Vérifiez la connexion internet (chargement CDN jsDelivr) ' +
      'ou utilisez Chrome 123+ / Firefox 128+ / Safari 18+.'
    );
  }

  /**
   * Charge dynamiquement les 8 modules CJS du package brotli@1.3.3 depuis jsDelivr.
   *
   * Pourquoi 8 fichiers ? dec/decode.js appelle require() sur 7 autres fichiers
   * du même package (streams, bit_reader, dictionary, huffman, context, prefix, transform).
   * Il est impossible de charger decode.js seul dans un navigateur sans ces dépendances.
   * Ce chargeur fournit un mini-shim require() pour les résoudre.
   *
   * Résultat : window.BrotliDecompressBuffer est disponible après l'appel.
   */
  async _loadBrotliFromCDN() {
    if (typeof window.BrotliDecompressBuffer !== 'undefined') return; // déjà chargé

    console.log('[Database] Chargement bibliothèque brotli depuis CDN (jsDelivr)…');
    const base      = 'https://cdn.jsdelivr.net/npm/brotli@1.3.3/dec/';
    const fileNames = ['streams', 'bit_reader', 'dictionary-data', 'dictionary', 'huffman', 'context', 'prefix', 'transform', 'decode'];
    const mods      = {};

    // Mini-shim require() : résout uniquement les chemins relatifs internes au package
    const req = (path) => {
      const key = path.replace('./', '');
      if (!mods[key]) throw new Error(`[brotli-shim] Module introuvable : ${path}`);
      return mods[key];
    };

    for (const name of fileNames) {
      const url = `${base}${name}.js`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`[Database] Échec chargement brotli/${name}.js (HTTP ${res.status})`);
      const code = await res.text();
      const mod  = { exports: {} };
      // Exécution du module CJS dans un scope isolé avec require/module/exports simulés
      // eslint-disable-next-line no-new-func
      new Function('require', 'module', 'exports', code)(req, mod, mod.exports);
      mods[name] = mod.exports;
      console.log(`[Database] brotli/${name}.js ✓`);
    }

    window.BrotliDecompressBuffer = mods['decode'].BrotliDecompressBuffer;
    if (typeof window.BrotliDecompressBuffer !== 'function') {
      throw new Error('[Database] BrotliDecompressBuffer introuvable après chargement des modules brotli');
    }
    console.log('[Database] Bibliothèque brotli prête (BrotliDecompressBuffer)');
  }

  /**
   * Charge et initialise sql.js depuis le CDN.
   * @returns {Promise<import('sql.js').SqlJsStatic>}
   */
  async _initSqlJs() {
    if (window.SQL) return window.SQL;
    return new Promise((resolve, reject) => {
      const script  = document.createElement('script');
      script.src    = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.js';
      script.onload = async () => {
        try {
          const SQL = await window.initSqlJs({
            locateFile: file =>
              `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/${file}`
          });
          window.SQL = SQL;
          resolve(SQL);
        } catch (e) {
          reject(e);
        }
      };
      script.onerror = () => reject(new Error('[Database] Impossible de charger sql-wasm.js'));
      document.head.appendChild(script);
    });
  }

  /**
   * Exécute une requête SELECT et retourne un tableau d'objets.
   * @param {string} sql
   * @param {any[]} params
   * @returns {Object[]}
   */
  query(sql, params = []) {
    if (!this.db) throw new Error('[Database] Base non initialisée');
    const stmt    = this.db.prepare(sql);
    const results = [];
    stmt.bind(params);
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  }

  /**
   * Exécute une requête SELECT et retourne un seul objet ou null.
   * @param {string} sql
   * @param {any[]} params
   * @returns {Object|null}
   */
  queryOne(sql, params = []) {
    const rows = this.query(sql, params);
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Crée les index manquants sur les tables relationnelles en mémoire.
   * Appelé une seule fois au chargement. Accélère massivement les requêtes filtrées
   * en évitant les full-scans à chaque EXISTS / JOIN.
   * L'opération est synchrone (sql.js WASM) mais ne s'exécute qu'une fois.
   */
  _createIndexes() {
    const t0 = performance.now();
    console.groupCollapsed('[Database] ── Création des index ──────────────────');

    const indexes = [
      // Filtres roulette (priorité maximale)
      ['idx_games_release_date',      `CREATE INDEX IF NOT EXISTS idx_games_release_date      ON games(first_release_date)`],
      ['idx_game_platforms_platform', `CREATE INDEX IF NOT EXISTS idx_game_platforms_platform ON game_platforms(platform, game_id)`],
      ['idx_game_genres_genre',       `CREATE INDEX IF NOT EXISTS idx_game_genres_genre       ON game_genres(genre, game_id)`],
      ['idx_game_modes_mode',         `CREATE INDEX IF NOT EXISTS idx_game_modes_mode         ON game_modes_rel(mode, game_id)`],
      ['idx_game_themes_theme',       `CREATE INDEX IF NOT EXISTS idx_game_themes_theme       ON game_themes(theme, game_id)`],
      // Détail jeu (GameDetailUI)
      ['idx_game_developers_game',    `CREATE INDEX IF NOT EXISTS idx_game_developers_game    ON game_developers(game_id)`],
      ['idx_game_screenshots_game',   `CREATE INDEX IF NOT EXISTS idx_game_screenshots_game   ON game_screenshots(game_id)`],
      ['idx_game_videos_game',        `CREATE INDEX IF NOT EXISTS idx_game_videos_game        ON game_videos(game_id)`],
      ['idx_game_perspectives_game',  `CREATE INDEX IF NOT EXISTS idx_game_perspectives_game  ON game_perspectives(game_id)`],
    ];

    for (const [name, sql] of indexes) {
      const ti = performance.now();
      try {
        this.db.run(sql);
        console.log(`  ${name.padEnd(36)} : ${(performance.now() - ti).toFixed(0)}ms`);
      } catch (e) {
        console.warn(`  ${name.padEnd(36)} : IGNORÉ — ${e.message}`);
      }
    }

    // Mise à jour des statistiques pour le query planner
    const tA = performance.now();
    try {
      this.db.run('ANALYZE');
      console.log(`  ${'ANALYZE'.padEnd(36)} : ${(performance.now() - tA).toFixed(0)}ms`);
    } catch (e) {
      console.warn('  ANALYZE : IGNORÉ —', e.message);
    }

    const total = (performance.now() - t0).toFixed(0);
    console.log(`  ${'─'.repeat(48)}`);
    console.log(`  ${'TOTAL index creation'.padEnd(36)} : ${total}ms`);
    console.groupEnd();
  }

  /**
   * Affiche dans la console le nombre de lignes pour chaque table connue.
   * Les tables absentes sont signalées sans bloquer.
   */
  _logStats() {
    const tables = [
      // Tables principales
      'games',
      'genres',
      'platforms',
      'themes',
      'franchises',
      'keywords',
      'game_modes',
      'player_perspectives',
      // Tables relationnelles
      'game_genres',
      'game_platforms',
      'game_modes_rel',
      'game_perspectives',
      'game_themes',
      // Médias & liens
      'game_screenshots',
      'game_videos',
      'game_developers',
    ];

    console.groupCollapsed('[Database] ── Statistiques ──────────────────────');
    let totalRows = 0;
    for (const table of tables) {
      try {
        const row = this.queryOne(`SELECT COUNT(*) AS cnt FROM ${table}`);
        const cnt = row ? (row.cnt || 0) : 0;
        console.log(`  ${table.padEnd(24)} : ${cnt}`);
        totalRows += cnt;
      } catch (_e) {
        console.log(`  ${table.padEnd(24)} : (table absente)`);
      }
    }
    console.log(`  ${'─'.repeat(36)}`);
    console.log(`  ${'TOTAL'.padEnd(24)} : ${totalRows} lignes`);
    console.groupEnd();
  }
}

// Export global
window.Database = Database;

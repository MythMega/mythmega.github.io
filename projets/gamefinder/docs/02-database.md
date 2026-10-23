# Base de données

## 1. Fichier et chargement

| Élément | Valeur |
|---------|--------|
| Fichier | `database.db.br` |
| Taille compressée | 90 301 679 octets (≈ 86 Mo) |
| Taille décompressée | 415 711 232 octets (≈ 396 Mo) |
| Moteur | SQLite via `sql.js` 1.10.3 (WASM), base **en mémoire** |
| Compression | Brotli |

### Pipeline `Database.load()`

1. **Cache** — lecture IndexedDB (`gamefinder-cache`, store `db-files`, clé = nom du
   fichier). L'entrée contient les octets compressés et `cachedAt`.
2. **Téléchargement** — si absent, `fetch()` puis sauvegarde en cache
   (non bloquante en cas d'échec, par exemple quota dépassé).
3. **Décompression**
   - voie native : `new DecompressionStream('br')` (Chrome 123+, Firefox 128+,
     Safari 18+) ;
   - repli : 9 modules CommonJS du paquet `brotli@1.3.3` chargés depuis jsDelivr,
     exécutés via un `require()` simulé, exposant `BrotliDecompressBuffer`.
4. **WASM** — `sql-wasm.js` + `sql-wasm.wasm` chargés depuis cdnjs, puis
   `new SQL.Database(uint8Array)`.
5. **Index** — créés en mémoire (voir §4) puis `ANALYZE`.
6. **Logs** — nombre de lignes de chaque table.

> Le repli CDN signifie qu'un premier chargement hors-ligne échoue si
> `DecompressionStream('br')` n'est pas disponible et que la bibliothèque n'est pas
> déjà en cache. Voir [07-audit-securite-performance.md](07-audit-securite-performance.md).

### API `Database`

```js
db.query(sql, params)   // → Object[] (une entrée par ligne)
db.queryOne(sql, params) // → Object | null
Database.clearCache(key) // vide le cache de la base
Database.getCacheInfo(key) // → { cachedAt: Date, sizeBytes: number } | null
```

`query` prépare une instruction, lie les paramètres, itère avec `step()` et libère
la statement. **Toujours privilégier les paramètres `?`** plutôt que l'interpolation.

## 2. Schéma réel

19 tables, 4 366 979 lignes au total.

### Table principale

#### `games` — 370 060 lignes

| Colonne | Type | Notes |
|---------|------|-------|
| `id` | INTEGER PK | ID IGDB |
| `name` | TEXT | |
| `aggregated_rating` | REAL | **353 263 lignes NULL** (≈ 95 %) |
| `rating` | REAL | Note utilisateur |
| `first_release_date` | INTEGER | timestamp UNIX ; 1970 → 2040 |
| `storyline`, `summary` | TEXT | textes longs (poids principal du fichier) |
| `cover_url` | TEXT | image IGDB |
| `updated_at` | INTEGER | |
| `parent_game` | INTEGER | présent en base, non exploité par l'UI |
| `url` | TEXT | fiche IGDB |
| `game_type` | INTEGER | FK logique vers `game_types`, **valeurs hors dictionnaire** |

### Dictionnaires

| Table | Lignes | Contenu |
|-------|--------|---------|
| `genres` | 23 | Adventure → Visual Novel |
| `themes` | 22 | Action, Erotic (id 7), Horror… |
| `game_modes` | 6 | Solo, multi, coop, MMO, split screen, battle royale |
| `player_perspectives` | 7 | First/Third person, VR… |
| `game_types` | 10 | DLC, Bundle, Mod… **incomplet** (voir §3) |
| `platforms` | 218 | `name`, `url`, `logo_url` |
| `franchises` | 319 | |
| `keywords` | 6 652 | dictionnaire de référence (non interrogé par l'UI) |

### Relations (N-N, libellés TEXT)

| Table | Lignes | Colonnes |
|-------|--------|----------|
| `game_genres` | 617 698 | `game_id`, `genre` |
| `game_platforms` | 516 418 | `game_id`, `platform` |
| `game_modes_rel` | 368 566 | `game_id`, `mode` |
| `game_themes` | 314 301 | `game_id`, `theme` |
| `game_perspectives` | 173 933 | `game_id`, `perspective` |
| `game_keywords` | 675 957 | `game_id`, `keyword` |
| `game_franchises` | 1 348 | `game_id`, `franchise` |
| `game_developers` | 177 664 | `game_id`, `company_id`, `company_name`, `url`, `logo_url` |

### Médias

| Table | Lignes | Colonnes |
|-------|--------|----------|
| `game_screenshots` | 1 675 513 | `game_id`, `url` |
| `game_videos` | 145 579 | `game_id`, `youtube_id` |

Aucune clé étrangère n'est déclarée (les `FOREIGN KEY` du schéma d'origine ne sont pas
présentes dans le fichier livré). Les jointures se font par nom pour les facettes,
par `game_id` pour les relations.

## 3. Particularités des données

- **Notes** : `aggregated_rating` est NULL pour la majorité des jeux. Le filtre par
  défaut (« jeux sans note » désactivé) ne garde donc qu'environ 16 800 jeux.
- **Types de jeu** : les valeurs réellement utilisées incluent `0` (jeu principal),
  `2`, `9`, `10`, `13`, absentes du dictionnaire `game_types`. L'UI complète les
  libellés : `0` Jeu principal, `2` Extension, `9` Remaster, `10` Jeu étendu,
  `13` Pack, sinon `Type #n`.
- **Années** : les timestamps vont jusqu'en 2040 (jeux annoncés) ; la plage par
  défaut est bornée à l'année courante.
- **Mots-clés** : la colonne `keyword` est intégralement en minuscules. Les requêtes
  comparent donc directement `keyword IN (…)` (et non `LOWER(keyword)`), ce qui
  permet d'utiliser l'index.
- **NULL** : aucune valeur NULL dans les colonnes de relation (`game_id`,
  libellé). Les requêtes ajoutent malgré tout `game_id IS NOT NULL` dans les
  sous-requêtes pour rester sûres si la base évolue.
- **Erotic** : thème id 7. Il est verrouillé en exclusion tant que le contenu adulte
  est désactivé dans les paramètres.
- **Fangames/mods** : détectés via les mots-clés listés dans
  `data/fangameandmodes.json` (`fangame`, `fanmade`, `modpack`, `undertale mod`,
  `partial overhaul mod`, `unofficial`, `rom hack`).
- **Plateformes épinglées** : `data/pinnedplatforms.json` (8 noms) est résolu en IDs
  au chargement des filtres.

## 4. Index

Créés en mémoire à chaque démarrage par `Database._createIndexes()` :

| Index | Colonnes | Usage |
|-------|----------|-------|
| `idx_games_release_date` | `games(first_release_date)` | plage d'années |
| `idx_games_rating` | `games(aggregated_rating)` | filtre de note |
| `idx_game_platforms_platform` | `game_platforms(platform, game_id)` | inclusion plateforme |
| `idx_game_genres_genre` | `game_genres(genre, game_id)` | inclusion genre |
| `idx_game_modes_mode` | `game_modes_rel(mode, game_id)` | inclusion mode |
| `idx_game_themes_theme` | `game_themes(theme, game_id)` | inclusion thème |
| `idx_game_perspectives_persp` | `game_perspectives(perspective, game_id)` | inclusion perspective |
| `idx_game_keywords_keyword` | `game_keywords(keyword, game_id)` | fangames, Game Awards |
| `idx_games_game_type` | `games(game_type)` | types de jeux |
| `idx_game_developers_company` | `game_developers(company_id, game_id)` | fiche développeur |
| `idx_game_franchises_franchise` | `game_franchises(franchise, game_id)` | franchise |
| `idx_game_developers_game` | `game_developers(game_id)` | relations jeu |
| `idx_game_screenshots_game` | `game_screenshots(game_id)` | fiche jeu |
| `idx_game_videos_game` | `game_videos(game_id)` | fiche jeu |
| `idx_game_perspectives_game` | `game_perspectives(game_id)` | fiche jeu |

Coût mesuré : ≈ 3,3 s au total sur la machine de test (Chromium, base en mémoire),
dont ≈ 0,5 s pour les captures d'écran et 0,3 s pour `ANALYZE`. Les index alourdissent
la base en mémoire (≈ +100 Mo) mais évitent des scans complets à chaque filtre.

## 5. Requêtes typiques

```sql
-- Détail d'un jeu (GameBusiness.getById + _enrich)
SELECT * FROM games WHERE id = ?;
SELECT genre FROM game_genres WHERE game_id = ?;
SELECT platform FROM game_platforms WHERE game_id = ?;
SELECT mode FROM game_modes_rel WHERE game_id = ?;
SELECT theme FROM game_themes WHERE game_id = ?;
SELECT perspective FROM game_perspectives WHERE game_id = ?;
SELECT company_id, company_name FROM game_developers WHERE game_id = ?;
SELECT url FROM game_screenshots WHERE game_id = ?;
SELECT youtube_id FROM game_videos WHERE game_id = ?;
SELECT keyword FROM game_keywords WHERE game_id = ?;

-- Liste paginée de jeux (30 par page, ids croissants)
SELECT id, name, cover_url, aggregated_rating, rating, first_release_date
FROM games ORDER BY id ASC LIMIT 31 OFFSET ?;

-- Développeur : une seule requête jointe, bornée à 60 jeux
SELECT g.id, g.name, g.cover_url, g.first_release_date
FROM game_developers d JOIN games g ON g.id = d.game_id
WHERE d.company_id = ? GROUP BY g.id
ORDER BY g.first_release_date DESC LIMIT 60;
```

La pagination charge **31** lignes pour savoir s'il existe une page suivante, puis
n'en affiche que 30. Les IDs manquants sont ignorés : une page peut contenir moins de
30 éléments.

## 6. Limites structurelles

- Toute la base est en RAM : environ 400 Mo + index. Sur un appareil mobile modeste,
  le chargement peut échouer par manque de mémoire.
- Le premier chargement télécharge 86 Mo ; les suivants lisent IndexedDB.
- `ANALYZE` et la création d'index allongent le démarrage mais accélèrent les
  requêtes. Ils sont refaits à chaque rechargement (aucune persistance des index).
- Les tables relationnelles stockent des **libellés** : renommer une valeur IGDB
  casserait la correspondance ; les IDs ne sont fiables que pour `game_type`.

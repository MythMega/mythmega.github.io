# Schéma de la base SQLite : games.db

Cette base contient toutes les données IGDB nécessaires pour une application client-side utilisant SQLite WASM.

---

## Table : `games`

| Champ | Type | Description |
|-------|------|-------------|
| id | INTEGER PRIMARY KEY | ID unique du jeu |
| name | TEXT | Nom du jeu |
| aggregated_rating | REAL | Note agrégée |
| rating | REAL | Note utilisateur |
| first_release_date | INTEGER | Timestamp UNIX |
| storyline | TEXT | Histoire |
| summary | TEXT | Résumé |
| cover_url | TEXT | URL de la jaquette |
| updated_at | INTEGER | Timestamp de mise à jour |
| url | TEXT | URL IGDB |
| game_type | INTEGER | FK → game_types.id |

---

## Tables dictionnaires

### `game_types`

| Champ | Type | Description |
|-------|------|-------------|
| id | INTEGER PRIMARY KEY | ID IGDB |
| type | TEXT | Label (ex: DLC, Mod, Bundle…) |

> Source : `game_type.json` (récupéré via `gametype.bat`).

---

### `genres`, `game_modes`, `player_perspectives`, `themes`, `franchises`, `keywords`

| Champ | Type | Description |
|-------|------|-------------|
| id | INTEGER PRIMARY KEY | ID auto-incrémenté |
| name | TEXT | Nom lisible |

### `platforms`

| Champ | Type | Description |
|-------|------|-------------|
| id | INTEGER PRIMARY KEY | ID auto-incrémenté |
| name | TEXT | Nom lisible |
| url | TEXT | URL IGDB de la plateforme |
| logo_url | TEXT | URL du logo (t_1080p) |

---

## Tables relationnelles (N-N)

### `game_genres`

| Champ | Type |
|-------|------|
| game_id | INTEGER |
| genre | TEXT |

### `game_platforms`

| Champ | Type |
|-------|------|
| game_id | INTEGER |
| platform | TEXT |

### `game_modes_rel`

| Champ | Type |
|-------|------|
| game_id | INTEGER |
| mode | TEXT |

### `game_perspectives`

| Champ | Type |
|-------|------|
| game_id | INTEGER |
| perspective | TEXT |

### `game_keywords`

| Champ | Type |
|-------|------|
| game_id | INTEGER |
| keyword | TEXT |

### `game_themes`

| Champ | Type |
|-------|------|
| game_id | INTEGER |
| theme | TEXT |

---

## Tables médias

### `game_screenshots`

| Champ | Type |
|-------|------|
| game_id | INTEGER |
| url | TEXT |

### `game_videos`

| Champ | Type |
|-------|------|
| game_id | INTEGER |
| youtube_id | TEXT |

---

## Table développeurs

### `game_developers`

| Champ | Type |
|-------|------|
| game_id | INTEGER |
| company_id | INTEGER |
| company_name | TEXT |
| url | TEXT |
| logo_url | TEXT |

---

## Table franchises

### `franchises`

| Champ | Type |
|-------|------|
| id | INTEGER |
| name | TEXT |

### `game_franchises`

| Champ | Type | Description |
|-------|------|-------------|
| game_id | INTEGER | ID du jeu |
| franchise | TEXT | Nom de la franchise (correspond à `franchises.name`) |

---

# Notes

- Les relations utilisent les **noms** (ex : "RPG") plutôt que les IDs IGDB pour simplifier l’usage client-side.
- La base est compatible **SQLite WASM** sans modification.
- Le chargement dans le navigateur se fait via `sql.js` ou `wa-sqlite`.

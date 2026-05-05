# Pages de détail individuelles — Gamefinder 2.0

Toutes les pages de détail restent dans `app.html` (routage côté client) pour ne pas perdre la base de données en mémoire.

---

## Jeu (`app.html?game=<id>`)

**Composant :** `Scripts/ui/GameDetailUI.js`  
**Business :** `Scripts/business/GameBusiness.js`

### Données affichées

| Section | Contenu |
|---------|---------|
| Cover | Image de jaquette (`games.cover_url`) |
| Titre | `games.name` |
| ID IGDB | `games.id` |
| Année de sortie | `games.first_release_date` (timestamp → année) |
| Note | `games.aggregated_rating` ou `games.rating` sur 100, barre de progression |
| Lien IGDB | `games.url` (lien externe) |
| Genres | Tags issus de `game_genres.genre` |
| Plateformes | Tags issus de `game_platforms.platform` |
| Résumé | `games.summary` |
| Histoire | `games.storyline` |
| Modes de jeu | Tags issus de `game_modes_rel.mode` |
| Perspectives | Tags issus de `game_perspectives.perspective` |
| Thèmes | Tags issus de `game_themes.theme` |
| Développeurs | Tags cliquables → `app.html?developer=<company_id>` |
| Vidéos | Liens YouTube issus de `game_videos.youtube_id` |
| Captures d'écran | Galerie horizontale depuis `game_screenshots.url` |

---

## Développeur (`app.html?developer=<id>`)

**Composant :** `Scripts/ui/DeveloperDetailUI.js`  
**Business :** `Scripts/business/DeveloperBusiness.js`

### Données affichées

| Section | Contenu |
|---------|---------|
| Titre | `game_developers.company_name` |
| ID | `game_developers.company_id` |
| Jeux | Grille des jeux développés (cover + nom), cliquables → détail jeu |

---

## Franchise (`app.html?franchise=<id>`)

**Composant :** `Scripts/ui/FranchiseDetailUI.js`  
**Business :** `Scripts/business/FranchiseBusiness.js`

### Données affichées

| Section | Contenu |
|---------|---------|
| Titre | `franchises.name` |
| ID | `franchises.id` |
| Jeux | (à implémenter — nécessite table de liaison game ↔ franchise) |

---

## Genre (`app.html?genre=<id>`)

**Composant :** `Scripts/ui/GenericDetailUI.js`

| Section | Contenu |
|---------|---------|
| Titre | Nom du genre (depuis `genres.name`) |
| ID | `genres.id` |
| Jeux | (à implémenter) |

---

## Plateforme (`app.html?platform=<id>`)

**Composant :** `Scripts/ui/GenericDetailUI.js`

| Section | Contenu |
|---------|---------|
| Titre | Nom de la plateforme (depuis `platforms.name`) |
| ID | `platforms.id` |
| Jeux | (à implémenter) |

---

## Thème (`app.html?theme=<id>`)

**Composant :** `Scripts/ui/GenericDetailUI.js`

| Section | Contenu |
|---------|---------|
| Titre | Nom du thème (depuis `themes.name`) |
| ID | `themes.id` |
| Jeux | (à implémenter) |

---

## Notes communes

- Toutes les pages incluent un **en-tête** (boutons Accueil, Roulette, Données) et un **pied de page** (liens externes).
- Les éléments apparaissent avec une **animation de fondu + montée** via IntersectionObserver (classe `.reveal` → `.reveal.visible`).
- Si un ID est introuvable en DB, un message d'erreur lisible est affiché à la place du contenu.

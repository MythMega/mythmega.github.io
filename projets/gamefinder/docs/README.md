# Gamefinder 2.0 — Documentation

Gamefinder 2.0 est une application web **100 % client-side** qui permet de parcourir
une base de jeux vidéo issue d'IGDB (370 060 jeux), d'explorer ses entités
(développeurs, franchises, genres, plateformes, thèmes) et de tirer un jeu au hasard
selon des critères très fins.

Il n'y a **aucun serveur applicatif, aucune API, aucune base distante** : la base
SQLite compressée est téléchargée puis chargée en mémoire dans le navigateur via
WASM. Toute la logique (requêtes, routage, profil, XP) s'exécute côté client.

## Démarrage rapide

```bash
# Depuis la racine du projet
python -m http.server 5600
# puis ouvrir http://localhost:5600/app.html
```

Sous Windows, `start_server.cmd` fait la même chose (port 5600).
L'application doit être servie en HTTP : `file://` ne permet ni `fetch` ni les
Web Workers/WASM nécessaires.

## Sommaire

| Document | Contenu |
|----------|---------|
| [01-architecture.md](01-architecture.md) | Couches, cycle de démarrage, fichiers, globals, flux de données |
| [02-database.md](02-database.md) | Schéma SQLite réel, volumes, index, chargement/décompression/cache |
| [03-filters-roulette.md](03-filters-roulette.md) | Moteur de filtres tri-état, format des réglages, SQL, sauvegarde, migration |
| [04-ui-pages.md](04-ui-pages.md) | Header, accueil, recherche, listes, pages de détail, profil, paramètres |
| [05-profile-progression.md](05-profile-progression.md) | IndexedDB, XP, niveaux, listes « à faire » / « masqués », filtres sauvegardés |
| [06-design-system.md](06-design-system.md) | Direction artistique vert & argent, tokens, composants, accessibilité |
| [07-audit-securite-performance.md](07-audit-securite-performance.md) | Failles recherchées, correctifs appliqués, risques restants, mesures |
| [08-changelog.md](08-changelog.md) | Récapitulatif des changements de cette itération |

## Carte du dépôt

```text
app.html                     SPA : loader, scripts, bootstrap, routage initial
index.html                   Redirection vers app.html
database.db.br               Base SQLite compressée en Brotli (86 Mo → 396 Mo)
keywords.json                Dictionnaire de mots-clés IGDB (référence)
data/
  fangameandmodes.json       Mots-clés exclus quand « fangame/mod » est désactivé
  pinnedplatforms.json       Plateformes mises en avant et incluses par défaut
styles/
  variables.css              Tokens de la DA (couleurs, fonts, rayons, z-index)
  base.css                   Reset, fond, typographie, scrollbar, sélection
  components.css             Boutons, recherche, tags, loader, pagination, lightbox…
  layout.css                 Header, footer, héros, grilles, détail jeu, animations
  filters.css                Filtres tri-état, sliders, popups, vue roulette
Scripts/
  classes/                   Modèles + infrastructure (Database, Router, Settings…)
  business/                  Requêtes et règles métier
  ui/                        Rendu HTML et événements, une classe par page
```

> Les documents historiques à la racine (`structure.md`, `list.md`, `unique_info.md`)
> sont conservés ; `docs/` est la référence à jour.

## Conventions de lecture

- **Facette** : une catégorie de critère (plateforme, genre, thème, mode,
  perspective, type de jeu).
- **Valeur de facette** : un élément d'une catégorie (« Nintendo Switch »,
  « Action », « First person »…).
- **État** : `1` = inclure, `-1` = exclure, `0` = ignorer (N/A).
- Les chemins de fichiers sont relatifs à la racine du projet.

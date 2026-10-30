# MineCards — spécification détaillée du projet

Ce dossier décompose **toute l'application MineCards** : architecture, fonctionnalités, interface
et visuels, données sauvegardées et configuration. Il complète `.docs/main.md` (le cahier des
charges d'origine, section par section) et `.docs/steps/` (les étapes de construction), mais il est
écrit **depuis l'état réel du code** : chaque affirmation a été vérifiée dans les sources, les
feuilles de style, les fichiers de données et `settings/config.json`.

## Sommaire

| Fichier | Contenu |
|---|---|
| [01-architecture.md](01-architecture.md) | Arborescence, démarrage de l'application, routeur SPA, bus d'événements, managers, chargement de la configuration, performance, linter. |
| [02-fonctionnalites.md](02-fonctionnalites.md) | Toutes les fonctionnalités, vue par vue et manager par manager, avec leurs règles, leurs cas limites et les données qu'elles touchent. |
| [03-interface-visuelle.md](03-interface-visuelle.md) | Système visuel, thèmes, typographie, cartes, foil et halos, animations, responsive, accessibilité, raccourcis clavier, description écran par écran. |
| [04-donnees-et-configuration.md](04-donnees-et-configuration.md) | Fichiers de configuration et de données, format des cartes, catalogues, i18n, service worker, export/import. |
| [05-daily-rewards.md](05-daily-rewards.md) | Récompenses de connexion : schéma du fichier de chapitres, avancement de la série, popup, auras, claim et garde-fous. |
| [database.md](database.md) | Schéma complet d'IndexedDB (`CardBoosterDB`), clés de `user_state`, format `.save`, miroir `localStorage`, transactions, migrations. |

## Fiche technique

- **Nom** : MineCards — jeu de collection de cartes Minecraft.
- **Nature** : application web *full client*, installable (PWA), jouable hors-ligne.
- **Aucun serveur applicatif** : le navigateur est la seule source de vérité ; les seuls appels
  réseau sont les fournisseurs d'heure UTC, le Google Sheet des distributions, le CDN Three.js
  épinglé et (facultativement) les codes personnels générés hors ligne.
- **Stack** : HTML5, CSS3, JavaScript ES2022+ natif (`<script type="module">`), JSON.
- **Dépendance externe unique** : Three.js r160 + `GLTFLoader` (import map épinglée dans
  `index.html`, import dynamique depuis `js/UI/components/Booster3DRenderer.js`).
- **Stockage** : IndexedDB `CardBoosterDB` (version 1) + miroir `localStorage` du thème et de la
  langue pour éviter le flash au premier rendu.
- **Langues** : `fr` et `en` (`settings/i18n/`), extensibles par fichier + entrée `config.json`.
- **Thèmes** : Sombre (défaut), Clair, Classic, Ciel, Nuit.
- **Animations d'ouverture** : Normal, Épique (défaut livré par `animations.default`), Explosif (mode parodique).
- **Build** : aucun. Pas de bundler, pas de transpileur, pas de `npm install`. Un serveur HTTP
  statique suffit (`start_server.cmd`, `start_server_public.cmd`).
- **Qualité** : `node tools/lint.mjs` (33 règles, zéro dépendance), `lint.cmd` sous Windows.

## Carte du dépôt

```
index.html                     application SPA (toutes les vues en sections data-view)
overlay.html + js/overlay.js   overlay de stream, autonome (n'importe rien de js/)
collection.html + js/binder-share.js   page de lecture d'un binder partagé, autonome
manifest.json / sw.js          PWA : installation, précache, stratégies de cache
assets/                        images, sons, modèle 3D, icônes de trophées
cards/                         illustrations de cartes (374 Mo, mises en cache à l'usage)
css/                           base, thèmes, polices, vues, composants, animations
data/                          catalogues de données (boosters, promos, trophées, titres, icônes, boutique)
js/
├── app.js                     classe App : démarrage, compteurs d'en-tête, cycle de vie des vues
├── models/StorageRepository.js  unique point d'accès à IndexedDB
├── classes/                   Card.js, SaveFile.js
├── business/                  managers (compte, gacha, quota, collection, mine, trophées, …)
├── UI/
│   ├── SpaRouter.js           routeur de vues sans table de routes
│   ├── views/                 une vue par écran
│   └── components/            composants partagés (carte, notifier, toasts, 3D, …)
└── utils/                     i18n, thème, foil, glow, sons, compression, bus d'événements, deep link
settings/                      config.json, i18n/, mining.json, codes.json, trophées, overlay
tools/lint.mjs                 linter maison
external/                      outils annexes (cardmakerz, boosterciewerz, admin, …)
```

## Comment lire ces documents

- Les **chemins** cités sont relatifs à la racine du dépôt.
- Les noms de clés IndexedDB, de champs de données et d'événements sont en `code`.
- Quand un comportement dépend d'une valeur de `settings/config.json`, la valeur par défaut livrée
  est indiquée entre parenthèses.
- `database.md` est la référence pour tout ce qui touche à la persistance ; les autres fichiers s'y
  renvoient au lieu de la dupliquer.

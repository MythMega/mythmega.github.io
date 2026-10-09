# Architecture du projet

## Structure des fichiers

```
pokefeet/
├── index.html              # Page d'accueil
├── pokefeet.html           # Mode Marathon (entraînement)
├── daily.html              # Mode Daily
├── weekly.html             # Mode Weekly
├── history.html            # Historique des parties
├── stats.html              # Statistiques, XP, trophées
├── profile.html            # Redirige vers data_management.html
├── data_management.html    # Gestion des données (export/import)
├── pied-dex.html           # Pokédex
├── prediction.html         # Prédictions (?)
├── changelog.html          # Changelog
├── integration-pokefeet.html # Page d'intégration
│
├── style.css               # Styles globaux
├── cosmetics.css           # Styles cosmétiques (badges, etc.)
│
├── pokemon.js              # Classe Pokemon + TypeIcons
├── pokemon-versions.js     # Gestion des versions de données
├── game.js                 # Logique du mode Marathon
├── daily.js                # Logique du mode Daily
├── weekly.js               # Logique du mode Weekly
├── history.js              # Affichage de l'historique
├── history_curve.js        # Courbes de progression
├── stats.js                # Statistiques, XP, trophées
├── profile.js              # Gestion du pseudo
├── Dex.js                  # Pokédex (logique IndexedDB)
├── Dex-ui.js               # Pokédex (UI)
├── DailyToDexImport.js     # Import Daily/Weekly → Dex
├── data.js                 # Gestion export/import des données
├── migration.js            # Migration entre versions
├── ui.js                   # Composants UI partagés
├── loader.js               # Loader / écran de chargement
├── footer.js               # Footer commun
├── i18n-setup.js           # Configuration i18n
├── language-switcher.js    # Sélecteur de langue
├── translate.js            # Fonctions de traduction
├── apply-translations.js   # Application des traductions au DOM
│
├── data/
│   ├── pokemons.json       # Tous les Pokémon (Index, noms, types, images)
│   ├── version.json        # Versions des données et dates de déploiement
│   ├── trophies.json       # Définition des trophées
│   ├── reward.json         # Récompenses (badges, titres)
│   ├── cosmetics.json      # Cosmétiques
│   ├── bonus_challenges.json # Défis bonus
│   ├── backup.json         # Backup
│   └── ...
│
├── translations/
│   ├── fr.json             # Traductions françaises
│   └── en.json             # Traductions anglaises
│
├── bindings/
│   └── type_icons.json     # URLs des icônes par type
│
├── img/                    # Images (sprites, badges, trophées)
│
└── docs/                   # Cette documentation
```

## Dépendances entre modules

```
pokemon.js (classe Pokemon + TypeIcons)
    ↑
pokemon-versions.js (filtre par version)
    ↑
    ├── game.js (Marathon) → ui.js
    ├── daily.js (Daily)   → ui.js (partiellement)
    ├── weekly.js (Weekly) → ui.js (partiellement)
    ├── history.js         → Dex.js
    ├── stats.js           → Dex.js
    ├── DailyToDexImport.js
    └── Dex.js → Dex-ui.js

data.js (export/import) → Dex.js, DailyToDexImport.js
migration.js            → data.js (IndexedDB)
```

## Flux de données

1. **Initialisation** : Chaque page charge `data/pokemons.json` via `fetch()`, crée des instances de `Pokemon`
2. **Filtrage** : `PokemonVersions` filtre les Pokémon disponibles selon la date courante
3. **Jeu** : Le mode de jeu sélectionne un Pokémon, affiche son image partielle, gère les essais
4. **Sauvegarde** : Les résultats sont persistés dans IndexedDB (daily_results, weekly_results)
5. **Dex** : Les Pokémon trouvés sont marqués dans une base IndexedDB séparée (PokefeetDexDB)
6. **Stats** : Les stats sont calculées dynamiquement à partir de l'historique

## Principes d'architecture

- **Modules IIFE** : Chaque fichier JS est une IIFE (Immediately Invoked Function Expression) retournant un objet public
- **Pas de framework** : Tout est vanilla JS, pas de dépendances externes
- **Déterminisme** : Daily et Weekly utilisent un PRNG seedé (Mulberry32) pour que tout le monde ait les mêmes Pokémon
- **Stockage local** : Pas de backend — tout est stocké côté client (IndexedDB, cookies, localStorage)
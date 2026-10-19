# 02 — Architecture et cartographie réelle

## 1. Type d'application

Application **statique multipage** (MPA), sans build, sans framework, sans backend :

- 21 fichiers HTML, chacun est une page autonome ;
- 35 fichiers JavaScript chargés par balises `<script>` classiques (IIFE ou classes globales) ;
- 5 feuilles CSS ;
- données statiques JSON + images ;
- persistance navigateur uniquement.

Il n'y a **ni `package.json`, ni bundler, ni modules ES**, ni transpilation. Les fichiers s'exposent via des variables globales (`const Game`, `class Pokemon`, `window.HistoryCurve`, etc.). L'ordre des balises `<script>` est donc une dépendance implicite.

---

## 2. Trois couches coexistent

### 2.1 Couche « réorganisée » (partielle)

| Dossier | Rôle attendu | Contenu réel |
|---|---|---|
| `entity/` | Modèles métier | `Challenge`, `Reward`, `RewardItem`, `RewardButton` |
| `business/` | Règles et stockage | `challenge-manager.js`, `challenge-storage.js`, `custom_challenges/custom-challenge-game.js`, `custom-challenge-codec.js` |
| `ui/` | Rendu et interactions | `challenge-game-ui.js`, `challenge-list-ui.js`, `custom_challenges/custom-create-ui.js`, `custom-play-ui.js` |

Cette couche ne couvre que les **challenges bonus**, les **challenges custom** et les **récompenses**.

### 2.2 Couche « legacy » à la racine

Tous les autres domaines restent monolithiques à la racine :

| Fichier | Lignes | Domaine |
|---|---:|---|
| `daily.js` | 1174 | Métier + UI + IndexedDB du Daily |
| `weekly.js` | 1033 | Métier + UI + IndexedDB du Weekly |
| `data.js` | 934 | Export/import + IndexedDB + parsing de texte |
| `stats.js` | 917 | XP + trophées + rendu + récompenses |
| `history_curve.js` | 717 | Graphiques + statistiques |
| `migration.js` | 660 | Migration des 3 bases + cookies |
| `game.js` | 654 | Métier + UI du Marathon |
| `history.js` | 343 | Listes d'historique |
| `cosmetics.js` | 298 | Cosmétiques + accès `ChallengeStorage` |
| `Dex-ui.js` | 286 | Grille et popup du Pokédex |
| `DailyToDexImport.js` | 272 | Reconstruction des listes + import Dex |
| `old_daily.js` | 223 | Calendrier des défis passés |
| `ui.js` | 183 | Rendu du Marathon |
| `Dex.js` | 167 | Accès `PokefeetDexDB` |
| `pokemon.js` | 58 | Entité `Pokemon` + `TypeIcons` |
| `pokemon-versions.js` | 61 | Filtrage par version |
| `profile.js` | 58 | **mort** (voir doc 16) |
| `translate.js` | 94 | i18n |
| `i18n-setup.js` | 51 | Application des traductions |
| `language-switcher.js` | 224 | Sélecteur de langue |
| `loader.js` | 87 | Overlay + skeletons |
| `footer.js` | 29 | Footer |
| `credits.js` | 206 | Page crédits |
| `pokemon.js`/`pokemon-versions.js` | — | Entités partagées |

### 2.3 Pages et scripts inline

Certaines fonctionnalités vivent **uniquement dans le HTML** :

- `data.html` : visualiseur de données (≈ 250 lignes de JS inline) ;
- `prediction.html` : page protégée de prédiction (≈ 350 lignes de JS inline) ;
- `data_management.html` : gestion du pseudo, du mode rapide et rendu des cosmétiques (≈ 200 lignes inline) ;
- `index.html` : bandeau d'actualités Google Sheets ;
- `challenge.html` : orchestration de la page challenge ;
- `pied-dex.html` : initialisation du Dex ;
- `stats.html` : structure des onglets (logique dans `stats.js`).

---

## 3. Matrice page → scripts

Les scripts sont listés dans l'ordre de chargement réel.

| Page | Scripts |
|---|---|
| `index.html` | `loader`, `translate`, `language-switcher`, `footer`, `i18n-setup`, `migration`, `business/challenge-storage`, `cosmetics` + 2 inline |
| `pokefeet.html` | `loader`, `translate`, `language-switcher`, `footer`, `i18n-setup`, `migration`, `pokemon`, `pokemon-versions`, `business/challenge-storage`, `cosmetics`, `game`, `ui` |
| `daily.html` | `loader`, `translate`, `language-switcher`, `footer`, `i18n-setup`, `pokemon`, `migration`, `Dex`, `pokemon-versions`, `business/challenge-storage`, `cosmetics`, `daily` |
| `weekly.html` | `loader`, `translate`, `language-switcher`, `footer`, `i18n-setup`, `pokemon`, `migration`, `Dex`, `pokemon-versions`, `business/challenge-storage`, `cosmetics`, `weekly` |
| `old_daily.html` | `loader`, `translate`, `language-switcher`, `footer`, `i18n-setup`, `migration`, `pokemon`, `business/challenge-storage`, `cosmetics`, `old_daily` |
| `history.html` | `loader`, `translate`, `language-switcher`, `footer`, `i18n-setup`, `migration`, `business/challenge-storage`, `pokemon`, `pokemon-versions`, `cosmetics`, `history`, `history_curve` |
| `stats.html` | `loader`, `entity/reward/rewardButton`, `entity/reward/rewardItem`, `entity/reward/reward`, `translate`, `language-switcher`, `footer`, `i18n-setup`, `migration`, `profile`, `pokemon-versions`, `business/challenge-storage`, `cosmetics`, `stats` |
| `pied-dex.html` | `loader`, `translate`, `language-switcher`, `footer`, `i18n-setup`, `migration`, `business/challenge-storage`, `pokemon`, `pokemon-versions`, `cosmetics`, `Dex`, `Dex-ui`, `DailyToDexImport` + inline init |
| `list_challenges.html` | `pokemon`, `pokemon-versions`, `Dex`, `entity/challenge`, `business/challenge-storage`, `business/challenge-manager`, `ui/challenge-list-ui`, `loader`, `cosmetics`, `migration`, `i18n-setup`, `language-switcher`, `translate` |
| `challenge.html` | `pokemon`, `pokemon-versions`, `Dex`, `entity/challenge`, `business/challenge-storage`, `business/challenge-manager`, `ui/challenge-game-ui`, `loader`, `cosmetics`, `migration`, `i18n-setup`, `language-switcher`, `translate` + inline |
| `custom.html` | `loader`, `translate`, `language-switcher`, `footer`, `i18n-setup`, `migration`, `business/challenge-storage`, `cosmetics` |
| `custom_create.html` | `loader`, `translate`, `language-switcher`, `footer`, `i18n-setup`, `pokemon`, `migration`, `business/challenge-storage`, `cosmetics`, `business/custom_challenges/custom-challenge-codec`, `ui/custom_challenges/custom-create-ui` |
| `custom_play.html` | `loader`, `translate`, `language-switcher`, `footer`, `i18n-setup`, `pokemon`, `migration`, `business/challenge-storage`, `cosmetics`, `business/custom_challenges/custom-challenge-codec`, `business/custom_challenges/custom-challenge-game`, `ui/custom_challenges/custom-play-ui` |
| `data_management.html` | `loader`, `translate`, `language-switcher`, `footer`, `i18n-setup`, `migration`, `business/challenge-storage`, `cosmetics`, `pokemon`, `pokemon-versions`, `Dex`, `DailyToDexImport`, `data` + 4 inline |
| `data.html` | `loader`, `translate`, `language-switcher`, `footer`, `i18n-setup` + 1 inline |
| `changelog.html` | `loader`, `translate`, `language-switcher`, `footer`, `i18n-setup`, `migration`, `pokemon`, `business/challenge-storage`, `cosmetics` |
| `credits.html` | `loader`, `translate`, `language-switcher`, `footer`, `i18n-setup`, `migration`, `business/challenge-storage`, `cosmetics`, `credits` |
| `profile.html` | aucun (redirection meta vers `data_management.html`) |
| `prediction.html` | aucun script externe + 1 inline |
| `integration-pokefeet.html` | aucun |
| `test-i18n.html` | `translate`, `language-switcher`, `i18n-setup` |

> Les pages `custom_create.html`/`custom_play.html` chargent `migration.js` et `challenge-storage.js` uniquement parce que `cosmetics.js` en dépend. Aucune donnée de challenge custom n'est persistée.

---

## 4. Graphe de dépendances réel

```text
pokemon.js (Pokemon, TypeIcons)
└── pokemon-versions.js (PokemonVersions)
    ├── game.js ───────────────► ui.js
    ├── daily.js ──────────────► Dex.js, migration.js
    ├── weekly.js ─────────────► Dex.js, migration.js
    ├── DailyToDexImport.js ───► Dex.js, PokemonVersions
    ├── Dex.js ────────────────► IndexedDB PokefeetDexDB
    ├── Dex-ui.js ─────────────► Dex.js, DailyToDexImport
    ├── old_daily.js ──────────► PokefeetDB
    ├── history.js ────────────► PokefeetDB
    ├── history_curve.js ──────► PokefeetDB
    ├── stats.js ──────────────► PokefeetDB, PokefeetDexDB, Reward
    ├── data.js ───────────────► PokefeetDB, Dex.js, DailyToDexImport, ChallengeStorage
    └── migration.js ──────────► 3 bases + cookies

entity/challenge.js
└── business/challenge-manager.js ──► ChallengeStorage, Dex, PokefeetDB, JSON
    ├── ui/challenge-list-ui.js
    └── ui/challenge-game-ui.js

business/custom_challenges/custom-challenge-codec.js (aucune dépendance)
business/custom_challenges/custom-challenge-game.js ──► Pokemon
└── ui/custom_challenges/custom-play-ui.js

entity/reward/*.js ──► Translator (optionnel)
└── stats.js

cosmetics.js ──► ChallengeStorage, data/cosmetics.json
translate.js
└── i18n-setup.js ──► language-switcher.js
loader.js ──► Cosmetics.load() (optionnel)
```

### Dépendances inverses / violations

- `loader.js` dépend de `Cosmetics` alors que `Cosmetics` dépend de `ChallengeStorage`, qui dépend d'IndexedDB : le charger déclenche une ouverture de base sur **toutes** les pages.
- `Challenge` (entité) appelle `ChallengeManager.getPlayerLevel()` et `Dex` directement : l'entité dépend de la couche métier.
- `business/challenge-manager.js` contient une copie du calcul d'XP de `stats.js`.
- `Dex-ui.js` appelle `DailyToDexImport.forceUpdate()` : l'UI déclenche un import de données.
- `data_management.html` réimplémente en inline le profil (`profile.js`) et le rendu des cosmétiques (`Cosmetics.renderCosmeticsUI`).
- `stats.html` charge `profile.js` mais n'appelle jamais `ProfileInit()` ; `profile.js` est donc inerte.

---

## 5. Cycle de vie d'une page

1. **Parsing HTML** : les scripts sont chargés dans l'ordre, sans `defer`/`module`. Les scripts en fin de `<body>` s'exécutent quand le DOM existant est déjà parsé (mais pas forcément `DOMContentLoaded`).
2. **`loader.js`** injecte immédiatement `#page-loader`, puis masque l'overlay au `load` (ou après 2,5 s), en appelant `Cosmetics.load()` avant.
3. **`migration.js`** expose `Migration.ready`, une promesse résolue après migration des 3 bases. Les modules qui ouvrent IndexedDB attendent `Migration.ready` : `daily.js`, `weekly.js`, `stats.js`, `old_daily.js`, `challenge.html`.
4. **`i18n-setup.js`** attend `DOMContentLoaded`, charge FR/EN via `fetch`, applique `[data-i18n]` et `[data-i18n-attr]`, puis initialise le sélecteur.
5. **Chaque module de page** s'auto-initialise sur `DOMContentLoaded` (`daily`, `weekly`, `old_daily`, `stats`, `history`, `credits`, `challenge-list`, `custom-*`) ou est appelé par un script inline (`Dex`, `DataManager`, `ChallengeGameUI`).
6. **Ordre relatif** : `translate.js` peut être chargé après `i18n-setup.js` (c'est le cas sur `list_challenges.html`), mais le handler `DOMContentLoaded` s'exécute après tous les scripts, donc `Translator` existe. En revanche, les scripts inline qui utilisent `Translator` immédiatement (hors handler) échoueraient.

### Risques de course

- `Cosmetics.load()` peut ouvrir `PokefeetChallengeDB` avant la fin de `Migration.ready`.
- `daily.js`/`weekly.js` attendent la migration, mais `loader.js` et `cosmetics.js` non.
- `data_management.html` initialise `DataManager` sur `DOMContentLoaded` sans attendre `Migration.ready`.
- Plusieurs onglets ouverts peuvent déclencher `onblocked` lors d'une mise à jour de version IndexedDB.

---

## 6. Espace de noms global

Les identifiants suivants sont globaux et partagés entre scripts :

`Pokemon`, `TypeIcons`, `PokemonVersions`, `Translator`, `LanguageSwitcher`, `Migration`, `Cosmetics`, `Dex`, `DexUI`, `DailyToDexImport`, `Daily`, `Weekly`, `Game`, `UI`, `OldDaily`, `History` (IIFE implicite), `HistoryCurve` (`window`), `DataManager`, `Challenge`, `ChallengeManager`, `ChallengeStorage`, `ChallengeListUI`, `ChallengeGameUI`, `CustomChallengeCodec`, `CustomChallengeGame`, `CustomCreateUI`, `CustomPlayUI`, `Reward`, `RewardItem`, `RewardButton`, `Credits`, `ProfileInit`, `COOKIE_NAME`, `setCookie`, `getCookie`, `eraseCookie`.

### Collisions potentielles

- `setCookie`/`getCookie`/`eraseCookie` sont définis **globalement** dans `profile.js` et dans des scripts inline (`data_management.html`).
- `PASSWORD_HASH` est une constante globale dans `prediction.html` uniquement.
- `History` n'est pas exposé : `history.js` est une IIFE anonyme qui s'auto-initialise.
- `HistoryCurve` est le seul module explicitement attaché à `window` (en plus des classes).

---

## 7. Cartographie des données statiques

```
data/
├── pokemons.json            698 entrées — source de vérité des Pokémon
├── version.json             4 vagues de disponibilité
├── trophies.json            79 trophées
├── reward.json              14 paliers de récompenses
├── cosmetics.json           39 cosmétiques
├── bonus_challenges.json    32 challenges bonus
├── credits.json             crédits par type/ressource
├── backup.json              sauvegarde historique (non lue au runtime)
├── new_backup.json          sauvegarde historique (non lue au runtime)
├── pokefeet_commits.csv     données de suivi (non lues au runtime)
├── result_analyse_challenge.log
├── analyse_challenges.py
├── egggroup-category.py
├── newpic.py
└── setversion.py
```

```
bindings/type_icons.json     URLs des icônes de type
translations/fr.json         437 clés
translations/en.json         437 clés
img/1-151, 152-250, ...      sprites partiels
img/fullsprite/              sprites complets
img/trophy/                  trophées
img/badges/                  badges de profil
img/cosmetics/               fonds et boutons
```

---

## 8. Ce que la restructuration devra corriger en priorité

1. **Une seule implémentation** par règle : seed/shuffle, normalisation, scoring, XP, partage, cookies, IndexedDB.
2. **Séparer** métier / persistance / rendu, y compris pour les modes historiques.
3. **Supprimer les dépendances implicites** à l'ordre des scripts et à `window`.
4. **Rendre la migration et l'ouverture IndexedDB uniques** (un seul module de base, `Migration.ready` respecté partout).
5. **Traiter le code mort avant le déplacement** : supprimer les pages orphelines et les exports inutilisés évite de les migrer.
6. **Introduire des tests** sur les fonctions pures et les formats de sauvegarde avant tout déplacement massif.

Voir [18-plan-de-restructuration.md](./18-plan-de-restructuration.md) pour la cible et les phases.

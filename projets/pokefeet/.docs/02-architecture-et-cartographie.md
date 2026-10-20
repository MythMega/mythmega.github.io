# 02 — Architecture et cartographie réelle

> **État** : réorganisation physique effectuée. Les 21 pages HTML restent à la racine ; les 36 scripts sont regroupés dans `js/` et les 25 feuilles dans `styles/`. Les évolutions fonctionnelles récentes sont décrites dans les documents dédiés.

## 1. Type d'application

Application **statique multipage** (MPA), sans build, sans framework, sans backend :

- 21 fichiers HTML à la racine, chacun est une page autonome ;
- 36 fichiers JavaScript chargés par balises `<script>` classiques (IIFE ou classes globales) ;
- 25 feuilles CSS, dont un point d'entrée `styles/main.css` ;
- données statiques JSON + images ;
- persistance navigateur uniquement.

Il n'y a **ni `package.json`, ni bundler, ni modules ES**, ni transpilation. Les fichiers s'exposent via des variables globales (`const Game`, `class Pokemon`, `window.HistoryCurve`, etc.). L'ordre des balises `<script>` est donc une dépendance implicite et **doit être conservé**.

---

## 2. Arborescence

```text
/
├── *.html                          # 21 pages (URLs inchangées)
├── js/
│   ├── core/                       # entités et modèles partagés
│   │   ├── pokemon.js
│   │   ├── pokemon-versions.js
│   │   ├── challenge.js
│   │   ├── reward.js
│   │   ├── reward-item.js
│   │   └── reward-button.js
│   ├── data/                       # persistance, migration, sauvegarde
│   │   ├── migration.js
│   │   ├── data-manager.js
│   │   ├── dex.js
│   │   ├── challenge-storage.js
│   │   ├── daily-to-dex-import.js
│   │   └── config.js
│   ├── features/
│   │   ├── daily/daily.js
│   │   ├── weekly/weekly.js
│   │   ├── marathon/{game,ui}.js
│   │   ├── challenges/{challenge-manager,challenge-game-ui,challenge-list-ui}.js
│   │   ├── custom-challenges/{codec,game,create-ui,play-ui}.js
│   │   ├── dex/dex-ui.js
│   │   ├── history/{history,history-curve,old-daily}.js
│   │   ├── stats/stats.js
│   │   ├── settings/{cosmetics,profile}.js
│   │   └── credits/credits.js
│   ├── i18n/
│   │   ├── translate.js
│   │   ├── setup.js
│   │   └── language-switcher.js
│   └── ui/
│       ├── loader.js
│       └── footer.js
├── styles/
│   ├── main.css                    # point d'entrée : imports ordonnés
│   ├── base.css … toggle.css       # 19 feuilles issues de l'ancien style.css
│   ├── cosmetics.css
│   ├── challenges.css              # ex-challenge.css
│   ├── custom-challenges.css
│   ├── language-switcher.css
│   └── text-shadow.css
├── data/                           # JSON inchangés
├── settings/config.json            # réglages applicatifs
├── scripts/                        # lint et serveur local sans cache
├── translations/                   # JSON inchangés
├── img/                            # images inchangées
└── .docs/                          # cette documentation
```

### Rôle des groupes

| Groupe | Rôle | Interdits |
|---|---|---|
| `js/core/` | Entités, valeur des objets métier | DOM, IndexedDB, `fetch` |
| `js/data/` | IndexedDB, cookies, migration, import/export | DOM de présentation |
| `js/features/<domaine>/` | Orchestration d'une fonctionnalité | Ouvrir une base avec un autre nom |
| `js/i18n/` | Traduction et sélecteur de langue | Logique de jeu |
| `js/ui/` | Composants transverses (loader, footer) | Logique métier |

> Les dépendances restent globales : `features → data → core`. Aucun import explicite n'existe encore ; l'ordre des scripts est le graphe de dépendances.

---

## 3. Découpage CSS

`styles/main.css` ne contient que des `@import`, dans **l'ordre exact** de l'ancien `style.css`. La concaténation des 19 feuilles est byte-identique (hors fins de ligne) à l'ancien fichier.

| Feuille | Contenu |
|---|---|
| `base.css` | variables, reset, layout, header, cartes, typographie |
| `game-image.css` | image du pied, skeleton, zoom |
| `forms.css` | champs, labels, focus |
| `buttons.css` | boutons principaux/secondaires, petits boutons |
| `hints.css` | indices, ticker, `daily-grid` |
| `notifications.css` | toasts et messages |
| `data-management.css` | onglets Paramètres |
| `history.css` | onglets historique |
| `game-controls.css` | autocomplétion, clavier mobile, jauge |
| `history-details.css` | lignes d'historique, tooltips |
| `round-gauge.css` | jauge de manche |
| `daily.css` | boutons Daily, retour, état vide |
| `dex.css` | grille et cartes du Pokédex |
| `home.css` | accueil et cartes de mode |
| `past-challenges.css` | défis passés, `.back-button` |
| `loader.css` | overlay et spinner |
| `responsive.css` | media queries historiques |
| `type-badges.css` | badges de type |
| `toggle.css` | interrupteur |

Les feuilles de domaine restent séparées et sont chargées en plus de `main.css` par les pages concernées : `cosmetics.css` (toutes les pages), `challenges.css` (challenge/liste), `custom-challenges.css` (custom), `text-shadow.css` (toutes les pages).

---

## 4. Matrice page → scripts

Les scripts sont listés dans l'ordre de chargement réel. Cet ordre est **identique à celui d'avant la réorganisation**.

| Page | Scripts |
|---|---|
| `index.html` | `js/ui/loader`, `js/i18n/translate`, `js/i18n/language-switcher`, `js/ui/footer`, `js/i18n/setup`, `js/data/migration`, `js/data/challenge-storage`, `js/features/settings/cosmetics` + inline |
| `pokefeet.html` | `js/ui/loader`, `js/i18n/translate`, `js/i18n/language-switcher`, `js/ui/footer`, `js/i18n/setup`, `js/data/migration`, `js/core/pokemon`, `js/core/pokemon-versions`, `js/data/challenge-storage`, `js/features/settings/cosmetics`, `js/features/marathon/game`, `js/features/marathon/ui` |
| `daily.html` | `js/ui/loader`, `js/i18n/translate`, `js/i18n/language-switcher`, `js/ui/footer`, `js/i18n/setup`, `js/core/pokemon`, `js/data/migration`, `js/data/dex`, `js/core/pokemon-versions`, `js/data/challenge-storage`, `js/features/settings/cosmetics`, `js/features/daily/daily` |
| `weekly.html` | `js/ui/loader`, `js/i18n/translate`, `js/i18n/language-switcher`, `js/ui/footer`, `js/i18n/setup`, `js/core/pokemon`, `js/data/migration`, `js/data/dex`, `js/core/pokemon-versions`, `js/data/challenge-storage`, `js/features/settings/cosmetics`, `js/features/weekly/weekly` |
| `old_daily.html` | `js/ui/loader`, `js/i18n/translate`, `js/i18n/language-switcher`, `js/ui/footer`, `js/i18n/setup`, `js/data/migration`, `js/core/pokemon`, `js/data/challenge-storage`, `js/data/config`, `js/features/settings/cosmetics`, `js/features/history/old-daily` |
| `history.html` | `js/ui/loader`, `js/i18n/translate`, `js/i18n/language-switcher`, `js/ui/footer`, `js/i18n/setup`, `js/data/migration`, `js/data/challenge-storage`, `js/core/pokemon`, `js/core/pokemon-versions`, `js/data/config`, `js/features/settings/cosmetics`, `js/features/history/history`, `js/features/history/history-curve` |
| `stats.html` | `js/ui/loader`, `js/core/reward-button`, `js/core/reward-item`, `js/core/reward`, `js/i18n/translate`, `js/i18n/language-switcher`, `js/ui/footer`, `js/i18n/setup`, `js/data/migration`, `js/features/settings/profile`, `js/core/pokemon-versions`, `js/data/challenge-storage`, `js/features/settings/cosmetics`, `js/features/stats/stats` |
| `pied-dex.html` | `js/ui/loader`, `js/i18n/translate`, `js/i18n/language-switcher`, `js/ui/footer`, `js/i18n/setup`, `js/data/migration`, `js/data/challenge-storage`, `js/core/pokemon`, `js/core/pokemon-versions`, `js/features/settings/cosmetics`, `js/data/dex`, `js/features/dex/dex-ui`, `js/data/daily-to-dex-import` + inline init |
| `list_challenges.html` | `js/core/pokemon`, `js/core/pokemon-versions`, `js/data/dex`, `js/core/challenge`, `js/data/challenge-storage`, `js/features/challenges/challenge-manager`, `js/features/challenges/challenge-list-ui`, `js/ui/loader`, `js/features/settings/cosmetics`, `js/data/migration`, `js/i18n/setup`, `js/i18n/language-switcher`, `js/i18n/translate` |
| `challenge.html` | `js/core/pokemon`, `js/core/pokemon-versions`, `js/data/dex`, `js/core/challenge`, `js/data/challenge-storage`, `js/features/challenges/challenge-manager`, `js/features/challenges/challenge-game-ui`, `js/ui/loader`, `js/features/settings/cosmetics`, `js/data/migration`, `js/i18n/setup`, `js/i18n/language-switcher`, `js/i18n/translate` + inline |
| `custom.html` | `js/ui/loader`, `js/i18n/translate`, `js/i18n/language-switcher`, `js/ui/footer`, `js/i18n/setup`, `js/data/migration`, `js/data/challenge-storage`, `js/features/settings/cosmetics` |
| `custom_create.html` | `js/ui/loader`, `js/i18n/translate`, `js/i18n/language-switcher`, `js/ui/footer`, `js/i18n/setup`, `js/core/pokemon`, `js/data/migration`, `js/data/challenge-storage`, `js/features/settings/cosmetics`, `js/features/custom-challenges/codec`, `js/features/custom-challenges/create-ui` |
| `custom_play.html` | `js/ui/loader`, `js/i18n/translate`, `js/i18n/language-switcher`, `js/ui/footer`, `js/i18n/setup`, `js/core/pokemon`, `js/data/migration`, `js/data/challenge-storage`, `js/features/settings/cosmetics`, `js/features/custom-challenges/codec`, `js/features/custom-challenges/game`, `js/features/custom-challenges/play-ui` |
| `data_management.html` | `js/ui/loader`, `js/i18n/translate`, `js/i18n/language-switcher`, `js/ui/footer`, `js/i18n/setup`, `js/data/migration`, `js/data/challenge-storage`, `js/features/settings/cosmetics`, `js/core/pokemon`, `js/core/pokemon-versions`, `js/data/dex`, `js/data/daily-to-dex-import`, `js/data/data-manager` + inline |
| `data.html` | `js/ui/loader`, `js/i18n/translate`, `js/i18n/language-switcher`, `js/ui/footer`, `js/i18n/setup` + inline |
| `changelog.html` | `js/ui/loader`, `js/i18n/translate`, `js/i18n/language-switcher`, `js/ui/footer`, `js/i18n/setup`, `js/data/migration`, `js/core/pokemon`, `js/data/challenge-storage`, `js/features/settings/cosmetics` |
| `credits.html` | `js/ui/loader`, `js/i18n/translate`, `js/i18n/language-switcher`, `js/ui/footer`, `js/i18n/setup`, `js/data/migration`, `js/data/challenge-storage`, `js/features/settings/cosmetics`, `js/features/credits/credits` |
| `profile.html` | aucun (redirection meta vers `data_management.html`) |
| `prediction.html` | aucun script externe + inline |
| `integration-pokefeet.html` | aucun |
| `test-i18n.html` | `js/i18n/translate`, `js/i18n/language-switcher`, `js/i18n/setup` |

> `custom_create.html` et `custom_play.html` chargent `migration` et `challenge-storage` uniquement parce que `cosmetics` en dépend. Aucune donnée de challenge custom n'est persistée.

---

## 5. Graphe de dépendances réel

```text
js/core/pokemon.js (Pokemon, TypeIcons)
└── js/core/pokemon-versions.js (PokemonVersions)
    ├── js/features/marathon/game.js ──► js/features/marathon/ui.js
    ├── js/features/daily/daily.js ────► js/data/dex.js, js/data/migration.js
    ├── js/features/weekly/weekly.js ──► js/data/dex.js, js/data/migration.js
    ├── js/data/daily-to-dex-import.js ► js/data/dex.js, PokemonVersions
    ├── js/data/dex.js ────────────────► IndexedDB PokefeetDexDB
    ├── js/features/dex/dex-ui.js ─────► js/data/dex.js, js/data/daily-to-dex-import.js
    ├── js/features/history/old-daily.js ► PokefeetDB
    ├── js/features/history/history.js ─► PokefeetDB
    ├── js/features/history/history-curve.js ► PokefeetDB
    ├── js/features/stats/stats.js ────► PokefeetDB, PokefeetDexDB, Reward
    ├── js/data/data-manager.js ───────► PokefeetDB, Dex, DailyToDexImport, ChallengeStorage
    └── js/data/migration.js ──────────► 3 bases + cookies

js/core/challenge.js
└── js/features/challenges/challenge-manager.js ──► ChallengeStorage, Dex, PokefeetDB, JSON
    ├── js/features/challenges/challenge-list-ui.js
    └── js/features/challenges/challenge-game-ui.js

js/features/custom-challenges/codec.js (aucune dépendance)
js/features/custom-challenges/game.js ──► Pokemon
└── js/features/custom-challenges/play-ui.js

js/core/reward*.js ──► Translator (optionnel)
└── js/features/stats/stats.js

js/features/settings/cosmetics.js ──► ChallengeStorage, data/cosmetics.json
js/i18n/translate.js
└── js/i18n/setup.js ──► js/i18n/language-switcher.js
js/ui/loader.js ──► Cosmetics.load() (optionnel)
```

### Dépendances inverses / violations restantes

- `js/ui/loader.js` dépend de `Cosmetics`, qui dépend de `ChallengeStorage`, qui ouvre IndexedDB : charger le loader déclenche une ouverture de base sur **toutes** les pages.
- `js/core/challenge.js` appelle `ChallengeManager.getPlayerLevel()` et `Dex` : l'entité dépend de la couche métier.
- `js/features/challenges/challenge-manager.js` contient une copie du calcul d'XP de `js/features/stats/stats.js`.
- `js/features/dex/dex-ui.js` appelle `DailyToDexImport.forceUpdate()` : l'UI déclenche un import.
- `data_management.html` réimplémente en inline le profil et le rendu des cosmétiques.
- `js/features/settings/profile.js` reste chargé par `stats.html` mais n'est jamais initialisé.

---

## 6. Cycle de vie d'une page

1. **Parsing HTML** : scripts chargés dans l'ordre, sans `defer`/`module`.
2. **`js/ui/loader.js`** injecte `#page-loader`, puis masque l'overlay au `load` (ou après 2,5 s), en appelant `Cosmetics.load()`.
3. **`js/data/migration.js`** expose `Migration.ready`, résolue après migration des 3 bases. `daily`, `weekly`, `stats`, `old-daily` et `challenge.html` attendent cette promesse.
4. **`js/i18n/setup.js`** attend `DOMContentLoaded`, charge FR/EN, applique `[data-i18n]`, puis initialise le sélecteur.
5. **Chaque module de page** s'auto-initialise sur `DOMContentLoaded` ou est appelé par un script inline.

### Risques de course (inchangés)

- `Cosmetics.load()` peut ouvrir `PokefeetChallengeDB` avant `Migration.ready`.
- `data_management.html` initialise `DataManager` sans attendre `Migration.ready`.
- Plusieurs onglets peuvent provoquer `onblocked` lors d'une montée de version IndexedDB.

---

## 7. Compatibilité des données

La réorganisation **ne change aucun identifiant de stockage** :

| Élément | Valeur conservée |
|---|---|
| Base Daily/Weekly | `PokefeetDB` v4 — stores `daily_results`, `weekly_results` (clé `date`) |
| Base Dex | `PokefeetDexDB` v4 — store `dex_entries` (clé `index`) |
| Base Challenges | `PokefeetChallengeDB` v4 — store `challenge_completions` (clé `challengeId`) |
| Cookies | `pk_daily_result_v2`, `pk_best`, `pk_best_streak`, `pk_cosmetic_bg`, `pk_cosmetic_btn`, `pk_pseudo`, `pokefeet_language` |
| `localStorage` | `pk_practice_session` |
| `sessionStorage` | `challenge_manager_state` |
| Export | `POKEFEET_SAVE v2`, mêmes champs `daily`, `weekly`, `best`, `marathon`, `challenges` |

Les 35 fichiers JS sont **identiques octet pour octet** (hors fins de ligne) à leurs versions d'avant déplacement. Les URLs HTML et les paramètres (`?date=`, `?week=`, `?challengeid=`, `?statut=`, `?code=`) sont inchangés.

---

## 8. Dette restante

1. **Pas de modules ES** : l'ordre des `<script>` reste critique.
2. **Persistance dupliquée** : `indexedDB.open` apparaît encore dans 13 fichiers, `getCookie` dans 13, `mulberry32` dans 6.
3. **Règles dupliquées** : seed/shuffle, normalisation, scoring, XP, partage.
4. **Fichiers monolithiques** : `daily.js` (1 174 lignes), `weekly.js` (1 033), `data-manager.js` (934), `stats.js` (917).
5. **Code mort** : voir [16-code-mort-et-orphelins.md](./16-code-mort-et-orphelins.md).
6. **Aucun test automatisé** : voir [19-plan-de-tests-et-non-regression.md](./19-plan-de-tests-et-non-regression.md).

Voir [18-plan-de-restructuration.md](./18-plan-de-restructuration.md) pour les phases suivantes (fondations partagées, modules ES, unification Daily/Weekly).

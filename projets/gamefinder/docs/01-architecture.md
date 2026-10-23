# Architecture

## 1. Vue d'ensemble

Gamefinder 2.0 est une **Single Page Application** sans framework, sans bundler et
sans dépendances installées localement. Le navigateur charge des scripts classiques
(ordre déclaratif dans `app.html`), chacun exposant une classe sur `window`.

```text
┌──────────────────────────────────────────────────────────────────────┐
│                          Navigateur (client)                         │
│                                                                      │
│  app.html                                                            │
│    ├─ styles/*.css                présentation                       │
│    ├─ Scripts/classes/*.js        modèles + infrastructure           │
│    ├─ Scripts/business/*.js       requêtes / règles                  │
│    ├─ Scripts/ui/*.js             rendu / événements                 │
│    └─ bootstrap inline            chargement DB puis démarrage       │
│                                                                      │
│  Database (sql.js WASM) ── 396 Mo de SQLite chargés en mémoire       │
│  Router (history.pushState) ── route → renderRoute() → UI            │
│  IndexedDB ── cache base, réglages, profil / XP / listes             │
└──────────────────────────────────────────────────────────────────────┘
        ▲ fetch 86 Mo (Brotli)               ▲ CDN
        │ database.db.br                     │ sql.js 1.10.3, brotli 1.3.3,
        │                                    │ Google Fonts, images IGDB
```

### Couches

| Couche | Dossier | Rôle | Dépend de |
|--------|---------|------|-----------|
| Présentation | `styles/` | DA, layout, états visuels | — |
| Infrastructure | `Scripts/classes/` | DB, routage, stockage local, méta SEO | Navigateur |
| Métier | `Scripts/business/` | SQL, agrégation, règles de filtres | Database |
| Interface | `Scripts/ui/` | HTML, événements, navigation | Business + Router |
| Amorçage | `app.html` (script inline) | orchestration | Tout |

Aucun module ES, aucun import : l'ordre des `<script>` est le graphe de dépendances.
Les classes sont accessibles globalement (`window.FiltersBusiness`,
`window.FiltersUI`, etc.), ce qui permet aussi de les instancier depuis la console.

## 2. Cycle de démarrage

`app.html` exécute `AppBootstrap()` (IIFE asynchrone) :

1. **Loader** — `new LoaderUI()` capture les éléments de l'overlay et de la barre.
2. **Base de données** — `new Database('database.db.br', onProgress).load()` :
   - lecture du cache IndexedDB (`gamefinder-cache` / `db-files`) ;
   - sinon `fetch('database.db.br')` puis mise en cache ;
   - décompression Brotli (native `DecompressionStream('br')`, sinon modules
     `brotli@1.3.3` chargés depuis jsDelivr avec un shim `require`) ;
   - chargement de `sql.js` 1.10.3 depuis cdnjs, ouverture de la base ;
   - création des index en mémoire puis `ANALYZE` ;
   - log des volumes par table.
   En cas d'échec, l'overlay affiche l'erreur et le bootstrap s'arrête.
3. **Services** — `AppSettings.init()`, `UserProfile.init()`, chargement de
   `data/fangameandmodes.json` et `data/pinnedplatforms.json`.
4. **Business** — `GameBusiness`, `DeveloperBusiness`, `FranchiseBusiness`,
   `SearchBusiness`, `ListBusiness`, `FiltersBusiness`.
5. **UI** — `MetaManager`, `Router`, puis tous les composants (header, footer,
   recherche, pages). `Router.start()` déclenche le premier rendu.
6. **Affichage** — l'overlay disparaît, `#app-root` passe en `display:flex` avec un
   fondu, header et footer sont injectés.

Progression affichée : 5 % → 30 % → 40 % → 65 % → 85 % → 90 % → 100 %.

### Mesures de référence

Sur la machine de test (Chromium, fichier servi en local) :

| Étape | Durée indicative |
|-------|------------------|
| Décompression / cache | quelques secondes |
| Création des 15 index + `ANALYZE` | ≈ 3,3–3,5 s |
| `runQuery` (10 000–13 000 résultats) | ≈ 0,45–0,65 s |

Ces valeurs dépendent du CPU, du cache disque et de la mémoire disponible. La base
décompressée fait **415 711 232 octets** (≈ 396 Mo).

## 3. Routage

`Router` lit `window.location.search` et applique une **priorité fixe** :

| Priorité | Paramètre | Route | Vue |
|----------|-----------|-------|-----|
| 1 | `?game=<id>` | `game` | `GameDetailUI` |
| 2 | `?developer=<id>` | `developer` | `DeveloperDetailUI` |
| 3 | `?franchise=<id>` | `franchise` | `FranchiseDetailUI` |
| 4 | `?genre=<id>` | `genre` | `GenericDetailUI` |
| 5 | `?platform=<id>` | `platform` | `PlatformDetailUI` |
| 6 | `?theme=<id>` | `theme` | `GenericDetailUI` |
| 7 | `?list=<type>&page=<n>` | `list` | `ListUI` |
| 8 | `?roulette=<b64>&ids=…&idx=…` | `roulette` | `RouletteUI` |
| 9 | `?state=filters[&s=<b64>]` | `filters` | `FiltersUI` |
| 10 | `?state=settings` | `settings` | `SettingsUI` |
| 11 | `?state=profile` | `profile` | `ProfileUI` |
| — | aucun / inconnu | `home` | `HomeUI` |

`Router.navigate(url)` fait `history.pushState` puis re-rend ; le bouton retour du
navigateur déclenche `popstate` et donc le même rendu. **Aucun rechargement** :
c'est ce qui permet de conserver la base en mémoire.

Les identifiants et numéros de page sont assainis (`Number.isFinite`, arrondi,
`Math.max(0, …)`), pour éviter les `NaN` injectés par l'URL (offsets négatifs,
`idx=NaN`, etc.).

Chaque route met aussi à jour les meta tags via `MetaManager` (title, description,
Open Graph, Twitter, canonical, hreflang).

## 4. Flux d'une sélection

```text
Home ──► FiltersUI (état tri-état)
             │ clic « Lancer la roulette »
             ▼
      FiltersBusiness.runQuery(state, { allowAdultContent })
             │  SQL paramétré (INTERSECT)
             ▼
      number[] (≤ 50, mélangés) + lastResultCount
             │  encodeSettings(state) → base64url
             ▼
Router.navigate('app.html?roulette=<b64>&ids=…&idx=0')
             │
             ▼
RouletteUI → GameBusiness.getById(id) → rendu fiche + navigation
```

Le bouton « Retour aux filtres » réinjecte les réglages dans l'URL
(`state=filters&s=<b64>`), ce qui restaure exactement l'état précédent.

## 5. État et persistance

| Donnée | Stockage | Clé / format |
|--------|----------|--------------|
| Base compressée | IndexedDB `gamefinder-cache` / `db-files` | `{ data: ArrayBuffer, cachedAt }` |
| Préférences | IndexedDB `gamefinder-settings` / `settings` | `{ key, value }` (`allowAdultContent`) |
| Profil | IndexedDB `gamefinder-profile` / `profile` | `{ key, value }` : pseudo, XP, listes, filtres |
| État des filtres | URL uniquement | base64url JSON v2 |
| Session roulette | URL | ids + index courant |

Tout est local au navigateur : vider les données du site réinitialise profil,
filtres sauvegardés et cache de la base. `Ctrl+F5` (raccourci intercepté) vide
uniquement le cache de la base puis recharge.

## 6. Conventions de code

- Une classe par fichier, exposée sur `window` en fin de fichier.
- Les `business` ne touchent jamais au DOM ; les `ui` ne construisent pas de SQL.
- Échappement HTML systématique (`_esc`) avant interpolation de données IGDB.
- Journalisation console abondante et préfixée (`[FiltersBusiness]`, `[Router]`…).
- Mélange aléatoire en JavaScript (Fisher-Yates) plutôt que `ORDER BY RANDOM()`.
- Les animations `.reveal` sont pilotées par `IntersectionObserver`.

## 7. Ce que l'application n'a pas

- Pas de back-end, d'authentification ni de synchronisation multi-appareils.
- Pas de service worker : le cache de la base est IndexedDB, pas un cache HTTP géré.
- Pas de tests automatisés, de lint, ni de build.
- Pas de rendu serveur : le SEO repose sur les meta tags mis à jour en JS.

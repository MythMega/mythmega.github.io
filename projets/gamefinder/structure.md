# Structure — Gamefinder 2.0

> La documentation de référence est dans [`docs/`](docs/README.md). Les fichiers
> ci-dessous décrivent l'organisation actuelle du code.

```text
index.html                  → Redirige vers app.html
app.html                    → Application principale (SPA, conserve la DB en mémoire)
database.db.br              → Base SQLite compressée (Brotli, 86 Mo → 396 Mo)
keywords.json               → Dictionnaire de mots-clés IGDB (référence)
start_server.cmd            → Serveur local Python sur le port 5600 (Windows)
data/
  fangameandmodes.json      → Mots-clés exclus quand « fangame/mod » est désactivé
  pinnedplatforms.json      → Plateformes épinglées (inclues par défaut)

styles/
  variables.css             → Tokens : palette vert & argent, fonts, rayons, z-index
  base.css                  → Reset, fond, typographie, scrollbar, sélection
  components.css            → Boutons, recherche, tags, loader, pagination, lightbox…
  layout.css                → Header, footer, accueil, grilles, détail jeu, animations
  filters.css               → Filtres tri-état, sliders, popups, vue roulette

Scripts/classes/
  Database.js               → Chargement Brotli + sql.js WASM, cache, index, query()
  Game.js                   → Modèle jeu (avec relations)
  Developer.js              → Modèle développeur
  Franchise.js              → Modèle franchise
  Genre.js / Platform.js / Theme.js → Modèles simples
  Router.js                 → Routage URL sans rechargement (pushState)
  Settings.js               → Préférences (IndexedDB)
  UserProfile.js            → Profil, XP, listes, filtres sauvegardés (IndexedDB)
  MetaManager.js            → Meta tags SEO/Open Graph dynamiques

Scripts/business/
  SearchBusiness.js         → Recherche multi-type, 3 résultats/type, annulable
  GameBusiness.js           → getById enrichi, getList paginée, getSummaries(ids)
  DeveloperBusiness.js      → getById (jointure, 60 jeux) + getList
  FranchiseBusiness.js      → getById + getList
  ListBusiness.js           → Dispatcher générique (8 types de listes)
  FiltersBusiness.js        → Filtres tri-état, requêtes paramétrées, URL

Scripts/ui/
  LoaderUI.js               → Overlay de chargement + progression
  HeaderUI.js               → En-tête persistant (Accueil, Roulette, Données…)
  FooterUI.js               → Pied de page avec les liens externes
  SearchUI.js               → Barre de recherche + dropdown
  HomeUI.js                 → Accueil (CTA Roulette + recherche)
  GameDetailUI.js           → Fiche jeu complète
  DeveloperDetailUI.js      → Fiche développeur (60 jeux max)
  PlatformDetailUI.js       → Fiche plateforme (60 jeux max)
  FranchiseDetailUI.js      → Fiche franchise
  GenericDetailUI.js        → Fiche genre / thème (60 jeux max)
  ListUI.js                 → Grille paginée générique + recherche locale
  FiltersUI.js              → Page Roulette : filtres tri-état
  RouletteUI.js             → Vue résultat : un jeu à la fois
  SettingsUI.js             → Paramètres (pseudo, adulte, cache)
  ProfileUI.js              → Profil, XP, listes « à faire » / « masqués »

docs/                       → Documentation détaillée (architecture, DB, filtres, DA, audit)
list.md                     → Documentation historique des listes
unique_info.md              → Documentation historique des pages de détail
schema.md                   → Schéma SQLite de référence
```

## Points d'entrée

- Application : `app.html`
- Base : `database.db.br` (chargée par `Scripts/classes/Database.js`)
- Bootstrap : script inline en fin d'`app.html`
- Documentation : [`docs/README.md`](docs/README.md)

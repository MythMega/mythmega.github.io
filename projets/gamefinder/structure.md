index.html                  → Redirige vers app.html
app.html                    → Application principale (SPA, conserve la DB en mémoire)

styles/
  variables.css             → Palette néon, fonts, z-index, transitions
  base.css                  → Reset, fond grille sci-fi, scrollbar, typographie
  components.css            → Boutons néon, barre de recherche, cards, tags, loader, pagination
  layout.css                → Header, footer, home hero, grille liste, détail jeu, animations

Scripts/classes/
  Database.js               → Chargement brotli + sql.js WASM, query / queryOne
  Game.js                   → Modèle jeu (avec toutes ses relations)
  Developer.js              → Modèle développeur
  Franchise.js              → Modèle franchise
  Genre.js / Platform.js / Theme.js → Modèles simples
  Router.js                 → Routage URL sans rechargement (pushState)

Scripts/business/
  SearchBusiness.js         → Recherche multi-type contains, 3 résultats/type, annulable
  GameBusiness.js           → getById (enrichi) + getList paginée
  DeveloperBusiness.js      → getById + getList
  FranchiseBusiness.js      → getById + getList
  ListBusiness.js           → Dispatcher générique, availableTypes()

Scripts/ui/
  LoaderUI.js               → Overlay de chargement + barre de progression
  HeaderUI.js               → En-tête persistant (Accueil, Roulette, dropdown Données)
  FooterUI.js               → Pied de page avec les 4 liens externes
  SearchUI.js               → Barre de recherche avec debounce + dropdown résultats
  HomeUI.js                 → Page accueil (CTA Roulette + recherche)
  GameDetailUI.js           → Page détail jeu complète avec toutes les infos
  DeveloperDetailUI.js      → Page détail développeur + grille de jeux
  FranchiseDetailUI.js      → Page détail franchise
  GenericDetailUI.js        → Page générique (genre, platform, thème)
  ListUI.js                 → Grille paginée générique
  FiltersUI.js              → Placeholder page Roulette

list.md                     → Documentation du système de listes
unique_info.md              → Documentation des pages de détail par type
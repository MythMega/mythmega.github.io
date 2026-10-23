# Changelog — itération « filtres tri-état & DA vert/argent »

## Filtres tri-état

- Nouveau modèle `{ inc: number[], exc: number[] }` par facette. Trois états par
  valeur : **inclure / exclure / ignorer (N/A)**.
- `FiltersUI` : pastilles cyclables au clic, légende, compteurs par facette, presets
  `✓ / ✗ / N/A`, compteur global, bouton « Réinitialiser ».
- `FiltersBusiness` réécrit :
  - six facettes : plateformes, genres, thèmes, modes, **perspectives** (nouvelle),
    types de jeux ;
  - normalisation et validation complètes des réglages ;
  - migration automatique des anciens réglages (URL et filtres sauvegardés) ;
  - **requêtes 100 % paramétrées** ;
  - type de jeu intégré à la requête de base (fin du filtre implicite « jeu
    principal uniquement » codé en dur) ;
  - exclusion forcée d'Erotic si le contenu adulte est désactivé ;
  - `lastResultCount` et `lastQuery` exposés pour l'UI et le diagnostic.
- Encodage d'URL compact : les facettes par défaut sont omises, une facette vide est
  conservée (`{}`), le padding base64 est reconstruit au décodage.
- Popup de chargement : affiche le résumé de chaque filtre sauvegardé.
- Statistiques de lancement : nombre total de jeux correspondants avant la limite de
  50.

## Direction artistique vert & argent

- `styles/variables.css` entièrement réécrit : tokens sémantiques
  `--accent`, `--mint`, `--jade`, `--silver`, `--pearl`, fonds vert-noir, lueurs,
  dégradés métalliques.
- Tous les composants recoloriés (boutons, tags, loader, sliders, switches, popups,
  lightbox, XP, profil, pagination).
- Anciennes variantes `.magenta` / `.purple` renommées `.silver` / `.jade` dans le CSS
  et le JS ; variables `--neon-*` supprimées.
- Fonds : halos radiaux + grille émeraude/argent masquée.
- Titres en dégradé métallique (`background-clip: text`).
- Nouveaux styles tri-état (inclusion verte, exclusion rouge sombre barrée, N/A discret).
- Cycle des filtres N/A → voulu → banni, avec raccourcis Ctrl/Shift (clic = voulu,
  clic droit = banni).
- Barre d'outils de filtres, légende, compteurs et presets stylés.
- Contraste du texte atténué porté à ≈ 6:1.
- Focus clavier visible, `prefers-reduced-motion` pris en charge.
- Polices déplacées de `@import` vers `<link rel=stylesheet>` + `preconnect`.

## Correctifs techniques

- `Router` : validation des IDs, des pages (`?page=`) et de l'index de roulette
  (`?idx=`), suppression des `NaN` et des offsets négatifs.
- `Database` : six index ajoutés (score, perspective, mots-clés, type, développeur,
  franchise) ; la requête de filtre utilise l'index des mots-clés (colonnes déjà en
  minuscules).
- `DeveloperBusiness` : une jointure unique au lieu d'une requête par jeu, résultat
  borné à 60, `totalGames` fourni.
- `GameBusiness.getSummaries(ids)` : chargement groupé pour le profil (fin du N+1).
- `PlatformDetailUI` : compte total + 60 jeux (évite 202 316 cartes sur PC).
- `DeveloperDetailUI` / `PlatformDetailUI` : mention « 60 plus récents sur N ».
- `GenericDetailUI` : les pages genre et thème listent réellement leurs jeux.
- `ListBusiness` / `ListUI` : prise en charge de `list=mode` et `list=perspective` ;
  pas de navigation vers une page de détail inexistante.
- `ProfileUI` : cache des jeux pour la recherche, une requête par liste.
- Iframes YouTube en `loading="lazy"`.
- Libellé « Type #10 » remplacé par « Jeu étendu ».
- Correction de `_syncAllFacetHeaders` (exception au premier rendu des filtres).

## Documentation

- `docs/README.md` : index, démarrage, carte du dépôt.
- `docs/01-architecture.md` : couches, bootstrap, routage, flux, stockage.
- `docs/02-database.md` : schéma réel, volumes, particularités, index, requêtes.
- `docs/03-filters-roulette.md` : tri-état, format, migration, SQL, URL, roulette.
- `docs/04-ui-pages.md` : toutes les pages et composants.
- `docs/05-profile-progression.md` : IndexedDB, XP, niveaux, listes.
- `docs/06-design-system.md` : palette, composants, responsive, accessibilité.
- `docs/07-audit-securite-performance.md` : audit, correctifs, risques, mesures.
- `docs/08-changelog.md` : ce document.

## Vérifications

- `node --check` sur tous les scripts.
- Harnais de requêtes exécuté sur la base réelle : inclusions, exclusions, types,
  fangames, tous genres exclus, migration v1, round-trip d'URL, entrées invalides.
- Parcours navigateur : accueil, filtres (cycle, presets, save/load), roulette,
  retour aux filtres, listes, genre, plateforme, développeur, profil, paramètres.
- Aucune exception console après correction.

## Points ouverts

- SRI / hébergement local des CDN (sql.js, brotli) et CSP stricte.
- Tests automatisés du moteur de filtres.
- Réduction du poids de la base et du temps de démarrage.
- SEO (rendu client uniquement).

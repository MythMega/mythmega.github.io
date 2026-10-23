# Pages & interface

## 1. Coquille applicative

`app.html` contient :

```html
<div id="loader-overlay">…</div>   <!-- overlay plein écran -->
<div id="loader-bar-wrapper">…</div> <!-- barre fine en haut -->
<div id="app-root">
  <header id="app-header"></header>
  <main id="app-main"></main>
  <footer id="app-footer"></footer>
</div>
```

- Le header et le footer sont rendus **une seule fois** ; `renderRoute` ne remplace
  que le contenu de `#app-main`.
- `window.scrollTo({ top: 0, behavior: 'smooth' })` à chaque navigation.
- Le loader affiche le pourcentage et le statut ; il disparaît en fondu (`hidden`).

### Header (`HeaderUI`)

| Élément | Action |
|---------|--------|
| Logo `GF 2.0` | accueil |
| Icône Accueil (maison) | `app.html` |
| Icône Roulette (dé) | `?state=filters` |
| Icône Données (base) | menu : Jeux, Développeurs, Franchises, Genres, Plateformes, Thèmes → `?list=<type>&page=1` |
| Icône Paramètres (engrenage) | `?state=settings` |
| Icône Profil (silhouette) | `?state=profile` |

Les boutons sont des **icônes seules** (SVG inline, `currentColor`) de 40 × 40 px
(34 × 34 px sous 480 px). Le libellé reste accessible via `aria-label` et `title`.
L'icône de la page courante reçoit la classe `.active`. Le dropdown Données s'ouvre
au survol ou au clic, et un pont invisible de 10 px couvre l'espace entre le bouton
et le menu pour que le survol ne referme pas ce dernier.

### Footer

Quatre liens externes : `jmdev.fr`, GitHub, Issues, Wiki. `target="_blank"` +
`rel="noopener"`.

## 2. Accueil (`HomeUI`)

- Grand titre « GAMEFINDER » en dégradé vert/argent.
- Sous-titre `// Trouver votre prochain coup de cœur`.
- CTA « Lancer la roulette » → `?state=filters`.
- Barre de recherche réutilisable (`SearchUI`).

## 3. Recherche globale (`SearchUI` + `SearchBusiness`)

- Déclenchement à partir de **3 caractères**, debounce **300 ms**.
- Recherche en parallèle logique dans : jeux, genres, plateformes, modes, thèmes,
  développeurs, franchises — **maximum 3 résultats par type**.
- Chaque nouvelle frappe annule la recherche précédente (compteur interne).
- Résultats groupés par type, avec `[id]` quand disponible.
- Clic :
  - jeu / développeur / franchise → page de détail ;
  - genre / plateforme / thème / mode → liste correspondante
    (`?list=genre&page=1`, etc.).
- Fermeture au clic hors de la zone, réouverture au focus si des résultats existent.
- `LIKE '%terme%'` : recherche par sous-chaîne, insensible à la casse ASCII.

> Limite connue : un résultat « genre » n'est pas cliquable vers *ce* genre mais vers
> la liste des genres. Les pages de détail existent pourtant ; c'est un axe
> d'amélioration (résoudre l'ID du dictionnaire).

## 4. Listes (`ListUI` + `ListBusiness`)

URL : `app.html?list=<type>&page=<n>`.

| `list` | Label | Source | Détail au clic |
|--------|-------|--------|----------------|
| `game` | Jeux | `games` | oui |
| `developer` | Développeurs | `game_developers` (group by company) | oui |
| `franchise` | Franchises | `franchises` + cover du jeu le plus récent | oui |
| `genre` | Genres | `genres` | oui |
| `platform` | Plateformes | `platforms` | oui |
| `theme` | Thèmes | `themes` | oui |
| `mode` | Modes de jeu | `game_modes` | non (pas de page) |
| `perspective` | Perspectives | `player_perspectives` | non (pas de page) |

- **30 éléments par page** ; requête `LIMIT 31 OFFSET n` pour connaître `hasNext`.
- Tri alphabétique, sauf jeux (`id ASC`).
- Recherche locale dans la liste : 2 caractères, debounce 250 ms ; affiche les 10
  premiers résultats puis « Voir tout les résultats ». Les résultats viennent de la
  base entière, pas seulement de la page courante.
- Cartes : jaquette 3/4 pour jeux/franchises, logo carré pour plateformes et
  développeurs, ID, nom.
- Pagination précédent/suivant désactivée aux bornes.

## 5. Détail d'un jeu (`GameDetailUI`)

`app.html?game=<id>`.

| Section | Source |
|---------|--------|
| Jaquette, titre, ID IGDB, année, note /100 + barre | `games` |
| Lien IGDB | `games.url` |
| Boutons « À faire » / « Masquer » | profil local |
| Genres, plateformes | relations |
| Résumé, histoire | `games.summary`, `games.storyline` |
| Modes, perspectives, thèmes, mots-clés | relations |
| Développeurs cliquables | `game_developers` |
| Vidéos | `game_videos.youtube_id` (iframe `loading="lazy"`) |
| Captures | `game_screenshots.url`, lightbox navigable |

- La fiche est enrichie par `GameBusiness.getById()` : 10 requêtes indexées.
- Lightbox : clic sur une miniature, flèches ←/→, fermeture par Échap ou clic sur le
  fond.
- XP : +3 à la première fiche de la session, +3 au clic IGDB, +1 au premier ajout
  quotidien dans une liste.
- Un ID absent affiche « Jeu introuvable » (pas d'exception).

## 6. Détail d'un développeur (`DeveloperDetailUI`)

`app.html?developer=<company_id>`.

- Nom, ID, logo, lien IGDB, nombre total de jeux.
- Requête jointe unique (`game_developers` ⋈ `games`), **limitée à 60 jeux** triés par
  date de sortie décroissante ; le titre indique « 60 plus récents sur N ».
- Cartes cliquables vers la fiche jeu.

## 7. Détail d'une franchise (`FranchiseDetailUI`)

`app.html?franchise=<id>`.

- Nom, ID, nombre de jeux.
- Jeux via `game_franchises.franchise = franchises.name`, triés par date de sortie
  décroissante. Volume naturellement faible (1 348 relations pour 319 franchises).

## 8. Détail d'une plateforme (`PlatformDetailUI`)

`app.html?platform=<id>`.

- Logo, nom, ID, lien IGDB, **nombre total de jeux** (`COUNT`).
- Jeux via `game_platforms.platform = platforms.name`, triés par date de sortie,
  **limités à 60**. PC compte 202 316 jeux : sans borne, le DOM serait impossible.
- Cartes cliquables.

## 9. Détail d'un genre ou d'un thème (`GenericDetailUI`)

`app.html?genre=<id>` / `?theme=<id>`.

- Nom, ID, nombre de jeux.
- Jeux via `game_genres.genre` / `game_themes.theme`, triés par date de sortie,
  limités à 60, cartes cliquables.
- Affiche « introuvable » si l'ID n'existe pas.
- (Auparavant, ces pages affichaient un simple message « bientôt disponible ».)

## 10. Paramètres (`SettingsUI`)

`app.html?state=settings`.

- **Pseudo** (max 32 caractères) sauvegardé dans le profil.
- **Contenu adulte** : interrupteur avec popup de confirmation à l'activation.
  Désactivé par défaut. Contrôle le verrouillage du thème Erotic dans les filtres et
  l'exclusion forcée dans les requêtes.
- **Base de données** : taille du cache, date/heure, bouton « Vider le cache »,
  bouton « Retélécharger la base » (vide le cache puis recharge la page).
  Raccourci `Ctrl + F5` équivalent.

## 11. Profil (`ProfileUI`)

`app.html?state=profile` — voir [05-profile-progression.md](05-profile-progression.md).

- Carte identité (avatar, pseudo, badge de niveau).
- XP total, progression vers le niveau suivant.
- Boutons « À faire » et « Masqués » avec compteurs ; listes inline paginées par 10,
  recherche locale, bouton « Détail » et « Retirer ».
- Les jeux des listes sont chargés **en une seule requête** (`getSummaries`) et non
  un par un.

## 12. États d'erreur

| Cas | Rendu |
|-----|-------|
| ID jeu/développeur/franchise/plateforme/genre/thème inconnu | titre « … introuvable » + ID |
| Route inconnue | page 404 avec sous-titre |
| Liste vide | message dans la grille |
| Roulette sans jeu | « Liste vide » + retour aux filtres |
| Filtres sans résultat | popup « Aucun résultat » + réinitialiser |
| Base non chargée | overlay bloqué avec message d'erreur explicite |

## 13. Meta & SEO

`MetaManager` met à jour à chaque route :

- `<title>`, `meta description` ;
- Open Graph (`og:title`, `og:description`, `og:image`, `og:url`, `og:type`,
  `og:locale`, `og:site_name`) ;
- Twitter Card ;
- `link rel=canonical` et `hreflang` (fr, en, x-default).

Les URLs canoniques pointent en dur vers `https://mythmega.github.io/app.html`.
Comme le rendu est client, les crawlers qui n'exécutent pas JavaScript ne voient que
les meta statiques d'`app.html` : le SEO est donc limité.

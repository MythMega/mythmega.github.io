# 3. Interface et visuels

## 3.1 Système de conception

Tout le style repose sur des **variables CSS** déclarées dans `css/base.css` (tokens neutres) et
`css/themes.css` (palettes). Aucune feuille ne contient de couleur codée en dur : changer de thème
change toutes les surfaces, textes, bordures, halos, ombres et filtres d'icônes d'un coup.

### Jetons de base (`css/base.css`, `:root`)

| Jeton | Valeur | Usage |
|---|---|---|
| `--space-1` … `--space-6` | 0.25 / 0.5 / 0.75 / 1 / 1.5 / 2 rem | échelle d'espacement mobile d'abord |
| `--radius-sm` | 6 px | petits contrôles, options de sélecteur |
| `--radius-md` | 12 px | panneaux, modales, conteneurs de choix |
| `--radius-lg` | 20 px | grandes surfaces (scène 3D) |
| `--radius-pill` | 999 px | boutons, pastilles, contrôles d'une seule ligne |
| `--font-family-base` | pile système (system-ui, Segoe UI, Roboto, …) | texte courant |
| `--font-family-title` | « Press Start 2P », Courier New, monospace | titres de joueur uniquement |
| `--font-size-xs` … `--font-size-2xl` | 0.75 → 2 rem (les deux plus grandes en `clamp`) | hiérarchie typographique |
| `--touch-target` | 44 px | hauteur minimale des contrôles tactiles |
| `--card-ratio` | `720 / 1000` | ratio unique des cartes |
| `--app-max-width` | 1100 px | largeur maximale de la colonne applicative |
| `--header-height` / `--nav-height` | 3.5 rem / 4 rem | en-tête et barre du bas |
| `--duration-fast/base` | durées courtes | transitions |

### Typographie

- **Texte courant** : pile système, `--line-height-base: 1.5`.
- **Titre de joueur** : `Press Start 2P`, deux sous-ensembles latins auto-hébergés
  (`assets/fonts/press-start-2p-latin*.woff2`, SIL OFL), préchargés par `sw.js` et précachés pour
  rester lisibles hors-ligne. `font-display: block` volontaire (pas de `swap` : une police pixel qui
  arrive en cours de peinture déplacerait les lignes). Repli monospace si les fichiers manquent.
- Les titres de section utilisent la pile système en gras, pas la police pixel : la police pixel
  reste **la récompense d'un titre**, pas une décoration générale.

## 3.2 Thèmes

Cinq thèmes sont déclarés dans `settings/config.json` (`themes`) et appliqués par `ThemeManager` en
posant `data-theme` sur `<html>` **et** `<body>` (les deux sélecteurs doivent rester synchrones).

| Thème | id | Ambiance | `--color-bg` | Particularités |
|---|---|---|---|---|
| Sombre | `dark` | défaut, sombre bleu nuit | `#0b0e14` | icônes inversées (`--icon-filter: invert(1)`), icônes d'en-tête en blanc (`--icon-variant: dark`) |
| Clair | `light` | lumineux neutre | `#eef1f8` | icônes telles quelles |
| Classic | `classic` | parchemin / terre cuite | `#efe3c8` | palette chaude, accent brun |
| Ciel | `day` | ciel Minecraft | `#7fc0ea` | dégradé de ciel + nuages |
| Nuit | `night` | nuit étoilée | `#050b1c` | dégradé bleu foncé → noir + étoiles, icônes d'en-tête en blanc |

- **Miroir du thème** : `localStorage["mc_theme"]` est écrit à côté de la préférence
  autoritaire (`user_state["settings"].theme`), pour que le script inline de `<head>` peigne la
  bonne palette **avant le premier rendu** (pas de flash).
- **`<meta name="theme-color">`** suit la palette (`THEME_COLORS` dans `index.html`), donc la barre
  du navigateur mobile reste cohérente.
- **Décor des thèmes de ciel** : une couche unique et fixe (`div[data-theme-scenery]`,
  `z-index: 0`, `pointer-events: none`) est remplie par `ThemeManager.renderScenery()`.
  - **Ciel** : 14 nuages (`CLOUD_COUNT`), rectangles blancs à coins arrondis (`border-radius: 8px`),
    opacité **0,6 à 0,8**, tailles variées (90–270 px de large, 28–66 px de haut), position
    aléatoire sur 82 % de la hauteur, dérive horizontale lente (70–150 s, délai négatif pour peupler
    le ciel immédiatement).
  - **Nuit** : 220 étoiles (`STAR_COUNT`), tailles 1–4 px, opacité 0,35–1, scintillement
    (2,5–6,5 s) et positions aléatoires.
  - Les trois autres thèmes **ne sont pas touchés** : la couche est vidée et aucune règle de palette
    ne change.
  - `prefers-reduced-motion: reduce` fige nuages et étoiles au lieu de les animer.
- **Sélecteur de thème** : les boutons sont générés depuis `config.json` par `SettingsView`. Comme
  cinq entrées passent à la ligne sur un téléphone, le conteneur `.settings__choices` porte un
  **petit rayon** (`--radius-md`, 12 px) et ses options un rayon `--radius-sm` (6 px) : le rayon de
  pilule (`999px`) d'une ligne unique dessinait des arcs qui coupaient à l'intérieur du cadre dès
  qu'une deuxième ligne existait.

## 3.3 Cartes

- **Format unique** : 720 × 1000 (ratio `--card-ratio`), quelle que soit la rareté ou l'impression.
  Toute boîte qui affiche une carte reprend ce ratio (vignette, face de révélation, détail agrandi,
  résumé, statistiques, Mine Pick, trophées, overlay).
- **Illustrations** : `cards/` (374 Mo), organisées par langue (`/fr/`, `/en/`) ; le chemin est
  résolu par la langue active.
- **Dos de carte** : `assets/img/card_back.png`, partagé jeu/overlay.
- **Halo de rareté (léger)** : liseré violet fin pour une **super rare** (3), or fin pour une
  **légendaire** (4), halo orange un peu plus large pour une **mythique** (5)
  (`css/components/card-shine.css`, classes `card-glow--super-rare/legendary/mythic`, posées par
  `applyCardGlow()` de `js/utils/Shine.js`). Une carte manquante (silhouette) n'en a pas. Le halo est
  volontairement discret et sans réglage, contrairement à celui des trophées.
- **Foil** : trois raretés portent un motif (`SHINE_MODIFIER_BY_RARITY`) — fine trame diagonale pour
  la super rare, voile sur grille embossée pour la légendaire, traitement complet (nid d'abeilles,
  reflets croisés, bascule 3D) pour la mythique. Les raretés 1 et 2 n'en ont aucun.
- **Deux réglages** (panneau « Foil ») : **Intensité du foil** (`--foil-intensity`, motifs) et
  **Brillance** (`--glare-intensity`, ligne qui balaie la carte via `.card-shine__gleam`). Bornes et
  défaut : 0–100 par pas de 5, défaut 100. Une valeur hors bornes est ramenée dans la plage. À 0 sur
  l'intensité, `data-foil="off"` arrête les animations et masque la ligne.
- **Cartes promo** : pastille « Promo », visibles seulement si possédées.
- **Statuts** : « Nouvelle » (première copie), « Possédée », quantité, favori (cœur).

## 3.4 Animations

Trois modes, déclarés dans `animations.list` de `config.json` et portés par `data-animation` sur
`<html>`/`<body>` :

| Mode | `tearMs` | `flipMs` | `staggerMs` | Style |
|---|---|---|---|---|
| `normal` | 700 | 220 | 60 | cinématographique de base : retournement avec léger dépassement, zoom au passage, arrivée de la carte de biais, rebond du résumé |
| `epic` (**défaut livré**) | 1200 | 640 | 150 | met en scène : rayons de lumière, poussières sur toute la vue (`css/animations/epic.css`, `::before` fixe en `z-index` négatif), traînée, onde de choc, halos renforcés, balayage du résumé |
| `explosive` (parodique) | 950 | 900 | 90 | le booster tremble et explose derrière un « BOUM ! », autocollants, tremblement de la scène, anneau BD, confettis, cartes qui tournent, vignettes tombant du plafond |

- `AnimationManager` publie `--anim-tear-ms`, `--anim-flip-ms`, `--anim-stagger-ms` ; **le JS lit
  aussi** ces durées (séquences de la Mine Pick, garde d'arrivée du projecteur, mouvement WebGL du
  tear), donc CSS, JS et 3D ne peuvent pas se désynchroniser.
- Un mode sans bloc CSS réutilise simplement l'animation de base à sa vitesse.
- `prefers-reduced-motion: reduce` (`css/animations/accessibility.css`, chargé en dernier) coupe les
  animations : c'est la feuille de plus forte priorité.
- L'aperçu des Paramètres rejoue les trois étapes avec le **vrai markup** des cartes.

## 3.5 Structure de l'écran

- **En-tête** (`banner`) : marque « MineCards », slogan (masqué sur petit écran), compteurs et
  horloge UTC. Sur écran large, chaque compteur affiche son nom court à côté de son icône ; le
  libellé long reste dans un `.sr-only` (nom accessible) et le libellé visible est `aria-hidden`.
  Les cinq compteurs tiennent sur une ligne (`flex: 1 1 0`, `nowrap`) ; `App.setCount` plafonne à
  `9999+`.
- **Compteurs** : boosters quotidiens, boosters bonus (bouton → inventaire des bonus réparti par
  extension), pioches Mine Pick, binders (bouton → liste), Sparks.
- **Barre de navigation du bas** (`nav.app-nav`) : Profil, Collection, Mine, Ouvrir (bouton
  principal surélevé), Pick, Info, Réglages. Une colonne par destination, sur une seule ligne.
  - **Largeur des colonnes** : égales au-dessus de 480 px (le rythme régulier de la barre) ; en
    dessous, chaque colonne prend la largeur de **son libellé** (`grid-auto-columns: max-content`
    + `justify-content: space-evenly`) — sept parts égales donnent 45 px par colonne à 360 px, soit
    moins que les 50 px de « Collection », et un libellé plus large que sa colonne déborde sur le
    voisin au lieu d'être coupé.
  - **Sous 340 px** (téléphone 320 px, écran externe d'un pliable) les sept libellés ne tiennent
    plus même au plus juste : ils sont masqués comme `.sr-only` (donc toujours prononcés par un
    lecteur d'écran) et la barre repasse en colonnes égales, icônes seules.
- **Vue** : titre, sous-titre, **pastille « Comment ça marche ? »** (`ViewHelp`) qui ouvre une
  mini-popup (titre, deux phrases, bouton « Plus d'infos »), puis le contenu.
- **Barre du bas sur écran vertical** : cinq compteurs sur une ligne, icône et nombre réduits.
- **Mode focus** (`body.is-focus`, `js/utils/FocusMode.js`) : pendant l'ouverture d'un booster et la
  pioche de la Mine Pick, la marque, les compteurs, la nav, l'aide de page et le titre de la vue
  disparaissent ; `--nav-height` passe à 0 pour que les toasts suivent.
- **Centrage des rituels** : la scène d'ouverture est centrée horizontalement et verticalement
  (`justify-content: safe center` : sur un écran plus court que la scène, le haut reste atteignable).
  La pioche de la Mine Pick garde son panneau en haut, dans l'ordre de lecture.

## 3.6 Composants transverses

- **Modales** (`css/components/modal.css`) : dialogue centré, voile `--overlay`, fermeture par la
  croix, le voile ou `Échap`. Certaines modales s'empilent (détail d'une offre au-dessus de la
  boutique, détail d'un trophée au-dessus de la liste).
- **Toasts** (`css/components/toast.css`) : empilés **en bas**, accusés de réception d'action.
- **Notifications** (`css/components/notifications.css`) : **en haut à droite** (en haut au centre
  en orientation portrait), une seule à la fois, sous l'en-tête mesuré ; durée réglable 1–8 s.
- **Bannière d'installation** (`css/components/install-prompt.css`) : encart posé **juste au-dessus
  de la barre du bas** (même calage que les toasts), icône du jeu, deux lignes de texte et deux
  boutons (« Plus tard » discret, « Installer » en primaire). Ce n'est pas une modale : elle ne
  prend pas le focus et ne bloque rien.
- **Icône d'aide** (`info-hint`, `js/UI/components/InfoHint.js`) : petite pastille « i » dans le
  titre d'un panneau ou le libellé d'un curseur, qui ouvre la phrase d'explication dans une bulle
  flottante (fermeture par `Échap` ou clic extérieur, recadrage dans la boîte qui la contient).
- **Sliders** : `foil-slider` (label + `output` + `input[type=range]`), piste colorée par
  `accent-color`, valeur en `tabular-nums`.
- **Switches** : `switch` partagé (piste + pouce), état « Activé »/« Désactivé ».
- **Boutons** : `.btn`, `.btn--primary`, `.btn--ghost`, `.btn--block`, `.btn--danger` ; état
  `:disabled` à 55 % d'opacité, focus visible avec anneau `--color-accent`.
- **Panneaux** : `.panel` (surface, bordure, rayon `--radius-md`), `.view__header--split` pour titre
  à gauche / action à droite.
- **Aide de page** : pastille unique ouverte à la fois, refermée par `Échap`, un clic extérieur ou
  un second clic ; retraduite à chaud.
- **Barre de défilement** (`ScrollHint`, `js/utils/ScrollHint.js`) : les barres natives sont masquées
  partout (`scrollbar-width: none` + `::-webkit-scrollbar`, `css/base.css`). Pendant qu'une boîte
  défile (la page, comme le corps d'une modale), un indicateur de 4 px est peint à l'intérieur de
  son bord droit (ou bas) puis s'efface après 700 ms d'immobilité. Couche `--z-scroll-hint`, donc
  au-dessus des modales ; `pointer-events: none`, il ne capte rien et ne se saisit pas : molette,
  doigt et `scroll-snap` des bandeaux restent inchangés.

## 3.7 Responsive

- **Mobile d'abord** ; points de rupture principaux : **480 px**, **560 px** (page Titre), **768 px**
  (tablette : grilles à 5 colonnes, hauteurs de scène 42/55 vh), **1024 px** (noms courts des
  compteurs, slogan masqué, colonne élargie).
- **Grilles** : collection 2–3 colonnes puis 5 ; sélecteur de binder 3 puis 5 ; résumé d'ouverture
  5 colonnes ; Mine Pick 3 + 2 centré puis 5.
- **En-tête vertical (< 768 px)** : marque + compteurs seulement ; slogan et horloge masqués (l'heure
  reste dans les Paramètres) ; « MineCards » centré une taille en dessous.
- **Overlay et binder partagé** ont leur propre feuille (`css/overlay.css`) et ne partagent aucune
  feuille avec l'application, sauf `css/components/modal.css` et `css/components/card-shine.css`
  pour la page de binder.
- **Safe areas** : `env(safe-area-inset-*)` est pris en compte dans l'en-tête, la barre du bas et le
  `padding-bottom` de `.app-main`.
- **Pas de zoom horizontal** : les cartes et scènes gardent leur ratio, les grilles utilisent
  `minmax(0, 1fr)`.

## 3.8 Accessibilité

- Cibles tactiles ≥ 44 px (`--touch-target`), `touch-action: manipulation` sur les boutons.
- Focus visible (`outline: 2px solid var(--color-accent)`) sur boutons, éléments de nav et options
  de sélecteur.
- `aria-label`, `aria-pressed`, `role="group"`, `role="switch"`, `role="status"`, `aria-live`
  utilisés sur les contrôles et les retours ; `.sr-only` pour les libellés longs.
- Les notifications ont une famille `data-type` et peuvent être fermées au clavier (`Entrée` /
  `Espace`).
- `prefers-reduced-motion` coupe ou fige les animations.
- Les icônes purement décoratives sont `aria-hidden` ; un emoji ou un glyphe ne porte jamais seul une
  information.
- Les images manquantes sont masquées proprement (`onerror` → `hidden`) et une médaille de trophée
  absente retombe sur `assets/img/trophy/default.png`.

## 3.9 Raccourcis clavier

| Contexte | Touches | Effet |
|---|---|---|
| Ouverture (scène) | `←` / `→` | extension précédente / suivante |
| Ouverture (révélation) | `←` / `→` | carte précédente / suivante |
| Ouverture (révélation) | maintenir `Espace` | enchaîne les révélations toutes les 900 ms (premier appui immédiat, relâchement = arrêt) |
| Ouverture | `Échap` | ferme la modale ou quitte la scène |
| Mine Pick (paquet ouvert) | `1` `2` `3` `4` `5` | garde la carte du même emplacement à l'écran |
| Mine Pick (AZERTY) | `&` `é` `"` `'` `(` | mêmes emplacements (rangée non majuscule) |
| Collection (fiche ouverte) | `S` / `V` | vend un exemplaire |
| Collection (fiche ouverte) | `Maj+S` / `Maj+V` | vend tous les doublons (une copie protégée) |
| Collection (fiche ouverte) | `B` / `A` | achète un exemplaire |
| Collection (fiche ouverte) | `P` / `F` | met / retire des favoris |
| Trophées (fiche ouverte) | `P` / `F` | épingle / désépingle le trophée (s'il est débloqué) |
| Mine | `Espace` | porte un coup |
| Mine | maintenir `Maj+Espace` | un coup toutes les `mining.keyHoldIntervalMs` (250 ms, plancher 100 ms) |
| Mine | `S` | ouvre le Wandering Trader |
| Notifications | `Entrée` / `Espace` | ferme la notification affichée |
| Partout | `Échap` | ferme la popup / modale empilée au premier niveau |

Les raccourcis respectent les mêmes gardes que les boutons : aucun n'agit pendant qu'une popup est
empilée, qu'un champ de saisie a le focus ou qu'une action est en cours.

## 3.10 Description écran par écran

- **Accueil / onboarding** : titre « Bienvenue dans MineCards », deux boutons (créer / importer),
  sélecteur de langue, notice de stockage local. Fond sobre, aucun chrome applicatif.
- **Ouverture** : sélecteur d'extension, deux flèches latérales, scène 3D (ou image 2D), quota,
  compte à rebours, bouton principal. Le rituel plein écran (mode focus) enchaîne booster, projecteur,
  résumé.
- **Collection** : grille de cartes, barre de recherche + bouton « Filtres & tri » (badge du nombre de
  filtres), compteur de cartes, bouton Binders. Silhouettes grisées pour les manquantes, cœurs sur
  les possédées.
- **Profil** : identité (avatar, pseudo, titre), niveau et barre d'XP, trois petits boutons
  (Statistiques, Trophées, Titre), trophées épinglés, cartes favorites (lignes défilantes), carte de
  profil avec ses réglages (rareté, disposition, couleur, agrandir, télécharger).
- **Statistiques** : panneaux de compteurs, barres par rareté/extension, panneaux Mine Pick et Mine.
- **Trophées** : deux combos (famille, statut), grille de médailles avec halo selon la rareté,
  bouton d'épingle sur les débloquées, modale de détail avec cartes requises et récompenses.
- **Titre** : liste « Aucun titre » puis titres par source, chacun écrit dans la police où il sera
  porté ; titres verrouillés grisés avec leur condition.
- **Mine Pick** : liste des dix boosters (texture, nom, cinq cartes), ligne d'état, bouton d'achat si
  épuisé, scène de pioche plein écran.
- **Mine** : bloc en grand, nom et blocs restants, pastilles de ressources, coffre (secoué à chaque
  bloc cassé), bouton marchand, popup d'inventaire, popup boutique + détail d'offre.
- **Annonce d'extension** : popup globale (au-dessus de toute vue) avec badge, texture du booster,
  nom, date de sortie et bouton « Compris » ; une seule fois par extension et par compte.
- **Paramètres** : une pile de panneaux (Langue, Thème, Animations + aperçu, Foil, Illumination,
  Notifications, Son, Mode développeur, Compte, Heure UTC, Sauvegarde, Distributions, Codes,
  Cadeaux).
- **Informations** : texte explicatif, sommaire cliquable, panneaux « Contrôles clavier », « Mine »,
  « Marchand itinérant », « Extensions et sorties » (dates de sortie + relecture de l'annonce) et
  « Expérience et niveaux ».
- **Overlay** : page transparente, booster qui tourne, cartes qui se retournent, résumé, puis écran
  vide.
- **Binder partagé** (`collection.html`) : panneau centré, pastille auteur, grille 3 colonnes,
  modale de détail, foil rendu par `Shine.js`.

## 3.11 Icônes et images

- Icônes d'interface dans `assets/img/` (`binders.png`, `chest.webp` et sa planche de 41 images
  `chest-sprite.webp`, `wanderingtrader.png`, `pin.png`, `unpin.png`, `edit.png`, `sparks` et
  compteurs, etc.). Les glyphes noirs (`pin`,
  `unpin`, `edit`) suivent la palette via `--icon-filter` (inversés sur les thèmes sombres).
- **Icônes à deux encres** : `daily_boosters`, `bonus_booster` et `binders` existent aussi en
  `_dark.png` (**blanc**). Le choix se fait dans la palette, pas dans le JS :
  `--icon-variant: dark|light` est déclaré dans `css/themes.css` à côté de `--icon-filter`, et
  `js/utils/ThemeIcons.js` s'en sert (`usesDarkIcons()`, `themeIcon(path)`, `applyThemeIcons()`).
  Une image concernée porte `data-icon="<nom>"` **sans `src`** (le fichier noir serait téléchargé
  avant que le thème soit connu) ; `applyThemeIcons()` est appelé au démarrage puis sur chaque
  `THEME_CHANGED`. Les deux variantes sont précachées (`sw.js`), sinon un démarrage hors ligne
  afficherait des compteurs vides.
  - Elles sont utilisées dans la **barre du haut** (compteurs quotidiens, bonus, binders) et sur le
    bouton **Binders** de la collection. La carte `DARK_ICONS` de `ThemeIcons.js` est la liste de
    référence. La **grille des récompenses de connexion** n'en fait pas partie : une case `Booster`
    y montre l'illustration du pack (`assets/img/booster.png`), identique sur tous les thèmes.
  - `--icon-ink` (`#000` sur les trois thèmes clairs, `#fff` sur `dark` et `night`) habille les
    glyphes **inline** de l'en-tête (étoile de la Mine Pick, cadeau des récompenses de connexion),
    qui n'ont pas de fichier à permuter.
  - La variable se lit sur `<body>`, jamais sur `<html>` : `:root` porte la palette sombre par
    défaut et resterait juste après un changement de thème.
- Avatars de profil en **pixel art** (6×6, 8×8, 48×48, 192×192) rendus avec
  `image-rendering: pixelated` partout (profil, sélecteur, trophée, binder partagé).
- Médailles de trophées : `assets/img/trophy/<setId>/<famille>/<rareté>.png`,
  `assets/img/trophy/Global/<compteur>/<rareté>.png`, et repli `assets/img/trophy/default.png`.
- Blocs de la mine : `assets/img/blocks/<bloc>.webp`, fissures `assets/img/blocks/break/<n>.png`,
  poussières `assets/img/dusts/<slug>.png`.
- Booster 3D : `assets/boostermodel.glb` ; textures par extension `assets/boosters/<setId>.png`.

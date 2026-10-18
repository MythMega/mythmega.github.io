# Context & Goal
Tu es un développeur Web Frontend Senior. Tu dois développer une application Web "Full Client" (Vanilla JS/ES6+, HTML5, CSS3) d'ouverture de boosters de cartes à collectionner, optimisée pour Mobile et Desktop. Aucune dépendance de framework lourd (pas de React, Vue, etc.), tout repose sur des modules JS natifs et IndexedDB. Seule dépendance tolérée : Three.js (+ GLTFLoader) pour le rendu 3D.

---

## 1. Architecture & Structure du Code
Séparation stricte des responsabilités (arborescence complète : voir `archi.txt`) :
- `js/models/` : interaction directe avec IndexedDB (`StorageRepository.js`).
- `js/classes/` : structures de données (`Card.js`, `SaveFile.js`).
- `js/business/` : logique métier (compte, gacha, date/quota, collection, redeem, distributions).
- `js/UI/` : vues et composants d'interface.
- `js/utils/` : utilitaires isolés (compression, bus d'événements, i18n, thème).

---

## 2. Modèle de données (source de vérité unique)
Base IndexedDB `CardBoosterDB` (version 1), 5 ObjectStores :

| Store | Clé | Contenu |
|---|---|---|
| `collection` | `key` = `${id}_${style}` | `{ key, cardId, style, set, quantity, firstObtainedAt, lastObtainedAt }` |
| `user_state` | clé texte (voir ci-dessous) | états applicatifs |
| `redeemed_codes` | `code` | `{ code, redeemedAt }` |
| `gifts_received` | `line` (n° de ligne du sheet) | `{ line, uuid, type, key, quantity, receivedAt }` |

Clés de `user_state` :
- `"account"` : `{ uuid, createdAt }` — **son existence = "un compte existe"**.
- `"settings"` : `{ lang: "fr"|"en", theme: "dark"|"light"|"classic", sound: boolean, animation: "normal"|"epic"|"explosive", foilIntensity: number, glareIntensity: number, glowTrophies: number, devMode: boolean }`.
  `glowTrophies` est le **niveau** d'illumination des trophées (0-5, 2 par défaut, voir 3.G nonies).
- `"quota"` : `{ lastResetDay: "YYYY-MM-DD", dailyRemaining, bonusBoosters: { [setId]: number }, purchasedBoosters }` (ex. `{ "set1": 2 }`). `purchasedBoosters` compte les boosters **achetés en Sparks** : globaux (comme les quotidiens), ils ne sont jamais effacés par le reset.
- `"timeAnchor"` : `{ apiUtcMs, perfNow, lastKnownUtcMs }`.
- `"stats"` : `{ boostersOpened, boostersOpenedBySet: { [setId]: count }, drawsByRarity: {1..5}, drawsByCard: { [key]: count } }`.
- `"giftSync"` : `{ lastCheckedLine, lastCheckAt }`.
- `"sparks"` : `number` — solde de Sparks du joueur (`SparksManager`), la monnaie du jeu.
- `"profileCard"` : `{ layout: "classic"|"fullart", rarity: 1..5|null }` — préférences d'affichage de la carte de profil (`ProfileCardManager`) : la disposition choisie et la rareté portée (`null` = la plus haute atteinte).
- `"purchases"` : `{ [featureId]: { boughtAt } }` — les **fonctionnalités achetées en Sparks** (`FeatureManager`), indexées par identifiant. Seul ce qui a été payé est écrit : le prix reste dans `settings/config.json`, donc le changer ne recharge jamais un propriétaire.
- `"profile"` : `{ name, icon, photo, title, favorites: string[], featured: string[] }` — profil du joueur (`ProfileManager`) : nom affiché, icône du catalogue (`icon`), URL de la photo d'une sauvegarde ancienne (`photo`, lue et affichée, plus jamais écrite), **titre** affiché sous le pseudo (`title`, `""` = aucun — voir 3.I), jusqu'à 5 cartes favorites et 3 trophées mis en avant.
- `"trophies"` : `{ unlocked: { [trophyId]: { unlockedAt, experience } } }` — trophées débloqués (`TrophyManager`). Un déblocage est **définitif** : revendre des cartes ne le reprend jamais.
- `"binders"` : `[{ id, name, cover, createdAt, slots: (string|null)[30] }]` — les **binders** du joueur (`BinderManager`), dans l'ordre de création. `cover` est la clé de collection de la carte représentative (le `Background` de cette carte devient le fond de la page), `slots` les 30 emplacements (clé de collection ou `null`). Rangé dans `user_state` — et non dans un store à part — pour qu'un `.save` l'emporte sans changer le format de sauvegarde.
- `"minePick"` : `{ lastResetDay, remaining, bonusPicks, totalPicks, picksByBooster, picksByRarity, picksByCard, history }` — état de la Mine Pick (`MinePickManager`) : quota du jour (remis à `picksPerDay` à minuit UTC), `bonusPicks` pour les pioches **achetées en Sparks** (jamais effacées par le reset, dépensées seulement quand les gratuites sont épuisées), et les statistiques **propres** à la fonctionnalité (une pioche n'est pas un booster ouvert, elle ne touche donc jamais `stats`).
- `"mining"` : `{ lastResetDay, minedToday, clicks, resources, blocksMined, totalMined, sparksFound }` — état de la **Mine** (`MiningManager`) : quota du jour (remis à `blocksPerDay` blocs à minuit UTC), `clicks` = les coups déjà portés au bloc du moment (le bloc lui-même n'est **jamais stocké** : il est dérivé de la graine du jour, voir 3.G sexies), `resources` = la quantité de chacune des ressources récoltées, `blocksMined` = un compteur **par type de bloc** (la statistique propre à la fonctionnalité) et les totaux (blocs cassés, Sparks trouvés).
- `"trader"` : `{ week, purchases: { [offerKey]: number }, tradeDay, tradeUses: { [tradeKey]: number } }` — état du **Marchand itinérant** (`TraderManager`) : `week` est le **lundi** auquel appartiennent les achats enregistrés, `purchases` le nombre de fois que chaque offre de la boutique a été achetée cette semaine-là. Un état dont `week` n'est pas la semaine courante est lu comme vide : c'est le reroll de la boutique, qui n'écrit rien tant que rien n'est acheté. Les **échanges du jour** sont comptés à part, sous leur propre jour : `tradeDay` est le jour UTC auquel appartiennent les compteurs `tradeUses`, si bien qu'à minuit UTC les échanges redeviennent disponibles sans que la boutique de la semaine bouge.

Note : pas de cookies. Tout est en IndexedDB. Seul un miroir `localStorage` de `lang` et `theme` est autorisé, pour appliquer le thème avant le premier rendu (évite le flash).

---

## 3. Spécifications Techniques & Fonctionnalités

### A. Compte local & Onboarding (première visite)
- Pas de serveur : "créer un compte" = initialiser localement la base et générer un **UUID** (`crypto.randomUUID()`), stocké dans `user_state["account"]`.
- **Au démarrage :** si `account` existe → l'app démarre normalement. Sinon → **écran d'accueil** avec 2 choix :
  1. **Créer une nouvelle sauvegarde** : génère l'UUID, initialise `settings`, `quota`, `stats`, `giftSync`.
  2. **Importer une sauvegarde `.save`** : restaure tout, dont l'UUID d'origine.
- L'UUID est **immuable** : il est contenu dans la sauvegarde et restauré tel quel à l'import.
- L'UUID est visible et copiable dans Paramètres (il sert à recevoir des cadeaux).
- Au premier lancement, appeler `navigator.storage.persist()` pour limiter le risque d'effacement par le navigateur.
- "Réinitialisation complète" = suppression de toutes les données **y compris l'UUID**, puis retour à l'écran d'accueil.

### B. Horodatage Anti-Triche (Reset Journalier à 00:00:00 UTC)
- **3 boosters par jour** (`dailyRemaining`), remise à 3 chaque jour à 00:00:00 UTC.
- Date du jour via `https://worldtimeapi.org/api/timezone/Etc/UTC` (prévoir un second fournisseur de secours).
- **Les boosters bonus** (redeem, cadeaux) sont **propres à une extension** : ils sont stockés par identifiant de set dans `bonusBoosters` (ex. `{ "set1": 2 }`) et **ne sont jamais écrasés** par le reset. Les 3 boosters quotidiens, eux, sont utilisables sur n'importe quelle extension. À l'ouverture d'un booster du set S, on consomme d'abord `dailyRemaining`, puis `bonusBoosters[S]`, puis `purchasedBoosters` : un booster gratuit n'est jamais gaspillé par un achat.
- **Boosters achetés** (quotidiens épuisés) : quand `dailyRemaining` est à 0, la vue « Ouvrir » propose d'**acheter un booster en Sparks** au prix de `boosters.extraBoosterPriceSparks` (1500 par défaut). Le débit et le crédit se font dans **une seule transaction** (`BoosterManager.buyExtraBooster`), le booster acheté est global, il **survit au reset** (il a été payé) et il est dépensé **en dernier**. L'achat enchaîne directement sur l'ouverture. Un solde insuffisant désactive le bouton et indique le manque ; un échec d'écriture après l'ouverture rembourse le booster dans son propre seau.
- **Hors-ligne :**
  - Dans la même session de page : temps UTC estimé = `apiUtcMs + (performance.now() − perfNow)`. `Date.now()` n'est jamais utilisé.
  - Après rechargement hors-ligne : `performance.now()` repart de zéro, l'ancrage n'est donc plus exploitable. Le temps est alors **figé** à `lastKnownUtcMs` (dernier UTC fiable). Aucun reset n'est possible hors-ligne après un rechargement.
  - Le temps estimé ne peut jamais reculer (`max` avec `lastKnownUtcMs`).

### C. Moteur Gacha
- Un booster contient **5 cartes**.
- Probabilités par emplacement lues depuis `settings/rarity.json` (tirage pondéré).
- Une fois la rareté R choisie : carte au hasard parmi les cartes de rareté R du JSON de l'extension.
- Doublons autorisés dans un même booster.
- Les cartes sont **enregistrées en base dès le tirage** (avant la révélation).

### D. Structure des Cartes & JSON
- Propriétés : `id`, `name`, `rarity` (1–5), `style` (`"normal"|"fullart"`), `illustration` (nom unique dans tous les fichiers), `set`, `background` (facultatif).
- **`Background`** (`Card.background`) : l'URL absolue de l'**illustration de fond** de la carte (`Background` du JSON, jamais localisée : ce n'est pas un chemin `<lang>`). Elle sert de **décor de binder** (section 3.H bis). Un `Background` absent ou illisible donne une chaîne vide, pas une erreur : une carte sans fond reste une carte valide.
- Clé unique : `${id}_${style}`. Les `id` doivent donc être uniques entre extensions.
- Chemins d'illustration : `/fr/` ⇄ `/en/` selon la langue active.
- **Format unique : 720 × 1000** (ratio 0,72), quelle que soit la rareté ou l'impression. Le ratio est déclaré une seule fois, `--card-ratio` dans `css/base.css` (et dans `css/overlay.css`, qui ne partage aucune feuille avec l'application), et **toute** boîte qui affiche une carte le reprend : vignette de collection, face de carte de l'ouverture, détail agrandi, carte du résumé, historique des Statistiques, pioche de la Mine Pick, cartes et icônes des trophées, vignettes de l'overlay. Une boîte au ratio approximatif (2/3, par exemple) laissait des bandes autour de l'illustration, et la fenêtre du foil (`css/components/card-shine.css`) se peignait alors au-delà de l'image.

### D bis. Cartes promo (obtention par code ou événement)
- **Déclaration :** un fichier par série dans `data/promo_cards/<serie>.json` (`promos.directory`, `promos.sets` — vide = un fichier par extension de `boosters.sets`). Le contenu est soit un tableau d'entrées de carte, soit `{ Serie, Name, Cards: [...] }` ; le groupe exposé s'appelle `<serie>-Promo` et porte le nom de la série (« Genesis Blocks · Promo »). Une série sans fichier n'a simplement pas de promo, et un fichier absent ou invalide est ignoré avec un avertissement (`PromoManager`).
- **Jamais tirées :** `BoosterManager` ne lit pas ces fichiers et les cartes n'entrent dans **aucune** table de rareté. Elles ne peuvent donc sortir ni d'une ouverture ni d'une Mine Pick.
- **Obtention :** uniquement par **code** (`RedeemManager` : codes de feuille et codes personnels `useritem`, catalogue étendu aux promos) ou par **cadeau** (`GiftManager`, pour les distributions d'événement).
- **Collection :** une promo non possédée **n'apparaît pas** (pas de silhouette, pas de case vide) ; le groupe `-Promo` n'apparaît dans le filtre que dès qu'une carte du groupe est possédée. Les cartes possédées portent une pastille « Promo » et se comportent comme les autres (favoris, vente/achat, détail).
- **Complétion :** aucune promo ne compte dans `completion` ni dans le compteur d'une extension : le groupe porte un compteur vide et la vue Statistiques l'ignore. Le pourcentage continue de ne mesurer que le catalogue tirable.

### E. Rendu 3D & Animation d'Ouverture
- Three.js + `GLTFLoader`, modèle `.glb`, texture définie dans le JSON de l'extension.
- Workflow : interaction avec le booster 3D → 5 cartes face cachée → clic pour retourner une à une → glow CSS pour les raretés 4 et 5.
- Les animations de base sont **cinématographiques** : le retournement dépasse légèrement avant de se poser (`card-flip`, avec un zoom au passage), la carte du projecteur arrive de plus haut et de biais, la vignette de résumé rebondit, les raretés 4 et 5 s'entourent d'un halo et les Full Art dérivent doucement (`css/components/card-reveal.css`, `css/views/opening.css`).
- Trois **modes d'animation** (voir section F) habillent ce workflow. **Normal** ne change rien au mouvement, seulement ses durées. **Épique** le met en scène : rayons de lumière et **poussières sur toute la vue d'ouverture** (`css/animations/epic.css` : le `::before` est posé sur la **scène** et non sur la boîte de la carte — elle existe pendant tout le rituel et n'est `hidden` que sur l'écran de choix. Il est en `position: fixed; inset: 0` et porte un `z-index` **négatif**, ce qui le laisse au-dessus du fond de la page et **derrière les textes et les cartes** : un pseudo-élément dans le flux passerait par-dessus les phrases), traînée de décollage, onde de choc à l'ouverture de la carte, halo renforcé sur les raretés hautes, balayage lumineux sur le résumé. **Explosif** — mode **parodique assumé** (`parodic: true` dans `config.json`) — en rajoute : le booster tremble, tourne et explose derrière un « BOUM ! » entouré d'autocollants comiques, la scène **et** le panneau tremblent, un anneau de BD part du choc, des **confettis** sont tirés à chaque ouverture (`OpeningView.spawnConfetti()`), la carte fait deux tours et demi et les vignettes du résumé tombent du plafond en police comique. Le côté parodique est annoncé par la pastille « BLAGUE » de son bouton dans les Paramètres, et par la note sous le « BOUM ! ». Aucun paragraphe d'explication : la pastille suffit.
- La boîte qui contient le booster fait **90 % de la largeur** de son conteneur et **10 % de hauteur en plus** (38 vh pour l'aperçu du sélecteur, 50 vh pour la scène d'ouverture, 42 vh et 55 vh au-delà de 768 px) : le booster garde ainsi des marges sur les côtés, ce qui laisse les deux flèches de changement d'extension collées aux bords même sur un écran vertical. La caméra est reculée d'autant (3,52 au lieu de 3,2) pour que le modèle ne grossisse pas en même temps que la boîte ; l'image 2D de secours est réduite de 10 % de la même façon.

### F. Langues & Thèmes
- **Langues** : Français, Anglais (extensible : ajouter `settings/i18n/<code>.json` + l'entrée dans `settings/config.json`). Change les libellés et les chemins d'images, à chaud (sans rechargement).
- **Thèmes** : **Sombre** (défaut), **Clair**, **Classic**. Chacun est un bloc de variables CSS `body[data-theme="…"]` dans `css/themes.css`. Extensible.
- Les deux préférences sont sauvegardées dans `user_state["settings"]` et incluses dans le `.save`.
- **Animations** : **Normal** (défaut), **Épique**, **Explosif**. Les modes sont déclarés dans `settings/config.json` (`animations.list` : `id`, `labelKey`, `parodic`, `tearMs`, `flipMs`, `staggerMs`) et le mode actif est posé en `data-animation` sur `<html>`/`<body>`, comme le thème. `js/utils/AnimationManager.js` publie les trois durées en variables CSS (`--anim-tear-ms`, `--anim-flip-ms`, `--anim-stagger-ms`), que le **JS lit aussi** : les séquences automatiques (révélations de la Mine Pick, garde d'arrivée du projecteur) ne peuvent pas se désynchroniser du CSS. Le `tearMs` sert en plus au mouvement WebGL de `Booster3DRenderer`, donc la 3D, le CSS et la rafale comique restent sur la même horloge. `css/animations/`, chargé en dernier, ne fait qu'**habiller** les animations de base décrites en 3.E : un mode sans bloc CSS réutilise simplement le mouvement neutre à sa vitesse, et un mode qui en a un ne remplace jamais l'animation de base sans raison. La Mine Pick suit le mode actif (voir 3.G quater).

### G. Vues & Navigation (SPA)
0. **Accueil (onboarding)** : créer / importer, affiché seulement si aucun compte.
1. **Ouverture** : choix du booster + scène d'ouverture.
2. **Collection** : grille, silhouettes grisées pour les manquantes, **bouton cœur** sur les cartes possédées (5 favoris maximum), **bouton « Filtres & tri »**. Les filtres vivent dans une **popup** (`CollectionView`) : on y active/désactive chaque extension (plusieurs à la fois) et **chaque rareté (plusieurs à la fois, comme les extensions : `filters.rarities` est un `Set`)**, la famille **Promo** dans son ensemble, le statut (toutes / **possédées — l'état par défaut** / manquantes / **vendables**, c'est-à-dire 2 exemplaires ou plus), le style, et l'on y choisit le **tri** (**index du fichier, l'état par défaut**, numéro, rareté, style, quantité possédée, date d'obtention) et son sens. La grille ouvre donc sur **les cartes possédées** et non sur les 343 silhouettes du catalogue ; « Réinitialiser » y revient. La barre sous le titre ne garde que la recherche, le bouton qui ouvre la popup (avec un badge du nombre de filtres actifs) et le compte de cartes : **aucun filtre n'y est plus dupliqué**. Le **bouton « Binders »** siège **dans l'en-tête de la page, en haut à droite et hors du panneau de filtres** (`css/base.css` : `.view__header--split` met titre et action sur une ligne, `.view__heading` garde titre et sous-titre groupés), et l'en-tête de l'application porte en plus un **compteur Binders** (icône `assets/img/binders.png` + nombre de pages, voir 3.H bis). Le tri par numéro compare les `id` en `numeric: true`, pour que `W2` passe bien avant `W10`.

**Deux axes de numérotation, et deux tris** : chaque entrée porte à la fois `cardId` (le champ `Index` de la carte, « SERIE-A1 / W001 ») et `index` (sa **position dans le tableau `Cards` de son fichier d'extension**), les deux étant calculés par `CollectionManager` à chaque lecture — rien n'est stocké, donc réordonner un fichier se voit tout de suite. Ils ne se confondent pas : un fichier **groupe ses cartes par thème**, son ordre n'est donc pas celui des `Index` (la A1 commence par `W001`, pas par `A001`). D'où les deux tris de la popup : **« Index »** (le défaut) suit `index`, c'est-à-dire le fichier tel qu'il a été écrit ; **« Numéro »** suit `cardId`, extension par extension (`CollectionView.applyFilters`, `COLLECTION_SORT`). Un troisième tri, **« Date d'obtention »**, suit `firstObtainedAt` (la première copie de chaque carte) du plus ancien au plus récent : les cartes non possédées, qui n'ont pas de date, restent toujours à la fin quelle que soit la direction.
2 bis. **Profil** : l'identité **en lecture seule** (un bouton crayon `assets/img/edit.png` révèle le formulaire nom/photo), le niveau et sa barre d'XP juste en dessous, les trophées mis en avant et les cartes favorites — chacun sur **une seule ligne** défilante, chaque vignette ouvrant une **modale de détail**. Trois **petits boutons** sous le sous-titre (`view__header-actions`) mènent aux trois pages que la barre du bas ne porte plus : **Statistiques**, **Trophées** (le catalogue, isolé derrière deux combos — famille, statut — pour ne jamais afficher les trente trophées d'un coup, et muni de son propre retour au profil) et **Titre** (la liste des titres de joueur, un par ligne, voir 3.I). Les compteurs propres à la Mine Pick, eux, sont dans le panneau « Mine Pick » de la page Statistiques, à côté du panneau « Mine ».
3. **Pick** (Mine Pick) : les dix boosters simulés du jour, **listés un par ligne avec leur contenu face visible**, et les trois pioches gratuites. Un premier clic **sélectionne** la ligne (aperçu), le second l'ouvre — voir section 3.G quater. Son libellé de barre est **« Pick »** (la fonctionnalité garde son nom, « Mine Pick », dans son titre et sa page).
3 bis. **Mine** (`data-view="mineblock"`) : les **dix blocs du jour**, minés **un par un**, avec les ressources récoltées — voir section 3.G sexies. Elle occupe l'emplacement que les **Trophées** tenaient dans la barre du bas : le catalogue des trophées s'ouvre désormais depuis le **Profil**, par un second bouton à côté de « Statistiques », et porte pour cela son propre **bouton retour** (comme la page Statistiques, elle aussi ouverte depuis le Profil). Quatre fonctions ont donc leur page **hors** de la barre — Statistiques, Trophées, Titres — ou **dedans** — la Mine — et les trois premières savent revenir au profil.
4. **Paramètres** : langue, thème, **animations** (sélecteur + aperçu animé joué à l'ouverture de la page, le mode explosif marqué de sa seule pastille « BLAGUE »), **foil** (deux curseurs : intensité des motifs, **brillance** de la ligne qui balaie la carte — l'aperçu du panneau est un mythique, donc l'effet suit le doigt), **heure UTC de référence**, compte (UUID), sauvegarde (export / import / reset), **bouton "Vérifier les distributions"**, lien vers l'historique des cadeaux.
5. **Cadeaux** : historique des distributions reçues.
6. **Redeem** : codes spéciaux de `settings/codes.json` (plusieurs récompenses, fenêtre de disponibilité, répétable ou non — voir Étape 9).

L'heure UTC affichée dans les Paramètres est celle de `DateSyncManager` (jamais `Date.now()`), publiée par `CLOCK_TICK` : elle est donc toujours d'accord avec le quota quotidien et les fenêtres de disponibilité des codes.

**En-tête sur écran vertical** (< 768 px) : il ne garde que la marque et les compteurs. Le slogan et l'horloge UTC sont masqués (l'heure reste lisible dans les Paramètres) et « MineCards » s'affiche centré, une taille en dessous. Les cinq compteurs tiennent sur **une seule ligne** sous le titre, un cinquième de la largeur chacun (`flex: 1 1 0`, `flex-wrap: nowrap`) : répartis **trois puis deux**, ils mangeaient le premier écran entier pour des nombres qu'on lit d'un coup d'œil. L'icône (`0.9rem`) et le nombre (`--font-size-xs`) rétrécissent avec la pastille, et **`App.setCount` plafonne chaque compteur à `9999+`** (`HEADER_COUNT_MAX`) : cinq glyphes, soit ce qu'un cinquième d'un écran de 360 px tient à côté de son icône. Rien n'est perdu pour autant — le solde exact est sur la page Sparks, la répartition par extension dans l'**inventaire des bonus** que le compteur ouvre, et le nombre de binders dans la liste des binders. L'horloge UTC, qui n'est pas un compteur, ne passe pas par ce plafond.

**Éléments de l'en-tête, toutes tailles d'écran :** les compteurs et l'horloge UTC sont **une seule composante**, donc la **même boîte** — même icône (`1.05rem`, en `rem` et non en `em` : deux d'entre eux sont des `<button>`, qui n'héritent pas la typographie de leur conteneur comme un `<span>`), même hauteur (`min-height` commun) et **même largeur**. Sur écran large cette largeur est celle du **plus large** d'entre eux (`grid-auto-flow: column` + `grid-auto-columns: 1fr` : le plus long libellé de la langue courante, ou l'horloge du moment si elle est plus large), et `align-items: stretch` les met à la même hauteur ; la ligne reste à droite de la marque, sur une seule ligne. Un `<button>` ne peut pas recevoir le raccourci `font: inherit` : il réinitialise aussi `font-size`, ce qui donnait aux compteurs **Bonus** et **Binders** un libellé à la taille du corps et une boîte de trois pixels plus haute que les autres.

**En-tête sur écran large** (≥ 1024 px) : les cinq compteurs (boosters quotidiens, boosters bonus, pioches Mine Pick, Binders, Sparks) affichent leur **nom court** à côté de leur icône (« Quotidiens », « Bonus », « Pioches », « Binders », « Sparks » / « Daily », « Bonus », « Picks », « Binders », « Sparks »), et le slogan — pure décoration, déjà absent sur un téléphone — laisse la place. Le libellé long de chaque compteur reste dans un `.sr-only`, qui est le nom accessible : le libellé visible est `aria-hidden`, donc un lecteur d'écran n'entend jamais une version tronquée.

**Aide de page :** chaque vue (Ouverture, Collection, Profil, Statistiques, Trophées, Titre, Mine Pick, Mine, Paramètres, Informations) porte une pastille « Comment ça marche ? » sous son titre (`js/UI/components/ViewHelp.js`, styles dans `css/base.css`). Elle ouvre une **mini-popup** : le titre de la vue, **deux phrases** d'explication (`view.<vue>.help`) et un bouton « Plus d'infos » qui mène à la page Informations. Une seule popup ouverte à la fois ; `Échap`, un clic à l'extérieur ou un second clic sur la pastille la referment. Le texte passe par `data-i18n` : un changement de langue la retraduit sans la rouvrir.

**Le rituel prend tout l'écran** (`js/utils/FocusMode.js`, `body.is-focus` dans `css/base.css`) : deux moments du jeu sont des **rituels** et non des pages — **l'ouverture d'un booster**, à partir du moment où le joueur en a choisi un (`OpeningView.performOpen` → `showStage('scene')`), et **la pioche du Mine Pick**, à partir du moment où le paquet est distribué (`MinePickView.showStage('pick')`). Pendant ceux-ci, la **marque, les compteurs, la barre de navigation du bas, la pastille « Comment ça marche ? » et le titre de la vue sont masqués** : rien ne doit disputer l'écran au booster ni aux cartes. L'état est **une seule classe sur `<body>`**, posée par `setFocusMode()` au moment exact du changement d'étape — `showStage` est cette frontière des deux côtés — et retirée au retour (`finish()`, « Retour aux boosters »), par `handleViewDeactivated()` (quitter la vue en pleine ouverture par un lien profond ou le bouton retour rend le chrome) et par `destroy()`. L'espace de `padding-bottom` réservé à la barre disparaît avec elle et `--nav-height` passe à `0`, pour que la pile de toasts suive au lieu de flotter au-dessus du vide ; la bannière de notification, elle, se place en mesurant le bas de l'en-tête, dont la hauteur vaut zéro une fois masqué.

**Au centre, vraiment** : la scène d'ouverture est centrée **horizontalement et verticalement** (`body.is-focus [data-view="opening"].is-active`, `css/base.css`). `.app-main` occupe toute la hauteur de la fenêtre une fois le chrome retiré, donc la vue prend cette hauteur (`min-height: calc(100dvh - …)`) et centre sa colonne (`justify-content: safe center`). Le mot-clé **`safe` compte sur un téléphone** : une scène plus haute que l'écran — une carte de projecteur et ses deux boutons, barre du navigateur comptée — doit garder son haut **atteignable** au lieu de déborder au-dessus du pli sans pouvoir remonter ; un navigateur qui ignore `safe` écarte la déclaration et retombe sur `flex-start`, ce qui est le comportement sûr. L'axe horizontal n'est pas contraint : le centrage est déjà le métier des enfants (booster à 90 % avec `margin-inline: auto`, colonne du projecteur centrée, résumé en grille de colonnes égales). La pioche du Mine Pick garde son panneau **en haut** : sa liste de cartes et sa ligne de résultat se lisent dans l'ordre où elles sont écrites.

Sauvegarde `.save` : toutes les données → JSON → `CompressionStream('deflate')` → Base64. Import : Base64 → `DecompressionStream('deflate')` → JSON validé.

### G bis. Trophées & Niveau

Catalogue déclaré dans `settings/boosters_trophy.json` (paliers récurrents sur chaque extension :
complétion et boosters ouverts), `settings/global_trophy.json` (paliers globaux : cartes possédées,
boosters ouverts, cartes différentes, **blocs minés au total** et **blocs minés par sorte**,
**cartes piochées en Mine Pick** et **piochées par rareté de carte**) et
`data/trophies/<setId>.json` (succès de collection, listes d'index `RequirementType: "CardList"`,
layout `classic`/`fullart`/`any`). Raretés : `bronze`, `silver`, `gold`, `diamond`, `emerald`.

**Les deux familles de la mine.** `miningAllBlock` lit le compteur `totalMined` de la mine (tous les
blocs confondus). `miningEachBlock` est une **seule** table de paliers qui se déploie sur **chaque**
sorte de bloc de `settings/mining.json` : `TrophyManager.buildMiningBlockTrophies` fabrique ainsi
cinq trophées par bloc, chacun avec son propre groupe (`miningEachBlock:<bloc>`) et son nom de bloc
traduit (les noms viennent du JSON de la mine, pas des dictionnaires). Côté catalogue, la combo
« Famille » gagne une entrée **Mine** (les deux familles d'un coup) et une entrée par sorte de bloc.

**Les deux familles du Mine Pick.** `minepickTotalPicks` lit le compteur `totalPicks` de la Mine Pick
(toutes raretés confondues). `minepickSpecificPicks` est une **seule** table de paliers qui se
déploie sur **chaque** rareté de carte : `TrophyManager.buildMinePickRarityTrophies` fabrique cinq
trophées par rareté (`1` commune … `5` mythique), chacun avec son propre groupe
(`minepickSpecificPicks:<rareté>`). Le libellé de la rareté de carte est une traduction
(`rarity.1` … `rarity.5`) résolue par la modale de détail : changer de langue relabelle le trophée.
La combo « Famille » gagne une entrée **Mine Pick** pour les deux familles d'un coup.

Chaque trophée a une **médaille** : les paliers récurrents d'une extension la prennent dans `assets/img/trophy/<setId>/<famille>/<rareté>.png`, les paliers globaux dans `assets/img/trophy/Global/<compteur>/<rareté>.png` (le `<compteur>` est la clé de `settings/global_trophy.json` : `totalCards`, `boosters`, `differentCards`), les deux familles de la mine dans `assets/img/trophy/Global/miningAllBlock/<rareté>.png` et `assets/img/trophy/Global/miningEachBlock/<bloc>/<rareté>.png` (le `<bloc>` est l'`ID` brut de `settings/mining.json`, point compris : `material.stone/bronze.png`), celles du Mine Pick dans `assets/img/trophy/Global/minepickTotalPicks/<rareté>.png` et `assets/img/trophy/Global/minepickSpecificPicks/<raretéDeCarte>/<rareté>.png`, et les trophées de collection dans le champ `Icon` de leur entrée dans `data/trophies/<setId>.json` — n'importe quelle extension, le GIF animé `QuinteFlushRoyale.gif` compris. Un trophée dont le catalogue ne déclare aucune image, ou dont le fichier ne se charge pas, retombe sur `assets/img/trophy/default.png`.

**Halo des médailles.** Chaque médaille porte un halo dont le **rayon et la couleur dépendent de la
rareté du trophée** : aucun pour `bronze`, léger et blanc pour `silver`, léger et doré pour `gold`,
plus large et bleu clair pour `diamond`, plus large et vert émeraude pour `emerald`
(`css/components/trophy.css`, plus les médailles épinglées de `css/views/profile.css` et celles de la
carte de profil dans `css/components/profile-card.css`). L'**intensité** est un réglage du joueur,
de 0 à 5, publié par `GlowManager` sous la variable `--trophy-glow-scale` (le niveau 2, défaut,
vaut 1) : les trois surfaces multiplient le rayon de leur rareté par ce facteur, donc un seul curseur
les règle toutes. À 0, plus aucun halo.

L'XP totale est **dérivée** de l'état réel (`expérience.everyBooster` × boosters ouverts +
`everyDistinctCard` × cartes différentes + `nameChanged` si le nom est personnalisé + l'XP des
trophées, `ExperiencePerTrophy[rarité]` ou le champ `Experience` du fichier). Le niveau suit
`levelling` (`defaultLevel`, `baseRequiredExpToLevelUp`, `incrementRequiredXpBy`). Aucun compteur
d'XP n'est stocké : seuls les déblocages le sont (`user_state["trophies"]`), et un déblocage ne se
perd jamais, même si la collection change ensuite.

Le détail chiffré de **toutes** ces sources est affiché dans l'onglet *Informations*
(panneau « Expérience et niveaux »), lu directement dans `settings/config.json` via
`ConfigLoader.getLevellingSettings()` / `getExperiencePerTrophy()` : la page ne peut donc pas
dériver des règles réellement appliquées. Les épingles utilisent `assets/img/pin.png` et
`assets/img/unpin.png`, dont la couleur suit le thème (`--icon-filter` dans `css/themes.css`, les
glyphes étant noirs à la source).

### G ter. Notifications (ce que le jeu accorde)

Deux familles de messages, à ne pas confondre :
- les **toasts** (`js/UI/components/Toast.js`, `css/components/toast.css`) : l'accusé de réception d'une ACTION du joueur (« Carte achetée. »), empilés **en bas** de l'écran ;
- les **notifications** (`js/UI/components/NotificationCenter.js`, `css/components/notifications.css`) : ce que le jeu VIENT d'accorder (collection avancée, expérience, niveau). Elles s'affichent **une seule à la fois**, **en haut à droite** (en **haut au centre** sur un écran vertical), juste sous l'en-tête dont la hauteur est **mesurée** pour ne jamais le recouvrir.

Elles sont produites par `js/UI/components/GameNotifier.js` à partir des événements que les managers publient déjà (`js/utils/EventBus.js`) : aucun manager ne connaît l'interface. Les moments clés :
- **ouverture d'un booster** (`BOOSTER_OPENED`) : l'XP du booster + l'XP des cartes obtenues pour la première fois (`notif.experience.booster`) ;
- **découverte d'une carte** (`CARD_REVEALED`) : chaque collection que la carte fait avancer, **une fois par ouverture** (`notif.collection.progress`), ou sa validation (`notif.collection.complete`) — la notification est **prioritaire** ;
- **fin de la révélation** (`REVEAL_FINISHED`) : les collections préparées que le joueur n'a pas eu le temps de voir (sortir de la scène avec Échap ne doit rien perdre) ;
- **trophée débloqué** (`TROPHY_UNLOCKED`) : l'XP du trophée (`notif.experience.trophy`) ;
- **titre de joueur débloqué** (`TITLE_UNLOCKED`) : le titre lui-même, dans sa propre famille de notification (`notif.title.unlocked`), écrit dans la police pixel et en jaune — voir 3.I ;
- **carte obtenue hors ouverture** — achat en Sparks, code promo, distribution (`CARDS_OBTAINED`) : l'XP s'il s'agit d'une PREMIÈRE copie, puis les collections concernées ;
- **nom personnalisé défini** (`PROFILE_UPDATED`) : l'XP du nom, une seule fois (le nom par défaut ne rapporte rien) ;
- **niveau atteint** (`EXPERIENCE_UPDATED`) : « Niveau N atteint », dans sa propre variante.

Règles de la file d'attente : une notification reste **3 s** (`NOTIFICATION_DURATION_MS`) puis la suivante prend sa place ; un **clic**, un **tap**, **Entrée/Espace** ou un **swipe latéral** (≥ 40 px, la carte suit le doigt) la retirent immédiatement et montrent la suivante. Une notification **prioritaire** (une collection découverte pendant la révélation) **interrompt** celle qui est affichée : celle-ci repart en tête de sa file et se réaffiche ensuite, avec sa durée complète. Le compteur d'une collection ne compte que les cartes **déjà retournées** : une notification ne peut donc pas révéler qu'une autre carte de la même collection attend encore dans le paquet.

**Aucune notification au démarrage** : l'XP et les trophées sont évalués une fois au lancement, et `app.js` appelle `gameNotifier.start()` APRÈS cette première évaluation (qui prend le niveau courant comme référence). Importer une sauvegarde qui débloque dix trophées d'un coup ne déclenche donc aucun message.

Enfin, les avatars (`assets/img/profile/**`) sont du **pixel art** (6x6, 8x8, 48x48 ou 192x192) : les quatre endroits qui les affichent — avatar du profil, sélecteur d'icônes, section « Icônes débloquées » d'un trophée et avatar de la page d'un binder partagé (`collection.html`) — les rendent avec `image-rendering: pixelated`, donc sans aucune interpolation.

### G quater. Mine Pick

Un onglet principal (`data-view="minepick"`) : chaque jour, **dix boosters simulés** sont listés, **un par
ligne**, avec leur texture, leur nom et leurs **cinq cartes face visible** — le pack se choisit donc en
connaissance de cause, jamais au hasard. Le joueur dispose de **trois pioches gratuites**, remises à zéro
à minuit UTC comme le quota quotidien. Ouvrir un booster distribue son contenu face visible (exactement
ce que la ligne annonçait), retourne les cartes une à une puis les **mélange**, et le joueur garde celle
qu'il retourne : les autres se révèlent ensuite et la carte gardée rejoint la collection.

**Deux clics pour ouvrir, et c'est volontaire.** Le premier **sélectionne** la ligne : elle se borde et
s'illumine, sa ligne d'état annonce « Sélectionné », son bouton (jusqu'ici gris) devient « Ouvrir ce
booster » — et **rien n'est consommé**. Le second clic (sur la ligne ou sur ce bouton) ouvre vraiment le
pack. Une pioche gratuite ne se dépense pas parce qu'un pouce a frôlé une ligne en scrollant.

**Un booster déjà pioché reste dans la liste**, avec la carte qui en a été gardée (marquée « Gardée », les
quatre autres grisées) et un bouton désactivé : il n'est pas rejouable le même jour, donc les choix
s'épuisent vraiment avant les dix lignes. Une ligne affiche donc l'un de ces quatre états : *piochable*,
*sélectionnée*, *pioche faite* ou *verrouillée* (quota du jour épuisé, avec le compte à rebours de minuit
UTC).

**L'anneau de rareté se mérite** (`css/views/minepick.css`) : deux verrous, et un seul moment où la rareté
est dite.

  - **Sur le plateau**, une vignette ne porte le contour de sa rareté (violet fin pour une super rare,
    doré pour une légendaire, rose épais pour une mythique) qu'avec la classe `is-revealed`, c'est-à-dire
    **après que le pack a été ouvert ET qu'une carte en a été piochée** (`MinePickView.buildMiniCard`).
    Avant, les dix lignes n'annoncent rien : liseré neutre seul.
  - **Sur la scène de pioche**, les cinq cartes n'ont de contour qu'avec `is-summary`, posée par
    `MinePickView.markPackRevealed()` **à la toute fin** : le clic effectué (anneau **vert** immédiat, la
    confirmation du choix) *puis* la dernière des quatre autres cartes retournée, délai du dernier flip
    compris. Avant, l'anneau était dessiné dès la distribution - sur le dos des cartes -, et le pack
    annonçait la rareté des cartes qu'on ne garderait pas pendant qu'elles se retournaient.

Le liseré **full art** (accent) n'est pas gaté : il nomme le tirage, que la vignette montre déjà, pas la
rareté.

**Le mélange ne dit jamais où va une carte.** Les cinq cartes ne sont pas échangées de case en case :
elles se rassemblent toutes au **même point**, au centre de la scène, où elles forment une pile (léger
biais et décalage de profondeur pour chacune). L'ordre du DOM change **pendant** qu'elles sont dans cette
pile — même endroit, même dos, un seul repaint — puis elles repartent vers les cinq emplacements. Rien
ne permet donc de suivre la carte que l'on convoitait : c'est un tirage, pas un bonneteau.

**Les animations sont au rendez-vous** (`css/views/minepick.css`) : le pack atterrit dans une déflagration
de lumière, les cinq cartes se distribuent une à une en se posant, le paquet face visible « respire »
pendant qu'on le mémorise, chaque carte se retourne avec une petite levée, la pile se forme et se
déploie, ondes de choc et vibration de la ligne sélectionnée comprises. Les durées viennent du mode
d'animations actif (`--anim-flip-ms`) : l'Épique est plus lent et plus large, l'Explosif secoue la scène
et fait sautiller les cartes. `prefers-reduced-motion` les coupe toutes.

**Sur écran vertical, le paquet se pose en 3 + 2 centré** : `.minepick__cards` est un conteneur `flex`
qui centre sa dernière ligne (une grille de trois colonnes aurait collé les deux cartes restantes à
gauche), et passe à cinq colonnes au-delà de 768 px.

**Les paquets sont réels.** Une ouverture simulée passe par le même `GachaEngine`, la même table de
raretés (surcharge d'une extension comprise) et les mêmes `boosters.cardsPerBooster` /
`boosters.godpackChancePercent` qu'une ouverture : modifier `settings/config.json` change donc
réellement ce que la Mine Pick affiche.

**Déterminisme.** Le plateau entier vient d'un générateur amorcé par `minePick.seedSalt` + le jour UTC
fiable + l'UUID du compte : un rechargement montre le même plateau, il change au jour UTC suivant, et
deux comptes ne partagent jamais le même. L'extension de chaque booster est tirée avec un poids de
`(rang + 1) ** minePick.setWeightExponent`, donc l'id le plus haut est le plus probable. `Math.random()`
n'est jamais utilisé, et les tirages sont pris dans un ordre fixe : le dixième booster ne dépend pas de
l'affichage.

Le **mélange** est reproductible pour la même raison : un second générateur, dérivé de la même graine
(`buildShuffleOrder`, Fisher-Yates), fixe l'ordre d'affichage de chaque pack **après** le tirage de tous
les paquets — les cartes ne dépendent donc pas du mélange, et un rechargement redistribue chaque pack à
l'identique.

**Paramètres** (`settings/config.json`, section `minePick`) : `boosterCount` (10), `picksPerDay` (3),
`extraPickPriceSparks` (1000), `historySize` (10), `seedSalt`, `setWeightExponent`. Chaque valeur retombe
sur son défaut si la section est absente ou corrompue.

**Pioche achetée.** Quand les pioches gratuites **et** les pioches achetées sont épuisées, la vue propose
d'**acheter une pioche** pour `extraPickPriceSparks` (1000 Sparks). Le débit et le crédit se font dans une
seule transaction (`MinePickManager.buyExtraPick`), la pioche achetée est stockée dans `bonusPicks`, elle
**survit au reset** (elle a été payée) et n'est dépensée qu'une fois le quota gratuit épuisé — elle rend
donc le plateau immédiatement rejouable.

**Ce qui est écrit** : `user_state["minePick"]` (quota du jour, `picksByBooster` — quel booster a été
utilisé aujourd'hui et quelle carte en est sortie, c'est ce qui marque les lignes de la liste et ce que
lit la garde `ALREADY_PICKED` —, `totalPicks`, `picksByRarity`, `picksByCard`, `history`) et **la seule
carte gardée** dans la collection, dans **une seule transaction** :
impossible de consommer une pioche sans recevoir sa carte. La carte est annoncée par `CARDS_OBTAINED`
(`source: "minepick"`), donc XP, trophées et notifications suivent exactement comme pour une carte achetée.
En revanche elle ne touche **jamais** `stats` (ce n'est pas un booster ouvert) : la fonctionnalité a ses
propres compteurs, affichés dans le bloc Statistiques du Profil.

**Renommage.** La fonctionnalité, sa clé de sauvegarde et son `seedSalt` ont été renommés (l'ancien nom
a fait l'objet d'une demande pour raison de droit). Conséquence assumée : la **première** ouverture après
la mise à jour repart sur un plateau neuf et un quota plein, puisque la graine a changé — la collection,
elle, n'est jamais touchée.

### G quinquies. Foil et brillance (réglages)
- **Trois raretés portent un foil** (`SHINE_MODIFIER_BY_RARITY`) : **super rare** (3) une fine trame diagonale, **légendaire** (4) un voile sur une grille embossée, **mythique** (5) le traitement complet (nid d'abeilles, deux reflets croisés, bascule 3D). Les raretés 1 et 2 n'en ont aucun. Le vocabulaire de formes vient de `external/cardmakerz/styles/base.css`, redessiné en blanc : les palettes ne changent que la force, jamais la teinte.
- **Deux effets, deux curseurs** (panneau « Foil » des Paramètres) :
  - **Intensité du foil** (`foil.min|max|step|default`) → `--foil-intensity`, multiplié dans l'opacité des **motifs** (les deux plans `::before`/`::after` de `css/components/card-shine.css`) ;
  - **Brillance** (`foil.glare.min|max|step|default`) → `--glare-intensity`, multiplié dans l'opacité de la **ligne** qui balaie la carte.
  Chaque curseur a sa préférence (`settings.foilIntensity`, `settings.glareIntensity`) et son événement (`FOIL_INTENSITY_CHANGED`, `GLARE_INTENSITY_CHANGED`), tous deux publiés par `js/utils/FoilManager.js`.
- **La ligne est une couche à part** (`.card-shine__gleam`, créée par `applyShine()` de `CardComponent`) : c'est ce qui lui permet d'avoir sa propre intensité. Une couche de plus dans le `::after` aurait partagé l'opacité du plan entier et n'aurait pas pu être réglée séparément. Son angle et sa durée restent par rareté (`--gleam-angle`, `--gleam-duration`).
- **Résille du mythique** : le tracé du data-URI est à **0,3** d'alpha, soit la moitié des 0,6 du créateur de cartes — la résille est la forme la plus dense des trois et, à pleine force, elle se lisait comme un fil de fer dessiné sur l'illustration plutôt que comme un reflet.
- **Défaut à 100 %** pour les deux : c'est l'intensité pour laquelle les effets ont été réglés, donc un joueur qui ne touche à rien voit exactement ce qui a été dessiné. Une sauvegarde antérieure (sans `glareIntensity`) retombe sur le défaut.
- **Bornes :** une valeur hors plage est ramenée dans la plage plutôt que rejetée, afin qu'un `.save` écrit avec une plage plus large continue de se charger. À 0 sur l'intensité du foil, `FoilManager` pose en plus `data-foil="off"` sur `<html>` et `<body>`, ce qui arrête les animations devenues invisibles — et **retire la ligne** (`display: none`) : elle ne répond qu'à la brillance, donc rien ne l'éteindrait d'autre, et elle resterait peinte, figée, sur une carte sans foil.

### G sexies. Mine (MineBlock)

Un onglet principal (`data-view="mineblock"`) : **dix blocs par jour**, minés **un par un**. Le bloc du
moment est affiché **en grand au centre**, son nom au-dessus, le nombre de blocs restants du jour, et
sous lui **chaque ressource** récoltée : **son icône et son nombre**, rien d'autre (le nom est dans
l'**inventaire** et dans le texte accessible de la pastille). Le nombre de coups qu'il reste à porter
n'est **jamais** écrit : la craquelure sous le doigt dit déjà où en est le bloc, et un compteur à côté
transformait le rituel en rapport de progression.

**Cinq sortes de blocs**, décrites dans `settings/mining.json` : `Weight` (le poids du tirage : la pierre
est commune, l'obsidienne rare) et `Hardness` (le nombre de coups à porter pour casser le bloc, de 3 à
30). La texture de chaque bloc vit dans `assets/img/blocks/<bloc>.webp`, ses deux sons dans
`assets/sound/blocks/<bloc>.mine.mp3` et `<bloc>.break.mp3` : ces chemins sont **dérivés de l'id** du bloc
(`material.stone` → `stone.webp`), donc une nouvelle sorte de bloc n'a que ses fichiers à fournir.

**La casse se voit.** À chaque coup qui ne casse pas, le bloc est **fêlé** un peu plus : la table `Cracks`
de `mining.json` associe une plage de pourcentage (`Min`/`Max`) à une texture de craquelure
(`assets/img/blocks/break/<n>.png`), posée **sur** l'image du bloc, à la même taille et au même endroit
(d'où `image-rendering: pixelated` sur les deux). Les trois premiers coups d'une pierre montrent donc
33 %, 66 %, puis le bloc se brise ; les pourcentages sont calculés en JS (`MiningManager.percentOf`) et
la correspondance plage → texture reste dans le fichier de données.

**Le butin sort du bloc.** Quand un bloc se casse, ses récompenses **s'échappent** : un élément volant par
unité obtenue — la poussière du bloc (toujours), et les Sparks quand le tirage les accorde (quatre Sparks
→ quatre étoiles) — chacun dans une **direction aléatoire**, avec sa distance, son délai et sa rotation
tirés au sort, plus un toast par récompense (« +1 Poussière de pierre », « +4 Sparks »). Le bloc suivant
n'arrive qu'après ce départ (`mining.nextBlockDelayMs`, **100 ms** dans `settings/config.json`), puis
tombe en place — une chute brève et animée (`mineblock-arrive`, 160 ms, la durée que la vue attend
avant de retirer la classe) — avec sa texture, son nom et sa
dureté. Le rythme de la mine est donc un réglage : la casse et l'arrivée sont courtes pour que le joueur
enchaîne les blocs sans attendre. Chaque coup joue le `.mine` de son bloc, le coup qui le casse joue son `.break` : les deux sons du
bloc affiché sont **préchauffés à son affichage** (une seule fois par chemin : un `load()` sur un son en
cours de lecture le coupe).

**Ce qui est tiré, et où c'est écrit.** `Weight`/`Hardness`/`Rewards` viennent de `settings/mining.json`
(un `Rewards` sans `Chance` est garanti, un `Range` absent vaut 1) ; le **quota** (`blocksPerDay`, 10), le
chemin du fichier et la graine vivent dans `settings/config.json` (section `mining`). L'**ordre du jour est
déterministe** : `seedSalt` + le jour UTC fiable + l'UUID du compte + le rang du bloc, par le même
générateur amorcé que le plateau de la Mine Pick — deux comptes ne partagent donc jamais la même séquence,
et un rechargement **reprend le bloc en cours** avec ses coups déjà portés (seul `clicks` est stocké, le
bloc est recalculé). Seul le **butin** est tiré en direct (`MiningManager.random`, fourni par `crypto`
quand il existe). Un bloc cassé s'écrit dans **une seule transaction** (état de la mine + solde de Sparks,
tous deux dans `user_state`) : un échec ne peut pas consommer le coup sans accorder le butin.

**Ressources.** Chaque récompense non-Sparks a un identifiant stable dérivé de son `Type`
(`"Stone Dust"` → `stone_dust`), qui sert à la fois de clé de sauvegarde, de nom de texture
(`assets/img/dusts/<slug>.png`) et de clé de traduction (`mineblock.resource.<slug>`, avec repli sur le
`Type` brut si la traduction manque). La liste des pastilles est celle **déclarée** par le fichier : une
ressource jamais récoltée s'affiche à `0` plutôt que de disparaître. Les **Sparks n'y figurent pas** :
c'est la monnaie, elle a son compteur dans l'en-tête (et ses toasts à la casse) — la liste est celle des
matières que l'inventaire sert à échanger.

**Inventaire.** Sous les ressources, un **coffre** (`assets/img/chest.webp`, une image **animée**) est le
seul bouton de cette zone : il ouvre une **popup** listant chaque ressource avec son icône, son **nom** et
sa quantité — c'est là, et nulle part ailleurs, que les noms sont écrits. Le coffre ne bouge **pas** au
repos : la vue dessine une fois sa première image sur un canvas et l'affiche à la place du fichier animé,
puis remet le fichier animé le temps d'**une** lecture à chaque clic (un second clic relance l'animation
au lieu d'empiler les minuteries). Si le gel échoue, le coffre s'anime simplement tout le temps : une
régression cosmétique, jamais un contrôle cassé.

**Statistiques.** `blocksMined` compte les blocs cassés **par sorte**, `resources` la quantité récoltée et
`sparksFound` les Sparks trouvés. Le panneau « Mine » de la page Statistiques affiche l'allowance du jour,
une barre par sorte de bloc (y compris celles jamais rencontrées, à 0 — c'est un catalogue) et les
ressources récoltées — toutes, à 0 compris, dans l'ordre de la configuration ; une ressource que la
configuration ne déclare plus mais que la sauvegarde contient encore est ajoutée en fin de ligne.

**Marchand itinérant.** Le bouton en haut à droite — son icône `assets/img/wanderingtrader.png`, puis son
libellé — ouvre la **boutique de la semaine** : des cartes s'achètent avec les ressources de la mine
(`js/business/TraderManager.js`). Un seul dialogue est ouvert à la fois : ouvrir l'inventaire ferme le
marchand, et l'inverse. **L'image d'une offre est un bouton** : elle ouvre le détail de la carte
(illustration en grand, description, prix complet avec ce qui manque, stock) dans un second dialogue
**empilé au-dessus** de la boutique, qui reste ouverte derrière (`Échap` ferme d'abord le détail).

**Deux horloges.** La boutique affiche le **temps restant avant le reroll** (le lundi suivant à
00:00 UTC, donc le lundi de la boutique plus sept jours) et chaque **offre épinglée** son propre
compte à rebours jusqu'à la fin de sa fenêtre (le dernier jour de `Period.Max`, à minuit UTC). Les deux
sont retranscrits chaque seconde depuis `CLOCK_TICK` ; sans heure UTC fiable, ils affichent un
placeholder plutôt qu'une échéance inventée. Une offre épinglée est aussi mise en avant : bordure
d'accent, halo et pastille « Offre épinglée », puisqu'elle est écrite à la main, rare et limitée.

**La même boutique pour tout le monde.** Le tirage de la semaine est amorcé par la seule **date du lundi**
de la semaine courante (jour UTC fiable de `DateSyncManager`, jamais `Date.now()`, et **pas** l'UUID du
compte) : deux joueurs voient donc les mêmes cartes aux mêmes prix, un rechargement ne les change pas, et
la boutique **se reroll toute seule le lundi à minuit UTC** (c'est `week` qui suit). La composition est
celle de `shop.offers` (deux cartes de rareté 1, une de rareté 2, une de rareté 3, une de rareté 4) : les
cartes d'une rareté sont **mises en commun depuis toutes les extensions chargées** (les promos sont
exclues : elles ne se tirent jamais, une offre épinglée est la seule façon d'en vendre une) et aucune
carte n'apparaît deux fois dans la boutique de la semaine.

**Le prix.** Une carte se paie en **exactement trois** sortes de ressources, et le prix vaut **au centime
près** la valeur de sa rareté (`shop.rarityValues` / `shop.itemsValues`, lus dans la même unité). Les trois
ressources sont tirées au sort (distinctes), puis toutes les quantités qui paient la cible exactement sont
énumérées — la moins chère absorbe le reste, donc elle doit le diviser — et l'amorçage choisit parmi les
trois combinaisons les plus sobres : jamais de montagne d'une même poussière pour une carte, toujours le
compte juste, et un tirage sans solution (une ressource qui vaut plus que la cible) est simplement
remplacé par un autre. Une ressource que `itemsValues` nomme mais que la mine ne récolte pas ne peut
donc **jamais** être demandée.

**Ce qu'on peut acheter.** `shop.allItemsUniques` décide si une offre se rachète : à `true` une offre
achetée est **épuisée jusqu'au lundi suivant** ; à `false` la boutique la revend tant que le joueur a les
ressources. Les **offres épinglées** de `data/shop/pinned_offers.json` ne sont jamais aléatoires : chacune
porte sa carte (`Index`, avec `isPromotional` pour une promo), son prix (autant de lignes qu'elle veut,
en noms de ressources), ses dates d'entrée et d'expiration (`Period`) et son stock (`MaxUse`). Les deux
familles d'offres sont dessinées par la même vue, dans la même liste, les épinglées en tête.

**Les échanges du jour.** Sous les offres, la boutique affiche `shop.tradesPerDay` **échanges de
ressources** (trois par défaut), tirés de la seule **journée UTC** : tout le monde voit les mêmes, et
ils changent à minuit UTC (compte à rebours affiché). Un échange est une **équation** : le côté le plus
cher compte **un** exemplaire, l'autre autant d'exemplaires que `shop.itemsValues` l'exige, donc les deux
côtés valent exactement la même chose et `2 Ultima contre 4 Void Dust` ne peut jamais être écrit à la
place de `1 contre 2`. Une paire dont les valeurs ne se divisent pas (`Glowstone Dust` à 20 contre
`Void Dust` à 50) n'a pas d'échange en unités entières : elle est retirée au sort et remplacée, tout
comme une paire déjà proposée le même jour. Chaque échange se prend **dans les deux sens** (on donne
l'un ou l'autre côté) et **une fois par jour** (`tradeUses`) ; les deux mouvements et ce compteur
s'écrivent dans la même transaction que l'échange lui-même.

**Un achat, une transaction.** Le prix (les ressources de la mine), la ligne de collection et le compteur
d'achats s'écrivent dans **une seule** transaction : un échec ne peut ni débiter sans donner la carte, ni
donner la carte sans débiter. Le reroll est évalué **dans** la transaction, donc un achat lancé juste
après le changement de semaine ne peut pas consommer le stock de la précédente. La carte achetée est
annoncée par `CARDS_OBTAINED` (`source: 'trader'`) comme toute carte obtenue — trophées, expérience et
notifications suivent — et les ressources dépensées par `MINING_UPDATED`, ce qui fait vivre les pastilles
de la mine et la page Statistiques.

### G septies. Titres de joueur (Titre)

Le **titre** est la ligne affichée **sous le pseudo**, sur la page Profil : en **jaune**
(`--color-title`, une valeur par palette) et dans la police pixel **Press Start 2P**
(`css/fonts.css` : les deux sous-ensembles latin auto-hébergés, préchargés par `sw.js`, donc lisibles
hors-ligne). Il est **facultatif** : là où l'avatar montre toujours quelque chose (au pire l'initiale
du pseudo), aucun titre ne peut être affiché, et « Aucun titre » reste un choix explicite de la page
Titre même quand dix titres sont débloqués.

Deux sources, deux conditions (`js/business/TitleManager.js`) :
- les titres de **niveau** (`settings/default_titles.json`) : `{ id, requiredLevel, text: { fr, en } }`,
  débloqués quand le niveau atteint `requiredLevel` ;
- les titres de **collection** (`data/titles/<setId>.json`) : chacun est donné par **un** trophée de
  collection et porte son propre texte (`CollectionTitle[].UnlockedTitle[]`). Un trophée est désigné
  par son extension et son `Name`, jamais par un identifiant fabriqué, exactement comme les icônes.

Un titre est désigné par son **`id`** partout : le profil ne stocke que lui
(`user_state["profile"].title`, validé par `ProfileManager` contre le catalogue), et les textes sont
résolus dans la langue active au moment du rendu.

**Le déblocage n'est pas stocké** : il est **dérivé** (`TitleManager.listTitles({ trophyState })`),
puisqu'un niveau ne redescend jamais et qu'un trophée ne se reprend jamais. `TITLE_UNLOCKED` n'existe
donc que pour l'**annonce** : le manager garde en mémoire les titres déjà annoncés, `app.js` amorce cet
ensemble à l'ouverture (`notify: false`), puis il suit `TROPHY_UNLOCKED` et `EXPERIENCE_UPDATED`. Une
sauvegarde qui débloque dix titres au chargement ne dit donc rien, comme pour les trophées, et
`GameNotifier` transforme l'événement en notification (police pixel, en jaune, dans sa propre famille
`data-type="title"`).

La page **Titre** (`data-view="titles"`, `js/UI/views/TitlesView.js`) affiche **un élément par
ligne**, groupés par source (le niveau, puis une section par extension) : la ligne « Aucun titre »
d'abord, puis les titres, chacun écrit dans la police où il sera porté — la page est donc son propre
aperçu. Un titre **débloqué** se sélectionne d'un clic (aucun bouton « Enregistrer » : un titre est un
choix, pas un formulaire) ; un titre **verrouillé** est **grisé**, non cliquable, et porte le bouton
**« Voir la condition de déblocage »**. La modale montre alors soit le niveau requis et le niveau
courant, soit — pour un titre de collection — le **détail complet du trophée** à obtenir
(`TrophyDetail.buildDetailBody`), cartes requises et récompenses comprises.

Sur la fiche d'un trophée de collection, les titres qu'il donne sont affichés **à côté des avatars**
(section « Titres débloqués »), en police pixel et en jaune quand le trophée est débloqué, grisés
sinon : on lit ce qu'un trophée rapporte avant de le compléter.

### G octies. Carte de profil (Carte de profil)

Sous « Trophées mis en avant » et « Cartes favorites », la page Profil affiche la **carte du joueur** :
le compte lui-même, dessiné comme une carte à collectionner avec le générateur de `external/cardmakerz/`.
Rien n'est stocké : la carte est une **projection** du profil, recalculée à chaque rendu
(`js/business/ProfileCardManager.js`), donc elle ne peut pas contredire la page qui la porte.

- **Nom :** le pseudo (`profile.name`), « Joueur anonyme » s'il n'y en a pas.
- **Série :** `<titre> #<numéro>`, où le titre est celui porté sous le pseudo (à défaut, le mot
  « Profil ») et où le numéro est constitué des **`profileCard.seriesDigits` derniers caractères de
  l'UUID** du compte, tirés une fois pour toutes. Toute la ligne — titre **et** numéro — est écrite
  en **jaune** (`--color-title`, la couleur d'un titre sur la page Profil) : c'est le couple
  pseudo/titre de la page qui se retrouve sur la carte.
- **Rareté (`★` … `💎`) :** le **nombre de trophées débloqués** la donne, par paliers déclarés dans
  `settings/config.json` (`profileCard.rarityThresholds`, `_comment` compris). La carte prend la
  rareté la **plus haute** atteinte, donc un compte neuf est Commune. Un palier absent, malformé ou
  plus bas que le précédent retombe sur la valeur livrée : une faute de frappe ne peut pas rendre une
  carte plus rare plus facile à obtenir. La ligne sous la carte annonce la rareté atteinte, le nombre
  de trophées et les trophées restants avant la suivante. Le joueur peut **choisir** la rareté portée
  parmi celles que ses trophées ont débloquées : une rareté verrouillée reste affichée, désactivée,
  avec la **médaille de trophée** et le compte `N / X` en rouge (N trophées débloqués, X requis).
  Rien n'est jamais accepté au-delà des paliers atteints, même dans une sauvegarde écrite à la main.
- **Illustration :** celle de la **première carte favorite** (l'ordre des épingles fait foi) ; sans
  favori, le dos de carte livré (`profileCard.defaultArtPath`). C'est le champ **`Background`** de la
  carte qui est lu, jamais son `Path` : `Path` est l'image de la carte **entière** (cadre, titre,
  description), qui dessinerait une carte dans la carte, tandis que `Background` est l'illustration
  seule, la même que celle qu'un binder prend pour fond. Un favori dont la carte a quitté le
  catalogue est sauté, jamais affiché vide.
- **Underlay :** l'**icône de profil** choisie (ou la `photo` d'une sauvegarde plus ancienne). Le
  générateur y place un sprite plein cadre ; ici l'avatar est **ancré au milieu de l'illustration, à
  hauteur de personnage** en Full Art, sans quoi un avatar carré masquerait le fond qu'il doit
  surmonter (la disposition normale le confine déjà à la bande centrale). Il est dessiné **20 % plus
  petit** que le sprite plein cadre du générateur (`auto 80 %` dans la bande centrale, `auto 32 %` en
  Full Art), pour laisser respirer l'illustration qu'il recouvre.
- **Description :** les trois trophées mis en avant, **en icônes et sur une seule ligne** (les noms
  seraient trois lignes rognées sur 360 pixels ; ils restent en infobulle et dans le libellé
  accessible), puis les compteurs : **boosters ouverts** (`user_state["stats"].boostersOpened`),
  **cartes différentes** possédées (promos comprises), date de la **plus ancienne carte** obtenue,
  **Sparks en banque** (`user_state["sparks"]`), **blocs minés** (`mining.totalMined`) et **Mine Pick
  faits** (`minePick.totalPicks`).
- **Deux dispositions** : « Normale » (bandeau du nom en haut, bloc de description en bas, illustration
  entre les deux) et « Full Art » (illustration pleine carte). Elles sont celles du générateur
  (`card-layout-classic` / `card-layout-fullart`). En Full Art, le bloc de description est assombri :
  posé sur la photo d'une carte favorite, un panneau translucide rendrait les compteurs illisibles.
- **Full Art est une fonctionnalité à acheter :** `features.items.cardLayoutFullArt.priceSparks`
  (1000 Sparks par défaut) dans `settings/config.json`, débit et achat écrits dans **une seule**
  transaction (`FeatureManager`). Tant qu'elle n'est pas possédée, le bouton affiche un **cadenas** et
  le prix avec l'icône de Sparks ; le cliquer ouvre une **confirmation** (prix, solde) au lieu de
  changer de disposition, et un solde insuffisant affiche le refus et désactive « Acheter ». Après
  l'achat, la disposition **ne bouge pas** : c'est le clic suivant du joueur qui l'active. L'achat
  est définitif (pas de remboursement) et la fonctionnalité reste acquise dans la sauvegarde.
- **Couleur du titre :** la ligne `<titre> #<numéro>` porte une couleur choisie par le joueur. « Auto »
  (défaut, gratuit) prend la **couleur de la rareté de la carte** (`--rarity-title-color`, une valeur
  par classe de rareté), donc elle suit le joueur quand il change de rareté. Les sept autres couleurs
  (`gold`, `silver`, `crimson`, `emerald`, `azure`, `violet`, `rose`, palette
  `PROFILE_CARD_TITLE_COLORS`) s'**achètent en Sparks** : `profileCard.titleColors.defaultPriceSparks`
  (125 par défaut) s'applique à toute couleur sans prix propre, et chaque entrée de `items` peut le
  surcharger. Tant qu'une couleur n'est pas achetée, sa pastille est en pointillés avec son prix et un
  clic ouvre la **confirmation** (même modale que le Full Art, même transaction, même refus si le
  solde ne couvre pas) ; elle ne se sélectionne qu'une fois possédée, et l'achat ne change PAS la
  couleur portée. Le choix est enregistré dans `user_state["profileCard"].titleColor` ; une couleur
  non possédée (sauvegarde retouchée) retombe sur « Auto ». La couleur est appliquée en style
  **inline** sur la carte (`--card-title-color`), donc elle survit à l'export du PNG.
- **Voir et télécharger :** « Agrandir la carte » **déplace** la carte dans une modale (l'élément est
  déplacé, jamais reconstruit : disposition choisie et images déjà décodées suivent) et
  « Télécharger la carte » écrit un PNG de 720 × 1000, nommé d'après le numéro de série de la carte.

**Pourquoi une racine fantôme (`js/UI/components/ProfileCard.js`) :** la carte vient d'un outil qui a
ses propres règles CSS (`clip-path` des cadres, `mix-blend-mode` des foils, conic gradients, variables
de rareté, classes `.card-*` et `.rarity-*`). Ces règles saliraient le jeu et le jeu salirait la carte.
La feuille (`css/components/profile-card.css`, adaptée du générateur) est **récupérée puis injectée**
dans la racine fantôme, et c'est **ce même texte** qui est intégré à l'image exportée : l'aperçu et le
PNG ne peuvent pas diverger.

**Pourquoi un rasteriseur maison :** `html2canvas` (utilisé par le générateur en repli) ne sait peindre
ni `clip-path`, ni `mix-blend-mode`, ni les conic gradients, c'est-à-dire exactement ce dont une carte
est faite. La carte est donc sérialisée dans un SVG `foreignObject`, chargé comme image puis dessinée
dans un canvas, technique du générateur (`external/cardmakerz/js/render/SvgDomRenderer.js`). Un document
SVG chargé en image ne peut atteindre **aucune** ressource externe : la feuille, les deux illustrations
et les fichiers de police sont donc **incorporés en data URLs** (`css/fonts.css` inclus, sans quoi
« Press Start 2P » retomberait sur une police système et le PNG ne ressemblerait plus à l'aperçu).

### G nonies. Illumination (réglage « Illumination » / « Glow »)

Le panneau **Illumination** des Paramètres règle la force des halos, effet par effet : aujourd'hui les
**trophées**, demain les cartes. Chaque effet a son propre bloc dans `settings/config.json` (`glow.trophies`
aujourd'hui, `glow.cards` plus tard) avec ses bornes `{ min, max, step, default }` : `min: 0` éteint
l'effet, `max: 5` est le plus fort, le défaut est 2. Un niveau hors bornes est **ramené dans la plage**,
jamais rejeté.

`js/utils/GlowManager.js` publie le niveau sous forme de **facteur** `--trophy-glow-scale` sur `<html>`
(le niveau 2, référence, vaut 1 ; 0 vaut 0). Les halos sont entièrement décrits par la rareté du
trophée dans les feuilles (rayon et couleur), et multiplient ce rayon par le facteur : un seul
curseur règle donc la liste des trophées, les trophées épinglés du profil et les médailles de la carte
de profil. La préférence vit dans `user_state["settings"].glowTrophies` (`AccountManager`), appliquée
au démarrage comme le foil. La carte de profil reçoit en plus le facteur **en style inline**
(`ProfileCard.renderGlow`) : le document exporté n'a pas de `<html>` à hériter, et le PNG montre donc
les mêmes halos que l'aperçu.

### H. Distributions (cadeaux via Google Sheet)
- Source : le CSV du Google Sheet, dont l'URL est configurée dans `settings/config.json`.
- Une ligne = un cadeau : `uuid`, `type` (`booster`|`card`), `key`, `quantity`. La colonne `key` identifie le cadeau : l'identifiant du set pour un `booster` (ex. `set1`), la clé unique de la carte pour une `card` (ex. `042_fullart`). Voir Étape 8.
- Dans Paramètres, "Vérifier les distributions" télécharge le CSV et ne traite que les lignes **postérieures à `lastCheckedLine`** dont l'UUID correspond à celui du compte. Un `uuid` valant `*` adresse la ligne à **tous** les comptes (Étape 9).
- Chaque cadeau traité est enregistré dans `gifts_received` avec son **numéro de ligne comme clé** : impossible de le récupérer deux fois.
- `lastCheckedLine` est mis à jour à la fin du traitement, dans la même transaction que les récompenses.
- Une interface indique ce qui a été reçu, ou "Aucun cadeau".

### H bis. Binders (pages personnelles & partage)
- **Ce qu'est un binder :** une page **nommée** de **30 emplacements** (3 cartes par ligne, **toujours**), rangée sous la clé `user_state["binders"]` (`js/business/BinderManager.js`). C'est une **vitrine**, pas une allocation : la même copie possédée peut figurer dans autant de binders que voulu. La seule règle est **par binder** : une page ne peut pas montrer une carte plus de fois que le joueur n'en possède de copies (1 copie → une fois, 2 copies → deux fois).
- **Accès :** le **compteur de l'en-tête** (icône `assets/img/binders.png`, puis le nombre de binders) et le **bouton « Binders »** de l'en-tête de la collection ouvrent la même liste ; le compteur suit `BINDERS_UPDATED`, donc une création ou une suppression le met à jour sans recharger la page (`js/app.js` : `renderHeaderBinders`, `openBinders`).
- **Création / modification :** une popup liste les binders (chaque ligne : sa vignette, son nom, son remplissage, puis **Ouvrir**, **Partager** et **Supprimer**), une seconde popup édite la page — nom, **carte représentative**, et les 30 emplacements cliquables — et une troisième sert de **sélecteur de carte** (recherche, copies encore disponibles, carte de l'emplacement courant toujours sélectionnable). L'édition est un **brouillon** : rien n'est écrit avant « Enregistrer », donc une popup fermée ne laisse jamais une demi-page stockée. Un emplacement vidé n'est pas une carte manquante : c'est un trou du gabarit.
- **La ligne « créer » est une tuile, pas un bouton :** le dernier élément de la liste est un **cadre en pointillés, à la forme et à la hauteur d'une ligne de binder**, avec un **gros « + »** au centre (`CollectionView.buildBinderCreateTile`, `.binders__create` dans `css/views/binders.css`). Un clic ouvre le formulaire de création. Au plafond du niveau, la tuile reste affichée mais **désactivée**, son infobulle disant pourquoi : un joueur doit voir où l'on crée un binder, même le jour où il ne peut pas encore en créer un.
- **Le sélecteur montre CINQ cartes par ligne** à partir de 768 px, trois sur un téléphone — la même grille que la collection. Le sélecteur était déclaré `display: grid` depuis le début sans jamais l'être : `.modal__body` (`css/components/modal.css`) est un conteneur flex en colonne, feuille chargée **après** `binders.css`, donc à spécificité égale son `display: flex` gagnait et les cartes s'empilaient une par ligne. Le sélecteur est désormais nommé `.modal__body.binder-picker` (deux classes), ce qui le place au-dessus quel que soit l'ordre des fichiers.
- **La carte représentative ne consomme pas de copie :** elle n'occupe aucun emplacement, elle ne fait que prêter le `Background` de sa carte à la page (« c'est juste récupérer un fond », côté joueur). Le budget de copies d'un binder ne porte donc que sur les **cartes placées dans les emplacements** : `BinderManager.validateSlots()` ne lit que les `slots`, `reconcile()` ne rogne que les `slots`, et `renderBinderPicker()` ne retire plus les placements existants quand la cible est la **carte représentative**. Un joueur peut donc choisir comme représentante une carte déjà rangée dans un emplacement, même s'il n'en possède qu'une copie — ce que le sélecteur d'un **emplacement** continue de refuser (la règle par binder y reste entière).
- **Carte représentative & décor :** le fond de la page est le **`Background`** de la carte représentative (voir 3.D). Il est publié en `--binder-backdrop` par la vue, jamais codé en dur dans la feuille : le CSS ne fait que le peindre quand la variable existe, et un binder sans représentant n'a simplement pas de décor.
- **Limite :** le joueur a autant de binders que son **niveau** (`BinderManager.getLimit()` lit le niveau évalué par `TrophyManager`). Le bouton « Créer » est désactivé au plafond, et le gestionnaire refuse quand même la création (code `BINDER_LIMIT_REACHED`).
- **Vente d'une carte :** seul évènement qui puisse invalider une page. `BinderManager.reconcile()` retire les placements excédentaires **par binder**, en commençant **par l'emplacement le plus lointain** (l'index le plus haut) : les premières lignes rangées survivent. Appelé après chaque vente depuis la collection, et à l'ouverture de la liste (auto-réparation après un import).
- **Ouvrir :** le bouton **« Ouvrir »** de chaque ligne de la liste (`CollectionView.openBinderInNewTab()`, à côté du partage) ouvre la page en **lecture seule** du binder (`collection.html?code=…`) dans un **nouvel onglet**. L'onglet est réclamé **avant** tout `await` (`window.open('about:blank', '_blank')` puis affectation de `location.href`) : un navigateur refuse un `window.open()` déclenché après une attente, et lire un binder est asynchrone par nature. Rien n'est copié dans le presse-papier — ouvrir et partager sont deux intentions distinctes — et un onglet bloqué est signalé par un message.
- **Partage :** le bouton **« Partager »** existe à deux endroits — dans l'éditeur (brouillon) et **sur chaque ligne de la liste** (icône dessinée en SVG, à côté de la suppression) : les deux passent par `CollectionView.shareBinder()`, qui génère un **code** auto-suffisant encodant l'identité de l'auteur (nom, icône), le nom du binder, sa carte représentative, la **liste des cartes** et les **données maîtresses** de chacune (`id`, style, rareté, extension, illustration, noms, `Background`), plus le **nom d'affichage des extensions** employées (`sets`, champ optionnel : un code plus ancien s'en passe et la page retombe sur l'identifiant brut). L'**URL complète** `collection.html?code=…` est ensuite copiée. L'identité encodée est celle du profil : le nom, l'icône choisie (chemin du catalogue) **et** la `photo` de secours d'une sauvegarde plus ancienne, pour qu'un auteur qui n'a jamais choisi d'icône montre quand même son image.
- **Format du code** (`js/utils/BinderCode.js`, sans aucune dépendance applicative) : JSON → `deflate` → Base64 URL-safe, comme un `.save`. Le JSON d'une page complète fait quelques kilo-octets très répétitifs ; le deflate le ramène à l'ordre du kilo-octet, ce qui garde le lien collable. Une version (`v: 1`) est estampillée pour qu'un format futur soit reconnu plutôt que mal lu.
- **Page de lecture (`collection.html` + `js/binder-share.js`) :** page **autonome et en lecture seule**. Elle ne charge ni compte, ni base, ni catalogue, ni moteur : tout ce qu'elle affiche vient du code. La langue des noms et le `<lang>` des illustrations sont résolus d'après celle du visiteur, et les lignes vides de fin sont rognées (un binder de cinq cartes est une page de deux lignes, pas trente carrés).
  - **Identité :** la **photo et le pseudo** de l'auteur (portés par le code) sont affichés en pastille au-dessus du titre. La pastille est **toujours** rendue dès qu'un code a été lu : un code écrit avant que le payload ne porte l'auteur, ou partagé par un compte sans nom ni avatar, montre le **point d'interrogation** de la page Profil du jeu et le libellé que le jeu emploie déjà (`profile.anonymous`, « Joueur anonyme »). Elle reste `hidden` dans le balisage, donc la page d'erreur (qui n'a aucun auteur à montrer) n'affiche pas de pastille vide.
  - **Mise en page :** le panneau est **centré horizontalement** sur tout écran (`align-items: center` sur un corps en colonne : `justify-content` centre l'axe vertical, pas l'axe horizontal).
  - **Détail d'une carte :** un emplacement rempli est un **`<button>`** ; un clic ouvre une modale (`css/components/modal.css`, déjà chargée par la page) avec l'illustration et quatre lignes — rareté, style, extension, numéro. Fermeture par la croix, le voile ou Échap.
  - **Brillance & foil :** les emplacements et l'illustration de la modale sont habillés par `js/utils/Shine.js` (`applyShine`), le module **sans aucun import** où vivent désormais les deux helpers extraits de `CardComponent` — c'est ce qui permet à la page de peindre un foil sans embarquer le jeu. `css/components/card-shine.css` est chargée par la page pour cela, et elle y trouve `--card-ratio` via `css/base.css`.

### I. PWA (installation & jeu hors-ligne)
- **Fichiers :** `manifest.json` (nom, icônes, scope) et `sw.js` (service worker), tous deux à la racine ; `index.html` les déclare (`<link rel="manifest">`, meta iOS, enregistrement du worker après `load`).
- **Chemins absolus :** `id`, `start_url`, `scope` et les icônes portent le sous-dossier servi, `/projets/minecards/`. Conséquence : le jeu doit être servi depuis ce sous-dossier pour être installable et contrôlé par le worker — lancé à la racine du domaine (`start_server.cmd`), le worker s'enregistre sans jamais contrôler la page et l'installation est refusée.
- **Stratégies :** precache du *shell* à l'installation (HTML, CSS, modules, réglages, catalogue, dos de carte, sons, modèle 3D, Three.js épinglé) ; navigation *network-first* avec repli sur `index.html` ; assets same-origin en *stale-while-revalidate* ; CDN (unpkg) en *cache-first*. La revalidation lit **les deux** caches, le runtime d'abord (copie la plus fraîche) puis le shell : sans ce repli, une installation fraîche suivie d'un passage hors-ligne sans rechargement ne trouverait rien, puisque le cache d'exécution est encore vide.
- **Jamais mis en cache :** les requêtes `no-store`/`reload`/`no-cache` (rafraîchissement des paramètres, des cadeaux et des codes), les requêtes `Range`, le cross-origin hors CDN (API de temps, Google Sheet), le worker lui-même et les fichiers privés (`admin/`, `useritem_codes.csv`, `.docs/`).
- **Couverture :** tout le jeu démarre hors-ligne dès la première installation, sans rechargement intermédiaire (vérifié serveur coupé, cache d'exécution vide). En revanche les illustrations (`cards/`, 374 Mo) et les visuels de boosters ne sont mis en cache **qu'à l'usage** : une carte jamais affichée n'a pas d'image hors-ligne.
- **Mise à jour :** incrémenter `VERSION` dans `sw.js` à chaque changement du shell ; seuls les caches préfixés `minecards-` sont purgés, ceux des autres projets de l'hôte sont laissés intacts.

### J. Qualité du code (linter)

Le projet n'a ni bundler ni transpileur : rien ne relit les sources entre l'éditeur et le
navigateur. `tools/lint.mjs` (aucune dépendance, aucun `npm install`) est cette étape-là, et c'est
lui qui fait tenir l'unité du code :

```
npm run lint          # tout vérifier (sortie en erreur dès la première erreur)
npm run lint:fix      # corriger ce qui peut l'être sans arbitrage, puis vérifier
npm run lint:strict   # les avertissements comptent comme des erreurs (ce qu'une CI doit lancer)
lint.cmd              # la même chose depuis Windows, sans npm (double clic)
node tools/lint.mjs --only i18n/ --json
```

Deux niveaux, et rien d'autre : **erreur** (le projet est cassé ou incohérent aujourd'hui, la
vérification échoue) et **avertissement** (quelque chose est attendu et pas encore là, le jeu s'en
sort tout seul : une médaille absente retombe sur `assets/img/trophy/default.png`, une illustration
référencée par un fichier de données est masquée). Aucun mécanisme de silence n'existe : une règle
qui ne correspond plus au projet se corrige ou se supprime, elle ne se met jamais en sourdine.

Les 23 règles couvrent : l'hygiène de tous les fichiers texte (BOM, fins de ligne mélangées, espaces
en fin de ligne, saut de ligne final, tabulations, JSON invalide ou clé déclarée deux fois) ; le
JavaScript (`node --check`, en-tête documentaire de module, bloc de documentation par fonction et
méthode, `var`/`==`/`console.log`/`debugger`, imports qui ne résolvent pas ou en double) ; les
traductions (parité des clés entre langues, placeholders identiques, aucun tiret cadratin dans un
texte lu par le joueur, clé utilisée mais non déclarée, clés composées par le catalogue des trophées) ;
les feuilles de style et les pages (classes BEM, `!important` réservé à ses deux exceptions, `id`
unique par page, aucun `onclick`) ; et les chemins (`assets/` cité mais absent, liste de precache du
service worker, médailles attendues par le catalogue).

Détail des règles, architecture et recette pour en ajouter une : `tools/lint/README.md`.

---

## 4. Plan de Développement Étape par Étape
1. **Étape 1 :** HTML SPA, CSS global + thèmes, `StorageRepository`, i18n, compte local & onboarding.
2. **Étape 2 :** `DateSyncManager` + quota (quotidien + bonus).
3. **Étape 3 :** `GachaEngine`, `BoosterManager`, JSON.
4. **Étape 4 :** Ouverture 3D + retournement des cartes.
5. **Étape 5 :** Collection & Statistiques.
6. **Étape 6 :** Import/export `.save` + vue Paramètres (langue, thèmes, compte).
7. **Étape 7 :** Redeem + finitions mobile.
8. **Étape 8 :** Distributions (Google Sheet) + historique des cadeaux.

Commence directement par l'Étape 1.

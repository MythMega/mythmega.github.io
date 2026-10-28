# 2. Fonctionnalités

Ce document décrit **tout ce que l'application sait faire**, fonctionnalité par fonctionnalité. Pour
chaque sujet : le but, les points d'entrée, les règles, les données écrites et les cas limites.

Sommaire :

1. Compte local et écran d'accueil
2. Heure UTC, quotas quotidiens et hors-ligne
3. Moteur gacha
4. Ouverture d'un booster
5. Collection
6. Mine Pick
7. Mine
8. Marchand itinérant (Wandering Trader)
9. Sparks et achats
10. Binders et partage
11. Cartes promo
12. Codes (redeem et codes personnels)
13. Distributions (cadeaux)
14. Trophées, expérience et niveau
15. Titres de joueur
16. Profil et carte de profil
17. Notifications de jeu et toasts
18. Statistiques
19. Informations
20. Paramètres
21. Overlay de stream
22. PWA et hors-ligne
23. Outils annexes (admin, gamemaster)

---

## 1. Compte local et écran d'accueil

**But.** Aucun serveur : « créer un compte » signifie initialiser localement la base et générer un
UUID.

- Au démarrage, si `user_state["account"]` existe → l'application démarre normalement. Sinon →
  écran d'accueil (`js/UI/views/OnboardingView.js`) avec deux choix :
  1. **Créer une nouvelle sauvegarde** : génère un UUID v4 (`crypto.randomUUID()`), écrit
     `account = { uuid, createdAt }`, initialise `settings`, `quota`, `stats`, `giftSync`, `sparks`
     et appelle `navigator.storage.persist()` pour limiter le risque d'éviction.
  2. **Importer une sauvegarde `.save`** : restaure tout, dont l'UUID d'origine (voir
     `database.md`).
- L'écran d'accueil propose aussi le choix de la langue avant la création du compte ; le miroir
  `localStorage` est utilisé pour l'appliquer sans flash.
- Le **reset complet** supprime toutes les données, UUID compris, puis recharge la page : retour à
  l'écran d'accueil.
- L'UUID est **immuable** et visible/copiable dans les Paramètres (il sert à recevoir des cadeaux).
- Un identifiant v4 est validé partout (`UUID_V4_PATTERN`) ; un UUID invalide dans un `.save`
  provoque un refus de l'import.

## 2. Heure UTC, quotas quotidiens et hors-ligne

**But.** Toutes les remises à zéro (boosters, pioches, blocs, échanges) sont alignées sur
**minuit UTC**, sans faire confiance à l'horloge système.

- Source : liste ordonnée de fournisseurs dans `timeSync.providers` de `config.json`
  (`timeapi.io`, `cloudflare.com/cdn-cgi/trace`, l'en-tête `date` de `index.html`,
  `worldtimeapi.org`), avec `requestTimeoutMs` (4000) et `resyncIntervalMs` (900000 = 15 min).
- **`Date.now()` n'est jamais utilisé.** Le temps courant est estimé par
  `apiUtcMs + (performance.now() − perfNow)`.
- Hors-ligne dans la même session de page : l'estimation par `performance.now()` reste valable.
- Hors-ligne après rechargement : le temps est **figé** à `lastKnownUtcMs` ; aucun reset n'est
  possible tant que l'API n'a pas répondu.
- Le temps estimé ne recule jamais (`max` avec `lastKnownUtcMs`).
- **Quota boosters** : `boosters.dailyFreeBoosters` (3) boosters gratuits par jour, valables pour
  n'importe quelle extension. S'ajoutent `bonusBoosters` (par extension, cadeaux/codes) et
  `purchasedBoosters` (achetés en Sparks, globaux, jamais remis à zéro). Ordre de dépense :
  quotidien → bonus de l'extension → achetés.
- Les compteurs sont exposés à l'en-tête par `QUOTA_UPDATED`, et l'heure par `CLOCK_TICK`.
- Sans heure fiable, les vues affichent un placeholder (`--:--:--`) et désactivent ce qui dépend
  d'un reset.

## 3. Moteur gacha

`js/business/GachaEngine.js`, pur et sans état.

- Un booster contient `boosters.cardsPerBooster` cartes (5).
- Probabilités par emplacement lues dans `boosters.rarityConfigPath`
  (`settings/defaultRarity.json`) ; une extension peut surcharger sa table dans son fichier.
- Une fois la rareté R tirée, la carte est tirée au hasard parmi les cartes de rareté R de
  l'extension.
- Doublons autorisés dans un même pack.
- **Godpack** : `boosters.godpackChancePercent` (0,5 %) — le pack entier est alors composé des
  raretés hautes selon la table.
- Les tirages sont déterministes dans les fonctionnalités qui seedent le générateur (Mine Pick,
  Mine, Marchand) et libres (`crypto` quand disponible) pour l'ouverture réelle et le butin.

## 4. Ouverture d'un booster

Vue : `js/UI/views/OpeningView.js`. C'est l'écran par défaut.

**Séquence.**

1. **Écran de sélection** : combo d'extensions, flèches de navigation, aperçu 3D du booster
   sélectionné, quota restant, compte à rebours de reset si vide, bouton d'ouverture (ou achat).
2. **Tirage et persistance avant l'animation** : `BoosterManager.openBooster()` écrit les cartes,
   les statistiques, l'historique et la récompense en Sparks dans **une seule transaction**. Si le
   joueur ferme l'onglet pendant la révélation, il ne perd rien.
3. **Scène** : le booster 3D (ou l'image 2D de secours) tourne, se fait tourner au doigt/souris, et
   s'ouvre sur un tap ou un swipe vers le haut.
4. **Projecteur** : une grande carte face cachée à la fois ; un clic/tap (ou swipe gauche) la
   retourne, puis avance sans la remettre face cachée ; « Précédent » revient en arrière.
5. **Résumé** : les 5 cartes en grille, chacune ouvrant sa fiche (illustration, nom, rareté, statut
   nouvelle/possédée) ; « Terminer » ne fait **aucune écriture** ; « Copier le code du booster »
   met un code `minecards:<base64url>` dans le presse-papier.

**Règles.**

- Ordre de dépense : `dailyRemaining`, puis `bonusBoosters[setId]`, puis `purchasedBoosters`.
- Quand tout est épuisé, le bouton propose d'acheter un booster pour
  `boosters.extraBoosterPriceSparks` (1500 Sparks). L'achat et le crédit sont atomiques
  (`BoosterManager.buyExtraBooster`) ; le booster acheté survit au reset et est dépensé en dernier.
  L'achat enchaîne directement sur l'ouverture ; un solde insuffisant désactive le bouton et
  montre le manque.
- **Code de partage** : `js/utils/BoosterCode.js` encode l'extension et la position de chaque carte
  dans le tableau `Cards` (pas la carte entière), pour rester sous ~150 caractères.
- **Aperçu 3D** : scène non interactive qui tourne seule ; changer d'extension change la texture.
  La scène est réutilisée pour l'ouverture (voir `01-architecture.md` §1.8).
- **Mode focus** : pendant le rituel, la marque, les compteurs, la barre du bas, l'aide de page et
  le titre de la vue sont masqués (`body.is-focus`, `js/utils/FocusMode.js`).
- **Cas limite** : sortir de la scène avec `Échap` déclenche `REVEAL_FINISHED` pour que les
  notifications des cartes non retournées ne soient pas perdues.

## 5. Collection

Vue : `js/UI/views/CollectionView.js`, catalogue via `CollectionManager`.

- Grille de toutes les cartes du catalogue, **silhouettes grisées** pour les manquantes.
- **Filtres & tri** dans une popup : extensions (multi), raretés (multi), famille Promo, statut
  (toutes / possédées — défaut / manquantes / vendables), style, et tri (index du fichier par
  défaut, numéro, rareté, style, quantité possédée, date d'obtention) avec sens.
- **Bouton cœur** sur les cartes possédées : `profile.defaultFavorites` (3) favoris au départ, puis
  jusqu'à `profile.maxFavorites` (5) avec les emplacements achetés. Une tentative alors que la liste
  est pleine propose d'acheter le slot suivant, puis rejoue le cœur.
- **Fiche d'une carte** : détail, vente/achat, favori, code (mode développeur).
  - Vendre un exemplaire crédite `sparks.sellPrice[rarity]`.
  - Acheter un exemplaire coûte `sparks.buyPrice[rarity]`.
  - Le dernier exemplaire ne peut pas être vendu ; `Maj+S`/`Maj+V` vendent tous les doublons en
    laissant une copie.
- **Numérotation** : chaque entrée porte `cardId` (champ `Index`, « SERIE-A1 / W001 ») et `index`
  (position dans le tableau `Cards` du fichier). Le tri par numéro compare en `numeric: true`
  (`W2` avant `W10`).
- **Promos** : une promo non possédée n'apparaît pas ; le groupe n'apparaît qu'à la première copie
  obtenue ; aucune promo ne compte dans la complétion.
- **Binders** : bouton dans l'en-tête de la page ; un compteur de binders vit dans l'en-tête
  global.
- Toute vente retire les placements excédentaires des binders (`BinderManager.reconcile()`), en
  commençant par les emplacements les plus lointains.

## 6. Mine Pick

Vue : `js/UI/views/MinePickView.js`, état via `MinePickManager`. Onglet « Pick ».

- **Plateau quotidien** : `minePick.boosterCount` (10) boosters simulés, listés un par ligne avec
  leur texture, leur nom et leurs **cinq cartes face visible**.
- **Deux clics pour ouvrir** : le premier sélectionne la ligne (rien n'est consommé), le second
  l'ouvre. Évite de dépenser une pioche sur un frolement.
- **Pioches gratuites** : `minePick.picksPerDay` (3), remises à zéro à minuit UTC.
- **Après pioche** : la ligne reste avec la carte gardée (marquée « Gardée ») et un bouton
  désactivé ; les 10 lignes s'épuisent vraiment.
- **Mélange** : les cinq cartes se rassemblent au même point, l'ordre du DOM change pendant
  qu'elles sont empilées, puis elles repartent vers les emplacements — impossible de suivre une
  carte.
- **Rareté révélée tard** : l'anneau de rareté n'apparaît sur le plateau qu'avec `is-revealed`
  (après pioche), et sur la scène qu'avec `is-summary` (après le dernier retournement).
- **Déterminisme** : plateau et mélanges sont tirés de `minePick.seedSalt` +
  `minePick.setWeightExponent` + jour UTC + UUID du compte. Un rechargement redonne le même plateau.
- **Pioche achetée** : `minePick.extraPickPriceSparks` (1000 Sparks) une fois gratuit et bonus
  épuisés ; stockée dans `bonusPicks`, elle survit au reset et n'est dépensée qu'en dernier.
- La carte gardée est écrite avec l'état de la pioche dans **une seule transaction** et annoncée
  par `CARDS_OBTAINED` (source `minepick`) ; la feature ne touche jamais `stats`.

## 7. Mine

Vue : `js/UI/views/MineBlockView.js`, état via `MiningManager`, règles dans `settings/mining.json`.

- **Blocs du jour** : `mining.blocksPerDay` (50) blocs minés un par un. Le bloc courant s'affiche en
  grand au centre, avec son nom, le nombre de blocs restants et les ressources récoltées (icône +
  quantité ; les noms sont dans l'inventaire et le libellé accessible).
- **Coups** : chaque coup augmente la craquelure (table `Cracks` de `mining.json`, textures
  `assets/img/blocks/break/<n>.png`). Le nombre de coups restants n'est jamais écrit.
- **Casse** : le bloc disparaît, le butin « s'échappe » (un élément volant par unité), un toast par
  récompense, puis le bloc suivant arrive après `mining.nextBlockDelayMs` (100 ms).
- **Cinq sortes de blocs** décrites par `Weight` (fréquence), `Hardness` (3 à 30 coups) et
  `Rewards` (poussière garantie, Sparks parfois). Le chemin des textures et des sons est dérivé de
  l'id du bloc.
- **Déterminisme** : séquence du jour tirée de `mining.seedSalt` + jour UTC + UUID + rang du bloc.
  Un rechargement reprend le bloc en cours avec ses coups déjà portés (`clicks` seul est stocké).
- **Ressources** : chaque matière a un slug stable (`"Stone Dust"` → `stone_dust`), qui sert de clé
  de sauvegarde, de nom de texture et de clé i18n.
- **Inventaire** : le coffre (`assets/img/chest.webp`, animé) ouvre la popup listant chaque
  ressource avec son nom et sa quantité. Ouvrir l'inventaire ferme le marchand, et inversement.
- **Atelier du jour** (bouton « Marchand » en haut à droite) : voir §8.
- **Statistiques dédiées** : `blocksMined` (par sorte), `resources`, `sparksFound`, `totalMined`.
- Une casse s'écrit avec le solde de Sparks dans **une seule transaction**.

## 8. Marchand itinérant (Wandering Trader)

Vue : popup de `MineBlockView`, logique via `TraderManager`, réglages dans la section `shop`.

- **Boutique hebdomadaire** : composition `shop.offers` (2 cartes de rareté 1, 1 de rareté 2, 1 de
  rareté 3, 1 de rareté 4), cartes mises en commun depuis toutes les extensions chargées, jamais
  deux fois la même. Le tirage est amorcé par la **seule date du lundi courant** : la même boutique
  pour tout le monde, reroll automatique le lundi à minuit UTC.
- **Prix** : chaque carte se paie en **exactement trois** sortes de ressources ; `rarityValues` et
  `itemsValues` sont dans la même unité, donc le prix vaut la valeur de la rareté. Les quantités
  sont énumérées puis la combinaison la plus sobre est choisie ; une ressource que la mine ne
  produit pas ne peut jamais être demandée.
- **Stock** : `shop.allItemsUniques` (true) → une offre achetée est épuisée jusqu'au lundi suivant ;
  à false, la boutique la revend tant que le joueur a les ressources.
- **Offres épinglées** : `data/shop/pinned_offers.json` — carte, prix, fenêtre de vente, stock.
  Jamais aléatoires, **construites avant les offres tirées** et affichées en tête, mises en avant
  (bordure d'accent, halo, pastille).
- **Achat du jour en Sparks** : `shop.dailySparkOffer` — une ressource et sa quantité sont tirées de
  la date UTC seule, dans la limite de `maxResourceValue` (100) ; le prix vaut la valeur du tirage
  fois `priceMultiplier` (2). Un seul achat par jour (`trader.sparkDay` / `sparkBought`), remis à
  zéro à minuit UTC.
- **Échanges du jour** : `shop.tradesPerDay` (3) échanges ressource contre ressource, tirés du jour
  UTC seul (mêmes pour tout le monde). Le côté le plus cher compte 1 unité, l'autre autant
  d'unités que nécessaire. Chaque échange se prend dans les deux sens, une fois par jour
  (`tradeUses`). Les paires non divisibles sont écartées.
- **Deux horloges** : compte à rebours avant le reroll (`CLOCK_TICK`) et, pour chaque offre
  épinglée, sa propre fenêtre.
- Un achat écrit prix, ligne de collection et compteur dans **une seule transaction** ; le reroll
  est évalué dans la transaction. La carte est annoncée par `CARDS_OBTAINED` (source `trader`) et
  les ressources dépensées par `MINING_UPDATED`.
- **L'image d'une offre est un bouton** : elle ouvre le détail de la carte dans une popup empilée
  au-dessus de la boutique (`Échap` ferme d'abord le détail).

## 9. Sparks et achats

`js/business/SparksManager.js`, réglages `sparks`.

- **Gains** : `boosterReward` (5) à chaque booster ouvert, vente de cartes (`sellPrice` : 1/3/10/25/
  100 pour les raretés 1 à 5), codes et cadeaux.
- **Dépenses** : achat de cartes (`buyPrice` : 10/25/100/500/2500), booster supplémentaire (1500),
  pioche supplémentaire (1000), layout Full Art (1000), couleurs de titre de carte (125 par
  défaut).
- Toute opération mixte (collection + Sparks) passe par une **transaction unique** : impossible de
  débiter sans donner la carte, ou l'inverse.
- `SPARKS_UPDATED` met à jour le compteur d'en-tête et les écrans ouverts.

## 10. Binders et partage

`js/business/BinderManager.js`, vue dans `CollectionView`, page de lecture `collection.html`.

- Un binder est une page **nommée** de **30 emplacements** (3 cartes par ligne), rangée dans
  `user_state["binders"]`.
- **Limite** : autant de binders que le niveau du joueur (`BinderManager.getLimit()`).
- Une page ne peut pas montrer une carte plus de fois que le joueur n'en possède de copies ; la
  carte représentative ne consomme **aucune** copie.
- Édition en brouillon : rien n'est écrit avant « Enregistrer ».
- La carte représentative fournit le `Background` de sa carte comme décor (`--binder-backdrop`).
- **Partage** : code auto-suffisant (JSON → deflate → Base64 URL-safe, `js/utils/BinderCode.js`)
  contenant l'auteur (nom, icône, photo), le nom du binder, la carte représentative, les cartes et
  leurs données maîtresses. L'URL `collection.html?code=…` est copiée.
- **Page de lecture** (`js/binder-share.js`) : autonome, sans compte ni base ni catalogue. Auteur en
  pastille (avec repli « Joueur anonyme »), panneau centré, détail d'une carte en modale, foil et
  brillance rendus par `js/utils/Shine.js`.
- La vente d'une carte réconcilie les binders (`BINDER_LIMIT_REACHED`, placements excédentaires
  retirés en partant de la fin).

## 11. Cartes promo

`js/business/PromoManager.js` + `PromoSet.js`, données `data/promo_cards/<serie>.json`.

- Groupe exposé `<serie>-Promo` (« Genesis Blocks · Promo »).
- Jamais tirables : `BoosterManager` ne les lit pas, elles n'entrent dans aucune table de rareté.
- Obtention uniquement par code ou cadeau.
- Non possédée → totalement invisible ; possédée → pastille « Promo », comportement normal
  (favoris, vente/achat, détail).
- Ne comptent ni dans la complétion ni dans le compteur d'une extension.

## 12. Codes (redeem et codes personnels)

`js/business/RedeemManager.js`, catalogue `settings/codes.json`, panneau dans les Paramètres.

- **Codes de feuille** : identifiant, récompenses multiples, fenêtre de disponibilité, répétable ou
  non. Un code traité est enregistré dans `redeemed_codes` (clé = code), donc impossible à réutiliser
  s'il est à usage unique.
- **Codes automatiques (`AutoClaim`)** : `{ Auto, RequiredLevel, RequiredOpenBoosterStats,
  CustomMessage }` sur un code **non répétable** (un code répétable qui en porte un voit son
  auto-claim ignoré au chargement, et le linter le signale). Les récompenses sont créditées une seule fois, dès que le jour UTC est
  dans la fenêtre ET que le niveau et le nombre de boosters ouverts atteignent les seuils. La
  vérification tourne au démarrage, après chaque ouverture de booster, à chaque niveau et depuis le
  bouton « Vérifier les distributions » ; le cadeau s'affiche dans une popup globale
  (`js/UI/components/AutoClaimPopup.js`), par-dessus l'écran courant.
- **Codes personnels `useritem`** : générés hors ligne par le gamemaster, signés avec la clé de
  `useritemCode` ; `js/business/UserItemCode.js` les vérifie et les décode. Un code peut accorder
  des cartes (y compris promo), des Sparks, des boosters bonus, etc.
- Chaque rédemption écrit ses récompenses et l'entrée `redeemed_codes` dans une transaction, puis
  annonce `CARDS_OBTAINED` / `SPARKS_UPDATED`.
- Lien profond `index.html?Redeem=<code>` : si la page s'ouvre sans compte, le code est mémorisé et
  traité après création ou import ; sinon il est traité au démarrage.
- `settings/codes.json` ne doit jamais contenir de secret exploitable : les codes personnels
  s'appuient sur une clé de signature, pas sur une liste.

## 13. Distributions (cadeaux)

`js/business/GiftManager.js`, panneau « historique des cadeaux » des Paramètres.

- Source : CSV d'un Google Sheet (`giftSheet.id`, `gid`).
- Une ligne = un cadeau : `uuid`, `type` (`booster`|`card`), `key`, `quantity`. Un `uuid` à `*`
  adresse la ligne à tous les comptes.
- « Vérifier les distributions » ne traite que les lignes postérieures à `lastCheckedLine` et dont
  l'UUID correspond.
- Chaque cadeau est enregistré dans `gifts_received` avec son numéro de ligne comme clé :
  impossible de le recevoir deux fois.
- `lastCheckedLine` avance dans la même transaction que les récompenses.
- L'historique affiche ce qui a été reçu, ou « Aucun cadeau ».
- Les récompenses passent par `CARDS_OBTAINED` (source `gift`) ou créditent le quota / les Sparks.

## 14. Trophées, expérience et niveau

`js/business/TrophyManager.js`, catalogues dans `settings/` et `data/trophies/`.

- **Familles** :
  - paliers récurrents par extension (`settings/boosters_trophy.json`) : complétion et boosters
    ouverts ;
  - paliers globaux (`settings/global_trophy.json`) : cartes possédées, boosters ouverts, cartes
    différentes, **blocs minés au total** et **par sorte**, **pioches Mine Pick** et **par rareté de
    carte** ;
  - trophées de collection par extension (`data/trophies/<setId>.json`), avec des listes d'index
    (`RequirementType: "CardList"`) et un layout (`classic`/`fullart`/`any`).
- **Raretés** : `bronze`, `silver`, `gold`, `diamond`, `emerald` ; XP par défaut dans
  `ExperiencePerTrophy`.
- **Halo** : rayon et couleur selon la rareté, intensité réglable par le joueur (niveau 0–5,
  défaut 2) via `GlowManager` (`--trophy-glow-scale`). Un trophée non obtenu ne brille jamais.
- **Déblocage définitif** : revendre des cartes ne reprend jamais un trophée.
- **Épinglage** : `profile.defaultFeaturedTrophies` (1) au départ, puis jusqu'à
  `profile.maxFeaturedTrophies` (5) avec les emplacements achetés ; bouton d'épingle sur les tuiles
  débloquées et dans la modale de détail. Une liste pleine propose d'acheter le slot suivant puis
  rejoue l'épingle.
- **XP dérivée** : `levelling.experience.everyBooster` (5) × boosters ouverts +
  `everyDistinctCard` (3) × cartes différentes + `nameChanged` (10) si le nom est personnalisé +
  l'XP des trophées. Aucun compteur d'XP n'est stocké : seuls les déblocages le sont.
- **Niveau** : `defaultLevel` (1), `baseRequiredExpToLevelUp` (100), `incrementRequiredXpBy` (25).
- Le catalogue des trophées est filtrable par famille et statut, et ne montre jamais les trente
  trophées d'un coup.
- **Bon goût des données** : une médaille absente retombe sur `assets/img/trophy/default.png` ; un
  palier malformé retombe sur la valeur livrée.

## 15. Titres de joueur

`js/business/TitleManager.js`, catalogue `settings/default_titles.json` et
`data/titles/<setId>.json`, page `TitlesView`.

- Le titre s'affiche **sous le pseudo**, en jaune (`--color-title`) et dans la police pixel
  **Press Start 2P**.
- Deux sources : titres de **niveau** (`requiredLevel`) et titres de **collection** (un trophée
  donne un ou plusieurs titres).
- Le déblocage est **dérivé** (jamais stocké) ; `TITLE_UNLOCKED` ne sert qu'à l'annonce.
- La page affiche « Aucun titre » puis un titre par ligne, groupés par source ; la ligne est écrite
  dans la police où le titre sera porté (la page est son propre aperçu).
- Un titre verrouillé est grisé et propose « Voir la condition de déblocage » (niveau courant ou
  détail du trophée à obtenir).
- Le profil ne stocke que l'`id` du titre porté ; un id inconnu retombe sur « aucun titre ».

## 16. Profil et carte de profil

Vue : `js/UI/views/ProfileView.js`, identité via `ProfileManager`, carte via
`ProfileCardManager` + `js/UI/components/ProfileCard.js`.

- **Identité en lecture seule** : pseudo, avatar, titre ; un bouton crayon révèle le formulaire.
- **Niveau et barre d'XP** sous l'identité.
- **Trophées mis en avant** (1 au départ, 5 max) et **cartes favorites** (3 au départ, 5 max) sur
  une ligne défilante, chaque vignette ouvrant une modale de détail. La tuile « + » de chaque liste
  achète l'emplacement suivant au prix de `profile.featuredSlotPrices` /
  `profile.favoriteSlotPrices` et ouvre immédiatement le slot acheté.
- Boutons vers **Statistiques**, **Trophées** et **Titre** ; ces pages ont leur propre retour.
- **Carte de profil** : projection du compte en carte à collectionner (générateur
  `external/cardmakerz/`).
  - nom = pseudo, série = `<titre> #<numéro>` (les `profileCard.seriesDigits` derniers caractères
    de l'UUID) ;
  - rareté = paliers de trophées débloqués (`profileCard.rarityThresholds` : 0/5/15/30/50) ;
    le joueur peut choisir une rareté déjà atteinte ;
  - illustration = `Background` de la carte favorite choisie dans le panneau « Fond de la carte »,
    sinon celui de la première favorite, sinon `defaultArtPath` ; le choix est stocké dans
    `user_state["profileCard"].background` et retombe sur la première favorite si elle est retirée ;
  - description = trophées épinglés en icônes + compteurs (boosters ouverts, cartes différentes,
    plus ancienne carte, Sparks, blocs minés, pioches) ;
  - deux dispositions : **Normale** et **Full Art** (achetable pour
    `features.items.cardLayoutFullArt.priceSparks`, 1000 Sparks) ;
  - couleurs du pseudo et de la ligne de titre : « Auto » (gratuit) ou une entrée de
    `settings/colors.json`, achetée séparément pour chaque ligne (`titlePrice` / `usernamePrice`) ;
  - carte agrandie manipulable : maintien à la souris ou au doigt pour l'incliner
    (`cardDetail.maxRotationDeg`) avec une légère épaisseur (`cardDetail.thicknessPx`) ;
  - « Agrandir la carte » et « Télécharger la carte » (PNG 720 × 1000, police et images incorporées
    en data URLs).
- La carte est recalculée à chaque rendu : elle ne peut pas contredire la page.

## 17. Notifications de jeu et toasts

`js/UI/components/NotificationCenter.js` et `GameNotifier.js`.

- **Toasts** : accusé de réception d'une action du joueur, empilés en bas.
- **Notifications** : ce que le jeu vient d'accorder (collection, expérience, niveau, titre,
  trophée), une seule à la fois, en haut à droite (en haut au centre sur écran vertical), sous
  l'en-tête dont la hauteur est mesurée.
- Durée par défaut `notifications.duration` (3 s), réglable de 1 à 8 s. Fermeture par clic, tap,
  `Entrée`/`Espace`, ou swipe latéral (≥ 40 px).
- **Trois interrupteurs** (`settings.notificationTypes`) coupent la progression des collections,
  l'expérience et les titres. Une famille coupée est ignorée dès l'entrée dans la file.
- Une notification **prioritaire** (collection découverte pendant la révélation) interrompt celle
  affichée, qui repart en tête de file avec sa durée complète.
- **Aucune notification au démarrage** : l'évaluation initiale des trophées et titres est
  silencieuse ; les notifications sont armées après.
- Le compteur d'une collection ne compte que les cartes déjà retournées.

## 18. Statistiques

Vue : `js/UI/views/StatsView.js`.

- Panneaux : boosters ouverts (total et par extension), tirages par rareté, cartes les plus
  tirées, complétion par extension, historique des ouvertures (`boosters.historySize`, 10),
  panneau **Mine Pick** et panneau **Mine** (allowance du jour, une barre par sorte de bloc, y
  compris à 0, ressources récoltées).
- Les données viennent de `stats`, `minePick`, `mining` et du catalogue ; rien n'est recalculé à
  partir des illustrations.
- Une ressource que la configuration ne déclare plus mais que la sauvegarde contient est ajoutée en
  fin de liste.

## 19. Informations

Vue : `js/UI/views/InfoView.js`.

- Page d'explication du jeu : règles du gacha, des quotas, des trophées, de la Mine Pick, de la
  Mine, du marchand, du foil, etc.
- Le panneau « Expérience et niveaux » lit directement `config.json`
  (`ConfigLoader.getLevellingSettings()` / `getExperiencePerTrophy()`) : la page ne peut pas
  dériver des règles réellement appliquées.

## 20. Paramètres

Vue : `js/UI/views/SettingsView.js`. Panneaux :

- **Langue** : fr / en, appliqué à chaud (miroir `localStorage`).
- **Thème** : Sombre, Clair, Classic, Ciel, Nuit.
- **Animations** : Normal, Épique, Explosif (pastille « BLAGUE » sur le mode parodique), avec un
  aperçu animé qui rejoue les trois étapes avec le vrai markup des cartes.
- **Foil** : intensité du foil et brillance de la ligne (deux curseurs, valeurs par défaut dans
  `foil`).
- **Illumination** : lueur des trophées (niveau 0–5).
- **Notifications** : durée et trois interrupteurs.
- **Son** : coupe les effets de l'ouverture.
- **Heure UTC de référence** : l'heure fiable de `DateSyncManager` et l'état de la synchronisation.
- **Mode développeur** : affiche la clé d'une carte et un bouton de copie.
- **Compte** : UUID visible/copiable.
- **Sauvegarde** : export `.save`, import, reset complet.
- **Vérifier les distributions** et lien vers l'historique des cadeaux.
- **Codes** : panneau de saisie des codes.

## 21. Overlay de stream

`overlay.html` + `js/overlay.js`, entièrement autonome (n'importe rien de `js/`).

- URL : `overlay.html?code=minecards:<code>&lang=<fr|en>&username=<nom>&profileiconurl=<url>`.
- Décode un code de booster (`js/utils/BoosterCode.js`), recharge le JSON de l'extension et rejoue
  automatiquement l'ouverture : le booster tourne, chaque carte se retourne, puis le résumé
  s'affiche, puis tout s'efface (page transparente).
- Tous les délais viennent de `settings/overlay.json`, republiés en variables CSS `--ov-*`.
- Un code invalide laisse la page totalement vide : jamais d'interface cassée sur un stream.
- Les sons sont partagés avec le jeu mais les chemins sont dupliqués volontairement.

## 22. PWA et hors-ligne

`manifest.json` + `sw.js`.

- Précache du shell à l'installation (HTML, CSS, modules, réglages, catalogue, dos de carte, sons,
  modèle 3D, Three.js épinglé).
- Navigation *network-first* avec repli `index.html` ; assets same-origin en
  *stale-while-revalidate* ; CDN en *cache-first*.
- Jamais mis en cache : requêtes `no-store`/`reload`/`no-cache`, requêtes `Range`, cross-origin hors
  CDN (API d'heure, Google Sheet), le worker lui-même et les fichiers privés (`admin/`, `.docs/`).
- Les illustrations (`cards/`, 374 Mo) et les visuels de boosters sont mis en cache **à l'usage**.
- Chemins absolus en `/projets/minecards/` dans le manifest : l'installation et le contrôle par le
  worker exigent ce sous-dossier (voir `start_server_public.cmd`).
- Mettre à jour `VERSION` dans `sw.js` à chaque modification du shell ; seuls les caches préfixés
  `minecards-` sont purgés.
- `manifest.json` force `orientation: portrait` : l'app installée reste verticale. iOS ignore la
  clé ; la mise en page doit donc rester utilisable en paysage.
- `.well-known/assetlinks.json` (Digital Asset Links) lie l'app Android à l'origine. Il est servi à
  la **racine du domaine** (`https://web.jmdev.fr/.well-known/assetlinks.json`), pas sous
  `/projets/minecards/`, et n'est jamais mis en cache par le worker. Le fichier est à la racine du
  dépôt du site (`../../.well-known/`, avec `CNAME`), et `_config.yml` y ajoute `include: [.well-known]`
  parce que Jekyll/GitHub Pages exclut les dossiers commençant par un point.

## 23. Outils annexes (admin, gamemaster)

- `admin/` : petit outil de génération/vérification de codes personnels (voir
  `.docs/gamemaster/useritemcode.md`), avec `admin/CodeGeneration.cs` côté C#.
- `external/minecardslinks/` : application C# de gestion des liens/distributions.
- `external/cardmakerz/` : générateur de cartes utilisé par la carte de profil et les illustrations
  de haute qualité.
- `external/boosterciewerz/` : prototype 3D ultra simplifié (référence visuelle et de performance).
- `external/autobingo_splitter.html`, `reorganizer.html`, `autoidnum/`, `autoreorder/`,
  `desc_grabber/` : outils de préparation des données.

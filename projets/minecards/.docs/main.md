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
- `"settings"` : `{ lang: "fr"|"en", theme: "dark"|"light"|"classic", sound: boolean, animation: "normal"|"epic"|"explosive" }`.
- `"quota"` : `{ lastResetDay: "YYYY-MM-DD", dailyRemaining, bonusBoosters: { [setId]: number }, purchasedBoosters }` (ex. `{ "set1": 2 }`). `purchasedBoosters` compte les boosters **achetés en Sparks** : globaux (comme les quotidiens), ils ne sont jamais effacés par le reset.
- `"timeAnchor"` : `{ apiUtcMs, perfNow, lastKnownUtcMs }`.
- `"stats"` : `{ boostersOpened, boostersOpenedBySet: { [setId]: count }, drawsByRarity: {1..5}, drawsByCard: { [key]: count } }`.
- `"giftSync"` : `{ lastCheckedLine, lastCheckAt }`.
- `"profile"` : `{ name, photo, favorites: string[], featured: string[] }` — profil du joueur (`ProfileManager`) : nom affiché, URL de la photo de profil, jusqu'à 5 cartes favorites et 3 trophées mis en avant.
- `"trophies"` : `{ unlocked: { [trophyId]: { unlockedAt, experience } } }` — trophées débloqués (`TrophyManager`). Un déblocage est **définitif** : revendre des cartes ne le reprend jamais.
- `"minePick"` : `{ lastResetDay, remaining, bonusPicks, totalPicks, picksByBooster, picksByRarity, picksByCard, history }` — état de la Mine Pick (`MinePickManager`) : quota du jour (remis à `picksPerDay` à minuit UTC), `bonusPicks` pour les pioches **achetées en Sparks** (jamais effacées par le reset, dépensées seulement quand les gratuites sont épuisées), et les statistiques **propres** à la fonctionnalité (une pioche n'est pas un booster ouvert, elle ne touche donc jamais `stats`).

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
- Propriétés : `id`, `name`, `rarity` (1–5), `style` (`"normal"|"fullart"`), `illustration` (nom unique dans tous les fichiers), `set`.
- Clé unique : `${id}_${style}`. Les `id` doivent donc être uniques entre extensions.
- Chemins d'illustration : `/fr/` ⇄ `/en/` selon la langue active.

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
- Trois **modes d'animation** (voir section F) habillent ce workflow. **Normal** ne change rien au mouvement, seulement ses durées. **Épique** le met en scène : rayons de lumière et poussières autour du booster, traînée de décollage, onde de choc à l'ouverture de la carte, halo renforcé sur les raretés hautes, balayage lumineux sur le résumé. **Explosif** — mode **parodique assumé** (`parodic: true` dans `config.json`) — en rajoute : le booster tremble, tourne et explose derrière un « BOUM ! » entouré d'autocollants comiques, la scène **et** le panneau tremblent, un anneau de BD part du choc, des **confettis** sont tirés à chaque ouverture (`OpeningView.spawnConfetti()`), la carte fait deux tours et demi et les vignettes du résumé tombent du plafond en police comique. Le côté parodique est annoncé par le bandeau hachuré et le badge « Parodique » des Paramètres, et par la note sous le « BOUM ! ».
- La boîte qui contient le booster fait **90 % de la largeur** de son conteneur et **10 % de hauteur en plus** (38 vh pour l'aperçu du sélecteur, 50 vh pour la scène d'ouverture, 42 vh et 55 vh au-delà de 768 px) : le booster garde ainsi des marges sur les côtés, ce qui laisse les deux flèches de changement d'extension collées aux bords même sur un écran vertical. La caméra est reculée d'autant (3,52 au lieu de 3,2) pour que le modèle ne grossisse pas en même temps que la boîte ; l'image 2D de secours est réduite de 10 % de la même façon.

### F. Langues & Thèmes
- **Langues** : Français, Anglais (extensible : ajouter `settings/i18n/<code>.json` + l'entrée dans `settings/config.json`). Change les libellés et les chemins d'images, à chaud (sans rechargement).
- **Thèmes** : **Sombre** (défaut), **Clair**, **Classic**. Chacun est un bloc de variables CSS `body[data-theme="…"]` dans `css/themes.css`. Extensible.
- Les deux préférences sont sauvegardées dans `user_state["settings"]` et incluses dans le `.save`.
- **Animations** : **Normal** (défaut), **Épique**, **Explosif**. Les modes sont déclarés dans `settings/config.json` (`animations.list` : `id`, `labelKey`, `parodic`, `tearMs`, `flipMs`, `staggerMs`) et le mode actif est posé en `data-animation` sur `<html>`/`<body>`, comme le thème. `js/utils/AnimationManager.js` publie les trois durées en variables CSS (`--anim-tear-ms`, `--anim-flip-ms`, `--anim-stagger-ms`), que le **JS lit aussi** : les séquences automatiques (révélations de la Mine Pick, garde d'arrivée du projecteur) ne peuvent pas se désynchroniser du CSS. Le `tearMs` sert en plus au mouvement WebGL de `Booster3DRenderer`, donc la 3D, le CSS et la rafale comique restent sur la même horloge. `css/animations/`, chargé en dernier, ne fait qu'**habiller** les animations de base décrites en 3.E : un mode sans bloc CSS réutilise simplement le mouvement neutre à sa vitesse, et un mode qui en a un ne remplace jamais l'animation de base sans raison. La Mine Pick suit le mode actif (voir 3.G quater).

### G. Vues & Navigation (SPA)
0. **Accueil (onboarding)** : créer / importer, affiché seulement si aucun compte.
1. **Ouverture** : choix du booster + scène d'ouverture.
2. **Collection** : grille, silhouettes grisées pour les manquantes, filtres extension/style/rareté/statut, **bouton cœur** sur les cartes possédées (5 favoris maximum).
2 bis. **Profil** : deux onglets. L'onglet *Profil* affiche l'identité **en lecture seule** (un bouton crayon `assets/img/edit.png` révèle le formulaire nom/photo), le niveau et sa barre d'XP juste en dessous, les trophées mis en avant et les cartes favorites — chacun sur **une seule ligne** défilante, chaque vignette ouvrant une **modale de détail**. L'onglet *Trophées* isole le catalogue derrière deux combos (famille, statut) pour ne jamais afficher les trente trophées d'un coup. Le **bloc Statistiques** est le dernier de la page, sous les cartes favorites (`[data-panel="stats"]`), avec les compteurs propres à la Mine Pick.
3. **Mine Pick** : les dix boosters simulés du jour, **listés un par ligne avec leur contenu face visible**, et les trois pioches gratuites. Un premier clic **sélectionne** la ligne (aperçu), le second l'ouvre — voir section 3.G quater.
4. **Paramètres** : langue, thème, **animations** (sélecteur + aperçu animé joué à l'ouverture de la page, bandeau d'avertissement pour le mode parodique), **heure UTC de référence**, compte (UUID), sauvegarde (export / import / reset), **bouton "Vérifier les distributions"**, lien vers l'historique des cadeaux.
5. **Cadeaux** : historique des distributions reçues.
6. **Redeem** : codes spéciaux de `settings/codes.json` (plusieurs récompenses, fenêtre de disponibilité, répétable ou non — voir Étape 9).

L'heure UTC affichée dans les Paramètres est celle de `DateSyncManager` (jamais `Date.now()`), publiée par `CLOCK_TICK` : elle est donc toujours d'accord avec le quota quotidien et les fenêtres de disponibilité des codes.

**En-tête sur écran vertical** (< 768 px) : il ne garde que la marque et les compteurs. Le slogan et l'horloge UTC sont masqués (l'heure reste lisible dans les Paramètres) et « MineCards » s'affiche centré, une taille en dessous.

Sauvegarde `.save` : toutes les données → JSON → `CompressionStream('deflate')` → Base64. Import : Base64 → `DecompressionStream('deflate')` → JSON validé.

### G bis. Trophées & Niveau

Catalogue déclaré dans `settings/boosters_trophy.json` (paliers récurrents sur chaque extension :
complétion et boosters ouverts), `settings/global_trophy.json` (paliers globaux : cartes possédées,
boosters ouverts, cartes différentes) et `data/trophies/<setId>.json` (succès de collection, listes
d'index `RequirementType: "CardList"`, layout `classic`/`fullart`/`any`). Raretés : `bronze`,
`silver`, `gold`, `diamond`, `emerald`.

Chaque trophée a une **médaille** : les paliers récurrents d'une extension la prennent dans `assets/img/trophy/<setId>/<famille>/<rareté>.png`, les paliers globaux dans `assets/img/trophy/Global/<compteur>/<rareté>.png` (le `<compteur>` est la clé de `settings/global_trophy.json` : `totalCards`, `boosters`, `differentCards`), et les trophées de collection dans le champ `Icon` de leur entrée dans `data/trophies/<setId>.json` — n'importe quelle extension, le GIF animé `QuinteFlushRoyale.gif` compris. Un trophée dont le catalogue ne déclare aucune image, ou dont le fichier ne se charge pas, retombe sur `assets/img/trophy/default.png`.

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
- **carte obtenue hors ouverture** — achat en Sparks, code promo, distribution (`CARDS_OBTAINED`) : l'XP s'il s'agit d'une PREMIÈRE copie, puis les collections concernées ;
- **nom personnalisé défini** (`PROFILE_UPDATED`) : l'XP du nom, une seule fois (le nom par défaut ne rapporte rien) ;
- **niveau atteint** (`EXPERIENCE_UPDATED`) : « Niveau N atteint », dans sa propre variante.

Règles de la file d'attente : une notification reste **3 s** (`NOTIFICATION_DURATION_MS`) puis la suivante prend sa place ; un **clic**, un **tap**, **Entrée/Espace** ou un **swipe latéral** (≥ 40 px, la carte suit le doigt) la retirent immédiatement et montrent la suivante. Une notification **prioritaire** (une collection découverte pendant la révélation) **interrompt** celle qui est affichée : celle-ci repart en tête de sa file et se réaffiche ensuite, avec sa durée complète. Le compteur d'une collection ne compte que les cartes **déjà retournées** : une notification ne peut donc pas révéler qu'une autre carte de la même collection attend encore dans le paquet.

**Aucune notification au démarrage** : l'XP et les trophées sont évalués une fois au lancement, et `app.js` appelle `gameNotifier.start()` APRÈS cette première évaluation (qui prend le niveau courant comme référence). Importer une sauvegarde qui débloque dix trophées d'un coup ne déclenche donc aucun message.

Enfin, les avatars (`assets/img/profile/**`) sont du **pixel art** (6x6, 8x8, 48x48 ou 192x192) : les trois endroits qui les affichent — avatar du profil, sélecteur d'icônes, section « Icônes débloquées » d'un trophée — les rendent avec `image-rendering: pixelated`, donc sans aucune interpolation.

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

**Les animations sont au rendez-vous** (`css/views/minepick.css`) : le pack atterrit dans une déflagration
de lumière, les cinq cartes se distribuent une à une en se posant, le paquet face visible « respire »
pendant qu'on le mémorise, chaque carte se retourne avec une petite levée, les cartes se dandinent pendant
le mélange, ondes de choc et vibration de la ligne sélectionnée comprises. Les durées viennent du mode
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

### G quinquies. Intensité du foil (réglage)
- **Réglage :** le panneau « Foil » des Paramètres porte un curseur (0-100 %), dont les bornes viennent de `settings/config.json` (`foil.min|max|step|default`). La préférence est enregistrée dans `settings.foilIntensity`, en pourcentage ; à 0 % le foil est entièrement éteint, aperçu compris.
- **Application :** `js/utils/FoilManager.js` publie `--foil-intensity` (facteur 0-1) sur `<html>`, et les deux plans de `css/components/card-shine.css` multiplient leur propre opacité par cette valeur : un seul levier qui atteint toutes les couches, y compris la résille hexagonale en data-URI qu'aucune variable ne pourrait teinter. La force de base reste par rareté (`--foil-strength`) : le curseur l'échelle, il ne la remplace pas.
- **Défaut à 100 % :** c'est l'intensité pour laquelle le foil a été réglé, donc un joueur qui ne touche à rien voit exactement ce qui a été dessiné.
- **Bornes :** une valeur hors plage est ramenée dans la plage plutôt que rejetée, afin qu'un `.save` écrit avec une plage plus large continue de se charger. À 0 le worker pose en plus `data-foil="off"` sur `<html>` et `<body>`, ce qui arrête les animations devenues invisibles.

### H. Distributions (cadeaux via Google Sheet)
- Source : le CSV du Google Sheet, dont l'URL est configurée dans `settings/config.json`.
- Une ligne = un cadeau : `uuid`, `type` (`booster`|`card`), `key`, `quantity`. La colonne `key` identifie le cadeau : l'identifiant du set pour un `booster` (ex. `set1`), la clé unique de la carte pour une `card` (ex. `042_fullart`). Voir Étape 8.
- Dans Paramètres, "Vérifier les distributions" télécharge le CSV et ne traite que les lignes **postérieures à `lastCheckedLine`** dont l'UUID correspond à celui du compte. Un `uuid` valant `*` adresse la ligne à **tous** les comptes (Étape 9).
- Chaque cadeau traité est enregistré dans `gifts_received` avec son **numéro de ligne comme clé** : impossible de le récupérer deux fois.
- `lastCheckedLine` est mis à jour à la fin du traitement, dans la même transaction que les récompenses.
- Une interface indique ce qui a été reçu, ou "Aucun cadeau".

### I. PWA (installation & jeu hors-ligne)
- **Fichiers :** `manifest.json` (nom, icônes, scope) et `sw.js` (service worker), tous deux à la racine ; `index.html` les déclare (`<link rel="manifest">`, meta iOS, enregistrement du worker après `load`).
- **Chemins absolus :** `id`, `start_url`, `scope` et les icônes portent le sous-dossier servi, `/projets/minecards/`. Conséquence : le jeu doit être servi depuis ce sous-dossier pour être installable et contrôlé par le worker — lancé à la racine du domaine (`start_server.cmd`), le worker s'enregistre sans jamais contrôler la page et l'installation est refusée.
- **Stratégies :** precache du *shell* à l'installation (HTML, CSS, modules, réglages, catalogue, dos de carte, sons, modèle 3D, Three.js épinglé) ; navigation *network-first* avec repli sur `index.html` ; assets same-origin en *stale-while-revalidate* ; CDN (unpkg) en *cache-first*. La revalidation lit **les deux** caches, le runtime d'abord (copie la plus fraîche) puis le shell : sans ce repli, une installation fraîche suivie d'un passage hors-ligne sans rechargement ne trouverait rien, puisque le cache d'exécution est encore vide.
- **Jamais mis en cache :** les requêtes `no-store`/`reload`/`no-cache` (rafraîchissement des paramètres, des cadeaux et des codes), les requêtes `Range`, le cross-origin hors CDN (API de temps, Google Sheet), le worker lui-même et les fichiers privés (`admin/`, `useritem_codes.csv`, `.docs/`).
- **Couverture :** tout le jeu démarre hors-ligne dès la première installation, sans rechargement intermédiaire (vérifié serveur coupé, cache d'exécution vide). En revanche les illustrations (`cards/`, 374 Mo) et les visuels de boosters ne sont mis en cache **qu'à l'usage** : une carte jamais affichée n'a pas d'image hors-ligne.
- **Mise à jour :** incrémenter `VERSION` dans `sw.js` à chaque changement du shell ; seuls les caches préfixés `minecards-` sont purgés, ceux des autres projets de l'hôte sont laissés intacts.

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

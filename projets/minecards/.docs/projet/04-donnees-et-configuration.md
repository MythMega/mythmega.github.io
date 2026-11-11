# 4. Données et configuration

Tout ce qui n'est pas de la progression du joueur vit dans des fichiers statiques JSON, versionnés
avec le code. Ce document décrit leur rôle, leur schéma et les règles de repli. La progression
elle-même est décrite dans `database.md`.

## 4.1 `settings/config.json`

Fichier central, lu par `ConfigLoader`. Chaque bloc a une fonction précise ; toute valeur absente ou
invalide retombe sur un défaut sûr, donc un `config.json` partiellement cassé ne bloque jamais le
jeu.

| Bloc | Rôle | Défauts livrés |
|---|---|---|
| `languages` | langues proposées (`code`, `label`) | `fr`, `en` |
| `defaultLang` | langue d'un nouveau compte | `fr` |
| `cardLanguages` | langues de la **donnée des cartes** (`code`, `label`), indépendantes de celles du site | `fr`, `en` |
| `defaultCardLang` | langue des cartes quand le navigateur n'en propose aucune | `en` |
| `themes` | thèmes proposés (`id`, `labelKey`) | `dark`, `light`, `classic`, `day`, `night` |
| `defaultTheme` | thème d'un nouveau compte | `dark` |
| `animations` | modes d'ouverture (`id`, `labelKey`, `parodic`, `tearMs`, `flipMs`, `staggerMs`) | `normal` 700/220/60, `epic` 1200/640/150, `explosive` 950/900/90 (`parodic`), `none` 220/90/0, `mining` 900/300/70, `default: epic` |
| `foil` | bornes du curseur d'intensité + `glare` (brillance) | 0–100 pas 5, défaut 100 (les deux) |
| `notifications` | bornes de durée + familles interruptibles | durée 1–8 s, défaut 3 ; types `collection`, `experience`, `title` |
| `glow` | bornes du halo des trophées | `trophies` 0–5, défaut 2 |
| `boosterRender` | rendu 3D du booster : mode par défaut et recettes (exposition, réflexions, lumières, métal/rugosité, vernis, émission, échelle de la normal map) | `defaultMode: blister`, puis `blister`, `classic`, `satin`, `metal` (sélecteur réservé au mode développeur) |
| `boosters` | dossier, table de rareté, modèle 3D, cartes par pack, quota, prix, godpack, historique, fenêtre d'avant-première et d'annonce de sortie | `directory: data/boosters`, `rarityConfigPath: settings/defaultRarity.json`, `model: assets/boostermodel.glb`, `cardsPerBooster: 5`, `dailyFreeBoosters: 3`, `extraBoosterPriceSparks: 1500`, `godpackChancePercent: 0.5`, `historySize: 10`, `upcomingPreviewDays: 3`, `releaseAnnouncementDays: 7` |
| `minePick` | plateau, pioches, prix, graine, poids des extensions | `boosterCount: 10`, `picksPerDay: 3`, `extraPickPriceSparks: 1000`, `historySize: 10`, `seedSalt: "minecards-mine-pick-v1"`, `setWeightExponent: 2` |
| `mining` | règles de la mine, quota, cadence, graine | `configPath: settings/mining.json`, `blocksPerDay: 50`, `nextBlockDelayMs: 100`, `keyHoldIntervalMs: 250`, `seedSalt: "minecards-mining-v1"` |
| `promos` | dossier et séries de cartes promo (vide = une par extension) | `directory: data/promo_cards`, `sets: []` |
| `binders` | un binder au niveau 1, puis un de plus tous les `unlockEveryLevels` niveaux | `unlockEveryLevels: 3` |
| `timeSync` | fournisseurs d'heure UTC, timeout, intervalle de resynchronisation | 4 fournisseurs en ordre, 4000 ms, 900000 ms |
| `sparks` | valeurs de vente/achat par rareté, récompense par booster | vente 1/3/10/25/100, achat 10/25/100/500/2500, `boosterReward: 5` |
| `giftSheet` | identifiant et `gid` du Google Sheet des distributions | id du sheet livré, `gid: 0` |
| `useritemCode` | version + clé de signature des codes personnels | version 1 ; **clé de remplacement obligatoire** (placeholder de 32 octets nuls) |
| `levelling` | niveau de départ, XP des paliers, XP des actions | niveau 1, 100 XP, +25 par niveau ; `everyBooster: 5`, `everyDistinctCard: 3`, `nameChanged: 10` |
| `ExperiencePerTrophy` | XP par rareté de trophée | bronze 25, silver 100, gold 250, diamond 500, emerald 1000 |
| `trophies` | catalogue des trophées | `directory: data/trophies`, `boostersConfigPath`, `globalConfigPath` |
| `profile` | limites d'identité et prix des emplacements | `maxFavorites: 5`, `maxFeaturedTrophies: 5`, `defaultFavorites: 3`, `defaultFeaturedTrophies: 1`, prix `4: 100` / `5: 250` et `2: 25` / `3: 100` / `4: 250` / `5: 500`, `defaultName: ""` |
| `profileIcons` | avatars | `defaultPath`, `unlockablePath: data/icon.json`, `directory: data/profile_icons` |
| `titles` | titres de joueur | `defaultPath: settings/default_titles.json`, `directory: data/titles` |
| `profileCard` | paliers de rareté, illustration par défaut, chiffres de série | seuils 0/5/15/30/50 ; `defaultArtPath: assets/img/card_back.png` ; `seriesDigits: 4` |
| `cardDetail` | inclinaison et épaisseur des cartes en détail | `enabled: true`, `maxRotationDeg: 15`, `thicknessPx: 6` |
| `features` | fonctionnalités achetables | `cardLayoutFullArt.priceSparks: 1000`, `profileIcon*` (tailles et alignements de l'icône) `priceSparks: 75` |
| `shop` | marchand : graine, unicité, échanges, offres, valeurs, achat en Sparks | `seedSalt: "minecards-trader-v1"`, `allItemsUniques: true`, `tradesPerDay: 3`, composition 2/1/1/1, valeurs de rareté 50/100/250/500, valeurs de ressources 1/5/20/50/100, `dailySparkOffer: { maxResourceValue: 100, priceMultiplier: 2 }` |

Deux règles valent pour tout le fichier :

- **Planter n'est pas une option** : un bloc manquant, une borne inversée ou une chaîne vide
  retombent sur les valeurs livrées. Les commentaires `_comment` documentent l'intention et sont
  ignorés à la lecture.
- **La configuration ne peut pas donner un avantage indu** : un prix absent ou négatif retombe sur
  le prix livré (`FeatureManager`, `ProfileCardManager`), un palier de rareté plus bas que le
  précédent est refusé.

### 4.1.1 Catalogue de couleurs (`settings/colors.json`)

Une seule palette sert **trois usages distincts** : la couleur du pseudo, celle du titre et le
contour de la carte de profil. Chaque entrée porte un `id` stable (ce qu'une sauvegarde stocke), un
`name` `{ fr, en }`, un `hex` CSS et **trois prix indépendants** : `titlePrice`, `usernamePrice` et
`borderPrice`. Acheter une couleur pour l'un ne débloque jamais les autres.

```jsonc
{
  "colors": [
    { "id": "gold", "name": { "fr": "Or", "en": "Gold" },
      "hex": "#ffd54a", "titlePrice": 125, "usernamePrice": 125, "borderPrice": 500 }
  ]
}
```

Un `hex` peut aussi être une liste de couleurs : l'entrée peint alors un dégradé orienté par
`direction` (en degrés, 90 par défaut) et vendu au prix d'un dégradé. `ColorManager` valide le
fichier une fois : un `id` en double est ignoré, un `hex` invalide fait abandonner l'entrée (plutôt
que peindre une couleur devinée), un prix absent ou négatif retombe sur le prix livré de la même
couleur puis sur celui de son type (125/125/500 pour une couleur unie, 300/300/800 pour un
dégradé). Une palette entièrement illisible retombe sur la palette livrée en dur dans
`ColorManager.DEFAULT_COLOR_CATALOG`. L'ordre du tableau est celui des sélecteurs.

Les achats sont écrits dans `user_state["purchases"]` sous deux préfixes distincts
(`cardTitleColor.<id>` et `usernameColor.<id>`) ; le pseudo choisi vit dans
`user_state["profile"].usernameColor` (`auto` = couleur du thème).

## 4.2 Catalogues d'extensions (`data/boosters/<setId>.json`)

```jsonc
{
  "ID": 1,
  "Serie": "A1",
  "Name": "Genesis Blocks",
  "ImportMode": "AlreadyExportedData",
  "BoosterTexture": "./assets/boosters/A1.png",
  "Cards": [
    {
      "Index": "SERIE-A1 / W001",        // numéro affiché (tri « Numéro »)
      "Name_FR": "Laine blanche",
      "Name_EN": "White Wool",
      "Desc_FR": "…",
      "Desc_EN": "…",
      "Rarity": 1,                       // 1 à 5
      "Style": "Press Start 2P (Pixel)", // style d'impression de l'illustration
      "Layout": "classic",               // "classic" | "fullart"
      "Path": "./cards/A1/<lang>/SERIE-A1 _ W001_classic.png",
      "Background": "https://…/sheep.png", // fond de binder (URL absolue)
      "Underlay": "https://…/White_Wool.png" // sprite d'avatar (carte de profil, mine)
    }
  ]
}
```

Points structurants :

- **Clé unique** : `key = ${id}_${style}` avec `style ∈ {normal, fullart}`. `id` est **dérivé du
  `Path`** (le nom de fichier avant `_classic`/`_fullart`), pas du champ `Index` : c'est ce qui
  garantit l'unicité entre extensions. `Index` ne sert qu'à l'affichage et au tri.
- **Langue** : `Path` contient le marqueur `<lang>` (ou `/fr/`), remplacé par la langue active.
- **`Background`** : URL absolue de l'illustration de fond, utilisée par les binders et la carte de
  profil. Jamais localisée.
- **Deux axes de classement** : `index` (position dans `Cards`, tri par défaut) et `cardId` (`Index`,
  tri « Numéro », comparaison numérique).
- Ajouter une extension = un fichier ici + une entrée dans `settings/cardsets.json` + les
  illustrations. Aucun autre code à toucher.

### 4.2 bis Catalogue des extensions (`settings/cardsets.json`)

L'ancien tableau `boosters.sets` de `settings/config.json` vit ici, avec ce qu'il ne savait pas dire :

```json
{
  "sets": [
    { "id": "A1", "releaseDate": "2024-06-27", "promo": true }
  ]
}
```

- `id` : identifiant technique, égal au nom du fichier `data/boosters/<id>.json`.
- `releaseDate` : jour UTC (`YYYY-MM-DD`) à partir duquel le set est **ouvrable**. Absent ou
  illisible = disponible immédiatement. La comparaison utilise le jour UTC **de confiance**
  (`DateSyncManager`), jamais l'horloge de l'appareil.
- `promo` : le set possède des cartes promo (`data/promo_cards/<id>.json`). C'est la seule source des
  groupes promo (`ConfigLoader.getPromoSettings()`).
- **Ordre du fichier** = ordre du sélecteur de boosters.

Trois états, calculés par `BoosterManager.getSetAvailability()` :

| État | Visible dans le sélecteur | Modèle 3D | Ouvrable | Cartes en collection |
|---|---|---|---|---|
| `released` | oui | oui | oui | oui |
| `preview` (dans les `upcomingPreviewDays` jours avant la sortie) | oui, avec la date de sortie | oui | **non** (bouton désactivé, `openBooster()` refuse) | **non** |
| `hidden` (hors fenêtre) | non | non | non | non |

`upcomingPreviewDays: 0` supprime complètement l'avant-première : un set reste invisible jusqu'au
jour de sa sortie. `releaseAnnouncementDays` règle l'autre bout : pendant combien de jours après sa
sortie un set est encore annoncé par `SetAnnouncementPopup` au premier chargement du compte
(0 = jamais). Le catalogue charge **tous** les sets (y compris annoncés) ; ce sont les listes
(`listBoosterSets()`, `getReleasedSetIds()`) qui filtrent, si bien qu'aucune carte d'un set non sorti
ne peut fuiter dans une pioche, une boutique ou un code.

### 4.2 ter Notes de mise à jour (`settings/changelog.json`)

Le fichier de la page « Notes de mise à jour » des Paramètres. Un tableau, une entrée par version
publiée, **dans l'ordre des sorties** :

```json
[
  {
    "Id": 1,
    "Version": "1.0.",
    "Notes": []
  },
  {
    "Id": 2,
    "Version": "1.0.1",
    "Titles": {
      "Fr": "Update de stockage",
      "En": "Storage Update"
    },
    "Notes": [
      {
        "Type": "Feature",
        "IsImportant": true,
        "Text": {
          "Fr": "Possibilité de placer ses boosters pour les stocker en booster bonus.",
          "En": "Ability to store boosters into bonus boosters."
        }
      }
    ]
  }
]
```

- `Id` : entier positif, ordonne les versions. `ConfigLoader.getChangelog()` trie **du plus récent au
  plus ancien**, quel que soit l'ordre du fichier ; un `Id` en double est refusé par le linter.
- `Version` : le numéro affiché tel quel (`1.0.1`). Une entrée sans `Version` est ignorée.
- `Titles` : titre de la mise à jour par langue (`Fr`, `En`), affiché à côté du numéro de version.
  Il est facultatif pour les anciennes entrées ; le linter avertit quand une langue du jeu manque.
- `Notes` : liste de `{ Type, IsImportant, Text }`. `Type` est libre (`Feature`, `Fix`, `QoL` sont
  ceux que le jeu traduit ; tout autre garde son mot d'origine à l'écran), `IsImportant` met la note
  en avant (bordure et étoile), `Text` porte la phrase par langue (`Fr`, `En`).
- Une note sans texte lisible est ignorée à la lecture ; le linter avertit quand une langue du jeu
  manque et refuse un `Id` en double, une `Version` en double ou une note sans `Type`.
- Le fichier est **la seule source** de la page : publier une version ne demande aucune modification
  de code. Il est précaché par le service worker, comme `config.json` et `cardsets.json`.
- La pastille « nouvelle version » du bouton « Réglages » lit le même fichier :
  `ChangelogManager` compare le plus grand `Id` avec `user_state["changelogSeen"]` et allume le point
  tant qu'une version n'a pas été ouverte. Un `Id` retiré ne rallume donc rien.
- Comme tout le shell, le fichier est servi en *stale-while-revalidate* : après une publication, la
  première visite sert encore l'ancienne copie, la suivante la nouvelle. Une vraie livraison
  incrémente `VERSION` dans `sw.js`, ce qui précache la version fraîche dès l'installation.

## 4.3 Autres fichiers de données

| Fichier | Schéma | Consommateur |
|---|---|---|
| `data/promo_cards/<serie>.json` | entrées de cartes identiques à un booster, ou `{ Serie, Name, Cards: [...] }` | `PromoManager` |
| `data/trophies/<setId>.json` | `{ Booster, TrophyList: [ { Name, Rarity, Requirements, MusthaveAllRequirementsCompleted, Experience?, Icon } ] }` ; `RequirementType: "CardList"` avec `Layout` | `TrophyManager` |
| `data/titles/<setId>.json` | `{ Booster, CollectionTitle: [ { CollectionTrophy, UnlockedTitle: [ { id, text: { fr, en } } ] } ] }` | `TitleManager` |
| `data/profile_icons/<setId>.json` | `{ Booster, CollectionTrophy: [ { CollectionTrophy, UnlockedIcon: [...] } ] }` | `ProfileIconManager` |
| `data/icon.json` | liste `{ file, name }` des avatars débloquables par trophée | `ProfileIconManager` |
| `data/shop/pinned_offers.json` | liste `{ OfferID, MaxUse, Card: { Index, isPromotional? }, Price: { <ressource>: n }, Period: { Min, Max } }` | `TraderManager` |
| `settings/default_profile_icons.json` | liste `{ file, name, defaultProfile?, requiredLevel?, price? }` des avatars de départ : `requiredLevel` et `price` (Sparks) sont optionnels et cumulables | `ProfileIconManager` |
| `settings/default_titles.json` | liste `{ id, requiredLevel, text: { fr, en } }` | `TitleManager` |
| `settings/defaultRarity.json` | par emplacement du pack (`"1"`…`"5"`) : liste `{ rarity, weight }` | `GachaEngine` |
| `settings/codes.json` | liste de codes : `{ Code, Rewards, Availabilities, Repeatable, AutoClaim? }` (une récompense peut cibler une carte, un layout ou plusieurs ; `AutoClaim = { Auto, RequiredLevel, RequiredOpenBoosterStats, CustomMessage }`, interdit sur un code répétable). Un code qui donne du contenu d'une extension pas encore sortie est refusé en bloc (`content_not_released`), sans aucune écriture : il reste utilisable après la sortie | `RedeemManager`, `AutoClaimManager` |
| `settings/mining.json` | `{ Cracks: [ { Range: { Min, Max }, Texture } ], Blocks: [ { ID, Name_FR, Name_EN, Weight, Hardness, Rewards } ] }` | `MiningManager` |
| `settings/overlay.json` | `timings` (durées de la timeline), `booster.spinStepPerFrame`, `easing`, `sound` | `js/overlay.js` |
| `settings/sounds.json` | carte des sons d'interface : `event`, `file` (sous `assets/sound/ui/`), `_comment`, `enabled` | `SoundManager` (+ `UiSounds`) |
| `settings/cardsets.json` | `{ sets: [ { id, releaseDate, promo } ] }` : identifiants, date de sortie UTC et présence de promos | `ConfigLoader`, `BoosterManager` |
| `settings/changelog.json` | liste de versions `{ Id, Version, Notes: [ { Type, IsImportant, Text: { Fr, En } } ] }` : les notes de mise à jour, triées par `Id` décroissant à la lecture (§4.2 ter) | `ConfigLoader`, `SettingsView` |
| `settings/daily_connect_rewards.json` | liste de chapitres `{ ID, RewardListName, Dates: { Start, End }, Days: [ { Day, Reward, Unique?, UniqueID?, ReplacementRewardIfClaimed? } ] }` : les récompenses de connexion, un jour par entrée, `Day: null` pour l'entrée par défaut. Schéma complet et règles dans [05-daily-rewards.md](05-daily-rewards.md) | `DailyRewardManager` |
| `settings/boosters_trophy.json` | paliers récurrents par extension (complétion, boosters ouverts) | `TrophyManager` |
| `settings/global_trophy.json` | paliers globaux (cartes, boosters, cartes différentes, blocs minés, pioches, quêtes terminées, jours de connexion, cartes vendues, niveau) | `TrophyManager` |
| `settings/ui` | pas de fichier : toute la copie passe par `settings/i18n/` | — |

**Aucun de ces fichiers n'est possédé par le joueur** : ils sont en lecture seule et servis par le
serveur.Un fichier absent n'est jamais une erreur bloquante (une médaille retombe sur `default.png`, etc.). Les catalogues attendus par extension, eux, existent **toujours** : `python tools/sync_catalogs.py` crée `data/titles/<setId>.json`, `data/trophies/<setId>.json` et `data/profile_icons/<setId>.json` pour chaque set déclaré, plus `data/promo_cards/<setId>.json` pour chaque set `promo`, avec une liste vide quand il n'y a encore rien à déclarer, et ne touche jamais un fichier existant (`--check` pour la CI, `--dry-run` pour voir sans écrire).

## 4.4 Internationalisation

- Dictionnaires : `settings/i18n/fr.json`, `settings/i18n/en.json`, chargés par `I18n`.
- Les clés sont hiérarchiques (`view.opening.title`, `mineblock.resource.stone_dust`,
  `notif.collection.complete`, …). Le markup porte `data-i18n="clé"` et `data-i18n-aria-label` pour
  les libellés accessibles.
- `I18n.t(key, { params })` remplace les `{placeholders}` ; une clé absente retourne la clé, jamais
  une exception.
- Le changement de langue est **à chaud** : `LANG_CHANGED` retraduit le DOM marqué et les chemins
  d'images, sans rechargement ; un miroir `localStorage["mc_lang"]` évite le flash au prochain
  démarrage.
- Les noms de cartes viennent des fichiers d'extension (`Name_FR`/`Name_EN`), pas des dictionnaires.
- Les noms de ressources de la mine et de blocs viennent de `settings/mining.json` ; leur libellé
  traduit est une clé `mineblock.resource.<slug>` avec repli sur le `Type` brut.

## 4.5 Service worker et caches

`sw.js` gère trois caches préfixés `minecards-` :

| Cache | Contenu | Stratégie |
|---|---|---|
| `shell-<VERSION>` | HTML, CSS, tous les modules ES, `settings/`, catalogues, dos de carte, sons, modèle 3D, polices | précache à l'installation, lu en **repli hors-ligne** seulement (`ignoreSearch`, car la page demande `?v=<hash>`) |
| `cdn-<VERSION>` | Three.js, `GLTFLoader`, `RoomEnvironment`, `BufferGeometryUtils` (épinglés r160) | *cache-first* |
| `runtime-<VERSION>` | illustrations `cards/` et visuels de boosters, plus les fichiers absents du shell | *stale-while-revalidate* pour les images, rempli à l'usage |

- `VERSION` doit être incrémenté à **chaque changement du shell** ; `activate` ne purge que les
  caches préfixés `minecards-` (les autres projets de l'hôte sont laissés intacts).
- Une page déjà contrôlée se recharge **une seule fois** à `controllerchange` quand un nouveau worker
  prend la main (`skipWaiting` + `claim`) : la nouvelle version remplace l'ancienne sans attendre la
  visite suivante. Une première visite n'est jamais rechargée — sans contrôleur précédent, la page
  tourne déjà sur la version que le worker vient de précacher, et le rechargement relancerait
  l'onboarding.
- La navigation est *network-first* avec repli `index.html` : jamais de HTML périmé servi
  silencieusement. La requête part en `cache: 'no-cache'`, comme les modules, donc le navigateur
  revalide sa copie au lieu de resservir la page précédente pendant les dix minutes de `max-age`
  de l'hôte.
- **Les images sont la seule famille servie depuis un cache en ligne** (*cache-first*). CSS, modules,
  sons et JSON sont *network-first* : le réseau fait foi, le cache ne répond que s'il échoue. C'est
  ce qui empêche une copie périmée de survivre à une mise à jour, même sans `VERSION` bumpée, et ce
  qui garde les caches petits (seules les illustrations s'y ajoutent). Ces requêtes sortent en
  `cache: 'no-cache'` : le cache HTTP du navigateur revalide auprès du serveur au lieu de resservir
  un module vieux de dix minutes, ce qui mélangeait deux releases au démarrage.
- Sont exclus du cache : requêtes `no-store`/`reload`/`no-cache`, requêtes `Range`, cross-origin hors
  CDN (API d'heure, Google Sheet), le worker lui-même et les fichiers privés (`admin/`, `.docs/`).
- `.well-known/assetlinks.json` est également exclu : c'est le fichier Digital Asset Links de l'app
  Android, et un vérificateur doit toujours lire la copie servie. Il est publié à la racine du
  domaine (`https://web.jmdev.fr/.well-known/assetlinks.json`), jamais sous le sous-dossier du jeu :
  le fichier est donc à la racine du dépôt du site (`../../.well-known/`), et `_config.yml` l'inclut
  car GitHub Pages/Jekyll ignore les dossiers commençant par un point.
- Les illustrations (374 Mo) ne sont précachées **qu'à l'usage** : une carte jamais affichée n'est
  pas disponible hors-ligne.

## 4.6 Export/import de sauvegarde (aperçu)

- Format `.save` version 1 : JSON → `deflate` (`CompressionStream`) → Base64, fichier
  `backup_cards_YYYY-MM-DD.save`, plafonné à 32 Mio.
- L'import remplace les quatre ObjectStores en **une seule transaction**, valide strictement la
  version et l'UUID, puis recharge la page. Détails complets dans `database.md` §5.
- L'export est reconstruit depuis la base vivante : aucune donnée n'est mise en cache à part.

## 4.7 Règles de qualité appliquées aux données

- **JSON strict** : le linter refuse un JSON invalide ou une clé déclarée deux fois.
- **Cartes** : un `Index` n'est imprimé qu'une fois par `Layout` (`classic` / `fullart`), dans un
  catalogue comme entre catalogues : c'est la clé de collection, donc un doublon ferait disparaître
  une impression sans qu'aucun écran ne le montre. Le linter vérifie aussi l'index, le layout, la
  rareté, le style, les noms et descriptions par langue, et que le nom de l'image correspond à
  l'index et au layout.
- **Références** : tout fichier qui nomme une carte doit nommer une carte qui existe - reward de
  code, offre épinglée du marchand, exigence de trophée (et l'impression demandée aussi) - et tout
  fichier qui nomme un trophée, une icône ou un titre doit nommer quelque chose qui existe.
- **Catalogues** : un set est déclaré une fois, possède son `data/boosters/<setId>.json`, sa date de
  sortie est un jour réel, et son drapeau `promo` correspond à `data/promo_cards/`.
- **Notes de mise à jour** : chaque version a un `Id` positif unique, un numéro unique, et un titre
  traduit dans chaque langue du jeu quand `Titles` est présent ; chaque note a un `Type` et un texte
  dans chaque langue du jeu (avertissement pour une langue manquante, erreur pour un doublon).
- **Économie** : les prix en Sparks couvrent les cinq raretés, `shop.itemsValues` ne nomme que des
  ressources réellement minées, une offre épinglée n'est payée qu'en ressources connues et sur une
  fenêtre non vide, et les blocs de la mine ont un poids, une dureté et des récompenses valides ;
  une table de rareté tire des raretés 1-5 et ses poids totalisent 1.
- **Fichiers référencés** : le linter avertit quand une illustration, une médaille ou un son cité par
  un fichier de données est absent (le jeu a un repli, donc c'est un avertissement, pas une erreur).
- **Chemins** : les chemins de données commencent par `./` ou `assets/` ; ils sont normalisés à la
  lecture (`MiningManager.normalizeAssetPath`).
- **Aucune donnée du joueur dans un fichier statique** : UUID, soldes, progression et préférences
  vivent exclusivement dans IndexedDB et le miroir `localStorage`.

### L'Illager Shop (`data/illager_shop/`)

Deux fichiers, lus par `js/business/IllagerShopManager.js`.

`illager_currencies.json` — une monnaie par entrée :

| Champ | Rôle |
| --- | --- |
| `ID` | identifiant stable, le seul nom qu'un code ou une récompense de connexion doit donner (`AllaysCurrency`) |
| `Name` | nom affiché dans le portefeuille du dialogue |
| `Texture` | icône, sous `assets/` |
| `ExpirationDate` | dernier jour où la monnaie vaut quelque chose (`YYYY-MM-DD`) |
| `ConversionRate` | Sparks crédités par unité restante le lendemain de l'expiration |
| `Quests` | les quêtes de la monnaie (voir ci-dessous), facultatif |

Une quête est `{ ID, StartDate, ExpirationDate?, Type, RequirementsToUnlock, RewardCurrency,
RewardSparks, RewardXP }`. `Type` vaut `OpenBooster_Daily`, `DailyRewardClaim`, `SellCard`,
`MineBlock`, `ShareBinder`, `MinePickCards` ou `DownloadProfilCard` ; `ExpirationDate` est
facultative et retombe sur celle de la monnaie, qui reste le plafond. La règle de lint
`data/illager-shop` vérifie ces quêtes : identifiants uniques dans tout le fichier, jours réels,
`StartDate` avant l'expiration de la quête ET de la monnaie, type connu, objectif positif et
récompenses entières non négatives.

`illager_shop.json` — un set d'offres par entrée : `ID`, `SetName`, `Availabilities { Start, End }`
(les deux bornes incluses, horloge UTC), `CurrencyUsed` (un `ID` du fichier ci-dessus) et `TradeSet`.
Un trade est `{ Price, Rewards, Repeatable }` : `Price` se paie dans la monnaie du set, `Rewards`
accepte `Sparks`, `Ultima`, `Card` (`Data` = `<Index>_<layout>`, par exemple
`PROMO-A1 _ E01_fullart`) et `Booster` (`Data` = identifiant de série). `Repeatable: false` limite
le trade à un achat, pour la durée du set.

Le solde et les compteurs d'achats vivent dans `user_state["illagerShop"]`
(`{ balances: { [ID]: montant }, purchases: { [setId]: { [trade]: n } } }`). La règle de lint
`data/illager-shop` vérifie ces deux fichiers : identifiants uniques, jours réels, fenêtre cohérente,
monnaie déclarée, et chaque carte ou série nommée par une récompense.

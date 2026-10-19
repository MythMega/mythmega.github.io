# 1. Architecture

## 1.1 Principe général

MineCards est une application **full client** : tout s'exécute dans le navigateur. Il n'y a ni API
applicative, ni base distante, ni session serveur. Le seul état durable est IndexedDB, et le seul
« backend » est un ensemble de fichiers statiques servis par un simple serveur HTTP.

Trois conséquences structurent tout le code :

1. **Aucune construction** : les modules ES sont servis tels quels. Il n'y a ni bundler, ni
   minification, ni variables d'environnement. Ajouter un fichier suffit à l'ajouter au graphe ;
   `sw.js` doit en revanche être mis à jour à la main pour le précacher.
2. **Une dépendance externe unique** : Three.js est épinglé à la version `0.160.0` par l'import map
   de `index.html`. `Booster3DRenderer` l'importe dynamiquement (`three`,
   `three/addons/loaders/GLTFLoader.js`, `three/addons/environments/RoomEnvironment.js`) et
   retombe sur l'image 2D si l'import échoue.
3. **La séparation des responsabilités est stricte** : une vue ne parle jamais directement à
   IndexedDB, un manager ne connaît jamais le DOM. Le lien entre les deux est le bus d'événements.

## 1.2 Arborescence et dépendances

Le sens des dépendances est à sens unique :

```
UI (vues, composants)  ──►  business (managers)  ──►  models/classes  ──►  IndexedDB
        │                          │
        └───────── utils ──────────┘   (EventBus, I18n, ConfigLoader, ThemeManager, …)
```

- `js/models/StorageRepository.js` est le **seul** module qui ouvre IndexedDB. Il expose des
  opérations CRUD et surtout `transaction(mode, stores, callback)`, qui ne résout qu'après le
  `oncomplete` réel d'IndexedDB.
- `js/classes/` ne contient que des structures de données : `Card` (catalogue + helpers de
  traduction) et `SaveFile` (export/import de la sauvegarde).
- `js/business/` contient la logique : un manager par domaine (compte, quota/horloge, gacha,
  boosters, collection, mine, mine pick, marchand, trophées, titres, profil, cartes promo, codes,
  cadeaux, Sparks, fonctionnalités achetées, binders, carte de profil).
- `js/UI/views/` contient un fichier par écran. Chaque vue construit son propre DOM dynamique mais
  lit son squelette dans `index.html` via des attributs `data-*`.
- `js/UI/components/` contient les composants partagés : carte (`CardComponent`), modale de
  trophée (`TrophyDetail`), notifications (`NotificationCenter`, `GameNotifier`), toasts (`Toast`),
  aide de page (`ViewHelp`), scène 3D (`Booster3DRenderer`), carte de profil (`ProfileCard`).
- `js/utils/` contient des utilitaires sans dépendance métier : `EventBus`, `I18n`,
  `ConfigLoader`, `ThemeManager`, `FoilManager`, `GlowManager`, `AnimationManager`, `SoundManager`,
  `Shine`, `Compression`, `Clipboard`, `DeepLink`, `FocusMode`, `BinderCode`, `BoosterCode`.

Aucun module de `business/` n'importe une vue ; aucun module de `UI/` n'importe `StorageRepository`
directement.

## 1.3 Démarrage de l'application

`js/app.js` expose `App` et est instancié par `index.html` en fin de page. La séquence est :

1. **Bootstrap pré-rendu** (script inline dans `<head>`) : lit le miroir `localStorage`
   (`mc_theme`, `mc_lang`), pose `data-theme` sur `<html>`, met à jour `<meta name="theme-color">`
   et installe un filet de sécurité qui retire l'écran de chargement après 10 s.
2. **`App.init()`** : vérifie `StorageRepository.isSupported()`, ouvre la base, puis
   `AccountManager.hasAccount()`.
   - Pas de compte → `startOnboarding()` : écran de bienvenue, création ou import d'une sauvegarde.
   - Compte existant → `startMainApp()`.
3. **`startMainApp()`** :
   - lit `settings` et applique langue, thème, mode d'animation, son, foil/brillance, halo des
     trophées, durée et familles de notifications ;
   - garantit l'existence des états `profile`, `trophies` et `binders` ;
   - détruit l'écran d'accueil, démarre le routeur sur la vue par défaut (`opening`) ;
   - branche les compteurs d'en-tête, l'inventaire des bonus, le compteur de binders et le cycle de
     vie des vues ;
   - synchronise l'heure UTC (`DateSyncManager`) ;
   - construit les vues **dans l'ordre** : ouverture, collection, profil, statistiques, trophées,
     titres, mine pick, mine, paramètres, redeem, cadeaux, informations ;
   - traite le lien profond `?Redeem=` éventuel ;
   - évalue une première fois trophées puis titres **en silence**, puis arme les notifications ;
   - démarre l'horloge de secours si la synchronisation a échoué.
4. **`App.destroy()`** existe pour les tests et les resets : il détruit toutes les vues et désabonne
   les écouteurs.

Points importants :

- Les vues sont construites **une fois** ; elles ne sont jamais détruites quand on change d'onglet.
  Elles réagissent à `VIEW_CHANGED` pour charger leurs données et libérer leurs ressources chères
  (la boucle WebGL de l'ouverture, par exemple).
- `EVENTS.SAVE_IMPORTED` et `ACCOUNT_REMOVED` déclenchent un rechargement complet de la page : la
  base, l'UUID et tous les caches ont changé d'identité.

## 1.4 Routeur SPA

`js/UI/SpaRouter.js` ne possède **aucune table de routes**. Il découvre les vues dans le document :

- toute `<section class="view" data-view="<nom>">` est une vue ;
- tout bouton `[data-nav-target="<nom>"]` est une destination ;
- `show(name)` pose `is-active` sur la vue demandée, met à jour `aria-hidden`, remonte en haut de
  page et émet `EVENTS.VIEW_CHANGED` avec `{ view, previousView }`.

Les vues qui ne sont pas dans la barre du bas (statistiques, trophées, titres) sont atteintes par
des boutons du profil et rappellent `router.show(...)`. Les panneaux « codes » et « cadeaux » ne
sont pas des vues du routeur : ce sont des sections de la page Paramètres, câblées séparément par
`App.startRedeemView()` et `App.startGiftsView()`.

La vue `titles` est découverte par le routeur comme les autres (`data-view="titles"`), même si
`VIEW_NAMES` de `app.js` ne la liste pas.

## 1.5 Bus d'événements

`js/utils/EventBus.js` est un pub/sub global. Il expose `on`, `once`, `off`, `emit` et un
dictionnaire figé `EVENTS`. Chaque manager publie son résultat après l'écriture ; les vues ne
reçoivent jamais de références directes aux managers pour se rafraîchir.

| Événement | Payload | Émis par | Écouté par (exemples) |
|---|---|---|---|
| `LANG_CHANGED` | `{ lang, previousLang }` | `I18n` | toutes les vues (retraduction sans rechargement) |
| `THEME_CHANGED` | `{ theme, previousTheme }` | `ThemeManager` | `SettingsView`, décor ciel/nuit |
| `ANIMATION_CHANGED` | `{ mode, previousMode, parodic }` | `AnimationManager` | `OpeningView` |
| `FOIL_INTENSITY_CHANGED` / `GLARE_INTENSITY_CHANGED` | `{ percent, previousPercent, intensity }` | `FoilManager` | `SettingsView` |
| `VIEW_CHANGED` | `{ view, previousView }` | `SpaRouter` | toutes les vues (activation/désactivation) |
| `QUOTA_UPDATED` | `{ daily, bonusBySet, bonusTotal, availableForSet }` | `DateSyncManager` | en-tête, `OpeningView` |
| `CLOCK_TICK` | `{ utc, formatted, timeUntilReset }` | `DateSyncManager` | en-tête, vues à compte à rebours |
| `CONNECTION_STATUS` | `{ online }` | `DateSyncManager` | en-tête |
| `BOOSTER_OPENED` | `{ setId, cards, newKeys, source, quantity, remaining }` | `BoosterManager` | `OpeningView`, collection, statistiques |
| `ACCOUNT_CREATED` / `ACCOUNT_REMOVED` | `{ uuid }` / `null` | `AccountManager` | `App` |
| `SAVE_IMPORTED` | `{ uuid }` | `SaveFile` | `App` |
| `GIFTS_UPDATED` | `{ count, lines }` | `GiftManager` | `GiftsView` |
| `SPARKS_UPDATED` | `{ balance }` | `SparksManager` | en-tête, profil, boutiques |
| `PROFILE_UPDATED` | `{ profile }` | `ProfileManager` | profil, carte de profil |
| `FAVORITES_UPDATED` | `{ favorites }` | `ProfileManager` | collection |
| `CARD_REVEALED` | `{ setId, card, revealed, total }` | `OpeningView` | `GameNotifier` |
| `REVEAL_FINISHED` | `{ setId }` | `OpeningView` | `GameNotifier` |
| `CARDS_OBTAINED` | `{ cards, newKeys, source }` | `SparksManager`, `RedeemManager`, `GiftManager`, `MinePickManager`, `TraderManager` | `GameNotifier`, collection, trophées |
| `TROPHY_UNLOCKED` | `{ trophies }` | `TrophyManager` | `GameNotifier`, profil |
| `TITLE_UNLOCKED` | `{ titles }` | `TitleManager` | `GameNotifier` |
| `EXPERIENCE_UPDATED` | `{ experience, level }` | `TrophyManager` | profil, statistiques |
| `MINE_PICK_UPDATED` | `{ day, remaining, picksPerDay, totalPicks }` | `MinePickManager` | `MinePickView`, statistiques |
| `MINING_UPDATED` | `{ day, minedToday, remaining, blocksPerDay, totalMined }` | `MiningManager` | `MineBlockView`, statistiques |
| `TRADER_UPDATED` | `{ week, offers }` | `TraderManager` | `MineBlockView` |
| `BINDERS_UPDATED` | `{ binders }` | `BinderManager` | liste des binders, compteur d'en-tête |
| `FEATURE_UNLOCKED` | `{ id, priceSparks, balance }` | `FeatureManager` | profil, carte de profil |

Règles : un événement est émis **après** la persistance (jamais avant) ; un abonnement renvoie une
fonction de désabonnement que chaque vue conserve pour son `destroy()`.

## 1.6 Managers et leurs responsabilités

| Manager | Rôle | Clés écrites | Événements émis |
|---|---|---|---|
| `AccountManager` | Compte local, réglages, création/reset, UUID immuable | `account`, `settings` | `ACCOUNT_CREATED`, `ACCOUNT_REMOVED` |
| `DateSyncManager` | Heure UTC fiable, quota quotidien, ancrage hors-ligne | `quota`, `timeAnchor` | `QUOTA_UPDATED`, `CLOCK_TICK`, `CONNECTION_STATUS` |
| `GachaEngine` | Tirage pondéré d'un booster (5 cartes), godpack | — (pur) | — |
| `BoosterManager` | Ouverture/persistance d'un pack, achat d'un booster, stats, historique | `stats`, `boosterHistory`, `sparks` | `BOOSTER_OPENED` |
| `CollectionManager` | Catalogue complet, complétion, silhouettes, tri/filtres | — (lecture) | — |
| `SparksManager` | Monnaie, vente/achat de cartes, transactions atomiques | `sparks`, `collection` | `SPARKS_UPDATED`, `CARDS_OBTAINED` |
| `MinePickManager` | Plateau déterministe du jour, pioches, achat de pioche | `minePick`, `collection` | `MINE_PICK_UPDATED`, `CARDS_OBTAINED` |
| `MiningManager` | Blocs du jour, coups, butin, ressources | `mining`, `sparks` | `MINING_UPDATED` |
| `TraderManager` | Boutique hebdomadaire, offres épinglées, échanges du jour | `trader`, `collection`, `mining`, `sparks` | `TRADER_UPDATED`, `CARDS_OBTAINED`, `MINING_UPDATED` |
| `TrophyManager` | Catalogue des trophées, déblocages, XP et niveau | `trophies` | `TROPHY_UNLOCKED`, `EXPERIENCE_UPDATED` |
| `TitleManager` | Catalogue des titres, déblocage dérivé | — (dérivé) | `TITLE_UNLOCKED` |
| `ProfileManager` | Identité, favoris, trophées épinglés, titre porté | `profile` | `PROFILE_UPDATED`, `FAVORITES_UPDATED` |
| `ProfileIconManager` | Catalogue d'avatars, déblocage par trophée | — (lecture) | — |
| `ProfileCardManager` | Projection du compte en carte à collectionner | `profileCard` | — |
| `PromoManager` / `PromoSet` | Chargement des cartes promo par série | — (lecture) | — |
| `RedeemManager` | Codes de `codes.json` et codes personnels `useritem` | `redeemed_codes`, `collection`, `sparks`, `quota` | `CARDS_OBTAINED`, `SPARKS_UPDATED` |
| `GiftManager` | Distributions du Google Sheet | `gifts_received`, `giftSync`, `collection`, `quota`, `sparks` | `GIFTS_UPDATED`, `CARDS_OBTAINED` |
| `BinderManager` | Binders (30 emplacements), limite de niveau, réconciliation | `binders` | `BINDERS_UPDATED` |
| `FeatureManager` | Fonctionnalités payées (Full Art, couleurs de titre) | `purchases`, `sparks` | `FEATURE_UNLOCKED` |
| `UserItemCode` | Vérification des codes personnels signés | — (lecture) | — |

## 1.7 Chargement de la configuration et des données

`js/utils/ConfigLoader.js` est le point d'entrée unique des fichiers statiques. Il :

- télécharge `settings/config.json` et `settings/i18n/<lang>.json` avec un repli intégré si le
  fichier manque ou est corrompu ;
- expose des accesseurs normalisés (`getBoosterSettings`, `getMinePickSettings`,
  `getMiningSettings`, `getLevelling`, `getExperiencePerTrophy`, `getProfileCard`, `getFeatures`,
  etc.) qui **remplacent toute valeur absente ou invalide par un défaut sûr** ;
- met en cache les réponses et sait forcer un rechargement sans cache (`?nocache=1`, paramètre de
  contournement du mode développeur).

Cette politique « normaliser plutôt que rejeter » est générale : un `.save` ancien, un
`config.json` modifié ou une valeur saisie à la main ne doivent jamais empêcher le jeu de
démarrer. Les managers normalisent aussi leurs lectures (`DateSyncManager.normalizeQuota`,
`BoosterManager.normalizeStats`, `ProfileManager.normalizeProfile`, …).

## 1.8 Performance et chargement de la scène 3D

Le chargement du booster 3D est le point chaud sur mobile et sur les connexions distantes. Les
choix retenus par `Booster3DRenderer` :

- **Un seul vague de téléchargement** : `init()` lance en parallèle l'import de Three.js, l'import du
  `GLTFLoader`, le téléchargement du `.glb` (`fetch` + `parseAsync`) et celui de la texture
  (blob local). Ces quatre téléchargements étaient auparavant **séquentiels** (Three.js, puis le
  loader, puis l'environnement, puis le modèle, puis la texture), soit un aller-retour réseau de
  plus à chaque étape.
- **Modules préchargés** : `index.html` déclare `preconnect` vers le CDN et `modulepreload` pour
  Three.js, `GLTFLoader`, `RoomEnvironment` et `Booster3DRenderer`. Pendant que l'application
  démarre, le navigateur télécharge déjà la scène.
- **Mémoire de page** : les octets du modèle et la texture sont conservés dans des caches de
  module ; la deuxième scène (et chaque ouverture suivante) ne retélécharge rien.
- **Environnement différé** : le rendu PMREM du studio (`RoomEnvironment`) n'est plus attendu par
  `init()` ; il est construit ~250 ms après, une fois le booster affiché.
- **Réutilisation de l'aperçu** : quand le joueur presse « Ouvrir », la scène 3D de l'aperçu de
  l'écran de sélection est **adoptée** par la scène d'ouverture (`adopt()` déplace le canvas et
  rebranche les interactions) au lieu d'être détruite puis reconstruite.
- **Libération en arrière-plan** : quitter la vue arrête la boucle de rendu et un délai de 30 s
  libère le contexte WebGL si le joueur ne revient pas.

Autres choix de performance : le service worker précache le shell et les modules CDN, les
illustrations (374 Mo) restent en cache à l'usage, et les vues ne sont construites qu'une fois.

## 1.9 Gestion des erreurs, journalisation, linter

- **Journalisation** : chaque module journalise avec un préfixe (`[App]`, `[OpeningView]`,
  `[Booster3DRenderer:preview:A1]`, …) via `console.info` / `console.warn` / `console.error`. Le
  linter interdit `console.log` et `debugger`.
- **Erreurs métier** : les managers lèvent des erreurs avec un `code` stable
  (`NO_BOOSTER_AVAILABLE`, `INSUFFICIENT_SPARKS`, `BINDER_LIMIT_REACHED`, …) que les vues
  traduisent en clé i18n ; les messages techniques ne sont jamais montrés au joueur.
- **Panne isolée** : une vue qui échoue à démarrer n'empêche pas le reste de l'application (le
  démarrage est séquentiel mais chaque `start*` attrape ses propres erreurs).
- **Linter** (`tools/lint.mjs`, 23 règles) : hygiène des fichiers texte, `node --check` sur chaque
  module, en-tête de module et bloc JSDoc par fonction, `var`/`==`/`console.log`/`debugger`,
  imports non résolus ou dupliqués, cohérence du markup et des clés i18n, existence des fichiers
  référencés. Deux niveaux seulement : erreur (bloquant) et avertissement (ressource attendue mais
  absente, comme un son non livré).

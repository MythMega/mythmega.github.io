# Base de données et persistance

Toute la progression du joueur vit **dans le navigateur**. Il n'y a ni base distante, ni compte
serveur, ni cookie. Ce document décrit :

1. le magasin principal IndexedDB (`CardBoosterDB`) ;
2. les clés de `user_state`, une par une, avec leur schéma ;
3. les autres ObjectStores ;
4. le miroir `localStorage` ;
5. le format d'export/import `.save` ;
6. les transactions et leur atomicité ;
7. migrations, quotas et cycle de vie.

---

## 1. Vue d'ensemble

```
                     ┌───────────────────────────────────────────────┐
                     │              Navigateur (origine)             │
                     │                                               │
   application ────► │  IndexedDB : CardBoosterDB v1                 │
                     │   ├── collection       (keyPath "key")        │
                     │   ├── user_state       (clé hors-ligne)       │
                     │   ├── redeemed_codes   (keyPath "code")       │
                     │   └── gifts_received   (keyPath "line")       │
                     │                                               │
                     │  localStorage (miroir seulement)              │
                     │   ├── mc_theme   (thème, anti-flash)          │
                     │   └── mc_lang    (langue, anti-flash)         │
                     └───────────────────────────────────────────────┘
```

- **Nom de la base** : `CardBoosterDB` (`DB_NAME`).
- **Version de schéma** : `1` (`DB_VERSION`).
- **Point d'accès unique** : `js/models/StorageRepository.js`. Aucun autre module n'ouvre
  `indexedDB`.
- **Aucun index** n'est déclaré : les lectures sont toujours faites par clé primaire
  (`getItem`/`setItem`) ou par énumération complète (`getAll`, `getAllKeys`). Les volumes sont
  petits (quelques centaines de lignes de collection, quelques dizaines d'entrées d'historique).

### Déclarations (extrait de `StorageRepository.js`)

```js
export const DB_NAME = 'CardBoosterDB';
export const DB_VERSION = 1;

export const STORES = { COLLECTION: 'collection', USER_STATE: 'user_state',
                        REDEEMED_CODES: 'redeemed_codes', GIFTS_RECEIVED: 'gifts_received' };

const STORE_DEFINITIONS = [
  { name: STORES.COLLECTION,     keyPath: 'key' },   // clé en ligne
  { name: STORES.USER_STATE,     keyPath: null },    // clé hors-ligne (texte)
  { name: STORES.REDEEMED_CODES, keyPath: 'code' },  // clé en ligne
  { name: STORES.GIFTS_RECEIVED, keyPath: 'line' },  // clé en ligne
];
```

`user_state` est le **seul** magasin à clé hors-ligne : la clé est passée séparément à `put(key)`,
donc la valeur elle-même est du JSON nu (nombre, booléen, objet, tableau), pas un enregistrement
enveloppé.

---

## 2. ObjectStore `collection`

Une ligne par **carte possédée**, pas par copie.

| Champ | Type | Description |
|---|---|---|
| `key` | `string` | clé primaire : `${id}_${style}` (ex. `SERIE-A1 _ W001_classic`) |
| `cardId` | `string` | champ `Index` du fichier d'extension (ex. `SERIE-A1 / W001`) |
| `style` | `'normal'` \| `'fullart'` | impression (dérivée du `Layout`) |
| `set` | `string` | identifiant de l'extension (ex. `A1`) |
| `quantity` | `number` ≥ 1 | nombre de copies possédées |
| `firstObtainedAt` | `string` ISO 8601 | date de la **première** copie |
| `lastObtainedAt` | `string` ISO 8601 | date de la **dernière** copie |

Règles :

- Toute nouvelle carte passe par `BoosterManager.addCardToCollection()` (ou l'écriture inline
  équivalente de `RedeemManager`/`GiftManager`) : `quantity += 1`, `lastObtainedAt` mis à jour,
  `firstObtainedAt` conservé s'il existe.
- Les dates viennent du **temps fiable** (`buildCollectionTimestamp()` : jour UTC + heure de
  `DateSyncManager`) ; sans ancrage, l'horloge locale est utilisée en dernier recours et la date ne
  sert qu'à l'affichage et au tri.
- Vendre décrémente `quantity` et supprime la ligne à zéro (`SparksManager`).
- Le catalogue complet n'est **pas** stocké : il est reconstruit depuis `data/boosters/*.json` et
  `data/promo_cards/*.json`. Une carte du catalogue absente de `collection` est une carte manquante.
- Les cartes promo ne sont écrites qu'à l'obtention (pas de ligne « vide »).

---

## 3. ObjectStore `user_state`

Seize clés, toutes définies par `USER_STATE_KEYS` (`js/business/AccountManager.js`).

| Clé | Type | Fiche |
|---|---|---|
| `account` | objet | identité locale |
| `settings` | objet | préférences du joueur |
| `quota` | objet | quota quotidien des boosters |
| `timeAnchor` | objet | ancrage de l'horloge UTC |
| `stats` | objet | statistiques d'ouverture |
| `boosterHistory` | tableau | dernières ouvertures |
| `giftSync` | objet | curseur de lecture du Google Sheet |
| `sparks` | nombre | monnaie |
| `profile` | objet | identité affichée et épingles |
| `trophies` | objet | trophées débloqués |
| `minePick` | objet | état de la Mine Pick |
| `mining` | objet | état de la Mine |
| `trader` | objet | état du Marchand |
| `binders` | tableau | binders du joueur |
| `purchases` | objet | fonctionnalités payées |
| `profileCard` | objet | préférences de la carte de profil |

### 3.1 `account`

```json
{ "uuid": "8b1c…-…", "createdAt": "2026-10-07T12:00:00.000Z" }
```

- `uuid` : UUID v4 généré par `crypto.randomUUID()`, validé par `UUID_V4_PATTERN`.
- **Son existence signifie « un compte existe »** : c'est la seule condition qui décide entre
  l'écran d'accueil et l'application.
- Immuable : l'UUID est exporté dans le `.save` et restauré tel quel à l'import. Le reset complet
  le supprime.

### 3.2 `settings`

```json
{
  "lang": "fr",
  "theme": "dark",
  "sound": true,
  "animation": "epic",
  "foilIntensity": 100,
  "glareIntensity": 100,
  "glowTrophies": 2,
  "notificationDuration": 3,
  "notificationTypes": { "collection": true, "experience": true, "title": true },
  "devMode": false,
  "boosterRenderMode": "blister"
}
```

- Toute valeur est **normalisée à la lecture** : langue inconnue → langue courante, thème inconnu →
  défaut, animation inconnue → défaut, pourcentages hors bornes → ramenés dans la plage, mode de
  rendu inconnu → `boosterRender.defaultMode`, `sound` n'est coupé que par un `false` explicite,
  `devMode` ne s'active que par un `true` explicite.
- Les défauts viennent de `settings/config.json` (`defaultLang`, `defaultTheme`, `foil`,
  `notifications`, `glow`, `boosterRender`).
- **Miroir** : `lang` et `theme` sont recopiés dans `localStorage` (`mc_lang`, `mc_theme`) pour le
  rendu avant premier paint. La valeur IndexedDB reste la seule autoritaire.

### 3.3 `quota`

```json
{
  "lastResetDay": "2026-10-18",
  "dailyRemaining": 2,
  "bonusBoosters": { "A1": 3 },
  "purchasedBoosters": 1
}
```

- `lastResetDay` : jour UTC (`YYYY-MM-DD`) du dernier reset ; un jour différent déclenche le reset à
  minuit UTC (`dailyRemaining = boosters.dailyFreeBoosters`, 3).
- `dailyRemaining` : boosters **gratuits** restants, valables sur n'importe quelle extension.
- `bonusBoosters` : quantité par extension, **jamais** remise à zéro par le reset (cadeaux, codes).
- `purchasedBoosters` : boosters achetés en Sparks, globaux, jamais remis à zéro.
- Ordre de consommation : quotidien → bonus de l'extension → achetés.
- Un jour stocké **en avance** sur le jour fiable est refusé (protège contre une horloge trafiquée).

### 3.4 `timeAnchor`

```json
{ "sessionId": "…", "apiUtcMs": 1760000000000, "perfNow": 12345.6, "lastKnownUtcMs": 1760000000000 }
```

- `apiUtcMs` : valeur UTC reçue d'un fournisseur.
- `perfNow` : `performance.now()` au moment de la réception.
- `lastKnownUtcMs` : dernier UTC fiable connu (borne basse, le temps ne recule jamais).
- `sessionId` : identifiant de la session de page. Si le `sessionId` stocké diffère du courant, on
  est après un rechargement : l'extrapolation `performance.now()` n'est plus valable et le temps est
  **figé** à `lastKnownUtcMs` jusqu'à la prochaine réponse réseau.

### 3.5 `stats`

```json
{
  "boostersOpened": 13,
  "boostersOpenedBySet": { "A1": 13 },
  "drawsByRarity": { "1": 40, "2": 15, "3": 6, "4": 3, "5": 1 },
  "drawsByCard": { "SERIE-A1 _ W001_classic": 4 }
}
```

- Écrit dans la **même transaction** que les cartes et l'historique : une ouverture échouée ne
  laisse pas de statistique fantôme.
- Ne compte que les **boosters ouverts** : la Mine Pick, la Mine, le Marchand et les cadeaux ont
  leurs propres compteurs et n'incrémentent jamais `stats`.

### 3.6 `boosterHistory`

```json
[
  { "code": "minecards:…", "setId": "A1", "openedAt": "2026-10-18T…Z",
    "godpack": false, "keys": ["SERIE-A1 _ W001_classic", "…"] }
]
```

- Taille limitée à `boosters.historySize` (10), plus récent en tête.
- `code` peut être `null` si le code de partage n'a pas pu être généré (une carte a quitté
  l'extension) : l'entrée reste lisible.
- Les entrées malformées sont **supprimées** à la lecture, pas réparées.

### 3.7 `giftSync`

```json
{ "lastCheckedLine": 42, "lastCheckAt": "2026-10-18T…Z" }
```

- `lastCheckedLine` : dernière ligne du Google Sheet traitée (numéro de ligne physique).
- Avance dans la même transaction que les récompenses : un échec ne « saute » aucun cadeau.

### 3.8 `sparks`

- Nombre entier ≥ 0, stocké **nu** (pas d'objet).
- Toute écriture monétaire passe par `SparksManager` ou par une transaction qui inclut le solde.
- Valeurs de référence : `sparks.sellPrice`, `sparks.buyPrice`, `sparks.boosterReward`.

### 3.9 `profile`

```json
{
  "name": "",
  "icon": "./assets/img/profile/default/minecards.png",
  "photo": "",
  "title": "",
  "favorites": ["SERIE-A1 _ M018_fullart"],
  "featured": ["A1:Quinte Flush Royale"]
}
```

- `name` : pseudo ; `profile.defaultName` (défaut vide) ne donne pas l'XP `nameChanged`.
- `icon` : chemin d'un avatar du catalogue (`ProfileIconManager`).
- `photo` : URL d'une photo d'une sauvegarde **ancienne**, lue et affichée, plus jamais écrite.
- `title` : identifiant du titre porté (`""` = aucun), validé contre le catalogue.
- `favorites` : les clés de collection des cartes favorites. La limite effective commence à
  `profile.defaultFavorites` (3) et grandit d'un emplacement par achat (`profileFavoriteSlot.<n>`),
  jusqu'à `profile.maxFavorites` (5).
- `featured` : les identifiants de trophées **débloqués** mis en avant. Même principe :
  `profile.defaultFeaturedTrophies` (1) au départ, puis jusqu'à `profile.maxFeaturedTrophies` (5)
  avec les achats `profileFeaturedSlot.<n>`.
- Toute lecture passe par `ProfileManager.normalizeProfile()` : clés inconnues supprimées, listes
  tronquées aux limites, ids non débloqués retirés.

### 3.10 `trophies`

```json
{ "unlocked": { "A1:Quinte Flush Royale": { "unlockedAt": "2026-10-…Z", "experience": 250 } } }
```

- Seuls les **déblocages** sont stockés : le catalogue vit dans `settings/` et `data/trophies/`.
- Un déblocage est **définitif** (vendre des cartes ne le reprend jamais).
- `experience` : XP réelle du trophée (catalogue ou `ExperiencePerTrophy`), utile pour recalculer le
  niveau sans relire le catalogue.
- L'XP totale et le niveau sont **dérivés** (`stats`, cartes distinctes, nom, trophées) : aucun
  compteur d'XP n'est stocké.

### 3.11 `minePick`

```json
{
  "lastResetDay": "2026-10-18",
  "remaining": 2,
  "bonusPicks": 0,
  "totalPicks": 7,
  "picksByBooster": { "0": { "cardKey": "…", "pickedAt": "…", "setId": "A1" } },
  "picksByRarity": { "3": 2 },
  "picksByCard": { "SERIE-A1 _ S002_classic": 1 },
  "history": [ { "day": "2026-10-17", "booster": 4, "setId": "A2", "cardKey": "…" } ]
}
```

- `lastResetDay` / `remaining` : quota gratuit du jour (`picksPerDay`, 3), remis à zéro à minuit UTC.
- `bonusPicks` : pioches **achetées** en Sparks, jamais remises à zéro, dépensées quand les
  gratuites sont épuisées.
- `picksByBooster` : quel booster du plateau a été pioché aujourd'hui et quelle carte en est sortie
  (c'est ce qui marque les lignes et sert de garde anti-double pioche).
- `totalPicks`, `picksByRarity`, `picksByCard` : statistiques propres à la fonctionnalité.
- `history` : `minePick.historySize` (10) dernières pioches.
- Le plateau et le mélange sont **déterministes** (`seedSalt` + jour UTC + UUID) et ne sont jamais
  stockés. Une pioche écrit l'état et la carte gardée dans **une seule transaction**.

### 3.12 `mining`

```json
{
  "lastResetDay": "2026-10-18",
  "minedToday": 12,
  "clicks": 3,
  "resources": { "stone_dust": 14, "sculk_dust": 4 },
  "blocksMined": { "material.stone": 7, "material.deepslate": 5 },
  "totalMined": 84,
  "sparksFound": 23
}
```

- `lastResetDay` / `minedToday` : quota du jour (`mining.blocksPerDay`, 50), reset à minuit UTC.
- `clicks` : coups déjà portés au bloc **du moment** (le bloc est recalculé depuis la graine, jamais
  stocké).
- `resources` : compteur par slug de ressource (`stone_dust`, …).
- `blocksMined` : compteur par **id de bloc** (`material.stone`, …) — statistique dédiée.
- `totalMined`, `sparksFound` : totaux (utilisés par les trophées globaux).
- Une casse écrit l'état, les ressources et le solde de Sparks dans **une seule transaction**.

### 3.13 `trader`

```json
{
  "week": "2026-10-13",
  "purchases": { "weekly:A1:0": 1, "pinned:1": 1 },
  "tradeDay": "2026-10-18",
  "tradeUses": { "trade:3:0:2-4": 1 },
  "sparkDay": "2026-10-19",
  "sparkBought": true
}
```

- `week` : lundi (`YYYY-MM-DD`) de la semaine à laquelle appartiennent les achats. Un `week`
  différent du lundi courant = reroll : les achats ne comptent plus.
- `purchases` : nombre d'achats par clé d'offre.
- `tradeDay` : jour UTC auquel appartiennent les compteurs d'échanges (reset à minuit UTC,
  indépendant du reroll hebdomadaire).
- `tradeUses` : nombre d'utilisations par échange.
- `sparkDay` / `sparkBought` : jour UTC de l'achat de ressources en Sparks, et le fait qu'il ait été
  pris. Un `sparkDay` différent du jour courant rend l'offre de nouveau disponible.
- La boutique de la semaine, les échanges et l'achat en Sparks sont **déterministes** (graine +
  lundi/jour UTC, sans UUID) : tout le monde voit la même chose.

### 3.14 `binders`

```json
[
  {
    "id": "…",
    "name": "Mes starters",
    "cover": "SERIE-A1 _ W001_classic",
    "createdAt": "2026-10-…Z",
    "slots": ["SERIE-A1 _ W001_classic", null, "…"]
  }
]
```

- `slots` : **toujours** 30 entrées (`BINDER_SLOT_COUNT`), `null` = emplacement vide.
- `cover` : clé de collection de la carte représentative, dont le `Background` devient le fond de la
  page ; la représentante ne consomme aucun emplacement.
- `id` généré à la création ; un binder sans `id` est ignoré.
- La même carte peut apparaître plusieurs fois, mais pas plus que la quantité possédée (validation
  par binder). `reconcile()` retire les placements excédentaires après une vente, en commençant par
  les index les plus hauts.

### 3.15 `purchases`

```json
{ "cardLayoutFullArt": { "boughtAt": "2026-10-…Z" }, "titleColor:gold": { "boughtAt": "…" }, "profileFavoriteSlot.4": { "boughtAt": "…" } }
```

- Une entrée par fonctionnalité payée : layout Full Art, couleur de titre de carte, emplacement de
  carte favorite (`profileFavoriteSlot.<n>`) ou de trophée mis en avant (`profileFeaturedSlot.<n>`).
- Seul l'achat est stocké ; le prix est relu dans `config.json` à chaque usage (un changement de prix
  ne recharge jamais un propriétaire).
- L'achat est **définitif** (pas de remboursement) et le débit + l'enregistrement sont écrits dans
  **une seule transaction**.

### 3.16 `profileCard`

```json
{ "layout": "classic", "rarity": 3, "titleColor": "auto", "background": "SERIE-A1 _ M018_fullart" }
```

- `layout` : `classic` ou `fullart` (le Full Art n'est honoré que si la fonctionnalité est achetée).
- `rarity` : rareté **choisie** parmi celles débloquées (`null` = la plus haute atteinte).
- `titleColor` : `auto` (couleur de la rareté, gratuit) ou l'id d'une couleur **achetée** ; une
  couleur non possédée retombe sur `auto`, même dans une sauvegarde retouchée.
- `background` : clé de collection d'une **carte favorite** dont le `Background` sert d'illustration
  (`null` ou absent = la première favorite). Une clé qui n'est plus favorite retombe sur la première.
- Aucun rendu n'est stocké : la carte est une projection recalculée.

---

## 4. Autres ObjectStores

### 4.1 `redeemed_codes`

| Champ | Type | Description |
|---|---|---|
| `code` | `string` | clé primaire : l'identifiant stocké du code (`resolved.storeKey`) |
| `redeemedAt` | `string` ISO 8601 | date de la rédemption |

- Écrit uniquement pour les codes **non répétables** : la présence de la clé fait échouer une
  seconde tentative avec `ALREADY_USED`.
- Écrit dans la **même transaction** que les récompenses : un code ne peut pas être consommé sans
  que ses récompenses soient accordées, ni l'inverse.

### 4.2 `gifts_received`

| Champ | Type | Description |
|---|---|---|
| `line` | `number` \| `string` | clé primaire : numéro de ligne physique du Sheet, ou `code:<redeemId>:<i>` pour une récompense de code |
| `category` | `'distribution'` \| `'codes'` | origine (une valeur absente est lue comme `distribution`) |
| `uuid` | `string` | **vrai** UUID du compte (même pour une ligne diffusée `*`) |
| `type` | `'booster'` \| `'card'` \| `'sparks'` | nature de la récompense |
| `key` | `string` | identifiant du set (booster), clé de collection (carte) ou vide (Sparks) |
| `quantity` | `number` ≥ 1 | quantité accordée |
| `receivedAt` | `string` ISO 8601 | date de réception |
| `broadcast` | `boolean` (optionnel) | `true` pour une ligne `uuid = "*"` |

- Le **numéro de ligne** est la clé anti-doublon : modifier `lastCheckedLine` ne permet pas de
  recevoir deux fois le même cadeau.
- Une ligne diffusée est créditée à chaque compte et stockée avec son vrai UUID.

---

## 5. Export / import `.save`

### 5.1 Format (version 1)

`SaveFile` (`js/classes/SaveFile.js`) sérialise la base :

```jsonc
{
  "version": 1,
  "exportedAt": "2026-10-07T12:00:00.000Z",
  "stores": {
    "collection":     [ { "key": "…", "cardId": "…", "style": "normal", "set": "A1",
                          "quantity": 2, "firstObtainedAt": "…", "lastObtainedAt": "…" } ],
    "user_state":     { "account": {…}, "settings": {…}, "quota": {…},
                        "timeAnchor": {…}, "stats": {…}, "giftSync": {…},
                        "boosterHistory": [ … ], "sparks": 123, "profile": {…},
                        "trophies": {…}, "minePick": {…}, "mining": {…},
                        "trader": {…}, "binders": [ … ], "purchases": {…},
                        "profileCard": {…} },
    "redeemed_codes": [ { "code": "…", "redeemedAt": "…" } ],
    "gifts_received": [ { "line": 42, "category": "distribution", "uuid": "…", "type": "card",
                          "key": "…", "quantity": 1, "receivedAt": "…" } ]
  }
}
```

- **Encodage** : JSON → `CompressionStream('deflate')` → Base64 (`js/utils/Compression.js`).
- **Nom de fichier** : `backup_cards_YYYY-MM-DD.save`.
- **Taille maximale à l'import** : 32 Mio (`MAX_SAVE_BYTES`) ; au-delà, refus avant lecture.
- `user_state` est exporté comme **objet** (clé → valeur) alors que le store utilise des clés
  hors-ligne : `getAllKeys()` est lu avec `getAll()` pour préserver chaque clé.

### 5.2 Validation

- `version` doit être supportée (1).
- Chaque store doit être présent et du bon type (tableau/objet).
- `user_state.account.uuid` doit être un **UUID v4** valide.
- Les clés obligatoires de `user_state` (`account`, `settings`, `quota`, `stats`, `giftSync`) sont
  vérifiées ; `timeAnchor` reste optionnel.
- Les managers **normalisent** ensuite leur part à la lecture, donc une sauvegarde ancienne reste
  importable après un changement de schéma, tandis qu'un fichier tronqué ou corrompu est refusé
  (`SaveFileError` avec un code stable et une clé i18n `save.error.*`).

### 5.3 Import

1. Lecture du fichier (refus au-delà de 32 Mio), décodage Base64 puis `deflate`, parsing JSON.
2. Validation complète **avant** toute écriture.
3. `EVENTS.SAVE_IMPORTED` est émis juste avant la bascule : l'application libère son état en mémoire
   (ancrage de temps, vues).
4. Le remplacement des quatre stores se fait dans **une seule transaction readwrite** : une
   sauvegarde invalide laisse la base courante intacte.
5. La page est **rechargée** : l'UUID et toutes les valeurs en cache ont changé.

---

## 6. Transactions et atomicité

`StorageRepository.transaction(stores, mode, callback)` ouvre une transaction IndexedDB et ne résout
qu'après `oncomplete`. Le callback ne doit **pas** attendre de promesse étrangère (sinon la
transaction se ferme au milieu du travail) : il n'utilise que les helpers `get`/`put`/`delete` reçus.

Écritures atomiques notables :

| Opération | Stores touchés |
|---|---|
| Ouverture d'un booster | `collection`, `user_state` (stats, historique, sparks) |
| Vente / achat d'une carte | `collection`, `user_state` (sparks) |
| Achat d'un booster / d'une pioche | `user_state` (sparks + quota ou minePick) |
| Pioche de la Mine Pick | `user_state` (minePick, sparks), `collection` |
| Casse d'un bloc de la Mine | `user_state` (mining, sparks) |
| Achat / échange chez le marchand | `user_state` (trader, mining, sparks), `collection` |
| Rédemption d'un code | `user_state`, `collection`, `redeemed_codes`, `gifts_received` |
| Vérification des distributions | `user_state`, `collection`, `gifts_received` |
| Achat d'une fonctionnalité | `user_state` (purchases + sparks) |
| Suppression d'un binder / vente | `user_state` (binders, sparks), `collection` |
| Import `.save` | les quatre stores |

Un échec annule la transaction : **rien** n'est partiellement écrit. Les helpers de crédit
(`SparksManager.addSparks`, `DateSyncManager.addBonusBoosters`) acceptent un contexte de transaction
existant pour être composés.

---

## 7. Migrations et cycle de vie

- **Schéma** : incrémenter `DB_VERSION` et étendre `STORE_DEFINITIONS`. `handleUpgrade()` crée les
  magasins manquants ; `onversionchange` ferme la connexion quand un autre onglet demande une
  version supérieure (l'onglet bloqué reçoit un avertissement `onblocked`).
- **Données** : la politique générale est **normaliser à la lecture** plutôt que migrer
  explicitement. Chaque manager possède sa fonction `normalize*` et remplace toute valeur absente ou
  invalide par un défaut sûr. C'est ce qui rend une sauvegarde de n'importe quelle version
  importable.
- **Persistance du stockage** : `navigator.storage.persist()` est demandé à la création du compte
  pour limiter l'éviction par le navigateur. Les quotas dépendent de l'origine et du navigateur.
- **Reset complet** : `AccountManager.reset()` supprime les données (dont l'UUID), vide le miroir
  `localStorage`, puis recharge la page vers l'écran d'accueil.
- **Multi-onglets** : les lectures/écritures sont par transaction ; un `versionchange` ferme la base
  d'un onglet plus ancien. Aucun verrou applicatif n'est posé.

---

## 8. Ce qui n'est PAS dans IndexedDB

Pour éviter toute confusion à la lecture du code :

- **Le catalogue** (cartes, trophées, titres, avatars, codes, boutique épinglée, règles de la mine)
  vit dans des fichiers JSON statiques, en lecture seule et versionnés avec le code.
- **Les illustrations** (`cards/`, 374 Mo) sont des fichiers servis et mis en cache par le service
  worker à l'usage, jamais stockés dans la base.
- **Les caches du service worker** (`minecards-shell-*`, `minecards-cdn-*`, `minecards-runtime-*`)
  ne sont pas de la progression joueur : vider le cache ou désinstaller le worker ne touche pas
  IndexedDB.
- **Les préférences d'affichage immédiat** (`mc_theme`, `mc_lang`) sont un miroir `localStorage` non
  autoritaire.
- **Les données dérivées** (XP, niveau, complétion, titres débloqués, plateau du jour, boutique de la
  semaine) ne sont jamais stockées : elles sont recalculées à partir de la base, des catalogues et de
  la graine déterministe.

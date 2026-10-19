# 03 — Modèles de données et schémas

## 1. Vue d'ensemble

L'application manipule quatre familles de données :

1. **Données de référence** (JSON statiques) : Pokémon, versions, trophées, récompenses, cosmétiques, challenges, crédits.
2. **Entités métier** : `Pokemon`, `Challenge`, `Reward`, `RewardItem`, `RewardButton`.
3. **Résultats de jeu** : sessions Marathon, résultats Daily/Weekly, complétions de challenges.
4. **Préférences** : langue, pseudo, cosmétiques, mode rapide.

Il n'y a **aucun schéma formel** (JSON Schema, TypeScript, validation runtime). Les formes ci-dessous sont celles réellement lues par le code.

---

## 2. `Pokemon` — `pokemon.js`

```js
class Pokemon {
  Index;                    // string (ex. "1", "027b")
  NameEN;                   // string
  NameFR;                   // string
  Generation;               // number
  Type1;                    // string (anglais minuscule : "grass")
  Type2;                    // string | null
  Image;                    // chemin du sprite partiel
  FullImage;                // chemin du sprite complet
  EggGroups;                // string[] | null
  Category;                 // string | null
  pokefeet_data_version;    // number, défaut 1
}
```

### Méthodes

| Méthode | Comportement |
|---|---|
| `matchesName(name)` | Compare le nom normalisé (NFD, sans accents, minuscules) à `NameFR` ou `NameEN`. |
| `getDisplayType2()` | Retourne `Type2` ou `"N/A"`. |
| `getEggGroupsDisplay()` | Joint un tableau par `" / "`, sinon convertit en chaîne, sinon `"N/A"`. |
| `getCategoryDisplay()` | `Category` ou `"N/A"`. |

### Champs JSON réellement présents

`data/pokemons.json` : 698 entrées.

```json
{
  "Generation": 1,
  "Image": "./img/1-151/001-a.png",
  "FullImage": "./img/fullsprite/1.png",
  "Index": "1",
  "NameEN": "Bulbasaur",
  "NameFR": "Bulbizarre",
  "Type1": "grass",
  "Type2": "poison",
  "EggGroups": ["Monstrueux", "Végétal"],
  "Category": "Pokémon Graine",
  "pokefeet_data_version": 1
}
```

### Invariants et pièges

- `Index` est une **chaîne** dans le JSON, mais de nombreux modules comparent avec `==` (`ChallengeManager`, `DailyToDexImport`) pour tolérer les nombres.
- `EggGroups` peut être un tableau ou une chaîne selon les entrées historiques ; `Pokemon` normalise seulement à l'affichage.
- `Image` et `FullImage` pointent vers `./img/...` ; tous les chemins référencés existent (vérifié : 1 396 références, 0 manquante).
- La clé Dex est `Index`, pas un identifiant numérique.

### `TypeIcons` — `bindings/type_icons.json`

Dictionnaire `type -> URL d'icône`. Chargé par `TypeIcons.load()` (fetch). Utilisé uniquement par `game.js`, `daily.js` et `weekly.js`, et **jamais lu** (`TypeIcons.getUrl()` n'a aucun appel externe — voir doc 16).

---

## 3. `PokemonVersions` — `pokemon-versions.js`

Source : `data/version.json`.

```json
{ "pokefeet_data_version": 1, "deploy_date": null, "Update_Name": "1G, 2G, 3G" }
```

| Méthode | Comportement |
|---|---|
| `load()` | Fetch idempotent ; fallback `[{version:1, deploy_date:null}]` si échec. |
| `getAvailableVersions(dateStr)` | Set des versions dont `deploy_date === null` ou `<= dateStr`. |
| `getAvailablePokemons(all, dateStr)` | Filtre les `Pokemon` sur ce Set. |
| `getUpdatesBetweenDates(a, b)` | Entrées déployées strictement après `a` et jusqu'à `b` inclus. |
| `getData()` | Données brutes. |

**Piège** : si `load()` n'a pas encore été appelé, `getAvailableVersions()` retourne `Set([1])`, ce qui masque silencieusement les autres versions.

---

## 4. `Challenge` — `entity/challenge.js`

```js
class Challenge {
  ID;                       // number
  Difficulty;               // "Easy" | "Medium" | "Hard" | "Impossible"
  Requirements;             // Requirement[]
  Name_En; Name_Fr;
  Desc_En; Desc_Fr;
  Additional_Info_Fr;       // string | null
  Additional_Info_En;       // string | null
  FeetList;                 // string[] d'Index Pokémon
  Rewards;                  // { TypeReward, Value }[]
  Availabilities;           // { Start, End }[] | null
  MustHideIfUnavailable;    // boolean
  Tab;                      // string | null
}
```

### `Requirement`

```json
{ "TypeRequirement": "level" | "dexcount" | "trophy", "Value": 3 }
```

| Type | Valeur | Vérification réelle |
|---|---|---|
| `level` | nombre | `ChallengeManager.getPlayerLevel() >= Value` |
| `dexcount` | nombre | `Dex.getProgress().found >= Value` |
| `trophy` | ID de trophée | `checkTrophyEarned(Value)` — **ne gère que** `Dex_Count`, `Daily_Count`, `Weekly_Count`, `Marathon_Streak` ; les modes `Type_Registered` et `Full_Generation_Register` renvoient toujours `false`. |

### `Rewards`

```json
{ "TypeReward": "Experience" | "Cosmetic", "Value": 50 | 23 }
```

- `Experience` : nombre de XP ajouté au total.
- `Cosmetic` : ID numérique dans `data/cosmetics.json`.

### `Availabilities`

```json
[{ "Start": "2026-06-01", "End": "2026-07-31" }]
```

`isAvailableToday()` compare la date locale `YYYY-MM-DD` aux bornes, **incluses**. Aucune gestion de fuseau horaire.

### Méthodes

| Méthode | Comportement |
|---|---|
| `getName(lang)` / `getDescription(lang)` | FR prioritaire, fallback EN. |
| `isAvailableToday()` | `true` si aucune disponibilité, sinon au moins une plage couvrante. |
| `getDifficultyColor()` | Vert / orange / rouge / violet. |
| `getDifficultyTranslation()` | Clé `challenge.difficulty.<lower>`. |
| `checkRequirement(req)` | Async, retourne `{ met, text, current }`. |

### Données réelles

- 32 challenges, onglets : `Main Games` (12), `Strategy` (5), `Regional` (4), `Collection` (4), `Community` (4), `Event` (3).
- Difficultés : `Easy` 18, `Medium` 10, `Hard` 3, `Impossible` 1.
- Prérequis : `dexcount` 26 occurrences, `level` 24, aucun `trophy` dans le JSON actuel.
- Récompenses : `Cosmetic` 37, `Experience` 32.
- Certaines dates sont invalides (`2027-06-31`), mais la comparaison **lexicographique** de chaînes les rend inoffensives (elles ne matcheront simplement jamais un vrai jour).

---

## 5. `Reward`, `RewardItem`, `RewardButton`

Source : `data/reward.json` (14 paliers).

```json
{
  "Level": 100,
  "ImageUrl": "./img/badges/master.png",
  "Reward": [
    { "Type": "Badge", "Data": "./img/badges/master.png" },
    { "Type": "Title", "Data": "Master" }
  ],
  "Title_FR": "Dresseur Maître !",
  "Description_FR": "Vous êtes le pied.",
  "Title_EN": "Master Trainer!",
  "Description_EN": "You are feet.",
  "Button": null
}
```

| Entité | Champs | Rôle |
|---|---|---|
| `Reward` | `level`, `imageUrl`, `titleFR/EN`, `descriptionFR/EN`, `items[]`, `button` | Palier déblocable par niveau. |
| `RewardItem` | `type` (`Badge`, `Title`, `StreamdexCMD`), `data` | Élément concret de la récompense. |
| `RewardButton` | `txtButtonFR/EN`, `urlButton` | Bouton d'action optionnel. |

- `isUnlocked(currentLevel)` : `currentLevel >= level`.
- `getProgress(currentLevel)` : `min(100, round(currentLevel / level * 100))`.
- `renderCard()` et `renderPopupContent()` construisent du DOM (la classe mélange donc modèle et rendu).
- Types d'items réels : `StreamdexCMD` 9, `Badge` 5, `Title` 5.

---

## 6. Résultats de jeu

### 6.1 Résultat d'un round Daily/Weekly

```js
{
  outcome: "win" | "fail",
  attempts: number   // nombre d'échecs avant la réussite ; 5 pour un échec
}
```

Un tableau de 5 (Daily) ou 10 (Weekly) résultats est stocké avec :

```js
{
  date: "YYYY-MM-DD",          // date du daily ou lundi du weekly
  score: number,               // 0..50 ou 0..100
  results: Result[],
  wrongGuesses: string[][],    // par slot, les propositions fausses
  importedInDex: boolean       // ajouté par les writers
}
```

**Piège** : `importedInDex` est écrit mais quasiment jamais lu pour décider d'un import ; les imports reconstruisent la liste et marquent les Pokémon trouvés.

### 6.2 Session Marathon (`localStorage`)

Clé : `pk_practice_session`.

```js
{
  orderedIndices: string[],   // ordre complet de la session
  foundCount: number,
  score: number,
  streak: number,
  perfectCount: number,
  totalFails: number,
  pokemonTotal: number,
  finished: boolean,
  startedAt: string           // ISO
}
```

La reprise reprend `orderedIndices.slice(foundCount)` et reconstruit le pool. Une session `finished: true` est ignorée.

### 6.3 Entrée Dex (`PokefeetDexDB/dex_entries`)

Clé primaire : `index`.

```js
{
  index: string,              // Index Pokémon
  found: boolean,
  firstFoundDate: string | null,
  count: number
}
```

- `markFound(index, date)` incrémente `count` et fixe `firstFoundDate` si absent.
- `addNewDexEntry(index, date)` ne fait rien si `found` est déjà vrai ; sinon `count = 1`.

### 6.4 Complétion de challenge (`PokefeetChallengeDB/challenge_completions`)

Clé primaire : `challengeId`.

```js
{
  challengeId: number,
  completedAt: string,        // ISO
  fails: number
}
```

Index secondaire : `completedAt` (non unique). Une re-complétion **écrase** l'entrée existante.

### 6.5 Challenge custom (URL)

Payload encodé :

```js
{
  a: "Auteur",                // string
  n: "Nom du challenge",      // string
  r: 0 | 1,                   // ordre aléatoire
  p: ["1", "4", "7"]          // Index, min 2
}
```

Format du code : `1` + base64url(deflate-raw(JSON UTF-8)) ou `2` + base64url(JSON UTF-8). Voir doc 09.

---

## 7. Sauvegarde exportée

Format texte `data.js` :

```text
POKEFEET_SAVE v2
Exported: 2026-10-19T20:00:00.000Z
---DATA---
{"daily":{...},"weekly":{...},"best":123,"marathon":{"bestScore":123,"bestStreak":7},"challenges":{...}}
---HASH---
a1b2c3d4
```

| Champ | Type | Contenu |
|---|---|---|
| `daily` | objet date → entrée | historique Daily |
| `weekly` | objet lundi → entrée | historique Weekly |
| `best` | number | compatibilité v1 (meilleur score Marathon) |
| `marathon.bestScore` | number | meilleur score |
| `marathon.bestStreak` | number | meilleure série |
| `challenges` | objet `challengeId` → complétion | challenges bonus |

Le hash est un **FNV-1a 32 bits** hexadécimal du JSON compact, pas une signature cryptographique : il détecte une altération accidentelle, pas une falsification volontaire.

**Non exporté** : pseudo, langue, cosmétiques sélectionnés, mode rapide, Dex, `wrongGuesses` n'est pas garanti selon les writers.

---

## 8. Autres schémas

### 8.1 Cosmétiques (`data/cosmetics.json`)

```json
{
  "ID": 23,
  "Type": "Background" | "Background-Buttons",
  "Cat": "Games" | "Event" | "Collection" | "Strat" | "Regional" | null,
  "Name": "Kanto",
  "Value": "cosmetics-kanto",
  "File": "kanto.png",
  "RequiresUnlock": true,
  "MustHideIfUnobtained": true
}
```

- `Value` est la classe CSS appliquée.
- `File` est relative à `img/cosmetics/`.
- 30 fonds, 9 boutons ; 37 cosmétiques verrouillés.
- Catégories : `Games` 12, `Event` 11, `Collection` 5, `Strat` 5, `Regional` 4, `null` 2.
- `MustHideIfUnobtained` est utilisé par l'UI inline de `data_management.html`, pas par `cosmetics.js`.

### 8.2 Trophées (`data/trophies.json`)

```json
{
  "Id": 1,
  "Name_en": "New Pokédex (5)",
  "Name_fr": "Nouveau Pokédex (5)",
  "Desc_en": "...",
  "Desc_fr": "...",
  "XP": 25,
  "Obtention_Method": { "Mode": "Dex_Count", "Value": 5, "Type": null },
  "Rarity": 1,
  "Picture": "./img/trophy/dex/bronze.png",
  "Enabled": true
}
```

Modes : `Type_Registered` 54, `Full_Generation_Register` 9, `Dex_Count` 4, `Daily_Count` 4, `Weekly_Count` 4, `Marathon_Streak` 4.

### 8.3 Crédits (`data/credits.json`)

```json
{
  "TranslationsFR": { ... },
  "TranslationsEN": { ... },
  "Credits": [
    {
      "Person": "MythMega/JMDev",
      "Types": ["Coder", "Artist"],
      "Image": "https://...",
      "Buttons": [{ "Text": "Website", "Url": "https://..." }],
      "FunctionFR": "...",
      "FunctionEN": "..."
    }
  ]
}
```

15 entrées. Les clés `TranslationsFR/EN` contiennent les libellés de types.

### 8.4 Traductions

Arborescence imbriquée par namespace (`home`, `practice`, `daily`, `weekly`, `challenge`, `challenges`, `customCreate`, `customPlay`, `dex`, `stats`, `history`, `dataManagement`, `cosmetics`, `reward`, `types`…). 437 feuilles par langue. Voir doc 14.

---

## 9. Invariants transverses

1. **Pas de validation de schéma** : un JSON incomplet produit des `undefined` silencieux, pas une erreur.
2. **Dates en chaînes `YYYY-MM-DD`** : comparaisons lexicographiques, pas de `Date` sauf pour les calculs de semaine/streak.
3. **Index Pokémon en chaînes** : toute nouvelle clé doit rester une chaîne pour éviter les doublons Dex.
4. **Un seul enregistrement par date/clé** : `store.put` écrase.
5. **Pas de version de schéma dans la sauvegarde** au-delà de `POKEFEET_SAVE v2`.
6. **Pas de champ `updatedAt`** sur les historiques : la dernière écriture gagne silencieusement.

Voir [04-persistance-et-migration.md](./04-persistance-et-migration.md) pour le détail des écritures.

# Classes fondamentales

## `Pokemon` (pokemon.js)

Classe représentant un Pokémon avec ses métadonnées.

### Constructeur

```js
new Pokemon(data)
```

| Paramètre | Type | Description |
|---|---|---|
| `data.Index` | `string` | Numéro de Pokédex (ex: "1", "4") |
| `data.NameEN` | `string` | Nom anglais |
| `data.NameFR` | `string` | Nom français |
| `data.Generation` | `number` | Génération (1-9) |
| `data.Type1` | `string` | Type principal (ex: "grass", "fire") |
| `data.Type2` | `string\|null` | Second type (null si mono-type) |
| `data.Image` | `string` | URL de l'image partielle (pieds) |
| `data.FullImage` | `string` | URL de l'image complète (sprite) |
| `data.EggGroups` | `array\|null` | Groupes d'œuf (ex: ["Monster", "Grass"]) |
| `data.Category` | `string\|null` | Catégorie (ex: "Seed", "Lizard") |
| `data.pokefeet_data_version` | `number` | Version des données (défaut: 1) |

### Méthodes

| Méthode | Retour | Description |
|---|---|---|
| `matchesName(name)` | `boolean` | Vérifie si le nom correspond (FR ou EN, insensible à la casse et aux accents) |
| `getDisplayType2()` | `string` | Retourne le Type2 ou "N/A" |
| `getEggGroupsDisplay()` | `string` | Retourne les groupes d'œuf formatés (ex: "Monster / Grass") ou "N/A" |
| `getCategoryDisplay()` | `string` | Retourne la catégorie ou "N/A" |

### Normalisation des noms

La fonction `matchesName` utilise `normalize('NFD')` pour supprimer les accents, puis `toLowerCase()` pour une comparaison insensible à la casse.

```js
// Exemples de correspondances
pokemon.matchesName("Bulbizarre")   // true
pokemon.matchesName("bulbizarre")   // true
pokemon.matchesName("bulbizare")    // false
pokemon.matchesName("Bulbasaur")    // true
```

---

## `TypeIcons` (pokemon.js)

Module utilitaire pour charger et fournir les URLs des icônes de types.

### Méthodes

| Méthode | Description |
|---|---|
| `load()` | Charge `bindings/type_icons.json` en mémoire (async) |
| `getUrl(type)` | Retourne l'URL de l'icône pour un type donné, ou chaîne vide |

### Format de `bindings/type_icons.json`

```json
{
  "fire": "https://...",
  "water": "https://...",
  "grass": "https://..."
}
```

---

## `PokemonVersions` (pokemon-versions.js)

Gère la disponibilité des Pokémon selon les versions de données et leurs dates de déploiement.

### Format de `data/version.json`

```json
[
  { "pokefeet_data_version": 1, "deploy_date": null, "Update_Name": "1G, 2G, 3G" },
  { "pokefeet_data_version": 2, "deploy_date": "2026-05-28", "Update_Name": "4G" }
]
```

- `deploy_date: null` → toujours disponible
- `deploy_date: "YYYY-MM-DD"` → disponible à partir de cette date

### Méthodes

| Méthode | Paramètres | Retour | Description |
|---|---|---|---|
| `load()` | — | `Promise<array>` | Charge `data/version.json` (idempotent) |
| `getAvailableVersions(dateStr)` | `dateStr: "YYYY-MM-DD"` | `Set<number>` | Retourne les numéros de version disponibles à cette date |
| `getAvailablePokemons(allPokemons, dateStr)` | `allPokemons: Pokemon[]`, `dateStr` | `Pokemon[]` | Filtre les Pokémon disponibles à la date donnée |
| `getUpdatesBetweenDates(dateA, dateB)` | `dateA, dateB: "YYYY-MM-DD"` | `array` | Retourne les mises à jour déployées entre deux dates |
| `getData()` | — | `array\|null` | Retourne les données brutes de version.json |

### Utilisation typique

```js
await PokemonVersions.load();
const today = "2026-07-09";
const available = PokemonVersions.getAvailablePokemons(allPokemons, today);
// available ne contient que les Pokémon des versions déployées à cette date
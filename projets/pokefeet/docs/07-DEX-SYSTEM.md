# Système de Pokédex

Le Pokédex interne (Dex) enregistre les Pokémon que le joueur a trouvés dans les modes Daily et Weekly. Il est séparé en deux modules : la logique de données (`Dex.js`) et l'interface utilisateur (`Dex-ui.js`), plus un module d'import (`DailyToDexImport.js`).

---

## `Dex.js` — Logique de données

### Base IndexedDB : `PokefeetDexDB`

| Object Store | Clé | Valeur |
|---|---|---|
| `dex_entries` | `index` (string, ex: "1") | `{ index, found, firstFoundDate, count }` |

### API publique

| Méthode | Description |
|---|---|
| `init()` | Charge les données Pokémon depuis `data/pokemons.json` |
| `getAllDexEntries()` | Retourne toutes les entrées du Dex |
| `getDexEntry(index)` | Retourne une entrée par son index (ou null) |
| `updateDexEntry(index, updates)` | Crée ou met à jour une entrée |
| `markFound(index, date?)` | Marque un Pokémon comme trouvé (incrémente count, set firstFoundDate si nouveau) |
| `addNewDexEntry(index, date?)` | Ajoute une entrée (count=1, ignore si déjà trouvé) |
| `getProgress()` | Retourne `{ found, total }` |

### Structure d'une entrée Dex

```json
{
  "index": "1",
  "found": true,
  "firstFoundDate": "2026-05-28T...",
  "count": 3
}
```

---

## `Dex-ui.js` — Interface utilisateur

Page associée : `pied-dex.html`

### Fonctionnalités

1. **Grille de Pokémon** : affiche tous les Pokémon avec leur image
   - Trouvés : image normale
   - Non trouvés : image filtrée en noir (`black-filter`)

2. **Barre de progression** : `trouvés / total`

3. **Filtres** :
   - Recherche textuelle (nom FR, nom EN, index)
   - Checkbox mutuellement exclusives : "Trouvés" / "Non trouvés"

4. **Tri** :
   - Par index (défaut)
   - Par nom (alphabétique FR)
   - Par type
   - Par groupe d'œuf
   - Par nombre de fois trouvé
   - Par date de première trouvaille
   - Direction asc/desc

5. **Popup de détails** : clic sur "Plus d'infos" → popup avec :
   - Images (sprite complet + pieds)
   - Index, Génération, Types, Groupes d'œuf, Catégorie
   - Statut trouvé, date de première trouvaille, nombre de fois

### API publique

| Méthode | Description |
|---|---|
| `updateProgress(found, total)` | Met à jour la barre de progression |
| `renderDexGrid(pokemons, dexData)` | Rend la grille complète |
| `bindEvents()` | Attache les événements UI (filtres, tri, popup) |

---

## `DailyToDexImport.js` — Import vers le Dex

Ce module est chargé de **reconstruire** les listes Daily et Weekly à partir de l'historique sauvegardé, et de marquer les Pokémon trouvés dans le Dex.

### Pourquoi ce module existe ?

Les Daily/Weekly étant déterministes (seed = date), on peut reconstruire exactement la liste des Pokémon qui ont été proposés un jour donné, sans avoir à stocker la liste complète.

### API publique

| Méthode | Description |
|---|---|
| `forceUpdate()` | Parcourt tout l'historique Daily ET Weekly et met à jour le Dex |
| `reconstructDailyList(dateStr)` | Reconstruit la liste des 5 Pokémon pour une date donnée |
| `reconstructWeeklyList(weekDateStr)` | Reconstruit la liste des 10 Pokémon pour une semaine donnée |

### Utilisation

```js
// Forcer la mise à jour complète
await DailyToDexImport.forceUpdate();

// Reconstruire un daily spécifique
const pokemons = await DailyToDexImport.reconstructDailyList("2026-07-09");
```

### Bouton "Force Update"

Présent sur la page Dex (`#forceUpdateBtn`), il déclenche `forceUpdate()` et affiche une popup avec le nombre de nouveaux Pokémon trouvés.
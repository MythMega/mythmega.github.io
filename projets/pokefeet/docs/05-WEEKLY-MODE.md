# Mode Weekly — `weekly.js`

## Vue d'ensemble

Le mode Weekly propose **10 Pokémon identiques pour tous les joueurs chaque semaine**. Le seed est basé sur le **lundi** de la semaine en cours.

## Déterminisme

### Calcul du lundi de la semaine

```js
function getMondayOfWeek(d) {
    const date = new Date(d);
    date.setHours(0, 0, 0, 0);
    const day = date.getDay(); // 0=Sun, 1=Mon
    const diff = (day === 0) ? -6 : 1 - day;
    date.setDate(date.getDate() + diff);
    return date; // Retourne le lundi à 00:00:00
}
```

### Seed

```js
function getWeekSeedStr(d = new Date()) {
    const monday = getMondayOfWeek(d);
    return `${monday.getFullYear()}-${String(monday.getMonth()+1).padStart(2,'0')}-${String(monday.getDate()).padStart(2,'0')}`;
}
// Exemple pour n'importe quel jour de la semaine du 6 au 12 juillet 2026 : "2026-07-06"
```

Le seed string est préfixé par `"week"` avant d'être hashé :

```js
const seed = stringToSeed('week' + sessionWeek);
```

### PRNG et sélection

Mêmes mécanismes que le Daily (Mulberry32, shuffleArrayWithSeed).

## Paramètre URL

```
weekly.html?week=2026-07-06
```

Permet de rejouer une semaine passée. La date doit être un lundi et ne pas être dans le futur.

## Différences avec le Daily

| Aspect | Daily | Weekly |
|---|---|---|
| Nombre de Pokémon | 5 | 10 |
| Seed | `date` (YYYY-MM-DD) | `"week" + lundi` |
| Durée | 1 jour | 1 semaine (lundi→dimanche) |
| Score max | 50 (5×10) | 100 (10×10) |
| Stockage IndexedDB | `daily_results` | `weekly_results` |
| Partage | Daily | Weekly |

## Stockage

Les résultats sont stockés dans IndexedDB, base `PokefeetDB`, store `weekly_results` :

```json
{
  "date": "2026-07-06",
  "score": 85,
  "results": [
    { "outcome": "win", "attempts": 0 },
    ...
  ],
  "wrongGuesses": [...],
  "importedInDex": true
}
```

## Code quasi-identique à daily.js

Le fichier `weekly.js` est structurellement identique à `daily.js` avec les différences :
- `COUNT = 10` au lieu de 5
- Seed préfixé par `"week"`
- Stores IndexedDB différents
- Clés de cookies différentes
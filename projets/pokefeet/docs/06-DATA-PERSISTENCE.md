# Stockage et Persistance des données

Pokefeet utilise 3 technologies de stockage côté client :

| Technologie | Usage | Données |
|---|---|---|
| **IndexedDB** | Base principale | Résultats Daily, Weekly, Dex |
| **Cookies** | Préférences, meilleur score | Pseudo, best score, fast mode |
| **localStorage** | Session Marathon | Ordre des Pokémon, progression |

---

## IndexedDB

### Base `PokefeetDB` (version 3)

Contient les résultats des parties Daily et Weekly.

| Object Store | Clé | Données |
|---|---|---|
| `daily_results` | `date` (YYYY-MM-DD) | score, results[], wrongGuesses[], importedInDex |
| `weekly_results` | `date` (YYYY-MM-DD du lundi) | score, results[], wrongGuesses[], importedInDex |

**Ouverture** (présent dans daily.js, weekly.js, history.js, data.js, stats.js) :

```js
function getDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('PokefeetDB', 4);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('daily_results'))
                db.createObjectStore('daily_results', { keyPath: 'date' });
            if (!db.objectStoreNames.contains('weekly_results'))
                db.createObjectStore('weekly_results', { keyPath: 'date' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
```

**Timeout** : 5 secondes — si IndexedDB n'est pas disponible, le jeu fonctionne sans persistance.

### Base `PokefeetDexDB` (version 1)

Contient le Pokédex interne.

| Object Store | Clé | Données |
|---|---|---|
| `dex_entries` | `index` (string) | index, found, firstFoundDate, count |

---

## Cookies

| Cookie | Type | Durée | Description |
|---|---|---|---|
| `pk_pseudo` | string | 365j | Pseudo utilisateur |
| `pk_best` | number | 365j | Meilleur score Marathon |
| `pk_best_streak` | number | 365j | Meilleure série Marathon |
| `pk_fast_mode` | boolean | 365j | Mode rapide (true/false) |

---

## localStorage

Clé : `pk_practice_session`

Stocke la session Marathon en cours pour permettre la reprise.

```json
{
  "orderedIndices": ["1", "4", "7", ...],
  "foundCount": 5,
  "score": 42,
  "streak": 3,
  "perfectCount": 2,
  "totalFails": 4,
  "pokemonTotal": 150,
  "finished": false,
  "startedAt": "2026-07-09T04:00:00.000Z"
}
```

---

## Export / Import (`data.js`)

### Export

Génère un fichier texte `.txt` avec :

```
POKEFEET_SAVE v1
Exported: 2026-07-09T...
---DATA---
{"daily":{...},"weekly":{...},"best":42}
---HASH---
a1b2c3d4
```

- Le hash est un **FNV-1a 32-bit** (8 caractères hex) pour détecter les modifications
- Contient les données Daily, Weekly et le best score

### Import

1. Parse le fichier texte
2. Vérifie le hash (intégrité)
3. Détecte les conflits date par date (boîte de dialogue pour chaque conflit)
4. Fusionne les données dans IndexedDB
5. Met à jour le Dex pour les nouvelles entrées importées

### Import depuis un texte partagé

Permet d'importer un résultat depuis un message Discord / réseau social :

```
Pokefeet Daily — 2026-07-09 — score 42
🟩🟩🟩🟩🟩
🟧🟧🟩🟩🟩
🟥🟥🟥🟥🟥
...
```

- `data.js.parseDailyText()` parse le texte
- `data.js.parseWeeklyText()` parse le texte
- Les commandes `!DEL:YYYY-MM-DD` permettent de supprimer une entrée

### Suppression

- **Daily** : suppression individuelle par date ou suppression totale (`store.clear()`)
- **Best score** : suppression du cookie `pk_best`
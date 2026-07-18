# XP, Niveaux et Trophées

Le système de progression est entièrement **calculé dynamiquement** à partir de l'historique des parties (Daily, Weekly, Marathon). Aucune XP n'est stockée — tout est recalculé à chaque affichage.

Page : `stats.html` (module `stats.js`)

---

## Calcul de l'XP

### XP Daily

```js
function computeDailyXP(dailyHistory) {
    let xp = 0;
    for (const date in dailyHistory) {
        const entry = dailyHistory[date];
        if (entry.results.length === 5) xp += 3;      // Daily terminé
        if (entry.score === 50) xp += 2;                // Daily parfait
        for (const r of entry.results) {
            if (r.outcome === 'win' && r.attempts === 0) xp += 1; // Parfait individuel
        }
    }
    return xp;
}
```

### XP Weekly

```js
function computeWeeklyXP(weeklyHistory) {
    let xp = 0;
    for (const date in weeklyHistory) {
        const entry = weeklyHistory[date];
        if (entry.results.length === 10) xp += 6;      // Weekly terminé
        if (allWins && entry.score === 100) xp += 4;    // Weekly parfait
        for (const r of entry.results) {
            if (r.outcome === 'win' && r.attempts === 0) xp += 2; // Parfait individuel
        }
    }
    return xp;
}
```

### XP Marathon

```js
function computeMarathonXP() {
    const bestScore = parseInt(getCookie('pk_best') || '0', 10);
    const bestStreak = parseInt(getCookie('pk_best_streak') || '0', 10);
    return Math.floor(bestScore / 5) + (bestStreak * 2);
}
```

### XP des Trophées

Chaque trophée gagné ajoute son XP (`trophy.XP`). Somme de tous les trophées obtenus.

### Total XP

```js
totalXP = computeDailyXP() + computeWeeklyXP() + computeMarathonXP() + trophyXP;
```

---

## Niveaux

```js
const XP_PER_LEVEL = 100;

function getLevel(totalXP) {
    return Math.floor(totalXP / XP_PER_LEVEL) + 1; // Niveau 1 à 0 XP
}

function getXPInLevel(totalXP) {
    return totalXP % XP_PER_LEVEL; // XP dans le niveau actuel
}
```

| XP totale | Niveau |
|-----------|--------|
| 0 | 1 |
| 100 | 2 |
| 200 | 3 |
| 500 | 6 |
| 1000 | 11 |

---

## Trophées

### Format de `data/trophies.json`

```json
[
  {
    "Id": 1,
    "Name_fr": "Collectionneur débutant",
    "Name_en": "Beginner Collector",
    "Desc_fr": "Trouver 10 Pokémon différents",
    "Desc_en": "Find 10 different Pokémon",
    "XP": 10,
    "Rarity": "Common",
    "Picture": "img/trophy/trophy_01.png",
    "Enabled": true,
    "Obtention_Method": {
      "Mode": "Dex_Count",
      "Value": 10
    }
  }
]
```

### Modes d'obtention

| Mode | Valeur | Description |
|---|---|---|
| `Dex_Count` | `number` | Atteindre N Pokémon trouvés dans le Dex |
| `Daily_Count` | `number` | Compléter N Daily |
| `Weekly_Count` | `number` | Compléter N Weekly |
| `Marathon_Streak` | `number` | Atteindre une série de N au Marathon |
| `Full_Generation_Register` | `number` (Génération) | Trouver tous les Pokémon d'une génération |
| `Type_Registered` | `{ Value: number, Type: string }` | Trouver N Pokémon d'un type donné |

### Affichage

Les trophées sont affichés par catégories :
1. Pokédex (`Dex_Count`)
2. Daily (`Daily_Count`)
3. Weekly (`Weekly_Count`)
4. Marathon (`Marathon_Streak`)
5. Générations (`Full_Generation_Register`)
6. Types (`Type_Registered`) — chaque type a sa section

Chaque trophée affiche :
- Icône
- Nom (traduit)
- Description (traduite)
- XP gagnée
- Barre de progression (si non débloqué mais partiellement complété)

---

## Récompenses

### Format de `data/reward.json`

```json
[
  {
    "level": 5,
    "items": [
      { "type": "Badge", "data": "img/badges/badge_05.png" },
      { "type": "Title", "data": "🧢 Apprenti Dresseur" }
    ]
  }
]
```

### Types d'items

| Type | Description |
|---|---|
| `Badge` | Image affichée dans le profil |
| `Title` | Texte affiché à côté du pseudo |

### Déblocage

Les récompenses sont débloquées quand le niveau du joueur est >= au niveau requis. Le plus haut titre débloqué est affiché dans le profil.

### Popup

Un clic sur une récompense dans la grille ouvre une popup avec les détails (icônes, titre, niveau requis).

---

## Affichage (stats.js)

```js
function renderLevelAndXP(totalXP) {
    const level = getLevel(totalXP);
    const xpInLevel = getXPInLevel(totalXP);
    const pct = (xpInLevel / XP_PER_LEVEL) * 100;
    // Met à jour : #statsLevel, #statsTotalXP, #statsXPBarFill, #statsXPBarText
}
```

### Modal d'échelle XP

Un bouton `?` à côté du niveau ouvre une modale (`#xpScaleModal`) expliquant comment gagner de l'XP (closable par Escape ou clic extérieur).
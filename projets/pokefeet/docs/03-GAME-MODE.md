# Mode Marathon (Entraînement) — `game.js`

## Vue d'ensemble

Le mode Marathon (appelé "Entraînement" dans l'UI) permet de deviner **tous les Pokémon disponibles** dans un ordre aléatoire. La session est persistée dans `localStorage` pour permettre la reprise.

## Logique principale

### Initialisation (`Game.init()`)

1. Charge `data/pokemons.json`, `TypeIcons`, `PokemonVersions`
2. Filtre les Pokémon disponibles à la date du jour via `PokemonVersions.getAvailablePokemons()`
3. Vérifie si une session précédente est sauvegardée dans `localStorage` (clé `pk_practice_session`)
   - **Session existante** : restaure l'état (index, score, streak, etc.)
   - **Nouvelle session** : mélange aléatoirement avec un seed aléatoire (`Math.random()`)
4. Démarre le premier Pokémon

### Déroulement d'un round

1. Un Pokémon est sélectionné (`PossiblePokemons.shift()`)
2. L'image partielle (pieds) est affichée
3. Le joueur soumet un nom via l'input avec autocomplete
4. **Validation** : le nom doit exister dans la liste complète des Pokémon (FR ou EN)
5. **Correction** : `current.matchesName(input)` vérifie la correspondance
6. **Succès** : points ajoutés, streak incrémenté, passage au suivant
7. **Échec** : tentative enregistrée, indice affiché, jauge de score mise à jour
8. **5 échecs** : game over (écran de défaite)

### Scoring

```js
const basePoints = 10;
const hintPenalty = 2;
function pointsForAttempt(a) {
    return Math.max(basePoints - a * hintPenalty, 0);
}
```

| Tentative | Points |
|-----------|--------|
| 0 (1er essai) | 10 |
| 1 (1 indice) | 8 |
| 2 (2 indices) | 6 |
| 3 (3 indices) | 4 |
| 4 (4 indices) | 2 |
| 5+ (échec) | 0 |

### Indices (affichés séquentiellement)

| Tentative ratée | Indice |
|---|---|
| 1 | Type(s) du Pokémon (badges colorés) |
| 2 | Index + Génération |
| 3 | Groupe(s) d'œuf |
| 4 | Catégorie |

### Session persistence

```js
const SESSION_KEY = 'pk_practice_session';
```

La session est sauvegardée dans `localStorage` après chaque Pokémon trouvé :

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
  "startedAt": "2026-07-09T..."
}
```

- `markSessionFinished()` : marque la session comme terminée (empêche la reprise)
- `loadSession()` : charge la session si elle existe et n'est pas finie

### Fast Mode

Si le cookie `pk_fast_mode` est `"true"`, le jeu passe automatiquement au Pokémon suivant après 400ms sans afficher l'écran de résultat.

### Game Over

Deux cas déclenchent l'écran de game over :
1. **Échec** : 5 tentatives incorrectes sur un Pokémon
2. **Abandon** : clic sur le bouton d'abandon

L'écran affiche le score, le nombre trouvé, les parfaits, les erreurs, la série et le meilleur score.

### Victoire

Quand tous les Pokémon du pool ont été trouvés, un écran de victoire s'affiche avec les mêmes statistiques.

## Cookies utilisés

| Cookie | Usage |
|---|---|
| `pk_best` | Meilleur score en mode Marathon |
| `pk_best_streak` | Meilleure série (streak) |
| `pk_fast_mode` | Mode rapide (true/false) |

## UI associée

Le mode Marathon utilise le module `UI` (ui.js) pour :
- Afficher/masquer les indices
- Gérer l'autocomplete
- Mettre à jour la jauge de score
- Afficher les notifications
- Gérer l'écran de game over / victoire
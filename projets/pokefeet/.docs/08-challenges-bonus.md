# 08 — Challenges bonus

## 1. Identité

| Élément | Valeur |
|---|---|
| Pages | `list_challenges.html` (liste), `challenge.html` (jeu) |
| Entité | `entity/challenge.js` |
| Métier | `business/challenge-manager.js` |
| Stockage | `business/challenge-storage.js` |
| UI | `ui/challenge-list-ui.js`, `ui/challenge-game-ui.js` |
| Données | `data/bonus_challenges.json` (32), `data/pokemons.json` |
| Persistance | `PokefeetChallengeDB/challenge_completions`, Dex |

Les challenges bonus sont des séries thématiques (jeux principaux, stratégie, régional, collection, communauté, événement) avec prérequis, dates de disponibilité et récompenses.

---

## 2. Catalogue

### 2.1 Onglets (`Tab`)

| Onglet | Nombre |
|---|---:|
| `Main Games` | 12 |
| `Strategy` | 5 |
| `Regional` | 4 |
| `Collection` | 4 |
| `Community` | 4 |
| `Event` | 3 |

`ChallengeListUI.getUniqueTabs()` construit les onglets à partir des valeurs présentes, dans l'ordre d'apparition.

### 2.2 Prérequis

```json
{ "TypeRequirement": "level", "Value": 3 }
{ "TypeRequirement": "dexcount", "Value": 300 }
{ "TypeRequirement": "trophy", "Value": 12 }
```

- `level` : niveau calculé via l'XP total (voir doc 11).
- `dexcount` : nombre d'entrées Dex `found`.
- `trophy` : `checkTrophyEarned()` — **partiel** (voir § 7).

### 2.3 Disponibilités

```json
"Availabilities": [
  { "Start": "2026-10-15", "End": "2026-11-01" },
  { "Start": "2027-10-15", "End": "2027-11-01" }
]
```

- `null` ou tableau vide : toujours disponible.
- `isAvailableToday()` : au moins une plage couvrante, bornes incluses.
- `MustHideIfUnavailable` : si vrai et hors plage, le challenge est masqué **sauf s'il a déjà été complété** (pour permettre de revoir/partager).

### 2.4 Récompenses

```json
"Rewards": [
  { "TypeReward": "Experience", "Value": 50 },
  { "TypeReward": "Cosmetic", "Value": 23 }
]
```

- `Experience` : XP ajouté au total (pas de monnaie, pas d'item).
- `Cosmetic` : débloque l'ID correspondant dans `data/cosmetics.json`.

---

## 3. Page liste (`list_challenges.html`)

`ChallengeListUI.init()` :

1. La page ne bloque pas sur `Migration.ready` : `migration.js` lance sa migration en parallèle et `ChallengeManager` ouvre `PokefeetChallengeDB` directement.
2. `ChallengeManager.loadChallenges()` : fetch `bonus_challenges.json`, instancie `Challenge`, restaure l'état `sessionStorage`.
3. `ChallengeManager.loadPokemons()` : fetch `pokemons.json`, instancie `Pokemon`.
4. Charge `ChallengeStorage.getAllCompletions()`.
5. Construit les onglets et les cartes.

### 3.1 Carte

Pour chaque challenge de l'onglet actif :

- filtre `MustHideIfUnavailable` ;
- `isCompleted` ;
- `canPlay = await ChallengeManager.canPlayChallenge(challenge)` ;
- `isAvailable = challenge.isAvailableToday()` ;
- classe `completed` / `locked` ;
- nom, description localisés, difficulté colorée ;
- nombre de Pokémon (`FeetList.length`) ;
- plages de disponibilité ;
- récompenses : `+N XP` ou nom du cosmétique ;
- prérequis : chaque `checkRequirement` avec couleur verte/rouge ;
- bouton « Jouer » ou « Re-jouer », désactivé si `!canPlay || !isAvailable`.

### 3.2 Navigation

- challenge non complété → `challenge.html?challengeid=ID&statut=playing`
- challenge complété → `challenge.html?challengeid=ID&statut=view`

---

## 4. Page de jeu (`challenge.html`)

### 4.1 Initialisation

Le script inline :

1. Lit `challengeid` et `statut` (`view` par défaut).
2. Charge challenges et Pokémon.
3. Si les Pokémon sont vides, retente un chargement.
4. Trouve le challenge par ID.
5. Vérifie `canPlay` et `isAvailable`.
6. `statut === 'playing'` et éligible : `startChallenge`, puis `ChallengeGameUI.init()`.
7. `statut === 'playing'` mais non éligible : redirection vers `statut=view`.

### 4.2 `ChallengeManager`

```js
startChallenge(challenge) {
  currentChallenge = challenge;
  currentIndex = 0;
  currentFails = 0;
  gameActive = true;
  const seed = random();
  challenge.shuffledFeetList = seededShuffle(challenge.FeetList, seed);
  sessionStorage.setItem('challenge_manager_state', { challengeId, currentIndex, currentFails, gameActive, seed });
}
```

- L'ordre est aléatoire mais **reproductible dans l'onglet** grâce au seed stocké.
- Au retour sur la page, `loadState()` restaure le challenge, l'index, les échecs et le seed.

### 4.3 Réponses

`ChallengeGameUI.submitAnswer()` :

- normalise la saisie ;
- refuse un nom inconnu (shake) ;
- refuse une réponse déjà donnée ;
- `ChallengeManager.checkAnswer(answer)` :
  - correct : passe au suivant ; si c'était le dernier, `finished: true` ;
  - incorrect : `currentFails++`, conserve la réponse.
- À la fin, `renderCompletion()`.

### 4.4 Indices

`showHintForAttempt(attempt)` affiche progressivement :

1. types ;
2. index + génération ;
3. groupes d'œuf ;
4. catégorie.

Contrairement au Daily/Weekly, il n'y a **pas de limite d'échecs** : le joueur peut continuer indéfiniment.

### 4.5 Fin

`ChallengeManager.completeChallenge()` :

1. `markChallengeCompleted(ID, fails)` → `challenge_completions`.
2. `Dex.markFound(index)` pour **tous** les `FeetList`, même si le joueur ne les a pas tous devinés (ils le sont par construction, puisque le jeu ne passe au suivant qu'après une bonne réponse).
3. Calcule `xpGained` en sommant les `Experience`.

`ChallengeGameUI.renderCompletion()` :

- cache le jeu ;
- affiche une popup avec toutes les images complètes, le nombre d'erreurs, le nombre de Pokémon, `+XP` ;
- bouton « Copier le résultat » (texte + URL `challenge.html?...&statut=view`) ;
- bouton « Retour à la liste » ;
- recharge les cosmétiques (`Cosmetics.load()`), car une récompense a pu en débloquer.

---

## 5. Déblocage des cosmétiques

`Cosmetics.loadUnlockedCosmetics()` :

1. lit toutes les complétions ;
2. lit `bonus_challenges.json` ;
3. pour chaque challenge complété, parcourt `Rewards` ;
4. ajoute à `unlockedIds` chaque `Cosmetic.Value` numérique.

Un cosmétique `RequiresUnlock: true` n'est sélectionnable que si son ID est dans cet ensemble. L'UI de `data_management.html` masque en plus ceux marqués `MustHideIfUnobtained`.

---

## 6. Restauration d'état

Clé `sessionStorage` : `challenge_manager_state`.

```js
{ challengeId, currentIndex, currentFails, gameActive, seed }
```

- `loadState()` est appelé dans `loadChallenges()`.
- Si le challenge n'existe plus, l'état est ignoré.
- Si `seed` existe et que `shuffledFeetList` n'est pas déjà construite, l'ordre est reconstruit.
- L'état n'est **jamais supprimé** après complétion.

---

## 7. Problèmes connus

| Problème | Détail | Impact |
|---|---|---|
| `trophy` partiel | `checkTrophyEarned` ne gère pas `Type_Registered` ni `Full_Generation_Register` | un prérequis trophy de ces types est toujours faux |
| XP recalculé à chaque prérequis | `getPlayerLevel()` recharge toutes les bases et JSON à chaque appel | lent sur la liste (32 cartes × prérequis) |
| Duplication XP | `computeTotalXP()` copie `stats.js` | divergence garantie à terme |
| Prérequis non cachés | chaque `checkRequirement` refait des fetchs | N+1 requêtes |
| `sessionStorage` non nettoyé | état périmé | reprise inattendue |
| Re-complétion | `put` écrase `completedAt` et `fails` | perte de l'historique de performance |
| `FeetList` marquée en bloc | tous les Pokémon du challenge sont ajoutés au Dex | volontaire, mais le Dex ne reflète pas les réponses individuelles |
| Dates invalides | `2027-06-31` | comparaison lexicographique, jamais disponible ce jour |
| `Challenge` dépend de `ChallengeManager` | entité → métier | couplage circulaire |
| Pas de verrou | deux onglets peuvent jouer le même challenge | doublons/écrasements |

---

## 8. Checklist de test manuel

1. Liste : onglets, cartes, difficultés, récompenses, dates.
2. Prérequis `level` : vert/rouge selon le niveau.
3. Prérequis `dexcount` : valeur courante / cible.
4. Challenge verrouillé : bouton désactivé.
5. Challenge hors disponibilité + `MustHideIfUnavailable` : masqué.
6. Challenge complété hors disponibilité : visible en mode vue.
7. Jouer : ordre mélangé, input, indices progressifs.
8. Réponse fausse : compteur d'erreurs, pas de blocage.
9. Réponse juste : Pokémon suivant ; dernier → popup de fin.
10. Fin : images, XP, copie du résultat, retour liste.
11. Rejouer : `completedAt`/`fails` écrasés (comportement actuel).
12. Cosmétique débloqué : visible et sélectionnable dans les paramètres.
13. Dex : tous les Pokémon du challenge ajoutés.
14. Rechargement en cours : état restauré via `sessionStorage`.
15. Deux onglets : comportement à vérifier (pas de verrou).

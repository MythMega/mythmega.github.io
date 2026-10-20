# 05 — Mode Marathon (Practice / Entraînement)

## 1. Identité

| Élément | Valeur |
|---|---|
| Page | `pokefeet.html` |
| Scripts | `js/core/pokemon.js`, `js/core/pokemon-versions.js`, `js/features/marathon/game.js`, `js/features/marathon/ui.js`, `js/ui/loader.js`, `js/features/settings/cosmetics.js`, `js/data/migration.js`, i18n |
| Nom UI | « Marathon » |
| Nom code | `Game`, « practice », « Entraînement » |
| Objectif | Deviner un maximum de Pokémon du pool disponible, sans limite de temps, avec reprise de session |

C'est le mode le plus ancien et le plus « bac à sable » : il ne sauvegarde pas d'historique long terme, seulement une session en cours et deux records.

---

## 2. Chargement et pool

`Game.init()` :

```js
const [pokemonsRes] = await Promise.all([
  fetch('data/pokemons.json'),
  TypeIcons.load(),
  PokemonVersions.load()
]);
```

1. Charge les 698 Pokémon en objets `Pokemon`.
2. Calcule la date locale `YYYY-MM-DD`.
3. `PossiblePokemons = PokemonVersions.getAvailablePokemons(pokemons, todayStr)`.
4. Logue le pool et les versions autorisées.
5. En cas d'échec de fetch : **fallback de 3 Pokémon** (Bulbizarre, Salamèche, Carapuce) avec des sprites PokeAPI distants.

Le pool varie donc dans le temps : un Pokémon de la version 4 n'apparaît qu'à partir du 31/08/2026.

---

## 3. Session et reprise

### 3.1 Création

Si aucune session valide :

- seed aléatoire `Math.floor(Math.random() * 2147483647) + 1` ;
- `seededShuffle(PossiblePokemons, seed)` ;
- `fullOrderedIndices = PossiblePokemons.map(p => String(p.Index))` ;
- `pokemonTotal = longueur` ;
- compteurs à zéro, `startedAt = new Date().toISOString()` ;
- `saveSession()`.

### 3.2 Reprise

`loadSession()` lit `pk_practice_session`. Une session `finished: true` est ignorée.

Si une session existe :

- restaure `orderedIndices`, `foundCount`, `score`, `streak`, `perfectCount`, `totalFails`, `startedAt` ;
- reconstruit `PossiblePokemons` à partir de `orderedIndices.slice(foundCount)` ;
- affiche « Partie en cours reprise ».

**Limite** : si `data/pokemons.json` a changé (nouvel Index, renommage), les Index absents sont filtrés silencieusement et la progression peut sauter.

### 3.3 Sauvegarde

`saveSession()` est appelée après chaque bonne réponse. Elle écrit l'état complet. `markSessionFinished()` passe `finished: true` sans supprimer la clé.

`localStorage` peut être indisponible (navigation privée, quota) : les erreurs sont avalées (`catch (e) {}`).

---

## 4. Déroulement d'un round

1. `next()` prend le premier Pokémon de `PossiblePokemons` (`shift()`).
2. Réinitialise : `attempts = 0`, indices, révélation, mauvaises réponses, jauge à 10.
3. Affiche `current.Image` (image partielle).
4. Active l'input et le bouton « Valider », désactive « Suivant ».
5. Focus sur `#guessInput`.

### 4.1 Saisie

- `input` + `keydown` :
  - `ArrowDown`/`ArrowUp` : navigation dans l'autocomplete ;
  - `Escape` : ferme l'autocomplete ;
  - `Enter` : sélectionne l'élément actif puis soumet.
- `blur` ferme l'autocomplete après 150 ms.
- `Espace` (hors input) déclenche `#nextBtn` s'il est actif.
- L'autocomplete est un dropdown custom `#practiceNamesDropdown`, limité à 40 résultats, alimenté par les noms FR/EN.

### 4.2 Validation

`onSubmit()` :

1. Refuse une saisie vide.
2. `isValidName(input)` : le nom doit exister dans **tous** les Pokémon (pas seulement le pool).
3. Si le nom est inconnu :
   - calcule le SHA-256 et le compare à `PASSWORD_HASH` ;
   - si c'est le mot de passe maître : traite comme une bonne réponse ;
   - sinon : animation `shake`, notification « Nom invalide », **aucune tentative consommée**.
4. Refuse une réponse déjà proposée pour ce Pokémon.
5. `current.matchesName(input)` :
   - **correct** : points = `max(10 - 2*attempts, 0)`, score +, streak +, `perfectCount++` si `attempts === 0`, `totalFails += attempts`, `foundCount++`, sauvegarde session, mise à jour barre, notification avec le nom localisé ;
   - **fast mode** : input désactivé, `next()` après 400 ms ;
   - **sinon** : révélation (génération, index, types), « Suivant » activé, input désactivé, affichage de `FullImage` ;
   - **incorrect** : enregistre la réponse, `attempts++`, met à jour la jauge, affiche l'indice correspondant.

### 4.3 Indices

| `attempts` après l'échec | Indice |
|---|---|
| 1 | Type(s) avec badges |
| 2 | Index + génération |
| 3 | Groupes d'œuf |
| 4 | Catégorie |
| 5 | Échec total → game over |

Chaque indice retire 2 points au prochain succès.

---

## 5. Fin de partie

### 5.1 Victoire

Quand `PossiblePokemons.length === 0` :

- `saveBestIfNeeded()` ;
- `showVictoryScreen()` : titre « Félicitations ! », message « Vous avez trouvé tous les Pokémon ! », statistiques (score, trouvés, parfaits, erreurs, série, meilleure série, record), `markSessionFinished()`.

### 5.2 Échec

Après 5 échecs sur un Pokémon :

- `totalFails += 5` ;
- `markSessionFinished()` ;
- `saveBestIfNeeded()` ;
- `showGameOverScreen(current, false)` : titre « Échec ! », image complète, nom, statistiques.

### 5.3 Abandon

Bouton `#abandonBtn` :

- confirmation `practice.confirmAbandon` ;
- `markSessionFinished()` ;
- `saveBestIfNeeded()` ;
- `showGameOverScreen(current, true)` : titre « Partie abandonnée ».

### 5.4 Rejouer

`#gameOverReplayBtn` fait `window.location.reload()`. Comme la session est marquée `finished`, une nouvelle session est créée. `#gameOverHomeBtn` et `#retourBtn` vont vers `index.html`.

---

## 6. Records

| Cookie | Sens | Écriture |
|---|---|---|
| `pk_best` | meilleur score d'une session | `saveBestIfNeeded()` si `score > best` |
| `pk_best_streak` | meilleure série de bonnes réponses | `saveBestStreakIfNeeded()` si `streak > bestStreak` |

La barre de progression `#practiceProgressFill` affiche `foundCount / pokemonTotal`, et `#practiceProgressBestStreak` (ghost) affiche `bestStreak / pokemonTotal`. Cette seconde barre compare une série à un total de pool : la sémantique est discutable mais volontaire.

---

## 7. Mode rapide

Cookie `pk_fast_mode === 'true'` (réglé dans `data_management.html`).

En mode rapide, après une bonne réponse :

- pas d'écran de révélation ;
- input désactivé ;
- `next()` après 400 ms.

En cas d'échec, le comportement reste normal (indices, game over).

---

## 8. Mot de passe maître

```js
const PASSWORD_HASH = '19768d6a62452099c450e0e7d1ba4be25597c2669dcab5fea88fe73ae74ca39e';
```

Le hash SHA-256 est identique dans `js/features/marathon/game.js`, `js/features/daily/daily.js`, `js/features/weekly/weekly.js` et `prediction.html`. Toute saisie dont le hash correspond valide le Pokémon courant. Ce n'est **pas** une sécurité : le hash est public et le bypass est côté client. À remplacer par un mode debug explicite ou supprimer.

---

## 9. Contrat DOM

| ID | Rôle |
|---|---|
| `pokeImg` | image partielle/complète |
| `guessInput` | saisie |
| `submitBtn` / `nextBtn` | actions |
| `score`, `streak`, `bestScore`, `bestStreakScore` | compteurs |
| `hintsList` | indices |
| `revealInfo`, `gen`, `indexDex`, `t1`, `t2` | révélation |
| `practiceNamesDropdown` | autocomplete |
| `practiceAttemptGauge` + `.gauge-fill` + `.gauge-label` | jauge de points |
| `practiceProgressFill`, `practiceProgressBestStreak`, `practiceProgressLabel` | barre de progression |
| `practiceFailedAttempts` | réponses fausses |
| `gameOverScreen`, `gameOverTitle`, `gameOverImg`, `gameOverPokeName`, `gameOverStats` | fin de partie |
| `abandonBtn`, `retourBtn`, `gameOverHomeBtn`, `gameOverReplayBtn` | navigation |

---

## 10. Problèmes connus

| Problème | Détail | Impact |
|---|---|---|
| `gameActive` mort | variable assignée mais jamais lue | aucun effet, code inutile |
| Fallback distant | 3 sprites PokeAPI si le JSON échoue | dépendance réseau inattendue |
| Reprise silencieuse | les Index disparus sont filtrés | saut de progression |
| `isValidName` sur tout le dataset | un Pokémon non disponible dans le pool est accepté comme saisie valide, puis compté faux | confusion possible |
| `TypeIcons` inutile | chargé mais jamais lu | requête inutile |
| Barre « best streak » | compare une série à un total de pool | affichage trompeur |
| Session non nettoyée | la clé reste avec `finished: true` | grossit légèrement |
| Score non historisé | seuls les records sont conservés | pas de stats Marathon détaillées |

---

## 11. Checklist de test manuel

1. Première visite : session créée, pool loggé, image affichée.
2. Rechargement en cours de session : reprise au bon Pokémon, score et série conservés.
3. Bonne réponse du premier coup : +10, série +1, image complète, « Suivant ».
4. 1 à 4 erreurs : indices dans l'ordre, jauge 8/6/4/2.
5. 5 erreurs : game over, image et nom révélés.
6. Abandon : confirmation, game over, session marquée finie.
7. Victoire : écran de félicitations.
8. Mode rapide : passage automatique après 400 ms.
9. Rechargement après game over : nouvelle session.
10. Cookie `pk_best` mis à jour uniquement si score supérieur.
11. Saisie invalide : shake, pas de tentative consommée.
12. Mot de passe maître : valide le Pokémon courant.
13. Navigation clavier : flèches, Entrée, Échap, Espace.
14. JSON indisponible : fallback de 3 Pokémon.

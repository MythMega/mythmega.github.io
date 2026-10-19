# 06 — Mode Daily

## 1. Identité

| Élément | Valeur |
|---|---|
| Page | `daily.html` |
| Scripts | `pokemon.js`, `pokemon-versions.js`, `Dex.js`, `daily.js`, `migration.js`, i18n, cosmetics |
| Constante | `COUNT = 5` |
| Score max | 50 |
| Seed | date `YYYY-MM-DD` |
| Stockage | `PokefeetDB/daily_results` + Dex |

Le Daily est le mode de référence : 5 Pokémon identiques pour tous les joueurs, une fois par jour, avec partage social.

---

## 2. Algorithme déterministe

### 2.1 Sélection

```js
const seed = stringToSeed(sessionDate);       // hash 32 bits de "YYYY-MM-DD"
const rng = mulberry32(seed);
const shuffled = shuffleArrayWithSeed(pool, rng); // Fisher-Yates
dailyList = shuffled.slice(0, 5);
// si le pool contient moins de 5 Pokémon, on boucle pour compléter
```

`stringToSeed` :

```js
let h = 0;
for (let i = 0; i < s.length; i++) h = Math.imul(31, h) + s.charCodeAt(i) | 0;
return h >>> 0;
```

`mulberry32` est le PRNG standard utilisé partout dans l'application.

### 2.2 Pool

`PokemonVersions.getAvailablePokemons(pokemons, sessionDate)` : uniquement les versions déployées à cette date. Un daily rejoué après une mise à jour de contenu peut donc contenir des Pokémon qui n'existaient pas le jour d'origine (si la date est postérieure au déploiement).

### 2.3 Date de session

- `getDateFromURL()` lit `?date=YYYY-MM-DD`.
- Refuse une date future (`alert`, redirection vers la page sans query).
- `sessionDate` est **figée** au démarrage : un passage à minuit ne change pas la partie en cours.
- Sans paramètre : date locale du jour.
- Si l'historique contient déjà cette date : affichage de l'écran « déjà joué » (`renderFinishedFromCookie`).

---

## 3. Déroulement

### 3.1 Démarrage

`Daily.init()` :

1. Garde : ne fait rien si `#dailyImg` est absent.
2. Attend `Migration.ready`.
3. Charge le JSON, `TypeIcons`, `PokemonVersions`.
4. Charge l'historique IndexedDB.
5. Si la date est déjà jouée : rendu de l'écran terminé, boutons de partage actifs, contrôles désactivés.
6. Sinon : construit `dailyList`, initialise `index=0`, `attempts=0`, `score=0`, `results=[]`, `wrongGuessesPerSlot=[5 tableaux vides]`, affiche le premier Pokémon.

### 3.2 Round

- `showCurrent()` affiche `Image` et met à jour les points de progression (`#round-dot-0..4`).
- Saisie : input + autocomplete custom + `Enter`.
- `submitGuess()` :
  - refuse vide / nom inconnu / déjà essayé ;
  - si correct : `handleCorrect()` ;
  - sinon : enregistre la mauvaise réponse, `attempts++`, met à jour la jauge, affiche l'indice ; à 5 échecs, `failCurrentAndAdvance()`.

### 3.3 Bonne réponse

`handleCorrect()` :

1. Vérifie si le Pokémon est nouveau dans le Dex **avant** de le marquer.
2. Affiche la bannière « Nouveau Pokémon ! » si applicable.
3. `points = max(10 - 2*attempts, 0)`.
4. `results.push({outcome:'win', attempts})`.
5. Révélation (génération, index, types) + image complète.
6. Mise à jour des points, notification `+N points`.
7. `nextPokemon()` après 700 ms.

### 3.4 Échec

À 5 échecs :

- `results.push({outcome:'fail', attempts:5})` ;
- `showFailPopup(dailyList[index])` : popup avec nom, image complète, image du pied, indices, bouton de confirmation ;
- la popup ne peut pas être fermée accidentellement par la touche Entrée qui vient de valider (garde de 250 ms) ;
- `confirmFailAndAdvance()` : cache la popup, révèle le Pokémon, `nextPokemon()` après 700 ms.

Le bouton « Passer » (`#dailySkip`) fait la même chose après confirmation, mais seulement si `busy === false` (protection contre le double-clic).

### 3.5 Fin

Quand `index >= 5`, `finishDaily()` :

1. Construit `{date: sessionDate, results, score, wrongGuesses}`.
2. `saveResultForToday()` : lit tout l'historique, ajoute la date, réécrit tout le store (`clear + put`), marque `importedInDex = true`.
3. `checkNewPokemons()` : pour chaque gagnant, vérifie l'entrée Dex avant marquage.
4. `Dex.markFound()` pour chaque gagnant.
5. Affiche l'alerte « nouveaux Pokémon ».
6. Construit le texte de partage long, affiche le panneau de fin.
7. Affiche les images complètes des 5 Pokémon.
8. Cache la jauge et les éléments de jeu, désactive input/submit/skip.

---

## 4. Partage

### 4.1 Format long

```text
Pokefeet Daily — 2026-10-19 — score 38
🟧🟩🟩🟩🟩
🟩🟩🟩🟩🟩
🟥🟥🟥🟥🟥
🟧🟧🟩🟩🟩
🟩🟩🟩🟩🟩
```

- 5 carrés par round.
- `🟩` = trouvé sans erreur ; `🟧` = trouvé après N erreurs (N orangés) ; `🟥` = échec (5 rouges).
- Le nombre total de carrés par ligne est toujours 5.

### 4.2 Format mini

```text
Pokefeet Daily (mini) — 2026-10-19 — score 38
🟧 🟩 🟥 🟧 🟩
```

Un seul emoji par round. **Perte d'information** : impossible de distinguer 1, 2, 3 ou 4 erreurs.

### 4.3 Boutons

| Bouton | Comportement |
|---|---|
| `#copyShare` | copie le texte long + URL + lignes `R1 : ||nom||` des mauvaises réponses |
| `#copyMiniShare` | copie le texte mini + URL + mauvaises réponses |
| `#copyDiscordShare` | copie long + mauvaises réponses, puis ouvre `https://discord.gg/yY3b8RYznN` |
| `#viewDetails` | `alert()` avec le détail par round (nom, outcome, attempts) |

Les mauvaises réponses sont formatées `||nom||` (syntaxe de spoiler Discord).

---

## 5. Persistance et effets de bord

| Effet | Détail |
|---|---|
| Historique | `daily_results` : `{date, score, results, wrongGuesses, importedInDex}` |
| Dex | `markFound` pour chaque gagnant |
| Nouveaux Pokémon | bannière immédiate + alerte de fin |
| Reprise | Pas de reprise en cours de Daily : si la page est rechargée avant la fin, rien n'est sauvegardé et la partie recommence |
| `beforeunload` | Confirmation native si `index < 5` ; les réponses ne sont pas persistées |
| Date | `sessionDate` figée ; un daily du futur est refusé |

### 5.1 Écran « déjà joué »

`renderFinishedFromCookie(saved, date)` :

- reconstruit le texte de partage ;
- marque les 5 points selon les résultats ;
- désactive les contrôles ;
- reconstruit la liste déterministe pour afficher les images complètes ;
- restaure `results`, `score`, `wrongGuessesPerSlot`, `index = 5`.

---

## 6. Images

`loadImageWithRetry(el, src)` :

- `MAX_IMG_RETRIES = 10`, délai 1 s ;
- réinitialise le compteur à chaque nouvelle image ;
- ne réessaie que si `src` n'a pas changé ;
- `loadPopupImage()` fait la même chose pour les deux images de la popup d'échec.

Ce mécanisme compense les échecs de chargement des sprites, mais peut masquer une image réellement absente (10 tentatives silencieuses).

---

## 7. Problèmes connus

| Problème | Détail | Impact |
|---|---|---|
| Pas de sauvegarde en cours de partie | seuls les jours terminés sont persistés | perte de progression au rechargement |
| `clear + put` | réécrit tout le store | conflit multi-onglets |
| Import mini lossy | `🟧` → 1 tentative | score/XP sous-estimés |
| `wrongGuesses` non borné | un tableau par slot, pas de limite | taille si nombreuses tentatives (mais max 5 par slot) |
| `resultToEmojiLine` mort | fonction jamais appelée | code inutile |
| `cookieName` mort | constante jamais utilisée | code inutile |
| `populateNamesList` no-op | appelée mais vide | code inutile |
| Popup d'échec | deux images et indices | doublon avec le panneau latéral |
| Mot de passe maître | bypass client | triche facile |

---

## 8. Checklist de test manuel

1. Daily du jour : 5 Pokémon, ordre identique après rechargement/rejouer sur un autre navigateur à la même date.
2. `?date=` passé : rejoue un daily antérieur ; si déjà joué, écran terminé.
3. `?date=` futur : alerte et redirection.
4. Bonne réponse 1er essai : +10, point vert.
5. 1–4 erreurs : indices et points 8/6/4/2.
6. 5 erreurs : popup, confirmation, passage au suivant.
7. « Passer » : confirmation, échec enregistré.
8. Fin : score, partage long/mini/Discord, images complètes.
9. Dex : nouveaux Pokémon marqués une seule fois, bannière au bon moment.
10. Rejouer le même jour : écran terminé, contrôles désactivés.
11. Rechargement en cours : confirmation de sortie, partie non sauvegardée.
12. Images indisponibles : retry puis arrêt après 10 tentatives.
13. Import ultérieur du daily : le Dex ne doit marquer que les gagnants (bug connu, voir doc 04).

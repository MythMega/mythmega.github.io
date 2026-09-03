# Challenges Custom — `custom*.html`

## Vue d'ensemble

Les Challenges Custom permettent aux utilisateurs de **créer** et **partager** leurs propres défis de devinette par les pieds, puis de les **jouer**, dans un esprit **arcade** : aucune sauvegarde, aucune XP, aucune récompense. Tout le contenu d'un challenge est transporté dans l'**URL** sous forme d'un code court (`custom_play.html?code=<code>`), sans aucun backend.

### Pages

| Page | Rôle |
|---|---|
| `custom.html` | Hub : choisir entre **créer** un challenge (`custom_create.html`) ou **jouer** un challenge (`custom_play.html`) |
| `custom_create.html` | Création : choix des Pokémon, ordre, nom, auteur, génération de l'URL |
| `custom_play.html` | Lecture : saisie d'un code, informations du challenge, jeu, écran de fin / partage |

### Fichiers du module

| Chemin | Rôle |
|---|---|
| `business/custom_challenges/custom-challenge-codec.js` | Encodage / décodage du challenge dans un code court (URL) |
| `business/custom_challenges/custom-challenge-game.js` | Logique métier d'une session de jeu (arcade, sans persistance) |
| `ui/custom_challenges/custom-create-ui.js` | Interface de la page de création |
| `ui/custom_challenges/custom-play-ui.js` | Interface de la page de jeu |
| `styles/custom_challenges/custom-challenges.css` | Styles dédiés aux 3 pages |
| `translations/fr.json` / `translations/en.json` | Clés `custom.*`, `customCreate.*`, `customPlay.*` |

Les 3 pages HTML suivent la structure standard commune (`<main id="app">`, décorations `deco`, header), chargent `style.css`, `cosmetics.css`, `text-shadow.css` puis le CSS du module, et les boutons principaux portent `data-tag="customizables-button"` pour être compatibles avec le système de cosmétiques.

---

## 1. L'encodage du code — `custom-challenge-codec.js`

Module IIFE exposant `{ encode, decode }`.

### Données transportées

```js
// Structure interne (clés courtes pour minimiser la taille)
{
  a: "Auteur",        // author  (défaut "Trainer")
  n: "Nom",           // name
  r: 0 | 1,           // random (ordre aléatoire en jeu si 1)
  p: ["67","217",...] // pokemons (index sous forme de chaînes)
}
```

### Format du code

```
[marqueur][base64url(...)]
```

- **marqueur `1`** : JSON UTF-8 **compressé** (`CompressionStream` deflate-raw) puis base64url
- **marqueur `2`** : JSON UTF-8 simplement en base64url (fallback si la compression n'est pas disponible ou n'apporte rien)

Le base64url remplace `+` → `-`, `/` → `_` et supprime les `=` de padding (garantit une URL sûre sans re-encodage). L'encodage ne garde la version compressée **que si elle est réellement plus courte** que le brut.

---

## 2. Le moteur de jeu — `custom-challenge-game.js`

Module IIFE exposant l'API suivante :

| Méthode | Description |
|---|---|
| `loadPokemons()` | Charge `data/pokemons.json` (mise en cache interne), instancie des `Pokemon` |
| `start(data)` | Initialise une session depuis `{ author, name, random, pokemons }`, retourne le nombre de Pokémon |
| `getChallenge()` | Données du challenge (`author`, `name`, `random`, `pokemons`) |
| `getOrder()` | Les Pokémon résolus, **dans l'ordre de jeu effectif** |
| `getCurrentPokemon()` | Pokémon courant (ou `null`) |
| `getProgress()` | `{ current, total }` |
| `getTotalFails()` | Nombre total de mauvaises réponses de la partie |
| `getPerSlot()` | Résultat par Pokémon : `{ outcome, attempts, wrong: [] }` |
| `getCurrentWrong()` | Mauvaises réponses du Pokémon courant |
| `isFinished()` | `true` quand tous les Pokémon sont traités |
| `checkAnswer(answer)` | Vérifie la réponse, avance le tour |
| `getAllPokemons()` | Liste complète des Pokémon chargés |
| `reset()` | Vide l'état de session |

### Ordre de jeu

- `start()` résout les index (`resolvePokemon`) puis construit la liste de jeu :
  - `random: false` → **l'ordre exact** défini par le créateur ;
  - `random: true` → **mélange aléatoire** (`Math.random()`, Fisher-Yates).
- `getOrder()` reflète cet ordre effectif (utile pour l'écran de fin et le partage).

### `checkAnswer(answer)`

- Utilise `Pokemon.matchesName()` (insensible casse + accents, nom FR ou EN pris en charge).
- **Bonne réponse** → marque `perSlot[currentSlot] = { outcome: 'win', attempts, wrong }`, passe au Pokémon suivant, retourne `{ correct: true, finished, pokemon }`.
- **Mauvaise réponse** → `currentAttempts++`, `totalFails++`, ajoute la réponse à `currentWrong`, retourne `{ correct: false, finished: false, pokemon }`.

> Contrairement au Daily/Weekly, **aucune limite d'échecs** : les indices défilent tant que la réponse est fausse (arcade, sans game over).
### Décode

`decode(input)` accepte indifféremment :
- le **code seul** (`2eyJhIjoiVHJhaW5lciI...`)
---

## 3. Création — `custom-create-ui.js` + `custom_create.html`

Le module expose `{ init }`, appelé au `DOMContentLoaded`.

### Formulaire

| Champ | ID | Détails |
|---|---|---|
| Nom du challenge | `#createName` | maxlength 60, obligatoire |
| Auteur | `#createAuthor` | pré-rempli depuis le cookie `pk_pseudo` (défaut `"Trainer"`), maxlength 30 |
| Ordre aléatoire en jeu | `#createRandom` | switch booléen (défaut `false`) |

### Picker de Pokémon (`#pokemonPicker`)

- Charge `data/pokemons.json` (instances `Pokemon`).
- Barre de recherche `#createSearch` **filtre en direct** sur le nom FR, le nom EN ou l'index (`normalize` → sans accents, minuscules).
- Grille de miniatures (`FullImage`), clic → ajoute à la séquence (`data-index`), classe `.selected` si déjà choisi.
- Compteur `#pickerCount` affiche le nombre de résultats filtrés ; si aucun, message *Aucun Pokémon trouvé*.

### Séquence sélectionnée (`#sequenceList`)

- Chaque item affiche : poignée de drag `⠿`, sprite, `#Index`, nom, bouton de suppression `✕`.
- **Drag & drop** natif HTML5 pour réordonner (`dragstart` / `dragover` / `dragenter` / `drop` / `dragend`), avec classe `.drag-over` pendant le survol.
- Compteur `#sequenceCount`.

### Outils de réorganisation

| Bouton | ID | Comportement |
|---|---|---|
| Trier par index | `#sortIndexBtn` | Trie `selected` par index (comparaison numérique) |
| Ordre aléatoire | `#shuffleBtn` | Mélange `selected` |

### Génération

`updateGenerate()` pilote l'état du bouton **Générer le challenge** (`#generateBtn`) :
- désactivé tant que le nom est absent **ou** que la séquence contient moins de 2 Pokémon ;
- messages d'aide dans `#generateHint` (*Nom requis*, *Au moins 2 Pokémon requis*, …).

`generate()` :
1. encode `{ author, name, random, pokemons: selected }` via `CustomChallengeCodec.encode()`,
2. construit l'URL `custom_play.html?code=<code>`,
3. affiche `#customResultCard` avec `#resultUrl`, boutons **Copier l'URL**, **Ouvrir le challenge**, **Régénérer** (re-masque la carte).
- une **URL complète** (`https://.../custom_play.html?code=2eyJhIjoiVHJhaW5lciI...`)

Le décodage :
---

## 4. Lecture & jeu — `custom-play-ui.js` + `custom_play.html`

Le module expose `{ init }`, appelé au `DOMContentLoaded`. Il gère 5 "vues" (`showView(id)` bascule la classe `hidden`) :

| Vue | ID | Contenu |
|---|---|---|
| Saisie du code | `#codeEntryView` | Input + bouton **Charger** (accepte code seul ou URL complète) |
| Code invalide | `#invalidView` | Message d'erreur + champ de réessai |
| Infos challenge | `#infoView` | Nom, auteur, nombre de Pokémon, mode d'ordre, boutons **Jouer** et **Copier le JSON** |
| Jeu | `#gameView` | Image des pieds, input + autocomplete, indices, compteur d'échecs |
| Fin de partie | `#doneView` | Résumé, erreurs, images complètes, URL + texte de partage |

### Chargement du code (`loadCode`)

- `init()` lit `?code=` ; s'il est présent → `loadCode(codeParam)`, sinon → `#codeEntryView`.
- `loadCode` appelle `CustomChallengeCodec.decode()` ; en cas d'échec ou de données invalides (< 2 Pokémon) → `#invalidView`.
- En cas de succès → charge les Pokémon (`CustomChallengeGame.loadPokemons()`), affiche `#infoView` (`renderInfo`) avec :
  - `#infoCount` : `N Pokémon`,
  - `#infoRandom` : *Ordre aléatoire en jeu* ou *Ordre tel que défini par le créateur*.

### Bouton "Copier le JSON"

Sur l'écran d'infos, `#copyJsonBtn` copie dans le presse-papier un **JSON au format des challenges bonus** partageables :

```json
{
  "ID": 9999,
  "Difficulty": "Medium",
  "Requirements": [],
  "Tab": "Custom",
  "Name_En": "<name>",
  "Name_Fr": "<name>",
  "Desc_En": "Custom Challenge.",
  "Desc_Fr": "Challenge Custom.",
  "Additional_Info_Fr": "Challenge custom proposé par <author>",
  "Additional_Info_En": "Custom Challenge by <author>",
  "FeetList": ["67", "217", "250", ...],
  "Rewards": [],
  "MustHideIfUnavailable": true,
  "Availabilities": []
}
```

Le JSON est généré par `buildChallengeJson()` (nom/auteur et `FeetList` réels), sérialisé indenté (4 espaces), et copié avec notification de succès/échec.
### Jeu (`startGame` → `renderGame`)

- `startGame()` appelle `CustomChallengeGame.start(...)` puis affiche `#gameView`.
- `renderGame()` :
  - image partielle `#playImg` (`p.Image`),
  - progression `#playProgress` (`current + 1 / total`),
  - échecs totaux dans `#playFails`,
  - réinitialise les indices (`#playHints`) et la liste des échecs courants (`#playFailedAttempts`).
- **Autocomplete** (système maison, même style que `daily.js` / `ui.js`) : filtre les Pokémon dont le nom normalisé (FR ou EN) contient la saisie, limite à 40 suggestions, clic ou `Enter` soumet, `Escape`/`blur` ferme.
- **Indices progressifs** (`giveHint`) — identiques à `challenge.html` :
  | Échec | Indice |
  |---|---|
  | 1 | Type(s) (badges colorés) |
  | 2 | Index + Génération |
  | 3 | Groupes d'œuf |
  | 4 | Catégorie |
- `submitGuess()` valide d'abord que le nom **existe** (FR/EN), rejette les doublons sur le Pokémon courant, puis `CustomChallengeGame.checkAnswer()`.

### Fin de partie (`renderDone` → `#doneView`)

- Nom du challenge, auteur, nombre de Pokémon, **nombre total d'erreurs**.
- **Images complètes** de tous les Pokémon de l'ordre de jeu (`#doneFullImages`).
- **Texte de partage** (`buildShareText`, style `daily.html`) :
  ```
  Pokefeet Custom — <name> — <author> — N Pokémon — F erreur(s)
  🟩🟧🟥...                          (1 carré par round)
  R2 : ||Pikachu|| ||Carapuce||      (mauvaises réponses par round)
  https://.../custom_play.html?code=...
  ```
  - 🟩 = trouvé du premier coup, 🟧 = trouvé après échecs, 🟥 = jamais trouvé.
- Champ `#doneUrl` + boutons **Copier l'URL** et **Copier résultat** (copie `buildShareText()`), **Rejouer** (relance une session), **Nouveau challenge** (retour à `custom.html`).

### URL complète

`buildChallengeUrl()` reconstruit une **URL absolue** à partir de `window.location.origin + window.location.pathname`, suivie de `?code=<code>` (et non une URL relative) — adaptée au partage hors du site.
1. extrait `?code=...` si présent,
2. applique `decodeURIComponent` (percent-encoding),
3. vérifie le marqueur + la validité base64url,
4. décompresse / décode,
---

## 5. i18n

- Clés dédiées : `custom.*` (hub), `customCreate.*` (création), `customPlay.*` (lecture/jeu), dans `translations/fr.json` et `translations/en.json`.
- Les textes statiques des 3 pages utilisent `data-i18n` / `data-i18n-attr` ; les textes dynamiques passent par la fonction locale `T(key, fallback)` (via `Translator.get`) — les clés `daily.*`, `types.*`, `common.*` sont réutilisées pour les indices et les notifications.
- **Piège important** : l'affichage des textes dynamiques attend l'initialisation de `Translator` via la fonction `translatorReady()` dans les deux modules UI. Sans cette attente, `Translator.get()` retombe sur les fallbacks FR pendant que les fichiers de traduction chargent (course réseau) → la page s'affiche en français même configurée en anglais.

---

## 6. Notes d'architecture

- **Aucune persistance** : le challenge vit uniquement dans l'URL (code) et l'état de session est en mémoire (`CustomChallengeGame`). Recharger la page relance la partie.
- **Sans dépendance externe** : pas de framework ; mécanismes web natifs (`CompressionStream`, drag & drop HTML5, `navigator.clipboard`, `TextEncoder`/`TextDecoder`, `btoa`/`atob`).
- Les pages sont rattachées à l'accueil via le lien **Challenges Custom** de `index.html` (`home.customChallenges`).
5. `JSON.parse` et valide la présence de `p` (tableau).

Tout échec retourne `null` (la page affiche alors l'écran *Code invalide*).
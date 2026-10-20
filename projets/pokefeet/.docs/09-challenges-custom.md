# 09 — Challenges custom

## 1. Identité

| Élément | Valeur |
|---|---|
| Pages | `custom.html` (hub), `custom_create.html`, `custom_play.html` |
| Métier | `js/features/custom-challenges/codec.js`, `custom-challenge-game.js` |
| UI | `js/features/custom-challenges/create-ui.js`, `custom-play-ui.js` |
| CSS | `styles/custom-challenges.css` |
| Persistance | **aucune** (arcade) |
| Partage | URL contenant un code compressé |

Les challenges custom permettent à un joueur de composer une séquence de Pokémon, de la partager par URL, et à un autre joueur de la rejouer sans compte ni sauvegarde.

---

## 2. Hub (`custom.html`)

Page statique avec deux actions :

- **Créer un challenge** → `custom_create.html`
- **Jouer un challenge** → `custom_play.html`

Le hub charge `js/data/migration.js`, `challenge-storage.js` et `js/features/settings/cosmetics.js` uniquement pour appliquer les cosmétiques (eux-mêmes dépendants des complétions de challenges).

---

## 3. Création (`custom_create.html`)

### 3.1 État local

```js
let pokemons = [];      // tous les Pokémon
let selected = [];      // Index sélectionnés, dans l'ordre
```

Aucune sauvegarde : un rechargement perd la sélection.

### 3.2 Interface

| Élément | Rôle |
|---|---|
| `#createSearch` | filtre le picker par nom FR/EN |
| `#pokemonPicker` | grille de Pokémon sélectionnables |
| `#sequenceList` | séquence ordonnée |
| `#sequenceCount` | nombre de Pokémon |
| `#createName` | nom du challenge |
| `#createAuthor` | auteur (prérempli avec `pk_pseudo` ou `Trainer`) |
| `#createRandom` | ordre aléatoire en jeu |
| `#sortIndexBtn` | trie la séquence par Index |
| `#shuffleBtn` | mélange la séquence |
| `#generateBtn` | génère l'URL |
| `#customResultCard`, `#resultUrl` | résultat |
| `#copyUrlBtn`, `#openChallengeBtn`, `#regenerateBtn` | actions |

### 3.3 Sélection

- Clic sur un Pokémon du picker : `addPokemon(index)`.
- Un Pokémon déjà sélectionné n'est pas ajouté deux fois : `addPokemon()` retourne immédiatement si `isSelected(index)`.
- Minimum **2 Pokémon** pour générer (`selected.length >= 2`).
- **Aucun maximum** explicite côté code.
- Réordonnancement par drag & drop (`bindDragDrop`).
- `removePokemonAt(slot)`, `reorderSequence(from, to)`, `sortByIndex()`, `randomizeSequence()`.

### 3.4 Validation

`updateGenerate()` active le bouton si :

```js
name.length > 0 && selected.length >= 2
```

`generate()` :

1. Refuse si nom vide ou moins de 2 Pokémon (notification).
2. `author = input || 'Trainer'`.
3. `random = checkbox`.
4. `code = await CustomChallengeCodec.encode({author, name, random, pokemons: selected})`.
5. `url = new URL('custom_play.html?code=' + code, window.location.href).href` (URL absolue).
6. Affiche le résultat, active la copie et l'ouverture.

---

## 4. Codec (`custom-challenge-codec.js`)

### 4.1 Payload

```js
{
  a: "Auteur",
  n: "Nom",
  r: 0 | 1,
  p: ["1", "4", "7"]
}
```

### 4.2 Encodage

1. `JSON.stringify(payload)` → `TextEncoder` → `Uint8Array`.
2. Si `CompressionStream` est disponible :
   - `deflate-raw` ;
   - si le résultat est plus court que les octets bruts, préfixe `1` + base64url.
3. Sinon (ou si la compression n'aide pas) : préfixe `2` + base64url des octets bruts.

Base64url : `+` → `-`, `/` → `_`, suppression du padding `=`.

### 4.3 Décodage

- Accepte un code seul **ou** une URL complète (`?code=...` extrait par regex).
- `decodeURIComponent` tolérant.
- Longueur minimale 2.
- Marqueur `1` : nécessite `DecompressionStream`, sinon `null`.
- Marqueur `2` : base64url direct.
- Vérifie `payload.p` est un tableau.
- Retourne `{author, name, random, pokemons}` avec des chaînes.
- Toute erreur → `null`.

### 4.4 Limites

- Pas de version de payload explicite (seul le marqueur distingue compression/base64).
- Pas de signature : un code peut être forgé.
- Pas de limite de taille : une URL très longue peut dépasser les capacités du navigateur/Discord.
- Les Index inconnus sont ignorés silencieusement au démarrage du jeu (`filter(Boolean)`).

---

## 5. Jeu (`custom_play.html`)

### 5.1 Vues

`CustomPlayUI` gère plusieurs vues :

| Vue | Contenu |
|---|---|
| `codeEntryView` | saisie d'un code/URL |
| `invalidView` | code invalide + nouvelle saisie |
| `infoView` | nom, auteur, nombre de Pokémon, ordre fixe/aléatoire |
| `gameView` | jeu |
| `doneView` | bilan, images, partage |

### 5.2 Chargement

- `?code=` présent : `loadCode()` automatiquement.
- Sinon : `codeEntryView`.
- `loadCode()` décode, vérifie `name` et `pokemons.length >= 2`, charge les Pokémon, affiche `infoView`.
- `showInvalid()` si échec.

### 5.3 Démarrage

`CustomChallengeGame.start({author, name, random, pokemons})` :

- résout chaque Index en `Pokemon` ;
- `order = random ? shuffle(list) : list` ;
- initialise `currentSlot=0`, `currentAttempts=0`, `currentWrong=[]`, `totalFails=0`, `perSlot` avec `pending`.

### 5.4 Réponses

`checkAnswer(answer)` :

- correct : `perSlot[slot] = {outcome:'win', attempts, wrong}` ; slot suivant ; reset des compteurs locaux ; `finished` si dernier.
- incorrect : `currentAttempts++`, `totalFails++`, ajoute la réponse ; pas de limite.
- `matchesName` gère FR/EN et les accents.

### 5.5 Indices

`giveHint(attempt)` affiche progressivement les mêmes informations que les autres modes. Les indices sont cumulatifs et sans pénalité de score (il n'y a pas de score).

### 5.6 Fin

`renderDone()` :

- nom, auteur, nombre de Pokémon, total d'erreurs ;
- URL du challenge ;
- images complètes ;
- texte de partage :

```text
Pokefeet Custom — <nom> — <auteur> — <N> Pokémon — <E> erreur(s)
🟩🟧🟥...
R1 : ||fausse réponse|| ...
<url>
```

- boutons copier l'URL, copier le partage, rejouer, retour au hub.

### 5.7 Export JSON

`copyChallengeJson()` produit un objet compatible avec `bonus_challenges.json` :

```json
{
  "ID": 9999,
  "Difficulty": "Medium",
  "Requirements": [],
  "Tab": "Custom",
  "Name_En": "...",
  "Name_Fr": "...",
  "Desc_En": "Custom Challenge.",
  "Desc_Fr": "Challenge Custom.",
  "Additional_Info_Fr": "Challenge custom proposé par ...",
  "Additional_Info_En": "Custom Challenge by ...",
  "FeetList": ["1", "4"],
  "Rewards": [],
  "MustHideIfUnavailable": true,
  "Availabilities": []
}
```

C'est un pont manuel vers le catalogue de challenges bonus, mais **aucun import automatique** n'existe.

---

## 6. Sécurité et robustesse

- Le code est une donnée **non fiable** : il est décodé puis utilisé pour retrouver des Pokémon locaux. Les Index inconnus sont ignorés.
- Les textes (nom, auteur) sont insérés via `textContent` dans l'UI, ce qui limite les injections HTML. Le JSON exporté est construit par `JSON.stringify`.
- `CompressionStream`/`DecompressionStream` ne sont pas disponibles partout (Safari ancien, contextes non sécurisés) : le fallback non compressé fonctionne, mais un code compressé reçu ne pourra pas être lu.
- Aucune limite de nombre de Pokémon : une URL peut devenir très longue.
- Aucune persistance : fermer l'onglet perd la partie.

---

## 7. Problèmes connus

| Problème | Détail |
|---|---|
| Pas de maximum | séquence et URL non bornées |
| Doublons | `addPokemon()` empêche les doublons ; le picker marque les sélectionnés |
| Pas de version de codec | évolution du payload à anticiper |
| `CustomChallengeGame` dépend de `Pokemon` global | pas de module |
| `reset()` jamais appelé | état résiduel si réutilisation |
| `getAllPokemons()` | utilisé par l'autocomplete du jeu ; export légitime |
| `reset()` | aucun appel externe détecté |
| JSON export ID 9999 | collision si importé plusieurs fois |
| Aucun test | codec et décodage sont pourtant des fonctions pures faciles à tester |

---

## 8. Checklist de test manuel

1. Créer avec 0, 1, 2 Pokémon : bouton désactivé puis actif à 2.
2. Recherche FR/EN, accents.
3. Ajouter, retirer, réordonner par drag & drop.
4. Trier par Index, mélanger.
5. Générer sans nom : notification, pas d'URL.
6. Générer : URL absolue, copiable, ouvrable.
7. Ouvrir l'URL : info correcte (nom, auteur, nombre, ordre).
8. Jouer : ordre fixe ou aléatoire.
9. Réponse fausse répétée : indices cumulés, pas de blocage.
10. Réponse juste : Pokémon suivant.
11. Fin : images, erreurs, partage, URL.
12. Rejouer : nouvelle partie, compteurs remis à zéro.
13. Code invalide : vue invalide, nouvelle saisie.
14. Code compressé (`1...`) et non compressé (`2...`) : les deux fonctionnent.
15. URL complète collée : le paramètre `code` est extrait.
16. Export JSON : structure compatible, copiable.
17. Navigation privée / navigateur sans CompressionStream : fallback.

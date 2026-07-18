# Mode Daily — `daily.js`

## Vue d'ensemble

Le mode Daily propose **5 Pokémon identiques pour tous les joueurs chaque jour**. La sélection est déterministe : elle utilise la date du jour comme seed pour un PRNG (Mulberry32).

## Déterminisme

### Seed

```js
function dateSeedStr(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
// Exemple : "2026-07-09"
```

Le seed est converti en entier 32 bits via un hash simple :

```js
function stringToSeed(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
        h = Math.imul(31, h) + s.charCodeAt(i) | 0;
    }
    return h >>> 0;
}
```

### PRNG : Mulberry32

```js
function mulberry32(a) {
    return function() {
        let t = a += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}
```

### Sélection des Pokémon

1. Récupère tous les Pokémon disponibles à la date du jour via `PokemonVersions.getAvailablePokemons()`
2. Mélange avec le PRNG seedé par la date
3. Prend les 5 premiers
4. Si moins de 5 disponibles, boucle sur la liste mélangée

## Paramètre URL

```
daily.html?date=2026-07-09
```

Permet de rejouer un daily passé. La date est validée :
- Doit être au format `YYYY-MM-DD`
- Ne doit pas être dans le futur

## Déroulement

1. **5 rounds** (index 0 à 4)
2. Chaque round : image partielle → le joueur devine
3. **5 tentatives max** par Pokémon
4. Après 5 échecs : le Pokémon est révélé et on passe au suivant

## Indices (identiques au Marathon)

| Tentative ratée | Indice |
|---|---|
| 1 | Type(s) |
| 2 | Index + Génération |
| 3 | Groupe(s) d'œuf |
| 4 | Catégorie |

## Scoring

Même système que le Marathon : 10 points - 2 par indice utilisé.

## Fin de partie

Quand les 5 Pokémon sont traités :
1. Les résultats sont sauvegardés dans IndexedDB (`daily_results`)
2. Le Dex est mis à jour pour les Pokémon trouvés
3. Un écran de partage s'affiche avec :
   - **Texte standard** : 5 lignes de 5 carrés (🟩🟧🟥)
   - **Texte mini** : 1 ligne avec 1 emoji par round
   - **Partage Discord** : copie + ouvre le lien Discord

## Stockage

Les résultats sont stockés dans IndexedDB, base `PokefeetDB`, store `daily_results` :

```json
{
  "date": "2026-07-09",
  "score": 42,
  "results": [
    { "outcome": "win", "attempts": 0 },
    { "outcome": "win", "attempts": 2 },
    { "outcome": "fail", "attempts": 5 },
    ...
  ],
  "wrongGuesses": [
    ["Pikachu", "Carapuce"],
    [],
    ["Salamèche", "Bulbizarre", ...],
    ...
  ],
  "importedInDex": true
}
```

## Nouveaux Pokémon

À la fin d'un daily, les Pokémon trouvés pour la **première fois** (pas encore dans le Dex) déclenchent :
1. Une bannière "🌟 Nouveau Pokémon découvert !"
2. Le marquage dans le Dex via `Dex.markFound()`

## Mot de passe secret

Un hash SHA-256 permet de valider n'importe quel Pokémon sans le connaître (utile pour le debug).

## UI spécifique

- **Jauge de score** : montre les points potentiels pour la prochaine réponse correcte
- **Pastilles de progression** : 5 pastilles (🟩 = parfait, 🟧 = imparfait, 🟥 = échec)
- **Bouton Passer** : permet de sauter un Pokémon (confirmé)
- **Confirmation de départ** : si une partie est en cours, confirmation avant de quitter
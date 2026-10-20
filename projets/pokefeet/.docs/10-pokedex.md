# 10 — Pokédex

## 1. Identité

| Élément | Valeur |
|---|---|
| Page | `pied-dex.html` |
| Logique | `js/data/dex.js` (base), `js/features/dex/dex-ui.js` (rendu), `js/data/daily-to-dex-import.js` (reconstruction/import) |
| Base | `PokefeetDexDB`, version 4, store `dex_entries` |
| Total affiché | 698 Pokémon (toutes versions, pas de filtre par date) |

Le Pokédex est la collection locale : chaque Pokémon trouvé y est marqué, avec la date de première découverte et un compteur.

---

## 2. `js/data/dex.js`

### API

| Fonction | Comportement |
|---|---|
| `init()` | fetch `data/pokemons.json`, instancie les `Pokemon` dans `allPokemons`. |
| `getDB()` | ouvre `PokefeetDexDB` v4, crée `dex_entries` (clé `index`) si absent. |
| `getAllDexEntries()` | `getAll()` sur le store. |
| `getDexEntry(index)` | `get(index)`. |
| `updateDexEntry(index, updates)` | lit, fusionne, `put`. Crée `{index, found:false, firstFoundDate:null, count:0}` si absent. |
| `markFound(index, date)` | `found: true`, `count + 1`, `firstFoundDate` si absent. |
| `addNewDexEntry(index, date)` | si déjà `found`, ne fait rien ; sinon `found: true`, `count: 1`, `firstFoundDate = date`. |
| `getProgress()` | `{found: nombre d'entrées trouvées, total: allPokemons.length}`. |
| `getAllPokemons()` | tableau en mémoire. |

### Points d'attention

- `count` compte les **appels à `markFound`**, pas les occurrences réelles dans les parties. Un import qui marque à nouveau un Pokémon incrémente le compteur.
- `addNewDexEntry` ne passe pas par `markFound` : le compteur reste à 1.
- Aucune transaction multi-store : le Dex est indépendant des historiques.
- `getProgress()` compte les entrées `found`, pas les Index uniques ; comme la clé est `index`, c'est équivalent.

---

## 3. Page `pied-dex.html`

### 3.1 Initialisation

Script inline :

1. `await Dex.init()`.
2. `getAllDexEntries()`.
3. `getProgress()`.
4. `DexUI.updateProgress(found, total)`.
5. `DexUI.renderDexGrid(Dex.getAllPokemons(), dexData)`.
6. `DexUI.bindEvents()`.

### 3.2 Grille

Chaque entrée :

- `data-index`, `data-name-fr`, `data-name-en`, `data-found` ;
- image `Image` (partielle) ;
- si non trouvé : classe `black-filter` (silhouette noire) ;
- nom affiché `NomFR (NomEN) #Index` ;
- bouton « + d'info », désactivé si non trouvé.

### 3.3 Filtres

| Contrôle | Effet |
|---|---|
| `#searchInput` | recherche sur nom FR, nom EN et index (sous-chaîne, minuscules) |
| `#showFoundCheckbox` | n'afficher que les trouvés |
| `#showNotFoundCheckbox` | n'afficher que les non trouvés |

Les deux checkboxes sont **mutuellement exclusives** : cocher l'une décoche l'autre. Si aucune n'est cochée, tout est affiché.

### 3.4 Tri

`#sortSelect` :

- `index` (défaut) ;
- `name` ;
- `count` (les non-trouvés restent à la fin quel que soit le sens) ;
- `type` (Type1) ;
- `eggGroup` (premier groupe) ;
- `firstFound` (date).

`#sortDirectionBtn` bascule asc/desc et reconstruit la grille.

### 3.5 Popup

Affiche :

- nom FR/EN ;
- images complète et partielle ;
- index, génération, Type1, Type2, groupes d'œuf, catégorie ;
- trouvé oui/non, première trouvaille, nombre de fois.

Fermeture par bouton ou clic sur le backdrop.

### 3.6 « Force Update »

`#forceUpdateBtn` appelle `DailyToDexImport.forceUpdate()`.

Algorithme :

1. Charge les Pokémon.
2. Lit **tous** les Daily et Weekly de `PokefeetDB`.
3. Lit les entrées Dex existantes (Set d'Index).
4. Pour chaque Daily : reconstruit la liste déterministe de la date, parcourt les `results`, et pour chaque `win`, si l'Index n'est pas déjà dans le Dex, `addNewDexEntry(index, date)`.
5. Idem pour chaque Weekly (liste reconstruite depuis le lundi).
6. Affiche une popup avec la liste des nouveaux Pokémon, ou « Aucun nouveau Pokémon ».

**Limites** :

- Ne traite que les gagnants : correct.
- Ne met pas à jour `importedInDex` dans les historiques.
- Ne détecte pas les Index déjà présents mais `found: false`.
- Ne gère pas les imports dont les données ne correspondent pas à la liste déterministe (daily modifié, mauvaise date).
- Peut être long (698 Pokémon × historique).

---

## 4. Alimentation du Dex

| Source | Quand | Quels Pokémon |
|---|---|---|
| Daily | fin de partie | gagnants uniquement |
| Weekly | fin de partie | gagnants uniquement |
| Challenge bonus | fin de challenge | **toute la `FeetList`** |
| Import fichier | après merge d'une date non importée | **toute la liste reconstruite**, y compris les échecs (bug) |
| Import manuel Daily/Weekly | après parsing | toute la liste reconstruite (même bug potentiel) |
| Force Update | bouton | gagnants des historiques |

### 4.1 Bannière « nouveau Pokémon »

Dans Daily, `handleCorrect()` vérifie l'entrée Dex **avant** `markFound` et affiche une bannière `#newPokemonBanner` / `.new-pokemon-banner` pendant 3,4 s. L'alerte de fin liste les nouveaux.

---

## 5. Problèmes connus

| Problème | Détail | Impact |
|---|---|---|
| Import trop généreux | `js/data/data-manager.js` marque toute la liste d'un daily importé | Dex gonflé par des échecs |
| `count` non fiable | incrémenté à chaque `markFound` | statistique « fois rencontré » approximative |
| `importedInDex` inutilisé | écrit, rarement lu | imports rejoués |
| Pas de version | Dex global, pas de filtre par version | 698 entrées dès le départ |
| `addNewDexEntry` | ne vérifie que `found` | un Pokémon `found:false` avec `count>0` est écrasé |
| `getProgress` | compte les entrées, pas les Index uniques | OK car clé unique |
| Popup `innerHTML` | données JSON insérées sans échappement | risque si données non fiables |
| Force Update | boucle séquentielle | lenteur |

---

## 6. Checklist de test manuel

1. Premier chargement : 0 / 698, toutes les images en silhouette.
2. Daily réussi : Pokémon marqué, image couleur, compteur 1.
3. Daily échoué : Pokémon non marqué.
4. Re-trouver un Pokémon : compteur 2, `firstFoundDate` inchangé.
5. Recherche par nom FR, EN, index.
6. Filtres trouvés/non trouvés, exclusivité.
7. Tris index, nom, count, type, œuf, première trouvaille ; asc/desc.
8. Popup : images et métadonnées correctes, fermeture.
9. Force Update après plusieurs dailies : seuls les gagnants ajoutés, popup de résultat.
10. Challenge bonus : tous les Pokémon de la liste ajoutés.
11. Import fichier : vérifier le bug des échecs marqués.
12. Rechargement : collection persistée.
13. Deux onglets : pas de corruption (IndexedDB transactionnel).

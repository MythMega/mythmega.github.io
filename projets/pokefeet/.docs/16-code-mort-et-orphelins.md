# 16 — Code mort, orphelins et résidus de réorganisation

> **Méthode** : recherche d'usages sur tous les fichiers `.js` et `.html` (hors `docs/`), en excluant le fichier de définition. Une fonction est considérée comme morte si elle n'a **aucun appel externe** et n'est pas utilisée dynamiquement (`window[...]`, `onclick=` HTML, chaîne de caractères). Les pages sont dites orphelines si aucun `href`/`location.href` ne les cible.
>
> **Limite** : analyse statique. Les usages via chaînes, extensions de navigateur ou code externe ne sont pas détectés. Les éléments marqués « à confirmer » doivent être testés avant suppression.

---

## 1. Synthèse

| Catégorie | Volume | Effort de suppression | Risque |
|---|---|---|---|
| Pages orphelines | 4 | faible | faible |
| Fichiers JS entièrement morts | 1 (`profile.js`) | faible | faible |
| Fonctions/export morts | ~15 | faible | faible |
| Doublons de réorganisation | ~10 blocs | moyen | moyen |
| Assets non référencés | ~45 fichiers | faible | faible (vérifier variantes) |
| Données/outils non lus | 8 fichiers | faible | faible |
| Documentation obsolète | `docs/` (17 fichiers) | faible | aucun |

---

## 2. Pages orphelines

| Page | Liens entrants | Statut | Recommandation |
|---|---:|---|---|
| `profile.html` | 0 | redirection meta vers `data_management.html` | supprimer, le lien « Paramètres » existe déjà |
| `prediction.html` | 0 | outil admin protégé côté client | déplacer dans `tools/` ou supprimer du déploiement |
| `integration-pokefeet.html` | 0 | page statique isolée | supprimer ou documenter l'intention |
| `test-i18n.html` | 0 | page de test manuel | déplacer dans `tests/manual/` |

**Cas particuliers** :

- `data.html` n'a pas de `href` littéral, mais est lié par `footer.js` (`makeLink('data.html', ...)`) : **pas orphelin**.
- `old_daily.html` est lié depuis `index.html`.
- `custom.html` est lié depuis `index.html`.
- `changelog.html` et `credits.html` sont liés par le footer.

---

## 3. Fichiers JavaScript morts

### 3.1 `profile.js` — mort

Preuves :

- chargé uniquement par `stats.html` (`<script src="profile.js">`) ;
- `ProfileInit()` est enregistré sur `DOMContentLoaded` mais retourne immédiatement car `#pseudoInput` et `#savePseudoBtn` n'existent pas sur `stats.html` ;
- `COOKIE_NAME` n'est lu par aucun autre fichier ;
- les fonctions globales `setCookie`, `getCookie`, `eraseCookie` ne sont utilisées que dans ce fichier ;
- le profil est géré en inline dans `data_management.html` ;
- `stats.js` lit directement `pk_pseudo`.

**Recommandation** : supprimer le fichier et la balise `<script>` de `stats.html`. Le pseudo reste géré par la page Paramètres.

---

## 4. Exports et fonctions sans appel externe

### 4.1 Confirmés morts

| Symbole | Fichier | Preuve | Recommandation |
|---|---|---|---|
| `TypeIcons.getUrl` | `pokemon.js` | 0 appel ; seul `TypeIcons.load()` est utilisé | supprimer, ou utiliser réellement pour afficher les icônes |
| `Cosmetics.renderCosmeticsUI` | `cosmetics.js` | fonction définie mais **absente de l'objet retourné** ; aucun appel | supprimer (l'UI inline de `data_management.html` la remplace) |
| `Cosmetics.getByType` | `cosmetics.js` | 0 appel externe | supprimer |
| `Cosmetics.getUnlockedIds` | `cosmetics.js` | 0 appel externe | supprimer |
| `ChallengeStorage.getChallengeCompletion` | `business/challenge-storage.js` | 0 appel | supprimer |
| `ChallengeManager.loadState` | `business/challenge-manager.js` | fonction interne, non exportée ; appelée uniquement dans `loadChallenges` | garder comme fonction privée, ne pas exposer |
| `ChallengeManager.isGameActive` | idem | 0 appel | supprimer de l'export |
| `ChallengeManager.reset` | idem | 0 appel | supprimer de l'export |
| `ChallengeManager.computeTotalXP` | idem | exporté mais appelé uniquement en interne par `getPlayerLevel` | rendre privé |
| `Dex.updateDexEntry` | `Dex.js` | 0 appel externe ; utilisé en interne | rendre privé |
| `game.js` `gameActive` | `game.js` | variable assignée 4 fois, jamais lue | supprimer |
| `daily.js` `cookieName` | `daily.js` | constante jamais utilisée | supprimer |
| `weekly.js` `cookieName` | `weekly.js` | constante jamais utilisée | supprimer |
| `daily.js` `resultToEmojiLine` | `daily.js` | 1 occurrence (définition) | supprimer |
| `daily.js` `showAttemptGauge` | `daily.js` | définie, jamais appelée | supprimer |
| `weekly.js` `showAttemptGauge` | `weekly.js` | définie, jamais appelée | supprimer |
| `daily.js` / `weekly.js` `populateNamesList` | les deux | fonction no-op appelée | supprimer l'appel et la fonction |
| `data.js` `COOKIE_DAILY` | `data.js` | constante jamais utilisée | supprimer |
| `profile.js` `COOKIE_NAME`, `ProfileInit`, helpers | `profile.js` | fichier mort | supprimer le fichier |
| `history_curve.js` rendu de `#historyList` | `history_curve.js` | doublon avec `history.js` ; les deux écrivent dans le même conteneur, ordre non déterministe | supprimer le rendu de liste, garder le graphique |

### 4.2 À confirmer avant suppression

| Symbole | Fichier | Doute |
|---|---|---|
| `ChallengeManager.getPlayerLevel` | `challenge-manager.js` | utilisé par `Challenge.checkRequirement` via le global ; garder |
| `ChallengeManager.loadChallenges` | idem | appelé par `challenge.html` et en interne ; garder |
| `CustomChallengeGame.getAllPokemons` | `custom-challenge-game.js` | exporté, aucun appel détecté ; à confirmer |
| `CustomChallengeGame.reset` | idem | aucun appel détecté ; à confirmer |
| `CustomChallengeGame.isFinished` | idem | aucun appel détecté ; à confirmer |
| `OldDaily` | `old_daily.js` | global non utilisé ailleurs, mais auto-init : le module est actif |
| `ChallengeStorage.putCompletion` | `challenge-storage.js` | utilisé par `data.js` ; garder |
| `ChallengeStorage.isChallengeCompleted` | idem | utilisé par `challenge.html` ; garder |
| `Cosmetics.apply` | `cosmetics.js` | appelé en interne par `load`/`select` ; export externe inutile |

---

## 5. Doublons issus de la réorganisation

La tentative de réorganisation a créé `entity/`, `business/`, `ui/` pour les challenges et les custom challenges, mais **n'a pas migré les domaines historiques**. Il en résulte des doublons structurels.

### 5.1 Persistance IndexedDB

`indexedDB.open` apparaît dans **13 fichiers** :

```
business/challenge-manager.js
business/challenge-storage.js
daily.js
DailyToDexImport.js
data.js
Dex.js
entity/challenge.js
history.js
history_curve.js
migration.js
old_daily.js
stats.js
weekly.js
```

Chaque fichier réimplémente :

- l'ouverture avec timeout ;
- la gestion `onblocked`/`versionchange` ;
- la création des stores ;
- les transactions `getAll`/`get`/`put`/`clear`.

`entity/challenge.js` ouvre même la base pour vérifier un trophée.

### 5.2 Cookies

`getCookie` est défini dans **13 fichiers** :

```
business/challenge-manager.js
cosmetics.js
credits.js
daily.js
data.js
data_management.html
game.js
migration.js
profile.js
stats.js
translate.js
ui/custom_challenges/custom-create-ui.js
ui/custom_challenges/custom-play-ui.js
```

### 5.3 PRNG et shuffle

`mulberry32` est réimplémenté dans **6 fichiers** :

```
business/challenge-manager.js
daily.js
DailyToDexImport.js
game.js
prediction.html
weekly.js
```

Le shuffle seedé est dupliqué dans `game.js`, `daily.js`, `weekly.js`, `DailyToDexImport.js`, `challenge-manager.js`, `prediction.html`.

### 5.4 Normalisation des noms

`normalizeStr` / `normalize` est défini dans **7 fichiers** :

```
daily.js
game.js
prediction.html
ui/challenge-game-ui.js
ui/custom_challenges/custom-create-ui.js
ui/custom_challenges/custom-play-ui.js
weekly.js
```

### 5.5 Notifications

`showNotification` est défini dans **7 fichiers** :

```
daily.js
migration.js
ui/challenge-game-ui.js
ui/custom_challenges/custom-create-ui.js
ui/custom_challenges/custom-play-ui.js
ui.js
weekly.js
```

### 5.6 Calcul d'XP

`stats.js` et `ChallengeManager.computeTotalXP()` implémentent le même barème. Le commentaire du second est explicite :

```js
// ── Calculer l'XP totale (IDENTIQUE à stats.js) ────────
```

### 5.7 Historiques

`loadDailyHistory` / `loadWeeklyHistory` sont réimplémentés dans :

- `stats.js`
- `history.js`
- `history_curve.js`
- `data.js`
- `challenge.js`
- `challenge-manager.js`
- `DailyToDexImport.js`

### 5.8 Score et partage

- `pointsForAttempt` dupliqué dans `game.js`, `daily.js`, `weekly.js`, `data.js` (constantes `basePoints`/`hintPenalty`).
- `buildShareText` / `buildShareTextMini` dupliqués dans `daily.js`, `weekly.js`, `custom-play-ui.js`.
- `buildWrongGuessesText` dupliqué dans `daily.js`, `weekly.js`.

### 5.9 UI dupliquée

- Profil : `profile.js` (mort) + inline `data_management.html`.
- Cosmétiques : `Cosmetics.renderCosmeticsUI` (mort) + inline `data_management.html`.
- Autocomplete : `game.js` + `daily.js` + `weekly.js`.
- Jauges : `ui.js` + `daily.js` + `weekly.js`.

### 5.10 Pages de jeu

`daily.js` et `weekly.js` sont des clones à ~80 %. Toute correction doit être appliquée deux fois.

---

## 6. Assets non référencés

### 6.1 Sprites alternatifs

Le JSON ne référence que les variantes `-a.png` pour les formes de base. Les variantes `-b`/`-c` ne sont jamais utilisées :

- `img/1-151/` : 28 fichiers (`001-b`, `001-c`, `002-b`, … `141-b`) ;
- `img/152-250/` : 4 fichiers (`161-b`, `203-b`, `207-b`, `244-b`) ;
- `img/251-386/` : 2 fichiers (`263b-a`, `264b-a`).

**À confirmer** : ces sprites peuvent être une réserve éditoriale volontaire. Les déplacer dans `img/_unused/` plutôt que supprimer.

### 6.2 Trophées et badges

- `img/trophy/fourfeets/` : 4 fichiers (`bronze`, `silver`, `gold`, `platinum`) — aucun trophée `fourfeets` dans `trophies.json` ;
- `img/trophy/type/enthusiast/_empty.png`, `expert/_empty.png`, `fan/_empty.png` — modèles vides ;
- `img/trophy/type/pattern.xcf` — source graphique ;
- `img/badges/gift_empty.png` — non référencé ;
- `img/badges/giftmaker.xcf` — source graphique.

### 6.3 Divers

- `cover.png` — aucun `href`/`src`/CSS ne le référence ;
- `favicon.ico` — les pages utilisent `icon.png` ; `favicon.ico` n'est pas lié ;
- `img/autoname.py`, `img/fullsprite/download_full_image.py` — scripts ;
- `img/trophy/type/*.xcf` — sources.

> Les fichiers `img/cosmetics/*` ne sont **pas** listés comme morts : ils sont référencés indirectement par le champ `File` de `cosmetics.json`. Même chose pour les trophées référencés par `trophies.json`.

---

## 7. Données et documentation non exploitées

| Élément | Statut | Recommandation |
|---|---|---|
| `data/backup.json` | non lu | archiver/supprimer |
| `data/new_backup.json` | non lu | archiver/supprimer |
| `data/result_analyse_challenge.log` | non lu | supprimer |
| `data/pokefeet_commits.csv` | non lu | déplacer dans `tools/` |
| `data/analyse_challenges.py` | non exécuté au runtime | déplacer dans `tools/data-pipeline/` |
| `data/egggroup-category.py` | idem | idem |
| `data/newpic.py` | idem | idem |
| `data/setversion.py` | idem | idem |
| `scripts/add_egg_category.py` | idem | idem |
| `scripts/add_fullimage.py` | idem | idem |
| `scripts/fetch_egg_category.py` | idem | idem |
| `trophies.md` | doc ancienne | remplacer par `.docs/11` |
| `README_I18N.md` | doc ancienne | remplacer par `.docs/14` |
| `I18N_DOCUMENTATION.md` | doc ancienne | remplacer par `.docs/14` |
| `docs/` (17 fichiers) | doc antérieure partielle | archiver dans `docs/_archive/` |

---

## 8. Résidus de la réorganisation

| Indice | Détail |
|---|---|
| `entity/` ne contient que 4 fichiers | `Challenge`, `Reward`, `RewardItem`, `RewardButton` ; aucune entité `Pokemon`, `DexEntry`, `DailyResult` |
| `business/` ne contient que 3 domaines | challenges bonus, custom challenges, storage challenges ; aucun service daily/weekly/marathon |
| `ui/` ne contient que challenges/custom | aucun composant partagé ; `ui.js` est resté à la racine |
| les challenges custom ont un dossier dédié | `business/custom_challenges/` et `ui/custom_challenges/`, alors que `daily`/`weekly` n'ont rien |
| `stats.js` charge `profile.js` | reliquat d'une ancienne page profil |
| `cosmetics.js` contient une UI morte | reliquat d'une ancienne page paramètres |
| `data.html` vise `pokemons_wip.json` | reliquat d'un flux de travail WIP |
| `history_curve.js` rend une liste écrasée | reliquat d'une ancienne page historique |
| `prediction.html` duplique les algorithmes | outil interne jamais migré |
| `docs/` et `.docs/` | deux documentations coexistent |

---

## 9. Ordre de nettoyage recommandé

1. **Sans risque** : supprimer `profile.js` + sa balise ; supprimer les exports morts ; supprimer `cookieName`, `resultToEmojiLine`, `showAttemptGauge`, `populateNamesList`, `gameActive`, `COOKIE_DAILY`.
2. **Sans risque après vérification** : supprimer les pages orphelines ou les déplacer dans `tools/` ; supprimer `data/backup*.json` et les logs.
3. **Moyen** : supprimer le rendu de liste de `history_curve.js` ; supprimer `Cosmetics.renderCosmeticsUI` ; déplacer les sprites alternatifs dans `img/_unused/`.
4. **Après tests** : fusionner Daily/Weekly, unifier la persistance, unifier l'XP.
5. **En dernier** : supprimer `docs/` après archivage, une fois `.docs/` validé.

Chaque suppression doit être un commit séparé, avec une vérification manuelle des pages concernées (voir doc 19).

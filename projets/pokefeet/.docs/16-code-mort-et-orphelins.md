# 16 — Code mort, orphelins et résidus de réorganisation

> **Méthode** : recherche d'usages sur tous les fichiers `.js` et `.html` (hors `docs/`), en excluant le fichier de définition. Une fonction est considérée comme morte si elle n'a **aucun appel externe** et n'est pas utilisée dynamiquement (`window[...]`, `onclick=` HTML, chaîne de caractères). Les pages sont dites orphelines si aucun `href`/`location.href` ne les cible.
>
> **Limite** : analyse statique. Les usages via chaînes, extensions de navigateur ou code externe ne sont pas détectés. Les éléments marqués « à confirmer » doivent être testés avant suppression.

---

## 1. Synthèse

| Catégorie | Volume | Effort de suppression | Risque |
|---|---|---|---|
| Pages orphelines | 4 | faible | faible |
| Fichiers JS entièrement morts | 1 (`js/features/settings/profile.js`) | faible | faible |
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

- `data.html` n'a pas de `href` littéral, mais est lié par `js/ui/footer.js` (`makeLink('data.html', ...)`) : **pas orphelin**.
- `old_daily.html` est lié depuis `index.html`.
- `custom.html` est lié depuis `index.html`.
- `changelog.html` et `credits.html` sont liés par le footer.

---

## 3. Fichiers JavaScript morts

### 3.1 `js/features/settings/profile.js` — mort

Preuves :

- chargé uniquement par `stats.html` (`<script src="js/features/settings/profile.js">`) ;
- `ProfileInit()` est enregistré sur `DOMContentLoaded` mais retourne immédiatement car `#pseudoInput` et `#savePseudoBtn` n'existent pas sur `stats.html` ;
- `COOKIE_NAME` n'est lu par aucun autre fichier ;
- les fonctions globales `setCookie`, `getCookie`, `eraseCookie` ne sont utilisées que dans ce fichier ;
- le profil est géré en inline dans `data_management.html` ;
- `js/features/stats/stats.js` lit directement `pk_pseudo`.

**Recommandation** : supprimer le fichier et la balise `<script>` de `stats.html`. Le pseudo reste géré par la page Paramètres.

---

## 4. Exports et fonctions sans appel externe

### 4.1 Confirmés morts

| Symbole | Fichier | Preuve | Recommandation |
|---|---|---|---|
| `TypeIcons.getUrl` | `js/core/pokemon.js` | 0 appel ; seul `TypeIcons.load()` est utilisé | supprimer, ou utiliser réellement pour afficher les icônes |
| `Cosmetics.renderCosmeticsUI` | `js/features/settings/cosmetics.js` | fonction définie mais **absente de l'objet retourné** ; aucun appel | supprimer (l'UI inline de `data_management.html` la remplace) |
| `Cosmetics.getByType` | `js/features/settings/cosmetics.js` | 0 appel externe | supprimer |
| `Cosmetics.getUnlockedIds` | `js/features/settings/cosmetics.js` | 0 appel externe | supprimer |
| `ChallengeStorage.getChallengeCompletion` | `js/data/challenge-storage.js` | 0 appel | supprimer |
| `ChallengeManager.loadState` | `js/features/challenges/challenge-manager.js` | fonction interne, non exportée ; appelée uniquement dans `loadChallenges` | garder comme fonction privée, ne pas exposer |
| `ChallengeManager.isGameActive` | idem | 0 appel | supprimer de l'export |
| `ChallengeManager.reset` | idem | 0 appel | supprimer de l'export |
| `ChallengeManager.computeTotalXP` | idem | exporté mais appelé uniquement en interne par `getPlayerLevel` | rendre privé |
| `Dex.updateDexEntry` | `js/data/dex.js` | 0 appel externe ; utilisé en interne | rendre privé |
| `js/features/marathon/game.js` `gameActive` | `js/features/marathon/game.js` | variable assignée 4 fois, jamais lue | supprimer |
| `js/features/daily/daily.js` `cookieName` | `js/features/daily/daily.js` | constante jamais utilisée | supprimer |
| `js/features/weekly/weekly.js` `cookieName` | `js/features/weekly/weekly.js` | constante jamais utilisée | supprimer |
| `js/features/daily/daily.js` `resultToEmojiLine` | `js/features/daily/daily.js` | 1 occurrence (définition) | supprimer |
| `js/features/daily/daily.js` `showAttemptGauge` | `js/features/daily/daily.js` | définie, jamais appelée | supprimer |
| `js/features/weekly/weekly.js` `showAttemptGauge` | `js/features/weekly/weekly.js` | définie, jamais appelée | supprimer |
| `js/features/daily/daily.js` / `js/features/weekly/weekly.js` `populateNamesList` | les deux | fonction no-op appelée | supprimer l'appel et la fonction |
| `js/data/data-manager.js` `COOKIE_DAILY` | `js/data/data-manager.js` | constante jamais utilisée | supprimer |
| `js/features/settings/profile.js` `COOKIE_NAME`, `ProfileInit`, helpers | `js/features/settings/profile.js` | fichier mort | supprimer le fichier |
| `js/features/history/history-curve.js` rendu de `#historyList` | `js/features/history/history-curve.js` | doublon avec `js/features/history/history.js` ; les deux écrivent dans le même conteneur, ordre non déterministe | supprimer le rendu de liste, garder le graphique |

### 4.2 À confirmer avant suppression

| Symbole | Fichier | Doute |
|---|---|---|
| `ChallengeManager.getPlayerLevel` | `challenge-manager.js` | utilisé par `Challenge.checkRequirement` via le global ; garder |
| `ChallengeManager.loadChallenges` | idem | appelé par `challenge.html` et en interne ; garder |
| `CustomChallengeGame.getAllPokemons` | `custom-challenge-game.js` | exporté, aucun appel détecté ; à confirmer |
| `CustomChallengeGame.reset` | idem | aucun appel détecté ; à confirmer |
| `CustomChallengeGame.isFinished` | idem | aucun appel détecté ; à confirmer |
| `OldDaily` | `js/features/history/old-daily.js` | global non utilisé ailleurs, mais auto-init : le module est actif |
| `ChallengeStorage.putCompletion` | `challenge-storage.js` | utilisé par `js/data/data-manager.js` ; garder |
| `ChallengeStorage.isChallengeCompleted` | idem | utilisé par `challenge.html` ; garder |
| `Cosmetics.apply` | `js/features/settings/cosmetics.js` | appelé en interne par `load`/`select` ; export externe inutile |

---

## 5. Doublons internes restants

Le déplacement physique est terminé : tout est dans `js/core`, `js/data`, `js/features`, `js/i18n`, `js/ui`. En revanche, les responsabilités restent mélangées **à l'intérieur** des fichiers : chaque module ouvre encore IndexedDB, calcule son XP ou duplique le PRNG.

### 5.1 Persistance IndexedDB

`indexedDB.open` apparaît dans **13 fichiers** :

```
js/features/challenges/challenge-manager.js
js/data/challenge-storage.js
js/features/daily/daily.js
js/data/daily-to-dex-import.js
js/data/data-manager.js
js/data/dex.js
js/core/challenge.js
js/features/history/history.js
js/features/history/history-curve.js
js/data/migration.js
js/features/history/old-daily.js
js/features/stats/stats.js
js/features/weekly/weekly.js
```

Chaque fichier réimplémente :

- l'ouverture avec timeout ;
- la gestion `onblocked`/`versionchange` ;
- la création des stores ;
- les transactions `getAll`/`get`/`put`/`clear`.

`js/core/challenge.js` ouvre même la base pour vérifier un trophée.

### 5.2 Cookies

`getCookie` est défini dans **13 fichiers** :

```
js/features/challenges/challenge-manager.js
js/features/settings/cosmetics.js
js/features/credits/credits.js
js/features/daily/daily.js
js/data/data-manager.js
data_management.html
js/features/marathon/game.js
js/data/migration.js
js/features/settings/profile.js
js/features/stats/stats.js
js/i18n/translate.js
js/features/custom-challenges/create-ui.js
js/features/custom-challenges/play-ui.js
```

### 5.3 PRNG et shuffle

`mulberry32` est réimplémenté dans **6 fichiers** :

```
js/features/challenges/challenge-manager.js
js/features/daily/daily.js
js/data/daily-to-dex-import.js
js/features/marathon/game.js
prediction.html
js/features/weekly/weekly.js
```

Le shuffle seedé est dupliqué dans `js/features/marathon/game.js`, `js/features/daily/daily.js`, `js/features/weekly/weekly.js`, `js/data/daily-to-dex-import.js`, `challenge-manager.js`, `prediction.html`.

### 5.4 Normalisation des noms

`normalizeStr` / `normalize` est défini dans **7 fichiers** :

```
js/features/daily/daily.js
js/features/marathon/game.js
prediction.html
js/features/challenges/challenge-game-ui.js
js/features/custom-challenges/create-ui.js
js/features/custom-challenges/play-ui.js
js/features/weekly/weekly.js
```

### 5.5 Notifications

`showNotification` est défini dans **7 fichiers** :

```
js/features/daily/daily.js
js/data/migration.js
js/features/challenges/challenge-game-ui.js
js/features/custom-challenges/create-ui.js
js/features/custom-challenges/play-ui.js
js/features/marathon/ui.js
js/features/weekly/weekly.js
```

### 5.6 Calcul d'XP

`js/features/stats/stats.js` et `ChallengeManager.computeTotalXP()` implémentent le même barème. Le commentaire du second est explicite :

```js
// ── Calculer l'XP totale (IDENTIQUE à js/features/stats/stats.js) ────────
```

### 5.7 Historiques

`loadDailyHistory` / `loadWeeklyHistory` sont réimplémentés dans :

- `js/features/stats/stats.js`
- `js/features/history/history.js`
- `js/features/history/history-curve.js`
- `js/data/data-manager.js`
- `challenge.js`
- `challenge-manager.js`
- `js/data/daily-to-dex-import.js`

### 5.8 Score et partage

- `pointsForAttempt` dupliqué dans `js/features/marathon/game.js`, `js/features/daily/daily.js`, `js/features/weekly/weekly.js`, `js/data/data-manager.js` (constantes `basePoints`/`hintPenalty`).
- `buildShareText` / `buildShareTextMini` dupliqués dans `js/features/daily/daily.js`, `js/features/weekly/weekly.js`, `custom-play-ui.js`.
- `buildWrongGuessesText` dupliqué dans `js/features/daily/daily.js`, `js/features/weekly/weekly.js`.

### 5.9 UI dupliquée

- Profil : `js/features/settings/profile.js` (mort) + inline `data_management.html`.
- Cosmétiques : `Cosmetics.renderCosmeticsUI` (mort) + inline `data_management.html`.
- Autocomplete : `js/features/marathon/game.js` + `js/features/daily/daily.js` + `js/features/weekly/weekly.js`.
- Jauges : `js/features/marathon/ui.js` + `js/features/daily/daily.js` + `js/features/weekly/weekly.js`.

### 5.10 Pages de jeu

`js/features/daily/daily.js` et `js/features/weekly/weekly.js` sont des clones à ~80 %. Toute correction doit être appliquée deux fois.

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

> Les fichiers `img/cosmetics/*` ne sont **pas** listés comme morts : ils sont référencés indirectement par le champ `File` de `js/features/settings/cosmetics.json`. Même chose pour les trophées référencés par `trophies.json`.

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

## 8. Dette structurelle restante

| Indice | Détail |
|---|---|
| `js/core/` ne contient que 6 fichiers | `Pokemon`, `PokemonVersions`, `Challenge`, `Reward`, `RewardItem`, `RewardButton` ; aucune entité `DexEntry`, `DailyResult`, `WeeklyResult` |
| `js/data/` mélange stockage et migration | `migration`, `data-manager`, `dex`, `challenge-storage`, import Dex |
| `js/features/` est organisé par domaine | daily, weekly, marathon, challenges, custom-challenges, dex, history, stats, settings, credits |
| `js/features/marathon/ui.js` est un composant de vue | il pourrait rejoindre `js/ui/` si un composant de manche partagé émerge |
| les gros modules restent monolithiques | `daily` (1 174 lignes), `weekly` (1 033), `data-manager` (934), `stats` (917) |
| les styles sont éclatés mais certains blocs sont dupliqués | `game-controls.css` et `history-details.css` redéfinissent la jauge et le responsive |
| `js/features/stats/stats.js` charge `js/features/settings/profile.js` | reliquat d'une ancienne page profil |
| `js/features/settings/cosmetics.js` contient une UI morte | reliquat d'une ancienne page paramètres |
| `data.html` vise `pokemons_wip.json` | reliquat d'un flux de travail WIP |
| `js/features/history/history-curve.js` rend une liste écrasée | reliquat d'une ancienne page historique |
| `prediction.html` duplique les algorithmes | outil interne jamais migré |
| `docs/` et `.docs/` | deux documentations coexistent |

---

## 9. Ordre de nettoyage recommandé

1. **Sans risque** : supprimer `js/features/settings/profile.js` + sa balise ; supprimer les exports morts ; supprimer `cookieName`, `resultToEmojiLine`, `showAttemptGauge`, `populateNamesList`, `gameActive`, `COOKIE_DAILY`.
2. **Sans risque après vérification** : supprimer les pages orphelines ou les déplacer dans `tools/` ; supprimer `data/backup*.json` et les logs.
3. **Moyen** : supprimer le rendu de liste de `js/features/history/history-curve.js` ; supprimer `Cosmetics.renderCosmeticsUI` ; déplacer les sprites alternatifs dans `img/_unused/`.
4. **Après tests** : fusionner Daily/Weekly, unifier la persistance, unifier l'XP.
5. **En dernier** : supprimer `docs/` après archivage, une fois `.docs/` validé.

Chaque suppression doit être un commit séparé, avec une vérification manuelle des pages concernées (voir doc 19).

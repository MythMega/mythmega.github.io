# 17 — Dette technique et risques

## 1. Matrice de criticité

| Sévérité | Définition |
|---|---|
| **P0** | Peut corrompre ou perdre des données, ou bloquer un parcours principal |
| **P1** | Bug fonctionnel visible, incohérence de calcul, contournement de sécurité |
| **P2** | Maintenabilité, performance, accessibilité, dette structurelle |
| **P3** | Cosmétique, documentation, nettoyage |

---

## 2. Risques P0 — données

### 2.1 Écriture `clear + putAll` sur les historiques

**Fichiers** : `js/features/daily/daily.js` (`saveDailyToDB`), `js/features/weekly/weekly.js` (`saveWeeklyToDB`), `js/data/data-manager.js`.

```js
store.clear();
for (const date in history) store.put({ date, importedInDex: false, ...history[date] });
```

- Deux onglets qui terminent un Daily/Weekly en même temps peuvent perdre les données de l'autre.
- Une réécriture remet `importedInDex` à `false` pour toutes les dates.
- Le pattern est répété dans trois modules.

**Recommandation** : `put` unitaire de l'entrée modifiée, ou transaction différentielle ; verrou d'écriture (`navigator.locks`/`BroadcastChannel`).

### 2.2 Import qui gonfle le Dex

`js/data/data-manager.js` `mergePayloadIntoCookies()` :

```js
const pokemons = await DailyToDexImport.reconstructDailyList(date);
for (const p of pokemons) await Dex.markFound(p.Index);
```

Toute la liste est marquée, y compris les Pokémon échoués. Idem pour l'import manuel.

**Recommandation** : ne marquer que les `results[i].outcome === 'win'`.

### 2.3 Migration incomplète des cookies

`js/data/migration.js` sauvegarde `pk_daily_result_v2` mais ne le convertit pas en IndexedDB. Les anciennes sauvegardes cookie ne sont plus lues par le jeu. Le commentaire « Data is still safe in cookies » est trompeur.

**Recommandation** : migration one-shot cookie → store, avec flag `legacyMigrated`, ou suppression explicite documentée.

### 2.4 Conflits Weekly silencieux

`mergePayloadIntoCookies` ajoute les dates Weekly absentes mais **ignore** les conflits, contrairement au Daily. L'utilisateur n'est pas averti.

### 2.5 Hash non cryptographique

Le fichier de sauvegarde est protégé par FNV-1a 32 bits. Facile à recalculer, aucune confidentialité. Ce n'est pas un mécanisme de sécurité.

### 2.6 Pas de validation de schéma

Un fichier d'import avec des champs manquants ou du mauvais type peut produire des états incohérents (scores `undefined`, dates invalides, tableaux absents). Aucun `try/catch` ne valide la forme au-delà du JSON.

---

## 3. Risques P1 — fonctionnel

### 3.1 Double calcul d'XP

`js/features/stats/stats.js` et `ChallengeManager.computeTotalXP()` implémentent le même barème. Toute modification de l'un désynchronise les prérequis de challenges et le niveau affiché.

### 3.2 Prérequis `trophy` partiel

`checkTrophyEarned()` ne gère que `Dex_Count`, `Daily_Count`, `Weekly_Count`, `Marathon_Streak`. Un challenge avec un prérequis `Type_Registered` ou `Full_Generation_Register` est **toujours verrouillé**. Aucun challenge actuel n'utilise `trophy`, mais le support est incomplet.

### 3.3 Dates de disponibilité invalides

Certaines entrées contiennent `2027-06-31` (date inexistante). La comparaison lexicographique évite un crash, mais la plage ne correspond à aucun jour réel. Aucune validation à l'import du JSON.

### 3.4 Mot de passe maître

Hash SHA-256 identique dans `js/features/marathon/game.js`, `js/features/daily/daily.js`, `js/features/weekly/weekly.js`, `prediction.html`. Permet de valider n'importe quel Pokémon. Côté client, donc contournable et visible. À remplacer par un mode debug explicite ou supprimer.

### 3.5 `prediction.html` non sécurisée

La page est « protégée » par le même hash côté client. Le code source contient l'algorithme et les données ; le mot de passe n'apporte aucune confidentialité.

### 3.6 Écrasement des complétions

`markChallengeCompleted` fait un `put` sur `challengeId` : rejouer un challenge écrase `completedAt` et `fails`. Pas d'historique de performance.

### 3.7 `importedInDex` incohérent

Écrit par les writers, remis à `false` par les réécritures, rarement lu. L'icône ✓ de l'historique peut être fausse.

### 3.8 Reprise Marathon silencieuse

Les Index absents du JSON sont filtrés ; la session peut sauter des Pokémon sans avertir.

### 3.9 Perte d'état au changement de langue

`js/i18n/language-switcher.js` fait `window.location.reload()` : un Daily/Weekly en cours est perdu (pas de sauvegarde partielle).

### 3.10 Jauges et indices

`showAttemptGauge` mort, `populateNamesList` no-op, `resultToEmojiLine` mort : signes de refactors inachevés. Risque de confusion pour les futurs contributeurs.

---

## 4. Risques P2 — architecture et maintenabilité

### 4.1 Absence de modules

- 35 scripts globaux, ordre de chargement implicite.
- Collisions de noms (`setCookie`, `getCookie`, `PASSWORD_HASH`).
- Pas de tree-shaking, pas de bundler, pas de cache busting.
- Impossible de tester unitairement sans charger tout le contexte.

### 4.2 Duplication

| Élément | Occurrences |
|---|---:|
| `indexedDB.open` | 13 fichiers |
| `getCookie` | 13 fichiers |
| `showNotification` | 7 fichiers |
| `normalizeStr` | 7 fichiers |
| `mulberry32` | 6 fichiers |
| calcul d'XP | 2 fichiers |
| chargement d'historique | 7 fichiers |
| barème de points | 4 fichiers |

### 4.3 Monolithes

`js/features/daily/daily.js` (1 174 lignes), `js/features/weekly/weekly.js` (1 033), `js/data/data-manager.js` (934), `js/features/stats/stats.js` (917) mélangent :

- constantes métier ;
- accès IndexedDB ;
- calculs ;
- rendu DOM ;
- gestion des événements ;
- textes.

### 4.4 Couplage entité → métier

`js/core/challenge.js` appelle `ChallengeManager.getPlayerLevel()` et `Dex.getProgress()`. Une entité ne devrait pas dépendre d'un service global.

### 4.5 UI dans les entités

`Reward.renderCard()` et `Reward.renderPopupContent()` construisent du DOM dans `js/core/reward.js`. Le modèle et la vue sont confondus.

### 4.6 Pages HTML avec logique inline

`data.html` (~250 lignes), `prediction.html` (~350), `data_management.html` (~200), `index.html` (bandeau). Difficile à tester et à réutiliser.

### 4.7 Double documentation

`docs/` (17 fichiers) et `.docs/` (20 fichiers). Risque de divergence. `docs/16-CODE-REVIEW.md` contient déjà des constats, mais non alignés avec l'état actuel.

### 4.8 Absence de tests

0 test détecté, pas de `package.json`, pas de CI. Toute régression est découverte en production.

---

## 5. Risques P2 — performance

| Point | Coût | Contexte |
|---|---|---|
| `getPlayerLevel()` | recharge 3 bases + 4 JSON | chaque prérequis de challenge |
| `checkTrophies()` | 54 trophées × 698 Pokémon | chargement de `stats.html` |
| `renderDetailedStats` | parcourt tout l'historique | à chaque onglet |
| `clear + putAll` | réécrit tout l'historique | chaque fin de Daily/Weekly |
| `forceUpdate` | séquentiel, toutes les entrées | bouton Dex |
| Images | 1 396 sprites, pas de lazy loading global | première visite |
| `prediction.html` | 3 650 jours × 5 + 522 semaines × 10 | chargement de la page admin |
| `history_curve` + `history` | double lecture et double rendu | `history.html` |

Aucune mesure de performance n'a été faite : les coûts sont déduits de la lecture du code.

---

## 6. Risques P2 — compatibilité et robustesse

| Risque | Détail |
|---|---|
| `CompressionStream` | absent sur certains navigateurs ; codes custom compressés illisibles |
| `crypto.subtle` | nécessite un contexte sécurisé (HTTPS/localhost) ; le mot de passe maître échoue en `file://` |
| IndexedDB | `onblocked` si plusieurs onglets ; timeouts variables (5 s / 8 s) |
| `localStorage` | indisponible en navigation privée stricte ; erreurs avalées |
| Cookies | taille limitée ; `pk_daily_result_v2` pouvait être volumineux |
| Bootstrap CDN | dépendance réseau sur `stats.html` et `history.html` |
| Google Sheets | bandeau d'accueil dépendant d'un document externe |
| Images distantes | crédits (Twitch), fallback Marathon (PokeAPI) |
| `beforeunload` | comportement variable selon les navigateurs |

---

## 7. Risques P2 — accessibilité et i18n

- Popups sans `role="dialog"`, sans focus trap, fermeture uniquement souris/touche.
- `div` cliquables pour l'autocomplete et les cosmétiques, sans `tabindex` ni rôle.
- Focus visible non systématique.
- Textes codés en dur : `Niveau`, mode rapide, profil inline, `data.html`.
- Changement de langue par rechargement complet.
- Pas de pluriels, pas d'interpolation native.
- Certaines images ont `alt=""` (data viewer) ou un alt générique.

---

## 8. Risques P3 — produit et contenu

- Le nom « Marathon » n'est pas cohérent avec « Practice » dans le code.
- Le score Marathon n'est pas historisé : pas de statistiques de progression.
- Les cosmétiques ne sont pas exportés.
- Aucun bouton de réinitialisation globale.
- Les crédits et le changelog sont statiques.
- Les dates de disponibilité des challenges sont écrites à la main, avec des erreurs.
- `data/pokemons.json` contient des caractères non UTF-8 correctement décodés dans certains éditeurs (`V�g�tal`), mais le JSON est valide en UTF-8 ; à vérifier lors d'un futur pipeline.

---

## 9. Causes racines

1. **Croissance par ajout** : chaque mode a été copié/collé avant d'être spécialisé.
2. **Réorganisation physique sans découpage interne** : les fichiers sont rangés par domaine, mais les responsabilités métier/UI/persistance restent dans les mêmes modules.
3. **Absence de contrat de stockage** : chaque module ouvre IndexedDB lui-même.
4. **Absence de tests** : les duplications ne sont pas détectées.
5. **Pas de build** : impossible d'utiliser des modules, un linter ou un typechecker.
6. **Livraison statique** : les scripts doivent rester compatibles avec un simple serveur de fichiers.

---

## 10. Priorisation recommandée

| Priorité | Action | Justification |
|---|---|---|
| 1 | Corriger l'import Dex (gagnants uniquement) | corruption de collection |
| 2 | Remplacer `clear + putAll` | perte de données multi-onglets |
| 3 | Unifier l'XP | incohérence niveau/prérequis |
| 4 | Corriger/masquer les prérequis `trophy` non supportés | challenges bloqués |
| 5 | Migrer ou supprimer les cookies legacy | données invisibles |
| 6 | Supprimer le code mort | réduire la surface avant refactor |
| 7 | Extraire stockage/cookies/PRNG/scoring | base de la restructuration |
| 8 | Ajouter des tests sur les formats | filet de sécurité |
| 9 | Découper Daily/Weekly | maintenabilité |
| 10 | Traiter i18n/a11y | qualité produit |

Voir [18-plan-de-restructuration.md](./18-plan-de-restructuration.md) pour l'exécution.

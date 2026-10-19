# 04 — Persistance, migration et sauvegarde

## 1. Vue d'ensemble

| Support | Usage | Volatilité |
|---|---|---|
| **IndexedDB** | historiques Daily/Weekly, Dex, complétions de challenges | persistante, par origine |
| **Cookies** | préférences (langue, pseudo, cosmétiques, mode rapide), meilleurs scores Marathon | ~365 jours, effacés avec les cookies |
| **localStorage** | reprise de session Marathon | persistante, effacée manuellement |
| **sessionStorage** | état d'un challenge bonus en cours, catégorie de cosmétiques | onglet |
| **Fichier `.txt`** | export/import complet | manuel |

Aucune donnée n'est envoyée à un serveur. Le changement d'origine (domaine, port, protocole) ou le nettoyage du navigateur fait perdre l'ensemble.

---

## 2. IndexedDB

### 2.1 `PokefeetDB` — version 4

| Store | Clé | Valeur | Écrit par | Lu par |
|---|---|---|---|---|
| `daily_results` | `date` | `{date, score, results, wrongGuesses, importedInDex}` | `daily.js`, `data.js` | `daily.js`, `stats.js`, `history.js`, `history_curve.js`, `old_daily.js`, `data.js`, `daily-to-dex` |
| `weekly_results` | `date` | idem | `weekly.js`, `data.js` | `weekly.js`, `stats.js`, `history.js`, `history_curve.js`, `old_daily.js`, `data.js` |

Le store est créé par `onupgradeneeded` dans chaque module qui ouvre la base ; la version cible est toujours 4.

### 2.2 `PokefeetDexDB` — version 4

| Store | Clé | Valeur |
|---|---|---|
| `dex_entries` | `index` | `{index, found, firstFoundDate, count}` |

Écrit par `Dex.markFound()`, `Dex.addNewDexEntry()`, donc indirectement par Daily, Weekly, challenges bonus et imports. Lu par `Dex.getProgress()`, `stats.js`, `challenge.js`, `challenge-manager.js`.

### 2.3 `PokefeetChallengeDB` — version 4

| Store | Clé | Index | Valeur |
|---|---|---|---|
| `challenge_completions` | `challengeId` | `completedAt` | `{challengeId, completedAt, fails}` |

Écrit par `ChallengeStorage.markChallengeCompleted()` et `putCompletion()` (import). Lu par `ChallengeStorage.getAllCompletions()` (liste, stats, cosmétiques, export).

### 2.4 Motif d'écriture dangereux

`saveDailyToDB()` et `saveWeeklyToDB()` font :

```js
store.clear();                    // vide tout le store
for (const date in historyObj) {
  store.put({ date, importedInDex: false, ...historyObj[date] });
}
```

Conséquences :

- deux onglets qui sauvegardent en même temps peuvent **perdre l'historique de l'autre** ;
- `importedInDex` est remis à `false` à chaque réécriture complète, puis recalculé ;
- une erreur au milieu de la boucle laisse la base vide ou partielle (la transaction protège l'atomicité, mais le `clear` est dans la même transaction : en cas d'erreur, `tx.onerror` rejette et la transaction est annulée — le risque principal reste l'écrasement concurrent).

### 2.5 Ouverture et timeouts

Plusieurs modules implémentent un timeout de 5 s (`idbTimedOut`) et un handler `onblocked` avec le message « close other tabs ». `migration.js` utilise 8 s. Aucun module ne partage son instance : chaque fichier ouvre sa propre connexion et la referme rarement (sauf `stats.js` pour le Dex).

---

## 3. Cookies

| Cookie | Valeur | Écrit par | Lu par | Durée |
|---|---|---|---|---|
| `pokefeet_language` | `fr` / `en` | `translate.js` | `translate.js` | 365 j |
| `pk_best` | entier | `game.js`, `data.js` | `game.js`, `stats.js`, `data.js`, `challenge-manager.js` | 365 j (3650 j à l'import) |
| `pk_best_streak` | entier | `game.js`, `data.js` | `game.js`, `stats.js`, `data.js`, `challenge-manager.js` | 365 j |
| `pk_fast_mode` | `true` / `false` | `game.js`, `data_management.html` | `game.js` | 365 j |
| `pk_pseudo` | chaîne ≤ 30 | `data_management.html` (inline), `profile.js` (mort) | `stats.js`, `custom-create-ui.js`, page crédits | 365 j |
| `pk_cosmetic_bg` | `Value` ou `null`/`default` | `cosmetics.js` | `cosmetics.js` | 365 j |
| `pk_cosmetic_btn` | `Value` ou `null`/`default` | `cosmetics.js` | `cosmetics.js` | 365 j |
| `pk_daily_result_v2` | JSON legacy | **plus personne** | `migration.js` (backup uniquement) | 3650 j |
| `pk_weekly_result_v1` | JSON legacy | **plus personne** | personne | — |

**Constat important** : `migration.js` sauvegarde `pk_daily_result_v2` dans `backupData` mais **ne le convertit pas** en IndexedDB. Les anciennes sauvegardes cookie ne sont donc plus lues par le jeu. Le commentaire « Data is still safe in cookies » est trompeur : les données restent dans le cookie, mais l'application ne les exploite plus.

---

## 4. `localStorage` et `sessionStorage`

| Clé | Support | Contenu | Producteur |
|---|---|---|---|
| `pk_practice_session` | localStorage | session Marathon (voir doc 03) | `game.js` |
| `challenge_manager_state` | sessionStorage | `{challengeId, currentIndex, currentFails, gameActive, seed}` | `ChallengeManager.startChallenge()` |
| `cosmetic_Background_cat` | sessionStorage | catégorie active de cosmétiques | inline `data_management.html` |
| `cosmetic_Background-Buttons_cat` | sessionStorage | idem | inline `data_management.html` |

Le `sessionStorage` des challenges n'est pas nettoyé à la fin : `completeChallenge()` ne supprime pas `challenge_manager_state`. Une nouvelle partie écrase l'état, mais un retour sur un challenge peut restaurer un état périmé.

---

## 5. Migration (`migration.js`)

### 5.1 Déclenchement

`Migration.run()` est appelé immédiatement à la fin du script, sur **toutes les pages** qui incluent `migration.js`. Il expose une promesse `Migration.ready`, attendue par `daily`, `weekly`, `stats`, `old_daily` et `challenge.html`.

### 5.2 Déroulement

1. Sauvegarde les cookies connus dans `backupData.cookies`.
2. `isAlreadyAtTarget()` ouvre les 3 bases et vérifie `db.version >= 4`.
3. Si toutes sont à 4 : `ready` est résolue immédiatement.
4. Sinon, `Promise.all([migratePokefeetDB(), migrateDexDB(), migrateChallengeDB()])` :
   - lecture de toutes les données existantes avant upgrade (`readAllData`) ;
   - ouverture avec la version cible (déclenche `onupgradeneeded`) ;
   - création des stores manquants ;
   - réécriture des données lues (`writeAllData`).
5. Succès : notification « Base de données mise à jour (v4) ».
6. Échec : popup d'erreur avec un rapport exportable (cookies, backup, user agent, stack).

### 5.3 Limites

- **Pas de migration des cookies vers IndexedDB** : seuls les schémas de bases sont migrés.
- **Fusion multi-onglets** : `onblocked` produit une erreur, l'utilisateur doit fermer les autres onglets.
- **Pas de version de données applicative** : si un store change de forme, rien ne le détecte.
- **Pas de transaction inter-bases** : les 3 migrations sont parallèles et indépendantes ; un échec partiel laisse un état mixte.
- **Le rapport d'erreur peut contenir des données personnelles** (pseudo, historique) : il est généré localement, mais l'utilisateur peut le partager.

---

## 6. Export de sauvegarde (`data.js`)

### 6.1 Format

```text
POKEFEET_SAVE v2
Exported: <ISO>
---DATA---
<JSON compact>
---HASH---
<FNV-1a 32 hex>
```

`buildPayloadObj()` lit :

- `daily_results` (tout le store) ;
- `weekly_results` (tout le store) ;
- cookies `pk_best`, `pk_best_streak` ;
- `challenge_completions` (tout le store).

Puis `createExportText()` sérialise et calcule le hash. Le fichier est téléchargé via un `Blob` et un `<a download>`.

### 6.2 Import de fichier

1. `parseImportText()` sépare sur `---DATA---` puis `---HASH---`.
2. Vérifie le hash FNV-1a.
3. `mergePayloadIntoCookies()` :
   - **Daily** : ajoute les dates absentes ; en cas de conflit (même date, contenu différent), demande confirmation par `confirm()` et garde fichier ou cookie ;
   - **Weekly** : ajoute uniquement les dates absentes ; **aucune résolution de conflit** ;
   - **Marathon** : garde le maximum entre fichier et cookies ;
   - **Challenges** : `mergeChallenges()` ajoute les complétions absentes ;
   - **Dex** : pour chaque date Daily importée non marquée `importedInDex`, reconstruit la liste déterministe et appelle `Dex.markFound()` sur **tous** les Pokémon de la liste — y compris ceux qui ont échoué. C'est un bug de fidélité.
4. Affiche une notification et rafraîchit l'aperçu.

### 6.3 Import manuel Daily/Weekly

`data.js` expose deux imports texte :

- **Daily** : en-tête `Pokefeet Daily — YYYY-MM-DD — score N` ou `Pokefeet Daily (mini) — ...`, suivi de 5 lignes de 5 carrés (`🟩🟧🟥`) ou d'une ligne de 5 emojis pour le mini.
- **Weekly** : même principe avec 10 lignes / 10 emojis.

Interprétation :

- `🟥🟥🟥🟥🟥` → `{outcome:'fail', attempts:5}` ;
- sinon `attempts = nombre de 🟧`, score recalculé `10 - 2*attempts` ;
- le format mini perd la nuance : un `🟧` devient `attempts: 1`, donc 8 points ;
- le score déclaré est comparé au score recalculé ; un écart est signalé mais **le score recalculé est conservé**.

Commande spéciale : `!DEL:YYYY-MM-DD` dans la zone Daily supprime l'entrée correspondante.

### 6.4 Suppressions

- `deleteBestBtn` : supprime `pk_best` et `pk_best_streak`.
- `deleteDailyBtn` : `store.clear()` sur `daily_results` uniquement.
- Aucun bouton ne supprime `weekly_results`, le Dex ou les challenges.

---

## 7. Flux de données par fonctionnalité

| Action | Écritures | Lectures préalables |
|---|---|---|
| Fin de Daily | `daily_results` (clear + put de tout l'historique), Dex `markFound` pour les gagnants | historique complet, Dex |
| Fin de Weekly | `weekly_results` (clear + put), Dex | historique complet, Dex |
| Challenge réussi | `challenge_completions` put, Dex pour toute la `FeetList` | challenges JSON, Pokémons |
| Choix cosmétique | cookie `pk_cosmetic_*` | `cosmetics.json`, complétions |
| Marathon correct | `localStorage` session, cookies best | session, cookies |
| Import fichier | les 2 stores + challenges + cookies + Dex | fichier, bases |
| Migration | upgrade des 3 bases | données existantes |

---

## 8. Recommandations pour la restructuration

1. **Un seul module `db`** exposant `openDB()`, `withStore()`, `getAll()`, `putAll()`, avec une seule promesse `ready`.
2. **Remplacer `clear + putAll`** par des `put` unitaires ou une transaction différentielle.
3. **Ajouter une version de schéma** dans les stores et dans le fichier d'export.
4. **Migrer réellement les cookies legacy** une fois, avec un flag `legacyMigrated`.
5. **Séparer** export/import de la logique de jeu ; valider le payload avec un schéma.
6. **Décider du sort du Dex à l'import** : reconstruire uniquement les gagnants, pas toute la liste.
7. **Ajouter un verrou d'onglet** (`BroadcastChannel` ou `navigator.locks`) pour les écritures d'historique.

Voir [16-code-mort-et-orphelins.md](./16-code-mort-et-orphelins.md) et [18-plan-de-restructuration.md](./18-plan-de-restructuration.md).

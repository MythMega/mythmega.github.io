# 19 — Plan de tests et de non-régression

> L'application n'a **aucun test automatisé**. Ce document fournit :
> 1. une baseline manuelle à exécuter avant la restructuration ;
> 2. les tests unitaires à écrire sur les fonctions pures ;
> 3. les scénarios end-to-end à automatiser ;
> 4. les critères de non-régression par phase.

---

## 1. Environnement de test

### 1.1 Lancement

- Serveur statique local sans cache : `start_server.cmd` ou `python scripts/serve.py 5981`.
- **Ne pas utiliser `python -m http.server` seul** : il n'envoie pas de `Cache-Control`, et le navigateur peut rejouer une ancienne page HTML après un déplacement de fichiers (scripts 404).
- **Ne pas tester en `file://`** : `crypto.subtle`, `fetch` et IndexedDB peuvent échouer.
- Navigateurs cibles : Chrome/Edge récent, Firefox récent, Safari récent, mobile (Chrome Android/Safari iOS).
- Tester avec un profil neuf (`localStorage`/IndexedDB/cookies vides) **et** avec un profil existant.

### 1.2 Jeux de données

Créer `tests/fixtures/` :

| Fixture | Contenu |
|---|---|
| `save-v2.txt` | export valide avec 2 dailies, 1 weekly, 2 challenges, records |
| `save-v2-tampered.txt` | hash invalide |
| `daily-long.txt` | en-tête + 5 lignes de 5 carrés |
| `daily-mini.txt` | en-tête mini + 5 emojis |
| `weekly-long.txt` | en-tête + 10 lignes |
| `weekly-mini.txt` | en-tête mini + 10 emojis |
| `custom-code-1.txt` | code compressé `1...` |
| `custom-code-2.txt` | code non compressé `2...` |
| `custom-url.txt` | URL complète `custom_play.html?code=...` |
| `dex-seed.json` | entrées Dex attendues après import |
| `pokemons-subset.json` | pool réduit pour tester les listes déterministes |

### 1.3 Remise à zéro

Avant chaque scénario :

1. DevTools → Application → Clear site data (cookies, localStorage, IndexedDB).
2. Recharger.
3. Vérifier `IndexedDB` : aucune base ou bases v4 créées.

---

## 2. Baseline manuelle — parcours critiques

### 2.1 Accueil et navigation

| # | Scénario | Attendu |
|---|---|---|
| A1 | Ouvrir `index.html` | loader, puis hub complet, bandeau si disponible |
| A2 | Cliquer chaque tuile | bonne page, pas d'erreur console |
| A3 | Footer | Accueil, Données, Changelog, Crédits fonctionnels |
| A4 | Sélecteur de langue FR → EN | reload, textes traduits, cookie |
| A5 | Retour EN → FR | idem |

### 2.2 Marathon

| # | Scénario | Attendu |
|---|---|---|
| M1 | Première partie | session créée, image, input focus |
| M2 | Bonne réponse 1er essai | +10, série 1, image complète |
| M3 | 1–4 erreurs | indices dans l'ordre, jauge 8/6/4/2 |
| M4 | 5 erreurs | game over, image/nom révélés |
| M5 | Rechargement en cours | reprise au bon Pokémon |
| M6 | Abandon | confirmation, game over |
| M7 | Victoire | écran de félicitations |
| M8 | Mode rapide | enchaînement 400 ms |
| M9 | Saisie invalide | shake, pas de tentative |
| M10 | Doublon de réponse | « Déjà essayé », pas de tentative |

### 2.3 Daily

| # | Scénario | Attendu |
|---|---|---|
| D1 | Daily du jour | 5 Pokémon déterministes |
| D2 | Rejouer le même jour | écran « déjà joué », contrôles désactivés |
| D3 | `?date=` passé non joué | daily rejouable |
| D4 | `?date=` futur | alerte, redirection |
| D5 | Bonne réponse | +10/8/6/4/2, point vert/orange |
| D6 | 5 erreurs | popup, révélation, passage |
| D7 | « Passer » | confirmation, échec |
| D8 | Fin | score, partage long/mini, images |
| D9 | Dex | nouveaux Pokémon marqués |
| D10 | Rechargement en cours | confirmation, pas de sauvegarde |
| D11 | Image en échec | retry, pas de blocage |

### 2.4 Weekly

| # | Scénario | Attendu |
|---|---|---|
| W1 | Weekly courant | 10 Pokémon |
| W2 | `?week=` lundi passé | rejouable |
| W3 | `?week=` non-lundi | popup lundi précédent |
| W4 | `?week=` futur | alerte |
| W5 | `?week=2026-02-30` | rejeté |
| W6 | Fin | score /100, partage |
| W7 | Rejouer | écran terminé |

### 2.5 Défis passés

| # | Scénario | Attendu |
|---|---|---|
| P1 | Aucun historique | message vide |
| P2 | Historique existant | liste du plus ancien à aujourd'hui |
| P3 | Clic Daily | `daily.html?date=...` |
| P4 | Onglet Weekly | semaines, clic `weekly.html?week=...` |
| P5 | Déjà joué | classe `played` |

### 2.6 Challenges bonus

| # | Scénario | Attendu |
|---|---|---|
| B1 | Liste | onglets, cartes, difficultés |
| B2 | Prérequis | vert/rouge, bouton désactivé |
| B3 | Challenge jouable | ordre mélangé, indices |
| B4 | 5+ erreurs | pas de blocage |
| B5 | Fin | popup, XP, images, copie |
| B6 | Retour liste | challenge marqué complété |
| B7 | Cosmétique | débloqué et sélectionnable |
| B8 | Rechargement en cours | état restauré |
| B9 | Challenge hors date | masqué ou visible si complété |

### 2.7 Challenges custom

| # | Scénario | Attendu |
|---|---|---|
| C1 | Créer 0/1/2 Pokémon | bouton désactivé/actif |
| C2 | Recherche, ajout, retrait | séquence correcte |
| C3 | Drag & drop, tri, shuffle | ordre correct |
| C4 | Générer | URL absolue |
| C5 | Ouvrir l'URL | infos correctes |
| C6 | Jouer | ordre fixe/aléatoire, indices |
| C7 | Fin | partage, images, rejouer |
| C8 | Code invalide | vue invalide |
| C9 | Code `1...` et `2...` | décodage OK |
| C10 | URL complète | extraction du `code` |

### 2.8 Pokédex

| # | Scénario | Attendu |
|---|---|---|
| X1 | Profil neuf | 0/698, silhouettes |
| X2 | Daily réussi | entrée trouvée |
| X3 | Daily échoué | entrée non trouvée |
| X4 | Recherche FR/EN/index | filtrage |
| X5 | Filtres trouvés/non trouvés | exclusivité |
| X6 | Tris | ordre correct |
| X7 | Popup | détails corrects |
| X8 | Force Update | gagnants ajoutés |
| X9 | Import | vérifier le bug des échecs |

### 2.9 Stats et progression

| # | Scénario | Attendu |
|---|---|---|
| S1 | Profil neuf | niveau 1, 0 XP |
| S2 | Daily/weekly terminés | XP cohérent avec doc 11 |
| S3 | Trophées | progression et états |
| S4 | Récompenses | cartes, popup |
| S5 | Titre/badges | plus haut palier |
| S6 | Onglets | rendu paresseux |
| S7 | Modale XP | ouverture/fermeture |

### 2.10 Paramètres et données

| # | Scénario | Attendu |
|---|---|---|
| G1 | Pseudo | validation, sauvegarde, effacement |
| G2 | Mode rapide | persistance |
| G3 | Cosmétiques | sélection, défaut, verrou |
| G4 | Export | fichier valide |
| G5 | Import valide | fusion |
| G6 | Import modifié | refus |
| G7 | Conflit Daily | OK/Annuler |
| G8 | Weekly | ajout sans conflit |
| G9 | Import Daily manuel | long + mini |
| G10 | `!DEL` | suppression |
| G11 | Suppressions | best score, daily |

### 2.11 Annexes

| # | Scénario | Attendu |
|---|---|---|
| T1 | `data.html` | table, tri, filtre, fallback |
| T2 | `prediction.html` | mot de passe, listes futures |
| T3 | Crédits | onglets, images |
| T4 | Changelog | contenu |
| T5 | `test-i18n.html` | clés et attributs |

---

## 3. Tests unitaires à écrire

### 3.1 RNG et sélection

```js
seedFromString('2026-10-19') === seedFromString('2026-10-19')
shuffle([1..100], seed) est stable pour un seed donné
getDailyList(pokemons, '2026-10-19') === getDailyList(...) // idempotent
getWeeklyList(pokemons, '2026-10-19') utilise 'week'+date
pool respecte deploy_date <= date
```

### 3.2 Scoring et noms

```js
pointsForAttempt(0) === 10
pointsForAttempt(1) === 8
pointsForAttempt(4) === 2
pointsForAttempt(5) === 0
matchesName('Bulbizarre') === true
matchesName('bulbasaur') === true
matchesName('Bulbasaur') === true
matchesName('Bulba') === false
matchesName('Búlbasaur') === true // accents
```

### 3.3 XP

Cas de test :

| Entrée | XP attendu |
|---|---:|
| Daily terminé, 0 parfait, 0 premier essai | 3 |
| Daily terminé, parfait | 5 |
| Daily parfait + 5 premiers essais | 10 |
| Weekly terminé | 6 |
| Weekly parfait | 10 |
| Weekly parfait + 10 premiers essais | 30 |
| Marathon best 100, streak 10 | 40 |
| Challenge 50 XP | 50 |
| Trophée 25 XP | 25 |
| Total | somme |

### 3.4 Import/export

- `parseImportText` : header, data, hash, JSON invalide, hash manquant.
- `fnv1a32Hex` : valeurs connues.
- `parseDailyText` : long, mini, lignes invalides, score mismatch, URL ignorée, `R1 :` ignoré.
- `parseWeeklyText` : idem.
- Merge : dates absentes, conflits, records max, challenges.

### 3.5 Codec custom

- `encode` → `decode` round-trip pour 2, 10, 100 Pokémon.
- Marqueur `1` si compression utile, `2` sinon.
- `decode` d'une URL complète.
- `decode` d'un code tronqué → `null`.
- Caractères non ASCII dans le nom/auteur.
- Longueur et stabilité.

### 3.6 Trophées

- `Dex_Count`, `Daily_Count`, `Weekly_Count`, `Marathon_Streak`.
- `Full_Generation_Register` complet/incomplet.
- `Type_Registered` avec `Value = null`, `-1`, seuil partiel.
- `Enabled: false` ignoré.

### 3.7 Formats de date

- `getMondayOfWeek` dimanche → lundi précédent.
- `dateToStr` et `getDateFromURL`.
- Rejet des dates inexistantes.
- Weekly futur.

---

## 4. Tests end-to-end (Playwright)

Priorité :

1. **Daily complet** : jouer 5 rounds, vérifier le score, l'historique, le Dex, le partage.
2. **Weekly complet** : idem 10 rounds.
3. **Marathon reprise** : recharger en cours, vérifier l'état.
4. **Challenge bonus** : liste → jeu → fin → cosmétique.
5. **Custom** : créer → générer → ouvrir → jouer → partage.
6. **Export/import** : exporter, vider, importer, vérifier l'historique.
7. **Import manuel** : Daily long et mini.
8. **Migration** : partir d'une base v3 (fixture) et vérifier v4 + données.
9. **i18n** : bascule FR/EN, vérifier les textes clés.
10. **Multi-onglets** : deux onglets, deux dailies, vérifier l'absence de perte (test de non-régression après correction).

### 4.1 Sélecteurs stables

Préférer les IDs existants (`#dailyInput`, `#dailySubmit`, `#dailySkip`, `#dailyFailConfirm`, `#round-dot-0`, etc.) et les `data-*` ajoutés si nécessaire. Ne pas dépendre des classes CSS cosmétiques.

### 4.2 Contrôle du temps

- `?date=` et `?week=` permettent de tester sans attendre.
- Pour le « jour courant », mocker `Date` ou utiliser une date passée.
- Pour les challenges, utiliser `Availabilities` existantes ou une fixture.

---

## 5. Tests de données et de migration

| Test | Procédure | Attendu |
|---|---|---|
| Base v4 existante | ouvrir l'app | aucune migration, données intactes |
| Base v3 | fixture, ouvrir | upgrade v4, données conservées |
| Base absente | profil neuf | création v4 |
| Dex absent | ouvrir le Dex | store créé, 0 entrée |
| Challenge DB absent | ouvrir un challenge | store créé |
| Deux onglets | upgrade simultané | message `onblocked`, pas de corruption |
| Cookie legacy | `pk_daily_result_v2` présent | **actuellement ignoré** ; à décider |
| Import v2 | fixture | merge correct |
| Import v1 (`best` seul) | fixture | record repris |
| Import malformé | JSON valide, champs absents | doit être refusé (à implémenter) |

---

## 6. Tests de performance

Mesurer avant/après sur un profil avec :

- 200 dailies, 100 weeklies, 400 entrées Dex, 20 challenges complétés.

| Scénario | Métrique | Cible indicative |
|---|---|---|
| Chargement `stats.html` | temps jusqu'à niveau affiché | < 1,5 s |
| Chargement `pied-dex.html` | temps jusqu'à grille | < 2 s |
| Ouverture d'un onglet stats | temps de rendu | < 300 ms |
| Fin de Daily | temps de sauvegarde | < 200 ms |
| `forceUpdate` | durée | < 2 s |
| `prediction.html` | génération 3 650 jours | < 3 s |
| Liste challenges | rendu 32 cartes | < 1 s |

Les cibles sont indicatives : l'important est de **mesurer une baseline** et de ne pas régresser.

---

## 7. Matrice de non-régression par phase

| Phase | Tests obligatoires |
|---|---|
| 0 — Baseline | tous les parcours critiques |
| 1 — Code mort | A, M, D, W, X, G |
| 2 — Fondations | D, W, B, C + unitaires RNG/cookies/DB |
| 3 — Domaine | S, B, C, D, W + unitaires XP/trophées |
| 4 — Fonctionnalités | parcours de la fonctionnalité + A + G |
| 5 — Daily/Weekly | D, W, P, S, G6–G10 |
| 6 — Consolidation | tous |

---

## 8. Critères de sortie globaux

- [ ] Tous les scénarios de la baseline passent sur Chrome et Firefox.
- [ ] Aucune erreur console sur les pages principales.
- [ ] Aucune requête 404 (hors `pokemons_wip.json` assumé).
- [ ] Les données existantes sont conservées après migration.
- [ ] Les URLs et formats de partage sont identiques.
- [ ] Les exports produits par l'ancienne version sont lisibles par la nouvelle.
- [ ] Les exports produits par la nouvelle version sont lisibles par l'ancienne (pendant la transition).
- [ ] Les clés i18n existent en FR et EN.
- [ ] Les tests unitaires et e2e passent en CI.

---

## 9. Ce qui ne peut pas être vérifié statiquement

- Le rendu réel des 1 572 images et des sprites alternatifs.
- Le comportement de `CompressionStream` selon le navigateur.
- Le comportement d'IndexedDB en navigation privée et en multi-onglets.
- La disponibilité du Google Sheet d'accueil.
- Le rendu CSS sur mobile et les interactions tactiles.
- Les performances réelles sur un appareil bas de gamme.

Ces points doivent être couverts par les tests manuels et, si possible, par Playwright avec des profils de navigateurs réels.

---

## 10. Lint statique et configuration

Le lint ne dépend d'aucun paquet npm : il est exécuté par Node et vérifie l'ensemble du dépôt statique.

```bash
npm run lint
```

Il contrôle :

- la syntaxe des scripts JS et l'absence de `debugger`, `eval()` et `document.write()` ;
- les références locales des pages HTML et des feuilles CSS ;
- les ids HTML dupliqués et les clés `data-i18n` utilisées ;
- l'équilibre des blocs CSS ;
- la validité de tous les JSON ;
- la parité des clés FR/EN ;
- le schéma de `settings/config.json`.

### Configuration

`settings/config.json` est chargé par `js/data/config.js` avec des valeurs de repli validées :

| Propriété | Défaut | Effet |
|---|---|---|
| `historyChartDays` | `60` | Nombre de jours affichés dans le graphique Daily de `history.html` |
| `oldDailyPageSize` | `30` | Nombre de dates par page dans `old_daily.html` (Daily et Weekly) |

Toute valeur non entière, hors bornes ou toute clé inconnue fait échouer `npm run lint`.

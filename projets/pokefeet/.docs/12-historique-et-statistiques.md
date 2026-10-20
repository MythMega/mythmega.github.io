# 12 — Historique et statistiques

## 1. Deux pages, deux moteurs

| Page | Rôle | Scripts |
|---|---|---|
| `history.html` | listes Daily/Weekly, courbes de score, cartes de statistiques | `js/features/history/history.js`, `js/features/history/history-curve.js` |
| `stats.html` | profil, XP, niveaux, trophées, récompenses, stats détaillées | `js/features/stats/stats.js`, `entity/reward/*` |

`stats.html` ne réutilise **pas** `js/features/history/history-curve.js` : `js/features/stats/stats.js` réimplémente les mêmes métriques. `history.html` charge les deux modules, qui écrivent dans les mêmes conteneurs.

---

## 2. `history.html`

### 2.1 Structure

| Onglet | Panneau | Contenu |
|---|---|---|
| Daily | `#histDailyPanel` | `#historyChart` (canvas), `#chartStats`, `#historyList`, `#detailedStats` |
| Weekly | `#histWeeklyPanel` | `#weeklyChart`, `#weeklyChartStats`, `#weeklyHistoryList`, `#weeklyDetailedStats` |

Compteur `#totalDays`, libellé `#totalCountLabel`.

### 2.2 `js/features/history/history.js`

- `loadHistory()` / `loadWeeklyHistory()` : lisent les stores et retournent une map date → `{score, results}`.
- `formatDateLabel(iso)` : `fr-FR` ou `en-GB`.
- `emojiLineFromResults(results)` : un emoji par round (🟩/🟧/🟥), avec tooltip.
- `render()` :
  - trie les dates décroissantes ;
  - pagination **25 par 25** (`history.showMore`) ;
  - chaque ligne : date, score `/50`, emojis, coche `importedInDex` ;
  - clic → `daily.html?date=...` ;
  - séparateurs « Mise à jour : <Update_Name> (<date>) » entre deux entrées lorsqu'une version a été déployée ;
  - tooltips mobiles au clic.
- `renderWeekly()` : même principe, score `/100`, clic → `weekly.html?week=...`.

### 2.3 `js/features/history/history-curve.js`

- `init()` immédiat : charge les versions, l'historique, construit `#historyList`, dessine `#historyChart` (60 derniers jours), calcule `#detailedStats`.
- `window.HistoryCurve.renderWeekly()` : dessine `#weeklyChart` (60 dernières semaines) et `#weeklyDetailedStats`.
- `drawChart(points)` : canvas 2D, grille 0–50, ligne + points, moyenne, meilleure série, labels de mise à jour.
- `drawWeeklyChart(points)` : même chose sur 0–100.

**Conflit réel** : `js/features/history/history-curve.js` et `js/features/history/history.js` écrivent tous les deux dans `#historyList`. Les deux rendus sont asynchrones (fetch + IndexedDB) : le dernier arrivé écrase l'autre, sans ordre garanti. En pratique, la liste paginée de `js/features/history/history.js` est souvent visible, mais ce n'est pas déterministe. Le graphique et les cartes de `history_curve` restent, eux, dans leurs conteneurs dédiés.

### 2.4 Métriques des cartes

`renderDetailedStats(historyObj, containerId, count, maxPts)` (js/features/stats/stats.js) et `renderStats` / `renderWeeklyStats` (js/features/history/history-curve.js) calculent :

| Carte | Métriques |
|---|---|
| Global | entrées jouées, meilleur score, pire score, jours/semaines parfaits, score total |
| Moyennes | globale, 7/30/90 derniers jours (ou 4/12/52 semaines) |
| Séries | meilleure série, série actuelle, meilleure série parfaite, série parfaite actuelle |
| Rounds | total, parfaits 🟩, trouvés 🟩🟧, ratés 🟥 |

Définitions :

- **série** : suite de dates consécutives (pas 1 jour / pas 7 jours) ;
- **série actuelle** : si la dernière entrée est trop ancienne (> 1 jour / 1 semaine), 0 ;
- **parfait** : score égal au maximum (`50` ou `100`) ;
- **round parfait** : `win` avec `attempts === 0` ;
- **round raté** : absent, non-win, ou `fail`.

---

## 3. `stats.html`

### 3.1 En-tête

- `#statsPseudo` : cookie `pk_pseudo` ou `—`.
- `#statsPseudoLabel` : titre du plus haut palier débloqué (ou libellé « Joueur »).
- `#profileBadges` : badges des paliers débloqués.
- `#statsLevel` : `Niveau N` + bouton `?`.
- `#statsTotalXP`, `#statsXPBarFill`, `#statsXPBarText`.

### 3.2 Onglets

| Onglet | Panneau | Rendu |
|---|---|---|
| Daily | `#statsDailyPanel` | `renderDetailedStats(dailyHistory, ..., 5, 50)` |
| Weekly | `#statsWeeklyPanel` | idem 10/100 |
| Marathon | `#statsMarathonPanel` | meilleur score et meilleure série |
| Trophées | `#statsTrophiesPanel` | `renderTrophies` |
| Récompenses | `#statsRewardsPanel` | `renderRewardsTab` |

Chaque onglet est rendu **à la première ouverture** (`weeklyRendered`, etc.), sauf Daily rendu au chargement.

### 3.3 Barème d'XP

Bouton `#xpHelpBtn` → modale `#xpScaleModal` (`open`), fermeture par bouton, clic extérieur ou `Échap`.

### 3.4 Trophées

Voir doc 11. Le rendu sépare les trophées de type des autres et affiche une barre de progression par trophée.

### 3.5 Récompenses

Voir doc 11. `#rewardsGrid`, popup `#rewardPopup`, `#rewardPopupDetails`.

---

## 4. Duplication et divergences

| Élément | `js/features/history/history.js` + `js/features/history/history-curve.js` | `js/features/stats/stats.js` |
|---|---|---|
| Lecture IndexedDB | 2 implémentations | 1 implémentation |
| Cartes de stats | `renderStats` / `renderWeeklyStats` | `renderDetailedStats` |
| Calcul des séries | 2 implémentations | 1 implémentation |
| Graphiques | canvas | aucun |
| Pagination | 25 lignes | aucune |
| Séparateurs de version | oui | non |

Les définitions sont proches mais pas garanties identiques. Toute correction doit être appliquée aux deux endroits.

---

## 5. Problèmes connus

| Problème | Détail |
|---|---|
| Double rendu de `#historyList` | `history_curve` et `history` écrivent dans le même conteneur ; le dernier arrivé gagne |
| Double moteur de stats | history vs stats |
| Canvas non responsive | taille fixe 600×320 + ratio devicePixelRatio |
| `maxPoints` codé en dur | 50 / 100 |
| Date locale vs ISO | `toISOString()` pour la série actuelle peut décaler d'un jour selon le fuseau |
| `history.totalDays` | compte les entrées, pas les jours réellement joués |
| Tooltips | dépendent du clic, pas du survol |
| `importedInDex` | affiché mais peut être faux (voir doc 04) |
| Performance | `js/features/stats/stats.js` parcourt 698 Pokémon pour chaque trophée de type |

---

## 6. Checklist de test manuel

1. Aucun historique : messages vides, compteurs 0.
2. Daily : lignes triées décroissant, pagination 25, clic ouvre le daily.
3. Weekly : idem, clic ouvre la semaine.
4. Emojis et tooltips.
5. Séparateur de mise à jour entre deux dates.
6. Courbe Daily : 60 derniers jours, échelle 0–50, moyenne.
7. Courbe Weekly : 60 dernières semaines, échelle 0–100.
8. Cartes Daily : global, moyennes 7/30/90, séries, rounds.
9. Cartes Weekly : 4/12/52 semaines.
10. Stats : onglets, rendu paresseux.
11. Niveau/XP : cohérents avec doc 11.
12. Trophées : progression et états.
13. Récompenses : cartes et popup.
14. Modale d'aide XP : ouverture/fermeture.
15. Fuseau horaire : vérifier la série actuelle autour de minuit.

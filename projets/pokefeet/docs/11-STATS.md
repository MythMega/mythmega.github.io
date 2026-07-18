# Statistiques — `stats.js`

## Vue d'ensemble

La page `stats.html` affiche des statistiques détaillées pour les 3 modes de jeu, le niveau/XP, les trophées et les récompenses.

## Structure de la page

La page est organisée en **onglets** :

1. **Daily** — Statistiques des parties Daily
2. **Weekly** — Statistiques des parties Weekly
3. **Marathon** — Meilleur score et meilleure série
4. **Trophées** — Grille des trophées
5. **Récompenses** — Badges et titres débloquables

## Statistiques détaillées

La fonction `renderDetailedStats()` génère 4 cartes de statistiques :

### Carte "Globaux"
- Jours/Semaines joués
- Meilleur score
- Pire score
- Jours/Semaines parfaits
- Score total

### Carte "Moyennes"
- Moyenne globale
- Moyenne des 7/4 derniers
- Moyenne des 30/12 derniers
- Moyenne des 90/52 derniers

### Carte "Séries"
- Meilleure série (consécutifs)
- Série actuelle
- Meilleure série parfaite
- Série parfaite actuelle

### Carte "Rounds"
- Total joués
- Parfaits (🟩)
- Trouvés (🟩🟧)
- Ratés (🟥)

### Calcul des séries

```js
function longestStreak(arr) {
    // Compte le nombre de dates consécutives (step = 1 jour ou 7 jours)
}

function currentStreakOf(arr) {
    // Vérifie si la dernière date est aujourd'hui/cette semaine
    // Compte les consécutifs depuis la fin
}
```

## Marathon

```js
function renderMarathon() {
    document.getElementById('marathonBestScore').textContent = getCookie('pk_best');
    document.getElementById('marathonBestStreak').textContent = getCookie('pk_best_streak');
}
```

## Courbes de progression

Le module `history_curve.js` (non détaillé ici) génère des graphiques de progression au fil du temps.

## Récompenses

### Classe `Reward` (entity/reward/)

Les récompenses sont chargées depuis `data/reward.json` et instanciées via une classe `Reward` (dans `entity/reward/`).

### Affichage

```js
async function renderRewardsTab() {
    // Charge data/reward.json
    // Crée des instances de Reward
    // Trie par niveau croissant
    // Affiche chaque récompense sous forme de carte
    // Les cartes débloquées sont en couleur, les verrouillées en gris
}
```

### Popup

Un clic sur une récompense ouvre une popup avec les détails via `reward.renderPopupContent()`.
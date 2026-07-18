# Historique — `history.js`

## Vue d'ensemble

La page `history.html` affiche l'historique des parties Daily et Weekly sous forme de liste chronologique.

## Fonctionnement

### Chargement des données

```js
async function loadHistory() {
    // Charge tous les enregistrements depuis IndexedDB (PokefeetDB.daily_results)
    // Retourne un objet { date: { score, results, importedInDex }, ... }
}

async function loadWeeklyHistory() {
    // Charge depuis PokefeetDB.weekly_results
}
```

### Affichage

La liste affiche pour chaque entrée :
- **Date** formatée (ex: "16 déc. 2025" ou "16 Dec 2025" selon la langue)
- **Score** : `score / 50` (Daily) ou `score / 100` (Weekly)
- **Emojis** : ligne de 5 (Daily) ou 10 (Weekly) emojis :
  - 🟩 = trouvé du premier coup
  - 🟧 = trouvé après échecs (tooltip avec le nombre d'échecs)
  - 🟥 = échec
- **Icône Dex** : ✓ si déjà importé dans le Dex

### Pagination

25 entrées par page avec un bouton "Afficher 25 de plus".

### Séparateurs de mise à jour

Entre les entrées, si une version de données a été déployée entre deux dates, un séparateur s'affiche :

```
↑ Mise à jour : 4G (2026-05-28) ↓
```

### Navigation

Un clic sur une entrée redirige vers `daily.html?date=YYYY-MM-DD` ou `weekly.html?week=YYYY-MM-DD`.

### Onglets

- **Daily** : onglet actif par défaut
- **Weekly** : onglet secondaire (rendu paresseux)

### Tooltips mobiles

Les emojis 🟧 ont un tooltip accessible au clic (pour mobile) :

```js
function setupEmojiTooltips() {
    // Au clic sur un 🟧, affiche "fails: N"
    // Un second clic ou clic ailleurs ferme le tooltip
}
```

### Formatage des dates

```js
function formatDateLabel(isoDate) {
    // "2026-07-09" → "09 juil. 2026" (fr) ou "09 Jul 2026" (en)
}
```

### Formatage des semaines

```js
function formatWeekLabel(mondayStr) {
    // "2026-07-06" → "Semaine du 6 juil. au 12 juil. 2026"
}
# 07 — Mode Weekly

## 1. Identité

| Élément | Valeur |
|---|---|
| Page | `weekly.html` |
| Scripts | `js/core/pokemon.js`, `js/core/pokemon-versions.js`, `js/data/dex.js`, `js/features/weekly/weekly.js`, `js/data/migration.js`, i18n, cosmetics |
| Constante | `COUNT = 10` |
| Score max | 100 |
| Seed | `"week" + lundi YYYY-MM-DD` |
| Stockage | `PokefeetDB/weekly_results` + Dex |

Le Weekly est le clone structurel du Daily : 10 Pokémon, une semaine, identifiants pour tous.

---

## 2. Calcul de la semaine

```js
function getMondayOfWeek(d) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay();              // 0 = dimanche
  const diff = (day === 0) ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return date;
}
```

- La semaine est identifiée par son **lundi**.
- `dateToStr()` produit `YYYY-MM-DD` en heure locale.
- Sans paramètre : lundi de la semaine courante.

### 2.1 `?week=`

`getWeekFromURL()` :

- accepte `?week=YYYY-MM-DD` ;
- vérifie que la date est réelle (`dateToStr(parsed) === weekParam`, rejette les rollovers type `2026-02-30`) ;
- vérifie que `parsed.getDay() === 1` (lundi) ;
- refuse une semaine future (`weekParam > lundi courant`) : alerte + redirection ;
- si la date n'est pas un lundi : `invalidWeekParam` est mémorisé et une popup propose de rediriger vers le **lundi précédent**.

### 2.2 Seed

```js
const seed = stringToSeed('week' + sessionWeek);
```

Le préfixe `week` évite qu'un daily et un weekly partagent la même séquence pour une même date.

---

## 3. Déroulement

Le flux est identique au Daily (voir doc 06), avec :

- 10 slots (`#round-dot-0..9`) ;
- `weeklyList` reconstruite par `getWeeklyListForDate(weekDateStr)` ;
- `results` de 10 entrées ;
- `wrongGuessesPerSlot` de 10 tableaux ;
- `#weeklyInput`, `#weeklySubmit`, `#weeklySkip`, `#weeklyHints`, `#weeklyReveal`, `#weeklyScore`.

### 3.1 Spécificités

- `translatorReady()` attend que `Translator.get('common.backHome')` soit disponible avant d'afficher des textes dynamiques (évite les fallbacks FR).
- `init()` fait `await translatorReady()` **avant** `Migration.ready`.
- Popup de date invalide : `showInvalidDatePopup(rawDate)`.
- Le bouton de confirmation d'échec est `#dailyFailConfirm` (ID partagé avec le Daily, présent dans `weekly.html`).
- Le texte de partage est `Pokefeet Weekly — ...` / `Pokefeet Weekly (mini) — ...`.

---

## 4. Persistance

`saveResultForWeek(payload)` :

```js
history[dateKey] = { score, results, wrongGuesses };
await saveWeeklyToDB(history);         // clear + putAll
await updateImportedInDex(dateKey, true);
```

- Store : `weekly_results`, clé `date` = lundi.
- Dex : `markFound` pour chaque gagnant.
- `importedInDex` est écrit mais n'est pas utilisé pour éviter les doubles imports.

### 4.1 Écran « déjà joué »

`renderFinishedFromCookie(payload, weekDateStr)` :

- partage, points, score ;
- restaure `results`, `score`, `wrongGuessesPerSlot` ;
- `index = COUNT` ;
- reconstruit la liste pour les images complètes ;
- désactive les contrôles.

---

## 5. Différences Daily / Weekly

| Aspect | Daily | Weekly |
|---|---|---|
| Nombre de Pokémon | 5 | 10 |
| Score max | 50 | 100 |
| Seed | date | `"week" + lundi` |
| Paramètre URL | `?date=` | `?week=` |
| Validation de date | format + non futur | format + date réelle + lundi + non futur |
| Date invalide | alerte/redirection | popup vers lundi précédent |
| Stockage | `daily_results` | `weekly_results` |
| Import texte | `parseDailyText` | `parseWeeklyText` |
| XP de fin | +3, parfait +2, 1er essai +1 | +6, parfait +4, 1er essai +2 |
| Partage | `Pokefeet Daily` | `Pokefeet Weekly` |
| Attente traductions | non | oui (`translatorReady`) |

---

## 6. Problèmes connus

| Problème | Détail |
|---|---|
| Duplication massive | ≈ 80 % du code est copié de `js/features/daily/daily.js` |
| `cookieName` mort | constante jamais utilisée |
| `showAttemptGauge` mort | définie, jamais appelée |
| `populateNamesList` no-op | identique au Daily |
| `beforeunload` | confirmation si `index < 10`, pas de sauvegarde |
| Conflit multi-onglets | `clear + put` sur tout le store |
| Date invalide | la popup crée un backdrop sans nettoyage si l'utilisateur ne clique pas |
| `state` de challenge | sans rapport, mais même pattern de persistance temporaire |

---

## 7. Checklist de test manuel

1. Weekly courant : 10 Pokémon, ordre identique sur deux navigateurs.
2. Lundi calculé correctement (dimanche → lundi précédent).
3. `?week=` lundi passé : rejoue la semaine ; si déjà jouée, écran terminé.
4. `?week=` non-lundi : popup + redirection vers lundi précédent.
5. `?week=` futur : alerte + redirection.
6. `?week=2026-02-30` : rejeté.
7. 10 rounds, score max 100.
8. Fin : partage long/mini, images complètes.
9. Dex : 10 gagnants marqués.
10. Rejouer la même semaine : écran terminé.
11. Rechargement en cours : confirmation, pas de reprise.
12. Traductions : textes dynamiques dans la langue choisie.

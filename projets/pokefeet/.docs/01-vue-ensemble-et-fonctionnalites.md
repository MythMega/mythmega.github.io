# 01 — Vue d'ensemble et inventaire des fonctionnalités

## 1. Le produit

**Pokefeet** est un jeu de devinettes Pokémon : le joueur voit une image partielle (un ou deux pieds) et doit retrouver le nom du Pokémon en français ou en anglais. L'application est entièrement statique (HTML/CSS/JS vanilla), sans backend : la progression est stockée dans le navigateur (cookies, `localStorage`, `sessionStorage`, IndexedDB).

Le produit combine :

- **des modes de jeu déterministes** (Daily, Weekly) où tous les joueurs voient la même sélection ;
- **un mode libre** (Marathon) avec reprise de session et classement personnel ;
- **des challenges bonus** scénarisés, avec prérequis, dates de disponibilité et récompenses ;
- **des challenges custom** partageables par URL, sans persistance ;
- **une couche de progression** : Pokédex, XP, niveaux, trophées, badges, titres, cosmétiques ;
- **des outils de continuité** : historique, graphiques, import/export de sauvegarde, migration de données.

Le jeu est disponible en **français** et en **anglais** (453 clés par langue).

---

## 2. Parcours utilisateur principal

```
index.html
├── Daily Challenge      → daily.html       (5 Pokémon, seed = date)
├── Weekly Challenge     → weekly.html      (10 Pokémon, seed = lundi)
├── Défis passés         → old_daily.html   (calendrier Daily/Weekly)
├── Challenges Bonus     → list_challenges.html → challenge.html
├── Challenges Custom    → custom.html → custom_create.html / custom_play.html
├── Marathon             → pokefeet.html    (pool complet, reprise)
├── Historique           → history.html     (listes + courbes + stats)
├── Pokédex              → pied-dex.html    (collection + import)
├── Paramètres           → data_management.html (données, cosmétiques, profil)
└── Profile              → stats.html       (niveau, XP, trophées, récompenses)
```

Le footer commun ajoute `data.html` (visualiseur de données), `changelog.html` et `credits.html`.

---

## 3. Inventaire fonctionnel

### 3.1 Modes de jeu

| Fonctionnalité | Page | Logique | Stockage | Documentation |
|---|---|---|---|---|
| Marathon / Practice | `pokefeet.html` | `js/features/marathon/game.js` + `js/features/marathon/ui.js` | `localStorage` session, cookies best score/streak | [05](./05-mode-marathon.md) |
| Daily | `daily.html` | `js/features/daily/daily.js` | IndexedDB `daily_results`, cookies legacy, Dex | [06](./06-mode-daily.md) |
| Weekly | `weekly.html` | `js/features/weekly/weekly.js` | IndexedDB `weekly_results`, Dex | [07](./07-mode-weekly.md) |
| Défis passés | `old_daily.html` | `js/features/history/old-daily.js` | lecture IndexedDB | [12](./12-historique-et-statistiques.md) |
| Challenges bonus | `list_challenges.html`, `challenge.html` | `js/core/challenge.js`, `business/challenge-*`, `ui/challenge-*-ui.js` | `PokefeetChallengeDB`, Dex | [08](./08-challenges-bonus.md) |
| Challenges custom | `custom_create.html`, `custom_play.html` | `business/custom_challenges/*`, `ui/custom_challenges/*` | aucun (URL uniquement) | [09](./09-challenges-custom.md) |

### 3.2 Progression et collection

| Fonctionnalité | Page | Logique | Stockage | Documentation |
|---|---|---|---|---|
| Pokédex | `pied-dex.html` | `js/data/dex.js`, `js/features/dex/dex-ui.js`, `js/data/daily-to-dex-import.js` | `PokefeetDexDB` | [10](./10-pokedex.md) |
| XP / niveaux | `stats.html` | `js/features/stats/stats.js`, `js/features/challenges/challenge-manager.js` | recalcul à la volée | [11](./11-progression-xp-trophees-recompenses.md) |
| Trophées | `stats.html` | `js/features/stats/stats.js`, `data/trophies.json` | recalcul à la volée | [11](./11-progression-xp-trophees-recompenses.md) |
| Récompenses (badges, titres) | `stats.html` | `entity/reward/*`, `data/reward.json` | cookie pseudo + niveau calculé | [11](./11-progression-xp-trophees-recompenses.md) |
| Profil (pseudo, titre, badges) | `data_management.html`, `stats.html` | inline + `js/features/stats/stats.js` | cookie `pk_pseudo` | [13](./13-profil-cosmetiques-sauvegarde.md) |
| Cosmétiques | toutes les pages | `js/features/settings/cosmetics.js`, `data/cosmetics.json` | cookies `pk_cosmetic_bg/btn` | [13](./13-profil-cosmetiques-sauvegarde.md) |

### 3.3 Historique, données et continuité

| Fonctionnalité | Page | Logique | Documentation |
|---|---|---|---|
| Historique Daily/Weekly | `history.html` | `js/features/history/history.js`, `js/features/history/history-curve.js` | [12](./12-historique-et-statistiques.md) |
| Statistiques détaillées | `stats.html` | `js/features/stats/stats.js` | [12](./12-historique-et-statistiques.md) |
| Export de sauvegarde | `data_management.html` | `js/data/data-manager.js` | [04](./04-persistance-et-migration.md) |
| Import de sauvegarde | `data_management.html` | `js/data/data-manager.js` | [04](./04-persistance-et-migration.md) |
| Import manuel Daily/Weekly (emoji) | `data_management.html` | `js/data/data-manager.js` | [04](./04-persistance-et-migration.md) |
| Migration IndexedDB/cookies | toutes les pages | `js/data/migration.js` | [04](./04-persistance-et-migration.md) |
| Visualiseur de données | `data.html` | script inline | [15](./15-pages-annexes-et-outils-donnees.md) |
| Prédictions protégées | `prediction.html` | script inline | [15](./15-pages-annexes-et-outils-donnees.md) |

### 3.4 Transverse

| Fonctionnalité | Fichier(s) | Documentation |
|---|---|---|
| i18n FR/EN | `js/i18n/translate.js`, `js/i18n/setup.js`, `js/i18n/language-switcher.js`, `translations/*.json` | [14](./14-ui-transversale-et-i18n.md) |
| Chargement / skeletons | `js/ui/loader.js` | [14](./14-ui-transversale-et-i18n.md) |
| Notifications, gauges, autocomplete | `js/features/marathon/ui.js`, scripts de mode | [14](./14-ui-transversale-et-i18n.md) |
| Footer commun | `js/ui/footer.js` | [14](./14-ui-transversale-et-i18n.md) |
| Bandeau d'actualités | inline `index.html` (Google Sheets) | [15](./15-pages-annexes-et-outils-donnees.md) |
| Crédits | `js/features/credits/credits.js`, `data/credits.json` | [15](./15-pages-annexes-et-outils-donnees.md) |

---

## 4. Règles communes aux modes de devinette

### 4.1 Barème de points

Chaque Pokémon rapporte **10 points maximum**, moins **2 points par indice affiché** :

| Tentatives ratées avant la bonne réponse | Indices affichés | Points |
|---|---|---|
| 0 | 0 | 10 |
| 1 | Type(s) | 8 |
| 2 | Type(s) + Index/Génération | 6 |
| 3 | + Groupes d'œuf | 4 |
| 4 | + Catégorie | 2 |
| 5 | échec | 0 |

- **Daily** : 5 Pokémon → score maximum **50**.
- **Weekly** : 10 Pokémon → score maximum **100**.
- **Marathon** : pas de plafond, série (streak) cumulée.
- **Challenges bonus/custom** : pas de score numérique ; on compte les erreurs.

### 4.2 Indices progressifs

L'ordre est identique dans Daily, Weekly, Marathon et challenges :

1. **Type(s)** — badges colorés (`Type1`, `Type2`).
2. **Index + génération** — numéro du Pokédex et génération.
3. **Groupes d'œuf** — `EggGroups` concaténés.
4. **Catégorie** — `Category` (ex. « Pokémon Graine »).

Les challenges custom utilisent le même principe mais **sans limite d'échecs** : les indices continuent de s'ajouter.

### 4.3 Validation des réponses

- Le nom est comparé à `NameFR` **et** `NameEN`, après normalisation : `NFD`, suppression des diacritiques, minuscules.
- Un nom inconnu de la base est refusé (« Nom invalide ») et **ne consomme pas** de tentative.
- Une réponse déjà proposée pour le Pokémon courant est refusée (« Déjà essayé ») et ne consomme pas de tentative.
- Chaque mode possède un **mot de passe maître** (hash SHA-256 identique dans `js/features/marathon/game.js`, `js/features/daily/daily.js`, `js/features/weekly/weekly.js`, `prediction.html`) qui valide n'importe quel Pokémon. C'est une fonction de secours/démonstration, pas une sécurité.

### 4.4 Déterminisme

- **Daily** : seed = chaîne `YYYY-MM-DD` de la date, hashée puis utilisée par Mulberry32 + Fisher-Yates. Pool filtré par version de données disponible à cette date.
- **Weekly** : seed = `"week" + YYYY-MM-DD` du lundi.
- **Marathon** : ordre mélangé avec un seed aléatoire, mais **persisté** pour permettre la reprise.
- **Challenges bonus** : ordre mélangé avec un seed aléatoire, persisté en `sessionStorage`, non déterministe entre joueurs.
- **Challenges custom** : ordre défini par le créateur, ou mélange aléatoire à chaque partie si l'option est activée.

### 4.5 Versions de données

`data/version.json` décrit les vagues de contenu :

| Version | Date de déploiement | Contenu |
|---|---|---|
| 1 | `null` (toujours disponible) | 1G, 2G, 3G |
| 2 | 2026-05-27 | 4G |
| 3 | 2026-07-18 | Missing Paldean Wooper |
| 4 | 2026-08-31 | 5G |

Un Pokémon est disponible si `deploy_date === null` ou `deploy_date <= date du jour`. Les modes Daily/Weekly/Marathon filtrent leur pool avec cette règle ; les challenges bonus, custom, le Dex et les statistiques utilisent l'ensemble des 698 Pokémon.

---

## 5. Matrice fonctionnalité × dépendance × stockage

| Fonctionnalité | Dépend de | Écrit dans | Lit dans |
|---|---|---|---|
| Marathon | `Pokemon`, `PokemonVersions`, `TypeIcons`, `UI`, `Translator` | `localStorage` `pk_practice_session`, cookies `pk_best`, `pk_best_streak` | `data/pokemons.json`, `data/version.json` |
| Daily | `Pokemon`, `PokemonVersions`, `TypeIcons`, `Dex`, `Migration`, `Translator` | `PokefeetDB/daily_results`, Dex | `PokefeetDB/daily_results`, `data/pokemons.json` |
| Weekly | idem Daily | `PokefeetDB/weekly_results`, Dex | idem |
| Challenges bonus | `Challenge`, `ChallengeManager`, `ChallengeStorage`, `Dex`, `Cosmetics` | `PokefeetChallengeDB`, Dex | `data/bonus_challenges.json`, `data/pokemons.json`, `data/trophies.json` |
| Challenges custom | `Pokemon`, codec, `CompressionStream` | rien | `data/pokemons.json` |
| Pokédex | `Pokemon`, `PokemonVersions`, `Dex` | `PokefeetDexDB` | `PokefeetDB`, `PokefeetDexDB` |
| XP / trophées | `Dex`, `ChallengeStorage`, `PokemonVersions` (indirect) | rien (calcul) | les 3 bases + JSON |
| Récompenses | `Reward`, `RewardItem`, `RewardButton` | rien | `data/reward.json`, cookie pseudo |
| Cosmétiques | `ChallengeStorage` | cookies `pk_cosmetic_*` | `data/cosmetics.json`, `PokefeetChallengeDB` |
| Export/import | `Dex`, `DailyToDexImport`, `ChallengeStorage` | les 3 bases + cookies | fichier `.txt` |
| Migration | aucune | les 3 bases + cookies | IndexedDB v1–v4, cookies legacy |

---

## 6. Glossaire

| Terme | Définition |
|---|---|
| **Pool** | Ensemble des Pokémon éligibles à un mode après filtrage par version/date. |
| **Seed** | Graine déterministe d'un générateur pseudo-aléatoire (Mulberry32). |
| **Round / slot** | Un Pokémon à deviner dans une série Daily/Weekly. |
| **Indice** | Information révélée après un échec (type, index, œufs, catégorie). |
| **Dex** | Pokédex local : une entrée par Pokémon trouvé. |
| **Completion** | Enregistrement de la réussite d'un challenge bonus. |
| **Cosmétique** | Fond de page ou style de bouton débloqué par un challenge. |
| **Save** | Fichier texte exporté contenant daily, weekly, marathon et challenges. |
| **Migration** | Passage des anciens cookies/IndexedDB vers le schéma v4. |

---

## 7. Points d'attention produit

- Le mode **Marathon** est nommé « Marathon » dans l'UI mais « Practice »/« Entraînement » dans le code et certains textes.
- Le **score Daily/Weekly** n'est pas persisté comme un score global : il est recalculé à partir des résultats par round pour l'XP et les statistiques.
- Les **challenges bonus** ne donnent pas de score, seulement des erreurs, de l'XP et des cosmétiques.
- Les **challenges custom** ne donnent ni XP, ni récompense, ni sauvegarde (arcade assumé).
- Le **Dex** peut être mis à jour par Daily, Weekly, challenges bonus et imports ; un même Pokémon peut avoir `count > 1`.
- Le **profil** n'a pas de compte : pseudo et cosmétiques sont des cookies, donc perdus avec le navigateur ou le nettoyage des cookies.
- L'**export de sauvegarde n'inclut pas** le pseudo, les cosmétiques choisis, le mode rapide, ni le Dex (il reconstruit le Dex à l'import).

# 11 — Progression : XP, niveaux, trophées, récompenses

## 1. Vue d'ensemble

La progression n'est **pas stockée** : elle est recalculée à chaque chargement de `stats.html` ou à chaque vérification de prérequis de challenge, à partir :

- des historiques Daily/Weekly (`PokefeetDB`) ;
- des cookies Marathon (`pk_best`, `pk_best_streak`) ;
- des complétions de challenges (`PokefeetChallengeDB`) ;
- du Dex (`PokefeetDexDB`) ;
- des JSON `trophies.json`, `reward.json`, `bonus_challenges.json`, `pokemons.json`.

Conséquence : modifier un JSON, importer une sauvegarde ou changer un barème **change rétroactivement** le niveau et les trophées.

---

## 2. Formule d'XP

### 2.1 Daily

Pour chaque date de `daily_results` :

| Condition | XP |
|---|---:|
| Jour terminé (`results.length === 5`) | +3 |
| Jour parfait (`score === 50`) | +2 |
| Chaque round gagné au premier essai (`outcome === 'win' && attempts === 0`) | +1 |

Maximum théorique par jour : 3 + 2 + 5 = **10 XP**.

### 2.2 Weekly

Pour chaque lundi de `weekly_results` :

| Condition | XP |
|---|---:|
| Semaine terminée (`results.length === 10`) | +6 |
| Semaine parfaite (`score === 100`, tous gagnés) | +4 |
| Chaque round gagné au premier essai | +2 |

Maximum théorique par semaine : 6 + 4 + 20 = **30 XP**.

### 2.3 Marathon

```js
xp += Math.floor(bestScore / 5) + bestStreak * 2;
```

Uniquement les **records** (`pk_best`, `pk_best_streak`), pas l'historique des sessions. Si les deux sont absents ou nuls, 0.

### 2.4 Challenges bonus

Pour chaque complétion, on retrouve le challenge dans `bonus_challenges.json` et on ajoute chaque `Rewards[].Value` de type `Experience`.

- Pas de distinction première complétion / re-complétion : une seule entrée par challenge.
- Les cosmétiques ne donnent pas d'XP.
- Les challenges custom ne donnent pas d'XP.

### 2.5 Trophées

Chaque trophée `earned` ajoute son champ `XP`. Le total est la somme des trophées **actuellement** obtenus, pas un historique.

### 2.6 Total

```js
totalXP = dailyXP + weeklyXP + marathonXP + challengeXP + trophyXP;
```

---

## 3. Niveaux

```js
const XP_PER_LEVEL = 100;
level = Math.floor(totalXP / 100) + 1;
xpInLevel = totalXP % 100;
```

- Niveau 1 : 0–99 XP.
- Niveau 2 : 100–199 XP.
- Pas de niveau maximum.
- La barre `#statsXPBarFill` affiche `xpInLevel / 100`.
- Le libellé `#statsLevel` est réécrit en `Niveau N` (français codé en dur) tout en préservant le bouton d'aide `?`.

---

## 4. Trophées (`data/trophies.json`)

### 4.1 Structure

```json
{
  "Id": 1,
  "Name_en": "...",
  "Name_fr": "...",
  "Desc_en": "...",
  "Desc_fr": "...",
  "XP": 25,
  "Obtention_Method": { "Mode": "Dex_Count", "Value": 5, "Type": null },
  "Rarity": 1,
  "Picture": "./img/trophy/dex/bronze.png",
  "Enabled": true
}
```

79 trophées, dont 54 `Type_Registered`, 9 `Full_Generation_Register`, 4 `Dex_Count`, 4 `Daily_Count`, 4 `Weekly_Count`, 4 `Marathon_Streak`.

### 4.2 Modes d'obtention

| Mode | Vérification | Progression |
|---|---|---|
| `Dex_Count` | `found >= Value` | `found / Value` |
| `Daily_Count` | nombre de dailies terminés >= Value | `count / Value` |
| `Weekly_Count` | nombre de weeklies terminés >= Value | `count / Value` |
| `Marathon_Streak` | `pk_best_streak >= Value` | `streak / Value` |
| `Full_Generation_Register` | tous les Pokémon de la génération `Value` sont trouvés | `foundGen / totalGen` |
| `Type_Registered` | tous (ou `Value`) les Pokémon du `Type` sont trouvés | `foundType / totalType` |

Pour `Type_Registered` :

- si `Value` est `null`, `undefined` ou `-1`, le seuil est le **nombre total** de Pokémon de ce type ;
- sinon, le seuil est `Value`.

### 4.3 Rendu

`renderTrophies()` sépare :

- les trophées `Type_Registered` (grille par type, ordre `TYPE_DISPLAY_ORDER`) ;
- les autres (groupés par mode, ordre `TROPHY_TYPE_ORDER`).

Chaque carte affiche image, nom, description, XP, rareté, état obtenu/verrouillé, et une barre de progression (`progressMap`).

### 4.4 Faiblesses

- 54 trophées de type sont calculés en parcourant tous les Pokémon à chaque rendu.
- `Full_Generation_Register` dépend du Dex complet, pas des versions.
- Un trophée désactivé (`Enabled: false`) est ignoré.
- Les trophées ne sont pas datés : impossible de savoir quand ils ont été obtenus.

---

## 5. Récompenses (`data/reward.json`)

### 5.1 Paliers

14 paliers, du niveau 1 au niveau 100. Chaque palier contient :

- `ImageUrl` (badge) ;
- `Reward[]` : `Badge`, `Title`, `StreamdexCMD` ;
- `Title_FR/EN`, `Description_FR/EN` ;
- `Button` optionnel.

Types réels : `StreamdexCMD` 9, `Badge` 5, `Title` 5.

### 5.2 Déblocage

`Reward.isUnlocked(currentLevel)` : `currentLevel >= level`.

L'onglet « Récompenses » de `stats.html` :

- charge `reward.json` ;
- instancie les `Reward` ;
- trie par niveau ;
- affiche une carte par palier avec progression ;
- ouvre une popup au clic sur « Voir » si débloqué.

### 5.3 Profil

`updateProfileBadgesAndTitle(currentLevel)` :

- prend tous les paliers débloqués ;
- collecte les `Badge.Data` et les affiche dans `#profileBadges` ;
- choisit le `Title.Data` du **plus haut palier débloqué** et l'écrit dans `#statsPseudoLabel` (suppression de `data-i18n` pour éviter l'écrasement).

Le pseudo (`pk_pseudo`) est affiché dans `#statsPseudo`.

---

## 6. Incohérences et risques

| Problème | Détail | Impact |
|---|---|---|
| Double implémentation | `js/features/stats/stats.js` et `ChallengeManager.computeTotalXP()` | deux totaux possibles |
| Recalcul complet | chaque `getPlayerLevel()` recharge bases + JSON | lenteur sur la liste de challenges |
| XP non persisté | tout est dérivé | modification rétroactive du niveau |
| Trophées non datés | pas d'historique | impossible de distinguer ancien/nouveau |
| `Type_Registered` coûteux | parcours de 698 Pokémon par trophée | 54 × 698 opérations |
| `Niveau` codé en dur | `js/features/stats/stats.js` écrit `'Niveau ' + level` | non traduit |
| Badges dupliqués | un même badge peut apparaître plusieurs fois si plusieurs paliers le listent | doublons visuels |
| Titre | dépend du dernier palier débloqué, pas d'un choix utilisateur | pas de personnalisation |
| `StreamdexCMD` | copie dans le presse-papier | dépend de l'API clipboard |
| Niveau max | 100 dans les données, pas de plafond dans le code | au-delà, plus de récompense |

---

## 7. Checklist de test manuel

1. Profil vierge : niveau 1, 0 XP, aucun trophée, badge du niveau 1.
2. Un daily terminé : +3 XP minimum ; parfait : +5 ; premier essai : +1 par round.
3. Weekly : +6 / +4 / +2 par round premier essai.
4. Marathon : record 100 et série 10 → 20 + 20 = 40 XP.
5. Challenge avec 50 XP : total +50.
6. Trophée débloqué : XP ajouté, carte colorée, progression 100 %.
7. Trophée de type incomplet : progression partielle.
8. Génération complète : trophée obtenu.
9. Niveau 2 à 100 XP : barre 0/100, titre/badge mis à jour.
10. Onglet Récompenses : 14 cartes, verrouillées/débloquées, popup.
11. Modification d'un JSON : le niveau change après rechargement (comportement attendu mais à documenter).
12. Deux onglets : pas d'écriture, donc pas de conflit.

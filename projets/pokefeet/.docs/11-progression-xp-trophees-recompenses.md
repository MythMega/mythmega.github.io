# 11 — Progression : XP, niveaux, trophées, récompenses

## 1. Vue d'ensemble

La progression n'est **pas stockée** : elle est recalculée à chaque chargement de `profile.html` ou à chaque vérification de prérequis de challenge, à partir :

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
| Chaque round trouvé (`outcome === 'win'`) | +1 |
| Chaque round trouvé au premier essai (`attempts === 0`), en plus | +1 |

Maximum théorique par jour : 3 + 2 + 5 + 5 = **15 XP**.

### 2.2 Weekly

Pour chaque lundi de `weekly_results` :

| Condition | XP |
|---|---:|
| Semaine terminée (`results.length === 10`) | +6 |
| Semaine parfaite (`score === 100`, tous gagnés) | +4 |
| Chaque round trouvé | +1 |
| Chaque round trouvé au premier essai, en plus | +2 |

Maximum théorique par semaine : 6 + 4 + 10 + 20 = **40 XP**.

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

Une seule implémentation : `js/core/xp.js` (`PokefeetXP`). `js/features/stats/stats.js` délègue (`getLevel`, `getXPInLevel`, `levelCost`) pour éviter deux courbes divergentes.

```js
const XP_PER_LEVEL = 100;
const XP_STEP      = 2;
levelCost(n)  = 100 + 2 * (n - 1);            // coût du palier n → n+1
xpToReach(n)  = k * (200 + 2 * (k - 1)) / 2;  // k = n - 1
level         = plus grand n tel que xpToReach(n) <= totalXP
xpInLevel     = totalXP - xpToReach(level)
```

- Le palier 1 → 2 coûte 100 XP, puis chaque palier coûte 2 XP de plus que le précédent.
- Pas de niveau maximum dans le code, mais les récompenses s'arrêtent au niveau 100.
- La barre `#statsXPBarFill` affiche `xpInLevel / levelCost(level)` et le texte `xpInLevel / levelCost(level) XP`.
- Le popup « Barème d'XP » (`#xpScaleModal`) affiche la courbe ; ses chiffres sont injectés par `renderLevelScale()`.
- Le libellé `#statsLevel` est réécrit en `Niveau N` (français codé en dur) tout en préservant le bouton d'aide `?`.

### 3.1 Pourquoi une courbe progressive

Mesures sur le contenu disponible (octobre 2026) :

| Source | XP |
|---|---|
| 41 challenges bonus (39 récompenses `Experience`) | 6 100 |
| 79 trophées actifs | 13 900 |
| **Total fixe** | **20 000** |
| daily + weekly parfaits sur 487 jours d'historique | 10 088 |
| rythme maximal | 145 XP / semaine (105 daily + 40 weekly) |

Avec le barème plat (100 XP par palier, niveau 100 = 9 900 XP), les 20 000 XP de contenu fixe dépassaient deux fois le niveau 100 : un joueur ayant tout complété atteignait le **niveau 201**, et « Master » tombait au bout de la moitié du contenu. La courbe progressive place le niveau 100 à **19 602 XP**, soit exactement le contenu fixe du jeu (`XP_STEP = 2` : le joueur qui a tout complété atteint le niveau 101).

Paliers de contrôle :

| Niveau | Plate 100 XP | Progressive (XP_STEP = 2) |
|---|---|---|
| 2 | 100 | 100 |
| 5 | 400 | 412 |
| 10 | 900 | 972 |
| 25 | 2 400 | 2 952 |
| 50 | 4 900 | 7 252 |
| 100 | 9 900 | 19 602 |

XP totale → niveau, points de repère : 500 XP → niveau 5 ; 2 000 → 18 ; 5 000 → 37 ; 10 000 → 63 ; 20 000 (contenu complet) → 101.


---

## 4. Trophées (`data/trophies/`)

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

## 5. Récompenses (`data/rewards/`)

### 5.1 Paliers

14 paliers, du niveau 1 au niveau 100. Chaque palier contient :

- `ImageUrl` (badge) ;
- `Reward[]` : `Badge`, `Title`, `StreamdexCMD` ;
- `Title_FR/EN`, `Description_FR/EN` ;
- `Button` optionnel.

Types réels : `StreamdexCMD` 9, `Badge` 5, `Title` 5.

### 5.2 Déblocage

`Reward.isUnlocked(currentLevel)` : `currentLevel >= level`.

L'onglet « Récompenses » de `profile.html` :

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
| Double implémentation | les calculs d'XP (stats.js, challenges, Boutique) passent par `js/core/xp.js` ; la logique des trophées y reste recopiée de `stats.js` | un trophée mal recopié ferait diverger le profil et la Boutique |
| Recalcul complet | chaque `getPlayerLevel()` recharge bases + JSON | lenteur sur la liste de challenges |
| XP non persisté | tout est dérivé | modification rétroactive du niveau (la courbe progressive fait **baisser** les niveaux existants) |
| Daily rejouable | borné par `js/core/challenge-window.js` : `daily.html?date=…` et `weekly.html?week=…` n'acceptent que la fenêtre proposée par « Défis passés » (premier défi enregistré → aujourd'hui) | plus de farm rétroactif ; reste borné par le premier défi du joueur |
| Trophées non datés | pas d'historique | impossible de distinguer ancien/nouveau |
| `Type_Registered` coûteux | parcours de 698 Pokémon par trophée | 54 × 698 opérations |
| `Niveau` codé en dur | `js/features/stats/stats.js` écrit `'Niveau ' + level` | non traduit |
| Badges dupliqués | un même badge peut apparaître plusieurs fois si plusieurs paliers le listent | doublons visuels |
| Titre | dépend du dernier palier débloqué, pas d'un choix utilisateur | pas de personnalisation |
| `StreamdexCMD` | copie dans le presse-papier | dépend de l'API clipboard |
| Niveau max | 100 dans les données, pas de plafond dans le code | au-delà, plus de récompense |
| Titres vs courbe | titres aux niveaux 10 / 25 / 50 / 100, désormais à 972 / 2 952 / 7 252 / 19 602 XP | « Master » demande désormais tout le contenu fixe du jeu |

---

## 7. Checklist de test manuel

1. Profil vierge : niveau 1, 0 XP, aucun trophée, badge du niveau 1.
2. Un daily terminé : +3 XP minimum, +1 par round trouvé, +1 de plus par round trouvé du premier essai, +2 si jour parfait.
3. Weekly : +6 / +4 / +10 pour les rounds trouvés / +20 pour ceux trouvés du premier essai.
4. Marathon : record 100 et série 10 → 20 + 20 = 40 XP.
5. Challenge avec 50 XP : total +50.
6. Trophée débloqué : XP ajouté, carte colorée, progression 100 %.
7. Trophée de type incomplet : progression partielle.
8. Génération complète : trophée obtenu.
9. Niveau 2 à 100 XP (barre `0/105`) ; niveau 10 à 1 080 XP (barre `0/145`), titre/badge mis à jour.
10. Onglet Récompenses : 14 cartes, verrouillées/débloquées, popup.
11. Modification d'un JSON : le niveau change après rechargement (comportement attendu mais à documenter).
12. Deux onglets : pas d'écriture, donc pas de conflit.

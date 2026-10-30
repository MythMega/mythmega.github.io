# 5. Récompenses de connexion

Une récompense offerte **une fois par jour UTC** au joueur qui se connecte, présentée sous forme de
tableau de bord : un chapitre = une série de jours, chaque jour porte sa récompense. Le joueur clique
sur la récompense du jour pour la récupérer, avec une animation qui dépend de la nature du cadeau.

| Élément | Fichier |
|---|---|
| Données des chapitres | `settings/daily_connect_rewards.json` |
| Chargement, série, claim | `js/business/DailyRewardManager.js` |
| Tableau de bord (popup) | `js/UI/components/DailyRewardPopup.js` |
| Styles et animations | `css/components/daily-reward.css` |
| État sauvegardé | `user_state["dailyRewards"]` (voir `database.md` § 3.17) |
| Validation | règle `data/daily-rewards` de `tools/lint.mjs` |

---

## 5.1 Le fichier `settings/daily_connect_rewards.json`

Un **tableau de chapitres**, dans l'ordre d'affichage. Les clés inconnues et les `_comment` sont
ignorés à la lecture (comme partout dans le projet) : ils documentent l'intention.

```jsonc
[
  {
    "ID": "dailyconnectreward_1",        // identifiant stable du chapitre (obligatoire, unique)
    "RewardListName": "Genesis Departure", // titre affiché dans la popup
    "Dates": {
      "Start": "30-10-2026",             // premier jour où le chapitre est ouvert (inclus)
      "End": "05-12-2026"                // dernier jour (inclus)
    },
    "Days": [
      { "Day": 1, "Reward": { "Type": "Sparks", "Qte": 3 } },
      {
        "Day": 30,
        "Reward": { "Type": "Card", "Qte": 1, "CardID": "PROMO-A1 / E01" },
        "Unique": true,
        "UniqueID": "CardRewardConnectionA1GenesisBlock",
        "ReplacementRewardIfClaimed": { "Type": "Ultima", "Qte": 1 }
      },
      { "Day": null, "Reward": { "Type": "Sparks", "Qte": 10 } }
    ]
  }
]
```

### 5.1.1 Dates

Deux écritures sont acceptées pour `Start` et `End` : `DD-MM-YYYY` (celle du fichier livré) et
`YYYY-MM-DD` (celle de tous les autres réglages). Les deux bornes sont **incluses** ; un jour
impossible (`31-02-2026`) est refusé, jamais décalé. La comparaison utilise le **jour UTC fiable**
de `DateSyncManager`, jamais l'horloge de l'appareil : sans ancrage, rien n'est réclamable.

### 5.1.2 `Reward`

| Champ | Rôle |
|---|---|
| `Type` | `Sparks`, `Booster`, `Card`, ou le nom d'une ressource de la mine (`Stone Dust`, `Sculk Dust`, `Glowstone Dust`, `Void Dust`, `Ultima`) |
| `Qte` | quantité, entier strictement positif |
| `CardID` | **`Card` uniquement** : l'`Index` de la carte (`PROMO-A1 / E01`). Si l'index est imprimé en classique **et** en Full Art, la Full Art est préférée |

Une ressource est stockée sous forme de *slug* (`Stone Dust` → `stone_dust`), qui est à la fois la
clé de la sauvegarde, le nom de la texture (`assets/img/dusts/stone_dust.png`) et la clé i18n
(`mineblock.resource.stone_dust`). Le lint refuse un `Type` que la mine ne récompense pas.

### 5.1.3 `Day`, `Day: null` et les trous

- `Day` est un entier positif (le numéro affiché sur la case) ou `null`.
- **`Day: null`** est l'entrée **par défaut** : elle sert pour toute position au-delà du plus grand
  `Day` déclaré (le 31e jour, le 32e, …). Un seul `null` par chapitre.
- Un jour dont la récompense est illisible garde sa place : c'est l'entrée par défaut qui la couvre,
  plutôt qu'un décalage de toutes les récompenses suivantes.
- Un trou dans la numérotation (`Day` 1, 2, 4) est signalé par le lint en avertissement : le défaut
  comblerait la case, mais c'est presque toujours une coquille.

### 5.1.4 `Unique` et `ReplacementRewardIfClaimed`

Une récompense `Unique` n'est distribuée **qu'une fois par compte**, tous chapitres confondus :
c'est `UniqueID` qui l'identifie, et il est mémorisé dans `claimedUniques`. Si le jour revient plus
tard (nouveau chapitre, nouvelle année) et que l'identifiant est déjà dans la liste, c'est
`ReplacementRewardIfClaimed` qui est accordé à la place.

Le lint exige donc **les deux** champs : sans `UniqueID` la récompense serait redistribuée, et sans
remplacement le jour deviendrait irrécupérable (`NO_REWARD`).

---

## 5.2 La série : avancer sans repartir de zéro

La série est portée par `progress` (nombre de récompenses déjà récupérées), pas par le calendrier.

| Situation | Résultat |
|---|---|
| Lundi, premier jour | `progress = 0` → récompense du jour 1 ; `progress` passe à 1 |
| Mardi, journée manquée | rien ne change : la récompense du jour 2 reste à prendre |
| Mercredi, connexion | récompense du **jour 2** ; `progress` passe à 2 |
| Deux semaines d'absence | la série reprend où elle s'était arrêtée, pas à zéro |
| Nouveau chapitre | `chapterId` change → `progress` repart à 0 |
| Deuxième claim le même jour UTC | refusé (`ALREADY_CLAIMED`) : `lastClaimDay` |

Ce que la popup annonce « encore X récompenses » correspond aux jours restants du chapitre **à
partir d'aujourd'hui** : tant que le chapitre est ouvert et que le joueur revient chaque jour, c'est
le nombre de récompenses qu'il peut encore prendre (l'entrée par défaut garantit qu'il y a toujours
quelque chose à donner, même après le dernier `Day` déclaré).

---

## 5.3 La popup

Ouverte de deux façons :

1. **le bouton du header** (icône cadeau, avec un point coloré quand quelque chose attend) ;
2. **automatiquement**, une fois par jour, après la fin d'une révélation d'ouverture de booster,
   si la popup n'a pas encore été vue ce jour-là (`seenDay`).

Le tableau affiche une case par jour, avec le numéro du jour et l'icône de la récompense :

| État | Rendu |
|---|---|
| Récupérée | case atténuée, coche verte |
| Aujourd'hui | case en surbrillance, halo pulsé, seule réclamable |
| À venir | case neutre ; cliquer dessus l'affiche en aperçu sous le tableau |

**Auras** : or pour un `Booster` et pour `Void Dust`, rose pour `Ultima` et pour une carte. Ce sont
les deux seules couleurs qui ne viennent pas du thème : elles *sont* l'information.

**Icônes des cases** : celles qui n'existent qu'en une encre suivent la palette (`js/utils/ThemeIcons.js`).
Une case `Booster` n'en fait pas partie : elle affiche l'**illustration du pack**
(`assets/img/booster.png`, 512 px), la même sur tous les thèmes — c'est une image avec sa propre
palette, pas un glyphe d'une seule encre, et elle se lit sur le tableau clair comme sur le sombre.
Une case `Card` affiche l'**illustration de la carte** (Full Art si l'index est imprimé
deux fois) dans le format portrait de la carte, pas dans un carré de pictogramme ; si l'`Index` ne
correspond à aucune carte du catalogue, `iconOf()` retombe sur le dos de carte commun
(`assets/img/card_back.png`) : la case dit toujours qu'il s'agit d'une carte, et le claim reste
bloqué par `unavailable`.

**Animation de claim** : différente selon la nature du cadeau — une apparition avec éclat pour un
objet, une secousse dorée pour un booster, un retournement avec halo rose pour une carte. Elle dure
1,7 s, puis le tableau est redessiné. Le son est celui des notifications de l'interface.

**Choix de l'extension** (récompense `Booster`) : la popup demande sur quelle extension utiliser le
pack **au moment du claim**. S'il n'y a qu'une extension sortie, elle est choisie sans rien
demander. La liste ne contient que les extensions **sorties** (`listBoosterSets()`), jamais une
extension annoncée.

---

## 5.4 Règles et garde-fous

- **Un claim par jour UTC**, décidé par `lastClaimDay` et re-vérifié **à l'intérieur** de la
  transaction : deux onglets ouverts ne peuvent pas réclamer deux fois.
- **Tout est écrit dans une seule transaction** (`user_state` + `collection`) : la récompense, le
  compteur, le jour du claim et l'identifiant unique. Un échec laisse la sauvegarde intacte et le
  joueur peut réessayer.
- **Horloge non fiable = pas de claim** : sans ancrage UTC, la popup l'explique au lieu de deviner.
- **Contenu non sorti** : une carte d'une extension pas encore sortie n'est pas résolue (les
  catalogues interrogés excluent les extensions à venir). Le claim est refusé avec
  `CONTENT_NOT_RELEASED` et **rien n'est consommé** : le joueur réessaiera après la sortie, sans
  perdre son jour.
- **Annonces** : les Sparks passent par `SPARKS_UPDATED`, les ressources par `MINING_UPDATED`, un
  booster par `QUOTA_UPDATED`, une carte par `CARDS_OBTAINED` (`source: "dailyreward"`) — donc
  trophées, expérience et notifications suivent exactement comme pour un cadeau ou un achat.
- **Nouvelle série** : le premier jour d'un nouveau chapitre remet `progress` à 0 (l'écriture a lieu
  au premier claim ou à la première ouverture de la popup du chapitre).

---

## 5.5 Validation

La règle `data/daily-rewards` du linter refuse, entre autres : un chapitre sans `ID` ou déclaré
deux fois, une fenêtre absente, vide ou dans le mauvais ordre, une date qui n'existe pas, deux
entrées pour le même `Day`, plusieurs entrées par défaut, un `Qte` non positif, un `Type` inconnu,
un `CardID` qu'aucun catalogue ne déclare, un `UniqueID` réutilisé, un `Unique` sans identifiant ou
sans remplacement. Elle avertit sur un jour manquant dans la numérotation.

```bash
node tools/lint.mjs --only data/daily-rewards
```

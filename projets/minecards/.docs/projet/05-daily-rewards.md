# 5. Récompenses de connexion

Une récompense offerte **une fois par jour UTC** au joueur qui se connecte, présentée sous forme de
tableau de bord : un chapitre = une série de jours, chaque jour porte sa récompense. Le joueur clique
sur la récompense du jour pour la récupérer, avec une animation qui dépend de la nature du cadeau.

**Plusieurs chapitres peuvent être ouverts en même temps** (une longue série saisonnière et un
« road to » d'une semaine, par exemple). Chacun garde sa propre progression, et **un même jour de
connexion compte pour tous** : la récompense du jour peut être récupérée dans chaque série ouverte,
et le compteur de jours de connexion (`stats.daysConnected`) n'avance qu'une fois.

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
    "Image": "assets/icons/icon-192.png", // fond du plateau des jours (flouté), une seule fois ; défaut : icon-192.png
    "Mode": "progressive",              // "progressive" (défaut) ou "defined"
    "HiddenBeforeUnlock": false,         // true = masque les récompenses encore à venir
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
| `Type` | `Sparks`, `Booster`, `Card`, `Currency` (une monnaie de l'Illager Shop), ou le nom d'une ressource de la mine (`Stone Dust`, `Sculk Dust`, `Glowstone Dust`, `Void Dust`, `Ultima`) |
| `Qte` | quantité, entier strictement positif |
| `CardID` | **`Card` uniquement** : l'`Index` de la carte (`PROMO-A1 / E01`). Si l'index est imprimé en classique **et** en Full Art, la Full Art est préférée |
| `Data` | **`RandomCard-List` et `RandomCard-Filter` uniquement** : la liste ou les critères de la carte tirée (voir 5.1.5). **`Currency` uniquement** : l'`ID` de la monnaie (`AllaysCurrency`), seul nom accepté — son nom et sa texture viennent de `data/illager_shop/illager_currencies.json`. **`Booster` uniquement, facultatif** : l'extension qui reçoit le pack (`"A1"`), le sélecteur disparaît alors |

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

### 5.1.5 `RandomCard-List` et `RandomCard-Filter`

Deux `Type` donnent **une carte tirée au moment du claim**, et non une carte écrite dans le fichier.
Toute la mécanique vit dans `js/business/RandomCardReward.js`, partagée avec les codes.

```json
{ "Type": "RandomCard-List", "Qte": 1,
  "Data": { "ListCard": ["SERIE-A1 _ W001_classic", "SERIE-A1 _ W002_classic"] } }

{ "Type": "RandomCard-Filter", "Qte": 1,
  "Data": { "Rarities": [4], "layouts": ["fullart"], "Sets": ["A1"], "BePromo": false } }
```

| Champ de `Data` | Rôle |
|---|---|
| `ListCard` | clés de collection (`<id>_<layout>`, la clé que stocke `collection`), pas des `Index` |
| `DefaultLayout` | liste vide : « n'importe quelle carte imprimée ainsi » (`classic` ou `fullart`) ; sans lui, toutes les impressions sorties |
| `Rarities` | raretés acceptées (1 à 5) ; vide = toutes |
| `layouts` | `classic`, `fullart` (`normal` accepté pour `classic`) ; vide = les deux |
| `Sets` | extensions, écrites `A1`, `A1-Promo` ou `PROMO-A1` ; vide = toutes |
| `BePromo` | `true` : uniquement les cartes promo ; `false` : uniquement celles des extensions. Un set écrit sous sa forme promo force les promos |

**Le tirage** : jusqu'à 10 cartes **distinctes** parmi les impressions sorties qui correspondent
(mélangées, jamais les dix premières du catalogue), puis une carte tirée **uniformément** : chaque
carte différente de la réserve a exactement la même chance, quel que soit son nombre d'impressions.
Une réserve de trois cartes ne change donc pas les probabilités, elle change le nombre de visuels.

**La roue** : les cartes de la réserve remplissent une bande de 26 cases (répétées si la réserve en
compte moins de cinq), la carte gagnante est posée près de la fin, et la bande défile cinq secondes
avant de s'arrêter sous le repère. Le tirage et l'écriture ont lieu **avant** l'animation : la carte
montrée est celle qui est déjà dans la sauvegarde, l'animation ne peut donc jamais être rejouée pour
obtenir une autre carte, et la fermer ne coûte rien.

### 5.1.6 `Image`, `Mode` et `HiddenBeforeUnlock`

| Champ | Rôle |
|---|---|
| `Image` | image de **fond du plateau** des jours, **floutée** et affichée une seule fois derrière la grille : URL absolue (`https://…`, comme les illustrations distantes) ou chemin du projet. Absent ou vide : `assets/icons/icon-192.png` |
| `Mode` | `"progressive"` (défaut, voir 5.2.1) ou `"defined"` : la récompense appartient au **jour du calendrier**, un jour manqué est perdu |
| `HiddenBeforeUnlock` | `true` : les récompenses **encore devant** le joueur sont masquées (icône `assets/icons/favicon-48.png`, « Récompense cachée », description « Récompense cachée, réclamer cette récompense pour savoir et obtenir »). La récompense du jour, elle, reste visible. `false` (défaut) : tout est visible |

---

## 5.2 La série : avancer sans repartir de zéro

La progression est **par chapitre** : chaque chapitre a sa run dans
`user_state["dailyRewards"].chapters[<ID>]`, donc deux séries ouvertes avancent indépendamment (la
forme exacte de l'état est décrite dans `database.md` § 3.17).

### 5.2.1 Les deux modes

| Mode | Position du jour | Jour manqué |
|---|---|---|
| `progressive` (défaut) | `progress`, le nombre de récompenses déjà prises : la série avance **au claim** | rien n'est perdu : la connexion suivante prend la récompense suivante |
| `defined` | le **jour du calendrier** dans la fenêtre (jour 1 = `Start`) | la récompense de ce jour est **perdue** : se connecter les jours 3, 5 et 7 donne 3, 5 et 7 |

Un chapitre `defined` mémorise les jours récupérés (`claimedDays`) : la case d'un jour passé non
réclamé est marquée `missed` (très atténuée), et réclamer un jour déjà pris est refusé
(`ALREADY_CLAIMED`). En mode `progressive`, la série est portée par `progress`, pas par le calendrier.

| Situation (`progressive`) | Résultat |
|---|---|
| Lundi, premier jour | `progress = 0` → récompense du jour 1 ; `progress` passe à 1 |
| Mardi, journée manquée | rien ne change : la récompense du jour 2 reste à prendre |
| Mercredi, connexion | récompense du **jour 2** ; `progress` passe à 2 |
| Deux semaines d'absence | la série reprend où elle s'était arrêtée, pas à zéro |
| Nouveau chapitre | aucune run dans `chapters` → `progress` repart à 0 |
| Deuxième claim le même jour UTC | refusé (`ALREADY_CLAIMED`) : `lastClaimDay` du chapitre |
| Claim dans une autre série ouverte le même jour | accepté : chaque chapitre a son `lastClaimDay` |

Un code personnel (`useritem`, voir `.docs/gamemaster/useritemcode.md`) peut avancer la série sans
rien créditer : le type `dailyreward` déplace `progress` du nombre de jours porté par la quantité du
code, **sur chaque chapitre `progressive` ouvert** (un chapitre `defined` est lié au calendrier,
donner des jours n'y aurait aucun sens). Les récompenses des jours sautés sont perdues,
`lastClaimDay` n'est pas touché (la récompense de la nouvelle position est donc réclamable tout de
suite) et le code reste à usage unique.

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

**Choix des séries** : une seule série ouverte, le bouton ouvre directement son plateau. Plusieurs,
une popup de **choix des séries** s'interpose (même geste que la liste des binders de la
collection) : une ligne par chapitre, son image **floutée** en fond, son nom, « Jour X sur Y » et un
badge « À récupérer » / « Récupérée aujourd'hui ». Aucune série ouverte : le plateau annonce la
**prochaine** (`daily.upcoming`), jamais une série terminée ; s'il n'y en a aucune, il l'indique
(`daily.empty`).

Le tableau affiche une case par jour, avec le numéro du jour et l'icône de la récompense :

| État | Rendu |
|---|---|
| Récupérée | case atténuée, coche verte |
| Aujourd'hui | case en surbrillance, halo pulsé, seule réclamable |
| À venir | case neutre ; cliquer dessus l'affiche en aperçu sous le tableau |
| Manquée (`defined`) | case très atténuée : le jour est passé |
| Cachée (`HiddenBeforeUnlock`) | icône `assets/icons/favicon-48.png` ; l'aperçu dit « Récompense cachée » |

**Fond du plateau** : l'image `Image` du chapitre est affichée **une seule fois**, **floutée**,
comme fond de la grille des jours — un plateau appartient à sa série. Le flou est léger et l'image
reste bien visible (0,62) : c'est un décor que le joueur doit reconnaître, et les cases ont leur
propre surface par-dessus. Sans `Image`, l'icône de l'application (`assets/icons/icon-192.png`) sert
de fond.

**Sections du dialogue** : badge, titre, ligne du chapitre et barre de progression, **aperçu du
jour, plateau**, boutons. La colonne est un `flex` avec un `gap` régulier (`--space-3`), le plateau
et l'aperçu portent une bordure, et le pied d'actions garde sa bande collante : chaque partie se lit
séparément. L'aperçu passe **avant** le plateau (`ensureMarkup` de `DailyRewardPopup`) justement
pour qu'il soit visible dès l'ouverture : trente jours de plateau repoussent tout ce qui les suit
sous la bande d'actions, et le joueur devait faire défiler pour lire sa récompense du jour.

**Une seule zone de défilement** : le dialogue. Le plateau affiche ses trente jours en entier et
ne défile pas de son côté (`max-height` et `overflow-y` retirés de `.daily-reward__days`) : deux
barres dans la même popup, c'est deux endroits où glisser, et le pouce tombe rarement sur celui
qu'on visait. En portrait comme en paysage, c'est donc le dialogue qui défile, sous sa bande de
titre et au-dessus de sa bande d'actions, toutes deux `sticky` (`css/components/modal.css`) : le
titre, la croix et les boutons restent à leur place pendant que les jours passent.

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

**Aperçu d'une carte** : quand le jour affiché sous le tableau donne une carte, son aperçu montre
la **miniature de la carte**, qui est un bouton : un appui l'ouvre en grand dans
`CardDetailPopup` (`js/UI/components/CardDetailPopup.js`), la vue partagée avec l'Illager Shop —
illustration dans la fenêtre du foil, halo de la rareté, inclinaison à la souris ou au doigt, et
l'interrupteur « Effets ». L'aperçu reste disponible pour un jour à venir : on peut regarder la
carte avant le jour du claim.

**Animation de claim** : différente selon la nature du cadeau — une apparition avec éclat pour un
objet, une secousse dorée pour un booster, un retournement avec halo rose pour une carte. Elle dure
1,7 s, puis le tableau est redessiné. Le son est celui des notifications de l'interface.

**Carte au hasard** : la case ne peut pas montrer une illustration, la carte n'existant pas encore.
Elle est dessinée (rect arrondi + « ? ») et prend la couleur de l'information : l'encre du thème pour
une liste ou pour un filtre dont la meilleure rareté est une rareté ordinaire, puis violet (3), or (4)
et rose (5) selon la rareté la plus haute du filtre. La description du jour annonce « 1 carte au
hasard », jamais un nom.

**Roulette** (`js/UI/components/CardRoulettePopup.js`) : une récompense `RandomCard-List` ou
`RandomCard-Filter` ne joue pas l'animation ci-dessus. Après l'écriture, une popup par-dessus la
popup affiche une bande de cartes qui défile cinq secondes (un appui l'arrête tout de suite), puis
révèle la carte obtenue, sa rareté et si elle est **nouvelle** ; le mode focus retire la coquille de
l'application pendant tout l'épisode, comme pour une ouverture de booster ou un Mine Pick.

**Choix de l'extension** (récompense `Booster`) : la popup demande sur quelle extension utiliser le
pack **au moment du claim**. S'il n'y a qu'une extension sortie, elle est choisie sans rien
demander. La liste ne contient que les extensions **sorties** (`listBoosterSets()`), jamais une
extension annoncée.

---

## 5.4 Règles et garde-fous

- **Un claim par jour UTC et par chapitre**, décidé par le `lastClaimDay` du chapitre et re-vérifié
  **à l'intérieur** de la transaction : deux onglets ouverts ne peuvent pas réclamer deux fois, mais
  deux séries ouvertes peuvent l'être le même jour.
- **Un jour de connexion, un seul compteur** : réclamer dans deux séries le même jour incrémente
  `stats.daysConnected` une seule fois, alors que les deux récompenses sont bien créditées.
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
- **Nouvelle série** : un chapitre sans run dans `chapters` en démarre une à 0, sans toucher aux
  autres séries (l'écriture a lieu au premier claim ou à la première ouverture de sa popup).

---

## 5.5 Validation

La règle `data/daily-rewards` du linter refuse, entre autres : un chapitre sans `ID` ou déclaré
deux fois, une fenêtre absente, vide ou dans le mauvais ordre, une date qui n'existe pas, deux
entrées pour le même `Day`, plusieurs entrées par défaut, un `Qte` non positif, un `Type` inconnu,
un `CardID` qu'aucun catalogue ne déclare, un `UniqueID` réutilisé, un `Unique` sans identifiant ou
sans remplacement, une clé de `ListCard` qui ne correspond à aucune impression, une `Rarities` hors de
1 à 5, un `layouts` inconnu, un `Mode` qui n'est ni `progressive` ni `defined`, un
`HiddenBeforeUnlock` non booléen, une `Image` vide ou pointant un fichier absent du projet. Elle
avertit sur un jour manquant dans la numérotation.

```bash
node tools/lint.mjs --only data/daily-rewards
```

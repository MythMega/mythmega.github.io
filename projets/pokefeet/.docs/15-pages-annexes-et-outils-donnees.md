# 15 — Pages annexes et outils de données

## 1. Page d'accueil (`index.html`)

Rôle : hub de navigation + bandeau d'actualités.

### 1.1 Navigation

| Lien | Destination |
|---|---|
| Daily Challenge | `daily.html` |
| Weekly Challenge | `weekly.html` |
| Défis passés | `old_challenges.html` |
| Challenges Bonus | `list_challenges.html` |
| Challenges Custom | `custom.html` |
| Marathon | `marathon.html` |
| Historique | `history.html` |
| Pokédex | `dex.html` |
| Paramètres | `settings.html` |
| Profile | `profile.html` |

### 1.2 Bandeau d'actualités

Script inline :

- `SHEET_ID = '1ACLXY7DR2KBreQJNVyJZ9FeH4YX2j736FNWiSaQp-Hc'`, `GID = '398219060'` ;
- fetch `https://docs.google.com/spreadsheets/d/<id>/export?format=csv&gid=<gid>` ;
- parse la première ligne FR et la deuxième EN ;
- choisit la langue courante ;
- affiche `#newsBanner` / `#newsBannerText`, avec une durée d'animation proportionnelle à la longueur ;
- échec silencieux.

**Risques** : dépendance à un document Google public, pas de cache, pas de fallback visible, contenu non fiable injecté via `textContent` (donc pas de XSS).

### 1.3 Autres scripts

`Cosmetics.load()` est appelé une seconde fois au `DOMContentLoaded` (en plus de `js/ui/loader.js`).

---

## 2. Défis passés (`old_challenges.html`)

Page calendrier des Daily et Weekly déjà disponibles.

- Onglets Daily/Weekly.
- Lit `daily_results` et `weekly_results`.
- Détermine la plus ancienne date connue (`ChallengeWindow.firstDateOf`, `js/core/challenge-window.js`) : c'est exactement la limite que `daily.js` et `weekly.js` acceptent dans l'URL.
- Daily : itère du plus ancien à aujourd'hui, un bouton par jour, classe `played`/`available`, lien `daily.html?date=...`.
- Weekly : itère de la plus ancienne semaine au lundi courant, lien `weekly.html?week=...`.
- Si aucune donnée : message `#noDailies`.

Limites :

- La liste s'arrête à aujourd'hui : impossible de voir un daily futur.
- Aucun tri ni filtre.
- `getAllFromStore` charge tout le store à chaque onglet.
- Les dates sont locales.

---

## 3. Changelog (`changelog.html`)

Page statique qui lit `data/changelog.json` (aucun HTML manuel des entrées) :

```json
{
  "Version": { "Major": 6, "Minor": 0, "Patch": 0, "Stage": "Release" },
  "Title": "Mega Evolution",
  "Date": "24/10/2026",
  "Changelog": [
    { "Type": "Content", "Severity": 3, "Translation_FR": "...", "Translation_EN": "..." }
  ]
}
```

- `Stage` vaut `Release`, `Beta` ou `Alpha` : il détermine la couleur et le libellé du badge (`v6.0.0`, `Beta 1.5`, `Alpha 1.9`).
- `Type` vaut `Feature` (or), `Quality Of Life` (bleu), `Content` (vert) ou `Fix` (blanc) : la couleur du texte de la ligne suit (`type-feature`, `type-quality-of-life`, `type-content`, `type-fix`).
- `Severity` va de 1 à 3 et pilote la graisse de la police de la ligne (`severity-1/2/3`).
- Le texte affiché est `Translation_FR` ou `Translation_EN` selon la langue courante.
- Les versions sont triées par date décroissante, puis par version décroissante (Release > Beta > Alpha).

---

## 4. Crédits (`credits.html` + `js/features/credits/credits.js`)

- Charge `data/credits/`.
- `TranslationsFR`/`TranslationsEN` fournissent les libellés de types.
- `Credits` : 15 personnes, avec `Person`, `Types[]`, `Image`, `Buttons[]`, `FunctionFR/EN`.
- `renderTabs()` construit un onglet par type (Coder, Artist, etc.).
- `renderCreditsGrid(filterType)` affiche les cartes filtrées.
- Images distantes (Twitch, sites personnels) : dépendance réseau.

---

## 5. Visualiseur de données (`data.html`)

Page autonome avec ~250 lignes de JS inline.

### 5.1 Fonctionnalités

- Charge `./data/pokemons_wip.json` ; si absent, fallback sur `pokemons.json` et affiche `#dvRealDataNotice`.
- Colonnes : Image, FullImage, Index, NameFR, NameEN, Generation, Type1, Type2, EggGroups, Category, Version.
- Filtre par colonne + valeur (sous-chaîne).
- Tri par colonne (asc/desc), types numériques ou texte.
- Compteur `N / total`.
- Gestion d'erreur d'image (`onerror` → badge « Image manquante »).
- Traductions via `Translator` et `applyTranslations`.

### 5.2 Constat

`pokemons_wip.json` **n'existe pas** dans le dépôt : la page affiche donc toujours les données de production avec le bandeau d'avertissement. C'est un outil de travail interne, non lié depuis la navigation principale (seulement le footer).

---

## 6. Prédictions (`prediction.html`)

Page protégée par mot de passe, non liée depuis l'application.

### 6.1 Protection

- Overlay `#overlay`, input `#pw-input`, bouton `#pw-btn`.
- Hash SHA-256 identique aux modes de jeu (`PASSWORD_HASH`).
- Succès : cache l'overlay, affiche `#main`, lance `init()`.
- Échec : message + animation `shake`.

Cette protection est **côté client** : le code et les données sont accessibles sans mot de passe via le code source. Ce n'est pas une sécurité.

### 6.2 Fonctionnalités

- Onglets Daily / Weekly.
- `DAYS_AHEAD = 3650`, `DAILY_COUNT = 5`, `WEEKLY_COUNT = 10`.
- Recalcule les listes futures avec les mêmes algorithmes que `js/features/daily/daily.js`/`js/features/weekly/weekly.js` (seed date / `'week' + lundi`).
- Affiche les images partielles des Pokémon à venir.
- Recherche multi-mots (ET), insensible aux accents, sur FR/EN.
- Surligne les Pokémon correspondants.
- Statistiques de résultats.

### 6.3 Duplication

La page réimplémente :

- `mulberry32`, `stringToSeed`, `shuffleWithSeed` ;
- `getAvailablePokemons` / `getVersionData` ;
- `getDailyListForDate`, `getWeeklyListForDate` ;
- `getMondayOfWeek`, `dateToStr`, `formatDateFR`, `formatWeekLabelFR` ;
- la protection par hash.

Toute évolution de l'algorithme doit être répliquée ici, sinon les prédictions divergent.

---

## 7. Intégration (`integration-pokefeet.html`)

Page statique, sans script, non liée. Elle décrit probablement une intention d'intégration (iframe/badge) mais n'est pas utilisée par l'application. À classer comme orpheline (voir doc 16).

---

## 8. Test i18n (`test-i18n.html`)

Page de test manuel du système de traduction :

- charge `js/i18n/translate.js`, `js/i18n/language-switcher.js`, `js/i18n/setup.js` ;
- affiche des clés, des attributs traduits, des valeurs de fallback.

Elle n'est pas liée et ne fait pas partie du produit. Utile comme référence de test, mais candidate à la suppression ou au déplacement dans un dossier de tests.

---

## 9. Outils Python et artefacts de données

### 9.1 Scripts

| Fichier | Rôle apparent | Référencé au runtime |
|---|---|---|
| `data/poke_data.py` | accès aux données éclatées : chargement fusionné, re-découpage et manifestes | non |
| `data/analyse_challenges.py` | analyse des challenges | non |
| `data/analyze_prices.py` | somme des prix des cosmétiques | non |
| `data/analyze_cosmetics_icon.py` | vérification des images de cosmétiques | non |
| `data/add_file.py` | calcul du champ `File` des cosmétiques créatifs | non |
| `data/egggroup-category.py` | enrichissement groupes d'œuf/catégorie | non |
| `data/newpic.py` | génération/renommage d'images | non |
| `data/setversion.py` | mise à jour de `version.json` | non |
| `scripts/add_egg_category.py` | ajout de catégories d'œuf | non |
| `scripts/add_fullimage.py` | ajout des images complètes | non |
| `scripts/fetch_egg_category.py` | récupération des catégories | non |
| `img/autoname.py` | renommage d'images | non |
| `img/fullsprite/download_full_image.py` | téléchargement des sprites complets | non |

Ces scripts constituent la **chaîne de production des données**. Ils ne sont ni documentés ni testés dans le dépôt, et certains chemins sont probablement spécifiques à la machine de l'auteur.

### 9.2 Artefacts non lus

| Fichier | Statut |
|---|---|
| `data/backup.json` | sauvegarde historique, non lue par le code |
| `data/new_backup.json` | idem |
| `data/result_analyse_challenge.log` | log d'analyse |
| `cover.png` | visuel, non référencé dans les pages |
| `trophies.md` | documentation ancienne |
| `README_I18N.md`, `I18N_DOCUMENTATION.md` | documentation i18n ancienne |
| `docs/` (17 fichiers) | documentation antérieure, partiellement obsolète |

---

## 10. Graphe des liens de pages

```text
index.html
├── daily.html
├── weekly.html
├── old_challenges.html ──► daily.html?date / weekly.html?week (fenêtre rejouable : premier défi enregistré → aujourd'hui)
├── list_challenges.html ──► challenge.html
├── custom.html ──► custom_create.html / custom_play.html
├── marathon.html
├── history.html
├── dex.html
├── settings.html
└── profile.html

footer (toutes pages de jeu)
├── index.html
├── data.html
├── changelog.html
└── credits.html

Pages sans lien entrant :
├── prediction.html (protégée)
├── integration-pokefeet.html
└── test-i18n.html
```

---

## 11. Recommandations

1. **Déplacer** `prediction.html`, `data.html`, `test-i18n.html` dans un dossier `tools/` non déployé, ou les supprimer.
2. **Décider** du sort de `integration-pokefeet.html` et `profile.html`.
3. **Documenter ou supprimer** les scripts Python ; si conservés, les isoler dans `tools/data-pipeline/` avec un README et des dépendances.
4. **Supprimer** `backup.json`, `new_backup.json`, les logs et CSV s'ils ne servent plus.
5. **Remplacer** le bandeau Google Sheets par un JSON local versionné, ou assumer la dépendance.
6. **Unifier** les algorithmes de prédiction avec les modules de jeu (une seule source de vérité).
érité).

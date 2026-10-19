# 15 — Pages annexes et outils de données

## 1. Page d'accueil (`index.html`)

Rôle : hub de navigation + bandeau d'actualités.

### 1.1 Navigation

| Lien | Destination |
|---|---|
| Daily Challenge | `daily.html` |
| Weekly Challenge | `weekly.html` |
| Défis passés | `old_daily.html` |
| Challenges Bonus | `list_challenges.html` |
| Challenges Custom | `custom.html` |
| Marathon | `pokefeet.html` |
| Historique | `history.html` |
| Pokédex | `pied-dex.html` |
| Paramètres | `data_management.html` |
| Profile | `stats.html` |

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

`Cosmetics.load()` est appelé une seconde fois au `DOMContentLoaded` (en plus de `loader.js`).

---

## 2. Défis passés (`old_daily.html`)

Page calendrier des Daily et Weekly déjà disponibles.

- Onglets Daily/Weekly.
- Lit `daily_results` et `weekly_results`.
- Détermine la plus ancienne date connue.
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

Page statique, sans logique métier. Contient un `<h1>` et un lien retour. Les entrées sont du HTML manuel. Aucune source de données, aucune génération automatique.

---

## 4. Crédits (`credits.html` + `credits.js`)

- Charge `data/credits.json`.
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
- Recalcule les listes futures avec les mêmes algorithmes que `daily.js`/`weekly.js` (seed date / `'week' + lundi`).
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

- charge `translate.js`, `language-switcher.js`, `i18n-setup.js` ;
- affiche des clés, des attributs traduits, des valeurs de fallback.

Elle n'est pas liée et ne fait pas partie du produit. Utile comme référence de test, mais candidate à la suppression ou au déplacement dans un dossier de tests.

---

## 9. Outils Python et artefacts de données

### 9.1 Scripts

| Fichier | Rôle apparent | Référencé au runtime |
|---|---|---|
| `data/analyse_challenges.py` | analyse des challenges | non |
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
| `data/pokefeet_commits.csv` | données de suivi |
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
├── old_daily.html ──► daily.html?date / weekly.html?week
├── list_challenges.html ──► challenge.html
├── custom.html ──► custom_create.html / custom_play.html
├── pokefeet.html
├── history.html
├── pied-dex.html
├── data_management.html
└── stats.html

footer (toutes pages de jeu)
├── index.html
├── data.html
├── changelog.html
└── credits.html

Pages sans lien entrant :
├── profile.html (redirection)
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

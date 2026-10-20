# 13 — Profil, cosmétiques et sauvegarde

## 1. Page Paramètres (`data_management.html`)

La page regroupe quatre onglets :

| Onglet | Panneau | Contenu |
|---|---|---|
| Paramètres | `#dmPanelParams` | mode rapide |
| Personnalisations | `#dmPanelCustomize` | cosmétiques (fonds / boutons) |
| Profil | `#dmPanelProfile` | pseudo |
| Données | `#dmPanelData` | export, import, imports manuels, suppression |

Le compteur `#dmCountLabel` affiche le libellé de l'onglet actif.

---

## 2. Profil

### 2.1 Stockage

Cookie `pk_pseudo`, 365 jours. Aucun compte, aucune synchronisation.

### 2.2 Saisie

Dans `data_management.html`, un script inline (et non `js/features/settings/profile.js`) gère :

- préremplissage depuis le cookie ;
- validation : non vide, ≤ 30 caractères ;
- sauvegarde / effacement ;
- `Enter` déclenche la sauvegarde ;
- messages dans `#profileStatus`.

### 2.3 Affichage

`js/features/stats/stats.js` :

- `#statsPseudo` = cookie ou `—` ;
- `#statsPseudoLabel` = titre du plus haut palier de récompense débloqué ;
- `#profileBadges` = badges débloqués.

`custom-create-ui.js` préremplit le champ auteur avec le pseudo.

### 2.4 `js/features/settings/profile.js` est mort

`stats.html` charge `js/features/settings/profile.js`, mais :

- `ProfileInit()` n'est jamais appelé ;
- aucun élément `#pseudoInput`, `#savePseudoBtn`, `#clearPseudoBtn`, `#profileStatus` n'existe sur `stats.html` ;
- `COOKIE_NAME` n'est lu nulle part.

`profile.html` est une simple redirection meta vers `data_management.html`. Voir doc 16.

---

## 3. Mode rapide

Cookie `pk_fast_mode` (`true`/`false`), réglé par `#fastModeToggle`.

- `js/features/marathon/game.js` lit le cookie via `isFastMode()`.
- En mode rapide, le Marathon enchaîne après 400 ms sans écran de révélation.
- Aucun autre mode n'est concerné.
- Le libellé du statut (`#fastModeStatus`) est codé en dur en français.

---

## 4. Cosmétiques

### 4.1 Catalogue

`data/cosmetics.json` : 39 entrées.

| Type | Nombre | Usage |
|---|---:|---|
| `Background` | 30 | classe CSS sur `<body>` |
| `Background-Buttons` | 9 | classe CSS sur `[data-tag="customizables-button"]` |

Catégories : `Games` 12, `Event` 11, `Collection` 5, `Strat` 5, `Regional` 4, `null` 2.

Champs : `ID`, `Type`, `Cat`, `Name`, `Value`, `File`, `RequiresUnlock`, `MustHideIfUnobtained`.

### 4.2 Déblocage

`Cosmetics.loadUnlockedCosmetics()` :

1. `ChallengeStorage.getAllCompletions()`.
2. `bonus_challenges.json`.
3. Pour chaque challenge complété, chaque `Rewards[].TypeReward === 'Cosmetic'` ajoute `Value` à `unlockedIds`.

Un cosmétique `RequiresUnlock: true` est verrouillé tant que son ID n'est pas dans `unlockedIds`. 37 cosmétiques sont verrouillés.

### 4.3 Sélection

Cookies :

- `pk_cosmetic_bg` : `Value` du fond, ou `null`/`default` pour le fond par défaut ;
- `pk_cosmetic_btn` : idem pour les boutons.

`Cosmetics.select(type, value)` :

- écrit le cookie ;
- `applyCosmetics()` ;
- appelle `window.renderCosmetics()` si présent (re-rendu de la grille).

### 4.4 Application

`applyCosmetics()` :

1. Retire toutes les classes `Background` connues de `<body>`.
2. Ajoute la classe du fond sélectionné.
3. Retire toutes les classes `Background-Buttons` des boutons `[data-tag="customizables-button"]`.
4. Ajoute la classe du bouton sélectionné à tous ces boutons.

`js/ui/loader.js` appelle `Cosmetics.load()` avant de masquer l'overlay, ce qui applique les cosmétiques sur **toutes** les pages.

### 4.5 UI

Deux implémentations :

- `data_management.html` (inline) : onglets de catégories, sous-onglets par `Cat`, option « Défaut », cadenas, `sessionStorage` pour la catégorie active ;
- `js/features/settings/cosmetics.js` : `renderCosmeticsUI()` — **jamais exposée ni appelée** (voir doc 16).

### 4.6 Limites

- Les cosmétiques ne sont pas exportés dans la sauvegarde.
- Un cosmétique débloqué n'est pas daté.
- `MustHideIfUnobtained` n'est respecté que par l'UI inline, pas par `Cosmetics.isUnlocked`.
- Les classes CSS doivent exister dans `styles/cosmetics.css` ; un `Value` inconnu n'a aucun effet visible.

---

## 5. Sauvegarde / restauration

Voir doc 04 pour le format et les règles de fusion. Résumé des actions de la page :

| Contrôle | Action |
|---|---|
| `#exportBtn` | génère et télécharge `pokefeet_save_<timestamp>.txt` |
| `#importFile` | lit un `.txt`, vérifie le hash, fusionne |
| `#previewBtn` | affiche le payload courant dans `#dataPreview` |
| `#dailyImportArea` + `#importDailyBtn` | importe un Daily depuis un texte emoji |
| `#clearDailyArea` | vide la zone |
| `#weeklyImportArea` + `#importWeeklyBtn` | importe un Weekly |
| `#clearWeeklyArea` | vide la zone |
| `#deleteBestBtn` | supprime `pk_best` et `pk_best_streak` |
| `#deleteDailyBtn` | vide `daily_results` |

### 5.1 Règles d'import

- **Daily** : conflit date par date, `confirm()` pour choisir fichier ou cookie.
- **Weekly** : ajout des dates absentes uniquement, pas de conflit.
- **Marathon** : maximum des records.
- **Challenges** : ajout des complétions absentes.
- **Dex** : reconstruction des listes et `markFound` (bug : toute la liste, pas seulement les gagnants).

### 5.2 Commandes spéciales

`!DEL:YYYY-MM-DD` dans la zone Daily supprime l'entrée.

### 5.3 Suppressions non couvertes

Aucun bouton pour :

- supprimer `weekly_results` ;
- supprimer le Dex ;
- supprimer les complétions de challenges ;
- supprimer le pseudo, la langue, les cosmétiques (sauf via les contrôles dédiés) ;
- réinitialiser entièrement l'application.

---

## 6. Problèmes connus

| Problème | Détail |
|---|---|
| Duplication profil | inline dans `data_management.html` + `js/features/settings/profile.js` mort |
| Duplication cosmétiques | inline dans `data_management.html` + `Cosmetics.renderCosmeticsUI()` mort |
| Textes non traduits | mode rapide, profil inline, `Niveau` |
| Export incomplet | pseudo, cosmétiques, langue, mode rapide, Dex |
| Hash non cryptographique | FNV-1a |
| Conflits Weekly | silencieusement ignorés |
| Dex à l'import | marque aussi les échecs |
| `clear + put` | perte multi-onglets |
| Pas de validation de fichier | un JSON valide mais malformé passe |
| `importedInDex` | remis à `false` par les réécritures |

---

## 7. Checklist de test manuel

1. Pseudo : vide, > 30 caractères, sauvegarde, effacement, `Enter`.
2. Pseudo affiché sur Stats et prérempli dans Custom Create.
3. Mode rapide : activation, persistance, effet en Marathon uniquement.
4. Cosmétiques : fonds et boutons, défaut, verrouillés, catégories, sous-onglets.
5. Déblocage après un challenge : cosmétique visible et sélectionnable.
6. Persistance des cosmétiques après rechargement et navigation.
7. Export : fichier téléchargé, en-tête, hash.
8. Import : fusion Daily avec conflit (OK/Annuler), Weekly, records, challenges.
9. Import d'un fichier modifié : refus.
10. Import Daily manuel : format long et mini, score recalculé, `!DEL`.
11. Import Weekly manuel : 10 lignes / mini.
12. Suppression best score, Daily.
13. Aperçu du payload.
14. Deux onglets : vérifier la perte de données potentielles.

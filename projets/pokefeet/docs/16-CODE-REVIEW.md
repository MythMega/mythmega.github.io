# 16 — Revue globale du code (qualité)

> Revue statique du dépôt, sans exécution de la logique métier.
> Mesures obtenues par scripts (`wc`, `grep`, détection de blocs répétés).
> Date : octobre 2026 · branche `pokefeet/global_save_fix`

---

## 1. Vue d'ensemble

| Mesure | Valeur |
|---|---|
| Pages HTML | 21 |
| Modules JS (IIFE globaux `const X = (function …)`) | 24 |
| Fonctions globales non encapsulées | 5 |
| Lignes JS / CSS / HTML | ~11 600 / ~2 957 / ~4 222 |
| Clés de traduction (fr / en) | 370 / 370 — **parité parfaite** |
| Build / lint / tests | **aucun** (pas de `package.json`, pas de config ESLint/Prettier, 0 test) |
| `console.log` en production | 71 |
| Fonctions > 80 lignes | 19 |
| Blocs de code dupliqués (≥ 3 fichiers) | 103 |

**Architecture** : découpage clair et logique — `business/` (métier), `entity/` (modèles),
`ui/` (vues), `styles/`, `translations/`, `docs/` (16 documents à jour). Le pattern
module IIFE est appliqué de façon cohérente : chaque fichier expose une API publique
explicite et garde son état privé. C'est la meilleure décision d'architecture du projet.

---

## 2. Points forts (à préserver)

- **Pattern module homogène** : 24 modules IIFE, seulement 5 fonctions vraiment globales.
  Pas de pollution du scope global au-delà du nécessaire.
- **Séparation des couches** cohérente avec la documentation, elle-même maintenue (16 fichiers
  `docs/`, dont un par domaine fonctionnel).
- **i18n complet et sain** : 370 clés, aucune clé manquante d'un côté ou de l'autre, système
  `Translator` centralisé, bascule de langue fonctionnelle.
- **Défense en profondeur sur IndexedDB** : `indexedDB.open()` encadré par un timeout de 5 s,
  gestion de `onblocked` et de `versionchange`, dégradation gracieuse (« running without DB »).
  C'est un bon réflexe pour un jeu qui doit rester jouable si la base est indisponible.
- **Pas de `eval`, `document.write` ni `new Function`** : aucune exécution de code arbitraire.
- **Contenu utilisateur rendu via `textContent`** dans l'immense majorité des cas
  (nom du joueur, noms de Pokémon, codes de challenge).
- **Codec de challenge custom** (`custom-challenge-codec.js`) : format versionné (marqueur `1`
  compressé / `2` brut), repli automatique si `CompressionStream` est absent, validation stricte
  à la décodabilité, `try/catch` avec retour `null`. C'est le module le mieux écrit du projet.
- **Journalisation étiquetée** (`[Daily]`, `[Dex]`, `[Migration]`…) : cohérente et facile à filtrer.

---

## 3. Problèmes par ordre d'impact

### 3.1 Duplication massive (impact : élevé)

Le même code est copié-collé dans de nombreux fichiers. 103 blocs de 6 lignes apparaissent
dans au moins 3 fichiers.

- **Helper IndexedDB `getDB()`** : copie quasi identique dans
  [daily.js](../daily.js), [weekly.js](../weekly.js), [data.js](../data.js),
  [history.js](../history.js), [history_curve.js](../history_curve.js),
  [stats.js](../stats.js), [Dex.js](../Dex.js), [old_daily.js](../old_daily.js)
  — plus des variantes en littéral dans
  [business/challenge-manager.js](../business/challenge-manager.js#L87) et
  [entity/challenge.js](../entity/challenge.js#L167).
  Les seules différences sont le nom du store et la mise en forme.
  Le commentaire `// --- IndexedDB helpers (mirror from data.js) ---` dans `daily.js`
  documente lui-même la copie.
- **Générateur pseudo-aléatoire déterministe** (`mulberry32`, `stringToSeed`,
  `shuffleArrayWithSeed` / `seededShuffle`) : dupliqué dans
  [daily.js](../daily.js), [weekly.js](../weekly.js), [game.js](../game.js),
  [DailyToDexImport.js](../DailyToDexImport.js) et
  [business/challenge-manager.js](../business/challenge-manager.js).
  **Cinq copies d'un algorithme qui doit produire exactement le même résultat** : si l'une
  dérive, les listes Daily/Weekly ne correspondront plus entre la page de jeu et l'import Dex.
- **`showNotification()`** : 7 implémentations quasi identiques
  ([ui.js](../ui.js), [daily.js](../daily.js), [weekly.js](../weekly.js),
  [migration.js](../migration.js), `ui/challenge-game-ui.js`,
  `ui/custom_challenges/custom-play-ui.js`, `ui/custom_challenges/custom-create-ui.js`).

**Recommandation** : extraire trois modules partagés —
`core/pokefeet-db.js` (accès IndexedDB générique + les 3 bases de l'app),
`core/prng.js` (tirage déterministe), `ui/notifications.js` — et faire pointer les
consommateurs dessus. Gain estimé : ~400 lignes supprimées et une seule source de vérité.

### 3.2 Aucun outillage (impact : élevé sur le long terme)

Pas de `package.json`, pas de linter, pas de formateur, aucun test. Conséquences concrètes :
les incohérences de style ne sont pas détectées, aucune régression ne peut être attrapée
automatiquement, et chaque modification repose sur une vérification manuelle en navigateur.

**Recommandation** : ajouter un `package.json` minimal (serveur local + ESLint + Prettier),
puis un test de fumée par page (ouvrir chaque page, vérifier l'absence d'erreur console et
la présence des éléments clés). C'est le meilleur rapport effort/bénéfice du projet.

### 3.3 Numéros de version magiques (impact : moyen — risque de bug)

La version IndexedDB `4` est écrite en dur dans plusieurs littéraux
(`indexedDB.open('PokefeetDB', 4)` dans `business/challenge-manager.js` lignes 87 et 111,
`entity/challenge.js` lignes 167 et 193, `DailyToDexImport.js` ligne 87) alors qu'ailleurs
elle vient d'une constante `DB_VERSION` ou de `TARGET_VERSION`.

**Risque** : lors d'une future migration de schéma, un seul oubli fait échouer silencieusement
une lecture (la base ouvre une version inférieure au schéma attendu).

**Recommandation** : centraliser dans `core/pokefeet-db.js` et supprimer toute constante
numérique dupliquée.

### 3.4 i18n incomplet malgré une base saine (impact : moyen, visible par l'utilisateur)

Les 370 clés sont parfaitement synchronisées, mais **plusieurs chaînes restent en français
en dur dans le JS**, donc identiques en anglais :

- `'Échecs : '` — [daily.js:336](../daily.js#L336), [weekly.js:506](../weekly.js#L506),
  `ui/challenge-game-ui.js:72`
- Notifications : `'Daily terminé — partagez votre résultat'`,
  `'Échec — Pokémon révélé'`, `'-2 points (indice affiché)'`, `'Passé — Pokémon révélé'`,
  `'Déjà essayé'`, `'Pokémon trouvé : '`, `'Rapport copié ! Ouverture de Discord...'`
- États vides : `'Aucun résultat enregistré pour le moment.'`,
  `'Aucun nouveau Pokémon à ajouter.'`, `'Aucun texte collé.'`, `'Aucun crédit à afficher'`
- Libellés cosmétiques : `'Défaut'`, `'Par défaut'`, `'À débloquer via un challenge'`

**Recommandation** : ajouter les clés manquantes et passer par `Translator.get()`.

### 3.5 Journalisation de production (impact : faible mais bruyant)

71 `console.log` parsèment les chemins normaux (chargement, lectures IndexedDB, rendu).
Ils sont utiles au développement mais polluent la console en production et ralentissent
légèrement le rendu sur mobile.

**Recommandation** : un petit `core/logger.js` avec un niveau activable
(`?debug=1` ou variable locale), et remplacer les `console.log` par `Log.debug(...)`
en conservant les `console.error`/`console.warn` réels.

### 3.6 Fonctions trop longues (impact : moyen sur la lisibilité)

19 fonctions dépassent 80 lignes, les pires :

| Fichier | Fonction | Lignes |
|---|---|---|
| `business/challenge-manager.js` | `computeTotalXP()` | 156 |
| `history_curve.js` | `drawChart()` | 145 |
| `ui/challenge-list-ui.js` | `renderChallengeCards()` | 140 |
| `language-switcher.js` | `createSwitcher()` | 127 |
| `daily.js` | `bindButtons()` | 126 |
| `history_curve.js` | `renderWeeklyStats()` | 126 |
| `stats.js` | `renderDetailedStats()` | 113 |

Ces fonctions mélangent calcul, construction de HTML et liaison d'événements.
**Recommandation** : découper selon l'axe « calcul → rendu → événements ».

### 3.7 Incohérences de style (impact : faible)

- `var` subsiste dans `cosmetics.js` (41), `migration.js` (79),
  `ui/challenge-list-ui.js` (22), `credits.js` (22).
- Indentation mixte : 2 espaces à la racine (`daily.js`, `weekly.js`, `data.js`) contre
  4 espaces dans `business/` et `ui/`. Les blocs imbriqués de la racine utilisent 4 espaces.
- Fins de ligne : **CRLF partout — cohérent**, bon point (à figer via `.gitattributes`).
- Deux `<img>` sans attribut `alt` ; plusieurs champs de saisie sans `<label>` associé.

### 3.8 Code mort et dette résiduelle (impact : faible)

- **`apply-translations.js` : fichier vide (0 octet)**, toujours référencé par
  [challenge.html](../challenge.html#L101) et par la documentation.
  Le travail réel est fait par `i18n-setup.js` (`applyTranslations()`).
- `old_daily.html` / `old_daily.js` : ancien mode Daily, encore atteignable depuis
  [index.html](../index.html). À confirmer : legacy assumé ou oubli ?
- `apply-translations.js` vide + `translate.js` chargé avant `i18n-setup.js` sur **toutes**
  les pages : l'ordre de chargement des scripts est répété à la main dans 21 fichiers HTML,
  sans point d'entrée unique.
- `integration-pokefeet.html` : 0 script, 0 CSS (page statique isolée).

### 3.9 Robustesse réseau hétérogène (impact : moyen)

24 appels `await fetch(` mais seulement 6 vérifications de `res.ok`. Le chargement de
`data/pokemons.json` échoue « proprement » dans `custom-challenge-game.js`
(`if (!res.ok) throw`), mais pas partout ailleurs : un JSON renvoyé en 404 serait
parfois traité comme des données valides (échec plus loin, message d'erreur opaque).

### 3.10 Injection HTML (impact : faible, à surveiller)

Aucun `eval`, et le contenu utilisateur passe par `textContent`. En revanche, du HTML est
construit par template sur des données issues de `data/*.json` ou d'IndexedDB :
`ui/challenge-list-ui.js` (nom et `Additional_Info` du challenge),
`history.js` (lignes d'historique), `history_curve.js`.

Ces données sont produites localement par l'application, donc **le risque est faible**
aujourd'hui. Il deviendrait réel si un jour des challenges étaient importés depuis une
source externe (les codes de challenge custom sont déjà partageables par URL).
**Recommandation** : garder `textContent` pour tout champ d'origine externe.

---

## 4. Plan d'action proposé

| Priorité | Action | Effort | Risque |
|---|---|---|---|
| P1 | Extraire `core/pokefeet-db.js` (IndexedDB partagé) + supprimer les copies | moyen | moyen |
| P1 | Extraire `core/prng.js` (tirage déterministe) — vérifier l'égalité des listes Daily/Weekly avant/après | faible | moyen |
| P2 | Ajouter `package.json` + ESLint + Prettier + `.gitattributes` (CRLF) | faible | nul |
| P2 | Extraire `ui/notifications.js` (7 copies) | faible | faible |
| P2 | Compléter l'i18n (chaînes FR en dur) | faible | faible |
| P3 | `core/logger.js` et retrait des `console.log` de production | faible | faible |
| P3 | Supprimer `apply-translations.js` (vide) et trancher sur `old_daily.*` | faible | faible |
| P3 | Découper les 7 fonctions les plus longues | élevé | moyen |
| P4 | Test de fumée par page | moyen | nul |

---

## 5. Conclusion

La base est **saine pour un projet sans outillage** : architecture claire, modules
encapsulés, i18n réellement maintenu, documentation à jour, et des choix défensifs sur
IndexedDB et sur le décodage des codes de challenge.

Le principal défaut n'est pas la conception mais la **répétition** : les mêmes helpers
recopiés dans 5 à 8 fichiers, dont un tirage aléatoire qui *doit* rester identique partout.
C'est exactement le genre de dette qui produit un jour un bug difficile à reproduire
(un Daily qui ne correspond plus au Dex importé).

La priorité n° 1 reste l'outillage : sans lint ni test, chaque correction dépend d'une
vérification manuelle, et les incohérences de style continueront de se propager.

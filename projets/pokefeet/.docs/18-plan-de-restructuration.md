# 18 — Plan de restructuration

> **Objectif** : passer d'un ensemble de scripts globaux monolithiques à une architecture en couches, testable, sans casser les URLs, les données existantes ni les parcours joueurs.

---

## 0. État au 19/10/2026

La **phase de réorganisation physique** est faite :

- 35 scripts déplacés dans `js/core`, `js/data`, `js/features`, `js/i18n`, `js/ui` ;
- 24 feuilles CSS dans `styles/`, avec `styles/main.css` comme point d'entrée ;
- 21 pages HTML inchangées à la racine ;
- ordre des `<script>` et des CSS identique à l'ancien ;
- contenu JS identique (hors fins de ligne), aucun nom de base/store/cookie modifié ;
- 21 pages chargées et vérifiées dans un navigateur (aucune erreur de chargement d'asset).

Le code n'est **pas encore** converti en modules ES ni découpé en state/controller/view. Les phases ci-dessous restent la cible ; la correspondance `src/` est indicative et peut être adaptée à l'arborescence `js/` déjà en place.

---

## 1. Principes directeurs

1. **Strangler pattern** : construire la nouvelle structure à côté de l'ancienne, migrer page par page, supprimer l'ancien seulement après parité vérifiée.
2. **Compatibilité des données d'abord** : mêmes noms de bases, stores, clés et cookies pendant toute la migration. Aucun utilisateur ne doit perdre sa collection.
3. **URLs stables** : tous les `.html` et paramètres (`?date=`, `?week=`, `?challengeid=`, `?statut=`, `?code=`) restent identiques.
4. **Une règle = une implémentation** : seed, normalisation, scoring, XP, partage, cookies, IndexedDB.
5. **Tests avant déplacement** : les fonctions pures (sélection, scoring, XP, codec, import) doivent être couvertes avant d'être réécrites.
6. **Pas de big bang** : un lot = un domaine = une vérification manuelle.

---

## 2. Décisions d'architecture à valider

| Décision | Option recommandée | Alternatives | Impact |
|---|---|---|---|
| Format des modules | **ES modules natifs** (`<script type="module">`) | IIFE + globals, bundler Vite | imports explicites, pas de build |
| Type d'application | **MPA conservée** | SPA | URLs et SEO préservés |
| Typage | **JSDoc + `// @ts-check`** progressif | TypeScript complet | pas de transpilation |
| Base de données | **schéma v4 conservé** | nouvelle base + migration | compatibilité |
| XP | **calculé** au départ, puis éventuellement persisté | stockage immédiat | simplicité |
| i18n | **maison conservé** | i18next | pas de dépendance |
| CSS | **custom conservé**, Bootstrap retiré à terme | framework | cohérence |
| Tests | **Vitest** (pur) + **Playwright** (pages) | tests manuels | filet de sécurité |

> Recommandation : commencer par **ES modules natifs sans bundler**, car le site est déjà servi par HTTP et n'a aucune étape de build. Un bundler pourra être ajouté plus tard sans changer l'architecture des fichiers.

---

## 3. Architecture cible

```text
/
├── index.html, daily.html, weekly.html, ...      # pages = coquilles + point d'entrée
├── src/
│   ├── core/
│   │   ├── pokemon.js                 # entité + normalisation
│   │   ├── challenge.js
│   │   ├── reward.js
│   │   ├── rules/
│   │   │   ├── rng.js                 # mulberry32, seededShuffle
│   │   │   ├── names.js               # normalize, matchesName
│   │   │   ├── scoring.js             # 10/8/6/4/2/0, indices
│   │   │   ├── selection.js           # daily/weekly/marathon lists
│   │   │   └── xp.js                  # formules d'XP
│   │   └── errors.js
│   ├── data/
│   │   ├── db.js                      # openDB, stores, transactions
│   │   ├── cookies.js
│   │   ├── repositories/
│   │   │   ├── daily-repository.js
│   │   │   ├── weekly-repository.js
│   │   │   ├── dex-repository.js
│   │   │   ├── challenge-repository.js
│   │   │   └── settings-repository.js
│   │   ├── migrations/
│   │   │   ├── index.js
│   │   │   └── v4.js
│   │   └── save-format.js             # export/import, hash, validation
│   ├── features/
│   │   ├── marathon/
│   │   │   ├── session.js
│   │   │   ├── controller.js
│   │   │   └── view.js
│   │   ├── daily/
│   │   │   ├── state.js
│   │   │   ├── controller.js
│   │   │   └── view.js
│   │   ├── weekly/                    # réutilise le moteur daily
│   │   ├── challenges/
│   │   │   ├── catalog.js
│   │   │   ├── eligibility.js
│   │   │   ├── game.js
│   │   │   └── view.js
│   │   ├── custom-challenges/
│   │   │   ├── codec.js
│   │   │   ├── game.js
│   │   │   └── view.js
│   │   ├── dex/
│   │   ├── progression/
│   │   ├── history/
│   │   ├── stats/
│   │   └── settings/
│   ├── ui/
│   │   ├── loader.js
│   │   ├── footer.js
│   │   ├── notification.js
│   │   ├── autocomplete.js
│   │   ├── gauge.js
│   │   ├── modal.js
│   │   └── i18n/
│   │       ├── translator.js
│   │       ├── apply.js
│   │       └── switcher.js
│   └── pages/
│       ├── daily-page.js
│       ├── weekly-page.js
│       ├── marathon-page.js
│       └── ...
├── data/                              # JSON inchangés
├── translations/                      # JSON inchangés
├── img/                               # images inchangées
├── styles/                            # CSS
└── tests/
    ├── unit/
    └── e2e/
```

### Règle de dépendance

```text
pages → features → core
pages → ui      → core
features → data → core
data → core
core → (rien)
```

- `core` ne connaît ni DOM ni IndexedDB ni `Translator`.
- `data` ne connaît pas le DOM.
- `features` orchestre `data` + `core` + `ui`.
- `pages` assemble et initialise.
- Aucune entité n'appelle un service global.

---

## 4. Correspondance ancien → nouveau

| Ancien | Nouveau |
|---|---|
| `pokemon.js` | `src/core/pokemon.js` + `src/data/type-icons.js` |
| `pokemon-versions.js` | `src/core/versioning.js` |
| `game.js` + `ui.js` | `src/features/marathon/{session,controller,view}.js` |
| `daily.js` | `src/features/daily/*` + `src/features/shared/round-engine.js` |
| `weekly.js` | `src/features/weekly/*` (réutilise le round-engine) |
| `Dex.js` | `src/data/repositories/dex-repository.js` |
| `Dex-ui.js` | `src/features/dex/view.js` |
| `DailyToDexImport.js` | `src/features/dex/import.js` |
| `stats.js` | `src/features/stats/*` + `src/core/rules/xp.js` |
| `history.js` / `history_curve.js` | `src/features/history/{list,chart,stats}.js` |
| `data.js` | `src/data/save-format.js` + `src/features/settings/*` |
| `migration.js` | `src/data/migrations/*` |
| `cosmetics.js` | `src/features/settings/cosmetics.js` + `src/ui/theme.js` |
| `entity/challenge.js` | `src/core/challenge.js` |
| `business/challenge-*` | `src/features/challenges/*` + `src/data/repositories/challenge-repository.js` |
| `entity/reward/*` | `src/core/reward.js` + `src/features/progression/reward-view.js` |
| `custom_challenges/*` | `src/features/custom-challenges/*` |
| `translate.js` / `i18n-setup.js` / `language-switcher.js` | `src/ui/i18n/*` |
| `loader.js` / `footer.js` | `src/ui/*` |
| `profile.js` | supprimé (profil dans `src/features/settings/profile.js`) |
| `old_daily.js` | `src/features/history/past-challenges.js` |
| `data.html`, `prediction.html`, `test-i18n.html` | `tools/` (hors déploiement) |

---

## 5. Phases

### Phase 0 — Baseline et filet de sécurité (1–2 j) — **partiellement faite**

La baseline navigateur existe (21 pages, données IndexedDB seedées puis relues). Les fixtures et tests unitaires restent à créer.


- Créer `tests/fixtures/` : un fichier de sauvegarde v2, un code custom (`1...` et `2...`), un historique Daily/Weekly de test, un Dex de test.
- Écrire les tests unitaires des fonctions pures **sans les modifier** :
  - `stringToSeed`, `mulberry32`, `shuffleArrayWithSeed` ;
  - `pointsForAttempt` ;
  - `parseDailyText`, `parseWeeklyText` ;
  - `CustomChallengeCodec.encode/decode` ;
  - calculs XP.
- Exécuter le plan de tests manuels du doc 19 sur l'état actuel et noter les résultats.
- Ajouter `package.json` uniquement pour les outils de test (pas de build runtime).

**Critère de sortie** : baseline verte, fixtures commitées, parcours principaux validés.

### Phase 1 — Nettoyage du code mort (1 j) — **à faire**

- Supprimer `profile.js` et sa balise.
- Supprimer les exports/fonctions listés en doc 16 § 4.1.
- Déplacer les pages orphelines dans `tools/` (ou supprimer).
- Déplacer les assets non référencés dans `img/_unused/`.
- Ne pas toucher aux doublons métier dans cette phase.

**Critère de sortie** : aucune page ne référence un fichier supprimé ; tests manuels inchangés.

### Phase 2 — Fondations partagées (3–4 j) — **à faire**

Créer et adopter :

1. `src/core/rules/rng.js` : `mulberry32`, `seedFromString`, `seededShuffle`.
2. `src/core/rules/names.js` : `normalize`, `matchesName`.
3. `src/core/rules/scoring.js` : `pointsForAttempt`, `MAX_ATTEMPTS`, `HINT_STEPS`.
4. `src/data/cookies.js` : `get`, `set`, `remove`, avec mêmes noms.
5. `src/data/db.js` : `openDB`, `getAll`, `get`, `put`, `delete`, `clear` + `ready`.
6. `src/ui/notification.js`.
7. `src/ui/i18n/*`.

Migrer d'abord les modules **les plus simples** (custom codec, custom game, settings) pour valider les fondations, puis Daily/Weekly.

**Critère de sortie** : plus aucun `indexedDB.open` direct dans les modules migrés ; tests unitaires des règles verts.

### Phase 3 — Domaine pur (2–3 j)

Extraire :

- `selection.js` : `getDailyList(pokemons, date, versions)`, `getWeeklyList(...)`, `getMarathonOrder(...)`.
- `xp.js` : `computeDailyXP`, `computeWeeklyXP`, `computeMarathonXP`, `computeChallengeXP`, `computeTrophyXP`, `computeTotalXP`.
- `trophies.js` : évaluation d'un trophée à partir d'un contexte (`dex`, `history`, `cookies`, `pokemons`).
- `save-format.js` : sérialisation, hash, parsing, validation, merge **pur** (sans I/O).

Tests unitaires exhaustifs sur ces modules.

**Critère de sortie** : `stats.js` et `ChallengeManager` consomment le même `computeTotalXP` ; une modification de barème ne se fait qu'à un endroit.

### Phase 4 — Migration des fonctionnalités (8–12 j)

Ordre recommandé (du plus simple au plus risqué) :

1. **Settings/Profil/Cosmétiques** : page Paramètres, cookies, thème.
2. **Dex** : repository + vue + import.
3. **Daily** : state/controller/view, en conservant le format de stockage.
4. **Weekly** : réutiliser le moteur Daily (paramètres `count`, `seedPrefix`, `maxScore`, `store`).
5. **Marathon** : session + reprise.
6. **Progression/Stats** : XP, trophées, récompenses.
7. **Historique** : listes, graphes, stats (supprimer le double rendu).
8. **Challenges bonus** : déjà en couches, remplacer les dépendances globales par des imports.
9. **Challenges custom** : codec + game + vues.
10. **Pages annexes** : data viewer, prédiction, crédits.

Pour chaque fonctionnalité :

- écrire les tests de non-régression ;
- créer le nouveau module ;
- brancher la page sur le nouveau point d'entrée ;
- vérifier manuellement ;
- supprimer l'ancien fichier ;
- commit dédié.

**Critère de sortie** : plus aucun script global historique à la racine ; les pages n'incluent que leur point d'entrée + composants UI.

### Phase 5 — Unification Daily/Weekly (2–3 j)

Créer un `RoundEngine` unique :

```js
createRoundEngine({
  count: 5,
  maxAttempts: 5,
  store: dailyRepository,
  seed: date,
  onFinish: ...
});
```

Le Weekly devient une configuration (`count: 10`, `seedPrefix: 'week'`, `maxScore: 100`). Supprimer `weekly.js`.

**Critère de sortie** : un seul moteur, deux configurations, tests identiques.

### Phase 6 — Consolidation (2 j)

- Supprimer `docs/` après archivage.
- Mettre à jour `.docs/` (architecture réelle).
- Ajouter un README de développement (serveur local, tests, conventions).
- Optionnel : `// @ts-check` sur `core/` et `data/`.
- Optionnel : bundler/Vite si le nombre de modules devient ingérable.

**Critère de sortie** : documentation alignée, tests verts, aucune référence morte.

---

## 6. Stratégie de compatibilité des données

| Élément | Stratégie |
|---|---|
| `PokefeetDB` v4 | ne pas changer la version ; mêmes stores/clés |
| `PokefeetDexDB` v4 | idem |
| `PokefeetChallengeDB` v4 | idem |
| Cookies | mêmes noms, mêmes formats |
| `localStorage` | même clé `pk_practice_session` |
| `sessionStorage` | même clé `challenge_manager_state` |
| Fichier de sauvegarde | lire v2, écrire v2 pendant la migration |
| URLs | inchangées |

Toute évolution de schéma doit être **additive** (nouveau champ optionnel) et accompagnée d'une migration testée sur une base v4 réelle.

---

## 7. Gestion des risques

| Risque | Probabilité | Impact | Mitigation |
|---|---|---|---|
| Rupture d'ordre de scripts | moyenne | élevé | modules ES avec imports explicites |
| Perte de données IndexedDB | faible | critique | ne pas changer le schéma ; fixtures ; tests de migration |
| Divergence Daily/Weekly | moyenne | moyen | moteur unique + tests paramétrés |
| Oubli d'un texte i18n | élevée | faible | test de clés manquantes |
| Régression de partage | moyenne | moyen | snapshots de `buildShareText` |
| URLs cassées | faible | élevé | tests de liens |
| Performance dégradée | moyenne | moyen | mesures avant/après sur `stats`, `Dex`, `prediction` |
| Scope creep | élevée | élevé | phases courtes, critères de sortie stricts |

### Rollback

- Chaque phase est un ensemble de commits indépendants.
- Les anciens fichiers ne sont supprimés qu'après validation de la page migrée.
- En cas de régression bloquante : revert du commit de branchement, l'ancien code reste disponible jusqu'à la phase suivante.

---

## 8. Definition of Done (par fonctionnalité)

- [ ] Le parcours manuel du doc 19 passe.
- [ ] Les tests unitaires associés passent.
- [ ] Aucun `indexedDB.open`, `getCookie`, `mulberry32` ou `pointsForAttempt` dupliqué dans le module migré.
- [ ] Aucune variable globale nouvelle.
- [ ] Les clés i18n existent en FR et EN.
- [ ] Les URLs et formats de stockage sont inchangés.
- [ ] L'ancien fichier est supprimé.
- [ ] La documentation `.docs/` est mise à jour.

---

## 9. Estimation indicative

| Phase | Effort |
|---|---:|
| 0 — Baseline | 1–2 j |
| 1 — Code mort | 1 j |
| 2 — Fondations | 3–4 j |
| 3 — Domaine pur | 2–3 j |
| 4 — Fonctionnalités | 8–12 j |
| 5 — Unification Daily/Weekly | 2–3 j |
| 6 — Consolidation | 2 j |
| **Total** | **19–27 j** |

Estimation pour une personne connaissant le code, hors imprévus de compatibilité navigateur. À ajuster après la phase 0.

---

## 10. Questions ouvertes à trancher

1. **ES modules natifs ou bundler ?** Recommandation : natifs d'abord.
2. **Faut-il persister l'XP** plutôt que la recalculer ? Recommandation : conserver le calcul pour la migration, envisager un cache ensuite.
3. **Faut-il conserver `prediction.html` ?** Si oui, le sortir du déploiement public et le brancher sur les modules de sélection.
4. **Faut-il conserver Bootstrap CDN ?** Recommandation : non, remplacer les quelques grilles utilisées.
5. **Faut-il migrer les anciens cookies** ou les abandonner officiellement ? Décision produit nécessaire.
6. **Faut-il un backend** pour les comptes/classements ? Hors périmètre de cette restructuration, mais l'architecture `data/repositories` le permettrait.
7. **Quel niveau de compatibilité navigateur** (CompressionStream, IndexedDB, `crypto.subtle`) ? À formaliser dans un `browserslist`.

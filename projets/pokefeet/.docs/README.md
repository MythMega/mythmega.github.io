# Pokefeet — Documentation d'analyse et d'architecture

> **Objet** : décrire l'application fonctionnalité par fonctionnalité, vérifier les dépendances réelles, identifier le code mort et suivre la restructuration en cours.
>
> **Branche analysée** : `pokefeet/5.1`  
> **Date d'analyse** : 19/10/2026  
> **Méthode** : lecture statique du dépôt, recherche d'usages (`grep`), inventaire des scripts chargés par page, vérification des clés IndexedDB/cookies, comptage des données JSON, puis vérification navigateur des 21 pages.
>
> **Réorganisation effectuée** : les 36 scripts sont dans `js/` (`core`, `data`, `features`, `i18n`, `ui`) et les 25 feuilles dans `styles/` (dont `main.css`). Les 21 pages HTML restent à la racine. Aucun identifiant de stockage n'a changé.

---

## 1. Comment lire cette documentation

| Besoin | Document |
|---|---|
| Comprendre le produit et l'inventaire des fonctionnalités | [01-vue-ensemble-et-fonctionnalites.md](./01-vue-ensemble-et-fonctionnalites.md) |
| Comprendre la structure réelle et les dépendances | [02-architecture-et-cartographie.md](./02-architecture-et-cartographie.md) |
| Connaître les entités et schémas JSON | [03-modeles-de-donnees.md](./03-modeles-de-donnees.md) |
| Comprendre IndexedDB, cookies, migration et export/import | [04-persistance-et-migration.md](./04-persistance-et-migration.md) |
| Détail du mode Marathon | [05-mode-marathon.md](./05-mode-marathon.md) |
| Détail du mode Daily | [06-mode-daily.md](./06-mode-daily.md) |
| Détail du mode Weekly | [07-mode-weekly.md](./07-mode-weekly.md) |
| Challenges bonus (JSON, prérequis, récompenses) | [08-challenges-bonus.md](./08-challenges-bonus.md) |
| Challenges custom (codec d'URL, création, jeu) | [09-challenges-custom.md](./09-challenges-custom.md) |
| Pokédex et imports vers le Dex | [10-pokedex.md](./10-pokedex.md) |
| XP, niveaux, trophées, récompenses | [11-progression-xp-trophees-recompenses.md](./11-progression-xp-trophees-recompenses.md) |
| Historique, graphiques et statistiques | [12-historique-et-statistiques.md](./12-historique-et-statistiques.md) |
| Profil, cosmétiques, sauvegarde/restauration | [13-profil-cosmetiques-sauvegarde.md](./13-profil-cosmetiques-sauvegarde.md) |
| Composants UI transverses et i18n | [14-ui-transversale-et-i18n.md](./14-ui-transversale-et-i18n.md) |
| Pages annexes, admin, outils Python | [15-pages-annexes-et-outils-donnees.md](./15-pages-annexes-et-outils-donnees.md) |
| **Code mort, orphelins, doublons de réorganisation** | [16-code-mort-et-orphelins.md](./16-code-mort-et-orphelins.md) |
| Dette technique et risques | [17-dette-technique-et-risques.md](./17-dette-technique-et-risques.md) |
| **Plan de restructuration proposé** | [18-plan-de-restructuration.md](./18-plan-de-restructuration.md) |
| Plan de tests et de non-régression | [19-plan-de-tests-et-non-regression.md](./19-plan-de-tests-et-non-regression.md) |
| **Contrat de compatibilité des données** | [20-compatibilite-donnees.md](./20-compatibilite-donnees.md) |
| **PWA, Service Worker, offline et packaging stores** | [21-pwa-et-deploiement.md](./21-pwa-et-deploiement.md) |
| **Sons à fournir (3 MP3)** | [sound.txt](./sound.txt) |

---

## 2. Chiffres clés vérifiés

| Élément | Valeur |
|---|---|
| Pages HTML | 21 pages applicatives + `offline.html` |
| Fichiers JavaScript | 36 métier/UI + `js/pwa.js`, dans `js/` (11 628 lignes hors PWA) + `sw.js` à la racine |
| Feuilles CSS | 25 dans `styles/` (3 025 lignes), dont `main.css` |
| PWA | `manifest.webmanifest`, `sw.js`, `offline.html`, `js/pwa.js`, `icons/` |
| Lignes JS + HTML + CSS suivies | ~18 400 (hors `.docs/`) |
| Pokémon dans `data/pokemons.json` | 698 |
| Générations représentées | 1 à 5 principalement, 7 à 9 en faible volume |
| Versions de données (`version.json`) | 4 (déploiements entre le 27/05/2026 et le 31/08/2026) |
| Trophées (`trophies.json`) | 79 |
| Challenges bonus (`bonus_challenges.json`) | 32 |
| Cosmétiques (`js/features/settings/cosmetics.json`) | 39 (30 fonds, 9 boutons) |
| Récompenses de niveau (`reward.json`) | 14 |
| Clés de traduction | 453 en français, 453 en anglais |
| Bases IndexedDB | 3 : `PokefeetDB`, `PokefeetDexDB`, `PokefeetChallengeDB` |
| Tests automatisés détectés | 0 |
| `package.json` / build | `package.json` minimal (`lint`, `serve`) — aucun build, site statique vanilla JS |

---

## 3. Constats majeurs (à retenir avant de restructurer)

1. **La réorganisation physique est terminée.** Tous les scripts sont désormais rangés par domaine dans `js/core`, `js/data`, `js/features`, `js/i18n` et `js/ui` ; les styles sont éclatés dans `styles/`. En revanche, les gros modules (`daily`, `weekly`, `stats`, `data-manager`) mélangent encore métier, UI et persistance : le découpage interne reste à faire.
2. **La persistance est dupliquée.** Le même code `indexedDB.open(...)` et les mêmes helpers cookies existent dans plus de dix fichiers, avec des variantes de gestion d'erreur.
3. **Les règles métier sont dupliquées.** PRNG Mulberry32, shuffle seedé, normalisation des noms, barème de points, calcul d'XP et génération des textes de partage sont réimplémentés dans plusieurs modules. `ChallengeManager.computeTotalXP()` est explicitement commenté comme « IDENTIQUE à js/features/stats/stats.js ».
4. **Le code mort est concentré autour de la réorganisation et des pages annexes.** Voir le détail dans [16-code-mort-et-orphelins.md](./16-code-mort-et-orphelins.md) : `js/features/settings/profile.js`, `Cosmetics.renderCosmeticsUI()`, plusieurs exports jamais appelés, 4 pages non liées, des sprites alternatifs et des scripts/outils non référencés.
5. **Il n'existe aucun filet de sécurité automatisé.** Pas de tests, pas de build, pas de lint. Toute restructuration doit commencer par une baseline de tests manuels et des fixtures d'import/export.

---

## 4. Conventions de cette documentation

- **« Réel »** : comportement vérifié dans le code, pas dans une intention ou un ancien document.
- **« Legacy »** : code encore chargé mais dont l'usage est historique, redondant ou supprimable.
- **« Mort »** : aucun appel externe détecté (hors définition et export), ou page sans lien entrant.
- **« À vérifier runtime »** : comportement dépendant du navigateur, du réseau ou d'un état IndexedDB non reproductible statiquement.
- Les chemins sont relatifs à la racine du dépôt.
- Les documents `docs/` existants (17 fichiers, ~2 200 lignes, datés de juillet à octobre) sont **conservés comme archive** mais ne doivent plus servir de référence : ils ne couvrent ni les challenges custom, ni l'arborescence `js/` actuelle, ni l'état réel de la dette.

---

## 5. Périmètre exclu

- Les 1 572 fichiers d'images ne sont pas décrits individuellement ; seuls les ensembles et les orphelins sont listés.
- L'historique Git n'est pas analysé au-delà du constat de réorganisation (commits `revamp`, `new custom challenges`).
- Le déploiement (`web.jmdev.fr`) et le serveur local (`start_server.cmd`) ne sont pas audités.
- Aucun test fonctionnel n'a été exécuté : les parcours sont reconstruits depuis le code. Le plan de tests du document 19 sert précisément à valider ces conclusions avant et après refactor.

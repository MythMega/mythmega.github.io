# Audit sécurité & performance

Cet audit couvre l'application statique : surface d'attaque limitée (pas de serveur,
pas de comptes, pas de secrets), mais des données distantes (IGDB, CDN) et un gros
volume manipulé côté client.

## 1. Synthèse

| Catégorie | État |
|-----------|------|
| Injection SQL | Corrigée : toutes les requêtes de filtres sont paramétrées |
| XSS | Pas de faille trouvée : échappement HTML systématique des données distantes |
| Entrées d'URL | Corrigées : IDs, pages et index validés, base64 tolérant |
| Déni de service local (DOM) | Corrigé : listes de détail bornées à 60, requêtes N+1 supprimées |
| Chaîne d'approvisionnement CDN | **Risque résiduel** (pas de SRI, `new Function`) |
| CSP | **Absente** (scripts inline) |
| Performance | Améliorée (index, requêtes, rendu borné) ; coût mémoire structurel |
| Données personnelles | Aucune donnée envoyée ; tout reste dans IndexedDB |

## 2. Failles et fragilités corrigées

### 2.1 Injection SQL dans les filtres

**Avant** : les libellés et listes d'IDs étaient concaténés dans le SQL
(`sqlList(names)` avec échappement manuel des apostrophes). Les valeurs venaient de la
base, mais tout chemin capable d'injecter un libellé devenait critique.

**Après** : `FiltersBusiness` construit des `?` et transmet un tableau de paramètres
(`db.query(sql, params)`). Les valeurs numériques (`game_type`) sont converties et
validées. Aucune donnée utilisateur n'entre dans la chaîne SQL.

**Vérification** : `lastQuery` expose `{ sql, params }` ; les 7 scénarios de test
(défauts, mixte, DLC, exclusion du jeu principal, fangames, tous genres exclus) ont été
exécutés sur la base réelle et contrôlés par des requêtes de cohérence.

### 2.2 Entrées d'URL non validées

- `?page=abc` produisait `NaN` dans `LIMIT/OFFSET` → erreur SQLite ou comportement
  indéfini. `Router._positiveInt()` borne les pages à un entier ≥ 0.
- `?idx=abc` produisait `idx = NaN` ; `ids[NaN]` était introuvable, la vue naviguait
  vers `NaN + 1`, en boucle. `Router._positiveInt()` et la normalisation des IDs
  corrigent cela.
- Les IDs (`game`, `developer`, …) sont convertis en entiers finis (`Router._id`).
- `decodeSettings` reconstruit le padding base64 avant `atob` et attrape les erreurs ;
  un payload corrompu retombe sur les réglages par défaut.

### 2.3 Listes de détail non bornées

- `?platform=130` (PC) construisait **202 316 cartes** dans le DOM : gel de l'onglet.
- Un développeur comme TigerQiuQiu a 1 807 jeux ; Konami 1 192.
- `?genre=17` (Shooter) a 29 734 jeux.

Correctif : `COUNT(*)` séparé + `LIMIT 60` trié par date de sortie, avec mention
« 60 plus récents sur N ». Les pages développeur, plateforme, genre et thème sont
concernées.

### 2.4 Requêtes N+1

- `DeveloperBusiness.getById` faisait **une requête par jeu** (jusqu'à des milliers).
  Remplacé par une jointure unique + `COUNT(DISTINCT game_id)`.
- `ProfileUI` appelait `GameBusiness.getById` pour chaque jeu de liste (10 requêtes
  enrichies × 9 sous-requêtes) et à chaque frappe dans la recherche. Remplacé par
  `GameBusiness.getSummaries(ids)` : une requête pour toute la liste, résultat mis en
  cache pour la recherche et la pagination.

### 2.5 Filtre « contenu adulte » contournable

L'ancien filtre sélectionnait les thèmes cochés (`theme IN (…)`) et ajoutait une
exclusion explicite d'Erotic. Un jeu tagué à la fois `Erotic` et `Action` pouvait
passer par la clause d'inclusion avant l'exclusion — l'exclusion explicite le
rattrapait, mais la logique dépendait de deux mécanismes.

Désormais, quand le contenu adulte est désactivé :

- l'état est forcé à `theme.exc = [Erotic]` (la pastille est verrouillée) ;
- la requête ajoute une exclusion `NOT IN` paramétrée.

Un état importé depuis une URL ou un ancien filtre ne peut donc pas réactiver Erotic.

### 2.6 Mots-clés : scan complet à chaque requête

La colonne `keyword` est normalisée en minuscules et les requêtes utilisaient
`LOWER(keyword) IN (…)`, ce qui empêchait tout index. Les requêtes comparent
maintenant `keyword IN (…)` et un index `(keyword, game_id)` a été ajouté. La
recherche `LIKE '%game award%'` reste un scan, mais sur un volume modéré et
uniquement quand l'option est active.

### 2.7 Index manquants

Ajouts : `games(aggregated_rating)`, `game_perspectives(perspective, game_id)`,
`game_keywords(keyword, game_id)`, `games(game_type)`,
`game_developers(company_id, game_id)`, `game_franchises(franchise, game_id)`.
Ils couvrent le score, la nouvelle facette perspective, les mots-clés, les types et
les fiches développeur/franchise.

### 2.8 Défauts d'interface

- Les pages genre/thème affichaient « bientôt disponible » : elles listent maintenant
  leurs jeux.
- Un résultat de recherche « mode » menait à une liste vide : `list=mode` (et
  `perspective`) est pris en charge ; les cartes de ces types ne sont pas cliquables
  car il n'existe pas de page de détail.
- Le libellé « Type #10 » est remplacé par « Jeu étendu » (valeur IGDB présente en
  base mais absente du dictionnaire).
- Les iframes YouTube sont en `loading="lazy"` (elles ne se chargent plus toutes à
  l'ouverture d'une fiche).
- Le `@import` de polices bloquant a été remplacé par des `<link>` + `preconnect`.
- Le texte atténué est passé de 3,9:1 à 6,1:1 de contraste.
- Focus clavier visible, `prefers-reduced-motion` respecté.

## 3. Risques résiduels (non corrigés)

### 3.1 Chaîne d'approvisionnement CDN — **élevé**

- `sql.js` est chargé depuis cdnjs, les modules `brotli` depuis jsDelivr, sans
  `integrity` (SRI) ni version verrouillée par hash.
- Le repli Brotli exécute du code tiers via `new Function('require','module','exports', code)`
  avec un shim `require`.
- Une compromission du CDN permettrait d'exécuter du code arbitraire dans la page
  (accès à IndexedDB, aux données locales, possibilité de déclencher des requêtes).

Recommandations : héberger `sql-wasm.js`/`.wasm` et les fichiers brotli localement,
ajouter des attributs `integrity` + `crossorigin`, ou au minimum verrouiller les
versions et documenter la procédure de mise à jour. Si la cible supporte
`DecompressionStream('br')`, le repli CDN peut rester optionnel et être désactivé.

### 3.2 Absence de CSP — **moyen**

La page utilise un script inline de bootstrap, des styles inline et des `onclick`
inline (fiche jeu). Une CSP stricte nécessiterait d'extraire le bootstrap dans un
fichier, de supprimer les handlers inline et d'ajouter un nonce/hash. Recommandation :
`default-src 'self'; img-src 'self' https://images.igdb.com data:; frame-src
https://www.youtube.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src https://fonts.gstatic.com; script-src 'self' https://cdnjs.cloudflare.com
https://cdn.jsdelivr.net`.

### 3.3 Poids et mémoire — **structurel**

- 86 Mo à télécharger au premier chargement, 396 Mo décompressés, + index en mémoire.
- `sql.js` charge toute la base en RAM : sur mobile bas de gamme, le chargement peut
  échouer (OOM) ou être très lent.
- Pas de service worker : le cache IndexedDB décompresse à chaque démarrage et les
  index sont reconstruits (≈ 3,4 s sur la machine de test).
- Pistes : version allégée de la base (colonnes utiles seulement, suppression des
  textes longs dans une table séparée), pagination serveur, OPFS + SQLite WASM
  persistant, ou pré-indexation du fichier `.db`.

### 3.4 Dépendance réseau pour le premier chargement

Sans `DecompressionStream('br')` natif et sans cache, l'application a besoin de
jsDelivr et cdnjs. Un mode hors-ligne complet supposerait de vendre les bibliothèques
localement et d'utiliser un service worker.

### 3.5 SEO

Le contenu est rendu en JavaScript ; seules les meta statiques d'`app.html` sont
visibles par un crawler sans JS. Les URLs canoniques sont codées en dur sur
`mythmega.github.io`. Un pré-rendu statique par route serait nécessaire pour un SEO
complet.

### 3.6 Données locales non protégées

XP, listes et filtres sont dans IndexedDB, modifiables via les DevTools. Ce n'est pas
une faille de sécurité (aucun enjeu financier ni multi-utilisateur), mais toute
logique de récompense doit rester considérée comme indicative.

### 3.7 Dépendances distantes d'images et de vidéos

Les jaquettes et captures proviennent d'IGDB ; les vidéos sont des iframes YouTube.
Ces requêtes exposent l'adresse IP et peuvent déposer des cookies tiers. Les iframes
sont désormais chargées à la demande (`lazy`), pas les images de couverture.

## 4. Vérifications effectuées

| Vérification | Méthode | Résultat |
|--------------|---------|----------|
| Syntaxe de tous les scripts | `node --check` sur chaque `.js` | OK |
| Construction SQL | Harnais Node avec dictionnaire simulé + exécution Python sur la base réelle | OK |
| Sémantique inclusions | Résultats ne contenant que la valeur incluse | OK |
| Sémantique exclusions | Aucun résultat avec Horror / Co-operative / Erotic | OK |
| Types de jeux | DLC seuls / aucun jeu principal | OK |
| Fangames | +6 723 jeux quand l'option est activée | OK |
| Migration v1 | Anciens `p/m/g/t` + `allowedGameTypes` chargés dans l'URL | OK (attendu : 22 inclusions, 1 exclusion) |
| Round-trip URL | `decode(encode(state)) === normalize(state)` | OK |
| Réglages invalides | base64 corrompu, IDs inconnus, années `null` | Repli sûr |
| Parcours navigateur | Accueil, filtres, cycle des états, presets, save/load, roulette, retour, genre, plateforme, développeur, listes mode, profil, paramètres | OK |
| Requête roulette réelle | 13 446 jeux en 465 ms, puis 10 976 en 623 ms avec Shooter exclu | OK |
| Console | Aucune exception après correction de `_syncAllFacetHeaders` | OK |

Il n'existe **aucun test automatisé** dans le dépôt ; ces vérifications sont manuelles
et ont été faites pendant l'itération. Un ajout de tests unitaires sur
`FiltersBusiness` (normalisation, SQL) serait la première brique de non-régression.

## 5. Mesures

| Mesure | Valeur |
|--------|--------|
| Fichier compressé | 86 Mo |
| Base décompressée | 396 Mo |
| Création des 15 index + ANALYZE | ≈ 3,3 s (Chromium, machine de test) |
| `runQuery` (≈ 13 000 résultats) | ≈ 0,47 s |
| `runQuery` (≈ 11 000 résultats, exclusion) | ≈ 0,62 s |
| Fiche jeu (10 requêtes indexées) | quelques millisecondes |
| Page plateforme PC | 60 cartes au lieu de 202 316 |
| Recherche liste / profil | 1 requête au lieu de N |

Le temps de requête inclut le parcours des ensembles `INTERSECT` et le mélange
Fisher-Yates. La limite de 50 résultats n'est appliquée qu'après le mélange, pour
garantir un tirage uniforme.

## 6. Priorités recommandées

1. **Haute** : héberger sql.js et brotli localement avec SRI (ou désactiver le repli
   CDN), afin de supprimer l'exécution de code tiers non vérifié.
2. **Haute** : tests unitaires du moteur de filtres (normalisation, migration, SQL,
   sémantique des exclusions).
3. **Moyenne** : CSP stricte après extraction du bootstrap et suppression des
   handlers inline.
4. **Moyenne** : alléger la base (table de textes séparée, colonnes strictement
   nécessaires aux filtres) pour réduire les 86/396 Mo.
5. **Basse** : pré-rendu des routes principales pour le SEO.
6. **Basse** : service worker pour un vrai mode hors-ligne et un démarrage plus rapide.

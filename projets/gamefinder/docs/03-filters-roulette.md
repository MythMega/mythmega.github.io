# Filtres & Roulette

## 1. Principe

La page `?state=filters` permet de composer une sélection de jeux, puis de lancer une
roulette qui affiche les jeux retenus un par un.

Chaque **facette** (plateforme, genre, thème, mode, perspective, type de jeu) est
composée de **valeurs**. Chaque valeur possède trois états :

| État | Symbole | Effet |
|------|---------|-------|
| `1` **Inclure** | ✓ (vert) | Le jeu doit posséder **au moins une** valeur incluse de la facette |
| `-1` **Exclure (banni)** | ✗ (rouge sombre, barré) | Le jeu ne doit posséder **aucune** valeur exclue |
| `0` **Ignorer** | N/A | La présence ou l'absence de cette valeur n'a aucun impact |

Règles de combinaison :

- **OU** entre les valeurs incluses d'une même facette.
- **ET** entre les facettes différentes.
- Les exclusions retirent des jeux de l'ensemble final.
- Une facette sans inclusion **et** sans exclusion est totalement ignorée.

### Conséquence importante : « inclure » est une liste blanche

Inclure `Action` dans les thèmes signifie « le jeu doit avoir le thème Action ».
Les jeux sans thème Action sont écartés, **même si les autres thèmes sont en N/A**.
Pour dire « je ne veux pas d'horreur, mais le reste m'est égal », il faut **exclure**
`Horror`, pas inclure les 21 autres thèmes.

Autre cas à connaître : exclure *toutes* les valeurs d'une facette ne donne pas zéro
jeu, mais les jeux **sans aucune valeur** de cette facette. Par exemple, exclure les
23 genres laisse les 40 551 jeux qui n'ont aucun genre enregistré.

## 2. Interface

Chaque pastille est un bouton tri-état. Un clic cycle :

```text
N/A  ──clic──►  ✓ Voulu (inclure)  ──clic──►  ✗ Banni (exclure)  ──clic──►  N/A
```

- **Ctrl/Shift + clic** force l'état **✓ voulu**, quel que soit l'état d'origine.
- **Ctrl/Shift + clic droit** force l'état **✗ banni** (le menu contextuel est bloqué).
- La légende en haut de page rappelle les trois états, le cycle et les raccourcis.
- Chaque boîte affiche le nombre d'inclusions/exclusions (`3 ✓ · 1 ✗`).
- Trois boutons de preset appliquent un état à toute la facette : `✓`, `✗`, `N/A`.
- Les pastilles incluses/exclues d'une plateforme restent visibles même quand la
  recherche de plateforme est active.
- Le compteur global sous la grille résume `N inclusion(s) · M exclusion(s) · F facette(s)`.
- Le thème **Erotic** est désactivé et forcé en exclusion tant que « Contenu adulte »
  est désactivé dans les paramètres. Son état ne peut pas être changé.
- « Réinitialiser » recharge les réglages par défaut.
- « Sauvegarder les critères » enregistre l'état dans le profil (IndexedDB).
  « Charger un filtre » liste les filtres sauvegardés avec leur résumé.

## 3. Réglages par défaut

| Facette | Défaut | Effet |
|---------|--------|-------|
| Plateformes | 8 plateformes épinglées incluses | Switch, Switch 2, Xbox Series X\|S, PC, Android, iOS, PS5, Mac |
| Genres | N/A | aucun filtre |
| Thèmes | N/A (Erotic exclu si adulte désactivé) | |
| Modes | N/A | |
| Perspectives | N/A | |
| Types de jeux | « Jeu principal » inclus | exclut DLC, mods, remakes, etc. |
| Années | 1970 → année courante | |
| Score | 0 → 100, « jeux sans note » désactivé | ne garde que les jeux notés |
| Fangame / mod | désactivé | exclut les mots-clés fangame |
| Uniquement Game Awards | désactivé | |

Ces défauts reproduisent le comportement de l'ancienne version (plateformes
vedettes, jeu principal, jeux notés), tout en rendant les autres facettes neutres.

## 4. Format des réglages (v2)

```js
{
  v: 2,
  y: [1970, 2026],                    // bornes d'années incluses
  facets: {
    platform:    { inc: [22, 118], exc: [] },
    genre:       { inc: [], exc: [17] },
    theme:       { inc: [], exc: [7] },
    mode:        { inc: [], exc: [] },
    perspective: { inc: [], exc: [] },
    gameType:    { inc: [0], exc: [] }
  },
  scoreMin: 0,
  scoreMax: 100,
  allowNoScore: false,
  allowFangame: false,
  onlyGameAwards: false
}
```

- Les IDs sont ceux des tables dictionnaires (`platforms.id`, `genres.id`, …).
- `gameType` utilise `games.game_type` (0 = jeu principal, NULL assimilé à 0).
- Une valeur ne peut pas être à la fois incluse et exclue : l'inclusion gagne au
  chargement.
- Les IDs inconnus, les doublons, les années hors bornes et les scores invalides
  sont nettoyés par `FiltersBusiness.normalizeSettings()`.
- `encodeSettings()` omet les facettes identiques au défaut et les valeurs par défaut
  (score, interrupteurs). Une facette explicitement vide est conservée sous la forme
  `{}` — indispensable pour distinguer « tout ignorer » de « défaut ».

### Migration v1

Les anciens réglages (`p`, `m`, `g`, `t`, `allowedGameTypes`, sans `v`) sont acceptés :

| Ancien | Nouveau |
|--------|---------|
| `p`, `m`, `g`, `t` (IDs cochés) | `inc` de la facette correspondante |
| valeurs décochées | N/A (et non « exclues ») |
| tous les éléments cochés | N/A (l'ancien moteur ignorait alors le filtre) |
| `allowedGameTypes: []` | `gameType.inc = [0]` (jeu principal) |
| `allowedGameTypes` partiel | `inc = [0, …sélection]` |
| tous les types non nuls | N/A |

Les filtres sauvegardés dans IndexedDB et les liens partagés restent donc lisibles.

## 5. Construction de la requête

`runQuery(settings, { allowAdultContent })` :

1. Normalise les réglages.
2. Construit une **requête de base** sur `games` :
   - plage `first_release_date` (paramétrée) ;
   - type de jeu inclus/exclus (`game_type IN (…)`, `= 0`, `IS NULL`) ;
   - note (`aggregated_rating IS NOT NULL`, `BETWEEN ? AND ?` et, si autorisé, `OR IS NULL`) ;
   - si adulte désactivé : `id NOT IN (SELECT game_id FROM game_themes WHERE theme = 'Erotic')` ;
   - si fangame désactivé : `id NOT IN (… game_keywords … keyword IN (…))` ;
   - si Game Awards : `id IN (… keyword LIKE '%game award%')`.
3. Pour chaque facette relationnelle :
   - inclusion → `SELECT game_id AS id FROM <table> WHERE <colonne> IN (?, …)`
     (union des valeurs) ;
   - exclusion → `SELECT id FROM games WHERE id NOT IN (SELECT game_id FROM <table>
     WHERE game_id IS NOT NULL AND <colonne> IN (?, …))`.
4. Assemble les ensembles avec `INTERSECT` (ET logique).
5. Exécute via `db.query(sql, params)` — **100 % paramétré**.
6. Mélange les IDs en JavaScript (Fisher-Yates) et renvoie au plus **50** IDs.
7. Renseigne `lastResultCount` (nombre total avant limite) et `lastQuery`
   (`{ sql, params }`) pour le diagnostic.

### Exemple simplifié

Réglages : Shooter inclus, Horror exclu, First person inclus, Co-operative exclu,
plateformes en N/A, jeu principal, adultes désactivés, fangames désactivés :

```sql
SELECT id FROM games WHERE first_release_date IS NOT NULL
  AND first_release_date BETWEEN ? AND ?
  AND (game_type = 0 OR game_type IS NULL)
  AND aggregated_rating IS NOT NULL
  AND id NOT IN (SELECT game_id FROM game_themes WHERE game_id IS NOT NULL AND theme = ?)
  AND id NOT IN (
        SELECT game_id FROM game_keywords
        WHERE game_id IS NOT NULL AND keyword IN (?, ?, ?, ?, ?, ?, ?)
      )
INTERSECT
SELECT game_id AS id FROM game_genres WHERE genre IN (?)
INTERSECT
SELECT id FROM games WHERE id NOT IN (
        SELECT game_id FROM game_themes
        WHERE game_id IS NOT NULL AND theme IN (?)
      )
INTERSECT
SELECT id FROM games WHERE id NOT IN (
        SELECT game_id FROM game_modes_rel
        WHERE game_id IS NOT NULL AND mode IN (?)
      )
INTERSECT
SELECT game_id AS id FROM game_perspectives WHERE perspective IN (?)
```

Vérifications effectuées sur la base réelle :

| Scénario | Résultat | Contrôle |
|----------|----------|----------|
| Défauts | 9 514 jeux | uniquement `game_type = 0`, note non NULL, années ≤ 2026 |
| Shooter + First person, Horror/Coop exclus | 7 643 jeux | 0 jeu avec Horror, 0 avec Co-operative, 0 avec Erotic |
| Type DLC inclus | 332 jeux | `game_type = 1` uniquement |
| Jeu principal exclu | 2 173 jeux | aucun `game_type` 0/NULL |
| Fangames autorisés vs refusés | +6 723 jeux | `fangame`, `rom hack`… |
| Tous les genres exclus | 40 551 jeux | jeux sans genre |

## 6. URL et partage

```text
app.html?state=filters&s=<base64url>          # filtres pré-remplis
app.html?roulette=<base64url>&ids=1,2,3&idx=0 # session de roulette
```

- Encodage : JSON → `btoa` → base64url (remplacement `+`→`-`, `/`→`_`, padding retiré).
- Décodage tolérant : padding reconstruit, JSON invalide → `null` (réglages par défaut),
  IDs inconnus filtrés.
- Les 50 IDs sont transmis dans l'URL (≈ 350–450 caractères) : une session est
  partageable et le bouton retour du navigateur fonctionne.
- Au lancement, la page Roulette reçoit aussi les réglages pour pouvoir revenir en
  arrière (`⇦ Filtres`).

## 7. Parcours Roulette

`RouletteUI` affiche :

- compteur `Jeu i / N` et barre de progression ;
- jaquette, titre, ID IGDB, année, note avec barre ;
- résumé / histoire tronqués à 100 caractères avec « voir plus » ;
- genres, plateformes, modes, perspectives, thèmes, mots-clés ;
- développeurs cliquables, vidéos YouTube (chargement `lazy`), captures d'écran avec
  lightbox (navigation clavier ←/→/Échap) ;
- boutons `Précédent`, `Suivant`, `IGDB ↗`, `Fiche détail`, `À faire`, `Masquer`,
  `Fin de liste`, `⇦ Filtres`.

À la fin de la liste, une popup propose : nouvelle recherche vierge, mêmes critères,
accueil. Un jeu introuvable en base est silencieusement sauté.

XP gagnée : +5 au lancement, +3 à la première fiche détail de la session, +3 par clic
IGDB, +3 × nombre de jeux à l'atteinte du dernier jeu (une fois par session).
Voir [05-profile-progression.md](05-profile-progression.md).

## 8. Coût et limites

- Le résultat complet est matérialisé avant de n'en garder que 50. Pour des critères
  très larges (265 000 jeux), la requête reste utilisable mais coûteuse ; c'est le
  prix du tirage aléatoire uniforme.
- Le mélange est uniforme sur l'ensemble des résultats (pas un échantillon biaisé).
- Le score utilise `aggregated_rating` uniquement ; `rating` n'est pas filtré.
- Aucun filtre sur les mots-clés (6 652 valeurs) ni sur les développeurs/franchises
  n'est proposé : seules les six facettes listées ci-dessus sont exposées.
- Les réglages ne sont pas synchronisés entre appareils ; ils vivent dans l'URL et,
  pour les filtres nommés, dans IndexedDB.

# StreamGuessr

Mini-jeu web (HTML/CSS/JS purs, sans backend) où l'on devine le **temps de
stream** des jeux d'une chaîne Twitch, à partir des statistiques réelles de
[SullyGnome](https://sullygnome.com/).

## Fonctionnement en bref

1. On saisit un pseudo Twitch sur l'accueil.
2. L'application récupère, via l'API SullyGnome, le **top 200 des jeux** les
   plus streamés par cette chaîne sur **les ~20 dernières années** (7300
   jours), avec les images des jeux.
3. Le profil complet est **mis en cache dans IndexedDB pour 14 jours** afin
   d'éviter de re-télécharger les mêmes données.
4. On choisit un mode de jeu et la partie démarre.

### Modes de jeu

- **Classique** : un jeu aléatoire est affiché, on propose un nombre d'heures.
  L'application répond « c'est plus » / « c'est moins », conserve l'historique
  des tentatives, et révèle la réponse exacte une fois trouvée.
  La cible officielle est le nombre d'heures **arrondi à l'unité** ; la valeur
  exacte (décimale) est affichée à la victoire.
- **Comparaison** : le jeu A affiche son temps total, le jeu B reste masqué.
  Il faut choisir le jeu le plus streamé. En cas d'égalité parfaite, toute
  réponse est acceptée. Une bonne réponse fait avancer le jeu (B devient A,
  un nouveau B est tiré) et incrémente la **série**.

## Source des données (SullyGnome)

SullyGnome n'envoie **aucun en-tête CORS** : un navigateur ne peut pas lire
ses réponses depuis une autre origine (GitHub Pages, localhost...). Le module
`scripts/data/sullygnome-client.js` passe donc par des **relais CORS**, tentés
**en parallèle** (`Promise.any`, première réponse valide gagnante) :

1. le relais personnel éventuellement configuré dans les Réglages ;
2. `api.allorigins.win` en variante `get` (enveloppe `{ contents, status }`) ;
3. `api.allorigins.win` en variante `raw` (corps brut).

L'ensemble est rejoué avec un léger backoff (les relais publics renvoient de
temps en temps des 522). **Aucun appel direct n'est tenté** depuis une origine
différente : c'est lui qui générait les erreurs CORS visibles dans la console.
Si tout le réseau échoue mais qu'une vieille copie existe dans le cache
IndexedDB, on la restitue quand même (les agrégats sur 20 ans évoluent très
peu) ; sinon l'application affiche une erreur explicite avec un bouton Réessayer.

### En 2 minutes : un relais personnel fiable

Les relais publics sont gratuits mais intermittents. Pour une stabilité
totale, un [Worker Cloudflare](https://dash.cloudflare.com/) de ~50 lignes est
fourni dans `worker/worker.js` (il ajoute les en-têtes CORS aux réponses de
SullyGnome et les met en cache côté Cloudflare). Déploiement :

1. Cloudflare → Workers & Pages → **Create** ;
2. coller le contenu de `worker/worker.js`, puis **Deploy** ;
3. coller l'URL obtenue (`https://<nom>.workers.dev`) dans
   **Réglages → Relais CORS personnel (optionnel)**.

Une fois configuré, l'application l'utilise en priorité (pas de dépendance aux
relais publics).

Points d'API utilisés (période = 7300 jours) :

```
GET /api/standardsearch/<pseudo>                          → ID interne SullyGnome
GET /api/tables/channeltables/games/7300/<id>/ /1/2/desc/0/100    → page 1 (100 jeux)
GET /api/tables/channeltables/games/7300/<id>/ /1/2/desc/100/100  → page 2 (100 jeux)
```

SullyGnome plafonne chaque page à 100 lignes : le top 200 est reconstruit en
fusionnant deux pages (offset 0 et 100). Si une page échoue, on conserve
l'autre plutôt que de tout perdre.

Le champ `streamtime` est exprimé en **minutes** (vérifié en septembre 2026).
Les images des jeux proviennent du CDN Twitch (champ `gamesplayed` de la
réponse, format `Nom|Slug|URL`), redimensionnées à 285x380.

## Architecture

```
index.html / game.html / settings.html   pages de l'application
styles/main.css                          style "aero" violet, variables dark/light
translations/{fr,en}.json                textes complets de l'application
scripts/
  models/        GameEntry, Streamer (objets métier)
  data/          database.js (IndexedDB + fallback mémoire, TTL 14 j),
                 settings-store.js (localStorage),
                 sullygnome-client.js (transport + proxys CORS),
                 streamer-repository.js (cache + chargement)
  business/      classic-game.js, compare-game.js (machines à états),
                 pool.js (sélection des jeux jouables)
  ui/            bootstrap (amorce commune), i18n, theme, dom, animations,
                 footer, toast, vues de jeu, scripts de page
docs/            cette documentation + notes d'exploration de l'API
```

### Règles suivies

- Aucun script inline dans le HTML : chaque page charge un petit module JS.
- Aucune donnée utilisateur injectée en HTML brut (`textContent` uniquement).
- Les réglages (thème, langue, dernier pseudo/mode) vivent en `localStorage` ;
  le cache des profils vit en `IndexedDB`.
- Si IndexedDB est indisponible, l'app bascule sur un cache mémoire : elle
  fonctionne sans persistance.
- Note : le cache est effaçable depuis la page Réglages.

## Lancer l'application

Les modules ES nécessitent un serveur HTTP pour les fichiers locaux
(ils sont bloqués en `file://` dans certains navigateurs) :

```
python -m http.server 8080     # puis http://localhost:8080
```

ou n'importe quel serveur statique (Live Server de VS Code, etc.).
Le site est en HTML/CSS/JS statique : il se déploie tel quel sur
GitHub Pages ou tout hébergeur statique (les chemins sont relatifs).

## Traductions

Chaque clé utilisée par le code est référencée dans `translations/fr.json`
et `translations/en.json`, avec interpolation `{variable}`. Le changement de
langue retraduit la page au vol.

## Crédits

Statistiques fournies par [SullyGnome](https://sullygnome.com/).
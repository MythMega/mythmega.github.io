# 21 — PWA, Service Worker et packaging stores

> La PWA est installable sur Chrome/Edge (desktop et Android) et préparée pour
> **PWABuilder**. Aucun build n'est nécessaire : tout reste statique.
>
> URL de déploiement : `https://web.jmdev.fr/projets/pokefeet/`

---

## 1. Fichiers ajoutés

| Fichier | Rôle |
|---|---|
| `manifest.webmanifest` | identité, scope, icônes, captures, raccourcis |
| `sw.js` | précache de l'app shell + stratégies réseau/cache |
| `js/pwa.js` | enregistrement du Service Worker |
| `offline.html` | page de repli hors ligne, autonome en CSS |
| `icons/` | icônes 192/512/1024, maskables, Apple, favicon, captures |
| `placeholder.txt` | liste des visuels/valeurs générés à personnaliser |

Le lint (`npm run lint`) vérifie désormais :

- la validité du manifeste et de ses URLs ;
- la présence et les dimensions réelles des icônes et captures ;
- l'orientation portrait, le mode standalone et les couleurs ;
- le scope résolu vers `/projets/pokefeet/` ;
- la syntaxe du Service Worker et l'existence de chaque fichier précaché ;
- la présence des balises PWA et de `js/pwa.js` sur les 21 pages.

---

## 2. Manifeste

Le manifeste utilise des chemins **relatifs** :

```json
"id": "./",
"start_url": "./",
"scope": "./"
```

Résolus depuis `https://web.jmdev.fr/projets/pokefeet/manifest.webmanifest`,
ils donnent exactement :

```text
start_url = https://web.jmdev.fr/projets/pokefeet/
scope     = https://web.jmdev.fr/projets/pokefeet/
```

C'est volontaire : les mêmes fichiers fonctionnent en local
(`http://127.0.0.1:5981/`) et en production, sans chemin absolu codé en dur.

Caractéristiques :

- `display: "standalone"` (barre d'adresse masquée) ;
- `display_override` avec `window-controls-overlay` puis repli standalone ;
- `orientation: "portrait"` ;
- `background_color` / `theme_color` : `#060c18` ;
- catégories `games`, `entertainment`, `education` ;
- 3 icônes `any` (192, 512, 1024) ;
- 2 icônes `maskable` (192, 512) ;
- captures `wide` et `narrow` ;
- raccourcis Daily, Weekly et Marathon.

---

## 3. Service Worker

### 3.1 Précache

`sw.js` précache environ 100 fichiers : les 21 pages, l'offline, le manifeste,
toutes les feuilles CSS, tous les scripts de `js/`, les traductions, la config,
les données Pokémon et les icônes utiles.

Le précache est **tolérant** : si un fichier manque, l'installation continue,
mais le lint échoue pour signaler l'écart.

### 3.2 Stratégies

| Requête | Stratégie | Repli |
|---|---|---|
| Navigation HTML | réseau d'abord | cache de la page, puis `offline.html` |
| `settings/`, `translations/`, `data/version.json`, manifeste | réseau d'abord | cache |
| JS, CSS, images, JSON, icônes | stale-while-revalidate | cache |

Les requêtes non-GET, cross-origin, `Range` et `sw.js` ne sont pas interceptées.

### 3.3 Mise à jour

Le cache est versionné :

```js
const CACHE_VERSION = 'pokefeet-v1';
```

Après une modification importante des fichiers précachés, incrémenter la
version. L'activation supprime les anciens caches `pokefeet-*`. Le Service
Worker appelle `skipWaiting()` et `clients.claim()` : la nouvelle version prend
la main sans attendre la fermeture des onglets.

`js/pwa.js` émet aussi l'événement `pokefeet:pwa-update` quand une mise à jour
est installée et qu'un contrôleur existe déjà. Il n'y a pas encore de bandeau
visuel : l'événement est disponible pour une future UI.

### 3.4 Hors ligne

Après une première visite, l'app shell complet est disponible hors ligne :

- accueil ;
- Daily / Weekly / Marathon / pages annexes ;
- CSS, JS et traductions ;
- données Pokémon principales.

Les **images de Pokémon** ne sont pas toutes précachées (plus de 1 500
fichiers). Elles sont mises en cache à la demande lors des parties. Une image
jamais consultée peut donc manquer hors ligne, sans empêcher la page de
s'afficher.

---

## 4. Enregistrement

Le script `js/pwa.js` est chargé sur toutes les pages, juste avant `</body>`.
Il :

- ne fait rien si `serviceWorker` est indisponible ;
- ne s'enregistre qu'en HTTPS ou sur localhost ;
- enregistre `sw.js` avec `scope: './'` ;
- écoute `updatefound` pour signaler une mise à jour.

Le Service Worker est à la racine de `/projets/pokefeet/`. C'est indispensable :
un fichier placé dans un sous-dossier ne pourrait pas contrôler tout le site.

---

## 5. Vérifications effectuées

### 5.1 Lint

```bash
npm run lint
```

Résultat attendu :

```text
✔ Lint OK — 22 HTML, 37 JS, 25 CSS, 12 JSON
```

Un test négatif (orientation `landscape`) a bien produit une erreur et un code
de sortie `1`, puis le manifeste a été restauré.

### 5.2 Chrome — chemin racine local

- `Page.getAppManifest` : aucune erreur ;
- `Page.getInstallabilityErrors` : tableau vide ;
- Service Worker `activated`, page contrôlée ;
- cache `pokefeet-v1-shell` : 102 entrées ;
- navigation hors ligne vers `/` et `/daily.html` : OK ;
- page inconnue hors ligne : `offline.html` affichée ;
- test final serveur arrêté : `offline.html` et `daily.html` s'affichent depuis
  le cache, avec le Service Worker toujours contrôleur.

### 5.3 Chrome — chemin exact `/projets/pokefeet/`

Le site a été servi depuis la racine du dépôt pour reproduire l'URL de
production :

```text
registrationScope = http://127.0.0.1:5983/projets/pokefeet/
resolvedStart     = http://127.0.0.1:5983/projets/pokefeet/
resolvedScope     = http://127.0.0.1:5983/projets/pokefeet/
installabilityErrors = []
```

Cela valide le scope, le start_url et l'enregistrement du Service Worker sur le
chemin de déploiement réel.

---

## 6. PWABuilder

Le manifeste contient les champs attendus par PWABuilder :

- `name`, `short_name`, `description`, `lang`, `dir` ;
- `id`, `start_url`, `scope` ;
- `display`, `display_override`, `orientation` ;
- `theme_color`, `background_color` ;
- `categories` ;
- icônes `any` et `maskable` en 192 et 512 ;
- captures `wide` et `narrow` ;
- raccourcis ;
- `prefer_related_applications: false`.

Étapes de packaging :

1. déployer le site en HTTPS ;
2. ouvrir `https://www.pwabuilder.com/` ;
3. saisir `https://web.jmdev.fr/projets/pokefeet/` ;
4. vérifier le score et les éventuels avertissements ;
5. générer le package Android (TWA) ou Windows.

Pour Android, PWABuilder génère un projet Trusted Web Activity qui pointe vers
l'URL ci-dessus. Il faudra fournir les assets d'icônes définitifs si le rendu
par défaut ne convient pas (voir `placeholder.txt`).

Pour iOS, l'installation passe par Safari → Partager → « Sur l'écran
d'accueil ». Le manifeste et `apple-touch-icon.png` sont déjà en place ; iOS
ignore `orientation` et certaines propriétés du manifeste.

---

## 7. Maintenance

- Après ajout/suppression d'une page, d'un script ou d'un CSS : mettre à jour
  `PRECACHE_URLS` dans `sw.js`, puis lancer le lint. Il signalera tout fichier
  manquant.
- Après modification d'un asset : incrémenter `CACHE_VERSION`.
- Si l'URL de déploiement change : mettre à jour `DEPLOY_URL` dans
  `scripts/lint.mjs` (ligne indiquée dans `placeholder.txt`). Les fichiers de
  l'application restent en relatif.
- Ne pas mettre `sw.js` dans un sous-dossier : sa portée par défaut serait
  limitée à ce dossier.

---

## 8. Limites connues

- Pas de tests automatisés de la PWA dans le dépôt ; les vérifications Chrome
  ci-dessus sont manuelles et reproductibles via DevTools.
- Les captures d'écran sont des captures réelles de l'accueil, pas encore des
  visuels marketing de gameplay.
- Le mode `window-controls-overlay` n'est pas supporté par tous les navigateurs ;
  le repli `standalone` est utilisé.
- Les images Pokémon ne sont pas toutes disponibles hors ligne (cache à la
  demande).

# Déploiement

## Site statique

Bulkut n'a besoin ni de build ni de serveur applicatif : ce sont des fichiers
statiques (`index.html`, `pro.html`, CSS, modules ES, JSON, wasm). N'importe
quel hébergement statique convient (GitHub Pages, Netlify, Cloudflare Pages, un
simple `python -m http.server`).

Les pages sont autonomes et partagent les mêmes scripts :

- `https://exemple/…/index.html` : mode mémoire ;
- `https://exemple/…/pro.html` : mode OPFS ;
- `https://exemple/…/download.html` : téléchargement du logiciel desktop.

Tous les chemins sont **relatifs** et résolus depuis la page courante
(`document.baseURI`). L'application fonctionne donc aussi bien à la racine d'un
domaine que dans un sous-dossier, par exemple
`https://exemple.github.io/projets/bulkut/pro.html`.

### OPFS et contexte sécurisé

`pro.html` utilise `navigator.storage.getDirectory()` (OPFS), qui exige un
**contexte sécurisé** : HTTPS ou `http://localhost` / `http://127.0.0.1`. GitHub
Pages, Netlify et Cloudflare Pages sont en HTTPS, donc aucun réglage
supplémentaire n'est nécessaire. Si l'API est absente, la page affiche une
erreur explicite et invite à utiliser `index.html`.

Contraintes d'hébergement :

- servir `.wasm` avec un type correct (`application/wasm`) n'est pas critique
  ici, car le core et le wasm sont chargés via des blob URLs, mais c'est
  préférable ;
- ne pas activer `Cross-Origin-Embedder-Policy: require-corp` sans raison : le
  core single-thread n'a pas besoin de `SharedArrayBuffer`, et un COEP strict
  pourrait bloquer des ressources ;
- autoriser les workers same-origin (comportement par défaut).

## Binaires natifs

Les exécutables et l'APK ne sont pas inclus dans le dépôt (60 à 70 Mo chacun).
Compiler avec `software/build.bat`, puis joindre les cinq fichiers de
`software/dist/` à une release GitHub. `settings/config.json` pointe vers
`releases/latest/download` ; `download.html` construit les liens à partir de ces
noms. Voir [desktop.md](desktop.md) et [android.md](android.md).

## GitHub Pages

1. Placer le dossier de l'application dans le dépôt (par exemple
   `projets/bulkut/`).
2. Pousser sur la branche publiée par Pages (`main` ou `gh-pages` selon la
   configuration du dépôt).
3. Dans *Settings → Pages*, choisir la source (branche + dossier racine) et
   enregistrer.
4. Ouvrir l'URL du dossier, avec un slash final.

Taille à prévoir : environ **31 Mo** pour `vendor/ffmpeg/ffmpeg-core.wasm`,
plus le reste (négligeable). La limite de 100 Mo par fichier de GitHub et le
quota de 1 Go par dépôt sont respectés.

### Mise en cache

GitHub Pages applique ses propres en-têtes de cache. Après une mise à jour de
`vendor/ffmpeg/`, forcer le rechargement (Ctrl+F5) ou renommer les fichiers du
core et mettre à jour `settings/config.json` (`assets.ffmpegCore` /
`assets.ffmpegWasm`) pour casser le cache.

### Vérifications avant publication

```bash
npm test
```

Puis, en local :

```bash
python -m http.server 8424
```

- charger `index.html` et `pro.html`, vérifier la console (aucune 404) ;
- lancer un petit rendu Autocut et un extrait ;
- annuler un extrait, puis tester « Passer l'actuel », « Annuler les suivants »
  et « Tout arrêter » sur une file de plusieurs vidéos ;
- activer le pré-calcul de durée et vérifier qu'il se relance 3 s après un
  changement de réglages globaux ;
- tester Fastcut et Reverse ;
- dans Collage, ajouter deux clips, en déplacer un par glisser-déposer (et aux
  flèches), vérifier la durée totale puis lancer le rendu ;
- dans Intro/Outro, ajouter une intro et un outro, vérifier la durée prévue en
  changeant le mode d'une ligne, puis rendre une vidéo ;
- vérifier l'ETA et la progression pendant un rendu un peu long (analyse ≤ 5 %
  de la barre Autocut, pas de saut final) ;
- sur `pro.html`, importer une vidéo, vérifier qu'elle apparaît dans l'OPFS et
  lancer un rendu (le montage WORKERFS doit fonctionner) ;
- changer de langue sur les deux pages.

## Droits et licences

`@ffmpeg/core` est distribué en **GPL-2.0-or-later** (FFmpeg compilé avec des
composants GPL). Redistribuer ce build sur un site public implique de respecter
la GPL ; les sources et informations sont rappelées dans
[`vendor/ffmpeg/README.md`](../vendor/ffmpeg/README.md).

## Limites d'exploitation

- Une seule instance ffmpeg.wasm, donc **un rendu à la fois**. Une annulation
  termine le worker : le rendu suivant recharge le core (quelques secondes).
- Mémoire limitée par le navigateur : sur `index.html`, les très gros fichiers
  peuvent échouer même sous la limite d'import (surtout Reverse). Sur
  `pro.html`, l'entrée est lue depuis l'OPFS, mais la sortie et le filtre sont
  toujours en mémoire wasm.
- La taille du stockage OPFS dépend du quota accordé au site ; les fichiers y
  restent jusqu'à la suppression de la ligne ou des données du site.
- Le premier rendu télécharge 31 Mo de wasm : prévoir un temps de chargement et
  éventuellement un cache navigateur.

# Déploiement

## Site statique

Bulkut n'a besoin ni de build ni de serveur applicatif : ce sont des fichiers
statiques (`index.html`, CSS, modules ES, JSON, wasm). N'importe quel
hébergement statique convient (GitHub Pages, Netlify, Cloudflare Pages, un
simple `python -m http.server`).

Tous les chemins sont **relatifs** et résolus depuis `index.html`
(`document.baseURI`). L'application fonctionne donc aussi bien à la racine d'un
domaine que dans un sous-dossier, par exemple
`https://exemple.github.io/projets/bulkut/`.

Contraintes d'hébergement :

- servir `.wasm` avec un type correct (`application/wasm`) n'est pas critique
  ici, car le core et le wasm sont chargés via des blob URLs, mais c'est
  préférable ;
- ne pas activer `Cross-Origin-Embedder-Policy: require-corp` sans raison : le
  core single-thread n'a pas besoin de `SharedArrayBuffer`, et un COEP strict
  pourrait bloquer des ressources ;
- autoriser les workers same-origin (comportement par défaut).

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

- charger l'application et vérifier la console (aucune 404) ;
- lancer un petit rendu Autocut et un extrait ;
- tester Fastcut et Reverse ;
- changer de langue.

## Droits et licences

`@ffmpeg/core` est distribué en **GPL-2.0-or-later** (FFmpeg compilé avec des
composants GPL). Redistribuer ce build sur un site public implique de respecter
la GPL ; les sources et informations sont rappelées dans
[`vendor/ffmpeg/README.md`](../vendor/ffmpeg/README.md).

## Limites d'exploitation

- Une seule instance ffmpeg.wasm, donc **un rendu à la fois**.
- Mémoire limitée par le navigateur : les très gros fichiers peuvent échouer
  même sous la limite d'import (surtout Reverse).
- Le premier rendu télécharge 31 Mo de wasm : prévoir un temps de chargement et
  éventuellement un cache navigateur.

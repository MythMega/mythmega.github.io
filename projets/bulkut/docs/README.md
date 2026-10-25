# Documentation Bulkut

Bulkut est une application web **mono-page** de montage vidéo qui tourne
entièrement dans le navigateur grâce à [ffmpeg.wasm](https://ffmpegwasm.netlify.app/).
Aucun fichier n'est envoyé à un serveur : les vidéos sont lues, découpées et
réencodées dans le worker WebAssembly local, puis téléchargées.

## Les trois outils

| Onglet | Rôle | Documentation |
| --- | --- | --- |
| **Autocut** | Détecte les silences de plusieurs vidéos et assemble les passages parlés, avec des marges avant/après et une durée minimale de clip. | [autocut.md](autocut.md) |
| **Fastcut** | Découpe un extrait précis d'une vidéo, au timecode ou au pourcentage. | [fastcut.md](fastcut.md) |
| **Reverser** | Inverse la vidéo et son audio. | [reverse.md](reverse.md) |

## Démarrage rapide

L'application est statique (HTML/CSS/JS, sans build). Il faut simplement la
servir en HTTP, car les modules ES et le worker ffmpeg.wasm ne fonctionnent pas
en `file://`.

```bash
# Python 3
python -m http.server 8424

# ou avec npm
npm start
```

Puis ouvrir <http://localhost:8424>. Sous Windows, `start_server.cmd` fait la
même chose et ouvre le navigateur.

Les tests unitaires (mathématiques des silences, commandes FFmpeg, traductions)
se lancent avec :

```bash
npm test
```

## Arborescence

```
index.html                 page unique, les trois onglets
settings/config.json       configuration de l'application (chemins, limites, codecs)
settings/default.json      valeurs par défaut des paramètres de traitement
translations/{en,fr,es}.json
styles/                    base (tokens/reset), layout, components
script/
  main.js                  bootstrap, onglets, langues, statut du moteur
  core/                    configuration, i18n, ffmpeg.wasm, files, queue
  ui/                      composants réutilisables (sliders, dropzone, toasts…)
  features/
    autocut/               analyse des silences, rendu, liste, extrait
    fastcut/               découpe précise
    reverse/               inversion
    shared/                validation d'import et probe FFmpeg
vendor/ffmpeg/             ffmpeg.wasm 0.12.15 + core single-thread 0.12.10
docs/                      cette documentation
tests/                     tests Node (node:test)
```

## Contraintes assumées

- **Une vidéo à la fois** : une seule instance ffmpeg.wasm, une queue
  séquentielle (`script/core/task-queue.js`). Le build single-thread ne permet
  pas de paralléliser sans multiplier la mémoire.
- **Mémoire du navigateur** : les fichiers sont copiés dans le système de
  fichiers en mémoire de ffmpeg.wasm. La limite d'import est de 512 Mo par
  défaut (`settings/config.json`, `processing.maxFileSizeMb`), et l'inversion
  est gourmande (tout le clip est bufferisé).
- **Pas de `SharedArrayBuffer`** : le core single-thread fonctionne sur un
  hébergement statique classique (GitHub Pages), sans en-têtes COOP/COEP.
- **Licence** : `@ffmpeg/core` est en GPL-2.0-or-later (voir
  [`vendor/ffmpeg/README.md`](../vendor/ffmpeg/README.md)).

## Pour aller plus loin

- [Architecture](architecture.md)
- [Configuration et traductions](configuration.md)
- [Déploiement](deployment.md)

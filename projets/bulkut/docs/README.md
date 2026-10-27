# Documentation Bulkut

Bulkut est une application web de montage vidéo qui tourne entièrement dans le
navigateur grâce à [ffmpeg.wasm](https://ffmpegwasm.netlify.app/). Aucun
fichier n'est envoyé à un serveur : les vidéos sont lues, découpées et
réencodées dans le worker WebAssembly local, puis téléchargées.

Trois pages partagent le même code et les mêmes six outils :

- [`index.html`](../index.html) : import classique, la vidéo est copiée dans le
  système de fichiers en mémoire de ffmpeg.wasm (limite
  `processing.maxFileSizeMb`).
- [`pro.html`](../pro.html) : import via l'**OPFS** du navigateur, monté en
  lecture seule dans FFmpeg (WORKERFS). La limite de taille d'import ne
  s'applique plus et les octets ne sont pas recopiés dans le wasm.
- [`download.html`](../download.html) : choix et téléchargement des
  applications natives (Windows, Linux, macOS, Android), FFmpeg embarqué.

Voir [pro-opfs.md](pro-opfs.md) pour le détail du mode Pro.

## Les six outils

| Onglet | Rôle | Documentation |
| --- | --- | --- |
| **Autocut** | Détecte les silences de plusieurs vidéos et assemble les passages parlés, avec des marges avant/après et une durée minimale de clip. | [autocut.md](autocut.md) |
| **Fastcut** | Découpe un extrait précis d'une vidéo, au timecode ou au pourcentage. | [fastcut.md](fastcut.md) |
| **Reverser** | Inverse la vidéo et son audio. | [reverse.md](reverse.md) |
| **Collage** | Met plusieurs clips bout à bout, dans un ordre modifiable par glisser-déposer, et affiche la durée totale. | [collage.md](collage.md) |
| **Intro / Outro** | Ajoute une intro et/ou un outro communs à chaque vidéo d'une liste, rendue séparément avec sa durée prévue. | [intro-outro.md](intro-outro.md) |
| **Splitter** | Découpe une vidéo en autant de segments que voulu, chacun exporté dans son propre fichier. | [splitter.md](splitter.md) |

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

Les tests unitaires (mathématiques des silences, concaténation et normalisation,
commandes FFmpeg, progression/ETA, timecodes, traductions) se lancent avec :

```bash
npm test
```

## Arborescence

```
index.html                 page standard, les six onglets
pro.html                   même page avec import OPFS
download.html              téléchargement des applications natives
settings/config.json       configuration de l'application (chemins, limites, codecs)
settings/default.json      valeurs par défaut des paramètres de traitement
translations/{en,fr,es}.json
styles/                    base (tokens/reset), layout, components
script/
  main.js                  bootstrap, onglets, langues, statut du moteur
  core/                    configuration, i18n, ffmpeg.wasm, sources, queue
  ui/                      composants réutilisables (sliders, dropzone, toasts…)
  features/
    autocut/               analyse des silences, rendu, liste, extrait
    fastcut/               découpe précise
    reverse/               inversion
    collage/               assemblage ordonné de plusieurs clips
    introoutro/            intro/outro communs, rendus par vidéo
    splitter/              découpe en segments indépendants
    shared/                import, concaténation, probe FFmpeg
vendor/ffmpeg/             ffmpeg.wasm 0.12.15 + core single-thread 0.12.10
docs/                      cette documentation
tests/                     tests Node (node:test)
software/                  applications Avalonia (desktop, Android) + tests .NET
```

## Contraintes assumées

- **Une vidéo à la fois** : une seule instance ffmpeg.wasm, une queue
  séquentielle (`script/core/task-queue.js`). Le build single-thread ne permet
  pas de paralléliser sans multiplier la mémoire.
- **Mémoire du navigateur** : sur `index.html`, les fichiers sont copiés dans
  le système de fichiers en mémoire de ffmpeg.wasm. La limite d'import est de
  2048 Mo par défaut (`settings/config.json`, `processing.maxFileSizeMb`), et
  l'inversion est gourmande (tout le clip est bufferisé). Sur `pro.html`, les
  octets restent dans l'OPFS et FFmpeg les lit à la demande, mais la sortie est
  encore écrite en mémoire.
- **Pas de `SharedArrayBuffer`** : le core single-thread fonctionne sur un
  hébergement statique classique (GitHub Pages), sans en-têtes COOP/COEP.
- **Licence** : `@ffmpeg/core` est en GPL-2.0-or-later (voir
  [`vendor/ffmpeg/README.md`](../vendor/ffmpeg/README.md)).

## Pour aller plus loin

- [Architecture](architecture.md)
- [Presets](presets.md)
- [Fondus audio et vidéo](fades.md)
- [Mode Pro et OPFS](pro-opfs.md)
- [Collage](collage.md)
- [Intro / Outro](intro-outro.md)
- [Splitter](splitter.md)
- [Configuration et traductions](configuration.md)
- [Application desktop](desktop.md)
- [Application Android](android.md)
- [Déploiement](deployment.md)

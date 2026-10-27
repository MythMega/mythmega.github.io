# Bulkut

Application web statique de montage vidéo **100 % locale** : les fichiers sont
traités dans le navigateur par ffmpeg.wasm et ne sont jamais envoyés à un
serveur.

Six outils, six onglets :

- **Autocut** — retire les silences d'une liste de vidéos, avec un seuil, des
  marges avant/après et une durée minimale de clip réglables globalement ou
  vidéo par vidéo. Extrait d'une minute au milieu pour vérifier le rendu,
  pré-calcul de la durée de sortie (manuel ou automatique après 3 s), contrôles
  de file (passer le rendu en cours, annuler les suivants, tout arrêter) et
  sortie au choix : MP4, séquence Premiere Pro (`.xml`) ou timeline DaVinci
  Resolve (`.fcpxml`), globalement ou vidéo par vidéo.
- **Fastcut** — découpe un extrait précis d'une vidéo avec deux sliders 0–100 %
  synchronisés avec des timecodes `hh:mm:ss`.
- **Reverser** — inverse la vidéo et son audio.
- **Collage** — met plusieurs clips bout à bout, dans un ordre modifiable par
  glisser-déposer (ou avec les flèches), avec la durée totale mise à jour à
  chaque ajout, retrait ou déplacement.
- **Intro / Outro** — ajoute une intro et/ou un outro communs à chaque vidéo
  d'une liste, avec un mode par vidéo (intro seule, outro seul, ou les deux) et
  la durée prévue recalculée à chaque changement. Chaque vidéo est rendue et
  téléchargée séparément.
- **Splitter** — découpe une vidéo en autant de segments que voulu, avec un
  début et une fin par segment ; chaque segment est exporté séparément.

Chaque onglet propose un fondu audio et/ou vidéo (entrée, sortie, les deux),
appliqué une fois sur le fichier final.

Deux pages web, mêmes fonctionnalités : [`index.html`](index.html) (import en
mémoire) et [`pro.html`](pro.html) (import **OPFS** monté en lecture seule dans
FFmpeg, sans la limite de taille d'import). Une troisième page,
[`download.html`](download.html), propose les applications natives pour
Windows, Linux, macOS et Android : un exécutable unique avec FFmpeg embarqué,
ou un APK qui embarque FFmpegKit.

Interface en anglais, français et espagnol (détection automatique de la langue,
bouton de changement). Design blanc/bleu nuit, cadres vitrés, animations
fluides.

## Démarrage

```bash
python -m http.server 8424
# ou
npm start
```

Ouvrir <http://localhost:8424>. Sous Windows, double-cliquer sur
`start_server.cmd`.

> Un serveur HTTP est nécessaire : les modules ES et le worker ffmpeg.wasm ne
> fonctionnent pas en `file://`.

## Tests

```bash
npm test
```

Les tests couvrent les maths de l'autocut, la normalisation/concaténation, les
commandes FFmpeg générées, le parsing de progression/ETA, les timecodes et la
parité des traductions.

## Documentation

Toute la documentation est dans [`docs/`](docs/README.md) :

- [Architecture](docs/architecture.md)
- [Mode Pro et OPFS](docs/pro-opfs.md)
- [Autocut](docs/autocut.md) · [Fastcut](docs/fastcut.md) · [Reverse](docs/reverse.md)
- [Collage](docs/collage.md) · [Intro / Outro](docs/intro-outro.md) · [Splitter](docs/splitter.md) · [Fondus](docs/fades.md)
- [Presets](docs/presets.md)
- [Configuration et traductions](docs/configuration.md)
- [Application desktop](docs/desktop.md)
- [Déploiement](docs/deployment.md)

## Structure rapide

```
index.html                # page standard
pro.html                  # page Pro (OPFS)
download.html             # téléchargement desktop
settings/config.json      # configuration de l'app
settings/default.json     # valeurs par défaut
translations/             # en.json, fr.json, es.json
styles/                   # tokens, layout, composants
script/core/              # settings, i18n, ffmpeg, queue, fichiers, temps
script/ui/                # sliders, dropzone, dialog, toasts
script/features/          # autocut, fastcut, reverse, collage, introoutro, shared
vendor/ffmpeg/            # ffmpeg.wasm 0.12.15 + core single-thread 0.12.10
docs/                     # documentation
tests/                    # tests Node
software/                 # application desktop Avalonia (.NET 10)
```

## Limites

- Un seul rendu à la fois (une instance ffmpeg.wasm, build single-thread).
- `index.html` copie les fichiers en mémoire : 2048 Mo maximum par défaut,
  beaucoup moins pour Reverse qui bufferise tout le clip. `pro.html` monte
  l'OPFS et n'a pas cette limite à l'import, mais la sortie reste en mémoire.
- Compatible hébergement statique sans `SharedArrayBuffer` (GitHub Pages).
- `@ffmpeg/core` est sous GPL-2.0-or-later ; voir
  [`vendor/ffmpeg/README.md`](vendor/ffmpeg/README.md).

# Bulkut

Application web mono-page de montage vidéo **100 % locale** : les fichiers sont
traités dans le navigateur par ffmpeg.wasm et ne sont jamais envoyés à un
serveur.

Trois outils, trois onglets :

- **Autocut** — retire les silences d'une liste de vidéos, avec un seuil, des
  marges avant/après et une durée minimale de clip réglables globalement ou
  vidéo par vidéo. Extrait d'une minute au milieu pour vérifier le rendu.
- **Fastcut** — découpe un extrait précis d'une vidéo avec deux sliders 0–100 %
  synchronisés avec des timecodes `hh:mm:ss`.
- **Reverser** — inverse la vidéo et son audio.

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

Les tests couvrent les maths de l'autocut, les commandes FFmpeg générées, les
timecodes et la parité des traductions.

## Documentation

Toute la documentation est dans [`docs/`](docs/README.md) :

- [Architecture](docs/architecture.md)
- [Autocut](docs/autocut.md) · [Fastcut](docs/fastcut.md) · [Reverse](docs/reverse.md)
- [Configuration et traductions](docs/configuration.md)
- [Déploiement](docs/deployment.md)

## Structure rapide

```
index.html
settings/config.json      # configuration de l'app
settings/default.json     # valeurs par défaut
translations/             # en.json, fr.json, es.json
styles/                   # tokens, layout, composants
script/core/              # settings, i18n, ffmpeg, queue, fichiers, temps
script/ui/                # sliders, dropzone, dialog, toasts
script/features/          # autocut, fastcut, reverse, shared
vendor/ffmpeg/            # ffmpeg.wasm 0.12.15 + core single-thread 0.12.10
docs/                     # documentation
tests/                    # tests Node
```

## Limites

- Un seul rendu à la fois (une instance ffmpeg.wasm, build single-thread).
- Les fichiers sont copiés en mémoire : 512 Mo maximum par défaut, beaucoup
  moins pour Reverse qui bufferise tout le clip.
- Compatible hébergement statique sans `SharedArrayBuffer` (GitHub Pages).
- `@ffmpeg/core` est sous GPL-2.0-or-later ; voir
  [`vendor/ffmpeg/README.md`](vendor/ffmpeg/README.md).

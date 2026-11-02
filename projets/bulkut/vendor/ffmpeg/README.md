# ffmpeg.wasm vendoré

Ces fichiers sont copiés tels quels depuis npm, afin que l'application
fonctionne **entièrement en local**, sans CDN ni requête réseau externe.

| Paquet | Version | Fichiers | Licence |
| --- | --- | --- | --- |
| [`@ffmpeg/ffmpeg`](https://www.npmjs.com/package/@ffmpeg/ffmpeg) | 0.12.15 | `ffmpeg.js`, `814.ffmpeg.js` | MIT |
| [`@ffmpeg/core`](https://www.npmjs.com/package/@ffmpeg/core) | 0.12.10 | `ffmpeg-core.js`, `ffmpeg-core.wasm` | GPL-2.0-or-later |

Le build `@ffmpeg/core` utilisé est le build **single-thread** (`dist/umd`).
Il ne dépend pas de `SharedArrayBuffer` et ne nécessite donc pas les en-têtes
`Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy`. C'est ce qui lui
permet de fonctionner sur GitHub Pages.

`ffmpeg.js` est le build UMD : il cherche automatiquement `814.ffmpeg.js` à côté
de lui-même (même dossier), et charge `ffmpeg-core.js` / `ffmpeg-core.wasm` via
les URLs passées à `ffmpeg.load()` dans `script/core/ffmpeg-service.js`.

## Licences

- `@ffmpeg/ffmpeg` est distribué sous licence MIT.
- `@ffmpeg/core` est distribué sous **GPL-2.0-or-later**, car il embarque FFmpeg
  compilé avec des composants GPL (dont x264). La redistribution de ce build
  implique le respect de la GPL ; les sources sont disponibles ici :
  - https://github.com/ffmpegwasm/ffmpeg.wasm
  - https://ffmpeg.org/download.html

Pour mettre à jour : récupérer les nouveaux `dist/umd/ffmpeg.js`,
`dist/umd/814.ffmpeg.js` et `dist/umd/ffmpeg-core.{js,wasm}`, puis vérifier que
`ffmpeg.load()` reçoit toujours `coreURL` et `wasmURL`.

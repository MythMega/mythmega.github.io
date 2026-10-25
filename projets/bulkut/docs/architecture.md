# Architecture

## Cycle de démarrage

`script/main.js` orchestre le chargement :

1. `loadSettings()` lit `settings/config.json`, puis `settings/default.json`
   (chemin indiqué par `assets.settingsDefaults`). Les réglages sauvegardés
   dans `localStorage` sont fusionnés par-dessus les valeurs par défaut.
2. `I18n.init()` choisit la langue (stockage local → `navigator.languages` →
   anglais) et charge le JSON correspondant + l'anglais de secours.
3. Les services sont créés : `FFmpegService` (paresseux), `TaskQueue`
   (concurrence 1), `Toasts`.
4. Chaque fonctionnalité reçoit un `AppContext` et son panneau DOM, puis
   construit ses contrôles.
5. Les onglets, le sélecteur de langue et le statut du moteur sont câblés.
6. `window.Bulkut` expose les objets utiles au débogage et aux tests.

## Modules

| Fichier | Responsabilité |
| --- | --- |
| `script/core/settings.js` | Lecture/validation de la configuration, fusion profonde, persistance `localStorage`. |
| `script/core/i18n.js` | Chargement des traductions, détection de langue, `t()`, application au DOM. |
| `script/core/ffmpeg-service.js` | Chargement du core wasm, exécution des commandes, progression, fichiers MEMFS. |
| `script/core/task-queue.js` | File séquentielle globale (une tâche active). |
| `script/core/media.js` | Noms de fichiers, suffixes, téléchargements, durée via `<video>`. |
| `script/core/media-probe.js` | Lecture de `Duration:` / `Audio:` / `Video:` depuis les logs FFmpeg. |
| `script/core/timecode.js` | Conversion et formatage timecode, arrondis (fonctions pures). |
| `script/core/app-error.js` | Erreurs traduisibles (`errors.<code>`) et formatage utilisateur. |
| `script/ui/slider-field.js` | Slider + champ numérique synchronisés, validation à la perte de focus. |
| `script/ui/dropzone.js` | Import par clic, clavier, glisser-déposer. |
| `script/ui/dialog.js` | Ouverture/fermeture du `<dialog>` natif. |
| `script/ui/toasts.js` | Notifications. |
| `script/features/*` | Un dossier par outil : logique FFmpeg, vue de liste, contrôleur. |

Chaque fonctionnalité suit le même découpage :

- **processor** : entrées/sorties FFmpeg (écriture MEMFS, commande, lecture du
  résultat, nettoyage) et progression.
- **view** : construction/mise à jour du DOM d'une ligne ou d'une scène.
- **feature** : état, événements, file d'attente, traductions dynamiques.

Les maths de l'autocut sont isolées dans
`script/features/autocut/silence.js` (fonctions pures, testées).

## FFmpeg.wasm

`FFmpegService` ne charge le moteur qu'au premier rendu (31 Mo de wasm) :

```js
await ffmpeg.load({
  coreURL: await toBlobURL('vendor/ffmpeg/ffmpeg-core.js', 'text/javascript'),
  wasmURL: await toBlobURL('vendor/ffmpeg/ffmpeg-core.wasm', 'application/wasm'),
});
```

- Le build UMD charge son worker `814.ffmpeg.js` depuis le même dossier.
- Le core est **single-thread** : pas de `SharedArrayBuffer`, pas d'en-têtes
  COOP/COEP, donc compatible GitHub Pages.
- Les fichiers importés sont copiés dans le système de fichiers en mémoire
  (`writeFile`), puis supprimés dans un `finally`.
- La progression est calculée en parsant les lignes `time=HH:MM:SS.xx` des logs
  FFmpeg et en les divisant par la durée connue. Le ratio est limité à `[0,1]`
  et émis au maximum toutes les ~120 ms.
- Les codes de sortie non nuls lèvent `AppError('renderFailed')` ; les logs
  récents sont écrits dans la console pour le diagnostic.

## File d'attente

`TaskQueue` accepte des tâches `{ id, label, run }` et n'en exécute qu'une à la
fois. `enqueue()` renvoie une promesse résolue/rejetée à la fin de la tâche.
Les trois onglets partagent la même instance : lancer un rendu Autocut pendant
un Fastcut met la tâche en attente.

Les boutons « Lancer » se désactivent tant que la queue est occupée, et la
suppression/configuration d'une vidéo en cours est bloquée.

## État et persistance

- Les paramètres globaux (Autocut) et les suffixes sont dans
  `settings.params` et sauvegardés sous `localStorage["bulkut.params"]`.
- La langue choisie est sauvegardée sous `localStorage["bulkut.lang"]`.
- Les vidéos importées, les overrides par vidéo et les résultats ne sont pas
  persistés : un rechargement repart de zéro (les `File` ne sont pas
  sérialisables et restent en mémoire).

## Traductions dynamiques

Les textes statiques utilisent `data-i18n`, `data-i18n-placeholder`,
`data-i18n-title` et `data-i18n-aria-label`. Les textes dynamiques (statuts,
noms, erreurs) sont regénérés par les contrôleurs lors du changement de langue
via `feature.refresh()`.

## Hooks de débogage

`window.Bulkut` expose `settings`, `i18n`, `ffmpeg`, `queue` et `features`.
Chaque fonctionnalité expose au minimum `refresh()` et, pour les imports,
`addFiles(files)`. Cela permet de piloter l'application depuis la console sans
simuler un sélecteur de fichiers.

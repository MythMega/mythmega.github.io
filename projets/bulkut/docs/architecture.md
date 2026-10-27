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
| `script/core/ffmpeg-service.js` | Chargement du core wasm, exécution des commandes, progression, fichiers MEMFS, montage WORKERFS, annulation. |
| `script/core/ffmpeg-stats.js` | Parsing pur des lignes de stats (`time=`, `speed=`, `fps=`, `frame=`) et estimation de l'ETA. |
| `script/core/file-source.js` | Abstraction des entrées : source mémoire (`index.html`) ou OPFS montée en WORKERFS (`pro.html`). |
| `script/core/task-queue.js` | File séquentielle globale (une tâche active). |
| `script/core/media.js` | Noms de fichiers, suffixes, téléchargements, durée via `<video>`. |
| `script/core/media-probe.js` | Lecture de `Duration:` / `Audio:` / `Video:` / résolution / fps depuis les logs FFmpeg. |
| `script/core/output-format.js` | Formats de sortie Autocut (`video`, `premiere`, `davinci`), extensions et clés de traduction. |
| `script/core/timecode.js` | Conversion et formatage timecode, arrondis (fonctions pures). |
| `script/core/fade.js` | Modes et filtres `fade` / `afade` appliqués au fichier final. |
| `script/core/app-error.js` | Erreurs traduisibles (`errors.<code>`) et formatage utilisateur. |
| `script/core/presets.js` | Presets nommés par onglet : noms uniques, encodage/décodage du cookie (sans DOM hors helpers). |
| `script/ui/slider-field.js` | Slider + champ numérique synchronisés, validation à la perte de focus. |
| `script/ui/dropzone.js` | Import par clic, clavier, glisser-déposer. |
| `script/ui/dialog.js` | Ouverture/fermeture du `<dialog>` natif. |
| `script/ui/fade-control.js` | Sélecteurs de fondu audio/vidéo et durée partagée. |
| `script/ui/preset-manager.js` | Boutons, popups de sauvegarde/chargement et suppression des presets, partagés par les six onglets. |
| `script/ui/toasts.js` | Notifications. |
| `script/features/shared/concat.js` | Normalisation et concaténation : graphe de filtres et arguments FFmpeg (fonctions pures). |
| `script/features/shared/concat-processor.js` | Pipeline commun à Collage et Intro/Outro : attache, probe, rendu, résultat. |
| `script/features/shared/import-video.js` | Validation, stockage et lecture de durée partagés par les onglets à liste. |
| `script/features/*` | Un dossier par outil : logique FFmpeg, vue de liste, contrôleur. |

Chaque fonctionnalité suit le même découpage :

- **processor** : entrées/sorties FFmpeg (écriture MEMFS, commande, lecture du
  résultat, nettoyage) et progression.
- **view** : construction/mise à jour du DOM d'une ligne ou d'une scène.
- **feature** : état, événements, file d'attente, traductions dynamiques.

Les maths de l'autocut sont isolées dans
`script/features/autocut/silence.js` (fonctions pures, testées). Les sorties
éditeur (Premiere XML et DaVinci FCPXML) sont dans
`script/features/autocut/timeline-export.js`, également sans DOM ni FFmpeg.

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
- Les fichiers importés ne sont pas forcément copiés : les processeurs
  reçoivent une **source** (`script/core/file-source.js`) qui expose
  `attach(ffmpeg)` et un chemin lisible par FFmpeg.
  - `index.html` utilise `createMemorySource` : le `File` est copié dans MEMFS
    avec `writeFile`, puis supprimé dans un `finally`.
  - `pro.html` utilise `createOpfsSource` : le fichier est écrit dans l'OPFS par
    morceaux, puis monté en lecture seule avec `WORKERFS`. FFmpeg lit les
    octets à la demande depuis le disque du navigateur, sans les recopier dans
    la mémoire wasm.
- La progression est calculée en parsant les lignes `time=HH:MM:SS.xx` des logs
  FFmpeg et en les divisant par la durée **de sortie** connue. Le ratio est
  monotone, limité à `[0,1]`, et émis au maximum toutes les 250 ms.
- Les codes de sortie non nuls lèvent `AppError('renderFailed')` ; les logs
  récents sont écrits dans la console pour le diagnostic.
- `cancel()` incrémente une génération, termine le worker et réinitialise
  l'instance. Une commande ou un `load()` lancé avant l'annulation est
  abandonné (et son instance terminée) au lieu de réapparaître ; le rendu
  suivant recharge le core.
- Chaque tâche annulable transporte un **jeton** (`{ cancelled }`) vérifié
  avant chaque opération (chargement, écriture, montage, analyse, rendu). Il
  empêche un processeur déjà annulé de relancer un chargement ou une copie
  après le passage de `cancel()`. Les sources et les processeurs propagent ce
  jeton jusqu'aux appels FFmpeg.

## Progression et ETA

`FFmpegService` ne se contente pas du pourcentage : chaque ligne de stats passe
par `parseStatsLine()` (`script/core/ffmpeg-stats.js`), qui extrait la position
`time=`, la vitesse `speed=`, les images et les fps. `run()` transmet à
`onProgress(ratio, stats)` :

```js
{ seconds, speed, fps, frame, etaSeconds }
```

Points importants pour la précision :

- **La durée passée à `run()` doit être celle de la sortie**, pas celle de
  l'entrée. Pour Autocut, les silences supprimés raccourcissent la sortie :
  utiliser la durée source bloquait la barre et faisait sauter la fin d'un
  coup. Le processeur passe donc la somme des segments conservés.
- Le ratio est borné au maximum déjà atteint : une ligne dupliquée ou légèrement
  en retard ne fait pas reculer la barre.
- L'ETA combine la vitesse instantanée lissée (`speed=`) et le temps écoulé
  rapporté à la progression. Le second estimateur est ignoré sous 2 % de
  progression, où il n'est pas représentatif. `0` signifie « inconnu ».
- L'affichage (`~1:12 restant`) est mis à jour au plus toutes les 250 ms ;
  Autocut, Fastcut, Reverse, Collage, Intro/Outro et Splitter affichent tous l'ETA.

Le rééquilibrage des phases Autocut est décrit dans [autocut.md](autocut.md).

## File d'attente

`TaskQueue` accepte des tâches `{ id, label, run }` et n'en exécute qu'une à la
fois. `enqueue()` renvoie une promesse résolue/rejetée à la fin de la tâche.
Les six onglets partagent la même instance : lancer un rendu Autocut pendant
un Fastcut met la tâche en attente.

Les boutons « Lancer » se désactivent tant que la queue est occupée, et la
suppression/configuration d'une vidéo en cours est bloquée.

L'annulation est gérée par les fonctionnalités, pas par la queue :

- une tâche en attente annulée reste dans la file mais son `run()` sort
  immédiatement (no-op), ce qui évite de manipuler la file partagée ;
- une tâche active est arrêtée via `FFmpegService.cancel()` ;
- Autocut distingue les rendus, les extraits et les pré-calculs pour appliquer
  les trois actions (passer, annuler les suivants, tout arrêter).

## État et persistance

- Les paramètres globaux (Autocut) et les suffixes (Autocut, Fastcut,
  Reverse, Collage, Intro/Outro, Splitter) sont dans `settings.params` et sauvegardés
  sous `localStorage["bulkut.params"]`.
- La langue choisie est sauvegardée sous `localStorage["bulkut.lang"]`.
- L'interrupteur de pré-calcul Autocut est sauvegardé sous
  `localStorage["bulkut.autoEstimate"]`.
- Les presets sont des cookies `<storagePrefix>.presets.<onglet>` (voir
  [presets.md](presets.md)).
- Les vidéos importées, les overrides par vidéo, les estimations et les
  résultats ne sont pas persistés : un rechargement repart de zéro. En mode
  mémoire, les `File` restent dans le heap. En mode OPFS, les octets restent
  dans le stockage du navigateur jusqu'à la suppression de la ligne (ou des
  données du site), mais la liste n'est pas restaurée au rechargement.

## Traductions dynamiques

Les textes statiques utilisent `data-i18n`, `data-i18n-placeholder`,
`data-i18n-title` et `data-i18n-aria-label`. Les textes dynamiques (statuts,
noms, erreurs) sont regénérés par les contrôleurs lors du changement de langue
via `feature.refresh()`.

## Hooks de débogage

`window.Bulkut` expose `settings`, `i18n`, `ffmpeg`, `queue`, `storageMode` et
`features`.
Chaque fonctionnalité expose au minimum `refresh()` et, pour les imports,
`addFiles(files)`. Cela permet de piloter l'application depuis la console sans
simuler un sélecteur de fichiers.

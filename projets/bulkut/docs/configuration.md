# Configuration et traductions

## `settings/config.json`

Configuration de l'application, chargée au démarrage. Modifiable sans rebuild.

| Clé | Défaut | Rôle |
| --- | --- | --- |
| `app.name` | `Bulkut` | Nom affiché (informatif). |
| `app.version` | `1.0.0` | Version affichée dans le pied de page. |
| `app.storagePrefix` | `bulkut` | Préfixe des clés `localStorage`. |
| `app.languages` | `["en","fr","es"]` | Langues proposées. |
| `app.defaultLanguage` | `"auto"` | `auto` = détection navigateur, ou `en`/`fr`/`es`. |
| `assets.translations` | `translations` | Dossier des traductions. |
| `assets.settingsDefaults` | `settings/default.json` | Fichier des valeurs par défaut. |
| `assets.ffmpegBase` | `vendor/ffmpeg` | Dossier du runtime wasm. |
| `assets.ffmpegCore` | `ffmpeg-core.js` | Nom du loader du core. |
| `assets.ffmpegWasm` | `ffmpeg-core.wasm` | Nom du binaire wasm. |
| `processing.maxFileSizeMb` | `2048` | Taille maximale d'un import sur `index.html` (ignorée par `pro.html`, qui monte l'OPFS). |
| `processing.previewDuration` | `60` | Durée de l'extrait Autocut (secondes). |
| `processing.maxSegments` | `400` | Nombre maximal de segments assemblés. |
| `processing.videoCodec` | `libx264` | Encodeur vidéo de sortie. |
| `processing.preset` | `veryfast` | Preset x264. |
| `processing.crf` | `23` | Qualité x264 (0–51). |
| `processing.pixelFormat` | `yuv420p` | Format de pixel compatible lecture web. |
| `processing.audioCodec` | `aac` | Encodeur audio. |
| `processing.audioBitrate` | `128k` | Débit audio. |
| `processing.reverseWarningSeconds` | `120` | Seuil d'avertissement pour Reverse. |
| `processing.concatFps` | `30` | Fréquence d'image cible des rendus Collage et Intro/Outro. |
| `autocut.fields.*` | voir ci-dessous | Bornes et pas des sliders Autocut. |
| `fade.min` / `max` / `step` | `0.1` / `1` / `0.1` | Bornes du slider de durée des fondus. |
| `fade.defaultDuration` | `1` | Durée de fondu utilisée quand aucune valeur n'existe. |
| `splitter.maxSegments` | `50` | Nombre maximal de segments dans l'onglet Splitter. |
| `ui.toastDuration` | `4500` | Durée des notifications (ms). |

### Bornes des sliders Autocut

```json
"autocut": {
  "fields": {
    "thresholdDb": { "min": -60, "max": -5, "step": 1 },
    "preCut": { "min": 0, "max": 2, "step": 0.05 },
    "postCut": { "min": 0, "max": 2, "step": 0.05 },
    "minClipDuration": { "min": 0, "max": 10, "step": 0.05 }
  }
}
```

Les libellés et aides correspondants sont les clés
`autocut.fields.threshold`, `autocut.fields.thresholdHint`, etc.

## `settings/default.json`

Valeurs par défaut des paramètres de traitement, utilisées pour initialiser
l'interface et pour normaliser les valeurs sauvegardées.

```json
{
  "autocut": {
    "thresholdDb": -30,
    "preCut": 0.15,
    "postCut": 0.2,
    "minClipDuration": 0.25,
    "minSilence": 0.5,
    "suffix": "-autocut",
    "output": "video"
  },
  "fastcut": { "suffix": "-cut" },
  "reverse": { "suffix": "-reversed" },
  "collage": { "suffix": "-collage" },
  "introoutro": { "suffix": "-intro-outro" }
}
```

`autocut.minClipDuration` est la durée minimale d'un clip conservé : les
passages plus courts sont supprimés. `autocut.minSilence` est la durée minimale
d'un silence pour `silencedetect` : elle n'apparaît pas dans l'interface (les
quatre paramètres éditables sont le seuil, les deux marges et la durée minimale
des clips), mais peut être ajustée ici.

`autocut.output` choisit la sortie par défaut : `video` (MP4), `premiere`
(séquence FCP 7 `.xml`) ou `davinci` (timeline FCPXML `.fcpxml`). Le choix reste
modifiable dans l'interface, globalement et pour chaque vidéo.

## Persistance

- `localStorage["<storagePrefix>.params"]` : paramètres globaux modifiés dans
  l'interface (seuil, marges, durée minimale des clips, suffixes). Fusionnés
  par-dessus `default.json`.
- `localStorage["<storagePrefix>.lang"]` : langue choisie.
- `localStorage["<storagePrefix>.autoEstimate"]` : interrupteur de pré-calcul
  automatique des durées (`true` / `false`, absent = `false`).

Les presets sont des cookies `<storagePrefix>.presets.<onglet>` :
[presets.md](presets.md).

Les overrides par vidéo, la liste des fichiers, les estimations et les
résultats ne sont pas persistés. Vider le stockage local restaure les valeurs
de `default.json`.

En mode `pro.html`, les octets des vidéos sont écrits dans l'**OPFS** du
navigateur (dossier `bulkut-pro-files`) et non dans `localStorage`. Ils sont
supprimés quand la ligne est retirée ou quand les données du site sont
effacées.

## Traductions

Trois fichiers plats, avec la même structure de clés :

```
translations/en.json
translations/fr.json
translations/es.json
```

- Détection : langue sauvegardée → `navigator.languages` (code de base) →
  anglais.
- Si un fichier de langue est absent ou invalide, l'anglais est utilisé.
- `I18n.apply()` traduit les attributs `data-i18n`, `data-i18n-placeholder`,
  `data-i18n-title` et `data-i18n-aria-label`.
- `I18n.t('clé', { var })` interpole `{var}`. Les clés absentes renvoient la
  clé et déclenchent un avertissement console.

### Ajouter une langue

1. Créer `translations/xx.json` en copiant `en.json` et en traduisant les
   valeurs (ne pas changer les clés).
2. Ajouter `xx` dans `app.languages` (`settings/config.json`).
3. Ajouter le libellé natif dans `LANGUAGE_LABELS`
   (`script/core/i18n.js`).
4. Ajouter un bouton `data-lang="xx"` dans le sélecteur de l'en-tête
   (`index.html`).
5. Lancer `npm test` : les tests vérifient la parité des clés et que toutes les
   clés utilisées dans le code/HTML existent.

### Erreurs

Les erreurs métier sont des `AppError(code)`. Le message affiché est
`errors.<code>` : `duration`, `noAudio`, `noSegments`, `tooManySegments`,
`noVideoStream`, `renderFailed`, `ffmpegLoad`, `ffmpegUnavailable`,
`cancelled`, `noClips`, `opfsUnavailable`, `opfsImport`, `opfsMount`,
`unknown`… Ajouter un code nécessite une entrée dans les trois fichiers de
traduction.

## Suffixes

Les suffixes sont nettoyés (`sanitizeSuffix`) : suppression de
`\ / : * ? " < > |`, des caractères de contrôle et des espaces/points aux
extrémités, 40 caractères maximum. Le nom de sortie est
`<nom sans extension><suffixe>.mp4`.

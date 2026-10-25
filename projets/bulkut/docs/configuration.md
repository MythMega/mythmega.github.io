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
| `processing.maxFileSizeMb` | `2048` | Taille maximale d'un import. |
| `processing.previewDuration` | `60` | Durée de l'extrait Autocut (secondes). |
| `processing.maxSegments` | `400` | Nombre maximal de segments assemblés. |
| `processing.videoCodec` | `libx264` | Encodeur vidéo de sortie. |
| `processing.preset` | `veryfast` | Preset x264. |
| `processing.crf` | `23` | Qualité x264 (0–51). |
| `processing.pixelFormat` | `yuv420p` | Format de pixel compatible lecture web. |
| `processing.audioCodec` | `aac` | Encodeur audio. |
| `processing.audioBitrate` | `128k` | Débit audio. |
| `processing.reverseWarningSeconds` | `120` | Seuil d'avertissement pour Reverse. |
| `autocut.fields.*` | voir ci-dessous | Bornes et pas des sliders Autocut. |
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
    "suffix": "-autocut"
  },
  "fastcut": { "suffix": "-cut" },
  "reverse": { "suffix": "-reversed" }
}
```

`autocut.minClipDuration` est la durée minimale d'un clip conservé : les
passages plus courts sont supprimés. `autocut.minSilence` est la durée minimale
d'un silence pour `silencedetect` : elle n'apparaît pas dans l'interface (les
quatre paramètres éditables sont le seuil, les deux marges et la durée minimale
des clips), mais peut être ajustée ici.

## Persistance

- `localStorage["<storagePrefix>.params"]` : paramètres globaux modifiés dans
  l'interface (seuil, marges, durée minimale des clips, suffixes). Fusionnés
  par-dessus `default.json`.
- `localStorage["<storagePrefix>.lang"]` : langue choisie.

Les overrides par vidéo, la liste des fichiers et les résultats ne sont pas
persistés. Vider le stockage local restaure les valeurs de `default.json`.

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
`noVideoStream`, `renderFailed`, `ffmpegLoad`, `ffmpegUnavailable`, `unknown`…
Ajouter un code nécessite une entrée dans les trois fichiers de traduction.

## Suffixes

Les suffixes sont nettoyés (`sanitizeSuffix`) : suppression de
`\ / : * ? " < > |`, des caractères de contrôle et des espaces/points aux
extrémités, 40 caractères maximum. Le nom de sortie est
`<nom sans extension><suffixe>.mp4`.

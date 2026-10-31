# Fondus audio et vidéo

Chaque onglet propose un fondu **audio** (`afade`) et un fondu **vidéo**
(`fade`). Les deux sont indépendants et peuvent être : aucun, entrée, sortie, ou
entrée + sortie. La durée est commune aux deux flux, réglable de 0,1 à 1 seconde
(1 seconde par défaut).

Les fondus sont appliqués **une seule fois, sur le fichier final** :

- Autocut : après l'assemblage des passages conservés, pas sur chaque clip.
- Collage / Intro-Outro : après la concaténation, pas sur chaque source.
- Fastcut / Reverser : sur le fichier exporté.
- Splitter : sur chaque segment exporté, chacun étant un fichier final.

Les bornes viennent de `fade` dans `settings/config.json` :

```json
"fade": { "min": 0.1, "max": 1, "step": 0.1, "defaultDuration": 1 }
```

## Configuration et presets

Les valeurs par défaut de chaque onglet sont dans `settings/default.json`
(`fade: { audio, video, duration }`). Les presets enregistrent `fadeAudio`,
`fadeVideo` et `fadeDuration` en plus du suffixe et des paramètres numériques.

## Implémentation

| Fichier | Rôle |
| --- | --- |
| `script/core/fade.js` | Normalisation des modes et construction des filtres `fade` / `afade`. |
| `script/ui/fade-control.js` | Sélecteurs audio/vidéo et slider de durée, réutilisés par les six onglets. |
| `software/Bulkut.Core/Features/Fades.cs` | Même logique côté desktop, plus l'encodage des presets. |
| `software/Bulkut/Ui/Widgets/FadeField.cs` | Contrôle Avalonia (deux listes + durée). |
| `software/Bulkut.Core/Features/{VideoOps,Concat,Silence}.cs` | Insertion des filtres sur la sortie finale. |

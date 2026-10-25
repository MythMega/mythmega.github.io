# Autocut

Objectif : retirer les silences d'une ou plusieurs vidéos, en gardant un peu
d'air avant et après la parole.

## Les quatre étapes

La logique de `autocut.txt` est répartie ainsi :

| Étape | Implémentation |
| --- | --- |
| 1. Détection des silences | `buildSilenceArgs()` + `ffmpeg -af silencedetect`, puis `parseSilenceLogs()`. |
| 2. Marges pre-cut / post-cut | `computeKeepSegments()` décale le début de la parole de `-preCut` et sa fin de `+postCut`. |
| 3. Calcul des segments à garder | `computeKeepSegments()` inverse les silences en blocs de parole, fusionne les chevauchements et supprime les clips plus courts que la durée minimale. |
| 4. Rendu | `buildAutocutArgs()` génère un `filter_complex` `trim`/`atrim` + `concat`, exécuté en une seule passe. |

Le seuil est passé en dB (`silencedetect=noise=-30.00dB`), la durée minimale de
silence vient de `settings/default.json` (`autocut.minSilence`, 0,5 s par
défaut) et n'est pas exposée dans l'interface.

### Commande d'analyse

```
ffmpeg -hide_banner -i input.mp4 -t <durée> \
  -af silencedetect=noise=-30.00dB:d=0.50 -vn -f null -
```

Les lignes `silence_start:` / `silence_end:` sont parsées ; un silence non
terminé en fin de fichier est traité comme allant jusqu'à la fin.

### Rendu

Pour chaque segment :

```
[0:v]trim=start=…:end=…,setpts=PTS-STARTPTS[vN]
[0:a]atrim=start=…:end=…,asetpts=PTS-STARTPTS[aN]
[v0][a0][v1][a1]…concat=n=N:v=1:a=1[vout][aout]
```

Puis encodage H.264/AAC (`processing.videoCodec`, `preset`, `crf`,
`pixelFormat`, `audioBitrate`) et `-movflags +faststart`. Les métadonnées sont
retirées (`-map_metadata -1`).

## Paramètres

Quatre paramètres, communs par défaut :

| Paramètre | Clé | Valeur par défaut | Bornes (config.json) |
| --- | --- | --- | --- |
| Seuil de silence | `thresholdDb` | `-30 dB` | `-60` à `-5` |
| Marge avant | `preCut` | `0,15 s` | `0` à `2 s` |
| Marge après | `postCut` | `0,20 s` | `0` à `2 s` |
| Durée minimale des clips | `minClipDuration` | `0,25 s` | `0` à `10 s` |

Chaque paramètre est un slider accompagné d'un champ numérique. La valeur est
validée à la perte de focus : une valeur hors bornes est refusée (message
d'erreur, champ secoué, retour à la dernière valeur valide). Les bornes sont
définies dans `settings/config.json` (`autocut.fields`).

La durée minimale s'applique **après** l'application des marges et la fusion
des blocs : tout clip conservé plus court que cette valeur est supprimé. `0`
désactive le filtre et conserve même les blocs très courts.

## Paramètres par vidéo

Chaque ligne de la liste affiche :

- un badge **Défaut** (les réglages globaux s'appliquent, et suivent leurs
  modifications en direct) ou **Personnalisé** ;
- le résumé effectif `seuil · marge avant · marge après · ≥ durée minimale` ;
- le bouton **réglages** (icône engrenage) qui ouvre une popup pré-remplie avec
  les valeurs effectives. La popup propose « Suivre les valeurs par défaut »
  pour supprimer l'override.

Un override ne stocke que les quatre paramètres, jamais le suffixe ni le nom.

## Extrait d'une minute

Le bouton **Extrait** rend la fenêtre d'une minute au milieu de la vidéo, en
appliquant les réglages de la vidéo (analyse + coupe). Le fichier téléchargé
s'appelle `<nom>-preview.mp4`. Cela permet de vérifier le rendu avant de
lancer la vidéo complète. Si la vidéo dure moins d'une minute, l'extrait
correspond à la vidéo entière.

Le calcul de la fenêtre est dans `computePreviewWindow()`.

## Suffixe et nom de sortie

Le suffixe global (champ texte) est ajouté au nom d'origine :
`clip.mp4` + `-autocut` → `clip-autocut.mp4`. Les caractères interdits
(`\ / : * ? " < > |`) sont retirés et le suffixe est limité à 40 caractères.

## File d'attente et progression

« Tout traiter » met en file toutes les vidéos en attente (statuts `idle` ou
`error`). Elles sont traitées une par une, dans l'ordre. Chaque ligne affiche
une barre de progression et un pourcentage avec les phases :

`Préparation` → `Analyse des silences` → `Rendu en cours` → `Terminé`.

Une vidéo terminée n'est relancée par « Tout traiter » que si ses réglages effectifs ont changé depuis son dernier rendu. Elle est alors marquée **« Réglages modifiés — relancer le rendu »** et réintégrée au compteur du bouton. Cela couvre les paramètres globaux pour une vidéo en « Défaut » et l'override pour une vidéo « Personnalisé ». Modifier seulement le suffixe ne déclenche pas ce marquage, car il ne change que le nom du fichier téléchargé.

## Limites et erreurs

- `processing.maxSegments` (400 par défaut) évite de générer un filtre trop
  long ou un rendu ingérable.
- Une vidéo sans piste audio est refusée avec un message explicite.
- Si aucun segment ne survit aux marges / à la durée minimale, le rendu est
  annulé avec un message invitant à changer de seuil.
- La durée est lue par le navigateur ; si le format n'est pas lisible (mkv par
  exemple), un probe FFmpeg est effectué avant le rendu.

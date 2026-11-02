# Fastcut

Découpe précise d'un extrait dans **une seule vidéo à la fois**.

## Mise en page

Comme Autocut, l'onglet est divisé en deux colonnes :

- à gauche, le suffixe de sortie et le bouton d'export ;
- à droite, la zone d'import puis la fiche du fichier.

La zone d'import disparaît une fois le fichier chargé ; le bouton corbeille de
la fiche permet de l'abandonner et de revenir à l'import.

## Import et durée

1. Le fichier est validé (type vidéo, taille ≤ `processing.maxFileSizeMb`).
2. La durée est lue via un élément `<video>` (`probeVideoDuration`).
3. Si le navigateur ne sait pas lire les métadonnées (mkv…), un probe FFmpeg
   est lancé (`probeDurationWithFFmpeg`) ; le moteur wasm peut donc se charger
   dès l'import dans ce cas.
4. La durée est affichée et la fin est initialisée à `floor(durée)`.

## Curseurs et timecodes

Deux blocs identiques, début et fin :

- un slider de **0 à 100 %** de la durée ;
- trois champs numériques `hh`, `mm`, `ss` (heures 0–99, minutes/secondes 0–59).

Règles de synchronisation :

- bouger un slider met à jour les trois champs et la durée de sortie ;
- modifier un champ puis le valider (Entrée ou perte de focus) recalcule le
  slider et la durée de sortie ;
- une valeur invalide (champ vide, minutes/secondes > 59) est refusée, les
  champs sont restaurés et un message s'affiche ;
- le début est borné à `fin - 1 s`, la fin à `durée` ; la durée minimale de
  l'extrait est de **1 seconde** ;
- les deux contrôles sont désactivés pendant un rendu.

La durée de sortie est affichée en `hh:mm:ss` et en secondes dans la carte
« Durée de sortie ».

## Rendu

```
ffmpeg -hide_banner -ss <début> -i input -t <durée> \
  -map 0:v:0 -map 0:a:0? \
  -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p \
  -c:a aac -b:a 128k -avoid_negative_ts make_zero \
  -movflags +faststart -map_metadata -1 out.mp4
```

`-ss` est placé avant `-i` puis un réencodage complet est effectué : la coupe
est précise à l'image près (pas de copie de flux, qui serait limitée aux
keyframes). La piste audio est optionnelle (`0:a:0?`).

La progression est calculée à partir des lignes `time=` de FFmpeg, sur la durée
de l'extrait.

## Nom de sortie

`clip.mp4` + suffixe `-cut` → `clip-cut.mp4`. Le suffixe est nettoyé et
persisté comme les autres réglages globaux.

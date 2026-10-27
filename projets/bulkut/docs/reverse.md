# Reverser

Inverse une vidéo et son audio.

## Fonctionnement

L'onglet accepte un fichier, affiche son nom, sa taille et sa durée (si le
navigateur peut la lire), puis propose :

- un suffixe de sortie (`-reversed` par défaut, modifiable) ;
- un bouton « Inverser la vidéo » ;
- une barre de progression avec les phases Préparation / Rendu / Terminé.

Le processeur attache la source (copie MEMFS sur `index.html`, montage OPFS
sur `pro.html`), lance un probe FFmpeg pour connaître la durée et la présence
d'une piste audio, puis exécute :

```
ffmpeg -hide_banner -i input -vf reverse [-af areverse] \
  -map 0:v:0 -map 0:a:0? \
  -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p \
  -c:a aac -b:a 128k -movflags +faststart -map_metadata -1 out.mp4
```

`-af areverse` n'est ajouté que si une piste audio existe, sinon FFmpeg
échouerait. Les flux supplémentaires (sous-titres, pièces jointes) ne sont pas
recopiés.

## Mémoire

Le filtre `reverse` doit bufferiser **toute** la vidéo avant d'émettre la
première image ; `areverse` fait de même pour l'audio. C'est pourquoi :

- les clips longs sont déconseillés (l'interface affiche un avertissement
  au-delà de `processing.reverseWarningSeconds`, 120 s par défaut) ;
- la progression peut rester à 0 % un moment puis sauter, la barre restant
  animée pendant l'attente ;
- un fichier trop gros peut saturer la mémoire du navigateur et faire échouer
  le rendu (message d'erreur explicite).

Pour de longues vidéos, il vaut mieux découper d'abord avec Fastcut, puis
inverser les morceaux.

# Collage

Objectif : mettre plusieurs vidéos **bout à bout**, dans un ordre choisi, et les
exporter en un seul fichier.

## Mise en page

- **À gauche** : le suffixe de sortie, les presets, le bouton « Créer le
  collage », un bouton « Arrêter le rendu » et la progression du rendu.
- **À droite** : l'import (clic ou glisser-déposer, plusieurs fichiers), la
  durée totale du collage en construction, puis la liste des clips.

Chaque ligne affiche son numéro d'ordre, une poignée de déplacement, son nom,
sa durée et sa taille, et trois boutons : monter, descendre, retirer.

## Ordre et durée totale

- Une ligne se déplace par **glisser-déposer** (HTML5 drag & drop) ou avec les
  flèches monter/descendre (utile au clavier et sur mobile).
- La durée totale est la somme des durées des clips, dans l'ordre courant.
  Elle est recalculée à chaque import, suppression ou déplacement, et affichée
  en `hh:mm:ss` avec le nombre de clips.
- Un fichier dont le navigateur ne sait pas lire la durée est quand même
  accepté : le probe FFmpeg (mkv…) est tenté à l'import ; à défaut, sa durée
  compte pour zéro jusqu'au rendu, où FFmpeg la relit.

## Rendu

Le rendu attache toutes les sources, les sonde, puis lance **une seule**
commande FFmpeg :

1. Chaque clip est normalisé : mise à l'échelle avec conservation du ratio,
   letterbox noir vers la résolution du plus grand clip, `setsar=1`, fréquence
   d'image constante (`processing.concatFps`, 30 par défaut) et `yuv420p`.
2. L'audio est ramené en stéréo 48 kHz. Un clip sans piste audio reçoit un
   silence de sa propre durée (`anullsrc`) : le filtre `concat` exige des
   pistes audio sur tous les segments. Si aucun clip n'a d'audio, la sortie
   reste muette.
3. Le filtre `concat` colle les segments, puis la sortie est encodée une fois
   (H.264/AAC, `processing.videoCodec`, `preset`, `crf`, `audioBitrate`).

La progression utilise le `time=` de la sortie et la somme des durées des
segments ; l'ETA est déduite de la vitesse FFmpeg et du temps écoulé. Un rendu
peut être arrêté : le worker est terminé, rien n'est téléchargé.

Le nom de sortie est `<nom du premier clip><suffixe>.mp4`
(`clip-a.mp4` + `-collage` → `clip-a-collage.mp4`).

## Limites

- Une seule vidéo peut être rendue à la fois (file séquentielle globale).
- En mode mémoire (`index.html`), **tous** les clips du collage sont copiés
  dans MEMFS en même temps : la taille totale compte, pas seulement celle de
  chaque fichier. `pro.html` monte les fichiers depuis l'OPFS et évite cette
  copie.
- Les résolutions et orientations mélangées sont acceptées : le rendu ajoute
  des bandes noires. Le plus grand clip sert de référence.

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `script/features/collage/collage-feature.js` | État de la liste, import, drag & drop, durée totale, rendu. |
| `script/features/shared/concat.js` | Graphe de filtres et arguments FFmpeg (fonctions pures, testées). |
| `script/features/shared/concat-processor.js` | Attachement, probe, exécution et lecture du résultat. |
| `script/features/shared/import-video.js` | Validation, stockage et lecture de la durée, partagé avec Intro/Outro. |

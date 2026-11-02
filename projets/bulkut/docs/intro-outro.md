# Intro / Outro

Objectif : habiller chaque vidéo d'une liste avec une **intro** commune et/ou un
**outro** commun, puis exporter chaque vidéo séparément.

## Mise en page

- **À gauche** : suffixe, presets, « Tout rendre », les contrôles de file
  (arrêter tous les rendus) et la note sur les fichiers.
- **À droite**, au-dessus de la liste : deux emplacements optionnels, **Intro**
  et **Outro**. Chacun s'importe par clic ou glisser-déposer, affiche son nom,
  sa durée et sa taille, et peut être retiré.
- En dessous : l'import multiple des vidéos à traiter, puis la liste.

Les deux emplacements sont indépendants : on peut définir seulement l'intro,
seulement l'outro, les deux, ou aucun (dans ce cas le rendu est désactivé et un
message invite à en ajouter un).

## Mode par vidéo

Chaque ligne propose un sélecteur dès qu'au moins un emplacement est rempli :

| Emplacements définis | Choix possibles |
| --- | --- |
| Intro + outro | **Intro + outro**, **Intro seule**, **Outro seul** |
| Intro seulement | Intro seule (sélecteur désactivé) |
| Outro seulement | Outro seul (sélecteur désactivé) |
| Aucun | Aucun rendu : la liste est en attente d'un emplacement |

Le mode est propre à chaque fichier. Changer un emplacement, un mode, ou
ajouter/retirer une vidéo recalcule immédiatement la **durée prévue** de chaque
ligne :

```
durée prévue = durée du clip
             + durée de l'intro  (si incluse)
             + durée de l'outro  (si inclus)
```

Elle est affichée à côté de la durée d'origine (`Durée prévue ≈ 0:07`). Les
durées inconnues comptent pour zéro dans l'estimation, mais FFmpeg relit la
durée réelle au rendu.

## Rendu

- Le bouton lecture d'une ligne rend **cette vidéo uniquement**.
- « Tout rendre (N) » met en file toutes les vidéos prêtes (statut `idle`,
  `error` ou `done`), dans l'ordre de la liste.
- Chaque rendu passe par le même pipeline que [Collage](collage.md) :
  normalisation de chaque entrée, audio stéréo 48 kHz (silence ajouté aux
  clips muets), concaténation, puis un seul encodage. Les entrées sont, dans
  l'ordre : intro (si incluse), clip, outro (si inclus).
- Le téléchargement se fait vidéo par vidéo, dès qu'un rendu se termine.
  `clip.mp4` + `-intro-outro` → `clip-intro-outro.mp4`.
- Une ligne affiche sa progression, son ETA et un bouton arrêter tant que son
  rendu est actif. « Tout arrêter » annule la file et le rendu en cours.

Les emplacements et les vidéos restent en mémoire : un rechargement repart de
zéro. Seuls le suffixe et les presets sont persistés (le suffixe dans
`localStorage`, les presets dans les cookies).

## Limites

- Une seule vidéo rendue à la fois (file séquentielle globale, un seul
  ffmpeg.wasm).
- Chaque vidéo est réencodée avec l'intro et l'outro, même si la durée est
  courte ; un lot de N vidéos correspond à N rendus.
- En mode mémoire (`index.html`), l'intro, l'outro et le clip sont copiés
  simultanément dans MEMFS. `pro.html` les monte depuis l'OPFS.

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `script/features/introoutro/introoutro-feature.js` | Emplacements, modes, durées prévues, file de rendus, arrêt. |
| `script/features/shared/concat.js` | Graphe de filtres et arguments FFmpeg. |
| `script/features/shared/concat-processor.js` | Attachement, probe, rendu, lecture du résultat. |

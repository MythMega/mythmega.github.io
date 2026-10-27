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

Un override stocke les quatre paramètres et le format de sortie, jamais le suffixe
ni le nom. Le format choisi apparaît aussi dans le résumé de la ligne.

## Extrait d'une minute

Le bouton **Extrait** rend la fenêtre d'une minute au milieu de la vidéo, en
appliquant les réglages de la vidéo (analyse + coupe). Le fichier téléchargé
s'appelle `<nom>-preview.mp4`, même lorsque le format de sortie est une timeline :
l'extrait sert justement à voir et écouter le résultat. Cela permet de vérifier le rendu avant de
lancer la vidéo complète. Si la vidéo dure moins d'une minute, l'extrait
correspond à la vidéo entière.

Le calcul de la fenêtre est dans `computePreviewWindow()`.

## Format de sortie

Autocut peut produire trois choses, choisies dans le panneau global et, vidéo
par vidéo, dans la popup de réglages :

| Format | Fichier | Contenu |
| --- | --- | --- |
| **Vidéo (MP4)** | `.mp4` | Rendu classique avec les silences retirés (défaut). |
| **Premiere Pro** | `.xml` | Séquence FCP 7 (`xmeml`) avec un clip par segment conservé. |
| **DaVinci Resolve** | `.fcpxml` | Timeline FCPXML 1.10 avec les mêmes points de montage. |

Les timelines ne réencodent rien : elles réutilisent le fichier source et
conservent ses points d'entrée/sortie. Sur le web, le navigateur ne connaît pas
le chemin absolu du fichier : le XML contient donc une référence relative
(`./nom.mp4`). Placer le XML à côté de la vidéo, ou relinker le média dans le
logiciel de montage, suffit. Sur la version desktop, le chemin absolu est écrit
directement.

La fréquence d'image est lue par FFmpeg. Les cadences NTSC (23,976, 29,97,
59,94…) sont écrites avec leur durée de frame exacte (`1001/30000s` pour du
29,97) afin que les timecodes restent alignés. Les fondus ne s'appliquent pas
aux timelines : ils n'ont de sens que sur un fichier vidéo final.

## Suffixe et nom de sortie

Le suffixe global (champ texte) est ajouté au nom d'origine :
`clip.mp4` + `-autocut` → `clip-autocut.mp4`. Les caractères interdits
(`\ / : * ? " < > |`) sont retirés et le suffixe est limité à 40 caractères.
Pour les timelines, l'extension suit le format : `clip-autocut.xml` ou
`clip-autocut.fcpxml`.

## File d'attente et progression

« Tout traiter » met en file toutes les vidéos en attente (statuts `idle` ou
`error`). Elles sont traitées une par une, dans l'ordre. Chaque ligne affiche
une barre de progression et un pourcentage avec les phases :

`Préparation` → `Analyse des silences` → `Rendu en cours` → `Terminé`.

### Répartition de la barre

L'analyse des silences est très rapide comparée à l'encodage : elle ne pèse
volontairement que **5 %** de la barre. Pour une timeline, il n'y a pas
d'encodage du tout : l'analyse occupe la barre jusqu'à la fin.

| Phase | Part de la barre |
| --- | --- |
| Préparation (chargement, copie/montage, durée) | 1 → 2 % |
| Analyse des silences (`silencedetect`) | 2 → 7 % |
| Rendu (encodage) | 7 → 96 % |
| Relecture du fichier wasm + préparation du téléchargement | 96 → 100 % |

Le rendu est mesuré sur la **durée des segments conservés**, pas sur la durée
d'origine : un clip dont on retire la moitié des silences atteint bien 96 % à
la fin, au lieu de s'arrêter vers 50 % puis sauter d'un coup.

Pendant les phases longues, la ligne affiche aussi une **ETA** (`~1:12
restant`), calculée à partir de la vitesse FFmpeg (`speed=`) et du temps
écoulé. Voir [architecture.md](architecture.md#progression-et-eta).

Une vidéo terminée n'est relancée par « Tout traiter » que si ses réglages effectifs ont changé depuis son dernier rendu. Elle est alors marquée **« Réglages modifiés — relancer le rendu »** et réintégrée au compteur du bouton. Cela couvre les paramètres globaux pour une vidéo en « Défaut » et l'override pour une vidéo « Personnalisé ». Modifier seulement le suffixe ne déclenche pas ce marquage, car il ne change que le nom du fichier téléchargé.

## Annulation et contrôle de la file

Trois actions sont disponibles dans le panneau de file, visible dès qu'un
traitement Autocut est en cours ou en attente :

| Action | Effet |
| --- | --- |
| **Passer l'actuel** | Arrête le rendu (ou l'extrait / le pré-calcul) en cours et libère immédiatement la place au suivant. |
| **Annuler les suivants** | Retire de la file tous les rendus et extraits pas encore démarrés ; le rendu en cours va au bout. |
| **Tout arrêter** | Combine les deux : arrête l'actuel et vide la file, pré-calculs compris. |

Chaque ligne affiche aussi un bouton **Arrêter** (icône carrée) tant que son
rendu ou son extrait est actif. C'est le moyen le plus direct d'annuler un
extrait d'une minute.

Un rendu annulé restaure l'état précédent de la ligne : une vidéo déjà
téléchargée redevient « Terminé » (avec son éventuel badge « Réglages
modifiés ») au lieu de perdre son résultat. Un rendu interrompu ne produit
aucun téléchargement.

Techniquement, ffmpeg.wasm n'offre pas d'annulation coopérative :
`FFmpegService.cancel()` termine le worker, puis le rendu suivant recharge le
core. C'est volontaire — c'est la seule façon de garantir que la commande en
cours s'arrête vraiment. Le compteur de génération du service empêche un
chargement ou une commande déjà annulée de ressusciter.

## Pré-calcul de la durée de sortie

Un interrupteur en haut de l'onglet Autocut active le pré-calcul automatique
(**désactivé par défaut**). Le pré-calcul exécute uniquement l'analyse des
silences et le calcul des segments, sans encoder : il renvoie la durée de
sortie estimée et le nombre de clips conservés.

- Interrupteur **ON** : le calcul est lancé pour toutes les vidéos dès
  l'activation, à l'import d'un nouveau fichier, et après l'application des
  réglages d'une vidéo. Après une modification des réglages **globaux**, un
timer de **3 secondes** repart à chaque changement et lance le calcul quand
l'utilisateur s'arrête.
- Interrupteur **OFF** : aucun calcul automatique. Le bouton horloge de chaque
  ligne lance le pré-calcul à la demande.

Un résultat est invalidé dès que les paramètres effectifs de la vidéo changent
(globaux pour une vidéo en « Défaut », override pour une vidéo
« Personnalisé ») : l'ancienne valeur disparaît pour ne jamais afficher une
durée fausse. Un calcul déjà lancé est marqué obsolète et son résultat est
ignoré.

L'estimation s'affiche sous les paramètres de la ligne, par exemple
`Sortie ≈ 1:16 · 12 clips`. L'état de l'interrupteur est conservé dans
`localStorage` (`bulkut.autoEstimate`).

Le pré-calcul partage la file séquentielle avec les rendus : il attend un
rendu en cours et peut être annulé par « Tout arrêter ».

## Limites et erreurs

- `processing.maxSegments` (400 par défaut) évite de générer un filtre trop
  long ou un rendu ingérable.
- Une vidéo sans piste audio est refusée avec un message explicite.
- Si aucun segment ne survit aux marges / à la durée minimale, le rendu est
  annulé avec un message invitant à changer de seuil.
- La durée est lue par le navigateur ; si le format n'est pas lisible (mkv par
  exemple), un probe FFmpeg est effectué avant le rendu.

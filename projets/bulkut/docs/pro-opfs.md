# Mode Pro : OPFS

`pro.html` est la même application que `index.html` (mêmes onglets, mêmes
réglages, mêmes commandes FFmpeg), mais les fichiers importés passent par
l'**Origin Private File System** au lieu du heap JavaScript. Cela supprime la
limite de taille à l'import et évite de recopier la vidéo dans le système de
fichiers en mémoire de ffmpeg.wasm.

## Pourquoi deux pages ?

| | `index.html` | `pro.html` |
| --- | --- | --- |
| Stockage de l'entrée | `File` en mémoire → copie MEMFS | OPFS → montage WORKERFS |
| Limite d'import | `processing.maxFileSizeMb` (2048 Mo) | aucune limite applicative |
| Copie de l'entrée dans le wasm | oui, à chaque tâche | non, FFmpeg lit à la demande |
| Sortie du rendu | MEMFS | MEMFS |
| Support navigateur | large | OPFS (Chrome/Edge, Firefox 111+, Safari 16.4+) |

Les deux pages partagent `script/main.js`. La page est détectée par
`document.body.dataset.storage === "opfs"` ; le contexte applicatif expose
`isPro` et une fabrique `createSource(file)` qui renvoie la bonne source.

## Cycle d'un import

1. Le fichier choisi est validé (type vidéo ; la taille est ignorée en mode
   Pro).
2. `createOpfsSource()` ouvre (ou crée) le dossier `bulkut-pro-files` à la
   racine de l'OPFS, puis copie le fichier par tranches de 16 Mo dans un
   `FileSystemWritableFileStream`. Le nom interne est unique et conserve
   l'extension.
3. La ligne garde une poignée (`FileSystemFileHandle`), son nom d'origine, sa
   taille et sa durée. Le `File` d'origine n'est plus retenu.
4. La durée est lue sur un `File` obtenu via `handle.getFile()` (lecture
   paresseuse), avec le probe FFmpeg en secours.
5. À chaque tâche (pré-calcul, extrait, rendu), `attach()` monte le fichier en
   lecture seule :

   ```js
   await ffmpeg.createDir('/bulkut-src-…');
   await ffmpeg.mount('WORKERFS', { files: [file] }, '/bulkut-src-…');
   // chemin d'entrée : /bulkut-src-…/<fichier>
   ```

   Le nettoyage démonte et supprime le dossier, même en cas d'erreur.
6. Supprimer la ligne supprime aussi l'entrée OPFS.

## Ce qui reste limité

- **La sortie** est écrite par FFmpeg dans MEMFS avant d'être lue et
  téléchargée : un rendu très long peut donc encore saturer la mémoire wasm.
- Le core est **single-thread** et une seule tâche tourne à la fois, comme sur
  la page standard.
- L'OPFS est privé à l'origine du site : les fichiers ne sont pas visibles dans
  le sélecteur de fichiers du système. Ils restent sur l'appareil et sont
  supprimés avec les données du site.
- La liste des vidéos n'est pas restaurée au rechargement. Les octets peuvent
  rester dans l'OPFS (jusqu'à suppression de la ligne ou des données du site),
  mais l'application ne les réaffiche pas automatiquement.
- Les navigateurs sans OPFS affichent un message d'erreur et invitent à utiliser
  `index.html`.

## Dépannage

- **« Impossible de monter … dans le moteur vidéo »** : le core ne propose pas
  WORKERFS ou le montage a échoué. Vérifier que le worker `814.ffmpeg.js` est
  bien servi à côté de `ffmpeg.js`.
- **Quota dépassé** : supprimer des lignes ou vider les données du site. Le
  quota est celui accordé par le navigateur au site, pas une limite de Bulkut.
- **`opfsUnavailable`** : la page n'est pas servie en HTTPS / localhost, ou le
  navigateur est trop ancien.

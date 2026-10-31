# Splitter

Le Splitter découpe **une** vidéo source en autant de segments que nécessaire.
Chaque segment possède son propre début et sa propre fin, réglés au slider
(0–100 %) ou au timecode `hh:mm:ss`. Chaque segment est exporté dans un fichier
distinct, avec le suffixe de l'onglet et un numéro (`-split-01`, `-split-02`…).

## Utilisation

1. Importer une vidéo (mémoire sur `index.html`, OPFS sur `pro.html`).
2. Le premier segment couvre toute la vidéo. Utiliser **Ajouter un segment**
   pour en créer d'autres ; le nouveau segment démarre à la fin du précédent.
3. Ajuster début et fin. Un segment doit durer au moins une seconde et rester
   dans la durée de la source.
4. Poser éventuellement un fondu audio/vidéo (voir [fades.md](fades.md)) : il
   s'applique à chaque fichier exporté, puisque chaque segment est un fichier
   final.
5. **Exporter les segments** rend les fichiers un par un. Le navigateur peut
   demander l'autorisation de télécharger plusieurs fichiers.

Le nombre de segments est limité par `splitter.maxSegments` dans
`settings/config.json` pour le web et `processing.maxSegments` pour le desktop.

## Implémentation

| Fichier | Rôle |
| --- | --- |
| `script/features/splitter/splitter-feature.js` | État, liste des segments, sliders/timecodes, file d'attente, progression. |
| `script/features/splitter/splitter-processor.js` | Rendu de chaque plage via FFmpeg et collecte des blobs. |
| `software/Bulkut.Core/Features/Splitter.cs` | Validation des plages et arguments FFmpeg du desktop. |
| `software/Bulkut.Core/Services/RenderEngine.cs` | `RenderSplitAsync` : rendu séquentiel, un fichier par segment. |
| `software/Bulkut/Ui/Views/SplitterView.cs` | Onglet Avalonia (fichier, segments, suffixe, fondu, presets). |

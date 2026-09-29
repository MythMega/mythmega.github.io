/* Exportation en lot : rendu FR + EN de chaque variante de carte puis archive ZIP.
 *
 * Structure de l'archive {Serie}.zip :
 *   fr/{INDEX}_fullart.png   -> version française, mise en page full art
 *   fr/{INDEX}_classic.png   -> version française, mise en page classique
 *   en/{INDEX}_fullart.png   -> version anglaise, mise en page full art
 *   en/{INDEX}_classic.png   -> version anglaise, mise en page classique
 *   {Serie}.json             -> manifeste des cartes (voir buildManifest)
 */
class BatchExporter {
  constructor(renderer, onProgress = null) {
    this.renderer = renderer;
    this.onProgress = onProgress;
    this.isCanceled = false;
    this.lastReport = null;
  }

  cancel() {
    this.isCanceled = true;
  }

  /* Manifeste inséré dans le ZIP :
   * { "Serie": "...",
   *   "ImportMode": "AlreadyExportedData",
   *   "Cards": [ { Index, Name_FR, Name_EN, Desc_FR, Desc_EN, Rarity, Style,
   *                Background, Underlay, Layout, Path } ] }
   * Une entrée par variante réellement produite (une carte non spécifiée en génère deux).
   * « Path » conserve le marqueur littéral « <lang> » (remplacé plus tard par fr / en).
   * Le champ « ImportMode » (ExportedDataParser.MODE) permet de réimporter le manifeste
   * dans le Bulk Generator sans qu'il soit signalé comme un format inconnu.
   * `resolvedNames` (Map clé de variante -> nom de fichier) permet au manifeste de
   * référencer le nom réellement écrit dans le ZIP lorsqu'un doublon a été renommé. */
  buildManifest(serieName, jobs, resolvedNames = null) {
    return {
      Serie: serieName,
      ImportMode: ExportedDataParser.MODE,
      Cards: jobs.map(job => {
        const fileName = (resolvedNames && resolvedNames.has(job.key)) ? resolvedNames.get(job.key) : null;
        return job.item.toManifestEntry(serieName, fileName, job.layout);
      })
    };
  }

  /* Manifeste que contiendrait l'archive, sans rendre la moindre image.
   * Les noms de fichiers sont résolus exactement comme pendant l'export (mêmes doublons
   * renommés), afin que le JSON produit soit identique à celui du ZIP. */
  buildManifestOnly(serieName, items, layoutMode = CardItem.EXPORT_BOTH) {
    const safeSerieName = this.sanitizeName(serieName);
    const { jobs, skipped } = this.buildJobs(items, layoutMode);

    const usedNames = new Set();
    const resolvedNames = new Map(); // clé de variante -> nom de fichier (comme dans exportZip)
    jobs.forEach(job => {
      resolvedNames.set(job.key, this.uniqueFileName(job.item.getFileName(job.layout), usedNames));
    });

    return {
      serie: safeSerieName,
      fileName: `${safeSerieName}.json`,
      manifest: this.buildManifest(safeSerieName, jobs, resolvedNames),
      total: items.length,
      variants: jobs.length,
      skipped
    };
  }

  sanitizeName(name) {
    return (name || 'Cards').replace(/[\\/:*?"<>|]/g, '_').trim() || 'Cards';
  }

  /* Empêche deux cartes distinctes d'écraser le même fichier PNG. */
  uniqueFileName(fileName, usedNames) {
    if (!usedNames.has(fileName)) {
      usedNames.add(fileName);
      return fileName;
    }

    const dot = fileName.lastIndexOf('.');
    const base = dot > 0 ? fileName.slice(0, dot) : fileName;
    const ext = dot > 0 ? fileName.slice(dot) : '';

    let counter = 2;
    let candidate = `${base}_${counter}${ext}`;
    while (usedNames.has(candidate)) {
      counter++;
      candidate = `${base}_${counter}${ext}`;
    }

    usedNames.add(candidate);
    return candidate;
  }

  report(current, total, stepName) {
    if (this.onProgress) {
      // Un total nul produirait une division par zéro côté interface.
      this.onProgress({ current: current || 0, total: total || Math.max(current, 1), stepName });
    }
  }

  /* Libellé lisible d'une mise en page, pour la barre de progression. */
  layoutLabel(layout) {
    return layout === CardItem.LAYOUT_CLASSIC ? 'Classique' : 'Full Art';
  }

  async renderInto(item, lang, folder, fileName, failures, layout) {
    try {
      const blob = await this.renderer.renderToBlob(item, lang, layout);
      if (!blob || !blob.size) {
        failures.push({ index: item.index, lang, layout, reason: 'rendu vide' });
        return false;
      }
      folder.file(fileName, blob);
      return true;
    } catch (err) {
      failures.push({ index: item.index, lang, layout, reason: err.message || String(err) });
      return false;
    }
  }

  /* Construit la liste des variantes à produire.
   * Une carte sans mise en page spécifiée dans le JSON génère les deux variantes ;
   * le mode global (`layoutMode`) peut restreindre le lot à une seule mise en page. */
  buildJobs(items, layoutMode) {
    const jobs = [];
    const skipped = [];

    items.forEach(item => {
      const layouts = item.getLayouts(layoutMode);
      if (layouts.length === 0) {
        skipped.push({
          index: item.index,
          reason: `carte déclarée « ${item.getLayoutKey()} », exclue par le mode d'export « ${layoutMode} »`
        });
        return;
      }
      layouts.forEach(layout => {
        jobs.push({ item, layout, key: `${item.index}::${layout}` });
      });
    });

    return { jobs, skipped };
  }

  async exportZip(serieName, items, layoutMode = CardItem.EXPORT_BOTH) {
    this.isCanceled = false;

    const safeSerieName = this.sanitizeName(serieName);
    const zip = new JSZip();
    const frFolder = zip.folder('fr');
    const enFolder = zip.folder('en');

    const { jobs, skipped } = this.buildJobs(items, layoutMode);

    const usedNames = new Set();
    const resolvedNames = new Map(); // clé de variante -> nom de fichier écrit dans le ZIP
    const failures = [];
    const totalSteps = jobs.length * 2;
    let completedSteps = 0;
    let renderedCount = 0;

    for (let j = 0; j < jobs.length; j++) {
      if (this.isCanceled) break;

      const job = jobs[j];
      const item = job.item;
      const fileName = this.uniqueFileName(item.getFileName(job.layout), usedNames);
      resolvedNames.set(job.key, fileName);

      // Version française
      this.report(completedSteps + 1, totalSteps,
        `Rendu ${this.layoutLabel(job.layout)} FR : ${item.index} (${item.getName('FR')})`);
      if (await this.renderInto(item, 'FR', frFolder, fileName, failures, job.layout)) renderedCount++;
      completedSteps++;

      if (this.isCanceled) break;

      // Version anglaise
      this.report(completedSteps + 1, totalSteps,
        `Rendu ${this.layoutLabel(job.layout)} EN : ${item.index} (${item.getName('EN')})`);
      if (await this.renderInto(item, 'EN', enFolder, fileName, failures, job.layout)) renderedCount++;
      completedSteps++;
    }

    if (this.isCanceled) {
      throw new Error('Export annulé par l’utilisateur.');
    }

    // Manifeste JSON des cartes (une entrée par variante produite)
    const manifest = this.buildManifest(safeSerieName, jobs, resolvedNames);
    const manifestName = `${safeSerieName}.json`;
    zip.file(manifestName, JSON.stringify(manifest, null, 2));

    this.report(totalSteps || 1, totalSteps || 1, 'Compression du fichier ZIP en cours...');

    const zipBlob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });

    const zipFileName = `${safeSerieName}.zip`;

    const link = document.createElement('a');
    link.href = URL.createObjectURL(zipBlob);
    link.download = zipFileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);

    this.lastReport = {
      serie: safeSerieName,
      zipFileName,
      manifestName,
      total: items.length,
      variants: jobs.length,
      renderedCount,
      failures,
      skipped,
      warnings: this.renderer.getWarnings ? this.renderer.getWarnings() : [],
      unavailableResources: this.renderer.inliner ? this.renderer.inliner.getFailures() : []
    };

    return this.lastReport;
  }
}

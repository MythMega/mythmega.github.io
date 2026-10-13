/* Contrôleur principal de l'application Bulk Generator */
class BulkApp {
  constructor() {
    this.tableContainer = document.getElementById('table-container');
    this.jsonInput = document.getElementById('json-input');
    this.fileInput = document.getElementById('file-input');
    this.serieInput = document.getElementById('serie-name-input');
    this.layoutModeSelect = document.getElementById('layout-mode');
    this.loadBtn = document.getElementById('load-btn');
    this.exportBtn = document.getElementById('export-btn');
    this.jsonBtn = document.getElementById('download-json-btn');
    this.limitFullArtTextInput = document.getElementById('limit-fullart-text');
    this.foilBgInput = document.getElementById('foil-bg-input');
    this.foilUnderlayInput = document.getElementById('foil-underlay-input');
    this.foilBgValue = document.getElementById('foil-bg-value');
    this.foilUnderlayValue = document.getElementById('foil-underlay-value');
    this.foilMythicBgInput = document.getElementById('foil-mythic-bg-input');
    this.foilMythicUnderlayInput = document.getElementById('foil-mythic-underlay-input');
    this.foilMythicBgValue = document.getElementById('foil-mythic-bg-value');
    this.foilMythicUnderlayValue = document.getElementById('foil-mythic-underlay-value');
    this.foilResetBtn = document.getElementById('foil-reset-btn');
    this.cardCountEl = document.getElementById('card-count');
    this.renderContainer = document.getElementById('render-card');

    // Éléments du modal de prévisualisation
    this.modal = document.getElementById('preview-modal');
    this.modalClose = document.getElementById('modal-close');
    this.previewCard = document.getElementById('preview-card');
    this.langToggleFR = document.getElementById('lang-toggle-fr');
    this.langToggleEN = document.getElementById('lang-toggle-en');
    this.layoutToggleFullArt = document.getElementById('layout-toggle-fullart');
    this.layoutToggleClassic = document.getElementById('layout-toggle-classic');
    this.currentPreviewItem = null;
    this.currentPreviewLang = 'FR';
    this.currentPreviewLayout = 'fullart';
    this.previewToken = 0;

    // Modal de progression
    this.progressModal = document.getElementById('progress-modal');
    this.progressBar = document.getElementById('progress-bar');
    this.progressText = document.getElementById('progress-text');
    this.progressDetails = document.getElementById('progress-details');

    // Un seul ResourceInliner partagé : le cache des Data URLs (et donc les images
    // déjà téléchargées) est réutilisé entre l'aperçu et l'export.
    this.inliner = new ResourceInliner();

    // Notes et informations du dernier import, conservées pour être réaffichées lorsque
    // le nombre de cartes change (ajout / duplication / suppression de lignes).
    this.importNotes = [];
    this.importInfo = '';
    this.importMode = '';

    this.tableManager = new TableManager(
      this.tableContainer,
      (item) => this.showPreview(item),
      (count) => this.updateCardCount(count)
    );
    this.renderer = new CardRenderer(this.renderContainer, this.inliner);
    this.previewRenderer = new CardRenderer(this.previewCard, this.inliner);
    this.exporter = new BatchExporter(this.renderer, (progress) => this.updateProgress(progress));

    this.serieName = 'Items';
    this.globalBackground = '';

    this.bindEvents();

    // L'option globale de rendu est appliquée au chargement, d'après l'état de la case.
    this.applyLimitFullArtText();

    // Intensités de foil initiales, d'après la position des curseurs.
    this.applyFoilStrength();

    // Le tableau démarre vide, mais sa barre d'outils permet déjà d'ajouter une ligne.
    this.tableManager.render();
  }

  bindEvents() {
    this.loadBtn.addEventListener('click', () => this.handleJsonLoad());
    this.fileInput.addEventListener('change', (e) => this.handleFileUpload(e));
    this.exportBtn.addEventListener('click', () => this.handleExport());
    this.jsonBtn.addEventListener('click', () => this.handleJsonExport());

    // Option globale de rendu : la case est lue à chaque changement puis appliquée
    // aux deux moteurs de rendu (aperçu + export ZIP).
    if (this.limitFullArtTextInput) {
      this.limitFullArtTextInput.addEventListener('change', () => this.applyLimitFullArtText());
    }

    // Curseurs d'intensité du foil (image de fond / underlay)
    if (this.foilBgInput) this.foilBgInput.addEventListener('input', () => this.applyFoilStrength());
    if (this.foilUnderlayInput) this.foilUnderlayInput.addEventListener('input', () => this.applyFoilStrength());
    if (this.foilMythicBgInput) this.foilMythicBgInput.addEventListener('input', () => this.applyFoilStrength());
    if (this.foilMythicUnderlayInput) this.foilMythicUnderlayInput.addEventListener('input', () => this.applyFoilStrength());
    if (this.foilResetBtn) {
      this.foilResetBtn.addEventListener('click', () => {
        this.foilBgInput.value = Math.round(CardRenderer.DEFAULT_FOIL_BG_STRENGTH * 100);
        this.foilUnderlayInput.value = Math.round(CardRenderer.DEFAULT_FOIL_UNDERLAY_STRENGTH * 100);
        this.foilMythicBgInput.value = Math.round(CardRenderer.DEFAULT_FOIL_BG_STRENGTH * 100);
        this.foilMythicUnderlayInput.value = Math.round(CardRenderer.DEFAULT_FOIL_UNDERLAY_STRENGTH * 100);
        this.applyFoilStrength();
      });
    }

    // Modal
    this.modalClose.addEventListener('click', () => this.hidePreview());
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this.hidePreview();
    });

    this.langToggleFR.addEventListener('click', () => {
      this.currentPreviewLang = 'FR';
      this.langToggleFR.classList.add('active');
      this.langToggleEN.classList.remove('active');
      if (this.currentPreviewItem) {
        this.renderPreview();
      }
    });

    this.langToggleEN.addEventListener('click', () => {
      this.currentPreviewLang = 'EN';
      this.langToggleEN.classList.add('active');
      this.langToggleFR.classList.remove('active');
      if (this.currentPreviewItem) {
        this.renderPreview();
      }
    });

    // Bascule de mise en page dans l'aperçu (Full Art / Classique)
    this.layoutToggleFullArt.addEventListener('click', () => {
      this.currentPreviewLayout = CardItem.LAYOUT_FULLART;
      this.syncLayoutToggle();
      if (this.currentPreviewItem) {
        this.renderPreview();
      }
    });

    this.layoutToggleClassic.addEventListener('click', () => {
      this.currentPreviewLayout = CardItem.LAYOUT_CLASSIC;
      this.syncLayoutToggle();
      if (this.currentPreviewItem) {
        this.renderPreview();
      }
    });
  }

  /* Reflète la mise en page courante sur les boutons de bascule de l'aperçu. */
  syncLayoutToggle() {
    const isClassic = this.currentPreviewLayout === CardItem.LAYOUT_CLASSIC;
    this.layoutToggleClassic.classList.toggle('active', isClassic);
    this.layoutToggleFullArt.classList.toggle('active', !isClassic);
  }

  handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      this.jsonInput.value = e.target.result;
      this.handleJsonLoad();
    };
    reader.readAsText(file);
  }

  handleJsonLoad() {
    const raw = this.jsonInput.value.trim();
    if (!raw) {
      alert('Veuillez coller un JSON ou charger un fichier.');
      return;
    }

    try {
      const parsed = JSON.parse(raw);
      const result = ImportManager.parse(parsed);

      this.serieName = result.serie || 'Items';
      this.globalBackground = result.background || '';

      this.serieInput.value = this.serieName;
      this.importNotes = result.notes || [];
      this.importInfo = result.info || '';
      this.importMode = result.mode;
      this.importNotes.forEach(note => console.warn(note));
      if (this.importInfo) console.info(this.importInfo);

      this.tableManager.setItems(result.items, this.globalBackground);
      this.updateCardCount(result.items.length);
    } catch (err) {
      console.error(err);
      alert('Erreur lors de la lecture du JSON : ' + err.message);
    }
  }

  /* Reflète le nombre de cartes du tableau. Appelé à l'import puis à chaque ajout,
   * duplication ou suppression de ligne. */
  updateCardCount(count) {
    this.cardCountEl.textContent = `${count} carte(s) chargée(s)`;

    // Signale les formats d'import inattendus sans bloquer l'utilisateur.
    if (this.importNotes && this.importNotes.length > 0) {
      this.cardCountEl.textContent += ' ⚠';
    }

    this.cardCountEl.title = this.buildImportDescription();
    this.exportBtn.disabled = count === 0;
    this.jsonBtn.disabled = count === 0;
  }

  /* Infobulle du compteur : format d'import reconnu, regroupement éventuel des variantes
   * d'un manifeste exporté, et notes éventuelles du dernier import. */
  buildImportDescription() {
    const parts = [];
    if (this.importMode) parts.push(`Format d'import : ${this.importMode}`);
    if (this.importInfo) parts.push(this.importInfo);
    if (this.importNotes && this.importNotes.length > 0) parts.push(this.importNotes.join('\n'));
    return parts.join('\n');
  }

  /* Option globale « limiter le texte Full Art » : appliquée à l'aperçu et aux images du
   * ZIP (les deux moteurs de rendu), sans jamais toucher aux données ni au JSON exporté,
   * qui conservent toujours la description complète.
   * La case est cochée par défaut dans le HTML : l'option est donc active dès le 1er rendu. */
  applyLimitFullArtText() {
    const enabled = !!(this.limitFullArtTextInput && this.limitFullArtTextInput.checked);
    if (this.renderer) this.renderer.setLimitFullArtText(enabled);
    if (this.previewRenderer) this.previewRenderer.setLimitFullArtText(enabled);

    // Un aperçu déjà ouvert est réactualisé immédiatement avec la nouvelle option.
    if (this.currentPreviewItem) this.showPreview(this.currentPreviewItem);
  }

  /* Intensité du foil par couche : lue sur les deux curseurs puis appliquée aux deux
   * moteurs de rendu (aperçu + export ZIP). N'affecte que le rendu des images. */
  applyFoilStrength() {
    if (!this.foilBgInput || !this.foilUnderlayInput || !this.foilMythicBgInput || !this.foilMythicUnderlayInput) return;

    const bg = parseInt(this.foilBgInput.value, 10) || 0;
    const underlay = parseInt(this.foilUnderlayInput.value, 10) || 0;
    this.foilBgValue.textContent = `${bg}%`;
    this.foilUnderlayValue.textContent = `${underlay}%`;

    // Curseurs dédiés à la rareté Mythique.
    const mythicBg = parseInt(this.foilMythicBgInput.value, 10) || 0;
    const mythicUnderlay = parseInt(this.foilMythicUnderlayInput.value, 10) || 0;
    this.foilMythicBgValue.textContent = `${mythicBg}%`;
    this.foilMythicUnderlayValue.textContent = `${mythicUnderlay}%`;

    const args = [bg / 100, underlay / 100, mythicBg / 100, mythicUnderlay / 100];
    if (this.renderer) this.renderer.setFoilStrength(...args);
    if (this.previewRenderer) this.previewRenderer.setFoilStrength(...args);

    // Un aperçu ouvert est réactualisé (sans changer la mise en page / langue choisies).
    if (this.currentPreviewItem && this.modal.classList.contains('active')) this.renderPreview();
  }

  showPreview(item) {
    this.currentPreviewItem = item;
    // L'aperçu s'ouvre sur la mise en page déclarée par la carte (Full Art par défaut).
    this.currentPreviewLayout = item.getLayout() || CardItem.LAYOUT_FULLART;
    this.syncLayoutToggle();
    this.modal.classList.add('active');
    this.renderPreview();
  }

  /* Aperçu fidèle au rendu exporté : on réutilise les mêmes ressources incorporées
   * (pixel art agrandi sans interpolation) que celles utilisées lors de l'export.
   * Si une ressource est inaccessible, on retombe sur son URL d'origine. */
  async renderPreview() {
    const item = this.currentPreviewItem;
    if (!item) return;

    const token = ++this.previewToken;
    const resources = await this.previewRenderer.prepareResources(item);
    if (token !== this.previewToken) return; // Un autre aperçu a été demandé entre-temps.

    this.previewRenderer.setupCard(item, this.currentPreviewLang, {
      background: resources.background || item.background,
      underlay: resources.underlay || item.underlay
    }, this.currentPreviewLayout);
  }

  hidePreview() {
    this.modal.classList.remove('active');
  }

  updateProgress(info) {
    const pct = Math.round((info.current / info.total) * 100);
    this.progressBar.style.width = `${pct}%`;
    this.progressText.textContent = `${pct}% (${info.current}/${info.total})`;
    this.progressDetails.textContent = info.stepName;
  }

  /* Télécharge uniquement le manifeste JSON — celui qui serait placé dans le ZIP —
   * sans générer aucune image : beaucoup plus rapide pour mettre à jour les données
   * d'une série déjà exportée. Le nom de fichier et le contenu sont identiques à
   * ceux de l'archive ({Serie}.json). */
  handleJsonExport() {
    const items = this.tableManager.getItems();
    if (!items || items.length === 0) {
      alert('Aucune carte à exporter.');
      return;
    }

    const serieName = this.serieInput.value.trim() || 'Cartes';
    const exportMode = this.layoutModeSelect ? this.layoutModeSelect.value : CardItem.EXPORT_BOTH;

    const result = this.exporter.buildManifestOnly(serieName, items, exportMode);
    this.downloadJson(result.fileName, result.manifest);

    // Les cartes exclues par le mode d'export ne figurent pas dans le manifeste,
    // exactement comme dans le ZIP : on le signale sans bloquer le téléchargement.
    if (result.skipped.length > 0) {
      let message = `${result.fileName} téléchargé : ${result.variants} entrée(s) pour ${result.total} carte(s).\n\n` +
        `⚠ ${result.skipped.length} carte(s) exclue(s) par le mode d'export :\n`;
      result.skipped.slice(0, 10).forEach(skipped => {
        message += `  • ${skipped.index} — ${skipped.reason}\n`;
      });
      if (result.skipped.length > 10) message += `  … et ${result.skipped.length - 10} autre(s).\n`;
      alert(message);
    }
  }

  /* Télécharge un objet JS au format JSON, indenté comme le manifeste du ZIP. */
  downloadJson(fileName, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  }

  async handleExport() {
    const items = this.tableManager.getItems();
    if (!items || items.length === 0) {
      alert('Aucune carte à exporter.');
      return;
    }

    const serieName = this.serieInput.value.trim() || 'Cartes';
    const exportMode = this.layoutModeSelect ? this.layoutModeSelect.value : CardItem.EXPORT_BOTH;
    this.renderer.resetWarnings();
    this.progressModal.classList.add('active');
    this.exportBtn.disabled = true;

    try {
      const report = await this.exporter.exportZip(serieName, items, exportMode);
      this.progressDetails.textContent = 'Terminé.';

      setTimeout(() => {
        this.progressModal.classList.remove('active');
        this.exportBtn.disabled = false;
        const recap = this.buildReportMessage(report);
        if (recap) alert(recap);
      }, 500);
    } catch (err) {
      console.error(err);
      alert('Erreur durant l’exportation : ' + err.message);
      this.progressModal.classList.remove('active');
      this.exportBtn.disabled = false;
    }
  }

  /* Construit un récapitulatif lisible après l'export.
   * Retourne une chaîne vide si tout s'est parfaitement déroulé. */
  buildReportMessage(report) {
    if (!report) return '';

    const problems = (report.failures || []).length;
    const warnings = (report.warnings || []).length;
    const unavailable = (report.unavailableResources || []).length;
    const skipped = (report.skipped || []).length;

    if (problems === 0 && warnings === 0 && unavailable === 0 && skipped === 0) return '';

    let message = `Archive ${report.zipFileName} générée : ${report.renderedCount} image(s) PNG + ${report.manifestName}.\n`;

    if (report.variants !== undefined) {
      message += `Variantes produites : ${report.variants} (à partir de ${report.total} carte(s) source).\n`;
    }

    if (skipped > 0) {
      message += `\n⚠ ${skipped} carte(s) ignorée(s) (mode d'export incompatible avec leur type) :\n`;
      report.skipped.slice(0, 10).forEach(s => {
        message += `  • ${s.index} — ${s.reason}\n`;
      });
      if (skipped > 10) message += `  … et ${skipped - 10} autre(s).\n`;
    }

    if (problems > 0) {
      message += `\n⚠ ${problems} rendu(s) en échec :\n`;
      report.failures.slice(0, 10).forEach(f => {
        message += `  • ${f.index} (${f.lang}) — ${f.reason}\n`;
      });
      if (problems > 10) message += `  … et ${problems - 10} autre(s).\n`;
    }

    if (unavailable > 0) {
      message += `\n⚠ ${unavailable} image(s) distante(s) inaccessible(s) (CORS / anti-hotlink).\n`;
      message += `  Les cartes concernées ont été générées, mais sans cette image :\n`;
      report.unavailableResources.slice(0, 10).forEach(u => {
        message += `  • ${u}\n`;
      });
      if (unavailable > 10) message += `  … et ${unavailable - 10} autre(s).\n`;
    }

    if (warnings > 0) {
      message += `\n⚠ ${warnings} avertissement(s) :\n`;
      report.warnings.slice(0, 10).forEach(w => {
        message += `  • ${w}\n`;
      });
      if (warnings > 10) message += `  … et ${warnings - 10} autre(s).\n`;
    }

    return message;
  }
}

// Initialisation au chargement de la page
document.addEventListener('DOMContentLoaded', () => {
  window.bulkApp = new BulkApp();
});

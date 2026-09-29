/* Moteur de rendu d'une carte : HTML -> canvas -> Blob PNG */
class CardRenderer {
  static RENDER_SCALE = 2;
  static IMAGE_TIMEOUT = 8000;

  /* Classe CSS correspondant à une mise en page.
   * null / 'fullart' => full art (comportement historique), 'classic' => classique. */
  static layoutCssClass(layout) {
    return layout === CardItem.LAYOUT_CLASSIC ? 'card-layout-classic' : 'card-layout-fullart';
  }

  constructor(cardElement, inliner = null) {
    this.cardElement = cardElement;
    this.titleEl = cardElement.querySelector('.card-title');
    this.seriesEl = cardElement.querySelector('.card-series');
    this.rarityEl = cardElement.querySelector('.card-rarity');
    this.artEl = cardElement.querySelector('.card-art');
    this.underlayEl = cardElement.querySelector('.card-underlay');
    this.textEl = cardElement.querySelector('.card-text');

    this.inliner = inliner || new ResourceInliner();
    this.warnings = [];

    // Mise en page actuellement appliquée au DOM (voir setupCard).
    this.currentLayout = CardItem.LAYOUT_FULLART;

    // Moteur de rendu SVG <foreignObject> : rasterise via le vrai moteur CSS du
    // navigateur, contrairement à html2canvas qui ignore clip-path, mix-blend-mode
    // et conic-gradient (bordures biseautées + foils Rare/Super Rare/Légendaire).
    this.svgRenderer = new SvgDomRenderer();
  }

  getWarnings() {
    return this.warnings.slice();
  }

  resetWarnings() {
    this.warnings = [];
  }

  addWarning(message) {
    if (message && this.warnings.indexOf(message) === -1) {
      this.warnings.push(message);
    }
  }

  /* Applique le contenu et le style d'une carte au DOM.
   * `resources` (optionnel) fournit des images déjà incorporées en Data URL :
   *   { background: 'data:...', underlay: 'data:...' }
   * Sans `resources`, les URLs brutes de l'item sont utilisées (aperçu navigateur).
   * `layout` choisit la mise en page : CardItem.LAYOUT_CLASSIC ou LAYOUT_FULLART. */
  setupCard(item, lang = 'FR', resources = null, layout = null) {
    const rarity = RarityDef.get(item.rarity);

    const background = resources ? (resources.background || '') : item.background;
    const underlay = resources ? (resources.underlay || '') : item.underlay;

    this.titleEl.textContent = item.getName(lang);
    this.seriesEl.textContent = item.index;
    this.rarityEl.textContent = rarity.symbol;
    this.textEl.textContent = item.getDescription(lang);

    this.artEl.style.backgroundImage = background ? `url("${this.escapeCssUrl(background)}")` : 'none';
    this.underlayEl.style.backgroundImage = underlay ? `url("${this.escapeCssUrl(underlay)}")` : 'none';

    // La mise en page classique peint le fond ultra flouté de son bloc de description
    // à partir de cette variable : uniquement l'image de fond, jamais l'underlay.
    if (background) {
      this.cardElement.style.setProperty('--card-background-image', `url("${this.escapeCssUrl(background)}")`);
    } else {
      this.cardElement.style.removeProperty('--card-background-image');
    }

    // Police de caractères : même logique que cards.html (variable --card-font pour
    // la famille, classe d'ajustement des tailles pour le pixel art). item.font est
    // déjà normalisé par FontDef ; le champ historique « Style » sert de repli pour
    // d'éventuels items construits hors CardItem.
    const font = FontDef.get(item.font !== undefined && item.font !== null ? item.font : item.style);
    if (font.family) {
      this.cardElement.style.setProperty('--card-font', font.family);
    } else {
      this.cardElement.style.removeProperty('--card-font');
    }

    this.cardElement.className = `card-preview ${rarity.cssClass} ${font.cssClass} ${CardRenderer.layoutCssClass(layout)}`.replace(/\s+/g, ' ').trim();
    this.currentLayout = CardRenderer.layoutCssClass(layout) === 'card-layout-classic'
      ? CardItem.LAYOUT_CLASSIC
      : CardItem.LAYOUT_FULLART;
  }

  escapeCssUrl(url) {
    return String(url).replace(/["\\]/g, '\\$&');
  }

  /* Convertit toutes les images de la carte en Data URLs.
   * Une ressource inaccessible (CORS / anti-hotlink) est signalée puis omise :
   * mieux vaut une carte complète sans fond qu'un PNG vide — voire absent du ZIP. */
  async prepareResources(item) {
    const resources = { background: '', underlay: '' };

    if (item.background) {
      const inlined = await this.inliner.inline(item.background, { pixelated: false });
      if (inlined) {
        resources.background = inlined;
      } else {
        this.addWarning(`Image de fond inaccessible depuis le navigateur (CORS / anti-hotlink) : ${item.background}`);
      }
    }

    if (item.underlay) {
      const inlined = await this.inliner.inline(item.underlay, { pixelated: true });
      if (inlined) {
        resources.underlay = inlined;
      } else {
        this.addWarning(`Underlay inaccessible depuis le navigateur (CORS / anti-hotlink) : ${item.underlay}`);
      }
    }

    return resources;
  }

  /* Rendu complet d'une carte sous forme de Blob PNG.
   * Trois tentatives successives garantissent qu'un PNG est toujours produit :
   *   1. ressources incorporées (fidélité maximale)
   *   2. sans l'image de fond distante
   *   3. sans aucune image */
  async renderToBlob(item, lang = 'FR', layout = null) {
    const resources = await this.prepareResources(item);
    const plans = this.buildRenderPlans(item, resources);

    let lastError = null;
    for (let i = 0; i < plans.length; i++) {
      try {
        const blob = await this.renderOnce(item, lang, plans[i], layout);
        if (blob) {
          if (i > 0) {
            this.addWarning(`Rendu de secours « ${plans[i].label} » utilisé pour ${item.index} (${lang}).`);
          }
          return blob;
        }
      } catch (err) {
        lastError = err;
      }
    }

    throw new Error(`Rendu impossible pour ${item.index} (${lang})${lastError ? ' : ' + lastError.message : ''}`);
  }

  /* Construit la liste des tentatives de rendu, de la plus fidèle à la plus dégradée.
   * Cela garantit qu'une carte ne peut jamais être absente de l'archive ZIP. */
  buildRenderPlans(item, resources) {
    // Si une ressource n'a pas pu être incorporée en Data URL, on retente le rendu
    // avec l'URL d'origine : html2canvas la chargera peut-être via useCORS.
    const rawBackground = (!resources.background && item.background) ? item.background : '';
    const rawUnderlay = (!resources.underlay && item.underlay) ? item.underlay : '';

    const plans = [
      { label: 'complet', background: resources.background, underlay: resources.underlay }
    ];

    if (rawBackground || rawUnderlay) {
      plans.push({
        label: 'urls-origine',
        background: resources.background || rawBackground,
        underlay: resources.underlay || rawUnderlay
      });
    }

    plans.push({ label: 'sans-fond', background: '', underlay: resources.underlay || rawUnderlay });
    plans.push({ label: 'sans-images', background: '', underlay: '' });

    return plans;
  }

  async renderOnce(item, lang, plan, layout = null) {
    this.setupCard(item, lang, { background: plan.background, underlay: plan.underlay }, layout);
    await this.waitForFonts();
    await this.sleep(60);

    // Rendu via le moteur SVG (vrai moteur CSS du navigateur) : préserve les
    // bordures biseautées (clip-path) et les foils (mix-blend-mode, conic-gradient),
    // que html2canvas ne sait pas restituer fidèlement.
    let blob = null;
    try {
      blob = await this.svgRenderer.renderToBlob(this.cardElement, { scale: CardRenderer.RENDER_SCALE });
    } catch (err) {
      // Laisse `blob` à null : le repli html2canvas ci-dessous prend le relais.
      // Ce plan (`renderOnce`) sera de toute façon retenté par buildRenderPlans
      // avec des ressources dégradées si le problème vient des images.
    }

    if (blob && blob.size > 0) return blob;

    // Repli : html2canvas, moins fidèle (bordures carrées, foils approximatifs)
    // mais garantit qu'une carte n'est jamais absente du ZIP.
    this.addWarning(`Rendu SVG indisponible pour ${item.index} (${lang}), repli sur html2canvas (bordures/foils approximatifs).`);
    const canvas = await html2canvas(this.cardElement, {
      useCORS: true,
      allowTaint: false,
      scale: CardRenderer.RENDER_SCALE,
      backgroundColor: null,
      logging: false,
      imageTimeout: CardRenderer.IMAGE_TIMEOUT
    });

    blob = await this.canvasToBlobReliable(canvas);
    this.releaseCanvas(canvas);
    return blob;
  }

  /* Extrait un Blob d'un canvas de façon fiable.
   * canvas.toBlob() peut renvoyer null sans erreur (canvas trop grand, mémoire
   * saturée, canvas « teinté »…). On bascule alors sur une Data URL, plus lente
   * mais nettement plus robuste. C'est ce qui évite les cartes manquantes du ZIP. */
  async canvasToBlobReliable(canvas) {
    let blob = await this.toBlob(canvas);
    if (blob && blob.size > 0) return blob;

    try {
      const dataUrl = canvas.toDataURL('image/png');
      if (dataUrl && dataUrl.indexOf('data:image') === 0) {
        blob = this.dataUrlToBlob(dataUrl);
        if (blob && blob.size > 0) return blob;
      }
    } catch (err) {
      // Canvas illisible : une ressource cross-origin l'a « teinté ».
    }

    return null;
  }

  toBlob(canvas) {
    return new Promise((resolve) => {
      if (typeof canvas.toBlob !== 'function') {
        resolve(null);
        return;
      }
      try {
        canvas.toBlob((blob) => resolve(blob || null), 'image/png');
      } catch (err) {
        resolve(null);
      }
    });
  }

  dataUrlToBlob(dataUrl) {
    const parts = String(dataUrl).split(',');
    if (parts.length < 2) return null;

    const mimeMatch = /:(.*?);/.exec(parts[0]);
    const mime = mimeMatch ? mimeMatch[1] : 'image/png';
    const binary = atob(parts[1]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mime });
  }

  releaseCanvas(canvas) {
    if (!canvas) return;
    // Réduit fortement la pression mémoire lors de l'export de plusieurs centaines de cartes.
    canvas.width = 0;
    canvas.height = 0;
  }

  async waitForFonts() {
    if (document.fonts && document.fonts.ready) {
      try {
        await document.fonts.ready;
      } catch (err) {
        // ignore
      }
    }
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

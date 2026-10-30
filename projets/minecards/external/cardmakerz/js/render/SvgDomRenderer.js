/* Moteur de rendu par le NAVIGATEUR lui-même (technique SVG <foreignObject>).
 *
 * POURQUOI CE MOTEUR ?
 * `html2canvas` réimplémente le rendu CSS et ignore plusieurs propriétés
 * utilisées par nos cartes :
 *   - clip-path            -> coins biseautés ABSENTS (contours carrés)
 *   - mix-blend-mode       -> foils Super Rare / Légendaire / Mythique PERDUS
 *   - conic-gradient       -> rosaces et kaléidoscopes PERDUS
 *   - backdrop-filter      -> panneaux verre dépoli PERDUS
 *
 * Ici, c'est le navigateur qui rasterise la carte : on sérialise le DOM réel
 * (avec tout le CSS et les images en Data URLs) dans un SVG <foreignObject>,
 * on le charge comme image, puis on le dessine dans un canvas.
 * Le moteur de rendu étant exactement le même que celui de l'aperçu,
 * l'export est identique à ce que voit l'utilisateur.
 */
class SvgDomRenderer {
  static SVG_NS = 'http://www.w3.org/2000/svg';
  static XHTML_NS = 'http://www.w3.org/1999/xhtml';
  static DEFAULT_SCALE = 2;
  static IMAGE_TIMEOUT = 20000;

  constructor(options = {}) {
    this.cssText = '';
    this.cssHref = options.cssHref || this.detectStylesheetHref();
    this.fonts = options.fonts || new FontEmbedder();
    this.failures = [];
    this.readyPromise = null;
  }

  /* Retrouve l'URL de la feuille de style de production (base.css). */
  detectStylesheetHref() {
    const links = document.querySelectorAll('link[rel="stylesheet"]');
    for (let i = 0; i < links.length; i++) {
      const href = links[i].getAttribute('href') || '';
      if (href.indexOf('base.css') !== -1) return links[i].href;
    }
    return './styles/base.css';
  }

  get fontsEmbeddedCount() {
    return this.fonts ? this.fonts.embeddedCount : 0;
  }

  getFailures() {
    return this.failures.slice();
  }

  /* Charge (une seule fois) le CSS de production et les polices incorporées. */
  ready() {
    if (!this.readyPromise) {
      this.readyPromise = this.loadCss();
    }
    return this.readyPromise;
  }

  async loadCss() {
  let css = '';
  try {
    const res = await fetch(this.cssHref, { cache: 'no-store' });
    if (res.ok) css = await res.text();
    else this.failures.push('css HTTP ' + res.status + ' : ' + this.cssHref);
  } catch (err) {
    this.failures.push('css inaccessible : ' + this.cssHref);
  }

  // Repli : lire les règles déjà chargées par la page.
  if (!css.trim()) css = this.readCssFromDocument();

  this.cssText = css;
  if (!css.trim()) this.failures.push('CSS de la carte introuvable');

  try {
    await this.fonts.embed();
  } catch (err) {
    this.failures.push('polices non incorporées');
  }
  return this.cssText;
}

readCssFromDocument() {
  let out = '';
  for (const sheet of Array.from(document.styleSheets)) {
    const href = sheet.href || '';
    if (href && href.indexOf('base.css') === -1) continue; // ignore bulk.css, Google Fonts
    try {
      for (const rule of Array.from(sheet.cssRules)) out += rule.cssText + '\n';
    } catch (err) {
      this.failures.push('feuille illisible : ' + (href || 'inline'));
    }
  }
  return out;
}

  /* CSS complet à injecter dans le SVG : base.css + @font-face incorporées. */
  buildStyleText() {
    const fontCss = this.fonts ? this.fonts.cssText : '';
    return [
      fontCss,
      this.cssText,
      /* Neutralise les styles de page : le fragment n'est pas un <body>. */
      /* color:#fff reproduit l'héritage venant du <body> (color:#fff dans base.css) :
       * ce fragment n'a pas de <body>, donc .card-rarity (qui n'a pas de couleur
       * propre et héritait du body) retombait sur le noir par défaut sans cette règle. */
      '.xport-root{display:block;margin:0;padding:0;border:0;background:transparent;position:relative;color:#fff;}' +
      '.xport-root *{animation:none !important;transition:none !important;}'
    ].join('\n');
  }

  /* Clone le noeud en garantissant une mise en page déterministe. */
  cloneNode(node) {
    const clone = node.cloneNode(true);
    clone.style.margin = '0';
    return clone;
  }

  /* Construit l'URL « data:image/svg+xml » contenant la carte. */
  buildSvgUrl(node, width, height, scale) {
    const clone = this.cloneNode(node);

    const style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.textContent = this.buildStyleText();

    const wrapper = document.createElement('div');
    wrapper.setAttribute('xmlns', SvgDomRenderer.XHTML_NS);
    wrapper.setAttribute('class', 'xport-root');
    wrapper.setAttribute('style', 'width:' + width + 'px;height:' + height + 'px;');
    wrapper.appendChild(style);
    wrapper.appendChild(clone);

    const svg = document.createElementNS(SvgDomRenderer.SVG_NS, 'svg');
    svg.setAttribute('xmlns', SvgDomRenderer.SVG_NS);
    svg.setAttribute('width', String(width * scale));
    svg.setAttribute('height', String(height * scale));
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);

    const fo = document.createElementNS(SvgDomRenderer.SVG_NS, 'foreignObject');
    fo.setAttribute('x', '0');
    fo.setAttribute('y', '0');
    fo.setAttribute('width', String(width));
    fo.setAttribute('height', String(height));
    fo.appendChild(wrapper);
    svg.appendChild(fo);

    const xml = new XMLSerializer().serializeToString(svg);
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
  }

  /* Rasterise le noeud et renvoie un <img> déjà chargé. */
  async renderToImage(node, options = {}) {
    await this.ready();
    if (!this.cssText.trim()) {
      throw new Error('CSS introuvable pour le rendu SVG');
    }
    const scale = options.scale || SvgDomRenderer.DEFAULT_SCALE;
    const rect = node.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));

    const url = this.buildSvgUrl(node, width, height, scale);
    const img = await this.loadImage(url);
    if (!img) {
      throw new Error('Rasterisation SVG impossible (foreignObject)');
    }
    return img;
  }

  async renderToCanvas(node, options = {}) {
    const scale = options.scale || SvgDomRenderer.DEFAULT_SCALE;
    const img = await this.renderToImage(node, { scale });

    const rect = node.getBoundingClientRect();
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(rect.width * scale));
    canvas.height = Math.max(1, Math.round(rect.height * scale));

    const ctx = canvas.getContext('2d');
    // Le SVG est déjà à l'échelle finale : aucun ré-échantillonnage.
    ctx.imageSmoothingEnabled = false;
    ctx.webkitImageSmoothingEnabled = false;
    ctx.mozImageSmoothingEnabled = false;
    ctx.msImageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    return canvas;
  }

  async renderToBlob(node, options = {}) {
    const canvas = await this.renderToCanvas(node, options);
    try {
      return await this.canvasToBlob(canvas);
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  }

  canvasToBlob(canvas) {
    return new Promise((resolve) => {
      try {
        canvas.toBlob((blob) => resolve(blob || null), 'image/png');
      } catch (err) {
        resolve(null);
      }
    });
  }

  loadImage(url) {
    return new Promise((resolve) => {
      const img = new Image();
      const timer = setTimeout(() => resolve(null), SvgDomRenderer.IMAGE_TIMEOUT);
      img.onload = () => { clearTimeout(timer); resolve(img); };
      img.onerror = () => { clearTimeout(timer); resolve(null); };
      img.src = url;
    });
  }
}

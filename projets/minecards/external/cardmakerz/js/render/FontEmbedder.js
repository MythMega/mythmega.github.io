/* Incorporation des polices Google Fonts en Data URLs.
 *
 * POURQUOI ?
 * Un SVG rasterisé via <img> (mode « image ») est un document isolé :
 * il ne peut télécharger AUCUNE ressource externe, ni feuille de style,
 * ni fichier de police. Sans incorporation, la carte exportée perdrait la
 * police « Pixel Art » (Press Start 2P) et retomberait sur une police système.
 *
 * On récupère donc la feuille CSS de Google Fonts, puis on convertit chaque
 * fichier .woff2 en Data URL base64 avant de l'injecter dans le SVG.
 */
class FontEmbedder {
  static GOOGLE_FONTS_HREF =
    'https://fonts.googleapis.com/css2?' +
    'family=Bebas+Neue' +
    '&family=Cinzel:wght@600;800' +
    '&family=Montserrat:ital,wght@0,500;0,800;1,400' +
    '&family=Orbitron:wght@600;900' +
    '&family=Press+Start+2P' +
    '&display=swap';

  /* User-Agent moderne : nécessaire pour obtenir des .woff2 (et non des .ttf). */
  static MODERN_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  constructor() {
    this.cache = null;
    this._embeddedCount = 0;
    this.failures = [];
  }

  get cssText() {
    return this.cache || '';
  }

  get embeddedCount() {
    return this._embeddedCount;
  }

  getFailures() {
    return this.failures.slice();
  }

  /* Renvoie la feuille @font-face complète, polices incluses en base64. */
  async embed() {
    if (this.cache !== null) return this.cache;

    try {
      const cssUrl = FontEmbedder.GOOGLE_FONTS_HREF;
      const css = await this.fetchText(cssUrl);
      if (!css) {
        this.cache = '';
        return this.cache;
      }

      // Récupère toutes les URLs de polices puis les télécharge en parallèle.
      const urls = [];
      const urlRegex = /url\((https:\/\/[^)]+)\)/g;
      let match;
      while ((match = urlRegex.exec(css)) !== null) {
        if (urls.indexOf(match[1]) === -1) urls.push(match[1]);
      }

      const dataUrls = await Promise.all(urls.map((u) => this.toDataUrl(u)));

      const map = new Map();
      for (let i = 0; i < urls.length; i++) {
        map.set(urls[i], dataUrls[i]);
      }

      let output = css;
      urls.forEach((u) => {
        const dataUrl = map.get(u);
        if (dataUrl) {
          output = output.split(u).join(dataUrl);
          this._embeddedCount++;
        } else {
          this.failures.push(u);
        }
      });

      this.cache = output;
      return this.cache;
    } catch (err) {
      this.failures.push('css:' + (err && err.message ? err.message : String(err)));
      this.cache = '';
      return this.cache;
    }
  }

  async fetchText(url) {
    try {
      const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (!res.ok) return null;
      return await res.text();
    } catch (err) {
      return null;
    }
  }

  async toDataUrl(url) {
    try {
      const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (!res.ok) return null;
      const blob = await res.blob();
      return await this.blobToDataUrl(blob);
    } catch (err) {
      return null;
    }
  }

  blobToDataUrl(blob) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  }
}

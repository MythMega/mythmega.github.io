/* Incorporation de ressources externes (images) en Data URLs, avec cache partagé
 * et détection des échecs (CORS / anti-hotlink).
 *
 * Une image chargée depuis un domaine distant sans en-tête
 * Access-Control-Allow-Origin adéquat « teinte » le canvas dès qu'on tente d'en
 * lire le contenu (toDataURL) : on retombe alors sur fetch() en mode CORS, qui
 * échoue proprement (sans exception de sécurité) si le serveur bloque vraiment
 * la requête cross-origin.
 *
 * Le cache est partagé entre l'aperçu (modal) et l'export en lot (BulkApp les
 * instancie une seule fois) : une image déjà incorporée n'est jamais retéléchargée.
 */
class ResourceInliner {
  static IMAGE_TIMEOUT = 15000;
  static UPSCALE_TARGET = 1024; // cf. pixel art : cible d'agrandissement minimal (px)

  constructor() {
    this.cache = new Map();   // clé (url+mode) -> Data URL | null
    this.pending = new Map(); // clé (url+mode) -> Promise en cours (anti-doublons)
    this.failures = [];       // URLs n'ayant pas pu être incorporées
  }

  getFailures() {
    return this.failures.slice();
  }

  resetFailures() {
    this.failures = [];
  }

  clearCache() {
    this.cache.clear();
    this.pending.clear();
  }

  /* Convertit une URL en Data URL.
   * `options.pixelated` agrandit l'image (pixel art) avec un rééchantillonnage
   * au plus proche voisin, sans lissage — cf. underlay.
   * Renvoie '' pour une URL vide, ou null si l'incorporation a échoué. */
  async inline(url, options = {}) {
    if (!url) return '';

    const pixelated = !!options.pixelated;
    const cacheKey = `${pixelated ? 'p' : 'n'}::${url}`;

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }
    if (this.pending.has(cacheKey)) {
      return this.pending.get(cacheKey);
    }

    const promise = this._inlineUncached(url, pixelated).then((result) => {
      this.cache.set(cacheKey, result);
      this.pending.delete(cacheKey);
      if (!result && this.failures.indexOf(url) === -1) {
        this.failures.push(url);
      }
      return result;
    });

    this.pending.set(cacheKey, promise);
    return promise;
  }

  async _inlineUncached(url, pixelated) {
    // Tentative 1 : <img crossorigin="anonymous"> + canvas (gère nativement l'upscale pixel art).
    const viaCanvas = await this.loadViaCanvas(url, pixelated);
    if (viaCanvas) return viaCanvas;

    // Tentative 2 : fetch() direct en mode CORS. Certains serveurs répondent
    // correctement à fetch() mais posent problème avec <img crossorigin> (ou l'inverse).
    const viaFetch = await this.loadViaFetch(url);
    if (!viaFetch) return null;

    return pixelated ? this.upscaleDataUrl(viaFetch, pixelated) : viaFetch;
  }

  loadViaCanvas(url, pixelated) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';

      const timer = setTimeout(() => resolve(null), ResourceInliner.IMAGE_TIMEOUT);

      img.onload = () => {
        clearTimeout(timer);
        try {
          resolve(this.drawToDataUrl(img, pixelated));
        } catch (err) {
          // Canvas « teinté » : le serveur distant n'autorise pas le CORS.
          resolve(null);
        }
      };

      img.onerror = () => {
        clearTimeout(timer);
        resolve(null);
      };

      img.src = url;
    });
  }

  drawToDataUrl(img, pixelated) {
    let w = img.naturalWidth;
    let h = img.naturalHeight;

    if (pixelated) {
      const maxDim = Math.max(w, h);
      const scale = maxDim < ResourceInliner.UPSCALE_TARGET
        ? Math.max(1, Math.floor(ResourceInliner.UPSCALE_TARGET / maxDim))
        : 1;
      w *= scale;
      h *= scale;
    }

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext('2d');
    if (pixelated) {
      ctx.imageSmoothingEnabled = false;
      ctx.webkitImageSmoothingEnabled = false;
      ctx.mozImageSmoothingEnabled = false;
      ctx.msImageSmoothingEnabled = false;
    }

    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/png'); // lève une exception si le canvas est teinté
  }

  async loadViaFetch(url) {
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

  /* Réapplique l'agrandissement pixel art sur une Data URL déjà récupérée via fetch(). */
  upscaleDataUrl(dataUrl, pixelated) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          resolve(this.drawToDataUrl(img, pixelated));
        } catch (err) {
          // Le blob provenant du même fetch() ne devrait normalement pas teinter le canvas.
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }
}

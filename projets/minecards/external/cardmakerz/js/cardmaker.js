const inputTitle = document.getElementById('input-title');
const inputSeries = document.getElementById('input-series');
const inputFont = document.getElementById('input-font');
const inputRarity = document.getElementById('input-rarity');
const inputImage = document.getElementById('input-image');
const inputUnderlay = document.getElementById('input-underlay');
const inputText = document.getElementById('input-text');
const inputLayout = document.getElementById('input-layout');
const inputFoilBg = document.getElementById('input-foil-bg');
const inputFoilUnderlay = document.getElementById('input-foil-underlay');
const inputFoilMythicBg = document.getElementById('input-foil-mythic-bg');
const inputFoilMythicUnderlay = document.getElementById('input-foil-mythic-underlay');
const foilMythicBgValue = document.getElementById('foil-mythic-bg-value');
const foilMythicUnderlayValue = document.getElementById('foil-mythic-underlay-value');
const foilBgValue = document.getElementById('foil-bg-value');
const foilUnderlayValue = document.getElementById('foil-underlay-value');

const cardElement = document.getElementById('card');
const cardTitle = document.getElementById('card-title');
const cardSeries = document.getElementById('card-series');
const cardRarity = document.getElementById('card-rarity');
const cardArt = document.getElementById('card-art');
const cardUnderlay = document.getElementById('card-underlay');
const cardText = document.getElementById('card-text');

/* Mises en page disponibles (mêmes valeurs que celles utilisées par le Bulk Generator). */
const LAYOUT_FULLART = 'fullart';
const LAYOUT_CLASSIC = 'classic';

/* Applique la classe de mise en page au conteneur de la carte.
 * « classic » -> bandeau du nom en haut (7 %), bloc de description en bas (60 %).
 * Tout le reste -> full art (comportement historique). */
function applyLayoutClass(layout) {
  const isClassic = layout === LAYOUT_CLASSIC;
  cardElement.classList.toggle('card-layout-classic', isClassic);
  cardElement.classList.toggle('card-layout-fullart', !isClassic);
}

/* Mise en page courante de l'aperçu (= celle du fichier téléchargé). */
function previewLayout() {
  return inputLayout.value === LAYOUT_CLASSIC ? LAYOUT_CLASSIC : LAYOUT_FULLART;
}

/* Applique l'image de fond à la carte.
 * La variable CSS --card-background-image est également alimentée : la mise en page
 * classique l'utilise pour peindre le fond ultra flouté du bloc de description. */
function applyCardBackground(url) {
  cardArt.style.backgroundImage = url ? `url('${url}')` : 'none';
  if (url) {
    cardElement.style.setProperty('--card-background-image', `url('${url}')`);
  } else {
    cardElement.style.removeProperty('--card-background-image');
  }
}

/* Intensité du foil par couche (en %, 100 % = intensité de la rareté telle quelle).
 * Pilote les variables CSS --foil-bg-strength / --foil-underlay-strength ; posées en
 * style en ligne sur la carte, elles sont donc aussi reprises par le rendu exporté. */
function applyFoilStrength() {
  // La rareté Mythique (foil pleine surface, très coloré) a ses propres curseurs.
  const rarityOption = inputRarity.options[inputRarity.selectedIndex];
  const isMythic = rarityOption.getAttribute('data-class') === 'rarity-mythic';
  const bg = isMythic ? inputFoilMythicBg.value : inputFoilBg.value;
  const underlay = isMythic ? inputFoilMythicUnderlay.value : inputFoilUnderlay.value;

  cardElement.style.setProperty('--foil-bg-strength', String(bg / 100));
  cardElement.style.setProperty('--foil-underlay-strength', String(underlay / 100));
  foilBgValue.textContent = inputFoilBg.value + '%';
  foilUnderlayValue.textContent = inputFoilUnderlay.value + '%';
  foilMythicBgValue.textContent = inputFoilMythicBg.value + '%';
  foilMythicUnderlayValue.textContent = inputFoilMythicUnderlay.value + '%';
}

function updateCard() {
  applyFoilStrength();
  cardTitle.textContent = inputTitle.value || 'Nom de la carte';
  cardSeries.textContent = inputSeries.value || '';
  cardRarity.textContent = inputRarity.value;
  cardText.textContent = inputText.value || '';
  applyCardBackground(inputImage.value);
  cardUnderlay.style.backgroundImage = inputUnderlay.value ? `url('${inputUnderlay.value}')` : 'none';

  // Gestion de la police
  const selectedFontOption = inputFont.options[inputFont.selectedIndex];
  cardElement.style.setProperty('--card-font', inputFont.value);

  // Gestion des classes (Rareté + Ajustements Typo)
  const selectedRarityOption = inputRarity.options[inputRarity.selectedIndex];
  const rarityClass = selectedRarityOption.getAttribute('data-class');
  const fontClass = selectedFontOption.getAttribute('data-class');

  cardElement.className = `card-preview ${rarityClass} ${fontClass}`.replace(/\s+/g, ' ').trim();
  applyLayoutClass(previewLayout());
}

inputTitle.addEventListener('input', updateCard);
inputSeries.addEventListener('input', updateCard);
inputFont.addEventListener('change', updateCard);
inputRarity.addEventListener('change', updateCard);
inputImage.addEventListener('input', updateCard);
inputUnderlay.addEventListener('input', updateCard);
inputText.addEventListener('input', updateCard);
inputLayout.addEventListener('change', updateCard);
inputFoilBg.addEventListener('input', updateCard);
inputFoilUnderlay.addEventListener('input', updateCard);
inputFoilMythicBg.addEventListener('input', updateCard);
inputFoilMythicUnderlay.addEventListener('input', updateCard);

updateCard();

function getPixelArtDataUrl(url) {
  if (!url) return Promise.resolve('');
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const nw = img.naturalWidth;
      const nh = img.naturalHeight;
      const maxDim = Math.max(nw, nh);
      const targetSize = 1024;
      const scale = maxDim < targetSize ? Math.max(1, Math.floor(targetSize / maxDim)) : 1;

      const canvas = document.createElement('canvas');
      canvas.width = nw * scale;
      canvas.height = nh * scale;

      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.webkitImageSmoothingEnabled = false;
      ctx.mozImageSmoothingEnabled = false;
      ctx.msImageSmoothingEnabled = false;

      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      try {
        resolve(canvas.toDataURL('image/png'));
      } catch (e) {
        // Canvas "teinté" (pas de CORS côté serveur distant) : on retombe sur l'URL d'origine.
        resolve(url);
      }
    };
    img.onerror = () => resolve(url);
    img.src = url;
  });
}

/* Incorpore une image de fond (non pixelisée) en Data URL.
 * Nécessaire pour le rendu SVG <foreignObject> : comme pour l'underlay,
 * une image cross-origin chargée telle quelle « teinterait » le canvas final. */
function getBackgroundDataUrl(url) {
  if (!url) return Promise.resolve('');
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      try {
        resolve(canvas.toDataURL('image/png'));
      } catch (e) {
        resolve(url);
      }
    };
    img.onerror = () => resolve(url);
    img.src = url;
  });
}

// Moteur de rendu SVG <foreignObject> : rasterise via le vrai moteur CSS du
// navigateur (clip-path, mix-blend-mode, conic-gradient, backdrop-filter tous supportés),
// contrairement à html2canvas qui réimplémente le CSS de façon incomplète.
const svgRenderer = (typeof SvgDomRenderer !== 'undefined') ? new SvgDomRenderer() : null;

function downloadBlob(blob, filename) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

/* Rasterise la carte courante en Blob PNG.
 * Rendu principal : SVG <foreignObject> (moteur CSS du navigateur, donc identique
 * à l'aperçu). Repli : html2canvas, puis Data URL si le canvas refuse le Blob. */
async function renderCardBlob() {
  if (svgRenderer) {
    try {
      // Rendu fidèle à l'aperçu : clip-path (bordures biseautées), mix-blend-mode
      // et conic-gradient (foils) sont tous rendus correctement par le navigateur.
      const blob = await svgRenderer.renderToBlob(cardElement, { scale: 2 });
      if (blob && blob.size > 0) return blob;
    } catch (err) {
      console.warn('Rendu SVG impossible, repli sur html2canvas :', err);
    }
  }

  const canvas = await html2canvas(cardElement, { useCORS: true, scale: 2 });
  const blob = await new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b || null), 'image/png');
    } catch (e) {
      resolve(null);
    }
  });
  if (blob && blob.size > 0) return blob;

  // Dernier recours : Data URL convertie en Blob.
  return dataUrlToBlob(canvas.toDataURL('image/png'));
}

/* Convertit une Data URL en Blob (utilisé en dernier recours). */
function dataUrlToBlob(dataUrl) {
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

document.getElementById('download-btn').addEventListener('click', async () => {
  const downloadBtn = document.getElementById('download-btn');
  const originalUnderlay = inputUnderlay.value;
  const originalBackground = inputImage.value;
  const baseName = inputTitle.value || 'carte';

  // Une seule carte : le fichier produit porte la mise en page choisie.
  const layout = previewLayout();

  downloadBtn.disabled = true;
  const originalLabel = downloadBtn.textContent;
  downloadBtn.textContent = 'Génération...';

  try {
    // Incorpore fond + underlay en Data URLs avant le rendu (évite le canvas "teinté").
    // Le fond incorporé est aussi réinjecté dans --card-background-image pour que le
    // bloc de description de la mise en page classique soit cohérent avec l'export.
    if (originalUnderlay) {
      const crispDataUrl = await getPixelArtDataUrl(originalUnderlay);
      cardUnderlay.style.backgroundImage = `url('${crispDataUrl}')`;
    }
    if (originalBackground) {
      const bgDataUrl = await getBackgroundDataUrl(originalBackground);
      applyCardBackground(bgDataUrl);
    }

    applyLayoutClass(layout);
    const blob = await renderCardBlob();
    downloadBlob(blob, `${baseName}_${layout}.png`);
  } catch (e) {
    console.error('Erreur lors du téléchargement de la carte :', e);
    alert('Erreur lors de la génération de la carte : ' + (e.message || e));
  } finally {
    // Restaure l'état d'aperçu initial (URLs d'origine, pas les Data URLs incorporées).
    applyCardBackground(originalBackground);
    if (originalUnderlay) cardUnderlay.style.backgroundImage = `url('${originalUnderlay}')`;
    downloadBtn.disabled = false;
    downloadBtn.textContent = originalLabel;
  }
});


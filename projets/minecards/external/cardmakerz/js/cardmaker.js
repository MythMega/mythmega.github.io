const inputTitle = document.getElementById('input-title');
const inputSeries = document.getElementById('input-series');
const inputFont = document.getElementById('input-font');
const inputRarity = document.getElementById('input-rarity');
const inputImage = document.getElementById('input-image');
const inputUnderlay = document.getElementById('input-underlay');
const inputText = document.getElementById('input-text');
const inputTranslationLang = document.getElementById('input-translation-lang');
const inputTitleTranslated = document.getElementById('input-title-translated');
const inputTextTranslated = document.getElementById('input-text-translated');
const labelTitleTranslated = document.getElementById('label-title-translated');
const labelTextTranslated = document.getElementById('label-text-translated');
const translationHint = document.getElementById('translation-hint');
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

/* Langues acceptées par les champs traduits. La langue principale est toujours
 * l'autre : les deux rendus couvrent donc exactement FR et EN. */
const TRANSLATION_LANGS = ['FR', 'EN'];
const LANGUAGE_NAMES = Object.freeze({ FR: 'français', EN: 'anglais' });

function otherLanguage(lang) {
  return lang === 'FR' ? 'EN' : 'FR';
}

/* Lit les champs traduits et déduit la langue des champs principaux.
 * `hasTranslation` n'est vrai que lorsque le nom ET la description traduits sont remplis,
 * ce qui conserve exactement l'export d'une seule carte dès qu'un des deux manque. */
function getTranslationState() {
  const translatedLang = TRANSLATION_LANGS.includes(inputTranslationLang.value)
    ? inputTranslationLang.value
    : 'EN';
  const baseLang = otherLanguage(translatedLang);
  const translatedName = inputTitleTranslated.value.trim();
  const translatedDescription = inputTextTranslated.value.trim();
  return {
    baseLang,
    translatedLang,
    translatedName,
    translatedDescription,
    hasTranslation: translatedName !== '' && translatedDescription !== '',
  };
}

/* Met les libellés et l'aide en accord avec la langue choisie. */
function updateTranslationLabels() {
  const state = getTranslationState();
  const translatedName = LANGUAGE_NAMES[state.translatedLang];
  const baseName = LANGUAGE_NAMES[state.baseLang];
  labelTitleTranslated.textContent = `Nom en ${translatedName} (optionnel)`;
  labelTextTranslated.textContent = `Description en ${translatedName} (optionnelle)`;
  translationHint.textContent =
    `Les champs principaux sont considérés comme étant en ${baseName}. ` +
    'Renseignez le nom et la description traduits pour télécharger deux cartes.';
}

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
  // Les raretés Mythique et Unique (foil pleine surface, très coloré) ont leurs propres curseurs.
  const rarityOption = inputRarity.options[inputRarity.selectedIndex];
  const rarityClass = rarityOption.getAttribute('data-class');
  const isMythic = rarityClass === 'rarity-mythic' || rarityClass === 'rarity-unique';
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
inputTranslationLang.addEventListener('change', updateTranslationLabels);
inputLayout.addEventListener('change', updateCard);
inputFoilBg.addEventListener('input', updateCard);
inputFoilUnderlay.addEventListener('input', updateCard);
inputFoilMythicBg.addEventListener('input', updateCard);
inputFoilMythicUnderlay.addEventListener('input', updateCard);

updateTranslationLabels();
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

/* Incorpore une image de fond en Data URL, sans interpolation.
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
      ctx.imageSmoothingEnabled = false;
      ctx.webkitImageSmoothingEnabled = false;
      ctx.mozImageSmoothingEnabled = false;
      ctx.msImageSmoothingEnabled = false;
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
  const translation = getTranslationState();
  const baseDisplayName = inputTitle.value || 'Nom de la carte';
  const baseDescription = inputText.value;
  // Sans les deux champs traduits : une seule carte, comme avant. Avec les deux : la
  // version traduite puis la version principale dans l'autre langue. Chaque fichier
  // porte le code de sa langue pour ne jamais écraser l'autre rendu.
  const renders = translation.hasTranslation
    ? [
        {
          lang: translation.translatedLang,
          name: translation.translatedName || baseDisplayName,
          description: translation.translatedDescription || baseDescription,
        },
        {
          lang: translation.baseLang,
          name: baseDisplayName,
          description: baseDescription,
        },
      ]
    : [{ lang: null, name: baseDisplayName, description: baseDescription }];

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

    for (const render of renders) {
      cardTitle.textContent = render.name;
      cardText.textContent = render.description;
      const blob = await renderCardBlob();
      const languageSuffix = render.lang ? `_${render.lang.toLowerCase()}` : '';
      downloadBlob(blob, `${baseName}_${layout}${languageSuffix}.png`);
    }
  } catch (e) {
    console.error('Erreur lors du téléchargement de la carte :', e);
    alert('Erreur lors de la génération de la carte : ' + (e.message || e));
  } finally {
    // Restaure l'aperçu complet (textes, URLs d'origine, pas les Data URLs incorporées).
    updateCard();
    downloadBtn.disabled = false;
    downloadBtn.textContent = originalLabel;
  }
});

/* --------------------------------------------------------------------------
 * JSON du booster
 *
 * Le bloc copié est celui qu'on colle dans la liste « Cards » du fichier d'un
 * booster (`data/boosters/<Serie>.json`) : mêmes champs, même ordre et même
 * échelle de rareté que les cartes du jeu. Sans les deux champs traduits, le nom
 * et la description principaux alimentent FR et EN ; avec les deux, chaque langue
 * reçoit ses champs.
 * « Path » reste explicitement null, il n'est rempli qu'une fois l'image webp publiée.
 * ------------------------------------------------------------------------ */

/* Échelle du champ « Rarity » des fichiers JSON : 1 = Commune … 6 = Unique
 * (les options du sélecteur suivent le même ordre, cf. RarityDef du Bulk Generator). */
const RARITY_JSON_VALUES = [1, 2, 3, 4, 5, 6];

/* Champs localisés du JSON : la langue principale est celle qui reste après
 * avoir choisi la langue de la traduction. Le double rendu (et donc les champs
 * séparés) n'existe que lorsque le nom et la description traduits sont remplis. */
function localizedCardFields(title, description) {
  const translation = getTranslationState();
  if (!translation.hasTranslation) {
    return {
      FR: { name: title, description },
      EN: { name: title, description },
    };
  }

  return {
    [translation.baseLang]: { name: title, description },
    [translation.translatedLang]: {
      name: translation.translatedName || title,
      description: translation.translatedDescription || description,
    },
  };
}

/* Chemin de l'image publiée repris d'un import. Il reste celui de l'entrée tant que
 * l'utilisateur ne touche à aucun champ, puis repasse à null : une carte modifiée ne
 * doit pas conserver le chemin d'une ancienne image. */
let preservedPath = null;

/* Objet JSON de la carte affichée, prêt à coller dans le fichier du booster. */
function buildCardJson() {
  const title = inputTitle.value.trim();
  const description = inputText.value.trim();
  const localized = localizedCardFields(title, description);
  const style = inputFont.options[inputFont.selectedIndex].textContent.trim();
  const rarity = RARITY_JSON_VALUES[inputRarity.selectedIndex] || RARITY_JSON_VALUES[0];

  return {
    Index: inputSeries.value.trim(),
    Name_FR: localized.FR.name,
    Name_EN: localized.EN.name,
    Desc_FR: localized.FR.description,
    Desc_EN: localized.EN.description,
    Rarity: rarity,
    Style: style,
    Background: inputImage.value.trim(),
    Underlay: inputUnderlay.value.trim(),
    Layout: previewLayout(),
    Path: preservedPath,
  };
}

/* Copie un texte dans le presse-papiers.
 * `navigator.clipboard` n'existe qu'en contexte sécurisé (https ou localhost) et
 * peut être refusé : on retombe alors sur la sélection d'un champ temporaire,
 * seule méthode acceptée partout, y compris pour une page ouverte en file://. */
async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      // Refus du navigateur : on passe au repli.
    }
  }

  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.top = '-1000px';
  document.body.appendChild(field);
  field.select();

  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch (e) {
    copied = false;
  }
  document.body.removeChild(field);
  return copied;
}

const copyJsonBtn = document.getElementById('copy-json-btn');
const copyJsonStatus = document.getElementById('copy-json-status');
const jsonOutput = document.getElementById('json-output');

copyJsonBtn.addEventListener('click', async () => {
  // 4 espaces : même indentation que les cartes déjà présentes dans les fichiers.
  const json = JSON.stringify(buildCardJson(), null, 4);
  const hasTranslation = getTranslationState().hasTranslation;
  const copied = await copyText(json);

  copyJsonStatus.textContent = copied
    ? (hasTranslation
        ? 'JSON copié avec les champs FR et EN issus des deux langues : collez-le dans la liste « Cards ».'
        : 'JSON copié : collez-le dans la liste « Cards » du fichier du booster.')
    : 'Copie refusée par le navigateur : le JSON est affiché ci-dessous, à sélectionner à la main.';
  copyJsonStatus.dataset.state = copied ? 'ok' : 'error';
  copyJsonStatus.hidden = false;

  // Repli visible : la copie a échoué, le texte reste accessible et sélectionné.
  if (!copied) {
    jsonOutput.value = json;
    jsonOutput.hidden = false;
    jsonOutput.select();
  } else {
    jsonOutput.hidden = true;
  }
});

/* --------------------------------------------------------------------------
 * Import
 *
 * Deux chemins :
 *   - « Existing » lit un fichier du projet MineCards (`data/boosters` ou
 *     `data/promo_cards`) et cherche dans ses cartes ;
 *   - « Code » accepte directement une entrée JSON.
 *
 * Les deux produisent le même objet normalisé, puis `applyImportedCard()` remplit
 * tous les champs du générateur. Les liens locaux sont essayés d'abord ; le raw
 * GitHub sert de repli quand `cards.html` est ouvert depuis le dossier autonome
 * de cardmakerz, où les données du jeu ne sont pas servies.
 * ------------------------------------------------------------------------ */

const IMPORT_SOURCE_BASES = [
  '../../data',
  './data',
  'https://raw.githubusercontent.com/MythMega/mythmega.github.io/refs/heads/master/projets/minecards/data',
];

const IMPORT_RARITY_LABELS = ['Commune', 'Rare', 'Super Rare', 'Légendaire', 'Mythique', 'Unique'];
const IMPORT_FONT_HINTS = [
  { index: 1, terms: ['press start', 'pixel', '8bit', '8-bit'] },
  { index: 2, terms: ['cinzel', 'fantasy', 'medieval'] },
  { index: 3, terms: ['orbitron', 'futur'] },
  { index: 4, terms: ['bebas', 'arcade', 'comics'] },
  { index: 0, terms: ['montserrat', 'moderne'] },
];

const importBtn = document.getElementById('import-btn');
const importMenu = document.getElementById('import-menu');
const importControl = importBtn ? importBtn.closest('.import-control') : null;
const existingImportDialog = document.getElementById('import-existing-dialog');
const codeImportDialog = document.getElementById('import-code-dialog');
const importSourceSelect = document.getElementById('import-source');
const importSearchInput = document.getElementById('import-search');
const importResults = document.getElementById('import-results');
const importExistingStatus = document.getElementById('import-existing-status');
const importExistingCount = document.getElementById('import-existing-count');
const importExistingSubmit = document.getElementById('import-existing-submit');
const importCodeInput = document.getElementById('import-code-input');
const importCodeError = document.getElementById('import-code-error');
const importCodeSubmit = document.getElementById('import-code-submit');
const importFormContainer = document.querySelector('.form-container');

const importState = {
  cards: [],
  selected: null,
  loading: false,
  sourcePath: '',
  requestId: 0,
};
const sourceCache = new Map();

/** Retire les accents et la casse pour une recherche tolérante. */
function normalizeImportSearch(value) {
  return String(value === undefined || value === null ? '' : value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** Lit la première clé reconnue d'une entrée JSON. */
function readImportField(data, keys) {
  if (!data || typeof data !== 'object') return undefined;
  for (const key of keys) {
    if (data[key] !== undefined && data[key] !== null) return data[key];
  }
  return undefined;
}

function importText(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

/** Convertit une rareté JSON (1..6, symbole ou libellé) en index 0..5. */
function importRarityIndex(value) {
  if (value === undefined || value === null || value === '') return 0;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.min(5, Math.round(value) - 1));
  }

  const text = normalizeImportSearch(value);
  if (/^\d+$/.test(text)) return Math.max(0, Math.min(5, parseInt(text, 10) - 1));
  if (text.includes('unique') || text.includes('🔶')) return 5;
  if (text.includes('myth') || text.includes('💎')) return 4;
  if (text.includes('legend') || text.includes('✦')) return 3;
  if (text.includes('super') || text.includes('★★★')) return 2;
  if (text.includes('rare') || text.includes('★★')) return 1;
  return 0;
}

function importLayout(value) {
  if (typeof value === 'boolean') return value ? 'fullart' : 'classic';
  const text = normalizeImportSearch(value);
  return ['classic', 'classique', 'classical', 'false', '0', 'no'].includes(text)
    ? 'classic'
    : 'fullart';
}

/** Normalise une carte source. Les champs absents restent vides. */
function normalizeImportedCard(raw, sourcePath, position) {
  const safe = raw && typeof raw === 'object' ? raw : {};
  const index = importText(readImportField(safe, ['Index', 'index', 'ID', 'id']));
  const nameFR = importText(readImportField(safe, [
    'Name_FR', 'name_fr', 'NameFR', 'nameFr', 'Name', 'name', 'Title', 'title',
  ]));
  const nameEN = importText(readImportField(safe, [
    'Name_EN', 'name_en', 'NameEN', 'nameEn', 'Name_Translated', 'name_translated', 'Title_EN',
  ]));
  const descFR = importText(readImportField(safe, [
    'Desc_FR', 'desc_fr', 'DescFr', 'Description_FR', 'description_fr', 'Description', 'description', 'Desc', 'desc',
  ]));
  const descEN = importText(readImportField(safe, [
    'Desc_EN', 'desc_en', 'DescEn', 'Description_EN', 'description_en', 'Description_Translated', 'description_translated',
  ]));
  const rarityValue = importRarityIndex(readImportField(safe, ['Rarity', 'rarity']));
  const style = importText(readImportField(safe, ['Style', 'style', 'Font', 'font']));
  const background = importText(readImportField(safe, ['Background', 'background', 'Image', 'image', 'Image_URL']));
  const underlay = importText(readImportField(safe, ['Underlay', 'underlay', 'Foreground', 'foreground']));
  const layout = importLayout(readImportField(safe, ['Layout', 'layout', 'CardLayout', 'cardLayout']));
  const path = importText(readImportField(safe, ['Path', 'path']));

  return {
    key: `${sourcePath}:${position}:${index}:${nameFR}:${nameEN}`,
    index,
    nameFR: nameFR || nameEN,
    nameEN,
    descFR: descFR || descEN,
    descEN,
    rarityValue,
    style,
    background,
    underlay,
    layout,
    path,
    searchText: normalizeImportSearch([index, nameFR, nameEN].join(' ')),
  };
}

/** Récupère la liste de cartes d'un fichier source (Cards ou Card). */
function extractSourceCards(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.Cards)) return payload.Cards;
  if (payload && Array.isArray(payload.Card)) return payload.Card;
  return [];
}

/** Récupère une ou plusieurs cartes depuis le JSON collé en mode Code. */
function extractCodeCards(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.Cards)) return payload.Cards;
  if (payload && Array.isArray(payload.Card)) return payload.Card;
  if (payload && typeof payload === 'object') return [payload];
  return [];
}

/** Télécharge et normalise un fichier source, avec repli distant. */
async function fetchImportSource(sourcePath) {
  if (sourceCache.has(sourcePath)) return sourceCache.get(sourcePath);

  const failures = [];
  for (const base of IMPORT_SOURCE_BASES) {
    const url = `${base.replace(/\/$/, '')}/${sourcePath}`;
    try {
      const response = await fetch(url, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const rawCards = extractSourceCards(payload);
      if (rawCards.length === 0) throw new Error('aucune carte dans le fichier');

      const result = {
        cards: rawCards.map((card, index) => normalizeImportedCard(card, sourcePath, index)),
        remote: /^https?:/i.test(base),
        url,
      };
      sourceCache.set(sourcePath, result);
      return result;
    } catch (error) {
      failures.push(`${url} (${error.message || error})`);
    }
  }

  throw new Error(`Impossible de lire ${sourcePath}. ${failures.join(' · ')}`);
}

function setImportStatus(message, state = '') {
  importExistingStatus.textContent = message || '';
  if (state) {
    importExistingStatus.dataset.state = state;
  } else {
    delete importExistingStatus.dataset.state;
  }
}

function updateImportSubmit() {
  importExistingSubmit.disabled = importState.loading || !importState.selected;
}

/** Affiche les cartes filtrées par nom FR, nom EN ou index. */
function renderImportResults() {
  if (!importResults) return;
  importResults.replaceChildren();

  if (importState.loading) {
    importExistingCount.textContent = '';
    return;
  }

  const term = normalizeImportSearch(importSearchInput.value);
  const filtered = term
    ? importState.cards.filter((card) => card.searchText.includes(term))
    : importState.cards;

  if (importState.selected && !filtered.includes(importState.selected)) {
    importState.selected = null;
  }
  updateImportSubmit();
  importExistingCount.textContent = `${filtered.length} / ${importState.cards.length} carte(s)`;

  if (filtered.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'import-empty';
    empty.textContent = importState.cards.length === 0
      ? 'Aucune carte chargée.'
      : 'Aucune carte ne correspond à cette recherche.';
    importResults.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  filtered.forEach((card) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'import-result';
    button.dataset.cardKey = card.key;
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', importState.selected === card ? 'true' : 'false');

    const index = document.createElement('span');
    index.className = 'import-result__index';
    index.textContent = card.index || 'Sans index';

    const name = document.createElement('span');
    name.className = 'import-result__name';
    name.textContent = card.nameFR || 'Carte sans nom';

    const nameEN = document.createElement('span');
    nameEN.className = 'import-result__en';
    nameEN.textContent = card.nameEN && card.nameEN !== card.nameFR ? card.nameEN : '';

    const rarity = document.createElement('span');
    rarity.className = 'import-result__rarity';
    rarity.textContent = IMPORT_RARITY_LABELS[card.rarityValue] || 'Commune';

    button.append(index, name, nameEN, rarity);
    fragment.appendChild(button);
  });
  importResults.appendChild(fragment);
}

/** Charge le fichier sélectionné, en ignorant les réponses d'un ancien choix. */
async function loadImportSource(sourcePath) {
  const requestId = ++importState.requestId;
  importState.sourcePath = sourcePath;
  importState.loading = true;
  importState.cards = [];
  importState.selected = null;
  updateImportSubmit();
  setImportStatus('Chargement…');
  renderImportResults();

  try {
    const result = await fetchImportSource(sourcePath);
    if (requestId !== importState.requestId) return;
    importState.cards = result.cards;
    setImportStatus(
      result.remote ? 'Fichier local inaccessible : version GitHub utilisée.' : '',
      result.remote ? 'info' : ''
    );
  } catch (error) {
    if (requestId !== importState.requestId) return;
    console.error('[Import]', error);
    setImportStatus(error.message || 'Le fichier source est illisible.', 'error');
  } finally {
    if (requestId === importState.requestId) {
      importState.loading = false;
      renderImportResults();
    }
  }
}

/** Choisit une police connue à partir du champ Style/Font. */
function applyImportedFont(style) {
  const text = normalizeImportSearch(style);
  const match = IMPORT_FONT_HINTS.find((entry) => entry.terms.some((term) => text.includes(term)));
  inputFont.selectedIndex = match ? match.index : 0;
}

/** Remplit tous les champs de cards.html depuis une carte normalisée. */
function applyImportedCard(card) {
  preservedPath = card.path || null;

  inputSeries.value = card.index;
  inputTitle.value = card.nameFR;
  inputText.value = card.descFR;
  inputTitleTranslated.value = card.nameEN;
  inputTextTranslated.value = card.descEN;
  inputTranslationLang.value = 'EN';
  inputImage.value = card.background;
  inputUnderlay.value = card.underlay;
  inputRarity.selectedIndex = card.rarityValue;
  inputLayout.value = card.layout;
  applyImportedFont(card.style);

  updateTranslationLabels();
  updateCard();

  const label = card.nameFR || card.index || 'carte sans nom';
  copyJsonStatus.textContent = `Carte importée : ${label}.`;
  copyJsonStatus.dataset.state = 'ok';
  copyJsonStatus.hidden = false;
  jsonOutput.hidden = true;
}

function openExistingImport() {
  if (!existingImportDialog) return;
  existingImportDialog.showModal();
  if (!importState.sourcePath || (!importState.loading && importState.cards.length === 0)) {
    void loadImportSource(importSourceSelect.value);
  }
  importSearchInput.focus();
}

function openCodeImport() {
  if (!codeImportDialog) return;
  importCodeError.hidden = true;
  importCodeError.textContent = '';
  codeImportDialog.showModal();
  importCodeInput.focus();
}

function setImportMenuOpen(open) {
  importMenu.hidden = !open;
  importBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function handleCodeImport() {
  importCodeError.hidden = true;
  importCodeError.textContent = '';

  let parsed;
  try {
    parsed = JSON.parse(importCodeInput.value);
  } catch (error) {
    importCodeError.textContent = `JSON invalide : ${error.message || error}`;
    importCodeError.hidden = false;
    return;
  }

  const cards = extractCodeCards(parsed);
  if (cards.length === 0) {
    importCodeError.textContent = 'Aucune entrée de carte trouvée dans ce JSON.';
    importCodeError.hidden = false;
    return;
  }
  if (cards.length > 1) {
    importCodeError.textContent =
      `Ce JSON contient ${cards.length} cartes. Collez une seule entrée, ou utilisez Existing pour importer un fichier complet.`;
    importCodeError.hidden = false;
    return;
  }

  const card = normalizeImportedCard(cards[0], 'code', 0);
  if (!card.index && !card.nameFR && !card.nameEN && !card.descFR && !card.descEN) {
    importCodeError.textContent = 'Cette entrée ne contient aucun champ de carte reconnu.';
    importCodeError.hidden = false;
    return;
  }

  applyImportedCard(card);
  codeImportDialog.close();
}

if (importBtn && importMenu) {
  importBtn.addEventListener('click', () => {
    setImportMenuOpen(importMenu.hidden);
  });

  importMenu.addEventListener('click', (event) => {
    const action = event.target.closest('[data-import-mode]');
    if (!action) return;
    setImportMenuOpen(false);
    if (action.dataset.importMode === 'existing') openExistingImport();
    if (action.dataset.importMode === 'code') openCodeImport();
  });

  document.addEventListener('click', (event) => {
    if (!importControl || !importControl.contains(event.target)) setImportMenuOpen(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !importMenu.hidden) setImportMenuOpen(false);
  });
}

document.querySelectorAll('[data-import-close]').forEach((button) => {
  button.addEventListener('click', () => {
    const dialog = button.dataset.importClose === 'code' ? codeImportDialog : existingImportDialog;
    dialog.close();
  });
});

[existingImportDialog, codeImportDialog].forEach((dialog) => {
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
});

if (importSourceSelect) {
  importSourceSelect.addEventListener('change', () => {
    importSearchInput.value = '';
    void loadImportSource(importSourceSelect.value);
  });
}

if (importSearchInput) {
  importSearchInput.addEventListener('input', renderImportResults);
}

if (importResults) {
  importResults.addEventListener('click', (event) => {
    const result = event.target.closest('.import-result');
    if (!result) return;
    const card = importState.cards.find((entry) => entry.key === result.dataset.cardKey);
    if (!card) return;
    importState.selected = card;
    importResults.querySelectorAll('.import-result').forEach((button) => {
      button.setAttribute('aria-selected', button === result ? 'true' : 'false');
    });
    updateImportSubmit();
  });
}

if (importExistingSubmit) {
  importExistingSubmit.addEventListener('click', () => {
    if (!importState.selected) return;
    applyImportedCard(importState.selected);
    existingImportDialog.close();
  });
}

if (importCodeSubmit) {
  importCodeSubmit.addEventListener('click', handleCodeImport);
}

/* Une modification manuelle invalide le Path importé : la carte n'est plus
 * exactement celle du fichier source. Les changements programmatiques de
 * l'import ne déclenchent pas d'événement, ils conservent donc le Path. */
if (importFormContainer) {
  ['input', 'change'].forEach((eventName) => {
    importFormContainer.addEventListener(eventName, () => {
      preservedPath = null;
    });
  });
}


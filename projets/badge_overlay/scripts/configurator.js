// scripts/configurator.js
// Handles the configurator form, validation, create overlay and copy link

(function(){
  const exampleUrl = 'https://docs.google.com/spreadsheets/d/1XcQeCdcWTIU0fo4MDXLVIa8GdrPIS_JLpAAlSTbpOJA/edit?usp=sharing';
  const exampleId = '1XcQeCdcWTIU0fo4MDXLVIa8GdrPIS_JLpAAlSTbpOJA';

  const sheetInput = document.getElementById('sheetUrl');
  const styleSelect = document.getElementById('styleSelect');
  const displayGoal = document.getElementById('displayGoalNotReach');
  const displayName = document.getElementById('displayName');
  const gapInput = document.getElementById('gap');
  const exampleBtn = document.getElementById('exampleSheet');
  const createBtn = document.getElementById('createOverlay');
  const copyBtn = document.getElementById('copyOverlayLink');
  const previewIframe = document.getElementById('previewIframe');

  // Leave sheet input empty by default (do not prefill)
  if(sheetInput) sheetInput.value = '';

  // small error message element under the sheet input
  let errorEl = document.createElement('div');
  errorEl.style.color = '#ffb4b4';
  errorEl.style.marginTop = '8px';
  errorEl.style.fontSize = '0.9rem';
  errorEl.style.display = 'none';
  sheetInput && sheetInput.parentNode && sheetInput.parentNode.insertBefore(errorEl, sheetInput.nextSibling);

  exampleBtn.addEventListener('click', () => {
    // open example sheet in new tab
    window.open(exampleUrl, '_blank');
  });

  function extractSheetId(url){
    if(!url) return '';
    try{
      const m = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
      if(m && m[1]) return m[1];
      // maybe user pasted only the id
      const trimmed = url.trim();
      if(/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) return trimmed;
      return '';
    }catch(e){ return ''; }
  }

  function buildOverlayUrl(){
    const sheet = extractSheetId(sheetInput.value || '');
    const style = styleSelect.value || 'column';
    const goal = displayGoal.value || 'shadow';
    const name = displayName.value === 'y' ? 'y' : 'n';
    const gap = parseInt(gapInput.value || '10',10) || 10;
    const params = new URLSearchParams({
      Sheet: sheet,
      NoGoal: goal,
      Name: name,
      Gap: String(gap),
      style: style
    });
    return `badge_overlay.html?${params.toString()}`;
  }

  function validate(){
    errorEl.style.display = 'none';
    errorEl.textContent = '';
    const raw = sheetInput.value && sheetInput.value.trim();
    if(!raw){
      errorEl.textContent = 'Veuillez renseigner l\'URL du Google Spreadsheet.'; // will be translated by translation.js on load
      errorEl.style.display = 'block';
      return false;
    }
    const id = extractSheetId(raw);
    if(!id){
      errorEl.textContent = 'URL ou ID de spreadsheet invalide.';
      errorEl.style.display = 'block';
      return false;
    }
    if(id === exampleId){
      errorEl.textContent = 'Veuillez copier le spreadsheet exemple et utiliser votre propre copie (ne pas utiliser l\'ID d\'exemple).';
      errorEl.style.display = 'block';
      return false;
    }
    return true;
  }

  createBtn.addEventListener('click', () => {
    if(!validate()) return;
    const url = buildOverlayUrl();
    window.open(url, '_blank');
  });

  copyBtn.addEventListener('click', async () => {
    if(!validate()) return;
    const url = buildOverlayUrl();
    try{
      await navigator.clipboard.writeText(location.origin + '/' + url);
      // feedback
      const prevText = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      setTimeout(()=> copyBtn.textContent = prevText, 1500);
    }catch(e){
      // fallback: select and prompt
      const tmp = document.createElement('textarea');
      tmp.value = location.origin + '/' + url;
      document.body.appendChild(tmp);
      tmp.select();
      try { document.execCommand('copy'); copyBtn.textContent = 'Copied!'; setTimeout(()=> copyBtn.textContent = 'Copy Overlay link', 1500); } catch(err){ alert('Copy failed, here is the link:\\n' + location.origin + '/' + url); }
      tmp.remove();
    }
  });

  // Live preview: update iframe src when inputs change (debounced)
  const inputs = [sheetInput, styleSelect, displayGoal, displayName, gapInput];
  let previewTimer = null;
  function updatePreview(){
    clearTimeout(previewTimer);
    previewTimer = setTimeout(()=>{
      if(!sheetInput.value || !extractSheetId(sheetInput.value)) {
        // if invalid or empty, show blank preview (avoid loading example id)
        previewIframe.src = 'about:blank';
        return;
      }
      const url = buildOverlayUrl();
      // set full absolute url so copy uses same origin
      previewIframe.src = url;
    }, 250);
  }
  inputs.forEach(i => i.addEventListener('input', updatePreview));
  updatePreview();

  // Translate error messages if translation available
  // We attempt to replace the default French messages with translations loaded by Translation.t
  (function localizeErrors(){
    if(typeof Translation === 'undefined') return;
    const userLang = navigator.language && navigator.language.startsWith('fr') ? 'fr' : 'en';
    Translation.init(userLang).then(()=>{
      // replace static messages with translated ones if present
      // keys we expect in lang files (add them if needed)
      // fallback to existing text if not present
      const tRequired = {
        empty: Translation.t('config.errorEmpty') || 'Veuillez renseigner l\'URL du Google Spreadsheet.',
        invalid: Translation.t('config.errorInvalid') || 'URL ou ID de spreadsheet invalide.',
        example: Translation.t('config.errorExampleId') || 'Veuillez copier le spreadsheet exemple et utiliser votre propre copie (ne pas utiliser l\'ID d\'exemple).'
      };
      // override validate to use these translations
      const originalValidate = validate;
      validate = function(){
        errorEl.style.display = 'none';
        errorEl.textContent = '';
        const raw = sheetInput.value && sheetInput.value.trim();
        if(!raw){
          errorEl.textContent = tRequired.empty;
          errorEl.style.display = 'block';
          return false;
        }
        const id = extractSheetId(raw);
        if(!id){
          errorEl.textContent = tRequired.invalid;
          errorEl.style.display = 'block';
          return false;
        }
        if(id === exampleId){
          errorEl.textContent = tRequired.example;
          errorEl.style.display = 'block';
          return false;
        }
        return true;
      };
    }).catch(()=>{ /* ignore */ });
  })();

})();

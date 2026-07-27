/* ---------- Preview & Copy helpers ---------- */

(function(){
  const sheetInput = document.getElementById('sheetUrl');
  const countInput = document.getElementById('count');
  const orientationInput = document.getElementById('orientation');
  const eggToggle = document.getElementById('eggToggle');
  const pokebgToggle = document.getElementById('pokebgToggle');
  const profilepicToggle = document.getElementById('profilepicToggle');
  const deadDisplayInput = document.getElementById('deadDisplay');
  const refreshTimeInput = document.getElementById('refreshTime');
  const previewIframe = document.getElementById('previewIframe');
  const copyBtn = document.getElementById('copyUrlBtn');

  function encodeParam(s){
    return encodeURIComponent(s);
  }

  function buildOverlayUrl(){
    const sheet = sheetInput.value.trim();
    if(!sheet) return null;
    const count = Math.max(1, Math.min(5, parseInt(countInput.value,10) || 1));
    const orientation = orientationInput.value === 'v' ? 'v' : 'h';
    const egg = eggToggle.checked ? 'true' : 'false';
    const pokebackground = pokebgToggle.checked ? 'true' : 'false';
    const profilepic = profilepicToggle.checked ? 'true' : 'false';
    const deaddisplay = deadDisplayInput.value || 'shadesofgray';
    const refresh = Math.max(2, parseInt(refreshTimeInput.value, 10) || 15);
    return `./overlay.html?sheet=${encodeParam(sheet)}&layout_count=${count}&orientation=${orientation}&egg=${egg}&pokebackground=${pokebackground}&profilepic=${profilepic}&deaddisplay=${deaddisplay}&refresh=${refresh}`;
  }

  function updatePreview(){
    const url = buildOverlayUrl();
    if(url && previewIframe){
      previewIframe.src = url;
    }
  }

  // Copy overlay URL to clipboard
  if(copyBtn){
    copyBtn.addEventListener('click', async ()=>{
      const url = buildOverlayUrl();
      if(!url){
        copyBtn.textContent = 'No URL to copy';
        setTimeout(() => { copyBtn.textContent = 'Copy Overlay URL'; }, 2000);
        return;
      }
      try{
        await navigator.clipboard.writeText(location.origin + location.pathname.replace(/index\.html$/, '') + url);
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy Overlay URL'; }, 2000);
      }catch(e){
        copyBtn.textContent = 'Copy failed';
        setTimeout(() => { copyBtn.textContent = 'Copy Overlay URL'; }, 2000);
      }
    });
  }

  // Auto-update preview on any parameter change
  const inputs = [
    sheetInput,
    countInput,
    orientationInput,
    eggToggle,
    pokebgToggle,
    profilepicToggle,
    deadDisplayInput,
    refreshTimeInput
  ].filter(Boolean);

  inputs.forEach(el => {
    if(!el) return;
    const eventType = el.type === 'checkbox' ? 'change' : 'input';
    el.addEventListener(eventType, updatePreview);
  });

  // Initial preview update after a short delay (wait for DOM + configurator to possibly set initial values)
  setTimeout(updatePreview, 100);
})();
(function(){
  const sheetInput = document.getElementById('sheetUrl');
  const countInput = document.getElementById('count');
  const orientationInput = document.getElementById('orientation');
  const eggToggle = document.getElementById('eggToggle');
  const pokebgToggle = document.getElementById('pokebgToggle');
  const profilepicToggle = document.getElementById('profilepicToggle');
  const btn = document.getElementById('generate');
  const result = document.getElementById('result');
  const patternBtn = document.getElementById('patternBtn');

  // Read params from current page URL (if present) to set initial toggle states
  function readInitialParams(){
    try{
      const params = new URLSearchParams(location.search);
      const egg = params.get('egg');
      if(egg !== null) eggToggle.checked = (egg.toLowerCase() !== 'false');
      const pokebg = params.get('pokebackground');
      if(pokebg !== null) pokebgToggle.checked = (pokebg.toLowerCase() !== 'false');
      const profilepic = params.get('profilepic');
      if(profilepic !== null) profilepicToggle.checked = (profilepic.toLowerCase() !== 'false');
    }catch(e){
      // ignore
    }
  }

  readInitialParams();

  function encodeParam(s){
    return encodeURIComponent(s);
  }

  function isGoogleSheetUrl(u){
    return /docs.google.com\/spreadsheets/.test(u);
  }

  function toCsvExportUrl(sheetUrl){
    if(/\/export\?format=csv/.test(sheetUrl)) return sheetUrl;
    const m = sheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)(?:\/.*gid=(\d+))?/);
    if(m){
      const id = m[1];
      const gid = m[2] || '0';
      return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
    }
    return sheetUrl;
  }

  function showError(msg){
    result.style.display = 'block';
    result.style.border = '1px solid rgba(255,80,80,0.18)';
    result.style.background = 'linear-gradient(180deg, rgba(255,80,80,0.03), rgba(255,80,80,0.01))';
    result.innerHTML = msg;
  }

  function showSuccess(overlayUrl){
    result.style.display = 'block';
    result.style.border = '1px solid rgba(255,255,255,0.04)';
    result.style.background = 'linear-gradient(180deg, rgba(255,255,255,0.01), rgba(255,255,255,0.005))';
    result.innerHTML = `<strong style="color:#eaf6ff">Overlay link:</strong> <a href="${overlayUrl}" target="_blank" style="color:var(--accent-2);font-weight:700;text-decoration:none">${overlayUrl}</a>`;
  }

  btn.addEventListener('click', async ()=>{
    const sheet = sheetInput.value.trim();
    if(!sheet){
      showError('Please provide the sheet or CSV URL.');
      setTimeout(()=>{ result.style.display = 'none'; result.style.border=''; result.style.background=''; }, 3500);
      return;
    }

    // Build CSV URL like overlay.html does
    let csvUrl = sheet;
    if(isGoogleSheetUrl(sheet)){
      csvUrl = toCsvExportUrl(sheet);
    }

    // Test accessibility of the CSV with a small range (first row)
    const testUrl = csvUrl + (csvUrl.includes('?') ? '&' : '?') + '_test=' + Date.now();
    try{
      const resp = await fetch(testUrl, {mode:'cors'});
      if(!resp.ok){
        showError('The sheet does not seem publicly accessible (HTTP ' + resp.status + ').<br>Make sure your Google Sheet is published: <strong>File → Share → Publish to web → Entire document as CSV. You can also click on share and in general access you select all users with link.</strong>.');
        setTimeout(()=>{ result.style.display = 'none'; result.style.border=''; result.style.background=''; }, 6000);
        return;
      }
      // Quick check: first cell (A1) should exist
      const text = await resp.text();
      if(text.trim().length === 0){
        showError('The CSV appears empty. Make sure your sheet has data in the first row.');
        setTimeout(()=>{ result.style.display = 'none'; result.style.border=''; result.style.background=''; }, 5000);
        return;
      }
    }catch(e){
      showError('Cannot access the sheet. CORS error — the sheet may not be publicly published.<br>Go to <strong>File → Share → Publish to web</strong> in your Google Sheet, then select "Entire document" as CSV and publish.');
      setTimeout(()=>{ result.style.display = 'none'; result.style.border=''; result.style.background=''; }, 7000);
      return;
    }

    // All good — generate the overlay link
    const count = Math.max(1, Math.min(5, parseInt(countInput.value,10) || 1));
    const orientation = orientationInput.value === 'v' ? 'v' : 'h';
    const egg = eggToggle.checked ? 'true' : 'false';
    const pokebackground = pokebgToggle.checked ? 'true' : 'false';
    const profilepic = profilepicToggle.checked ? 'true' : 'false';
    const overlayUrl = `./overlay.html?sheet=${encodeParam(sheet)}&layout_count=${count}&orientation=${orientation}&egg=${egg}&pokebackground=${pokebackground}&profilepic=${profilepic}`;
    showSuccess(overlayUrl);
    window.open(overlayUrl, '_blank');
  });

  patternBtn.addEventListener('click', ()=>{
    const url = 'https://docs.google.com/spreadsheets/d/1ESxMC6rcRzJtgq18IZgLo6oXZkdYzoB6LVQEgO-Zj28/edit?usp=sharing';
    window.open(url, '_blank');
  });

  // Optional: allow pressing Enter in the sheet input to generate
  sheetInput.addEventListener('keydown', (e)=>{
    if(e.key === 'Enter') btn.click();
  });
})();
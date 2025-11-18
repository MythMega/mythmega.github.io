// wheel.js
document.addEventListener('DOMContentLoaded', () => {

  const dexSelector = document.getElementById('dexSelector');
  
  const checkbox = document.getElementById('legendary');
  const launchBtn = document.getElementById('launch');
  const viewport = document.getElementById('viewport');
  const centerSlot = document.getElementById('centerSlot');
  const resultName = document.getElementById('resultName');
  const resultIndex = document.getElementById('resultIndex');
  const legendDot = document.getElementById('legendDot');
  const pokeArt = document.getElementById('pokeArt');
  const POKEBALL_URL = 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/53/Pok%C3%A9_Ball_icon.svg/1026px-Pok%C3%A9_Ball_icon.svg.png';
  const POKEDB_BASE = 'https://img.pokemondb.net/artwork/large/';
  const GENERATE_URL = 'https://www.twitch.tv/berichandev';
  const generateBtn = document.getElementById('generate');// attacher listener
  if (generateBtn) generateBtn.addEventListener('click', onGenerateClick);

  let correspondances = {};         // contenu de correspondance.json
  let currentDataCMD = null;        // entrée de correspondance correspondant à la liste en cours
  let lastSelectedPokeName = null;  // nom du pokémon actuellement sélectionné (update à la fin du spin)
  let pokes = [];
  let filtered = [];
  let currentDexFile = null;
  const VISIBLE = 5; // -2,-1,0,1,2
  const SLOT_H = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--slot-h')) || 72;

  async function loadDexOptions() {
    const selector = document.getElementById('dexSelector');

    try {
      const res = await fetch('correspondance.json', { cache: "no-store" });
      if (!res.ok) throw new Error('correspondance.json not loaded');
      const options = await res.json();
      options.forEach(opt => {
        const option = document.createElement('option');
        option.value = opt.File;
        option.textContent = opt.Name;
        selector.appendChild(option);
        correspondances[opt.File] = opt.GenerateCMD;
      });

      selector.disabled = false;
    } catch (e) {
      alert('Erreur lors du chargement de correspondance.json');
      console.error(e);
    }
  }

  async function loadData(file) {
  try {
    const res = await fetch(file, { cache: "no-store" });
    if (!res.ok) throw new Error(`${file} not loaded`);
    const data = await res.json();
    pokes = data.map(p => ({
      Index: Number(p.Index || p.Hdex || p.index),
      Name: p.Name || p.name || '',
      Legendary: Boolean(p.Legendary)
    }));
    applyFilter();
  } catch (e) {
    alert(`Erreur lors du chargement de ${file}. Vérifiez sa présence.`);
    console.error(e);
  }
}


  function applyFilter(){
    const onlyLegend = checkbox.checked;
    filtered = pokes.filter(p => onlyLegend ? p.Legendary : !p.Legendary);
    if (filtered.length === 0) {
      clearSlots();
      resultName.textContent = 'Aucun résultat';
      resultIndex.textContent = '';
      legendDot.style.background = '#999';
    } else {
      // default centerIndex = 0
      renderVisible(0);
      resultName.textContent = 'Prêt';
      resultIndex.textContent = `Nombre : ${filtered.length}`;
      legendDot.style.background = checkbox.checked ? '#ff6b6b' : '#6ee7b7';
    }
  }

  function clearSlots(){
    viewport.querySelectorAll('.slot').forEach(s => { s.innerHTML = ''; s.removeAttribute('data-index'); s.removeAttribute('data-name'); });
  }

  function modIndex(i){
    const n = filtered.length;
    return ((i % n) + n) % n;
  }

  async function onGenerateClick(){
  if (!currentDataCMD || !lastSelectedPokeName) return;
  const command = `${currentDataCMD} ${lastSelectedPokeName} Shiny: No Level: 20`;
  try {
    await navigator.clipboard.writeText(command);
  } catch (e) {
    // fallback
    const tmp = document.createElement('textarea');
    tmp.value = command;
    document.body.appendChild(tmp);
    tmp.select();
    try { document.execCommand('copy'); } catch (err) { /* ignore */ }
    document.body.removeChild(tmp);
  }
  // open twitch in new tab
  window.open(GENERATE_URL, '_blank', 'noopener');
}

  dexSelector.addEventListener('change', () => {
    const selectedFile = dexSelector.value;
    if (selectedFile) {
      currentDexFile = selectedFile;
      setArtworkToPokeball();
      loadData(currentDexFile);
      console.log(dexSelector.value);
      console.log(correspondances);
      currentDataCMD = correspondances[dexSelector.value];
      console.log(currentDataCMD);
    }
  });

  function renderVisible(centerIndex){
    if (!filtered.length) { clearSlots(); return; }
    viewport.querySelectorAll('.slot').forEach(s => {
      const pos = Number(s.dataset.pos);
      const idx = modIndex(centerIndex + pos);
      const item = filtered[idx];
      s.innerHTML = `<span class="dot" style="background:${item.Legendary ? '#ff6b6b' : '#6ee7b7'}"></span><span class="label">${item.Name}</span>`;
      s.setAttribute('data-index', item.Index);
      s.setAttribute('data-name', item.Name);
      s.setAttribute('aria-pos', pos);
    });
    const chosen = filtered[modIndex(centerIndex)];
    resultName.textContent = chosen.Name;
    resultIndex.textContent = `Index : ${chosen.Index}`;
    legendDot.style.background = chosen.Legendary ? '#ff6b6b' : '#6ee7b7';
  }

  // applyVisualShift shifts all slots by a fractional pixel amount to create smooth motion
  function applyVisualShift(shiftPx){
  viewport.querySelectorAll('.slot').forEach(s => {
    s.style.transform = `translateY(${shiftPx}px)`;
  });
}
  function setArtworkToPokeball(){
    if (pokeArt) pokeArt.src = POKEBALL_URL;
    }

    function sanitizeForPokeDB(name){
    if (!name) return '';
    let n = name.toLowerCase();
    n = n.replace(/\s+/g, '-');
    n = n.replace(/\./g, '');
    n = n.replace(/'/g, '');
    n = n.replace(/[^a-z0-9\-]/g, '');
    return n;
    }

    function setArtworkForPoke(name){
    if (!pokeArt) return;
    const fileName = sanitizeForPokeDB(name);
    if (!fileName) { pokeArt.src = POKEBALL_URL; return; }
    const url = `${POKEDB_BASE}${encodeURIComponent(fileName)}.jpg`;
    pokeArt.src = POKEBALL_URL; // montrer pokéball pendant le chargement
    const img = new Image();
    img.onload = () => { pokeArt.src = url; };
    img.onerror = () => { pokeArt.src = POKEBALL_URL; };
    img.src = url;
    }

  // spin: scrolls downward (items move up) and lands on a target
  function spinToRandom(){
    if (!filtered.length) return;
    launchBtn.disabled = true;
    checkbox.disabled = true;
    generateBtn.disabled = true;

    const target = Math.floor(Math.random() * filtered.length);
    const extraCycles = 3 + Math.floor(Math.random() * 3); // 3..5
    const currentName = resultName.textContent;
    const currentCenterIndex = filtered.findIndex(p => p.Name === currentName);
    const startIndex = currentCenterIndex >= 0 ? currentCenterIndex : 0;

    let offset = target - startIndex;
    if (offset < 0) offset += filtered.length;
    const totalSteps = extraCycles * filtered.length + offset;

    const totalDuration = 3800 + Math.floor(Math.random() * 1600);
    const startTime = performance.now();
    function easeOutCubic(t){ return 1 - Math.pow(1 - t, 3); }

    function tick(now){
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / totalDuration);
      const eased = easeOutCubic(t);
      const fracSteps = eased * totalSteps;
      const intStep = Math.floor(fracSteps);
      const sub = fracSteps - intStep; // 0..1

      // center index corresponds to startIndex + intStep
      const centerIndex = modIndex(startIndex + intStep);
      // shift: negative moves up so next items come from bottom
      const shiftPx = -sub * SLOT_H;

      renderVisible(centerIndex);
      applyVisualShift(shiftPx);

      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        // finalize
        applyVisualShift(0);
        const finalIndex = modIndex(startIndex + totalSteps);
        renderVisible(finalIndex);
        const chosen = filtered[finalIndex];
        resultName.textContent = chosen.Name;
        resultIndex.textContent = `Index : ${chosen.Index}`;
        legendDot.style.background = chosen.Legendary ? '#ff6b6b' : '#6ee7b7';
        setArtworkForPoke(chosen.Name);
        launchBtn.disabled = false;
        checkbox.disabled = false;
        console.log(currentDataCMD);
        if(currentDataCMD != undefined && currentDataCMD != null) {
          generateBtn.disabled = false;
          lastSelectedPokeName = chosen.Name;
        }
      }
    }

    requestAnimationFrame(tick);
  }

  checkbox.addEventListener('change', () => {
    setArtworkToPokeball();
    applyFilter();
  });

  launchBtn.addEventListener('click', () => {
    if (!filtered.length) {
      alert('Aucun Pokémon pour ce filtre.');
      return;
    }
    setArtworkToPokeball();
    spinToRandom();
  });

  loadDexOptions();
  setArtworkToPokeball();
});

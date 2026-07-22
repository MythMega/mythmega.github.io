// Overlay logic: fetch sheet, render badges, periodic refreshes
const Overlay = (function(){
  const ROOT = document.getElementById('overlay-root');
  let params = {};
  let baseData = { rows: [], lastFetch: 0 };
  let statusOnlyTimer = null;
  let fullRefreshTimer = null;
  let maxItems = 50;

  function parseParams(){
    const urlp = new URLSearchParams(location.search);
    params.Sheet = urlp.get('Sheet') || '';
    params.NoGoal = urlp.get('NoGoal') || 'shadow';
    params.Name = urlp.get('Name') || 'y';
    params.Gap = parseInt(urlp.get('Gap') || '10',10) || 10;
    params.style = urlp.get('style') || 'column';
  }

  function gvizUrl(sheetId){
    // request a wide range A7:E100 to be safe
    return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?range=A7:E100&tqx=out:json`;
  }

  async function fetchGviz(sheetId){
    const url = gvizUrl(sheetId);
    const res = await fetch(url, {cache:'no-store'});
    const text = await res.text();
    // extract JSON from google's wrapper
    const jsonText = text.replace(/^[^\(]*\(/,'').replace(/\);?$/,'');
    const data = JSON.parse(jsonText);
    return data;
  }

  function rowsFromGviz(data){
    const rows = [];
    if(!data || !data.table || !data.table.rows) return rows;
    for(const r of data.table.rows){
      // columns A,B,C,D,E -> c[0]..c[4]
      const a = r.c[0] && r.c[0].v !== null ? String(r.c[0].v) : '';
      const b = r.c[1] && r.c[1].v !== null ? String(r.c[1].v) : '';
      const e = r.c[4] && r.c[4].v !== null ? String(r.c[4].v) : '';
      rows.push({ status: a, name: b, icon: e });
      if(rows.length >= maxItems) break;
    }
    return rows;
  }

  function createBadge(item, index){
    const div = document.createElement('div');
    div.className = 'badge';
    const img = document.createElement('img');
    img.alt = item.name || `badge-${index}`;
    img.draggable = false;
    img.decoding = 'async';
    img.src = item.icon || '';
    // ensure pixel art rendering and no smoothing
    img.style.width = '96px';
    img.style.height = '96px';
    div.appendChild(img);

    if(params.Name === 'y'){
      const nameEl = document.createElement('div');
      nameEl.className = 'name';
      nameEl.textContent = item.name || '';
      div.appendChild(nameEl);
    }

    // default shadow class for all images (even reached)
    // determine reached or not
    const status = (item.status || '').toString().toLowerCase();
    const reached = status === 'true' || status === '1' || status === 'yes' || status === 'y';
    if(!reached){
      div.classList.add('notreached', params.NoGoal || 'shadow');
    }

    return div;
  }

  function renderBase(){
    // clear
    ROOT.innerHTML = '';
    ROOT.classList.remove('style-block','style-line','style-column');
    ROOT.classList.add(`style-${params.style}`);

    const badgesWrap = document.createElement('div');
    badgesWrap.className = 'badges';
    badgesWrap.style.gap = `${params.Gap}px`;

    // center only if block
    if(params.style === 'block'){
      ROOT.style.alignItems = 'center';
      ROOT.style.justifyContent = 'center';
    } else {
      ROOT.style.alignItems = 'flex-start';
      ROOT.style.justifyContent = 'flex-start';
    }

    // create badges for rows that have a name (column B)
    const rows = baseData.rows.filter(r => (r.name || '').trim() !== '').slice(0, maxItems);
    for(let i=0;i<rows.length;i++){
      const badge = createBadge(rows[i], i);
      badgesWrap.appendChild(badge);
    }

    ROOT.appendChild(badgesWrap);

    // scale to fit viewport
    requestAnimationFrame(()=>fitToViewport(badgesWrap));
  }

  function updateStatuses(newRows){
    // only update classes/visibility/opacity for each badge based on status
    const badgesWrap = ROOT.querySelector('.badges');
    if(!badgesWrap) return;
    const badgeEls = Array.from(badgesWrap.children);
    for(let i=0;i<badgeEls.length;i++){
      const el = badgeEls[i];
      const row = newRows[i];
      if(!row) continue;
      const status = (row.status || '').toString().toLowerCase();
      const reached = status === 'true' || status === '1' || status === 'yes' || status === 'y';
      // remove previous notreached classes
      el.classList.remove('notreached','shadow','black','hidden','transparent');
      if(!reached){
        el.classList.add('notreached', params.NoGoal || 'shadow');
      }
    }
  }

  function fitToViewport(container){
    // compute natural size
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // temporarily reset transform to measure
    container.style.transform = 'scale(1)';
    const rect = container.getBoundingClientRect();
    const naturalW = rect.width;
    const naturalH = rect.height;
    if(naturalW === 0 || naturalH === 0) return;
    const scaleX = (vw - 20) / naturalW;
    const scaleY = (vh - 20) / naturalH;
    const scale = Math.min(1, Math.min(scaleX, scaleY));
    container.style.transform = `scale(${scale})`;
  }

  async function fullFetchAndRender(){
    try{
      const data = await fetchGviz(params.Sheet);
      const rows = rowsFromGviz(data);
      baseData.rows = rows;
      baseData.lastFetch = Date.now();
      renderBase();
    }catch(err){
      console.warn('Overlay full fetch failed', err);
    }
  }

  async function statusFetchAndUpdate(){
    try{
      const data = await fetchGviz(params.Sheet);
      const rows = rowsFromGviz(data);
      // update statuses only (but also update names/icons if changed every 15s)
      updateStatuses(rows);
    }catch(err){
      console.warn('Overlay status fetch failed', err);
    }
  }

  function startTimers(){
    // status every 3s
    statusOnlyTimer = setInterval(statusFetchAndUpdate, 3000);
    // full refresh every 15s
    fullRefreshTimer = setInterval(fullFetchAndRender, 15000);
  }

  function stopTimers(){
    clearInterval(statusOnlyTimer);
    clearInterval(fullRefreshTimer);
  }

  function validateParams(){
    if(!params.Sheet || params.Sheet.length < 5) {
      console.error('Missing sheet id');
      return false;
    }
    if(!['shadow','black','hidden','transparent'].includes(params.NoGoal)) params.NoGoal = 'shadow';
    if(!['y','n'].includes(params.Name)) params.Name = 'y';
    if(!['column','line','block'].includes(params.style)) params.style = 'column';
    if(isNaN(params.Gap)) params.Gap = 10;
    return true;
  }

  return {
    initFromLocation: async function(){
      parseParams();
      if(!validateParams()) return;
      // initial full fetch
      await fullFetchAndRender();
      startTimers();
      // handle resize to re-fit
      window.addEventListener('resize', ()=> {
        const wrap = ROOT.querySelector('.badges');
        if(wrap) fitToViewport(wrap);
      });
    },
    // for testing
    _internal: { params, baseData }
  };
})();

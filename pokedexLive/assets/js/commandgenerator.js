// ============================================
// StreamDex - Command Generator (commandgenerator.js)
// ============================================

let cgData = {};

document.addEventListener('DOMContentLoaded', async () => {
  try {
    cgData = await SD.fetchJson('Data/json/commandgenerator_data.json');
    console.log('[cg] Données chargées :', {
      buyable: cgData.BuyableCreatures?.length,
      all: cgData.AllCreatures?.length,
      zones: cgData.Zones?.length,
      bgGroups: Object.keys(cgData.BackgroundGroups || {}).length
    });
  } catch (e) {
    console.error('[cg] Erreur chargement commandgenerator_data.json :', e);
    return;
  }

  initTabs();
  initBuy();
  initScrap();
  initTrade();
  initZone();
  initBackground();
});

// ── Onglets ───────────────────────────────────────────────────────────────────

function initTabs() {
  document.querySelectorAll('.sd-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sd-tab').forEach(b => b.classList.remove('sd-tab--active'));
      document.querySelectorAll('.cg-panel').forEach(p => p.style.display = 'none');
      btn.classList.add('sd-tab--active');
      document.getElementById(`tab-${btn.dataset.tab}`).style.display = 'block';
    });
  });
}

// ── Helpers autocomplete ──────────────────────────────────────────────────────

function makeAutocomplete(inputId, listId, items, getLabel) {
  const input = document.getElementById(inputId);
  const list  = document.getElementById(listId);
  let acIdx   = -1;

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    list.innerHTML = '';
    acIdx = -1;
    if (!q) { list.style.display = 'none'; return; }

    const matches = items.filter(i => getLabel(i).toLowerCase().includes(q)).slice(0, 12);
    if (!matches.length) { list.style.display = 'none'; return; }

    matches.forEach((item, i) => {
      const li = document.createElement('li');
      li.textContent = getLabel(item);
      li.addEventListener('mousedown', () => {
        input.value = getLabel(item);
        input._selected = item;
        list.style.display = 'none';
      });
      li.addEventListener('mouseover', () => {
        list.querySelectorAll('li').forEach(el => el.classList.remove('active'));
        li.classList.add('active');
        acIdx = i;
      });
      list.appendChild(li);
    });
    list.style.display = 'block';
  });

  input.addEventListener('keydown', e => {
    const items = list.querySelectorAll('li');
    if (!items.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      acIdx = Math.min(acIdx + 1, items.length - 1);
      items.forEach((el, i) => el.classList.toggle('active', i === acIdx));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      acIdx = Math.max(acIdx - 1, -1);
      items.forEach((el, i) => el.classList.toggle('active', i === acIdx));
    } else if (e.key === 'Enter' && acIdx >= 0) {
      e.preventDefault();
      items[acIdx].dispatchEvent(new MouseEvent('mousedown'));
    } else if (e.key === 'Escape') {
      list.style.display = 'none';
    }
  });

  document.addEventListener('click', e => {
    if (!e.target.closest(`#${inputId}`) && !e.target.closest(`#${listId}`)) {
      list.style.display = 'none';
    }
  });

  return { input, list };
}

function makeVariantToggle(selector) {
  const btns = document.querySelectorAll(selector);
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      btns.forEach(b => b.classList.remove('cg-variant--active'));
      btn.classList.add('cg-variant--active');
    });
  });
  return () => document.querySelector(`${selector}.cg-variant--active`)?.dataset.variant || 'normal';
}

function showResult(boxId, copyBtnId, text) {
  const box = document.getElementById(boxId);
  const btn = document.getElementById(copyBtnId);
  box.textContent = text;
  btn.style.display = 'inline-flex';
  btn.onclick = () => {
    navigator.clipboard.writeText(text).then(() => {
      btn.textContent = '✅ Copié !';
      setTimeout(() => { btn.textContent = '📋 Copier'; }, 1500);
    }).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    });
  };
}

// ── Buy ───────────────────────────────────────────────────────────────────────

function initBuy() {
  const items = cgData.BuyableCreatures || [];
  const { input } = makeAutocomplete('buy-creature-input', 'buy-ac', items, i => i.DisplayName);
  const getVariant = makeVariantToggle('#tab-buy .cg-variant-btn');

  document.getElementById('buy-generate').addEventListener('click', () => {
    const name = input._selected?.Name || input.value.trim().replace(/ /g, '_');
    if (!name) { console.warn('[cg][buy] Aucune créature sélectionnée.'); return; }
    const variant = getVariant();
    const cmd = `${cgData.CmdBuy} ${name} ${variant.charAt(0).toUpperCase() + variant.slice(1)}`;
    console.log('[cg][buy] Commande générée :', cmd);
    showResult('buy-result', 'buy-copy', cmd);
  });
}

// ── Scrap ─────────────────────────────────────────────────────────────────────

function initScrap() {
  const items = cgData.AllCreatures || [];
  const { input } = makeAutocomplete('scrap-creature-input', 'scrap-ac', items, i => i.DisplayName);
  const modeSelect = document.getElementById('scrap-mode');
  const creatureGroup = document.getElementById('scrap-creature-group');

  modeSelect.addEventListener('change', () => {
    const fullScrap = modeSelect.value === 'full fulldex';
    creatureGroup.style.display = fullScrap ? 'none' : 'block';
    if (fullScrap) input.value = '';
  });

  document.getElementById('scrap-generate').addEventListener('click', () => {
    const mode = modeSelect.value;
    let cmd;
    if (mode === 'full fulldex') {
      cmd = `${cgData.CmdScrap} full fulldex`;
    } else {
      const name = input._selected?.Name || input.value.trim().replace(/ /g, '_');
      if (!name) { console.warn('[cg][scrap] Aucune créature sélectionnée.'); return; }
      cmd = `${cgData.CmdScrap} ${mode.replace('{name}', name)}`;
    }
    console.log('[cg][scrap] Commande générée :', cmd);
    showResult('scrap-result', 'scrap-copy', cmd);
  });
}

// ── Trade ─────────────────────────────────────────────────────────────────────

function initTrade() {
  const items = cgData.AllCreatures || [];
  const { input: sendInput } = makeAutocomplete('trade-send-input', 'trade-send-ac', items, i => i.DisplayName);
  const { input: recvInput } = makeAutocomplete('trade-recv-input', 'trade-recv-ac', items, i => i.DisplayName);

  const getSendVariant = makeVariantToggle('[data-group="send"].cg-variant-btn');
  const getRecvVariant = makeVariantToggle('[data-group="recv"].cg-variant-btn');

  document.getElementById('trade-generate').addEventListener('click', () => {
    const send = sendInput._selected?.Name || sendInput.value.trim().replace(/ /g, '_');
    const recv = recvInput._selected?.Name || recvInput.value.trim().replace(/ /g, '_');
    if (!send || !recv) { console.warn('[cg][trade] Champs incomplets.'); return; }
    const cmd = `${cgData.CmdTrade} ${send} ${getSendVariant()} ${recv} ${getRecvVariant()}`;
    console.log('[cg][trade] Commande générée :', cmd);
    showResult('trade-result', 'trade-copy', cmd);
  });
}

// ── Zone ──────────────────────────────────────────────────────────────────────

function initZone() {
  const regions = cgData.Regions || [];
  const zones   = cgData.Zones   || [];
  const btnContainer  = document.getElementById('zone-region-btns');
  const cardContainer = document.getElementById('zone-cards-container');

  regions.forEach((region, i) => {
    const btn = document.createElement('button');
    btn.className = `sd-btn sd-btn--ghost${i === 0 ? ' cg-variant--active' : ''}`;
    btn.style.cssText = 'padding:6px 14px;font-size:13px';
    btn.textContent = region;
    btn.addEventListener('click', () => {
      btnContainer.querySelectorAll('button').forEach(b => b.classList.remove('cg-variant--active'));
      btn.classList.add('cg-variant--active');
      renderZones(zones.filter(z => z.Region === region));
    });
    btnContainer.appendChild(btn);
  });

  if (regions.length > 0) renderZones(zones.filter(z => z.Region === regions[0]));

  function renderZones(list) {
    document.getElementById('zone-result').textContent = '';
    document.getElementById('zone-copy').style.display = 'none';
    cardContainer.innerHTML = list.map(z => `
      <div class="sd-card cg-item-card" onclick="selectZone(this,'${SD.esc(z.Name)}')" data-name="${SD.esc(z.Name)}">
        ${z.Image ? `<img src="${SD.esc(z.Image)}" alt="${SD.esc(z.Name)}">` : ''}
        <div class="sd-card__body" style="padding:10px">
          <div class="sd-card__title">${SD.esc(z.Name)}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px">
            Dex ≥ ${z.DexRequirement} · Lvl ≥ ${z.LevelRequirement}
          </div>
        </div>
      </div>`).join('');
  }
}

window.selectZone = function(card, name) {
  document.querySelectorAll('#zone-cards-container .cg-item-card').forEach(c => c.classList.remove('selected'));
  card.classList.add('selected');
  const cmd = `${cgData.CmdZone} ${name.replace(/ /g, '_')}`;
  console.log('[cg][zone] Commande :', cmd);
  showResult('zone-result', 'zone-copy', cmd);
};

// ── Background ────────────────────────────────────────────────────────────────

function initBackground() {
  const groups    = cgData.BackgroundGroups || {};
  const groupNames = Object.keys(groups);
  const btnContainer  = document.getElementById('bg-group-btns');
  const cardContainer = document.getElementById('bg-cards-container');

  groupNames.forEach((group, i) => {
    const btn = document.createElement('button');
    btn.className = `sd-btn sd-btn--ghost${i === 0 ? ' cg-variant--active' : ''}`;
    btn.style.cssText = 'padding:6px 14px;font-size:13px';
    btn.textContent = group;
    btn.addEventListener('click', () => {
      btnContainer.querySelectorAll('button').forEach(b => b.classList.remove('cg-variant--active'));
      btn.classList.add('cg-variant--active');
      renderBgs(groups[group]);
    });
    btnContainer.appendChild(btn);
  });

  if (groupNames.length > 0) renderBgs(groups[groupNames[0]]);

  function renderBgs(list) {
    document.getElementById('bg-result').textContent = '';
    document.getElementById('bg-copy').style.display = 'none';
    cardContainer.innerHTML = list.map(bg => `
      <div class="sd-card cg-item-card" onclick="selectBg(this,'${SD.esc(bg.Name)}')" data-name="${SD.esc(bg.Name)}">
        ${bg.Url ? `<img src="${SD.esc(bg.Url)}" alt="${SD.esc(bg.Name)}">` : ''}
        <div class="sd-card__body" style="padding:10px">
          <div class="sd-card__title">${SD.esc(bg.Name)}</div>
          ${bg.Requirements?.length ? `<div style="font-size:11px;color:var(--text-muted);margin-top:4px">${bg.Requirements.map(r => `${SD.esc(r.Type)}: ${SD.esc(String(r.Value))}`).join(' · ')}</div>` : ''}
        </div>
      </div>`).join('');
  }
}

window.selectBg = function(card, name) {
  document.querySelectorAll('#bg-cards-container .cg-item-card').forEach(c => c.classList.remove('selected'));
  card.classList.add('selected');
  const cmd = `${cgData.CmdCard} ${name.replace(/ /g, '_')}`;
  console.log('[cg][background] Commande :', cmd);
  showResult('bg-result', 'bg-copy', cmd);
};

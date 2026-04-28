/* ===================================================
   BASTOCOS — Charte Graphique (CDC)
   graph.js
   =================================================== */

// ——— Date de génération ———
document.getElementById('gen-date').textContent =
  new Date().toLocaleDateString('fr-FR', { day:'2-digit', month:'long', year:'numeric' });

// ——— Tab buttons demo (section boutons) ———
document.querySelectorAll('.demo-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.demo-tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// ——— Replay animation popIn ———
function replayPopin() {
  const el = document.getElementById('popinDemo');
  el.classList.remove('replay');
  void el.offsetWidth; // reflow
  el.classList.add('replay');
}

// ——— Playground ———

const contentType  = document.getElementById('pg-content-type');
const textControls = document.getElementById('pg-text-controls');
const imgControls  = document.getElementById('pg-image-controls');
const cardControls = document.getElementById('pg-card-controls');
const modalControls= document.getElementById('pg-modal-controls');
const btnControls  = document.getElementById('pg-button-controls');

const allControlPanels = [textControls, imgControls, cardControls, modalControls, btnControls];

contentType.addEventListener('change', () => {
  allControlPanels.forEach(p => { if (p) p.style.display = 'none'; });
  switch (contentType.value) {
    case 'text':   textControls.style.display  = 'block'; break;
    case 'image':  imgControls.style.display   = 'block'; break;
    case 'card':   cardControls.style.display  = 'block'; break;
    case 'modal':  modalControls.style.display = 'block'; break;
    case 'button': btnControls.style.display   = 'block'; break;
  }
  applyPlayground();
});

// Background selector
const pgBg = document.getElementById('pg-bg');
const pgBgCustomWrap = document.getElementById('pg-bg-custom-wrap');
const pgBgCustom = document.getElementById('pg-bg-custom');

pgBg.addEventListener('change', () => {
  pgBgCustomWrap.style.display = pgBg.value === 'custom' ? 'block' : 'none';
});

// ——— Stat rows for modal ———
function addStat() {
  const list = document.getElementById('pg-stats-list');
  const row = document.createElement('div');
  row.className = 'pg-stat-row';
  row.innerHTML = `
    <input type="text" placeholder="Clé" class="pg-stat-k" />
    <input type="text" placeholder="Valeur" class="pg-stat-v" />
    <button class="pg-remove-stat" onclick="removeStat(this)">−</button>
  `;
  list.appendChild(row);
}

function removeStat(btn) {
  const rows = document.querySelectorAll('.pg-stat-row');
  if (rows.length > 1) {
    btn.closest('.pg-stat-row').remove();
  }
}

// ——— Build the preview element ———
function buildElement() {
  const type = contentType.value;
  const el = document.getElementById('pg-element');

  if (type === 'text') {
    const text   = document.getElementById('pg-text').value || 'Texte';
    el.innerHTML = escapeHtml(text);
    el.className = '';
    applyTextStyles(el);

  } else if (type === 'image') {
    const url = document.getElementById('pg-img-url').value.trim();
    const alt = document.getElementById('pg-img-alt').value || 'image';
    el.innerHTML = '';
    el.className = '';
    if (url) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = escapeHtml(alt);
      img.onerror = () => { img.style.opacity = '0.3'; };
      el.appendChild(img);
    } else {
      el.textContent = '(entrez une URL d\'image)';
      el.style.cssText = 'color: var(--text-muted); font-style: italic;';
      return;
    }
    applyBoxStyles(el);

  } else if (type === 'card') {
    const name   = document.getElementById('pg-card-name').value || 'Nom';
    const imgUrl = document.getElementById('pg-card-img').value.trim();
    const btnLbl = document.getElementById('pg-card-btn').value || 'Voir plus';
    el.className = '';
    el.style.cssText = '';
    el.innerHTML = `
      <div class="pg-card-inner">
        ${imgUrl
          ? `<img class="pg-c-img" src="${escapeAttr(imgUrl)}" alt="${escapeAttr(name)}" onerror="this.style.opacity='0.3'" />`
          : `<div class="pg-c-emoji">📦</div>`}
        <div class="pg-c-name">${escapeHtml(name)}</div>
        <button class="demo-btn-more">${escapeHtml(btnLbl)}</button>
      </div>
    `;

  } else if (type === 'modal') {
    const title  = document.getElementById('pg-modal-title').value || 'Titre';
    const desc   = document.getElementById('pg-modal-desc').value || '';
    const imgUrl = document.getElementById('pg-modal-img').value.trim();
    const stats  = [...document.querySelectorAll('.pg-stat-row')].map(row => ({
      k: row.querySelector('.pg-stat-k').value,
      v: row.querySelector('.pg-stat-v').value,
    })).filter(s => s.k || s.v);

    el.className = '';
    el.style.cssText = '';
    el.innerHTML = `
      <div class="pg-modal-inner">
        ${imgUrl ? `<img class="pg-m-img" src="${escapeAttr(imgUrl)}" alt="${escapeAttr(title)}" onerror="this.style.opacity='0.3'" />` : ''}
        <div class="pg-m-name">${escapeHtml(title)}</div>
        ${desc ? `<div class="pg-m-desc">${escapeHtml(desc)}</div>` : ''}
        <ul>
          ${stats.map(s => `<li><span>${escapeHtml(s.k)}</span><span>${escapeHtml(s.v)}</span></li>`).join('')}
        </ul>
      </div>
    `;

  } else if (type === 'button') {
    const label    = document.getElementById('pg-btn-label').value || 'Bouton';
    const style    = document.getElementById('pg-btn-style').value;
    el.className = '';
    el.style.cssText = '';

    if (style === 'btn-more') {
      el.innerHTML = `<button class="demo-btn-more">${escapeHtml(label)}</button>`;
    } else if (style === 'nav-btn') {
      el.innerHTML = `<a class="demo-nav-btn" href="#">${escapeHtml(label)}</a>`;
    } else if (style === 'btn-twitch') {
      el.innerHTML = `
        <a class="demo-btn-twitch" href="#">
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6
              0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286
              12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/>
          </svg>
          ${escapeHtml(label)}
        </a>`;
    } else if (style === 'btn-voir-page') {
      el.innerHTML = `<button class="demo-btn-voir-page">${escapeHtml(label)}</button>`;
    }
  }
}

function applyTextStyles(el) {
  const size   = document.getElementById('pg-font-size').value;
  const weight = document.getElementById('pg-font-weight').value;
  const color  = document.getElementById('pg-text-color').value;
  const upper  = document.getElementById('pg-uppercase').checked;
  const ls     = document.getElementById('pg-ls').value;

  el.style.cssText = '';
  applyBoxStyles(el);
  el.style.fontSize    = size;
  el.style.fontWeight  = weight;
  el.style.color       = color;
  el.style.textTransform = upper ? 'uppercase' : 'none';
  el.style.letterSpacing = ls;
}

function applyBoxStyles(el) {
  const radius  = document.getElementById('pg-radius').value;
  const border  = document.getElementById('pg-border').value;
  const shadow  = document.getElementById('pg-shadow').value;
  const padding = document.getElementById('pg-padding').value;

  el.style.borderRadius = radius;
  el.style.border       = border;
  el.style.boxShadow    = shadow;
  el.style.padding      = padding;
}

function getStageBackground() {
  if (document.getElementById('pg-bg').value === 'custom') {
    return document.getElementById('pg-bg-custom').value;
  }
  return document.getElementById('pg-bg').value;
}

function generateCss() {
  const type = contentType.value;
  let lines = [];

  const bg = getStageBackground();
  lines.push(`/* Stage background */`);
  lines.push(`background: ${bg};`);
  lines.push('');

  if (type === 'text') {
    lines.push(`font-size: ${document.getElementById('pg-font-size').value};`);
    lines.push(`font-weight: ${document.getElementById('pg-font-weight').value};`);
    lines.push(`color: ${document.getElementById('pg-text-color').value};`);
    lines.push(`text-transform: ${document.getElementById('pg-uppercase').checked ? 'uppercase' : 'none'};`);
    lines.push(`letter-spacing: ${document.getElementById('pg-ls').value};`);
    lines.push('');
  }
  if (['text','image'].includes(type)) {
    lines.push(`border-radius: ${document.getElementById('pg-radius').value};`);
    lines.push(`border: ${document.getElementById('pg-border').value};`);
    lines.push(`box-shadow: ${document.getElementById('pg-shadow').value};`);
    lines.push(`padding: ${document.getElementById('pg-padding').value};`);
  }

  return lines.join('\n');
}

function applyPlayground() {
  buildElement();
  document.getElementById('pg-stage').style.background = getStageBackground();
  document.getElementById('pg-css-output').textContent = generateCss();
}

function resetPlayground() {
  // Reset selects to defaults
  document.getElementById('pg-content-type').value = 'text';
  allControlPanels.forEach(p => { if (p) p.style.display = 'none'; });
  textControls.style.display = 'block';
  document.getElementById('pg-text').value = 'Épée de feu';
  document.getElementById('pg-bg').value = '#100808';
  pgBgCustomWrap.style.display = 'none';
  document.getElementById('pg-font-size').value = '0.95rem';
  document.getElementById('pg-font-weight').value = '400';
  document.getElementById('pg-text-color').value = '#e74c3c';
  document.getElementById('pg-uppercase').checked = false;
  document.getElementById('pg-ls').value = '3px';
  document.getElementById('pg-radius').value = '6px';
  document.getElementById('pg-border').value = '1px solid #5a1a1a';
  document.getElementById('pg-shadow').value = '0 8px 24px rgba(192,57,43,0.35)';
  document.getElementById('pg-padding').value = '1rem';
  applyPlayground();
}

function copyCss() {
  const text = document.getElementById('pg-css-output').textContent;
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.querySelector('.pg-copy-btn');
    const orig = btn.textContent;
    btn.textContent = '✓ Copié !';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  });
}

// ——— Live preview: re-apply on any control change ———
document.querySelectorAll('.pg-controls input, .pg-controls select').forEach(input => {
  input.addEventListener('input', applyPlayground);
  input.addEventListener('change', applyPlayground);
});

// ——— Init ———
applyPlayground();

// ——— Helpers ———
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function escapeAttr(str) {
  return String(str)
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

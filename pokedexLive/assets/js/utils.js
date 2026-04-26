// ============================================
// StreamDex - Utility Functions (utils.js)
// ============================================

const SD = {

  // --- JSON Loader ---
  async fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
    return res.json();
  },

  // --- Query Params ---
  getParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  },

  // --- Render helpers ---
  loading(container, msg = 'Chargement...') {
    container.innerHTML = `
      <div class="sd-loading">
        <div class="sd-loading__spinner"></div>
        <p>${msg}</p>
      </div>`;
  },

  error(container, msg = 'Erreur de chargement des données.') {
    container.innerHTML = `<div class="sd-error">⚠️ ${msg}</div>`;
  },

  empty(container, msg = 'Aucun résultat.') {
    container.innerHTML = `<div class="sd-empty">${msg}</div>`;
  },

  // --- Copy to clipboard ---
  copyText(text, btn) {
    navigator.clipboard?.writeText(text).then(() => {
      if (btn) {
        const orig = btn.textContent;
        btn.textContent = '✓ Copié';
        btn.classList.add('copied');
        setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 1500);
      }
    }).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    });
  },

  // --- Format numbers ---
  fmt(n) {
    if (n === undefined || n === null) return '—';
    return Number(n).toLocaleString('fr-FR');
  },

  // --- Percent bar ---
  progressBar(value, max, cls = '') {
    const pct = max > 0 ? Math.min(100, (value / max) * 100).toFixed(1) : 0;
    return `
      <div class="sd-progress" title="${pct}%">
        <div class="sd-progress__bar ${cls}" style="width:${pct}%"></div>
      </div>
      <span style="font-size:11px;color:var(--text-muted)">${value}/${max} (${pct}%)</span>`;
  },

  // --- Sprite with pixelated rendering ---
  sprite(src, alt = '', height = 64) {
    return `<img src="${src}" alt="${alt}" style="height:${height}px;width:auto;image-rendering:pixelated;" loading="lazy">`;
  },

  // --- Badge ---
  badge(text, cls = 'gray') {
    return `<span class="sd-badge sd-badge--${cls}">${text}</span>`;
  },

  // --- Type image ---
  typeImg(typeUrl) {
    if (!typeUrl) return '';
    return `<img class="sd-type-icon" src="${typeUrl}" alt="type">`;
  },

  // --- Escape HTML ---
  esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  // --- Debounce ---
  debounce(fn, ms = 250) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  },

  // --- Filter/Search helper ---
  filterItems(items, query, fields) {
    if (!query) return items;
    const q = query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return items.filter(item =>
      fields.some(f => {
        const v = String(item[f] ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        return v.includes(q);
      })
    );
  },

  // --- Title setter ---
  setTitle(title) {
    document.title = `StreamDex › ${title}`;
    const h = document.getElementById('sd-page-title');
    if (h) h.textContent = title;
  },

  // --- Navbar active link ---
  markActiveNav() {
    const path = window.location.pathname.split('/').pop();
    document.querySelectorAll('.sd-navbar__link').forEach(a => {
      if (a.getAttribute('href') === path) a.classList.add('active');
    });
  }
};

// Mark active nav on load
document.addEventListener('DOMContentLoaded', () => SD.markActiveNav());

// ============================================
// StreamDex - Utility Functions (utils.js)
// ============================================

// ── Dropdown navbar (toggle au clic, fermeture au clic extérieur) ──────────
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.sd-dropdown__toggle').forEach(toggle => {
    toggle.addEventListener('click', e => {
      e.stopPropagation();
      const dropdown = toggle.closest('.sd-dropdown');
      const isOpen = dropdown.classList.contains('is-open');
      // Ferme tous les dropdowns ouverts
      document.querySelectorAll('.sd-dropdown.is-open').forEach(d => d.classList.remove('is-open'));
      // Ouvre celui-ci seulement s'il était fermé
      if (!isOpen) dropdown.classList.add('is-open');
    });
  });

  // Clic en dehors → ferme tout
  document.addEventListener('click', () => {
    document.querySelectorAll('.sd-dropdown.is-open').forEach(d => d.classList.remove('is-open'));
  });

  // Clic sur un item du menu → ferme le dropdown
  document.querySelectorAll('.sd-dropdown__item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.sd-dropdown.is-open').forEach(d => d.classList.remove('is-open'));
    });
  });
});
// ──────────────────────────────────────────────────────────────────────────

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
  },

  // --- Hamburger menu init ---
  initHamburger() {
    const btn   = document.getElementById('sd-hamburger');
    const links = document.querySelector('.sd-navbar__links');
    if (!btn || !links) return;
    btn.addEventListener('click', () => {
      const open = links.classList.toggle('is-open');
      btn.classList.toggle('is-open', open);
      btn.setAttribute('aria-expanded', open);
    });
    // Fermer au clic sur un lien
    links.querySelectorAll('.sd-navbar__link').forEach(a =>
      a.addEventListener('click', () => {
        links.classList.remove('is-open');
        btn.classList.remove('is-open');
        btn.setAttribute('aria-expanded', false);
      })
    );
  },

  // --- Cookies helpers ---
  setCookie(name, value, days = 365) {
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)};expires=${expires};path=/;SameSite=Lax`;
  },

  getCookie(name) {
    const key   = encodeURIComponent(name) + '=';
    const found = document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith(key));
    return found ? decodeURIComponent(found.slice(key.length)) : null;
  },

  deleteCookie(name) {
    document.cookie = `${encodeURIComponent(name)}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
  }
};

// Mark active nav + init hamburger on every page
document.addEventListener('DOMContentLoaded', () => {
  SD.markActiveNav();
  SD.initHamburger();
});
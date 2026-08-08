// ============================================================
// PKServ Admin — searchable-select.js
// Composant select avec recherche (contain, sans accents ni casse)
// ============================================================

'use strict';

// ── Normalisation ─────────────────────────────────────────────
// Supprime les accents et met en minuscules pour la comparaison.
function ssNormalize(str) {
  if (!str) return '';
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// ── Classe principale ─────────────────────────────────────────
class SearchableSelect {
  /**
   * @param {string} wrapperId  ID du <div> conteneur
   * @param {string} hiddenId   ID du <input type="hidden"> qui stocke la valeur sélectionnée
   * @param {string} placeholder
   */
  constructor(wrapperId, hiddenId, placeholder = 'Rechercher…') {
    this._wrapperId  = wrapperId;
    this._hiddenId   = hiddenId;
    this._placeholder = placeholder;
    this._items      = [];   // { value, label, labelNorm }
    this._open       = false;
    this._focusIdx   = -1;

    this._wrapper = document.getElementById(wrapperId);
    this._hidden  = document.getElementById(hiddenId);

    if (!this._wrapper || !this._hidden) {
      console.warn(`[SearchableSelect] élément introuvable : ${wrapperId} / ${hiddenId}`);
      return;
    }
    this._render();
    this._bind();
  }

  // ── DOM ──────────────────────────────────────────────────────
  _render() {
    this._wrapper.innerHTML = `
      <div class="adm-ss">
        <input type="text"
          class="adm-input adm-ss__input"
          autocomplete="off"
          placeholder="${this._placeholder}">
        <div class="adm-ss__dropdown" hidden></div>
      </div>`;
    this._input    = this._wrapper.querySelector('.adm-ss__input');
    this._dropdown = this._wrapper.querySelector('.adm-ss__dropdown');
  }

  _bind() {
    // Ouvrir sur focus / clic
    this._input.addEventListener('focus', () => this._openDropdown());
    this._input.addEventListener('input', () => {
      this._focusIdx = -1;
      this._filterAndRender();
      this._openDropdown();
    });

    // Navigation clavier
    this._input.addEventListener('keydown', e => {
      const rows = [...this._dropdown.querySelectorAll('.adm-ss__option:not(.hidden)')];
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this._focusIdx = Math.min(this._focusIdx + 1, rows.length - 1);
        this._highlightRow(rows);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this._focusIdx = Math.max(this._focusIdx - 1, 0);
        this._highlightRow(rows);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (rows[this._focusIdx]) rows[this._focusIdx].click();
      } else if (e.key === 'Escape') {
        this._closeDropdown();
      }
    });

    // Fermer si clic en dehors
    document.addEventListener('click', e => {
      if (!this._wrapper.contains(e.target)) this._closeDropdown();
    });
  }

  _highlightRow(rows) {
    rows.forEach((r, i) => r.classList.toggle('focused', i === this._focusIdx));
    rows[this._focusIdx]?.scrollIntoView({ block: 'nearest' });
  }

  // ── Dropdown ─────────────────────────────────────────────────
  _openDropdown() {
    this._filterAndRender();
    this._dropdown.hidden = false;
    this._open = true;
  }

  _closeDropdown() {
    this._dropdown.hidden = true;
    this._open = false;
    this._focusIdx = -1;
  }

  _filterAndRender() {
    const query = ssNormalize(this._input.value);
    const filtered = query
      ? this._items.filter(it => it.labelNorm.includes(query))
      : this._items;

    if (!filtered.length) {
      this._dropdown.innerHTML =
        '<div class="adm-ss__empty">Aucun résultat.</div>';
      return;
    }

    this._dropdown.innerHTML = filtered.slice(0, 200).map(it => `
      <div class="adm-ss__option" data-value="${ssEsc(it.value)}" title="${ssEsc(it.label)}">
        ${ssEsc(it.label)}
      </div>`).join('');

    // Bind clics
    this._dropdown.querySelectorAll('.adm-ss__option').forEach(row => {
      row.addEventListener('click', () => {
        this._select(row.dataset.value, row.textContent.trim());
      });
    });

    // Pré-sélectionner la valeur actuelle
    const curVal = this._hidden.value;
    if (curVal) {
      this._dropdown.querySelectorAll('.adm-ss__option').forEach(row => {
        if (row.dataset.value === curVal) row.classList.add('selected');
      });
    }
  }

  _select(value, label) {
    this._hidden.value  = value;
    this._input.value   = label;
    this._hidden.dispatchEvent(new Event('change', { bubbles: true }));
    this._closeDropdown();
  }

  // ── API publique ──────────────────────────────────────────────

  /**
   * Définit la liste des options.
   * @param {Array<{value:string, label:string}>} items
   */
  setOptions(items) {
    this._items = items.map(it => ({
      value:     it.value,
      label:     it.label,
      labelNorm: ssNormalize(it.label),
    }));
    // Ré-afficher si déjà ouvert
    if (this._open) this._filterAndRender();
  }

  /** Valeur actuellement sélectionnée (contenu du hidden input). */
  getValue() { return this._hidden?.value ?? ''; }

  /** Sélectionne programmatiquement une valeur (cherche le label correspondant). */
  setValue(value) {
    const found = this._items.find(it => it.value === value);
    if (found) this._select(found.value, found.label);
    else { this._hidden.value = value; this._input.value = value; }
  }

  /** Vide la sélection et réinitialise le champ de recherche. */
  clear() {
    this._hidden.value = '';
    this._input.value  = '';
    this._closeDropdown();
  }
}

// Échappe le HTML dans les attributs / contenu
function ssEsc(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Registre global ───────────────────────────────────────────
// Accessible depuis tous les modules : ADM.ss['giveaway-user-ball']
ADM.ss = {};

/* Gestionnaire du tableau de données avec tri, édition et prévisualisation */
class TableManager {
  constructor(containerElement, onCardSelect = null, onItemsChange = null) {
    this.container = containerElement;
    this.onCardSelect = onCardSelect;
    // Prévient l'application hôte (compteur de cartes, bouton d'export) après
    // un ajout, une duplication ou une suppression de ligne.
    this.onItemsChange = onItemsChange;
    this.items = [];
    this.currentSort = { field: 'index', order: 'asc' };
    this.globalBackground = '';
  }

  setItems(items, globalBackground = '') {
    this.items = items;
    this.globalBackground = globalBackground || '';
    this.render();
  }

  getItems() {
    return this.items;
  }

  /* --- Gestion des lignes : ajout, duplication, suppression ---------------- */

  /* Nouvelle ligne vierge : tout est vide, sauf le fond qui hérite du Background
   * global de la série (même règle que lors de l'import d'un JSON). */
  createEmptyItem() {
    const item = new CardItem({});
    item.background = this.globalBackground || '';
    return item;
  }

  /* Copie d'un item, utilisée lors de la duplication d'une ligne (voir CardItem.clone). */
  cloneItem(item) {
    return item.clone();
  }

  /* Ajoute une ligne vide à la fin du tableau et place le focus dessus. */
  addRow() {
    this.items.push(this.createEmptyItem());
    this.render();
    this.focusRow(this.items.length - 1);
    this.notifyItemsChanged();
  }

  /* Insère une copie de la ligne `idx` juste après celle-ci, puis place le focus
   * sur la nouvelle ligne (Index présélectionné : il reste à le personnaliser). */
  duplicateRow(idx) {
    const item = this.items[idx];
    if (!item) return;

    this.items.splice(idx + 1, 0, this.cloneItem(item));
    this.render();
    this.focusRow(idx + 1);
    this.notifyItemsChanged();
  }

  /* Supprime la ligne `idx`. S'il ne restait qu'une ligne, le tableau redevient vide. */
  deleteRow(idx) {
    if (!this.items[idx]) return;

    this.items.splice(idx, 1);
    this.render();
    this.notifyItemsChanged();
  }

  /* Donne le focus à la première cellule d'une ligne (fin de tableau pour un ajout)
   * et signale brièvement la ligne concernée. */
  focusRow(idx) {
    const row = this.container.querySelector(`tr[data-index="${idx}"]`);
    if (!row) return;

    row.classList.add('row-new');

    const input = row.querySelector('input[data-field="index"]');
    if (input) {
      input.focus();
      if (typeof input.select === 'function') input.select();
    }

    if (typeof row.scrollIntoView === 'function') {
      row.scrollIntoView({ block: 'nearest' });
    }

    setTimeout(() => row.classList.remove('row-new'), 1200);
  }

  /* Signale à l'application hôte que la liste des cartes a changé. */
  notifyItemsChanged() {
    if (this.onItemsChange) this.onItemsChange(this.items.length);
  }

  /* --- Application d'une valeur à toutes les lignes ------------------------ */

  /* Applique `rawValue` à la colonne `field` de toutes les lignes du tableau.
   * Appelée lorsque l'utilisateur valide une case de la ligne « ⇩ toutes ». */
  applyBulkValue(field, rawValue) {
    if (this.items.length === 0) return;

    const isSelectField = field === 'rarity' || field === 'fullArt' || field === 'font';
    let appliedText = null; // Valeur réaffichée après re-rendu (champs texte uniquement).

    if (field === 'index') {
      // Même normalisation que l'édition cellule par cellule.
      appliedText = String(rawValue).trim().toUpperCase();
      this.items.forEach(item => { item.index = appliedText; });
    } else if (field === 'font') {
      if (rawValue === '') return; // Option de tête : aucune application.
      const font = FontDef.normalize(rawValue);
      this.items.forEach(item => { item.font = font; });
    } else if (field === 'rarity') {
      if (rawValue === '') return; // Option de tête : aucune application.
      const rarity = RarityDef.normalize(rawValue);
      this.items.forEach(item => { item.rarity = rarity; });
    } else if (field === 'fullArt') {
      if (rawValue === '') return; // Option de tête : aucune application.
      const parsed = CardItem.parseLayout(rawValue);
      // parseLayout('both') renvoie null : la carte est produite dans les deux
      // mises en page (true = Full Art, false = Classique).
      const fullArt = parsed === null ? null : (parsed === CardItem.LAYOUT_FULLART);
      this.items.forEach(item => { item.fullArt = fullArt; });
    } else {
      appliedText = String(rawValue).trim();
      this.items.forEach(item => { item[field] = appliedText; });
    }

    this.render();

    // La case texte conserve la valeur appliquée : elle reflète l'état de la colonne
    // et permet d'enchaîner une correction. Les listes déroulantes, elles, reviennent
    // à leur option neutre (« ⇩ toutes ») : l'action est ponctuelle.
    if (!isSelectField && appliedText !== null) {
      this.restoreBulkInput(field, appliedText);
    }
  }

  /* Rend le focus à la case « ⇩ toutes » d'une colonne après un re-rendu du tableau. */
  restoreBulkInput(field, value) {
    const input = this.container.querySelector(`[data-bulk-field="${field}"]`);
    if (!input) return;

    input.value = value;
    input.focus();

    if (typeof input.setSelectionRange === 'function') {
      try {
        input.setSelectionRange(value.length, value.length);
      } catch (err) {
        // Certains types de champs refusent setSelectionRange : on ignore.
      }
    }
  }

  /* Rang de tri d'une carte selon sa mise en page (true = Full Art, false = Classique,
   * null = les deux). */
  layoutRank(value) {
    if (value === true) return 0;
    if (value === false) return 1;
    return 2;
  }

  sort(field) {
    if (this.currentSort.field === field) {
      this.currentSort.order = this.currentSort.order === 'asc' ? 'desc' : 'asc';
    } else {
      this.currentSort.field = field;
      this.currentSort.order = 'asc';
    }

    const { field: sortField, order } = this.currentSort;
    const modifier = order === 'asc' ? 1 : -1;

    this.items.sort((a, b) => {
      let valA = a[sortField];
      let valB = b[sortField];

      // Colonne « Type » : classement Full Art < Classique < Les deux.
      if (sortField === 'fullArt') {
        return (this.layoutRank(valA) - this.layoutRank(valB)) * modifier;
      }

      if (typeof valA === 'string') {
        return valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' }) * modifier;
      }
      if (typeof valA === 'number') {
        return (valA - valB) * modifier;
      }
      return 0;
    });

    this.render();
  }

  /* Barre d'outils du tableau : compteur de lignes et ajout d'une ligne à la fin. */
  buildToolbarHtml() {
    const count = this.items ? this.items.length : 0;
    return `
      <div class="table-toolbar">
        <span class="table-row-count">${count} ligne(s)</span>
        <button type="button" class="btn-add-row" title="Ajouter une ligne vide à la fin du tableau">➕ Ajouter une ligne</button>
      </div>
    `;
  }

  /* Seconde ligne d'en-tête : une valeur saisie dans l'une de ces cases est appliquée
   * à toutes les lignes du tableau. Les listes déroulantes (Rareté, Type) proposent en
   * tête l'option neutre « ⇩ toutes » : la choisir n'applique rien. */
  buildBulkRowHtml() {
    const bulkInput = (field, extraClass, title) => `
      <input type="text" class="cell-input bulk-input ${extraClass}" data-bulk-field="${field}" placeholder="⇩ toutes" title="${title}">
    `;

    return `
      <tr class="bulk-apply-row">
        <th>
          ${bulkInput('index', 'index-input', 'Appliquer cet Index à toutes les lignes')}
        </th>
        <th>
          <div class="media-cell">
            ${bulkInput('underlay', 'url-input', 'Appliquer cette URL d’underlay à toutes les lignes')}
          </div>
        </th>
        <th>
          <div class="media-cell">
            ${bulkInput('background', 'url-input', 'Appliquer cette URL de fond à toutes les lignes')}
          </div>
        </th>
        <th>${bulkInput('nameFR', '', 'Appliquer ce nom FR à toutes les lignes')}</th>
        <th>${bulkInput('nameEN', '', 'Appliquer ce nom EN à toutes les lignes')}</th>
        <th>
          <textarea class="cell-textarea bulk-input" data-bulk-field="descFR" rows="2" placeholder="⇩ toutes" title="Appliquer cette description FR à toutes les lignes"></textarea>
        </th>
        <th>
          <textarea class="cell-textarea bulk-input" data-bulk-field="descEN" rows="2" placeholder="⇩ toutes" title="Appliquer cette description EN à toutes les lignes"></textarea>
        </th>
        <th>
          <select class="rarity-select bulk-input" data-bulk-field="rarity" title="Appliquer cette rareté à toutes les lignes">
            <option value="">⇩ toutes</option>
            ${RarityDef.RARITIES.map(r => `<option value="${r.value}">${r.symbol} ${r.label}</option>`).join('')}
          </select>
        </th>
        <th>
          <select class="layout-select bulk-input" data-bulk-field="fullArt" title="Appliquer ce type de carte à toutes les lignes">
            <option value="">⇩ toutes</option>
            <option value="both">Les deux</option>
            <option value="fullart">Full Art</option>
            <option value="classic">Classique</option>
          </select>
        </th>
        <th>
          <select class="font-select bulk-input" data-bulk-field="font" title="Appliquer cette police à toutes les lignes">
            <option value="">⇩ toutes</option>
            ${FontDef.FONTS.map(f => `<option value="${f.key}">${f.label}</option>`).join('')}
          </select>
        </th>
        <th class="col-actions"></th>
      </tr>
    `;
  }

  render() {
    const toolbar = this.buildToolbarHtml();

    if (!this.items || this.items.length === 0) {
      this.container.innerHTML = `
        ${toolbar}
        <div class="empty-table">Aucune carte chargée. Importez un JSON ci-dessus ou ajoutez une ligne.</div>
      `;
      this.bindEvents();
      return;
    }

    const sortIndicator = (field) => {
      if (this.currentSort.field !== field) return '<span class="sort-icon">⇅</span>';
      return this.currentSort.order === 'asc' ? '<span class="sort-icon active">▲</span>' : '<span class="sort-icon active">▼</span>';
    };

    let html = `
      ${toolbar}
      <table class="bulk-table">
        <thead>
          <tr>
            <th data-sort="index">Index (Série) ${sortIndicator('index')}</th>
            <th>Underlay</th>
            <th>Fond</th>
            <th data-sort="nameFR">Nom (FR) ${sortIndicator('nameFR')}</th>
            <th data-sort="nameEN">Nom (EN) ${sortIndicator('nameEN')}</th>
            <th data-sort="descFR">Description (FR) ${sortIndicator('descFR')}</th>
            <th data-sort="descEN">Description (EN) ${sortIndicator('descEN')}</th>
            <th data-sort="rarity">Rareté ${sortIndicator('rarity')}</th>
            <th data-sort="fullArt">Type ${sortIndicator('fullArt')}</th>
            <th data-sort="font">Police ${sortIndicator('font')}</th>
            <th>Actions</th>
          </tr>
          ${this.buildBulkRowHtml()}
        </thead>
        <tbody>
    `;

    this.items.forEach((item, idx) => {
      // Signalé lorsque le fond provient du Background global de la série et non de l'item.
      const isGlobalBackground = !!this.globalBackground && item.background === this.globalBackground;
      html += `
        <tr data-index="${idx}">
          <td class="col-index">
            <input type="text" class="cell-input index-input" data-idx="${idx}" data-field="index" value="${this.escapeHtml(item.index)}">
          </td>
          <td class="col-media">
            <div class="media-cell">
              ${item.underlay ? `<img src="${this.escapeHtml(item.underlay)}" alt="underlay" class="table-thumbnail pixel-render" loading="lazy">` : '<span class="no-thumb">-</span>'}
              <input type="text" class="cell-input url-input" data-idx="${idx}" data-field="underlay" value="${this.escapeHtml(item.underlay)}" placeholder="URL underlay…" title="${this.escapeHtml(item.underlay)}">
            </div>
          </td>
          <td class="col-media">
            <div class="media-cell">
              ${item.background ? `<img src="${this.escapeHtml(item.background)}" alt="fond" class="table-thumbnail" loading="lazy">` : '<span class="no-thumb">-</span>'}
              <input type="text" class="cell-input url-input ${isGlobalBackground ? 'inherited' : ''}" data-idx="${idx}" data-field="background" value="${this.escapeHtml(item.background)}" placeholder="URL fond…" title="${isGlobalBackground ? 'Fond hérité de la série' : this.escapeHtml(item.background)}">
            </div>
          </td>
          <td>
            <input type="text" class="cell-input" data-idx="${idx}" data-field="nameFR" value="${this.escapeHtml(item.nameFR)}">
          </td>
          <td>
            <input type="text" class="cell-input" data-idx="${idx}" data-field="nameEN" value="${this.escapeHtml(item.nameEN)}">
          </td>
          <td>
            <textarea class="cell-textarea" data-idx="${idx}" data-field="descFR" rows="2">${this.escapeHtml(item.descFR)}</textarea>
          </td>
          <td>
            <textarea class="cell-textarea" data-idx="${idx}" data-field="descEN" rows="2">${this.escapeHtml(item.descEN)}</textarea>
          </td>
          <td class="col-rarity">
            <select class="rarity-select" data-idx="${idx}">
              ${RarityDef.RARITIES.map(r => `
                <option value="${r.value}" ${item.rarity === r.value ? 'selected' : ''}>
                  ${r.symbol} ${r.label}
                </option>
              `).join('')}
            </select>
          </td>
          <td class="col-layout">
            <select class="layout-select" data-idx="${idx}" title="Mise en page exportée">
              <option value="both" ${item.fullArt === null ? 'selected' : ''}>Les deux</option>
              <option value="fullart" ${item.fullArt === true ? 'selected' : ''}>Full Art</option>
              <option value="classic" ${item.fullArt === false ? 'selected' : ''}>Classique</option>
            </select>
          </td>
          <td class="col-font">
            <select class="font-select" data-idx="${idx}" title="Police de caractères de la carte">
              ${FontDef.FONTS.map(f => `
                <option value="${f.key}" ${item.font === f.key ? 'selected' : ''}>
                  ${f.label}
                </option>
              `).join('')}
            </select>
          </td>
          <td class="col-actions">
            <div class="row-actions">
              <button type="button" class="btn-row-action btn-preview-card" data-idx="${idx}" title="Voir l'aperçu">👁 Aperçu</button>
              <button type="button" class="btn-row-action btn-duplicate-row" data-idx="${idx}" title="Dupliquer cette ligne juste après">⧉</button>
              <button type="button" class="btn-row-action btn-delete-row" data-idx="${idx}" title="Supprimer cette ligne">🗑</button>
            </div>
          </td>
        </tr>
      `;
    });

    html += `
        </tbody>
      </table>
    `;

    this.container.innerHTML = html;
    this.bindEvents();
  }

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  bindEvents() {
    // Tri par colonne
    this.container.querySelectorAll('th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const field = th.getAttribute('data-sort');
        this.sort(field);
      });
    });

    // Modification champs texte (les cases de la ligne « ⇩ toutes » n'ont pas de data-idx
    // et sont donc ignorées ici ; elles sont traitées plus bas).
    this.container.querySelectorAll('.cell-input[data-idx], .cell-textarea[data-idx]').forEach(input => {
      input.addEventListener('change', (e) => {
        const idx = parseInt(e.target.getAttribute('data-idx'), 10);
        const field = e.target.getAttribute('data-field');
        if (this.items[idx]) {
          let val = e.target.value.trim();
          if (field === 'index') {
            val = val.toUpperCase();
            e.target.value = val;
          }
          this.items[idx][field] = val;

          // Met à jour la miniature et l'indicateur de fond hérité sans re-rendre tout le tableau.
          if (field === 'underlay' || field === 'background') {
            this.refreshMediaCell(e.target);
          }
        }
      });
    });

    // Modification Rareté
    this.container.querySelectorAll('.rarity-select[data-idx]').forEach(select => {
      select.addEventListener('change', (e) => {
        const idx = parseInt(e.target.getAttribute('data-idx'), 10);
        if (this.items[idx]) {
          this.items[idx].rarity = parseInt(e.target.value, 10);
        }
      });
    });

    // Modification du type de carte (Full Art / Classique / Les deux)
    this.container.querySelectorAll('.layout-select[data-idx]').forEach(select => {
      select.addEventListener('change', (e) => {
        const idx = parseInt(e.target.getAttribute('data-idx'), 10);
        if (this.items[idx]) {
          // parseLayout('both') renvoie null : la carte est alors produite dans les deux
          // mises en page. On conserve un vrai booléen (true = Full Art, false = Classique).
          const parsed = CardItem.parseLayout(e.target.value);
          this.items[idx].fullArt = parsed === null ? null : (parsed === CardItem.LAYOUT_FULLART);
        }
      });
    });

    // Modification de la police de caractères
    this.container.querySelectorAll('.font-select[data-idx]').forEach(select => {
      select.addEventListener('change', (e) => {
        const idx = parseInt(e.target.getAttribute('data-idx'), 10);
        if (this.items[idx]) {
          this.items[idx].font = FontDef.normalize(e.target.value);
        }
      });
    });

    // Bouton de prévisualisation
    this.container.querySelectorAll('.btn-preview-card').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.currentTarget.getAttribute('data-idx'), 10);
        if (this.items[idx] && this.onCardSelect) {
          this.onCardSelect(this.items[idx]);
        }
      });
    });

    // Application d'une valeur à toutes les lignes (ligne « ⇩ toutes »).
    // Le change est déclenché à la validation (Entrée) ou à la sortie du champ.
    this.container.querySelectorAll('[data-bulk-field]').forEach(input => {
      input.addEventListener('change', (e) => {
        this.applyBulkValue(e.target.getAttribute('data-bulk-field'), e.target.value);
      });
    });

    // Ajout d'une ligne vide à la fin du tableau.
    const addButton = this.container.querySelector('.btn-add-row');
    if (addButton) {
      addButton.addEventListener('click', () => this.addRow());
    }

    // Duplication d'une ligne, juste après celle-ci.
    this.container.querySelectorAll('.btn-duplicate-row').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.duplicateRow(parseInt(e.currentTarget.getAttribute('data-idx'), 10));
      });
    });

    // Suppression d'une ligne.
    this.container.querySelectorAll('.btn-delete-row').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.deleteRow(parseInt(e.currentTarget.getAttribute('data-idx'), 10));
      });
    });
  }

  /* Met à jour la miniature d'une cellule « Underlay » ou « Fond » après édition de l'URL. */
  refreshMediaCell(inputElement) {
    const cell = inputElement.closest('.media-cell');
    if (!cell) return;

    const url = inputElement.value.trim();
    inputElement.title = url;

    if (inputElement.getAttribute('data-field') === 'background') {
      const isGlobalBackground = !!this.globalBackground && url === this.globalBackground;
      inputElement.classList.toggle('inherited', isGlobalBackground);
      inputElement.title = isGlobalBackground ? 'Fond hérité de la série' : url;
    }

    let img = cell.querySelector('img.table-thumbnail');
    const thumbClass = inputElement.getAttribute('data-field') === 'underlay'
      ? 'table-thumbnail pixel-render'
      : 'table-thumbnail';

    if (!url) {
      if (img) img.remove();
      if (!cell.querySelector('.no-thumb')) {
        const span = document.createElement('span');
        span.className = 'no-thumb';
        span.textContent = '-';
        cell.insertBefore(span, inputElement);
      }
      return;
    }

    const noThumb = cell.querySelector('.no-thumb');
    if (noThumb) noThumb.remove();

    if (!img) {
      img = document.createElement('img');
      img.alt = inputElement.getAttribute('data-field');
      img.loading = 'lazy';
      cell.insertBefore(img, inputElement);
    }
    img.className = thumbClass;
    img.src = url;
  }
}

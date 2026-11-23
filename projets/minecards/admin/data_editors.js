/**
 * data_editors.js - The page of `admin/data_editors.py`.
 *
 * Two views of the same file:
 *   - FORM, generated from the schema the server sends (one control per field, per family), so a
 *     typo in a cross-reference becomes a dropdown instead of a broken save;
 *   - JSON, the file itself with line numbers, completion (`Ctrl+Espace`), smart search and the
 *     same validation.
 *
 * The server is the only writer: it hands the candidate to the project linter's data rules through
 * their file overlay, so a validation never touches the real file, and a save is written only when
 * the linter accepted it. Validation runs when a file is opened, on "Vérifier" and on
 * "Enregistrer" - never per keystroke. This page therefore never decides on its own that something
 * is valid; it only shows what the linter said.
 */

/** Base path of the JSON API of `data_editors.py`. */
const API_ROOT = '/api';

/** How many completion items are shown at once. */
const COMPLETION_LIMIT = 80;

/** How many card matches a card picker offers at once. */
const CARD_MATCH_LIMIT = 12;

/** Everything the page knows, in one object so no module-level mutable binding is needed. */
const state = {
  /** @type {object[]} Files returned by `/api/bootstrap`. */
  files: [],
  /** @type {Record<string, object>} Schema of each family, by kind. */
  schemas: {},
  /** @type {Record<string, unknown[]>} Completion sources (cards, ids, assets…). */
  suggestions: {},
  /** @type {object|null} File currently open. */
  current: null,
  /** @type {string} Raw JSON currently in the editor. */
  text: '',
  /** @type {unknown} Parsed value; null once the JSON view was edited. */
  value: null,
  /** @type {'form'|'json'} Active view. */
  mode: 'form',
  /** @type {boolean} Whether the buffer differs from the file on disk. */
  dirty: false,
  /** @type {object[]} Last diagnostics returned by the server. */
  diagnostics: [],
  /** @type {string} Text the diagnostics describe. */
  validatedText: '',
  /** @type {boolean} True while a save is in flight. */
  saving: false,
  /** @type {boolean} True while a validation is in flight. */
  validating: false,
  /** @type {{items: object[], index: number, start: number, kind: string}} Completion popup. */
  completion: { items: [], index: 0, start: 0, kind: 'none' },
  /** @type {{term: string, matches: number[], index: number}} Raw search. */
  search: { term: '', matches: [], index: -1 },
};

/** Cached DOM references, named the way the markup is written. */
const el = {};

/**
 * Looks up one element of the page.
 *
 * @param {string} selector - CSS selector.
 * @returns {HTMLElement} The element.
 * @throws {Error} When the markup is incomplete.
 */
function pick(selector) {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`data_editors.html is missing ${selector}`);
  return element;
}

/**
 * Calls the JSON API and unwraps its errors.
 *
 * @param {string} path - API path, beginning with `/`.
 * @param {RequestInit} [options] - Fetch options.
 * @returns {Promise<object>} The parsed payload.
 * @throws {Error} When the server refuses the request.
 */
async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_ROOT}${path}`, { cache: 'no-store', ...options });
  } catch (error) {
    throw new Error('Serveur local injoignable : lancez « python admin/data_editors.py ».');
  }
  let payload = null;
  const type = response.headers.get('Content-Type') ?? '';
  try {
    payload = await response.json();
  } catch (error) {
    // The game's static server (`start_server.cmd`) answers HTML 404 on `/api/...`: say which
    // program this page needs instead of a bare parse error.
    if (!type.includes('application/json')) {
      throw new Error(
        'Cette page a besoin de son propre serveur : lancez « python admin/data_editors.py » ' +
          'puis ouvrez http://127.0.0.1:8770/admin/data_editors.html (le serveur du jeu ne fournit pas /api).'
      );
    }
    throw new Error(`Réponse illisible du serveur (HTTP ${response.status}).`);
  }
  if (!response.ok || payload?.error) {
    throw new Error(payload?.error || `HTTP ${response.status}`);
  }
  return payload;
}

/**
 * Shows a one-line message above the editor.
 *
 * @param {string} message - Text to display.
 * @param {'info'|'success'|'error'|'warning'} [tone='info'] - Visual tone.
 * @returns {void}
 */
function showFeedback(message, tone = 'info') {
  el.feedback.hidden = message === '';
  el.feedback.textContent = message;
  el.feedback.dataset.tone = tone;
}

/**
 * Writes the status line under the page.
 *
 * @param {string} message - Text to display.
 * @returns {void}
 */
function setStatus(message) {
  el.status.textContent = message;
}

/**
 * Reads the value at a path (keys and numeric indexes).
 *
 * @param {unknown} root - Root value.
 * @param {Array<string|number>} path - Path to read.
 * @returns {unknown} The value, or undefined.
 */
function getAt(root, path) {
  return path.reduce((node, key) => (node === null || node === undefined ? undefined : node[key]), root);
}

/**
 * Writes the value at a path, creating nothing.
 *
 * @param {unknown} root - Root value.
 * @param {Array<string|number>} path - Path to write.
 * @param {unknown} value - New value.
 * @returns {void}
 */
function setAt(root, path, value) {
  if (path.length === 0) return;
  const parent = getAt(root, path.slice(0, -1));
  if (parent === null || parent === undefined) return;
  parent[path[path.length - 1]] = value;
}

/**
 * Removes the value at a path.
 *
 * @param {unknown} root - Root value.
 * @param {Array<string|number>} path - Path to remove.
 * @returns {void}
 */
function deleteAt(root, path) {
  if (path.length === 0) return;
  const parent = getAt(root, path.slice(0, -1));
  const key = path[path.length - 1];
  if (Array.isArray(parent)) parent.splice(Number(key), 1);
  else if (parent && typeof parent === 'object') delete parent[key];
}

/**
 * Serializes the in-memory value to the text of the JSON view.
 *
 * @returns {void}
 */
function syncText() {
  state.text = `${JSON.stringify(state.value, null, 4)}\n`;
  el.code.value = state.text;
  refreshGutter();
}

/**
 * Marks the buffer as changed by a form control.
 *
 * The validation is NOT run here: a form edit only rewrites the JSON view.
 *
 * @returns {void}
 */
function commitForm() {
  syncText();
  markDirty();
}

/**
 * Returns the text that would be saved right now.
 *
 * @returns {string} The buffer.
 */
function currentText() {
  return state.mode === 'json' ? el.code.value : state.text;
}

/**
 * Builds a spec for a value when the schema has no description for it.
 *
 * Unknown fields are kept (and editable) instead of being dropped by a re-serialization.
 *
 * @param {unknown} value - Value to describe.
 * @returns {object} A minimal field spec.
 */
function inferSpec(value) {
  if (Array.isArray(value)) {
    return { type: 'array', item: value.length > 0 ? inferSpec(value[0]) : { type: 'any' } };
  }
  if (value === null) return { type: 'any' };
  if (typeof value === 'number') return { type: Number.isInteger(value) ? 'integer' : 'number' };
  if (typeof value === 'boolean') return { type: 'boolean' };
  if (typeof value === 'object') return { type: 'object' };
  return { type: 'string' };
}

/**
 * Lists the completion values of one field spec.
 *
 * @param {object} spec - Field spec (from the server schema).
 * @returns {string[]} Values to offer.
 */
function suggestionValues(spec) {
  if (!spec) return [];
  if (Array.isArray(spec.choices)) return spec.choices;
  if (spec.source && Array.isArray(state.suggestions[spec.source])) {
    return state.suggestions[spec.source];
  }
  switch (spec.type) {
    case 'cardIndex':
      return state.suggestions.cardIndexes ?? [];
    case 'cardKey':
      return state.suggestions.cardKeys ?? [];
    case 'cardKeyOrSet':
      return [...(state.suggestions.cardKeys ?? []), ...(state.suggestions.boosterSets ?? [])];
    case 'asset':
      return state.suggestions.assetPaths ?? [];
    case 'iconName':
      return state.suggestions.iconNames ?? [];
    case 'titleId':
      return state.suggestions.titleIds ?? [];
    case 'setId':
      return state.suggestions.boosterSets ?? [];
    case 'trophyName': {
      const bySet = state.suggestions.trophyNames ?? {};
      const own = state.current?.setId ? bySet[state.current.setId] : null;
      return own && own.length > 0 ? own : Object.values(bySet).flat();
    }
    case 'localized':
      return state.suggestions.languages ?? [];
    case 'boolean':
      return ['true', 'false'];
    default:
      return [];
  }
}

/**
 * Returns the `<datalist>` of a source, creating it once.
 *
 * @param {string} id - Datalist identity.
 * @param {string[]} values - Options.
 * @returns {string} The `list` attribute value.
 */
function datalist(id, values) {
  const listId = `de-source-${id.replace(/[^a-z0-9-]/gi, '-')}`;
  let list = document.getElementById(listId);
  if (!list) {
    list = document.createElement('datalist');
    list.id = listId;
    el.sources.appendChild(list);
  }
  if (list.dataset.count !== String(values.length)) {
    list.textContent = '';
    values.forEach((value) => {
      const option = document.createElement('option');
      option.value = value;
      list.appendChild(option);
    });
    list.dataset.count = String(values.length);
  }
  return listId;
}

/**
 * Tells whether a spec needs the whole width of the grid.
 *
 * @param {object} spec - Field spec.
 * @returns {boolean} True for objects, arrays, maps and localized records.
 */
function isWide(spec) {
  return ['object', 'array', 'map', 'localized', 'any'].includes(spec.type);
}

/**
 * Builds a text input wired to the model.
 *
 * @param {string} value - Current value.
 * @param {object} spec - Field spec.
 * @param {Array<string|number>} path - Path of the value.
 * @param {(raw: string) => void} write - Applies the typed value.
 * @returns {HTMLInputElement} The input.
 */
function textInput(value, spec, path, write) {
  const input = document.createElement('input');
  input.className = 'field__input data-editor__input';
  input.type = 'text';
  input.value = value;
  input.spellcheck = false;
  const values = suggestionValues(spec);
  if (values.length > 0) input.setAttribute('list', datalist(`${spec.type}-${spec.key ?? path.join('.')}`, values));
  input.addEventListener('input', () => write(input.value));
  return input;
}

/**
 * Builds the collection identity of a card index, exactly like the server and the linter.
 *
 * @param {string} index - Card index (`SERIE-A1 / W001`).
 * @returns {string} The identity part of the collection key (`SERIE-A1 _ W001`).
 */
function cardIdentity(index) {
  return String(index)
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .join(' _ ');
}

/**
 * Lists the French and English names of a card index or collection key.
 *
 * @param {string} value - Index (`SERIE-A1 / W001`) or key (`SERIE-A1 _ W001_classic`).
 * @returns {string[]} The known names, French first.
 */
function cardNameList(value) {
  const text = String(value);
  const names = state.suggestions.cardNames ?? {};
  const index = names[text]
    ? text
    : (Object.keys(names).find((candidate) => text.startsWith(`${cardIdentity(candidate)}_`)) ?? null);
  const entry = index ? names[index] : null;
  return entry
    ? [entry.fr, entry.en].filter((name) => typeof name === 'string' && name !== '')
    : [];
}

/**
 * Labels a card index or collection key with its names, for the picker and its suggestions.
 *
 * @param {string} value - Index or collection key.
 * @returns {string} The value followed by its names, or the value alone.
 */
function cardLabel(value) {
  const names = cardNameList(value);
  return names.length === 0 ? String(value) : `${value} · ${names.join(' / ')}`;
}

/**
 * Lists the cards matching a query, by index, by key or by French/English name.
 *
 * Every word of the query must appear in the value or in its names, so "laine blanche" and
 * "white wool" both find `SERIE-A1 / W001`. With no query, the first values are offered.
 *
 * @param {object} spec - Card field spec.
 * @param {string} query - Typed text.
 * @returns {string[]} Up to `CARD_MATCH_LIMIT` matching values.
 */
function cardMatches(spec, query) {
  const candidates = suggestionValues(spec);
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return candidates.slice(0, CARD_MATCH_LIMIT);
  return candidates
    .filter((value) => {
      const haystack = `${value} ${cardNameList(value).join(' ')}`.toLowerCase();
      return tokens.every((token) => haystack.includes(token));
    })
    .slice(0, CARD_MATCH_LIMIT);
}

/**
 * Builds the picker of a field that must name a card.
 *
 * The value written into the file is always the index (or the collection key); the names are only
 * a way to find it. Typing filters the suggestions, clicking or pressing Enter takes one, and
 * leaving the field on an exact French or English name binds the field to the matching index.
 *
 * @param {unknown} value - Current value.
 * @param {object} spec - Field spec (`cardIndex`, `cardKey` or `cardKeyOrSet`).
 * @param {(next: string) => void} write - Applies the chosen value.
 * @returns {HTMLElement} The picker.
 */
function cardControl(value, spec, write) {
  const wrapper = document.createElement('div');
  wrapper.className = 'data-editor__card';

  const input = document.createElement('input');
  input.className = 'field__input data-editor__input';
  input.type = 'text';
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.value = value === null || value === undefined ? '' : String(value);

  const hint = document.createElement('span');
  hint.className = 'data-editor__card-hint';

  const matches = document.createElement('ul');
  matches.className = 'data-editor__card-matches';
  matches.hidden = true;

  /** Paints the names of the current value under the field. */
  const paintHint = () => {
    const names = cardNameList(input.value);
    hint.textContent =
      names.length === 0 ? 'Index ou nom français/anglais, au choix.' : names.join(' / ');
  };

  /** Writes one value and closes the suggestions. */
  const commit = (next) => {
    input.value = next;
    matches.hidden = true;
    write(next);
    paintHint();
  };

  /** Fills the suggestion list from the current text. */
  const search = () => {
    const found = cardMatches(spec, input.value);
    matches.textContent = '';
    matches.hidden = found.length === 0;
    found.forEach((candidate) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'data-editor__card-match';
      button.textContent = cardLabel(candidate);
      // `mousedown` runs before the blur of the input: the click keeps the focus on the field.
      button.addEventListener('mousedown', (event) => {
        event.preventDefault();
        commit(candidate);
        input.focus();
      });
      item.appendChild(button);
      matches.appendChild(item);
    });
  };

  /** Binds a typed name to its index (or key) when the field is left on it. */
  const resolveName = () => {
    const typed = input.value.trim();
    if (typed === '' || suggestionValues(spec).includes(typed)) return;
    const needle = typed.toLowerCase();
    const exact = suggestionValues(spec).find((candidate) =>
      cardNameList(candidate).some((name) => name.toLowerCase() === needle)
    );
    const prefix =
      exact ??
      suggestionValues(spec).find((candidate) =>
        cardNameList(candidate).some((name) => name.toLowerCase().startsWith(needle))
      );
    if (prefix) commit(prefix);
    else paintHint();
  };

  input.addEventListener('input', () => {
    write(input.value);
    paintHint();
    search();
  });
  input.addEventListener('focus', search);
  input.addEventListener('blur', () => {
    matches.hidden = true;
    resolveName();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      matches.hidden = true;
      return;
    }
    if (event.key !== 'Enter') return;
    const first = cardMatches(spec, input.value)[0];
    if (!first) return;
    event.preventDefault();
    commit(first);
  });

  paintHint();
  wrapper.append(input, hint, matches);
  return wrapper;
}

/**
 * Builds the control of one scalar field.
 *
 * @param {unknown} value - Current value.
 * @param {object} spec - Field spec.
 * @param {Array<string|number>} path - Path of the value.
 * @returns {HTMLElement} The control.
 */
function scalarControl(value, spec, path) {
  const write = (next) => {
    setAt(state.value, path, next);
    commitForm();
  };
  const remove = () => {
    deleteAt(state.value, path);
    commitForm();
  };

  if (spec.type === 'cardIndex' || spec.type === 'cardKey' || spec.type === 'cardKeyOrSet') {
    return cardControl(value, spec, write);
  }

  if (spec.type === 'boolean') {
    const label = document.createElement('label');
    label.className = 'data-editor__check';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = value === true;
    input.addEventListener('change', () => write(input.checked));
    label.append(input, document.createTextNode(value === true ? 'Oui' : 'Non'));
    return label;
  }

  if (spec.type === 'enum' || (spec.type !== 'map' && Array.isArray(spec.choices))) {
    const select = document.createElement('select');
    select.className = 'field__select data-editor__input';
    if (spec.optional) {
      const empty = document.createElement('option');
      empty.value = '';
      empty.textContent = 'Aucune valeur';
      select.appendChild(empty);
    }
    const values = suggestionValues(spec);
    values.forEach((choice) => {
      const option = document.createElement('option');
      option.value = choice;
      option.textContent = choice;
      select.appendChild(option);
    });
    if (value !== undefined && value !== null && !values.includes(String(value))) {
      const unknown = document.createElement('option');
      unknown.value = String(value);
      unknown.textContent = `${String(value)} (inconnu)`;
      select.appendChild(unknown);
    }
    select.value = value === undefined || value === null ? '' : String(value);
    select.addEventListener('change', () => {
      if (select.value === '') remove();
      else write(select.value);
    });
    return select;
  }

  if (spec.type === 'integer' || spec.type === 'number') {
    if (spec.nullable && (value === null || value === undefined)) {
      const wrapper = document.createElement('div');
      wrapper.className = 'data-editor__check';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.id = `de-null-${path.join('-')}`;
      const label = document.createElement('label');
      label.htmlFor = input.id;
      label.textContent = 'Valeur personnalisée';
      input.addEventListener('change', () => {
        if (input.checked) write(0);
      });
      wrapper.append(input, label);
      return wrapper;
    }
    const input = document.createElement('input');
    input.className = 'field__input data-editor__input';
    input.type = 'number';
    input.step = spec.type === 'integer' ? '1' : 'any';
    if (Number.isFinite(spec.min)) input.min = String(spec.min);
    input.value = value === undefined || value === null ? '' : String(value);
    input.addEventListener('input', () => {
      if (input.value.trim() === '') remove();
      else write(spec.type === 'integer' ? Number.parseInt(input.value, 10) : Number(input.value));
    });
    if (!spec.nullable) return input;

    // A nullable number keeps a way back to `null`: the game reads it as "use the rarity".
    const row = document.createElement('div');
    row.className = 'data-editor__inline';
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'data-editor__icon-button';
    clear.textContent = '∅';
    clear.title = 'Vider (null)';
    clear.setAttribute('aria-label', 'Vider (null)');
    clear.addEventListener('click', () => {
      setAt(state.value, path, null);
      renderForm();
      commitForm();
    });
    row.append(input, clear);
    return row;
  }

  if (spec.type === 'date') {
    const input = document.createElement('input');
    input.className = 'field__input data-editor__input';
    input.type = 'date';
    input.value = typeof value === 'string' ? value.slice(0, 10) : '';
    input.addEventListener('change', () => {
      if (input.value === '') remove();
      else write(input.value);
    });
    return input;
  }

  if (spec.type === 'localized') {
    const grid = document.createElement('div');
    grid.className = 'data-editor__grid';
    const current = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const languages = [
      ...(state.suggestions.languages ?? []),
      ...Object.keys(current).filter((code) => !(state.suggestions.languages ?? []).includes(code)),
    ];
    languages.forEach((code) => {
      const field = document.createElement('div');
      field.className = 'data-editor__field';
      const label = document.createElement('span');
      label.className = 'data-editor__label';
      label.textContent = code.toUpperCase();
      const input = document.createElement('input');
      input.className = 'field__input data-editor__input';
      input.type = 'text';
      input.value = typeof current[code] === 'string' ? current[code] : '';
      input.addEventListener('input', () => {
        const target = getAt(state.value, path);
        if (!target || typeof target !== 'object') setAt(state.value, path, { [code]: input.value });
        else target[code] = input.value;
        commitForm();
      });
      field.append(label, input);
      grid.appendChild(field);
    });
    return grid;
  }

  return textInput(value === null || value === undefined ? '' : String(value), spec, path, write);
}

/**
 * Builds one labelled field of a group.
 *
 * @param {unknown} value - Current value.
 * @param {object} spec - Field spec.
 * @param {Array<string|number>} path - Path of the value.
 * @returns {HTMLElement} The field.
 */
function buildField(value, spec, path) {
  const wrapper = document.createElement('div');
  wrapper.className = isWide(spec) ? 'data-editor__field data-editor__field--wide' : 'data-editor__field';

  // A wide control (object, array, map) already prints its own title: a second label right above
  // it would say the same thing twice.
  if (!isWide(spec) || spec.type === 'any') {
    const label = document.createElement('span');
    label.className = 'data-editor__label';
    label.textContent = spec.label ?? spec.key ?? 'Champ';
    if (spec.key) {
      const code = document.createElement('code');
      code.className = 'data-editor__label-code';
      code.textContent = spec.key;
      label.appendChild(code);
    }
    wrapper.appendChild(label);
  }
  wrapper.appendChild(buildControl(value, spec, path));
  if (spec.help) {
    const help = document.createElement('p');
    help.className = 'data-editor__help';
    help.textContent = spec.help;
    wrapper.appendChild(help);
  }
  return wrapper;
}

/**
 * Builds the control that matches a spec.
 *
 * @param {unknown} value - Current value.
 * @param {object} spec - Field spec.
 * @param {Array<string|number>} path - Path of the value.
 * @returns {HTMLElement} The control.
 */
function buildControl(value, spec, path) {
  if (spec.type === 'object') return buildObject(value, spec, path);
  if (spec.type === 'array') return buildArray(value, spec, path);
  if (spec.type === 'map') return buildMap(value, spec, path);
  if (spec.type === 'any') return buildRaw(value, path);
  return scalarControl(value, spec, path);
}

/**
 * Builds the editor of an object.
 *
 * Fields the schema does not describe are rendered too, so an older file keeps every key it has.
 *
 * @param {unknown} value - Current value.
 * @param {object} spec - Object spec.
 * @param {Array<string|number>} path - Path of the object.
 * @returns {HTMLElement} The block.
 */
function buildObject(value, spec, path) {
  const block = document.createElement('div');
  block.className = 'data-editor__group';
  if (spec.label) {
    const title = document.createElement('h3');
    title.className = 'data-editor__group-title';
    title.textContent = spec.label;
    block.appendChild(title);
  }
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const grid = document.createElement('div');
  grid.className = 'data-editor__grid';

  const known = new Set((spec.fields ?? []).map((field) => field.key));
  (spec.fields ?? []).forEach((fieldSpec) => {
    const present = Object.prototype.hasOwnProperty.call(record, fieldSpec.key);
    if (!present && !fieldSpec.required) return;
    grid.appendChild(buildField(record[fieldSpec.key], fieldSpec, [...path, fieldSpec.key]));
  });
  Object.keys(record).forEach((key) => {
    if (known.has(key)) return;
    const inferred = { key, label: key, ...inferSpec(record[key]) };
    grid.appendChild(buildField(record[key], inferred, [...path, key]));
  });
  block.appendChild(grid);
  return block;
}

/**
 * Builds the editor of an array.
 *
 * Each item is a card with its own move/duplicate/remove buttons, so a long catalogue stays
 * navigable without a full page reload.
 *
 * @param {unknown} value - Current value.
 * @param {object} spec - Array spec.
 * @param {Array<string|number>} path - Path of the array.
 * @returns {HTMLElement} The block.
 */
function buildArray(value, spec, path) {
  const block = document.createElement('div');
  block.className = 'data-editor__group';
  if (spec.label) {
    const title = document.createElement('h3');
    title.className = 'data-editor__group-title';
    title.textContent = `${spec.label} (${Array.isArray(value) ? value.length : 0})`;
    block.appendChild(title);
  }
  const list = Array.isArray(value) ? value : [];
  if (list.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'data-editor__empty';
    empty.textContent = 'Aucun élément.';
    block.appendChild(empty);
  }
  const itemSpec = spec.item ?? { type: 'any' };

  list.forEach((entry, index) => {
    const item = document.createElement('div');
    item.className = 'data-editor__item';

    const head = document.createElement('div');
    head.className = 'data-editor__item-head';
    const title = document.createElement('span');
    title.className = 'data-editor__item-title';
    const key = itemSpec.titleKey ? entry?.[itemSpec.titleKey] : null;
    title.textContent = `#${index + 1}${key === undefined || key === null ? '' : ` · ${key}`}`;
    const actions = document.createElement('div');
    actions.className = 'data-editor__item-actions';

    const button = (label, titleText, handler) => {
      const element = document.createElement('button');
      element.type = 'button';
      element.className = 'data-editor__icon-button';
      element.textContent = label;
      element.title = titleText;
      element.setAttribute('aria-label', titleText);
      element.addEventListener('click', handler);
      actions.appendChild(element);
    };
    button('↑', 'Monter', () => {
      if (index === 0) return;
      [list[index - 1], list[index]] = [list[index], list[index - 1]];
      renderForm();
      commitForm();
    });
    button('↓', 'Descendre', () => {
      if (index >= list.length - 1) return;
      [list[index + 1], list[index]] = [list[index], list[index + 1]];
      renderForm();
      commitForm();
    });
    button('⧉', 'Dupliquer', () => {
      list.splice(index + 1, 0, JSON.parse(JSON.stringify(entry)));
      renderForm();
      commitForm();
    });
    button('✕', 'Supprimer', () => {
      list.splice(index, 1);
      renderForm();
      commitForm();
    });

    head.append(title, actions);
    const body = document.createElement('div');
    body.className = 'data-editor__item-body';
    body.appendChild(buildControl(entry, itemSpec, [...path, index]));
    item.append(head, body);
    block.appendChild(item);
  });

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'btn btn--ghost data-editor__add';
  add.textContent = '+ Ajouter un élément';
  add.addEventListener('click', () => {
    const target = getAt(state.value, path);
    if (!Array.isArray(target)) return;
    target.push(defaultValueFor(itemSpec));
    renderForm();
    commitForm();
  });
  block.appendChild(add);
  return block;
}

/**
 * Builds the editor of a free-form map (a resource name to a price, for example).
 *
 * @param {unknown} value - Current value.
 * @param {object} spec - Map spec.
 * @param {Array<string|number>} path - Path of the map.
 * @returns {HTMLElement} The block.
 */
function buildMap(value, spec, path) {
  const block = document.createElement('div');
  block.className = 'data-editor__group';
  if (spec.label) {
    const title = document.createElement('h3');
    title.className = 'data-editor__group-title';
    title.textContent = spec.label;
    block.appendChild(title);
  }
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const keys = Object.keys(record);
  if (keys.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'data-editor__empty';
    empty.textContent = 'Aucune entrée.';
    block.appendChild(empty);
  }
  const valueSpec = { type: spec.valueType ?? 'integer', source: spec.source };

  keys.forEach((key) => {
    const row = document.createElement('div');
    row.className = 'data-editor__map-row';

    const keyInput = document.createElement('input');
    keyInput.className = 'field__input data-editor__input';
    keyInput.value = key;
    keyInput.spellcheck = false;
    const values = suggestionValues(valueSpec);
    if (values.length > 0) keyInput.setAttribute('list', datalist(`map-${path.join('.')}`, values));
    keyInput.addEventListener('change', () => {
      const nextKey = keyInput.value.trim();
      if (nextKey === '' || nextKey === key) {
        keyInput.value = key;
        return;
      }
      const entries = Object.entries(record);
      keys.forEach((existing) => delete record[existing]);
      entries.forEach(([entryKey, entryValue]) => {
        record[entryKey === key ? nextKey : entryKey] = entryValue;
      });
      renderForm();
      commitForm();
    });

    const valueInput = document.createElement('input');
    valueInput.className = 'field__input data-editor__input';
    valueInput.type = 'number';
    valueInput.step = '1';
    valueInput.value = String(record[key]);
    valueInput.addEventListener('input', () => {
      const next = Number.parseInt(valueInput.value, 10);
      if (Number.isFinite(next)) record[key] = next;
      else delete record[key];
      commitForm();
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'data-editor__icon-button';
    remove.textContent = '✕';
    remove.title = 'Supprimer';
    remove.setAttribute('aria-label', 'Supprimer');
    remove.addEventListener('click', () => {
      delete record[key];
      renderForm();
      commitForm();
    });

    row.append(keyInput, valueInput, remove);
    block.appendChild(row);
  });

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'btn btn--ghost data-editor__add';
  add.textContent = '+ Ajouter une entrée';
  add.addEventListener('click', () => {
    const target = getAt(state.value, path);
    if (!target || typeof target !== 'object') return;
    const values = suggestionValues(valueSpec);
    const free = values.find((candidate) => !Object.prototype.hasOwnProperty.call(target, candidate));
    target[free ?? ''] = spec.valueType === 'integer' ? 1 : '';
    renderForm();
    commitForm();
  });
  block.appendChild(add);
  return block;
}

/**
 * Builds a raw JSON textarea, the fallback for a shape no control describes.
 *
 * @param {unknown} value - Current value.
 * @param {Array<string|number>} path - Path of the value.
 * @returns {HTMLElement} The field.
 */
function buildRaw(value, path) {
  const field = document.createElement('div');
  field.className = 'data-editor__field';
  const area = document.createElement('textarea');
  area.className = 'data-editor__code';
  area.style.minHeight = '6rem';
  area.value = JSON.stringify(value ?? null, null, 4);
  const error = document.createElement('p');
  error.className = 'data-editor__help';
  area.addEventListener('change', () => {
    try {
      const parsed = JSON.parse(area.value);
      setAt(state.value, path, parsed);
      error.textContent = '';
      commitForm();
    } catch (issue) {
      error.textContent = `JSON invalide : ${issue.message}`;
    }
  });
  field.append(area, error);
  return field;
}

/**
 * Builds a default value for a new element.
 *
 * @param {object} spec - Spec of the element.
 * @returns {unknown} A value the form can edit right away.
 */
function defaultValueFor(spec) {
  switch (spec.type) {
    case 'object': {
      const value = {};
      (spec.fields ?? []).forEach((field) => {
        if (field.required) value[field.key] = defaultValueFor(field);
      });
      return value;
    }
    case 'array':
      return [];
    case 'map':
      return {};
    case 'localized':
      return Object.fromEntries((state.suggestions.languages ?? []).map((code) => [code, '']));
    case 'integer':
    case 'number':
      return Number.isFinite(spec.min) ? spec.min : 0;
    case 'boolean':
      return false;
    case 'enum':
      return suggestionValues(spec)[0] ?? '';
    default:
      return '';
  }
}

/**
 * Paints the whole form from the in-memory value.
 *
 * @returns {void}
 */
function renderForm() {
  el.formPanel.textContent = '';
  if (!state.current) {
    const placeholder = document.createElement('p');
    placeholder.className = 'data-editor__placeholder';
    placeholder.textContent = 'Choisissez un fichier.';
    el.formPanel.appendChild(placeholder);
    return;
  }
  if (state.value === null) {
    const placeholder = document.createElement('p');
    placeholder.className = 'data-editor__placeholder';
    placeholder.textContent = 'Le JSON est invalide : corrigez-le dans l’onglet JSON.';
    el.formPanel.appendChild(placeholder);
    return;
  }
  const schema = state.schemas[state.current.kind];
  const spec = schema ? schema.root : inferSpec(state.value);
  el.formPanel.appendChild(buildControl(state.value, spec, []));
}

/**
 * Paints the list of diagnostics.
 *
 * @returns {void}
 */
function renderDiagnostics() {
  el.diagnosticList.textContent = '';
  const errors = state.diagnostics.filter((entry) => entry.severity === 'error').length;
  const warnings = state.diagnostics.length - errors;
  el.count.textContent =
    state.diagnostics.length === 0 ? 'aucun' : `${errors} erreur(s), ${warnings} avertissement(s)`;

  if (state.diagnostics.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'data-editor__list-empty';
    empty.textContent = 'Rien à signaler.';
    el.diagnosticList.appendChild(empty);
    return;
  }

  state.diagnostics.forEach((entry) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `data-editor__diagnostic ${
      entry.severity === 'error' ? 'data-editor__diagnostic--error' : 'data-editor__diagnostic--warning'
    }`;
    const position = document.createElement('span');
    position.className = 'data-editor__diagnostic-position';
    position.textContent = `${entry.line}:${entry.column}`;
    const message = document.createElement('span');
    message.textContent = entry.message;
    button.append(position, message);
    button.addEventListener('click', () => {
      setMode('json');
      selectLine(entry.line);
    });
    item.appendChild(button);
    el.diagnosticList.appendChild(item);
  });
}

/**
 * Enables the save button only when the buffer was validated without an error.
 *
 * @returns {void}
 */
function updateSaveState() {
  const errors = state.diagnostics.filter((entry) => entry.severity === 'error').length;
  const sameBuffer = currentText() === state.validatedText && state.validatedText !== '';
  // No automatic validation: the button stays available while the buffer is dirty, and the server
  // refuses a save the linter would reject (it validates the exact bytes it is about to write).
  el.save.disabled = state.saving || state.validating || !state.current || !state.dirty;
  if (!state.dirty) setStatus('Aucune modification.');
  else if (state.validating) setStatus('Vérification par le lint…');
  else if (sameBuffer && errors > 0) setStatus('Enregistrement bloqué : le lint refuse ce contenu.');
  else if (sameBuffer) setStatus('Validé par le lint, prêt à enregistrer.');
  else setStatus('Modifications non vérifiées : « Vérifier » ou « Enregistrer » lance le lint.');
}

/**
 * Schedules a validation run after the current burst of edits.
 *
 * @returns {void}
 */
function markDirty() {
  state.dirty = true;
  state.diagnostics = [];
  state.validatedText = '';
  updateSaveState();
}

/**
 * Asks the server to validate the buffer without writing the file.
 *
 * @returns {Promise<void>} Resolves once the diagnostics are painted.
 */
async function validateNow() {
  if (!state.current || state.validating) return;
  const text = currentText();
  showFeedback('Vérification par le lint…', 'info');
  state.validating = true;
  updateSaveState();
  try {
    const result = await api('/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: state.current.path, content: text }),
    });
    state.diagnostics = Array.isArray(result.diagnostics) ? result.diagnostics : [];
    state.validatedText = text;
  } catch (error) {
    showFeedback(error.message, 'error');
    state.diagnostics = [];
    state.validatedText = '';
  } finally {
    state.validating = false;
    renderDiagnostics();
    updateSaveState();
  }
}

/**
 * Saves the buffer once the server accepts it.
 *
 * @returns {Promise<void>} Resolves once the save finished.
 */
async function saveFile() {
  if (!state.current || state.saving) return;
  const text = currentText();
  state.saving = true;
  updateSaveState();
  showFeedback('Enregistrement et vérification…', 'info');
  try {
    const result = await api('/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: state.current.path, content: text }),
    });
    state.diagnostics = Array.isArray(result.diagnostics) ? result.diagnostics : [];
    state.validatedText = result.content ?? text;
    if (result.saved) {
      state.text = result.content ?? text;
      state.dirty = false;
      try {
        state.value = JSON.parse(state.text);
      } catch (error) {
        state.value = null;
      }
      el.code.value = state.text;
      refreshGutter();
      if (state.mode === 'form') renderForm();
      showFeedback('Fichier enregistré.', 'success');
    } else {
      showFeedback('Enregistrement refusé : le lint signale des erreurs, le fichier est intact.', 'error');
    }
  } catch (error) {
    showFeedback(error.message, 'error');
  } finally {
    state.saving = false;
    renderDiagnostics();
    updateSaveState();
  }
}

/**
 * Switches between the form and the raw JSON view.
 *
 * @param {'form'|'json'} mode - Target view.
 * @returns {void}
 */
function setMode(mode) {
  if (mode === state.mode) return;
  if (mode === 'form') {
    // An empty buffer is not broken JSON: it is the state of the page before a file is loaded
    // (or when the server could not be reached). Only a non-empty buffer is parsed here.
    const raw = el.code.value;
    if (raw.trim() !== '') {
      try {
        state.value = JSON.parse(raw);
        state.text = raw;
      } catch (error) {
        showFeedback('JSON invalide : le formulaire ne peut pas être construit.', 'error');
        return;
      }
    }
    renderForm();
  } else {
    el.code.value = currentText();
    refreshGutter();
  }
  state.mode = mode;
  el.tabForm.classList.toggle('is-active', mode === 'form');
  el.tabJson.classList.toggle('is-active', mode === 'json');
  el.tabForm.setAttribute('aria-selected', String(mode === 'form'));
  el.tabJson.setAttribute('aria-selected', String(mode === 'json'));
  el.formPanel.hidden = mode !== 'form';
  el.jsonPanel.hidden = mode !== 'json';
  if (mode === 'json') {
    refreshGutter();
    el.code.focus();
  }
}

/**
 * Paints the file list, filtered by the sidebar search.
 *
 * @returns {void}
 */
function renderFileList() {
  const term = el.filter.value.trim().toLowerCase();
  el.files.textContent = '';
  const groups = new Map();
  state.files.forEach((file) => {
    const haystack = `${file.path} ${file.kindLabel}`.toLowerCase();
    if (term !== '' && !haystack.includes(term)) return;
    if (!groups.has(file.kind)) groups.set(file.kind, []);
    groups.get(file.kind).push(file);
  });
  groups.forEach((files) => {
    const label = document.createElement('li');
    label.className = 'data-editor__group-label';
    label.textContent = files[0].kindLabel;
    el.files.appendChild(label);
    files.forEach((file) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'data-editor__file-button';
      if (state.current?.path === file.path) button.classList.add('is-active');
      button.textContent = file.setId ? `${file.setId}` : file.path.split('/').pop();
      const path = document.createElement('span');
      path.className = 'data-editor__file-path';
      path.textContent = file.path;
      button.appendChild(path);
      button.addEventListener('click', () => {
        if (state.dirty && !window.confirm('Abandonner les modifications non enregistrées ?')) return;
        void openFile(file);
      });
      item.appendChild(button);
      el.files.appendChild(item);
    });
  });
}

/**
 * Loads one file from the disk and paints both views.
 *
 * @param {object} file - File descriptor of `/api/bootstrap`.
 * @returns {Promise<void>} Resolves once the page shows the file.
 */
async function openFile(file) {
  showFeedback('', 'info');
  try {
    const payload = await api(`/file?path=${encodeURIComponent(file.path)}`);
    state.current = { ...file, setId: payload.setId ?? file.setId };
    state.text = payload.content;
    state.value = payload.value;
    state.dirty = false;
    state.diagnostics = [];
    state.validatedText = '';
    el.code.value = state.text;
    el.fileName.textContent = file.path;
    el.description.textContent = file.description ?? '';
    refreshGutter();
    renderFileList();
    renderForm();
    renderDiagnostics();
    if (state.mode === 'json') refreshGutter();
    updateSaveState();
    await validateNow();
    showFeedback('', 'info');
  } catch (error) {
    showFeedback(error.message, 'error');
  }
}

/**
 * Reloads the open file, discarding the buffer.
 *
 * @returns {void}
 */
function revertFile() {
  if (!state.current) return;
  if (state.dirty && !window.confirm('Recharger le fichier et perdre les modifications ?')) return;
  void openFile(state.current);
}

/**
 * Paints the line-number gutter.
 *
 * @returns {void}
 */
function refreshGutter() {
  const lines = el.code.value.split('\n').length;
  const numbers = [];
  for (let index = 1; index <= lines; index += 1) numbers.push(index);
  el.gutter.textContent = numbers.join('\n');
  el.gutter.scrollTop = el.code.scrollTop;
}

/**
 * Selects one line of the raw editor and scrolls to it.
 *
 * @param {number} line - 1-based line number.
 * @returns {void}
 */
function selectLine(line) {
  const lines = el.code.value.split('\n');
  const target = Math.min(lines.length, Math.max(1, line));
  let start = 0;
  for (let index = 0; index < target - 1; index += 1) start += lines[index].length + 1;
  el.code.focus();
  el.code.setSelectionRange(start, start + lines[target - 1].length);
  el.code.scrollTop = Math.max(0, (target - 4) * 20);
  refreshGutter();
}

/**
 * Computes the JSON path at a position of the raw text.
 *
 * Arrays are represented by `null` tokens, so `TrophyList[2].Name` reads `['TrophyList', null,
 * 'Name']` and the schema can be resolved without knowing the index.
 *
 * @param {string} text - Whole document.
 * @param {number} position - Caret offset.
 * @returns {{tokens: Array<string|null>, key: string|null}} The path to the enclosing value and the
 *   key being written, when the caret is inside a string.
 */
function jsonPathAt(text, position) {
  const stack = [{ type: 'object', key: null }];
  let inString = false;
  let stringStart = 0;
  let pendingKey = null;
  let currentKey = null;
  const source = text.slice(0, position);

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === '"') {
        const token = source.slice(stringStart + 1, index);
        if (/^\s*:/.test(source.slice(index + 1))) pendingKey = token;
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      stringStart = index;
      continue;
    }
    if (char === '{' || char === '[') {
      stack.push({ type: char === '{' ? 'object' : 'array', key: pendingKey });
      pendingKey = null;
      continue;
    }
    if (char === '}' || char === ']') {
      stack.pop();
      pendingKey = null;
      continue;
    }
    if (char === ',') pendingKey = null;
  }

  const tokens = [];
  stack.forEach((frame, index) => {
    if (index === 0) return;
    if (frame.type === 'array') tokens.push(null);
    else if (frame.key !== null) tokens.push(frame.key);
  });

  if (inString) {
    const match = /"([^"]+)"\s*:\s*$/.exec(source.slice(0, stringStart));
    currentKey = match ? match[1] : null;
  }
  return { tokens, key: currentKey };
}

/**
 * Resolves the schema node of a path.
 *
 * @param {Array<string|null>} tokens - Path tokens (`null` for an array element).
 * @returns {object|null} The schema node, or null when the schema stops earlier.
 */
function resolveSpec(tokens) {
  if (!state.current) return null;
  const schema = state.schemas[state.current.kind];
  let spec = schema ? schema.root : null;
  for (const token of tokens) {
    if (!spec) return null;
    if (token === null) {
      spec = spec.item ?? null;
      continue;
    }
    if (Array.isArray(spec.fields)) {
      spec = spec.fields.find((field) => field.key === token) ?? null;
    } else if (spec.type === 'map') {
      spec = { type: spec.valueType ?? 'integer', source: spec.source };
    } else if (spec.type === 'localized') {
      spec = { type: 'string' };
    } else {
      spec = null;
    }
  }
  return spec ?? null;
}

/**
 * Builds the completion candidates for the current caret.
 *
 * @returns {{items: object[], start: number, kind: string}} Candidates, replacement start, context.
 */
function completionContext() {
  const text = el.code.value;
  const caret = el.code.selectionStart;
  const lineStart = text.lastIndexOf('\n', Math.max(0, caret - 1)) + 1;
  const before = text.slice(0, caret);
  const quotes = (before.slice(lineStart).match(/(?:^|[^\\])"/g) ?? []).length;
  const insideString = quotes % 2 === 1;

  if (!insideString) {
    return { items: [], start: caret, kind: 'none' };
  }

  const quoteStart = before.lastIndexOf('"');
  const prefix = before.slice(quoteStart + 1);
  if (/[\n"]/.test(prefix)) return { items: [], start: caret, kind: 'none' };

  const beforeQuote = before.slice(0, quoteStart).replace(/\s+$/, '');
  const tokens = jsonPathAt(text, quoteStart).tokens;
  const spec = resolveSpec(tokens);
  const isValue = beforeQuote.endsWith(':');
  const lower = prefix.toLowerCase();

  if (!isValue) {
    const keys = Array.isArray(spec?.fields)
      ? spec.fields.map((field) => ({ label: field.key, detail: field.label ?? '', insert: `${field.key}": ` }))
      : [];
    if (spec?.type === 'map') {
      suggestionValues({ type: 'string', source: spec.source }).forEach((key) => {
        keys.push({ label: key, detail: 'clé', insert: `${key}": ` });
      });
    }
    return {
      items: keys.filter((item) => item.label.toLowerCase().includes(lower)).slice(0, COMPLETION_LIMIT),
      start: quoteStart + 1,
      kind: 'key',
    };
  }

  const match = /"([^"]+)"\s*:\s*$/.exec(beforeQuote);
  const key = match ? match[1] : null;
  let fieldSpec = null;
  if (Array.isArray(spec?.fields) && key) {
    fieldSpec = spec.fields.find((field) => field.key === key) ?? null;
  } else if (spec?.type === 'map') {
    fieldSpec = { type: spec.valueType ?? 'integer', source: spec.source };
  }
  const values = suggestionValues(fieldSpec).map((value) => ({
    label: String(value),
    detail: fieldSpec?.type ?? '',
    insert: String(value),
  }));
  return {
    items: values.filter((item) => item.label.toLowerCase().includes(lower)).slice(0, COMPLETION_LIMIT),
    start: quoteStart + 1,
    kind: 'value',
  };
}

/**
 * Hides the completion popup.
 *
 * @returns {void}
 */
function hideCompletion() {
  state.completion = { items: [], index: 0, start: 0, kind: 'none' };
  el.completion.hidden = true;
  el.completion.textContent = '';
}

/**
 * Measures where the caret sits in the code area, to place the popup.
 *
 * @returns {{left: number, top: number}} Coordinates relative to the code wrapper.
 */
function caretPosition() {
  const mirror = document.createElement('div');
  const style = window.getComputedStyle(el.code);
  const properties = [
    'fontFamily',
    'fontSize',
    'lineHeight',
    'padding',
    'borderWidth',
    'letterSpacing',
    'whiteSpace',
    'tabSize',
  ];
  properties.forEach((property) => {
    mirror.style[property] = style[property];
  });
  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.top = '0';
  mirror.style.left = '0';
  mirror.style.whiteSpace = 'pre';
  mirror.textContent = el.code.value.slice(0, el.code.selectionStart);
  const marker = document.createElement('span');
  marker.textContent = '\u200b';
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const rect = marker.getBoundingClientRect();
  const wrap = el.codeWrap.getBoundingClientRect();
  const result = {
    left: rect.left - wrap.left - el.code.scrollLeft,
    top: rect.top - wrap.top - el.code.scrollTop + rect.height,
  };
  mirror.remove();
  return result;
}

/**
 * Shows the completion popup with the current candidates.
 *
 * @param {boolean} [force=false] - Show the list even with an empty prefix.
 * @returns {void}
 */
function updateCompletion(force = false) {
  if (state.mode !== 'json') return;
  const context = completionContext();
  if (context.items.length === 0 || (context.kind === 'none' && !force)) {
    hideCompletion();
    return;
  }
  state.completion = { items: context.items, index: 0, start: context.start, kind: context.kind };
  const position = caretPosition();
  el.completion.style.left = `${Math.max(0, position.left)}px`;
  el.completion.style.top = `${position.top}px`;
  el.completion.textContent = '';
  context.items.forEach((item, index) => {
    const entry = document.createElement('li');
    entry.className = `data-editor__completion-item${index === 0 ? ' is-selected' : ''}`;
    const label = document.createElement('span');
    label.textContent = item.label;
    const kind = document.createElement('span');
    kind.className = 'data-editor__completion-kind';
    kind.textContent = item.detail;
    entry.append(label, kind);
    entry.addEventListener('mousedown', (event) => {
      event.preventDefault();
      applyCompletion(index);
    });
    el.completion.appendChild(entry);
  });
  el.completion.hidden = false;
}

/**
 * Writes one completion into the buffer.
 *
 * @param {number} index - Candidate index.
 * @returns {void}
 */
function applyCompletion(index) {
  const item = state.completion.items[index];
  if (!item) return;
  const text = el.code.value;
  const caret = el.code.selectionStart;
  const closing = state.completion.kind === 'value' && text[caret] !== '"' ? '"' : '';
  const next = `${text.slice(0, state.completion.start)}${item.insert}${closing}${text.slice(caret)}`;
  el.code.value = next;
  const position = state.completion.start + item.insert.length + closing.length;
  el.code.setSelectionRange(position, position);
  hideCompletion();
  handleCodeInput();
}

/**
 * Moves the selection inside the completion list.
 *
 * @param {number} direction - -1 up, 1 down.
 * @returns {void}
 */
function moveCompletion(direction) {
  const count = state.completion.items.length;
  if (count === 0) return;
  state.completion.index = (state.completion.index + direction + count) % count;
  [...el.completion.children].forEach((child, index) => {
    child.classList.toggle('is-selected', index === state.completion.index);
  });
  const selected = el.completion.children[state.completion.index];
  if (selected) selected.scrollIntoView({ block: 'nearest' });
}

/**
 * Reads the raw editor after an edit.
 *
 * @returns {void}
 */
function handleCodeInput() {
  state.text = el.code.value;
  state.value = null;
  refreshGutter();
  markDirty();
  updateCompletion();
}

/**
 * Indents or outdents the selected lines of the raw editor.
 *
 * @param {boolean} outdent - True to remove one indentation level.
 * @returns {void}
 */
function indentSelection(outdent) {
  const text = el.code.value;
  const { selectionStart, selectionEnd } = el.code;
  const lineStart = text.lastIndexOf('\n', selectionStart - 1) + 1;
  const block = text.slice(lineStart, selectionEnd);
  const shifted = block
    .split('\n')
    .map((line) => (outdent ? line.replace(/^ {1,2}/, '') : `  ${line}`))
    .join('\n');
  el.code.value = `${text.slice(0, lineStart)}${shifted}${text.slice(selectionEnd)}`;
  el.code.setSelectionRange(lineStart, lineStart + shifted.length);
  handleCodeInput();
}

/**
 * Handles the keyboard shortcuts of the raw editor.
 *
 * @param {KeyboardEvent} event - Key event.
 * @returns {void}
 */
function handleCodeKeydown(event) {
  const open = !el.completion.hidden;
  if (open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
    event.preventDefault();
    moveCompletion(event.key === 'ArrowDown' ? 1 : -1);
    return;
  }
  if (open && (event.key === 'Enter' || event.key === 'Tab')) {
    event.preventDefault();
    applyCompletion(state.completion.index);
    return;
  }
  if (event.key === 'Escape') {
    hideCompletion();
    return;
  }
  if (event.key === 'Tab') {
    event.preventDefault();
    indentSelection(event.shiftKey);
    return;
  }
  if (event.key === 'Enter') {
    const text = el.code.value;
    const caret = el.code.selectionStart;
    const lineStart = text.lastIndexOf('\n', caret - 1) + 1;
    const indent = /^\s*/.exec(text.slice(lineStart, caret))[0];
    const opensBlock = /[{[]\s*$/.test(text.slice(lineStart, caret));
    const closing = /^\s*[}\]]/.test(text.slice(caret));
    const insertion = `\n${indent}${opensBlock ? '  ' : ''}${closing && opensBlock ? `\n${indent}` : ''}`;
    event.preventDefault();
    el.code.value = `${text.slice(0, caret)}${insertion}${text.slice(caret)}`;
    const position = caret + insertion.length - (closing && opensBlock ? indent.length + 1 : 0);
    el.code.setSelectionRange(position, position);
    handleCodeInput();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key === ' ') {
    event.preventDefault();
    updateCompletion(true);
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
    event.preventDefault();
    el.search.focus();
    el.search.select();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    void saveFile();
  }
}

/**
 * Collects the leaf fields of a schema, with a readable path.
 *
 * @param {object|null} spec - Schema node.
 * @param {string[]} path - Path so far.
 * @param {object[]} out - Accumulator.
 * @returns {object[]} The fields.
 */
function flattenSchema(spec, path, out) {
  if (!spec) return out;
  if (Array.isArray(spec.fields)) {
    spec.fields.forEach((field) => {
      const next = [...path, field.key];
      out.push({ key: field.key, path: next.join('.'), label: field.label ?? field.key, type: field.type });
      flattenSchema(field, next, out);
      if (field.item) flattenSchema(field.item, [...next, '[]'], out);
    });
  }
  if (spec.item) flattenSchema(spec.item, [...path, '[]'], out);
  return out;
}

/**
 * Recomputes the literal search matches.
 *
 * @returns {void}
 */
function updateSearch() {
  const term = el.search.value;
  state.search = { term, matches: [], index: -1 };
  if (term.length >= 2) {
    const haystack = el.code.value.toLowerCase();
    const needle = term.toLowerCase();
    let position = haystack.indexOf(needle);
    while (position >= 0 && state.search.matches.length < 500) {
      state.search.matches.push(position);
      position = haystack.indexOf(needle, position + needle.length);
    }
  }
  if (state.search.matches.length > 0) {
    state.search.index = 0;
    focusMatch();
  } else {
    el.searchCount.textContent = term.length >= 2 ? '0 / 0' : '';
  }
  renderSmartMatches();
}

/**
 * Paints the schema fields whose key, label or path matches the search.
 *
 * @returns {void}
 */
function renderSmartMatches() {
  el.searchList.textContent = '';
  const term = state.search.term.trim().toLowerCase();
  if (term.length < 2 || !state.current) {
    el.searchList.hidden = true;
    return;
  }
  const schema = state.schemas[state.current.kind];
  const fields = flattenSchema(schema ? schema.root : null, [], []).filter(
    (field) =>
      field.key.toLowerCase().includes(term) ||
      field.label.toLowerCase().includes(term) ||
      field.path.toLowerCase().includes(term)
  );
  if (fields.length === 0) {
    el.searchList.hidden = true;
    return;
  }
  fields.slice(0, 12).forEach((field) => {
    const item = document.createElement('li');
    item.className = 'data-editor__match';
    const label = document.createElement('span');
    label.textContent = `${field.label} `;
    const path = document.createElement('span');
    path.className = 'data-editor__match-path';
    path.textContent = field.path;
    item.append(label, path);
    item.addEventListener('click', () => {
      el.search.value = `"${field.key}"`;
      updateSearch();
    });
    el.searchList.appendChild(item);
  });
  el.searchList.hidden = false;
}

/**
 * Selects the current search match in the raw editor.
 *
 * @returns {void}
 */
function focusMatch() {
  const { matches, index, term } = state.search;
  if (matches.length === 0 || index < 0) {
    el.searchCount.textContent = '0 / 0';
    return;
  }
  const start = matches[index];
  el.code.focus();
  el.code.setSelectionRange(start, start + term.length);
  el.code.scrollTop = Math.max(0, (el.code.value.slice(0, start).split('\n').length - 4) * 20);
  refreshGutter();
  el.searchCount.textContent = `${index + 1} / ${matches.length}`;
}

/**
 * Moves to the next or previous search match.
 *
 * @param {number} direction - 1 forward, -1 backward.
 * @returns {void}
 */
function moveSearch(direction) {
  if (state.search.matches.length === 0) return;
  const count = state.search.matches.length;
  state.search.index = (state.search.index + direction + count) % count;
  focusMatch();
}

/**
 * Wires the static elements of the page.
 *
 * @returns {void}
 */
function bindEvents() {
  el.filter.addEventListener('input', () => renderFileList());
  el.tabForm.addEventListener('click', () => setMode('form'));
  el.tabJson.addEventListener('click', () => setMode('json'));
  el.revert.addEventListener('click', () => revertFile());
  el.check.addEventListener('click', () => void validateNow());
  el.save.addEventListener('click', () => void saveFile());

  el.code.addEventListener('input', () => handleCodeInput());
  el.code.addEventListener('keydown', (event) => handleCodeKeydown(event));
  el.code.addEventListener('scroll', () => {
    el.gutter.scrollTop = el.code.scrollTop;
    hideCompletion();
  });
  el.code.addEventListener('blur', () => window.setTimeout(() => hideCompletion(), 120));

  el.search.addEventListener('input', () => updateSearch());
  el.search.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      moveSearch(event.shiftKey ? -1 : 1);
    }
    if (event.key === 'Escape') el.code.focus();
  });
  el.searchNext.addEventListener('click', () => moveSearch(1));
  el.searchPrev.addEventListener('click', () => moveSearch(-1));

  window.addEventListener('beforeunload', (event) => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });
}

/**
 * Starts the page: reads everything the server knows and opens the first file.
 *
 * @returns {Promise<void>} Resolves once the page is painted.
 */
async function boot() {
  el.filter = pick('[data-de-filter]');
  el.files = pick('[data-de-files]');
  el.fileName = pick('[data-de-file]');
  el.description = pick('[data-de-description]');
  el.project = pick('[data-de-project]');
  el.feedback = pick('[data-de-feedback]');
  el.formPanel = pick('[data-de-form-panel]');
  el.jsonPanel = pick('[data-de-json-panel]');
  el.tabForm = pick('[data-de-tab="form"]');
  el.tabJson = pick('[data-de-tab="json"]');
  el.revert = pick('[data-de-revert]');
  el.check = pick('[data-de-check]');
  el.save = pick('[data-de-save]');
  el.count = pick('[data-de-count]');
  el.diagnosticList = pick('[data-de-diagnostic-list]');
  el.status = pick('[data-de-status]');
  el.code = pick('[data-de-code]');
  el.codeWrap = el.code.closest('.data-editor__code-wrap');
  el.gutter = pick('[data-de-gutter]');
  el.completion = pick('[data-de-completion]');
  el.search = pick('[data-de-search]');
  el.searchCount = pick('[data-de-search-count]');
  el.searchList = pick('[data-de-search-list]');
  el.searchNext = pick('[data-de-search-next]');
  el.searchPrev = pick('[data-de-search-prev]');
  el.sources = pick('[data-de-sources]');

  bindEvents();

  try {
    const payload = await api('/bootstrap');
    state.files = payload.files ?? [];
    state.schemas = payload.schemas ?? {};
    state.suggestions = payload.suggestions ?? {};
    el.project.textContent = `Projet : ${payload.root} · serveur local (127.0.0.1)`;
    renderFileList();
    if (state.files.length === 0) {
      showFeedback('Aucun fichier de données trouvé.', 'warning');
      return;
    }
    await openFile(state.files[0]);
  } catch (error) {
    showFeedback(error.message, 'error');
    el.project.textContent = 'Serveur local injoignable.';
  }
}

void boot();

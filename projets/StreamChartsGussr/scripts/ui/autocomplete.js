/**
 * Autocompletion partagee pour les modes a saisie libre (Time, ...).
 *
 * La liste de suggestions est pilotee par une fonction de recherche
 * insensible a la casse et aux accents, inter-mots, correspondance exacte
 * en premier. Le filtre n'est applique que 0,5 s apres la derniere frappe
 * (debounce) pour eviter de rame lors de la saisie ; la navigation clavier
 * (fleches, Entree, Echap) reste immediate.
 */
import { el } from './dom.js';

const SUGGESTION_LIMIT = 8;
const SUGGESTION_DELAY = 500;

/**
 * Branche l'autocompletion sur un champ et sa liste vide.
 *
 * @param {HTMLInputElement} input
 * @param {HTMLUListElement} list  - element <ul> cree avec la classe autocomplete-list
 * @param {string} itemId          - prefixe des id des options (ex. "timeSuggestion")
 * @param {(query: string) => string[]} search - renvoie les noms correspondants
 * @returns {{ hide(): void, refresh(): void }}
 */
export function attachAutocomplete({ input, list, itemId, search }) {
  let nodes = [];
  let active = -1;
  let timer = null;

  input.addEventListener('input', schedule);
  input.addEventListener('blur', hide);

  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      // Navigation clavier : le filtre en attente est applique immediatement.
      event.preventDefault();
      refresh();
      move(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (list.hidden) return;
    if (event.key === 'Enter' && active >= 0) {
      // Entree selectionne la suggestion mise en avant au lieu de valider.
      event.preventDefault();
      pick(active);
    } else if (event.key === 'Escape') {
      hide();
    }
  });

  return { hide, refresh };

  function schedule() {
    clearTimeout(timer);
    if (!input.value.trim()) {
      hide();
      return;
    }
    timer = setTimeout(refresh, SUGGESTION_DELAY);
  }

  function refresh() {
    clearTimeout(timer);
    const names = search(input.value).slice(0, SUGGESTION_LIMIT);
    nodes = [];
    active = -1;
    list.replaceChildren();
    if (!names.length) {
      hide();
      return;
    }
    names.forEach((name, index) => {
      const item = el('li', {
        className: 'autocomplete-item',
        attrs: { role: 'option', id: `${itemId}-${index}` },
        text: name,
      });
      item.addEventListener('mousedown', (event) => {
        event.preventDefault(); // evite le blur de l'input avant le clic
        pick(index);
      });
      list.append(item);
      nodes.push(item);
    });
    list.hidden = false;
  }

  function move(step) {
    if (!nodes.length) return;
    const next = (active + step + nodes.length) % nodes.length;
    setActive(next);
  }

  function setActive(index) {
    if (active >= 0 && nodes[active]) {
      nodes[active].classList.remove('is-active');
      nodes[active].removeAttribute('aria-selected');
    }
    active = index;
    const node = nodes[index];
    node.classList.add('is-active');
    node.setAttribute('aria-selected', 'true');
    node.scrollIntoView({ block: 'nearest' });
  }

  function pick(index) {
    input.value = nodes[index].textContent;
    hide();
    input.focus();
  }

  function hide() {
    clearTimeout(timer);
    list.hidden = true;
    nodes = [];
    active = -1;
  }
}
/**
 * Vue du mode Top : une grille de cartes en noir et blanc, un champ de saisie
 * avec autocompletion maison (insensible a la casse et aux accents, recherche
 * inter-mots, correspondance exacte proposee en premier, filtre recalcule
 * 0,5 s apres la derniere frappe), des boutons Indice et Abandonner, puis un
 * recapitulatif de fin de partie.
 */
import TopGame from '../business/top-game.js';
import { t } from './i18n.js';
import { el, applyGameImage, formatHours } from './dom.js';
import { play, shake, pop, pulse, revealIndexed } from './animations.js';
import { buildTopShell, normalizeName } from './top-shell.js';
import { toast } from './toast.js';

const SUGGESTION_LIMIT = 8;
const SUGGESTION_DELAY = 100; // debounce : filtre applique peu apres la derniere frappe

export function createTopView(root, entries, difficulty, extraSuggestions = []) {
  const game = new TopGame(entries, difficulty, extraSuggestions);
  const cardNodes = new Map();

  root.hidden = false;
  root.replaceChildren();
  root.append(buildTopShell());

  const dom = {
    progressValue: document.getElementById('topProgressValue'),
    progressTotal: document.getElementById('topProgressTotal'),
    progressBar: document.getElementById('topProgressBar'),
    grid: document.getElementById('topGrid'),
    form: document.getElementById('topForm'),
    input: document.getElementById('topInput'),
    suggestions: document.getElementById('topSuggestionsList'),
    submitBtn: document.getElementById('topSubmit'),
    hintBtn: document.getElementById('topHint'),
    giveUpBtn: document.getElementById('topGiveUp'),
    recap: document.getElementById('topRecap'),
    recapResult: document.getElementById('topRecapResult'),
    recapTitle: document.getElementById('topRecapTitle'),
    recapDesc: document.getElementById('topRecapDesc'),
    recapTime: document.getElementById('topRecapTime'),
    recapCorrect: document.getElementById('topRecapCorrect'),
    recapWrong: document.getElementById('topRecapWrong'),
    replayBtn: document.getElementById('topReplay'),
    viewResultBtn: document.getElementById('topViewResult'),
  };

  let suggestionNodes = [];
  let activeSuggestion = -1;
  let suggestionTimer = null;
  let finalSeconds = 0;
  let confirmTimer = null;

  renderGrid();
  renderProgress();

  /* --------------------------- Evenements --------------------------- */

  dom.form.addEventListener('submit', (event) => {
    event.preventDefault();
    submitGuess();
  });

  dom.input.addEventListener('input', scheduleSuggestions);
  dom.input.addEventListener('blur', hideSuggestions);

  dom.input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      // Navigation clavier : le filtre en attente est applique immediatement.
      event.preventDefault();
      updateSuggestions();
      moveActiveSuggestion(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (dom.suggestions.hidden) return;
    if (event.key === 'Enter' && activeSuggestion >= 0) {
      // Entrée sélectionne la suggestion mise en avant au lieu de valider.
      event.preventDefault();
      pickSuggestion(activeSuggestion);
    } else if (event.key === 'Escape') {
      hideSuggestions();
    }
  });

  dom.hintBtn.addEventListener('click', giveHint);

  // Abandon en deux clics pour eviter les fausses manipulations.
  dom.giveUpBtn.addEventListener('click', () => {
    if (game.isOver) return;
    if (!dom.giveUpBtn.classList.contains('is-confirming')) {
      dom.giveUpBtn.classList.add('is-confirming');
      dom.giveUpBtn.textContent = t('top.giveUpConfirm');
      confirmTimer = setTimeout(resetGiveUpButton, 3000);
      return;
    }
    giveUp();
  });
  dom.giveUpBtn.addEventListener('blur', resetGiveUpButton);

  dom.replayBtn.addEventListener('click', replay);
  dom.viewResultBtn.addEventListener('click', showResult);

  /* ----------------------------- Rendu ------------------------------ */

  function renderGrid() {
    dom.grid.replaceChildren();
    cardNodes.clear();
    game.targets.forEach((entry, index) => {
      const card = el('div', { className: 'top-card', attrs: { 'data-name': entry.name } });
      const rank = el('span', { className: 'top-card-rank', text: '#' + (index + 1) });
      const art = el('img', { className: 'top-card-art', attrs: { alt: '', loading: 'lazy' } });
      applyGameImage(art, entry.boxArtUrl);
      const hint = el('span', { className: 'top-card-hint', attrs: { 'aria-hidden': 'true' } });
      const nameEl = el('span', { className: 'top-card-name' });
      const timeEl = el('span', { className: 'top-card-time' });
      card.append(rank, art, hint, nameEl, timeEl);
      dom.grid.append(card);
      cardNodes.set(normalizeName(entry.name), { card, name: nameEl, time: timeEl, hint, entry });
    });
  }

  function renderProgress() {
    dom.progressValue.textContent = String(game.progress);
    dom.progressTotal.textContent = String(game.total);
    dom.progressBar.style.width = (game.progress / game.total) * 100 + '%';
  }

  function resetCards() {
    cardNodes.forEach(({ card, name, time, hint }) => {
      card.classList.remove('is-found', 'is-hinted', 'is-revealed');
      name.textContent = '';
      time.textContent = '';
      hint.textContent = '';
    });
  }

  /* ------------------------- Autocompletion ------------------------- */

  function updateSuggestions() {
    clearTimeout(suggestionTimer);
    const matches = game.search(dom.input.value).slice(0, SUGGESTION_LIMIT);
    suggestionNodes = [];
    activeSuggestion = -1;
    dom.suggestions.replaceChildren();
    if (!matches.length) {
      hideSuggestions();
      return;
    }
    matches.forEach((name, index) => {
      const item = el('li', {
        className: 'top-suggestion',
        attrs: { role: 'option', id: `topSuggestion-${index}` },
        text: name,
      });
      item.addEventListener('mousedown', (event) => {
        event.preventDefault(); // evite le blur de l'input avant le clic
        pickSuggestion(index);
      });
      dom.suggestions.append(item);
      suggestionNodes.push(item);
    });
    dom.suggestions.hidden = false;
  }

  function moveActiveSuggestion(step) {
    if (!suggestionNodes.length) return;
    const next = (activeSuggestion + step + suggestionNodes.length) % suggestionNodes.length;
    setActiveSuggestion(next);
  }

  function setActiveSuggestion(index) {
    if (activeSuggestion >= 0 && suggestionNodes[activeSuggestion]) {
      suggestionNodes[activeSuggestion].classList.remove('is-active');
      suggestionNodes[activeSuggestion].removeAttribute('aria-selected');
    }
    activeSuggestion = index;
    const node = suggestionNodes[index];
    node.classList.add('is-active');
    node.setAttribute('aria-selected', 'true');
    node.scrollIntoView({ block: 'nearest' });
  }

  function pickSuggestion(index) {
    dom.input.value = suggestionNodes[index].textContent;
    hideSuggestions();
    dom.input.focus();
  }

  /** Debounce : recalcule la liste seulement 0,5 s apres la derniere frappe. */
  function scheduleSuggestions() {
    clearTimeout(suggestionTimer);
    if (!dom.input.value.trim()) {
      hideSuggestions();
      return;
    }
    suggestionTimer = setTimeout(updateSuggestions, SUGGESTION_DELAY);
  }

  function hideSuggestions() {
    // Annule tout filtre en attente : la liste ne doit pas ressusciter
    // apres un blur, un Escape, une validation ou une fin de partie.
    clearTimeout(suggestionTimer);
    dom.suggestions.hidden = true;
    suggestionNodes = [];
    activeSuggestion = -1;
  }

  /* ------------------------------ Jeu ------------------------------- */

  function submitGuess() {
    if (game.isOver) return;
    const result = game.guess(dom.input.value);
    dom.input.value = '';
    hideSuggestions();
    if (result.status === 'invalid') {
      shake(dom.input);
      return;
    }
    switch (result.status) {
      case 'found':
        revealCard(result.game);
        renderProgress();
        toast(t('top.found', { name: result.game.name }), { tone: 'is-good' });
        pulse(dom.grid);
        if (game.isComplete) setTimeout(() => showRecap(true), 700);
        break;
      case 'already':
        toast(t('top.already'), { tone: 'is-warn' });
        break;
      case 'miss':
        if (result.streamed) {
          toast(t('top.notEnough', { rank: result.rank, hours: formatHours(result.game.hours) }), { tone: 'is-bad' });
        } else {
          toast(t('top.neverStreamed'), { tone: 'is-bad' });
        }
        shake(dom.input);
        break;
      default:
        shake(dom.input);
        break;
    }
  }

  function giveHint() {
    if (game.isOver) return;
    const hint = game.hint();
    if (!hint) {
      dom.hintBtn.disabled = true;
      return;
    }
    const node = cardNodes.get(normalizeName(hint.game.name));
    if (node) {
      node.hint.textContent = hint.letter;
      node.card.classList.add('is-hinted');
      pulse(node.card);
    }
    toast(t('top.hintUsed', { letter: hint.letter }), { tone: 'is-warn' });

    // Plus aucun indice disponible si tout le reste est deja trouve ou annonce.
    const noHintsLeft = game.targets.every((entry) => {
      const key = normalizeName(entry.name);
      return game.found.has(key) || game.hinted.has(key);
    });
    if (noHintsLeft) dom.hintBtn.disabled = true;
  }

  function giveUp() {
    if (game.isOver) return;
    game.abandon();
    toast(t('top.gaveUp'), { tone: 'is-bad' });
    showRecap(false);
  }

  /** Revele les jeux non trouves (carte en noir et blanc, titre en rouge). */
  function revealRemaining() {
    game.remaining.forEach((entry, index) => {
      const node = cardNodes.get(normalizeName(entry.name));
      if (!node) return;
      node.hint.textContent = '';
      node.card.classList.remove('is-hinted');
      node.card.classList.add('is-revealed');
      node.name.textContent = entry.name;
      node.time.textContent = formatHours(entry.hours) + ' h';
      revealIndexed(node.card, index);
    });
  }

  /** Ferme la popup recap et affiche la grille (la saisie reste desactivee). */
  function showResult() {
    if (game.abandoned) revealRemaining();
    dom.recap.hidden = true;
    dom.grid.hidden = false;
  }

  /* ----------------------------- Recap ------------------------------ */

  function showRecap(success) {
    finalSeconds = game.elapsedSeconds;
    dom.grid.hidden = true;
    hideSuggestions();
    dom.input.disabled = true;
    dom.submitBtn.disabled = true;
    dom.hintBtn.disabled = true;
    dom.giveUpBtn.disabled = true;
    resetGiveUpButton();

    dom.recapResult.textContent = t(success ? 'top.resultSuccess' : 'top.resultFailure');
    dom.recapResult.className = 'result-chip ' + (success ? 'is-success' : 'is-fail');
    dom.recapTitle.textContent = t(success ? 'top.won' : 'top.gaveUp');
    dom.recapDesc.textContent = t(success ? 'top.wonDesc' : 'top.gaveUpDesc');
    dom.recapTime.textContent = formatDuration(finalSeconds);
    dom.recapCorrect.textContent = String(game.correctGuesses);
    dom.recapWrong.textContent = String(game.wrongGuesses);
    dom.recap.hidden = false;
    pop(dom.recap);
  }

  function replay() {
    game.start();
    finalSeconds = 0;
    resetCards();
    renderProgress();
    dom.recap.hidden = true;
    dom.grid.hidden = false;
    hideSuggestions();
    dom.input.value = '';
    dom.input.disabled = false;
    dom.submitBtn.disabled = false;
    dom.hintBtn.disabled = false;
    dom.giveUpBtn.disabled = false;
    resetGiveUpButton();
    dom.input.focus();
  }

  function resetGiveUpButton() {
    clearTimeout(confirmTimer);
    dom.giveUpBtn.classList.remove('is-confirming');
    dom.giveUpBtn.textContent = t('top.giveUp');
  }

  function revealCard(entry) {
    const node = cardNodes.get(normalizeName(entry.name));
    if (!node) return;
    node.hint.textContent = '';
    node.card.classList.remove('is-hinted');
    node.card.classList.add('is-found');
    node.name.textContent = entry.name;
    node.time.textContent = formatHours(entry.hours) + ' h';
    play(node.card, 'anim-pop');
  }

  /** Duree lisible sous la forme m:ss (ex. 3:27). */
  function formatDuration(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }
}

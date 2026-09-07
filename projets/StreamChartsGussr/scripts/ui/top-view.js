/**
 * Vue du mode Top : une grille de cartes en noir et blanc, un input avec
 * autocompletion. Chaque bonne reponse allume sa carte (nom + temps reveles).
 * La progression est suivie jusqu'a trouver tout le top.
 */
import TopGame from '../business/top-game.js';
import { t } from './i18n.js';
import { el, applyGameImage, formatHours } from './dom.js';
import { play, shake, pop, pulse } from './animations.js';
import { buildTopShell, normalizeName } from './top-shell.js';

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
    datalist: document.getElementById('topSuggestions'),
    form: document.getElementById('topForm'),
    input: document.getElementById('topInput'),
    feedback: document.getElementById('topFeedback'),
    winPanel: document.getElementById('topWinPanel'),
    winCount: document.getElementById('topWinCount'),
    replayBtn: document.getElementById('topReplay'),
  };

  game.start();
  populateDatalist();
  renderGrid();
  renderProgress();

  dom.form.addEventListener('submit', (event) => {
    event.preventDefault();
    submitGuess();
  });

  dom.replayBtn.addEventListener('click', () => {
    game.start();
    resetCards();
    renderProgress();
    dom.winPanel.hidden = true;
    dom.grid.hidden = false;
    dom.input.value = '';
    dom.input.disabled = false;
    dom.input.focus();
  });

  function populateDatalist() {
    dom.datalist.replaceChildren();
    game.allNames.forEach((name) => {
      dom.datalist.append(el('option', { attrs: { value: name } }));
    });
  }

  function renderGrid() {
    dom.grid.replaceChildren();
    cardNodes.clear();
    game.targets.forEach((entry, index) => {
      const card = el('div', { className: 'top-card', attrs: { 'data-name': entry.name } });
      const rank = el('span', { className: 'top-card-rank', text: '#' + (index + 1) });
      const art = el('img', { className: 'top-card-art', attrs: { alt: '', loading: 'lazy' } });
      applyGameImage(art, entry.boxArtUrl);
      const nameEl = el('span', { className: 'top-card-name' });
      const timeEl = el('span', { className: 'top-card-time' });
      card.append(rank, art, nameEl, timeEl);
      dom.grid.append(card);
      cardNodes.set(normalizeName(entry.name), { card, name: nameEl, time: timeEl, entry });
    });
  }

  function renderProgress() {
    dom.progressValue.textContent = String(game.progress);
    dom.progressTotal.textContent = String(game.total);
    dom.progressBar.style.width = (game.progress / game.total) * 100 + '%';
  }

  function resetCards() {
    cardNodes.forEach(({ card, name, time }) => {
      card.classList.remove('is-found');
      name.textContent = '';
      time.textContent = '';
    });
  }

  function submitGuess() {
    if (game.isComplete) return;
    const raw = dom.input.value;
    const result = game.guess(raw);
    dom.input.value = '';
    if (!result) { shake(dom.input); return; }
    switch (result.status) {
      case 'found':
        revealCard(result.game);
        renderProgress();
        showFeedback('good', t('top.found', { name: result.game.name }));
        pulse(dom.grid);
        if (game.isComplete) setTimeout(showWin, 700);
        break;
      case 'already':
        showFeedback('warn', t('top.already'));
        break;
      case 'miss':
        showFeedback('bad', t('top.miss'));
        shake(dom.input);
        break;
      default:
        shake(dom.input);
        break;
    }
  }

  function revealCard(entry) {
    const node = cardNodes.get(normalizeName(entry.name));
    if (!node) return;
    node.card.classList.add('is-found');
    node.name.textContent = entry.name;
    node.time.textContent = formatHours(entry.hours) + ' h';
    play(node.card, 'anim-pop');
  }

  function showFeedback(tone, message) {
    dom.feedback.className = 'top-feedback is-' + tone;
    dom.feedback.textContent = message;
    dom.feedback.hidden = false;
    play(dom.feedback, 'reveal-item');
    clearTimeout(showFeedback._timer);
    showFeedback._timer = setTimeout(() => { dom.feedback.hidden = true; }, 2200);
  }

  function showWin() {
    dom.grid.hidden = true;
    dom.winPanel.hidden = false;
    dom.winCount.textContent = String(game.total);
    dom.input.disabled = true;
    pop(dom.winPanel);
  }
}

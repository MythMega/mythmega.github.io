/**
 * Vue du mode "Time" : un temps de stream est affiche, le joueur saisit un
 * nom de jeu (autocompletion partagee, insensible casse/accents, inter-mots,
 * filtre debounce 0,5 s). Chaque mauvaise tentative alimente un historique,
 * comme dans le mode Classique. La manche se termine quand tous les jeux
 * correspondant au temps cible sont trouves.
 */
import TimeGame from '../business/time-game.js';
import { t, formatNumber } from './i18n.js';
import { el, applyGameImage, formatHours } from './dom.js';
import { play, shake, pop, pulse, revealIndexed } from './animations.js';
import { attachAutocomplete } from './autocomplete.js';

export function createTimeView(root, entries) {
  const game = new TimeGame(entries);

  root.hidden = false;
  root.replaceChildren();
  root.append(buildShell());

  const dom = {
    roundLabel: document.getElementById('timeRoundLabel'),
    targetValue: document.getElementById('timeTargetValue'),
    targetUnit: document.getElementById('timeTargetUnit'),
    stage: document.getElementById('timeStage'),
    form: document.getElementById('timeForm'),
    input: document.getElementById('timeInput'),
    suggestions: document.getElementById('timeSuggestionsList'),
    feedback: document.getElementById('timeFeedback'),
    historyList: document.getElementById('timeHistoryList'),
    historyEmpty: document.getElementById('timeHistoryEmpty'),
    winPanel: document.getElementById('timeWinPanel'),
    winCards: document.getElementById('timeWinCards'),
    nextRoundBtn: document.getElementById('timeNextRound'),
  };

  const autocomplete = attachAutocomplete({
    input: dom.input,
    list: dom.suggestions,
    itemId: 'timeSuggestion',
    search: (query) => game.search(query),
  });

  dom.form.addEventListener('submit', (event) => {
    event.preventDefault();
    submitGuess();
  });
  dom.nextRoundBtn.addEventListener('click', nextRound);

  renderRound();

  /* ---------------------------------------------------------------- */

  function renderRound() {
    const chunk = game.newRound();

    dom.winPanel.hidden = true;
    dom.stage.hidden = false;

    dom.roundLabel.textContent = t('time.round', { n: game.round });
    dom.targetValue.textContent = formatNumber(chunk.target, 0);
    dom.targetUnit.textContent = t('time.hoursUnit');

    dom.feedback.hidden = true;
    dom.input.value = '';
    dom.input.disabled = false;
    autocomplete.hide();

    renderHistory();
    play(dom.stage, 'reveal-card');
    dom.input.focus();
  }

  function nextRound() {
    renderRound();
  }

  function submitGuess() {
    if (game.isComplete) return;
    const result = game.guess(dom.input.value);
    dom.input.value = '';
    autocomplete.hide();

    if (result.status === 'invalid') {
      shake(dom.input);
      return;
    }

    switch (result.status) {
      case 'found':
        if (game.isComplete) {
          showFeedback('good', t('time.found', { name: result.game.name }));
          setTimeout(showWin, 600);
        } else {
          const left = game.solutions.length - game.found.size;
          showFeedback('good', left === 1 ? t('time.remainingOne') : t('time.remainingMany', { count: left }));
        }
        break;
      case 'already':
        showFeedback('warn', t('time.already'));
        renderHistory();
        break;
      case 'miss':
        showFeedback('bad', t('time.miss'));
        shake(dom.input);
        renderHistory();
        break;
      default:
        shake(dom.input);
        break;
    }
  }

  function renderHistory() {
    dom.historyList.replaceChildren();
    dom.historyEmpty.hidden = game.history.length > 0;
    game.history.forEach((entry, index) => {
      const item = el('li', { className: 'guess-item' });
      item.append(
        el('span', { className: 'guess-rank', text: '#' + (index + 1) }),
        el('span', { className: 'guess-value', text: entry.name }),
        el('span', { className: `guess-arrow ${entry.hint}`, text: entry.hint === 'already' ? '⤾' : '✗' })
      );
      dom.historyList.append(item);
      revealIndexed(item, index);
    });
  }

  function showWin() {
    dom.feedback.hidden = true;
    dom.stage.hidden = true;

    dom.winCards.replaceChildren();
    game.solutions.forEach((entry, index) => {
      const card = el('div', { className: 'time-win-card' });
      const art = el('img', { className: 'game-art', attrs: { alt: '', loading: 'lazy' } });
      applyGameImage(art, entry.boxArtUrl);
      card.append(
        el('div', { className: 'art-wrap', children: [art] }),
        el('span', { className: 'time-win-name', text: entry.name }),
        el('span', { className: 'time-win-hours', text: formatHours(entry.hours) + ' h' })
      );
      dom.winCards.append(card);
      revealIndexed(card, index);
    });

    dom.winPanel.hidden = false;
    pop(dom.winPanel);
  }

  function showFeedback(tone, message) {
    dom.feedback.className = 'top-feedback is-' + tone;
    dom.feedback.textContent = message;
    dom.feedback.hidden = false;
    play(dom.feedback, 'reveal-item');
    clearTimeout(showFeedback._timer);
    showFeedback._timer = setTimeout(() => { dom.feedback.hidden = true; }, 2200);
  }
/* ------------------- Construction du DOM ------------------- */

  function buildShell() {
    const shell = el('div', { className: 'game-shell time' });

    const toolbar = el('header', { className: 'mode-toolbar' });
    toolbar.append(
      el('span', { className: 'chip chip-accent', text: t('time.badge') }),
      el('span', { className: 'round-label', attrs: { id: 'timeRoundLabel' } })
    );

    const stage = el('section', { className: 'aero round-card', attrs: { id: 'timeStage' } });
    stage.append(
      el('div', {
        className: 'time-target',
        children: [
          el('strong', { className: 'time-target-value', attrs: { id: 'timeTargetValue' } }),
          el('span', { className: 'time-target-unit', attrs: { id: 'timeTargetUnit' } }),
        ],
      }),
      el('h2', { className: 'game-name time-question', text: t('time.question') }),
      buildForm(),
      el('p', { className: 'top-feedback', attrs: { id: 'timeFeedback', hidden: '' } })
    );

    const historyCard = el('aside', { className: 'aero history-card' });
    historyCard.append(
      el('h3', { className: 'history-title', text: t('time.history') }),
      el('p', { className: 'history-empty', attrs: { id: 'timeHistoryEmpty' }, text: t('time.historyEmpty') }),
      el('ol', { className: 'guess-list', attrs: { id: 'timeHistoryList' } })
    );

    const winPanel = el('section', { className: 'aero win-panel', attrs: { id: 'timeWinPanel', hidden: '' } });
    winPanel.append(
      el('h2', { className: 'win-title', text: t('time.won') }),
      el('p', { className: 'win-subtitle', text: t('time.wonDesc') }),
      el('div', { className: 'time-win-cards', attrs: { id: 'timeWinCards' } }),
      el('div', {
        className: 'win-actions',
        children: [
          el('button', { className: 'btn primary', attrs: { id: 'timeNextRound', type: 'button' }, text: t('time.newRound') }),
          el('a', { className: 'btn ghost', attrs: { href: 'index.html' }, text: t('time.changeStreamer') }),
        ],
      })
    );

    const layout = el('div', { className: 'game-layout' });
    layout.append(stage, historyCard);

    shell.append(toolbar, layout, winPanel);
    return shell;
  }

  function buildForm() {
    const input = el('input', {
      className: 'input top-input',
      attrs: {
        id: 'timeInput',
        type: 'text',
        autocomplete: 'off',
        spellcheck: 'false',
        placeholder: t('time.placeholder'),
        'aria-label': t('time.placeholder'),
        'aria-autocomplete': 'list',
        'aria-controls': 'timeSuggestionsList',
      },
    });
    const suggestions = el('ul', {
      className: 'autocomplete-list',
      attrs: { id: 'timeSuggestionsList', role: 'listbox', hidden: '' },
    });
    const wrapper = el('div', { className: 'autocomplete', children: [input, suggestions] });

    return el('form', {
      className: 'time-form',
      attrs: { id: 'timeForm' },
      children: [
        wrapper,
        el('button', { className: 'btn primary', attrs: { type: 'submit' }, text: t('time.submit') }),
      ],
    });
  }
}
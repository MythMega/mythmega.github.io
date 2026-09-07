/**
 * Vue du mode Classique : construit son interface dans `root` et la pilote
 * via la machine à états `ClassicGame` (business). Aucun texte utilisateur
 * n'est injecté en HTML brut : tout passe par textContent.
 */
import ClassicGame from '../business/classic-game.js';
import { t, formatNumber } from './i18n.js';
import { el, applyGameImage } from './dom.js';
import { play, pop, shake, pulse, countUp, revealIndexed } from './animations.js';

export function createClassicView(root, entries) {
  const game = new ClassicGame(entries);

  root.hidden = false;
  root.replaceChildren();
  root.append(buildShell());

  const dom = {
    attempts: document.getElementById('classicAttempts'),
    art: document.getElementById('classicArt'),
    name: document.getElementById('classicName'),
    form: document.getElementById('guessForm'),
    input: document.getElementById('guessInput'),
    hint: document.getElementById('hintBadge'),
    roundCard: document.getElementById('roundCard'),
    historyCard: document.getElementById('historyCard'),
    historyList: document.getElementById('guessList'),
    winPanel: document.getElementById('winPanel'),
    winArt: document.getElementById('winArt'),
    winName: document.getElementById('winName'),
    winHours: document.getElementById('winHours'),
    winAttempts: document.getElementById('winAttempts'),
    nextRoundBtn: document.getElementById('nextRoundBtn'),
  };

  dom.form.addEventListener('submit', (event) => {
    event.preventDefault();
    submitGuess();
  });
  dom.nextRoundBtn.addEventListener('click', nextRound);

  game.start();
  renderPlay();

  /* ---------------------------------------------------------------- */

  function renderPlay() {
    dom.winPanel.hidden = true;
    dom.roundCard.hidden = false;
    dom.historyCard.hidden = false;

    dom.historyList.replaceChildren();
    dom.hint.hidden = true;
    dom.hint.className = 'hint-badge';
    dom.input.value = '';
    dom.input.disabled = false;
    dom.input.placeholder = t('classic.placeholder');

    applyGameImage(dom.art, game.solution.boxArtUrl);
    dom.name.textContent = game.solution.name;
    renderAttempts();
    play(dom.roundCard, 'reveal-card');
    dom.input.focus();
  }

  function nextRound() {
    game.newRound();
    renderPlay();
  }

  function renderAttempts() {
    const count = game.attempts;
    const label = count > 1 ? t('classic.attempts') : t('classic.attempt');
    dom.attempts.textContent = `${count} ${label}`;
  }

  function renderHistory(entry) {
    const item = el('li', { className: 'guess-item' });
    item.append(
      el('span', { className: 'guess-rank', text: `#${game.attempts}` }),
      el('span', { className: 'guess-value', text: `${formatNumber(entry.value, 0)} h` }),
      el('span', {
        className: `guess-arrow ${entry.hint}`,
        text: entry.hint === 'higher' ? '↑' : '↓',
      })
    );
    dom.historyList.append(item);
    revealIndexed(item, game.attempts);
  }

  function renderHint(hint, message) {
    dom.hint.hidden = false;
    dom.hint.className = `hint-badge hint-${hint}`;
    dom.hint.textContent = message;
    pulse(dom.hint);
  }

  function submitGuess() {
    const result = game.guess(dom.input.value);

    if (!result) {
      shake(dom.input);
      renderHint('invalid', t('classic.invalid'));
      return;
    }

    dom.input.value = '';

    if (result.hint === 'win') {
      showWin(result);
      return;
    }

    renderHint(result.hint, `${result.hint === 'higher' ? '↑' : '↓'} ${t(`classic.${result.hint}`)}`);
    renderHistory(result);
    renderAttempts();
  }

  function showWin(result) {
    dom.roundCard.hidden = true;
    dom.historyCard.hidden = true;
    dom.winPanel.hidden = false;

    applyGameImage(dom.winArt, result.solution.boxArtUrl);
    dom.winName.textContent = result.solution.name;
    countUp(dom.winHours, result.solution.hours, { digits: 1 });
    dom.winAttempts.textContent =
      `${result.attempts} ${result.attempts > 1 ? t('classic.attempts') : t('classic.attempt')}`;
    pop(dom.winPanel);
  }
}
/* ---------------- Construction du DOM ---------------- */

function buildShell() {
  const shell = el('div', { className: 'game-shell classic' });

  const toolbar = el('header', { className: 'mode-toolbar' });
  toolbar.append(
    el('span', { className: 'chip chip-accent', text: t('classic.badge') }),
    el('span', { className: 'attempt-label', attrs: { id: 'classicAttempts' } })
  );

  const roundCard = el('section', { className: 'aero round-card', attrs: { id: 'roundCard' } });
  roundCard.append(
    el('div', {
      className: 'art-wrap',
      children: [el('img', { className: 'game-art', attrs: { id: 'classicArt', alt: '' } })],
    }),
    el('h2', { className: 'game-name', attrs: { id: 'classicName' } }),
    el('p', { className: 'question', text: t('classic.question') }),
    buildForm(),
    el('p', { className: 'hint-badge', attrs: { id: 'hintBadge' } })
  );

  const historyCard = el('aside', { className: 'aero history-card', attrs: { id: 'historyCard' } });
  historyCard.append(
    el('h3', { className: 'history-title', text: t('classic.history') }),
    el('ol', { className: 'guess-list', attrs: { id: 'guessList' } })
  );

  const winPanel = el('section', { className: 'aero win-panel', attrs: { id: 'winPanel', hidden: '' } });
  winPanel.append(
    el('div', {
      className: 'art-wrap',
      children: [el('img', { className: 'game-art', attrs: { id: 'winArt', alt: '' } })],
    }),
    el('h2', { className: 'game-name', attrs: { id: 'winName' } }),
    el('div', {
      className: 'win-stats',
      children: [
        el('div', {
          className: 'stat',
          children: [
            el('span', { className: 'stat-label', text: t('classic.streamTime') }),
            el('div', {
              className: 'stat-value',
              children: [
                el('strong', { className: 'stat-number', attrs: { id: 'winHours' } }),
                el('span', { className: 'stat-unit', text: 'h' }),
              ],
            }),
          ],
        }),
        el('div', {
          className: 'stat',
          children: [
            el('span', { className: 'stat-label', text: t('classic.attemptsLabel') }),
            el('div', {
              className: 'stat-value',
              children: [el('strong', { className: 'stat-number', attrs: { id: 'winAttempts' } })],
            }),
          ],
        }),
      ],
    }),
    el('div', {
      className: 'win-actions',
      children: [
        el('button', {
          className: 'btn primary',
          attrs: { id: 'nextRoundBtn', type: 'button' },
          text: t('classic.newRound'),
        }),
        el('a', { className: 'btn ghost', attrs: { href: 'index.html' }, text: t('classic.changeStreamer') }),
      ],
    })
  );

  const layout = el('div', { className: 'game-layout' });
  layout.append(roundCard, historyCard);

  shell.append(toolbar, layout, winPanel);
  return shell;
}

function buildForm() {
  const input = el('input', {
    className: 'input guess-input',
    attrs: {
      id: 'guessInput',
      type: 'number',
      min: '0',
      step: '1',
      inputmode: 'numeric',
      autocomplete: 'off',
      placeholder: t('classic.placeholder'),
      'aria-label': t('classic.placeholder'),
    },
  });
  const submit = el('button', {
    className: 'btn primary',
    attrs: { type: 'submit' },
    text: t('classic.submit'),
  });
  return el('form', { className: 'guess-form', attrs: { id: 'guessForm' }, children: [input, submit] });
}
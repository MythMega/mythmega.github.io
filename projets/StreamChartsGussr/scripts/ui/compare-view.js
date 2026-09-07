/**
 * Vue du mode Comparaison : deux jeux s'affrontent, on clique sur le plus
 * streamé. La machine à états `CompareGame` gère la suite du jeu ; ici on
 * ne fait que refléter ses transitions et animer le retour visuel.
 */
import CompareGame from '../business/compare-game.js';
import { t, formatNumber } from './i18n.js';
import { el, applyGameImage, formatHours } from './dom.js';
import { play, pop, shake, pulse, glow, countUp } from './animations.js';

export function createCompareView(root, entries) {
  const game = new CompareGame(entries);
  let locked = false;

  root.hidden = false;
  root.replaceChildren();
  root.append(buildShell());

  const dom = {
    streakValue: document.getElementById('streakValue'),
    streakChip: document.getElementById('streakChip'),
    roundLabel: document.getElementById('roundLabel'),
    stage: document.getElementById('compareStage'),
    cardA: document.getElementById('cmpCardA'),
    cardB: document.getElementById('cmpCardB'),
    artA: document.getElementById('cmpArtA'),
    artB: document.getElementById('cmpArtB'),
    nameA: document.getElementById('cmpNameA'),
    nameB: document.getElementById('cmpNameB'),
    timeA: document.getElementById('cmpTimeA'),
    timeB: document.getElementById('cmpTimeB'),
    feedback: document.getElementById('feedbackBanner'),
    overPanel: document.getElementById('overPanel'),
    overStreak: document.getElementById('overStreak'),
    replayBtn: document.getElementById('compareReplay'),
  };

  dom.cardA.addEventListener('click', () => choose('a'));
  dom.cardB.addEventListener('click', () => choose('b'));
  dom.replayBtn.addEventListener('click', () => {
    game.start();
    renderRound();
  });

  game.start();
  renderRound();

  /* ---------------------------------------------------------------- */

  function renderRound() {
    const { a, b } = game.currentPair;
    if (!a || !b) {
      game.over = true;
      return;
    }

    dom.overPanel.hidden = true;
    dom.feedback.hidden = true;
    dom.feedback.className = 'feedback-banner';
    dom.stage.hidden = false;

    dom.roundLabel.textContent = t('compare.round', { n: game.round });
    dom.streakValue.textContent = String(game.streak);

    [dom.cardA, dom.cardB].forEach((card) => {
      card.classList.remove('is-win', 'is-lose', 'anim-glow');
      card.disabled = false;
    });

    applyGameImage(dom.artA, a.boxArtUrl);
    dom.nameA.textContent = a.name;
    dom.timeA.textContent = formatHours(a.hours);

    applyGameImage(dom.artB, b.boxArtUrl);
    dom.nameB.textContent = b.name;
    dom.timeB.textContent = '???';

    locked = false;
    play(dom.stage, 'reveal-card');
  }

  function choose(pick) {
    if (locked || game.over) return;
    locked = true;

    const result = game.answer(pick);
    if (!result) return;

    const pickedCard = pick === 'a' ? dom.cardA : dom.cardB;
    dom.cardA.disabled = true;
    dom.cardB.disabled = true;

    // Révélation du temps mystère avec décompte.
    countUp(dom.timeB, result.b.hours, { digits: 1 });

    if (result.equal) {
      dom.feedback.className = 'feedback-banner is-equal';
      dom.feedback.textContent = t('compare.equal');
      dom.cardA.classList.add('is-win');
      dom.cardB.classList.add('is-win');
    } else if (result.correct) {
      dom.feedback.className = 'feedback-banner is-good';
      dom.feedback.textContent = `${t('compare.correct')} · ${t('compare.ratio', {
        value: formatNumber(result.ratio),
      })}`;
      pickedCard.classList.add('is-win');
      dom.streakValue.textContent = String(result.streak);
      pop(dom.streakChip);
    } else {
      dom.feedback.className = 'feedback-banner is-bad';
      dom.feedback.textContent = t('compare.wrong');
      pickedCard.classList.add('is-lose');
      shake(pickedCard);
    }

    dom.feedback.hidden = false;
    pulse(dom.feedback);

    setTimeout(() => {
      if (game.over) {
        showOver(result);
      } else {
        renderRound();
      }
    }, 1500);
  }

  function showOver(result) {
    dom.stage.hidden = true;
    dom.overPanel.hidden = false;
    dom.overStreak.textContent = String(result.streak);
    pop(dom.overPanel);
  }

  return game;
}
/* ---------------- Construction du DOM ---------------- */

function buildShell() {
  const shell = el('div', { className: 'game-shell compare' });

  const toolbar = el('header', { className: 'mode-toolbar' });
  const streakChip = el('div', { className: 'chip streak-chip', attrs: { id: 'streakChip' } });
  streakChip.append(
    el('svg', {
      className: 'chip-icon',
      attrs: {
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '2.2',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'aria-hidden': 'true',
      },
      children: [el('path', { attrs: { d: 'M13 2 4 14h6l-1 8 9-12h-6l1-8z' } })],
    }),
    el('strong', { attrs: { id: 'streakValue' } })
  );
  toolbar.append(
    el('span', { className: 'chip chip-accent', text: t('compare.badge') }),
    streakChip,
    el('span', { className: 'round-label', attrs: { id: 'roundLabel' } })
  );

  const stage = el('div', { className: 'compare-stage', attrs: { id: 'compareStage' } });
  stage.append(
    buildCard('a'),
    el('div', { className: 'vs-badge', text: 'VS' }),
    buildCard('b')
  );

  const feedback = el('p', { className: 'feedback-banner', attrs: { id: 'feedbackBanner', hidden: '' } });

  const overPanel = el('section', { className: 'aero over-panel', attrs: { id: 'overPanel', hidden: '' } });
  overPanel.append(
    el('h2', { className: 'over-title', text: t('compare.over') }),
    el('p', { className: 'over-label', text: t('compare.finalStreakLabel') }),
    el('strong', { className: 'over-streak-value', attrs: { id: 'overStreak' } }),
    el('div', {
      className: 'win-actions',
      children: [
        el('button', {
          className: 'btn primary',
          attrs: { id: 'compareReplay', type: 'button' },
          text: t('compare.playAgain'),
        }),
        el('a', { className: 'btn ghost', attrs: { href: 'index.html' }, text: t('compare.changeStreamer') }),
      ],
    })
  );

  shell.append(toolbar, el('p', { className: 'compare-question', text: t('compare.question') }), stage, feedback, overPanel);
  return shell;
}

function buildCard(side) {
  const card = el('button', {
    className: 'cmp-card aero',
    attrs: { id: side === 'a' ? 'cmpCardA' : 'cmpCardB', type: 'button', 'data-side': side },
  });
  card.append(
    el('div', {
      className: 'art-wrap',
      children: [
        el('img', { className: 'game-art', attrs: { id: `cmpArt${side.toUpperCase()}`, alt: '' } }),
      ],
    }),
    el('h3', { className: 'game-name', attrs: { id: `cmpName${side.toUpperCase()}` } }),
    el('p', { className: 'cmp-time', attrs: { id: `cmpTime${side.toUpperCase()}` } })
  );
  return card;
}
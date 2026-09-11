/**
 * Construction du DOM de la vue Top : formulaire avec autocompletion maison,
 * boutons Indice / Abandonner, grille de cartes et panneau recapitulatif de
 * fin de partie.
 */
import { t } from './i18n.js';
import { el } from './dom.js';

export function buildTopShell() {
  const shell = el('div', { className: 'game-shell top' });

  const toolbar = el('header', { className: 'mode-toolbar' });
  toolbar.append(
    el('span', { className: 'chip chip-accent', text: t('top.badge') }),
    buildProgress()
  );

  const question = el('p', { className: 'top-question', text: t('top.question') });

  const input = el('input', {
    className: 'input top-input',
    attrs: {
      id: 'topInput',
      type: 'text',
      autocomplete: 'off',
      spellcheck: 'false',
      placeholder: t('top.placeholder'),
      'aria-label': t('top.placeholder'),
      'aria-autocomplete': 'list',
      'aria-controls': 'topSuggestionsList',
    },
  });

  // Liste de suggestions pilotee par TopGame.search() : insensible a la casse
  // et aux accents, recherche inter-mots, correspondance exacte en premier.
  const suggestions = el('ul', {
    className: 'top-suggestions',
    attrs: { id: 'topSuggestionsList', role: 'listbox', hidden: '' },
  });

  const form = el('form', { className: 'top-form', attrs: { id: 'topForm' } });
  form.append(
    el('div', { className: 'top-input-wrap', children: [input, suggestions] }),
    el('div', {
      className: 'top-actions',
      children: [
        el('button', { className: 'btn primary', attrs: { id: 'topSubmit', type: 'submit' }, text: t('top.submit') }),
        el('button', { className: 'btn ghost', attrs: { id: 'topHint', type: 'button' }, text: t('top.hint') }),
        el('button', { className: 'btn danger', attrs: { id: 'topGiveUp', type: 'button' }, text: t('top.giveUp') }),
      ],
    })
  );

  const grid = el('div', { className: 'top-grid', attrs: { id: 'topGrid' } });

  const recap = el('section', { className: 'aero win-panel top-recap', attrs: { id: 'topRecap', hidden: '' } });
  recap.append(
    el('span', { className: 'result-chip', attrs: { id: 'topRecapResult' } }),
    el('h2', { className: 'win-title', attrs: { id: 'topRecapTitle' } }),
    el('p', { className: 'win-subtitle', attrs: { id: 'topRecapDesc' } }),
    el('div', {
      className: 'top-recap-stats',
      children: [
        buildStat('topRecapTime', 'top.timeSpent'),
        buildStat('topRecapCorrect', 'top.correctGuesses'),
        buildStat('topRecapWrong', 'top.wrongGuesses'),
      ],
    }),
    el('div', {
      className: 'win-actions',
      children: [
        el('button', { className: 'btn ghost', attrs: { id: 'topViewResult', type: 'button' }, text: t('top.viewResult') }),
        el('button', { className: 'btn primary', attrs: { id: 'topReplay', type: 'button' }, text: t('top.playAgain') }),
        el('a', { className: 'btn ghost', attrs: { href: 'index.html' }, text: t('top.changeStreamer') }),
      ],
    })
  );

  shell.append(toolbar, question, form, grid, recap);
  return shell;
}

function buildStat(id, labelKey) {
  return el('div', {
    className: 'stat',
    children: [
      el('span', { className: 'stat-label', text: t(labelKey) }),
      el('strong', { className: 'stat-number', attrs: { id } }),
    ],
  });
}

function buildProgress() {
  const progress = el('div', { className: 'top-progress' });
  const track = el('div', { className: 'top-progress-track' });
  track.append(el('div', { className: 'top-progress-fill', attrs: { id: 'topProgressBar' } }));
  progress.append(
    el('span', {
      className: 'top-progress-label',
      children: [
        el('strong', { attrs: { id: 'topProgressValue' } }),
        document.createTextNode(' / '),
        el('span', { attrs: { id: 'topProgressTotal' } }),
      ],
    }),
    track
  );
  return progress;
}

export function normalizeName(name) {
  return String(name)
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

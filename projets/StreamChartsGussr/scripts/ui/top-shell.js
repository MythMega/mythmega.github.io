/**
 * Construction du DOM de la vue Top (formulaire + grille + panneau victoire).
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
  const datalist = el('datalist', { attrs: { id: 'topSuggestions' } });

  const form = el('form', { className: 'top-form', attrs: { id: 'topForm' } });
  form.append(
    el('input', {
      className: 'input top-input',
      attrs: {
        id: 'topInput',
        type: 'text',
        list: 'topSuggestions',
        autocomplete: 'off',
        spellcheck: 'false',
        placeholder: t('top.placeholder'),
        'aria-label': t('top.placeholder'),
      },
    }),
    el('button', { className: 'btn primary', attrs: { type: 'submit' }, text: t('top.submit') })
  );

  const feedback = el('p', { className: 'top-feedback', attrs: { id: 'topFeedback', hidden: '' } });
  const grid = el('div', { className: 'top-grid', attrs: { id: 'topGrid' } });

  const winPanel = el('section', { className: 'aero win-panel top-win', attrs: { id: 'topWinPanel', hidden: '' } });
  winPanel.append(
    el('h2', { className: 'win-title', text: t('top.won') }),
    el('p', { className: 'win-subtitle', text: t('top.wonDesc') }),
    el('strong', { className: 'win-count', attrs: { id: 'topWinCount' } }),
    el('div', {
      className: 'win-actions',
      children: [
        el('button', { className: 'btn primary', attrs: { id: 'topReplay', type: 'button' }, text: t('top.playAgain') }),
        el('a', { className: 'btn ghost', attrs: { href: 'index.html' }, text: t('top.changeStreamer') }),
      ],
    })
  );

  shell.append(toolbar, question, datalist, form, feedback, grid, winPanel);
  return shell;
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
  return String(name).trim().toLowerCase().replace(/\s+/g, ' ');
}

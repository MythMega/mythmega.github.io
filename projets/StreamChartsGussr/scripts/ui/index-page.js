/**
 * Script principal de `index.html` : saisie du pseudo, choix du mode,
 * bouton « rejouer sur le même », lancement de la partie.
 */
import { initSite } from './bootstrap.js';
import { saveSettings, loadSettings } from '../data/settings-store.js';
import { countCached } from '../data/streamer-repository.js';
import { t } from './i18n.js';
import { $, $$ } from './dom.js';
import { shake, play } from './animations.js';
import { toast } from './toast.js';

async function main() {
  const settings = await initSite();

  const input = $('#streamerInput');
  const replayBtn = $('#replayBtn');
  const playBtn = $('#playBtn');
  const modeCards = $$('.mode-card');
  const difficultySection = $('#difficultySection');
  const difficultyCards = $$('.difficulty-card');
  const cacheInfo = $('#cacheInfo');

  let selectedMode = settings.lastMode || 'classic';
  let selectedDifficulty = settings.difficulty || 'medium';

  if (settings.lastStreamer) {
    input.value = settings.lastStreamer;
    replayBtn.hidden = false;
    replayBtn.textContent = t('index.replayButton', { name: settings.lastStreamer });
  }

  renderModeSelection();
  renderDifficultySelection();
  updateDifficultyVisibility();

  modeCards.forEach((card) => {
    card.addEventListener('click', () => {
      selectedMode = card.dataset.mode;
      renderModeSelection();
      updateDifficultyVisibility();
    });
  });

  difficultyCards.forEach((card) => {
    card.addEventListener('click', () => {
      selectedDifficulty = card.dataset.difficulty;
      renderDifficultySelection();
    });
  });

  replayBtn.addEventListener('click', () => {
    if (!settings.lastStreamer) return;
    input.value = settings.lastStreamer;
    play(input.closest('.input-row'), 'anim-glow');
    input.focus();
  });

  playBtn.addEventListener('click', startGame);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') startGame();
  });

  const cachedCount = await countCached();
  if (cachedCount > 0) {
    cacheInfo.hidden = false;
    cacheInfo.textContent = t(
      cachedCount === 1 ? 'index.cacheInfo' : 'index.cacheInfoPlural',
      { count: cachedCount }
    );
  }

  /* --- Toggle données étendues ------------------------------- */

  const extendedToggle = $('#extendedToggle');
  extendedToggle.checked = settings.extendedData;

  extendedToggle.addEventListener('change', () => {
    saveSettings({ extendedData: extendedToggle.checked });
    toast(
      extendedToggle.checked
        ? t('index.extendedDataEnabled')
        : t('index.extendedDataDisabled'),
      { tone: 'is-info' }
    );
  });

  /* ------------------------------------------------------------------ */

  function renderModeSelection() {
    modeCards.forEach((card) => {
      const active = card.dataset.mode === selectedMode;
      card.classList.toggle('is-selected', active);
      card.setAttribute('aria-pressed', String(active));
    });
  }

  function renderDifficultySelection() {
    difficultyCards.forEach((card) => {
      const active = card.dataset.difficulty === selectedDifficulty;
      card.classList.toggle('is-selected', active);
      card.setAttribute('aria-pressed', String(active));
    });
  }

  function updateDifficultyVisibility() {
    const show = selectedMode === 'top';
    difficultySection.hidden = !show;
  }

  function startGame() {
    const name = input.value.trim();
    if (!name) {
      shake(input);
      input.focus();
      return;
    }

    saveSettings({ lastStreamer: name, lastMode: selectedMode, difficulty: selectedDifficulty });
    const params = new URLSearchParams({
      mode: selectedMode,
      streamer: name,
    });
    if (selectedMode === 'top') {
      params.set('difficulty', selectedDifficulty);
    }
    location.href = `game.html?${params.toString()}`;
  }
}

main();
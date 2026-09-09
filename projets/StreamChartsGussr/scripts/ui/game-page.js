/**
 * Script principal de `game.html` : lit les paramètres d'URL, charge le
 * profil du streamer (cache puis réseau), puis démarre la vue du bon mode.
 */
import { initSite } from './bootstrap.js';
import { t } from './i18n.js';
import { $, applyAvatar } from './dom.js';
import { loadSettings } from '../data/settings-store.js';
import {
  loadStreamer,
  StreamerNotFoundError,
  NoGamesError,
} from '../data/streamer-repository.js';
import { buildGamePool, PoolTooSmallError, MIN_HOURS_CLASSIC, MIN_HOURS_COMPARE } from '../business/pool.js';
import { createClassicView } from './classic-view.js';
import { createCompareView } from './compare-view.js';
import { createTopView } from './top-view.js';
import { createTimeView } from './time-view.js';
import { loadCats } from '../data/cats-store.js';

const VALID_MODES = ['classic', 'compare', 'top', 'time'];
const VALID_DIFFICULTIES = ['easy', 'medium', 'hard'];

export async function runGame() {
  await initSite();

  const params = new URLSearchParams(location.search);
  const mode = params.get('mode');
  const difficulty = params.get('difficulty') || 'medium';
  const requestedName = (params.get('streamer') || '').trim();
  const extended = loadSettings().extendedData;

  if (!VALID_MODES.includes(mode) || !requestedName) {
    location.replace('index.html');
    return;
  }

  const loadingView = $('#loadingView');
  const errorView = $('#errorView');
  const errorMessage = $('#errorMessage');
  const retryBtn = $('#retryBtn');
  const classicRoot = $('#classicRoot');
  const compareRoot = $('#compareRoot');
  const topRoot = $('#topRoot');
  const timeRoot = $('#timeRoot');

  $('#streamerName').textContent = requestedName;
  $('#modeBadge').textContent = t(
    mode === 'classic' ? 'classic.badge'
      : mode === 'top' ? 'top.badge'
      : mode === 'time' ? 'time.badge'
      : 'compare.badge'
  );
  document.title = `${requestedName} · ${t('app.name')}`;

  const statusLine = $('#loadingStatus');
  const loadingNote = $('#loadingNote');
  const phaseMessages = {
    search: t('loading.search', { name: requestedName }),
    fetch: t('loading.fetch', { name: requestedName }),
    cache: t('loading.cacheHit'),
    done: t('loading.done'),
  };

  show(loadingView);
  hide(errorView);
  hide(classicRoot);
  hide(compareRoot);
  hide(topRoot);
  hide(timeRoot);
  loadingNote.hidden = true;

  // Rejouer re-exécute tout le chargement (nouvel appel réseau si besoin).
  retryBtn.onclick = () => runGame();

  try {
    const { streamer, games, fromCache, stale } = await loadStreamer(requestedName, {
      extended,
      onPhase: (phase) => {
        if (phaseMessages[phase]) statusLine.textContent = phaseMessages[phase];
        loadingNote.hidden = phase !== 'fetch'; // note pendant le téléchargement réseau
      },
    });

    // Petites pauses pour que la transition cache/réseau soit lisible.
    if (fromCache && stale) {
      statusLine.textContent = t('loading.cacheHit');
      await delay(250);
    } else if (!fromCache) {
      statusLine.textContent = t('loading.done');
      await delay(250);
    }

      hide(loadingView);

    if (mode === 'top') {
      const difficultyLevel = VALID_DIFFICULTIES.includes(difficulty) ? difficulty : 'medium';
      show(topRoot);
      const cats = await loadCats();
      createTopView(topRoot, games, difficultyLevel, cats);
    } else {
      const pool = buildGamePool(games, {
        minHours: mode === 'classic' || mode === 'time' ? MIN_HOURS_CLASSIC : MIN_HOURS_COMPARE,
      });

      if (mode === 'classic') {
        createClassicView(classicRoot, pool);
      } else if (mode === 'time') {
        createTimeView(timeRoot, pool);
      } else {
        createCompareView(compareRoot, pool);
      }
    }

    applyAvatar($('#streamerAvatar'), streamer.boxArtUrl);
  } catch (error) {
    showError(error);
  }

  /* ---------------------------------------------------------------- */

  function showError(error) {
    hide(loadingView);
    hide(classicRoot);
    hide(compareRoot);
    hide(topRoot);

    let key;
    const vars = { name: requestedName };
    if (error instanceof StreamerNotFoundError) {
      key = 'errors.notFound';
    } else if (error instanceof NoGamesError) {
      key = 'errors.noData';
    } else if (error instanceof PoolTooSmallError) {
      key = 'errors.tooFew';
      vars.min = error.min;
    } else {
      key = 'errors.network';
    }

    errorMessage.textContent = t(key, vars);
    show(errorView);
  }
}

function show(view) {
  view.hidden = false;
}

function hide(view) {
  view.hidden = true;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

runGame();
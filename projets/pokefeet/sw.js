/*
 * Pokefeet — Service Worker
 *
 * Portée : /projets/pokefeet/
 * Stratégies :
 *  - navigations HTML : réseau d'abord, cache puis page hors ligne ;
 *  - configuration, traductions et version : réseau d'abord ;
 *  - scripts, styles, images et données : stale-while-revalidate.
 *
 * Le cache est versionné : incrémenter CACHE_VERSION après une modification
 * importante des fichiers précachés pour forcer le renouvellement.
 */
const CACHE_VERSION = 'pokefeet-v10';
const CACHE_NAME = `${CACHE_VERSION}-shell`;
const OFFLINE_URL = './offline.html';
const BASE_URL = new URL('./', self.location.href);
const BASE_PATH = BASE_URL.pathname;

const PRECACHE_URLS = [
  './',
  './manifest.webmanifest',
  './offline.html',
  './icons/icon-192.png',
  './icons/favicon-32.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',

  './index.html',
  './challenge.html',
  './changelog.html',
  './credits.html',
  './custom.html',
  './custom_create.html',
  './custom_play.html',
  './daily.html',
  './data.html',
  './data_management.html',
  './history.html',
  './integration-pokefeet.html',
  './list_challenges.html',
  './old_daily.html',
  './pied-dex.html',
  './pokefeet.html',
  './prediction.html',
  './profile.html',
  './stats.html',
  './test-i18n.html',
  './weekly.html',

  './styles/main.css',
  './styles/animations.css',
  './styles/base.css',
  './styles/buttons.css',
  './styles/challenges.css',
  './styles/cosmetics.css',
  './styles/custom-challenges.css',
  './styles/daily.css',
  './styles/data-management.css',
  './styles/dex.css',
  './styles/forms.css',
  './styles/game-controls.css',
  './styles/game-image.css',
  './styles/zoom.css',
  './styles/rotate3d.css',
  './styles/hints.css',
  './styles/history-details.css',
  './styles/history.css',
  './styles/home.css',
  './styles/language-switcher.css',
  './styles/loader.css',
  './styles/notifications.css',
  './styles/past-challenges.css',
  './styles/responsive.css',
  './styles/round-gauge.css',
  './styles/tabs.css',
  './styles/text-shadow.css',
  './styles/toggle.css',
  './styles/type-badges.css',

  './js/core/challenge.js',
  './js/core/pokemon-versions.js',
  './js/core/pokemon.js',
  './js/core/preferences.js',
  './js/core/reward-button.js',
  './js/core/reward-item.js',
  './js/core/reward.js',
  './js/data/challenge-storage.js',
  './js/data/config.js',
  './js/data/daily-to-dex-import.js',
  './js/data/data-manager.js',
  './js/data/dex.js',
  './js/data/migration.js',
  './js/features/challenges/challenge-game-ui.js',
  './js/features/challenges/challenge-list-ui.js',
  './js/features/challenges/challenge-manager.js',
  './js/features/credits/credits.js',
  './js/features/custom-challenges/codec.js',
  './js/features/custom-challenges/create-ui.js',
  './js/features/custom-challenges/game.js',
  './js/features/custom-challenges/play-ui.js',
  './js/features/daily/daily.js',
  './js/features/dex/dex-ui.js',
  './js/features/history/history-curve.js',
  './js/features/history/history.js',
  './js/features/history/old-daily.js',
  './js/features/marathon/game.js',
  './js/features/marathon/ui.js',
  './js/features/settings/cosmetics.js',
  './js/features/settings/profile.js',
  './js/features/stats/stats.js',
  './js/features/weekly/weekly.js',
  './js/i18n/language-switcher.js',
  './js/i18n/setup.js',
  './js/i18n/translate.js',
  './js/pwa.js',
  './js/ui/footer.js',
  './js/ui/fx.js',
  './js/ui/loader.js',
  './js/ui/preload.js',
  './js/ui/rotate3d.js',
  './js/ui/transitions.js',
  './js/ui/zoom.js',

  './translations/fr.json',
  './translations/en.json',
  './settings/config.json',
  './data/pokemons.json',
  './data/bonus_challenges.json',
  './data/cosmetics.json',
  './data/credits.json',
  './data/reward.json',
  './data/trophies.json',
  './data/version.json'
];

function absoluteUrl(path) {
  return new URL(path, BASE_URL).href;
}

function isSameOrigin(requestUrl) {
  return requestUrl.origin === self.location.origin;
}

function isFreshFirst(url) {
  const path = url.pathname;
  return (
    path === `${BASE_PATH}manifest.webmanifest` ||
    path.startsWith(`${BASE_PATH}settings/`) ||
    path.startsWith(`${BASE_PATH}translations/`) ||
    path === `${BASE_PATH}data/version.json`
  );
}

async function cacheResponse(cacheName, request, response) {
  if (!response || !response.ok || response.status === 206) return;
  if (response.headers.get('Vary') === '*') return;
  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
  } catch (error) {
    // Certaines réponses (redirections opaques, quota atteint) ne sont pas
    // stockables : on ignore sans interrompre la navigation.
  }
}

async function offlineResponse() {
  const cached = await caches.match(absoluteUrl(OFFLINE_URL));
  if (cached) return cached;
  return new Response(
    '<!doctype html><meta charset="utf-8"><title>Pokefeet — hors ligne</title>' +
      '<body style="font-family:system-ui;background:#060c18;color:#e2eaf8;padding:2rem">' +
      '<h1>Pokefeet</h1><p>Vous êtes hors ligne. Reconnectez-vous puis rechargez la page.</p>' +
      '<p><a style="color:#22c55e" href="./">Réessayer</a></p></body>',
    {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    }
  );
}

function offlineAssetResponse() {
  return new Response('', { status: 504, statusText: 'Offline' });
}

async function networkFirst(request, event) {
  try {
    const response = await fetch(request);
    if (response && response.ok) event.waitUntil(cacheResponse(CACHE_NAME, request, response));
    return response;
  } catch (error) {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    return offlineAssetResponse();
  }
}

async function navigationHandler(request, event) {
  try {
    const response = await fetch(request);
    if (response && response.ok) event.waitUntil(cacheResponse(CACHE_NAME, request, response));
    return response;
  } catch (error) {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    return offlineResponse();
  }
}

async function staleWhileRevalidate(request, event) {
  const cached = await caches.match(request, { ignoreSearch: true });

  const network = fetch(request)
    .then(response => {
      if (response && response.ok) event.waitUntil(cacheResponse(CACHE_NAME, request, response));
      return response;
    })
    .catch(() => null);

  if (cached) {
    event.waitUntil(network);
    return cached;
  }

  const response = await network;
  return response || offlineAssetResponse();
}

self.addEventListener('install', event => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await Promise.all(
        PRECACHE_URLS.map(async path => {
          const url = absoluteUrl(path);
          try {
            const response = await fetch(new Request(url, { cache: 'reload' }));
            if (response && response.ok) await cache.put(url, response);
          } catch (error) {
            // Un fichier absent ne doit pas faire échouer toute l'installation.
          }
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter(name => name.startsWith('pokefeet-') && name !== CACHE_NAME)
          .map(name => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (!isSameOrigin(url)) return;
  if (url.pathname.endsWith('/sw.js')) return;
  if (request.headers.has('range')) return;

  if (request.mode === 'navigate') {
    event.respondWith(navigationHandler(request, event));
    return;
  }

  if (isFreshFirst(url)) {
    event.respondWith(networkFirst(request, event));
    return;
  }

  event.respondWith(staleWhileRevalidate(request, event));
});

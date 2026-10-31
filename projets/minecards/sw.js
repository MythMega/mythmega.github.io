/**
 * sw.js - Service worker of MineCards.
 *
 * Reference: `manifest.json` (what turns the page into an installable app, portrait orientation
 * included) and `index.html`, which registers this file.
 *
 * WHAT IT DOES
 * The game is a static single page (HTML + ES modules + CSS + JSON data); once a player has opened
 * it, nothing it needs lives on the server any more. This worker is what makes that true without a
 * network: it keeps the app shell in a cache of its own and fills a second cache with every other
 * resource as it is used, so a second visit - or an installed app - works fully offline.
 *
 * STRATEGIES, one per kind of request
 *   install             `PRECACHE_URLS` (HTML, CSS, every ES module, settings, card catalogues,
 *                       icons, the shared card back, the flip sounds, the 3D model) is fetched once
 *                       and stored, together with the pinned Three.js modules of
 *                       `PRECACHE_CDN_URLS`. This is what makes the FIRST offline start possible,
 *                       instead of only the second one.
 *   navigate            network first, then the cached copy of that exact page, then `index.html`.
 *                       The HTML is never served stale on purpose: a player who reloads must get
 *                       the current version as soon as they are online.
 *   same-origin asset   stale-while-revalidate: the cached copy answers immediately and the fresh
 *                       one replaces it in the background. The files are not fingerprinted, so this
 *                       is what makes an update land without a hard reload, one visit late.
 *   CDN (unpkg)         cache first: Three.js is pinned to an exact version, so its URL can never
 *                       serve anything else. Caching it offline is what keeps the 3D booster working
 *                       with no network - without it the opening falls back to the 2D image.
 *   everything else     passthrough. Two families of requests MUST NOT be answered from a cache:
 *                       the time providers of `DateSyncManager` and the Google Sheets exports of
 *                       `GiftManager` (both cross-origin, both only useful when fresh).
 *
 * Never cached, beyond the above: any non-GET, any request carrying a `Range` header (a 206 cannot
 * be stored), any request whose `cache` mode forbids reusing a stored copy (`no-store`, `reload`,
 * `no-cache`) - the settings refresh, the gift refresh and the redeem-code refresh ask for exactly
 * that, and answering them from the cache would make the game ignore the very content the player
 * asked it to reload. The private files of the project (the admin tool, `useritem_codes.csv`, the
 * internal documentation) and the worker script itself are excluded too.
 *
 * UPDATING
 * Bump `VERSION` whenever the shell changes: `install` stores the new files under new cache names and
 * `activate` drops every previous one. Without a bump the stale copies would survive, because
 * stale-while-revalidate only replaces a file the visit actually requested.
 */

/* Bump on every change of the precache list or of a strategy. */
const VERSION = 'v55';

/* Prefix of the caches this worker owns. `activate` only ever deletes the caches that carry it, so
   the other projects of the same host (the sibling tools under `external/`) keep theirs. */
const CACHE_PREFIX = 'minecards-';
const SHELL_CACHE = `${CACHE_PREFIX}shell-${VERSION}`;
const RUNTIME_CACHE = `${CACHE_PREFIX}runtime-${VERSION}`;
const CDN_CACHE = `${CACHE_PREFIX}cdn-${VERSION}`;
const OWNED_CACHES = new Set([SHELL_CACHE, RUNTIME_CACHE, CDN_CACHE]);

/* The page served to an offline navigation whose own URL is not cached. */
const SHELL_INDEX = './index.html';

/* Third-party origins allowed to be cached. `index.html` and `overlay.html` both map the bare
   specifiers `three` / `three/addons/` to this host through an import map. */
const CDN_ORIGINS = new Set(['https://unpkg.com']);

/* Same-origin paths that never enter a cache: the worker script itself (browsers do not route a
   registration or an update check through the worker, but a page is free to fetch that URL and a
   stored copy could then be handed to a later update), the private tooling of the project, the
   CSV code registry that `.gitignore` keeps out of the repository, and the Digital Asset Links
   file that binds the Android wrapper to this origin - a verifier must always read the live copy,
   never one this worker happened to store. */
const BYPASS_PATTERNS = [/\/sw\.js$/, /^\/admin\//, /\/\.docs\//, /\/\.freebuff\//, /\/\.clinerules\//, /\/\.well-known\//, /\.csv$/];

/**
 * Files fetched at install time: the whole shell, and nothing heavy. The illustrations (`cards/`,
 * 374 MB), the boosters and the mining sounds are deliberately NOT here - they are large,
 * optional per screen and cached on first use by the runtime strategy.
 *
 * Every path is relative to this file, which is what keeps the game working both at the domain root
 * (local development) and under `/projets/minecards/` (production).
 *
 * A module added later and forgotten here is not a bug: it is fetched normally on the visit that
 * needs it and stored by the runtime strategy. Adding it to this list only moves the offline
 * capability from the second visit to the first.
 */
const PRECACHE_URLS = [
  /* Pages: the game itself, the standalone streaming overlay and the read-only page a shared
     binder opens. */
  SHELL_INDEX,
  './overlay.html',
  './collection.html',
  /* The manifest, so an offline install still gets its name and icons. */
  './manifest.json',
  /* Icons: what the operating system shows on the home screen and in the task switcher. */
  './assets/icons/favicon-32.png',
  './assets/icons/favicon-48.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/apple-touch-icon.png',
  /* Stylesheets, in the load order of `index.html`: theme tokens, base, components, views, then the
     animation modes last (they override an opening and `accessibility.css` closes the group). */
  /* Fonts first, like in `index.html`: the pixel face of a player title is declared before the
     stylesheets that use it (a title with no font would simply fall back to monospace). */
  './css/fonts.css',
  './assets/fonts/press-start-2p-latin.woff2',
  './assets/fonts/press-start-2p-latin-ext.woff2',
  './css/themes.css',
  './css/base.css',
  './css/views/onboarding.css',
  './css/views/opening.css',
  './css/views/collection.css',
  './css/views/binders.css',
  './css/views/stats.css',
  './css/views/minepick.css',
  './css/views/mineblock.css',
  './css/views/profile.css',
  './css/views/titles.css',
  './css/components/trophy.css',
  './css/views/settings.css',
  './css/views/redeem.css',
  './css/views/gifts.css',
  './css/views/info.css',
  './css/components/booster-3d.css',
  './css/components/profile-card.css',
  './css/components/card-reveal.css',
  './css/components/card-shine.css',
  './css/components/modal.css',
  './css/components/toast.css',
  './css/components/auto-claim.css',
  './css/components/daily-reward.css',
  './css/components/notifications.css',
  './css/components/install-prompt.css',
  './css/components/info-hint.css',
  './css/animations/defaults.css',
  './css/animations/opening.css',
  './css/animations/epic.css',
  './css/animations/explosive.css',
  './css/animations/minepick.css',
  './css/animations/accessibility.css',
  /* ES modules: the entry point and every module it imports, because a missing one is a blank page
     offline - the browser stops execution instead of degrading. */
  './js/app.js',
  './js/binder-share.js',
  './js/overlay.js',
  './js/UI/SpaRouter.js',
  './js/UI/components/AutoClaimPopup.js',
  './js/UI/components/Booster3DRenderer.js',
  './js/UI/components/CardComponent.js',
  './js/UI/components/DailyRewardPopup.js',
  './js/UI/components/GameNotifier.js',
  './js/UI/components/InfoHint.js',
  './js/UI/components/InstallPrompt.js',
  './js/UI/components/NotificationCenter.js',
  './js/UI/components/ProfileCard.js',
  './js/UI/components/SetAnnouncementPopup.js',
  './js/UI/components/SlotPurchaseModal.js',
  './js/UI/components/Toast.js',
  './js/UI/components/TrophyDetail.js',
  './js/UI/components/ViewHelp.js',
  './js/UI/views/CollectionView.js',
  './js/UI/views/GiftsView.js',
  './js/UI/views/InfoView.js',
  './js/UI/views/MineBlockView.js',
  './js/UI/views/MinePickView.js',
  './js/UI/views/OnboardingView.js',
  './js/UI/views/OpeningView.js',
  './js/UI/views/ProfileView.js',
  './js/UI/views/RedeemView.js',
  './js/UI/views/SettingsView.js',
  './js/UI/views/StatsView.js',
  './js/UI/views/TitlesView.js',
  './js/UI/views/TrophiesView.js',
  './js/business/AccountManager.js',
  './js/business/AutoClaimManager.js',
  './js/business/BinderManager.js',
  './js/business/BoosterManager.js',
  './js/business/CollectionManager.js',
  './js/business/ColorManager.js',
  './js/business/DailyRewardManager.js',
  './js/business/DateSyncManager.js',
  './js/business/GachaEngine.js',
  './js/business/FeatureManager.js',
  './js/business/GiftManager.js',
  './js/business/MinePickManager.js',
  './js/business/SetAnnouncementManager.js',
  './js/business/MiningManager.js',
  './js/business/TraderManager.js',
  './js/business/ProfileIconManager.js',
  './js/business/ProfileCardManager.js',
  './js/business/ProfileManager.js',
  './js/business/PromoManager.js',
  './js/business/PromoSet.js',
  './js/business/RedeemManager.js',
  './js/business/SparksManager.js',
  './js/business/TitleManager.js',
  './js/business/TrophyManager.js',
  './js/business/UserItemCode.js',
  './js/classes/Card.js',
  './js/classes/SaveFile.js',
  './js/models/StorageRepository.js',
  './js/utils/AnimationManager.js',
  './js/utils/BinderCode.js',
  './js/utils/BoosterCode.js',
  './js/utils/BoosterRenderManager.js',
  './js/utils/CardTilt.js',
  './js/utils/Clipboard.js',
  './js/utils/Compression.js',
  './js/utils/ConfigLoader.js',
  './js/utils/DeepLink.js',
  './js/utils/EventBus.js',
  './js/utils/FocusMode.js',
  './js/utils/FoilManager.js',
  './js/utils/GlowManager.js',
  './js/utils/I18n.js',
  './js/utils/ScrollHint.js',
  './js/utils/Shine.js',
  './js/utils/SoundManager.js',
  './js/utils/ThemeManager.js',
  /* Configuration and data: the settings screen, the two languages and the card catalogues. Without
     them the game boots but has nothing to open. */
  './settings/config.json',
  './settings/cardsets.json',
  './settings/colors.json',
  './settings/i18n/fr.json',
  './settings/i18n/en.json',
  './settings/codes.json',
  './settings/daily_connect_rewards.json',
  './settings/defaultRarity.json',
  './settings/mining.json',
  './settings/default_profile_icons.json',
  './settings/default_titles.json',
  './settings/boosters_trophy.json',
  './settings/global_trophy.json',
  './settings/overlay.json',
  './settings/sounds.json',
  './data/boosters/A1.json',
  './data/boosters/A2.json',
  './data/icon.json',
  './data/profile_icons/A1.json',
  './data/titles/A1.json',
  './data/shop/pinned_offers.json',
  /* Promo cards: one file per series, and a series without promos simply has none. Only the files
     that ship are listed (a missing entry costs a warning, never the installation); a promo file
     added later is fetched and stored by the runtime strategy on the visit that needs it. */
  './data/promo_cards/A1.json',
  './data/trophies/A1.json',
  /* The 374 MB of illustrations under `cards/` and the booster artworks (11 MB) are left to the
     runtime strategy: they are far too big to fetch up front, and the screen that uses one of them
     has to be visited before it can be needed offline anyway. What is stored here is what the core
     loop cannot do without, where a missing file is not a missing decoration: the shared card back
     (drawn on every face-down card), the 3D booster model and the (small) opening and interface
     sounds. */
  './assets/img/card_back.png',
  /* The counters of the header, in BOTH inks: they sit on screen from the first paint and the active
     theme decides which half of each pair is drawn (`js/utils/ThemeIcons.js`). Precache only the
     black file and a player on `dark` would open the app offline with four empty counters. */
  './assets/img/daily_boosters.png',
  './assets/img/daily_boosters_dark.png',
  './assets/img/bonus_booster.png',
  './assets/img/bonus_booster_dark.png',
  './assets/img/binders.png',
  './assets/img/binders_dark.png',
  './assets/img/sparks.png',
  /* The 41 frames of the mine chest, packed into one 1050 × 900 sheet (7 columns): one request of
     65 KB instead of an animated webp whose frames the view could not address one by one. */
  './assets/img/chest-sprite.webp',
  './assets/boostermodel.glb',
  './assets/sound/booster_opening.mp3',
  './assets/sound/card_return.mp3',
  './assets/sound/card_rarity_3.mp3',
  './assets/sound/card_rarity_4.mp3',
  './assets/sound/card_rarity_5.mp3',
  /* The interface map of `settings/sounds.json` is small (a few tens of KB) and plays on the very
     first tab switch, so it belongs to the shell: precaching it with the reload cache mode is also
     what makes a corrected sound file reach a player whose HTTP cache still holds the previous one. */
  './assets/sound/ui/nav_view.mp3',
  './assets/sound/ui/nav_back.mp3',
  './assets/sound/ui/modal_open.mp3',
  './assets/sound/ui/modal_close.mp3',
  './assets/sound/ui/wandering_open.mp3',
  './assets/sound/ui/wandering_close.mp3',
  './assets/sound/ui/chest_open.mp3',
  './assets/sound/ui/chest_close.mp3',
  './assets/sound/ui/panel_open.mp3',
  './assets/sound/ui/panel_close.mp3',
  './assets/sound/ui/filter_change.mp3',
  './assets/sound/ui/section_switch.mp3',
  './assets/sound/ui/card_open.mp3',
  './assets/sound/ui/card_close.mp3',
  './assets/sound/ui/reveal_step.mp3',
  './assets/sound/ui/notification_show.mp3'
];

/**
 * Third-party files precached into `CDN_CACHE`, so the opening screen keeps its 3D booster with no
 * network at all.
 *
 * The list is exactly what `Booster3DRenderer` imports, version included: it loads `three`,
 * `three/addons/loaders/GLTFLoader.js` and `three/addons/environments/RoomEnvironment.js`, and the
 * loader pulls `../utils/BufferGeometryUtils.js` in turn. The import map of `index.html` resolves
 * those bare specifiers to the URLs below, so a typo here is a silently uncached module rather than
 * a broken page - which is why the four are spelled out in full instead of built from three pieces.
 *
 * Fetching them at install costs about 1.4 MB on top of the shell, and saves nothing to the player:
 * the opening screen downloads the same files a few seconds later anyway. A missing one only costs
 * the 2D fallback of the booster, never the game.
 */
const PRECACHE_CDN_URLS = [
  'https://unpkg.com/three@0.160.0/build/three.module.js',
  'https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js',
  'https://unpkg.com/three@0.160.0/examples/jsm/environments/RoomEnvironment.js',
  'https://unpkg.com/three@0.160.0/examples/jsm/utils/BufferGeometryUtils.js'
];

/* =============================================================================
   install - fill the shell cache
   ============================================================================= */

self.addEventListener('install', (event) => {
  event.waitUntil(precache());
});

/**
 * Stores every entry of `PRECACHE_URLS` (in the shell cache) and of `PRECACHE_CDN_URLS` (in the CDN
 * cache, where the cache-first strategy looks for them).
 *
 * A single entry that cannot be stored must not abort the whole installation (the CDN unreachable
 * on a flaky network, a file removed from the deployment...): each one is fetched on its own and
 * the failures are reported together. The installation still succeeds, and the runtime strategy
 * picks the missing files up on the visit that requests them.
 *
 * `cache: 'reload'` is what guarantees a fresh copy: without it the browser could hand back the
 * HTTP cache, and a version bump could silently precache the previous files.
 *
 * @returns {Promise<void>} Resolves once the shell is stored (or its failures reported).
 */
async function precache() {
  const shell = await caches.open(SHELL_CACHE);
  const cdn = await caches.open(CDN_CACHE);

  /**
   * Fetches one URL into one cache.
   *
   * @param {Cache} cache - Destination cache.
   * @param {string} url - Absolute or relative (to this worker) URL to store.
   * @returns {Promise<string|null>} A description of the failure, or null on success.
   */
  const store = async (cache, url) => {
    try {
      await cache.add(new Request(url, { cache: 'reload' }));
      return null;
    } catch (error) {
      return `${url} (${error.message})`;
    }
  };

  const failures = await Promise.all([
    ...PRECACHE_URLS.map((url) => store(shell, url)),
    ...PRECACHE_CDN_URLS.map((url) => store(cdn, url))
  ]);

  const missing = failures.filter((failure) => failure !== null);
  if (missing.length > 0) {
    console.warn('[SW] Not precached:', missing.join(', '));
  }

  /* The new worker takes over on this visit rather than waiting for every tab of the game to be
     closed; `activate` then claims the open pages. The HTML is never served stale (see the fetch
     strategy), so this cannot show an outdated screen. */
  await self.skipWaiting();
}

/* =============================================================================
   activate - drop the previous version, take control of the open pages
   ============================================================================= */

self.addEventListener('activate', (event) => {
  event.waitUntil(activate());
});

/**
 * Deletes the caches left by an earlier version of this worker and starts controlling the pages.
 *
 * Only the caches carrying `CACHE_PREFIX` are touched: several projects of the host share one
 * origin, and their caches are none of this worker's business.
 *
 * @returns {Promise<void>} Resolves once the outdated caches are gone and the clients are claimed.
 */
async function activate() {
  const names = await caches.keys();
  const outdated = names.filter((name) => name.startsWith(CACHE_PREFIX) && !OWNED_CACHES.has(name));
  await Promise.all(outdated.map((name) => caches.delete(name)));
  await self.clients.claim();
}

/* =============================================================================
   fetch - one strategy per kind of request
   ============================================================================= */

self.addEventListener('fetch', (event) => {
  const request = event.request;

  /* Only the GETs of the browser are handled: a POST (there is none in the game) and a HEAD must
     reach the server untouched. */
  if (request.method !== 'GET') return;

  /* A media element seeking in a sound asks for a byte range; the answer is a 206, which the Cache
     API refuses to store, and a cached full body is not a valid substitute. Left to the browser. */
  if (request.headers.has('range')) return;

  /* `no-store`, `reload` and `no-cache` all mean "do not answer me with what you already have".
     The game uses the first one for the settings, the gift list and the redeem codes, so these
     requests are handed back to the browser, cache untouched, and reach the server. */
  if (request.cache === 'no-store' || request.cache === 'reload' || request.cache === 'no-cache') return;

  const url = new URL(request.url);

  /* Cross-origin: only the pinned CDN is cached, everything else is left alone - the time providers
     and the Google Sheets exports are only worth anything when they are fresh. */
  if (url.origin !== self.location.origin) {
    if (CDN_ORIGINS.has(url.origin)) {
      event.respondWith(cacheFirst(request, CDN_CACHE));
    }
    return;
  }

  if (isPrivate(url.pathname)) return;

  /* A page: the network is authoritative, the cache is the safety net. */
  if (request.mode === 'navigate') {
    event.respondWith(navigationRequest(request));
    return;
  }

  /* Anything else same-origin: a stylesheet, a module, a JSON catalogue, an illustration, a sound.
     They are immutable in practice (the game ships them, the player never writes one), so serving
     the stored copy while the fresh one downloads behind it is both instant and self-updating. */
  event.respondWith(staleWhileRevalidate(request));
});

/**
 * True when a same-origin path must stay out of every cache.
 *
 * @param {string} pathname - Path of the request, starting with a slash.
 * @returns {boolean} Whether the request is bypassed (network, and nothing stored).
 */
function isPrivate(pathname) {
  return BYPASS_PATTERNS.some((pattern) => pattern.test(pathname));
}

/**
 * Answers a page navigation.
 *
 * Order: the network, then the stored copy of THAT page, then `index.html`. The last step is what
 * the single-page application needs - `/`, `/?lang=en` and a deep link are all the same document,
 * so an offline reload of any of them must open the game rather than a browser error page. The
 * fallback is only reached when the exact URL is not cached either, which keeps `overlay.html` from
 * being answered with the game.
 *
 * @param {Request} request - The navigation request.
 * @returns {Promise<Response>} The live page, the stored one, or a plain offline notice.
 */
async function navigationRequest(request) {
  try {
    return await fetch(request);
  } catch (error) {
    const cached = await caches.match(request) || await caches.match(SHELL_INDEX);
    if (cached) return cached;
    return offlineNotice();
  }
}

/**
 * Serves a stored copy immediately and refreshes it in the background.
 *
 * The refresh is deliberately not awaited: the player gets the animation now and the next visit gets
 * the new file. A failed refresh is not an error - the stored copy is already the answer - so it is
 * logged and dropped instead of rejecting the promise, which would surface as an unhandled rejection
 * for every request made offline.
 *
 * TWO CACHES ARE READ, in this order:
 *   1. the runtime cache, which holds every file this worker has already passed through - the
 *      freshest copy there is, so it must never be shadowed by an older one;
 *   2. the shell cache, filled at install time. Without this fallback the precache would be dead
 *      weight: a player who installs the game and goes offline WITHOUT a reload in between would
 *      find an empty runtime cache, and every module, stylesheet and catalogue would answer 503
 *      even though they are all sitting in the shell cache.
 *
 * Only a plain same-origin `basic` 200 is stored: an error page or an opaque response would poison
 * the cache for every later visit.
 *
 * @param {Request} request - The asset request.
 * @returns {Promise<Response>} The stored copy, or the network answer when nothing is stored yet.
 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const shell = await caches.open(SHELL_CACHE);
  const cached = (await cache.match(request)) ?? (await shell.match(request));

  const refresh = fetch(request).then((response) => {
    if (response.ok && response.type === 'basic') {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  });

  if (cached) {
    refresh.catch(() => {});
    return cached;
  }

  try {
    return await refresh;
  } catch (error) {
    console.warn('[SW] Offline and not cached:', request.url);
    return offlineNotice();
  }
}

/**
 * Serves a stored copy first, the network only when there is none.
 *
 * Used for the pinned CDN: `three@0.160.0` can never answer anything but the same bytes, so asking
 * for them again is a waste of the player's connection.
 *
 * @param {Request} request - The cross-origin module request.
 * @param {string} cacheName - Cache to read from and write to.
 * @returns {Promise<Response>} The stored copy, the network answer, or a failed response.
 */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok || response.type === 'opaque') {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (error) {
    /* A failed module import is not a broken page: `Booster3DRenderer` catches it and shows the 2D
       booster. Reporting the request is enough to explain the fallback in the console. */
    console.warn('[SW] Offline and not cached:', request.url);
    return Response.error();
  }
}

/**
 * Builds the last-resort answer of an offline request that nothing has stored yet.
 *
 * @returns {Response} A 503 with a short plain-text body.
 */
function offlineNotice() {
  return new Response('MineCards : ressource non disponible hors-ligne.', {
    status: 503,
    statusText: 'Offline',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

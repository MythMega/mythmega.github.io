/**
 * Client HTTP minimal vers l'API publique de SullyGnome.
 *
 * SullyGnome n'envoie aucun en-tête CORS : un navigateur ne peut pas lire
 * ses réponses depuis une autre origine. On passe donc par des relais CORS
 * publics (allorigins), éventuellement précédés d'un relais personnel
 * configuré dans les Réglages (le moyen le plus fiable : un Worker
 * Cloudflare déployé en 2 minutes, voir worker/worker.js).
 *
 * Les relais sont tentés EN PARALLÈLE (Promise.any) : la première réponse
 * valide gagne, un relais lent ne bloque plus les autres.
 * NB : l'URL cible contient une espace littérale pour le filtre vide (le
 * `%20` attendu par SullyGnome). Si on écrivait `%20` ici, encodeURIComponent
 * produirait `%2520`, que les relais n'acceptent pas.
 */
import Streamer from '../models/Streamer.js';
import { parseGameRow } from '../models/GameEntry.js';

const BASE_URL = 'https://sullygnome.com';

// Période analysée en jours (~20 ans) et nombre maximal de jeux conservés.
const DEFAULT_PERIOD_DAYS = 7300;
const DEFAULT_GAME_LIMIT = 200;

const REQUEST_TIMEOUT_MS = 12_000;
const RETRY_ROUNDS = 3;
const RETRY_DELAY_BASE_MS = 600;
const GAMES_PER_PAGE = 100; // SullyGnome plafonne chaque page à 100 lignes
const NON_EXTENDED_LIMIT = 50; // Nombre de jeux par défaut (mode normal)

const PROXY_STORAGE_KEY = 'streamguessr.proxyUrl';
const USE_ALLORIGINS_KEY = 'streamguessr.useAllorigins';

function readConfiguredProxy() {
  try {
    return (localStorage.getItem(PROXY_STORAGE_KEY) || '').trim();
  } catch {
    return '';
  }
}

function readUseAllorigins() {
  const raw = localStorage.getItem(USE_ALLORIGINS_KEY);
  return raw === null ? true : raw === 'true';
}

/**
 * Relais CORS publics de secours. allorigins est le plus connu mais peut
 * renvoyer des 522 ; on ajoute deux alternatives pour ne pas dépendre d'un
 * seul point de défaillance. Désactivables via le toggle "allorigins"
 * dans les Réglages (au cas où l'utilisateur préférerait son Worker).
 */
const PUBLIC_RELAYS = [
  { template: 'https://api.allorigins.win/get?url=', unwrap: true },
  { template: 'https://api.allorigins.win/raw?url=', unwrap: false },
  { template: 'https://corsproxy.io/?uri=', unwrap: false },
  { template: 'https://api.codetabs.com/v1/proxy?uri=', unwrap: false },
];

/**
 * Construit la liste des relais à tenter pour une URL donnée : le relais
 * personnel (s'il est configuré) se place en tête, puis les relais publics
 * fiables (allorigins + 2 alternatives en parallèle via Promise.any).
 * L'appel direct n'est essayé que si la cible est déjà même-origine (donc
 * jamais dans un navigateur depuis GitHub Pages / localhost) : ainsi plus
 * aucune erreur CORS ne pollue la console.
 */
function buildRelays(url) {
  const relays = [];

  const custom = readConfiguredProxy();
  if (custom) {
    relays.push({
      build: () => `${custom}?url=${encodeURIComponent(url)}`,
      unwrap: false,
    });
  }

  if (readUseAllorigins()) {
    for (const { template, unwrap } of PUBLIC_RELAYS) {
      const proxyUrl = `${template}${encodeURIComponent(url)}`;
      relays.push({ build: () => proxyUrl, unwrap });
    }
  }

  try {
    const sameOrigin = new URL(url).origin === window.location.origin;
    if (sameOrigin) {
      relays.push({ build: () => url, unwrap: false });
    }
  } catch {
    // URL invalide : on garde les relais ci-dessus.
  }

  return relays;
}

export class StreamerNotFoundError extends Error {
  constructor(message = 'Streamer not found') {
    super(message);
    this.name = 'StreamerNotFoundError';
  }
}

export class NoGamesError extends Error {
  constructor(message = 'No games data') {
    super(message);
    this.name = 'NoGamesError';
  }
}

function fetchWithTimeout(url, { signal } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  // On combine le timeout local avec le signal partagé d'annulation.
  const options = { signal: controller.signal };

  if (signal) {
    if (signal.aborted) {
      clearTimeout(timer);
      throw new DOMException('Aborted', 'AbortError');
    }
    signal.addEventListener('abort', () => {
      controller.abort();
    });
  }

  return fetch(url, options).finally(() => clearTimeout(timer));
}

/**
 * Tente tous les relais en parallèle : la première réponse valide gagne.
 * Un AbortController partagé est aborté dès qu'un relais réussit, ce qui
 * libère immédiatement les connexions des autres (pas de fuite réseau).
 */
async function fetchThroughRelays(url) {
  const relays = buildRelays(url);
  if (relays.length === 0) {
    throw new Error('Aucun relais CORS disponible');
  }

  const controller = new AbortController();
  const { signal } = controller;

  const attempts = relays.map((relay) =>
    fetchThroughProxy(url, relay, { signal })
  );

  try {
    return await Promise.any(attempts);
  } finally {
    // On abandonne les relais toujours en vol → économise la bande passante.
    controller.abort();
  }
}

async function fetchThroughProxy(url, proxy, { signal } = {}) {
  const proxyUrl = proxy.build(url);

  let response;
  try {
    response = await fetchWithTimeout(proxyUrl, { signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Relay aborted: ${proxyUrl}`);
    }
    throw err;
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${proxyUrl}`);
  }

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('Non-JSON response');
  }

  // allorigins `get` enveloppe la réponse dans { contents, status }.
  if (proxy.unwrap) {
    if (!payload || typeof payload !== 'object' || !('contents' in payload)) {
      throw new Error('Invalid proxy envelope');
    }
    if (payload.status && Number(payload.status.http_code) !== 200) {
      throw new Error(`Origin HTTP ${payload.status.http_code}`);
    }
    try {
      payload = JSON.parse(payload.contents);
    } catch {
      throw new Error('Invalid envelope content');
    }
  }
  return payload;
}

/**
 * Boucles sur l'ensemble des relais en parallèle, avec backoff entre les
 * rounds. On attend au plus ~36 s au total : inutile de laisser patienter
 * davantage, le cache expiré ou l'écran d'erreur prennent le relais.
 */
async function requestJson(url) {
  let lastError = null;

  for (let round = 0; round < RETRY_ROUNDS; round += 1) {
    try {
      return await fetchThroughRelays(url);
    } catch (err) {
      lastError = err;
    }
    if (round + 1 < RETRY_ROUNDS) {
      await sleep(RETRY_DELAY_BASE_MS * (round + 1));
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Request failed');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Recherche un pseudo Twitch et renvoie le Streamer correspondant,
 * ou null s'il est introuvable.
 *
 * Stratégie : réseau d'abord, puis données locales embarquées dans
 * `data/main_users/profile_data/` en fallback (utile quand les relais
 * CORS publics sont down).
 */
export async function searchStreamerByName(pseudo) {
  const url = `${BASE_URL}/api/standardsearch/${encodeURIComponent(pseudo)}`;

  let results;
  try {
    results = await requestJson(url);
  } catch (networkError) {
    // Fallback : données locales embarquées.
    results = await fetchLocalProfile(pseudo);
    if (!results) throw networkError;
  }

  if (!Array.isArray(results) || results.length === 0) {
    // Dernière tentative : données locales.
    results = await fetchLocalProfile(pseudo);
    if (!Array.isArray(results) || results.length === 0) return null;
  }

  // `itemtype: 1` désigne une chaîne ; on préfère ces entrées aux jeux,
  // puis on accepte la première entrée possédant un `siteurl`.
  const candidate =
    results.find((entry) => Number(entry.itemtype) === 1) ||
    results.find((entry) => entry.siteurl);
  if (!candidate) return null;

  return new Streamer({
    name: candidate.displaytext || candidate.siteurl,
    sullyId: Number(candidate.value),
    boxArtUrl: candidate.boxart || '',
  });
}

/**
 * Charge le profil local embarqué pour un pseudo donné.
 * Retourne le tableau brut (ou null si introuvable).
 */
async function fetchLocalProfile(pseudo) {
  try {
    const normalized = normalizePseudo(pseudo);
    const response = await fetch(
      `./data/main_users/profile_data/${encodeURIComponent(normalized)}.json`,
      { cache: 'no-cache' }
    );
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/** Normalise un pseudo pour correspondre aux fichiers locaux. */
function normalizePseudo(pseudo) {
  return pseudo.toLowerCase().trim().replace(/\s+/g, '');
}

/**
 * Récupère les jeux les plus streamés d'un streamer sur la période donnée,
 * triés par temps de stream décroissant.
 *
 * SullyGnome plafonne chaque page à 100 lignes : pour atteindre les 200 jeux
 * demandés, on interroge les pages 0 et 100 en parallèle. Si une page échoue
 * (proxys instables), on garde l'autre plutôt que de tout perdre ; chaque page
 * passe elle-même par la chaîne de transport tolérante aux pannes.
 *
 * L'espace littérale dans l'URL encode le filtre vide attendu par l'API.
 *
 * @param {number} sullyId - ID interne SullyGnome du streamer.
 * @param {object} opts
 * @param {boolean} opts.extended - Si true, charge 200 jeux ; si false, 50.
 * @param {string} opts.pseudo - Pseudo du streamer (pour le fallback local).
 * @param {number} opts.periodDays - Période analysée en jours.
 * @param {number} opts.limite - Nombre de jeux demandé (surcharge extended).
 */
export async function fetchStreamerGames(
  sullyId,
  { extended = false, pseudo = '', periodDays = DEFAULT_PERIOD_DAYS, limit = 0 } = {}
) {
  // Déterminer la limite : 50 par défaut, 200 si étendu, ou valeur explicite.
  const gameLimit = limit || (extended ? DEFAULT_GAME_LIMIT : NON_EXTENDED_LIMIT);
  const pages = [];
  for (let offset = 0; offset < gameLimit; offset += GAMES_PER_PAGE) {
    pages.push(offset);
    if (pages.length >= 10) break; // garde-fou : jamais plus de 1000 jeux
  }

  try {
    const results = await Promise.allSettled(
      pages.map((offset) =>
        requestJson(
          `${BASE_URL}/api/tables/channeltables/games/${periodDays}/${sullyId}/ /1/2/desc/${offset}/${GAMES_PER_PAGE}`
        )
      )
    );

    const rows = results.flatMap((result) =>
      result.status === 'fulfilled' && Array.isArray(result.value && result.value.data)
        ? result.value.data
        : []
    );

    if (rows.length > 0) {
      return rows.map(parseGameRow).filter(Boolean);
    }
  } catch (apiError) {
    // L'API a échoué : on tente le fallback local ci-dessous.
  }

  // Fallback : données locales embarquées (quand les relais CORS sont down).
  if (pseudo) {
    const localGames = await fetchLocalGames(pseudo);
    if (localGames.length > 0) {
      // Limiter au nombre demandé.
      return localGames.slice(0, gameLimit);
    }
  }

  throw new Error('Aucune donnée de jeu récupérée (réseau et cache local vides)');
}

/**
 * Charge les données de jeux locales embarquées pour un pseudo donné.
 * Retourne un tableau de GameEntry (ou vide si introuvable).
 */
async function fetchLocalGames(pseudo) {
  try {
    const normalized = normalizePseudo(pseudo);
    const response = await fetch(
      `./data/main_users/game_data/${encodeURIComponent(normalized)}.json`,
      { cache: 'no-cache' }
    );
    if (!response.ok) return [];
    const data = await response.json();
    if (!data || !Array.isArray(data.data)) return [];
    return data.data.map(parseGameRow).filter(Boolean);
  } catch {
    return [];
  }
}
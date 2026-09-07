/**
 * Point d'entrée de la donnée : combine la recherche SullyGnome et le cache
 * IndexedDB. Un profil chargé est conservé 14 jours, ensuite on le
 * re-télécharge à la prochaine visite (évite les appels réseau répétés).
 */
import GameEntry from '../models/GameEntry.js';
import Streamer from '../models/Streamer.js';
import {
  keyForPseudo,
  readCached,
  writeCached,
  clearCache,
  countCached,
  isFresh,
} from './database.js';
import {
  searchStreamerByName,
  fetchStreamerGames,
  StreamerNotFoundError,
  NoGamesError,
} from './sullygnome-client.js';

/**
 * Charge le profil d'un streamer : cache local, sinon API SullyGnome.
 * `onPhase` reçoit les étapes pour alimenter l'écran de chargement.
 *
 * @param {string} pseudo - Pseudo Twitch du streamer.
 * @param {object} opts
 * @param {function} opts.onPhase - Callback de progression.
 * @param {boolean} opts.extended - Si true, charge 200 jeux ; si false, 50.
 */
export async function loadStreamer(pseudo, { onPhase = () => {}, extended = false } = {}) {
  const normalized = pseudo.trim();
  if (!normalized) throw new StreamerNotFoundError();

  onPhase('search');
  const cacheKey = keyForPseudo(normalized);
  const cached = await readCached(cacheKey);

  // Cache frais (< 14 jours) : aucun appel réseau.
  if (cached && isFresh(cached) && cached.extended === extended) {
    onPhase('cache');
    return buildResult(cached, { fromCache: true });
  }

  onPhase('fetch');
  try {
    const streamer = await searchStreamerByName(normalized);
    if (!streamer) throw new StreamerNotFoundError(`No profile for "${normalized}"`);

    const games = await fetchStreamerGames(streamer.sullyId, {
      extended,
      pseudo: normalized,
    });
    if (games.length === 0) throw new NoGamesError(`No data for "${normalized}"`);

    onPhase('done');
    await writeCached({
      key: cacheKey,
      streamer: streamer.toPlain(),
      games: games.map((entry) => entry.toPlain()),
      cachedAt: Date.now(),
      extended,
    });

    return { streamer, games, fromCache: false };
  } catch (error) {
    // Réseau indisponible (proxys CORS instables, panne...) mais une vieille
    // copie existe : on la restitue plutôt que de bloquer la partie.
    // Les agrégats sur 20 ans évoluent très peu d'un jour à l'autre.
    if (cached) {
      onPhase('cache');
      return buildResult(cached, { fromCache: true, stale: true });
    }
    throw error;
  }
}

function buildResult(cached, { fromCache, stale = false }) {
  return {
    streamer: Streamer.fromPlain(cached.streamer),
    games: cached.games.map((entry) => GameEntry.fromPlain(entry)),
    fromCache,
    stale,
  };
}

export { clearCache, countCached };
export { StreamerNotFoundError, NoGamesError } from './sullygnome-client.js';
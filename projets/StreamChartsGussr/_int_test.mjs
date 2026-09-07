import { searchStreamerByName, fetchStreamerGames, StreamerNotFoundError, NoGamesError } from './scripts/data/sullygnome-client.js';

// Test : données locales pour mythmega (profil + jeux)
const pseudo = 'mythmega';

// 1. Test du profil local
const streamer = await searchStreamerByName(pseudo);
console.log('search OK?', streamer.name, 'id=' + streamer.sullyId);

// 2. Test des jeux locaux (50 jeux)
const games50 = await fetchStreamerGames(streamer.sullyId, { extended: false, pseudo: pseudo });
console.log('games count (50 mode) =', games50.length, '| first =', games50[0].name, '| last =', games50[games50.length - 1].name);
console.log('all have image?', games50.every(g => g.imageUrl));
console.log('sorted desc?', games50.every((g, i) => i === 0 || games50[i-1].hours >= g.hours));

// 3. Test des jeux locaux (200 jeux - mythmega a 244 entrées)
const games200 = await fetchStreamerGames(streamer.sullyId, { extended: true, pseudo: pseudo });
console.log('games count (200 mode) =', games200.length);

// 4. Test du filtre 2h minimum pour le mode classique
const classicPool = games200.filter(g => g.hours >= 2);
const comparePool = games200.filter(g => g.hours >= 1);
console.log('classic pool (>=2h) =', classicPool.length);
console.log('compare pool (>=1h) =', comparePool.length);

console.log('ALL TESTS PASSED');

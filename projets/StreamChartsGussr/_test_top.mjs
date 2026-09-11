import TopGame from './scripts/business/top-game.js';

const entries = [
  { name: 'Minecraft', hours: 10000, boxArtUrl: '' },
  { name: 'The Legend of Zelda: Breath of the Wild', hours: 12000, boxArtUrl: '' },
  { name: 'Zelda II', hours: 5000, boxArtUrl: '' },
  { name: 'Fortnite', hours: 3000, boxArtUrl: '' },
  { name: 'Tetris', hours: 4000, boxArtUrl: '' },
];

const game = new TopGame(entries, 'easy');
let ok = true;
const check = (label, cond) => { console.log(cond ? 'PASS' : 'FAIL', '-', label); if (!cond) ok = false; };

// 1. Jeu hors top mais streame (rank >= 10) -> miss streamed
const r1 = game.guess('Half-Life'); // absent de entries
check('miss jamais streame', r1.status === 'miss' && r1.streamed === false);

// 2. Jeu streame mais pas dans le top 10 : on ajoute un 11e jeu streame
const bigEntries = [
  { name: 'A', hours: 100, boxArtUrl: '' },
  { name: 'B', hours: 90, boxArtUrl: '' },
  { name: 'C', hours: 80, boxArtUrl: '' },
  { name: 'D', hours: 70, boxArtUrl: '' },
  { name: 'E', hours: 60, boxArtUrl: '' },
  { name: 'F', hours: 50, boxArtUrl: '' },
  { name: 'G', hours: 40, boxArtUrl: '' },
  { name: 'H', hours: 30, boxArtUrl: '' },
  { name: 'I', hours: 20, boxArtUrl: '' },
  { name: 'J', hours: 10, boxArtUrl: '' },
  { name: 'K', hours: 5, boxArtUrl: '' }, // streame mais hors top 10
];
const g2 = new TopGame(bigEntries, 'easy');
const r2 = g2.guess('K');
check('miss streame hors top', r2.status === 'miss' && r2.streamed === true && r2.game.hours === 5);
check('rang reel (infini) renvoye', r2.rank === 11);
check('wrongGuesses apres miss', g2.wrongGuesses === 1);

// 3. Jeu du top trouve -> found, pas d'erreur
const r3 = g2.guess('A');
check('found', r3.status === 'found' && g2.correctGuesses === 1 && g2.wrongGuesses === 1);

// 4. Re-saisir un jeu deja trouve -> already, PAS une erreur
const r4 = g2.guess('A');
check('already sans erreur', r4.status === 'already' && g2.wrongGuesses === 1 && g2.correctGuesses === 1);

console.log(ok ? 'ALL GUESS TESTS PASSED' : 'SOME TESTS FAILED');
process.exit(ok ? 0 : 1);
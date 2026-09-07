import TopGame from './scripts/business/top-game.js';

const entries = [
  { name: 'The Legend of Zelda: Breath of the Wild', hours:12000, boxArtUrl: '' },
  { name: 'Minecraft', hours:10000, boxArtUrl: '' },
  { name: 'Zelda II', hours:5000, boxArtUrl: '' },
  { name: 'Tetris', hours:4000, boxArtUrl: '' },
  { name: 'Fortnite', hours:3000, boxArtUrl: '' },
];

const game = new TopGame(entries, 'easy', ['Minecraft', 'Half-Life']);
console.log('total', game.total);
const r1 = game.search('minecraft');
console.log('search exact', JSON.stringify(r1));
const r2 = game.search('zelda breath');
console.log('search inter', JSON.stringify(r2));
const r3 = game.search('fortnit');
console.log('search accent', JSON.stringify(r3));
const r4 = game.guess('Half-Life');
console.log('guess miss', JSON.stringify(r4));
const r5 = game.guess('MINECRAFT ');
console.log('guess found', JSON.stringify(r5));
console.log('stats', game.correctGuesses, game.wrongGuesses);
const h = game.hint();
console.log('hint', JSON.stringify(h));
console.log('elapsed', game.elapsedSeconds);
game.abandon();
console.log('isOver', game.isOver, 'remaining', game.remaining.length);
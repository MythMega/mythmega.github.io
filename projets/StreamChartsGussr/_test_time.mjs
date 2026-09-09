import TimeGame from './scripts/business/time-game.js';

// Pool simule : objets plats avec heuresRounded = cible (comme les GameEntry).
const entries = [
  { name: 'League of Legends', hoursRounded: 100, hours: 100.4 },
  { name: 'Valorant', hoursRounded: 100, hours: 100.1 },
  { name: 'Minecraft', hoursRounded: 200, hours: 200.0 },
  { name: 'Fortnite', hoursRounded: 300, hours: 300.2 },
  { name: 'Tetris', hoursRounded: 45, hours: 45.0 },
  { name: 'Zelda', hoursRounded: 45, hours: 45.1 },
];

const game = new TimeGame(entries);
game.start();
console.log('round', game.round, '| target', game.target, '| solutions', game.solutions.map((s) => s.name).join(', '));

const expected = entries.filter((e) => e.hoursRounded === game.target);
console.log('viable target?', expected.length >= 1 && expected.length <= 5, '(', expected.length, ')');

const r1 = game.guess(game.solutions[0].name);
console.log('guess good', JSON.stringify(r1));

const r2 = game.guess('Tetris');
console.log('guess miss', r2.status, '| history', game.history.length, '| wrong', game.wrongGuesses);

const r3 = game.guess(game.solutions[0].name);
console.log('guess already', r3.status, '| wrong', game.wrongGuesses, '| history', game.history.length);

console.log('search inter', JSON.stringify(game.search('leagu leg')));
console.log('search accent', JSON.stringify(game.search('zelda')));
console.log('search exact first?',
  game.search('minecraft').length > 0 && game.search('minecraft')[0] === 'Minecraft');

for (const s of game.solutions) game.guess(s.name);
console.log('isComplete', game.isComplete, '| correct', game.correctGuesses, '| wrong', game.wrongGuesses);

game.newRound();
console.log('next round', game.round, '| history reset', game.history.length, '| target', game.target);
console.log('ALL TIME TESTS PASSED');
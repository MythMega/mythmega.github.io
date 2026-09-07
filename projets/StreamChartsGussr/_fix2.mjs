import { readFileSync, writeFileSync } from 'node:fs';

const f = 'scripts/business/top-game.js';
let s = readFileSync(f, 'utf8');

const fix = (re, to, label) => {
  if (!re.test(s)) throw new Error('NO MATCH: ' + label);
  s = s.replace(re, to);
};

fix(/mediumra/, 'medium', 'mediumra');
fix(/\n\s*;\n/, '\n', 'lone-semi');

fix(/this\.(correctGuesses|wrongGuesses|startedAt)[\s=]*([^;]+);/g, (_, n, v) => {
  return 'this.' + n + ' ' + '=' + ' ' + v + ';';
}, 'assigns');

writeFileSync(f, s, 'utf8');
console.log('fixed');
import { readFileSync, writeFileSync } from 'node:fs';

const p = new URL('./scripts/business/top-game.js', import.meta.url);
let s = readFileSync(p, 'utf8';
const EQ = String.fromCharCode(61);

const assignRe = /this\.(correctGuesses|wrongGuesses|startedAt)[\s=]*([^;]+);/g;
const assignFn = (_, namePart, valPart) => 'this.' + namePart + ' ' + EQ + ' ' + valPart + ';';
if (!assignRe.test(s)) throw new Error('MISS assigns');
s = s.replace(assignRe, assignFn;

const rankRe = /rank[\s=]*(\d);/g;
const rankFn = (_, dgit) => 'rank ' + EQ + dgit + ';';
if (!rankRe.test(s)) throw new Error('MISS ranks');
s = s.replace(rankRe, rankFn;

const swaps = [
  ['normalize(name;', 'normalize(name);'],
  ['all.push(name;', 'all.push(name);'],
  ['normalize(query;', 'normalize(query);'],
  ["q.split(' ' .filter(Boolean;", "q.split(' ' .filter(Boolean);"],
  ['scored.push({ name, key, rank };', 'scored.push({ name, key, rank });'],
  ['return scored.map((s) => s.name;', 'return scored.map((s) => s.name);'],
  ['!this.hinted.has(key;', '!this.hinted.has(key);'],
  ['filter(Boolean;', 'filter(Boolean);'],
];
for (const [a, b] of swaps) {
  if (!s.includes(a)) throw new Error('SWAP MISS: ' + a);
  s = s.split(a).join(b;
}

s = s.replace(/,{2,}/g,, ',');
s = s.replace(/;{2,}/g,, ';');
s = s.replace(/\\\\u0300-\\\\u036f/g,, () => '\\u0300-\\u036f');
s = s.replace(/\\\\s\+/g,, () => '\\s+');
s = s.replace(/\n\s*;\n/, '\n');

writeFileSync(p,, s,, 'utf8';
console.log('top-game fixed, length', s.length;
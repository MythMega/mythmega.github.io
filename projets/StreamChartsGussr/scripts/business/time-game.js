/**
 * Mode "Time" : un temps de stream (arrondi a l'heure entiere) est affiche,
 * le joueur doit retrouver le ou les jeux streames exactement ce nombre
 * d'heures, parmi le pool des jeux de 2 h minimum (deja filtre en amont).
 *
 * La cible est choisie pour avoir entre 1 et MAX_SOLUTIONS jeux correspondants
 * afin de rester jouable : un temps avec trop de collisions serait ambigu.
 *
 * Le joueur saisit un nom de jeu : l'autocompletion est insensible a la casse
 * et aux accents, et la recherche inter-mots permet de taper des fragments
 * separes (meme fonctionnement que le mode Top). Chaque mauvaise tentative
 * alimente l'historique.
 */
import { shuffle } from './pool.js';

const MAX_SOLUTIONS = 5;

export default class TimeGame {
  constructor(entries) {
    this.entries = [...entries];
    this.round = 0;
    this.history = [];
    this.solutions = [];
    this.found = new Set();
    this.correctGuesses = 0;
    this.wrongGuesses = 0;
  }

  start() {
    this.round = 0;
    this.correctGuesses = 0;
    this.wrongGuesses = 0;
    this.newRound();
  }

  /** Prepare une nouvelle manche : choisit une cible et ses solutions. */
  newRound() {
    this.round += 1;
    this.history = [];
    this.found = new Set();
    this.solutions = pickSolutions(this.entries);
    return { target: this.target, solutions: this.solutions };
  }

  get target() {
    return this.solutions.length ? this.solutions[0].hoursRounded : null;
  }

  get isComplete() {
    return this.solutions.length > 0 && this.found.size >= this.solutions.length;
  }

  get allNames() {
    const seen = new Set();
    const all = [];
    for (const entry of this.entries) {
      const key = normalize(entry.name);
      if (key && !seen.has(key)) {
        seen.add(key);
        all.push(entry.name);
      }
    }
    return all.sort((a, b) => normalize(a).localeCompare(normalize(b)));
  }

  /** Recherche insensible a la casse et aux accents, inter-mots, exact en premier. */
  search(query) {
    const q = normalize(query);
    if (!q) return [];
    const words = q.split(' ').filter(Boolean);
    const scored = [];
    for (const name of this.allNames) {
      const key = normalize(name);
      if (!words.every((word) => key.includes(word))) continue;
      let rank;
      if (key === q) rank = 0;
      else if (key.startsWith(q)) rank = 1;
      else if (key.includes(q)) rank = 2;
      else rank = 3;
      scored.push({ name, key, rank });
    }
    scored.sort((a, b) =>
      a.rank - b.rank ||
      a.key.length - b.key.length ||
      a.key.localeCompare(b.key)
    );
    return scored.map((item) => item.name);
  }

  /** Enregistre un guess de nom de jeu ; alimente l'historique des raters. */
  guess(rawName) {
    const key = normalize(rawName);
    if (!key) return { status: 'invalid' };

    const entry = this.entries.find((game) => normalize(game.name) === key);
    const guessedName = entry ? entry.name : rawName.trim();
    const wrong = !entry || entry.hoursRounded !== this.target;

    if (wrong || this.found.has(key)) {
      this.wrongGuesses++;
      this.history.push({
        name: guessedName,
        hours: entry ? entry.hoursRounded : null,
        hint: this.found.has(key) ? 'already' : 'miss',
      });
      return {
        status: this.found.has(key) ? 'already' : 'miss',
        game: entry || null,
        name: guessedName,
      };
    }

    this.found.add(key);
    this.correctGuesses++;
    return { status: 'found', game: entry };
  }

  isFound(name) {
    return this.found.has(normalize(name));
  }
}

/**
 * Choisit un temps cible dont le nombre de jeux correspondants est jouable.
 * Renvoie les jeux du pool dont les heures arrondies valent la cible.
 */
function pickSolutions(entries) {
  for (const candidate of shuffle(entries)) {
    const target = candidate.hoursRounded;
    const matches = entries.filter((entry) => entry.hoursRounded === target);
    if (matches.length >= 1 && matches.length <= MAX_SOLUTIONS) return matches;
  }
  // Filet de securite : le premier jeu, peu importe le nombre de collisions.
  const fallback = shuffle(entries)[0];
  return entries.filter((entry) => entry.hoursRounded === fallback.hoursRounded);
}

function normalize(name) {
  return String(name)
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}
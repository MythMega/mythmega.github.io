/**
 * Mode "Top" : retrouver les jeux les plus streames du profil.
 *
 * Trois niveaux de difficulte :
 *   - easy   : top 10
 *   - medium : top 20
 *   - hard   : top 50
 *
 * Le joueur saisit un nom de jeu. L'autocompletion est insensible a la
 * casse et aux accents, et la recherche inter-mots permet de taper des
 * fragments separes. Si le jeu fait partie du top N et n'a pas encore ete
 * trouve, la carte s'illumine et revele le nom et le temps de stream.
 */

export const DIFFICULTY = { easy: 10, medium: 20, hard: 50 };

export default class TopGame {
  constructor(entries, difficulty = 'medium', extraSuggestions = []) {
    this.entries = [...entries];
    this.difficulty = difficulty;
    this.limit = DIFFICULTY[difficulty] || DIFFICULTY.medium;
    this.extraSuggestions = extraSuggestions.map(s => s.trim()).filter(Boolean);
    this.start();
  }

  start() {
    this.found = new Set();
    this.hinted = new Set();
    this.abandoned = false;
    this.correctGuesses = 0;
    this.wrongGuesses = 0;
    this.startedAt = Date.now();
  }

  get targets() {
    return this.entries.slice(0, this.limit);
  }

  get total() {
    return this.targets.length;
  }

  get progress() {
    return this.found.size;
  }

  get isComplete() {
    return this.found.size >= this.total;
  }

  get isOver() {
    return this.isComplete || this.abandoned;
  }

  get remaining() {
    return this.targets.filter(e => !this.found.has(normalize(e.name)));
  }

  get elapsedSeconds() {
    return Math.max(0, Math.floor((Date.now() - this.startedAt) / 1000));
  }

  get allNames() {
    const seen = new Set();
    const all = [];
    for (const name of this.entries.map(e => e.name).concat(this.extraSuggestions)) {
      const key = normalize(name);
      if (key && !seen.has(key)) {
        seen.add(key);
        all.push(name);
      }
    }
    return all.sort((a, b) => normKey(a).localeCompare(normKey(b)));
  }

  search(query) {
    const q = normalize(query);
    if (!q) return [];
    const words = q.split(' ').filter(Boolean);
    const scored = [];
    for (const name of this.allNames) {
      const key = normalize(name);
      if (!words.every(w => key.includes(w))) continue;
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
    return scored.map(s => s.name);
  }

  guess(rawName) {
    const normalized = normalize(rawName);
    if (!normalized) return { status: 'invalid' };
    const target = this.targets.find(e => normalize(e.name) === normalized);
    if (!target) {
      this.wrongGuesses++;
      return { status: 'miss' };
    }
    if (this.found.has(normalized)) {
      this.wrongGuesses++;
      return { status: 'already', game: target };
    }
    this.found.add(normalized);
    this.correctGuesses++;
    return { status: 'found', game: target };
  }

  isFound(gameName) {
    return this.found.has(normalize(gameName));
  }

  hint() {
    if (this.isComplete) return null;
    const target = this.targets.find(e => {
      const key = normalize(e.name);
      return !this.found.has(key) && !this.hinted.has(key);
    });
    if (!target) return null;
    this.hinted.add(normalize(target.name));
    const trimmed = target.name.trim();
    return { game: target, letter: [...trimmed][0] || '' };
  }

  abandon() {
    this.abandoned = true;
  }
}

function normalize(name) {
  return String(name)
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normKey(name) {
  return normalize(name);
}

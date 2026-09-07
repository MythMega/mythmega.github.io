/**
 * Un jeu diffusé par un streamer sur la période analysée.
 *
 * `streamTimeMinutes` est exprimé en minutes : c'est l'unité brute renvoyée
 * par l'API SullyGnome pour la table `channeltables/games`.
 */
export default class GameEntry {
  constructor({ name, slug = '', streamTimeMinutes = 0, boxArtUrl = '', rank = 0 }) {
    this.name = name;
    this.slug = slug;
    this.streamTimeMinutes = streamTimeMinutes;
    this.boxArtUrl = boxArtUrl;
    this.rank = rank;
  }

  /** Nombre d'heures exact (décimal). */
  get hours() {
    return this.streamTimeMinutes / 60;
  }

  /** Heures arrondies à l'entier : cible officielle du mode Classique. */
  get hoursRounded() {
    return Math.round(this.hours);
  }

  static fromPlain(plain) {
    return new GameEntry(plain);
  }

  toPlain() {
    return {
      name: this.name,
      slug: this.slug,
      streamTimeMinutes: this.streamTimeMinutes,
      boxArtUrl: this.boxArtUrl,
      rank: this.rank,
    };
  }
}

/**
 * Rehausse la miniature fournie par SullyGnome (136x190) vers une taille
 * plus lisible (285x380) et retire les paramètres de requête inutiles.
 */
export function upgradeBoxArt(url) {
  if (!url) return '';
  const clean = url.split('?')[0];
  return clean.replace(/-(\d+)x(\d+)/, '-285x380');
}

/**
 * Transforme une ligne de la réponse `channeltables/games` en GameEntry.
 * Le champ `gamesplayed` est formaté : "Nom|Slug|URL_boxart".
 */
export function parseGameRow(row) {
  if (!row || !row.gamesplayed) return null;

  const [name, slug = '', boxArt = ''] = row.gamesplayed.split('|');
  const streamTimeMinutes = Number(row.streamtime) || 0;

  if (!name || streamTimeMinutes <= 0) return null;

  return new GameEntry({
    name: name.trim(),
    slug: slug.trim(),
    streamTimeMinutes,
    boxArtUrl: upgradeBoxArt(boxArt.trim()),
    rank: Number(row.rownum) || 0,
  });
}
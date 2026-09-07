/**
 * Profil d'une chaîne Twitch identifiée par son ID interne SullyGnome.
 * Cet ID diffère de l'ID officiel Twitch : il est fourni par l'endpoint
 * `api/standardsearch/<pseudo>`.
 */
export default class Streamer {
  constructor({ name, sullyId, boxArtUrl = '' }) {
    this.name = name;
    this.sullyId = sullyId;
    this.boxArtUrl = boxArtUrl;
  }

  static fromPlain(plain) {
    return new Streamer(plain);
  }

  toPlain() {
    return {
      name: this.name,
      sullyId: this.sullyId,
      boxArtUrl: this.boxArtUrl,
    };
  }
}
/* Raretés disponibles et utilitaires associés.
 *
 * Échelle interne (utilisée par l'interface et le tableau) : 0 = Commune … 4 = Mythique.
 * Échelle des fichiers JSON (entrée / sortie)            : 0 = Commune … 5 = Mythique.
 */
class RarityDef {
  static RARITIES = [
    { value: 0, symbol: '★', label: 'Commune', cssClass: 'rarity-common' },
    { value: 1, symbol: '★★', label: 'Rare', cssClass: 'rarity-rare' },
    { value: 2, symbol: '★★★', label: 'Super Rare', cssClass: 'rarity-super-rare' },
    { value: 3, symbol: '✦', label: 'Légendaire', cssClass: 'rarity-legendary' },
    { value: 4, symbol: '💎', label: 'Mythique', cssClass: 'rarity-mythic' }
  ];

  /* Correspondance index interne (0..4) -> valeur écrite dans les fichiers JSON (0..5). */
  static EXTERNAL_VALUES = [0, 1, 2, 3, 5];

  /* Convertit une valeur JSON quelconque (0..5, texte, vide…) vers l'index interne (0..4). */
  static normalize(val) {
    if (val === undefined || val === null || val === '') return 0;
    const num = parseInt(val, 10);
    if (isNaN(num)) return 0;
    // 4 et 5 correspondent tous les deux à « Mythique » (cf. format des JSON d'entrée).
    if (num >= 4) return 4;
    if (num <= 0) return 0;
    return num;
  }

  static get(val) {
    return this.RARITIES[this.normalize(val)] || this.RARITIES[0];
  }

  /* Convertit un index interne (0..4) vers la valeur exportée dans le JSON (0..5). */
  static toExternal(val) {
    return this.EXTERNAL_VALUES[this.normalize(val)];
  }
}

/* Raretés disponibles et utilitaires associés.
 *
 * Échelle interne (interface, modèle, tableau)    : 0 = Commune … 5 = Unique.
 * Échelle des fichiers JSON (entrée / sortie)     : 1 = Commune … 6 = Unique.
 */
class RarityDef {
  static RARITIES = [
    { value: 0, symbol: '★', label: 'Commune', cssClass: 'rarity-common' },
    { value: 1, symbol: '★★', label: 'Rare', cssClass: 'rarity-rare' },
    { value: 2, symbol: '★★★', label: 'Super Rare', cssClass: 'rarity-super-rare' },
    { value: 3, symbol: '✦', label: 'Légendaire', cssClass: 'rarity-legendary' },
    { value: 4, symbol: '💎', label: 'Mythique', cssClass: 'rarity-mythic' },
    { value: 5, symbol: '🔶', label: 'Unique', cssClass: 'rarity-unique' }
  ];

  /* Correspondance index interne (0..5) -> valeur écrite dans les fichiers JSON (1..6). */
  static EXTERNAL_VALUES = [1, 2, 3, 4, 5, 6];

  /* Ramène une valeur d'interface (index interne 0..5, éventuellement en texte) dans
   * l'échelle interne. À utiliser pour tout ce qui vient de l'interface : les listes
   * déroulantes du tableau contiennent des index internes, pas des valeurs JSON. */
  static clamp(val) {
    if (val === undefined || val === null || val === '') return 0;
    const num = parseInt(val, 10);
    if (isNaN(num)) return 0;
    if (num <= 0) return 0;
    if (num >= RarityDef.RARITIES.length) return RarityDef.RARITIES.length - 1;
    return num;
  }

  /* Convertit une valeur JSON (1 = Commune … 6 = Unique) vers l'index interne (0..5).
   * Une valeur hors barème est ramenée dans l'échelle : 0 ou moins -> Commune,
   * 7 et plus -> Unique. */
  static normalize(val) {
    if (val === undefined || val === null || val === '') return 0;
    const num = parseInt(val, 10);
    if (isNaN(num)) return 0;
    return RarityDef.clamp(num - 1);
  }

  /* Rareté (symbole, libellé, classe CSS) à partir d'un index interne. */
  static get(val) {
    return RarityDef.RARITIES[RarityDef.clamp(val)] || RarityDef.RARITIES[0];
  }

  /* Convertit un index interne (0..5) vers la valeur écrite dans les fichiers JSON (1..6). */
  static toExternal(val) {
    return RarityDef.EXTERNAL_VALUES[RarityDef.clamp(val)];
  }
}

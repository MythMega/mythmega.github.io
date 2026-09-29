/* Polices de caractères proposées pour les cartes (mêmes choix que cards.html).
 *
 * Chaque police est décrite par :
 *   - key      : identifiant interne, stocké dans le modèle de carte ;
 *   - label    : libellé affiché dans l'interface — c'est aussi la valeur écrite
 *                dans les fichiers JSON, par cohérence avec le champ « Style »
 *                historique des données d'exemple (« Press Start 2P (Pixel) ») ;
 *   - family   : pile CSS injectée dans la variable --card-font ;
 *   - cssClass : classe d'ajustement des tailles (cf. base.css), vide si aucune.
 *
 * POUR AJOUTER UNE POLICE :
 *   1. Ajouter une entrée dans FONTS (et, au besoin, un alias lisible dans ALIASES).
 *   2. Charger la famille dans le <link> Google Fonts de bulkgenerate.html.
 *   3. Styliser sa classe d'ajustement dans styles/base.css si nécessaire.
 */
class FontDef {
  static DEFAULT_KEY = 'montserrat';

  static FONTS = [
    { key: 'montserrat', label: 'Montserrat (Moderne)', family: "'Montserrat', sans-serif", cssClass: '' },
    { key: 'pixel', label: 'Press Start 2P (Pixel)', family: "'Press Start 2P', cursive", cssClass: 'font-pixel' },
    { key: 'cinzel', label: 'Cinzel (Fantasy / Médiéval)', family: "'Cinzel', serif", cssClass: '' },
    { key: 'orbitron', label: 'Orbitron (Futuriste)', family: "'Orbitron', sans-serif", cssClass: '' },
    { key: 'bebas', label: 'Bebas Neue (Arcade / Comics)', family: "'Bebas Neue', cursive", cssClass: '' }
  ];

  /* Reconnaissance souple : clé, libellé, nom de famille CSS ou ancien champ
   * « Style » (« Pixel Art », « Press Start 2P », « 'Cinzel', serif »…). */
  static ALIASES = {
    pixel: ['pixel', 'press start', 'press-start', '8bit', '8-bit'],
    cinzel: ['cinzel', 'fantasy', 'médiéval', 'medieval'],
    orbitron: ['orbitron', 'futuriste', 'futuristic'],
    bebas: ['bebas', 'arcade', 'comics'],
    montserrat: ['montserrat', 'moderne']
  };

  /* Convertit une valeur quelconque (clé, libellé, famille CSS, vide…) vers une clé
   * de police connue. Une valeur non reconnue retombe sur la police par défaut. */
  static normalize(value) {
    if (value === undefined || value === null) return FontDef.DEFAULT_KEY;

    const text = String(value).trim().toLowerCase();
    if (!text) return FontDef.DEFAULT_KEY;

    const byKey = FontDef.FONTS.find(f => f.key === text);
    if (byKey) return byKey.key;

    const byLabel = FontDef.FONTS.find(f => f.label.toLowerCase() === text);
    if (byLabel) return byLabel.key;

    for (const key of Object.keys(FontDef.ALIASES)) {
      if (FontDef.ALIASES[key].some(alias => text.indexOf(alias) !== -1)) return key;
    }

    return FontDef.DEFAULT_KEY;
  }

  static get(value) {
    const key = FontDef.normalize(value);
    return FontDef.FONTS.find(f => f.key === key) || FontDef.FONTS[0];
  }

  /* Pile CSS de la police (valeur de --card-font). */
  static family(value) {
    return FontDef.get(value).family;
  }

  /* Classe d'ajustement des tailles appliquée au conteneur de la carte. */
  static cssClass(value) {
    return FontDef.get(value).cssClass;
  }

  /* Libellé inscrit dans les fichiers JSON (même convention que le champ « Style »
   * des données d'entrée, ce qui rend l'aller-retour import/export fidèle). */
  static toExternal(value) {
    return FontDef.get(value).label;
  }
}

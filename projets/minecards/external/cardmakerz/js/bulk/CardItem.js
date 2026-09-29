/* Modèle de données pour une carte individuelle */
class CardItem {
  /* Mises en page disponibles. */
  static LAYOUT_FULLART = 'fullart';
  static LAYOUT_CLASSIC = 'classic';

  /* Valeurs acceptées par le sélecteur global d'exportation. */
  static EXPORT_BOTH = 'both';
  static EXPORT_FULLART = 'fullart';
  static EXPORT_CLASSIC = 'classic';

  /* Convertit une valeur quelconque (booléen, texte) en mise en page explicite.
   * Renvoie null lorsque rien n'est spécifié : la carte sera alors exportée
   * dans les deux mises en page. */
  static parseLayout(value) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value === 'boolean') return value ? CardItem.LAYOUT_FULLART : CardItem.LAYOUT_CLASSIC;

    const text = String(value).trim().toLowerCase();
    if (text === 'fullart' || text === 'full-art' || text === 'full_art' || text === 'full' ||
        text === 'true' || text === '1' || text === 'yes') {
      return CardItem.LAYOUT_FULLART;
    }
    if (text === 'classic' || text === 'classique' || text === 'classical' ||
        text === 'false' || text === '0' || text === 'no') {
      return CardItem.LAYOUT_CLASSIC;
    }
    if (text === 'both' || text === 'les-deux' || text === 'lesdeux' || text === 'all') {
      return null;
    }
    return null;
  }

  constructor(data = {}) {
    this.index = (data.Index !== undefined && data.Index !== null) ? String(data.Index).trim().toUpperCase() : '';
    this.nameFR = data.Name_FR || data.name_fr || '';
    this.nameEN = data.Name_EN || data.name_en || '';

    // Modèle de description par défaut (template avec interpolation {Name_FR}, {Name_EN}, etc.)
    const defaultTemplateFR = data.DefaultDescription_FR || data.defaultDescription_FR || data.default_description_fr || '';
    const defaultTemplateEN = data.DefaultDescription_EN || data.defaultDescription_EN || data.default_description_en || '';

    // Description explicite ou calculée via le template
    this.descFR = data.Desc_FR || data.DescFr || data.Description_FR || data.desc_fr || this.interpolateTemplate(defaultTemplateFR, data);
    this.descEN = data.Desc_EN || data.DescEn || data.Description_EN || data.desc_en || this.interpolateTemplate(defaultTemplateEN, data);

    // Images : l'underlay (sprite pixel art) est superposé au background (image de fond).
    // Chaque item peut définir son propre Background ; sinon le Background global de la série est utilisé.
    this.underlay = data.Underlay || data.underlay || '';
    this.background = data.Background || data.background || '';
    this.rarity = RarityDef.normalize(data.Rarity !== undefined ? data.Rarity : (data.rarity !== undefined ? data.rarity : 0));
    this.style = data.Style || data.style || '';

    // Police de la carte : clé normalisée (voir FontDef). Le champ « Font » prime
    // sur le champ historique « Style » (« Pixel Art », « Press Start 2P (Pixel) »…).
    this.font = FontDef.normalize(
      data.Font !== undefined ? data.Font : (data.font !== undefined ? data.font : this.style)
    );

    // Mise en page : true = Full Art, false = Classique, null = non spécifié.
    // Dans ce dernier cas, la carte est exportée dans les deux mises en page.
    const layoutRaw = (data.Layout !== undefined) ? data.Layout
      : (data.CardLayout !== undefined) ? data.CardLayout
      : (data.FullArt !== undefined) ? data.FullArt
      : (data.IsFullArt !== undefined) ? data.IsFullArt
      : (data.fullArt !== undefined) ? data.fullArt
      : undefined;
    const parsedLayout = CardItem.parseLayout(layoutRaw);
    // Booléen : true = Full Art, false = Classique, null = non spécifié (les deux).
    this.fullArt = parsedLayout === null ? null : (parsedLayout === CardItem.LAYOUT_FULLART);
  }

  /* Mise en page explicite de la carte ('fullart' | 'classic'), ou null si non spécifiée. */
  getLayout() {
    if (this.fullArt === null) return null;
    return this.fullArt ? CardItem.LAYOUT_FULLART : CardItem.LAYOUT_CLASSIC;
  }

  /* Mises en page à générer pour cette carte, filtrées par le mode global d'export.
   * Sans indication dans le JSON, la carte est produite en Full Art ET en Classique. */
  getLayouts(exportMode = CardItem.EXPORT_BOTH) {
    const own = this.getLayout() === null
      ? [CardItem.LAYOUT_FULLART, CardItem.LAYOUT_CLASSIC]
      : [this.getLayout()];

    if (!exportMode || exportMode === CardItem.EXPORT_BOTH) return own;
    return own.indexOf(exportMode) !== -1 ? [exportMode] : [];
  }

  /* Clé de mise en page enregistrée dans le manifeste JSON. */
  getLayoutKey() {
    const layout = this.getLayout();
    return layout === null ? CardItem.EXPORT_BOTH : layout;
  }

  /* Copie indépendante de cette carte (le modèle ne contient que des champs simples).
   * `overrides` ajuste certains champs après la copie (ex : la mise en page), ce qui
   * permet d'obtenir une variante sans reconstruire tout le modèle. */
  clone(overrides = {}) {
    const copy = new CardItem({});
    copy.index = this.index;
    copy.nameFR = this.nameFR;
    copy.nameEN = this.nameEN;
    copy.descFR = this.descFR;
    copy.descEN = this.descEN;
    copy.underlay = this.underlay;
    copy.background = this.background;
    copy.rarity = this.rarity;
    copy.style = this.style;
    copy.font = this.font;
    copy.fullArt = this.fullArt;
    Object.assign(copy, overrides);
    return copy;
  }

  interpolateTemplate(template, data) {
    if (!template || typeof template !== 'string') return '';
    return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
      // Recherche insensible à la casse dans les propriétés de data ou de l'item
      if (data[key] !== undefined && data[key] !== null) return data[key];
      const lowerKey = key.toLowerCase();
      for (const prop of Object.keys(data)) {
        if (prop.toLowerCase() === lowerKey && data[prop] !== undefined && data[prop] !== null) {
          return data[prop];
        }
      }
      if (key === 'Name_FR') return this.nameFR;
      if (key === 'Name_EN') return this.nameEN;
      if (key === 'Index') return this.index;
      return match;
    });
  }

  getName(lang = 'FR') {
    if (lang.toUpperCase() === 'EN') {
      return this.nameEN || this.nameFR || 'Unnamed Card';
    }
    return this.nameFR || this.nameEN || 'Carte Sans Nom';
  }

  getDescription(lang = 'FR') {
    if (lang.toUpperCase() === 'EN') {
      return this.descEN || this.descFR || '';
    }
    return this.descFR || this.descEN || '';
  }

  /* Nom du fichier PNG exporté : {INDEX}_{mise en page}.png */
  getFileName(layout = null) {
    const base = (this.index || 'unnamed').replace(/[\\/:*?"<>|]/g, '_');
    const suffix = layout ? `_${layout}` : '';
    return `${base}${suffix}.png`;
  }

  /* Chemin inscrit dans le manifeste JSON du ZIP.
   * « <lang> » reste volontairement littéral : il sera remplacé plus tard
   * par le dossier réel (« fr » ou « en ») côté site. */
  getManifestPath(serie, fileName = null) {
    return `./cards/${serie}/<lang>/${fileName || this.getFileName()}`;
  }

  /* Représentation d'une carte dans le manifeste {Serie}.json livré dans le ZIP. */
  toManifestEntry(serie, fileName = null, layout = null) {
    return {
      Index: this.index,
      Name_FR: this.nameFR,
      Name_EN: this.nameEN,
      Desc_FR: this.descFR,
      Desc_EN: this.descEN,
      Rarity: RarityDef.toExternal(this.rarity),
      // Police utilisée : même libellé que le champ « Style » des JSON d'entrée,
      // ce qui permet de réutiliser un manifeste exporté comme données sources.
      Style: FontDef.toExternal(this.font),
      // Ressources de la carte : URLs d'origine (jamais les Data URLs incorporées
      // pour le rendu), afin que le manifeste reste exploitable par le site.
      Background: this.background,
      Underlay: this.underlay,
      Layout: layout || this.getLayoutKey(),
      Path: this.getManifestPath(serie, fileName || this.getFileName(layout))
    };
  }
}

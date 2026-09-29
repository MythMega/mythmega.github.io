/* Analyseurs de données d'importation.
 *
 * POUR AJOUTER UN NOUVEAU FORMAT PLUS TARD :
 *   1. Créer une classe héritant de BaseImportParser.
 *   2. Implémenter :
 *        - canParse(json)  -> true si le JSON correspond à ce format
 *        - parse(json)     -> { mode, serie, background, style,
 *                               defaultDescription_FR, defaultDescription_EN, items }
 *   3. L'enregistrer : ImportManager.registerParser('MonMode', new MonParser());
 *   Le champ « ImportMode » du JSON permettra alors de le sélectionner
 *   explicitement (sinon, auto-détection via canParse()).
 */
class BaseImportParser {
  canParse(json) {
    throw new Error('canParse must be implemented by subclass');
  }

  parse(json) {
    throw new Error('parse must be implemented by subclass');
  }
}

/* Parser du format « build data » : métadonnées globales + tableau Items/Cards. */
class StandardItemsParser extends BaseImportParser {
  constructor(mode = 'standard') {
    super();
    this.mode = mode;
  }

  canParse(json) {
    return !!json && (Array.isArray(json.Items) || Array.isArray(json.Cards) || json.Serie !== undefined);
  }

  parse(json) {
    const serie = (json.Serie || json.serie || 'SERIE').toString().trim();
    const globalBackground = json.Background || json.background || '';
    const defaultDescFR = json.DefaultDescription_FR || json.defaultDescription_FR || json.default_description_fr || '';
    const defaultDescEN = json.DefaultDescription_EN || json.defaultDescription_EN || json.default_description_en || '';
    const globalStyle = json.Style || json.style || '';

    // Mise en page par défaut de la série (surchargée par celle de chaque item).
    // Non spécifiée -> undefined, ce qui laisse CardItem produire les deux variantes.
    const globalLayout = (json.Layout !== undefined) ? json.Layout
      : (json.CardLayout !== undefined) ? json.CardLayout
      : (json.FullArt !== undefined) ? json.FullArt
      : (json.IsFullArt !== undefined) ? json.IsFullArt
      : undefined;

    const rawItems = Array.isArray(json.Items) ? json.Items : (Array.isArray(json.Cards) ? json.Cards : []);

    const items = rawItems.map(item => {
      const itemLayout = (item.Layout !== undefined) ? item.Layout
        : (item.CardLayout !== undefined) ? item.CardLayout
        : (item.FullArt !== undefined) ? item.FullArt
        : (item.IsFullArt !== undefined) ? item.IsFullArt
        : globalLayout;

      return new CardItem({
        ...item,
        // Le Background de l'item est prioritaire sur le Background global de la série.
        Background: item.Background || item.background || globalBackground,
        DefaultDescription_FR: item.DefaultDescription_FR || item.defaultDescription_FR || defaultDescFR,
        DefaultDescription_EN: item.DefaultDescription_EN || item.defaultDescription_EN || defaultDescEN,
        Style: item.Style || item.style || globalStyle,
        Layout: itemLayout
      });
    });

    return {
      mode: this.mode,
      serie,
      background: globalBackground,
      defaultDescription_FR: defaultDescFR,
      defaultDescription_EN: defaultDescEN,
      style: globalStyle,
      items,
      notes: []
    };
  }
}

/* Parser du manifeste produit par le Bulk Generator ({Serie}.json du ZIP).
 *
 * Ce format est celui du format standard, enrichi par la commande d'export :
 *   - globalement : "ImportMode": "AlreadyExportedData" ;
 *   - par carte   : "Background" et "Underlay" (URLs d'origine), plus « Style »
 *     (police) et « Layout » (mise en page) propres à chaque variante.
 *
 * Le format est reconnu par son marqueur (« AlreadyExportedData », ou l'ancien
 * « ExportedData ») et, à défaut de marqueur, par sa forme (entrées portant un « Path »).
 *
 * Une carte exportée dans les deux mises en page y figure donc DEUX fois (une entrée
 * par fichier PNG). À la réimportation, ces entrées sont regroupées en une seule carte
 * « Les deux » : le tableau n'est pas dupliqué, et un nouvel export reproduit les mêmes
 * variantes. L'enregistrer dans ImportManager évite en outre qu'un manifeste réimporté
 * soit signalé comme un format inconnu (aucune note d'avertissement). */
class ExportedDataParser extends StandardItemsParser {
  /* Marqueur écrit par le Bulk Generator à l'export. */
  static MODE = 'AlreadyExportedData';

  /* Ancien nom du même marqueur, présent dans des fichiers déjà générés
   * (ex : exempledata/serie_a.json) : accepté pour ne pas les signaler comme inconnus. */
  static LEGACY_MODES = ['ExportedData'];

  static allModes() {
    return [ExportedDataParser.MODE].concat(ExportedDataParser.LEGACY_MODES);
  }

  /* Le mode est conservé tel quel : l'interface indique ainsi le marqueur réellement lu. */
  constructor(mode = ExportedDataParser.MODE) {
    super(mode);
  }

  /* Reconnaît le manifeste par son ImportMode, mais aussi par sa forme : un fichier dont
   * l'ImportMode a été retiré (ou mal orthographié) reste identifiable à ses entrées,
   * qui portent chacune le chemin « Path » du PNG produit — le format standard, lui,
   * n'en comporte jamais. */
  canParse(json) {
    if (!json) return false;
    if (ExportedDataParser.isExportedMode(json)) return true;

    const cards = json.Cards;
    return Array.isArray(cards) && cards.length > 0 &&
      cards.every(card => card && typeof card.Path === 'string' && card.Path !== '');
  }

  /* Vrai lorsque l'« ImportMode » du fichier désigne ce format (casse et espaces ignorés,
   * marqueur actuel ou ancien). */
  static isExportedMode(json) {
    const mode = String((json && (json.ImportMode || json.importMode)) || '').trim().toLowerCase();
    return ExportedDataParser.allModes().some(candidate => candidate.toLowerCase() === mode);
  }

  parse(json) {
    const result = super.parse(json);
    const entries = result.items.length;

    result.items = this.mergeVariantCards(result.items);

    // Information non bloquante remontée à l'application : elle explique pourquoi un
    // manifeste de N entrées ne produit pas N lignes dans le tableau.
    const merged = entries - result.items.length;
    result.info = merged > 0
      ? `${entries} entrée(s) de variantes regroupées en ${result.items.length} carte(s).`
      : '';

    return result;
  }

  /* Signature du contenu d'une carte, hors mise en page : les deux variantes d'une
   * même carte partagent tout sauf leur « Layout » et leur « Path ». */
  contentSignature(item) {
    return JSON.stringify([
      item.index, item.nameFR, item.nameEN, item.descFR, item.descEN,
      item.underlay, item.background, item.rarity, item.font, item.style
    ]);
  }

  /* Regroupe les entrées correspondant à une même carte (même Index et même contenu)
   * en une seule carte : « fullart » + « classic » redeviennent une carte exportée dans
   * les deux mises en page. Deux cartes réellement distinctes mais de contenu identique
   * (même Index) restent, elles, deux cartes : le nombre de cartes d'un groupe est celui
   * de la variante la plus fréquente (chaque carte produit une entrée par variante). */
  mergeVariantCards(items) {
    const groups = new Map(); // signature -> { item, layouts: { layout: nombre d'entrées } }

    items.forEach(item => {
      const signature = this.contentSignature(item);
      if (!groups.has(signature)) {
        groups.set(signature, { item, layouts: {} });
      }
      const group = groups.get(signature);
      const layout = item.getLayoutKey();
      group.layouts[layout] = (group.layouts[layout] || 0) + 1;
    });

    const cards = [];
    groups.forEach(group => {
      const layouts = Object.keys(group.layouts);
      const hasFullArt = layouts.indexOf(CardItem.LAYOUT_FULLART) !== -1;
      const hasClassic = layouts.indexOf(CardItem.LAYOUT_CLASSIC) !== -1;

      // Mise en page déduite des variantes trouvées : une seule variante -> cette
      // mise en page, les deux -> non spécifiée (les deux seront exportées).
      let fullArt = null;
      if (hasFullArt && !hasClassic) fullArt = true;
      else if (hasClassic && !hasFullArt) fullArt = false;

      const slots = layouts.reduce((max, layout) => Math.max(max, group.layouts[layout]), 1);
      for (let i = 0; i < slots; i++) {
        cards.push(group.item.clone({ fullArt }));
      }
    });

    return cards;
  }
}

/* Registre d'import : associe un nom de mode à un parser.
 * L'ordre compte pour la détection automatique : le parser le plus spécifique est testé
 * en premier (un manifeste exporté est reconnu avant le parser générique « standard »,
 * qui accepte n'importe quel tableau « Items » ou « Cards »). */
class ImportManager {
  static parsers = {
    // Données déjà exportées : manifeste actuel du ZIP et son ancien marqueur « ExportedData ».
    // Ce format, le plus spécifique, est testé en premier par la détection automatique.
    [ExportedDataParser.MODE]: new ExportedDataParser(),
    [ExportedDataParser.LEGACY_MODES[0]]: new ExportedDataParser(ExportedDataParser.LEGACY_MODES[0]),
    'standard': new StandardItemsParser('standard'),
    'AutoBData': new StandardItemsParser('AutoBData')
  };

  static registerParser(name, parserInstance) {
    this.parsers[name] = parserInstance;
  }

  /* Résout un parser sans tenir compte de la casse du nom de mode. */
  static resolveParser(mode) {
    if (!mode) return null;
    if (this.parsers[mode]) return this.parsers[mode];
    const lower = String(mode).toLowerCase();
    const key = Object.keys(this.parsers).find(k => k.toLowerCase() === lower);
    return key ? this.parsers[key] : null;
  }

  static parse(json, preferredMode = null) {
    const mode = preferredMode || json.ImportMode || json.importMode;
    const explicit = this.resolveParser(mode);
    const notes = [];
    let result = null;

    if (explicit) {
      // Mode d'import explicitement reconnu.
      result = explicit.parse(json);
    } else {
      if (mode) {
        notes.push(`ImportMode « ${mode} » inconnu : le format a été détecté automatiquement.`);
      }

      for (const key of Object.keys(this.parsers)) {
        if (this.parsers[key].canParse(json)) {
          result = this.parsers[key].parse(json);
          break;
        }
      }

      if (!result) {
        notes.push('Aucun analyseur ne reconnaît ce format : lecture tentée avec le format standard.');
        result = new StandardItemsParser(mode || 'standard').parse(json);
      }
    }

    result.notes = notes;
    return result;
  }
}

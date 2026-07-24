/**
 * Router.js
 * Classe gérant le routage côté client via les paramètres d'URL.
 * Toutes les "pages" restent dans app.html pour conserver la DB en mémoire.
 *
 * Paramètres reconnus :
 *   ?state=filters            → Page filtres (Roulette)
 *   ?game=<id>                → Détail d'un jeu
 *   ?developer=<id>           → Détail d'un développeur
 *   ?franchise=<id>           → Détail d'une franchise
 *   ?genre=<id>               → Détail d'un genre
 *   ?platform=<id>            → Détail d'une plateforme
 *   ?theme=<id>               → Détail d'un thème
 *   ?list=<type>&page=<n>     → Liste paginée d'un type
 *   (aucun paramètre)         → Accueil
 */

class Router {
  /**
   * @param {Function} renderFn - Appelée avec (route: {type, params}) à chaque navigation
   * @param {MetaManager} [metaManager] - Gestionnaire de meta tags
   */
  constructor(renderFn, metaManager) {
    this.renderFn = renderFn;
    this.metaManager = metaManager || null;
    this._handlePop = this._handlePop.bind(this);
  }

  /** Démarre l'écoute des changements d'URL. */
  start() {
    window.addEventListener('popstate', this._handlePop);
    this._dispatch();
    console.log('[Router] Démarré, route initiale :', this.current());
  }

  /** Arrête l'écoute. */
  stop() {
    window.removeEventListener('popstate', this._handlePop);
  }

  /**
   * Navigue vers une nouvelle URL sans recharger la page.
   * @param {string} url - URL relative, ex: '?game=11004'
   */
  navigate(url) {
    console.log('[Router] Naviguer vers :', url);
    window.history.pushState(null, '', url);
    this._dispatch();
  }

  /** Retourne la route courante parsée. */
  current() {
    return Router.parse(new URLSearchParams(window.location.search));
  }

  /**
   * Parse des URLSearchParams et retourne un objet route.
   * @param {URLSearchParams} params
   * @returns {{type: string, params: Object}}
   */
  static parse(params) {
    if (params.has('game'))        return { type: 'game',       params: { id: Number(params.get('game')) } };
    if (params.has('developer'))   return { type: 'developer',  params: { id: Number(params.get('developer')) } };
    if (params.has('franchise'))   return { type: 'franchise',  params: { id: Number(params.get('franchise')) } };
    if (params.has('genre'))       return { type: 'genre',      params: { id: Number(params.get('genre')) } };
    if (params.has('platform'))    return { type: 'platform',   params: { id: Number(params.get('platform')) } };
    if (params.has('theme'))       return { type: 'theme',      params: { id: Number(params.get('theme')) } };
    if (params.has('list'))        return { type: 'list',       params: { listType: params.get('list'), page: Number(params.get('page') || 1) } };
    if (params.has('roulette'))    return {
      type: 'roulette',
      params: {
        settings: params.get('roulette'),
        ids: params.get('ids')
          ? params.get('ids').split(',').map(Number).filter(n => !isNaN(n) && n > 0)
          : [],
        idx: Math.max(0, Number(params.get('idx') || 0)),
      },
    };
    if (params.get('state') === 'filters') return {
      type: 'filters',
      params: { preSettings: params.get('s') || null },
    };
    if (params.get('state') === 'settings') return { type: 'settings', params: {} };
    if (params.get('state') === 'profile')  return { type: 'profile',  params: {} };
    return { type: 'home', params: {} };
  }

  _handlePop() {
    console.log('[Router] popstate détecté');
    this._dispatch();
  }

  _dispatch() {
    const route = this.current();
    this.renderFn(route);
    this._updateMeta(route);
  }

  /**
   * Met à jour les meta tags selon le type de route.
   * @param {{type: string, params: Object}} route
   */
  _updateMeta(route) {
    if (!this.metaManager) return;
    const baseUrl = 'https://mythmega.github.io/app.html';
    let meta = { url: baseUrl };

    switch (route.type) {
      case 'home':
        meta.title = 'Gamefinder 2.0 — Accueil';
        meta.description = 'Trouve ton prochain jeu vidéo grâce à notre roulette de sélection intelligente.';
        break;
      case 'filters':
        meta.title = 'Gamefinder 2.0 — Roulette';
        meta.description = 'Lance la roulette et découvre un jeu aléatoire selon tes critères.';
        break;
      case 'roulette':
        meta.title = 'Gamefinder 2.0 — Résultat';
        meta.description = 'Découvre le jeu sélectionné par la roulette.';
        break;
      case 'game': {
        const id = route.params.id;
        meta.title = 'Gamefinder 2.0 — Détail du jeu';
        meta.description = `Consulte les détails du jeu #${id}.`;
        meta.url = `${baseUrl}?game=${id}`;
        break;
      }
      case 'developer': {
        const id = route.params.id;
        meta.title = 'Gamefinder 2.0 — Développeur';
        meta.description = `Découvre les jeux du développeur #${id}.`;
        meta.url = `${baseUrl}?developer=${id}`;
        break;
      }
      case 'franchise': {
        const id = route.params.id;
        meta.title = 'Gamefinder 2.0 — Franchise';
        meta.description = `Explore la franchise #${id}.`;
        meta.url = `${baseUrl}?franchise=${id}`;
        break;
      }
      case 'platform': {
        const id = route.params.id;
        meta.title = 'Gamefinder 2.0 — Plateforme';
        meta.description = `Jeux disponibles sur la plateforme #${id}.`;
        meta.url = `${baseUrl}?platform=${id}`;
        break;
      }
      case 'genre': {
        const id = route.params.id;
        meta.title = 'Gamefinder 2.0 — Genre';
        meta.description = `Jeux du genre #${id}.`;
        meta.url = `${baseUrl}?genre=${id}`;
        break;
      }
      case 'theme': {
        const id = route.params.id;
        meta.title = 'Gamefinder 2.0 — Thème';
        meta.description = `Jeux du thème #${id}.`;
        meta.url = `${baseUrl}?theme=${id}`;
        break;
      }
      case 'list': {
        const type = route.params.listType;
        const page = route.params.page;
        meta.title = `Gamefinder 2.0 — ${type} (page ${page})`;
        meta.description = `Liste paginée de ${type}.`;
        meta.url = `${baseUrl}?list=${type}&page=${page}`;
        break;
      }
      case 'settings':
        meta.title = 'Gamefinder 2.0 — Paramètres';
        meta.description = 'Gère tes préférences et paramètres.';
        break;
      case 'profile':
        meta.title = 'Gamefinder 2.0 — Profil';
        meta.description = 'Consulte ton profil et tes statistiques.';
        break;
      default:
        meta.title = 'Gamefinder 2.0';
        meta.description = 'Trouve ton prochain jeu vidéo grâce à notre roulette de sélection intelligente.';
    }

    this.metaManager.set(meta);
  }
}

window.Router = Router;

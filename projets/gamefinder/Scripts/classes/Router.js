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
   */
  constructor(renderFn) {
    this.renderFn = renderFn;
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
  }
}

window.Router = Router;

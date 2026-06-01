// embed-config.js — Configuration d'intégration iframe
// Référence : _specifications/technical-architecture.md §Intégration iframe
//
// Ce fichier centralise la liste des origines autorisées à intégrer le jeu
// en iframe. Modifier ONLY ce fichier pour ajouter/retirer des domaines.
//
// Utilisé par :
//   - index.html         (guard inline exécuté avant Phaser)
//   - _headers           (Content-Security-Policy frame-ancestors)
//   - src/main.js        (vérification douce au démarrage)

export const EMBED_CONFIG = {
  // Intégration iframe activée
  allowEmbedding: true,

  // Origines autorisées à héberger le jeu en <iframe>
  // Format : hostname uniquement, sans protocole ni slash final.
  allowedHosts: [
    'localhost',
    'jmdev.fr',
    'web.jmdev.fr',
  ],

  // Origines complètes (protocole inclus) — utilisées pour les checks JS
  // et pour générer le header Content-Security-Policy frame-ancestors.
  allowedOrigins: [
    'http://localhost',
    'https://localhost',
    'https://jmdev.fr',
    'https://web.jmdev.fr',
  ],

  // Message affiché si l'hébergeur n'est pas autorisé
  blockedMessage: 'Intégration non autorisée sur ce domaine.',
};

/**
 * Vérifie si la page tourne dans un iframe sur une origine autorisée.
 * Retourne true si l'embedding est autorisé (ou si on n'est pas dans un iframe).
 * @returns {boolean}
 */
export function checkEmbedAllowed() {
  if (!EMBED_CONFIG.allowEmbedding) return false;
  if (window === window.top) return true; // Pas dans un iframe

  const { allowedHosts, allowedOrigins } = EMBED_CONFIG;

  // Tentative 1 : accès direct à window.top.location (même origine)
  try {
    const parentHost = window.top.location.hostname;
    return allowedHosts.includes(parentHost);
  } catch (_) {
    // Cross-origin : window.top.location inaccessible → on utilise le referrer
  }

  // Tentative 2 : document.referrer
  const ref = document.referrer || '';
  if (ref === '') return false; // Referrer vide = impossible à vérifier → bloquer

  return allowedOrigins.some(origin => ref.startsWith(origin));
}

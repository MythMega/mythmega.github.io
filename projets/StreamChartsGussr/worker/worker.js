/**
 * Relais CORS personnel pour StreamGuessr — Cloudflare Worker.
 *
 * Problème : SullyGnome n'envoie pas d'en-tête CORS, et les relais publics
 * (allorigins) sont lents ou intermittents. Ce Worker déployé sur Cloudflare
 * ajoute les en-têtes CORS manquants et rend les requêtes rapides et stables.
 *
 * Appelé via :  https://<nom>.workers.dev/?url=<adresse_encodée>
 *
 * Déploiement (2 minutes, sans compte serveur) :
 *   1. Va sur https://dash.cloudflare.com/ → Workers & Pages → Create.
 *   2. Colle le contenu de ce fichier dans l'éditeur, puis Deploy.
 *   3. Copie l'URL obtenue dans StreamGuessr → Réglages → "Relais CORS".
 */

// Restreint le relais aux adresses de SullyGnome (sécurité par défaut).
const BASE_URL = 'https://sullygnome.com';
const ALLOWED_ORIGIN = '*';

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const requestUrl = new URL(request.url);
    const target = requestUrl.searchParams.get('url');

    if (!target || !target.startsWith(`${BASE_URL}/`)) {
      return new Response('Bad target', {
        status: 400,
        headers: corsHeaders(),
      });
    }

    try {
      const upstream = await fetch(target, { cf: { cacheTtl: 300, cacheEverything: true } });
      const body = await upstream.arrayBuffer();

      return new Response(body, {
        status: upstream.status,
        headers: {
          ...corsHeaders(),
          'Content-Type': upstream.headers.get('content-type') || 'application/json',
          'Cache-Control': 'public, max-age=300',
        },
      });
    } catch (error) {
      return new Response('Relay upstream error', {
        status: 502,
        headers: corsHeaders(),
      });
    }
  },
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}
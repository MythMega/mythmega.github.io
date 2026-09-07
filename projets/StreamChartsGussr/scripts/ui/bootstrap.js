/**
 * Amorce commune à toutes les pages : réglages, thème, langue, pied de page.
 * Chaque page appelle `initSite()` au démarrage de son script principal.
 */
import { loadSettings } from '../data/settings-store.js';
import { applyTheme } from './theme.js';
import { initI18n, translateDOM } from './i18n.js';
import { injectFooter } from './footer.js';

export async function initSite() {
  const settings = loadSettings();

  applyTheme(settings.theme);

  // Si la langue demandée est indisponible (fichier manquant, réseau coupé),
  // on tente l'autre langue puis on retombe sur les textes statiques du HTML.
  try {
    await initI18n(settings.lang);
  } catch {
    try {
      await initI18n(settings.lang === 'fr' ? 'en' : 'fr');
    } catch {
      /* la page reste utilisable en textes par défaut */
    }
  }

  injectFooter();
  translateDOM(document);

  // Séquence de révélation douce des sections marquées `reveal-on-load`.
  requestAnimationFrame(() => {
    document.documentElement.classList.add('page-ready');
  });

  return settings;
}
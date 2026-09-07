/**
 * Réglages de l'application, persistés en localStorage.
 * Petits et synchrones : pas besoin d'IndexedDB pour ça.
 */
const STORAGE_KEY = 'streamguessr.settings';

export const DEFAULT_SETTINGS = {
  theme: 'dark',        // 'dark' | 'light'
  lang: 'fr',           // 'fr' | 'en'
  lastStreamer: '',     // pseudo utilisé pour le bouton "rejouer"
  lastMode: 'classic',  // dernier mode de jeu choisi
  extendedData: false,  // true = 200 jeux, false = 50 jeux
  difficulty: 'medium', // 'easy' | 'medium' | 'hard'
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Stockage indisponible (navigation privée, quota...) : on continue en mémoire.
  }
  return next;
}
/**
 * Application du thème (sombre / clair) via l'attribut `data-theme`
 * sur l'élément racine : le CSS réagit aux variables correspondantes.
 */
export function applyTheme(theme) {
  const normalized = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = normalized;
}

export function currentTheme() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}
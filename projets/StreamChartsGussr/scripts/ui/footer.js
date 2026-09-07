/**
 * Pied de page partagé, injecté sur toutes les pages par le bootstrap.
 * La mention de la source des données est obligatoire pour la transparence.
 */
export function injectFooter() {
  if (document.querySelector('.app-footer')) return;

  const footer = document.createElement('footer');
  footer.className = 'app-footer';

  const source = document.createElement('p');
  source.className = 'footer-source';

  const prefix = document.createElement('span');
  prefix.setAttribute('data-i18n', 'footer.dataFrom');

  const link = document.createElement('a');
  link.href = 'https://sullygnome.com/';
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.setAttribute('data-i18n', 'footer.linkLabel');

  source.append(prefix, ' ', link);
  footer.append(source);
  document.body.append(footer);
}
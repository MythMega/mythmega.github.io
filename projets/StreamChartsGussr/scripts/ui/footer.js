/**
 * Pied de page partagé, injecté sur toutes les pages par le bootstrap.
 * La mention de la source des données est obligatoire pour la transparence ;
 * une ligne de crédit codeur complète le bas de page.
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

  const credit = document.createElement('p');
  credit.className = 'footer-credit';

  const creditPrefix = document.createElement('span');
  creditPrefix.setAttribute('data-i18n', 'footer.codeBy');

  const creditLink = document.createElement('a');
  creditLink.href = 'https://web.jmdev.fr';
  creditLink.target = '_blank';
  creditLink.rel = 'noopener noreferrer';
  creditLink.textContent = 'MythMega';

  credit.append(creditPrefix, ' ', creditLink);

  footer.append(source, credit);
  document.body.append(footer);
}
// footer.js — Injecte le footer commun (Accueil · Données · Changelog) sur toutes les pages
(function () {
  const LINK_STYLE = 'color:var(--muted);text-decoration:none;opacity:0.5;transition:opacity 200ms;';
  const SEP_STYLE  = 'opacity:0.25;margin:0 8px;';

  function makeLink(href, i18nKey, defaultText) {
    return `<a href="${href}" style="${LINK_STYLE}" ` +
      `onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.5'" ` +
      `data-i18n="${i18nKey}">${defaultText}</a>`;
  }

  const footer = document.createElement('footer');
  footer.style.cssText = [
    'position:fixed', 'bottom:0', 'left:0', 'right:0',
    'text-align:center', 'padding:8px 16px', 'font-size:12px',
    'color:var(--muted)', 'z-index:10'
  ].join(';');

  footer.innerHTML =
    makeLink('index.html',     'footer.homeLink',      'Accueil') +
    `<span style="${SEP_STYLE}">·</span>` +
    makeLink('data.html',      'footer.dataLink',      'Données') +
    `<span style="${SEP_STYLE}">·</span>` +
    makeLink('changelog.html', 'footer.changelogLink', 'Changelog');

  document.body.appendChild(footer);
})();

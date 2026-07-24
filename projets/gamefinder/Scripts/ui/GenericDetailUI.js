/**
 * GenericDetailUI.js
 * Page de détail générique pour les types simples :
 * genre, platform, theme (pas de table dédiée avec id indépendant dans ce schéma).
 */

class GenericDetailUI {
  render(container, type, id) {
    console.log(`[GenericDetailUI] Rendu type=${type} id=${id}`);
    const typeLabels = {
      genre: 'Genre', platform: 'Plateforme', theme: 'Thème',
    };
    container.innerHTML = `
      <div id="page-view">
        <div class="page-title">${typeLabels[type] || type} #${id}</div>
        <hr class="neon-divider" />
        <p style="color:var(--text-secondary)">
          Les détails pour ce type seront disponibles prochainement.
        </p>
      </div>
    `;

    // Meta tags dynamiques
    if (window._metaManager) {
      window._metaManager.set({
        title: `${typeLabels[type] || type} #${id} — Gamefinder 2.0`,
        description: `Découvre les jeux associés à ce ${typeLabels[type] || type}.`,
        url: `https://mythmega.github.io/app.html?${type}=${id}`,
      });
    }
  }
}

window.GenericDetailUI = GenericDetailUI;

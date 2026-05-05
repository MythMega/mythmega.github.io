/**
 * FooterUI.js
 * Construction du pied de page.
 */

class FooterUI {
  render() {
    const footer = document.getElementById('app-footer');
    if (!footer) return;

    footer.innerHTML = `
      <a href="https://web.jmdev.fr/" target="_blank" rel="noopener">jmdev.fr</a>
      <span class="footer-sep">|</span>
      <a href="https://github.com/MythMega/Gamefinder2.0" target="_blank" rel="noopener">GitHub</a>
      <span class="footer-sep">|</span>
      <a href="https://github.com/MythMega/Gamefinder2.0/issues" target="_blank" rel="noopener">Issues</a>
      <span class="footer-sep">|</span>
      <a href="https://github.com/MythMega/Gamefinder2.0/wiki" target="_blank" rel="noopener">Wiki</a>
    `;
    console.log('[FooterUI] Footer rendu');
  }
}

window.FooterUI = FooterUI;

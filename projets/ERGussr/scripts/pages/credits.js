/**
 * Page controller: credits.html
 */
import { loadTranslations } from "../business/i18n.js";
import { getLangPref } from "../business/settings.js";
import { applyTranslations, setActiveNav } from "../visual/ui.js";

async function init() {
  const lang = getLangPref();
  await loadTranslations(lang);
  applyTranslations();
  setActiveNav();
  document.getElementById("nav-toggle")?.addEventListener("click", () =>
    document.getElementById("nav-links")?.classList.toggle("open")
  );
}

init();

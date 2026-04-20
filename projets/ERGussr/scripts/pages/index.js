/**
 * Page controller: index.html
 */
import { loadTranslations } from "../business/i18n.js";
import { getLangPref } from "../business/settings.js";
import { applyTranslations, setActiveNav } from "../visual/ui.js";

async function init() {
  const lang = getLangPref();
  await loadTranslations(lang);
  applyTranslations();
  setActiveNav();
  initNavToggle();
}

function initNavToggle() {
  const toggle = document.getElementById("nav-toggle");
  const links = document.getElementById("nav-links");
  toggle?.addEventListener("click", () => links.classList.toggle("open"));
}

init();

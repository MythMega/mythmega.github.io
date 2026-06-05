/**
 * Page controller: settings.html
 */
import { loadTranslations, t, getLang } from "../business/i18n.js";
import { getLangPref, setLangPref } from "../business/settings.js";
import { applyTranslations, setActiveNav, showToast, showConfirm, showModal, escapeHtml } from "../visual/ui.js";
import { exportSave, importSave, parseDailyText } from "../business/saveManager.js";
import { clearAllDailyResults, getDailyResult, saveDailyResult } from "../business/database.js";

async function init() {
  const lang = getLangPref();
  await loadTranslations(lang);
  applyTranslations();
  setActiveNav();
  initNavToggle();
  updateLangButtons(lang);

  document.getElementById("lang-fr").addEventListener("click", () => switchLang("fr"));
  document.getElementById("lang-en").addEventListener("click", () => switchLang("en"));
  document.getElementById("btn-export").addEventListener("click", handleExport);
  document.getElementById("btn-import").addEventListener("click", () =>
    document.getElementById("import-file").click()
  );
  document.getElementById("import-file").addEventListener("change", handleImport);
  document.getElementById("btn-import-daily").addEventListener("click", handleImportDaily);
  document.getElementById("btn-delete").addEventListener("click", handleDelete);
}

function initNavToggle() {
  document.getElementById("nav-toggle")?.addEventListener("click", () =>
    document.getElementById("nav-links")?.classList.toggle("open")
  );
}

function updateLangButtons(lang) {
  document.getElementById("lang-fr").classList.toggle("selected", lang === "fr");
  document.getElementById("lang-en").classList.toggle("selected", lang === "en");
}

async function switchLang(lang) {
  console.log(`[settings page] Switching language to: ${lang}`);
  setLangPref(lang);
  await loadTranslations(lang);
  applyTranslations();
  updateLangButtons(lang);
  showToast(t("settings.language") + ": " + t(`settings.lang_${lang}`), "success");
}

async function handleExport() {
  console.log("[settings page] Export clicked");
  await exportSave();
}

async function handleImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  console.log("[settings page] Import file selected:", file.name);
  const result = await importSave(file);
  // Reset file input so same file can be re-imported if needed
  e.target.value = "";

  if (result.error) {
    showModal(t("settings.import_error"), `<p>${escapeHtml(result.error)}</p>`);
    return;
  }

  const hsLine = result.highscoreUpdated
    ? `<p>✅ ${t("settings.import_highscore_updated")}</p>`
    : `<p>ℹ️ ${t("settings.import_highscore_ignored")}</p>`;

  const html = `
    <p>📅 ${t("settings.import_new_dailies")}: <strong>${result.newDailies}</strong></p>
    <p>⏭️ ${t("settings.import_skipped_dailies")}: <strong>${result.skippedDailies}</strong></p>
    ${hsLine}`;

  showModal(t("settings.import_result_title"), html);
}

async function handleImportDaily() {
  const textarea = document.getElementById("import-daily-text");
  const text = textarea.value.trim();
  if (!text) {
    showToast(t("settings.import_daily_error"), "error");
    return;
  }

  console.log("[settings page] Parsing daily text...");
  const { result, error } = parseDailyText(text);
  if (error || !result) {
    showToast(t("settings.import_daily_error"), "error");
    console.error("[settings page] Parse error:", error);
    return;
  }

  // Check if this date already exists
  const existing = await getDailyResult(result.date);
  if (existing) {
    const msg = t("settings.import_daily_exists").replace("{date}", result.date);
    showToast(msg, "error", 4000);
    textarea.value = "";
    return;
  }

  // Save
  await saveDailyResult(result);
  const msg = t("settings.import_daily_success")
    .replace("{date}", result.date)
    .replace("{score}", String(result.scoreTotal));
  showToast(msg, "success", 4000);
  textarea.value = "";
  console.log(`[settings page] Imported daily result for ${result.date}, score ${result.scoreTotal}`);
}

async function handleDelete() {
  const confirmed = await showConfirm(t("settings.delete_confirm"));
  if (!confirmed) return;
  console.log("[settings page] Deleting all data");
  await clearAllDailyResults();
  showToast(t("settings.delete_success"), "success");
}

init();

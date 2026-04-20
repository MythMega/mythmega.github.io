/**
 * Page controller: replay.html
 */
import { loadTranslations, t, getLang } from "../business/i18n.js";
import { getLangPref } from "../business/settings.js";
import { applyTranslations, setActiveNav } from "../visual/ui.js";
import { getAllDailyResults } from "../business/database.js";
import { getTodayDateStr, parseDateStr } from "../business/gameLogic.js";

async function init() {
  const lang = getLangPref();
  await loadTranslations(lang);
  applyTranslations();
  setActiveNav();
  initNavToggle();
  await renderReplayGrid();
}

function initNavToggle() {
  document.getElementById("nav-toggle")?.addEventListener("click", () =>
    document.getElementById("nav-links")?.classList.toggle("open")
  );
}

async function renderReplayGrid() {
  const grid = document.getElementById("replay-grid");
  const playedResults = await getAllDailyResults();
  const playedDates = new Set(playedResults.map(r => r.date));

  const today = getTodayDateStr();
  const todayDate = parseDateStr(today);

  // Generate a date range from the earliest played daily (or today if none)
  let startDate;
  if (playedResults.length > 0) {
    // The oldest daily date
    const oldest = playedResults[playedResults.length - 1].date; // already sorted desc
    startDate = parseDateStr(oldest);
  } else {
    startDate = todayDate;
  }

  // Build list of dates from startDate to today (inclusive)
  const dates = [];
  const cursor = new Date(startDate);
  while (cursor <= todayDate) {
    const d = String(cursor.getDate()).padStart(2, "0");
    const m = String(cursor.getMonth() + 1).padStart(2, "0");
    const y = cursor.getFullYear();
    dates.push(`${d}-${m}-${y}`);
    cursor.setDate(cursor.getDate() + 1);
  }

  // Reverse so today is first
  dates.reverse();

  console.log(`[replay] Rendering ${dates.length} date buttons`);

  grid.innerHTML = "";
  for (const dateStr of dates) {
    const played = playedDates.has(dateStr);
    const btn = document.createElement("button");
    btn.className = `replay-btn ${played ? "played" : "not-played"}`;
    btn.textContent = dateStr;
    btn.title = played ? t("replay.played") : t("replay.not_played");
    btn.addEventListener("click", () => {
      window.location.href = `./daily.html?date=${dateStr}`;
    });
    grid.appendChild(btn);
  }

  if (dates.length === 0) {
    grid.innerHTML = `<p class="text-muted">${t("common.loading")}</p>`;
  }
}

init();

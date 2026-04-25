/**
 * Page controller: historique.html
 * Displays all played dailies with pagination, a score chart, and stat groups.
 */
import { loadTranslations, t } from "../business/i18n.js";
import { getLangPref } from "../business/settings.js";
import { getAllDailyResults } from "../business/database.js";
import { applyTranslations, setActiveNav } from "../visual/ui.js";
import { parseDateStr } from "../business/gameLogic.js";

const PAGE_SIZE = 25;

/** @type {import('../entity/DailyResult.js').DailyResult[]} */
let allResults = [];
let currentPage = 0; // 0-based

async function init() {
  const lang = getLangPref();
  await loadTranslations(lang);
  applyTranslations();
  setActiveNav();
  initNavToggle();

  allResults = await getAllDailyResults(); // sorted descending

  const loading = document.getElementById("history-loading");
  loading.classList.add("hidden");

  if (allResults.length === 0) {
    document.getElementById("history-empty").classList.remove("hidden");
    return;
  }

  document.getElementById("history-content").classList.remove("hidden");

  renderPage(0);
  drawChart();
  renderStats();
}

function initNavToggle() {
  document.getElementById("nav-toggle")?.addEventListener("click", () =>
    document.getElementById("nav-links")?.classList.toggle("open")
  );
}

// ─── List Column ─────────────────────────────────────────────────────────────

function renderPage(page) {
  currentPage = page;
  const start = page * PAGE_SIZE;
  const slice = allResults.slice(start, start + PAGE_SIZE);

  const list = document.getElementById("history-list");
  list.innerHTML = "";

  for (const result of slice) {
    list.appendChild(buildEntry(result));
  }

  renderPagination();
}

function buildEntry(result) {
  const entry = document.createElement("div");
  entry.className = "history-entry";

  // Date
  const dateEl = document.createElement("span");
  dateEl.className = "history-entry-date";
  dateEl.textContent = result.date;
  entry.appendChild(dateEl);

  // Round emojis
  const roundsEl = document.createElement("span");
  roundsEl.className = "history-entry-rounds";
  const sortedRounds = [...result.rounds].sort((a, b) => a.round_number - b.round_number);
  for (const r of sortedRounds) {
    roundsEl.appendChild(buildRoundEmoji(r));
  }
  entry.appendChild(roundsEl);

  // Score
  const scoreEl = document.createElement("span");
  scoreEl.className = "history-entry-score";
  scoreEl.textContent = `${result.scoreTotal}/50`;
  entry.appendChild(scoreEl);

  return entry;
}

function buildRoundEmoji(round) {
  const wrapper = document.createElement("span");
  wrapper.className = "history-round-emoji";

  let emoji;
  if (round.status === "fail") {
    emoji = "🟥";
  } else if (round.fails_count === 0) {
    emoji = "🟩";
  } else {
    emoji = "🟧";
  }

  wrapper.textContent = emoji;

  // Tooltip
  const tip = document.createElement("span");
  tip.className = "tooltip";
  const errors = round.fails_count ?? 0;
  tip.textContent = `${errors} ${t("historique.tooltip_errors")}`;
  wrapper.appendChild(tip);

  return wrapper;
}

function renderPagination() {
  const pagination = document.getElementById("history-pagination");
  pagination.innerHTML = "";

  const totalPages = Math.ceil(allResults.length / PAGE_SIZE);
  if (totalPages <= 1) return;

  if (currentPage > 0) {
    const prev = document.createElement("button");
    prev.className = "btn btn-secondary";
    prev.textContent = t("historique.show_prev");
    prev.addEventListener("click", () => renderPage(currentPage - 1));
    pagination.appendChild(prev);
  }

  if ((currentPage + 1) < totalPages) {
    const next = document.createElement("button");
    next.className = "btn btn-secondary";
    next.textContent = t("historique.show_next");
    next.addEventListener("click", () => renderPage(currentPage + 1));
    pagination.appendChild(next);
  }
}

// ─── Chart ───────────────────────────────────────────────────────────────────

function drawChart() {
  const canvas = document.getElementById("history-chart");
  const data = [...allResults].reverse(); // chronological order
  const ctx = canvas.getContext("2d");

  // Responsive width
  const W = canvas.parentElement.clientWidth - 48; // card padding
  const H = canvas.height;
  canvas.width = Math.max(W, 100);

  const pad = { top: 16, right: 16, bottom: 36, left: 44 };
  const chartW = canvas.width - pad.left - pad.right;
  const chartH = H - pad.top - pad.bottom;
  const n = data.length;

  ctx.clearRect(0, 0, canvas.width, H);

  const maxScore = 50;
  const xPos = i => pad.left + (n === 1 ? chartW / 2 : (i / (n - 1)) * chartW);
  const yPos = score => pad.top + chartH - (score / maxScore) * chartH;

  // Horizontal grid + Y labels
  ctx.lineWidth = 1;
  for (let v = 0; v <= 50; v += 10) {
    const y = yPos(v);
    ctx.strokeStyle = "rgba(255,255,255,0.07)";
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + chartW, y);
    ctx.stroke();

    ctx.fillStyle = "#8c90a8";
    ctx.font = "11px system-ui";
    ctx.textAlign = "right";
    ctx.fillText(String(v), pad.left - 6, y + 4);
  }

  // X-axis date labels (show at most 6 evenly spaced)
  const labelCount = Math.min(n, 6);
  ctx.fillStyle = "#8c90a8";
  ctx.font = "10px system-ui";
  ctx.textAlign = "center";
  for (let k = 0; k < labelCount; k++) {
    const i = Math.round((k / Math.max(labelCount - 1, 1)) * (n - 1));
    const x = xPos(i);
    // Format "dd/mm"
    const parts = data[i].date.split("-");
    const label = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : data[i].date;
    ctx.fillText(label, x, pad.top + chartH + 18);
  }

  if (n === 0) return;

  // Filled area
  ctx.beginPath();
  ctx.moveTo(xPos(0), pad.top + chartH);
  for (let i = 0; i < n; i++) ctx.lineTo(xPos(i), yPos(data[i].scoreTotal));
  ctx.lineTo(xPos(n - 1), pad.top + chartH);
  ctx.closePath();
  const gradient = ctx.createLinearGradient(0, pad.top, 0, pad.top + chartH);
  gradient.addColorStop(0, "rgba(124,108,252,0.35)");
  gradient.addColorStop(1, "rgba(124,108,252,0.03)");
  ctx.fillStyle = gradient;
  ctx.fill();

  // Line
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = xPos(i);
    const y = yPos(data[i].scoreTotal);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.strokeStyle = "#7c6cfc";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Dots (only when few points to avoid clutter)
  if (n <= 60) {
    for (let i = 0; i < n; i++) {
      ctx.beginPath();
      ctx.arc(xPos(i), yPos(data[i].scoreTotal), n > 30 ? 2 : 3, 0, Math.PI * 2);
      ctx.fillStyle = "#7c6cfc";
      ctx.fill();
    }
  }
}

// ─── Statistics ───────────────────────────────────────────────────────────────

function renderStats() {
  const container = document.getElementById("history-stats");
  container.innerHTML = "";

  container.appendChild(buildGroupMoyenne());
  container.appendChild(buildGroupRounds());
  container.appendChild(buildGroupStreak());
  container.appendChild(buildGroupJours());
}

/** Returns avg score or null for the first n results (already sorted desc). */
function avgScore(results, n) {
  const slice = n != null ? results.slice(0, n) : results;
  if (slice.length === 0) return null;
  return slice.reduce((s, r) => s + r.scoreTotal, 0) / slice.length;
}

function fmtAvg(val) {
  return val != null ? val.toFixed(1) : t("historique.stat_no_data");
}

function buildGroupMoyenne() {
  const desc = [...allResults]; // already desc
  return buildGroup(t("historique.stat_avg_title"), [
    [t("historique.stat_avg_7d"),  fmtAvg(avgScore(desc, 7))],
    [t("historique.stat_avg_30d"), fmtAvg(avgScore(desc, 30))],
    [t("historique.stat_avg_90d"), fmtAvg(avgScore(desc, 90))],
    [t("historique.stat_avg_all"), fmtAvg(avgScore(desc))],
  ]);
}

function buildGroupRounds() {
  let won = 0, failed = 0, partial = 0, total = 0;
  for (const r of allResults) {
    for (const round of r.rounds) {
      total++;
      if (round.status === "fail") {
        failed++;
      } else if (round.fails_count === 0) {
        won++;
      } else {
        partial++;
      }
    }
  }
  const pct = n => total > 0 ? `${n} (${Math.round((n / total) * 100)}%)` : t("historique.stat_no_data");

  return buildGroup(t("historique.stat_rounds_title"), [
    [t("historique.stat_rounds_won"),     pct(won)],
    [t("historique.stat_rounds_partial"), pct(partial)],
    [t("historique.stat_rounds_failed"),  pct(failed)],
  ]);
}

function buildGroupStreak() {
  const { dayStreak, dayStreakMax } = computeDayStreaks();
  const { roundStreak, roundStreakMax } = computeRoundStreaks();
  return buildGroup(t("historique.stat_streak_title"), [
    [t("historique.stat_streak_day_current"),   String(dayStreak)],
    [t("historique.stat_streak_day_max"),        String(dayStreakMax)],
    [t("historique.stat_streak_round_current"),  String(roundStreak)],
    [t("historique.stat_streak_round_max"),      String(roundStreakMax)],
  ]);
}

function buildGroupJours() {
  const asc = [...allResults].reverse();
  const first = asc.length > 0 ? asc[0].date : t("historique.stat_no_data");
  const lastPerfect = [...allResults].find(r => r.scoreTotal === 50);
  const lastPerfectStr = lastPerfect ? lastPerfect.date : t("historique.stat_never");
  return buildGroup(t("historique.stat_days_title"), [
    [t("historique.stat_days_first"),        first],
    [t("historique.stat_days_last_perfect"), lastPerfectStr],
    [t("historique.stat_days_total"),        String(allResults.length)],
  ]);
}

/** Builds a stat group card with rows of [label, value]. */
function buildGroup(title, rows) {
  const group = document.createElement("div");
  group.className = "stat-group";

  const h = document.createElement("div");
  h.className = "stat-group-title";
  h.textContent = title;
  group.appendChild(h);

  for (const [label, value] of rows) {
    const row = document.createElement("div");
    row.className = "stat-row";

    const l = document.createElement("span");
    l.className = "stat-label";
    l.textContent = label;

    const v = document.createElement("span");
    v.className = "stat-value";
    v.textContent = value;

    row.appendChild(l);
    row.appendChild(v);
    group.appendChild(row);
  }
  return group;
}

// ─── Streak helpers ──────────────────────────────────────────────────────────

function computeDayStreaks() {
  if (allResults.length === 0) return { dayStreak: 0, dayStreakMax: 0 };

  // Current streak (from most recent, going backward)
  let dayStreak = 1;
  for (let i = 0; i < allResults.length - 1; i++) {
    const d1 = parseDateStr(allResults[i].date);
    const d2 = parseDateStr(allResults[i + 1].date);
    const diff = Math.round((d1 - d2) / 86400000);
    if (diff === 1) dayStreak++;
    else break;
  }

  // Max streak (scan ascending)
  const asc = [...allResults].reverse();
  let dayStreakMax = 1, run = 1;
  for (let i = 1; i < asc.length; i++) {
    const d1 = parseDateStr(asc[i].date);
    const d2 = parseDateStr(asc[i - 1].date);
    const diff = Math.round((d1 - d2) / 86400000);
    if (diff === 1) { run++; if (run > dayStreakMax) dayStreakMax = run; }
    else run = 1;
  }

  return { dayStreak, dayStreakMax };
}

function computeRoundStreaks() {
  // Flatten rounds chronologically (ascending dates, rounds in order)
  const asc = [...allResults].reverse();
  const wonList = [];
  for (const result of asc) {
    const sorted = [...result.rounds].sort((a, b) => a.round_number - b.round_number);
    for (const r of sorted) wonList.push(r.status === "win");
  }

  if (wonList.length === 0) return { roundStreak: 0, roundStreakMax: 0 };

  // Max streak
  let roundStreakMax = 0, run = 0;
  for (const won of wonList) {
    if (won) { run++; if (run > roundStreakMax) roundStreakMax = run; }
    else run = 0;
  }

  // Current streak (from tail)
  let roundStreak = 0;
  for (let i = wonList.length - 1; i >= 0; i--) {
    if (wonList[i]) roundStreak++;
    else break;
  }

  return { roundStreak, roundStreakMax };
}

init();

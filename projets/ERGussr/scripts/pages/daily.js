/**
 * Page controller: daily.html
 * Workflow: date param → validate → load or show result → 5 rounds with seeded items.
 */
import { loadTranslations, t, getLang } from "../business/i18n.js";
import { getLangPref } from "../business/settings.js";
import { loadAllItems } from "../business/dataLoader.js";
import { createSeededRng, pickRandom } from "../business/seededRng.js";
import { checkGuess, buildAutocompleteList, getTodayDateStr, parseDateStr, isDateValid } from "../business/gameLogic.js";
import { getDailyResult, saveDailyResult } from "../business/database.js";
import { DailyResult } from "../entity/DailyResult.js";
import { applyTranslations, setActiveNav, showToast, shakeElement, setInputInvalid } from "../visual/ui.js";
import { attachAutocomplete } from "../visual/autocomplete.js";
import { renderItemPicture, renderItemPictureRevealed, renderClues, renderSummaryCard } from "../visual/roundRenderer.js";

const TOTAL_ROUNDS = 5;

// Game state
let items = [];
let autocompleteList = [];
let lang = "fr";
let dailyDate = "";
let rounds = []; // array of { item, fails, found, score }
let currentRoundIdx = 0;

async function init() {
  lang = getLangPref();
  await loadTranslations(lang);
  applyTranslations();
  setActiveNav();
  initNavToggle();

  // Resolve date from URL param
  dailyDate = getDateParam();
  document.getElementById("daily-date-label").textContent = dailyDate;

  // Validate date
  if (!isDateValid(dailyDate)) {
    console.warn(`[daily] Date is in the future: ${dailyDate}`);
    document.getElementById("error-future").classList.remove("hidden");
    return;
  }

  // Check if already played
  const existing = await getDailyResult(dailyDate);
  if (existing) {
    console.log(`[daily] Already played: ${dailyDate}`, existing);
    showAlreadyPlayed(existing);
    return;
  }

  // Load items and start game
  items = await loadAllItems();
  autocompleteList = buildAutocompleteList(items, lang);
  console.log(`[daily] Starting daily for ${dailyDate}. Items: ${items.length}`);

  // Pick 5 items with seeded RNG
  const rng = createSeededRng(dailyDate);
  const selectedItems = pickRandom(items, TOTAL_ROUNDS, rng);
  console.log("[daily] Selected items:", selectedItems.map(i => i.id));

  rounds = selectedItems.map((item, i) => ({
    item,
    fails: 0,
    found: false,
    score: 0
  }));

  document.getElementById("daily-game").classList.remove("hidden");
  buildProgressDots();
  startRound(0);

  document.getElementById("btn-submit").addEventListener("click", handleSubmit);
  document.getElementById("btn-reveal").addEventListener("click", handleReveal);
  document.getElementById("btn-next").addEventListener("click", handleNext);
  document.getElementById("guess-input").addEventListener("keydown", e => {
    if (e.key === "Enter") handleSubmit();
  });

  attachAutocomplete(
    document.getElementById("guess-input"),
    autocompleteList,
    (val) => { document.getElementById("guess-input").value = val; }
  );
}

function initNavToggle() {
  document.getElementById("nav-toggle")?.addEventListener("click", () =>
    document.getElementById("nav-links")?.classList.toggle("open")
  );
}

/** Gets date param from URL, or inserts today's date and reloads. */
function getDateParam() {
  const params = new URLSearchParams(window.location.search);
  let date = params.get("date");
  if (!date) {
    const today = getTodayDateStr();
    const url = new URL(window.location.href);
    url.searchParams.set("date", today);
    window.history.replaceState({}, "", url.toString());
    return today;
  }
  return date;
}

function buildProgressDots() {
  const container = document.getElementById("round-progress");
  container.innerHTML = "";
  for (let i = 0; i < TOTAL_ROUNDS; i++) {
    const dot = document.createElement("div");
    dot.className = "round-dot";
    dot.id = `dot-${i}`;
    container.appendChild(dot);
  }
  updateProgressDots();
}

function updateProgressDots() {
  for (let i = 0; i < TOTAL_ROUNDS; i++) {
    const dot = document.getElementById(`dot-${i}`);
    if (!dot) continue;
    dot.className = "round-dot";
    if (i < currentRoundIdx) {
      dot.classList.add(rounds[i].found ? "done" : "failed");
    } else if (i === currentRoundIdx) {
      dot.classList.add("active");
    }
  }
}

function startRound(idx) {
  currentRoundIdx = idx;
  const round = rounds[idx];
  console.log(`[daily] Starting round ${idx + 1}: ${round.item.id}`);

  document.getElementById("current-round-num").textContent = idx + 1;
  document.getElementById("item-reveal-zone").classList.add("hidden");
  document.getElementById("guess-form").classList.remove("hidden");
  document.getElementById("guess-input").value = "";
  setInputInvalid(document.getElementById("guess-input"), false);

  document.getElementById("round-picture").innerHTML = renderItemPicture(round.item);
  document.getElementById("round-clues").innerHTML = renderClues(round.item, round.fails, lang);
  updateProgressDots();
  document.getElementById("guess-input").focus();
}

function handleSubmit() {
  const input = document.getElementById("guess-input");
  const guess = input.value.trim();
  if (!guess) return;

  const round = rounds[currentRoundIdx];

  // Validate guess is in list
  const normalizedGuess = guess.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const inList = autocompleteList.some(n =>
    n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() === normalizedGuess
  );

  if (!inList) {
    console.log(`[daily] Guess not in list: "${guess}"`);
    shakeElement(input);
    setInputInvalid(input, true);
    showToast(t("daily.not_found"), "error", 2000);
    return;
  }
  setInputInvalid(input, false);

  if (checkGuess(guess, round.item, lang)) {
    const pts = round.fails === 0 ? 10 : round.fails === 1 ? 5 : 2;
    round.score = pts;
    round.found = true;
    console.log(`[daily] Round ${currentRoundIdx + 1} correct! +${pts} pts`);
    showToast(`+${pts} pts`, "success");
    revealRound();
  } else {
    round.fails++;
    console.log(`[daily] Wrong guess. Fails: ${round.fails}`);
    shakeElement(input);

    if (round.fails >= 3) {
      // Full fail — reveal without points
      round.score = 0;
      round.found = false;
      showToast("+0 pts", "error");
      revealRound();
    } else {
      showToast(t("practice.wrong"), "error", 1500);
      // Show more clues
      document.getElementById("round-clues").innerHTML = renderClues(round.item, round.fails, lang);
    }
  }
  input.value = "";
}

function handleReveal() {
  const round = rounds[currentRoundIdx];
  round.score = 0;
  round.found = false;
  round.fails = 3;
  console.log(`[daily] Round ${currentRoundIdx + 1} manually revealed`);
  showToast("+0 pts", "error");
  revealRound();
}

function revealRound() {
  const round = rounds[currentRoundIdx];
  // Unblack the image
  document.getElementById("round-picture").innerHTML = renderItemPictureRevealed(round.item);
  // Show all clues, uncensored
  document.getElementById("round-clues").innerHTML = renderClues(round.item, 2, lang);

  document.getElementById("guess-form").classList.add("hidden");
  document.getElementById("revealed-name").textContent = round.item.getName(lang);
  document.getElementById("item-reveal-zone").classList.remove("hidden");

  // Update btn-next label: "Finish" if last round
  const isLast = currentRoundIdx === TOTAL_ROUNDS - 1;
  document.getElementById("btn-next").setAttribute("data-i18n", isLast ? "daily.finish" : "daily.next");
  document.getElementById("btn-next").textContent = t(isLast ? "daily.finish" : "daily.next");

  updateProgressDots();
}

async function handleNext() {
  const isLast = currentRoundIdx === TOTAL_ROUNDS - 1;
  if (isLast) {
    await finishDaily();
  } else {
    startRound(currentRoundIdx + 1);
  }
}

async function finishDaily() {
  const totalScore = rounds.reduce((sum, r) => sum + r.score, 0);
  console.log(`[daily] Daily finished. Total score: ${totalScore}`);

  const roundsData = rounds.map((r, i) => ({
    round_number: i + 1,
    score_round: r.score,
    fails_count: Math.min(r.fails, 3),
    status: r.found ? "win" : "fail"
  }));

  const result = new DailyResult(dailyDate, totalScore, roundsData);
  await saveDailyResult(result);
  console.log("[daily] Result saved to IndexedDB");

  showResults(result);
}

function showResults(result) {
  document.getElementById("daily-game").classList.add("hidden");
  document.getElementById("daily-results").classList.remove("hidden");
  document.getElementById("result-total-score").textContent = result.scoreTotal;
  document.getElementById("results-date").textContent = `${t("daily.title")} — ${result.date}`;

  const shareText = result.toShareString();
  document.getElementById("share-text").textContent = shareText;

  // Summary cards
  const cardsContainer = document.getElementById("summary-cards");
  cardsContainer.innerHTML = rounds.map((r, i) =>
    renderSummaryCard(r.item, result.rounds[i], lang)
  ).join("");

  document.getElementById("btn-copy").addEventListener("click", () => {
    navigator.clipboard.writeText(shareText).then(() => {
      showToast(t("daily.copied"), "success");
    }).catch(() => {
      // Fallback
      const ta = document.createElement("textarea");
      ta.value = shareText;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      showToast(t("daily.copied"), "success");
    });
  });
}

function showAlreadyPlayed(existing) {
  document.getElementById("already-played").classList.remove("hidden");
  const area = document.getElementById("previous-result-area");

  const shareText = existing.toShareString();
  area.innerHTML = `
    <div class="share-box">${shareText}</div>
    <p class="text-primary" style="font-size:1.4rem;font-weight:700">${t("daily.score")}: ${existing.scoreTotal}</p>`;
}

init();

/**
 * Page controller: practice.html
 * Infinite guessing game with 3 lives.
 */
import { loadTranslations, t, getLang } from "../business/i18n.js";
import { getLangPref, getHighscore, updateHighscore } from "../business/settings.js";
import { loadAllItems } from "../business/dataLoader.js";
import { checkGuess, buildAutocompleteList } from "../business/gameLogic.js";
import { applyTranslations, setActiveNav, showToast, shakeElement, setInputInvalid } from "../visual/ui.js";
import { attachAutocomplete } from "../visual/autocomplete.js";
import { renderItemPicture, renderClues } from "../visual/roundRenderer.js";

// Game state
let items = [];
let autocompleteList = [];
let lang = "fr";
let lives = 3;
let score = 0;
let currentItem = null;
let fails = 0; // fails for current round (0,1,2)

async function init() {
  lang = getLangPref();
  await loadTranslations(lang);
  applyTranslations();
  setActiveNav();
  initNavToggle();

  items = await loadAllItems();
  autocompleteList = buildAutocompleteList(items, lang);
  console.log(`[practice] Loaded ${items.length} items, autocomplete list size: ${autocompleteList.length}`);

  document.getElementById("hud-highscore").textContent = getHighscore();

  document.getElementById("btn-submit").addEventListener("click", handleSubmit);
  document.getElementById("btn-reveal").addEventListener("click", handleReveal);
  document.getElementById("btn-play-again").addEventListener("click", resetGame);
  document.getElementById("guess-input").addEventListener("keydown", e => {
    if (e.key === "Enter") handleSubmit();
  });

  attachAutocomplete(
    document.getElementById("guess-input"),
    autocompleteList,
    (val) => { document.getElementById("guess-input").value = val; }
  );

  startRound();
}

function initNavToggle() {
  document.getElementById("nav-toggle")?.addEventListener("click", () =>
    document.getElementById("nav-links")?.classList.toggle("open")
  );
}

function pickRandomItem() {
  const idx = Math.floor(Math.random() * items.length);
  return items[idx];
}

function startRound() {
  currentItem = pickRandomItem();
  fails = 0;
  console.log(`[practice] New round: ${currentItem.id} — ${currentItem.getName(lang)}`);
  renderRound();
}

function renderRound() {
  document.getElementById("round-picture").innerHTML = renderItemPicture(currentItem);
  document.getElementById("round-clues").innerHTML = renderClues(currentItem, fails, lang);
  document.getElementById("guess-input").value = "";
  setInputInvalid(document.getElementById("guess-input"), false);
  document.getElementById("guess-input").focus();
  updateHUD();
}

function updateHUD() {
  document.getElementById("hud-lives").textContent = "❤️".repeat(lives) + "🖤".repeat(3 - lives);
  document.getElementById("hud-score").textContent = score;
}

function handleSubmit() {
  const input = document.getElementById("guess-input");
  const guess = input.value.trim();
  if (!guess) return;

  // Check if guess is in the autocomplete list (case/accent insensitive)
  const normalizedGuess = guess.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const inList = autocompleteList.some(n =>
    n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() === normalizedGuess
  );

  if (!inList) {
    console.log(`[practice] Guess not in list: "${guess}"`);
    shakeElement(input);
    setInputInvalid(input, true);
    showToast(t("practice.not_found"), "error", 2000);
    return;
  }
  setInputInvalid(input, false);

  if (checkGuess(guess, currentItem, lang)) {
    const pts = fails === 0 ? 10 : fails === 1 ? 5 : 2;
    score += pts;
    console.log(`[practice] Correct! +${pts} pts (fails: ${fails})`);
    showToast(`+${pts} pts`, "success");
    updateHighscore(score);
    document.getElementById("hud-highscore").textContent = getHighscore();
    setTimeout(startRound, 900);
  } else {
    fails++;
    console.log(`[practice] Wrong guess. Fails: ${fails}`);
    showToast(t("practice.wrong"), "error", 1800);
    shakeElement(input);

    if (fails >= 3) {
      // Full fail = lose a life
      loseLife();
    } else {
      renderRound();
    }
  }
  input.value = "";
}

function handleReveal() {
  console.log(`[practice] Reveal pressed for: ${currentItem.id}`);
  showToast(`${t("practice.item_was")} ${currentItem.getName(lang)}`, "info", 3000);
  loseLife();
}

function loseLife() {
  lives--;
  console.log(`[practice] Life lost. Lives remaining: ${lives}`);
  showToast(t("practice.wrong"), "error", 1500);

  if (lives <= 0) {
    showGameOver();
  } else {
    setTimeout(startRound, 1200);
  }
}

function showGameOver() {
  console.log(`[practice] Game over. Score: ${score}`);
  const isNewRecord = updateHighscore(score);
  document.getElementById("final-score").textContent = score;
  document.getElementById("final-highscore").textContent = getHighscore();
  document.getElementById("new-record-msg").classList.toggle("hidden", !isNewRecord);
  document.getElementById("game-area").classList.add("hidden");
  document.getElementById("game-hud").classList.add("hidden");
  document.getElementById("game-over").classList.remove("hidden");
}

function resetGame() {
  lives = 3;
  score = 0;
  document.getElementById("game-area").classList.remove("hidden");
  document.getElementById("game-hud").classList.remove("hidden");
  document.getElementById("game-over").classList.add("hidden");
  updateHUD();
  startRound();
}

init();

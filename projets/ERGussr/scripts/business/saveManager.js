/**
 * Save/Import/Export manager.
 * Handles serialization to Base64-encoded JSON and import logic.
 */
import { getAllDailyResults, saveDailyResult, getDailyResult } from "./database.js";
import { DailyResult } from "../entity/DailyResult.js";
import { getHighscore, setHighscore, getLangPref } from "./settings.js";

/**
 * Exports all data to a downloadable .save file.
 */
export async function exportSave() {
  console.log("[SaveManager] Exporting save...");
  const dailies = await getAllDailyResults();
  const payload = {
    l: getLangPref(),
    h: getHighscore(),
    d: dailies.map(dr => dr.toCompact())
  };
  const json = JSON.stringify(payload);
  const b64 = btoa(unescape(encodeURIComponent(json)));

  const today = getTodayStr();
  const filename = `EldenDesc-${today}.save`;
  const blob = new Blob([b64], { type: "text/plain" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  console.log(`[SaveManager] Export complete: ${filename}`);
}

/**
 * Imports a save file. Returns an import result summary object.
 * @param {File} file
 * @returns {Promise<{newDailies: number, skippedDailies: number, highscoreUpdated: boolean, error?: string}>}
 */
export async function importSave(file) {
  console.log("[SaveManager] Importing save file:", file.name);
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const b64 = e.target.result.trim();
        const json = decodeURIComponent(escape(atob(b64)));
        const payload = JSON.parse(json);

        if (!payload || typeof payload !== "object") throw new Error("Invalid format");

        let newDailies = 0;
        let skippedDailies = 0;

        // Import dailies
        if (Array.isArray(payload.d)) {
          for (const compact of payload.d) {
            const existing = await getDailyResult(compact.dt);
            if (existing) {
              console.log(`[SaveManager] Skipping existing daily: ${compact.dt}`);
              skippedDailies++;
            } else {
              const dr = DailyResult.fromCompact(compact);
              await saveDailyResult(dr);
              console.log(`[SaveManager] Imported daily: ${compact.dt}`);
              newDailies++;
            }
          }
        }

        // Import highscore
        let highscoreUpdated = false;
        if (typeof payload.h === "number") {
          const current = getHighscore();
          if (payload.h > current) {
            setHighscore(payload.h);
            highscoreUpdated = true;
            console.log(`[SaveManager] Highscore updated to ${payload.h}`);
          } else {
            console.log(`[SaveManager] Highscore ignored (imported ${payload.h} <= current ${current})`);
          }
        }

        resolve({ newDailies, skippedDailies, highscoreUpdated });
      } catch (err) {
        console.error("[SaveManager] Import error:", err);
        resolve({ newDailies: 0, skippedDailies: 0, highscoreUpdated: false, error: err.message });
      }
    };
    reader.onerror = () => resolve({ newDailies: 0, skippedDailies: 0, highscoreUpdated: false, error: "Read error" });
    reader.readAsText(file);
  });
}

/**
 * Parses a shared daily result text into a DailyResult object.
 * Supports both emoji and GitHub shortcode variants (:green_square:, :orange_square:, :red_square:).
 * @param {string} text - The shared text from a daily result
 * @returns {{ result: DailyResult|null, error: string|null }}
 */
export function parseDailyText(text) {
  if (!text || typeof text !== "string") {
    return { result: null, error: "No text provided" };
  }

  const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length < 6) {
    return { result: null, error: "Not enough lines (need header + 5 rounds)" };
  }

  // --- Parse header ---
  // "Elden Description Daily — DD-MM-YYYY — score N"
  const headerMatch = lines[0].match(/^Elden\s+Description\s+Daily\s*[—-]\s*(\d{2}-\d{2}-\d{4})\s*[—-]\s*score\s+(\d+)/i);
  if (!headerMatch) {
    return { result: null, error: "Invalid header format" };
  }
  const date = headerMatch[1];
  const scoreTotal = parseInt(headerMatch[2], 10);

  // --- Parse 5 round lines (lines 1-5) ---
  const roundLines = lines.slice(1, 6);

  /**
   * Extracts up to 3 square emojis from a round line.
   * Handles both actual emojis (🟩🟧🟥) and shortcodes (:green_square: etc.),
   * including mixed patterns.
   * @param {string} line
   * @returns {string[]} Array of emoji characters, always length 3 on success
   */
  function extractSquares(line) {
    // 1) Replace any shortcodes with actual emoji first
    let processed = line
      .replace(/:green_square:/g, "🟩")
      .replace(/:orange_square:/g, "🟧")
      .replace(/:red_square:/g, "🟥");

    // 2) Scan the string for 🟩 🟧 🟥 characters
    // Since emojis can span multiple UTF-16 code units, use [...str] to split grapheme clusters
    const chars = [...processed];
    const result = [];
    for (const ch of chars) {
      if (ch === "🟩" || ch === "🟧" || ch === "🟥") {
        result.push(ch);
        if (result.length === 3) break;
      }
    }
    return result;
  }

  const rounds = [];
  for (let i = 0; i < 5; i++) {
    const rawLine = roundLines[i];
    const squares = extractSquares(rawLine);

    if (squares.length < 3) {
      return { result: null, error: `Round ${i + 1} line has invalid format: "${rawLine}"` };
    }

    // Determine fails count based on pattern
    let failsCount;
    if (squares[0] === "🟩" && squares[1] === "🟩" && squares[2] === "🟩") failsCount = 0;       // perfect
    else if (squares[0] === "🟧" && squares[1] === "🟩" && squares[2] === "🟩") failsCount = 1;   // 1 fail
    else if (squares[0] === "🟧" && squares[1] === "🟧" && squares[2] === "🟩") failsCount = 2;   // 2 fails
    else if (squares[0] === "🟥" && squares[1] === "🟥" && squares[2] === "🟥") failsCount = 3;   // failed
    else failsCount = 3; // Unknown pattern, treat as fail

    const scoreRound = failsCount === 0 ? 10 : failsCount === 1 ? 5 : failsCount === 2 ? 2 : 0;
    const status = scoreRound > 0 ? "win" : "fail";

    rounds.push({
      round_number: i + 1,
      score_round: scoreRound,
      fails_count: failsCount,
      status
    });
  }

  // --- Parse optional wrong guess lines (R1 : || guess || - || guess ||) ---
  const wrongGuesses = Array.from({ length: 5 }, () => []);
  for (let j = 6; j < lines.length; j++) {
    const line = lines[j];
    const guessMatch = line.match(/^R(\d+)\s*:(.*)/i);
    if (!guessMatch) continue;
    const roundIdx = parseInt(guessMatch[1], 10) - 1;
    if (roundIdx < 0 || roundIdx >= 5) continue;

    // Extract guesses from spoiler markers || ... ||
    // Also handle the "> *reveal*" marker
    const spoilerRegex = /\|\|([^|]+)\|\||>\s*\*reveal\*/g;
    let spoilerMatch;
    const guesses = [];
    while ((spoilerMatch = spoilerRegex.exec(guessMatch[2])) !== null) {
      if (spoilerMatch[0] === "> *reveal*") {
        guesses.push("> *reveal*");
      } else if (spoilerMatch[1]) {
        guesses.push(spoilerMatch[1].trim());
      }
    }

    wrongGuesses[roundIdx] = guesses;
  }

  const result = new DailyResult(date, scoreTotal, rounds, wrongGuesses);
  return { result, error: null };
}

/** Returns today's date as "jj-mm-yyyy". */
function getTodayStr() {
  const now = new Date();
  const d = String(now.getDate()).padStart(2, "0");
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const y = now.getFullYear();
  return `${d}-${m}-${y}`;
}

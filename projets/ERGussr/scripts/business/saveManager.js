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

/** Returns today's date as "jj-mm-yyyy". */
function getTodayStr() {
  const now = new Date();
  const d = String(now.getDate()).padStart(2, "0");
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const y = now.getFullYear();
  return `${d}-${m}-${y}`;
}

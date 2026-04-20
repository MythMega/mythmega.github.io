/**
 * Round renderer — builds the HTML for a game round display.
 */
import { t, getLang } from "../business/i18n.js";
import { escapeHtml } from "./ui.js";

/**
 * Renders the item picture (blacked-out).
 * @param {import('../entity/Item.js').Item} item
 * @returns {string} HTML string
 */
export function renderItemPicture(item) {
  const url = escapeHtml(item.pictureURL);
  const alt = t("common.pic_not_available");
  return `<div class="item-picture-wrapper">
    <img src="${url}" alt="${alt}" class="item-picture blacked-out" onerror="this.alt='${alt}';this.classList.add('img-error')">
  </div>`;
}

/**
 * Renders the item picture unmasked (for reveal).
 * @param {import('../entity/Item.js').Item} item
 * @returns {string} HTML string
 */
export function renderItemPictureRevealed(item) {
  const url = escapeHtml(item.pictureURL);
  const alt = t("common.pic_not_available");
  return `<div class="item-picture-wrapper">
    <img src="${url}" alt="${alt}" class="item-picture" onerror="this.alt='${alt}';this.classList.add('img-error')">
  </div>`;
}

/**
 * Builds the clue HTML based on fail count.
 * @param {import('../entity/Item.js').Item} item
 * @param {number} fails - 0, 1, or 2
 * @param {string} lang
 * @returns {string} HTML string
 */
export function renderClues(item, fails, lang) {
  const censor = fails < 2;
  let html = "";

  // DESC1 always shown, censored if fails < 2
  const desc1 = item.getDesc1(lang);
  if (desc1) {
    const text = censor ? item.censorName(desc1, lang) : desc1;
    html += `<div class="clue clue-desc1"><span class="clue-label">Desc 1</span><p>${escapeHtml(text)}</p></div>`;
  }

  if (fails >= 1) {
    // Show ID
    html += `<div class="clue clue-id"><span class="clue-label">ID</span><p>${escapeHtml(item.id)}</p></div>`;

    // DESC2
    const desc2 = item.getDesc2(lang) || t("common.separator");
    const text2 = censor ? item.censorName(desc2, lang) : desc2;
    html += `<div class="clue clue-desc2"><span class="clue-label">Desc 2</span><p>${escapeHtml(text2)}</p></div>`;

    // DESC3 (goods only, others may be empty)
    const desc3Raw = item.getDesc3(lang);
    if (desc3Raw) {
      const text3 = censor ? item.censorName(desc3Raw, lang) : desc3Raw;
      html += `<div class="clue clue-desc3"><span class="clue-label">Desc 3</span><p>${escapeHtml(text3)}</p></div>`;
    }
  }

  return html;
}

/**
 * Renders a summary card for a finished round (used in daily results).
 * @param {import('../entity/Item.js').Item} item
 * @param {{score_round:number, fails_count:number, status:string}} roundData
 * @param {string} lang
 * @returns {string} HTML
 */
export function renderSummaryCard(item, roundData, lang) {
  const name = item.getName(lang);
  const url = escapeHtml(item.pictureURL);
  const alt = t("common.pic_not_available");
  const emoji = roundData.status === "fail" ? "🟥🟥🟥"
    : roundData.fails_count === 0 ? "🟩🟩🟩"
    : roundData.fails_count === 1 ? "🟧🟩🟩"
    : "🟧🟧🟩";
  return `
    <div class="summary-card">
      <img src="${url}" alt="${alt}" class="summary-img" onerror="this.alt='${alt}'">
      <div class="summary-info">
        <p class="summary-name">${escapeHtml(name)}</p>
        <p class="summary-emoji">${emoji}</p>
        <p class="summary-score">+${roundData.score_round} pts</p>
      </div>
    </div>`;
}

/**
 * UI helpers: navigation, notifications, modals, language apply.
 */
import { t, getLang } from "../business/i18n.js";

/** Applies all data-i18n attributes to the DOM using the loaded translations. */
export function applyTranslations() {
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.getAttribute("data-i18n");
    const translated = t(key);
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      el.placeholder = translated;
    } else {
      el.textContent = translated;
    }
  });
  // Also handle data-i18n-placeholder
  document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
    el.placeholder = t(el.getAttribute("data-i18n-placeholder"));
  });
}

/** Highlights the active nav link based on current page. */
export function setActiveNav() {
  const current = window.location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".nav-link").forEach(link => {
    const href = link.getAttribute("href") || "";
    link.classList.toggle("active", href === current || href.endsWith(current));
  });
}

/**
 * Shows a toast notification in the top-right corner.
 * @param {string} message
 * @param {"success"|"error"|"info"} type
 * @param {number} duration - ms
 */
export function showToast(message, type = "info", duration = 2800) {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    document.body.appendChild(container);
  }
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  // Trigger animation
  requestAnimationFrame(() => toast.classList.add("toast-visible"));
  setTimeout(() => {
    toast.classList.remove("toast-visible");
    toast.addEventListener("transitionend", () => toast.remove(), { once: true });
  }, duration);
}

/**
 * Shows a confirmation modal and returns a promise resolving to true/false.
 * @param {string} message
 * @returns {Promise<boolean>}
 */
export function showConfirm(message) {
  return new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal">
        <p class="modal-message">${escapeHtml(message)}</p>
        <div class="modal-actions">
          <button class="btn btn-secondary" id="modal-cancel">${t("common.cancel")}</button>
          <button class="btn btn-danger" id="modal-confirm">${t("common.confirm")}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector("#modal-confirm").addEventListener("click", () => {
      overlay.remove();
      resolve(true);
    });
    overlay.querySelector("#modal-cancel").addEventListener("click", () => {
      overlay.remove();
      resolve(false);
    });
  });
}

/**
 * Shows an info modal popup with a title and HTML content.
 * @param {string} title
 * @param {string} htmlContent
 */
export function showModal(title, htmlContent) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal">
      <h3 class="modal-title">${escapeHtml(title)}</h3>
      <div class="modal-body">${htmlContent}</div>
      <div class="modal-actions">
        <button class="btn btn-primary" id="modal-close">${t("common.close")}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector("#modal-close").addEventListener("click", () => overlay.remove());
}

/**
 * Shakes the given input element (invalid guess).
 * @param {HTMLElement} el
 */
export function shakeElement(el) {
  el.classList.remove("shake");
  void el.offsetWidth; // reflow
  el.classList.add("shake");
  el.addEventListener("animationend", () => el.classList.remove("shake"), { once: true });
}

/**
 * Marks an input as invalid (red outline).
 * @param {HTMLElement} el
 * @param {boolean} invalid
 */
export function setInputInvalid(el, invalid) {
  el.classList.toggle("input-invalid", invalid);
}

/** Escapes HTML special chars. */
export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

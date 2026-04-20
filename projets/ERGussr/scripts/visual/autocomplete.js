/**
 * Autocomplete widget for item name guessing.
 */
import { filterSuggestions } from "../business/gameLogic.js";
import { escapeHtml } from "./ui.js";

/**
 * Attaches autocomplete behavior to an input element.
 * @param {HTMLInputElement} input
 * @param {string[]} list - Full list of possible names
 * @param {(value: string) => void} onSelect - Callback when a suggestion is selected
 */
export function attachAutocomplete(input, list, onSelect) {
  let dropdown = null;

  function closeDropdown() {
    if (dropdown) {
      dropdown.remove();
      dropdown = null;
    }
  }

  function renderDropdown(suggestions) {
    closeDropdown();
    if (suggestions.length === 0) return;

    dropdown = document.createElement("ul");
    dropdown.className = "autocomplete-dropdown";

    suggestions.forEach(name => {
      const li = document.createElement("li");
      li.className = "autocomplete-item";
      li.textContent = name;
      li.addEventListener("mousedown", e => {
        e.preventDefault(); // prevent input blur before click fires
        input.value = name;
        closeDropdown();
        onSelect(name);
      });
      dropdown.appendChild(li);
    });

    // Position below the input
    const rect = input.getBoundingClientRect();
    dropdown.style.width = input.offsetWidth + "px";
    input.parentElement.style.position = "relative";
    input.parentElement.appendChild(dropdown);
  }

  input.addEventListener("input", () => {
    const suggestions = filterSuggestions(list, input.value);
    renderDropdown(suggestions);
  });

  input.addEventListener("keydown", e => {
    if (!dropdown) return;
    const items = dropdown.querySelectorAll(".autocomplete-item");
    const active = dropdown.querySelector(".autocomplete-item.active");
    let idx = active ? Array.from(items).indexOf(active) : -1;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (active) active.classList.remove("active");
      idx = (idx + 1) % items.length;
      items[idx].classList.add("active");
      items[idx].scrollIntoView({ block: "nearest" });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (active) active.classList.remove("active");
      idx = (idx - 1 + items.length) % items.length;
      items[idx].classList.add("active");
      items[idx].scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      if (active) {
        e.preventDefault();
        input.value = active.textContent;
        closeDropdown();
        onSelect(active.textContent);
      }
    } else if (e.key === "Escape") {
      closeDropdown();
    }
  });

  input.addEventListener("blur", () => setTimeout(closeDropdown, 150));
}

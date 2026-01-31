let fullData = [];
let filteredData = [];
let renderedCount = 0;

const BATCH_SIZE = 20;

const tableBody = document.getElementById("pokemonTableBody");
const filterInput = document.getElementById("filterInput");
const loadingIndicator = document.getElementById("loadingIndicator");
const noResult = document.getElementById("noResult");

// --- Création d'une ligne ---
function createRow(poke) {
  const tr = document.createElement("tr");
  tr.classList.add("fade-row");

  tr.innerHTML = `
    <td><img class="sprite" src="${poke.Sprite}" alt="${poke.Nom}"></td>
    <td>${poke.Nom}</td>
    <td><span class="type-badge">${poke.Type1}</span></td>
    <td><span class="type-badge">${poke.Type2 ?? "/"}</span></td>
  `;

  return tr;
}

// --- Rendu progressif ---
function renderNextBatch() {
  if (renderedCount >= filteredData.length) return;

  loadingIndicator.classList.remove("hidden");

  const start = renderedCount;
  const end = Math.min(start + BATCH_SIZE, filteredData.length);

  const fragment = document.createDocumentFragment();

  for (let i = start; i < end; i++) {
    fragment.appendChild(createRow(filteredData[i]));
  }

  tableBody.appendChild(fragment);
  renderedCount = end;

  loadingIndicator.classList.add("hidden");
}

// --- Filtre ---
function applyFilter() {
  const value = filterInput.value.trim().toLowerCase();

  if (!value) {
    filteredData = [...fullData];
  } else {
    filteredData = fullData.filter((p) =>
      p.Nom.toLowerCase().includes(value) ||
      p.Type1.toLowerCase().includes(value) ||
      (p.Type2 ?? "").toLowerCase().includes(value)
    );
  }

  tableBody.innerHTML = "";
  renderedCount = 0;

  if (filteredData.length === 0) {
    noResult.classList.remove("hidden");
  } else {
    noResult.classList.add("hidden");
    renderNextBatch();
  }
}

// --- Scroll infini ---
function handleScroll() {
  const { scrollTop, scrollHeight, clientHeight } = document.documentElement;

  if (scrollTop + clientHeight >= scrollHeight - 80) {
    renderNextBatch();
  }
}

// --- Chargement du JSON ---
async function loadData() {
  const res = await fetch("bannedpoke.json");
  fullData = await res.json();
  // Trier les données par nom alphabétiquement
  fullData.sort((a, b) => a.Nom.localeCompare(b.Nom, 'fr'));
  filteredData = [...fullData];
  renderNextBatch();
}

// --- Init ---
document.addEventListener("DOMContentLoaded", () => {
  loadData();
  filterInput.addEventListener("input", applyFilter);
  window.addEventListener("scroll", handleScroll);
});

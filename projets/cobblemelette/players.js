let fullData = [];
let filteredData = [];
let renderedCount = 0;

const BATCH_SIZE = 20;

const tableBody = document.getElementById("playersTableBody");
const filterInput = document.getElementById("filterInput");
const loadingIndicator = document.getElementById("loadingIndicator");
const noResult = document.getElementById("noResult");

// --- Création d'une ligne ---
function createRow(player) {
  const tr = document.createElement("tr");
  tr.classList.add("fade-row");

  const reseauCell = player.reseau
    ? `<button class="network-btn" onclick="window.open('${player.reseau}', '_blank')"><img src="https://static.thenounproject.com/png/196595-200.png" alt="Réseau"/></button>`
    : "<span>/</span>";

  tr.innerHTML = `
    <td class="icon-cell"><img src="${player.icone}" alt="${player.pseudo}"></td>
    <td>${player.pseudo}</td>
    <td>${reseauCell}</td>
    <td>${player.champion ?? "/"}</td>
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
      p.pseudo.toLowerCase().includes(value) ||
      (p.champion ?? "").toLowerCase().includes(value)
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
  const res = await fetch("players.json");
  fullData = await res.json();
  // Trier les données par pseudo alphabétiquement
  fullData.sort((a, b) => a.pseudo.localeCompare(b.pseudo, 'fr'));
  filteredData = [...fullData];
  renderNextBatch();
}

// --- Init ---
document.addEventListener("DOMContentLoaded", () => {
  loadData();
  filterInput.addEventListener("input", applyFilter);
  window.addEventListener("scroll", handleScroll);
});

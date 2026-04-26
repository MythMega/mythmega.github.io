// ID du Google Sheet
const SHEET_ID = "1ACLXY7DR2KBreQJNVyJZ9FeH4YX2j736FNWiSaQp-Hc";

// URL CSV
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`;

function parseCSV(text) {
    return text
        .trim()
        .split("\n")
        .map(row => row.split(","));
}

function applyPlanning(data) {
    // data[1] = ligne "Horaire"
    // data[2] = ligne "Catégorie"

    const jours = ["lundi","mardi","mercredi","jeudi","vendredi","samedi","dimanche"];

    jours.forEach((jour, index) => {
        const col = index + 1; // car colonne A = index 0

        document.getElementById(`h_${jour}`).textContent = data[1][col] || "";
        document.getElementById(`c_${jour}`).textContent = data[2][col] || "";
    });
}

fetch(CSV_URL)
    .then(res => res.text())
    .then(csv => {
        const data = parseCSV(csv);
        applyPlanning(data);
    })
    .catch(err => console.error("Erreur chargement planning :", err));

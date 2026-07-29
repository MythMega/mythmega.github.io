// ID du Google Sheet
const SHEET_ID = "1ACLXY7DR2KBreQJNVyJZ9FeH4YX2j736FNWiSaQp-Hc";

// URLs CSV
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`;
const CORRESP_GID = "498262046";
const CORRESP_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${CORRESP_GID}`;

// chemins icones
const ICON_TWITCH = "./assets/icon/twitch.png";
const ICON_YOUTUBE = "./assets/icon/youtube.png";

const jours = ["lundi","mardi","mercredi","jeudi","vendredi","samedi","dimanche"];

/**
 * Parse CSV simple mais robuste : gère les champs entre guillemets contenant des virgules.
 * Retourne un tableau de lignes, chaque ligne est un tableau de cellules.
 */
function parseCSV(text) {
    const rows = [];
    let cur = '';
    let row = [];
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const next = text[i + 1];
        if (ch === '"' ) {
            if (inQuotes && next === '"') {
                cur += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }
        if (ch === ',' && !inQuotes) {
            row.push(cur);
            cur = '';
            continue;
        }
        if ((ch === '\n' || ch === '\r') && !inQuotes) {
            if (ch === '\r' && next === '\n') {
                i++;
            }
            row.push(cur);
            rows.push(row);
            row = [];
            cur = '';
            continue;
        }
        cur += ch;
    }
    if (cur !== '' || row.length > 0) {
        row.push(cur);
        rows.push(row);
    }
    return rows.map(r => r.map(c => c.trim()));
}

/**
 * Construire map de correspondances depuis CSV user-corresp
 */
function buildCorrespMap(rows) {
    const map = new Map();
    if (!rows || rows.length === 0) return map;
    const header = rows[0].map(h => h.toLowerCase());
    const idxUser = header.indexOf('user') !== -1 ? header.indexOf('user') : 0;
    const idxTwitch = header.indexOf('twitch');
    const idxYoutube = header.indexOf('youtube');
    for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const user = (r[idxUser] || '').trim();
        if (!user) continue;
        const twitch = idxTwitch !== -1 ? (r[idxTwitch] || '').trim() : '';
        const youtube = idxYoutube !== -1 ? (r[idxYoutube] || '').trim() : '';
        map.set(user.toLowerCase(), { user, twitch, youtube });
    }
    return map;
}

function findCorresp(map, name) {
    if (!name) return null;
    const key = name.trim().toLowerCase();
    return map.get(key) || null;
}

/**
 * Crée un élément DOM pour une personne en feat.
 * Si correspondance trouvée, ajoute icones cliquables.
 */
function createFeatElement(name, corresp) {
    const span = document.createElement('span');
    span.className = 'feat-person';
    const text = document.createElement('span');
    text.textContent = name.trim();
    span.appendChild(text);

    if (corresp) {
        if (corresp.twitch) {
            const a = document.createElement('a');
            a.href = `https://www.twitch.tv/${corresp.twitch}`;
            a.target = '_blank';
            a.rel = 'noopener';
            const img = document.createElement('img');
            img.src = ICON_TWITCH;
            img.alt = 'Twitch';
            img.className = 'icon-link';
            a.appendChild(img);
            span.appendChild(a);
        }
        if (corresp.youtube) {
            const a = document.createElement('a');
            a.href = `https://www.youtube.com/${corresp.youtube}`;
            a.target = '_blank';
            a.rel = 'noopener';
            const img = document.createElement('img');
            img.src = ICON_YOUTUBE;
            img.alt = 'YouTube';
            img.className = 'icon-link';
            a.appendChild(img);
            span.appendChild(a);
        }
    }
    return span;
}

/**
 * Applique les données au tableau.
 */
function applyPlanning(mainRows, correspMap) {
    const indexByKey = {};
    for (let i = 0; i < mainRows.length; i++) {
        const first = (mainRows[i][0] || '').trim().toLowerCase();
        if (first) indexByKey[first] = i;
    }

    function cellValue(rowIndex, colIndex) {
        if (rowIndex == null || rowIndex < 0 || rowIndex >= mainRows.length) return '';
        const row = mainRows[rowIndex];
        return (row[colIndex] || '').trim();
    }

    const horaireRow = indexByKey['horaire'] !== undefined ? indexByKey['horaire'] : null;
    const categorieRow = indexByKey['catégorie'] !== undefined ? indexByKey['catégorie'] : (indexByKey['categorie'] !== undefined ? indexByKey['categorie'] : null);
    const ftRow = indexByKey['ft'] !== undefined ? indexByKey['ft'] : null;
    const ftNoLiveRow = indexByKey['ft-no-live'] !== undefined ? indexByKey['ft-no-live'] : (indexByKey['ft no live'] !== undefined ? indexByKey['ft no live'] : null);
    const imageRow = indexByKey['image'] !== undefined ? indexByKey['image'] : null;

    jours.forEach((jour, idx) => {
        const col = idx + 1;
        // Horaire / Catégorie
        const hEl = document.getElementById(`h_${jour}`);
        const cEl = document.getElementById(`c_${jour}`);
        if (hEl) hEl.textContent = horaireRow !== null ? cellValue(horaireRow, col) : '';
        if (cEl) cEl.textContent = categorieRow !== null ? cellValue(categorieRow, col) : '';

        // Feat
        const fCell = document.getElementById(`f_${jour}`);
        if (fCell) {
            fCell.innerHTML = '';
            const raw = ftRow !== null ? cellValue(ftRow, col) : '';
            const rawNoLive = ftNoLiveRow !== null ? cellValue(ftNoLiveRow, col) : '';

            const names = raw ? raw.split(',').map(s => s.trim()).filter(Boolean) : [];
            const namesNoLive = rawNoLive ? rawNoLive.split(',').map(s => s.trim()).filter(Boolean) : [];

            // afficher ft (avec icones si correspondance)
            if (names.length === 0 && namesNoLive.length === 0) {
                fCell.textContent = '/';
            } else {
                const container = document.createElement('div');
                container.className = 'feat-block';

                // ft with icons
                if (names.length > 0) {
                    names.forEach((n, i) => {
                        const cor = findCorresp(correspMap, n);
                        const el = createFeatElement(n, cor);
                        container.appendChild(el);
                        if (i < names.length - 1) {
                            const sep = document.createElement('span');
                            sep.textContent = ', ';
                            container.appendChild(sep);
                        }
                    });
                }

                // ft-no-live appended as plain pseudos (no icons), separated by comma
                if (namesNoLive.length > 0) {
                    if (names.length > 0) {
                        const br = document.createElement('div');
                        br.style.marginTop = '6px';
                        container.appendChild(br);
                    }
                    namesNoLive.forEach((n, i) => {
                        const span = document.createElement('span');
                        span.textContent = n;
                        container.appendChild(span);
                        if (i < namesNoLive.length - 1) {
                            const sep = document.createElement('span');
                            sep.textContent = ', ';
                            container.appendChild(sep);
                        }
                    });
                }

                fCell.appendChild(container);
            }
        }

        // Image : afficher image 256x256 (pas de lien)
        const iEl = document.getElementById(`i_${jour}`);
        if (iEl) {
            iEl.innerHTML = '';
            const rawImg = imageRow !== null ? cellValue(imageRow, col) : '';
            if (!rawImg) {
                iEl.textContent = '/';
            } else {
                const img = document.createElement('img');
                img.src = rawImg;
                img.alt = `Image ${jour}`;
                img.className = 'img-preview';
                img.width = 256;
                img.height = 256;
                img.onerror = function() {
                    // si l'image ne charge pas, afficher le texte de l'URL
                    iEl.innerHTML = '';
                    const span = document.createElement('span');
                    span.textContent = rawImg;
                    iEl.appendChild(span);
                };
                iEl.appendChild(img);
            }
        }

        // Multistream
        const mEl = document.getElementById(`m_${jour}`);
        if (mEl) {
            mEl.innerHTML = '';
            const raw = ftRow !== null ? cellValue(ftRow, col) : '';
            if (!raw) {
                mEl.textContent = '/';
            } else {
                const names = raw.split(',').map(s => s.trim()).filter(Boolean);
                const twitchList = [];
                names.forEach(n => {
                    const cor = findCorresp(correspMap, n);
                    if (cor && cor.twitch) twitchList.push(cor.twitch);
                });
                if (twitchList.length === 0) {
                    mEl.textContent = '/';
                } else {
                    const parts = ['mythmega', ...twitchList];
                    const url = `https://multistre.am/${parts.join('/')}/`;
                    const btn = document.createElement('button');
                    btn.className = 'btn btn-sm btn-primary multistream-btn';
                    btn.textContent = 'Voir';
                    btn.addEventListener('click', () => {
                        window.open(url, '_blank', 'noopener');
                    });
                    mEl.appendChild(btn);
                }
            }
        }
    });
}

/**
 * Chargement des deux CSV puis application.
 */
function loadAndApply() {
    Promise.all([
        fetch(CSV_URL).then(r => {
            if (!r.ok) throw new Error('Erreur chargement CSV principal');
            return r.text();
        }),
        fetch(CORRESP_CSV_URL).then(r => {
            if (!r.ok) throw new Error('Erreur chargement CSV correspondances');
            return r.text();
        })
    ]).then(([mainCsv, corCsv]) => {
        const mainRows = parseCSV(mainCsv);
        const corRows = parseCSV(corCsv);
        const correspMap = buildCorrespMap(corRows);
        applyPlanning(mainRows, correspMap);
    }).catch(err => {
        console.error("Erreur chargement planning :", err);
        jours.forEach(j => {
            const ids = [
                `h_${j}`, `c_${j}`,
                `f_${j}`, `i_${j}`, `m_${j}`
            ];
            ids.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.textContent = '/';
            });
        });
    });
}

document.addEventListener('DOMContentLoaded', loadAndApply);

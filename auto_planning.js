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

// Lignes (1-based ; la ligne 1 est l'en-tête du CSV) de chaque planning dans le CSV principal.
// Si vous modifiez la structure du Google Sheet, ajustez ces bornes.
const PRELIVE_ROW_START = 2;  // lignes 2-6 : planning des prélives (optionnel)
const PRELIVE_ROW_END   = 6;
const REAL_ROW_START    = 7;  // lignes 7-11 : planning principal
const REAL_ROW_END      = 11;

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
 * Extrait un bloc de lignes du CSV principal.
 * startRow / endRow sont 1-based (la ligne 1 est l'en-tête) et inclusifs.
 */
function extractBlock(mainRows, startRow, endRow) {
    if (!mainRows || mainRows.length === 0) return [];
    const start = startRow - 1;
    const end = endRow - 1;
    if (start < 0 || start >= mainRows.length) return [];
    return mainRows.slice(start, end + 1);
}

/**
 * Un bloc est-il entièrement vide (cellules de données uniquement) ?
 */
function isBlockEmpty(block) {
    if (!block) return true;
    for (let i = 0; i < block.length; i++) {
        for (let c = 1; c < block[i].length; c++) {
            if ((block[i][c] || '').trim()) return false;
        }
    }
    return true;
}

/**
 * Applique les données d'un bloc (un planning) au tableau concerné.
 */
function applyPlanning(block, correspMap, prefix, optional) {
    const indexByKey = {};
    for (let i = 0; i < block.length; i++) {
        const first = (block[i][0] || '').trim().toLowerCase();
        if (first) indexByKey[first] = i;
    }

    function cellValue(rowIndex, colIndex) {
        if (rowIndex == null || rowIndex < 0 || rowIndex >= block.length) return '';
        const row = block[rowIndex];
        return (row[colIndex] || '').trim();
    }

    const horaireRow = indexByKey['horaire'] !== undefined ? indexByKey['horaire'] : null;
    const categorieRow = indexByKey['catégorie'] !== undefined ? indexByKey['catégorie'] : (indexByKey['categorie'] !== undefined ? indexByKey['categorie'] : null);
    const ftRow = indexByKey['ft'] !== undefined ? indexByKey['ft'] : null;
    const ftNoLiveRow = indexByKey['ft-no-live'] !== undefined ? indexByKey['ft-no-live'] : (indexByKey['ft no live'] !== undefined ? indexByKey['ft no live'] : null);
    const imageRow = indexByKey['image'] !== undefined ? indexByKey['image'] : null;

    // Cellule vide : '/' pour le planning principal, '—' discret pour le planning optionnel.
    const emptyText = optional ? '—' : '/';

    function setEmpty(el) {
        if (!el) return;
        if (optional) {
            el.innerHTML = '';
            const span = document.createElement('span');
            span.className = 'empty-cell';
            span.textContent = emptyText;
            el.appendChild(span);
        } else {
            el.textContent = emptyText;
        }
    }

    function setCell(el, value) {
        if (!el) return;
        if (value) {
            el.textContent = value;
        } else {
            setEmpty(el);
        }
    }

    jours.forEach((jour, idx) => {
        const col = idx + 1;
        // Horaire / Catégorie
        const id = letter => `${prefix}${letter}_${jour}`;
        const hEl = document.getElementById(id('h'));
        const cEl = document.getElementById(id('c'));
        setCell(hEl, horaireRow !== null ? cellValue(horaireRow, col) : '');
        setCell(cEl, categorieRow !== null ? cellValue(categorieRow, col) : '');

        // Feat
        const fCell = document.getElementById(id('f'));
        if (fCell) {
            fCell.innerHTML = '';
            const raw = ftRow !== null ? cellValue(ftRow, col) : '';
            const rawNoLive = ftNoLiveRow !== null ? cellValue(ftNoLiveRow, col) : '';

            const names = raw ? raw.split(',').map(s => s.trim()).filter(Boolean) : [];
            const namesNoLive = rawNoLive ? rawNoLive.split(',').map(s => s.trim()).filter(Boolean) : [];

            // afficher ft (avec icones si correspondance)
            if (names.length === 0 && namesNoLive.length === 0) {
                setEmpty(fCell);
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
        const iEl = document.getElementById(id('i'));
        if (iEl) {
            iEl.innerHTML = '';
            const rawImg = imageRow !== null ? cellValue(imageRow, col) : '';
            if (!rawImg) {
                setEmpty(iEl);
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
        const mEl = document.getElementById(id('m'));
        if (mEl) {
            mEl.innerHTML = '';
            const raw = ftRow !== null ? cellValue(ftRow, col) : '';
            if (!raw) {
                setEmpty(mEl);
            } else {
                const names = raw.split(',').map(s => s.trim()).filter(Boolean);
                const twitchList = [];
                names.forEach(n => {
                    const cor = findCorresp(correspMap, n);
                    if (cor && cor.twitch) twitchList.push(cor.twitch);
                });
                if (twitchList.length === 0) {
                    setEmpty(mEl);
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
        const preliveBlock = extractBlock(mainRows, PRELIVE_ROW_START, PRELIVE_ROW_END);
        const realBlock = extractBlock(mainRows, REAL_ROW_START, REAL_ROW_END);

        // Prélives : si le bloc 2-6 est entièrement vide, on masque le groupe (hint + lignes) dans le tableau.
        if (isBlockEmpty(preliveBlock)) {
            document.querySelectorAll('[data-group="prelive"]').forEach(el => { el.style.display = 'none'; });
            const hdr = document.getElementById('prelive-group-header');
            if (hdr) hdr.style.display = 'none';
            const hint = document.getElementById('prelive-hint');
            if (hint) hint.style.display = 'none';
        } else {
            applyPlanning(preliveBlock, correspMap, 'p', true);
        }

        // Planning principal : lignes 7-11.
        applyPlanning(realBlock, correspMap, '', false);
    }).catch(err => {
        console.error("Erreur chargement planning :", err);
        jours.forEach(j => {
            const ids = [
                `h_${j}`, `c_${j}`, `ph_${j}`, `pc_${j}`,
                `f_${j}`, `i_${j}`, `m_${j}`, `pf_${j}`, `pi_${j}`, `pm_${j}`
            ];
            ids.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.textContent = '/';
            });
        });
    });
}

document.addEventListener('DOMContentLoaded', loadAndApply);

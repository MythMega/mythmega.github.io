// credits.js - Page de crédits
const Credits = (function () {
    const CREDITS_URL = 'data/credits.json';
    let creditsData = null;
    let currentLang = 'fr';

    // --- Cookie helpers ---
    function getCookie(name) {
        var v = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
        return v ? decodeURIComponent(v.pop()) : null;
    }

    // --- Load credits data ---
    async function loadCreditsData() {
        try {
            var res = await fetch(CREDITS_URL);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            creditsData = await res.json();
            console.log('[Credits] Loaded', creditsData.Credits.length, 'credits');
        } catch (e) {
            console.error('[Credits] Error loading credits:', e);
            creditsData = null;
        }
    }

    // --- Get current language ---
    function getCurrentLang() {
        if (typeof Translator !== 'undefined' && Translator.getLanguage) {
            return Translator.getLanguage();
        }
        return document.documentElement.lang || 'fr';
    }

    // --- Get translated type name ---
    function getTypeName(typeKey) {
        var lang = getCurrentLang();
        var translations = creditsData && creditsData.TranslationsFR && creditsData.TranslationsEN ? creditsData : null;
        if (!translations) return typeKey;

        if (lang === 'en' && translations.TranslationsEN['Type.' + typeKey]) {
            return translations.TranslationsEN['Type.' + typeKey];
        }
        if (translations.TranslationsFR['Type.' + typeKey]) {
            return translations.TranslationsFR['Type.' + typeKey];
        }
        return typeKey;
    }

    // --- Get all unique types ---
    function getAllTypes() {
        if (!creditsData || !creditsData.Credits) return [];
        var types = new Set();
        creditsData.Credits.forEach(function(credit) {
            if (credit.Types) {
                credit.Types.forEach(function(type) {
                    types.add(type);
                });
            }
        });
        return Array.from(types).sort();
    }

    // --- Get credits by type ---
    function getCreditsByType(type) {
        if (!creditsData || !creditsData.Credits) return [];
        return creditsData.Credits.filter(function(credit) {
            return credit.Types && credit.Types.indexOf(type) !== -1;
        });
    }

    // --- Render tabs ---
    function renderTabs() {
        var tabsContainer = document.getElementById('creditsTabs');
        if (!tabsContainer) return;

        var types = getAllTypes();
        tabsContainer.innerHTML = '';

        // "All" tab
        var allBtn = document.createElement('button');
        allBtn.className = 'credits-tab-btn active';
        allBtn.textContent = 'Tous';
        allBtn.addEventListener('click', function() {
            document.querySelectorAll('.credits-tab-btn').forEach(function(b) { b.classList.remove('active'); });
            allBtn.classList.add('active');
            renderCreditsGrid(null);
        });
        tabsContainer.appendChild(allBtn);

        // Type tabs
        types.forEach(function(type) {
            var btn = document.createElement('button');
            btn.className = 'credits-tab-btn';
            btn.textContent = getTypeName(type);
            btn.addEventListener('click', function() {
                document.querySelectorAll('.credits-tab-btn').forEach(function(b) { b.classList.remove('active'); });
                btn.classList.add('active');
                renderCreditsGrid(type);
            });
            tabsContainer.appendChild(btn);
        });
    }

    // --- Render credits grid ---
    function renderCreditsGrid(filterType) {
        var content = document.getElementById('creditsContent');
        if (!content) return;

        var credits = filterType ? getCreditsByType(filterType) : creditsData.Credits;
        var lang = getCurrentLang();

        if (credits.length === 0) {
            content.innerHTML = '<div class="no-credits">Aucun crédit à afficher</div>';
            return;
        }

        var grid = document.createElement('div');
        grid.className = 'credits-grid';

        credits.forEach(function(credit) {
            var card = document.createElement('div');
            card.className = 'credit-card';

            // Avatar
            var avatar = document.createElement('img');
            avatar.className = 'credit-avatar';
            avatar.src = credit.Image || './icon.png';
            avatar.alt = credit.Person;
            avatar.onerror = function() { this.src = './icon.png'; };
            card.appendChild(avatar);

            // Info
            var info = document.createElement('div');
            info.className = 'credit-info';

            // Name
            var name = document.createElement('div');
            name.className = 'credit-name';
            name.textContent = credit.Person;
            info.appendChild(name);

            // Types as badges
            if (credit.Types && credit.Types.length > 0) {
                var typesDiv = document.createElement('div');
                typesDiv.style.cssText = 'display:flex; gap:4px; flex-wrap:wrap; margin-bottom:6px;';
                credit.Types.forEach(function(type) {
                    var badge = document.createElement('span');
                    badge.className = 'credit-type-badge';
                    badge.textContent = getTypeName(type);
                    typesDiv.appendChild(badge);
                });
                info.appendChild(typesDiv);
            }

            // Function
            if (credit['Function' + lang.toUpperCase()]) {
                var func = document.createElement('div');
                func.className = 'credit-function';
                func.textContent = credit['Function' + lang.toUpperCase()];
                info.appendChild(func);
            }

            // Buttons
            if (credit.Buttons && credit.Buttons.length > 0) {
                var buttonsDiv = document.createElement('div');
                buttonsDiv.className = 'credit-buttons';
                credit.Buttons.forEach(function(btn) {
                    var link = document.createElement('a');
                    link.className = 'credit-btn';
                    link.href = btn.Url;
                    link.textContent = btn.Text;
                    link.target = '_blank';
                    link.rel = 'noopener noreferrer';
                    buttonsDiv.appendChild(link);
                });
                info.appendChild(buttonsDiv);
            }

            card.appendChild(info);
            grid.appendChild(card);
        });

        content.innerHTML = '';
        content.appendChild(grid);
    }

    // --- Main init ---
    async function init() {
        await loadCreditsData();
        if (!creditsData) {
            document.getElementById('creditsContent').innerHTML = '<div class="no-credits">Impossible de charger les crédits</div>';
            return;
        }
        renderTabs();
        renderCreditsGrid(null);
    }

    // --- Public API ---
    return {
        init: init
    };
})();

// Auto-init on DOM ready
document.addEventListener('DOMContentLoaded', function() {
    Credits.init();
});
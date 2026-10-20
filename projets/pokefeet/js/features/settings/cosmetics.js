// cosmetics.js - Gestion des cosmétiques (backgrounds, boutons personnalisés)
const Cosmetics = (function () {
    const COOKIE_BG = 'pk_cosmetic_bg';
    const COOKIE_BTN = 'pk_cosmetic_btn';
    const COSMETICS_URL = 'data/cosmetics.json';
    const CHALLENGES_URL = 'data/bonus_challenges.json';

    let cosmeticsData = [];
    let unlockedIds = new Set();

    // --- Cookie helpers ---
    function setCookie(name, value, days) {
        var d = new Date();
        d.setTime(d.getTime() + (days || 365) * 24 * 60 * 60 * 1000);
        document.cookie = name + '=' + encodeURIComponent(value) + ';expires=' + d.toUTCString() + ';path=/';
    }

    function getCookie(name) {
        var v = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
        return v ? decodeURIComponent(v.pop()) : null;
    }

  // --- Load cosmetics data ---
  async function loadCosmeticsData() {
    try {
      console.log('[Cosmetics] Loading from:', COSMETICS_URL);
      var res = await fetch(COSMETICS_URL);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      cosmeticsData = await res.json();
      console.log('[Cosmetics] Loaded', cosmeticsData.length, 'cosmetics');
    } catch (e) {
      console.error('[Cosmetics] Error loading cosmetics:', e);
      cosmeticsData = [];
    }
  }

    // --- Load unlocked cosmetics from completed challenges ---
    async function loadUnlockedCosmetics() {
        unlockedIds = new Set();
        try {
            if (typeof ChallengeStorage === 'undefined' || !ChallengeStorage.getAllCompletions) {
                return;
            }
            var completions = await ChallengeStorage.getAllCompletions();
            var res = await fetch(CHALLENGES_URL);
            var allChallenges = await res.json();

            for (var challengeId in completions) {
                var challenge = allChallenges.find(function (c) { return c.ID == challengeId; });
                if (challenge && challenge.Rewards) {
                    for (var r = 0; r < challenge.Rewards.length; r++) {
                        var reward = challenge.Rewards[r];
                        if (reward.TypeReward === 'Cosmetic') {
                            unlockedIds.add(Number(reward.Value));
                        }
                    }
                }
            }
        } catch (e) {
            console.error('[Cosmetics] Error loading unlocked:', e);
        }
    }

    // --- Check if a cosmetic is unlocked ---
    function isUnlocked(cosmetic) {
        if (!cosmetic.RequiresUnlock) return true;
        return unlockedIds.has(cosmetic.ID);
    }

    // --- Get selected cosmetics ---
    function getSelectedBg() {
        var val = getCookie(COOKIE_BG);
        if (!val || val === 'null' || val === 'default') return null;
        return val;
    }

    function getSelectedBtn() {
        var val = getCookie(COOKIE_BTN);
        if (!val || val === 'null' || val === 'default') return null;
        return val;
    }

    // --- Apply the selected button theme to one element ---
    function applyButtonTheme(button, btnVal) {
        for (var l = 0; l < cosmeticsData.length; l++) {
            var c = cosmeticsData[l];
            if (c.Type === 'Background-Buttons') {
                button.classList.remove(c.Value);
            }
        }
        if (!btnVal) return;
        for (var m = 0; m < cosmeticsData.length; m++) {
            var selected = cosmeticsData[m];
            if (selected.Type === 'Background-Buttons' && selected.Value === btnVal) {
                button.classList.add(selected.Value);
                break;
            }
        }
    }

    function applyButtonThemes() {
        var buttons = document.querySelectorAll('[data-tag="customizables-button"]');
        var btnVal = getSelectedBtn();
        for (var i = 0; i < buttons.length; i++) {
            applyButtonTheme(buttons[i], btnVal);
        }
    }

    // Les listes de challenges sont rendues après le chargement des cosmétiques :
    // on applique le thème aux boutons ajoutés dynamiquement.
    var buttonObserver = null;
    var observerScheduled = false;
    function watchDynamicButtons() {
        if (buttonObserver || typeof MutationObserver === 'undefined') return;
        buttonObserver = new MutationObserver(function (mutations) {
            if (!getSelectedBtn()) return;
            var found = false;
            for (var i = 0; i < mutations.length && !found; i++) {
                var added = mutations[i].addedNodes;
                for (var j = 0; j < added.length; j++) {
                    var node = added[j];
                    if (node.nodeType !== 1) continue;
                    if ((node.matches && node.matches('[data-tag="customizables-button"]')) ||
                        (node.querySelector && node.querySelector('[data-tag="customizables-button"]'))) {
                        found = true;
                        break;
                    }
                }
            }
            if (!found || observerScheduled) return;
            observerScheduled = true;
            requestAnimationFrame(function () {
                observerScheduled = false;
                applyButtonThemes();
            });
        });
        buttonObserver.observe(document.documentElement, { childList: true, subtree: true });
    }

    // --- Apply cosmetics to the page ---
    function applyCosmetics() {
        var body = document.body;

        // Remove all cosmetic classes from body
        for (var i = 0; i < cosmeticsData.length; i++) {
            var c = cosmeticsData[i];
            if (c.Type === 'Background') {
                body.classList.remove(c.Value);
            }
        }

        // Apply selected background
        var bgVal = getSelectedBg();
        if (bgVal) {
            for (var j = 0; j < cosmeticsData.length; j++) {
                var c2 = cosmeticsData[j];
                if (c2.Type === 'Background' && c2.Value === bgVal) {
                    body.classList.add(c2.Value);
                    break;
                }
            }
        }

        applyButtonThemes();
    }

  // --- Select a cosmetic (called from UI) ---
  function selectCosmetic(type, value) {
    var cookieName = type === 'Background' ? COOKIE_BG : COOKIE_BTN;
    if (!value || value === 'default') {
      setCookie(cookieName, 'null');
    } else {
      setCookie(cookieName, value);
    }
    applyCosmetics();
    // Re-render UI if available
    if (typeof window.renderCosmetics === 'function') {
      window.renderCosmetics();
    }
  }

  // --- Render cosmetics UI (called from settings page) ---
  function renderCosmeticsUI() {
    var bgGrid = document.getElementById('cosmeticsBgGrid');
    var btnGrid = document.getElementById('cosmeticsBtnGrid');
    if (!bgGrid || !btnGrid) return;

    var all = cosmeticsData;
    var selectedBg = getSelectedBg();
    var selectedBtn = getSelectedBtn();

    function createCosmeticBtn(cosmetic, isSelected) {
      var div = document.createElement('div');
      div.className = 'cosmetic-btn';
      if (isSelected) div.classList.add('active');

      var unlocked = isUnlocked(cosmetic);
      if (!unlocked) div.classList.add('locked');

      var img = document.createElement('img');
      img.src = 'img/cosmetics/' + (cosmetic.File || 'default.png');
      img.alt = cosmetic.Name;
      img.onerror = function() { this.src = './icon.png'; };
      div.appendChild(img);

      var nameSpan = document.createElement('span');
      nameSpan.className = 'cosmetic-name';
      nameSpan.textContent = cosmetic.Name;
      div.appendChild(nameSpan);

      if (!unlocked) {
        var lock = document.createElement('span');
        lock.className = 'cosmetic-lock';
        lock.textContent = '🔒';
        div.appendChild(lock);
      } else if (isSelected) {
        var check = document.createElement('span');
        check.className = 'cosmetic-check';
        check.textContent = '✓';
        div.appendChild(check);
      }

      if (!unlocked) {
        div.title = Translator.get('cosmetics.lockedHint', '🔒 {name} — À débloquer via un challenge').replace('{name}', cosmetic.Name);
      } else {
        div.title = cosmetic.Name;
      }

      if (unlocked) {
        div.addEventListener('click', function() {
          var type = cosmetic.Type;
          var value = isSelected ? 'default' : cosmetic.Value;
          selectCosmetic(type, value);
        });
      }

      return div;
    }

    bgGrid.innerHTML = '';
    btnGrid.innerHTML = '';

    // Default option for Background
    var defaultBg = document.createElement('div');
    defaultBg.className = 'cosmetic-btn' + (!selectedBg ? ' active' : '');
    defaultBg.title = Translator.get('cosmetics.default', 'Par défaut');
    var defaultBgImg = document.createElement('img');
    defaultBgImg.src = './icon.png';
    defaultBgImg.alt = Translator.get('cosmetics.defaultShort', 'Défaut');
    defaultBg.appendChild(defaultBgImg);
    var defaultBgName = document.createElement('span');
    defaultBgName.className = 'cosmetic-name';
    defaultBgName.textContent = Translator.get('cosmetics.defaultShort', 'Défaut');
    defaultBg.appendChild(defaultBgName);
    if (!selectedBg) {
      var check = document.createElement('span');
      check.className = 'cosmetic-check';
      check.textContent = '✓';
      defaultBg.appendChild(check);
    }
    defaultBg.addEventListener('click', function() {
      selectCosmetic('Background', 'default');
    });
    bgGrid.appendChild(defaultBg);

    // Default option for Buttons
    var defaultBtn = document.createElement('div');
    defaultBtn.className = 'cosmetic-btn' + (!selectedBtn ? ' active' : '');
    defaultBtn.title = Translator.get('cosmetics.default', 'Par défaut');
    var defaultBtnImg = document.createElement('img');
    defaultBtnImg.src = './icon.png';
    defaultBtnImg.alt = Translator.get('cosmetics.defaultShort', 'Défaut');
    defaultBtn.appendChild(defaultBtnImg);
    var defaultBtnName = document.createElement('span');
    defaultBtnName.className = 'cosmetic-name';
    defaultBtnName.textContent = Translator.get('cosmetics.defaultShort', 'Défaut');
    defaultBtn.appendChild(defaultBtnName);
    if (!selectedBtn) {
      var check2 = document.createElement('span');
      check2.className = 'cosmetic-check';
      check2.textContent = '✓';
      defaultBtn.appendChild(check2);
    }
    defaultBtn.addEventListener('click', function() {
      selectCosmetic('Background-Buttons', 'default');
    });
    btnGrid.appendChild(defaultBtn);

    // Cosmetics items
    for (var i = 0; i < all.length; i++) {
      var c = all[i];
      if (c.Type === 'Background') {
        bgGrid.appendChild(createCosmeticBtn(c, selectedBg === c.Value));
      } else if (c.Type === 'Background-Buttons') {
        btnGrid.appendChild(createCosmeticBtn(c, selectedBtn === c.Value));
      }
    }
  }

    // --- Main load function ---
    async function load() {
        await loadCosmeticsData();
        await loadUnlockedCosmetics();
        applyCosmetics();
        watchDynamicButtons();
    }

    // --- Get cosmetics by type ---
    function getByType(type) {
        return cosmeticsData.filter(function (c) { return c.Type === type; });
    }

    // --- Get all cosmetics ---
    function getAll() {
        return cosmeticsData;
    }

    // --- Get unlocked IDs ---
    function getUnlockedIds() {
        return unlockedIds;
    }

    return {
        load: load,
        apply: applyCosmetics,
        select: selectCosmetic,
        getByType: getByType,
        getAll: getAll,
        isUnlocked: isUnlocked,
        getSelectedBg: getSelectedBg,
        getSelectedBtn: getSelectedBtn,
        getUnlockedIds: getUnlockedIds
    };
})();
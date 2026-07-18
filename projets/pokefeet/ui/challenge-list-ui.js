// ui/challenge-list-ui.js - Interface de liste des challenges
const ChallengeListUI = (function () {
    let challenges = [];
    let completions = {};

    async function init() {
        await ChallengeManager.loadChallenges();
        await ChallengeManager.loadPokemons();
        completions = await ChallengeStorage.getAllCompletions();
        challenges = ChallengeManager.getAllChallenges();
        
        await renderChallenges();
        bindEvents();
    }

    async function renderChallenges() {
        renderTabs();
        await renderChallengeCards();
    }

    let currentTab = null;

    function getUniqueTabs() {
        var tabs = new Set();
        challenges.forEach(function(c) {
            if (c.Tab) {
                tabs.add(c.Tab);
            } else {
                tabs.add('Challenge');
            }
        });
        var arr = Array.from(tabs);
        if (arr.length > 0 && !currentTab) currentTab = arr[0];
        return arr;
    }

    function renderTabs() {
        var tabsContainer = document.getElementById('challengeTabs');
        if (!tabsContainer) return;

        var tabs = getUniqueTabs();
        tabsContainer.innerHTML = '';

        tabs.forEach(function(tab) {
            var btn = document.createElement('button');
            btn.className = 'challenge-tab-btn' + (tab === currentTab ? ' active' : '');
            btn.textContent = tab;
            btn.addEventListener('click', function() {
                currentTab = tab;
                renderTabs();
                renderChallengeCards();
            });
            tabsContainer.appendChild(btn);
        });
    }

    async function renderChallengeCards() {
        const container = document.getElementById('challengesList');
        if (!container) return;

        container.innerHTML = '';

        const T = (k, f) => (typeof Translator !== 'undefined' ? Translator.get(k, f) : f);
        const lang = (typeof Translator !== 'undefined') ? Translator.getLanguage() : 'fr';

        // Load cosmetics data for reward display
        let cosmeticsData = [];
        try {
            var cosRes = await fetch('data/cosmetics.json');
            cosmeticsData = await cosRes.json();
        } catch (e) {
            console.error('[ChallengeListUI] Error loading cosmetics:', e);
        }

        var filteredChallenges = challenges.filter(function(c) {
            var tab = c.Tab || 'Challenge';
            return tab === currentTab;
        });

        for (const challenge of filteredChallenges) {
            const isCompleted = !!completions[challenge.ID];
            const canPlay = await ChallengeManager.canPlayChallenge(challenge);
            const isAvailable = challenge.isAvailableToday();

            const card = document.createElement('div');
            card.className = 'challenge-card' + (isCompleted ? ' completed' : '') + (!canPlay || !isAvailable ? ' locked' : '');
            
            const difficultyColor = challenge.getDifficultyColor();
            const difficultyText = challenge.getDifficultyTranslation();
            const challengeName = challenge.getName(lang);
            const challengeDesc = challenge.getDescription(lang);
            
            // Générer les requirements
            let requirementsHTML = '';
            if (challenge.Requirements && challenge.Requirements.length > 0) {
                requirementsHTML = '<div class="challenge-requirements">';
                for (const req of challenge.Requirements) {
                    const reqResult = await challenge.checkRequirement(req);
                    const reqColor = reqResult.met ? '#4ade80' : '#ef4444';
                    requirementsHTML += `<div class="requirement-item" style="color:${reqColor}">${reqResult.text}</div>`;
                }
                requirementsHTML += '</div>';
            }
            
            // Générer les dates
            let datesHTML = '';
            if (challenge.Availabilities && challenge.Availabilities.length > 0) {
                datesHTML = '<div class="challenge-dates">';
                for (const avail of challenge.Availabilities) {
                    datesHTML += `<span class="date-badge">${avail.Start} → ${avail.End}</span>`;
                }
                datesHTML += '</div>';
            }
            
            // Générer les rewards
            let rewardsHTML = '';
            if (challenge.Rewards && challenge.Rewards.length > 0) {
                rewardsHTML = '<div class="challenge-rewards">';
                for (const reward of challenge.Rewards) {
                    if (reward.TypeReward === 'Experience') {
                        rewardsHTML += `<span class="reward-badge xp">+${reward.Value} XP</span>`;
                    } else if (reward.TypeReward === 'Cosmetic') {
                        var cos = cosmeticsData.find(function(c) { return c.ID === Number(reward.Value); });
                        if (cos) {
                            var cosType = (cos.Type === 'Background-Buttons') 
                                ? T('challenges.cosmeticTypeBtn', 'Bouton') 
                                : T('challenges.cosmeticTypeBg', 'Background');
                            rewardsHTML += '<span class="reward-badge cosmetic">' + cosType + ' : ' + cos.Name + '</span>';
                        } else {
                            rewardsHTML += '<span class="reward-badge cosmetic">Cosmétique #' + reward.Value + '</span>';
                        }
                    }
                }
                rewardsHTML += '</div>';
            }
            
            const nameHTML = isCompleted ? `<span style="color:#4ade80;margin-right:6px;">✓</span>${challengeName}` : challengeName;

            card.innerHTML = `
                <div class="challenge-header">
                    <h3>${nameHTML}</h3>
                    <span class="challenge-difficulty" style="background:${difficultyColor}">${difficultyText}</span>
                </div>
                <p class="challenge-desc">${challengeDesc}</p>
                <div class="challenge-meta">
                    <span class="challenge-count">${challenge.FeetList.length} Pokémon</span>
                    ${datesHTML}
                    ${rewardsHTML}
                </div>
                ${requirementsHTML}
                <div class="challenge-actions">
                    <button class="btn-view" data-challenge-id="${challenge.ID}" ${(!canPlay || !isAvailable) ? 'disabled' : ''}>
                        ${isCompleted ? T('challenge.replay', 'Re-jouer') : T('challenge.play', 'Jouer')}
                    </button>
                </div>
            `;

            container.appendChild(card);
        }

        // Clic sur les boutons Jouer/Voir
        document.querySelectorAll('.btn-view').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const challengeId = parseInt(btn.dataset.challengeId);
                const challenge = challenges.find(c => c.ID == challengeId);
                const isCompleted = !!completions[challengeId];
                
                if (challenge) {
                    if (isCompleted) {
                        // Voir le challenge complété
                        window.location.href = `challenge.html?challengeid=${challengeId}&statut=view`;
                    } else {
                        // Jouer au challenge
                        window.location.href = `challenge.html?challengeid=${challengeId}&statut=playing`;
                    }
                }
            });
        });
    }

    async function showRequirementsTooltip(challengeId, button) {
        const challenge = challenges.find(c => c.ID == challengeId);
        if (!challenge) return;

        const T = (k, f) => (typeof Translator !== 'undefined' ? Translator.get(k, f) : f);

        let tooltip = document.createElement('div');
        tooltip.className = 'requirements-tooltip';
        
        let html = '<div class="requirements-list">';
        for (const req of challenge.Requirements) {
            const result = await challenge.checkRequirement(req);
            const color = result.met ? '#4ade80' : '#ef4444';
            const status = result.met ? '✓' : '✗';
            
            html += `<div style="color:${color}">${status} ${result.text}</div>`;
        }
        html += '</div>';

        tooltip.innerHTML = html;
        tooltip.style.cssText = `
            position: absolute;
            background: var(--card);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 8px;
            padding: 12px;
            z-index: 1000;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        `;

        const rect = button.getBoundingClientRect();
        tooltip.style.top = (rect.bottom + window.scrollY + 8) + 'px';
        tooltip.style.left = (rect.left + window.scrollX) + 'px';

        document.body.appendChild(tooltip);

        // Fermer au clic extérieur
        setTimeout(() => {
            document.addEventListener('click', function close(e) {
                if (!tooltip.contains(e.target)) {
                    tooltip.remove();
                    document.removeEventListener('click', close);
                }
            });
        }, 10);
    }

    function bindEvents() {
        // Events si nécessaire
    }

    return { init };
})();

// Auto-init
document.addEventListener('DOMContentLoaded', ChallengeListUI.init);
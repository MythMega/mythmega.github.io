class CodeUI {
    constructor() {
        this.codeInput = document.getElementById('codeInput');
        this.codeStatus = document.getElementById('codeStatus');
        this.redeemButton = document.getElementById('redeemButton');
        this.rewardsModal = document.getElementById('rewardsModal');
        this.rewardsContent = document.getElementById('rewardsContent');
        this.closeButton = document.querySelector('.close-rewards');
        this.pokemonData = {}; // Cache for pokemon data

        this.setupEventListeners();
        this.updateLabels();
        this.loadPokemonData();
    }

    /**
     * Load Pokémon data from data.json for name lookups
     */
    async loadPokemonData() {
        try {
            const response = await fetch('./data.json');
            const data = await response.json();
            // Flatten family structure to get individual Pokémon
            data.forEach(family => {
                if (family.Pokemon) {
                    family.Pokemon.forEach(poke => {
                        this.pokemonData[poke.Index] = {
                            name_en: poke.Name_EN,
                            name_fr: poke.Name_FR,
                            sprite: poke.Sprite
                        };
                    });
                }
            });
        } catch (error) {
            console.error('Error loading Pokémon data:', error);
        }
    }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        if (this.redeemButton) {
            this.redeemButton.addEventListener('click', () => this.handleRedeem());
        }

        if (this.codeInput) {
            this.codeInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.handleRedeem();
                }
            });
        }

        if (this.closeButton) {
            this.closeButton.addEventListener('click', () => this.closeRewardsModal());
        }

        // Close button in modal
        const closeModalButton = document.querySelector('.close-modal-button');
        if (closeModalButton) {
            closeModalButton.addEventListener('click', () => this.closeRewardsModal());
        }

        // Close modal when clicking outside
        if (this.rewardsModal) {
            this.rewardsModal.addEventListener('click', (e) => {
                if (e.target === this.rewardsModal) {
                    this.closeRewardsModal();
                }
            });
        }

        // Listen for language changes
        document.addEventListener('languageChanged', () => this.updateLabels());
    }

    /**
     * Update UI labels based on current language
     */
    updateLabels() {
        const lang = window.currentLanguage || 'en';
        
        // Fallback translations if i18n not available
        const translations = {
            en: {
                enterCode: 'Enter a code',
                redeem: 'Redeem',
                pokemon: 'Pokémon',
                money: 'Money',
                items: 'Items',
                rewards: 'Rewards',
                close: 'Close'
            },
            fr: {
                enterCode: 'Entrez un code',
                redeem: 'Utiliser',
                pokemon: 'Pokémon',
                money: 'Pokédollars',
                items: 'Objets',
                rewards: 'Récompenses',
                close: 'Fermer'
            }
        };

        const currentLabels = translations[lang] || translations['en'];

        const label = document.querySelector('label[for="codeInput"]');
        if (label) {
            label.textContent = currentLabels.enterCode;
        }

        if (this.redeemButton) {
            this.redeemButton.textContent = currentLabels.redeem;
        }

        const rewardsTitle = document.getElementById('rewardsTitle');
        if (rewardsTitle) {
            rewardsTitle.textContent = currentLabels.rewards;
        }

        const closeButton = document.querySelector('.close-modal-button');
        if (closeButton) {
            closeButton.textContent = currentLabels.close;
        }
    }

    /**
     * Handle code redemption
     */
    async handleRedeem() {
        const codeValue = this.codeInput.value.trim();

        if (!codeValue) {
            const i18n = window.i18n || ((key) => key);
            this.showStatus(i18n('enter_code'), 'error');
            return;
        }

        // Disable button during processing
        this.redeemButton.disabled = true;

        try {
            const result = await codeManager.redeemCode(codeValue);

            // Show status message
            this.showStatus(result.message, result.success ? 'success' : 'error');

            if (result.success) {
                this.codeInput.value = '';
                // Show rewards modal after a short delay
                setTimeout(() => this.showRewardsModal(result.rewards), 500);
            }
        } catch (error) {
            console.error('Error redeeming code:', error);
            this.showStatus('An error occurred', 'error');
        } finally {
            this.redeemButton.disabled = false;
        }
    }

    /**
     * Show status message
     */
    showStatus(message, type) {
        if (!this.codeStatus) return;

        this.codeStatus.textContent = message;
        this.codeStatus.className = `code-status ${type}`;
        this.codeStatus.style.display = 'block';
    }

    /**
     * Show rewards modal
     */
    showRewardsModal(rewards) {
        if (!this.rewardsContent) return;

        const i18n = window.i18n || ((key) => key);

        // Build rewards HTML
        let html = '<div class="rewards-container">';

        // Pokémon section
        if (rewards.pokes && rewards.pokes.length > 0) {
            html += this.buildRewardSection('pokemon', rewards.pokes, i18n);
        }

        // Money section
        if (rewards.money > 0) {
            html += this.buildMoneySection(rewards.money, i18n);
        }

        // Items section
        if (rewards.items && rewards.items.length > 0) {
            html += this.buildItemsSection(rewards.items, i18n);
        }

        html += '</div>';

        this.rewardsContent.innerHTML = html;
        this.rewardsModal.style.display = 'flex';
    }

    /**
     * Build Pokémon reward section
     */
    buildRewardSection(type, rewards, i18n) {
        const lang = window.currentLanguage || 'en';
        const translations = {
            en: 'Pokémon',
            fr: 'Pokémon'
        };
        const title = translations[lang] || 'Pokémon';

        let html = `<div class="reward-section pokemon-section">
            <h3>${title}</h3>
            <ul class="rewards-list">`;

        rewards.forEach(reward => {
            const pokeName = this.getPokemonName(reward.Index, lang);
            const spriteUrl = this.getPokemonSpriteUrl(reward.Index);

            html += `<li class="reward-item">
                <img src="${spriteUrl}" alt="${pokeName}" class="reward-sprite pokemon-sprite">
                <span class="reward-name">${pokeName}</span>
                <span class="reward-quantity">×${reward.Count}</span>
            </li>`;
        });

        html += '</ul></div>';
        return html;
    }

    /**
     * Build money reward section
     */
    buildMoneySection(amount, i18n) {
        const lang = window.currentLanguage || 'en';
        const translations = {
            en: 'Money',
            fr: 'Pokédollars'
        };
        const title = translations[lang] || 'Money';

        return `<div class="reward-section money-section">
            <h3>${title}</h3>
            <ul class="rewards-list">
                <li class="reward-item">
                    <span class="reward-name">Pokédollars</span>
                    <span class="reward-quantity">×${amount.toLocaleString()}</span>
                </li>
            </ul>
        </div>`;
    }

    /**
     * Build items reward section
     */
    buildItemsSection(items, i18n) {
        const lang = window.currentLanguage || 'en';
        const translations = {
            en: 'Items',
            fr: 'Objets'
        };
        const title = translations[lang] || 'Items';

        let html = `<div class="reward-section items-section">
            <h3>${title}</h3>
            <ul class="rewards-list">`;

        items.forEach(item => {
            const itemImageUrl = this.getItemImageUrl(item.Name);

            html += `<li class="reward-item">
                <img src="${itemImageUrl}" alt="${item.Name}" class="reward-sprite item-sprite">
                <span class="reward-name">${item.Name}</span>
                <span class="reward-quantity">×${item.Count}</span>
            </li>`;
        });

        html += '</ul></div>';
        return html;
    }

    /**
     * Get Pokémon name in the correct language
     */
    getPokemonName(index, lang) {
        const poke = this.pokemonData[index];
        if (poke) {
            return lang === 'fr' ? poke.name_fr : poke.name_en;
        }
        return `Pokémon #${index}`;
    }

    /**
     * Get Pokémon sprite URL based on selected sprite type
     */
    getPokemonSpriteUrl(index) {
        const spriteType = (typeof optionsManager !== 'undefined' && optionsManager.getSpriteVersion) 
            ? optionsManager.getSpriteVersion() 
            : 'home';

        const poke = this.pokemonData[index];
        if (poke && poke.sprite) {
            // Assuming the sprite in data.json is the home sprite
            // and we need to construct other sprite URLs
            const baseName = poke.sprite.split('/').pop().replace('.png', '');
            
            const spriteUrls = {
                home: poke.sprite,
                'bw': `./medias/sprites/bw/${baseName}.png`,
                'bw2': `./medias/sprites/bw2/${baseName}.gif`
            };
            return spriteUrls[spriteType] || spriteUrls.home;
        }

        // Fallback to PokeAPI
        const spriteUrls = {
            home: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${index}.png`,
            'bw': `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/${index}.png`,
            'bw2': `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/animated/${index}.gif`
        };
        return spriteUrls[spriteType] || spriteUrls.home;
    }

    /**
     * Get item image URL
     */
    getItemImageUrl(itemName) {
        // Construct item image path - adjust based on your actual folder structure
        const itemKey = itemName.toLowerCase().replace(/\s+/g, '_');
        return `./medias/item/${itemKey}.png`;
    }

    /**
     * Close rewards modal
     */
    closeRewardsModal() {
        if (this.rewardsModal) {
            this.rewardsModal.style.display = 'none';
        }
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    // Wait a moment for other managers to initialize
    setTimeout(() => {
        window.codeUI = new CodeUI();
    }, 100);
});

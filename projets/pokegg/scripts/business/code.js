class CodeManager {
    constructor() {
        this.codes = [];
        this.isLoaded = false;
    }

    /**
     * Load codes from JSON file
     */
    async loadCodes() {
        if (this.isLoaded) return;

        try {
            const response = await fetch('./codes.json');
            const data = await response.json();
            this.codes = data.map(codeData => new Code(codeData));
            this.isLoaded = true;
        } catch (error) {
            console.error('Error loading codes:', error);
            this.isLoaded = false;
        }
    }

    /**
     * Find a code by its string value
     */
    findCode(codeString) {
        return this.codes.find(code => code.code.toUpperCase() === codeString.toUpperCase());
    }

    /**
     * Validate and redeem a code
     * Returns an object with status and message
     */
    async redeemCode(codeString) {
        // Ensure codes are loaded
        if (!this.isLoaded) {
            await this.loadCodes();
        }

        const code = this.findCode(codeString);

        if (!code) {
            return {
                success: false,
                status: 'invalid',
                message: this.getStatusMessage('invalid')
            };
        }

        if (code.isExpired()) {
            return {
                success: false,
                status: 'expired',
                message: this.getStatusMessage('expired')
            };
        }

        if (code.hasBeenUsed()) {
            return {
                success: false,
                status: 'already_used',
                message: this.getStatusMessage('already_used')
            };
        }

        // Code is valid, apply rewards
        await this.applyRewards(code);
        code.markAsUsed();

        return {
            success: true,
            status: 'success',
            message: this.getStatusMessage('success'),
            rewards: code.getRewards()
        };
    }

    /**
     * Apply rewards to the game state
     */
    async applyRewards(code) {
        try {
            // Add money
            if (code.money > 0) {
                console.log('Adding money:', code.money);
                if (typeof inventoryManager !== 'undefined' && inventoryManager.addBalance) {
                    await inventoryManager.addBalance(code.money);
                } else {
                    console.warn('inventoryManager not available');
                }
            }

            // Add items
            if (code.items.length > 0) {
                console.log('Adding items:', code.items);
                if (typeof inventoryManager !== 'undefined' && inventoryManager.addItem) {
                    for (const item of code.items) {
                        try {
                            inventoryManager.addItem(item.Name, item.Count);
                            console.log('Added item:', item.Name, 'x', item.Count);
                        } catch (error) {
                            console.error('Error adding item:', error);
                        }
                    }
                    // Make sure inventory is saved
                    if (inventoryManager.saveInventory) {
                        await inventoryManager.saveInventory();
                        console.log('Inventory saved');
                    }
                } else {
                    console.warn('inventoryManager.addItem not available');
                }
            }

            // Add Pokémon (mark as caught)
            if (code.pokes.length > 0) {
                console.log('Adding Pokémon:', code.pokes);
                if (typeof gameManager !== 'undefined' && gameManager.caughtPokemon) {
                    // First, load current data to preserve existing pokémon
                    const currentData = await dataLoader.loadAllGameData();
                    const mergedPokemon = currentData.caughtPokemon || {};
                    
                    for (const poke of code.pokes) {
                        const index = String(poke.Index);
                        
                        // Find the actual Pokemon object from families
                        let pokemonObj = null;
                        if (gameManager.families && gameManager.families.length > 0) {
                            for (const family of gameManager.families) {
                                const member = family.members.find(m => String(m.index) === index);
                                if (member) {
                                    pokemonObj = member;
                                    break;
                                }
                            }
                        }
                        
                        // Add or update the pokemon in mergedPokemon
                        if (!mergedPokemon[index]) {
                            mergedPokemon[index] = {
                                pokemon: pokemonObj,
                                count: poke.Count,
                                firstCaught: new Date().toISOString()
                            };
                        } else {
                            mergedPokemon[index].count += poke.Count;
                            mergedPokemon[index].pokemon = pokemonObj || mergedPokemon[index].pokemon;
                        }
                        console.log('Added Pokémon index:', index, 'count:', mergedPokemon[index].count);
                    }
                    
                    // Update gameManager with merged data
                    gameManager.caughtPokemon = mergedPokemon;
                } else {
                    console.warn('gameManager not available');
                }
            }

            // Save after applying all rewards
            if (typeof dataLoader !== 'undefined') {
                try {
                    console.log('Saving all game data...');
                    
                    // Load current data
                    const allData = await dataLoader.loadAllGameData();
                    
                    // Update with new balance
                    if (code.money > 0) {
                        allData.balance = (allData.balance || 0) + code.money;
                        console.log('Updated balance to:', allData.balance);
                    }
                    
                    // Save caught Pokémon
                    if (code.pokes.length > 0 && typeof gameManager !== 'undefined' && gameManager.caughtPokemon) {
                        allData.caughtPokemon = gameManager.caughtPokemon;
                        console.log('Saved caught Pokémon:', allData.caughtPokemon);
                    }
                    
                    // Save both stores
                    await dataLoader.saveData({ 
                        caughtPokemon: allData.caughtPokemon, 
                        lastSaved: new Date().toISOString() 
                    });
                    await dataLoader.saveGameData({ 
                        inventory: allData.inventory, 
                        balance: allData.balance, 
                        language: allData.language 
                    });
                    console.log('✓ Game data saved successfully');
                } catch (error) {
                    console.error('Error saving game data:', error);
                }
            } else {
                console.warn('dataLoader not available for saving');
            }
        } catch (error) {
            console.error('Error applying rewards:', error);
        }
    }

    /**
     * Get localized status message using the translation system
     */
    getStatusMessage(status) {
        const translations = {
            success: 'code_success',
            invalid: 'code_invalid',
            expired: 'code_expired',
            already_used: 'code_already_used'
        };

        const translationKey = translations[status];
        if (typeof window.i18n !== 'undefined' && window.i18n) {
            return window.i18n(translationKey);
        }

        // Fallback to hardcoded translations
        const lang = window.currentLanguage || 'en';
        const fallbackTranslations = {
            en: {
                success: 'Code redeemed successfully!',
                invalid: 'Invalid code',
                expired: 'Code expired',
                already_used: 'Code already used'
            },
            fr: {
                success: 'Code utilisé avec succès !',
                invalid: 'Code invalide',
                expired: 'Code expiré',
                already_used: 'Code déjà utilisé'
            }
        };

        return fallbackTranslations[lang]?.[status] || fallbackTranslations['en'][status];
    }
}

// Initialize on page load
const codeManager = new CodeManager();

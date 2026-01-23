// Interface utilisateur du Pokédex
class PokedexUI {
  constructor() {
    this.searchInput = document.getElementById('searchInput');
    this.showCaughtCheckbox = document.getElementById('showCaughtCheckbox');
    this.showUncaughtCheckbox = document.getElementById('showUncaughtCheckbox');
    this.pokedexGrid = document.getElementById('pokedexGrid');
    this.caughtCount = document.getElementById('caughtCount');
    this.totalCount = document.getElementById('totalCount');
    this.percentageText = document.getElementById('percentageText');
    this.progressFill = document.getElementById('progressFill');
    
    // Modal
    this.modal = document.getElementById('pokemonModal');
    this.modalClose = document.getElementById('modalClose');
    this.modalCloseButton = document.getElementById('modalCloseButton');
    
    this.setupEventListeners();
  }

  setupEventListeners() {
    this.searchInput.addEventListener('input', () => this.applyFilters());
    this.showCaughtCheckbox.addEventListener('change', () => this.handleCheckboxChange());
    this.showUncaughtCheckbox.addEventListener('change', () => this.handleCheckboxChange());
    
    this.modalClose.addEventListener('click', () => this.closeModal());
    this.modalCloseButton.addEventListener('click', () => this.closeModal());
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this.closeModal();
    });

    // Écouter les changements de sprite
    window.addEventListener('spriteVersionChanged', () => {
      this.updateSpriteDisplay();
    });
  }

  updateSpriteDisplay() {
    // Mettre à jour les sprites affichés dans la grille
    const pokemonDivs = this.pokedexGrid.querySelectorAll('.pokemon-entry');
    pokemonDivs.forEach((div, index) => {
      const entry = pokedexManager.filteredPokemon[index];
      if (entry) {
        const sprite = div.querySelector('.pokemon-sprite');
        sprite.src = entry.pokemon.sprite;
      }
    });

    // Mettre à jour aussi la modal si elle est ouverte
    if (this.modal.style.display === 'flex') {
      const modalSprite = document.getElementById('modalSprite');
      if (modalSprite && modalSprite.alt) {
        // Récupérer le pokémon et mettre à jour son sprite
        const pokemonName = modalSprite.alt;
        for (const entry of pokedexManager.filteredPokemon) {
          if (entry.pokemon.name_en === pokemonName) {
            modalSprite.src = entry.pokemon.sprite;
            break;
          }
        }
      }
    }
  }

  async initialize() {
    await this.loadTranslations();
    await gameManager.initializeGame();
    await this.loadGameData();
    
    pokedexManager.initialize(gameManager.families);
    this.renderPokedex();
    this.updateProgress();
  }

  async loadTranslations() {
    const language = optionsManager.getLanguage();
    await optionsManager.loadLanguage(language);
    this.updateTranslations();
  }

  updateTranslations() {
    document.getElementById('progressTitle').textContent = optionsManager.translate('progress');
    this.searchInput.placeholder = optionsManager.translate('search');
    document.getElementById('showCaughtLabel').textContent = optionsManager.translate('show_caught');
    document.getElementById('showUncaughtLabel').textContent = optionsManager.translate('show_uncaught');
    
    // Mettre à jour les étiquettes de modal
    document.getElementById('modalNameLabel').textContent = optionsManager.translate('french_name') + ':';
    document.getElementById('modalNameENLabel').textContent = optionsManager.translate('english_name') + ':';
    document.getElementById('modalType1Label').textContent = optionsManager.translate('type') + ':';
    document.getElementById('modalCaughtLabel').textContent = optionsManager.translate('times_caught') + ':';
    document.getElementById('modalFirstCaughtLabel').textContent = optionsManager.translate('first_caught') + ':';
    document.getElementById('modalCloseButton').textContent = optionsManager.translate('close');
  }

  async loadGameData() {
    const data = await dataLoader.loadData();
    if (data.caughtPokemon) {
      gameManager.caughtPokemon = data.caughtPokemon;
    }
  }

  handleCheckboxChange() {
    const showCaught = this.showCaughtCheckbox.checked;
    const showUncaught = this.showUncaughtCheckbox.checked;
    
    // Si l'une est cochée et on coche l'autre, décoche la première
    if (showCaught && showUncaught) {
      if (event.target === this.showCaughtCheckbox) {
        this.showUncaughtCheckbox.checked = false;
      } else {
        this.showCaughtCheckbox.checked = false;
      }
    }
    
    this.applyFilters();
  }

  applyFilters() {
    const searchQuery = this.searchInput.value;
    const showOnlyCaught = this.showCaughtCheckbox.checked;
    const showOnlyUncaught = this.showUncaughtCheckbox.checked;
    
    pokedexManager.applyFilters(searchQuery, showOnlyCaught, showOnlyUncaught);
    this.renderPokedex();
  }

  renderPokedex() {
    this.pokedexGrid.innerHTML = '';
    
    for (const entry of pokedexManager.filteredPokemon) {
      const pokemon = entry.pokemon;
      const family = entry.family;
      const isCaught = gameManager.isCaught(pokemon.index);
      
      const pokemonDiv = document.createElement('div');
      pokemonDiv.className = `pokemon-entry ${isCaught ? 'caught' : 'uncaught'}`;
      
      pokemonDiv.innerHTML = `
        <img src="${pokemon.sprite}" alt="${pokemon.name_en}" class="pokemon-sprite">
        <p class="pokemon-name">${pokemon.getName(optionsManager.currentLanguage)}</p>
        <p class="pokemon-index">#${pokemon.index}</p>
        <button class="pokemon-info-button">${optionsManager.translate('info')}</button>
      `;
      
      if (isCaught) {
        pokemonDiv.querySelector('.pokemon-info-button').addEventListener('click', () => {
          this.openModal(pokemon, family);
        });
      }
      
      this.pokedexGrid.appendChild(pokemonDiv);
    }
  }

  openModal(pokemon, family) {
    const caughtInfo = gameManager.getCaughtInfo(pokemon.index);
    
    document.getElementById('modalSprite').src = pokemon.sprite;
    document.getElementById('modalEgg').src = family.eggImage;
    document.getElementById('modalNameFR').textContent = pokemon.name_fr;
    document.getElementById('modalNameEN').textContent = pokemon.name_en;
    document.getElementById('modalIndex').textContent = pokemon.index;
    document.getElementById('modalType1').textContent = pokemon.type1;
    document.getElementById('modalType2').textContent = pokemon.type2 ? `, ${pokemon.type2}` : '';
    document.getElementById('modalCaughtCount').textContent = caughtInfo?.count || 0;
    
    if (caughtInfo?.firstCaught) {
      const date = new Date(caughtInfo.firstCaught);
      document.getElementById('modalFirstCaught').textContent = date.toLocaleDateString();
    } else {
      document.getElementById('modalFirstCaught').textContent = '-';
    }
    
    this.modal.style.display = 'flex';
  }

  closeModal() {
    this.modal.style.display = 'none';
  }

  updateProgress() {
    const progress = pokedexManager.getProgress();
    this.caughtCount.textContent = progress.caught;
    this.totalCount.textContent = progress.total;
    this.percentageText.textContent = progress.percentage;
    this.progressFill.style.width = progress.percentage + '%';
  }
}

// Initialiser l'interface au chargement
const pokedexUI = new PokedexUI();
document.addEventListener('DOMContentLoaded', () => pokedexUI.initialize());

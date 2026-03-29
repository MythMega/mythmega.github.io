/**
 * UI: pokemonCard
 * Renders a Pokémon card for the game page.
 */

import { log } from '../business/logger.js';

const TYPE_ICON_BASE = 'https://raw.githubusercontent.com/MythMega/PkServData/refs/heads/master/img/sprite/type/icon/teragem/TeraGem_';

const STAT_LABELS = {
  hp: 'PV',
  atk: 'Attaque',
  def: 'Défense',
  spe_atk: 'Attaque Spéciale',
  spe_def: 'Défense Spéciale',
  vit: 'Vitesse'
};

const STAT_ORDER = ['hp', 'atk', 'def', 'spe_atk', 'spe_def', 'vit'];

/**
 * Get the CSS class for a stat bar color.
 * @param {number} value
 * @returns {string}
 */
function statColorClass(value) {
  if (value <= 50) return 'stat-bar--red';
  if (value <= 75) return 'stat-bar--orange';
  if (value <= 110) return 'stat-bar--yellow';
  if (value <= 150) return 'stat-bar--green';
  return 'stat-bar--blue';
}

/**
 * Build the HTML for the stats block.
 * @param {Object} stats - pokemon.stats
 * @returns {string} HTML string
 */
function buildStatsHtml(stats) {
  if (!stats) return '<p class="no-data">Pas de stats disponibles</p>';
  return STAT_ORDER.map(key => {
    const val = stats[key] ?? 0;
    const label = STAT_LABELS[key] ?? key;
    const pct = Math.round((val / 255) * 100);
    const colorClass = statColorClass(val);
    return `
      <div class="stat-row">
        <span class="stat-label">${label}</span>
        <span class="stat-value">${val}</span>
        <div class="stat-bar-bg">
          <div class="stat-bar ${colorClass}" style="width:${pct}%"></div>
        </div>
      </div>`;
  }).join('');
}

/**
 * Build HTML for the types block.
 * @param {string[]} types
 * @returns {string} HTML string
 */
function buildTypesHtml(types) {
  if (!types || types.length === 0) return '<span class="no-data">—</span>';
  return types.map(t => `
    <span class="type-icon-wrapper" data-tooltip="${t}">
      <img
        src="${TYPE_ICON_BASE}${t}.png"
        alt="img ${t} icon"
        class="type-icon"
        onerror="this.style.display='none'"
        title="${t}"
      />
    </span>`).join('');
}

/**
 * Build the revealed info HTML for a Pokémon based on settings.
 * @param {Object} pokemon - Pokemon entity
 * @param {Object} settings - GameSettings
 * @returns {string} HTML string
 */
function buildInfoHtml(pokemon, settings) {
  const rows = [];

  if (settings.show_index) {
    rows.push(`<div class="info-row"><span class="info-label">N°</span><span class="info-value">#${String(pokemon.pokedex_id).padStart(4, '0')}</span></div>`);
  }

  if (settings.show_types) {
    rows.push(`<div class="info-row info-row--types"><span class="info-label">Types</span><span class="info-value types-container">${buildTypesHtml(pokemon.types)}</span></div>`);
  }

  if (settings.show_size) {
    const size = [pokemon.height, pokemon.weight].filter(Boolean).join(' — ');
    rows.push(`<div class="info-row"><span class="info-label">Taille / Poids</span><span class="info-value">${size || '—'}</span></div>`);
  }

  if (settings.show_multilang) {
    rows.push(`<div class="info-row"><span class="info-label">Noms</span><span class="info-value">🇫🇷 ${pokemon.name.fr} / 🇬🇧 ${pokemon.name.en} / 🇯🇵 ${pokemon.name.jp}</span></div>`);
  }

  if (settings.show_categories) {
    rows.push(`<div class="info-row"><span class="info-label">Catégorie</span><span class="info-value">${pokemon.category ?? '—'}</span></div>`);
  }

  if (settings.show_stats) {
    rows.push(`<div class="info-row info-row--stats"><span class="info-label">Stats</span><div class="stats-block">${buildStatsHtml(pokemon.stats)}</div></div>`);
  }

  if (settings.show_egg_groups) {
    rows.push(`<div class="info-row"><span class="info-label">Groupes d'œufs</span><span class="info-value">${pokemon.egg_groups.join(', ') || '—'}</span></div>`);
  }

  if (settings.show_catch_rate) {
    rows.push(`<div class="info-row"><span class="info-label">Taux de capture</span><span class="info-value">${pokemon.catch_rate ?? '—'}</span></div>`);
  }

  if (settings.show_evolution_status) {
    const evoParts = [];
    if (pokemon.has_evolution) evoParts.push('A une évolution');
    if (pokemon.is_evolved) evoParts.push('Est évolué');
    rows.push(`<div class="info-row"><span class="info-label">Statut d'évolution</span><span class="info-value">${evoParts.join(', ') || 'Pas d\'évolution'}</span></div>`);
  }

  if (rows.length === 0) {
    return '<p class="no-data">Aucune donnée sélectionnée dans les paramètres.</p>';
  }

  return rows.join('');
}

/**
 * Create and return a Pokémon card DOM element.
 * @param {Object} pokemon - Pokemon entity
 * @param {Object} settings - GameSettings
 * @param {Function} onChoose - Callback when player clicks "Choisir"
 * @returns {HTMLElement}
 */
export function createPokemonCard(pokemon, settings, onChoose) {
  log('createPokemonCard', pokemon.name.fr);

  const spriteUrl = settings.shiny === 'shiny' && pokemon.sprites.shiny
    ? pokemon.sprites.shiny
    : (pokemon.sprites.regular ?? '');

  const card = document.createElement('div');
  card.className = 'pokemon-card';
  card.dataset.id = pokemon.pokedex_id;

  card.innerHTML = `
    <div class="pokemon-card__sprite-wrap">
      <img
        class="pokemon-card__sprite"
        src="${spriteUrl}"
        alt="${pokemon.name.fr}"
        onerror="this.src=''"
      />
    </div>
    <div class="pokemon-card__name">${pokemon.name.fr}</div>
    <button class="btn btn--secondary pokemon-card__reveal-btn">Révéler les infos</button>
    <div class="pokemon-card__info hidden"></div>
    <button class="btn btn--primary pokemon-card__choose-btn hidden">Choisir</button>
  `;

  const revealBtn = card.querySelector('.pokemon-card__reveal-btn');
  const infoDiv = card.querySelector('.pokemon-card__info');
  const chooseBtn = card.querySelector('.pokemon-card__choose-btn');

  revealBtn.addEventListener('click', () => {
    infoDiv.innerHTML = buildInfoHtml(pokemon, settings);
    infoDiv.classList.remove('hidden');
    revealBtn.disabled = true;
    revealBtn.textContent = 'Infos révélées';
    log('createPokemonCard', `Revealed info for ${pokemon.name.fr}`);

    // Check if all cards in the same round are revealed, show choose buttons
    const parentGroup = card.parentElement;
    if (parentGroup) {
      const allCards = parentGroup.querySelectorAll('.pokemon-card');
      const allRevealed = Array.from(allCards).every(
        c => !c.querySelector('.pokemon-card__reveal-btn') || c.querySelector('.pokemon-card__reveal-btn').disabled
      );
      if (allRevealed) {
        allCards.forEach(c => {
          const btn = c.querySelector('.pokemon-card__choose-btn');
          if (btn) btn.classList.remove('hidden');
        });
        log('createPokemonCard', 'All cards revealed — choose buttons visible');
      }
    }
  });

  chooseBtn.addEventListener('click', () => {
    // Disable all choose buttons in the round
    const parentGroup = card.parentElement;
    if (parentGroup) {
      parentGroup.querySelectorAll('.pokemon-card__choose-btn').forEach(b => {
        b.disabled = true;
      });
      parentGroup.querySelectorAll('.pokemon-card').forEach(c => {
        c.classList.add('pokemon-card--faded');
      });
    }
    card.classList.remove('pokemon-card--faded');
    card.classList.add('pokemon-card--chosen');
    log('createPokemonCard', `Player chose: ${pokemon.name.fr}`);
    onChoose(pokemon);
  });

  return card;
}

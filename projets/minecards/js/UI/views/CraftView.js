/**
 * CraftView - The Minecraft crafting table: a 3 x 3 grid, its result slot, the inventory hotbar
 * under it and the crafting book above the whole table.
 *
 * Reference: `js/business/CraftManager.js` (the recipes, the matching and the transaction),
 * `settings/crafts.json` (what can be crafted) and `js/business/MiningManager.js` (the resources
 * the hotbar shows).
 *
 * THE INTERFACE
 * The screen imitates the crafting table of Minecraft: the 3 x 3 grid on the left, the arrow and
 * the result slot on its right, then the row of the inventory under both. The hotbar holds the
 * resources the recipes actually use and the items already crafted (the Ender Pearls), with their
 * count in the bottom-right corner of the icon: a resource no recipe ever asks for is left out, since
 * it could not be placed anywhere. The count is CLAMPED to 64 for the drawing only: a stock of 120
 * dusts reads as 64, but all 120 are usable.
 *
 * HOW A PLAYER CRAFTS
 * One tap on a hotbar item selects it, the next taps on the grid place one unit per slot, and a tap
 * on an occupied slot puts the unit back. As soon as the grid matches a recipe, its result appears
 * in the result slot and a tap on it commits the craft. A recipe is matched on the bounding box of
 * what was placed, so it works anywhere in the 3 x 3 table. The book can also fill the grid for the
 * player: one "Place" button per recipe lays its ingredients out when the stock has them all.
 *
 * The book is the Knowledge Book button above the table: it lists every recipe with its grid, the
 * item it gives and how to make it.
 */

import eventBus, { EVENTS } from '../../utils/EventBus.js';
import i18n from '../../utils/I18n.js';
import miningManager, { MINING_ERRORS } from '../../business/MiningManager.js';
import enderPearlManager, { PEARL_ITEM_ID } from '../../business/EnderPearlManager.js';
import { GOLDEN_PICKAXE_ITEM_ID } from '../../business/GoldenPickaxeManager.js';
import trophyManager from '../../business/TrophyManager.js';
import craftManager, {
  CRAFT_GRID_SIZE,
  CRAFT_GRID_SLOTS,
  CRAFT_MAX_STACK,
  CraftManager,
  getCraftErrorMessageKey,
  trimCraftGrid,
} from '../../business/CraftManager.js';

/** View name, matching `data-view="craft"` in `index.html`. */
export const CRAFT_VIEW_NAME = 'craft';

export class CraftView {
  /**
   * @param {HTMLElement} rootElement - The crafting `<section>` (`[data-view="craft"]`).
   */
  constructor(rootElement) {
    if (!rootElement || typeof rootElement.querySelector !== 'function') {
      throw new TypeError('CraftView requires the craft section element.');
    }

    this.root = rootElement;
    this.feedbackElement = this.root.querySelector('[data-craft-feedback]');
    this.gridElement = this.root.querySelector('[data-craft-grid]');
    this.hotbarElement = this.root.querySelector('[data-craft-hotbar]');
    this.resultElement = this.root.querySelector('[data-craft-result]');
    this.hintElement = this.root.querySelector('[data-craft-hint]');
    this.bookOpenButton = this.root.querySelector('[data-craft-book-open]');
    this.bookModal = this.root.querySelector('[data-craft-book]');
    this.bookListElement = this.root.querySelector('[data-craft-book-list]');
    this.bookCloseButton = this.root.querySelector('[data-craft-book-close]');

    this.assertMarkup();

    /** @type {Array<string|null>} The 9 slots of the table, top to bottom then left to right. */
    this.slots = new Array(CRAFT_GRID_SLOTS).fill(null);
    /** @type {string|null} Resource selected in the hotbar, waiting for a slot. */
    this.held = null;
    /** @type {string[]} Slugs of the resources of the mine. */
    this.resources = [];
    /** @type {Set<string>} Slugs at least one recipe asks for (only those reach the hotbar). */
    this.ingredientIds = new Set();
    /** @type {Array<{id: string, grid: Array<string|null>, result: object}>} Recipes of the book. */
    this.recipes = [];
    /** @type {{resources: Record<string, number>, pearls: number}} Stock read from the save. */
    this.stock = { resources: {}, pearls: 0 };
    /** @type {object|null} Recipe the current grid satisfies. */
    this.matched = null;

    /** @type {boolean} True once `init()` bound everything. */
    this.isInitialized = false;
    /** @type {boolean} True when the view is the active one. */
    this.isActive = false;
    /** @type {boolean} True while the view is loading its data. */
    this.isLoading = false;
    /** @type {boolean} True when a reload was asked for while one was already running. */
    this.reloadPending = false;
    /** @type {boolean} True while a craft is being committed. */
    this.isCrafting = false;

    /** @type {Array<{target: EventTarget, type: string, handler: EventListener}>} */
    this.bindings = [];
    /** @type {Function[]} */
    this.unsubscribers = [];
  }

  /**
   * Logs with the view prefix.
   *
   * @param {...unknown} args - Values forwarded to `console.info`.
   * @returns {void}
   */
  log(...args) {
    console.info('[CraftView]', ...args);
  }

  /**
   * Verifies that the markup matches the contract expected by this view.
   *
   * @returns {void}
   * @throws {Error} When a required element is missing from `index.html`.
   */
  assertMarkup() {
    const missing = [
      ['[data-craft-feedback]', this.feedbackElement],
      ['[data-craft-grid]', this.gridElement],
      ['[data-craft-hotbar]', this.hotbarElement],
      ['[data-craft-result]', this.resultElement],
      ['[data-craft-hint]', this.hintElement],
      ['[data-craft-book-open]', this.bookOpenButton],
      ['[data-craft-book]', this.bookModal],
      ['[data-craft-book-list]', this.bookListElement],
      ['[data-craft-book-close]', this.bookCloseButton],
    ]
      .filter(([, element]) => !element)
      .map(([selector]) => selector);

    if (missing.length > 0) {
      throw new Error(`CraftView markup is incomplete, missing: ${missing.join(', ')}.`);
    }
  }

  /**
   * Registers a listener and remembers it for `destroy()`.
   *
   * @param {EventTarget} target - Event target.
   * @param {string} type - Event type.
   * @param {EventListener} handler - Listener.
   * @returns {void}
   */
  listen(target, type, handler) {
    target.addEventListener(type, handler);
    this.bindings.push({ target, type, handler });
  }

  /**
   * Binds the interactions and loads the first state.
   *
   * @returns {Promise<void>} Resolves once the first render finished.
   */
  async init() {
    if (this.isInitialized) return;
    this.isInitialized = true;
    this.log('Initializing…');
    this.bindEvents();
    this.subscribeToEvents();
    await this.refresh();
    this.log('Ready.');
  }

  /**
   * Attaches the DOM listeners (grid, hotbar, result slot and the book).
   *
   * @returns {void}
   */
  bindEvents() {
    // One delegated listener per grid: the 9 slots are rebuilt on every render.
    this.listen(this.gridElement, 'click', (event) => this.handleGridClick(event));
    this.listen(this.hotbarElement, 'click', (event) => this.handleHotbarClick(event));
    this.listen(this.resultElement, 'click', () => void this.craft());
    this.listen(this.bookOpenButton, 'click', () => this.openBook());
    this.listen(this.bookCloseButton, 'click', () => this.closeBook());
    this.listen(this.bookModal, 'click', (event) => {
      // A click on the backdrop (never on the dialog itself) closes the book.
      if (event?.target === this.bookModal) this.closeBook();
    });
    this.listen(document, 'keydown', (event) => {
      if (event?.key === 'Escape' && this.bookModal && !this.bookModal.hidden) this.closeBook();
    });
    this.log('DOM listeners bound.');
  }

  /**
   * Follows the view changes and the balances the rest of the game moves.
   *
   * @returns {void}
   */
  subscribeToEvents() {
    this.unsubscribers.push(
      eventBus.on(EVENTS.VIEW_CHANGED, ({ view }) => {
        this.isActive = view === CRAFT_VIEW_NAME;
        if (this.isActive) void this.refresh();
        else this.closeBook();
      })
    );
    // The mine feeds the hotbar and a craft feeds the pearls back: both repaint the page while it
    // is displayed (the activation of the view reloads it anyway).
    this.unsubscribers.push(
      eventBus.on(EVENTS.MINING_UPDATED, () => {
        if (this.isActive) void this.refresh();
      })
    );
    this.unsubscribers.push(
      eventBus.on(EVENTS.PEARLS_UPDATED, () => {
        if (this.isActive) void this.refresh();
      })
    );
    this.unsubscribers.push(
      eventBus.on(EVENTS.LANG_CHANGED, () => {
        if (this.isActive) this.renderAll();
      })
    );
    this.log('Event subscriptions registered.');
  }

  /**
   * Called by `app.js` when the page becomes the active view.
   *
   * @returns {Promise<void>} Resolves once the page is up to date.
   */
  async handleViewActivated() {
    this.isActive = true;
    await this.refresh();
  }

  /**
   * Reads the stock, the recipes and the resources, then repaints the page.
   *
   * @returns {Promise<void>} Resolves once the render finished.
   */
  async refresh() {
    if (this.isLoading) {
      this.reloadPending = true;
      return;
    }
    this.isLoading = true;
    try {
      const [resources, recipes, state, inventory] = await Promise.all([
        craftManager.getResources(),
        craftManager.getRecipes(),
        miningManager.getState(),
        enderPearlManager.getInventory(),
      ]);
      this.resources = resources;
      this.recipes = recipes;
      this.ingredientIds = new Set(
        recipes.flatMap((recipe) => recipe.grid.filter((cell) => cell !== null))
      );
      this.stock = {
        resources: state?.resources ?? {},
        pearls: inventory?.[PEARL_ITEM_ID] ?? 0,
      };
      this.renderAll();
    } catch (error) {
      console.error('[CraftView] The crafting table could not be loaded.', error);
      this.showFeedback(i18n.t('craft.error.load'), 'error');
    } finally {
      this.isLoading = false;
      if (this.reloadPending) {
        this.reloadPending = false;
        void this.refresh();
      }
    }
  }

  /**
   * Repaints the grid, the hotbar, the result slot and the book (when it is open).
   *
   * @returns {void}
   */
  renderAll() {
    this.matched = craftManager.match(this.slots);
    this.renderGrid();
    this.renderHotbar();
    this.renderResult();
    if (this.bookModal && !this.bookModal.hidden) this.renderBook();
  }

  /**
   * Returns the stock of one item, ignoring what the table already holds.
   *
   * @param {string} id - Resource slug or `pearl`.
   * @returns {number} How many units are owned.
   */
  stockOf(id) {
    const base = id === PEARL_ITEM_ID ? this.stock.pearls : this.stock.resources?.[id] ?? 0;
    return Number.isInteger(base) ? base : 0;
  }

  /**
   * Returns the stock of one item, minus what the table already holds.
   *
   * @param {string} id - Resource slug or `pearl`.
   * @returns {number} How many units can still be placed.
   */
  available(id) {
    const placed = this.slots.filter((slot) => slot === id).length;
    return Math.max(0, this.stockOf(id) - placed);
  }

  /**
   * Name of an item of the table, in the player's language.
   *
   * @param {string} id - Resource slug, `pearl`, `golden_pickaxe` or `sparks`.
   * @returns {string} The label.
   */
  itemName(id) {
    if (id === PEARL_ITEM_ID) return i18n.t('craft.item.pearl');
    if (id === GOLDEN_PICKAXE_ITEM_ID) return i18n.t('craft.item.golden_pickaxe');
    if (id === 'sparks') return i18n.t('craft.item.sparks');
    return i18n.t(`mineblock.resource.${id}`);
  }

  /**
   * Builds the picture of an item.
   *
   * @param {string} id - Resource slug, `pearl` or `sparks`.
   * @returns {HTMLImageElement} The icon.
   */
  buildIcon(id) {
    const image = document.createElement('img');
    image.className = 'craft__icon';
    image.src = CraftManager.itemIcon(id);
    image.alt = '';
    image.decoding = 'async';
    image.draggable = false;
    image.setAttribute('aria-hidden', 'true');
    return image;
  }

  /**
   * Builds the count badge of a slot (a full stack is drawn as 64).
   *
   * @param {number} count - Units in the slot.
   * @returns {HTMLSpanElement} The badge.
   */
  buildCount(count) {
    const badge = document.createElement('span');
    badge.className = 'craft__count';
    badge.textContent = String(Math.min(count, CRAFT_MAX_STACK));
    badge.setAttribute('aria-hidden', 'true');
    return badge;
  }

  /**
   * Repaints the 9 slots of the table.
   *
   * @returns {void}
   */
  renderGrid() {
    this.gridElement.textContent = '';
    for (let index = 0; index < CRAFT_GRID_SLOTS; index += 1) {
      const id = this.slots[index];
      const slot = document.createElement('button');
      slot.type = 'button';
      slot.className = 'craft__slot';
      slot.dataset.craftSlot = String(index);
      // The slots a selected resource could go to are highlighted, exactly like the slot the mouse
      // hovers in Minecraft.
      slot.classList.toggle('is-target', Boolean(this.held) && !id);
      slot.setAttribute(
        'aria-label',
        id
          ? i18n.t('craft.grid.slotFilled', { index: index + 1, item: this.itemName(id) })
          : i18n.t('craft.grid.slot', { index: index + 1 })
      );
      if (id) slot.append(this.buildIcon(id));
      this.gridElement.append(slot);
    }
  }

  /**
   * Repaints the inventory hotbar: the resources the recipes use, then the crafted pearls.
   *
   * @returns {void}
   */
  renderHotbar() {
    this.hotbarElement.textContent = '';
    // A resource no recipe asks for has nothing to do in a crafting inventory: it would only take a
    // slot of the row (the mine shows its full stock on its own screen).
    const ids = [
      ...this.resources.filter((slug) => this.ingredientIds.has(slug)),
      PEARL_ITEM_ID,
    ];
    // The row always counts 9 slots, like the Minecraft hotbar: the free ones stay empty.
    for (let index = 0; index < CRAFT_GRID_SLOTS; index += 1) {
      const id = ids[index] ?? null;
      if (!id) {
        const empty = document.createElement('span');
        empty.className = 'craft__slot';
        empty.setAttribute('aria-hidden', 'true');
        this.hotbarElement.append(empty);
        continue;
      }

      const count = this.available(id);
      const slot = document.createElement('button');
      slot.type = 'button';
      slot.className = 'craft__slot';
      slot.dataset.craftItem = id;
      slot.disabled = count === 0;
      slot.classList.toggle('is-selected', this.held === id);
      slot.setAttribute('aria-pressed', String(this.held === id));
      slot.setAttribute(
        'aria-label',
        i18n.t('craft.hotbar.slot', { item: this.itemName(id), count })
      );
      slot.append(this.buildIcon(id));
      slot.append(this.buildCount(count));
      this.hotbarElement.append(slot);
    }
  }

  /**
   * Repaints the result slot from the recipe the grid currently satisfies.
   *
   * @returns {void}
   */
  renderResult() {
    const recipe = this.matched;
    this.resultElement.textContent = '';
    this.resultElement.disabled = !recipe;
    this.resultElement.classList.toggle('is-ready', Boolean(recipe));

    if (!recipe) {
      this.resultElement.setAttribute('aria-label', i18n.t('craft.result.empty'));
      this.hintElement.textContent = i18n.t('craft.hint');
      return;
    }

    const name = this.itemName(recipe.result.id);
    this.resultElement.setAttribute(
      'aria-label',
      i18n.t('craft.result.craft', { item: name, count: recipe.result.quantity })
    );
    this.resultElement.append(this.buildIcon(recipe.result.id));
    if (recipe.result.quantity > 1) {
      this.resultElement.append(this.buildCount(recipe.result.quantity));
    }
    this.hintElement.textContent = i18n.t('craft.hint.ready', { item: name });
  }

  /**
   * Centres the trimmed shape of a recipe in a 3 x 3 preview (the book shows it centred, like the
   * grid the player must build).
   *
   * @param {Array<string|null>} grid - Flat 3 x 3 recipe grid.
   * @returns {Array<string|null>} The 9 cells of the preview.
   */
  centredPattern(grid) {
    const cells = new Array(CRAFT_GRID_SLOTS).fill(null);
    const trimmed = trimCraftGrid(grid);
    if (!trimmed) return cells;
    const rowOffset = Math.floor((CRAFT_GRID_SIZE - trimmed.rows) / 2);
    const columnOffset = Math.floor((CRAFT_GRID_SIZE - trimmed.columns) / 2);
    for (let row = 0; row < trimmed.rows; row += 1) {
      for (let column = 0; column < trimmed.columns; column += 1) {
        cells[(row + rowOffset) * CRAFT_GRID_SIZE + column + columnOffset] =
          trimmed.cells[row * trimmed.columns + column];
      }
    }
    return cells;
  }

  /**
   * Builds the list of the crafting book.
   *
   * @returns {void}
   */
  renderBook() {
    this.bookListElement.textContent = '';
    this.recipes.forEach((recipe) => {
      const article = document.createElement('article');
      article.className = 'craft-book__recipe';

      const grid = document.createElement('div');
      grid.className = 'craft-book__grid';
      grid.setAttribute('aria-hidden', 'true');
      this.centredPattern(recipe.grid).forEach((id) => {
        const cell = document.createElement('span');
        cell.className = 'craft-book__cell';
        if (id) cell.append(this.buildIcon(id));
        grid.append(cell);
      });

      const arrow = document.createElement('span');
      arrow.className = 'craft-book__arrow';
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = '→';

      const result = document.createElement('span');
      result.className = 'craft-book__result';
      result.append(this.buildIcon(recipe.result.id));
      if (recipe.result.quantity > 1) result.append(this.buildCount(recipe.result.quantity));

      const text = document.createElement('div');
      text.className = 'craft-book__text';
      const title = document.createElement('h3');
      title.className = 'craft-book__name';
      title.textContent = i18n.t(`craft.recipe.${recipe.id}.name`);
      const description = document.createElement('p');
      description.className = 'craft-book__desc';
      description.textContent = i18n.t(`craft.recipe.${recipe.id}.desc`);
      const ingredients = document.createElement('p');
      ingredients.className = 'craft-book__ingredients';
      ingredients.textContent = this.describeIngredients(recipe.grid);
      text.append(title, description, ingredients);

      // "Place" fills the whole grid with the ingredients of the recipe, when the stock has them:
      // the shape is what the table matches, so retyping it slot by slot is busywork.
      const place = document.createElement('button');
      place.type = 'button';
      place.className = 'btn btn--ghost btn--small craft-book__place';
      place.textContent = i18n.t('craft.book.place');
      place.disabled = !this.canPlaceRecipe(recipe);
      place.addEventListener('click', () => this.placeRecipe(recipe));

      article.append(grid, arrow, result, text, place);
      this.bookListElement.append(article);
    });
  }

  /**
   * Summarizes the ingredients of a recipe ("8 Poussière du vide, 1 Poussière de pierre lumineuse").
   *
   * @param {Array<string|null>} grid - Flat 3 x 3 recipe grid.
   * @returns {string} The summary.
   */
  describeIngredients(grid) {
    const counts = new Map();
    grid.forEach((id) => {
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    });
    const parts = Array.from(counts.entries()).map(([id, count]) =>
      i18n.t('craft.ingredient', { count, item: this.itemName(id) })
    );
    return i18n.t('craft.ingredients', { list: parts.join(', ') });
  }

  /**
   * Tells whether the stock covers every ingredient of a recipe.
   *
   * @param {{grid: Array<string|null>}} recipe - Recipe to test.
   * @returns {boolean} True when the grid could be filled right now.
   */
  canPlaceRecipe(recipe) {
    const required = new Map();
    recipe.grid.forEach((id) => {
      if (id) required.set(id, (required.get(id) ?? 0) + 1);
    });
    return Array.from(required.entries()).every(([id, count]) => this.stockOf(id) >= count);
  }

  /**
   * Fills the grid with the ingredients of a recipe (nothing is spent until the result is clicked).
   *
   * @param {{grid: Array<string|null>}} recipe - Recipe to lay out.
   * @returns {void}
   */
  placeRecipe(recipe) {
    if (!this.canPlaceRecipe(recipe)) return;
    this.slots = [...recipe.grid];
    this.held = null;
    this.closeBook();
    this.renderAll();
    this.log(`Recipe "${recipe.id}" placed in the grid.`);
  }

  /**
   * Handles a click on a slot of the table: place the selected resource, or take one back.
   *
   * @param {MouseEvent} event - Click event.
   * @returns {void}
   */
  handleGridClick(event) {
    if (!(event.target instanceof Element)) return;
    const slot = event.target.closest('[data-craft-slot]');
    if (!slot) return;
    const index = Number(slot.dataset.craftSlot);
    if (!Number.isInteger(index) || index < 0 || index >= CRAFT_GRID_SLOTS) return;

    if (this.slots[index]) {
      // Taking an ingredient back never changes the save: the table is only a staging area, so the
      // stock was never spent.
      this.slots[index] = null;
    } else if (this.held && this.available(this.held) > 0) {
      this.slots[index] = this.held;
    } else {
      return;
    }
    this.renderAll();
  }

  /**
   * Handles a click on the hotbar: select the resource to place (or deselect it).
   *
   * @param {MouseEvent} event - Click event.
   * @returns {void}
   */
  handleHotbarClick(event) {
    if (!(event.target instanceof Element)) return;
    const slot = event.target.closest('[data-craft-item]');
    if (!slot) return;
    const id = slot.dataset.craftItem;
    if (!id) return;
    this.held = this.held === id ? null : id;
    this.renderAll();
  }

  /**
   * Commits the craft of the recipe the grid satisfies.
   *
   * @returns {Promise<void>} Resolves once the result and the balances are painted.
   */
  async craft() {
    if (!this.matched || this.isCrafting) return;
    const recipe = this.matched;
    this.isCrafting = true;
    this.clearFeedback();
    try {
      const outcome = await craftManager.craft(recipe.id, this.slots);
      this.slots = new Array(CRAFT_GRID_SLOTS).fill(null);
      this.held = null;
      await this.refresh();
      this.showFeedback(
        i18n.t('craft.result.crafted', {
          count: outcome.result.quantity,
          item: this.itemName(outcome.result.id),
        }),
        'success'
      );
      this.log(`Crafted "${recipe.id}".`);
      // The medals of the crafted items, the experience and the notifications follow a craft.
      void trophyManager.evaluate({ notify: true });
    } catch (error) {
      console.error('[CraftView] The craft failed.', error);
      const key =
        error?.code === MINING_ERRORS.INSUFFICIENT_RESOURCES
          ? 'craft.error.resources'
          : getCraftErrorMessageKey(error?.code);
      this.showFeedback(i18n.t(key), 'error');
      await this.refresh();
    } finally {
      this.isCrafting = false;
    }
  }

  /**
   * Opens the crafting book.
   *
   * @returns {void}
   */
  openBook() {
    this.renderBook();
    this.bookModal.hidden = false;
    this.bookOpenButton.setAttribute('aria-expanded', 'true');
    this.bookCloseButton.focus();
  }

  /**
   * Closes the crafting book.
   *
   * @returns {void}
   */
  closeBook() {
    if (!this.bookModal || this.bookModal.hidden) return;
    this.bookModal.hidden = true;
    this.bookOpenButton.setAttribute('aria-expanded', 'false');
    this.bookOpenButton.focus();
  }

  /**
   * Shows a message under the page title.
   *
   * @param {string} text - Already translated text.
   * @param {'info'|'success'|'error'} [tone='info'] - Tone of the message.
   * @returns {void}
   */
  showFeedback(text, tone = 'info') {
    if (!this.feedbackElement) return;
    this.feedbackElement.textContent = text;
    this.feedbackElement.hidden = text === '';
    if (tone === 'error') this.feedbackElement.dataset.tone = 'error';
    else if (tone === 'success') this.feedbackElement.dataset.tone = 'success';
    else delete this.feedbackElement.dataset.tone;
  }

  /**
   * Hides the feedback line.
   *
   * @returns {void}
   */
  clearFeedback() {
    this.showFeedback('', 'info');
  }

  /**
   * Removes the listeners and forgets the state (used by a full reset).
   *
   * @returns {void}
   */
  destroy() {
    this.log('Destroying the view.');
    this.bindings.forEach(({ target, type, handler }) => target.removeEventListener(type, handler));
    this.bindings = [];
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers = [];
    this.slots = new Array(CRAFT_GRID_SLOTS).fill(null);
    this.held = null;
    this.matched = null;
    this.isInitialized = false;
  }
}

export default CraftView;

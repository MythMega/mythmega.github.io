/**
 * scenes.js - One builder per sequence of the MineCards show.
 *
 * Reference: `special/demo/animations.json` (the order, the lengths and the internal timings),
 * `special/demo/assets.json` (every card and picture), `special/demo/scripts/core.js` (the beat,
 * the camera, the particles) and `special/demo/styles/scenes.css` (the look).
 *
 * A builder returns `{ element, play }`: the element is created during the preload (so nothing is
 * laid out while the show runs), and `play` only animates what already exists. Every duration is a
 * multiple of the beat, which is why one `bpm` value changes the pace of the whole film.
 */

import {
  animate,
  beat,
  burst,
  countTo,
  create,
  flash,
  formatNumber,
  play,
  revealLetters,
  shockwave,
  sleep,
  splitLetters,
  state,
  tr,
} from './core.js';
import { Booster3DRenderer } from '../../../js/UI/components/Booster3DRenderer.js';
import { ProfileCard } from '../../../js/UI/components/ProfileCard.js';
import { applyShine } from '../../../js/utils/Shine.js';
import { RARITY_COLORS } from './cards.js';

/** Reveals of the full-art cards, in the order they are used. */
const REVEALS = [
  'wipe',
  'spin',
  'zoom',
  'slice',
  'iris',
  'flip',
  'drop',
  'shatter',
];

/**
 * Creates the `<section>` of one scene.
 *
 * @param {string} className - Block classes of the scene.
 * @returns {HTMLElement} The scene element.
 */
function sceneRoot(className) {
  return create('section', `demo__scene ${className}`.trim());
}

/**
 * Creates a background layer of a scene, with its parallax depth.
 *
 * @param {number} depth - Depth of the layer (`1` close, `-2` far).
 * @returns {HTMLElement} The layer.
 */
function sceneLayer(depth) {
  const layer = create('div', 'demo__layer');
  layer.dataset.depth = String(depth);
  return layer;
}

/**
 * Builds the six faces of a 3D booster.
 *
 * @param {object} ctx - Show context.
 * @param {string} artPath - Project-relative path of the booster artwork.
 * @param {string} [className] - Extra class (`demo-pack--small`, `demo-pack--large`).
 * @returns {HTMLElement} The pack, ready to rotate.
 */
function buildPack(ctx, artPath, className = '') {
  const pack = create('div', `demo-pack ${className}`.trim());
  pack.style.setProperty('--pack-art', `url("${ctx.asset(artPath)}")`);

  const glow = create('div', 'demo-pack__glow');
  const faces = ['front', 'back', 'left', 'right', 'top', 'bottom'].map((face) =>
    create('div', `demo-pack__face demo-pack__face--${face}`)
  );
  const shine = create('div', 'demo-pack__shine');
  pack.append(glow, ...faces, shine);
  return pack;
}

/**
 * Replaces a CSS booster by the real `.glb` model of the game.
 *
 * Every booster of the show uses the same model and the same textures: the renderer caches both
 * downloads, so a grid of nine packs downloads the files once. A failed WebGL context leaves the
 * CSS pack in place instead of breaking the scene.
 *
 * @param {object} ctx - Show context.
 * @param {HTMLElement} mount - Container that will host the canvas.
 * @param {HTMLElement|null} fallback - CSS pack shown when 3D is unavailable.
 * @param {string} setId - `A1` or `A2`, resolved in `assets.sets`.
 * @param {string} label - Log label of the renderer.
 * @param {boolean} [skipEnvironment=false] - Skip the costly studio reflections (grid packs).
 * @returns {Promise<Booster3DRenderer|null>} The ready renderer, or null for the fallback.
 */
async function prepare3DPack(ctx, mount, fallback, setId, label, skipEnvironment = false) {
  const set = ctx.assets.sets?.[setId];
  const modelPath = ctx.assets.media?.boosterModel;
  if (!mount || !set?.texture || !modelPath) return null;

  let renderer = null;
  try {
    renderer = new Booster3DRenderer({
      container: mount,
      texturePath: ctx.asset(set.texture),
      modelPath: ctx.asset(modelPath),
      interactive: false,
      label,
    });
    const available = await renderer.init();
    if (!available) {
      renderer.dispose();
      return null;
    }
    mount.classList.add('is-ready');
    fallback?.classList.add('is-hidden');
    if (skipEnvironment) {
      if (renderer.environmentTimer !== null) window.clearTimeout(renderer.environmentTimer);
      renderer.environmentTimer = null;
      renderer.environmentPromise = null;
    }
    return renderer;
  } catch (error) {
    renderer?.dispose();
    console.warn(`[demo] The 3D booster ${setId} is unavailable; the CSS pack is used.`, error);
    return null;
  }
}

/**
 * Builds one real profile card (`ProfileCard`, the component of the game) from the assets manifest.
 *
 * The component renders in a shadow root and measures the width of its host, so the host is wrapped
 * in a fixed 360x500 frame that the stylesheet scales. The animated element is the outer `.profile-
 * shot`, which keeps the scaling of the component independent of the entrance transforms.
 *
 * @param {object} ctx - Show context.
 * @param {object} profile - Entry of `assets.profiles`.
 * @param {string} nickname - Pseudo picked from `assets.nicknames`.
 * @param {number} index - Position in the stack.
 * @returns {{shot: HTMLElement, ready: Promise<void>}} The animated shot and its render.
 */
function buildRealProfile(ctx, profile, nickname, index) {
  const shot = create('div', 'profile-shot');
  shot.style.zIndex = String(10 + index);
  const frame = create('div', 'real-profile');
  const host = create('div', 'real-profile__host');
  frame.append(host);
  shot.append(frame);

  const card = ctx.lib.get(profile.card);
  const component = new ProfileCard(host);
  component.setLayout(profile.layout ?? 'classic');
  const model = {
    name: nickname,
    titleId: profile.titleId,
    seriesNumber: String(index + 1).padStart(3, '0'),
    rarity: profile.rarity,
    background: card?.background ?? '',
    underlay: profile.avatar,
    level: profile.level,
    boostersOpened: profile.cards,
    distinctCards: profile.cards,
    firstObtainedAt: '2025-01-01',
    blocksMined: profile.trades * 18 + profile.likes * 3,
    picksMade: profile.likes * 4,
    accountValue: profile.cards * 42 + profile.trades * 90,
    featuredTrophies: [],
    iconScale: 1,
    iconPositionX: '50%',
  };
  const ready = component.render(model).catch((error) => {
    console.warn(`[demo] The profile card of "${nickname}" could not be rendered.`, error);
  });
  return { shot, ready };
}

/**
 * Builds the row of a friend of the social scene.
 *
 * @param {object} ctx - Show context.
 * @param {object} friend - Entry of `assets.friends`.
 * @returns {HTMLElement} The row.
 */
function buildFriend(ctx, friend) {
  const row = create('li', 'friend');
  const avatar = create('img', 'friend__avatar');
  avatar.src = ctx.asset(friend.avatar);
  avatar.alt = '';
  avatar.decoding = 'async';

  const identity = create('div', 'friend__identity');
  identity.append(create('p', 'friend__name', friend.name));
  identity.append(create('p', 'friend__level', tr('friends.friendship', {
    level: friend.friendship ?? Math.ceil((friend.level ?? 1) / 10),
  })));

  const check = create('span', 'friend__check', '✓');
  const heart = create('span', 'friend__heart', '♥');
  row.append(avatar, identity, check, heart);
  return row;
}

/**
 * Builds the friends panel used by both social scenes.
 *
 * @param {object} ctx - Show context.
 * @param {boolean} [filled=false] - Rows visible immediately (the likes scene).
 * @returns {{root: HTMLElement, list: HTMLElement, rows: HTMLElement[], button: HTMLElement,
 *   count: HTMLElement, status: HTMLElement}} The panel.
 */
function buildFriendsPanel(ctx, filled = false) {
  const root = create('div', 'friends__panel');
  const head = create('div', 'friends__head');
  const count = create('span', 'friends__count', tr('friends.online', { count: ctx.assets.friends.length }));
  const button = create('button', 'friends__button', tr('friends.likeAll'));
  button.type = 'button';
  head.append(count, button);

  const list = create('ul', 'friends__list');
  const rows = ctx.assets.friends.map((friend) => {
    const row = buildFriend(ctx, friend);
    if (filled) {
      row.style.opacity = '1';
      row.style.transform = 'none';
    }
    list.append(row);
    return row;
  });
  const status = create('p', 'friends__status', tr('friends.liked'));
  root.append(head, list, status);
  return { root, list, rows, button, count, status };
}

/**
 * Shows a text phase over a field of scrolling cards.
 *
 * @param {object} def - Scene definition of `animations.json`.
 * @param {object} ctx - Show context.
 * @returns {{element: HTMLElement, play: () => Promise<void>}} The scene.
 */
function buildPhase(def, ctx) {
  const key = def.id === 'mineIntro' ? 'mine' : def.id === 'shopIntro' ? 'shop' : def.id;
  const root = sceneRoot(`phase phase--${def.id}`);
  const backdrop = create('div', 'phase__backdrop');
  backdrop.dataset.depth = '2';
  // Three rows of ten cards: the field covers the whole frame, so a drifting row never leaves a
  // visible gap at either edge, even on the vertical format.
  const rows = [create('div', 'phase__row'), create('div', 'phase__row'), create('div', 'phase__row')];
  backdrop.append(...rows);

  const content = create('div', 'phase__content');
  const kicker = create('p', 'phase__kicker', tr(`phase.${key}.kicker`));
  const title = create('h2', 'phase__title', tr(`phase.${key}.title`));
  const rule = create('div', 'phase__rule');
  const subtitle = create('p', 'phase__subtitle', tr(`phase.${key}.subtitle`));
  content.append(kicker, title, rule, subtitle);

  const back = sceneLayer(-2);
  back.append(backdrop);
  root.append(back, content);

  return {
    element: root,
    play: async () => {
      ctx.phasePool.forEach((card) => card.remove());
      const letters = splitLetters(title);
      const isCollection = def.id === 'collect';
      // Fill one row at a time: distributing by `index % rows.length` would send every
      // `index % 3` coloured card to the same row, leaving the two others entirely grey.
      const perRow = Math.ceil(ctx.phasePool.length / rows.length);
      ctx.phasePool.forEach((card, index) => {
        // The collection field is half obtained, half missing, in EVERY row: one in three cards
        // stays in colour and the others are greyed, so the wall reads as a real collection.
        card.classList.toggle('is-obtained', isCollection && index % 3 === 0);
        card.classList.toggle('is-dimmed', isCollection && index % 3 !== 0);
        rows[Math.min(rows.length - 1, Math.floor(index / perRow))].append(card);
      });
      play(kicker, [{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }], {
        duration: beat(0.8),
        easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      });
      play(rule, [{ width: '0px' }, { width: '260px' }], {
        duration: beat(1.2),
        delay: beat(0.8),
        easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      });
      await revealLetters(letters, 0.06);
      play(subtitle, [{ opacity: 0 }, { opacity: 1 }], { duration: beat(0.8) });
    },
  };
}

/**
 * The 3D booster: the real model spins faster and faster, flies away, then the cards fan out.
 *
 * @param {object} def - Scene definition of `animations.json`.
 * @param {object} ctx - Show context.
 * @returns {{element: HTMLElement, play: () => Promise<void>}} The scene.
 */
function buildBooster(def, ctx) {
  const root = sceneRoot('booster');
  const rays = create('div', 'booster__rays');
  const stage = create('div', 'booster__stage');
  const mount = create('div', 'booster__3d');
  const pack = buildPack(ctx, ctx.assets.sets.A1.art, 'demo-pack--hero');
  pack.style.transform = 'rotateY(-20deg) rotateX(6deg)';
  let model = null;

  const fan = create('div', 'fan');
  const halo = create('div', 'fan__halo');
  const cards = (ctx.assets.scenes.booster.cards ?? []).map((reference, index) => {
    const box = ctx.lib.build(reference, { className: 'fan__card' });
    box.dataset.index = String(index);
    fan.append(box);
    return box;
  });

  mount.append(pack);
  stage.append(mount);
  root.append(rays, sceneLayer(-1), stage, fan, halo);

  // The real booster is the game model itself. It is prepared while the loader is up; when WebGL
  // or the model is unavailable, the CSS pack stays in place and the scene still plays.
  const prepare = prepare3DPack(ctx, mount, pack, 'A1', 'demo-booster').then((renderer) => {
    model = renderer;
  });

  return {
    element: root,
    prepare,
    dispose: () => {
      model?.stop();
      model?.dispose();
      model = null;
    },
    play: async () => {
      const spin = beat(def.spinBeats ?? 12);
      const started = performance.now();
      let rotation = -20;
      let previous = started;
      if (model) {
        model.spinVelocity = 0.12;
        model.start();
      }
      await new Promise((done) => {
        /**
         * Turns the pack a little more on every frame, faster as the countdown runs.
         *
         * @param {number} now - Frame timestamp.
         * @returns {void}
         */
        const frame = (now) => {
          const progress = Math.min(1, (now - started) / spin);
          const delta = Math.min(64, now - previous);
          previous = now;
          rotation += ((160 + 1500 * progress) * delta) / 1000;
          if (model) {
            // The renderer owns its loop: pushing its velocity every frame gives the same
            // accelerating spin as the CSS pack, without touching its pivot by hand.
            model.spinVelocity = 0.08 + progress * 0.42;
          } else {
            pack.style.transform = `rotateY(${rotation}deg) rotateX(${6 - progress * 4}deg) scale(${
              1 + progress * 0.08
            })`;
          }
          if (progress < 1) requestAnimationFrame(frame);
          else done();
        };
        requestAnimationFrame(frame);
      });

      await play(
        stage,
        [
          { transform: 'translate3d(0, 0, 0) scale(1)', opacity: 1, filter: 'blur(0)' },
          {
            transform: 'translate3d(30px, -520px, 1100px) scale(1.9)',
            opacity: 0,
            filter: 'blur(6px)',
          },
        ],
        { duration: beat(def.flyBeats ?? 3), easing: 'cubic-bezier(0.5, 0, 0.9, 0.4)' }
      );
      model?.stop();
      model?.dispose();
      model = null;
      stage.style.visibility = 'hidden';
      play(halo, [{ opacity: 0, transform: 'scale(0.4)' }, { opacity: 1, transform: 'scale(1)' }], {
        duration: beat(1.4),
        easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      });

      const vertical = state.format === 'vertical';
      const total = cards.length;
      cards.forEach((card, index) => {
        const offset = index - (total - 1) / 2;
        const x = vertical ? offset * 84 : offset * 142;
        const y = Math.abs(offset) * (vertical ? 34 : 28) + 44;
        const turn = offset * (vertical ? 5 : 6);
        play(
          card,
          [
            { opacity: 0, transform: 'translate3d(0, 0, 0) rotateY(90deg) scale(0.4)' },
            { opacity: 1, transform: `translate3d(${x}px, ${y}px, 0) rotateZ(${turn}deg) rotateY(0) scale(1)` },
          ],
          {
            duration: beat(1.5),
            delay: beat(0.16) * index,
            easing: 'cubic-bezier(0.2, 0.9, 0.2, 1)',
          }
        );
      });
      await sleep(beat(1.5) + beat(0.16) * cards.length);
      burst(root, {
        count: 44,
        x: vertical ? 540 : 960,
        y: vertical ? 820 : 480,
        colors: ['#ffd54a', '#7fa5ff', '#ffffff'],
        spread: 520,
        duration: beat(1.6),
        size: 10,
      });
      flash(ctx.flashLayer, 0.7, beat(1));
      await sleep(beat(def.openBeats ?? 5) * 0.55);
    },
  };
}

/**
 * Nine simultaneous openings, with the special booster in the middle.
 *
 * @param {object} def - Scene definition of `animations.json`.
 * @param {object} ctx - Show context.
 * @returns {{element: HTMLElement, play: () => Promise<void>}} The scene.
 */
function buildMulti(def, ctx) {
  const root = sceneRoot('multi');
  const grid = create('div', 'multi__grid');
  const sides = ctx.assets.scenes.multi.cards ?? [];
  const centerRefs = ctx.assets.scenes.multi.center ?? [];
  const cells = [];
  let sideIndex = 0;

  for (let index = 0; index < 9; index += 1) {
    const cell = create('div', 'multi__cell');
    const isCenter = index === 4;
    const packWrap = create('div', 'multi__pack');
    const mount = create('div', 'multi__pack-mount');
    const pack = buildPack(ctx, ctx.assets.sets.A1.art, 'demo-pack--small');
    mount.append(pack);
    packWrap.append(mount);
    cell.append(packWrap);

    if (isCenter) {
      const center = create('div', 'multi__center');
      center.append(create('div', 'multi__center-glow'));
      // One print only: a stack of them was revealed one after another, so the middle of the grid
      // showed a card and then replaced it with the next one while the packs were opening.
      const card = ctx.lib.build(centerRefs[0] ?? sides[0], { className: 'multi__card' });
      center.append(card);
      cell.append(center);
      cells.push({ cell, pack, mount, renderer: null, cards: [card], center });
    } else {
      const reference = sides[sideIndex % Math.max(1, sides.length)];
      sideIndex += 1;
      const card = ctx.lib.build(reference, { className: 'multi__card' });
      cell.append(card);
      cells.push({ cell, pack, mount, renderer: null, cards: [card], center: null });
    }
    grid.append(cell);
  }

  root.append(grid);

  const prepare = Promise.all(
    cells.map(async (entry, index) => {
      entry.renderer = await prepare3DPack(
        ctx,
        entry.mount,
        entry.pack,
        'A1',
        `demo-multi-${index + 1}`,
        true
      );
    })
  );

  return {
    element: root,
    prepare,
    dispose: () => {
      cells.forEach((entry) => {
        entry.renderer?.stop();
        entry.renderer?.dispose();
        entry.renderer = null;
      });
    },
    play: async () => {
      const shuffle = beat(def.shuffleBeats ?? 6);
      cells.forEach((entry, index) => {
        play(
          entry.cell,
          [
            { opacity: 0, transform: 'translateY(40px) scale(0.9)' },
            { opacity: 1, transform: 'none' },
          ],
          { duration: beat(0.8), delay: beat(0.08) * index, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }
        );
        if (entry.renderer) {
          entry.renderer.start();
          // The renderer damps this velocity: a small kick turns the pack enough to read as 3D
          // without letting it stop edge-on, where the model would be a thin line.
          entry.renderer.spinVelocity = 0.02;
        } else {
          play(
            entry.pack,
            [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(720deg)' }],
            { duration: shuffle, delay: beat(0.08) * index, easing: 'linear' }
          );
        }
      });

      await sleep(shuffle * 0.92);

      cells.forEach((entry, index) => {
        const delay = index === 4 ? beat(1.2) : beat(0.1) * index;
        window.setTimeout(() => {
          entry.cell.classList.add('is-open');
          entry.renderer?.stop();
          entry.renderer?.dispose();
          entry.renderer = null;
          entry.cards.forEach((card, cardIndex) => {
            play(
              card,
              [
                { opacity: 0, transform: 'rotateY(90deg) scale(0.85)' },
                { opacity: 1, transform: 'rotateY(0) scale(1)' },
              ],
              {
                duration: beat(1),
                delay: beat(0.1) * cardIndex,
                easing: 'cubic-bezier(0.2, 0.9, 0.2, 1)',
              }
            );
          });
          if (index === 4) {
            play(entry.center.querySelector('.multi__center-glow'), [{ opacity: 0 }, { opacity: 1 }], {
              duration: beat(0.8),
            });
            entry.center.classList.add('is-open');
            shockwave(root, state.format === 'vertical' ? 540 : 960, state.format === 'vertical' ? 960 : 540, '#ffd54a', 760);
            burst(root, {
              count: 30,
              x: state.format === 'vertical' ? 540 : 960,
              y: state.format === 'vertical' ? 960 : 540,
              spread: 360,
              duration: beat(1.2),
            });
          }
        }, delay);
      });

      await sleep(beat(def.openBeats ?? 8));
    },
  };
}

/**
 * The mosaic: greyed cards scrolling in opposite directions, the obtained ones in colour.
 *
 * @param {object} def - Scene definition of `animations.json`.
 * @param {object} ctx - Show context.
 * @returns {{element: HTMLElement, play: () => Promise<void>}} The scene.
 */
function buildMosaic(def, ctx) {
  const root = sceneRoot('mosaic');
  const rowsWrap = create('div', 'mosaic__rows');
  const cards = ctx.assets.scenes.mosaic.cards ?? [];
  const obtained = new Set(ctx.assets.scenes.mosaic.obtained ?? []);
  const rows = [];
  // Twelve cards per row, wider than the frame on both formats: the drift never exposes a blank
  // edge between two cards, which read as a hole in the collection.
  const perRow = 12;

  for (let rowIndex = 0; rowIndex < 4; rowIndex += 1) {
    const row = create('div', 'mosaic__row');
    for (let column = 0; column < perRow; column += 1) {
      const reference = cards[(rowIndex * perRow + column) % cards.length];
      const colored = obtained.has(reference);
      const box = ctx.lib.build(reference, { className: colored ? 'is-obtained' : 'is-dimmed' });
      row.append(box);
    }
    rowsWrap.append(row);
    rows.push(row);
  }
  const back = sceneLayer(-1);
  back.append(rowsWrap);
  root.append(back);

  return {
    element: root,
    play: async () => {
      const vertical = state.format === 'vertical';
      rows.forEach((row, index) => {
        const direction = index % 2 === 0 ? -1 : 1;
        const distance = vertical ? 220 : 320;
        play(
          row,
          [
            { transform: `translate3d(${direction * distance}px, 0, 0)` },
            { transform: `translate3d(${direction * -distance}px, 0, 0)` },
          ],
          { duration: beat(def.beats), easing: 'linear' }
        );
        [...row.children].forEach((card, cardIndex) => {
          play(card, [{ opacity: 0 }, { opacity: 1 }], {
            duration: beat(0.6),
            delay: beat(0.05) * cardIndex + beat(0.1) * index,
          });
        });
      });
      await sleep(beat(def.beats));
    },
  };
}

/**
 * Sends a revealed full art card to the back of the pile, a little further away per rank.
 *
 * @param {HTMLElement} wrapper - Card wrapper of the full art layout.
 * @param {number} rank - 0 for the first card of the pile.
 * @returns {void}
 */
function stackCard(wrapper, rank) {
  // Every card leans to the other side of the previous one, a little further out: the edge of the
  // cards underneath stays visible, which is what makes the pile read as a stack of cards and not
  // as a single card.
  const side = rank % 2 === 0 ? 1 : -1;
  // The vertical cut shows the same cards in a frame half as wide: the pile spreads there at a
  // reduced scale, or the outer cards end up against the edge. The widest rank (the fifteenth card)
  // is the one that decides it: its offset plus the projected card still has to leave room for the
  // aura before the edge of the frame.
  const narrow = state.format === 'vertical' ? 0.68 : 1;
  wrapper.classList.add('is-stacked');
  wrapper.style.setProperty('--stack-x', `${side * (26 + rank * 18) * narrow}px`);
  wrapper.style.setProperty('--stack-y', `${-10 - rank * 4}px`);
  wrapper.style.setProperty('--stack-r', `${side * (2 + rank * 0.7)}deg`);
  wrapper.style.setProperty('--stack-s', String(Math.max(0.74, 1 - rank * 0.016)));
}

/**
 * The full arts: five legendary cards, then three mythic ones, each with its own reveal.
 *
 * @param {object} def - Scene definition of `animations.json`.
 * @param {object} ctx - Show context.
 * @returns {{element: HTMLElement, play: () => Promise<void>}} The scene.
 */
function buildFullarts(def, ctx) {
  const root = sceneRoot('fullart');
  const rays = create('div', 'fullart__rays');
  const stage = create('div', 'fullart__stage');
  const items = [];
  let revealIndex = 0;

  const groups = [
    { key: 'legendary', refs: ctx.assets.scenes.fullarts.legendary ?? [] },
    { key: 'mythic', refs: ctx.assets.scenes.fullarts.mythic ?? [] },
  ];

  groups.forEach((group) => {
    group.refs.forEach((reference) => {
      const card = ctx.lib.get(reference);
      const wrapper = create('div', `fullart__card fullart__card--${group.key}`);
      wrapper.dataset.reveal = REVEALS[revealIndex % REVEALS.length];
      wrapper.style.zIndex = String(revealIndex + 1);
      const print = ctx.lib.build(reference);
      wrapper.append(print);
      wrapper.append(create('div', 'fullart__foil'));
      wrapper.append(create('div', 'fullart__glare'));
      applyShine(wrapper, card);
      stage.append(wrapper);
      items.push({ wrapper, card, group: group.key, reveal: wrapper.dataset.reveal });
      revealIndex += 1;
    });
  });

  const back = sceneLayer(-1);
  back.append(rays);
  root.append(back, stage);

  return {
    element: root,
    play: async () => {
      const groupsTiming = [
        { items: items.filter((item) => item.group === 'legendary'), beats: def.legendaryBeats ?? 16 },
        { items: items.filter((item) => item.group === 'mythic'), beats: def.mythicBeats ?? 12 },
      ];

      let stack = 0;
      for (const group of groupsTiming) {
        const perCard = group.beats / Math.max(1, group.items.length);
        for (const item of group.items) {
          const color = item.group === 'mythic' ? '#f472b6' : '#ffd54a';
          item.wrapper.classList.add('is-revealed', `is-reveal-${item.reveal}`);
          burst(root, {
            count: 18,
            x: state.format === 'vertical' ? 540 : 960,
            y: state.format === 'vertical' ? 900 : 470,
            colors: [color, '#ffffff'],
            spread: 300,
            duration: beat(1.2),
            size: 8,
          });
          await sleep(beat(perCard) * 0.55);

          // The revealed card stays on the table while the next one lands on top of it: the pile
          // grows, so the scene reads as a sequence instead of one card replacing another.
          item.wrapper.classList.remove(`is-reveal-${item.reveal}`);
          stackCard(item.wrapper, stack);
          stack += 1;
          await sleep(beat(perCard) * 0.45);
        }
      }

      await Promise.all(
        items.map((item) =>
          play(item.wrapper, [{ opacity: 1 }, { opacity: 0 }], {
            duration: beat(1.4),
            easing: 'ease-in',
          })
        )
      );
      await sleep(beat(0.8));
    },
  };
}

/**
 * The friends list filling up.
 *
 * @param {object} def - Scene definition of `animations.json`.
 * @param {object} ctx - Show context.
 * @returns {{element: HTMLElement, play: () => Promise<void>}} The scene.
 */
function buildFriends(def, ctx) {
  const root = sceneRoot('friends');
  const panel = buildFriendsPanel(ctx);
  root.append(panel.root);
  return {
    element: root,
    play: async () => {
      const stagger = def.stagger ?? 0.5;
      panel.rows.forEach((row, index) => {
        play(
          row,
          [
            { opacity: 0, transform: 'translateX(-26px)' },
            { opacity: 1, transform: 'none' },
          ],
          {
            duration: beat(0.6),
            delay: beat(stagger) * index,
            easing: 'cubic-bezier(0.2, 0.9, 0.2, 1)',
          }
        );
      });
      await sleep(beat(stagger) * panel.rows.length + beat(0.8));
    },
  };
}

/**
 * The "like everyone" wave.
 *
 * @param {object} def - Scene definition of `animations.json`.
 * @param {object} ctx - Show context.
 * @returns {{element: HTMLElement, play: () => Promise<void>}} The scene.
 */
function buildLikes(def, ctx) {
  const root = sceneRoot('likes');
  const panel = buildFriendsPanel(ctx, true);
  root.append(panel.root);

  return {
    element: root,
    play: async () => {
      panel.button.classList.add('is-pressed');
      await sleep(beat(0.3));
      panel.button.classList.remove('is-pressed');

      panel.rows.forEach((row, index) => {
        window.setTimeout(() => {
          row.classList.add('is-liked');
          const heart = row.querySelector('.friend__heart');
          burst(row, {
            count: 7,
            x: row.offsetWidth - 48,
            y: row.offsetHeight / 2,
            colors: ['#f472b6', '#ffd54a', '#ffffff'],
            spread: 120,
            duration: beat(1.4),
            size: 16,
            shape: 'heart',
            text: '♥',
            gravity: -160,
          });
          if (heart) {
            play(
              heart,
              [{ transform: 'scale(1)' }, { transform: 'scale(1.9)' }, { transform: 'scale(1.2)' }],
              { duration: beat(0.5), easing: 'cubic-bezier(0.2, 1.4, 0.4, 1)' }
            );
          }
        }, beat(0.28) * index);
      });

      await sleep(beat(0.28) * panel.rows.length + beat(0.8));
      const count = panel.rows.length;
      panel.count.textContent = tr('friends.online', { count });
      panel.status.classList.add('is-shown');
      burst(root, {
        count: 34,
        x: state.format === 'vertical' ? 540 : 960,
        y: state.format === 'vertical' ? 620 : 360,
        colors: ['#f472b6', '#ffd54a'],
        spread: 420,
        duration: beat(1.6),
        size: 12,
        shape: 'heart',
        text: '♥',
        gravity: -120,
      });
    },
  };
}

/**
 * Builds one side of a trade, with its card.
 *
 * @param {object} ctx - Show context.
 * @param {string} label - Caption of the side.
 * @param {string} reference - Card reference of the side.
 * @returns {{panel: HTMLElement, slot: HTMLElement, card: HTMLElement}} The side.
 */
function buildTradeSide(ctx, label, reference) {
  const panel = create('div', 'trade__panel');
  panel.append(create('p', 'trade__owner', label));
  const slot = create('div', 'trade__slot');
  const card = ctx.lib.build(reference);
  slot.append(card);
  panel.append(slot);
  return { panel, slot, card };
}

/**
 * The exchange: a classic card first, then a full-art one.
 *
 * @param {object} def - Scene definition of `animations.json`.
 * @param {object} ctx - Show context.
 * @returns {{element: HTMLElement, play: () => Promise<void>}} The scene.
 */
function buildTrade(def, ctx) {
  const root = sceneRoot('trade');
  const body = create('div', 'trade__body');
  const stamp = create('p', 'trade__stamp', tr('trade.done'));
  root.append(body, stamp);

  /**
   * Draws one exchange and plays it.
   *
   * @param {'classic'|'fullart'} variant - Kind of card exchanged.
   * @param {number} duration - Length of the exchange, in milliseconds.
   * @returns {Promise<void>} Resolves when the exchange is stamped.
   */
  const exchange = async (variant, duration) => {
    root.classList.toggle('trade--fullart', variant === 'fullart');
    body.textContent = '';
    stamp.classList.remove('is-shown');
    const config = ctx.assets.scenes.trade[variant];
    const mine = buildTradeSide(ctx, tr('trade.mine'), config.mine);
    const theirs = buildTradeSide(ctx, tr('trade.theirs'), config.theirs);
    const swap = create('div', 'trade__swap');
    swap.append(create('span', 'trade__arrow', '⇄'));
    body.append(mine.panel, swap, theirs.panel);

    play(mine.card, [{ opacity: 0, transform: 'translateX(-260px) rotate(-14deg)' }, { opacity: 1, transform: 'none' }], {
      duration: beat(1),
      easing: 'cubic-bezier(0.2, 0.9, 0.2, 1)',
    });
    play(theirs.card, [{ opacity: 0, transform: 'translateX(260px) rotate(14deg)' }, { opacity: 1, transform: 'none' }], {
      duration: beat(1),
      easing: 'cubic-bezier(0.2, 0.9, 0.2, 1)',
    });
    play(swap, [{ opacity: 0, scale: '0.4' }, { opacity: 1, scale: '1' }], { duration: beat(0.8), delay: beat(0.4) });

    await sleep(duration * 0.42);
    // The cards travel TOWARDS each other: sideways when the two offers stand side by side, and
    // downwards/upwards when the vertical format stacks them. A horizontal flight in the vertical
    // layout threw both cards out of the stage, across the border of the panels.
    const vertical = state.format === 'vertical';
    const travel = variant === 'fullart' ? (vertical ? 300 : 430) : (vertical ? 240 : 330);
    const lean = variant === 'fullart' ? 10 : 8;
    const mineOffset = vertical ? `0, ${travel}px` : `${travel}px, -40px`;
    const theirsOffset = vertical ? `0, ${-travel}px` : `${-travel}px, -40px`;
    play(
      mine.card,
      [
        { transform: 'translate3d(0, 0, 0) rotate(0)' },
        { transform: `translate3d(${mineOffset}, 120px) rotate(${lean}deg) scale(1.06)` },
      ],
      { duration: beat(1.4), easing: 'cubic-bezier(0.4, 0, 0.2, 1)' }
    );
    play(
      theirs.card,
      [
        { transform: 'translate3d(0, 0, 0) rotate(0)' },
        { transform: `translate3d(${theirsOffset}, 120px) rotate(${-lean}deg) scale(1.06)` },
      ],
      { duration: beat(1.4), easing: 'cubic-bezier(0.4, 0, 0.2, 1)' }
    );
    await sleep(beat(1.2));
    stamp.classList.add('is-shown');
    shockwave(root, state.format === 'vertical' ? 540 : 960, state.format === 'vertical' ? 960 : 520, '#4ade80', 640);
    burst(root, {
      count: 26,
      x: state.format === 'vertical' ? 540 : 960,
      y: state.format === 'vertical' ? 960 : 520,
      colors: ['#4ade80', '#ffffff', '#ffd54a'],
      spread: 320,
      duration: beat(1.2),
    });
    await sleep(duration * 0.28);
  };

  return {
    element: root,
    play: async () => {
      await exchange('classic', beat(def.classicBeats ?? 9));
      stamp.classList.remove('is-shown');
      await exchange('fullart', beat(def.fullartBeats ?? 9));
    },
  };
}

/**
 * Builds one mineable block, its cracks and its pick.
 *
 * @param {object} ctx - Show context.
 * @param {string} blockPath - Project-relative path of the block texture.
 * @param {boolean} [small=false] - Smaller block for the 2x2 grid.
 * @returns {{root: HTMLElement, block: HTMLElement, crack: HTMLElement, pick: HTMLElement,
 *   art: string}} The block.
 */
function buildMineBlock(ctx, blockPath, small = false) {
  const art = ctx.asset(blockPath);
  const root = create('div', 'mine__block' + (small ? ' is-small' : ''));
  root.style.setProperty('--block-art', `url("${art}")`);
  const crack = create('div', 'mine__crack');
  const pick = create('img', 'mine__pick');
  pick.src = ctx.asset(ctx.assets.media.pick);
  pick.alt = '';
  pick.draggable = false;
  root.append(crack);
  if (!small) root.append(pick);
  return { root, block: root, crack, pick, art };
}

/**
 * Swings the pick and cracks one block.
 *
 * @param {object} ctx - Show context.
 * @param {object} entry - Return value of `buildMineBlock()`.
 * @param {number} hits - Number of hits before the break.
 * @param {number} duration - Time allowed for the whole break, in milliseconds.
 * @param {string} [lootKey='stone'] - Resource of the block, as named in `assets.media.dust`.
 * @param {HTMLElement} lootFeed - Single feed that receives every `+1` label of the scene.
 * @returns {Promise<void>} Resolves once the block is broken.
 */
/**
 * Drops one `+1 <resource>` label into the shared feed. The row rises and dissolves on its own;
 * the feed keeps the previous rows moving, so a burst of hits stays readable.
 *
 * @param {object} ctx - Show context.
 * @param {HTMLElement} entry - Block entry built by `buildMineBlock`.
 * @param {{icon: string, label: string}} resource - Dust of the block.
 * @param {HTMLElement} feed - Feed that receives every label of the scene.
 * @returns {void}
 */
function spawnLoot(ctx, entry, resource, feed) {
  const loot = create('div', 'mine__loot');
  const icon = create('img', 'mine__loot-icon');
  icon.src = ctx.asset(ctx.assets.media.dust[resource.icon]);
  icon.alt = '';
  const label = tr(resource.label);
  const count = 1 + (Math.round(entry.block.offsetWidth) % 3);
  loot.append(create('p', 'mine__loot-label', tr('mine.gain', { count, label })));
  loot.append(icon);
  feed.append(loot);
  // The row must stay readable at every tempo, so its duration comes from the beat itself. The
  // Web Animations API is used here instead of a CSS class: the row is created during the scene,
  // and the animation must start at the exact frame it enters the feed.
  const life = beat(2.2);
  animate(
    loot,
    [
      { opacity: 0, transform: 'translate(-50%, 24px)' },
      { opacity: 1, transform: 'translate(-50%, 0)', offset: 0.16 },
      { opacity: 1, transform: 'translate(-50%, -54px)', offset: 0.65 },
      { opacity: 0, transform: 'translate(-50%, -104px)' },
    ],
    { duration: life, easing: 'ease-out' }
  );
  window.setTimeout(() => loot.remove(), life + 200);
}

/**
 * Breaks one block, hit by hit, and feeds every `+1` it drops to the shared loot feed.
 *
 * @param {object} ctx - Show context.
 * @param {object} entry - Block entry built by `buildMineBlock`.
 * @param {number} hits - Number of hits before the block breaks.
 * @param {number} duration - Total duration of the sequence, in milliseconds.
 * @param {string} [lootKey='stone'] - Resource of the block, as named in `assets.media.dust`.
 * @param {HTMLElement} lootFeed - Single feed that receives every `+1` label of the scene.
 * @returns {Promise<void>} Resolves once the block is broken.
 */
async function mineBlock(ctx, entry, hits, duration, lootKey = 'stone', lootFeed = null) {
  const perHit = duration / (hits + 2);
  const cracks = ctx.assets.media.cracks ?? [];
  const lootTable = {
    stone: { icon: 'stone', label: 'mine.resource.stone_dust' },
    sculk: { icon: 'sculk', label: 'mine.resource.sculk_dust' },
    glowstone: { icon: 'glowstone', label: 'mine.resource.glowstone_dust' },
    void: { icon: 'void', label: 'mine.resource.void_dust' },
    ultima: { icon: 'ultima', label: 'mine.resource.ultima' },
  };
  const resource = lootTable[lootKey] ?? lootTable.stone;
  const feed = lootFeed ?? entry.block.parentElement;

  for (let hit = 0; hit < hits; hit += 1) {
    entry.pick.classList.remove('is-swinging');
    void entry.pick.offsetWidth;
    entry.pick.classList.add('is-swinging');
    await sleep(perHit * 0.4);
    entry.block.classList.remove('is-hit');
    void entry.block.offsetWidth;
    entry.block.classList.add('is-hit');
    // The ten crack textures are spread over the hits, so every block shows the full progression
    // instead of stopping on the third stage.
    const crackIndex = hits > 1
      ? Math.round((hit / (hits - 1)) * (cracks.length - 1))
      : 0;
    entry.crack.style.backgroundImage = `url("${ctx.asset(cracks[crackIndex])}")`;
    entry.crack.style.opacity = String(0.35 + (hit / hits) * 0.6);
    burst(entry.block, {
      count: 8,
      x: entry.block.offsetWidth / 2,
      y: entry.block.offsetHeight / 2,
      colors: ['#8d8d98', '#5b5b66', '#c9c9d2'],
      spread: 130,
      duration: perHit * 0.8,
      size: 7,
      gravity: 180,
    });
    spawnLoot(ctx, entry, resource, feed);
    await sleep(perHit * 0.6);
  }

  entry.block.classList.add('is-broken');
  entry.pick.style.opacity = '0';
  burst(entry.block, {
    count: 22,
    x: entry.block.offsetWidth / 2,
    y: entry.block.offsetHeight / 2,
    colors: ['#8d8d98', '#5b5b66', '#ffd54a'],
    spread: 260,
    duration: beat(1.1),
    size: 9,
  });
  await sleep(perHit * 1.6);
}

/**
 * The single block of the mining scene.
 *
 * @param {object} def - Scene definition of `animations.json`.
 * @param {object} ctx - Show context.
 * @returns {{element: HTMLElement, play: () => Promise<void>}} The scene.
 */
function buildMine(def, ctx) {
  const root = sceneRoot('mine');
  const stage = create('div', 'mine__stage');
  const entry = buildMineBlock(ctx, ctx.assets.media.blocks.stone);
  const feed = create('div', 'mine__loot-feed');
  stage.append(entry.root);
  root.append(stage, feed);

  return {
    element: root,
    play: async () => {
      entry.pick.style.opacity = '1';
      await sleep(beat(0.6));
      await mineBlock(ctx, entry, def.hits ?? 4, beat(def.hits ?? 4) * 1.9, 'stone', feed);
      // Keep the last `+1` on screen after the block disappears; otherwise the scene cuts away
      // during the loot animation and the label is never readable.
      await sleep(beat(2));
    },
  };
}

/**
 * The 2x2 grid of blocks.
 *
 * @param {object} def - Scene definition of `animations.json`.
 * @param {object} ctx - Show context.
 * @returns {{element: HTMLElement, play: () => Promise<void>}} The scene.
 */
function buildMineGrid(def, ctx) {
  const root = sceneRoot('mine mine--grid');
  const stage = create('div', 'mine__stage');
  const grid = create('div', 'mine__grid');
  const feed = create('div', 'mine__loot-feed');
  const paths = [
    [ctx.assets.media.blocks.deepslate, 'sculk'],
    [ctx.assets.media.blocks.endstone, 'void'],
    [ctx.assets.media.blocks.blackstone, 'glowstone'],
    [ctx.assets.media.blocks.obsidian, 'ultima'],
  ];
  const entries = paths.map(([path, lootKey]) => {
    const entry = buildMineBlock(ctx, path, true);
    entry.lootKey = lootKey;
    grid.append(entry.root);
    return entry;
  });
  stage.append(grid);
  root.append(stage, feed);

  return {
    element: root,
    play: async () => {
      const perBlock = beat(def.beats) / Math.max(1, entries.length);
      for (const entry of entries) {
        await mineBlock(ctx, entry, def.hits ?? 3, perBlock, entry.lootKey, feed);
      }
      await sleep(beat(1.5));
      await sleep(beat(1));
    },
  };
}

/**
 * The wheel that grants one super rare card.
 *
 * @param {object} def - Scene definition of `animations.json`.
 * @param {object} ctx - Show context.
 * @returns {{element: HTMLElement, play: () => Promise<void>}} The scene.
 */
function buildRoulette(def, ctx) {
  const root = sceneRoot('roulette');
  const windowEl = create('div', 'roulette__window');
  const marker = create('span', 'roulette__marker');
  const markerBottom = create('span', 'roulette__marker roulette__marker--bottom');
  const strip = create('ul', 'roulette__strip');
  const references = ctx.assets.scenes.roulette.cards ?? [];
  // A reel has to be longer than its window: the winner sits in the middle copy so there are cards
  // on both sides once the strip stops, instead of an empty half of the window.
  const reel = [...references, ...references, ...references];
  const cells = reel.map((reference) => {
    const cell = create('li', 'roulette__cell');
    cell.append(ctx.lib.build(reference));
    strip.append(cell);
    return cell;
  });
  const win = create('p', 'roulette__win', tr('roulette.win'));
  windowEl.append(marker, markerBottom, strip, win);
  root.append(windowEl);

  return {
    element: root,
    play: async () => {
      // The reel is measured, not assumed: the window and the cells are sized by the stylesheet
      // (they differ between the two formats), and a hard-coded width would stop the winner
      // under the marker by a few pixels as soon as one of them changed.
      const cardWidth = cells[0]?.offsetWidth || (state.format === 'vertical' ? 170 : 200);
      const step = cardWidth + 16;
      const windowWidth = windowEl.clientWidth;
      const winner = ctx.assets.scenes.roulette.winner;
      const winnerIndex = references.length + Math.max(0, references.indexOf(winner));
      const target = windowWidth / 2 - (winnerIndex * step + cardWidth / 2);

      play(
        strip,
        [
          { transform: 'translate3d(0, -50%, 0)' },
          { transform: `translate3d(${target + 46}px, -50%, 0)`, offset: 0.86 },
          { transform: `translate3d(${target}px, -50%, 0)` },
        ],
        { duration: beat(def.spinBeats ?? 10), easing: 'cubic-bezier(0.08, 0.7, 0.08, 1)' }
      );

      await sleep(beat(def.spinBeats ?? 10));
      const cell = cells[winnerIndex];
      cell?.classList.add('is-winner');
      play(cell, [{ transform: 'scale(1)' }, { transform: 'scale(1.14)' }, { transform: 'scale(1.06)' }], {
        duration: beat(0.8),
        easing: 'cubic-bezier(0.2, 1.3, 0.4, 1)',
      });
      win.classList.add('is-shown');
      shockwave(windowEl, windowWidth / 2, 165, '#a855f7', 620);
      burst(windowEl, {
        count: 34,
        x: windowWidth / 2,
        y: 165,
        colors: ['#a855f7', '#f472b6', '#ffffff'],
        spread: 340,
        duration: beat(1.4),
      });
      flash(ctx.flashLayer, 0.55, beat(1));
      await sleep(beat(1.6));
    },
  };
}

/**
 * The succession of profile cards.
 *
 * @param {object} def - Scene definition of `animations.json`.
 * @param {object} ctx - Show context.
 * @returns {{element: HTMLElement, play: () => Promise<void>}} The scene.
 */
function buildProfiles(def, ctx) {
  const root = sceneRoot('profiles');
  const stage = create('div', 'profiles__stage');
  const renders = [];
  const cards = ctx.assets.profiles.map((profile, index) => {
    const nickname = ctx.assets.nicknames[profile.nicknameIndex % ctx.assets.nicknames.length];
    const { shot, ready } = buildRealProfile(ctx, profile, nickname, index);
    renders.push(ready);
    stage.append(shot);
    return shot;
  });
  root.append(stage);

  return {
    element: root,
    // The six shadow-DOM cards are rendered during the preload: their stylesheet, their fonts and
    // the blurred background of their artwork are cached before the first profile beat.
    prepare: Promise.all(renders),
    play: async () => {
      const perProfile = beat(def.perProfileBeats ?? 3);
      for (let index = 0; index < cards.length; index += 1) {
        const card = cards[index];
        if (index > 0) {
          play(
            cards[index - 1],
            [
              { transform: 'translate3d(0, 0, 0) scale(1)', opacity: 1 },
              { transform: 'translate3d(0, -54px, -120px) scale(0.82)', opacity: 0.3 },
            ],
            { duration: beat(0.8), easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }
          );
        }
        play(
          card,
          [
            // The card rises from the lower edge of the frame: a short travel keeps it fully on
            // the stage at the first frames, where the crane is still pulled back.
            { opacity: 0, transform: 'translate3d(0, 52px, 110px) rotateX(-14deg) scale(0.92)' },
            { opacity: 1, transform: 'none' },
          ],
          { duration: beat(1), easing: 'cubic-bezier(0.2, 0.9, 0.2, 1)' }
        );
        burst(root, {
          count: 12,
          x: state.format === 'vertical' ? 540 : 960,
          y: state.format === 'vertical' ? 1200 : 640,
          colors: ['#7fa5ff', '#ffd54a', '#f472b6'],
          spread: 240,
          duration: beat(1),
          size: 7,
        });
        await sleep(perProfile);
      }
      // The last card leaves first, uncovering the previous one instead of fading the whole
      // stack at once. The viewer gets one more beat on a known profile before the scene ends.
      if (cards.length > 1) {
        const last = cards[cards.length - 1];
        const behind = cards[cards.length - 2];
        play(
          last,
          [
            { opacity: 1, transform: 'none' },
            // The pile stays inside the frame: a card leaving upward stops at the edge instead of
            // being sliced by it while the crane is still pulled back.
            { opacity: 0, transform: 'translate3d(0, -72px, 180px) scale(0.82)' },
          ],
          { duration: beat(1), easing: 'cubic-bezier(0.4, 0, 0.8, 0.4)' }
        );
        play(
          behind,
          [
            { opacity: 0.3, transform: 'translate3d(0, -54px, -120px) scale(0.82)' },
            { opacity: 1, transform: 'none' },
          ],
          { duration: beat(1), easing: 'cubic-bezier(0.2, 0.9, 0.2, 1)' }
        );
        await sleep(beat(1));
      }
      // One keyframe per card: the fade starts at the opacity each card has (the last one is already
      // gone), where starting every animation at 1 made the whole pile flash back for a beat.
      await Promise.all(
        cards.map((card) => play(card, [{ opacity: 0 }], { duration: beat(0.7), easing: 'ease-in' }))
      );
    },
  };
}

/**
 * The quests and the wandering trader: three objectives complete, the trader arrives and one
 * reward is bought with Sparks.
 *
 * @param {object} def - Scene definition of `animations.json`.
 * @param {object} ctx - Show context.
 * @returns {{element: HTMLElement, play: () => Promise<void>}} The scene.
 */
function buildQuests(def, ctx) {
  const data = ctx.assets.scenes.quests ?? { quests: [], merchant: { offers: [] } };
  const dust = ctx.assets.media.dust ?? {};
  const dustLabel = (key) =>
    tr(key === 'ultima' ? 'mine.resource.ultima' : `mine.resource.${key ?? 'stone'}_dust`);
  const root = sceneRoot('quests');
  const heading = create('h2', 'quests__title', tr('quests.heading'));

  const body = create('div', 'quests__body');
  const list = create('div', 'quests__list');
  const rows = (data.quests ?? []).map((quest) => {
    const row = create('div', 'quest-row');
    const iconBox = create('div', 'quest-row__icon');
    const icon = create('img', 'quest-row__icon-art');
    icon.src = ctx.asset(ctx.assets.media.questMap);
    icon.alt = '';
    iconBox.append(icon);

    const copy = create('div', 'quest-row__copy');
    copy.append(create('p', 'quest-row__title', tr(quest.titleKey)));
    copy.append(create('p', 'quest-row__desc', tr(quest.descKey)));

    const progress = create('div', 'quest-row__progress');
    const fill = create('span', 'quest-row__fill');
    progress.append(fill);
    const count = create('span', 'quest-row__count');
    const countValue = create('span', 'quest-row__count-value', '0');
    count.append(countValue, document.createTextNode(` / ${quest.goal}`));

    const reward = create('div', 'quest-row__reward');
    const rewardIcon = create('img', 'quest-row__reward-icon');
    rewardIcon.src = ctx.asset(dust[quest.reward?.dust] ?? dust.stone);
    rewardIcon.alt = '';
    reward.append(rewardIcon, create('span', 'quest-row__reward-label', tr('quests.reward', {
      count: quest.reward?.count ?? 0,
      label: dustLabel(quest.reward?.dust),
    })));

    const check = create('span', 'quest-row__check', '✓');
    row.append(iconBox, copy, progress, count, reward, check);
    list.append(row);
    return { row, fill, count, countValue, check, goal: quest.goal ?? 1 };
  });

  const merchant = create('aside', 'merchant');
  const backdrop = create('img', 'merchant__backdrop');
  backdrop.src = ctx.asset(ctx.assets.media.merchant);
  backdrop.alt = '';
  merchant.append(backdrop, create('div', 'merchant__shade'));

  const merchantHead = create('div', 'merchant__head');
  const face = create('img', 'merchant__face');
  face.src = ctx.asset(ctx.assets.media.merchantFace);
  face.alt = '';
  merchantHead.append(face);

  const wallet = create('div', 'merchant__wallet');
  const spark = create('img', 'merchant__spark');
  spark.src = ctx.asset(ctx.assets.media.sparks);
  spark.alt = '';
  const balanceValue = create('span', 'merchant__balance-value', formatNumber(data.merchant?.balance ?? 0));
  wallet.append(create('span', 'merchant__balance-label', tr('merchant.balance')), spark, balanceValue);

  const offers = (data.merchant?.offers ?? []).map((offer) => {
    const row = create('div', 'merchant__offer');
    const art = create('div', 'merchant__offer-art');
    let name = '';
    if (offer.card) {
      art.append(ctx.lib.build(offer.card, { className: 'merchant__card' }));
      name = ctx.lib.get(offer.card)?.getName(state.lang) ?? tr('merchant.card');
    } else {
      const icon = create('img', 'merchant__offer-icon');
      icon.src = ctx.asset(dust[offer.dust] ?? dust.stone);
      icon.alt = '';
      art.append(icon);
      name = dustLabel(offer.dust);
    }
    const info = create('div', 'merchant__offer-info');
    info.append(create('p', 'merchant__offer-name', name));
    info.append(create('p', 'merchant__offer-price', `${formatNumber(offer.price)} SPARKS`));
    const buy = create('span', 'merchant__offer-buy', tr('merchant.buy'));
    row.append(art, info, buy);
    merchant.append(row);
    return { row, buy, price: offer.price ?? 0 };
  });

  merchant.append(merchantHead, wallet);
  body.append(list, merchant);
  root.append(heading, body);

  return {
    element: root,
    play: async () => {
      heading.classList.add('is-shown');
      rows.forEach((entry, index) => {
        play(
          entry.row,
          [
            { opacity: 0, transform: 'translateX(-18px)' },
            { opacity: 1, transform: 'none' },
          ],
          { duration: beat(0.7), delay: beat(0.24) * index, easing: 'cubic-bezier(0.2, 0.9, 0.2, 1)' }
        );
      });
      await sleep(beat(1.4));

      for (const entry of rows) {
        play(entry.fill, [{ width: '0%' }, { width: '100%' }], {
          duration: beat(1.5),
          delay: beat(0.18) * rows.indexOf(entry),
          easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
        });
        countTo(entry.countValue, 0, entry.goal, beat(1.5));
        await sleep(beat(0.35));
        entry.check.classList.add('is-shown');
        burst(entry.row, {
          count: 8,
          x: entry.row.offsetWidth - 24,
          y: 28,
          colors: ['#4ade80', '#ffffff'],
          spread: 100,
          duration: beat(0.8),
          size: 6,
        });
      }
      // Keep the booster face-on long enough to read before it flies at the camera.
      await sleep(beat(2.4));

      play(
        merchant,
        [
          { opacity: 0, transform: 'translate3d(90px, 0, 0) rotateY(-12deg)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: beat(1.1), easing: 'cubic-bezier(0.2, 0.9, 0.2, 1)' }
      );
      await sleep(beat(1.3));
      offers.forEach((offer, index) => {
        play(
          offer.row,
          [{ opacity: 0, transform: 'translateY(22px)' }, { opacity: 1, transform: 'none' }],
          { duration: beat(0.6), delay: beat(0.22) * index, easing: 'cubic-bezier(0.2, 0.9, 0.2, 1)' }
        );
      });
      await sleep(beat(1.6));

      const first = offers[0];
      if (first) {
        first.buy.classList.add('is-pressed');
        await sleep(beat(0.4));
        first.buy.classList.remove('is-pressed');
        first.row.classList.add('is-bought');
        first.buy.textContent = tr('merchant.bought');
        const balance = data.merchant?.balance ?? 0;
        countTo(balanceValue, balance, Math.max(0, balance - first.price), beat(1.4));
        burst(merchant, {
          count: 22,
          x: merchant.offsetWidth - 80,
          y: merchant.offsetHeight - 48,
          colors: ['#ffd54a', '#ffffff', '#7fa5ff'],
          spread: 260,
          duration: beat(1.2),
          size: 8,
        });
      }
      await sleep(beat(2.4));
    },
  };
}

/**
 * The shop: an A2 booster is bought with Sparks.
 *
 * @param {object} def - Scene definition of `animations.json`.
 * @param {object} ctx - Show context.
 * @returns {{element: HTMLElement, play: () => Promise<void>}} The scene.
 */
function buildShop(def, ctx) {
  const root = sceneRoot('shop');
  const shop = ctx.assets.scenes.shop;
  const body = create('div', 'shop__body');
  const product = create('div', 'shop__product');
  const art = create('div', 'shop__art');
  const pack = buildPack(ctx, ctx.assets.sets.A2.art, 'demo-pack--large');
  pack.style.transform = 'rotateY(-16deg) rotateX(4deg)';
  art.append(pack);
  product.append(art);

  const panel = create('div', 'shop__panel');
  panel.append(create('p', 'shop__balance-label', tr('shop.balance')));
  const balance = create('p', 'shop__balance');
  const icon = create('img', 'shop__balance-icon');
  icon.src = ctx.asset(ctx.assets.media.sparks);
  icon.alt = '';
  const balanceValue = create('span', 'shop__balance-value', formatNumber(shop.balance));
  balance.append(icon, balanceValue);
  const price = create('p', 'shop__price', `${formatNumber(shop.price)} SPARKS`);
  const buy = create('button', 'shop__buy', tr('shop.buy'));
  buy.type = 'button';
  const owned = create('p', 'shop__owned', tr('shop.owned'));
  panel.append(balance, price, buy, owned);
  body.append(product, panel);
  root.append(body);

  return {
    element: root,
    play: async () => {
      await countTo(balanceValue, shop.balance, shop.balance - shop.price, beat(2.4));
      buy.classList.add('is-pressed');
      burst(panel, {
        count: 20,
        x: panel.offsetWidth / 2,
        y: panel.offsetHeight - 60,
        colors: ['#ffd54a', '#ffffff'],
        spread: 220,
        duration: beat(1.1),
        size: 9,
      });
      await sleep(beat(0.5));
      buy.classList.remove('is-pressed');
      owned.classList.add('is-shown');
      play(
        pack,
        [
          { transform: 'rotateY(-16deg) rotateX(4deg) scale(1)' },
          { transform: 'rotateY(4deg) rotateX(0) scale(1.08)' },
          { transform: 'rotateY(-16deg) rotateX(4deg) scale(1)' },
        ],
        { duration: beat(1.2), easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }
      );
      flash(ctx.flashLayer, 0.4, beat(0.9));
      await sleep(beat(2));
    },
  };
}

/**
 * The three A2 openings: each pack deals four commons in the classic print, then the full art of
 * its rarity (2, 3, then the 4 saved for the finale). Every card joins the pile under the next one.
 *
 * @param {object} def - Scene definition of `animations.json`.
 * @param {object} ctx - Show context.
 * @returns {{element: HTMLElement, play: () => Promise<void>}} The scene.
 */
function buildA2(def, ctx) {
  const root = sceneRoot('a2');
  const stage = create('div', 'a2__stage');
  const packStage = create('div', 'a2__pack');
  const mount = create('div', 'a2__pack-mount');
  const pack = buildPack(ctx, ctx.assets.sets.A2.art, 'demo-pack--large');
  mount.append(pack);
  packStage.append(mount);
  const counter = create('p', 'a2__count');
  const centerX = state.format === 'vertical' ? 540 : 960;
  const centerY = state.format === 'vertical' ? 900 : 500;

  // The cards join the stage in the order they are dealt. They are all positioned, so the later a
  // card is in the document, the higher it paints: the pile needs no z-index of its own.
  const packs = (ctx.assets.scenes.a2?.packs ?? []).map((entry, packIndex) => {
    const commons = (entry.commons ?? []).map((reference) => {
      const wrapper = create('div', 'a2__card a2__card--classic');
      wrapper.append(ctx.lib.build(reference));
      stage.append(wrapper);
      return wrapper;
    });

    const reference = entry.fullart;
    const card = ctx.lib.get(reference);
    const color = RARITY_COLORS[card.rarity] ?? RARITY_COLORS[1];
    const wrapper = create('div', 'fullart__card a2__card');
    wrapper.dataset.reveal = REVEALS[(packIndex + 1) % REVEALS.length];
    wrapper.dataset.rarity = String(card.rarity);
    wrapper.style.setProperty('--rarity-color', color);
    wrapper.append(ctx.lib.build(reference));
    wrapper.append(create('div', 'fullart__foil'), create('div', 'fullart__glare'));
    applyShine(wrapper, card);
    stage.append(wrapper);
    return { commons, fullart: { wrapper, card, color } };
  });

  root.append(stage, packStage, counter);

  let renderer = null;
  const prepare = prepare3DPack(ctx, mount, pack, 'A2', 'demo-a2').then((ready) => {
    renderer = ready;
  });

  /**
   * Brings one pack to the camera and bursts it.
   *
   * The renderer is reset face-on first: the drift left by the previous pack is discarded, so each
   * round reads as a NEW pack instead of the same one still spinning.
   *
   * @returns {Promise<void>} Resolves once the pack left the frame.
   */
  const presentPack = async () => {
    if (renderer) {
      if (renderer.pivot) renderer.pivot.rotation.y = 0;
      renderer.start();
      renderer.spinVelocity = -0.01;
    }
    await play(
      packStage,
      [
        { opacity: 0, transform: 'translateY(90px) scale(0.72)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: beat(0.7), easing: 'cubic-bezier(0.2, 0.9, 0.2, 1)' }
    );
    if (renderer) renderer.spinVelocity = 0.3;
    await sleep(beat(0.6));

    burst(root, {
      count: 22,
      x: centerX,
      y: centerY,
      colors: ['#ff6b35', '#ffd54a', '#ffffff'],
      spread: 300,
      duration: beat(1.1),
      size: 9,
    });
    flash(ctx.flashLayer, 0.6, beat(0.8));
    renderer?.stop();
    await play(
      packStage,
      [
        { opacity: 1, transform: 'none' },
        { opacity: 0, transform: 'translateY(-240px) rotateY(60deg) scale(0.5)' },
      ],
      { duration: beat(0.7), easing: 'cubic-bezier(0.5, 0, 0.9, 0.4)' }
    );
  };

  return {
    element: root,
    prepare,
    dispose: () => {
      renderer?.stop();
      renderer?.dispose();
      renderer = null;
    },
    play: async () => {
      // Rank of the card inside the pile: the commons of every pack count, so a full art always
      // lands on top of the four cards it came with.
      let rank = 0;
      for (const [index, entry] of packs.entries()) {
        counter.textContent = tr('a2.opening', { index: index + 1, total: packs.length });
        counter.classList.add('is-shown');
        await presentPack();

        // The four commons are dealt first, one beat apart: they are the filler of the pack, and
        // they stay in the classic print of the game.
        for (const common of entry.commons) {
          common.classList.add('is-dealt');
          await sleep(beat(0.45));
          stackCard(common, rank);
          rank += 1;
          await sleep(beat(0.12));
        }

        // Then the card the pack was worth opening: the full art of its rarity.
        const item = entry.fullart;
        item.wrapper.classList.add('is-revealed', `is-reveal-${item.wrapper.dataset.reveal}`);
        burst(root, {
          count: 26,
          x: centerX,
          y: centerY,
          colors: [item.color, '#ffffff'],
          spread: 360,
          duration: beat(1.2),
          size: 10,
        });
        if (item.card.rarity >= 4) {
          // The rarity 4 is the reason the pack was worth opening: it gets the wave and the light.
          shockwave(root, centerX, centerY, item.color, 900);
          flash(ctx.flashLayer, 0.75, beat(1.2));
        }
        await sleep(beat(def.revealBeats ?? 2.4));

        // The full art lands on top of the four cards it came with: the pile keeps the whole pack,
        // and the next one is dealt above it instead of replacing it.
        item.wrapper.classList.remove(`is-reveal-${item.wrapper.dataset.reveal}`);
        stackCard(item.wrapper, rank);
        rank += 1;
        await sleep(beat(0.3));
      }
      // The fifteen cards stay piled up for a last look: the scene ends on what the three packs
      // gave, not on a single card, before the end card takes over. The hold is long enough for the
      // portrait cut, where the pile is the tightest, to be read without rushing.
      await sleep(beat(6));
      counter.classList.remove('is-shown');
    },
  };
}

/**
 * The end card: the name of the game and its author.
 *
 * @param {object} def - Scene definition of `animations.json`.
 * @param {object} ctx - Show context.
 * @returns {{element: HTMLElement, play: () => Promise<void>}} The scene.
 */
function buildOutro(def, ctx) {
  const root = sceneRoot('outro');
  const field = create('div', 'outro__field');
  const rows = [create('div', 'outro__row'), create('div', 'outro__row')];
  field.append(...rows);
  ctx.phasePool.forEach((card, index) => rows[index % 2].append(card));

  const title = create('h2', 'outro__title', tr('outro.title'));
  const by = create('p', 'outro__by', tr('outro.by'));
  const fade = create('div', 'outro__fade');
  root.append(field, title, by, fade);

  return {
    element: root,
    play: async () => {
      // The pool is shared by every text phase: take the prints back into the outro rows, exactly
      // like a phase does, or the field stays empty after the last shop caption.
      ctx.phasePool.forEach((card, index) => rows[index % rows.length].append(card));
      await sleep(beat(0.8));
      title.classList.add('is-shown');
      burst(root, {
        count: 30,
        x: state.format === 'vertical' ? 540 : 960,
        y: state.format === 'vertical' ? 860 : 450,
        colors: ['#d9dde8', '#7fa5ff', '#ffffff'],
        spread: 420,
        duration: beat(1.8),
        size: 8,
      });
      // Three lines in the same slot: the offer, the site, then the author. The text changes only
      // once the previous line has faded, so two sentences are never read at the same time.
      await sleep(beat(1.2));
      by.textContent = tr('outro.free');
      by.classList.add('is-shown');
      for (const key of ['outro.site', 'outro.by']) {
        await sleep(beat(2.2));
        await play(by, [{ opacity: 1 }, { opacity: 0 }], { duration: beat(0.35), easing: 'ease-in' });
        by.textContent = tr(key);
        play(by, [{ opacity: 0 }, { opacity: 1 }], { duration: beat(0.45) });
      }
      // Hold the end card long enough to breathe before the slow, final fade.
      await sleep(beat(3.5));
      // The film ends on black, not on the end card: the fade is the last thing the viewer sees.
      fade.classList.add('is-shown');
      await sleep(beat(9));
    },
  };
}

/** Builders of the show, by scene id. A missing id is a programming error, not a silent skip. */
const BUILDERS = {
  intro: buildPhase,
  booster: buildBooster,
  multi: buildMulti,
  collect: buildPhase,
  mosaic: buildMosaic,
  fullarts: buildFullarts,
  social: buildPhase,
  friends: buildFriends,
  likes: buildLikes,
  trade: buildTrade,
  mineIntro: buildPhase,
  mine: buildMine,
  mineGrid: buildMineGrid,
  luck: buildPhase,
  roulette: buildRoulette,
  quests: buildQuests,
  profileIntro: buildPhase,
  profiles: buildProfiles,
  shopIntro: buildPhase,
  shop: buildShop,
  a2pack: buildA2,
  outro: buildOutro,
};

/**
 * Builds one scene of the timeline.
 *
 * @param {object} def - Scene definition of `animations.json`.
 * @param {object} ctx - Show context.
 * @returns {{element: HTMLElement, play: () => Promise<void>}} The built scene.
 */
export function buildScene(def, ctx) {
  const builder = BUILDERS[def.id];
  if (!builder) {
    throw new Error(`No builder for the scene "${def.id}".`);
  }
  const scene = builder(def, ctx);
  scene.element.dataset.sceneId = def.id;
  return scene;
}

/**
 * Notification coalescing tests.
 *
 * Several notifications of the same kind usually arrive in one burst (the titles of one
 * evaluation, the quests that open on the same day). The queue must fold them into ONE readable
 * line: a group of titles or quests gets its own wording, and a run of level-ups keeps the highest
 * level reached. The tests run without a DOM: the display step is stubbed, only the queue is
 * observed.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NotificationCenter,
  NOTIFICATION_TYPES,
  NOTIFICATION_VARIANTS,
} from '../../js/UI/components/NotificationCenter.js';

/**
 * Builds a center whose queue can be inspected without a DOM.
 *
 * @returns {NotificationCenter} The center.
 */
function createCenter() {
  const center = new NotificationCenter();
  center.showNext = () => {};
  return center;
}

const TITLES = {
  key: 'title',
  title: (count) => `Plusieurs titres (${count})`,
};

test('several titles arriving together become one line', () => {
  const center = createCenter();
  center.push({ type: NOTIFICATION_TYPES.TITLE, title: 'Titre A', merge: TITLES });
  center.push({ type: NOTIFICATION_TYPES.TITLE, title: 'Titre B', merge: TITLES });
  center.push({ type: NOTIFICATION_TYPES.TITLE, title: 'Titre C', merge: TITLES });

  assert.equal(center.getQueuedCount(), 1);
  assert.equal(center.queue[0].count, 3);
  assert.equal(center.queue[0].title, 'Plusieurs titres (3)');
});

test('a level-up group keeps the latest, highest level', () => {
  const center = createCenter();
  const level = {
    type: NOTIFICATION_TYPES.EXPERIENCE,
    variant: NOTIFICATION_VARIANTS.LEVEL,
    title: 'Niveau 4 atteint',
    merge: { key: 'experience.level' },
  };
  center.push(level);
  center.push({ ...level, title: 'Niveau 5 atteint' });

  assert.equal(center.getQueuedCount(), 1);
  assert.equal(center.queue[0].title, 'Niveau 5 atteint');
});

test('different groups and ungrouped items stay apart', () => {
  const center = createCenter();
  center.push({ type: NOTIFICATION_TYPES.TITLE, title: 'Titre', merge: TITLES });
  center.push({
    type: NOTIFICATION_TYPES.QUEST,
    title: 'Quête',
    merge: { key: 'quest.available', title: (count) => `Plusieurs quêtes (${count})` },
  });
  center.push({ type: NOTIFICATION_TYPES.EXPERIENCE, title: 'Booster ouvert' });

  assert.equal(center.getQueuedCount(), 3);
  assert.equal(center.queue[0].title, 'Titre');
  assert.equal(center.queue[1].title, 'Quête');
  assert.equal(center.queue[2].title, 'Booster ouvert');
});

test('an item without a merge key never folds into another one', () => {
  const center = createCenter();
  center.push({ type: NOTIFICATION_TYPES.TITLE, title: 'Titre A' });
  center.push({ type: NOTIFICATION_TYPES.TITLE, title: 'Titre B', merge: TITLES });

  assert.equal(center.getQueuedCount(), 2);
  assert.equal(center.queue[1].title, 'Titre B');
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { TaskQueue } from '../script/core/task-queue.js';

test('runs one job at a time, in order', async () => {
  const queue = new TaskQueue({ concurrency: 1 });
  const events = [];
  let releaseFirst;

  const first = queue.enqueue({
    id: 'first',
    label: 'first.mp4',
    run: async () => {
      events.push('first:start');
      await new Promise((resolve) => {
        releaseFirst = resolve;
      });
      events.push('first:end');
    },
  });

  const second = queue.enqueue({
    id: 'second',
    label: 'second.mp4',
    run: async () => {
      events.push('second:start');
      events.push('second:end');
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(events, ['first:start']);
  assert.equal(queue.busy, true);
  assert.equal(queue.pendingCount, 1);

  releaseFirst();
  await Promise.all([first, second]);

  assert.deepEqual(events, ['first:start', 'first:end', 'second:start', 'second:end']);
  assert.equal(queue.busy, false);
});

test('a failing job rejects but does not block the next one', async () => {
  const queue = new TaskQueue({ concurrency: 1 });
  const events = [];

  const failing = queue.enqueue({
    id: 'failing',
    label: 'bad.mp4',
    run: async () => {
      events.push('failing');
      throw new Error('boom');
    },
  });

  const next = queue.enqueue({
    id: 'next',
    label: 'next.mp4',
    run: async () => {
      events.push('next');
    },
  });

  await assert.rejects(failing, /boom/);
  await next;

  assert.deepEqual(events, ['failing', 'next']);
  assert.equal(queue.busy, false);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createSerialQueue } from '../src/lib/async/serialQueue';

test('serial queue preserves call order', async () => {
  const queue = createSerialQueue();
  const order: number[] = [];
  const first = queue.run(async () => {
    await Promise.resolve();
    order.push(1);
    return 'one';
  });
  const second = queue.run(async () => {
    order.push(2);
    return 'two';
  });
  assert.deepEqual(await Promise.all([first, second]), ['one', 'two']);
  assert.deepEqual(order, [1, 2]);
});

test('a rejected task does not block later tasks', async () => {
  const queue = createSerialQueue();
  const failed = queue.run(async () => {
    throw new Error('first failed');
  });
  const next = queue.run(async () => 'next');
  await assert.rejects(failed, /first failed/);
  assert.equal(await next, 'next');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createSerialQueue } from '../extension/service-worker.mjs';

test('一次 badge 任务失败不会锁死后续队列', async () => {
  const enqueue = createSerialQueue();
  const calls = [];
  await assert.rejects(enqueue(async () => { calls.push('first'); throw new Error('badge fail'); }));
  await enqueue(async () => { calls.push('second'); });
  assert.deepEqual(calls, ['first', 'second']);
});

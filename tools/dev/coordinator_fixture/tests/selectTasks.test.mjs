// Worker-owned smoke test; this is not independent verification authority.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const loaded = await import('../src/selectTasks.ts');
const { selectTasks } = loaded.default ?? loaded;

test('omitted status preserves existing task order and values', () => {
  const tasks = [{ id: 'z', status: 'done', title: 'First' }, { id: 'a', status: 'open', title: 'Second' }];
  assert.deepEqual(selectTasks(tasks), tasks);
});

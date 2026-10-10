// Parent-owned independent evaluator: copy outside the worker workspace read-only.
// Run with Node + installed tsx against an immutable capture, never the live workspace.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { test } from 'node:test';

const { selectTasks } = await import(pathToFileURL(resolve(process.env.RHYTHM_COORDINATOR_CAPTURE, 'src/selectTasks.ts')));
const tasks = Object.freeze([
  Object.freeze({ id: 'z', status: 'done', title: 'First' }),
  Object.freeze({ id: 'b', status: 'open', title: 'Second' }),
  Object.freeze({ id: 'a', status: 'done', title: 'Third' }),
  Object.freeze({ id: 'c', status: 'open', title: 'Fourth' }),
]);

test('open: catches ignored optional status and preserves ordering', () => {
  assert.deepEqual(selectTasks(tasks, 'open'), [tasks[1], tasks[3]]);
});
test('done: catches reversed ordering or incorrect status selection', () => {
  assert.deepEqual(selectTasks(tasks, 'done'), [tasks[0], tasks[2]]);
});
test('omitted: catches an accidental default filter', () => {
  assert.deepEqual(selectTasks(tasks), tasks);
});
test('empty: catches nonempty fallback results', () => {
  assert.deepEqual(selectTasks([], 'open'), []);
  assert.deepEqual(selectTasks([], 'done'), []);
  assert.deepEqual(selectTasks([]), []);
});
test('no-match: catches returning all tasks when nothing matches', () => {
  assert.notEqual(tasks[0].status, 'open');
  assert.deepEqual(selectTasks([tasks[0]], 'open'), []);
  assert.deepEqual(selectTasks([tasks[1]], 'done'), []);
});
test('unsupported runtime statuses: catches silently accepted invalid inputs', () => {
  for (const status of ['closed', '', null, 0, false, {}, []]) {
    assert.throws(() => selectTasks(tasks, status));
    assert.throws(() => selectTasks([], status));
  }
});
test('array/items preservation: catches sorting, splicing, or item mutation', () => {
  const mutable = structuredClone(tasks);
  const before = structuredClone(mutable);
  const references = [...mutable];
  for (const status of [undefined, 'open', 'done']) selectTasks(mutable, status);
  assert.deepEqual(mutable, before);
  mutable.forEach((item, index) => assert.equal(item, references[index]));
  for (const status of [undefined, 'open', 'done']) selectTasks(tasks, status);
  assert.deepEqual(tasks.map(t => t.id), ['z', 'b', 'a', 'c']);
});

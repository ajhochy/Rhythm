import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { outstandingTimestampFailures, rawTimestampDisplays } from '../timestamp-source-guard.mjs';

const guard = fileURLToPath(new URL('../timestamp-source-guard.mjs', import.meta.url));
const webRoot = fileURLToPath(new URL('../../', import.meta.url));

test('issue-1565-c4: AST source guard rejects raw display but allows semantic/date-only/input/prose', () => {
  assert.equal(rawTimestampDisplays('const x = <p>{row.createdAt}</p>').length, 1);
  assert.equal(rawTimestampDisplays('const x = <p>{`Updated ${row.updatedAt}`}</p>').length, 1);
  for (const allowed of [
    'const x = <Timestamp value={row.createdAt} />',
    'const x = <time dateTime={row.createdAt}>Good</time>',
    'const x = <input type="datetime-local" value={row.startTime} />',
    'const x = <p>{row.dueDate}</p>',
    'const x = <p>Example: 2026-09-24T01:00:00Z</p>',
    "const x = <p>{row.createdAt ? <Timestamp value={row.createdAt} /> : 'Unknown'}</p>",
    'const x = <p>{row.updatedAt && <>Updated <Timestamp value={row.updatedAt} /></>}</p>',
  ]) assert.deepEqual(rawTimestampDisplays(allowed), [], allowed);
});

test('issue-1565-c4: guard catches metadata, method, ternary and expiry expressions without exempting other fields', () => {
  // Regression caught: wrapping a raw timestamp in a conditional or method bypasses the guard.
  for (const snippet of [
    'const x = <p>{row.expiresAt}</p>',
    "const x = <p>{row.createdAt?.slice(0, 10)}</p>",
    "const x = <p>{row.createdAt ? row.createdAt : 'Unknown'}</p>",
    'const x = <p>{row.createdAt || <span>Unknown</span>}</p>',
    "const x = <p>{row.metadata.updatedAt ?? 'Unknown'}</p>",
    'const x = <p>{`Expires ${row.expiresAt}`}</p>',
  ]) assert.ok(rawTimestampDisplays(snippet).length, snippet);
  for (const snippet of [
    'const x = <p>{row.dueDate}</p>',
    'const x = <time dateTime={row.expiresAt}>Expires</time>',
    'const x = <input value={row.createdAt} />',
    'const x = <p>{row.userProse}</p>',
  ]) assert.deepEqual(rawTimestampDisplays(snippet), [], snippet);
});

test('issue-1565-c4: stale deferred expressions fail independently of raw-display filtering', () => {
  const ledger = { deferred: [{ file: 'fixture.tsx', expressions: ['row.createdAt'] }] };
  assert.deepEqual(
    outstandingTimestampFailures(['fixture.tsx'], [], ledger),
    ['fixture.tsx: stale deferred entry: row.createdAt'],
  );
});

test('issue-1565-c4: source guard passes over the complete web src tree', () => {
  const result = spawnSync(process.execPath, [guard, 'src'], { cwd: webRoot, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

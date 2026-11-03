// Run without arguments for the real API setup contract; append -- <suite command>
// to count all three prefixes around an affected suite. Concurrent runs can skew counts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const prefixes = ['rhythm-vitest-', 'opencode-test-', 'opencode-test-data-'];
const root = os.tmpdir();
const counts = () => Object.fromEntries(prefixes.map(prefix => [prefix,
  fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory() && entry.name.startsWith(prefix)).length,
]));
const before = counts();
const existing = new Set(fs.readdirSync(root));
let status = 0;
try {
  const args = process.argv.slice(2);
  if (args[0] === '--') {
    assert.ok(args[1], 'supply a suite command after --');
    const child = spawnSync(args[1], args.slice(2), { stdio: 'inherit' });
    if (child.error) throw child.error;
    status = child.status ?? 1;
  } else {
    const sentinel = fs.mkdtempSync(path.join(root, 'rhythm-vitest-contract-sentinel-'));
    try {
      const normal = '../../tools/dev/test-temp-directory-cleanup.test.ts';
      const skipped = '../../tools/dev/test-temp-directory-cleanup-skipped.test.ts';
      const runRoots = new Set();
      for (const [exitCode, files, teardown] of [[0, [normal], true], [1, [normal], true],
        [0, [skipped], false], [0, [normal, skipped], true]]) {
        const child = spawnSync('npm', ['test', '--', ...files], {
          cwd: new URL('../../apps/api_server/', import.meta.url),
          encoding: 'utf8',
          env: { ...process.env, RHYTHM_LIVE_E2E: '0', RHYTHM_TEMP_CLEANUP_FAIL: String(exitCode) },
        });
        process.stdout.write(child.stdout);
        process.stderr.write(child.stderr);
        if (child.error) throw child.error;
        assert.equal(child.status, exitCode, child.stderr);
        assert.equal(child.stdout.includes('TEMP_CLEANUP_TEARDOWN_ACTIVE'), teardown);
        const children = [...child.stdout.matchAll(/TEMP_CLEANUP_OWNED=("[^\r\n]*")/g)].map(match => JSON.parse(match[1]));
        assert.equal(children.length, files.length, 'missing exact setup children');
        assert.equal(new Set(children).size, files.length, 'test files shared a DB directory');
        const owned = path.dirname(children[0]);
        assert.equal(fs.realpathSync(path.dirname(owned)), fs.realpathSync(root));
        assert.ok(path.basename(owned).startsWith('rhythm-vitest-'));
        assert.equal(runRoots.has(owned), false, 'invocations shared a run root');
        runRoots.add(owned);
        for (const childRoot of children) {
          assert.equal(path.dirname(childRoot), owned, 'file escaped run ownership');
          assert.equal(fs.existsSync(childRoot), false, `worker exit ${exitCode} leaked ${childRoot}`);
        }
        assert.equal(fs.existsSync(owned), false, `run exit ${exitCode} leaked ${owned}`);
        assert.equal(fs.existsSync(sentinel), true, 'unowned sentinel removed');
      }
    } finally {
      fs.rmSync(sentinel, { recursive: true, force: true });
    }
    console.log('API Vitest passing/failing/all-skipped/mixed run lifetime and exact ownership: PASS');
  }
} finally {
  const after = counts();
  console.log(JSON.stringify({ TMPDIR: root, before, after, concurrency: 'Other temp-producing runs can skew counts.' }));
  const added = fs.readdirSync(root).filter(name => !existing.has(name) && prefixes.some(prefix => name.startsWith(prefix)));
  if (added.length) console.log(JSON.stringify({ newMatchingPaths: added.map(name => path.join(root, name)), deleted: false }));
  for (const prefix of prefixes) assert.ok(after[prefix] <= before[prefix], `${prefix} grew: ${before[prefix]} -> ${after[prefix]}`);
}
process.exitCode = status;

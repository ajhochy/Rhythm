// Prepare private copies of the installed shipping runtime; never execute app UI.
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
assert.equal(root, '/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/hermes-shipping-rollout-20261014');
const resources = '/Applications/Rhythm.app/Contents/Resources';
const copies = [
  ['opencode_bin/opencode', 'tools/dev/.hermes-shipping-runtime/dist/opencode-darwin-arm64/bin/opencode'],
  ['node/bin/node', 'tools/dev/.hermes-shipping-runtime/node/bin/node'],
];
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
execFileSync('codesign', ['--verify', '--deep', '--strict', '/Applications/Rhythm.app']);
for (const [source, target] of copies) {
  const from = `${resources}/${source}`, to = `${root}/${target}`;
  assert.equal(lstatSync(from).isFile(), true);
  const parent = resolve(to, '..');
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
  assert.equal(realpathSync(parent), parent, 'private destination must not traverse symlinks');
  if (!existsSync(to)) copyFileSync(from, to, 1);
  assert.equal(lstatSync(to).isFile(), true);
  assert.equal(hash(to), hash(from), 'private runtime must match installed bytes');
  console.log(JSON.stringify({ target, sha256: hash(to) }));
}
execFileSync('codesign', ['--verify', '--strict', `${root}/${copies[0][1]}`]);
// Private npm prebuild is unsigned; do not overwrite it with a sealed app resource.
execFileSync(`${root}/${copies[1][1]}`, ['-e', 'const D=require("better-sqlite3"); const db=new D(":memory:"); if(db.prepare("select 1 x").get().x!==1) process.exit(1); db.close()'], { cwd: root });

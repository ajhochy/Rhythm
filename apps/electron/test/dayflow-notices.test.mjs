import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { verifyDayflowNotices } from '../scripts/verify-dayflow-notices.mjs';

const script = fileURLToPath(new URL('../scripts/verify-dayflow-notices.mjs', import.meta.url));
const dependencies = ['grdb.swift', 'networkimage', 'posthog-ios', 'sentry-cocoa', 'sparkle', 'swift-cmark', 'swift-markdown-ui'];
const fonts = ['figtree', 'instrumentserif', 'nunito'];
const dayflowLicense = `MIT License

Copyright (c) 2025 Jerry Liu

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

async function withTemp(run) {
  const root = await mkdtemp(path.join(tmpdir(), 'rhythm-dayflow-notices-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** Synthetic copy of the staged `Resources/dayflow-desktop/legal` layout. */
async function makeLegalRoot(root) {
  const legalRoot = path.join(root, 'legal');
  await mkdir(legalRoot);
  const manifest = [];
  for (const [index, name] of [...dependencies, ...fonts].entries()) {
    const file = `LICENSE-${name}.txt`;
    const text = `synthetic license text for ${name}\n`;
    await writeFile(path.join(legalRoot, file), text);
    const revision = String(index).repeat(40).slice(0, 40);
    manifest.push(fonts.includes(name)
      ? { name, url: `https://raw.githubusercontent.com/google/fonts/main/ofl/${name}/OFL.txt`, sourceRevision: 'Google Fonts official family notice', file, sha256: sha256(text) }
      : { name, url: `https://raw.githubusercontent.com/example/${name}/${revision}/LICENSE`, sourceRevision: revision, file, sha256: sha256(text) });
  }
  await writeFile(path.join(legalRoot, 'notice-sources.json'), JSON.stringify(manifest, null, 2));
  await writeFile(path.join(legalRoot, 'LICENSE'), dayflowLicense);
  return { legalRoot, manifest };
}

async function rewriteManifest(legalRoot, edit) {
  const manifestPath = path.join(legalRoot, 'notice-sources.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  await writeFile(manifestPath, JSON.stringify(edit(manifest) ?? manifest));
}

test('valid synthetic payload verifies all ten notices with a bounded inventory and limitation', () => withTemp(async (root) => {
  const { legalRoot, manifest } = await makeLegalRoot(root);
  const result = await verifyDayflowNotices({ legalRoot });
  assert.equal(result.ok, true);
  assert.deepEqual(result.inventory.map(({ name, sha256: hash }) => ({ name, sha256: hash })), manifest.map(({ name, sha256: hash }) => ({ name, sha256: hash })));
  assert.equal(result.inventory.filter((entry) => entry.kind === 'font').length, 3);
  assert.equal(result.dayflowLicense.sha256, sha256(dayflowLicense));
  assert.equal(result.limitation, 'license-payload-integrity verified; legal clearance and font binary revision mapping are not established');
  assert.ok(result.bytesRead <= 2 * 1024 * 1024);
}));

for (const [label, mutate, pattern] of [
  ['missing license file', (legalRoot) => rm(path.join(legalRoot, 'LICENSE-sparkle.txt')), /LICENSE-sparkle\.txt/],
  ['tampered license file', (legalRoot) => writeFile(path.join(legalRoot, 'LICENSE-nunito.txt'), 'tampered\n'), /sha256 mismatch.*nunito/],
  ['empty license file', (legalRoot) => writeFile(path.join(legalRoot, 'LICENSE-figtree.txt'), ''), /empty/],
  ['forged manifest hash', (legalRoot) => rewriteManifest(legalRoot, (m) => { m[0].sha256 = 'f'.repeat(64); }), /sha256 mismatch.*grdb\.swift/],
  ['malformed hash', (legalRoot) => rewriteManifest(legalRoot, (m) => { m[0].sha256 = 'abc'; }), /sha256/],
  ['duplicate entry', (legalRoot) => rewriteManifest(legalRoot, (m) => { m[9] = { ...m[8] }; }), /duplicate/],
  ['missing expected entry', (legalRoot) => rewriteManifest(legalRoot, (m) => m.slice(0, 9)), /entries/],
  ['unexpected name', (legalRoot) => rewriteManifest(legalRoot, (m) => { m[0].name = 'leftpad'; m[0].file = 'LICENSE-leftpad.txt'; }), /unexpected/],
  ['path traversal file', (legalRoot) => rewriteManifest(legalRoot, (m) => { m[0].file = '../LICENSE-grdb.swift.txt'; }), /file/],
  ['nested file path', (legalRoot) => rewriteManifest(legalRoot, (m) => { m[0].file = 'sub/LICENSE-grdb.swift.txt'; }), /file/],
  ['absolute file path', (legalRoot) => rewriteManifest(legalRoot, (m) => { m[0].file = '/etc/LICENSE-grdb.swift.txt'; }), /file/],
  ['dependency without 40-hex revision', (legalRoot) => rewriteManifest(legalRoot, (m) => { m[1].sourceRevision = 'main'; }), /sourceRevision/],
  ['dependency url not pinned to revision', (legalRoot) => rewriteManifest(legalRoot, (m) => { m[1].url = 'https://raw.githubusercontent.com/example/networkimage/main/LICENSE'; }), /url/],
  ['non-public url host', (legalRoot) => rewriteManifest(legalRoot, (m) => { m[7].url = 'https://evil.example/google/fonts/main/ofl/figtree/OFL.txt'; }), /url/],
  ['font without official marker', (legalRoot) => rewriteManifest(legalRoot, (m) => { m[8].sourceRevision = 'a'.repeat(40); }), /sourceRevision/],
  ['missing manifest', (legalRoot) => rm(path.join(legalRoot, 'notice-sources.json')), /notice-sources\.json/],
  ['corrupt manifest', (legalRoot) => writeFile(path.join(legalRoot, 'notice-sources.json'), '{not json'), /manifest/],
  ['oversize manifest', (legalRoot) => writeFile(path.join(legalRoot, 'notice-sources.json'), ' '.repeat(3 * 1024 * 1024)), /limit/],
  ['oversize license file', async (legalRoot) => {
    const big = 'x'.repeat(2 * 1024 * 1024);
    await writeFile(path.join(legalRoot, 'LICENSE-sparkle.txt'), big);
    await rewriteManifest(legalRoot, (m) => { m[4].sha256 = sha256(big); });
  }, /limit/],
  ['manifest directory', async (legalRoot) => {
    await rm(path.join(legalRoot, 'notice-sources.json'));
    await mkdir(path.join(legalRoot, 'notice-sources.json'));
  }, /regular file/],
  ['symlinked manifest', async (legalRoot) => {
    const real = path.join(legalRoot, '..', 'outside.json');
    await writeFile(real, await readFile(path.join(legalRoot, 'notice-sources.json')));
    await rm(path.join(legalRoot, 'notice-sources.json'));
    await symlink(real, path.join(legalRoot, 'notice-sources.json'));
  }, /notice-sources\.json/],
  ['symlinked license escaping root', async (legalRoot) => {
    const outside = path.join(legalRoot, '..', 'outside.txt');
    await writeFile(outside, await readFile(path.join(legalRoot, 'LICENSE-sparkle.txt')));
    await rm(path.join(legalRoot, 'LICENSE-sparkle.txt'));
    await symlink(outside, path.join(legalRoot, 'LICENSE-sparkle.txt'));
  }, /LICENSE-sparkle\.txt/],
  ['missing Dayflow LICENSE', (legalRoot) => rm(path.join(legalRoot, 'LICENSE')), /LICENSE/],
  ['wrong Dayflow copyright', (legalRoot) => writeFile(path.join(legalRoot, 'LICENSE'), dayflowLicense.replace('2025 Jerry Liu', '2025 Someone Else')), /Dayflow LICENSE/],
  ['truncated Dayflow permission text', (legalRoot) => writeFile(path.join(legalRoot, 'LICENSE'), dayflowLicense.slice(0, 200)), /Dayflow LICENSE/],
]) {
  test(`rejects ${label}`, () => withTemp(async (root) => {
    const { legalRoot } = await makeLegalRoot(root);
    await mutate(legalRoot);
    await assert.rejects(verifyDayflowNotices({ legalRoot }), pattern);
  }));
}

test('rejects relative, outside-fixture, and symlinked roots', () => withTemp(async (root) => {
  const { legalRoot } = await makeLegalRoot(root);
  await assert.rejects(verifyDayflowNotices({ legalRoot: 'legal' }), /absolute/);
  await assert.rejects(verifyDayflowNotices({}), /absolute/);
  await assert.rejects(verifyDayflowNotices({ legalRoot: path.join(root, 'nope') }), /legalRoot/);
  const linked = path.join(root, 'linked-legal');
  await symlink(legalRoot, linked);
  await assert.rejects(verifyDayflowNotices({ legalRoot: linked }), /symlink/);
}));

// The verifier runs in a child with a hard timeout so a blocking open() fails the test instead of hanging it.
for (const fifoName of ['notice-sources.json', 'LICENSE-sparkle.txt', 'LICENSE']) {
  test(`rejects FIFO ${fifoName} without blocking`, { skip: process.platform === 'win32' && 'POSIX FIFOs only' }, () => withTemp(async (root) => {
    const { legalRoot } = await makeLegalRoot(root);
    await rm(path.join(legalRoot, fifoName));
    const made = spawnSync('mkfifo', [path.join(legalRoot, fifoName)], { encoding: 'utf8' });
    assert.equal(made.status, 0, made.stderr);
    const run = spawnSync(process.execPath, [script, legalRoot], { encoding: 'utf8', env: {}, timeout: 5000 });
    assert.equal(run.signal, null, 'verifier blocked on FIFO and was killed by the timeout');
    assert.equal(run.status, 1);
    assert.match(JSON.parse(run.stdout).error, new RegExp(`${fifoName.replaceAll('.', '\\.')} must be a regular file`));
  }));
}

test('CLI requires an explicit legalRoot and prints JSON without writing', () => withTemp(async (root) => {
  const { legalRoot } = await makeLegalRoot(root);
  const ok = spawnSync(process.execPath, [script, legalRoot], { encoding: 'utf8', env: {} });
  assert.equal(ok.status, 0, ok.stderr);
  const report = JSON.parse(ok.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.inventory.length, 10);

  const missing = spawnSync(process.execPath, [script], { encoding: 'utf8', env: { HOME: root } });
  assert.equal(missing.status, 1);
  assert.equal(JSON.parse(missing.stdout).ok, false);

  await writeFile(path.join(legalRoot, 'LICENSE-nunito.txt'), 'tampered\n');
  const bad = spawnSync(process.execPath, [script, legalRoot], { encoding: 'utf8', env: {} });
  assert.equal(bad.status, 1);
  assert.match(JSON.parse(bad.stdout).error, /nunito/);
}));

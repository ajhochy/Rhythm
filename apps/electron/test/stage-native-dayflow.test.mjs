import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { stageNativeDayflow } from '../scripts/stage-native-dayflow.mjs';

const DYLIB = 'Contents/Resources/native-dayflow/libNativeDayflowProductionUI.dylib';
const NODE = 'Contents/Resources/native-dayflow/native_dayflow_production.node';
const HELPER = 'Contents/Helpers/rhythm-dayflow';
const RES = 'Contents/Resources/native-dayflow/res.txt';
const SIDECAR = 'Contents/Resources/native-dayflow/native-dayflow-embedded-host.cjs';
const DEV = { [DYLIB]: ['/Xcode/swift'], [NODE]: ['@loader_path/../../DerivedData/debug'], [HELPER]: ['/Xcode/swift'] };
const KEPT = { [DYLIB]: ['/usr/lib/swift', '@loader_path'], [NODE]: ['@loader_path'], [HELPER]: ['/usr/lib/swift', '@loader_path'] };
const sha = (b) => createHash('sha256').update(b).digest('hex');

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'stage-nd-'));
  const layoutDir = join(root, 'layout');
  const contents = { [DYLIB]: 'dylib-bytes', [NODE]: 'node-bytes', [HELPER]: 'helper-bytes', [RES]: 'resource', [SIDECAR]: 'sidecar' };
  for (const [p, c] of Object.entries(contents)) {
    mkdirSync(dirname(join(layoutDir, p)), { recursive: true });
    writeFileSync(join(layoutDir, p), c);
  }
  chmodSync(join(layoutDir, HELPER), 0o755);
  const row = (p) => ({ sourceRelative: p, sha256: sha(contents[p]), bytes: contents[p].length, packageDestination: p, signingRequirement: 'x' });
  const manifest = {
    files: [DYLIB, NODE, HELPER, RES].map(row),
    sidecar: { sha256: sha(contents[SIDECAR]), destination: SIDECAR },
  };
  const signingInputsPath = join(root, 'inputs.json');
  writeFileSync(signingInputsPath, JSON.stringify(manifest));
  const metadataPath = join(root, 'meta.json');
  writeFileSync(metadataPath, JSON.stringify({ targets: Object.keys(DEV).map((path) => ({ path, developmentRpathsToRemoveFromPackagedCopy: DEV[path] })) }));
  const stagingAppDir = join(root, 'stage.app');
  mkdirSync(stagingAppDir);
  const state = {};
  const calls = [];
  const exec = (cmd, args) => {
    calls.push([cmd, ...args]);
    const rel = (f) => Object.keys(DEV).find((p) => f.endsWith(p));
    if (cmd === 'install_name_tool') {
      const p = rel(args[2]);
      state[p] ??= [...DEV[p], ...KEPT[p]];
      state[p] = state[p].filter((r) => r !== args[1]);
      return '';
    }
    if (cmd === 'otool' && args[0] === '-l') {
      const p = rel(args[1]);
      return (state[p] ?? [...DEV[p], ...KEPT[p]]).map((r) => `Load command 9\n          cmd LC_RPATH\n         path ${r} (offset 12)\n`).join('');
    }
    if (cmd === 'otool' && args[0] === '-L') return `${args[1]}:\n\t@rpath/libNativeDayflowProductionUI.dylib (compat 1)\n`;
    return '';
  };
  const run = (extra = {}) => stageNativeDayflow({ layoutDir, signingInputsPath, metadataPath, stagingAppDir, inventoryPath: join(root, 'inv.json'), exec, log: () => {}, ...extra });
  return { root, layoutDir, stagingAppDir, calls, run, contents, manifestPath: signingInputsPath, manifest };
}

test('happy path copies, normalizes the three Mach-O files, writes inventory', () => {
  const f = fixture();
  f.run();
  for (const [p, c] of Object.entries(f.contents)) assert.equal(readFileSync(join(f.stagingAppDir, p), 'utf8'), c);
  assert.equal(statSync(join(f.stagingAppDir, HELPER)).mode & 0o777, 0o755);
  const inv = JSON.parse(readFileSync(join(f.root, 'inv.json'), 'utf8'));
  assert.equal(inv.length, 5);
  assert.deepEqual(inv.filter((r) => r.transformed).map((r) => r.packageDestination).sort(), [DYLIB, HELPER, NODE].sort());
  assert.ok(inv.every((r) => r.sourceSha256 && r.stagedSha256 && typeof r.bytes === 'number'));
});

test('install_name_tool and codesign are issued only for the three Mach-O files', () => {
  const f = fixture();
  f.run();
  const del = f.calls.filter((c) => c[0] === 'install_name_tool').map((c) => `${c[1]} ${c[2]} ${c[3].slice(f.stagingAppDir.length + 1)}`).sort();
  assert.deepEqual(del, [`-delete_rpath ${DEV[DYLIB][0]} ${DYLIB}`, `-delete_rpath ${DEV[HELPER][0]} ${HELPER}`, `-delete_rpath ${DEV[NODE][0]} ${NODE}`].sort());
  const signs = f.calls.filter((c) => c[0] === 'codesign' && c.includes('--force'));
  assert.equal(signs.length, 3);
  const helperSign = signs.find((c) => c.at(-1).endsWith(HELPER));
  assert.ok(helperSign.join(' ').includes('--identifier com.rhythm.desktop.dayflow-helper'));
  assert.equal(f.calls.filter((c) => c[0] === 'codesign' && c[1] === '--verify').length, 3);
  assert.ok(!f.calls.some((c) => c.at(-1).endsWith('res.txt') || c.at(-1).endsWith('.cjs')));
});

test('hash drift throws naming the path', () => {
  const f = fixture();
  writeFileSync(join(f.layoutDir, RES), 'tampered');
  assert.throws(() => f.run(), (e) => e.message.includes(RES) && /sha256/.test(e.message));
});

test('extra file in layout throws', () => {
  const f = fixture();
  writeFileSync(join(f.layoutDir, 'Contents/Resources/native-dayflow/extra.txt'), 'x');
  assert.throws(() => f.run(), /extra\.txt/);
});

test('symlink row throws', () => {
  const f = fixture();
  const p = join(f.layoutDir, RES);
  writeFileSync(join(f.root, 'real'), f.contents[RES]);
  rmSync(p);
  symlinkSync(join(f.root, 'real'), p);
  assert.throws(() => f.run(), (e) => e.message.includes(RES) && /symlink|regular/.test(e.message));
});

test('missing row throws', () => {
  const f = fixture();
  rmSync(join(f.layoutDir, RES));
  assert.throws(() => f.run(), (e) => e.message.includes(RES) && /missing/.test(e.message));
});

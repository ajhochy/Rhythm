import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { verifyPackagedNativeDayflow } from '../scripts/verify-packaged-native-dayflow.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const HELPER = 'Contents/Helpers/rhythm-dayflow';
const DYLIB = 'Contents/Resources/native-dayflow/libNativeDayflowProductionUI.dylib';
const NODE = 'Contents/Resources/native-dayflow/native_dayflow_production.node';
const SIGN = 'normal DeveloperID hardened-runtime timestamp';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'vpnd-'));
  const appDir = join(root, 'Rhythm.app');
  const files = [];
  const put = (dest, body, signingRequirement = 'sealed resource') => {
    const p = join(appDir, dest);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
    files.push({ packageDestination: dest, sha256: sha(body), bytes: body.length, signingRequirement });
  };
  put('Contents/Resources/native-dayflow/Helpers/PROVENANCE.md', 'prov');
  put('Contents/Resources/native-dayflow/res.json', '{}');
  put(HELPER, 'helper', SIGN); put(DYLIB, 'dylib', SIGN); put(NODE, 'node', SIGN);
  const sidecar = { sha256: sha('side'), destination: 'Contents/Resources/native-dayflow/native-dayflow-embedded-host.cjs' };
  mkdirSync(dirname(join(appDir, sidecar.destination)), { recursive: true });
  writeFileSync(join(appDir, sidecar.destination), 'side');
  const signingInputsPath = join(root, 'm.json');
  writeFileSync(signingInputsPath, JSON.stringify({ files, sidecar }));
  return { root, appDir, signingInputsPath, inventoryPath: join(root, 'inv.json') };
}

function makeExec(o = {}) {
  return (cmd, args) => {
    const f = args.at(-1) ?? '';
    const kind = f.endsWith('rhythm-dayflow') ? 'helper' : f.endsWith('.dylib') ? 'dylib' : 'node';
    if (cmd === 'codesign' && args[0] === '--verify') return '';
    if (cmd === 'codesign') {
      if (kind !== 'helper') return 'Executable=x\nflags=0x10000(runtime)\nTeamIdentifier=ABC123\n';
      const team = o.noTeam ? 'TeamIdentifier=not set' : 'TeamIdentifier=ABC123';
      const ent = o.helperEntitlements ? '<?xml version="1.0"?><plist><dict><key>com.apple.security.cs.allow-jit</key><true/></dict></plist>' : '';
      return `flags=0x10000(runtime)\n${team}\n${ent}`;
    }
    if (cmd === 'otool') {
      const rp = kind === 'node' ? ['@loader_path'] : ['/usr/lib/swift', '@loader_path'];
      if (o.badRpath && kind === 'dylib') rp.push('/x/DerivedData/Build');
      return rp.map((p) => `Load command 9\n          cmd LC_RPATH\n         path ${p} (offset 12)\n`).join('');
    }
    if (cmd === 'nm') return Array.from({ length: o.exports ?? 15 }, (_, i) => `0000 T _native_dayflow_production_f${i}`).join('\n');
    if (cmd === 'vtool') return `minos ${o.minos ?? '14.0'}\n`;
    throw new Error(`unexpected ${cmd}`);
  };
}

const run = (fx, o) => verifyPackagedNativeDayflow({ appDir: fx.appDir, signingInputsPath: fx.signingInputsPath, inventoryPath: fx.inventoryPath, exec: makeExec(o), log: () => {} });

test('all good passes and writes inventory', () => {
  const fx = fixture();
  const r = run(fx);
  assert.equal(r.ok, true);
  const inv = JSON.parse(readFileSync(fx.inventoryPath, 'utf8'));
  assert.equal(inv.machO.find((m) => m.path === HELPER).postSignSha256, sha('helper'));
  assert.equal(inv.machO.length, 3);
});
test('resource hash drift fails naming path', () => {
  const fx = fixture();
  writeFileSync(join(fx.appDir, 'Contents/Resources/native-dayflow/res.json'), 'tampered');
  assert.throws(() => run(fx), /res\.json/);
});
test('missing file fails', () => {
  const fx = fixture();
  writeFileSync(fx.signingInputsPath, JSON.stringify({ ...JSON.parse(readFileSync(fx.signingInputsPath, 'utf8')), files: [{ packageDestination: 'Contents/nope', sha256: 'x', signingRequirement: 'sealed resource' }] }));
  assert.throws(() => run(fx), /nope/);
});
test('helper with entitlements fails', () => assert.throws(() => run(fixture(), { helperEntitlements: true }), /entitlements/i));
test('helper without TeamIdentifier fails', () => assert.throws(() => run(fixture(), { noTeam: true }), /TeamIdentifier/));
test('DerivedData rpath fails', () => assert.throws(() => run(fixture(), { badRpath: true }), /rpath/i));
test('export count 14 fails', () => assert.throws(() => run(fixture(), { exports: 14 }), /export/i));
test('minos 13.0 fails', () => assert.throws(() => run(fixture(), { minos: '13.0' }), /minos/i));

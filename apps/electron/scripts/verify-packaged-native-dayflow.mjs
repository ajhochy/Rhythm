// Verifies the staged/signed native Dayflow payload inside a Rhythm.app against the signing-inputs
// manifest. Throws on the first failed invariant. Run before the outer app seal (sign script) or as
// a CLI: node scripts/verify-packaged-native-dayflow.mjs <Rhythm.app> [manifest.json]
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_SIGNING_INPUTS = '/Users/ajhochhalter/Documents/Codex/2026-10-04/task-4/native-dayflow-full-host-signing-inputs.json';
const electronRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HELPER = 'Contents/Helpers/rhythm-dayflow';
const DYLIB_SUFFIX = '.dylib';
const SYMBOL = '_native_dayflow_production_';

// stdout+stderr combined (codesign -d writes to stderr); throws on non-zero exit.
function defaultExec(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed: ${r.stderr || r.error}`);
  return `${r.stdout}\n${r.stderr}`;
}

const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

export function verifyPackagedNativeDayflow({ appDir, signingInputsPath = DEFAULT_SIGNING_INPUTS, exec = defaultExec, log = console.log, inventoryPath = resolve(electronRoot, 'dist/native-dayflow-postsign-inventory.json') }) {
  const manifest = JSON.parse(readFileSync(signingInputsPath, 'utf8'));
  const rows = [...manifest.files.map((f) => ({ path: f.packageDestination, sha256: f.sha256, machO: f.signingRequirement.startsWith('normal DeveloperID') })),
    ...(manifest.sidecar ? [{ path: manifest.sidecar.destination, sha256: manifest.sidecar.sha256, machO: false }] : [])];
  const fail = (m) => { throw new Error(`native Dayflow verify: ${m}`); };

  for (const r of rows) {
    const p = resolve(appDir, r.path);
    if (!existsSync(p)) fail(`missing ${r.path}`);
    if (!r.machO && sha256(p) !== r.sha256) fail(`sha256 mismatch ${r.path}`);
  }

  const machO = [];
  for (const r of rows.filter((x) => x.machO)) {
    const p = resolve(appDir, r.path);
    const isHelper = r.path === HELPER;
    const isDylib = r.path.endsWith(DYLIB_SUFFIX);
    exec('codesign', ['--verify', '--strict', p]);
    const info = exec('codesign', ['-dv', '--entitlements', '-', p]);
    if (isHelper) {
      if (!/TeamIdentifier=(?!not set)\S+/.test(info)) fail(`${r.path} has no TeamIdentifier`);
      if (!/flags=\S*\(([^)]*\bruntime\b[^)]*)\)/.test(info)) fail(`${r.path} lacks hardened runtime flag`);
      if (/<key>|\[Key\]|<dict>/.test(info)) fail(`${r.path} must have no entitlements`);
    }
    const rpaths = [...exec('otool', ['-l', p]).matchAll(/LC_RPATH[\s\S]*?path (\S+) \(offset/g)].map((m) => m[1]);
    const want = r.path.endsWith('.node') ? ['@loader_path'] : ['/usr/lib/swift', '@loader_path'];
    if (rpaths.some((x) => /Xcode\.app|DerivedData/.test(x)) || rpaths.length !== want.length || want.some((w) => !rpaths.includes(w))) fail(`bad rpath list for ${r.path}: ${JSON.stringify(rpaths)}`);
    const minos = /minos (\S+)/.exec(exec('vtool', ['-show-build', p]))?.[1];
    if (minos !== '14.0') fail(`${r.path} minos ${minos}, expected 14.0`);
    let exports;
    if (isDylib) {
      exports = exec('nm', ['-gU', p]).split('\n').filter((l) => l.includes(SYMBOL)).length;
      if (exports !== 15) fail(`${r.path} exports ${exports} ${SYMBOL}* symbols, expected 15`);
    }
    machO.push({ path: r.path, manifestSha256: r.sha256, postSignSha256: sha256(p), rpaths, minos, ...(exports === undefined ? {} : { exports }) });
  }
  if (machO.length !== 3) fail(`expected 3 Mach-O rows, found ${machO.length}`);

  const report = { ok: true, files: rows.length, machO };
  mkdirSync(dirname(inventoryPath), { recursive: true });
  writeFileSync(inventoryPath, `${JSON.stringify(report, null, 2)}\n`);
  log(`native Dayflow verified: ${rows.length} files, inventory ${inventoryPath}`);
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { verifyPackagedNativeDayflow({ appDir: resolve(process.argv[2]), signingInputsPath: process.argv[3] ?? DEFAULT_SIGNING_INPUTS }); }
  catch (e) { console.error(e.message); process.exit(1); }
}

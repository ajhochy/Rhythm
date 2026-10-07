import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const HELPER_DEST = 'Contents/Helpers/rhythm-dayflow';
const HELPER_IDENTIFIER = 'com.rhythm.desktop.dayflow-helper';
const NODE_DEST = 'Contents/Resources/native-dayflow/native_dayflow_production.node';

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const defaultExec = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

function listFiles(root, dir = root, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) listFiles(root, full, out);
    else out.push(relative(root, full));
  }
  return out;
}

function rpaths(text) {
  return [...text.matchAll(/cmd LC_RPATH[\s\S]*?\n\s*path (.+?) \(offset/g)].map((m) => m[1]);
}

/** Verify the prepared layout against the signing-inputs manifest, copy it into the staging app,
 * normalize development rpaths on the three Mach-O files, and re-seal them ad hoc. Synchronous. */
export function stageNativeDayflow({
  layoutDir, signingInputsPath, stagingAppDir, inventoryPath,
  metadataPath = resolve(layoutDir, '../signing-layout-metadata.json'),
  exec = defaultExec, log = () => {},
}) {
  const manifest = JSON.parse(readFileSync(signingInputsPath, 'utf8'));
  const rows = [
    ...manifest.files.map((r) => ({ dest: r.packageDestination, sha256: r.sha256, bytes: r.bytes })),
    { dest: manifest.sidecar.destination, sha256: manifest.sidecar.sha256 },
  ];
  const problems = [];
  const expected = new Set(rows.map((r) => r.dest));
  for (const r of rows) {
    const file = join(layoutDir, r.dest);
    let st;
    try { st = lstatSync(file); } catch { problems.push(`missing: ${r.dest}`); continue; }
    if (st.isSymbolicLink() || !st.isFile()) { problems.push(`not a regular file (symlink or other): ${r.dest}`); continue; }
    if (r.bytes !== undefined && st.size !== r.bytes) problems.push(`byte size mismatch: ${r.dest} (${st.size} != ${r.bytes})`);
    if (sha256(file) !== r.sha256) problems.push(`sha256 mismatch: ${r.dest}`);
  }
  for (const f of listFiles(layoutDir)) if (!expected.has(f)) problems.push(`extra file not in manifest: ${f}`);
  if (problems.length) throw new Error(`Native Dayflow layout verification failed:\n${problems.join('\n')}`);

  const macho = new Map(JSON.parse(readFileSync(metadataPath, 'utf8')).targets
    .map((t) => [t.path, t.developmentRpathsToRemoveFromPackagedCopy]));
  for (const dest of [HELPER_DEST, NODE_DEST]) if (!macho.has(dest)) throw new Error(`rpath metadata missing target: ${dest}`);

  const inventory = [];
  for (const r of rows) {
    const src = join(layoutDir, r.dest);
    const out = join(stagingAppDir, r.dest);
    mkdirSync(dirname(out), { recursive: true });
    copyFileSync(src, out);
    chmodSync(out, lstatSync(src).mode & 0o777);
    inventory.push({ packageDestination: r.dest, sourceSha256: r.sha256, out, bytes: r.bytes ?? lstatSync(src).size });
  }

  for (const item of inventory) {
    const dev = macho.get(item.packageDestination);
    if (!dev) continue;
    const before = rpaths(exec('otool', ['-l', item.out]));
    const kept = before.filter((p) => !dev.includes(p));
    for (const rpath of dev) exec('install_name_tool', ['-delete_rpath', rpath, item.out]);
    const after = rpaths(exec('otool', ['-l', item.out]));
    const leftover = dev.filter((p) => after.includes(p));
    const lost = kept.filter((p) => !after.includes(p));
    if (!after.includes('@loader_path')) lost.push('@loader_path');
    if (leftover.length || lost.length) throw new Error(`rpath normalization failed for ${item.packageDestination}: leftover=${leftover} lost=${lost}`);
    if (item.packageDestination === NODE_DEST && !exec('otool', ['-L', item.out]).includes('@rpath/libNativeDayflowProductionUI.dylib')) {
      throw new Error('native_dayflow_production.node no longer references @rpath/libNativeDayflowProductionUI.dylib');
    }
    const sign = ['--force', '--sign', '-'];
    if (item.packageDestination === HELPER_DEST) sign.push('--identifier', HELPER_IDENTIFIER);
    exec('codesign', [...sign, item.out]);
    exec('codesign', ['--verify', '--strict', item.out]);
    item.transformed = true;
  }

  const finalResult = inventory.map(({ out, ...r }) => ({ packageDestination: r.packageDestination, sourceSha256: r.sourceSha256, stagedSha256: sha256(out), bytes: r.bytes, transformed: r.transformed === true }));
  if (inventoryPath) {
    mkdirSync(dirname(inventoryPath), { recursive: true });
    writeFileSync(inventoryPath, `${JSON.stringify(finalResult, null, 2)}\n`);
  }
  log(`Staged ${finalResult.length} native Dayflow files (${finalResult.filter((r) => r.transformed).length} rpath-normalized and re-signed).`);
  return finalResult;
}

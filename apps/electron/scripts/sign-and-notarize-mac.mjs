// post-m1-p11-c1/c2 — signs the unsigned dist/Rhythm.app produced by package-mac.mjs with a real
// Developer ID Application identity (hardened runtime), then notarizes and staples it.
//
// Modeled on tools/release/sign_and_notarize_macos.sh (the Flutter reference), simplified: this
// Electron shell does not bundle a native Node runtime or opencode fork binary inside Contents/
// Resources (checked: package-mac.mjs only copies .mjs/.cjs sources + the built web/dist bundle),
// so there are no extensionless Mach-O binaries or JIT-needing embedded runtimes to sign separately
// beyond Electron's own bundled Frameworks/Helpers.
//
// Required environment:
//   APPLE_SIGNING_IDENTITY  — codesign identity (SHA-1 hash or exact "Developer ID Application: ..."
//                             string). Must already be importable/present in a keychain codesign can
//                             reach (security find-identity -v -p codesigning).
//   APPLE_TEAM_ID           — e.g. 56Q69NYP9H.
//   APPLE_API_KEY_PATH      — path to the App Store Connect API .p8 key file.
//   APPLE_API_KEY_ID        — that key's Key ID.
//   APPLE_API_ISSUER        — that key's Issuer ID.
import { execFile } from 'node:child_process';
import { open, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const electronRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifact = resolve(electronRoot, 'dist/Rhythm.app');
const entitlementsPath = resolve(electronRoot, 'entitlements/mac.plist');

const required = ['APPLE_SIGNING_IDENTITY', 'APPLE_TEAM_ID', 'APPLE_API_KEY_PATH', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'];
for (const name of required) {
  if (!process.env[name]?.trim()) {
    process.stderr.write(`Missing ${name} — skipping sign/notarize.\n`);
    process.exit(1);
  }
}
if (!existsSync(artifact)) {
  process.stderr.write(`${artifact} not found — run \`npm run package:mac\` first.\n`);
  process.exit(1);
}

const identity = process.env.APPLE_SIGNING_IDENTITY.trim();
const teamId = process.env.APPLE_TEAM_ID.trim();

// Mach-O magic numbers (32/64-bit, fat/universal, both endiannesses). Notarization rejected the
// first attempt here because two helper executables nested inside Contents/Frameworks/*.framework
// (Electron Framework's chrome_crashpad_handler, Squirrel's ShipIt) have NO file extension —
// matching by extension (.dylib/.so/.node) alone misses them silently. Reading the real magic
// bytes catches every Mach-O binary regardless of name, the same class of gap the Flutter
// reference script hits by special-casing its two known extensionless binaries (opencode, node).
const MACHO_MAGIC = new Set([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca]);
async function isMachO(path) {
  let handle;
  try {
    handle = await open(path, 'r');
    const buffer = Buffer.alloc(4);
    const { bytesRead } = await handle.read(buffer, 0, 4, 0);
    if (bytesRead < 4) return false;
    return MACHO_MAGIC.has(buffer.readUInt32BE(0));
  } catch {
    return false;
  } finally {
    await handle?.close();
  }
}

async function findNestedCodeSignTargets(root) {
  const targets = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.endsWith('.app') || entry.name.endsWith('.framework')) targets.push(full);
        await walk(full);
      } else if (/\.(dylib|so|node)$/.test(entry.name)) {
        targets.push(full);
      } else if (await isMachO(full)) {
        // Catches extensionless Mach-O helpers/executables (e.g. spawn-helper, chrome_crashpad_handler, ShipIt).
        targets.push(full);
      }
    }
  }
  await walk(root);
  // Sign deepest paths first so an inner .app/.framework is sealed before whatever wraps it.
  return targets.sort((a, b) => b.split('/').length - a.split('/').length);
}

async function codesign(target, { deep = false } = {}) {
  const args = ['--force', '--options', 'runtime', '--timestamp'];
  if (deep) args.push('--deep');
  args.push('--entitlements', entitlementsPath, '--sign', identity, target);
  process.stdout.write(`codesign ${basename(target)}\n`);
  await run('codesign', args);
}

const contentsDir = resolve(artifact, 'Contents');
for (const target of await findNestedCodeSignTargets(contentsDir)) {
  await codesign(target);
}
await codesign(artifact, { deep: false });

const verify = await run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', artifact]).catch((error) => error);
process.stdout.write(`${verify.stderr ?? verify.stdout ?? ''}\n`);
if (verify instanceof Error) {
  process.stderr.write('codesign --verify failed.\n');
  process.exit(1);
}

const assess = await run('spctl', ['--assess', '--type', 'execute', '--verbose', artifact]).catch((error) => error);
process.stdout.write(`${assess.stderr ?? assess.stdout ?? ''}\n`);

const zipPath = resolve(electronRoot, 'dist/Rhythm.zip');
await run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', artifact, zipPath]);

process.stdout.write('Submitting to Apple notary service (this can take several minutes)...\n');
const notaryArgs = [
  'notarytool', 'submit', zipPath,
  '--key', process.env.APPLE_API_KEY_PATH,
  '--key-id', process.env.APPLE_API_KEY_ID,
  '--issuer', process.env.APPLE_API_ISSUER,
  '--team-id', teamId,
  '--wait', '--timeout', '30m',
];
const notary = await run('xcrun', notaryArgs).catch((error) => error);
const notaryOutput = notary instanceof Error ? (notary.stdout ?? '') + (notary.stderr ?? '') : notary.stdout;
process.stdout.write(`${notaryOutput}\n`);

const submissionId = /id: ([a-f0-9-]+)/i.exec(notaryOutput)?.[1];
// The FINAL result block's "status: Accepted|Invalid" line must win — notarytool --wait prints
// repeated "Current status: In Progress..." lines first, and a non-global exec() would otherwise
// match "In" out of "In Progress" as if it were the terminal status.
const statusMatches = [...notaryOutput.matchAll(/^\s*status:\s*(\w+)\s*$/gim)];
const status = statusMatches.at(-1)?.[1];

if (status === 'Invalid' && submissionId) {
  const log = await run('xcrun', [
    'notarytool', 'log', submissionId,
    '--key', process.env.APPLE_API_KEY_PATH,
    '--key-id', process.env.APPLE_API_KEY_ID,
    '--issuer', process.env.APPLE_API_ISSUER,
  ]).catch((error) => error);
  process.stdout.write(`${(log.stdout ?? '') + (log.stderr ?? '')}\n`);
  process.exit(1);
}
if (status !== 'Accepted') {
  process.stderr.write(`Notarization did not report Accepted (got: ${status ?? 'unknown'}).\n`);
  process.exit(1);
}

await run('xcrun', ['stapler', 'staple', artifact]);
// Rebuild the zip AFTER stapling so the archived .app already carries the notarization ticket —
// offline Gatekeeper verification then works even for someone who only ever gets the zip.
await run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', artifact, zipPath]);

process.stdout.write(`Signed and notarized ${artifact}\n`);

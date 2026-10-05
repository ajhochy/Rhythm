// post-m1-p11-c1/c2 — signs the unsigned dist/Rhythm.app produced by package-mac.mjs with a real
// Developer ID Application identity (hardened runtime), then notarizes and staples it.
//
// Modeled on tools/release/sign_and_notarize_macos.sh (the Flutter reference), simplified: this
// Electron packages the API server, a matching Node runtime and the exact Rhythm fork binary.
// findNestedCodeSignTargets() discovers the embedded engine, Node and native modules by Mach-O
// magic, along with Electron's own Frameworks/Helpers, so every nested executable is signed.
//
// Required environment (same Apple ID + app-specific-password notarization credentials as
// tools/release/sign_and_notarize_macos.sh — the Flutter release script — since this is the same
// Apple Developer account/app; no separate App Store Connect API key needed):
//   APPLE_SIGNING_IDENTITY      — codesign identity (SHA-1 hash or exact "Developer ID Application:
//                                 ..." string). Must already be importable/present in a keychain
//                                 codesign can reach (security find-identity -v -p codesigning).
//   APPLE_TEAM_ID               — e.g. 56Q69NYP9H.
//   APPLE_ID                    — Apple ID email used for notarization.
//   APPLE_APP_SPECIFIC_PASSWORD — app-specific password for that Apple ID.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { hardenElectronFuses } from './harden-electron-fuses.mjs';
import { PINNED_HERMES_DESKTOP_SOURCE_COMMIT } from '../src/hermes-desktop-config.mjs';
import { refreshHermesDesktopArtifactIntegrity, resolveHermesDesktopArtifact } from '../src/hermes-desktop-artifact.mjs';
import { EXPECTED_COLONY_ELECTRON_MAJOR, PINNED_COLONY_SOURCE_COMMIT } from '../src/colony-desktop-config.mjs';
import { refreshColonyArtifactIntegrity, resolveColonyArtifact } from '../src/colony-desktop-artifact.mjs';
import { findNestedCodeSignTargets, isMachO, validateDayflowDesktopArtifact } from '../src/dayflow-desktop-artifact.mjs';
import { requireManifestSigningKey, signHermesDesktopManifest } from './sign-hermes-desktop-manifest.mjs';
import { resolveSigningIdentityWithRunner } from './signing-identity.mjs';

const run = promisify(execFile);
const electronRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifact = resolve(electronRoot, 'dist/Rhythm.app');
const entitlementsPath = resolve(electronRoot, 'entitlements/mac.plist');

// RHYTHM_SIGN_ONLY=1: local candidate — Developer ID signature, no notarization. Ad-hoc builds
// cannot start the agent runtime (the approval helper requires a team-signed parent), and the
// bundled (factory) Hermes artifact is integrity-checked, not signature-checked, so the manifest
// key is only needed when a release will also ship installable Hermes updates.
const signOnly = process.env.RHYTHM_SIGN_ONLY === '1';
const required = ['APPLE_SIGNING_IDENTITY', 'APPLE_TEAM_ID', ...(signOnly ? [] : ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD'])];
for (const name of required) {
  if (!process.env[name]?.trim()) {
    process.stderr.write(`Missing ${name} — skipping sign/notarize.\n`);
    process.exit(1);
  }
}
// issue-1570-d: fail closed before any codesign work starts, never after — an unsigned Hermes
// Desktop manifest is a release the installed-artifact verifier will reject anyway, so catching it
// here saves the notarization round trip instead of discovering it downstream.
let hermesDesktopManifestSigningKey;
try {
  if (!signOnly || process.env.HERMES_DESKTOP_MANIFEST_SIGNING_KEY?.trim()) hermesDesktopManifestSigningKey = requireManifestSigningKey();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
}
if (!existsSync(artifact)) {
  process.stderr.write(`${artifact} not found — run \`npm run package:mac\` first.\n`);
  process.exit(1);
}

const identity = await resolveSigningIdentityWithRunner(process.env.APPLE_SIGNING_IDENTITY, { runner: run });
const teamId = process.env.APPLE_TEAM_ID.trim();

async function codesign(target, { deep = false } = {}) {
  const args = ['--force', '--options', 'runtime', '--timestamp'];
  if (deep) args.push('--deep');
  args.push('--entitlements', entitlementsPath, '--sign', identity, target);
  process.stdout.write(`codesign ${basename(target)}\n`);
  await run('codesign', args);
}

const contentsDir = resolve(artifact, 'Contents');
const engine = resolve(contentsDir, 'Resources/opencode_bin/opencode');
const approvalHelper = resolve(contentsDir, 'Resources/human-approval/rhythm-approval-signer');
const dayflowDesktopArtifact = resolve(contentsDir, 'Resources/dayflow-desktop/Dayflow.app');
const targets = await findNestedCodeSignTargets(contentsDir, { excludedRoots: [dayflowDesktopArtifact] });
if (!targets.includes(approvalHelper) || !(await isMachO(approvalHelper))) {
  throw new Error('Packaged approval helper Mach-O is missing from nested signing targets');
}
if (!targets.includes(engine) || !(await isMachO(engine))) {
  throw new Error('Packaged Rhythm fork Mach-O is missing from nested signing targets');
}
await hardenElectronFuses(resolve(artifact, 'Contents/MacOS/Rhythm'));
for (const target of targets) {
  if (target === approvalHelper) {
    // Native helper needs no Electron JIT/library-validation exceptions. Keep Keychain identity stable.
    await run('codesign', ['--force', '--options', 'runtime', '--timestamp', '--identifier',
      'com.rhythm.desktop.approval-signer', '--sign', identity, target]);
  } else await codesign(target);
}
await run('codesign', ['--verify', '--strict', approvalHelper]);
await run('codesign', ['--verify', '--strict', engine]);
const hermesDesktopArtifact = resolve(contentsDir, 'Resources/hermes-desktop');
await refreshHermesDesktopArtifactIntegrity({ artifactRoot: hermesDesktopArtifact });
await resolveHermesDesktopArtifact({
  artifactRoot: hermesDesktopArtifact,
  expectedElectronMajor: 40,
  expectedSourceCommit: PINNED_HERMES_DESKTOP_SOURCE_COMMIT,
  allowDirty: false,
});
// Must run after the reseal above (mutating the artifact later invalidates this signature) and
// before the outer app codesign, so this exact signed manifest ships inside the sealed bundle.
if (hermesDesktopManifestSigningKey) await signHermesDesktopManifest({ artifactRoot: hermesDesktopArtifact, signingKey: hermesDesktopManifestSigningKey });
const colonyDesktopArtifact = resolve(contentsDir, 'Resources/colony-desktop');
await refreshColonyArtifactIntegrity({ artifactRoot: colonyDesktopArtifact });
await resolveColonyArtifact({
  artifactRoot: colonyDesktopArtifact,
  expectedElectronMajor: EXPECTED_COLONY_ELECTRON_MAJOR,
  expectedSourceCommit: PINNED_COLONY_SOURCE_COMMIT,
  allowDirty: false,
});
// This must be the final check before outer signing. It catches any alteration after package
// staging and proves the original upstream signature/Gatekeeper assessment still holds.
await validateDayflowDesktopArtifact({ appRoot: dayflowDesktopArtifact, execute: run });
await codesign(artifact, { deep: false });

const verify = await run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', artifact]).catch((error) => error);
process.stdout.write(`${verify.stderr ?? verify.stdout ?? ''}\n`);
if (verify instanceof Error) {
  process.stderr.write('codesign --verify failed.\n');
  process.exit(1);
}

const assess = await run('spctl', ['--assess', '--type', 'execute', '--verbose', artifact]).catch((error) => error);
process.stdout.write(`${assess.stderr ?? assess.stdout ?? ''}\n`);

if (signOnly) {
  process.stdout.write(`Signed ${artifact} (sign-only; not notarized).\n`);
  process.exit(0);
}

const zipPath = resolve(electronRoot, 'dist/Rhythm.zip');
await run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', artifact, zipPath]);

const appleId = process.env.APPLE_ID.trim();
const appSpecificPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD.trim();

process.stdout.write('Submitting to Apple notary service (this can take several minutes)...\n');
const notaryArgs = [
  'notarytool', 'submit', zipPath,
  '--apple-id', appleId,
  '--password', appSpecificPassword,
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
    '--apple-id', appleId,
    '--password', appSpecificPassword,
    '--team-id', teamId,
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

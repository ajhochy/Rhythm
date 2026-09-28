// Installed-artifact Colony (Bot Crossing) qualification harness — COL-11.
//
// This is orchestrator/AJ work on real signed hardware: downloading the exact release-candidate
// ZIP, installing it into a disposable macOS account, driving real UI/menu input and real
// Keychain sign-in. What lives here is the source-side part that can be authored and unit-tested
// without that hardware: hash verification (never install/extract an unverified archive), and a
// report builder that always produces a complete, honest per-case record — a case the run never
// touched is reported as `not-run`, never silently dropped.
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** COL-11's full acceptance matrix (AC1..AC4). Order is documentation-stable, not meaningful. */
export const COLONY_INSTALLED_CASES = Object.freeze([
  // COL-11-AC1: first launch, enablement, inventories, selection, archive, Finder, exact nav.
  'first-launch-disabled',
  'enablement-source-choice',
  'empty-inventory',
  'populated-inventory',
  'list-scene-selection',
  'archive-restore',
  'finder-copy',
  'exact-task-navigation',
  // COL-11-AC2: task switching preserves auth/processes; inaccurate targets report honestly.
  'task-switch-preserves-auth-and-processes',
  'missing-external-app-reports-accurately',
  'unsupported-task-ref-reports-accurately',
  // COL-11-AC3: lifecycle and failure resilience, no orphan scanner.
  'quit-relaunch',
  'scanner-crash-retry',
  'disable-reenable',
  'account-switch',
  'offline-use',
  'low-gpu-fallback',
  'no-orphan-scanner',
  // COL-11-AC4: upgrade and rollback preserve local preferences.
  'upgrade-from-preceding-build',
  'rollback-restoration',
])

/** @param {string} filePath */
export async function sha256File(filePath) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

/** Refuses a downloaded release-candidate ZIP whose bytes do not match the published manifest.
 * Never installs or extracts an archive that fails this check.
 * @param {{zipPath: string, expectedSha256: string}} options */
export async function verifyZipHash({ zipPath, expectedSha256 }) {
  if (typeof expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(expectedSha256)) {
    throw new Error(`Colony installed harness requires a 64-hex-character SHA-256 manifest entry for ${zipPath}`)
  }
  const actual = await sha256File(zipPath)
  if (actual.toLowerCase() !== expectedSha256.toLowerCase()) {
    throw new Error(`Colony installed-artifact ZIP hash mismatch for ${zipPath}: manifest says ${expectedSha256}, found ${actual}`)
  }
  return actual
}

/** Builds the JSON evidence record COL-11 requires: artifact identity, host identity, and an
 * explicit pass/fail/not-run verdict for every known case. A case absent from `results` is
 * reported `not-run` — it is never omitted from the case list, so a partial run is always visible.
 * @param {{artifactSha256: string, appVersion: string, osVersion: string, cpu: string, results?: Record<string, 'pass'|'fail'>}} options */
export function buildEvidence({ artifactSha256, appVersion, osVersion, cpu, results = {} }) {
  const identity = { artifactSha256, appVersion, osVersion, cpu }
  for (const [field, value] of Object.entries(identity)) {
    if (typeof value !== 'string' || !value) throw new Error(`Colony installed evidence requires ${field}`)
  }
  const unknown = Object.keys(results).filter((id) => !COLONY_INSTALLED_CASES.includes(id))
  if (unknown.length) throw new Error(`Unknown Colony installed case id(s): ${unknown.join(', ')}`)
  const cases = COLONY_INSTALLED_CASES.map((id) => ({
    id,
    status: results[id] === 'pass' || results[id] === 'fail' ? results[id] : 'not-run',
  }))
  return { ...identity, generatedAt: new Date().toISOString(), cases }
}

/** Verifies the candidate archive, then writes a complete evidence record. `resultsPath`, if it
 * exists, is a JSON map of case id -> 'pass'|'fail' that the orchestrator's real-hardware run
 * produced by driving the installed app; a missing or empty file means every case is `not-run`.
 * This function does not itself install, launch or drive the app — see the module comment.
 * @param {{zipPath: string, expectedSha256: string, appVersion: string, resultsPath?: string, evidencePath: string, osVersion?: string, cpu?: string}} options */
export async function runInstalledHarness({ zipPath, expectedSha256, appVersion, resultsPath, evidencePath, osVersion = `${os.type()} ${os.release()}`, cpu = os.arch() }) {
  const artifactSha256 = await verifyZipHash({ zipPath, expectedSha256 })
  let results = {}
  if (resultsPath) {
    try { results = JSON.parse(await readFile(resultsPath, 'utf8')) }
    catch { results = {} }
  }
  const evidence = buildEvidence({ artifactSha256, appVersion, osVersion, cpu, results })
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`)
  return evidence
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, '').split('=')
    return [key, rest.join('=')]
  }))
  if (!args.zipPath || !args.expectedSha256 || !args.appVersion || !args.evidencePath) {
    process.stderr.write('Usage: node run.mjs --zipPath=<path> --expectedSha256=<sha> --appVersion=<version> --evidencePath=<path> [--resultsPath=<path>]\n')
    process.exit(1)
  }
  const evidence = await runInstalledHarness(args)
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
}

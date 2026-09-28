import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildEvidence, COLONY_INSTALLED_CASES, runInstalledHarness, verifyZipHash } from './run.mjs'

async function withTemp(run) {
  const root = await mkdtemp(path.join(tmpdir(), 'colony-installed-'))
  try { await run(root) } finally { await rm(root, { recursive: true, force: true }) }
}

test('1536:installed-harness:1 refuses a ZIP whose SHA-256 differs from the supplied manifest', async () => {
  await withTemp(async (root) => {
    const zipPath = path.join(root, 'Rhythm-arm64.zip')
    await writeFile(zipPath, 'not actually a zip, just some bytes')
    const wrongSha = 'a'.repeat(64)
    await assert.rejects(verifyZipHash({ zipPath, expectedSha256: wrongSha }), /hash mismatch/)
  })
})

test('1536:installed-harness:2 accepts a ZIP whose SHA-256 matches the supplied manifest', async () => {
  await withTemp(async (root) => {
    const zipPath = path.join(root, 'Rhythm-x64.zip')
    const bytes = 'a plausible zip payload'
    await writeFile(zipPath, bytes)
    const correctSha = createHash('sha256').update(bytes).digest('hex')
    assert.equal(await verifyZipHash({ zipPath, expectedSha256: correctSha }), correctSha)
  })
})

test('1536:installed-harness:3 rejects a manifest entry that is not a 64-hex SHA-256', async () => {
  await withTemp(async (root) => {
    const zipPath = path.join(root, 'Rhythm-arm64.zip')
    await writeFile(zipPath, 'bytes')
    await assert.rejects(verifyZipHash({ zipPath, expectedSha256: 'not-a-sha' }), /64-hex/)
  })
})

test('1536:installed-harness:4 evidence always includes artifactSha256, appVersion, osVersion and cpu', () => {
  const evidence = buildEvidence({ artifactSha256: 'a'.repeat(64), appVersion: '0.19.0', osVersion: 'macOS 14.5', cpu: 'arm64', results: {} })
  for (const field of ['artifactSha256', 'appVersion', 'osVersion', 'cpu']) {
    assert.equal(typeof evidence[field], 'string')
    assert.ok(evidence[field].length > 0, `${field} must be non-empty`)
  }
})

test('1536:installed-harness:5 a missing case is reported as not-run, never omitted', () => {
  const partial = { 'first-launch-disabled': 'pass', 'scanner-crash-retry': 'fail' }
  const evidence = buildEvidence({ artifactSha256: 'a'.repeat(64), appVersion: '0.19.0', osVersion: 'macOS 14.5', cpu: 'x64', results: partial })
  assert.equal(evidence.cases.length, COLONY_INSTALLED_CASES.length, 'every known case must appear, not just the ones a partial run touched')
  const byId = Object.fromEntries(evidence.cases.map((entry) => [entry.id, entry.status]))
  assert.equal(byId['first-launch-disabled'], 'pass')
  assert.equal(byId['scanner-crash-retry'], 'fail')
  for (const id of COLONY_INSTALLED_CASES) if (!(id in partial)) assert.equal(byId[id], 'not-run', `${id} was never run and must be reported not-run`)
})

test('1536:installed-harness:6 an unknown case id is rejected rather than silently accepted', () => {
  assert.throws(() => buildEvidence({ artifactSha256: 'a'.repeat(64), appVersion: '1', osVersion: 'macOS', cpu: 'arm64', results: { 'not-a-real-case': 'pass' } }), /Unknown Colony installed case/)
})

test('1536:installed-harness:7 runInstalledHarness verifies the archive, treats a missing results file as all not-run, and writes complete evidence', async () => {
  await withTemp(async (root) => {
    const zipPath = path.join(root, 'Rhythm-arm64.zip')
    const bytes = 'candidate archive bytes'
    await writeFile(zipPath, bytes)
    const expectedSha256 = createHash('sha256').update(bytes).digest('hex')
    const evidencePath = path.join(root, 'evidence.json')
    const evidence = await runInstalledHarness({ zipPath, expectedSha256, appVersion: '0.19.1', evidencePath, osVersion: 'macOS 14.5', cpu: 'arm64' })
    assert.equal(evidence.artifactSha256, expectedSha256)
    assert.ok(evidence.cases.every((entry) => entry.status === 'not-run'))
    const onDisk = JSON.parse(await readFile(evidencePath, 'utf8'))
    assert.deepEqual(onDisk, evidence)
  })
})

test('1536:installed-harness:8 runInstalledHarness refuses to write evidence for a tampered archive', async () => {
  await withTemp(async (root) => {
    const zipPath = path.join(root, 'Rhythm-arm64.zip')
    await writeFile(zipPath, 'original bytes')
    const expectedSha256 = createHash('sha256').update('original bytes').digest('hex')
    await writeFile(zipPath, 'tampered bytes')
    const evidencePath = path.join(root, 'evidence.json')
    await assert.rejects(runInstalledHarness({ zipPath, expectedSha256, appVersion: '0.19.1', evidencePath }), /hash mismatch/)
    await assert.rejects(readFile(evidencePath), /ENOENT/)
  })
})

test('1536:installed-harness:9 the contract lists COL-11-AC1..AC4, each mapped to a harness case or a manual step', async () => {
  const contract = JSON.parse(await readFile(new URL('../../../../docs/ai/contracts/colony-installed.json', import.meta.url), 'utf8'))
  const ids = contract.criteria.map((entry) => entry.criterion_id)
  assert.deepEqual(ids, ['COL-11-AC1', 'COL-11-AC2', 'COL-11-AC3', 'COL-11-AC4'])
  for (const criterion of contract.criteria) {
    assert.ok(Array.isArray(criterion.mapped_to) && criterion.mapped_to.length > 0, `${criterion.criterion_id} must map to at least one case or step`)
    for (const mapping of criterion.mapped_to) {
      assert.ok(['harness', 'manual'].includes(mapping.kind), `${criterion.criterion_id} mapping kind must be harness or manual`)
      if (mapping.kind === 'harness') assert.ok(COLONY_INSTALLED_CASES.includes(mapping.case), `${criterion.criterion_id} references unknown harness case ${mapping.case}`)
      else assert.ok(typeof mapping.step === 'string' && mapping.step.length > 0, `${criterion.criterion_id} manual mapping must name a manual-smoke step`)
    }
  }
})

test('1536:installed-harness:10 the manual-smoke section covers only visual click-through and real-Keychain steps', async () => {
  const manual = await readFile(new URL('../../../../docs/testing/manual-smoke.md', import.meta.url), 'utf8')
  const heading = '## 16. Colony (Bot Crossing) installed acceptance — issue #1536'
  const start = manual.indexOf(heading)
  assert.ok(start >= 0, 'manual-smoke.md must have the Colony installed-acceptance section')
  const nextHeading = manual.indexOf('\n## ', start + heading.length)
  const section = manual.slice(start, nextHeading === -1 ? undefined : nextHeading)
  assert.match(section, /Visual click-through/)
  assert.match(section, /Keychain/)
  // Automatable cases (enablement, empty/populated inventory, quit/relaunch, etc.) belong to the
  // harness, not this checklist; the section must say so rather than re-listing them as steps.
  assert.match(section, /harness/i)
})

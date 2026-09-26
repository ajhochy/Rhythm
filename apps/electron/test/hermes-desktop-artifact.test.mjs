import assert from 'node:assert/strict'
import { createHash, sign } from 'node:crypto'
import { mkdtemp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { resolveHermesDesktopArtifact } from '../src/hermes-desktop-artifact.mjs'
import { PINNED_HERMES_DESKTOP_SOURCE_COMMIT } from '../src/hermes-desktop-config.mjs'
import { stageHermesDesktopArtifact } from '../scripts/package-mac.mjs'
import { TEST_UPDATE_PRIVATE_KEY, TEST_UPDATE_PUBLIC_KEY, UNTRUSTED_UPDATE_PRIVATE_KEY } from './fixtures/hermes-desktop-test-keys.mjs'

const digest = (value) => `sha256-${createHash('sha256').update(value).digest('base64')}`
const WRONG_SOURCE_COMMIT = '0000000000000000000000000000000000000000'

async function writeArtifact(root, { sourceCommit = PINNED_HERMES_DESKTOP_SOURCE_COMMIT, tamperRenderer = false } = {}) {
  const renderer = '<main id="hermes-desktop">Desktop workspace</main>'
  const host = 'export async function createEmbeddedHermesHost() { return { dispose: async () => {}, handleIntent: async () => ({ ok: true }) } }\n'
  const preload = 'window.hermesDesktop = {}\n'
  await Promise.all([
    mkdir(path.join(root, 'renderer'), { recursive: true }),
    mkdir(path.join(root, 'electron'), { recursive: true }),
  ])
  await Promise.all([
    writeFile(path.join(root, 'renderer', 'index.html'), tamperRenderer ? `${renderer} tampered` : renderer),
    writeFile(path.join(root, 'electron', 'embedded-host.mjs'), host),
    writeFile(path.join(root, 'electron', 'preload.cjs'), preload),
    writeFile(path.join(root, 'manifest.json'), JSON.stringify({
      schemaVersion: 1,
      product: 'hermes-desktop',
      sourceCommit,
      electronMajor: 40,
      files: {
        renderer: 'renderer/index.html',
        host: 'electron/embedded-host.mjs',
        preload: 'electron/preload.cjs',
      },
      integrity: {
        'renderer/index.html': digest(renderer),
        'electron/embedded-host.mjs': digest(host),
        'electron/preload.cjs': digest(preload),
      },
    })),
  ])
}

async function writeV2Artifact(root, {
  dirty = false,
  electronVersion = '40.10.2',
  hermesVersion = '0.20.6',
  hostApiVersion = 1,
  includeSignature = true,
  sequence = 2,
  signer = TEST_UPDATE_PRIVATE_KEY,
  sourceDirty = false,
} = {}) {
  const renderer = '<main id="hermes-desktop">Desktop workspace v2</main>'
  const host = 'export async function createEmbeddedHermesHost() { return { dispose: async () => {}, handleIntent: async () => ({ ok: true }) } }\n'
  const preload = 'window.hermesDesktop = { version: 2 }\n'
  await Promise.all([
    mkdir(path.join(root, 'renderer'), { recursive: true }),
    mkdir(path.join(root, 'electron'), { recursive: true }),
  ])
  await Promise.all([
    writeFile(path.join(root, 'renderer', 'index.html'), renderer),
    writeFile(path.join(root, 'electron', 'embedded-host.mjs'), host),
    writeFile(path.join(root, 'electron', 'preload.cjs'), preload),
  ])
  const manifest = {
    schemaVersion: 2,
    product: 'hermes-desktop',
    sourceCommit: PINNED_HERMES_DESKTOP_SOURCE_COMMIT,
    hermesVersion,
    hostApiVersion,
    electronMajor: 40,
    electronVersion,
    sequence,
    dirty,
    sourceDirty,
    files: {
      renderer: 'renderer/index.html',
      host: 'electron/embedded-host.mjs',
      preload: 'electron/preload.cjs',
    },
    integrity: {
      'renderer/index.html': digest(renderer),
      'electron/embedded-host.mjs': digest(host),
      'electron/preload.cjs': digest(preload),
    },
  }
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)
  await writeFile(path.join(root, 'manifest.json'), manifestBytes)
  if (includeSignature) {
    await writeFile(path.join(root, 'manifest.sig'), `${sign(null, manifestBytes, signer).toString('base64')}\n`)
  }
  return manifest
}

const installedPolicy = {
  artifactSource: 'installed',
  expectedElectronMajor: 40,
  expectedElectronVersion: '40.10.2',
  minimumHermesVersion: '0.20.0',
  supportedHostApiVersions: [1],
  trustedPublicKeys: [TEST_UPDATE_PUBLIC_KEY],
}

test('issue-1570-a-c1: rejects a rewritten self-attesting manifest before reading payload files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rhythm-hermes-artifact-v2-'))
  const manifest = await writeV2Artifact(root)
  const changedRenderer = '<main id="hermes-desktop">attacker replacement</main>'
  manifest.integrity['renderer/index.html'] = digest(changedRenderer)
  await writeFile(path.join(root, 'renderer', 'index.html'), changedRenderer)
  await writeFile(path.join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  const reads = []

  await assert.rejects(
    () => resolveHermesDesktopArtifact({
      artifactRoot: root,
      ...installedPolicy,
      readFile: async (...args) => {
        reads.push(path.basename(args[0]))
        return readFile(...args)
      },
    }),
    /Hermes Desktop artifact is unavailable/,
  )
  assert.deepEqual(reads, ['manifest.json', 'manifest.sig'])
})

test('issue-1570-a-c2: rejects missing and untrusted installed-artifact signatures with the same unavailable outcome', async () => {
  const absentParent = await mkdtemp(path.join(tmpdir(), 'rhythm-hermes-artifact-v2-'))
  const absentRoot = path.join(absentParent, 'missing')
  const missingRoot = await mkdtemp(path.join(tmpdir(), 'rhythm-hermes-artifact-v2-'))
  const wrongRoot = await mkdtemp(path.join(tmpdir(), 'rhythm-hermes-artifact-v2-'))
  await writeV2Artifact(missingRoot, { includeSignature: false })
  await writeV2Artifact(wrongRoot, { signer: UNTRUSTED_UPDATE_PRIVATE_KEY })

  const errors = []
  for (const artifactRoot of [absentRoot, missingRoot, wrongRoot]) {
    try { await resolveHermesDesktopArtifact({ artifactRoot, ...installedPolicy }) }
    catch (error) { errors.push(error instanceof Error ? error.message : String(error)) }
  }
  assert.deepEqual(errors, [
    'Hermes Desktop artifact is unavailable.',
    'Hermes Desktop artifact is unavailable.',
    'Hermes Desktop artifact is unavailable.',
  ])
})

for (const field of ['dirty', 'sourceDirty']) {
  test(`issue-1570-a-c2: rejects a signed installed artifact with ${field}=true`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'rhythm-hermes-artifact-v2-'))
    await writeV2Artifact(root, { [field]: true })
    await assert.rejects(() => resolveHermesDesktopArtifact({ artifactRoot: root, ...installedPolicy }), /uncommitted source changes/i)
  })
}

test('issue-1570-a-c2: gates exact Electron version, supported host API, minimum Hermes version and replay sequence', async () => {
  const wrongElectron = await mkdtemp(path.join(tmpdir(), 'rhythm-hermes-artifact-v2-'))
  const wrongHost = await mkdtemp(path.join(tmpdir(), 'rhythm-hermes-artifact-v2-'))
  const oldHermes = await mkdtemp(path.join(tmpdir(), 'rhythm-hermes-artifact-v2-'))
  const replay = await mkdtemp(path.join(tmpdir(), 'rhythm-hermes-artifact-v2-'))
  await Promise.all([
    writeV2Artifact(wrongElectron, { electronVersion: '40.11.0' }),
    writeV2Artifact(wrongHost, { hostApiVersion: 2 }),
    writeV2Artifact(oldHermes, { hermesVersion: '0.19.9' }),
    writeV2Artifact(replay, { sequence: 1 }),
  ])

  await assert.rejects(() => resolveHermesDesktopArtifact({ artifactRoot: wrongElectron, ...installedPolicy }), /Electron 40.*40\.10\.2/i)
  await assert.rejects(() => resolveHermesDesktopArtifact({ artifactRoot: wrongHost, ...installedPolicy }), /host API version 2/i)
  await assert.rejects(() => resolveHermesDesktopArtifact({ artifactRoot: oldHermes, ...installedPolicy }), /Hermes version 0\.19\.9/i)
  await assert.rejects(() => resolveHermesDesktopArtifact({ artifactRoot: replay, ...installedPolicy, minimumSequence: 2 }), /sequence 1/i)
})

test('issue-1570-a-c3: resolves a valid signed v2 installed artifact', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rhythm-hermes-artifact-v2-'))
  await writeV2Artifact(root)

  const artifact = await resolveHermesDesktopArtifact({ artifactRoot: root, ...installedPolicy })
  assert.equal(artifact.manifest.hermesVersion, '0.20.6')
  assert.equal(artifact.manifest.hostApiVersion, 1)
  assert.equal(artifact.manifest.electronVersion, '40.10.2')
  assert.equal(artifact.manifest.sequence, 2)
})

test('issue-1542-desktop-c6: accepts a pinned, intact Desktop artifact and returns only local renderer and bridge paths', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rhythm-hermes-artifact-'))
  await writeArtifact(root)

  const artifact = await resolveHermesDesktopArtifact({
    artifactRoot: root,
    expectedElectronMajor: 40,
  })

  assert.equal(artifact.manifest.product, 'hermes-desktop')
  const canonicalRoot = await realpath(root)
  assert.equal(artifact.rendererPath, path.join(canonicalRoot, 'renderer', 'index.html'))
  assert.equal(artifact.hostPath, path.join(canonicalRoot, 'electron', 'embedded-host.mjs'))
  assert.equal(artifact.preloadPath, path.join(canonicalRoot, 'electron', 'preload.cjs'))
  assert.match(artifact.rendererUrl, /^file:/)
})

test('issue-1542-desktop-c6: refuses a modified renderer instead of falling back to the Hermes dashboard', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rhythm-hermes-artifact-'))
  await writeArtifact(root, { tamperRenderer: true })

  await assert.rejects(
    () => resolveHermesDesktopArtifact({ artifactRoot: root, expectedElectronMajor: 40 }),
    /integrity.*renderer\/index\.html/i,
  )
})

test('issue-1542-desktop-c6: refuses an artifact from a different Hermes source commit', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rhythm-hermes-artifact-'))
  await writeArtifact(root, { sourceCommit: WRONG_SOURCE_COMMIT })

  await assert.rejects(
    () => resolveHermesDesktopArtifact({ artifactRoot: root, expectedElectronMajor: 40, expectedSourceCommit: PINNED_HERMES_DESKTOP_SOURCE_COMMIT }),
    /different source commit/i,
  )
})

test('issue-1542-desktop-c6: package staging copies only a verified pinned artifact into Resources', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rhythm-hermes-artifact-'))
  const resources = await mkdtemp(path.join(tmpdir(), 'rhythm-resources-'))
  await writeArtifact(root)

  const staged = await stageHermesDesktopArtifact({ resources, artifactRoot: root })
  const artifact = await resolveHermesDesktopArtifact({ artifactRoot: staged, expectedElectronMajor: 40 })

  assert.equal(staged, path.join(resources, 'hermes-desktop'))
  assert.equal(artifact.manifest.sourceCommit, PINNED_HERMES_DESKTOP_SOURCE_COMMIT)
})

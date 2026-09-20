import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { resolveHermesDesktopArtifact } from '../src/hermes-desktop-artifact.mjs'
import { PINNED_HERMES_DESKTOP_SOURCE_COMMIT } from '../src/hermes-desktop-config.mjs'
import { stageHermesDesktopArtifact } from '../scripts/package-mac.mjs'

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

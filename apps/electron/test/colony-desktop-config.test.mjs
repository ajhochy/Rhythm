import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { resolveColonyArtifact } from '../src/colony-desktop-artifact.mjs'

const QUALIFIED_SOURCE_COMMIT = '52893a5f83e2bd9e1c581a106a4847b39356c852'

let config
let configImportError
try {
  config = await import('../src/colony-desktop-config.mjs')
} catch (error) {
  configImportError = error
}

const digest = (value) => `sha256-${createHash('sha256').update(value).digest('base64')}`

async function makeArtifact(sourceCommit) {
  const root = await mkdtemp(path.join(tmpdir(), 'rhythm-colony-config-'))
  const files = {
    'renderer/index.html': '<main>colony</main>\n',
    'server/host.mjs': 'export {}\n',
    'server/preload.cjs': 'module.exports = {}\n',
    'server/worker.mjs': 'export {}\n',
  }
  for (const [relative, value] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true })
    await writeFile(path.join(root, relative), value)
  }
  await writeFile(path.join(root, 'manifest.json'), `${JSON.stringify({
    schemaVersion: 1,
    product: 'colony',
    sourceCommit,
    electronMajor: 40,
    dirty: false,
    sourceDirty: false,
    files: {
      renderer: 'renderer/index.html',
      host: 'server/host.mjs',
      preload: 'server/preload.cjs',
      worker: 'server/worker.mjs',
    },
    integrity: Object.fromEntries(Object.entries(files).map(([relative, value]) => [relative, digest(value)])),
  })}\n`)
  return root
}

test('1526:colony-pin-module-and-pinned-build-inputs:1 exports the qualified immutable source pin', () => {
  assert.ifError(configImportError)
  assert.match(config?.PINNED_COLONY_SOURCE_COMMIT ?? '', /^[a-f0-9]{40}$/)
  assert.equal(config.PINNED_COLONY_SOURCE_COMMIT, QUALIFIED_SOURCE_COMMIT)
})

test('1526:colony-pin-module-and-pinned-build-inputs:2 keeps the Colony Electron floor aligned with the package runtime', async () => {
  assert.ifError(configImportError)
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(packageJson.devDependencies.electron, '40.10.2')
  assert.equal(Number(packageJson.devDependencies.electron.split('.')[0]), config.EXPECTED_COLONY_ELECTRON_MAJOR)
})

test('1526:colony-pin-module-and-pinned-build-inputs:3 rejects an artifact from any source commit other than the pin', async () => {
  assert.ifError(configImportError)
  const root = await makeArtifact('0'.repeat(40))
  try {
    await assert.rejects(
      resolveColonyArtifact({
        artifactRoot: root,
        expectedElectronMajor: config.EXPECTED_COLONY_ELECTRON_MAJOR,
        expectedSourceCommit: config.PINNED_COLONY_SOURCE_COMMIT,
      }),
      /source commit differs from pinned expected commit/i,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('1526:colony-pin-module-and-pinned-build-inputs:4 records every pinned build input in the integration plan', async () => {
  const plan = await readFile(new URL('../../../docs/ai/plans/2026-09-18-electron-colony.md', import.meta.url), 'utf8')
  const section = plan.match(/## Pinned build inputs\b[\s\S]*?(?=\n## |$)/)?.[0] ?? ''
  assert.match(section, new RegExp(QUALIFIED_SOURCE_COMMIT))
  assert.match(section, /Electron\s+40\.10\.2/)
  assert.match(section, /Node(?:\.js)?\s+22\.23\.0/)
  assert.match(section, /macOS\s+12\.0/)
})

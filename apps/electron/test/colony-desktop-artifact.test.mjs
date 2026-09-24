import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { lstat, mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

// This contract is intentionally written before the resolver exists. Catch the
// absent-module condition so `node --test` reports assertion failures (RED),
// rather than treating module loading itself as an unhandled test error.
let colonyArtifactModule
let colonyArtifactImportError
try {
  colonyArtifactModule = await import('../src/colony-desktop-artifact.mjs')
} catch (error) {
  colonyArtifactImportError = error
}

const EXPECTED_SOURCE_COMMIT = 'a'.repeat(40)
const WRONG_SOURCE_COMMIT = 'b'.repeat(40)
const ELECTRON_MAJOR = 40
const digest = (value) => `sha256-${createHash('sha256').update(value).digest('base64')}`

function requireResolver() {
  assert.equal(
    typeof colonyArtifactModule?.resolveColonyArtifact,
    'function',
    `CONTRACT RED: implement resolveColonyArtifact in apps/electron/src/colony-desktop-artifact.mjs before importing Colony artifacts (${colonyArtifactImportError?.message ?? 'export is missing'})`,
  )
  return colonyArtifactModule.resolveColonyArtifact
}

function requireResealer() {
  assert.equal(
    typeof colonyArtifactModule?.refreshColonyArtifactIntegrity,
    'function',
    `CONTRACT RED: implement refreshColonyArtifactIntegrity in apps/electron/src/colony-desktop-artifact.mjs (${colonyArtifactImportError?.message ?? 'export is missing'})`,
  )
  return colonyArtifactModule.refreshColonyArtifactIntegrity
}

async function makeArtifact(root, overrides = {}) {
  const files = {
    'renderer/index.html': '<main id="colony">synthetic renderer</main>\n',
    'host/colony-host.mjs': 'globalThis.__rhythmColonyArtifactImportCount = (globalThis.__rhythmColonyArtifactImportCount ?? 0) + 1\nglobalThis.__rhythmColonyNativeActionCount = (globalThis.__rhythmColonyNativeActionCount ?? 0) + 1\nglobalThis.__rhythmColonyStateWriteCount = (globalThis.__rhythmColonyStateWriteCount ?? 0) + 1\nexport const host = "synthetic"\n',
    'preload/colony-preload.cjs': 'module.exports = {}\n',
    'assets/scene.glb': 'synthetic scene bytes\n',
  }
  for (const [entry, contents] of Object.entries(files)) {
    const file = path.join(root, entry)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, contents)
  }

  const manifest = {
    schemaVersion: 1,
    product: 'colony',
    sourceCommit: EXPECTED_SOURCE_COMMIT,
    electronMajor: ELECTRON_MAJOR,
    dirty: false,
    sourceDirty: false,
    files: {
      renderer: 'renderer/index.html',
      host: 'host/colony-host.mjs',
      preload: 'preload/colony-preload.cjs',
    },
    integrity: Object.fromEntries(Object.entries(files).map(([entry, contents]) => [entry, digest(contents)])),
  }
  Object.assign(manifest, overrides.manifest)
  await writeFile(path.join(root, 'manifest.json'), overrides.manifestText ?? `${JSON.stringify(manifest, null, 2)}\n`)
  return { manifest, files }
}

async function artifactRoot() {
  return mkdtemp(path.join(tmpdir(), 'rhythm-colony-artifact-contract-'))
}

async function treeSnapshot(root) {
  const result = []
  async function visit(directory) {
    for (const entry of (await readdir(directory)).sort()) {
      const file = path.join(directory, entry)
      const metadata = await lstat(file)
      const relative = path.relative(root, file).split(path.sep).join('/')
      if (metadata.isDirectory()) {
        result.push([relative, 'directory'])
        await visit(file)
      } else if (metadata.isSymbolicLink()) {
        result.push([relative, 'symlink', await readFile(file, 'utf8').catch(() => '')])
      } else if (metadata.isFile()) {
        result.push([relative, 'file', (await readFile(file)).toString('base64')])
      } else {
        result.push([relative, 'other'])
      }
    }
  }
  await visit(root)
  return result
}

async function rejectedWithoutArtifactEffects({ name, reason, setup = async () => {}, options = {}, seenReasons = [] }) {
  const root = await artifactRoot()
  const { manifest } = await makeArtifact(root)
  await setup({ root, manifest })
  const before = await treeSnapshot(root).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
  const priorEffects = {
    import: globalThis.__rhythmColonyArtifactImportCount,
    native: globalThis.__rhythmColonyNativeActionCount,
    state: globalThis.__rhythmColonyStateWriteCount,
  }
  globalThis.__rhythmColonyArtifactImportCount = 0
  globalThis.__rhythmColonyNativeActionCount = 0
  globalThis.__rhythmColonyStateWriteCount = 0
  let refusalMessage
  try {
    await assert.rejects(
      () => requireResolver()({
        artifactRoot: root,
        expectedElectronMajor: ELECTRON_MAJOR,
        expectedSourceCommit: EXPECTED_SOURCE_COMMIT,
        ...options,
      }),
      (error) => {
        assert.match(error.message, reason, `${name} must explain the refusal and how to fix it`)
        refusalMessage = error.message
        return true
      },
    )
    if (name !== 'allowDirty is the only dirty relaxation') {
      assert.ok(!seenReasons.includes(refusalMessage), `${name} must have a distinct actionable refusal reason`)
      seenReasons.push(refusalMessage)
    }
    const after = await treeSnapshot(root).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
    assert.deepEqual(after, before, `${name} must not write artifact or application state`)
    assert.equal(globalThis.__rhythmColonyArtifactImportCount, 0, `${name} must not import artifact code`)
    assert.equal(globalThis.__rhythmColonyNativeActionCount, 0, `${name} must trigger zero native actions`)
    assert.equal(globalThis.__rhythmColonyStateWriteCount, 0, `${name} must trigger zero state writes`)
  } finally {
    await import('node:fs/promises').then(({ rm }) => rm(root, { recursive: true, force: true }))
    if (priorEffects.import === undefined) delete globalThis.__rhythmColonyArtifactImportCount
    else globalThis.__rhythmColonyArtifactImportCount = priorEffects.import
    if (priorEffects.native === undefined) delete globalThis.__rhythmColonyNativeActionCount
    else globalThis.__rhythmColonyNativeActionCount = priorEffects.native
    if (priorEffects.state === undefined) delete globalThis.__rhythmColonyStateWriteCount
    else globalThis.__rhythmColonyStateWriteCount = priorEffects.state
  }
}

test('issue-1527-c1: resolves a sealed synthetic artifact and exposes only verified local entries', async () => {
  const root = await artifactRoot()
  try {
    await makeArtifact(root)
    const artifact = await requireResolver()({
      artifactRoot: root,
      expectedElectronMajor: ELECTRON_MAJOR,
      expectedSourceCommit: EXPECTED_SOURCE_COMMIT,
    })
    assert.equal(artifact.manifest.product, 'colony')
    assert.equal(artifact.rendererPath, path.join(root, 'renderer/index.html'))
    assert.equal(artifact.hostPath, path.join(root, 'host/colony-host.mjs'))
    assert.equal(artifact.preloadPath, path.join(root, 'preload/colony-preload.cjs'))
  } finally {
    await import('node:fs/promises').then(({ rm }) => rm(root, { recursive: true, force: true }))
  }
})

test('issue-1527-c1: rejects each unprovable artifact with a distinct actionable reason and no import or write', async (t) => {
  const seenReasons = []
  const refusals = [
    { name: 'missing artifact root', reason: /missing.*artifact|artifact.*missing/i, setup: async ({ root }) => { await import('node:fs/promises').then(({ rm }) => rm(root, { recursive: true, force: true })) } },
    { name: 'missing manifest', reason: /manifest.*missing|missing.*manifest/i, setup: async ({ root }) => { await import('node:fs/promises').then(({ rm }) => rm(path.join(root, 'manifest.json'))) } },
    { name: 'unreadable or malformed manifest', reason: /manifest.*(unreadable|invalid|parse)|(?:unreadable|invalid|parse).*manifest/i, setup: async ({ root }) => writeFile(path.join(root, 'manifest.json'), '{broken') },
    { name: 'non-object manifest', reason: /manifest.*(object|invalid)|(?:object|invalid).*manifest/i, setup: async ({ root }) => writeFile(path.join(root, 'manifest.json'), '[]') },
    { name: 'schema version mismatch', reason: /schema.*(version|unsupported|incompatible)|(?:version|unsupported|incompatible).*schema/i, setup: async ({ root, manifest }) => writeFile(path.join(root, 'manifest.json'), JSON.stringify({ ...manifest, schemaVersion: 2 })) },
    { name: 'product mismatch', reason: /product.*(colony|mismatch|incompatible)|(?:colony|mismatch|incompatible).*product/i, setup: async ({ root, manifest }) => writeFile(path.join(root, 'manifest.json'), JSON.stringify({ ...manifest, product: 'other-product' })) },
    { name: 'malformed source commit', reason: /source.*commit.*(40|hex|invalid|malformed)|(?:40|hex|invalid|malformed).*source/i, setup: async ({ root, manifest }) => writeFile(path.join(root, 'manifest.json'), JSON.stringify({ ...manifest, sourceCommit: 'not-a-commit' })) },
    { name: 'source commit differs from pin', reason: /source.*commit.*(different|pinned|expected)|(?:different|pinned|expected).*source/i, setup: async ({ root, manifest }) => writeFile(path.join(root, 'manifest.json'), JSON.stringify({ ...manifest, sourceCommit: WRONG_SOURCE_COMMIT })) },
    { name: 'Electron major mismatch', reason: /electron.*major.*(match|mismatch|incompatible|40)|(?:major|incompatible).*electron/i, setup: async ({ root, manifest }) => writeFile(path.join(root, 'manifest.json'), JSON.stringify({ ...manifest, electronMajor: ELECTRON_MAJOR + 1 })) },
    { name: 'dirty source refused by default', reason: /dirty|uncommitted/i, setup: async ({ root, manifest }) => writeFile(path.join(root, 'manifest.json'), JSON.stringify({ ...manifest, dirty: true })) },
    { name: 'sourceDirty refused by default', reason: /dirty|uncommitted/i, setup: async ({ root, manifest }) => writeFile(path.join(root, 'manifest.json'), JSON.stringify({ ...manifest, sourceDirty: true })) },
    { name: 'dirty must be boolean', reason: /dirty.*boolean|boolean.*dirty/i, setup: async ({ root, manifest }) => writeFile(path.join(root, 'manifest.json'), JSON.stringify({ ...manifest, dirty: 'false' })) },
    { name: 'sourceDirty must be boolean', reason: /sourceDirty.*boolean|boolean.*sourceDirty/i, setup: async ({ root, manifest }) => writeFile(path.join(root, 'manifest.json'), JSON.stringify({ ...manifest, sourceDirty: 0 })) },
    { name: 'allowDirty is the only dirty relaxation', reason: /dirty|uncommitted/i, options: { allowDirty: false }, setup: async ({ root, manifest }) => writeFile(path.join(root, 'manifest.json'), JSON.stringify({ ...manifest, dirty: true })) },
    { name: 'integrity must be nonempty', reason: /integrity.*(empty|missing|metadata)|(?:empty|missing|metadata).*integrity/i, setup: async ({ root, manifest }) => writeFile(path.join(root, 'manifest.json'), JSON.stringify({ ...manifest, integrity: {} })) },
    { name: 'duplicate integrity entry', reason: /duplicate|integrity.*(duplicate|invalid)/i, setup: async ({ root, manifest }) => {
      const encoded = JSON.stringify(manifest)
      const key = '"renderer/index.html":'
      const index = encoded.indexOf(key)
      const valueStart = index + key.length
      const valueEnd = encoded.indexOf(',', valueStart)
      const pair = encoded.slice(index, valueEnd < 0 ? encoded.indexOf('}', valueStart) : valueEnd)
      await writeFile(path.join(root, 'manifest.json'), `${encoded.slice(0, index)}${pair},${pair}${encoded.slice(valueEnd < 0 ? encoded.indexOf('}', valueStart) : valueEnd)}`)
    } },
    { name: 'malformed SRI', reason: /integrity.*(invalid|SRI|sha)|(?:invalid|SRI|sha).*integrity/i, setup: async ({ root, manifest }) => writeFile(path.join(root, 'manifest.json'), JSON.stringify({ ...manifest, integrity: { ...manifest.integrity, 'renderer/index.html': 'sha256-not-sri' } })) },
    { name: 'digest mismatch after one-byte corruption', reason: /integrity.*(check|mismatch|failed)|(?:check|mismatch|failed).*integrity/i, setup: async ({ root }) => {
      const file = path.join(root, 'renderer/index.html')
      const bytes = await readFile(file)
      bytes[0] ^= 1
      await writeFile(file, bytes)
    } },
    { name: 'tree file missing from integrity', reason: /unverified.*(file|renderer)|integrity.*(missing|unverified)/i, setup: async ({ root }) => writeFile(path.join(root, 'unlisted.txt'), 'unsealed') },
    { name: 'symlink refused', reason: /symlink|symbolic link/i, setup: async ({ root }) => symlink(path.join(root, 'renderer/index.html'), path.join(root, 'renderer/link.html')) },
    { name: 'non-regular manifest entry refused', reason: /not a regular file|non-regular|unsupported entry/i, setup: async ({ root, manifest }) => {
      await mkdir(path.join(root, 'unexpected-directory'))
      await writeFile(path.join(root, 'manifest.json'), JSON.stringify({ ...manifest, integrity: { ...manifest.integrity, 'unexpected-directory': digest('directory') } }))
    } },
    { name: 'absolute manifest path refused', reason: /path.*(invalid|absolute|escape)|(?:invalid|absolute|escape).*path/i, setup: async ({ root, manifest }) => writeFile(path.join(root, 'manifest.json'), JSON.stringify({ ...manifest, files: { ...manifest.files, renderer: path.join(root, 'renderer/index.html') } })) },
    { name: 'escaping manifest path refused', reason: /path.*(invalid|escape|root)|(?:invalid|escape|root).*path/i, setup: async ({ root, manifest }) => writeFile(path.join(root, 'manifest.json'), JSON.stringify({ ...manifest, files: { ...manifest.files, renderer: '../outside.html' } })) },
    { name: 'missing renderer entry refused', reason: /manifest.*renderer|renderer.*(missing|required)/i, setup: async ({ root, manifest }) => writeFile(path.join(root, 'manifest.json'), JSON.stringify({ ...manifest, files: { host: manifest.files.host, preload: manifest.files.preload } })) },
    { name: 'missing host entry refused', reason: /manifest.*host|host.*(missing|required)/i, setup: async ({ root, manifest }) => writeFile(path.join(root, 'manifest.json'), JSON.stringify({ ...manifest, files: { renderer: manifest.files.renderer, preload: manifest.files.preload } })) },
    { name: 'missing preload entry refused', reason: /manifest.*preload|preload.*(missing|required)/i, setup: async ({ root, manifest }) => writeFile(path.join(root, 'manifest.json'), JSON.stringify({ ...manifest, files: { renderer: manifest.files.renderer, host: manifest.files.host } })) },
    { name: 'required entry absent from integrity refused', reason: /integrity.*(missing|required|renderer)|(?:missing|required|renderer).*integrity/i, setup: async ({ root, manifest }) => {
      const integrity = { ...manifest.integrity }
      delete integrity['renderer/index.html']
      await writeFile(path.join(root, 'manifest.json'), JSON.stringify({ ...manifest, integrity }))
    } },
    { name: 'host entry absent from integrity refused', reason: /integrity.*(missing|required|host)|(?:missing|required|host).*integrity/i, setup: async ({ root, manifest }) => {
      const integrity = { ...manifest.integrity }
      delete integrity['host/colony-host.mjs']
      await writeFile(path.join(root, 'manifest.json'), JSON.stringify({ ...manifest, integrity }))
    } },
    { name: 'preload entry absent from integrity refused', reason: /integrity.*(missing|required|preload)|(?:missing|required|preload).*integrity/i, setup: async ({ root, manifest }) => {
      const integrity = { ...manifest.integrity }
      delete integrity['preload/colony-preload.cjs']
      await writeFile(path.join(root, 'manifest.json'), JSON.stringify({ ...manifest, integrity }))
    } },
  ]

  for (const refusal of refusals) {
    await t.test(refusal.name, async () => rejectedWithoutArtifactEffects({ ...refusal, seenReasons }))
  }
})

test('issue-1527-c1: allowDirty accepts only boolean dirty metadata when explicitly requested', async () => {
  const root = await artifactRoot()
  try {
    const { manifest } = await makeArtifact(root)
    await writeFile(path.join(root, 'manifest.json'), JSON.stringify({ ...manifest, dirty: true }))
    const artifact = await requireResolver()({
      artifactRoot: root,
      expectedElectronMajor: ELECTRON_MAJOR,
      expectedSourceCommit: EXPECTED_SOURCE_COMMIT,
      allowDirty: true,
    })
    assert.equal(artifact.manifest.dirty, true)
  } finally {
    await import('node:fs/promises').then(({ rm }) => rm(root, { recursive: true, force: true }))
  }
})

test('issue-1527-c1: reseals an artifact after post-signing byte changes so its new digest resolves', async () => {
  const root = await artifactRoot()
  try {
    await makeArtifact(root)
    await writeFile(path.join(root, 'assets/scene.glb'), 'post-signing scene bytes\n')
    await requireResealer()({ artifactRoot: root })
    const artifact = await requireResolver()({
      artifactRoot: root,
      expectedElectronMajor: ELECTRON_MAJOR,
      expectedSourceCommit: EXPECTED_SOURCE_COMMIT,
    })
    assert.equal(artifact.manifest.integrity['assets/scene.glb'], digest('post-signing scene bytes\n'))
  } finally {
    await import('node:fs/promises').then(({ rm }) => rm(root, { recursive: true, force: true }))
  }
})

test('issue-1527-c1: refuses a symlink artifact root and a symlink manifest', async () => {
  const root = await artifactRoot()
  const link = `${root}-link`
  try {
    await makeArtifact(root)
    await symlink(root, link)
    const resolve = requireResolver()
    const options = { expectedElectronMajor: ELECTRON_MAJOR, expectedSourceCommit: EXPECTED_SOURCE_COMMIT }
    await assert.rejects(() => resolve({ artifactRoot: link, ...options }), /root.*symlink/i)
    await import('node:fs/promises').then(({ rm }) => rm(path.join(root, 'manifest.json')))
    await symlink(path.join(root, 'renderer/index.html'), path.join(root, 'manifest.json'))
    await assert.rejects(() => resolve({ artifactRoot: root, ...options }), /manifest.*symlink/i)
  } finally {
    await import('node:fs/promises').then(({ rm }) => Promise.all([rm(link, { force: true }), rm(root, { recursive: true, force: true })]))
  }
})

test('issue-1527-c1: refuses an oversized manifest before reading it', async () => {
  const root = await artifactRoot()
  try {
    await makeArtifact(root)
    await writeFile(path.join(root, 'manifest.json'), ' '.repeat(1024 * 1024 + 1))
    await assert.rejects(() => requireResolver()({ artifactRoot: root, expectedElectronMajor: ELECTRON_MAJOR, expectedSourceCommit: EXPECTED_SOURCE_COMMIT }), /manifest.*oversized/i)
  } finally {
    await import('node:fs/promises').then(({ rm }) => rm(root, { recursive: true, force: true }))
  }
})

test('issue-1527-c1: refuses a FIFO without opening or reading it', async () => {
  const root = await artifactRoot()
  try {
    await makeArtifact(root)
    execFileSync('mkfifo', [path.join(root, 'unexpected-pipe')])
    await assert.rejects(() => requireResolver()({ artifactRoot: root, expectedElectronMajor: ELECTRON_MAJOR, expectedSourceCommit: EXPECTED_SOURCE_COMMIT }), /non-regular|unsupported entry/i)
  } finally {
    await import('node:fs/promises').then(({ rm }) => rm(root, { recursive: true, force: true }))
  }
})

test('issue-1527-c1: rejects unsafe paths in every declared file entry', async () => {
  const root = await artifactRoot()
  try {
    const { manifest } = await makeArtifact(root)
    await writeFile(path.join(root, 'manifest.json'), JSON.stringify({
      ...manifest, files: { ...manifest.files, additionalAsset: '/outside/unverified.glb' },
    }))
    await assert.rejects(() => requireResolver()({
      artifactRoot: root, expectedElectronMajor: ELECTRON_MAJOR,
      expectedSourceCommit: EXPECTED_SOURCE_COMMIT,
    }), /path.*(invalid|absolute|escape)|unverified|unsupported.*entry/i)
  } finally {
    await import('node:fs/promises').then(({ rm }) => rm(root, { recursive: true, force: true }))
  }
})

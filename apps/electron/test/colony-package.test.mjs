import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { assertPackagedModuleGraph, stageColonyArtifact } from '../scripts/package-mac.mjs'
import { EXPECTED_COLONY_ELECTRON_MAJOR, PINNED_COLONY_SOURCE_COMMIT } from '../src/colony-desktop-config.mjs'

const scriptsDir = fileURLToPath(new URL('../scripts', import.meta.url))
const srcDir = fileURLToPath(new URL('../src', import.meta.url))
const sharedProductionApiBase = fileURLToPath(new URL('../../shared/production-api-base.mjs', import.meta.url))

/** A minimal but structurally valid Colony artifact, built fresh per test so each test can
 * corrupt exactly the field it wants to exercise. */
async function makeColonyArtifact(root, overrides = {}) {
  const files = {
    'renderer/index.html': '<!doctype html><title>Colony</title>',
    'server/embedded-host.mjs': 'export const product = "colony"',
    'server/embedded-preload.cjs': 'module.exports = {}',
    'server/embedded-worker.mjs': 'process.exit(0)',
  }
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true })
    await writeFile(path.join(root, name), content)
  }
  const manifest = {
    schemaVersion: 1, product: 'colony', sourceCommit: PINNED_COLONY_SOURCE_COMMIT, electronMajor: EXPECTED_COLONY_ELECTRON_MAJOR,
    nodeVersion: process.versions.node, dirty: false, sourceDirty: false,
    files: { renderer: 'renderer/index.html', host: 'server/embedded-host.mjs', preload: 'server/embedded-preload.cjs', worker: 'server/embedded-worker.mjs' },
    integrity: Object.fromEntries(Object.entries(files).map(([name, value]) => [name, `sha256-${createHash('sha256').update(value).digest('base64')}`])),
    ...overrides,
  }
  await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest))
  return manifest
}

async function withTemp(run) {
  const root = await mkdtemp(path.join(tmpdir(), 'colony-package-'))
  try { await run(root) } finally { await rm(root, { recursive: true, force: true }) }
}

test('1534:stage-colony-artifact:1 the unset env var throws an actionable message naming RHYTHM_COLONY_ARTIFACT_DIR', async () => {
  await withTemp(async (root) => {
    await assert.rejects(
      stageColonyArtifact({ resources: path.join(root, 'Resources'), artifactRoot: '' }),
      /RHYTHM_COLONY_ARTIFACT_DIR/,
    )
  })
})

test('1534:stage-colony-artifact:2 a dirty source artifact throws', async () => {
  await withTemp(async (root) => {
    const artifactRoot = path.join(root, 'artifact')
    await makeColonyArtifact(artifactRoot, { dirty: true })
    await assert.rejects(stageColonyArtifact({ resources: path.join(root, 'Resources'), artifactRoot }), /dirty/)
  })
})

test('1534:stage-colony-artifact:3 a wrong-commit source artifact throws', async () => {
  await withTemp(async (root) => {
    const artifactRoot = path.join(root, 'artifact')
    await makeColonyArtifact(artifactRoot, { sourceCommit: 'b'.repeat(40) })
    await assert.rejects(stageColonyArtifact({ resources: path.join(root, 'Resources'), artifactRoot }), /source commit/)
  })
})

test('1534:stage-colony-artifact:4 a corrupt source artifact throws', async () => {
  await withTemp(async (root) => {
    const artifactRoot = path.join(root, 'artifact')
    await makeColonyArtifact(artifactRoot)
    await writeFile(path.join(artifactRoot, 'server/embedded-host.mjs'), 'export const product = "tampered"')
    await assert.rejects(stageColonyArtifact({ resources: path.join(root, 'Resources'), artifactRoot }), /integrity/)
  })
})

test('1534:stage-colony-artifact:5 a manifest.nodeVersion different from process.versions.node throws', async () => {
  await withTemp(async (root) => {
    const artifactRoot = path.join(root, 'artifact')
    await makeColonyArtifact(artifactRoot, { nodeVersion: '0.0.0' })
    await assert.rejects(stageColonyArtifact({ resources: path.join(root, 'Resources'), artifactRoot }), /Node version/)
  })
})

test('1534:stage-colony-artifact:6 a valid artifact is copied and revalidated at <resources>/colony-desktop', async () => {
  await withTemp(async (root) => {
    const artifactRoot = path.join(root, 'artifact')
    await makeColonyArtifact(artifactRoot)
    const resources = path.join(root, 'Resources')
    const destination = await stageColonyArtifact({ resources, artifactRoot })
    assert.equal(destination, path.join(resources, 'colony-desktop'))
    const staged = JSON.parse(await readFile(path.join(destination, 'manifest.json'), 'utf8'))
    assert.equal(staged.sourceCommit, PINNED_COLONY_SOURCE_COMMIT)
    // Corrupting the staged copy (not the source) must also be caught: proves it was
    // independently revalidated at the destination, not just trusted from the source check.
    await writeFile(path.join(destination, 'server/embedded-host.mjs'), 'tampered')
    const { resolveColonyArtifact } = await import('../src/colony-desktop-artifact.mjs')
    await assert.rejects(resolveColonyArtifact({ artifactRoot: destination, expectedElectronMajor: EXPECTED_COLONY_ELECTRON_MAJOR, expectedSourceCommit: PINNED_COLONY_SOURCE_COMMIT }), /integrity/)
  })
})

test('1534:stage-colony-artifact:7 package-mac.mjs orders deep codesign, refreshColonyArtifactIntegrity, resolveColonyArtifact, then outer-only codesign', async () => {
  const source = await readFile(path.join(scriptsDir, 'package-mac.mjs'), 'utf8')
  const deepSign = source.indexOf("run('codesign', ['--force', '--deep', '--sign', '-', stagingArtifact]")
  const reseal = source.indexOf('refreshColonyArtifactIntegrity({ artifactRoot: stagedColonyArtifact }')
  const revalidate = source.indexOf('resolveColonyArtifact({\n  artifactRoot: stagedColonyArtifact')
  const outerSign = source.lastIndexOf("run('codesign', ['--force', '--sign', '-', stagingArtifact]")
  assert.ok(deepSign >= 0 && reseal >= 0 && revalidate >= 0 && outerSign >= 0, 'all four ordered steps must be present in package-mac.mjs')
  assert.ok(deepSign < reseal, 'deep codesign must precede the Colony integrity reseal')
  assert.ok(reseal < revalidate, 'the reseal must precede the destination revalidation')
  assert.ok(revalidate < outerSign, 'revalidation must precede the final outer-only codesign')
  // stageColonyArtifact runs during staging, well before the deep codesign call above.
  assert.ok(source.indexOf('await stageColonyArtifact({ resources })') < deepSign)
})

test('1534:stage-colony-artifact:8 sign-and-notarize-mac.mjs reseals Colony before its verify', async () => {
  const source = await readFile(path.join(scriptsDir, 'sign-and-notarize-mac.mjs'), 'utf8')
  const reseal = source.indexOf('refreshColonyArtifactIntegrity({ artifactRoot: colonyDesktopArtifact }')
  const revalidate = source.indexOf('resolveColonyArtifact({\n  artifactRoot: colonyDesktopArtifact')
  const outerSign = source.indexOf("codesign(artifact, { deep: false })")
  const verify = source.indexOf("run('codesign', ['--verify', '--deep'")
  assert.ok(reseal >= 0 && revalidate >= 0 && outerSign >= 0 && verify >= 0)
  assert.ok(reseal < outerSign, 'Colony must be resealed before the outer app is (re)signed')
  assert.ok(revalidate < outerSign, 'Colony must be revalidated before the outer app is (re)signed')
  assert.ok(outerSign < verify, 'the outer app is signed before the final strict verify')
})

test('1534:stage-colony-artifact:9a package-mac.mjs copies the whole src/ tree (not a hand-maintained per-file list)', async () => {
  const packageSource = await readFile(path.join(scriptsDir, 'package-mac.mjs'), 'utf8')
  assert.ok(
    packageSource.includes("cp(resolve(electronRoot, 'src'), resolve(packagedApp, 'src'), {"),
    'package-mac.mjs must copy the entire src/ directory in one cp() call',
  )
  assert.ok(
    !/cp\(resolve\(electronRoot, 'src\/colony-[\w-]+\.mjs'\)/.test(packageSource),
    'package-mac.mjs must not hand-list individual colony-*.mjs files: the src/ tree copy already covers them',
  )
})

test('1534:stage-colony-artifact:9b the packaged-app module-graph guard reaches every colony-*.mjs the runtime imports from main.mjs', async () => {
  // Walk the real import graph starting at main.mjs, exactly like the runtime does, to find
  // every colony-*.mjs file that must be reachable.
  const specifierRe = /from '\.\/(colony-[\w-]+\.mjs)'/g
  const colonyFiles = new Set()
  const queue = ['main.mjs']
  const walked = new Set()
  while (queue.length) {
    const file = queue.pop()
    if (walked.has(file)) continue
    walked.add(file)
    const contents = await readFile(path.join(srcDir, file), 'utf8')
    for (const match of contents.matchAll(/from '\.\/([\w-]+\.mjs)'/g)) if (!walked.has(match[1])) queue.push(match[1])
    for (const match of contents.matchAll(specifierRe)) colonyFiles.add(match[1])
  }
  assert.ok(colonyFiles.size >= 6, 'sanity: the Colony graph reachable from main.mjs should have several files')

  await withTemp(async (root) => {
    // Stage packagedApp/src plus its two sibling out-of-tree dependencies the same way
    // package-mac.mjs does: the whole src/ tree (filtered), the generated build-config.mjs,
    // and the shared production-api-base.mjs two levels up (resources/shared/...).
    const stagedApp = path.join(root, 'Resources', 'app')
    const stagedSrc = path.join(stagedApp, 'src')
    await cp(srcDir, stagedSrc, {
      recursive: true,
      filter: (source) => !source.endsWith('.d.mts') && path.basename(source) !== 'build-config.mjs',
    })
    await writeFile(path.join(stagedSrc, 'build-config.mjs'), "export const GOOGLE_DESKTOP_CLIENT_ID = '';\nexport const RHYTHM_AUTH_API_BASE = '';\n")
    await mkdir(path.join(root, 'Resources', 'shared'), { recursive: true })
    await cp(sharedProductionApiBase, path.join(root, 'Resources', 'shared', 'production-api-base.mjs'))
    // The real guard call must pass with every colony module present and reachable.
    await assertPackagedModuleGraph(stagedSrc, ['main.mjs', 'preload.cjs', 'hermes-view-preload.cjs'])

    // Removing a colony module that main.mjs transitively imports must fail the guard: proves
    // those modules are genuinely inside the checked graph, not just incidentally copied.
    const [sampleColonyFile] = colonyFiles
    await rm(path.join(stagedSrc, sampleColonyFile))
    await assert.rejects(
      assertPackagedModuleGraph(stagedSrc, ['main.mjs', 'preload.cjs', 'hermes-view-preload.cjs']),
      new RegExp(sampleColonyFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      `the module-graph guard must catch a missing ${sampleColonyFile}`,
    )
  })
})

test('1534:stage-colony-artifact:10 a packagedNode probe requires node:sqlite next to the better-sqlite3 probe', async () => {
  const source = await readFile(path.join(scriptsDir, 'package-mac.mjs'), 'utf8')
  const betterSqlite3 = source.indexOf("require(root+'/node_modules/better-sqlite3')")
  const nodeSqlite = source.indexOf("require('node:sqlite')")
  assert.ok(betterSqlite3 >= 0 && nodeSqlite >= 0)
  assert.ok(betterSqlite3 < nodeSqlite, 'the node:sqlite probe belongs after the better-sqlite3 probe')
})

test('1534:stage-colony-artifact:11 this file is registered in npm run test:package', async () => {
  const packageJson = JSON.parse(await readFile(path.join(scriptsDir, '..', 'package.json'), 'utf8'))
  assert.match(packageJson.scripts['test:package'], /colony-package\.test\.mjs/)
})

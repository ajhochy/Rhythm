import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { registerColonyHost } from '../src/colony-host.mjs'
import { createColonyService } from '../src/colony-service.mjs'
import { makeArtifact, sourceCommit } from './support/colony-native-fixture.mjs'

const importWorker = `
process.on('message', message => {
  if (message.type === 'colony:init') process.send({ type:'colony:ready', v:1, product:'colony', documentId:message.documentId, capabilities:['inventory-v1','state-v1','host-intents-v1','state-mark-v1','import-v1'], runtime:{ node:process.versions.node, sqlite:true } })
  else if (message.type === 'colony:import-preview') process.send({ type:'colony:import-preview-result', v:1, documentId:message.documentId, counts:{ archived:7000, viewed:4, groups:2, version:3 } })
  else if (message.type === 'colony:import-commit') process.send({ type:'colony:import-commit-result', v:1, documentId:message.documentId, receipt:{ updatedAt:42, counts:{ archived:7000, viewed:4, groups:2 } } })
  else if (message.type === 'colony:backup-restore') process.send({ type:'colony:backup-restore-result', v:1, documentId:message.documentId, receipt:{ updatedAt:43, counts:{ archived:1, viewed:0, groups:0 } } })
  else if (message.type === 'colony:dispose') process.exit(0)
})
process.on('disconnect', () => process.exit(0))
`

test('1532:settings-import-account-switch:1 service control forwards only closed parent controls', async (t) => {
  // Regression caught: arbitrary worker messages or renderer-shaped controls reach the owned child.
  const root = await mkdtemp(path.join(tmpdir(), 'rhythm-colony-import-service-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const artifactRoot = path.join(root, 'artifact')
  await makeArtifact(artifactRoot, importWorker)
  const service = createColonyService({
    isPackaged: false, developmentNodePath: process.execPath, resourcesPath: path.join(root, 'Resources'), artifactRoot,
    expectedSourceCommit: sourceCommit, expectedElectronMajor: 40, dataDir: path.join(root, 'owned'), sources: [], enabled: () => true,
    startupTimeoutMs: 1000, stopTimeoutMs: 100,
  })
  t.after(() => service.dispose())
  await service.start({ documentId: 'import-document' })
  assert.deepEqual(await service.control({ type: 'importPreview', path: path.join(root, 'standalone.json') }), { archived: 7000, viewed: 4, groups: 2, version: 3 })
  assert.deepEqual(await service.control({ type: 'importCommit', path: path.join(root, 'standalone.json') }), { updatedAt: 42, counts: { archived: 7000, viewed: 4, groups: 2 } })
  assert.deepEqual(await service.control({ type: 'backupRestore', backup: 'state-41.json' }), { updatedAt: 43, counts: { archived: 1, viewed: 0, groups: 0 } })
  await assert.rejects(() => service.control({ type: 'inventory.page', path: '/tmp/x' }), /control|unsupported|invalid/i)
  await assert.rejects(() => service.control({ type: 'importPreview', path: 'relative.json' }), /absolute|invalid/i)
  await assert.rejects(() => service.control({ type: 'backupRestore', backup: '../state-1.json' }), /backup|invalid/i)
})

test('1532:settings-import-account-switch:2 main owns selection and commit is one-shot', async (t) => {
  // Regression caught: renderer supplies an import path or repeats a stale confirmed commit.
  const root = await mkdtemp(path.join(tmpdir(), 'rhythm-colony-import-host-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const handlers = new Map(), dialogs = [], controls = []
  const selected = path.join(root, 'standalone-state.json')
  const service = {
    start: async () => ({ state: 'ready' }), dispose: async () => {},
    control: async (value) => {
      controls.push(value)
      return value.type === 'importPreview' ? { archived: 7000, viewed: 4, groups: 2, version: 3 } : { updatedAt: 42, counts: { archived: 7000, viewed: 4, groups: 2 } }
    },
  }
  const host = registerColonyHost({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler), removeHandler: (name) => handlers.delete(name) },
    getWindow: () => ({ isDestroyed: () => false }), ownsHost: () => true,
    userDataPath: path.join(root, 'user-data'), resourcesPath: path.join(root, 'Resources'), home: path.join(root, 'home'),
    isPackaged: false, environment: { RHYTHM_COLONY_ARTIFACT_DIR: '/fixtures/artifact', RHYTHM_COLONY_NODE: process.execPath },
    fs: { lstat: async () => { throw new Error('missing') } },
    dialog: { showOpenDialog: async (...args) => { dialogs.push(args); return { canceled: false, filePaths: [selected] } } },
    createImportService: () => service,
    registerView: () => ({ disposeCurrent: async () => {}, dispose: async () => {} }),
  })
  t.after(() => host.dispose())
  await host.activateProfile({ productionApiBase: 'https://api.example.test', userId: 'person' })
  await handlers.get('colony:host:set-enabled')({}, true)

  assert.deepEqual(await handlers.get('colony:import:preview')({}), { ok: true, counts: { archived: 7000, viewed: 4, groups: 2, version: 3 } })
  assert.equal(dialogs.length, 1)
  assert.equal(JSON.stringify(dialogs).includes(selected), false)
  assert.deepEqual(await handlers.get('colony:import:commit')({}), { ok: true, receipt: { updatedAt: 42, counts: { archived: 7000, viewed: 4, groups: 2 } } })
  assert.equal((await handlers.get('colony:import:commit')({})).ok, false)
  assert.deepEqual(controls, [{ type: 'importPreview', path: selected }, { type: 'importCommit', path: selected }])
  assert.equal((await handlers.get('colony:import:preview')({}, selected)).ok, false)
})

test('1532:settings-import-account-switch:3 disable and account switch stop owned work and reset host state', async (t) => {
  // Regression caught: old-profile import/scanner work survives disable or identity replacement.
  const root = await mkdtemp(path.join(tmpdir(), 'rhythm-colony-import-account-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const handlers = new Map(), events = []
  const host = registerColonyHost({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler), removeHandler: (name) => handlers.delete(name) },
    getWindow: () => null, ownsHost: () => true,
    userDataPath: path.join(root, 'user-data'), resourcesPath: path.join(root, 'Resources'), home: path.join(root, 'home'),
    isPackaged: false, environment: { RHYTHM_COLONY_ARTIFACT_DIR: '/fixtures/artifact', RHYTHM_COLONY_NODE: process.execPath },
    fs: { lstat: async () => { throw new Error('missing') } },
    emitReset: () => events.push('reset'),
    registerView: () => ({ disposeCurrent: async () => events.push('view-stop'), dispose: async () => {} }),
  })
  t.after(() => host.dispose())
  await host.activateProfile({ productionApiBase: 'https://api.example.test', userId: 'one' })
  await handlers.get('colony:host:set-enabled')({}, true)
  events.length = 0
  await handlers.get('colony:host:set-enabled')({}, false)
  assert.deepEqual(events, ['view-stop'])
  events.length = 0
  await host.invalidateProfile()
  assert.deepEqual(events, ['reset', 'view-stop'])
  await host.activateProfile({ productionApiBase: 'https://api.example.test', userId: 'two' })
  assert.equal((await handlers.get('colony:host:status')({})).enabled, false)
})

test('1532:settings-import-account-switch:7 pinned worker imports 7000 entries idempotently, preserves source bytes, and restores backup', { skip: process.env.COLONY_NATIVE_ARTIFACT ? false : 'Set COLONY_NATIVE_ARTIFACT to run the pinned worker import contract.' }, async (t) => {
  // Regression caught: large import rewrites its source, duplicates entries, or corrupt failure replaces the last valid state.
  const root = await mkdtemp(path.join(tmpdir(), 'rhythm-colony-import-real-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const artifactRoot = process.env.COLONY_NATIVE_ARTIFACT
  const sourceCommit = process.env.COLONY_NATIVE_SOURCE_COMMIT
  assert.match(sourceCommit ?? '', /^[a-f0-9]{40}$/, 'Set COLONY_NATIVE_SOURCE_COMMIT with the pinned artifact source commit.')
  const source = path.join(root, 'standalone.json')
  const corrupt = path.join(root, 'corrupt.json')
  const archived = Array.from({ length: 7000 }, (_, index) => `codex:00000000-0000-4000-8000-${String(index).padStart(12, '0')}`)
  await writeFile(source, JSON.stringify({
    version: 3, archived, archivedAt: {}, opened: [], plots: {}, seen: {}, hiddenProjects: [], viewedAt: {},
    projectOverrides: { 'project:one': 'group-a' }, projectAliases: {}, projectMigrations: {}, sessionMigrations: {}, settings: null, updatedAt: 10,
  }))
  await writeFile(corrupt, '{broken')
  const before = createHash('sha256').update(await readFile(source)).digest('hex')
  const service = createColonyService({
    isPackaged: false, developmentNodePath: process.execPath, resourcesPath: path.join(root, 'Resources'), artifactRoot,
    expectedSourceCommit: sourceCommit, expectedElectronMajor: 40, dataDir: path.join(root, 'profile-state'), sources: [], enabled: () => true,
    startupTimeoutMs: 3000, stopTimeoutMs: 250,
  })
  t.after(() => service.dispose())
  await service.start({ documentId: 'real-import-document' })
  assert.deepEqual(await service.control({ type: 'importPreview', path: source }), { archived: 7000, viewed: 0, groups: 1, version: 3 })
  const first = await service.control({ type: 'importCommit', path: source })
  const second = await service.control({ type: 'importCommit', path: source })
  assert.deepEqual(first.counts, { archived: 7000, viewed: 0, groups: 1 })
  assert.deepEqual(second, first)
  assert.equal(createHash('sha256').update(await readFile(source)).digest('hex'), before)
  await assert.rejects(() => service.control({ type: 'importCommit', path: corrupt }), /malformed|source left untouched|import/i)
  const retained = await service.request({ v: 1, documentId: 'real-import-document', id: 'state-after-failure', method: 'state.read', payload: {} })
  assert.equal(retained.result.archived.length, 7000)
  const restored = await service.control({ type: 'backupRestore', backup: 'state-0.json' })
  assert.equal(restored.counts.archived, 0)
})

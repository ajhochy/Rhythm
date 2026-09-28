import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import { resolveColonyArtifact } from '../src/colony-desktop-artifact.mjs'
import { makeArtifact, sourceCommit, workerSource } from './support/colony-native-fixture.mjs'
let runtime
try { runtime = await import('../src/colony-service.mjs') } catch {}
const need = name => { assert.equal(typeof runtime?.[name], 'function', `Required native ${name} is missing`); return runtime[name] }
async function fixture(run, worker = workerSource) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'colony-native-service-'))
  const artifactRoot = path.join(root, 'artifact')
  const manifest = await makeArtifact(artifactRoot, worker)
  try { await run({ root, artifactRoot, manifest, options: {
    isPackaged: false, developmentNodePath: process.execPath, resourcesPath: path.join(root, 'Resources'),
    artifactRoot, expectedSourceCommit: sourceCommit, expectedElectronMajor: 40,
    dataDir: path.join(root, 'owned'), sources: [], enabled: () => true,
    startupTimeoutMs: 1000, stopTimeoutMs: 100, maxRestarts: 2,
  } }) } finally { await fs.rm(root, { recursive: true, force: true }) }
}

test('native resolver requires the sealed worker role before any launch', async () => {
  await fixture(async ({ artifactRoot, manifest }) => {
    delete manifest.files.worker
    await fs.writeFile(path.join(artifactRoot, 'manifest.json'), JSON.stringify(manifest))
    await assert.rejects(resolveColonyArtifact({ artifactRoot, expectedSourceCommit: sourceCommit, expectedElectronMajor: 40 }), /worker/i)
  })
})

test('native resolver returns only its authenticated absolute worker entry', async () => {
  await fixture(async ({ artifactRoot }) => {
    const artifact = await resolveColonyArtifact({ artifactRoot, expectedSourceCommit: sourceCommit, expectedElectronMajor: 40 })
    assert.equal(artifact.workerPath, path.join(artifactRoot, 'server/embedded-worker.mjs'))
  })
})

test('packaged Node absence never falls back to an explicit development runtime or PATH', async () => {
  await fixture(async ({ options }) => {
    const resolveNode = need('resolveColonyNode')
    await assert.rejects(resolveNode({ ...options, isPackaged: true }), /packaged.*node|node.*missing/i)
  })
})

test('runtime resolution accepts exact packaged executable and refuses symlink or relative developer path', async () => {
  await fixture(async ({ options }) => {
    const resolveNode = need('resolveColonyNode')
    const packaged = path.join(options.resourcesPath, 'node/bin/node')
    await fs.mkdir(path.dirname(packaged), { recursive: true })
    await fs.writeFile(packaged, '# synthetic runtime: never executed\n', { mode: 0o755 })
    assert.equal(await resolveNode({ ...options, isPackaged: true }), packaged)
    await fs.rm(packaged)
    await fs.symlink(process.execPath, packaged)
    await assert.rejects(resolveNode({ ...options, isPackaged: true }), /symlink/i)
    await assert.rejects(resolveNode({ ...options, developmentNodePath: 'node' }), /absolute|explicit/i)
  })
})

test('disabled construction and open create no child; ten active opens share one actual owned child', async () => {
  await fixture(async ({ options }) => {
    const create = need('createColonyService')
    let enabled = false
    const service = create({ ...options, enabled: () => enabled })
    try {
      assert.equal(service.status().pid, null)
      await assert.rejects(service.start({ documentId: 'owned-document' }), /disabled/i)
      assert.equal(service.status().pid, null)
      enabled = true
      const started = await Promise.all(Array.from({ length: 10 }, () => service.start({ documentId: 'owned-document' })))
      assert.equal(new Set(started.map(value => value.pid)).size, 1)
      assert.ok(started[0].pid > 0)
      assert.equal((await service.start({ documentId: 'owned-document' })).pid, started[0].pid)
      const response = await service.request({ v: 1, documentId: 'owned-document', id: 'state-read', method: 'state.read', payload: {} })
      assert.deepEqual(response.result.archived, [])
    } finally { await service.dispose() }
  })
})

test('startup capability mismatch fails before accepting inventory and disposes its child', async () => {
  await fixture(async ({ options }) => {
    const service = need('createColonyService')(options)
    try {
      await assert.rejects(service.start({ documentId: 'owned-document' }), /capabilit|handshake/i)
      assert.equal(service.status().pid, null)
    } finally { await service.dispose() }
  }, workerSource.replace("['inventory-v1','state-v1','host-intents-v1','state-mark-v1','import-v1']", "['state-v1']"))
})

test('silent startup has a deadline and crash attempts stop at the documented bound', async () => {
  await fixture(async ({ options }) => {
    const service = need('createColonyService')({ ...options, startupTimeoutMs: 150 })
    try {
      for (let attempt = 0; attempt < 3; attempt++) await assert.rejects(service.start({ documentId: 'owned-document' }), /timeout|deadline|exited/i)
      await assert.rejects(service.start({ documentId: 'owned-document' }), /retry|limit|exhausted/i)
      assert.equal(service.status().pid, null)
    } finally { await service.dispose() }
  }, "process.on('message', () => {}); process.on('disconnect', () => process.exit(0));")
})

test('startup and shutdown preserve unrelated sentinel and sanitize inherited credentials and Node injection', async () => {
  await fixture(async ({ options }) => {
    const create = need('createColonyService')
    const sentinel = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', env: { HOME: options.dataDir, PATH: '' } })
    let seen
    const service = create({ ...options, parentEnvironment: { NODE_OPTIONS: '--require=/missing/forbidden.cjs', NODE_PATH: '/missing', RHYTHM_API_TOKEN: 'synthetic-only', OPENAI_API_KEY: 'synthetic-only', ANTHROPIC_API_KEY: 'synthetic-only' }, spawnChild: (executable, args, config) => {
      seen = { executable, args, config }
      return spawn(executable, args, config)
    } })
    try {
      await service.start({ documentId: 'owned-document' })
      assert.equal(seen.executable, process.execPath)
      assert.equal(path.isAbsolute(seen.args[0]), true)
      for (const key of ['NODE_OPTIONS', 'NODE_PATH', 'RHYTHM_API_TOKEN', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY']) assert.equal(Object.hasOwn(seen.config.env, key), false)
      assert.equal(seen.config.shell, false)
      await service.dispose()
      assert.equal(sentinel.exitCode, null)
      assert.equal(sentinel.signalCode, null)
      process.kill(sentinel.pid, 0)
    } finally {
      await service.dispose()
      if (sentinel.exitCode === null && sentinel.signalCode === null) await new Promise(resolve => { sentinel.once('exit', resolve); sentinel.kill() })
    }
  })
})

test('unconfirmed child disposal is sticky and forbids a replacement launch', async () => {
  await fixture(async ({ options }) => {
    const create = need('createColonyService')
    let launches = 0
    const child = new EventEmitter()
    Object.assign(child, { pid: 99999999, connected: true, exitCode: null, signalCode: null, kill() { return true },
      send(message) { if (message.type === 'colony:init') queueMicrotask(() => child.emit('message', { type: 'colony:ready', v: 1, product: 'colony', documentId: message.documentId, capabilities: ['inventory-v1', 'state-v1', 'host-intents-v1', 'state-mark-v1', 'import-v1'], runtime: { node: process.versions.node, sqlite: true } })) }, disconnect() {} })
    const service = create({ ...options, spawnChild: () => { launches++; return child } })
    await service.start({ documentId: 'owned-document' })
    await assert.rejects(service.stop(), /exit|stop|ownership|terminat/i)
    await assert.rejects(service.start({ documentId: 'new-document' }), /exit|stop|ownership|terminat/i)
    assert.equal(launches, 1)
    child.exitCode = 0
    child.emit('exit', 0, null)
    await service.dispose().catch(() => {})
  })
})

test('runtime handshake refuses old Node and absent SQLite before any inventory', async () => {
  for (const runtime of ["{node:'22.12.0',sqlite:true}", "{node:'22.23.0',sqlite:false}", "{node:'999999999999999999999999999999999999999999999999999999999999999999999999.0.0',sqlite:true}"]) {
    await fixture(async ({ options }) => {
      const service = need('createColonyService')(options)
      try {
        await assert.rejects(service.start({ documentId: 'owned-document' }), /runtime|version|handshake/i)
        assert.equal(service.status().pid, null)
      } finally { await service.dispose() }
    }, workerSource.replace('{node:process.versions.node,sqlite:true}', runtime))
  }
})

test('unsafe or unknown source configuration refuses before creating a worker', async () => {
  for (const sources of [
    [{ id: 'hermes', enabled: true, paths: { home: 'relative' } }],
    [{ id: 'unknown', enabled: true, paths: { home: '/synthetic' } }],
    [{ id: 'hermes', enabled: true, paths: { home: '/synthetic', command: '/bin/sh' } }],
    [{ id: 'hermes', enabled: true, paths: { home: '/synthetic\0bad' } }],
  ]) {
    await fixture(async ({ options }) => {
      let launches = 0
      const service = need('createColonyService')({ ...options, sources, spawnChild() { launches++; throw new Error('Unexpected launch') } })
      try { await assert.rejects(service.start({ documentId: 'owned-document' }), /source|path|configuration/i); assert.equal(launches, 0) }
      finally { await service.dispose() }
    })
  }
})

test('stop and owned-child crash reject outstanding request waiters', async () => {
  const silentRequestWorker = workerSource.replace(
    "else process.send({v:1,documentId:message.documentId,id:message.id,ok:true,result:{version:3,archived:[],updatedAt:0}});",
    'else {}',
  )
  await fixture(async ({ options }) => {
    const service = need('createColonyService')(options)
    await service.start({ documentId: 'owned-document' })
    const refused = assert.rejects(
      service.request({ v: 1, documentId: 'owned-document', id: 'pending-stop', method: 'state.read', payload: {} }),
      error => error?.code === 'revoked',
    )
    await service.stop()
    await refused
    await service.dispose()
  }, silentRequestWorker)

  const crashingRequestWorker = workerSource.replace(
    "else process.send({v:1,documentId:message.documentId,id:message.id,ok:true,result:{version:3,archived:[],updatedAt:0}});",
    'else process.exit(7);',
  )
  await fixture(async ({ options }) => {
    const service = need('createColonyService')(options)
    try {
      await service.start({ documentId: 'owned-document' })
      await assert.rejects(
        service.request({ v: 1, documentId: 'owned-document', id: 'pending-crash', method: 'state.read', payload: {} }),
        error => error?.code === 'revoked',
      )
      assert.equal(service.status().pid, null)
    } finally { await service.dispose() }
  }, crashingRequestWorker)
})

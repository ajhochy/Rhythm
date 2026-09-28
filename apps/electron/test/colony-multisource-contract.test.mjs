import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import test from 'node:test'

import { PINNED_COLONY_SOURCE_COMMIT } from '../src/colony-desktop-config.mjs'
import { createColonyService } from '../src/colony-service.mjs'
import { createMultiSourceFixture } from './support/colony-multisource-fixture.mjs'

const DOCUMENT = 'multisource-contract'

function request(service, id, payload) {
  return service.request({ v: 1, documentId: DOCUMENT, id, method: 'inventory.page', payload })
}

async function waitFor(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('Timed out waiting for owned process state')
}

async function startSentinel(port) {
  const source = `const net=require('node:net');const server=net.createServer(s=>s.end('sentinel'));server.listen(${port},'127.0.0.1',()=>process.send({ready:true}));`
  const child = spawn(process.execPath, ['-e', source], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
  await new Promise((resolve, reject) => {
    child.once('message', resolve)
    child.once('error', reject)
    child.once('exit', (code) => reject(new Error(`sentinel exited ${code}`)))
  })
  return child
}

async function probe(port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1')
    let value = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk) => { value += chunk })
    socket.on('end', () => resolve(value))
    socket.on('error', reject)
  })
}

test('1528:multisource-contract:1 actual worker keeps healthy rows and names each failed source', async (t) => {
  // Regression caught: one malformed source aborts the aggregate and hides healthy Hermes tasks.
  const artifactRoot = process.env.COLONY_NATIVE_ARTIFACT
  assert.ok(artifactRoot && path.isAbsolute(artifactRoot), 'COLONY_NATIVE_ARTIFACT must name the pinned absolute artifact')
  const fixture = await createMultiSourceFixture()
  t.after(() => fixture.cleanup())
  const service = createColonyService({
    artifactRoot,
    expectedSourceCommit: PINNED_COLONY_SOURCE_COMMIT,
    expectedElectronMajor: 40,
    isPackaged: false,
    resourcesPath: path.join(fixture.root, 'Resources'),
    developmentNodePath: process.execPath,
    dataDir: path.join(fixture.root, 'owned-state'),
    sources: fixture.sources,
    enabled: () => true,
  })
  t.after(() => service.dispose().catch(() => {}))

  await service.start({ documentId: DOCUMENT })
  const threads = await request(service, 'threads-page', { collection: 'threads', limit: 250 })
  assert.equal(threads.ok, true)
  assert.ok(threads.result.records.some((row) => row.id === 'hermes:main:healthy-fixture'))
  const warnings = await request(service, 'warnings-page', { generation: threads.result.generation, collection: 'warnings', limit: 250 })
  assert.equal(warnings.ok, true)
  const text = warnings.result.records.join('\n')
  for (const id of ['codex', 'opencode', 'rhythm']) assert.match(text, new RegExp(`${id}:`, 'i'))
})

test('1528:multisource-contract:2 disabled sources are not opened', async (t) => {
  // Regression caught: worker initialization touches a disabled harness directory anyway.
  const artifactRoot = process.env.COLONY_NATIVE_ARTIFACT
  assert.ok(artifactRoot && path.isAbsolute(artifactRoot))
  const fixture = await createMultiSourceFixture()
  t.after(() => fixture.cleanup())
  const service = createColonyService({ artifactRoot, expectedSourceCommit: PINNED_COLONY_SOURCE_COMMIT, expectedElectronMajor: 40,
    isPackaged: false, resourcesPath: path.join(fixture.root, 'Resources'), developmentNodePath: process.execPath,
    dataDir: path.join(fixture.root, 'owned-state'), sources: fixture.sources, enabled: () => true })
  t.after(() => service.dispose().catch(() => {}))
  await service.start({ documentId: DOCUMENT })
  await request(service, 'disabled-guard-scan', { collection: 'threads', limit: 250 })
  const after = await fs.stat(fixture.disabledSentinel)
  assert.equal(after.atimeMs, fixture.disabledStat.atimeMs)
  assert.equal(after.mtimeMs, fixture.disabledStat.mtimeMs)
  assert.equal((await fixture.hashesAfter())[fixture.disabledSentinel], fixture.before[fixture.disabledSentinel])
})

test('1528:multisource-contract:3 only owned workers die through crash retries and exhaustion', async (t) => {
  // Regression caught: crash recovery discovers or signals an unrelated listener instead of only the captured child.
  const artifactRoot = process.env.COLONY_NATIVE_ARTIFACT
  assert.ok(artifactRoot && path.isAbsolute(artifactRoot))
  const fixture = await createMultiSourceFixture()
  const sentinel = await startSentinel(7289)
  const sentinelPid = sentinel.pid
  t.after(async () => {
    if (sentinel.exitCode === null && sentinel.signalCode === null) await new Promise((resolve) => { sentinel.once('exit', resolve); sentinel.kill('SIGTERM') })
    await fixture.cleanup()
  })
  const service = createColonyService({ artifactRoot, expectedSourceCommit: PINNED_COLONY_SOURCE_COMMIT, expectedElectronMajor: 40,
    isPackaged: false, resourcesPath: path.join(fixture.root, 'Resources'), developmentNodePath: process.execPath,
    dataDir: path.join(fixture.root, 'owned-state'), sources: fixture.sources, enabled: () => true, maxRestarts: 2 })
  t.after(() => service.dispose().catch(() => {}))

  for (let attempt = 0; attempt < 3; attempt++) {
    const started = await service.start({ documentId: DOCUMENT })
    assert.ok(started.pid > 0)
    assert.notEqual(started.pid, sentinelPid)
    process.kill(started.pid, 'SIGKILL')
    await waitFor(() => service.status().pid === null)
    assert.equal(sentinel.pid, sentinelPid)
    assert.equal(sentinel.exitCode, null)
    process.kill(sentinelPid, 0)
    assert.equal(await probe(7289), 'sentinel')
  }
  await assert.rejects(service.start({ documentId: DOCUMENT }), /retry|limit|exhausted/i)
  assert.equal(sentinel.pid, sentinelPid)
  assert.equal(await probe(7289), 'sentinel')
})

test('1528:multisource-contract:4 every synthetic fixture store is byte-identical after scanning', async (t) => {
  // Regression caught: a read-only adapter creates sidecars or rewrites source bytes.
  const artifactRoot = process.env.COLONY_NATIVE_ARTIFACT
  assert.ok(artifactRoot && path.isAbsolute(artifactRoot))
  const fixture = await createMultiSourceFixture()
  t.after(() => fixture.cleanup())
  const service = createColonyService({ artifactRoot, expectedSourceCommit: PINNED_COLONY_SOURCE_COMMIT, expectedElectronMajor: 40,
    isPackaged: false, resourcesPath: path.join(fixture.root, 'Resources'), developmentNodePath: process.execPath,
    dataDir: path.join(fixture.root, 'owned-state'), sources: fixture.sources, enabled: () => true })
  t.after(() => service.dispose().catch(() => {}))
  await service.start({ documentId: DOCUMENT })
  await request(service, 'hash-scan', { collection: 'threads', limit: 250 })
  assert.deepEqual(await fixture.hashesAfter(), fixture.before)
})

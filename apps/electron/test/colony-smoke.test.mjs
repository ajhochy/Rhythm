import assert from 'node:assert/strict'
import test from 'node:test'
import { EXPECTED_COLONY_ELECTRON_MAJOR, PINNED_COLONY_SOURCE_COMMIT } from '../src/colony-desktop-config.mjs'
import { runColonySmoke } from '../src/colony-smoke.mjs'

// Same real-artifact fixture pattern as colony-import-contract.test.mjs's pinned-worker test:
// skip unless a real, qualified Colony artifact is available, and require the pin to match.
const artifactRoot = process.env.COLONY_NATIVE_ARTIFACT
const sourceCommit = process.env.COLONY_NATIVE_SOURCE_COMMIT
const RUN_REAL = { skip: artifactRoot ? false : 'set COLONY_NATIVE_ARTIFACT (and COLONY_NATIVE_SOURCE_COMMIT) to run the real Colony smoke' }

test('1535:release-ci-producer:6 resolves the pinned artifact, completes the handshake and a status read, and returns an allowlisted receipt', RUN_REAL, async () => {
  assert.match(sourceCommit ?? '', /^[a-f0-9]{40}$/, 'Set COLONY_NATIVE_SOURCE_COMMIT with the pinned artifact source commit.')
  assert.equal(sourceCommit, PINNED_COLONY_SOURCE_COMMIT, 'COLONY_NATIVE_SOURCE_COMMIT must match the pin for this to be a meaningful smoke')
  const receipt = await runColonySmoke({
    isPackaged: false,
    resourcesPath: '/unused-in-development-mode',
    environment: { RHYTHM_COLONY_ARTIFACT_DIR: artifactRoot, RHYTHM_COLONY_NODE: process.execPath },
  })
  assert.deepEqual(receipt, {
    product: 'colony',
    sourceCommit: PINNED_COLONY_SOURCE_COMMIT,
    electronMajor: EXPECTED_COLONY_ELECTRON_MAJOR,
    capabilities: ['inventory-v1', 'state-v1', 'host-intents-v1', 'state-mark-v1', 'import-v1'],
    handshake: 'ok',
    status: 'read',
  })
})

test('1535:release-ci-producer:7 the receipt is allowlisted: no artifact/data-directory paths leak', async () => {
  const receipt = await runColonySmoke({
    isPackaged: false,
    resourcesPath: '/unused-in-development-mode',
    environment: { RHYTHM_COLONY_ARTIFACT_DIR: '/fixtures/artifact', RHYTHM_COLONY_NODE: process.execPath },
    createService: () => ({
      start: async () => ({ capabilities: ['inventory-v1', 'state-v1', 'host-intents-v1', 'state-mark-v1', 'import-v1'] }),
      request: async () => ({ ok: true, result: {} }),
      dispose: async () => {},
    }),
  })
  assert.deepEqual(Object.keys(receipt).sort(), ['capabilities', 'electronMajor', 'handshake', 'product', 'sourceCommit', 'status'])
})

test('1535:release-ci-producer:8 a failed handshake throws instead of reporting success', async () => {
  await assert.rejects(runColonySmoke({
    isPackaged: false,
    resourcesPath: '/unused-in-development-mode',
    environment: { RHYTHM_COLONY_ARTIFACT_DIR: '/fixtures/artifact', RHYTHM_COLONY_NODE: process.execPath },
    createService: () => ({
      start: async () => { throw new Error('Colony runtime version/capability handshake failed') },
      request: async () => { throw new Error('unreachable: handshake never completed') },
      dispose: async () => {},
    }),
  }), /handshake failed/)
})

test('1535:release-ci-producer:9 a failed status read throws and still disposes the owned worker', async () => {
  let disposed = false
  await assert.rejects(runColonySmoke({
    isPackaged: false,
    resourcesPath: '/unused-in-development-mode',
    environment: { RHYTHM_COLONY_ARTIFACT_DIR: '/fixtures/artifact', RHYTHM_COLONY_NODE: process.execPath },
    createService: () => ({
      start: async () => ({ capabilities: [] }),
      request: async () => ({ ok: false, error: { code: 'unavailable', message: 'Colony worker unavailable' } }),
      dispose: async () => { disposed = true },
    }),
  }), /unavailable/)
  assert.equal(disposed, true)
})

test('1535:release-ci-producer:10 a missing RHYTHM_COLONY_ARTIFACT_DIR/RHYTHM_COLONY_NODE throws before starting any worker', async () => {
  let started = false
  await assert.rejects(runColonySmoke({
    isPackaged: false,
    resourcesPath: '/unused-in-development-mode',
    environment: {},
    createService: () => ({ start: async () => { started = true; return { capabilities: [] } }, request: async () => ({ ok: true, result: {} }), dispose: async () => {} }),
  }), /RHYTHM_COLONY_ARTIFACT_DIR|RHYTHM_COLONY_NODE/)
  assert.equal(started, false)
})

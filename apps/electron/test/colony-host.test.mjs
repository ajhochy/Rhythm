import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { registerColonyHost, resolveColonyRuntimeConfig } from '../src/colony-host.mjs'

function ipcFixture() {
  const handlers = new Map()
  return { handlers, ipcMain: { handle(name, fn) { handlers.set(name, fn) }, removeHandler(name) { handlers.delete(name) } } }
}

test('1528:main-wiring:4 profile invalidation waits for view disposal and clears visible state', async (t) => {
  // Regression caught: account identity becomes reusable while the old profile worker is still stopping.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rhythm-colony-host-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const { handlers, ipcMain } = ipcFixture()
  let release
  let disposalStarted = false
  let disposalCalls = 0
  const disposed = new Promise((resolve) => { release = resolve })
  let viewOptions
  const host = registerColonyHost({
    ipcMain,
    getWindow: () => null,
    userDataPath: path.join(root, 'user-data'),
    resourcesPath: path.join(root, 'Resources'),
    home: path.join(root, 'home'),
    isPackaged: false,
    environment: { RHYTHM_COLONY_ARTIFACT_DIR: '/fixtures/artifact', RHYTHM_COLONY_NODE: process.execPath },
    fs: { lstat: async () => { throw new Error('missing') } },
    ownsHost: () => true,
    registerView(options) {
      viewOptions = options
      return { async disposeCurrent() { if (++disposalCalls === 1) return; disposalStarted = true; await disposed }, async dispose() {} }
    },
  })
  await host.activateProfile({ productionApiBase: 'https://api.example.test', userId: 'one' })
  await handlers.get('colony:host:set-enabled')({}, true)
  assert.equal(viewOptions.enabled(), true)
  let completed = false
  const invalidation = host.invalidateProfile().then(() => { completed = true })
  await assert.rejects(() => handlers.get('colony:host:set-enabled')({}, true), /invalid|revoked/i)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(disposalStarted, true)
  assert.equal(completed, false)
  assert.equal(viewOptions.enabled(), false)
  release()
  await invalidation
  assert.deepEqual(await handlers.get('colony:host:status')({}), { v: 1, available: true, enabled: false, sources: [] })
})

test('1528:main-wiring:5 packaged paths ignore env and development requires absolute values', () => {
  // Regression caught: a packaged app launches an ambient checkout or PATH Node supplied by environment.
  assert.deepEqual(resolveColonyRuntimeConfig({ isPackaged: true, resourcesPath: '/Applications/Rhythm.app/Contents/Resources', environment: {
    RHYTHM_COLONY_ARTIFACT_DIR: '/attacker/artifact', RHYTHM_COLONY_NODE: '/attacker/node',
  } }), {
    artifactRoot: '/Applications/Rhythm.app/Contents/Resources/colony-desktop',
    nodePath: '/Applications/Rhythm.app/Contents/Resources/node/bin/node',
  })
  assert.throws(() => resolveColonyRuntimeConfig({ isPackaged: false, resourcesPath: '/resources', environment: {} }), /absolute|require/i)
  assert.throws(() => resolveColonyRuntimeConfig({ isPackaged: false, resourcesPath: '/resources', environment: {
    RHYTHM_COLONY_ARTIFACT_DIR: 'relative', RHYTHM_COLONY_NODE: process.execPath,
  } }), /absolute/i)
})

test('1528:main-wiring:6 host status and discovery never expose source paths', async (t) => {
  // Regression caught: trusted local filesystem paths leak through the renderer bridge.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rhythm-colony-host-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const { handlers, ipcMain } = ipcFixture()
  const host = registerColonyHost({ ipcMain, getWindow: () => null, userDataPath: path.join(root, 'user-data'), resourcesPath: path.join(root, 'Resources'),
    home: path.join(root, 'home'), isPackaged: false, environment: { RHYTHM_COLONY_ARTIFACT_DIR: '/fixtures/artifact', RHYTHM_COLONY_NODE: process.execPath },
    fs: { lstat: async () => ({}) }, ownsHost: () => true, registerView: () => ({ disposeCurrent: async () => {}, dispose: async () => {} }) })
  t.after(() => host.dispose())
  await host.activateProfile({ productionApiBase: 'https://api.example.test', userId: 'one' })
  const event = {}
  const discovered = await handlers.get('colony:host:discover')(event)
  assert.equal(discovered.length, 8)
  assert.equal(JSON.stringify(discovered).includes(root), false)
  await handlers.get('colony:host:set-source')(event, { id: 'hermes', enabled: true })
  const status = await handlers.get('colony:host:status')(event)
  assert.equal(JSON.stringify(status).includes(root), false)
  assert.deepEqual(status.sources.find(({ id }) => id === 'hermes'), { id: 'hermes', enabled: true })
})

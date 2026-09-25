import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { registerColonyView } from '../src/colony-view.mjs'
import { COLONY_VIEW_KEYS } from '../src/security-smoke-receipt.mjs'
import { makeArtifact, sourceCommit } from './support/colony-native-fixture.mjs'

class MessageChannelMain {
  constructor() {
    this.port1 = Object.assign(new EventEmitter(), { start() {}, close() {}, postMessage() {} })
    this.port2 = { close() {} }
  }
}

async function viewFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rhythm-colony-main-wire-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const artifactRoot = path.join(root, 'artifact')
  await makeArtifact(artifactRoot)
  const ipcMain = Object.assign(new EventEmitter(), { handlers: new Map(), handle(name, fn) { this.handlers.set(name, fn) }, removeHandler(name) { this.handlers.delete(name) } })
  const partition = Object.assign(new EventEmitter(), { protocol: { handle() {}, unhandle() {} }, webRequest: { onBeforeRequest() {} }, setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, clearStorageData: async () => {} })
  class WebContentsView {
    constructor() {
      const frame = { url: '', detached: false, postMessage() {}, send() {} }
      let url = ''
      this.webContents = Object.assign(new EventEmitter(), { mainFrame: frame, session: partition, getURL: () => url, isLoadingMainFrame: () => false,
        isDestroyed: () => false, close() {}, setWindowOpenHandler() {}, async loadURL(next) { url = next; frame.url = next; this.emit('did-finish-load') } })
    }
    setBounds() {}
  }
  const ownerFrame = { url: 'rhythm://app/index.html#/colony' }
  const ownerContents = Object.assign(new EventEmitter(), { mainFrame: ownerFrame, getZoomFactor: () => 1 })
  const win = { webContents: ownerContents, contentView: { addChildView() {}, removeChildView() {} }, isDestroyed: () => false, getContentBounds: () => ({ width: 800, height: 600 }) }
  let enabled = false
  let launches = 0
  const spawnChild = () => {
    launches++
    const child = Object.assign(new EventEmitter(), { pid: 7100 + launches, connected: true, exitCode: null, signalCode: null, stderr: { resume() {} }, kill() {},
      send(message) {
        if (message.type === 'colony:init') queueMicrotask(() => child.emit('message', { type: 'colony:ready', v: 1, product: 'colony', documentId: message.documentId, capabilities: ['inventory-v1', 'state-v1', 'host-intents-v1', 'state-mark-v1', 'import-v1'], runtime: { node: process.versions.node, sqlite: true } }))
        if (message.type === 'colony:dispose') queueMicrotask(() => { child.exitCode = 0; child.emit('exit', 0, null) })
      } })
    return child
  }
  const host = registerColonyView({ ipcMain, electron: { WebContentsView, MessageChannelMain }, getWindow: () => win, getArtifactRoot: () => artifactRoot,
    getDataDir: () => path.join(root, 'profile-state'), getSources: () => [], enabled: () => enabled, isPackaged: false,
    resourcesPath: path.join(root, 'Resources'), developmentNodePath: process.execPath, expectedElectronMajor: 40, expectedSourceCommit: sourceCommit, spawnChild })
  t.after(() => host.dispose())
  return { ipcMain, event: { sender: ownerContents, senderFrame: ownerFrame }, ownerFrame, setEnabled(value) { enabled = value }, launches: () => launches }
}

test('1528:main-wiring:1-3 disabled and foreign attaches refuse; ten enabled attaches share one child', async (t) => {
  // Regressions caught: eager disabled scan, duplicate children, or attachment authority from another route.
  const f = await viewFixture(t)
  const attach = f.ipcMain.handlers.get('colony:view:attach')
  const disabled = await Promise.all(Array.from({ length: 10 }, () => attach(f.event)))
  assert.ok(disabled.every((result) => result.ok === false))
  assert.equal(f.launches(), 0)
  f.ownerFrame.url = 'rhythm://app/index.html#/agents'
  f.setEnabled(true)
  assert.equal((await attach(f.event)).ok, false)
  assert.equal(f.launches(), 0)
  f.ownerFrame.url = 'rhythm://app/index.html#/colony'
  const attached = await Promise.all(Array.from({ length: 10 }, () => attach(f.event)))
  assert.ok(attached.every((result) => result.ok === true))
  assert.equal(new Set(attached.map(({ attachment }) => attachment)).size, 1)
  assert.equal(f.launches(), 1)
  assert.equal((await attach(f.event)).attachment, attached[0].attachment)
})

test('1528:main-wiring:6 actual preload exposes one frozen exact Colony bridge', async () => {
  // Regression caught: preload leaks a path, port, worker method, or mutable attachment token.
  let bridge
  const calls = []
  runInNewContext(await readFile(new URL('../src/preload.cjs', import.meta.url), 'utf8'), {
    require(name) {
      assert.equal(name, 'electron')
      return {
        contextBridge: { exposeInMainWorld(key, value) { assert.equal(key, 'rhythmShell'); bridge = value } },
        ipcRenderer: { sendSync: () => 'https://api.example.test', on() {}, removeListener() {}, send() {}, invoke: async (...args) => { calls.push(args); return { ok: true, attachment: 'private' } } },
      }
    },
    process: { argv: [], env: {}, platform: 'darwin' },
    window: { addEventListener() {}, dispatchEvent() {} },
    CustomEvent: class {},
  })
  assert.deepEqual(Object.keys(bridge.colonyView), COLONY_VIEW_KEYS)
  assert.equal(Object.isFrozen(bridge.colonyView), true)
  assert.equal(JSON.stringify(bridge.colonyView).includes('path'), false)
  assert.equal(JSON.stringify(bridge.colonyView).includes('port'), false)
  assert.equal(JSON.stringify(bridge.colonyView).includes('worker'), false)
  await bridge.colonyView.attach()
  await bridge.colonyView.setBounds({ x: 1, y: 2, width: 3, height: 4 })
  await bridge.colonyView.runAction('open', 'opaque-row')
  assert.equal(calls.at(-1)[0], 'colony:action:run')
  assert.deepEqual({ ...calls.at(-1)[1] }, { attachment: 'private', kind: 'open', id: 'opaque-row' })
  await bridge.colonyView.detach()
  assert.deepEqual(calls.slice(-4).map(([name]) => name), ['colony:view:attach', 'colony:view:bounds', 'colony:action:run', 'colony:view:detach'])
})

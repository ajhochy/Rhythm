import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { registerColonyView } from '../src/colony-view.mjs'
import { makeArtifact, sourceCommit } from './support/colony-native-fixture.mjs'

// Minimal fakes for the pieces registerColonyView touches when it actually builds a
// WebContentsView. Headless attaches never reach this code at all, which is the point
// of COL-08's "no WebContentsView" requirement.
class FakeMessageChannelMain {
  constructor() {
    this.port1 = Object.assign(new EventEmitter(), { start() {}, postMessage() {}, close() {} })
    this.port2 = Object.assign(new EventEmitter(), { start() {}, postMessage() {}, close() {} })
  }
}

async function lifecycleFixture(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'colony-headless-'))
  const artifactRoot = path.join(root, 'artifact')
  await makeArtifact(artifactRoot)
  const ipcMain = Object.assign(new EventEmitter(), {
    handlers: new Map(),
    handle(name, handler) { this.handlers.set(name, handler) },
    removeHandler(name) { this.handlers.delete(name) },
  })
  const partition = Object.assign(new EventEmitter(), {
    protocol: { handle() {}, unhandle() {} },
    webRequest: { onBeforeRequest() {} },
    setPermissionRequestHandler() {}, setPermissionCheckHandler() {},
    async clearStorageData() {},
  })
  class WebContentsView {
    constructor() {
      const frame = { detached: false, url: '', postMessage() {}, send() {} }
      let url = ''
      const contents = Object.assign(new EventEmitter(), {
        mainFrame: frame, session: partition, closed: false,
        getURL: () => url, isLoadingMainFrame: () => false,
        isDestroyed() { return this.closed }, close() { this.closed = true },
        setWindowOpenHandler() {},
        async loadURL(next) { url = next; frame.url = next; this.emit('did-finish-load') },
      })
      this.webContents = contents
    }
    setBounds() {}
  }
  const ownerFrame = { url: 'rhythm://app/index.html#/colony' }
  const ownerContents = Object.assign(new EventEmitter(), { mainFrame: ownerFrame, getZoomFactor: () => 1 })
  const contentView = {
    children: [],
    addChildView(view) { this.children.push(view) },
    removeChildView(view) { this.children = this.children.filter((candidate) => candidate !== view) },
  }
  const win = { webContents: ownerContents, contentView, isDestroyed: () => false, getContentBounds: () => ({ width: 800, height: 600 }) }

  let launches = 0
  let activeWorkers = 0
  let maxConcurrent = 0
  const spawnChild = () => {
    launches++
    activeWorkers++
    maxConcurrent = Math.max(maxConcurrent, activeWorkers)
    const child = Object.assign(new EventEmitter(), {
      connected: true, exitCode: null, signalCode: null, stderr: { resume() {} },
      kill() { queueMicrotask(() => { if (this.exitCode === null) { this.exitCode = 0; this.emit('exit', 0, null) } }); return true },
      send(message) {
        if (message.type === 'colony:init') queueMicrotask(() => child.emit('message', {
          type: 'colony:ready', v: 1, product: 'colony', documentId: message.documentId,
          capabilities: ['inventory-v1', 'state-v1', 'host-intents-v1', 'state-mark-v1', 'import-v1'],
          runtime: { node: process.versions.node, sqlite: true },
        }))
        if (message.type === 'colony:dispose') this.kill()
      },
    })
    child.on('exit', () => { activeWorkers-- })
    return child
  }

  const host = registerColonyView({
    ipcMain,
    electron: { WebContentsView, MessageChannelMain: FakeMessageChannelMain },
    getWindow: () => win,
    getArtifactRoot: () => artifactRoot,
    getDataDir: () => path.join(root, 'profile', 'state'),
    getSources: () => [],
    enabled: () => true,
    isPackaged: false,
    resourcesPath: path.join(root, 'Resources'),
    developmentNodePath: process.execPath,
    expectedElectronMajor: 40,
    expectedSourceCommit: sourceCommit,
    stopTimeoutMs: 5,
    spawnChild,
  })
  const event = { sender: ownerContents, senderFrame: ownerFrame }
  try {
    await run({ host, ipcMain, event, contentView, launches: () => launches, maxConcurrent: () => maxConcurrent })
  } finally {
    await host.dispose().catch(() => {})
    await fs.rm(root, { recursive: true, force: true })
  }
}

test('1533:list-fallback:2a headless attach starts the service with no WebContentsView', async () => {
  await lifecycleFixture(async ({ ipcMain, event, contentView, launches }) => {
    const attach = ipcMain.handlers.get('colony:view:attach')
    const result = await attach(event, { headless: true })
    assert.equal(result.ok, true)
    assert.equal(contentView.children.length, 0, 'a headless attach must never add a WebContentsView')
    assert.equal(launches(), 1)
  })
})

test('1533:list-fallback:2b a repeated headless attach reuses the same session without a second worker', async () => {
  await lifecycleFixture(async ({ ipcMain, event, launches }) => {
    const attach = ipcMain.handlers.get('colony:view:attach')
    const first = await attach(event, { headless: true })
    const second = await attach(event, { headless: true })
    assert.equal(second.attachment, first.attachment)
    assert.equal(launches(), 1)
  })
})

test('1533:list-fallback:2c at most one worker ever exists across a headless-to-scene transition', async () => {
  await lifecycleFixture(async ({ ipcMain, event, contentView, launches, maxConcurrent }) => {
    const attach = ipcMain.handlers.get('colony:view:attach')
    const headless = await attach(event, { headless: true })
    assert.equal(headless.ok, true)
    const promoted = await attach(event)
    assert.equal(promoted.ok, true, promoted.reason)
    assert.notEqual(promoted.attachment, headless.attachment, 'promotion is a new attachment, not a silent no-op')
    assert.equal(contentView.children.length, 1, 'the promoted session owns exactly one WebContentsView')
    assert.equal(launches(), 2, 'the headless worker was retired before the scene worker was launched')
    assert.equal(maxConcurrent(), 1, 'at most one worker existed at any instant during the transition')

    const demoted = await attach(event, { headless: true })
    assert.notEqual(demoted.attachment, promoted.attachment)
    assert.equal(contentView.children.length, 0, 'demoting back to list-only tears down the WebContentsView')
    assert.equal(launches(), 3)
    assert.equal(maxConcurrent(), 1, 'still never two workers at once across the second transition')
  })
})

test('1533:list-fallback:2d bounds requests on a headless session are refused, not crashed', async () => {
  await lifecycleFixture(async ({ ipcMain, event }) => {
    const attach = ipcMain.handlers.get('colony:view:attach')
    const result = await attach(event, { headless: true })
    const bounds = ipcMain.handlers.get('colony:view:bounds')
    assert.equal(bounds(event, { attachment: result.attachment, bounds: { x: 0, y: 0, width: 10, height: 10 } }), false)
  })
})

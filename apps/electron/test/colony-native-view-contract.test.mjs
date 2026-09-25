import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { bindColonySceneChannel, registerColonyView } from '../src/colony-view.mjs'
import { makeArtifact, sourceCommit } from './support/colony-native-fixture.mjs'

const ENTRY = 'rhythm-colony://app/index.html'

class FakePort extends EventEmitter {
  closed = false
  messages = []
  peer = null
  start() {}
  postMessage(message) { this.messages.push(message) }
  close() {
    if (this.closed) return
    this.closed = true
    if (this.peer) this.peer.closed = true
    this.emit('close')
  }
}

class FakeMessageChannelMain {
  constructor() {
    this.port1 = new FakePort()
    this.port2 = new FakePort()
    this.port1.peer = this.port2
    this.port2.peer = this.port1
  }
}

function sceneBoundary({ loading = false, deferredFrame = false } = {}) {
  const ipcMain = new EventEmitter()
  const frame = {
    detached: false,
    url: ENTRY,
    messages: [],
    postMessage(channel, message, ports) { this.messages.push({ channel, message, ports }) },
    send() {},
  }
  const contents = Object.assign(new EventEmitter(), {
    mainFrame: frame,
    getURL: () => ENTRY,
    isLoadingMainFrame: () => loading,
  })
  let stops = 0
  const channel = bindColonySceneChannel({
    ipcMain,
    contents,
    frame: deferredFrame ? () => frame : frame,
    documentId: 'unit-document',
    service: { request: async () => ({}), stop: async () => { stops++ } },
    MessageChannelMain: FakeMessageChannelMain,
  })
  const ready = (senderFrame = frame) => ipcMain.emit('colony:scene-ready', { sender: contents, senderFrame }, { v: 1, product: 'colony' })
  return { channel, contents, frame, ready, setLoading: value => { loading = value }, stops: () => stops }
}

test('scene readiness queues once until load and a second readiness revokes the document', async () => {
  const queued = sceneBoundary({ loading: true })
  queued.ready()
  assert.equal(queued.frame.messages.length, 0)
  queued.contents.emit('did-finish-load')
  assert.equal(queued.frame.messages.length, 1)
  queued.ready()
  await queued.channel.dispose()
  assert.equal(queued.stops(), 1)
  assert.equal(queued.frame.messages[0].ports[0].closed, true)
})

test('committed navigation revokes authority even when Electron preserves the main-frame wrapper', async () => {
  const boundary = sceneBoundary()
  boundary.ready()
  assert.equal(boundary.frame.messages.length, 1)
  const oldPort = boundary.frame.messages[0].ports[0]
  boundary.contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false }, ENTRY, false, true)
  await boundary.channel.dispose()
  assert.equal(boundary.stops(), 1)
  assert.equal(oldPort.closed, true)
  boundary.ready()
  boundary.contents.emit('did-finish-load')
  assert.equal(boundary.frame.messages.length, 1, 'A reloaded document received a second port')
})

test('binding after load accepts only the already-committed exact main frame', async () => {
  const boundary = sceneBoundary({ loading: true })
  boundary.setLoading(false)
  const sibling = { detached: false, url: ENTRY }
  boundary.ready(sibling)
  assert.equal(boundary.frame.messages.length, 0, 'A same-URL sibling frame received authority')
  boundary.ready()
  assert.equal(boundary.frame.messages.length, 1, 'The committed main frame did not receive its port')
  await boundary.channel.dispose()
  assert.equal(boundary.stops(), 1)
})

test('pre-commit navigation cannot reuse readiness queued by an older document', async () => {
  const boundary = sceneBoundary({ loading: true, deferredFrame: true })
  boundary.ready()
  boundary.contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false }, ENTRY, false, true)
  boundary.setLoading(false)
  boundary.contents.emit('did-finish-load')
  assert.equal(boundary.frame.messages.length, 0, 'Queued readiness crossed a document navigation')
  boundary.ready()
  assert.equal(boundary.frame.messages.length, 1)
  await boundary.channel.dispose()
})

async function lifecycleFixture(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'colony-native-view-'))
  const artifactRoot = path.join(root, 'artifact')
  await makeArtifact(artifactRoot)
  const ipcMain = Object.assign(new EventEmitter(), {
    handlers: new Map(),
    handle(name, handler) { this.handlers.set(name, handler) },
    removeHandler(name) { this.handlers.delete(name) },
  })
  const partition = Object.assign(new EventEmitter(), {
    handled: false,
    unhandled: false,
    storageCleared: false,
    protocol: {
      handle() { partition.handled = true },
      unhandle() { partition.unhandled = true },
    },
    webRequest: { onBeforeRequest() {} },
    setPermissionRequestHandler() {},
    setPermissionCheckHandler() {},
    async clearStorageData() { partition.storageCleared = true },
  })
  let sceneContents
  class WebContentsView {
    constructor() {
      const frame = { detached: false, url: '', postMessage() {}, send() {} }
      let url = ''
      let loading = false
      sceneContents = Object.assign(new EventEmitter(), {
        mainFrame: frame,
        session: partition,
        closed: false,
        getURL: () => url,
        isLoadingMainFrame: () => loading,
        isDestroyed() { return this.closed },
        close() { this.closed = true },
        setWindowOpenHandler() {},
        async loadURL(next) {
          loading = true
          this.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false }, next, false, true)
          url = next
          frame.url = next
          loading = false
          this.emit('did-finish-load')
        },
      })
      this.webContents = sceneContents
    }
    setBounds() {}
  }
  const ownerFrame = { url: 'rhythm://app/index.html#/colony' }
  const ownerContents = Object.assign(new EventEmitter(), { mainFrame: ownerFrame, getZoomFactor: () => 1 })
  const contentView = {
    children: [],
    addChildView(view) { this.children.push(view) },
    removeChildView(view) { this.children = this.children.filter(candidate => candidate !== view) },
  }
  const win = { webContents: ownerContents, contentView, isDestroyed: () => false, getContentBounds: () => ({ width: 800, height: 600 }) }
  const child = Object.assign(new EventEmitter(), {
    pid: 99999999,
    connected: true,
    exitCode: null,
    signalCode: null,
    stderr: { resume() {} },
    kill() { return true },
    send(message) {
      if (message.type === 'colony:init') queueMicrotask(() => child.emit('message', {
        type: 'colony:ready', v: 1, product: 'colony', documentId: message.documentId,
        capabilities: ['inventory-v1', 'state-v1', 'host-intents-v1', 'state-mark-v1', 'import-v1'], runtime: { node: process.versions.node, sqlite: true },
      }))
    },
  })
  let launches = 0
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
    spawnChild: () => { launches++; return child },
  })
  const event = { sender: ownerContents, senderFrame: ownerFrame }
  try { await run({ host, ipcMain, event, partition, sceneContents: () => sceneContents, contentView, launches: () => launches }) }
  finally {
    child.exitCode = 0
    child.emit('exit', 0, null)
    await host.dispose().catch(() => {})
    await fs.rm(root, { recursive: true, force: true })
  }
}

test('sticky child-exit failure still completes local view and partition teardown and refuses replacement', async () => {
  await lifecycleFixture(async ({ host, ipcMain, event, partition, sceneContents, contentView, launches }) => {
    const attach = ipcMain.handlers.get('colony:view:attach')
    const first = await attach(event)
    assert.equal(first.ok, true)
    const repeated = await Promise.all(Array.from({ length: 5 }, () => attach(event)))
    assert.deepEqual(new Set(repeated.map(result => result.attachment)), new Set([first.attachment]))
    assert.equal(launches(), 1)
    await assert.rejects(host.disposeCurrent(), /exit|replacement|blocked/i)
    assert.equal(contentView.children.length, 0)
    assert.equal(sceneContents().closed, true)
    assert.equal(partition.listenerCount('will-download'), 0)
    assert.equal(partition.storageCleared, true)
    assert.equal(partition.unhandled, true)
    assert.deepEqual(await attach(event), { ok: false, reason: 'Colony child exit could not be confirmed; replacement is blocked' })
    assert.equal(launches(), 1)
  })
})

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
    signals: [],
    postMessage(channel, message, ports) { this.messages.push({ channel, message, ports }) },
    send(channel) { this.signals.push(channel) },
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
  assert.deepEqual(boundary.frame.signals, ['colony:revoke'], 'The old document was not revoked')
  boundary.ready()
  boundary.contents.emit('did-finish-load')
  assert.equal(boundary.frame.messages.length, 1, 'A reloaded document received a second port')
  assert.deepEqual(boundary.frame.signals, ['colony:revoke', 'colony:revoke'], 'The reloaded document was left waiting for a throttled timer')
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

async function lifecycleFixture(run, extra = {}) {
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
  const insertedCss = []
  const bounds = []
  class WebContentsView {
    constructor() {
      const frame = { detached: false, url: '', transferred: null, postMessage(_channel, message, ports) { this.transferred = ports[0]; this.handoff = message }, send() {} }
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
        async insertCSS(css) { insertedCss.push(css); return `skin-${insertedCss.length}` },
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
    setBounds(value) { bounds.push(value) }
  }
  const ownerFrame = { url: 'rhythm://app/index.html#/colony' }
  let hostFocuses = 0
  const hostEvents = []
  const ownerContents = Object.assign(new EventEmitter(), { mainFrame: ownerFrame, getZoomFactor: () => 1, focus: () => { hostFocuses++ }, send: (channel, message) => hostEvents.push({ channel, message }) })
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
      if (message.method === 'inventory.page') queueMicrotask(() => child.emit('message', {
        v: 1, documentId: message.documentId, id: message.id, ok: true,
        result: { generation: 'g1', collection: 'threads', scannedAt: 1, nextCursor: null, records: [{ id: 'rhythm:one', harness: 'rhythm', canOpen: false, ref: { sessionId: 'local-1' } }] },
      }))
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
    ...extra,
  })
  const event = { sender: ownerContents, senderFrame: ownerFrame }
  try { await run({ hostEvents, host, ipcMain, event, ownerFrame, ownerContents, partition, sceneContents: () => sceneContents, contentView, launches: () => launches, hostFocuses: () => hostFocuses, insertedCss, bounds }) }
  finally {
    child.exitCode = 0
    child.emit('exit', 0, null)
    await host.dispose().catch(() => {})
    await fs.rm(root, { recursive: true, force: true })
  }
}

test('native scene injects the Rhythm HUD skin after every document load', async () => {
  // Regression caught: the first load or a scene reload shows unskinned Bot Crossing menus inside Rhythm.
  await lifecycleFixture(async ({ host, ipcMain, event, sceneContents, insertedCss }) => {
    const result = await ipcMain.handlers.get('colony:view:attach')(event)
    assert.equal(result.ok, true)
    assert.equal(insertedCss.length, 1)
    assert.match(insertedCss[0], /\.hud|\.settings|\.thread-pop/)
    assert.match(insertedCss[0], /--rhythm-accent/)
    sceneContents().emit('did-finish-load')
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(insertedCss.length, 2)
    await host.disposeCurrent().catch(() => {})
  })
})

test('task-bot-crossing-c9-c12 hash tab departure suspends one native scene and reuses its attachment', async () => {
  // Regression: #/colony -> #/tasks destroys the view, worker, partition, document, and local scene state.
  await lifecycleFixture(async ({ host, ipcMain, event, ownerFrame, ownerContents, partition, sceneContents, contentView, launches, hostFocuses, bounds }) => {
    const attach = ipcMain.handlers.get('colony:view:attach')
    const detach = ipcMain.handlers.get('colony:view:detach')
    const setBounds = ipcMain.handlers.get('colony:view:bounds')
    const first = await attach(event)
    assert.equal(first.ok, true)
    ipcMain.emit('colony:scene-ready', { sender: sceneContents(), senderFrame: sceneContents().mainFrame }, { v: 1, product: 'colony' })
    assert.equal(await setBounds(event, { attachment: first.attachment, bounds: { x: 10, y: 20, width: 300, height: 200 } }), true)
    ownerFrame.url = 'rhythm://app/index.html#/tasks'
    ownerContents.emit('did-navigate-in-page')
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(bounds.at(-1), { x: 0, y: 0, width: 0, height: 0 })
    assert.equal(contentView.children.length, 1)
    assert.equal(sceneContents().closed, false)
    assert.equal(partition.storageCleared, false)
    assert.equal(partition.unhandled, false)
    assert.equal(launches(), 1)
    assert.equal(hostFocuses(), 1, 'suspend must transfer keyboard focus back to the Rhythm host')
    const hiddenEvent = sceneContents().mainFrame.transferred.peer.messages.at(-1)
    assert.deepEqual(hiddenEvent, {
      v: 1, documentId: hiddenEvent.documentId,
      event: 'host.visibility', payload: { hidden: true },
    })
    const sceneMessages = sceneContents().mainFrame.transferred.peer.messages.length
    ipcMain.emit('colony:view:intent', { sender: ownerContents, senderFrame: ownerFrame }, {
      attachment: first.attachment, event: 'host.select', payload: { threadId: 'rhythm:hidden-shortcut' },
    })
    assert.equal(sceneContents().mainFrame.transferred.peer.messages.length, sceneMessages, 'hidden scene shortcut intent must be blocked off-route')
    assert.equal(await detach(event, { attachment: first.attachment }), false, 'non-Colony route has no action authority')
    ownerFrame.url = 'rhythm://app/index.html#/colony'
    ownerContents.emit('did-navigate-in-page')
    const second = await attach(event)
    assert.equal(second.attachment, first.attachment)
    assert.equal(launches(), 1)
  })
})

test('task-bot-crossing-c17 departure before scene readiness queues hidden visibility until port transfer', async () => {
  // Regression: a fast tab departure happens before port creation, so the scene starts visible and polls/plays audio off-route.
  await lifecycleFixture(async ({ ipcMain, event, ownerFrame, ownerContents, sceneContents, hostFocuses }) => {
    const first = await ipcMain.handlers.get('colony:view:attach')(event)
    assert.equal(first.ok, true)
    ownerFrame.url = 'rhythm://app/index.html#/tasks'
    ownerContents.emit('did-navigate-in-page')
    assert.equal(hostFocuses(), 1)
    assert.equal(sceneContents().mainFrame.transferred, null)
    ipcMain.emit('colony:scene-ready', { sender: sceneContents(), senderFrame: sceneContents().mainFrame }, { v: 1, product: 'colony' })
    const messages = sceneContents().mainFrame.transferred.peer.messages
    assert.equal(messages.length, 1)
    assert.equal(messages[0].event, 'host.visibility')
    assert.deepEqual(messages[0].payload, { hidden: true })
  })
})

test('task-bot-crossing-c19 run evidence labels screenshots synthetic and blocks native continuity proof on packaging', async () => {
  // Regression: bridge fixture screenshots are presented as proof of native WebContentsView camera/HUD continuity.
  const note = await fs.readFile(new URL('../../../docs/ai/runs/2026-09-26-bot-crossing-persistence-auto-archive.md', import.meta.url), 'utf8')
  assert.match(note, /synthetic bridge lifecycle fixtures/i)
  assert.match(note, /do not prove native camera\/HUD continuity/i)
  assert.match(note, /packaged verification blocker/i)
})

test('task-bot-crossing-c11 full-document host navigation still fully disposes scene storage and worker ownership', async () => {
  // Regression: broad persistence accidentally keeps a privileged scene alive across reload/document replacement.
  await lifecycleFixture(async ({ ipcMain, event, ownerContents, partition, sceneContents, contentView }) => {
    const first = await ipcMain.handlers.get('colony:view:attach')(event)
    assert.equal(first.ok, true)
    ownerContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false }, 'rhythm://app/index.html', false, true)
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(contentView.children.length, 0)
    assert.equal(sceneContents().closed, true)
    assert.equal(partition.storageCleared, true)
    assert.equal(partition.unhandled, true)
  })
})

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

test('bot-crossing-open: the real native view wires scene action.run and Open labelling through main policy', async () => {
  // Regression caught: registerColonyView never forwarded runAction to the scene channel, so the
  // native Open button answered `result: undefined`; and the worker's canOpen:false stayed disabled.
  const actionCalls = []
  await lifecycleFixture(async ({ hostEvents, host, ipcMain, event, sceneContents }) => {
    const result = await ipcMain.handlers.get('colony:view:attach')(event)
    assert.equal(result.ok, true)
    ipcMain.emit('colony:scene-ready', { sender: sceneContents(), senderFrame: sceneContents().mainFrame }, { v: 1, product: 'colony' })
    const port = sceneContents().mainFrame.transferred.peer
    const { documentId } = sceneContents().mainFrame.handoff
    const send = (id, method, payload) => port.emit('message', { data: { v: 1, documentId, id, method, payload } })
    const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve)) }
    send('request-1', 'action.run', { kind: 'open', id: 'rhythm:one' })
    send('request-2', 'inventory.page', { collection: 'threads', limit: 250 })
    await settle()
    assert.deepEqual(actionCalls, [{ kind: 'open', id: 'rhythm:one' }])
    const responses = Object.fromEntries(port.messages.filter((message) => message.id).map((message) => [message.id, message]))
    assert.deepEqual(responses['request-1'].result, { ok: true, kind: 'rhythm-session', sessionId: 'local-1' })
    assert.equal(responses['request-2'].result.records[0].canOpen, true)
    assert.deepEqual(hostEvents.filter(({ message }) => message.event === 'scene.action').map(({ message }) => message.payload), [{ ok: true, kind: 'rhythm-session', sessionId: 'local-1' }])
    await host.disposeCurrent().catch(() => {})
  }, {
    runAction: async (value) => { actionCalls.push(value); return { ok: true, kind: 'rhythm-session', sessionId: 'local-1' } },
    sceneThread: (thread) => ({ ...thread, canOpen: true }),
  })
})

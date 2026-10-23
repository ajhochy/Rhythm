import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

import { SCENE_THREAD_BUDGET, bindColonySceneChannel, fitSceneThreads } from '../src/colony-view.mjs'

const ENTRY = 'rhythm-colony://app/index.html'

class Port extends EventEmitter {
  messages = []
  closed = false
  start() {}
  postMessage(message) { this.messages.push(message) }
  close() { this.closed = true; this.emit('close') }
}

class MessageChannelMain {
  static latest
  constructor() {
    this.port1 = new Port()
    this.port2 = new Port()
    MessageChannelMain.latest = this
  }
}

function fixture({ onHostEvent, sessionId = 'session-known', serviceRequest, precommit = false } = {}) {
  const ipcMain = new EventEmitter()
  const sceneFrame = { detached: false, url: ENTRY, transferred: [], postMessage(...args) { this.transferred.push(args) }, send() {} }
  const sceneContents = Object.assign(new EventEmitter(), {
    mainFrame: sceneFrame,
    getURL: () => ENTRY,
    isLoadingMainFrame: () => precommit,
  })
  const hostFrame = { url: 'rhythm://app/index.html#/colony' }
  const hostContents = Object.assign(new EventEmitter(), {
    mainFrame: hostFrame,
    events: [],
    send(channel, message) { this.events.push({ channel, message }); onHostEvent?.(channel, message) },
  })
  let workerRequests = 0
  let stops = 0
  const actionCalls = []
  const channel = bindColonySceneChannel({
    ipcMain,
    contents: sceneContents,
    frame: sceneFrame,
    documentId: 'document-1',
    attachment: 'attachment-1',
    hostContents,
    hostFrame,
    ownsThreadId: (threadId) => threadId === 'task-known',
    runAction: async (value) => {
      actionCalls.push(value)
      return { ok: true, kind: 'rhythm-session', sessionId }
    },
    onSceneEvent: (event, payload) => hostContents.send('colony:view:event', { attachment: 'attachment-1', event, payload }),
    service: {
      async request(message) { workerRequests++; return serviceRequest ? serviceRequest(message) : {} },
      async stop() { stops++ },
      status() { return { state: 'ready' } },
    },
    MessageChannelMain,
  })
  ipcMain.emit('colony:scene-ready', { sender: sceneContents, senderFrame: sceneFrame }, { v: 1, product: 'colony' })
  return { channel, ipcMain, sceneFrame, sceneContents, hostFrame, hostContents, port: precommit ? null : MessageChannelMain.latest.port1, workerRequests: () => workerRequests, stops: () => stops, actionCalls }
}

const tick = () => new Promise((resolve) => setImmediate(resolve))

test('two valid owning ready notices before load commit transfer one usable scene port', async () => {
  const f = fixture({ precommit: true, serviceRequest: async message => ({ v: 1, documentId: 'document-1', id: message.id, ok: true,
    result: { generation: 'generation-1', collection: 'projects', records: [], scannedAt: 1, nextCursor: null } }) })
  assert.equal(f.sceneFrame.transferred.length, 0)
  f.ipcMain.emit('colony:scene-ready', { sender: f.sceneContents, senderFrame: f.sceneFrame }, { v: 1, product: 'colony' })
  await tick()
  assert.equal(f.stops(), 0)
  assert.equal(f.sceneFrame.transferred.length, 0)
  f.sceneContents.isLoadingMainFrame = () => false
  f.sceneContents.emit('did-finish-load')
  assert.equal(f.sceneFrame.transferred.length, 1)
  const port = MessageChannelMain.latest.port1
  port.emit('message', { data: { v: 1, documentId: 'document-1', id: 'request-1', method: 'inventory.page', payload: { collection: 'projects', limit: 1 } } })
  await tick()
  assert.equal(port.messages[0].result.generation, 'generation-1')
  assert.equal(f.workerRequests(), 1)
  assert.equal(f.stops(), 0)
  await f.channel.dispose()
})

test('a malformed owning ready notice during load still revokes before port transfer', async () => {
  const f = fixture({ precommit: true })
  f.ipcMain.emit('colony:scene-ready', { sender: f.sceneContents, senderFrame: f.sceneFrame }, { v: 1, product: 'colony', extra: true })
  await tick()
  assert.equal(f.stops(), 1)
  f.sceneContents.isLoadingMainFrame = () => false
  f.sceneContents.emit('did-finish-load')
  assert.equal(f.sceneFrame.transferred.length, 0)
})

test('a coded inventory capacity refusal does not revoke the authorized document', async () => {
  const f = fixture({ serviceRequest: async message => message.id === 'request-1'
    ? { v: 1, documentId: 'document-1', id: message.id, ok: false, error: { code: 'oversize', message: 'Colony operation exceeds its size or capacity limit' } }
    : { v: 1, documentId: 'document-1', id: message.id, ok: true, result: { generation: 'generation-1', collection: 'projects', records: [], scannedAt: 1, nextCursor: null } } })
  const send = id => f.port.emit('message', { data: { v: 1, documentId: 'document-1', id, method: 'inventory.page', payload: { collection: 'projects', limit: 1 } } })
  send('request-1')
  await tick()
  assert.equal(f.port.messages[0].error.code, 'oversize')
  assert.equal(f.stops(), 0)
  assert.equal(f.port.closed, false)
  send('request-2')
  await tick()
  assert.equal(f.port.messages[1].result.generation, 'generation-1')
  assert.equal(f.workerRequests(), 2)
  await f.channel.dispose()
})

test('a malformed scene request revokes and reports only a bounded diagnostic reason', async () => {
  const reports = []
  const previous = console.error
  console.error = (...parts) => {
    if (parts[0] === '[colony:channel:revoked]') reports.push(parts[1])
    else previous(...parts)
  }
  try {
    const f = fixture()
    f.port.emit('message', { data: { v: 1, documentId: 'document-1', id: 'request-1', method: 'inventory.page', payload: { collection: 'threads', limit: 251, privateData: '/private-secret-probe' } } })
    await tick()
    assert.equal(f.stops(), 1)
    assert.equal(f.port.closed, true)
    assert.deepEqual(reports.map(JSON.parse), [{ reason: 'scene-request-failed', serviceState: 'ready', errorCode: 'invalid_request', phase: 'request-validation', method: 'inventory.page' }])
    assert.equal(reports.join('').includes('/private-secret-probe'), false)
  } finally { console.error = previous }
})

test('a repeated ready event reports whether the owning scene had already transferred its port', async () => {
  const reports = []
  const previous = console.error
  console.error = (...parts) => {
    if (parts[0] === '[colony:scene-ready:refused]') reports.push(parts[1])
    else if (parts[0] !== '[colony:channel:revoked]') previous(...parts)
  }
  try {
    const f = fixture()
    f.ipcMain.emit('colony:scene-ready', { sender: f.sceneContents, senderFrame: f.sceneFrame }, { v: 1, product: 'colony', privateData: '/private-secret-probe' })
    await tick()
    assert.equal(f.stops(), 1, 'a second ready event still revokes the one-time port')
    assert.deepEqual(reports.map(JSON.parse), [{ readySeen: true, validShape: false, transferred: true, committed: true, sceneEntry: true, currentEntry: true, loading: false }])
    assert.equal(reports.join('').includes('/private-secret-probe'), false)
  } finally { console.error = previous }
})

test('a repeated valid ready event also revokes the one-time scene port', async () => {
  const reports = []
  const previous = console.error
  console.error = (...parts) => {
    if (parts[0] === '[colony:scene-ready:refused]') reports.push(parts[1])
    else if (parts[0] !== '[colony:channel:revoked]') previous(...parts)
  }
  try {
    const f = fixture()
    f.ipcMain.emit('colony:scene-ready', { sender: f.sceneContents, senderFrame: f.sceneFrame }, { v: 1, product: 'colony' })
    await tick()
    assert.equal(f.stops(), 1)
    assert.equal(f.port.closed, true)
    assert.deepEqual(reports.map(JSON.parse), [{ readySeen: true, validShape: true, transferred: true, committed: true, sceneEntry: true, currentEntry: true, loading: false }])
  } finally { console.error = previous }
})

test('1530:scene-host-selection-routing-in-the-receiver:1 routes known scene selection once and drops unknown selection without worker forwarding', async () => {
  // Regression caught: scene-only intents leak to the worker or select a row that is absent from main's inventory.
  const f = fixture()
  f.port.emit('message', { data: { v: 1, documentId: 'document-1', id: 'request-1', method: 'scene.select', payload: { threadId: 'task-known' } } })
  f.port.emit('message', { data: { v: 1, documentId: 'document-1', id: 'request-2', method: 'scene.select', payload: { threadId: 'task-unknown' } } })
  f.port.emit('message', { data: { v: 1, documentId: 'document-1', id: 'request-3', method: 'scene.status', payload: { webgl: 'lost' } } })
  await tick()
  assert.deepEqual(f.hostContents.events, [
    { channel: 'colony:view:event', message: { attachment: 'attachment-1', event: 'scene.select', payload: { threadId: 'task-known' } } },
    { channel: 'colony:view:event', message: { attachment: 'attachment-1', event: 'scene.status', payload: { webgl: 'lost' } } },
  ])
  assert.equal(f.workerRequests(), 0)
  assert.deepEqual(f.port.messages.map(({ ok, result }) => ({ ok, result })), [
    { ok: true, result: null },
    { ok: true, result: null },
    { ok: true, result: null },
  ])
  await f.channel.dispose()
})

test('scene action.run dispatches through main policy and forwards Rhythm navigation to the host renderer', async () => {
  // Regression caught: the restored Bot Crossing Open button cannot reach existing main-process action policy or navigate a Rhythm session.
  const f = fixture()
  f.port.emit('message', { data: { v: 1, documentId: 'document-1', id: 'request-1', method: 'action.run', payload: { kind: 'open', id: 'task-known' } } })
  await tick()
  assert.deepEqual(f.actionCalls, [{ kind: 'open', id: 'task-known' }])
  assert.deepEqual(f.hostContents.events, [
    { channel: 'colony:view:event', message: { attachment: 'attachment-1', event: 'scene.action', payload: { ok: true, kind: 'rhythm-session', sessionId: 'session-known' } } },
  ])
  assert.deepEqual(f.port.messages, [{ v: 1, documentId: 'document-1', id: 'request-1', ok: true, result: { ok: true, kind: 'rhythm-session', sessionId: 'session-known' } }])
  assert.equal(f.workerRequests(), 0)
  await f.channel.dispose()
})

test('task-bot-crossing-open-c4 native action crosses the real preload once and navigates to the exact local session hash', async () => {
  // Regression caught: isolated scene and renderer tests pass while preload silently drops scene.action.
  let bridge
  const ipcRenderer = Object.assign(new EventEmitter(), {
    sendSync: () => 'https://api.example.test',
    send() {},
    invoke: async (channel) => channel === 'colony:view:attach'
      ? { ok: true, attachment: 'attachment-1' }
      : undefined,
  })
  runInNewContext(await readFile(new URL('../src/preload.cjs', import.meta.url), 'utf8'), {
    require: () => ({ contextBridge: { exposeInMainWorld(_key, value) { bridge = value } }, ipcRenderer }),
    process: { argv: [], env: {}, platform: 'darwin' },
    window: { addEventListener() {}, dispatchEvent() {} },
    CustomEvent: class {},
  })
  await bridge.colonyView.attach()
  let hash = '#/colony'
  let navigations = 0
  bridge.colonyView.onEvent((message) => {
    if (message.event === 'scene.action' && message.payload.kind === 'rhythm-session' && typeof message.payload.sessionId === 'string') {
      hash = `#/agents?sessionId=${encodeURIComponent(message.payload.sessionId)}`
      navigations++
    }
  })
  const f = fixture({
    sessionId: 'local-session-42',
    onHostEvent: (channel, message) => ipcRenderer.emit(channel, {}, message),
  })
  f.port.emit('message', { data: { v: 1, documentId: 'document-1', id: 'request-1', method: 'action.run', payload: { kind: 'open', id: 'task-known' } } })
  await tick()
  assert.deepEqual(f.actionCalls, [{ kind: 'open', id: 'task-known' }])
  assert.equal(hash, '#/agents?sessionId=local-session-42')
  assert.equal(navigations, 1)
  await f.channel.dispose()
})

test('1530:scene-host-selection-routing-in-the-receiver:2 posts only closed host events from the owning live frame', async () => {
  // Regression caught: stale/foreign renderer frames or open-ended intent objects can control the embedded scene.
  const f = fixture()
  const owner = { sender: f.hostContents, senderFrame: f.hostFrame }
  const intent = { attachment: 'attachment-1', event: 'host.select', payload: { threadId: 'task-known' } }
  f.ipcMain.emit('colony:view:intent', owner, intent)
  assert.deepEqual(f.port.messages, [{ v: 1, documentId: 'document-1', event: 'host.select', payload: { threadId: 'task-known' } }])

  const rejected = [
    { ...intent, event: 'host.unknown' },
    { ...intent, extra: true },
    { ...intent, payload: { threadId: 'task-known', extra: true } },
  ]
  for (const value of rejected) f.ipcMain.emit('colony:view:intent', owner, value)
  f.ipcMain.emit('colony:view:intent', { sender: f.hostContents, senderFrame: { url: f.hostFrame.url } }, intent)
  f.ipcMain.emit('colony:view:intent', { sender: new EventEmitter(), senderFrame: f.hostFrame }, intent)
  assert.equal(f.port.messages.length, 1)

  await f.channel.dispose()
  f.ipcMain.emit('colony:view:intent', owner, intent)
  assert.equal(f.port.messages.length, 1)
})

test('1530:host-inventory-path-task-rail-and-inspector:2 refuses non-scene request ids before worker forwarding', async () => {
  // Regression caught: a scene can collide with host-N inventory ids and steal a pending worker response.
  const f = fixture()
  f.port.emit('message', { data: { v: 1, documentId: 'document-1', id: 'host-1', method: 'inventory.page', payload: {} } })
  await tick()
  assert.equal(f.workerRequests(), 0)
  assert.equal(f.port.closed, true)
})

test('bot-crossing-snapshot: scene threads stay inside the 1 MiB frame and the 24 MiB snapshot budget', () => {
  // Regression caught: main's Open relabel grew a near-cap inventory past the scene's 32 MiB reassembly limit
  // ("Inventory snapshot exceeds 32 MiB") and could push a full worker page past the 1 MiB frame.
  const record = (i) => ({ id: `rhythm:${i}`, harness: 'rhythm', title: 'x'.repeat(120), preview: 'y'.repeat(4000), canOpen: false })
  const page = (cursor, count) => ({ v: 1, documentId: 'd', id: 'request-1', ok: true,
    result: { generation: 'g1', collection: 'threads', scannedAt: 1, records: Array.from({ length: count }, (_, i) => record(cursor + i)), nextCursor: String(cursor + count) } })
  const relabel = (thread) => ({ ...thread, canOpen: true, navigationReason: 'z'.repeat(400) })

  const first = page(0, 250)
  let used = fitSceneThreads(first, { collection: 'threads', limit: 250 }, { generation: '', bytes: 0 }, relabel)
  assert.ok(Buffer.byteLength(JSON.stringify(first)) <= 1024 * 1024)
  assert.ok(first.result.records.length > 1 && first.result.records.length < 250)
  assert.equal(first.result.nextCursor, String(first.result.records.length), 'trimmed tail is re-fetched from the next cursor')
  assert.equal(first.result.records[0].canOpen, true)

  let cursor = Number(first.result.nextCursor)
  let total = first.result.records.length
  for (let pages = 0; pages < 200 && cursor; pages++) {
    const next = page(cursor, 200)
    used = fitSceneThreads(next, { collection: 'threads', limit: 250, generation: 'g1', cursor: String(cursor) }, used, relabel)
    total += next.result.records.length
    cursor = next.result.nextCursor === null ? 0 : Number(next.result.nextCursor)
    assert.ok(next.result.nextCursor === null || next.result.nextCursor === String(total), 'cursor matches what the scene accumulated')
  }
  assert.equal(cursor, 0, 'budget ends the collection with nextCursor:null')
  assert.ok(used.bytes <= SCENE_THREAD_BUDGET && used.bytes > SCENE_THREAD_BUDGET - 8 * 1024)

  const fresh = page(0, 1)
  assert.equal(fitSceneThreads(fresh, { collection: 'threads' }, used, undefined).bytes, Buffer.byteLength(JSON.stringify(fresh.result.records[0])) + 1, 'a new pass resets the budget')
})

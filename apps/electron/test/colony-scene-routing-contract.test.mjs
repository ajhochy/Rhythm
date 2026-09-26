import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import { bindColonySceneChannel } from '../src/colony-view.mjs'

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

function fixture() {
  const ipcMain = new EventEmitter()
  const sceneFrame = { detached: false, url: ENTRY, postMessage() {}, send() {} }
  const sceneContents = Object.assign(new EventEmitter(), {
    mainFrame: sceneFrame,
    getURL: () => ENTRY,
    isLoadingMainFrame: () => false,
  })
  const hostFrame = { url: 'rhythm://app/index.html#/colony' }
  const hostContents = Object.assign(new EventEmitter(), {
    mainFrame: hostFrame,
    events: [],
    send(channel, message) { this.events.push({ channel, message }) },
  })
  let workerRequests = 0
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
      return { ok: true, kind: 'rhythm-session', sessionId: 'session-known' }
    },
    onSceneEvent: (event, payload) => hostContents.send('colony:view:event', { attachment: 'attachment-1', event, payload }),
    service: {
      async request() { workerRequests++; return {} },
      async stop() {},
    },
    MessageChannelMain,
  })
  ipcMain.emit('colony:scene-ready', { sender: sceneContents, senderFrame: sceneFrame }, { v: 1, product: 'colony' })
  return { channel, ipcMain, sceneFrame, sceneContents, hostFrame, hostContents, port: MessageChannelMain.latest.port1, workerRequests: () => workerRequests, actionCalls }
}

const tick = () => new Promise((resolve) => setImmediate(resolve))

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

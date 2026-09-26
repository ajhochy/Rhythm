import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createColonyActions } from '../src/colony-actions.mjs'
import { registerColonyHost } from '../src/colony-host.mjs'

const rhythm = (id, sessionId, extra = {}) => ({ id, harness: 'rhythm', ref: { sessionId, sdkSessionId: 'sdk-must-never-open' }, ...extra })
const codex = (id, sessionId, extra = {}) => ({ id, harness: 'codex', ref: { sessionId }, ...extra })

async function fixture(t, records) {
  const root = await mkdtemp(path.join(tmpdir(), 'rhythm-colony-actions-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const launches = [], reveals = [], copies = [], marks = [], protocolProbes = []
  let generation = 'generation-1'
  const recordsGeneration = generation
  const inventory = new Map(records.map((record) => [record.id, record]))
  const actions = createColonyActions({
    currentGeneration: () => generation,
    resolveRecord: (id, requestedGeneration) => requestedGeneration === recordsGeneration ? inventory.get(id) : undefined,
    app: { getApplicationNameForProtocol: (value) => { protocolProbes.push(value); return value.startsWith('codex://') ? 'Codex' : '' } },
    shell: {
      openExternal: async (url) => { launches.push(url) },
      showItemInFolder: (value) => reveals.push(value),
    },
    clipboard: { writeText: (value) => copies.push(value) },
    requestState: async (method, payload) => { marks.push({ method, payload }); return { ok: true } },
  })
  return { root, actions, launches, reveals, copies, marks, protocolProbes, setGeneration: (value) => { generation = value } }
}

test('1531:colony-main-action-policy:1 exact Rhythm open returns only a validated current local session id', async (t) => {
  // Regression caught: an SDK id, stale row, or first inventory row opens instead of the requested local task.
  const f = await fixture(t, [rhythm('rhythm:first', 'local-first'), rhythm('rhythm:outside-page-one', 'local_exact_42')])
  assert.deepEqual(await f.actions.run({ kind: 'open', id: 'rhythm:outside-page-one' }), { ok: true, kind: 'rhythm-session', sessionId: 'local_exact_42' })
  assert.equal(JSON.stringify(await f.actions.run({ kind: 'open', id: 'rhythm:outside-page-one' })).includes('sdk-must-never-open'), false)
  f.setGeneration('generation-2')
  assert.match((await f.actions.run({ kind: 'open', id: 'rhythm:outside-page-one' })).reason, /stale|current/i)
  assert.equal((await f.actions.run({ kind: 'open', id: 'rhythm:missing' })).ok, false)

  const invalid = await fixture(t, [rhythm('rhythm:invalid', 'bad/session'), rhythm('rhythm:valid', 'valid-local')])
  assert.deepEqual(await invalid.actions.run({ kind: 'open', id: 'rhythm:invalid' }), { ok: false, reason: 'This Rhythm task has no verified local session ID.' })
})

test('1531:colony-main-action-policy:2 SDK-only children refuse open and resolve only their verified parent', async (t) => {
  // Regression caught: an OpenCode SDK child is substituted for a local Rhythm session or an unrelated row.
  const f = await fixture(t, [
    { id: 'opencode:child', harness: 'opencode', parentId: 'rhythm:parent', ref: { sdkSessionId: 'sdk-only' } },
    rhythm('rhythm:parent', 'local-parent'),
  ])
  assert.match((await f.actions.run({ kind: 'open', id: 'opencode:child' })).reason, /SDK-only|unavailable/i)
  assert.deepEqual(await f.actions.run({ kind: 'showParent', id: 'opencode:child' }), {
    ok: true, kind: 'select-thread', id: 'rhythm:parent', sessionId: 'local-parent',
  })

  const workers = await fixture(t, [
    { id: 'codex:child', harness: 'codex', parentId: 'codex:parent', ref: { sessionId: '01992f4e-1111-7c21-9f00-123456789abc' } },
    codex('codex:parent', '01992f4e-7b3a-7c21-9f00-123456789abc'),
  ])
  assert.deepEqual(await workers.actions.run({ kind: 'showParent', id: 'codex:child' }), {
    ok: true, kind: 'select-thread', id: 'codex:parent',
  })
})

test('1531:colony-main-action-policy:3 Codex opens the exact UUID only with an installed handler and reports dispatch failures', async (t) => {
  // Regression caught: arbitrary deep links launch, or a missing/rejecting Codex app reports success.
  const uuid = '01992f4e-7b3a-7c21-9f00-123456789abc'
  const f = await fixture(t, [codex('codex:exact', uuid), codex('codex:bad', 'not-a-uuid')])
  assert.deepEqual(await f.actions.run({ kind: 'open', id: 'codex:exact' }), { ok: true, kind: 'external-app' })
  assert.deepEqual(f.protocolProbes, [`codex://threads/${uuid}`])
  assert.deepEqual(f.launches, [`codex://threads/${uuid}`])
  assert.match((await f.actions.run({ kind: 'open', id: 'codex:bad' })).reason, /verified Codex/i)

  const missing = createColonyActions({ currentGeneration: () => 'g', resolveRecord: () => codex('codex:exact', uuid), app: { getApplicationNameForProtocol: () => '' }, shell: { openExternal: async () => { throw new Error('must not launch') } } })
  assert.match((await missing.run({ kind: 'open', id: 'codex:exact' })).reason, /not installed/i)
  const rejected = createColonyActions({ currentGeneration: () => 'g', resolveRecord: () => codex('codex:exact', uuid), app: { getApplicationNameForProtocol: () => 'Codex' }, shell: { openExternal: async () => { throw new Error('OS denied synthetic dispatch') } } })
  const failure = await rejected.run({ kind: 'open', id: 'codex:exact' })
  assert.equal(failure.ok, false)
  assert.match(failure.reason, /OS denied synthetic dispatch/)
})

test('1531:colony-main-action-policy:4 reveal and copy use only an existing inventory checkout path', async (t) => {
  // Regression caught: renderer-supplied paths, URLs, commands, or stale refs launch or write.
  const root = await mkdtemp(path.join(tmpdir(), 'rhythm-colony-checkout-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const checkout = path.join(root, 'checkout')
  await writeFile(checkout, 'synthetic')
  const f = await fixture(t, [{ id: 'codex:path', harness: 'codex', checkout: { path: checkout }, ref: { sessionId: '11111111-2222-4333-8444-555555555555' } }])
  assert.deepEqual(await f.actions.run({ kind: 'reveal', id: 'codex:path' }), { ok: true, kind: 'revealed' })
  assert.deepEqual(await f.actions.run({ kind: 'copyPath', id: 'codex:path' }), { ok: true, kind: 'copied' })
  assert.deepEqual(f.reveals, [checkout])
  assert.deepEqual(f.copies, [checkout])

  for (const attack of [
    { kind: 'reveal', id: 'codex:path', path: '/tmp/injected' },
    { kind: 'copyPath', id: 'codex:path', url: 'file:///tmp/injected' },
    { kind: 'open', id: 'codex:path', command: ['/bin/sh'] },
    { kind: 'launch', id: 'codex:path' },
    { kind: 'reveal', id: 'foreign' },
  ]) assert.equal((await f.actions.run(attack)).ok, false)
  assert.deepEqual(f.reveals, [checkout])
  assert.deepEqual(f.copies, [checkout])
  assert.deepEqual(f.launches, [])
})

test('1531:colony-main-action-policy:5 archive restore and viewed are closed state.mark requests', async (t) => {
  // Regression caught: local state actions mutate a harness or send an open-ended worker method.
  const f = await fixture(t, [rhythm('rhythm:state', 'local-state')])
  assert.equal((await f.actions.run({ kind: 'archive', id: 'rhythm:state' })).ok, true)
  assert.equal((await f.actions.run({ kind: 'restore', id: 'rhythm:state' })).ok, true)
  assert.equal((await f.actions.run({ kind: 'viewed', id: 'rhythm:state' })).ok, true)
  assert.deepEqual(f.marks.map(({ method, payload }) => ({ method, ...payload, viewedAt: payload.viewedAt ? 'timestamp' : undefined })), [
    { method: 'state.mark', threadId: 'rhythm:state', archived: true, viewedAt: undefined },
    { method: 'state.mark', threadId: 'rhythm:state', archived: false, viewedAt: undefined },
    { method: 'state.mark', threadId: 'rhythm:state', viewedAt: 'timestamp' },
  ])
})

test('1531:colony-main-action-policy:6 host accepts only kind/id and resolves private current inventory refs', async (t) => {
  // Regression caught: renderer paths/refs cross IPC or actions resolve outside the active generation.
  const root = await mkdtemp(path.join(tmpdir(), 'rhythm-colony-action-host-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const handlers = new Map(), requests = []
  let liveAttachment = ''
  let onViewDispose = () => {}
  const host = registerColonyHost({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler), removeHandler: (name) => handlers.delete(name) },
    getWindow: () => null, ownsHost: () => true,
    userDataPath: path.join(root, 'user-data'), resourcesPath: path.join(root, 'Resources'), home: path.join(root, 'home'),
    isPackaged: false, environment: { RHYTHM_COLONY_ARTIFACT_DIR: '/fixtures/artifact', RHYTHM_COLONY_NODE: process.execPath },
    fs: { lstat: async () => { throw new Error('missing') } }, app: { getApplicationNameForProtocol: () => '' }, shell: {}, clipboard: {},
    registerView: (options) => {
      onViewDispose = options.onDispose
      return {
      currentAttachment: () => liveAttachment,
      disposeCurrent: async () => { if (liveAttachment) { liveAttachment = ''; onViewDispose() } }, dispose: async () => {},
      requestHost: async (value) => {
        requests.push(value)
        if (value.method === 'inventory.page') return { ok: true, result: { generation: 'current-gen', collection: 'threads', records: [rhythm('rhythm:exact', 'local-exact')], nextCursor: null } }
        return { ok: true, result: {} }
      },
    }},
  })
  t.after(() => host.dispose())
  await host.activateProfile({ productionApiBase: 'https://api.example.test', userId: 'person' })
  await handlers.get('colony:host:set-enabled')({}, true)
  liveAttachment = 'attachment'
  await handlers.get('colony:inventory:page')({}, { attachment: 'attachment', page: { collection: 'threads' } })
  assert.deepEqual(await handlers.get('colony:action:run')({}, { attachment: 'attachment', kind: 'open', id: 'rhythm:exact' }), { ok: true, kind: 'rhythm-session', sessionId: 'local-exact' })
  assert.equal((await handlers.get('colony:action:run')({}, { attachment: 'attachment', kind: 'open', id: 'rhythm:exact', ref: { sessionId: 'injected' } })).ok, false)
  assert.equal(requests.length, 1)
  onViewDispose()
  liveAttachment = ''
  assert.equal((await handlers.get('colony:action:run')({}, { attachment: 'attachment', kind: 'open', id: 'rhythm:exact' })).ok, false)
})

test('review:apps/electron/src/colony-host.mjs:185 settings cannot run task actions and late inventory cannot restore revoked refs', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'rhythm-colony-action-authority-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const handlers = new Map()
  let resolvePage
  let attachment = ''
  const frame = { url: 'rhythm://app/index.html#/colony' }
  const contents = { mainFrame: frame }
  const win = { isDestroyed: () => false, webContents: contents }
  const event = { sender: contents, senderFrame: frame }
  const host = registerColonyHost({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler), removeHandler: (name) => handlers.delete(name) },
    getWindow: () => win,
    userDataPath: path.join(root, 'user-data'), resourcesPath: path.join(root, 'Resources'), home: path.join(root, 'home'),
    isPackaged: false, environment: { RHYTHM_COLONY_ARTIFACT_DIR: '/fixtures/artifact', RHYTHM_COLONY_NODE: process.execPath },
    fs: { lstat: async () => { throw new Error('missing') } }, app: { getApplicationNameForProtocol: () => '' }, shell: {}, clipboard: {},
    registerView: ({ onDispose }) => ({
      currentAttachment: () => attachment,
      disposeCurrent: async () => { if (attachment) { attachment = ''; onDispose() } },
      dispose: async () => {},
      requestHost: async () => new Promise((resolve) => { resolvePage = resolve }),
    }),
  })
  t.after(() => host.dispose())
  await host.activateProfile({ productionApiBase: 'https://api.example.test', userId: 'person' })
  await handlers.get('colony:host:set-enabled')(event, true)
  attachment = 'live-attachment'
  const pending = handlers.get('colony:inventory:page')(event, { attachment, page: { collection: 'threads' } })
  await handlers.get('colony:host:set-enabled')(event, false)
  resolvePage({ ok: true, result: { generation: 'revoked-generation', collection: 'threads', records: [rhythm('rhythm:late', 'late-session')], nextCursor: null } })
  await assert.rejects(pending, /revoked|unavailable|disabled/i)

  frame.url = 'rhythm://app/index.html#/settings'
  assert.equal((await handlers.get('colony:host:status')(event)).enabled, false)
  await assert.rejects(() => handlers.get('colony:action:run')(event, { attachment: 'live-attachment', kind: 'open', id: 'rhythm:late' }), /denied/i)
})

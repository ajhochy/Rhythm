import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { registerColonyHost } from '../src/colony-host.mjs'

test('1530:host-inventory-path-task-rail-and-inspector:1 pages with host ids, strips launch authority, and remembers refs by generation', async (t) => {
  // Regression caught: renderer-visible inventory leaks opaque refs/commands or scene selection trusts an unobserved id.
  const root = await mkdtemp(path.join(tmpdir(), 'rhythm-colony-inventory-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const handlers = new Map()
  const ipcMain = { handle(name, fn) { handlers.set(name, fn) }, removeHandler(name) { handlers.delete(name) } }
  const requests = []
  let viewOptions
  const view = {
    async disposeCurrent() {},
    async dispose() {},
    async requestHost(value) {
      requests.push(value)
      return {
        v: 1,
        documentId: 'private-document',
        id: value.id,
        ok: true,
        result: {
          generation: 'generation-1', collection: 'threads', scannedAt: 123,
          records: [{
            id: 'rhythm:task-1', title: 'Selected task', ref: { sessionId: 'private' },
            command: { argv: ['/private/bin'] }, appCommand: { argv: ['/private/app'] }, terminalCommand: 'private',
            openCapabilities: { command: { argv: ['/nested/private'] }, safe: true },
          }],
          nextCursor: null,
        },
      }
    },
  }
  const host = registerColonyHost({
    ipcMain,
    getWindow: () => null,
    userDataPath: path.join(root, 'user-data'), resourcesPath: path.join(root, 'Resources'), home: path.join(root, 'home'),
    isPackaged: false,
    environment: { RHYTHM_COLONY_ARTIFACT_DIR: '/fixtures/artifact', RHYTHM_COLONY_NODE: process.execPath },
    fs: { lstat: async () => { throw new Error('missing') } },
    ownsHost: () => true,
    registerView(options) { viewOptions = options; return view },
  })
  t.after(() => host.dispose())
  await host.activateProfile({ productionApiBase: 'https://api.example.test', userId: 'person-1' })
  await handlers.get('colony:host:set-enabled')({}, true)

  const page = await handlers.get('colony:inventory:page')({}, { attachment: 'attachment-1', page: { collection: 'threads', limit: 25 } })
  assert.deepEqual(requests, [{ attachment: 'attachment-1', id: 'host-1', method: 'inventory.page', payload: { collection: 'threads', limit: 25 } }])
  assert.equal(JSON.stringify(page).includes('private'), false)
  assert.equal(JSON.stringify(page).includes('command'), false)
  assert.equal(page.records[0].openCapabilities.safe, true)
  assert.equal(viewOptions.ownsThreadId('rhythm:task-1'), true)
  assert.equal(viewOptions.ownsThreadId('rhythm:unknown'), false)
})

import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { electronDbPath } from '../src/agent-server.mjs'
import { validateSources } from '../src/colony-service.mjs'
import { discover, toServiceSources } from '../src/colony-sources.mjs'

const IDS = ['hermes', 'codex', 'rhythm', 'opencode', 'claude-code', 'cursor', 'antigravity', 'kilocode']

test('1528:source-discovery:1 discover returns every supported source and rebases electronDbPath', async () => {
  // Regression caught: a hand-written Rhythm path drifts from the database the Electron server owns.
  const home = path.join(path.sep, 'synthetic', 'home')
  const presentSuffixes = new Set(['.hermes', '.codex'])
  const fs = { lstat: async (candidate) => {
    if ([...presentSuffixes].some((suffix) => candidate.includes(suffix))) return { isFile: () => true, isDirectory: () => true }
    throw Object.assign(new Error('missing'), { code: 'ENOENT' })
  } }
  const sources = await discover({ home, fs })
  assert.deepEqual(sources.map(({ id }) => id), IDS)
  assert.ok(sources.every(({ id, paths, state }) => IDS.includes(id) && paths && ['present', 'missing'].includes(state)))
  assert.equal(sources.find(({ id }) => id === 'hermes').state, 'present')
  assert.equal(sources.find(({ id }) => id === 'kilocode').state, 'missing')

  const expectedRhythm = path.join(home, path.relative(os.homedir(), electronDbPath()))
  assert.equal(sources.find(({ id }) => id === 'rhythm').paths.database, expectedRhythm)
})

test('1528:source-discovery:2 discovery only lstat probes candidate paths', async () => {
  // Regression caught: opening or enumerating a store during settings discovery performs a harness read before opt-in.
  const calls = []
  const fs = new Proxy({ lstat: async (candidate) => { calls.push(['lstat', candidate]); throw new Error('missing') } }, {
    get(target, property) {
      if (property in target) return target[property]
      return (...args) => { calls.push([String(property), ...args]); throw new Error(`forbidden ${String(property)}`) }
    },
  })
  const sources = await discover({ home: '/synthetic/home', fs })
  assert.equal(sources.length, 8)
  assert.ok(calls.length >= 8)
  assert.deepEqual([...new Set(calls.map(([name]) => name))], ['lstat'])
})

test('1528:source-discovery:3 service conversion is closed, absolute and receiver-valid', () => {
  // Regression caught: renderer-controlled unknown IDs or relative paths cross into the worker handshake.
  const sources = toServiceSources({
    v: 1,
    enabled: true,
    sources: {
      hermes: { enabled: true, paths: { home: '/fixtures/hermes' } },
      codex: { enabled: false, paths: { home: '/fixtures/codex' } },
      rhythm: { enabled: true, paths: { database: 'relative/rhythm.db' } },
      invented: { enabled: true, paths: { home: '/fixtures/invented' } },
    },
  })
  assert.deepEqual(sources, [
    { id: 'hermes', enabled: true, paths: { home: '/fixtures/hermes' } },
    { id: 'codex', enabled: false },
  ])
  assert.doesNotThrow(() => validateSources(sources))
  assert.ok(sources.every((source) => Object.keys(source).every((key) => ['id', 'enabled', 'paths'].includes(key))))
})

test('1528:source-discovery:4 a disabled preference stays disabled when discovered present', () => {
  // Regression caught: filesystem presence silently overrides the user's source opt-out.
  const [source] = toServiceSources({
    v: 1,
    enabled: true,
    sources: { cursor: { enabled: false, paths: { projects: '/fixtures/cursor/projects' }, state: 'present' } },
  })
  assert.deepEqual(source, { id: 'cursor', enabled: false })
})

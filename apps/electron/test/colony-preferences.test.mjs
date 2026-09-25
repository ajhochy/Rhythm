import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createColonyPreferences, dataDirFor, profileKeyFor } from '../src/colony-preferences.mjs'

async function fixture(t, overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rhythm-colony-preferences-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const userDataPath = path.join(root, 'user-data')
  const resourcesPath = path.join(root, 'Rhythm.app', 'Contents', 'Resources')
  await fs.mkdir(resourcesPath, { recursive: true })
  return {
    root,
    userDataPath,
    resourcesPath,
    productionApiBase: 'https://api.example.test',
    userId: 'user-123',
    ...overrides,
  }
}

test('1532:profile-preferences:1 fresh profile is disabled and signed-out cannot enable', async (t) => {
  // Regression caught: constructing preferences opts a new or signed-out profile into local scans.
  const options = await fixture(t)
  const expectedKey = createHash('sha256')
    .update(`${options.productionApiBase}\0${options.userId}`)
    .digest('hex')
  assert.equal(profileKeyFor(options.productionApiBase, options.userId), expectedKey)

  const preferences = createColonyPreferences(options)
  assert.deepEqual(await preferences.read(), { v: 1, enabled: false, sources: {} })

  const signedOut = createColonyPreferences({ ...options, userId: undefined })
  assert.equal(signedOut.key, null)
  assert.deepEqual(await signedOut.read(), { v: 1, enabled: false, sources: {} })
  await assert.rejects(() => signedOut.setEnabled(true), /signed in/i)
})

test('1532:profile-preferences:2 writes use temp plus rename and reject resource paths', async (t) => {
  // Regression caught: a partial write or packaged-resource source path mutates unsafe state.
  const options = await fixture(t)
  const operations = []
  const io = {
    ...fs,
    writeFile: async (...args) => { operations.push(['writeFile', String(args[0])]); return fs.writeFile(...args) },
    rename: async (...args) => { operations.push(['rename', String(args[0]), String(args[1])]); return fs.rename(...args) },
  }
  const preferences = createColonyPreferences({ ...options, fs: io })
  await preferences.setEnabled(true)
  const safePath = path.join(options.root, 'harnesses', 'hermes.db')
  await preferences.setSource('hermes', { enabled: true, paths: { home: safePath } })

  const target = path.join(options.userDataPath, 'colony', 'profiles', preferences.key, 'preferences.json')
  assert.equal(operations.filter(([name]) => name === 'rename').length, 2)
  assert.ok(operations.every(([name, first, second]) => name !== 'rename' || (first.startsWith(`${target}.tmp-`) && second === target)))
  assert.deepEqual(JSON.parse(await fs.readFile(target, 'utf8')), {
    v: 1,
    enabled: true,
    sources: { hermes: { enabled: true, paths: { home: safePath } } },
  })

  await assert.rejects(
    () => preferences.setSource('codex', { enabled: true, paths: { home: path.join(options.resourcesPath, 'colony-desktop', 'data') } }),
    /resources/i,
  )
  assert.throws(
    () => createColonyPreferences({ ...options, userDataPath: path.join(options.resourcesPath, 'profile') }),
    /resources/i,
  )
})

test('1532:profile-preferences:3 corrupt bytes survive and disable preserves source choices', async (t) => {
  // Regression caught: recovery overwrites corrupt evidence or disabling discards configured sources.
  const options = await fixture(t)
  const preferences = createColonyPreferences(options)
  const safePath = path.join(options.root, 'codex-home')
  await preferences.setSource('codex', { enabled: true, paths: { home: safePath } })
  await preferences.setEnabled(true)
  await preferences.setEnabled(false)
  assert.deepEqual(await preferences.read(), {
    v: 1,
    enabled: false,
    sources: { codex: { enabled: true, paths: { home: safePath } } },
  })
  await preferences.setEnabled(true)
  assert.equal((await preferences.read()).enabled, true)

  const target = path.join(options.userDataPath, 'colony', 'profiles', preferences.key, 'preferences.json')
  const corrupt = Buffer.from('{not-json\n')
  await fs.writeFile(target, corrupt)
  assert.deepEqual(await preferences.read(), { v: 1, enabled: false, sources: {} })
  assert.deepEqual(await fs.readFile(target), corrupt)
})

test('1532:profile-preferences:4 profile keys isolate state and dataDirFor selects profile state', async (t) => {
  // Regression caught: account switching leaks enablement or worker state between profiles.
  const options = await fixture(t)
  const first = createColonyPreferences(options)
  const second = createColonyPreferences({ ...options, userId: 'user-456' })
  await first.setEnabled(true)
  await first.setSource('rhythm', { enabled: true, paths: { database: path.join(options.root, 'rhythm.db') } })

  assert.notEqual(first.key, second.key)
  assert.deepEqual(await second.read(), { v: 1, enabled: false, sources: {} })
  assert.equal(
    dataDirFor(options.userDataPath, first.key),
    path.join(options.userDataPath, 'colony', 'profiles', first.key, 'state'),
  )
  assert.equal(first.dataDir(), dataDirFor(options.userDataPath, first.key))
})

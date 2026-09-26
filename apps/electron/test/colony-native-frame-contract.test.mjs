import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
let view
try { view = await import('../src/colony-view.mjs') } catch {}
let root
let receipt
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
before(async () => {
  if (!view?.registerColonyView) return // Individual RED assertions identify the missing product seam.
  assert.ok(process.env.COLONY_NATIVE_ARTIFACT, 'Set COLONY_NATIVE_ARTIFACT to a built actual worker-bearing Bot Crossing artifact; no fake renderer fallback')
  assert.match(process.env.COLONY_NATIVE_SOURCE_COMMIT || '', /^[a-f0-9]{40}$/)
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'colony-native-frames-'))
  await fs.cp(process.env.COLONY_NATIVE_ARTIFACT, path.join(root, 'artifact'), { recursive: true })
  await fs.mkdir(path.join(root, 'hermes'))
  const { DatabaseSync } = await import('node:sqlite')
  const database = path.join(root, 'hermes/state.db')
  const db = new DatabaseSync(database)
  db.exec("CREATE TABLE sessions (id TEXT, title TEXT, cwd TEXT); INSERT INTO sessions VALUES ('native-fixture', 'Native synthetic task', '/synthetic/project');")
  db.close()
  const before = hash(await fs.readFile(database))
  // Runtime path is fixed relative to the pinned Electron dependency, never ambient PATH.
  const executable = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const script = fileURLToPath(new URL('./support/colony-native-electron-fixture.mjs', import.meta.url))
  const child = spawn(executable, [script], { env: { HOME: root, TMPDIR: root, PATH: '', COLONY_NATIVE_ROOT: root,
    COLONY_NATIVE_NODE: process.execPath, COLONY_NATIVE_SOURCE_COMMIT: process.env.COLONY_NATIVE_SOURCE_COMMIT }, stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', data => { stderr = (stderr + data).slice(-8192) })
  await new Promise((resolve, reject) => {
    // The five real-frame cases include two bounded document-revocation waits.
    // Preserve a separate hard ceiling while allowing loaded CI hosts to finish cleanup and write the receipt.
    const timer = setTimeout(() => { child.kill('SIGKILL') }, 90000)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Native fixture exit ${code}: ${stderr}`)) })
  })
  receipt = JSON.parse(await fs.readFile(path.join(root, 'receipt.json'), 'utf8'))
  assert.equal(hash(await fs.readFile(database)), before, 'Read-only harness source changed')
  assert.deepEqual(await fs.readdir(path.join(root, 'hermes')), ['state.db'])
}, { timeout: 100000 })
after(async () => { if (root) await fs.rm(root, { recursive: true, force: true }) })
for (const name of ['asset-and-private-state', 'sandbox-and-network', 'foreign-actual-frame', 'navigation-revokes-document', 'sibling-and-stale-actual-frame']) {
  test(`native Electron ${name}`, () => {
    assert.equal(typeof view?.registerColonyView, 'function', 'Required actual Colony native view/receiver is missing')
    assert.equal(receipt?.results?.[name]?.pass, true, JSON.stringify(receipt?.results))
  })
}

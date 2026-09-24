import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

// S1 public module contract:
//   extractOpenCodeStaticApiKeys({ osHome }) -> ephemeral approved env-name/key map
//   inspectHermesAccounts({ osHome, hermesHome, grantsPath }) -> names/state-only DTO
// The extractor is main-process internal. Neither result may include OAuth material;
// the inspector must never return any credential value or value-derived identifier.
const moduleUrl = new URL('../src/hermes-accounts.mjs', import.meta.url)
const load = () => import(moduleUrl.href)
const SECRET = 'synthetic-api-value-NOT-FOR-DTO-1569'
const OAUTH = 'synthetic-oauth-refresh-NOT-FOR-DTO-1569'
const FINGERPRINT = createHash('sha256').update(SECRET).digest('hex')

function fixture(t) {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'rhythm-hermes-accounts-'))
  const osHome = path.join(root, 'os-home')
  const hermesHome = path.join(root, 'hermes-home')
  const grantsPath = path.join(root, 'grants', 'hermes-grants.json')
  fs.mkdirSync(path.join(osHome, '.local', 'share', 'opencode'), { recursive: true, mode: 0o700 })
  fs.mkdirSync(hermesHome, { recursive: true, mode: 0o700 })
  fs.mkdirSync(path.dirname(grantsPath), { recursive: true, mode: 0o700 })
  const authPath = path.join(osHome, '.local', 'share', 'opencode', 'auth.json')
  const hermesAuthPath = path.join(hermesHome, 'auth.json')
  const write = (target, body) => fs.writeFileSync(target, typeof body === 'string' ? body : JSON.stringify(body), { mode: 0o600 })
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return { root, osHome, hermesHome, grantsPath, authPath, hermesAuthPath, write,
    args: { osHome, hermesHome, grantsPath } }
}

function noSecrets(value) {
  const json = JSON.stringify(value)
  for (const sentinel of [SECRET, OAUTH, FINGERPRINT]) assert.equal(json.includes(sentinel), false, 'secret or fingerprint escaped')
}

test('issue-1569-s1-c1: only approved static OpenCode API providers map to four env names', async (t) => {
  // Regression caught: OAuth/Zen or an arbitrary provider is injected as an API key.
  const f = fixture(t)
  f.write(f.authPath, {
    openrouter: { type: 'api', key: 'OR-' + SECRET }, anthropic: { type: 'api', key: 'AN-' + SECRET },
    openai: { type: 'api', key: 'OA-' + SECRET }, google: { type: 'api', key: 'GO-' + SECRET },
    opencode: { type: 'api', key: 'ZEN-' + SECRET }, other: { type: 'api', key: 'OTHER-' + SECRET },
  })
  const { extractOpenCodeStaticApiKeys } = await load()
  assert.deepEqual(await extractOpenCodeStaticApiKeys({ osHome: f.osHome }), {
    OPENROUTER_API_KEY: 'OR-' + SECRET, ANTHROPIC_API_KEY: 'AN-' + SECRET,
    OPENAI_API_KEY: 'OA-' + SECRET, GOOGLE_API_KEY: 'GO-' + SECRET,
  })
})

test('issue-1569-s1-c2: mixed OAuth material never enters extraction, status, or diagnostics', async (t) => {
  // Regression caught: a mixed auth.json leaks refresh values or their fingerprint.
  const f = fixture(t)
  f.write(f.authPath, {
    openrouter: { type: 'api', key: SECRET },
    anthropic: { type: 'oauth', access: OAUTH, refresh: OAUTH },
    openai: { type: 'oauth', access: OAUTH, refresh: OAUTH },
  })
  const { extractOpenCodeStaticApiKeys, inspectHermesAccounts } = await load()
  const diagnostics = []
  const oldError = console.error
  console.error = (...args) => diagnostics.push(args)
  try {
    const keys = await extractOpenCodeStaticApiKeys({ osHome: f.osHome })
    assert.deepEqual(keys, { OPENROUTER_API_KEY: SECRET })
    const status = await inspectHermesAccounts(f.args)
    noSecrets(status)
    noSecrets(diagnostics)
  } finally { console.error = oldError }
})

test('issue-1569-s1-c3: symlink and oversized credential/grant files fail closed', async (t) => {
  // Regression caught: path-following or unbounded reads turn a status probe into secret access.
  const f = fixture(t)
  const outside = path.join(f.root, 'outside.json')
  f.write(outside, { openrouter: { type: 'api', key: SECRET } })
  fs.symlinkSync(outside, f.authPath)
  f.write(f.grantsPath, { schemaVersion: 1, grants: [] })
  const { extractOpenCodeStaticApiKeys, inspectHermesAccounts } = await load()
  assert.deepEqual(await extractOpenCodeStaticApiKeys({ osHome: f.osHome }), {})
  let status = await inspectHermesAccounts(f.args)
  assert.equal(status.sources.opencode.state, 'unreadable')
  noSecrets(status)
  fs.unlinkSync(f.authPath)
  f.write(f.authPath, 'x'.repeat(2 * 1024 * 1024))
  status = await inspectHermesAccounts(f.args)
  assert.equal(status.sources.opencode.state, 'unreadable')
  noSecrets(status)
  // The grant path must not follow a symlink either.
  fs.unlinkSync(f.grantsPath)
  fs.symlinkSync(outside, f.grantsPath)
  status = await inspectHermesAccounts(f.args)
  assert.equal(status.sources.grants.state, 'unreadable')
})

test('issue-1569-s1-c3: symlinked parent and descriptor replacement are refused', async (t) => {
  // Regression caught: lstat-before-open alone accepts a swapped inode or parent redirect.
  const f = fixture(t)
  const { extractOpenCodeStaticApiKeys, inspectHermesAccounts } = await load()
  const opencodeDir = path.dirname(f.authPath)
  fs.rmSync(opencodeDir, { recursive: true })
  const externalDir = path.join(f.root, 'external-opencode')
  fs.mkdirSync(externalDir, { mode: 0o700 })
  f.write(path.join(externalDir, 'auth.json'), { openrouter: { type: 'api', key: SECRET } })
  fs.symlinkSync(externalDir, opencodeDir)
  assert.deepEqual(await extractOpenCodeStaticApiKeys({ osHome: f.osHome }), {})
  assert.equal((await inspectHermesAccounts(f.args)).sources.opencode.state, 'unreadable')
  fs.unlinkSync(opencodeDir)
  fs.mkdirSync(opencodeDir, { mode: 0o700 })
  f.write(f.authPath, { openrouter: { type: 'api', key: SECRET } })
  const replacement = path.join(opencodeDir, 'replacement.json')
  f.write(replacement, { openrouter: { type: 'api', key: 'REPLACEMENT-' + SECRET } })
  const canonicalAuth = fs.realpathSync(f.authPath)
  const originalOpen = fs.openSync
  fs.openSync = function (target, flags, ...args) {
    const fd = originalOpen.call(this, target, flags, ...args)
    if (String(target) === canonicalAuth) {
      f.write(replacement, { openrouter: { type: 'api', key: 'REPLACEMENT-' + SECRET } })
      fs.renameSync(replacement, f.authPath)
    }
    return fd
  }
  syncBuiltinESMExports()
  try {
    assert.deepEqual(await extractOpenCodeStaticApiKeys({ osHome: f.osHome }), {})
    assert.equal((await inspectHermesAccounts(f.args)).sources.opencode.state, 'unreadable')
  } finally { fs.openSync = originalOpen; syncBuiltinESMExports() }
})

test('issue-1569-s1-c3: descriptor owner mismatch is unreadable', async (t) => {
  // Regression caught: an otherwise regular file with a foreign owner is accepted.
  const f = fixture(t)
  f.write(f.authPath, { openrouter: { type: 'api', key: SECRET } })
  const { extractOpenCodeStaticApiKeys, inspectHermesAccounts } = await load()
  const originalFstat = fs.fstatSync
  fs.fstatSync = function (fd, ...args) {
    const stat = originalFstat.call(this, fd, ...args)
    return Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, { uid: process.getuid() + 1 })
  }
  syncBuiltinESMExports()
  try {
    assert.deepEqual(await extractOpenCodeStaticApiKeys({ osHome: f.osHome }), {})
    assert.equal((await inspectHermesAccounts(f.args)).sources.opencode.state, 'unreadable')
  } finally { fs.fstatSync = originalFstat; syncBuiltinESMExports() }
})

test('issue-1569-s1-c3: parent replaced by a symlink at open is unreadable', async (t) => {
  const f = fixture(t)
  f.write(f.authPath, { openrouter: { type: 'api', key: SECRET } })
  const parent = path.dirname(f.authPath)
  const moved = path.join(f.root, 'moved-opencode')
  const canonicalAuth = fs.realpathSync(f.authPath)
  const originalOpen = fs.openSync
  let swapped = false
  fs.openSync = function (target, flags, ...args) {
    if (String(target) === canonicalAuth && !swapped) {
      swapped = true
      fs.renameSync(parent, moved)
      fs.symlinkSync(moved, parent)
    }
    return originalOpen.call(this, target, flags, ...args)
  }
  syncBuiltinESMExports()
  try {
    const { extractOpenCodeStaticApiKeys } = await load()
    assert.deepEqual(extractOpenCodeStaticApiKeys({ osHome: f.osHome }), {})
    assert.equal(swapped, true)
  } finally { fs.openSync = originalOpen; syncBuiltinESMExports() }
})

test('issue-1569-s1-c3: growth after fstat cannot trigger an unbounded read', async (t) => {
  const f = fixture(t)
  f.write(f.authPath, { openrouter: { type: 'api', key: SECRET } })
  const originalRead = fs.readSync
  const originalReadFile = fs.readFileSync
  let grew = false
  const lengths = []
  fs.readFileSync = function (target, ...args) {
    if (typeof target === 'number') throw new Error('unbounded descriptor read')
    return originalReadFile.call(this, target, ...args)
  }
  fs.readSync = function (fd, buffer, offset, length, position) {
    lengths.push(length)
    if (!grew) {
      grew = true
      fs.appendFileSync(f.authPath, 'x'.repeat(2 * 1024 * 1024))
    }
    return originalRead.call(this, fd, buffer, offset, length, position)
  }
  syncBuiltinESMExports()
  try {
    const { extractOpenCodeStaticApiKeys } = await load()
    assert.deepEqual(extractOpenCodeStaticApiKeys({ osHome: f.osHome }), {})
    assert.equal(grew, true)
    assert.ok(lengths.every((length) => length <= 1024 * 1024 + 1))
  } finally { fs.readSync = originalRead; fs.readFileSync = originalReadFile; syncBuiltinESMExports() }
})

test('issue-1569-s1-c4: readiness states distinguish observation from application', async (t) => {
  // Regression caught: file presence is mislabeled as applied to a running child.
  const f = fixture(t)
  const { inspectHermesAccounts } = await load()
  const absent = await inspectHermesAccounts(f.args)
  assert.equal(absent.sources.opencode.state, 'absent')
  assert.equal(absent.sources.hermesAuth.state, 'absent')
  f.write(f.authPath, { openrouter: { type: 'api', key: SECRET } })
  f.write(path.join(f.hermesHome, '.env'), `OPENROUTER_API_KEY=hermes-owned-${SECRET}\n`)
  const status = await inspectHermesAccounts(f.args)
  assert.equal(status.sources.opencode.state, 'present')
  assert.equal(status.providers.openrouter.state, 'shadowed')
  assert.notEqual(status.providers.openrouter.state, 'applied')
  assert.equal(status.claudeCode.refreshGuarantee, 'not-race-free')
  noSecrets(status)
  f.write(path.join(f.hermesHome, '.env'), 'OPENROUTER_API_KEY=\n')
  fs.unlinkSync(f.authPath)
  assert.equal((await inspectHermesAccounts(f.args)).providers.openrouter.state, 'absent')
  for (const value of ["''", '""']) {
    f.write(path.join(f.hermesHome, '.env'), `OPENROUTER_API_KEY=${value}\n`)
    assert.equal((await inspectHermesAccounts(f.args)).providers.openrouter.state, 'absent')
  }
  f.write(f.hermesAuthPath, '{ broken json')
  assert.equal((await inspectHermesAccounts(f.args)).sources.hermesAuth.state, 'malformed')
})

test('issue-1569-s1-c5: unknown Hermes auth version stays unknown without provider enumeration', async (t) => {
  // Regression caught: a changed schema is parsed as known and leaks names/secrets.
  const f = fixture(t)
  f.write(f.hermesAuthPath, { version: 999, providers: { 'unknown-secret-provider': { key: SECRET, refresh: OAUTH } } })
  const { inspectHermesAccounts } = await load()
  const status = await inspectHermesAccounts(f.args)
  assert.equal(status.sources.hermesAuth.state, 'unknown')
  assert.equal(JSON.stringify(status).includes('unknown-secret-provider'), false)
  noSecrets(status)
})

test('issue-1569-s1-c6: names-only inspection never opens Hermes SQLite', async (t) => {
  // Regression caught: readiness takes a shortcut through Hermes operational DB.
  const f = fixture(t)
  f.write(f.hermesAuthPath, { version: 1, providers: { nous: {} } })
  const db = path.join(f.hermesHome, 'hermes.db')
  f.write(db, 'SYNTHETIC-SQLITE-BYTES')
  const before = createHash('sha256').update(fs.readFileSync(db)).digest('hex')
  const forbidden = []
  const originalOpen = fs.openSync, originalRead = fs.readFileSync
  const originalAsyncOpen = fs.promises.open, originalAsyncRead = fs.promises.readFile
  fs.openSync = function (target, ...rest) { if (String(target).includes('.db')) forbidden.push(String(target)); return originalOpen.call(this, target, ...rest) }
  fs.readFileSync = function (target, ...rest) { if (String(target).includes('.db')) forbidden.push(String(target)); return originalRead.call(this, target, ...rest) }
  fs.promises.open = async function (target, ...rest) { if (String(target).includes('.db')) forbidden.push(String(target)); return originalAsyncOpen.call(this, target, ...rest) }
  fs.promises.readFile = async function (target, ...rest) { if (String(target).includes('.db')) forbidden.push(String(target)); return originalAsyncRead.call(this, target, ...rest) }
  syncBuiltinESMExports()
  try {
    const { inspectHermesAccounts } = await load()
    noSecrets(await inspectHermesAccounts(f.args))
  } finally { fs.openSync = originalOpen; fs.readFileSync = originalRead; fs.promises.open = originalAsyncOpen; fs.promises.readFile = originalAsyncRead; syncBuiltinESMExports() }
  assert.deepEqual(forbidden, [])
  assert.equal(createHash('sha256').update(fs.readFileSync(db)).digest('hex'), before)
})

test('issue-1569-s1-c7: Claude status names the confirmed shared Keychain service', async (t) => {
  // Regression caught: status implies a refresh guarantee or names a different service.
  const f = fixture(t)
  const { inspectHermesAccounts } = await load()
  const status = await inspectHermesAccounts(f.args)
  assert.equal(status.claudeCode.keychainService, 'Claude Code-credentials')
  assert.equal(status.claudeCode.refreshGuarantee, 'not-race-free')
})

test('issue-1569-s1-c8: inspection performs no write-capable open or transient mutation of Hermes stores', async (t) => {
  // Regression caught: read-time normalization writes then restores identical bytes.
  const f = fixture(t)
  const stores = ['.env', 'auth.json', 'config.yaml']
  for (const name of stores) f.write(path.join(f.hermesHome, name), `synthetic-${name}\n`)
  const tokenDir = path.join(f.hermesHome, 'mcp-tokens')
  fs.mkdirSync(tokenDir, { mode: 0o700 })
  f.write(path.join(tokenDir, 'synthetic-token.json'), SECRET)
  f.write(f.authPath, { openrouter: { type: 'api', key: SECRET } })
  const protectedPaths = new Set([...stores.map((name) => path.join(f.hermesHome, name)), tokenDir, path.join(tokenDir, 'synthetic-token.json')])
  const before = new Map([...protectedPaths].filter((target) => fs.lstatSync(target).isFile()).map((target) => [target, createHash('sha256').update(fs.readFileSync(target)).digest('hex')]))
  const beforeInodes = new Map([...protectedPaths].map((target) => [target, fs.lstatSync(target).ino]))
  const violations = []
  const original = { openSync: fs.openSync, open: fs.open, writeFileSync: fs.writeFileSync, appendFileSync: fs.appendFileSync, truncateSync: fs.truncateSync, renameSync: fs.renameSync, unlinkSync: fs.unlinkSync }
  const originalPromises = Object.fromEntries(['open', 'writeFile', 'appendFile', 'truncate', 'rename', 'unlink', 'rm', 'copyFile'].map((name) => [name, fs.promises[name]]))
  const check = (op, target, flags) => {
    if (!protectedPaths.has(String(target)) && !String(target).startsWith(tokenDir + path.sep)) return
    const writeFlag = typeof flags === 'number' ? !!(flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND)) : /[wax+]/.test(String(flags))
    if (op !== 'open' || writeFlag) violations.push(`${op}:${path.basename(String(target))}`)
  }
  fs.openSync = function (target, flags, ...args) { check('open', target, flags); return original.openSync.call(this, target, flags, ...args) }
  fs.open = function (target, flags, ...args) { check('open', target, flags); return original.open.call(this, target, flags, ...args) }
  fs.promises.open = async function (target, flags, ...args) { check('open', target, flags); return originalPromises.open.call(this, target, flags, ...args) }
  for (const op of ['writeFileSync', 'appendFileSync', 'truncateSync', 'unlinkSync']) fs[op] = function (target, ...args) { check(op, target); return original[op].call(this, target, ...args) }
  for (const op of ['writeFile', 'appendFile', 'truncate', 'unlink', 'rm']) fs.promises[op] = async function (target, ...args) { check(op, target); return originalPromises[op].call(this, target, ...args) }
  fs.renameSync = function (from, to, ...args) { check('rename', from); check('rename', to); return original.renameSync.call(this, from, to, ...args) }
  fs.promises.rename = async function (from, to, ...args) { check('rename', from); check('rename', to); return originalPromises.rename.call(this, from, to, ...args) }
  fs.promises.copyFile = async function (from, to, ...args) { check('copyFile', to); return originalPromises.copyFile.call(this, from, to, ...args) }
  syncBuiltinESMExports()
  try {
    const { inspectHermesAccounts } = await load()
    noSecrets(await inspectHermesAccounts(f.args))
  } finally { Object.assign(fs, original); Object.assign(fs.promises, originalPromises); syncBuiltinESMExports() }
  assert.deepEqual(violations, [])
  for (const [target, digest] of before) assert.equal(createHash('sha256').update(fs.readFileSync(target)).digest('hex'), digest)
  for (const [target, inode] of beforeInodes) assert.equal(fs.lstatSync(target).ino, inode, `inspection replaced ${target}`)
})

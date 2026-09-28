import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { extractOpenCodeStaticApiKeys } from '../src/hermes-accounts.mjs'
const brokerApiPromise = import('../src/hermes-credential-broker.mjs').catch(() => null)
const brokerApiReady = async () => {
  const api = await brokerApiPromise
  assert.ok(api, 'RED: S2 broker module is not implemented yet')
  return api
}

// Proposed public API contract for S2:
// createHermesCredentialBroker({ grantsPath, osHome, hermesHome, getContext,
//   confirmMutation, disposeOwnedBackend }) -> { setGrant, resolveBackendEnv,
//   recordSpawnResult, getStatus, identityChanged }
// resolveBackendEnv accepts the frozen S3 callback tuple exactly:
// { serverOrigin, rhythmUserId, profile: 'default', hermesHome, source,
//   authGeneration }. IPC sender validation belongs at the host-adapter seam;
// these adapter tests are not evidence that Electron main/frame/dialog wiring exists.
const createBroker = async (...args) => {
  const api = await brokerApiReady()
  assert.equal(typeof api.createHermesCredentialBroker, 'function', 'RED: broker factory is missing')
  return api.createHermesCredentialBroker(...args)
}
const SECRET = 'synthetic-grant-value-1569-never-log'
const FINGERPRINT = createHash('sha256').update(SECRET).digest('hex')
const SOURCE = 'opencode-auth-json'

async function setup(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rhythm-credential-broker-'))
  const userHome = path.join(root, 'user-home')
  const hermesHome = path.join(root, 'hermes-home')
  const grantsDir = path.join(root, 'user-data')
  fs.mkdirSync(path.join(userHome, '.local/share/opencode'), { recursive: true, mode: 0o700 })
  fs.mkdirSync(hermesHome, { recursive: true, mode: 0o700 })
  fs.mkdirSync(grantsDir, { recursive: true, mode: 0o700 })
  const authPath = path.join(userHome, '.local/share/opencode/auth.json')
  fs.writeFileSync(authPath, JSON.stringify({ openrouter: { type: 'api', key: SECRET } }), { mode: 0o600 })
  const context = (changes = {}) => ({
    serverOrigin: 'https://rhythm.test', rhythmUserId: 'user-a', profile: 'default',
    hermesHome: fs.realpathSync(hermesHome), source: SOURCE,
    authGeneration: 'auth-generation-a', ...changes,
  })
  const confirmations = []
  const disposals = []
  let current = context()
  const broker = await createBroker({
    grantsPath: path.join(grantsDir, 'hermes-grants.json'), osHome: userHome,
    hermesHome, getContext: () => current,
    confirmMutation: async (mutation) => { confirmations.push(mutation); return true },
    disposeOwnedBackend: async (reason) => { disposals.push(reason) }, ...overrides,
  })
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return { root, userHome, hermesHome, grantsDir, broker, context, confirmations, disposals,
    get current() { return current }, set current(value) { current = value } }
}

function assertNoSecret(value) {
  const serialized = JSON.stringify(value)
  assert.equal(serialized.includes(SECRET), false, 'credential value escaped into persisted or returned data')
  assert.equal(serialized.includes(FINGERPRINT), false, 'credential fingerprint escaped into persisted or returned data')
}

const grant = (broker, changes = {}) => broker.setGrant({ source: SOURCE, provider: 'openrouter', enabled: true, ...changes })

test('revoking one of several grants reports a pending restart for the running child', async (t) => {
  const f = await setup(t)
  await grant(f.broker)
  await grant(f.broker, { provider: 'anthropic' })
  await f.broker.resolveBackendEnv(f.context())
  await f.broker.recordSpawnResult(f.context(), { owned: true, success: true })
  await grant(f.broker, { enabled: false })
  const status = await f.broker.getStatus(f.context())
  assert.equal(status.lifecycle, 'pending-next-start')
  assert.equal(status.childMayRetainCredential, true)
})

test('grant mutation uses only the exact provider and action confirmed by the native dialog', async (t) => {
  const f = await setup(t)
  const requested = { source: SOURCE, provider: 'openrouter', enabled: true }
  const confirmations = []
  const broker = await createBroker({
    grantsPath: path.join(f.grantsDir, 'hermes-grants.json'), osHome: f.userHome,
    hermesHome: f.hermesHome, getContext: () => f.context(),
    confirmMutation: async (exact) => {
      confirmations.push(exact)
      requested.provider = 'anthropic'
      return true
    },
    disposeOwnedBackend: async () => {},
  })
  await broker.setGrant(requested).catch(() => {})
  assert.equal(confirmations[0].provider, 'openrouter')
  const storePath = path.join(f.grantsDir, 'hermes-grants.json')
  const saved = fs.existsSync(storePath) ? JSON.parse(fs.readFileSync(storePath, 'utf8')).grants : []
  assert.equal(saved.some((entry) => entry.provider === 'anthropic'), false)
})

test('short writes finish the grant file and a stalled write preserves the prior store', async (t) => {
  const f = await setup(t)
  const storePath = path.join(f.grantsDir, 'hermes-grants.json')
  const original = fs.writeSync
  let partialWrites = 0
  fs.writeSync = function (fd, buffer, offset, length, position) {
    const count = Math.max(1, Math.floor(length / 2))
    partialWrites++
    return original.call(this, fd, buffer, offset, count, position)
  }
  try { await grant(f.broker) } finally { fs.writeSync = original }
  assert.ok(partialWrites > 1, 'the injected short write must be exercised')
  const before = fs.readFileSync(storePath)
  assert.equal(JSON.parse(before.toString()).grants.length, 1)
  fs.writeSync = () => 0
  try {
    await assert.rejects(grant(f.broker, { provider: 'anthropic' }), /Grant store unavailable/)
  } finally { fs.writeSync = original }
  assert.deepEqual(fs.readFileSync(storePath), before)
  assert.deepEqual(fs.readdirSync(f.grantsDir), ['hermes-grants.json'])
})

test('a failed owned spawn does not claim application and a later successful retry can apply the grant', async (t) => {
  const f = await setup(t)
  await grant(f.broker)
  assert.deepEqual(await f.broker.resolveBackendEnv(f.context()), { OPENROUTER_API_KEY: SECRET })
  assert.equal(await f.broker.recordSpawnResult(f.context(), { owned: true, success: false }), false)
  assert.equal((await f.broker.getStatus(f.context())).lifecycle, 'configured')
  assert.equal(await f.broker.recordSpawnResult(f.context(), { owned: true, success: true }), false)
  assert.deepEqual(await f.broker.resolveBackendEnv(f.context()), { OPENROUTER_API_KEY: SECRET })
  assert.equal(await f.broker.recordSpawnResult(f.context(), { owned: true, success: true }), true)
  assert.equal((await f.broker.getStatus(f.context())).lifecycle, 'applied')
})

test('issue-1569-s2-c1: grant references match the full identity and resolve only the four S1 static keys', async (t) => {
  // Regression caught: a grant is reused after server, user, home, profile, or auth-generation changes.
  const f = await setup(t)
  await grant(f.broker)
  const env = await f.broker.resolveBackendEnv(f.context())
  assert.deepEqual(env, { OPENROUTER_API_KEY: SECRET })
  for (const changed of [
    { serverOrigin: 'https://other.test' }, { rhythmUserId: 'user-b' },
    { profile: 'work' }, { hermesHome: path.join(f.root, 'other-home') },
    { source: 'memory-search' }, { authGeneration: 'auth-generation-b' },
  ]) assert.deepEqual(await f.broker.resolveBackendEnv(f.context(changed)), {})
  fs.writeFileSync(path.join(f.userHome, '.local/share/opencode/auth.json'), JSON.stringify({
    openrouter: { type: 'api', key: SECRET }, anthropic: { type: 'oauth', refresh: 'oauth-sentinel' },
    opencode: { type: 'api', key: 'zen-sentinel' },
  }))
  const eligible = await extractOpenCodeStaticApiKeys({ osHome: f.userHome })
  assert.deepEqual(Object.keys(eligible), ['OPENROUTER_API_KEY'])
  assertNoSecret(await f.broker.getStatus(f.context()))
})

test('issue-1569-s2-c2: identity change disposes the owned child before another identity can receive a grant', async (t) => {
  // Regression caught: newly authenticated identity starts while the prior owned process still holds its key.
  const f = await setup(t)
  await grant(f.broker)
  assert.equal(await f.broker.recordSpawnResult(f.context(), { owned: true, success: true }), false,
    'a spawn without a successful grant resolution must not claim application')
  assert.deepEqual(await f.broker.resolveBackendEnv(f.context()), { OPENROUTER_API_KEY: SECRET })
  await f.broker.recordSpawnResult(f.context(), { owned: true, success: true })
  f.current = f.context({ rhythmUserId: 'user-b', authGeneration: 'auth-generation-b' })
  await f.broker.identityChanged(f.current)
  assert.deepEqual(f.disposals, [{ reason: 'identity-changed' }])
  assert.deepEqual(await f.broker.resolveBackendEnv(f.current), {})
  assert.deepEqual(await f.broker.resolveBackendEnv(f.context()), {})
  assert.deepEqual(await f.broker.resolveBackendEnv(f.context({ profile: 'work' })), {})
})

test('issue-1569-s2-c3: grant mutation and key rotation report pending-next-start and do not overclaim erasure', async (t) => {
  // Regression caught: revocation claims to erase a key already copied into a live child.
  const f = await setup(t)
  await grant(f.broker)
  assert.notEqual((await f.broker.getStatus(f.context())).lifecycle, 'applied', 'callback readiness alone must not claim child application')
  assert.equal(await f.broker.recordSpawnResult(f.context(), { owned: true, success: true }), false)
  assert.deepEqual(await f.broker.resolveBackendEnv(f.context()), { OPENROUTER_API_KEY: SECRET })
  await f.broker.recordSpawnResult(f.context(), { owned: true, success: true })
  const status = await f.broker.getStatus(f.context())
  assert.equal(status.lifecycle, 'applied')
  await grant(f.broker, { enabled: false })
  const revoked = await f.broker.getStatus(f.context())
  assert.equal(revoked.lifecycle, 'pending-next-start')
  assert.equal(revoked.childMayRetainCredential, true)
  assert.deepEqual(await f.broker.resolveBackendEnv(f.context()), {})
  assertNoSecret(revoked)
})

test('issue-1569-s2-c4: host-adapter rejects unsafe senders and requires native confirmation for the exact mutation', async (t) => {
  // Regression caught: renderer-supplied identity/path/value or a confirmation for a different mutation is accepted.
  const f = await setup(t)
  const brokerApi = await brokerApiReady()
  assert.equal(typeof brokerApi.validateGrantMutationRequest, 'function', 'host-adapter validator must be exposed for seam tests')
  const validate = brokerApi.validateGrantMutationRequest
  const exactMutation = { action: 'enable', source: SOURCE, provider: 'openrouter' }
  const goodSender = {
    authenticated: true, ownsDocument: true, isMainFrame: true,
    senderUrl: 'https://rhythm.test/accounts', trustedOrigin: 'https://rhythm.test',
  }
  const accepted = await validate({ sender: goodSender, payload: exactMutation, context: f.context(),
    confirmNative: async (requested) => JSON.stringify(requested) === JSON.stringify(exactMutation) })
  assert.equal(accepted.accepted, true)
  assert.deepEqual(accepted.mutation, exactMutation, 'caller receives only the exact confirmed mutation')
  for (const sender of [
    { ...goodSender, ownsDocument: false }, { ...goodSender, isMainFrame: false },
    { ...goodSender, authenticated: false }, { ...goodSender, senderUrl: 'https://evil.test/' },
    { ...goodSender, trustedOrigin: 'https://evil.test' },
  ]) assert.equal((await validate({ sender, payload: exactMutation, context: f.context(), confirmNative: async () => true })).accepted, false)
  for (const payload of [
    { ...exactMutation, identity: 'renderer-user' }, { ...exactMutation, path: '/renderer/path' },
    { ...exactMutation, value: SECRET }, { ...exactMutation, extra: true },
  ]) assert.equal((await validate({ sender: goodSender, payload, context: f.context(), confirmNative: async () => true })).accepted, false)
  assert.equal((await validate({ sender: goodSender, payload: exactMutation, context: f.context(),
    confirmNative: async () => false })).accepted, false)
})

test('issue-1569-s2-c5: grants persist reference-only atomically and corrupt or unsafe stores fail closed unchanged', async (t) => {
  // Regression caught: partial/unsafe grant data is applied or a failed read silently normalizes the file.
  const f = await setup(t)
  const grantsPath = path.join(f.grantsDir, 'hermes-grants.json')
  const capturedLogs = []
  const outbound = []
  const originals = Object.fromEntries(['debug', 'info', 'log', 'warn', 'error'].map((name) => [name, console[name]]))
  for (const name of Object.keys(originals)) console[name] = (...args) => capturedLogs.push(args)
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (...args) => { outbound.push(args); throw new Error('unexpected outbound request') }
  try { await grant(f.broker) } finally {
    for (const [name, original] of Object.entries(originals)) console[name] = original
    globalThis.fetch = originalFetch
  }
  assertNoSecret(capturedLogs)
  assert.equal(outbound.length, 0, 'grant operations must not transmit credentials or fingerprints')
  const stored = fs.readFileSync(grantsPath, 'utf8')
  assertNoSecret(stored)
  assert.equal((fs.statSync(grantsPath).mode & 0o777), 0o600)
  assert.equal((fs.statSync(f.grantsDir).mode & 0o777), 0o700)
  assert.equal(JSON.parse(stored).grants.length, 1)
  assert.deepEqual(fs.readdirSync(f.grantsDir), ['hermes-grants.json'], 'atomic write leaves no partial or temporary grant file')
  fs.writeFileSync(grantsPath, '{broken-json', { mode: 0o600 })
  const before = fs.readFileSync(grantsPath)
  assert.deepEqual(await f.broker.resolveBackendEnv(f.context()), {})
  assert.equal((await f.broker.getStatus(f.context())).grants.state, 'malformed')
  assert.deepEqual(fs.readFileSync(grantsPath), before)
  fs.unlinkSync(grantsPath)
  const outside = path.join(f.root, 'outside.json')
  fs.writeFileSync(outside, stored, { mode: 0o600 })
  fs.symlinkSync(outside, grantsPath)
  assert.deepEqual(await f.broker.resolveBackendEnv(f.context()), {})
  assert.equal(fs.lstatSync(grantsPath).isSymbolicLink(), true)
  assertNoSecret(await f.broker.getStatus(f.context()))
})

test('native confirmation is asynchronous and a denied grant leaves the store unchanged', async (t) => {
  let release
  const pendingConfirmation = new Promise((resolve) => { release = resolve })
  const f = await setup(t, { confirmMutation: async () => pendingConfirmation })
  const mutation = grant(f.broker)
  await Promise.resolve()
  release(false)
  await assert.rejects(mutation, /confirmation denied/)
  assert.deepEqual(fs.readdirSync(f.grantsDir), [])
  assert.deepEqual(await f.broker.resolveBackendEnv(f.context()), {})
})

test('identity change fails closed while owned-child disposal is pending or fails', async (t) => {
  let release
  let rejectDispose = false
  const pendingDisposal = new Promise((resolve) => { release = resolve })
  const f = await setup(t, { disposeOwnedBackend: async () => {
    await pendingDisposal
    if (rejectDispose) throw new Error('synthetic disposal failure')
  } })
  await grant(f.broker)
  await f.broker.resolveBackendEnv(f.context())
  assert.equal(await f.broker.recordSpawnResult(f.context(), { owned: true, success: true }), true)
  f.current = f.context({ rhythmUserId: 'user-b', authGeneration: 'auth-generation-b' })
  const changing = f.broker.identityChanged(f.current)
  const attempted = f.broker.resolveBackendEnv(f.current)
  rejectDispose = true
  release()
  await assert.rejects(changing, /synthetic disposal failure/)
  assert.deepEqual(await attempted, {})
  assert.deepEqual(await f.broker.resolveBackendEnv(f.context()), {})
})

test('identity change disposes a child whose credential resolution preceded spawn completion', async (t) => {
  const f = await setup(t)
  await grant(f.broker)
  assert.deepEqual(await f.broker.resolveBackendEnv(f.context()), { OPENROUTER_API_KEY: SECRET })
  f.current = f.context({ rhythmUserId: 'user-b' })
  await f.broker.identityChanged(f.current)
  assert.deepEqual(f.disposals, [{ reason: 'identity-changed' }])
  assert.equal(await f.broker.recordSpawnResult(f.context(), { owned: true, success: true }), false)
})

test('a grant revoked during spawn still reports possible retention after spawn completes', async (t) => {
  const f = await setup(t)
  await grant(f.broker)
  await f.broker.resolveBackendEnv(f.context())
  await grant(f.broker, { enabled: false })
  assert.equal(await f.broker.recordSpawnResult(f.context(), { owned: true, success: true }), true)
  const status = await f.broker.getStatus(f.context())
  assert.equal(status.lifecycle, 'pending-next-start')
  assert.equal(status.childMayRetainCredential, true)
})

test('a Hermes-owned provider key shadows a Rhythm grant at resolution', async (t) => {
  const f = await setup(t)
  await grant(f.broker)
  fs.writeFileSync(path.join(f.hermesHome, '.env'), 'OPENROUTER_API_KEY=hermes-owned-synthetic\n', { mode: 0o600 })
  assert.deepEqual(await f.broker.resolveBackendEnv(f.context()), {})
  assert.equal(await f.broker.recordSpawnResult(f.context(), { owned: true, success: true }), false)
})

test('unsafe grant directory and a store growing during descriptor read fail closed', async (t) => {
  const f = await setup(t)
  await grant(f.broker)
  const realDirectory = f.grantsDir
  const alias = path.join(f.root, 'aliased-user-data')
  fs.symlinkSync(realDirectory, alias)
  await assert.rejects(async () => createBroker({
    grantsPath: path.join(alias, 'hermes-grants.json'), osHome: f.userHome, hermesHome: f.hermesHome,
    getContext: f.context, confirmMutation: async () => true, disposeOwnedBackend: async () => {},
  }), /Invalid grant directory/)
  const file = path.join(realDirectory, 'hermes-grants.json')
  const original = fs.readSync
  let grew = false
  let maxRead = 0
  fs.readSync = function (fd, buffer, offset, length, position) {
    if (fs.fstatSync(fd).ino === fs.statSync(file).ino && !grew) {
      grew = true
      fs.appendFileSync(file, ' '.repeat(1024 * 1024 + 1))
    }
    maxRead = Math.max(maxRead, length)
    return original.call(this, fd, buffer, offset, length, position)
  }
  try { assert.deepEqual(await f.broker.resolveBackendEnv(f.context()), {}) } finally { fs.readSync = original }
  assert.equal(grew, true)
  assert.ok(maxRead <= 1024 * 1024 + 1)
  assertNoSecret(await f.broker.getStatus(f.context()))
})

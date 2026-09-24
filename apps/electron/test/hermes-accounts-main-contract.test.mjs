import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { validateGrantMutationRequest } from '../src/hermes-credential-broker.mjs'

const SOURCE = 'opencode-auth-json'
const SECRET = 'synthetic-s4-key-do-not-disclose'
const FINGERPRINT = createHash('sha256').update(SECRET).digest('hex')
const mutation = { action: 'enable', provider: 'openai', source: SOURCE }
const modulePromise = import('../src/hermes-accounts-main.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.message.includes('hermes-accounts-main.mjs')) return null
  throw error
})
async function factory() {
  const api = await modulePromise
  assert.equal(typeof api?.createHermesAccountsMain, 'function', 'RED: production Accounts main adapter is missing')
  return api.createHermesAccountsMain
}
function deferred() { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
async function settled(promise) {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Lifecycle deadlocked')), 1000) })]) }
  finally { clearTimeout(timer) }
}
function noSecrets(value) {
  const text = JSON.stringify(value)
  assert.equal(text.includes(SECRET), false)
  assert.equal(text.includes(FINGERPRINT), false)
}
async function fixture(t, options = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rhythm-s4-contract-')))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const osHome = path.join(root, 'os-home'), hermesHome = path.join(root, 'hermes'), grantsDir = path.join(root, 'user-data')
  fs.mkdirSync(path.join(osHome, '.local/share/opencode'), { recursive: true, mode: 0o700 })
  fs.mkdirSync(hermesHome, { mode: 0o700 }); fs.mkdirSync(grantsDir, { mode: 0o700 })
  fs.writeFileSync(path.join(osHome, '.local/share/opencode/auth.json'), JSON.stringify({ openai: { type: 'api', key: SECRET }, anthropic: { type: 'oauth', refresh: 'synthetic-oauth-never-share' } }), { mode: 0o600 })
  const grantsPath = path.join(grantsDir, 'grants.json')
  const contents = {}, frame = {}
  const event = { sender: contents, senderFrame: frame }
  let document = { contents, frame, url: 'rhythm://app/index.html#/agent-settings?section=accounts', epoch: 1 }
  let auth = { authenticated: true, serverOrigin: 'https://rhythm.test', userId: '7', authGeneration: 'auth-a' }
  const confirmations = []
  const context = () => ({ serverOrigin: auth.serverOrigin, rhythmUserId: auth.userId, profile: 'default', hermesHome, source: SOURCE, authGeneration: auth.authGeneration })
  const create = await factory()
  const adapter = create({ osHome, hermesHome, grantsPath,
    getAuthState: () => auth, getDocumentState: () => document,
    confirmNative: async exact => { confirmations.push(exact); return options.confirm ? options.confirm(exact) : true },
    disposeOwnedBackend: async reason => options.dispose?.(reason),
  })
  return { root, hermesHome, grantsPath, adapter, event, context, confirmations,
    get auth() { return auth }, set auth(next) { auth = next },
    get document() { return document }, set document(next) { document = next },
    saved: () => fs.existsSync(grantsPath) ? fs.readFileSync(grantsPath) : null }
}

// Real existing validator: these failures expose the mismatch before any new
// adapter exists. trustedDocumentUrl and revalidate are main-owned arguments.
test('S4-W1a actual Rhythm document is accepted without pretending it is the API origin', async () => {
  const sender = { authenticated: true, ownsDocument: true, isMainFrame: true,
    senderUrl: 'rhythm://app/index.html#/agent-settings', trustedOrigin: 'https://rhythm.test' }
  const context = { serverOrigin: 'https://rhythm.test', rhythmUserId: '7', profile: 'default',
    hermesHome: fs.realpathSync(os.tmpdir()), source: SOURCE, authGeneration: 'a' }
  const result = await validateGrantMutationRequest({ sender, payload: mutation, context,
    trustedDocumentUrl: 'rhythm://app/index.html', revalidate: () => true, confirmNative: async () => true })
  assert.equal(result.accepted, true)
  assert.deepEqual(result.mutation, mutation)
})
test('S4-W2a stale sender copies do not substitute for fresh post-dialog authority', async () => {
  let current = true
  const sender = { authenticated: true, ownsDocument: true, isMainFrame: true,
    senderUrl: 'https://rhythm.test/accounts', trustedOrigin: 'https://rhythm.test' }
  const context = { serverOrigin: 'https://rhythm.test', rhythmUserId: '7', profile: 'default',
    hermesHome: fs.realpathSync(os.tmpdir()), source: SOURCE, authGeneration: 'a' }
  const result = await validateGrantMutationRequest({ sender, payload: mutation, context,
    revalidate: () => current, confirmNative: async () => { current = false; return true } })
  assert.equal(result.accepted, false, 'unchanged detached snapshots must not authorize a stale request')
})

test('S4-W1b main adapter rejects non-owning documents and closed-payload violations', async t => {
  const f = await fixture(t)
  assert.equal((await f.adapter.setGrant(f.event, mutation)).accepted, true)
  assert.equal(f.confirmations.length, 1)
  const before = f.saved()
  for (const event of [{ sender: {}, senderFrame: f.event.senderFrame }, { sender: f.event.sender, senderFrame: {} }]) {
    assert.equal((await f.adapter.setGrant(event, mutation)).accepted, false)
    assert.equal((await f.adapter.getStatus(event)).availability, 'unavailable')
  }
  for (const url of ['data:text/html,test', 'file:///tmp/app.html', 'rhythm://evil/index.html', 'rhythm://app/other.html', 'https://rhythm.test/accounts']) {
    f.document = { ...f.document, url }
    assert.equal((await f.adapter.setGrant(f.event, mutation)).accepted, false)
  }
  f.document = { ...f.document, url: 'rhythm://app/index.html#/agent-settings' }
  for (const payload of [{ ...mutation, path: f.hermesHome }, { ...mutation, userId: '7' }, { ...mutation, value: SECRET }, { ...mutation, source: 'memory-search' }, { ...mutation, provider: 'opencode' }, { ...mutation, provider: 'x'.repeat(10000) }]) {
    assert.equal((await f.adapter.setGrant(f.event, payload)).accepted, false)
  }
  assert.equal((await f.adapter.setGrant(f.event, mutation, 'extra')).accepted, false)
  f.auth = { ...f.auth, authenticated: false }
  assert.equal((await f.adapter.setGrant(f.event, mutation)).accepted, false)
  assert.equal(f.confirmations.length, 1)
  assert.deepEqual(f.saved(), before)
})
test('S4-W2b navigation or auth change during native confirmation leaves consent unchanged', async t => {
  for (const change of ['document', 'logout', 'user', 'server', 'generation']) {
    const entered = deferred(), answer = deferred()
    const f = await fixture(t, { confirm: async () => { entered.resolve(); return answer.promise } })
    const pending = f.adapter.setGrant(f.event, mutation)
    await settled(entered.promise)
    if (change === 'document') f.document = { ...f.document, epoch: 2, frame: {} }
    if (change === 'logout') f.auth = { ...f.auth, authenticated: false }
    if (change === 'user') f.auth = { ...f.auth, userId: '8' }
    if (change === 'server') f.auth = { ...f.auth, serverOrigin: 'https://other.test' }
    if (change === 'generation') f.auth = { ...f.auth, authGeneration: 'b' }
    answer.resolve(true)
    assert.equal((await settled(pending)).accepted, false, change)
    assert.equal(f.saved(), null)
  }
})
test('S4-W4 provider statuses distinguish consent from observed child application without secrets', async t => {
  const f = await fixture(t)
  await f.adapter.setGrant(f.event, mutation)
  const status = await f.adapter.getStatus(f.event)
  assert.equal(status.providers.openai.grantEnabled, true)
  assert.equal(status.providers.google.grantEnabled, false)
  assert.equal(status.providers.openai.applicationState, 'configured')
  assert.equal(status.memory.state, 'disabled')
  noSecrets(status); noSecrets(f.saved().toString())
  fs.writeFileSync(path.join(f.hermesHome, 'auth.json'), '{broken')
  const broken = await f.adapter.getStatus(f.event)
  assert.equal(broken.sources.hermesAuth.state, 'malformed')
  const attempt = f.adapter.createBackendAttempt({ attemptId: 'broken', profile: 'default' })
  assert.deepEqual(await attempt.backendEnv(f.context()), {})
})
test('S4-W6a attempts accept only their own successful names and clear applied state on exit', async t => {
  const f = await fixture(t)
  await f.adapter.setGrant(f.event, mutation)
  const old = f.adapter.createBackendAttempt({ attemptId: 'old', profile: 'default' })
  assert.deepEqual(await old.backendEnv(f.context()), { OPENAI_API_KEY: SECRET })
  assert.equal((await f.adapter.getStatus(f.event)).providers.openai.applicationState, 'configured')
  await old.record({ phase: 'failed', owned: true, acceptedEnvNames: [] })
  const fresh = f.adapter.createBackendAttempt({ attemptId: 'fresh', profile: 'default' })
  await fresh.backendEnv(f.context())
  assert.equal(await old.record({ phase: 'spawned', owned: true, acceptedEnvNames: ['OPENAI_API_KEY'] }), false)
  assert.equal(await fresh.record({ phase: 'spawned', owned: true, acceptedEnvNames: ['OPENAI_API_KEY', 'GOOGLE_API_KEY'] }), false)
  assert.equal(await fresh.record({ phase: 'spawned', owned: true, acceptedEnvNames: ['OPENAI_API_KEY'] }), true)
  assert.equal((await f.adapter.getStatus(f.event)).providers.openai.applicationState, 'applied')
  assert.equal(await fresh.record({ phase: 'spawned', owned: true, acceptedEnvNames: ['OPENAI_API_KEY'] }), false)
  await fresh.record({ phase: 'exited', owned: true, acceptedEnvNames: [] })
  assert.equal((await f.adapter.getStatus(f.event)).providers.openai.applicationState, 'configured')
})
test('S4-W6b expired attempts cannot rearm through late environment resolution', async t => {
  const f = await fixture(t)
  await f.adapter.setGrant(f.event, mutation)
  const attempt = f.adapter.createBackendAttempt({ attemptId: 'timed-out', profile: 'default' })
  await attempt.record({ phase: 'failed', owned: true, acceptedEnvNames: [] })
  assert.deepEqual(await attempt.backendEnv(f.context()), {})
  assert.equal(await attempt.record({ phase: 'spawned', owned: true, acceptedEnvNames: ['OPENAI_API_KEY'] }), false)
  const otherProfile = f.adapter.createBackendAttempt({ attemptId: 'other', profile: 'work' })
  assert.deepEqual(await otherProfile.backendEnv({ ...f.context(), profile: 'work' }), {})
  assert.equal((await f.adapter.getStatus(f.event)).providers.openai.applicationState, 'configured')
})
test('S4-W7a revocation reports retention until the owned child exits', async t => {
  const f = await fixture(t)
  await f.adapter.setGrant(f.event, mutation)
  const attempt = f.adapter.createBackendAttempt({ attemptId: 'running', profile: 'default' })
  await attempt.backendEnv(f.context())
  await attempt.record({ phase: 'spawned', owned: true, acceptedEnvNames: ['OPENAI_API_KEY'] })
  await f.adapter.setGrant(f.event, { ...mutation, action: 'disable' })
  const pending = await f.adapter.getStatus(f.event)
  assert.equal(pending.providers.openai.grantEnabled, false)
  assert.equal(pending.providers.openai.applicationState, 'pending-next-start')
  assert.equal(pending.childMayRetainCredential, true)
  await attempt.record({ phase: 'exited', owned: true, acceptedEnvNames: [] })
  assert.equal((await f.adapter.getStatus(f.event)).childMayRetainCredential, false)
  const next = f.adapter.createBackendAttempt({ attemptId: 'next', profile: 'default' })
  assert.deepEqual(await next.backendEnv(f.context()), {})
})
test('S4-W7b identity disposal can await exit receipts without a broker queue deadlock', async t => {
  let attempt
  const f = await fixture(t, { dispose: async () => { await attempt.record({ phase: 'exited', owned: true, acceptedEnvNames: [] }) } })
  await f.adapter.setGrant(f.event, mutation)
  attempt = f.adapter.createBackendAttempt({ attemptId: 'running', profile: 'default' })
  await attempt.backendEnv(f.context())
  await attempt.record({ phase: 'spawned', owned: true, acceptedEnvNames: ['OPENAI_API_KEY'] })
  const oldContext = f.context()
  f.auth = { ...f.auth, userId: '8', authGeneration: 'b' }
  await settled(f.adapter.identityChanged())
  assert.deepEqual(await attempt.backendEnv(oldContext), {})
  assert.equal((await f.adapter.getStatus(f.event)).childMayRetainCredential, false)
})
test('S4-W7c disposal failure blocks new starts rather than claiming revocation', async t => {
  const f = await fixture(t, { dispose: async () => { throw new Error('synthetic stop failure') } })
  await f.adapter.setGrant(f.event, mutation)
  const attempt = f.adapter.createBackendAttempt({ attemptId: 'running', profile: 'default' })
  await attempt.backendEnv(f.context())
  await attempt.record({ phase: 'spawned', owned: true, acceptedEnvNames: ['OPENAI_API_KEY'] })
  f.auth = { ...f.auth, userId: '8', authGeneration: 'b' }
  await f.adapter.identityChanged().catch(() => {})
  assert.equal((await f.adapter.getStatus(f.event)).availability, 'unavailable')
  assert.equal((await f.adapter.getStatus(f.event)).childMayRetainCredential, true)
  assert.deepEqual(await f.adapter.createBackendAttempt({ attemptId: 'new', profile: 'default' }).backendEnv(f.context()), {})
})

test('S4-W7d identity change blocks in-flight starts until owned disposal settles', async t => {
  const entered = deferred(), stopped = deferred()
  const f = await fixture(t, { dispose: async () => { entered.resolve(); await stopped.promise } })
  await f.adapter.setGrant(f.event, mutation)
  const attempt = f.adapter.createBackendAttempt({ attemptId: 'starting', profile: 'default' })
  const oldContext = f.context()
  await attempt.backendEnv(oldContext)
  f.auth = { ...f.auth, userId: '8', authGeneration: 'b' }
  const invalidating = f.adapter.identityChanged()
  await settled(entered.promise)
  try {
    assert.equal(await settled(attempt.record({ phase: 'spawned', owned: true, acceptedEnvNames: ['OPENAI_API_KEY'] })), false)
    const next = f.adapter.createBackendAttempt({ attemptId: 'too-soon', profile: 'default' })
    assert.deepEqual(await settled(next.backendEnv(f.context())), {})
    assert.equal((await settled(f.adapter.getStatus(f.event))).availability, 'unavailable')
  } finally { stopped.resolve(); await settled(invalidating) }
})

test('changing another provider grant does not mislabel an unchanged applied provider', async t => {
  const f = await fixture(t)
  await f.adapter.setGrant(f.event, mutation)
  const attempt = f.adapter.createBackendAttempt({ attemptId: 'provider-specific', profile: 'default' })
  await attempt.backendEnv(f.context())
  assert.equal(attempt.record({ phase: 'spawned', owned: true, acceptedEnvNames: ['OPENAI_API_KEY'] }), true,
    'main observer must receive a synchronous receipt before publishing connection')
  await f.adapter.setGrant(f.event, { ...mutation, provider: 'google' })
  const status = await f.adapter.getStatus(f.event)
  assert.equal(status.providers.openai.applicationState, 'applied')
  assert.equal(status.providers.google.applicationState, 'configured')
  assert.equal(status.childMayRetainCredential, false)
})

test('legitimate owned startup with no injected variables succeeds without claiming provider application', async t => {
  const f = await fixture(t)
  const attempt = f.adapter.createBackendAttempt({ attemptId: 'no-grants', profile: 'default' })
  assert.deepEqual(await attempt.backendEnv(f.context()), {})
  assert.equal(attempt.record({ phase: 'spawned', owned: true, acceptedEnvNames: [] }), true)
  const status = await f.adapter.getStatus(f.event)
  assert.equal(status.providers.openai.applicationState, 'absent')
  assert.equal(status.childMayRetainCredential, false)
})

test('identity change disposes an owned attempt even before its environment resolves', async t => {
  const dialog = deferred(), entered = deferred(), disposing = deferred()
  let pause = false, attempt
  const f = await fixture(t, {
    confirm: async () => { if (pause) { entered.resolve(); return dialog.promise } return true },
    dispose: async () => { disposing.resolve(); attempt.record({ phase: 'exited', owned: true, acceptedEnvNames: [] }) },
  })
  await f.adapter.setGrant(f.event, mutation)
  pause = true
  const changingGrant = f.adapter.setGrant(f.event, { ...mutation, provider: 'google' })
  await settled(entered.promise)
  attempt = f.adapter.createBackendAttempt({ attemptId: 'env-pending', profile: 'default' })
  const environment = attempt.backendEnv(f.context())
  f.auth = { ...f.auth, userId: '8', authGeneration: 'b' }
  const changingIdentity = f.adapter.identityChanged()
  try { await settled(disposing.promise) }
  finally { dialog.resolve(false); await settled(changingGrant); await settled(changingIdentity) }
  assert.deepEqual(await environment, {})
  assert.equal(attempt.record({ phase: 'spawned', owned: true, acceptedEnvNames: [] }), false)
})

test('an accepted empty receipt seals the attempt against a late credential resolution', async t => {
  const dialog = deferred(), entered = deferred()
  let pause = false
  const f = await fixture(t, { confirm: async () => { if (pause) { entered.resolve(); return dialog.promise } return true } })
  await f.adapter.setGrant(f.event, mutation)
  pause = true
  const changingGrant = f.adapter.setGrant(f.event, { ...mutation, provider: 'google' })
  await settled(entered.promise)
  const attempt = f.adapter.createBackendAttempt({ attemptId: 'host-timeout', profile: 'default' })
  const environment = attempt.backendEnv(f.context())
  let accepted
  try { accepted = attempt.record({ phase: 'spawned', owned: true, acceptedEnvNames: [] }) }
  finally { dialog.resolve(false); await settled(changingGrant) }
  assert.equal(accepted, true)
  assert.deepEqual(await environment, {})
  const status = await f.adapter.getStatus(f.event)
  assert.equal(status.providers.openai.applicationState, 'configured')
  assert.equal(status.childMayRetainCredential, false)
})

test('retired attempt IDs are bounded without imposing a lifetime limit on ordinary restarts', async t => {
  const f = await fixture(t)
  for (let i = 0; i < 1030; i++) {
    const attempt = f.adapter.createBackendAttempt({ attemptId: `restart-${i}`, profile: 'default' })
    assert.equal(attempt.record({ phase: 'failed', owned: true, acceptedEnvNames: [] }), true, `restart ${i}`)
  }
  const replay = f.adapter.createBackendAttempt({ attemptId: 'restart-1029', profile: 'default' })
  assert.equal(replay.record({ phase: 'failed', owned: true, acceptedEnvNames: [] }), false)
})

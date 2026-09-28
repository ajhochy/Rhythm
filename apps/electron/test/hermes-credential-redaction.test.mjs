import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createHermesAccountsMain } from '../src/hermes-accounts-main.mjs'
import { inspectHermesAccounts } from '../src/hermes-accounts.mjs'
import { createHermesCredentialBroker } from '../src/hermes-credential-broker.mjs'

const SECRET = 'synthetic-s7-redaction-key-never-disclose'
const FINGERPRINT = createHash('sha256').update(SECRET).digest('hex')
const SOURCE = 'opencode-auth-json'

function assertRedacted(value, label) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value)
  assert.equal(serialized.includes(SECRET), false, `${label} leaked the key sentinel`)
  assert.equal(serialized.includes(FINGERPRINT), false, `${label} leaked the fingerprint sentinel`)
}

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rhythm-s7-redaction-')))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const osHome = path.join(root, 'home'), hermesHome = path.join(root, 'hermes'), userData = path.join(root, 'user-data')
  fs.mkdirSync(path.join(osHome, '.local/share/opencode'), { recursive: true, mode: 0o700 })
  fs.mkdirSync(hermesHome, { mode: 0o700 }); fs.mkdirSync(userData, { mode: 0o700 })
  const authPath = path.join(osHome, '.local/share/opencode/auth.json')
  fs.writeFileSync(authPath, JSON.stringify({ openrouter: { type: 'api', key: SECRET } }), { mode: 0o600 })
  const grantsPath = path.join(userData, 'grants.json')
  const context = () => ({ serverOrigin: 'https://rhythm.test', rhythmUserId: 'user-7', profile: 'default', hermesHome, source: SOURCE, authGeneration: 'auth-a' })
  return { root, osHome, hermesHome, userData, authPath, grantsPath, context }
}

async function capture(t, run) {
  const logs = [], requests = []
  const originalConsole = Object.fromEntries(['debug', 'info', 'log', 'warn', 'error'].map(name => [name, console[name]]))
  for (const name of Object.keys(originalConsole)) console[name] = (...args) => logs.push([name, ...args])
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (...args) => { requests.push(args); return new Response('{}', { status: 200 }) }
  t.after(() => { Object.assign(console, originalConsole); globalThis.fetch = originalFetch })
  const returned = [], errors = []
  try { await run({ returned, errors }) } catch (error) { errors.push(error) }
  return { logs, requests, returned, errors }
}

test('1569:s7a-redaction-sentinels-outbound:1 reader and malformed-store paths expose neither sentinel', async t => {
  // Regression caught: parse diagnostics include the malformed credential value or a derived digest.
  const f = fixture(t)
  fs.writeFileSync(f.authPath, `{ "openrouter": { "type": "api", "key": "${SECRET}" }, "broken":`, { mode: 0o600 })
  fs.writeFileSync(path.join(f.hermesHome, 'auth.json'), `{ "version": 1, "providers": { "x": "${FINGERPRINT}" }`, { mode: 0o600 })
  const captured = await capture(t, async ({ returned }) => returned.push(inspectHermesAccounts({ osHome: f.osHome, hermesHome: f.hermesHome, grantsPath: f.grantsPath })))
  assertRedacted(captured, 'reader capture')
  assert.equal(captured.requests.length, 0, 'reader must not call production or telemetry endpoints')
})

test('1569:s7a-redaction-sentinels-outbound:2 broker sanitizes confirmation and disposal failure messages', async t => {
  // Regression caught: an external callback error carries a key or fingerprint into a thrown main-process error.
  const f = fixture(t)
  const confirmationBroker = createHermesCredentialBroker({
    ...f, getContext: f.context,
    confirmMutation: async () => { throw new Error(`confirmation failed ${SECRET} ${FINGERPRINT}`) },
    disposeOwnedBackend: async () => {},
  })
  const confirmationError = await confirmationBroker.setGrant({ source: SOURCE, provider: 'openrouter', enabled: true }).catch(error => error)
  assertRedacted(confirmationError?.message, 'confirmation error')

  const disposalBroker = createHermesCredentialBroker({
    ...f, getContext: f.context, confirmMutation: async () => true,
    disposeOwnedBackend: async () => { throw new Error(`spawn failure ${SECRET} ${FINGERPRINT}`) },
  })
  await disposalBroker.setGrant({ source: SOURCE, provider: 'openrouter', enabled: true })
  await disposalBroker.resolveBackendEnv(f.context())
  await disposalBroker.recordSpawnResult(f.context(), { owned: true, success: true })
  const disposalError = await disposalBroker.identityChanged({ ...f.context(), rhythmUserId: 'user-8' }).catch(error => error)
  assertRedacted(disposalError?.message, 'disposal error')
})

test('1569:s7a-redaction-sentinels-outbound:3 main status grant and spawn failures stay value-free and offline', async t => {
  // Regression caught: main serializes a resolved key after decline/spawn failure or forwards it to hosted/telemetry fetch.
  const f = fixture(t)
  const contents = {}, frame = {}, event = { sender: contents, senderFrame: frame }
  const captured = await capture(t, async ({ returned, errors }) => {
    let auth = { authenticated: true, serverOrigin: 'https://rhythm.test', userId: 'user-7', authGeneration: 'auth-a' }
    const common = {
      osHome: f.osHome, hermesHome: f.hermesHome, grantsPath: f.grantsPath,
      getAuthState: () => auth,
      getDocumentState: () => ({ contents, frame, url: 'rhythm://app/index.html#/tools/agent-settings', epoch: 1 }),
    }
    const declined = createHermesAccountsMain({ ...common,
      confirmNative: async () => false,
      disposeOwnedBackend: async () => {},
    })
    returned.push(await declined.getStatus(event))
    returned.push(await declined.setGrant(event, { action: 'enable', provider: 'openrouter', source: SOURCE }))

    const accounts = createHermesAccountsMain({ ...common,
      confirmNative: async () => true,
      disposeOwnedBackend: async () => { throw new Error(`spawn failed ${SECRET} ${FINGERPRINT}`) },
    })
    returned.push(await accounts.setGrant(event, { action: 'enable', provider: 'openrouter', source: SOURCE }))
    const attempt = accounts.createBackendAttempt({ attemptId: 'synthetic-failure', profile: 'default' })
    returned.push(Object.keys(await attempt.backendEnv(f.context())))
    returned.push(attempt.record({ phase: 'spawned', owned: true, acceptedEnvNames: ['OPENROUTER_API_KEY'] }))
    auth = { ...auth, userId: 'user-8', authGeneration: 'auth-b' }
    try { await accounts.identityChanged() } catch (error) { errors.push(error) }
    returned.push(await accounts.getStatus(event))
  })
  assertRedacted(captured.logs, 'captured logs')
  assertRedacted(captured.returned, 'serialized DTOs')
  assertRedacted(captured.errors.map(error => error?.message), 'main errors')
  for (const request of captured.requests) assertRedacted(request, 'outbound request')
  assert.equal(captured.requests.length, 0, 'S1/S2/main paths must not call the production API or telemetry')
})

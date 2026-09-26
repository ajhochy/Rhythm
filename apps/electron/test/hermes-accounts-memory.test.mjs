import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createHermesAccountsMain } from '../src/hermes-accounts-main.mjs'

const MEMORY_MUTATION = Object.freeze({ action: 'enable', capability: 'memory.search' })

function fixture(t, overrides = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rhythm-memory-consent-')))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const osHome = path.join(root, 'home')
  const hermesHome = path.join(root, 'hermes')
  const userData = path.join(root, 'user-data')
  fs.mkdirSync(path.join(osHome, '.local/share/opencode'), { recursive: true, mode: 0o700 })
  fs.mkdirSync(hermesHome, { mode: 0o700 })
  fs.mkdirSync(userData, { mode: 0o700 })
  const grantsPath = path.join(userData, 'grants.json')
  const contents = {}, frame = {}, event = { sender: contents, senderFrame: frame }
  let document = { contents, frame, url: 'rhythm://app/index.html#/tools/agent-settings', epoch: 1 }
  let auth = { authenticated: true, serverOrigin: 'https://rhythm.test', userId: 'user-7', authGeneration: 'auth-a' }
  const confirmations = [], revoked = []
  const make = () => createHermesAccountsMain({
    osHome, hermesHome, grantsPath,
    getAuthState: () => auth,
    getDocumentState: () => document,
    confirmNative: async mutation => { confirmations.push(mutation); return overrides.confirm?.(mutation) ?? true },
    disposeOwnedBackend: async () => {},
    bridgeHost: { revokeScope: async scope => { revoked.push(scope); return overrides.revoke?.(scope) } },
  })
  const memoryIdentity = changes => ({
    serverOrigin: auth.serverOrigin,
    rhythmUserId: auth.userId,
    profile: 'default',
    hermesHome,
    runtimeGeneration: 'runtime-a',
    memoryVaultId: 'a'.repeat(64),
    ...changes,
  })
  return { root, osHome, hermesHome, userData, grantsPath, event, confirmations, revoked, make, memoryIdentity,
    get auth() { return auth }, set auth(next) { auth = next },
    get document() { return document }, set document(next) { document = next } }
}

test('1569:s6b-consent:1 explicit current consent is stored main-side after exact native confirmation', async t => {
  // Regression caught: a renderer toggle grants memory search without showing the exact read-only, default-profile scope.
  const f = fixture(t)
  const accounts = f.make()
  assert.equal(await accounts.memorySearchConsent(f.memoryIdentity()), false)
  assert.deepEqual(await accounts.setMemorySearchConsent(f.event, MEMORY_MUTATION), { accepted: true })
  assert.deepEqual(f.confirmations, [{
    action: 'enable', capability: 'memory.search', access: 'read-only-search',
    profile: 'default', revocable: true,
  }])
  assert.equal((await accounts.getStatus(f.event)).memory.state, 'pending-next-start')
  assert.equal(await accounts.memorySearchConsent(f.memoryIdentity()), true)
  assert.equal((await accounts.getStatus(f.event)).memory.state, 'enabled')
  const files = fs.readdirSync(f.userData)
  assert.deepEqual(files, ['memory-search-consent.json'])
  assert.equal(fs.statSync(path.join(f.userData, files[0])).mode & 0o777, 0o600)
  const serialized = JSON.stringify(await accounts.getStatus(f.event))
  assert.equal(serialized.includes(f.hermesHome), false)
  assert.equal(serialized.includes(f.auth.serverOrigin), false)
  assert.equal(serialized.includes('a'.repeat(64)), false)
})

test('1569:s6b-consent:2 consent binds identity and vault while same-identity runtime generations reuse confirmation', async t => {
  // Regression caught: consent from one user/vault authorizes another, or every harmless runtime restart re-prompts.
  const f = fixture(t)
  let accounts = f.make()
  await accounts.memorySearchConsent(f.memoryIdentity())
  await accounts.setMemorySearchConsent(f.event, MEMORY_MUTATION)
  assert.equal(await accounts.memorySearchConsent(f.memoryIdentity({ runtimeGeneration: 'runtime-b' })), true,
    'same identity and vault may bind a fresh ephemeral runtime grant without reconfirmation')
  assert.equal(f.confirmations.length, 1)
  assert.equal(await accounts.memorySearchConsent(f.memoryIdentity({ memoryVaultId: 'b'.repeat(64) })), false)
  assert.equal(await accounts.memorySearchConsent(f.memoryIdentity({ rhythmUserId: 'user-8' })), false)
  accounts = f.make()
  assert.equal(await accounts.memorySearchConsent(f.memoryIdentity()), true, 'explicit consent survives main restart for the same identity and vault')
  f.auth = { ...f.auth, userId: 'user-8', authGeneration: 'auth-b' }
  await accounts.identityChanged()
  assert.equal(await accounts.memorySearchConsent(f.memoryIdentity()), false)
})

test('1569:s6b-consent:3 revoke is exact, calls the bridge scope hook, and clears consent', async t => {
  // Regression caught: UI revocation only changes local status while the active server grant keeps memory.search.
  const f = fixture(t)
  const accounts = f.make()
  await accounts.memorySearchConsent(f.memoryIdentity())
  await accounts.setMemorySearchConsent(f.event, MEMORY_MUTATION)
  assert.equal(await accounts.memorySearchConsent(f.memoryIdentity()), true)
  assert.deepEqual(await accounts.setMemorySearchConsent(f.event, { action: 'disable', capability: 'memory.search' }), { accepted: true })
  assert.deepEqual(f.revoked, ['memory.search'])
  assert.equal(await accounts.memorySearchConsent(f.memoryIdentity()), false)
  assert.equal((await accounts.getStatus(f.event)).memory.state, 'disabled')
})

test('1569:s6b-consent:4 renderer payload and authority are closed and revalidated after confirmation', async t => {
  // Regression caught: renderer-supplied identity/path or a navigated document widens the consent mutation.
  let release
  const confirmation = new Promise(resolve => { release = resolve })
  const f = fixture(t, { confirm: async () => confirmation })
  const accounts = f.make()
  await accounts.memorySearchConsent(f.memoryIdentity())
  for (const payload of [
    { ...MEMORY_MUTATION, memoryVaultId: 'a'.repeat(64) },
    { ...MEMORY_MUTATION, serverOrigin: f.auth.serverOrigin },
    { ...MEMORY_MUTATION, profile: 'default' },
    { ...MEMORY_MUTATION, token: 'synthetic-secret' },
    { ...MEMORY_MUTATION, action: 'grant' },
  ]) assert.deepEqual(await accounts.setMemorySearchConsent(f.event, payload), { accepted: false })
  const pending = accounts.setMemorySearchConsent(f.event, MEMORY_MUTATION)
  await new Promise(resolve => setImmediate(resolve))
  f.document = { ...f.document, frame: {}, epoch: 2 }
  release(true)
  assert.deepEqual(await pending, { accepted: false })
  assert.equal(await accounts.memorySearchConsent(f.memoryIdentity()), false)
})

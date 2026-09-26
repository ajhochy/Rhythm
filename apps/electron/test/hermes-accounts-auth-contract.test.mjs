import assert from 'node:assert/strict'
import test from 'node:test'

const modulePromise = import('../src/hermes-accounts-auth.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.message.includes('hermes-accounts-auth.mjs')) return null
  throw error
})
async function create(options) {
  const api = await modulePromise
  assert.equal(typeof api?.createAccountsAuthState, 'function', 'RED: main-owned Accounts auth lifecycle helper is missing')
  return api.createAccountsAuthState(options)
}
function storageFixture() {
  let bytes = null
  let valid = true
  const saved = []
  // Fake only Electron safeStorage and authoritative server validation, not
  // generation/persistence logic under test. No files or real auth are read.
  const options = {
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: text => Buffer.from(`encrypted-fixture:${text}`),
      decryptString: buffer => { assert.ok(buffer.toString().startsWith('encrypted-fixture:')); return buffer.toString().slice(18) },
    },
    loadEncrypted: async () => bytes,
    saveEncrypted: async next => { assert.ok(Buffer.isBuffer(next)); bytes = Buffer.from(next); saved.push(bytes) },
    clearEncrypted: async () => { bytes = null },
    validateSession: async session => valid && session.sessionToken === 'synthetic-session-token',
  }
  return { options, saved, get bytes() { return bytes }, set bytes(next) { bytes = next }, set valid(next) { valid = next } }
}
const login = { serverOrigin: 'https://rhythm.test', userId: '7', sessionToken: 'synthetic-session-token' }

test('S4-W3a auth generation survives document reload and validated encrypted session restore', async () => {
  // Catches using incrementing document epoch as durable consent identity.
  const f = storageFixture(), first = await create(f.options)
  await first.signIn(login)
  const initial = first.getSnapshot()
  assert.equal(initial.authenticated, true)
  assert.equal(typeof initial.authGeneration, 'string')
  assert.ok(initial.authGeneration.length >= 16)
  first.documentChanged()
  assert.equal(first.getSnapshot().authGeneration, initial.authGeneration)
  assert.notEqual(first.getSnapshot().documentEpoch, initial.documentEpoch)
  const restored = await create(f.options)
  await restored.restore({ serverOrigin: login.serverOrigin })
  assert.equal(restored.getSnapshot().authGeneration, initial.authGeneration)
  assert.equal(restored.getSnapshot().authenticated, true)
  assert.equal(JSON.stringify(restored.getSnapshot()).includes(login.sessionToken), false)
  assert.ok(f.saved.length >= 1)
})
test('S4-W3b restored invalid auth and fresh login cannot reuse prior consent generation', async () => {
  // Catches stored encrypted shape being treated as current authentication.
  const f = storageFixture(), first = await create(f.options)
  await first.signIn(login)
  const old = first.getSnapshot().authGeneration
  f.valid = false
  const invalid = await create(f.options)
  await invalid.restore({ serverOrigin: login.serverOrigin })
  assert.equal(invalid.getSnapshot().authenticated, false)
  f.valid = true
  await invalid.signIn(login)
  assert.notEqual(invalid.getSnapshot().authGeneration, old)
  const signed = invalid.getSnapshot().authGeneration
  await invalid.invalidate()
  assert.equal(invalid.getSnapshot().authenticated, false)
  assert.equal(f.bytes, null)
  await invalid.signIn({ ...login, userId: '8' })
  assert.notEqual(invalid.getSnapshot().authGeneration, signed)
})
test('S4-W3c restore refuses another server and cannot derive generation from session token', async () => {
  // Same token twice still produces distinct login generations; wrong server stays signed out.
  const f = storageFixture(), first = await create(f.options)
  await first.signIn(login)
  const before = first.getSnapshot().authGeneration
  const second = await create(f.options)
  await second.restore({ serverOrigin: 'https://other.test' })
  assert.equal(second.getSnapshot().authenticated, false)
  await second.signIn(login)
  assert.notEqual(second.getSnapshot().authGeneration, before)
})

test('S4-W3d no encryption or corrupt stored bytes cannot restore sharing authority', async () => {
  const f = storageFixture()
  f.bytes = Buffer.from('corrupt')
  const corrupt = await create(f.options)
  await corrupt.restore({ serverOrigin: login.serverOrigin })
  assert.equal(corrupt.getSnapshot().authenticated, false)
  const unavailable = await create({ ...f.options, safeStorage: { ...f.options.safeStorage, isEncryptionAvailable: () => false } })
  await unavailable.restore({ serverOrigin: login.serverOrigin })
  assert.equal(unavailable.getSnapshot().authenticated, false)
  assert.equal(f.saved.length, 0)
})

test('auth metadata enriches the existing main envelope without losing numeric user identity or unrelated fields', async () => {
  const f = storageFixture(), auth = await create(f.options)
  const envelope = { user: { id: 7, name: 'Fixture User', email: 'fixture@example.test' }, futureMainMetadata: { retain: true } }
  await auth.signIn({ ...login, envelope })
  const saved = JSON.parse(f.options.safeStorage.decryptString(f.bytes))
  assert.deepEqual(saved.user, envelope.user)
  assert.deepEqual(saved.futureMainMetadata, envelope.futureMainMetadata)
  assert.equal(saved.productionApiBase, login.serverOrigin)
  assert.equal(saved.rhythmAccountsAuthGeneration, auth.getSnapshot().authGeneration)
})

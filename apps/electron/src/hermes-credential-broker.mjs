import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { extractOpenCodeStaticApiKeys, inspectHermesAccounts } from './hermes-accounts.mjs'

const LIMIT = 1024 * 1024
const PROVIDERS = Object.freeze({ openrouter: 'OPENROUTER_API_KEY', anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', google: 'GOOGLE_API_KEY' })
const SOURCE = 'opencode-auth-json'
const STORE_VERSION = 1

/** @param {any} context */
function identity(context) {
  if (!context || context.profile !== 'default' || context.source !== SOURCE ||
      typeof context.serverOrigin !== 'string' || typeof context.rhythmUserId !== 'string' ||
      typeof context.hermesHome !== 'string' || typeof context.authGeneration !== 'string' ||
      !context.rhythmUserId || !context.authGeneration) return null
  try {
    const origin = new URL(context.serverOrigin)
    if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== context.serverOrigin ||
        !path.isAbsolute(context.hermesHome) || fs.realpathSync(context.hermesHome) !== context.hermesHome) return null
  } catch { return null }
  return [context.serverOrigin, context.rhythmUserId, 'default', context.hermesHome, SOURCE, context.authGeneration]
}

/** @param {any} context */
const identityKey = (context) => {
  const parts = identity(context)
  return parts ? JSON.stringify(parts) : null
}

/** @param {any} grant */
function validGrant(grant) {
  return grant && typeof grant === 'object' && !Array.isArray(grant) &&
    Object.keys(grant).sort().join(',') === 'identity,provider,source' &&
    Array.isArray(grant.identity) && grant.identity.length === 6 &&
    grant.identity.every(/** @param {any} part */ (part) => typeof part === 'string' && part.length > 0 && part.length <= 4096) &&
    grant.identity[2] === 'default' && grant.identity[4] === SOURCE &&
    grant.source === SOURCE && Object.hasOwn(PROVIDERS, grant.provider)
}

/** @param {string} directory */
function checkedDirectory(directory) {
  if (!path.isAbsolute(directory)) return false
  let current = path.parse(directory).root
  for (const part of path.relative(current, directory).split(path.sep).filter(Boolean)) {
    current = path.join(current, part)
    const entry = fs.lstatSync(current)
    if (!entry.isDirectory() || entry.isSymbolicLink()) return false
  }
  return fs.realpathSync(directory) === directory
}

/** @param {string} file @returns {{state:string,grants:any[],digest?:string}} */
function readStore(file) {
  let descriptor
  try {
    const directory = path.dirname(file)
    if (!checkedDirectory(directory)) return { state: 'unreadable', grants: [] }
    const before = fs.lstatSync(file)
    const uid = process.getuid?.()
    if (!before.isFile() || before.isSymbolicLink() || before.size > LIMIT || (before.mode & 0o077) !== 0 ||
        uid === undefined || before.uid !== uid) return { state: 'unreadable', grants: [] }
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
    const opened = fs.fstatSync(descriptor)
    if (!opened.isFile() || opened.uid !== uid || opened.size > LIMIT ||
        opened.dev !== before.dev || opened.ino !== before.ino) return { state: 'unreadable', grants: [] }
    const buffer = Buffer.allocUnsafe(LIMIT + 1)
    let length = 0
    while (length < buffer.length) {
      const read = fs.readSync(descriptor, buffer, length, buffer.length - length, null)
      if (!read) break
      length += read
    }
    const after = fs.fstatSync(descriptor)
    const current = fs.lstatSync(file)
    if (!checkedDirectory(directory) || !current.isFile() || current.isSymbolicLink() ||
        current.dev !== opened.dev || current.ino !== opened.ino ||
        after.dev !== opened.dev || after.ino !== opened.ino ||
        after.size !== length || length > LIMIT ||
        after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) return { state: 'unreadable', grants: [] }
    try {
      const parsed = JSON.parse(buffer.toString('utf8', 0, length))
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
          Object.keys(parsed).sort().join(',') !== 'grants,schemaVersion' ||
          parsed.schemaVersion !== STORE_VERSION || !Array.isArray(parsed.grants) ||
          parsed.grants.length > 1024 || !parsed.grants.every(validGrant)) return { state: 'malformed', grants: [] }
      return { state: 'present', grants: parsed.grants, digest: createHash('sha256').update(buffer.subarray(0, length)).digest('hex') }
    } catch { return { state: 'malformed', grants: [] } }
  } catch (error) {
    let directoryValid = false
    try { directoryValid = checkedDirectory(path.dirname(file)) } catch { /* unavailable */ }
    return { state: error instanceof Error && 'code' in error && error.code === 'ENOENT' && directoryValid ? 'absent' : 'unreadable', grants: [] }
  } finally { if (descriptor !== undefined) fs.closeSync(descriptor) }
}

/** @param {string} file @param {any[]} grants */
function writeStore(file, grants) {
  const directory = path.dirname(file)
  const directoryEntry = fs.statSync(directory)
  if (!checkedDirectory(directory) || (directoryEntry.mode & 0o777) !== 0o700 ||
      directoryEntry.uid !== process.getuid?.()) throw new Error('Grant store unavailable')
  const before = readStore(file)
  if (!['absent', 'present'].includes(before.state)) throw new Error('Grant store unavailable')
  const bytes = Buffer.from(JSON.stringify({ schemaVersion: STORE_VERSION, grants }))
  if (bytes.length > LIMIT) throw new Error('Grant store unavailable')
  const temp = path.join(directory, `.hermes-grants-${randomUUID()}.tmp`)
  let descriptor
  try {
    descriptor = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600)
    let written = 0
    while (written < bytes.length) {
      const count = fs.writeSync(descriptor, bytes, written, bytes.length - written)
      if (!Number.isInteger(count) || count <= 0 || count > bytes.length - written) throw new Error('Grant store unavailable')
      written += count
    }
    if (fs.fstatSync(descriptor).size !== bytes.length) throw new Error('Grant store unavailable')
    fs.fsyncSync(descriptor)
    fs.closeSync(descriptor)
    descriptor = undefined
    const current = readStore(file)
    if (current.state !== before.state || current.digest !== before.digest ||
        !checkedDirectory(directory)) throw new Error('Grant store changed')
    fs.renameSync(temp, file)
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
    try { fs.unlinkSync(temp) } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error }
  }
}

/** @param {any} payload */
function mutationShape(payload) {
  return payload && typeof payload === 'object' && !Array.isArray(payload) &&
    Object.keys(payload).sort().join(',') === 'action,provider,source' &&
    ['enable', 'disable'].includes(payload.action) && payload.source === SOURCE &&
    Object.hasOwn(PROVIDERS, payload.provider) && JSON.stringify(payload).length <= 256
}

/** Main-owned IPC adapter seam. The caller must supply verified sender facts and a native dialog. */
/** @param {{sender:any,payload:any,context:any,confirmNative:(mutation:any)=>Promise<boolean>}} request */
export async function validateGrantMutationRequest({ sender, payload, context, confirmNative }) {
  try {
    if (!sender?.authenticated || !sender.ownsDocument || !sender.isMainFrame ||
        !mutationShape(payload) || !identity(context) || typeof confirmNative !== 'function' ||
        typeof sender.senderUrl !== 'string' || sender.senderUrl.length > 2048 ||
        sender.trustedOrigin !== context.serverOrigin ||
        new URL(sender.senderUrl).origin !== context.serverOrigin) return { accepted: false }
    const initialIdentity = identityKey(context)
    const initialSender = JSON.stringify(sender)
    const exact = Object.freeze({ action: payload.action, source: payload.source, provider: payload.provider })
    const confirmed = (await confirmNative(exact)) === true
    const accepted = confirmed && mutationShape(payload) &&
      payload.action === exact.action && payload.source === exact.source && payload.provider === exact.provider &&
      identityKey(context) === initialIdentity && JSON.stringify(sender) === initialSender
    return accepted ? { accepted: true, mutation: exact } : { accepted: false }
  } catch { return { accepted: false } }
}

/** Reference-only grant broker. Values live solely in the per-spawn return value. */
/** @param {{grantsPath:string,osHome:string,hermesHome:string,getContext:()=>any,confirmMutation:(mutation:any)=>Promise<boolean>,disposeOwnedBackend:(reason:any)=>Promise<void>}} options */
export function createHermesCredentialBroker({ grantsPath, osHome, hermesHome, getContext, confirmMutation, disposeOwnedBackend }) {
  if (!path.isAbsolute(grantsPath) || typeof getContext !== 'function' ||
      typeof confirmMutation !== 'function' || typeof disposeOwnedBackend !== 'function') throw new Error('Invalid broker configuration')
  const suppliedDirectory = path.dirname(grantsPath)
  let component = path.parse(suppliedDirectory).root
  for (const part of path.relative(component, suppliedDirectory).split(path.sep).filter(Boolean)) {
    component = path.join(component, part)
    const entry = fs.lstatSync(component)
    if (!entry.isDirectory() && !(entry.isSymbolicLink() && ['/var', '/tmp'].includes(component))) throw new Error('Invalid grant directory')
  }
  grantsPath = path.join(fs.realpathSync(suppliedDirectory), path.basename(grantsPath))
  let queue = Promise.resolve()
  let retired = false
  /** @type {string|null} */
  let applied = null
  /** @type {number|null} */
  let appliedGeneration = null
  /** @type {{identity:string,generation:number}|null} */
  let pending = null
  /** @type {string|null} */
  let ownedIdentity = null
  let mayRetain = false
  let generation = 0
  /** @param {() => any} fn */
  const serial = (fn) => {
    const result = queue.then(fn)
    queue = result.catch(() => {})
    return result
  }
  const currentIdentity = () => identityKey(getContext())
  /** @param {any} context */
  const matches = (context) => {
    try { return Boolean(!retired && identityKey(context) && identityKey(context) === currentIdentity() && context.hermesHome === fs.realpathSync(hermesHome)) }
    catch { return false }
  }
  /** @param {any} context */
  const status = (context) => {
    const store = readStore(grantsPath)
    const key = identityKey(context)
    const configured = Boolean(matches(context) && store.grants.some((grant) => JSON.stringify(grant.identity) === key))
    return { grants: { state: store.state }, lifecycle: applied === key &&
      (mayRetain || appliedGeneration !== generation) ? 'pending-next-start' :
      applied === key && configured ? 'applied' : configured ? 'configured' : 'absent',
    childMayRetainCredential: mayRetain && applied === key }
  }
  return {
    /** @param {any} mutation */
    setGrant(mutation) { return serial(async () => {
      if (!mutation || mutation.source !== SOURCE || !Object.hasOwn(PROVIDERS, mutation.provider) ||
          typeof mutation.enabled !== 'boolean' || Object.keys(mutation).sort().join(',') !== 'enabled,provider,source') throw new Error('Invalid grant mutation')
      const context = getContext()
      const parts = identity(context)
      const key = parts && JSON.stringify(parts)
      if (!matches(context)) throw new Error('Invalid grant identity')
      const requested = Object.freeze({ source: SOURCE, provider: mutation.provider, enabled: mutation.enabled })
      const exact = Object.freeze({ action: requested.enabled ? 'enable' : 'disable', source: SOURCE, provider: requested.provider })
      if ((await confirmMutation(exact)) !== true || key !== currentIdentity() ||
          key !== identityKey(context) || !matches(context) || retired ||
          mutation.source !== requested.source || mutation.provider !== requested.provider ||
          mutation.enabled !== requested.enabled || Object.keys(mutation).sort().join(',') !== 'enabled,provider,source') {
        throw new Error('Grant confirmation denied')
      }
      const store = readStore(grantsPath)
      if (!['present', 'absent'].includes(store.state)) throw new Error('Grant store unavailable')
      const grants = store.grants.filter((grant) => !(JSON.stringify(grant.identity) === key && grant.provider === requested.provider))
      if (requested.enabled) grants.push({ identity: parts, source: SOURCE, provider: requested.provider })
      writeStore(grantsPath, grants)
      generation++
      if (applied === key) mayRetain = true
      return { configured: requested.enabled, lifecycle: status(context).lifecycle }
    }) },
    /** @param {any} context */
    async resolveBackendEnv(context) {
      return serial(async () => {
        if (!matches(context) || ownedIdentity && ownedIdentity !== identityKey(context) ||
            pending && pending.identity !== identityKey(context)) return {}
        const store = readStore(grantsPath)
        if (store.state !== 'present') return {}
        const key = identityKey(context)
        if (!key) return {}
        const selected = store.grants.filter((grant) => JSON.stringify(grant.identity) === key)
        if (!selected.length) return {}
        const keys = extractOpenCodeStaticApiKeys({ osHome })
        /** @type {any} */
        const readiness = inspectHermesAccounts({ osHome, hermesHome })
        /** @type {Record<string,string>} */
        const env = {}
        for (const grant of selected) {
          const name = PROVIDERS[/** @type {keyof typeof PROVIDERS} */ (grant.provider)]
          if (typeof keys[name] === 'string' && readiness.sources.hermesAuth.state !== 'unknown' &&
              !['present', 'shadowed'].includes(readiness.providers[grant.provider]?.state)) env[name] = keys[name]
        }
        if (Object.keys(env).length) pending = { identity: key, generation }
        return env
      })
    },
    /** @param {any} context @param {any} result */
    recordSpawnResult(context, result) { return serial(async () => {
      const key = identityKey(context)
      if (!matches(context) || !pending || pending.identity !== key) return false
      if (result?.owned !== true || result?.success !== true) {
        pending = null
        return false
      }
      const changedSinceResolution = pending.generation !== generation
      const resolvedGeneration = pending.generation
      pending = null
      applied = key
      appliedGeneration = resolvedGeneration
      ownedIdentity = key
      mayRetain = changedSinceResolution
      return true
    }) },
    /** @param {any} context */
    async getStatus(context) { return serial(() => status(context)) },
    /** @param {any} context */
    identityChanged(context) { return serial(async () => {
      const next = identityKey(context)
      const inFlightIdentity = pending?.identity
      generation++
      if ((ownedIdentity && ownedIdentity !== next) || (inFlightIdentity && inFlightIdentity !== next)) {
        retired = true
        await disposeOwnedBackend({ reason: 'identity-changed' })
        ownedIdentity = null
        applied = null
        appliedGeneration = null
        pending = null
        mayRetain = false
        retired = false
      } else if (inFlightIdentity !== next) {
        pending = null
      }
      return true
    }) },
  }
}

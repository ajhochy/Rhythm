import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createHermesCredentialBroker, validateGrantMutationRequest } from './hermes-credential-broker.mjs'
import { inspectHermesAccounts } from './hermes-accounts.mjs'

const SOURCE = 'opencode-auth-json'
const NAMES = Object.freeze({ openrouter: 'OPENROUTER_API_KEY', anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', google: 'GOOGLE_API_KEY' })
const MEMORY_CAPABILITY = 'memory.search'
const MEMORY_STORE_VERSION = 1
const MEMORY_STORE_LIMIT = 32 * 1024
/** @param {any} mutation */
const validMutation = mutation => mutation && typeof mutation === 'object' && !Array.isArray(mutation) &&
  Object.keys(mutation).sort().join(',') === 'action,provider,source' && ['enable', 'disable'].includes(mutation.action) &&
  mutation.source === SOURCE && Object.hasOwn(NAMES, mutation.provider)
/** @param {any} mutation */
const validMemoryMutation = mutation => mutation && typeof mutation === 'object' && !Array.isArray(mutation) &&
  Object.keys(mutation).sort().join(',') === 'action,capability' && ['enable', 'disable'].includes(mutation.action) &&
  mutation.capability === MEMORY_CAPABILITY

/** @param {string} file */
function readMemoryConsent(file) {
  let descriptor
  try {
    const before = fs.lstatSync(file)
    const uid = process.getuid?.()
    if (!before.isFile() || before.isSymbolicLink() || before.size > MEMORY_STORE_LIMIT ||
        (before.mode & 0o077) !== 0 || uid === undefined || before.uid !== uid) return null
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
    const opened = fs.fstatSync(descriptor)
    if (!opened.isFile() || opened.uid !== uid || opened.size !== before.size ||
        opened.dev !== before.dev || opened.ino !== before.ino) return null
    const bytes = Buffer.alloc(opened.size)
    let offset = 0
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, null)
      if (!count) return null
      offset += count
    }
    const current = fs.lstatSync(file)
    const after = fs.fstatSync(descriptor)
    if (current.isSymbolicLink() || current.dev !== opened.dev || current.ino !== opened.ino ||
        after.size !== offset || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) return null
    const parsed = JSON.parse(bytes.toString('utf8'))
    const consent = parsed?.consent
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
        Object.keys(parsed).sort().join(',') !== 'consent,schemaVersion' || parsed.schemaVersion !== MEMORY_STORE_VERSION ||
        !consent || typeof consent !== 'object' || Array.isArray(consent) ||
        Object.keys(consent).sort().join(',') !== 'hermesHome,memoryVaultId,profile,rhythmUserId,serverOrigin' ||
        !Object.values(consent).every(value => typeof value === 'string' && value.length > 0 && value.length <= 4096) ||
        consent.profile !== 'default' || !/^[a-f0-9]{64}$/.test(consent.memoryVaultId)) return null
    return Object.freeze({ ...consent })
  } catch { return null }
  finally { if (descriptor !== undefined) fs.closeSync(descriptor) }
}

/** @param {string} file @param {any} consent */
function writeMemoryConsent(file, consent) {
  const directory = path.dirname(file)
  const directoryEntry = fs.statSync(directory)
  if (!directoryEntry.isDirectory() || directoryEntry.isSymbolicLink() ||
      (directoryEntry.mode & 0o777) !== 0o700 || directoryEntry.uid !== process.getuid?.() ||
      fs.realpathSync(directory) !== directory) throw new Error('Memory consent store unavailable')
  const bytes = Buffer.from(JSON.stringify({ schemaVersion: MEMORY_STORE_VERSION, consent }))
  const temp = path.join(directory, `.memory-search-consent-${randomUUID()}.tmp`)
  let descriptor
  try {
    descriptor = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600)
    let offset = 0
    while (offset < bytes.length) {
      const count = fs.writeSync(descriptor, bytes, offset, bytes.length - offset)
      if (!Number.isInteger(count) || count <= 0) throw new Error('Memory consent store unavailable')
      offset += count
    }
    fs.fsyncSync(descriptor)
    fs.closeSync(descriptor)
    descriptor = undefined
    fs.renameSync(temp, file)
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
    try { fs.unlinkSync(temp) } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error }
  }
}

/** @param {string} file */
function clearMemoryConsent(file) {
  try {
    const before = fs.lstatSync(file)
    if (!before.isFile() || before.isSymbolicLink() || before.uid !== process.getuid?.()) throw new Error('Memory consent store unavailable')
    fs.unlinkSync(file)
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
  }
}

/** Main-only composition. Actual Electron main/view wiring supplies trusted getters
 * and the native dialog. No method accepts renderer identity, home, or env values.
 * @param {{osHome:string,hermesHome:string,grantsPath:string,getAuthState:()=>any,getDocumentState:()=>any,confirmNative:(mutation:any,document:any)=>Promise<boolean>,disposeOwnedBackend:(reason:any)=>Promise<void>|void,bridgeHost?:{revokeScope:(scope:string)=>Promise<void>|void}}} options
 */
export function createHermesAccountsMain(options) {
  const { osHome, hermesHome, grantsPath, getAuthState, getDocumentState, confirmNative, disposeOwnedBackend, bridgeHost } = options
  if (![getAuthState, getDocumentState, confirmNative, disposeOwnedBackend].every(fn => typeof fn === 'function')) throw new Error('Invalid Accounts main configuration')
  if (bridgeHost !== undefined && typeof bridgeHost?.revokeScope !== 'function') throw new Error('Invalid Accounts bridge host')
  // S1/S2 validate all actual reads. Main must provide canonical initialized roots.
  if (!path.isAbsolute(hermesHome) || fs.realpathSync(hermesHome) !== hermesHome) throw new Error('Accounts home unavailable')
  let blocked = false
  const providerGenerations = Object.fromEntries(Object.keys(NAMES).map(provider => [provider, 0]))
  let transitionGeneration = 0
  /** @type {Promise<void>|null} */
  let transition = null
  /** @type {{event:any,document:any,context:any}|null} */
  let confirmation = null
  let mutations = Promise.resolve()
  const memoryConsentPath = path.join(fs.realpathSync(path.dirname(grantsPath)), 'memory-search-consent.json')
  /** @type {{serverOrigin:string,rhythmUserId:string,profile:'default',hermesHome:string,runtimeGeneration:string,memoryVaultId:string}|null} */
  let memoryCandidate = null
  /** Runtime generation that most recently received true from memorySearchConsent. */
  /** @type {string|null} */
  let memoryAppliedGeneration = null
  /** @type {Map<string,any>} */
  const attempts = new Map()
  /** Bounded replay window; retired closures stay terminal even after eviction. */
  const retiredIds = new Set()
  /** @param {string} id @param {any} attempt */
  const retire = (id, attempt) => {
    attempt.terminal = true
    attempt.names = []
    if (attempts.get(id) === attempt) attempts.delete(id)
    retiredIds.add(id)
    while (retiredIds.size > 1024) retiredIds.delete(retiredIds.values().next().value)
  }
  const context = () => {
    try {
      const auth = getAuthState()
      if (!auth?.authenticated || typeof auth.serverOrigin !== 'string' || typeof auth.userId !== 'string' ||
          !auth.userId || auth.userId.length > 256 || typeof auth.authGeneration !== 'string' || !auth.authGeneration || auth.authGeneration.length > 256) return null
      const url = new URL(auth.serverOrigin)
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== auth.serverOrigin) return null
      return Object.freeze({ serverOrigin: auth.serverOrigin, rhythmUserId: auth.userId, profile: 'default',
        hermesHome, source: SOURCE, authGeneration: auth.authGeneration })
    } catch { return null }
  }
  /** @param {any} value */
  const key = value => value ? JSON.stringify([value.serverOrigin, value.rhythmUserId, value.profile, value.hermesHome, value.source, value.authGeneration]) : null
  /** @param {any} event */
  const documentFor = event => {
    try {
      const document = getDocumentState()
      if (!document || !event || !document.contents || !document.frame || event.sender !== document.contents || event.senderFrame !== document.frame ||
          typeof document.url !== 'string' || document.url.length > 2048 || !/^rhythm:\/\/app\/index\.html(?:#.*)?$/.test(document.url)) return null
      return { ...document }
    } catch { return null }
  }
  /** @param {any} request */
  const currentRequest = request => {
    const now = documentFor(request.event)
    return Boolean(!blocked && now && now.contents === request.document.contents && now.frame === request.document.frame &&
      now.url === request.document.url && now.epoch === request.document.epoch && key(context()) === key(request.context))
  }
  /** @param {any} input */
  const memoryIdentity = input => {
    const selected = context()
    try {
      if (!selected || !input || typeof input !== 'object' || Array.isArray(input) ||
          Object.keys(input).sort().join(',') !== 'hermesHome,memoryVaultId,profile,rhythmUserId,runtimeGeneration,serverOrigin' ||
          input.serverOrigin !== selected.serverOrigin || input.rhythmUserId !== selected.rhythmUserId ||
          input.profile !== 'default' || input.hermesHome !== selected.hermesHome ||
          typeof input.runtimeGeneration !== 'string' || !input.runtimeGeneration || input.runtimeGeneration.length > 256 ||
          typeof input.memoryVaultId !== 'string' || !/^[a-f0-9]{64}$/.test(input.memoryVaultId)) return null
      return Object.freeze({ serverOrigin: input.serverOrigin, rhythmUserId: input.rhythmUserId, profile: 'default',
        hermesHome: input.hermesHome, runtimeGeneration: input.runtimeGeneration, memoryVaultId: input.memoryVaultId })
    } catch { return null }
  }
  /** Runtime generation is intentionally omitted: a restart rebinds the same explicit identity/vault consent. */
  /** @param {any} input */
  const storedMemoryIdentity = input => input && ({ serverOrigin: input.serverOrigin, rhythmUserId: input.rhythmUserId,
    profile: input.profile, hermesHome: input.hermesHome, memoryVaultId: input.memoryVaultId })
  /** @param {any} left @param {any} right */
  const sameMemoryIdentity = (left, right) => Boolean(left && right && JSON.stringify(storedMemoryIdentity(left)) === JSON.stringify(storedMemoryIdentity(right)))
  const memoryState = () => {
    const selected = context()
    if (blocked || !selected) return 'unavailable'
    const saved = readMemoryConsent(memoryConsentPath)
    if (!memoryCandidate) return saved ? 'unavailable' : 'disabled'
    if (!sameMemoryIdentity(saved, memoryCandidate)) return 'disabled'
    return memoryAppliedGeneration === memoryCandidate.runtimeGeneration ? 'enabled' : 'pending-next-start'
  }
  const broker = createHermesCredentialBroker({ osHome, hermesHome, grantsPath, getContext: context,
    // Actual disposal is coordinated outside the broker queue below. This
    // callback only clears the broker's obsolete identity bookkeeping afterward.
    disposeOwnedBackend: async () => {},
    confirmMutation: async exact => {
      const request = confirmation
      if (!request || !currentRequest(request)) return false
      const result = await validateGrantMutationRequest({
        sender: { authenticated: true, ownsDocument: true, isMainFrame: true, senderUrl: request.document.url, trustedOrigin: request.context.serverOrigin },
        payload: exact, context: request.context, trustedDocumentUrl: 'rhythm://app/index.html',
        revalidate: () => currentRequest(request),
        confirmNative: mutation => confirmNative(mutation, request.document),
      })
      return result.accepted === true && currentRequest(request)
    },
  })
  const retaining = () => [...attempts.values()].some(attempt => !attempt.terminal && attempt.names.length > 0)
  const unavailable = () => ({ version: 1, availability: 'unavailable', childMayRetainCredential: retaining(), memory: { state: 'unavailable' } })
  const status = async () => {
    const selected = context()
    if (blocked || !selected) return unavailable()
    const selectedKey = key(selected)
    const saved = await broker.getStatus(selected)
    if (blocked || selectedKey !== key(context())) return unavailable()
    const readiness = inspectHermesAccounts({ osHome, hermesHome, grantsPath })
    const providers = Object.fromEntries(Object.entries(NAMES).map(([provider, name]) => {
      const grantEnabled = saved.providers[provider]?.grantEnabled === true
      const applied = [...attempts.values()].filter(attempt => !attempt.terminal && attempt.accepted && attempt.identity === selectedKey && attempt.names.includes(name))
      const changed = applied.some(attempt => attempt.generations[provider] !== providerGenerations[provider]) || applied.length > 0 && !grantEnabled
      return [provider, { sourceState: readiness.providers[provider]?.state ?? 'unknown', grantEnabled,
        rhythmSourceState: readiness.providers[provider]?.rhythmSourceState ?? 'unknown',
        hermesSourceState: readiness.providers[provider]?.hermesSourceState ?? 'unknown',
        sharingEligibility: readiness.providers[provider]?.sharingEligibility ?? 'source-unavailable',
        applicationState: changed ? 'pending-next-start' : applied.length ? 'applied' : grantEnabled ? 'configured' : 'absent' }]
    }))
    const pending = Object.values(providers).some(provider => provider.applicationState === 'pending-next-start')
    return { version: 1, availability: 'available', sources: { ...readiness.sources, grants: saved.grants }, providers,
      childMayRetainCredential: pending, memory: { state: memoryState() }, claudeCode: readiness.claudeCode }
  }
  return {
    /** @param {any} event @param {...any} extra */
    async getStatus(event, ...extra) {
      const document = documentFor(event), selected = context()
      if (extra.length || !document || !selected || blocked) return unavailable()
      const result = await status()
      return currentRequest({ event, document, context: selected }) ? result : unavailable()
    },
    /** @param {any} event @param {any} payload @param {...any} extra */
    setGrant(event, payload, ...extra) {
      const document = documentFor(event), selected = context()
      if (extra.length || !document || !selected || blocked || !validMutation(payload)) return Promise.resolve({ accepted: false })
      const exact = Object.freeze({ action: payload.action, provider: payload.provider, source: payload.source })
      const request = { event, document, context: selected }
      const run = mutations.then(async () => {
        if (!currentRequest(request) || !validMutation(payload) || JSON.stringify(exact) !== JSON.stringify({ action: payload.action, provider: payload.provider, source: payload.source })) return { accepted: false }
        confirmation = request
        try {
          await broker.setGrant({ source: SOURCE, provider: exact.provider, enabled: exact.action === 'enable' })
          providerGenerations[exact.provider]++
          return { accepted: true }
        } catch { return { accepted: false } }
        finally { confirmation = null }
      })
      mutations = run.then(() => {}, () => {})
      return run
    },
    /** MAIN ONLY. S2 supplies all identity fields; renderer code cannot.
     * Consent persists for the same identity/vault and is rebound to each new runtime generation. */
    async memorySearchConsent(/** @type {any} */ input) {
      const selected = memoryIdentity(input)
      if (blocked || !selected) return false
      memoryCandidate = selected
      const granted = sameMemoryIdentity(readMemoryConsent(memoryConsentPath), selected)
      memoryAppliedGeneration = granted ? selected.runtimeGeneration : null
      return granted
    },
    /** @param {any} event @param {any} payload @param {...any} extra */
    setMemorySearchConsent(event, payload, ...extra) {
      const document = documentFor(event), selected = context(), candidate = memoryCandidate
      if (extra.length || !document || !selected || blocked || !candidate || !validMemoryMutation(payload) ||
          candidate.serverOrigin !== selected.serverOrigin || candidate.rhythmUserId !== selected.rhythmUserId || candidate.hermesHome !== selected.hermesHome) {
        return Promise.resolve({ accepted: false })
      }
      const request = { event, document, context: selected }
      const requested = Object.freeze({ action: payload.action, capability: MEMORY_CAPABILITY })
      const exact = Object.freeze({ action: requested.action, capability: MEMORY_CAPABILITY,
        access: 'read-only-search', profile: 'default', revocable: true })
      const run = mutations.then(async () => {
        if (!currentRequest(request) || !validMemoryMutation(payload) || payload.action !== requested.action ||
            payload.capability !== requested.capability || memoryCandidate !== candidate) return { accepted: false }
        const confirmed = (await confirmNative(exact, request.document)) === true
        if (!confirmed || !currentRequest(request) || !validMemoryMutation(payload) || payload.action !== requested.action ||
            payload.capability !== requested.capability || memoryCandidate !== candidate) return { accepted: false }
        if (requested.action === 'enable') {
          writeMemoryConsent(memoryConsentPath, storedMemoryIdentity(candidate))
          memoryAppliedGeneration = null
        } else {
          if (bridgeHost) await bridgeHost.revokeScope(MEMORY_CAPABILITY)
          clearMemoryConsent(memoryConsentPath)
          memoryAppliedGeneration = null
        }
        return { accepted: true }
      }).catch(() => ({ accepted: false }))
      mutations = run.then(() => {}, () => {})
      return run
    },
    /** MAIN ONLY. The host creates an attempt before it awaits backendEnv.
     * @param {{attemptId:string,profile:string}} input */
    createBackendAttempt(input) {
      const selected = context()
      const usable = !blocked && selected && input?.profile === 'default' && typeof input.attemptId === 'string' &&
        /^[a-zA-Z0-9_-]{1,256}$/.test(input.attemptId) && !attempts.has(input.attemptId) && !retiredIds.has(input.attemptId) && attempts.size < 128
      const attempt = { identity: key(selected), context: selected, names: /** @type {string[]} */ ([]), generations: { ...providerGenerations },
        accepted: false, terminal: !usable, resolved: false }
      if (usable) attempts.set(input.attemptId, attempt)
      return {
        /** @param {any} request */
        backendEnv: async request => {
          if (blocked || attempt.terminal || attempt.resolved || !selected || !request || typeof request !== 'object' ||
              Object.keys(request).sort().join(',') !== 'authGeneration,hermesHome,profile,rhythmUserId,serverOrigin,source' ||
              key(request) !== attempt.identity || attempt.identity !== key(context())) return {}
          attempt.resolved = true
          attempt.generations = { ...providerGenerations }
          const environment = await broker.resolveBackendEnv(selected)
          if (blocked || attempt.terminal || attempt.accepted || attempt.identity !== key(context())) return {}
          attempt.names = Object.values(NAMES).filter(name => typeof environment[name] === 'string')
          return environment
        },
        /** Synchronous bookkeeping: disposal may await this
         * without waiting behind the broker operation that requested disposal.
         * @param {{phase:string,owned:boolean,acceptedEnvNames:string[]}} result */
        record: result => {
          if (!result || typeof result !== 'object' || Object.keys(result).sort().join(',') !== 'acceptedEnvNames,owned,phase' ||
              !['spawned', 'failed', 'exited'].includes(result.phase) || typeof result.owned !== 'boolean' ||
              !Array.isArray(result.acceptedEnvNames) || result.acceptedEnvNames.length > 4) return false
          if (attempt.terminal || !result.owned) return false
          if (result.phase !== 'spawned') {
            retire(input.attemptId, attempt)
            return true
          }
          if (blocked || attempt.identity !== key(context()) || !result.owned || !attempt.resolved || attempt.accepted ||
              new Set(result.acceptedEnvNames).size !== result.acceptedEnvNames.length ||
              result.acceptedEnvNames.some(name => !attempt.names.includes(name))) return false
          attempt.names = [...result.acceptedEnvNames]
          attempt.accepted = true
          return true
        },
      }
    },
    identityChanged() {
      blocked = true
      const generation = ++transitionGeneration
      const prior = transition ?? Promise.resolve()
      const run = prior.catch(() => {}).then(async () => {
        // Includes a child still starting with a resolved environment. The host
        // must await its in-flight attempts and retirement before resolving.
        if (attempts.size > 0) {
          try { await disposeOwnedBackend({ reason: 'identity-changed' }) }
          catch { throw new Error('Owned backend disposal failed') }
        }
        for (const [id, attempt] of attempts) retire(id, attempt)
        if (bridgeHost) {
          try { await bridgeHost.revokeScope(MEMORY_CAPABILITY) }
          catch { throw new Error('Memory scope revocation failed') }
        }
        clearMemoryConsent(memoryConsentPath)
        memoryCandidate = null
        memoryAppliedGeneration = null
        await broker.identityChanged(context())
        if (generation === transitionGeneration) blocked = false
      })
      transition = run
      void run.finally(() => { if (transition === run) transition = null }).catch(() => {})
      return run
    },
  }
}

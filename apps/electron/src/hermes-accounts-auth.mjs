import { randomUUID } from 'node:crypto'

/** Enrich the existing main safeStorage envelope; this helper owns no files or network.
 * validateSession is the existing host's auth policy (including its offline policy),
 * not a new mandatory network check. No token is exposed in public snapshots.
 * @param {{safeStorage:any,loadEncrypted:()=>Promise<Buffer|null>,saveEncrypted:(bytes:Buffer)=>Promise<void>,clearEncrypted:()=>Promise<void>,validateSession:(session:any)=>Promise<boolean>|boolean}} options
 */
export function createAccountsAuthState(options) {
  const { safeStorage, loadEncrypted, saveEncrypted, clearEncrypted, validateSession } = options
  if (![loadEncrypted, saveEncrypted, clearEncrypted, validateSession].every(fn => typeof fn === 'function')) throw new Error('Invalid Accounts auth configuration')
  let operation = 0
  let documentEpoch = 0
  /** @type {{serverOrigin:string,userId:string,authGeneration:string}|null} */
  let current = null
  let queue = Promise.resolve()
  /** @param {()=>Promise<any>} task */
  const serial = task => { const next = queue.then(task); queue = next.catch(() => {}); return next }
  /** @param {any} session */
  const valid = session => {
    try {
      return session && typeof session.serverOrigin === 'string' && new URL(session.serverOrigin).origin === session.serverOrigin &&
        ['http:', 'https:'].includes(new URL(session.serverOrigin).protocol) && typeof session.userId === 'string' && session.userId.length > 0 && session.userId.length <= 256 &&
        typeof session.sessionToken === 'string' && session.sessionToken.length > 0 && session.sessionToken.length <= 16384
    } catch { return false }
  }
  const encrypted = () => safeStorage?.isEncryptionAvailable?.() === true
  return {
    getSnapshot() { return Object.freeze({ authenticated: current !== null, ...current, documentEpoch }) },
    documentChanged() { documentEpoch++ },
    /** @param {{serverOrigin:string,userId:string,sessionToken:string,envelope?:any}} session */
    signIn(session) {
      const epoch = ++operation
      current = null
      const selected = { ...session }
      return serial(async () => {
        if (!valid(selected) || (await validateSession(selected)) !== true || epoch !== operation) return false
        const authGeneration = randomUUID()
        // The host may supply its complete existing envelope; preserve its
        // user metadata and unrelated fields rather than inventing a second store.
        const envelope = { ...selected.envelope, productionApiBase: selected.serverOrigin,
          sessionToken: selected.sessionToken,
          user: { ...selected.envelope?.user, id: String(selected.envelope?.user?.id ?? '') === selected.userId
            ? selected.envelope.user.id : /^[0-9]+$/.test(selected.userId) && Number.isSafeInteger(Number(selected.userId))
              ? Number(selected.userId) : selected.userId }, rhythmAccountsAuthGeneration: authGeneration }
        if (encrypted()) await saveEncrypted(safeStorage.encryptString(JSON.stringify(envelope)))
        if (epoch !== operation) return false
        current = { serverOrigin: selected.serverOrigin, userId: selected.userId, authGeneration }
        return true
      })
    },
    /** @param {{serverOrigin:string}} requested */
    restore(requested) {
      const epoch = ++operation
      current = null
      const serverOrigin = requested?.serverOrigin
      return serial(async () => {
        try {
          if (!encrypted()) return false
          const bytes = await loadEncrypted()
          if (!Buffer.isBuffer(bytes) || bytes.length > 128 * 1024) return false
          const envelope = JSON.parse(safeStorage.decryptString(bytes))
          const session = { serverOrigin: envelope?.productionApiBase, userId: String(envelope?.user?.id ?? ''), sessionToken: envelope?.sessionToken }
          if (session.serverOrigin !== serverOrigin || !valid(session) || (await validateSession(session)) !== true || epoch !== operation) return false
          const stored = envelope.rhythmAccountsAuthGeneration
          const authGeneration = typeof stored === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(stored) ? stored : randomUUID()
          if (authGeneration !== stored) await saveEncrypted(safeStorage.encryptString(JSON.stringify({ ...envelope, rhythmAccountsAuthGeneration: authGeneration })))
          if (epoch !== operation) return false
          current = { serverOrigin: session.serverOrigin, userId: session.userId, authGeneration }
          return true
        } catch { return false }
      })
    },
    invalidate() {
      ++operation
      current = null
      return serial(async () => { await clearEncrypted() })
    },
  }
}

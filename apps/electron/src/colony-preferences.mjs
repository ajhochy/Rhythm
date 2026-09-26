import { createHash, randomUUID } from 'node:crypto'
import defaultFs from 'node:fs/promises'
import path from 'node:path'

const DEFAULTS = Object.freeze({ v: 1, enabled: false, sources: Object.freeze({}) })

/** @typedef {{enabled:boolean,paths:Record<string,string>}} ColonySourcePreference */
/** @typedef {{v:1,enabled:boolean,sources:Record<string,ColonySourcePreference>}} ColonyPreferences */

function defaults() {
  return /** @type {ColonyPreferences} */ ({ v: 1, enabled: false, sources: {} })
}

function isRecord(/** @type {unknown} */ value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeSource(/** @type {unknown} */ value) {
  if (!isRecord(value)) return null
  const record = /** @type {Record<string,any>} */ (value)
  if (typeof record.enabled !== 'boolean' || !isRecord(record.paths) || Object.values(record.paths).some((entry) => typeof entry !== 'string' || !path.isAbsolute(entry))) return null
  return /** @type {ColonySourcePreference} */ ({ enabled: record.enabled, paths: { ...record.paths } })
}

function normalizePreferences(/** @type {unknown} */ value) {
  if (!isRecord(value)) return null
  const record = /** @type {Record<string,any>} */ (value)
  if (record.v !== 1 || typeof record.enabled !== 'boolean' || !isRecord(record.sources)) return null
  const sources = /** @type {Record<string,ColonySourcePreference>} */ ({})
  for (const [id, source] of Object.entries(record.sources)) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return null
    const normalized = normalizeSource(source)
    if (!normalized) return null
    sources[id] = normalized
  }
  return /** @type {ColonyPreferences} */ ({ v: 1, enabled: record.enabled, sources })
}

function isWithin(/** @type {string} */ parent, /** @type {string} */ candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate))
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

export function profileKeyFor(/** @type {unknown} */ productionApiBase, /** @type {unknown} */ userId) {
  if (typeof productionApiBase !== 'string' || !productionApiBase || typeof userId !== 'string' || !userId) return null
  return createHash('sha256').update(`${productionApiBase}\0${userId}`).digest('hex')
}

export function dataDirFor(/** @type {unknown} */ userDataPath, /** @type {unknown} */ key) {
  if (typeof userDataPath !== 'string' || !path.isAbsolute(userDataPath)) throw new Error('Colony userData path must be absolute')
  if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) throw new Error('Colony profile key is invalid')
  return path.join(userDataPath, 'colony', 'profiles', key, 'state')
}

/** Profile-local Colony preferences. Construction performs no filesystem access. */
export function createColonyPreferences(/** @type {{userDataPath:string,resourcesPath:string,productionApiBase:string,userId?:string,fs?:any}} */ options) {
  const io = options.fs ?? defaultFs
  const key = profileKeyFor(options.productionApiBase, options.userId)
  if (typeof options.userDataPath !== 'string' || !path.isAbsolute(options.userDataPath)) throw new Error('Colony userData path must be absolute')
  if (typeof options.resourcesPath !== 'string' || !path.isAbsolute(options.resourcesPath)) throw new Error('Colony resources path must be absolute')
  if (isWithin(options.resourcesPath, options.userDataPath)) throw new Error('Colony preferences under resourcesPath are refused')
  const profileDir = key ? path.join(options.userDataPath, 'colony', 'profiles', key) : null
  const filePath = profileDir ? path.join(profileDir, 'preferences.json') : null
  let transition = /** @type {Promise<unknown>} */ (Promise.resolve())

  const read = async () => {
    if (!filePath) return defaults()
    try {
      const bytes = await io.readFile(filePath)
      if (bytes.length > 1024 * 1024) return defaults()
      return normalizePreferences(JSON.parse(bytes.toString('utf8'))) ?? defaults()
    } catch {
      return defaults()
    }
  }

  const write = async (/** @type {ColonyPreferences} */ value) => {
    if (!filePath || !profileDir) throw new Error('A signed in profile is required for Colony preferences')
    const normalized = normalizePreferences(value)
    if (!normalized) throw new Error('Invalid Colony preferences')
    await io.mkdir(profileDir, { recursive: true, mode: 0o700 })
    const temporaryPath = `${filePath}.tmp-${randomUUID()}`
    try {
      await io.writeFile(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
      await io.rename(temporaryPath, filePath)
    } catch (error) {
      await io.rm?.(temporaryPath, { force: true }).catch(() => {})
      throw error
    }
    return normalized
  }

  const update = (/** @type {(current:ColonyPreferences) => ColonyPreferences} */ mutate) => {
    const operation = transition.then(async () => write(mutate(await read())))
    transition = operation.catch(() => {})
    return operation
  }

  return Object.freeze({
    key,
    read,
    setEnabled(/** @type {boolean} */ enabled) {
      if (typeof enabled !== 'boolean') return Promise.reject(new Error('Colony enabled must be boolean'))
      return update((current) => ({ ...current, enabled }))
    },
    setSource(/** @type {string} */ id, /** @type {unknown} */ source) {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return Promise.reject(new Error('Invalid Colony source id'))
      const normalized = normalizeSource(source)
      if (!normalized) return Promise.reject(new Error('Colony source paths must be absolute'))
      if (Object.values(normalized.paths).some((entry) => isWithin(options.resourcesPath, entry))) {
        return Promise.reject(new Error('Colony source paths under resourcesPath are refused'))
      }
      return update((current) => ({ ...current, sources: { ...current.sources, [id]: normalized } }))
    },
    dataDir() {
      if (!key) return null
      return dataDirFor(options.userDataPath, key)
    },
  })
}

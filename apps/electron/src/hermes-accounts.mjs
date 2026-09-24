import fs from 'node:fs'
import path from 'node:path'

const MAX_STORE_BYTES = 1024 * 1024
const API_KEY_NAMES = Object.freeze({
  openrouter: 'OPENROUTER_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_API_KEY',
})
const HERMES_AUTH_VERSION = 1
/** @type {Set<string>} */
const ALLOWED_ENV_NAMES = new Set(Object.values(API_KEY_NAMES))

// All paths are derived by Electron main from trusted roots, never from a renderer.
// Do not add any write/normalization behavior to this reader.
/** @param {string} root @param {string} relative @returns {{state:string,text:string}} */
function safeRead(root, relative) {
  let fd
  let foundTarget = false
  try {
    const canonicalRoot = fs.realpathSync(root)
    const rootEntry = fs.lstatSync(root)
    if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink()) return { state: 'unreadable', text: '' }
    const parts = relative.split(path.sep)
    if (!parts.length || parts.some((part) => !part || part === '.' || part === '..')) return { state: 'unreadable', text: '' }
    let current = canonicalRoot
    const components = []
    for (let i = 0; i < parts.length; i++) {
      current = path.join(current, parts[i])
      const entry = fs.lstatSync(current)
      if (entry.isSymbolicLink() || (i < parts.length - 1 && !entry.isDirectory())) return { state: 'unreadable', text: '' }
      if (i === parts.length - 1 && !entry.isFile()) return { state: 'unreadable', text: '' }
      components.push({ path: current, dev: entry.dev, ino: entry.ino })
    }
    foundTarget = true
    const target = path.join(canonicalRoot, ...parts)
    const before = fs.lstatSync(target)
    const uid = process.getuid?.()
    if (!before.isFile() || before.size > MAX_STORE_BYTES || uid === undefined || before.uid !== uid) return { state: 'unreadable', text: '' }
    const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)
    fd = fs.openSync(target, flags)
    const opened = fs.fstatSync(fd)
    if (!opened.isFile() || opened.uid !== uid || opened.size > MAX_STORE_BYTES ||
        opened.dev !== before.dev || opened.ino !== before.ino) return { state: 'unreadable', text: '' }
    // Read at most one byte beyond the cap, even if another process grows the file.
    const buffer = Buffer.allocUnsafe(MAX_STORE_BYTES + 1)
    let count = 0
    while (count < buffer.length) {
      const read = fs.readSync(fd, buffer, count, buffer.length - count, null)
      if (read === 0) break
      count += read
    }
    const afterFd = fs.fstatSync(fd)
    const afterRoot = fs.lstatSync(root)
    if (!afterRoot.isDirectory() || afterRoot.isSymbolicLink() ||
        afterRoot.dev !== rootEntry.dev || afterRoot.ino !== rootEntry.ino ||
        fs.realpathSync(root) !== canonicalRoot) return { state: 'unreadable', text: '' }
    for (const component of components) {
      const entry = fs.lstatSync(component.path)
      if (entry.isSymbolicLink() || entry.dev !== component.dev || entry.ino !== component.ino) return { state: 'unreadable', text: '' }
    }
    const afterPath = fs.lstatSync(target)
    if (!afterPath.isFile() || afterPath.isSymbolicLink() ||
        afterPath.dev !== opened.dev || afterPath.ino !== opened.ino ||
        afterFd.dev !== opened.dev || afterFd.ino !== opened.ino ||
        afterFd.size !== count || count > MAX_STORE_BYTES ||
        afterFd.mtimeMs !== opened.mtimeMs || afterFd.ctimeMs !== opened.ctimeMs) return { state: 'unreadable', text: '' }
    return { state: 'present', text: buffer.toString('utf8', 0, count) }
  } catch (error) {
    return { state: !foundTarget && error instanceof Error && 'code' in error && error.code === 'ENOENT' ? 'absent' : 'unreadable', text: '' }
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

/** @param {string} osHome @returns {{state:string,entries:Record<string,any>|null}} */
function openCodeAuth(osHome) {
  const file = safeRead(osHome, path.join('.local', 'share', 'opencode', 'auth.json'))
  if (file.state !== 'present') return { state: file.state, entries: null }
  try {
    const entries = JSON.parse(file.text)
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return { state: 'malformed', entries: null }
    return { state: 'present', entries }
  } catch { return { state: 'malformed', entries: null } }
}

/** @param {Record<string,any>|null} entries */
function staticEntries(entries) {
  const selected = Object.create(null)
  if (!entries) return selected
  for (const [provider, envName] of Object.entries(API_KEY_NAMES)) {
    const entry = entries[provider]
    if (entry && typeof entry === 'object' && !Array.isArray(entry) &&
        entry.type === 'api' && typeof entry.key === 'string' && entry.key.length > 0 && entry.key.length <= 4096) {
      selected[envName] = entry.key
    }
  }
  return selected
}

/** @param {Record<string,any>|null} entries */
function staticProviderNames(entries) {
  if (!entries) return []
  return /** @type {(keyof typeof API_KEY_NAMES)[]} */ (Object.keys(API_KEY_NAMES)).filter((provider) => {
    const entry = entries[provider]
    return entry && typeof entry === 'object' && !Array.isArray(entry) &&
      entry.type === 'api' && typeof entry.key === 'string' && entry.key.length > 0 && entry.key.length <= 4096
  })
}

/** Main-internal, ephemeral value extraction for later S2 broker use. Never serialize this map to a renderer. */
/** @param {{osHome:string}} roots */
export function extractOpenCodeStaticApiKeys({ osHome }) {
  const auth = openCodeAuth(osHome)
  return { ...staticEntries(auth.entries) }
}

/** @param {string} hermesHome */
function hermesAuthState(hermesHome) {
  const file = safeRead(hermesHome, 'auth.json')
  if (file.state !== 'present') return { state: file.state, providers: [] }
  try {
    const document = JSON.parse(file.text)
    if (!document || typeof document !== 'object' || Array.isArray(document)) return { state: 'malformed', providers: [] }
    // Version is checked before touching the providers object or its entries.
    if (document.version !== HERMES_AUTH_VERSION) return { state: 'unknown', providers: [] }
    if (!document.providers || typeof document.providers !== 'object' || Array.isArray(document.providers)) return { state: 'malformed', providers: [] }
    return { state: 'present', providers: Object.keys(document.providers).filter((name) => Object.hasOwn(API_KEY_NAMES, name)) }
  } catch { return { state: 'malformed', providers: [] } }
}

/** @param {string} hermesHome */
function envNames(hermesHome) {
  const file = safeRead(hermesHome, '.env')
  if (file.state !== 'present') return { state: file.state, names: [] }
  const names = []
  for (const line of file.text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/)
    if (match && ALLOWED_ENV_NAMES.has(match[1])) {
      const value = line.slice(line.indexOf('=') + 1).trim()
      if (value && value !== "''" && value !== '""') names.push(match[1])
    }
  }
  return { state: 'present', names }
}

/** @param {string|undefined} grantsPath */
function grantsState(grantsPath) {
  if (!grantsPath) return 'absent'
  const file = safeRead(path.dirname(grantsPath), path.basename(grantsPath))
  if (file.state !== 'present') return file.state
  try {
    const value = JSON.parse(file.text)
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== 1 || !Array.isArray(value.grants)) return 'malformed'
    // S1 does not apply grants. S2 will validate the full schema before use.
    return 'present'
  } catch { return 'malformed' }
}

/** Value-free readiness observation. `applied` is intentionally unavailable until S2 owns runtime evidence. */
/** @param {{osHome:string,hermesHome:string,grantsPath?:string}} roots */
export function inspectHermesAccounts({ osHome, hermesHome, grantsPath }) {
  const opencode = openCodeAuth(osHome)
  const hermesAuth = hermesAuthState(hermesHome)
  const env = envNames(hermesHome)
  const staticNames = staticProviderNames(opencode.entries).map((provider) => API_KEY_NAMES[provider])
  const providers = Object.fromEntries(Object.entries(API_KEY_NAMES).map(([provider, name]) => [provider, {
    state: env.names.includes(name) && staticNames.includes(name) ? 'shadowed' :
      env.names.includes(name) ? 'configured' :
        hermesAuth.providers.includes(provider) ? 'present' :
        staticNames.includes(name) ? 'configured' : 'absent',
  }]))
  return {
    sources: {
      opencode: { state: opencode.state },
      hermesAuth: { state: hermesAuth.state },
      hermesEnv: { state: env.state },
      grants: { state: grantsState(grantsPath) },
    },
    providers,
    claudeCode: { keychainService: 'Claude Code-credentials', refreshGuarantee: 'not-race-free', state: 'unknown' },
  }
}

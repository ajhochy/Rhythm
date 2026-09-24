import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const LIMIT_MANIFEST = 1024 * 1024
const LIMIT_ENTRIES = 20000
const LIMIT_BYTES = 1024 * 1024 * 1024
const REQUIRED = ['renderer', 'host', 'preload']
const SHA = /^[0-9a-f]{40}$/i
const SRI = /^sha256-[A-Za-z0-9+/]{43}=$/
/** @param {string} reason */
const error = (reason) => new Error(`Colony artifact ${reason}. Rebuild the pinned Colony artifact.`)

/** @param {string} root @param {unknown} entry */
function safePath(root, entry) {
  if (typeof entry !== 'string' || !entry || isAbsolute(entry) || entry.includes('\\') || entry.includes('\0') || entry.split('/').some((part) => !part || part === '.' || part === '..') || /^[A-Za-z]:/.test(entry)) throw error(`path is invalid or escapes root: ${String(entry)}`)
  const target = resolve(root, entry)
  if (!relative(root, target) || relative(root, target).startsWith(`..${sep}`)) throw error(`path escapes root: ${entry}`)
  return target
}

/** @param {string} source @returns {Record<string, any>} */
function parseJsonNoDuplicates(source) {
  let i = 0
  let depth = 0
  const ws = () => { while (/\s/.test(source[i] ?? '')) i++ }
  const str = () => {
    const start = i++
    let escape = false
    while (i < source.length) {
      const char = source[i++]
      if (char === '"' && !escape) return JSON.parse(source.slice(start, i))
      if (char === '\\' && !escape) escape = true
      else escape = false
    }
    throw error('manifest JSON is invalid')
  }
  const value = () => {
    if (++depth > 64) throw error('manifest JSON is too deeply nested')
    ws()
    if (source[i] === '"') str()
    else if (source[i] === '{') {
      i++
      const keys = new Set()
      ws()
      while (source[i] !== '}') {
        if (source[i] !== '"') throw error('manifest JSON is invalid')
        const key = str()
        if (keys.has(key)) throw error(`manifest contains duplicate JSON key: ${key}`)
        keys.add(key)
        ws()
        if (source[i++] !== ':') throw error('manifest JSON is invalid')
        value()
        ws()
        if (source[i] === '}') break
        if (source[i++] !== ',') throw error('manifest JSON is invalid')
        ws()
      }
      i++
    } else if (source[i] === '[') {
      i++
      ws()
      while (source[i] !== ']') {
        value()
        ws()
        if (source[i] === ']') break
        if (source[i++] !== ',') throw error('manifest JSON is invalid')
      }
      i++
    } else {
      const start = i
      while (i < source.length && !/[\s,}\]]/.test(source[i])) i++
      if (i === start) throw error('manifest JSON is invalid')
    }
    depth--
  }
  value()
  ws()
  if (i !== source.length) throw error('manifest JSON is invalid')
  return JSON.parse(source)
}

/** @param {unknown} artifactRoot */
async function rootPath(artifactRoot) {
  if (typeof artifactRoot !== 'string' || !isAbsolute(artifactRoot)) throw error('root path must be absolute; set RHYTHM_COLONY_ARTIFACT_DIR')
  const root = resolve(artifactRoot)
  let info
  try { info = await lstat(root) } catch (cause) {
    if (/** @type {NodeJS.ErrnoException} */ (cause).code === 'ENOENT') throw error(`is missing at ${root}`)
    throw cause
  }
  if (info.isSymbolicLink()) throw error('root is a symlink')
  if (!info.isDirectory()) throw error('root is not a directory')
  return root
}

/** @param {string} root */
async function readManifest(root) {
  const target = join(root, 'manifest.json')
  let handle
  try {
    const info = await lstat(target)
    if (info.isSymbolicLink()) throw error('manifest is a symlink')
    if (!info.isFile()) throw error('manifest is not a regular file')
    if (info.size > LIMIT_MANIFEST) throw error('manifest is oversized')
    handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const current = await handle.stat()
    if (!current.isFile() || current.size > LIMIT_MANIFEST) throw error('manifest is invalid or oversized')
    const buffer = Buffer.alloc(current.size)
    const result = await handle.read(buffer, 0, buffer.length, 0)
    if (result.bytesRead !== buffer.length) throw error('manifest changed during reading')
    return parseJsonNoDuplicates(buffer.toString('utf8'))
  } catch (cause) {
    if (/** @type {NodeJS.ErrnoException} */ (cause).code === 'ENOENT') throw error('manifest is missing')
    if (cause instanceof Error && cause.message.startsWith('Colony artifact')) throw cause
    throw error(`manifest is unreadable or invalid: ${cause instanceof Error ? cause.message : String(cause)}`)
  } finally { await handle?.close() }
}

/** @param {Record<string, any>} manifest @param {number} expectedElectronMajor @param {string} expectedSourceCommit @param {boolean} allowDirty */
function checkManifest(manifest, expectedElectronMajor, expectedSourceCommit, allowDirty) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw error('manifest must be an object')
  if (manifest.schemaVersion !== 1) throw error(`schema version is unsupported: ${String(manifest.schemaVersion)}`)
  if (manifest.product !== 'colony') throw error(`product must be colony: ${String(manifest.product)}`)
  if (typeof manifest.sourceCommit !== 'string' || !SHA.test(manifest.sourceCommit)) throw error('source commit must be a full 40-hex SHA')
  if (typeof expectedSourceCommit !== 'string' || !SHA.test(expectedSourceCommit)) throw error('expected source commit pin must be a full 40-hex SHA')
  if (manifest.sourceCommit !== expectedSourceCommit) throw error('source commit differs from pinned expected commit')
  if (!Number.isInteger(expectedElectronMajor) || manifest.electronMajor !== expectedElectronMajor) throw error(`Electron major mismatch; expected ${expectedElectronMajor}, found ${String(manifest.electronMajor)}`)
  for (const key of ['dirty', 'sourceDirty']) {
    if (manifest[key] !== undefined && typeof manifest[key] !== 'boolean') throw error(`${key} must be boolean`)
    if (manifest[key] && allowDirty !== true) throw error(`${key} source is dirty; clean the source or explicitly enable allowDirty for local development`)
  }
  if (!manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) throw error('manifest files map is invalid')
  if (!manifest.integrity || typeof manifest.integrity !== 'object' || Array.isArray(manifest.integrity) || !Object.keys(manifest.integrity).length) throw error('integrity metadata is empty or missing')
}

/** @param {string} root */
async function treeFiles(root) {
  const result = new Map()
  const pending = [root]
  let count = 0
  let bytes = 0
  while (pending.length) {
    const directory = pending.pop()
    if (!directory) break
    for (const entry of await readdir(directory)) {
      if (++count > LIMIT_ENTRIES) throw error('artifact tree exceeds entry limit')
      const target = join(directory, entry)
      const rel = relative(root, target).split(sep).join('/')
      const info = await lstat(target)
      if (info.isSymbolicLink()) throw error(`contains symlink: ${rel}`)
      if (info.isDirectory()) pending.push(target)
      else if (info.isFile()) {
        bytes += info.size
        if (bytes > LIMIT_BYTES) throw error('artifact tree exceeds byte limit')
        result.set(rel, info)
      } else throw error(`contains non-regular unsupported entry: ${rel}`)
    }
  }
  return result
}

/** @param {string} target @param {import("node:fs").Stats} previous */
async function digest(target, previous) {
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const before = await handle.stat()
    if (!before.isFile() || before.ino !== previous.ino || before.dev !== previous.dev || before.size !== previous.size) throw error(`file changed during verification: ${target}`)
    const hash = createHash('sha256')
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk)
    const after = await handle.stat()
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw error(`file changed during verification: ${target}`)
    return `sha256-${hash.digest('base64')}`
  } finally { await handle.close() }
}

/** @param {string} root @param {Record<string, any>} manifest @param {boolean} reseal */
async function verify(root, manifest, reseal = false) {
  const tree = await treeFiles(root)
  for (const entry of Object.values(manifest.files)) {
    safePath(root, entry)
    if (entry === 'manifest.json' || !tree.has(entry)) throw error(`declared file entry is missing or unverified: ${String(entry)}`)
    if (!reseal && !Object.hasOwn(manifest.integrity, entry)) throw error(`integrity is missing declared file entry: ${String(entry)}`)
  }
  /** @type {Record<string, string>} */
  const seals = {}
  if (reseal) for (const [entry, previous] of Object.entries(manifest.integrity)) {
    safePath(root, entry)
    if (entry === 'manifest.json' || !tree.has(entry) || typeof previous !== 'string' || !SRI.test(previous)) throw error(`integrity metadata is invalid for reseal: ${entry}`)
  }
  if (!reseal) for (const [entry, expected] of Object.entries(manifest.integrity)) {
    const target = safePath(root, entry)
    if (entry === 'manifest.json') throw error('integrity includes manifest.json')
    if (typeof expected !== 'string' || !SRI.test(expected) || Buffer.from(expected.slice(7), 'base64').length !== 32) throw error(`integrity SRI is invalid for ${entry}`)
    const info = tree.get(entry)
    if (!info) throw error(`integrity entry is missing or not a regular file: ${entry}`)
    if (await digest(target, info) !== expected) throw error(`integrity check failed for ${entry}`)
  }
  for (const [entry, info] of tree) {
    if (entry === 'manifest.json') continue
    if (reseal) seals[entry] = await digest(safePath(root, entry), info)
    else if (!Object.hasOwn(manifest.integrity, entry)) throw error(`unverified file is missing from integrity: ${entry}`)
  }
  /** @type {Record<string, string>} */
  const paths = {}
  for (const key of REQUIRED) {
    const entry = manifest.files[key]
    if (typeof entry !== 'string' || !entry) throw error(`manifest is missing required ${key} entry`)
    paths[key] = safePath(root, entry)
    if (!tree.has(entry)) throw error(`required ${key} entry is missing or not a regular file`)
    if (!reseal && !Object.hasOwn(manifest.integrity, entry)) throw error(`integrity is missing required ${key} entry`)
  }
  return { paths, seals }
}

/** @param {{artifactRoot: string, expectedElectronMajor: number, expectedSourceCommit: string, allowDirty?: boolean}} options */
export async function resolveColonyArtifact({ artifactRoot, expectedElectronMajor, expectedSourceCommit, allowDirty = false }) {
  const root = await rootPath(artifactRoot)
  const manifest = await readManifest(root)
  checkManifest(manifest, expectedElectronMajor, expectedSourceCommit, allowDirty)
  const { paths } = await verify(root, manifest)
  return Object.freeze({ root, manifest: Object.freeze(manifest), rendererPath: paths.renderer, hostPath: paths.host, preloadPath: paths.preload, rendererUrl: `${pathToFileURL(paths.renderer).href}?embedded=1` })
}

/** @param {{artifactRoot: string}} options */
export async function refreshColonyArtifactIntegrity({ artifactRoot }) {
  const root = await rootPath(artifactRoot)
  const manifest = await readManifest(root)
  checkManifest(manifest, manifest?.electronMajor, manifest?.sourceCommit, true)
  const { seals } = await verify(root, manifest, true)
  const temp = join(root, `.manifest-${process.pid}-${createHash('sha256').update(String(Math.random())).digest('hex')}.tmp`)
  try {
    await writeFile(temp, `${JSON.stringify({ ...manifest, integrity: seals }, null, 2)}\n`, { flag: 'wx', mode: 0o644 })
    await rename(temp, join(root, 'manifest.json'))
  } finally { await rm(temp, { force: true }) }
}

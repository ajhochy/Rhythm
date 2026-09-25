import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, lstat, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { resolveColonyArtifact } from './colony-desktop-artifact.mjs'
import { validateColonyRequest, validateColonyResponse } from './colony-channel.mjs'

/** @param {{isPackaged:boolean,resourcesPath:string,developmentNodePath?:string}} options */
export async function resolveColonyNode({ isPackaged, resourcesPath, developmentNodePath }) {
  const target = isPackaged ? path.join(resourcesPath, 'node/bin/node') : developmentNodePath
  if (!target || !path.isAbsolute(target)) throw new Error('Colony requires an explicit absolute Node runtime')
  let info
  try { info = await lstat(target) } catch { throw new Error('Colony packaged Node runtime is missing') }
  if (info.isSymbolicLink()) throw new Error('Colony Node runtime must not be a symlink')
  if (!info.isFile()) throw new Error('Colony Node runtime must be a regular executable')
  await access(target, constants.X_OK)
  return target
}

/** @param {any} sources */
function validateSources(sources) {
  const fields = /** @type {Record<string,string[]>} */ ({ hermes:['home'], codex:['home'], rhythm:['database'], opencode:['database'], kilocode:['database'], 'claude-code':['home','desktopSessions'], cursor:['projects'], antigravity:['home'] })
  if (!Array.isArray(sources) || sources.length > 8 || Buffer.byteLength(JSON.stringify(sources)) > 32 * 1024) throw new Error('Invalid Colony source configuration')
  const seen = new Set()
  for (const source of sources) {
    if (!source || !Object.hasOwn(fields, source.id) || seen.has(source.id) || typeof source.enabled !== 'boolean' ||
      Object.keys(source).some(key => !['id','enabled','paths'].includes(key))) throw new Error('Invalid Colony source configuration')
    seen.add(source.id)
    const keys = fields[source.id]
    if (source.paths !== undefined && (!source.paths || typeof source.paths !== 'object' || Array.isArray(source.paths) ||
      Object.entries(source.paths).some(([key,value]) => !keys.includes(key) || typeof value !== 'string' || value.includes('\0') || !path.isAbsolute(value)))) throw new Error('Invalid Colony source paths')
    if (source.enabled && keys.some(key => !source.paths?.[key])) throw new Error('Enabled Colony source requires explicit paths')
  }
}

/** Own exactly one private worker; never reclaim ports or signal a discovered PID.
 * @param {any} options */
export function createColonyService(options) {
  let child = /** @type {import('node:child_process').ChildProcess | null} */ (null)
  let launch = /** @type {Promise<any> | null} */ (null)
  let stopping = /** @type {Promise<void> | null} */ (null)
  let blocked = /** @type {Error | null} */ (null)
  let ready = false
  let disposed = false
  let attempts = 0
  let documentId = ''
  let reason = ''
  const pending = new Map()
  const status = () => ({ state: ready ? 'ready' : blocked ? 'failed' : child ? 'starting' : 'unavailable', pid: child?.pid ?? null, reason,
    capabilities: ready ? ['inventory-v1', 'state-v1'] : [] })
  const revoke = () => {
    ready = false
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(Object.assign(new Error('Colony document revoked'), { code: 'revoked' })) }
    pending.clear()
  }
  const stop = () => {
    revoke()
    if (stopping) return stopping
    if (blocked) return Promise.reject(blocked)
    const owned = child
    if (!owned) return Promise.resolve()
    stopping = new Promise((resolve, reject) => {
      const duration = options.stopTimeoutMs ?? 2000
      const timers = /** @type {ReturnType<typeof setTimeout>[]} */ ([])
      const cleanup = () => timers.forEach(clearTimeout)
      owned.once('exit', () => { cleanup(); if (child === owned) child = null; resolve(undefined) })
      if (owned.exitCode !== null || owned.signalCode !== null) { child = null; resolve(undefined); return }
      try { if (owned.connected) owned.send({ type: 'colony:dispose', v: 1, documentId }) } catch {}
      timers.push(setTimeout(() => { if (owned.exitCode === null && owned.signalCode === null) owned.kill('SIGTERM') }, duration))
      timers.push(setTimeout(() => { if (owned.exitCode === null && owned.signalCode === null) owned.kill('SIGKILL') }, duration * 2))
      timers.push(setTimeout(() => {
        blocked = new Error('Colony child exit could not be confirmed; replacement is blocked')
        reason = blocked.message
        reject(blocked)
      }, duration * 3))
    }).finally(() => { stopping = null })
    return stopping
  }
  const start = (/** @type {{documentId:string}} */ value) => {
    if (blocked) return Promise.reject(blocked)
    if (disposed) return Promise.reject(new Error('Colony service disposed'))
    if (!options.enabled?.()) return Promise.reject(new Error('Colony is disabled'))
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(value?.documentId || '')) return Promise.reject(new Error('Invalid Colony document'))
    if ((launch || ready) && documentId !== value.documentId) return Promise.reject(new Error('Colony document requires confirmed stop before replacement'))
    if (launch) return launch
    if (ready) return Promise.resolve(status())
    if (stopping || child) return Promise.reject(new Error('Colony previous child has not exited'))
    if (attempts >= 1 + (options.maxRestarts ?? 2)) return Promise.reject(new Error('Colony retry limit exhausted'))
    documentId = value.documentId
    attempts++
    launch = (async () => {
      try {
        validateSources(options.sources)
        const artifact = await resolveColonyArtifact(options)
        const executable = await resolveColonyNode(options)
        if (disposed || !options.enabled()) throw new Error('Colony disabled during startup')
        if (!path.isAbsolute(options.dataDir) || options.dataDir === artifact.root || options.dataDir.startsWith(artifact.root + path.sep)) throw new Error('Colony requires an independent absolute profile directory')
        const home = path.join(options.dataDir, 'runtime-home')
        const tmp = path.join(options.dataDir, 'runtime-tmp')
        await mkdir(home, { recursive: true }); await mkdir(tmp, { recursive: true })
        if (disposed || !options.enabled()) throw new Error('Colony disabled during startup')
        const owned = (options.spawnChild ?? spawn)(executable, [artifact.workerPath], {
          shell: false, detached: false, cwd: options.dataDir,
          env: { HOME: home, TMPDIR: tmp, PATH: '', LANG: 'en_US.UTF-8' },
          stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        })
        child = owned
        owned.stderr?.resume() // Never forward source paths or arbitrary stderr into the scene.
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Colony startup deadline exceeded')), options.startupTimeoutMs ?? 8000)
          const fail = (/** @type {Error} */ error) => { clearTimeout(timer); reject(error) }
          owned.once('error', fail)
          owned.once('exit', () => {
            if (child === owned) { child = null; revoke(); reason = 'Colony worker exited' }
            fail(new Error('Colony worker exited before readiness'))
          })
          owned.on('message', (/** @type {any} */ message) => {
            if (child !== owned) return
            if (!ready) {
              const runtime = message?.runtime
              const match = typeof runtime?.node === 'string' && /^(\d{1,3})\.(\d{1,3})\.(\d{1,6})$/.exec(runtime.node)
              const nodeOkay = match && (Number(match[1]) > 22 || (Number(match[1]) === 22 && Number(match[2]) >= 13))
              if (Buffer.byteLength(JSON.stringify(message)) > 64 * 1024 || message?.type !== 'colony:ready' || message.v !== 1 || message.product !== 'colony' || message.documentId !== documentId ||
                !Array.isArray(message.capabilities) || message.capabilities.length !== 2 || !message.capabilities.includes('inventory-v1') || !message.capabilities.includes('state-v1') ||
                !runtime || Object.keys(runtime).length !== 2 || !nodeOkay || runtime.sqlite !== true || Object.keys(message).length !== 6) {
                fail(new Error('Colony runtime version/capability handshake failed')); return
              }
              clearTimeout(timer)
              ready = true; reason = ''
              resolve(undefined)
            } else {
              try {
                validateColonyResponse(message, documentId)
                const entry = pending.get(message.id)
                if (!entry) throw new Error('Unexpected Colony response')
                pending.delete(message.id); clearTimeout(entry.timer); entry.resolve(message)
              } catch { reason = 'Colony worker protocol refused'; void stop().catch(() => {}) }
            }
          })
          owned.send({ type: 'colony:init', v: 1, documentId, dataDir: options.dataDir, sources: options.sources })
        })
        if (disposed || !options.enabled()) throw new Error('Colony disabled during startup')
        return status()
      } catch (error) {
        reason = error instanceof Error ? error.message : 'Colony unavailable'
        await stop()
        throw error
      }
    })().finally(() => { launch = null })
    return launch
  }
  return {
    start, stop, status,
    async request(/** @type {any} */ message) {
      if (!ready || !child || disposed) throw Object.assign(new Error('Colony document revoked'), { code: 'revoked' })
      validateColonyRequest(message, documentId)
      if (pending.has(message.id) || pending.size >= 32) throw new Error('Colony request limit or duplicate request')
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { void stop().catch(() => {}) }, 60000)
        pending.set(message.id, { resolve, reject, timer })
        try { child?.send(message) } catch { void stop().catch(() => {}) }
      })
    },
    async dispose() { disposed = true; await stop(); await launch?.catch(() => {}); await stop() },
  }
}

import path from 'node:path'
import { createColonyPreferences } from './colony-preferences.mjs'
import { discover, toServiceSources } from './colony-sources.mjs'
import { registerColonyView } from './colony-view.mjs'

const SOURCE_COMMIT = 'a30b4c924be4344d444f1826e1dec88fb138a4ad'
const CHANNELS = ['colony:host:status', 'colony:host:discover', 'colony:host:set-enabled', 'colony:host:set-source']

export function resolveColonyRuntimeConfig(/** @type {any} */ { isPackaged, resourcesPath, environment }) {
  if (isPackaged) return {
    artifactRoot: path.join(resourcesPath, 'colony-desktop'),
    nodePath: path.join(resourcesPath, 'node', 'bin', 'node'),
  }
  const artifactRoot = environment?.RHYTHM_COLONY_ARTIFACT_DIR
  const nodePath = environment?.RHYTHM_COLONY_NODE
  if (!artifactRoot || !nodePath || !path.isAbsolute(artifactRoot) || !path.isAbsolute(nodePath)) {
    throw new Error('Development Bot Crossing requires absolute RHYTHM_COLONY_ARTIFACT_DIR and RHYTHM_COLONY_NODE')
  }
  return { artifactRoot, nodePath }
}

/** Main-process owner for profile settings, discovery and the native view. */
export function registerColonyHost(/** @type {any} */ options) {
  const authorize = options.ownsHost ?? ((/** @type {any} */ event) => {
    const win = options.getWindow()
    return Boolean(win && !win.isDestroyed() && event?.sender === win.webContents && event.senderFrame === win.webContents.mainFrame &&
      /^rhythm:\/\/app\/index\.html#\/colony(?:\?.*)?$/.test(event.senderFrame.url))
  })
  let runtime = /** @type {any} */ (undefined)
  let runtimeError = ''
  try { runtime = resolveColonyRuntimeConfig(options) } catch (error) { runtimeError = error instanceof Error ? error.message : 'Bot Crossing runtime unavailable' }
  let store = /** @type {any} */ (null)
  let snapshot = /** @type {any} */ ({ v: 1, enabled: false, sources: {} })
  let discovered = /** @type {any[] | null} */ (null)
  let transition = /** @type {Promise<any>} */ (Promise.resolve())
  let profileRevoked = true
  let disposed = false

  const requireHost = (/** @type {any} */ event) => {
    if (!authorize(event)) throw new Error('Bot Crossing IPC denied')
  }
  const publicSources = () => profileRevoked ? [] : Object.entries(snapshot.sources).map(([id, source]) => ({ id, enabled: source.enabled === true }))
  const status = () => ({ v: 1, available: !runtimeError, enabled: Boolean(!profileRevoked && store && snapshot.enabled), sources: publicSources(), ...(runtimeError ? { reason: runtimeError } : {}) })
  const profileOperation = (/** @type {() => any} */ work) => {
    const operation = transition.then(work)
    transition = operation.catch(() => {})
    return operation
  }
  const view = (options.registerView ?? registerColonyView)({
    ...options,
    isPackaged: Boolean(options.isPackaged),
    resourcesPath: options.resourcesPath,
    developmentNodePath: runtime?.nodePath,
    getArtifactRoot: () => {
      if (!runtime) throw new Error(runtimeError)
      return runtime.artifactRoot
    },
    getDataDir: () => store?.dataDir(),
    getSources: () => toServiceSources(snapshot),
    enabled: () => Boolean(!disposed && !profileRevoked && store && snapshot.enabled),
    expectedSourceCommit: SOURCE_COMMIT,
    expectedElectronMajor: 40,
  })

  const ensureDiscovery = async () => (discovered ??= await discover({ home: options.home, fs: options.fs }))
  const handlers = /** @type {Record<string,(event:any,...args:any[])=>any>} */ ({
    'colony:host:status': async (event, ...args) => { requireHost(event); if (args.length) throw new Error('Invalid Bot Crossing payload'); return status() },
    'colony:host:discover': async (event, ...args) => {
      requireHost(event); if (args.length) throw new Error('Invalid Bot Crossing payload')
      const choices = await ensureDiscovery()
      return choices.map(({ id, state }) => ({ id, state, enabled: snapshot.sources[id]?.enabled === true }))
    },
    'colony:host:set-enabled': async (event, enabled, ...args) => {
      requireHost(event); if (args.length || typeof enabled !== 'boolean' || profileRevoked || !store) throw new Error('Invalid Bot Crossing enablement')
      return profileOperation(async () => {
        if (profileRevoked || !store) throw new Error('Bot Crossing profile was revoked')
        snapshot = await store.setEnabled(enabled)
        if (!enabled) await view.disposeCurrent()
        return status()
      })
    },
    'colony:host:set-source': async (event, value, ...args) => {
      requireHost(event)
      if (args.length || !value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2 ||
        typeof value.id !== 'string' || typeof value.enabled !== 'boolean' || profileRevoked || !store) throw new Error('Invalid Bot Crossing source setting')
      return profileOperation(async () => {
        if (profileRevoked || !store) throw new Error('Bot Crossing profile was revoked')
        const source = (await ensureDiscovery()).find(({ id }) => id === value.id)
        if (!source) throw new Error('Unknown Bot Crossing source')
        const next = { enabled: value.enabled, paths: source.paths }
        await store.setSource(value.id, next)
        snapshot = { ...snapshot, sources: { ...snapshot.sources, [value.id]: next } }
        await view.disposeCurrent()
        return status()
      })
    },
  })
  for (const [channel, handler] of Object.entries(handlers)) options.ipcMain.handle(channel, handler)

  return Object.freeze({
    async activateProfile(/** @type {any} */ identity) {
      return profileOperation(async () => {
        await view.disposeCurrent()
        store = createColonyPreferences({ userDataPath: options.userDataPath, resourcesPath: options.resourcesPath,
          productionApiBase: identity?.productionApiBase, userId: identity?.userId })
        snapshot = await store.read()
        discovered = null
        profileRevoked = !store.key
        return status()
      })
    },
    async invalidateProfile() {
      profileRevoked = true
      return profileOperation(async () => {
        snapshot = { v: 1, enabled: false, sources: {} }
        store = null
        discovered = null
        await view.disposeCurrent()
      })
    },
    async dispose() {
      disposed = true
      profileRevoked = true
      for (const channel of CHANNELS) options.ipcMain.removeHandler?.(channel)
      return profileOperation(async () => {
        snapshot = { v: 1, enabled: false, sources: {} }
        store = null
        discovered = null
        await view.dispose()
      })
    },
    status,
  })
}

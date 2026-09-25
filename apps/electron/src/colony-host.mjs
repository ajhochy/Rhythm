import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createColonyActions } from './colony-actions.mjs'
import { EXPECTED_COLONY_ELECTRON_MAJOR, PINNED_COLONY_SOURCE_COMMIT } from './colony-desktop-config.mjs'
import { createColonyPreferences } from './colony-preferences.mjs'
import { createColonyService } from './colony-service.mjs'
import { discover, toServiceSources } from './colony-sources.mjs'
import { registerColonyView } from './colony-view.mjs'

const CHANNELS = ['colony:host:status', 'colony:host:discover', 'colony:host:set-enabled', 'colony:host:set-source', 'colony:inventory:page', 'colony:inventory:cancel', 'colony:action:run', 'colony:import:preview', 'colony:import:commit']
const PRIVATE_INVENTORY_FIELDS = new Set(['ref', 'command', 'appCommand', 'terminalCommand'])

/** Clone a worker DTO while retaining launch authority only in main. @param {any} value @returns {any} */
function publicInventoryValue(value) {
  if (Array.isArray(value)) return value.map(publicInventoryValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([key]) => !PRIVATE_INVENTORY_FIELDS.has(key)).map(([key, entry]) => [key, publicInventoryValue(entry)]))
}

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
  const ownsRoute = (/** @type {any} */ event, /** @type {string} */ route) => {
    const win = options.getWindow()
    return Boolean(win && !win.isDestroyed() && event?.sender === win.webContents && event.senderFrame === win.webContents.mainFrame &&
      new RegExp(`^rhythm:\\/\\/app\\/index\\.html#\\/${route}(?:\\?.*)?$`).test(event.senderFrame.url))
  }
  const authorizeColony = options.ownsHost ?? ((/** @type {any} */ event) => ownsRoute(event, 'colony'))
  const authorizeSettings = options.ownsSettingsHost ?? ((/** @type {any} */ event) => ownsRoute(event, 'settings'))
  let runtime = /** @type {any} */ (undefined)
  let runtimeError = ''
  try { runtime = resolveColonyRuntimeConfig(options) } catch (error) { runtimeError = error instanceof Error ? error.message : 'Bot Crossing runtime unavailable' }
  let store = /** @type {any} */ (null)
  let snapshot = /** @type {any} */ ({ v: 1, enabled: false, sources: {} })
  let discovered = /** @type {any[] | null} */ (null)
  let transition = /** @type {Promise<any>} */ (Promise.resolve())
  let profileRevoked = true
  let disposed = false
  let profileEpoch = 0
  let hostSerial = 0
  let activeInventoryGeneration = ''
  let activeAttachment = ''
  let importSession = /** @type {any} */ (null)
  let pendingImportPath = ''
  const refsByGeneration = new Map()

  const requireHost = (/** @type {any} */ event, /** @type {boolean} */ allowSettings = false) => {
    if (!authorizeColony(event) && !(allowSettings && authorizeSettings(event))) throw new Error('Bot Crossing IPC denied')
  }
  const publicSources = () => profileRevoked ? [] : Object.entries(snapshot.sources).map(([id, source]) => ({ id, enabled: source.enabled === true }))
  const status = () => ({ v: 1, available: !runtimeError, enabled: Boolean(!profileRevoked && store && snapshot.enabled), sources: publicSources(), ...(runtimeError ? { reason: runtimeError } : {}) })
  const profileOperation = (/** @type {() => any} */ work) => {
    const operation = transition.then(work)
    transition = operation.catch(() => {})
    return operation
  }
  const resetInventory = () => { profileEpoch++; activeInventoryGeneration = ''; activeAttachment = ''; refsByGeneration.clear() }
  const disposeImport = async () => {
    const current = importSession
    importSession = null
    await current?.service?.dispose()
  }
  const ownsThreadId = (/** @type {string} */ threadId) => refsByGeneration.get(activeInventoryGeneration)?.has(threadId) === true
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
    onDispose: resetInventory,
    ownsThreadId,
    expectedSourceCommit: PINNED_COLONY_SOURCE_COMMIT,
    expectedElectronMajor: EXPECTED_COLONY_ELECTRON_MAJOR,
  })
  const actions = createColonyActions({
    fs: options.actionFs,
    app: options.app,
    shell: options.shell,
    clipboard: options.clipboard,
    currentGeneration: () => activeInventoryGeneration,
    resolveRecord: (/** @type {string} */ id, /** @type {string} */ generation) => refsByGeneration.get(generation)?.get(id),
    requestState: async (/** @type {string} */ method, /** @type {any} */ payload) => {
      if (!activeAttachment || view.currentAttachment?.() !== activeAttachment) throw new Error('Bot Crossing inventory document is unavailable')
      hostSerial = hostSerial >= 999999999 ? 1 : hostSerial + 1
      return view.requestHost({ attachment: activeAttachment, id: `host-${hostSerial}`, method, payload })
    },
  })
  const ensureImport = async () => {
    if (importSession) return importSession
    if (!runtime || profileRevoked || !store || !snapshot.enabled) throw new Error('Enable Bot Crossing for this profile before importing.')
    await view.disposeCurrent()
    resetInventory()
    const config = {
      isPackaged: Boolean(options.isPackaged), resourcesPath: options.resourcesPath, developmentNodePath: runtime.nodePath,
      artifactRoot: runtime.artifactRoot, expectedSourceCommit: PINNED_COLONY_SOURCE_COMMIT, expectedElectronMajor: EXPECTED_COLONY_ELECTRON_MAJOR,
      dataDir: store.dataDir(), sources: toServiceSources(snapshot).map((source) => ({ ...source, enabled: false })), enabled: () => !disposed && !profileRevoked && Boolean(store),
    }
    const service = (options.createImportService ?? createColonyService)(config)
    const documentId = randomUUID()
    await service.start({ documentId })
    importSession = { service }
    return importSession
  }

  const ensureDiscovery = async () => (discovered ??= await discover({ home: options.home, fs: options.fs }))
  const handlers = /** @type {Record<string,(event:any,...args:any[])=>any>} */ ({
    'colony:host:status': async (event, ...args) => { requireHost(event, true); if (args.length) throw new Error('Invalid Bot Crossing payload'); return status() },
    'colony:host:discover': async (event, ...args) => {
      requireHost(event, true); if (args.length) throw new Error('Invalid Bot Crossing payload')
      const choices = await ensureDiscovery()
      return choices.map(({ id, state }) => ({ id, state, enabled: snapshot.sources[id]?.enabled === true }))
    },
    'colony:host:set-enabled': async (event, enabled, ...args) => {
      requireHost(event, true); if (args.length || typeof enabled !== 'boolean' || profileRevoked || !store) throw new Error('Invalid Bot Crossing enablement')
      return profileOperation(async () => {
        if (profileRevoked || !store) throw new Error('Bot Crossing profile was revoked')
        snapshot = await store.setEnabled(enabled)
        if (!enabled) { resetInventory(); pendingImportPath = ''; await Promise.all([view.disposeCurrent(), disposeImport()]) }
        return status()
      })
    },
    'colony:host:set-source': async (event, value, ...args) => {
      requireHost(event, true)
      if (args.length || !value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2 ||
        typeof value.id !== 'string' || typeof value.enabled !== 'boolean' || profileRevoked || !store) throw new Error('Invalid Bot Crossing source setting')
      return profileOperation(async () => {
        if (profileRevoked || !store) throw new Error('Bot Crossing profile was revoked')
        const source = (await ensureDiscovery()).find(({ id }) => id === value.id)
        if (!source) throw new Error('Unknown Bot Crossing source')
        const next = { enabled: value.enabled, paths: source.paths }
        await store.setSource(value.id, next)
        snapshot = { ...snapshot, sources: { ...snapshot.sources, [value.id]: next } }
        resetInventory()
        pendingImportPath = ''
        await Promise.all([view.disposeCurrent(), disposeImport()])
        return status()
      })
    },
    'colony:inventory:page': async (event, value, ...args) => {
      requireHost(event)
      const page = value?.page
      if (args.length || !snapshot.enabled || !value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2 ||
        typeof value.attachment !== 'string' || !page || typeof page !== 'object' || Array.isArray(page) ||
        Object.keys(page).some(key => !['generation', 'cursor', 'collection', 'limit'].includes(key))) throw new Error('Invalid Bot Crossing inventory page')
      const requestEpoch = profileEpoch
      hostSerial = hostSerial >= 999999999 ? 1 : hostSerial + 1
      const response = await view.requestHost({ attachment:value.attachment, id:`host-${hostSerial}`, method:'inventory.page', payload:page })
      if (requestEpoch !== profileEpoch || profileRevoked || !snapshot.enabled || view.currentAttachment?.() !== value.attachment) {
        throw new Error('Bot Crossing inventory document was revoked')
      }
      if (!response?.ok || !response.result || typeof response.result !== 'object') throw new Error('Bot Crossing inventory unavailable')
      const result = response.result
      if (typeof result.generation !== 'string' || !Array.isArray(result.records)) throw new Error('Invalid Bot Crossing inventory response')
      if (result.collection === 'threads') {
        let refs = refsByGeneration.get(result.generation)
        if (!refs || page.cursor === undefined) refsByGeneration.set(result.generation, refs = new Map())
        for (const record of result.records) if (record && typeof record.id === 'string' && Object.hasOwn(record, 'ref')) refs.set(record.id, {
          id: record.id, harness: record.harness, source: record.source, parentId: record.parentId, ref: record.ref,
          checkout: record.checkout && typeof record.checkout === 'object' ? { path: record.checkout.path } : undefined,
        })
        activeInventoryGeneration = result.generation
        activeAttachment = value.attachment
        while (refsByGeneration.size > 2) refsByGeneration.delete(refsByGeneration.keys().next().value)
      }
      return publicInventoryValue(result)
    },
    'colony:inventory:cancel': async (event, value, ...args) => {
      requireHost(event)
      if (args.length || !snapshot.enabled || !value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2 ||
        typeof value.attachment !== 'string' || typeof value.generation !== 'string') throw new Error('Invalid Bot Crossing inventory cancellation')
      hostSerial = hostSerial >= 999999999 ? 1 : hostSerial + 1
      const response = await view.requestHost({ attachment:value.attachment, id:`host-${hostSerial}`, method:'inventory.cancel', payload:{ generation:value.generation } })
      if (!response?.ok) throw new Error('Bot Crossing inventory cancellation failed')
      return true
    },
    'colony:action:run': async (event, value, ...args) => {
      requireHost(event)
      if (args.length || !snapshot.enabled || profileRevoked || !value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).length !== 3 || typeof value.attachment !== 'string' || value.attachment !== activeAttachment ||
        view.currentAttachment?.() !== value.attachment) return { ok: false, reason: 'Bot Crossing action document is unavailable.' }
      return actions.run({ kind: value.kind, id: value.id })
    },
    'colony:import:preview': async (event, ...args) => {
      requireHost(event, true)
      if (args.length || !options.dialog?.showOpenDialog) return { ok: false, reason: 'Invalid Bot Crossing import request.' }
      return profileOperation(async () => {
        const win = options.getWindow()
        const result = await options.dialog.showOpenDialog(win && !win.isDestroyed?.() ? win : undefined, {
          title: 'Import Bot Crossing state', properties: ['openFile'], filters: [{ name: 'Bot Crossing state', extensions: ['json'] }],
        })
        if (result.canceled || result.filePaths?.length !== 1) return { ok: false, cancelled: true }
        try {
          const current = await ensureImport()
          const selectedPath = result.filePaths[0]
          const counts = await current.service.control({ type: 'importPreview', path: selectedPath })
          pendingImportPath = selectedPath
          return { ok: true, counts }
        } catch (error) {
          pendingImportPath = ''
          return { ok: false, reason: error instanceof Error ? error.message : 'Import preview failed.' }
        } finally { await disposeImport() }
      })
    },
    'colony:import:commit': async (event, ...args) => {
      requireHost(event, true)
      if (args.length) return { ok: false, reason: 'Choose and preview a Bot Crossing state file first.' }
      return profileOperation(async () => {
        if (!pendingImportPath) return { ok: false, reason: 'Choose and preview a Bot Crossing state file first.' }
        const selectedPath = pendingImportPath
        pendingImportPath = ''
        try {
          const current = await ensureImport()
          const receipt = await current.service.control({ type: 'importCommit', path: selectedPath })
          return { ok: true, receipt }
        } catch (error) { return { ok: false, reason: error instanceof Error ? error.message : 'Import failed.' } }
        finally { await disposeImport() }
      })
    },
  })
  for (const [channel, handler] of Object.entries(handlers)) options.ipcMain.handle(channel, handler)

  return Object.freeze({
    async activateProfile(/** @type {any} */ identity) {
      return profileOperation(async () => {
        await Promise.all([view.disposeCurrent(), disposeImport()])
        store = createColonyPreferences({ userDataPath: options.userDataPath, resourcesPath: options.resourcesPath,
          productionApiBase: identity?.productionApiBase, userId: identity?.userId })
        snapshot = await store.read()
        discovered = null
        pendingImportPath = ''
        resetInventory()
        profileRevoked = !store.key
        return status()
      })
    },
    async invalidateProfile() {
      profileRevoked = true
      resetInventory()
      pendingImportPath = ''
      options.emitReset?.()
      return profileOperation(async () => {
        snapshot = { v: 1, enabled: false, sources: {} }
        store = null
        discovered = null
        await Promise.all([view.disposeCurrent(), disposeImport()])
      })
    },
    async dispose() {
      disposed = true
      profileRevoked = true
      resetInventory()
      pendingImportPath = ''
      for (const channel of CHANNELS) options.ipcMain.removeHandler?.(channel)
      return profileOperation(async () => {
        snapshot = { v: 1, enabled: false, sources: {} }
        store = null
        discovered = null
        await Promise.all([view.dispose(), disposeImport()])
      })
    },
    status,
  })
}

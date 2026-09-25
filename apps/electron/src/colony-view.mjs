import { randomUUID, createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import path from 'node:path'
import { createColonyService } from './colony-service.mjs'
import { resolveColonyArtifact } from './colony-desktop-artifact.mjs'
import { validateColonyRequest, validateColonyResponse } from './colony-channel.mjs'
const ENTRY = 'rhythm-colony://app/index.html'
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
const types = /** @type {Record<string,string>} */ ({ '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml', '.glb':'model/gltf-binary', '.hdr':'application/octet-stream', '.woff2':'font/woff2' })
/** @param {any} artifact */
export function createColonyAssetHandler(artifact) {
  const directory = path.dirname(artifact.rendererPath)
  return async (/** @type {Request} */ request) => {
    try {
      const url = new URL(request.url)
      if (request.method !== 'GET' || url.protocol !== 'rhythm-colony:' || url.host !== 'app' || url.search || url.hash || /%2e|%2f|%5c|\\|\0/i.test(request.url)) throw new Error('Denied')
      const name = decodeURIComponent(url.pathname)
      const target = path.resolve(directory, '.' + name)
      const relative = path.relative(directory, target)
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Denied')
      const entry = path.relative(artifact.root, target).split(path.sep).join('/')
      const seal = artifact.manifest.integrity[entry]
      if (!seal) throw new Error('Unverified')
      const canonical = await realpath(target)
      const canonicalRoot = await realpath(directory)
      if (!canonical.startsWith(canonicalRoot + path.sep)) throw new Error('Escaping path')
      const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      let bytes
      try {
        const info = await file.stat()
        if (!info.isFile() || info.size > 64 * 1024 * 1024) throw new Error('Invalid asset')
        bytes = await file.readFile()
      } finally { await file.close() }
      if (`sha256-${createHash('sha256').update(bytes).digest('base64')}` !== seal) throw new Error('Changed asset')
      return new Response(bytes, { headers: { 'content-type': types[path.extname(target)] ?? 'application/octet-stream', 'content-security-policy': CSP, 'x-content-type-options':'nosniff', 'cache-control':'no-store' } })
    } catch { return new Response('Colony asset unavailable', { status: 404, headers: { 'content-security-policy': CSP } }) }
  }
}

/** Exact native frame/epoch boundary, also exercised by real Electron hostile-frame fixtures.
 * @param {any} options */
export function bindColonySceneChannel({ ipcMain, contents, frame, documentId, service, MessageChannelMain }) {
  let expectedFrame = typeof frame === 'function' ? null : frame
  let committed = contents.getURL() === ENTRY && !contents.isLoadingMainFrame()
  let readyEvent = /** @type {any} */ (null)
  let revoked = false
  let transferred = false
  let port = /** @type {Electron.MessagePortMain | null} */ (null)
  let disposal = /** @type {Promise<void> | null} */ (null)
  const dispose = () => {
    if (disposal) return disposal
    revoked = true
    disposal = Promise.resolve().then(() => service.stop())
    void disposal.catch(() => {})
    try { expectedFrame?.send('colony:revoke') } catch {}
    const closingPort = port
    port = null
    closingPort?.close()
    ipcMain.removeListener('colony:scene-ready', onReady)
    contents.removeListener('did-finish-load', onLoad)
    contents.removeListener('did-start-navigation', onNavigation)
    contents.removeListener('render-process-gone', dispose)
    contents.removeListener('destroyed', dispose)
    return disposal
  }
  const flush = () => {
    const current = contents.mainFrame
    if (!committed && contents.getURL() === ENTRY && current?.url === ENTRY && !contents.isLoadingMainFrame()) committed = true
    if (!committed || !readyEvent || revoked || transferred) return
    if (expectedFrame === null) expectedFrame = current
    if (readyEvent.sender !== contents || readyEvent.senderFrame !== expectedFrame || current !== expectedFrame || expectedFrame.detached || expectedFrame.url !== ENTRY) { void dispose(); return }
    const channel = new MessageChannelMain()
    port = channel.port1
    transferred = true
    port?.on('message', async (event) => {
      if (revoked) return
      try {
        validateColonyRequest(event.data, documentId)
        const response = await service.request(event.data)
        validateColonyResponse(response, documentId)
        if (!revoked) port?.postMessage(response)
      } catch { void dispose() }
    })
    port?.on('close', () => { void dispose() })
    port?.start()
    try { expectedFrame.postMessage('colony:port', { v:1, documentId }, [channel.port2]) }
    catch { channel.port2.close(); void dispose() }
  }
  function onReady(/** @type {any} */ event, /** @type {any} */ message) {
    // Foreign frames cannot revoke another document, either.
    if (event.sender !== contents || event.senderFrame !== contents.mainFrame || (expectedFrame && event.senderFrame !== expectedFrame)) return
    if (revoked) return
    if (readyEvent || !message || message.v !== 1 || message.product !== 'colony' || Object.keys(message).length !== 2) { void dispose(); return }
    readyEvent = event
    flush()
  }
  function onLoad() { committed = true; flush() }
  function onNavigation(/** @type {any} */ event, /** @type {string} */ _url, /** @type {boolean} */ inPlace, /** @type {boolean} */ mainFrame) {
    const main = typeof event.isMainFrame === 'boolean' ? event.isMainFrame : mainFrame
    const same = typeof event.isSameDocument === 'boolean' ? event.isSameDocument : inPlace
    if (main && !same) {
      if (committed || transferred || expectedFrame !== null) void dispose()
      else readyEvent = null
    }
  }
  ipcMain.on('colony:scene-ready', onReady)
  contents.on('did-finish-load', onLoad)
  contents.on('did-start-navigation', onNavigation)
  contents.on('render-process-gone', dispose)
  contents.on('destroyed', dispose)
  return { dispose }
}

/** @param {any} options */
export function registerColonyView(options) {
  const { ipcMain, getWindow } = options
  let current = /** @type {any} */ (null)
  let transition = Promise.resolve()
  let barrier = Promise.resolve()
  let epoch = 0
  let disposed = false
  const enabled = options.enabled ?? (() => false)
  const ownsHost = (/** @type {any} */ event) => {
    const win = getWindow()
    return win && !win.isDestroyed() && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame && /^rhythm:\/\/app\/index\.html#\/colony(?:\?.*)?$/.test(event.senderFrame.url)
  }
  const disposeCurrent = async () => {
    epoch++
    const record = current
    current = null
    if (!record) return barrier
    barrier = barrier.then(async () => {
      let failure = /** @type {unknown} */ (null)
      const attempt = async (/** @type {() => any} */ work) => {
        try { await work() } catch (error) { failure ??= error }
      }
      let stopping = /** @type {Promise<void> | undefined} */ (undefined)
      await attempt(() => { stopping = record.channel?.dispose() })
      await attempt(() => { if (!record.win.isDestroyed()) record.win.contentView.removeChildView(record.view) })
      await attempt(() => { if (!record.view.webContents.isDestroyed()) record.view.webContents.close({ waitForBeforeUnload:false }) })
      await attempt(() => stopping)
      await attempt(() => record.service.dispose())
      for (const cleanup of record.cleanups) await attempt(cleanup)
      await attempt(() => record.partition.clearStorageData())
      await attempt(() => record.partition.protocol.unhandle('rhythm-colony'))
      if (failure) throw failure
    })
    void barrier.catch(() => {})
    return barrier
  }
  const attach = async (/** @type {any} */ event, /** @type {any[]} */ args) => {
    if (disposed || !enabled() || !ownsHost(event) || args.length) return { ok:false, reason:'Bot Crossing is disabled or unavailable in this window.' }
    if (current) return { ok:true, attachment:current.attachment }
    try { await barrier }
    catch (error) { return { ok:false, reason:error instanceof Error ? error.message : 'Bot Crossing teardown is incomplete.' } }
    const requestEpoch = ++epoch
    const win = getWindow()
    const dataDir = options.getDataDir?.()
    if (!dataDir || !path.isAbsolute(dataDir)) return { ok:false, reason:'Bot Crossing requires an active local profile.' }
    let service
    let view
    try {
      const config = { artifactRoot:options.getArtifactRoot(), expectedSourceCommit:options.expectedSourceCommit, expectedElectronMajor:options.expectedElectronMajor ?? 40 }
      const artifact = await resolveColonyArtifact(config)
      const documentId = randomUUID()
      service = createColonyService({ ...options, ...config, dataDir, sources:options.getSources(), enabled })
      await service.start({ documentId })
      if (disposed || epoch !== requestEpoch || !ownsHost(event) || !enabled()) throw new Error('Bot Crossing attachment revoked')
      const electron = options.electron ?? await import('electron')
      view = new electron.WebContentsView({ webPreferences: { preload:artifact.preloadPath, partition:`colony-${randomUUID()}`, sandbox:true, contextIsolation:true, nodeIntegration:false, nodeIntegrationInSubFrames:false, webSecurity:true, webviewTag:false } })
      const contents = view.webContents
      const partition = contents.session
      partition.protocol.handle('rhythm-colony', createColonyAssetHandler(artifact))
      partition.webRequest.onBeforeRequest((/** @type {any} */ details, /** @type {any} */ callback) => {
        let allowed = false
        try { const url = new URL(details.url); allowed = url.protocol === 'rhythm-colony:' && url.host === 'app' } catch {}
        callback({ cancel:!allowed })
      })
      partition.setPermissionRequestHandler((/** @type {any} */ _contents, /** @type {any} */ _permission, /** @type {any} */ callback) => callback(false))
      partition.setPermissionCheckHandler(() => false)
      const denyDownload = (/** @type {any} */ download) => download.preventDefault()
      partition.on('will-download', denyDownload)
      contents.setWindowOpenHandler(() => ({ action:'deny' }))
      contents.on('will-attach-webview', (/** @type {any} */ navigation) => navigation.preventDefault())
      contents.on('will-navigate', (/** @type {any} */ navigation) => navigation.preventDefault())
      contents.on('will-redirect', (/** @type {any} */ navigation) => navigation.preventDefault())
      contents.on('will-frame-navigate', (/** @type {any} */ navigation) => navigation.preventDefault())
      const record = { win, view, partition, service, attachment:randomUUID(), channel:/** @type {ReturnType<typeof bindColonySceneChannel> | null} */(null), cleanups:/** @type {(() => void)[]} */ ([]) }
      record.channel = bindColonySceneChannel({ ipcMain, contents, frame:() => contents.mainFrame, documentId, service, MessageChannelMain:electron.MessageChannelMain })
      current = record
      const hostNavigation = () => { if (!ownsHost(event)) void disposeCurrent().catch(() => {}) }
      win.webContents.on('did-navigate-in-page', hostNavigation)
      win.webContents.on('did-start-navigation', hostNavigation)
      record.cleanups.push(() => { win.webContents.removeListener('did-navigate-in-page', hostNavigation); win.webContents.removeListener('did-start-navigation', hostNavigation); partition.removeListener('will-download', denyDownload) })
      contents.on('render-process-gone', () => { if (current === record) void disposeCurrent().catch(() => {}) })
      view.setBounds({ x:0,y:0,width:0,height:0 })
      win.contentView.addChildView(view)
      await contents.loadURL(ENTRY)
      if (current !== record || epoch !== requestEpoch || !enabled()) throw new Error('Bot Crossing attachment revoked')
      return { ok:true, attachment:record.attachment }
    } catch (error) {
      let failure = error
      try {
        if (current) await disposeCurrent()
        else { if (view && !view.webContents.isDestroyed()) view.webContents.close({waitForBeforeUnload:false}); await service?.dispose() }
      } catch (teardownError) { failure = teardownError }
      return { ok:false, reason:failure instanceof Error ? failure.message : 'Bot Crossing unavailable' }
    }
  }
  /** @param {any} event @param {...any} args */
  function attachHandler(event, ...args) {
    const next = transition.then(() => attach(event, args))
    transition = next.then(() => {}, () => {})
    return next
  }
  ipcMain.handle('colony:view:attach', attachHandler)
  ipcMain.handle('colony:view:bounds', (/** @type {any} */ event, /** @type {any} */ value) => {
    if (!current || !ownsHost(event) || !enabled() || value?.attachment !== current.attachment || !value.bounds) return false
    const { x,y,width,height } = value.bounds
    if (![x,y,width,height].every(Number.isFinite) || width < 0 || height < 0) return false
    const zoom = current.win.webContents.getZoomFactor()
    const area = current.win.getContentBounds()
    const left = Math.min(area.width, Math.max(0,Math.round(x*zoom)))
    const top = Math.min(area.height, Math.max(0,Math.round(y*zoom)))
    current.view.setBounds({ x:left,y:top,width:Math.max(0,Math.min(area.width-left,Math.round(width*zoom))),height:Math.max(0,Math.min(area.height-top,Math.round(height*zoom))) })
    return true
  })
  ipcMain.handle('colony:view:detach', async (/** @type {any} */ event, /** @type {any} */ value) => {
    if (!current || !ownsHost(event) || value?.attachment !== current.attachment) return false
    await disposeCurrent(); return true
  })
  return { disposeCurrent, async dispose() {
    disposed = true
    let failure = /** @type {unknown} */ (null)
    for (const work of [() => disposeCurrent(), () => transition, () => disposeCurrent()]) {
      try { await work() } catch (error) { failure ??= error }
    }
    for (const name of ['colony:view:attach','colony:view:bounds','colony:view:detach']) ipcMain.removeHandler(name)
    if (failure) throw failure
  } }
}

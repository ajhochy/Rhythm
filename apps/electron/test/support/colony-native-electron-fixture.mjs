// Real pinned Electron, no DevTools socket. Only disposable fixture paths are supplied.
import { app, BrowserWindow, WebContentsView, MessageChannelMain, ipcMain, protocol, session } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { registerColonyView, bindColonySceneChannel } from '../../src/colony-view.mjs'
const root = process.env.COLONY_NATIVE_ROOT
if (!root || !path.isAbsolute(root)) throw new Error('Explicit isolated fixture root required')
app.setPath('userData', path.join(root, 'electron-user-data'))
app.setPath('sessionData', path.join(root, 'electron-session'))
app.commandLine.appendSwitch('disable-background-networking')
protocol.registerSchemesAsPrivileged([
  { scheme: 'rhythm', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: 'rhythm-colony', privileges: { standard: true, secure: true, supportFetchAPI: true } },
])
// Destroying the last window must not auto-quit before the receipt is written.
app.on('window-all-closed', () => {})
const results = {}
let win
let viewHost
let foreign
const check = async (name, work) => { process.stderr.write(`colony-fixture:${name}\n`); try { await work(); results[name] = { pass: true } } catch (error) { results[name] = { pass: false, error: String(error?.message ?? error) } } }
async function run() {
try {
  process.stderr.write('colony-fixture:before-ready\n')
  await app.whenReady()
  process.stderr.write('colony-fixture:ready\n')
  assert.equal(Number(process.versions.electron.split('.')[0]), 40)
  protocol.handle('rhythm', () => new Response('<!doctype html><title>Isolated Colony owner</title><main>Owner</main>', { headers: { 'content-type': 'text/html' } }))
  const preload = path.join(root, 'owner-preload.cjs')
  await fs.writeFile(preload, `const {contextBridge,ipcRenderer}=require('electron'); contextBridge.exposeInMainWorld('nativeTest',{attach:()=>ipcRenderer.invoke('colony:view:attach'),detach:(attachment)=>ipcRenderer.invoke('colony:view:detach',{attachment})});`)
  win = new BrowserWindow({ show: false, webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } })
  process.stderr.write('colony-fixture:owner-load\n')
  await win.loadURL('rhythm://app/index.html#/colony')
  process.stderr.write('colony-fixture:owner-loaded\n')
  viewHost = registerColonyView({ ipcMain, electron: { WebContentsView, MessageChannelMain }, getWindow: () => win,
    getArtifactRoot: () => path.join(root, 'artifact'), getDataDir: () => path.join(root, 'owned-profile', 'state'),
    getSources: () => [{ id: 'hermes', enabled: true, paths: { home: path.join(root, 'hermes') } }],
    enabled: () => true, isPackaged: false, resourcesPath: path.join(root, 'Resources'),
    developmentNodePath: process.env.COLONY_NATIVE_NODE, expectedElectronMajor: 40,
    expectedSourceCommit: process.env.COLONY_NATIVE_SOURCE_COMMIT,
  })
  process.stderr.write('colony-fixture:attach\n')
  const attached = await win.webContents.executeJavaScript('window.nativeTest.attach()')
  process.stderr.write('colony-fixture:attached\n')
  assert.equal(attached.ok, true, attached.reason)
  const scene = win.contentView.children.find(child => child.webContents && child.webContents !== win.webContents)?.webContents
  assert.ok(scene, 'Actual WebContentsView scene is absent')
  assert.equal(scene.getURL(), 'rhythm-colony://app/index.html')
  await check('asset-and-private-state', async () => {
    const receipt = await scene.executeJavaScript(`(async()=>{
      const bridge=window.colonyEmbedded;
      const page=await bridge.request('inventory.page',{collection:'threads',limit:250});
      await bridge.request('inventory.cancel',{generation:page.generation});
      const state=await bridge.request('state.read',{});
      const saved=await bridge.request('state.write',{state:{...state,archived:['native-fixture-only']},baseUpdatedAt:state.updatedAt});
      const asset=await fetch('./assets/crew.glb');
      return {ids:page.records.map(row=>row.id), archived:saved.archived, asset:asset.status, bytes:(await asset.arrayBuffer()).byteLength};
    })()`)
    assert.ok(receipt.ids.includes('hermes:main:native-fixture'))
    assert.deepEqual(receipt.archived, ['native-fixture-only'])
    assert.equal(receipt.asset, 200)
    assert.ok(receipt.bytes > 1024)
  })
  await check('sandbox-and-network', async () => {
    const prefs = scene.getLastWebPreferences()
    assert.equal(prefs.sandbox, true); assert.equal(prefs.contextIsolation, true)
    assert.equal(prefs.nodeIntegration, false); assert.equal(prefs.webSecurity, true)
    const receipt = await scene.executeJavaScript(`(async()=>{
      const attempt=async url=>{try {const r=await fetch(url);return r.ok}catch{return false}};
      return {node:typeof process,require:typeof require,hostBridge:typeof window.rhythmShell,
        keys:Object.keys(window.colonyEmbedded).sort(), remote:await attempt('https://example.invalid/forbidden'),
        worker:await attempt('/server/embedded-worker.mjs'), file:await attempt('file:///etc/passwd')};
    })()`)
    assert.equal(receipt.node, 'undefined'); assert.equal(receipt.require, 'undefined'); assert.equal(receipt.hostBridge, 'undefined')
    assert.deepEqual(receipt.keys, ['electronMajor', 'product', 'protocolVersion', 'request'])
    assert.equal(receipt.remote, false); assert.equal(receipt.worker, false); assert.equal(receipt.file, false)
  })
  await check('foreign-actual-frame', async () => {
    const attackPreload = path.join(root, 'foreign-preload.cjs')
    await fs.writeFile(attackPreload, `const {contextBridge,ipcRenderer}=require('electron');let ports=0;ipcRenderer.on('colony:port',e=>{ports+=e.ports.length;for(const p of e.ports)p.close()});contextBridge.exposeInMainWorld('attack',{ready:()=>{ipcRenderer.send('colony:scene-ready',{v:1,product:'colony'});return new Promise(resolve=>setTimeout(()=>resolve(ports),150))}});`)
    foreign = new BrowserWindow({ show: false, webPreferences: { session: scene.session, preload: attackPreload, sandbox: true, contextIsolation: true, nodeIntegration: false } })
    await foreign.loadURL(scene.getURL())
    assert.notEqual(foreign.webContents.mainFrame, scene.mainFrame)
    assert.equal(await foreign.webContents.executeJavaScript('window.attack.ready()'), 0, 'Same URL on a foreign actual WebFrameMain received authority')
    foreign.destroy(); foreign = null
  })
  await check('navigation-revokes-document', async () => {
    const reloaded = new Promise(resolve => scene.once('did-finish-load', resolve))
    scene.reload()
    await reloaded
    // WebFrameMain wrappers can survive a same-origin reload. Authority cannot:
    // the new preload receives no replacement port and its request must revoke.
    const outcome = await scene.executeJavaScript("window.colonyEmbedded.request('state.read',{}).then(()=>({resolved:true}),error=>({resolved:false,message:error.message}))")
    assert.equal(outcome.resolved, false)
    assert.match(outcome.message, /\[colony:revoked\]/)
    await viewHost.disposeCurrent()
    assert.equal(win.contentView.children.some(child => child.webContents && child.webContents !== win.webContents), false)
  })
  await check('sibling-and-stale-actual-frame', async () => {
    // Separate hostile-frame harness: permit subframe preload only here so actual
    // same-WebContents sibling IPC reaches the receiver. Production prefs above
    // remain sandboxed with no subframe Node integration; no fake sender objects.
    const attackPreload = path.join(root, 'receiver-attack-preload.cjs')
    await fs.writeFile(attackPreload, `const {contextBridge,ipcRenderer}=require('electron');let ports=0;const owned=[];const waiting=[];ipcRenderer.on('colony:port',e=>{ports+=e.ports.length;owned.push(...e.ports);while(waiting.length)waiting.shift()(ports)});contextBridge.exposeInMainWorld('attack',{ready:()=>{ipcRenderer.send('colony:scene-ready',{v:1,product:'colony'});return ports},ports:()=>ports,waitForPort:()=>ports||new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Timed out waiting for authorized port')),5000);waiting.push(value=>{clearTimeout(timer);resolve(value)})})});`)
    const isolated = session.fromPartition('colony-hostile-receiver-fixture')
    isolated.protocol.handle('rhythm-colony', () => new Response('<!doctype html><title>Hostile frame fixture</title>', { headers: { 'content-type': 'text/html' } }))
    const adversary = new BrowserWindow({ show: false, webPreferences: { session: isolated, preload: attackPreload,
      sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: true } })
    let boundary
    try {
      await adversary.loadURL('rhythm-colony://app/index.html')
      const contents = adversary.webContents
      const frame = contents.mainFrame
      let nativeRequests = 0
      let stops = 0
      let resolveStopped
      const stopped = new Promise(resolve => { resolveStopped = resolve })
      boundary = bindColonySceneChannel({ ipcMain, contents, frame, documentId: 'hostile-frame-epoch', MessageChannelMain,
        service: { request: async () => { nativeRequests++; return {} }, stop: async () => { stops++; resolveStopped() } } })
      await contents.executeJavaScript(`new Promise(resolve=>{const child=document.createElement('iframe');child.onload=resolve;child.src=location.href;document.body.append(child)})`)
      const sibling = frame.frames[0]
      assert.ok(sibling && sibling !== frame)
      assert.equal(sibling.url, frame.url, 'Sibling must share URL and WebContents; URL-only validation would pass')
      assert.equal(await sibling.executeJavaScript('window.attack.ready()'), 0)
      assert.equal(await frame.executeJavaScript('window.attack.ready()'), 0)
      assert.equal(await frame.executeJavaScript('window.attack.waitForPort()'), 1)
      assert.equal(await sibling.executeJavaScript('window.attack.ports()'), 0)
      const reloaded = new Promise(resolve => contents.once('did-finish-load', resolve))
      contents.reload()
      await stopped
      await reloaded
      assert.equal(stops, 1)
      assert.equal(await contents.executeJavaScript('window.attack.ready()'), 0)
      await new Promise(resolve => setTimeout(resolve, 500))
      assert.equal(await contents.executeJavaScript('window.attack.ports()'), 0, 'Reloaded document reused old authority')
      assert.equal(nativeRequests, 0)
    } finally { await boundary?.dispose(); adversary.destroy() }
  })
} catch (error) { results.bootstrap = { pass: false, error: error.message } }
finally {
  process.stderr.write('colony-fixture:dispose\n')
  try { await viewHost?.dispose() } catch (error) { results.disposal = { pass: false, error: error.message } }
  foreign?.destroy(); win?.destroy()
  await fs.writeFile(path.join(root, 'receipt.json'), JSON.stringify({ electron: process.versions.electron, results }))
  app.quit()
}

}
// Do not hold initial ESM evaluation open while awaiting Electron readiness.
void run()

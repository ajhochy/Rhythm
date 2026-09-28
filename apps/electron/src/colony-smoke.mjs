import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { EXPECTED_COLONY_ELECTRON_MAJOR, PINNED_COLONY_SOURCE_COMMIT } from './colony-desktop-config.mjs'
import { resolveColonyRuntimeConfig } from './colony-host.mjs'
import { createColonyService } from './colony-service.mjs'

/**
 * A minimal, real Colony smoke for the release-signed bundle: resolves and verifies the pinned
 * artifact, starts the owned worker headless (no window; this never touches BrowserWindow/IPC),
 * completes the version/capability handshake, issues one status read, then tears the worker down.
 * Throws on any failure — the caller (main.mjs's --colony-smoke path) must exit non-zero.
 * @param {{isPackaged:boolean, resourcesPath:string, environment?: NodeJS.ProcessEnv, createService?: typeof createColonyService}} options
 * @returns {Promise<Readonly<{product:'colony', sourceCommit:string, electronMajor:number, capabilities:string[], handshake:'ok', status:'read'}>>}
 */
export async function runColonySmoke({ isPackaged, resourcesPath, environment = process.env, createService = createColonyService }) {
  const runtime = resolveColonyRuntimeConfig({ isPackaged, resourcesPath, environment })
  const documentId = randomUUID()
  const dataRoot = await mkdtemp(path.join(tmpdir(), 'rhythm-colony-smoke-'))
  const service = createService({
    isPackaged, resourcesPath, developmentNodePath: runtime.nodePath, artifactRoot: runtime.artifactRoot,
    expectedSourceCommit: PINNED_COLONY_SOURCE_COMMIT, expectedElectronMajor: EXPECTED_COLONY_ELECTRON_MAJOR,
    dataDir: path.join(dataRoot, 'profile'), sources: [], enabled: () => true,
  })
  try {
    const started = await service.start({ documentId })
    const response = await service.request({ v: 1, documentId, id: 'colony-smoke-status', method: 'state.read', payload: {} })
    if (!response?.ok || !response.result || typeof response.result !== 'object') {
      throw new Error(response?.error?.message || 'Colony smoke status read failed')
    }
    // Allowlisted: no artifact/data-directory paths or raw worker output leave this function.
    return Object.freeze({
      product: /** @type {const} */ ('colony'),
      sourceCommit: PINNED_COLONY_SOURCE_COMMIT,
      electronMajor: EXPECTED_COLONY_ELECTRON_MAJOR,
      capabilities: [...started.capabilities],
      handshake: /** @type {const} */ ('ok'),
      status: /** @type {const} */ ('read'),
    })
  } finally {
    await service.dispose().catch(() => {})
    await rm(dataRoot, { recursive: true, force: true }).catch(() => {})
  }
}

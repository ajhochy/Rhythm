import defaultFs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { electronDbPath } from './agent-server.mjs'

const KEYS = /** @type {Readonly<Record<string,string[]>>} */ (Object.freeze({
  hermes: ['home'],
  codex: ['home'],
  rhythm: ['database'],
  opencode: ['database'],
  'claude-code': ['home', 'desktopSessions'],
  cursor: ['projects'],
  antigravity: ['home'],
  kilocode: ['database'],
}))

function candidates(/** @type {string} */ home) {
  const support = path.join(home, 'Library', 'Application Support')
  return [
    { id: 'hermes', paths: { home: path.join(home, '.hermes') } },
    { id: 'codex', paths: { home: path.join(home, '.codex') } },
    { id: 'rhythm', paths: { database: path.join(home, path.relative(os.homedir(), electronDbPath())) } },
    { id: 'opencode', paths: { database: path.join(home, '.local', 'share', 'opencode', 'opencode.db') } },
    { id: 'claude-code', paths: { home: path.join(home, '.claude'), desktopSessions: path.join(support, 'Claude', 'claude-code-sessions') } },
    { id: 'cursor', paths: { projects: path.join(home, '.cursor', 'projects') } },
    { id: 'antigravity', paths: { home: path.join(home, '.gemini', 'antigravity-cli') } },
    { id: 'kilocode', paths: { database: path.join(home, '.local', 'share', 'kilo', 'kilo.db') } },
  ]
}

/** Shallow settings-time discovery. It never opens or enumerates a harness store. */
export async function discover(/** @type {{home:string,fs?:any}} */ { home, fs = defaultFs }) {
  if (typeof home !== 'string' || !path.isAbsolute(home)) throw new Error('Colony discovery HOME must be absolute')
  return Promise.all(candidates(home).map(async (source) => {
    const present = await Promise.all(Object.values(source.paths).map(async (candidate) => {
      try { await fs.lstat(candidate); return true } catch { return false }
    }))
    return { ...source, state: present.some(Boolean) ? 'present' : 'missing' }
  }))
}

/** Close renderer-derived preferences into the worker's exact source shape. */
export function toServiceSources(/** @type {any} */ preferences) {
  if (!preferences || preferences.v !== 1 || !preferences.sources || typeof preferences.sources !== 'object' || Array.isArray(preferences.sources)) return []
  const output = []
  for (const [id, value] of Object.entries(preferences.sources)) {
    const keys = KEYS[id]
    if (!keys || !value || typeof value !== 'object' || typeof value.enabled !== 'boolean') continue
    if (!value.enabled) { output.push({ id, enabled: false }); continue }
    if (!value.paths || typeof value.paths !== 'object' || Array.isArray(value.paths) ||
      keys.some((key) => typeof value.paths[key] !== 'string' || !path.isAbsolute(value.paths[key])) ||
      Object.keys(value.paths).some((key) => !keys.includes(key))) continue
    output.push({ id, enabled: true, paths: Object.fromEntries(keys.map((key) => [key, value.paths[key]])) })
  }
  return output
}

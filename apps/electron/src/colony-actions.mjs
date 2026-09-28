import defaultFs from 'node:fs/promises'
import { execFile } from 'node:child_process'
import path from 'node:path'

const LOCAL_SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CLAUDE_DESKTOP_ID = /^local_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const KINDS = new Set(['open', 'showParent', 'reveal', 'copyPath', 'archive', 'restore', 'viewed'])

/** Run one shell command line in a new macOS Terminal window; the line travels as an argv, never as AppleScript source. @param {string} line */
const macTerminal = (line) => new Promise((resolve, reject) => {
  execFile('/usr/bin/osascript', ['-e', 'on run argv', '-e', 'tell application "Terminal"', '-e', 'activate', '-e', 'do script (item 1 of argv)', '-e', 'end tell', '-e', 'end run', line],
    { timeout: 15_000 }, (error) => error ? reject(error) : resolve(undefined))
})

/** @param {string} reason */
const failure = (reason) => ({ ok: false, reason })

/** Main-only policy for actions resolved from the current private inventory generation. */
export function createColonyActions(/** @type {any} */ options) {
  const io = options.fs ?? defaultFs
  /** @type {((line: string) => Promise<unknown>) | null} */
  const terminal = 'openInTerminal' in options ? options.openInTerminal : process.platform === 'darwin' ? macTerminal : null

  const recordFor = (/** @type {string} */ id) => {
    const generation = options.currentGeneration?.()
    if (typeof generation !== 'string' || !generation) return null
    return options.resolveRecord?.(id, generation) ?? null
  }

  const existingCheckoutPath = async (/** @type {any} */ record) => {
    const target = record?.checkout?.path
    if (typeof target !== 'string' || !path.isAbsolute(target) || target.includes('\0')) return null
    try {
      const info = await io.lstat(target)
      return info.isSymbolicLink?.() ? null : target
    } catch { return null }
  }

  /** Side-effect-free open plan for one inventory record; the scene's Open button mirrors it. */
  const plan = (/** @type {any} */ record) => {
    const harness = record?.harness ?? record?.source
    const ref = record?.ref ?? {}
    if (harness === 'rhythm') {
      return LOCAL_SESSION_ID.test(ref.sessionId ?? '')
        ? { ok: true, kind: 'rhythm-session', sessionId: ref.sessionId }
        : failure('This Rhythm task has no verified local session ID.')
    }
    if (harness === 'opencode') return failure('This SDK-only task is unavailable in Rhythm. Show its parent task instead.')
    if (harness === 'claude-code') {
      // Desktop ids navigate the app to the tab it already has; CLI ids fall back to its resume link.
      const url = typeof ref.desktopSessionId === 'string' && CLAUDE_DESKTOP_ID.test(ref.desktopSessionId)
        ? `claude://claude.ai/epitaxy/${ref.desktopSessionId}`
        : typeof ref.cliSessionId === 'string' && UUID.test(ref.cliSessionId) ? `claude://resume?session=${ref.cliSessionId}` : ''
      if (!url) return failure('This task has no verified Claude Code session ID.')
      return handles(url) ? { external: url } : failure('Claude is not installed or does not handle Claude session links.')
    }
    if (harness !== 'codex') return failure('This harness does not support exact native opening.')
    const sessionId = ref.sessionId
    if (typeof sessionId !== 'string' || !UUID.test(sessionId)) return failure('This task has no verified Codex thread ID.')
    const url = `codex://threads/${sessionId}`
    if (handles(url)) return { external: url }
    if (!terminal) return failure('Codex is not installed or does not handle Codex thread links.')
    const cwd = typeof ref.cwd === 'string' && path.isAbsolute(ref.cwd) && !/[\0-\x1f\x7f]/.test(ref.cwd) ? ref.cwd : ''
    return { terminal: `${cwd ? `cd '${cwd.replaceAll("'", "'\\''")}' && ` : ''}codex resume ${sessionId}` }
  }
  // ponytail: per-scheme 30s memo so a 250-record inventory page costs one LaunchServices probe per scheme.
  const handlerMemo = new Map()
  const handles = (/** @type {string} */ url) => {
    const scheme = url.slice(0, url.indexOf(':'))
    const hit = handlerMemo.get(scheme)
    if (hit && Date.now() - hit.at < 30_000) return hit.value
    let value = false
    try { value = Boolean(options.app?.getApplicationNameForProtocol?.(url)) } catch {}
    handlerMemo.set(scheme, { value, at: Date.now() })
    return value
  }

  const open = async (/** @type {any} */ record) => {
    const next = /** @type {any} */ (plan(record))
    if (!next.external && !next.terminal) return next
    try {
      if (next.external) await options.shell.openExternal(next.external)
      else if (terminal) await terminal(next.terminal)
      return { ok: true, kind: 'external-app' }
    } catch (error) {
      return failure(`The harness could not open this task: ${error instanceof Error ? error.message : 'OS dispatch failed'}`)
    }
  }

  return Object.freeze({
    /** Scene-bound thread with canOpen reflecting what `open` will do (the worker marks all threads unopenable). */
    sceneThread(/** @type {any} */ thread) {
      if (!thread || typeof thread !== 'object' || Array.isArray(thread)) return thread
      const next = /** @type {any} */ (plan(thread))
      const available = next.ok !== false
      // Only canOpen/navigationReason: the scene enables Open from them, and extra fields on thousands of records crowd its 32 MiB snapshot.
      return { ...thread, canOpen: available, navigationReason: available ? 'Open this conversation' : next.reason }
    },
    async run(/** @type {any} */ value) {
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2 ||
        typeof value.kind !== 'string' || !KINDS.has(value.kind) || typeof value.id !== 'string') return failure('Invalid Bot Crossing action.')
      const record = recordFor(value.id)
      if (!record) return failure('This task is stale or is not in the current Bot Crossing inventory.')

      if (value.kind === 'open') return open(record)
      if (value.kind === 'showParent') {
        if (typeof record.parentId !== 'string') return failure('This task has no available parent task.')
        const parent = recordFor(record.parentId)
        if (!parent) return failure('The parent task is stale or unavailable.')
        const sessionId = parent.ref?.sessionId
        return (parent.harness ?? parent.source) === 'rhythm' && LOCAL_SESSION_ID.test(sessionId ?? '')
          ? { ok: true, kind: 'select-thread', id: parent.id, sessionId }
          : { ok: true, kind: 'select-thread', id: parent.id }
      }
      if (value.kind === 'reveal' || value.kind === 'copyPath') {
        const target = await existingCheckoutPath(record)
        if (!target) return failure('This task folder is missing or no longer available.')
        try {
          if (value.kind === 'reveal') options.shell.showItemInFolder(target)
          else {
            const clipboard = options.clipboard ?? (await import('electron')).clipboard
            clipboard.writeText(target)
          }
          return { ok: true, kind: value.kind === 'reveal' ? 'revealed' : 'copied' }
        } catch (error) {
          return failure(`The task folder action failed: ${error instanceof Error ? error.message : 'OS action failed'}`)
        }
      }
      const payload = value.kind === 'archive'
        ? { threadId: value.id, archived: true }
        : value.kind === 'restore'
          ? { threadId: value.id, archived: false }
          : { threadId: value.id, viewedAt: Date.now() }
      try {
        const response = await options.requestState?.('state.mark', payload)
        return response?.ok === true ? { ok: true, kind: value.kind } : failure('Bot Crossing could not update its local task state.')
      } catch (error) {
        return failure(`Bot Crossing could not update its local task state: ${error instanceof Error ? error.message : 'state unavailable'}`)
      }
    },
  })
}

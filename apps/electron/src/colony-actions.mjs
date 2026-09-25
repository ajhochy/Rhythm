import defaultFs from 'node:fs/promises'
import path from 'node:path'

const LOCAL_SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const KINDS = new Set(['open', 'showParent', 'reveal', 'copyPath', 'archive', 'restore', 'viewed'])

/** @param {string} reason */
const failure = (reason) => ({ ok: false, reason })

/** Main-only policy for actions resolved from the current private inventory generation. */
export function createColonyActions(/** @type {any} */ options) {
  const io = options.fs ?? defaultFs

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

  const open = async (/** @type {any} */ record) => {
    const harness = record.harness ?? record.source
    if (harness === 'rhythm') {
      const sessionId = record.ref?.sessionId
      return LOCAL_SESSION_ID.test(sessionId ?? '')
        ? { ok: true, kind: 'rhythm-session', sessionId }
        : failure('This Rhythm task has no verified local session ID.')
    }
    if (harness === 'opencode') return failure('This SDK-only task is unavailable in Rhythm. Show its parent task instead.')
    if (harness !== 'codex') return failure('This harness does not support exact native opening.')
    const sessionId = record.ref?.sessionId
    if (!UUID.test(sessionId ?? '')) return failure('This task has no verified Codex thread ID.')
    const target = `codex://threads/${sessionId}`
    let application = ''
    try { application = options.app?.getApplicationNameForProtocol?.(target) ?? '' } catch {}
    if (!application) return failure('Codex is not installed or does not handle Codex thread links.')
    try {
      await options.shell.openExternal(target)
      return { ok: true, kind: 'external-app' }
    } catch (error) {
      return failure(`Codex could not open this task: ${error instanceof Error ? error.message : 'OS dispatch failed'}`)
    }
  }

  return Object.freeze({
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

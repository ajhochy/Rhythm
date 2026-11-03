import { type ChildProcess, spawnSync } from "node:child_process"

// Duplicated from `packages/opencode/src/util/process.ts` because the SDK cannot
// import `opencode` without creating a cycle (`opencode` depends on `@opencode-ai/sdk`).
//
// `group: true` is passed only by callers that spawned `proc` with
// `detached: true` (i.e. `proc.pid` is also its own process-group id). A
// negative-pid signal then reaps the whole tree in one syscall — the spawned
// engine plus every MCP server it started (e.g. `engraph`) — instead of just
// the immediate child, which would otherwise be orphaned. Non-detached
// callers (e.g. the interactive TUI) must not pass `group`: their pgid is
// shared with whatever spawned them, so a negative-pid signal there would
// target an unrelated group.
export function stop(proc: ChildProcess, opts: { group?: boolean } = {}) {
  if (proc.exitCode !== null || proc.signalCode !== null) return
  if (process.platform === "win32" && proc.pid) {
    const out = spawnSync("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { windowsHide: true })
    if (!out.error && out.status === 0) return
  }
  if (opts.group && proc.pid && process.platform !== "win32") {
    try {
      process.kill(-proc.pid, "SIGTERM")
      return
    } catch {
      // Fall through to a plain single-process kill (e.g. the group is
      // already gone, or this process was never actually its own leader).
    }
  }
  proc.kill()
}

export function bindAbort(
  proc: ChildProcess,
  signal?: AbortSignal,
  onAbort?: () => void,
  stopOpts?: { group?: boolean },
) {
  if (!signal) return () => {}
  const abort = () => {
    clear()
    stop(proc, stopOpts)
    onAbort?.()
  }
  const clear = () => {
    signal.removeEventListener("abort", abort)
    proc.off("exit", clear)
    proc.off("error", clear)
  }
  signal.addEventListener("abort", abort, { once: true })
  proc.on("exit", clear)
  proc.on("error", clear)
  if (signal.aborted) abort()
  return clear
}

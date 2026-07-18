// rhythm-telemetry — OCU-28 (#1069)
//
// Vendored opencode plugin (mirrors the rhythm-anthropic-accounts layout, but
// deliberately has NO build step — this is plain ESM, no TypeScript compile
// needed for a hook this small). Registers tool.execute.before/after and
// POSTs a per-tool-call telemetry record to Rhythm's local api_server for
// run-quality ingestion (exact per-call name/duration/status — far more
// precise than mining the transcript after the fact).
//
// Contract:
//  - Fire-and-forget: the POST is never awaited from inside the hook, and any
//    network failure is swallowed. Engine latency impact must stay
//    imperceptible — no awaits in the hook path.
//  - Plugin absence/failure never breaks engine startup (opencode itself
//    already isolates a throwing plugin loader; this file additionally never
//    throws synchronously during its own init).
//  - Disable with RHYTHM_TOOL_TELEMETRY_DISABLED=1 (checked here AND by
//    opencode_plugin_config.ts, which skips registering this plugin entirely
//    when the flag is set — belt and suspenders).
//  - RHYTHM_API_BASE is bridged onto the engine's env by
//    opencode_client_service.ts before spawn (same variable the vendored
//    rhythm-anthropic-accounts plugin already uses for its spillover
//    reports) — reused here rather than inventing a second env var for the
//    same "where is api_server" question.

const DISABLED = process.env.RHYTHM_TOOL_TELEMETRY_DISABLED === '1'
const API_BASE = process.env.RHYTHM_API_BASE || 'http://localhost:4001'

// key: `${sessionID}:${callID}` -> startedAt (ms). Module-level, single
// process — a bridge/engine restart simply drops any in-flight timing (same
// posture as turn_redispatch's retained-turn map), never corrupts anything.
const starts = new Map()

function postToolEvent(event) {
  try {
    fetch(`${API_BASE}/agents/run-quality/tool-events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
    }).catch(() => {})
  } catch {
    // Synchronous throw from fetch() construction itself (shouldn't happen,
    // but this hook must never propagate an error into the tool-call path).
  }
}

export default async function rhythmTelemetryPlugin() {
  if (DISABLED) return {}

  return {
    'tool.execute.before': async (input) => {
      starts.set(`${input.sessionID}:${input.callID}`, Date.now())
    },
    'tool.execute.after': async (input) => {
      const key = `${input.sessionID}:${input.callID}`
      const startedAt = starts.get(key)
      starts.delete(key)
      const now = Date.now()
      postToolEvent({
        sessionID: input.sessionID,
        callID: input.callID,
        tool: input.tool,
        startedAt: startedAt ?? now,
        durationMs: startedAt ? now - startedAt : 0,
        // tool.execute.after only fires on a completed call; the engine
        // surfaces a failed tool call as a tool-error/tool-result of type
        // 'error' through a different path (session/message parts), not by
        // NOT firing this hook — so a fired 'after' event is a successful
        // execution from this hook's vantage point.
        status: 'success',
        errorClass: null,
      })
    },
  }
}

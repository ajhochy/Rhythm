/**
 * taint.ts — Issue #1134
 *
 * Module-level taint flag: once this mcp_server process has consumed
 * untrusted external content (e.g. a Gmail read/search), it is marked
 * tainted for the rest of the process's life. Outbound tools
 * (rhythm_send_email, rhythm_send_message, rhythm_create_message_thread)
 * check `isTainted()` before acting (see `tools/_approval_gate.ts`).
 *
 * ponytail: process-global, not session-keyed. `.mcp-roles/*.mcp.json`
 * spawns one `node dist/index.js` per agent session over stdio, so module
 * scope == session scope already — no session-id plumbing needed. Upgrade to
 * a session-keyed map only if mcp_server ever multiplexes multiple sessions
 * through a single process.
 */

let tainted = false;
let reason: string | null = null;

/** Mark this process tainted because untrusted external content was consumed. */
export function markTainted(source: string): void {
  tainted = true;
  reason = source;
}

export function isTainted(): boolean {
  return tainted;
}

/** The source that caused taint (e.g. 'gmail'), or null if clean. */
export function taintReason(): string | null {
  return reason;
}

/** Test-only: reset the module-level flag between test cases. */
export function __resetTaintForTest(): void {
  tainted = false;
  reason = null;
}

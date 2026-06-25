# [mcp-scope-06] Verification + acceptance measurement

**Plan:** Per-session MCP tool-schema injection scoping
**Branch:** `feature/agent-scheduler`
**Dependencies:** mcp-scope-02, mcp-scope-03, mcp-scope-04, mcp-scope-05
**Blocks:** nothing (this is the final gate)

---

## Context

The entire feature is a token-reduction claim: a Secretary session must inject
only the MCP tool schemas its profile allows, not every server's schemas. This
issue makes that claim measurable and records the result.

**How injected-tool count is measured:**

Add a fork-side DEBUG log in the patched `resolveTools` loop (Issue 02) that
emits the final tool count just before the tools record is returned:
```ts
// apps/opencode_fork/packages/opencode/src/session/prompt.ts
logger.debug({ resolveToolsCount: tools.length, allowlistActive: !!mcpAllowlist }, 'resolveTools complete');
```

In the running Debug app, the api_server logs propagate from the engine process.
This log line is the measurement instrument. Alternatively, the **context panel's
token usage** (already present in the UI from recent work) will show a lower
token count for the first prompt in a Secretary session vs a profile-less session.

**Secretary profile — expected expander output:**
`secretary.mcp.json` defines 6 servers, all with explicit `allowedTools` arrays:
- `rhythm`: 14 tools
- `gmail-work`: 2 tools (`search_emails`, `read_email`)
- `gmail-personal`: 2 tools
- `calendar`: 3 tools (`list_events`, `get_event`, `list_calendars`)
- `obsidian`: 9 tools
- `pdf-tools`: 6 tools

Total: **36 sanitized tool ids** in `tools[]`; `servers: []`.

The acceptance gate is: injected tool count for a Secretary session equals
`expandMcpAllowlist(secretaryConfig).tools.length` (dynamic — computed at test
time, not hard-coded). This is intentionally not "7 servers" — it is the actual
number of distinct tool schemas injected.

**Control case:** a profile-less session (no `mcpRoleConfig`) must still inject
all connected MCP tool schemas, proving back-compat.

---

## Acceptance Criteria

- [ ] Fork `resolveTools` emits a DEBUG log line with `resolveToolsCount` and
  `allowlistActive` (added during this issue if not already present from Issue 02).
- [ ] **Secretary session smoke:**
  - Open a Secretary session in the Debug app (using a locally-built fork binary
    on PATH, or the bundled fork from Issue 03).
  - Observe the `resolveToolsCount` log from the engine process.
  - Run `expandMcpAllowlist(secretaryConfig)` locally (or via a test helper) to
    get the expected count.
  - Assert: `resolveToolsCount === expandMcpAllowlist(secretaryConfig).tools.length`.
  - Document the before (unscoped, all-server baseline count) and after counts in
    the run log.
- [ ] **Profile-less session control:** open a session with no profile; observe
  `resolveToolsCount`; assert it is greater than the Secretary count (confirms
  back-compat, not a regression where all sessions are scoped).
- [ ] `docs/ai/testing-guide.md` — add a "MCP allowlist smoke" entry documenting:
  - How to read the `resolveToolsCount` log from the engine process.
  - The `expandMcpAllowlist` helper to get the expected count.
  - The commands to run for Secretary and profile-less control.
- [ ] `docs/ai/runs/2026-06-25-mcp-scope-verification.md` (or same-day slug) —
  created with: before/after counts, profile tested, fork binary version/marker,
  pass/fail outcome.

---

## Likely Files

- `apps/opencode_fork/packages/opencode/src/session/prompt.ts` (add DEBUG log if
  not present from Issue 02)
- `docs/ai/testing-guide.md` (add smoke entry)
- `docs/ai/runs/2026-06-25-mcp-scope-verification.md` (new run log)

---

## Required Tests / Evaluation

| Check | Method | Pass condition |
|---|---|---|
| Secretary injected count | `resolveToolsCount` in engine logs | Equals `expandMcpAllowlist(secretaryConfig).tools.length` |
| Profile-less control count | Same log, no-profile session | Greater than Secretary count |
| Back-compat | Profile-less session still functional | Session completes normally, tools all present |
| Fork binary in use | Engine log or `OPENCODE_FORK_MARKER` | Confirms fork binary, not PATH binary |
| Docs updated | `testing-guide.md` | Smoke entry present and runnable |

This is a **manual smoke** for the final visual confirmation. The preceding
numeric assertions (count vs expander output) can be scripted as a test helper
if desired.

---

## Safety Notes

- **Use the expander's actual output, not a hard-coded count.** The Secretary
  profile has 36 explicit tool ids as of 2026-06-25, but this number will drift
  as the profile evolves. Always call `expandMcpAllowlist(secretaryConfig)` to
  get the live expected count — do not hardcode `36`.
- **`disabledMcpServers` note.** The 4 entries in Secretary's `disabledMcpServers`
  (bash, computer, editor, filesystem) are native opencode tools, not MCP servers.
  They do not appear in the injected MCP tool count and are out of scope for this
  measurement.
- **Baseline measurement.** Record the unscoped all-server baseline count in the
  run log. Without it the token-reduction claim is unverifiable on re-inspection.
- **No merge to `main`.** Feature branch + PR only.

---

## Open Questions — RESOLVED (orchestrator, 2026-06-25)

**R4 (Acceptance count):** `secretary.mcp.json` has **6 servers**, not 7. The
acceptance gate uses `expandMcpAllowlist(secretaryConfig).tools.length` (dynamic),
NOT a hard-coded server or tool count. The "7" in the brief was an error; the
correct count is whatever the expander returns for the live Secretary profile.
How injected-tool count is measured: `resolveToolsCount` DEBUG log from the fork's
`resolveTools` function, emitted on every prompt invocation.

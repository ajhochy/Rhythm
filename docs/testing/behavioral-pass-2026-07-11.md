# Behavioral verification pass — 2026-07-11 wave + epic + #1012/#1013 refixes

Purpose: confirm **intended behavior**, not just green checks. Each item lists the
exact steps, the data state it needs, and the pass condition. Items are split by
what's verifiable **headless** (curl/log/DB) vs. what needs the **running desktop app**.

Launch for app items: `cd apps/desktop_flutter && flutter run -d macos`, Settings →
API Server = `https://api.vcrcapps.com` (or the local :4001 app). Agent server is :4001.

---

## Code-verified already (real code/data, this session)

- **#1012** — chain proven by real-code composition (no mocks): writer emits `options.mcpAllowlist` (live probe) → real fork `load()` yields `agent.options.mcpAllowlist` → `task.test.ts` (10/10) sets the child session allowlist → engine `mcp_allowlist_e2e.test.ts` filters tools. Live delegation below is confirmatory.
- **#1014** — traced: `/config/reload` busts config **and** Agent caches; session re-resolves agent per turn → open session sees new delegate.
- **#1006 / #1010** — real endpoint/model shapes match (statusMessage camelCase; timestamp sites route through the shared formatter). Pixel render still worth an eye.

---

## A. Headless (curl / log / DB) — no UI needed

### #1012 — task-spawned subagent is actually scoped  (definitive)
1. Standalone server on :4099 against the built fork, `HOME` with real auth, DB copy.
2. Regenerate a scoped subagent + its manager `.md` (PATCH each) → confirm the subagent `.md` now has `options: {"mcpAllowlist":{...}}`.
3. `POST /system/refresh`.
4. Trigger a manager run whose prompt says: *use the `task` tool with `subagent_type="<scoped-sub>"`*.
5. **Pass:** engine log for the **child** session shows `resolveTools complete { allowlistActive: true, resolveToolsCount: <small, ~scope size> }` — NOT the full connected-tool count. Gemini child: no "512 function declarations" error.

### #1007 — headless run gets a derived name
1. `POST /agent-schedules/:id/trigger-now` for a task whose prompt is distinctive.
2. `GET /agent-sessions` → newest row.
3. **Pass:** `name` is derived from the prompt (≤80 chars), not `AgentRunner run` / `Scheduled run` / `New session`.

### #1008 — tool-heavy run fails fast, not stuck 'starting'
1. Start the server with a short `AGENT_RUN_TIMEOUT_MS` (e.g. 8000).
2. Trigger a tool-heavy scheduled task (many MCP servers, e.g. Org External Discovery).
3. **Pass:** within the timeout the session goes `status='error'` with a stage message (e.g. "…during MCP readiness preflight…"), never sits at `starting` with 0 msgs indefinitely.

### Plan B adopt arc (#997) — full discover→adopt→keep/revert
- Follows `docs/superpowers/plans/2026-07-09-plan-B-stage-b-discover-adopt.md` Task 9.
- Note: last run reached the judge but `scoreSkillBody` returned 0/0 in the bare standalone (existing #930 machinery). To exercise the applier directly, seed an `external-adoption` proposal (status='proposed') and `POST /agent-org-proposals/:id/approve`, then confirm: real body downloaded (post-#990 path resolution) + `writeManagedSkill` (write-if-absent) + agent allowlist wired + measure → keep resolves the gap / revert deletes the skill + restores the allowlist.

---

## B. Needs the running desktop app (visual confirmation)

### #1013 — Org Optimizer review queue shows the proposed fix
- Open **Agents → Org Optimizer → review queue** with a pending `refine-config`/`refine-scope`/`grant-delegation` proposal.
- **Pass:** card shows **Root cause** + **Proposed fix** (+ diagnosis/fix type) as primary content — NOT "Before: (none) / After: …" and NOT raw JSON. (A `create-agent`/refine with a structured patch still shows the before/after diff.)

### #1006 — errored-session transcript
- Session History → open an errored session **with content** (e.g. `0788f045`, 70 msgs) → transcript renders + an error card at the end. Open an **interrupted 0-message** session (e.g. `863b294e`) → empty-state showing the `statusMessage` ("Server restarted — run interrupted"), not a blank pane.

### #1009 — reasoning streams for claude-code
- Start a **claude-code** agent chat → the "Thinking…" block **fills in live** while streaming (not an empty header).

### #1010 — Pacific 12-hour timestamps
- Agents (session list + chat times), Session History, Scheduled Tasks last-run → all timestamps read like **"Jul 10, 2026 3:52 PM"** (Pacific, AM/PM), not UTC/24h.

---

## Notes
- Headless items reuse the isolated-env harness (copy DB + skills, built fork, :4099) so the real app/DB is untouched.
- App items are genuine visual confirmations — best done in the running desktop app; an AI-driven smoke (XcodeBuildMCP macOS UI automation) can substitute but is token-heavy.

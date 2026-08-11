---
tags: [decision, Rhythm]
---

# OCU-35A (#1176) — v2 session lifecycle audit at 2026-08-10 rebase checkpoint

## Context

Issue #1176 defers adopting OpenCode's v2 `/api` session surface until upstream
lifecycle parity exists. Its "Adoption trigger" mandates, at every fork subtree
rebase, an inspection of `apps/opencode_fork/packages/opencode/src/v2/session.ts`
and its tests, recording for each operation whether it is a real implementation,
a placeholder, an unsafe cast, or an untested facade over v1.

Audited state: fork package version **1.14.49**
(`apps/opencode_fork/packages/opencode/package.json`), branch
`mega/2026-08-10-backlog-burndown`, last subtree-touching commit `d00703ad`.
No subtree rebase has landed since the 2026-07-28 evaluation
(`docs/ai/runs/2026-07-28-ocu35-trigger-evaluations.md`); this audit re-verifies
against current code rather than assuming the prior record.

## Findings — per-operation verdicts

All line numbers refer to `apps/opencode_fork/packages/opencode/src/v2/session.ts`
unless noted. HTTP wiring is `src/server/routes/instance/httpapi/groups/v2/session.ts`
(route definitions) and `src/server/routes/instance/httpapi/handlers/v2/session.ts`
(handlers). The v2 HTTP API describes itself as experimental:
`groups/v2.ts` annotates `title: "opencode experimental HttpApi"`,
`description: "Experimental HttpApi surface for selected instance routes."`

| Operation | Verdict | Evidence |
|---|---|---|
| `create` | **Placeholder + unsafe cast** | Line 169–171: `create: Effect.fn("V2Session.create")(function* (_input) { return {} as any })`. No `create` endpoint exists in the v2 `SessionGroup` either. |
| `prompt` | **Placeholder + unsafe cast, live-wired** | Line 289–291: `prompt: Effect.fn("V2Session.prompt")(function* (_input) { return {} as any })` — typed `Effect.Effect<SessionMessage.User, never>` (line 102–107), so the cast empty object masquerades as a user message. Wired to `POST /api/session/:sessionID/prompt` (handlers line 111–120), which returns that cast object to clients. |
| `shell` | **Placeholder (empty no-op)** | Line 292: `shell: Effect.fn("V2Session.shell")(function* (_input) {})`. No v2 HTTP route exposes it. |
| `skill` | **Placeholder (empty no-op)** | Line 293: `skill: Effect.fn("V2Session.skill")(function* (_input) {})`. |
| `compact` | **Placeholder no-op, live-wired as silent false success** | Line 329: `compact: Effect.fn("V2Session.compact")(function* (_sessionID) {})`. Wired to `POST /api/session/:sessionID/compact` (handlers line 121–127), which yields the no-op then returns `HttpApiSchema.NoContent.make()` — a 204 that compacted nothing. |
| `wait` | **Placeholder no-op, live-wired as silent false success** | Line 330: `wait: Effect.fn("V2Session.wait")(function* (_sessionID) {})`. Wired to `POST /api/session/:sessionID/wait` (handlers line 128–134) — returns 204 immediately without waiting for anything. |
| `abort` | **Absent** | The `Interface` (lines 68–121) defines no abort operation; `grep -rn "abort" src/v2/` returns nothing; the v2 `SessionGroup` has no abort endpoint. Cancellation does not exist on the v2 surface. |
| `reconnect` | **Absent** | `groups/v2.ts` registers only Session/Message/Model/Provider groups — there is **no v2 event-stream endpoint**, so no `session.next.*` stream to reconnect to. `src/v2/event.ts` (43 lines) defines only an event-ID brand and a `define()` schema helper; no cursor, resume, or subscription mechanics. |
| Terminal / error paths | **Incomplete by construction** | Only `get` and `subagent` can fail (`NotFoundError`, lines 64–66, 75, 116). `prompt`, `shell`, `compact`, `wait` all declare error channel `never` (lines 102–120), so failures are unrepresentable — errors cannot reach a caller even once implementations land. The only HTTP-level error is `BadRequest` for cursor decoding on `sessions` (handlers lines 74–79). |
| `get` | Real (read path) | Lines 172–176: SQLite select from `SessionTable`, `NotFoundError` on miss. |
| `list` | Real (read path) | Lines 177–215: filtered, cursor-paginated select. |
| `messages` / `context` | Real read paths; **facade over v1 storage; only test coverage is read-through** | Lines 216–288. The sole direct tests of the v2 service assert that rows written by the **v1** session pipeline decode through v2 reads: `test/session/prompt.test.ts:498` and `test/session/compaction.test.ts:611–612` call `SessionV2.Service.use((svc) => svc.messages(...))` after v1 activity. |
| `switchAgent` / `switchModel` | Minimal real (event emit only), untested | Lines 294–307: emit `SessionEvent.AgentSwitched.Sync` / `ModelSwitched.Sync`. No session-existence validation, no test coverage. |
| `subagent` | **Facade composed of placeholders** | Lines 308–328: calls `result.create` (`{} as any`), `result.prompt` (`{} as any`), `result.wait` (no-op); the forked child then finds the last assistant text part and **discards it** — after `const text = assistant.content.findLast(...)`, `if (!text) return` is the final statement; the found text is never used. |

Test coverage: the entire `test/v2/` directory contains one file,
`session-message-updater.test.ts`, which tests the in-memory message updater —
not the session service. Zero tests exercise v2 `create`, `prompt`, `shell`,
`compact`, `wait`, or any abort/reconnect behavior (none exists to test).

## Decision

**Adoption trigger NOT met.** Per adoption-trigger step 3, `create`, `prompt`,
`shell`, `compact`, and `wait` remain placeholders/unsafe casts; `abort` and
`reconnect` do not exist on the v2 surface at all; error channels are typed
`never`. #1176 stays blocked. No migration work is scheduled. Re-run this audit
at the next `apps/opencode_fork` subtree rebase.

## Alternatives

- Adopt v2 now behind a flag — rejected: `prompt` would return `{} as any` and
  `compact`/`wait` would 204 while doing nothing; the issue explicitly forbids
  adopting on the existence of routes/types alone.
- Patch the fork's v2 stubs ourselves — rejected: out of scope per the issue's
  safety section ("Do not edit the vendored fork beyond the minimal Rhythm patch").

## Consequences

Human action (one line): **Approve keeping #1176 blocked until a fork subtree
rebase where `session.create/prompt/shell/compact/wait` in
`packages/opencode/src/v2/session.ts` are real implementations (no `{} as any`,
no empty bodies) and abort/reconnect exist — then attach the upstream commit and
schedule the migration.**

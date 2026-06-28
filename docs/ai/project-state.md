# Project State

## Current focus

**2026-06-27 — Agent live-streaming: core bus-routing fix landed.** The
**dual-bus split** (real root of #1/#3/#751/#759/#761/#762) is fixed and verified
against the BUILT fork. `SyncEvent.process()` published via the module-level
namespace `Bus` runtime while `/event` reads the per-request DI `Bus.Service` —
two bus states per directory, so `message.updated` / `message.part.updated` /
turn-time `session.updated` never reached the live `/event` subscriber. The fix
(#764) makes both runtimes share ONE `{wildcard, typed}` PubSub per directory via
a module-level registry in `bus/index.ts`. A real anthropic turn against the
built fork now delivers all three event types on `/event`.

Symptom status:
- **#1 duplicate messages / #3 no token-context** — engine side now FIXED
  (message.updated carries tokens/cost; part.updated carries canonical text).
  Awaiting UI manual smoke to confirm the Flutter render.
- **#2 ask-question hang** — FIXED earlier (question recovery).

## Active branch / PR

- **Branch:** `fix/issue-761-agents-ui-render` — contains #760 (merged) + #761 +
  #2 question-recovery + #762 convertEvent hardening + **#764 shared-bus fix** +
  tests. #764 fix not yet committed (working tree) at last update.
- **PR [#763](https://github.com/ajhochy/Rhythm/pull/763)** open — fold #764 into
  it with a `Closes #764` line. Not merged; left for human review + manual smoke.
- Standalone PRs [#760](https://github.com/ajhochy/Rhythm/pull/760) and #758 also open.

## In progress

- Commit the #764 fix to the branch, update PR #763 body (`Closes #764`),
  hand off for manual UI smoke. Do not merge.

## Recent coding-agent runs

### 2026-06-27 — issue-736 (Layer 2 WS-gateway dispatch backstop)
- Branch: `fix/issue-736-ws-gating` (worktree). Part of agent-security epic #769; defense-in-depth behind Layer 1 (#765).
- Files modified:
  - `apps/api_server/src/services/mcp_dispatch_guard.ts` (NEW) — pure `isToolAllowed(toolName, allowedToolsJson)` predicate; null allowlist → pass-through; explicit/inherit-all matching; fail-closed on malformed JSON.
  - `apps/api_server/src/services/opencode_stream_bridge.ts` — added `isToolAllowedForSession` + `broadcastToolDenied`; gated the `message.part.updated` tool-part branch (bypassPermissions path) and the `permission.asked`/`permission.updated` handler (pre-execution gate → auto-`deny`). Only fires for sessions with a non-null `mcp_role`.
  - Tests: `src/__tests__/issue_736_contract.test.ts`, `src/services/mcp_dispatch_guard.test.ts`; contract at `docs/ai/contracts/issue-736.json`.
- Checks run: contract test 4/4 PASS (red→green confirmed); guard unit 6/6 PASS; `tsc --noEmit` exit 0; full vitest `npm test` 1294/1294 PASS (150 files). `agents_ws_e2e.test.ts` (non-role tool-part forwarding) still green — no pass-through regression.
- Decisions: enforce at the stream-bridge relay hub at TWO points — permission gate (true pre-execution block) and tool-part forward (bypassPermissions backstop). Read `mcp_allowed_tools_json` only; no changes to the Layer-1 session-create / advertise path (owned by #765).
- Deviations from spec: none.
- Concerns: `_relayEvent` is HIGH blast radius (GitNexus) but the change is additive/early-return; could not exercise a real bypassPermissions turn locally (needs a signed build) — covered by unit simulation per AC #3.

## Risks / known issues

- Bus is HIGH blast radius (event backbone). The fix is additive and
  signature-preserving; disposal lifecycle (`InstanceDisposed` + shutdown that
  `/event`'s `Stream.takeUntil` relies on) is preserved and re-verified.
- Unit/bus-level suites cannot reproduce the split (it only manifests across HTTP
  requests) — always re-verify bus changes against the BUILT fork with a real turn.

## Test status

- opencode_fork: `bun run typecheck` PASS · `bun test test/server/ test/bus/`
  237 pass / 1 skip / 0 fail (incl. new `httpapi-event-dual-bus` contract test) ·
  `bun run build --single` (arm64) PASS.
- **Runtime smoke (built fork, real anthropic turn): PASS** — `/event` capture
  contains `message.updated` ×6 + `message.part.updated` ×5 + `session.updated`
  ×3 (all absent before the fix). See `runs/2026-06-27-issue-764-dual-bus-fix.md`.
- api_server / desktop_flutter: unchanged this run (last green; see prior runs).

## Next step

1. Commit #764, push, watch CI green, update PR #763 (`Closes #764`).
2. Manual UI smoke on a signed local build: agent turn renders live, NO duplicate
   messages, working token/context gauge. Then `failure-postmortem`.
3. Human merge of #763 after smoke passes.

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

## Recent coding-agent runs

### 2026-06-27 — issue #737 fence untrusted email content (SF-4)
- Files modified:
  - `apps/mcp_server/src/untrusted_context.ts` (new) — shared `untrustedContext()` fence helper (delimiters + "data, not instructions" directive); TS analog of Odysseus `untrusted_context_message()`.
  - `apps/mcp_server/src/tools/google.ts` — fence `rhythm_read_email` + `rhythm_search_gmail` tool results before they reach the model.
  - `apps/mcp_server/src/__tests__/contract/issue-737.spec.ts` (new) — 3 contract tests.
  - `docs/ai/contracts/issue-737.json` (new) — contract (2 unit, 1 manual/doc).
  - `docs/ai/decisions/2026-06-27-fence-untrusted-external-content.md` (new) — fence-all-external-content rule.
- Checks run: mcp_server `tsc --noEmit` PASS; `vitest run` 47/47 PASS (incl. 3 new contract + 7 existing google).
- Decisions made: fence at the model-facing MCP tool-result boundary, NOT at `/integrations/gmail-signals` (that REST payload is a machine envelope consumed by Flutter; the agent reads gmail only via the MCP tools). See decision doc.
- Deviations from spec: gmail-signals route left unfenced by design (structured-vs-text judgment); `rhythm_send_email` result ({id} confirmation, not attacker content) left unfenced.
- Concerns: none. Calendar/PCO/web tools are not yet fenced — out of scope for #737 but now governed by the documented rule (follow-up when those tools surface external text to the model).

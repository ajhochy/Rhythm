---
date: 2026-07-17
repo: rhythm
branch: docs/1123-1076-spike-and-watchlist
pr: pending
issues: [1123]
status: spike-findings
tags: [run, rhythm, spike]
---

# #1123 — Background delegation spike: source-verified findings + recommendation

This is the **documented-finding** deliverable of the #1123 spike acceptance
criteria. The *live* portion (install `opencode-ensemble` against our fork build
and drive dispatch→chat→push end-to-end with our model catalog) is **NOT** run
here — it requires an interactive session + localhost dashboard against a
freshly built fork engine and pulls in unbuilt dependencies (OCU-05 composer-
while-busy, OCU-16/17/18 worktrees). That live run remains a pending, separately-
scheduled task. What is delivered here is the source verification and the
adopt-vs-build decision the issue asks for.

## Primitives re-verified against the CURRENT fork (not just the issue text)

All four load-bearing claims in #1123 still hold in `apps/opencode_fork` today:

| Claim | Verified location |
|---|---|
| `task` is a **blocking** tool (parent frozen mid-turn) | `packages/opencode/src/tool/task.ts:196` — `Effect.acquireUseRelease` awaiting the child, abort listener wired parent↔child (`ctx.abort.addEventListener("abort", …)`) |
| `noReply: true` injects a message **without** an LLM turn | `packages/opencode/src/session/prompt.ts:1744` (`if (input.noReply === true) return message`) + schema at `:2172` |
| Fire-and-forget forking exists | `prompt.ts` uses `Effect.forkIn(scope)` in multiple places (e.g. `:1814`, `:1982`) — the same mechanism `promptAsync` uses to return immediately |
| `/event` SSE completion hook | `apps/api_server/src/services/opencode_stream_bridge.ts` exists and is our engine-event consumer |

Conclusion: the async-dispatch → inject/wake ("callback model") is achievable on
primitives we already ship. No engine invention required.

## Recommendation: **build-thin ourselves, gated to interactive sessions only — do NOT adopt opencode-ensemble wholesale (yet).**

Rationale (aligned with the issue's own "why not replace `task`" analysis):

1. **Most Rhythm delegation is headless** — 20+ services delegate in scheduled/
   background/system contexts (agentScheduler, gap_discovery, self-improvement,
   sundayPrep, org-optimizer, AgentFlow `implement_issue`→coding-agent). Blocking
   `task` is *correct* there (deterministic, no audience, synchronous result).
   Ensemble expects an interactive session + localhost dashboard; full headless
   is undocumented. Keep `task` untouched for these.
2. **Worktrees are meaningless for non-coding agents** (email/research/secretary/
   PCO operate on live production data via MCP). Ensemble worktrees every
   teammate by default.
3. **Synchronous-return callers** (AgentFlow chains expecting a final tool
   result) would need rewriting under ensemble's peer-messaging model.
4. **Coupling risk** — betting our load-bearing delegation path on a young,
   fast-moving plugin that hooks the loop deeply, layered on our already
   heavily-patched fork, is high-risk for low incremental benefit over a thin
   build on primitives we control.

Use `opencode-ensemble` as the **reference implementation** for the wake/awareness
mechanics (push `[Team message from X]` blocks via `promptAsync`, inject team
state into the lead's system prompt each call), not as a dependency.

## Concrete next-issue shape (proposed, not built here)

A **thin interactive-orchestration mode**, gated `interactiveSession === true`:
- Dispatch: parent calls a new async-delegate tool → child started via
  `promptAsync`-style fork → parent turn **ends** (idle, not frozen).
- Steer: user messages while idle are injected with `noReply: true` (queued
  context, no forced turn).
- Wake: the `/event` stream-bridge detects child completion → injects the
  child result + queued steer into the parent and starts one prompt loop.
- Headless/scheduled/AgentFlow/coding chains: **unchanged** blocking `task`.

## Blockers / sequencing
- Depends on **OCU-05 (#1046)** (keep composer enabled while busy) and
  **OCU-16/17/18** (worktrees). This mode can't ship its UX until OCU-05 lands.
- The spike's live acceptance checkboxes stay OPEN until a live run is scheduled.

## Status of the issue
Keep #1123 OPEN. This doc closes the "documented finding: adopt-as-is vs build-
thin" acceptance item (→ build-thin, interactive-only). The remaining live-spike
checkboxes require the deferred live run and OCU-05/16/17/18.

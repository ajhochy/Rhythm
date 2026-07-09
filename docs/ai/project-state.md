# Project State

## Current focus

**#930 verified live, draft PR open.** Model fallback chain + mid-run
cross-provider re-dispatch proven end-to-end: spillover exhaustion aborts
the spinning turn, reverts, and re-prompts on the next authed tier in the
same engine session. Live smoke found and fixed three real bugs (plugin
API-base port mismatch, bad openai default model, `session.error`-based
re-dispatch design that could hang forever) — see
`docs/ai/runs/2026-07-09-930-model-fallback-live.md`. #949 is merged to
main (via PR #950).

## Active branch / PR

- **`issue-930-model-fallback-chain`** — verified live, **draft PR open**
  against main (not merged, not marked ready). Caveat: live smoke used a
  constrained chain because the `openai`/`google` fallback tiers are dead on
  this machine — tracked as **#952**, a real gap if those tiers are dead in
  production too (default chain still lists them before openrouter).
- `issue-949-harvest-to-file` — **merged to main** via PR #950.
- `issue-929-skill-self-regulation` and **#933–936** — committed locally,
  awaiting their own live gates. 14 uncommitted files stashed as
  `wip-929-inflight-stashed-for-949`; restore with
  `git stash apply wip-929-inflight-stashed-for-949` when picking #929 back
  up.

## Risks / known issues

- **#952 — dead fallback tiers on this machine.** `openai` (Codex
  ChatGPT-account) and `google` (Gemini schema) fallback tiers are
  non-functional locally, so #930's live smoke only exercised
  `team-claude,personal-claude,openrouter-free`. The re-dispatch mechanism
  is provider-agnostic and proven, but a production spillover could still
  re-dispatch onto a hanging provider if those tiers are dead there too.
  Suggested follow-up: a fallback completion-watchdog.
- **openrouter/free flakiness** — can hit a rate limit that surfaces only
  as a WS error frame in the live harness, reading as a hang rather than a
  clean error.
- **Distill harvests injected memory prefaces, not conversation content** —
  during #949 live verification the distiller drafted a skill from the
  user's standing memory instruction (ws_gateway's injected preface lands in
  the input message rows and dominates the transcript), ignoring the actual
  conversation. Filed as a follow-up issue; relates to #929's
  self-regulation / bad-harvest detection.
- `AgentSkillsRepository` + `agent_skills` table still not deleted (32
  direct callers) — only the `distillFromSession` write site changed in
  #949. Cleanup remains a follow-up.
- Pre-existing unrelated test failures (22, memory-vault + auth-middleware,
  ENOENT temp-dir + 401 auth env issues) predate this branch.

## Test status

- `tsc --noEmit` — clean.
- Unit suites: `54 passed` (`turn_redispatch` 14 + `model_fallback` +
  `anthropic_session_routing`).
- Full `api_server` suite: `2498 passed | 5 skipped`.
- Live Phase A (`RHYTHM_LIVE_E2E=1`): `1 passed`.
- Live Phase A+B (`+RHYTHM_LIVE_E2E_FORCE_EXHAUSTED=1`): `2 passed`.

## Next step

1. Human review + merge of the `issue-930-model-fallback-chain` draft PR
   (left as draft deliberately; not automated).
2. Address #952 (dead openai/google fallback tiers) before relying on the
   default chain in production.
3. Unstash and finish `wip-929-inflight-stashed-for-949` on
   `issue-929-skill-self-regulation`; land #933–936's live gates.

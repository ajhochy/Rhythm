# Project State

## Current focus

**#949 verified live and landing.** Skill harvester writes draft `SKILL.md`
files + auto-binds to the source agent, closing the self-improvement loop.
Live E2E surfaced and fixed five root causes (stale fork binary,
provider-only agent model resolution, openrouter default-model pick, distill
riding global MRU, wrong skill-reload instance key) — see
`docs/ai/runs/2026-07-09-949-live-e2e-triage.md`.

## Active branch / PR

- **`issue-949-harvest-to-file`** / **PR #950** — fix commit landed,
  pushed, awaiting manual merge (no auto-merge).
- `issue-930-model-fallback-chain` — implemented (fallback chain,
  cross-provider handoff, 24 tests green), **awaiting gated live smoke**
  before merge. Its `DEFAULT_MODEL_BY_PROVIDER` will supersede the
  `openrouter/free` pin added in #949's fix.
- `issue-929-skill-self-regulation` — next up. 14 uncommitted files stashed
  as `wip-929-inflight-stashed-for-949`; restore with
  `git stash apply wip-929-inflight-stashed-for-949` after #949 is merged.

## Risks / known issues

- **openrouter/free flake in the live harness** — turn 2 can hit a rate
  limit that surfaces only as a WS error frame, which the E2E harness can't
  see, so it reads as a hang. #930's fallback chain is the systemic fix;
  until that merges, live #949 runs can flake on this.
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
- `skill_extractor.test.ts` — 9/9 pass.
- Resolver-adjacent suites (`issue_854_contract`, `opc_m4_4_agent_selection`,
  `agent_sessions`) — 59/59 pass.
- Live #948 phase — passes in-harness (twice).
- Live #949 phase — verified manually against the running backend (see run
  log); in-harness run can flake per the openrouter/free risk above.

## Next step

1. Manual merge of PR #950 (not automated).
2. Unstash and finish `wip-929-inflight-stashed-for-949` on
   `issue-929-skill-self-regulation`.
3. Gated live smoke for `issue-930-model-fallback-chain`, then merge; drop
   the `openrouter/free` pin in favor of its default map.

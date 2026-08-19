---
date: 2026-08-18
repo: Rhythm
branch: agent-stack/si-causal-runtime-v2-codex
pr: none
issues: [1448]
status: pass
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# C2-D (S6) / #1448 — live isolated WebSocket E2E test (C2 ship gate)

## What this proves

A real baseline run and a real candidate run, driven through the ACTUAL interactive WS path
(`ws_gateway.ts`'s `handleInputFrame`, wired in S4) against the isolated dev sandbox's real fork
engine and a real configured model provider (`openrouter`), for a declared `system-prompt-v1`
experiment:

- (a) both runs get distinct effective system prompts;
- (b) both produce finalized treatment receipts with distinct effective hashes;
- (c) durable `AgentConfig` target bytes (`system_prompt`, `revision`) are unchanged after both runs.

This is the contract's C2 ship-gate requirement: "Add a live isolated sandbox test that starts real
baseline and candidate runs through the public execution surface and proves distinct effective prompts
without durable target mutation" (`docs/ai/contracts/issue-causal-runtime-v2.json`, phase C2).

## What is real vs. synthetic

**Real:** profile creation (`POST /agent-configs`), experiment declaration (`POST
/agent-org-proposals/:id/experiment` — the real production route, `org_proposals_controller.
declareExperiment`), two real `agent_sessions` rows (`POST /agent-sessions`), two real interactive
turns driven through the actual `session.input` WS frame into the real fork engine binary (built via
`bun run build --single`) and a real `openrouter/openrouter/free` model call, and every
enrollment/receipt/AgentConfig read-back from the sandbox's own SQLite file after real dispatch
completed.

**Synthetic:** only the `agent_org_proposals` row itself (direct SQL insert) — there is no HTTP route
that creates a proposal in a chosen lifecycle state (`status='active'`), the same documented,
pre-existing gap `live_e2e_self_improvement_foundation.test.ts` (W7) and
`c2_a_reserved_treatment_dispatch.test.ts` both rely on. Nothing about the treatment
reservation/dispatch/receipt path itself is synthetic.

## Environment setup

Built and brought up the fork engine and api_server through `tools/dev/sandbox.sh` only (never by
hand), using a dedicated port/dir set to avoid colliding with any other sandbox:

```bash
cd apps/opencode_fork && bun install   # fresh worktree had no node_modules for the fork workspace
cd ../..
RHYTHM_SANDBOX_DIR=/tmp/rhythm-sandbox-c2d-s6 \
RHYTHM_SANDBOX_API_PORT=4198 \
RHYTHM_SANDBOX_ENGINE_PORT=4197 \
RHYTHM_SANDBOX_GATEWAY_PORT=4199 \
tools/dev/sandbox.sh up
```

Observed: `bun run build --single` succeeded (`Smoke test passed:
0.0.0-agent-stack/si-causal-runtime-v2-codex-202608190320`), `npm run build` succeeded, and
`Sandbox ready: http://127.0.0.1:4198 (engine :4197)`. `tools/dev/sandbox.sh status` confirmed all
three listeners (api :4198, engine :4197, gateway :4199) up. `GET /opencode/auth/` showed
`{"providers":["openrouter","anthropic","openai","google","ollama-planner","ollama-executor","opencode"],
"ready":true}` — a real configured provider set, inherited from the real `~/.local/share/opencode/
auth.json` per `sandbox.sh`'s documented copy-on-bring-up behavior.

## Live run — exact command and result

```bash
cd apps/api_server
RHYTHM_LIVE_E2E=1 \
RHYTHM_LIVE_E2E_ISOLATED=1 \
RHYTHM_LIVE_URL=http://127.0.0.1:4198 \
DB_PATH=/tmp/rhythm-sandbox-c2d-s6/rhythm.db \
RHYTHM_LIVE_DB_PATH=/tmp/rhythm-sandbox-c2d-s6/rhythm.db \
npx vitest run --reporter=verbose src/__tests__/c2_d_s6_live_ws_treatment_e2e.test.ts --no-file-parallelism
```

Ran **twice consecutively** (matching the campaign's existing "run it twice" confidence bar for a
first-execution live suite):

- Run 1: **1/1 passed, 14.07s** (test body), 14.76s total.
- Run 2: **1/1 passed, 14.56s** (test body), 15.25s total.

Both runs asserted, against the sandbox's real SQLite file after real dispatch:

- `agent_org_experiment_enrollments`: both episodes `cohort` matched the deterministic
  `assignCohort` assignment, `state` in `{'dispatched','terminalized'}` (a fully successful live turn's
  fire-and-forget terminal-outcome hook can race the read-back and advance the row to `terminalized` —
  both values prove the reserved treatment WAS dispatched; only `reserved`/`treatment_failed` would mean
  it wasn't. Same caveat already documented in `c2_a_reserved_treatment_dispatch.test.ts`'s dual-cohort
  case.)
- `agent_org_experiment_treatment_receipts`: both episodes had a finalized receipt; baseline's
  `effective_prompt_hash` equalled `sha256(BASELINE_PROMPT)`, candidate's equalled
  `sha256(CANDIDATE_PROMPT)`, and the two were **not equal** — (a) and (b) both proven directly from the
  real receipt rows the real dispatch boundary wrote.
- `agent_configs` row for the test profile: `system_prompt` still exactly `BASELINE_PROMPT` and
  `revision` unchanged from its value immediately after creation — (c) proven.

## One RED finding along the way (test-fixture bug, not a product bug)

First attempt asserted `enrollment.state === 'dispatched'` exactly and failed:
`expected 'terminalized' to be 'dispatched'`. Investigation via the sandbox's `api_server.log` showed
the full real pipeline had actually worked — reservation, treatment override, receipt commit at
dispatch — and the enrollment had legitimately progressed to `terminalized` because the live turn
genuinely completed and `recordTerminalOutcome` (C1) ran its fire-and-forget terminal hook before the
test's read-back. Fixed the assertion to accept `['dispatched', 'terminalized']`, matching the
identical, already-documented caveat in `c2_a_reserved_treatment_dispatch.test.ts`.

Second attempt then hit a real test-fixture bug: the deterministic `runEpisodeId` candidates
(`c2d-s6-episode-0`, `c2d-s6-episode-1`, ...) were NOT randomized per test invocation, and the sandbox
DB persists across repeated live-test runs (by design — `restart`/rerun reuse the same copied DB). The
second run's candidate IDs collided with the FIRST run's already-bound enrollments (a DIFFERENT
randomly-generated profile), correctly triggering `RunEnrollmentProfileCollisionError` — the exact
fail-closed behavior S4 is supposed to have. This was a fixture defect (unscoped episode-ID namespace),
not a product defect. Fixed by namespacing episode ID candidates under the run's own randomized
`PROFILE_ID`. Reran clean twice after the fix (see results above).

## Cleanup

```bash
RHYTHM_SANDBOX_DIR=/tmp/rhythm-sandbox-c2d-s6 \
RHYTHM_SANDBOX_API_PORT=4198 \
RHYTHM_SANDBOX_ENGINE_PORT=4197 \
RHYTHM_SANDBOX_GATEWAY_PORT=4199 \
tools/dev/sandbox.sh down
```

Observed: `Sandbox removed: /tmp/rhythm-sandbox-c2d-s6`. Confirmed no listeners remain on :4198/:4197/
:4199 and the sandbox directory no longer exists. Confirmed no leftover `c2d-s6-%` rows in the (now
deleted) sandbox `agent_configs` table before teardown — the test's `afterAll` `DELETE
/agent-configs/:id` cleaned up both profiles it created.

## Files changed

- `apps/api_server/src/__tests__/c2_d_s6_live_ws_treatment_e2e.test.ts` — new, env-gated
  (`RHYTHM_LIVE_E2E=1`), 1 test covering criteria c4/c5/c6.
- `docs/ai/contracts/issue-1448.json` — `issue-1448-c4/c5/c6` status `UNVERIFIED` -> `pass`.

## Checks

- `node_modules/.bin/tsc --noEmit` -> clean. `npm run build` -> PASS. `git diff --check` -> clean.
- Normal (non-live) `npx vitest run src/__tests__/c2_d_s6_live_ws_treatment_e2e.test.ts` -> **1 skipped**
  (confirms the suite is fully inert without `RHYTHM_LIVE_E2E=1`, so it adds no cost/risk to the
  ordinary suite or CI).

## Decisions / deviations

- `apps/opencode_fork` had no installed dependencies in this fresh worktree (`bun install` was required
  before `bun run build --single` could resolve `@opentui/solid/preload`) — a one-time setup cost, not a
  code change; nothing under `apps/opencode_fork` was edited.
- Did not attempt to decode/assert the model's actual free-text reply content (e.g. checking for the
  literal `BASELINE_OK`/`CANDIDATE_OK` sentinel words) as a hard assertion — free-tier model compliance
  with an exact-reply instruction is not guaranteed and would make the gate flaky on provider behavior
  unrelated to this contract's claim. The hard, deterministic proof of distinct effective prompts is the
  receipt's own `effective_prompt_hash` (computed server-side from the exact override string actually
  handed to the real dispatch boundary), which both runs' real WS turns produced correctly.
- Per this contract's global invariant ("No live Rhythm or OpenCode database access... from the builder
  session"), all reads/writes went through the isolated sandbox's copied SQLite file only
  (`/tmp/rhythm-sandbox-c2d-s6/rhythm.db`), never `~/Library/Application Support/Rhythm/rhythm.db` or
  `~/.local/share/opencode/opencode.db` directly. `sandbox.sh up`'s own documented bring-up reads the
  real live DB only as a read-only `.backup` source (its only supported bootstrap path, used identically
  by this repo's other live-E2E suites per `docs/ai/testing-guide.md`); no write ever targets it.

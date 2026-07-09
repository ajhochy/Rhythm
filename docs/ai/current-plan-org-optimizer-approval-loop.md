# Org Optimizer Approval Loop — Close "Approved → Implemented → Measured → Rewrite"

## End goal

Today, when a human approves an org-optimizer proposal of kind `refine-config`,
`refine-scope`, or `workflow-prompt-fix` (the kinds the LLM diagnosis pipeline
in `workflow_signal_generator.ts` actually produces), **nothing happens**. The
DB row flips `proposed -> applied` and stops dead — no config file is edited,
no skill body is rewritten, no test runs, nothing is measured, nothing is ever
reverted or retried.

Close that loop:
1. **Approved proposal → implemented.** Something (see "config-doctor" below)
   actually makes the concrete change the proposal describes — edits the real
   `agent_configs` row (model, allowedSkills, allowedDelegates) or rewrites the
   real skill body, via the real REST API (never raw SQL).
2. **Implemented → tested.** Re-run something that reproduces the original
   failure (or the existing session that errored) against the NEW config/skill
   and observe whether it now succeeds.
3. **Tested → measured decision.** If it's actually better, keep it (`active`).
   If it isn't, **revert AND send the proposal's evidence back to the
   optimizer's diagnosis step for another attempt** — not just revert-and-stop,
   which is all the system does today for the one measured path (`refine-skill`)
   that already has revert wired.
4. This whole loop is only "done" once verified with a **live end-to-end test
   against the real running server** — not vitest mocks. See "Hard gate" below.

## Branch & worktree

- Branch: `codex/mega-open-prs-2026-07-07`
- Worktree: `/Users/ajhochhalter/Documents/rhythm-worktrees/mega-open-prs-2026-07-07`
- Built on top of two just-merged commits on this branch:
  - `ff77347fe` — fixed the Gemini 512-function-declaration-cap bug that was
    silently zeroing out all LLM diagnosis proposals.
  - `7517c75ae` — split diagnosis signal grouping by error signature (not just
    skill) so unrelated failure modes for one agent get separate diagnoses
    instead of one overconfident lumped story.
  - Both fixes are verified live against the real running app; 11
    `refine-config`/`refine-scope`/`grant-delegation` proposals currently sit
    in `agent_org_proposals` with `status='proposed'` in the real dev DB
    (`~/Library/Application Support/Rhythm/rhythm.db`) — genuine, unreviewed
    test material for this next phase.

## What's already there (reuse this — do not reinvent)

- **State machine** (`agent_org_proposal.ts`): `proposed -> approved|rejected
  -> applied -> measuring -> active|reverted`. Already correct and general;
  this feature does not need a new status.
- **Approve route**: `POST /agent-org-proposals/:id/approve`
  (`org_proposals_controller.ts:62`) already re-validates and calls
  `applyProposal()` — the plumbing to trigger "do the thing" on human approval
  already exists and is already wired to the DB transition.
- **Applier registry**: `org_proposal_apply_service.ts:191-222`. Each kind
  registers its own `applier` function via `registerProposalApplier(kind,
  fn)`; anything not registered silently falls through to `defaultApplier()`
  (line 206) which returns `{measurable: false}` and does nothing. **This is
  the seam to fill** — register real appliers for `refine-config`,
  `refine-scope`, and `workflow-prompt-fix`.
- **Snapshot/revert mechanics**: `org_proposal_apply.ts`'s
  `applyAgentConfigScopeChange` (scope fields) and `revertProposal` (restores
  `before_snapshot_json` byte-for-byte) are the exact pattern to mirror for
  `refine-config` (model/other scalar fields) — same snapshot-before-mutate,
  same restore-on-revert.
- **Measure pattern for TEXT bodies** (skill-edit fixes only):
  `skill_refiner.ts`'s `defaultScorer`/`defaultJudge` + `org_proposal_measure.ts`
  (`post.score > baseline.score` → keep, else auto-revert) is already wired
  for `refine-skill`/`consolidate-skill`/`refine-recipe`. **`workflow-prompt-fix`
  is a skill-body edit — this existing LLM-judge pattern likely applies to it
  directly with no new measurement mechanism**, just a new applier that plugs
  into the existing measure step the same way `refine-skill` does.
- **`config-doctor`** (`~/.config/opencode/rhythm-managed-skills/config-doctor/SKILL.md`):
  exists today as a stateless, human-triggered diagnostic skill that talks to
  the live REST API (`npm run doctor`, `POST /agent-configs/<id>/resync-agent-file`)
  and explicitly never writes SQL directly. It is NOT currently dispatched
  programmatically by anything. The natural design here (confirm before
  building, don't assume): either (a) dispatch config-doctor as a real
  headless opencode session per approved proposal, using the SAME
  `createSession` + empty-mcpAllowlist pattern just fixed in
  `workflow_signal_generator.ts`'s `defaultDiagnose`, and have it call the
  real REST endpoints to make the edit; or (b) skip the LLM round-trip
  entirely for `refine-config`/`refine-scope` since the proposal's
  `changeJson.concreteFix` is already a deterministic field-level edit (model
  string, skill list add/remove) that can be applied directly like
  `applyAgentConfigScopeChange` already does for `tighten-scope` — no LLM
  needed to "implement" a change that's already fully specified. **Recommend
  starting with (b)** for `refine-config`/`refine-scope` (cheaper, more
  reliable, mirrors the existing scope-change applier almost exactly) and
  reserving an actual config-doctor dispatch for cases where the
  `concreteFix` text is genuinely unstructured prose that needs interpreting.
  Confirm this with the user before committing to a design — this doc is a
  starting point, not a locked decision.

## The genuinely new piece (nothing today does this)

**"Test to see if it's better"** for `refine-config`/`refine-scope` is NOT a
text-quality judgment (there's no body to score) — it's a **behavioral**
question: does the agent that was failing now succeed? The existing
LLM-judge/scorer measure pattern doesn't generalize to this. The measurement
step for these two kinds needs to:
- Re-run (or synthetically reproduce) the failure scenario the diagnosis was
  based on — e.g., replay the same task/prompt that produced one of the
  `evidence[].sessionId` sessions the proposal cites, now against the patched
  config — and check whether it errors again.
- Decide "better" based on real pass/fail of that re-run, not an LLM opinion.

**"If not better, the optimizer should get it back to rewrite"** — also new.
Nothing today re-feeds a reverted proposal's evidence back into
`proposeFixFromSignals`/`defaultDiagnose` for a second attempt. Needs:
- A way to mark a reverted proposal as "needs re-diagnosis" (a new dedup-key
  scheme so it doesn't just get silently re-skipped by `existsByDedupKeyAsync`
  the way a plain revert does today per `org_proposal_apply.ts`'s doc comment
  on why reverted rows stay in the table).
- The re-diagnosis call should tell the LLM what was already tried and that it
  failed, so it doesn't just propose the same fix again — this is the one
  place a genuinely new prompt/context shape is needed, not a reuse of
  existing code.

## Hard gate — this goal is not done without a live E2E test

Confirmed during research: **no live HTTP e2e test hitting the real running
server exists today** for any part of the proposal lifecycle. Everything
(`org_proposal_apply.test.ts`, `skill_apply_measure_e2e.test.ts`) uses
in-memory SQLite and injected fakes — real logic, but never a real HTTP
request against a real listening process.

This feature must ship with a test that:
1. Starts the **actual compiled** `api_server` (not vitest, not mocks) —
   `node dist/server.js --parent-pid=1` bypasses the ppid-watchdog that
   otherwise self-shuts-down when a backgrounding shell exits between steps.
2. Runs it **from inside the built app bundle**
   (`Contents/Resources/api_server`), not the bare `apps/api_server` source
   tree — the patched opencode fork (`opencode_bin/`) only exists in the
   bundle; running from source silently falls back to stock PATH opencode,
   which no-ops MCP allowlist scoping and produces false-negative test
   results (this cost real debugging time in the session that produced the
   two prior commits on this branch — see
   `docs/ai/runs/2026-07-07-org-optimizer-gemini-tool-cap-fix.md`'s
   "Debugging gotchas" section).
3. Drives the loop over real HTTP: seed a real failing signal → trigger
   `POST /agent-org-optimizer/run` → `POST /agent-org-proposals/:id/approve`
   → assert the real `agent_configs` row actually changed → assert measurement
   ran and produced a real keep/revert decision → for the revert case, assert
   the signal actually got re-queued for another diagnosis attempt.
4. Passes against the live server before this is reported as done. Unit/vitest
   coverage (mirroring `skill_apply_measure_e2e.test.ts`'s injected-fake style)
   is necessary but not sufficient — this feature's entire value proposition is
   "does the config-doctor's implementation actually get exercised against the
   real engine and real DB," which only a live run against the real server can
   prove.

## Key files

- `apps/api_server/src/services/generators/workflow_signal_generator.ts` — diagnosis + proposal creation (already fixed this session)
- `apps/api_server/src/services/org_proposal_apply_service.ts` — applier registry; register real appliers for the 3 kinds here (line 191-222)
- `apps/api_server/src/services/org_proposal_apply.ts` — snapshot/mutate/revert pattern to mirror for `refine-config`
- `apps/api_server/src/services/org_proposal_measure.ts` — existing measure step; extend or add a parallel behavioral-measure path
- `apps/api_server/src/services/skill_refiner.ts` — LLM judge/scorer pattern (reusable as-is for `workflow-prompt-fix`)
- `apps/api_server/src/controllers/org_proposals_controller.ts` — approve/reject/revert routes
- `apps/api_server/src/models/agent_org_proposal.ts` — status state machine
- `~/.config/opencode/rhythm-managed-skills/config-doctor/SKILL.md` — existing diagnostic skill, not yet dispatched programmatically
- `apps/api_server/src/__tests__/skill_apply_measure_e2e.test.ts` — closest existing test pattern to mirror (in-memory version); the NEW live-server test is additional, not a replacement
- `docs/ai/runs/2026-07-07-org-optimizer-gemini-tool-cap-fix.md` and `docs/ai/runs/2026-07-07-org-optimizer-gemini-tool-cap-fix.md`'s sibling commit — read both for the watchdog/`--parent-pid=1` and bundle-vs-source-tree gotchas before attempting any live server test

## Commands

```bash
# Build
cd apps/api_server && ./node_modules/.bin/tsc

# Copy to bundle (only way to get the real patched opencode fork resolved)
BUNDLE=apps/desktop_flutter/build/macos/Build/Products/Debug/Rhythm.app/Contents/Resources/api_server
cp apps/api_server/dist/services/*.js "$BUNDLE/dist/services/"
cp apps/api_server/dist/services/generators/*.js "$BUNDLE/dist/services/generators/"
cp apps/api_server/dist/controllers/*.js "$BUNDLE/dist/controllers/"

# Run standalone from the bundle, bypassing the watchdog
cd "$BUNDLE"
DB_PATH="/Users/ajhochhalter/Library/Application Support/Rhythm/rhythm.db" PORT=4001 AGENT_LOCAL=true RHYTHM_ROLE=all \
  nohup node dist/server.js --parent-pid=1 > /tmp/api_server_live.log 2>&1 < /dev/null &
disown

# Drive the loop
curl -s http://127.0.0.1:4001/agent-org-optimizer/run -X POST -H "content-type: application/json" -d '{"maxProposalsPerRun":5,"maxLlmCallsPerRun":5}'
curl -s http://127.0.0.1:4001/agent-org-proposals?status=proposed
curl -s http://127.0.0.1:4001/agent-org-proposals/<id>/approve -X POST -H "content-type: application/json" -d '{}'

# Kill standalone test server, relaunch real app when done
pkill -f 'dist/server.js --parent-pid=1'
open apps/desktop_flutter/build/macos/Build/Products/Debug/Rhythm.app
```

## Rules

- Dispatch **haiku** agents for code reading and research.
- Use **sonnet** for writing code.
- Use **opus** for planning.
- Do not build a new measurement mechanism for `workflow-prompt-fix` — reuse
  `skill_refiner.ts`'s existing scorer/judge as-is.
- Do not skip the live-server E2E gate above by calling vitest-mocked coverage
  "done" — this is an explicit, non-negotiable acceptance requirement for this
  goal, not a nice-to-have.
- Confirm the config-doctor dispatch-vs-direct-apply design choice (see "What's
  already there" above) with the user before committing to it; this doc
  recommends direct apply for `refine-config`/`refine-scope` but that is a
  recommendation, not a decision already made.

## Goal

The org self-optimizer's approve → implement → measure → keep-or-rewrite loop
runs end-to-end against the real server: approving a `refine-config` or
`refine-scope` proposal actually mutates the real agent config, a real
behavioral re-test decides keep-vs-revert, and a reverted proposal's evidence
is automatically re-submitted to the diagnosis pipeline for another attempt
rather than dying silently. Verified by a live HTTP test against the actual
running server, not mocks.

---

## FINALIZED ISSUE BREAKDOWN (planning-agent, 2026-07-07)

Confirmed decisions folded in: DIRECT APPLY for `refine-config`/`refine-scope`
(no LLM/config-doctor dispatch); `workflow-prompt-fix` reuses the existing
`skill_refiner` scorer/judge measure path unchanged; issues are local files
only; work stays on `codex/mega-open-prs-2026-07-07`.

Planning findings that shaped the boundaries (verified against source):

- **F1 — changeJson is prose today.** `proposeFixFromSignals`
  (`workflow_signal_generator.ts:508`) stores `concreteFix` as free text
  ("specify the field+value" per the prompt at line 153). Direct apply needs a
  machine-applyable patch, so the diagnosis output schema must be extended
  FIRST (issue 1) — the appliers (issue 2) consume the structured shape.
- **F2 — approve currently 400s for these kinds.** `validateProposalChange`
  fails closed on any kind with no registered validator; none exists for
  `refine-config`/`refine-scope`/`workflow-prompt-fix`. Issue 2/4 register
  validators + appliers.
- **F3 — human-approved proposals are never measured.** The approve route
  transitions the row to `measuring` when `measurable: true`, but
  `measureProposal` is only invoked by `org_optimizer_run_service.ts:364` on
  proposals the run itself just created. A human-approved row would sit in
  `measuring` forever. Issue 3 closes this (measure sweep of `measuring` rows
  at the start of each optimizer run + immediately after approve).
- **F4 — measureProposal skips unknown kinds** (`org_proposal_measure.ts:152`),
  so the behavioral branch is additive, no refactor of existing paths.
- **F5 — the consolidate-skill precedent** (`applyConsolidateSkillChange` +
  `skill_consolidation_drafter.ts`) is the exact pattern for
  `workflow-prompt-fix`: draft at apply time, reshape `change_json` into
  `BodyRefinementChange`, and the existing `measureBodyRefinement` path
  handles it with zero changes.

### Issue 1 — Structured fix patch in the diagnosis output for config/scope fixes

**Problem.** `defaultDiagnose`'s JSON schema only yields prose (`concreteFix`
text). A deterministic direct applier for `refine-config`/`refine-scope`
cannot safely parse "set model to gemini-2.5-pro" out of free text. Extend the
diagnosis output so `config-change`/`scope-change` diagnoses also emit a
structured, machine-applyable patch; keep `concreteFix` prose for the human
review UI.

**Acceptance criteria.**
- Diagnosis prompt + `DiagnosisResult` parsing accept an optional structured
  patch: for `config-change` → `configPatch: { agentConfigId, field:
  'model'|'allowedSkillsJson'|'allowedDelegatesJson', value }`; for
  `scope-change` → `scopePatch: { agentConfigId, field:
  'allowedMcpsJson'|'allowedSkillsJson', add?: string[], remove?: string[] }`
  (reusing the existing `AgentConfigScopeChange` shape from
  `org_proposal_apply.ts` for the scope case).
- The patch's `agentConfigId` is resolved/validated server-side from the
  signal's profile (the LLM names the profile; the generator resolves the id
  via `AgentConfigsRepository` — never trust an LLM-emitted row id).
- `changeJson` persisted on `refine-config`/`refine-scope` proposals carries
  the structured patch alongside the existing prose/evidence fields.
- A diagnosis missing/malformed the structured patch still creates the
  proposal (prose-only) — it will be refused at approve time by issue 2's
  validator with an actionable reason, not dropped silently here.
- Unit tests: parse round-trip of both patch shapes; malformed patch degrades
  to prose-only; agentConfigId resolution from profile name.

**Files.** `apps/api_server/src/services/generators/workflow_signal_generator.ts`,
`apps/api_server/src/__tests__/` (existing workflow_signal_generator tests).

**Depends on.** Nothing. **Blocks.** Issues 2, 6.

**Validation.** `cd apps/api_server && npx vitest run src/__tests__/workflow_signal_generator*` + `./node_modules/.bin/tsc --noEmit`.

### Issue 2 — Direct-apply appliers + validators for refine-config / refine-scope

**Problem.** Approving a `refine-config`/`refine-scope` proposal 400s today
(fail-closed, no validator) and even with a validator would fall through to
`defaultApplier` (no-op, `measurable: false`). Register real appliers that
deterministically mutate the real `agent_configs` row, snapshot-before-mutate,
mirroring `applyAgentConfigScopeChange`.

**Acceptance criteria.**
- `registerAllProposalAppliers` (org_proposal_appliers_wiring.ts) registers,
  for both kinds: a validator (structured patch present + target
  `agent_configs` row exists + field is on the allowlist of mutable fields)
  and an applier.
- Applier: reads current field value from `AgentConfigsRepository`, returns
  `{ measurable: true, beforeSnapshotJson }` where the snapshot is
  `{ agentConfigId, field, priorValue }`; mutates via the repository update
  path (same layer `applyAgentConfigScopeChange` uses — no raw SQL); for
  scope fields applies add/remove set arithmetic, for `model` a scalar swap.
- If the agent config was projected to an opencode agent file, the applier
  triggers the same resync the REST config update path performs (reuse the
  existing writer/projection path in `opencode_agent_writer.ts` — do not
  fork a second write path).
- `revertProposal` (org_proposal_apply.ts) restores the snapshot for these
  kinds (extend its snapshot dispatch; the scope case already works via
  `isAgentConfigScopeChange` — cover the `model`/scalar case).
- Prose-only proposals (no structured patch, issue 1's degrade case) are
  refused at validation with a reason naming the missing patch — visible in
  the approve route's 400 body.
- Unit tests mirroring `org_proposal_apply.test.ts` style: apply mutates +
  snapshots; revert restores byte-for-byte; validator refuses missing
  target/patch; approve route integration (in-memory) drives
  `proposed -> applied -> measuring`.

**Files.** `apps/api_server/src/services/org_proposal_appliers_wiring.ts`
(or a new `generators/config_fix_applier.ts` registered from the wiring
module, matching the per-generator pattern), `org_proposal_apply.ts` (revert
dispatch), tests.

**Depends on.** Issue 1. **Blocks.** Issues 3, 6.

**Validation.** `npx vitest run src/__tests__/org_proposal*` + tsc; quick live
curl of `POST /agent-org-proposals/:id/approve` against one of the 11 real
`proposed` rows in the dev DB, asserting the `agent_configs` row changed.

### Issue 3 — Behavioral measurement (re-run the failing scenario) + measure sweep

**Problem.** `measureProposal` skips `refine-config`/`refine-scope` (kind not
handled), and nothing ever measures human-approved proposals at all (F3): the
approve route leaves the row in `measuring` and the optimizer run loop only
measures proposals it created itself. Add a behavioral measure path — re-run
the failing scenario against the patched config and keep/revert on real
pass/fail — and a sweep so `measuring` rows always get measured.

**Acceptance criteria.**
- New branch in `org_proposal_measure.ts` for `refine-config`/`refine-scope`:
  reproduce the failure scenario cited by the proposal's `evidence[]`
  (replay the originating prompt/task from one of the `sessionIds` sessions as
  a fresh headless session under the patched profile — same
  `createSession` + empty-mcpAllowlist pattern as
  `workflow_signal_generator.ts`'s `defaultDiagnose`), injectable as
  `deps.rerunScenario` for tests.
- Keep iff the re-run completes without the original failure signature
  (reuse the signal-extraction predicate the workflow signal generator uses
  to classify a session as failed); revert otherwise. Re-run infrastructure
  error (engine down, timeout) → `skipped` (stays `measuring`), never a
  guessy keep — fail toward another pass, matching the module's envelope.
- `measureReason` records what was re-run and the observed outcome;
  revert goes through the same `doRevert` so audit fields persist atomically.
- Measure sweep: `runOrgOptimizer` gains a step that lists ALL rows in
  `status='measuring'` (not just this run's) and calls `measureProposal` on
  each — this is how human-approved rows get measured. The approve route
  additionally fire-and-forgets a measure attempt so the common case doesn't
  wait for the next cron run.
- Unit tests: pass → `active`; fail → `reverted` + config restored; infra
  error → still `measuring`; sweep picks up an externally-approved row.

**Files.** `apps/api_server/src/services/org_proposal_measure.ts`,
`org_optimizer_run_service.ts`, `controllers/org_proposals_controller.ts`,
possibly a small `org_behavior_rerun.ts` helper, tests.

**Depends on.** Issue 2. **Blocks.** Issues 5, 6.

**Validation.** `npx vitest run src/__tests__/org_proposal_measure* src/__tests__/org_optimizer_run*` + tsc.

### Issue 4 — workflow-prompt-fix applier via the existing skill-refiner measure path

**Problem.** `workflow-prompt-fix` (skill-edit diagnoses) has no applier: the
proposal carries the fix paragraph in `concreteFix` but nothing ever edits the
skill body. Mirror the consolidate-skill precedent (F5): draft the revised
body at apply time, reshape `change_json` into `BodyRefinementChange`, and let
the EXISTING `measureBodyRefinement` LLM-judge path decide keep/revert — no
new measurement mechanism.

**Acceptance criteria.**
- Registered validator + applier for `workflow-prompt-fix`: resolve the live
  skill by `targetRef`/`affectedSkill` (missing skill → refuse/skip, stale
  signal); draft `revisedBody` by applying `concreteFix` to the current body;
  snapshot `{ skillId, priorBody, priorStatus }`; write the revised body via
  `AgentSkillsRepository` + `writeManagedSkill` (same sequence the skill loop
  and external-adoption applier use); rewrite `change_json` to the
  `BodyRefinementChange` shape (`priorBody`/`revisedBody`/`skillName`);
  return `{ measurable: true, beforeSnapshotJson }`.
- `measureProposal`'s body-refinement branch accepts kind
  `workflow-prompt-fix` (one-line kind-list addition — scorer/judge untouched).
- `revertProposal` restores the skill body + managed file for this kind's
  snapshot shape.
- Unit tests in the `skill_apply_measure_e2e.test.ts` injected-fake style:
  improving fix → `active` + body kept; non-improving → `reverted` + body
  restored byte-identical (including the managed SKILL.md write-back).

**Files.** wiring module or new `generators/prompt_fix_applier.ts`,
`org_proposal_measure.ts` (kind list), `org_proposal_apply.ts` (revert
dispatch), tests.

**Depends on.** Nothing hard (parallel with 2/3; shares only the wiring file).
**Blocks.** Issue 6 (its live path exercises this kind if a skill-edit
proposal exists; otherwise 6's mandatory path is config/scope).

**Validation.** `npx vitest run src/__tests__/org_proposal* src/__tests__/skill_apply_measure_e2e*` + tsc.

### Issue 5 — Re-diagnosis feedback: reverted proposals re-enter the diagnosis pipeline

**Problem.** A reverted proposal dies silently: the row keeps its `dedup_key`,
so `existsByDedupKeyAsync` blocks any future diagnosis of the same failure
mode forever (`workflow_signal_generator.ts:478`). Nothing tells the next
diagnosis what was already tried. Reverted optimizer-diagnosed proposals must
get another attempt with "what was tried and failed" context.

**Acceptance criteria.**
- Attempt-aware dedup scheme: dedup key gains an attempt suffix (e.g.
  `workflow-fix:<skill>:<evidenceHash>:a2`); the dedup check for a signal
  group consults prior attempts — a `reverted` (or measure-failed) prior
  attempt does NOT block the next attempt, but `active`/`rejected`/`proposed`
  ones still do; a bounded max-attempts cap (e.g. 3) prevents infinite
  loops, after which the failure mode is parked (logged, still deduped).
- `buildDiagnosisContext` includes, when prior attempts exist, a "previously
  attempted fixes" section: each prior attempt's kind, concrete
  patch/fix, and `measureReason` (why it was reverted) — so the LLM is
  explicitly told not to re-propose the same change. This is the only new
  prompt surface in the whole feature.
- The plain revert-and-stop behavior for NON-diagnosis kinds
  (tighten-scope/prune-scope etc.) is unchanged — the attempt scheme applies
  only to the `workflow-fix:*` dedup family.
- Unit tests: reverted attempt-1 allows attempt-2 with new key; active
  attempt-1 still dedups; cap parks after N; context builder includes the
  prior-attempt section verbatim from `measureReason`.

**Files.** `workflow_signal_generator.ts` (dedup + context),
`agent_org_proposals_repository.ts` (attempt-aware lookup helper if needed),
tests.

**Depends on.** Issue 3 (needs real revert outcomes + `measureReason` to feed
back). **Blocks.** Issue 6.

**Validation.** `npx vitest run src/__tests__/workflow_signal_generator*` + tsc.

### Issue 6 — Live HTTP E2E gate against the real running server

**Problem.** No live HTTP e2e test exists for any part of the proposal
lifecycle; everything is in-memory SQLite + fakes. This goal's value
proposition — "the loop actually runs against the real engine and real DB" —
is only provable live. This is the explicit, non-negotiable acceptance gate;
it is its own issue so it is independently tracked, but issues 2–5 each carry
their own unit coverage plus a quick live curl check so this issue is
integration proof, not the sole verification.

**Acceptance criteria.**
- A repeatable script/test (e.g. `apps/api_server/scripts/live_e2e_org_loop.sh`
  or a vitest file tagged live-only and excluded from CI) that:
  1. Builds (`tsc`), copies dist into the app bundle
     (`Contents/Resources/api_server`) per the Commands section — MUST run
     from the bundle so the patched opencode fork resolves (not stock PATH
     opencode).
  2. Starts `node dist/server.js --parent-pid=1` with
     `DB_PATH=<real dev db> PORT=4001 AGENT_LOCAL=true RHYTHM_ROLE=all`.
  3. Over real HTTP: seeds/uses a real failing signal → `POST
     /agent-org-optimizer/run` → picks a `refine-config` or `refine-scope`
     proposal → `POST /agent-org-proposals/:id/approve` → asserts via `GET
     /agent-configs/:id` that the real row changed → polls until the proposal
     leaves `measuring` with a real keep (`active`) or revert (`reverted`)
     decision → for a revert, asserts the config row was restored AND a
     fresh attempt-2 diagnosis is permitted (attempt-suffixed dedup key
     present / re-run creates a new proposal for the same failure mode).
  4. Kills the standalone server (`pkill -f 'dist/server.js --parent-pid=1'`)
     even on failure (trap).
- The run's evidence (curl outputs / row states before-after) is captured in
  a `docs/ai/runs/` log; the feature is not reported done without a passing
  live run.

**Files.** new script/test under `apps/api_server`, `docs/ai/runs/` log.

**Depends on.** Issues 1, 2, 3, 5 (4 optional for the mandatory path).

**Validation.** The script itself, run to completion against the live server.

### Dependency order

```
1 (structured patch) ──> 2 (direct appliers) ──> 3 (behavioral measure + sweep) ──> 5 (re-diagnosis) ──> 6 (live E2E)
4 (workflow-prompt-fix applier) ── independent; land any time before 6
```

| # | Issue | Depends on |
|---|-------|-----------|
| 1 | Structured fix patch in diagnosis output | — |
| 2 | Direct-apply appliers/validators for refine-config/refine-scope | 1 |
| 3 | Behavioral measurement + measuring-row sweep | 2 |
| 4 | workflow-prompt-fix applier via existing skill-refiner path | — |
| 5 | Re-diagnosis feedback with attempt-aware dedup | 3 |
| 6 | Live HTTP E2E gate | 1,2,3,5 (4 soft) |

### Open questions (non-blocking, defaults chosen)

- **Q1:** Which `agent_configs` fields are legal for `refine-config` direct
  apply? Default: `model`, `allowedSkillsJson`, `allowedDelegatesJson` (per
  the upfront alignment); anything else is refused by the issue-2 validator.
- **Q2:** Behavioral re-run cost — one headless session per measured proposal.
  Default: cap re-runs per optimizer run (reuse the existing
  `maxLlmCallsPerRun`-style budget) and time-box the session.
- **Q3:** Max re-diagnosis attempts. Default 3, constant, not configurable.
- **Q4:** For `workflow-prompt-fix`, "apply concreteFix to the body" is
  drafted deterministically (append/patch per the prompt's "paste the
  paragraph to add" contract) — if real diagnoses turn out to emit diffs or
  rewrites instead of paragraphs, issue 4 may need a drafter LLM call
  mirroring `skill_consolidation_drafter.ts`; decide from the 11 real
  proposals' actual payloads during implementation.

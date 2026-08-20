---
date: 2026-08-19
repo: Rhythm
branch: agent-stack/si-d2-post-apply-lifecycle
pr: 1454
issues: [1434]
status: ready-for-verification
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# D2.4 (#1434) — auto-revert with alert after failed repairs

Fourth issue of the D2 series. Depends on D2.1 (#1431, PostApplyEvent model),
D2.2 (#1432, guardrail monitor), D2.3 (#1433, bounded 3-strike auto-repair —
landed as a8f0607d, draft PR #1454). Two prior dispatches for this exact
issue died on a provider usage-limit error before writing anything; this was
a clean start (verified: no `auto_revert_service` files existed, tree clean).

Implements `apps/api_server/src/services/auto_revert_service.ts` —
`runAutoRevertAsync(event, deps)` — reverting the profile targeted by a
`tripped` PostApplyEvent back to its state before the originally-applied
proposal, once D2.3's repair loop has exhausted all 3 attempts, and
recording a redacted alert with the full trail.

## Sharp-edge investigation (as requested by the dispatch)

**Verdict: not a hazard for this implementation, but a real latent hazard
for a different column if ever repurposed.**

`PostApplyEvent.preChangeSnapshotJson` IS run through `redactSecrets()` at
write time (`post_apply_events_repository.ts`, both `createAsync` and
`updateStatusAsync`) — same treatment as `alert_payload_json`. If this
column were ever used as the *restoration* source for a live config write,
a secret-shaped `priorValue` would silently restore as the literal string
`"[redacted]"` — real corruption, exactly the concern raised.

This service does not hit that hazard because it never restores from that
column. The actual value-bearing snapshot for a `refine-config` change is
`AgentOrgProposal.beforeSnapshotJson` — a separate column, on a separate
table (`agent_org_proposals`), written by whichever applier performed the
original apply (`refineConfigApplier` for the human-gated path; a direct
`AgentOrgProposalsRepository.createAsync` call for D2.3's own repair
proposals). Confirmed by reading every call site: only
`post_apply_events_repository.ts` imports/calls `redactSecrets`;
`agent_org_proposals_repository.ts` does not, anywhere. `revertProposal()`
(the codebase's own generic revert primitive) reads from this exact
unredacted column for its config-field restore branch, and this service now
routes restoration through that primitive directly.

Pinned with a dedicated regression test: plants a Bearer-token-shaped string
as a `system_prompt` `priorValue` on `AgentOrgProposal.beforeSnapshotJson`,
reverts, and asserts the live `agent_configs.system_prompt` is restored
byte-exact (not `"[redacted]"`). This test would fail immediately if a
future change ever routed the restoration path through `redactSecrets`.

**Follow-up worth filing:** if D2.5 (wiring the real apply boundary) or any
future caller ever repurposes `PostApplyEvent.preChangeSnapshotJson` as a
restoration source instead of the documented opaque CAS pointer, it will hit
this exact corruption bug. The model's own doc comment already warns
against this ("never the prior field VALUE itself") but there's no
type-level enforcement — worth a lint/doc guard or a follow-up issue.

## Superseded investigation: refine-config false positive

The initial implementation found that `org_proposal_apply.ts`'s
`revertProposal()` could not handle this path because its
`containsScopeBearingPayload()` legacy-scope guard refuses ANY `changeJson`
whose payload has `agentConfigId` co-occurring with a `field`/`value` key
anywhere in the object tree, unless `beforeSnapshotJson` also carries a
scope-v2 `version` tag. That is *exactly* the shape `refineConfigApplier`'s
own validator requires ("a machine-applyable configPatch {agentConfigId,
field, value}") and the shape D2.3's repair proposals use.

Confirmed empirically (scratch test, deleted after use):
`containsScopeBearingPayload({configPatch:{agentConfigId,field:'model',
value:'x'}})` → `true`. Routing this service's real-world `changeJson`
through `revertProposal` would refuse **every** revert as
`'unsafe-legacy-scope'`.

That temporary bypass was superseded in the root-cause pass below.
`extractValidatedConfigPatch` now narrows only recognized machine-applicable
patches before the scope detector runs, and `runAutoRevertAsync` calls
`revertProposal` directly. Unsupported fields remain unnarrowed and fail
closed; the human and unattended revert paths now share one implementation.

## Revert algorithm

1. No-op (`outcome: 'not-tripped'`) if `event.guardrailStatus !== 'tripped'`.
2. Load the original proposal (`event.proposalId`) and the repair trail
   (`event.repairProposalIdsJson`, each looked up for title/rationale/status).
3. Pre-checks (each maps to `revert_failed` with conflict details): proposal
   missing, no `beforeSnapshotJson`, or `proposal.status !== 'applied'` (the
   only status it should be in through the whole monitor → repair → revert
   lifecycle — anything else means it drifted, e.g. a human already reverted
   it, or the unrelated org-optimizer measure sweep picked it up first).
4. **CAS transition `applied → measuring`** with `expectedRevision` set to
   the proposal's own revision just read — the same optimistic-concurrency
   primitive `OrgProposalsController.approve()` / D2.3's
   `claimAppliedWithSnapshotAsync` use. The proposal state machine forbids
   `applied → reverted` directly (`ALLOWED_TRANSITIONS` in
   `agent_org_proposals_repository.ts`), so this hop is structurally
   required — and it doubles as the drift/conflict detector for
   issue-1434-c2: any concurrent state change on this exact row throws here.
5. Call `revertProposal` for snapshot validation, the config restore or
   fail-closed refusal, projection, and the final `measuring → reverted`
   transition.
7. **Independent post-write verification**: re-read the live field and
   assert it equals the snapshot's `priorValue`; a mismatch downgrades to
   `revert_failed` even though the DB transition committed.
8. Build and persist the alert (`{proposalId, profileId, changeType,
   originalChange, repairAttempts, revert}`) via
   `PostApplyEventsRepository.updateStatusAsync`, which already redacts
   `alert_payload_json` through `redactSecrets` on write — no manual
   redaction needed here.

## Files changed (new files only — no existing file touched)

- `apps/api_server/src/services/auto_revert_service.ts` (new)
- `apps/api_server/src/services/__tests__/auto_revert_service.test.ts` (new)
- `docs/ai/contracts/issue-1434.json` (new)
- `docs/ai/runs/2026-08-19-d2-4-auto-revert-service.md` (this file, new)

## Checks

RED (before implementation — confirmed failing, not erroring-into-a-pass):

```
cd apps/api_server
npx vitest run src/services/__tests__/auto_revert_service.test.ts
# FAIL — Error: Cannot find module '../auto_revert_service'
```

GREEN (after implementation):

```
cd apps/api_server
npx vitest run src/services/__tests__/auto_revert_service.test.ts
```
→ **1 file, 6 tests, all pass.**

Regression (D2.1–D2.3 + the proposal-apply/CAS machinery this reuses):

```
cd apps/api_server
npx vitest run \
  src/services/__tests__/auto_repair_service.test.ts \
  src/services/__tests__/post_apply_monitor.test.ts \
  src/repositories/__tests__/post_apply_events_repository.test.ts \
  src/models/__tests__/post_apply_event.test.ts \
  src/services/__tests__/org_proposal_measure.test.ts \
  src/__tests__/org_proposal_apply.test.ts \
  src/__tests__/org_proposals_routes.test.ts
```
→ **7 files, 171 tests, all pass.**

- `node_modules/.bin/tsc --noEmit` → clean (one real error found and fixed
  along the way: `ProjectionCause` has no `'auto-revert'` member — switched
  to the existing `'scope-revert'` cause, matching `revertProposal`'s own
  usage for this exact restore shape).
- `npm run build` → PASS (tsc + postbuild copy).
- `docs/ai/contracts/issue-1434.json`: 6/6 criteria pass.
- `git status --porcelain` (worktree root): only the two new service/test
  files are untracked — no existing file was modified.
- GitNexus `detect_changes({scope:'all', worktree:...})`: reported 0 changed
  symbols (new untracked files aren't picked up by `git diff` until staged —
  same limitation D2.3's run note recorded). Not a blocker; verification-gate
  re-runs this after staging.

Not run in this session (verification-gate's / workflow-orchestrator's
scope per the dispatch): full `apps/api_server` suite, Flutter
format/analyze, live sandbox/behavioral E2E, PR creation. This is a pure
unit-level service change with no new HTTP/WS entry point and no wiring into
the live trigger registry yet (that remains D2.5's scope, matching D2.2's
and D2.3's own run notes) — internal DB/service-layer logic exercised
deterministically by the contract test above.

## Deviations / residual risk

- The initial direct-helper restore was superseded. The current service calls
  `org_proposal_apply.ts`'s `revertProposal` directly, so human and unattended
  config restoration/refusal behavior cannot drift independently.
- No config-VALUE-level CAS (comparing the live field byte-for-byte against
  an "expected currently-applied" value before writing) — only the
  proposal's own revision is guarded, matching every other non-scope revert
  in this codebase (`revertProposal`'s own `isConfigFieldSnapshot` branch has
  none either). Marked with a `ponytail:` comment and an upgrade path in the
  code.
- Not wired into `auto_repair_service.ts`'s `registerAutoRevertTrigger` —
  that boundary is explicitly D2.5's scope (per D2.3's own docstring: "D2.5 /
  D2.4 boundary"), and the dispatch's estimated file list was
  `auto_revert_service.ts` only.
- One follow-up candidate remains: the preChangeSnapshotJson restoration
  hazard if that redacted column is ever repurposed. The refine-config false
  positive was fixed in the root-cause pass below.

## Superseded interim security fix (second pass, same day)

Post-implementation review found a reachable hole in the initial direct-helper
implementation: bypassing `revertProposal` also silently
bypassed `revertProposal`'s own `isConfigFieldSnapshot` else-if branch that
**refuses** a whole-field revert of `allowedMcpsJson` / `allowedSkillsJson`
/ `corePermissionsJson` (`'unsafe-legacy-scope'`) — a fail-closed guard
because a whole-field snapshot can't distinguish a safe rollback from
clobbering a LATER operator edit to that same allowlist. Since
`allowedSkillsJson` is in `CONFIG_PATCH_FIELDS` (a legal `refine-config`
repair target D2.3's own auto-repair already uses), this was reachable, not
theoretical: an exhausted-repair scenario on an `allowedSkillsJson` field
would have let this service silently overwrite an operator's later skill-
scope edit — automatically, with no human in the loop — doing exactly what
a human's `#857` manual `/revert` is forbidden from doing.

**Interim fix (later removed):** exported `UNSAFE_WHOLE_FIELD_SCOPE_FIELDS` (`['allowedMcpsJson',
'allowedSkillsJson', 'corePermissionsJson']`) from `org_proposal_apply.ts`
— previously an inline literal in `revertProposal`'s else-if — and reused
it in BOTH places: `revertProposal`'s own check (now reads the constant
instead of three `===` literals) and a new refusal check in
`auto_revert_service.ts`, inserted right before the field-restore write.
On refusal, the existing `fail()` helper is reused unchanged: it records
`revert_failed` with `{reason: 'unsafe-legacy-scope', field, proposalId}`
as conflict details and still generates the full-trail alert — the same
shape issue #1434 already specified for a CAS revert failure, not a new
status. `allowedDelegatesJson` (also in `CONFIG_PATCH_FIELDS`) is
deliberately left OUT of the refused set, matching `revertProposal`'s
existing scope exactly. The later root-cause pass routed through
`revertProposal` and deleted this duplicate service-side guard while keeping
the regression test.

Added one regression test (`'security fix (#1434): refuses a whole-field
revert of allowedSkillsJson...'`) that seeds a full exhausted-repair
scenario (original `applied` proposal + 3 `applied` repair proposals, all
targeting `allowedSkillsJson`) and asserts: outcome is `revert_failed`
(not `reverted`), the live `agent_configs.allowedSkillsJson` is
byte-for-byte unchanged from what the last repair left it as, the original
proposal's status is NOT flipped to `reverted`, and an alert is still
persisted. **Falsified the test**: temporarily short-circuited the new
guard (`if (false && ...)`), re-ran — the test went red exactly as
expected (`outcome` was `'reverted'`, the live config was silently
clobbered back to the pre-change value), confirming the test actually pins
the property. Restored the guard — green again.

Checks after the fix:

```
cd apps/api_server
npx vitest run src/services/__tests__/auto_revert_service.test.ts
# 1 file, 7 tests, all pass (was 6; +1 new security regression test)

npx vitest run \
  src/services/__tests__/auto_repair_service.test.ts \
  src/__tests__/org_proposal_apply.test.ts \
  src/__tests__/issue_857_contract.test.ts \
  src/__tests__/w1_corrective_4_contract.test.ts
# 4 files, 160 tests, all pass

node_modules/.bin/tsc --noEmit   # clean
npm run build                    # PASS
```

`git status --porcelain` (worktree root): one existing file modified
(`org_proposal_apply.ts`, to export the shared constant and use it in the
existing `revertProposal` branch) plus the two D2.4 files from the first
pass (still untracked) and this doc/contract update — no other file
touched. GitNexus `detect_changes({scope:'all', worktree:...})`: 0 changed
symbols detected (same known limitation as the first pass — new/modified
files in this worktree aren't reflected in the indexed snapshot; not a
blocker, verification-gate re-runs after staging).

Not run in this pass (unchanged from the first pass's stated scope): full
`apps/api_server` suite, Flutter format/analyze, live sandbox/behavioral
E2E, PR creation.

## ROOT-CAUSE FIX (third session, same day): revertProposal fixed, interim guard deleted

The dispatch for this session asked for the root-cause fix the second pass's
"second sharp edge" identified but didn't fix: `org_proposal_apply.ts`'s
`revertProposal()` misclassifies EVERY refine-config `changeJson`
(`{configPatch:{agentConfigId,field,value}}`) as scope-bearing and refuses it
as `'unsafe-legacy-scope'` before it ever reaches its own config-field
restore branch (`isConfigFieldSnapshot`, ~951) or its own
`UNSAFE_WHOLE_FIELD_SCOPE_FIELDS` refusal branch (~946) — both of which
already existed and already handle exactly this snapshot shape correctly.
This is also the reason `#857`'s human manual `/revert` has been broken for
any `refine-config` proposal with a full `field`+`value` `configPatch`,
independent of D2.4.

### Root cause

`revertProposal` line ~741:
`isScopeBearing = isScopeMutationKind || containsScopeBearingPayload(change)`.
`change` is the raw parsed `changeJson`. `containsScopeBearingPayload`
(`scope_mutation_contract.ts`) treats a bare `{agentConfigId, field, value}`
object as scope-bearing **on its own**, at any depth: an object with an
`agentConfigId` key sets `target=true`, an object with a `field` (and
`value`) key sets `operation=true`, and `combine()` propagates a child's
`detected` result upward through `if (child.detected) return unsafe;`
regardless of the parent's own keys. So
`containsScopeBearingPayload({configPatch:{agentConfigId,field:'model',
value:'x'}})` is `true` unconditionally — for `refine-config`,
`isScopeMutationKind` is `false`, so this was the ENTIRE `isScopeBearing`
value, misfiring on every single refine-config revert.

### Fix: reuse the apply path's own narrowing, made shared

`org_proposal_apply_service.ts`'s `strictChangeJsonPreflight` already solved
this identical problem for its own refine-config validation gate (lines
~248-283 pre-fix): split a validated `configPatch` subtree out of the
payload (re-attaching `agentConfigId` to the remainder) before running
`containsScopeBearingPayload` on "everything outside the patch". Extracted
that inline logic into a new exported function,
`extractValidatedConfigPatch(parsed)`, in `org_proposal_apply_service.ts`
(no existing exported helper existed to reuse as-is — this module's own
logic was the closest thing, so it became the shared source). Both modules
now call it:

- `org_proposal_apply_service.ts`'s `strictChangeJsonPreflight` — replaced
  its hand-rolled `outsideConfigPatch` construction with a call to the new
  function (the pre-existing "extras" and "protected field" throws stay
  exactly as they were, unchanged, running BEFORE this call).
- `org_proposal_apply.ts`'s `revertProposal` — narrows `change` through
  `extractValidatedConfigPatch` before the `containsScopeBearingPayload`
  check at line ~741.

`extractValidatedConfigPatch` is STRICTER than the apply path's original
inline check: it additionally requires `configPatch.field` to be a genuine
`CONFIG_PATCH_FIELDS` member (`org_diagnosis_types.ts:116` — `model`,
`allowedSkillsJson`, `allowedDelegatesJson`, `system_prompt`), not merely any
`{agentConfigId,field,value}`-shaped object with no extra keys. A malformed
or unrecognized field now fails closed — no narrowing, the FULL payload runs
through the scope-bearing check — rather than silently narrowing past an
unrecognized field. Verified this doesn't regress any existing test: grepped
every `configPatch.field` literal used across the whole test suite (`model`,
`allowedSkillsJson`, `system_prompt`, `temperature`); the one non-member
(`temperature`) appears only in `org_proposal_experiment_service.test.ts`,
which tests `reserveRunEnrollment`, never `strictChangeJsonPreflight` /
`validateProposalChange` — unaffected.

No circular import risk: `org_proposal_apply_service.ts` and its own
dependencies (`scope_mutation_contract.ts`, `strict_json.ts`,
`org_diagnosis_types.ts`) do not import `org_proposal_apply.ts` anywhere —
confirmed by grep before adding the import — so
`org_proposal_apply.ts -> org_proposal_apply_service.ts` is a one-directional
edge.

### auto_revert_service.ts: routed through revertProposal, interim guard deleted

With `revertProposal` fixed, `runAutoRevertAsync` now:

1. Still performs its OWN CAS-guarded `applied -> measuring` transition first
   (unchanged — `revertProposal` does not perform this hop; the proposal
   state machine forbids `applied -> reverted` directly, and `revertProposal`
   expects a proposal already sitting at a revertable status). This remains
   the drift/conflict detector for issue-1434-c2.
2. Calls `revertProposal(measuring, {proposalsRepo, configsRepo})` for the
   actual restore (or refusal) and the final `measuring -> reverted`
   transition — replacing the hand-rolled
   `agentConfigFieldPatch`/`readAgentConfigField`/`projectAgentProfileAfterWrite`
   sequence entirely.
3. The interim `UNSAFE_WHOLE_FIELD_SCOPE_FIELDS` guard added in session
   631c9409 is DELETED — `revertProposal` itself now returns
   `'unsafe-legacy-scope'` for exactly the same case (whole-field revert of
   `allowedMcpsJson`/`allowedSkillsJson`/`corePermissionsJson`), mapped onto
   the existing `revert_failed` / `{reason:'unsafe-legacy-scope', field,
   proposalId}` shape.
4. Keeps an independent post-write verification (re-reading the live field
   and comparing to the snapshot's `priorValue`) as defense-in-depth on top
   of `revertProposal`'s own write — unchanged from the original design.

**A clear "yes" on the routing question**: no blocker was hit. `revertProposal`
is now called directly; nothing was force-fit or partially bypassed.

### Existing test assertions reviewed (dispatch's explicit "critical" list)

Every one of the six flagged assertions (`org_proposal_apply.test.ts` lines
~262, ~343, ~587, ~614, ~746; `w1_corrective_4_contract.test.ts` line ~364)
was read in full context (kind + changeJson) BEFORE running anything. **All
six use a scope-mutation proposal kind** (`tighten-scope` / `prune-scope` /
`refine-scope` / `broaden-scope`), where `isScopeMutationKind` is already
`true` and short-circuits `isScopeBearing` to `true` via the `||` regardless
of the `containsScopeBearingPayload` narrowing. **None of them exercise a
refine-config (or any other non-scope-kind) changeJson shaped like a
configPatch** — so none of them were affected by this fix, and **zero
assertions were changed**. This was confirmed empirically, not assumed: all
six files pass unchanged after the fix (see Checks below).

The `issue_857_contract.test.ts` comment near line ~242-248 (also flagged)
is background prose on a `tighten-scope` test — same reasoning, unaffected.

### Genuine RED -> GREEN evidence for this specific fix

Implementation began directly on the identified root cause (the dispatch
supplied the diagnosis and the required work items), so a dedicated failing
test for this exact defect didn't exist beforehand. Added it retroactively
and falsified it before calling this done: two new tests in
`org_proposal_apply.test.ts` under `describe('#1434 root-cause fix:
revertProposal narrows a validated refine-config configPatch')` —

1. A benign refine-config field (`model`) reverts successfully instead of
   being refused.
2. `allowedSkillsJson` (a legacy-scope field) is STILL refused — proving the
   narrowing didn't weaken the existing security guard.

Falsification: `git stash push` on `org_proposal_apply.ts` +
`org_proposal_apply_service.ts` (back to their pre-fix state), re-ran test 1
— confirmed **RED** (`'unsafe-legacy-scope'` instead of `'reverted'`). Test 2
passed in both states (already-correct behavior, unaffected by the bug).
`git stash pop` restored the fix; re-ran — confirmed **GREEN**.

### Checks

```
cd apps/api_server
node_modules/.bin/tsc --noEmit   # clean
npm run build                    # PASS

npx vitest run src/services/__tests__/auto_revert_service.test.ts \
  src/services/__tests__/auto_repair_service.test.ts
# 2 files, 13 tests, all pass

npx vitest run src/__tests__/org_proposal_apply.test.ts \
  src/__tests__/issue_857_contract.test.ts \
  src/__tests__/w1_corrective_4_contract.test.ts \
  src/__tests__/w1_corrective_5_contract.test.ts \
  src/__tests__/w1_corrective_6_boundaries.test.ts \
  src/__tests__/w1_corrective_6_revisions.test.ts
# 6 files, 321 tests, all pass

npx vitest run src/__tests__/agent_org_proposals.test.ts \
  src/services/__tests__/org_proposal_appliers_wiring.test.ts \
  src/__tests__/w1_corrective_6_lifecycle.test.ts
# 3 files, 38 tests, all pass

# Combined re-run after restoring the fix (post stash-pop):
npx vitest run src/services/__tests__/auto_revert_service.test.ts \
  src/services/__tests__/auto_repair_service.test.ts \
  src/__tests__/org_proposal_apply.test.ts \
  src/__tests__/issue_857_contract.test.ts \
  src/__tests__/w1_corrective_4_contract.test.ts \
  src/__tests__/w1_corrective_5_contract.test.ts \
  src/__tests__/w1_corrective_6_boundaries.test.ts \
  src/__tests__/w1_corrective_6_revisions.test.ts \
  src/__tests__/agent_org_proposals.test.ts
# 9 files, 358 tests, all pass

npm test   # full apps/api_server suite; final verification-repair run
# 694 files / 5675 tests: 5488 passed, 7 failed, 180 skipped
# All 7 failures confirmed pre-existing/unrelated (grep: no import of
# org_proposal_apply/org_proposal_apply_service/auto_revert_service in any
# of the 5 failing files):
#   - issue_1219_memory_provenance.test.ts (2 failures)
#   - memory_injection.test.ts (2 failures)
#   - delegation_caller_identity.test.ts (1 failure)
#   - issue_1135_audit_lock_contract.test.ts (1 failure)
#   - memory_index_rebuild.test.ts (1 failure)
# Matches this dispatch's own documented known-unrelated-failure list exactly.
```

GitNexus `detect_changes({scope:'all', repo:'Rhythm', worktree:...})`:
`changed_files: 2, changed_symbols: 0, risk: low`. Known limitation (same as
prior passes): the indexed "Rhythm" repo points at a different physical
checkout (`.hermes/worktrees/rhythm-self-improvement/integration`), so a
`git diff` scoped to THIS worktree doesn't map onto the indexed symbol
snapshot. Not a blocker — compensated with exhaustive manual trace of every
caller/test of `revertProposal`, `strictChangeJsonPreflight`, and
`containsScopeBearingPayload` before editing (see above), plus the full
582-file suite run.

### Files changed this session

- `apps/api_server/src/services/org_proposal_apply.ts` (modified) — narrows
  `change` via `extractValidatedConfigPatch` before the scope-bearing check
  in `revertProposal`.
- `apps/api_server/src/services/org_proposal_apply_service.ts` (modified) —
  extracted `extractValidatedConfigPatch` (new exported function) out of
  `strictChangeJsonPreflight`'s inline refine-config narrowing; the function
  now calls the shared helper instead.
- `apps/api_server/src/services/auto_revert_service.ts` (modified) — routes
  through `revertProposal`; deleted the interim
  `UNSAFE_WHOLE_FIELD_SCOPE_FIELDS` guard and the hand-rolled restore
  sequence; header doc comment rewritten to match.
- `apps/api_server/src/__tests__/org_proposal_apply.test.ts` (modified) —
  added the two new root-cause regression tests described above.
- `docs/ai/contracts/issue-1434.json` (modified) — added criteria c8-c10 and
  judgment calls for this session.
- `docs/ai/runs/2026-08-19-d2-4-auto-revert-service.md` (this file, modified)
  — this section.

### Not run this session

Flutter format/analyze (no Flutter files touched), live sandbox/behavioral
E2E (this remains pure internal DB/service-layer logic, same as prior
passes — no new HTTP/WS entry point), PR creation/push (workflow-orchestrator
scope per policy).

## Verification repairs (session 027a3111; triage 2686b362)

Surgical follow-up only; no redesign and no dependency mutation.

### Acceptance RED and falsification evidence

- Initial repaired contract run:
  `npx vitest run src/services/__tests__/auto_revert_service.test.ts src/__tests__/org_proposal_apply.test.ts`
  → **RED: 1 failed / 115 passed**. The deterministic CAS race reached
  `proposal-cas-conflict`; the exact logger assertion exposed the old warning
  serializing the full conflict object, including its detail string.
- CAS test falsification: temporarily removed only the injected second-repo
  race, then ran
  `npx vitest run src/services/__tests__/auto_revert_service.test.ts -t "proposal CAS race"`.
  → **RED as intended:** outcome was `reverted`, not `revert_failed`.
  Restored the race injection.
- Malformed-patch falsification: temporarily broadened
  `isValidatedConfigPatchShape` to accept any string field, then ran
  `npx vitest run src/__tests__/org_proposal_apply.test.ts -t "fails closed for an unrecognized refine-config field"`.
  → **RED as intended:** `temperature` produced `reverted`, not
  `unsafe-legacy-scope`. Restored the field allowlist check. No falsification
  mutation remains.

### Repairs

- Replaced the status-precheck-only c2 fixture with a deterministic race on
  the injected repository instance. A second repository commits
  `applied → measuring` immediately before the captured original method runs
  with the stale revision.
- Added the unsupported `temperature` refine-config case, asserting
  `unsafe-legacy-scope`, no config write, and proposal status `measuring`.
- Strengthened the persisted full-trail alert assertions for original
  kind/title/rationale, every repair's id/title/rationale/status, and revert
  outcome.
- Failure logging is now exactly
  `[auto-revert] revert_failed for proposal '<id>'`; conflict return and
  persisted alert behavior are unchanged. Logs no longer serialize conflict
  expected/actual values.
- Updated stale comments, contract counts/mappings, and project state. D2.4
  is implemented and under verification; D2.5 remains not started; draft PR
  #1454 remains open.

### Final checks

- Focused: **2 files, 116 passed**.
- D2.4 regression set: **9 files, 359 passed**.
- `node_modules/.bin/tsc --noEmit` → PASS.
- `npm run build` → PASS.
- `npm test` → expected baseline only: **694 files / 5675 tests: 5488
  passed, 7 failed, 180 skipped**. Failures remain the documented unrelated
  set: issue_1219_memory_provenance (2), delegation_caller_identity (1),
  issue_1135_audit_lock_contract (1), memory_index_rebuild (1), and
  memory_injection (2).
- `git diff --check` → PASS. Final status contains only the pre-existing D2.4
  implementation/root-cause diff plus this verification repair's named test,
  contract, run-note, and project-state files; no generated build drift.
- GitNexus pre-edit impact could not resolve the worktree-only
  `runAutoRevertAsync` or `extractValidatedConfigPatch` symbols. Final
  `detect_changes(scope=all, worktree=...)` likewise mapped 0 symbols from 4
  tracked changed files. Per dispatch this is **UNKNOWN risk, not low**;
  compensated by the deterministic 359-test regression set, typecheck, build,
  and full 5675-test run.
- Live sandbox was not retried: verification already proved startup is
  blocked before service launch by missing `@opentui/solid/preload`; cleanup
  passed. D2.4 has no live route before D2.5 wiring. api_server was not
  hand-started and dependencies were not changed.

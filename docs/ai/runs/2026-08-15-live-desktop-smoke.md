---
date: 2026-08-15
repo: Rhythm
branch: self-improvement-engine-foundation
pr: 1398
issues: [W1, W5, W6, W7]
status: smoke passed; merge/release pending human decision
tags: [run, Rhythm]
---

# Live desktop smoke — the optimizer against a real database

The first exercise of this branch through the actual desktop app on real data,
rather than through fixtures or the env-gated E2E suite.

## Setup

Dev build from this worktree, launched with `HOME=~/RhythmDevSmoke` so the
server derives its database path there. That directory holds a `.backup` copy
of the real Rhythm database (259 proposals, 1.5 GB) — **the live database was
never written to**. opencode config and credentials symlinked in so the engine
behaves normally.

Two things had to be right for the smoke to mean anything:

- **Port 4001.** `ApiServerService` REUSES an existing server on 4001 rather
  than starting its own. The installed Rhythm.app was holding it, so the dev UI
  would have talked to the production server and the smoke would have looked
  perfect while testing none of this branch. The installed app was quit first.
- **The engine.** The worktree has no built opencode fork, so the api_server
  fell back to a stock PATH `opencode` which exited 1 —
  `ENGINE_NOT_READY`, and the optimizer deferred every run. Fixed by pointing
  `RHYTHM_OPENCODE_BIN` at the fork binary built in the primary checkout, whose
  fork tree is byte-identical to this branch's.

## Results

### Shadow run — generates, mutates nothing

```
mode: shadow          proposalsCreated: 5     byKind: {tighten-scope: 5}
byRisk: {low: 0, high: 5}
byOutcome: {autoApplied: 0, queued: 5, measuringInconclusive: 5}
shadow: {candidates: 5, wouldAutoApply: 0, wouldQueue: 5}
recoveryReportOnly: true   recoveryLagging: 47   recoveryIncoherent: 0
```

Verified against the database, not just the summary:

- `agent_configs` rows touched during the run: **0**
- configs with `revision > 0`: **0** — no CAS token advanced anywhere
- all 5 new proposals: `proposed`, `revision 0`, and **all 5 carry the audit
  run id** (the attribution fix, on real data)

`measuringInconclusive: 5` is the P1-2 fix working: before it, the
classification was gated behind the mutation check and was structurally always
zero in shadow — the default mode.

`recoveryLagging: 47` — 47 profiles whose projected file lags the database.
Report-only under shadow, as designed; an acting mode would re-project them.

### Legacy revert — refuses, changes nothing

All **79** active scope proposals in the real data carry legacy whole-field
snapshots. Not one canonical v2, so every revert available on historical data
is the refusal case.

```
POST /agent-org-proposals/1eb7425e.../revert  →  HTTP 409
"uses an unsafe legacy scope snapshot; no changes were made and
 operator reconciliation is required"
```

Profile permission bytes before and after: **identical**. Proposal still
`active`, still `revision 0` — a refused operation did not advance the CAS
token, so nothing holding that token was invalidated. The old engine would have
written the remembered whole field back, erasing anything granted since.

### Full approve → revert loop on a NEW-engine proposal

The path that could not be tested before, because canonical snapshots only
exist for proposals this engine creates.

```
approve  → scope {"rhythm":[9 tools]} becomes {}     config revision 0 → 1
           proposal: active, revision 5, outcome_status = inconclusive
           snapshot form: canonical-v2
revert   → scope restored, IDENTICAL to pre-approve, byte for byte
           proposal: reverted, revision 6            config revision → 2
```

`outcome_status = inconclusive` while `status = active` is W6's field
separation on real data: deployed, not outcome-verified.

### Concurrent edit — the headline safety property

Approve a tighten-scope proposal, then make a human edit to the same profile,
then try to revert the now-stale proposal:

```
approve                        → 200
PATCH allowedMcpsJson          → 200   scope now {"gitnexus":[]}
revert                         → 409
"no longer matches its exact post-apply scope; no changes were made
 and operator reconciliation is required"
scope after the refused revert → {"gitnexus":[]}   (the human edit survived)
```

This is the defect the campaign exists to fix, reproduced end to end: the old
lane would have overwritten the human's edit with a remembered snapshot.

## Found by this smoke

- **The `audit_run_id` fix was incomplete.** It had been fixed in the two
  workflow-signal lanes and reported closed. The real database showed 33
  unattributed `external-adoption` rows, 32 `create-recipe` and 2
  `refine-recipe` — three more generators nobody had audited. Now fixed, with a
  guard over ALL generators (`proposal_run_attribution.test.ts`) that fails for
  a generator that does not exist yet, rather than three more point edits.

## Open, for a human

- **There is no Revert button in the desktop UI.** The proposals view offers
  only Approve and Reject; "revert" appears nowhere in the optimizer feature.
  Every revert above was driven through the API. So today a human can approve a
  scope change from the app but cannot undo one without a curl call. Whether to
  add that control — and where, and for which statuses — is a product decision,
  not one to make while nobody is at the keyboard.
- **Merge and release remain human actions.** Nothing here was merged and no
  release was cut.

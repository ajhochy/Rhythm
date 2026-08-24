---
date: 2026-08-14
repo: Rhythm
branch: codex/react-electron-live-suite
pr: null
issues: [task-live-lifecycle, electron-m1-slice-3]
status: retrospective
smoke_result: "live journey reached create, edit, complete, reload, and screenshot; owner delete UI was disabled"
verification_claimed: false
divergence: false
overall_score: partial
tags: [retro, adherence]
---

# Slice 3 task-live repair-cap retrospective

## Result

The repair cap stopped further execution correctly. The live run demonstrated
real persistence through reload and recorded a populated-state screenshot, but
it did not complete the delete step. The unrun correction changes the UI gate
to treat every live task as owner-owned; that unblocks the owner fixture but is
not a safe representation of the product's collaborator policy.

## Per-criterion comparison

| Criterion | Contract status | Observed status | Category |
| --- | --- | --- | --- |
| c1 live gateway/no fallback | failing | live API create, update, and list/reload were observed; delete remains unverified | P process |
| c2 live page states and mutations | UNVERIFIED | create/edit/complete/reload worked; delete did not | P process |
| c3 live env gate/sandbox inputs | failing | the live test reached the configured sandbox and asserted the exact URLs/DB path | P process |
| c4 visible lifecycle | failing | passed through reload; owner delete UI remained disabled | C1 missing contract |
| c5 second identity isolation | failing | direct secondary list/read/update/delete checks were reached before the UI failure and require no contrary evidence | — |
| c6 fixture regression | pass | focused fixture plus Tasks coverage passed 5/5 | — |

The JSON contract's current failure reasons are stale relative to the observed
run (for example, it says the live lifecycle is not implemented). More
importantly, it does not separately require that a live collaborator sees a
disabled owner-only delete control while the owner sees an enabled one.

## Workflow adherence

- **Expected chain:** acceptance contract → live run → focused repair with
  scope/security review → rerun the same live contract → verification.
- **Observed chain:** acceptance contract → live run through screenshot and
  reload → two focused repair attempts → minimal gate correction recorded but
  not rerun because the cap fired.
- **Skipped skills:** none evidenced. The cap was honored; verification was not
  claimed.

## Issues

1. **C1 missing contract — task-live-lifecycle:** the contract proves API
   cross-identity denial, but not the UI's owner-versus-collaborator delete
   affordance. Detected because the owner was disabled by a fixture/live ID
   mismatch and the proposed workaround makes all live rows owner-capable.
2. **P process — contract bookkeeping:** contract statuses/reasons were not
   updated to the run's partial evidence, obscuring which single assertion
   remains before a rerun. Detected by comparison with the run note.

## Product/security assessment

The API authorization boundary remains likely intact: `TasksController.remove`
loads the task for the authenticated actor and rejects an actor whose numeric
ID differs from `ownerId` before deletion. The test also reached the secondary
identity's API-denial assertions. The UI correction does **not** preserve the
owner-only affordance for shared live tasks: the repository returns shared
tasks to collaborators and supplies `isShared`, while the web mapper discards
that field and the correction uses `gateway.mode === 'live'` as ownership.
It therefore exposes an enabled delete control to a collaborator, although the
server should reject its request.

## Smallest authorized continuation

Do not run another repair loop without AJ's authorization. If authorized,
replace the live-mode ownership bypass with the already returned `isShared`
signal mapped into the page model (owner iff not shared), then run only the
existing env-gated `task-live-lifecycle.live.spec.ts` once. Extend that same
test's existing second identity setup to make the primary task visible to the
secondary as a collaborator and assert its delete control is disabled; retain
the existing API 403/404 assertions. This is the smallest revalidation that
proves both the primary UI deletion and the owner-only UI boundary.

## Skill action

No skill edit. The repair cap and non-PASS handoff worked as designed; the
durable gap is local acceptance coverage, not missing global workflow policy.

## Checks

No product code/tests, services, test commands, Git state, issues, branches,
pushes, or PRs were changed or run during this retrospective.

---
date: 2026-09-14
repo: Rhythm
branch: feature/electron-flutter-retirement
pr: null
issues: [manual-smoke-project-headings-20260912, E20, E21]
status: PARTIAL
tags: [retro, adherence]
smoke_result: FAIL
verification_claimed: PASS
divergence: true
overall_score: partial
---

# Retrospective — SessionRail child collapse and reconciliation

## Failure

After the integrated automated gate reported PASS, manual smoke found two connected user-journey failures in Electron SessionRail:

1. Parents with subagent children had no child-group collapse affordance.
2. A child added by a live session event appeared briefly, then disappeared after bounded periodic `listPage` reconciliation.

Read-only live API snapshots remained stable. Source inspection also shows the renderer receives child hierarchy through `parentId`, while the store's two-second reconciliation rebuilds current-scope membership from bounded root-page responses. This is consistent with a client acceptance/merge gap, not evidence of backend instability. No runtime probe or product repair was performed by this retrospective.

## Root workflow gap

The acceptance set was fragmented by feature slice instead of composed around the actual SessionRail journey:

- `manual-smoke-project-headings-20260912` tested project-heading collapse and statically loaded child rows, but never required or exercised an independent disclosure on a parent that owns children. The older desktop parity contract explicitly preserved per-parent subagent toggles, but that requirement was not carried into the Electron replacement contract.
- E21 tested live event upsert and periodic reconciliation with root-only fixtures as separate moments. It did not put `parentSessionId` on an event-added row, return a bounded `listPage` snapshot that omitted that child, advance through the periodic reconciliation, and assert that the same rendered child remained present.
- Verification correctly proved the assertions it was given, but accepted broad phrases such as “preserve parent/child inclusion” and “preserve E20 history rows” without requiring a temporal assertion across event → bounded authoritative refresh. The screenshot showed one static expanded state; it could not falsify either missing child disclosure or flash/disappearance.

This is primarily **C1 missing contract** for per-parent child collapse and **C2 wrong contract** for child persistence across reconciliation. There is also a **P process** gap: integrated verification reconciled project-heading and E21 contracts independently rather than checking their shared hierarchical live-list journey.

## Per-criterion comparison

### `manual-smoke-project-headings-20260912.json`

| Criterion | Contract | Smoke observation | Category |
|---|---|---|---|
| repair-c1 compact status | pass | No contrary observation | — |
| repair-c2 colliding project names | pass | No contrary observation | — |
| c1 remove project dropdown | pass | No contrary observation | — |
| c2 collapsible project headings/counts | pass | Project-level collapse is distinct from missing parent-child disclosure | C1 outside criterion |
| c3 project trees / parent-child inclusion | pass | Children can render, but parents expose no child disclosure | C1 missing clause |
| c4 preserve parent/child inclusion and pagination | pass | Event-added child did not survive periodic bounded reconciliation | C2 wrong contract/input |
| c5 project-heading keyboard collapse | pass | Tested project headings only, not child-owning parents | C1 outside criterion |
| c6 focused coverage | pass | Coverage explicitly named project collapse, not per-parent collapse or event/reconcile composition | P process |
| c7 minimal diff | pass | Unrelated to observed behavior | — |
| c8 isolated evidence procedure | pass | Procedure ran; real-backend reconciliation was explicitly not rerun | — |
| c9 no Git/peer actions | pass | Unrelated to observed behavior | — |

### `electron-e21.json`

| Criterion | Contract | Smoke observation | Category |
|---|---|---|---|
| E21-c1 event metadata/new-row upsert | pass | Event-added child appeared, then disappeared; fixture new rows were roots | C2 wrong contract/input |
| E21-c2 selected removal | pass | No contrary observation | — |
| E21-c3 complete current-scope reconciliation | pass | Bounded root-page reconciliation treated omission of the event-added child as absence | C2 wrong contract/input |
| E21-c4 bounded/coalesced refresh preserves E20 history | pass | Rate/coalescing was tested, but state continuity across the refresh was not | C2 wrong contract/assertion |
| E21-c5 real sandbox external lifecycle | pass | Real journey covered root create/rename/archive/delete, not delegated-child arrival and persistence | C1 missing journey |

`electron-e20-session-ordering.json` likewise covers child sort, explicit child pagination, and search context, but contains no per-parent disclosure criterion and no live event → periodic reconciliation transition. Its green status therefore did not address either smoke failure.

## Chain adherence

**Expected chain:** intake/change classification → context pack → optional plan/spec → acceptance contract → implement slice → UI/accessibility/Playwright review → verification gate → project-state update → draft PR → manual smoke → human merge.

**Observed chain from the available run evidence:** focused context/acceptance contract → implementation → UI evidence repair → independent verification → integrated automated verification PASS → manual smoke FAIL. The planning-stage journey table and original requirement-to-Electron parity mapping are not evidenced in the focused project-heading run note. Project-state, draft PR, and merge stages were not reached and are not counted as skipped.

**Skipped/missing workflow behavior:** no `smoke-test-writer` handoff was triggered because the contracts appeared complete; no cross-contract journey reconciliation joined E20 hierarchy, E21 live updates, and the project-heading UI. This is a coverage-routing miss, not evidence that a specialist bypassed file ownership or dispatched peers.

## Detection

- Manual smoke used a real active child and exposed both the missing affordance and temporal flash.
- Existing E20 tests call “Load children” and then assert a static child list; they do not assert a disclosure attached to the parent row.
- Existing E21 tests emit root rows with no `parentSessionId`; after event assertions they test request counts, not child presence after the next two-second reconciliation.
- Stable read-only API snapshots rule against changing server membership as the explanation.

## Prevention — exact future acceptance clauses

Add these clauses to the product repair's acceptance contract before implementation:

1. **Per-parent child disclosure:** “Every visible session parent with one or more loaded subagent children exposes an independent keyboard-operable disclosure control with an accurate accessible name and `aria-expanded`. Children are expanded by default unless the approved design says otherwise. Enter/Space or click hides and restores only that parent's descendants without opening/changing the selected session, changing project collapse, or affecting sibling parents.”
2. **Event/reconciliation persistence:** “When `session.created` or `session.updated` adds an active child with `parentSessionId`, the child appears under the correct visible parent and remains visible through at least the next two bounded periodic `listPage` reconciliations when those root-page responses omit the child. Omission from a bounded root page is not deletion; only an authoritative child-membership response or `session.removed` may remove it. The test must emit the event through the real renderer WebSocket boundary, advance the reconciliation clock, resolve the list responses, and assert the same child row never disappears.”
3. **Integrated hierarchy journey:** “One maintained Playwright journey composes project grouping, parent disclosure, live child arrival, and periodic reconciliation in the rendered SessionRail; separate green tests for each subsystem do not satisfy this criterion.”

The smallest durable workflow improvement is one sentence in `acceptance-contract`'s lifecycle rules: hierarchical live collections must test both the affordance at every collapsible level and an event-added item across the next bounded authoritative reconciliation. No Rhythm-owned skill was edited because every skill edit requires an immediate `POST /system/refresh`, while this retrospective explicitly forbids runtime contact. No profile mutation or approval was needed. Apply that surgical text change in a later runtime-authorized workflow-improvement turn, then refresh and run the workflow validator.

## Scope and safety

- Added only this retrospective note.
- Did not edit SessionRail, store, tests, contracts, checklists, agent profiles, or skills.
- Did not contact live/sandbox runtime, dispatch peers, commit, push, open a PR, merge, or clean up.
